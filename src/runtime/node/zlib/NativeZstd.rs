use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void, CStr};
use core::ptr;

use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, Strong};
use bun_sys::c; // `bun.c` translated-c-headers (ZSTD_* fns/consts live here)
use bun_threading::WorkPoolTask;

use crate::node::node_zlib_binding::{CompressionStream, CountedKeepAlive, Error};
use crate::node::util::validators;
// TODO(port): confirm path — `bun.zlib.NodeMode` re-export; lives alongside this module.
use super::NodeMode;

#[bun_jsc::JsClass]
pub struct NativeZstd {
    // bun.ptr.RefCount(@This(), "ref_count", deinit, .{}) — intrusive single-thread refcount.
    pub ref_count: Cell<u32>,
    // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject; stored raw because the struct is the
    // heap-allocated `m_ctx` payload of a .classes.ts wrapper (no lifetime param in Phase A).
    pub global_this: *mut JSGlobalObject,
    pub stream: Context,
    // LIFETIMES.tsv: BORROW_PARAM → Option<*mut u32> (points into JS Uint32Array backing store)
    pub write_result: Option<*mut u32>,
    pub poll_ref: CountedKeepAlive,
    pub this_value: Strong, // jsc.Strong.Optional
    pub write_in_progress: bool,
    pub pending_close: bool,
    pub pending_reset: bool,
    pub closed: bool,
    pub task: WorkPoolTask,
}

// `pub const ref/deref = RefCount.ref/deref;`
// Provided by bun_ptr::IntrusiveRc<NativeZstd>; the embedded `ref_count` field above is the count.
// TODO(port): wire `bun_ptr::IntrusiveRc` impl (ref/deref) — deref-to-zero invokes Drop then frees Box.

// `pub const js = jsc.Codegen.JSNativeZstd; toJS/fromJS/fromJSDirect = js.*;`
// Provided by `#[bun_jsc::JsClass]` derive — codegen wires to_js / from_js / from_js_direct.

// `const impl = CompressionStream(@This());` and the `pub const write = impl.write; ...` re-exports.
// In Rust these are generic methods of CompressionStream<NativeZstd>:
//   write, run_from_js_thread, write_sync, reset, close, set_on_error, get_on_error, finalize
// TODO(port): expose via `impl CompressionStream for NativeZstd` (trait with default methods) so
// the .classes.ts codegen can resolve them as inherent-looking methods.
pub use CompressionStream::<NativeZstd>::emit_error as _compression_stream_marker;
// (the line above is a Phase-A placeholder so reviewers see the dependency; Phase B replaces with
// the real trait impl / associated fns.)

