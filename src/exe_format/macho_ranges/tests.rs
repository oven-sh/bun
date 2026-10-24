use bun_core::slice_to_nul;

use super::*;
use crate::cut_model::RemovableBytes;
use crate::image::{ImageEditor, KnownSection, SectionLocation};
use crate::macho::MachoFile;
use crate::macho_types::dyld_chained_fixups_header;

mod toy;

pub(crate) use toy::toy_macho;
use toy::{
    BSS_SECTION_INDEX, CSTRING_SECTION_INDEX, DATA_INDEX, HEADER_PAD, IMAGE_BASE, IMPORT_NAMES,
    LINKED_TOY, PAGE, PAGEZERO_INDEX, TEXT_INDEX, TEXT_SECTION_INDEX, TOY_IMPORTS,
    TOY_SECTION_COUNT, TRIM_TABLE_SECTION_INDEX, ToyOptions, create_toy, cut,
};

const UUID_COMMAND_SIZE: usize = 24;
const UNKNOWN_COMMAND: u32 = 0x7f;
const PAYLOAD: [u8; 0x5000] = [7; 0x5000];

fn toy() -> Vec<u8> {
    create_toy(LINKED_TOY)
}

fn command_offset(bytes: &[u8], cmd: u32) -> usize {
    let commands = parse(bytes).unwrap().commands;
    let mut starts = commands.iter().map(|(_, range)| range.start);
    let has_cmd = |start: &usize| read_struct::<u32>(&bytes[*start..]) == cmd;
    starts.find(has_cmd).unwrap()
}

fn segment_command_offset(bytes: &[u8], segment_index: usize) -> usize {
    let commands = parse(bytes).unwrap().commands;
    let mut segments = commands
        .iter()
        .filter(|(kind, _)| matches!(kind, CommandKind::Segment));
    segments.nth(segment_index).unwrap().1.start
}

fn edit_struct<T: Copy>(bytes: &mut [u8], offset: usize, edit: impl FnOnce(&mut T)) {
    let mut value: T = read_struct(&bytes[offset..]);
    edit(&mut value);
    write_struct(&mut bytes[offset..], &value);
}

fn edit_command<T: Copy>(bytes: &mut [u8], cmd: u32, edit: impl FnOnce(&mut T)) {
    let offset = command_offset(bytes, cmd);
    edit_struct(bytes, offset, edit);
}

fn retype_uuid_command(bytes: &mut [u8], cmd: u32) {
    edit_command(bytes, LC::UUID, |uuid: &mut load_command| uuid.cmd = cmd);
}

fn edit_segment(
    bytes: &mut [u8],
    segment_index: usize,
    edit: impl FnOnce(&mut segment_command_64),
) {
    let offset = segment_command_offset(bytes, segment_index);
    edit_struct(bytes, offset, edit);
}

fn edit_section(
    bytes: &mut [u8],
    segment_index: usize,
    section_index: usize,
    edit: impl FnOnce(&mut section_64),
) {
    let sections_offset = segment_command_offset(bytes, segment_index) + SEGMENT_COMMAND_SIZE;
    edit_struct(bytes, sections_offset + section_index * SECTION_SIZE, edit);
}

fn edit_fixups_header(bytes: &mut [u8], edit: impl FnOnce(&mut dyld_chained_fixups_header)) {
    let command: linkedit_data_command = read_command_of(bytes, LC::DYLD_CHAINED_FIXUPS).unwrap();
    edit_struct(bytes, command.dataoff as usize, edit);
}

fn read_command_of<T: Copy>(bytes: &[u8], cmd: u32) -> Option<T> {
    find_command(bytes, &parse(bytes).unwrap(), cmd).unwrap()
}

fn find_blob(bytes: &[u8], cmd: u32) -> Option<&[u8]> {
    let command: linkedit_data_command = read_command_of(bytes, cmd)?;
    Some(&bytes[command.dataoff as usize..][..command.datasize as usize])
}

