use bun_engine_bytecode::op;
use bun_engine_vm::code::metadata::{ArrayAccess, GetByVal};
use bun_engine_vm::{
    ArrayModes, CellType, ClampedU8, ElementKind, ElementType, Float16, IndexingMode, JsCell,
    JsObject, JsString, JsTypedArray, MappedArguments, NumberElement, Value,
};

use super::barrier_and_next;
use super::properties::{
    get_by_name, get_by_val_slow, put_by_name, put_by_name_direct, put_by_val_direct_slow,
    put_by_val_slow,
};
use crate::machine::{EMPTY, UNDEFINED, cell, go, handler, next};

const INT32: u8 = ElementKind::Int32 as u8;
const DOUBLE: u8 = ElementKind::Double as u8;
const CONTIGUOUS: u8 = ElementKind::Contiguous as u8;

handler! {
    fn get_by_val(m, op: op::GetByVal) {
        let (base, key) = (m.get(op.base), m.get(op.key));
        if !m.is_int32(key) {
            go!(m, get_by_name::<W>)
        }
        if !m.is_cell(base) {
            go!(m, get_by_val_slow::<W>)
        }
        let (object, index) = (cell::<JsObject>(base), key as u32);
        let kind = object.indexing_mode().bits() & IndexingMode::KIND_MASK;
        let value = if kind == CONTIGUOUS || kind == INT32 {
            let storage = object.storage();
            if index >= storage.public_length() {
                go!(m, get_missing_element::<W>; base)
            }
            Value::bits_of(storage.value_at(index).get())
        } else if kind == DOUBLE {
            let storage = object.storage();
            if index >= storage.public_length() {
                go!(m, get_missing_element::<W>; base)
            }
            let number = storage.double_at(index).get();
            if number.is_nan() { EMPTY } else { m.box_double(number) }
        } else {
            go!(m, get_from_typed_array_or_string::<W>; base)
        };
        if value == EMPTY {
            go!(m, get_missing_element::<W>; base)
        }
        let entry = m.entry::<GetByVal>(op.metadata);
        entry.array.record_shape(&object);
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    /// The elements are dense.
    #[inline(never)]
    fn get_missing_element(m, op: op::GetByVal, base) {
        let (object, index) = (cell::<JsObject>(base), m.get(op.key) as i32);
        if index < 0 {
            go!(m, get_by_name::<W>)
        }
        if !object.is_known_to_have_only_own_elements(m.vm) {
            go!(m, get_by_val_slow::<W>)
        }
        let entry = m.entry::<GetByVal>(op.metadata);
        let is_hole = (index as u32) < object.storage().public_length();
        entry.array.record(if is_hole { ArrayModes::HOLE } else { ArrayModes::OUT_OF_BOUNDS });
        entry.array.record_shape(&object);
        entry.value.record_bits(UNDEFINED);
        m.set(op.dst, UNDEFINED);
        next!(m, op)
    }

    #[inline(never)]
    fn get_from_typed_array_or_string(m, op: op::GetByVal, base) {
        let (object, index) = (cell::<JsCell>(base), sign_extended(m.get(op.key)));
        let value = if let Some(element_type) = ElementType::of_cell_type(object.cell_type()) {
            let array = cell::<JsTypedArray>(base);
            if index >= array.known_length() {
                go!(m, get_by_val_slow::<W>)
            }
            // The memory has any bits.
            let box_float = |it: f64| if it.is_nan() { Value::NAN.to_bits() } else { m.box_double(it) };
            match element_type {
                ElementType::Int8 => m.box_int32(array.get_unchecked::<i8>(index).into()),
                ElementType::Uint8 | ElementType::Uint8Clamped => m.box_int32(array.get_unchecked::<u8>(index).into()),
                ElementType::Int16 => m.box_int32(array.get_unchecked::<i16>(index).into()),
                ElementType::Uint16 => m.box_int32(array.get_unchecked::<u16>(index).into()),
                ElementType::Int32 => m.box_int32(array.get_unchecked(index)),
                ElementType::Uint32 => {
                    let element = array.get_unchecked::<u32>(index);
                    i32::try_from(element).map_or_else(|_| m.box_double(element.into()), |it| m.box_int32(it))
                }
                ElementType::Float16 => box_float(array.get_unchecked::<Float16>(index).into()),
                ElementType::Float32 => box_float(array.get_unchecked::<f32>(index).into()),
                ElementType::Float64 => box_float(array.get_unchecked(index)),
                ElementType::BigInt64 | ElementType::BigUint64 => go!(m, get_by_val_slow::<W>),
            }
        } else if object.is_string()
            && let Some(string) = cell::<JsString>(base).try_resolved()
            && let Some(unit @ ..=0xff) = string.text().get(index)
        {
            m.vm.small_strings.single_character(unit as u8).address() as u64
        } else if object.cell_type() == CellType::DirectArguments
            && let Some(value) = cell::<MappedArguments>(base).try_get_direct(index)
        {
            value.to_bits()
        } else {
            go!(m, get_by_val_slow::<W>)
        };
        let entry = m.entry::<GetByVal>(op.metadata);
        entry.array.record_shape(&object);
        entry.value.record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }

    #[inline(never)]
    fn put_to_typed_array(m, op: op::PutByVal) {
        let (base, value) = (m.get(op.base), m.get(op.value));
        let Some(element_type) = ElementType::of_cell_type(cell::<JsCell>(base).cell_type()) else {
            go!(m, put_by_val_slow::<W>)
        };
        let (array, index) = (cell::<JsTypedArray>(base), sign_extended(m.get(op.key)));
        if index >= array.known_length() || !m.is_number(value) || element_type.is_bigint() {
            go!(m, put_by_val_slow::<W>)
        }
        if element_type.is_float() || (element_type == ElementType::Uint8Clamped && !m.is_int32(value)) {
            let number = if m.is_int32(value) { f64::from(value as i32) } else { m.unbox_double(value) };
            match element_type {
                ElementType::Float64 => array.set_unchecked(index, number),
                ElementType::Float32 => array.set_unchecked(index, number as f32),
                ElementType::Float16 => array.set_unchecked(index, Float16::from_double(number)),
                _ => array.set_unchecked(index, ClampedU8::from_double(number)),
            }
        } else {
            let integer = if m.is_int32(value) {
                value as i32
            } else if m.unbox_double(value).abs() < i64::MAX as f64 {
                m.unbox_double(value).to_int_unchecked::<i64>() as i32
            } else {
                go!(m, put_by_val_slow::<W>)
            };
            match element_type {
                ElementType::Int8 | ElementType::Uint8 => array.set_unchecked(index, integer as u8),
                ElementType::Uint8Clamped => array.set_unchecked(index, ClampedU8::from_int32(integer)),
                ElementType::Int16 | ElementType::Uint16 => array.set_unchecked(index, integer as u16),
                _ => array.set_unchecked(index, integer),
            }
        }
        m.entry::<ArrayAccess>(op.metadata).array.record_shape(&array);
        next!(m, op)
    }
}

/// A negative int32 is above any length.
#[inline(always)]
fn sign_extended(int32: u64) -> usize {
    int32 as i32 as usize
}

macro_rules! stores {
    ($($name:ident, $by_name:ident, $otherwise:ident, $slow:ident, $Op:ident;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let (base, key, value) = (m.get(op.base), m.get(op.key), m.get(op.value));
            if !m.is_int32(key) {
                go!(m, $by_name::<W>)
            }
            if !m.is_cell(base) {
                go!(m, $slow::<W>)
            }
            let (object, index) = (cell::<JsObject>(base), key as u32);
            let mode = object.indexing_mode().bits() & IndexingMode::KIND_AND_WRITABILITY_MASK;
            let word = if mode == CONTIGUOUS || (mode == INT32 && m.is_int32(value)) {
                value
            } else if mode == DOUBLE && let Some(number) = m.to_double(value) && !number.is_nan() {
                number.to_bits()
            } else {
                go!(m, $otherwise::<W>)
            };
            let (storage, profile) = (object.storage(), &m.entry::<ArrayAccess>(op.metadata).array);
            if index >= storage.public_length() {
                if index >= storage.vector_length() {
                    go!(m, $slow::<W>)
                }
                profile.record(ArrayModes::HOLE);
                storage.set_public_length(index + 1);
            }
            profile.record_shape(&object);
            storage.value_at(index).set_word_without_barrier(word);
            barrier_and_next!(m, op: op::$Op, object, value)
        }
    )*} };
}

stores! {
    put_by_val, put_by_name, put_to_typed_array, put_by_val_slow, PutByVal;
    put_by_val_direct, put_by_name_direct, put_by_val_direct_slow, put_by_val_direct_slow, PutByValDirect;
}
