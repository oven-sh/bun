use super::*;
use crate::elf_program_headers::tests::toy_byte;

const PE_HEADER_OFFSET: usize = size_of::<pe::DOSHeader>();
const OPTIONAL_HEADER_OFFSET: usize = PE_HEADER_OFFSET + size_of::<PEHeader>();
const SECTION_TABLE_OFFSET: usize = OPTIONAL_HEADER_OFFSET + size_of::<OptionalHeader64>();
const PAGE: u32 = 0x1000;
const FILE_ALIGNMENT: u32 = 512;
const TOY_SIZE_OF_HEADERS: u32 = 0x400;
const TOY_MAX_CUTS: usize = 43;
const TEXT_ADDRESS: u32 = 0x1000;
const ENTRY_POINT: u32 = TEXT_ADDRESS + 0x10;
const RDATA_ADDRESS: u32 = 0x9000;
const DATA_ADDRESS: u32 = 0x11000;
const BUILTINS_ADDRESS: u32 = 0x14000;
const TRIM_TABLE_INDEX: usize = 4;
const TRIM_TABLE_ADDRESS: u32 = 0x1c000;
const RELOC_ADDRESS: u32 = 0x1e000;
const DEBUG_DIRECTORY_ADDRESS: u32 = RDATA_ADDRESS + 0x40;
const DEBUG_POINTER_ADDRESS: u32 = DEBUG_DIRECTORY_ADDRESS + DEBUG_ENTRY_POINTER_TO_RAW_DATA as u32;
const DEBUG_ENTRY_TYPE: usize = 12;
const IMAGE_DEBUG_TYPE_CODEVIEW: u32 = 2;
const CODEVIEW_ADDRESS: u32 = RDATA_ADDRESS + 0x100;
const CODEVIEW_SIZE: u32 = 24;
const CODE: u32 = 0x6000_0020;
const READ_ONLY: u32 = 0x4000_0040;
const WRITABLE: u32 = 0xc000_0040;
const IMAGE_SCN_MEM_MASK: u32 = 0xfe00_0000;
const RELOCATION_BLOCK_SIZE: u32 = 12;

fn toy_section(name: &[u8], virtual_size: u32, raw_size: u32, flags: u32) -> SectionHeader {
    let mut header = SectionHeader {
        virtual_size,
        size_of_raw_data: raw_size,
        characteristics: flags,
        ..read_struct(&[0; size_of::<SectionHeader>()])
    };
    header.name[..name.len()].copy_from_slice(name);
    header
}

fn edit_struct<T: Copy>(bytes: &mut [u8], offset: usize, edit: impl FnOnce(&mut T)) {
    let mut value: T = read_struct(&bytes[offset..]);
    edit(&mut value);
    write_struct(&mut bytes[offset..], &value);
}

pub(crate) fn edit_dos_header(bytes: &mut [u8], edit: impl FnOnce(&mut pe::DOSHeader)) {
    edit_struct(bytes, 0, edit);
}

pub(crate) fn edit_pe_header(bytes: &mut [u8], edit: impl FnOnce(&mut PEHeader)) {
    edit_struct(bytes, PE_HEADER_OFFSET, edit);
}

pub(crate) fn edit_optional(bytes: &mut [u8], edit: impl FnOnce(&mut OptionalHeader64)) {
    edit_struct(bytes, OPTIONAL_HEADER_OFFSET, edit);
}

pub(crate) fn edit_section(bytes: &mut [u8], index: usize, edit: impl FnOnce(&mut SectionHeader)) {
    let offset = SECTION_TABLE_OFFSET + index * size_of::<SectionHeader>();
    edit_struct(bytes, offset, edit);
}

