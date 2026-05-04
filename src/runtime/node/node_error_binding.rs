use bun_jsc::node::ErrorCode;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, Js2NativeFunctionType, JsResult};

// PORT NOTE: reshaped — Zig's `createSimpleError` is a comptime fn that returns a fn pointer
// (token-pasting / monomorphized fn generation). Rust expresses this as `macro_rules!`.
// Macro must precede the `pub const` users in Rust, so order is flipped vs the .zig.
macro_rules! create_simple_error {
    ($create_fn:ident, $code:expr, $message:expr) => {{
        #[bun_jsc::host_fn]
        fn cb(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
            global.$create_fn($code, $message, format_args!(""))
        }
        fn cbb(global: &JSGlobalObject) -> JsResult<JSValue> {
            JSFunction::create(
                global,
                <&'static str>::from($code),
                cb,
                0,
                Default::default(),
            )
        }
        cbb as Js2NativeFunctionType
    }};
}

pub const ERR_INVALID_HANDLE_TYPE: Js2NativeFunctionType = create_simple_error!(
    create_type_error_instance_with_code,
    ErrorCode::ERR_INVALID_HANDLE_TYPE,
    b"This handle type cannot be sent"
);
pub const ERR_CHILD_CLOSED_BEFORE_REPLY: Js2NativeFunctionType = create_simple_error!(
    create_error_instance_with_code,
    ErrorCode::ERR_CHILD_CLOSED_BEFORE_REPLY,
    b"Child closed before reply received"
);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_error_binding.zig (25 lines)
//   confidence: medium
//   todos:      0
//   notes:      comptime fn-generator → macro_rules!; verify Js2NativeFunctionType sig & JSFunction::create args in Phase B
// ──────────────────────────────────────────────────────────────────────────
