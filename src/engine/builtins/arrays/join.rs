use bun_engine_vm::is_array;

use super::receiver;
use crate::prelude::*;

fn comma(cx: &Cx) -> Gc<JsString> {
    cx.small_strings.single_character(b',')
}

#[native_abi]
pub(super) fn join(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    object
        .unless_being_joined(cx, |cx| {
            let length = object.length_of_array_like(cx)?;
            let separator = match frame.argument(0) {
                Value::UNDEFINED => comma(cx),
                separator => separator.to_string(cx)?,
            };
            object.join_elements(cx, length, separator)
        })
        .map(Into::into)
}

#[native_abi]
pub(super) fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    if let Some(array) = object.as_exact_array()
        && array.has_default_join(cx)
    {
        return array.join_with_commas(cx).map(Into::into);
    }
    let method = object.get(cx, names::join)?;
    if method.is_callable() {
        return cx.call(method, object.into(), &[]);
    }
    // For the message about a revoked proxy.
    is_array(cx, object.into())?;
    object.to_tagged_string(cx).map(Into::into)
}

#[native_abi]
pub(super) fn to_locale_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = receiver(cx, frame.this_value())?;
    let arguments = [frame.argument(0), frame.argument(1)];
    object
        .unless_being_joined(cx, |cx| {
            let (length, separator) = (object.length_of_array_like(cx)?, comma(cx));
            object.join_elements_with(cx, length, separator, |cx, element| {
                let method = element.get(cx, names::toLocaleString)?;
                if !method.is_callable() {
                    return Err(cx.throw_type_error("toLocaleString is not callable"));
                }
                cx.call(method, element, &arguments)?.to_string(cx)
            })
        })
        .map(Into::into)
}
