pub use _impl::{Context, NativeZstd};

mod _impl {
    use core::cell::Cell;
    use core::ffi::{CStr, c_int, c_uint, c_void};
    use core::{mem, ptr};

    use bun_jsc::{
        self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsResult, StrongOptional,
        WorkPoolTask,
    };
    use bun_zstd::c; // `bun.c` translated-c-headers (ZSTD_* fns/consts live here)

    use crate::node::node_zlib_binding::{CompressionStream, CountedKeepAlive, Error};
    use crate::node::util::validators;
    // `bun.zlib.NodeMode` — #[repr(u8)] enum shared by all native-zlib stream types.
    use bun_zlib::NodeMode;

    // `jsc.Codegen.JSNativeZstd` cached-property accessors (`mod js`) are emitted
    // by `__impl_compression_stream!` below — wraps the
    // `NativeZstdPrototype__${prop}{Get,Set}CachedValue` C++ symbols emitted by
    // `src/codegen/generate-classes.ts` for `values: [...]` in `zlib.classes.ts`.

    /// Placeholder WorkPoolTask callback — overwritten by CompressionStream::write
    /// before the task is ever scheduled (mirrors Zig `.{ .callback = undefined }`).
    /// Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    /// struct-init site; the body never dereferences the pointer.
    fn unset_task_callback(_: *mut WorkPoolTask) {
        unreachable!("WorkPoolTask scheduled before CompressionStream set its callback");
    }

    // R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
    // interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
    // `host_fn_this` shim still passes `&mut NativeZstd` until Phase 1 lands —
    // `&mut T` auto-reborrows to `&T` so the impls below compile against either.
    #[bun_jsc::JsClass]
    #[derive(bun_ptr::CellRefCounted)]
    pub struct NativeZstd {
        // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread refcount.
        pub ref_count: Cell<u32>,
        // LIFETIMES.tsv: JSC_BORROW. The global outlives this m_ctx payload;
        // `BackRef` centralises the single unsafe deref so the trait impl is safe.
        pub global_this: bun_ptr::BackRef<JSGlobalObject>,
        pub stream: JsCell<Context>,
        // LIFETIMES.tsv: BORROW_PARAM → Option<*mut u32> (points into JS Uint32Array backing store)
        pub write_result: Cell<Option<*mut u32>>,
        pub poll_ref: JsCell<CountedKeepAlive>,
        pub this_value: JsCell<StrongOptional>, // jsc.Strong.Optional
        pub write_in_progress: Cell<bool>,
        pub pending_close: Cell<bool>,
        pub pending_reset: Cell<bool>,
        pub closed: Cell<bool>,
        pub task: JsCell<WorkPoolTask>,
    }

    // `pub const ref/deref = RefCount.ref/deref;` — wired via `CompressionStreamImpl::{ref_,deref}`
    // below; deref-to-zero reconstitutes the Box (running Drop) and frees, mirroring `bun.destroy`.
    //
    // `pub const js = jsc.Codegen.JSNativeZstd; toJS/fromJS/fromJSDirect = js.*;` — provided by
    // `#[bun_jsc::JsClass]` derive (wires to_js / from_js / from_js_direct).
    //
    // `const impl = CompressionStream(@This());` and the `pub const write = impl.write; ...` re-exports
    // resolve through the `CompressionStreamImpl` trait below — `CompressionStream::<NativeZstd>` then
    // supplies write / run_from_js_thread / write_sync / reset / close / set_on_error / get_on_error /
    // finalize as the generic mixin, just like the Zig comptime fn.

    impl NativeZstd {
        // C-ABI shim is emitted by `#[bun_jsc::JsClass]` (calls `<Self>::constructor`);
        // no `#[host_fn]` here — that macro's free-fn arm would emit a bare `constructor(...)` call.
        pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
            let arguments = frame.arguments_as_array::<1>();