fn read_symbols(bytes: &[u8]) -> Vec<nlist_64> {
    let table: symtab_command = read_command_of(bytes, LC::SYMTAB).unwrap();
    let symbols = &bytes[table.symoff as usize..][..SYMBOL_SIZE * table.nsyms as usize];
    symbols.chunks_exact(SYMBOL_SIZE).map(read_struct).collect()
}

fn read_sections(bytes: &[u8]) -> Vec<section_64> {
    let segments = parse(bytes).unwrap().segments;
    segments
        .into_iter()
        .flat_map(|segment| segment.sections)
        .collect()
}

fn read_segment_names(bytes: &[u8]) -> Vec<Vec<u8>> {
    let segments = parse(bytes).unwrap().segments;
    segments
        .iter()
        .map(|segment| segment.command.seg_name().to_vec())
        .collect()
}

fn read_addresses(bytes: &[u8], range: AddressRange) -> Option<&[u8]> {
    let spans = mapped_spans(bytes).unwrap();
    let span = spans.iter().find(|span| span.addresses.contains(range))?;
    let offset = (span.file_offset + (range.start - span.addresses.start)) as usize;
    bytes.get(offset..offset + range.len() as usize)
}

fn find_section(bytes: &[u8], section: KnownSection) -> SectionLocation {
    let mut bytes = bytes.to_vec();
    let image = ImageEditor::open(&mut bytes).unwrap();
    image.find_section(section).unwrap()
}

fn unchanged_contents(bytes: &[u8]) -> Vec<&[u8]> {
    let symbol_table: symtab_command = read_command_of(bytes, LC::SYMTAB).unwrap();
    let dynamic_symbol_table: dysymtab_command = read_command_of(bytes, LC::DYSYMTAB).unwrap();
    let indirect_symbols_size = size_of::<u32>() * dynamic_symbol_table.nindirectsyms as usize;
    let mut contents = vec![
        find_blob(bytes, LC::DYLD_EXPORTS_TRIE).unwrap(),
        find_blob(bytes, LC::FUNCTION_STARTS).unwrap(),
        &bytes[symbol_table.stroff as usize..][..symbol_table.strsize as usize],
        &bytes[dynamic_symbol_table.indirectsymoff as usize..][..indirect_symbols_size],
        &bytes[command_offset(bytes, LC::UUID)..][..UUID_COMMAND_SIZE],
    ];
    if let Some(fixups) = find_blob(bytes, LC::DYLD_CHAINED_FIXUPS) {
        let header: dyld_chained_fixups_header = read_struct(fixups);
        let imports_size = size_of::<u32>() * TOY_IMPORTS.len() + IMPORT_NAMES.len();
        contents.push(&fixups[header.imports_offset as usize..][..imports_size]);
    }
    contents
}

fn assert_retained_bytes(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let header_room_end = IMAGE_BASE + parse(original).unwrap().header_room_end as u64;
    for span in mapped_spans(original).unwrap() {
        for mut part in subtract_cuts(span.addresses, cuts) {
            part.start = part.start.max(header_room_end);
            let expected = read_addresses(original, part);
            assert!(expected.is_some());
            assert!(read_addresses(trimmed, part) == expected, "{part:#x?}");
        }
    }
    for address in cuts.iter().flat_map(|cut| [cut.start, cut.end - 1]) {
        let byte = AddressRange::from_size(address, 1).unwrap();
        assert!(read_addresses(trimmed, byte).is_none());
    }
}

