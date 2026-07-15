//! `node:http` native binding — `{get,set}MaxHTTPHeaderSize`.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

pub(crate) fn get_max_http_header_size(
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    Ok(JSValue::from(bun_http::max_http_header_size()))
}

pub(crate) fn set_max_http_header_size(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>();
    let arguments = arguments.slice();
    if arguments.is_empty() {
        return Err(global.throw_not_enough_arguments("setMaxHTTPHeaderSize", 1, arguments.len()));
    }
    let value = arguments[0];
    let num = value.coerce_to_int64(global)?;
    if num <= 0 {
        return Err(global.throw_invalid_argument_type_value(
            "maxHeaderSize",
            "non-negative integer",
            value,
        ));
    }
    bun_http::set_max_http_header_size(num as usize);
    Ok(JSValue::from(bun_http::max_http_header_size()))
}
