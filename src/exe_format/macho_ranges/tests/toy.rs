use core::mem::offset_of;

use crate::elf_program_headers::tests::toy_byte;
use crate::macho_ranges::*;
use crate::macho_types::{
    DYLD_CHAINED_PTR_START_NONE, PROT, dyld_chained_fixups_header, dyld_chained_starts_in_segment,
    vm_prot_t,
};

pub(super) const PAGE: u64 = CUT_ALIGNMENT;
pub(super) const IMAGE_BASE: u64 = 0x1_0000_0000;
pub(super) const HEADER_PAD: usize = 0x2000;
const LINKEDIT_FILE_OFFSET: usize = 106 * PAGE as usize;
const LINKEDIT_BLOB_ALIGNMENT: usize = 16;

pub(super) const PAGEZERO_INDEX: usize = 0;
pub(super) const TEXT_INDEX: usize = 1;
const DATA_CONST_INDEX: usize = 2;
pub(super) const DATA_INDEX: usize = 3;
const SEGMENT_COUNT: usize = 6;
pub(super) const TEXT_SECTION_INDEX: usize = 0;
pub(super) const CSTRING_SECTION_INDEX: usize = 2;
pub(super) const TRIM_TABLE_SECTION_INDEX: usize = 4;
pub(super) const BSS_SECTION_INDEX: usize = 1;
pub(super) const TOY_SECTION_COUNT: usize = 11;
const FILLER_SECTION_SIZE: u64 = 16;
const TEXT_ORDINAL: u8 = 1;
const CSTRING_ORDINAL: u8 = 3;
const DATA_CONST_ORDINAL: u8 = 8;
const DATA_ORDINAL: u8 = 9;

const MH_NOUNDEFS: u32 = 0x1;
const MH_DYLDLINK: u32 = 0x4;
const MH_TWOLEVEL: u32 = 0x80;
const S_NON_LAZY_SYMBOL_POINTERS: u32 = 6;
const N_EXT: u8 = 1;
const PLATFORM_MACOS: u32 = 1;
const READ_EXECUTE: vm_prot_t = PROT::READ | PROT::EXECUTE;
const READ_WRITE: vm_prot_t = PROT::READ | PROT::WRITE;

const FIXUPS_STARTS_OFFSET: usize = 32;
const PAGE_STARTS_OFFSET: usize = offset_of!(dyld_chained_starts_in_segment, first_page_start);
const NO_CHAIN: u16 = DYLD_CHAINED_PTR_START_NONE;
const DYLD_CHAINED_PTR_64_OFFSET: u16 = 6;
const DYLD_CHAINED_IMPORT: u32 = 1;
const LIBSYSTEM_ORDINAL: u32 = 1;
pub(super) const TOY_IMPORTS: [u32; 2] = [create_import(1), create_import(9)];
pub(super) const IMPORT_NAMES: &[u8] = b"\0_malloc\0_free\0\0";
const SYMBOL_NAMES: &[u8] = b"\0_a\0_b\0_c\0_d\0_e\0_f\0";
const INDIRECT_SYMBOLS: [u32; 2] = [5, 5];

const TOY_CHAINS: [ToyChains; 2] = [
    ToyChains {
        segment_index: DATA_CONST_INDEX,
        first_page: 95,
        page_starts: &[0, 8, NO_CHAIN, 8, NO_CHAIN, 8, NO_CHAIN, 8],
    },
    ToyChains {
        segment_index: DATA_INDEX,
        first_page: 104,
        page_starts: &[16],
    },
];

