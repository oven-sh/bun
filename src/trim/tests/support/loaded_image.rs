use bun_exe_format::image::AddressRange;

const ELF_PROGRAM_HEADER_BYTES: usize = 56;
const ELF_MAX_PROGRAM_HEADER_TABLE_BYTES: usize = 4096;
const PT_LOAD: u32 = 1;
const PT_NOTE: u32 = 4;
const PT_PHDR: u32 = 6;
const NT_GNU_BUILD_ID: u32 = 3;

const MACHO_HEADER_BYTES: usize = 32;
const MACHO_SEGMENT_COMMAND_BYTES: usize = 72;
const MACHO_SECTION_BYTES: usize = 80;
const MACHO_FILE_PAGE: u64 = 0x4000;
const MACHO_SECTION_TYPE_MASK: u32 = 0xff;
const S_ZEROFILL: u32 = 1;
const LC_SEGMENT_64: u32 = 0x19;
const LC_UUID: u32 = 0x1b;
const LC_MAIN: u32 = 0x8000_0028;

const PE_MAX_SECTIONS: usize = 96;
const PE_SECTION_BYTES: usize = 40;
const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum MemoryByte {
    Mapped(u8),
    NoAccess,
    Unmapped,
}

struct Span {
    addresses: AddressRange,
    file_bytes: Vec<u8>,
    is_accessible: bool,
}

pub(crate) struct LoadedImage {
    spans: Vec<Span>,
    pub(crate) entry_point: u64,
    pub(crate) identity: Vec<u8>,
}

impl LoadedImage {
    pub(crate) fn load(file: &[u8]) -> LoadedImage {
        match file.get(..4) {
            Some(b"\x7fELF") => load_elf(file),
            Some([0xcf, 0xfa, 0xed, 0xfe]) => load_macho(file),
            Some([b'M', b'Z', ..]) => load_pe(file),
            _ => panic!("the system's loader does not recognize this file"),
        }
    }

    pub(crate) fn byte_at(&self, address: u64) -> MemoryByte {
        let Some(span) = self.span_at(address) else {
            return MemoryByte::Unmapped;
        };
        if !span.is_accessible {
            return MemoryByte::NoAccess;
        }
        let offset = (address - span.addresses.start) as usize;
        MemoryByte::Mapped(span.file_bytes.get(offset).copied().unwrap_or(0))
    }

    pub(crate) fn bytes(&self, range: AddressRange) -> Option<Vec<u8>> {
        let mut bytes = Vec::with_capacity(range.len() as usize);
        let mut address = range.start;
        while address < range.end {
            let span = self.span_at(address).filter(|span| span.is_accessible)?;
            let end = span.addresses.end.min(range.end);
            let offset = (address - span.addresses.start) as usize;
            let count = (end - address) as usize;
            let expected_len = bytes.len() + count;
            if let Some(file_bytes) = span.file_bytes.get(offset..) {
                bytes.extend_from_slice(&file_bytes[..count.min(file_bytes.len())]);
            }
            bytes.resize(expected_len, 0);
            address = end;
        }
        Some(bytes)
    }

    fn span_at(&self, address: u64) -> Option<&Span> {
        let index = self
            .spans
            .partition_point(|span| span.addresses.end <= address);
        self.spans
            .get(index)
            .filter(|span| span.addresses.start <= address)
    }
}

fn array_at<const N: usize>(file: &[u8], offset: usize) -> [u8; N] {
    offset
        .checked_add(N)
        .and_then(|end| file.get(offset..end))
        .and_then(|bytes| bytes.try_into().ok())
        .unwrap_or_else(|| panic!("the loader reads past the end of the file at {offset:#x}"))
}

fn u16_at(file: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(array_at(file, offset))
}

fn u32_at(file: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(array_at(file, offset))
}

fn u64_at(file: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(array_at(file, offset))
}

fn file_bytes_at(file: &[u8], offset: u64, size: u64) -> Vec<u8> {
    offset
        .checked_add(size)
        .and_then(|end| file.get(offset as usize..end as usize))
        .unwrap_or_else(|| {
            panic!(
                "{size:#x} bytes at file offset {offset:#x} lie outside the file of {:#x} bytes",
                file.len()
            )
        })
        .to_vec()
}

#[derive(Copy, Clone)]
struct ElfProgramHeader {
    kind: u32,
    offset: u64,
    address: u64,
    file_bytes: u64,
    memory_bytes: u64,
    alignment: u64,
}

