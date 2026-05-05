use std::rc::Rc;

use bun_jsc::{JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_str::String as BunString;

use crate::bun_test::{self, BunTest, RefData};
use crate::bun_test::debug::group as group_log;

#[bun_jsc::JsClass] // codegen wires to_js / from_js (Zig: jsc.Codegen.JSDoneCallback)
pub struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub r#ref: Option<Rc<RefData>>,
    pub called: bool, // = false
}

impl DoneCallback {
    pub fn finalize(this: *mut DoneCallback) {
        // TODO(port): group_log begin(@src())/end() as RAII scope guard
        let _g = group_log.enter();

        // SAFETY: `this` was `Box::into_raw`'d in `create_unbound`; finalize is called
        // exactly once by JSC lazy sweep. Dropping the Box drops `r#ref`
        // (Rc::drop == deref) and frees the allocation (== allocator.destroy).
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn create_unbound(global: &JSGlobalObject) -> JSValue {
        // TODO(port): group_log begin(@src())/end() as RAII scope guard
        let _g = group_log.enter();

        let done_callback = Box::new(DoneCallback {
            r#ref: None,
            called: false,
        });

        // Ownership of the Box transfers to the JS wrapper (m_ctx); freed in `finalize`.
        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    pub fn bind(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let call_fn = JSFunction::create(
            global,
            "done",
            BunTest::bun_test_done_callback,
            1,
            Default::default(),
        );
        call_fn.bind(global, value, &BunString::static_str("done"), 1, &[])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/DoneCallback.zig (46 lines)
//   confidence: medium
//   todos:      2
//   notes:      LIFETIMES.tsv says Rc<RefData> but RefData uses intrusive bun.ptr.RefCount — Phase B may need IntrusiveRc; group_log begin/end mapped to RAII .enter() guard
// ──────────────────────────────────────────────────────────────────────────
