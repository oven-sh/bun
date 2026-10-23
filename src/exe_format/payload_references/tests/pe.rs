use core::mem::size_of;

use super::super::pe::{
    BASE_RELOCATION_DIRECTORY, EXPORT_DIRECTORY, ExportDirectory, IMAGE_REL_BASED_DIR64,
    IMAGE_REL_BASED_HIGHLOW, IMPORT_ADDRESS_TABLE_DIRECTORY, OPTIONAL_HEADER_MAGIC_64,
    RELOCATION_BLOCK_HEADER_SIZE,
};
use super::{
    Checked, MalformedExecutable, UnsupportedRelocations, check, dynamic_symbol_at, put,
    put_struct, relocation_at, zeroed,
};
use crate::pe::{
    DOSHeader, DataDirectory, OptionalHeader64, PE_SIGNATURE, PEHeader, SectionHeader,
};

const PAGE: u32 = 0x1000;
const HEADER_OFFSET: usize = 0x80;
const READ_ONLY_DATA: (u32, u32, u32) = (PAGE, 0x400, 0x600);
const RELOCATIONS: (u32, u32, u32) = (2 * PAGE, 0xa00, 0x200);
const START: u32 = 3 * PAGE;
const SIZE: u32 = PAGE + 0x100;
const END: u32 = START + SIZE;
const PAYLOAD_OFFSET: u32 = 0xc00;
const PAYLOAD_RAW_SIZE: u32 = 0x1200;
const EXPORTS_ADDRESS: u32 = READ_ONLY_DATA.0;
const EXPORTS_SIZE: u32 = 0x100;
const FUNCTIONS_ADDRESS: u32 = EXPORTS_ADDRESS + size_of::<ExportDirectory>() as u32;
const IMPORT_ADDRESSES: DataDirectory = DataDirectory {
    virtual_address: READ_ONLY_DATA.0 + 0x200,
    size: 0x40,
};
const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;
const IMAGE_REL_BASED_MIPS_JMPADDR: u16 = 5;

struct Toy {
    relocation_blocks: Vec<u8>,
    exported_functions: Vec<u32>,
    import_addresses: DataDirectory,
}

impl Default for Toy {
    fn default() -> Toy {
        Toy {
            relocation_blocks: Vec::new(),
            exported_functions: Vec::new(),
            import_addresses: IMPORT_ADDRESSES,
        }
    }
}

fn section(name: &[u8], (address, offset, raw_size): (u32, u32, u32), size: u32) -> SectionHeader {
    let mut section: SectionHeader = zeroed();
    section.name[..name.len()].copy_from_slice(name);
    section.virtual_address = address;
    section.virtual_size = size;
    section.pointer_to_raw_data = offset;
    section.size_of_raw_data = raw_size;
    section
}

fn file_offset_in(section: (u32, u32, u32), address: u32) -> usize {
    (section.1 + (address - section.0)) as usize
}

impl Toy {
    fn build(&self) -> Vec<u8> {
        let sections = [
            section(b".rdata", READ_ONLY_DATA, READ_ONLY_DATA.2),
            section(b".reloc", RELOCATIONS, RELOCATIONS.2),
            section(b".bun", (START, PAYLOAD_OFFSET, PAYLOAD_RAW_SIZE), SIZE),
        ];
        let mut file = vec![0u8; (PAYLOAD_OFFSET + PAYLOAD_RAW_SIZE) as usize];
        let mut dos: DOSHeader = zeroed();
        dos.e_magic = u16::from_le_bytes(*b"MZ");
        dos.e_lfanew = HEADER_OFFSET as u32;
        put_struct(&mut file, 0, &dos);

        let mut header: PEHeader = zeroed();
        header.signature = PE_SIGNATURE;
        header.number_of_sections = sections.len() as u16;
        header.size_of_optional_header = size_of::<OptionalHeader64>() as u16;
        put_struct(&mut file, HEADER_OFFSET, &header);

        let optional_offset = HEADER_OFFSET + size_of::<PEHeader>();
        put_struct(&mut file, optional_offset, &self.optional_header());
        let sections_offset = optional_offset + size_of::<OptionalHeader64>();
        for (index, section) in sections.iter().enumerate() {
            put_struct(
                &mut file,
                sections_offset + index * size_of::<SectionHeader>(),
                section,
            );
        }

        assert!(self.relocation_blocks.len() <= RELOCATIONS.2 as usize);
        put(&mut file, RELOCATIONS.1 as usize, &self.relocation_blocks);
        let mut exports: ExportDirectory = zeroed();
        exports.number_of_functions = self.exported_functions.len() as u32;
        exports.address_of_functions = FUNCTIONS_ADDRESS;
        put_struct(
            &mut file,
            file_offset_in(READ_ONLY_DATA, EXPORTS_ADDRESS),
            &exports,
        );
        let functions = self
            .exported_functions
            .iter()
            .flat_map(|it| it.to_le_bytes());
        let functions: Vec<u8> = functions.collect();
        put(
            &mut file,
            file_offset_in(READ_ONLY_DATA, FUNCTIONS_ADDRESS),
            &functions,
        );
        file
    }

    fn optional_header(&self) -> OptionalHeader64 {
        let mut optional: OptionalHeader64 = zeroed();
        optional.magic = OPTIONAL_HEADER_MAGIC_64;
        optional.number_of_rva_and_sizes = 16;
        optional.data_directories[EXPORT_DIRECTORY] = DataDirectory {
            virtual_address: EXPORTS_ADDRESS,
            size: EXPORTS_SIZE,
        };
        optional.data_directories[BASE_RELOCATION_DIRECTORY] = DataDirectory {
            virtual_address: RELOCATIONS.0,
            size: self.relocation_blocks.len() as u32,
        };
        optional.data_directories[IMPORT_ADDRESS_TABLE_DIRECTORY] = self.import_addresses;
        optional
    }
}

