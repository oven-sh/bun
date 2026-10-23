use core::mem::size_of;

use super::{Checked, MALFORMED, Payload, PayloadReferenceError, struct_in, table_bytes};
use crate::builtins::Image;
use crate::pe::{DOSHeader, DataDirectory, OptionalHeader64, PEHeader, SectionHeader};
use crate::read_struct;

pub(super) const OPTIONAL_HEADER_MAGIC_64: u16 = 0x020b;
pub(super) const EXPORT_DIRECTORY: usize = 0;
pub(super) const BASE_RELOCATION_DIRECTORY: usize = 5;
pub(super) const IMPORT_ADDRESS_TABLE_DIRECTORY: usize = 12;

pub(super) const RELOCATION_BLOCK_HEADER_SIZE: usize = 8;
const RELOCATION_OFFSET_MASK: u16 = 0x0fff;
const RELOCATION_TYPE_SHIFT: u16 = 12;
const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;
const IMAGE_REL_BASED_HIGH: u16 = 1;
const IMAGE_REL_BASED_LOW: u16 = 2;
pub(super) const IMAGE_REL_BASED_HIGHLOW: u16 = 3;
pub(super) const IMAGE_REL_BASED_DIR64: u16 = 10;

#[repr(C)]
#[derive(Copy, Clone)]
pub(super) struct ExportDirectory {
    pub(super) characteristics: u32,
    pub(super) time_date_stamp: u32,
    pub(super) major_version: u16,
    pub(super) minor_version: u16,
    pub(super) name: u32,
    pub(super) base: u32,
    pub(super) number_of_functions: u32,
    pub(super) number_of_names: u32,
    pub(super) address_of_functions: u32,
    pub(super) address_of_names: u32,
    pub(super) address_of_name_ordinals: u32,
}

struct Headers {
    optional: OptionalHeader64,
    sections: Vec<SectionHeader>,
}

impl Headers {
    fn read(file: &mut Image<'_>) -> Result<Headers, PayloadReferenceError> {
        let dos: DOSHeader = file.struct_at(0)?;
        let header_at = dos.e_lfanew as usize;
        let header: PEHeader = file.struct_at(header_at)?;
        let optional_at = header_at + size_of::<PEHeader>();
        let optional: OptionalHeader64 = file.struct_at(optional_at)?;
        if optional.magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(MALFORMED);
        }
        let sections_at = optional_at + usize::from(header.size_of_optional_header);
        let sections_size = usize::from(header.number_of_sections) * size_of::<SectionHeader>();
        let sections = file.bytes(sections_at, sections_size)?;
        let sections = sections
            .as_chunks::<{ size_of::<SectionHeader>() }>()
            .0
            .iter();
        Ok(Headers {
            optional,
            sections: sections.map(|bytes| read_struct(bytes)).collect(),
        })
    }

    fn directory(&self, index: usize) -> Option<DataDirectory> {
        if index >= self.optional.number_of_rva_and_sizes as usize {
            return None;
        }
        let directory = *self.optional.data_directories.get(index)?;
        (directory.size != 0).then_some(directory)
    }

    fn bytes_at(
        &self,
        file: &mut Image<'_>,
        address: u32,
        size: u64,
    ) -> Result<Vec<u8>, PayloadReferenceError> {
        let end = u64::from(address) + size;
        let section = self.sections.iter().find(|section| {
            let start = section.virtual_address;
            start <= address && end <= u64::from(start) + u64::from(section.size_of_raw_data)
        });
        let section = section.ok_or(MALFORMED)?;
        let offset_in_section = address - section.virtual_address;
        let offset = u64::from(section.pointer_to_raw_data) + u64::from(offset_in_section);
        table_bytes(file, offset, size)
    }
}

pub(super) fn check(file: &mut Image<'_>, payload: Payload) -> Checked {
    let headers = Headers::read(file)?;
    if let Some(directory) = headers.directory(BASE_RELOCATION_DIRECTORY) {
        let size = u64::from(directory.size);
        let blocks = headers.bytes_at(file, directory.virtual_address, size)?;
        check_base_relocations(&blocks, payload)?;
    }
    if let Some(table) = headers.directory(IMPORT_ADDRESS_TABLE_DIRECTORY) {
        payload.check_relocation(u64::from(table.virtual_address), u64::from(table.size))?;
    }
    if let Some(directory) = headers.directory(EXPORT_DIRECTORY) {
        check_exports(file, &headers, directory, payload)?;
    }
    Ok(())
}

fn check_base_relocations(blocks: &[u8], payload: Payload) -> Checked {
    let mut rest = blocks;
    while !rest.is_empty() {
        let page_address: u32 = struct_in(rest, 0)?;
        let block_size: u32 = struct_in(rest, size_of::<u32>())?;
        let block = rest.get(..block_size as usize).ok_or(MALFORMED)?;
        let entries = block.get(RELOCATION_BLOCK_HEADER_SIZE..).ok_or(MALFORMED)?;
        for entry in entries.as_chunks::<{ size_of::<u16>() }>().0 {
            let entry: u16 = read_struct(entry);
            let size = match entry >> RELOCATION_TYPE_SHIFT {
                IMAGE_REL_BASED_ABSOLUTE => continue,
                IMAGE_REL_BASED_HIGH | IMAGE_REL_BASED_LOW => 2,
                IMAGE_REL_BASED_HIGHLOW => 4,
                IMAGE_REL_BASED_DIR64 => 8,
                _ => return Err(PayloadReferenceError::UnsupportedRelocations),
            };
            let address = u64::from(page_address) + u64::from(entry & RELOCATION_OFFSET_MASK);
            payload.check_relocation(address, size)?;
        }
        rest = &rest[block.len()..];
    }
    Ok(())
}

/// An address inside the export directory is the name of a symbol in another library.
fn check_exports(
    file: &mut Image<'_>,
    headers: &Headers,
    directory: DataDirectory,
    payload: Payload,
) -> Checked {
    let header_size = size_of::<ExportDirectory>() as u64;
    let header = headers.bytes_at(file, directory.virtual_address, header_size)?;
    let header: ExportDirectory = read_struct(&header);
    let table_size = u64::from(header.number_of_functions) * size_of::<u32>() as u64;
    if table_size == 0 {
        return Ok(());
    }
    let functions = headers.bytes_at(file, header.address_of_functions, table_size)?;
    let directory_start = directory.virtual_address;
    let directory_end = u64::from(directory_start) + u64::from(directory.size);
    for function in functions.as_chunks::<{ size_of::<u32>() }>().0 {
        let address: u32 = read_struct(function);
        let is_forwarder = directory_start <= address && u64::from(address) < directory_end;
        if address != 0 && !is_forwarder {
            payload.check_dynamic_symbol(u64::from(address), 1)?;
        }
    }
    Ok(())
}
