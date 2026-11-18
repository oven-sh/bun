use core::ffi::c_int;

use bun_brotli::{DecodeError, DecodeStatus, Decoder, Encoder, Operation};

use crate::node::node_zlib_binding::{NodeMode, Z_BUF_ERROR};

// ─── type defs (real) ─────────────────────────────────────────────────────

enum State {
    Encoder(Box<Encoder>),
    Decoder(Box<Decoder>),
}

pub(crate) struct Context {
    mode: NodeMode,
    state: Option<State>,

    avail_in: usize,
    avail_out: usize,

    flush: Operation,

    encoded: bool,
    needs_input: bool,
    /// Outlives `reset()`, like in node.
    error: Option<DecodeError>,
}

// ─── the class + Context method bodies ────────────────────────────────────

mod _impl {
    use super::*;
    use core::cell::Cell;
    use core::ffi::c_uint;

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
            let mode = NodeMode::from_int(mode);
            Self {
                stream: Cell::new(Some(Stream::new(Context::new(mode)))),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
                estimated_external_size: Self::external_size_for(mode),
            }
        }

        /// Per-mode external-allocation footprint, fixed at construction.
        fn external_size_for(mode: NodeMode) -> usize {
            // What a stream takes depends on its parameters and input, so these only pace the collector.
            const ENCODER_ESTIMATE: usize = 5143;
            const DECODER_ESTIMATE: usize = 855;
            match mode {
                NodeMode::BROTLI_ENCODE => ENCODER_ESTIMATE,
                NodeMode::BROTLI_DECODE => DECODER_ESTIMATE,
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
            let feature = if mode == NodeMode::BROTLI_ENCODE {
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
        fn new(mode: NodeMode) -> Self {
            Self {
                mode,
                state: None,
                avail_in: 0,
                avail_out: 0,
                flush: Operation::Process,
                encoded: false,
                needs_input: false,
                error: None,
            }
        }

        fn init(&mut self, dictionary: &[u8]) -> Result<(), Error> {
            // Mirrors node's Init(): free the previous instance and dictionary
            // before building new ones. `init` is JS-reachable twice on one
            // handle, and ResetStream() lands here with no dictionary.
            self.state = None;
            let (state, message) = match self.mode {
                NodeMode::BROTLI_ENCODE => (
                    Encoder::with_dictionary(dictionary).map(|e| State::Encoder(Box::new(e))),
                    c"Failed to prepare brotli dictionary",
                ),
                NodeMode::BROTLI_DECODE => (
                    Decoder::with_dictionary(dictionary).map(|d| State::Decoder(Box::new(d))),
                    c"Failed to attach brotli dictionary",
                ),
                _ => unreachable!(),
            };
            let error = || Error::init(message, -1, c"ERR_ZLIB_DICTIONARY_LOAD_FAILED");
            self.state = Some(state.ok_or_else(error)?);
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
            self.flush = match flush {
                0 => Operation::Process,
                1 => Operation::Flush,
                2 => Operation::Finish,
                3 => Operation::EmitMetadata,
                n => unreachable!("invalid BROTLI_OPERATION {n}"),
            };
        }

        fn do_work(&mut self, mut input: &[u8], mut out: BorrowedCursor<'_, u8>) {
            match &mut self.state {
                // Driven before `init()`, or after it failed.
                None => self.encoded = false,
                Some(State::Encoder(encoder)) => {
                    let result = encoder.compress(self.flush, &mut input, out.reborrow());
                    self.encoded = result.is_ok();
                }
                Some(State::Decoder(decoder)) => {
                    let result = decoder.decompress(&mut input, out.reborrow());
                    self.needs_input = result == Ok(DecodeStatus::NeedsInput);
                    self.error = result.err().or(self.error);
                }
            }
            self.avail_in = input.len();
            self.avail_out = out.capacity();
        }

        fn write_result(&self) -> Result<[u32; 2], Error> {
            match self.mode {
                NodeMode::BROTLI_ENCODE => {
                    if !self.encoded {
                        return Err(Error::init(
                            c"Compression failed",
                            -1,
                            c"ERR_BROTLI_COMPRESSION_FAILED",
                        ));
                    }
                }
                NodeMode::BROTLI_DECODE => {
                    if let Some(error) = self.error {
                        return Err(Error::init(
                            c"Decompression failed",
                            error as i32,
                            error.code(),
                        ));
                    } else if self.flush == Operation::Finish && self.needs_input {
                        return Err(Error::init(
                            c"unexpected end of file",
                            Z_BUF_ERROR,
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
} // mod _impl

pub(crate) use _impl::NativeBrotli;