fn assemble_pe(machine: u16, sections: &[SectionHeader], size_of_headers: u32) -> Vec<u8> {
    let mut bytes = vec![0u8; size_of_headers as usize];
    let mut address = align_up_u32(size_of_headers, PAGE).unwrap();
    for (index, section) in sections.iter().enumerate() {
        let pointer_to_raw_data = bytes.len() as u32;
        edit_section(&mut bytes, index, |header| {
            *header = SectionHeader {
                virtual_address: address,
                pointer_to_raw_data,
                ..*section
            };
        });
        let raw_data = widen_address_range(address, section.size_of_raw_data);
        bytes.extend((raw_data.start..raw_data.end).map(toy_byte));
        address += align_up_u32(section.virtual_size, PAGE).unwrap();
    }
    edit_dos_header(&mut bytes, |header| {
        header.e_magic = 0x5a4d;
        header.e_lfanew = PE_HEADER_OFFSET as u32;
    });
    edit_pe_header(&mut bytes, |header| {
        header.signature = pe::PE_SIGNATURE;
        header.machine = machine;
        header.number_of_sections = sections.len() as u16;
        header.size_of_optional_header = size_of::<OptionalHeader64>() as u16;
    });
    edit_optional(&mut bytes, |optional| {
        optional.magic = 0x020b;
        optional.address_of_entry_point = ENTRY_POINT;
        optional.section_alignment = PAGE;
        optional.file_alignment = FILE_ALIGNMENT;
        optional.size_of_image = address;
        optional.size_of_headers = size_of_headers;
        optional.number_of_rva_and_sizes = 16;
    });
    bytes
}

fn mapped_file_range(bytes: &[u8], range: AddressRange) -> Option<Range<usize>> {
    let spans = mapped_spans(bytes).unwrap();
    let span = spans.iter().find(|span| span.addresses.contains(range))?;
    let start = (span.file_offset + (range.start - span.addresses.start)) as usize;
    Some(start..start + range.len() as usize)
}

fn read_addresses(bytes: &[u8], range: AddressRange) -> Option<&[u8]> {
    Some(&bytes[mapped_file_range(bytes, range)?])
}

fn write_at_address(bytes: &mut [u8], address: u32, value: &[u8]) {
    let addresses = widen_address_range(address, value.len() as u32);
    let range = mapped_file_range(bytes, addresses).unwrap();
    bytes[range].copy_from_slice(value);
}

fn set_debug_data_address(bytes: &mut [u8], address: u32) {
    let field = DEBUG_DIRECTORY_ADDRESS + DEBUG_ENTRY_ADDRESS_OF_RAW_DATA as u32;
    write_at_address(bytes, field, &address.to_le_bytes());
}

fn toy_relocation_blocks() -> Vec<u8> {
    let rdata_pages = (0..8).map(|page| RDATA_ADDRESS + page * PAGE);
    let data_pages = (0..3).map(|page| DATA_ADDRESS + page * PAGE);
    let mut blocks = Vec::new();
    for page in rdata_pages.chain(data_pages) {
        blocks.extend_from_slice(&page.to_le_bytes());
        blocks.extend_from_slice(&RELOCATION_BLOCK_SIZE.to_le_bytes());
        blocks.extend_from_slice(&[0x08, 0xa0, 0x10, 0xa0]);
    }
    blocks
}

fn write_toy_debug_directory(bytes: &mut [u8]) {
    let record = widen_address_range(CODEVIEW_ADDRESS, CODEVIEW_SIZE);
    let pointer = mapped_file_range(bytes, record).unwrap().start as u32;
    let mut entry = [0u8; DEBUG_DIRECTORY_ENTRY_SIZE];
    write_u32_at(&mut entry, DEBUG_ENTRY_TYPE, IMAGE_DEBUG_TYPE_CODEVIEW);
    write_u32_at(&mut entry, DEBUG_ENTRY_SIZE_OF_DATA, CODEVIEW_SIZE);
    write_u32_at(&mut entry, DEBUG_ENTRY_POINTER_TO_RAW_DATA, pointer);
    write_at_address(bytes, DEBUG_DIRECTORY_ADDRESS, &entry);
    set_debug_data_address(bytes, CODEVIEW_ADDRESS);
    write_at_address(bytes, CODEVIEW_ADDRESS, b"RSDS");
}

