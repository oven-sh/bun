//! Mach-O, 64-bit.
//!
//! `__TEXT` and `__DATA_CONST` have pages left out. Each becomes one segment per stretch that stays, each at the address it
//! had. The gaps between them are not mapped. The load commands grow into the room that the linker was asked to leave behind
//! them (`-headerpad`).

use bun_collections::index_sort::sort_slice_by_key;
use core::ops::Range;

use crate::bytes::{
    fixed_name as name, minus, narrow, plus, put_u32, put_u64, slice, u8_at, u16_at, u32_at,
    u64_at, usize_at, whole_pages,
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
const SG_READ_ONLY: u32 = 0x10;
const SECTION_TYPE: u32 = 0xff;
const S_ZEROFILL: u32 = 0x1;
const S_GB_ZEROFILL: u32 = 0xc;
const S_THREAD_LOCAL_ZEROFILL: u32 = 0x12;
const STARTS_IN_SEGMENT: usize = 22;
const START_NONE: u16 = 0xffff;
const START_MULTI: u16 = 0x8000;

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
    for &(_, at, size) in list.iter().filter(|c| c.0 == LC_SEGMENT_64) {
        let sections = u32_at(file, at + 64)? as usize;
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
/// Those that the file holds.
pub(crate) fn sections(file: &[u8]) -> Result<Vec<crate::Section<'_>>> {
    let mut sections = Vec::new();
    for (_, at, _) in commands(file)?.into_iter().filter(|c| c.0 == LC_SEGMENT_64) {
        for s in 0..u32_at(file, at + 64)? as usize {
            let header = at + SEGMENT + s * SECTION;
            let kind = u32_at(file, header + 64)? & SECTION_TYPE;
            if !matches!(kind, S_ZEROFILL | S_GB_ZEROFILL | S_THREAD_LOCAL_ZEROFILL) {
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

pub(crate) fn is_in_text(file: &[u8], addresses: &Range<u64>) -> Result<bool> {
    for (_, at, _) in commands(file)?.into_iter().filter(|c| c.0 == LC_SEGMENT_64) {
        let start = u64_at(file, at + 24)?;
        if name(slice(file, at + 8, 16)?) == b"__TEXT" {
            return Ok(start <= addresses.start && addresses.end <= start + u64_at(file, at + 32)?);
        }
    }
    Ok(false)
}

fn starts_in_image(fixups: &[u8]) -> Result<(usize, usize)> {
    let (starts, imports, symbols) = (
        u32_at(fixups, 4)? as usize,
        u32_at(fixups, 8)? as usize,
        u32_at(fixups, 12)? as usize,
    );
    let count = u32_at(fixups, starts)? as usize;
    if starts + 4 + count * 4 > imports || imports > symbols || symbols > fixups.len() {
        return Err(Error::InvalidExecutable);
    }
    Ok((starts, count))
}

fn starts_in_segment(fixups: &[u8], segment: usize) -> Result<Option<&[u8]>> {
    let (starts, count) = starts_in_image(fixups)?;
    if segment >= count {
        return Err(Error::InvalidExecutable);
    }
    let offset = u32_at(fixups, starts + 4 + segment * 4)? as usize;
    if offset == 0 {
        return Ok(None);
    }
    let info = slice(
        fixups,
        starts + offset,
        u32_at(fixups, starts + offset)? as usize,
    )?;
    slice(info, STARTS_IN_SEGMENT, usize::from(u16_at(info, 20)?) * 2)?;
    Ok(Some(info))
}

fn page_starts(info: &[u8]) -> Result<Vec<u16>> {
    (0..usize::from(u16_at(info, 20)?))
        .map(|page| u16_at(info, STARTS_IN_SEGMENT + page * 2))
        .collect()
}

fn can_lose_pages(fixups: &[u8], segment: usize, page: u64) -> Result<bool> {
    let Some(info) = starts_in_segment(fixups, segment)? else {
        return Ok(true);
    };
    let page_size = u64::from(u16_at(info, 4)?);
    let is_plain = |start: &u16| *start == START_NONE || *start & START_MULTI == 0;
    Ok(page_size != 0 && page.is_multiple_of(page_size) && page_starts(info)?.iter().all(is_plain))
}

fn fixups_of_pieces(fixups: &[u8], pieces: &[Vec<Range<u64>>]) -> Result<Vec<u8>> {
    let (starts, count) = starts_in_image(fixups)?;
    if count != pieces.len() {
        return Err(Error::InvalidExecutable);
    }
    let new_count: usize = pieces.iter().map(Vec::len).sum();
    let mut offsets: Vec<u32> = Vec::new();
    let mut pool: Vec<u8> = Vec::new();
    let first = (4 + new_count * 4).next_multiple_of(8);
    for (segment, pieces) in pieces.iter().enumerate() {
        let Some(info) = starts_in_segment(fixups, segment)? else {
            offsets.resize(offsets.len() + pieces.len(), 0);
            continue;
        };
        let page_size = u64::from(u16_at(info, 4)?);
        let all = page_starts(info)?;
        if let [only] = &pieces[..]
            && (page_size == 0 || (only.end - only.start).div_ceil(page_size) as usize >= all.len())
        {
            offsets.push(narrow((first + pool.len()) as u64)?);
            pool.extend_from_slice(info);
            pool.resize(pool.len().next_multiple_of(8), 0);
            continue;
        }
        let segment_start = pieces.first().ok_or(Error::InvalidExecutable)?.start;
        for piece in pieces {
            let (from, to) = (piece.start - segment_start, piece.end - segment_start);
            if page_size == 0 || !from.is_multiple_of(page_size) {
                return Err(Error::InvalidExecutable);
            }
            let pages = ((from / page_size) as usize).min(all.len())
                ..(to.div_ceil(page_size) as usize).min(all.len());
            let used = all[pages.clone()]
                .iter()
                .rposition(|start| *start != START_NONE)
                .map_or(0, |last| last + 1);
            if used == 0 {
                offsets.push(0);
                continue;
            }
            offsets.push(narrow((first + pool.len()) as u64)?);
            let size = (STARTS_IN_SEGMENT + used * 2).next_multiple_of(8);
            let mut new = slice(info, 0, STARTS_IN_SEGMENT)?.to_vec();
            put_u32(&mut new, 0, size as u32)?;
            put_u64(&mut new, 8, plus(u64_at(info, 8)?, from)?)?;
            new[20..22].copy_from_slice(&(used as u16).to_le_bytes());
            for start in &all[pages.start..pages.start + used] {
                new.extend_from_slice(&start.to_le_bytes());
            }
            new.resize(size, 0);
            pool.extend_from_slice(&new);
        }
    }
    let imports = u32_at(fixups, 8)? as usize;
    let grown = (first + pool.len())
        .saturating_sub(imports - starts)
        .next_multiple_of(8);
    let mut new = slice(fixups, 0, starts)?.to_vec();
    for at in [8, 12] {
        let moved = narrow(u64::from(u32_at(&new, at)?) + grown as u64)?;
        put_u32(&mut new, at, moved)?;
    }
    new.extend_from_slice(&(new_count as u32).to_le_bytes());
    for offset in offsets {
        new.extend_from_slice(&offset.to_le_bytes());
    }
    new.resize(starts + first, 0);
    new.extend_from_slice(&pool);
    new.resize(imports + grown, 0);
    new.extend_from_slice(&fixups[imports..]);
    Ok(new)
}

struct Piece {
    addresses: Range<u64>,
    /// {header, addresses}
    sections: Vec<(usize, Range<u64>)>,
}

/// What stays of the segment whose command is at `segment`.
fn pieces_of(file: &[u8], segment: usize, gaps: &[Range<u64>]) -> Result<Vec<Piece>> {
    let whole =
        u64_at(file, segment + 24)?..u64_at(file, segment + 24)? + u64_at(file, segment + 48)?;
    let mut list = Vec::new();
    let mut start = whole.start;
    let inside = gaps
        .iter()
        .filter(|gap| whole.start <= gap.start && gap.end <= whole.end);
    for (end, next) in inside
        .map(|gap| (gap.start, gap.end))
        .chain([(whole.end, whole.end)])
    {
        if start < end || whole.is_empty() {
            let mut sections = Vec::new();
            for header in
                (0..u32_at(file, segment + 64)? as usize).map(|s| segment + SEGMENT + s * SECTION)
            {
                let address = u64_at(file, header + 32)?;
                let part = address.max(start)..(address + u64_at(file, header + 40)?).min(end);
                if part.start < part.end {
                    sections.push((header, part));
                }
            }
            list.push(Piece {
                addresses: start..end,
                sections,
            });
        }
        start = next;
    }
    Ok(list)
}

/// `file` without the whole pages of `dead`, which is sorted address ranges.
pub(crate) fn without_pages(
    file: &[u8],
    dead: &[Range<u64>],
    limits: crate::Limits,
) -> Result<Vec<u8>> {
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
    let mut first_content = text_range.end - text_range.start;
    for header in (0..u32_at(file, text + 64)? as usize).map(|s| text + SEGMENT + s * SECTION) {
        first_content = first_content.min(u64::from(u32_at(file, header + 48)?));
    }
    let command = |wanted: u32| commands.iter().find(|c| c.0 == wanted).map(|c| c.1);
    let fixups = command(LC_DYLD_CHAINED_FIXUPS).ok_or(Error::InvalidExecutable)?;
    let (fixups_offset, fixups_size) = (
        u32_at(file, fixups + 8)? as usize,
        u32_at(file, fixups + 12)? as usize,
    );
    let old_fixups = slice(file, fixups_offset, fixups_size)?;

    let text_can_go = text_range.start + first_content..text_range.end;
    let mut constants_can_go = 0..0;
    if let Some(index) = find(b"__DATA_CONST") {
        let at = segments[index];
        let start = u64_at(file, at + 24)?;
        if u64_at(file, at + 32)? == u64_at(file, at + 48)?
            && start.is_multiple_of(page)
            && can_lose_pages(old_fixups, index, page)?
        {
            constants_can_go = start + page..start + u64_at(file, at + 48)?;
        }
    }
    let mut gaps: Vec<Range<u64>> = Vec::new();
    for gap in dead
        .iter()
        .filter_map(|range| whole_pages(range, page, limits.smallest_hole))
    {
        if [&text_can_go, &constants_can_go]
            .iter()
            .any(|range| range.start <= gap.start && gap.end <= range.end)
        {
            gaps.push(gap);
        }
    }

    // The load commands grow into the room that the linker left behind them. The largest gaps that there is room for.
    // On x86-64 nothing is signed. Whoever signs it later adds a command for that.
    let for_a_signature = if commands.iter().any(|c| c.0 == LC_CODE_SIGNATURE) {
        0
    } else {
        16
    };
    let room = minus(first_content, (end_of_commands + for_a_signature) as u64)? as usize;
    let pieces = |gaps: &[Range<u64>]| {
        segments
            .iter()
            .map(|&at| pieces_of(file, at, gaps))
            .collect::<Result<Vec<Vec<Piece>>>>()
    };
    let size_of = |pieces: &[Vec<Piece>]| {
        pieces
            .iter()
            .flatten()
            .map(|piece| SEGMENT + piece.sections.len() * SECTION)
            .sum::<usize>()
    };
    let size_before = size_of(&pieces(&[])?);
    let only_shortens =
        |gap: &Range<u64>| gap.end == text_can_go.end || gap.end == constants_can_go.end;
    sort_slice_by_key(&mut gaps, |g| {
        (!only_shortens(g), core::cmp::Reverse(g.end - g.start))
    });
    let shortened = gaps.iter().filter(|gap| only_shortens(gap)).count();
    gaps.truncate(limits.most_holes.saturating_add(shortened));
    loop {
        let mut sorted = gaps.clone();
        sort_slice_by_key(&mut sorted, |g| g.start);
        if size_of(&pieces(&sorted)?) <= size_before + room {
            gaps = sorted;
            break;
        }
        gaps.pop();
    }
    if gaps.is_empty() {
        return Ok(file.to_vec());
    }
    let kept = pieces(&gaps)?;
    let added = kept.iter().map(Vec::len).sum::<usize>() - segments.len();

    // ---- the contents: the segments without the gaps
    let linkedit_offset = usize_at(file, linkedit + 40)?;
    let mut holes: Vec<Range<u64>> = Vec::new();
    for gap in &gaps {
        for &at in &segments {
            let start = u64_at(file, at + 24)?;
            if start <= gap.start && gap.end <= start + u64_at(file, at + 48)? {
                let offset = u64_at(file, at + 40)? + (gap.start - start);
                holes.push(offset..offset + (gap.end - gap.start));
            }
        }
    }
    let mut out: Vec<u8> = Vec::with_capacity(file.len());
    let mut from = 0;
    let end = linkedit_offset as u64..linkedit_offset as u64;
    for hole in holes.iter().chain(core::iter::once(&end)) {
        let length = (hole.start as usize)
            .checked_sub(from)
            .ok_or(Error::InvalidExecutable)?;
        out.extend_from_slice(slice(file, from, length)?);
        from = hole.end as usize;
    }

    // ---- `__LINKEDIT`: the chained fixups have an entry per segment, the signature goes
    let addresses_of = |pieces: &Vec<Piece>| {
        pieces
            .iter()
            .map(|piece| piece.addresses.clone())
            .collect::<Vec<Range<u64>>>()
    };
    let new_fixups = fixups_of_pieces(
        old_fixups,
        &kept.iter().map(addresses_of).collect::<Vec<_>>(),
    )?;
    let grown = new_fixups.len() - fixups_size;
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
    out.extend_from_slice(&new_fixups);
    let fixups_end = fixups_offset + fixups_size;
    out.extend_from_slice(slice(
        file,
        fixups_end,
        content_end
            .checked_sub(fixups_end)
            .ok_or(Error::InvalidExecutable)?,
    )?);
    out.resize(out.len().next_multiple_of(16), 0);
    let moved = |offset: u64| -> Result<u64> {
        let dropped: u64 = holes
            .iter()
            .filter(|hole| hole.end <= offset)
            .map(|hole| hole.end - hole.start)
            .sum();
        match offset {
            0 => Ok(0),
            o if o >= fixups_end as u64 => minus(o + grown as u64, dropped),
            o => minus(o, dropped),
        }
    };

    // ---- the load commands
    let mut header = slice(file, 0, 32)?.to_vec();
    // The sections there are now, in the order of their numbers, which start at 1.
    let mut parts: Vec<Range<u64>> = Vec::new();
    for &(kind, at, size) in &commands {
        let mut bytes = slice(file, at, size)?.to_vec();
        let is_cut = |pieces: &&Vec<Piece>| {
            pieces.len() != 1
                || u64_at(file, at + 48)
                    .is_ok_and(|size| pieces[0].addresses.end - pieces[0].addresses.start != size)
        };
        if let Some(pieces) = segments
            .iter()
            .position(|&segment| segment == at)
            .map(|index| &kept[index])
            .filter(is_cut)
        {
            let (start, offset, flags) = (
                u64_at(file, at + 24)?,
                u64_at(file, at + 40)?,
                u32_at(file, at + 68)?,
            );
            let largest = (0..pieces.len())
                .max_by_key(|&index| pieces[index].addresses.end - pieces[index].addresses.start);
            let keeps_its_name = largest.filter(|_| flags & SG_READ_ONLY != 0).unwrap_or(0);
            for (index, piece) in pieces.iter().enumerate() {
                let Range {
                    start: piece_start,
                    end: piece_end,
                } = piece.addresses;
                let mut segment = slice(file, at, SEGMENT)?.to_vec();
                if index != keeps_its_name {
                    let mut label = name(slice(file, at + 8, 16)?).to_vec();
                    label.extend_from_slice(format!(".{index}").as_bytes());
                    segment[8..24].fill(0);
                    segment
                        .get_mut(8..8 + label.len())
                        .filter(|_| label.len() <= 16)
                        .ok_or(Error::InvalidExecutable)?
                        .copy_from_slice(&label);
                    put_u32(&mut segment, 68, flags & !SG_READ_ONLY)?;
                }
                put_u32(
                    &mut segment,
                    4,
                    (SEGMENT + piece.sections.len() * SECTION) as u32,
                )?;
                put_u64(&mut segment, 24, piece_start)?;
                put_u64(&mut segment, 32, piece_end - piece_start)?;
                put_u64(&mut segment, 40, moved(offset + (piece_start - start))?)?;
                put_u64(&mut segment, 48, piece_end - piece_start)?;
                put_u32(&mut segment, 64, piece.sections.len() as u32)?;
                for (section, part) in &piece.sections {
                    let mut section = slice(file, *section, SECTION)?.to_vec();
                    put_u64(&mut section, 32, part.start)?;
                    put_u64(&mut section, 40, part.end - part.start)?;
                    put_u32(
                        &mut section,
                        48,
                        narrow(moved(offset + (part.start - start))?)?,
                    )?;
                    segment.extend_from_slice(&section);
                    parts.push(part.clone());
                }
                header.extend_from_slice(&segment);
            }
            continue;
        }
        if kind == LC_SEGMENT_64 {
            if u64_at(&bytes, 48)? != 0 {
                let offset = moved(u64_at(&bytes, 40)?)?;
                put_u64(&mut bytes, 40, offset)?;
            }
            for s in 0..u32_at(&bytes, 64)? as usize {
                let section = SEGMENT + s * SECTION;
                let offset = narrow(moved(u64::from(u32_at(&bytes, section + 48)?))?)?;
                put_u32(&mut bytes, section + 48, offset)?;
                let address = u64_at(&bytes, section + 32)?;
                parts.push(address..address + u64_at(&bytes, section + 40)?);
            }
            if at == linkedit {
                let size = (out.len() - new_linkedit_offset) as u64;
                put_u64(&mut bytes, 48, size)?;
                put_u64(&mut bytes, 32, size.next_multiple_of(page))?;
            }
        }
        for &field in file_offsets(kind)? {
            let offset = narrow(moved(u64::from(u32_at(&bytes, field)?))?)?;
            put_u32(&mut bytes, field, offset)?;
        }
        match kind {
            LC_DYLD_CHAINED_FIXUPS => {
                put_u32(&mut bytes, 12, narrow(new_fixups.len() as u64)?)?;
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

    // ---- symbols say which section they are in, by number, in a byte. The linker writes what of the number fits.
    if let Some(c) = command(LC_SYMTAB) {
        let mut by_address: Vec<(Range<u64>, usize)> = parts.into_iter().zip(1..).collect();
        sort_slice_by_key(&mut by_address, |part| part.0.start);
        let symbols = moved(u64::from(u32_at(file, c + 8)?))? as usize;
        for index in 0..u32_at(file, c + 12)? as usize {
            let at = symbols + index * 16;
            let kind = u8_at(&out, at + 4)?;
            // Of the entries for a debugger: a function, a static, its begin and its end. In others the field is something else.
            let is_in_a_section = match kind & N_STAB {
                0 => kind & N_TYPE == N_SECT,
                _ => matches!(kind, 0x24 | 0x26 | 0x28 | 0x2e | 0x4e) && u8_at(&out, at + 5)? != 0,
            };
            let value = u64_at(&out, at + 8)?;
            let after = by_address.partition_point(|part| part.0.start <= value);
            // One in a gap is of something that is gone.
            if is_in_a_section
                && let Some(part) = by_address[..after]
                    .last()
                    .filter(|part| part.0.contains(&value))
            {
                out[at + 5] = part.1 as u8;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const REFUSED: Error = Error::InvalidExecutable;
    const IMAGE: u64 = 0x1_0000_0000;
    const TAIL: &[u8] = b"IMPORTS!\0_a\0_b\0\0";

    fn starts(page_size: u16, segment_offset: u64, pages: &[u16]) -> Vec<u8> {
        let size = (STARTS_IN_SEGMENT + pages.len() * 2).next_multiple_of(8);
        let mut info = (size as u32).to_le_bytes().to_vec();
        info.extend_from_slice(&page_size.to_le_bytes());
        info.extend_from_slice(&2u16.to_le_bytes());
        info.extend_from_slice(&segment_offset.to_le_bytes());
        info.extend_from_slice(&0u32.to_le_bytes());
        info.extend_from_slice(&(pages.len() as u16).to_le_bytes());
        for page in pages {
            info.extend_from_slice(&page.to_le_bytes());
        }
        info.resize(size, 0);
        info
    }

    fn fixups(segments: &[Option<Vec<u8>>]) -> Vec<u8> {
        let first = (4 + segments.len() * 4).next_multiple_of(8);
        let mut image = (segments.len() as u32).to_le_bytes().to_vec();
        let mut pool = Vec::new();
        for info in segments {
            let offset = info.as_ref().map_or(0, |_| first + pool.len());
            image.extend_from_slice(&(offset as u32).to_le_bytes());
            pool.extend_from_slice(info.as_deref().unwrap_or_default());
        }
        image.resize(first, 0);
        image.extend_from_slice(&pool);
        let imports = 32 + image.len() as u32;
        let mut blob = Vec::new();
        for field in [0, 32, imports, imports + 8, 2, 1, 0, 0] {
            blob.extend_from_slice(&field.to_le_bytes());
        }
        blob.extend_from_slice(&image);
        blob.extend_from_slice(TAIL);
        blob
    }

    fn read(blob: &[u8]) -> Vec<Option<(u64, Vec<u16>)>> {
        let (_, count) = starts_in_image(blob).unwrap();
        assert_eq!(&blob[u32_at(blob, 8).unwrap() as usize..], TAIL);
        assert_eq!(u32_at(blob, 12).unwrap(), u32_at(blob, 8).unwrap() + 8);
        (0..count)
            .map(|segment| {
                starts_in_segment(blob, segment).unwrap().map(|info| {
                    assert_eq!(
                        (
                            info.len() % 8,
                            u16_at(info, 4),
                            u16_at(info, 6),
                            u32_at(info, 16)
                        ),
                        (0, Ok(0x4000), Ok(2), Ok(0))
                    );
                    (u64_at(info, 8).unwrap(), page_starts(info).unwrap())
                })
            })
            .collect()
    }

    const NONE: u16 = START_NONE;
    const PAGE: u64 = 0x4000;
    const CONSTANTS: u64 = IMAGE + 0x10000;

    fn constants() -> Vec<u8> {
        starts(0x4000, 0x10000, &[0x10, NONE, 0x20, 0x30, NONE, 0x40, 0x8])
    }

    fn linked() -> Vec<u8> {
        fixups(&[
            None,
            None,
            Some(constants()),
            Some(starts(0x4000, 0x34000, &[0x18])),
            None,
        ])
    }

    fn pages(range: Range<u64>) -> Range<u64> {
        CONSTANTS + range.start * PAGE..CONSTANTS + range.end * PAGE
    }

    fn of_at_least(smallest_hole: u64) -> crate::Limits {
        crate::Limits {
            smallest_hole,
            most_holes: usize::MAX,
        }
    }

    fn whole(addresses: Range<u64>) -> Vec<Range<u64>> {
        core::iter::once(addresses).collect()
    }

    fn with_constants(pieces: &[Range<u64>]) -> Vec<Vec<Range<u64>>> {
        vec![
            whole(0..0),
            whole(IMAGE..CONSTANTS),
            pieces.to_vec(),
            whole(IMAGE + 0x34000..IMAGE + 0x38000),
            whole(IMAGE + 0x38000..IMAGE + 0x3c000),
        ]
    }

    #[test]
    fn segments_that_stay_whole_keep_their_starts() {
        let new = fixups_of_pieces(&linked(), &with_constants(&[pages(0..9)])).unwrap();
        assert_eq!(new, linked());
    }

    #[test]
    fn pieces_of_a_segment_without_fixups_have_none() {
        let mut pieces = with_constants(&[pages(0..9)]);
        pieces[1] = vec![
            IMAGE..IMAGE + 0x4000,
            IMAGE + 0x8000..IMAGE + 0xc000,
            IMAGE + 0xc000..CONSTANTS,
        ];
        let new = fixups_of_pieces(&linked(), &pieces).unwrap();
        let whole = read(&linked());
        assert_eq!(
            read(&new),
            [
                None,
                None,
                None,
                None,
                whole[2].clone(),
                whole[3].clone(),
                None
            ]
        );
        assert_eq!((new.len() - linked().len()) % 8, 0);
    }

    #[test]
    fn each_piece_has_the_starts_of_its_own_pages() {
        let new = fixups_of_pieces(
            &linked(),
            &with_constants(&[pages(0..2), pages(3..4), pages(6..9)]),
        )
        .unwrap();
        let data = read(&linked())[3].clone();
        assert_eq!(
            read(&new),
            [
                None,
                None,
                Some((0x10000, vec![0x10])),
                Some((0x1c000, vec![0x30])),
                Some((0x28000, vec![0x8])),
                data,
                None
            ]
        );
        assert_eq!((new.len() - linked().len()) % 8, 0);
    }

    #[test]
    fn a_piece_without_fixups_has_no_starts() {
        let new = fixups_of_pieces(
            &linked(),
            &with_constants(&[pages(0..1), pages(4..5), pages(5..6), pages(7..9)]),
        )
        .unwrap();
        assert_eq!(
            read(&new)[2..6],
            [
                Some((0x10000, vec![0x10])),
                None,
                Some((0x24000, vec![0x40])),
                None
            ]
        );
    }

    #[test]
    fn starts_in_the_middle_of_a_piece_stay_where_they_were() {
        let new =
            fixups_of_pieces(&linked(), &with_constants(&[pages(0..1), pages(1..6)])).unwrap();
        assert_eq!(
            read(&new)[2..4],
            [
                Some((0x10000, vec![0x10])),
                Some((0x14000, vec![NONE, 0x20, 0x30, NONE, 0x40]))
            ]
        );
    }

    #[test]
    fn the_fixups_never_shrink() {
        let many: Vec<u16> = (0..400).collect();
        let old = fixups(&[None, None, Some(starts(0x4000, 0x10000, &many)), None, None]);
        let mut pieces = with_constants(&[pages(0..1), pages(399..400)]);
        pieces[3] = whole(0..0);
        let new = fixups_of_pieces(&old, &pieces).unwrap();
        assert_eq!(new.len(), old.len());
        assert_eq!(
            read(&new)[2..4],
            [
                Some((0x10000, vec![0])),
                Some((0x10000 + 399 * PAGE, vec![399]))
            ]
        );
    }

    #[test]
    fn smaller_pages_in_the_fixups_than_in_memory() {
        let old = fixups(&[
            None,
            None,
            Some(starts(0x1000, 0x10000, &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10])),
            None,
            None,
        ]);
        assert_eq!(can_lose_pages(&old, 2, 0x4000), Ok(true));
        let (_, count) = starts_in_image(&old).unwrap();
        let mut pieces = with_constants(&[pages(0..1), pages(2..3)]);
        pieces[3] = whole(0..0);
        let new = fixups_of_pieces(&old, &pieces).unwrap();
        assert_eq!(starts_in_image(&new).unwrap().1, count + 1);
        let of = |segment: usize| {
            starts_in_segment(&new, segment)
                .unwrap()
                .map(|info| (u64_at(info, 8).unwrap(), page_starts(info).unwrap()))
        };
        assert_eq!(of(2), Some((0x10000, vec![1, 2, 3, 4])));
        assert_eq!(of(3), Some((0x18000, vec![9, 10])));
    }

    #[test]
    fn which_segments_can_lose_pages() {
        assert_eq!(can_lose_pages(&linked(), 1, PAGE), Ok(true));
        assert_eq!(can_lose_pages(&linked(), 2, PAGE), Ok(true));
        assert_eq!(can_lose_pages(&linked(), 2, 0x1000), Ok(false));
        assert_eq!(can_lose_pages(&linked(), 5, PAGE), Err(REFUSED));
        let with = |info: Vec<u8>| fixups(&[None, None, Some(info), None, None]);
        assert_eq!(
            can_lose_pages(
                &with(starts(0x4000, 0x10000, &[0x10, START_MULTI | 2])),
                2,
                PAGE
            ),
            Ok(false)
        );
        assert_eq!(
            can_lose_pages(&with(starts(0, 0x10000, &[0x10])), 2, PAGE),
            Ok(false)
        );
    }

    #[test]
    fn fixups_that_cannot_be_read_are_refused() {
        let pieces = with_constants(&[pages(0..2), pages(3..9)]);
        assert_eq!(fixups_of_pieces(&linked(), &pieces[..4]), Err(REFUSED));
        assert_eq!(
            fixups_of_pieces(
                &linked(),
                &with_constants(&[pages(0..2), CONSTANTS + 0xc100..CONSTANTS + 0x24000])
            ),
            Err(REFUSED)
        );
        assert_eq!(fixups_of_pieces(&linked()[..40], &pieces), Err(REFUSED));
        let mut long = linked();
        let info = 32 + u32_at(&long, 32 + 4 + 2 * 4).unwrap() as usize;
        long[info + 20..info + 22].copy_from_slice(&100u16.to_le_bytes());
        assert_eq!(fixups_of_pieces(&long, &pieces), Err(REFUSED));
        put_u32(&mut long, info, 0x10000).unwrap();
        assert_eq!(fixups_of_pieces(&long, &pieces), Err(REFUSED));
        let mut backwards = linked();
        put_u32(&mut backwards, 8, 36).unwrap();
        assert_eq!(fixups_of_pieces(&backwards, &pieces), Err(REFUSED));
    }

    fn segment(
        label: &[u8],
        address: u64,
        size: u64,
        offset: u64,
        file_size: u64,
        flags: u32,
        sections: &[(&[u8], u64, u64, u32, u32)],
    ) -> Vec<u8> {
        let mut command = vec![0; SEGMENT + sections.len() * SECTION];
        put_u32(&mut command, 0, LC_SEGMENT_64).unwrap();
        put_u32(&mut command, 4, (SEGMENT + sections.len() * SECTION) as u32).unwrap();
        command[8..8 + label.len()].copy_from_slice(label);
        for (field, value) in [address, size, offset, file_size].into_iter().enumerate() {
            put_u64(&mut command, 24 + field * 8, value).unwrap();
        }
        put_u32(&mut command, 64, sections.len() as u32).unwrap();
        put_u32(&mut command, 68, flags).unwrap();
        for (index, &(section, address, size, offset, kind)) in sections.iter().enumerate() {
            let at = SEGMENT + index * SECTION;
            command[at..at + section.len()].copy_from_slice(section);
            command[at + 16..at + 16 + label.len()].copy_from_slice(label);
            put_u64(&mut command, at + 32, address).unwrap();
            put_u64(&mut command, at + 40, size).unwrap();
            put_u32(&mut command, at + 48, offset).unwrap();
            put_u32(&mut command, at + 64, kind).unwrap();
        }
        command
    }

    const LINKEDIT: usize = 0x38000;

    fn executable() -> Vec<u8> {
        let blob = linked();
        let symbols = LINKEDIT + blob.len();
        let names = symbols + 4 * 16;
        let commands = [
            segment(b"__PAGEZERO", 0, IMAGE, 0, 0, 0, &[]),
            segment(
                b"__TEXT",
                IMAGE,
                0x10000,
                0,
                0x10000,
                0,
                &[(b"__text", IMAGE + 0x2000, 0xe000, 0x2000, 0)],
            ),
            segment(
                b"__DATA_CONST",
                CONSTANTS,
                0x24000,
                0x10000,
                0x24000,
                0x10,
                &[
                    (b"__got", CONSTANTS, 0x10, 0x10000, 6),
                    (b"__const", CONSTANTS + 0x10, 0x23ff0, 0x10010, 0),
                ],
            ),
            segment(
                b"__DATA",
                IMAGE + 0x34000,
                0x8000,
                0x34000,
                0x4000,
                0,
                &[
                    (b"__data", IMAGE + 0x34000, 0x100, 0x34000, 0),
                    (b"__bss", IMAGE + 0x38000, 0x100, 0, S_ZEROFILL),
                ],
            ),
            segment(
                b"__LINKEDIT",
                IMAGE + 0x3c000,
                0x4000,
                LINKEDIT as u64,
                (names + 16 - LINKEDIT) as u64,
                0,
                &[],
            ),
            [
                LC_DYLD_CHAINED_FIXUPS,
                16,
                LINKEDIT as u32,
                blob.len() as u32,
            ]
            .iter()
            .flat_map(|field| field.to_le_bytes())
            .collect(),
            [LC_SYMTAB, 24, symbols as u32, 4, names as u32, 16]
                .iter()
                .flat_map(|field| field.to_le_bytes())
                .collect(),
        ];
        let mut file: Vec<u8> = (0..LINKEDIT)
            .map(|at| 0x40 + (at / PAGE as usize) as u8)
            .collect();
        file[..0x2000].fill(0);
        for (field, value) in [
            MH_MAGIC_64,
            CPU_TYPE_ARM64,
            0,
            2,
            commands.len() as u32,
            commands.concat().len() as u32,
            0,
            0,
        ]
        .into_iter()
        .enumerate()
        {
            put_u32(&mut file, field * 4, value).unwrap();
        }
        file[32..32 + commands.concat().len()].copy_from_slice(&commands.concat());
        file.extend_from_slice(&blob);
        for (section, address) in [
            (1, IMAGE + 0xc100),
            (3, CONSTANTS + 0x20),
            (3, CONSTANTS + 0x20100),
            (4, IMAGE + 0x34010),
        ] {
            file.extend_from_slice(&[0, 0, 0, 0, N_SECT, section, 0, 0]);
            file.extend_from_slice(&u64::to_le_bytes(address));
        }
        file.extend_from_slice(&[0; 16]);
        file
    }

    type Read = (
        Vec<u8>,
        u64,
        u64,
        u64,
        u64,
        u32,
        Vec<(Vec<u8>, u64, u64, u32)>,
    );

    fn segments_of(file: &[u8]) -> Vec<Read> {
        let list = commands(file)
            .unwrap()
            .into_iter()
            .filter(|c| c.0 == LC_SEGMENT_64);
        list.map(|(_, at, _)| {
            let field = |index: usize| u64_at(file, at + 24 + index * 8).unwrap();
            let sections =
                (0..u32_at(file, at + 64).unwrap() as usize).map(|s| at + SEGMENT + s * SECTION);
            let sections = sections.map(|s| {
                (
                    name(&file[s..s + 16]).to_vec(),
                    u64_at(file, s + 32).unwrap(),
                    u64_at(file, s + 40).unwrap(),
                    u32_at(file, s + 48).unwrap(),
                )
            });
            (
                name(&file[at + 8..at + 24]).to_vec(),
                field(0),
                field(1),
                field(2),
                field(3),
                u32_at(file, at + 68).unwrap(),
                sections.collect(),
            )
        })
        .collect()
    }

    #[test]
    fn both_segments_lose_whole_pages() {
        let file = executable();
        let dead = [
            IMAGE + 0x4000..IMAGE + 0xc000,
            CONSTANTS + 0x3000..CONSTANTS + 0xd000,
            CONSTANTS + 0x10000..CONSTANTS + 0x14000,
            CONSTANTS + 0x18100..CONSTANTS + 0x1bf00,
        ];
        let out = without_pages(&file, &dead, of_at_least(PAGE)).unwrap();
        let found = segments_of(&out);
        let labels: Vec<&[u8]> = found.iter().map(|segment| &segment.0[..]).collect();
        assert_eq!(
            labels,
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__TEXT.1",
                b"__DATA_CONST.0",
                b"__DATA_CONST.1",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        let places: Vec<(u64, u64, u64, u64, u32)> = found
            .iter()
            .map(|s| (s.1 - IMAGE.min(s.1), s.2, s.3, s.4, s.5))
            .collect();
        assert_eq!(
            places[1..7],
            [
                (0, 0x4000, 0, 0x4000, 0),
                (0xc000, 0x4000, 0x4000, 0x4000, 0),
                (0x10000, 0x4000, 0x8000, 0x4000, 0),
                (0x1c000, 0x4000, 0xc000, 0x4000, 0),
                (0x24000, 0x10000, 0x10000, 0x10000, 0x10),
                (0x34000, 0x8000, 0x20000, 0x4000, 0),
            ]
        );
        assert_eq!(found[7].3, 0x24000);
        assert_eq!(
            found[3].6,
            [
                (b"__got".to_vec(), CONSTANTS, 0x10, 0x8000),
                (b"__const".to_vec(), CONSTANTS + 0x10, 0x3ff0, 0x8010)
            ]
        );
        assert_eq!(
            found[4].6,
            [(b"__const".to_vec(), CONSTANTS + 0xc000, 0x4000, 0xc000)]
        );
        assert_eq!(
            found[5].6,
            [(b"__const".to_vec(), CONSTANTS + 0x14000, 0x10000, 0x10000)]
        );
        assert_eq!(
            found[6].6,
            [
                (b"__data".to_vec(), IMAGE + 0x34000, 0x100, 0x20000),
                (b"__bss".to_vec(), IMAGE + 0x38000, 0x100, 0)
            ]
        );
        let first_bytes: Vec<u8> = (1..9).map(|page| out[page * PAGE as usize]).collect();
        assert_eq!(
            first_bytes,
            [0x43, 0x44, 0x47, 0x49, 0x4a, 0x4b, 0x4c, 0x4d]
        );
        let list = commands(&out).unwrap();
        let fixups = list
            .iter()
            .find(|c| c.0 == LC_DYLD_CHAINED_FIXUPS)
            .unwrap()
            .1;
        let blob = &out[u32_at(&out, fixups + 8).unwrap() as usize..]
            [..u32_at(&out, fixups + 12).unwrap() as usize];
        assert_eq!(u32_at(&out, fixups + 8), Ok(0x24000));
        assert_eq!(
            read(blob),
            [
                None,
                None,
                None,
                Some((0x10000, vec![0x10])),
                Some((0x1c000, vec![0x30])),
                Some((0x24000, vec![0x40, 0x8])),
                Some((0x34000, vec![0x18])),
                None
            ]
        );
        let symbols = list.iter().find(|c| c.0 == LC_SYMTAB).unwrap().1;
        let symbols = u32_at(&out, symbols + 8).unwrap() as usize;
        assert_eq!(symbols, 0x24000 + blob.len());
        assert_eq!(
            [0, 1, 2, 3].map(|index| out[symbols + index * 16 + 5]),
            [2, 4, 6, 7]
        );
    }

    #[test]
    fn a_gap_that_reaches_the_end_of_the_constants_shortens_them() {
        let out = without_pages(
            &executable(),
            &whole(CONSTANTS + 0x14000..CONSTANTS + 0x24000),
            of_at_least(PAGE),
        )
        .unwrap();
        let found = segments_of(&out);
        let labels: Vec<&[u8]> = found.iter().map(|segment| &segment.0[..]).collect();
        assert_eq!(
            labels,
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!(
            (found[2].1, found[2].2, found[2].3, found[2].4, found[2].5),
            (CONSTANTS, 0x14000, 0x10000, 0x14000, 0x10)
        );
        assert_eq!(
            found[2].6,
            [
                (b"__got".to_vec(), CONSTANTS, 0x10, 0x10000),
                (b"__const".to_vec(), CONSTANTS + 0x10, 0x13ff0, 0x10010)
            ]
        );
        assert_eq!(
            (found[3].1, found[3].3, found[4].3),
            (IMAGE + 0x34000, 0x24000, 0x28000)
        );
        assert_eq!(
            out.len(),
            (executable().len() - 0x10000).next_multiple_of(16)
        );
        let list = commands(&out).unwrap();
        let fixups = list
            .iter()
            .find(|c| c.0 == LC_DYLD_CHAINED_FIXUPS)
            .unwrap()
            .1;
        let blob = &out[u32_at(&out, fixups + 8).unwrap() as usize..]
            [..u32_at(&out, fixups + 12).unwrap() as usize];
        let before = read(&linked());
        let after = read(blob);
        assert_eq!(
            after[2].as_ref().map(|starts| starts.0),
            before[2].as_ref().map(|starts| starts.0)
        );
        assert!(after[2].as_ref().unwrap().1.len() <= 5);
        assert_eq!(
            after[2].as_ref().unwrap().1[..],
            before[2].as_ref().unwrap().1[..after[2].as_ref().unwrap().1.len()]
        );
        assert_eq!(after[3], before[3]);
    }

    #[test]
    fn a_segment_that_is_only_shortened_counts_as_no_hole() {
        let dead = [
            IMAGE + 0x4000..IMAGE + 0xc000,
            CONSTANTS + 0x20000..CONSTANTS + 0x24000,
        ];
        let out = without_pages(
            &executable(),
            &dead,
            crate::Limits {
                smallest_hole: PAGE,
                most_holes: 1,
            },
        )
        .unwrap();
        let found = segments_of(&out);
        let labels: Vec<&[u8]> = found.iter().map(|segment| &segment.0[..]).collect();
        assert_eq!(
            labels,
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__TEXT.1",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!((found[3].2, found[3].5), (0x20000, 0x10));
    }

    #[test]
    fn the_first_page_of_the_constants_stays() {
        let out = without_pages(
            &executable(),
            &whole(CONSTANTS..CONSTANTS + 0x8000),
            of_at_least(PAGE),
        )
        .unwrap();
        let found = segments_of(&out);
        assert_eq!(
            (found[2].1, found[2].2, found[3].1),
            (CONSTANTS, 0x24000, IMAGE + 0x34000)
        );
        assert_eq!(out, executable());
    }

    #[test]
    fn constants_whose_fixups_cannot_be_cut_stay_whole() {
        let mut file = executable();
        let info = LINKEDIT + 32 + u32_at(&file, LINKEDIT + 32 + 4 + 2 * 4).unwrap() as usize;
        file[info + STARTS_IN_SEGMENT + 2..info + STARTS_IN_SEGMENT + 4]
            .copy_from_slice(&(START_MULTI | 1).to_le_bytes());
        let out = without_pages(
            &file,
            &[
                IMAGE + 0x4000..IMAGE + 0xc000,
                CONSTANTS + 0x4000..CONSTANTS + 0xc000,
            ],
            of_at_least(PAGE),
        )
        .unwrap();
        let labels: Vec<Vec<u8>> = segments_of(&out)
            .into_iter()
            .map(|segment| segment.0)
            .collect();
        assert_eq!(
            labels,
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__TEXT.1",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
    }

    #[test]
    fn the_largest_gaps_of_both_segments_take_the_room_there_is() {
        let mut file = executable();
        let end_of_commands = 32 + u32_at(&file, 20).unwrap();
        let text = commands(&file).unwrap()[1].1;
        let room = (SEGMENT + SECTION) as u32;
        put_u32(&mut file, text + SEGMENT + 48, end_of_commands + 16 + room).unwrap();
        put_u64(
            &mut file,
            text + SEGMENT + 32,
            IMAGE + u64::from(end_of_commands + 16 + room),
        )
        .unwrap();
        put_u64(
            &mut file,
            text + SEGMENT + 40,
            0x10000 - u64::from(end_of_commands + 16 + room),
        )
        .unwrap();
        let out = without_pages(
            &file,
            &[
                IMAGE + 0x4000..IMAGE + 0x8000,
                CONSTANTS + 0x4000..CONSTANTS + 0xc000,
            ],
            of_at_least(PAGE),
        )
        .unwrap();
        let labels: Vec<Vec<u8>> = segments_of(&out)
            .into_iter()
            .map(|segment| segment.0)
            .collect();
        assert_eq!(
            labels,
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__DATA_CONST.0",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
    }

    #[test]
    fn a_hole_that_is_too_small_stays_in_the_file() {
        let dead = [
            IMAGE + 0x4000..IMAGE + 0x8000,
            CONSTANTS + 0x4000..CONSTANTS + 0xc000,
        ];
        let labels = |smallest: u64| {
            segments_of(&without_pages(&executable(), &dead, of_at_least(smallest)).unwrap())
                .into_iter()
                .map(|segment| segment.0)
                .collect::<Vec<Vec<u8>>>()
        };
        assert_eq!(
            labels(0x4000),
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__TEXT.1",
                b"__DATA_CONST.0",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!(
            labels(0x8000),
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__DATA_CONST.0",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!(
            without_pages(&executable(), &dead, of_at_least(0x8001)).unwrap(),
            executable()
        );
    }

    #[test]
    fn no_more_holes_than_are_asked_for_in_both_segments_together() {
        let dead = [
            IMAGE + 0x4000..IMAGE + 0x8000,
            CONSTANTS + 0x4000..CONSTANTS + 0xc000,
            CONSTANTS + 0x10000..CONSTANTS + 0x1c000,
        ];
        let labels = |most_holes: usize| {
            segments_of(
                &without_pages(
                    &executable(),
                    &dead,
                    crate::Limits {
                        smallest_hole: PAGE,
                        most_holes,
                    },
                )
                .unwrap(),
            )
            .into_iter()
            .map(|segment| segment.0)
            .collect::<Vec<Vec<u8>>>()
        };
        assert_eq!(labels(3).len(), 8);
        assert_eq!(
            labels(2),
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__DATA_CONST.0",
                b"__DATA_CONST.1",
                b"__DATA_CONST",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!(
            labels(1),
            [
                &b"__PAGEZERO"[..],
                b"__TEXT",
                b"__DATA_CONST",
                b"__DATA_CONST.1",
                b"__DATA",
                b"__LINKEDIT"
            ]
        );
        assert_eq!(labels(0).len(), 5);
    }

    #[test]
    fn where_there_are_fixups() {
        let file = executable();
        assert_eq!(
            is_in_text(&file, &(IMAGE + 0x4000..IMAGE + 0x8000)),
            Ok(true)
        );
        assert_eq!(
            is_in_text(&file, &(IMAGE + 0xc000..CONSTANTS + 1)),
            Ok(false)
        );
        assert_eq!(
            is_in_text(&file, &(CONSTANTS + 0x4000..CONSTANTS + 0x8000)),
            Ok(false)
        );
        let found: Vec<(&[u8], usize)> = sections(&file)
            .unwrap()
            .iter()
            .map(|section| (section.name, section.offset))
            .collect();
        assert_eq!(
            found,
            [
                (&b"__text"[..], 0x2000),
                (b"__got", 0x10000),
                (b"__const", 0x10010),
                (b"__data", 0x34000)
            ]
        );
    }
    #[test]
    fn what_holds_fixups_is_not_filled_with_traps() {
        let island = |addresses: Range<u64>| crate::Island {
            addresses,
            needed_by: vec![0],
        };
        let table = crate::Table {
            stub: IMAGE + 0x2000,
            features: vec![b"a"],
            conditions: Vec::new(),
            islands: vec![
                island(IMAGE + 0x4000..IMAGE + 0xc000),
                island(CONSTANTS + 0x3000..CONSTANTS + 0xd000),
            ],
            doors: Vec::new(),
            packages: Vec::new(),
        };
        let mut file = executable();
        let dead = crate::shut(&mut file, crate::Container::MachO, true, &table, &[true]).unwrap();
        assert_eq!(
            dead,
            [
                IMAGE + 0x4000..IMAGE + 0xc000,
                CONSTANTS + 0x3000..CONSTANTS + 0xd000
            ]
        );
        assert!(
            file[0x4000..0xc000]
                .chunks(4)
                .all(|word| word == [0x20, 0x00, 0x20, 0xd4])
        );
        assert_eq!(file[..0x4000], executable()[..0x4000]);
        assert_eq!(file[0xc000..], executable()[0xc000..]);
    }
}