fn read_elf_program_header(file: &[u8], offset: usize) -> ElfProgramHeader {
    ElfProgramHeader {
        kind: u32_at(file, offset),
        offset: u64_at(file, offset + 8),
        address: u64_at(file, offset + 16),
        file_bytes: u64_at(file, offset + 32),
        memory_bytes: u64_at(file, offset + 40),
        alignment: u64_at(file, offset + 48),
    }
}

fn load_elf(file: &[u8]) -> LoadedImage {
    let page: u64 = match u16_at(file, 18) {
        62 => 0x1000,
        183 => 0x1_0000,
        machine => panic!("the loader does not run ELF machine {machine}"),
    };
    let table_offset = u64_at(file, 32) as usize;
    let count = u16_at(file, 56) as usize;
    let table_bytes = count * ELF_PROGRAM_HEADER_BYTES;
    assert!(
        table_bytes <= ELF_MAX_PROGRAM_HEADER_TABLE_BYTES,
        "the program header table of {table_bytes} bytes is too large for the kernel"
    );
    assert!(
        table_offset + table_bytes <= file.len(),
        "the program header table lies outside the file"
    );
    let headers: Vec<ElfProgramHeader> = (0..count)
        .map(|index| read_elf_program_header(file, table_offset + index * ELF_PROGRAM_HEADER_BYTES))
        .collect();
    let spans = load_elf_segments(file, &headers, page);
    for header in headers.iter().filter(|header| header.kind == PT_PHDR) {
        check_elf_program_header_segment(header, &headers, table_offset as u64);
    }
    LoadedImage {
        spans,
        entry_point: u64_at(file, 24),
        identity: find_elf_build_id(file, &headers),
    }
}

fn load_elf_segments(file: &[u8], headers: &[ElfProgramHeader], page: u64) -> Vec<Span> {
    let mut spans: Vec<Span> = Vec::new();
    for header in headers.iter().filter(|header| header.kind == PT_LOAD) {
        assert!(
            header.file_bytes <= header.memory_bytes,
            "PT_LOAD at {:#x} has more file bytes than memory bytes",
            header.address
        );
        assert!(
            header.address % page == header.offset % page,
            "PT_LOAD at {:#x} and its file offset {:#x} differ modulo the page size",
            header.address,
            header.offset
        );
        let previous_end = spans.last().map_or(0, |span| span.addresses.end);
        assert!(
            header.address >= previous_end,
            "PT_LOAD at {:#x} overlaps the one before it",
            header.address
        );
        spans.push(Span {
            addresses: AddressRange {
                start: header.address,
                end: header.address + header.memory_bytes,
            },
            file_bytes: file_bytes_at(file, header.offset, header.file_bytes),
            is_accessible: true,
        });
    }
    spans
}

fn check_elf_program_header_segment(
    phdr: &ElfProgramHeader,
    headers: &[ElfProgramHeader],
    table_offset: u64,
) {
    assert!(
        phdr.offset == table_offset,
        "PT_PHDR does not name the program header table"
    );
    let is_mapped = headers
        .iter()
        .filter(|header| header.kind == PT_LOAD)
        .any(|load| {
            load.address <= phdr.address
                && phdr.address + phdr.file_bytes <= load.address + load.file_bytes
                && load.offset + (phdr.address - load.address) == phdr.offset
        });
    assert!(
        is_mapped,
        "PT_PHDR does not lie in the file bytes of a PT_LOAD at its address"
    );
}

fn find_elf_build_id(file: &[u8], headers: &[ElfProgramHeader]) -> Vec<u8> {
    for header in headers.iter().filter(|header| header.kind == PT_NOTE) {
        let alignment = if header.alignment == 8 { 8 } else { 4 };
        let end = (header.offset + header.file_bytes) as usize;
        let mut offset = header.offset as usize;
        while offset + 12 <= end {
            let name_bytes = u32_at(file, offset) as usize;
            let descriptor_bytes = u32_at(file, offset + 4) as usize;
            let name_start = offset + 12;
            let descriptor_start = (name_start + name_bytes).next_multiple_of(alignment);
            let is_build_id = u32_at(file, offset + 8) == NT_GNU_BUILD_ID
                && file.get(name_start..name_start + name_bytes) == Some(b"GNU\0".as_slice());
            if is_build_id {
                return file_bytes_at(file, descriptor_start as u64, descriptor_bytes as u64);
            }
            offset = (descriptor_start + descriptor_bytes).next_multiple_of(alignment);
        }
    }
    Vec::new()
}

struct MachSection {
    address: u64,
    bytes: u64,
    offset: u64,
    section_type: u32,
}

struct MachSegment {
    name: [u8; 16],
    address: u64,
    memory_bytes: u64,
    offset: u64,
    file_bytes: u64,
    protection: u32,
    sections: Vec<MachSection>,
}

