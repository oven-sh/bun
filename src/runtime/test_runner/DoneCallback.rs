use core::cell::Cell;

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};

use crate::test_runner::bun_test::{BunTest, RefDataPtr, group_begin};

// R-2 (host-fn re-entrancy): reached through `&self` from JS; both fields are
// `Cell`s so the `done()` host fn and `run_test_callback` can update them
// through the shared borrow `as_class_ref` hands out.
#[bun_jsc::JsClass(no_construct, no_constructor)] // codegen wires to_js / from_js
pub struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub(crate) r#ref: Cell<Option<RefDataPtr>>,
    pub(crate) called: Cell<bool>, // = false
}

impl DoneCallback {
    pub(crate) fn create_unbound(global: &JSGlobalObject) -> JSValue {
        let _g = group_begin!();

        let done_callback = DoneCallback {
            r#ref: Cell::new(None),
            called: Cell::new(false),
        };

        // `JsClass::to_js` boxes `self` and hands the raw pointer to the JS
        // wrapper (m_ctx); freed in `finalize`.
        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    pub(crate) fn bind(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let call_fn = JSFunction::create(
            global,
            "done",
            __jsc_host_call_done_callback,
            1,
            Default::default(),
        );
        call_fn.bind(global, value, &BunString::static_("done"), 1.0, &[])
    }
}

#[bun_jsc::host_fn]
fn call_done_callback(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let Some(this) = callframe.this().as_class_ref::<DoneCallback>() else {
        return Err(global.throw(format_args!("Expected callee to be DoneCallback")));
    };
    BunTest::bun_test_done_callback(this, global, callframe)
}
