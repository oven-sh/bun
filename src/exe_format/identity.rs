use core::mem::size_of;
use core::ops::Range;

use crate::builtins;
use crate::elf::{EI_CLASS, EI_DATA, ELFCLASS64, ELFDATA2LSB, Elf64_Ehdr, Elf64_Phdr};
use crate::elf_program_headers::{PT_NOTE, find_note_descriptor, note_alignment};
use crate::image::{ExecutableFormat, KnownSection};
use crate::macho_types::{LC, LoadCommandIterator, mach_header_64};
use crate::pe::{DOSHeader, OptionalHeader64, PE_SIGNATURE, PEHeader, SectionHeader};
use crate::read_struct;
use crate::section::{SectionError, find_known_section};

const NT_GNU_BUILD_ID: u32 = 3;
const GNU_NOTE_NAME: &[u8] = b"GNU\0";
const PE32_PLUS_MAGIC: u16 = 0x020b;
const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;
const IMAGE_DEBUG_TYPE_CODEVIEW: u32 = 2;
const CODE_VIEW_RSDS: [u8; 4] = *b"RSDS";
const MAX_HEADER_BYTES: usize = 1 << 20;

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum IdentityError {
    #[error("NoBuildId")]
    NoBuildId,
    #[error("UnrecognizedExecutable")]
    UnrecognizedExecutable,
    #[error("Malformed")]
    Malformed,
}

