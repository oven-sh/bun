//! Read-only view of a bun executable's builtin JS module sources: the
//! `__TEXT,__bun_builtins` / `.bun_builtins` / `.bunblt` section written by
//! src/codegen/bundle-modules.ts (InternalModuleRegistryConstants.S).
//!
//! `bun build --compile --bytecode --target=<other platform>` uses this to
//! generate bytecode for the *target* executable's internal modules (their
//! sources differ per platform), so it has to work on an ELF, Mach-O or PE
//! file from any host — no dlopen. Everything is bounds-checked up front in
//! [`Builtins::parse`]; the accessors cannot panic on a validated view.

use core::mem::size_of;

use bun_core::slice_to_nul;

use crate::elf::{Elf64_Ehdr, Elf64_Shdr};
use crate::macho_types as macho;
use crate::pe::{DOSHeader, PEHeader, SectionHeader};
use crate::read_struct;

const MAGIC: &[u8; 8] = b"BUNBLTNS";
const FORMAT_VERSION: u32 = 1;
const HEADER_SIZE: usize = 48;
const RECORD_SIZE: usize = 6 * 4;

const MH_MAGIC_64: u32 = 0xfeed_facf;
const MACHO_SECTNAME: &[u8] = b"__bun_builtins";
const ELF_SECTION_NAME: &[u8] = b".bun_builtins";
const PE_SECTION_NAME: [u8; 8] = *b".bunblt\0";

#[derive(Debug, thiserror::Error, strum::IntoStaticStr, PartialEq, Eq)]
pub enum BuiltinsError {
    /// Not an ELF, Mach-O or PE file we can read.
    #[error("UnrecognizedExecutable")]
    UnrecognizedExecutable,
    /// The executable has no builtins section (a bun older than this format).
    #[error("MissingBuiltinsSection")]
    MissingSection,
    /// The section is there but not in a layout this bun understands.
    #[error("InvalidBuiltinsSection")]
    Invalid,
    #[error("UnsupportedBuiltinsVersion")]
    UnsupportedVersion,
}

#[derive(Clone, Copy)]
pub struct Module<'a> {
    /// Registry specifier, e.g. `node:fs` or `internal:streams/readable`.
    pub name: &'a [u8],
    /// `builtin://node/fs`
    pub url: &'a [u8],
    /// Latin-1 module source as InternalModuleRegistry compiles it.
    pub source: &'a [u8],
}

/// A validated view over one executable's builtins section.
#[derive(Clone, Copy)]
pub struct Builtins<'a> {
    /// Identifies these sources to bytecode generated from them (JSC's `decodeBuiltinFunction` stamp).
    pub source_stamp: u32,
    count: u32,
    records: &'a [u8],
    dep_offsets: &'a [u8],
    deps: &'a [u8],
    data: &'a [u8],
}

impl<'a> Builtins<'a> {
    /// Locate and parse the builtins section of an ELF, Mach-O or PE executable image.
    pub fn from_executable(file: &'a [u8]) -> Result<Self, BuiltinsError> {
        Self::parse(find_section(file)?)
    }

