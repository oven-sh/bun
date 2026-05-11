use core::ffi::{c_char, c_int};
use core::marker::PhantomData;

use bun_io::KeepAlive;
use bun_event_loop::Taskable;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::ConcurrentTask::{ConcurrentTask, Task};
use bun_jsc::{
    self as jsc, CallFrame, ErrorCode, JSGlobalObject, JSValue, JsResult, StringJsc as _,
    StrongOptional, WorkPoolTask,
};
use bun_str::{String as BunString, ZigStringSlice};
use bun_threading::work_pool::WorkPool;
use bun_zlib;

bun_output::declare_scope!(zlib, hidden);

// ─── type defs ────────────────────────────────────────────────────────────

/// Zig: `fn CompressionStream(comptime T: type) type { return struct { ... } }`
/// This is a mixin: methods all take `this: *T` and access fields on `T`
/// (write_in_progress, pending_close, pending_reset, closed, stream, this_value,
/// write_result, task, poll_ref, globalThis) plus `T.js.*` codegen accessors and
/// `T.ref()/deref()`.
// PORT NOTE: Phase D — expressed as a marker struct + trait bound. Field
// accesses on `T` go through the [`CompressionStreamImpl`] trait below.
pub struct CompressionStream<T>(PhantomData<T>);

#[derive(Default)]
pub struct CountedKeepAlive {
    pub keep_alive: KeepAlive,
    pub ref_count: u32,
}

impl Drop for CountedKeepAlive {
    fn drop(&mut self) {
        self.keep_alive.disable();
    }
}

/// Zig: `?[*:0]const u8` for `msg` / `code` — nullable NUL-terminated C strings.
/// Kept as raw `*const c_char` (not `&'static str`) because zlib (`z_stream.msg`)
/// and zstd (`ZSTD_getErrorString`) hand back runtime C pointers.
#[derive(Clone, Copy)]
pub struct Error {
    pub msg: *const c_char,
    pub err: c_int,
    pub code: *const c_char,
}

impl Error {
    pub const OK: Error = Error { msg: core::ptr::null(), err: 0, code: core::ptr::null() };

    #[inline]
    pub const fn ok() -> Error {
        Self::OK
    }

    pub const fn init(msg: *const c_char, err: c_int, code: *const c_char) -> Error {
        Error { msg, err, code }
    }

    pub fn is_error(&self) -> bool {
        !self.msg.is_null()
    }
}

// ─── local shims (upstream-crate gaps) ────────────────────────────────────

/// JS-thread `EventLoopCtx` for `KeepAlive::ref_/unref`. Zig passed the
/// `*VirtualMachine` directly (anytype dispatch); the Rust split routes through
/// the aio hook registered by `crate::init()`.
#[inline]
fn vm_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::AllocatorType::Js)
}

/// Local `JSValue::toU32` shim — `bun_jsc::JSValue` doesn't expose `to_u32()`
/// in this crate's view yet; mirror Zig's `@intFromFloat(value.asNumber())`.
#[inline]
fn jsv_to_u32(v: JSValue) -> u32 {
    v.as_number() as u32
}

/// Local `std.meta.intToEnum(FlushValue, n)` shim — `bun_zlib::FlushValue` has
/// no `TryFrom<u32>` impl upstream.
#[inline]
fn flush_value_is_valid(n: u32) -> bool {
    // FlushValue is `#[repr(C)]` with discriminants 0..=6.
    n <= 6
}

impl CountedKeepAlive {
    pub fn ref_(&mut self, _vm: &VirtualMachine) {
        if self.ref_count == 0 {
            self.keep_alive.ref_(vm_ctx());
        }
        self.ref_count += 1;
    }

    pub fn unref(&mut self, _vm: &VirtualMachine) {
        self.ref_count -= 1;
        if self.ref_count == 0 {
            self.keep_alive.unref(vm_ctx());
        }
    }
}