fn block(page_address: u32, entries: &[(u16, u16)]) -> Vec<u8> {
    let size = RELOCATION_BLOCK_HEADER_SIZE + size_of::<u16>() * entries.len();
    let mut block = [page_address.to_le_bytes(), (size as u32).to_le_bytes()].concat();
    for (kind, offset) in entries {
        block.extend_from_slice(&((kind << 12) | offset).to_le_bytes());
    }
    block
}

fn check_blocks(blocks: &[Vec<u8>]) -> Checked {
    let toy = Toy {
        relocation_blocks: blocks.concat(),
        ..Toy::default()
    };
    check(&toy.build())
}

fn check_relocation(kind: u16, address: u32) -> Checked {
    let elsewhere = block(
        PAGE,
        &[(IMAGE_REL_BASED_DIR64, 0x10), (IMAGE_REL_BASED_ABSOLUTE, 0)],
    );
    let offset_in_page = (address % PAGE) as u16;
    check_blocks(&[
        elsewhere,
        block(address - address % PAGE, &[(kind, offset_in_page)]),
    ])
}

#[test]
fn executable_without_relocations_or_exports_is_accepted() {
    assert_eq!(check(&Toy::default().build()), Ok(()));
}

#[test]
fn base_relocation_in_payload_is_refused() {
    for address in [START - 7, START, START + PAGE, END - 1] {
        let refused = relocation_at(u64::from(address));
        assert_eq!(check_relocation(IMAGE_REL_BASED_DIR64, address), refused);
    }
    let refused = relocation_at(u64::from(START - 3));
    assert_eq!(
        check_relocation(IMAGE_REL_BASED_HIGHLOW, START - 3),
        refused
    );
}

#[test]
fn base_relocation_beside_payload_is_accepted() {
    for address in [START - 8, END] {
        assert_eq!(check_relocation(IMAGE_REL_BASED_DIR64, address), Ok(()));
    }
    assert_eq!(check_relocation(IMAGE_REL_BASED_HIGHLOW, START - 4), Ok(()));
}

#[test]
fn padding_entry_is_no_relocation() {
    assert_eq!(check_relocation(IMAGE_REL_BASED_ABSOLUTE, START), Ok(()));
}

#[test]
fn unreadable_base_relocations_are_told_apart() {
    let unsupported = check_relocation(IMAGE_REL_BASED_MIPS_JMPADDR, PAGE);
    assert_eq!(unsupported, Err(UnsupportedRelocations));

    let mut ends_past_directory = block(PAGE, &[(IMAGE_REL_BASED_DIR64, 0)]);
    ends_past_directory[4] += 4;
    assert_eq!(
        check_blocks(&[ends_past_directory]),
        Err(MalformedExecutable)
    );
    let mut smaller_than_header = block(PAGE, &[(IMAGE_REL_BASED_DIR64, 0)]);
    smaller_than_header[4] = 4;
    assert_eq!(
        check_blocks(&[smaller_than_header]),
        Err(MalformedExecutable)
    );
}

fn check_exports(functions: &[u32]) -> Checked {
    let toy = Toy {
        exported_functions: functions.to_vec(),
        ..Toy::default()
    };
    check(&toy.build())
}

#[test]
fn export_in_payload_is_refused() {
    for address in [START, END - 1] {
        let refused = dynamic_symbol_at(u64::from(address));
        assert_eq!(check_exports(&[PAGE + 0x300, address]), refused);
    }
}

#[test]
fn export_beside_payload_is_accepted() {
    assert_eq!(check_exports(&[START - 1, END]), Ok(()));
}

#[test]
fn export_without_address_is_accepted() {
    let forwarder = EXPORTS_ADDRESS + EXPORTS_SIZE - 8;
    assert_eq!(check_exports(&[0, forwarder]), Ok(()));
}

#[test]
fn import_addresses_in_payload_are_refused() {
    let check_table = |virtual_address: u32, size: u32| {
        let toy = Toy {
            import_addresses: DataDirectory {
                virtual_address,
                size,
            },
            ..Toy::default()
        };
        check(&toy.build())
    };
    assert_eq!(check_table(START, 8), relocation_at(u64::from(START)));
    assert_eq!(
        check_table(START - 8, 16),
        relocation_at(u64::from(START - 8))
    );
    assert_eq!(check_table(START - 8, 8), Ok(()));
    assert_eq!(check_table(END, 8), Ok(()));
}

#[test]
fn directory_outside_every_section_is_malformed() {
    let mut file = toy_with_relocations();
    let optional_offset = HEADER_OFFSET + size_of::<PEHeader>();
    let mut optional: OptionalHeader64 = crate::read_struct(&file[optional_offset..]);
    optional.data_directories[BASE_RELOCATION_DIRECTORY].virtual_address = 0x10 * PAGE;
    put_struct(&mut file, optional_offset, &optional);
    assert_eq!(check(&file), Err(MalformedExecutable));
}

fn toy_with_relocations() -> Vec<u8> {
    let toy = Toy {
        relocation_blocks: block(PAGE, &[(IMAGE_REL_BASED_DIR64, 0), (0, 0)]),
        ..Toy::default()
    };
    toy.build()
}
