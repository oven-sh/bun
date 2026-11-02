use core::ops::Range;

use super::*;
use crate::macho::MachoError;
use crate::macho_types::{PROT, S_ATTR_SOME_INSTRUCTIONS, vm_prot_t};

const ARCHITECTURES: [Architecture; 2] = [Architecture::X86_64, Architecture::Aarch64];
const READ: vm_prot_t = PROT::READ;
const READ_EXECUTE: vm_prot_t = PROT::READ | PROT::EXECUTE;
const READ_WRITE: vm_prot_t = PROT::READ | PROT::WRITE;
const LENGTH_SIZE: u64 = size_of::<u64>() as u64;
/// Pages of the toy's payload section, with bytes behind the last whole page as a real payload has them.
const PAYLOAD_SIZE: usize = 7 * PAGE as usize + 0xeb;

fn toy_payload(size: usize) -> Vec<u8> {
    (0..size).map(|index| (index % 253) as u8).collect()
}

/// Whole pages of the payload section, as ranges of the payload: the section begins with the payload's length.
fn code_at(pages: Range<u64>) -> Range<u64> {
    pages.start * PAGE - LENGTH_SIZE..pages.end * PAGE - LENGTH_SIZE
}

fn write(template: &[u8], payload: &[u8], code: &[Range<u64>]) -> Result<Vec<u8>, MachoError> {
    write_counting(template, payload, code).map(|(signed, _)| signed)
}

/// The executable, and how many of its segments may be executed.
fn write_counting(
    template: &[u8],
    payload: &[u8],
    code: &[Range<u64>],
) -> Result<(Vec<u8>, usize), MachoError> {
    let mut file = MachoFile::init(template, payload.len())?;
    file.write_section(payload, !code.is_empty())?;
    let code_segment_count = file.split_section_at_code(code)?;
    let mut signed = Vec::new();
    file.build_and_sign(&mut signed).unwrap();
    Ok((signed, code_segment_count))
}

#[derive(PartialEq, Eq, Debug)]
struct Piece {
    name: Vec<u8>,
    /// In pages from the start of the payload.
    pages: Range<u64>,
    protection: vm_prot_t,
    holds_instructions: bool,
}

fn piece(name: &[u8], pages: Range<u64>, protection: vm_prot_t) -> Piece {
    Piece {
        name: name.to_vec(),
        pages,
        protection,
        holds_instructions: protection == READ_EXECUTE,
    }
}

fn payload_segments(bytes: &[u8]) -> Vec<Segment> {
    let segments = parse(bytes).unwrap().segments;
    let is_of_payload = |segment: &Segment| segment.command.seg_name().starts_with(b"__BUN");
    segments.into_iter().filter(is_of_payload).collect()
}

/// The segments of the payload, each with the one section that holds its bytes. They follow each other without a gap,
/// in memory and in the file.
fn read_pieces(bytes: &[u8]) -> Vec<Piece> {
    let segments = payload_segments(bytes);
    let start = segments[0].command.vmaddr;
    let mut next = (start, segments[0].command.fileoff);
    let pieces = segments.iter().map(|segment| {
        let command = &segment.command;
        assert_eq!((command.vmaddr, command.fileoff), next);
        assert_eq!(command.filesize, command.vmsize);
        assert_eq!(command.maxprot, command.initprot);
        assert_eq!(command.vmaddr % PAGE, 0);
        assert_eq!(command.vmsize % PAGE, 0);
        next = (
            command.vmaddr + command.vmsize,
            command.fileoff + command.filesize,
        );
        let [section] = &segment.sections[..] else {
            panic!("{} sections", segment.sections.len());
        };
        assert_eq!(section.sect_name(), b"__bun");
        assert_eq!(section.seg_name(), b"__BUN");
        assert_eq!(section.addr, command.vmaddr);
        assert_eq!(u64::from(section.offset), command.fileoff);
        Piece {
            name: command.seg_name().to_vec(),
            pages: (command.vmaddr - start) / PAGE..(next.0 - start) / PAGE,
            protection: command.initprot,
            holds_instructions: section.flags & S_ATTR_SOME_INSTRUCTIONS != 0,
        }
    });
    pieces.collect()
}

