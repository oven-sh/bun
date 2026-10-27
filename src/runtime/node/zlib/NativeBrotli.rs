use core::ffi::c_int;
use core::ptr;

use bun_brotli::{
    Decoder, DecoderErrorCode, DecoderParameter, DecoderResult, Encoder, EncoderOperation as Op,
    EncoderParameter, PreparedDictionary,
};

// ─── type defs (real) ─────────────────────────────────────────────────────

#[derive(Default)]
pub(crate) enum State {
    #[default]
    None,
    Encoder(Box<Encoder>),
    Decoder(Box<Decoder>),
}

pub(crate) struct Context {
    pub(crate) mode: bun_zlib::NodeMode,
    pub(crate) state: State,

    pub(crate) next_in: *const u8,
    pub(crate) next_out: *mut u8,
    pub avail_in: usize,
    pub avail_out: usize,

    pub flush: Op,

    /// What the last `do_work()` of an encoder returned.
    pub(crate) encode_ok: bool,
    /// What the last `do_work()` of a decoder returned.
    pub(crate) decode_result: DecoderResult,
    pub(crate) error: DecoderErrorCode,
}

impl Default for Context {
    fn default() -> Self {
        Self {
            mode: bun_zlib::NodeMode::NONE,
            state: State::None,
            next_in: ptr::null(),
            next_out: ptr::null_mut(),
            avail_in: 0,
            avail_out: 0,
            flush: Op::Process,
            encode_ok: false,
            decode_result: DecoderResult::Error,
            error: DecoderErrorCode::NoError,
        }
    }
}

// ─── the class + Context method bodies ────────────────────────────────────

mod _impl {
    use super::*;
    use core::cell::Cell;
    use core::ffi::c_uint;

    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{ErrorCode, JSGlobalObject, JsCell, JsResult, StrongOptional, WorkPoolTask};
    use bun_ptr::RefPtr;

    use crate::node::node_zlib_binding::{CompressionStreamImpl as _, CountedKeepAlive, Error};
    use crate::node::util::validators;

    // R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
    // interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
    #[derive(bun_ptr::CellRefCounted)]
    pub(crate) struct NativeBrotli {
        pub(crate) ref_count: Cell<u32>,
        // The global outlives this payload. `BackRef`
        // centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        /// How the pool thread delivers a finished write to the VM.
        pub ticket: Cell<Option<bun_jsc::Ticket>>,
        pub stream: JsCell<Context>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        // TODO: Strong self-ref on the wrapper → JsRef per PORTING.md §JSC (Strong back-ref to own wrapper leaks)
        pub this_value: JsCell<StrongOptional>, // Strong.Optional — empty-initialised
        pub write_in_progress: Cell<bool>,
        /// bit 0: the pending input's ArrayBuffer is pinned; bit 1: the pending output's. A held bufferless view sets neither.
        pub pinned_buffers: Cell<u8>,
        /// Copy of the pending `write()`'s input, if a pin can't keep the input mapped.
        pub input_copy: JsCell<crate::node::node_zlib_binding::InputCopy>,
        pub pending_close: Cell<bool>,
        pub closed: Cell<bool>,
        pub task: JsCell<WorkPoolTask>,
        /// External-allocation footprint reported to the GC, fixed at
        /// construction. `mode` never changes after this (only `close()` sets
        /// it to `NONE`, on the JS thread), so the external state size is
        /// constant for the life of the instance. Cached here as a plain
        /// immutable field because `estimated_size` runs on the concurrent GC
        /// marking thread, where reading `self.stream` through the `JsCell`
        /// would alias the `&mut` held by an in-progress `with_mut` drive loop.
        pub(crate) estimated_external_size: usize,
    }

    // `CompressionStreamImpl` (node_zlib_binding.rs) has write, writeSync, reset, close and onerror.

