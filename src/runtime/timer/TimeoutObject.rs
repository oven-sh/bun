use core::cell::Cell;

use bun_jsc::{CallFrame, EnsureStillAlive, JSGlobalObject, JSValue, JsResult};
use bun_jsc::Debugger;

use super::{EventLoopTimer, EventLoopTimerTag, Kind, TimerObjectInternals, ID};

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
// `ref`/`deref` are provided by `bun_ptr::IntrusiveRc<TimeoutObject>`; when the count hits
// zero it invokes `deinit` (below), which drops `internals` and frees the box.
pub type RefCount = bun_ptr::IntrusiveRc<TimeoutObject>;

// `jsc.Codegen.JSTimeout` — the `.classes.ts` codegen module for this type.
// Hand-expansion of what `src/codegen/generate-classes.ts` emits into
// `ZigGeneratedClasses.zig` for `pub const JSTimeout = struct { ... }`:
// `${name}GetCached` / `${name}SetCached` per `cache: true` prop, plus
// `toJS` / `fromJS` / `fromJSDirect` thin-wrapping the C++-side
// `Timeout__create` / `Timeout__fromJS` / `Timeout__fromJSDirect` shims.
pub use self::js::{from_js, from_js_direct, to_js};
pub mod js {
    use super::{JSGlobalObject, JSValue, TimeoutObject};

    // One `${snake}_get_cached` / `${snake}_set_cached` pair per cached prop,
    // each wrapping `TimeoutPrototype__${prop}{Get,Set}CachedValue` and mapping
    // `.zero` → `None` on the get side (matches Zig `${name}GetCached`).
    bun_jsc::codegen_cached_accessors!(
        "Timeout";
        arguments,
        callback,
        idleTimeout,
        repeat,
        idleStart,
    );