#[derive(Default)]
struct MachCommands {
    segments: Vec<MachSegment>,
    uuid: Vec<u8>,
    entry_offset: u64,
}

fn load_macho(file: &[u8]) -> LoadedImage {
    let commands = read_macho_commands(file);
    let commands_end = MACHO_HEADER_BYTES as u64 + u64::from(u32_at(file, 20));
    check_macho_segments(file, &commands.segments, commands_end);
    let text = commands
        .segments
        .iter()
        .find(|segment| segment.offset == 0 && segment.file_bytes > 0)
        .expect("a Mach-O executable has a segment that maps its header");
    let entry_point = text.address + commands.entry_offset;
    let spans = commands
        .segments
        .iter()
        .map(|segment| Span {
            addresses: AddressRange {
                start: segment.address,
                end: segment.address + segment.memory_bytes,
            },
            file_bytes: file_bytes_at(file, segment.offset, segment.file_bytes),
            is_accessible: segment.protection != 0,
        })
        .collect();
    LoadedImage {
        spans,
        entry_point,
        identity: commands.uuid,
    }
}

fn read_macho_commands(file: &[u8]) -> MachCommands {
    let count = u32_at(file, 16);
    let commands_end = MACHO_HEADER_BYTES + u32_at(file, 20) as usize;
    let mut commands = MachCommands::default();
    let mut offset = MACHO_HEADER_BYTES;
    for _ in 0..count {
        let bytes = u32_at(file, offset + 4) as usize;
        assert!(
            bytes >= 8,
            "a load command of {bytes} bytes cannot be walked"
        );
        match u32_at(file, offset) {
            LC_SEGMENT_64 => commands
                .segments
                .push(read_macho_segment(file, offset, bytes)),
            LC_UUID => commands.uuid = file_bytes_at(file, offset as u64 + 8, 16),
            LC_MAIN => commands.entry_offset = u64_at(file, offset + 8),
            _ => {}
        }
        offset += bytes;
    }
    assert!(
        offset == commands_end,
        "the load commands end at {offset:#x}, not at {commands_end:#x}"
    );
    commands
}

fn read_macho_segment(file: &[u8], offset: usize, command_bytes: usize) -> MachSegment {
    let section_count = u32_at(file, offset + 64) as usize;
    assert!(
        command_bytes == MACHO_SEGMENT_COMMAND_BYTES + MACHO_SECTION_BYTES * section_count,
        "a segment command of {command_bytes} bytes does not hold {section_count} sections"
    );
    let sections = (0..section_count)
        .map(|index| {
            let section = offset + MACHO_SEGMENT_COMMAND_BYTES + MACHO_SECTION_BYTES * index;
            MachSection {
                address: u64_at(file, section + 32),
                bytes: u64_at(file, section + 40),
                offset: u64::from(u32_at(file, section + 48)),
                section_type: u32_at(file, section + 64) & MACHO_SECTION_TYPE_MASK,
            }
        })
        .collect();
    MachSegment {
        name: array_at(file, offset + 8),
        address: u64_at(file, offset + 24),
        memory_bytes: u64_at(file, offset + 32),
        offset: u64_at(file, offset + 40),
        file_bytes: u64_at(file, offset + 48),
        protection: u32_at(file, offset + 60),
        sections,
    }
}

fn check_macho_segments(file: &[u8], segments: &[MachSegment], commands_end: u64) {
    let mut previous_address_end = 0;
    let mut previous_file_end = 0;
    for segment in segments {
        assert!(
            segment.address >= previous_address_end,
            "segment at {:#x} is out of address order",
            segment.address
        );
        previous_address_end = segment.address + segment.memory_bytes;
        assert!(
            segment.file_bytes <= segment.memory_bytes,
            "segment at {:#x} has too many file bytes",
            segment.address
        );
        if segment.file_bytes > 0 {
            assert!(
                segment.offset >= previous_file_end,
                "segment at {:#x} is out of file order",
                segment.address
            );
            assert!(
                segment.offset % MACHO_FILE_PAGE == 0,
                "segment at {:#x} starts inside a page",
                segment.address
            );
            previous_file_end = segment.offset + segment.file_bytes;
            assert!(
                previous_file_end <= file.len() as u64,
                "segment at {:#x} ends past the file",
                segment.address
            );
        }
        check_macho_sections(segment, commands_end);
    }
    let last = segments.last().expect("a Mach-O executable has segments");
    assert!(
        last.name.starts_with(b"__LINKEDIT\0"),
        "the last segment is not __LINKEDIT"
    );
    assert!(
        last.offset + last.file_bytes == file.len() as u64,
        "__LINKEDIT does not end the file"
    );
}

