use bun_engine_vm::{
    CellKind, ClampedU8, Element, ElementType, Float16, IteratorRecord, JsArray, JsArrayBuffer,
    JsArrayBufferView, JsTypedArray, RealmSlot, TypedArray, ValueVec, errors, throw_not_iterable,
};

use super::create_view_shapes;
use super::prototype::TypedArrayPrototype;
use super::uint8_array::{from_base64, from_hex, set_from_base64, set_from_hex, to_base64, to_hex};
use crate::define::species_getter;
use crate::js;
use crate::prelude::*;

static_table!(static ABSTRACT_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::function(names::of, of, 0),
    StaticProperty::builtin(names::from, js::typed_array_constructor::from),
    StaticProperty::getter(symbols::species, species_getter).with_intrinsic(Intrinsic::SpeciesGetter),
]);

define_constructor!(
    TypedArrayConstructor,
    ABSTRACT_PROPERTIES,
    call_abstract,
    call_abstract
);

pub(super) fn initialize_abstract(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.function_prototype());
    let prototype = TypedArrayPrototype::create(cx, cx.object_prototype().into());
    let constructor = TypedArrayConstructor::create(cx, parent, 0, names::TypedArray, &prototype);
    global.init_typed_array_prototype(prototype);
    global.init_typed_array_constructor(constructor);
}

macro_rules! typed_arrays {
    ($($module:ident, $type:ty, $prototype_class:literal, $export:literal,
        [$($of_constructor:expr),*], [$($of_prototype:expr),*];)*) => {
        $(mod $module {
            use super::*;

            static_table!(static PROTOTYPE_PROPERTIES = [
                StaticProperty::number(names::BYTES_PER_ELEMENT, size_of::<$type>() as f64),
                $($of_prototype,)*
                StaticProperty::realm_slot(names::constructor, RealmSlot::${concat($module, _constructor)}),
            ]);

            define_object!(Prototype, $prototype_class, PROTOTYPE_PROPERTIES);

            static_table!(static CONSTRUCTOR_PROPERTIES = [
                StaticProperty::position_of(names::length),
                StaticProperty::position_of(names::name),
                StaticProperty::position_of(names::prototype),
                StaticProperty::number(names::BYTES_PER_ELEMENT, size_of::<$type>() as f64),
                $($of_constructor,)*
            ]);

            define_constructor!(
                Constructor,
                CONSTRUCTOR_PROPERTIES,
                call::<$type>,
                construct::<$type>,
                export = $export
            );

            pub(super) fn initialize(cx: &Cx) {
                let (global, parent, of) = (cx.global(), cx.typed_array_constructor(), <$type>::TYPE);
                let prototype = Prototype::create(cx, cx.typed_array_prototype().into());
                let constructor = Constructor::create(cx, parent, 3, of.name(), &prototype);
                let [fixed, resizable] = create_view_shapes(cx, of.cell_type(), prototype);
                global.${concat(init_, $module, _shape)}(fixed);
                global.${concat(init_resizable_, $module, _shape)}(resizable);
                global.${concat(init_, $module, _constructor)}(constructor);
            }
        })*

        pub(super) fn initialize_slot(cx: &Cx, slot: RealmSlot) -> bool {
            match slot {
                $(RealmSlot::${concat($module, _constructor)}
                | RealmSlot::${concat($module, _shape)}
                | RealmSlot::${concat(resizable_, $module, _shape)} => $module::initialize(cx),)*
                _ => return false,
            }
            true
        }
    };
}