pub(crate) fn toy_pe(architecture: Architecture) -> Vec<u8> {
    let machine = match architecture {
        Architecture::X86_64 => IMAGE_FILE_MACHINE_AMD64,
        Architecture::Aarch64 => IMAGE_FILE_MACHINE_ARM64,
    };
    let relocations = toy_relocation_blocks();
    let reloc_size = relocations.len() as u32;
    let sections = [
        toy_section(b".text", 8 * PAGE, 8 * PAGE, CODE),
        toy_section(b".rdata", 8 * PAGE, 8 * PAGE, READ_ONLY),
        toy_section(b".data", 2 * PAGE + 0x800, PAGE, WRITABLE),
        toy_section(b".bunblt", 8 * PAGE, 8 * PAGE, READ_ONLY),
        toy_section(b".buntrim", PAGE, PAGE, READ_ONLY),
        toy_section(b".bunfeat", PAGE, PAGE, READ_ONLY),
        toy_section(b".reloc", reloc_size, FILE_ALIGNMENT, READ_ONLY),
    ];
    let mut bytes = assemble_pe(machine, &sections, TOY_SIZE_OF_HEADERS);
    write_toy_debug_directory(&mut bytes);
    write_at_address(&mut bytes, RELOC_ADDRESS, &relocations);
    edit_optional(&mut bytes, |optional| {
        optional.data_directories[IMAGE_DIRECTORY_ENTRY_DEBUG] = DataDirectory {
            virtual_address: DEBUG_DIRECTORY_ADDRESS,
            size: DEBUG_DIRECTORY_ENTRY_SIZE as u32,
        };
        optional.data_directories[IMAGE_DIRECTORY_ENTRY_BASERELOC] = DataDirectory {
            virtual_address: RELOC_ADDRESS,
            size: reloc_size,
        };
    });
    bytes
}

fn toy() -> Vec<u8> {
    toy_pe(Architecture::X86_64)
}

fn edited_toy(edit: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
    let mut bytes = toy();
    edit(&mut bytes);
    bytes
}

fn toy_with_sections(count: usize, size_of_headers: u32) -> Vec<u8> {
    let sections = vec![toy_section(b".s", 3 * PAGE, 3 * PAGE, READ_ONLY); count];
    assemble_pe(IMAGE_FILE_MACHINE_AMD64, &sections, size_of_headers)
}

fn headers(bytes: &[u8]) -> Headers {
    read_headers(bytes).unwrap()
}

fn cut(start: u32, end: u32) -> AddressRange {
    widen_address_range(start, end - start)
}

fn page_cut(address: u32) -> AddressRange {
    cut(address, address + PAGE)
}

fn relocation_addresses(bytes: &[u8]) -> AddressRange {
    let directories = headers(bytes).optional.data_directories;
    directory_addresses(directories[IMAGE_DIRECTORY_ENTRY_BASERELOC])
}

fn relocation_pages(bytes: &[u8]) -> Vec<u32> {
    let blocks = read_addresses(bytes, relocation_addresses(bytes)).unwrap();
    let mut pages = Vec::new();
    let mut offset = 0;
    while offset < blocks.len() {
        pages.push(u32_at(blocks, offset));
        offset += u32_at(blocks, offset + 4) as usize;
    }
    pages
}

fn assert_retained_bytes(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let mut skipped = cuts.to_vec();
    skipped.push(widen_address_range(DEBUG_POINTER_ADDRESS, 4));
    skipped.push(page_cut(RELOC_ADDRESS));
    skipped.sort_by_key(|range| range.start);
    for span in mapped_spans(original).unwrap() {
        for piece in subtract_cuts(span.addresses, &skipped) {
            let expected = read_addresses(original, piece);
            assert!(expected.is_some());
            assert!(read_addresses(trimmed, piece) == expected, "{piece:#x?}");
        }
    }
    for span in mapped_spans(trimmed).unwrap() {
        assert!(!overlaps_cut(span.addresses, cuts));
    }
}

