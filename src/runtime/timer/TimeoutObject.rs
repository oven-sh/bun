use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};

use crate::generated_bindgen::timer::js_Timeout as js;

use super::{EventLoopTimerTag, TimerObject};

/// `Timeout`, declared in `Timer.bind.ts`.
pub(crate) type TimeoutObject = TimerObject<{ EventLoopTimerTag::TimeoutObject }>;

bun_event_loop::impl_timer_owner!(TimeoutObject; event_loop_timer: RefCountedTimer<TimeoutObject>);

impl TimeoutObject {
    pub(crate) fn close<'a>(
        this: &Self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
    ) -> JsWrapper<'a, Self> {
        this.cancel(cx.global().bun_vm());
        this_value
    }

    pub(crate) fn get_on_timeout(&self, this_value: JsWrapper<'_, Self>) -> JSValue {
        js::callback_get_cached(this_value.to_js())
            .unwrap()
            .without_async_context()
    }

    pub(crate) fn set_on_timeout(
        _this: &Self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        value: JsLocal<'_>,
    ) {
        js::callback_set_cached(this_value.to_js(), cx.global(), value.to_js());
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
            this.reschedule_from_idle_start(ms);
        }
        js::idle_start_set_cached(this_value.to_js(), cx.global(), value);
    }
}
