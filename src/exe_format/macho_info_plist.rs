//! The `__TEXT,__info_plist` section: where CoreFoundation and `codesign` read the Info.plist of an executable
//! that is not in a bundle. `__TEXT` cannot grow, so the section lies in the padding behind the load commands.

use core::ops::Range;

use crate::macho::MachoError;
use crate::macho_ranges::{
    HEADER_SIZE, MAX_SECTIONS, Parsed, SECTION_SIZE, SEGMENT_COMMAND_SIZE, SYMBOL_SIZE, Segment,
    find_contents_start, find_symbols, parse, room_for_signature_command,
};
use crate::macho_types::{
    CommandKind, LC, LoadCommandIterator, N_OSO, N_SECT, N_STAB, N_TYPE, S_REGULAR, mach_header_64,
    nlist_64, section_64, segment_command_64,
};
use crate::{read_struct, write_struct};

const SEGMENT_NAME: [u8; 16] = *b"__TEXT\0\0\0\0\0\0\0\0\0\0";
const SECTION_NAME: [u8; 16] = *b"__info_plist\0\0\0\0";

fn is_text(segment: &segment_command_64) -> bool {
    segment.seg_name() == bun_core::slice_to_nul(&SEGMENT_NAME)
}

pub(crate) fn is_info_plist(section: &section_64) -> bool {
    section.sectname == SECTION_NAME
}

/// The bytes that `codesign` takes for the Info.plist: it looks in the first `__TEXT` only.
pub(crate) fn find(macho: &[u8]) -> Option<Range<usize>> {
    let header: mach_header_64 = bun_core::read_prefix(macho)?;
    let commands = macho
        .get(HEADER_SIZE..)?
        .get(..header.sizeofcmds as usize)?;
    let (text, sections) = LoadCommandIterator::new(header.ncmds, commands)
        .filter(|command| command.cmd() == LC::SEGMENT_64)
        .filter_map(|command| {
            let sections = command.data.get(SEGMENT_COMMAND_SIZE..)?;
            Some((command.cast::<segment_command_64>()?, sections))
        })
        .find(|(segment, _)| is_text(segment))?;
    let (sections, _) = sections.as_chunks::<SECTION_SIZE>();
    let section = (sections.iter().take(text.nsects as usize))
        .map(|bytes| read_struct::<section_64>(bytes))
        .find(is_info_plist)?;
    let end = u64::from(section.offset).checked_add(section.size)?;
    let range = section.offset as usize..usize::try_from(end).ok()?;
    macho.get(range.clone()).map(|_| range)
}

/// `__TEXT` and the offset of its load command.
fn find_text(parsed: &Parsed) -> Result<(usize, &Segment), MachoError> {
    let segment_commands = parsed
        .commands
        .iter()
        .filter_map(|(kind, range)| matches!(kind, CommandKind::Segment).then_some(range.start));
    segment_commands
        .zip(&parsed.segments)
        .find(|(_, segment)| is_text(&segment.command))
        .filter(|(_, segment)| segment.command.fileoff == 0)
        .ok_or(MachoError::InvalidObject)
}

