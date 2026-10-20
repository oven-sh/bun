use bun_jsc::{JSGlobalObject, JSValue};

use crate::generated_bindgen::timer::js_Timeout as js;

use super::Kind;

// Struct + `RefCounted`/`Default` impls + the forwarder host-fns
// (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/`dispose`/
// `constructor`/`finalize`/`ref_`/`deref`/`deinit`/`init_with`) — see
// `impl_timer_object!` in `super` (timer/mod.rs).
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout");

impl TimeoutObject {
    pub(crate) fn init(
        cx: &bun_jsc::JsThread<'_>,
        id: i32,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(cx, id, kind, interval, callback, arguments)
    }

    pub(crate) fn do_refresh(this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JSValue {
        this.internals.do_refresh(global, this_value)
    }

    pub(crate) fn close(this: &Self, this_value: JSValue, global: &JSGlobalObject) -> JSValue {
        this.internals.cancel(global.bun_vm_ptr());
        this_value
    }

    pub(crate) fn get_idle_start(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::idle_start_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_start(
        this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        if let Some(ms) = value.get_number() {
            this.internals.set_idle_start(ms);
        }
        js::idle_start_set_cached(this_value, global, value);
    }
}
