// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

use core::mem::{offset_of, size_of};
use core::ptr;
use core::slice;

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
    #[error("InputIsSigned")]
    InputIsSigned,
    #[error("InvalidSecurityDirectory")]
    InvalidSecurityDirectory,
    #[error("SecurityDirInsideImage")]
    SecurityDirInsideImage,
    #[error("UnexpectedOverlayPresent")]
    UnexpectedOverlayPresent,
    #[error("InvalidSectionData")]
    InvalidSectionData,
    #[error("BunSectionNotFound")]
    BunSectionNotFound,
    #[error("InvalidBunSection")]
    InvalidBunSection,
    #[error("InsufficientSpace")]
    InsufficientSpace,
    #[error("SizeOfImageMismatch")]
    SizeOfImageMismatch,
}

// Enums for strip modes and options
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum StripMode {
    None,
    StripIfSigned,
    StripAlways,
}

#[derive(Copy, Clone)]
pub struct StripOpts {
    pub require_overlay: bool,
    pub recompute_checksum: bool,
}

impl Default for StripOpts {
    fn default() -> Self {
        Self {
            require_overlay: true,
            recompute_checksum: true,
        }
    }
}

/// Windows PE Binary manipulation for codesigning standalone executables
pub struct PEFile {
    pub data: Vec<u8>,
    // Store offsets instead of pointers to avoid invalidation after resize
    pub dos_header_offset: usize,
    pub pe_header_offset: usize,
    pub optional_header_offset: usize,
    pub section_headers_offset: usize,
    pub num_sections: u16,
    // Cached values from init
    pub first_raw: u32,
    pub last_file_end: u32,
    pub last_va_end: u32,
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

const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"
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
const IMAGE_DIRECTORY_ENTRY_TLS: usize = 9;
const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT: usize = 13;
const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

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

// On-disk import/export/relocation structures. Parsed with explicit
// little-endian field reads (not pointer casts) because the addon bytes
// are untrusted input; sizes below are the spec sizes used for bounds
// checks and descriptor-table walking.
const IMAGE_IMPORT_DESCRIPTOR_SIZE: u32 = 20;
const IMAGE_DELAYLOAD_DESCRIPTOR_SIZE: u32 = 32;
const IMAGE_EXPORT_DIRECTORY_SIZE: u32 = 40;
const IMAGE_BASE_RELOCATION_SIZE: u32 = 8;

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
    fn get_dos_header(&self) -> Result<*const DOSHeader, Error> {
        view_at_const::<DOSHeader>(&self.data, self.dos_header_offset)
    }

    fn get_pe_header(&self) -> Result<*const PEHeader, Error> {
        view_at_const::<PEHeader>(&self.data, self.pe_header_offset)
    }

    fn get_pe_header_mut(&mut self) -> Result<*mut PEHeader, Error> {
        view_at_mut::<PEHeader>(&mut self.data, self.pe_header_offset)
    }

    fn get_optional_header(&self) -> Result<*const OptionalHeader64, Error> {
        view_at_const::<OptionalHeader64>(&self.data, self.optional_header_offset)
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
        if num_sections > 96 {
            // PE limit
            return Err(Error::TooManySections);
        }
        let section_headers_size = size_of::<SectionHeader>() * num_sections as usize;
        if data.len() < section_headers_offset + section_headers_size {
            return Err(Error::InvalidPEFile);
        }

        // 7. Precompute first_raw, last_file_end, last_va_end
        let mut first_raw: u32 = u32::try_from(data.len()).expect("int cast");
        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;

        let section_alignment = optional_header.section_alignment;

        if num_sections > 0 {
            for i in 0..num_sections as usize {
                let sh_off = section_headers_offset + i * size_of::<SectionHeader>();
                // SAFETY: `sh_off + size_of::<SectionHeader>()` is within `data` per the
                // `section_headers_offset + section_headers_size <= data.len()` check above.
                let section = unsafe {
                    ptr::read_unaligned(data.as_ptr().add(sh_off).cast::<SectionHeader>())
                };
                if section.size_of_raw_data > 0 {
                    if section.pointer_to_raw_data < first_raw {
                        first_raw = section.pointer_to_raw_data;
                    }
                    let file_end = section.pointer_to_raw_data + section.size_of_raw_data;
                    if file_end > last_file_end {
                        last_file_end = file_end;
                    }
                }
                // Use effective virtual size (max of virtual_size and size_of_raw_data)
                let vs_effective = section.virtual_size.max(section.size_of_raw_data);
                let va_end =
                    section.virtual_address + align_up_u32(vs_effective, section_alignment)?;
                if va_end > last_va_end {
                    last_va_end = va_end;
                }
            }
        }

        Ok(Box::new(PEFile {
            data,
            dos_header_offset: 0,
            pe_header_offset: pe_off,
            optional_header_offset,
            section_headers_offset,
            num_sections,
            first_raw,
            last_file_end,
            last_va_end,
        }))
    }

    // deinit: Drop is automatic — Vec<u8> field freed; Box<PEFile> dropped by caller.

