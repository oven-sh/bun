use core::ffi::{c_char, c_int};
use core::marker::PhantomData;
use core::mem::offset_of;

use bun_aio::KeepAlive;
use bun_core::Output;
use bun_jsc::{
    self as jsc, CallFrame, ConcurrentTask, JSGlobalObject, JSValue, JsResult, Task, VirtualMachine,
};
use bun_runtime::node::Buffer;
use bun_str::{self, String as BunString, ZigString};
use bun_threading::{WorkPool, WorkPoolTask};
use bun_zlib;

bun_output::declare_scope!(zlib, hidden);

#[bun_jsc::host_fn]
pub fn crc32(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(2).ptr;

    let data: ZigString::Slice = 'blk: {
        let data: JSValue = arguments[0];

        if data.is_empty() {
            return global_this.throw_invalid_argument_type_value(
                "data",
                "string or an instance of Buffer, TypedArray, or DataView",
                JSValue::UNDEFINED,
            );
        }
        if data.is_string() {
            break 'blk data.as_string().to_slice(global_this);
        }
        let Some(buffer) = Buffer::from_js(global_this, data) else {
            let ty_str = data.js_type_string(global_this).to_slice(global_this);
            // ty_str drops at end of scope
            return global_this
                .err_invalid_arg_type(
                    "The \"data\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {}",
                    format_args!("{}", bstr::BStr::new(ty_str.slice())),
                )
                .throw();
        };
        break 'blk ZigString::Slice::from_utf8_never_free(buffer.slice());
    };
    // `data` drops at end of scope

    let value: u32 = 'blk: {
        let value: JSValue = arguments[1];
        if value.is_empty() {
            break 'blk 0;
        }
        if !value.is_number() {
            return global_this.throw_invalid_argument_type_value("value", "number", value);
        }
        let valuef = value.as_number();
        let min = 0;
        let max = u32::MAX;

        if valuef.floor() != valuef {
            return global_this
                .err_out_of_range(
                    "The value of \"{}\" is out of range. It must be an integer. Received {}",
                    format_args!("{} {}", "value", valuef),
                )
                .throw();
            // TODO(port): ERR(.OUT_OF_RANGE, fmt, args) — exact formatting API for ERR_* macros
        }
        if valuef < min as f64 || valuef > max as f64 {
            return global_this
                .err_out_of_range(
                    "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                    format_args!("{} {} {} {}", "value", min, max, valuef),
                )
                .throw();
        }
        break 'blk valuef as u32;
    };

    // crc32 returns a u64 but the data will always be within a u32 range so the outer cast is always safe.
    let slice_u8 = data.slice();
    Ok(JSValue::js_number(
        u32::try_from(bun_zlib::crc32(
            value,
            slice_u8.as_ptr(),
            u32::try_from(slice_u8.len()).unwrap(),
        ))
        .unwrap(),
    ))
}

/// Zig: `fn CompressionStream(comptime T: type) type { return struct { ... } }`
/// This is a mixin: methods all take `this: *T` and access fields on `T`
/// (write_in_progress, pending_close, pending_reset, closed, stream, this_value,
/// write_result, task, poll_ref, globalThis) plus `T.js.*` codegen accessors and
/// `T.ref()/deref()`.
// TODO(port): Phase B — decide between (a) marker struct + associated fns (current),
// or (b) extension trait with required accessor methods. Field accesses on `T` below
// will not compile without a trait bound exposing those fields.
pub struct CompressionStream<T>(PhantomData<T>);

