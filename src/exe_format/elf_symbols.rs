use core::mem::{offset_of, size_of};

use bun_core::slice_to_nul;

use crate::elf::{
    EM_AARCH64, EM_X86_64, Elf64_Ehdr, Elf64_Shdr, SHF_ALLOC, SHF_EXECINSTR, SHF_WRITE,
    SHN_LORESERVE, SHT_NOBITS, SHT_PROGBITS, SHT_STRTAB, SHT_SYMTAB, STT_FUNC, read_ehdr,
    validate_elf64_le,
};
use crate::image::KnownSection;
use crate::{align_up, read_struct, write_struct};

const TABLE_HEADER_SIZE: usize = 16;
const TABLE_ENTRY_SIZE: usize = 12;
const PAYLOAD_LENGTH_PREFIX_SIZE: u64 = size_of::<u64>() as u64;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct Symbol {
    pub(crate) offset: u32,
    pub(crate) size: u32,
    pub(crate) name_offset: u32,
}

pub(crate) struct SymbolTable<'a> {
    pub(crate) code_offset: u32,
    pub(crate) code_size: u32,
    pub(crate) names: &'a [u8],
    entries: &'a [u8],
}

fn decode_words<const COUNT: usize>(bytes: &[u8]) -> [u32; COUNT] {
    let words = bytes.as_chunks::<4>().0;
    core::array::from_fn(|index| u32::from_le_bytes(words[index]))
}

