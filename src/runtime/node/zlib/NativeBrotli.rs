use core::ffi::c_int;

use bun_brotli::{Allocator, InitError, OwnedDecoder, OwnedEncoder, c};
type Op = c::BrotliEncoderOperation;

// ─── type defs (real) ─────────────────────────────────────────────────────

enum State {
    Encoder(OwnedEncoder),
    Decoder(OwnedDecoder),
}

pub(crate) struct Context {
    mode: bun_zlib::NodeMode,
    state: Option<State>,

    avail_in: usize,
    avail_out: usize,

    flush: Op,

    /// The encoder's `BROTLI_BOOL`, or the decoder's `BrotliDecoderResult` as an integer.
    last_result: c_int,
    error: c::BrotliDecoderErrorCode2,
}

// ─── the class + Context method bodies ────────────────────────────────────

mod _impl {
    use super::*;
    use core::cell::Cell;
    use core::ffi::{CStr, c_uint};

    use bun_core::vec::BorrowedCursor;
    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{ErrorCode, JsResult};

    use crate::node::node_zlib_binding::{
        CompressionContext, CompressionStreamImpl as _, Error, Stream,
    };
    use crate::node::util::validators;

    pub(crate) struct NativeBrotli {
        stream: Cell<Option<Box<Stream<Context>>>>,
        pending_close: Cell<bool>,
        closed: Cell<bool>,
        /// Fixed at construction: `estimated_size` runs on a GC marking thread, which cannot read `stream`.
        estimated_external_size: usize,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeBrotli {
        pub(crate) fn constructor(mode: u8) -> Self {
            let mode = bun_zlib::NodeMode::from_int(mode);
            Self {
                stream: Cell::new(Some(Stream::new(Context::new(mode)))),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
                estimated_external_size: Self::external_size_for(mode),
            }
        }

        /// Per-mode external-allocation footprint, fixed at construction.
        fn external_size_for(mode: bun_zlib::NodeMode) -> usize {
            const ENCODER_STATE_SIZE: usize = 5143; // sizeof(BrotliEncoderStateStruct)
            const DECODER_STATE_SIZE: usize = 855; // sizeof(BrotliDecoderStateStruct)
            match mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => ENCODER_STATE_SIZE,
                bun_zlib::NodeMode::BROTLI_DECODE => DECODER_STATE_SIZE,
                _ => 0,
            }
        }

        /// Called from any thread (concurrent GC marking). Reads only the
        /// immutable `estimated_external_size` field, never `self.stream`.
        pub(crate) fn estimated_size(&self) -> usize {
            self.estimated_external_size
        }

        pub(crate) fn init(
            &self,
            this_value: JsWrapper<'_, Self>,
            cx: &mut JsScope<'_>,
            init_params_array: JsLocal<'_>,
            write_state: JsLocal<'_>,
            process_callback: JsLocal<'_>,
            dictionary: JsLocal<'_>,
        ) -> JsResult<bool> {
            let global_this = cx.global();
            let this_value = this_value.to_js();
            let mode = self.borrow_idle_stream(global_this)?.context.mode;
            let feature = if mode == bun_zlib::NodeMode::BROTLI_ENCODE {
                bun_removable_features::Feature::BrotliEncoder
            } else {
                bun_removable_features::Feature::BrotliDecoder
            };
            if bun_removable_features::is_removed(feature) {
                return Err(crate::removed_feature::throw_for_removed_feature(
                    global_this,
                    feature,
                ));
            }

            // `flush_write_result` writes two u32s into this array, so the
            // caller-supplied array must hold at least 2 elements.
            let write_result_value = write_state.to_js();
            let Some(mut write_result_buf) = write_result_value.as_array_buffer(global_this) else {
                return Err(global_this.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            };
            if write_result_buf.typed_array_type != bun_jsc::JSType::Uint32Array {
                return Err(global_this.throw_invalid_argument_type_value(
                    "writeResult",
                    "Uint32Array",
                    write_result_value,
                ));
            }
            let write_result_slice = write_result_buf.as_u32();
            if write_result_slice.len() < 2 {
                return Err(global_this
                    .err(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("writeResult must be a Uint32Array with at least 2 elements"),
                    )
                    .throw());
            }
            let write_callback = validators::validate_function(
                global_this,
                "writeCallback",
                process_callback.to_js(),
            )?;

            // Validate `params` before any native state is initialized so the
            // error path needs no cleanup. `as_u32` reinterprets the view's
            // bytes, so the element type must actually be Uint32Array.
            let params_value = init_params_array.to_js();
            let Some(mut params_buf) = params_value.as_array_buffer(global_this) else {
                return Err(global_this.throw_invalid_argument_type_value(
                    "params",
                    "Uint32Array",
                    params_value,
                ));
            };
            if params_buf.typed_array_type != bun_jsc::JSType::Uint32Array {
                return Err(global_this.throw_invalid_argument_type_value(
                    "params",
                    "Uint32Array",
                    params_value,
                ));
            }

            // Bind the ArrayBuffer view to a local so the borrowed byte_slice()
            // outlives the `Context::init` call below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                &[]
            } else {
                let dictionary_value = dictionary.to_js();
                dictionary_buf = match dictionary_value.as_array_buffer(global_this) {
                    Some(buf) => buf,
                    None => {
                        return Err(global_this.throw_invalid_argument_type_value(
                            "dictionary",
                            "Buffer, TypedArray, or DataView",
                            dictionary_value,
                        ));
                    }
                };
                dictionary_buf.byte_slice()
            };

            js::write_result_set_cached(this_value, global_this, write_result_value);

            js::write_callback_set_cached(
                this_value,
                global_this,
                write_callback.with_async_context_if_needed(global_this),
            );

            let mut stream = self.borrow_idle_stream(global_this)?;
            if let Err(err) = stream.context.init(dictionary) {
                drop(stream);
                self.emit_error(global_this, this_value, &err);
                return Ok(false);
            }

            let params_ = params_buf.as_u32();

            for (i, d) in params_.iter().map(|d| d.get()).enumerate() {
                // (d == -1) {
                if d == u32::MAX {
                    continue;
                }
                if !stream
                    .context
                    .set_params(u32::try_from(i).expect("int cast") as c_uint, d)
                {
                    // No `emit_error`: zlib.ts sets `onerror` after `init()`.
                    drop(stream);
                    self.close();
                    return Ok(false);
                }
            }
            Ok(true)
        }

