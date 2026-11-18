//! Arrays that string builtins read and write.

use core::cell::Cell;
use core::slice;

use bun_engine_wasm_compiler::abi::object;
use bun_engine_wasm_format::StorageType;

use crate::value::Reference;

/// The elements. `None` for null.
///
/// # Safety
/// `array` is null or an `(array (mut i16))` that lives for `'a`.
#[inline]
pub unsafe fn char_codes<'a>(array: Reference) -> Option<&'a [Cell<u16>]> {
    let array = array.cell()?;
    // SAFETY: the caller's. The length does not change.
    unsafe {
        let length = array.field::<u32>(object::LENGTH).read();
        let first = array.field(object::elements(StorageType::I16));
        Some(slice::from_raw_parts(first, length as usize))
    }
}