fn assert_segments(original: &[u8], trimmed: &[u8]) {
    let (old, new) = (parse(original).unwrap(), parse(trimmed).unwrap());
    let mut piece_counts = vec![0; old.segments.len()];
    for segment in &new.segments {
        let command = &segment.command;
        let starts_before = |candidate: &Segment| candidate.command.vmaddr <= command.vmaddr;
        let old_index = old.segments.iter().rposition(starts_before).unwrap();
        let old_command = &old.segments[old_index].command;
        let name = create_piece_name(old_command.seg_name(), piece_counts[old_index]);
        piece_counts[old_index] += 1;
        assert_eq!(command.seg_name(), slice_to_nul(&name));
        assert_eq!(command.maxprot, old_command.maxprot);
        assert_eq!(command.initprot, old_command.initprot);
        assert_eq!(command.flags, old_command.flags);
        assert_eq!(command.fileoff % PAGE, 0);
    }
    let is_text = |segment: &&Segment| segment.command.seg_name() == b"__TEXT";
    let text_segments: Vec<&Segment> = new.segments.iter().filter(is_text).collect();
    assert_eq!(text_segments.len(), 1);
    assert_eq!(text_segments[0].command.fileoff, 0);
}

fn assert_sections(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let new_sections = read_sections(trimmed);
    let mut part_count = 0;
    for old in read_sections(original) {
        let is_part = |new: &&section_64| {
            new.sectname == old.sectname
                && new.segname == old.segname
                && section_addresses(&old).contains(section_addresses(new))
        };
        let parts = new_sections.iter().filter(is_part).map(section_addresses);
        let parts: Vec<AddressRange> = parts.collect();
        assert_eq!(parts, subtract_cuts(section_addresses(&old), cuts));
        part_count += parts.len();
    }
    assert_eq!(part_count, new_sections.len());
}

fn assert_symbols(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let new_sections = read_sections(trimmed);
    for (old_symbol, symbol) in read_symbols(original).iter().zip(read_symbols(trimmed)) {
        let address = AddressRange::from_size(symbol.n_value, 1).unwrap();
        let is_removed = cuts.iter().any(|cut| cut.contains(address));
        assert_eq!(symbol.n_value, old_symbol.n_value);
        if symbol.n_type & N_TYPE == N_SECT && !is_removed {
            let section = &new_sections[usize::from(symbol.n_sect) - 1];
            assert!(section_addresses(section).contains(address));
        }
    }
}

fn assert_known_sections(original: &[u8], trimmed: &[u8]) {
    for section in [KnownSection::TrimTable, KnownSection::RemovableFeatureState] {
        let old = find_section(original, section);
        let new = find_section(trimmed, section);
        let size = old.size as usize;
        assert_eq!((new.address, new.size), (old.address, old.size));
        let old_bytes = &original[old.file_offset as usize..][..size];
        assert!(&trimmed[new.file_offset as usize..][..size] == old_bytes);
    }
}

fn assert_signature_room(trimmed: &[u8]) {
    let Some(command) = read_command_of::<linkedit_data_command>(trimmed, LC::CODE_SIGNATURE)
    else {
        return;
    };
    let size = MachoSigner::compute_signature_size(u64::from(command.dataoff));
    assert_eq!(command.datasize as usize, size);
    assert_eq!(command.dataoff as usize + size, trimmed.len());
    assert!(
        trimmed[command.dataoff as usize..]
            .iter()
            .all(|byte| *byte == 0)
    );
}

fn assert_removal_can_be_planned(bytes: &[u8]) {
    let parsed = parse(bytes).unwrap();
    assert!(compute_capacity(bytes, &parsed).is_ok());
}

fn assert_no_cuts(bytes: &[u8], reason: NoCutReason) {
    let model = cut_model(bytes);
    assert_eq!(
        model,
        CutModel::without_cuts(ExecutableFormat::MachO, CUT_ALIGNMENT, reason)
    );
    assert_eq!(model.max_cuts(), 0);
}

fn assert_payload_writer_accepts(trimmed: &[u8]) {
    let mut signed = Vec::new();
    let mut file = MachoFile::init(trimmed, 0).unwrap();
    file.write_section(&PAYLOAD, false).unwrap();
    file.build_and_sign(&mut signed).unwrap();
    assert_removal_can_be_planned(&signed);
}

