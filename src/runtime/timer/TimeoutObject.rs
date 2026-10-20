use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsWrapper};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::RefPtr;

use super::{Kind, TimerObjectInternals};
use crate::generated_bindgen::timer::{TimeoutClass, TimeoutInternalFields as _};

// The struct, its `RefCounted` impl and the methods shared with `ImmediateObject` come from `impl_timer_object!` (timer/mod.rs).
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout", TimeoutClass, {
    fn do_refresh<'a>(
        &self,
        this: JsWrapper<'a, RefPtr<Self>>,
        heap: &JsHeap<'a>,
    ) -> JsWrapper<'a, RefPtr<Self>> {
        TimerObjectInternals::do_refresh(self, this, heap);
        this
    }

    fn close<'a>(&self, this: JsWrapper<'a, RefPtr<Self>>) -> JsWrapper<'a, RefPtr<Self>> {
        self.internals.cancel(VirtualMachine::get_mut_ptr());
        this
    }

    fn idle_start<'a>(&self, this: JsWrapper<'a, RefPtr<Self>>, heap: &JsHeap<'a>) -> JsLocal<'a> {
        this.idle_start_field(heap)
    }

    fn set_idle_start<'a>(
        &self,
        this: JsWrapper<'a, RefPtr<Self>>,
        heap: &JsHeap<'a>,
        value: JsLocal<'a>,
    ) {
        if let Some(ms) = value.to_js().get_number() {
            self.internals.set_idle_start(ms);
        }
        this.set_idle_start_field(heap, value);
    }
});

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
}
