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

use crate::image::KnownSection;
use crate::read_struct;
use crate::section::{SectionError, find_known_section};

const MAGIC: &[u8; 8] = b"BUNBLTNS";
const FORMAT_VERSION: u32 = 2;
pub const HEADER_SIZE: usize = 48;
const RECORD_SIZE: usize = 6 * 4;

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
    /// The sources were built for a different JavaScriptCore version or set of private names than this bun's.
    #[error("BuiltinsEngineMismatch")]
    EngineMismatch,
}

impl From<SectionError> for BuiltinsError {
    fn from(error: SectionError) -> BuiltinsError {
        match error {
            SectionError::UnrecognizedExecutable => BuiltinsError::UnrecognizedExecutable,
            SectionError::MissingSection => BuiltinsError::MissingSection,
            SectionError::Invalid => BuiltinsError::Invalid,
        }
    }
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
    /// Identifies the JavaScriptCore version and private names of the bun that wrote the section (`engineStamp`).
    engine_stamp: Option<core::num::NonZeroU32>,
    count: u32,
    records: &'a [u8],
    dep_offsets: &'a [u8],
    deps: &'a [u8],
    data: &'a [u8],
}

impl<'a> Builtins<'a> {
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
        let engine_stamp = core::num::NonZeroU32::new(field(8));

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
            engine_stamp,
            count,
            records,
            dep_offsets,
            deps,
            data,
        })
    }

    /// Returns `self` if the bun that owns the `host` section can compile these sources.
    pub fn require_same_engine(self, host: &Builtins<'_>) -> Result<Self, BuiltinsError> {
        if self.engine_stamp.is_some() && self.engine_stamp == host.engine_stamp {
            Ok(self)
        } else {
            Err(BuiltinsError::EngineMismatch)
        }
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
}

pub(crate) fn u32_at(bytes: &[u8], offset: usize) -> u32 {
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

pub struct Image<'a> {
    pub len: usize,
    pub read: &'a mut dyn FnMut(usize, &mut [u8]) -> bool,
}

impl Image<'_> {
    pub(crate) fn range(&self, offset: usize, len: usize) -> Result<(usize, usize), SectionError> {
        offset
            .checked_add(len)
            .filter(|&end| end <= self.len)
            .map(|_| (offset, len))
            .ok_or(SectionError::Invalid)
    }

    pub(crate) fn bytes(&mut self, offset: usize, len: usize) -> Result<Vec<u8>, SectionError> {
        self.range(offset, len)?;
        let mut bytes = vec![0; len];
        if (self.read)(offset, &mut bytes) {
            Ok(bytes)
        } else {
            Err(SectionError::Invalid)
        }
    }

    pub(crate) fn struct_at<T: Copy>(&mut self, offset: usize) -> Result<T, SectionError> {
        Ok(read_struct(&self.bytes(offset, size_of::<T>())?))
    }
}

/// Where the builtins section lies in an executable image of any of the three formats bun ships as: its offset and its length.
pub fn find_section(file: &mut Image<'_>) -> Result<(usize, usize), BuiltinsError> {
    let location = find_known_section(file, KnownSection::BuiltinModules)?;
    Ok((
        usize::try_from(location.file_offset).map_err(|_| BuiltinsError::Invalid)?,
        usize::try_from(location.size).map_err(|_| BuiltinsError::Invalid)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elf_ranges::tests::toy_elf;
    use crate::image::{Architecture, read_bytes_at};
    use crate::macho_ranges::tests::toy_macho;
    use crate::pe_ranges::tests::toy_pe;

    fn find_in_bytes(bytes: &[u8]) -> Result<(usize, usize), BuiltinsError> {
        let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(bytes, offset, out);
        find_section(&mut Image {
            len: bytes.len(),
            read: &mut read,
        })
    }

    #[test]
    fn find_section_returns_builtin_modules_location() {
        for architecture in [Architecture::X86_64, Architecture::Aarch64] {
            let files = [
                toy_elf(architecture, true),
                toy_macho(architecture),
                toy_pe(architecture),
            ];
            for bytes in files {
                let mut read = |offset: usize, out: &mut [u8]| read_bytes_at(&bytes, offset, out);
                let mut file = Image {
                    len: bytes.len(),
                    read: &mut read,
                };
                let location = find_known_section(&mut file, KnownSection::BuiltinModules).unwrap();
                assert!(location.size > 0);
                assert_eq!(
                    find_in_bytes(&bytes),
                    Ok((location.file_offset as usize, location.size as usize))
                );
            }
        }
    }

    #[test]
    fn find_section_converts_section_errors() {
        assert_eq!(
            find_in_bytes(b"#!/bin/sh\n"),
            Err(BuiltinsError::UnrecognizedExecutable)
        );
        assert_eq!(find_in_bytes(b"MZ"), Err(BuiltinsError::Invalid));

        let mut without_sections = toy_pe(Architecture::X86_64);
        let pe_header_offset = u32_at(&without_sections, 0x3c) as usize;
        without_sections[pe_header_offset + 6..][..2].fill(0);
        assert_eq!(
            find_in_bytes(&without_sections),
            Err(BuiltinsError::MissingSection)
        );
    }
}
