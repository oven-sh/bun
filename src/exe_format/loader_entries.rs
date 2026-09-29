//! The strings a shared library hands to the dynamic loader: where to search
//! (`DT_RPATH`, `DT_RUNPATH`, `LC_RPATH`), what to load (`DT_NEEDED`,
//! `LC_LOAD_DYLIB`, ...) and its own name.
//!
//! Read from a byte slice with no platform gate: `bun build --compile` reads a
//! library of any target on any host. Only what Bun can load is read: 64-bit
//! little-endian ELF and Mach-O, and every such image of a universal Mach-O
//! file. PE has no search path in the file.

use core::mem::size_of;

use bun_core::strings;

use crate::read_struct;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `DT_RPATH`, unsplit.
    ElfRpath,
    /// `DT_RUNPATH`, unsplit.
    ElfRunpath,
    /// `DT_NEEDED`.
    ElfNeeded,
    /// `DT_AUXILIARY`.
    ElfAuxiliary,
    /// `DT_FILTER`.
    ElfFilter,
    /// `DT_SONAME`.
    ElfSoname,
    /// One `LC_RPATH`.
    MachoRpath,
    /// `LC_LOAD_DYLIB` and its weak, re-export, lazy and upward forms.
    MachoDylib,
    /// `LC_ID_DYLIB`.
    MachoId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entry<'a> {
    pub kind: Kind,
    pub value: &'a [u8],
}

/// The file starts like an image Bun can load and then contradicts itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum Malformed {
    #[error("the program headers are outside the file")]
    ProgramHeaders,
    #[error("the dynamic section is outside the loaded file or has no DT_NULL")]
    Dynamic,
    #[error("the dynamic string table is missing or outside the loaded file")]
    StringTable,
    #[error("a dynamic string is outside the string table")]
    String,
    #[error("the load commands are outside the file")]
    LoadCommands,
    #[error("a load command string is outside its command")]
    LoadCommandString,
    #[error("an image of the universal file is outside the file")]
    FatImage,
}

/// Every loader entry of `bytes`, in file order. `Ok(None)`: `bytes` holds no
/// 64-bit little-endian ELF or Mach-O image.
pub fn read(bytes: &[u8]) -> Result<Option<Vec<Entry<'_>>>, Malformed> {
    let mut entries = Vec::new();
    let found = match elf::header(bytes) {
        Some(header) => {
            read_elf(bytes, header, &mut entries)?;
            true
        }
        None => macho::read(bytes, &mut entries)?,
    };
    Ok(found.then_some(entries))
}

fn slice_at(bytes: &[u8], offset: u64, len: u64) -> Option<&[u8]> {
    let start = usize::try_from(offset).ok()?;
    let end = start.checked_add(usize::try_from(len).ok()?)?;
    bytes.get(start..end)
}

/// ELF64 little-endian pieces, decoded from slices the caller already holds.
/// `read` passes slices of the whole file; `libc_check` (`bun_runtime`) passes
/// what its capped `pread`s returned.
pub mod elf {
    use super::*;
    use crate::elf::{Elf64_Ehdr, Elf64_Phdr};

    pub const PT_LOAD: u32 = 1;
    pub const PT_DYNAMIC: u32 = 2;

    pub const DT_NULL: i64 = 0;
    pub const DT_NEEDED: i64 = 1;
    pub const DT_STRTAB: i64 = 5;
    pub const DT_STRSZ: i64 = 10;
    pub const DT_SONAME: i64 = 14;
    pub const DT_RPATH: i64 = 15;
    pub const DT_RUNPATH: i64 = 29;
    pub const DT_AUXILIARY: i64 = 0x7fff_fffd;
    pub const DT_FILTER: i64 = 0x7fff_ffff;

    pub const EHDR_SIZE: usize = size_of::<Elf64_Ehdr>();
    pub const PHDR_SIZE: usize = size_of::<Elf64_Phdr>();
    /// `Elf64_Dyn`: `d_tag`, then `d_val`.
    pub const DYN_SIZE: usize = 16;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Header {
        pub phoff: u64,
        pub phentsize: u16,
        pub phnum: u16,
    }

