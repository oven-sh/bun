// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

use core::mem::{offset_of, size_of};
use core::ptr;
use core::slice;
use std::collections::BTreeMap;

// New error types for PE manipulation
#[derive(thiserror::Error, strum::IntoStaticStr, Debug, Copy, Clone, Eq, PartialEq)]
pub enum Error {
    #[error("OutOfBounds")]
    OutOfBounds,
    #[error("BadAlignment")]
    BadAlignment,
    #[error("Overflow")]
    Overflow,
    #[error("InvalidPEFile")]
    InvalidPEFile,
    #[error("InvalidDOSSignature")]
    InvalidDOSSignature,
    #[error("InvalidPESignature")]
    InvalidPESignature,
    #[error("UnsupportedPEFormat")]
    UnsupportedPEFormat,
    #[error("InsufficientHeaderSpace")]
    InsufficientHeaderSpace,
    #[error("TooManySections")]
    TooManySections,
    #[error("SectionExists")]
    SectionExists,
    #[error("InvalidSecurityDirectory")]
    InvalidSecurityDirectory,
    #[error("SecurityDirInsideImage")]
    SecurityDirInsideImage,
    #[error("UnexpectedOverlayPresent")]
    UnexpectedOverlayPresent,
    #[error("InvalidSectionData")]
    InvalidSectionData,
    #[error("SizeOfImageMismatch")]
    SizeOfImageMismatch,
    #[error("BadFunctionTable")]
    BadFunctionTable,
}

/// Windows PE Binary manipulation for codesigning standalone executables
pub struct PEFile {
    pub(crate) data: Vec<u8>,
    // Store offsets instead of pointers to avoid invalidation after resize
    pub(crate) pe_header_offset: usize,
    pub(crate) optional_header_offset: usize,
    pub(crate) section_headers_offset: usize,
    pub(crate) num_sections: u16,
}