const TOY_SYMBOLS: [nlist_64; 6] = [
    nlist_64 {
        n_strx: 1,
        n_type: N_SECT,
        n_sect: TEXT_ORDINAL,
        n_desc: 0,
        n_value: page(1) + 0x40,
    },
    nlist_64 {
        n_strx: 4,
        n_type: N_SECT,
        n_sect: TEXT_ORDINAL,
        n_desc: 0,
        n_value: page(83) + 0x20,
    },
    nlist_64 {
        n_strx: 7,
        n_type: N_SECT,
        n_sect: CSTRING_ORDINAL,
        n_desc: 0,
        n_value: page(90),
    },
    nlist_64 {
        n_strx: 10,
        n_type: N_SECT | N_EXT,
        n_sect: DATA_CONST_ORDINAL,
        n_desc: 0,
        n_value: page(102) + 8,
    },
    nlist_64 {
        n_strx: 13,
        n_type: N_SECT | N_EXT,
        n_sect: DATA_ORDINAL,
        n_desc: 0,
        n_value: page(104) + 0x10,
    },
    nlist_64 {
        n_strx: 16,
        n_type: N_EXT,
        n_sect: 0,
        n_desc: 0,
        n_value: 0,
    },
];

pub(super) const LINKED_TOY: ToyOptions = ToyOptions {
    architecture: Architecture::Aarch64,
    header_pad: HEADER_PAD,
    has_fixups: true,
    has_signature: true,
    filler_section_count: 0,
};

#[derive(Copy, Clone)]
pub(super) struct ToyOptions {
    pub(super) architecture: Architecture,
    pub(super) header_pad: usize,
    pub(super) has_fixups: bool,
    pub(super) has_signature: bool,
    pub(super) filler_section_count: u64,
}

struct ToyChains {
    segment_index: usize,
    first_page: u64,
    page_starts: &'static [u16],
}

struct ToySection {
    name: &'static [u8],
    section_type: u32,
    addresses: AddressRange,
}

struct ToySegment {
    name: &'static [u8],
    addresses: AddressRange,
    file_size: u64,
    protection: vm_prot_t,
    flags: u32,
    sections: Vec<ToySection>,
}

struct ToyCommands {
    commands: Vec<Vec<u8>>,
    linkedit: Vec<u8>,
}

#[derive(Copy, Clone)]
struct Blob {
    offset: u32,
    size: u32,
}

const fn page(index: u64) -> u64 {
    IMAGE_BASE + index * PAGE
}

const fn create_import(name_offset: u32) -> u32 {
    LIBSYSTEM_ORDINAL | (name_offset << 9)
}

pub(super) fn cut(first_page: u64, end_page: u64) -> AddressRange {
    AddressRange {
        start: page(first_page),
        end: page(end_page),
    }
}

fn zeroed<T: Copy>() -> T {
    read_struct(&vec![0u8; size_of::<T>()])
}

fn bytes_of<T: Copy>(value: &T) -> Vec<u8> {
    let mut bytes = vec![0; size_of::<T>()];
    write_struct(&mut bytes, value);
    bytes
}

