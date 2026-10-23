use core::mem::size_of;

use bun_core::slice_to_nul;

use crate::builtins::{Image, u32_at};
use crate::elf::{Elf64_Ehdr, Elf64_Shdr, SHT_NOBITS};
use crate::image::{ExecutableFormat, KnownSection, SectionLocation, SectionNames};
use crate::macho_types as macho;
use crate::pe::{DOSHeader, PEHeader, SectionHeader};

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum SectionError {
    #[error("UnrecognizedExecutable")]
    UnrecognizedExecutable,
    #[error("MissingSection")]
    MissingSection,
    #[error("Invalid")]
    Invalid,
}

pub fn find_known_section(
    file: &mut Image<'_>,
    section: KnownSection,
) -> Result<SectionLocation, SectionError> {
    let names = section.names();
    let magic = file.bytes(0, file.len.min(ExecutableFormat::MAGIC_SIZE))?;
    match ExecutableFormat::from_magic(&magic) {
        Some(ExecutableFormat::Elf) => find_elf(file, names),
        Some(ExecutableFormat::MachO) => find_macho(file, names),
        Some(ExecutableFormat::Pe) => find_pe(file, names),
        None => Err(SectionError::UnrecognizedExecutable),
    }
}

fn find_elf(file: &mut Image<'_>, names: SectionNames) -> Result<SectionLocation, SectionError> {
    if file.len < size_of::<Elf64_Ehdr>() {
        return Err(SectionError::UnrecognizedExecutable);
    }
    let ehdr: Elf64_Ehdr = file.struct_at(0)?;
    // EI_CLASS = ELFCLASS64, EI_DATA = ELFDATA2LSB: every target bun builds for.
    if ehdr.e_ident[4] != 2 || ehdr.e_ident[5] != 1 {
        return Err(SectionError::UnrecognizedExecutable);
    }
    let shdr = |file: &mut Image<'_>, index: usize| -> Result<Elf64_Shdr, SectionError> {
        let offset = (index * size_of::<Elf64_Shdr>())
            .checked_add(usize::try_from(ehdr.e_shoff).map_err(|_| SectionError::Invalid)?)
            .ok_or(SectionError::Invalid)?;
        file.struct_at(offset)
    };
    if ehdr.e_shstrndx >= ehdr.e_shnum {
        return Err(SectionError::MissingSection);
    }
    let strtab_hdr = shdr(file, ehdr.e_shstrndx as usize)?;
    let strtab = file.bytes(
        to_usize(strtab_hdr.sh_offset)?,
        to_usize(strtab_hdr.sh_size)?,
    )?;
    for i in 0..ehdr.e_shnum as usize {
        let s = shdr(file, i)?;
        let Some(name) = strtab.get(s.sh_name as usize..) else {
            continue;
        };
        if slice_to_nul(name) == names.elf {
            if s.sh_type == SHT_NOBITS {
                return Err(SectionError::Invalid);
            }
            file.range(to_usize(s.sh_offset)?, to_usize(s.sh_size)?)?;
            return Ok(SectionLocation {
                address: s.sh_addr,
                file_offset: s.sh_offset,
                size: s.sh_size,
            });
        }
    }
    Err(SectionError::MissingSection)
}

fn find_macho(file: &mut Image<'_>, names: SectionNames) -> Result<SectionLocation, SectionError> {
    let header: macho::mach_header_64 = file.struct_at(0)?;
    let mut offset = size_of::<macho::mach_header_64>();
    for _ in 0..header.ncmds {
        let command = file.bytes(offset, 8)?;
        let (cmd, cmdsize) = (u32_at(&command, 0), u32_at(&command, 4) as usize);
        if cmdsize < 8 {
            return Err(SectionError::Invalid);
        }
        if cmd == macho::LC::SEGMENT_64 {
            let seg: macho::segment_command_64 = file.struct_at(offset)?;
            let mut sect_offset = offset + size_of::<macho::segment_command_64>();
            for _ in 0..seg.nsects {
                if sect_offset + size_of::<macho::section_64>() > offset + cmdsize {
                    return Err(SectionError::Invalid);
                }
                let sect: macho::section_64 = file.struct_at(sect_offset)?;
                if sect.sect_name() == names.macho_section && sect.seg_name() == names.macho_segment
                {
                    file.range(sect.offset as usize, to_usize(sect.size)?)?;
                    return Ok(SectionLocation {
                        address: sect.addr,
                        file_offset: u64::from(sect.offset),
                        size: sect.size,
                    });
                }
                sect_offset += size_of::<macho::section_64>();
            }
        }
        offset = offset.checked_add(cmdsize).ok_or(SectionError::Invalid)?;
    }
    Err(SectionError::MissingSection)
}