// PE/COFF on-disk header structs are byte-packed (no padding) per spec, and may
// live at arbitrary byte offsets inside a `Vec<u8>` image, so `align_of` must be 1
// for it to be sound to materialize references/pointers to them from the buffer.
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub(crate) struct DOSHeader {
    pub e_magic: u16,      // Magic number
    pub e_cblp: u16,       // Bytes on last page of file
    pub e_cp: u16,         // Pages in file
    pub e_crlc: u16,       // Relocations
    pub e_cparhdr: u16,    // Size of header in paragraphs
    pub e_minalloc: u16,   // Minimum extra paragraphs needed
    pub e_maxalloc: u16,   // Maximum extra paragraphs needed
    pub e_ss: u16,         // Initial relative SS value
    pub e_sp: u16,         // Initial SP value
    pub e_csum: u16,       // Checksum
    pub e_ip: u16,         // Initial IP value
    pub e_cs: u16,         // Initial relative CS value
    pub e_lfarlc: u16,     // Address of relocation table
    pub e_ovno: u16,       // Overlay number
    pub e_res: [u16; 4],   // Reserved words
    pub e_oemid: u16,      // OEM identifier (for e_oeminfo)
    pub e_oeminfo: u16,    // OEM information; e_oemid specific
    pub e_res2: [u16; 10], // Reserved words
    pub e_lfanew: u32,     // File address of new exe header
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
pub(crate) struct PEHeader {
    pub signature: u32,               // PE signature
    pub machine: u16,                 // Machine type
    pub number_of_sections: u16,      // Number of sections
    pub time_date_stamp: u32,         // Time/date stamp
    pub pointer_to_symbol_table: u32, // Pointer to symbol table
    pub number_of_symbols: u32,       // Number of symbols
    pub size_of_optional_header: u16, // Size of optional header
    pub characteristics: u16,         // Characteristics
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
pub(crate) struct OptionalHeader64 {
    pub magic: u16,                            // Magic number
    pub major_linker_version: u8,              // Major linker version
    pub minor_linker_version: u8,              // Minor linker version
    pub size_of_code: u32,                     // Size of code
    pub size_of_initialized_data: u32,         // Size of initialized data
    pub size_of_uninitialized_data: u32,       // Size of uninitialized data
    pub address_of_entry_point: u32,           // Address of entry point
    pub base_of_code: u32,                     // Base of code
    pub image_base: u64,                       // Image base
    pub section_alignment: u32,                // Section alignment
    pub file_alignment: u32,                   // File alignment
    pub major_operating_system_version: u16,   // Major OS version
    pub minor_operating_system_version: u16,   // Minor OS version
    pub major_image_version: u16,              // Major image version
    pub minor_image_version: u16,              // Minor image version
    pub major_subsystem_version: u16,          // Major subsystem version
    pub minor_subsystem_version: u16,          // Minor subsystem version
    pub win32_version_value: u32,              // Win32 version value
    pub size_of_image: u32,                    // Size of image
    pub size_of_headers: u32,                  // Size of headers
    pub checksum: u32,                         // Checksum
    pub subsystem: u16,                        // Subsystem
    pub dll_characteristics: u16,              // DLL characteristics
    pub size_of_stack_reserve: u64,            // Size of stack reserve
    pub size_of_stack_commit: u64,             // Size of stack commit
    pub size_of_heap_reserve: u64,             // Size of heap reserve
    pub size_of_heap_commit: u64,              // Size of heap commit
    pub loader_flags: u32,                     // Loader flags
    pub number_of_rva_and_sizes: u32,          // Number of RVA and sizes
    pub data_directories: [DataDirectory; 16], // Data directories
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
pub(crate) struct DataDirectory {
    pub virtual_address: u32,
    pub size: u32,
}

#[repr(C, packed)]
#[derive(Copy, Clone)]
pub(crate) struct SectionHeader {
    pub name: [u8; 8],                // Section name
    pub virtual_size: u32,            // Virtual size
    pub virtual_address: u32,         // Virtual address
    pub size_of_raw_data: u32,        // Size of raw data
    pub pointer_to_raw_data: u32,     // Pointer to raw data
    pub pointer_to_relocations: u32,  // Pointer to relocations
    pub pointer_to_line_numbers: u32, // Pointer to line numbers
    pub number_of_relocations: u16,   // Number of relocations
    pub number_of_line_numbers: u16,  // Number of line numbers
    pub characteristics: u32,         // Characteristics
}

pub(crate) const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"
const DOS_SIGNATURE: u16 = 0x5A4D; // "MZ"
const OPTIONAL_HEADER_MAGIC_64: u16 = 0x020B;

// Section characteristics
const IMAGE_SCN_CNT_INITIALIZED_DATA: u32 = 0x0000_0040;
const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;
const IMAGE_SCN_MEM_WRITE: u32 = 0x8000_0000;
const IMAGE_SCN_MEM_EXECUTE: u32 = 0x2000_0000;

// Directory indices and DLL characteristics
const IMAGE_DIRECTORY_ENTRY_EXPORT: usize = 0;
const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_EXCEPTION: usize = 3;
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_DIRECTORY_ENTRY_DEBUG: usize = 6;
const IMAGE_DIRECTORY_ENTRY_TLS: usize = 9;
const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT: usize = 13;
const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

pub const IMAGE_SUBSYSTEM_WINDOWS_GUI: u16 = 2;

// Base-relocation types (high 4 bits of each 16-bit entry)
const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;
const IMAGE_REL_BASED_DIR64: u16 = 10;

// Import-thunk ordinal flag (PE32+)
const IMAGE_ORDINAL_FLAG64: u64 = 0x8000_0000_0000_0000;

// Windows page-protection constants (for LinkedAddon.sections[].final_protect)
const PAGE_READONLY: u32 = 0x02;
const PAGE_READWRITE: u32 = 0x04;
const PAGE_EXECUTE_READ: u32 = 0x20;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

// Section name constant for exact comparison
const BUN_SECTION_NAME: [u8; 8] = [b'.', b'b', b'u', b'n', 0, 0, 0, 0];
const BUNL_SECTION_NAME: [u8; 8] = [b'.', b'b', b'u', b'n', b'L', 0, 0, 0];

/// The loader rejects images with more sections than this.
const MAX_SECTIONS: usize = 96;
/// Caps the build-time allocation a hostile addon `SizeOfImage` can demand.
const MAX_ADDON_IMAGE_SIZE: u32 = 512 * 1024 * 1024;

/// Result of `PEFile::next_section_placement`: both values are already aligned.
#[derive(Clone, Copy)]
struct SectionPlacement {
    va: u32,
    raw: u32,
}

/// Result of `PEFile::reserve_section_headers`.
struct HeaderSlack {
    /// `SizeOfHeaders` covering the reserved section headers.
    size_of_headers: u32,
    /// Lowest `PointerToRawData` in the image (or the file length if no section has raw data).
    first_raw: u32,
}

// sizeof the on-disk addon structures read field-by-field below (untrusted input).
const IMAGE_IMPORT_DESCRIPTOR_SIZE: u32 = 20;
const IMAGE_DELAYLOAD_DESCRIPTOR_SIZE: u32 = 32;
const IMAGE_EXPORT_DIRECTORY_SIZE: u32 = 40;
const IMAGE_BASE_RELOCATION_SIZE: u32 = 8;

const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;

/// Size of one exception-directory entry: x64 RUNTIME_FUNCTION or ARM64's two-word entry.
fn function_table_entry_size(machine: u16) -> usize {
    if machine == IMAGE_FILE_MACHINE_ARM64 {
        8
    } else {
        12
    }
}

/// bun.exe export (src/symbols.def) that replaces every handler a merged addon's unwind infos name.
pub const LINKED_ADDON_EXCEPTION_HANDLER: &[u8] = b"Bun__linkedAddonExceptionHandler";

// Safe access helpers for unaligned views.
// All header structs are `#[repr(C, packed)]` (align 1), so a bounds-checked byte
// pointer into the image can be cast and dereferenced directly.
fn view_at_const<T>(buf: &[u8], off: usize) -> Result<*const T, Error> {
    if off + size_of::<T>() > buf.len() {
        return Err(Error::OutOfBounds);
    }
    // SAFETY: bounds-checked above; pointer remains within `buf`
    Ok(unsafe { buf.as_ptr().add(off).cast::<T>() })
}

fn view_at_mut<T>(buf: &mut [u8], off: usize) -> Result<*mut T, Error> {
    if off + size_of::<T>() > buf.len() {
        return Err(Error::OutOfBounds);
    }
    // SAFETY: bounds-checked above; pointer remains within `buf`
    Ok(unsafe { buf.as_mut_ptr().add(off).cast::<T>() })
}

fn is_pow2(x: u32) -> bool {
    x != 0 && (x & (x - 1)) == 0
}

fn align_up_u32(v: u32, a: u32) -> Result<u32, Error> {
    if a == 0 {
        return Ok(v);
    }
    if !is_pow2(a) {
        return Err(Error::BadAlignment);
    }
    let add = a - 1;
    if v > u32::MAX - add {
        return Err(Error::Overflow);
    }
    Ok((v + add) & !add)
}

fn align_up_usize(v: usize, a: usize) -> Result<usize, Error> {
    if a == 0 {
        return Ok(v);
    }
    if (a & (a - 1)) != 0 {
        return Err(Error::BadAlignment);
    }
    let add = a - 1;
    if v > usize::MAX - add {
        return Err(Error::Overflow);
    }
    Ok((v + add) & !add)
}

impl PEFile {
    // Helper methods to safely access headers using unaligned pointers
    fn get_pe_header_mut(&mut self) -> Result<*mut PEHeader, Error> {
        view_at_mut::<PEHeader>(&mut self.data, self.pe_header_offset)
    }

    fn get_optional_header_mut(&mut self) -> Result<*mut OptionalHeader64, Error> {
        view_at_mut::<OptionalHeader64>(&mut self.data, self.optional_header_offset)
    }

    fn get_section_headers(&self) -> Result<&[SectionHeader], Error> {
        let start = self.section_headers_offset;
        let size = size_of::<SectionHeader>() * self.num_sections as usize;
        if start + size > self.data.len() {
            return Err(Error::OutOfBounds);
        }
        // SAFETY: bounds-checked above; SectionHeader is #[repr(C, packed)] (align 1) POD.
        let ptr = unsafe { self.data.as_ptr().add(start).cast::<SectionHeader>() };
        // SAFETY: `[start, start + size)` lies within `self.data` per the check above; the
        // bytes are initialized from the input PE image and SectionHeader is repr(C) Copy
        // with no invalid bit patterns.
        Ok(unsafe { slice::from_raw_parts(ptr, self.num_sections as usize) })
    }

    pub fn init(pe_data: &[u8]) -> Result<Box<PEFile>, Error> {
        // 1. Reserve capacity as before
        let mut data: Vec<u8> = Vec::with_capacity(pe_data.len() + 64 * 1024);
        data.extend_from_slice(pe_data);

        // 2. Validate DOS header
        if data.len() < size_of::<DOSHeader>() {
            return Err(Error::InvalidPEFile);
        }

        let dos_header = view_at_const::<DOSHeader>(&data, 0)?;
        // SAFETY: validated bounds; offset 0 in Vec<u8> backing store
        let dos_header = unsafe { &*dos_header };
        if dos_header.e_magic != DOS_SIGNATURE {
            return Err(Error::InvalidDOSSignature);
        }

        // Bound e_lfanew against file size, not 0x1000
        if (dos_header.e_lfanew as usize) < size_of::<DOSHeader>() {
            return Err(Error::InvalidPEFile);
        }
        if dos_header.e_lfanew as usize > data.len().saturating_sub(size_of::<PEHeader>()) {
            return Err(Error::InvalidPEFile);
        }

        // 3. Read PE header via viewAtMut
        let pe_off = dos_header.e_lfanew as usize;
        let pe_header = view_at_mut::<PEHeader>(&mut data, pe_off)?;
        // SAFETY: validated bounds above
        let pe_header = unsafe { &mut *pe_header };
        if pe_header.signature != PE_SIGNATURE {
            return Err(Error::InvalidPESignature);
        }

        // 4. Compute optional_header_offset
        let optional_header_offset = pe_off + size_of::<PEHeader>();
        if data.len() < optional_header_offset + pe_header.size_of_optional_header as usize {
            return Err(Error::InvalidPEFile);
        }
        if (pe_header.size_of_optional_header as usize) < size_of::<OptionalHeader64>() {
            return Err(Error::InvalidPEFile);
        }

        // 5. Read optional header
        let size_of_optional_header = pe_header.size_of_optional_header;
        let number_of_sections = pe_header.number_of_sections;
        let optional_header = view_at_mut::<OptionalHeader64>(&mut data, optional_header_offset)?;
        // SAFETY: validated bounds above
        let optional_header = unsafe { &mut *optional_header };
        if optional_header.magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(Error::UnsupportedPEFormat);
        }

        // Validate file_alignment and section_alignment
        if !is_pow2(optional_header.file_alignment) || !is_pow2(optional_header.section_alignment) {
            return Err(Error::BadAlignment);
        }
        // If section_alignment < 4096, then file_alignment == section_alignment
        if optional_header.section_alignment < 4096 {
            if optional_header.file_alignment != optional_header.section_alignment {
                return Err(Error::InvalidPEFile);
            }
        }

        // 6. Compute section_headers_offset
        let section_headers_offset = optional_header_offset + size_of_optional_header as usize;
        let num_sections = number_of_sections;
        if num_sections as usize > MAX_SECTIONS {
            return Err(Error::TooManySections);
        }
        let section_headers_size = size_of::<SectionHeader>() * num_sections as usize;
        if data.len() < section_headers_offset + section_headers_size {
            return Err(Error::InvalidPEFile);
        }

        // 7. Validate each section's aligned virtual extent up front.
        let section_alignment = optional_header.section_alignment;
        for i in 0..num_sections as usize {
            let sh_off = section_headers_offset + i * size_of::<SectionHeader>();
            // SAFETY: `sh_off + size_of::<SectionHeader>()` is within `data` per the
            // `section_headers_offset + section_headers_size <= data.len()` check above.
            let section =
                unsafe { ptr::read_unaligned(data.as_ptr().add(sh_off).cast::<SectionHeader>()) };
            let vs_effective = section.virtual_size.max(section.size_of_raw_data);
            section
                .virtual_address
                .checked_add(align_up_u32(vs_effective, section_alignment)?)
                .ok_or(Error::Overflow)?;
        }

        Ok(Box::new(PEFile {
            data,
            pe_header_offset: pe_off,
            optional_header_offset,
            section_headers_offset,
            num_sections,
        }))
    }

    // deinit: Drop is automatic — Vec<u8> field freed; Box<PEFile> dropped by caller.

    /// Strip Authenticode signatures from the PE file
    pub(crate) fn strip_authenticode(&mut self) -> Result<(), Error> {
        let opt = view_at_mut::<OptionalHeader64>(&mut self.data, self.optional_header_offset)?;

        // Read Security directory (index 4)
        // SAFETY: opt points into self.data at validated offset
        let dd_ptr: *mut DataDirectory =
            unsafe { ptr::addr_of_mut!((*opt).data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY]) };
        // SAFETY: dd_ptr is within the OptionalHeader64 struct
        let sec_off_u32 = unsafe { (*dd_ptr).virtual_address }; // file offset (not RVA)
        // SAFETY: dd_ptr is within the OptionalHeader64 struct (bounds-checked via view_at_mut)
        let sec_size_u32 = unsafe { (*dd_ptr).size };

        if sec_off_u32 == 0 || sec_size_u32 == 0 {
            return Ok(()); // nothing to strip
        }

        // Compute last_file_end from sections (reuse cached or recompute)
        let mut last_raw_end: u32 = 0;
        let sections = self.get_section_headers()?;
        for s in sections {
            let end = s.pointer_to_raw_data + s.size_of_raw_data;
            if end > last_raw_end {
                last_raw_end = end;
            }
        }

        let file_len = self.data.len();
        let sec_off = sec_off_u32 as usize;
        let sec_size = sec_size_u32 as usize;

        if sec_off >= file_len || sec_size == 0 {
            return Err(Error::InvalidSecurityDirectory);
        }
        if sec_off < last_raw_end as usize {
            return Err(Error::SecurityDirInsideImage);
        }

        // Remove certificate plus 8-byte padding at tail
        let end_raw = align_up_usize(sec_off + sec_size, 8)?;
        if end_raw > file_len {
            return Err(Error::InvalidSecurityDirectory);
        }

        if end_raw == file_len {
            self.data.truncate(sec_off);
        } else {
            let tail_len = file_len - end_raw;
            // Use copy_within for potentially overlapping memory regions
            self.data.copy_within(end_raw..file_len, sec_off);
            self.data.truncate(sec_off + tail_len);
        }

        // Re-get pointers after resize
        let opt_after = self.get_optional_header_mut()?;
        // SAFETY: opt_after points into self.data at validated offset
        let dd_after: *mut DataDirectory = unsafe {
            ptr::addr_of_mut!((*opt_after).data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY])
        };

        // Zero Security directory entry
        // SAFETY: dd_after is within the OptionalHeader64 struct
        unsafe {
            (*dd_after).virtual_address = 0;
            (*dd_after).size = 0;
        }

        // Clear FORCE_INTEGRITY bit if set
        // SAFETY: opt_after points into self.data at validated offset
        unsafe {
            if ((*opt_after).dll_characteristics & IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY) != 0 {
                (*opt_after).dll_characteristics &= !IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY;
            }
        }

        // Recompute checksum (recommended)
        self.recompute_pe_checksum()?;

        // After strip, ensure no remaining overlay beyond last section
        let after_strip_len = self.data.len();
        if (last_raw_end as usize) < after_strip_len {
            return Err(Error::UnexpectedOverlayPresent);
        }
        Ok(())
    }

    /// Recompute PE checksum according to Windows spec
    fn recompute_pe_checksum(&mut self) -> Result<(), Error> {
        let checksum_off = self.optional_header_offset + offset_of!(OptionalHeader64, checksum);

        // Zero checksum field before summing
        self.data[checksum_off..checksum_off + 4].fill(0);

        let data = &self.data[..];
        let mut sum: u64 = 0;
        let mut i: usize = 0;

        // Sum 16-bit words
        while i + 1 < data.len() {
            let w: u16 = (data[i] as u16) | ((data[i + 1] as u16) << 8);
            sum += w as u64;
            sum = (sum & 0xffff) + (sum >> 16); // fold periodically
            i += 2;
        }
        // Odd trailing byte
        if (data.len() & 1) != 0 {
            sum += data[data.len() - 1] as u64;
        }

        // Fold to 16 bits, then add file length (no fold after: result is 32-bit).
        sum = (sum & 0xffff) + (sum >> 16);
        sum = (sum & 0xffff) + (sum >> 16);
        let final_sum: u32 = (sum as u32).wrapping_add(data.len() as u32);

        let opt = self.get_optional_header_mut()?;
        // SAFETY: opt points into self.data at validated offset
        unsafe {
            (*opt).checksum = final_sum;
        }
        Ok(())
    }

    /// Makes room for `count` more section headers: checks the section cap, and when the header
    /// area ends too close to the first section's data, grows it (`grow_headers`).
    fn reserve_section_headers(
        &mut self,
        count: usize,
        file_alignment: u32,
    ) -> Result<HeaderSlack, Error> {
        let total = self.num_sections as usize + count;
        if total > MAX_SECTIONS {
            return Err(Error::TooManySections);
        }
        let headers_end = self.section_headers_offset + size_of::<SectionHeader>() * total;
        let size_of_headers = align_up_u32(
            u32::try_from(headers_end).expect("int cast"),
            file_alignment,
        )?;
        let mut first_raw: u32 = u32::try_from(self.data.len()).expect("int cast");
        let mut first_va: u32 = u32::MAX;
        for section in self.get_section_headers()? {
            if section.size_of_raw_data > 0 && section.pointer_to_raw_data < first_raw {
                first_raw = section.pointer_to_raw_data;
            }
            first_va = first_va.min(section.virtual_address);
        }
        if size_of_headers > first_raw {
            self.grow_headers(first_raw, size_of_headers, first_va, file_alignment)?;
            first_raw = size_of_headers;
        }
        Ok(HeaderSlack {
            size_of_headers,
            first_raw,
        })
    }

    /// Moves every section's raw data up so that the header area ends at `size_of_headers`
    /// instead of `first_raw`, and fixes up the file offsets that point into it: the section
    /// headers, the debug directory entries and the COFF symbol table. Everything else in a PE
    /// image is an RVA, which does not change. The headers share their page with nothing until
    /// the first section's address, so that is how far they can grow.
    fn grow_headers(
        &mut self,
        first_raw: u32,
        size_of_headers: u32,
        first_va: u32,
        file_alignment: u32,
    ) -> Result<(), Error> {
        if size_of_headers > first_va
            || !first_raw.is_multiple_of(file_alignment)
            || first_raw as usize > self.data.len()
        {
            return Err(Error::InsufficientHeaderSpace);
        }
        // The certificate table is the one other structure addressed by file offset.
        self.strip_authenticode()?;

        // IMAGE_DEBUG_DIRECTORY is 28 bytes; PointerToRawData, the file offset of the entry's
        // data, is at +24. Located before the move, in the current layout.
        const DEBUG_ENTRY_SIZE: usize = 28;
        let debug_entries: Vec<usize> = {
            let view = AddonView::init(&self.data)?;
            let dir = view.dir(IMAGE_DIRECTORY_ENTRY_DEBUG);
            if dir.size == 0 {
                Vec::new()
            } else {
                let Ok(first) = view.rva_to_off(dir.virtual_address) else {
                    return Err(Error::InsufficientHeaderSpace);
                };
                if view.slice_at_rva(dir.virtual_address, dir.size).is_err() {
                    return Err(Error::InsufficientHeaderSpace);
                }
                (0..dir.size as usize / DEBUG_ENTRY_SIZE)
                    .map(|i| first as usize + i * DEBUG_ENTRY_SIZE)
                    .collect()
            }
        };

        let grow = size_of_headers - first_raw;
        let shift = |offset: u32| -> u32 {
            if offset >= first_raw {
                offset + grow
            } else {
                offset
            }
        };
        self.data.splice(
            first_raw as usize..first_raw as usize,
            core::iter::repeat_n(0u8, grow as usize),
        );

        for i in 0..self.num_sections as usize {
            let header = view_at_mut::<SectionHeader>(
                &mut self.data,
                self.section_headers_offset + i * size_of::<SectionHeader>(),
            )?;
            // SAFETY: header points into self.data at a bounds-checked offset; the struct is
            // packed, so the field goes through its raw address.
            unsafe {
                let field = ptr::addr_of_mut!((*header).pointer_to_raw_data);
                field.write_unaligned(shift(field.read_unaligned()));
            }
        }

        let pe_header = self.get_pe_header_mut()?;
        // SAFETY: pe_header points into self.data at a validated offset.
        unsafe {
            let field = ptr::addr_of_mut!((*pe_header).pointer_to_symbol_table);
            let pointer = field.read_unaligned();
            if pointer != 0 {
                field.write_unaligned(shift(pointer));
            }
        }

        let opt = self.get_optional_header_mut()?;
        // SAFETY: opt points into self.data at a validated offset.
        unsafe {
            (*opt).size_of_headers = size_of_headers;
        }

        for entry in debug_entries {
            let at = shift(u32::try_from(entry).map_err(|_| Error::Overflow)?) as usize + 24;
            let pointer = read_u32_le(&self.data, at);
            if pointer != 0 {
                self.data[at..at + 4].copy_from_slice(&shift(pointer).to_le_bytes());
            }
        }
        Ok(())
    }

    /// Add a new section to the PE file for storing Bun module data
    pub fn add_bun_section(&mut self, data_to_embed: &[u8]) -> Result<(), Error> {
        // 1. Strip Authenticode (before any addition)
        self.strip_authenticode()?;

        // 2. Re-read PE/Optional (pointers may have moved due to resize in strip)
        let opt = self.get_optional_header_mut()?;
        // SAFETY: opt points into self.data at validated offset
        // Capture the needed scalars from opt before re-borrowing self.data below.
        let file_alignment = unsafe { (*opt).file_alignment };
        // SAFETY: opt points into self.data at the offset validated by get_optional_header_mut
        let section_alignment = unsafe { (*opt).section_alignment };

        // 3. Duplicate .bun guard - compare all 8 bytes exactly
        let section_headers = self.get_section_headers()?;
        for section in section_headers {
            if section.name[0..8] == BUN_SECTION_NAME {
                return Err(Error::SectionExists);
            }
        }

        // 4. Compute header slack requirement (may move the raw data to make room)
        let HeaderSlack {
            size_of_headers: new_size_of_headers,
            first_raw,
        } = self.reserve_section_headers(1, file_alignment)?;

        // 5. Placement calculations
        // Recompute last_file_end and last_va_end after strip and reserve
        let section_headers = self.get_section_headers()?;
        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;
        for section in section_headers {
            let file_end = section.pointer_to_raw_data + section.size_of_raw_data;
            if file_end > last_file_end {
                last_file_end = file_end;
            }
            // Use effective virtual size (max of virtual_size and size_of_raw_data)
            let vs_effective = section.virtual_size.max(section.size_of_raw_data);
            let va_end = section.virtual_address + align_up_u32(vs_effective, section_alignment)?;
            if va_end > last_va_end {
                last_va_end = va_end;
            }
        }

        // Check for overflow before adding 8
        if data_to_embed.len() > (u32::MAX - 8) as usize {
            return Err(Error::Overflow);
        }
        let payload_len = u32::try_from(data_to_embed.len() + 8).expect("int cast"); // 8 for LE length prefix
        let raw_size = align_up_u32(payload_len, file_alignment)?;
        let new_va = align_up_u32(last_va_end, section_alignment)?;
        let new_raw = align_up_u32(last_file_end, file_alignment)?;

        // 6. Resize & zero only the new section area
        let new_file_size = new_raw as usize + raw_size as usize;
        self.data.resize(new_file_size, 0);
        self.data[new_raw as usize..new_file_size].fill(0);

        // 7. Write the new SectionHeader by byte copy
        let sh = SectionHeader {
            name: [b'.', b'b', b'u', b'n', 0, 0, 0, 0],
            virtual_size: payload_len,
            virtual_address: new_va,
            size_of_raw_data: raw_size,
            pointer_to_raw_data: new_raw,
            pointer_to_relocations: 0,
            pointer_to_line_numbers: 0,
            number_of_relocations: 0,
            number_of_line_numbers: 0,
            characteristics: IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };

        let new_sh_off =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        // Bounds check against first_raw (not file length)
        if new_sh_off + size_of::<SectionHeader>() > first_raw as usize {
            return Err(Error::InsufficientHeaderSpace);
        }
        // SAFETY: bounds-checked above; SectionHeader is #[repr(C)] POD
        let sh_bytes = unsafe {
            slice::from_raw_parts((&raw const sh).cast::<u8>(), size_of::<SectionHeader>())
        };
        self.data[new_sh_off..new_sh_off + size_of::<SectionHeader>()].copy_from_slice(sh_bytes);

        // 8. Write payload
        // At data[new_raw ..]: write u64 LE length prefix, then data
        let new_raw_usize = new_raw as usize;
        self.data[new_raw_usize..new_raw_usize + 8]
            .copy_from_slice(&(data_to_embed.len() as u64).to_le_bytes());
        self.data[new_raw_usize + 8..new_raw_usize + 8 + data_to_embed.len()]
            .copy_from_slice(data_to_embed);

        // 9. Update headers
        // Get fresh pointers after resize
        let pe_after = self.get_pe_header_mut()?;
        // SAFETY: pe_after points into self.data at validated offset
        unsafe {
            (*pe_after).number_of_sections += 1;
        }
        self.num_sections += 1;

        let opt_after = self.get_optional_header_mut()?;
        // SAFETY: opt_after points into self.data at validated offset
        unsafe {
            // If opt.size_of_headers < new_size_of_headers
            if (*opt_after).size_of_headers < new_size_of_headers {
                (*opt_after).size_of_headers = new_size_of_headers;
            }
            // Calculate size_of_image: aligned end of last section
            let section_va_end = new_va + sh.virtual_size;
            (*opt_after).size_of_image =
                align_up_u32(section_va_end, (*opt_after).section_alignment)?;

            // Security directory must be zero (signature invalidated by change)
            let dd_ptr: *mut DataDirectory =
                ptr::addr_of_mut!((*opt_after).data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY]);
            if (*dd_ptr).virtual_address != 0 || (*dd_ptr).size != 0 {
                (*dd_ptr).virtual_address = 0;
                (*dd_ptr).size = 0;
            }
        }

        // Do not touch size_of_initialized_data (leave as is)

        // 10. Recompute checksum (recommended)
        self.recompute_pe_checksum()?;
        Ok(())
    }

    /// Set the Windows subsystem field in the optional header. Does not recompute the checksum.
    pub fn set_subsystem(&mut self, subsystem: u16) -> Result<(), Error> {
        let opt = self.get_optional_header_mut()?;
        // SAFETY: opt points into self.data at validated offset
        unsafe {
            (*opt).subsystem = subsystem;
        }
        Ok(())
    }

    /// Write the modified PE file
    pub fn write(&self, writer: &mut impl std::io::Write) -> crate::Result<()> {
        writer.write_all(&self.data)?;
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }
}

