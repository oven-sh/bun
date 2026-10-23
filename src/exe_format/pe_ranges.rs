use core::mem::size_of;
use core::ops::Range;

use crate::builtins::u32_at;
use crate::cut_model::{CutCapacity, CutModel, NoCutReason};
use crate::image::{
    AddressRange, Architecture, ExecutableFormat, ImageError, MappedSpan, merge_ranges,
    subtract_cuts,
};
use crate::pe::{
    self, DataDirectory, OptionalHeader64, PEFile, PEHeader, PELayout, SectionHeader, align_up_u32,
};
use crate::{Error, read_struct, write_struct};

const MAX_SECTIONS: usize = 96;
const MIN_CUT_ALIGNMENT: u64 = 4096;
const CERTIFICATE_TABLE_ALIGNMENT: u64 = 8;
const REMOVED_SECTION_NAME: [u8; 8] = *b".trimmed";
const IMAGE_SCN_CNT_UNINITIALIZED_DATA: u32 = 0x0000_0080;
const IMAGE_SCN_MEM_WRITE: u32 = 0x8000_0000;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_FILE_MACHINE_ARM64: u16 = 0xaa64;
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;
const DEBUG_DIRECTORY_ENTRY_SIZE: usize = 28;
const DEBUG_ENTRY_SIZE_OF_DATA: usize = 16;
const DEBUG_ENTRY_ADDRESS_OF_RAW_DATA: usize = 20;
const DEBUG_ENTRY_POINTER_TO_RAW_DATA: usize = 24;
const RELOCATION_BLOCK_HEADER_SIZE: usize = 8;

struct Headers {
    layout: PELayout,
    file_header: PEHeader,
    optional: OptionalHeader64,
    sections: Vec<SectionHeader>,
}

struct NewSection {
    header: SectionHeader,
    source: Range<usize>,
}

struct RelocationBlock {
    page_address: u32,
    size: usize,
}

pub(crate) fn architecture(pe: &[u8]) -> Result<Architecture, Error> {
    match read_headers(pe)?.file_header.machine {
        IMAGE_FILE_MACHINE_AMD64 => Ok(Architecture::X86_64),
        IMAGE_FILE_MACHINE_ARM64 => Ok(Architecture::Aarch64),
        _ => Err(ImageError::UnrecognizedExecutable.into()),
    }
}

pub(crate) fn mapped_spans(pe: &[u8]) -> Result<Vec<MappedSpan>, Error> {
    Ok(read_headers(pe)?
        .sections
        .iter()
        .filter(|section| section.size_of_raw_data > 0)
        .map(|section| MappedSpan {
            addresses: mapped_addresses(section),
            file_offset: u64::from(section.pointer_to_raw_data),
        })
        .collect())
}

pub(crate) fn cut_model(pe: &[u8]) -> CutModel {
    let format = ExecutableFormat::Pe;
    let Ok(headers) = read_headers(pe) else {
        return CutModel::without_cuts(format, MIN_CUT_ALIGNMENT, NoCutReason::HeadersUnreadable);
    };
    let section_alignment = u64::from(headers.optional.section_alignment);
    let alignment = section_alignment.max(MIN_CUT_ALIGNMENT);
    let (Ok(()), Some(first)) = (check(pe, &headers), headers.sections.first()) else {
        return CutModel::without_cuts(format, alignment, NoCutReason::HeadersUnreadable);
    };
    let Ok(cuttable_spans) = find_cuttable_spans(pe, &headers) else {
        return CutModel::without_cuts(format, alignment, NoCutReason::HeadersUnreadable);
    };
    let table_offset = headers.layout.section_headers_offset;
    let header_room = (first.virtual_address as usize).saturating_sub(table_offset);
    let slots = header_room / size_of::<SectionHeader>();
    let occupied_slots = headers.sections.len() + 1;
    let free_slots = MAX_SECTIONS.min(slots).saturating_sub(occupied_slots) / 2;
    match CutCapacity::from_free_slots(free_slots) {
        CutCapacity::NoCuts(reason) => CutModel::without_cuts(format, alignment, reason),
        capacity @ CutCapacity::Cuts(_) => CutModel {
            format,
            alignment,
            capacity,
            cuttable_spans,
            spans_cut_only_at_end: Vec::new(),
        },
    }
}

