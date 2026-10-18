//! ELF, 64-bit, little endian.
//!
//! A segment with pages left out becomes one segment per stretch that stays, each at the address it had. The gaps between
//! them are not mapped. That takes more program headers than the linker made room for: see `room_for_program_headers`.

use bun_collections::index_sort::sort_slice_by_key;
use core::ops::Range;

use crate::bytes::{
    minus, plus, put_u16, put_u32, put_u64, slice, slice_mut, u16_at, u32_at, u64_at, usize_at,
    whole_pages,
};
use crate::{Error, Result};

const PT_NULL: u32 = 0;
const PT_LOAD: u32 = 1;
const PT_NOTE: u32 = 4;
const PT_PHDR: u32 = 6;
const PF_W: u32 = 2;
const SHT_PROGBITS: u32 = 1;
const SHT_SYMTAB: u32 = 2;
const SHT_NOBITS: u32 = 8;
const SHF_ALLOC: u64 = 2;
const SHN_UNDEF: u16 = 0;
const SHN_LORESERVE: usize = 0xff00;
const EM_X86_64: u16 = 62;
const EM_AARCH64: u16 = 183;
const PROGRAM_HEADER: usize = 56;
const MOST_PROGRAM_HEADERS: usize = 0x1000 / PROGRAM_HEADER;
const SECTION_HEADER: usize = 64;
const SYMBOL: usize = 24;

pub(crate) fn is(file: &[u8]) -> bool {
    file.starts_with(b"\x7fELF\x02\x01")
}

pub(crate) fn is_arm64(file: &[u8]) -> Result<bool> {
    match u16_at(file, 18)? {
        EM_X86_64 => Ok(false),
        EM_AARCH64 => Ok(true),
        _ => Err(Error::UnrecognizedExecutable),
    }
}

#[derive(Clone)]
struct ProgramHeader {
    kind: u32,
    flags: u32,
    offset: u64,
    address: u64,
    physical_address: u64,
    file_size: u64,
    memory_size: u64,
    align: u64,
}

impl ProgramHeader {
    fn write(&self, out: &mut [u8], at: usize) -> Result<()> {
        put_u32(out, at, self.kind)?;
        put_u32(out, at + 4, self.flags)?;
        let rest = [
            self.offset,
            self.address,
            self.physical_address,
            self.file_size,
            self.memory_size,
            self.align,
        ];
        for (index, value) in rest.into_iter().enumerate() {
            put_u64(out, at + 8 + index * 8, value)?;
        }
        Ok(())
    }
}

fn program_headers(file: &[u8]) -> Result<Vec<ProgramHeader>> {
    let first = usize_at(file, 0x20)?;
    if usize::from(u16_at(file, 0x36)?) != PROGRAM_HEADER {
        return Err(Error::InvalidExecutable);
    }
    let mut list = Vec::new();
    for index in 0..usize::from(u16_at(file, 0x38)?) {
        let at = first + index * PROGRAM_HEADER;
        list.push(ProgramHeader {
            kind: u32_at(file, at)?,
            flags: u32_at(file, at + 4)?,
            offset: u64_at(file, at + 8)?,
            address: u64_at(file, at + 16)?,
            physical_address: u64_at(file, at + 24)?,
            file_size: u64_at(file, at + 32)?,
            memory_size: u64_at(file, at + 40)?,
            align: u64_at(file, at + 48)?,
        });
    }
    // So that what follows can add and subtract these.
    for h in &list {
        if plus(h.offset, h.file_size)? > file.len() as u64 || h.file_size > h.memory_size {
            return Err(Error::InvalidExecutable);
        }
        plus(h.address, h.memory_size)?;
        plus(h.physical_address, h.memory_size)?;
    }
    Ok(list)
}

