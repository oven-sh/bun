use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsClass as _, JsResult};
use bun_core::String as BunString;

use crate::test_runner::bun_test::{group_begin, BunTest, RefDataPtr};
use crate::test_runner::expect::JSValueTestExt as _;

#[bun_jsc::JsClass(no_construct, no_constructor)] // codegen wires to_js / from_js (Zig: jsc.Codegen.JSDoneCallback)
pub struct DoneCallback {
    /// Some = not called yet. None = done already called, no-op.
    pub r#ref: Option<RefDataPtr>,
    pub called: bool, // = false
}

impl DoneCallback {
    pub fn finalize(mut self: Box<Self>) {
        let _g = group_begin!();

        // `RefDataPtr` = `RefPtr<RefData>` has NO `Drop` impl (see
        // src/ptr/ref_count.rs) — must explicitly decrement before the Box
        // frees the allocation. Zig: `if (this.ref) |ref| ref.deref();`.
        if let Some(r) = self.r#ref.take() {
            r.deref();
        }
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
bun_jsc::jsc_host_abi! {
    unsafe fn __jsc_host_bun_test_done_callback(
        g: *mut JSGlobalObject,
        f: *mut CallFrame,
    ) -> JSValue {
        // SAFETY: JSC guarantees both pointers are live for the duration of the host call.
        let global = unsafe { &*g };
        let callframe = unsafe { &*f };
        bun_jsc::to_js_host_fn_result(global, BunTest::bun_test_done_callback(global, callframe))
    }
}

// ported from: src/test_runner/DoneCallback.zig
