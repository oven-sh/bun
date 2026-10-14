//! ELF: which bytes are where, and the headers.
//!
//! Two areas move. Read-only data ends its segment: it is packed downwards and the segment loses its tail. Code starts its
//! segment: it is packed upwards and the segment starts at a higher address. No other address changes.

use crate::bytes::{offset, put_u16, put_u32, put_u64, slice, u16_at, u32_at, u64_at, usize_at};
use crate::executable::{Executable, PT_LOAD, SHT_BUN_FEATURE_TABLE};
use crate::patch::{moved, patch};
use crate::plan::{Options, Plan};
use crate::table::Table;
use crate::{Error, Result};

const PT_GNU_STACK: u32 = 0x6474_e551;
const SHF_ALLOC: u64 = 2;
/// An entry of the section headers that is not in use.
const SHT_NULL: u32 = 0;
const SHT_SYMTAB: u32 = 2;
const SHT_RELA: u32 = 4;

#[derive(Clone, Copy)]
struct Segment {
    kind: u32,
    offset: u64,
    addr: u64,
    file_size: u64,
    mem_size: u64,
    align: u64,
}

/// Pads `out` to a multiple of `alignment`, appends `bytes`, and says where they went.
fn append(out: &mut Vec<u8>, bytes: &[u8], alignment: u64) -> u64 {
    out.resize(
        (out.len() as u64).next_multiple_of(alignment.max(1)) as usize,
        0,
    );
    out.extend_from_slice(bytes);
    (out.len() - bytes.len()) as u64
}