    /// `None`: `bytes` does not start with a 64-bit little-endian ELF header.
    pub fn header(bytes: &[u8]) -> Option<Header> {
        let bytes = bytes.get(..EHDR_SIZE)?;
        if &bytes[0..4] != b"\x7fELF" || bytes[4] != 2 || bytes[5] != 1 {
            return None;
        }
        let ehdr: Elf64_Ehdr = read_struct(bytes);
        Some(Header {
            phoff: u64::from_le(ehdr.e_phoff),
            phentsize: u16::from_le(ehdr.e_phentsize),
            phnum: u16::from_le(ehdr.e_phnum),
        })
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct ProgramHeader {
        pub kind: u32,
        pub offset: u64,
        pub vaddr: u64,
        pub filesz: u64,
    }

    impl ProgramHeader {
        /// File offset of `vaddr`, when this is a `PT_LOAD` that maps it from
        /// the file.
        pub fn offset_of(&self, vaddr: u64) -> Option<u64> {
            let skip = vaddr.checked_sub(self.vaddr)?;
            if self.kind != PT_LOAD || skip >= self.filesz {
                return None;
            }
            self.offset.checked_add(skip)
        }
    }

    /// The whole entries of `table`, `stride` bytes apart (`e_phentsize`, at
    /// least `PHDR_SIZE`).
    pub fn program_headers(table: &[u8], stride: usize) -> impl Iterator<Item = ProgramHeader> {
        table
            .chunks_exact(stride.max(PHDR_SIZE))
            .map(|chunk| -> ProgramHeader {
                let phdr: Elf64_Phdr = read_struct(&chunk[..PHDR_SIZE]);
                ProgramHeader {
                    kind: u32::from_le(phdr.p_type),
                    offset: u64::from_le(phdr.p_offset),
                    vaddr: u64::from_le(phdr.p_vaddr),
                    filesz: u64::from_le(phdr.p_filesz),
                }
            })
    }

    /// `(d_tag, d_val)` of every entry before `DT_NULL` or the end of `dynamic`.
    pub fn dynamic_entries(dynamic: &[u8]) -> impl Iterator<Item = (i64, u64)> {
        dynamic
            .as_chunks::<DYN_SIZE>()
            .0
            .iter()
            .map(|chunk| {
                let (tag, val) = chunk.split_at(8);
                (
                    i64::from_le_bytes(tag.try_into().unwrap()),
                    u64::from_le_bytes(val.try_into().unwrap()),
                )
            })
            .take_while(|&(tag, _)| tag != DT_NULL)
    }

    /// The string at `offset` of `strtab`, and whether its NUL is inside
    /// `strtab`. `None`: `offset` is outside `strtab`.
    pub fn string_at(strtab: &[u8], offset: u64) -> Option<(&[u8], bool)> {
        let rest = strtab.get(usize::try_from(offset).ok()?..)?;
        if rest.is_empty() {
            return None;
        }
        Some(match strings::index_of_char_usize(rest, 0) {
            Some(len) => (&rest[..len], true),
            None => (rest, false),
        })
    }
}

/// What the loader finds at `vaddr`: the file bytes of the `PT_LOAD` that maps
/// it, `len` of them at most. It reads the dynamic section and the string
/// table there, whatever `p_offset` or a section header says.
fn mapped<'a>(
    bytes: &'a [u8],
    headers: &[elf::ProgramHeader],
    vaddr: u64,
    len: u64,
) -> Option<&'a [u8]> {
    let (load, offset) = headers
        .iter()
        .find_map(|load| Some((load, load.offset_of(vaddr)?)))?;
    slice_at(bytes, offset, len.min(load.filesz - (vaddr - load.vaddr)))
}

