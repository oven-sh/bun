//! The wrapped function exotic objects of the ShadowRealm proposal: no object passes from one realm to the other.

use bun_engine_bytecode::Visibility;
use bun_engine_macros::{cell, native_abi};
use bun_engine_text::StringRef;

use super::bound_function::length_and_name_of;
use crate::call::native_not_a_constructor;
use crate::{
    CallFrame, Cx, ErrorInstance, Gc, GlobalObject, Intrinsic, JsFunction, JsObject, JsResult,
    JsString, NativeExecutable, Thrown, Value, ValueVec, errors, function_realm,
};

#[cell(name = "Function")]
pub struct JsRemoteFunction {
    base: JsFunction,
    target_function: Gc<JsObject>,
    name: Gc<JsString>,
    length: f64,
}

impl JsRemoteFunction {
    /// GetWrappedValue. What it throws is of the realm of `cx`.
    pub fn wrap(cx: &mut Cx, realm: Gc<GlobalObject>, value: Value) -> JsResult<Value> {
        let Some(target) = value.as_object() else {
            return Ok(value);
        };
        if !target.is_callable() {
            let message = "value passing between realms must be callable or primitive";
            return Err(cx.throw_type_error(message));
        }
        let (length, name) = match length_and_name_of(cx, &target) {
            Ok(found) => found,
            Err(thrown) => {
                cx.catch(thrown)?;
                return Err(cx.throw_type_error("wrapping returned function throws an error"));
            }
        };
        let cx = cx.in_realm(realm);
        let executable = NativeExecutable::shared(
            cx,
            0,
            StringRef::empty(),
            call,
            native_not_a_constructor,
            Intrinsic::RemoteFunctionCall,
            Visibility::Public,
        );
        let function = cx.allocate::<JsRemoteFunction>(JsRemoteFunctionInit {
            base: JsFunction::native_init(cx, cx.remote_function_shape(), executable),
            target_function: target,
            name,
            length: length.max(0.0),
        });
        Ok(function.into())
    }

    pub fn target_function(&self) -> Gc<JsObject> {
        self.target_function
    }

    pub(super) fn target_name(&self) -> Gc<JsString> {
        self.name
    }

    pub(super) fn target_length(&self) -> f64 {
        self.length
    }
}

/// An error of the realm of `cx` in place of what is pending.
#[cold]
fn replace_exception(cx: &mut Cx, thrown: Thrown) -> JsResult<Thrown> {
    let value = cx.catch_value(thrown)?;
    let message = match value.downcast::<ErrorInstance>() {
        Some(error) => error.sanitized_message(cx),
        None if value.is_primitive() => value.to_string_ref(cx).map(Some),
        None => Ok(None),
    };
    let message = match message {
        Ok(message) => message.filter(|it| !it.is_empty()),
        Err(thrown) => cx.catch(thrown).map(|_| None)?,
    };
    Ok(match message {
        Some(message) => cx.throw_type_error(message),
        None => cx.throw_type_error(errors::TYPE_ERROR),
    })
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let target = frame.callee().cast::<JsRemoteFunction>().target_function;
    let target_realm = function_realm(cx, target)?;
    let mut arguments = ValueVec::new();
    cx.or_out_of_memory(arguments.try_reserve(frame.argument_count()))?;
    for &argument in frame.arguments() {
        arguments.push(JsRemoteFunction::wrap(cx, target_realm, argument)?);
    }
    let result = (cx.in_realm(target_realm)).call(target.into(), Value::UNDEFINED, &arguments);
    match result {
        Ok(result) => JsRemoteFunction::wrap(cx, cx.global(), result),
        Err(thrown) => Err(replace_exception(cx, thrown)?),
    }
}