fn read_payload(bytes: &[u8]) -> Vec<u8> {
    let payload = find_section(bytes, KnownSection::Payload);
    let section = &bytes[payload.file_offset as usize..][..payload.size as usize];
    let (length, payload) = section.split_at(LENGTH_SIZE as usize);
    let length = u64::from_le_bytes(length.try_into().unwrap());
    assert_eq!(length, payload.len() as u64);
    payload.to_vec()
}

fn fixups_segment_count(bytes: &[u8]) -> u32 {
    let fixups = find_blob(bytes, LC::DYLD_CHAINED_FIXUPS).unwrap();
    let header: dyld_chained_fixups_header = read_struct(fixups);
    read_struct(&fixups[header.starts_offset as usize..])
}

fn header_of(bytes: &[u8]) -> mach_header_64 {
    parse(bytes).unwrap().header
}

#[test]
fn only_code_of_payload_may_be_executed() {
    let payload = toy_payload(PAYLOAD_SIZE);
    for architecture in ARCHITECTURES {
        let template = toy_macho(architecture);
        let whole = write(&template, &payload, &[]).unwrap();
        assert_eq!(read_pieces(&whole), [piece(b"__BUN", 0..8, READ_WRITE)]);

        let split = write(&template, &payload, &[code_at(3..5)]).unwrap();
        let expected = [
            piece(b"__BUN", 0..3, READ),
            piece(b"__BUN.1", 3..5, READ_EXECUTE),
            piece(b"__BUN.2", 5..8, READ),
        ];
        assert_eq!(read_pieces(&split), expected);
        assert_eq!(read_payload(&split), payload);
        assert_eq!(
            find_section(&split, KnownSection::Payload),
            find_section(&whole, KnownSection::Payload)
        );

        let (old, new) = (header_of(&whole), header_of(&split));
        assert_eq!(new.ncmds, old.ncmds + 2);
        assert_eq!(
            new.sizeofcmds as usize,
            old.sizeofcmds as usize + 2 * BYTES_PER_CUT
        );
        assert_eq!(
            fixups_segment_count(&split),
            fixups_segment_count(&whole) + 2
        );
        assert_eq!(unchanged_contents(&split), unchanged_contents(&whole));
        assert_removal_can_be_planned(&split);
    }
}

#[test]
fn every_image_has_a_segment_for_its_code() {
    let with_bytes_behind = PAYLOAD_SIZE + 8 * PAGE as usize;
    let whole_pages = (16 * PAGE - LENGTH_SIZE) as usize;
    let cases: [(usize, &[Range<u64>], &[Piece]); 3] = [
        (
            with_bytes_behind,
            &[code_at(2..3), code_at(6..8)],
            &[
                piece(b"__BUN", 0..2, READ),
                piece(b"__BUN.1", 2..3, READ_EXECUTE),
                piece(b"__BUN.2", 3..6, READ),
                piece(b"__BUN.3", 6..8, READ_EXECUTE),
                piece(b"__BUN.4", 8..16, READ),
            ],
        ),
        (
            with_bytes_behind,
            &[code_at(1..2), code_at(4..5), code_at(9..12)],
            &[
                piece(b"__BUN", 0..1, READ),
                piece(b"__BUN.1", 1..2, READ_EXECUTE),
                piece(b"__BUN.2", 2..4, READ),
                piece(b"__BUN.3", 4..5, READ_EXECUTE),
                piece(b"__BUN.4", 5..9, READ),
                piece(b"__BUN.5", 9..12, READ_EXECUTE),
                piece(b"__BUN.6", 12..16, READ),
            ],
        ),
        // Code that ends where the next begins, and code that ends the payload.
        (
            whole_pages,
            &[code_at(1..2), code_at(2..4), code_at(15..16)],
            &[
                piece(b"__BUN", 0..1, READ),
                piece(b"__BUN.1", 1..2, READ_EXECUTE),
                piece(b"__BUN.2", 2..4, READ_EXECUTE),
                piece(b"__BUN.3", 4..15, READ),
                piece(b"__BUN.4", 15..16, READ_EXECUTE),
            ],
        ),
    ];
    for architecture in ARCHITECTURES {
        let template = toy_macho(architecture);
        for (payload_size, code, expected) in &cases {
            let payload = toy_payload(*payload_size);
            let whole = write(&template, &payload, &[]).unwrap();
            let split = write(&template, &payload, code).unwrap();
            let added = expected.len() as u32 - 1;
            assert_eq!(read_pieces(&split), *expected);
            assert_eq!(read_payload(&split), payload);
            assert_eq!(header_of(&split).ncmds, header_of(&whole).ncmds + added);
            assert_eq!(
                fixups_segment_count(&split),
                fixups_segment_count(&whole) + added
            );
            assert_removal_can_be_planned(&split);
        }
    }
}

