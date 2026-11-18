//! Access by index. The object is in `T1` and the index, extended with its sign, in `T3`.

use bun_engine_asm::prelude::*;
use bun_engine_text::StringImpl;
use bun_engine_vm::{
    ArrayModes, CellType, ElementKind, Environment, IndexingMode, JsArrayBufferView, JsString,
    MappedArguments, SmallStrings, Vm,
};

use crate::emit::{Emit, TRUE, at, public_length, storage, vector_length};
use crate::registers::*;

const OBJECT: Gpr = T1;
pub(super) const INDEX: Gpr = T3;
const INT32: i32 = ElementKind::Int32 as i32;
const DOUBLE: i32 = ElementKind::Double as i32;
const CONTIGUOUS: i32 = ElementKind::Contiguous as i32;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Elements {
    Int32,
    Contiguous,
    /// Either of the two.
    Values,
    Double,
    String,
    DirectArguments,
    ScopedArguments,
    /// Of numbers.
    Typed(CellType),
}

/// Where to go if there is no such element.
#[derive(Clone, Copy)]
pub(crate) struct Absent {
    pub(crate) hole: Label,
    pub(crate) outside: Label,
}

impl Absent {
    pub(crate) fn both(label: Label) -> Absent {
        Absent {
            hole: label,
            outside: label,
        }
    }
}

impl Elements {
    pub(super) fn typed(m: &MacroAssembler, cell_type: CellType) -> Option<Elements> {
        let is_supported = match cell_type {
            CellType::Float16Array => m.supports_f16(),
            CellType::BigInt64Array | CellType::BigUint64Array => false,
            _ => true,
        };
        is_supported.then_some(Elements::Typed(cell_type))
    }

    /// Unless the indexing mode tells.
    pub(super) fn mode(self) -> Option<ArrayModes> {
        match self {
            Elements::String => Some(ArrayModes::STRING),
            Elements::DirectArguments => Some(ArrayModes::DIRECT_ARGUMENTS),
            Elements::ScopedArguments => Some(ArrayModes::SCOPED_ARGUMENTS),
            Elements::Typed(cell_type) => Some(ArrayModes::of_typed_array(cell_type)),
            _ => None,
        }
    }

    /// The kind that is worth a place in the template.
    pub(crate) fn likely(m: &MacroAssembler, modes: ArrayModes) -> Option<Elements> {
        let typed = (modes & ArrayModes::TYPED_ARRAYS).bits();
        if modes.contains(ArrayModes::INT32 | ArrayModes::CONTIGUOUS) {
            Some(Elements::Values)
        } else if modes.contains(ArrayModes::CONTIGUOUS) {
            Some(Elements::Contiguous)
        } else if modes.contains(ArrayModes::DOUBLE) {
            Some(Elements::Double)
        } else if modes.contains(ArrayModes::INT32) {
            Some(Elements::Int32)
        } else if typed != 0 {
            let distance = typed.trailing_zeros() - ArrayModes::INT8_ARRAY.bits().trailing_zeros();
            Self::typed(m, CellType(CellType::Int8Array.0 + distance as u8))
        } else if modes.contains(ArrayModes::DIRECT_ARGUMENTS) {
            Some(Elements::DirectArguments)
        } else if modes.contains(ArrayModes::SCOPED_ARGUMENTS) {
            Some(Elements::ScopedArguments)
        } else {
            modes
                .contains(ArrayModes::STRING)
                .then_some(Elements::String)
        }
    }
}

fn element(base: Gpr, scale: Scale) -> Address {
    Address::indexed(base, INDEX, scale, 0)
}

fn check_bounds_of_view(m: &mut MacroAssembler, cell_type: CellType, other: Label, outside: Label) {
    m.branch_if_not_type(OBJECT, cell_type, other);
    let length = at(OBJECT, JsArrayBufferView::OFFSET_OF_LENGTH);
    m.branch64(Cond::AboveEq, INDEX, length, outside);
}

fn load_vector(m: &mut MacroAssembler, cell_type: CellType, other: Label, outside: Label) {
    check_bounds_of_view(m, cell_type, other, outside);
    m.load64(T4, at(OBJECT, JsArrayBufferView::OFFSET_OF_VECTOR));
}

fn check_bounds_of_arguments(m: &mut MacroAssembler, kind: Elements, other: Label, outside: Label) {
    let cell_type = match kind {
        Elements::DirectArguments => CellType::DirectArguments,
        _ => CellType::ScopedArguments,
    };
    m.branch_if_not_type(OBJECT, cell_type, other);
    let length = at(OBJECT, MappedArguments::OFFSET_OF_PLAIN_LENGTH);
    m.branch32(Cond::AboveEq, INDEX, length, outside);
}

