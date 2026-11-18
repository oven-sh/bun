use bun_engine_vm::{Attributes, JsAsyncGenerator, JsFunction, JsPromise, RealmSlot};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::r#return, r#return, 1),
    StaticProperty::function(names::throw, throw, 1),
    StaticProperty::realm_slot(names::next, RealmSlot::async_generator_prototype_next),
    StaticProperty::realm_slot(names::constructor, RealmSlot::async_generator_function_prototype)
        .with(Attributes::READ_ONLY),
    StaticProperty::string(symbols::toStringTag, names::AsyncGenerator),
]);

define_object!(AsyncGeneratorPrototype, "AsyncGenerator", PROPERTIES);

pub(super) fn initialize_next(cx: &Cx) {
    let name = names::next.to_identifier().into_string();
    (cx.global()).init_async_generator_prototype_next(JsFunction::native(cx, 1, &name, next));
}

#[inline(always)]
fn request(
    cx: &mut Cx,
    frame: &CallFrame,
    method: fn(&JsAsyncGenerator, &mut Cx, Value) -> JsResult<Gc<JsPromise>>,
) -> JsResult<Value> {
    match frame.this_value().downcast::<JsAsyncGenerator>() {
        Some(generator) => method(&generator, cx, frame.argument(0)),
        None => {
            let thrown = cx.throw_type_error("|this| should be an async generator");
            JsPromise::rejected_with_caught(cx, thrown)
        }
    }
    .map(Into::into)
}

#[native_abi]
fn next(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    request(cx, frame, JsAsyncGenerator::next)
}

#[native_abi]
fn r#return(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    request(cx, frame, JsAsyncGenerator::r#return)
}

#[native_abi]
fn throw(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    request(cx, frame, JsAsyncGenerator::throw)
}