fn assert_section_table(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let old = headers(original);
    let new = headers(trimmed);
    assert!(check(trimmed, &new).is_ok());
    let first_address = old.sections[0].virtual_address;
    assert_eq!({ new.sections[0].virtual_address }, first_address);
    let size_of_image = old.optional.size_of_image;
    assert_eq!({ new.optional.size_of_image }, size_of_image);
    let last = new.sections.last().unwrap();
    let last_size = align_up_u32(effective_virtual_size(last), PAGE).unwrap();
    assert_eq!(last.virtual_address + last_size, size_of_image);
    assert_eq!({ new.optional.address_of_entry_point }, ENTRY_POINT);

    let mut remaining_cuts = cuts.iter();
    let mut raw_data_end = new.optional.size_of_headers;
    for section in &new.sections {
        let pointer = section.pointer_to_raw_data;
        if section.name == REMOVED_SECTION_NAME {
            let addresses = widen_address_range(section.virtual_address, section.virtual_size);
            assert_eq!(Some(&addresses), remaining_cuts.next());
            assert_eq!((pointer, { section.size_of_raw_data }), (0, 0));
            assert_eq!(section.characteristics & IMAGE_SCN_MEM_MASK, 0);
        } else if section.size_of_raw_data > 0 {
            assert!(pointer.is_multiple_of(FILE_ALIGNMENT));
            assert!(pointer >= raw_data_end);
            raw_data_end = pointer + section.size_of_raw_data;
        }
    }
    assert_eq!(remaining_cuts.next(), None);
    assert_eq!(raw_data_end as usize, trimmed.len());
}

fn assert_relocations(original: &[u8], trimmed: &[u8], cuts: &[AddressRange]) {
    let mut expected = relocation_pages(original);
    expected.retain(|page| !is_address_in_cut(*page, cuts));
    assert_eq!(relocation_pages(trimmed), expected);

    let old_extent = read_addresses(trimmed, relocation_addresses(original)).unwrap();
    let retained_size = relocation_addresses(trimmed).len() as usize;
    assert!(old_extent[retained_size..].iter().all(|byte| *byte == 0));
}

fn remove_and_verify(original: &[u8], cuts: &[AddressRange]) -> Vec<u8> {
    let mut trimmed = original.to_vec();
    remove_ranges(&mut trimmed, cuts).unwrap();
    assert_retained_bytes(original, &trimmed, cuts);
    assert_section_table(original, &trimmed, cuts);
    assert_relocations(original, &trimmed, cuts);

    let field = read_addresses(&trimmed, widen_address_range(DEBUG_POINTER_ADDRESS, 4));
    let pointer = u32_at(field.unwrap(), 0) as usize;
    assert_eq!(&trimmed[pointer..pointer + 4], b"RSDS");

    let mut file = PEFile::init(&trimmed).unwrap();
    file.recompute_pe_checksum().unwrap();
    assert!(file.data == trimmed);
    file.add_bun_section(b"x", false).unwrap();
    trimmed
}

fn assert_image_error(original: &[u8], cuts: &[AddressRange], expected: ImageError) {
    let mut bytes = original.to_vec();
    let result = remove_ranges(&mut bytes, cuts);
    assert!(
        matches!(result, Err(Error::Image(error)) if error == expected),
        "expected {expected:?}, got {result:?}",
    );
    assert!(!bytes.is_empty());
}

fn assert_no_cuts(bytes: &[u8], reason: NoCutReason) {
    let model = cut_model(bytes);
    assert_eq!(
        model,
        CutModel::without_cuts(ExecutableFormat::Pe, MIN_CUT_ALIGNMENT, reason)
    );
    assert_eq!(model.max_cuts(), 0);
}

fn is_cuttable(bytes: &[u8], cut: AddressRange) -> bool {
    let spans = cut_model(bytes).cuttable_spans;
    spans.iter().any(|span| span.contains(cut))
}