fn slot_of_arguments(index: Gpr) -> Address {
    let slots = MappedArguments::OFFSET_OF_SLOTS as i32;
    Address::indexed(OBJECT, index, Scale::Eight, slots)
}

/// As `load_element`, but the result is `true`.
pub(crate) fn has_element(m: &mut MacroAssembler, kind: Elements, other: Label, absent: Absent) {
    match kind {
        Elements::Typed(cell_type) => check_bounds_of_view(m, cell_type, other, absent.outside),
        Elements::DirectArguments | Elements::ScopedArguments => {
            check_bounds_of_arguments(m, kind, other, absent.outside);
        }
        _ => load_element(m, kind, other, absent),
    }
    m.move32(T0, TRUE);
}

/// Into `T0`. Goes to `other` if the object is not of that kind, and to `absent` also if there is more to it.
/// Overwrites `T4`.
pub(crate) fn load_element(m: &mut MacroAssembler, kind: Elements, other: Label, absent: Absent) {
    let miss = absent.outside;
    match kind {
        Elements::Int32 | Elements::Contiguous | Elements::Values | Elements::Double => {
            m.load_indexing_mode(T0, OBJECT, IndexingMode::KIND_MASK);
            if kind == Elements::Double {
                m.branch32(Cond::Ne, T0, DOUBLE, other);
            } else {
                m.sub32(T0, T0, INT32);
                m.branch_test32(TestCond::NonZero, T0, !(CONTIGUOUS - INT32), other);
            }
            m.load64(T4, storage(OBJECT));
            m.branch32(Cond::AboveEq, INDEX, public_length(T4), absent.outside);
            if kind == Elements::Double {
                m.load_f64(F0, element(T4, Scale::Eight));
                m.branch_f64(FloatCond::Unordered, F0, F0, absent.hole);
                m.box_double(T0, F0);
            } else {
                m.load64(T0, element(T4, Scale::Eight));
                m.branch_if_empty(T0, absent.hole);
            }
        }
        Elements::String => {
            m.branch_if_not_type(OBJECT, CellType::String, other);
            m.load64(T4, at(OBJECT, JsString::OFFSET_OF_FIBER));
            m.branch_test32(TestCond::NonZero, T4, JsString::IS_ROPE, miss);
            m.branch32(
                Cond::AboveEq,
                INDEX,
                at(T4, StringImpl::OFFSET_OF_LENGTH),
                miss,
            );
            m.load_code_unit(T0, T4, INDEX, T0);
            m.branch32(Cond::Above, T0, i32::from(u8::MAX), miss);
            let strings = Vm::OFFSET_OF_SMALL_STRINGS + SmallStrings::OFFSET_OF_SINGLE_CHARACTERS;
            m.load64(T0, Address::indexed(VM, T0, Scale::Eight, strings as i32));
            m.branch_if_zero64(T0, miss);
        }
        Elements::DirectArguments => {
            check_bounds_of_arguments(m, kind, other, miss);
            m.load64(T0, slot_of_arguments(INDEX));
        }
        Elements::ScopedArguments => {
            let (parameter, done) = (m.new_label(), m.new_label());
            check_bounds_of_arguments(m, kind, other, miss);
            let parameters = at(OBJECT, MappedArguments::OFFSET_OF_PARAMETERS);
            m.branch_sub32(ResultCond::Carry, T4, INDEX, parameters, parameter);
            m.load64(T0, slot_of_arguments(T4));
            m.jump(done);
            m.bind(parameter);
            m.load64(T4, at(OBJECT, MappedArguments::OFFSET_OF_SCOPE));
            m.load64(
                T0,
                element(T4, Scale::Eight).plus(Environment::OFFSET_OF_SLOTS as i32),
            );
            m.branch_if_empty(T0, miss);
            m.bind(done);
        }
        Elements::Typed(cell_type) => {
            load_vector(m, cell_type, other, miss);
            match cell_type {
                CellType::Int8Array => m.load8_signed32(T0, element(T4, Scale::One)),
                CellType::Int16Array => m.load16_signed32(T0, element(T4, Scale::Two)),
                CellType::Uint16Array => m.load16(T0, element(T4, Scale::Two)),
                CellType::Int32Array | CellType::Uint32Array => {
                    m.load32(T0, element(T4, Scale::Four));
                }
                CellType::Float16Array | CellType::Float32Array | CellType::Float64Array => {
                    if cell_type == CellType::Float16Array {
                        m.load16(T0, element(T4, Scale::Two));
                        m.convert_f16_bits_to_f64(F0, T0);
                    } else if cell_type == CellType::Float32Array {
                        m.load_f32(F0, element(T4, Scale::Four));
                        m.convert_f32_to_f64(F0, F0);
                    } else {
                        m.load_f64(F0, element(T4, Scale::Eight));
                    }
                    m.canonicalize_nan(F0);
                    return m.box_double(T0, F0);
                }
                _ => m.load8(T0, element(T4, Scale::One)),
            }
            let done = m.new_label();
            if cell_type == CellType::Uint32Array {
                let fits = m.new_label();
                m.branch_test32(TestCond::NonNegative, T0, -1, fits);
                m.convert_u32_to_f64(F0, T0);
                m.box_double(T0, F0);
                m.jump(done);
                m.bind(fits);
            }
            m.box_int32(T0, T0);
            m.bind(done);
        }
    }
}

