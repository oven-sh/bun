//! PE32+.
//!
//! Sections have to follow each other in the address space without a gap, but a section need not hold anything in the file.
//! So a section with pages left out becomes one section per stretch that stays, and one per gap, which holds nothing and may
//! not be read, written or run. Addresses here are relative to the image base.

use core::ops::Range;

use crate::bytes::{minus, narrow, put_u16, put_u32, slice, u16_at, u32_at, whole_pages};
use crate::{Error, Result};

const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64: u16 = 0xaa64;
const SECTION: usize = 40;
/// What the Windows loader accepts.
const MOST_SECTIONS: usize = 96;
const IMAGE_SCN_CNT_UNINITIALIZED_DATA: u32 = 0x80;
const IMAGE_SCN_MEM_WRITE: u32 = 0x8000_0000;
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;

pub(crate) fn is(file: &[u8]) -> bool {
    file.starts_with(b"MZ")
}

pub(crate) fn is_arm64(file: &[u8]) -> Result<bool> {
    match u16_at(file, u32_at(file, 0x3c)? as usize + 4)? {
        IMAGE_FILE_MACHINE_AMD64 => Ok(false),
        IMAGE_FILE_MACHINE_ARM64 => Ok(true),
        _ => Err(Error::UnrecognizedExecutable),
    }
}

struct Section {
    header: usize,
    address: u64,
    size: u64,
    raw_size: u64,
    raw: u64,
    flags: u32,
}

fn sections(file: &[u8]) -> Result<(usize, Vec<Section>)> {
    let pe = u32_at(file, 0x3c)? as usize;
    if slice(file, pe, 4)? != b"PE\0\0" || u16_at(file, pe + 24)? != 0x20b {
        return Err(Error::UnrecognizedExecutable);
    }
    let first = pe + 24 + usize::from(u16_at(file, pe + 20)?);
    let mut list = Vec::new();
    for index in 0..usize::from(u16_at(file, pe + 6)?) {
        let header = first + index * SECTION;
        list.push(Section {
            header,
            size: u32_at(file, header + 8)?.into(),
            address: u32_at(file, header + 12)?.into(),
            raw_size: u32_at(file, header + 16)?.into(),
            raw: u32_at(file, header + 20)?.into(),
            flags: u32_at(file, header + 36)?,
        });
    }
    Ok((pe, list))
}

/// Where in the file the section is.
pub(crate) fn section(file: &[u8], name: &[u8; 8]) -> Result<Option<Range<usize>>> {
    for s in sections(file)?.1 {
        if slice(file, s.header, 8)? == name {
            return Ok(Some(
                s.raw as usize..(s.raw + s.size.min(s.raw_size)) as usize,
            ));
        }
    }
    Ok(None)
}

/// Where in the file the byte at `address` is.
pub(crate) fn offset_of(file: &[u8], address: u64) -> Result<usize> {
    let found = sections(file)?
        .1
        .into_iter()
        .find(|s| address >= s.address && address - s.address < s.raw_size);
    found
        .map(|s| (s.raw + (address - s.address)) as usize)
        .ok_or(Error::InvalidTable)
}

