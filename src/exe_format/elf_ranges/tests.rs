use bun_core::slice_to_nul;

use super::*;
pub(crate) use crate::elf_program_headers::tests::toy_elf;
use crate::elf_program_headers::tests::{
    BASE_ADDRESS, BUILD_ID_NOTE_SIZE, DATA_INDEX, DYNAMIC_INDEX, EHDR_SIZE, NOTE_HEADER_SIZE,
    NOTES_OFFSET, PHDR_SIZE, PT_DYNAMIC, RODATA_OFFSET, ROOM_CAPACITY, ROOM_OFFSET, STACK_INDEX,
    TEXT_INDEX, TOY_SEGMENT_COUNT, edit_header, edit_segment, edited, is_zero_at, segments_of_type,
};
use crate::elf_program_headers::{PAYLOAD_SEGMENT_COUNT, PT_NOTE, find_reserved_segment};

const PT_GNU_EH_FRAME: u32 = 0x6474_e550;
const SHT_DYNSYM: u32 = 11;

fn toy() -> Vec<u8> {
    toy_elf(Architecture::X86_64, true)
}

fn for_each_toy(check: impl Fn(&[u8])) {
    for architecture in [Architecture::X86_64, Architecture::Aarch64] {
        check(&toy_elf(architecture, true));
    }
}

fn sections(elf: &[u8]) -> Vec<Elf64_Shdr> {
    read_section_headers(elf, &read_header(elf).unwrap()).unwrap()
}

fn section_bytes<'a>(elf: &'a [u8], section: &Elf64_Shdr) -> &'a [u8] {
    bytes_at(elf, section.sh_offset, section.sh_size).unwrap()
}

fn section_name<'a>(elf: &'a [u8], section: &Elf64_Shdr) -> &'a [u8] {
    let names = sections(elf)[usize::from(read_ehdr(elf).e_shstrndx)];
    slice_to_nul(&section_bytes(elf, &names)[section.sh_name as usize..])
}

fn sections_named(elf: &[u8], name: &str) -> Vec<Elf64_Shdr> {
    let mut sections = sections(elf);
    sections.retain(|section| {
        section.sh_type != SHT_NULL && section_name(elf, section) == name.as_bytes()
    });
    sections
}

fn section_named(elf: &[u8], name: &str) -> Elf64_Shdr {
    sections_named(elf, name)[0]
}

fn edit_section(elf: &mut [u8], name: &str, edit: impl FnOnce(&mut Elf64_Shdr)) {
    let has_name = |section: &Elf64_Shdr| {
        section.sh_type != SHT_NULL && section_name(elf, section) == name.as_bytes()
    };
    let index = sections(elf).iter().position(has_name).unwrap();
    let offset = read_ehdr(elf).e_shoff as usize + index * SECTION_HEADER_SIZE;
    let mut section: Elf64_Shdr = read_struct(&elf[offset..]);
    edit(&mut section);
    write_struct(&mut elf[offset..], &section);
}

fn section_addresses(section: &Elf64_Shdr) -> AddressRange {
    AddressRange::from_size(section.sh_addr, section.sh_size).unwrap()
}

fn whole_pages(elf: &[u8], section_name: &str, pages: Range<u64>) -> AddressRange {
    let page_size = cut_model(elf).alignment;
    let first_page = align_up(section_named(elf, section_name).sh_addr, page_size);
    AddressRange {
        start: first_page + pages.start * page_size,
        end: first_page + pages.end * page_size,
    }
}

fn text_pages(elf: &[u8], pages: Range<u64>) -> AddressRange {
    whole_pages(elf, ".text", pages)
}

fn read_addresses(elf: &[u8], range: AddressRange) -> Option<&[u8]> {
    let spans = mapped_spans(elf).unwrap();
    let span = spans.iter().find(|span| span.addresses.contains(range))?;
    let offset = span.file_offset + (range.start - span.addresses.start);
    bytes_at(elf, offset, range.len())
}

fn sorted_addresses(sections: &[Elf64_Shdr], cuts: &[AddressRange]) -> Vec<AddressRange> {
    let mut addresses: Vec<AddressRange> = sections
        .iter()
        .flat_map(|section| subtract_cuts(section_addresses(section), cuts))
        .collect();
    addresses.sort_by_key(|range| range.start);
    addresses
}