/// What the engine asks of an image that runs where the loader has put it (`isLoadedAsItsHeaderSays` in
/// AOTImageLoading.cpp): the part in front of its code, its code and the part behind it each lie in one segment that
/// nothing may write, and the code in one that may be executed.
fn runs_in_place(bytes: &[u8], image: Range<u64>, code: Range<u64>) -> bool {
    let segments = payload_segments(bytes);
    let payload = segments[0].command.vmaddr + LENGTH_SIZE;
    let lies_in_one_segment = |range: Range<u64>, is_executed: bool| {
        let (start, end) = (payload + range.start, payload + range.end);
        if start == end {
            return !is_executed;
        }
        let commands = segments.iter().map(|segment| &segment.command);
        let holding = commands
            .filter(|command| start >= command.vmaddr)
            .find(|command| start - command.vmaddr < command.filesize);
        let Some(command) = holding else {
            return false;
        };
        let may_be_written = (command.initprot | command.maxprot) & PROT::WRITE != 0;
        let may_be_executed = command.initprot & PROT::EXECUTE != 0;
        end - start <= command.filesize - (start - command.vmaddr)
            && !may_be_written
            && (may_be_executed || !is_executed)
    };
    lies_in_one_segment(image.start..code.start, false)
        && lies_in_one_segment(code.clone(), true)
        && lies_in_one_segment(code.end..image.end, false)
}

#[test]
fn engine_runs_every_image_where_it_is_loaded() {
    let payload = toy_payload(PAYLOAD_SIZE + 8 * PAGE as usize);
    // An image begins at a page of the section and ends at one. Its code begins a page or more behind its start.
    let images = [code_at(1..5), code_at(5..10), code_at(10..15)];
    let code = [code_at(2..4), code_at(8..10), code_at(11..12)];
    let template = toy();
    for count in 1..=images.len() {
        let split = write(&template, &payload, &code[..count]).unwrap();
        for (index, (image, code)) in images.iter().zip(&code).enumerate() {
            let runs = runs_in_place(&split, image.clone(), code.clone());
            assert_eq!(runs, index < count, "image {index} of {count}");
        }
    }
    // A payload that may be written runs no image.
    let whole = write(&template, &payload, &[]).unwrap();
    assert!(!runs_in_place(&whole, images[0].clone(), code[0].clone()));
}

