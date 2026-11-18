use bun_engine_vm::{CopyOrder, JsArrayBufferView, JsTypedArray, with_bits_type};

use super::prototype::{this_array, valid_this};
use super::relative_index;
use super::species::{construct_species, species_constructor};
use crate::prelude::*;

/// Of what TypedArrayCreateSameType makes.
#[inline(always)]
pub(super) fn default_shape(cx: &Cx, exemplar: &JsTypedArray) -> Gc<Shape> {
    cx.global().view_shape(cx, exemplar.cell_type(), false)
}

#[native_abi]
pub(super) fn set(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_array(cx, frame)?;
    let Some(&source) = frame.arguments().first() else {
        return Err(cx.throw_type_error("Expected at least one argument"));
    };
    let offset = frame.argument(1).to_integer_or_infinity(cx)?;
    if offset < 0.0 {
        return Err(cx.throw_range_error("Offset should not be negative"));
    }
    match source.downcast::<JsTypedArray>() {
        Some(source) => this.set_from_whole_typed_array(cx, offset as usize, &source),
        None => this.set_from_array_like(cx, offset as usize, source),
    }?;
    Ok(Value::UNDEFINED)
}

#[native_abi]
pub(super) fn copy_within(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let to = relative_index(cx, frame.argument(0), length, 0)?;
    let from = relative_index(cx, frame.argument(1), length, 0)?;
    let end = relative_index(cx, frame.argument(2), length, length)?;
    let count = end.saturating_sub(from).min(length - to);
    if count != 0 {
        let count = count.min(this.validate(cx)?.saturating_sub(to.max(from)));
        let (no_gc, shift) = (cx.no_gc(), this.size_shift());
        let elements_at = |index: usize| {
            let bytes = this.bytes(&no_gc);
            bytes.clamped(index << shift..(index + count) << shift)
        };
        elements_at(to).copy_from(elements_at(from));
    }
    Ok(this.into())
}

#[native_abi]
pub(super) fn slice(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let start = relative_index(cx, frame.argument(0), length, 0)?;
    let end = relative_index(cx, frame.argument(1), length, length)?.max(start);
    let count = end - start;
    let Some(species) = species_constructor(cx, &this)? else {
        let (shape, shift) = (default_shape(cx, &this), this.size_shift());
        let result = JsTypedArray::create_filled(cx, shape, count, |no_gc, filler| {
            filler.copy(this.bytes(no_gc).clamped(start << shift..end << shift));
        })?;
        if count != 0 {
            this.validate(cx)?;
        }
        return Ok(result.into());
    };
    let result = construct_species(cx, &this, species, &[count.into()], count)?;
    if count != 0 {
        this.validate(cx)?;
        result.set_from_typed_array(cx, 0, &this, start..end, CopyOrder::Ascending)?;
    }
    Ok(result.into())
}

#[native_abi]
pub(super) fn subarray(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let this = this_array(cx, frame)?;
    let (length, byte_offset) = (this.length(), this.declared_byte_offset());
    let start = relative_index(cx, frame.argument(0), length, 0)?;
    let count = match frame.argument(1) {
        Value::UNDEFINED if this.is_auto_length() => None,
        end => Some(relative_index(cx, end, length, length)?.saturating_sub(start)),
    };
    let byte_offset = byte_offset + (start << this.size_shift());
    let Some(species) = species_constructor(cx, &this)? else {
        let buffer = this.buffer(cx)?;
        let is_resizable = buffer.is_resizable_or_growable();
        let shape = cx.global().view_shape(cx, this.cell_type(), is_resizable);
        return JsArrayBufferView::create_on_buffer(cx, shape, &buffer, byte_offset, count)
            .map(Into::into);
    };
    let arguments = [
        this.js_buffer(cx)?.into(),
        byte_offset.into(),
        count.map_or_default(Value::from),
    ];
    let arguments = &arguments[..if count.is_some() { 3 } else { 2 }];
    construct_species(cx, &this, species, arguments, 0).map(Into::into)
}

#[native_abi]
pub(super) fn to_reversed(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let shape = default_shape(cx, &this);
    with_bits_type!(this.element_type(), K => {
        JsTypedArray::create_filled(cx, shape, length, |no_gc, filler| {
            filler.copy_reversed(this.bytes(no_gc).cast::<K>().slice(0..length));
        })
    })
    .map(Into::into)
}

#[native_abi]
pub(super) fn with(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let mut index = frame.argument(0).to_integer_or_infinity(cx)?;
    if index < 0.0 {
        index += length as f64;
    }
    let (of, shift) = (this.element_type(), this.size_shift());
    let bits = of.bits_from_value(cx, frame.argument(1))?;
    if index.is_infinite() {
        return Err(cx.throw_range_error("index should be integer"));
    }
    if index < 0.0 || !this.is_valid_index(index as usize) {
        return Err(cx.throw_range_error("index is out of range"));
    }
    let present = this.length();
    if present < length && of.is_bigint() {
        return Err(cx.throw_type_error("Cannot convert undefined to BigInt"));
    }
    let shape = default_shape(cx, &this);
    let result = JsTypedArray::create_filled(cx, shape, length, |no_gc, filler| {
        filler.copy(this.bytes(no_gc).clamped(0..length << shift));
    })?;
    let no_gc = cx.no_gc();
    with_bits_type!(of, K => {
        let elements = result.bytes(&no_gc).cast();
        if present < length {
            elements.slice(present..length).fill(of.bits_of_nan() as K);
        }
        elements.try_set(index as usize, bits as K);
    });
    Ok(result.into())
}