/// Makes the element at the index one that exists, if there is room for it.
fn extend(m: &mut MacroAssembler, modes: Address, miss: Label) {
    let inside = m.new_label();
    m.load64(T4, storage(OBJECT));
    m.branch32(Cond::Below, INDEX, public_length(T4), inside);
    m.branch32(Cond::AboveEq, INDEX, vector_length(T4), miss);
    m.or_to_memory(Size::S32, modes, ArrayModes::HOLE.bits());
    m.add32(T5, INDEX, 1);
    m.store32(public_length(T4), T5);
    m.bind(inside);
}

/// From `T6`. Overwrites `T4` and `T5`. Goes to `miss` if the value does not suit. The barrier is left to the caller.
pub(crate) fn store_element(
    m: &mut MacroAssembler,
    kind: Elements,
    modes: Address,
    other: Label,
    absent: Absent,
    miss: Label,
) {
    let value = T6;
    if kind == Elements::DirectArguments {
        check_bounds_of_arguments(m, kind, other, absent.outside);
        return m.store64(slot_of_arguments(INDEX), value);
    }
    let Elements::Typed(cell_type) = kind else {
        m.load_indexing_mode(T4, OBJECT, IndexingMode::KIND_AND_WRITABILITY_MASK);
        match kind {
            Elements::Double => {
                m.branch32(Cond::Ne, T4, DOUBLE, other);
                m.number_to_double(F0, value, T4, miss);
                m.branch_f64(FloatCond::Unordered, F0, F0, miss);
                extend(m, modes, absent.outside);
                return m.store_f64(element(T4, Scale::Eight), F0);
            }
            Elements::Int32 => {
                m.branch32(Cond::Ne, T4, INT32, other);
                m.branch_if_not_int32(value, miss);
            }
            Elements::Contiguous => m.branch32(Cond::Ne, T4, CONTIGUOUS, other),
            _ => {
                let fits = m.new_label();
                m.branch32(Cond::Eq, T4, CONTIGUOUS, fits);
                m.branch32(Cond::Ne, T4, INT32, other);
                m.branch_if_not_int32(value, miss);
                m.bind(fits);
            }
        }
        extend(m, modes, absent.outside);
        return m.store64(element(T4, Scale::Eight), value);
    };
    load_vector(m, cell_type, other, absent.outside);
    if let CellType::Float16Array | CellType::Float32Array | CellType::Float64Array = cell_type {
        m.number_to_double(F0, value, T5, miss);
        if cell_type == CellType::Float16Array {
            m.convert_f64_to_f16_bits(T5, F0);
            return m.store16(element(T4, Scale::Two), T5);
        }
        if cell_type == CellType::Float64Array {
            return m.store_f64(element(T4, Scale::Eight), F0);
        }
        m.convert_f64_to_f32(F0, F0);
        return m.store_f32(element(T4, Scale::Four), F0);
    }
    let int32 = m.new_label();
    m.move64(T5, value);
    if cell_type == CellType::Uint8ClampedArray {
        m.branch_if_not_int32(T5, miss);
        m.branch32(Cond::BelowEq, T5, i32::from(u8::MAX), int32);
        m.sar32(T5, T5, 31);
        m.not32(T5, T5);
    } else {
        m.branch_if_int32(T5, int32);
        m.branch_if_not_number(T5, miss);
        m.unbox_double(F0, T5, T5);
        m.truncate_f64_to_int32_modular(T5, F0, miss);
    }
    m.bind(int32);
    match cell_type {
        CellType::Int16Array | CellType::Uint16Array => m.store16(element(T4, Scale::Two), T5),
        CellType::Int32Array | CellType::Uint32Array => m.store32(element(T4, Scale::Four), T5),
        _ => m.store8(element(T4, Scale::One), T5),
    }
}