#[bun_jsc::host_fn]
pub fn crc32(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<2>().ptr;

    let data: ZigStringSlice = 'blk: {
        let data: JSValue = arguments[0];

        if data.is_empty() {
            return Err(global_this.throw_invalid_argument_type_value(
                b"data",
                b"string or an instance of Buffer, TypedArray, or DataView",
                JSValue::UNDEFINED,
            ));
        }
        if data.is_string() {
            // SAFETY: `is_string()` guarantees `as_string()` is non-null and
            // points to a live JSString cell on the JSC heap.
            break 'blk unsafe { &*data.as_string() }.to_slice(global_this);
        }
        let Some(buffer) = data.as_array_buffer(global_this) else {
            let ty_str = data.js_type_string(global_this).to_slice(global_this);
            // ty_str drops at end of scope
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_TYPE,
                    format_args!(
                        "The \"data\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {}",
                        bstr::BStr::new(ty_str.slice()),
                    ),
                )
                .throw());
        };
        break 'blk ZigStringSlice::from_utf8_never_free(buffer.byte_slice());
    };
    // `data` drops at end of scope

    let value: u32 = 'blk: {
        let value: JSValue = arguments[1];
        if value.is_empty() {
            break 'blk 0;
        }
        if !value.is_number() {
            return Err(global_this.throw_invalid_argument_type_value(b"value", b"number", value));
        }
        let valuef = value.as_number();
        let min: u32 = 0;
        let max: u32 = u32::MAX;

        if valuef.floor() != valuef {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "The value of \"{}\" is out of range. It must be an integer. Received {}",
                        "value", valuef,
                    ),
                )
                .throw());
        }
        if valuef < min as f64 || valuef > max as f64 {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "The value of \"{}\" is out of range. It must be >= {} and <= {}. Received {}",
                        "value", min, max, valuef,
                    ),
                )
                .throw());
        }
        break 'blk valuef as u32;
    };

    // crc32 returns a uLong (c_ulong) but the data will always be within a u32 range so the outer cast is always safe.
    let slice_u8 = data.slice();
    // SAFETY: `crc32` is a pure FFI hash over `(ptr, len)`; `slice_u8` is valid
    // for the call (borrowed from `data`, which lives to end of scope).
    let crc = unsafe {
        bun_zlib::crc32(
            bun_zlib::uLong::from(value),
            slice_u8.as_ptr(),
            u32::try_from(slice_u8.len()).expect("int cast"),
        )
    };
    Ok(JSValue::js_number(f64::from(u32::try_from(crc).expect("int cast"))))
}

// ─── CompressionStream mixin trait ────────────────────────────────────────
// Zig's `CompressionStream(T)` reaches into `T`'s fields directly (comptime
// duck-typing). Rust can't, so each `Native{Zlib,Brotli,Zstd}` implements this
// trait to expose its fields + per-class codegen accessors.

/// Backing-stream surface used by [`CompressionStream`] (zlib / brotli / zstd
/// `Context` types). Mirrors the Zig `this.stream.*` calls.
pub trait CompressionContext {
    fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>);
    fn set_flush(&mut self, flush: i32);
    fn do_work(&mut self);
    fn reset(&mut self) -> Error;
    fn close(&mut self);
    fn get_error_info(&mut self) -> Error;
    fn update_write_result(&mut self, avail_in: &mut u32, avail_out: &mut u32);
}

pub trait CompressionStreamImpl: Sized + Taskable + 'static {
    type Stream: CompressionContext;

    // Field accessors (split-borrow is the impl's responsibility).
    fn global_this(&self) -> *mut JSGlobalObject;
    fn stream_mut(&mut self) -> &mut Self::Stream;
    fn write_result_ptr(&mut self) -> Option<*mut u32>;
    fn poll_ref_mut(&mut self) -> &mut CountedKeepAlive;
    fn this_value_mut(&mut self) -> &mut StrongOptional;
    fn task_mut(&mut self) -> &mut WorkPoolTask;
    fn write_in_progress_mut(&mut self) -> &mut bool;
    fn pending_close_mut(&mut self) -> &mut bool;
    fn pending_reset_mut(&mut self) -> &mut bool;
    fn closed_mut(&mut self) -> &mut bool;

    /// Recover `*mut Self` from the embedded `WorkPoolTask`.
    /// SAFETY: caller guarantees `task` points at the `task` field of a live `Self`.
    unsafe fn from_task(task: *mut WorkPoolTask) -> *mut Self;

    // Intrusive refcount (Zig `bun.ptr.RefCount`).
    fn ref_(&self);
    /// Decrement the intrusive refcount and free `*this` (via `Self::deinit` /
    /// `heap::take`) when it hits zero.
    ///
    /// PORT NOTE: raw-pointer receiver. The previous `fn deref(&self)` cast
    /// `&self → *const Self → *mut Self` and freed through it — UB (writes
    /// through a pointer derived from a shared ref). All call sites already
    /// hold either `&mut T` (which coerces) or `*mut T`.
    ///
    /// SAFETY: `this` must point to a live `Self` allocated via `heap::alloc`
    /// in `constructor()`. After this returns, `*this` may have been freed.
    unsafe fn deref(this: *mut Self);

    // Per-class codegen (`T.js.*` cached-property accessors).
    fn write_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn error_callback_get_cached(this_value: JSValue) -> Option<JSValue>;
    fn error_callback_set_cached(this_value: JSValue, global: &JSGlobalObject, cb: JSValue);
}

