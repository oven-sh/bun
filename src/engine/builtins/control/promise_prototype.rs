use bun_engine_text::private_names;
use bun_engine_vm::{
    Attributes, InternalMicrotask, InternalReaction, JsFunction, JsFunctionWithFields, JsPromise,
    PromiseStatus, RealmSlot,
};

use super::promise_constructor::this_object;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::finally, finally, 1),
    StaticProperty::realm_slot(names::then, RealmSlot::promise_prototype_then),
    StaticProperty::function(names::catch, catch, 1).with_intrinsic(Intrinsic::PromisePrototypeCatch),
    StaticProperty::realm_slot(names::constructor, RealmSlot::promise_constructor),
    StaticProperty::string(symbols::toStringTag, names::Promise),
    StaticProperty::realm_slot(private_names::then, RealmSlot::promise_prototype_then).with(Attributes::CONSTANT),
]);

define_object!(PromisePrototype, "Promise", PROPERTIES);

pub(super) fn initialize_then(cx: &Cx) {
    let (name, intrinsic) = (
        names::then.to_identifier().into_string(),
        Intrinsic::PromisePrototypeThen,
    );
    let function = JsFunction::native_with_intrinsic(cx, 2, &name, then, intrinsic);
    cx.global().init_promise_prototype_then(function);
}

#[native_abi]
fn then(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(promise) = frame.this_value().downcast::<JsPromise>() else {
        return Err(cx.throw_type_error("|this| is not a Promise"));
    };
    (promise.then(cx, frame.argument(0), frame.argument(1))).map(Into::into)
}

/// The promise, if invoking its `then` comes to calling the function above.
#[inline(always)]
fn with_pristine_then(cx: &Cx, value: Value) -> Option<Gc<JsPromise>> {
    let promise = value.downcast::<JsPromise>()?;
    promise.has_pristine_then_in(cx).then_some(promise)
}

#[native_abi]
fn catch(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, on_rejected) = (frame.this_value(), frame.argument(0));
    match with_pristine_then(cx, this) {
        Some(promise) => (promise.then(cx, Value::UNDEFINED, on_rejected)).map(Into::into),
        None => JsPromise::invoke_then(cx, this, &[Value::UNDEFINED, on_rejected]),
    }
}

#[native_abi]
fn finally(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, on_finally) = (this_object(cx, frame)?, frame.argument(0));
    if let Some(promise) = with_pristine_then(cx, this.into())
        && promise.has_pristine_species(cx)
    {
        if !on_finally.is_callable() {
            return promise.then(cx, on_finally, on_finally).map(Into::into);
        }
        let (result, task) = (JsPromise::new(cx), InternalMicrotask::PromiseFinally);
        let reaction = InternalReaction::new(task, Some(result.cell()), on_finally);
        promise.react(cx, reaction.in_current_async_context(cx));
        return Ok(result.into());
    }
    let constructor = JsPromise::species_constructor(cx, &this)?;
    if !on_finally.is_callable() {
        return JsPromise::invoke_then(cx, this.into(), &[on_finally, on_finally]);
    }
    let handlers = [then_finally, catch_finally].map(|function| {
        JsFunctionWithFields::new(cx, 1, function, [on_finally, constructor.into()]).into()
    });
    JsPromise::invoke_then(cx, this.into(), &handlers)
}

fn call_on_finally(cx: &mut Cx, frame: &CallFrame, status: PromiseStatus) -> JsResult<Value> {
    let [on_finally, constructor] = JsFunctionWithFields::fields_of_callee(frame);
    let result = cx.call(on_finally, Value::UNDEFINED, &[])?;
    JsPromise::pass_on_after(cx, constructor.cast(), result, status, frame.argument(0))
}

#[native_abi]
fn then_finally(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    call_on_finally(cx, frame, PromiseStatus::Fulfilled)
}

#[native_abi]
fn catch_finally(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    call_on_finally(cx, frame, PromiseStatus::Rejected)
}