impl<T> CompressionStream<T> {
    #[bun_jsc::host_fn(method)]
    pub fn write(
        this: &mut T,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_undef(7).slice();

        if arguments.len() != 7 {
            return global_this
                .err_missing_args("write(flush, in, in_off, in_len, out, out_off, out_len)")
                .throw();
        }

        let mut in_off: u32 = 0;
        let mut in_len: u32 = 0;
        let mut out_off: u32;
        let mut out_len: u32;
        let mut flush: u32;
        let mut in_: Option<&[u8]> = None;
        let mut out: Option<&mut [u8]>;

        let this_value = callframe.this();

        if arguments[0].is_undefined() {
            return global_this
                .err_invalid_arg_value("flush value is required")
                .throw();
        }
        flush = arguments[0].to_u32();
        if bun_zlib::FlushValue::try_from(flush).is_err() {
            return global_this
                .err_invalid_arg_value("Invalid flush value")
                .throw();
        }

        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            let Some(in_buf) = arguments[1].as_array_buffer(global_this) else {
                return global_this
                    .err_invalid_arg_type("The \"in\" argument must be a TypedArray or DataView")
                    .throw();
            };
            in_off = arguments[2].to_u32();
            in_len = arguments[3].to_u32();
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return global_this
                    .err_out_of_range(format_args!(
                        "in_off + in_len ({}) exceeds input buffer length ({})",
                        in_off as usize + in_len as usize,
                        in_buf.byte_len
                    ))
                    .throw();
            }
            in_ = Some(&in_buf.byte_slice()[in_off as usize..][..in_len as usize]);
        }

        let Some(out_buf) = arguments[4].as_array_buffer(global_this) else {
            return global_this
                .err_invalid_arg_type("The \"out\" argument must be a TypedArray or DataView")
                .throw();
        };
        out_off = arguments[5].to_u32();
        out_len = arguments[6].to_u32();
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return global_this
                .err_out_of_range(format_args!(
                    "out_off + out_len ({}) exceeds output buffer length ({})",
                    out_off as usize + out_len as usize,
                    out_buf.byte_len
                ))
                .throw();
        }
        out = Some(&mut out_buf.byte_slice()[out_off as usize..][..out_len as usize]);

        if this.write_in_progress {
            return global_this
                .err_invalid_state("Write already in progress")
                .throw();
        }
        if this.pending_close {
            return global_this.err_invalid_state("Pending close").throw();
        }
        this.write_in_progress = true;
        this.ref_();

        this.stream.set_buffers(in_, out);
        this.stream.set_flush(i32::try_from(flush).unwrap());

        // Only create the strong handle when we have a pending write
        // And make sure to clear it when we are done.
        this.this_value.set(global_this, this_value);

        let vm = global_this.bun_vm();
        this.task = WorkPoolTask {
            callback: Self::async_job_run_task,
        };
        this.poll_ref.ref_(vm);
        WorkPool::schedule(&mut this.task);

        Ok(JSValue::UNDEFINED)
    }

    // Zig: nested `const AsyncJob = struct { ... }` — namespacing only.
    fn async_job_run_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to T.task; recover &mut T via container_of
        let this: &mut T = unsafe {
            &mut *(task as *mut u8)
                .sub(offset_of!(T, task))
                .cast::<T>()
        };
        Self::async_job_run(this);
    }

    fn async_job_run(this: &mut T) {
        let global_this: &JSGlobalObject = this.global_this;
        let vm = global_this.bun_vm_concurrently();

        this.stream.do_work();

        vm.enqueue_task_concurrent(ConcurrentTask::create(Task::init(this)));
    }

    pub fn run_from_js_thread(this: &mut T) {
        let global: &JSGlobalObject = this.global_this;
        let vm = global.bun_vm();
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref(); defer this.poll_ref.unref(vm);`
        // which run at scope exit in reverse order. We use scopeguard to preserve ordering.
        let guard = scopeguard::guard((), |_| {
            this.poll_ref.unref(vm);
            this.deref();
        });
        // TODO(port): scopeguard captures &mut this across the body below — Phase B may need
        // to restructure (move unref/deref to explicit tail calls on every return path).

        this.write_in_progress = false;

        // Clear the strong handle before we call any callbacks.
        let Some(this_value) = this.this_value.try_swap() else {
            bun_output::scoped_log!(zlib, "this_value is null in runFromJSThread");
            return;
        };

        this_value.ensure_still_alive();

        if !Self::check_error(this, global, this_value) {
            return;
        }

        let write_result = this.write_result.as_mut().unwrap();
        this.stream
            .update_write_result(&mut write_result[1], &mut write_result[0]);
        this_value.ensure_still_alive();

        let write_callback: JSValue = T::js::write_callback_get_cached(this_value).unwrap();

        vm.event_loop()
            .run_callback(write_callback, global, this_value, &[]);

        if this.pending_reset {
            Self::reset_internal(this, global, this_value);
        }
        if this.pending_close {
            let _ = Self::close_internal(this);
        }

        drop(guard);
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_sync(
        this: &mut T,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_undef(7).slice();

        if arguments.len() != 7 {
            return global_this
                .err_missing_args("writeSync(flush, in, in_off, in_len, out, out_off, out_len)")
                .throw();
        }

        let mut in_off: u32 = 0;
        let mut in_len: u32 = 0;
        let mut out_off: u32;
        let mut out_len: u32;
        let mut flush: u32;
        let mut in_: Option<&[u8]> = None;
        let mut out: Option<&mut [u8]>;

        if arguments[0].is_undefined() {
            return global_this
                .err_invalid_arg_value("flush value is required")
                .throw();
        }
        flush = arguments[0].to_u32();
        if bun_zlib::FlushValue::try_from(flush).is_err() {
            return global_this
                .err_invalid_arg_value("Invalid flush value")
                .throw();
        }

        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            let Some(in_buf) = arguments[1].as_array_buffer(global_this) else {
                return global_this
                    .err_invalid_arg_type("The \"in\" argument must be a TypedArray or DataView")
                    .throw();
            };
            in_off = arguments[2].to_u32();
            in_len = arguments[3].to_u32();
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return global_this
                    .err_out_of_range(format_args!(
                        "in_off + in_len ({}) exceeds input buffer length ({})",
                        in_off as usize + in_len as usize,
                        in_buf.byte_len
                    ))
                    .throw();
            }
            in_ = Some(&in_buf.byte_slice()[in_off as usize..][..in_len as usize]);
        }

        let Some(out_buf) = arguments[4].as_array_buffer(global_this) else {
            return global_this
                .err_invalid_arg_type("The \"out\" argument must be a TypedArray or DataView")
                .throw();
        };
        out_off = arguments[5].to_u32();
        out_len = arguments[6].to_u32();
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return global_this
                .err_out_of_range(format_args!(
                    "out_off + out_len ({}) exceeds output buffer length ({})",
                    out_off as usize + out_len as usize,
                    out_buf.byte_len
                ))
                .throw();
        }
        out = Some(&mut out_buf.byte_slice()[out_off as usize..][..out_len as usize]);

        if this.write_in_progress {
            return global_this
                .err_invalid_state("Write already in progress")
                .throw();
        }
        if this.pending_close {
            return global_this.err_invalid_state("Pending close").throw();
        }
        this.write_in_progress = true;
        this.ref_();

        this.stream.set_buffers(in_, out);
        this.stream.set_flush(i32::try_from(flush).unwrap());
        let this_value = callframe.this();

        this.stream.do_work();
        if Self::check_error(this, global_this, this_value) {
            let write_result = this.write_result.as_mut().unwrap();
            this.stream
                .update_write_result(&mut write_result[1], &mut write_result[0]);
            this.write_in_progress = false;
        }
        this.deref();

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn reset(this: &mut T, global_this: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
        Self::reset_internal(this, global_this, callframe.this());
        JSValue::UNDEFINED
    }

    fn reset_internal(this: &mut T, global_this: &JSGlobalObject, this_value: JSValue) {
        // reset() destroys and re-creates the brotli/zstd encoder state (or
        // mutates the z_stream). Doing so while an async write is running on
        // the threadpool would be a use-after-free / data race, so defer it
        // until the in-flight write completes (mirrors pending_close).
        if this.write_in_progress {
            this.pending_reset = true;
            return;
        }
        this.pending_reset = false;
        if this.closed {
            return;
        }
        let err = this.stream.reset();
        if err.is_error() {
            Self::emit_error(this, global_this, this_value, err);
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        this: &mut T,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::close_internal(this);
        Ok(JSValue::UNDEFINED)
    }

    fn close_internal(this: &mut T) {
        if this.write_in_progress {
            this.pending_close = true;
            return;
        }
        this.pending_close = false;
        this.closed = true;
        this.this_value.deinit();
        // TODO(port): JsRef::deinit — likely `clear()`/`finalize()` in Rust API
        this.stream.close();
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_on_error(
        _this: &mut T,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        if value.is_function() {
            T::js::error_callback_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_on_error(_this: &T, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        T::js::error_callback_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    /// returns true if no error was detected/emitted
    fn check_error(this: &mut T, global_this: &JSGlobalObject, this_value: JSValue) -> bool {
        let err = this.stream.get_error_info();
        if !err.is_error() {
            return true;
        }
        Self::emit_error(this, global_this, this_value, err);
        false
    }

    pub fn emit_error(
        this: &mut T,
        global_this: &JSGlobalObject,
        this_value: JSValue,
        err_: Error,
    ) {
        // Clear write_in_progress *before* invoking the onerror callback.
        // The callback may re-enter write(), which sets write_in_progress=true
        // and schedules a WorkPool task. If we cleared the flag after the
        // callback, we would clobber that state and closeInternal()/resetInternal()
        // below could free the native zlib/brotli/zstd state while a task is
        // still queued, leading to a use-after-free when the worker thread
        // runs doWork().
        this.write_in_progress = false;

        let msg_bytes: &[u8] = if err_.msg.is_null() {
            b""
        } else {
            // SAFETY: err_.msg is a NUL-terminated C string from zlib/brotli/zstd
            unsafe { core::ffi::CStr::from_ptr(err_.msg) }.to_bytes()
        };
        let mut msg_str = BunString::create_format(format_args!("{}", bstr::BStr::new(msg_bytes)));
        let msg_value = match msg_str.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => return,
        };
        let err_value: JSValue = JSValue::js_number(err_.err);
        let code_bytes: &[u8] = if err_.code.is_null() {
            b""
        } else {
            // SAFETY: err_.code is a NUL-terminated C string from zlib/brotli/zstd
            unsafe { core::ffi::CStr::from_ptr(err_.code) }.to_bytes()
        };
        let mut code_str =
            BunString::create_format(format_args!("{}", bstr::BStr::new(code_bytes)));
        let code_value = match code_str.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => return,
        };

        let callback: JSValue = T::js::error_callback_get_cached(this_value).unwrap_or_else(|| {
            Output::panic(
                "Assertion failure: cachedErrorCallback is null in node:zlib binding",
                format_args!(""),
            )
        });

        let vm = global_this.bun_vm();
        vm.event_loop().run_callback(
            callback,
            global_this,
            this_value,
            &[msg_value, err_value, code_value],
        );

        if this.pending_reset {
            Self::reset_internal(this, global_this, this_value);
        }
        if this.pending_close {
            let _ = Self::close_internal(this);
        }
    }

    pub fn finalize(this: *mut T) {
        // SAFETY: called from JSC finalizer on mutator thread; this is valid
        unsafe { (*this).deref() };
    }
}

pub use jsc::codegen::JSNativeZlib::get_constructor as NativeZlib;
pub use jsc::codegen::JSNativeBrotli::get_constructor as NativeBrotli;
pub use jsc::codegen::JSNativeZstd::get_constructor as NativeZstd;

#[derive(Default)]
pub struct CountedKeepAlive {
    pub keep_alive: KeepAlive,
    pub ref_count: u32,
}

impl CountedKeepAlive {
    pub fn ref_(&mut self, vm: &VirtualMachine) {
        if self.ref_count == 0 {
            self.keep_alive.ref_(vm);
        }
        self.ref_count += 1;
    }

    pub fn unref(&mut self, vm: &VirtualMachine) {
        self.ref_count -= 1;
        if self.ref_count == 0 {
            self.keep_alive.unref(vm);
        }
    }
}

impl Drop for CountedKeepAlive {
    fn drop(&mut self) {
        self.keep_alive.disable();
    }
}

#[derive(Clone, Copy)]
pub struct Error {
    pub msg: *const c_char,
    pub err: c_int,
    pub code: *const c_char,
}

impl Error {
    pub const OK: Error = Error::init(core::ptr::null(), 0, core::ptr::null());

    pub const fn init(msg: *const c_char, err: c_int, code: *const c_char) -> Error {
        Error { msg, err, code }
    }

    pub fn is_error(&self) -> bool {
        !self.msg.is_null()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_zlib_binding.zig (396 lines)
//   confidence: medium
//   todos:      4
//   notes:      CompressionStream is a mixin (usingnamespace pattern) — field access on generic T needs trait bound in Phase B; ERR_* macro call shapes are approximate; run_from_js_thread defer→scopeguard captures &mut this and will need restructuring.
// ──────────────────────────────────────────────────────────────────────────
