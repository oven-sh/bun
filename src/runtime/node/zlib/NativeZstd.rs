pub(crate) use _impl::NativeZstd;

mod _impl {
    use core::cell::Cell;
    use core::ffi::{c_int, c_uint};
    use core::ptr;

    use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
    use bun_jsc::{self as jsc, JSGlobalObject, JsCell, JsResult, StrongOptional, WorkPoolTask};
    use bun_ptr::RefPtr;
    use bun_zstd::{CCtx, DCtx, EndDirective, InBuffer, OutBuffer};

    use crate::node::node_zlib_binding::{CompressionStreamImpl as _, CountedKeepAlive, Error};
    use crate::node::util::validators;
    // #[repr(u8)] enum shared by all native-zlib stream types.
    use bun_zlib::NodeMode;

    /// Placeholder WorkPoolTask callback — overwritten by CompressionStreamImpl::write
    /// before the task is ever scheduled.
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn unset_task_callback(_: *mut WorkPoolTask) {
        unreachable!("WorkPoolTask scheduled before write set its callback");
    }

    // R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
    // interior mutability via `Cell` (Copy) / `JsCell` (non-Copy).
    #[derive(bun_ptr::CellRefCounted)]
    pub(crate) struct NativeZstd {
        // Intrusive single-thread refcount.
        pub(crate) ref_count: Cell<u32>,
        // The global outlives this payload;
        // `BackRef` centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        /// How the pool thread delivers a finished write to the VM.
        pub ticket: Cell<Option<bun_jsc::Ticket>>,
        pub stream: JsCell<Context>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        pub this_value: JsCell<StrongOptional>, // jsc.Strong.Optional
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

    impl NativeZstd {
        pub(crate) fn constructor(cx: &mut JsScope<'_>, mode: u8) -> *mut Self {
            let mode = NodeMode::from_int(mode);
            let stream = Context {
                mode,
                ..Default::default()
            };
            RefPtr::new(Self {
                ref_count: Cell::new(1),
                // JSC_BORROW — the JSGlobalObject outlives this payload (the C++
                // wrapper is owned by that global's heap).
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
                // WorkPoolTask { callback: undefined } — callback is overwritten by
                // CompressionStreamImpl::write before scheduling; placeholder here.
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: unset_task_callback,
                }),
                estimated_external_size: Self::external_size_for(mode),
            })
            .into_raw()
        }