    impl NativeBrotli {
        pub(crate) fn constructor(cx: &mut JsScope<'_>, mode: u8) -> *mut Self {
            let mode = bun_zlib::NodeMode::from_int(mode);
            let stream = Context {
                mode,
                ..Default::default()
            };
            RefPtr::new(Self {
                ref_count: Cell::new(1),
                global_this: bun_ptr::BackRef::new(cx.global()),
                ticket: Cell::new(None),
                stream: JsCell::new(stream),
                poll_ref: JsCell::new(CountedKeepAlive::default()),
                this_value: JsCell::new(StrongOptional::empty()),
                write_in_progress: Cell::new(false),
                pinned_buffers: Cell::new(0),
                input_copy: JsCell::new(Default::default()),
                pending_close: Cell::new(false),
                closed: Cell::new(false),
                // .callback = undefined — overwritten before WorkPool::schedule()
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: noop_task_callback,
                }),
                estimated_external_size: Self::external_size_for(mode),
            })
            .into_raw()
        }

        /// Per-mode external-allocation footprint, fixed at construction.
        fn external_size_for(mode: bun_zlib::NodeMode) -> usize {
            // What the state structs of the C library took. The buffers that
            // come with the first write were never counted.
            const ENCODER_STATE_SIZE: usize = 5143;
            const DECODER_STATE_SIZE: usize = 855;
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
            // Racing an in-flight async write would alias `&mut Context`
            // across threads; a closed `Context` cannot be re-initialized.
            self.throw_unless_idle(global_this)?;

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
            // outlives the `stream.init` call below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                None
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
                Some(dictionary_buf.byte_slice())
            };

            js::write_result_set_cached(this_value, global_this, write_result_value);

            js::write_callback_set_cached(
                this_value,
                global_this,
                write_callback.with_async_context_if_needed(global_this),
            );

            let mut err = self.stream.with_mut(|s| s.init(dictionary));
            if err.is_error() {
                self.emit_error(global_this, this_value, err);
                return Ok(false);
            }

            let params_ = params_buf.as_u32();

            for (i, d) in params_.iter().map(|d| d.get()).enumerate() {
                // (d == -1) {
                if d == u32::MAX {
                    continue;
                }
                err = self
                    .stream
                    .with_mut(|s| s.set_params(u32::try_from(i).expect("int cast") as c_uint, d));
                if err.is_error() {
                    // impl.emitError(this, globalThis, this_value, err); //XXX: onerror isn't set yet
                    self.stream.with_mut(|s| s.close());
                    // The Context is torn down (`mode` is `NONE`); reject any
                    // further operation the way `close()` does.
                    self.closed.set(true);
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
        pub(crate) fn init(&mut self, dictionary: Option<&[u8]>) -> Error {
            // Mirrors node's Init(): the previous instance and its dictionary
            // go before new ones are built. `init` is JS-reachable twice on one
            // handle, and ResetStream() lands here with no dictionary.
            self.state = State::None;
            let dictionary = dictionary.filter(|d| !d.is_empty());
            match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    let mut encoder = Box::new(Encoder::new());
                    let err = match dictionary {
                        Some(dict) => Self::attach_encoder_dictionary(&mut encoder, dict),
                        None => Error::ok(),
                    };
                    self.state = State::Encoder(encoder);
                    err
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    let mut decoder = Box::new(Decoder::new());
                    let attached =
                        dictionary.is_none_or(|dict| decoder.attach_dictionary(dict.into()));
                    self.state = State::Decoder(decoder);
                    if !attached {
                        return Error::init(
                            c"Failed to attach brotli dictionary".as_ptr(),
                            -1,
                            c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
                        );
                    }
                    Error::ok()
                }
                _ => unreachable!(),
            }
        }

        fn attach_encoder_dictionary(encoder: &mut Encoder, dictionary: &[u8]) -> Error {
            let Some(prepared) = PreparedDictionary::new(dictionary.into()) else {
                return Error::init(
                    c"Failed to prepare brotli dictionary".as_ptr(),
                    -1,
                    c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
                );
            };
            if !encoder.attach_prepared_dictionary(prepared) {
                return Error::init(
                    c"Failed to attach brotli dictionary".as_ptr(),
                    -1,
                    c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
                );
            }
            Error::ok()
        }

        pub(crate) fn set_params(&mut self, key: c_uint, value: u32) -> Error {
            let ok = match &mut self.state {
                State::Encoder(encoder) => EncoderParameter::from_raw(key)
                    .is_some_and(|parameter| encoder.set_parameter(parameter, value)),
                State::Decoder(decoder) => DecoderParameter::from_raw(key)
                    .is_some_and(|parameter| decoder.set_parameter(parameter, value)),
                State::None => unreachable!(),
            };
            if !ok {
                return Error::init(
                    c"Setting parameter failed".as_ptr(),
                    -1,
                    c"ERR_BROTLI_PARAM_SET_FAILED".as_ptr(),
                );
            }
            Error::ok()
        }

        pub(crate) fn reset(&mut self) -> Error {
            // Matches node's `BrotliContext::ResetStream()`, which calls `Init()`
            // with its default (empty) dictionary — a reset drops the dictionary.
            self.init(None)
        }

        pub(crate) fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
            self.next_in = in_.map_or(ptr::null(), |p| p.as_ptr());
            self.avail_in = in_.map_or(0, |p| p.len());
            // Reshaped for borrowck — compute ptr/len before consuming `out`.
            match out {
                Some(p) => {
                    self.avail_out = p.len();
                    self.next_out = p.as_mut_ptr();
                }
                None => {
                    self.avail_out = 0;
                    self.next_out = ptr::null_mut();
                }
            }
        }

        pub(crate) fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 3
        }

        pub(crate) fn set_flush(&mut self, flush: c_int) {
            // Caller passes a valid BrotliEncoderOperation discriminant (Node
            // zlib constants 0..=3). Out-of-range traps.
            self.flush = match flush {
                0 => Op::Process,
                1 => Op::Flush,
                2 => Op::Finish,
                3 => Op::EmitMetadata,
                n => unreachable!("invalid BrotliEncoderOperation {n}"),
            };
        }

        pub(crate) fn do_work(&mut self) {
            // SAFETY: `set_buffers` took `next_in`/`avail_in` from a slice that
            // the caller keeps alive until the write completes.
            let whole_input = unsafe { bun_core::ffi::slice(self.next_in, self.avail_in) };
            // "in" and "out" can be views of the same ArrayBuffer.
            let in_start = self.next_in.addr();
            let out_start = self.next_out.addr();
            let input_copy: Vec<u8>;
            let mut input =
                if in_start < out_start + self.avail_out && out_start < in_start + self.avail_in {
                    input_copy = whole_input.to_vec();
                    input_copy.as_slice()
                } else {
                    whole_input
                };
            // SAFETY: as above, and nothing else refers to these bytes:
            // `input` does not overlap them.
            let mut output = unsafe { bun_core::ffi::slice_mut(self.next_out, self.avail_out) };
            match &mut self.state {
                // A handle driven before `init()`.
                State::None => return,
                State::Encoder(encoder) => {
                    self.encode_ok = encoder.compress_stream(self.flush, &mut input, &mut output);
                }
                State::Decoder(decoder) => {
                    self.decode_result = decoder.decompress_stream(&mut input, &mut output);
                    if self.decode_result == DecoderResult::Error {
                        self.error = decoder.error_code();
                    }
                }
            }
            self.next_in = self.next_in.wrapping_add(self.avail_in - input.len());
            self.avail_in = input.len();
            self.next_out = self.next_out.wrapping_add(self.avail_out - output.len());
            self.avail_out = output.len();
        }

        pub(crate) fn write_result(&self) -> [u32; 2] {
            [self.avail_out, self.avail_in].map(|n| u32::try_from(n).expect("int cast"))
        }

        pub(crate) fn get_error_info(&self) -> Error {
            match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    if !self.encode_ok {
                        return Error::init(
                            c"Compression failed".as_ptr(),
                            -1,
                            c"ERR_BROTLI_COMPRESSION_FAILED".as_ptr(),
                        );
                    }
                    Error::ok()
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    if self.error != DecoderErrorCode::NoError {
                        return Error::init(
                            c"Decompression failed".as_ptr(),
                            self.error as i32,
                            code_for_error(self.error),
                        );
                    } else if self.flush == Op::Finish
                        && self.decode_result == DecoderResult::NeedsMoreInput
                    {
                        return Error::init(
                            c"unexpected end of file".as_ptr(),
                            bun_zlib::ReturnCode::BufError as i32,
                            c"Z_BUF_ERROR".as_ptr(),
                        );
                    }
                    Error::ok()
                }
                _ => unreachable!(),
            }
        }

        pub(crate) fn close(&mut self) {
            self.state = State::None;
            self.mode = bun_zlib::NodeMode::NONE;
        }
    }

    crate::__impl_compression_stream!(NativeBrotli, Context, js_NativeBrotli);

    fn code_for_error(err: DecoderErrorCode) -> *const core::ffi::c_char {
        // Node builds these as `"ERR_" + <brotli enum suffix>` where the suffix
        // keeps its leading underscore (`_ERROR_FORMAT_*`), yielding codes like
        // `ERR__ERROR_FORMAT_PADDING_2` (double underscore). Match node exactly:
        // `"ERR_"` + `DecoderErrorCode::name()`, as a C string.
        use DecoderErrorCode as E;
        let s: &core::ffi::CStr = match err {
            E::NoError => c"ERR__NO_ERROR",
            E::Success => c"ERR__SUCCESS",
            E::NeedsMoreInput => c"ERR__NEEDS_MORE_INPUT",
            E::NeedsMoreOutput => c"ERR__NEEDS_MORE_OUTPUT",
            E::FormatExuberantNibble => c"ERR__ERROR_FORMAT_EXUBERANT_NIBBLE",
            E::FormatReserved => c"ERR__ERROR_FORMAT_RESERVED",
            E::FormatExuberantMetaNibble => c"ERR__ERROR_FORMAT_EXUBERANT_META_NIBBLE",
            E::FormatSimpleHuffmanAlphabet => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_ALPHABET",
            E::FormatSimpleHuffmanSame => c"ERR__ERROR_FORMAT_SIMPLE_HUFFMAN_SAME",
            E::FormatClSpace => c"ERR__ERROR_FORMAT_CL_SPACE",
            E::FormatHuffmanSpace => c"ERR__ERROR_FORMAT_HUFFMAN_SPACE",
            E::FormatContextMapRepeat => c"ERR__ERROR_FORMAT_CONTEXT_MAP_REPEAT",
            E::FormatBlockLength1 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_1",
            E::FormatBlockLength2 => c"ERR__ERROR_FORMAT_BLOCK_LENGTH_2",
            E::FormatTransform => c"ERR__ERROR_FORMAT_TRANSFORM",
            E::FormatDictionary => c"ERR__ERROR_FORMAT_DICTIONARY",
            E::FormatWindowBits => c"ERR__ERROR_FORMAT_WINDOW_BITS",
            E::FormatPadding1 => c"ERR__ERROR_FORMAT_PADDING_1",
            E::FormatPadding2 => c"ERR__ERROR_FORMAT_PADDING_2",
            E::FormatDistance => c"ERR__ERROR_FORMAT_DISTANCE",
            E::FormatBlockSwitch => c"ERR__ERROR_FORMAT_BLOCK_SWITCH",
            E::CompoundDictionary => c"ERR__ERROR_COMPOUND_DICTIONARY",
            E::DictionaryNotSet => c"ERR__ERROR_DICTIONARY_NOT_SET",
            E::InvalidArguments => c"ERR__ERROR_INVALID_ARGUMENTS",
            E::AllocContextModes => c"ERR__ERROR_ALLOC_CONTEXT_MODES",
            E::AllocTreeGroups => c"ERR__ERROR_ALLOC_TREE_GROUPS",
            E::AllocContextMap => c"ERR__ERROR_ALLOC_CONTEXT_MAP",
            E::AllocRingBuffer1 => c"ERR__ERROR_ALLOC_RING_BUFFER_1",
            E::AllocRingBuffer2 => c"ERR__ERROR_ALLOC_RING_BUFFER_2",
            E::AllocBlockTypeTrees => c"ERR__ERROR_ALLOC_BLOCK_TYPE_TREES",
            E::Unreachable => c"ERR__ERROR_UNREACHABLE",
        };
        s.as_ptr()
    }

    /// Placeholder for `WorkPoolTask.callback` — overwritten before scheduling
    /// (see `CompressionStreamImpl::write` in node_zlib_binding.rs).
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn noop_task_callback(_task: *mut WorkPoolTask) {}
} // mod _impl

pub(crate) use _impl::NativeBrotli;