#[test]
fn symbols_in_payload_name_the_section_they_lie_in() {
    let payload = toy_payload(PAYLOAD_SIZE);
    let template = toy();
    let payload_start = find_section(&template, KnownSection::Payload).address;
    let payload_ordinal = count_sections(&template) as u8;
    // A symbol for each of three pages of the payload, as `add_symbols` writes them: under the one section that the
    // template has.
    let pages = [0, 3, 6];
    let mut with_symbols = template;
    let table: symtab_command = read_command_of(&with_symbols, LC::SYMTAB).unwrap();
    for (index, page) in pages.iter().enumerate() {
        let at = table.symoff as usize + index * SYMBOL_SIZE;
        edit_struct(&mut with_symbols, at, |symbol: &mut nlist_64| {
            symbol.n_type = N_SECT;
            symbol.n_sect = payload_ordinal;
            symbol.n_value = payload_start + page * PAGE + 0x40;
        });
    }
    let split = write(&with_symbols, &payload, &[code_at(3..5)]).unwrap();
    let sections = read_sections(&split);
    let symbols = read_symbols(&split);
    for (symbol, (page, piece)) in symbols.iter().zip(pages.iter().zip(0..)) {
        assert_eq!(symbol.n_value, payload_start + page * PAGE + 0x40);
        assert_eq!(symbol.n_sect, payload_ordinal + piece);
        let section = &sections[usize::from(symbol.n_sect) - 1];
        let address = AddressRange::from_size(symbol.n_value, 1).unwrap();
        assert!(section_addresses(section).contains(address));
    }
    let others =
        |bytes: &[u8]| bun_core::slice_as_bytes(&read_symbols(bytes)[pages.len()..]).to_vec();
    assert_eq!(others(&split), others(&with_symbols));
}

#[test]
fn payload_on_executable_with_split_payload_is_as_on_template() {
    let (first, longer) = (toy_payload(PAYLOAD_SIZE), toy_payload(2 * PAYLOAD_SIZE));
    for architecture in ARCHITECTURES {
        let template = toy_macho(architecture);
        let executable = write(&template, &first, &[code_at(3..5)]).unwrap();
        let cases: [(&[u8], &[Range<u64>]); 5] = [
            (&first, &[code_at(3..5)]),
            (&first, &[code_at(1..2), code_at(6..7)]),
            (&longer, &[code_at(2..9)]),
            (&first, &[]),
            (&longer, &[]),
        ];
        for (payload, code) in cases {
            let on_template = write(&template, payload, code).unwrap();
            let on_executable = write(&executable, payload, code).unwrap();
            assert_eq!(read_pieces(&on_executable), read_pieces(&on_template));
            assert_eq!(read_payload(&on_executable), payload);
            let (old, new) = (header_of(&on_template), header_of(&on_executable));
            assert_eq!((new.ncmds, new.sizeofcmds), (old.ncmds, old.sizeofcmds));
            assert_eq!(
                fixups_segment_count(&on_executable),
                fixups_segment_count(&on_template)
            );
            assert_eq!(
                unchanged_contents(&on_executable),
                unchanged_contents(&on_template)
            );
            assert_removal_can_be_planned(&on_executable);
        }
        // A shorter payload keeps the size of the segment, as it does on an executable whose payload is whole.
        let shorter = toy_payload(2 * PAGE as usize + 0xeb);
        for code in [&[][..], &[code_at(1..2)][..]] {
            let on_executable = write(&executable, &shorter, code).unwrap();
            let pieces = read_pieces(&on_executable);
            assert_eq!(pieces.len(), 1 + 2 * code.len());
            assert_eq!(pieces.last().unwrap().pages.end, 8);
            assert_eq!(read_payload(&on_executable), shorter);
            assert_removal_can_be_planned(&on_executable);
        }
        // Its code lies in what is written, not in what the segment has kept behind it.
        let past_payload = write(&executable, &shorter, &[code_at(4..5)]);
        assert_eq!(past_payload, Err(MachoError::OffsetOutOfRange));
    }
}

#[test]
fn code_that_no_segment_can_hold_is_refused() {
    let payload = toy_payload(PAYLOAD_SIZE);
    let template = toy();
    let not_aligned = MachoError::CodeSegments(ImageError::CutNotAligned);
    let malformed = MachoError::CodeSegments(ImageError::MalformedHeaders);
    let Range { start, end } = code_at(3..5);
    let range = |start: u64, end: u64| Range { start, end };
    let cases: [(Vec<Range<u64>>, MachoError); 8] = [
        (vec![range(start + 8, end)], not_aligned),
        (vec![range(start, end - 0x1000)], not_aligned),
        (vec![range(3 * PAGE, 5 * PAGE)], not_aligned),
        (vec![range(end, start)], malformed),
        (vec![range(start, start)], malformed),
        (vec![code_at(3..9)], MachoError::OffsetOutOfRange),
        (vec![code_at(4..6), code_at(2..3)], malformed),
        (vec![code_at(2..4), code_at(3..5)], malformed),
    ];
    for (code, error) in cases {
        assert_eq!(write(&template, &payload, &code), Err(error));
    }
}

