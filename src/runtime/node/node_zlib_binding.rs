use core::cell::Cell;
use core::ffi::{c_char, c_int};
use core::marker::PhantomData;
use core::ptr::NonNull;

use bun_ptr::ParentRef;

use bun_core::{String as BunString, ZigStringSlice};
use bun_event_loop::Taskable;
use bun_io::KeepAlive;
use bun_jsc::ConcurrentTask::{ConcurrentTask, Task};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, ErrorCode, JSGlobalObject, JSValue, JsCell, JsResult, StringJsc as _,
    StrongOptional, WorkPoolTask,
};
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
    pub const OK: Error = Error {
        msg: core::ptr::null(),
        err: 0,
        code: core::ptr::null(),
    };

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
            self.keep_alive.ref_(bun_io::js_vm_ctx());
        }
        self.ref_count += 1;
    }

    pub fn unref(&mut self, _vm: &VirtualMachine) {
        self.ref_count -= 1;
        if self.ref_count == 0 {
            self.keep_alive.unref(bun_io::js_vm_ctx());
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
            // `is_string()` guarantees `as_string()` is non-null and points to a
            // live JSString cell on the JSC heap. `JSString` is an `opaque_ffi!`
            // ZST handle; `opaque_ref` is the centralised deref proof.
            break 'blk bun_jsc::JSString::opaque_ref(data.as_string()).to_slice(global_this);
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
    Ok(JSValue::js_number(f64::from(
        u32::try_from(crc).expect("int cast"),
    )))
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

// R-2 Phase 2: every JS-exposed mixin method takes `&T`; per-field interior
// mutability via `Cell` (Copy) / `JsCell` (non-Copy). Accessors return the
// cell wrapper so the mixin can `.get()`/`.set()`/`.with_mut()` as needed.
// The codegen `host_fn_this` shim still passes `&mut T` until Phase 1 lands —
// `&mut T` auto-reborrows to `&T` so the impls below compile against either.
pub trait CompressionStreamImpl: Sized + Taskable + 'static {
    type Stream: CompressionContext;

    // Field accessors (interior-mutability cells; all `&self`).
    /// JSC_BORROW backref — the global outlives this m_ctx payload.
    /// Implementations store a `BackRef<JSGlobalObject>`; the single unsafe
    /// deref lives in `BackRef::get`, so callers and impls are safe.
    fn global_this(&self) -> &JSGlobalObject;
    fn stream(&self) -> &JsCell<Self::Stream>;
    fn write_result_ptr(&self) -> Option<*mut u32>;

    /// Write `(avail_out, avail_in)` into the JS-owned 2-element `Uint32Array`
    /// (`this._writeState`). Single unsafe deref site for the set-once
    /// `write_result: Cell<Option<NonNull<u32>>>` field so callers stay safe.
    #[inline]
    fn flush_write_result(&self) {
        let Some(write_result) = self.write_result_ptr() else {
            return;
        };
        // SAFETY: `write_result` points at a 2-element `u32[]` owned by JS
        // (set in each impl's `init()`); both indices are in-bounds and the
        // backing buffer is kept alive by `this._writeState` /
        // `_handle[owner_symbol]`.
        let (r1, r0) = unsafe { (&mut *write_result.add(1), &mut *write_result) };
        self.stream().with_mut(|s| s.update_write_result(r1, r0));
    }

    fn poll_ref(&self) -> &JsCell<CountedKeepAlive>;
    fn this_value(&self) -> &JsCell<StrongOptional>;
    fn task(&self) -> &JsCell<WorkPoolTask>;
    fn write_in_progress(&self) -> &Cell<bool>;
    fn pending_close(&self) -> &Cell<bool>;
    fn pending_reset(&self) -> &Cell<bool>;
    fn closed(&self) -> &Cell<bool>;

    /// Recover `*mut Self` from the embedded `WorkPoolTask`.
    /// SAFETY: caller guarantees `task` points at the `task` field of a live `Self`.
    unsafe fn from_task(task: *mut WorkPoolTask) -> *mut Self;

    // Intrusive refcount (Zig `bun.ptr.RefCount`).
    fn ref_(&self);
    /// Decrement the intrusive refcount and free `*this` (via `Self::deinit` /
    /// `heap::take`) when it hits zero.
    ///
    /// PORT NOTE: raw-pointer receiver so the destroy path keeps the
    /// allocation's full write provenance (routing through `&self` and casting
    /// back to `*mut` would be UB under Stacked Borrows when `Box::from_raw`
    /// reclaims). Every call site that may hit zero (`run_from_js_thread`,
    /// `finalize`) holds a `*mut T` derived from the original `m_ctx`
    /// allocation; the bracketed `ref_()`/`deref()` in `write_sync` can never
    /// hit zero while the JS wrapper's +1 is still live, so its
    /// `(&T as *const T).cast_mut()` provenance is sufficient (only the
    /// `Cell<u32>` is touched).
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
        this: &T,
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
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("flush value is required"),
                )
                .throw());
        }
        flush = jsv_to_u32(arguments[0]);
        if !flush_value_is_valid(flush) {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Invalid flush value"),
                )
                .throw());
        }

        // Hoisted so `in_` can borrow it past the `else` arm (mirrors `out_buf`).
        let in_buf: jsc::ArrayBuffer;
        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            in_buf = match arguments[1].as_array_buffer(global_this) {
                Some(b) => b,
                None => {
                    return Err(global_this
                        .err(
                            ErrorCode::INVALID_ARG_TYPE,
                            format_args!("The \"in\" argument must be a TypedArray or DataView"),
                        )
                        .throw());
                }
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
            // Bounds checked above; `byte_slice` is the safe accessor for the JS
            // ArrayBuffer's backing store (rooted via `arguments[1]` on the call stack).
            in_ = Some(&in_buf.byte_slice()[in_off as usize..in_off as usize + in_len as usize]);
        }

        let Some(mut out_buf) = arguments[4].as_array_buffer(global_this) else {
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
        // Bounds checked above; `byte_slice_mut` is the safe accessor for the JS
        // ArrayBuffer's backing store (rooted via `arguments[4]` on the call stack).
        out = Some(
            &mut out_buf.byte_slice_mut()[out_off as usize..out_off as usize + out_len as usize],
        );
        let _ = (in_off, in_len, out_off, out_len);

        if this.write_in_progress().get() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!("Write already in progress"),
                )
                .throw());
        }
        if this.pending_close().get() {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Pending close"))
                .throw());
        }
        this.write_in_progress().set(true);
        this.ref_();

        this.stream().with_mut(|s| {
            s.set_buffers(in_, out);
            s.set_flush(i32::try_from(flush).expect("int cast"));
        });

        // Only create the strong handle when we have a pending write
        // And make sure to clear it when we are done.
        this.this_value()
            .with_mut(|v| v.set(global_this, this_value));

        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let vm = global_this.bun_vm();
        this.task().set(WorkPoolTask {
            node: Default::default(),
            callback: Self::async_job_run_task,
        });
        this.poll_ref().with_mut(|p| p.ref_(vm));
        WorkPool::schedule(this.task().as_ptr());

        Ok(JSValue::UNDEFINED)
    }

    // Zig: nested `const AsyncJob = struct { ... }` — namespacing only.
    // Safe fn: coerces to the `WorkPoolTask.callback` field type at the
    // struct-init site in `write` above.
    fn async_job_run_task(task: *mut WorkPoolTask) {
        // SAFETY: `task` points to `T.task` — only ever invoked by the thread
        // pool against a `T` scheduled in `write`, so provenance covers the
        // full `T` allocation. Recover *mut T via container_of
        // (`CompressionStreamImpl::from_task`). The task field is a
        // `JsCell<WorkPoolTask>` — `#[repr(transparent)]` over the value, so
        // `offset_of!(T, task)` is the value's offset.
        let this: *mut T = unsafe { T::from_task(task) };
        Self::async_job_run(this);
    }

    fn async_job_run(this: *mut T) {
        // BACKREF — `this` is the live heap m_ctx payload (kept alive by the
        // `ref_()` in `write()`); bodies use the `&self` accessor surface
        // (R-2). `ParentRef` Deref collapses the per-site raw deref.
        let this_ref = ParentRef::from(NonNull::new(this).expect("async_job_run: this"));
        let global_this: &JSGlobalObject = this_ref.global_this();
        // Zig: `bunVMConcurrently()` — thread-safe accessor (skips the
        // JS-thread debug assert; same backing pointer as `bun_vm()`).
        // BACKREF — `bun_vm_concurrently()` never returns null for a Bun-owned
        // global; wrap once so the `event_loop()` read below is safe Deref.
        let vm = ParentRef::from(
            NonNull::new(global_this.bun_vm_concurrently()).expect("bun_vm_concurrently"),
        );

        this_ref.stream().with_mut(|s| s.do_work());

        // Zig: `vm.enqueueTaskConcurrent(ConcurrentTask.create(Task.init(this)))`.
        // SAFETY: `event_loop()` is a self-pointer into a live VM; the
        // `enqueue_task_concurrent` body only touches the lock-free
        // `concurrent_tasks` queue (thread-safe). `this` is the heap-allocated
        // `m_ctx` payload — the matching `ref()` in `write()` keeps it alive
        // until `run_from_js_thread` runs and calls `deref()`.
        unsafe {
            (*vm.event_loop()).enqueue_task_concurrent(ConcurrentTask::create(Task::init(this)));
        }
    }

    /// Dispatched from `dispatch.rs` when the worker-thread `do_work()` posts
    /// the completion task back to the JS thread.
    ///
    /// R-2: takes `*mut T` (full allocation provenance from `Task.ptr`) so the
    /// trailing `T::deref(this_ptr)` may free the box if it hits zero. All
    /// field access goes through `&*this_ptr` and the `&self` accessor surface;
    /// every accessed field is `Cell`/`JsCell`-backed so re-entry via the
    /// onerror / write callbacks is sound (no `noalias` to violate, no
    /// `black_box` launders needed).
    ///
    /// SAFETY: `this_ptr` is the live heap m_ctx payload; the matching
    /// `ref_()` in `write()` keeps it alive until the trailing `deref()`.
    pub unsafe fn run_from_js_thread(this_ptr: *mut T) {
        // BACKREF — see fn-level contract; `ParentRef` Deref gives safe `&T`
        // for the `&self` accessor surface (R-2).
        let this = ParentRef::from(NonNull::new(this_ptr).expect("run_from_js_thread: this"));
        let global: &JSGlobalObject = this.global_this();
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let vm = global.bun_vm();
        // PORT NOTE: reshaped — Zig used `defer this.deref(); defer
        // this.poll_ref.unref(vm);` (run at scope exit in reverse order). We
        // call them explicitly on every return path.

        this.write_in_progress().set(false);

        // Clear the strong handle before we call any callbacks.
        let Some(this_value) = this.this_value().with_mut(|v| v.try_swap()) else {
            bun_output::scoped_log!(zlib, "this_value is null in runFromJSThread");
            this.poll_ref().with_mut(|p| p.unref(vm));
            // SAFETY: matching `ref_()` in `write()`; `this_ptr` is the heap
            // payload and is not accessed after this call.
            unsafe { T::deref(this_ptr) };
            return;
        };

        this_value.ensure_still_alive();

        if !Self::check_error(&this, global, this_value) {
            this.poll_ref().with_mut(|p| p.unref(vm));
            // SAFETY: see above.
            unsafe { T::deref(this_ptr) };
            return;
        }

        this.flush_write_result();
        this_value.ensure_still_alive();

        let write_callback: JSValue = T::write_callback_get_cached(this_value).unwrap();

        vm.event_loop_ref()
            .run_callback(write_callback, global, this_value, &[]);

        if this.pending_reset().get() {
            Self::reset_internal(&this, global, this_value);
        }
        if this.pending_close().get() {
            Self::close_internal(&this);
        }

        this.poll_ref().with_mut(|p| p.unref(vm));
        // SAFETY: matching `ref_()` in `write()`; `this_ptr` is the heap payload
        // and is not accessed after this call.
        unsafe { T::deref(this_ptr) };
    }

    pub fn write_sync(
        this: &T,
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
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("flush value is required"),
                )
                .throw());
        }
        flush = jsv_to_u32(arguments[0]);
        if !flush_value_is_valid(flush) {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Invalid flush value"),
                )
                .throw());
        }

        // Hoisted so `in_` can borrow it past the `else` arm (mirrors `out_buf`).
        let in_buf: jsc::ArrayBuffer;
        if arguments[1].is_null() {
            // just a flush
            in_ = None;
            in_len = 0;
            in_off = 0;
        } else {
            in_buf = match arguments[1].as_array_buffer(global_this) {
                Some(b) => b,
                None => {
                    return Err(global_this
                        .err(
                            ErrorCode::INVALID_ARG_TYPE,
                            format_args!("The \"in\" argument must be a TypedArray or DataView"),
                        )
                        .throw());
                }
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
            // Bounds checked above; `byte_slice` is the safe accessor for the JS
            // ArrayBuffer's backing store (rooted via `arguments[1]` on the call stack).
            in_ = Some(&in_buf.byte_slice()[in_off as usize..in_off as usize + in_len as usize]);
        }

        let Some(mut out_buf) = arguments[4].as_array_buffer(global_this) else {
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
        // Bounds checked above; `byte_slice_mut` is the safe accessor for the JS
        // ArrayBuffer's backing store (rooted via `arguments[4]` on the call stack).
        out = Some(
            &mut out_buf.byte_slice_mut()[out_off as usize..out_off as usize + out_len as usize],
        );
        let _ = (in_off, in_len, out_off, out_len);

        if this.write_in_progress().get() {
            return Err(global_this
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!("Write already in progress"),
                )
                .throw());
        }
        if this.pending_close().get() {
            return Err(global_this
                .err(ErrorCode::INVALID_STATE, format_args!("Pending close"))
                .throw());
        }
        this.write_in_progress().set(true);
        this.ref_();

        this.stream().with_mut(|s| {
            s.set_buffers(in_, out);
            s.set_flush(i32::try_from(flush).expect("int cast"));
        });
        let this_value = callframe.this();

        this.stream().with_mut(|s| s.do_work());
        if Self::check_error(this, global_this, this_value) {
            this.flush_write_result();
            this.write_in_progress().set(false);
        }
        // SAFETY: matching `ref_()` above. The bracketed `ref_()`/`deref()`
        // can never hit zero while the JS wrapper's +1 is live (we are
        // synchronously inside a host-fn invoked through that wrapper), so the
        // `(&T as *const T).cast_mut()` provenance is sufficient — only the
        // `Cell<u32>` refcount is touched.
        unsafe { T::deref((this as *const T).cast_mut()) };

        Ok(JSValue::UNDEFINED)
    }

    pub fn reset(this: &T, global_this: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
        Self::reset_internal(this, global_this, callframe.this());
        JSValue::UNDEFINED
    }

    fn reset_internal(this: &T, global_this: &JSGlobalObject, this_value: JSValue) {
        // reset() destroys and re-creates the brotli/zstd encoder state (or
        // mutates the z_stream). Doing so while an async write is running on
        // the threadpool would be a use-after-free / data race, so defer it
        // until the in-flight write completes (mirrors pending_close).
        if this.write_in_progress().get() {
            this.pending_reset().set(true);
            return;
        }
        this.pending_reset().set(false);
        if this.closed().get() {
            return;
        }
        let err = this.stream().with_mut(|s| s.reset());
        if err.is_error() {
            Self::emit_error(this, global_this, this_value, err);
        }
    }

    pub fn close(
        this: &T,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::close_internal(this);
        Ok(JSValue::UNDEFINED)
    }

    fn close_internal(this: &T) {
        if this.write_in_progress().get() {
            this.pending_close().set(true);
            return;
        }
        this.pending_close().set(false);
        this.closed().set(true);
        this.this_value().with_mut(|v| v.deinit());
        this.stream().with_mut(|s| s.close());
    }

    pub fn set_on_error(
        _this: &T,
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
    fn check_error(this: &T, global_this: &JSGlobalObject, this_value: JSValue) -> bool {
        let err = this.stream().with_mut(|s| s.get_error_info());
        if !err.is_error() {
            return true;
        }
        Self::emit_error(this, global_this, this_value, err);
        false
    }

    pub fn emit_error(this: &T, global_this: &JSGlobalObject, this_value: JSValue, err_: Error) {
        // R-2: `&T` over `Cell`/`JsCell`-backed fields — the onerror
        // `run_callback` below runs user JS which can re-enter via a fresh
        // `&T` from the wrapper's `m_ctx` (e.g. `write()` flips
        // `write_in_progress` / `pending_*`). Interior mutability makes the
        // re-entry sound and the post-callback reads observe the updated
        // values without `noalias`-laundering.

        // Clear write_in_progress *before* invoking the onerror callback.
        // The callback may re-enter write(), which sets write_in_progress=true
        // and schedules a WorkPool task. If we cleared the flag after the
        // callback, we would clobber that state and closeInternal()/resetInternal()
        // below could free the native zlib/brotli/zstd state while a task is
        // still queued, leading to a use-after-free when the worker thread
        // runs doWork().
        this.write_in_progress().set(false);

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
        let mut code_str =
            BunString::create_format(format_args!("{}", bstr::BStr::new(code_bytes)));
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

        if this.pending_reset().get() {
            Self::reset_internal(this, global_this, this_value);
        }
        if this.pending_close().get() {
            Self::close_internal(this);
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
            // R-2: `this: &Self` — the codegen `host_fn_this` shim still
            // passes `&mut Self` until Phase 1 lands; auto-reborrows to `&Self`.
            #[inline]
            pub fn write(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::write(
                    this, global, frame,
                )
            }
            #[inline]
            pub fn write_sync(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::write_sync(
                    this, global, frame,
                )
            }
            #[inline]
            pub fn reset(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JSValue {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::reset(
                    this, global, frame,
                )
            }
            #[inline]
            pub fn close(
                this: &Self,
                global: &::bun_jsc::JSGlobalObject,
                frame: &::bun_jsc::CallFrame,
            ) -> ::bun_jsc::JsResult<::bun_jsc::JSValue> {
                $crate::node::node_zlib_binding::CompressionStream::<Self>::close(
                    this, global, frame,
                )
            }
            #[inline]
            pub fn set_on_error(
                this: &Self,
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
                this: &Self,
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

            #[inline] fn global_this(&self) -> &::bun_jsc::JSGlobalObject { self.global_this.get() }
            #[inline] fn stream(&self) -> &::bun_jsc::JsCell<Self::Stream> { &self.stream }
            #[inline] fn write_result_ptr(&self) -> Option<*mut u32> { self.write_result.get().map(|p| p.cast::<u32>()) }
            #[inline] fn poll_ref(&self) -> &::bun_jsc::JsCell<$crate::node::node_zlib_binding::CountedKeepAlive> { &self.poll_ref }
            #[inline] fn this_value(&self) -> &::bun_jsc::JsCell<::bun_jsc::StrongOptional> { &self.this_value }
            #[inline] fn task(&self) -> &::bun_jsc::JsCell<::bun_jsc::WorkPoolTask> { &self.task }
            #[inline] fn write_in_progress(&self) -> &::core::cell::Cell<bool> { &self.write_in_progress }
            #[inline] fn pending_close(&self) -> &::core::cell::Cell<bool> { &self.pending_close }
            #[inline] fn pending_reset(&self) -> &::core::cell::Cell<bool> { &self.pending_reset }
            #[inline] fn closed(&self) -> &::core::cell::Cell<bool> { &self.closed }

            #[inline]
            unsafe fn from_task(task: *mut ::bun_jsc::WorkPoolTask) -> *mut Self {
                // SAFETY: `task` points at the `task` field of a live `Self`
                // (Zig `@fieldParentPtr("task", task)`); `from_field_ptr!`
                // computes the byte offset via `offset_of!(Self, task)`.
                unsafe { ::bun_core::from_field_ptr!(Self, task, task) }
            }

            // All three `Native*` structs `#[derive(bun_ptr::CellRefCounted)]`
            // with their own `#[ref_count(destroy = …)]` (or the default
            // `Box::from_raw` drop) — delegate so the macro doesn't hard-code
            // a `Self::deinit(*mut Self)` signature that only one of them has.
            #[inline] fn ref_(&self) { <Self as ::bun_ptr::CellRefCounted>::ref_(self) }
            #[inline] unsafe fn deref(this: *mut Self) {
                // SAFETY: forwarded trait contract — `this` is live; the
                // derived `CellRefCounted::deref` routes zero to the per-type
                // `destroy` (≡ Zig `bun.ptr.RefCount(.., deinit, .{})`).
                unsafe { <Self as ::bun_ptr::CellRefCounted>::deref(this) }
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
