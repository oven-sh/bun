use bun_engine_text::private_names;
use bun_engine_vm::{Attributes, JsPromise, PromiseCapability, RealmSlot};

use super::promise_combinators::{all, all_settled, any, race};
use super::promise_prototype::PromisePrototype;
use crate::define::{define_builtin_constructor, species_getter};
use crate::js;
use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::resolve, resolve, 1).with_intrinsic(Intrinsic::PromiseConstructorResolve),
    StaticProperty::function(names::reject, reject, 1).with_intrinsic(Intrinsic::PromiseConstructorReject),
    StaticProperty::function(names::race, race, 1),
    StaticProperty::function(names::all, all, 1),
    StaticProperty::function(names::allSettled, all_settled, 1),
    StaticProperty::function(names::any, any, 1),
    StaticProperty::function(names::withResolvers, with_resolvers, 0),
    StaticProperty::realm_slot(names::prototype, RealmSlot::promise_prototype).with(Attributes::CONSTANT),
    StaticProperty::builtin(names::r#try, js::promise_constructor::r#try),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
    StaticProperty::function(private_names::resolve, resolve, 1).with_intrinsic(Intrinsic::PromiseConstructorResolve),
    StaticProperty::function(private_names::reject, reject, 1).with_intrinsic(Intrinsic::PromiseConstructorReject),
]);

define_builtin_constructor!(
    PromiseConstructor,
    PROPERTIES,
    js::promise_constructor::Promise
);

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = PromisePrototype::create(cx, cx.object_prototype().into());
    let constructor = PromiseConstructor::create(cx, cx.function_prototype(), &prototype);
    global.init_promise_shape(super::instance_shape::<JsPromise>(cx, prototype.into()));
    global.init_promise_prototype(prototype);
    global.init_promise_constructor(constructor);
}

#[inline]
pub(super) fn this_object(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsObject>> {
    (frame.this_value().as_object()).ok_or_else(|| cx.throw_type_error("|this| is not an object"))
}

#[native_abi]
fn resolve(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let constructor = this_object(cx, frame)?;
    JsPromise::resolve_with_constructor(cx, constructor, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn reject(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let constructor = this_object(cx, frame)?;
    JsPromise::reject_with_constructor(cx, constructor, frame.argument(0)).map(Into::into)
}

#[native_abi]
fn with_resolvers(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let capability = PromiseCapability::new(cx, frame.this_value())?;
    Ok(capability.to_object(cx).into())
}
