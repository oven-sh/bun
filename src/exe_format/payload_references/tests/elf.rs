use core::mem::size_of;

use super::super::elf::{
    DynamicSymbol, SHN_ABS, SHT_ANDROID_REL, SHT_ANDROID_RELA, SHT_ANDROID_RELR, SHT_DYNSYM,
    SHT_REL, SHT_RELA, SHT_RELR, STT_TLS,
};
use super::{
    MalformedExecutable, NoPayload, UnsupportedRelocations, bytes_of, check, dynamic_symbol_at,
    put, put_struct, relocation_at, zeroed,
};
use crate::elf::{Elf64_Ehdr, Elf64_Shdr, SHF_ALLOC, SHT_PROGBITS, SHT_STRTAB, SHT_SYMTAB};

const START: u64 = 0x60_0000;
const SIZE: u64 = 0x1100;
const END: u64 = START + SIZE;
const NAMES_OFFSET: usize = 0x400;
const TABLES_OFFSET: usize = 0x800;
const PAYLOAD_OFFSET: usize = 0x2000;
const DATA_SECTION_INDEX: u16 = 1;

struct Table {
    kind: u32,
    flags: u64,
    bytes: Vec<u8>,
}

fn loaded(kind: u32, bytes: Vec<u8>) -> Table {
    let flags = SHF_ALLOC;
    Table { kind, flags, bytes }
}

fn toy_with_payload_name(tables: &[Table], payload_name: &[u8]) -> Vec<u8> {
    let mut file = vec![0u8; PAYLOAD_OFFSET + SIZE as usize];
    let mut names = vec![0u8];
    let mut headers = vec![zeroed::<Elf64_Shdr>()];
    let mut add = |name: &[u8], kind: u32, flags: u64, (address, offset, size): (u64, u64, u64)| {
        let mut header: Elf64_Shdr = zeroed();
        header.sh_name = names.len() as u32;
        header.sh_type = kind;
        header.sh_flags = flags;
        header.sh_addr = address;
        header.sh_offset = offset;
        header.sh_size = size;
        headers.push(header);
        names.extend_from_slice(name);
        names.push(0);
    };

    let mut offset = TABLES_OFFSET;
    for table in tables {
        put(&mut file, offset, &table.bytes);
        let extent = (
            0x20_0000 + offset as u64,
            offset as u64,
            table.bytes.len() as u64,
        );
        add(b".table", table.kind, table.flags, extent);
        offset += table.bytes.len().next_multiple_of(8);
    }
    assert!(offset <= PAYLOAD_OFFSET);
    add(
        payload_name,
        SHT_PROGBITS,
        SHF_ALLOC,
        (START, PAYLOAD_OFFSET as u64, SIZE),
    );
    add(b".shstrtab", SHT_STRTAB, 0, (0, NAMES_OFFSET as u64, 0x100));
    assert!(names.len() <= 0x100 && size_of::<Elf64_Ehdr>() + headers.len() * 64 <= NAMES_OFFSET);

    let mut ehdr: Elf64_Ehdr = zeroed();
    ehdr.e_ident[..6].copy_from_slice(b"\x7fELF\x02\x01");
    ehdr.e_shoff = size_of::<Elf64_Ehdr>() as u64;
    ehdr.e_shentsize = size_of::<Elf64_Shdr>() as u16;
    ehdr.e_shnum = headers.len() as u16;
    ehdr.e_shstrndx = headers.len() as u16 - 1;
    put_struct(&mut file, 0, &ehdr);
    for (index, header) in headers.iter().enumerate() {
        let offset = size_of::<Elf64_Ehdr>() + index * size_of::<Elf64_Shdr>();
        put_struct(&mut file, offset, header);
    }
    put(&mut file, NAMES_OFFSET, &names);
    file
}

fn toy(tables: &[Table]) -> Vec<u8> {
    toy_with_payload_name(tables, b".bun")
}

