use core::ffi::c_int;
use core::mem::MaybeUninit;
use core::ptr;

use bun_brotli::{DecodeError, DecodeStatus, Decoder, Encoder, Operation};
use bun_core::vec::BorrowedBuf;

// ─── type defs (real) ─────────────────────────────────────────────────────

enum State {
    Encoder(Box<Encoder>),
    Decoder(Box<Decoder>),
}

pub(crate) struct Context {
    pub(crate) mode: bun_zlib::NodeMode,
    state: Option<State>,

    next_in: *const u8,
    next_out: *mut u8,
    avail_in: usize,
    avail_out: usize,

    flush: Operation,

    encoded: bool,
    needs_input: bool,
    /// Outlives `reset()`, like in node.
    error: Option<DecodeError>,
}

impl Default for Context {
    fn default() -> Self {
        Self {
            mode: bun_zlib::NodeMode::NONE,
            state: None,
            next_in: ptr::dangling(),
            next_out: ptr::dangling_mut(),
            avail_in: 0,
            avail_out: 0,
            flush: Operation::Process,
            encoded: false,
            needs_input: false,
            error: None,
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
        pub poll_ref: CountedKeepAlive,
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
                poll_ref: CountedKeepAlive::default(),
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
            // What a stream takes depends on its parameters and input, so these only pace the collector.
            const ENCODER_ESTIMATE: usize = 5143;
            const DECODER_ESTIMATE: usize = 855;
            match mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => ENCODER_ESTIMATE,
                bun_zlib::NodeMode::BROTLI_DECODE => DECODER_ESTIMATE,
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
        pub(crate) fn init(&mut self, dictionary: &[u8]) -> Error {
            // Mirrors node's Init(): free the previous instance and dictionary
            // before building new ones. `init` is JS-reachable twice on one
            // handle, and ResetStream() lands here with no dictionary.
            self.state = None;
            let (state, message) = match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => (
                    Encoder::with_dictionary(dictionary).map(|e| State::Encoder(Box::new(e))),
                    c"Failed to prepare brotli dictionary",
                ),
                bun_zlib::NodeMode::BROTLI_DECODE => (
                    Decoder::with_dictionary(dictionary).map(|d| State::Decoder(Box::new(d))),
                    c"Failed to attach brotli dictionary",
                ),
                _ => unreachable!(),
            };
            self.state = state;
            if self.state.is_none() {
                return Error::init(
                    message.as_ptr(),
                    -1,
                    c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
                );
            }
            Error::ok()
        }

        pub(crate) fn set_params(&mut self, key: c_uint, value: u32) -> Error {
            let ok = match &mut self.state {
                Some(State::Encoder(encoder)) => encoder.set_parameter(key, value),
                Some(State::Decoder(decoder)) => decoder.set_parameter(key, value),
                None => unreachable!(),
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
            // `init` frees the previous state and dictionary itself.
            self.init(&[])
        }

        pub(crate) fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
            let (in_, out) = (in_.unwrap_or_default(), out.unwrap_or_default());
            (self.next_in, self.avail_in) = (in_.as_ptr(), in_.len());
            (self.next_out, self.avail_out) = (out.as_mut_ptr(), out.len());
        }

        pub(crate) fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 3
        }

        pub(crate) fn set_flush(&mut self, flush: c_int) {
            self.flush = match flush {
                0 => Operation::Process,
                1 => Operation::Flush,
                2 => Operation::Finish,
                3 => Operation::EmitMetadata,
                n => unreachable!("invalid BROTLI_OPERATION {n}"),
            };
        }

        pub(crate) fn do_work(&mut self) {
            let Some(state) = &mut self.state else {
                // Driven before `init()`, or after it failed.
                self.encoded = false;
                return;
            };
            // SAFETY: `set_buffers` took this from a slice that the caller keeps alive until the write ends.
            let mut input = unsafe { core::slice::from_raw_parts(self.next_in, self.avail_in) };
            let overlap = self.next_in.addr() < self.next_out.addr() + self.avail_out
                && self.next_out.addr() < self.next_in.addr() + self.avail_in;
            let mut staged = Vec::<u8>::new();
            let output: &mut [MaybeUninit<u8>] = if !overlap {
                // SAFETY: as above, and `input` does not overlap it.
                unsafe { core::slice::from_raw_parts_mut(self.next_out.cast(), self.avail_out) }
            } else if staged.try_reserve_exact(self.avail_out).is_ok() {
                &mut staged.spare_capacity_mut()[..self.avail_out]
            } else {
                self.encoded = false;
                self.error = Some(DecodeError::AllocRingBuffer1);
                return;
            };
            let mut output = BorrowedBuf::from(output);
            match state {
                State::Encoder(encoder) => {
                    let result = encoder.compress(self.flush, &mut input, output.unfilled());
                    self.encoded = result.is_ok();
                }
                State::Decoder(decoder) => {
                    let result = decoder.decompress(&mut input, output.unfilled());
                    self.needs_input = result == Ok(DecodeStatus::NeedsInput);
                    self.error = result.err().or(self.error);
                }
            }
            self.avail_in = input.len();
            self.avail_out -= output.len();
            if overlap {
                let staged = output.filled();
                // SAFETY: `staged` is no longer than `avail_out` was, and `input` is not read again.
                unsafe { ptr::copy_nonoverlapping(staged.as_ptr(), self.next_out, staged.len()) };
            }
        }

        pub(crate) fn write_result(&self) -> [u32; 2] {
            [self.avail_out, self.avail_in].map(|n| u32::try_from(n).expect("int cast"))
        }

        pub(crate) fn get_error_info(&self) -> Error {
            match self.mode {
                bun_zlib::NodeMode::BROTLI_ENCODE => {
                    if !self.encoded {
                        return Error::init(
                            c"Compression failed".as_ptr(),
                            -1,
                            c"ERR_BROTLI_COMPRESSION_FAILED".as_ptr(),
                        );
                    }
                    Error::ok()
                }
                bun_zlib::NodeMode::BROTLI_DECODE => {
                    if let Some(error) = self.error {
                        return Error::init(
                            c"Decompression failed".as_ptr(),
                            error as i32,
                            error.code().as_ptr(),
                        );
                    } else if self.flush == Operation::Finish && self.needs_input {
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
            self.state = None;
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