typed_arrays! {
    int8_array, i8, "Int8ArrayPrototype", "engine_class_Int8ArrayConstructor", [], [];
    uint8_array, u8, "Uint8ArrayPrototype", "engine_class_Uint8ArrayConstructor",
        [
            StaticProperty::function(names::fromBase64, from_base64, 1),
            StaticProperty::function(names::fromHex, from_hex, 1)
        ],
        [
            StaticProperty::function(names::setFromBase64, set_from_base64, 1),
            StaticProperty::function(names::setFromHex, set_from_hex, 1),
            StaticProperty::function(names::toBase64, to_base64, 0),
            StaticProperty::function(names::toHex, to_hex, 0)
        ];
    uint8_clamped_array, ClampedU8, "Uint8ClampedArrayPrototype", "engine_class_Uint8ClampedArrayConstructor", [], [];
    int16_array, i16, "Int16ArrayPrototype", "engine_class_Int16ArrayConstructor", [], [];
    uint16_array, u16, "Uint16ArrayPrototype", "engine_class_Uint16ArrayConstructor", [], [];
    int32_array, i32, "Int32ArrayPrototype", "engine_class_Int32ArrayConstructor", [], [];
    uint32_array, u32, "Uint32ArrayPrototype", "engine_class_Uint32ArrayConstructor", [], [];
    float16_array, Float16, "Float16ArrayPrototype", "engine_class_Float16ArrayConstructor", [], [];
    float32_array, f32, "Float32ArrayPrototype", "engine_class_Float32ArrayConstructor", [], [];
    float64_array, f64, "Float64ArrayPrototype", "engine_class_Float64ArrayConstructor", [], [];
    bigint64_array, i64, "BigInt64ArrayPrototype", "engine_class_BigInt64ArrayConstructor", [], [];
    biguint64_array, u64, "BigUint64ArrayPrototype", "engine_class_BigUint64ArrayConstructor", [], [];
}

#[native_abi]
fn call_abstract(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(cx.throw_type_error("%TypedArray% should not be called directly"))
}

#[native_abi]
fn call<T: Element>(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let class = <TypedArray<T> as CellKind>::CLASS;
    Err(errors::throw_called_without_new(cx, class.name()))
}

#[native_abi]
fn construct<T: Element>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    construct_typed_array(cx, frame, T::TYPE)
}

#[inline(never)]
fn construct_typed_array(cx: &mut Cx, frame: &CallFrame, of: ElementType) -> JsResult<Value> {
    let shape_for = |cx: &mut Cx, is_resizable| {
        cx.shape_from_new_target(frame.new_target(), &frame.callee(), |global, vm| {
            global.typed_array_shape(vm, of, is_resizable)
        })
    };
    let first = frame.argument(0);
    let Some(object) = first.as_object() else {
        let length = first.to_index(cx, "length")? as usize;
        let shape = shape_for(cx, false)?;
        return JsTypedArray::create(cx, shape, length).map(Into::into);
    };
    let buffer = object.downcast::<JsArrayBuffer>();
    let shape = shape_for(cx, buffer.is_some_and(|it| it.is_resizable_or_growable()))?;
    let Some(buffer) = buffer else {
        return from_object(cx, shape, of, object).map(Into::into);
    };
    let (offset, size) = (
        frame.argument(1).to_index(cx, "byteOffset")? as usize,
        1 << of.size_shift(),
    );
    if offset & (size - 1) != 0 {
        let message = "byteOffset modulo TypedArray.BYTES_PER_ELEMENT must be 0";
        return Err(cx.throw_range_error(message));
    }
    let length = match frame.argument(2) {
        Value::UNDEFINED => None,
        length => Some(length.to_index(cx, "length")? as usize),
    };
    view_on_buffer(cx, shape, &buffer, offset, length, size)
}

/// The end of InitializeTypedArrayFromArrayBuffer and of the constructor of `DataView`.
#[inline]
pub(super) fn view_on_buffer(
    cx: &Cx,
    shape: Gc<Shape>,
    buffer: &JsArrayBuffer,
    offset: usize,
    length: Option<usize>,
    element_size: usize,
) -> JsResult<Value> {
    let buffer = buffer.buffer();
    if buffer.is_detached() {
        return Err(cx.throw_type_error(errors::BUFFER_ALREADY_DETACHED));
    }
    if length.is_none() {
        let byte_length = buffer.byte_length();
        if buffer.is_resizable_or_growable() {
            if offset > byte_length {
                return Err(cx.throw_range_error(errors::BYTE_OFFSET_EXCEEDS_BUFFER));
            }
        } else if byte_length & (element_size - 1) != 0 {
            return Err(cx.throw_range_error(
                "ArrayBuffer length minus the byteOffset is not a multiple of the element size",
            ));
        }
    }
    JsArrayBufferView::create_on_buffer(cx, shape, &buffer, offset, length).map(Into::into)
}