pub(crate) fn remove_ranges(pe: &mut Vec<u8>, cuts: &[AddressRange]) -> Result<(), Error> {
    let layout = PEFile::layout_of(pe)?;
    let mut file = PEFile::from_layout(core::mem::take(pe), layout);
    let result = remove_ranges_in(&mut file, cuts);
    *pe = core::mem::take(&mut file.data);
    result
}

fn remove_ranges_in(file: &mut PEFile, cuts: &[AddressRange]) -> Result<(), Error> {
    file.strip_authenticode()?;
    let mut headers = read_headers(&file.data)?;
    check(&file.data, &headers)?;
    check_cuts(&file.data, &headers, cuts)?;
    let mut new_sections = create_new_sections(&headers, cuts)?;
    remove_relocation_blocks(&mut file.data, &mut headers, cuts)?;
    let mut bytes = write_image(&file.data, &headers, &mut new_sections)?;
    update_debug_directory(&mut bytes, &headers, &new_sections)?;
    file.data = bytes;
    file.num_sections = new_sections.len() as u16;
    file.recompute_pe_checksum()?;
    Ok(())
}

fn read_headers(pe: &[u8]) -> Result<Headers, pe::Error> {
    let layout = PEFile::layout_of(pe)?;
    Ok(Headers {
        layout,
        file_header: read_struct(&pe[layout.pe_header_offset..]),
        optional: read_struct(&pe[layout.optional_header_offset..]),
        sections: pe[layout.section_headers_offset..]
            .as_chunks::<{ size_of::<SectionHeader>() }>()
            .0
            .iter()
            .take(usize::from(layout.num_sections))
            .map(|bytes| read_struct(bytes))
            .collect(),
    })
}

