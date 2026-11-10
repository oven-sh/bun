use bun_exe_format::image::{AddressRange, Architecture, ExecutableFormat};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Target {
    pub(crate) format: ExecutableFormat,
    pub(crate) architecture: Architecture,
}

pub(crate) const ALL_TARGETS: [Target; 6] = [
    Target {
        format: ExecutableFormat::Elf,
        architecture: Architecture::X86_64,
    },
    Target {
        format: ExecutableFormat::Elf,
        architecture: Architecture::Aarch64,
    },
    Target {
        format: ExecutableFormat::MachO,
        architecture: Architecture::X86_64,
    },
    Target {
        format: ExecutableFormat::MachO,
        architecture: Architecture::Aarch64,
    },
    Target {
        format: ExecutableFormat::Pe,
        architecture: Architecture::X86_64,
    },
    Target {
        format: ExecutableFormat::Pe,
        architecture: Architecture::Aarch64,
    },
];

pub(crate) const CODE_BYTES: u64 = 0x20_0000;
pub(crate) const DATA_BYTES: u64 = 0x10_0000;
pub(crate) const TABLE_ROOM: u64 = 0x8000;
pub(crate) const NEVER_REMOVED_BYTES: u64 = 0x1_0000;

const STATE_BYTES: u64 = 536;
const STATE_MAGIC: &[u8; 8] = b"BUNFEAT\0";
const BUILTINS_BYTES: u64 = 64;

pub(crate) struct ToyLayout {
    pub(crate) target: Target,
    pub(crate) code: AddressRange,
    pub(crate) read_only_data: AddressRange,
    pub(crate) state: AddressRange,
    pub(crate) table: AddressRange,
    pub(crate) zero_filled: AddressRange,
    pub(crate) stable: Vec<AddressRange>,
    pub(crate) cut_alignment: u64,
}

pub(crate) fn pattern_byte(address: u64) -> u8 {
    (address.wrapping_mul(0x9e37_79b9) >> 13) as u8
}

const fn sized(start: u64, size: u64) -> AddressRange {
    AddressRange {
        start,
        end: start + size,
    }
}

pub(crate) fn layout_of(target: Target) -> ToyLayout {
    match target.format {
        ExecutableFormat::Elf => elf_layout(target),
        ExecutableFormat::MachO => macho_layout(target),
        ExecutableFormat::Pe => pe_layout(target),
    }
}

pub(crate) fn build_executable(
    layout: &ToyLayout,
    table: Option<&[u8]>,
    overlays: &[(u64, &[u8])],
) -> Vec<u8> {
    let format = layout.target.format;
    let mut file = match format {
        ExecutableFormat::Elf => build_elf(layout, table.is_some()),
        ExecutableFormat::MachO => build_macho(layout, table.is_some()),
        ExecutableFormat::Pe => build_pe(layout, table.is_some()),
    };
    if let Some(table) = table {
        assert!(
            table.len() as u64 <= TABLE_ROOM,
            "the toy table does not fit its room"
        );
        put(
            &mut file,
            find_file_offset(format, layout.table.start),
            table,
        );
    }
    put(
        &mut file,
        find_file_offset(format, layout.state.start),
        STATE_MAGIC,
    );
    for (address, bytes) in overlays {
        put(&mut file, find_file_offset(format, *address), bytes);
    }
    file
}

fn find_file_offset(format: ExecutableFormat, address: u64) -> usize {
    match format {
        ExecutableFormat::Elf => (address - ELF_BASE) as usize,
        ExecutableFormat::MachO => {
            assert!(
                address < MACHO_BASE + MACHO_TEXT_BYTES,
                "an overlay lies outside __TEXT"
            );
            (address - MACHO_BASE) as usize
        }
        ExecutableFormat::Pe => {
            let section = PE_SECTIONS
                .iter()
                .find(|section| {
                    let start = u64::from(section.address);
                    start <= address && address < start + u64::from(section.raw_size)
                })
                .expect("an overlay lies in a section with file bytes");
            (address - u64::from(section.address)) as usize + section.raw_pointer as usize
        }
    }
}

fn put(bytes: &mut [u8], offset: usize, value: &[u8]) {
    bytes[offset..offset + value.len()].copy_from_slice(value);
}

fn put_pattern(bytes: &mut [u8], offset: usize, range: AddressRange) {
    for (byte, address) in bytes[offset..].iter_mut().zip(range.start..range.end) {
        *byte = pattern_byte(address);
    }
}