impl<T: CompressionStreamImpl> CompressionStream<T> {
    pub fn write(
        this: &mut T,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_undef::<7>();
        let arguments = args.slice();

        if arguments.len() != 7 {
            return Err(global_this
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("write(flush, in, in_off, in_len, out, out_off, out_len)"),
                )
                .throw());
        }

        let mut in_off: u32 = 0;
        let mut in_len: u32 = 0;
        let out_off: u32;
        let out_len: u32;
        let flush: u32;
        let mut in_: Option<&[u8]> = None;
        let out: Option<&mut [u8]>;

        let this_value = callframe.this();

        if arguments[0].is_undefined() {
            return Err(global_this
                .err(ErrorCode::INVALID_ARG_VALUE, format_args!("flush value is required"))
                .throw());
        }
        flush = jsv_to_u32(arguments[0]);
        if !flush_value_is_valid(flush) {
            return Err(global_this
                .err(ErrorCode::INVALID_ARG_VALUE, format_args!("Invalid flush value"))
                .throw());
        }

        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            let Some(in_buf) = arguments[1].as_array_buffer(global_this) else {
                return Err(global_this
                    .err(
                        ErrorCode::INVALID_ARG_TYPE,
                        format_args!("The \"in\" argument must be a TypedArray or DataView"),
                    )
                    .throw());
            };
            in_off = jsv_to_u32(arguments[2]);
            in_len = jsv_to_u32(arguments[3]);
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off as usize + in_len as usize,
                            in_buf.byte_len,
                        ),
                    )
                    .throw());
            }
            // SAFETY: bounds checked above; backing JS buffer outlives this call
            // (rooted via `arguments[1]` on the call stack).
            in_ = Some(unsafe {
                core::slice::from_raw_parts(in_buf.ptr.add(in_off as usize), in_len as usize)
            });
        }

        let Some(out_buf) = arguments[4].as_array_buffer(global_this) else {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"out\" argument must be a TypedArray or DataView"),
                )
                .throw());
        };
        out_off = jsv_to_u32(arguments[5]);
        out_len = jsv_to_u32(arguments[6]);
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off as usize + out_len as usize,
                        out_buf.byte_len,
                    ),
                )
                .throw());
        }
        // SAFETY: bounds checked above; backing JS buffer outlives this call.
        out = Some(unsafe {
            core::slice::from_raw_parts_mut(out_buf.ptr.add(out_off as usize), out_len as usize)
        });
        let _ = (in_off, in_len, out_off, out_len);

        if *this.write_in_progress_mut() {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Write already in progress"))
                .throw());
        }
        if *this.pending_close_mut() {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Pending close"))
                .throw());
        }
        *this.write_in_progress_mut() = true;
        this.ref_();

        this.stream_mut().set_buffers(in_, out);
        this.stream_mut().set_flush(i32::try_from(flush).expect("int cast"));

        // Only create the strong handle when we have a pending write
        // And make sure to clear it when we are done.
        this.this_value_mut().set(global_this, this_value);

        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let vm = global_this.bun_vm();
        *this.task_mut() = WorkPoolTask {
            node: Default::default(),
            callback: Self::async_job_run_task,
        };
        this.poll_ref_mut().ref_(vm);
        WorkPool::schedule(this.task_mut());

        Ok(JSValue::UNDEFINED)
    }

    // Zig: nested `const AsyncJob = struct { ... }` — namespacing only.
    unsafe fn async_job_run_task(task: *mut WorkPoolTask) {
        // SAFETY: task points to T.task; recover &mut T via container_of
        // (`CompressionStreamImpl::from_task`).
        let this: &mut T = unsafe { &mut *T::from_task(task) };
        Self::async_job_run(this);
    }

    fn async_job_run(this: &mut T) {
        // SAFETY: `global_this` is the JSC_BORROW backref stored at construct
        // time; the global outlives this m_ctx payload.
        let global_this: &JSGlobalObject = unsafe { &*this.global_this() };
        // Zig: `bunVMConcurrently()` — thread-safe accessor (skips the
        // JS-thread debug assert; same backing pointer as `bun_vm()`).
        // SAFETY: `bun_vm_concurrently()` never returns null for a Bun-owned global.
        let vm = unsafe { &*global_this.bun_vm_concurrently() };

        this.stream_mut().do_work();

        // Zig: `vm.enqueueTaskConcurrent(ConcurrentTask.create(Task.init(this)))`.
        // SAFETY: `event_loop()` is a self-pointer into a live VM; the
        // `enqueue_task_concurrent` body only touches the lock-free
        // `concurrent_tasks` queue (thread-safe). `this` is the heap-allocated
        // `m_ctx` payload — the matching `ref()` in `write()` keeps it alive
        // until `run_from_js_thread` runs and calls `deref()`.
        unsafe {
            (*vm.event_loop())
                .enqueue_task_concurrent(ConcurrentTask::create(Task::init(std::ptr::from_mut::<T>(this))));
        }
    }

    pub fn run_from_js_thread(this: &mut T) {
        // PORT_NOTES_PLAN R-2: `&mut T` carries LLVM `noalias`, but both
        // `check_error` (→ `emit_error` → onerror `run_callback`) and the
        // write-callback `run_callback` below run user JS which can re-enter
        // via a fresh `&mut T` from the wrapper's `m_ctx` (e.g. `write()` /
        // `reset()` / `close()`) and mutate `pending_reset` / `pending_close`
        // / `write_in_progress` / `ref_count`. SUSPECT (not yet ASM-cached,
        // but the trait accessors are `#[inline]` field projections — one
        // inlining change away from reading a stale `pending_close` after the
        // callback or store-forwarding `ref_count` across it). Launder so
        // every field access goes through an opaque pointer; mirrors the cork
        // fix at b818e70e1c57.
        let this: *mut T = core::hint::black_box(core::ptr::from_mut(this));
        // SAFETY (applies to every `(*this)` / `&mut *this` below): `this`
        // aliases the original live `&mut T`; single JS thread; the matching
        // `ref_()` in `write()` keeps the heap payload alive across re-entry
        // until the trailing `deref()`, so `*this` stays a valid place even
        // if a re-entrant `close()` runs. Each `&mut *this` borrow ends
        // before the next is created (none held across a JS-re-entrant call).
        let global: &JSGlobalObject = unsafe { &*(*this).global_this() };
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let vm = global.bun_vm();
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref(); defer
        // this.poll_ref.unref(vm);` (run at scope exit in reverse order). We
        // call them explicitly on every return path instead of via scopeguard,
        // since scopeguard would capture `&mut this` across the body.

        unsafe { *(*this).write_in_progress_mut() = false };

        // Clear the strong handle before we call any callbacks.
        let Some(this_value) = (unsafe { (*this).this_value_mut().try_swap() }) else {
            bun_output::scoped_log!(zlib, "this_value is null in runFromJSThread");
            unsafe { (*this).poll_ref_mut().unref(vm) };
            // SAFETY: matching `ref_()` in `write()`; `this` is the heap payload
            // and is not accessed after this call.
            unsafe { T::deref(this) };
            return;
        };

        this_value.ensure_still_alive();

        if !Self::check_error(unsafe { &mut *this }, global, this_value) {
            // Re-escape: `check_error` → `emit_error` ran the onerror callback.
            core::hint::black_box(this);
            unsafe { (*this).poll_ref_mut().unref(vm) };
            // SAFETY: see above.
            unsafe { T::deref(this) };
            return;
        }

        if let Some(write_result) = unsafe { (*this).write_result_ptr() } {
            // SAFETY: `write_result` points at a 2-element u32[] owned by JS
            // (set in `init()`); both indices are in-bounds.
            let (r1, r0) = unsafe { (&mut *write_result.add(1), &mut *write_result) };
            unsafe { (*this).stream_mut().update_write_result(r1, r0) };
        }
        this_value.ensure_still_alive();

        let write_callback: JSValue = T::write_callback_get_cached(this_value).unwrap();

        vm.event_loop_ref()
            .run_callback(write_callback, global, this_value, &[]);
        // Re-escape after the JS write callback so the `pending_*` / `poll_ref`
        // / `ref_count` reads below cannot reuse any pre-call load.
        core::hint::black_box(this);

        if unsafe { *(*this).pending_reset_mut() } {
            Self::reset_internal(unsafe { &mut *this }, global, this_value);
        }
        if unsafe { *(*this).pending_close_mut() } {
            let _ = Self::close_internal(unsafe { &mut *this });
        }

        unsafe { (*this).poll_ref_mut().unref(vm) };
        // SAFETY: matching `ref_()` in `write()`; `this` is the heap payload and
        // is not accessed after this call.
        unsafe { T::deref(this) };
    }

    pub fn write_sync(
        this: &mut T,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_undef::<7>();
        let arguments = args.slice();

        if arguments.len() != 7 {
            return Err(global_this
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("writeSync(flush, in, in_off, in_len, out, out_off, out_len)"),
                )
                .throw());
        }

        let mut in_off: u32 = 0;
        let mut in_len: u32 = 0;
        let out_off: u32;
        let out_len: u32;
        let flush: u32;
        let mut in_: Option<&[u8]> = None;
        let out: Option<&mut [u8]>;

        if arguments[0].is_undefined() {
            return Err(global_this
                .err(ErrorCode::INVALID_ARG_VALUE, format_args!("flush value is required"))
                .throw());
        }
        flush = jsv_to_u32(arguments[0]);
        if !flush_value_is_valid(flush) {
            return Err(global_this
                .err(ErrorCode::INVALID_ARG_VALUE, format_args!("Invalid flush value"))
                .throw());
        }

        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            let Some(in_buf) = arguments[1].as_array_buffer(global_this) else {
                return Err(global_this
                    .err(
                        ErrorCode::INVALID_ARG_TYPE,
                        format_args!("The \"in\" argument must be a TypedArray or DataView"),
                    )
                    .throw());
            };
            in_off = jsv_to_u32(arguments[2]);
            in_len = jsv_to_u32(arguments[3]);
            if in_buf.byte_len < in_off as usize + in_len as usize {
                return Err(global_this
                    .err(
                        ErrorCode::OUT_OF_RANGE,
                        format_args!(
                            "in_off + in_len ({}) exceeds input buffer length ({})",
                            in_off as usize + in_len as usize,
                            in_buf.byte_len,
                        ),
                    )
                    .throw());
            }
            // SAFETY: bounds checked above; backing JS buffer outlives this call.
            in_ = Some(unsafe {
                core::slice::from_raw_parts(in_buf.ptr.add(in_off as usize), in_len as usize)
            });
        }

        let Some(out_buf) = arguments[4].as_array_buffer(global_this) else {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"out\" argument must be a TypedArray or DataView"),
                )
                .throw());
        };
        out_off = jsv_to_u32(arguments[5]);
        out_len = jsv_to_u32(arguments[6]);
        if out_buf.byte_len < out_off as usize + out_len as usize {
            return Err(global_this
                .err(
                    ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "out_off + out_len ({}) exceeds output buffer length ({})",
                        out_off as usize + out_len as usize,
                        out_buf.byte_len,
                    ),
                )
                .throw());
        }
        // SAFETY: bounds checked above; backing JS buffer outlives this call.
        out = Some(unsafe {
            core::slice::from_raw_parts_mut(out_buf.ptr.add(out_off as usize), out_len as usize)
        });
        let _ = (in_off, in_len, out_off, out_len);

        // PORT_NOTES_PLAN R-2: `&mut T` carries LLVM `noalias`, but
        // `check_error` (→ `emit_error` → onerror `run_callback`) runs user JS
        // which can re-enter via a fresh `&mut T` from the wrapper's `m_ctx`
        // (the comment in `emit_error` explicitly notes the callback may call
        // `write()`, bumping `ref_count` and flipping `write_in_progress`).
        // SUSPECT (not yet ASM-cached): `ref_()` / `deref()` are `#[inline]`
        // `Cell` ops on `ref_count` — one inlining change away from the
        // store-forwarding fold seen in `dns.rs::on_dns_poll` (load once, inc,
        // then store stale pre-inc value after the callback). Launder so all
        // `this` accesses below go through an opaque pointer.
        let this: *mut T = core::hint::black_box(core::ptr::from_mut(this));
        // SAFETY (applies to every `(*this)` / `&mut *this` below): `this`
        // aliases the original live `&mut T`; single JS thread; the bracketing
        // `ref_()` keeps the heap payload alive across re-entry until the
        // trailing `deref()`.
        if unsafe { *(*this).write_in_progress_mut() } {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Write already in progress"))
                .throw());
        }
        if unsafe { *(*this).pending_close_mut() } {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Pending close"))
                .throw());
        }
        unsafe { *(*this).write_in_progress_mut() = true };
        unsafe { (*this).ref_() };

        unsafe { (*this).stream_mut().set_buffers(in_, out) };
        unsafe { (*this).stream_mut().set_flush(i32::try_from(flush).expect("int cast")) };
        let this_value = callframe.this();

        unsafe { (*this).stream_mut().do_work() };
        if Self::check_error(unsafe { &mut *this }, global_this, this_value) {
            if let Some(write_result) = unsafe { (*this).write_result_ptr() } {
                // SAFETY: `write_result` points at a 2-element u32[] owned by JS.
                let (r1, r0) = unsafe { (&mut *write_result.add(1), &mut *write_result) };
                unsafe { (*this).stream_mut().update_write_result(r1, r0) };
            }
            unsafe { *(*this).write_in_progress_mut() = false };
        }
        // Re-escape: on the error branch `check_error` → `emit_error` ran the
        // onerror callback, so the `ref_count` read inside `deref()` must not
        // be store-forwarded from the `ref_()` above.
        core::hint::black_box(this);
        // SAFETY: matching `ref_()` above; `this` is the heap payload and is not
        // accessed after this call.
        unsafe { T::deref(this) };

        Ok(JSValue::UNDEFINED)
    }

    pub fn reset(this: &mut T, global_this: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
        Self::reset_internal(this, global_this, callframe.this());
        JSValue::UNDEFINED
    }

    fn reset_internal(this: &mut T, global_this: &JSGlobalObject, this_value: JSValue) {
        // reset() destroys and re-creates the brotli/zstd encoder state (or
        // mutates the z_stream). Doing so while an async write is running on
        // the threadpool would be a use-after-free / data race, so defer it
        // until the in-flight write completes (mirrors pending_close).
        if *this.write_in_progress_mut() {
            *this.pending_reset_mut() = true;
            return;
        }
        *this.pending_reset_mut() = false;
        if *this.closed_mut() {
            return;
        }
        let err = this.stream_mut().reset();
        if err.is_error() {
            Self::emit_error(this, global_this, this_value, err);
        }
    }

    pub fn close(
        this: &mut T,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::close_internal(this);
        Ok(JSValue::UNDEFINED)
    }

    fn close_internal(this: &mut T) {
        if *this.write_in_progress_mut() {
            *this.pending_close_mut() = true;
            return;
        }
        *this.pending_close_mut() = false;
        *this.closed_mut() = true;
        this.this_value_mut().deinit();
        this.stream_mut().close();
    }

    pub fn set_on_error(
        _this: &mut T,
        this_value: JSValue,
        global_object: &JSGlobalObject,
        value: JSValue,
    ) {
        if value.is_function() {
            T::error_callback_set_cached(
                this_value,
                global_object,
                value.with_async_context_if_needed(global_object),
            );
        }
    }

    pub fn get_on_error(_this: &T, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        T::error_callback_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    /// returns true if no error was detected/emitted
    fn check_error(this: &mut T, global_this: &JSGlobalObject, this_value: JSValue) -> bool {
        let err = this.stream_mut().get_error_info();
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
        // PORT_NOTES_PLAN R-2: `&mut T` carries LLVM `noalias`, but the
        // onerror `run_callback` below runs user JS which can re-enter via a
        // fresh `&mut T` from the wrapper's `m_ctx` — the comment immediately
        // below documents exactly that (`write()` re-entry flips
        // `write_in_progress` and may then set `pending_reset` /
        // `pending_close`). SUSPECT (not yet ASM-cached): the trait accessors
        // are `#[inline]` field projections, so one inlining change could let
        // LLVM sink the `write_in_progress = false` store past the callback or
        // read stale `pending_reset` / `pending_close` after it. Launder so
        // every field access goes through an opaque pointer.
        let this: *mut T = core::hint::black_box(core::ptr::from_mut(this));
        // SAFETY (applies to every `(*this)` / `&mut *this` below): `this`
        // aliases the original live `&mut T`; single JS thread; callers hold a
        // `ref_()` bracket (`write()` / `write_sync()`), so re-entry never
        // frees `*this`.

        // Clear write_in_progress *before* invoking the onerror callback.
        // The callback may re-enter write(), which sets write_in_progress=true
        // and schedules a WorkPool task. If we cleared the flag after the
        // callback, we would clobber that state and closeInternal()/resetInternal()
        // below could free the native zlib/brotli/zstd state while a task is
        // still queued, leading to a use-after-free when the worker thread
        // runs doWork().
        unsafe { *(*this).write_in_progress_mut() = false };

        // Zig: `std.mem.sliceTo(err_.msg, 0) orelse ""`.
        // SAFETY: when non-null, `msg`/`code` point at NUL-terminated bytes
        // (static literals or zlib/zstd-owned buffers valid for this call).
        let msg_bytes: &[u8] = if err_.msg.is_null() {
            b""
        } else {
            unsafe { bun_core::ffi::cstr(err_.msg) }.to_bytes()
        };
        let mut msg_str = BunString::create_format(format_args!("{}", bstr::BStr::new(msg_bytes)));
        let msg_value = match msg_str.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => return,
        };
        let err_value: JSValue = JSValue::js_number(f64::from(err_.err));
        let code_bytes: &[u8] = if err_.code.is_null() {
            b""
        } else {
            unsafe { bun_core::ffi::cstr(err_.code) }.to_bytes()
        };
        let mut code_str = BunString::create_format(format_args!("{}", bstr::BStr::new(code_bytes)));
        let code_value = match code_str.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => return,
        };

        let callback: JSValue = T::error_callback_get_cached(this_value).unwrap_or_else(|| {
            bun_core::Output::panic(format_args!(
                "Assertion failure: cachedErrorCallback is null in node:zlib binding",
            ))
        });

        // SAFETY: `bun_vm()` and `event_loop()` are non-null for a Bun-owned global.
        let vm = global_this.bun_vm();
        vm.event_loop_ref().run_callback(
            callback,
            global_this,
            this_value,
            &[msg_value, err_value, code_value],
        );
        // Re-escape after the JS onerror callback so the `pending_*` reads
        // below cannot reuse any pre-call provenance.
        core::hint::black_box(this);

        if unsafe { *(*this).pending_reset_mut() } {
            Self::reset_internal(unsafe { &mut *this }, global_this, this_value);
        }
        if unsafe { *(*this).pending_close_mut() } {
            let _ = Self::close_internal(unsafe { &mut *this });
        }
    }

    pub fn finalize(this: Box<T>) {
        // Refcounted: release the JS wrapper's +1; allocation may outlive this
        // call if other refs remain, so hand ownership back to the raw refcount.
        // SAFETY: `this` was the unique GC-owned m_ctx; `deref` frees on count==0.
        unsafe { T::deref(Box::into_raw(this)) };
    }
}