#[test]
fn code_needs_room_behind_the_load_commands() {
    let payload = toy_payload(PAYLOAD_SIZE + 8 * PAGE as usize);
    let with_pad = |header_pad: usize| {
        create_toy(ToyOptions {
            header_pad,
            ..LINKED_TOY
        })
    };
    let no_room = Err(MachoError::NoRoomForCodeSegments);
    let one_image = [code_at(3..5)];
    let two_images = [code_at(3..5), code_at(9..12)];
    // A segment for the code and one for the data behind it are the least, whatever the number of images.
    let without_room = with_pad(2 * BYTES_PER_CUT - 1);
    assert_eq!(write(&without_room, &payload, &one_image), no_room);
    assert_eq!(write(&without_room, &payload, &two_images), no_room);
    assert!(write(&with_pad(2 * BYTES_PER_CUT), &payload, &one_image).is_ok());
    // Without code the payload needs none.
    assert!(write(&with_pad(0), &payload, &[]).is_ok());

    let full_of_sections = create_toy(ToyOptions {
        filler_section_count: (MAX_SECTIONS - TOY_SECTION_COUNT - 1) as u64,
        ..LINKED_TOY
    });
    assert_eq!(write(&full_of_sections, &payload, &one_image), no_room);
}

#[test]
fn code_shares_a_segment_where_the_load_commands_have_room_for_fewer() {
    let payload = toy_payload(PAYLOAD_SIZE + 8 * PAGE as usize);
    let with_room_for = |segments: usize| {
        create_toy(ToyOptions {
            header_pad: segments * BYTES_PER_CUT + BYTES_PER_CUT - 1,
            ..LINKED_TOY
        })
    };
    // An image begins at a page of the section and ends at one. Its code begins a page or more behind its start.
    let images = [code_at(1..5), code_at(5..10), code_at(10..15)];
    let code = [code_at(2..4), code_at(8..10), code_at(11..12)];
    let each_alone = [
        piece(b"__BUN", 0..2, READ),
        piece(b"__BUN.1", 2..4, READ_EXECUTE),
        piece(b"__BUN.2", 4..8, READ),
        piece(b"__BUN.3", 8..10, READ_EXECUTE),
        piece(b"__BUN.4", 10..11, READ),
        piece(b"__BUN.5", 11..12, READ_EXECUTE),
        piece(b"__BUN.6", 12..16, READ),
    ];
    let last_two_together = [
        piece(b"__BUN", 0..2, READ),
        piece(b"__BUN.1", 2..4, READ_EXECUTE),
        piece(b"__BUN.2", 4..8, READ),
        piece(b"__BUN.3", 8..12, READ_EXECUTE),
        piece(b"__BUN.4", 12..16, READ),
    ];
    let all_together = [
        piece(b"__BUN", 0..2, READ),
        piece(b"__BUN.1", 2..12, READ_EXECUTE),
        piece(b"__BUN.2", 12..16, READ),
    ];
    let cases: [(usize, &[Piece]); 5] = [
        (6, &each_alone),
        (5, &last_two_together),
        (4, &last_two_together),
        (3, &all_together),
        (2, &all_together),
    ];
    for (segments, expected) in cases {
        let template = with_room_for(segments);
        let (split, code_segment_count) = write_counting(&template, &payload, &code).unwrap();
        assert_eq!(read_pieces(&split), expected);
        assert_eq!(code_segment_count, expected.len() / 2);
        assert_eq!(read_payload(&split), payload);
        // The engine asks that no image's code shares a segment with what is written, not that it has one to itself.
        for (image, code) in images.iter().zip(&code) {
            assert!(runs_in_place(&split, image.clone(), code.clone()));
        }
        assert_removal_can_be_planned(&split);
    }
    let no_room = Err(MachoError::NoRoomForCodeSegments);
    assert_eq!(write(&with_room_for(1), &payload, &code), no_room);
}