#[test]
fn reads_toy_headers() {
    assert_eq!(architecture(&toy()).unwrap(), Architecture::X86_64);
    let aarch64 = toy_pe(Architecture::Aarch64);
    assert_eq!(architecture(&aarch64).unwrap(), Architecture::Aarch64);
    let x86 = edited_toy(|bytes| edit_pe_header(bytes, |header| header.machine = 0x014c));
    assert!(matches!(
        architecture(&x86),
        Err(Error::Image(ImageError::UnrecognizedExecutable))
    ));

    let spans = mapped_spans(&toy()).unwrap();
    assert_eq!(spans.len(), 7);
    assert_eq!(spans[0].addresses, cut(TEXT_ADDRESS, RDATA_ADDRESS));
    assert_eq!(spans[0].file_offset, u64::from(TOY_SIZE_OF_HEADERS));
    assert_eq!(spans[2].addresses, page_cut(DATA_ADDRESS));
    assert_eq!(spans[3].addresses.start, u64::from(BUILTINS_ADDRESS));
    assert_eq!(spans[6].addresses, relocation_addresses(&toy()));
    let model = cut_model(&toy());
    assert_eq!(model.format, ExecutableFormat::Pe);
    assert_eq!(model.alignment, 4096);
    assert_eq!(model.capacity, CutCapacity::Cuts(TOY_MAX_CUTS));

    let no_virtual_size = edited_toy(|bytes| {
        edit_section(bytes, TRIM_TABLE_INDEX, |section| section.virtual_size = 0);
    });
    assert_eq!(mapped_spans(&no_virtual_size).unwrap(), spans);
    assert_eq!(cut_model(&no_virtual_size), model);
}

#[test]
fn cuttable_spans_leave_out_required_data_and_writable_sections() {
    let debug_directory_end = DEBUG_DIRECTORY_ADDRESS + DEBUG_DIRECTORY_ENTRY_SIZE as u32;
    let expected = [
        cut(TEXT_ADDRESS, ENTRY_POINT),
        cut(ENTRY_POINT + 1, RDATA_ADDRESS),
        cut(RDATA_ADDRESS, DEBUG_DIRECTORY_ADDRESS),
        cut(debug_directory_end, CODEVIEW_ADDRESS),
        cut(CODEVIEW_ADDRESS + CODEVIEW_SIZE, DATA_ADDRESS),
        cut(BUILTINS_ADDRESS, TRIM_TABLE_ADDRESS),
        page_cut(TRIM_TABLE_ADDRESS),
        page_cut(TRIM_TABLE_ADDRESS + PAGE),
    ];
    for architecture in [Architecture::X86_64, Architecture::Aarch64] {
        assert_eq!(cut_model(&toy_pe(architecture)).cuttable_spans, expected);
    }
}

#[test]
fn cuttable_spans_hold_every_removable_page_of_read_only_sections() {
    let original = toy();
    let spans = cut_model(&original).cuttable_spans;
    let writable = cut(DATA_ADDRESS, BUILTINS_ADDRESS);
    for address in (TEXT_ADDRESS..=RELOC_ADDRESS).step_by(PAGE as usize) {
        let page = page_cut(address);
        let is_cuttable = spans.iter().any(|span| span.contains(page));
        let is_removable = remove_ranges(&mut original.clone(), &[page]).is_ok();
        assert_eq!(
            is_cuttable,
            is_removable && !writable.contains(page),
            "{page:#x?}"
        );
    }
}

#[test]
fn cut_alignment_follows_section_alignment() {
    let sections = [toy_section(b".s", 4 * PAGE, 4 * PAGE, READ_ONLY); 2];
    let with_section_alignment = |alignment: u32| {
        let mut bytes = assemble_pe(IMAGE_FILE_MACHINE_AMD64, &sections, PAGE);
        edit_optional(&mut bytes, |optional| {
            optional.section_alignment = alignment
        });
        bytes
    };
    let alignments = [(FILE_ALIGNMENT, PAGE), (PAGE, PAGE), (2 * PAGE, 2 * PAGE)];
    for (section_alignment, expected) in alignments {
        let model = cut_model(&with_section_alignment(section_alignment));
        assert_eq!(model.alignment, u64::from(expected));
        assert!(model.max_cuts() > 0);
    }
}

#[test]
fn cut_in_middle_of_text() {
    assert!(is_cuttable(&toy(), cut(0x3000, 0x5000)));
    let trimmed = remove_and_verify(&toy(), &[cut(0x3000, 0x5000)]);
    let sections = headers(&trimmed).sections;
    assert_eq!(sections.len(), 9);
    assert_eq!(sections[0].name, *b".text\0\0\0");
    assert_eq!({ sections[0].virtual_address }, TEXT_ADDRESS);
    assert_eq!(sections[1].name, REMOVED_SECTION_NAME);
    assert_eq!(sections[2].name, *b".text\0\0\0");
    assert_eq!({ sections[2].characteristics }, CODE);
}

