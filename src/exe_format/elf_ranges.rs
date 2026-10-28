use core::mem::size_of;
use core::ops::Range;

use bun_sys::elf::PT_LOAD;

use crate::cut_model::{CutCapacity, CutModel, NoCutReason};
use crate::elf::{
    EM_AARCH64, EM_X86_64, Elf64_Ehdr, Elf64_Phdr, Elf64_Shdr, ElfFile, SHF_ALLOC, SHN_LORESERVE,
    SHT_NOBITS, SHT_PROGBITS, read_ehdr,
};
use crate::elf_program_headers::{
    PAYLOAD_SEGMENT_COUNT, PF_W, PT_BUN_PAYLOAD, PT_BUN_RESERVED, PT_NULL, PT_PHDR,
    ProgramHeaderTable, bytes_at, read_header,
};
use crate::image::{
    AddressRange, Architecture, ExecutableFormat, ImageBytes, ImageError, MappedSpan,
    RemovedFileRanges, merge_ranges, subtract_cuts,
};
use crate::{align_up, read_struct, write_struct};

const SHT_NULL: u32 = 0;
const SECTION_HEADER_SIZE: usize = size_of::<Elf64_Shdr>();
const SECTION_TABLE_ALIGNMENT: u64 = 8;
const UNREADABLE_FILE_ALIGNMENT: u64 = 0x1000;

pub(crate) fn architecture(ehdr: &Elf64_Ehdr) -> Result<Architecture, ImageError> {
    match ehdr.e_machine {
        EM_X86_64 => Ok(Architecture::X86_64),
        EM_AARCH64 => Ok(Architecture::Aarch64),
        _ => Err(ImageError::UnrecognizedExecutable),
    }
}

pub(crate) fn mapped_spans(elf: &[u8]) -> Result<Vec<MappedSpan>, ImageError> {
    let ehdr = read_header(elf)?;
    ProgramHeaderTable::read(elf, &ehdr)?
        .headers
        .iter()
        .filter(|header| header.p_type == PT_LOAD && header.p_filesz > 0)
        .map(|load| {
            Ok(MappedSpan {
                addresses: AddressRange::from_size(load.p_vaddr, load.p_filesz)?,
                file_offset: load.p_offset,
            })
        })
        .collect()
}

pub(crate) fn cut_model(elf: &[u8]) -> CutModel {
    let format = ExecutableFormat::Elf;
    let Ok(ehdr) = read_header(elf) else {
        let reason = NoCutReason::HeadersUnreadable;
        return CutModel::without_cuts(format, UNREADABLE_FILE_ALIGNMENT, reason);
    };
    let alignment = ElfFile::<Vec<u8>>::page_size(ehdr);
    let without_cuts = |reason| CutModel::without_cuts(format, alignment, reason);
    let Ok(table) = ProgramHeaderTable::read(elf, &ehdr) else {
        return without_cuts(NoCutReason::HeadersUnreadable);
    };
    let capacity = compute_capacity(&ehdr, &table, alignment);
    if let CutCapacity::NoCuts(reason) = capacity {
        return without_cuts(reason);
    }
    match find_cuttable_spans(elf, &ehdr, &table) {
        Ok(cuttable_spans) => CutModel {
            format,
            alignment,
            capacity,
            cuttable_spans,
            spans_cut_only_at_end: Vec::new(),
        },
        Err(_) => without_cuts(NoCutReason::HeadersUnreadable),
    }
}

pub(crate) fn remove_ranges(
    elf: &mut dyn ImageBytes,
    cuts: &[AddressRange],
) -> Result<(), ImageError> {
    if cuts.is_empty() {
        return Ok(());
    }
    let ehdr = read_header(elf)?;
    let mut table = ProgramHeaderTable::read(elf, &ehdr)?;
    let removal = Removal {
        cuts,
        file_ranges: find_removed_file_ranges(&table, cuts, elf.len() as u64)?,
        alignment: ElfFile::<Vec<u8>>::page_size(ehdr),
    };
    // Read before the cuts: one at the end of the highest segment lowers where the mapped addresses end.
    let image_end = find_image_end(&table.headers)?;
    table.headers = removal.update_program_headers(&table.headers)?;
    if table.capacity().saturating_sub(table.headers.len()) < PAYLOAD_SEGMENT_COUNT {
        return Err(ImageError::HeaderRoomExhausted);
    }
    for _ in 0..PAYLOAD_SEGMENT_COUNT {
        table.insert_by_address(create_reserved_header(image_end, removal.alignment)?);
    }
    let section_table = removal.plan_section_table(elf, &ehdr)?;

    // patchelf leaves the previous table after the cuts, so it is cleared before bytes move.
    table.write(elf)?;
    removal.file_ranges.compact(elf);
    write_section_table(elf, &section_table);
    Ok(())
}