            let mode = arguments[0];
            if !mode.is_number() {
                return Err(global.throw_invalid_argument_type_value("mode", "number", mode));
            }
            let mode_double = mode.as_number();
            if mode_double % 1.0 != 0.0 {
                return Err(global.throw_invalid_argument_type_value("mode", "integer", mode));
            }
            let mode_int: i64 = mode_double as i64;
            if mode_int < 10 || mode_int > 11 {
                return Err(global.throw_range_error(
                    mode_int,
                    jsc::RangeErrorOptions {
                        field_name: b"mode",
                        min: 10,
                        max: 11,
                        msg: b"",
                    },
                ));
            }

            let mut stream = Context::default();
            stream.mode = NodeMode::from_int(mode_int as u8);
            Ok(Box::new(Self {
                ref_count: Cell::new(1), // RefCount.init()
                // JSC_BORROW — the JSGlobalObject outlives this payload (the C++
                // wrapper is owned by that global's heap).
                global_this: bun_ptr::BackRef::new(global),
                stream: JsCell::new(stream),
                write_result: Cell::new(None),
                poll_ref: JsCell::new(CountedKeepAlive::default()),
                this_value: JsCell::new(StrongOptional::empty()),
                write_in_progress: Cell::new(false),
                pending_close: Cell::new(false),
                pending_reset: Cell::new(false),
                closed: Cell::new(false),
                // WorkPoolTask { callback: undefined } — callback is overwritten by
                // CompressionStream::write before scheduling; placeholder here.
                task: JsCell::new(WorkPoolTask {
                    node: Default::default(),
                    callback: unset_task_callback,
                }),
            }))
        }

        pub fn estimated_size(&self) -> usize {
            core::mem::size_of::<Self>()
                + match self.stream.get().mode {
                    NodeMode::ZSTD_COMPRESS => 5272, // estimate of bun.c.ZSTD_sizeof_CCtx(self.stream.state)
                    NodeMode::ZSTD_DECOMPRESS => 95968, // estimate of bun.c.ZSTD_sizeof_DCtx(self.stream.state)
                    _ => 0,
                }
        }

