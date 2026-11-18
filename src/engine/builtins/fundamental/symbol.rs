use bun_engine_text::PropertyName;
use bun_engine_vm::{Attributes, JsSymbol, SymbolObject, direct, errors};

use crate::prelude::*;

macro_rules! constructor_properties {
    ($($symbol:ident)*) => {
        static_table!(static CONSTRUCTOR_PROPERTIES = [
            StaticProperty::function(names::r#for, symbol_for, 1).with_intrinsic(Intrinsic::SymbolFor),
            StaticProperty::function(names::keyFor, key_for, 1),
            StaticProperty::position_of(names::length),
            StaticProperty::position_of(names::name),
            StaticProperty::position_of(names::prototype),
            $(StaticProperty::symbol(names::$symbol, symbols::$symbol),)*
        ]);
    };
}

constructor_properties! {
    hasInstance isConcatSpreadable asyncIterator iterator r#match matchAll replace search species split toPrimitive
    toStringTag unscopables dispose asyncDispose
}

define_constructor!(SymbolConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

const READ_ONLY_ACCESSOR: Attributes = Attributes::CUSTOM_ACCESSOR
    .union(Attributes::DONT_ENUM)
    .union(Attributes::READ_ONLY);

static_table!(static PROTOTYPE_PROPERTIES = [
    StaticProperty::custom(names::description, READ_ONLY_ACCESSOR, description, None),
    StaticProperty::function(names::toString, to_string, 0)
        .with_intrinsic(Intrinsic::SymbolPrototypeToString),
    StaticProperty::function(names::valueOf, value_of, 0),
    StaticProperty::function(symbols::toPrimitive, value_of, 1).with(Attributes::READ_ONLY),
    StaticProperty::string(symbols::toStringTag, names::Symbol),
]);

define_object!(SymbolPrototype, "Symbol", PROTOTYPE_PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let global = cx.global();
    let prototype = SymbolPrototype::create(cx, cx.object_prototype().into());
    let constructor =
        SymbolConstructor::create(cx, cx.function_prototype(), 0, names::Symbol, &prototype);
    let spec = ShapeSpec::of::<SymbolObject>();
    global.init_symbol_object_shape(Shape::create(cx, Some(global), prototype.into(), spec));
    global.init_symbol_prototype(prototype);
    global.init_symbol_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    match frame.argument(0) {
        Value::UNDEFINED => Ok(JsSymbol::create(cx, None).into()),
        description => {
            let description = description.to_string(cx)?;
            JsSymbol::with_description(cx, description).map(Into::into)
        }
    }
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_not_a_constructor(cx, frame.callee().into()))
}

#[native_abi]
fn symbol_for(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(0).to_string(cx)?;
    direct::symbol::symbol_for(cx, key).map(Into::into)
}

#[native_abi]
fn key_for(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(symbol) = frame.argument(0).as_symbol() else {
        let message = "Symbol.keyFor requires that the first argument be a symbol";
        return Err(cx.throw_type_error(message));
    };
    if !symbol.symbol().flags().is_registered() {
        return Ok(Value::UNDEFINED);
    }
    Ok(symbol.description(cx).map_or_default(Into::into))
}

fn this_symbol(cx: &Cx, this: Value, function: &str) -> JsResult<Gc<JsSymbol>> {
    let wrapped = || {
        this.downcast::<SymbolObject>()?
            .internal_value()
            .as_symbol()
    };
    this.as_symbol().or_else(wrapped).ok_or_else(|| {
        cx.throw_type_error(format_args!(
            "Symbol.prototype.{function} requires that |this| be a symbol or a symbol object"
        ))
    })
}

#[native_abi]
fn description(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let symbol = this_symbol(cx, this, "description")?;
    Ok(symbol.description(cx).map_or_default(Into::into))
}

#[native_abi]
fn to_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let symbol = this_symbol(cx, frame.this_value(), "toString")?;
    symbol.to_descriptive_string(cx).map(Into::into)
}

#[native_abi]
fn value_of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    this_symbol(cx, frame.this_value(), "valueOf").map(Into::into)
}