fn padded_name<const N: usize>(name: &str) -> [u8; N] {
    let mut padded = [0; N];
    padded[..name.len()].copy_from_slice(name.as_bytes());
    padded
}

const ELF_BASE: u64 = 0x20_0000;
const ELF_HEADER_BYTES: usize = 64;
const ELF_PROGRAM_HEADERS_OFFSET: u64 = 0x40;
const ELF_PROGRAM_HEADER_BYTES: u64 = 56;
const ELF_ROOM_NOTE_OFFSET: u64 = 0x200;
const ELF_ROOM_BYTES: u32 = 3584;
const ELF_BUILD_ID_OFFSET: u64 = 0x1010;
const ELF_BUILD_ID_NOTE_BYTES: u64 = 36;
const ELF_STATE_OFFSET: u64 = 0x2000;
const ELF_TABLE_OFFSET: u64 = 0x3000;
const ELF_BUILTINS_OFFSET: u64 = 0xb000;
const ELF_READ_ONLY_DATA_OFFSET: u64 = 0x1_0000;
const ELF_CODE_OFFSET: u64 = 0x11_0000;
const ELF_DATA_OFFSET: u64 = 0x31_0000;
const ELF_DATA_BYTES: u64 = 0x1000;
const ELF_PAYLOAD_OFFSET: u64 = 0x31_1000;
const ELF_PAYLOAD_BYTES: u64 = 8;
const ELF_ZERO_FILLED_OFFSET: u64 = 0x31_1008;
const ELF_ZERO_FILLED_BYTES: u64 = 0x3ff8;

const PT_LOAD: u32 = 1;
const PT_NOTE: u32 = 4;
const PT_PHDR: u32 = 6;
const PT_GNU_STACK: u32 = 0x6474_e551;

const SHT_PROGBITS: u32 = 1;
const SHT_STRTAB: u32 = 3;
const SHT_NOTE: u32 = 7;
const SHT_NOBITS: u32 = 8;
const SHF_WRITE: u64 = 1;
const SHF_ALLOC: u64 = 2;
const SHF_EXECINSTR: u64 = 4;

struct ElfSegment {
    kind: u32,
    flags: u32,
    address: u64,
    offset: u64,
    file_bytes: u64,
    memory_bytes: u64,
    alignment: u64,
}

const ELF_SEGMENTS: [ElfSegment; 6] = [
    ElfSegment {
        kind: PT_PHDR,
        flags: 4,
        address: ELF_BASE + ELF_PROGRAM_HEADERS_OFFSET,
        offset: ELF_PROGRAM_HEADERS_OFFSET,
        file_bytes: 6 * ELF_PROGRAM_HEADER_BYTES,
        memory_bytes: 6 * ELF_PROGRAM_HEADER_BYTES,
        alignment: 8,
    },
    ElfSegment {
        kind: PT_NOTE,
        flags: 4,
        address: ELF_BASE + ELF_ROOM_NOTE_OFFSET,
        offset: ELF_ROOM_NOTE_OFFSET,
        file_bytes: 0xe34,
        memory_bytes: 0xe34,
        alignment: 8,
    },
    ElfSegment {
        kind: PT_LOAD,
        flags: 4,
        address: ELF_BASE,
        offset: 0,
        file_bytes: ELF_CODE_OFFSET,
        memory_bytes: ELF_CODE_OFFSET,
        alignment: 0x1_0000,
    },
    ElfSegment {
        kind: PT_LOAD,
        flags: 5,
        address: ELF_BASE + ELF_CODE_OFFSET,
        offset: ELF_CODE_OFFSET,
        file_bytes: CODE_BYTES,
        memory_bytes: CODE_BYTES,
        alignment: 0x1_0000,
    },
    ElfSegment {
        kind: PT_LOAD,
        flags: 6,
        address: ELF_BASE + ELF_DATA_OFFSET,
        offset: ELF_DATA_OFFSET,
        file_bytes: 0x1008,
        memory_bytes: 0x5000,
        alignment: 0x1_0000,
    },
    ElfSegment {
        kind: PT_GNU_STACK,
        flags: 6,
        address: 0,
        offset: 0,
        file_bytes: 0,
        memory_bytes: 0,
        alignment: 0,
    },
];