/// Replaces the Info.plist of an executable that has one. Moves nothing but load commands.
pub fn write(macho: &mut [u8], plist: &[u8]) -> Result<(), MachoError> {
    let parsed = parse(macho).map_err(|_| MachoError::InvalidObject)?;
    let (command_at, text) = find_text(&parsed)?;

    let replaced = text.sections.iter().position(is_info_plist);
    let room_end = find_contents_start(text, |section| !is_info_plist(section));
    let room_end = u32::try_from(room_end).map_err(|_| MachoError::InvalidObject)? as usize;
    let old_commands_end = HEADER_SIZE + parsed.header.sizeofcmds as usize;
    let commands_end = match replaced {
        Some(_) => old_commands_end,
        None => old_commands_end + SECTION_SIZE,
    };
    let room_left =
        room_for_signature_command(macho, &parsed).map_err(|_| MachoError::InvalidObject)?;
    let room = room_end.checked_sub(commands_end + room_left);
    if room.is_none_or(|room| plist.len() > room) {
        return Err(MachoError::InfoPlistTooLarge {
            size: plist.len(),
            room: room.unwrap_or(0),
        });
    }
    let offset = room_end - plist.len();
    let addr = (text.command.vmaddr)
        .checked_add(offset as u64)
        .ok_or(MachoError::InvalidObject)?;

    let sections_at = command_at + SEGMENT_COMMAND_SIZE;
    let section_at = match replaced {
        Some(index) => {
            if let Some(old) = find(macho) {
                if old.start < old_commands_end {
                    return Err(MachoError::InvalidObject);
                }
                macho[old].fill(0);
            }
            sections_at + index * SECTION_SIZE
        }
        None => {
            if parsed.segments[parsed.linkedit].first_ordinal > MAX_SECTIONS {
                return Err(MachoError::InvalidObject);
            }
            // It has the lowest address of the segment, and linkers write sections in the order of their addresses.
            shift_ordinals(macho, &parsed, text.first_ordinal, 1)?;
            macho.copy_within(sections_at..old_commands_end, sections_at + SECTION_SIZE);
            count_sections(macho, &parsed, command_at, text, 1);
            sections_at
        }
    };
    let section = section_64 {
        sectname: SECTION_NAME,
        segname: SEGMENT_NAME,
        addr,
        size: plist.len() as u64,
        offset: offset as u32,
        align: 0,
        reloff: 0,
        nreloc: 0,
        flags: S_REGULAR,
        reserved1: 0,
        reserved2: 0,
        reserved3: 0,
    };
    write_struct(&mut macho[section_at..], &section);
    macho[offset..room_end].copy_from_slice(plist);
    Ok(())
}

/// Takes the section that `write` added out of a copy of that executable. True: the file has changed.
/// An Info.plist that is not in the padding stays. A linker put it there, for every program of that runtime.
pub fn remove_written(macho: &mut [u8]) -> bool {
    let Some(contents) = find(macho) else {
        return false;
    };
    let Ok(parsed) = parse(macho) else {
        return false;
    };
    let Ok((command_at, text)) = find_text(&parsed) else {
        return false;
    };
    let Some(index) = text.sections.iter().position(is_info_plist) else {
        return false;
    };
    let commands_end = HEADER_SIZE + parsed.header.sizeofcmds as usize;
    let room_end = find_contents_start(text, |section| !is_info_plist(section));
    let is_in_padding = contents.start >= commands_end && contents.end as u64 == room_end;
    let next_ordinal = text.first_ordinal + index + 1;
    if !is_in_padding || shift_ordinals(macho, &parsed, next_ordinal, -1).is_err() {
        return false;
    }

    macho[contents].fill(0);
    let section_at = command_at + SEGMENT_COMMAND_SIZE + index * SECTION_SIZE;
    macho.copy_within(section_at + SECTION_SIZE..commands_end, section_at);
    macho[commands_end - SECTION_SIZE..commands_end].fill(0);
    count_sections(macho, &parsed, command_at, text, -1);
    true
}

fn count_sections(
    macho: &mut [u8],
    parsed: &Parsed,
    command_at: usize,
    text: &Segment,
    added: i32,
) {
    let size = added * SECTION_SIZE as i32;
    let mut command = text.command;
    command.cmdsize = command.cmdsize.wrapping_add_signed(size);
    command.nsects = command.nsects.wrapping_add_signed(added);
    write_struct(&mut macho[command_at..], &command);
    let mut header = parsed.header;
    header.sizeofcmds = header.sizeofcmds.wrapping_add_signed(size);
    write_struct(macho, &header);
}