    /// Strip Authenticode signatures from the PE file
    pub fn strip_authenticode(&mut self, opts: StripOpts) -> Result<(), Error> {
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
        if opts.require_overlay && sec_off < last_raw_end as usize {
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
        if opts.recompute_checksum {
            self.recompute_pe_checksum()?;
        }

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

        // Final folds + add length
        sum = (sum & 0xffff) + (sum >> 16);
        sum = (sum & 0xffff) + (sum >> 16);
        sum += u64::try_from(data.len()).expect("int cast");
        sum = (sum & 0xffff) + (sum >> 16);
        let final_sum: u32 = u32::try_from((sum & 0xffff) + (sum >> 16)).expect("int cast");

        let opt = self.get_optional_header_mut()?;
        // SAFETY: opt points into self.data at validated offset
        unsafe {
            (*opt).checksum = final_sum;
        }
        Ok(())
    }

    /// Add a new section to the PE file for storing Bun module data
    pub fn add_bun_section(&mut self, data_to_embed: &[u8], strip: StripMode) -> Result<(), Error> {
        // 1. Optional strip (before any addition)
        if strip == StripMode::StripAlways {
            self.strip_authenticode(StripOpts {
                require_overlay: true,
                recompute_checksum: true,
            })?;
        } else if strip == StripMode::StripIfSigned {
            // Read Security directory to check if signed
            let opt = self.get_optional_header()?;
            // SAFETY: opt points into self.data at validated offset
            let dd = unsafe { (*opt).data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY] };
            if dd.virtual_address != 0 || dd.size != 0 {
                self.strip_authenticode(StripOpts {
                    require_overlay: true,
                    recompute_checksum: true,
                })?;
            }
        }

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

        // Check if we can add another section
        if self.num_sections >= 96 {
            // PE limit
            return Err(Error::TooManySections);
        }

        // 4. Compute header slack requirement
        let new_headers_end = self.section_headers_offset
            + size_of::<SectionHeader>() * (self.num_sections as usize + 1);
        let new_size_of_headers = align_up_u32(
            u32::try_from(new_headers_end).expect("int cast"),
            file_alignment,
        )?;

        // Determine first_raw (min PointerToRawData among sections with raw data, else data.len)
        let mut first_raw: u32 = u32::try_from(self.data.len()).expect("int cast");
        for section in section_headers {
            if section.size_of_raw_data > 0 {
                if section.pointer_to_raw_data < first_raw {
                    first_raw = section.pointer_to_raw_data;
                }
            }
        }

        // Require new_size_of_headers <= first_raw
        if new_size_of_headers > first_raw {
            return Err(Error::InsufficientHeaderSpace);
        }

        // 5. Placement calculations
        // Recompute last_file_end and last_va_end after strip
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

    /// Get the length of the Bun section data
    pub fn get_bun_section_length(&self) -> Result<u64, Error> {
        let section_headers = self.get_section_headers()?;
        for section in section_headers {
            if section.name[0..8] == BUN_SECTION_NAME {
                if (section.size_of_raw_data as usize) < size_of::<u64>() {
                    return Err(Error::InvalidBunSection);
                }

                // Bounds check
                if section.pointer_to_raw_data as usize >= self.data.len()
                    || section.pointer_to_raw_data as usize + size_of::<u64>() > self.data.len()
                {
                    return Err(Error::InvalidBunSection);
                }

                let section_data = &self.data[section.pointer_to_raw_data as usize..];
                return Ok(u64::from_le_bytes(
                    section_data[0..8]
                        .try_into()
                        .expect("infallible: size matches"),
                ));
            }
        }
        Err(Error::BunSectionNotFound)
    }

    /// Write the modified PE file
    pub fn write(&self, writer: &mut impl std::io::Write) -> crate::Result<()> {
        writer.write_all(&self.data)?;
        Ok(())
    }

    /// Validate the PE file structure
    pub fn validate(&self) -> Result<(), Error> {
        // Check DOS & PE signatures
        let dos_header = self.get_dos_header()?;
        // SAFETY: dos_header points into self.data at validated offset
        if unsafe { (*dos_header).e_magic } != DOS_SIGNATURE {
            return Err(Error::InvalidDOSSignature);
        }

        let pe_header = self.get_pe_header()?;
        // SAFETY: pe_header points into self.data at validated offset
        if unsafe { (*pe_header).signature } != PE_SIGNATURE {
            return Err(Error::InvalidPESignature);
        }

        // Check optional header magic is 0x20B (64-bit)
        let optional_header = self.get_optional_header()?;
        // SAFETY: optional_header points into self.data at validated offset
        let optional_header = unsafe { &*optional_header };
        if optional_header.magic != OPTIONAL_HEADER_MAGIC_64 {
            return Err(Error::UnsupportedPEFormat);
        }

        // Validate file_alignment, section_alignment sanity
        if !is_pow2(optional_header.file_alignment) || !is_pow2(optional_header.section_alignment) {
            return Err(Error::BadAlignment);
        }
        // Relational rule
        if optional_header.section_alignment < 4096 {
            if optional_header.file_alignment != optional_header.section_alignment {
                return Err(Error::InvalidPEFile);
            }
        }

        // Section headers region fits within size_of_headers and file
        let section_headers_end =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        if section_headers_end > optional_header.size_of_headers as usize
            || section_headers_end > self.data.len()
        {
            return Err(Error::InvalidPEFile);
        }

        // Validate each section
        let section_headers = self.get_section_headers()?;
        let mut max_va_end: u32 = 0;

        for (i, section) in section_headers.iter().enumerate() {
            // If size_of_raw_data > 0, validate raw data bounds
            if section.size_of_raw_data > 0 {
                if section.pointer_to_raw_data < optional_header.size_of_headers
                    || (section.pointer_to_raw_data + section.size_of_raw_data) as usize
                        > self.data.len()
                {
                    return Err(Error::InvalidSectionData);
                }

                // Check for overlaps with other sections using correct interval test
                for other in &section_headers[i + 1..] {
                    if other.size_of_raw_data > 0 {
                        let section_start = section.pointer_to_raw_data;
                        let section_end = section_start + section.size_of_raw_data;
                        let other_start = other.pointer_to_raw_data;
                        let other_end = other_start + other.size_of_raw_data;
                        // Standard overlap test: max(start) < min(end)
                        if section_start.max(other_start) < section_end.min(other_end) {
                            return Err(Error::InvalidPEFile); // Section raw ranges overlap
                        }
                    }
                }
            }

            // Track max virtual address end using effective virtual size
            let vs_effective = section.virtual_size.max(section.size_of_raw_data);
            let va_end = section.virtual_address
                + align_up_u32(vs_effective, optional_header.section_alignment)?;
            if va_end > max_va_end {
                max_va_end = va_end;
            }
        }

        // Verify size_of_image equals alignUp(max(VA + alignUp(VS, SA)), SA)
        let expected_size_of_image = align_up_u32(max_va_end, optional_header.section_alignment)?;
        if optional_header.size_of_image != expected_size_of_image {
            return Err(Error::SizeOfImageMismatch);
        }

        // Security directory should be 0,0 post-change (if we modified it)
        // (This is optional validation, not critical)

        // If checksum recomputed, field should be non-zero
        // (Unless we intentionally write zero, which is allowed)
        Ok(())
    }
}

/// Everything the runtime needs to finish linking one statically-merged
/// `.node` addon: where it landed, its relocations, its import table, its
/// `.pdata`, and the export RVAs `process.dlopen` resolves.
///
/// All RVAs here are relative to bun.exe's image base. The addon's own
/// preferred base is irrelevant after `add_linked_addon` has applied the
/// build-time delta; only the runtime ASLR delta
/// (`GetModuleHandle(NULL) - preferred_base`) still needs applying.
pub struct LinkedAddon {
    /// `$bunfs/...` virtual path, so runtime can match `process.dlopen`
    /// arguments to this metadata.
    pub name: Vec<u8>,
    /// bun.exe RVA where the addon's RVA 0 lands. Every RVA copied
    /// from the addon has had this added already; stored here only for
    /// diagnostics / thread-attach calls.
    pub rva_base: u32,
    /// The addon's original `SizeOfImage`. Together with `rva_base`
    /// this is the span to flush/protect.
    pub image_size: u32,
    /// bun-relative RVA of the addon's `AddressOfEntryPoint`
    /// (`_DllMainCRTStartup`), or 0 if the addon has none.
    pub entry_point: u32,
    /// bun.exe's `OptionalHeader.ImageBase` at the time the merge was
    /// done. Runtime computes `delta = GetModuleHandle(NULL) -
    /// preferred_base` and applies it to `relocs`.
    pub preferred_base: u64,

