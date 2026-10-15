//! Mach-O, 64-bit.
//!
//! Only `__TEXT` has pages left out. It becomes one segment per stretch that stays, each at the address it had. The gaps
//! between them are not mapped. The load commands grow into the room that the linker was asked to leave behind them
//! (`-headerpad`).

use bun_collections::index_sort::sort_slice_by_key;
use core::ops::Range;

use crate::bytes::{
    fixed_name as name, minus, narrow, plus, put_u32, put_u64, slice, u8_at, u32_at, u64_at,
    usize_at, whole_pages,
};
use crate::{Error, Result};

const MH_MAGIC_64: u32 = 0xfeed_facf;
const CPU_TYPE_X86_64: u32 = 0x0100_0007;
const CPU_TYPE_ARM64: u32 = 0x0100_000c;
const LC_SEGMENT_64: u32 = 0x19;
const LC_SYMTAB: u32 = 0x2;
const LC_DYSYMTAB: u32 = 0xb;
const LC_CODE_SIGNATURE: u32 = 0x1d;
const LC_DYLD_CHAINED_FIXUPS: u32 = 0x8000_0034;
const SEGMENT: usize = 72;
const SECTION: usize = 80;
const N_STAB: u8 = 0xe0;
const N_TYPE: u8 = 0x0e;
const N_SECT: u8 = 0x0e;

/// The fields of a load command that are offsets in the file, all 32 bits wide. Of the commands that bun has: another may
/// well have some.
fn file_offsets(command: u32) -> Result<&'static [usize]> {
    match command {
        LC_SYMTAB => Ok(&[8, 16]),
        LC_DYSYMTAB => Ok(&[32, 40, 48, 56, 64, 72]),
        // function starts, data in code, exports trie
        LC_CODE_SIGNATURE | 0x26 | 0x29 | 0x8000_0033 | LC_DYLD_CHAINED_FIXUPS => Ok(&[8]),
        // (its own are seen to.) load dylib, load dylinker, UUID, build version, main
        LC_SEGMENT_64 | 0xc | 0xe | 0x1b | 0x32 | 0x8000_0028 => Ok(&[]),
        _ => Err(Error::InvalidExecutable),
    }
}

pub(crate) fn is(file: &[u8]) -> bool {
    u32_at(file, 0) == Ok(MH_MAGIC_64)
}

pub(crate) fn is_arm64(file: &[u8]) -> Result<bool> {
    match u32_at(file, 4)? {
        CPU_TYPE_X86_64 => Ok(false),
        CPU_TYPE_ARM64 => Ok(true),
        _ => Err(Error::UnrecognizedExecutable),
    }
}

/// {command, where it is, its size}
fn commands(file: &[u8]) -> Result<Vec<(u32, usize, usize)>> {
    let mut list = Vec::new();
    let mut at = 32;
    let end = 32 + u32_at(file, 20)? as usize;
    for _ in 0..u32_at(file, 16)? {
        let size = u32_at(file, at + 4)? as usize;
        if size < 8 || size > end.saturating_sub(at) {
            return Err(Error::InvalidExecutable);
        }
        slice(file, at, size)?;
        list.push((u32_at(file, at)?, at, size));
        at += size;
    }
    // So that what follows can add and subtract these.
    let mut all_sections = 0;
    for &(_, at, size) in list.iter().filter(|c| c.0 == LC_SEGMENT_64) {
        let sections = u32_at(file, at + 64)? as usize;
        // A symbol says which it is in with a byte.
        all_sections += sections;
        if all_sections > 255 {
            return Err(Error::InvalidExecutable);
        }
        if size != SEGMENT + sections * SECTION
            || plus(u64_at(file, at + 40)?, u64_at(file, at + 48)?)? > file.len() as u64
        {
            return Err(Error::InvalidExecutable);
        }
        plus(u64_at(file, at + 24)?, u64_at(file, at + 32)?)?;
        plus(u64_at(file, at + 24)?, u64_at(file, at + 48)?)?;
        for header in (0..sections).map(|s| at + SEGMENT + s * SECTION) {
            plus(u64_at(file, header + 32)?, u64_at(file, header + 40)?)?;
        }
    }
    Ok(list)
}