/// Expose the [`CompressionStream<T>`] mixin entry points as inherent
/// associated fns on `T` so the per-class C-ABI thunks emitted by
/// `generated_classes.rs` (which call `T::write(&mut *this, …)` etc.) resolve.
///
/// This is the Rust spelling of Zig's
/// ```zig
/// const impl = CompressionStream(@This());
/// pub const write = impl.write;
/// pub const writeSync = impl.writeSync;
/// pub const reset = impl.reset;
/// pub const close = impl.close;
/// pub const setOnError = impl.setOnError;
/// pub const getOnError = impl.getOnError;
/// pub const finalize = impl.finalize;
/// ```
#[macro_export]
#[doc(hidden)]
macro_rules! __compression_stream_mixin_reexports {
    ($native:ty) => {
        impl $native {
            #[inline]
            pub fn write(
                this: &mut Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::write(this, global, frame)
            }
            #[inline]
            pub fn write_sync(
                this: &mut Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::write_sync(this, global, frame)
            }
            #[inline]
            pub fn reset(
                this: &mut Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::reset(this, global, frame)
            }
            #[inline]
            pub fn close(
                this: &mut Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::close(this, global, frame)
            }
            #[inline]
            pub fn set_on_error(
                this: &mut Self,
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
                value: ::bun_jsc::JSValue,
            ) {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::set_on_error(
                    this, this_value, global, value,
                )
            }
            #[inline]
            pub fn get_on_error(
                this: &mut Self,
                this_value: ::bun_jsc::JSValue,
                global: &::bun_jsc::JSGlobalObject,
            ) -> ::bun_jsc::JSValue {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::get_on_error(
                    this, this_value, global,
                )
            }
            #[inline]
            pub fn finalize(self: Box<Self>) {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::finalize(self)
            }
        }
    };
}

