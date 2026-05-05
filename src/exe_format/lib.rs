#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): Phase-A draft bodies preserved below; gated until deps resolve:
//   - thiserror (not in workspace deps)
//   - bun_output::declare_scope!/scoped_log! (crate not linked)
//   - bun_sha::SHA256 (crate not linked)
//   - bun_str::strings (crate not linked; bun_string exists but no `strings` mod)
//   - bun_core::env_var (gated out in bun_core)
//   - crate::macho_types (module does not exist yet)
#[cfg(any())]
pub mod elf;
#[cfg(any())]
pub mod macho;
#[cfg(any())]
pub mod pe;

// --- minimal stub surface (un-gate in B-2) -----------------------------------

#[cfg(not(any()))]
pub mod elf {
    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub enum ElfError {
        InvalidElfFile,
        Not64Bit,
        NotLittleEndian,
        BunSectionNotFound,
        NoWritableLoadSegment,
        NewVaddrCollides,
    }
    pub struct ElfFile(());
    pub struct Elf64_Ehdr(());
    pub struct Elf64_Phdr(());
    pub struct Elf64_Shdr(());
}

#[cfg(not(any()))]
pub mod macho {
    pub const SEGNAME_BUN: [u8; 16] = *b"__BUN\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
    pub const SECTNAME: [u8; 16] = *b"__bun\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";
    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub enum MachoError {
        InvalidObject,
        MissingLinkeditSegment,
        OffsetOutOfRange,
        OffsetOverflow,
        InvalidLinkeditOffset,
        OverlappingSegments,
        MissingRequiredSegment,
        OutOfMemory,
    }
    pub struct MachoFile(());
    pub struct MachoSigner(());
    pub mod utils {}
}

#[cfg(not(any()))]
pub mod pe {
    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub enum Error {
        OutOfBounds,
        // TODO(b1): remaining variants from pe.rs Phase-A draft
    }
    #[derive(Debug, Copy, Clone, PartialEq, Eq)]
    pub enum StripMode {
        None,
    }
    pub struct StripOpts(());
    pub struct PEFile(());
    pub struct DOSHeader(());
    pub struct PEHeader(());
    pub struct OptionalHeader64(());
    pub struct DataDirectory(());
    pub struct SectionHeader(());
    pub mod utils {}
    pub const BUN_COMPILED_SECTION_NAME: &str = ".bun";
}