    pub sections: Vec<LinkedSectionInfo>,
    /// Raw `IMAGE_BASE_RELOCATION` blocks copied from the addon with
    /// their page RVAs already rebased to bun-relative. Runtime walks
    /// these and adds `delta` to each `DIR64` slot.
    pub relocs: Vec<u8>,
    pub imports: Vec<LinkedImportLib>,
    /// bun-relative RVA of the addon's `.pdata` (already rebased); fed
    /// to `RtlAddFunctionTable` so SEH/C++ exceptions inside the addon
    /// unwind correctly.
    pub pdata_rva: u32,
    pub pdata_count: u32,
    /// bun-relative RVAs of the symbols `process.dlopen` needs. Zero
    /// means "not exported by this addon".
    pub export_register: u32, // napi_register_module_v1
    pub export_api_version: u32, // node_api_module_get_api_version_v1
    pub export_plugin_name: u32, // BUN_PLUGIN_NAME
}

#[derive(Copy, Clone)]
pub struct LinkedSectionInfo {
    pub rva: u32,
    pub size: u32,
    /// Windows `PAGE_*` constant to `VirtualProtect` this range to
    /// once relocs + IAT are written. The on-disk section is RW so
    /// the runtime can patch it; this restores the addon's
    /// intended protection.
    pub final_protect: u32,
}

pub struct LinkedImportLib {
    /// DLL name as it appeared in the addon's import descriptor.
    pub name: Vec<u8>,
    /// True when the DLL is the host process (node.exe / bun.exe /
    /// the delay-load hook target). Runtime resolves these against
    /// `GetModuleHandle(NULL)` instead of `LoadLibraryA(name)`.
    pub is_host: bool,
    pub entries: Vec<LinkedImportEntry>,
}

pub struct LinkedImportEntry {
    /// bun-relative RVA of the IAT slot to overwrite.
    pub iat_rva: u32,
    pub ordinal: u16,
    /// Empty when importing by ordinal.
    pub name: Vec<u8>,
}

/// Read-only view over an addon PE for `add_linked_addon`. Uses file
/// offsets into `bytes` rather than a loaded image, so every "RVA"
/// access goes through `rva_to_off`.
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