/// All elements are got before any conversion that a script can see.
pub(super) fn from_pristine_array(
    cx: &mut Cx,
    shape: Gc<Shape>,
    source: &JsArray,
) -> JsResult<Gc<JsTypedArray>> {
    let length = source.length() as usize;
    let (result, count) = JsTypedArray::from_plain_elements(cx, shape, source, length)?;
    if count < length {
        let mut rest = ValueVec::new();
        cx.or_out_of_memory(rest.try_reserve(length - count))?;
        for index in count..length {
            rest.push(source.get_index(cx, index as u64)?);
        }
        result.set_values(cx, count, &rest)?;
    }
    Ok(result)
}

/// Whether getting an element runs no script, so that the length stays as it is.
pub(super) fn can_skip_iteration(array: &JsArray) -> bool {
    array.is_iteration_pristine()
        && array.element_kind().is_dense()
        && !array.holes_must_forward_to_prototype()
}

fn from_object(
    cx: &mut Cx,
    shape: Gc<Shape>,
    of: ElementType,
    source: Gc<JsObject>,
) -> JsResult<Gc<JsTypedArray>> {
    if let Some(source) = source.downcast::<JsTypedArray>() {
        let length = source.validate(cx)?;
        if source.element_type().is_bigint() != of.is_bigint() {
            let message = "Content types of source and new typed array are different";
            return Err(cx.throw_type_error(message));
        }
        return JsTypedArray::from_typed_array(cx, shape, &source, length);
    }
    if let Some(array) = source.downcast::<JsArray>()
        && can_skip_iteration(&array)
    {
        return from_pristine_array(cx, shape, &array);
    }
    let method = source.get(cx, symbols::iterator)?;
    if method.is_undefined_or_null() {
        let length = source.length_of_array_like(cx)? as usize;
        let (result, count) = JsTypedArray::from_plain_elements(cx, shape, &source, length)?;
        result.set_one_by_one(cx, count, &source, count..length)?;
        return Ok(result);
    }
    let values = iterator_to_list(cx, source.into(), method)?;
    let result = JsTypedArray::create(cx, shape, values.len())?;
    result.set_values(cx, 0, &values)?;
    Ok(result)
}

fn iterator_to_list(cx: &mut Cx, iterable: Value, method: Value) -> JsResult<ValueVec> {
    if !method.is_callable() {
        return Err(throw_not_iterable(cx, iterable));
    }
    let mut values = ValueVec::new();
    IteratorRecord::from_method(cx, iterable, method)?
        .for_each(cx, |cx, value| cx.or_out_of_memory(values.try_push(value)))?;
    Ok(values)
}

#[native_abi]
fn of(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, values) = (frame.this_value(), frame.arguments());
    let result = if let Some(of) = cx.global().element_type_constructed_by(this) {
        JsTypedArray::create(
            cx,
            cx.global().typed_array_shape(cx, of, false),
            values.len(),
        )?
    } else {
        if !this.is_constructor() {
            return Err(cx.throw_type_error("TypedArray.of requires |this| to be a constructor"));
        }
        let result = cx.construct(this, &[values.len().into()], this)?;
        let (result, length) = JsTypedArray::validate_value(cx, result.into())?;
        if length < values.len() {
            let message = "TypedArray.of constructed typed array of insufficient length";
            return Err(cx.throw_type_error(message));
        }
        result
    };
    result.set_values(cx, 0, values)?;
    Ok(result.into())
}