fn assert_remove_error(elf: &[u8], cuts: &[AddressRange], expected: ImageError) {
    let mut bytes = elf.to_vec();
    assert_eq!(remove_ranges(&mut bytes, cuts), Err(expected));
    assert!(bytes == elf);
}

fn assert_no_cuts(elf: &[u8], alignment: u64, reason: NoCutReason) {
    let model = cut_model(elf);
    assert_eq!(
        model,
        CutModel::without_cuts(ExecutableFormat::Elf, alignment, reason)
    );
    assert_eq!(model.max_cuts(), 0);
}

fn is_cuttable(elf: &[u8], cut: AddressRange) -> bool {
    let spans = cut_model(elf).cuttable_spans;
    spans.iter().any(|span| span.contains(cut))
}

fn assert_retained_bytes(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    for span in mapped_spans(original).unwrap() {
        let compared = AddressRange {
            start: span.addresses.start.max(BASE_ADDRESS + RODATA_OFFSET),
            end: span.addresses.end,
        };
        for piece in subtract_cuts(compared, cuts) {
            let expected = read_addresses(original, piece);
            assert!(expected.is_some());
            assert!(read_addresses(trimmed, piece) == expected, "{piece:#x?}");
        }
    }
    for span in mapped_spans(trimmed).unwrap() {
        let AddressRange { start, end } = span.addresses;
        assert!(cuts.iter().all(|cut| cut.end <= start || end <= cut.start));
    }
}

fn assert_load_segments(elf: &[u8]) {
    let page_size = cut_model(elf).alignment;
    let loads = segments_of_type(elf, PT_LOAD);
    for pair in loads.windows(2) {
        assert!(pair[0].p_vaddr + pair[0].p_memsz <= pair[1].p_vaddr);
    }
    for load in &loads {
        assert!(is_congruent(load, page_size));
        assert!(is_congruent(load, load.p_align));
    }
    let bss = section_named(elf, ".bss").sh_addr;
    let data = loads
        .iter()
        .find(|load| load.p_vaddr <= bss && bss < load.p_vaddr + load.p_memsz)
        .unwrap();
    assert!(data.p_filesz < data.p_memsz);
}

fn pair_unsplit_segments(
    original: &[u8],
    trimmed: &[u8],
    p_type: u32,
) -> Vec<(Elf64_Phdr, Elf64_Phdr)> {
    let old_segments = segments_of_type(original, p_type);
    let new_segments = segments_of_type(trimmed, p_type);
    assert_eq!(new_segments.len(), old_segments.len());
    for (new, old) in new_segments.iter().zip(&old_segments) {
        assert_eq!(new.p_vaddr, old.p_vaddr);
        assert_eq!(new.p_filesz, old.p_filesz);
    }
    old_segments.into_iter().zip(new_segments).collect()
}

fn assert_dynamic_segment(original: &[u8], trimmed: &[u8]) {
    for (old, new) in pair_unsplit_segments(original, trimmed, PT_DYNAMIC) {
        let old_bytes = bytes_at(original, old.p_offset, old.p_filesz);
        let new_bytes = bytes_at(trimmed, new.p_offset, new.p_filesz);
        assert!(old_bytes.is_some() && new_bytes == old_bytes);
    }
}

fn assert_notes_outside_room(original: &[u8], trimmed: &[u8]) {
    for (old, new) in pair_unsplit_segments(original, trimmed, PT_NOTE) {
        let build_id_note = old.p_filesz - BUILD_ID_NOTE_SIZE;
        let extents = [(0, NOTE_HEADER_SIZE), (build_id_note, BUILD_ID_NOTE_SIZE)];
        for (distance, size) in extents {
            let old_bytes = bytes_at(original, old.p_offset + distance, size);
            let new_bytes = bytes_at(trimmed, new.p_offset + distance, size);
            assert!(old_bytes.is_some() && new_bytes == old_bytes);
        }
    }
}

fn assert_reserved_segment(trimmed: &[u8], cuts: &[AddressRange]) {
    let reserved = find_reserved_segment(trimmed).unwrap();
    let last_load = *segments_of_type(trimmed, PT_LOAD).last().unwrap();
    let image_end = last_load.p_vaddr + last_load.p_memsz;
    assert_eq!(
        reserved.address,
        align_up(image_end, cut_model(trimmed).alignment)
    );
    assert!(cuts.iter().all(|cut| cut.end <= reserved.address));
    assert_eq!(
        segments_of_type(trimmed, PT_BUN_RESERVED).len(),
        reserved.header_count
    );
    assert_eq!(reserved.header_count, PAYLOAD_SEGMENT_COUNT);
    assert!(segments_of_type(trimmed, PT_NULL).is_empty());

    let mut with_payload = trimmed.to_vec();
    let make_loadable = |segment: &mut Elf64_Phdr| segment.p_type = PT_LOAD;
    edit_segment(&mut with_payload, reserved.header_index, make_loadable);
    assert_load_segments(&with_payload);
}

