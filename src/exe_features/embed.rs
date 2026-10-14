//! Puts the compressed table into the executable: [`Executable::table_section`] is the other direction.

use crate::bytes::{put_u16, put_u32, put_u64, slice, u16_at, u32_at, u64_at, usize_at};
use crate::executable::{
    Executable, LC_CODE_SIGNATURE, LC_SEGMENT_64, LC_SYMTAB, MACHO_TABLE_TRAILER, PE_TABLE_SECTION,
    SHT_BUN_FEATURE_TABLE, fixed_name,
};
use crate::table::Container;
use crate::{Error, Result};

/// A Mach-O has to be signed afterwards.
pub fn embed(executable: &[u8], table: &[u8]) -> Result<Vec<u8>> {
    let mut out = executable.to_vec();
    let format = Executable::open(executable)?.format;
    match format.container {
        Container::Elf => elf(&mut out, table)?,
        Container::MachO => macho(&mut out, table, format.arch.macho_page_size())?,
        Container::Pe => pe(&mut out, table)?,
    }
    Ok(out)
}

/// The file ends with the section headers. The table takes their place, and they follow it with one more.
fn elf(out: &mut Vec<u8>, table: &[u8]) -> Result<()> {
    let (shoff, shnum) = (usize_at(out, 0x28)?, usize::from(u16_at(out, 0x3c)?));
    let mut headers = slice(out, shoff, shnum * 64)?.to_vec();
    if shoff + headers.len() != out.len() {
        return Err(Error::InvalidExecutable);
    }
    out.truncate(shoff);
    out.extend_from_slice(table);
    out.resize(out.len().next_multiple_of(8), 0);

    let mut header = [0u8; 64];
    put_u32(&mut header, 4, SHT_BUN_FEATURE_TABLE)?;
    put_u64(&mut header, 24, shoff as u64)?;
    put_u64(&mut header, 32, table.len() as u64)?;
    put_u64(&mut header, 48, 1)?;
    headers.extend_from_slice(&header);
    let new_shoff = out.len() as u64;
    out.extend_from_slice(&headers);
    put_u64(out, 0x28, new_shoff)?;
    put_u16(out, 0x3c, (shnum + 1) as u16)
}

fn macho(out: &mut Vec<u8>, table: &[u8], page: u64) -> Result<()> {
    let (mut symtab, mut signature, mut linkedit) = (None, None, None);
    let mut at = 32;
    for _ in 0..u32_at(out, 16)? {
        match u32_at(out, at)? {
            LC_SYMTAB => symtab = Some(at),
            LC_CODE_SIGNATURE => signature = Some(at),
            LC_SEGMENT_64 if fixed_name(slice(out, at + 8, 16)?) == b"__LINKEDIT" => {
                linkedit = Some(at)
            }
            _ => {}
        }
        at += u32_at(out, at + 4)? as usize;
    }
    let (Some(symtab), Some(linkedit)) = (symtab, linkedit) else {
        return Err(Error::InvalidExecutable);
    };
    let strings_end = u32_at(out, symtab + 16)? as usize + u32_at(out, symtab + 20)? as usize;
    let content_end = match signature {
        Some(c) => u32_at(out, c + 8)? as usize,
        None => usize_at(out, linkedit + 40)? + usize_at(out, linkedit + 48)?,
    };
    // The string table is the last thing before the signature, which starts at a multiple of 16.
    if content_end % 16 != 0
        || content_end
            .checked_sub(strings_end)
            .is_none_or(|gap| gap >= 16)
    {
        return Err(Error::InvalidExecutable);
    }
    let mut tail = table.to_vec();
    tail.resize(tail.len().next_multiple_of(16), 0);
    tail.extend_from_slice(&(table.len() as u64).to_le_bytes());
    tail.extend_from_slice(MACHO_TABLE_TRAILER);
    let grown = tail.len();
    out.splice(content_end..content_end, tail);

    let strings = u32_at(out, symtab + 16)? as usize;
    put_u32(out, symtab + 20, (content_end + grown - strings) as u32)?;
    let file_size = u64_at(out, linkedit + 48)? + grown as u64;
    put_u64(out, linkedit + 48, file_size)?;
    put_u64(out, linkedit + 32, file_size.next_multiple_of(page))?;
    if let Some(c) = signature {
        put_u32(out, c + 8, (content_end + grown) as u32)?;
    }
    Ok(())
}

/// One more section, after the last.
fn pe(out: &mut Vec<u8>, table: &[u8]) -> Result<()> {
    const IMAGE_SCN_CNT_INITIALIZED_DATA: u32 = 0x40;
    const IMAGE_SCN_MEM_DISCARDABLE: u32 = 0x0200_0000;
    const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;
    let pe = u32_at(out, 0x3c)? as usize;
    let optional = pe + 24;
    let (section_alignment, file_alignment) = (
        u32_at(out, optional + 32)?.max(1),
        u32_at(out, optional + 36)?.max(1),
    );
    let count = usize::from(u16_at(out, pe + 6)?);
    let header = optional + usize::from(u16_at(out, pe + 20)?) + count * 40;
    let last = header
        .checked_sub(40)
        .filter(|_| count > 0)
        .ok_or(Error::InvalidExecutable)?;
    if header + 40 > u32_at(out, optional + 60)? as usize
        || slice(out, header, 40)?.iter().any(|&b| b != 0)
    {
        return Err(Error::InvalidExecutable); // no room among the headers
    }
    let rva =
        (u32_at(out, last + 12)? + u32_at(out, last + 8)?).next_multiple_of(section_alignment);
    out.resize(out.len().next_multiple_of(file_alignment as usize), 0);
    let raw = out.len() as u32;
    out.extend_from_slice(table);
    out.resize(out.len().next_multiple_of(file_alignment as usize), 0);

    let raw_size = out.len() as u32 - raw;

    out[header..header + 8].copy_from_slice(PE_TABLE_SECTION);
    put_u32(out, header + 8, table.len() as u32)?;
    put_u32(out, header + 12, rva)?;
    put_u32(out, header + 16, raw_size)?;
    put_u32(out, header + 20, raw)?;
    put_u32(
        out,
        header + 36,
        IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_DISCARDABLE | IMAGE_SCN_MEM_READ,
    )?;
    put_u16(out, pe + 6, (count + 1) as u16)?;
    put_u32(
        out,
        optional + 56,
        (rva + table.len() as u32).next_multiple_of(section_alignment),
    )
}
