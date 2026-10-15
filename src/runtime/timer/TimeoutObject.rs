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
        cx: &bun_jsc::JsThread<'_>,
        id: i32,
        kind: Kind,
        interval: u32,
        callback: JSValue,
        arguments: JSValue,
    ) -> JSValue {
        Self::init_with(cx, id, kind, interval, callback, arguments)
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
    pub(crate) fn close(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.internals.cancel(global.bun_vm_ptr());
        Ok(frame.this())
    }

    /// Native half of node's `[nodejs.util.inspect.custom]` method: what the getters give, in node's order.
    pub(crate) fn inspect_custom(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let slot = |value: Option<JSValue>| value.unwrap_or(JSValue::UNDEFINED);
        let fields = JSValue::create_empty_object(global, 5);
        fields.put(
            global,
            b"_idleTimeout",
            slot(js::idle_timeout_get_cached(this_value)),
        );
        fields.put(
            global,
            b"_idleStart",
            slot(js::idle_start_get_cached(this_value)),
        );
        fields.put(
            global,
            b"_onTimeout",
            slot(js::callback_get_cached(this_value)),
        );
        fields.put(global, b"_repeat", slot(js::repeat_get_cached(this_value)));
        fields.put(
            global,
            b"_destroyed",
            JSValue::from(this.internals.get_destroyed()),
        );
        crate::webcore::node_inspect::print(global, callframe, this_value, fields, c"Timeout")
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