/// Symbols name their section by its ordinal among the sections of all segments.
fn shift_ordinals(
    macho: &mut [u8],
    parsed: &Parsed,
    first: usize,
    by: i8,
) -> Result<(), MachoError> {
    let ordinal_end = parsed.segments[parsed.linkedit].first_ordinal;
    let symbols = find_symbols(macho, parsed).map_err(|_| MachoError::InvalidObject)?;
    for bytes in macho[symbols].as_chunks_mut::<SYMBOL_SIZE>().0 {
        let mut symbol: nlist_64 = read_struct(bytes);
        let names_section = match symbol.n_type & N_STAB {
            0 => symbol.n_type & N_TYPE == N_SECT,
            // Linkers put the CPU subtype of the object file there.
            _ => symbol.n_type != N_OSO,
        };
        if names_section && (first..ordinal_end).contains(&usize::from(symbol.n_sect)) {
            symbol.n_sect = symbol.n_sect.wrapping_add_signed(by);
            write_struct(bytes, &symbol);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::Architecture;
    use crate::macho::MachoFile;
    use crate::macho_ranges::tests::toy_macho;
    use crate::macho_types::{CodeDirectory, S_ZEROFILL, linkedit_data_command};

    const ARCHITECTURES: [Architecture; 2] = [Architecture::X86_64, Architecture::Aarch64];
    const PLIST: &[u8] =
        b"<plist><dict><key>CFBundleIdentifier</key><string>a.b</string></dict></plist>";
    const HASH_SIZE: usize = 32;

    fn read_sections(macho: &[u8]) -> Vec<section_64> {
        let segments = parse(macho).unwrap().segments;
        let sections = segments.into_iter().flat_map(|segment| segment.sections);
        sections.collect()
    }

    fn symbol_table(macho: &[u8]) -> Range<usize> {
        find_symbols(macho, &parse(macho).unwrap()).unwrap()
    }

    fn read_symbols(macho: &[u8]) -> Vec<nlist_64> {
        let (symbols, _) = macho[symbol_table(macho)].as_chunks::<SYMBOL_SIZE>();
        symbols.iter().map(|bytes| read_struct(bytes)).collect()
    }

    fn first_section_offset(macho: &[u8]) -> usize {
        read_sections(macho)[0].offset as usize
    }

    fn room_of(macho: &[u8]) -> usize {
        let Err(MachoError::InfoPlistTooLarge { room, .. }) =
            write(&mut macho.to_vec(), &vec![0; macho.len()])
        else {
            panic!("a file has no room for a section of its own size");
        };
        room
    }

    fn sha256(bytes: &[u8]) -> [u8; HASH_SIZE] {
        let mut hash = [0; HASH_SIZE];
        bun_sha_hmac::sha::SHA256::hash(bytes, &mut hash);
        hash
    }

    #[test]
    fn adds_section_without_moving_contents() {
        for architecture in ARCHITECTURES {
            let original = toy_macho(architecture);
            let contents_at = first_section_offset(&original);
            let mut macho = original.clone();
            assert_eq!(find(&macho), None);
            write(&mut macho, PLIST).unwrap();

            assert_eq!(find(&macho), Some(contents_at - PLIST.len()..contents_at));
            assert_eq!(&macho[find(&macho).unwrap()], PLIST);
            let symbols = symbol_table(&original);
            assert_eq!(symbol_table(&macho), symbols);
            assert!(macho[contents_at..symbols.start] == original[contents_at..symbols.start]);
            assert!(macho[symbols.end..] == original[symbols.end..]);

            let (old_sections, sections) = (read_sections(&original), read_sections(&macho));
            assert_eq!(sections.len(), old_sections.len() + 1);
            assert_eq!(sections[0].seg_name(), b"__TEXT");
            assert_eq!(sections[0].sect_name(), b"__info_plist");
            for (old, new) in old_sections.iter().zip(&sections[1..]) {
                assert!(bun_core::bytes_of(old) == bun_core::bytes_of(new));
            }
            let (old, new) = (parse(&original).unwrap(), parse(&macho).unwrap());
            assert_eq!(new.header.ncmds, old.header.ncmds);
            assert_eq!(
                new.header.sizeofcmds as usize,
                old.header.sizeofcmds as usize + SECTION_SIZE
            );
            for ((kind, old), (_, new)) in old.commands.iter().zip(&new.commands) {
                if !matches!(kind, CommandKind::Segment) {
                    assert!(original[old.clone()] == macho[new.clone()]);
                }
            }
        }
    }

    #[test]
    fn symbols_stay_in_their_sections() {
        let original = toy_macho(Architecture::Aarch64);
        let mut macho = original.clone();
        write(&mut macho, PLIST).unwrap();
        let (old_sections, sections) = (read_sections(&original), read_sections(&macho));
        let mut symbols_in_sections = 0;
        for (old, new) in read_symbols(&original).iter().zip(read_symbols(&macho)) {
            assert_eq!(
                (old.n_strx, old.n_type, old.n_value),
                (new.n_strx, new.n_type, new.n_value)
            );
            if old.n_type & N_TYPE != N_SECT {
                assert_eq!(old.n_sect, new.n_sect);
                continue;
            }
            symbols_in_sections += 1;
            let old_section = &old_sections[usize::from(old.n_sect) - 1];
            let new_section = &sections[usize::from(new.n_sect) - 1];
            assert_eq!(old_section.addr, new_section.addr);
        }
        assert!(symbols_in_sections > 0);
    }

    #[test]
    fn debugging_symbols_stay_in_their_sections() {
        const N_FUN: u8 = 0x24;
        let mut original = toy_macho(Architecture::Aarch64);
        let symbols = symbol_table(&original);
        let (entries, _) = original[symbols].as_chunks_mut::<SYMBOL_SIZE>();
        for (bytes, n_type) in entries.iter_mut().zip([N_FUN, N_OSO]) {
            let mut symbol: nlist_64 = read_struct(bytes);
            symbol.n_type = n_type;
            write_struct(bytes, &symbol);
        }
        let mut macho = original.clone();
        write(&mut macho, PLIST).unwrap();
        let (old, new) = (read_symbols(&original), read_symbols(&macho));
        assert_eq!(new[0].n_sect, old[0].n_sect + 1);
        assert_eq!(new[1].n_sect, old[1].n_sect);
    }

    #[test]
    fn replaces_info_plist() {
        let original = toy_macho(Architecture::Aarch64);
        let contents_at = first_section_offset(&original);
        let mut expected = original.clone();
        write(&mut expected, PLIST).unwrap();
        for first_size in [1, PLIST.len(), 4 * PLIST.len()] {
            let mut macho = original.clone();
            write(&mut macho, &vec![b'x'; first_size]).unwrap();
            assert_eq!(find(&macho), Some(contents_at - first_size..contents_at));
            write(&mut macho, PLIST).unwrap();
            assert!(macho == expected);
        }
    }

    #[test]
    fn removes_what_it_wrote() {
        for architecture in ARCHITECTURES {
            let original = toy_macho(architecture);
            let mut macho = original.clone();
            assert!(!remove_written(&mut macho));
            assert!(macho == original);

            write(&mut macho, PLIST).unwrap();
            assert!(remove_written(&mut macho));
            assert!(macho == original);
        }
    }

    #[test]
    fn keeps_info_plist_outside_padding() {
        let mut written = toy_macho(Architecture::Aarch64);
        write(&mut written, PLIST).unwrap();
        let section_at = find_text(&parse(&written).unwrap()).unwrap().0 + SEGMENT_COMMAND_SIZE;
        let section: section_64 = read_struct(&written[section_at..]);
        let text_at = first_section_offset(&toy_macho(Architecture::Aarch64)) as u32;
        let at = |offset: u32, size: u64, flags: u32| section_64 {
            offset,
            addr: section.addr - u64::from(section.offset) + u64::from(offset),
            size,
            flags,
            ..section
        };
        for moved in [
            at(text_at, section.size, S_REGULAR),
            at(section.offset, section.size - 1, S_REGULAR),
            // `parse` does not look at the offset of such a section, and this one is over the load commands.
            at(0, u64::from(text_at), S_ZEROFILL),
        ] {
            let mut linked = written.clone();
            write_struct(&mut linked[section_at..], &moved);
            let before = linked.clone();
            assert!(!remove_written(&mut linked));
            assert!(linked == before);
        }

        let mut over_commands = written.clone();
        let moved = at(0, u64::from(text_at), S_ZEROFILL);
        write_struct(&mut over_commands[section_at..], &moved);
        let before = over_commands.clone();
        assert_eq!(
            write(&mut over_commands, PLIST),
            Err(MachoError::InvalidObject)
        );
        assert!(over_commands == before);
    }

    #[test]
    fn fills_room_behind_load_commands() {
        for architecture in ARCHITECTURES {
            let original = toy_macho(architecture);
            let room = room_of(&original);
            let commands_end = HEADER_SIZE + parse(&original).unwrap().header.sizeofcmds as usize;
            assert_eq!(
                commands_end + SECTION_SIZE + room,
                first_section_offset(&original)
            );

            let mut macho = original.clone();
            write(&mut macho, &vec![b'x'; room]).unwrap();
            assert_eq!(find(&macho).unwrap().len(), room);
            assert_eq!(room_of(&macho), room);

            let mut macho = original.clone();
            let error = MachoError::InfoPlistTooLarge {
                size: room + 1,
                room,
            };
            assert_eq!(write(&mut macho, &vec![b'x'; room + 1]), Err(error));
            assert!(macho == original);
        }
    }

    #[test]
    fn rejects_other_files() {
        assert_eq!(write(&mut [], PLIST), Err(MachoError::InvalidObject));
        assert_eq!(
            write(&mut [0x7f, b'E', b'L', b'F'].repeat(64), PLIST),
            Err(MachoError::InvalidObject)
        );
    }

    #[test]
    fn signature_seals_info_plist() {
        for payload_size in [1, 0x20000] {
            let mut template = toy_macho(Architecture::Aarch64);
            write(&mut template, PLIST).unwrap();
            let mut file = MachoFile::init(&template, payload_size).unwrap();
            file.write_section(&vec![7; payload_size], false).unwrap();
            let mut signed = Vec::new();
            file.build_and_sign(&mut signed).unwrap();
            assert_eq!(&signed[find(&signed).unwrap()], PLIST);

            let parsed = parse(&signed).unwrap();
            let is_signature = |range: &&Range<usize>| {
                read_struct::<u32>(&signed[range.start..]) == LC::CODE_SIGNATURE
            };
            let command = parsed
                .commands
                .iter()
                .map(|(_, range)| range)
                .find(is_signature)
                .unwrap();
            let command: linkedit_data_command = read_struct(&signed[command.clone()]);
            assert_eq!(
                command.dataoff as usize + command.datasize as usize,
                signed.len()
            );

            const DIRECTORY_OFFSET: usize = 20;
            let directory_bytes = &signed[command.dataoff as usize + DIRECTORY_OFFSET..];
            let directory: CodeDirectory = read_struct(directory_bytes);
            assert_eq!(
                u32::from_be(directory.length) as usize,
                directory_bytes.len()
            );
            assert_eq!(u32::from_be(directory.n_special_slots), 1);
            let hash_offset = u32::from_be(directory.hash_offset) as usize;
            assert_eq!(
                directory_bytes[hash_offset - HASH_SIZE..hash_offset],
                sha256(PLIST)
            );
            let (hashes, rest) = directory_bytes[hash_offset..].as_chunks::<HASH_SIZE>();
            assert!(rest.is_empty());
            assert_eq!(hashes.len(), u32::from_be(directory.n_code_slots) as usize);
            for (page, hash) in signed[..command.dataoff as usize]
                .chunks(0x1000)
                .zip(hashes)
            {
                assert!(sha256(page) == *hash);
            }
        }
    }
}
