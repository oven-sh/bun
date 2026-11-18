//! Values in places of 8 bytes, 16 for a `v128`: globals, arguments and results.

use bun_engine_wasm_format::{ValKind, ValType};

use crate::value::Bits;

/// # Safety
/// `place` is valid for a read of that size.
#[inline]
pub(crate) unsafe fn read(place: *const u8, ty: ValType) -> Bits {
    // SAFETY: the caller's.
    unsafe {
        match ty.kind() {
            ValKind::I32 | ValKind::F32 => place.cast::<u32>().read_unaligned().into(),
            ValKind::V128 => place.cast::<u128>().read_unaligned(),
            _ => place.cast::<u64>().read_unaligned().into(),
        }
    }
}

/// # Safety
/// `place` is valid for a write of that size.
#[inline]
pub(crate) unsafe fn write(place: *mut u8, ty: ValType, value: Bits) {
    // SAFETY: the caller's.
    unsafe {
        match ty.kind() {
            ValKind::I32 | ValKind::F32 => {
                place.cast::<u64>().write_unaligned((value as u32).into());
            }
            ValKind::V128 => place.cast::<u128>().write_unaligned(value),
            _ => place.cast::<u64>().write_unaligned(value as u64),
        }
    }
}
