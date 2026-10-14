//! PE: which bytes are where, the headers, and two tables the loader reads.
//!
//! The one area is `.text`, packed towards its start. The section keeps its virtual size, so every other section keeps its
//! address; the file just holds fewer bytes of it, and the loader fills the rest with zeros that nothing touches.

use crate::bytes::{offset, put_u16, put_u32, slice, slice_mut, u16_at, u32_at};
use crate::executable::{Executable, IMAGE_DIRECTORY_ENTRY_BASERELOC, PE_TABLE_SECTION};
use crate::patch::{moved, patch};
use crate::plan::{Options, Plan};
use crate::table::{Arch, NO_UNIT, Table};
use crate::{Error, Result};

const IMAGE_DIRECTORY_ENTRY_EXCEPTION: usize = 3;
const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;
/// "Skip this entry."
const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;

struct Section {
    header: usize,
    rva: u32,
    raw_size: u32,
    raw: u32,
    /// How far its bytes move in the file.
    moved_by: i64,
}

pub(crate) fn apply(exe: &Executable<'_>, t: &Table, o: &Options<'_>, p: &Plan) -> Result<Vec<u8>> {
    let mut bytes = exe.bytes.to_vec();
    patch(t, o, p, exe, &mut bytes, 0)?;
    let file_offset = |rva: u32| exe.file_offset(rva.into()).ok_or(Error::InvalidExecutable);

    let pe = u32_at(&bytes, 0x3c)? as usize;
    let optional = pe + 24;
    let file_alignment = u32_at(&bytes, optional + 36)?.max(1);
    let size_of_headers = u32_at(&bytes, optional + 60)? as usize;
    let directory = |index: usize| optional + 112 + index * 8; // {rva, size}
    let first = optional + usize::from(u16_at(&bytes, pe + 20)?);
    let mut sections = Vec::new();
    for i in 0..usize::from(u16_at(&bytes, pe + 6)?) {
        let header = first + i * 40;
        if slice(&bytes, header, 8)? == PE_TABLE_SECTION {
            // The last section: the image ends where it started.
            let rva = u32_at(&bytes, header + 12)?;
            put_u32(&mut bytes, optional + 56, rva)?;
            put_u16(&mut bytes, pe + 6, i as u16)?;
            slice_mut(&mut bytes, header, 40)?.fill(0);
            break;
        }
        sections.push(Section {
            header,
            rva: u32_at(&bytes, header + 12)?,
            raw_size: u32_at(&bytes, header + 16)?,
            raw: u32_at(&bytes, header + 20)?,
            moved_by: 0,
        });
    }

    // ---- the function table, sorted by address. Packing keeps the order, so drop and shift.
    // x64: {begin, end, unwind info}. arm64: {begin, unwind info, or the unwinding itself in 30 bits}.
    {
        let at = file_offset(u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_EXCEPTION))?)?;
        let size = u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_EXCEPTION) + 4)? as usize;
        let mut kept = at;
        let entry_size = match t.format.arch {
            Arch::X64 => 12,
            Arch::Arm64 => 8,
        };
        for entry in (at..at + size).step_by(entry_size) {
            let begin = u32_at(&bytes, entry)?;
            let unit = t.unit_at(begin.into());
            if unit != NO_UNIT && !p.is_piece_live[unit as usize] {
                continue;
            }
            let delta = if unit == NO_UNIT {
                0
            } else {
                p.delta[unit as usize] as i32
            };
            bytes.copy_within(entry..entry + entry_size, kept);
            put_u32(&mut bytes, kept, begin.wrapping_add_signed(delta))?;
            if t.format.arch == Arch::X64 {
                let end = u32_at(&bytes, kept + 4)?;
                put_u32(&mut bytes, kept + 4, end.wrapping_add_signed(delta))?;
            }
            kept += entry_size;
        }
        bytes
            .get_mut(kept..at + size)
            .ok_or(Error::InvalidExecutable)?
            .fill(0);
        put_u32(
            &mut bytes,
            directory(IMAGE_DIRECTORY_ENTRY_EXCEPTION) + 4,
            (kept - at) as u32,
        )?;
    }

    // ---- base relocations: the loader adds the distance it moved the image by to each listed pointer. One that was blanked
    // has to stay null.
    {
        let at = file_offset(u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_BASERELOC))?)?;
        let size = u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_BASERELOC) + 4)? as usize;
        let mut block = at;
        while block < at + size {
            let block_size = u32_at(&bytes, block + 4)? as usize;
            if block_size < 8 {
                return Err(Error::InvalidExecutable);
            }
            let page = u64::from(u32_at(&bytes, block)?);
            for entry in (block + 8..block + block_size).step_by(2) {
                let unit = t.unit_at(page + u64::from(u16_at(&bytes, entry)? & 0xfff));
                if unit != NO_UNIT && !p.is_unit_live[unit as usize] {
                    put_u16(&mut bytes, entry, IMAGE_REL_BASED_ABSOLUTE)?;
                }
            }
            block += block_size;
        }
    }

    // ---- the file
    let area = t.areas.first().ok_or(Error::InvalidTable)?;
    let last = p.runs[0].last().ok_or(Error::Inconsistent)?;
    let mut out = slice(&bytes, 0, size_of_headers)?.to_vec();
    for s in &mut sections {
        if s.raw_size == 0 {
            continue;
        }
        let position = out.len();
        if u64::from(s.rva) == area.low {
            let mut packed = moved(t, p, exe, &bytes, 0)?;
            let length = ((offset(last.end, last.delta) - area.low) as u32)
                .next_multiple_of(file_alignment) as usize;
            packed.resize(length, area.fill[0]);
            put_u32(&mut out, s.header + 16, length as u32)?;
            out.extend_from_slice(&packed);
        } else {
            out.extend_from_slice(slice(&bytes, s.raw as usize, s.raw_size as usize)?);
        }
        put_u32(&mut out, s.header + 20, position as u32)?;
        s.moved_by = position as i64 - i64::from(s.raw);
    }

    // The debug directory also says where in the file its data is.
    let debug = u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_DEBUG))?;
    if debug != 0 {
        let holding = |raw: u32| {
            sections
                .iter()
                .find(|s| raw >= s.raw && raw - s.raw < s.raw_size)
        };
        let at = file_offset(debug)?;
        let at = at.wrapping_add_signed(
            holding(at as u32).ok_or(Error::InvalidExecutable)?.moved_by as isize,
        );
        for entry in (at..at + u32_at(&bytes, directory(IMAGE_DIRECTORY_ENTRY_DEBUG) + 4)? as usize)
            .step_by(28)
        {
            let pointer = u32_at(&out, entry + 24)?;
            if let Some(s) = holding(pointer) {
                put_u32(
                    &mut out,
                    entry + 24,
                    pointer.wrapping_add_signed(s.moved_by as i32),
                )?;
            }
        }
    }
    Ok(out)
}