fn assert_section_table(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let new_sections = sections(trimmed);
    let names = new_sections[usize::from(read_ehdr(trimmed).e_shstrndx)];
    assert_eq!(section_name(trimmed, &names), b".shstrtab");
    for (new, old) in new_sections.iter().zip(&sections(original)) {
        assert!(new.sh_type == SHT_NULL || new.sh_name == old.sh_name);
    }
    for name in [".rodata", ".bun_trim", ".text", ".data", ".bun"] {
        let pieces = sections_named(trimmed, name);
        let expected = sorted_addresses(&sections_named(original, name), cuts);
        assert_eq!(sorted_addresses(&pieces, &[]), expected, "{name}");
        for piece in &pieces {
            let mapped = read_addresses(trimmed, section_addresses(piece));
            assert!(mapped == Some(section_bytes(trimmed, piece)), "{name}");
        }
    }
    let old_comment = section_named(original, ".comment");
    let new_comment = section_named(trimmed, ".comment");
    let comment = section_bytes(original, &old_comment);
    assert_eq!(section_bytes(trimmed, &new_comment), comment);
}

fn assert_table_at(elf: &[u8], file_offset: u64) {
    let ehdr = read_header(elf).unwrap();
    let size = u64::from(ehdr.e_phnum) * PHDR_SIZE;
    let table_segment = segments_of_type(elf, PT_PHDR)[0];
    assert_eq!(ehdr.e_phoff, file_offset);
    assert_eq!(table_segment.p_offset, file_offset);
    assert_eq!(table_segment.p_vaddr, BASE_ADDRESS + file_offset);
    assert_eq!(table_segment.p_paddr, BASE_ADDRESS + file_offset);
    assert_eq!(table_segment.p_filesz, size);
    assert_eq!(table_segment.p_memsz, size);
}

fn remove_and_verify(original: &[u8], cuts: &[AddressRange]) -> Vec<u8> {
    assert!(cuts.iter().all(|cut| is_cuttable(original, *cut)));
    let mut trimmed = original.to_vec();
    remove_ranges(&mut trimmed, cuts).unwrap();
    assert_retained_bytes(original, &trimmed, cuts);
    assert_load_segments(&trimmed);
    assert_dynamic_segment(original, &trimmed);
    assert_notes_outside_room(original, &trimmed);
    assert_reserved_segment(&trimmed, cuts);
    assert_section_table(original, &trimmed, cuts);
    assert_eq!(read_ehdr(&trimmed).e_entry, read_ehdr(original).e_entry);
    trimmed
}

fn remove_from_linked_toy(original: &[u8], cuts: &[AddressRange]) -> Vec<u8> {
    let trimmed = remove_and_verify(original, cuts);
    assert_table_at(&trimmed, ROOM_OFFSET);
    assert!(is_zero_at(&trimmed, EHDR_SIZE, NOTES_OFFSET - EHDR_SIZE));

    let removed_size: u64 = cuts.iter().map(|cut| cut.len()).sum();
    let added_sections = sections(&trimmed).len() - sections(original).len();
    let old_size = (original.len() + added_sections * SECTION_HEADER_SIZE) as u64;
    assert_eq!(trimmed.len() as u64 + removed_size, old_size);
    trimmed
}

