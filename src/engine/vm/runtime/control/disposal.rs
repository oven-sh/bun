//! What `using` shares with the disposable stacks.

use bun_engine_macros::native_abi;
use bun_engine_text::symbols;

use crate::{CallFrame, Cx, JsFunctionWithFields, JsPromise, JsResult, Value};

/// GetDisposeMethod, and the checks of CreateDisposableResource. Undefined for undefined and null.
pub fn get_dispose_method(cx: &mut Cx, value: Value, is_async: bool) -> JsResult<Value> {
    if value.is_undefined_or_null() {
        return Ok(Value::UNDEFINED);
    }
    if !value.is_object() {
        let message = "Disposable value must be an object, null, or undefined";
        return Err(cx.throw_type_error(message));
    }
    if is_async {
        let message = "@@asyncDispose must be callable";
        if let Some(method) = value.get_method(cx, symbols::asyncDispose, message)? {
            return Ok(method);
        }
    }
    match value.get_method(cx, symbols::dispose, "@@dispose must be callable")? {
        Some(method) if is_async => {
            Ok(JsFunctionWithFields::new(cx, 0, dispose_for_await, [method, value]).into())
        }
        Some(method) => Ok(method),
        None => Err(cx.throw_type_error(if is_async {
            "@@asyncDispose and @@dispose must not be undefined or null"
        } else {
            "@@dispose must not be undefined or null"
        })),
    }
}

#[native_abi]
fn dispose_for_await(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let [method, value] = JsFunctionWithFields::fields_of_callee(frame);
    match cx.call(method, value, &[]) {
        Ok(_) => Ok(JsPromise::fulfilled(cx, Value::UNDEFINED).into()),
        Err(thrown) => JsPromise::rejected_with_caught(cx, thrown).map(Into::into),
    }
}
