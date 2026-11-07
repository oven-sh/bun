use bun_jsc::{JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};
use bun_core::String as BunString;
use bun_ptr::{JsCell, RefPtr};
use core::cell::Cell;

use crate::generated_bindgen::bun_test::Bun__BunTest__bunTestDoneCallback;
use crate::test_runner::bun_test::{group_begin, BunTest, RefData, RefDataValue};
use crate::test_runner::execution::ExecutionSequence;

pub(crate) struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub(crate) r#ref: JsCell<Option<RefPtr<RefData>>>,
    pub(crate) called: Cell<bool>, // = false
    pub(crate) entry: RefDataValue,
    /// `BunTestRoot::file_generation` at creation. In a later file run, `entry` alone also matches the same preload
    /// hook, and any entry that got the address of a freed one.
    file_generation: u32,
}

const _: () = assert!(core::mem::size_of::<DoneCallback>() == 56);

impl DoneCallback {
    pub(crate) fn create_unbound(global: &JSGlobalObject, entry: RefDataValue, file_generation: u32) -> JSValue {
        let _g = group_begin!();

        let done_callback = DoneCallback {
            r#ref: JsCell::new(None),
            called: Cell::new(false),
            entry,
            file_generation,
        };

        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    /// The sequence that runs the entry this callback was made for. None once that entry is over.
    pub(crate) fn current_sequence<'a>(&self, buntest: &'a mut BunTest) -> Option<&'a mut ExecutionSequence> {
        if self.file_generation != buntest.bun_test_root.file_generation {
            return None;
        }
        let (sequence, _) = buntest.execution.get_current_and_valid_execution_sequence(&self.entry)?;
        Some(sequence)
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