fn write_u32_at(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn to_u32(value: u64) -> Result<u32, pe::Error> {
    u32::try_from(value).map_err(|_| pe::Error::Overflow)
}

fn effective_virtual_size(section: &SectionHeader) -> u32 {
    if section.virtual_size == 0 {
        section.size_of_raw_data
    } else {
        section.virtual_size
    }
}

fn widen_address_range(address: u32, size: u32) -> AddressRange {
    let start = u64::from(address);
    let end = start + u64::from(size);
    AddressRange { start, end }
}

fn directory_addresses(directory: DataDirectory) -> AddressRange {
    widen_address_range(directory.virtual_address, directory.size)
}

fn mapped_addresses(section: &SectionHeader) -> AddressRange {
    let size = section
        .size_of_raw_data
        .min(effective_virtual_size(section));
    widen_address_range(section.virtual_address, size)
}

fn find_directory(headers: &Headers, index: usize) -> Option<DataDirectory> {
    if index >= headers.optional.number_of_rva_and_sizes as usize {
        return None;
    }
    let directory = *headers.optional.data_directories.get(index)?;
    (directory.size > 0).then_some(directory)
}

fn find_file_range(headers: &Headers, addresses: AddressRange) -> Option<Range<usize>> {
    let section = headers
        .sections
        .iter()
        .find(|section| mapped_addresses(section).contains(addresses))?;
    let offset = addresses.start - u64::from(section.virtual_address);
    let start = section.pointer_to_raw_data as usize + offset as usize;
    Some(start..start + addresses.len() as usize)
}

fn check(pe: &[u8], headers: &Headers) -> Result<(), Error> {
    if headers.file_header.pointer_to_symbol_table != 0 {
        return Err(ImageError::MalformedHeaders.into());
    }
    check_section_addresses(headers)?;
    check_header_room(headers)?;
    check_file_layout(pe.len(), headers)?;
    collect_debug_data(pe, headers)?;
    check_relocation_blocks(pe, headers)?;
    Ok(())
}

fn check_section_addresses(headers: &Headers) -> Result<(), Error> {
    let alignment = headers.optional.section_alignment;
    let mut expected_address: Option<u32> = None;
    for section in &headers.sections {
        let address = section.virtual_address;
        if expected_address.is_some_and(|expected| expected != address) {
            return Err(ImageError::MalformedHeaders.into());
        }
        let size = align_up_u32(effective_virtual_size(section).max(1), alignment)?;
        expected_address = Some(address.checked_add(size).ok_or(pe::Error::Overflow)?);
    }
    Ok(())
}

fn check_header_room(headers: &Headers) -> Result<(), ImageError> {
    let Some(first) = headers.sections.first() else {
        return Ok(());
    };
    let room_end = first.virtual_address;
    let file_alignment = headers.optional.file_alignment;
    if !room_end.is_multiple_of(file_alignment) || headers.optional.size_of_headers > room_end {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(())
}

fn check_file_layout(file_size: usize, headers: &Headers) -> Result<(), ImageError> {
    let mut raw_data_end = 0;
    for section in &headers.sections {
        if section.size_of_raw_data == 0 {
            continue;
        }
        let start = u64::from(section.pointer_to_raw_data);
        if start < raw_data_end {
            return Err(ImageError::MalformedHeaders);
        }
        raw_data_end = start + u64::from(section.size_of_raw_data);
    }
    let certificate_table = headers.optional.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
    let certificate_start = u64::from(certificate_table.virtual_address);
    let certificate_end = certificate_start + u64::from(certificate_table.size);
    let expected_size = if certificate_start == 0 || certificate_end == certificate_start {
        raw_data_end
    } else if certificate_start == raw_data_end {
        crate::align_up(certificate_end, CERTIFICATE_TABLE_ALIGNMENT)
    } else {
        return Err(ImageError::MalformedHeaders);
    };
    if file_size as u64 != expected_size {
        return Err(ImageError::MalformedHeaders);
    }
    Ok(())
}

fn collect_debug_data(pe: &[u8], headers: &Headers) -> Result<Vec<AddressRange>, ImageError> {
    let Some(directory) = find_directory(headers, IMAGE_DIRECTORY_ENTRY_DEBUG) else {
        return Ok(Vec::new());
    };
    let extent = find_file_range(headers, directory_addresses(directory))
        .ok_or(ImageError::MalformedHeaders)?;
    let mut ranges = Vec::new();
    for entry in pe[extent].as_chunks::<DEBUG_DIRECTORY_ENTRY_SIZE>().0 {
        let size = u32_at(entry, DEBUG_ENTRY_SIZE_OF_DATA);
        if size == 0 {
            continue;
        }
        let address = u32_at(entry, DEBUG_ENTRY_ADDRESS_OF_RAW_DATA);
        let data = widen_address_range(address, size);
        if address == 0 || find_file_range(headers, data).is_none() {
            return Err(ImageError::MalformedHeaders);
        }
        ranges.push(data);
    }
    Ok(ranges)
}

fn overlaps_cut(range: AddressRange, cuts: &[AddressRange]) -> bool {
    let index = cuts.partition_point(|cut| cut.end <= range.start);
    cuts.get(index).is_some_and(|cut| cut.start < range.end)
}

fn is_address_in_cut(address: u32, cuts: &[AddressRange]) -> bool {
    overlaps_cut(widen_address_range(address, 1), cuts)
}

fn find_required_ranges(pe: &[u8], headers: &Headers) -> Result<Vec<AddressRange>, Error> {
    let mut required = collect_debug_data(pe, headers)?;
    required.push(widen_address_range(
        headers.optional.address_of_entry_point,
        1,
    ));
    for index in 0..headers.optional.data_directories.len() {
        if index == IMAGE_DIRECTORY_ENTRY_SECURITY {
            continue;
        }
        if let Some(directory) = find_directory(headers, index) {
            required.push(directory_addresses(directory));
        }
    }
    Ok(required)
}

fn find_cuttable_spans(pe: &[u8], headers: &Headers) -> Result<Vec<AddressRange>, Error> {
    let required = merge_ranges(find_required_ranges(pe, headers)?);
    Ok(headers
        .sections
        .iter()
        .filter(|section| section.size_of_raw_data > 0)
        .filter(|section| section.characteristics & IMAGE_SCN_MEM_WRITE == 0)
        .flat_map(|section| subtract_cuts(mapped_addresses(section), &required))
        .collect())
}

fn check_cuts(pe: &[u8], headers: &Headers, cuts: &[AddressRange]) -> Result<(), Error> {
    let required = find_required_ranges(pe, headers)?;
    if required.iter().any(|range| overlaps_cut(*range, cuts)) {
        return Err(ImageError::CutHoldsHeaders.into());
    }
    Ok(())
}

fn create_new_sections(headers: &Headers, cuts: &[AddressRange]) -> Result<Vec<NewSection>, Error> {
    let file_alignment = headers.optional.file_alignment;
    let mut new_sections = Vec::with_capacity(headers.sections.len() + 2 * cuts.len());
    for section in &headers.sections {
        let range = widen_address_range(section.virtual_address, effective_virtual_size(section));
        let first_cut = cuts.partition_point(|cut| cut.end <= range.start);
        let cut_count = cuts[first_cut..].partition_point(|cut| cut.start < range.end);
        let section_cuts = &cuts[first_cut..first_cut + cut_count];
        if section_cuts.is_empty() {
            let start = section.pointer_to_raw_data as usize;
            new_sections.push(NewSection {
                header: *section,
                source: start..start + section.size_of_raw_data as usize,
            });
            continue;
        }
        let first_new_section = new_sections.len();
        for piece in subtract_cuts(range, section_cuts) {
            new_sections.push(create_retained_piece(section, piece, file_alignment)?);
        }
        for cut in section_cuts {
            new_sections.push(create_removed_section(*cut)?);
        }
        new_sections[first_new_section..]
            .sort_unstable_by_key(|new_section| new_section.header.virtual_address);
    }
    if new_sections.len() > MAX_SECTIONS - 1 {
        return Err(ImageError::TooManyCuts.into());
    }
    Ok(new_sections)
}

fn create_retained_piece(
    section: &SectionHeader,
    piece: AddressRange,
    file_alignment: u32,
) -> Result<NewSection, Error> {
    let address = to_u32(piece.start)?;
    let size = to_u32(piece.len())?;
    let section_offset = address - section.virtual_address;
    let remaining_raw_size = section.size_of_raw_data.saturating_sub(section_offset);
    let raw_size = remaining_raw_size.min(align_up_u32(size, file_alignment)?);
    let start = section.pointer_to_raw_data as usize + section_offset as usize;
    Ok(NewSection {
        header: SectionHeader {
            virtual_size: size,
            virtual_address: address,
            size_of_raw_data: raw_size,
            ..*section
        },
        source: start..start + raw_size as usize,
    })
}

fn create_removed_section(cut: AddressRange) -> Result<NewSection, Error> {
    Ok(NewSection {
        header: SectionHeader {
            name: REMOVED_SECTION_NAME,
            virtual_size: to_u32(cut.len())?,
            virtual_address: to_u32(cut.start)?,
            characteristics: IMAGE_SCN_CNT_UNINITIALIZED_DATA,
            ..read_struct(&[0; size_of::<SectionHeader>()])
        },
        source: 0..0,
    })
}

fn find_relocation_file_range(headers: &Headers) -> Result<Option<Range<usize>>, pe::Error> {
    let Some(directory) = find_directory(headers, IMAGE_DIRECTORY_ENTRY_BASERELOC) else {
        return Ok(None);
    };
    find_file_range(headers, directory_addresses(directory))
        .map(Some)
        .ok_or(pe::Error::InvalidPEFile)
}

fn read_relocation_block(blocks: &[u8], offset: usize) -> Result<RelocationBlock, pe::Error> {
    let remaining = blocks.len() - offset;
    if remaining < RELOCATION_BLOCK_HEADER_SIZE {
        return Err(pe::Error::InvalidPEFile);
    }
    let page_address = u32_at(blocks, offset);
    let size = u32_at(blocks, offset + 4) as usize;
    let is_valid_size =
        size >= RELOCATION_BLOCK_HEADER_SIZE && size.is_multiple_of(4) && size <= remaining;
    if !is_valid_size {
        return Err(pe::Error::InvalidPEFile);
    }
    Ok(RelocationBlock { page_address, size })
}

fn check_relocation_blocks(pe: &[u8], headers: &Headers) -> Result<(), pe::Error> {
    let Some(extent) = find_relocation_file_range(headers)? else {
        return Ok(());
    };
    let blocks = &pe[extent];
    let mut offset = 0;
    while offset < blocks.len() {
        offset += read_relocation_block(blocks, offset)?.size;
    }
    Ok(())
}

fn remove_relocation_blocks(
    pe: &mut [u8],
    headers: &mut Headers,
    cuts: &[AddressRange],
) -> Result<(), pe::Error> {
    let Some(extent) = find_relocation_file_range(headers)? else {
        return Ok(());
    };
    let retained_size = compact_relocation_blocks(&mut pe[extent], cuts)?;
    headers.optional.data_directories[IMAGE_DIRECTORY_ENTRY_BASERELOC].size = retained_size as u32;
    Ok(())
}

fn compact_relocation_blocks(blocks: &mut [u8], cuts: &[AddressRange]) -> Result<usize, pe::Error> {
    let mut read_offset = 0;
    let mut write_offset = 0;
    while read_offset < blocks.len() {
        let block = read_relocation_block(blocks, read_offset)?;
        if !is_address_in_cut(block.page_address, cuts) {
            blocks.copy_within(read_offset..read_offset + block.size, write_offset);
            write_offset += block.size;
        }
        read_offset += block.size;
    }
    blocks[write_offset..].fill(0);
    Ok(write_offset)
}

fn compute_size_of_headers(headers: &Headers, section_count: usize) -> Result<u32, Error> {
    let table_size = size_of::<SectionHeader>() * (section_count + 1);
    let table_end = to_u32((headers.layout.section_headers_offset + table_size) as u64)?;
    let size_of_headers = align_up_u32(table_end, headers.optional.file_alignment)?
        .max(headers.optional.size_of_headers);
    match headers.sections.first() {
        Some(first) if size_of_headers <= first.virtual_address => Ok(size_of_headers),
        _ => Err(ImageError::HeaderRoomExhausted.into()),
    }
}

fn assign_raw_data_pointers(
    new_sections: &mut [NewSection],
    size_of_headers: u32,
    file_alignment: u32,
) -> Result<u32, pe::Error> {
    let mut file_end = size_of_headers;
    for section in new_sections {
        let raw_size = section.header.size_of_raw_data;
        if raw_size == 0 {
            section.header.pointer_to_raw_data = 0;
            continue;
        }
        let start = align_up_u32(file_end, file_alignment)?;
        section.header.pointer_to_raw_data = start;
        file_end = start.checked_add(raw_size).ok_or(pe::Error::Overflow)?;
    }
    Ok(file_end)
}

fn write_image(
    pe: &[u8],
    headers: &Headers,
    new_sections: &mut [NewSection],
) -> Result<Vec<u8>, Error> {
    let layout = headers.layout;
    let file_alignment = headers.optional.file_alignment;
    let size_of_headers = compute_size_of_headers(headers, new_sections.len())?;
    let file_size = assign_raw_data_pointers(new_sections, size_of_headers, file_alignment)?;

    let mut bytes = vec![0u8; file_size as usize];
    let table_offset = layout.section_headers_offset;
    bytes[..table_offset].copy_from_slice(&pe[..table_offset]);
    for (index, section) in new_sections.iter().enumerate() {
        let entry_offset = table_offset + index * size_of::<SectionHeader>();
        write_struct(&mut bytes[entry_offset..], &section.header);
        if section.header.size_of_raw_data > 0 {
            let start = section.header.pointer_to_raw_data as usize;
            bytes[start..start + section.source.len()].copy_from_slice(&pe[section.source.clone()]);
        }
    }

    let file_header = PEHeader {
        number_of_sections: new_sections.len() as u16,
        ..headers.file_header
    };
    write_struct(&mut bytes[layout.pe_header_offset..], &file_header);
    let optional = OptionalHeader64 {
        size_of_headers,
        ..headers.optional
    };
    write_struct(&mut bytes[layout.optional_header_offset..], &optional);
    Ok(bytes)
}

fn file_offset_of(sections: &[NewSection], rva: u32) -> Option<u32> {
    let address = widen_address_range(rva, 1);
    let header = sections
        .iter()
        .map(|section| &section.header)
        .find(|header| mapped_addresses(header).contains(address))?;
    Some(header.pointer_to_raw_data + (rva - header.virtual_address))
}

fn update_debug_directory(
    bytes: &mut [u8],
    headers: &Headers,
    sections: &[NewSection],
) -> Result<(), ImageError> {
    let Some(directory) = find_directory(headers, IMAGE_DIRECTORY_ENTRY_DEBUG) else {
        return Ok(());
    };
    let start = file_offset_of(sections, directory.virtual_address)
        .ok_or(ImageError::MalformedHeaders)? as usize;
    let extent = start..start + directory.size as usize;
    for entry in bytes[extent]
        .as_chunks_mut::<DEBUG_DIRECTORY_ENTRY_SIZE>()
        .0
    {
        if u32_at(entry, DEBUG_ENTRY_SIZE_OF_DATA) == 0 {
            continue;
        }
        let address = u32_at(entry, DEBUG_ENTRY_ADDRESS_OF_RAW_DATA);
        let offset = file_offset_of(sections, address).ok_or(ImageError::MalformedHeaders)?;
        write_u32_at(entry, DEBUG_ENTRY_POINTER_TO_RAW_DATA, offset);
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests;