/// {where the section headers are, how many}
fn section_headers(file: &[u8]) -> Result<(usize, usize)> {
    let (first, count) = (usize_at(file, 0x28)?, usize::from(u16_at(file, 0x3c)?));
    if count != 0 && usize::from(u16_at(file, 0x3a)?) != SECTION_HEADER {
        return Err(Error::InvalidExecutable);
    }
    slice(file, first, count * SECTION_HEADER)?;
    Ok((first, count))
}

/// `scripts/build/islands.ts` links in a note whose contents are room for them. A note, because the linker puts those at the start of
/// the file, before the first gap: see `without_pages`.
fn room_for_program_headers(file: &[u8], headers: &[ProgramHeader]) -> Result<Range<usize>> {
    for h in headers.iter().filter(|h| h.kind == PT_NOTE) {
        let align = if h.align == 8 { 8 } else { 4 };
        let (mut at, end) = (h.offset as usize, (h.offset + h.file_size) as usize);
        while at + 12 <= end {
            let (name_size, size) = (u32_at(file, at)? as usize, u32_at(file, at + 4)? as usize);
            let contents = (at + 12 + name_size).next_multiple_of(align);
            if slice(file, at + 12, name_size)? == b"Bun\0" && u32_at(file, at + 8)? == 1 {
                slice(file, contents, size)?;
                return Ok(contents..contents + size);
            }
            at = (contents + size).next_multiple_of(align);
        }
    }
    Err(Error::InvalidExecutable)
}

struct Moved {
    block: Range<u64>,
    by: u64,
    unused: Range<u64>,
}

fn grow_table_in_place(
    file: &[u8],
    out: &mut [u8],
    headers: &[ProgramHeader],
    new: &mut Vec<ProgramHeader>,
    room: &Range<usize>,
) -> Result<Option<Moved>> {
    const NOTE_HEADER: u64 = 16;
    let table = u64_at(file, 0x20)?;
    let block =
        table + (headers.len() * PROGRAM_HEADER) as u64..minus(room.start as u64, NOTE_HEADER)?;
    let (room_start, room_end) = (room.start as u64, room.end as u64);
    let is_in_block =
        |h: &ProgramHeader| block.contains(&h.offset) && h.offset + h.file_size <= block.end;
    let is_the_note = |h: &ProgramHeader| {
        h.kind == PT_NOTE && h.offset == block.end && h.offset + h.file_size == room_end
    };
    let touches = |h: &ProgramHeader| {
        h.kind != PT_LOAD
            && h.kind != PT_PHDR
            && h.offset < room_end
            && h.offset + h.file_size > block.start
    };
    if block.start > block.end
        || !headers
            .iter()
            .filter(|h| touches(h))
            .all(|h| is_in_block(h) || is_the_note(h))
    {
        return Ok(None);
    }
    new.retain(|h| !is_the_note(h));
    let end = table + (new.len() * PROGRAM_HEADER) as u64;
    let to = minus(room_end, (block.end - block.start).next_multiple_of(16))? / 16 * 16
        + block.start % 16;
    let to = if to + (block.end - block.start) > room_end {
        minus(to, 16)?
    } else {
        to
    };
    if end > to || to < room_start {
        return Ok(None);
    }
    let by = to - block.start;
    out.copy_within(block.start as usize..block.end as usize, to as usize);
    for h in new.iter_mut().filter(|h| is_in_block(h)) {
        (h.offset, h.address, h.physical_address) =
            (h.offset + by, h.address + by, h.physical_address + by);
    }
    let size = end - table;
    for h in new.iter_mut().filter(|h| h.kind == PT_PHDR) {
        (h.file_size, h.memory_size) = (size, size);
    }
    for (index, h) in new.iter().enumerate() {
        h.write(out, table as usize + index * PROGRAM_HEADER)?;
    }
    slice_mut(out, end as usize, (to - end) as usize)?.fill(0);
    put_u16(out, 0x38, new.len() as u16)?;
    Ok(Some(Moved {
        block,
        by,
        unused: end..to,
    }))
}

