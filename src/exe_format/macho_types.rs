//! Port of the subset of Zig `std.macho` (vendor/zig/lib/std/macho.zig) needed
//! by `macho.rs`. All structs are `#[repr(C)]` POD matching the on-disk Mach-O
//! format so they can be read/written via unaligned `ptr::{read,write}_unaligned`
//! exactly like Zig's `*align(1) const T` casts.
//!
//! `LoadCommandIterator` deliberately stores a raw `*const u8` rather than a
//! borrowed `&'a [u8]`: macho.rs interleaves iterator reads with in-place
//! mutation of the same backing `Vec<u8>` (matching the Zig original, which
//! has no borrow checker). Holding a Rust borrow across that mutation would
//! force a structural rewrite; raw pointers preserve the Zig semantics.
//! SAFETY contract: callers must not reallocate or shrink the backing buffer
//! while a `LoadCommandIterator` derived from it is live.

#![allow(non_camel_case_types, non_snake_case)]

// Canonical `<mach-o/loader.h>` POD layouts live in `bun_sys::macho` (lower-tier
// crate, also consumed by `crash_handler`). Re-export so `exe_format::macho`
// keeps its existing `macho::segment_command_64` etc. paths.
pub use bun_sys::macho::{
    cpu_subtype_t, cpu_type_t, load_command, mach_header_64, segment_command_64, vm_prot_t,
};

pub const MH_MAGIC_64: u32 = 0xfeed_facf;
pub const CPU_TYPE_ARM64: cpu_type_t = 0x0100_000C;

pub const S_REGULAR: u32 = 0x0;
pub const S_ATTR_NO_DEAD_STRIP: u32 = 0x1000_0000;

pub const LC_REQ_DYLD: u32 = 0x8000_0000;

/// Zig `std.macho.LC` is a non-exhaustive `enum(u32)`. On-disk load commands
/// can carry arbitrary tag values, so model it as bare `u32` constants instead
/// of a Rust `enum` (which would make `read_unaligned` of unknown discriminants
/// instant UB).
pub mod LC {
    use super::LC_REQ_DYLD;
    pub use bun_sys::macho::LC_SEGMENT_64 as SEGMENT_64;
    pub const SYMTAB: u32 = 0x2;
    pub const DYSYMTAB: u32 = 0xb;
    pub const CODE_SIGNATURE: u32 = 0x1d;
    pub const FUNCTION_STARTS: u32 = 0x26;
    pub const DATA_IN_CODE: u32 = 0x29;
    pub const DYLIB_CODE_SIGN_DRS: u32 = 0x2B;
    pub const LINKER_OPTIMIZATION_HINT: u32 = 0x2E;
    pub const DYLD_INFO: u32 = 0x22;
    pub const DYLD_INFO_ONLY: u32 = 0x22 | LC_REQ_DYLD;
    pub const DYLD_EXPORTS_TRIE: u32 = 0x33 | LC_REQ_DYLD;
    pub const DYLD_CHAINED_FIXUPS: u32 = 0x34 | LC_REQ_DYLD;
}

pub mod PROT {
    use super::vm_prot_t;
    pub const NONE: vm_prot_t = 0x00;
    pub const READ: vm_prot_t = 0x01;
    pub const WRITE: vm_prot_t = 0x02;
    pub const EXEC: vm_prot_t = 0x04;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct section_64 {
    pub sectname: [u8; 16],
    pub segname: [u8; 16],
    pub addr: u64,
    pub size: u64,
    pub offset: u32,
    pub align: u32,
    pub reloff: u32,
    pub nreloc: u32,
    pub flags: u32,
    pub reserved1: u32,
    pub reserved2: u32,
    pub reserved3: u32,
}
impl section_64 {
    #[inline]
    pub fn sect_name(&self) -> &[u8] {
        parse_name(&self.sectname)
    }
    #[inline]
    pub fn seg_name(&self) -> &[u8] {
        parse_name(&self.segname)
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct linkedit_data_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub dataoff: u32,
    pub datasize: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct symtab_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub symoff: u32,
    pub nsyms: u32,
    pub stroff: u32,
    pub strsize: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct dysymtab_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub ilocalsym: u32,
    pub nlocalsym: u32,
    pub iextdefsym: u32,
    pub nextdefsym: u32,
    pub iundefsym: u32,
    pub nundefsym: u32,
    pub tocoff: u32,
    pub ntoc: u32,
    pub modtaboff: u32,
    pub nmodtab: u32,
    pub extrefsymoff: u32,
    pub nextrefsyms: u32,
    pub indirectsymoff: u32,
    pub nindirectsyms: u32,
    pub extreloff: u32,
    pub nextrel: u32,
    pub locreloff: u32,
    pub nlocrel: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct dyld_info_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub rebase_off: u32,
    pub rebase_size: u32,
    pub bind_off: u32,
    pub bind_size: u32,
    pub weak_bind_off: u32,
    pub weak_bind_size: u32,
    pub lazy_bind_off: u32,
    pub lazy_bind_size: u32,
    pub export_off: u32,
    pub export_size: u32,
}

// ── code-signing blobs ────────────────────────────────────────────────────

/// Tailored at version 0x20400 (matches Zig's std.macho.CodeDirectory).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CodeDirectory {
    pub magic: u32,
    pub length: u32,
    pub version: u32,
    pub flags: u32,
    pub hash_offset: u32,
    pub ident_offset: u32,
    pub n_special_slots: u32,
    pub n_code_slots: u32,
    pub code_limit: u32,
    pub hash_size: u8,
    pub hash_type: u8,
    pub platform: u8,
    pub page_size: u8,
    pub spare2: u32,
    pub scatter_offset: u32,
    pub team_offset: u32,
    pub spare3: u32,
    pub code_limit_64: u64,
    pub exec_seg_base: u64,
    pub exec_seg_limit: u64,
    pub exec_seg_flags: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct BlobIndex {
    pub type_: u32,
    pub offset: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct SuperBlob {
    pub magic: u32,
    pub length: u32,
    pub count: u32,
}

// SAFETY: `CodeDirectory` is `#[repr(C)]` with 9×u32, 4×u8, 4×u32, 4×u64 in
// that order → offsets 0..36, 36..40, 40..56, 56..88. Every field boundary is
// naturally aligned with no inserted padding; size 88, align 8. `Copy + 'static`,
// no interior mutability, every byte initialized.
unsafe impl bytemuck::NoUninit for CodeDirectory {}
// SAFETY: `#[repr(C)]` 2×u32 → size 8, align 4, no padding. `Copy + 'static`.
unsafe impl bytemuck::NoUninit for BlobIndex {}
// SAFETY: `#[repr(C)]` 3×u32 → size 12, align 4, no padding. `Copy + 'static`.
unsafe impl bytemuck::NoUninit for SuperBlob {}

// ── load-command iterator ─────────────────────────────────────────────────
// Canonical impl lives in `bun_sys::macho` (raw-ptr storage; see module-level
// SAFETY note above for why a borrowed `&[u8]` does not work for `macho.rs`).
pub use bun_sys::macho::{LoadCommand, LoadCommandIterator, RawSlice};

#[inline]
fn parse_name(name: &[u8; 16]) -> &[u8] {
    bun_core::slice_to_nul(name)
}
