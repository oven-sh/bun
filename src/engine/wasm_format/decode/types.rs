//! The encoding of value types.

use crate::module::{Features, ModuleHeader};
use crate::reader::Reader;
use crate::types::{AbstractHeapType, HeapType, ValType};

pub(crate) const I32: u8 = 0x7f;
pub(crate) const I64: u8 = 0x7e;
pub(crate) const F32: u8 = 0x7d;
pub(crate) const F64: u8 = 0x7c;
pub(crate) const V128: u8 = 0x7b;
pub(crate) const I8: u8 = 0x78;
pub(crate) const I16: u8 = 0x77;
pub(crate) const REF: u8 = 0x64;
pub(crate) const REF_NULL: u8 = 0x63;
pub(crate) const FUNC: u8 = 0x60;
pub(crate) const STRUCT: u8 = 0x5f;
pub(crate) const ARRAY: u8 = 0x5e;
pub(crate) const SUB: u8 = 0x50;
pub(crate) const SUB_FINAL: u8 = 0x4f;
pub(crate) const REC: u8 = 0x4e;
pub(crate) const EMPTY: u8 = 0x40;

fn abstract_heap_type(byte: u8) -> Option<HeapType> {
    Some(HeapType::of(match byte {
        0x74 => AbstractHeapType::NoExn,
        0x73 => AbstractHeapType::NoFunc,
        0x72 => AbstractHeapType::NoExtern,
        0x71 => AbstractHeapType::None,
        0x70 => AbstractHeapType::Func,
        0x6f => AbstractHeapType::Extern,
        0x6e => AbstractHeapType::Any,
        0x6d => AbstractHeapType::Eq,
        0x6c => AbstractHeapType::I31,
        0x6b => AbstractHeapType::Struct,
        0x6a => AbstractHeapType::Array,
        0x69 => AbstractHeapType::Exn,
        _ => return None,
    }))
}

pub(crate) fn starts_value_type(byte: u8) -> bool {
    matches!(byte, V128..=I32 | REF | REF_NULL) || abstract_heap_type(byte).is_some()
}

/// `defined` looks up a type index.
#[inline]
fn heap_type(
    reader: &mut Reader<'_>,
    defined: impl FnOnce(u32) -> Option<HeapType>,
) -> Option<HeapType> {
    let first = reader.peek()?;
    match u32::try_from(reader.i32()?) {
        Ok(index) => defined(index),
        Err(_) => abstract_heap_type(first),
    }
}

/// `defined` looks up a type index.
#[inline]
pub(crate) fn value_type(
    reader: &mut Reader<'_>,
    features: Features,
    defined: impl FnOnce(u32) -> Option<HeapType>,
) -> Option<ValType> {
    Some(match reader.u8()? {
        I32 => ValType::I32,
        I64 => ValType::I64,
        F32 => ValType::F32,
        F64 => ValType::F64,
        V128 if features.contains(Features::SIMD) => ValType::V128,
        REF => heap_type(reader, defined)?.non_null().into(),
        REF_NULL => heap_type(reader, defined)?.nullable().into(),
        byte => abstract_heap_type(byte)?.nullable().into(),
    })
}

impl ModuleHeader {
    #[inline]
    pub(crate) fn heap_type(&self, reader: &mut Reader<'_>) -> Option<HeapType> {
        heap_type(reader, |index| self.types.get_heap_type(index))
    }

    #[inline]
    pub(crate) fn value_type(&self, reader: &mut Reader<'_>) -> Option<ValType> {
        value_type(reader, self.features, |index| {
            self.types.get_heap_type(index)
        })
    }
}