/// One addon's `.bunL` record for `LinkedNodeModule.rs`; every RVA is already bun.exe-relative.
pub struct LinkedAddon {
    /// The `$bunfs` virtual path `process.dlopen` is called with.
    pub name: Vec<u8>,
    /// Where the addon's RVA 0 landed in bun.exe.
    pub rva_base: u32,
    /// The addon's `SizeOfImage`.
    pub image_size: u32,
    /// Bytes of `.bnN` the addon occupies: `image_size` plus the unwind appendix (`FunctionTable`).
    pub section_size: u32,
    /// `AddressOfEntryPoint` (DllMain), or 0 when the addon has none.
    pub entry_point: u32,
    /// bun.exe's `ImageBase` the relocations were applied against.
    pub preferred_base: u64,

    pub sections: Vec<LinkedSectionInfo>,
    /// The addon's `IMAGE_BASE_RELOCATION` blocks, page RVAs rebased.
    pub relocs: Vec<u8>,
    pub imports: Vec<LinkedImportLib>,
    /// The addon's exception-directory entries rebased to bun.exe RVAs.
    pub function_table: Vec<u8>,
    /// Sorted by `unwind_info`.
    pub handlers: Vec<HandlerRedirect>,
    /// Export RVAs, zero when the addon does not export the symbol.
    pub export_register: u32, // napi_register_module_v1
    pub export_api_version: u32, // node_api_module_get_api_version_v1
}