    /// Parse a builtins section (header onward). Trailing bytes past the blob are ignored.
    pub fn parse(section: &'a [u8]) -> Result<Self, BuiltinsError> {
        use BuiltinsError::Invalid;
        if section.len() < HEADER_SIZE || &section[..8] != MAGIC {
            return Err(Invalid);
        }
        let field = |i: usize| u32_at(section, 8 + i * 4);
        if field(0) != FORMAT_VERSION {
            return Err(BuiltinsError::UnsupportedVersion);
        }
        let source_stamp = field(1);
        let count = field(2);
        let modules_offset = field(3) as usize;
        let dep_offsets_offset = field(4) as usize;
        let deps_offset = field(5) as usize;
        let data_offset = field(6) as usize;
        let data_len = field(7) as usize;

        let n = count as usize;
        let records = sub(
            section,
            modules_offset,
            n.checked_mul(RECORD_SIZE).ok_or(Invalid)?,
        )?;
        let dep_offsets = sub(section, dep_offsets_offset, (n + 1) * 2)?;
        let deps_len = u16_at(dep_offsets, n * 2) as usize;
        let deps = sub(section, deps_offset, deps_len * 2)?;
        let data = sub(section, data_offset, data_len)?;

        for i in 0..n {
            let r = &records[i * RECORD_SIZE..][..RECORD_SIZE];
            for k in 0..3 {
                sub(
                    data,
                    u32_at(r, k * 8) as usize,
                    u32_at(r, k * 8 + 4) as usize,
                )?;
            }
        }
        let mut prev = 0;
        for i in 0..=n {
            let off = u16_at(dep_offsets, i * 2) as usize;
            if off < prev || off > deps_len {
                return Err(Invalid);
            }
            prev = off;
        }
        for i in 0..deps_len {
            if u16_at(deps, i * 2) as u32 >= count {
                return Err(Invalid);
            }
        }

        Ok(Self {
            source_stamp,
            count,
            records,
            dep_offsets,
            deps,
            data,
        })
    }

    /// Number of JS internal modules; ids `0..len()` are InternalModuleRegistry field indices.
    pub fn len(&self) -> u32 {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub fn module(&self, id: u32) -> Option<Module<'a>> {
        if id >= self.count {
            return None;
        }
        let r = &self.records[id as usize * RECORD_SIZE..][..RECORD_SIZE];
        let span =
            |k: usize| &self.data[u32_at(r, k * 8) as usize..][..u32_at(r, k * 8 + 4) as usize];
        Some(Module {
            name: span(0),
            url: span(1),
            source: span(2),
        })
    }

    /// The id of the module whose registry specifier is exactly `name`.
    pub fn find(&self, name: &[u8]) -> Option<u32> {
        (0..self.count).find(|&id| self.module(id).is_some_and(|m| m.name == name))
    }

    /// The modules `id` can require: at evaluation or later, from a lazy `require()` inside one of its functions.
    pub fn dependencies(&self, id: u32) -> impl Iterator<Item = u32> + 'a {
        let (start, end) = if id < self.count {
            (
                u16_at(self.dep_offsets, id as usize * 2) as usize,
                u16_at(self.dep_offsets, id as usize * 2 + 2) as usize,
            )
        } else {
            (0, 0)
        };
        let deps = self.deps;
        (start..end).map(move |i| u16_at(deps, i * 2) as u32)
    }

    pub fn modules(&self) -> impl Iterator<Item = Module<'a>> + '_ {
        (0..self.count).filter_map(move |id| self.module(id))
    }
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap())
}

fn sub(bytes: &[u8], offset: usize, len: usize) -> Result<&[u8], BuiltinsError> {
    offset
        .checked_add(len)
        .and_then(|end| bytes.get(offset..end))
        .ok_or(BuiltinsError::Invalid)
}

fn struct_at<T: Copy>(bytes: &[u8], offset: usize) -> Result<T, BuiltinsError> {
    Ok(read_struct(sub(bytes, offset, size_of::<T>())?))
}

/// The bytes of the builtins section in an executable image of any of the three formats bun ships as.
pub fn find_section(file: &[u8]) -> Result<&[u8], BuiltinsError> {
    if file.starts_with(b"\x7fELF") {
        find_elf(file)
    } else if file.starts_with(&MH_MAGIC_64.to_le_bytes()) {
        find_macho(file)
    } else if file.starts_with(b"MZ") {
        find_pe(file)
    } else {
        Err(BuiltinsError::UnrecognizedExecutable)
    }
}

