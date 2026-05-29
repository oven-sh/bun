#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod elf;
pub mod macho;
pub mod macho_types;
pub mod pe;

#[inline]
pub(crate) fn read_struct<T: Copy>(bytes: &[u8]) -> T {
    debug_assert!(bytes.len() >= core::mem::size_of::<T>());
    // SAFETY: T is a #[repr(C)] POD header struct; all bit patterns are valid;
    // bytes.len() >= size_of::<T>() asserted above. read_unaligned tolerates
    // arbitrary alignment of the source slice.
    unsafe { core::ptr::read_unaligned(bytes.as_ptr().cast::<T>()) }
}

/// Write a `#[repr(C)]` POD struct `T` to the start of `bytes`. See
/// [`read_struct`] for the contract on `T` and slice length.
#[inline]
pub(crate) fn write_struct<T: Copy>(bytes: &mut [u8], value: &T) {
    debug_assert!(bytes.len() >= core::mem::size_of::<T>());
    // SAFETY: T is #[repr(C)] POD; bytes.len() >= size_of::<T>() asserted
    // above; write_unaligned tolerates arbitrary alignment of dest.
    unsafe { core::ptr::write_unaligned(bytes.as_mut_ptr().cast::<T>(), *value) }
}

pub(crate) fn align_up(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    let over = value % alignment;
    if over == 0 {
        value
    } else {
        value + (alignment - over)
    }
}