fn words(words: &[u64]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

fn rela(address: u64) -> Table {
    loaded(SHT_RELA, words(&[START - 0x100, 8, 0, address, 8, 0]))
}

fn rel(address: u64) -> Table {
    loaded(SHT_REL, words(&[START - 0x100, 8, address, 8]))
}

fn defined_symbol(value: u64, size: u64) -> DynamicSymbol {
    DynamicSymbol {
        name: 1,
        info: 0x11,
        other: 0,
        section_index: DATA_SECTION_INDEX,
        value,
        size,
    }
}

fn symbols(kind: u32, symbol: DynamicSymbol) -> Table {
    let entries = [
        zeroed::<DynamicSymbol>(),
        defined_symbol(START - 0x100, 8),
        symbol,
    ];
    loaded(kind, entries.iter().flat_map(bytes_of).collect())
}

#[test]
fn relocation_in_payload_is_refused() {
    for address in [START - 7, START, START + 8, END - 8, END - 1] {
        assert_eq!(check(&toy(&[rela(address)])), relocation_at(address));
        assert_eq!(check(&toy(&[rel(address)])), relocation_at(address));
    }
}

#[test]
fn relocation_beside_payload_is_accepted() {
    for address in [START - 8, END] {
        assert_eq!(check(&toy(&[rela(address)])), Ok(()));
        assert_eq!(check(&toy(&[rel(address)])), Ok(()));
    }
    assert_eq!(check(&toy(&[])), Ok(()));
}

#[test]
fn every_loaded_table_is_read() {
    let tables = [rela(START - 8), rel(END), rela(START)];
    assert_eq!(check(&toy(&tables)), relocation_at(START));
}

#[test]
fn table_that_is_not_loaded_is_ignored() {
    let mut table = rela(START);
    table.flags = 0;
    assert_eq!(check(&toy(&[table])), Ok(()));
}

#[test]
fn packed_relative_relocations_are_expanded() {
    for kind in [SHT_RELR, SHT_ANDROID_RELR] {
        let check_words = |entries: &[u64]| check(&toy(&[loaded(kind, words(entries))]));
        assert_eq!(check_words(&[START]), relocation_at(START));
        assert_eq!(check_words(&[START - 8, END]), Ok(()));
        // The bitmap starts at START - 8: bit 1 names that word, bit 2 the first word of the payload.
        assert_eq!(check_words(&[START - 16, 0b011]), Ok(()));
        assert_eq!(check_words(&[START - 16, 0b101]), relocation_at(START));
        // A second bitmap goes on 63 words after the first.
        let first_bitmap_start = START - 63 * 8;
        assert_eq!(
            check_words(&[first_bitmap_start - 8, 1, 0b011]),
            relocation_at(START)
        );
        assert_eq!(check_words(&[first_bitmap_start - 16, 1, 0b011]), Ok(()));
    }
}

#[test]
fn unknown_packing_is_unsupported() {
    for kind in [SHT_ANDROID_REL, SHT_ANDROID_RELA] {
        let table = loaded(kind, b"APS2\0\0\0\0".to_vec());
        assert_eq!(check(&toy(&[table])), Err(UnsupportedRelocations));
    }
}

#[test]
fn dynamic_symbol_in_payload_is_refused() {
    let extents = [
        (START + 1, 0),
        (START, 8),
        (END - 1, 0),
        (START - 16, 17),
        (START - 1, SIZE),
    ];
    for (value, size) in extents {
        let table = symbols(SHT_DYNSYM, defined_symbol(value, size));
        assert_eq!(check(&toy(&[table])), dynamic_symbol_at(value));
    }
}

#[test]
fn dynamic_symbol_beside_payload_is_accepted() {
    for (value, size) in [
        (START - 1, 0),
        (START, 0),
        (START - 16, 16),
        (END, 0),
        (END, 64),
    ] {
        let table = symbols(SHT_DYNSYM, defined_symbol(value, size));
        assert_eq!(check(&toy(&[table])), Ok(()));
    }
}

#[test]
fn symbol_without_address_is_accepted() {
    let undefined = DynamicSymbol {
        section_index: 0,
        ..defined_symbol(START, 8)
    };
    let absolute = DynamicSymbol {
        section_index: SHN_ABS,
        ..defined_symbol(START, 8)
    };
    let thread_local = DynamicSymbol {
        info: 0x10 | STT_TLS,
        ..defined_symbol(START, 8)
    };
    for symbol in [undefined, absolute, thread_local] {
        assert_eq!(check(&toy(&[symbols(SHT_DYNSYM, symbol)])), Ok(()));
    }
}

#[test]
fn symbol_for_debuggers_may_name_payload() {
    let table = symbols(SHT_SYMTAB, defined_symbol(START, 8));
    assert_eq!(check(&toy(&[table])), Ok(()));
}

#[test]
fn damaged_tables_are_malformed() {
    let mut partial_entry = rela(START - 8);
    partial_entry.bytes.pop();
    assert_eq!(check(&toy(&[partial_entry])), Err(MalformedExecutable));

    let mut outside_file = toy(&[rela(START - 8)]);
    let header_offset = size_of::<Elf64_Ehdr>() + size_of::<Elf64_Shdr>();
    let mut header: Elf64_Shdr = crate::read_struct(&outside_file[header_offset..]);
    header.sh_offset = outside_file.len() as u64;
    put_struct(&mut outside_file, header_offset, &header);
    assert_eq!(check(&outside_file), Err(MalformedExecutable));
}

#[test]
fn executable_without_payload_section_has_no_payload() {
    assert_eq!(check(&toy_with_payload_name(&[], b".data")), Err(NoPayload));
}