fn check_macho_sections(segment: &MachSegment, commands_end: u64) {
    for section in segment
        .sections
        .iter()
        .filter(|section| section.section_type != S_ZEROFILL)
    {
        assert!(
            segment.address <= section.address
                && section.address + section.bytes <= segment.address + segment.memory_bytes,
            "section at {:#x} lies outside the addresses of its segment",
            section.address
        );
        assert!(
            segment.offset <= section.offset
                && section.offset + section.bytes <= segment.offset + segment.file_bytes,
            "section at {:#x} lies outside the file bytes of its segment",
            section.address
        );
        if segment.offset == 0 && segment.file_bytes > 0 {
            assert!(
                commands_end <= section.offset,
                "the load commands run into section at {:#x}",
                section.address
            );
        }
    }
}

struct PeSection {
    address: u64,
    virtual_bytes: u64,
    raw_bytes: u64,
    raw_pointer: u64,
    characteristics: u32,
}

fn read_pe_section(file: &[u8], offset: usize) -> PeSection {
    PeSection {
        virtual_bytes: u64::from(u32_at(file, offset + 8)),
        address: u64::from(u32_at(file, offset + 12)),
        raw_bytes: u64::from(u32_at(file, offset + 16)),
        raw_pointer: u64::from(u32_at(file, offset + 20)),
        characteristics: u32_at(file, offset + 36),
    }
}

fn load_pe(file: &[u8]) -> LoadedImage {
    let header = u32_at(file, 0x3c) as usize;
    assert!(
        array_at::<4>(file, header) == *b"PE\0\0",
        "the PE signature is missing"
    );
    let count = u16_at(file, header + 6) as usize;
    assert!(
        count <= PE_MAX_SECTIONS,
        "Windows does not load {count} sections"
    );
    let optional = header + 24;
    let table = optional + u16_at(file, header + 20) as usize;
    let sections: Vec<PeSection> = (0..count)
        .map(|index| read_pe_section(file, table + PE_SECTION_BYTES * index))
        .collect();

    let headers_bytes = u64::from(u32_at(file, optional + 60));
    let table_end = (table + PE_SECTION_BYTES * count) as u64;
    assert!(
        table_end <= headers_bytes,
        "the section table ends past SizeOfHeaders"
    );
    let first = sections.first().expect("a PE executable has sections");
    assert!(
        headers_bytes <= first.address,
        "SizeOfHeaders reaches into the first section"
    );
    check_pe_section_addresses(
        &sections,
        u64::from(u32_at(file, optional + 32)),
        u64::from(u32_at(file, optional + 56)),
    );
    check_pe_raw_data(file, &sections, u64::from(u32_at(file, optional + 36)));

    let spans = sections
        .iter()
        .map(|section| Span {
            addresses: AddressRange {
                start: section.address,
                end: section.address + section.virtual_bytes,
            },
            file_bytes: file_bytes_at(
                file,
                section.raw_pointer,
                section.raw_bytes.min(section.virtual_bytes),
            ),
            is_accessible: section.characteristics & IMAGE_SCN_MEM_READ != 0,
        })
        .collect();
    LoadedImage {
        spans,
        entry_point: u64::from(u32_at(file, optional + 16)),
        identity: Vec::new(),
    }
}

fn check_pe_section_addresses(sections: &[PeSection], section_alignment: u64, image_bytes: u64) {
    let mut next_address = sections.first().map_or(0, |section| section.address);
    for section in sections {
        assert!(
            section.address == next_address,
            "section at {:#x} does not start where the one before ends, {next_address:#x}",
            section.address
        );
        next_address =
            (section.address + section.virtual_bytes).next_multiple_of(section_alignment);
    }
    assert!(
        next_address == image_bytes,
        "the sections end at {next_address:#x}, not at SizeOfImage {image_bytes:#x}"
    );
}

fn check_pe_raw_data(file: &[u8], sections: &[PeSection], file_alignment: u64) {
    let mut previous_end = 0;
    for section in sections.iter().filter(|section| section.raw_bytes > 0) {
        assert!(
            section.raw_pointer % file_alignment == 0,
            "the raw data of section at {:#x} is not aligned",
            section.address
        );
        assert!(
            section.raw_pointer >= previous_end,
            "the raw data of section at {:#x} overlaps the one before it",
            section.address
        );
        previous_end = section.raw_pointer + section.raw_bytes;
        assert!(
            previous_end <= file.len() as u64,
            "the raw data of section at {:#x} ends past the file",
            section.address
        );
    }
}