#[test]
fn reads_toy_headers() {
    let riscv = edited(&toy(), |elf| edit_header(elf, |ehdr| ehdr.e_machine = 243));
    let error = architecture(&read_header(&riscv).unwrap()).err();
    assert_eq!(error, Some(ImageError::UnrecognizedExecutable));

    let targets = [
        (Architecture::X86_64, 0x1000),
        (Architecture::Aarch64, 0x1_0000),
    ];
    for (target, alignment) in targets {
        let elf = toy_elf(target, true);
        let model = cut_model(&elf);
        let max_cuts = ROOM_CAPACITY - TOY_SEGMENT_COUNT as usize - PAYLOAD_SEGMENT_COUNT;
        assert_eq!(architecture(&read_header(&elf).unwrap()), Ok(target));
        assert_eq!(model.format, ExecutableFormat::Elf);
        assert_eq!(model.alignment, alignment);
        assert_eq!(model.capacity, CutCapacity::Cuts(max_cuts));

        let spans = mapped_spans(&elf).unwrap();
        let text = section_named(&elf, ".text");
        assert_eq!(spans.len(), 3);
        assert_eq!(spans[0].addresses.start, BASE_ADDRESS);
        assert_eq!(spans[0].file_offset, 0);
        assert_eq!(spans[1].addresses, section_addresses(&text));
        assert_eq!(spans[1].file_offset, text.sh_offset);
        assert_ne!(text.sh_addr % alignment, 0);
        assert_load_segments(&elf);
    }
}

#[test]
fn cuttable_spans_leave_out_headers_notes_and_writable_segments() {
    for_each_toy(|elf| {
        let read_only = AddressRange {
            start: section_addresses(&section_named(elf, ".note.gnu.build-id")).end,
            end: section_addresses(&section_named(elf, ".bun_features")).end,
        };
        let text = section_addresses(&section_named(elf, ".text"));
        assert_eq!(cut_model(elf).cuttable_spans, [read_only, text]);
    });
}

#[test]
fn cuttable_spans_hold_every_removable_page() {
    for_each_toy(|elf| {
        let model = cut_model(elf);
        let last_load = *segments_of_type(elf, PT_LOAD).last().unwrap();
        let image_end = last_load.p_vaddr + last_load.p_memsz;
        for start in (BASE_ADDRESS..image_end).step_by(model.alignment as usize) {
            let end = start + model.alignment;
            let page = AddressRange { start, end };
            let is_cuttable = model.cuttable_spans.iter().any(|span| span.contains(page));
            let is_removable = remove_ranges(&mut elf.to_vec(), &[page]).is_ok();
            assert_eq!(is_cuttable, is_removable, "{page:#x?}");
        }
    });
}

#[test]
fn cut_in_middle_of_text() {
    for_each_toy(|original| {
        let trimmed = remove_from_linked_toy(original, &[text_pages(original, 2..4)]);
        assert_eq!(segments_of_type(&trimmed, PT_LOAD).len(), 4);
        assert_eq!(sections_named(&trimmed, ".text").len(), 2);
        assert_eq!(sections(&trimmed).len(), sections(original).len() + 1);
    });
}

#[test]
fn cut_at_first_whole_page_of_text() {
    for_each_toy(|original| {
        let cut = text_pages(original, 0..1);
        let trimmed = remove_from_linked_toy(original, &[cut]);
        let first_piece = segments_of_type(&trimmed, PT_LOAD)[1];
        assert_eq!(
            first_piece.p_vaddr,
            section_named(original, ".text").sh_addr
        );
        assert_eq!(first_piece.p_vaddr + first_piece.p_memsz, cut.start);
    });
}

#[test]
fn cut_ending_at_last_whole_page_of_rodata() {
    for_each_toy(|original| {
        let cut = whole_pages(original, ".rodata", 5..7);
        let rodata_end = section_addresses(&section_named(original, ".rodata")).end;
        assert!(rodata_end - cut.end < cut_model(original).alignment);
        let trimmed = remove_from_linked_toy(original, &[cut]);
        assert_eq!(segments_of_type(&trimmed, PT_LOAD).len(), 4);
        assert_eq!(sections_named(&trimmed, ".rodata").len(), 2);
    });
}

#[test]
fn three_cuts_in_two_segments() {
    for_each_toy(|original| {
        let cuts = [
            whole_pages(original, ".rodata", 1..2),
            text_pages(original, 0..1),
            text_pages(original, 3..6),
        ];
        let trimmed = remove_from_linked_toy(original, &cuts);
        assert_eq!(segments_of_type(&trimmed, PT_LOAD).len(), 6);
        assert_eq!(sections_named(&trimmed, ".text").len(), 3);
    });
}

#[test]
fn no_cuts_change_nothing() {
    let mut elf = toy();
    assert_eq!(remove_ranges(&mut elf, &[]), Ok(()));
    assert!(elf == toy());
}

