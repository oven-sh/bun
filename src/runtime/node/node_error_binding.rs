use bun_core::ZigString;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, ZigStringJsc as _};

use super::nodejs_error_code::Code as ErrorCode;

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