/// One entry of the index `Bun__linkedAddonExceptionHandler` searches.
#[derive(Copy, Clone)]
pub struct HandlerRedirect {
    /// bun.exe RVA of an unwind info as a table entry (or a re-dispatched copy) names it.
    pub unwind_info: u32,
    /// bun.exe RVA of the handler the build displaced from it, or from the end of its chain.
    pub handler: u32,
    /// Addon RVA of the record to present to that handler (`Patched::view`).
    pub view: u32,
}

#[derive(Copy, Clone)]
pub struct LinkedSectionInfo {
    pub rva: u32,
    pub size: u32,
    /// `PAGE_*` protection to apply once the runtime has finished patching the range.
    pub final_protect: u32,
}

pub struct LinkedImportLib {
    pub name: Vec<u8>,
    /// Resolved against bun.exe's own exports instead of `LoadLibraryA(name)`.
    pub is_host: bool,
    pub entries: Vec<LinkedImportEntry>,
}

pub struct LinkedImportEntry {
    pub iat_rva: u32,
    pub ordinal: u16,
    /// Empty when importing by ordinal.
    pub name: Vec<u8>,
}

/// Bounds-checked reads from an unloaded (file-layout) addon image.
struct AddonView<'a> {
    bytes: &'a [u8],
    pe: PEHeader,
    opt: OptionalHeader64,
    sections: &'a [SectionHeader],
}

impl<'a> AddonView<'a> {
    fn init(bytes: &'a [u8]) -> Result<AddonView<'a>, Error> {
        if bytes.len() < size_of::<DOSHeader>() {
            return Err(Error::InvalidPEFile);
        }
        // SAFETY: bounds-checked by view_at_const; DOSHeader is packed POD.
        let dos = unsafe { ptr::read_unaligned(view_at_const::<DOSHeader>(bytes, 0)?) };
        if dos.e_magic != DOS_SIGNATURE {
            return Err(Error::InvalidDOSSignature);
        }
        if (dos.e_lfanew as usize) < size_of::<DOSHeader>()
            || dos.e_lfanew as usize > bytes.len().saturating_sub(size_of::<PEHeader>())
        {
            return Err(Error::InvalidPEFile);
        }
        // SAFETY: bounds-checked by view_at_const; PEHeader is packed POD.
        let pe = unsafe {
            ptr::read_unaligned(view_at_const::<PEHeader>(bytes, dos.e_lfanew as usize)?)
        };
        if pe.signature != PE_SIGNATURE {
            return Err(Error::InvalidPESignature);
        }
        let opt_off = dos.e_lfanew as usize + size_of::<PEHeader>();
        if (pe.size_of_optional_header as usize) < size_of::<OptionalHeader64>() {
            return Err(Error::UnsupportedPEFormat);
        }
        // SAFETY: bounds-checked by view_at_const; OptionalHeader64 is packed POD.
        let opt =
            unsafe { ptr::read_unaligned(view_at_const::<OptionalHeader64>(bytes, opt_off)?) };
        if opt.magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(Error::UnsupportedPEFormat);
        }
        let sh_off = opt_off + pe.size_of_optional_header as usize;
        let n = pe.number_of_sections as usize;
        if sh_off + n * size_of::<SectionHeader>() > bytes.len() {
            return Err(Error::InvalidPEFile);
        }
        // SAFETY: `[sh_off, sh_off + n * size)` lies within `bytes` per the check
        // above; SectionHeader is #[repr(C, packed)] (align 1) POD with no invalid
        // bit patterns.
        let sections =
            unsafe { slice::from_raw_parts(bytes.as_ptr().add(sh_off).cast::<SectionHeader>(), n) };
        Ok(AddonView {
            bytes,
            pe,
            opt,
            sections,
        })
    }

    fn rva_to_off(&self, rva: u32) -> Result<u32, Error> {
        for s in self.sections {
            let vs = s.virtual_size.max(s.size_of_raw_data);
            if rva >= s.virtual_address && rva < s.virtual_address.saturating_add(vs) {
                let delta = rva - s.virtual_address;
                if delta >= s.size_of_raw_data {
                    return Err(Error::OutOfBounds); // bss / past raw
                }
                let off = s.pointer_to_raw_data.saturating_add(delta);
                if off as usize >= self.bytes.len() {
                    return Err(Error::OutOfBounds);
                }
                return Ok(off);
            }
        }
        Err(Error::OutOfBounds)
    }

    fn slice_at_rva(&self, rva: u32, len: u32) -> Result<&'a [u8], Error> {
        let off = self.rva_to_off(rva)?;
        if off as u64 + len as u64 > self.bytes.len() as u64 {
            return Err(Error::OutOfBounds);
        }
        Ok(&self.bytes[off as usize..][..len as usize])
    }

    fn cstr_at_rva(&self, rva: u32) -> Result<&'a [u8], Error> {
        let off = self.rva_to_off(rva)? as usize;
        let rest = &self.bytes[off..];
        let z = bun_core::strings::index_of_char_usize(rest, 0).ok_or(Error::OutOfBounds)?;
        Ok(&rest[..z])
    }

    fn dir(&self, idx: usize) -> DataDirectory {
        if idx >= self.opt.number_of_rva_and_sizes as usize {
            return DataDirectory {
                virtual_address: 0,
                size: 0,
            };
        }
        self.opt.data_directories[idx]
    }
}

/// Names addons import napi/uv from (node-gyp: node.exe, napi-rs: node.dll); bun.exe exports them all.
fn is_host_import(dll_name: &[u8]) -> bool {
    dll_name.eq_ignore_ascii_case(b"node.exe")
        || dll_name.eq_ignore_ascii_case(b"node.dll")
        || dll_name.eq_ignore_ascii_case(b"bun.exe")
        || (dll_name.len() >= 4 && dll_name[0..4].eq_ignore_ascii_case(b"bun-"))
}

/// Only the MSVC CRT's empty-template TLS directory (which needs no loader TLS slot) can be merged.
fn tls_directory_is_mergeable(addon: &AddonView) -> bool {
    let tls_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_TLS);
    if tls_dir.size == 0 && tls_dir.virtual_address == 0 {
        return true;
    }
    const TLS_DIR64_SIZE: u32 = 40; // IMAGE_TLS_DIRECTORY64
    if tls_dir.size < TLS_DIR64_SIZE {
        return false;
    }
    let Ok(dir) = addon.slice_at_rva(tls_dir.virtual_address, TLS_DIR64_SIZE) else {
        return false;
    };
    let raw_start = read_u64_le(dir, 0);
    let raw_end = read_u64_le(dir, 8);
    let zero_fill = read_u32_le(dir, 32);
    raw_end == raw_start && zero_fill == 0
}