    /// Translate an addon-relative RVA to a file offset. Section
    /// header fields are attacker-controlled so every add is
    /// saturating; callers then reject via the bytes.len check.
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
        let z = rest
            .iter()
            .position(|&c| c == 0)
            .ok_or(Error::OutOfBounds)?;
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

/// DLL names an addon may import its napi/uv symbols from. These are
/// all satisfied by bun.exe's own export table, so at runtime they are
/// resolved against `GetModuleHandle(NULL)` rather than a real
/// `LoadLibrary`.
fn is_host_import(dll_name: &[u8]) -> bool {
    // node-gyp emits a delay-load against "node.exe"; napi-rs against
    // "node.dll"; some toolchains against the literal host name.
    dll_name.eq_ignore_ascii_case(b"node.exe")
        || dll_name.eq_ignore_ascii_case(b"node.dll")
        || dll_name.eq_ignore_ascii_case(b"bun.exe")
        || (dll_name.len() >= 4 && dll_name[0..4].eq_ignore_ascii_case(b"bun-"))
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
    /// Merge one `.node` PE into this image as a single new section, apply
    /// the build-time relocation delta, and collect the runtime metadata.
    ///
    /// The addon's internal RVA layout is preserved: its RVA 0 maps to the
    /// new section's `virtual_address`, so every intra-addon reference is a
    /// single constant add. The new section is marked RW (not executable)
    /// on disk; runtime flips each original-section range to its real
    /// protection via `VirtualProtect` after binding.
    ///
    /// Returns `Ok(None)` when the addon uses a feature we do not merge
    /// (static TLS, C++ throw via `_CxxThrowException`, wrong machine type,
    /// malformed structures). Caller should then keep the raw bytes so
    /// runtime can fall back to the extract-to-tempfile path.
    pub fn add_linked_addon(
        &mut self,
        addon_bytes: &[u8],
        addon_index: u32,
        virtual_path: &[u8],
    ) -> Result<Option<LinkedAddon>, Error> {
        let Ok(addon) = AddonView::init(addon_bytes) else {
            return Ok(None);
        };

        // Refuse anything we would get wrong. The extract-to-tempfile
        // path stays as the behavioural fallback.
        //
        // A wrong-architecture addon (e.g. an x64 prebuild bundled into
        // a --target=bun-windows-arm64 build) would merge structurally
        // (ARM64 PE32+ uses IMAGE_REL_BASED_DIR64 just like x64) and
        // then crash with STATUS_ILLEGAL_INSTRUCTION when DllMain runs.
        // The tempfile path gets a clean ERROR_BAD_EXE_FORMAT instead.
        // SAFETY: pointer from get_pe_header is bounds-checked into self.data.
        let host_machine = unsafe { (*self.get_pe_header()?).machine };
        if addon.pe.machine != host_machine {
            return Ok(None);
        }
        //
        // Implicit TLS (`__declspec(thread)`, Rust `thread_local!`) needs
        // an index reserved in the loader's private `LdrpTlsBitmap` and a
        // template installed in every existing thread's
        // `ThreadLocalStoragePointer` array. Neither has a userspace API;
        // faking it invites index collisions with later `LoadLibrary`
        // calls and misses threads that already exist. Let `LoadLibraryExW`
        // handle those via the fallback.
        //
        // However: MSVC's `_DllMainCRTStartup` pulls in `tlssup.obj`, so
        // essentially every MSVC-built DLL has an IMAGE_TLS_DIRECTORY64
        // even with no `__declspec(thread)` data of its own. That
        // directory has an *empty template* (`StartAddressOfRawData ==
        // EndAddressOfRawData` and `SizeOfZeroFill == 0`) and its
        // callback array holds only the CRT's `__dyn_tls_init`/`_dtor`,
        // which with no `.CRT$XD*` dynamic initializers are no-ops that
        // never touch `ThreadLocalStoragePointer`. Such an addon needs
        // no index and no per-thread install, so it is safe to merge
        // and simply ignore the directory at runtime.
        let tls_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_TLS);
        if tls_dir.size != 0 || tls_dir.virtual_address != 0 {
            const TLS_DIR64_SIZE: u32 = 40; // IMAGE_TLS_DIRECTORY64
            if tls_dir.size < TLS_DIR64_SIZE {
                return Ok(None);
            }
            let Ok(dir_bytes) = addon.slice_at_rva(tls_dir.virtual_address, TLS_DIR64_SIZE) else {
                return Ok(None);
            };
            let raw_start = read_u64_le(dir_bytes, 0);
            let raw_end = read_u64_le(dir_bytes, 8);
            let zero_fill = read_u32_le(dir_bytes, 32);
            // Nonzero template → real __declspec(thread) storage.
            if raw_end != raw_start || zero_fill != 0 {
                return Ok(None);
            }
            // Empty template → CRT stub; merge and ignore it.
        }
        // Without base relocations we cannot rebase the addon's absolute
        // addresses into bun.exe's image. A DLL built with /FIXED would
        // also fail LoadLibrary unless its preferred base happened to be
        // free, so falling back is no loss of functionality.
        const IMAGE_FILE_RELOCS_STRIPPED: u16 = 0x0001;
        if addon.pe.characteristics & IMAGE_FILE_RELOCS_STRIPPED != 0 {
            return Ok(None);
        }

        // SAFETY: pointer from get_optional_header is bounds-checked into self.data.
        let host_opt = unsafe { ptr::read_unaligned(self.get_optional_header()?) };
        let sect_align = host_opt.section_alignment;
        let file_align = host_opt.file_alignment;
        let preferred_base = host_opt.image_base;

        // Work out where the new section goes.
        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;
        {
            let host_sections = self.get_section_headers()?;
            for s in host_sections {
                let fend = s.pointer_to_raw_data + s.size_of_raw_data;
                if fend > last_file_end {
                    last_file_end = fend;
                }
                let vs = s.virtual_size.max(s.size_of_raw_data);
                let vend = s.virtual_address + align_up_u32(vs, sect_align)?;
                if vend > last_va_end {
                    last_va_end = vend;
                }
            }
        }

        // Header slack: this addon's section, the trailing `.bunL`
        // metadata section, and the final `.bun` module-graph section.
        // If we consumed a slot that `.bunL`/`.bun` will need later the
        // build would hard-fail in add_linked_addon_section/add_bun_section
        // instead of falling back, so refuse *here* while the caller
        // can still skip this addon and keep going. Mirror both of
        // `add_bun_section`'s gates: the hard 96-section PE cap, and the
        // `align_up(SizeOfHeaders, file_align) <= first_raw` byte-slack
        // check.
        let want_sections = self.num_sections as u32 + 3;
        if want_sections > 96 {
            return Err(Error::InsufficientHeaderSpace);
        }
        let new_headers_end =
            self.section_headers_offset + size_of::<SectionHeader>() * want_sections as usize;
        let reserved_headers = align_up_u32(
            u32::try_from(new_headers_end).expect("int cast"),
            file_align,
        )?;
        let mut first_raw: u32 = u32::try_from(self.data.len()).expect("int cast");
        {
            let host_sections = self.get_section_headers()?;
            for s in host_sections {
                if s.size_of_raw_data > 0 && s.pointer_to_raw_data < first_raw {
                    first_raw = s.pointer_to_raw_data;
                }
            }
        }
        if reserved_headers > first_raw {
            return Err(Error::InsufficientHeaderSpace);
        }

        // The addon's RVA 0 maps to this RVA in bun.exe.
        let rva_base = align_up_u32(last_va_end, sect_align)?;
        let addon_image = addon.opt.size_of_image;
        // AddressOfEntryPoint is attacker-controlled. A value outside
        // the image we are about to copy would make the runtime jump
        // into unrelated bun.exe code or unmapped memory. Check here,
        // before any host mutation, so a skip leaves the host image
        // untouched.
        let entry_rva = addon.opt.address_of_entry_point;
        if entry_rva != 0 && entry_rva >= addon_image {
            return Ok(None);
        }
        // SizeOfImage is attacker-controlled. Refuse anything that would
        // either blow the build-time allocation or push bun.exe's own
        // SizeOfImage past 2 GiB (RVAs are signed in several Windows
        // structures). The tempfile fallback has no such limit.
        if addon_image == 0 {
            return Ok(None);
        }
        if addon_image > 512 * 1024 * 1024 {
            return Ok(None);
        }
        if rva_base as u64 + addon_image as u64 > i32::MAX as u64 {
            return Ok(None);
        }

        // Build a memory-image of the addon (zero-filled then sections
        // copied in at their original RVAs) so the on-disk section is laid
        // out exactly as the addon expects to find itself at runtime.
        let mut image = vec![0u8; addon_image as usize];

        let mut section_infos: Vec<LinkedSectionInfo> = Vec::new();

        for s in addon.sections {
            if s.virtual_address >= addon_image {
                return Ok(None);
            }
            // A section whose raw bytes lie past EOF is malformed. Do
            // not merge a zeroed stand-in and then trust the rest of
            // the metadata — fail closed so the tempfile path handles
            // it (where LoadLibrary will also reject it, but loudly).
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
            // Clamp the VirtualProtect span to what we actually copied
            // (and therefore what the loader will map). A section header
            // that lies about its virtual size cannot make the runtime
            // protect pages outside the merged addon.
            section_infos.push(LinkedSectionInfo {
                rva: rva_base + s.virtual_address,
                size: vs.min(addon_image - s.virtual_address),
                final_protect: section_final_protect(s.characteristics),
            });
        }

        // Apply the build-time relocation delta so absolute addresses in
        // the copied image point at bun.exe's preferred base. Also rewrite
        // the reloc blocks' page RVAs to be bun-relative so the runtime can
        // apply the remaining ASLR delta without a translation table.
        let addon_base = addon.opt.image_base;
        let build_delta: i64 =
            (preferred_base.wrapping_add(rva_base as u64) as i64).wrapping_sub(addon_base as i64);

        let mut relocs_out: Vec<u8> = Vec::new();

        let reloc_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_BASERELOC);
        if reloc_dir.size > 0 {
            let Ok(reloc_bytes) = addon.slice_at_rva(reloc_dir.virtual_address, reloc_dir.size)
            else {
                return Ok(None);
            };
            let mut off: usize = 0;
            while off + IMAGE_BASE_RELOCATION_SIZE as usize <= reloc_bytes.len() {
                let page_rva = read_u32_le(reloc_bytes, off);
                let block_size = read_u32_le(reloc_bytes, off + 4);
                // A zero-sized (terminator) or malformed block mid-stream
                // means we cannot know whether more relocations follow,
                // and stopping here would leave a half-relocated image
                // that looks valid. Some linkers emit a single zero block
                // as the terminator, which this also covers.
                if block_size == 0 && page_rva == 0 {
                    break;
                }
                if block_size < IMAGE_BASE_RELOCATION_SIZE
                    || off + block_size as usize > reloc_bytes.len()
                {
                    return Ok(None);
                }
                let n_entries = (block_size - IMAGE_BASE_RELOCATION_SIZE) / 2;

                // A block whose page RVA lies outside the image cannot
                // describe any slot we copied. Skip the whole addon —
                // quietly applying only some relocations would leave a
                // half-relocated image.
                if page_rva >= addon_image {
                    return Ok(None);
                }

                // Emit header with bun-relative page RVA.
                relocs_out.extend_from_slice(&(rva_base + page_rva).to_le_bytes());
                relocs_out.extend_from_slice(&block_size.to_le_bytes());

                for i in 0..n_entries as usize {
                    let entry = read_u16_le(reloc_bytes, off + 8 + i * 2);
                    relocs_out.extend_from_slice(&entry.to_le_bytes());
                    let typ = entry >> 12;
                    if typ == IMAGE_REL_BASED_ABSOLUTE {
                        continue; // padding
                    }
                    if typ != IMAGE_REL_BASED_DIR64 {
                        // Unknown fixup kind on PE32+ — do not risk it.
                        return Ok(None);
                    }
                    let in_page = (entry & 0x0FFF) as u32;
                    // page_rva < addon_image and in_page < 0x1000, so
                    // this cannot wrap; just guard the 8-byte write.
                    let target_rva = page_rva + in_page;
                    if target_rva as u64 + 8 > addon_image as u64 {
                        return Ok(None);
                    }
                    let slot = &mut image[target_rva as usize..][..8];
                    let old =
                        u64::from_le_bytes(slot.try_into().expect("infallible: size matches"));
                    let new = (old as i64).wrapping_add(build_delta) as u64;
                    slot.copy_from_slice(&new.to_le_bytes());
                }
                off += block_size as usize;
            }
        }