    // `callconv(jsc.conv)` — sysv64 on x86_64-windows, C ABI elsewhere.
    // `*mut c_void` for the payload: the C++ side treats `m_ctx` as an opaque
    // pointer, and `TimeoutObject` is intentionally Rust-layout (its
    // `EventLoopTimer` field is not `#[repr(C)]`). Cast at the wrapper
    // boundary below — same shape as the `JsClass` proc-macro hooks.
    #[cfg(all(windows, target_arch = "x86_64"))]
    unsafe extern "sysv64" {
        #[link_name = "Timeout__fromJS"]
        fn Timeout__fromJS(value: JSValue) -> *mut core::ffi::c_void;
        #[link_name = "Timeout__fromJSDirect"]
        fn Timeout__fromJSDirect(value: JSValue) -> *mut core::ffi::c_void;
        #[link_name = "Timeout__create"]
        fn Timeout__create(global: *mut JSGlobalObject, ptr: *mut core::ffi::c_void) -> JSValue;
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    unsafe extern "C" {
        #[link_name = "Timeout__fromJS"]
        fn Timeout__fromJS(value: JSValue) -> *mut core::ffi::c_void;
        #[link_name = "Timeout__fromJSDirect"]
        fn Timeout__fromJSDirect(value: JSValue) -> *mut core::ffi::c_void;
        #[link_name = "Timeout__create"]
        fn Timeout__create(global: *mut JSGlobalObject, ptr: *mut core::ffi::c_void) -> JSValue;
    }

    /// Create a new `JSTimeout` JSCell wrapping `this` as its `m_ctx`.
    /// Ownership of `this` transfers to the wrapper; freed via `finalize`.
    #[inline]
    pub fn to_js(this: *mut TimeoutObject, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global.as_ptr()` yields the FFI `*mut` via the opaque
        // `UnsafeCell` handle (interior-mutable provenance — sound for C++ to
        // write through; see `JSGlobalObject::as_ptr`). `this` was
        // `Box::into_raw`'d by caller and ownership transfers to the wrapper.
        let value = unsafe { Timeout__create(global.as_ptr(), this.cast()) };
        #[cfg(debug_assertions)]
        {
            // Zig: `bun.assert(value__.as(Timeout).? == this)` — round-trip ABI check.
            debug_assert!(from_js(value) == Some(this), "Timeout__create ABI mismatch");
        }
        value
    }

    /// Return the wrapped `m_ctx` pointer, or `None` on type mismatch.
    #[inline]
    pub fn from_js(value: JSValue) -> Option<*mut TimeoutObject> {
        // SAFETY: pure FFI downcast; C++ returns null on mismatch.
        let p = unsafe { Timeout__fromJS(value) };
        if p.is_null() { None } else { Some(p.cast::<TimeoutObject>()) }
    }

    /// Like [`from_js`] but rejects subclasses / mutated structures.
    #[inline]
    pub fn from_js_direct(value: JSValue) -> Option<*mut TimeoutObject> {
        // SAFETY: pure FFI downcast; C++ returns null on mismatch.
        let p = unsafe { Timeout__fromJSDirect(value) };
        if p.is_null() { None } else { Some(p.cast::<TimeoutObject>()) }
    }
}

#[bun_jsc::JsClass]
pub struct TimeoutObject {
    pub ref_count: Cell<u32>,
    pub event_loop_timer: EventLoopTimer,
    pub internals: TimerObjectInternals,
}

impl Default for TimeoutObject {
    fn default() -> Self {
        Self {
            ref_count: Cell::new(1),
            // Zig: `.{ .next = .epoch, .tag = .TimeoutObject }` — `init_paused`
            // is exactly that (next=EPOCH, state=PENDING, heap zeroed).
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::TimeoutObject),
            // TODO(port): in-place init — Zig used `undefined`; overwritten by `internals.init()`
            internals: TimerObjectInternals::default(),
        }
    }
}

impl TimeoutObject {
    pub fn init(
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32, // Zig: u31
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        // internals are initialized by init()
        // SAFETY: `*mut Self` is the `m_ctx` payload of the codegen'd JSCell wrapper;
        // ownership transfers to the wrapper via `to_js`. Freed by `deinit` when the
        // intrusive refcount hits zero.
        let timeout: *mut Self = Box::into_raw(Box::new(Self::default()));
        let js_value = js::to_js(timeout, global);
        let _keep = EnsureStillAlive(js_value);
        // SAFETY: `timeout` was just allocated above and is exclusively owned here.
        unsafe {
            (*timeout).internals.init(
                js_value,
                global,
                id,
                kind,
                interval,
                callback,
                arguments,
            );
        }

        // SAFETY: `bun_vm()` returns the live per-thread VM pointer (non-null on the JS thread).
        if unsafe { (*global.bun_vm()).is_inspector_enabled() } {
            Debugger::did_schedule_async_call(
                global,
                Debugger::AsyncCallType::DOMTimer,
                ID::async_id(ID { id, kind: kind.big() }),
                kind != Kind::SetInterval,
            );
        }

        js_value
    }

    /// Called by `IntrusiveRc` when the refcount reaches zero.
    /// Not `impl Drop`: this fn frees the backing `Box` itself (Zig: `bun.destroy(self)`).
    fn deinit(this: *mut Self) {
        // SAFETY: `this` was allocated via `Box::into_raw` in `init` and the refcount
        // has reached zero, so we hold the unique reference.
        unsafe {
            (*this).internals.deinit();
            drop(Box::from_raw(this));
        }
    }

    // C-ABI shim (`TimeoutClass__construct`) is emitted by `#[bun_jsc::JsClass]`
    // on the struct via `host_fn_construct_result`; do not also annotate with
    // `#[host_fn]` here — its `Free`-kind expansion calls `constructor(..)` as
    // a bare path, which fails to resolve inside an `impl` block.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw("Timeout is not constructible"))
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_primitive(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.to_primitive()
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.do_ref(global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.do_unref(global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_refresh(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.do_refresh(global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn has_ref(this: &mut Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.has_ref()
    }

    /// `.classes.ts` `finalize: true` — runs on the mutator thread during lazy sweep.
    /// Do not touch any `JSValue`/`Strong` content here.
    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen'd C++ `JSTimeout::~JSTimeout` finalizer with the
        // `m_ctx` pointer; the wrapper guarantees `this` is valid.
        unsafe { (*this).internals.finalize() }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_destroyed(this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::from(this.internals.get_destroyed()))
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.cancel(global.bun_vm());
        Ok(frame.this())
    }

    // TODO(port): cached-property getters/setters — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Signature does not match the standard `host_fn(getter/setter)` shape.

    pub fn get_on_timeout(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::callback_get_cached(this_value).unwrap()
    }

    pub fn set_on_timeout(_this: &mut Self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::callback_set_cached(this_value, global, value);
    }

    pub fn get_idle_timeout(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::idle_timeout_get_cached(this_value).unwrap()
    }

    pub fn set_idle_timeout(_this: &mut Self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::idle_timeout_set_cached(this_value, global, value);
    }

    pub fn get_repeat(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::repeat_get_cached(this_value).unwrap()
    }

    pub fn set_repeat(_this: &mut Self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::repeat_set_cached(this_value, global, value);
    }

    pub fn get_idle_start(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::idle_start_get_cached(this_value).unwrap()
    }

    pub fn set_idle_start(_this: &mut Self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::idle_start_set_cached(this_value, global, value);
    }

    #[bun_jsc::host_fn(method)]
    pub fn dispose(this: &mut Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.internals.cancel(global.bun_vm());
        Ok(JSValue::UNDEFINED)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/timer/TimeoutObject.zig (144 lines)
//   confidence: medium
//   todos:      5
//   notes:      .classes.ts codegen (JSTimeout) stubbed; cached-prop getter/setter ABI + internals in-place init need Phase B wiring
// ──────────────────────────────────────────────────────────────────────────
