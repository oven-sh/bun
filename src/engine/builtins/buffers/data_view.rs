use bun_engine_vm::{
    CellType, Element, Float16, JsArrayBuffer, JsArrayBufferView, JsDataView, errors,
};

use super::constructors::view_on_buffer;
use super::create_view_shapes;
use crate::prelude::*;

macro_rules! prototype_properties {
    ($($name:ident, $type:ty;)*) => {
        static_table!(static PROTOTYPE_PROPERTIES = [
            $(StaticProperty::function(names::${concat(get, $name)}, get::<$type>, 1)
                .with_intrinsic(Intrinsic::${concat(DataViewGet, $name)}),)*
            $(StaticProperty::function(names::${concat(set, $name)}, set::<$type>, 2)
                .with_intrinsic(Intrinsic::${concat(DataViewSet, $name)}),)*
            StaticProperty::getter(names::buffer, buffer),
            StaticProperty::getter(names::byteOffset, byte_offset),
            StaticProperty::getter(names::byteLength, byte_length).with_intrinsic(Intrinsic::DataViewByteLength),
            StaticProperty::string(symbols::toStringTag, names::DataView),
        ]);
    };
}

prototype_properties! {
    Int8, i8;
    Uint8, u8;
    Int16, i16;
    Uint16, u16;
    Int32, i32;
    Uint32, u32;
    Float16, Float16;
    Float32, f32;
    Float64, f64;
    BigInt64, i64;
    BigUint64, u64;
}

define_object!(DataViewPrototype, "DataView", PROTOTYPE_PROPERTIES);

static_table!(static CONSTRUCTOR_PROPERTIES = [
    StaticProperty::position_of(names::length),
    StaticProperty::position_of(names::name),
    StaticProperty::position_of(names::prototype),
    StaticProperty::number(names::BYTES_PER_ELEMENT, 1.0),
]);

define_constructor!(DataViewConstructor, CONSTRUCTOR_PROPERTIES, call, construct);

pub(super) fn initialize(cx: &Cx) {
    let (global, parent) = (cx.global(), cx.function_prototype());
    let prototype = DataViewPrototype::create(cx, cx.object_prototype().into());
    let constructor = DataViewConstructor::create(cx, parent, 1, names::DataView, &prototype);
    let [fixed, resizable] = create_view_shapes(cx, CellType::DataView, prototype);
    global.init_data_view_shape(fixed);
    global.init_resizable_data_view_shape(resizable);
    global.init_data_view_constructor(constructor);
}

#[native_abi]
fn call(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    Err(errors::throw_called_without_new(cx, "DataView"))
}

#[native_abi]
fn construct(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument_count() == 0 {
        return Err(cx.throw_type_error("DataView constructor requires at least one argument."));
    }
    let Some(buffer) = frame.argument(0).downcast::<JsArrayBuffer>() else {
        return Err(cx.throw_type_error("Expected ArrayBuffer for the first argument."));
    };
    let offset = frame.argument(1).to_index(cx, "byteOffset")? as usize;
    if buffer.is_detached() {
        return Err(cx.throw_type_error(errors::BUFFER_ALREADY_DETACHED));
    }
    let Some(available) = buffer.byte_length().checked_sub(offset) else {
        return Err(cx.throw_range_error(errors::BYTE_OFFSET_EXCEEDS_BUFFER));
    };
    let length = match frame.argument(2) {
        Value::UNDEFINED => None,
        length => Some(length.to_index(cx, "byteLength")? as usize),
    };
    if length.is_some_and(|length| length > available) {
        return Err(cx.throw_range_error(errors::LENGTH_OUT_OF_RANGE_OF_BUFFER));
    }
    let is_resizable = buffer.is_resizable_or_growable();
    let shape = cx.shape_from_new_target(frame.new_target(), &frame.callee(), |global, vm| {
        global.view_shape(vm, CellType::DataView, is_resizable)
    })?;
    view_on_buffer(cx, shape, &buffer, offset, length, 1)
}

#[inline(always)]
fn this_view(cx: &Cx, frame: &CallFrame, message: &'static str) -> JsResult<Gc<JsDataView>> {
    let this = frame.this_value().downcast();
    this.ok_or_else(|| cx.throw_type_error(message))
}

const METHOD_NEEDS_DATA_VIEW: &str = "Receiver of DataView method must be a DataView";

#[native_abi]
fn get<T: Element>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_view(cx, frame, METHOD_NEEDS_DATA_VIEW)?;
    let offset = frame.argument(0).to_index(cx, "byteOffset")?;
    let is_little_endian = frame.argument(1).to_boolean(cx);
    let value = this.get_value::<T>(cx, offset, is_little_endian)?;
    Ok(value.to_value(cx))
}

#[native_abi]
fn set<T: Element>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_view(cx, frame, METHOD_NEEDS_DATA_VIEW)?;
    let offset = frame.argument(0).to_index(cx, "byteOffset")?;
    let value = T::from_value(cx, frame.argument(1))?;
    let is_little_endian = frame.argument(2).to_boolean(cx);
    this.set_value(cx, offset, value, is_little_endian)?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn buffer(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "DataView.prototype.buffer expects |this| to be a DataView object";
    this_view(cx, frame, message)?.js_buffer(cx).map(Into::into)
}

#[native_abi]
fn byte_length(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "DataView.prototype.byteLength expects |this| to be a DataView object";
    match this_view(cx, frame, message)?.checked_length() {
        Some(length) => Ok(length.into()),
        None => Err(JsArrayBufferView::throw_out_of_bounds(cx)),
    }
}

#[native_abi]
fn byte_offset(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let message = "DataView.prototype.byteOffset expects |this| to be a DataView object";
    let this = this_view(cx, frame, message)?;
    if this.is_out_of_bounds() {
        return Err(JsArrayBufferView::throw_out_of_bounds(cx));
    }
    Ok(this.declared_byte_offset().into())
}
