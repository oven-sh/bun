use bun_jsc::generated::JSTimeout as js;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Kind;

// Struct + `RefCounted`/`Default` impls + the forwarder host-fns
// (`to_primitive`/`do_ref`/`do_unref`/`has_ref`/`get_destroyed`/`dispose`/
// `constructor`/`finalize`/`ref_`/`deref`/`deinit`/`init_with`) — see
// `impl_timer_object!` in `super` (timer/mod.rs).
super::impl_timer_object!(TimeoutObject, TimeoutObject, "Timeout");

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
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.internals.do_refresh(global, frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.before_explicit_cancel(global, frame.this());
        this.internals.cancel(global.bun_vm_ptr());
        Ok(frame.this())
    }

    /// Node's `unenroll`: an explicitly cancelled timer reads back `_idleTimeout === -1`.
    pub(crate) fn mark_unenrolled(this_value: JSValue, global: &JSGlobalObject) {
        js::idle_timeout_set_cached(this_value, global, JSValue::js_number(-1.0));
    }

    /// `impl_timer_object!`'s `dispose` hook.
    pub(crate) fn before_explicit_cancel(&self, global: &JSGlobalObject, this_value: JSValue) {
        Self::mark_unenrolled(this_value, global);
    }

    // Cached-property getters/setters — codegen passes `this_value` (the JS
    // wrapper) so the cached `WriteBarrier` slot on the C++ side can be read/written.
    // Signature does not match the standard `host_fn(getter/setter)` shape; the
    // `#[JsClass]` derive emits the C-ABI shims directly.

    pub(crate) fn get_on_timeout(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::callback_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_on_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::callback_set_cached(this_value, global, value);
    }

    pub(crate) fn get_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::idle_timeout_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_idle_timeout(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::idle_timeout_set_cached(this_value, global, value);
    }

    pub(crate) fn get_repeat(
        _this: &Self,
        this_value: JSValue,
        _global: &JSGlobalObject,
    ) -> JSValue {
        js::repeat_get_cached(this_value).unwrap()
    }

    pub(crate) fn set_repeat(
        _this: &Self,
        this_value: JSValue,
        global: &JSGlobalObject,
        value: JSValue,
    ) {
        js::repeat_set_cached(this_value, global, value);
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