        // Imports: record what the runtime needs to bind, and zero the IAT
        // slots in the image so it is obvious if binding is skipped.
        let mut imports: Vec<LinkedImportLib> = Vec::new();

        if collect_imports(&addon, &mut imports, &mut image, rva_base, false) {
            return Ok(None);
        }
        if collect_imports(&addon, &mut imports, &mut image, rva_base, true) {
            return Ok(None);
        }

        // Exception table. The RUNTIME_FUNCTION array and every RVA inside
        // the UNWIND_INFO structures it points at (chained unwind entries,
        // language-specific handler RVAs) are all interpreted relative to
        // the single BaseAddress passed to RtlAddFunctionTable. Rebasing
        // only the outer array would leave the inner RVAs wrong, so keep
        // the whole thing addon-relative and have the runtime pass
        // `exe_base + rva_base` as BaseAddress instead.
        //
        // .pdata entry size is architecture-dependent: x64 RUNTIME_FUNCTION
        // is {begin, end, unwind_info} = 12 bytes; ARM64
        // IMAGE_ARM64_RUNTIME_FUNCTION_ENTRY is {begin, packed_unwind} =
        // 8 bytes. RtlAddFunctionTable's EntryCount counts native-sized
        // entries, so dividing by the wrong one would register only the
        // first 2N/3 functions on ARM64 and leave the rest with no
        // unwind data. The machine-type gate above already guarantees
        // addon.pe.machine == host machine.
        let mut pdata_rva: u32 = 0;
        let mut pdata_count: u32 = 0;
        let pdata_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_EXCEPTION);
        const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;
        let pdata_entry_size: u32 = if addon.pe.machine == IMAGE_FILE_MACHINE_ARM64 {
            8
        } else {
            12
        };
        if pdata_dir.size >= pdata_entry_size
            && pdata_dir.virtual_address as u64 + pdata_dir.size as u64 <= addon_image as u64
        {
            pdata_rva = rva_base + pdata_dir.virtual_address;
            pdata_count = pdata_dir.size / pdata_entry_size;
        }

        // Exports we care about.
        let mut export_register: u32 = 0;
        let mut export_api_version: u32 = 0;
        let mut export_plugin_name: u32 = 0;
        let exp_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_EXPORT);
        'exports: {
            if exp_dir.size < IMAGE_EXPORT_DIRECTORY_SIZE {
                break 'exports;
            }
            let Ok(exp_bytes) =
                addon.slice_at_rva(exp_dir.virtual_address, IMAGE_EXPORT_DIRECTORY_SIZE)
            else {
                break 'exports;
            };
            // Counts are attacker-controlled. Saturate the multiplies so a
            // hostile number_of_names=0x40000000 turns into a length that
            // slice_at_rva cleanly rejects instead of wrapping to a small
            // value and succeeding on the wrong bytes.
            let n_funcs = read_u32_le(exp_bytes, 20);
            let n_names = read_u32_le(exp_bytes, 24);
            let address_of_functions = read_u32_le(exp_bytes, 28);
            let address_of_names = read_u32_le(exp_bytes, 32);
            let address_of_name_ordinals = read_u32_le(exp_bytes, 36);
            let Ok(names) = addon.slice_at_rva(address_of_names, n_names.saturating_mul(4)) else {
                break 'exports;
            };
            let Ok(ords) = addon.slice_at_rva(address_of_name_ordinals, n_names.saturating_mul(2))
            else {
                break 'exports;
            };
            let Ok(funcs) = addon.slice_at_rva(address_of_functions, n_funcs.saturating_mul(4))
            else {
                break 'exports;
            };
            for i in 0..n_names as usize {
                let name_rva = read_u32_le(names, i * 4);
                let Ok(name) = addon.cstr_at_rva(name_rva) else {
                    continue;
                };
                let ord = read_u16_le(ords, i * 2);
                if ord as u32 >= n_funcs {
                    continue;
                }
                let fn_rva = read_u32_le(funcs, ord as usize * 4);
                // A forwarder or deliberately bogus RVA can point past
                // the addon image; clamp so the rebase cannot wrap.
                if fn_rva == 0 || fn_rva >= addon_image {
                    continue;
                }
                let bun_rva = rva_base + fn_rva;
                if name == b"napi_register_module_v1" {
                    export_register = bun_rva;
                } else if name == b"node_api_module_get_api_version_v1" {
                    export_api_version = bun_rva;
                } else if name == b"BUN_PLUGIN_NAME" {
                    export_plugin_name = bun_rva;
                }
            }
        }

        // Write the merged section to self.
        let raw_size = align_up_u32(addon_image, file_align)?;
        let new_raw = align_up_u32(last_file_end, file_align)?;
        let new_file_size = new_raw as usize + raw_size as usize;
        self.data.resize(new_file_size, 0);
        self.data[new_raw as usize..new_file_size].fill(0);
        self.data[new_raw as usize..][..addon_image as usize].copy_from_slice(&image);

        let mut name_buf: [u8; 8] = [b'.', b'b', b'n', 0, 0, 0, 0, 0];
        {
            // ".bn0".."\u{2026}" — decimal index, truncated to the 5 bytes
            // available after ".bn" (indexes that large are impossible:
            // the 96-section cap is hit long before).
            let mut idx = addon_index;
            let mut digits = [0u8; 10];
            let mut n = 0;
            loop {
                digits[n] = b'0' + (idx % 10) as u8;
                idx /= 10;
                n += 1;
                if idx == 0 {
                    break;
                }
            }
            for (j, slot) in name_buf[3..].iter_mut().take(n).enumerate() {
                *slot = digits[n - 1 - j];
            }
        }
        let sh = SectionHeader {
            name: name_buf,
            virtual_size: addon_image,
            virtual_address: rva_base,
            size_of_raw_data: raw_size,
            pointer_to_raw_data: new_raw,
            pointer_to_relocations: 0,
            pointer_to_line_numbers: 0,
            number_of_relocations: 0,
            number_of_line_numbers: 0,
            // RW so runtime can apply ASLR relocs and bind the IAT without
            // an initial VirtualProtect. Not executable yet — runtime
            // promotes the addon's .text range after binding.
            characteristics: IMAGE_SCN_CNT_INITIALIZED_DATA
                | IMAGE_SCN_MEM_READ
                | IMAGE_SCN_MEM_WRITE,
        };
        let sh_off =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        // SAFETY: bounds checked via the reserved_headers <= first_raw gate above;
        // SectionHeader is #[repr(C, packed)] POD.
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
            (*opt_after).size_of_image = align_up_u32(rva_base + addon_image, sect_align)?;
        }

        Ok(Some(LinkedAddon {
            name: virtual_path.to_vec(),
            rva_base,
            image_size: addon_image,
            entry_point: if entry_rva != 0 {
                rva_base + entry_rva
            } else {
                0
            },
            preferred_base,
            sections: section_infos,
            relocs: relocs_out,
            imports,
            pdata_rva,
            pdata_count,
            export_register,
            export_api_version,
            export_plugin_name,
        }))
    }

    /// Append the `.bunL` section carrying serialized `LinkedAddon`
    /// metadata. Layout mirrors `.bun`: `[u64 len][blob][pad]`. Must be
    /// called after all `add_linked_addon` calls and before `add_bun_section`
    /// (which finalises the checksum and security directory).
    pub fn add_linked_addon_section(&mut self, blob: &[u8]) -> Result<(), Error> {
        // SAFETY: pointer from get_optional_header is bounds-checked into self.data.
        let opt = unsafe { ptr::read_unaligned(self.get_optional_header()?) };
        let sect_align = opt.section_alignment;
        let file_align = opt.file_alignment;

        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;
        let mut first_raw: u32 = u32::try_from(self.data.len()).expect("int cast");
        {
            let sections = self.get_section_headers()?;
            for s in sections {
                if s.size_of_raw_data > 0 && s.pointer_to_raw_data < first_raw {
                    first_raw = s.pointer_to_raw_data;
                }
                let fend = s.pointer_to_raw_data + s.size_of_raw_data;
                if fend > last_file_end {
                    last_file_end = fend;
                }
                let vs = s.virtual_size.max(s.size_of_raw_data);
                let vend = s.virtual_address + align_up_u32(vs, sect_align)?;
                if vend > last_va_end {
                    last_va_end = vend;
                }
            }
        }

        // Reserve room for this section *and* the `.bun` section that
        // `add_bun_section` will append next. Taking the last slot here
        // would turn a skippable merge into a hard build failure.
        // Mirror both of `add_bun_section`'s gates: the 96-section PE
        // cap and the file-aligned byte-slack check.
        if self.num_sections as u32 + 2 > 96 {
            return Err(Error::InsufficientHeaderSpace);
        }
        let new_headers_end = self.section_headers_offset
            + size_of::<SectionHeader>() * (self.num_sections as usize + 2);
        let reserved_headers = align_up_u32(
            u32::try_from(new_headers_end).expect("int cast"),
            file_align,
        )?;
        if reserved_headers > first_raw {
            return Err(Error::InsufficientHeaderSpace);
        }

        if blob.len() > (u32::MAX - 8) as usize {
            return Err(Error::Overflow);
        }
        let payload = u32::try_from(blob.len() + 8).expect("int cast");
        let raw_size = align_up_u32(payload, file_align)?;
        let new_va = align_up_u32(last_va_end, sect_align)?;
        let new_raw = align_up_u32(last_file_end, file_align)?;
        let new_file_size = new_raw as usize + raw_size as usize;
        self.data.resize(new_file_size, 0);
        self.data[new_raw as usize..new_file_size].fill(0);
        self.data[new_raw as usize..][..8].copy_from_slice(&(blob.len() as u64).to_le_bytes());
        self.data[new_raw as usize + 8..][..blob.len()].copy_from_slice(blob);

        let sh = SectionHeader {
            name: BUNL_SECTION_NAME,
            virtual_size: payload,
            virtual_address: new_va,
            size_of_raw_data: raw_size,
            pointer_to_raw_data: new_raw,
            pointer_to_relocations: 0,
            pointer_to_line_numbers: 0,
            number_of_relocations: 0,
            number_of_line_numbers: 0,
            characteristics: IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };
        let sh_off =
            self.section_headers_offset + size_of::<SectionHeader>() * self.num_sections as usize;
        // SAFETY: bounds checked via the reserved_headers <= first_raw gate above;
        // SectionHeader is #[repr(C, packed)] POD.
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
            (*opt_after).size_of_image = align_up_u32(new_va + payload, sect_align)?;
        }
        Ok(())
    }
}