#[test]
fn reserves_payload_segments_without_cuts() {
    for_each_toy(|original| {
        let mut reserved = original.to_vec();
        assert_eq!(reserve_payload_segments(&mut reserved), Ok(true));
        assert_eq!(reserved.len(), original.len());
        assert_retained_bytes(original, &reserved, &[]);
        assert_load_segments(&reserved);
        assert_dynamic_segment(original, &reserved);
        assert_notes_outside_room(original, &reserved);
        assert_reserved_segment(&reserved, &[]);
        assert_section_table(original, &reserved, &[]);
        assert_table_at(&reserved, ROOM_OFFSET);
        assert_eq!(
            find_reserved_segment(&reserved).unwrap().header_count,
            PAYLOAD_SEGMENT_COUNT
        );

        let once = reserved.clone();
        assert_eq!(reserve_payload_segments(&mut reserved), Ok(true));
        assert!(reserved == once);
    });
}

#[test]
fn table_without_room_reserves_nothing() {
    let original = toy_elf(Architecture::X86_64, false);
    let mut elf = original.clone();
    assert_eq!(reserve_payload_segments(&mut elf), Ok(false));
    assert!(elf == original);
}

#[test]
fn reserved_segment_lies_past_image() {
    let original = toy();
    let last_load = *segments_of_type(&original, PT_LOAD).last().unwrap();
    let image_end = last_load.p_vaddr + last_load.p_memsz;
    let first_free_page = align_up(image_end, cut_model(&original).alignment);
    let short = whole_pages(&original, ".rodata", 1..2);
    let long = text_pages(&original, 1..4);
    for cuts in [&[short][..], &[long][..], &[short, long][..]] {
        let trimmed = remove_and_verify(&original, cuts);
        assert_eq!(
            find_reserved_segment(&trimmed).unwrap().address,
            first_free_page
        );
    }
}

#[test]
fn second_call_replaces_reserved_segment() {
    let original = toy();
    let first = text_pages(&original, 1..2);
    let second = text_pages(&original, 3..6);
    let once = remove_and_verify(&original, &[first]);
    assert_eq!(
        cut_model(&once).max_cuts(),
        cut_model(&original).max_cuts() - 1
    );

    let twice = remove_and_verify(&once, &[second]);
    assert_retained_bytes(&original, &twice, &[first, second]);
    assert_table_at(&twice, ROOM_OFFSET);
    let reserved_address = |elf: &[u8]| find_reserved_segment(elf).unwrap().address;
    assert_eq!(reserved_address(&twice), reserved_address(&once));
    assert_eq!(segments_of_type(&twice, PT_LOAD).len(), 5);
}

#[test]
fn payload_writer_accepts_trimmed_file() {
    for_each_toy(|original| {
        let cut = text_pages(original, 1..5);
        let trimmed = remove_and_verify(original, &[cut]);
        let reserved = find_reserved_segment(&trimmed).unwrap();
        let mut file = ElfFile::init(trimmed).unwrap();
        file.write_bun_section(b"payload").unwrap();
        assert_eq!(find_reserved_segment(&file.data), None);
        assert_eq!(section_named(&file.data, ".bun").sh_addr, reserved.address);
        assert_load_segments(&file.data);
    });
}

#[test]
fn invalid_cuts_fail() {
    for_each_toy(|elf| {
        let first_page = AddressRange {
            start: BASE_ADDRESS,
            end: BASE_ADDRESS + cut_model(elf).alignment,
        };
        let data_page = whole_pages(elf, ".data", 0..1);
        let bss_page = whole_pages(elf, ".bss", 0..1);
        assert_remove_error(elf, &[first_page], ImageError::CutHoldsHeaders);
        assert_remove_error(elf, &[data_page], ImageError::CutInWritableSegment);
        assert_remove_error(elf, &[bss_page], ImageError::CutNotFileBacked);
        for cut in [first_page, data_page, bss_page] {
            assert!(!is_cuttable(elf, cut));
        }
    });
}

#[test]
fn cut_over_unsplit_segment_fails() {
    let mut original = toy();
    let cut = whole_pages(&original, ".rodata", 3..4);
    edit_segment(&mut original, STACK_INDEX, |segment| {
        segment.p_type = PT_GNU_EH_FRAME;
        segment.p_offset = cut.end - BASE_ADDRESS - 8;
        segment.p_vaddr = cut.end - 8;
        segment.p_filesz = 16;
    });
    assert_remove_error(&original, &[cut], ImageError::CutHoldsHeaders);
    assert!(!is_cuttable(&original, cut));
    remove_and_verify(&original, &[whole_pages(&original, ".rodata", 5..6)]);
}