/// `file` without the whole pages of `dead`, which is sorted address ranges.
pub(crate) fn without_pages(file: &[u8], dead: &[Range<u64>]) -> Result<Vec<u8>> {
    let (pe, sections) = sections(file)?;
    let optional = pe + 24;
    let (page, file_alignment) = (
        u64::from(u32_at(file, optional + 32)?),
        u32_at(file, optional + 36)? as usize,
    );
    if !page.is_power_of_two()
        || !file_alignment.is_power_of_two()
        || !(0x200..=0x1_0000).contains(&file_alignment)
        || sections.is_empty()
        // The directories that are read below are there.
        || u32_at(file, optional + 108)? <= IMAGE_DIRECTORY_ENTRY_DEBUG as u32
        || usize::from(u16_at(file, pe + 20)?) < 112 + (IMAGE_DIRECTORY_ENTRY_DEBUG + 1) * 8
    {
        return Err(Error::InvalidExecutable);
    }
    let directory = |index: usize| {
        Ok((
            u64::from(u32_at(file, optional + 112 + index * 8)?),
            u64::from(u32_at(file, optional + 116 + index * 8)?),
        ))
    };

    // The loader adds to the pointers that the base relocations list. There are none in what is left out.
    let mut relocated_pages: Vec<u64> = Vec::new();
    let (relocations, relocations_size) = directory(IMAGE_DIRECTORY_ENTRY_BASERELOC)?;
    if relocations_size != 0 {
        let start = offset_of(file, relocations)?;
        let mut at = start;
        while at < start + relocations_size as usize {
            let size = u32_at(file, at + 4)? as usize;
            if size < 8 {
                return Err(Error::InvalidExecutable);
            }
            relocated_pages.push(u32_at(file, at)?.into());
            at += size;
        }
    }
    relocated_pages.sort_unstable();

    let mut gaps: Vec<Range<u64>> = Vec::new();
    for gap in dead.iter().filter_map(|range| whole_pages(range, page)) {
        let holds =
            |s: &&Section| gap.start >= s.address && gap.end <= s.address + s.raw_size.min(s.size);
        let next = relocated_pages.partition_point(|&p| p < gap.start);
        let is_relocated = relocated_pages.get(next).is_some_and(|&p| p < gap.end);
        if !is_relocated
            && sections
                .iter()
                .find(holds)
                .is_some_and(|s| s.flags & IMAGE_SCN_MEM_WRITE == 0)
        {
            gaps.push(gap);
        }
    }
    // Two more sections each, and one is left for whoever adds the application. The headers end where the first section is.
    let first_header = sections[0].header;
    let most =
        MOST_SECTIONS.min(minus(sections[0].address, first_header as u64)? as usize / SECTION);
    gaps.sort_by_key(|g| core::cmp::Reverse(g.end - g.start));
    gaps.truncate(most.saturating_sub(sections.len() + 1) / 2);
    gaps.sort_by_key(|g| g.start);
    if gaps.is_empty() {
        return Ok(file.to_vec());
    }

    // What is written below is the headers and the sections. There is nothing else: no symbols, and behind the last section at
    // most a signature, which is of the file as it was.
    let end =
        (sections.iter().map(|s| s.raw + s.raw_size).max()).ok_or(Error::InvalidExecutable)?;
    let (signature, signature_size) = directory(IMAGE_DIRECTORY_ENTRY_SECURITY)?;
    let is_all = match signature_size {
        0 => end == file.len() as u64,
        // This one directory says where in the file.
        _ => {
            signature == end.next_multiple_of(8)
                && (signature + signature_size).next_multiple_of(8) == file.len() as u64
        }
    };
    if u32_at(file, pe + 12)? != 0 || !is_all {
        return Err(Error::InvalidExecutable);
    }

    // ---- {header it is made from, addresses it spans, how much of that is in the file, is it a gap}
    let mut parts: Vec<(&Section, Range<u64>, u64, bool)> = Vec::new();
    for s in &sections {
        let mut start = s.address;
        for gap in gaps
            .iter()
            .filter(|g| g.start >= s.address && g.end <= s.address + s.raw_size)
        {
            if gap.start > start {
                parts.push((s, start..gap.start, gap.start - start, false));
            }
            parts.push((s, gap.clone(), 0, true));
            start = gap.end;
        }
        if start == s.address || start < s.address + s.size {
            let rest = (s.address + s.raw_size).saturating_sub(start);
            parts.push((s, start..s.address + s.size, rest, false));
        }
    }

    // With the one that is left for the application.
    let size_of_headers = (first_header + (parts.len() + 1) * SECTION)
        .next_multiple_of(file_alignment)
        .max(u32_at(file, optional + 60)? as usize);
    let mut out = slice(file, 0, first_header)?.to_vec();
    out.resize(size_of_headers, 0);
    // {addresses, where in the new file}
    let mut placed: Vec<(Range<u64>, usize)> = Vec::new();
    for (index, (s, span, in_file, is_gap)) in parts.iter().enumerate() {
        let header = first_header + index * SECTION;
        out[header..header + SECTION].copy_from_slice(slice(file, s.header, SECTION)?);
        let raw = out.len();
        out.extend_from_slice(slice(
            file,
            (s.raw + (span.start - s.address)) as usize,
            *in_file as usize,
        )?);
        out.resize(out.len().next_multiple_of(file_alignment), 0);
        put_u32(&mut out, header + 8, narrow(span.end - span.start)?)?;
        put_u32(&mut out, header + 12, narrow(span.start)?)?;
        let raw_size = narrow((out.len() - raw) as u64)?;
        put_u32(&mut out, header + 16, raw_size)?;
        let raw_or_none = if *in_file == 0 {
            0
        } else {
            narrow(raw as u64)?
        };
        put_u32(&mut out, header + 20, raw_or_none)?;
        if *is_gap {
            put_u32(&mut out, header + 36, IMAGE_SCN_CNT_UNINITIALIZED_DATA)?;
        }
        placed.push((span.start..span.start + in_file, raw));
    }
    put_u16(&mut out, pe + 6, parts.len() as u16)?;
    put_u32(&mut out, optional + 60, narrow(size_of_headers as u64)?)?;
    put_u32(
        &mut out,
        optional + 112 + IMAGE_DIRECTORY_ENTRY_SECURITY * 8,
        0,
    )?;
    put_u32(
        &mut out,
        optional + 116 + IMAGE_DIRECTORY_ENTRY_SECURITY * 8,
        0,
    )?;

    // The debug directory says where its data is in the file as well.
    let (debug, debug_size) = directory(IMAGE_DIRECTORY_ENTRY_DEBUG)?;
    let new_offset = |address: u64| {
        placed
            .iter()
            .find(|p| p.0.contains(&address))
            .map(|p| p.1 + (address - p.0.start) as usize)
    };
    for entry in (debug..debug + debug_size).step_by(28) {
        let at = new_offset(entry).ok_or(Error::InvalidExecutable)?;
        let data = u32_at(&out, at + 20)?;
        if data != 0 {
            let offset = new_offset(data.into()).ok_or(Error::InvalidExecutable)?;
            put_u32(&mut out, at + 24, narrow(offset as u64)?)?;
        }
    }
    Ok(out)
}