fn section_final_protect(ch: u32) -> u32 {
    let x = ch & IMAGE_SCN_MEM_EXECUTE != 0;
    let w = ch & IMAGE_SCN_MEM_WRITE != 0;
    if x && w {
        return PAGE_EXECUTE_READWRITE;
    }
    if x {
        return PAGE_EXECUTE_READ;
    }
    if w {
        return PAGE_READWRITE;
    }
    PAGE_READONLY
}

fn read_u16_le(b: &[u8], off: usize) -> u16 {
    u16::from_le_bytes(
        b[off..off + 2]
            .try_into()
            .expect("infallible: size matches"),
    )
}

fn read_u32_le(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(
        b[off..off + 4]
            .try_into()
            .expect("infallible: size matches"),
    )
}

fn read_u64_le(b: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(
        b[off..off + 8]
            .try_into()
            .expect("infallible: size matches"),
    )
}

impl PEFile {
    /// `Ok(None)`: not merged (malformed or unsupported, see LinkedNodeModule.rs); the addon then
    /// takes the tempfile path. `exception_handler`: RVA of `LINKED_ADDON_EXCEPTION_HANDLER`, or 0.
    pub fn add_linked_addon(
        &mut self,
        addon_bytes: &[u8],
        addon_index: u32,
        virtual_path: &[u8],
        exception_handler: u32,
    ) -> Result<Option<LinkedAddon>, Error> {
        let Ok(addon) = AddonView::init(addon_bytes) else {
            return Ok(None);
        };

        // SAFETY: pointer from get_pe_header is bounds-checked into self.data.
        let host_machine = unsafe { (*self.get_pe_header_mut()?).machine };
        if addon.pe.machine != host_machine {
            return Ok(None);
        }
        if !tls_directory_is_mergeable(&addon) {
            return Ok(None);
        }
        const IMAGE_FILE_RELOCS_STRIPPED: u16 = 0x0001;
        if addon.pe.characteristics & IMAGE_FILE_RELOCS_STRIPPED != 0 {
            return Ok(None);
        }

        // SAFETY: pointer from get_optional_header is bounds-checked into self.data.
        let host_opt = unsafe { ptr::read_unaligned(self.get_optional_header_mut()?) };
        let preferred_base = host_opt.image_base;

        // This section plus the `.bunL` and `.bun` sections appended after the addons.
        self.reserve_section_headers(3, host_opt.file_alignment)?;
        let place = self.next_section_placement()?;
        let rva_base = place.va;
        let addon_image = addon.opt.size_of_image;
        let entry_rva = addon.opt.address_of_entry_point;
        if entry_rva != 0 && entry_rva >= addon_image {
            return Ok(None);
        }
        // The unwind appendix (`UnwindPatcher::appendix`) starts at SizeOfImage and holds
        // UNWIND_INFO records, which must be 4-byte aligned.
        if addon_image == 0 || addon_image > MAX_ADDON_IMAGE_SIZE || !addon_image.is_multiple_of(4)
        {
            return Ok(None);
        }
        // Several Windows structures hold RVAs as i32, so bun.exe's SizeOfImage must stay below 2 GiB.
        if rva_base as u64 + addon_image as u64 > i32::MAX as u64 {
            return Ok(None);
        }

        // Lay the addon out as the loader would, so the section maps directly as its image.
        let mut image = vec![0u8; addon_image as usize];

        let mut section_infos: Vec<LinkedSectionInfo> = Vec::new();

        for s in addon.sections {
            if s.virtual_address >= addon_image {
                return Ok(None);
            }
            if s.size_of_raw_data > 0
                && s.pointer_to_raw_data as u64 + s.size_of_raw_data as u64
                    > addon_bytes.len() as u64
            {
                return Ok(None);
            }
            let copy_len = s.size_of_raw_data.min(addon_image - s.virtual_address);
            if copy_len > 0 {
                image[s.virtual_address as usize..][..copy_len as usize].copy_from_slice(
                    &addon_bytes[s.pointer_to_raw_data as usize..][..copy_len as usize],
                );
            }
            let vs = s.virtual_size.max(s.size_of_raw_data);
            if vs == 0 {
                continue;
            }
            section_infos.push(LinkedSectionInfo {
                rva: rva_base + s.virtual_address,
                size: vs.min(addon_image - s.virtual_address),
                final_protect: section_final_protect(s.characteristics),
            });
        }

        let build_delta = (preferred_base.wrapping_add(rva_base as u64) as i64)
            .wrapping_sub(addon.opt.image_base as i64);
        let Some(relocs) = rebase_relocs(&addon, &mut image, rva_base, build_delta) else {
            return Ok(None);
        };

        let mut imports: Vec<LinkedImportLib> = Vec::new();
        for delay in [false, true] {
            if collect_imports(&addon, &mut imports, &mut image, rva_base, delay).is_none() {
                return Ok(None);
            }
        }

        let Some(function_table) =
            collect_function_table(&addon, &mut image, rva_base, exception_handler)
        else {
            return Ok(None);
        };
        image.extend_from_slice(&function_table.appendix);
        let Ok(section_size) = u32::try_from(image.len()) else {
            return Ok(None);
        };
        if rva_base as u64 + section_size as u64 > i32::MAX as u64 {
            return Ok(None);
        }

        let mut exports = LinkedExports::default();
        scan_exports(&addon, |name, fn_rva| match name {
            b"napi_register_module_v1" => exports.register = rva_base + fn_rva,
            b"node_api_module_get_api_version_v1" => exports.api_version = rva_base + fn_rva,
            _ => {}
        });

        // RW on disk; the runtime applies each section's `final_protect` once it has patched it.
        let characteristics =
            IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_WRITE;
        self.append_section(
            place,
            addon_section_name(addon_index),
            characteristics,
            &image,
        )?;

        Ok(Some(LinkedAddon {
            name: virtual_path.to_vec(),
            rva_base,
            image_size: addon_image,
            section_size,
            entry_point: if entry_rva != 0 {
                rva_base + entry_rva
            } else {
                0
            },
            preferred_base,
            sections: section_infos,
            relocs,
            imports,
            function_table: function_table.entries,
            handlers: function_table.handlers,
            export_register: exports.register,
            export_api_version: exports.api_version,
        }))
    }

    /// RVA of a named export of this image, if any.
    pub fn export_rva(&self, wanted: &[u8]) -> Option<u32> {
        let view = AddonView::init(&self.data).ok()?;
        let mut found = None;
        scan_exports(&view, |name, rva| {
            if name == wanted {
                found = Some(rva);
            }
        });
        found
    }

    /// Appends `.bunL`: `[u64 len][blob]` (see `serialize_linked_addons`), then a copy of the exe's
    /// exception directory with the addons' entries appended, which the directory is re-pointed at.
    pub fn add_linked_addon_section(&mut self, addons: &[LinkedAddon]) -> Result<(), Error> {
        // SAFETY: pointers from get_pe_header/get_optional_header are bounds-checked into self.data.
        let (machine, file_alignment) = unsafe {
            (
                (*self.get_pe_header_mut()?).machine,
                (*self.get_optional_header_mut()?).file_alignment,
            )
        };
        // This section plus the `.bun` section that follows it.
        self.reserve_section_headers(2, file_alignment)?;
        let place = self.next_section_placement()?;

        let blob = serialize_linked_addons(addons);
        let mut payload = Vec::with_capacity(blob.len() + 8);
        payload.extend_from_slice(&(blob.len() as u64).to_le_bytes());
        payload.extend_from_slice(&blob);

        let mut table = self.host_function_table(machine)?;
        let host_table_len = table.len();
        let entry_size = function_table_entry_size(machine);
        for a in addons {
            if a.function_table.is_empty() {
                continue;
            }
            // Windows binary-searches the directory: appending is only valid above its last entry.
            if table.len() >= entry_size
                && read_u32_le(&a.function_table, 0)
                    <= read_u32_le(&table, table.len() - entry_size)
            {
                return Err(Error::BadFunctionTable);
            }
            table.extend_from_slice(&a.function_table);
        }
        let mut directory = None;
        if table.len() > host_table_len {
            while payload.len() % 4 != 0 {
                payload.push(0);
            }
            let table_rva = place.va + u32::try_from(payload.len()).map_err(|_| Error::Overflow)?;
            let table_size = u32::try_from(table.len()).map_err(|_| Error::Overflow)?;
            payload.extend_from_slice(&table);
            directory = Some((table_rva, table_size));
        }

        let characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ;
        self.append_section(place, BUNL_SECTION_NAME, characteristics, &payload)?;

        if let Some((virtual_address, size)) = directory {
            let opt = self.get_optional_header_mut()?;
            // SAFETY: opt points into self.data at validated offset.
            unsafe {
                let dd =
                    ptr::addr_of_mut!((*opt).data_directories[IMAGE_DIRECTORY_ENTRY_EXCEPTION]);
                (*dd).virtual_address = virtual_address;
                (*dd).size = size;
            }
        }
        Ok(())
    }

    /// A copy of this image's exception directory entries (empty when it has none).
    fn host_function_table(&self, machine: u16) -> Result<Vec<u8>, Error> {
        let view = AddonView::init(&self.data)?;
        let dir = view.dir(IMAGE_DIRECTORY_ENTRY_EXCEPTION);
        if dir.size == 0 {
            return Ok(Vec::new());
        }
        if !(dir.size as usize).is_multiple_of(function_table_entry_size(machine)) {
            return Err(Error::BadFunctionTable);
        }
        Ok(view.slice_at_rva(dir.virtual_address, dir.size)?.to_vec())
    }

