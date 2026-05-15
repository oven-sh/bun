#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
#![warn(unreachable_pub)]
pub mod elf;
pub mod macho;
pub mod macho_types;
pub mod pe;

// --- byte helpers (Zig std.mem.bytesAsValue / asBytes) ---
//
// Shared by `elf.rs` and `macho.rs` for unaligned in-place read/modify/write of
// `#[repr(C)]` POD header structs (Elf64_*, mach-o load commands) that live at
// arbitrary byte offsets inside a `Vec<u8>` image. Centralising the two
// `unsafe` blocks here keeps the per-format files free of open-coded
// `ptr::read_unaligned` / `ptr::write_unaligned`.

/// Read a `#[repr(C)]` POD struct `T` from the start of `bytes`.
///
/// `T` must be valid for every bit pattern (no `NonZero`/`NonNull`/`bool` etc.
/// fields). The slice must be at least `size_of::<T>()` bytes long; callers
/// pass `&buf[off..][..size_of::<T>()]` so release builds get a bounds check
/// at the slice site rather than UB on a short buffer.
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
