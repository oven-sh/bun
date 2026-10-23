//! Mach-O type definitions needed by `macho.rs`. All structs are `#[repr(C)]`
//! POD matching the on-disk Mach-O format so they can be read/written via
//! unaligned `ptr::{read,write}_unaligned`.
//!
//! `LoadCommandIterator` deliberately stores a raw `*const u8` rather than a
//! borrowed `&'a [u8]`: macho.rs interleaves iterator reads with in-place
//! mutation of the same backing `Vec<u8>`. Holding a Rust borrow across that
//! mutation would force a structural rewrite; raw pointers avoid that.
//! SAFETY contract: callers must not reallocate or shrink the backing buffer
//! while a `LoadCommandIterator` derived from it is live.

#![allow(non_snake_case)]

// Canonical `<mach-o/loader.h>` POD layouts live in `bun_sys::macho` (lower-tier
// crate, also consumed by `crash_handler`). Re-export so `exe_format::macho`
// keeps its existing `macho::segment_command_64` etc. paths.
pub use bun_sys::macho::{
    cpu_subtype_t, cpu_type_t, load_command, mach_header_64, segment_command_64, vm_prot_t,
};

pub(crate) const CPU_TYPE_ARM64: cpu_type_t = 0x0100_000C;
pub(crate) const MH_MAGIC_64: u32 = 0xfeed_facf;
pub(crate) const MH_EXECUTE: u32 = 0x2;
pub(crate) const CPU_TYPE_X86_64: cpu_type_t = 0x0100_0007;

pub(crate) const SG_READ_ONLY: u32 = 0x10;

pub(crate) const S_REGULAR: u32 = 0x0;
pub(crate) const SECTION_TYPE: u32 = 0x0000_00ff;
pub(crate) const S_ZEROFILL: u32 = 0x1;
pub(crate) const S_CSTRING_LITERALS: u32 = 0x2;
pub(crate) const S_4BYTE_LITERALS: u32 = 0x3;
pub(crate) const S_8BYTE_LITERALS: u32 = 0x4;
pub(crate) const S_GB_ZEROFILL: u32 = 0xc;
pub(crate) const S_16BYTE_LITERALS: u32 = 0xe;
pub(crate) const S_THREAD_LOCAL_ZEROFILL: u32 = 0x12;
pub(crate) const S_ATTR_NO_DEAD_STRIP: u32 = 0x1000_0000;
pub(crate) const S_ATTR_SOME_INSTRUCTIONS: u32 = 0x400;
pub(crate) const N_SECT: u8 = 0x0e;
pub(crate) const N_STAB: u8 = 0xe0;
pub(crate) const N_TYPE: u8 = 0x0e;
pub(crate) const INDIRECT_SYMBOL_LOCAL_OR_ABS: u32 = 0xc000_0000;

pub(crate) const LC_REQ_DYLD: u32 = 0x8000_0000;

/// On-disk load commands
/// can carry arbitrary tag values, so model them as bare `u32` constants instead
/// of a Rust `enum` (which would make `read_unaligned` of unknown discriminants
/// instant UB).
pub mod LC {
    use super::LC_REQ_DYLD;
    pub use bun_sys::macho::LC_SEGMENT_64 as SEGMENT_64;
    pub(crate) const SYMTAB: u32 = 0x2;
    pub(crate) const DYSYMTAB: u32 = 0xb;
    pub(crate) const CODE_SIGNATURE: u32 = 0x1d;
    pub(crate) const FUNCTION_STARTS: u32 = 0x26;
    pub(crate) const DATA_IN_CODE: u32 = 0x29;
    pub(crate) const DYLIB_CODE_SIGN_DRS: u32 = 0x2B;
    pub(crate) const LINKER_OPTIMIZATION_HINT: u32 = 0x2E;
    pub(crate) const DYLD_INFO: u32 = 0x22;
    pub(crate) const DYLD_INFO_ONLY: u32 = 0x22 | LC_REQ_DYLD;
    pub(crate) const DYLD_EXPORTS_TRIE: u32 = 0x33 | LC_REQ_DYLD;
    pub(crate) const DYLD_CHAINED_FIXUPS: u32 = 0x34 | LC_REQ_DYLD;
    pub(crate) const LOAD_DYLIB: u32 = 0xc;
    pub(crate) const LOAD_DYLINKER: u32 = 0xe;
    pub(crate) const UUID: u32 = 0x1b;
    pub(crate) const SEGMENT_SPLIT_INFO: u32 = 0x1e;
    pub(crate) const VERSION_MIN_MACOSX: u32 = 0x24;
    pub(crate) const DYLD_ENVIRONMENT: u32 = 0x27;
    pub(crate) const SOURCE_VERSION: u32 = 0x2a;
    pub(crate) const BUILD_VERSION: u32 = 0x32;
    pub(crate) const ATOM_INFO: u32 = 0x36;
    pub(crate) const LOAD_WEAK_DYLIB: u32 = 0x18 | LC_REQ_DYLD;
    pub(crate) const RPATH: u32 = 0x1c | LC_REQ_DYLD;
    pub(crate) const MAIN: u32 = 0x28 | LC_REQ_DYLD;
}