        pub(crate) fn params(&self) {
            // intentionally left empty
        }
    }

    impl Context {
        fn new(mode: bun_zlib::NodeMode) -> Self {
            Self {
                mode,
                state: None,
                avail_in: 0,
                avail_out: 0,
                flush: Op::process,
                last_result: 0,
                error: c::BrotliDecoderErrorCode2::NO_ERROR,
            }
        }

        fn init(&mut self, dictionary: &[u8]) -> Result<(), Error> {
            // Mirrors node's Init(): free the previous instance and dictionary
            // before building new ones. `init` is JS-reachable twice on one
            // handle, and ResetStream() lands here with no dictionary.
            self.state = None;
            let state = match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    OwnedEncoder::with_dictionary(Allocator::Bun, dictionary).map(State::Encoder)
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    OwnedDecoder::with_dictionary(Allocator::Bun, dictionary).map(State::Decoder)
                }
                _ => unreachable!(),
            };
            self.state = Some(state.map_err(|err| match err {
                InitError::CreateInstance => Error::init(
                    c"Could not initialize Brotli instance",
                    -1,
                    c"ERR_ZLIB_INITIALIZATION_FAILED",
                ),
                InitError::PrepareDictionary => Error::init(
                    c"Failed to prepare brotli dictionary",
                    -1,
                    c"ERR_ZLIB_DICTIONARY_LOAD_FAILED",
                ),
                InitError::AttachDictionary => Error::init(
                    c"Failed to attach brotli dictionary",
                    -1,
                    c"ERR_ZLIB_DICTIONARY_LOAD_FAILED",
                ),
            })?);
            Ok(())
        }

        fn set_params(&mut self, key: c_uint, value: u32) -> bool {
            match &mut self.state {
                Some(State::Encoder(encoder)) => encoder.set_parameter(key, value),
                Some(State::Decoder(decoder)) => decoder.set_parameter(key, value),
                None => unreachable!(),
            }
        }
    }

    impl CompressionContext for Context {
        fn reset(&mut self) -> Result<(), Error> {
            // Matches node's `BrotliContext::ResetStream()`, which calls `Init()`
            // with its default (empty) dictionary — a reset drops the dictionary.
            // `init` frees the previous state and dictionary itself.
            self.init(&[])
        }

        fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 3
        }

        fn set_flush(&mut self, flush: c_int) {
            // Caller passes a valid BrotliEncoderOperation discriminant (Node
            // zlib constants 0..=3). Exhaustive match — `Op` is `#[repr(u32)]`
            // so the prior `c_int` bit-cast was a width hazard anyway. Out-of-
            // range traps.
            self.flush = match flush {
                0 => Op::process,
                1 => Op::flush,
                2 => Op::finish,
                3 => Op::emit_metadata,
                n => unreachable!("invalid BrotliEncoderOperation {n}"),
            };
        }

        fn do_work(&mut self, mut input: &[u8], mut out: BorrowedCursor<'_, u8>) {
            match &mut self.state {
                // Driven before `init()`.
                None => {}
                Some(State::Encoder(encoder)) => {
                    let (consumed, ok) = encoder.step(input, out.reborrow(), self.flush);
                    input = &input[consumed..];
                    self.last_result = c_int::from(ok);
                }
                Some(State::Decoder(decoder)) => {
                    let (consumed, result) = decoder.step(input, out.reborrow());
                    input = &input[consumed..];
                    self.last_result = result as c_int;
                    if result == c::BrotliDecoderResult::err {
                        self.error = decoder.error_code();
                    }
                }
            }
            self.avail_in = input.len();
            self.avail_out = out.capacity();
        }

        fn write_result(&self) -> Result<[u32; 2], Error> {
            match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    if self.last_result == 0 {
                        return Err(Error::init(
                            c"Compression failed",
                            -1,
                            c"ERR_BROTLI_COMPRESSION_FAILED",
                        ));
                    }
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    if self.error != c::BrotliDecoderErrorCode2::NO_ERROR {
                        return Err(Error::init(
                            c"Decompression failed",
                            self.error as i32,
                            code_for_error(self.error),
                        ));
                    } else if self.flush == Op::finish
                        && self.last_result == c::BrotliDecoderResult::needs_more_input as c_int
                    {
                        return Err(Error::init(
                            c"unexpected end of file",
                            bun_zlib::ReturnCode::BufError as i32,
                            c"Z_BUF_ERROR",
                        ));
                    }
                }
                _ => unreachable!(),
            }
            Ok([self.avail_out, self.avail_in].map(|n| u32::try_from(n).expect("int cast")))
        }
    }

    crate::__impl_compression_stream!(NativeBrotli, Context, js_NativeBrotli);

    fn code_for_error(err: c::BrotliDecoderErrorCode2) -> &'static CStr {
        // Node builds these as `"ERR_" + <brotli enum suffix>` where the suffix
        // keeps its leading underscore (`_ERROR_FORMAT_*`), yielding codes like
        // `ERR__ERROR_FORMAT_PADDING_2` (double underscore). Match node exactly.
        // Rust has no enum reflection — expand the table by hand. Keep in sync
        // with `bun_brotli::c::BrotliDecoderErrorCode2`.
        use c::BrotliDecoderErrorCode2 as E;
        match err {
            E::NO_ERROR => c"ERR__NO_ERROR",
            E::SUCCESS => c"ERR__SUCCESS",
            E::NEEDS_MORE_INPUT => c"ERR__NEEDS_MORE_INPUT",
            E::NEEDS_MORE_OUTPUT => c"ERR__NEEDS_MORE_OUTPUT",
            E::ERROR_FORMAT_EXUBERANT_NIBBLE => c"ERR__ERROR_FORMAT_EXUBERANT_NIBBLE",
            E::ERROR_FORMAT_RESERVED => c"ERR__ERROR_FORMAT_RESERVED",
            E::ERROR_FORMAT_EXUBERANT_META_NIBBLE => c"ERR__ERROR_FORMAT_EXUBERANT_META_NIBBLE",
            E::ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET",
            E::ERROR_FORMAT_SIMPLE_HUFFMAN_SAME => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME",
            E::ERROR_FORMAT_CL_SPACE => c"ERR__ERROR_FORMAT_CL_SPACE",
            E::ERROR_FORMAT_HUFFMAN_SPACE => c"ERR__ERROR_FORMAT_HUFFMAN_SPACE",
            E::ERROR_FORMAT_CONTEXT_MAP_REPEAT => c"ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT",
            E::ERROR_FORMAT_BLOCK_LENGTH_1 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_1",
            E::ERROR_FORMAT_BLOCK_LENGTH_2 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_2",
            E::ERROR_FORMAT_TRANSFORM => c"ERR__ERROR_FORMAT_TRANSFORM",
            E::ERROR_FORMAT_DICTIONARY => c"ERR__ERROR_FORMAT_DICTIONARY",
            E::ERROR_FORMAT_WINDOW_BITS => c"ERR__ERROR_FORMAT_WINDOW_BITS",
            E::ERROR_FORMAT_PADDING_1 => c"ERR__ERROR_FORMAT_PADDING_1",
            E::ERROR_FORMAT_PADDING_2 => c"ERR__ERROR_FORMAT_PADDING_2",
            E::ERROR_FORMAT_DISTANCE => c"ERR__ERROR_FORMAT_DISTANCE",
            E::ERROR_FORMAT_BLOCK_SWITCH => c"ERR__ERROR_FORMAT_BLOCK_SWITCH",
            E::ERROR_COMPOUND_DICTIONARY => c"ERR__ERROR_COMPOUND_DICTIONARY",
            E::ERROR_DICTIONARY_NOT_SET => c"ERR__ERROR_DICTIONARY_NOT_SET",
            E::ERROR_INVALID_ARGUMENTS => c"ERR__ERROR_INVALID_ARGUMENTS",
            E::ERROR_ALLOC_CONTEXT_MODES => c"ERR__ERROR_ALLOC_CONTEXT_MODES",
            E::ERROR_ALLOC_TREE_GROUPS => c"ERR__ERROR_ALLOC_TREE_GROUPS",
            E::ERROR_ALLOC_CONTEXT_MAP => c"ERR__ERROR_ALLOC_CONTEXT_MAP",
            E::ERROR_ALLOC_RING_BUFFER_1 => c"ERR__ERROR_ALLOC_RING_BUFFER_1",
            E::ERROR_ALLOC_RING_BUFFER_2 => c"ERR__ERROR_ALLOC_RING_BUFFER_2",
            E::ERROR_ALLOC_BLOCK_TYPE_TREES => c"ERR__ERROR_ALLOC_BLOCK_TYPE_TREES",
            E::ERROR_UNREACHABLE => c"ERR__ERROR_UNREACHABLE",
        }
    }
} // mod _impl

pub(crate) use _impl::NativeBrotli;
