use bun_engine_bytecode::{FunctionKind, Visibility};
use bun_engine_text::{PropertyName, StringRef};
use bun_engine_vm::{
    Attributes, CellType, ClonedArguments, DynamicFunctionKind, FrameKind, GetterSetter,
    IntegrityLevel, JsBoundFunction, JsCallee, JsFunction, RealmSlot, StackVisitor, TypeFlags,
    ValueVec, VisitedFrame, create_dynamic_function, errors, native_source_text,
};

use crate::js;
use crate::prelude::*;

const RESTRICTED: Attributes = Attributes::DONT_ENUM.union(Attributes::CUSTOM_ACCESSOR);

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::function(names::toString, to_string, 0)
        .with_intrinsic(Intrinsic::FunctionToString),
    StaticProperty::realm_slot(names::apply, RealmSlot::function_prototype_apply),
    StaticProperty::realm_slot(names::call, RealmSlot::function_prototype_call),
    StaticProperty::function(names::bind, bind, 1).with_intrinsic(Intrinsic::FunctionBind),
    StaticProperty::custom(names::arguments, RESTRICTED, get_arguments, Some(set_restricted)),
    StaticProperty::custom(names::caller, RESTRICTED, get_caller, Some(set_restricted)),
    StaticProperty::realm_slot(names::constructor, RealmSlot::function_constructor),
    StaticProperty::realm_slot(symbols::hasInstance, RealmSlot::function_prototype_has_instance)
        .with(Attributes::CONSTANT),
]);

#[cell(name = "Function", static_table = PROTOTYPE_PROPERTIES)]
struct FunctionPrototype {
    base: InternalFunction,
}

#[cell(name = "Function")]
struct FunctionConstructor {
    base: InternalFunction,
}

pub(crate) fn initialize_prototype(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.object_prototype().into());
    let spec = ShapeSpec::of::<FunctionPrototype>();
    let shape = Shape::create_dictionary(cx, Some(global), parent, spec);
    let base = InternalFunction::init(cx, shape, call_prototype, None);
    let prototype = cx.allocate::<FunctionPrototype>(FunctionPrototypeInit { base });
    prototype.define_length_and_name(cx, 0, cx.small_strings.empty());
    prototype.flatten_dictionary(cx);
    let spec = ShapeSpec::of::<JsFunction>();
    let shape = || Shape::create(cx, Some(global), prototype.into(), spec);
    global.init_function_prototype(prototype.upcast());
    global.init_function_shape(shape());
    global.init_method_shape(shape());
    global.init_builtin_function_shape(shape());
    global.init_native_function_shape(shape());
    let spec = ShapeSpec::of::<JsCallee>();
    global.init_callee_shape(Shape::create(cx, Some(global), Value::NULL, spec));
}

pub(super) fn initialize_constructor(cx: &Cx) {
    let (prototype, spec) = (
        cx.function_prototype(),
        ShapeSpec::of::<FunctionConstructor>(),
    );
    let shape = Shape::create_dictionary(cx, Some(cx.global()), prototype.into(), spec);
    let base = InternalFunction::init(cx, shape, call_constructor, Some(construct));
    let constructor = cx.allocate::<FunctionConstructor>(FunctionConstructorInit { base });
    constructor.finish_constructor(cx, 1, names::Function, &prototype);
    cx.global().init_function_constructor(constructor.upcast());
}

pub(super) fn initialize_call(cx: &Cx) {
    let function = js::function(cx, js::function_prototype::call);
    cx.global().init_function_prototype_call(function);
}

pub(super) fn initialize_apply(cx: &Cx) {
    let function = js::function(cx, js::function_prototype::apply);
    cx.global().init_function_prototype_apply(function);
}

pub(super) fn initialize_has_instance(cx: &Cx) {
    let name = StringRef::from_literal("[Symbol.hasInstance]");
    let function = JsFunction::native(cx, 1, &name, has_instance);
    cx.global().init_function_prototype_has_instance(function);
}

/// %ThrowTypeError%
pub(super) fn initialize_thrower(cx: &Cx) {
    let function = JsFunction::native(cx, 0, &StringRef::empty(), throw_type_error);
    let (length, name) = (Value::ZERO, cx.small_strings.empty().into());
    function.put_direct(cx, names::length, length, Attributes::CONSTANT);
    function.put_direct(cx, names::name, name, Attributes::CONSTANT);
    function.restrict_ordinary(cx, IntegrityLevel::Frozen);
    let accessor = GetterSetter::create(cx, Some(function.upcast()), Some(function.upcast()));
    cx.global().init_throw_type_error_function(function);
    cx.global().init_throw_type_error_accessor(accessor);
}