fn compute_file_offset(
    base_offset: u64,
    base_address: u64,
    address: u64,
) -> Result<u64, ImageError> {
    address
        .checked_sub(base_address)
        .and_then(|distance| base_offset.checked_add(distance))
        .ok_or(ImageError::MalformedHeaders)
}

fn is_congruent(load: &Elf64_Phdr, alignment: u64) -> bool {
    alignment == 0 || load.p_vaddr % alignment == load.p_offset % alignment
}

// Only a section's type says whether it may lose bytes (`split_allocated_section`).
fn has_section_headers(ehdr: &Elf64_Ehdr) -> bool {
    ehdr.e_shnum > 0
}

fn compute_headers_end(table: &ProgramHeaderTable) -> u64 {
    table.end_file_offset().max(size_of::<Elf64_Ehdr>() as u64)
}

fn compute_capacity(ehdr: &Elf64_Ehdr, table: &ProgramHeaderTable, alignment: u64) -> CutCapacity {
    if !has_section_headers(ehdr) {
        return CutCapacity::NoCuts(NoCutReason::SectionHeadersMissing);
    }
    let mut loads = table
        .headers
        .iter()
        .filter(|header| header.p_type == PT_LOAD);
    if !loads.all(|load| is_congruent(load, alignment)) {
        return CutCapacity::NoCuts(NoCutReason::SegmentsNotCongruent);
    }
    let used = table
        .headers
        .iter()
        .filter(|header| !matches!(header.p_type, PT_NULL | PT_BUN_RESERVED))
        .count();
    CutCapacity::from_free_slots(
        table
            .capacity()
            .saturating_sub(used + PAYLOAD_SEGMENT_COUNT),
    )
}

fn find_required_ranges(
    elf: &[u8],
    ehdr: &Elf64_Ehdr,
    table: &ProgramHeaderTable,
) -> Result<Vec<AddressRange>, ImageError> {
    let headers_end = compute_headers_end(table);
    let mut required = Vec::new();
    for header in &table.headers {
        let size = match header.p_type {
            PT_NULL | PT_BUN_RESERVED | PT_PHDR => continue,
            PT_LOAD => headers_end.saturating_sub(header.p_offset),
            _ => header.p_filesz,
        };
        required.push(AddressRange::from_size(header.p_vaddr, size)?);
    }
    for section in read_section_headers(elf, ehdr)? {
        let is_mapped_from_file = section.sh_flags & SHF_ALLOC != 0
            && section.sh_type != SHT_NOBITS
            && section.sh_size > 0;
        if is_mapped_from_file && section.sh_type != SHT_PROGBITS {
            required.push(AddressRange::from_size(section.sh_addr, section.sh_size)?);
        }
    }
    Ok(merge_ranges(required))
}

fn find_cuttable_spans(
    elf: &[u8],
    ehdr: &Elf64_Ehdr,
    table: &ProgramHeaderTable,
) -> Result<Vec<AddressRange>, ImageError> {
    let required = find_required_ranges(elf, ehdr, table)?;
    let mut spans = Vec::new();
    for load in &table.headers {
        if load.p_type != PT_LOAD || load.p_filesz == 0 || load.p_flags & PF_W != 0 {
            continue;
        }
        let addresses = AddressRange::from_size(load.p_vaddr, load.p_filesz)?;
        spans.extend(subtract_cuts(addresses, &required));
    }
    Ok(spans)
}

// A header that an earlier call reserved lies past what that call cut from the end of the image.
fn find_image_end(headers: &[Elf64_Phdr]) -> Result<u64, ImageError> {
    let mut image_end: u64 = 0;
    for header in headers {
        if matches!(header.p_type, PT_LOAD | PT_BUN_RESERVED) {
            let addresses = AddressRange::from_size(header.p_vaddr, header.p_memsz)?;
            image_end = image_end.max(addresses.end);
        }
    }
    Ok(image_end)
}

// A header for the payload's own segment, so that `.bss` gets no file bytes.
fn create_reserved_header(image_end: u64, alignment: u64) -> Result<Elf64_Phdr, ImageError> {
    let address = image_end
        .checked_next_multiple_of(alignment)
        .ok_or(ImageError::MalformedHeaders)?;
    Ok(Elf64_Phdr {
        p_type: PT_BUN_RESERVED,
        p_vaddr: address,
        p_paddr: address,
        p_align: alignment,
        ..Elf64_Phdr::ZEROED
    })
}