pub(crate) fn apply(exe: &Executable<'_>, t: &Table, o: &Options<'_>, p: &Plan) -> Result<Vec<u8>> {
    let mut bytes = exe.bytes.to_vec();
    patch(t, o, p, exe, &mut bytes, 0)?;
    let b = &bytes[..];
    let (phoff, shoff) = (usize_at(b, 0x20)?, usize_at(b, 0x28)?);
    let (phnum, shnum) = (usize::from(u16_at(b, 0x38)?), usize::from(u16_at(b, 0x3c)?));

    let mut segments = Vec::with_capacity(phnum);
    for i in 0..phnum {
        let at = phoff + i * 56;
        segments.push(Segment {
            kind: u32_at(b, at)?,
            offset: u64_at(b, at + 8)?,
            addr: u64_at(b, at + 16)?,
            file_size: u64_at(b, at + 32)?,
            mem_size: u64_at(b, at + 40)?,
            align: u64_at(b, at + 48)?.max(1),
        });
    }

    // ---- the segments that are loaded
    let loads: Vec<Segment> = segments
        .iter()
        .copied()
        .filter(|s| s.kind == PT_LOAD)
        .collect();
    let mut new_loads = loads.clone();
    let mut contents = Vec::with_capacity(loads.len());
    for s in &loads {
        contents.push(slice(b, s.offset as usize, s.file_size as usize)?.to_vec());
    }
    for (index, area) in t.areas.iter().enumerate() {
        let k = loads
            .iter()
            .position(|s| area.low >= s.addr && area.low - s.addr < s.file_size)
            .ok_or(Error::TableOfAnotherExecutable)?;
        let s = loads[k];
        let packed = moved(t, p, exe, b, index)?;
        let at = (area.low - s.addr) as usize;
        contents[k]
            .get_mut(at..)
            .and_then(|c| c.get_mut(..packed.len()))
            .ok_or(Error::TableOfAnotherExecutable)?
            .copy_from_slice(&packed);
        let (Some(first), Some(last)) = (p.runs[index].first(), p.runs[index].last()) else {
            continue;
        };
        if !area.towards_high && area.high == s.addr + s.file_size {
            contents[k].truncate((offset(last.end, last.delta) - s.addr) as usize);
            new_loads[k].file_size = contents[k].len() as u64;
            new_loads[k].mem_size = contents[k].len() as u64;
        } else if area.towards_high && area.low == s.addr {
            let start = offset(first.start, first.delta);
            contents[k].drain(..(start - s.addr) as usize);
            new_loads[k].addr = start;
            new_loads[k].file_size = contents[k].len() as u64;
            new_loads[k].mem_size = s.mem_size - (start - s.addr);
        }
    }

    let mut out = Vec::with_capacity(b.len());
    for (k, s) in new_loads.iter_mut().enumerate() {
        if k > 0 {
            // A segment's offset in the file and its address have to agree modulo its alignment, a power of two.
            let pad = s.addr.wrapping_sub(out.len() as u64) % s.align;
            out.resize(out.len() + pad as usize, 0);
        }
        s.offset = append(&mut out, &contents[k], 1);
    }
    drop(contents);
    let new_offset = |address: u64| {
        new_loads
            .iter()
            .find(|s| address >= s.addr && address - s.addr <= s.mem_size)
            .map_or(0, |s| s.offset + (address - s.addr))
    };

    // ---- section headers keep their indexes. A section inside an area now spans what is left of it.
    let mut headers = slice(b, shoff, shnum * 64)?.to_vec();
    // Dropped: the table, and the symbol tables and relocation records of an unstripped input, which are not kept up to date.
    let mut is_dropped = vec![false; shnum];
    for i in 1..shnum {
        let kind = u32_at(&headers, i * 64 + 4)?;
        if kind == SHT_BUN_FEATURE_TABLE
            || (kind == SHT_RELA && u64_at(&headers, i * 64 + 8)? & SHF_ALLOC == 0)
        {
            is_dropped[i] = true;
        }
        if kind == SHT_SYMTAB {
            is_dropped[i] = true;
            *is_dropped
                .get_mut(u32_at(&headers, i * 64 + 40)? as usize)
                .ok_or(Error::InvalidExecutable)? = true;
        }
    }
    for i in 1..shnum {
        let at = i * 64;
        if u64_at(&headers, at + 8)? & SHF_ALLOC != 0 {
            let (mut start, mut length) = (u64_at(&headers, at + 16)?, u64_at(&headers, at + 32)?);
            if let Some(index) = t.area_of(start) {
                let mut left = p.runs[index].iter().filter_map(|r| {
                    let (from, to) = (r.start.max(start), r.end.min(start + length));
                    (from < to).then(|| (offset(from, r.delta), offset(to, r.delta)))
                });
                match left.next() {
                    None => length = 0,
                    Some((first, end)) => {
                        length = left.next_back().map_or(end, |(_, end)| end) - first;
                        start = first;
                    }
                }
            }
            put_u64(&mut headers, at + 16, start)?;
            put_u64(&mut headers, at + 24, new_offset(start))?;
            put_u64(&mut headers, at + 32, length)?;
        } else if is_dropped[i] {
            put_u32(&mut headers, at + 4, SHT_NULL)?;
            headers[at + 24..at + 48].fill(0);
        } else {
            let contents = slice(
                b,
                u64_at(&headers, at + 24)? as usize,
                u64_at(&headers, at + 32)? as usize,
            )?;
            let to = append(&mut out, contents, u64_at(&headers, at + 48)?);
            put_u64(&mut headers, at + 24, to)?;
        }
    }
    // The table's is the last, so it can go without renumbering the others.
    if u32_at(b, shoff + (shnum - 1) * 64 + 4)? == SHT_BUN_FEATURE_TABLE {
        headers.truncate((shnum - 1) * 64);
        put_u16(&mut out, 0x3c, (shnum - 1) as u16)?;
    }
    let new_shoff = append(&mut out, &headers, 8);
    put_u64(&mut out, 0x28, new_shoff)?;

    let mut load = new_loads.iter();
    for (i, s) in segments.iter().enumerate() {
        let at = phoff + i * 56;
        let new = match s.kind {
            PT_LOAD => *load.next().ok_or(Error::InvalidExecutable)?,
            PT_GNU_STACK => *s,
            _ => Segment {
                offset: new_offset(s.addr),
                ..*s
            },
        };
        put_u64(&mut out, at + 8, new.offset)?;
        put_u64(&mut out, at + 16, new.addr)?;
        put_u64(&mut out, at + 24, new.addr)?;
        put_u64(&mut out, at + 32, new.file_size)?;
        put_u64(&mut out, at + 40, new.mem_size)?;
    }
    Ok(out)
}