struct ElfSection {
    name: &'static str,
    kind: u32,
    flags: u64,
    offset: u64,
    bytes: u64,
}

const ELF_SECTIONS: [ElfSection; 10] = [
    ElfSection {
        name: ".note.bun",
        kind: SHT_NOTE,
        flags: SHF_ALLOC,
        offset: ELF_ROOM_NOTE_OFFSET,
        bytes: 16 + ELF_ROOM_BYTES as u64,
    },
    ElfSection {
        name: ".note.gnu.build-id",
        kind: SHT_NOTE,
        flags: SHF_ALLOC,
        offset: ELF_BUILD_ID_OFFSET,
        bytes: ELF_BUILD_ID_NOTE_BYTES,
    },
    ElfSection {
        name: ".bun_features",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC,
        offset: ELF_STATE_OFFSET,
        bytes: STATE_BYTES,
    },
    ElfSection {
        name: ".bun_trim",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC,
        offset: ELF_TABLE_OFFSET,
        bytes: TABLE_ROOM,
    },
    ElfSection {
        name: ".bun_builtins",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC,
        offset: ELF_BUILTINS_OFFSET,
        bytes: BUILTINS_BYTES,
    },
    ElfSection {
        name: ".rodata",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC,
        offset: ELF_READ_ONLY_DATA_OFFSET,
        bytes: DATA_BYTES,
    },
    ElfSection {
        name: ".text",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC | SHF_EXECINSTR,
        offset: ELF_CODE_OFFSET,
        bytes: CODE_BYTES,
    },
    ElfSection {
        name: ".data",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC | SHF_WRITE,
        offset: ELF_DATA_OFFSET,
        bytes: ELF_DATA_BYTES,
    },
    ElfSection {
        name: ".bun",
        kind: SHT_PROGBITS,
        flags: SHF_ALLOC | SHF_WRITE,
        offset: ELF_PAYLOAD_OFFSET,
        bytes: ELF_PAYLOAD_BYTES,
    },
    ElfSection {
        name: ".bss",
        kind: SHT_NOBITS,
        flags: SHF_ALLOC | SHF_WRITE,
        offset: ELF_ZERO_FILLED_OFFSET,
        bytes: ELF_ZERO_FILLED_BYTES,
    },
];

fn elf_layout(target: Target) -> ToyLayout {
    let code = sized(ELF_BASE + ELF_CODE_OFFSET, CODE_BYTES);
    let read_only_data = sized(ELF_BASE + ELF_READ_ONLY_DATA_OFFSET, DATA_BYTES);
    ToyLayout {
        target,
        code,
        read_only_data,
        state: sized(ELF_BASE + ELF_STATE_OFFSET, STATE_BYTES),
        table: sized(ELF_BASE + ELF_TABLE_OFFSET, TABLE_ROOM),
        zero_filled: sized(ELF_BASE + ELF_ZERO_FILLED_OFFSET, ELF_ZERO_FILLED_BYTES),
        stable: vec![
            sized(ELF_BASE + ELF_BUILD_ID_OFFSET, ELF_BUILD_ID_NOTE_BYTES),
            sized(ELF_BASE + ELF_BUILTINS_OFFSET, BUILTINS_BYTES),
            read_only_data,
            code,
            sized(ELF_BASE + ELF_DATA_OFFSET, ELF_DATA_BYTES),
        ],
        cut_alignment: match target.architecture {
            Architecture::X86_64 => 0x1000,
            Architecture::Aarch64 => 0x1_0000,
        },
    }
}

fn build_elf(layout: &ToyLayout, has_table: bool) -> Vec<u8> {
    let mut file = vec![0; ELF_ZERO_FILLED_OFFSET as usize];
    put_elf_header(&mut file, layout.target.architecture);
    put_elf_program_headers(&mut file);
    put_elf_notes(&mut file);
    for (offset, bytes) in [
        (ELF_BUILTINS_OFFSET, BUILTINS_BYTES),
        (ELF_READ_ONLY_DATA_OFFSET, DATA_BYTES),
        (ELF_CODE_OFFSET, CODE_BYTES),
        (ELF_DATA_OFFSET, ELF_DATA_BYTES),
    ] {
        put_pattern(&mut file, offset as usize, sized(ELF_BASE + offset, bytes));
    }
    append_elf_section_table(&mut file, has_table);
    file
}