        /// Per-mode external-allocation footprint, fixed at construction.
        fn external_size_for(mode: NodeMode) -> usize {
            match mode {
                NodeMode::ZSTD_COMPRESS => CCtx::SIZE,
                NodeMode::ZSTD_DECOMPRESS => DCtx::SIZE,
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
            pledged_src_size: JsLocal<'_>,
            write_state: JsLocal<'_>,
            process_callback: JsLocal<'_>,
            dictionary: JsLocal<'_>,
        ) -> JsResult<bool> {
            let global = cx.global();
            let this_value = this_value.to_js();
            // Racing an in-flight async write would alias `&mut Context`
            // across threads; a closed `Context` cannot be re-initialized.
            self.throw_unless_idle(global)?;

            let init_params_array_value = init_params_array.to_js();
            let pledged_src_size_value = pledged_src_size.to_js();
            let write_state_value = write_state.to_js();
            let process_callback_value = process_callback.to_js();

            let Some(mut write_state) = write_state_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "writeState",
                    "Uint32Array",
                    write_state_value,
                ));
            };
            if write_state.typed_array_type != jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "writeState",
                    "Uint32Array",
                    write_state_value,
                ));
            }
            // `flush_write_result` writes two u32s into this array, so the
            // caller-supplied array must hold at least 2 elements.
            let write_state_slice = write_state.as_u32();
            if write_state_slice.len() < 2 {
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("writeState must be a Uint32Array with at least 2 elements"),
                    )
                    .throw());
            }
            js::write_result_set_cached(this_value, global, write_state_value);

            let write_js_callback =
                validators::validate_function(global, "processCallback", process_callback_value)?;
            js::write_callback_set_cached(
                this_value,
                global,
                write_js_callback.with_async_context_if_needed(global),
            );

            let mut pledged_src_size: u64 = u64::MAX;
            if pledged_src_size_value.is_number() {
                pledged_src_size = u64::from(validators::validate_uint32(
                    global,
                    pledged_src_size_value,
                    format_args!("pledgedSrcSize"),
                    false,
                )?);
            }

            // Bind the ArrayBuffer view to a local so the borrowed byte_slice()
            // outlives the `stream.init` call below (E0716 otherwise).
            let dictionary_buf;
            let dictionary = if dictionary.is_undefined() {
                None
            } else {
                let dictionary_value = dictionary.to_js();
                dictionary_buf = match dictionary_value.as_array_buffer(global) {
                    Some(buf) => buf,
                    None => {
                        return Err(global.throw_invalid_argument_type_value(
                            "dictionary",
                            "Buffer, TypedArray, or DataView",
                            dictionary_value,
                        ));
                    }
                };
                Some(dictionary_buf.byte_slice())
            };

            let err = self
                .stream
                .with_mut(|s| s.init(pledged_src_size, dictionary));
            if err.is_error() {
                self.emit_error(global, this_value, err);
                return Ok(false);
            }

            let Some(mut params_) = init_params_array_value.as_array_buffer(global) else {
                return Err(global.throw_invalid_argument_type_value(
                    "initParamsArray",
                    "Uint32Array",
                    init_params_array_value,
                ));
            };
            if params_.typed_array_type != jsc::JSType::Uint32Array {
                return Err(global.throw_invalid_argument_type_value(
                    "initParamsArray",
                    "Uint32Array",
                    init_params_array_value,
                ));
            }
            for (i, x) in params_.as_u32().iter().map(|x| x.get()).enumerate() {
                if x == u32::MAX {
                    continue;
                }
                let err_ = self
                    .stream
                    .with_mut(|s| s.set_params(c_uint::try_from(i).expect("int cast"), x));
                if err_.is_error() {
                    self.stream.with_mut(|s| s.close());
                    // The Context is torn down (`mode` is `NONE`); reject any
                    // further operation the way `close()` does.
                    self.closed.set(true);
                    // SAFETY: is_error() ⇔ msg is non-null; it points at a NUL-terminated C string.
                    let msg = unsafe { bun_core::ffi::cstr(err_.msg) }.to_bytes();
                    return Err(global
                        .err(
                            jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                            format_args!("{}", bstr::BStr::new(msg)),
                        )
                        .throw());
                }
            }

            Ok(true)
        }

        pub(crate) fn params(&self) {
            // intentionally left empty
        }
    }

    enum State {
        Compress(Box<CCtx>),
        Decompress(Box<DCtx>),
    }

    pub(crate) struct Context {
        pub(crate) mode: NodeMode,
        state: Option<State>,
        flush: EndDirective,
        // What `set_buffers` was given, which the caller keeps alive until the write is over.
        input: *const [u8],
        input_pos: usize,
        output: *mut [u8],
        output_pos: usize,
        pledged_src_size: u64,
        error: Option<bun_zstd::ErrorCode>,
    }

    impl Default for Context {
        fn default() -> Self {
            Self {
                mode: NodeMode::NONE,
                state: None,
                flush: EndDirective::Continue,
                input: ptr::slice_from_raw_parts(ptr::dangling(), 0),
                input_pos: 0,
                output: ptr::slice_from_raw_parts_mut(ptr::dangling_mut(), 0),
                output_pos: 0,
                pledged_src_size: u64::MAX,
                error: None,
            }
        }
    }

    impl Context {
        const DICTIONARY_LOAD_FAILED: Error = Error::init(
            c"Failed to load zstd dictionary".as_ptr(),
            -1,
            c"ERR_ZLIB_DICTIONARY_LOAD_FAILED".as_ptr(),
        );

        /// The dictionary is copied into the context, so `dictionary` does not
        /// need to outlive this call (unlike brotli's attach APIs).
        pub(crate) fn init(&mut self, pledged_src_size: u64, dictionary: Option<&[u8]>) -> Error {
            // Mirrors node's `state_.reset(ZSTD_createCCtx())`: free the previous
            // context first. `init` is JS-reachable twice on one handle.
            self.state = None;
            let dictionary = dictionary.unwrap_or_default();
            match self.mode {
                NodeMode::ZSTD_COMPRESS => {
                    self.pledged_src_size = pledged_src_size;
                    let mut state = Box::new(CCtx::new());
                    // Node loads the dictionary before setting the pledged size.
                    if state.load_dictionary(dictionary).is_err() {
                        return Self::DICTIONARY_LOAD_FAILED;
                    }
                    if state.set_pledged_src_size(pledged_src_size).is_err() {
                        return Error::init(
                            c"Could not set pledged src size".as_ptr(),
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                        );
                    }
                    self.state = Some(State::Compress(state));
                    Error::OK
                }
                NodeMode::ZSTD_DECOMPRESS => {
                    let mut state = Box::new(DCtx::new());
                    if state.load_dictionary(dictionary).is_err() {
                        return Self::DICTIONARY_LOAD_FAILED;
                    }
                    self.state = Some(State::Decompress(state));
                    Error::OK
                }
                _ => unreachable!(),
            }
        }

        pub(crate) fn set_params(&mut self, key: c_uint, value: u32) -> Error {
            let (key, value) = (key as i32, value as i32);
            let result = match &mut self.state {
                Some(State::Compress(state)) => state.set_parameter(key, value).map(drop),
                Some(State::Decompress(state)) => state.set_parameter(key, value),
                None => unreachable!(),
            };
            if result.is_err() {
                return Error::init(
                    c"Setting parameter failed".as_ptr(),
                    -1,
                    c"ERR_ZSTD_PARAM_SET_FAILED".as_ptr(),
                );
            }
            Error::OK
        }

        pub(crate) fn reset(&mut self) -> Error {
            // Matches node's `ZstdContext::ResetStream()`, which calls `Init()`
            // with its default (empty) dictionary — a reset drops the dictionary.
            // `init` frees the previous context itself.
            self.init(self.pledged_src_size, None)
        }

        pub(crate) fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
            self.input = in_.unwrap_or_default();
            self.input_pos = 0;
            self.output = out.unwrap_or_default();
            self.output_pos = 0;
        }

        pub(crate) fn flush_value_is_valid(flush: u32) -> bool {
            flush <= 2
        }

        pub(crate) fn set_flush(&mut self, flush: c_int) {
            self.flush = match flush {
                0 => EndDirective::Continue,
                1 => EndDirective::Flush,
                2 => EndDirective::End,
                n => unreachable!("invalid ZSTD_EndDirective {n}"),
            };
        }

        const ZSTD_MAGICNUMBER: [u8; 4] = 0xFD2FB528u32.to_le_bytes();
        const ZSTD_MAGIC_SKIPPABLE: [u8; 4] = 0x184D2A50u32.to_le_bytes();

        /// True when `input` begins a zstd/skippable frame magic (or a prefix of one).
        fn is_frame_start(input: &[u8]) -> bool {
            let n = input.len().min(4);
            if n == 0 {
                return false;
            }
            let head = &input[..n];
            *head == Self::ZSTD_MAGICNUMBER[..n]
                || (head[0] & 0xF0 == Self::ZSTD_MAGIC_SKIPPABLE[0]
                    && head[1..] == Self::ZSTD_MAGIC_SKIPPABLE[1..n])
        }

        pub(crate) fn do_work(&mut self) {
            // A handle driven before `init()` has no context.
            let Some(state) = &mut self.state else {
                return;
            };
            let mut input = InBuffer {
                // SAFETY: `set_buffers` got it from a slice that the caller keeps alive until the write is over.
                src: unsafe { &*self.input },
                pos: self.input_pos,
            };
            let mut output = OutBuffer {
                // SAFETY: as above, and nothing else writes to it until then.
                dst: unsafe { &mut *self.output },
                pos: self.output_pos,
            };
            let result = match state {
                State::Compress(state) => {
                    let mut ret = state.compress_stream2(&mut output, &mut input, self.flush);
                    // With workers, a call returns after any progress. `zlib.ts` takes room left in
                    // the output to mean that all the input is consumed.
                    while ret.is_ok()
                        && self.flush == EndDirective::Continue
                        && input.pos < input.src.len()
                        && output.pos < output.dst.len()
                    {
                        ret = state.compress_stream2(&mut output, &mut input, self.flush);
                    }
                    ret
                }
                State::Decompress(state) => {
                    let mut ret = state.decompress_stream(&mut output, &mut input);
                    // 0 is frame-complete; mirrors NativeZlib::do_work_inflate's GUNZIP loop.
                    while ret == Ok(0)
                        && output.pos < output.dst.len()
                        && Self::is_frame_start(&input.src[input.pos..])
                    {
                        ret = state.decompress_stream(&mut output, &mut input);
                    }
                    ret
                }
            };
            self.input_pos = input.pos;
            self.output_pos = output.pos;
            self.error = result.err();
        }

        pub(crate) fn write_result(&self) -> [u32; 2] {
            [
                self.output.len() - self.output_pos,
                self.input.len() - self.input_pos,
            ]
            .map(|n| u32::try_from(n).expect("int cast"))
        }

        pub(crate) fn get_error_info(&mut self) -> Error {
            match self.error.take() {
                None => Error::OK,
                Some(err) => Error {
                    err: err as c_int,
                    msg: err.message().as_ptr(),
                    code: err.name().as_ptr(),
                },
            }
        }

        pub(crate) fn close(&mut self) {
            self.state = None;
            self.mode = NodeMode::NONE;
        }
    }

    crate::__impl_compression_stream!(NativeZstd, Context, js_NativeZstd);
} // mod _impl
