use bun_jsc::Debugger;
use bun_jsc::{CallFrame, EnsureStillAlive, JSGlobalObject, JSValue, JsClass, JsResult};
use bun_ptr::{RefCount, RefCounted};

use super::{EventLoopTimer, EventLoopTimerTag, Kind, TimerObjectInternals, ID};

/// `jsc.Codegen.JSTimeout` — the `.classes.ts` codegen module for this type.
///
/// `toJS` / `fromJS` / `fromJSDirect` and the `Timeout__create` /
/// `Timeout__fromJS` / `Timeout__fromJSDirect` externs are emitted by
/// `#[bun_jsc::JsClass(name = "Timeout")]` on the struct below (see
/// `jsc_macros::js_class_hooks`); only the cached-property accessors —
/// `${name}GetCached` / `${name}SetCached` per `cache: true` prop — are
/// declared here.
pub mod js {
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
}

#[bun_jsc::JsClass(name = "Timeout")]
pub struct TimeoutObject {
    pub ref_count: RefCount<Self>,
    pub event_loop_timer: EventLoopTimer,
    pub internals: TimerObjectInternals,
}

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread
// refcount mixin. The Zig comptime params (`field_name`, `destructor`, `options`)
// map to `RefCounted::{get_ref_count, destructor, DestructorCtx}`.
impl RefCounted for TimeoutObject {
    type DestructorCtx = ();

    #[inline]
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live `Self`.
        unsafe { &raw mut (*this).ref_count }
    }

    #[inline]
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: `raw_count == 0` ⇒ unique ownership; `deinit` consumes the
        // `heap::alloc`'d allocation from `init()`.
        unsafe { Self::deinit(this) }
    }
}

impl Default for TimeoutObject {
    fn default() -> Self {
        Self {
            ref_count: RefCount::init(),
            // Zig: `.{ .next = .epoch, .tag = .TimeoutObject }` — `init_paused`
            // is exactly that (next=EPOCH, state=PENDING, heap zeroed).
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::TimeoutObject),
            // PORT NOTE: Zig left `internals = undefined` and assigned in `init()`;
            // Rust default-constructs then overwrites — same observable behavior.
            internals: TimerObjectInternals::default(),
        }
    }
}

impl TimeoutObject {
    // Zig: `pub const ref = RefCount.ref; pub const deref = RefCount.deref;`
    // — re-export the mixin's ops as inherent fns so `TimerObjectInternals`'s
    // `@fieldParentPtr` dispatch (`TimeoutObject::ref_`/`::deref`) resolves.

    /// Increment the intrusive refcount.
    ///
    /// # Safety
    /// `this` must point to a live, `heap::alloc`-allocated `TimeoutObject`.
    #[inline]
    pub unsafe fn ref_(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<Self>::ref_(this) }
    }

    /// Decrement the intrusive refcount; on zero runs [`deinit`](Self::deinit)
    /// (drops `internals`, frees the `Box`). After this returns `this` may dangle.
    ///
    /// # Safety
    /// `this` must point to a live, `heap::alloc`-allocated `TimeoutObject`.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract.
        unsafe { RefCount::<Self>::deref(this) }
    }

    pub fn init(
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32, // Zig: u31
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        // internals are initialized by init()
        // `bun.new(Self, .{...})` ⇒ heap-allocate; `*mut Self` is the `m_ctx`
        // payload of the codegen'd JSCell wrapper. Ownership transfers to the
        // wrapper via `to_js_ptr`; freed by `deref → deinit → heap::take`.
        let timeout: *mut Self = bun_core::heap::into_raw(Box::new(Self::default()));
        // SAFETY: `to_js_ptr` is the `#[JsClass]`-generated `Timeout__create`
        // shim; `timeout` is a fresh heap payload whose ownership transfers to
        // the GC wrapper.
        let js_value = unsafe { Self::to_js_ptr(timeout, global) };
        // Zig codegen: `bun.assert(value__.as(Timeout).? == this)` — round-trip ABI check.
        debug_assert!(
            <Self as JsClass>::from_js(js_value) == Some(timeout),
            "Timeout__create ABI mismatch",
        );
        let _keep = EnsureStillAlive(js_value);
        // SAFETY: `timeout` was just allocated above and is exclusively owned here;
        // `internals.init()` writes every field via `*self = Self { … }`.
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
        if global.bun_vm().as_mut().is_inspector_enabled() {
            Debugger::did_schedule_async_call(
                global,
                Debugger::AsyncCallType::DOMTimer,
                ID { id, kind: kind.big() }.async_id(),
                kind != Kind::SetInterval,
            );
        }

        js_value
    }

    /// Called via [`RefCounted::destructor`] when the refcount reaches zero.
    /// Not `impl Drop`: this fn frees the backing `Box` itself (Zig: `bun.destroy(self)`).
    ///
    /// # Safety
    /// `this` must be the unique owner (refcount == 0) of a `heap::alloc`'d `Self`.
    unsafe fn deinit(this: *mut Self) {
        // SAFETY: `this` was allocated via `heap::alloc` in `init` and the refcount
        // has reached zero, so we hold the unique reference.
        unsafe {
            (*this).internals.deinit();
            drop(bun_core::heap::take(this));
        }
    }

    // C-ABI shim (`TimeoutClass__construct`) is emitted by `#[bun_jsc::JsClass]`
    // on the struct via `host_fn_construct_result`; do not also annotate with
    // `#[host_fn]` here — its `Free`-kind expansion calls `constructor(..)` as
    // a bare path, which fails to resolve inside an `impl` block.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw(format_args!("Timeout is not constructible")))
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
        this.internals.cancel(global.bun_vm_ptr());
        Ok(frame.this())
    }

    // Cached-property getters/setters — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Signature does not match the standard `host_fn(getter/setter)` shape; the
    // `#[JsClass]` derive emits the C-ABI shims directly.

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
        this.internals.cancel(global.bun_vm_ptr());
        Ok(JSValue::UNDEFINED)
    }
}

// ported from: src/runtime/timer/TimeoutObject.zig