    /// The RVA and file offset the next appended section will occupy.
    fn next_section_placement(&self) -> Result<SectionPlacement, Error> {
        // SAFETY: bounds-checked by view_at_const; OptionalHeader64 is packed POD.
        let opt = unsafe {
            ptr::read_unaligned(view_at_const::<OptionalHeader64>(
                &self.data,
                self.optional_header_offset,
            )?)
        };
        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;
        for s in self.get_section_headers()? {
            last_file_end = last_file_end.max(s.pointer_to_raw_data + s.size_of_raw_data);
            let vs = s.virtual_size.max(s.size_of_raw_data);
            last_va_end =
                last_va_end.max(s.virtual_address + align_up_u32(vs, opt.section_alignment)?);
        }
        Ok(SectionPlacement {
            va: align_up_u32(last_va_end, opt.section_alignment)?,
            raw: align_up_u32(last_file_end, opt.file_alignment)?,
        })
    }

    /// Appends `payload` at `place.va` (still the next free placement); strips any signature first.
    fn append_section(
        &mut self,
        place: SectionPlacement,
        name: [u8; 8],
        characteristics: u32,
        payload: &[u8],
    ) -> Result<(), Error> {
        self.strip_authenticode()?;

        // SAFETY: pointer from get_optional_header is bounds-checked into self.data.
        let opt = unsafe { ptr::read_unaligned(self.get_optional_header_mut()?) };
        let virtual_size = u32::try_from(payload.len()).map_err(|_| Error::Overflow)?;
        let raw_size = align_up_u32(virtual_size, opt.file_alignment)?;
        let size_of_image = align_up_u32(
            place.va.checked_add(virtual_size).ok_or(Error::Overflow)?,
            opt.section_alignment,
        )?;
        self.reserve_section_headers(1, opt.file_alignment)?;
        // Reserving may have moved the raw data; the address side of `place` is unaffected.
        let raw = self.next_section_placement()?.raw;
        debug_assert_eq!(self.next_section_placement()?.va, place.va);

        let new_file_size = raw as usize + raw_size as usize;
        self.data.resize(new_file_size, 0);
        self.data[raw as usize..new_file_size].fill(0);
        self.data[raw as usize..][..payload.len()].copy_from_slice(payload);

        let sh = SectionHeader {
            name,
            virtual_size,
            virtual_address: place.va,
            size_of_raw_data: raw_size,
            pointer_to_raw_data: raw,
            pointer_to_relocations: 0,
            pointer_to_line_numbers: 0,
            number_of_relocations: 0,
            number_of_line_numbers: 0,
            characteristics,
        };
        let sh_off =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        // SAFETY: SectionHeader is #[repr(C, packed)] POD, so viewing it as bytes is sound.
        let sh_bytes = unsafe {
            slice::from_raw_parts((&raw const sh).cast::<u8>(), size_of::<SectionHeader>())
        };
        self.data[sh_off..sh_off + size_of::<SectionHeader>()].copy_from_slice(sh_bytes);

        let pe_hdr = self.get_pe_header_mut()?;
        // SAFETY: pe_hdr points into self.data at validated offset.
        unsafe {
            (*pe_hdr).number_of_sections += 1;
        }
        self.num_sections += 1;

        let opt_after = self.get_optional_header_mut()?;
        // SAFETY: opt_after points into self.data at validated offset.
        unsafe {
            (*opt_after).size_of_image = size_of_image;
        }
        Ok(())
    }

    /// The in-memory image, for the `bun:internal-for-testing` hook.
    pub fn as_bytes(&self) -> &[u8] {
        &self.data
    }

    /// Test hook: checks headers, section raw ranges (in bounds, disjoint) and `SizeOfImage`.
    pub fn validate(&mut self) -> Result<(), Error> {
        let pe_header = self.get_pe_header_mut()?;
        // SAFETY: pe_header points into self.data at validated offset.
        if unsafe { (*pe_header).signature } != PE_SIGNATURE {
            return Err(Error::InvalidPESignature);
        }

        let optional_header = self.get_optional_header_mut()?;
        // SAFETY: optional_header points into self.data at validated offset;
        // read_unaligned copies the packed struct out so no reference to
        // packed fields is formed.
        let optional_header = unsafe { ptr::read_unaligned(optional_header) };
        if optional_header.magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(Error::UnsupportedPEFormat);
        }
        if !is_pow2(optional_header.file_alignment) || !is_pow2(optional_header.section_alignment) {
            return Err(Error::BadAlignment);
        }
        if optional_header.section_alignment < 4096
            && optional_header.file_alignment != optional_header.section_alignment
        {
            return Err(Error::InvalidPEFile);
        }

        let section_headers_end =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        if section_headers_end > optional_header.size_of_headers as usize
            || section_headers_end > self.data.len()
        {
            return Err(Error::InvalidPEFile);
        }

        let file_len = self.data.len();
        let section_headers = self.get_section_headers()?;
        let mut max_va_end: u32 = 0;
        for (i, section) in section_headers.iter().enumerate() {
            if section.size_of_raw_data > 0 {
                let raw_end = section.pointer_to_raw_data as u64 + section.size_of_raw_data as u64;
                if section.pointer_to_raw_data < optional_header.size_of_headers
                    || raw_end > file_len as u64
                {
                    return Err(Error::InvalidSectionData);
                }
                for other in &section_headers[i + 1..] {
                    if other.size_of_raw_data == 0 {
                        continue;
                    }
                    let other_end =
                        other.pointer_to_raw_data as u64 + other.size_of_raw_data as u64;
                    if (section.pointer_to_raw_data as u64).max(other.pointer_to_raw_data as u64)
                        < raw_end.min(other_end)
                    {
                        return Err(Error::InvalidPEFile);
                    }
                }
            }
            let vs_effective = section.virtual_size.max(section.size_of_raw_data);
            let va_end = section.virtual_address
                + align_up_u32(vs_effective, optional_header.section_alignment)?;
            max_va_end = max_va_end.max(va_end);
        }

        let expected = align_up_u32(max_va_end, optional_header.section_alignment)?;
        if optional_header.size_of_image != expected {
            return Err(Error::SizeOfImageMismatch);
        }

        // SAFETY: pe_header points into self.data at validated offset.
        let machine = unsafe { (*self.get_pe_header_mut()?).machine };
        let table = self.host_function_table(machine)?;
        let entry_size = function_table_entry_size(machine);
        let mut previous_begin: Option<u32> = None;
        for entry in table.chunks_exact(entry_size) {
            let begin = read_u32_le(entry, 0);
            if previous_begin.is_some_and(|previous| begin <= previous)
                || begin >= optional_header.size_of_image
                || (entry_size == 12 && read_u32_le(entry, 4) <= begin)
            {
                return Err(Error::BadFunctionTable);
            }
            previous_begin = Some(begin);
        }
        Ok(())
    }
}

/// Applies `build_delta` to `image`'s DIR64 slots; returns the reloc blocks rebased by `rva_base`.
fn rebase_relocs(
    addon: &AddonView,
    image: &mut [u8],
    rva_base: u32,
    build_delta: i64,
) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    let dir = addon.dir(IMAGE_DIRECTORY_ENTRY_BASERELOC);
    if dir.size == 0 {
        return Some(out);
    }
    let blocks = addon.slice_at_rva(dir.virtual_address, dir.size).ok()?;
    let image_size = u32::try_from(image.len()).ok()?;
    let mut off: usize = 0;
    while off + IMAGE_BASE_RELOCATION_SIZE as usize <= blocks.len() {
        let page_rva = read_u32_le(blocks, off);
        let block_size = read_u32_le(blocks, off + 4);
        if block_size == 0 && page_rva == 0 {
            break; // some linkers terminate the table with an empty block
        }
        if block_size < IMAGE_BASE_RELOCATION_SIZE
            || off + block_size as usize > blocks.len()
            || page_rva >= image_size
        {
            return None;
        }
        out.extend_from_slice(&(rva_base + page_rva).to_le_bytes());
        out.extend_from_slice(&block_size.to_le_bytes());
        for i in 0..((block_size - IMAGE_BASE_RELOCATION_SIZE) / 2) as usize {
            let entry = read_u16_le(blocks, off + IMAGE_BASE_RELOCATION_SIZE as usize + i * 2);
            out.extend_from_slice(&entry.to_le_bytes());
            match entry >> 12 {
                IMAGE_REL_BASED_ABSOLUTE => continue, // padding
                IMAGE_REL_BASED_DIR64 => {}
                _ => return None,
            }
            let target = (page_rva + (entry & 0x0FFF) as u32) as usize;
            let slot = image.get_mut(target..target + 8)?;
            let old = u64::from_le_bytes(slot.try_into().expect("infallible: size matches"));
            slot.copy_from_slice(&((old as i64).wrapping_add(build_delta) as u64).to_le_bytes());
        }
        off += block_size as usize;
    }
    Some(out)
}