fn words(values: &[u32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

fn pad_name(name: &[u8]) -> [u8; SEGMENT_NAME_SIZE] {
    let mut padded = [0; SEGMENT_NAME_SIZE];
    padded[..name.len()].copy_from_slice(name);
    padded
}

fn create_section(name: &'static [u8], section_type: u32, start: u64, end: u64) -> ToySection {
    ToySection {
        name,
        section_type,
        addresses: AddressRange { start, end },
    }
}

fn create_segment(
    name: &'static [u8],
    addresses: AddressRange,
    file_size: u64,
    protection: vm_prot_t,
) -> ToySegment {
    ToySegment {
        name,
        addresses,
        file_size,
        protection,
        flags: 0,
        sections: Vec::new(),
    }
}

fn create_payload_sections(filler_section_count: u64) -> Vec<ToySection> {
    let payload_end = page(107) - filler_section_count * FILLER_SECTION_SIZE;
    let mut sections = vec![create_section(b"__bun", S_REGULAR, page(106), payload_end)];
    sections.extend((0..filler_section_count).map(|index| {
        let start = payload_end + index * FILLER_SECTION_SIZE;
        create_section(b"__filler", S_REGULAR, start, start + FILLER_SECTION_SIZE)
    }));
    sections
}

fn create_toy_segments(
    text_start: u64,
    linkedit_size: u64,
    filler_section_count: u64,
) -> Vec<ToySegment> {
    let zero_page = AddressRange {
        start: 0,
        end: IMAGE_BASE,
    };
    let linkedit = AddressRange {
        start: page(107),
        end: page(107) + align_up(linkedit_size, PAGE),
    };
    vec![
        create_segment(b"__PAGEZERO", zero_page, 0, 0),
        ToySegment {
            sections: vec![
                create_section(b"__text", S_REGULAR, text_start, page(84) + 0x100),
                create_section(b"__const", S_REGULAR, page(84) + 0x100, page(88) + 0x800),
                create_section(
                    b"__cstring",
                    S_CSTRING_LITERALS,
                    page(88) + 0x800,
                    page(92) + 0x40,
                ),
                create_section(b"__bun_builtins", S_REGULAR, page(92) + 0x40, page(94)),
                create_section(b"__bun_trim", S_REGULAR, page(94), page(94) + 0x200),
                create_section(b"__bun_features", S_REGULAR, page(94) + 0x200, page(95)),
            ],
            ..create_segment(b"__TEXT", cut(0, 95), 95 * PAGE, READ_EXECUTE)
        },
        ToySegment {
            flags: SG_READ_ONLY,
            sections: vec![
                create_section(b"__got", S_NON_LAZY_SYMBOL_POINTERS, page(95), page(96)),
                create_section(b"__const", S_REGULAR, page(96), page(104)),
            ],
            ..create_segment(b"__DATA_CONST", cut(95, 104), 9 * PAGE, READ_WRITE)
        },
        ToySegment {
            sections: vec![
                create_section(b"__data", S_REGULAR, page(104), page(104) + 0x2000),
                create_section(b"__bss", S_ZEROFILL, page(104) + 0x2000, page(105) + 0x1000),
            ],
            ..create_segment(b"__DATA", cut(104, 106), PAGE, READ_WRITE)
        },
        ToySegment {
            sections: create_payload_sections(filler_section_count),
            ..create_segment(b"__BUN", cut(106, 107), PAGE, READ_WRITE)
        },
        create_segment(SEG_LINKEDIT, linkedit, linkedit_size, PROT::READ),
    ]
}

fn create_segment_command(segment: &ToySegment, file_offset: u64) -> Vec<u8> {
    let mut command: segment_command_64 = zeroed();
    command.cmd = LC::SEGMENT_64;
    command.cmdsize = (SEGMENT_COMMAND_SIZE + SECTION_SIZE * segment.sections.len()) as u32;
    command.vmaddr = segment.addresses.start;
    command.vmsize = segment.addresses.len();
    command.fileoff = file_offset;
    command.filesize = segment.file_size;
    command.maxprot = segment.protection;
    command.initprot = segment.protection;
    command.nsects = segment.sections.len() as u32;
    command.flags = segment.flags;
    let mut bytes = bytes_of(&command);
    bytes[SEGMENT_NAME_OFFSET..][..SEGMENT_NAME_SIZE].copy_from_slice(&pad_name(segment.name));
    for section in &segment.sections {
        let offset_in_segment = section.addresses.start - segment.addresses.start;
        let offset = if section.section_type == S_ZEROFILL {
            0
        } else {
            (file_offset + offset_in_segment) as u32
        };
        bytes.extend(bytes_of(&section_64 {
            sectname: pad_name(section.name),
            segname: pad_name(segment.name),
            addr: section.addresses.start,
            size: section.addresses.len(),
            offset,
            flags: section.section_type,
            ..zeroed()
        }));
    }
    bytes
}

fn create_toy_fixups() -> Vec<u8> {
    let table_offset = FIXUPS_STARTS_OFFSET + size_of::<u32>();
    let table_end = table_offset + size_of::<u32>() * SEGMENT_COUNT;
    let mut blob = vec![0; table_end.next_multiple_of(8)];
    write_struct(&mut blob[FIXUPS_STARTS_OFFSET..], &(SEGMENT_COUNT as u32));
    for chains in &TOY_CHAINS {
        let record_offset = blob.len();
        let used_size = PAGE_STARTS_OFFSET + size_of::<u16>() * chains.page_starts.len();
        let size = used_size.next_multiple_of(8);
        let table_entry = table_offset + size_of::<u32>() * chains.segment_index;
        let seg_info_offset = (record_offset - FIXUPS_STARTS_OFFSET) as u32;
        write_struct(&mut blob[table_entry..], &seg_info_offset);
        blob.extend(bytes_of(&dyld_chained_starts_in_segment {
            size: size as u32,
            page_size: PAGE as u16,
            pointer_format: DYLD_CHAINED_PTR_64_OFFSET,
            segment_offset: chains.first_page * PAGE,
            max_valid_pointer: 0,
            page_count: chains.page_starts.len() as u16,
            first_page_start: chains.page_starts[0],
        }));
        let later_page_starts = chains.page_starts[1..].iter();
        blob.extend(later_page_starts.flat_map(|start| start.to_le_bytes()));
        blob.resize(record_offset + size, 0);
    }
    let imports_offset = blob.len();
    blob.extend(words(&TOY_IMPORTS));
    let symbols_offset = blob.len();
    blob.extend_from_slice(IMPORT_NAMES);
    let header = dyld_chained_fixups_header {
        fixups_version: 0,
        starts_offset: FIXUPS_STARTS_OFFSET as u32,
        imports_offset: imports_offset as u32,
        symbols_offset: symbols_offset as u32,
        imports_count: TOY_IMPORTS.len() as u32,
        imports_format: DYLD_CHAINED_IMPORT,
        symbols_format: 0,
    };
    write_struct(&mut blob, &header);
    blob
}

fn append_blob(linkedit: &mut Vec<u8>, blob: &[u8]) -> Blob {
    linkedit.resize(linkedit.len().next_multiple_of(LINKEDIT_BLOB_ALIGNMENT), 0);
    let offset = (LINKEDIT_FILE_OFFSET + linkedit.len()) as u32;
    linkedit.extend_from_slice(blob);
    Blob {
        offset,
        size: blob.len() as u32,
    }
}

fn append_signature(linkedit: &mut Vec<u8>) -> Blob {
    let offset = append_blob(linkedit, &[]).offset;
    let size = MachoSigner::compute_signature_size(u64::from(offset));
    append_blob(linkedit, &vec![0xcc; size])
}

fn create_command(cmd: u32, body: &[u8]) -> Vec<u8> {
    let size = (size_of::<load_command>() + body.len()).next_multiple_of(8);
    let mut command = words(&[cmd, size as u32]);
    command.extend_from_slice(body);
    command.resize(size, 0);
    command
}

fn create_path_command(cmd: u32, fields_after_path_offset: &[u32], path: &[u8]) -> Vec<u8> {
    let field_count = 1 + fields_after_path_offset.len();
    let path_offset = size_of::<load_command>() + size_of::<u32>() * field_count;
    let mut body = words(&[path_offset as u32]);
    body.extend(words(fields_after_path_offset));
    body.extend_from_slice(path);
    create_command(cmd, &body)
}

fn create_linkedit_data_command(cmd: u32, blob: Blob) -> Vec<u8> {
    bytes_of(&linkedit_data_command {
        cmd,
        cmdsize: size_of::<linkedit_data_command>() as u32,
        dataoff: blob.offset,
        datasize: blob.size,
    })
}

fn create_symbol_table_commands(linkedit: &mut Vec<u8>) -> [Vec<u8>; 2] {
    let symbols: Vec<u8> = TOY_SYMBOLS.iter().flat_map(bytes_of).collect();
    let symbols = append_blob(linkedit, &symbols);
    let indirect_symbols = append_blob(linkedit, &words(&INDIRECT_SYMBOLS));
    let names = append_blob(linkedit, SYMBOL_NAMES);
    let symbol_table = symtab_command {
        cmd: LC::SYMTAB,
        cmdsize: size_of::<symtab_command>() as u32,
        symoff: symbols.offset,
        nsyms: TOY_SYMBOLS.len() as u32,
        stroff: names.offset,
        strsize: names.size,
    };
    let dynamic_symbol_table = dysymtab_command {
        cmd: LC::DYSYMTAB,
        cmdsize: size_of::<dysymtab_command>() as u32,
        nlocalsym: 3,
        iextdefsym: 3,
        nextdefsym: 2,
        iundefsym: 5,
        nundefsym: 1,
        indirectsymoff: indirect_symbols.offset,
        nindirectsyms: INDIRECT_SYMBOLS.len() as u32,
        ..zeroed()
    };
    [bytes_of(&symbol_table), bytes_of(&dynamic_symbol_table)]
}

fn create_toy_commands(options: ToyOptions, text_start: u64) -> ToyCommands {
    let mut linkedit = Vec::new();
    let fixups = options
        .has_fixups
        .then(|| append_blob(&mut linkedit, &create_toy_fixups()));
    let exports_trie = append_blob(&mut linkedit, b"toy exports trie");
    let function_starts = append_blob(&mut linkedit, b"toy function starts");
    let symbol_table_commands = create_symbol_table_commands(&mut linkedit);
    let signature = options
        .has_signature
        .then(|| append_signature(&mut linkedit));

    let mut commands = Vec::new();
    let mut file_offset = 0;
    let linkedit_size = linkedit.len() as u64;
    for segment in create_toy_segments(text_start, linkedit_size, options.filler_section_count) {
        commands.push(create_segment_command(&segment, file_offset));
        file_offset += segment.file_size;
    }
    let entry_point = [(PAGE + 0x40).to_le_bytes(), 0u64.to_le_bytes()].concat();
    let build_version = words(&[PLATFORM_MACOS, 0xd_0000, 0xf_0000, 0]);
    commands.extend(fixups.map(|blob| create_linkedit_data_command(LC::DYLD_CHAINED_FIXUPS, blob)));
    commands.push(create_linkedit_data_command(
        LC::DYLD_EXPORTS_TRIE,
        exports_trie,
    ));
    commands.extend(symbol_table_commands);
    commands.extend([
        create_path_command(LC::LOAD_DYLINKER, &[], b"/usr/lib/dyld"),
        create_command(LC::UUID, b"toy Mach-O UUID."),
        create_command(LC::BUILD_VERSION, &build_version),
        create_command(LC::MAIN, &entry_point),
        create_path_command(LC::LOAD_DYLIB, &[2, 0, 0], b"/usr/lib/libSystem.B.dylib"),
        create_linkedit_data_command(LC::FUNCTION_STARTS, function_starts),
    ]);
    commands.extend(signature.map(|blob| create_linkedit_data_command(LC::CODE_SIGNATURE, blob)));
    ToyCommands { commands, linkedit }
}

pub(super) fn create_toy(options: ToyOptions) -> Vec<u8> {
    let commands_size = create_toy_commands(options, IMAGE_BASE)
        .commands
        .concat()
        .len();
    let text_start = IMAGE_BASE + (HEADER_SIZE + commands_size + options.header_pad) as u64;
    let ToyCommands { commands, linkedit } = create_toy_commands(options, text_start);
    let header = mach_header_64 {
        magic: MH_MAGIC_64,
        cputype: match options.architecture {
            Architecture::X86_64 => CPU_TYPE_X86_64,
            Architecture::Aarch64 => CPU_TYPE_ARM64,
        },
        cpusubtype: 0,
        filetype: MH_EXECUTE,
        ncmds: commands.len() as u32,
        sizeofcmds: commands_size as u32,
        flags: MH_NOUNDEFS | MH_DYLDLINK | MH_TWOLEVEL,
        reserved: 0,
    };
    let mut bytes = bytes_of(&header);
    bytes.extend(commands.concat());
    bytes.resize(LINKEDIT_FILE_OFFSET, 0);
    bytes.extend(linkedit);
    for span in mapped_spans(&bytes).unwrap() {
        let first_address = span.addresses.start.max(text_start);
        let first_offset = span.file_offset + (first_address - span.addresses.start);
        let addresses = first_address..span.addresses.end;
        for (byte, address) in bytes[first_offset as usize..].iter_mut().zip(addresses) {
            *byte = toy_byte(address);
        }
    }
    bytes
}

pub(crate) fn toy_macho(architecture: Architecture) -> Vec<u8> {
    create_toy(ToyOptions {
        architecture,
        ..LINKED_TOY
    })
}
