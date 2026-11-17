use bun_jsc::{JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};
use bun_core::String as BunString;
use bun_ptr::RefPtr;
use core::cell::Cell;

use crate::generated_bindgen::bun_test::Bun__BunTest__bunTestDoneCallback;
use crate::test_runner::bun_test::{group_begin, BunTest, RefData, RefDataValue};
use crate::test_runner::execution::ExecutionSequence;

pub(crate) struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub(crate) r#ref: Cell<Option<RefPtr<RefData>>>,
    pub(crate) called: Cell<bool>, // = false
    pub(crate) entry: RefDataValue,
    /// `BunTest::generation` of the file that `entry` is in.
    generation: u32,
}

impl DoneCallback {
    pub(crate) fn create_unbound(global: &JSGlobalObject, entry: RefDataValue, generation: u32) -> JSValue {
        let _g = group_begin!();

        let done_callback = DoneCallback {
            r#ref: Cell::new(None),
            called: Cell::new(false),
            entry,
            generation,
        };

        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    /// The sequence that still waits for this callback.
    pub(crate) fn running_sequence<'a>(&self, buntest: &'a BunTest) -> Option<&'a ExecutionSequence> {
        if self.generation != buntest.generation {
            return None;
        }
        Some(buntest.execution.get_current_and_valid_execution_sequence(&self.entry)?.0)
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