#[native_abi]
fn throw_type_error(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(cx.throw_type_error(errors::RESTRICTED_PROPERTY_ACCESS))
}

#[native_abi]
fn call_constructor(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (kind, callee) = (DynamicFunctionKind::Normal, frame.callee());
    create_dynamic_function(cx, kind, &callee, Value::UNDEFINED, frame.arguments()).map(Into::into)
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (kind, callee) = (DynamicFunctionKind::Normal, frame.callee());
    create_dynamic_function(cx, kind, &callee, frame.new_target(), frame.arguments())
        .map(Into::into)
}

#[native_abi]
fn call_prototype(_: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = frame.this_value();
    let text = if let Some(function) = this.downcast::<JsFunction>() {
        function.source_text(cx)
    } else if let Some(function) = this.downcast::<InternalFunction>() {
        native_source_text(cx, function.name().text())
    } else if let Some(object) = this.as_object().filter(|it| it.is_callable()) {
        native_source_text(cx, object.class().name_literal().text())
    } else {
        Err(cx.throw_type_error(errors::TYPE_ERROR))
    };
    text.map(Into::into)
}

#[native_abi]
fn bind(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(target) = (frame.this_value().as_object()).filter(|it| it.is_callable()) else {
        let message = "|this| is not a function inside Function.prototype.bind";
        return Err(cx.throw_type_error(message));
    };
    JsBoundFunction::bind(cx, target, frame.argument(0), frame.rest(1)).map(Into::into)
}

#[native_abi]
fn has_instance(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(this) = (frame.this_value().as_object()).filter(|it| it.is_callable()) else {
        return Ok(Value::FALSE);
    };
    let value = frame.argument(0);
    let has_default = (this.inline_flags()).contains(TypeFlags::IMPLEMENTS_DEFAULT_HAS_INSTANCE);
    if this.is::<JsFunction>() && !has_default {
        cx.check_stack()?;
        return this.custom_has_instance(cx, value).map(Into::into);
    }
    if !value.is_object() {
        return Ok(Value::FALSE);
    }
    let prototype = this.get(cx, names::prototype)?;
    JsObject::default_has_instance(cx, value, prototype).map(Into::into)
}

// https://github.com/claudepache/es-legacy-function-reflection

fn unrestricted_function(cx: &Cx, this: Value) -> JsResult<Gc<JsFunction>> {
    let is_unrestricted = |function: &Gc<JsFunction>| {
        function.script_executable().is_some_and(|executable| {
            let info = executable.info();
            !executable.is_builtin()
                && info.visibility() == Visibility::Public
                && info.kind() == FunctionKind::Normal
                && !(info.is_strict() || info.is_async() || info.is_generator())
        })
    };
    (this.downcast().filter(is_unrestricted))
        .ok_or_else(|| cx.throw_type_error(errors::RESTRICTED_PROPERTY_ACCESS))
}

#[native_abi]
fn get_arguments(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let function = unrestricted_function(cx, this)?.as_object();
    let Some(frame) = StackVisitor::frames(cx).find(|it| it.callee == Some(function)) else {
        return Ok(Value::NULL);
    };
    let mut arguments = ValueVec::new();
    frame.copy_arguments(&mut arguments);
    let cx = cx.in_realm_of(&function);
    ClonedArguments::create_with_callee(cx, function, &arguments).map(Into::into)
}

#[native_abi]
fn get_caller(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let function = unrestricted_function(cx, this)?.as_object();
    let only_passes_on = |frame: &VisitedFrame<'_>| match frame.kind() {
        FrameKind::Function | FrameKind::Native => {
            frame.visibility() != Visibility::Public
                || (frame.callee).is_some_and(|it| it.cell_type() == CellType::Proxy)
        }
        kind => kind == FrameKind::Wasm,
    };
    let caller = StackVisitor::frames(cx)
        .skip_while(|frame| frame.callee != Some(function))
        .skip(1)
        .find(|frame| !only_passes_on(frame))
        .and_then(|frame| frame.callee?.downcast::<JsFunction>());
    let is_exposed = |caller: &Gc<JsFunction>| {
        caller.script_executable().is_some_and(|executable| {
            let info = executable.info();
            !(executable.is_builtin() || info.is_strict() || info.is_async() || info.is_generator())
        })
    };
    Ok(caller.filter(is_exposed).map_or(Value::NULL, Into::into))
}

#[native_abi]
fn set_restricted(cx: &mut Cx, this: Value, _: Value, _: PropertyName<'_>) -> bool {
    unrestricted_function(cx, this).is_ok()
}