fn put_elf_header(file: &mut [u8], architecture: Architecture) {
    let machine: u16 = match architecture {
        Architecture::X86_64 => 62,
        Architecture::Aarch64 => 183,
    };
    put(file, 0, b"\x7fELF\x02\x01\x01");
    put(file, 16, &2u16.to_le_bytes());
    put(file, 18, &machine.to_le_bytes());
    put(file, 20, &1u32.to_le_bytes());
    put(file, 24, &(ELF_BASE + ELF_CODE_OFFSET).to_le_bytes());
    put(file, 32, &ELF_PROGRAM_HEADERS_OFFSET.to_le_bytes());
    put(file, 52, &(ELF_HEADER_BYTES as u16).to_le_bytes());
    put(file, 54, &(ELF_PROGRAM_HEADER_BYTES as u16).to_le_bytes());
    put(file, 56, &(ELF_SEGMENTS.len() as u16).to_le_bytes());
    put(file, 58, &64u16.to_le_bytes());
}

fn put_elf_program_headers(file: &mut [u8]) {
    let mut headers = Vec::new();
    for segment in &ELF_SEGMENTS {
        headers.extend_from_slice(&segment.kind.to_le_bytes());
        headers.extend_from_slice(&segment.flags.to_le_bytes());
        headers.extend_from_slice(&segment.offset.to_le_bytes());
        headers.extend_from_slice(&segment.address.to_le_bytes());
        headers.extend_from_slice(&segment.address.to_le_bytes());
        headers.extend_from_slice(&segment.file_bytes.to_le_bytes());
        headers.extend_from_slice(&segment.memory_bytes.to_le_bytes());
        headers.extend_from_slice(&segment.alignment.to_le_bytes());
    }
    put(file, ELF_PROGRAM_HEADERS_OFFSET as usize, &headers);
}

fn put_elf_notes(file: &mut [u8]) {
    let mut room = Vec::new();
    room.extend_from_slice(&4u32.to_le_bytes());
    room.extend_from_slice(&ELF_ROOM_BYTES.to_le_bytes());
    room.extend_from_slice(&1u32.to_le_bytes());
    room.extend_from_slice(b"Bun\0");
    put(file, ELF_ROOM_NOTE_OFFSET as usize, &room);

    let mut build_id = Vec::new();
    build_id.extend_from_slice(&4u32.to_le_bytes());
    build_id.extend_from_slice(&20u32.to_le_bytes());
    build_id.extend_from_slice(&3u32.to_le_bytes());
    build_id.extend_from_slice(b"GNU\0");
    build_id.extend_from_slice(&[0xb1; 20]);
    put(file, ELF_BUILD_ID_OFFSET as usize, &build_id);
}

fn append_elf_section_table(file: &mut Vec<u8>, has_table: bool) {
    let sections: Vec<&ElfSection> = ELF_SECTIONS
        .iter()
        .filter(|section| has_table || section.offset != ELF_TABLE_OFFSET)
        .collect();
    let names_offset = file.len() as u64;
    let mut names = vec![0u8];
    let mut headers = vec![0u8; 64];
    for section in &sections {
        let name_offset = names.len() as u32;
        names.extend_from_slice(section.name.as_bytes());
        names.push(0);
        append_elf_section_header(&mut headers, name_offset, section);
    }
    let strings_name_offset = names.len() as u32;
    names.extend_from_slice(b".shstrtab\0");
    let strings = ElfSection {
        name: ".shstrtab",
        kind: SHT_STRTAB,
        flags: 0,
        offset: names_offset,
        bytes: names.len() as u64,
    };
    append_elf_section_header(&mut headers, strings_name_offset, &strings);

    file.extend_from_slice(&names);
    file.resize(file.len().next_multiple_of(8), 0);
    let section_table_offset = file.len() as u64;
    file.extend_from_slice(&headers);

    let section_count = sections.len() as u16 + 2;
    put(file, 40, &section_table_offset.to_le_bytes());
    put(file, 60, &section_count.to_le_bytes());
    put(file, 62, &(section_count - 1).to_le_bytes());
}

