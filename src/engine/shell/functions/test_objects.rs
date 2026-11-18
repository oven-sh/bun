//! Objects of the kinds that an embedder defines.

use bun_engine_macros::{cell, object_ops};
use bun_engine_text::{PropertyName, names};
use bun_engine_vm::{
    CellKind, CustomGetter, CustomGetterSetter, CustomSetter, Field, JsArray, JsFunction,
    JsObjectInit, PropertySlot, PutPropertySlot, Shape, ShapeSpec, StaticProperty, TypeFlags,
    ascii_literal, static_table,
};

use super::{put, return_undefined};
use crate::prelude::*;

pub(super) const FUNCTIONS: Functions = &[
    ("createCustomTestGetterSetter", create_custom_accessors, 1),
    ("createCustomGetterObject", create::<CustomGetters>, 0),
    ("createStaticCustomAccessor", create::<StaticAccessors>, 0),
    ("createStaticCustomValue", create::<StaticValues>, 0),
    ("createStaticDontDeleteDontEnum", create::<StaticMethods>, 0),
    (
        "createObjectDoingSideEffectPutWithoutCorrectSlotStatus",
        create_stringifier,
        0,
    ),
    ("createImpureGetter", create_impure_getter, 1),
    ("setImpureGetterDelegate", set_impure_getter_delegate, 2),
    ("createRuntimeArray", create_runtime_array, 0),
];

const VALUE: Attributes = Attributes::CUSTOM_VALUE;
const ACCESSOR: Attributes = Attributes::CUSTOM_ACCESSOR;
const HIDDEN: Attributes = Attributes::DONT_ENUM;
const HIDDEN_READ_ONLY: Attributes = HIDDEN.union(Attributes::READ_ONLY);

fn base_for<T: CellKind>(cx: &Cx, prototype: Value) -> JsObjectInit {
    let shape = Shape::create(cx, Some(cx.global()), prototype, ShapeSpec::of::<T>());
    JsObjectInit::new(cx, shape)
}

/// One that adds no field.
trait Plain: CellKind {
    fn init(base: JsObjectInit) -> Self::Init;
}

