use core::mem::size_of;

use super::{Checked, MALFORMED, POINTER_SIZE, Payload, PayloadReferenceError, table_bytes};
use crate::builtins::Image;
use crate::elf::{Elf64_Ehdr, Elf64_Shdr, SHF_ALLOC};
use crate::read_struct;

pub(super) const SHT_RELA: u32 = 4;
pub(super) const SHT_REL: u32 = 9;
pub(super) const SHT_DYNSYM: u32 = 11;
pub(super) const SHT_RELR: u32 = 19;
pub(super) const SHT_ANDROID_REL: u32 = 0x6000_0001;
pub(super) const SHT_ANDROID_RELA: u32 = 0x6000_0002;
pub(super) const SHT_ANDROID_RELR: u32 = 0x6fff_ff00;

const RELA_ENTRY_SIZE: usize = 24;
const REL_ENTRY_SIZE: usize = 16;
const WORDS_PER_BITMAP: u64 = 63;

const SHN_UNDEF: u16 = 0;
pub(super) const SHN_ABS: u16 = 0xfff1;
const SYMBOL_TYPE_MASK: u8 = 0xf;
pub(super) const STT_TLS: u8 = 6;

#[repr(C)]
#[derive(Copy, Clone)]
pub(super) struct DynamicSymbol {
    pub(super) name: u32,
    pub(super) info: u8,
    pub(super) other: u8,
    pub(super) section_index: u16,
    pub(super) value: u64,
    pub(super) size: u64,
}

/// The section headers locate the payload, so they locate the loader's tables too.
pub(super) fn check(file: &mut Image<'_>, payload: Payload) -> Checked {
    let ehdr: Elf64_Ehdr = file.struct_at(0)?;
    let table_size = u64::from(ehdr.e_shnum) * size_of::<Elf64_Shdr>() as u64;
    let headers = table_bytes(file, ehdr.e_shoff, table_size)?;
    for header in headers.chunks_exact(size_of::<Elf64_Shdr>()) {
        let header: Elf64_Shdr = read_struct(header);
        if header.sh_flags & SHF_ALLOC == 0 {
            continue;
        }
        match header.sh_type {
            SHT_RELA => check_relocations::<RELA_ENTRY_SIZE>(file, &header, payload)?,
            SHT_REL => check_relocations::<REL_ENTRY_SIZE>(file, &header, payload)?,
            SHT_RELR | SHT_ANDROID_RELR => check_relative_relocations(file, &header, payload)?,
            SHT_ANDROID_REL | SHT_ANDROID_RELA => {
                return Err(PayloadReferenceError::UnsupportedRelocations);
            }
            SHT_DYNSYM => check_dynamic_symbols(file, &header, payload)?,
            _ => {}
        }
    }
    Ok(())
}

fn entries_of<const ENTRY_SIZE: usize>(
    file: &mut Image<'_>,
    header: &Elf64_Shdr,
) -> Result<Vec<u8>, PayloadReferenceError> {
    if !header.sh_size.is_multiple_of(ENTRY_SIZE as u64) {
        return Err(MALFORMED);
    }
    table_bytes(file, header.sh_offset, header.sh_size)
}

fn first_word(entry: &[u8]) -> u64 {
    read_struct(entry)
}

fn check_relocations<const ENTRY_SIZE: usize>(
    file: &mut Image<'_>,
    header: &Elf64_Shdr,
    payload: Payload,
) -> Checked {
    let entries = entries_of::<ENTRY_SIZE>(file, header)?;
    for entry in entries.chunks_exact(ENTRY_SIZE) {
        payload.check_relocation(first_word(entry), POINTER_SIZE)?;
    }
    Ok(())
}

/// An even word is an address. An odd word is a bitmap of the 63 words that follow the words named so far.
fn check_relative_relocations(
    file: &mut Image<'_>,
    header: &Elf64_Shdr,
    payload: Payload,
) -> Checked {
    let entries = entries_of::<{ POINTER_SIZE as usize }>(file, header)?;
    let mut next_address: u64 = 0;
    for entry in entries.chunks_exact(POINTER_SIZE as usize) {
        let entry = first_word(entry);
        if entry & 1 == 0 {
            payload.check_relocation(entry, POINTER_SIZE)?;
            next_address = entry.wrapping_add(POINTER_SIZE);
            continue;
        }
        for bit in 0..WORDS_PER_BITMAP {
            if (entry >> (bit + 1)) & 1 != 0 {
                let address = next_address.wrapping_add(bit * POINTER_SIZE);
                payload.check_relocation(address, POINTER_SIZE)?;
            }
        }
        next_address = next_address.wrapping_add(WORDS_PER_BITMAP * POINTER_SIZE);
    }
    Ok(())
}

fn check_dynamic_symbols(file: &mut Image<'_>, header: &Elf64_Shdr, payload: Payload) -> Checked {
    let entries = entries_of::<{ size_of::<DynamicSymbol>() }>(file, header)?;
    for entry in entries.chunks_exact(size_of::<DynamicSymbol>()) {
        let symbol: DynamicSymbol = read_struct(entry);
        let has_address = symbol.section_index != SHN_UNDEF
            && symbol.section_index != SHN_ABS
            && symbol.info & SYMBOL_TYPE_MASK != STT_TLS;
        if has_address {
            payload.check_dynamic_symbol(symbol.value, symbol.size)?;
        }
    }
    Ok(())
}