impl From<SectionError> for IdentityError {
    fn from(_: SectionError) -> IdentityError {
        IdentityError::Malformed
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum PeAddressing {
    File,
    #[cfg_attr(not(any(windows, test)), expect(dead_code))]
    Mapped,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct UuidCommand {
    cmd: u32,
    cmdsize: u32,
    uuid: [u8; 16],
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
struct DebugDirectoryEntry {
    characteristics: u32,
    time_date_stamp: u32,
    major_version: u16,
    minor_version: u16,
    kind: u32,
    size_of_data: u32,
    address_of_raw_data: u32,
    pointer_to_raw_data: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct CodeViewRecord {
    signature: [u8; 4],
    guid: [u8; 16],
    age: u32,
}

pub fn find_file_identity(file: &mut builtins::Image<'_>) -> Result<[u8; 16], IdentityError> {
    let magic = file
        .bytes(0, ExecutableFormat::MAGIC_SIZE)
        .map_err(|_| IdentityError::UnrecognizedExecutable)?;
    let id = match ExecutableFormat::from_magic(&magic) {
        Some(ExecutableFormat::Elf) => find_elf_file_identity(file),
        Some(ExecutableFormat::MachO) => find_macho_file_identity(file),
        Some(ExecutableFormat::Pe) => find_code_view_guid(file, PeAddressing::File),
        None => Err(IdentityError::UnrecognizedExecutable),
    };
    id.and_then(check_identity)
}

const MAX_DESCRIPTION_BYTES: u64 = 1 << 20;
const DESCRIPTION_RECORD_HEAD: usize = 12;

pub struct RuntimeDescription {
    section: Vec<u8>,
}

impl RuntimeDescription {
    pub const ENGINE: [u8; 8] = *b"BUNAOTRT";
    pub const HOST: [u8; 8] = *b"BUNAOTHO";
    pub const BUILTIN_TABLE: [u8; 8] = *b"BUNAOTTB";

    pub fn read(file: &mut builtins::Image<'_>) -> Result<RuntimeDescription, SectionError> {
        let location = find_known_section(file, KnownSection::RuntimeDescription)?;
        if location.size > MAX_DESCRIPTION_BYTES {
            return Err(SectionError::Invalid);
        }
        let offset = usize::try_from(location.file_offset).map_err(|_| SectionError::Invalid)?;
        let section = file.bytes(offset, location.size as usize)?;
        Ok(RuntimeDescription { section })
    }

    pub fn record(&self, kind: [u8; 8]) -> Option<&[u8]> {
        let mut rest = &self.section[..];
        while rest.len() >= DESCRIPTION_RECORD_HEAD {
            // AddressSanitizer leaves a red zone behind each record, zeros in the file.
            if rest[..8] == [0; 8] {
                rest = &rest[8..];
                continue;
            }
            let size = crate::builtins::u32_at(rest, 8) as usize;
            if size < DESCRIPTION_RECORD_HEAD || size > rest.len() {
                return None;
            }
            if rest[..8] == kind {
                return Some(&rest[..size]);
            }
            rest = rest.get(size.next_multiple_of(8)..)?;
        }
        None
    }
}

#[repr(C)]
pub struct HostDescription {
    pub kind: [u8; 8],
    pub size: u32,
    pub reserved: u32,
    pub revision: [u8; 40],
}

impl HostDescription {
    pub const fn new(revision: &str) -> HostDescription {
        let digits = revision.as_bytes();
        let mut padded = [0u8; 40];
        let mut index = 0;
        while index < digits.len() && index < padded.len() {
            padded[index] = digits[index];
            index += 1;
        }
        HostDescription {
            kind: RuntimeDescription::HOST,
            size: size_of::<HostDescription>() as u32,
            reserved: 0,
            revision: padded,
        }
    }

    pub fn revision_in(record: &[u8]) -> Option<&[u8]> {
        let revision = record.get(core::mem::offset_of!(HostDescription, revision)..)?;
        let revision = revision.get(..40)?;
        let length = bun_core::strings::index_of_char_usize(revision, 0).unwrap_or(40);
        Some(&revision[..length])
    }
}

pub fn read_stamp_of_builtin_modules(file: &mut builtins::Image<'_>) -> Result<u32, SectionError> {
    let location = find_known_section(file, KnownSection::BuiltinModules)?;
    let offset = usize::try_from(location.file_offset).map_err(|_| SectionError::Invalid)?;
    let header = file.bytes(offset, builtins::HEADER_SIZE)?;
    Ok(builtins::u32_at(&header, 12))
}

pub fn find_process_identity() -> Result<[u8; 16], IdentityError> {
    process::find_identity().and_then(check_identity)
}

// Sixteen zeros are the identity of the jsc shell and testaot, whose images Bun must not accept.
fn check_identity(id: [u8; 16]) -> Result<[u8; 16], IdentityError> {
    if id == [0; 16] {
        Err(IdentityError::NoBuildId)
    } else {
        Ok(id)
    }
}

fn to_usize(value: u64) -> Result<usize, IdentityError> {
    usize::try_from(value).map_err(|_| IdentityError::Malformed)
}

fn read_headers(
    file: &mut builtins::Image<'_>,
    offset: usize,
    size: usize,
) -> Result<Vec<u8>, IdentityError> {
    if size > MAX_HEADER_BYTES {
        return Err(IdentityError::Malformed);
    }
    file.bytes(offset, size).map_err(IdentityError::from)
}

fn find_elf_file_identity(file: &mut builtins::Image<'_>) -> Result<[u8; 16], IdentityError> {
    find_in_elf_notes(file, |notes, alignment, _| find_build_id(notes, alignment))
}

/// Where an ELF file has the bytes of its GNU build ID that the identity leaves out.
pub fn find_rest_of_gnu_build_id(file: &mut builtins::Image<'_>) -> Option<Range<usize>> {
    let magic = file.bytes(0, ExecutableFormat::MAGIC_SIZE).ok()?;
    if ExecutableFormat::from_magic(&magic) != Some(ExecutableFormat::Elf) {
        return None;
    }
    let find_rest = |notes: &[u8], alignment: usize, offset: usize| {
        let id = find_note_descriptor(notes, alignment, GNU_NOTE_NAME, NT_GNU_BUILD_ID)?;
        let rest = id.start + size_of::<[u8; 16]>()..id.end;
        (!rest.is_empty()).then(|| offset + rest.start..offset + rest.end)
    };
    find_in_elf_notes(file, find_rest).ok()
}

fn find_in_elf_notes<T>(
    file: &mut builtins::Image<'_>,
    find: impl Fn(&[u8], usize, usize) -> Option<T>,
) -> Result<T, IdentityError> {
    let header: Elf64_Ehdr = file.struct_at(0)?;
    if header.e_ident[EI_CLASS] != ELFCLASS64 || header.e_ident[EI_DATA] != ELFDATA2LSB {
        return Err(IdentityError::UnrecognizedExecutable);
    }
    let segment_count = usize::from(header.e_phnum);
    if segment_count > 0 && usize::from(header.e_phentsize) != size_of::<Elf64_Phdr>() {
        return Err(IdentityError::Malformed);
    }
    let table = read_headers(
        file,
        to_usize(header.e_phoff)?,
        segment_count * size_of::<Elf64_Phdr>(),
    )?;
    for segment in table
        .as_chunks::<{ size_of::<Elf64_Phdr>() }>()
        .0
        .iter()
        .map(|bytes| read_struct::<Elf64_Phdr>(bytes))
    {
        if segment.p_type != PT_NOTE {
            continue;
        }
        let offset = to_usize(segment.p_offset)?;
        let notes = read_headers(file, offset, to_usize(segment.p_filesz)?)?;
        if let Some(found) = find(&notes, note_alignment(segment.p_align), offset) {
            return Ok(found);
        }
    }
    Err(IdentityError::NoBuildId)
}

fn find_build_id(notes: &[u8], alignment: usize) -> Option<[u8; 16]> {
    let descriptor = find_note_descriptor(notes, alignment, GNU_NOTE_NAME, NT_GNU_BUILD_ID)?;
    notes[descriptor].first_chunk().copied()
}

fn find_macho_file_identity(file: &mut builtins::Image<'_>) -> Result<[u8; 16], IdentityError> {
    let header: mach_header_64 = file.struct_at(0)?;
    let commands = read_headers(
        file,
        size_of::<mach_header_64>(),
        header.sizeofcmds as usize,
    )?;
    find_uuid(header.ncmds, &commands)
}

fn find_uuid(command_count: u32, commands: &[u8]) -> Result<[u8; 16], IdentityError> {
    let mut iterator = LoadCommandIterator::new(command_count, commands);
    let mut visited_count = 0u32;
    while let Some(command) = iterator.next() {
        visited_count += 1;
        if command.cmd() != LC::UUID {
            continue;
        }
        if let Some(command) = command.cast::<UuidCommand>() {
            return Ok(command.uuid);
        }
    }
    if visited_count < command_count {
        Err(IdentityError::Malformed)
    } else {
        Err(IdentityError::NoBuildId)
    }
}

fn find_code_view_guid(
    pe: &mut builtins::Image<'_>,
    addressing: PeAddressing,
) -> Result<[u8; 16], IdentityError> {
    let dos_header: DOSHeader = pe.struct_at(0)?;
    let pe_header_offset = dos_header.e_lfanew as usize;
    let pe_header: PEHeader = pe.struct_at(pe_header_offset)?;
    let optional_header_size = usize::from(pe_header.size_of_optional_header);
    if pe_header.signature != PE_SIGNATURE || optional_header_size < size_of::<OptionalHeader64>() {
        return Err(IdentityError::UnrecognizedExecutable);
    }
    let optional_header_offset = pe_header_offset + size_of::<PEHeader>();
    let optional_header: OptionalHeader64 = pe.struct_at(optional_header_offset)?;
    if optional_header.magic != PE32_PLUS_MAGIC {
        return Err(IdentityError::UnrecognizedExecutable);
    }
    let directory = optional_header.data_directories[IMAGE_DIRECTORY_ENTRY_DEBUG];
    if optional_header.number_of_rva_and_sizes as usize <= IMAGE_DIRECTORY_ENTRY_DEBUG
        || directory.size == 0
    {
        return Err(IdentityError::NoBuildId);
    }
    let directory_offset = match addressing {
        PeAddressing::Mapped => directory.virtual_address as usize,
        PeAddressing::File => {
            let sections = read_headers(
                pe,
                optional_header_offset + optional_header_size,
                usize::from(pe_header.number_of_sections) * size_of::<SectionHeader>(),
            )?;
            find_file_offset(&sections, directory.virtual_address)?
        }
    };
    let entries = read_headers(pe, directory_offset, directory.size as usize)?;
    for entry in entries
        .as_chunks::<{ size_of::<DebugDirectoryEntry>() }>()
        .0
        .iter()
        .map(|bytes| read_struct::<DebugDirectoryEntry>(bytes))
    {
        if entry.kind != IMAGE_DEBUG_TYPE_CODEVIEW
            || (entry.size_of_data as usize) < size_of::<CodeViewRecord>()
        {
            continue;
        }
        let record_offset = match addressing {
            PeAddressing::Mapped => entry.address_of_raw_data,
            PeAddressing::File => entry.pointer_to_raw_data,
        };
        let record: CodeViewRecord = pe.struct_at(record_offset as usize)?;
        if record.signature == CODE_VIEW_RSDS {
            return Ok(record.guid);
        }
    }
    Err(IdentityError::NoBuildId)
}

fn find_file_offset(sections: &[u8], rva: u32) -> Result<usize, IdentityError> {
    sections
        .as_chunks::<{ size_of::<SectionHeader>() }>()
        .0
        .iter()
        .map(|bytes| read_struct::<SectionHeader>(bytes))
        .find_map(|section| {
            let offset_in_section = rva.checked_sub(section.virtual_address)?;
            let size = section.virtual_size.max(section.size_of_raw_data);
            (offset_in_section < size)
                .then(|| section.pointer_to_raw_data as usize + offset_in_section as usize)
        })
        .ok_or(IdentityError::Malformed)
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
mod process {
    use core::slice;

    use bun_sys::elf::find_loaded_module;

    use super::{IdentityError, PT_NOTE, find_build_id, note_alignment};

    pub(super) fn find_identity() -> Result<[u8; 16], IdentityError> {
        let address = super::find_process_identity as *const () as usize;
        let module = find_loaded_module(address).ok_or(IdentityError::Malformed)?;
        // SAFETY: this function's own object is never unloaded, so the loader keeps its
        // `program_header_count` program headers mapped.
        let headers =
            unsafe { slice::from_raw_parts(module.program_headers, module.program_header_count) };
        headers
            .iter()
            .filter(|segment| segment.p_type == PT_NOTE)
            .find_map(|segment| {
                let start = module.base_address.wrapping_add(segment.p_vaddr as usize);
                // SAFETY: the loader mapped the segment it describes.
                let notes =
                    unsafe { slice::from_raw_parts(start as *const u8, segment.p_memsz as usize) };
                find_build_id(notes, note_alignment(segment.p_align))
            })
            .ok_or(IdentityError::NoBuildId)
    }
}

#[cfg(target_os = "macos")]
mod process {
    use core::slice;

    use super::{IdentityError, find_uuid};
    use crate::macho_types::MH_MAGIC_64;

    unsafe extern "C" {
        /// The linker's name for the header of the executable it links. dyld's image 0 is not
        /// always that one: it puts the libraries of `DYLD_INSERT_LIBRARIES` in front.
        #[link_name = "_mh_execute_header"]
        static MAIN_EXECUTABLE_HEADER: bun_sys::macho::mach_header_64;
    }

    pub(super) fn find_identity() -> Result<[u8; 16], IdentityError> {
        let header_address = &raw const MAIN_EXECUTABLE_HEADER;
        // SAFETY: the header of the main executable is mapped for the life of the process.
        let header = unsafe { header_address.read() };
        if header.magic != MH_MAGIC_64 {
            return Err(IdentityError::UnrecognizedExecutable);
        }
        // SAFETY: `sizeofcmds` bytes of load commands follow the header in the same mapped segment.
        let commands = unsafe {
            slice::from_raw_parts(
                header_address.add(1).cast::<u8>(),
                header.sizeofcmds as usize,
            )
        };
        find_uuid(header.ncmds, commands)
    }
}

#[cfg(windows)]
mod process {
    use core::mem::size_of;
    use core::{ptr, slice};

    use super::{
        DOSHeader, IdentityError, OptionalHeader64, PEHeader, PeAddressing, builtins,
        find_code_view_guid,
    };

    pub(super) fn find_identity() -> Result<[u8; 16], IdentityError> {
        // SAFETY: a null name asks for the executable of the process, and nothing is dereferenced.
        let base = unsafe { bun_sys::windows::kernel32::GetModuleHandleW(ptr::null()) }
            .cast_const()
            .cast::<u8>();
        if base.is_null() {
            return Err(IdentityError::Malformed);
        }
        // SAFETY: a module handle is the address of the mapped image, and the loader has checked
        // that the headers lie inside it.
        let size_of_image = unsafe {
            let dos_header = base.cast::<DOSHeader>().read_unaligned();
            let optional_header_offset = dos_header.e_lfanew as usize + size_of::<PEHeader>();
            let optional_header = base
                .add(optional_header_offset)
                .cast::<OptionalHeader64>()
                .read_unaligned();
            optional_header.size_of_image as usize
        };
        let mut read = |offset: usize, out: &mut [u8]| {
            let is_mapped = offset
                .checked_add(out.len())
                .is_some_and(|end| end <= size_of_image);
            if is_mapped {
                // SAFETY: the loader mapped `size_of_image` bytes at `base`. The parser reads the
                // headers and `.rdata`, which are readable.
                out.copy_from_slice(unsafe { slice::from_raw_parts(base.add(offset), out.len()) });
            }
            is_mapped
        };
        let mut image = builtins::Image {
            len: size_of_image,
            read: &mut read,
        };
        find_code_view_guid(&mut image, PeAddressing::Mapped)
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "freebsd",
    target_os = "macos",
    windows
)))]
mod process {
    use super::IdentityError;

    pub(super) fn find_identity() -> Result<[u8; 16], IdentityError> {
        Err(IdentityError::UnrecognizedExecutable)
    }
}

#[cfg(test)]
mod tests {
    use bun_sys::elf::PT_LOAD;

    use super::IdentityError::{Malformed, NoBuildId, UnrecognizedExecutable};
    use super::*;
    use crate::elf_program_headers::NoteHeader;
    use crate::macho_types::MH_MAGIC_64;
    use crate::pe::DataDirectory;
    use crate::write_struct;

    type Identity = Result<[u8; 16], IdentityError>;
    type Note<'a> = (&'a [u8], u32, &'a [u8]);
    type Patch<T> = (fn(&mut T), IdentityError);

    const BUILD_ID: &[u8] = b"0123456789abcdefghij";
    const IDENTITY: [u8; 16] = *b"0123456789abcdef";

    const NT_GNU_ABI_TAG: u32 = 1;
    const BUILD_ID_NOTE: Note<'static> = (GNU_NOTE_NAME, NT_GNU_BUILD_ID, BUILD_ID);
    const ABI_TAG_NOTE: Note<'static> = (GNU_NOTE_NAME, NT_GNU_ABI_TAG, &[0; 16]);
    const UNALIGNED_NOTE: Note<'static> = (b"Linux\0", 0x100, &[1, 2, 3]);
    const NOTE_SEGMENT_OFFSET: usize = size_of::<Elf64_Ehdr>() + size_of::<Elf64_Phdr>();

    const DEBUG: usize = IMAGE_DIRECTORY_ENTRY_DEBUG;
    const IMAGE_DEBUG_TYPE_POGO: u32 = 13;
    const PE_HEADER_OFFSET: usize = 0x80;
    const OPTIONAL_HEADER_OFFSET: usize = PE_HEADER_OFFSET + size_of::<PEHeader>();
    const SECTION_TABLE_OFFSET: usize = OPTIONAL_HEADER_OFFSET + size_of::<OptionalHeader64>();
    const SIZE_OF_HEADERS: usize = 0x400;
    const SIZE_OF_IMAGE: usize = 0x3000;
    const SECTION_SIZE: usize = 0x400;
    const RDATA_ADDRESS: usize = 0x2000;
    const RDATA_FILE_OFFSET: usize = 0x800;
    const SECTIONS: [(usize, usize); 2] = [(0x1000, 0x400), (RDATA_ADDRESS, RDATA_FILE_OFFSET)];
    const DEBUG_DIRECTORY_OFFSET: usize = 0x40;
    const DEBUG_DIRECTORY_FILE_OFFSET: usize = RDATA_FILE_OFFSET + DEBUG_DIRECTORY_OFFSET;
    const DEBUG_DATA_OFFSET: usize = 0x100;
    const DEBUG_DATA_STRIDE: usize = 0x40;

    fn zeroed<T: Copy>() -> T {
        read_struct(&vec![0; size_of::<T>()])
    }

    fn description_record(kind: [u8; 8], body: &[u8]) -> Vec<u8> {
        let mut record = kind.to_vec();
        record.extend_from_slice(&((DESCRIPTION_RECORD_HEAD + body.len()) as u32).to_le_bytes());
        record.extend_from_slice(body);
        record
    }

    #[test]
    fn description_records_are_found_in_either_order_behind_padding() {
        let engine = description_record(RuntimeDescription::ENGINE, &[1, 2, 3]);
        let host = description_record(RuntimeDescription::HOST, &[4; 9]);
        for (first, second) in [(&engine, &host), (&host, &engine)] {
            let mut section = first.clone();
            section.resize(section.len().next_multiple_of(8), 0);
            section.extend_from_slice(second);
            let description = RuntimeDescription { section };
            assert_eq!(
                description.record(RuntimeDescription::ENGINE),
                Some(&engine[..])
            );
            assert_eq!(
                description.record(RuntimeDescription::HOST),
                Some(&host[..])
            );
            assert_eq!(description.record(*b"BUNAOT??"), None);
        }
    }

    #[test]
    fn description_record_that_leaves_the_section_is_not_found() {
        let mut section = description_record(RuntimeDescription::ENGINE, &[0; 4]);
        section[8] += 1;
        let description = RuntimeDescription { section };
        assert_eq!(description.record(RuntimeDescription::ENGINE), None);
        let too_small = RuntimeDescription {
            section: [&RuntimeDescription::ENGINE[..], &4u32.to_le_bytes()].concat(),
        };
        assert_eq!(too_small.record(RuntimeDescription::ENGINE), None);
    }

    #[test]
    fn host_description_holds_the_revision() {
        let host = HostDescription::new("0123abcd");
        assert_eq!(host.size as usize, size_of::<HostDescription>());
        // SAFETY: a `repr(C)` struct of bytes and two `u32` without padding.
        let bytes = unsafe {
            core::slice::from_raw_parts(
                (&raw const host).cast::<u8>(),
                size_of::<HostDescription>(),
            )
        };
        assert_eq!(HostDescription::revision_in(bytes), Some(&b"0123abcd"[..]));
        assert_eq!(HostDescription::revision_in(&bytes[..20]), None);
    }

    fn with_image<T>(
        bytes: &[u8],
        read_limit: usize,
        run: impl FnOnce(&mut builtins::Image<'_>) -> T,
    ) -> T {
        let mut read_count = 0usize;
        let mut read = |offset: usize, out: &mut [u8]| {
            read_count += 1;
            match bytes.get(offset..offset + out.len()) {
                Some(range) if read_count <= read_limit => {
                    out.copy_from_slice(range);
                    true
                }
                _ => false,
            }
        };
        run(&mut builtins::Image {
            len: bytes.len(),
            read: &mut read,
        })
    }

    fn find_identity(bytes: &[u8]) -> Identity {
        with_image(bytes, usize::MAX, find_file_identity)
    }

    fn check_patches<T: Copy>(file: &[u8], offset: usize, patches: &[Patch<T>]) {
        for (index, &(change, error)) in patches.iter().enumerate() {
            let mut file = file.to_vec();
            let mut value: T = read_struct(&file[offset..]);
            change(&mut value);
            write_struct(&mut file[offset..], &value);
            assert_eq!(find_identity(&file), Err(error), "patch {index}");
        }
    }

    fn encode_notes(notes: &[Note<'_>], alignment: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        for &(name, kind, descriptor) in notes {
            let at = bytes.len();
            bytes.resize(at + size_of::<NoteHeader>(), 0);
            let header = NoteHeader {
                name_size: name.len() as u32,
                descriptor_size: descriptor.len() as u32,
                note_type: kind,
            };
            write_struct(&mut bytes[at..], &header);
            bytes.extend_from_slice(name);
            bytes.resize(bytes.len().next_multiple_of(alignment), 0);
            bytes.extend_from_slice(descriptor);
            bytes.resize(bytes.len().next_multiple_of(alignment), 0);
        }
        bytes
    }

    fn elf_with_note_segments(segments: &[&[Note<'_>]], alignment: usize) -> Vec<u8> {
        let segment_count = segments.len() + 1;
        let mut bytes = vec![0; size_of::<Elf64_Ehdr>() + segment_count * size_of::<Elf64_Phdr>()];

        let mut header: Elf64_Ehdr = zeroed();
        header.e_ident[..4].copy_from_slice(b"\x7fELF");
        header.e_ident[EI_CLASS] = ELFCLASS64;
        header.e_ident[EI_DATA] = ELFDATA2LSB;
        header.e_phoff = size_of::<Elf64_Ehdr>() as u64;
        header.e_phentsize = size_of::<Elf64_Phdr>() as u16;
        header.e_phnum = segment_count as u16;
        write_struct(&mut bytes, &header);

        let mut load: Elf64_Phdr = zeroed();
        load.p_type = PT_LOAD;
        write_struct(&mut bytes[size_of::<Elf64_Ehdr>()..], &load);

        for (index, notes) in segments.iter().enumerate() {
            let notes = encode_notes(notes, alignment);
            let mut segment: Elf64_Phdr = zeroed();
            segment.p_type = PT_NOTE;
            segment.p_offset = bytes.len() as u64;
            segment.p_filesz = notes.len() as u64;
            segment.p_align = alignment as u64;
            let at = NOTE_SEGMENT_OFFSET + index * size_of::<Elf64_Phdr>();
            write_struct(&mut bytes[at..], &segment);
            bytes.extend_from_slice(&notes);
        }
        bytes
    }

    fn elf_with_notes(notes: &[Note<'_>], alignment: usize) -> Vec<u8> {
        elf_with_note_segments(&[notes], alignment)
    }

    fn macho_with_commands(commands: &[(u32, &[u8])]) -> Vec<u8> {
        let mut bytes = vec![0; size_of::<mach_header_64>()];
        for &(cmd, body) in commands {
            bytes.extend_from_slice(&cmd.to_le_bytes());
            bytes.extend_from_slice(&(8 + body.len() as u32).to_le_bytes());
            bytes.extend_from_slice(body);
        }
        let mut header: mach_header_64 = zeroed();
        header.magic = MH_MAGIC_64;
        header.ncmds = commands.len() as u32;
        header.sizeofcmds = (bytes.len() - size_of::<mach_header_64>()) as u32;
        write_struct(&mut bytes, &header);
        bytes
    }

    fn code_view_record(signature: [u8; 4], guid: [u8; 16]) -> Vec<u8> {
        let mut record = vec![0; size_of::<CodeViewRecord>()];
        let fixed_part = CodeViewRecord {
            signature,
            guid,
            age: 1,
        };
        write_struct(&mut record, &fixed_part);
        record.extend_from_slice(b"bun.pdb\0");
        record
    }

    fn pe_with_debug_entries(entries: &[(u32, &[u8])]) -> Vec<u8> {
        let mut bytes = vec![0; RDATA_FILE_OFFSET + SECTION_SIZE];

        let mut dos_header: DOSHeader = zeroed();
        dos_header.e_magic = u16::from_le_bytes(*b"MZ");
        dos_header.e_lfanew = PE_HEADER_OFFSET as u32;
        write_struct(&mut bytes, &dos_header);

        let mut pe_header: PEHeader = zeroed();
        pe_header.signature = PE_SIGNATURE;
        pe_header.number_of_sections = SECTIONS.len() as u16;
        pe_header.size_of_optional_header = size_of::<OptionalHeader64>() as u16;
        write_struct(&mut bytes[PE_HEADER_OFFSET..], &pe_header);

        let mut optional_header: OptionalHeader64 = zeroed();
        optional_header.magic = PE32_PLUS_MAGIC;
        optional_header.number_of_rva_and_sizes = 16;
        optional_header.data_directories[DEBUG] = DataDirectory {
            virtual_address: (RDATA_ADDRESS + DEBUG_DIRECTORY_OFFSET) as u32,
            size: (entries.len() * size_of::<DebugDirectoryEntry>()) as u32,
        };
        write_struct(&mut bytes[OPTIONAL_HEADER_OFFSET..], &optional_header);

        for (index, (address, file_offset)) in SECTIONS.into_iter().enumerate() {
            let mut section: SectionHeader = zeroed();
            section.virtual_size = SECTION_SIZE as u32;
            section.virtual_address = address as u32;
            section.size_of_raw_data = SECTION_SIZE as u32;
            section.pointer_to_raw_data = file_offset as u32;
            let at = SECTION_TABLE_OFFSET + index * size_of::<SectionHeader>();
            write_struct(&mut bytes[at..], &section);
        }

        for (index, &(kind, data)) in entries.iter().enumerate() {
            let data_offset = DEBUG_DATA_OFFSET + index * DEBUG_DATA_STRIDE;
            let mut entry: DebugDirectoryEntry = zeroed();
            entry.kind = kind;
            entry.size_of_data = data.len() as u32;
            entry.address_of_raw_data = (RDATA_ADDRESS + data_offset) as u32;
            entry.pointer_to_raw_data = (RDATA_FILE_OFFSET + data_offset) as u32;
            let at = DEBUG_DIRECTORY_FILE_OFFSET + index * size_of::<DebugDirectoryEntry>();
            write_struct(&mut bytes[at..], &entry);
            bytes[RDATA_FILE_OFFSET + data_offset..][..data.len()].copy_from_slice(data);
        }
        bytes
    }

    fn pe_with_guid(guid: [u8; 16]) -> Vec<u8> {
        let record = code_view_record(CODE_VIEW_RSDS, guid);
        pe_with_debug_entries(&[(IMAGE_DEBUG_TYPE_CODEVIEW, &record)])
    }

    fn map_pe(file: &[u8]) -> Vec<u8> {
        let mut mapped = vec![0; SIZE_OF_IMAGE];
        mapped[..SIZE_OF_HEADERS].copy_from_slice(&file[..SIZE_OF_HEADERS]);
        for (address, file_offset) in SECTIONS {
            mapped[address..][..SECTION_SIZE].copy_from_slice(&file[file_offset..][..SECTION_SIZE]);
        }
        mapped
    }

    #[test]
    fn elf_identity_is_first_sixteen_build_id_bytes() {
        let elf = elf_with_notes(&[BUILD_ID_NOTE], 4);
        assert_eq!(find_identity(&elf), Ok(IDENTITY));
    }

    #[test]
    fn elf_build_id_after_other_notes() {
        let elf = elf_with_notes(&[ABI_TAG_NOTE, UNALIGNED_NOTE, BUILD_ID_NOTE], 4);
        assert_eq!(find_identity(&elf), Ok(IDENTITY));
    }

    #[test]
    fn elf_build_id_in_second_note_segment() {
        let elf = elf_with_note_segments(&[&[ABI_TAG_NOTE], &[BUILD_ID_NOTE]], 4);
        assert_eq!(find_identity(&elf), Ok(IDENTITY));
    }

    #[test]
    fn elf_notes_aligned_to_eight_bytes() {
        let elf = elf_with_notes(&[UNALIGNED_NOTE, BUILD_ID_NOTE], 8);
        assert_eq!(find_identity(&elf), Ok(IDENTITY));
    }

    #[test]
    fn elf_identity_changes_with_each_identity_byte() {
        for index in 0..BUILD_ID.len() {
            let mut build_id = BUILD_ID.to_vec();
            build_id[index] ^= 0xff;
            let elf = elf_with_notes(&[(GNU_NOTE_NAME, NT_GNU_BUILD_ID, &build_id)], 4);
            assert_eq!(find_identity(&elf) == Ok(IDENTITY), index >= IDENTITY.len());
        }
    }

    #[test]
    fn rest_of_gnu_build_id_is_what_the_identity_leaves_out() {
        let find_rest = |file: &[u8]| with_image(file, usize::MAX, find_rest_of_gnu_build_id);
        let note_lists: [&[Note<'_>]; 2] = [
            &[BUILD_ID_NOTE],
            &[ABI_TAG_NOTE, UNALIGNED_NOTE, BUILD_ID_NOTE],
        ];
        for notes in note_lists {
            let elf = elf_with_notes(notes, 4);
            assert_eq!(&elf[find_rest(&elf).unwrap()], &BUILD_ID[IDENTITY.len()..]);
        }
        let in_second_segment = elf_with_note_segments(&[&[ABI_TAG_NOTE], &[BUILD_ID_NOTE]], 8);
        let rest = find_rest(&in_second_segment).unwrap();
        assert_eq!(&in_second_segment[rest], &BUILD_ID[IDENTITY.len()..]);

        let files_without = [
            elf_with_notes(&[(GNU_NOTE_NAME, NT_GNU_BUILD_ID, &IDENTITY)], 4),
            elf_with_notes(&[(GNU_NOTE_NAME, NT_GNU_BUILD_ID, &BUILD_ID[..8])], 4),
            elf_with_notes(&[ABI_TAG_NOTE], 4),
            macho_with_commands(&[]),
            Vec::new(),
        ];
        for (index, file) in files_without.iter().enumerate() {
            assert_eq!(find_rest(file), None, "file {index}");
        }
    }

    #[test]
    fn elf_without_usable_build_id() {
        let short_note: Note<'_> = (GNU_NOTE_NAME, NT_GNU_BUILD_ID, &BUILD_ID[..8]);
        let note_lists: [&[Note<'_>]; 6] = [
            &[short_note],
            &[short_note, BUILD_ID_NOTE],
            &[(GNU_NOTE_NAME, NT_GNU_BUILD_ID, &[0; 20])],
            &[(b"Bun\0", NT_GNU_BUILD_ID, BUILD_ID)],
            &[ABI_TAG_NOTE],
            &[],
        ];
        for notes in note_lists {
            assert_eq!(find_identity(&elf_with_notes(notes, 4)), Err(NoBuildId));
        }
    }

    #[test]
    fn note_sizes_past_segment_end() {
        let notes = encode_notes(&[BUILD_ID_NOTE], 4);
        assert_eq!(find_build_id(&notes, 4), Some(IDENTITY));
        for len in 0..notes.len() {
            assert_eq!(find_build_id(&notes[..len], 4), None);
        }
        for (name_size, descriptor_size) in [(u32::MAX, 20), (4, u32::MAX), (u32::MAX, u32::MAX)] {
            let mut notes = notes.clone();
            let header = NoteHeader {
                name_size,
                descriptor_size,
                note_type: NT_GNU_BUILD_ID,
            };
            write_struct(&mut notes, &header);
            assert_eq!(find_build_id(&notes, 4), None);
        }
    }

    #[test]
    fn elf_header_errors() {
        let elf = elf_with_notes(&[BUILD_ID_NOTE], 4);
        let header_patches: [Patch<Elf64_Ehdr>; 6] = [
            (
                |header| header.e_ident[EI_CLASS] = 1,
                UnrecognizedExecutable,
            ),
            (|header| header.e_ident[EI_DATA] = 2, UnrecognizedExecutable),
            (|header| header.e_phoff = 1 << 40, Malformed),
            (|header| header.e_phoff = u64::MAX, Malformed),
            (|header| header.e_phentsize = 32, Malformed),
            (|header| header.e_phnum = 0, NoBuildId),
        ];
        check_patches(&elf, 0, &header_patches);
        let segment_patches: [Patch<Elf64_Phdr>; 4] = [
            (|segment| segment.p_offset = 1 << 40, Malformed),
            (|segment| segment.p_filesz += 1, Malformed),
            (
                |segment| segment.p_filesz = MAX_HEADER_BYTES as u64 + 1,
                Malformed,
            ),
            (|segment| segment.p_type = PT_LOAD, NoBuildId),
        ];
        check_patches(&elf, NOTE_SEGMENT_OFFSET, &segment_patches);
        let truncated_header = &elf[..size_of::<Elf64_Ehdr>() - 1];
        assert_eq!(find_identity(truncated_header), Err(Malformed));
    }

    #[test]
    fn macho_uuid_after_segment_commands() {
        let macho = macho_with_commands(&[
            (LC::SEGMENT_64, &[0; 64]),
            (LC::SEGMENT_64, &[0; 64]),
            (LC::UUID, &IDENTITY),
        ]);
        assert_eq!(find_identity(&macho), Ok(IDENTITY));
    }

    #[test]
    fn macho_without_usable_uuid() {
        let command_lists: [&[(u32, &[u8])]; 4] = [
            &[],
            &[(LC::SEGMENT_64, &[0; 64])],
            &[(LC::UUID, &IDENTITY[..8])],
            &[(LC::UUID, &[0; 16])],
        ];
        for commands in command_lists {
            assert_eq!(
                find_identity(&macho_with_commands(commands)),
                Err(NoBuildId)
            );
        }
    }

    #[test]
    fn macho_header_errors() {
        let macho = macho_with_commands(&[(LC::SEGMENT_64, &[0; 64]), (LC::UUID, &IDENTITY)]);
        let header_patches: [Patch<mach_header_64>; 4] = [
            (|header| header.sizeofcmds += 1, Malformed),
            (
                |header| header.sizeofcmds = MAX_HEADER_BYTES as u32 + 1,
                Malformed,
            ),
            (|header| header.sizeofcmds -= 24, Malformed),
            (|header| header.ncmds = 1, NoBuildId),
        ];
        check_patches(&macho, 0, &header_patches);
        let command_size_patches: [Patch<u32>; 3] = [
            (|command_size| *command_size = 0, Malformed),
            (|command_size| *command_size = 7, Malformed),
            (|command_size| *command_size = 1 << 16, Malformed),
        ];
        let command_size_offset = size_of::<mach_header_64>() + 4;
        check_patches(&macho, command_size_offset, &command_size_patches);
    }

    #[test]
    fn pe_code_view_entry_after_other_entries() {
        let rsds_record = code_view_record(CODE_VIEW_RSDS, IDENTITY);
        let nb10_record = code_view_record(*b"NB10", [0xee; 16]);
        let pe = pe_with_debug_entries(&[
            (IMAGE_DEBUG_TYPE_POGO, &[0xee; 32]),
            (IMAGE_DEBUG_TYPE_CODEVIEW, &nb10_record),
            (IMAGE_DEBUG_TYPE_CODEVIEW, &rsds_record),
        ]);
        assert_eq!(find_identity(&pe), Ok(IDENTITY));
    }

    #[test]
    fn pe_file_and_mapped_image_agree() {
        let find_guid = |bytes: &[u8], addressing| {
            with_image(bytes, usize::MAX, |pe| find_code_view_guid(pe, addressing))
        };
        let file = pe_with_guid(IDENTITY);
        assert_eq!(find_guid(&file, PeAddressing::File), Ok(IDENTITY));
        assert_eq!(
            find_guid(&map_pe(&file), PeAddressing::Mapped),
            Ok(IDENTITY)
        );
        assert_eq!(find_guid(&file, PeAddressing::Mapped), Err(Malformed));
    }

    #[test]
    fn pe_without_usable_code_view_guid() {
        let nb10_record = code_view_record(*b"NB10", IDENTITY);
        let nb10_only = pe_with_debug_entries(&[(IMAGE_DEBUG_TYPE_CODEVIEW, &nb10_record)]);
        assert_eq!(find_identity(&nb10_only), Err(NoBuildId));
        assert_eq!(find_identity(&pe_with_debug_entries(&[])), Err(NoBuildId));
        assert_eq!(find_identity(&pe_with_guid([0; 16])), Err(NoBuildId));
    }

    #[test]
    fn pe_header_errors() {
        let pe = pe_with_guid(IDENTITY);
        let dos_header_patches: [Patch<DOSHeader>; 1] =
            [(|header| header.e_lfanew = 1 << 20, Malformed)];
        check_patches(&pe, 0, &dos_header_patches);
        let pe_header_patches: [Patch<PEHeader>; 3] = [
            (|header| header.signature = 0, UnrecognizedExecutable),
            (
                |header| header.size_of_optional_header = 224,
                UnrecognizedExecutable,
            ),
            (|header| header.number_of_sections = 1, Malformed),
        ];
        check_patches(&pe, PE_HEADER_OFFSET, &pe_header_patches);
        let optional_header_patches: [Patch<OptionalHeader64>; 4] = [
            (|header| header.magic = 0x010b, UnrecognizedExecutable),
            (
                |header| header.number_of_rva_and_sizes = DEBUG as u32,
                NoBuildId,
            ),
            (|header| header.data_directories[DEBUG].size = 0, NoBuildId),
            (
                |header| header.data_directories[DEBUG].virtual_address = 0x3000,
                Malformed,
            ),
        ];
        check_patches(&pe, OPTIONAL_HEADER_OFFSET, &optional_header_patches);
        let entry_patches: [Patch<DebugDirectoryEntry>; 3] = [
            (|entry| entry.kind = IMAGE_DEBUG_TYPE_POGO, NoBuildId),
            (|entry| entry.size_of_data = 23, NoBuildId),
            (|entry| entry.pointer_to_raw_data = 1 << 20, Malformed),
        ];
        check_patches(&pe, DEBUG_DIRECTORY_FILE_OFFSET, &entry_patches);
    }

    #[test]
    fn unrecognized_magic() {
        let files: [&[u8]; 6] = [
            b"",
            b"\x7fEL",
            b"#!/bin/sh\nexit 0\n",
            &[0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2],
            &0xfeed_face_u32.to_le_bytes(),
            &MH_MAGIC_64.to_be_bytes(),
        ];
        for file in files {
            assert_eq!(find_identity(file), Err(UnrecognizedExecutable));
        }
    }

    #[test]
    fn failed_reads() {
        let files = [
            (elf_with_notes(&[BUILD_ID_NOTE], 4), 4),
            (macho_with_commands(&[(LC::UUID, &IDENTITY)]), 3),
            (pe_with_guid(IDENTITY), 7),
        ];
        for (file, read_count) in &files {
            let identity_with_reads = |limit| with_image(file, limit, find_file_identity);
            assert_eq!(identity_with_reads(0), Err(UnrecognizedExecutable));
            for limit in 1..*read_count {
                assert_eq!(identity_with_reads(limit), Err(Malformed));
            }
            assert_eq!(identity_with_reads(*read_count), Ok(IDENTITY));
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    #[allow(clippy::disallowed_methods)]
    fn process_identity_matches_executable_file() {
        let executable = std::fs::read(std::env::current_exe().unwrap()).unwrap();
        let process_identity = find_process_identity();
        assert_eq!(process_identity, find_identity(&executable));
        assert!(matches!(process_identity, Ok(_) | Err(NoBuildId)));
    }
}