// Zig: `pub const NativeZlib = jsc.Codegen.JSNativeZlib.getConstructor;` (etc.) —
// in Rust the per-class `JS*` codegen submodules collapse into the generic
// `jsc::codegen::js::get_constructor::<T>` helper (see src/jsc/lib.rs `pub mod codegen`).
#[inline]
pub fn native_zlib(global: &JSGlobalObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::node::zlib::native_zlib::NativeZlib>(global)
}
#[inline]
pub fn native_brotli(global: &JSGlobalObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::node::zlib::native_brotli::NativeBrotli>(global)
}
#[inline]
pub fn native_zstd(global: &JSGlobalObject) -> JSValue {
    jsc::codegen::js::get_constructor::<crate::node::zlib::native_zstd::NativeZstd>(global)
}

/// Implements [`CompressionContext`] for a `Context` type and
/// [`CompressionStreamImpl`] for its owning `Native*` struct by delegating to
/// the inherent methods / fields that already exist on each (mirrors Zig's
/// comptime duck-typed `CompressionStream(T)` mixin).
///
/// All three `Native{Zlib,Brotli,Zstd}` structs share the exact field layout
/// (`global_this`, `stream`, `write_result`, `poll_ref`, `this_value`,
/// `write_in_progress`, `pending_close`, `pending_reset`, `closed`, `task`,
/// `ref_count`), so the macro can stamp the impls uniformly.
///
/// `$type_name` is the C++-side class name (matches `.classes.ts`); the macro
/// emits a `pub mod js { … }` with the cached-property accessors
/// (`writeCallback` / `errorCallback` / `dictionary`) wired to the
/// `${TypeName}Prototype__${prop}{Get,Set}CachedValue` extern symbols.
#[macro_export]
#[doc(hidden)]
macro_rules! __impl_compression_stream {
    ($native:ident, $ctx:ty, $type_name:literal) => {
        // Tag for the event-loop dispatcher (bun_runtime::dispatch::run_task).
        impl ::bun_event_loop::Taskable for $native {
            const TAG: ::bun_event_loop::TaskTag = ::bun_event_loop::task_tag::$native;
        }

        /// `T.js.*` — cached-property accessors emitted by
        /// `generate-classes.ts` for `values: ["writeCallback",
        /// "errorCallback", "dictionary"]`.
        #[allow(unused)]
        pub mod js {
            ::bun_jsc::codegen_cached_accessors!($type_name; writeCallback, errorCallback, dictionary);
        }

        impl $crate::node::node_zlib_binding::CompressionContext for $ctx {
            #[inline] fn set_buffers(&mut self, in_: Option<&[u8]>, out: Option<&mut [u8]>) { Self::set_buffers(self, in_, out) }
            #[inline] fn set_flush(&mut self, flush: i32) { Self::set_flush(self, flush) }
            #[inline] fn do_work(&mut self) { Self::do_work(self) }
            #[inline] fn reset(&mut self) -> $crate::node::node_zlib_binding::Error { Self::reset(self) }
            #[inline] fn close(&mut self) { Self::close(self) }
            #[inline] fn get_error_info(&mut self) -> $crate::node::node_zlib_binding::Error { Self::get_error_info(self) }
            #[inline] fn update_write_result(&mut self, avail_in: &mut u32, avail_out: &mut u32) { Self::update_write_result(self, avail_in, avail_out) }
        }

        impl $crate::node::node_zlib_binding::CompressionStreamImpl for $native {
            type Stream = $ctx;

            #[inline] fn global_this(&self) -> *mut ::bun_jsc::JSGlobalObject { self.global_this.cast::<::bun_jsc::JSGlobalObject>() }
            #[inline] fn stream_mut(&mut self) -> &mut Self::Stream { &mut self.stream }
            #[inline] fn write_result_ptr(&mut self) -> Option<*mut u32> { self.write_result.map(|p| p.cast::<u32>()) }
            #[inline] fn poll_ref_mut(&mut self) -> &mut $crate::node::node_zlib_binding::CountedKeepAlive { &mut self.poll_ref }
            #[inline] fn this_value_mut(&mut self) -> &mut ::bun_jsc::StrongOptional { &mut self.this_value }
            #[inline] fn task_mut(&mut self) -> &mut ::bun_jsc::WorkPoolTask { &mut self.task }
            #[inline] fn write_in_progress_mut(&mut self) -> &mut bool { &mut self.write_in_progress }
            #[inline] fn pending_close_mut(&mut self) -> &mut bool { &mut self.pending_close }
            #[inline] fn pending_reset_mut(&mut self) -> &mut bool { &mut self.pending_reset }
            #[inline] fn closed_mut(&mut self) -> &mut bool { &mut self.closed }

            #[inline]
            unsafe fn from_task(task: *mut ::bun_jsc::WorkPoolTask) -> *mut Self {
                // SAFETY: `task` points at the `task` field of a live `Self`
                // (Zig `@fieldParentPtr("task", task)`); `from_field_ptr!`
                // computes the byte offset via `offset_of!(Self, task)`.
                unsafe { ::bun_core::from_field_ptr!(Self, task, task) }
            }

            #[inline] fn ref_(&self) { self.ref_count.set(self.ref_count.get() + 1); }
            #[inline] unsafe fn deref(this: *mut Self) {
                // SAFETY: `this` is live per the trait contract; `ref_count` is a
                // `Cell<u32>` so the read/write is sound through a raw `*mut`.
                let n = unsafe { (*this).ref_count.get() } - 1;
                unsafe { (*this).ref_count.set(n) };
                if n == 0 {
                    // Zig: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`
                    // → calls `deinit(this)` then `bun.destroy(this)`. The
                    // per-type `Self::deinit(*mut Self)` does both (closes the
                    // stream and `heap::take`s the payload).
                    // SAFETY: refcount hit zero ⇒ no other borrow remains;
                    // `this` was `heap::alloc`'d at construction.
                    unsafe { Self::deinit(this) };
                }
            }

            #[inline] fn write_callback_get_cached(this_value: ::bun_jsc::JSValue) -> Option<::bun_jsc::JSValue> {
                js::write_callback_get_cached(this_value)
            }
            #[inline] fn error_callback_get_cached(this_value: ::bun_jsc::JSValue) -> Option<::bun_jsc::JSValue> {
                js::error_callback_get_cached(this_value)
            }
            #[inline] fn error_callback_set_cached(this_value: ::bun_jsc::JSValue, global: &::bun_jsc::JSGlobalObject, cb: ::bun_jsc::JSValue) {
                js::error_callback_set_cached(this_value, global, cb)
            }
        }
    };
}

// ported from: src/runtime/node/node_zlib_binding.zig
