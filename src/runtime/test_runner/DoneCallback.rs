use bun_jsc::{JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};
use bun_core::String as BunString;
use bun_ptr::{JsCell, RefPtr};
use core::cell::Cell;

use crate::generated_bindgen::bun_test::Bun__BunTest__bunTestDoneCallback;
use crate::test_runner::bun_test::{group_begin, RefData};

pub(crate) struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub(crate) r#ref: JsCell<Option<RefPtr<RefData>>>,
    pub(crate) called: Cell<bool>, // = false
}

impl DoneCallback {
    pub(crate) fn create_unbound(global: &JSGlobalObject) -> JSValue {
        let _g = group_begin!();

        let done_callback = DoneCallback {
            r#ref: JsCell::new(None),
            called: Cell::new(false),
        };

        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    pub(crate) fn bind(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let call_fn = JSFunction::create(
            global,
            "done",
            Bun__BunTest__bunTestDoneCallback,
            1,
            Default::default(),
        );
        call_fn.bind(global, value, &BunString::static_("done"), 1.0, &[])
    }
}
