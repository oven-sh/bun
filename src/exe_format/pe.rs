// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

use core::mem::{offset_of, size_of};

use crate::{read_struct, write_struct};

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

bun_core::named_error_set!(Error);

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

#[repr(C)]
#[derive(Copy, Clone)]
pub struct DataDirectory {
    pub virtual_address: u32,
    pub size: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SectionHeader {
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

// Directory indices and DLL characteristics
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

// Section name constant for exact comparison
const BUN_SECTION_NAME: [u8; 8] = [b'.', b'b', b'u', b'n', 0, 0, 0, 0];

// Bounds-checked unaligned read/write helpers, layered over `read_struct` /
// `write_struct` (which call `ptr::read_unaligned` / `ptr::write_unaligned`).
//
// PE headers live at arbitrary byte offsets inside a `Vec<u8>` image and have
// natural alignment >= 4, so the previous `view_at_const<T>(...) -> *const T`
// + `unsafe { &*p }` pattern at every call site was a validity-invariant UB
// (audit witness EXP-093: "constructing invalid value of type &SectionHeader:
// encountered an unaligned reference (required 4 byte alignment but found 1)").
// Return by value via `read_unaligned` and write via `write_unaligned` instead.
fn read_at<T: Copy>(buf: &[u8], off: usize) -> Result<T, Error> {
    let end = off.checked_add(size_of::<T>()).ok_or(Error::Overflow)?;
    if end > buf.len() {
        return Err(Error::OutOfBounds);
    }
    Ok(read_struct(&buf[off..end]))
}

fn write_at<T: Copy>(buf: &mut [u8], off: usize, value: &T) -> Result<(), Error> {
    let end = off.checked_add(size_of::<T>()).ok_or(Error::Overflow)?;
    if end > buf.len() {
        return Err(Error::OutOfBounds);
    }
    write_struct(&mut buf[off..end], value);
    Ok(())
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
    // Header accessors return values via `read_at` (unaligned read into an
    // owned `T`); callers that need to mutate read into a local, modify,
    // and write back via `write_at`. The previous `*const T` / `*mut T`
    // return shape forced every caller into `unsafe { &*p }` / `&mut *p`,
    // which is UB when the underlying byte offset isn't T-aligned (audit
    // witness EXP-093).
    fn get_dos_header(&self) -> Result<DOSHeader, Error> {
        read_at::<DOSHeader>(&self.data, self.dos_header_offset)
    }

    fn get_pe_header(&self) -> Result<PEHeader, Error> {
        read_at::<PEHeader>(&self.data, self.pe_header_offset)
    }

    fn get_optional_header(&self) -> Result<OptionalHeader64, Error> {
        read_at::<OptionalHeader64>(&self.data, self.optional_header_offset)
    }

    fn set_pe_header(&mut self, value: &PEHeader) -> Result<(), Error> {
        write_at::<PEHeader>(&mut self.data, self.pe_header_offset, value)
    }

    fn set_optional_header(&mut self, value: &OptionalHeader64) -> Result<(), Error> {
        write_at::<OptionalHeader64>(&mut self.data, self.optional_header_offset, value)
    }

    /// Read the section header at index `idx` (0-based). The section table is
    /// `num_sections` `SectionHeader` structs starting at
    /// `section_headers_offset`; each entry is read by value via
    /// `read_unaligned` because the table lives at an arbitrary byte offset
    /// inside the PE image (audit witness EXP-093).
    fn read_section_header(&self, idx: usize) -> Result<SectionHeader, Error> {
        if idx >= self.num_sections as usize {
            return Err(Error::OutOfBounds);
        }
        let off = self
            .section_headers_offset
            .checked_add(
                idx.checked_mul(size_of::<SectionHeader>())
                    .ok_or(Error::Overflow)?,
            )
            .ok_or(Error::Overflow)?;
        read_at::<SectionHeader>(&self.data, off)
    }

    pub fn init(pe_data: &[u8]) -> Result<Box<PEFile>, Error> {
        // 1. Reserve capacity as before
        let mut data: Vec<u8> = Vec::with_capacity(pe_data.len() + 64 * 1024);
        data.extend_from_slice(pe_data);

        // 2. Validate DOS header
        if data.len() < size_of::<DOSHeader>() {
            return Err(Error::InvalidPEFile);
        }

        let dos_header: DOSHeader = read_at(&data, 0)?;
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

        // 3. Read PE header
        let pe_off = dos_header.e_lfanew as usize;
        let pe_header: PEHeader = read_at(&data, pe_off)?;
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
        let optional_header: OptionalHeader64 = read_at(&data, optional_header_offset)?;
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

        // Walk the section table by index, reading each `SectionHeader` by
        // value via `read_unaligned` (the table lives at an arbitrary byte
        // offset; `&[SectionHeader]` over byte-aligned data is UB — audit
        // witness EXP-093).
        for sect_idx in 0..num_sections as usize {
            let sect_off = section_headers_offset + sect_idx * size_of::<SectionHeader>();
            let section: SectionHeader = read_at(&data, sect_off)?;
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
            let va_end = section.virtual_address + align_up_u32(vs_effective, section_alignment)?;
            if va_end > last_va_end {
                last_va_end = va_end;
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
        let opt: OptionalHeader64 = self.get_optional_header()?;

        // Read Security directory (index 4)
        let sec_dd = opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
        let sec_off_u32 = sec_dd.virtual_address; // file offset (not RVA)
        let sec_size_u32 = sec_dd.size;

        if sec_off_u32 == 0 || sec_size_u32 == 0 {
            return Ok(()); // nothing to strip
        }

        // Compute last_file_end from sections (reuse cached or recompute)
        let mut last_raw_end: u32 = 0;
        for i in 0..self.num_sections as usize {
            let s = self.read_section_header(i)?;
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

        // Re-read after resize (file length changed; struct contents unchanged
        // but read the current bytes to be explicit). Then zero the Security
        // directory entry and clear FORCE_INTEGRITY in the local, and write
        // the modified header back via `write_at` / `write_unaligned`.
        let mut opt_after: OptionalHeader64 = self.get_optional_header()?;
        opt_after.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY].virtual_address = 0;
        opt_after.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY].size = 0;
        if (opt_after.dll_characteristics & IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY) != 0 {
            opt_after.dll_characteristics &= !IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY;
        }
        self.set_optional_header(&opt_after)?;

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

        let mut opt: OptionalHeader64 = self.get_optional_header()?;
        opt.checksum = final_sum;
        self.set_optional_header(&opt)?;
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
            let opt: OptionalHeader64 = self.get_optional_header()?;
            let dd = opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
            if dd.virtual_address != 0 || dd.size != 0 {
                self.strip_authenticode(StripOpts {
                    require_overlay: true,
                    recompute_checksum: true,
                })?;
            }
        }

        // 2. Re-read PE/Optional (offsets unchanged; values may have moved if strip ran)
        let opt: OptionalHeader64 = self.get_optional_header()?;
        let file_alignment = opt.file_alignment;
        let section_alignment = opt.section_alignment;

        // 3. Duplicate .bun guard - compare all 8 bytes exactly
        for i in 0..self.num_sections as usize {
            let section = self.read_section_header(i)?;
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
        for i in 0..self.num_sections as usize {
            let section = self.read_section_header(i)?;
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
        for i in 0..self.num_sections as usize {
            let section = self.read_section_header(i)?;
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
        // Write the new SectionHeader via `write_unaligned` (the table lives at
        // an arbitrary byte offset; see `write_section_header`'s safety contract).
        write_at::<SectionHeader>(&mut self.data, new_sh_off, &sh)?;

        // 8. Write payload
        // At data[new_raw ..]: write u64 LE length prefix, then data
        let new_raw_usize = new_raw as usize;
        self.data[new_raw_usize..new_raw_usize + 8]
            .copy_from_slice(&(data_to_embed.len() as u64).to_le_bytes());
        self.data[new_raw_usize + 8..new_raw_usize + 8 + data_to_embed.len()]
            .copy_from_slice(data_to_embed);

        // 9. Update headers: read-modify-write each header.
        let mut pe_after: PEHeader = self.get_pe_header()?;
        pe_after.number_of_sections += 1;
        self.set_pe_header(&pe_after)?;
        self.num_sections += 1;

        {
            let mut opt_after: OptionalHeader64 = self.get_optional_header()?;
            // If opt.size_of_headers < new_size_of_headers
            if opt_after.size_of_headers < new_size_of_headers {
                opt_after.size_of_headers = new_size_of_headers;
            }
            // Calculate size_of_image: aligned end of last section
            let section_va_end = new_va + sh.virtual_size;
            opt_after.size_of_image = align_up_u32(section_va_end, opt_after.section_alignment)?;

            // Security directory must be zero (signature invalidated by change)
            let dd = &mut opt_after.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
            if dd.virtual_address != 0 || dd.size != 0 {
                dd.virtual_address = 0;
                dd.size = 0;
            }
            self.set_optional_header(&opt_after)?;
        }

        // Do not touch size_of_initialized_data (leave as is)

        // 10. Recompute checksum (recommended)
        self.recompute_pe_checksum()?;
        Ok(())
    }

    /// Find the .bun section and return its data
    pub fn get_bun_section_data(&self) -> Result<&[u8], Error> {
        for i in 0..self.num_sections as usize {
            let section = self.read_section_header(i)?;
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
                let data_size = u64::from_le_bytes(
                    section_data[0..8]
                        .try_into()
                        .expect("infallible: size matches"),
                );

                let total_size = data_size
                    .checked_add(size_of::<u64>() as u64)
                    .ok_or(Error::InvalidBunSection)?;
                if total_size > section.size_of_raw_data as u64 {
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
        for i in 0..self.num_sections as usize {
            let section = self.read_section_header(i)?;
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
    pub fn write(&self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig used `writer: anytype` (`std.Io.Writer`); std::io::Write
        // is the canonical Rust equivalent. bun_io has no Write trait.
        writer.write_all(&self.data)?;
        Ok(())
    }

    /// Validate the PE file structure
    pub fn validate(&self) -> Result<(), Error> {
        // Check DOS & PE signatures
        let dos_header: DOSHeader = self.get_dos_header()?;
        if dos_header.e_magic != DOS_SIGNATURE {
            return Err(Error::InvalidDOSSignature);
        }

        let pe_header: PEHeader = self.get_pe_header()?;
        if pe_header.signature != PE_SIGNATURE {
            return Err(Error::InvalidPESignature);
        }

        // Check optional header magic is 0x20B (64-bit)
        let optional_header: OptionalHeader64 = self.get_optional_header()?;
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

        // Validate each section. Read the table into a Vec by value (each
        // entry via `read_unaligned`) so we can iterate and compare without
        // constructing an unaligned `&[SectionHeader]` (audit witness EXP-093).
        let mut sections: Vec<SectionHeader> = Vec::with_capacity(self.num_sections as usize);
        for i in 0..self.num_sections as usize {
            sections.push(self.read_section_header(i)?);
        }
        let mut max_va_end: u32 = 0;

        for (i, section) in sections.iter().enumerate() {
            // If size_of_raw_data > 0, validate raw data bounds
            if section.size_of_raw_data > 0 {
                if section.pointer_to_raw_data < optional_header.size_of_headers
                    || (section.pointer_to_raw_data + section.size_of_raw_data) as usize
                        > self.data.len()
                {
                    return Err(Error::InvalidSectionData);
                }

                // Check for overlaps with other sections using correct interval test
                for other in &sections[i + 1..] {
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
        // Read headers by value via `read_unaligned` — the input `data` is a
        // byte slice with arbitrary alignment, so taking `&DOSHeader` /
        // `&PEHeader` references would be UB (audit witness EXP-093).
        let Ok(dos) = read_at::<DOSHeader>(data, 0) else {
            return false;
        };
        if dos.e_magic != DOS_SIGNATURE {
            return false;
        }

        let off = dos.e_lfanew as usize;
        if off < size_of::<DOSHeader>() || off > data.len().saturating_sub(size_of::<PEHeader>()) {
            return false;
        }

        let Ok(pe) = read_at::<PEHeader>(data, off) else {
            return false;
        };
        pe.signature == PE_SIGNATURE
    }
}

/// Windows-specific external interface for accessing embedded Bun data
/// This matches the macOS interface but for PE files
pub const BUN_COMPILED_SECTION_NAME: &str = ".bun";

// External C interface declarations - these are implemented in C++ bindings
// (src/jsc/bindings/c-bindings.cpp). The C++ code uses Windows PE APIs to
// directly access the .bun section from the current process memory without
// loading the entire executable.
unsafe extern "C" {
    pub fn Bun__getStandaloneModuleGraphPELength() -> u64;
    pub fn Bun__getStandaloneModuleGraphPEData() -> *mut u8;
}

// ported from: src/exe_format/pe.zig
