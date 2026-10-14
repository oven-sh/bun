//! Takes the table out of an executable and leaves everything else as it is, for when nothing is excluded.
//! Undoes `embed`.

use crate::bytes::{
    minus, put_u16, put_u32, put_u64, slice, slice_mut, u16_at, u32_at, u64_at, usize_at,
};
use crate::executable::{
    Executable, LC_CODE_SIGNATURE, LC_SEGMENT_64, LC_SYMTAB, PE_TABLE_SECTION, fixed_name,
};
use crate::table::Container;
use crate::{Error, Result};

/// `None` if there is no table to take out. This runs on every `bun build --compile`, so an executable that this crate
/// does not understand is not an error here. A Mach-O has to be signed afterwards.
pub fn without_table(executable: &[u8]) -> Option<Vec<u8>> {
    let exe = Executable::open(executable).ok()?;
    let table = exe.table_section().ok()?.len();
    let mut out = executable.to_vec();
    match exe.format.container {
        Container::Elf => elf(&mut out),
        Container::MachO => macho(&mut out, table, exe.format.arch.macho_page_size()),
        Container::Pe => pe(&mut out),
    }
    .ok()?;
    Some(out)
}

/// The file ends with the table and the section headers, of which the table's is the last.
fn elf(b: &mut Vec<u8>) -> Result<()> {
    let (shoff, shnum) = (usize_at(b, 0x28)?, usize::from(u16_at(b, 0x3c)?));
    let headers = slice(b, shoff, (shnum - 1) * 64)?.to_vec();
    let table = usize_at(b, shoff + (shnum - 1) * 64 + 24)?;
    if shoff + shnum * 64 != b.len() || table > shoff {
        return Err(Error::InvalidExecutable);
    }
    b.truncate(table);
    b.extend_from_slice(&headers);
    put_u64(b, 0x28, table as u64)?;
    put_u16(b, 0x3c, (shnum - 1) as u16)
}

/// The string table ends with the table, padding, its length and the trailer; the signature follows.
fn macho(b: &mut Vec<u8>, table: usize, page: u64) -> Result<()> {
    let (mut symtab, mut signature, mut linkedit) = (None, None, None);
    let mut at = 32;
    for _ in 0..u32_at(b, 16)? {
        match u32_at(b, at)? {
            LC_SYMTAB => symtab = Some(at),
            LC_CODE_SIGNATURE => signature = Some(at),
            LC_SEGMENT_64 if fixed_name(slice(b, at + 8, 16)?) == b"__LINKEDIT" => {
                linkedit = Some(at)
            }
            _ => {}
        }
        at += u32_at(b, at + 4)? as usize;
    }
    let (Some(symtab), Some(linkedit)) = (symtab, linkedit) else {
        return Err(Error::InvalidExecutable);
    };
    let taken = table.next_multiple_of(16) + 16;
    let end = u32_at(b, symtab + 16)? as usize + u32_at(b, symtab + 20)? as usize;
    slice(b, end - taken, taken)?;
    b.drain(end - taken..end);
    let taken = taken as u64;
    let size = minus(u32_at(b, symtab + 20)?.into(), taken)?;
    put_u32(b, symtab + 20, size as u32)?;
    let file_size = minus(u64_at(b, linkedit + 48)?, taken)?;
    put_u64(b, linkedit + 48, file_size)?;
    put_u64(b, linkedit + 32, file_size.next_multiple_of(page))?;
    if let Some(c) = signature {
        let offset = minus(u32_at(b, c + 8)?.into(), taken)?;
        put_u32(b, c + 8, offset as u32)?;
    }
    Ok(())
}

/// The last section, whose bytes end the file.
fn pe(b: &mut Vec<u8>) -> Result<()> {
    let pe = u32_at(b, 0x3c)? as usize;
    let optional = pe + 24;
    let count = usize::from(u16_at(b, pe + 6)?);
    let header = optional
        + usize::from(u16_at(b, pe + 20)?)
        + count.checked_sub(1).ok_or(Error::InvalidExecutable)? * 40;
    let (rva, raw_size, raw) = (
        u32_at(b, header + 12)?,
        u32_at(b, header + 16)? as usize,
        u32_at(b, header + 20)? as usize,
    );
    if slice(b, header, 8)? != PE_TABLE_SECTION || raw + raw_size != b.len() {
        return Err(Error::InvalidExecutable);
    }
    b.truncate(raw);
    slice_mut(b, header, 40)?.fill(0);
    put_u16(b, pe + 6, (count - 1) as u16)?;
    put_u32(b, optional + 56, rva) // the image ends where the section started
}