        #[bun_jsc::host_fn(method)]
        pub fn init(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
            let arguments = frame.arguments_as_array::<4>();
            let this_value = frame.this();
            if frame.arguments_count() != 4 {
                return Err(global
                    .err(
                        jsc::ErrorCode::MISSING_ARGS,
                        format_args!(
                            "init(initParamsArray, pledgedSrcSize, writeState, processCallback)"
                        ),
                    )
                    .throw());
            }

            let init_params_array_value = arguments[0];
            let pledged_src_size_value = arguments[1];
            let write_state_value = arguments[2];
            let process_callback_value = arguments[3];

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
            self.write_result
                .set(Some(write_state.as_u32().as_mut_ptr()));

            let write_js_callback =
                validators::validate_function(global, "processCallback", process_callback_value)?;
            // js.writeCallbackSetCached — codegen'd cached-property setter on the C++ wrapper.
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

            let err = self.stream.with_mut(|s| s.init(pledged_src_size));
            if err.is_error() {
                CompressionStream::<Self>::emit_error(self, global, this_value, err);
                return Ok(JSValue::FALSE);
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
            for (i, &x) in params_.as_u32().iter().enumerate() {
                if x == u32::MAX {
                    continue;
                }
                let err_ = self
                    .stream
                    .with_mut(|s| s.set_params(c_uint::try_from(i).expect("int cast"), x));
                if err_.is_error() {
                    self.stream.with_mut(|s| s.close());
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

            Ok(JSValue::TRUE)
        }

        #[bun_jsc::host_fn(method)]
        pub fn params(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
            // intentionally left empty
            Ok(JSValue::UNDEFINED)
        }
    }

    // `fn deinit(this: *@This()) void` — called by RefCount when count hits 0.
    // `poll_ref.deinit()` and `this_value` (Strong) cleanup are handled by their own Drop impls.
    // `bun.destroy(this)` is the Box free, handled by IntrusiveRc dropping the Box.
    impl Drop for NativeZstd {
        fn drop(&mut self) {
            self.stream.with_mut(|s| match s.mode {
                NodeMode::ZSTD_COMPRESS | NodeMode::ZSTD_DECOMPRESS => s.close(),
                _ => {}
            });
        }
    }

    pub struct Context {
        pub mode: NodeMode,
        // LIFETIMES.tsv: FFI → Option<*mut c_void> (ZSTD_createCCtx/DCtx; freed in deinit_state)
        pub state: Option<*mut c_void>,
        pub flush: c_int,
        pub input: c::ZSTD_inBuffer,
        pub output: c::ZSTD_outBuffer,
        pub pledged_src_size: u64,
        pub remaining: u64,
    }

    impl Default for Context {
        fn default() -> Self {
            Self {
                mode: NodeMode::NONE,
                state: None,
                flush: c::ZSTD_e_continue as c_int,
                input: c::ZSTD_inBuffer {
                    src: ptr::null(),
                    size: 0,
                    pos: 0,
                },
                output: c::ZSTD_outBuffer {
                    dst: ptr::null_mut(),
                    size: 0,
                    pos: 0,
                },
                pledged_src_size: u64::MAX,
                remaining: 0,
            }
        }
    }

    impl Context {
        pub fn init(&mut self, pledged_src_size: u64) -> Error {
            match self.mode {
                NodeMode::ZSTD_COMPRESS => {
                    self.pledged_src_size = pledged_src_size;
                    let state = c::ZSTD_createCCtx();
                    if state.is_null() {
                        return Error::init(
                            c"Could not initialize zstd instance".as_ptr(),
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                        );
                    }
                    self.state = Some(state.cast());
                    // SAFETY: state is non-null (checked above).
                    let result =
                        unsafe { c::ZSTD_CCtx_setPledgedSrcSize(state, pledged_src_size as _) };
                    if c::ZSTD_isError(result) > 0 {
                        // SAFETY: state is a valid CCtx allocated above.
                        let _ = unsafe { c::ZSTD_freeCCtx(state) };
                        self.state = None;
                        return Error::init(
                            c"Could not set pledged src size".as_ptr(),
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                        );
                    }
                    Error::OK
                }
                NodeMode::ZSTD_DECOMPRESS => {
                    let state = c::ZSTD_createDCtx();
                    if state.is_null() {
                        return Error::init(
                            c"Could not initialize zstd instance".as_ptr(),
                            -1,
                            c"ERR_ZLIB_INITIALIZATION_FAILED".as_ptr(),
                        );
                    }
                    self.state = Some(state.cast());
                    Error::OK
                }
                _ => unreachable!(),
            }
        }

        pub fn set_params(&mut self, key: c_uint, value: u32) -> Error {
            match self.mode {
                NodeMode::ZSTD_COMPRESS => {
                    // SAFETY: state is a valid CCtx set by init(); @bitCast u32→c_int is a same-size reinterpret.
                    let result = unsafe {
                        c::ZSTD_CCtx_setParameter(self.state_ptr().cast(), key, value as c_int)
                    };
                    if c::ZSTD_isError(result) > 0 {
                        return Error::init(
                            c"Setting parameter failed".as_ptr(),
                            -1,
                            c"ERR_ZSTD_PARAM_SET_FAILED".as_ptr(),
                        );
                    }
                    Error::OK
                }
                NodeMode::ZSTD_DECOMPRESS => {
                    // SAFETY: state is a valid DCtx set by init().
                    let result = unsafe {
                        c::ZSTD_DCtx_setParameter(self.state_ptr().cast(), key, value as c_int)
                    };
                    if c::ZSTD_isError(result) > 0 {
                        return Error::init(
                            c"Setting parameter failed".as_ptr(),
                            -1,
                            c"ERR_ZSTD_PARAM_SET_FAILED".as_ptr(),
                        );
                    }
                    Error::OK
                }
                _ => unreachable!(),
            }
        }

        pub fn reset(&mut self) -> Error {
            if self.state.is_some() {
                self.deinit_state();
            }
            self.init(self.pledged_src_size)
        }

        /// Frees the Zstd encoder/decoder state without changing mode.
        /// Use close() for full cleanup that also sets mode to NONE.
        fn deinit_state(&mut self) {
            let _ = match self.mode {
                // SAFETY: state was allocated by ZSTD_create{C,D}Ctx and not yet freed.
                NodeMode::ZSTD_COMPRESS => unsafe { c::ZSTD_freeCCtx(self.state_ptr().cast()) },
                NodeMode::ZSTD_DECOMPRESS => unsafe { c::ZSTD_freeDCtx(self.state_ptr().cast()) },
                _ => unreachable!(),
            };
            self.state = None;
        }

        pub fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) {
            self.input.src = in_.map_or(ptr::null(), |p| p.as_ptr().cast());
            self.input.size = in_.map_or(0, |p| p.len());
            self.input.pos = 0;
            match out {
                Some(p) => {
                    self.output.size = p.len();
                    self.output.dst = p.as_mut_ptr().cast();
                }
                None => {
                    self.output.size = 0;
                    self.output.dst = ptr::null_mut();
                }
            }
            self.output.pos = 0;
        }

        pub fn set_flush(&mut self, flush: c_int) {
            self.flush = flush;
        }

        pub fn do_work(&mut self) {
            self.remaining = match self.mode {
                // SAFETY: state is a valid CCtx; input/output point to caller-kept-alive buffers (set_buffers).
                NodeMode::ZSTD_COMPRESS => unsafe {
                    c::ZSTD_compressStream2(
                        self.state_ptr().cast(),
                        &raw mut self.output,
                        &raw mut self.input,
                        // @intCast c_int → ZSTD_EndDirective (c_uint)
                        self.flush as c_uint,
                    )
                },
                // SAFETY: state is a valid DCtx.
                NodeMode::ZSTD_DECOMPRESS => unsafe {
                    c::ZSTD_decompressStream(
                        self.state_ptr().cast(),
                        &raw mut self.output,
                        &raw mut self.input,
                    )
                },
                _ => unreachable!(),
            } as u64;
        }

        pub fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
            *avail_in = u32::try_from(self.input.size - self.input.pos).expect("int cast");
            *avail_out = u32::try_from(self.output.size - self.output.pos).expect("int cast");
        }

        pub fn get_error_info(&mut self) -> Error {
            // PORT NOTE: reshaped `defer this.remaining = 0;` — compute result, then clear, then return.
            let err = c::ZSTD_getErrorCode(self.remaining as usize);
            let result = if err == 0 {
                Error::OK
            } else {
                Error {
                    err: err as c_int,
                    msg: c::ZSTD_getErrorString(err),
                    code: match err {
                        c::ZSTD_error_no_error => c"ZSTD_error_no_error",
                        c::ZSTD_error_GENERIC => c"ZSTD_error_GENERIC",
                        c::ZSTD_error_prefix_unknown => c"ZSTD_error_prefix_unknown",
                        c::ZSTD_error_version_unsupported => c"ZSTD_error_version_unsupported",
                        c::ZSTD_error_frameParameter_unsupported => {
                            c"ZSTD_error_frameParameter_unsupported"
                        }
                        c::ZSTD_error_frameParameter_windowTooLarge => {
                            c"ZSTD_error_frameParameter_windowTooLarge"
                        }
                        c::ZSTD_error_corruption_detected => c"ZSTD_error_corruption_detected",
                        c::ZSTD_error_checksum_wrong => c"ZSTD_error_checksum_wrong",
                        c::ZSTD_error_literals_headerWrong => c"ZSTD_error_literals_headerWrong",
                        c::ZSTD_error_dictionary_corrupted => c"ZSTD_error_dictionary_corrupted",
                        c::ZSTD_error_dictionary_wrong => c"ZSTD_error_dictionary_wrong",
                        c::ZSTD_error_dictionaryCreation_failed => {
                            c"ZSTD_error_dictionaryCreation_failed"
                        }
                        c::ZSTD_error_parameter_unsupported => c"ZSTD_error_parameter_unsupported",
                        c::ZSTD_error_parameter_combination_unsupported => {
                            c"ZSTD_error_parameter_combination_unsupported"
                        }
                        c::ZSTD_error_parameter_outOfBound => c"ZSTD_error_parameter_outOfBound",
                        c::ZSTD_error_tableLog_tooLarge => c"ZSTD_error_tableLog_tooLarge",
                        c::ZSTD_error_maxSymbolValue_tooLarge => {
                            c"ZSTD_error_maxSymbolValue_tooLarge"
                        }
                        c::ZSTD_error_maxSymbolValue_tooSmall => {
                            c"ZSTD_error_maxSymbolValue_tooSmall"
                        }
                        c::ZSTD_error_stabilityCondition_notRespected => {
                            c"ZSTD_error_stabilityCondition_notRespected"
                        }
                        c::ZSTD_error_stage_wrong => c"ZSTD_error_stage_wrong",
                        c::ZSTD_error_init_missing => c"ZSTD_error_init_missing",
                        c::ZSTD_error_memory_allocation => c"ZSTD_error_memory_allocation",
                        c::ZSTD_error_workSpace_tooSmall => c"ZSTD_error_workSpace_tooSmall",
                        c::ZSTD_error_dstSize_tooSmall => c"ZSTD_error_dstSize_tooSmall",
                        c::ZSTD_error_srcSize_wrong => c"ZSTD_error_srcSize_wrong",
                        c::ZSTD_error_dstBuffer_null => c"ZSTD_error_dstBuffer_null",
                        c::ZSTD_error_noForwardProgress_destFull => {
                            c"ZSTD_error_noForwardProgress_destFull"
                        }
                        c::ZSTD_error_noForwardProgress_inputEmpty => {
                            c"ZSTD_error_noForwardProgress_inputEmpty"
                        }
                        _ => c"ZSTD_error_GENERIC",
                    }
                    .as_ptr(),
                }
            };
            self.remaining = 0;
            result
        }

        pub fn close(&mut self) {
            let _ = match self.mode {
                // SAFETY: state is a valid CCtx/DCtx for this mode.
                NodeMode::ZSTD_COMPRESS => unsafe {
                    c::ZSTD_CCtx_reset(
                        self.state_ptr().cast(),
                        c::ZSTD_reset_session_and_parameters,
                    )
                },
                NodeMode::ZSTD_DECOMPRESS => unsafe {
                    c::ZSTD_DCtx_reset(
                        self.state_ptr().cast(),
                        c::ZSTD_reset_session_and_parameters,
                    )
                },
                _ => unreachable!(),
            };
            self.deinit_state();
            self.mode = NodeMode::NONE;
        }

        #[inline]
        fn state_ptr(&self) -> *mut c_void {
            // Mirrors Zig `@ptrCast(this.state)` on `?*anyopaque` — passes null through if unset.
            self.state.unwrap_or(ptr::null_mut())
        }
    }

    // ─── CompressionStream mixin wiring ───────────────────────────────────────
    // Stamps `impl CompressionContext for Context`, `impl Taskable`/
    // `CompressionStreamImpl for NativeZstd`, and `pub mod js { … }` so
    // `CompressionStream::<NativeZstd>::*` (write/writeSync/reset/close/
    // emit_error/…) can reach this struct's fields the way the Zig comptime mixin
    // did via duck-typed `this.field` access.
    crate::__impl_compression_stream!(NativeZstd, Context, "NativeZstd");
    crate::__compression_stream_mixin_reexports!(NativeZstd);
} // mod _impl

// ported from: src/runtime/node/zlib/NativeZstd.zig