pub(crate) enum CommandKind {
    Segment,
    SymbolTable,
    DynamicSymbolTable,
    LinkeditData,
    DyldInfo,
    NoFileOffsets,
    Unknown,
}

pub(crate) fn command_kind(cmd: u32) -> CommandKind {
    match cmd {
        LC::SEGMENT_64 => CommandKind::Segment,
        LC::SYMTAB => CommandKind::SymbolTable,
        LC::DYSYMTAB => CommandKind::DynamicSymbolTable,
        LC::CODE_SIGNATURE
        | LC::SEGMENT_SPLIT_INFO
        | LC::FUNCTION_STARTS
        | LC::DATA_IN_CODE
        | LC::DYLIB_CODE_SIGN_DRS
        | LC::LINKER_OPTIMIZATION_HINT
        | LC::DYLD_EXPORTS_TRIE
        | LC::DYLD_CHAINED_FIXUPS
        | LC::ATOM_INFO => CommandKind::LinkeditData,
        LC::DYLD_INFO | LC::DYLD_INFO_ONLY => CommandKind::DyldInfo,
        LC::UUID
        | LC::LOAD_DYLINKER
        | LC::LOAD_DYLIB
        | LC::LOAD_WEAK_DYLIB
        | LC::RPATH
        | LC::MAIN
        | LC::BUILD_VERSION
        | LC::VERSION_MIN_MACOSX
        | LC::SOURCE_VERSION
        | LC::DYLD_ENVIRONMENT => CommandKind::NoFileOffsets,
        _ => CommandKind::Unknown,
    }
}

pub(crate) mod PROT {
    use super::vm_prot_t;
    pub(crate) const READ: vm_prot_t = 0x01;
    pub(crate) const WRITE: vm_prot_t = 0x02;
    pub(crate) const EXECUTE: vm_prot_t = 0x04;
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct section_64 {
    pub(crate) sectname: [u8; 16],
    pub(crate) segname: [u8; 16],
    pub(crate) addr: u64,
    pub(crate) size: u64,
    pub(crate) offset: u32,
    pub(crate) align: u32,
    pub(crate) reloff: u32,
    pub(crate) nreloc: u32,
    pub(crate) flags: u32,
    pub(crate) reserved1: u32,
    pub(crate) reserved2: u32,
    pub(crate) reserved3: u32,
}
impl section_64 {
    #[inline]
    pub(crate) fn sect_name(&self) -> &[u8] {
        parse_name(&self.sectname)
    }
    #[inline]
    pub(crate) fn seg_name(&self) -> &[u8] {
        parse_name(&self.segname)
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct linkedit_data_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub dataoff: u32,
    pub datasize: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct symtab_command {
    pub cmd: u32,
    pub cmdsize: u32,
    pub symoff: u32,
    pub nsyms: u32,
    pub stroff: u32,
    pub strsize: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct dysymtab_command {
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
pub(crate) struct dyld_info_command {
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

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct nlist_64 {
    pub n_strx: u32,
    pub n_type: u8,
    pub n_sect: u8,
    pub n_desc: u16,
    pub n_value: u64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct dyld_chained_fixups_header {
    pub fixups_version: u32,
    pub starts_offset: u32,
    pub imports_offset: u32,
    pub symbols_offset: u32,
    pub imports_count: u32,
    pub imports_format: u32,
    pub symbols_format: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct dyld_chained_starts_in_segment {
    pub size: u32,
    pub page_size: u16,
    pub pointer_format: u16,
    pub segment_offset: u64,
    pub max_valid_pointer: u32,
    pub page_count: u16,
    pub first_page_start: u16,
}

pub(crate) const DYLD_CHAINED_PTR_START_NONE: u16 = 0xffff;
pub(crate) const DYLD_CHAINED_PTR_START_MULTI: u16 = 0x8000;

// ── code-signing blobs ────────────────────────────────────────────────────

/// Tailored at version 0x20400.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct CodeDirectory {
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
pub(crate) struct BlobIndex {
    pub type_: u32,
    pub offset: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct SuperBlob {
    pub(crate) magic: u32,
    pub(crate) length: u32,
    pub(crate) count: u32,
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
