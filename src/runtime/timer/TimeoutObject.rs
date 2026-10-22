use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

use crate::generated_bindgen::timer::js_Timeout as js;

use super::Kind;

// Struct + `RefCounted`/`Default` impls + the forwarder host-fns
// (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/`dispose`/
// `constructor`/`finalize`/`ref_`/`deref`/`deinit`/`init_with`) — see
// `impl_timer_object!` in `super` (timer/mod.rs).
// `Timeout`, declared in `Timer.bind.ts`.
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout");

impl TimeoutObject {
    pub(crate) fn init(
        cx: &bun_jsc::JsThread<'_>,
        id: u64,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(cx, id, kind, interval, callback, arguments)
    }

    pub(crate) fn do_refresh(
        this: &Self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JSValue {
        this.internals.do_refresh(cx.global(), this_value.to_js())
    }

    pub(crate) fn close<'a>(
        this: &Self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsWrapper<'a, Self> {
        this.internals.cancel(cx.global().bun_vm_ptr());
        this_value
    }

    pub(crate) fn get_idle_start(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::idle_start_get_cached(this_value.to_js()).unwrap()
    }

    pub(crate) fn set_idle_start(
        this: &Self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        let value = value.to_js();
        if let Some(ms) = value.get_number() {
            this.internals.set_idle_start(ms);
        }
        js::idle_start_set_cached(this_value.to_js(), cx.global(), value);
    }
}
