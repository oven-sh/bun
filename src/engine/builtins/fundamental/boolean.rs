use bun_engine_bytecode::Visibility;
use bun_engine_vm::{
    BooleanObject, GlobalObject, JsFunction, JsWrapperObject, NativeExecutable, errors,
};

use crate::prelude::*;

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::function(names::toString, to_string, 0),
    StaticProperty::function(names::valueOf, value_of, 0),
]);

#[cell(name = "Boolean", static_table = PROTOTYPE_PROPERTIES)]
struct BooleanPrototype {
    base: BooleanObject,
}

#[cell(name = "Function")]
struct BooleanConstructor {
    base: JsFunction,
}

fn create_constructor(cx: &Cx, prototype: &JsObject) -> Gc<JsObject> {
    let (name, intrinsic) = (names::Boolean, Intrinsic::BooleanConstructor);
    let name = name.to_identifier().into_string();
    let executable =
        NativeExecutable::shared(cx, 1, name, call, construct, intrinsic, Visibility::Public);
    let (parent, spec) = (
        cx.function_prototype(),
        ShapeSpec::of::<BooleanConstructor>(),
    );
    let shape = Shape::create_dictionary(cx, Some(cx.global()), parent.into(), spec);
    let constructor = cx.allocate::<BooleanConstructor>(BooleanConstructorInit {
        base: JsFunction::native_init(cx, shape, executable),
    });
    constructor.link_with_prototype(cx, prototype);
    constructor.upcast()
}

pub(crate) fn initialize(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.object_prototype().into());
    let spec = ShapeSpec::of::<BooleanPrototype>();
    let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
    let prototype = cx.allocate::<BooleanPrototype>(BooleanPrototypeInit {
        base: BooleanObject::init(JsWrapperObject::init(cx, shape, Value::FALSE)),
    });
    let constructor = create_constructor(cx, &prototype);
    let spec = ShapeSpec::of::<BooleanObject>();
    global.init_boolean_object_shape(Shape::create(cx, Some(global), prototype.into(), spec));
    global.init_boolean_prototype(prototype.upcast());
    global.init_boolean_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Ok(frame.argument(0).to_boolean(cx).into())
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let value = frame.argument(0).to_boolean(cx);
    let (new_target, callee) = (frame.new_target(), frame.callee());
    let shape =
        cx.shape_from_new_target(new_target, &callee, GlobalObject::boolean_object_shape)?;
    Ok(BooleanObject::create(cx, shape, value.into()).into())
}

fn this_boolean(cx: &Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    if this.is_boolean() {
        return Ok(this);
    }
    match this.downcast::<BooleanObject>() {
        Some(object) => Ok(object.internal_value()),
        None => Err(cx.throw_type_error(errors::TYPE_ERROR)),
    }
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_boolean(cx, frame)?
        .primitive_to_string(cx)
        .map(Into::into)
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_boolean(cx, frame)
}