macro_rules! plain_objects {
    ($($(#[$attribute:meta])* $name:ident;)*) => {$(
        $(#[$attribute])*
        struct $name {
            base: JsObject,
        }

        impl Plain for $name {
            fn init(base: JsObjectInit) -> Self::Init {
                type Init = <$name as CellKind>::Init;
                Init { base }
            }
        }
    )*};
}

plain_objects! {
    #[cell(name = "JSTestCustomGetterSetter")]
    CustomAccessors;
    #[cell(name = "CustomGetter", ops)]
    CustomGetters;
    #[cell(name = "StaticCustomAccessor", ops, static_table = STATIC_ACCESSORS)]
    StaticAccessors;
    #[cell(name = "StaticCustomValue", static_table = STATIC_VALUES)]
    StaticValues;
    #[cell(name = "StaticDontDeleteDontEnum", static_table = STATIC_METHODS)]
    StaticMethods;
    #[cell(name = "ObjectDoingSideEffectPutWithoutCorrectSlotStatus", ops, static_table = STATIC_ACCESSORS)]
    Stringifier;
}

#[native_abi]
fn create<T: Plain>(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Ok(cx
        .allocate::<T>(T::init(base_for::<T>(cx, Value::NULL)))
        .into())
}

fn get_direct(this: Value, name: &'static str) -> Value {
    let name = Identifier::from_literal(name);
    (this.as_object().and_then(|it| it.get_direct(name.name()))).unwrap_or_default()
}

// Accessors in the shape

#[native_abi]
fn get_this(_: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(this)
}

#[native_abi]
fn get_global(cx: &mut Cx, _: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(cx.global_this().into())
}

#[native_abi]
fn get_value2(_: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(get_direct(this, "value2"))
}

fn report(cx: &mut Cx, to: Value, result: Value) -> bool {
    let name = || Identifier::from_literal("result");
    (to.as_object()).is_some_and(|it| it.set(cx, name().name(), result, false).is_ok())
}

#[native_abi]
fn report_this(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    report(cx, value, this)
}

#[native_abi]
fn report_global(cx: &mut Cx, _: Value, value: Value, _: PropertyName<'_>) -> bool {
    report(cx, value, cx.global_this().into())
}

#[native_abi]
fn set_value2(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    put(cx, &this.cast::<JsObject>(), "value2", value);
    true
}

#[native_abi]
fn call_value(cx: &mut Cx, _: Value, value: Value, _: PropertyName<'_>) -> bool {
    value.is::<JsFunction>() && cx.call(value, Value::UNDEFINED, &[]).is_ok()
}

#[native_abi]
fn create_custom_accessors(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    const READ_ONLY: Attributes = ACCESSOR.union(Attributes::READ_ONLY);
    let base = base_for::<CustomAccessors>(cx, cx.object_prototype().into());
    let object = cx.allocate::<CustomAccessors>(CustomAccessors::init(base));
    let define = |name, kind, getter: CustomGetter, setter: Option<CustomSetter>| {
        let name = Identifier::from_literal(name);
        let custom = CustomGetterSetter::create(cx, Some(getter), setter, None);
        object.put_direct_custom(cx, name.name(), custom, kind);
    };
    define("customValue", VALUE, get_this, Some(report_this));
    define("customValue2", VALUE, get_value2, Some(set_value2));
    define("customAccessor", ACCESSOR, get_this, Some(report_this));
    let setter = Some(report_global as CustomSetter);
    define("customValueGlobalObject", VALUE, get_global, setter);
    define("customAccessorGlobalObject", ACCESSOR, get_global, setter);
    define("customValueNoSetter", VALUE, get_this, None);
    define("customAccessorReadOnly", READ_ONLY, get_this, None);
    define("customFunction", ACCESSOR, get_this, Some(call_value));
    Ok(object.into())
}

// Accessors that are nowhere

#[native_abi]
fn get_100_or_throw(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    let name = Identifier::from_literal("shouldThrow");
    if !this.is_object() || this.get(cx, name.name())?.to_boolean(cx) {
        return Err(cx.throw_type_error("Type error"));
    }
    Ok(100.into())
}

#[object_ops]
impl CustomGetters {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        let kind = match name.text() {
            text if text.eq_ascii("customGetter") => Attributes::NONE,
            text if text.eq_ascii("customGetterAccessor") => ACCESSOR,
            _ => return self.ordinary_get_own_property_slot(cx, name, slot),
        };
        slot.set_cacheable_custom(self, Attributes::CONSTANT | kind, get_100_or_throw);
        Ok(true)
    }
}

// Static tables

macro_rules! custom {
    ($name:literal, $kind:expr, $getter:expr, $setter:expr) => {
        StaticProperty::custom(PropertyName::EMPTY, $kind, $getter, $setter)
            .renamed(ascii_literal!($name))
    };
}

#[native_abi]
fn get_test_field(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    if !this.is_object() {
        return Err(cx.throw_type_error("Type error"));
    }
    Ok(get_direct(this, "testField"))
}

#[native_abi]
fn set_test_field(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    let target = (this.as_object()).map_or_else(|| this.synthesize_prototype(cx), Ok);
    target.is_ok_and(|target| {
        put(cx, &target, "testField", value);
        true
    })
}

static_table!(static STATIC_ACCESSORS = [
    custom!("testStaticAccessor", ACCESSOR, get_test_field, Some(set_test_field)),
    custom!("testStaticAccessorDontEnum", ACCESSOR.union(HIDDEN), get_test_field, Some(set_test_field)),
    custom!("testStaticAccessorReadOnly", ACCESSOR.union(HIDDEN_READ_ONLY), get_test_field, None),
]);

#[object_ops]
impl StaticAccessors {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if !name.text().eq_ascii("thinAirCustomGetter") {
            return self.ordinary_get_own_property_slot(cx, name, slot);
        }
        slot.set_cacheable_custom(self, Attributes::CONSTANT | ACCESSOR, get_test_field);
        Ok(true)
    }
}