fn remove_and_verify(original: &[u8], cuts: &[AddressRange]) -> Vec<u8> {
    let mut trimmed = original.to_vec();
    let mut image = ImageEditor::open(&mut trimmed).unwrap();
    image.remove_ranges(cuts).unwrap();
    assert_retained_bytes(original, &trimmed, cuts);
    assert_segments(original, &trimmed);
    assert_sections(original, &trimmed, cuts);
    assert_symbols(original, &trimmed, cuts);
    assert_known_sections(original, &trimmed);
    assert_eq!(unchanged_contents(&trimmed), unchanged_contents(original));
    assert_signature_room(&trimmed);
    assert_removal_can_be_planned(&trimmed);
    assert_payload_writer_accepts(&trimmed);
    trimmed
}

fn count_sections(bytes: &[u8]) -> usize {
    read_sections(bytes).len()
}

#[test]
fn reads_toy_headers() {
    for target in [Architecture::X86_64, Architecture::Aarch64] {
        assert_eq!(architecture(&toy_macho(target)), Ok(target));
    }
    let spans = mapped_spans(&toy()).unwrap();
    let addresses: Vec<AddressRange> = spans.iter().map(|span| span.addresses).collect();
    let file_pages: Vec<u64> = spans.iter().map(|span| span.file_offset / PAGE).collect();
    let expected = [cut(0, 95), cut(95, 104), cut(104, 105), cut(106, 107)];
    assert_eq!(addresses, expected);
    assert_eq!(file_pages, [0, 95, 104, 105]);
    assert_eq!(count_sections(&toy()), TOY_SECTION_COUNT);

    let model = cut_model(&toy());
    assert_eq!(model.format, ExecutableFormat::MachO);
    assert_eq!(model.alignment, CUT_ALIGNMENT);
    assert_eq!(
        model.capacity,
        CutCapacity::Cuts(HEADER_PAD / BYTES_PER_CUT)
    );
    let small_pad = create_toy(ToyOptions {
        header_pad: 100,
        ..LINKED_TOY
    });
    assert_no_cuts(&small_pad, NoCutReason::HeaderRoomExhausted);
}

#[test]
fn cuttable_spans_leave_out_headers_and_unsplittable_sections() {
    let segments = parse(&toy()).unwrap().segments;
    let text_start = segments[TEXT_INDEX].sections[TEXT_SECTION_INDEX].addr;
    let bss_start = segments[DATA_INDEX].sections[BSS_SECTION_INDEX].addr;
    let expected = [
        AddressRange {
            start: text_start,
            ..cut(0, 95)
        },
        cut(96, 104),
        AddressRange {
            end: bss_start,
            ..cut(104, 105)
        },
        cut(106, 107),
    ];
    assert_eq!(cut_model(&toy()).cuttable_spans, expected);
}

#[test]
fn chosen_cuts_leave_one_read_only_segment() {
    let removable =
        [cut(2, 4), cut(97, 98), cut(99, 101), cut(102, 104)].map(|range| RemovableBytes {
            range,
            is_code: false,
            can_be_cut: true,
            can_be_filled: true,
        });
    for architecture in [Architecture::X86_64, Architecture::Aarch64] {
        let original = toy_macho(architecture);
        let model = cut_model(&original);
        assert_eq!(model.spans_cut_only_at_end, [cut(95, 104)]);
        let plan = model.choose(&removable);
        assert_eq!(plan.cuts, [cut(2, 4), cut(102, 104)]);
        let trimmed = remove_and_verify(&original, &plan.cuts);
        let segments = parse(&trimmed).unwrap().segments;
        let is_read_only = |segment: &&Segment| segment.command.flags & SG_READ_ONLY != 0;
        assert_eq!(segments.iter().filter(is_read_only).count(), 1);
    }
}

#[test]
fn cuttable_spans_hold_every_removable_page() {
    let original = toy();
    let spans = cut_model(&original).cuttable_spans;
    for index in 0..107 {
        let page = cut(index, index + 1);
        let is_cuttable = spans.iter().any(|span| span.contains(page));
        let is_removable = remove_ranges(&mut original.clone(), &[page]).is_ok();
        assert_eq!(is_cuttable, is_removable, "page {index}");
    }
}