/// Records one import directory into `out`, zeroing its IAT slots in `image`; `None`: cannot merge.
fn collect_imports(
    addon: &AddonView,
    out: &mut Vec<LinkedImportLib>,
    image: &mut [u8],
    rva_base: u32,
    delay: bool,
) -> Option<()> {
    let (desc_size, dir_idx, name_off, iat_off, ilt_off) = if delay {
        // IMAGE_DELAYLOAD_DESCRIPTOR: Attributes, DllNameRVA, ModuleHandleRVA, IAT RVA, INT RVA, ...
        (
            IMAGE_DELAYLOAD_DESCRIPTOR_SIZE,
            IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT,
            4,
            12,
            16,
        )
    } else {
        // IMAGE_IMPORT_DESCRIPTOR: OriginalFirstThunk, TimeDateStamp, ForwarderChain, Name, FirstThunk
        (
            IMAGE_IMPORT_DESCRIPTOR_SIZE,
            IMAGE_DIRECTORY_ENTRY_IMPORT,
            12,
            16,
            0,
        )
    };
    let dir = addon.dir(dir_idx);
    if dir.size == 0 || dir.virtual_address == 0 {
        return Some(());
    }

    // Both walks stop at a zero terminator but are bounded in case a hostile table has none.
    let max_descs = (dir.size / desc_size).saturating_add(1);
    let max_thunks = (addon.opt.size_of_image / 8).saturating_add(1);

    for desc_index in 0..max_descs {
        let desc_rva = dir
            .virtual_address
            .saturating_add(desc_index.saturating_mul(desc_size));
        let desc = addon.slice_at_rva(desc_rva, desc_size).ok()?;
        let name_rva = read_u32_le(desc, name_off);
        if name_rva == 0 {
            return Some(());
        }
        let dll_name = addon.cstr_at_rva(name_rva).ok()?;
        // Only the RVA form of the delay-load descriptor (attribute bit 0) is supported.
        if delay && read_u32_le(desc, 0) & 1 == 0 {
            return None;
        }
        let iat_rva = read_u32_le(desc, iat_off);
        let mut ilt_rva = read_u32_le(desc, ilt_off);
        if ilt_rva == 0 && !delay {
            ilt_rva = iat_rva; // some linkers omit the import lookup table
        }
        if ilt_rva == 0 || iat_rva == 0 {
            return None;
        }

        let mut entries: Vec<LinkedImportEntry> = Vec::new();
        let mut terminated = false;
        for idx in 0..max_thunks {
            let thunk_rva = ilt_rva.saturating_add(idx.saturating_mul(8));
            let thunk = read_u64_le(addon.slice_at_rva(thunk_rva, 8).ok()?, 0);
            if thunk == 0 {
                terminated = true;
                break;
            }
            let slot_rva = iat_rva.saturating_add(idx.saturating_mul(8));
            let slot = slot_rva as usize;
            image.get_mut(slot..slot + 8)?.fill(0);

            if thunk & IMAGE_ORDINAL_FLAG64 != 0 {
                entries.push(LinkedImportEntry {
                    iat_rva: rva_base + slot_rva,
                    ordinal: (thunk & 0xFFFF) as u16,
                    name: Vec::new(),
                });
                continue;
            }
            // IMAGE_IMPORT_BY_NAME RVA (u16 hint, then the name); the upper bits are reserved.
            if thunk >> 31 != 0 {
                return None;
            }
            let name = addon.cstr_at_rva((thunk as u32).saturating_add(2)).ok()?;
            // The CRT DLL's throw would resolve types at bun.exe's base; see LinkedNodeModule.rs.
            if name == b"_CxxThrowException" {
                return None;
            }
            entries.push(LinkedImportEntry {
                iat_rva: rva_base + slot_rva,
                ordinal: 0,
                name: name.to_vec(),
            });
        }
        if !terminated {
            return None;
        }
        out.push(LinkedImportLib {
            name: dll_name.to_vec(),
            is_host: is_host_import(dll_name),
            entries,
        });
    }
    None // the directory is not terminated within the size it declares
}

#[derive(Default)]
struct LinkedExports {
    register: u32,
    api_version: u32,
}

/// Calls `f(name, rva)` for each named export whose RVA lies inside the image.
fn scan_exports(view: &AddonView, mut f: impl FnMut(&[u8], u32)) {
    let dir = view.dir(IMAGE_DIRECTORY_ENTRY_EXPORT);
    if dir.size < IMAGE_EXPORT_DIRECTORY_SIZE {
        return;
    }
    let Ok(table) = view.slice_at_rva(dir.virtual_address, IMAGE_EXPORT_DIRECTORY_SIZE) else {
        return;
    };
    // IMAGE_EXPORT_DIRECTORY: ..., NumberOfFunctions@20, NumberOfNames@24, then the three arrays.
    let n_funcs = read_u32_le(table, 20);
    let n_names = read_u32_le(table, 24);
    let (Ok(funcs), Ok(names), Ok(ords)) = (
        view.slice_at_rva(read_u32_le(table, 28), n_funcs.saturating_mul(4)),
        view.slice_at_rva(read_u32_le(table, 32), n_names.saturating_mul(4)),
        view.slice_at_rva(read_u32_le(table, 36), n_names.saturating_mul(2)),
    ) else {
        return;
    };
    for i in 0..n_names as usize {
        let Ok(name) = view.cstr_at_rva(read_u32_le(names, i * 4)) else {
            continue;
        };
        let ord = read_u16_le(ords, i * 2) as usize;
        if ord >= n_funcs as usize {
            continue;
        }
        let fn_rva = read_u32_le(funcs, ord * 4);
        if fn_rva != 0 && fn_rva < view.opt.size_of_image {
            f(name, fn_rva);
        }
    }
}

/// Rebases the addon's exception-directory entries to bun.exe RVAs and rewrites the unwind infos
/// they name (chained entries rebased, handlers redirected to `trampoline`). `None`: do not merge.
fn collect_function_table(
    addon: &AddonView,
    image: &mut [u8],
    rva_base: u32,
    trampoline: u32,
) -> Option<FunctionTable> {
    let dir = addon.dir(IMAGE_DIRECTORY_ENTRY_EXCEPTION);
    if dir.size == 0 {
        return Some(FunctionTable::default());
    }
    let arm64 = addon.pe.machine == IMAGE_FILE_MACHINE_ARM64;
    let entry_size = function_table_entry_size(addon.pe.machine);
    let start = dir.virtual_address as usize;
    let end = start.checked_add(dir.size as usize)?;
    if !(dir.size as usize).is_multiple_of(entry_size) || end > image.len() {
        return None;
    }
    let mut patcher = UnwindPatcher {
        rva_base,
        trampoline,
        visited: BTreeMap::new(),
        appendix: Vec::new(),
        appendix_rva: u32::try_from(image.len()).ok()?,
    };
    let mut table: Vec<u8> = Vec::with_capacity(dir.size as usize);
    let mut previous_begin: Option<u32> = None;
    for off in (start..end).step_by(entry_size) {
        let begin = read_u32_le(image, off);
        // Windows binary-searches the table, and this one ends up inside bun.exe's own.
        if previous_begin.is_some_and(|previous| begin <= previous) || begin >= image.len() as u32 {
            return None;
        }
        previous_begin = Some(begin);
        table.extend_from_slice(&(begin + rva_base).to_le_bytes());
        if arm64 {
            let unwind = read_u32_le(image, off + 4);
            if unwind & 3 != 0 {
                // Packed unwind data: encoded in place, nothing else to rebase.
                table.extend_from_slice(&unwind.to_le_bytes());
            } else {
                patcher.patch_arm64(image, unwind)?;
                table.extend_from_slice(&(unwind + rva_base).to_le_bytes());
            }
        } else {
            let function_end = read_u32_le(image, off + 4);
            let unwind = read_u32_le(image, off + 8);
            // Bit 0: indirect entry (UnwindData names a RUNTIME_FUNCTION); toolchains emit none.
            if function_end <= begin || function_end > image.len() as u32 || unwind & 1 != 0 {
                return None;
            }
            patcher.patch_x64(image, unwind, 0)?;
            table.extend_from_slice(&(function_end + rva_base).to_le_bytes());
            table.extend_from_slice(&(unwind + rva_base).to_le_bytes());
        }
    }
    Some(patcher.finish(table))
}

#[derive(Default)]
struct FunctionTable {
    /// The exception-directory entries rebased to bun.exe RVAs.
    entries: Vec<u8>,
    handlers: Vec<HandlerRedirect>,
    /// Appended to the addon's image: see `UnwindPatcher::appendix`.
    appendix: Vec<u8>,
}

/// ntdll gives up unwinding a frame after following this many chained unwind infos.
const UNWIND_CHAIN_LIMIT: u32 = 32;

/// What `patch_x64` / `patch_arm64` made of one unwind info.
#[derive(Copy, Clone)]
struct Patched {
    /// The exception handler its chain ends in, if any.
    handler: Option<u32>,
    /// Addon RVA of the record the trampoline hands the handler: the record itself, or for a
    /// chained record its copy in the appendix.
    view: u32,
}

struct UnwindPatcher {
    rva_base: u32,
    trampoline: u32,
    /// Keyed by the addon RVA of each unwind info rewritten so far, which is also how the table
    /// entries name it.
    visited: BTreeMap<u32, Patched>,
    /// A chained record is read both by Windows, against bun.exe's base, when it looks a frame up,
    /// and by code that sees the frame through the trampoline, against the addon's base: its own
    /// handler during a collided unwind, or a C++ frame handler walking to the primary function.
    /// The record in the image serves the first; this holds a copy per chained record with the
    /// embedded entry left addon-relative for the second. Laid out after the image in `.bnN`.
    appendix: Vec<u8>,
    /// Addon RVA at which `appendix` begins (the addon's `SizeOfImage`).
    appendix_rva: u32,
}

impl UnwindPatcher {
    fn finish(self, entries: Vec<u8>) -> FunctionTable {
        let mut handlers = Vec::new();
        for (unwind_info, patched) in &self.visited {
            let Some(handler) = patched.handler else {
                continue;
            };
            let handler = handler + self.rva_base;
            handlers.push(HandlerRedirect {
                unwind_info: unwind_info + self.rva_base,
                handler,
                view: patched.view,
            });
            if patched.view != *unwind_info {
                // Windows re-dispatches a collided unwind with the entry the trampoline presented,
                // so the copy has to resolve as well.
                handlers.push(HandlerRedirect {
                    unwind_info: patched.view + self.rva_base,
                    handler,
                    view: patched.view,
                });
            }
        }
        handlers.sort_unstable_by_key(|h| h.unwind_info);
        FunctionTable {
            entries,
            handlers,
            appendix: self.appendix,
        }
    }

    /// Points the handler RVA stored at `field` at the trampoline; returns the displaced handler.
    fn redirect(&mut self, image: &mut [u8], field: usize) -> Option<u32> {
        let handler = read_u32_le(image.get(field..field + 4)?, 0);
        if handler >= image.len() as u32 || self.trampoline == 0 {
            return None;
        }
        image[field..field + 4].copy_from_slice(&self.trampoline.to_le_bytes());
        Some(handler)
    }