fn append_elf_section_header(headers: &mut Vec<u8>, name_offset: u32, section: &ElfSection) {
    let address = if section.flags & SHF_ALLOC != 0 {
        ELF_BASE + section.offset
    } else {
        0
    };
    headers.extend_from_slice(&name_offset.to_le_bytes());
    headers.extend_from_slice(&section.kind.to_le_bytes());
    headers.extend_from_slice(&section.flags.to_le_bytes());
    headers.extend_from_slice(&address.to_le_bytes());
    headers.extend_from_slice(&section.offset.to_le_bytes());
    headers.extend_from_slice(&section.bytes.to_le_bytes());
    headers.extend_from_slice(&[0; 8]);
    headers.extend_from_slice(&1u64.to_le_bytes());
    headers.extend_from_slice(&[0; 8]);
}

const MACHO_BASE: u64 = 0x1_0000_0000;
const MACHO_TEXT_BYTES: u64 = 0x31_0000;
const MACHO_CODE: u64 = MACHO_BASE + 0x4000;
const MACHO_READ_ONLY_DATA: u64 = MACHO_BASE + 0x20_4000;
const MACHO_BUILTINS: u64 = MACHO_BASE + 0x30_4000;
const MACHO_TABLE: u64 = MACHO_BASE + 0x30_5000;
const MACHO_STATE: u64 = MACHO_BASE + 0x30_d000;
const MACHO_DATA: u64 = MACHO_BASE + 0x31_0000;
const MACHO_DATA_BYTES: u64 = 0x1000;
const MACHO_ZERO_FILLED: u64 = MACHO_BASE + 0x31_4000;
const MACHO_ZERO_FILLED_BYTES: u64 = 0x4000;
const MACHO_LINKEDIT_OFFSET: u64 = 0x31_8000;
const MACHO_LINKEDIT_BYTES: u64 = 0x40;
const MACHO_HEADER_BYTES: usize = 32;
const MACHO_ENTRY_OFFSET: u64 = MACHO_CODE - MACHO_BASE;

const LC_SEGMENT_64: u32 = 0x19;
const LC_UUID: u32 = 0x1b;
const LC_MAIN: u32 = 0x8000_0028;
const SEGMENT_COMMAND_BYTES: u32 = 72;
const SECTION_RECORD_BYTES: u32 = 80;

struct MachSection {
    name: &'static str,
    address: u64,
    bytes: u64,
    offset: u32,
    flags: u32,
}

const fn text_section(name: &'static str, address: u64, bytes: u64, flags: u32) -> MachSection {
    MachSection {
        name,
        address,
        bytes,
        offset: (address - MACHO_BASE) as u32,
        flags,
    }
}

const MACHO_TEXT_SECTIONS: [MachSection; 5] = [
    text_section("__text", MACHO_CODE, CODE_BYTES, 0x8000_0400),
    text_section("__const", MACHO_READ_ONLY_DATA, DATA_BYTES, 0),
    text_section("__bun_builtins", MACHO_BUILTINS, BUILTINS_BYTES, 0),
    text_section("__bun_trim", MACHO_TABLE, TABLE_ROOM, 0),
    text_section("__bun_features", MACHO_STATE, STATE_BYTES, 0),
];

const MACHO_DATA_SECTIONS: [MachSection; 2] = [
    MachSection {
        name: "__data",
        address: MACHO_DATA,
        bytes: MACHO_DATA_BYTES,
        offset: 0x31_0000,
        flags: 0,
    },
    MachSection {
        name: "__bss",
        address: MACHO_ZERO_FILLED,
        bytes: MACHO_ZERO_FILLED_BYTES,
        offset: 0,
        flags: 1,
    },
];

const MACHO_PAYLOAD_SECTIONS: [MachSection; 1] = [MachSection {
    name: "__bun",
    address: MACHO_BASE + 0x31_8000,
    bytes: 8,
    offset: 0x31_4000,
    flags: 0,
}];

struct MachSegment {
    name: &'static str,
    address: u64,
    memory_bytes: u64,
    offset: u64,
    file_bytes: u64,
    protection: u32,
    sections: &'static [MachSection],
}