#[test]
fn cuts_split_segments_and_sections() {
    let four_cuts = [cut(2, 4), cut(86, 90), cut(97, 98), cut(99, 101)];
    let cases: [(&[AddressRange], usize, usize); 4] = [
        (&[cut(3, 5)], 7, 12),
        (&[cut(88, 89)], 7, 11),
        (&[cut(100, 101)], 7, 12),
        (&four_cuts, 10, 14),
    ];
    for architecture in [Architecture::X86_64, Architecture::Aarch64] {
        for (cuts, segment_count, section_count) in cases {
            let trimmed = remove_and_verify(&toy_macho(architecture), cuts);
            assert_eq!(read_segment_names(&trimmed).len(), segment_count);
            assert_eq!(count_sections(&trimmed), section_count);
        }
    }
}

#[test]
fn pieces_take_segment_name() {
    let trimmed = remove_and_verify(&toy(), &[cut(2, 4), cut(86, 90), cut(99, 101)]);
    let expected: [&[u8]; 9] = [
        b"__PAGEZERO",
        b"__TEXT",
        b"__TEXT.1",
        b"__TEXT.2",
        b"__DATA_CONST",
        b"__DATA_CONST.1",
        b"__DATA",
        b"__BUN",
        b"__LINKEDIT",
    ];
    assert_eq!(read_segment_names(&trimmed), expected);
}

#[test]
fn second_removal_splits_pieces() {
    let (first, second) = (cut(3, 5), cut(8, 9));
    let once = remove_and_verify(&toy(), &[first]);
    let twice = remove_and_verify(&once, &[second]);
    assert_retained_bytes(&toy(), &twice, &[first, second]);
    assert_sections(&toy(), &twice, &[first, second]);
    let names = read_segment_names(&twice);
    let expected: [&[u8]; 3] = [b"__TEXT", b"__TEXT.1", b"__TEXT.1.1"];
    assert_eq!(names[TEXT_INDEX..][..3], expected);
}

#[test]
fn forty_cuts_grow_fixups() {
    let cuts: Vec<AddressRange> = (1..=40).map(|pair| cut(2 * pair, 2 * pair + 1)).collect();
    let fixups_size = |bytes: &[u8]| find_blob(bytes, LC::DYLD_CHAINED_FIXUPS).unwrap().len();
    let one_cut = remove_and_verify(&toy(), &cuts[..1]);
    assert_eq!(fixups_size(&one_cut), fixups_size(&toy()));
    let forty_cuts = remove_and_verify(&toy(), &cuts);
    assert_eq!(fixups_size(&forty_cuts), fixups_size(&toy()) + 160);
}

#[test]
fn removes_ranges_without_fixups_or_signature() {
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
    let cuts = [cut(3, 5), cut(100, 101)];
    for options in [unsigned, without_fixups, without_either] {
        let original = create_toy(options);
        assert_eq!(cut_model(&original).max_cuts(), HEADER_PAD / BYTES_PER_CUT);
        remove_and_verify(&original, &cuts);
    }
    let original = create_toy(without_either);
    let trimmed = remove_and_verify(&original, &cuts);
    assert_eq!(trimmed.len() + 3 * PAGE as usize, original.len());
}

#[test]
fn symbols_follow_dropped_section() {
    let symbols = read_symbols(&remove_and_verify(&toy(), &[cut(88, 93)]));
    let ordinals: Vec<u8> = symbols.iter().map(|symbol| symbol.n_sect).collect();
    assert_eq!(ordinals, [1, 1, 2, 7, 8, 0]);
}

