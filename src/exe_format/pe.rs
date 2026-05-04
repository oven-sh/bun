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

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
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

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DOSHeader {
    pub e_magic: u16,    // Magic number
    pub e_cblp: u16,     // Bytes on last page of file
    pub e_cp: u16,       // Pages in file
    pub e_crlc: u16,     // Relocations
    pub e_cparhdr: u16,  // Size of header in paragraphs
    pub e_minalloc: u16, // Minimum extra paragraphs needed
    pub e_maxalloc: u16, // Maximum extra paragraphs needed
    pub e_ss: u16,       // Initial relative SS value
    pub e_sp: u16,       // Initial SP value
    pub e_csum: u16,     // Checksum
    pub e_ip: u16,       // Initial IP value
    pub e_cs: u16,       // Initial relative CS value
    pub e_lfarlc: u16,   // Address of relocation table
    pub e_ovno: u16,     // Overlay number
    pub e_res: [u16; 4], // Reserved words
    pub e_oemid: u16,    // OEM identifier (for e_oeminfo)
    pub e_oeminfo: u16,  // OEM information; e_oemid specific
    pub e_res2: [u16; 10], // Reserved words
    pub e_lfanew: u32,   // File address of new exe header
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PEHeader {
    pub signature: u32,               // PE signature
    pub machine: u16,                 // Machine type
    pub number_of_sections: u16,      // Number of sections
    pub time_date_stamp: u32,         // Time/date stamp
    pub pointer_to_symbol_table: u32, // Pointer to symbol table
    pub number_of_symbols: u32,       // Number of symbols
    pub size_of_optional_header: u16, // Size of optional header
    pub characteristics: u16,         // Characteristics
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct OptionalHeader64 {
    pub magic: u16,                          // Magic number
    pub major_linker_version: u8,            // Major linker version
    pub minor_linker_version: u8,            // Minor linker version
    pub size_of_code: u32,                   // Size of code
    pub size_of_initialized_data: u32,       // Size of initialized data
    pub size_of_uninitialized_data: u32,     // Size of uninitialized data
    pub address_of_entry_point: u32,         // Address of entry point
    pub base_of_code: u32,                   // Base of code
    pub image_base: u64,                     // Image base
    pub section_alignment: u32,              // Section alignment
    pub file_alignment: u32,                 // File alignment
    pub major_operating_system_version: u16, // Major OS version
    pub minor_operating_system_version: u16, // Minor OS version
    pub major_image_version: u16,            // Major image version
    pub minor_image_version: u16,            // Minor image version
    pub major_subsystem_version: u16,        // Major subsystem version
    pub minor_subsystem_version: u16,        // Minor subsystem version
    pub win32_version_value: u32,            // Win32 version value
    pub size_of_image: u32,                  // Size of image
    pub size_of_headers: u32,                // Size of headers
    pub checksum: u32,                       // Checksum
    pub subsystem: u16,                      // Subsystem
    pub dll_characteristics: u16,            // DLL characteristics
    pub size_of_stack_reserve: u64,          // Size of stack reserve
    pub size_of_stack_commit: u64,           // Size of stack commit
    pub size_of_heap_reserve: u64,           // Size of heap reserve
    pub size_of_heap_commit: u64,            // Size of heap commit
    pub loader_flags: u32,                   // Loader flags
    pub number_of_rva_and_sizes: u32,        // Number of RVA and sizes
    pub data_directories: [DataDirectory; 16], // Data directories
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DataDirectory {
    pub virtual_address: u32,
    pub size: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SectionHeader {
    pub name: [u8; 8],               // Section name
    pub virtual_size: u32,           // Virtual size
    pub virtual_address: u32,        // Virtual address
    pub size_of_raw_data: u32,       // Size of raw data
    pub pointer_to_raw_data: u32,    // Pointer to raw data
    pub pointer_to_relocations: u32, // Pointer to relocations
    pub pointer_to_line_numbers: u32, // Pointer to line numbers
    pub number_of_relocations: u16,  // Number of relocations
    pub number_of_line_numbers: u16, // Number of line numbers
    pub characteristics: u32,        // Characteristics
}

const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"
const DOS_SIGNATURE: u16 = 0x5A4D; // "MZ"
const OPTIONAL_HEADER_MAGIC_64: u16 = 0x020B;

// Section characteristics
const IMAGE_SCN_CNT_CODE: u32 = 0x0000_0020;
const IMAGE_SCN_CNT_INITIALIZED_DATA: u32 = 0x0000_0040;
const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;
const IMAGE_SCN_MEM_WRITE: u32 = 0x8000_0000;
const IMAGE_SCN_MEM_EXECUTE: u32 = 0x2000_0000;

// Directory indices and DLL characteristics
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

// Section name constant for exact comparison
const BUN_SECTION_NAME: [u8; 8] = [b'.', b'b', b'u', b'n', 0, 0, 0, 0];

// Safe access helpers for unaligned views
// TODO(port): Zig used `*align(1) const T`; Rust references require alignment.
// These return raw pointers; callers must treat reads/writes as potentially unaligned.
// Phase B: consider `#[repr(C, packed)]` on header structs or `ptr::read_unaligned`.
fn view_at_const<T>(buf: &[u8], off: usize) -> Result<*const T, Error> {
    if off + size_of::<T>() > buf.len() {
        return Err(Error::OutOfBounds);
    }
    // SAFETY: bounds-checked above; pointer remains within `buf`
    Ok(unsafe { buf.as_ptr().add(off) as *const T })
}

fn view_at_mut<T>(buf: &mut [u8], off: usize) -> Result<*mut T, Error> {
    if off + size_of::<T>() > buf.len() {
        return Err(Error::OutOfBounds);
    }
    // SAFETY: bounds-checked above; pointer remains within `buf`
    Ok(unsafe { buf.as_mut_ptr().add(off) as *mut T })
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

    fn get_dos_header_mut(&mut self) -> Result<*mut DOSHeader, Error> {
        view_at_mut::<DOSHeader>(&mut self.data, self.dos_header_offset)
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
        // SAFETY: bounds-checked above; SectionHeader is #[repr(C)] POD.
        // TODO(port): potentially unaligned — Zig used []align(1) const SectionHeader
        let ptr = unsafe { self.data.as_ptr().add(start) as *const SectionHeader };
        Ok(unsafe { slice::from_raw_parts(ptr, self.num_sections as usize) })
    }

    fn get_section_headers_mut(&mut self) -> Result<&mut [SectionHeader], Error> {
        let start = self.section_headers_offset;
        let size = size_of::<SectionHeader>() * self.num_sections as usize;
        if start + size > self.data.len() {
            return Err(Error::OutOfBounds);
        }
        // SAFETY: bounds-checked above; SectionHeader is #[repr(C)] POD.
        // TODO(port): potentially unaligned — Zig used []align(1) SectionHeader
        let ptr = unsafe { self.data.as_mut_ptr().add(start) as *mut SectionHeader };
        Ok(unsafe { slice::from_raw_parts_mut(ptr, self.num_sections as usize) })
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
        // PORT NOTE: reshaped for borrowck — drop pe_header borrow before re-borrowing data
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
        let mut first_raw: u32 = u32::try_from(data.len()).unwrap();
        let mut last_file_end: u32 = 0;
        let mut last_va_end: u32 = 0;

        let section_alignment = optional_header.section_alignment;

        if num_sections > 0 {
            // SAFETY: bounds-checked above
            let sections_ptr =
                unsafe { data.as_ptr().add(section_headers_offset) as *const SectionHeader };
            let sections = unsafe { slice::from_raw_parts(sections_ptr, num_sections as usize) };

            for section in sections {
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
        sum += u64::try_from(data.len()).unwrap();
        sum = (sum & 0xffff) + (sum >> 16);
        let final_sum: u32 = u32::try_from((sum & 0xffff) + (sum >> 16)).unwrap();

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
        // PORT NOTE: reshaped for borrowck — capture needed scalars from opt before re-borrowing self.data
        let file_alignment = unsafe { (*opt).file_alignment };
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
        let new_headers_end =
            self.section_headers_offset + size_of::<SectionHeader>() * (self.num_sections as usize + 1);
        let new_size_of_headers =
            align_up_u32(u32::try_from(new_headers_end).unwrap(), file_alignment)?;

        // Determine first_raw (min PointerToRawData among sections with raw data, else data.len)
        let mut first_raw: u32 = u32::try_from(self.data.len()).unwrap();
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
        let payload_len = u32::try_from(data_to_embed.len() + 8).unwrap(); // 8 for LE length prefix
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
            slice::from_raw_parts(
                &sh as *const SectionHeader as *const u8,
                size_of::<SectionHeader>(),
            )
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

    /// Find the .bun section and return its data
    pub fn get_bun_section_data(&self) -> Result<&[u8], Error> {
        let section_headers = self.get_section_headers()?;
        for section in section_headers {
            if section.name[0..8] == BUN_SECTION_NAME {
                // Header: 8 bytes size (u64)
                if (section.size_of_raw_data as usize) < size_of::<u64>() {
                    return Err(Error::InvalidBunSection);
                }

                // Bounds check
                if section.pointer_to_raw_data as usize >= self.data.len()
                    || (section.pointer_to_raw_data + section.size_of_raw_data) as usize
                        > self.data.len()
                {
                    return Err(Error::InvalidBunSection);
                }

                let section_data = &self.data[section.pointer_to_raw_data as usize..]
                    [..section.size_of_raw_data as usize];
                let data_size = u64::from_le_bytes(section_data[0..8].try_into().unwrap());

                if data_size + size_of::<u64>() as u64 > section.size_of_raw_data as u64 {
                    return Err(Error::InvalidBunSection);
                }

                // Data starts at offset 8 (after u64 size)
                return Ok(&section_data[8..][..data_size as usize]);
            }
        }
        Err(Error::BunSectionNotFound)
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
                return Ok(u64::from_le_bytes(section_data[0..8].try_into().unwrap()));
            }
        }
        Err(Error::BunSectionNotFound)
    }

    /// Write the modified PE file
    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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

/// Utilities for PE file detection and validation
pub mod utils {
    use super::*;

    pub fn is_pe(data: &[u8]) -> bool {
        if data.len() < size_of::<DOSHeader>() {
            return false;
        }

        // SAFETY: bounds-checked above; DOSHeader is #[repr(C)] POD at offset 0
        // TODO(port): potentially unaligned — Zig used *align(1) const DOSHeader
        let dos = unsafe { &*(data.as_ptr() as *const DOSHeader) };
        if dos.e_magic != DOS_SIGNATURE {
            return false;
        }

        let off = dos.e_lfanew as usize;
        if off < size_of::<DOSHeader>() || off > data.len().saturating_sub(size_of::<PEHeader>()) {
            return false;
        }

        // SAFETY: bounds-checked above; PEHeader is #[repr(C)] POD
        // TODO(port): potentially unaligned — Zig used *align(1) const PEHeader
        let pe = unsafe { &*(data.as_ptr().add(off) as *const PEHeader) };
        pe.signature == PE_SIGNATURE
    }
}

/// Windows-specific external interface for accessing embedded Bun data
/// This matches the macOS interface but for PE files
pub const BUN_COMPILED_SECTION_NAME: &str = ".bun";

/// External C interface declarations - these are implemented in C++ bindings
/// The C++ code uses Windows PE APIs to directly access the .bun section
/// from the current process memory without loading the entire executable
// TODO(port): move to exe_format_sys
unsafe extern "C" {
    pub fn Bun__getStandaloneModuleGraphPELength() -> u32;
    pub fn Bun__getStandaloneModuleGraphPEData() -> *mut u8;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/exe_format/pe.zig (748 lines)
//   confidence: medium
//   todos:      6
//   notes:      Zig *align(1) T views ported as raw pointers + unsafe deref; Phase B must resolve unaligned-access UB (packed repr or read_unaligned)
// ──────────────────────────────────────────────────────────────────────────