#[test]
fn cuts_leave_room_for_the_segments_of_code() {
    let free_slots = HEADER_PAD / BYTES_PER_CUT;
    let leaving_room =
        |template: &[u8], segments: usize| super::super::cut_model(template, segments);
    let no_cuts = CutCapacity::NoCuts(NoCutReason::HeaderRoomExhausted);
    for architecture in ARCHITECTURES {
        let template = toy_macho(architecture);
        assert_eq!(leaving_room(&template, 0).max_cuts(), free_slots);
        assert_eq!(leaving_room(&template, 2).max_cuts(), free_slots - 2);
        assert_eq!(leaving_room(&template, 6).max_cuts(), free_slots - 6);
        assert_eq!(leaving_room(&template, free_slots).capacity, no_cuts);
        assert_eq!(leaving_room(&template, free_slots + 1).capacity, no_cuts);
    }

    let payload = toy_payload(PAYLOAD_SIZE);
    let code = [code_at(3..5)];
    let with_six_slots = || {
        create_toy(ToyOptions {
            header_pad: 6 * BYTES_PER_CUT,
            ..LINKED_TOY
        })
    };
    let cuts: Vec<AddressRange> = (1..=5).map(|pair| cut(2 * pair, 2 * pair + 1)).collect();
    // As many cuts as the model allows beside the two segments of one image, and then the image.
    let mut template = with_six_slots();
    let mut image = ImageEditor::open(&mut template).unwrap();
    image.leave_room_for_segments(2);
    assert_eq!(image.cut_model().max_cuts(), 4);
    image.remove_ranges(&cuts[..4]).unwrap();
    let split = write(&template, &payload, &code).unwrap();
    assert_eq!(read_pieces(&split).len(), 3);
    assert_eq!(read_payload(&split), payload);

    // One cut more takes the room of the image. The model refuses it, and without the model the image has no room.
    let mut template = with_six_slots();
    let mut image = ImageEditor::open(&mut template).unwrap();
    image.leave_room_for_segments(2);
    assert!(image.remove_ranges(&cuts).is_err());
    let mut template = with_six_slots();
    remove_ranges(&mut template, &cuts).unwrap();
    let no_room = Err(MachoError::NoRoomForCodeSegments);
    assert_eq!(write(&template, &payload, &code), no_room);
}

#[test]
fn payload_of_cut_executable_is_split_at_its_code() {
    let payload = toy_payload(PAYLOAD_SIZE);
    let cuts = [cut(2, 4), cut(86, 90), cut(99, 101)];
    for architecture in ARCHITECTURES {
        let trimmed = remove_and_verify(&toy_macho(architecture), &cuts);
        let whole = write(&trimmed, &payload, &[]).unwrap();
        let split = write(&trimmed, &payload, &[code_at(3..5)]).unwrap();
        assert_eq!(read_pieces(&split).len(), 3);
        assert_eq!(read_payload(&split), payload);
        assert_eq!(
            fixups_segment_count(&split),
            fixups_segment_count(&whole) + 2
        );
        assert_eq!(unchanged_contents(&split), unchanged_contents(&whole));
        let names = read_segment_names(&split);
        let expected: [&[u8]; 5] = [b"__DATA", b"__BUN", b"__BUN.1", b"__BUN.2", b"__LINKEDIT"];
        assert_eq!(names[names.len() - 5..], expected);
    }
}

