use core::ffi::{CStr, c_int};
use core::{mem, ptr};

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

// `write()` hands the `Context` to a pool thread by pointer.
const _: fn() = || {
    fn assert_send<T: Send>() {}
    assert_send::<State>();
};

pub(crate) struct Context {
    pub(crate) mode: bun_zlib::NodeMode,
    pub(crate) state: State,
    /// The parameters that were set, for `reset()`.
    pub(crate) params: Vec<(u32, u32)>,

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
            params: Vec::new(),
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
            // The buffers that come with the first write are not counted.
            match mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => size_of::<Encoder>(),
                bun_zlib::NodeMode::BROTLI_DECODE => size_of::<Decoder>(),
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
            let feature = if self.stream.get().mode == bun_zlib::NodeMode::BROTLI_ENCODE {
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
                    .with_mut(|s| s.set_params(u32::try_from(i).expect("int cast"), d));
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
        /// A new encoder or decoder, with the defaults and nothing left of the one before.
        fn start(&mut self) {
            // The previous instance and its dictionary go before new ones are built.
            self.state = State::None;
            self.params.clear();
            self.encode_ok = false;
            self.decode_result = DecoderResult::Error;
            self.error = DecoderErrorCode::NoError;
            self.state = match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => State::Encoder(Box::new(Encoder::new())),
                bun_zlib::NodeMode::BROTLI_DECODE => State::Decoder(Box::new(Decoder::new())),
                _ => unreachable!(),
            };
        }

        /// `init` is JS-reachable twice on one handle.
        pub(crate) fn init(&mut self, dictionary: Option<&[u8]>) -> Error {
            self.start();
            let Some(dictionary) = dictionary.filter(|d| !d.is_empty()) else {
                return Error::ok();
            };
            match &mut self.state {
                State::Encoder(encoder) => Self::attach_encoder_dictionary(encoder, dictionary),
                State::Decoder(decoder) => {
                    if !decoder.attach_dictionary(dictionary.into()) {
                        return Self::dictionary_error(c"Failed to attach brotli dictionary");
                    }
                    Error::ok()
                }
                State::None => unreachable!(),
            }
        }

        fn attach_encoder_dictionary(encoder: &mut Encoder, dictionary: &[u8]) -> Error {
            let Some(prepared) = PreparedDictionary::new(dictionary.into()) else {
                return Self::dictionary_error(c"Failed to prepare brotli dictionary");
            };
            if !encoder.attach_prepared_dictionary(prepared) {
                return Self::dictionary_error(c"Failed to attach brotli dictionary");
            }
            Error::ok()
        }

        fn dictionary_error(message: &'static CStr) -> Error {
            Error::init(
                message.as_ptr(),
                -1,
                c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
            )
        }

        pub(crate) fn set_params(&mut self, key: u32, value: u32) -> Error {
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
            self.params.push((key, value));
            Error::ok()
        }

        /// As in node, the new stream has the dictionary and the parameters of the old one.
        pub(crate) fn reset(&mut self) -> Error {
            let old = mem::take(&mut self.state);
            let params = mem::take(&mut self.params);
            self.start();
            let attached = match (old, &mut self.state) {
                (State::Encoder(old), State::Encoder(new)) => old
                    .into_prepared_dictionaries()
                    .into_iter()
                    .all(|dictionary| new.attach_prepared_dictionary(dictionary)),
                (State::Decoder(old), State::Decoder(new)) => old
                    .into_dictionaries()
                    .into_iter()
                    .all(|dictionary| new.attach_dictionary(dictionary)),
                _ => true,
            };
            if !attached {
                return Self::dictionary_error(c"Failed to attach brotli dictionary");
            }
            for (key, value) in params {
                let err = self.set_params(key, value);
                if err.is_error() {
                    return err;
                }
            }
            Error::ok()
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
            Op::from_raw(flush).is_some()
        }

        pub(crate) fn set_flush(&mut self, flush: c_int) {
            self.flush = Op::from_raw(flush as u32).expect("checked by flush_value_is_valid");
        }

        pub(crate) fn do_work(&mut self) {
            // A handle driven before `init()`.
            if matches!(self.state, State::None) {
                return;
            }
            // SAFETY: `set_buffers` took `next_in`/`avail_in` from a view that
            // `write()` keeps alive and pinned, or from the handle's
            // `input_copy`, until the write completes, and a handle has one
            // write at a time. The bytes are NOT kept from changing: JS still
            // has the view while the pool thread is here, and shared memory
            // has other writers. `bun_brotli` has no `unsafe` and checks every
            // index, so a byte that reads differently the second time gives
            // other output or an error.
            let mut input = unsafe { bun_core::ffi::slice(self.next_in, self.avail_in) };
            // "in" and "out" can be views of the same ArrayBuffer.
            let in_start = self.next_in.addr();
            let out_start = self.next_out.addr();
            let mut input_copy = Vec::new();
            if in_start < out_start + self.avail_out && out_start < in_start + self.avail_in {
                if input_copy.try_reserve_exact(input.len()).is_err() {
                    return self.set_out_of_memory();
                }
                input_copy.extend_from_slice(input);
                input = &input_copy;
            }
            // SAFETY: as above, and `input` does not overlap these bytes.
            let mut output = unsafe { bun_core::ffi::slice_mut(self.next_out, self.avail_out) };
            match &mut self.state {
                State::None => unreachable!(),
                State::Encoder(encoder) => {
                    self.encode_ok = encoder
                        .compress_stream(self.flush, &mut input, &mut output)
                        .is_ok();
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

        /// Makes `get_error_info` report what it does when the codec cannot allocate.
        fn set_out_of_memory(&mut self) {
            self.encode_ok = false;
            self.decode_result = DecoderResult::Error;
            self.error = DecoderErrorCode::AllocRingBuffer1;
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
                            // Node builds this as `"ERR_"` and the name brotli has for the error, which keeps
                            // its leading underscore: `ERR__ERROR_FORMAT_PADDING_2`.
                            self.error.node_code().as_ptr(),
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
            self.params = Vec::new();
            self.mode = bun_zlib::NodeMode::NONE;
        }
    }

    crate::__impl_compression_stream!(NativeBrotli, Context, js_NativeBrotli);

    /// Placeholder for `WorkPoolTask.callback` — overwritten before scheduling
    /// (see `CompressionStreamImpl::write` in node_zlib_binding.rs).
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn noop_task_callback(_task: *mut WorkPoolTask) {}
} // mod _impl

pub(crate) use _impl::NativeBrotli;
