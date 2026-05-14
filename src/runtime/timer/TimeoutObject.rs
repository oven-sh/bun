use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Kind;

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

// Struct + `RefCounted`/`Default` impls + the forwarder host-fns
// (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/`dispose`/
// `constructor`/`finalize`/`ref_`/`deref`/`deinit`/`init_with`) — see
// `impl_timer_object!` in `super` (timer/mod.rs).
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout");

impl TimeoutObject {
    pub fn init(
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32, // Zig: u31
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(global, id, kind, interval, callback, arguments)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_refresh(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.internals.do_refresh(global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    pub fn set_on_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::callback_set_cached(this_value, global, value);
    }

    pub fn get_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::idle_timeout_get_cached(this_value).unwrap()
    }

    pub fn set_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::idle_timeout_set_cached(this_value, global, value);
    }

    pub fn get_repeat(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::repeat_get_cached(this_value).unwrap()
    }

    pub fn set_repeat(_this: &Self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::repeat_set_cached(this_value, global, value);
    }

    pub fn get_idle_start(_this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::idle_start_get_cached(this_value).unwrap()
    }

    pub fn set_idle_start(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::idle_start_set_cached(this_value, global, value);
    }
}

// ported from: src/runtime/timer/TimeoutObject.zig
