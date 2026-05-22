use bun_core::ZigString;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, ZigStringJsc as _};

use super::nodejs_error_code::Code as ErrorCode;

// PORT NOTE: reshaped — Zig's `createSimpleError` is a comptime fn that mints a
// monomorphized `cbb: fn(*JSGlobalObject) JSError!JSValue` and returns it as a
// `jsc.JS2NativeFunctionType` const. Rust cannot mint an `fn` item from a const
// generic fn pointer, so each call site becomes a `pub fn` directly (same shape
// the `generated_js2native.rs` thunk layer expects). Names stay SCREAMING to
// match the .zig spec exactly.
//
// `createFn` was `createErrorInstanceWithCode` / `createTypeErrorInstanceWithCode`
// — both removed from `JSGlobalObject` upstream; their historical bodies were
// `createErrorInstance(fmt, args)` + `err.put("code", @tagName(code))`, which is
// inlined here.
macro_rules! create_simple_error {
    ($name:ident, $create_fn:ident, $code:expr, $message:literal) => {
        #[allow(non_snake_case)]
        pub fn $name(global: &JSGlobalObject) -> JsResult<JSValue> {
            #[bun_jsc::host_fn]
            fn cb(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
                let err = global.$create_fn(format_args!($message));
                err.put(
                    global,
                    "code",
                    ZigString::init(<&'static str>::from($code).as_bytes()).to_js(global),
                );
                Ok(err)
            }
            Ok(JSFunction::create(
                global,
                <&'static str>::from($code),
                __jsc_host_cb,
                0,
                Default::default(),
            ))
        }
    };
}

create_simple_error!(
    ERR_INVALID_HANDLE_TYPE,
    create_type_error_instance,
    ErrorCode::ERR_INVALID_HANDLE_TYPE,
    "This handle type cannot be sent"
);
create_simple_error!(
    ERR_CHILD_CLOSED_BEFORE_REPLY,
    create_error_instance,
    ErrorCode::ERR_CHILD_CLOSED_BEFORE_REPLY,
    "Child closed before reply received"
);

// ported from: src/runtime/node/node_error_binding.zig