const MACHO_SEGMENTS: [MachSegment; 5] = [
    MachSegment {
        name: "__PAGEZERO",
        address: 0,
        memory_bytes: MACHO_BASE,
        offset: 0,
        file_bytes: 0,
        protection: 0,
        sections: &[],
    },
    MachSegment {
        name: "__TEXT",
        address: MACHO_BASE,
        memory_bytes: MACHO_TEXT_BYTES,
        offset: 0,
        file_bytes: MACHO_TEXT_BYTES,
        protection: 5,
        sections: &MACHO_TEXT_SECTIONS,
    },
    MachSegment {
        name: "__DATA",
        address: MACHO_DATA,
        memory_bytes: 0x8000,
        offset: 0x31_0000,
        file_bytes: 0x4000,
        protection: 3,
        sections: &MACHO_DATA_SECTIONS,
    },
    MachSegment {
        name: "__BUN",
        address: MACHO_BASE + 0x31_8000,
        memory_bytes: 0x4000,
        offset: 0x31_4000,
        file_bytes: 0x4000,
        protection: 3,
        sections: &MACHO_PAYLOAD_SECTIONS,
    },
    MachSegment {
        name: "__LINKEDIT",
        address: MACHO_BASE + 0x31_c000,
        memory_bytes: 0x4000,
        offset: MACHO_LINKEDIT_OFFSET,
        file_bytes: MACHO_LINKEDIT_BYTES,
        protection: 1,
        sections: &[],
    },
];

fn macho_layout(target: Target) -> ToyLayout {
    let code = sized(MACHO_CODE, CODE_BYTES);
    let read_only_data = sized(MACHO_READ_ONLY_DATA, DATA_BYTES);
    ToyLayout {
        target,
        code,
        read_only_data,
        state: sized(MACHO_STATE, STATE_BYTES),
        table: sized(MACHO_TABLE, TABLE_ROOM),
        zero_filled: sized(MACHO_ZERO_FILLED, MACHO_ZERO_FILLED_BYTES),
        stable: vec![
            code,
            read_only_data,
            sized(MACHO_BUILTINS, BUILTINS_BYTES),
            sized(MACHO_DATA, MACHO_DATA_BYTES),
        ],
        cut_alignment: 0x4000,
    }
}

fn build_macho(layout: &ToyLayout, has_table: bool) -> Vec<u8> {
    let mut file = vec![0; (MACHO_LINKEDIT_OFFSET + MACHO_LINKEDIT_BYTES) as usize];
    let commands = macho_commands(has_table);
    let (cpu_type, cpu_subtype): (u32, u32) = match layout.target.architecture {
        Architecture::X86_64 => (0x0100_0007, 3),
        Architecture::Aarch64 => (0x0100_000c, 0),
    };
    let mut header = Vec::new();
    for word in [
        0xfeed_facf,
        cpu_type,
        cpu_subtype,
        2,
        (MACHO_SEGMENTS.len() + 2) as u32,
        commands.len() as u32,
        0x0020_0085,
        0,
    ] {
        header.extend_from_slice(&u32::to_le_bytes(word));
    }
    put(&mut file, 0, &header);
    put(&mut file, MACHO_HEADER_BYTES, &commands);
    for range in [
        sized(MACHO_CODE, CODE_BYTES),
        sized(MACHO_READ_ONLY_DATA, DATA_BYTES),
        sized(MACHO_BUILTINS, BUILTINS_BYTES),
        sized(MACHO_DATA, MACHO_DATA_BYTES),
    ] {
        put_pattern(&mut file, (range.start - MACHO_BASE) as usize, range);
    }
    put(
        &mut file,
        MACHO_LINKEDIT_OFFSET as usize,
        &[0x1e; MACHO_LINKEDIT_BYTES as usize],
    );
    file
}

fn macho_commands(has_table: bool) -> Vec<u8> {
    let mut commands = Vec::new();
    for segment in &MACHO_SEGMENTS {
        append_macho_segment(&mut commands, segment, has_table);
    }
    commands.extend_from_slice(&LC_UUID.to_le_bytes());
    commands.extend_from_slice(&24u32.to_le_bytes());
    commands.extend_from_slice(&[0xd1; 16]);
    commands.extend_from_slice(&LC_MAIN.to_le_bytes());
    commands.extend_from_slice(&24u32.to_le_bytes());
    commands.extend_from_slice(&MACHO_ENTRY_OFFSET.to_le_bytes());
    commands.extend_from_slice(&0u64.to_le_bytes());
    commands
}