fn create_null_section_header() -> Elf64_Shdr {
    read_struct(&[0u8; SECTION_HEADER_SIZE])
}

fn find_file_range(headers: &[Elf64_Phdr], cut: AddressRange) -> Result<(u64, u64), ImageError> {
    for load in headers.iter().filter(|header| header.p_type == PT_LOAD) {
        if !AddressRange::from_size(load.p_vaddr, load.p_filesz)?.contains(cut) {
            continue;
        }
        if load.p_flags & PF_W != 0 {
            return Err(ImageError::CutInWritableSegment);
        }
        let start = compute_file_offset(load.p_offset, load.p_vaddr, cut.start)?;
        let end = compute_file_offset(load.p_offset, load.p_vaddr, cut.end)?;
        return Ok((start, end));
    }
    Err(ImageError::CutNotFileBacked)
}

fn find_removed_file_ranges(
    table: &ProgramHeaderTable,
    cuts: &[AddressRange],
    file_size: u64,
) -> Result<RemovedFileRanges, ImageError> {
    let headers_end = compute_headers_end(table);
    let mut ranges = Vec::with_capacity(cuts.len());
    for cut in cuts {
        let (start, end) = find_file_range(&table.headers, *cut)?;
        if end > file_size {
            return Err(ImageError::MalformedHeaders);
        }
        if start < headers_end {
            return Err(ImageError::CutHoldsHeaders);
        }
        ranges.push((start, end));
    }
    RemovedFileRanges::new(ranges)
}

fn read_section_headers(elf: &[u8], ehdr: &Elf64_Ehdr) -> Result<Vec<Elf64_Shdr>, ImageError> {
    let size = u64::from(ehdr.e_shnum) * SECTION_HEADER_SIZE as u64;
    let table = bytes_at(elf, ehdr.e_shoff, size);
    Ok(table
        .ok_or(ImageError::MalformedHeaders)?
        .as_chunks::<SECTION_HEADER_SIZE>()
        .0
        .iter()
        .map(|bytes| read_struct(bytes))
        .collect())
}

/// `false`: the program header table has no room, and the file is as it was.
pub fn reserve_payload_segments(elf: &mut [u8]) -> Result<bool, ImageError> {
    let ehdr = read_header(elf)?;
    let mut table = ProgramHeaderTable::read(elf, &ehdr)?;
    if table
        .headers
        .iter()
        .any(|header| matches!(header.p_type, PT_BUN_RESERVED | PT_BUN_PAYLOAD))
    {
        return Ok(true);
    }
    table.headers.retain(|header| header.p_type != PT_NULL);
    let free_headers = table.capacity().saturating_sub(table.headers.len());
    if free_headers == 0 {
        return Ok(false);
    }
    let image_end = find_image_end(&table.headers)?;
    let alignment = ElfFile::<Vec<u8>>::page_size(ehdr);
    for _ in 0..PAYLOAD_SEGMENT_COUNT.min(free_headers) {
        table.insert_by_address(create_reserved_header(image_end, alignment)?);
    }
    table.write(elf)?;
    Ok(true)
}

struct SectionTable {
    headers: Vec<Elf64_Shdr>,
    previous_extent: Range<usize>,
}

fn write_section_table(elf: &mut dyn ImageBytes, table: &SectionTable) {
    let previous_extent = table.previous_extent.clone();
    if previous_extent.end == elf.len() {
        elf.truncate(previous_extent.start);
    } else {
        elf[previous_extent].fill(0);
    }
    let offset = align_up(elf.len() as u64, SECTION_TABLE_ALIGNMENT) as usize;
    elf.grow(offset + table.headers.len() * SECTION_HEADER_SIZE);
    let entries = elf[offset..]
        .as_chunks_mut::<SECTION_HEADER_SIZE>()
        .0
        .iter_mut();
    for (entry, header) in entries.zip(&table.headers) {
        write_struct(entry, header);
    }
    let mut ehdr = read_ehdr(elf);
    ehdr.e_shoff = offset as u64;
    ehdr.e_shnum = table.headers.len() as u16;
    write_struct(elf, &ehdr);
}

struct Removal<'a> {
    cuts: &'a [AddressRange],
    file_ranges: RemovedFileRanges,
    alignment: u64,
}