#[test]
fn empty_section_inside_cut_is_dropped() {
    let mut original = toy();
    let make_empty = |section: &mut section_64| section.size = 0;
    edit_section(&mut original, TEXT_INDEX, CSTRING_SECTION_INDEX, make_empty);
    let count_after = |cut: AddressRange| {
        let mut trimmed = original.clone();
        remove_ranges(&mut trimmed, &[cut]).unwrap();
        count_sections(&trimmed)
    };
    assert_eq!(count_after(cut(88, 89)), TOY_SECTION_COUNT - 1);
    assert_eq!(count_after(cut(3, 5)), TOY_SECTION_COUNT + 1);
}

#[test]
fn piece_names_fit_sixteen_bytes() {
    let name = create_piece_name;
    assert_eq!(&name(b"__TEXT", 0), b"__TEXT\0\0\0\0\0\0\0\0\0\0");
    assert_eq!(&name(b"__TEXT", 2), b"__TEXT.2\0\0\0\0\0\0\0\0");
    assert_eq!(&name(b"__DATA_CONST", 100), b"__DATA_CONST.100");
    assert_eq!(&name(b"__DATA_CONST", 1000), b"__DATA_CONS.1000");
}

#[test]
fn rejects_unremovable_cuts() {
    let remove = |cut: AddressRange| remove_ranges(&mut toy(), &[cut]);
    assert_eq!(remove(cut(95, 96)), Err(ImageError::SectionCannotBeSplit));
    assert_eq!(remove(cut(104, 105)), Err(ImageError::SectionCannotBeSplit));
    assert_eq!(remove(cut(0, 1)), Err(ImageError::CutHoldsHeaders));
    assert_eq!(remove(cut(105, 106)), Err(ImageError::CutNotFileBacked));
}

#[test]
fn header_room_limits_cuts() {
    let original = create_toy(ToyOptions {
        header_pad: 2 * BYTES_PER_CUT,
        ..LINKED_TOY
    });
    let cuts = [cut(3, 4), cut(6, 7), cut(9, 10)];
    assert_eq!(cut_model(&original).max_cuts(), 2);
    let trimmed = remove_and_verify(&original, &cuts[..2]);
    assert_no_cuts(&trimmed, NoCutReason::HeaderRoomExhausted);
    let too_many = remove_ranges(&mut original.clone(), &cuts);
    assert_eq!(too_many, Err(ImageError::HeaderRoomExhausted));
}

#[test]
fn section_ordinals_limit_cuts() {
    let free_ordinals = 5;
    let original = create_toy(ToyOptions {
        filler_section_count: (MAX_SECTIONS - TOY_SECTION_COUNT - free_ordinals) as u64,
        ..LINKED_TOY
    });
    let cuts: Vec<AddressRange> = (2..8).map(|pair| cut(2 * pair, 2 * pair + 1)).collect();
    assert!(cuts.len() > free_ordinals && cuts.len() < HEADER_PAD / BYTES_PER_CUT);
    assert_eq!(cut_model(&original).max_cuts(), free_ordinals);

    let mut trimmed = original.clone();
    remove_ranges(&mut trimmed, &cuts[..free_ordinals]).unwrap();
    assert_eq!(count_sections(&trimmed), MAX_SECTIONS);
    assert_no_cuts(&trimmed, NoCutReason::HeaderRoomExhausted);
    let too_many = remove_ranges(&mut original.clone(), &cuts);
    assert_eq!(too_many, Err(ImageError::HeaderRoomExhausted));
}

