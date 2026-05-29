use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Kind;

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