fn append_macho_segment(commands: &mut Vec<u8>, segment: &MachSegment, has_table: bool) {
    let sections: Vec<&MachSection> = segment
        .sections
        .iter()
        .filter(|section| has_table || section.address != MACHO_TABLE)
        .collect();
    let section_count = sections.len() as u32;
    commands.extend_from_slice(&LC_SEGMENT_64.to_le_bytes());
    let command_bytes = SEGMENT_COMMAND_BYTES + SECTION_RECORD_BYTES * section_count;
    commands.extend_from_slice(&command_bytes.to_le_bytes());
    commands.extend_from_slice(&padded_name::<16>(segment.name));
    commands.extend_from_slice(&segment.address.to_le_bytes());
    commands.extend_from_slice(&segment.memory_bytes.to_le_bytes());
    commands.extend_from_slice(&segment.offset.to_le_bytes());
    commands.extend_from_slice(&segment.file_bytes.to_le_bytes());
    commands.extend_from_slice(&segment.protection.to_le_bytes());
    commands.extend_from_slice(&segment.protection.to_le_bytes());
    commands.extend_from_slice(&section_count.to_le_bytes());
    commands.extend_from_slice(&0u32.to_le_bytes());
    for section in sections {
        commands.extend_from_slice(&padded_name::<16>(section.name));
        commands.extend_from_slice(&padded_name::<16>(segment.name));
        commands.extend_from_slice(&section.address.to_le_bytes());
        commands.extend_from_slice(&section.bytes.to_le_bytes());
        commands.extend_from_slice(&section.offset.to_le_bytes());
        commands.extend_from_slice(&[0; 12]);
        commands.extend_from_slice(&section.flags.to_le_bytes());
        commands.extend_from_slice(&[0; 12]);
    }
}

const PE_HEADER_OFFSET: usize = 0x80;
const PE_OPTIONAL_HEADER_OFFSET: usize = 0x98;
const PE_OPTIONAL_HEADER_BYTES: u16 = 240;
const PE_SECTION_TABLE_OFFSET: usize = 0x188;
const PE_IMAGE_BYTES: u32 = 0x30_e000;
const PE_HEADER_BYTES: u32 = 0x400;
const PE_FILE_BYTES: usize = 0x30_9a00;
const PE_CODE: u32 = 0x1000;
const PE_READ_ONLY_DATA: u32 = 0x20_1000;
const PE_DATA: u32 = 0x30_1000;
const PE_DATA_FILE_BYTES: u32 = 0x1000;
const PE_BUILTINS: u32 = 0x30_4000;
const PE_TABLE: u32 = 0x30_5000;
const PE_STATE: u32 = 0x30_d000;
const PE_ZERO_FILLED: u64 = 0x30_2000;
const PE_ZERO_FILLED_BYTES: u64 = 0x2000;

struct PeSection {
    name: &'static str,
    address: u32,
    virtual_bytes: u32,
    raw_size: u32,
    raw_pointer: u32,
    characteristics: u32,
}

const PE_SECTIONS: [PeSection; 6] = [
    PeSection {
        name: ".text",
        address: PE_CODE,
        virtual_bytes: CODE_BYTES as u32,
        raw_size: CODE_BYTES as u32,
        raw_pointer: 0x400,
        characteristics: 0x6000_0020,
    },
    PeSection {
        name: ".rdata",
        address: PE_READ_ONLY_DATA,
        virtual_bytes: DATA_BYTES as u32,
        raw_size: DATA_BYTES as u32,
        raw_pointer: 0x20_0400,
        characteristics: 0x4000_0040,
    },
    PeSection {
        name: ".data",
        address: PE_DATA,
        virtual_bytes: 0x3000,
        raw_size: PE_DATA_FILE_BYTES,
        raw_pointer: 0x30_0400,
        characteristics: 0xc000_0040,
    },
    PeSection {
        name: ".bunblt",
        address: PE_BUILTINS,
        virtual_bytes: BUILTINS_BYTES as u32,
        raw_size: 0x200,
        raw_pointer: 0x30_1400,
        characteristics: 0x4000_0040,
    },
    PeSection {
        name: ".buntrim",
        address: PE_TABLE,
        virtual_bytes: TABLE_ROOM as u32,
        raw_size: TABLE_ROOM as u32,
        raw_pointer: 0x30_1600,
        characteristics: 0x4000_0040,
    },
    PeSection {
        name: ".bunfeat",
        address: PE_STATE,
        virtual_bytes: STATE_BYTES as u32,
        raw_size: 0x400,
        raw_pointer: 0x30_9600,
        characteristics: 0x4000_0040,
    },
];

