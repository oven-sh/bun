use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};
use bun_str::String as BunString;

use crate::test_runner::bun_test::{group_begin, BunTest, RefDataPtr};
use crate::test_runner::expect::JSValueTestExt as _;

#[bun_jsc::JsClass(no_construct, no_constructor)] // codegen wires to_js / from_js (Zig: jsc.Codegen.JSDoneCallback)
pub struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub r#ref: Option<RefDataPtr>,
    pub called: bool, // = false
}

impl DoneCallback {
    pub fn finalize(this: *mut DoneCallback) {
        let _g = group_begin!();

        // SAFETY: `this` was `Box::into_raw`'d by `JsClass::to_js` in
        // `create_unbound`; finalize is called exactly once by JSC lazy sweep.
        // Dropping the Box drops `r#ref` (Rc::drop == deref) and frees the
        // allocation (== allocator.destroy).
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn create_unbound(global: &JSGlobalObject) -> JSValue {
        let _g = group_begin!();

        let done_callback = DoneCallback {
            r#ref: None,
            called: false,
        };

        // `JsClass::to_js` boxes `self` and hands the raw pointer to the JS
        // wrapper (m_ctx); freed in `finalize`.
        let value = done_callback.to_js(global);
        value.ensure_still_alive();
        value
    }

    pub fn bind(value: JSValue, global: &JSGlobalObject) -> JsResult<JSValue> {
        let call_fn = JSFunction::create(
            global,
            "done",
            __jsc_host_bun_test_done_callback,
            1,
            Default::default(),
        );
        call_fn.bind(global, value, &BunString::static_str("done"), 1.0, &[])
    }
}

/// Raw C-ABI shim for [`BunTest::bun_test_done_callback`] so it can be passed
/// as a `JSHostFn` pointer to `JSFunction::create` (Zig used comptime
/// `toJSHostFn`; Rust mints the thunk explicitly and routes the result through
/// `to_js_host_fn_result` for `JsResult` → `JSValue` mapping + debug exception
/// assertions).
unsafe extern "C" fn __jsc_host_bun_test_done_callback(
    g: *mut JSGlobalObject,
    f: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the duration of the host call.
    let global = unsafe { &*g };
    let callframe = unsafe { &*f };
    bun_jsc::to_js_host_fn_result(global, BunTest::bun_test_done_callback(global, callframe))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/DoneCallback.zig (46 lines)
//   confidence: medium
//   todos:      1
//   notes:      LIFETIMES.tsv says Rc<RefData> but RefData uses intrusive bun.ptr.RefCount — Phase B may need IntrusiveRc; groupLog begin/end mapped to group_begin!() RAII GroupGuard
// ──────────────────────────────────────────────────────────────────────────