#[test]
fn table_without_room_for_the_payload_has_no_cuts() {
    let mut original = toy_elf(Architecture::X86_64, false);
    let cut = text_pages(&original, 2..4);
    assert_no_cuts(&original, 0x1000, NoCutReason::HeaderRoomExhausted);
    assert_remove_error(&original, &[cut], ImageError::HeaderRoomExhausted);

    for index in [DYNAMIC_INDEX, STACK_INDEX] {
        edit_segment(&mut original, index, |segment| {
            *segment = Elf64_Phdr::ZEROED
        });
    }
    assert_no_cuts(&original, 0x1000, NoCutReason::HeaderRoomExhausted);
    assert_remove_error(&original, &[cut], ImageError::HeaderRoomExhausted);
}

#[test]
fn previous_table_after_cuts_is_cleared() {
    let mut original = toy();
    let appended_table_offset = original.len() as u64;
    original.extend_from_within(EHDR_SIZE as usize..NOTES_OFFSET as usize);
    edit_header(&mut original, |ehdr| ehdr.e_phoff = appended_table_offset);

    let cut = text_pages(&original, 2..4);
    let trimmed = remove_and_verify(&original, &[cut]);
    let moved_table_offset = appended_table_offset - cut.len();
    assert_table_at(&trimmed, ROOM_OFFSET);
    assert!(is_zero_at(
        &trimmed,
        moved_table_offset,
        NOTES_OFFSET - EHDR_SIZE
    ));
}

#[test]
fn malformed_files_leave_no_cuts() {
    let cut = text_pages(&toy(), 2..4);
    let elf = edited(&toy(), |elf| edit_header(elf, |ehdr| ehdr.e_phentsize = 32));
    assert_eq!(mapped_spans(&elf), Err(ImageError::MalformedHeaders));
    assert_no_cuts(
        &elf,
        UNREADABLE_FILE_ALIGNMENT,
        NoCutReason::HeadersUnreadable,
    );
    assert_no_cuts(
        &elf[..63],
        UNREADABLE_FILE_ALIGNMENT,
        NoCutReason::HeadersUnreadable,
    );
    assert_remove_error(&elf, &[cut], ImageError::MalformedHeaders);

    let mut misaligned = toy();
    edit_segment(&mut misaligned, TEXT_INDEX, |segment| segment.p_offset += 8);
    assert_no_cuts(&misaligned, 0x1000, NoCutReason::SegmentsNotCongruent);
}

#[test]
fn overflowing_section_addresses_leave_no_cuts() {
    let mut elf = toy_elf(Architecture::Aarch64, true);
    edit_section(&mut elf, ".dynamic", |section| section.sh_size = u64::MAX);
    assert_no_cuts(&elf, 0x1_0000, NoCutReason::HeadersUnreadable);
}

#[test]
fn malformed_segments_are_errors() {
    let cut = text_pages(&toy(), 2..4);
    let edits: [(usize, fn(&mut Elf64_Phdr)); 3] = [
        (DATA_INDEX, |segment| segment.p_memsz = u64::MAX),
        (TEXT_INDEX, |segment| segment.p_offset += 0x10_0000),
        (TEXT_INDEX, |segment| segment.p_offset = 0x1800),
    ];
    for (index, edit) in edits {
        let elf = edited(&toy(), |elf| edit_segment(elf, index, edit));
        assert_remove_error(&elf, &[cut], ImageError::MalformedHeaders);
    }
}

#[test]
fn segment_alignment_follows_moved_offset() {
    let mut original = toy();
    edit_segment(&mut original, DATA_INDEX, |segment| {
        segment.p_align = 0x2000
    });
    assert_load_segments(&original);
    let find_data_alignment = |pages: Range<u64>| {
        let trimmed = remove_and_verify(&original, &[text_pages(&original, pages)]);
        segments_of_type(&trimmed, PT_LOAD).last().unwrap().p_align
    };
    assert_eq!(find_data_alignment(2..3), 0x1000);
    assert_eq!(find_data_alignment(2..4), 0x2000);
}