    /// x64 UNWIND_INFO: version:3/flags:5, prolog size, code count, frame register, then the codes
    /// (padded to an even count), then either the chained RUNTIME_FUNCTION or the handler RVA.
    /// `None` if the data is malformed.
    fn patch_x64(&mut self, image: &mut [u8], unwind_rva: u32, depth: u32) -> Option<Patched> {
        const UNW_FLAG_EHANDLER: u8 = 1;
        const UNW_FLAG_UHANDLER: u8 = 2;
        const UNW_FLAG_CHAININFO: u8 = 4;
        if let Some(&patched) = self.visited.get(&unwind_rva) {
            return Some(patched);
        }
        if depth > UNWIND_CHAIN_LIMIT {
            return None;
        }
        let at = unwind_rva as usize;
        let head = image.get(at..at + 4)?;
        let (version, flags, code_count) = (head[0] & 7, head[0] >> 3, head[2] as usize);
        if version != 1 && version != 2 {
            return None;
        }
        let tail = at + 4 + (code_count + (code_count & 1)) * 2;
        let patched = if flags & UNW_FLAG_CHAININFO != 0 {
            let chained = image.get(tail..tail + 12)?;
            let (begin, end, unwind) = (
                read_u32_le(chained, 0),
                read_u32_le(chained, 4),
                read_u32_le(chained, 8),
            );
            if end <= begin || end > image.len() as u32 || unwind & 1 != 0 {
                return None;
            }
            let target = self.patch_x64(image, unwind, depth + 1)?;
            let view = if target.handler.is_some() {
                self.copy_chained(&image[at..tail], begin, end, target.view)?
            } else {
                unwind_rva // never presented: the chain has no handler to forward to
            };
            for (i, value) in [begin, end, unwind].into_iter().enumerate() {
                let field = tail + i * 4;
                image[field..field + 4].copy_from_slice(&(value + self.rva_base).to_le_bytes());
            }
            Patched {
                handler: target.handler,
                view,
            }
        } else {
            let handler = if flags & (UNW_FLAG_EHANDLER | UNW_FLAG_UHANDLER) != 0 {
                Some(self.redirect(image, tail)?)
            } else {
                None
            };
            Patched {
                handler,
                view: unwind_rva,
            }
        };
        self.visited.insert(unwind_rva, patched);
        Some(patched)
    }

    /// Appends a copy of a chained record (`head_and_codes` followed by the embedded entry, all
    /// addon-relative) and returns the addon RVA of the copy.
    fn copy_chained(
        &mut self,
        head_and_codes: &[u8],
        begin: u32,
        end: u32,
        view: u32,
    ) -> Option<u32> {
        debug_assert!(
            head_and_codes.len().is_multiple_of(4) && self.appendix_rva.is_multiple_of(4)
        );
        let offset = u32::try_from(self.appendix.len()).ok()?;
        let rva = self.appendix_rva.checked_add(offset)?;
        self.appendix.extend_from_slice(head_and_codes);
        for value in [begin, end, view] {
            self.appendix.extend_from_slice(&value.to_le_bytes());
        }
        Some(rva)
    }

    /// ARM64 .xdata: header word (X at bit 20, E at bit 21, epilog count and code words above),
    /// optional extension word, epilog scopes unless E, the code words, then the handler RVA if X.
    fn patch_arm64(&mut self, image: &mut [u8], xdata_rva: u32) -> Option<()> {
        if self.visited.contains_key(&xdata_rva) {
            return Some(());
        }
        let at = xdata_rva as usize;
        let header = read_u32_le(image.get(at..at + 4)?, 0);
        if (header >> 18) & 3 != 0 {
            return None; // unknown version
        }
        let has_handler = (header >> 20) & 1 != 0;
        let single_epilog = (header >> 21) & 1 != 0;
        let (mut epilog_count, mut code_words) = ((header >> 22) & 0x1F, header >> 27);
        let mut pos = at + 4;
        if epilog_count == 0 && code_words == 0 {
            let extension = read_u32_le(image.get(pos..pos + 4)?, 0);
            epilog_count = extension & 0xFFFF;
            code_words = (extension >> 16) & 0xFF;
            pos += 4;
        }
        if !single_epilog {
            pos += epilog_count as usize * 4;
        }
        pos += code_words as usize * 4;
        let handler = if has_handler {
            Some(self.redirect(image, pos)?)
        } else {
            None
        };
        self.visited.insert(
            xdata_rva,
            Patched {
                handler,
                view: xdata_rva,
            },
        );
        Some(())
    }
}

/// `.bn0`, `.bn1`, ... (the section cap keeps the index to two digits).
fn addon_section_name(index: u32) -> [u8; 8] {
    let mut name = *b".bn\0\0\0\0\0";
    let digits = index.to_string();
    let n = digits.len().min(name.len() - 3);
    name[3..3 + n].copy_from_slice(&digits.as_bytes()[..n]);
    name
}

pub const LINKED_MAGIC: u32 = 0x4B4E_4C42; // 'BLNK'
pub const LINKED_VERSION: u32 = 3;
/// Bytes per addon in the index that follows the blob header.
pub const LINKED_INDEX_ENTRY_SIZE: usize = 16;
/// Bytes per `HandlerRedirect` in an addon's handler list.
pub const LINKED_HANDLER_ENTRY_SIZE: usize = 12;

/// `.bunL` blob, read back by LinkedNodeModule.rs. All integers little-endian, strings u32-length
/// prefixed:
///   header      magic, version, addon count
///   index       per addon: rva_base, section_size, blob offset of its handler list, handler count
///               (fixed size, so the exception trampoline can search it without parsing the rest)
///   records     per addon: name, rva_base, image_size, entry_point, preferred_base (u64),
///               export_register, export_api_version, sections (count, then rva/size/protect),
///               relocs (as a string), imports (count, then name, is_host byte, entries of
///               iat_rva, u16 ordinal, name)
///   handlers    per addon: `HandlerRedirect` triples (unwind_info, handler, view), sorted
pub fn serialize_linked_addons(addons: &[LinkedAddon]) -> Vec<u8> {
    fn w_u32(b: &mut Vec<u8>, v: u32) {
        b.extend_from_slice(&v.to_le_bytes());
    }
    fn w_str(b: &mut Vec<u8>, s: &[u8]) {
        w_u32(b, u32::try_from(s.len()).expect("int cast"));
        b.extend_from_slice(s);
    }
    fn w_len(b: &mut Vec<u8>, n: usize) {
        w_u32(b, u32::try_from(n).expect("int cast"));
    }

    let mut records: Vec<u8> = Vec::new();
    for a in addons {
        w_str(&mut records, &a.name);
        w_u32(&mut records, a.rva_base);
        w_u32(&mut records, a.image_size);
        w_u32(&mut records, a.entry_point);
        records.extend_from_slice(&a.preferred_base.to_le_bytes());
        w_u32(&mut records, a.export_register);
        w_u32(&mut records, a.export_api_version);
        w_len(&mut records, a.sections.len());
        for s in &a.sections {
            w_u32(&mut records, s.rva);
            w_u32(&mut records, s.size);
            w_u32(&mut records, s.final_protect);
        }
        w_str(&mut records, &a.relocs);
        w_len(&mut records, a.imports.len());
        for lib in &a.imports {
            w_str(&mut records, &lib.name);
            records.push(lib.is_host as u8);
            w_len(&mut records, lib.entries.len());
            for e in &lib.entries {
                w_u32(&mut records, e.iat_rva);
                records.extend_from_slice(&e.ordinal.to_le_bytes());
                w_str(&mut records, &e.name);
            }
        }
    }

    let mut buf: Vec<u8> = Vec::new();
    w_u32(&mut buf, LINKED_MAGIC);
    w_u32(&mut buf, LINKED_VERSION);
    w_len(&mut buf, addons.len());
    let mut handlers_offset = buf.len() + addons.len() * LINKED_INDEX_ENTRY_SIZE + records.len();
    for a in addons {
        w_u32(&mut buf, a.rva_base);
        w_u32(&mut buf, a.section_size);
        w_len(&mut buf, handlers_offset);
        w_len(&mut buf, a.handlers.len());
        handlers_offset += a.handlers.len() * LINKED_HANDLER_ENTRY_SIZE;
    }
    buf.extend_from_slice(&records);
    for a in addons {
        for h in &a.handlers {
            w_u32(&mut buf, h.unwind_info);
            w_u32(&mut buf, h.handler);
            w_u32(&mut buf, h.view);
        }
    }
    buf
}

pub fn is_pe(data: &[u8]) -> bool {
    if data.len() < size_of::<DOSHeader>() {
        return false;
    }
    // SAFETY: length checked above; DOSHeader is packed POD.
    let dos = unsafe { ptr::read_unaligned(data.as_ptr().cast::<DOSHeader>()) };
    if dos.e_magic != DOS_SIGNATURE {
        return false;
    }
    let off = dos.e_lfanew as usize;
    if off < size_of::<DOSHeader>() || off > data.len().saturating_sub(size_of::<PEHeader>()) {
        return false;
    }
    // SAFETY: bounds checked above; PEHeader is packed POD.
    let pe = unsafe { ptr::read_unaligned(data.as_ptr().add(off).cast::<PEHeader>()) };
    pe.signature == PE_SIGNATURE
}

// External C interface declarations - these are implemented in C++ bindings
// (src/jsc/bindings/c-bindings.cpp). The C++ code uses Windows PE APIs to
// directly access the .bun section from the current process memory without
// loading the entire executable.
unsafe extern "C" {
    pub fn Bun__getStandaloneModuleGraphPELength() -> u64;
    pub fn Bun__getStandaloneModuleGraphPEData() -> *mut u8;
}

// The running exe's `.bunL` section (length 0 when absent); also in c-bindings.cpp.
unsafe extern "C" {
    pub fn Bun__getLinkedAddonsPELength() -> u64;
    pub fn Bun__getLinkedAddonsPEData() -> *mut u8;
}