fn read_elf<'a>(
    bytes: &'a [u8],
    header: elf::Header,
    entries: &mut Vec<Entry<'a>>,
) -> Result<(), Malformed> {
    if header.phnum == 0 {
        return Ok(());
    }
    let stride = usize::from(header.phentsize);
    if stride < elf::PHDR_SIZE {
        return Err(Malformed::ProgramHeaders);
    }
    let table = slice_at(
        bytes,
        header.phoff,
        u64::from(header.phnum) * u64::from(header.phentsize),
    )
    .ok_or(Malformed::ProgramHeaders)?;
    let headers: Vec<elf::ProgramHeader> = elf::program_headers(table, stride).collect();
    // The loaders keep the last `PT_DYNAMIC`.
    let Some(dynamic) = headers.iter().rfind(|h| h.kind == elf::PT_DYNAMIC) else {
        return Ok(());
    };
    let dynamic =
        mapped(bytes, &headers, dynamic.vaddr, dynamic.filesz).ok_or(Malformed::Dynamic)?;
    // The loaders walk to `DT_NULL` with no other bound.
    if elf::dynamic_entries(dynamic).count() == dynamic.len() / elf::DYN_SIZE {
        return Err(Malformed::Dynamic);
    }

    // `DT_STRTAB` may follow the tags that point into it.
    let mut strtab_vaddr = None;
    let mut strtab_size = 0u64;
    let mut strings_at: Vec<(Kind, u64)> = Vec::new();
    for (tag, val) in elf::dynamic_entries(dynamic) {
        let kind = match tag {
            elf::DT_STRTAB => {
                strtab_vaddr = Some(val);
                continue;
            }
            elf::DT_STRSZ => {
                strtab_size = val;
                continue;
            }
            elf::DT_RPATH => Kind::ElfRpath,
            elf::DT_RUNPATH => Kind::ElfRunpath,
            elf::DT_NEEDED => Kind::ElfNeeded,
            elf::DT_AUXILIARY => Kind::ElfAuxiliary,
            elf::DT_FILTER => Kind::ElfFilter,
            elf::DT_SONAME => Kind::ElfSoname,
            _ => continue,
        };
        strings_at.push((kind, val));
    }
    if strings_at.is_empty() {
        return Ok(());
    }
    let strtab = strtab_vaddr
        .and_then(|vaddr| mapped(bytes, &headers, vaddr, strtab_size))
        .ok_or(Malformed::StringTable)?;
    for (kind, offset) in strings_at {
        match elf::string_at(strtab, offset) {
            Some((value, true)) => entries.push(Entry { kind, value }),
            _ => return Err(Malformed::String),
        }
    }
    Ok(())
}

mod macho {
    use super::*;
    use crate::macho_types::{LC_REQ_DYLD, load_command, mach_header_64};

    const MH_MAGIC_64: u32 = 0xfeed_facf;
    /// Big-endian on disk, like every field of the universal header.
    const FAT_MAGIC: u32 = 0xcafe_babe;
    const FAT_MAGIC_64: u32 = 0xcafe_babf;
    /// A Java class file starts with `FAT_MAGIC` too, then its version: 45 or
    /// more where a universal file has its image count.
    const FIRST_JAVA_CLASS_VERSION: u32 = 45;

    const LC_LOAD_DYLIB: u32 = 0xc;
    const LC_ID_DYLIB: u32 = 0xd;
    const LC_LOAD_WEAK_DYLIB: u32 = 0x18 | LC_REQ_DYLD;
    const LC_RPATH: u32 = 0x1c | LC_REQ_DYLD;
    const LC_REEXPORT_DYLIB: u32 = 0x1f | LC_REQ_DYLD;
    const LC_LAZY_LOAD_DYLIB: u32 = 0x20;
    const LC_LOAD_UPWARD_DYLIB: u32 = 0x23 | LC_REQ_DYLD;