impl Removal<'_> {
    fn compute_moved_offset(&self, offset: u64, size: u64) -> Result<u64, ImageError> {
        if self
            .file_ranges
            .intersects(offset, offset.saturating_add(size))
        {
            return Err(ImageError::MalformedHeaders);
        }
        Ok(self.file_ranges.moved_floor(offset))
    }

    fn update_program_headers(
        &self,
        headers: &[Elf64_Phdr],
    ) -> Result<Vec<Elf64_Phdr>, ImageError> {
        let mut updated =
            Vec::with_capacity(headers.len() + self.cuts.len() + PAYLOAD_SEGMENT_COUNT);
        for header in headers {
            match header.p_type {
                PT_NULL | PT_BUN_RESERVED => {}
                PT_LOAD => updated.extend(self.split_load_segment(header)?),
                PT_PHDR => updated.push(*header),
                _ => {
                    let p_offset = self
                        .compute_moved_offset(header.p_offset, header.p_filesz)
                        .map_err(|_| ImageError::CutHoldsHeaders)?;
                    updated.push(Elf64_Phdr {
                        p_offset,
                        ..*header
                    });
                }
            }
        }
        Ok(updated)
    }

    fn split_load_segment(&self, load: &Elf64_Phdr) -> Result<Vec<Elf64_Phdr>, ImageError> {
        let addresses = AddressRange::from_size(load.p_vaddr, load.p_memsz)?;
        let file_backed_end = AddressRange::from_size(load.p_vaddr, load.p_filesz)?.end;
        subtract_cuts(addresses, self.cuts)
            .into_iter()
            .map(|piece| {
                let offset = compute_file_offset(load.p_offset, load.p_vaddr, piece.start)?;
                let p_filesz = piece.end.min(file_backed_end).saturating_sub(piece.start);
                let mut header = Elf64_Phdr {
                    p_offset: self.compute_moved_offset(offset, p_filesz)?,
                    p_vaddr: piece.start,
                    p_paddr: load.p_paddr.wrapping_add(piece.start - load.p_vaddr),
                    p_filesz,
                    p_memsz: piece.len(),
                    ..*load
                };
                if !is_congruent(&header, header.p_align) {
                    header.p_align = self.alignment;
                }
                Ok(header)
            })
            .collect()
    }

    fn plan_section_table(
        &self,
        elf: &[u8],
        ehdr: &Elf64_Ehdr,
    ) -> Result<SectionTable, ImageError> {
        if !has_section_headers(ehdr) {
            return Err(ImageError::SectionCannotBeSplit);
        }
        let sections = read_section_headers(elf, ehdr)?;
        let size = sections.len() * SECTION_HEADER_SIZE;
        let start = self.compute_moved_offset(ehdr.e_shoff, size as u64)? as usize;
        Ok(SectionTable {
            headers: self.update_section_headers(&sections)?,
            previous_extent: start..start + size,
        })
    }

    fn update_section_headers(
        &self,
        sections: &[Elf64_Shdr],
    ) -> Result<Vec<Elf64_Shdr>, ImageError> {
        let mut updated = Vec::with_capacity(sections.len() + self.cuts.len());
        let mut later_pieces = Vec::new();
        for section in sections {
            let has_file_bytes = section.sh_type != SHT_NOBITS && section.sh_size > 0;
            if section.sh_type == SHT_NULL {
                updated.push(*section);
            } else if has_file_bytes && section.sh_flags & SHF_ALLOC != 0 {
                let mut pieces = self.split_allocated_section(section)?.into_iter();
                updated.push(pieces.next().unwrap_or_else(create_null_section_header));
                later_pieces.extend(pieces);
            } else {
                let file_size = if has_file_bytes { section.sh_size } else { 0 };
                let sh_offset = self.compute_moved_offset(section.sh_offset, file_size)?;
                updated.push(Elf64_Shdr {
                    sh_offset,
                    ..*section
                });
            }
        }
        updated.append(&mut later_pieces);
        if updated.len() >= SHN_LORESERVE {
            return Err(ImageError::HeaderRoomExhausted);
        }
        Ok(updated)
    }

    fn split_allocated_section(&self, section: &Elf64_Shdr) -> Result<Vec<Elf64_Shdr>, ImageError> {
        let addresses = AddressRange::from_size(section.sh_addr, section.sh_size)?;
        let pieces = subtract_cuts(addresses, self.cuts);
        if pieces != [addresses] && section.sh_type != SHT_PROGBITS {
            return Err(ImageError::SectionCannotBeSplit);
        }
        pieces
            .into_iter()
            .map(|piece| {
                let offset = compute_file_offset(section.sh_offset, section.sh_addr, piece.start)?;
                Ok(Elf64_Shdr {
                    sh_addr: piece.start,
                    sh_offset: self.compute_moved_offset(offset, piece.len())?,
                    sh_size: piece.len(),
                    ..*section
                })
            })
            .collect()
    }
}

#[cfg(test)]
pub(crate) mod tests;
