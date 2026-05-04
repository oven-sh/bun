use core::cell::Cell;

use bun_jsc::{CallFrame, EnsureStillAlive, JSGlobalObject, JSValue, JsResult};
use bun_jsc::Debugger;

use super::{EventLoopTimer, Kind, TimerObjectInternals, ID};
use super::event_loop_timer::Tag as EventLoopTimerTag;

// `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})` — intrusive single-thread refcount.
// `ref`/`deref` are provided by `bun_ptr::IntrusiveRc<TimeoutObject>`; when the count hits
// zero it invokes `deinit` (below), which drops `internals` and frees the box.
pub type RefCount = bun_ptr::IntrusiveRc<TimeoutObject>;

// `jsc.Codegen.JSTimeout` — the `.classes.ts` codegen module for this type.
// `to_js` / `from_js` / `from_js_direct` are wired by `#[bun_jsc::JsClass]`.
// The cached-property accessors (`callback_get_cached`, etc.) live in this generated module.
// TODO(port): codegen — emit `js` module from `generate-classes.ts` with .rs output
pub use self::js::{from_js, from_js_direct, to_js};
pub mod js {
    use super::*;
    extern "C" {
        // TODO(port): move to <area>_sys — these are codegen'd C++ shims
    }
    pub fn callback_get_cached(_this_value: JSValue) -> Option<JSValue> { todo!("codegen") }
    pub fn callback_set_cached(_this_value: JSValue, _global: &JSGlobalObject, _value: JSValue) { todo!("codegen") }
    pub fn idle_timeout_get_cached(_this_value: JSValue) -> Option<JSValue> { todo!("codegen") }
    pub fn idle_timeout_set_cached(_this_value: JSValue, _global: &JSGlobalObject, _value: JSValue) { todo!("codegen") }
    pub fn repeat_get_cached(_this_value: JSValue) -> Option<JSValue> { todo!("codegen") }
    pub fn repeat_set_cached(_this_value: JSValue, _global: &JSGlobalObject, _value: JSValue) { todo!("codegen") }
    pub fn idle_start_get_cached(_this_value: JSValue) -> Option<JSValue> { todo!("codegen") }
    pub fn idle_start_set_cached(_this_value: JSValue, _global: &JSGlobalObject, _value: JSValue) { todo!("codegen") }
    pub fn to_js(_this: *mut TimeoutObject, _global: &JSGlobalObject) -> JSValue { todo!("codegen") }
    pub fn from_js(_value: JSValue) -> Option<*mut TimeoutObject> { todo!("codegen") }
    pub fn from_js_direct(_value: JSValue) -> Option<*mut TimeoutObject> { todo!("codegen") }
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
            event_loop_timer: EventLoopTimer {
                next: super::Timespec::EPOCH,
                tag: EventLoopTimerTag::TimeoutObject,
                ..Default::default()
            },
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

        if global.bun_vm().is_inspector_enabled() {
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

    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        // TODO(port): narrow error set
        Err(global.throw("Timeout is not constructible", format_args!("")))
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
    pub fn get_destroyed(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.internals.get_destroyed())
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JSValue {
        this.internals.cancel(global.bun_vm());
        frame.this()
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