#[test]
fn payload_is_split_without_fixups_or_signature() {
    let payload = toy_payload(PAYLOAD_SIZE);
    let unsigned = ToyOptions {
        architecture: Architecture::X86_64,
        has_signature: false,
        ..LINKED_TOY
    };
    let without_fixups = ToyOptions {
        has_fixups: false,
        ..LINKED_TOY
    };
    let without_either = ToyOptions {
        has_fixups: false,
        ..unsigned
    };
    for options in [unsigned, without_fixups, without_either] {
        let template = create_toy(options);
        let whole = write(&template, &payload, &[]).unwrap();
        let split = write(&template, &payload, &[code_at(3..5)]).unwrap();
        let segments = payload_segments(&split);
        let protections: Vec<vm_prot_t> = segments
            .iter()
            .map(|segment| segment.command.initprot)
            .collect();
        assert_eq!(protections, [READ, READ_EXECUTE, READ]);
        if !options.has_fixups {
            assert_eq!(split.len(), whole.len());
        }
    }
}

#[test]
fn fixups_that_cannot_be_laid_out_again_refuse_code() {
    let payload = toy_payload(PAYLOAD_SIZE);
    let unsupported = Err(MachoError::CodeSegments(ImageError::UnsupportedFixups));
    let mut other_version = toy();
    edit_fixups_header(&mut other_version, |header| header.fixups_version = 1);
    assert!(write(&other_version, &payload, &[]).is_ok());
    assert_eq!(
        write(&other_version, &payload, &[code_at(3..5)]),
        unsupported
    );
}

#[cfg(not(windows))]
#[test]
fn mapped_template_is_split_like_a_vector() {
    use crate::mapped_file::tests::TemporaryFile;
    use crate::mapped_file::{FileBytes, MappedFile};

    let payload = toy_payload(PAYLOAD_SIZE);
    let code = [code_at(3..5)];
    for architecture in ARCHITECTURES {
        let template = toy_macho(architecture);
        let expected = write(&template, &payload, &code).unwrap();

        let template_file = TemporaryFile::create("split-template", &template);
        let output = TemporaryFile::create("split-output", &[]);
        let room = |size| MachoFile::room_for(size, payload.len(), 0);
        let mapped = MappedFile::open_with_room(&template_file.0, room).unwrap();
        let mut file = MachoFile::over(FileBytes::Mapping(mapped)).unwrap();
        file.write_section(&payload, true).unwrap();
        file.split_section_at_code(&code).unwrap();
        let flags = bun_sys::O::RDWR | bun_sys::O::CLOEXEC;
        let output_file = bun_sys::File::open(&output.0, flags, 0).unwrap();
        let written = file.build_and_sign_into(&output_file, false).unwrap();
        let mut signed = output.read();
        signed.truncate(written);
        assert!(signed == expected);
        assert!(template_file.read() == template);
    }
}

#[cfg(not(windows))]
#[test]
fn file_that_holds_executable_with_split_payload_gets_what_joining_the_payload_changes() {
    use crate::mapped_file::tests::TemporaryFile;
    use crate::mapped_file::{FileBytes, MappedFile};

    let template = write(&toy(), &toy_payload(PAYLOAD_SIZE), &[code_at(3..5)]).unwrap();
    let template_commands_end = HEADER_SIZE + parse(&template).unwrap().header.sizeofcmds as usize;
    let payload = toy_payload(PAGE as usize);
    let expected = write(&template, &payload, &[]).unwrap();

    let template_file = TemporaryFile::create("joined-template", &template);
    let output = TemporaryFile::create("joined-output", &template);
    let room = |size| MachoFile::room_for(size, payload.len(), 0);
    let mapped = MappedFile::open_with_room(&template_file.0, room).unwrap();
    let mut file = MachoFile::over(FileBytes::Mapping(mapped)).unwrap();
    file.write_section(&payload, false).unwrap();
    // Fewer load commands are left, and the file has the template's where they were.
    assert!(file.bytes_of_template().start >= template_commands_end);
    let flags = bun_sys::O::RDWR | bun_sys::O::CLOEXEC;
    let output_file = bun_sys::File::open(&output.0, flags, 0).unwrap();
    let written = file.build_and_sign_into(&output_file, true).unwrap();
    let mut signed = output.read();
    signed.truncate(written);
    assert!(signed == expected);
}