/// Walk either the normal or the delay-load import directory of `addon`
/// and append `LinkedImportLib` descriptors to `out`. Returns true when the
/// directory is malformed enough that we should abandon the merge.
fn collect_imports(
    addon: &AddonView,
    out: &mut Vec<LinkedImportLib>,
    image: &mut [u8],
    rva_base: u32,
    delay: bool,
) -> bool {
    let desc_size: u32 = if delay {
        IMAGE_DELAYLOAD_DESCRIPTOR_SIZE
    } else {
        IMAGE_IMPORT_DESCRIPTOR_SIZE
    };
    let dir_idx = if delay {
        IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT
    } else {
        IMAGE_DIRECTORY_ENTRY_IMPORT
    };
    let dir = addon.dir(dir_idx);
    if dir.size == 0 || dir.virtual_address == 0 {
        return false;
    }

    // Walk at most as many descriptors as the directory claims to
    // hold, plus one for the terminator. A hostile image that points
    // the directory into a region with no zero terminator cannot make
    // us loop past that.
    let max_descs = (dir.size / desc_size).saturating_add(1);

    let mut desc_rva = dir.virtual_address;
    let mut found_terminator = false;
    for _ in 0..max_descs {
        let Ok(desc) = addon.slice_at_rva(desc_rva, desc_size) else {
            return true;
        };
        // IMAGE_IMPORT_DESCRIPTOR: OriginalFirstThunk@0, Name@12, FirstThunk@16.
        // IMAGE_DELAYLOAD_DESCRIPTOR: Attributes@0, DllNameRVA@4,
        // ImportAddressTableRVA@12, ImportNameTableRVA@16.
        let name_rva = if delay {
            read_u32_le(desc, 4)
        } else {
            read_u32_le(desc, 12)
        };
        if name_rva == 0 {
            found_terminator = true;
            break;
        }
        let Ok(dll_name) = addon.cstr_at_rva(name_rva) else {
            return true;
        };

        // Some toolchains emit a v1 delayload descriptor (no RVA
        // attribute bit) with VA-style pointers. We only handle the
        // modern RVA form; treat the legacy form as "extract instead".
        if delay && (read_u32_le(desc, 0) & 1) == 0 {
            return true;
        }

        let ilt_rva = if delay {
            read_u32_le(desc, 16)
        } else {
            let original_first_thunk = read_u32_le(desc, 0);
            if original_first_thunk != 0 {
                original_first_thunk
            } else {
                read_u32_le(desc, 16) // some linkers omit the ILT
            }
        };
        let iat_rva = if delay {
            read_u32_le(desc, 12)
        } else {
            read_u32_le(desc, 16)
        };
        if ilt_rva == 0 || iat_rva == 0 {
            return true;
        }

        let mut entries: Vec<LinkedImportEntry> = Vec::new();

        // Thunks are walked until a zero terminator. Bound the walk
        // by the addon image so a missing terminator cannot run us
        // off the end or allocate unbounded entries; any real addon
        // with more imports than fit in its own image is malformed.
        let max_thunks = (addon.opt.size_of_image / 8).saturating_add(1);

        let mut found_thunk_terminator = false;
        for idx in 0..max_thunks {
            let thunk_rva = ilt_rva.saturating_add(idx.saturating_mul(8));
            let Ok(thunk_bytes) = addon.slice_at_rva(thunk_rva, 8) else {
                return true;
            };
            let thunk = read_u64_le(thunk_bytes, 0);
            if thunk == 0 {
                found_thunk_terminator = true;
                break;
            }
            let slot_rva = iat_rva.saturating_add(idx.saturating_mul(8));
            // The IAT slot the runtime will bind must live inside the
            // merged image, or we would later write through a bogus
            // pointer.
            if slot_rva as usize >= image.len() || slot_rva as usize + 8 > image.len() {
                return true;
            }
            // Zero it so a missed bind is an obvious null-deref
            // rather than a jump into junk.
            image[slot_rva as usize..][..8].fill(0);

            if thunk & IMAGE_ORDINAL_FLAG64 != 0 {
                entries.push(LinkedImportEntry {
                    iat_rva: rva_base + slot_rva,
                    ordinal: (thunk & 0xFFFF) as u16,
                    name: Vec::new(),
                });
            } else {
                // IMAGE_IMPORT_BY_NAME: u16 hint then NUL-terminated
                // name. The PE spec reserves bits 62:31 of a
                // by-name thunk as zero; anything there is
                // malformed and truncating it would resolve the
                // wrong symbol instead of falling back.
                if thunk >> 31 != 0 {
                    return true;
                }
                let hint_rva = thunk as u32;
                let Ok(name) = addon.cstr_at_rva(hint_rva.saturating_add(2)) else {
                    return true;
                };
                // MSVC C++ `throw` calls vcruntime's
                // `_CxxThrowException`, which does
                // `RtlPcToFileHeader(pThrowInfo, &ThrowImageBase)`
                // to learn the image base the 32-bit
                // `_ThrowInfo` / `_CatchableTypeArray` RVAs are
                // relative to. `RtlPcToFileHeader` only walks
                // `PEB->Ldr` — not `RtlAddFunctionTable`
                // registrations — and the addon's `.rdata` sits
                // inside bun.exe's grown `SizeOfImage`, so it
                // returns `exe_base` instead of
                // `exe_base + rva_base`. `__CxxFrameHandler3/4`
                // then resolves the throw-side catchable-type
                // list against the wrong base and walks garbage
                // → AV or `std::terminate()`. Stack unwinding
                // and SEH `__try`/`__except` are fine (they use
                // `DispatcherContext->ImageBase`, which
                // `RtlAddFunctionTable` sets); only C++
                // `throw`/`catch` type matching breaks. Fall
                // back so node-addon-api `NAPI_CPP_EXCEPTIONS`
                // addons keep working.
                if name == b"_CxxThrowException" {
                    return true;
                }
                entries.push(LinkedImportEntry {
                    iat_rva: rva_base + slot_rva,
                    ordinal: 0,
                    name: name.to_vec(),
                });
            }
        }
        if !found_thunk_terminator {
            return true; // no terminator within bounds
        }

        out.push(LinkedImportLib {
            name: dll_name.to_vec(),
            is_host: is_host_import(dll_name),
            entries,
        });

        desc_rva = desc_rva.saturating_add(desc_size);
    }
    if !found_terminator {
        return true; // dir.size under-reports: no terminator
    }
    false
}