    /// `false`: `bytes` holds no 64-bit little-endian Mach-O image.
    pub(super) fn read<'a>(
        bytes: &'a [u8],
        entries: &mut Vec<Entry<'a>>,
    ) -> Result<bool, Malformed> {
        let be_u32 = |offset: usize| -> Option<u32> {
            Some(u32::from_be_bytes(
                bytes.get(offset..offset + 4)?.try_into().unwrap(),
            ))
        };
        let be_u64 = |offset: usize| -> Option<u64> {
            Some(u64::from_be_bytes(
                bytes.get(offset..offset + 8)?.try_into().unwrap(),
            ))
        };
        let (Some(magic), Some(count)) = (be_u32(0), be_u32(4)) else {
            return Ok(false);
        };
        let wide = match magic {
            FAT_MAGIC => false,
            FAT_MAGIC_64 => true,
            _ => return read_image(bytes, entries),
        };
        if count >= FIRST_JAVA_CLASS_VERSION {
            return Ok(false);
        }
        // `fat_arch`: cputype, cpusubtype, offset, size, align (`u32` each).
        // `fat_arch_64`: offset and size are `u64`, and a reserved `u32` ends it.
        let arch_size = if wide { 32 } else { 20 };
        let mut found = false;
        for index in 0..count as usize {
            let arch = 8 + index * arch_size;
            let range = if wide {
                be_u64(arch + 8).zip(be_u64(arch + 16))
            } else {
                be_u32(arch + 8)
                    .zip(be_u32(arch + 12))
                    .map(|(offset, size)| (u64::from(offset), u64::from(size)))
            };
            let image = range
                .and_then(|(offset, size)| slice_at(bytes, offset, size))
                .ok_or(Malformed::FatImage)?;
            found |= read_image(image, entries)?;
        }
        Ok(found)
    }

    fn read_image<'a>(image: &'a [u8], entries: &mut Vec<Entry<'a>>) -> Result<bool, Malformed> {
        const HEADER_SIZE: usize = size_of::<mach_header_64>();
        const COMMAND_SIZE: usize = size_of::<load_command>();

        let Some(header) = image.get(..HEADER_SIZE) else {
            return Ok(false);
        };
        let header: mach_header_64 = read_struct(header);
        if u32::from_le(header.magic) != MH_MAGIC_64 {
            return Ok(false);
        }
        let mut commands = slice_at(
            image,
            HEADER_SIZE as u64,
            u64::from(u32::from_le(header.sizeofcmds)),
        )
        .ok_or(Malformed::LoadCommands)?;
        for _ in 0..u32::from_le(header.ncmds) {
            let le_u32 = |command: &[u8], offset: usize| -> Option<u32> {
                Some(u32::from_le_bytes(
                    command.get(offset..offset + 4)?.try_into().unwrap(),
                ))
            };
            let size = le_u32(commands, 4).ok_or(Malformed::LoadCommands)? as usize;
            if size < COMMAND_SIZE || size > commands.len() {
                return Err(Malformed::LoadCommands);
            }
            let (command, rest) = commands.split_at(size);
            commands = rest;
            let kind = match le_u32(command, 0) {
                Some(LC_RPATH) => Kind::MachoRpath,
                Some(LC_ID_DYLIB) => Kind::MachoId,
                Some(
                    LC_LOAD_DYLIB | LC_LOAD_WEAK_DYLIB | LC_REEXPORT_DYLIB | LC_LAZY_LOAD_DYLIB
                    | LC_LOAD_UPWARD_DYLIB,
                ) => Kind::MachoDylib,
                _ => continue,
            };
            // `rpath_command` and `dylib_command` both start with the `lc_str`
            // offset of their string, counted from the start of the command.
            let value = le_u32(command, COMMAND_SIZE)
                .and_then(|offset| command.get(offset as usize..))
                .and_then(|string| Some(&string[..strings::index_of_char_usize(string, 0)?]))
                .ok_or(Malformed::LoadCommandString)?;
            entries.push(Entry { kind, value });
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VADDR: u64 = 0x1000;
    const DYNAMIC_AT: usize = elf::EHDR_SIZE + 3 * elf::PHDR_SIZE;

    /// One `PT_LOAD` maps the whole file at `VADDR`. The dynamic section
    /// follows the three program headers and the string table follows it.
    fn elf_image(dynamic: &[(i64, u64)], strtab: &[u8]) -> Vec<u8> {
        let dynamic_size = (dynamic.len() + 3) * elf::DYN_SIZE;
        let strtab_at = DYNAMIC_AT + dynamic_size;
        let mut image = vec![0u8; strtab_at + strtab.len()];
        image[..6].copy_from_slice(b"\x7fELF\x02\x01");
        image[32..40].copy_from_slice(&(elf::EHDR_SIZE as u64).to_le_bytes());
        image[54..56].copy_from_slice(&(elf::PHDR_SIZE as u16).to_le_bytes());
        image[56..58].copy_from_slice(&2u16.to_le_bytes());
        let total = image.len() as u64;
        set_phdr(&mut image, 0, elf::PT_LOAD, 0, VADDR, total);
        set_phdr(
            &mut image,
            1,
            elf::PT_DYNAMIC,
            DYNAMIC_AT as u64,
            VADDR + DYNAMIC_AT as u64,
            dynamic_size as u64,
        );
        let tags = dynamic.iter().copied().chain([
            (elf::DT_STRTAB, VADDR + strtab_at as u64),
            (elf::DT_STRSZ, strtab.len() as u64),
            (elf::DT_NULL, 0),
        ]);
        for (index, (tag, val)) in tags.enumerate() {
            let at = DYNAMIC_AT + index * elf::DYN_SIZE;
            image[at..at + 8].copy_from_slice(&tag.to_le_bytes());
            image[at + 8..at + 16].copy_from_slice(&val.to_le_bytes());
        }
        image[strtab_at..].copy_from_slice(strtab);
        image
    }

    fn set_phdr(image: &mut [u8], index: usize, kind: u32, offset: u64, vaddr: u64, size: u64) {
        let at = elf::EHDR_SIZE + index * elf::PHDR_SIZE;
        image[at..at + 4].copy_from_slice(&kind.to_le_bytes());
        image[at + 8..at + 16].copy_from_slice(&offset.to_le_bytes());
        image[at + 16..at + 24].copy_from_slice(&vaddr.to_le_bytes());
        image[at + 32..at + 40].copy_from_slice(&size.to_le_bytes());
    }

    fn macho_image(commands: &[(u32, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for &(cmd, string) in commands {
            // cmd, cmdsize, lc_str offset, then 12 bytes of dylib versions.
            let size = (24 + string.len() + 1).next_multiple_of(8);
            let start = body.len();
            body.extend_from_slice(&cmd.to_le_bytes());
            body.extend_from_slice(&(size as u32).to_le_bytes());
            body.extend_from_slice(&24u32.to_le_bytes());
            body.resize(start + 24, 0);
            body.extend_from_slice(string);
            body.resize(start + size, 0);
        }
        let mut image = vec![0u8; 32];
        image[..4].copy_from_slice(&0xfeed_facfu32.to_le_bytes());
        image[16..20].copy_from_slice(&(commands.len() as u32).to_le_bytes());
        image[20..24].copy_from_slice(&(body.len() as u32).to_le_bytes());
        image.extend_from_slice(&body);
        image
    }

    fn pairs<'a>(entries: &[Entry<'a>]) -> Vec<(Kind, &'a [u8])> {
        entries.iter().map(|e| (e.kind, e.value)).collect()
    }

    #[test]
    fn reads_elf_dynamic_strings() {
        let strtab = b"\0libfoo.so\0$ORIGIN/../lib:$ORIGIN\0addon.node\0";
        let image = elf_image(
            &[
                (elf::DT_NEEDED, 1),
                (elf::DT_SONAME, 34),
                (elf::DT_RUNPATH, 11),
                (0x6fff_fffb, 1),
            ],
            strtab,
        );
        assert_eq!(
            pairs(&read(&image).unwrap().unwrap()),
            [
                (Kind::ElfNeeded, &b"libfoo.so"[..]),
                (Kind::ElfSoname, b"addon.node"),
                (Kind::ElfRunpath, b"$ORIGIN/../lib:$ORIGIN"),
            ]
        );
    }

    #[test]
    fn rejects_elf_strings_outside_the_table() {
        let past_the_end = elf_image(&[(elf::DT_RPATH, 64)], b"\0lib\0");
        assert_eq!(read(&past_the_end), Err(Malformed::String));
        let unterminated = elf_image(&[(elf::DT_RPATH, 1)], b"\0lib");
        assert_eq!(read(&unterminated), Err(Malformed::String));
        let mut no_table = elf_image(&[(elf::DT_NEEDED, 1)], b"\0lib\0");
        no_table.truncate(no_table.len() - 2);
        assert_eq!(read(&no_table), Err(Malformed::StringTable));
    }

    #[test]
    fn elf_without_loader_entries_is_empty() {
        assert_eq!(
            read(&elf_image(&[], b"\0")).unwrap().unwrap(),
            Vec::<Entry>::new()
        );
        let mut header_only = elf_image(&[], b"\0");
        header_only[56..58].copy_from_slice(&0u16.to_le_bytes());
        assert_eq!(read(&header_only).unwrap().unwrap(), Vec::<Entry>::new());
    }

    #[test]
    fn reads_elf_where_the_loader_reads() {
        let strtab = b"\0$ORIGIN/../lib\0";
        let expected = [(Kind::ElfRunpath, &b"$ORIGIN/../lib"[..])];

        // `p_offset` of `PT_DYNAMIC` points at the ELF header: the loader never reads it.
        let mut stale_offset = elf_image(&[(elf::DT_RUNPATH, 1)], strtab);
        set_phdr(
            &mut stale_offset,
            1,
            elf::PT_DYNAMIC,
            0,
            VADDR + DYNAMIC_AT as u64,
            4 * elf::DYN_SIZE as u64,
        );
        assert_eq!(pairs(&read(&stale_offset).unwrap().unwrap()), expected);

        // Two `PT_DYNAMIC` headers: the last one counts.
        let mut two_dynamic = elf_image(&[(elf::DT_RUNPATH, 1)], strtab);
        set_phdr(&mut two_dynamic, 1, elf::PT_DYNAMIC, 0, VADDR, 0);
        set_phdr(
            &mut two_dynamic,
            2,
            elf::PT_DYNAMIC,
            0,
            VADDR + DYNAMIC_AT as u64,
            4 * elf::DYN_SIZE as u64,
        );
        two_dynamic[56..58].copy_from_slice(&3u16.to_le_bytes());
        assert_eq!(pairs(&read(&two_dynamic).unwrap().unwrap()), expected);
    }

    #[test]
    fn rejects_elf_dynamic_the_loader_cannot_walk() {
        let mut no_terminator = elf_image(&[(elf::DT_RUNPATH, 1)], b"\0lib\0");
        let terminator_at = DYNAMIC_AT + 3 * elf::DYN_SIZE;
        no_terminator[terminator_at..terminator_at + 8]
            .copy_from_slice(&0x6fff_fffbi64.to_le_bytes());
        assert_eq!(read(&no_terminator), Err(Malformed::Dynamic));

        let mut unmapped = elf_image(&[(elf::DT_RUNPATH, 1)], b"\0lib\0");
        set_phdr(
            &mut unmapped,
            1,
            elf::PT_DYNAMIC,
            DYNAMIC_AT as u64,
            0x9000,
            64,
        );
        assert_eq!(read(&unmapped), Err(Malformed::Dynamic));

        let mut short_headers = elf_image(&[], b"\0");
        short_headers[54..56].copy_from_slice(&8u16.to_le_bytes());
        assert_eq!(read(&short_headers), Err(Malformed::ProgramHeaders));
        let mut far_headers = elf_image(&[], b"\0");
        far_headers[32..40].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(read(&far_headers), Err(Malformed::ProgramHeaders));
    }

    #[test]
    fn reads_macho_load_commands() {
        let image = macho_image(&[
            (0xd, b"@rpath/libbar.dylib"),
            (0xc, b"@rpath/libfoo.dylib"),
            (0x19, b"__TEXT"),
            (0x8000_001c, b"@loader_path/../lib"),
            (0x8000_0018, b"@loader_path/libweak.dylib"),
        ]);
        assert_eq!(
            pairs(&read(&image).unwrap().unwrap()),
            [
                (Kind::MachoId, &b"@rpath/libbar.dylib"[..]),
                (Kind::MachoDylib, b"@rpath/libfoo.dylib"),
                (Kind::MachoRpath, b"@loader_path/../lib"),
                (Kind::MachoDylib, b"@loader_path/libweak.dylib"),
            ]
        );
    }

    #[test]
    fn reads_every_image_of_a_universal_file() {
        let first = macho_image(&[(0x8000_001c, b"@loader_path")]);
        let second = macho_image(&[(0x8000_001c, b"@loader_path/../..")]);
        let mut fat = Vec::new();
        fat.extend_from_slice(&0xcafe_babeu32.to_be_bytes());
        fat.extend_from_slice(&2u32.to_be_bytes());
        let mut offset = 8 + 2 * 20;
        for image in [&first, &second] {
            fat.extend_from_slice(&[0; 8]);
            fat.extend_from_slice(&(offset as u32).to_be_bytes());
            fat.extend_from_slice(&(image.len() as u32).to_be_bytes());
            fat.extend_from_slice(&[0; 4]);
            offset += image.len();
        }
        fat.extend_from_slice(&first);
        fat.extend_from_slice(&second);
        assert_eq!(
            pairs(&read(&fat).unwrap().unwrap()),
            [
                (Kind::MachoRpath, &b"@loader_path"[..]),
                (Kind::MachoRpath, b"@loader_path/../.."),
            ]
        );
        fat.truncate(fat.len() - 1);
        assert_eq!(read(&fat), Err(Malformed::FatImage));
    }

    #[test]
    fn rejects_macho_commands_outside_the_image() {
        let mut unterminated = macho_image(&[(0x8000_001c, b"@loader_path")]);
        let padding_at = unterminated.len() - 4;
        unterminated[padding_at..].fill(b'x');
        assert_eq!(read(&unterminated), Err(Malformed::LoadCommandString));
        let mut short = macho_image(&[(0x8000_001c, b"@loader_path")]);
        short[20..24].copy_from_slice(&4096u32.to_le_bytes());
        assert_eq!(read(&short), Err(Malformed::LoadCommands));
    }

    #[test]
    fn other_files_are_not_objects() {
        for bytes in [
            &b""[..],
            b"MZ\x90\0",
            b"\x7fELF\x01\x01",
            b"#!/bin/sh\n",
            // A Java class file: the universal magic, then version 52.
            b"\xca\xfe\xba\xbe\x00\x00\x00\x34\x00\x10",
        ] {
            assert_eq!(read(bytes), Ok(None));
        }
    }
}