/// Where in the file the section is.
/// Those of `__TEXT`.
pub(crate) fn sections(file: &[u8]) -> Result<Vec<crate::Section<'_>>> {
    let mut sections = Vec::new();
    for (_, at, _) in commands(file)?.into_iter().filter(|c| c.0 == LC_SEGMENT_64) {
        for s in 0..u32_at(file, at + 64)? as usize {
            let header = at + SEGMENT + s * SECTION;
            if name(slice(file, header + 16, 16)?) == b"__TEXT" {
                let start = u64_at(file, header + 32)?;
                sections.push(crate::Section {
                    name: name(slice(file, header, 16)?),
                    addresses: start..plus(start, u64_at(file, header + 40)?)?,
                    offset: u32_at(file, header + 48)? as usize,
                });
            }
        }
    }
    Ok(sections)
}

/// `file` without the whole pages of `dead`, which is sorted address ranges.
pub(crate) fn without_pages(file: &[u8], dead: &[Range<u64>]) -> Result<Vec<u8>> {
    let page: u64 = if is_arm64(file)? { 0x4000 } else { 0x1000 };
    let commands = commands(file)?;
    let end_of_commands = 32 + u32_at(file, 20)? as usize;
    let segments: Vec<usize> = commands
        .iter()
        .filter(|c| c.0 == LC_SEGMENT_64)
        .map(|c| c.1)
        .collect();
    let find = |wanted: &[u8]| {
        segments
            .iter()
            .position(|&at| slice(file, at + 8, 16).is_ok_and(|n| name(n) == wanted))
    };
    let (Some(text_index), Some(linkedit_index)) = (find(b"__TEXT"), find(b"__LINKEDIT")) else {
        return Err(Error::InvalidExecutable);
    };
    let (text, linkedit) = (segments[text_index], segments[linkedit_index]);
    let text_range = u64_at(file, text + 24)?..u64_at(file, text + 24)? + u64_at(file, text + 48)?;
    if u64_at(file, text + 40)? != 0 || linkedit_index + 1 != segments.len() {
        return Err(Error::InvalidExecutable);
    }
    let sections: Vec<usize> = (0..u32_at(file, text + 64)? as usize)
        .map(|s| text + SEGMENT + s * SECTION)
        .collect();
    let mut first_content = text_range.end - text_range.start;
    for &header in &sections {
        first_content = first_content.min(u64::from(u32_at(file, header + 48)?));
    }

    let mut gaps: Vec<Range<u64>> = Vec::new();
    for gap in dead.iter().filter_map(|range| whole_pages(range, page)) {
        if gap.start >= text_range.start + first_content && gap.end <= text_range.end {
            gaps.push(gap);
        }
    }

    // What stays of `__TEXT`, and of each stretch the sections in it, as {header, addresses}.
    let stretches = |gaps: &[Range<u64>]| -> Result<Vec<(Range<u64>, Vec<(usize, Range<u64>)>)>> {
        let mut list = Vec::new();
        let mut start = text_range.start;
        for end_and_next in gaps
            .iter()
            .map(|g| (g.start, g.end))
            .chain([(text_range.end, text_range.end)])
        {
            if start < end_and_next.0 {
                let stretch = start..end_and_next.0;
                let mut inside = Vec::new();
                for &header in &sections {
                    let address = u64_at(file, header + 32)?;
                    let part = address.max(stretch.start)
                        ..(address + u64_at(file, header + 40)?).min(stretch.end);
                    if part.start < part.end {
                        inside.push((header, part));
                    }
                }
                list.push((stretch, inside));
            }
            start = end_and_next.1;
        }
        Ok(list)
    };
    // The load commands grow into the room that the linker left behind them. The largest gaps that there is room for.
    // On x86-64 nothing is signed. Whoever signs it later adds a command for that.
    let for_a_signature = if commands.iter().any(|c| c.0 == LC_CODE_SIGNATURE) {
        0
    } else {
        16
    };
    let room = minus(first_content, (end_of_commands + for_a_signature) as u64)? as usize;
    sort_slice_by_key(&mut gaps, |g| core::cmp::Reverse(g.end - g.start));
    loop {
        let mut sorted = gaps.clone();
        sort_slice_by_key(&mut sorted, |g| g.start);
        let kept = stretches(&sorted)?;
        let size: usize = kept.iter().map(|s| SEGMENT + s.1.len() * SECTION).sum();
        if size <= SEGMENT + sections.len() * SECTION + room {
            gaps = sorted;
            break;
        }
        gaps.pop();
    }
    if gaps.is_empty() {
        return Ok(file.to_vec());
    }
    let kept = stretches(&gaps)?;
    let added = kept.len() - 1;
    let dropped: u64 = gaps.iter().map(|g| g.end - g.start).sum();

    // ---- the contents: `__TEXT` without the gaps, the other segments as they are
    let linkedit_offset = usize_at(file, linkedit + 40)?;
    let mut out: Vec<u8> = Vec::with_capacity(file.len());
    let mut offset_of_stretch = Vec::new();
    for (stretch, _) in &kept {
        offset_of_stretch.push(out.len() as u64);
        let from = (stretch.start - text_range.start) as usize;
        out.extend_from_slice(slice(file, from, (stretch.end - stretch.start) as usize)?);
    }
    let text_end = (text_range.end - text_range.start) as usize;
    out.extend_from_slice(slice(
        file,
        text_end,
        linkedit_offset
            .checked_sub(text_end)
            .ok_or(Error::InvalidExecutable)?,
    )?);

    // ---- `__LINKEDIT`: the chained fixups have one more entry per segment, the signature goes
    let command = |wanted: u32| commands.iter().find(|c| c.0 == wanted).map(|c| c.1);
    let fixups = command(LC_DYLD_CHAINED_FIXUPS).ok_or(Error::InvalidExecutable)?;
    let (fixups_offset, fixups_size) = (
        u32_at(file, fixups + 8)? as usize,
        u32_at(file, fixups + 12)? as usize,
    );
    let grown = (added * 4).next_multiple_of(8);
    let content_end = match command(LC_CODE_SIGNATURE) {
        Some(c) => u32_at(file, c + 8)? as usize,
        None => linkedit_offset + usize_at(file, linkedit + 48)?,
    };
    let new_linkedit_offset = out.len();
    out.extend_from_slice(slice(
        file,
        linkedit_offset,
        fixups_offset
            .checked_sub(linkedit_offset)
            .ok_or(Error::InvalidExecutable)?,
    )?);
    {
        let old = slice(file, fixups_offset, fixups_size)?;
        let starts = u32_at(old, 4)? as usize;
        let count = u32_at(old, starts)? as usize;
        if count != segments.len() {
            return Err(Error::InvalidExecutable);
        }
        let array_end = starts + 4 + count * 4;
        let mut new = slice(old, 0, starts)?.to_vec();
        for at in [8, 12] {
            // imports and symbols follow the starts
            let moved = narrow(u64::from(u32_at(&new, at)?) + grown as u64)?;
            put_u32(&mut new, at, moved)?;
        }
        new.extend_from_slice(&((count + added) as u32).to_le_bytes());
        for index in 0..count {
            let offset = u32_at(old, starts + 4 + index * 4)?;
            let offset = match offset {
                0 => 0,
                offset => narrow(u64::from(offset) + grown as u64)?,
            };
            new.extend_from_slice(&offset.to_le_bytes());
            if index == text_index {
                new.resize(new.len() + added * 4, 0);
            }
        }
        new.resize(array_end + grown, 0);
        new.extend_from_slice(old.get(array_end..).ok_or(Error::InvalidExecutable)?);
        out.extend_from_slice(&new);
    }
    let fixups_end = fixups_offset + fixups_size;
    out.extend_from_slice(slice(
        file,
        fixups_end,
        content_end
            .checked_sub(fixups_end)
            .ok_or(Error::InvalidExecutable)?,
    )?);
    out.resize(out.len().next_multiple_of(16), 0);
    let moved = |offset: u32| -> Result<u32> {
        match u64::from(offset) {
            0 => Ok(0),
            o if o >= fixups_end as u64 => narrow(minus(o + grown as u64, dropped)?),
            o => narrow(minus(o, dropped)?),
        }
    };

    // ---- the load commands
    let mut header = slice(file, 0, 32)?.to_vec();
    // {number the section had, addresses of the part, number the part has}. Numbers start at 1.
    let mut parts: Vec<(u8, Range<u64>, u8)> = Vec::new();
    let (mut old_number, mut number) = (0u8, 0u8);
    for &(kind, at, size) in &commands {
        let mut bytes = slice(file, at, size)?.to_vec();
        if at == text {
            for (index, (stretch, inside)) in kept.iter().enumerate() {
                let mut segment = slice(file, at, SEGMENT)?.to_vec();
                if index > 0 {
                    let label = format!("__TEXT.{index}");
                    segment[8..24].fill(0);
                    segment[8..8 + label.len()].copy_from_slice(label.as_bytes());
                }
                put_u32(&mut segment, 4, (SEGMENT + inside.len() * SECTION) as u32)?;
                put_u64(&mut segment, 24, stretch.start)?;
                put_u64(&mut segment, 32, stretch.end - stretch.start)?;
                put_u64(&mut segment, 40, offset_of_stretch[index])?;
                put_u64(&mut segment, 48, stretch.end - stretch.start)?;
                put_u32(&mut segment, 64, inside.len() as u32)?;
                for (section, part) in inside {
                    let nth = (*section - (at + SEGMENT)) / SECTION;
                    let mut section = slice(file, *section, SECTION)?.to_vec();
                    put_u64(&mut section, 32, part.start)?;
                    put_u64(&mut section, 40, part.end - part.start)?;
                    let offset = offset_of_stretch[index] + (part.start - stretch.start);
                    put_u32(&mut section, 48, narrow(offset)?)?;
                    segment.extend_from_slice(&section);
                    number = number.checked_add(1).ok_or(Error::InvalidExecutable)?;
                    parts.push((old_number + 1 + nth as u8, part.clone(), number));
                }
                header.extend_from_slice(&segment);
            }
            old_number += sections.len() as u8;
            continue;
        }
        if kind == LC_SEGMENT_64 {
            if u64_at(&bytes, 48)? != 0 {
                let offset = minus(u64_at(&bytes, 40)?, dropped)?;
                put_u64(&mut bytes, 40, offset)?;
            }
            for s in 0..u32_at(&bytes, 64)? as usize {
                let section = SEGMENT + s * SECTION;
                let offset = match u64::from(u32_at(&bytes, section + 48)?) {
                    0 => 0,
                    offset => narrow(minus(offset, dropped)?)?,
                };
                put_u32(&mut bytes, section + 48, offset)?;
                number = number.checked_add(1).ok_or(Error::InvalidExecutable)?;
                old_number += 1;
                let address = u64_at(&bytes, section + 32)?;
                parts.push((
                    old_number,
                    address..address + u64_at(&bytes, section + 40)?,
                    number,
                ));
            }
            if at == linkedit {
                let size = (out.len() - new_linkedit_offset) as u64;
                put_u64(&mut bytes, 48, size)?;
                put_u64(&mut bytes, 32, size.next_multiple_of(page))?;
            }
        }
        for &field in file_offsets(kind)? {
            let offset = moved(u32_at(&bytes, field)?)?;
            put_u32(&mut bytes, field, offset)?;
        }
        match kind {
            LC_DYLD_CHAINED_FIXUPS => {
                put_u32(&mut bytes, 12, narrow((fixups_size + grown) as u64)?)?;
            }
            // Whoever writes the executable signs it.
            LC_CODE_SIGNATURE => {
                put_u32(&mut bytes, 8, narrow(out.len() as u64)?)?;
                put_u32(&mut bytes, 12, 0)?;
            }
            _ => {}
        }
        header.extend_from_slice(&bytes);
    }
    put_u32(&mut header, 16, (commands.len() + added) as u32)?;
    let size_of_commands = (header.len() - 32) as u32;
    put_u32(&mut header, 20, size_of_commands)?;
    out.get_mut(..header.len())
        .ok_or(Error::InvalidExecutable)?
        .copy_from_slice(&header);

    // ---- symbols say which section they are in, by number
    if let Some(c) = command(LC_SYMTAB) {
        let symbols = moved(u32_at(file, c + 8)?)? as usize;
        for index in 0..u32_at(file, c + 12)? as usize {
            let at = symbols + index * 16;
            let (kind, old) = (u8_at(&out, at + 4)?, u8_at(&out, at + 5)?);
            // Of the entries for a debugger: a function, a static, its begin and its end. In others the field is something else.
            let is_in_a_section = match kind & N_STAB {
                0 => kind & N_TYPE == N_SECT,
                _ => matches!(kind, 0x24 | 0x26 | 0x28 | 0x2e | 0x4e),
            };
            let of_section = || parts.iter().filter(|p| p.0 == old);
            if is_in_a_section && let Some(first) = of_section().next() {
                let value = u64_at(&out, at + 8)?;
                // One in a gap is of something that is gone.
                out[at + 5] = of_section()
                    .find(|p| p.1.contains(&value))
                    .unwrap_or(first)
                    .2;
            }
        }
    }
    Ok(out)
}
