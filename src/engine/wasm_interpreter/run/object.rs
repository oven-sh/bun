//! Fields of structs and elements of arrays.

use core::cell::Cell;
use core::marker::ConstParamTy;

use bun_engine_asm::{Sign, Size};
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{StorageType, ValKind};
use bun_engine_wasm_runtime::interpreted::Missing;

use crate::machine::{Handler, attempt, handlers, specialize};

#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub(crate) enum Part {
    U8,
    I8,
    U16,
    I16,
    U32,
    U64,
    F32,
    F64,
    Vector,
    /// To be written. It is read as `U64`.
    Reference,
}

impl Part {
    pub(crate) fn to_read(ty: StorageType, sign: Option<Sign>) -> Self {
        match (ty.packed_size(), sign, ty.unpacked().kind()) {
            (Some(Size::S8), Some(Sign::Signed), _) => Self::I8,
            (Some(_), Some(Sign::Signed), _) => Self::I16,
            (None, _, ValKind::F32) => Self::F32,
            (None, _, ValKind::F64) => Self::F64,
            (None, _, ValKind::Ref) => Self::U64,
            _ => Self::to_write(ty),
        }
    }

    pub(crate) fn to_write(ty: StorageType) -> Self {
        match ty.size_in_bytes() {
            1 => Self::U8,
            2 => Self::U16,
            4 => Self::U32,
            8 if ty.is_ref() => Self::Reference,
            8 => Self::U64,
            _ => Self::Vector,
        }
    }
}

fn trap_for(missing: Missing, out_of_bounds: Trap) -> Trap {
    match missing {
        Missing::Array => Trap::NullReference,
        Missing::Element => out_of_bounds,
    }
}

macro_rules! read {
    ($m:ident, $part:ident, $dst:expr, $place:expr) => {
        match $part {
            Part::U8 => $m.produce($dst, u32::from(u8::from_le_bytes(Cell::get($place)))),
            Part::I8 => $m.produce($dst, i8::from_le_bytes(Cell::get($place)) as u32),
            Part::U16 => $m.produce($dst, u32::from(u16::from_le_bytes(Cell::get($place)))),
            Part::I16 => $m.produce($dst, i16::from_le_bytes(Cell::get($place)) as u32),
            Part::U32 => $m.produce($dst, u32::from_le_bytes(Cell::get($place))),
            Part::F32 => $m.produce($dst, f32::from_le_bytes(Cell::get($place))),
            Part::F64 => $m.produce($dst, f64::from_le_bytes(Cell::get($place))),
            Part::Vector => $m.set_vector($dst, u128::from_le_bytes(Cell::get($place))),
            Part::U64 | Part::Reference => $m.produce($dst, u64::from_le_bytes(Cell::get($place))),
        }
    };
}

macro_rules! write {
    ($m:ident, $part:ident, $src:expr, $place:expr) => {
        match $part {
            Part::U8 => Cell::set($place, ($m.get($src) as u8).to_le_bytes()),
            Part::U16 => Cell::set($place, ($m.get($src) as u16).to_le_bytes()),
            Part::U32 => Cell::set($place, ($m.get($src) as u32).to_le_bytes()),
            Part::Vector => Cell::set($place, $m.vector($src).to_le_bytes()),
            _ => Cell::set($place, $m.get($src).to_le_bytes()),
        }
    };
}

handlers! {
    fn struct_get[const PART: Part, const IS_LAST: bool](m, op) {
        let (cx, object) = (m.cx, m.read::<u64, IS_LAST>(op.b));
        read!(m, PART, op.a, attempt!(cx.field(object, op.imm), NullReference));
    }

    fn struct_set[const PART: Part](m, op) {
        let object = m.get(op.a);
        if PART == Part::Reference {
            attempt!(m.cx.set_reference_in_field(object, op.imm, m.get(op.b)), NullReference);
            m.forget_last_results();
        } else {
            write!(m, PART, op.b, attempt!(m.cx.field(object, op.imm), NullReference));
        }
    }

    fn array_get[const PART: Part, const INDEX_IS_LAST: bool](m, op) {
        let (cx, array, index) = (m.cx, m.get(op.b), m.read::<u32, INDEX_IS_LAST>(op.c()));
        let trap = |missing| trap_for(missing, Trap::ArrayGetOutOfBounds);
        read!(m, PART, op.a, attempt!(cx.array_element(array, index).map_err(trap)));
    }

    fn array_set[const PART: Part](m, op) {
        let (array, index) = (m.get(op.a), m.get(op.b) as u32);
        let trap = |missing| trap_for(missing, Trap::ArraySetOutOfBounds);
        if PART == Part::Reference {
            attempt!(m.cx.set_reference_in_array(array, index, m.get(op.c())).map_err(trap));
            m.forget_last_results();
        } else {
            write!(m, PART, op.c(), attempt!(m.cx.array_element(array, index).map_err(trap)));
        }
    }

    fn array_len[const IS_LAST: bool](m, op) {
        let length = m.cx.array_len(m.read::<u64, IS_LAST>(op.b));
        m.produce(op.a, attempt!(length, NullReference));
    }
}

pub(crate) fn for_struct_get(part: Part, is_last: bool) -> Handler {
    specialize!(part => const PART: Part { U8 I8 U16 I16 U32 U64 F32 F64 Vector },
        specialize!(is_last => const IS_LAST: bool, struct_get::<PART, IS_LAST>))
}

pub(crate) fn for_struct_set(part: Part) -> Handler {
    specialize!(part => const PART: Part { U8 U16 U32 U64 Vector Reference }, struct_set::<PART>)
}

pub(crate) fn for_array_get(part: Part, index_is_last: bool) -> Handler {
    specialize!(part => const PART: Part { U8 I8 U16 I16 U32 U64 F32 F64 Vector },
        specialize!(index_is_last => const INDEX_IS_LAST: bool, array_get::<PART, INDEX_IS_LAST>))
}

pub(crate) fn for_array_set(part: Part) -> Handler {
    specialize!(part => const PART: Part { U8 U16 U32 U64 Vector Reference }, array_set::<PART>)
}

pub(crate) fn for_array_len(is_last: bool) -> Handler {
    specialize!(is_last => const IS_LAST: bool, array_len::<IS_LAST>)
}