fn find_pe(file: &mut Image<'_>, names: SectionNames) -> Result<SectionLocation, SectionError> {
    let dos: DOSHeader = file.struct_at(0)?;
    let pe_offset = dos.e_lfanew as usize;
    let pe: PEHeader = file.struct_at(pe_offset)?;
    if pe.signature != crate::pe::PE_SIGNATURE {
        return Err(SectionError::UnrecognizedExecutable);
    }
    let mut offset = pe_offset
        .checked_add(size_of::<PEHeader>() + pe.size_of_optional_header as usize)
        .ok_or(SectionError::Invalid)?;
    for _ in 0..pe.number_of_sections {
        let s: SectionHeader = file.struct_at(offset)?;
        if s.name == names.pe {
            // virtual_size is the payload; size_of_raw_data is that rounded up to the file alignment.
            let len = if s.virtual_size != 0 {
                s.virtual_size.min(s.size_of_raw_data)
            } else {
                s.size_of_raw_data
            };
            file.range(s.pointer_to_raw_data as usize, len as usize)?;
            return Ok(SectionLocation {
                address: u64::from(s.virtual_address),
                file_offset: u64::from(s.pointer_to_raw_data),
                size: u64::from(len),
            });
        }
        offset += size_of::<SectionHeader>();
    }
    Err(SectionError::MissingSection)
}

