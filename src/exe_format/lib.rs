#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
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

/// Executable container format sniffed from a binary's first bytes.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DetectedFormat {
    Elf,
    MachO,
    Pe,
}

impl DetectedFormat {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Elf => "ELF",
            Self::MachO => "Mach-O",
            Self::Pe => "PE",
        }
    }
}

/// Machine architecture sniffed from an executable header.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum DetectedArch {
    X64,
    Arm64,
    /// Machine type value this crate doesn't map (e.g. ppc64, riscv).
    Other(u32),
}

impl DetectedArch {
    pub const fn name(self) -> &'static str {
        match self {
            Self::X64 => "x64",
            Self::Arm64 => "arm64",
            Self::Other(_) => "unknown",
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub struct DetectedHeader {
    pub format: DetectedFormat,
    pub arch: DetectedArch,
}

/// Sniff the container format and machine architecture from an executable's
/// header. Returns `None` if `data` is not a recognized 64-bit little-endian
/// ELF, Mach-O, or PE image.
///
/// Used by `bun build --compile` to reject a cached cross-compile base binary
/// whose on-disk header disagrees with the requested `--target` (e.g. an x64
/// ELF planted under an arm64 cache key).
///
/// `data` only needs to cover the fixed header; 256 bytes is sufficient for
/// ELF/Mach-O, and for PE the caller should pass at least
/// `e_lfanew + sizeof(PEHeader)` bytes (in practice the full file).
pub fn detect_header(data: &[u8]) -> Option<DetectedHeader> {
    // ELF: e_machine is a u16 at offset 18.
    if data.len() >= 20 && &data[0..4] == b"\x7fELF" {
        // EI_CLASS == ELFCLASS64 && EI_DATA == ELFDATA2LSB
        if data[4] != 2 || data[5] != 1 {
            return None;
        }
        let e_machine = u16::from_le_bytes([data[18], data[19]]);
        let arch = match e_machine {
            elf::EM_X86_64 => DetectedArch::X64,
            elf::EM_AARCH64 => DetectedArch::Arm64,
            other => DetectedArch::Other(other as u32),
        };
        return Some(DetectedHeader {
            format: DetectedFormat::Elf,
            arch,
        });
    }

    // Mach-O 64-bit: magic at 0, cputype (i32) at 4.
    if data.len() >= 8 {
        let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        if magic == macho_types::MH_MAGIC_64 {
            let cputype = i32::from_le_bytes([data[4], data[5], data[6], data[7]]);
            let arch = match cputype {
                macho_types::CPU_TYPE_X86_64 => DetectedArch::X64,
                macho_types::CPU_TYPE_ARM64 => DetectedArch::Arm64,
                other => DetectedArch::Other(other as u32),
            };
            return Some(DetectedHeader {
                format: DetectedFormat::MachO,
                arch,
            });
        }
    }

    // PE: "MZ" at 0, e_lfanew (u32) at 0x3c points to "PE\0\0" followed by COFF
    // header whose first u16 is Machine.
    if data.len() >= 0x40 && &data[0..2] == b"MZ" {
        let e_lfanew =
            u32::from_le_bytes([data[0x3c], data[0x3d], data[0x3e], data[0x3f]]) as usize;
        if let Some(coff) = data.get(e_lfanew..e_lfanew.checked_add(6)?) {
            if &coff[0..4] == b"PE\0\0" {
                let machine = u16::from_le_bytes([coff[4], coff[5]]);
                let arch = match machine {
                    pe::IMAGE_FILE_MACHINE_AMD64 => DetectedArch::X64,
                    pe::IMAGE_FILE_MACHINE_ARM64 => DetectedArch::Arm64,
                    other => DetectedArch::Other(other as u32),
                };
                return Some(DetectedHeader {
                    format: DetectedFormat::Pe,
                    arch,
                });
            }
        }
    }

    None
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
