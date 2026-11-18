use bun_engine_bytecode::Visibility;
use bun_engine_text::{PropertyName, StringRef};
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{
    Intrinsic, JsFinalObject, JsFunction, JsFunctionWithFields, ProxyObject, errors,
};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::function(names::revocable, revocable, 2),
]);

#[cell(name = "Proxy", static_table = PROPERTIES)]
struct ProxyConstructor {
    base: InternalFunction,
}

pub(super) fn initialize(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.function_prototype().into());
    let spec = ShapeSpec::of::<ProxyConstructor>();
    let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
    let constructor = cx.allocate::<ProxyConstructor>(ProxyConstructorInit {
        base: InternalFunction::init(cx, shape, call, Some(construct)),
    });
    constructor.define_length_and_name(cx, 2, JsString::from_name(cx, names::Proxy));
    global.init_proxy_constructor(constructor.upcast());
}

pub(super) fn initialize_revocable_shape(cx: &Cx) {
    let names = [names::proxy, names::revoke].map(PropertyName::to_identifier);
    let shape = Shape::for_object_literal(cx, &names, names.len());
    cx.global().init_revocable_proxy_shape(shape);
}

pub(super) fn initialize_helpers(cx: &Cx) {
    let global = cx.global();
    let helper = |function| {
        let (name, constructor) = (StringRef::empty(), native_not_a_constructor);
        let (intrinsic, visibility) = (Intrinsic::None, Visibility::Private);
        JsFunction::native_with(cx, 0, &name, function, constructor, intrinsic, visibility)
    };
    global.init_private_validate_proxy_get(helper(validate_get));
    global.init_private_validate_proxy_has(helper(validate_has));
    global.init_private_validate_proxy_set(helper(validate_set));
    global.init_private_throw_falsy_proxy_set(helper(throw_falsy_set));
}

#[native_abi]
fn validate_get(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (target, key) = (frame.argument(1), frame.argument(2).to_property_key(cx)?);
    let target = target.cast::<JsObject>();
    ProxyObject::validate_get_result(cx, frame.argument(0), &target, key.name())?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn validate_has(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (target, key) = (frame.argument(0), frame.argument(1).to_property_key(cx)?);
    ProxyObject::validate_negative_has_result(cx, &target.cast::<JsObject>(), key.name())?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn validate_set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (target, key) = (frame.argument(0), frame.argument(1).to_property_key(cx)?);
    let target = target.cast::<JsObject>();
    ProxyObject::validate_positive_set_result(cx, &target, key.name(), frame.argument(2))?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn throw_falsy_set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(0).to_property_key(cx)?;
    Err(ProxyObject::throw_falsy_set_result(cx, key.name()))
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "Proxy"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    ProxyObject::create(cx, frame.argument(0), frame.argument(1)).map(Into::into)
}

#[native_abi]
fn revocable(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let &[target, handler, ..] = frame.arguments() else {
        return Err(cx.throw_type_error(
            "Proxy.revocable needs to be called with two arguments: the target and the handler",
        ));
    };
    let proxy = ProxyObject::create(cx, target, handler)?.into();
    let revoke = JsFunctionWithFields::new(cx, 0, revoke, [proxy, Value::UNDEFINED]);
    let shape = cx.revocable_proxy_shape();
    Ok(JsFinalObject::create_with_values(cx, shape, &[proxy, revoke.into()]).into())
}

#[native_abi]
fn revoke(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let fields = frame.callee().cast::<JsFunctionWithFields>();
    if let Some(proxy) = fields.fields().at(0).downcast::<ProxyObject>() {
        proxy.revoke();
        fields.fields().set(0, Value::NULL);
    }
    Ok(Value::UNDEFINED)
}