#[native_abi]
fn get_undefined(_: &mut Cx, _: Value, _: PropertyName<'_>) -> JsResult<Value> {
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn replace_static_value(cx: &mut Cx, this: Value, value: Value, _: PropertyName<'_>) -> bool {
    put(cx, &this.cast::<JsObject>(), "testStaticValue", value);
    true
}

#[native_abi]
fn set_flag(cx: &mut Cx, this: Value, _: Value, _: PropertyName<'_>) -> bool {
    let this = this.cast::<JsObject>();
    put(cx, &this, "testStaticValueSetterCalled", Value::TRUE);
    true
}

static_table!(static STATIC_VALUES = [
    custom!("testStaticValue", VALUE, get_undefined, Some(replace_static_value)),
    custom!("testStaticValueNoSetter", VALUE.union(HIDDEN), get_undefined, None),
    custom!("testStaticValueReadOnly", VALUE.union(HIDDEN_READ_ONLY), get_undefined, None),
    custom!("testStaticValueSetFlag", VALUE, get_undefined, Some(set_flag)),
]);

const METHOD: StaticProperty = StaticProperty::function(PropertyName::EMPTY, return_undefined, 0);

static_table!(static STATIC_METHODS = [
    METHOD.renamed(ascii_literal!("dontEnum")),
    METHOD.renamed(ascii_literal!("dontDelete")).with(Attributes::DONT_DELETE).without(HIDDEN),
    METHOD.renamed(ascii_literal!("dontDeleteDontEnum")).with(Attributes::DONT_DELETE),
]);

#[object_ops]
impl Stringifier {
    fn put(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        value: Value,
        slot: &mut PutPropertySlot,
    ) -> JsResult<bool> {
        let value = value.to_string(cx)?;
        self.ordinary_put(cx, name, value.into(), slot)
    }
}

#[native_abi]
fn create_stringifier(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let prototype = (frame.argument(0).as_object()).map_or(Value::NULL, Value::from);
    let base = base_for::<Stringifier>(cx, prototype);
    Ok(cx.allocate::<Stringifier>(Stringifier::init(base)).into())
}

// Properties that come and go

#[cell(ops, flags = TypeFlags::GET_OWN_PROPERTY_SLOT_IS_IMPURE)]
struct ImpureGetter {
    base: JsObject,
    pub(self) delegate: Field<Option<Gc<JsObject>>>,
}

#[object_ops]
impl ImpureGetter {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        cx.check_stack()?;
        if let Some(delegate) = self.delegate()
            && delegate.get_property_slot(cx, name, slot)?
        {
            return Ok(true);
        }
        self.ordinary_get_own_property_slot(cx, name, slot)
    }
}

#[native_abi]
fn create_impure_getter(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = cx.allocate::<ImpureGetter>(ImpureGetterInit {
        base: base_for::<ImpureGetter>(cx, Value::NULL),
        delegate: frame.argument(0).as_object(),
    });
    Ok(object.into())
}

#[native_abi]
fn set_impure_getter_delegate(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (Some(object), Some(delegate)) =
        (frame.argument(0).as_object(), frame.argument(1).as_object())
    else {
        return Ok(Value::UNDEFINED);
    };
    let Some(object) = object.downcast::<ImpureGetter>() else {
        return Err(cx.throw_type_error("argument is not an ImpureGetter"));
    };
    object.set_delegate(Some(delegate));
    Ok(Value::UNDEFINED)
}

/// An array whose elements are elsewhere.
#[cell(ops, shared_type = DerivedArray, flags = TypeFlags::INTERCEPTS_INDEXED_ACCESS)]
struct RuntimeArray {
    base: JsArray,
    numbers: Gc<JsArray>,
}

#[native_abi]
fn get_runtime_length(cx: &mut Cx, this: Value, _: PropertyName<'_>) -> JsResult<Value> {
    match this.downcast::<RuntimeArray>() {
        Some(array) => Ok(array.numbers.length().into()),
        None => Err(cx.throw_type_error("Type error")),
    }
}

impl RuntimeArray {
    fn fill_element_slot(&self, index: u32, slot: &mut PropertySlot) -> bool {
        let number = self.numbers.try_get_dense(index);
        let attributes = Attributes::DONT_DELETE | HIDDEN;
        (number.inspect(|&it| slot.set_value(self, attributes, it))).is_some()
    }
}

#[object_ops]
impl RuntimeArray {
    fn get_own_property_slot(
        &self,
        cx: &mut Cx,
        name: PropertyName<'_>,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if name == names::length {
            slot.set_cacheable_custom(self, Attributes::CONSTANT, get_runtime_length);
            return Ok(true);
        }
        if (name.as_index()).is_some_and(|index| self.fill_element_slot(index, slot)) {
            return Ok(true);
        }
        self.ordinary_get_own_property_slot(cx, name, slot)
    }

    fn get_own_property_slot_by_index(
        &self,
        cx: &mut Cx,
        index: u32,
        slot: &mut PropertySlot,
    ) -> JsResult<bool> {
        if self.fill_element_slot(index, slot) {
            return Ok(true);
        }
        self.ordinary_get_own_property_slot_by_index(cx, index, slot)
    }
}

#[native_abi]
fn create_runtime_array(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let numbers = cx.new_array();
    for argument in frame.arguments() {
        let number = argument.to_int32(cx)?;
        numbers.push(cx, number.into())?;
    }
    let base = JsArray::init(base_for::<RuntimeArray>(cx, cx.array_prototype().into()));
    Ok((cx.allocate::<RuntimeArray>(RuntimeArrayInit { base, numbers })).into())
}