#[test]
fn malformed_files_are_rejected() {
    let edits: [fn(&mut Vec<u8>); 7] = [
        |bytes| {
            edit_struct(bytes, 0, |header: &mut mach_header_64| {
                header.sizeofcmds = u32::MAX
            })
        },
        |bytes| edit_segment(bytes, PAGEZERO_INDEX, |segment| segment.cmdsize = 4),
        |bytes| edit_segment(bytes, TEXT_INDEX, |segment| segment.nsects += 1),
        |bytes| {
            let move_offset = |section: &mut section_64| section.offset += PAGE as u32;
            edit_section(bytes, TEXT_INDEX, TRIM_TABLE_SECTION_INDEX, move_offset);
        },
        |bytes| {
            let make_regular = |section: &mut section_64| section.flags = S_REGULAR;
            edit_section(bytes, DATA_INDEX, BSS_SECTION_INDEX, make_regular);
        },
        |bytes| {
            let leave_segment = |section: &mut section_64| section.size = 96 * PAGE;
            edit_section(bytes, TEXT_INDEX, TEXT_SECTION_INDEX, leave_segment);
        },
        |bytes| {
            let overflow = |section: &mut section_64| section.size = u64::MAX;
            edit_section(bytes, TEXT_INDEX, TEXT_SECTION_INDEX, overflow);
        },
    ];
    for edit in edits {
        let mut bytes = toy();
        edit(&mut bytes);
        assert_eq!(mapped_spans(&bytes), Err(ImageError::MalformedHeaders));
        assert_no_cuts(&bytes, NoCutReason::HeadersUnreadable);
        let result = remove_ranges(&mut bytes, &[cut(3, 5)]);
        assert_eq!(result, Err(ImageError::MalformedHeaders));
    }
}

#[test]
fn unsupported_files_have_no_cuts() {
    type DataCommand = linkedit_data_command;
    let cases: [(fn(&mut Vec<u8>), ImageError); 10] = [
        (
            |bytes| retype_uuid_command(bytes, UNKNOWN_COMMAND),
            ImageError::UnknownLoadCommand,
        ),
        (
            |bytes| retype_uuid_command(bytes, LC::DYLD_INFO_ONLY),
            ImageError::UnsupportedFixups,
        ),
        (
            |bytes| edit_fixups_header(bytes, |header| header.fixups_version = 1),
            ImageError::UnsupportedFixups,
        ),
        (
            |bytes| {
                let retype = |trie: &mut DataCommand| trie.cmd = LC::DYLD_CHAINED_FIXUPS;
                edit_command(bytes, LC::DYLD_EXPORTS_TRIE, retype);
            },
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| {
                edit_command(bytes, LC::SYMTAB, |table: &mut symtab_command| {
                    table.stroff = 8
                })
            },
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| {
                let leave_linkedit = |starts: &mut DataCommand| starts.dataoff = PAGE as u32;
                edit_command(bytes, LC::FUNCTION_STARTS, leave_linkedit);
            },
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| {
                let shorten = |signature: &mut DataCommand| signature.datasize -= 16;
                edit_command(bytes, LC::CODE_SIGNATURE, shorten);
            },
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| bytes.extend_from_slice(&[0; 16]),
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| {
                let add_relocation = |section: &mut section_64| section.nreloc = 1;
                edit_section(bytes, TEXT_INDEX, TEXT_SECTION_INDEX, add_relocation);
            },
            ImageError::MalformedHeaders,
        ),
        (
            |bytes| {
                let add_relocations_offset = |section: &mut section_64| section.reloff = 8;
                edit_section(
                    bytes,
                    TEXT_INDEX,
                    TEXT_SECTION_INDEX,
                    add_relocations_offset,
                );
            },
            ImageError::MalformedHeaders,
        ),
    ];
    for (edit, error) in cases {
        let mut bytes = toy();
        edit(&mut bytes);
        assert!(mapped_spans(&bytes).is_ok());
        assert_no_cuts(&bytes, NoCutReason::HeadersUnreadable);
        assert_eq!(remove_ranges(&mut bytes, &[cut(3, 5)]), Err(error));
    }
}

#[test]
fn payload_writer_rejects_unknown_command() {
    let mut template = toy();
    assert!(PAYLOAD.len() as u64 > find_section(&template, KnownSection::Payload).size);
    assert_payload_writer_accepts(&template);
    retype_uuid_command(&mut template, UNKNOWN_COMMAND);
    let mut file = MachoFile::init(&template, PAYLOAD.len()).unwrap();
    assert!(file.write_section(&PAYLOAD, false).is_err());
}