#[test]
fn cut_at_end_of_text() {
    let trimmed = remove_and_verify(&toy(), &[cut(0x7000, RDATA_ADDRESS)]);
    assert_eq!(headers(&trimmed).sections.len(), 8);
}

#[test]
fn two_cuts_in_rdata() {
    let cuts = [cut(0xa000, 0xb000), cut(0xd000, 0xf000)];
    let trimmed = remove_and_verify(&toy(), &cuts);
    assert_eq!(relocation_pages(&trimmed).len(), 8);
}

#[test]
fn cuts_in_text_and_rdata() {
    let original = toy();
    let cuts = [cut(0x2000, 0x4000), page_cut(0x6000), cut(0xc000, 0xe000)];
    let trimmed = remove_and_verify(&original, &cuts);
    assert_eq!(original.len() - trimmed.len(), 5 * PAGE as usize);
}

#[test]
fn cut_of_all_raw_data_leaves_zero_filled_piece() {
    assert!(!is_cuttable(&toy(), page_cut(DATA_ADDRESS)));
    let trimmed = remove_and_verify(&toy(), &[page_cut(DATA_ADDRESS)]);
    let piece = headers(&trimmed).sections[3];
    assert_eq!(piece.name, *b".data\0\0\0");
    assert_eq!({ piece.virtual_address }, DATA_ADDRESS + PAGE);
    assert_eq!({ piece.virtual_size }, PAGE + 0x800);
    assert_eq!({ piece.size_of_raw_data }, 0);
    assert_eq!({ piece.pointer_to_raw_data }, 0);
    assert_eq!({ piece.characteristics }, WRITABLE);
}

#[test]
fn twenty_cuts_grow_section_table() {
    let text = (1..8).map(|page| page_cut(TEXT_ADDRESS + page * PAGE));
    let rdata = (1..8).map(|page| page_cut(RDATA_ADDRESS + page * PAGE));
    let builtins = (0..6).map(|page| page_cut(BUILTINS_ADDRESS + page * PAGE));
    let cuts: Vec<AddressRange> = text.chain(rdata).chain(builtins).collect();
    assert_eq!(cuts.len(), 20);
    let trimmed = remove_and_verify(&toy(), &cuts);
    assert_eq!({ headers(&trimmed).optional.size_of_headers }, 0x600);
}

#[test]
fn certificate_table_is_stripped() {
    let mut original = toy();
    let certificate_table = DataDirectory {
        virtual_address: original.len() as u32,
        size: 16,
    };
    original.extend_from_slice(&[0xcc; 16]);
    edit_optional(&mut original, |optional| {
        optional.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY] = certificate_table;
    });
    assert_eq!(
        cut_model(&original).capacity,
        CutCapacity::Cuts(TOY_MAX_CUTS)
    );
    let trimmed = remove_and_verify(&original, &[cut(0x3000, 0x5000)]);
    let directory = headers(&trimmed).optional.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
    assert_eq!(({ directory.virtual_address }, { directory.size }), (0, 0));
}

#[test]
fn cut_over_required_data_fails() {
    let assert_required = |bytes: &[u8], cut: AddressRange| {
        assert_image_error(bytes, &[cut], ImageError::CutHoldsHeaders);
        assert!(!is_cuttable(bytes, cut));
    };
    assert_required(&toy(), page_cut(TEXT_ADDRESS));
    assert_required(&toy(), page_cut(RELOC_ADDRESS));
    assert!(is_cuttable(&toy(), page_cut(RDATA_ADDRESS + PAGE)));

    let moved_record = edited_toy(|bytes| {
        set_debug_data_address(bytes, CODEVIEW_ADDRESS + PAGE);
    });
    assert_required(&moved_record, page_cut(RDATA_ADDRESS));
    assert_required(&moved_record, page_cut(RDATA_ADDRESS + PAGE));
}

