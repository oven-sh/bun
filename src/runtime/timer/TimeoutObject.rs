use core::cell::Cell;

use bun_jsc::generated::JSTimeout as js;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_ptr::{JsCell, RefPtr, ThisPtr};

use super::{EventLoopTimer, IdMap, Kind, Maps, TimerObject, TimerObjectInternals};

// Struct + `RefCounted`/`Drop` impls + the forwarder host-fns
// (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/`dispose`/
// `constructor`/`finalize`/`init_with`) — see `impl_timer_object!` in `super`
// (timer/mod.rs).
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout");

impl TimerObject for TimeoutObject {
    #[inline]
    fn internals(&self) -> &TimerObjectInternals {
        &self.internals
    }
    #[inline]
    fn event_loop_timer(&self) -> &JsCell<EventLoopTimer> {
        &self.event_loop_timer
    }
    #[inline]
    fn heap_ref(&self) -> &Cell<Option<RefPtr<Self>>> {
        &self.heap_ref
    }
    #[inline]
    fn id_map(maps: &mut Maps, kind: Kind) -> &mut IdMap<Self> {
        match kind {
            Kind::SetInterval => &mut maps.set_interval,
            _ => &mut maps.set_timeout,
        }
    }
}

impl TimeoutObject {
    pub(crate) fn init(
        global: &JSGlobalObject,
        id: i32,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(global, id, kind, interval, callback, arguments)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_refresh(
        this: ThisPtr<Self>,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        TimerObject::do_refresh(this, global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        this: ThisPtr<Self>,
        _global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        TimerObject::cancel(this);
        Ok(frame.this())
    }

    // Cached-property getters/setters — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Signature does not match the standard `host_fn(getter/setter)` shape; the
    // `#[JsClass]` derive emits the C-ABI shims directly.

    pub(crate) fn get_on_timeout(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::callback_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_on_timeout(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::callback_set_cached(this_value, global, value);
    }

    pub(crate) fn get_idle_timeout(
        &self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::idle_timeout_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_timeout(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::idle_timeout_set_cached(this_value, global, value);
    }

    pub(crate) fn get_repeat(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::repeat_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_repeat(&self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::repeat_set_cached(this_value, global, value);
    }

    pub(crate) fn get_idle_start(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::idle_start_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_start(
        &self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        if let Some(ms) = value.get_number() {
            TimerObject::set_idle_start(self, ms);
        }
        js::idle_start_set_cached(this_value, global, value);
    }
}