fn to_usize(v: u64) -> Result<usize, SectionError> {
    usize::try_from(v).map_err(|_| SectionError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::elf::{SHT_PROGBITS, SHT_STRTAB};
    use crate::image::read_bytes_at;
    use crate::{align_up, read_struct, write_struct};

    const FILE_SIZE: usize = 0x3000;
    const ELF_STRING_TABLE_OFFSET: usize = 0x800;
    const MACHO_UUID_COMMAND_OFFSET: usize = size_of::<macho::mach_header_64>();
    const MACHO_UUID_COMMAND_SIZE: usize = 24;
    const MACHO_FIRST_SEGMENT_OFFSET: usize = MACHO_UUID_COMMAND_OFFSET + MACHO_UUID_COMMAND_SIZE;
    const MACHO_SEGMENT_NAME_OFFSET: usize = 8;
    const PE_HEADER_OFFSET: usize = 0x80;
    const PE_OPTIONAL_HEADER_SIZE: usize = 240;
    const PE_SECTION_TABLE_OFFSET: usize =
        PE_HEADER_OFFSET + size_of::<PEHeader>() + PE_OPTIONAL_HEADER_SIZE;
    const PE_FILE_ALIGNMENT: u64 = 0x200;

    #[derive(Copy, Clone)]
    struct ToySection {
        section: KnownSection,
        elf_name: &'static [u8],
        macho_segment: &'static [u8],
        macho_section: &'static [u8],
        pe_name: &'static [u8],
        location: SectionLocation,
    }

    struct ToySegment<'a> {
        command_name: &'a [u8],
        sections: &'a [ToySection],
    }

    const BUILTIN_MODULES: ToySection = ToySection {
        section: KnownSection::BuiltinModules,
        elf_name: b".bun_builtins",
        macho_segment: b"__TEXT",
        macho_section: b"__bun_builtins",
        pe_name: b".bunblt",
        location: SectionLocation {
            address: 0x40_5000,
            file_offset: 0x1000,
            size: 0x320,
        },
    };
    const TRIM_TABLE: ToySection = ToySection {
        section: KnownSection::TrimTable,
        elf_name: b".bun_trim",
        macho_segment: b"__TEXT",
        macho_section: b"__bun_trim",
        pe_name: b".buntrim",
        location: SectionLocation {
            address: 0x40_6000,
            file_offset: 0x1400,
            size: 0x1f8,
        },
    };
    const FEATURE_STATE: ToySection = ToySection {
        section: KnownSection::RemovableFeatureState,
        elf_name: b".bun_features",
        macho_segment: b"__TEXT",
        macho_section: b"__bun_features",
        pe_name: b".bunfeat",
        location: SectionLocation {
            address: 0x40_7000,
            file_offset: 0x1800,
            size: 0x218,
        },
    };
    const PAYLOAD: ToySection = ToySection {
        section: KnownSection::Payload,
        elf_name: b".bun",
        macho_segment: b"__BUN",
        macho_section: b"__bun",
        pe_name: b".bun",
        location: SectionLocation {
            address: 0x40_9000,
            file_offset: 0x2000,
            size: 0x18,
        },
    };
    const TOY_SECTIONS: [ToySection; 4] = [BUILTIN_MODULES, TRIM_TABLE, FEATURE_STATE, PAYLOAD];

    fn zeroed<T: Copy>() -> T {
        read_struct(&vec![0u8; size_of::<T>()])
    }

    fn edit_struct<T: Copy>(bytes: &mut [u8], offset: usize, edit: impl FnOnce(&mut T)) {
        let mut value: T = read_struct(&bytes[offset..]);
        edit(&mut value);
        write_struct(&mut bytes[offset..], &value);
    }

    fn elf_section_header_offset(index: usize) -> usize {
        size_of::<Elf64_Ehdr>() + index * size_of::<Elf64_Shdr>()
    }

    fn build_elf(sections: &[ToySection]) -> Vec<u8> {
        let mut names = vec![0u8];
        let mut headers = vec![zeroed::<Elf64_Shdr>()];
        for toy in sections {
            let mut header: Elf64_Shdr = zeroed();
            header.sh_name = names.len() as u32;
            header.sh_type = SHT_PROGBITS;
            header.sh_addr = toy.location.address;
            header.sh_offset = toy.location.file_offset;
            header.sh_size = toy.location.size;
            headers.push(header);
            names.extend_from_slice(toy.elf_name);
            names.push(0);
        }
        let mut string_table: Elf64_Shdr = zeroed();
        string_table.sh_name = names.len() as u32;
        names.extend_from_slice(b".shstrtab\0");
        string_table.sh_type = SHT_STRTAB;
        string_table.sh_offset = ELF_STRING_TABLE_OFFSET as u64;
        string_table.sh_size = names.len() as u64;
        headers.push(string_table);

        let mut ehdr: Elf64_Ehdr = zeroed();
        ehdr.e_ident[..6].copy_from_slice(b"\x7fELF\x02\x01");
        ehdr.e_shoff = size_of::<Elf64_Ehdr>() as u64;
        ehdr.e_shentsize = size_of::<Elf64_Shdr>() as u16;
        ehdr.e_shnum = headers.len() as u16;
        ehdr.e_shstrndx = headers.len() as u16 - 1;

        let mut bytes = vec![0u8; FILE_SIZE];
        write_struct(&mut bytes, &ehdr);
        for (index, header) in headers.iter().enumerate() {
            write_struct(&mut bytes[elf_section_header_offset(index)..], header);
        }
        bytes[ELF_STRING_TABLE_OFFSET..][..names.len()].copy_from_slice(&names);
        bytes
    }

    fn pad_macho_name(name: &[u8]) -> [u8; 16] {
        let mut padded = [0u8; 16];
        padded[..name.len()].copy_from_slice(name);
        padded
    }

    fn append_macho_segment(commands: &mut Vec<u8>, segment: &ToySegment<'_>) {
        let offset = commands.len();
        let sections_offset = offset + size_of::<macho::segment_command_64>();
        let end = sections_offset + segment.sections.len() * size_of::<macho::section_64>();
        let mut command: macho::segment_command_64 = zeroed();
        command.cmd = macho::LC::SEGMENT_64;
        command.cmdsize = (end - offset) as u32;
        command.nsects = segment.sections.len() as u32;

        commands.resize(end, 0);
        write_struct(&mut commands[offset..], &command);
        commands[offset + MACHO_SEGMENT_NAME_OFFSET..][..16]
            .copy_from_slice(&pad_macho_name(segment.command_name));
        for (index, toy) in segment.sections.iter().enumerate() {
            let mut section: macho::section_64 = zeroed();
            section.sectname = pad_macho_name(toy.macho_section);
            section.segname = pad_macho_name(toy.macho_segment);
            section.addr = toy.location.address;
            section.size = toy.location.size;
            section.offset = toy.location.file_offset as u32;
            let section_offset = sections_offset + index * size_of::<macho::section_64>();
            write_struct(&mut commands[section_offset..], &section);
        }
    }

    fn build_macho_segments(segments: &[ToySegment<'_>]) -> Vec<u8> {
        let mut commands = Vec::new();
        commands.extend_from_slice(&macho::LC::UUID.to_le_bytes());
        commands.extend_from_slice(&(MACHO_UUID_COMMAND_SIZE as u32).to_le_bytes());
        commands.resize(MACHO_UUID_COMMAND_SIZE, 0x11);
        for segment in segments {
            append_macho_segment(&mut commands, segment);
        }

        let mut header: macho::mach_header_64 = zeroed();
        header.magic = macho::MH_MAGIC_64;
        header.ncmds = segments.len() as u32 + 1;
        header.sizeofcmds = commands.len() as u32;
        let mut bytes = vec![0u8; FILE_SIZE];
        write_struct(&mut bytes, &header);
        bytes[MACHO_UUID_COMMAND_OFFSET..][..commands.len()].copy_from_slice(&commands);
        bytes
    }

    fn build_macho(sections: &[ToySection]) -> Vec<u8> {
        let segments: Vec<ToySegment<'_>> = sections
            .chunk_by(|previous, next| previous.macho_segment == next.macho_segment)
            .map(|sections| ToySegment {
                command_name: sections[0].macho_segment,
                sections,
            })
            .collect();
        build_macho_segments(&segments)
    }

    fn build_pe(sections: &[ToySection]) -> Vec<u8> {
        let mut bytes = vec![0u8; FILE_SIZE];
        let mut dos_header: DOSHeader = zeroed();
        dos_header.e_magic = u16::from_le_bytes(*b"MZ");
        dos_header.e_lfanew = PE_HEADER_OFFSET as u32;
        write_struct(&mut bytes, &dos_header);

        let mut header: PEHeader = zeroed();
        header.signature = crate::pe::PE_SIGNATURE;
        header.number_of_sections = sections.len() as u16;
        header.size_of_optional_header = PE_OPTIONAL_HEADER_SIZE as u16;
        write_struct(&mut bytes[PE_HEADER_OFFSET..], &header);

        for (index, toy) in sections.iter().enumerate() {
            let mut section: SectionHeader = zeroed();
            section.name[..toy.pe_name.len()].copy_from_slice(toy.pe_name);
            section.virtual_size = toy.location.size as u32;
            section.virtual_address = toy.location.address as u32;
            section.size_of_raw_data = align_up(toy.location.size, PE_FILE_ALIGNMENT) as u32;
            section.pointer_to_raw_data = toy.location.file_offset as u32;
            let offset = PE_SECTION_TABLE_OFFSET + index * size_of::<SectionHeader>();
            write_struct(&mut bytes[offset..], &section);
        }
        bytes
    }

    fn build_each_format(sections: &[ToySection]) -> [Vec<u8>; 3] {
        [
            build_elf(sections),
            build_macho(sections),
            build_pe(sections),
        ]
    }

    fn find_with_readable_prefix(
        bytes: &[u8],
        readable_size: usize,
        section: KnownSection,
    ) -> Result<SectionLocation, SectionError> {
        let mut read = |offset: usize, out: &mut [u8]| {
            offset < readable_size && read_bytes_at(bytes, offset, out)
        };
        find_known_section(
            &mut Image {
                len: bytes.len(),
                read: &mut read,
            },
            section,
        )
    }

    fn find(bytes: &[u8], section: KnownSection) -> Result<SectionLocation, SectionError> {
        find_with_readable_prefix(bytes, usize::MAX, section)
    }

    #[test]
    fn finds_each_known_section_in_each_format() {
        for file in build_each_format(&TOY_SECTIONS) {
            for toy in TOY_SECTIONS {
                assert_eq!(find(&file, toy.section), Ok(toy.location));
            }
        }
    }

    #[test]
    fn absent_section_is_missing() {
        let missing = Err(SectionError::MissingSection);
        for file in build_each_format(&[BUILTIN_MODULES, FEATURE_STATE]) {
            assert_eq!(find(&file, KnownSection::TrimTable), missing);
            assert_eq!(find(&file, KnownSection::Payload), missing);
            assert_eq!(
                find(&file, FEATURE_STATE.section),
                Ok(FEATURE_STATE.location)
            );
        }
        for file in build_each_format(&[]) {
            for toy in TOY_SECTIONS {
                assert_eq!(find(&file, toy.section), missing);
            }
        }

        let mut without_section_headers = build_elf(&TOY_SECTIONS);
        edit_struct(&mut without_section_headers, 0, |ehdr: &mut Elf64_Ehdr| {
            ehdr.e_shnum = 0;
            ehdr.e_shstrndx = 0;
        });
        assert_eq!(
            find(&without_section_headers, KnownSection::TrimTable),
            missing
        );
    }

    #[test]
    fn first_section_with_name_wins() {
        let later_piece = ToySection {
            location: SectionLocation {
                address: 0x40_8000,
                file_offset: 0x2400,
                size: 0x80,
            },
            ..TRIM_TABLE
        };
        for file in build_each_format(&[BUILTIN_MODULES, TRIM_TABLE, FEATURE_STATE, later_piece]) {
            assert_eq!(
                find(&file, KnownSection::TrimTable),
                Ok(TRIM_TABLE.location)
            );
        }
    }

    #[test]
    fn macho_section_in_other_segment_is_missing() {
        let in_data_segment = ToySection {
            macho_segment: b"__DATA",
            ..TRIM_TABLE
        };
        let file = build_macho_segments(&[ToySegment {
            command_name: b"__TEXT",
            sections: &[BUILTIN_MODULES, in_data_segment],
        }]);
        let result = find(&file, KnownSection::TrimTable);
        assert_eq!(result, Err(SectionError::MissingSection));
    }

    #[test]
    fn macho_section_in_renamed_segment_command_is_found() {
        let file = build_macho_segments(&[
            ToySegment {
                command_name: b"__TEXT",
                sections: &[BUILTIN_MODULES],
            },
            ToySegment {
                command_name: b"__TEXT.2",
                sections: &[TRIM_TABLE, FEATURE_STATE],
            },
        ]);
        for toy in [BUILTIN_MODULES, TRIM_TABLE, FEATURE_STATE] {
            assert_eq!(find(&file, toy.section), Ok(toy.location));
        }
    }

    #[test]
    fn section_past_end_of_file_is_invalid() {
        let at_file_offset = |file_offset: u64| ToySection {
            location: SectionLocation {
                file_offset,
                ..TRIM_TABLE.location
            },
            ..TRIM_TABLE
        };
        let last_valid_offset = FILE_SIZE as u64 - TRIM_TABLE.location.size;
        let at_end = at_file_offset(last_valid_offset);
        for file in build_each_format(&[BUILTIN_MODULES, at_end]) {
            assert_eq!(find(&file, KnownSection::TrimTable), Ok(at_end.location));
        }
        for file in build_each_format(&[BUILTIN_MODULES, at_file_offset(last_valid_offset + 1)]) {
            let result = find(&file, KnownSection::TrimTable);
            assert_eq!(result, Err(SectionError::Invalid));
            assert_eq!(
                find(&file, BUILTIN_MODULES.section),
                Ok(BUILTIN_MODULES.location)
            );
        }
    }

    #[test]
    fn failed_read_is_invalid() {
        for file in build_each_format(&TOY_SECTIONS) {
            for readable_size in [0, 1] {
                let result =
                    find_with_readable_prefix(&file, readable_size, KnownSection::TrimTable);
                assert_eq!(result, Err(SectionError::Invalid));
            }
        }
    }

    #[test]
    fn other_files_are_unrecognized() {
        let elf = build_elf(&TOY_SECTIONS);
        let mut elf32 = elf.clone();
        elf32[4] = 1;
        let mut big_endian_elf = elf.clone();
        big_endian_elf[5] = 2;
        let mut fat_macho = build_macho(&TOY_SECTIONS);
        fat_macho[..4].copy_from_slice(&0xcafe_babe_u32.to_be_bytes());
        let mut pe_without_signature = build_pe(&TOY_SECTIONS);
        pe_without_signature[PE_HEADER_OFFSET] = 0;
        for file in [
            Vec::new(),
            b"#!/bin/sh\n".to_vec(),
            elf[..size_of::<Elf64_Ehdr>() - 1].to_vec(),
            elf32,
            big_endian_elf,
            fat_macho,
            pe_without_signature,
        ] {
            let result = find(&file, KnownSection::TrimTable);
            assert_eq!(result, Err(SectionError::UnrecognizedExecutable));
        }
    }

    #[test]
    fn elf_section_without_file_bytes_is_invalid() {
        let mut file = build_elf(&[BUILTIN_MODULES, TRIM_TABLE]);
        let offset = elf_section_header_offset(2);
        edit_struct(&mut file, offset, |header: &mut Elf64_Shdr| {
            header.sh_type = SHT_NOBITS;
        });
        let result = find(&file, KnownSection::TrimTable);
        assert_eq!(result, Err(SectionError::Invalid));
        assert_eq!(
            find(&file, BUILTIN_MODULES.section),
            Ok(BUILTIN_MODULES.location)
        );
    }

    #[test]
    fn malformed_elf_tables_are_invalid() {
        let mut headers_past_end = build_elf(&TOY_SECTIONS);
        edit_struct(&mut headers_past_end, 0, |ehdr: &mut Elf64_Ehdr| {
            ehdr.e_shoff = FILE_SIZE as u64 - 8;
        });
        let mut names_past_end = build_elf(&TOY_SECTIONS);
        let string_table_offset = elf_section_header_offset(TOY_SECTIONS.len() + 1);
        edit_struct(
            &mut names_past_end,
            string_table_offset,
            |header: &mut Elf64_Shdr| {
                header.sh_size = FILE_SIZE as u64;
            },
        );
        for file in [headers_past_end, names_past_end] {
            let result = find(&file, KnownSection::TrimTable);
            assert_eq!(result, Err(SectionError::Invalid));
        }

        let mut name_outside_table = build_elf(&TOY_SECTIONS);
        let offset = elf_section_header_offset(1);
        edit_struct(
            &mut name_outside_table,
            offset,
            |header: &mut Elf64_Shdr| {
                header.sh_name = u32::MAX;
            },
        );
        let result = find(&name_outside_table, BUILTIN_MODULES.section);
        assert_eq!(result, Err(SectionError::MissingSection));
        assert_eq!(
            find(&name_outside_table, TRIM_TABLE.section),
            Ok(TRIM_TABLE.location)
        );
    }

    #[test]
    fn malformed_macho_commands_are_invalid() {
        let mut short_command = build_macho(&[BUILTIN_MODULES]);
        short_command[MACHO_UUID_COMMAND_OFFSET + 4..][..4].copy_from_slice(&4_u32.to_le_bytes());
        let mut sections_past_command = build_macho(&[BUILTIN_MODULES]);
        edit_struct(
            &mut sections_past_command,
            MACHO_FIRST_SEGMENT_OFFSET,
            |command: &mut macho::segment_command_64| command.nsects = 2,
        );
        let mut commands_past_table = build_macho(&[BUILTIN_MODULES]);
        edit_struct(
            &mut commands_past_table,
            0,
            |header: &mut macho::mach_header_64| {
                header.ncmds += 1;
            },
        );
        for file in [short_command, sections_past_command, commands_past_table] {
            let result = find(&file, KnownSection::TrimTable);
            assert_eq!(result, Err(SectionError::Invalid));
        }
    }

    #[test]
    fn pe_size_is_virtual_size_within_raw_data() {
        let raw_size = align_up(TRIM_TABLE.location.size, PE_FILE_ALIGNMENT);
        for virtual_size in [0, raw_size as u32 + 0x1000] {
            let mut file = build_pe(&[TRIM_TABLE]);
            edit_struct(
                &mut file,
                PE_SECTION_TABLE_OFFSET,
                |header: &mut SectionHeader| {
                    header.virtual_size = virtual_size;
                },
            );
            let expected = SectionLocation {
                size: raw_size,
                ..TRIM_TABLE.location
            };
            assert_eq!(find(&file, KnownSection::TrimTable), Ok(expected));
        }
    }
}