#[test]
fn unusable_file_allows_no_cuts() {
    let symbol_table = edited_toy(|bytes| {
        edit_pe_header(bytes, |header| header.pointer_to_symbol_table = 0x400);
    });
    let overlay = edited_toy(|bytes| bytes.extend_from_slice(&[0; 16]));
    let gap = edited_toy(|bytes| {
        edit_section(bytes, 0, |section| section.virtual_size = 7 * PAGE);
    });
    let overlapping_raw_data = edited_toy(|bytes| {
        edit_section(bytes, 1, |section| section.pointer_to_raw_data -= 512);
    });
    let unmapped_debug_data = edited_toy(|bytes| set_debug_data_address(bytes, 0));
    let zero_filled_debug_data = edited_toy(|bytes| {
        set_debug_data_address(bytes, DATA_ADDRESS + PAGE);
    });
    let headers_over_first_section = edited_toy(|bytes| {
        edit_optional(bytes, |optional| {
            optional.size_of_headers = TEXT_ADDRESS + FILE_ALIGNMENT
        });
    });
    let unaligned_header_room = edited_toy(|bytes| {
        edit_optional(bytes, |optional| optional.file_alignment = 2 * TEXT_ADDRESS);
    });
    for bytes in [
        symbol_table,
        overlay,
        gap,
        overlapping_raw_data,
        unmapped_debug_data,
        zero_filled_debug_data,
        headers_over_first_section,
        unaligned_header_room,
    ] {
        assert_no_cuts(&bytes, NoCutReason::HeadersUnreadable);
        assert_image_error(&bytes, &[cut(0x3000, 0x5000)], ImageError::MalformedHeaders);
    }
}

#[test]
fn unreadable_headers_allow_no_cuts() {
    let no_signature = edited_toy(|bytes| edit_pe_header(bytes, |header| header.signature = 0));
    let no_sections = edited_toy(|bytes| {
        edit_pe_header(bytes, |header| header.number_of_sections = 0);
    });
    for bytes in [
        &toy()[..PE_HEADER_OFFSET - 1],
        &no_signature[..],
        &no_sections[..],
    ] {
        assert_no_cuts(bytes, NoCutReason::HeadersUnreadable);
    }
}

#[test]
fn full_section_table_allows_no_cuts() {
    let full = toy_with_sections(95, 0x1200);
    assert!(check(&full, &headers(&full)).is_ok());
    assert_no_cuts(&full, NoCutReason::HeaderRoomExhausted);
    let almost_full = toy_with_sections(93, 0x1200);
    assert_eq!(cut_model(&almost_full).capacity, CutCapacity::Cuts(1));
}

#[test]
fn header_room_limits_cuts() {
    let original = toy_with_sections(90, PAGE);
    assert_eq!(cut_model(&original).capacity, CutCapacity::Cuts(1));
    let cuts = [page_cut(5 * PAGE), page_cut(8 * PAGE), page_cut(11 * PAGE)];
    let mut trimmed = original.clone();
    remove_ranges(&mut trimmed, &cuts[..1]).unwrap();
    assert_retained_bytes(&original, &trimmed, &cuts[..1]);
    assert_section_table(&original, &trimmed, &cuts[..1]);
    assert_image_error(&original, &cuts[..2], ImageError::HeaderRoomExhausted);
    assert_image_error(&original, &cuts, ImageError::TooManyCuts);
}

#[test]
fn malformed_relocation_block_fails() {
    let last_block = 10 * RELOCATION_BLOCK_SIZE;
    for (block, size) in [(0, 6u32), (0, 0x1000), (last_block, 8)] {
        let mut bytes = toy();
        write_at_address(&mut bytes, RELOC_ADDRESS + block + 4, &size.to_le_bytes());
        assert_no_cuts(&bytes, NoCutReason::HeadersUnreadable);
        let result = remove_ranges(&mut bytes, &[cut(0x3000, 0x5000)]);
        assert!(
            matches!(result, Err(Error::Pe(pe::Error::InvalidPEFile))),
            "{size}"
        );
        assert!(!bytes.is_empty());
    }

    let mut unaligned_block = [0u8; 10];
    write_u32_at(&mut unaligned_block, 4, 10);
    let result = compact_relocation_blocks(&mut unaligned_block, &[]);
    assert_eq!(result, Err(pe::Error::InvalidPEFile));
}