impl NativeZstd {
    // TODO(port): exact constructor host-fn attribute form
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>> {
        let arguments = frame.arguments_as_array::<1>();

        let mode = arguments[0];
        if !mode.is_number() {
            return global.throw_invalid_argument_type_value("mode", "number", mode);
        }
        let mode_double = mode.as_number();
        if mode_double % 1.0 != 0.0 {
            return global.throw_invalid_argument_type_value("mode", "integer", mode);
        }
        let mode_int: i64 = mode_double as i64;
        if mode_int < 10 || mode_int > 11 {
            return global.throw_range_error(mode_int, jsc::RangeErrorOptions {
                field_name: "mode",
                min: 10,
                max: 11,
            });
        }

        let mut ptr = Box::new(Self {
            ref_count: Cell::new(1), // RefCount.init()
            global_this: global as *const _ as *mut _,
            stream: Context::default(),
            write_result: None,
            poll_ref: CountedKeepAlive::default(),
            this_value: Strong::empty(),
            write_in_progress: false,
            pending_close: false,
            pending_reset: false,
            closed: false,
            // TODO(port): WorkPoolTask { callback: undefined } — callback is set later by CompressionStream
            task: WorkPoolTask::default(),
        });
        // SAFETY: mode_int is range-checked to 10..=11 above; NodeMode is #[repr(u8)].
        ptr.stream.mode = unsafe { NodeMode::from_raw(u8::try_from(mode_int).unwrap()) };
        Ok(ptr)
    }

    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<Self>()
            + match self.stream.mode {
                NodeMode::ZSTD_COMPRESS => 5272, // estimate of bun.c.ZSTD_sizeof_CCtx(self.stream.state)
                NodeMode::ZSTD_DECOMPRESS => 95968, // estimate of bun.c.ZSTD_sizeof_DCtx(self.stream.state)
                _ => 0,
            }
    }

    #[bun_jsc::host_fn(method)]
    pub fn init(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = frame.arguments_as_array::<4>();
        let this_value = frame.this();
        if frame.arguments_count() != 4 {
            return global
                .err(jsc::ErrorCode::MISSING_ARGS, format_args!("init(initParamsArray, pledgedSrcSize, writeState, processCallback)"))
                .throw();
        }

        let init_params_array_value = arguments[0];
        let pledged_src_size_value = arguments[1];
        let write_state_value = arguments[2];
        let process_callback_value = arguments[3];

        let Some(write_state) = write_state_value.as_array_buffer(global) else {
            return global.throw_invalid_argument_type_value("writeState", "Uint32Array", write_state_value);
        };
        if write_state.typed_array_type != jsc::TypedArrayType::Uint32Array {
            return global.throw_invalid_argument_type_value("writeState", "Uint32Array", write_state_value);
        }
        this.write_result = Some(write_state.as_u32().as_mut_ptr());

        let write_js_callback = validators::validate_function(global, "processCallback", process_callback_value)?;
        // js.writeCallbackSetCached — codegen'd cached-property setter on the C++ wrapper.
        Self::js_write_callback_set_cached(this_value, global, write_js_callback.with_async_context_if_needed(global));

        let mut pledged_src_size: u64 = u64::MAX;
        if pledged_src_size_value.is_number() {
            pledged_src_size = u64::from(validators::validate_uint32(
                global,
                pledged_src_size_value,
                "pledgedSrcSize",
                (),
                false,
            )?);
        }

        let err = this.stream.init(pledged_src_size);
        if err.is_error() {
            CompressionStream::<Self>::emit_error(this, global, this_value, err);
            return Ok(JSValue::FALSE);
        }

        let Some(params_) = init_params_array_value.as_array_buffer(global) else {
            return global.throw_invalid_argument_type_value("initParamsArray", "Uint32Array", init_params_array_value);
        };
        if params_.typed_array_type != jsc::TypedArrayType::Uint32Array {
            return global.throw_invalid_argument_type_value("initParamsArray", "Uint32Array", init_params_array_value);
        }
        for (i, &x) in params_.as_u32().iter().enumerate() {
            if x == u32::MAX {
                continue;
            }
            let err_ = this.stream.set_params(c_uint::try_from(i).unwrap(), x);
            if err_.is_error() {
                this.stream.close();
                // SAFETY: err_.msg is Some when is_error() is true; it is a NUL-terminated C string.
                let msg = unsafe { CStr::from_ptr(err_.msg.unwrap()) }.to_bytes();
                return global
                    .err(
                        jsc::ErrorCode::ZLIB_INITIALIZATION_FAILED,
                        format_args!("{}", bstr::BStr::new(msg)),
                    )
                    .throw();
            }
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn params(
        _this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // intentionally left empty
        Ok(JSValue::UNDEFINED)
    }
}

// `fn deinit(this: *@This()) void` — called by RefCount when count hits 0.
// `poll_ref.deinit()` and `this_value` (Strong) cleanup are handled by their own Drop impls.
// `bun.destroy(this)` is the Box free, handled by IntrusiveRc dropping the Box.
impl Drop for NativeZstd {
    fn drop(&mut self) {
        match self.stream.mode {
            NodeMode::ZSTD_COMPRESS | NodeMode::ZSTD_DECOMPRESS => self.stream.close(),
            _ => {}
        }
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
            flush: c::ZSTD_e_continue,
            input: c::ZSTD_inBuffer { src: ptr::null(), size: 0, pos: 0 },
            output: c::ZSTD_outBuffer { dst: ptr::null_mut(), size: 0, pos: 0 },
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
                // SAFETY: FFI call with no preconditions.
                let state = unsafe { c::ZSTD_createCCtx() };
                if state.is_null() {
                    return Error::init(
                        "Could not initialize zstd instance",
                        -1,
                        "ERR_ZLIB_INITIALIZATION_FAILED",
                    );
                }
                self.state = Some(state.cast());
                // SAFETY: state is non-null (checked above).
                let result = unsafe { c::ZSTD_CCtx_setPledgedSrcSize(state, pledged_src_size) };
                // SAFETY: ZSTD_isError is a pure fn on usize.
                if unsafe { c::ZSTD_isError(result) } > 0 {
                    // SAFETY: state is a valid CCtx allocated above.
                    let _ = unsafe { c::ZSTD_freeCCtx(state) };
                    self.state = None;
                    return Error::init(
                        "Could not set pledged src size",
                        -1,
                        "ERR_ZLIB_INITIALIZATION_FAILED",
                    );
                }
                Error::OK
            }
            NodeMode::ZSTD_DECOMPRESS => {
                // SAFETY: FFI call with no preconditions.
                let state = unsafe { c::ZSTD_createDCtx() };
                if state.is_null() {
                    return Error::init(
                        "Could not initialize zstd instance",
                        -1,
                        "ERR_ZLIB_INITIALIZATION_FAILED",
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
                // SAFETY: ZSTD_isError is a pure fn on usize.
                if unsafe { c::ZSTD_isError(result) } > 0 {
                    return Error::init("Setting parameter failed", -1, "ERR_ZSTD_PARAM_SET_FAILED");
                }
                Error::OK
            }
            NodeMode::ZSTD_DECOMPRESS => {
                // SAFETY: state is a valid DCtx set by init().
                let result = unsafe {
                    c::ZSTD_DCtx_setParameter(self.state_ptr().cast(), key, value as c_int)
                };
                // SAFETY: ZSTD_isError is a pure fn on usize.
                if unsafe { c::ZSTD_isError(result) } > 0 {
                    return Error::init("Setting parameter failed", -1, "ERR_ZSTD_PARAM_SET_FAILED");
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
        self.output.dst = out.as_ref().map_or(ptr::null_mut(), |p| p.as_ptr() as *mut c_void);
        self.output.size = out.as_ref().map_or(0, |p| p.len());
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
                    &mut self.output,
                    &mut self.input,
                    // TODO(port): @intCast c_int → ZSTD_EndDirective (c_uint); verify signedness
                    c_uint::try_from(self.flush).unwrap(),
                )
            },
            // SAFETY: state is a valid DCtx.
            NodeMode::ZSTD_DECOMPRESS => unsafe {
                c::ZSTD_decompressStream(self.state_ptr().cast(), &mut self.output, &mut self.input)
            },
            _ => unreachable!(),
        };
    }

    pub fn update_write_result(&self, avail_in: &mut u32, avail_out: &mut u32) {
        *avail_in = u32::try_from(self.input.size - self.input.pos).unwrap();
        *avail_out = u32::try_from(self.output.size - self.output.pos).unwrap();
    }

    pub fn get_error_info(&mut self) -> Error {
        // PORT NOTE: reshaped `defer this.remaining = 0;` — compute result, then clear, then return.
        // SAFETY: ZSTD_getErrorCode is a pure fn on usize.
        let err = unsafe { c::ZSTD_getErrorCode(self.remaining) };
        let result = if err == 0 {
            Error::OK
        } else {
            Error {
                err: c_int::try_from(err).unwrap(),
                // SAFETY: ZSTD_getErrorString returns a static NUL-terminated string for any code.
                msg: Some(unsafe { c::ZSTD_getErrorString(err) }),
                code: match err {
                    c::ZSTD_error_no_error => "ZSTD_error_no_error",
                    c::ZSTD_error_GENERIC => "ZSTD_error_GENERIC",
                    c::ZSTD_error_prefix_unknown => "ZSTD_error_prefix_unknown",
                    c::ZSTD_error_version_unsupported => "ZSTD_error_version_unsupported",
                    c::ZSTD_error_frameParameter_unsupported => "ZSTD_error_frameParameter_unsupported",
                    c::ZSTD_error_frameParameter_windowTooLarge => "ZSTD_error_frameParameter_windowTooLarge",
                    c::ZSTD_error_corruption_detected => "ZSTD_error_corruption_detected",
                    c::ZSTD_error_checksum_wrong => "ZSTD_error_checksum_wrong",
                    c::ZSTD_error_literals_headerWrong => "ZSTD_error_literals_headerWrong",
                    c::ZSTD_error_dictionary_corrupted => "ZSTD_error_dictionary_corrupted",
                    c::ZSTD_error_dictionary_wrong => "ZSTD_error_dictionary_wrong",
                    c::ZSTD_error_dictionaryCreation_failed => "ZSTD_error_dictionaryCreation_failed",
                    c::ZSTD_error_parameter_unsupported => "ZSTD_error_parameter_unsupported",
                    c::ZSTD_error_parameter_combination_unsupported => "ZSTD_error_parameter_combination_unsupported",
                    c::ZSTD_error_parameter_outOfBound => "ZSTD_error_parameter_outOfBound",
                    c::ZSTD_error_tableLog_tooLarge => "ZSTD_error_tableLog_tooLarge",
                    c::ZSTD_error_maxSymbolValue_tooLarge => "ZSTD_error_maxSymbolValue_tooLarge",
                    c::ZSTD_error_maxSymbolValue_tooSmall => "ZSTD_error_maxSymbolValue_tooSmall",
                    c::ZSTD_error_stabilityCondition_notRespected => "ZSTD_error_stabilityCondition_notRespected",
                    c::ZSTD_error_stage_wrong => "ZSTD_error_stage_wrong",
                    c::ZSTD_error_init_missing => "ZSTD_error_init_missing",
                    c::ZSTD_error_memory_allocation => "ZSTD_error_memory_allocation",
                    c::ZSTD_error_workSpace_tooSmall => "ZSTD_error_workSpace_tooSmall",
                    c::ZSTD_error_dstSize_tooSmall => "ZSTD_error_dstSize_tooSmall",
                    c::ZSTD_error_srcSize_wrong => "ZSTD_error_srcSize_wrong",
                    c::ZSTD_error_dstBuffer_null => "ZSTD_error_dstBuffer_null",
                    c::ZSTD_error_noForwardProgress_destFull => "ZSTD_error_noForwardProgress_destFull",
                    c::ZSTD_error_noForwardProgress_inputEmpty => "ZSTD_error_noForwardProgress_inputEmpty",
                    _ => "ZSTD_error_GENERIC",
                },
            }
        };
        self.remaining = 0;
        result
    }

    pub fn close(&mut self) {
        let _ = match self.mode {
            // SAFETY: state is a valid CCtx/DCtx for this mode.
            NodeMode::ZSTD_COMPRESS => unsafe {
                c::ZSTD_CCtx_reset(self.state_ptr().cast(), c::ZSTD_reset_session_and_parameters)
            },
            NodeMode::ZSTD_DECOMPRESS => unsafe {
                c::ZSTD_DCtx_reset(self.state_ptr().cast(), c::ZSTD_reset_session_and_parameters)
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/zlib/NativeZstd.zig (281 lines)
//   confidence: medium
//   todos:      6
//   notes:      CompressionStream<Self> method re-exports + IntrusiveRc wiring deferred; global.err()/throw_* helper names need Phase-B alignment with bun_jsc API
// ──────────────────────────────────────────────────────────────────────────