/// `range` without `gaps`, which are sorted.
fn stretches(range: Range<u64>, gaps: &[Range<u64>]) -> Vec<Range<u64>> {
    let mut list = Vec::new();
    let mut start = range.start;
    for gap in gaps
        .iter()
        .filter(|g| g.start < range.end && g.end > range.start)
    {
        if gap.start > start {
            list.push(start..gap.start);
        }
        start = start.max(gap.end);
    }
    if start < range.end {
        list.push(start..range.end);
    }
    list
}

/// `file` without the whole pages of `dead`, which is sorted address ranges.
pub(crate) fn without_pages(
    file: &[u8],
    dead: &[Range<u64>],
    limits: crate::Limits,
) -> Result<Vec<u8>> {
    let headers = program_headers(file)?;
    let room = room_for_program_headers(file, &headers)?;
    let loads = || headers.iter().filter(|h| h.kind == PT_LOAD);
    // A file offset and its address are the same but for a multiple of this.
    let page = loads().map(|h| h.align).max().unwrap_or(0).max(0x1000);
    // Older Linux takes the table to be as far from the first segment in memory as in the file. (patchelf puts a segment of its
    // own first.)
    let first = loads().next().ok_or(Error::InvalidExecutable)?;
    let holds_room = |h: &&ProgramHeader| {
        room.start as u64 >= h.offset && room.end as u64 - h.offset <= h.file_size
    };
    let around_room = loads().find(holds_room).ok_or(Error::InvalidExecutable)?;
    if !page.is_power_of_two()
        || around_room.address.wrapping_sub(around_room.offset)
            != first.address.wrapping_sub(first.offset)
        || room.start % 8 != 0
    {
        return Err(Error::InvalidExecutable);
    }

    // {addresses, where in the file}
    let mut gaps: Vec<(Range<u64>, u64)> = Vec::new();
    for range in dead {
        let Some(gap) = whole_pages(range, page, limits.smallest_hole) else {
            continue;
        };
        let holds = |h: &&ProgramHeader| {
            let is_all_in_the_file = h.flags & PF_W == 0 && h.memory_size == h.file_size;
            is_all_in_the_file && gap.start >= h.address && gap.end - h.address <= h.file_size
        };
        if let Some(h) = loads().find(holds)
            && h.offset + (gap.start - h.address) >= room.end as u64
        {
            gaps.push((gap.clone(), h.offset + (gap.start - h.address)));
        }
    }
    // One more header each. The largest that there is room for.
    sort_slice_by_key(&mut gaps, |g| core::cmp::Reverse(g.0.end - g.0.start));
    gaps.truncate(
        (room.len() / PROGRAM_HEADER)
            .min(MOST_PROGRAM_HEADERS)
            .saturating_sub(headers.len())
            .min(limits.most_holes),
    );
    sort_slice_by_key(&mut gaps, |g| g.1);
    if gaps.is_empty() {
        return Ok(file.to_vec());
    }
    let new_offset = |old: u64| {
        let before = gaps.iter().take_while(|g| g.1 < old);
        old - before
            .map(|g| (g.0.end - g.0.start).min(old - g.1))
            .sum::<u64>()
    };
    let mut out = Vec::with_capacity(file.len());
    let mut at = 0;
    for (gap, offset) in &gaps {
        out.extend_from_slice(slice(
            file,
            at,
            (*offset as usize)
                .checked_sub(at)
                .ok_or(Error::InvalidExecutable)?,
        )?);
        at = (offset + (gap.end - gap.start)) as usize;
    }
    out.extend_from_slice(file.get(at..).ok_or(Error::InvalidExecutable)?);
    let mut gaps: Vec<Range<u64>> = gaps.iter().map(|g| g.0.clone()).collect();
    sort_slice_by_key(&mut gaps, |g| g.start);

    // ---- program headers
    let mut new: Vec<ProgramHeader> = Vec::new();
    for h in &headers {
        let whole = h.address..h.address + h.file_size;
        let has_gaps = h.kind == PT_LOAD
            && gaps
                .iter()
                .any(|g| g.start >= whole.start && g.end <= whole.end);
        if !has_gaps {
            new.push(ProgramHeader {
                offset: new_offset(h.offset),
                ..h.clone()
            });
            continue;
        }
        for part in stretches(whole, &gaps) {
            let from_start = part.start - h.address;
            new.push(ProgramHeader {
                offset: new_offset(h.offset + from_start),
                address: part.start,
                physical_address: h.physical_address + from_start,
                file_size: part.end - part.start,
                memory_size: part.end - part.start,
                ..h.clone()
            });
        }
    }
    let moved = grow_table_in_place(file, &mut out, &headers, &mut new, &room)?;
    if moved.is_none() {
        let size = (new.len() * PROGRAM_HEADER) as u64;
        for h in new.iter_mut().filter(|h| h.kind == PT_PHDR) {
            (h.offset, h.address, h.physical_address) = (
                room.start as u64,
                around_room.address + (room.start as u64 - around_room.offset),
                around_room.physical_address + (room.start as u64 - around_room.offset),
            );
            (h.file_size, h.memory_size) = (size, size);
        }
        let (room_start, room_end) = (room.start as u64, room.end as u64);
        for h in new.iter_mut().filter(|h| h.kind == PT_NOTE) {
            if h.offset <= room_start && room_end <= h.offset + h.file_size {
                h.kind = PT_NULL;
            }
        }
        for (index, h) in new.iter().enumerate() {
            h.write(&mut out, room.start + index * PROGRAM_HEADER)?;
        }
        put_u64(&mut out, 0x20, room.start as u64)?;
        put_u16(&mut out, 0x38, new.len() as u16)?;
    }

    // ---- section headers: the same for what they describe. The new ones come last, so that the others keep their numbers.
    let (first_section, count) = section_headers(file)?;
    if count == 0 {
        return Ok(out);
    }
    let mut table = slice(file, first_section, count * SECTION_HEADER)?.to_vec();
    // {number it had, addresses, number it has}
    let mut parts: Vec<(usize, Range<u64>, usize)> = Vec::new();
    for index in 0..count {
        let at = index * SECTION_HEADER;
        let (address, offset, size) = (
            u64_at(&table, at + 16)?,
            u64_at(&table, at + 24)?,
            u64_at(&table, at + 32)?,
        );
        put_u64(&mut table, at + 24, new_offset(offset))?;
        if u64_at(&table, at + 8)? & SHF_ALLOC == 0 || u32_at(&table, at + 4)? == SHT_NOBITS {
            continue;
        }
        if let Some(moved) = &moved {
            if moved.block.contains(&offset) && offset + size <= moved.block.end {
                put_u64(&mut table, at + 16, address + moved.by)?;
                put_u64(&mut table, at + 24, offset + moved.by)?;
                continue;
            }
            if offset == moved.block.end {
                put_u32(&mut table, at + 4, SHT_PROGBITS)?;
                put_u64(&mut table, at + 16, address + (moved.unused.start - offset))?;
                put_u64(&mut table, at + 24, moved.unused.start)?;
                put_u64(&mut table, at + 32, moved.unused.end - moved.unused.start)?;
                continue;
            }
        }
        let whole = address..plus(address, size)?;
        plus(offset, size)?;
        let kept = stretches(whole.clone(), &gaps);
        if kept == [whole] {
            continue;
        }
        for (nth, part) in kept.iter().enumerate() {
            let header = if nth == 0 { at } else { table.len() };
            if nth != 0 {
                table.extend_from_within(at..at + SECTION_HEADER);
            }
            put_u64(&mut table, header + 16, part.start)?;
            put_u64(
                &mut table,
                header + 24,
                new_offset(offset + (part.start - address)),
            )?;
            put_u64(&mut table, header + 32, part.end - part.start)?;
            parts.push((index, part.clone(), header / SECTION_HEADER));
        }
        if kept.is_empty() {
            put_u64(&mut table, at + 32, 0)?;
        }
    }
    if table.len() / SECTION_HEADER >= SHN_LORESERVE {
        return Err(Error::InvalidExecutable);
    }
    // Symbols say which section they are in, by number. One in a gap is in none: it is of something that is gone.
    for at in (0..count).map(|index| index * SECTION_HEADER) {
        if u32_at(&table, at + 4)? != SHT_SYMTAB {
            continue;
        }
        let (symbols, size) = (
            u64_at(&table, at + 24)? as usize,
            u64_at(&table, at + 32)? as usize,
        );
        for symbol in (symbols..symbols.saturating_add(size)).step_by(SYMBOL) {
            let (number, value) = (
                usize::from(u16_at(&out, symbol + 6)?),
                u64_at(&out, symbol + 8)?,
            );
            let of_section = || parts.iter().filter(|p| p.0 == number);
            if of_section().next().is_some() {
                // In a part, or at the end of one.
                let part = (of_section().find(|p| p.1.contains(&value)))
                    .or_else(|| of_section().find(|p| p.1.end == value));
                put_u16(&mut out, symbol + 6, part.map_or(SHN_UNDEF, |p| p.2 as u16))?;
            }
        }
    }
    if first_section + count * SECTION_HEADER == file.len() {
        out.truncate(minus(out.len() as u64, (count * SECTION_HEADER) as u64)? as usize);
    }
    out.resize(out.len().next_multiple_of(8), 0);
    let new_first_section = out.len() as u64;
    put_u64(&mut out, 0x28, new_first_section)?;
    put_u16(&mut out, 0x3c, (table.len() / SECTION_HEADER) as u16)?;
    out.extend_from_slice(&table);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: u64 = 0x210000;
    const PAGE: u64 = 0x1000;
    const PAGES: u64 = 400;

    fn executable(room: u64) -> Vec<u8> {
        let note = 0x40 + 4 * PROGRAM_HEADER as u64;
        let headers = [
            (PT_PHDR, 4, 0x40, 0x200040, 4 * PROGRAM_HEADER as u64, 8),
            (PT_LOAD, 4, 0, 0x200000, 0x10000, PAGE),
            (PT_NOTE, 4, note, 0x200000 + note, 16 + room, 8),
            (PT_LOAD, 5, 0x10000, CODE, PAGES * PAGE, PAGE),
        ];
        let mut file: Vec<u8> = (0..0x10000 + PAGES * PAGE)
            .map(|at| (at / PAGE) as u8)
            .collect();
        file[..0x10000].fill(0);
        file[..4].copy_from_slice(b"\x7fELF");
        put_u64(&mut file, 0x20, 0x40).unwrap();
        put_u16(&mut file, 0x36, PROGRAM_HEADER as u16).unwrap();
        put_u16(&mut file, 0x38, headers.len() as u16).unwrap();
        for (index, (kind, flags, offset, address, size, align)) in headers.into_iter().enumerate()
        {
            let header = ProgramHeader {
                kind,
                flags,
                offset,
                address,
                physical_address: address,
                file_size: size,
                memory_size: size,
                align,
            };
            header
                .write(&mut file, 0x40 + index * PROGRAM_HEADER)
                .unwrap();
        }
        for (field, value) in [4, room as u32, 1].into_iter().enumerate() {
            put_u32(&mut file, note as usize + field * 4, value).unwrap();
        }
        file[note as usize + 12..][..4].copy_from_slice(b"Bun\0");
        file
    }

    fn pages(range: Range<u64>) -> Range<u64> {
        CODE + range.start * PAGE..CODE + range.end * PAGE
    }

    fn of_at_least(smallest_hole: u64) -> crate::Limits {
        crate::Limits {
            smallest_hole,
            most_holes: usize::MAX,
        }
    }

    fn code_of(file: &[u8]) -> Vec<Range<u64>> {
        let loads = program_headers(file)
            .unwrap()
            .into_iter()
            .filter(|h| h.kind == PT_LOAD && h.address >= CODE);
        loads
            .map(|h| (h.address - CODE) / PAGE..(h.address + h.file_size - CODE) / PAGE)
            .collect()
    }

    #[test]
    fn a_hole_that_is_too_small_stays_in_the_file() {
        let file = executable(3584);
        let dead = [
            pages(10..20),
            pages(30..62),
            pages(100..131),
            pages(200..300),
        ];
        assert_eq!(
            code_of(&without_pages(&file, &dead, of_at_least(PAGE)).unwrap()),
            [0..10, 20..30, 62..100, 131..200, 300..PAGES]
        );
        let out = without_pages(&file, &dead, of_at_least(32 * PAGE)).unwrap();
        assert_eq!(code_of(&out), [0..30, 62..200, 300..PAGES]);
        assert_eq!(out.len() as u64, file.len() as u64 - 132 * PAGE);
        assert_eq!(
            without_pages(&file, &dead, of_at_least(101 * PAGE)).unwrap(),
            file
        );
    }

    #[test]
    fn what_stays_is_where_its_header_says() {
        let out = without_pages(
            &executable(3584),
            &[pages(10..20), pages(200..300)],
            of_at_least(PAGE),
        )
        .unwrap();
        for h in program_headers(&out)
            .unwrap()
            .into_iter()
            .filter(|h| h.kind == PT_LOAD && h.address >= CODE)
        {
            for page in (0..h.file_size).step_by(PAGE as usize) {
                assert_eq!(
                    out[(h.offset + page) as usize],
                    ((0x10000 + h.address - CODE + page) / PAGE) as u8
                );
            }
        }
    }

    #[test]
    fn the_largest_holes_take_the_room_there_is() {
        let file = executable(7 * PROGRAM_HEADER as u64);
        let dead = [
            pages(10..12),
            pages(20..25),
            pages(30..31),
            pages(40..44),
            pages(50..53),
        ];
        assert_eq!(
            code_of(&without_pages(&file, &dead, of_at_least(PAGE)).unwrap()),
            [0..20, 25..40, 44..50, 53..PAGES]
        );
    }

    #[test]
    fn no_more_holes_than_are_asked_for() {
        let dead = [
            pages(10..12),
            pages(20..25),
            pages(30..31),
            pages(40..44),
            pages(50..53),
        ];
        let with_at_most = |most_holes: usize| {
            code_of(
                &without_pages(
                    &executable(3584),
                    &dead,
                    crate::Limits {
                        smallest_hole: PAGE,
                        most_holes,
                    },
                )
                .unwrap(),
            )
        };
        assert_eq!(with_at_most(2), [0..20, 25..40, 44..PAGES]);
        assert_eq!(with_at_most(1), [0..20, 25..PAGES]);
        assert_eq!(with_at_most(0).len(), 1);
    }

    #[test]
    fn the_kernel_reads_no_table_of_program_headers_that_is_longer_than_a_page() {
        assert_eq!(MOST_PROGRAM_HEADERS, 73);
        let dead: Vec<Range<u64>> = (0..150)
            .map(|index| pages(index * 2 + 1..index * 2 + 2))
            .collect();
        for (room, most) in [(3584, 64), (73 * 56, 73), (74 * 56, 73), (0x2000, 73)] {
            let out = without_pages(&executable(room), &dead, of_at_least(PAGE)).unwrap();
            let count = usize::from(u16_at(&out, 0x38).unwrap());
            assert!(count <= most && count + 1 >= most, "{room}: {count}");
            assert!(count * PROGRAM_HEADER <= 0x1000);
        }
    }
}