#[test]
fn section_inside_cut_becomes_null() {
    let original = toy();
    let builtins = section_named(&original, ".bun_builtins");
    let start = builtins.sh_addr - builtins.sh_addr % 0x1000;
    let end = start + 0x1000;
    let cut = AddressRange { start, end };
    assert!(cut.contains(section_addresses(&builtins)));
    let index = sections(&original)
        .iter()
        .position(|section| section.sh_name == builtins.sh_name)
        .unwrap();

    let trimmed = remove_from_linked_toy(&original, &[cut]);
    let header_offset = read_ehdr(&trimmed).e_shoff + (index * SECTION_HEADER_SIZE) as u64;
    assert!(is_zero_at(
        &trimmed,
        header_offset,
        SECTION_HEADER_SIZE as u64
    ));
    assert_eq!(sections(&trimmed).len(), sections(&original).len());
    assert_eq!(section_named(&trimmed, ".bun_trim").sh_addr, cut.end);
}

#[test]
fn cut_in_structured_section_fails() {
    let retype = |name: &str| {
        edited(&toy(), |elf| {
            edit_section(elf, name, |section| section.sh_type = SHT_DYNSYM)
        })
    };
    let split = retype(".rodata");
    let cut = whole_pages(&split, ".rodata", 3..4);
    assert_remove_error(&split, &[cut], ImageError::SectionCannotBeSplit);
    assert!(!is_cuttable(&split, cut));

    let dropped = retype(".bun_builtins");
    let builtins = section_addresses(&section_named(&dropped, ".bun_builtins"));
    let start = builtins.start - builtins.start % 0x1000;
    let end = start + 0x1000;
    let cut = AddressRange { start, end };
    assert!(cut.contains(builtins));
    assert_remove_error(&dropped, &[cut], ImageError::SectionCannotBeSplit);
    assert!(!is_cuttable(&dropped, cut));
    remove_and_verify(&dropped, &[text_pages(&dropped, 2..4)]);
}

#[test]
fn too_many_section_headers_fail() {
    let original = toy();
    let cuts = [text_pages(&original, 2..4)];
    let ehdr = read_header(&original).unwrap();
    let table = ProgramHeaderTable::read(&original, &ehdr).unwrap();
    let removal = Removal {
        cuts: &cuts,
        file_ranges: find_removed_file_ranges(&table, &cuts, original.len() as u64).unwrap(),
        alignment: cut_model(&original).alignment,
    };
    let text = section_named(&original, ".text");
    let count_updated_headers = |section_count: usize| {
        let updated = removal.update_section_headers(&vec![text; section_count]);
        updated.map(|headers| headers.len())
    };
    assert_eq!(
        count_updated_headers(SHN_LORESERVE / 2 - 1),
        Ok(SHN_LORESERVE - 2)
    );
    let too_many = count_updated_headers(SHN_LORESERVE / 2);
    assert_eq!(too_many, Err(ImageError::HeaderRoomExhausted));
}

#[test]
fn file_without_section_headers_allows_no_cuts() {
    let mut elf = toy();
    let cut = text_pages(&elf, 2..4);
    assert!(cut_model(&elf).max_cuts() > 0);
    edit_header(&mut elf, |ehdr| {
        ehdr.e_shoff = 0;
        ehdr.e_shnum = 0;
        ehdr.e_shstrndx = 0;
    });
    assert_no_cuts(&elf, 0x1000, NoCutReason::SectionHeadersMissing);
    assert_remove_error(&elf, &[cut], ImageError::SectionCannotBeSplit);
    assert_eq!(mapped_spans(&elf), mapped_spans(&toy()));
}

#[test]
fn section_table_before_end_of_file() {
    let mut original = toy();
    original.extend_from_slice(&[0xaa; 12]);
    let cut = text_pages(&original, 2..4);
    let trimmed = remove_and_verify(&original, &[cut]);

    let old_ehdr = read_ehdr(&original);
    let old_table_size = u64::from(old_ehdr.e_shnum) * SECTION_HEADER_SIZE as u64;
    let old_end = original.len() as u64 - cut.len();
    assert!(is_zero_at(
        &trimmed,
        old_ehdr.e_shoff - cut.len(),
        old_table_size
    ));
    assert_eq!(bytes_at(&trimmed, old_end - 12, 12), Some(&[0xaa; 12][..]));

    let new_ehdr = read_ehdr(&trimmed);
    let new_table_size = u64::from(new_ehdr.e_shnum) * SECTION_HEADER_SIZE as u64;
    assert_eq!(new_ehdr.e_shoff, align_up(old_end, SECTION_TABLE_ALIGNMENT));
    assert_eq!(trimmed.len() as u64, new_ehdr.e_shoff + new_table_size);
}
