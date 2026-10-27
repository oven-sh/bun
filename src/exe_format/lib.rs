#![warn(unused_must_use)]
pub mod builtins;
pub mod elf;
pub mod error;
pub mod macho;
pub mod macho_types;
pub mod pe;

pub use error::{Error, Result};

// --- byte helpers ---
//
// Shared by `elf.rs` and `macho.rs` for unaligned in-place read/modify/write of
// `#[repr(C)]` POD header structs (Elf64_*, mach-o load commands) that live at
// arbitrary byte offsets inside a `Vec<u8>` image.

/// Read a `T` from the start of `bytes`. Panics if `bytes` is shorter.
#[inline]
pub(crate) fn read_struct<T: bun_core::AnyBitPattern>(bytes: &[u8]) -> T {
    bun_core::read_prefix(bytes).expect("read_struct: short slice")
}

/// Write `value` to the start of `bytes`. Panics if `bytes` is shorter.
#[inline]
pub(crate) fn write_struct<T: bun_core::NoUninit>(bytes: &mut [u8], value: &T) {
    bytes[..core::mem::size_of::<T>()].copy_from_slice(bun_core::bytes_of(value));
}

/// Round `value` up to the next multiple of `alignment`.
///
/// Handles `alignment == 0` (returns `value` unchanged) and non-power-of-two
/// alignments. Shared by the ELF and Mach-O writers; the PE writer keeps its
/// own fallible u32/usize variants because it must validate untrusted header
/// fields and surface `BadAlignment`/`Overflow` as `pe::Error`.
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