fn pe_layout(target: Target) -> ToyLayout {
    let code = sized(u64::from(PE_CODE), CODE_BYTES);
    let read_only_data = sized(u64::from(PE_READ_ONLY_DATA), DATA_BYTES);
    ToyLayout {
        target,
        code,
        read_only_data,
        state: sized(u64::from(PE_STATE), STATE_BYTES),
        table: sized(u64::from(PE_TABLE), TABLE_ROOM),
        zero_filled: sized(PE_ZERO_FILLED, PE_ZERO_FILLED_BYTES),
        stable: vec![
            code,
            read_only_data,
            sized(u64::from(PE_DATA), u64::from(PE_DATA_FILE_BYTES)),
            sized(u64::from(PE_BUILTINS), BUILTINS_BYTES),
        ],
        cut_alignment: 0x1000,
    }
}

fn build_pe(layout: &ToyLayout, has_table: bool) -> Vec<u8> {
    let mut file = vec![0; PE_FILE_BYTES];
    put(&mut file, 0, b"MZ");
    put(&mut file, 0x3c, &(PE_HEADER_OFFSET as u32).to_le_bytes());
    put_pe_headers(&mut file, layout.target.architecture);
    put_pe_section_table(&mut file, has_table);
    for (address, bytes) in [
        (PE_CODE, CODE_BYTES),
        (PE_READ_ONLY_DATA, DATA_BYTES),
        (PE_DATA, u64::from(PE_DATA_FILE_BYTES)),
        (PE_BUILTINS, BUILTINS_BYTES),
    ] {
        let range = sized(u64::from(address), bytes);
        put_pattern(
            &mut file,
            find_file_offset(ExecutableFormat::Pe, range.start),
            range,
        );
    }
    file
}

fn put_pe_headers(file: &mut [u8], architecture: Architecture) {
    let machine: u16 = match architecture {
        Architecture::X86_64 => 0x8664,
        Architecture::Aarch64 => 0xaa64,
    };
    put(file, PE_HEADER_OFFSET, b"PE\0\0");
    put(file, PE_HEADER_OFFSET + 4, &machine.to_le_bytes());
    put(
        file,
        PE_HEADER_OFFSET + 6,
        &(PE_SECTIONS.len() as u16).to_le_bytes(),
    );
    put(
        file,
        PE_HEADER_OFFSET + 20,
        &PE_OPTIONAL_HEADER_BYTES.to_le_bytes(),
    );
    put(file, PE_HEADER_OFFSET + 22, &0x23u16.to_le_bytes());

    let optional = PE_OPTIONAL_HEADER_OFFSET;
    put(file, optional, &0x20bu16.to_le_bytes());
    put(file, optional + 16, &PE_CODE.to_le_bytes());
    put(file, optional + 20, &PE_CODE.to_le_bytes());
    put(file, optional + 24, &0x1_4000_0000u64.to_le_bytes());
    put(file, optional + 32, &0x1000u32.to_le_bytes());
    put(file, optional + 36, &0x200u32.to_le_bytes());
    put(file, optional + 40, &6u16.to_le_bytes());
    put(file, optional + 48, &6u16.to_le_bytes());
    put(file, optional + 56, &PE_IMAGE_BYTES.to_le_bytes());
    put(file, optional + 60, &PE_HEADER_BYTES.to_le_bytes());
    put(file, optional + 68, &3u16.to_le_bytes());
    put(file, optional + 72, &0x10_0000u64.to_le_bytes());
    put(file, optional + 80, &0x1000u64.to_le_bytes());
    put(file, optional + 88, &0x10_0000u64.to_le_bytes());
    put(file, optional + 96, &0x1000u64.to_le_bytes());
    put(file, optional + 108, &16u32.to_le_bytes());
}

fn put_pe_section_table(file: &mut [u8], has_table: bool) {
    let mut table = Vec::new();
    for section in &PE_SECTIONS {
        let name = if !has_table && section.address == PE_TABLE {
            ".unnamed"
        } else {
            section.name
        };
        table.extend_from_slice(&padded_name::<8>(name));
        table.extend_from_slice(&section.virtual_bytes.to_le_bytes());
        table.extend_from_slice(&section.address.to_le_bytes());
        table.extend_from_slice(&section.raw_size.to_le_bytes());
        table.extend_from_slice(&section.raw_pointer.to_le_bytes());
        table.extend_from_slice(&[0; 12]);
        table.extend_from_slice(&section.characteristics.to_le_bytes());
    }
    put(file, PE_SECTION_TABLE_OFFSET, &table);
}