fn find_elf(file: &[u8]) -> Result<&[u8], BuiltinsError> {
    // EI_CLASS = ELFCLASS64, EI_DATA = ELFDATA2LSB: every target bun builds for.
    if file.len() < size_of::<Elf64_Ehdr>() || file[4] != 2 || file[5] != 1 {
        return Err(BuiltinsError::UnrecognizedExecutable);
    }
    let ehdr: Elf64_Ehdr = struct_at(file, 0)?;
    let shdr = |index: usize| -> Result<Elf64_Shdr, BuiltinsError> {
        let offset = (index * size_of::<Elf64_Shdr>())
            .checked_add(usize::try_from(ehdr.e_shoff).map_err(|_| BuiltinsError::Invalid)?)
            .ok_or(BuiltinsError::Invalid)?;
        struct_at(file, offset)
    };
    if ehdr.e_shstrndx >= ehdr.e_shnum {
        return Err(BuiltinsError::MissingSection);
    }
    let strtab_hdr = shdr(ehdr.e_shstrndx as usize)?;
    let strtab = sub(
        file,
        to_usize(strtab_hdr.sh_offset)?,
        to_usize(strtab_hdr.sh_size)?,
    )?;
    for i in 0..ehdr.e_shnum as usize {
        let s = shdr(i)?;
        let Some(name) = strtab.get(s.sh_name as usize..) else {
            continue;
        };
        if slice_to_nul(name) == ELF_SECTION_NAME {
            return sub(file, to_usize(s.sh_offset)?, to_usize(s.sh_size)?);
        }
    }
    Err(BuiltinsError::MissingSection)
}

fn find_macho(file: &[u8]) -> Result<&[u8], BuiltinsError> {
    let header: macho::mach_header_64 = struct_at(file, 0)?;
    let mut offset = size_of::<macho::mach_header_64>();
    for _ in 0..header.ncmds {
        let (cmd, cmdsize) = (
            u32_at(sub(file, offset, 8)?, 0),
            u32_at(sub(file, offset, 8)?, 4) as usize,
        );
        if cmdsize < 8 {
            return Err(BuiltinsError::Invalid);
        }
        if cmd == macho::LC::SEGMENT_64 {
            let seg: macho::segment_command_64 = struct_at(file, offset)?;
            let mut sect_offset = offset + size_of::<macho::segment_command_64>();
            for _ in 0..seg.nsects {
                if sect_offset + size_of::<macho::section_64>() > offset + cmdsize {
                    return Err(BuiltinsError::Invalid);
                }
                let sect: macho::section_64 = struct_at(file, sect_offset)?;
                if sect.sect_name() == MACHO_SECTNAME {
                    return sub(file, sect.offset as usize, to_usize(sect.size)?);
                }
                sect_offset += size_of::<macho::section_64>();
            }
        }
        offset = offset.checked_add(cmdsize).ok_or(BuiltinsError::Invalid)?;
    }
    Err(BuiltinsError::MissingSection)
}

fn find_pe(file: &[u8]) -> Result<&[u8], BuiltinsError> {
    let dos: DOSHeader = struct_at(file, 0)?;
    let pe_offset = dos.e_lfanew as usize;
    let pe: PEHeader = struct_at(file, pe_offset)?;
    if pe.signature != crate::pe::PE_SIGNATURE {
        return Err(BuiltinsError::UnrecognizedExecutable);
    }
    let mut offset = pe_offset
        .checked_add(size_of::<PEHeader>() + pe.size_of_optional_header as usize)
        .ok_or(BuiltinsError::Invalid)?;
    for _ in 0..pe.number_of_sections {
        let s: SectionHeader = struct_at(file, offset)?;
        if s.name == PE_SECTION_NAME {
            // virtual_size is the payload; size_of_raw_data is that rounded up to the file alignment.
            let len = if s.virtual_size != 0 {
                s.virtual_size.min(s.size_of_raw_data)
            } else {
                s.size_of_raw_data
            };
            return sub(file, s.pointer_to_raw_data as usize, len as usize);
        }
        offset += size_of::<SectionHeader>();
    }
    Err(BuiltinsError::MissingSection)
}

fn to_usize(v: u64) -> Result<usize, BuiltinsError> {
    usize::try_from(v).map_err(|_| BuiltinsError::Invalid)
}
