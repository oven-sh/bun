#![warn(unused_must_use)]
pub mod build_id;
pub mod builtins;
mod cut_choice;
pub mod cut_model;
pub mod elf;
pub mod elf_payload;
pub mod elf_program_headers;
pub mod elf_ranges;
mod elf_relocations;
pub mod elf_symbols;
pub mod error;
pub mod executable_memory_filter;
pub mod identity;
pub mod image;
pub mod macho;
pub mod macho_fixups;
pub mod macho_ranges;
pub mod macho_symbols;
pub mod macho_types;
pub mod mapped_file;
pub mod pe;
pub mod pe_ranges;
pub mod section;

pub use error::{Error, Result};

#[cfg(test)]
use bun_sema_standalone as _;

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