/// Flatten a set of `LinkedAddon`s into the on-disk `.bunL` blob.
///
/// The format is deliberately dumb: little-endian fixed-width integers
/// and length-prefixed byte strings, walked front-to-back. It never
/// needs to be seekable or patchable and is only ever produced by the
/// same build of bun that consumes it (mismatch falls back to tmpfile
/// extraction), so there is no attempt at forward compatibility beyond
/// the magic+version gate.
pub const LINKED_MAGIC: u32 = 0x4B4E_4C42; // 'BLNK'
pub const LINKED_VERSION: u32 = 1;

pub fn serialize_linked_addons(addons: &[LinkedAddon]) -> Vec<u8> {
    fn w_u32(b: &mut Vec<u8>, v: u32) {
        b.extend_from_slice(&v.to_le_bytes());
    }
    fn w_u64(b: &mut Vec<u8>, v: u64) {
        b.extend_from_slice(&v.to_le_bytes());
    }
    fn w_str(b: &mut Vec<u8>, s: &[u8]) {
        w_u32(b, u32::try_from(s.len()).expect("int cast"));
        b.extend_from_slice(s);
    }
    let mut buf: Vec<u8> = Vec::new();
    w_u32(&mut buf, LINKED_MAGIC);
    w_u32(&mut buf, LINKED_VERSION);
    w_u32(&mut buf, u32::try_from(addons.len()).expect("int cast"));
    for a in addons {
        w_str(&mut buf, &a.name);
        w_u32(&mut buf, a.rva_base);
        w_u32(&mut buf, a.image_size);
        w_u32(&mut buf, a.entry_point);
        w_u64(&mut buf, a.preferred_base);
        w_u32(&mut buf, a.pdata_rva);
        w_u32(&mut buf, a.pdata_count);
        w_u32(&mut buf, a.export_register);
        w_u32(&mut buf, a.export_api_version);
        w_u32(&mut buf, a.export_plugin_name);
        w_u32(&mut buf, u32::try_from(a.sections.len()).expect("int cast"));
        for s in &a.sections {
            w_u32(&mut buf, s.rva);
            w_u32(&mut buf, s.size);
            w_u32(&mut buf, s.final_protect);
        }
        w_str(&mut buf, &a.relocs);
        w_u32(&mut buf, u32::try_from(a.imports.len()).expect("int cast"));
        for lib in &a.imports {
            w_str(&mut buf, &lib.name);
            buf.push(lib.is_host as u8);
            w_u32(
                &mut buf,
                u32::try_from(lib.entries.len()).expect("int cast"),
            );
            for e in &lib.entries {
                w_u32(&mut buf, e.iat_rva);
                buf.extend_from_slice(&e.ordinal.to_le_bytes());
                w_str(&mut buf, &e.name);
            }
        }
    }
    buf
}

/// Cheap PE sniff for deciding whether a `.node` asset is worth feeding
/// to `add_linked_addon` at all.
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

// `.bunL` — statically-merged `.node` addon metadata (see `LinkedAddon`).
// Absent in a non-compiled bun or when no addons were merged; callers
// treat missing as "fall back to tmpfile LoadLibrary". Also implemented
// in src/jsc/bindings/c-bindings.cpp.
unsafe extern "C" {
    pub fn Bun__getLinkedAddonsPELength() -> u64;
    pub fn Bun__getLinkedAddonsPEData() -> *mut u8;
}