impl<'a> SymbolTable<'a> {
    pub(crate) fn parse(table: &'a [u8]) -> Option<SymbolTable<'a>> {
        let (header, body) = table.split_first_chunk::<TABLE_HEADER_SIZE>()?;
        let [count, names_size, code_offset, code_size] = decode_words(header);
        let entries_size = (count as usize).checked_mul(TABLE_ENTRY_SIZE)?;
        let (entries, names_and_rest) = body.split_at_checked(entries_size)?;
        let names = names_and_rest.get(..names_size as usize)?;
        if names.last().is_some_and(|&last| last != 0) {
            return None;
        }
        let symbols = SymbolTable {
            code_offset,
            code_size,
            names,
            entries,
        };
        let is_in_bounds = |symbol: Symbol| {
            (symbol.name_offset as usize) < names.len()
                && symbol.offset as u64 + symbol.size as u64 <= code_size as u64
        };
        let is_valid = symbols.iter().all(is_in_bounds);
        is_valid.then_some(symbols)
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len() / TABLE_ENTRY_SIZE
    }

    pub(crate) fn code_address(&self, payload_address: u64, image_offset: u64) -> Option<u64> {
        payload_address
            .checked_add(PAYLOAD_LENGTH_PREFIX_SIZE)?
            .checked_add(image_offset)?
            .checked_add(self.code_offset as u64)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = Symbol> + 'a {
        let entries = self.entries.as_chunks::<TABLE_ENTRY_SIZE>().0;
        entries.iter().map(|entry| {
            let [offset, size, name_offset] = decode_words(entry);
            Symbol {
                offset,
                size,
                name_offset,
            }
        })
    }
}

pub struct SymbolsTail {
    pub bytes: Vec<u8>,
    pub offset: u64,
    pub section_headers_offset: u64,
    pub number_of_sections: u16,
}

const E_SHOFF_OFFSET: u64 = offset_of!(Elf64_Ehdr, e_shoff) as u64;
const E_SHNUM_OFFSET: u64 = offset_of!(Elf64_Ehdr, e_shnum) as u64;

impl SymbolsTail {
    pub fn write(&self, mut write_at: impl FnMut(u64, &[u8]) -> bool) -> bool {
        write_at(self.offset, &self.bytes)
            && write_at(E_SHOFF_OFFSET, &self.section_headers_offset.to_le_bytes())
            && write_at(E_SHNUM_OFFSET, &self.number_of_sections.to_le_bytes())
    }
}

const NEW_SECTION_NAMES: &[u8] = b".symtab\0.strtab\0.debug_frame\0.bun.pointer\0";
const STRTAB_NAME: u32 = 8;
const DEBUG_FRAME_NAME: u32 = 16;
const POINTER_NAME: u32 = 29;
const _: () = assert!(NEW_SECTION_NAMES[STRTAB_NAME as usize - 1] == 0);
const _: () = assert!(NEW_SECTION_NAMES[DEBUG_FRAME_NAME as usize - 1] == 0);
const _: () = assert!(NEW_SECTION_NAMES[POINTER_NAME as usize - 1] == 0);

const MAX_NEW_SECTIONS: usize = 4;
const MAX_OLD_SECTION_NAMES_SIZE: u64 = u32::MAX as u64 - NEW_SECTION_NAMES.len() as u64;
const SECTION_HEADER_SIZE: usize = size_of::<Elf64_Shdr>();
const SYMBOL_ENTRY_SIZE: usize = 24;

const DW_CIE_ID: u32 = u32::MAX;
const DW_CIE_VERSION: u8 = 1;
const DW_CFA_NOP: u8 = 0;
const DW_CFA_DEF_CFA: u8 = 0x0c;
const DW_CFA_OFFSET: u8 = 0x80;
const EMPTY_AUGMENTATION: u8 = 0;
const CODE_ALIGNMENT_FACTOR: u8 = 1;
const DATA_ALIGNMENT_FACTOR: u8 = 0x78; // -8 as SLEB128
const CIE_OFFSET: u32 = 0;
const FRAME_ENTRY_LENGTH: u32 = 20;
const DEBUG_FRAME_SIZE: u64 = 2 * (size_of::<u32>() as u64 + FRAME_ENTRY_LENGTH as u64);

#[derive(Copy, Clone)]
struct FrameRegisters {
    frame_pointer: u8,
    return_address: u8,
}

struct SectionTable {
    headers: Vec<u8>,
    names: Vec<u8>,
    names_index: usize,
    bun_index: u16,
    bun_address: u64,
    symbols_index: Option<usize>,
}

/// The symbol table that the file has already. A file has at most one, so the new symbols go into it.
struct OwnSymbols {
    index: usize,
    strings_index: usize,
    entries: Vec<u8>,
    strings: Vec<u8>,
    first_global: usize,
}

struct TailBuilder {
    offset: u64,
    bytes: Vec<u8>,
}

impl TailBuilder {
    fn next_aligned_offset(&mut self) -> u64 {
        let bytes = &mut self.bytes;
        bytes.resize(align_up(bytes.len() as u64, 8) as usize, 0);
        self.offset + bytes.len() as u64
    }
}

fn read_section_header(headers: &[u8], index: usize) -> Elf64_Shdr {
    read_struct(&headers[index * SECTION_HEADER_SIZE..][..SECTION_HEADER_SIZE])
}

fn write_section_header(headers: &mut [u8], index: usize, shdr: &Elf64_Shdr) {
    let entry = &mut headers[index * SECTION_HEADER_SIZE..][..SECTION_HEADER_SIZE];
    write_struct(entry, shdr);
}

fn read_section_table(
    file_size: u64,
    read: &mut impl FnMut(u64, &mut [u8]) -> bool,
    ehdr: &Elf64_Ehdr,
) -> Option<SectionTable> {
    let shnum = ehdr.e_shnum as usize;
    let names_index = ehdr.e_shstrndx as usize;
    if names_index >= shnum || shnum + MAX_NEW_SECTIONS >= SHN_LORESERVE {
        return None;
    }
    let mut headers = vec![0u8; shnum * SECTION_HEADER_SIZE];
    if !read(ehdr.e_shoff, &mut headers) {
        return None;
    }
    let names_section = read_section_header(&headers, names_index);
    if names_section.sh_size > file_size.min(MAX_OLD_SECTION_NAMES_SIZE) {
        return None;
    }
    let mut names = vec![0u8; usize::try_from(names_section.sh_size).ok()?];
    if !read(names_section.sh_offset, &mut names) {
        return None;
    }
    let bun_name = KnownSection::Payload.names().elf;
    let mut bun: Option<(u16, u64)> = None;
    let mut symbols_index: Option<usize> = None;
    for index in 0..shnum {
        let shdr = read_section_header(&headers, index);
        if shdr.sh_type == SHT_SYMTAB && symbols_index.replace(index).is_some() {
            return None;
        }
        let name = names.get(shdr.sh_name as usize..).map(slice_to_nul);
        if name == Some(bun_name) {
            bun = Some((index as u16, shdr.sh_addr));
        }
    }
    let (bun_index, bun_address) = bun?;
    Some(SectionTable {
        headers,
        names,
        names_index,
        bun_index,
        bun_address,
        symbols_index,
    })
}

fn read_section(
    file_size: u64,
    read: &mut impl FnMut(u64, &mut [u8]) -> bool,
    section: &Elf64_Shdr,
) -> Option<Vec<u8>> {
    if section.sh_size > file_size {
        return None;
    }
    let mut bytes = vec![0u8; usize::try_from(section.sh_size).ok()?];
    read(section.sh_offset, &mut bytes).then_some(bytes)
}

fn read_own_symbols(
    file_size: u64,
    read: &mut impl FnMut(u64, &mut [u8]) -> bool,
    sections: &SectionTable,
    index: usize,
) -> Option<OwnSymbols> {
    let headers = &sections.headers;
    let count = headers.len() / SECTION_HEADER_SIZE;
    let table = read_section_header(headers, index);
    let strings_index = table.sh_link as usize;
    // New symbols move the ones behind them, so nothing else may number the symbols of this table.
    let is_numbered_elsewhere = (0..count).any(|other| {
        other != index && read_section_header(headers, other).sh_link as usize == index
    });
    if is_numbered_elsewhere || strings_index >= count || strings_index == sections.names_index {
        return None;
    }
    let strings_section = read_section_header(headers, strings_index);
    if strings_section.sh_type != SHT_STRTAB || table.sh_entsize != SYMBOL_ENTRY_SIZE as u64 {
        return None;
    }
    let entries = read_section(file_size, read, &table)?;
    let strings = read_section(file_size, read, &strings_section)?;
    let first_global = table.sh_info as usize;
    let has_whole_entries = entries.len() % SYMBOL_ENTRY_SIZE == 0;
    let has_null_symbol = (1..=entries.len() / SYMBOL_ENTRY_SIZE).contains(&first_global);
    (has_whole_entries && has_null_symbol && strings.last() == Some(&0)).then_some(OwnSymbols {
        index,
        strings_index,
        entries,
        strings,
        first_global,
    })
}

fn find_pointer_section(
    read: &mut impl FnMut(u64, &mut [u8]) -> bool,
    headers: &[u8],
    bun_index: u16,
    bun_address: u64,
    sh_name: u32,
) -> Option<Elf64_Shdr> {
    let previous_section = read_section_header(headers, (bun_index as usize).checked_sub(1)?);
    if previous_section.sh_type == SHT_NOBITS || previous_section.sh_flags & SHF_ALLOC == 0 {
        return None;
    }
    let previous_section_end = (previous_section.sh_addr).checked_add(previous_section.sh_size)?;
    let address = previous_section_end.checked_next_multiple_of(8)?;
    let offset = (previous_section.sh_offset).checked_add(address - previous_section.sh_addr)?;
    let mut stored = [0u8; 8];
    let is_pointer = read(offset, &mut stored) && u64::from_le_bytes(stored) == bun_address;
    is_pointer.then_some(Elf64_Shdr {
        sh_name,
        sh_type: SHT_PROGBITS,
        sh_flags: SHF_ALLOC | SHF_WRITE,
        sh_addr: address,
        sh_offset: offset,
        sh_size: 8,
        sh_link: 0,
        sh_info: 0,
        sh_addralign: 8,
        sh_entsize: 0,
    })
}

fn append_string_table(tail: &mut TailBuilder, sh_name: u32, symbol_names: &[u8]) -> Elf64_Shdr {
    let strtab_offset = tail.next_aligned_offset();
    tail.bytes.push(0);
    tail.bytes.extend_from_slice(symbol_names);
    Elf64_Shdr {
        sh_name,
        sh_type: SHT_STRTAB,
        sh_flags: 0,
        sh_addr: 0,
        sh_offset: strtab_offset,
        sh_size: 1 + symbol_names.len() as u64,
        sh_link: 0,
        sh_info: 0,
        sh_addralign: 1,
        sh_entsize: 0,
    }
}

fn append_symbol_table(
    tail: &mut TailBuilder,
    sh_name: u32,
    strtab_index: u32,
    symbols: &SymbolTable<'_>,
    bun_index: u16,
    code: u64,
) -> Option<Elf64_Shdr> {
    let symtab_offset = tail.next_aligned_offset();
    tail.bytes.extend_from_slice(&[0u8; SYMBOL_ENTRY_SIZE]);
    append_symbol_entries(&mut tail.bytes, symbols, 1, bun_index, code)?;
    let entry_count = symbols.len() as u64 + 1;
    Some(Elf64_Shdr {
        sh_name,
        sh_type: SHT_SYMTAB,
        sh_flags: 0,
        sh_addr: 0,
        sh_offset: symtab_offset,
        sh_size: SYMBOL_ENTRY_SIZE as u64 * entry_count,
        sh_link: strtab_index,
        sh_info: u32::try_from(entry_count).ok()?,
        sh_addralign: 8,
        sh_entsize: SYMBOL_ENTRY_SIZE as u64,
    })
}

fn append_symbol_entries(
    bytes: &mut Vec<u8>,
    symbols: &SymbolTable<'_>,
    names_offset: u32,
    bun_index: u16,
    code: u64,
) -> Option<()> {
    for symbol in symbols.iter() {
        bytes.extend_from_slice(&symbol.name_offset.checked_add(names_offset)?.to_le_bytes());
        bytes.extend_from_slice(&[STT_FUNC, 0]);
        bytes.extend_from_slice(&bun_index.to_le_bytes());
        bytes.extend_from_slice(&code.checked_add(symbol.offset as u64)?.to_le_bytes());
        bytes.extend_from_slice(&(symbol.size as u64).to_le_bytes());
    }
    Some(())
}

/// Local symbols come first in a table, so the new ones go in front of the first global one.
fn merge_symbol_table(
    tail: &mut TailBuilder,
    headers: &mut [u8],
    own: &OwnSymbols,
    symbols: &SymbolTable<'_>,
    bun_index: u16,
    code: u64,
) -> Option<()> {
    let mut strings_section = read_section_header(headers, own.strings_index);
    strings_section.sh_offset = tail.next_aligned_offset();
    strings_section.sh_size = (own.strings.len() + symbols.names.len()) as u64;
    tail.bytes.extend_from_slice(&own.strings);
    tail.bytes.extend_from_slice(symbols.names);
    write_section_header(headers, own.strings_index, &strings_section);

    let (locals, globals) = own.entries.split_at(own.first_global * SYMBOL_ENTRY_SIZE);
    let names_offset = u32::try_from(own.strings.len()).ok()?;
    let mut table_section = read_section_header(headers, own.index);
    table_section.sh_offset = tail.next_aligned_offset();
    table_section.sh_size = (own.entries.len() + symbols.len() * SYMBOL_ENTRY_SIZE) as u64;
    table_section.sh_info = u32::try_from(own.first_global + symbols.len()).ok()?;
    tail.bytes.extend_from_slice(locals);
    append_symbol_entries(&mut tail.bytes, symbols, names_offset, bun_index, code)?;
    tail.bytes.extend_from_slice(globals);
    write_section_header(headers, own.index, &table_section);
    Some(())
}

fn append_debug_frame(
    tail: &mut TailBuilder,
    sh_name: u32,
    registers: FrameRegisters,
    code: u64,
    code_bytes: u64,
) -> Elf64_Shdr {
    let FrameRegisters {
        frame_pointer,
        return_address,
    } = registers;
    let frame_offset = tail.next_aligned_offset();
    let bytes = &mut tail.bytes;
    bytes.extend_from_slice(&FRAME_ENTRY_LENGTH.to_le_bytes());
    bytes.extend_from_slice(&DW_CIE_ID.to_le_bytes());
    bytes.extend_from_slice(&[
        DW_CIE_VERSION,
        EMPTY_AUGMENTATION,
        CODE_ALIGNMENT_FACTOR,
        DATA_ALIGNMENT_FACTOR,
        return_address,
        DW_CFA_DEF_CFA,
        frame_pointer,
        16,
        DW_CFA_OFFSET | return_address,
        1,
        DW_CFA_OFFSET | frame_pointer,
        2,
        DW_CFA_NOP,
        DW_CFA_NOP,
        DW_CFA_NOP,
        DW_CFA_NOP,
    ]);
    bytes.extend_from_slice(&FRAME_ENTRY_LENGTH.to_le_bytes());
    bytes.extend_from_slice(&CIE_OFFSET.to_le_bytes());
    bytes.extend_from_slice(&code.to_le_bytes());
    bytes.extend_from_slice(&code_bytes.to_le_bytes());
    Elf64_Shdr {
        sh_name,
        sh_type: SHT_PROGBITS,
        sh_flags: 0,
        sh_addr: 0,
        sh_offset: frame_offset,
        sh_size: DEBUG_FRAME_SIZE,
        sh_link: 0,
        sh_info: 0,
        sh_addralign: 8,
        sh_entsize: 0,
    }
}

pub fn symbols_tail(
    file_size: u64,
    mut read: impl FnMut(u64, &mut [u8]) -> bool,
    table: &[u8],
    image_offset: u64,
) -> Option<SymbolsTail> {
    let mut header = [0u8; size_of::<Elf64_Ehdr>()];
    if !read(0, &mut header) || validate_elf64_le(&header).is_err() {
        return None;
    }
    let ehdr = read_ehdr(&header);
    let registers = match ehdr.e_machine {
        EM_X86_64 => FrameRegisters {
            frame_pointer: 6,
            return_address: 16,
        },
        EM_AARCH64 => FrameRegisters {
            frame_pointer: 29,
            return_address: 30,
        },
        _ => return None,
    };
    let sections = read_section_table(file_size, &mut read, &ehdr)?;
    let own_symbols = match sections.symbols_index {
        Some(index) => Some(read_own_symbols(file_size, &mut read, &sections, index)?),
        None => None,
    };
    let SectionTable {
        mut headers,
        mut names,
        names_index,
        bun_index,
        bun_address,
        symbols_index: _,
    } = sections;
    let shnum = ehdr.e_shnum as usize;
    let first_new_name = names.len() as u32;
    let pointer_name = first_new_name + POINTER_NAME;
    let pointer = find_pointer_section(&mut read, &headers, bun_index, bun_address, pointer_name);

    let symbols = SymbolTable::parse(table)?;
    let count = symbols.len();
    let symbol_names = symbols.names;
    let code = symbols.code_address(bun_address, image_offset)?;
    let code_bytes = symbols.code_size as u64;

    let symtab_size = SYMBOL_ENTRY_SIZE * (count + 1);
    let own_size = own_symbols
        .as_ref()
        .map_or(0, |own| own.entries.len() + own.strings.len());
    let mut tail = TailBuilder {
        offset: align_up(file_size, 8),
        bytes: Vec::with_capacity(
            names.len() + symbol_names.len() + symtab_size + own_size + headers.len() + 512,
        ),
    };

    names.extend_from_slice(NEW_SECTION_NAMES);
    let mut names_section = read_section_header(&headers, names_index);
    names_section.sh_offset = tail.next_aligned_offset();
    names_section.sh_size = names.len() as u64;
    tail.bytes.extend_from_slice(&names);
    write_section_header(&mut headers, names_index, &names_section);
    let mut bun_section = read_section_header(&headers, bun_index as usize);
    bun_section.sh_flags |= SHF_EXECINSTR;
    write_section_header(&mut headers, bun_index as usize, &bun_section);

    let strtab_name = first_new_name + STRTAB_NAME;
    let strtab_index = shnum as u32;
    let frame_name = first_new_name + DEBUG_FRAME_NAME;
    let mut new_sections: Vec<Elf64_Shdr> = Vec::with_capacity(MAX_NEW_SECTIONS);
    match &own_symbols {
        Some(own) => merge_symbol_table(&mut tail, &mut headers, own, &symbols, bun_index, code)?,
        None => {
            new_sections.push(append_string_table(&mut tail, strtab_name, symbol_names));
            new_sections.push(append_symbol_table(
                &mut tail,
                first_new_name,
                strtab_index,
                &symbols,
                bun_index,
                code,
            )?);
        }
    }
    new_sections.push(append_debug_frame(
        &mut tail, frame_name, registers, code, code_bytes,
    ));

    let section_headers_offset = tail.next_aligned_offset();
    tail.bytes.extend_from_slice(&headers);
    for shdr in new_sections.iter().chain(pointer.iter()) {
        let at = tail.bytes.len();
        tail.bytes.resize(at + SECTION_HEADER_SIZE, 0);
        write_struct(&mut tail.bytes[at..], shdr);
    }
    Some(SymbolsTail {
        bytes: tail.bytes,
        offset: tail.offset,
        section_headers_offset,
        number_of_sections: (shnum + new_sections.len() + pointer.iter().count()) as u16,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::elf::ElfFile;
    use crate::elf_ranges::tests::toy_elf;
    use crate::image::Architecture;

    const ARCHITECTURES: [Architecture; 2] = [Architecture::X86_64, Architecture::Aarch64];
    const IMAGE_OFFSET: u64 = 120;
    pub(crate) const CODE_OFFSET: u32 = 0x40;
    const CODE_SIZE: u32 = 0x300;
    const NAMES: &[u8] = b"main\0(anonymous)\0Parser.parse\0";
    const SYMBOLS: [Symbol; 3] = [
        symbol(0, 0x100, 0),
        symbol(0x100, 0x80, 5),
        symbol(0x180, 0x180, 17),
    ];

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct Elf64_Sym {
        st_name: u32,
        st_info: u8,
        st_other: u8,
        st_shndx: u16,
        st_value: u64,
        st_size: u64,
    }
    const _: () = assert!(size_of::<Elf64_Sym>() == SYMBOL_ENTRY_SIZE);
    const GLOBAL_FUNCTION: u8 = 1 << 4 | STT_FUNC;

    pub(crate) const fn symbol(offset: u32, size: u32, name_offset: u32) -> Symbol {
        Symbol {
            offset,
            size,
            name_offset,
        }
    }

    pub(crate) fn encode_table(code_size: u32, symbols: &[Symbol], names: &[u8]) -> Vec<u8> {
        let header = [
            symbols.len() as u32,
            names.len() as u32,
            CODE_OFFSET,
            code_size,
        ];
        let entries = symbols
            .iter()
            .flat_map(|symbol| [symbol.offset, symbol.size, symbol.name_offset]);
        let mut table: Vec<u8> = header
            .into_iter()
            .chain(entries)
            .flat_map(u32::to_le_bytes)
            .collect();
        table.extend_from_slice(names);
        table
    }

    fn toy_table() -> Vec<u8> {
        encode_table(CODE_SIZE, &SYMBOLS, NAMES)
    }

    fn read_at(elf: &[u8], offset: u64, out: &mut [u8]) -> bool {
        let offset = offset as usize;
        let Some(bytes) = elf.get(offset..).and_then(|rest| rest.get(..out.len())) else {
            return false;
        };
        out.copy_from_slice(bytes);
        true
    }

    fn write_at(elf: &mut Vec<u8>, offset: u64, bytes: &[u8]) -> bool {
        let offset = offset as usize;
        elf.resize(elf.len().max(offset + bytes.len()), 0);
        elf[offset..][..bytes.len()].copy_from_slice(bytes);
        true
    }

    fn section_headers(elf: &[u8]) -> Vec<Elf64_Shdr> {
        let ehdr = read_ehdr(elf);
        let count = ehdr.e_shnum as usize;
        let headers = &elf[ehdr.e_shoff as usize..][..count * SECTION_HEADER_SIZE];
        (0..count)
            .map(|index| read_section_header(headers, index))
            .collect()
    }

    fn section_bytes<'a>(elf: &'a [u8], section: &Elf64_Shdr) -> &'a [u8] {
        &elf[section.sh_offset as usize..][..section.sh_size as usize]
    }

    fn section_name<'a>(elf: &'a [u8], section: &Elf64_Shdr) -> &'a [u8] {
        let names = section_headers(elf)[read_ehdr(elf).e_shstrndx as usize];
        slice_to_nul(&section_bytes(elf, &names)[section.sh_name as usize..])
    }

    fn section_index(elf: &[u8], name: &[u8]) -> Option<usize> {
        section_headers(elf)
            .iter()
            .position(|section| section_name(elf, section) == name)
    }

    fn find_section(elf: &[u8], name: &[u8]) -> Elf64_Shdr {
        section_headers(elf)[section_index(elf, name).unwrap()]
    }

    fn linked_executable(architecture: Architecture) -> Vec<u8> {
        let mut elf = toy_elf(architecture, true);
        let bun = find_section(&elf, b".bun");
        elf[bun.sh_offset as usize..][..bun.sh_size as usize].fill(0);
        elf
    }

    fn write_payload(linked: &[u8]) -> Vec<u8> {
        let mut elf = ElfFile::init(linked.to_vec()).unwrap();
        elf.write_bun_section(&[0x90; 0x1000]).unwrap();
        elf.data
    }

    fn executable_with_payload(architecture: Architecture) -> Vec<u8> {
        write_payload(&linked_executable(architecture))
    }

    fn code_address(elf: &[u8]) -> u64 {
        find_section(elf, b".bun").sh_addr + 8 + IMAGE_OFFSET + CODE_OFFSET as u64
    }

    fn create_tail(elf: &[u8], table: &[u8]) -> Option<SymbolsTail> {
        let read = |offset: u64, out: &mut [u8]| read_at(elf, offset, out);
        symbols_tail(elf.len() as u64, read, table, IMAGE_OFFSET)
    }

    fn append_symbols(elf: &[u8], table: &[u8]) -> Option<Vec<u8>> {
        let tail = create_tail(elf, table)?;
        let mut with_symbols = elf.to_vec();
        assert!(tail.write(|offset, bytes| write_at(&mut with_symbols, offset, bytes)));
        Some(with_symbols)
    }

    fn edit_header(elf: &[u8], edit: impl FnOnce(&mut Elf64_Ehdr)) -> Vec<u8> {
        let mut edited = elf.to_vec();
        let mut ehdr = read_ehdr(elf);
        edit(&mut ehdr);
        write_struct(&mut edited, &ehdr);
        edited
    }

    fn edit_section(elf: &[u8], index: usize, edit: impl FnOnce(&mut Elf64_Shdr)) -> Vec<u8> {
        let mut edited = elf.to_vec();
        let mut section = section_headers(elf)[index];
        edit(&mut section);
        let headers = &mut edited[read_ehdr(elf).e_shoff as usize..];
        write_section_header(headers, index, &section);
        edited
    }

    #[test]
    fn parse_round_trips() {
        let mut table = toy_table();
        table.extend_from_slice(b"ignored");
        let symbols = SymbolTable::parse(&table).unwrap();
        assert_eq!(symbols.len(), SYMBOLS.len());
        assert_eq!(symbols.code_offset, CODE_OFFSET);
        assert_eq!(symbols.code_size, CODE_SIZE);
        assert_eq!(symbols.names, NAMES);
        assert_eq!(symbols.iter().collect::<Vec<Symbol>>(), SYMBOLS);
    }

    #[test]
    fn parse_accepts_empty_table() {
        let table = encode_table(0, &[], b"");
        let symbols = SymbolTable::parse(&table).unwrap();
        assert_eq!(symbols.len(), 0);
        assert_eq!(symbols.iter().next(), None);
        assert!(symbols.names.is_empty());
    }

    #[test]
    fn parse_accepts_last_name_offset() {
        let last_name_offset = NAMES.len() as u32 - 1;
        let table = encode_table(CODE_SIZE, &[symbol(CODE_SIZE, 0, last_name_offset)], NAMES);
        assert!(SymbolTable::parse(&table).is_some());
    }

    #[test]
    fn parse_rejects_malformed_tables() {
        let table = toy_table();
        let entries_end = TABLE_HEADER_SIZE + TABLE_ENTRY_SIZE * SYMBOLS.len();
        let mut oversized_count = table.clone();
        oversized_count[..4].copy_from_slice(&u32::MAX.to_le_bytes());
        let with_last_symbol =
            |last: Symbol| encode_table(CODE_SIZE, &[SYMBOLS[0], SYMBOLS[1], last], NAMES);
        let malformed = [
            table[..TABLE_HEADER_SIZE - 1].to_vec(),
            oversized_count,
            table[..entries_end - 1].to_vec(),
            table[..table.len() - 1].to_vec(),
            encode_table(CODE_SIZE, &SYMBOLS, &NAMES[..NAMES.len() - 1]),
            encode_table(CODE_SIZE, &SYMBOLS, b""),
            with_last_symbol(symbol(0x180, 0x180, NAMES.len() as u32)),
            with_last_symbol(symbol(0x180, 0x181, 17)),
            with_last_symbol(symbol(u32::MAX, u32::MAX, 17)),
        ];
        for (index, table) in malformed.iter().enumerate() {
            assert!(SymbolTable::parse(table).is_none(), "table {index}");
        }
    }

    #[test]
    fn appends_symbol_table() {
        for architecture in ARCHITECTURES {
            let old = executable_with_payload(architecture);
            let new = append_symbols(&old, &toy_table()).unwrap();
            let bun_index = section_index(&new, b".bun").unwrap();
            let strtab_index = section_index(&new, b".strtab").unwrap();
            let strtab = find_section(&new, b".strtab");
            let symtab = find_section(&new, b".symtab");
            let code = code_address(&new);

            assert_eq!(strtab.sh_type, SHT_STRTAB);
            assert_eq!(symtab.sh_type, SHT_SYMTAB);
            assert_eq!(symtab.sh_offset % 8, 0);
            assert_eq!(symtab.sh_size, 24 * (SYMBOLS.len() as u64 + 1));
            assert_eq!(symtab.sh_entsize, 24);
            assert_eq!(symtab.sh_link as usize, strtab_index);
            assert_eq!(symtab.sh_info as usize, SYMBOLS.len() + 1);

            let strings = section_bytes(&new, &strtab);
            let (null_entry, entries) = section_bytes(&new, &symtab).split_at(SYMBOL_ENTRY_SIZE);
            assert_eq!(null_entry, [0; SYMBOL_ENTRY_SIZE]);
            for (entry, symbol) in entries.chunks_exact(SYMBOL_ENTRY_SIZE).zip(SYMBOLS) {
                let entry: Elf64_Sym = read_struct(entry);
                let name = slice_to_nul(&strings[entry.st_name as usize..]);
                assert_eq!(name, slice_to_nul(&NAMES[symbol.name_offset as usize..]));
                assert_eq!((entry.st_info, entry.st_other), (STT_FUNC, 0));
                assert_eq!(entry.st_shndx as usize, bun_index);
                assert_eq!(entry.st_value, code + symbol.offset as u64);
                assert_eq!(entry.st_size, symbol.size as u64);
            }
        }
    }

    fn symbols_of(elf: &[u8]) -> Vec<(Vec<u8>, u8, u64)> {
        let symtab = find_section(elf, b".symtab");
        let strings = section_bytes(elf, &section_headers(elf)[symtab.sh_link as usize]);
        section_bytes(elf, &symtab)
            .chunks_exact(SYMBOL_ENTRY_SIZE)
            .map(|entry| {
                let entry: Elf64_Sym = read_struct(entry);
                let name = slice_to_nul(&strings[entry.st_name as usize..]).to_vec();
                (name, entry.st_info, entry.st_value)
            })
            .collect()
    }

    fn executable_with_global_symbol(architecture: Architecture) -> Vec<u8> {
        let local = append_symbols(&executable_with_payload(architecture), &toy_table()).unwrap();
        let index = section_index(&local, b".symtab").unwrap();
        let symtab = section_headers(&local)[index];
        let mut elf = edit_section(&local, index, |section| section.sh_info -= 1);
        let last_entry = (symtab.sh_offset + symtab.sh_size) as usize - SYMBOL_ENTRY_SIZE;
        elf[last_entry + offset_of!(Elf64_Sym, st_info)] = GLOBAL_FUNCTION;
        elf
    }

    #[test]
    fn adds_to_symbol_table_of_file() {
        for architecture in ARCHITECTURES {
            let old = executable_with_global_symbol(architecture);
            let table = encode_table(CODE_SIZE, &[symbol(0x200, 0x10, 0)], b"later\0");
            let new = append_symbols(&old, &table).unwrap();
            let code = code_address(&new);
            let expected: [(&[u8], u8, u64); 5] = [
                (b"", 0, 0),
                (b"main", STT_FUNC, code),
                (b"(anonymous)", STT_FUNC, code + 0x100),
                (b"later", STT_FUNC, code + 0x200),
                (b"Parser.parse", GLOBAL_FUNCTION, code + 0x180),
            ];
            let found = symbols_of(&new);
            let found: Vec<(&[u8], u8, u64)> = found
                .iter()
                .map(|(name, info, value)| (&name[..], *info, *value))
                .collect();
            assert_eq!(found, expected);

            let headers = section_headers(&new);
            let tables = headers
                .iter()
                .filter(|section| section.sh_type == SHT_SYMTAB);
            assert_eq!(tables.count(), 1);
            let symtab = find_section(&new, b".symtab");
            assert_eq!(
                section_index(&new, b".symtab"),
                section_index(&old, b".symtab")
            );
            assert_eq!(symtab.sh_link, find_section(&old, b".symtab").sh_link);
            assert_eq!(symtab.sh_info, 4);
            assert_eq!(symtab.sh_offset % 8, 0);
            assert!(symtab.sh_offset >= old.len() as u64);
        }
    }

    #[test]
    fn changes_only_section_table_location() {
        let files = ARCHITECTURES.into_iter().flat_map(|architecture| {
            [
                executable_with_payload(architecture),
                executable_with_global_symbol(architecture),
            ]
        });
        for old in files {
            let new = append_symbols(&old, &toy_table()).unwrap();
            let old_ehdr = read_ehdr(&old);
            let restored_ehdr = Elf64_Ehdr {
                e_shoff: old_ehdr.e_shoff,
                e_shnum: old_ehdr.e_shnum,
                ..read_ehdr(&new)
            };
            let mut restored = new[..old.len()].to_vec();
            write_struct(&mut restored, &restored_ehdr);
            assert!(restored == old);
            assert!(read_ehdr(&new).e_shoff >= old.len() as u64);
        }
    }

    #[test]
    fn retains_existing_sections() {
        for architecture in ARCHITECTURES {
            let old = executable_with_payload(architecture);
            let new = append_symbols(&old, &toy_table()).unwrap();
            let names_index = read_ehdr(&old).e_shstrndx as usize;
            let bun_index = section_index(&old, b".bun").unwrap();
            let old_headers = section_headers(&old);
            let new_headers = section_headers(&new);
            let header_pairs = old_headers.iter().zip(&new_headers);
            for (index, (old_header, new_header)) in header_pairs.enumerate() {
                let new_name = section_name(&new, new_header);
                assert_eq!(new_name, section_name(&old, old_header));
                assert_eq!(new_header.sh_type, old_header.sh_type);
                assert_eq!(new_header.sh_addr, old_header.sh_addr);
                let added_flags = if index == bun_index { SHF_EXECINSTR } else { 0 };
                assert_eq!(new_header.sh_flags, old_header.sh_flags | added_flags);
                if old_header.sh_type == SHT_NOBITS {
                    continue;
                }
                let old_bytes = section_bytes(&old, old_header);
                let new_bytes = section_bytes(&new, new_header);
                if index == names_index {
                    assert_eq!(new_bytes, [old_bytes, NEW_SECTION_NAMES].concat());
                } else {
                    assert_eq!(new_header.sh_offset, old_header.sh_offset);
                    assert!(new_bytes == old_bytes);
                }
            }
        }
    }

    #[test]
    fn names_payload_pointer() {
        for architecture in ARCHITECTURES {
            let linked = linked_executable(architecture);
            let linked_bun = find_section(&linked, b".bun");
            let previous_index = section_index(&linked, b".bun").unwrap() - 1;
            let previous_section = section_headers(&linked)[previous_index];
            let previous_section_end = previous_section.sh_addr + previous_section.sh_size;
            assert_eq!(previous_section.sh_type, SHT_PROGBITS);
            assert_eq!(previous_section.sh_flags, SHF_ALLOC | SHF_WRITE);
            assert_eq!(previous_section_end, linked_bun.sh_addr);

            let old = write_payload(&linked);
            let new = append_symbols(&old, &toy_table()).unwrap();
            let pointer = find_section(&new, b".bun.pointer");
            let payload_address = find_section(&new, b".bun").sh_addr;
            assert_eq!(read_ehdr(&new).e_shnum - read_ehdr(&old).e_shnum, 4);
            assert_eq!(pointer.sh_type, SHT_PROGBITS);
            assert_eq!(pointer.sh_flags, SHF_ALLOC | SHF_WRITE);
            assert_eq!(pointer.sh_addr, linked_bun.sh_addr);
            assert_eq!(pointer.sh_offset, linked_bun.sh_offset);
            assert_eq!(section_bytes(&new, &pointer), payload_address.to_le_bytes());

            let mut other_stored_address = old.clone();
            other_stored_address[linked_bun.sh_offset as usize] ^= 0xff;
            let without_pointer = [
                other_stored_address,
                edit_section(&old, previous_index, |section| section.sh_type = SHT_NOBITS),
                edit_section(&old, previous_index, |section| {
                    section.sh_flags &= !SHF_ALLOC
                }),
            ];
            for (index, file) in without_pointer.iter().enumerate() {
                let new = append_symbols(file, &toy_table()).unwrap();
                let added_sections = read_ehdr(&new).e_shnum - read_ehdr(&old).e_shnum;
                assert_eq!(added_sections, 3, "file {index}");
                assert_eq!(section_index(&new, b".bun.pointer"), None, "file {index}");
            }
        }
    }

    #[test]
    fn debug_frame_covers_code() {
        let cie_bodies: [(Architecture, [u8; 12]); 2] = [
            (
                Architecture::X86_64,
                [1, 0, 1, 0x78, 16, 0x0c, 6, 16, 0x90, 1, 0x86, 2],
            ),
            (
                Architecture::Aarch64,
                [1, 0, 1, 0x78, 30, 0x0c, 29, 16, 0x9e, 1, 0x9d, 2],
            ),
        ];
        for (architecture, cie_body) in cie_bodies {
            let old = executable_with_payload(architecture);
            let new = append_symbols(&old, &toy_table()).unwrap();
            let frame = find_section(&new, b".debug_frame");
            let mut expected = Vec::new();
            expected.extend_from_slice(&20u32.to_le_bytes());
            expected.extend_from_slice(&u32::MAX.to_le_bytes());
            expected.extend_from_slice(&cie_body);
            expected.extend_from_slice(&[0; 4]);
            expected.extend_from_slice(&20u32.to_le_bytes());
            expected.extend_from_slice(&0u32.to_le_bytes());
            expected.extend_from_slice(&code_address(&new).to_le_bytes());
            expected.extend_from_slice(&(CODE_SIZE as u64).to_le_bytes());
            assert_eq!(frame.sh_type, SHT_PROGBITS);
            assert_eq!(frame.sh_offset % 8, 0);
            assert_eq!(section_bytes(&new, &frame), expected);
        }
    }

    #[test]
    fn aligns_tail_offset() {
        let mut old = executable_with_payload(Architecture::X86_64);
        old.resize(align_up(old.len() as u64, 8) as usize + 3, 0xaa);
        let tail = create_tail(&old, &toy_table()).unwrap();
        assert_eq!(tail.offset, old.len() as u64 + 5);
        assert_eq!(tail.section_headers_offset % 8, 0);

        let new = append_symbols(&old, &toy_table()).unwrap();
        assert_eq!(new[old.len()..tail.offset as usize], [0; 5]);
        assert_eq!(new.len(), tail.offset as usize + tail.bytes.len());
        assert!(section_index(&new, b".symtab").is_some());
    }

    #[test]
    fn rejects_unsupported_files() {
        let elf = executable_with_payload(Architecture::X86_64);
        let table = toy_table();
        let names = section_headers(&elf)[read_ehdr(&elf).e_shstrndx as usize];
        let bun_name_offset = names.sh_offset + find_section(&elf, b".bun").sh_name as u64;
        let mut without_bun = elf.clone();
        without_bun[bun_name_offset as usize + 1] = b'x';
        let too_many_sections = (SHN_LORESERVE - MAX_NEW_SECTIONS) as u16;
        let file_size = elf.len() as u64;
        let with_symbols = append_symbols(&elf, &table).unwrap();
        let symtab_index = section_index(&with_symbols, b".symtab").unwrap();
        let strtab_index = section_index(&with_symbols, b".strtab").unwrap();
        let bun_index = section_index(&with_symbols, b".bun").unwrap();
        let names_index = read_ehdr(&with_symbols).e_shstrndx as u32;
        let section_count = read_ehdr(&with_symbols).e_shnum as u32;
        let edit_symtab =
            |edit: fn(&mut Elf64_Shdr)| edit_section(&with_symbols, symtab_index, edit);
        let unsupported = [
            edit_symtab(|section| section.sh_entsize = 16),
            edit_symtab(|section| section.sh_size -= 1),
            edit_symtab(|section| section.sh_info = 0),
            edit_symtab(|section| section.sh_info += 1),
            edit_section(&with_symbols, symtab_index, |section| {
                section.sh_link = names_index
            }),
            edit_section(&with_symbols, symtab_index, |section| {
                section.sh_link = section_count
            }),
            edit_section(&with_symbols, symtab_index, |section| {
                section.sh_link = bun_index as u32
            }),
            edit_section(&with_symbols, bun_index, |section| {
                section.sh_link = symtab_index as u32
            }),
            edit_section(&with_symbols, strtab_index, |section| {
                section.sh_type = SHT_SYMTAB
            }),
            edit_section(&with_symbols, strtab_index, |section| section.sh_size -= 1),
            without_bun,
            elf[..size_of::<Elf64_Ehdr>() - 1].to_vec(),
            edit_header(&elf, |ehdr| ehdr.e_machine = 21),
            edit_header(&elf, |ehdr| ehdr.e_ident[4] = 1),
            edit_header(&elf, |ehdr| ehdr.e_ident[5] = 2),
            edit_header(&elf, |ehdr| ehdr.e_shstrndx = ehdr.e_shnum),
            edit_header(&elf, |ehdr| ehdr.e_shnum = too_many_sections),
            edit_header(&elf, |ehdr| ehdr.e_shoff = file_size),
        ];
        for (index, file) in unsupported.iter().enumerate() {
            assert!(create_tail(file, &table).is_none(), "file {index}");
        }
        assert!(create_tail(&elf, &table[..table.len() - 1]).is_none());
        assert!(create_tail(&elf, &[]).is_none());
    }

    #[test]
    fn rejects_failed_read() {
        let elf = executable_with_payload(Architecture::X86_64);
        let table = toy_table();
        let create_tail_with_failing_read = |failing_read: usize| {
            let mut read_count = 0;
            let read = |offset: u64, out: &mut [u8]| {
                read_count += 1;
                read_count - 1 != failing_read && read_at(&elf, offset, out)
            };
            symbols_tail(elf.len() as u64, read, &table, IMAGE_OFFSET)
        };
        for failing_read in 0..3 {
            assert!(create_tail_with_failing_read(failing_read).is_none());
        }
        let without_pointer = create_tail_with_failing_read(3).unwrap();
        let old_section_count = read_ehdr(&elf).e_shnum;
        assert_eq!(without_pointer.number_of_sections, old_section_count + 3);
    }

    #[test]
    fn write_stops_at_first_failure() {
        let tail = SymbolsTail {
            bytes: vec![1, 2, 3],
            offset: 0x1000,
            section_headers_offset: 0x1100,
            number_of_sections: 12,
        };
        let expected_writes: [(u64, Vec<u8>); 3] = [
            (0x1000, vec![1, 2, 3]),
            (40, 0x1100u64.to_le_bytes().to_vec()),
            (60, 12u16.to_le_bytes().to_vec()),
        ];
        for successful_writes in 0..=expected_writes.len() {
            let mut writes: Vec<(u64, Vec<u8>)> = Vec::new();
            let is_written = tail.write(|offset, bytes| {
                writes.push((offset, bytes.to_vec()));
                writes.len() <= successful_writes
            });
            let attempted_writes = (successful_writes + 1).min(expected_writes.len());
            assert_eq!(is_written, successful_writes == expected_writes.len());
            assert_eq!(writes, expected_writes[..attempted_writes]);
        }
    }
}
