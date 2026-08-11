// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

use core::mem::{align_of, offset_of, size_of};

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
    #[error("InsufficientSpace")]
    InsufficientSpace,
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

// SAFETY: packed struct of unsigned integers: no padding, all bit patterns valid, Copy + 'static.
unsafe impl bytemuck::Zeroable for DOSHeader {}
// SAFETY: see the `Zeroable` impl above.
unsafe impl bytemuck::Pod for DOSHeader {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Zeroable for PEHeader {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Pod for PEHeader {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Zeroable for DataDirectory {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Pod for DataDirectory {}
// SAFETY: as for `DOSHeader`; `data_directories` is an array of the `Pod` `DataDirectory`.
unsafe impl bytemuck::Zeroable for OptionalHeader64 {}
// SAFETY: see the `Zeroable` impl above.
unsafe impl bytemuck::Pod for OptionalHeader64 {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Zeroable for SectionHeader {}
// SAFETY: as for `DOSHeader`.
unsafe impl bytemuck::Pod for SectionHeader {}

const PE_SIGNATURE: u32 = 0x0000_4550; // "PE\0\0"
const DOS_SIGNATURE: u16 = 0x5A4D; // "MZ"
const OPTIONAL_HEADER_MAGIC_64: u16 = 0x020B;

// Section characteristics
const IMAGE_SCN_CNT_INITIALIZED_DATA: u32 = 0x0000_0040;
const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;

// Directory indices and DLL characteristics
const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

pub const IMAGE_SUBSYSTEM_WINDOWS_GUI: u16 = 2;

// Section name constant for exact comparison
const BUN_SECTION_NAME: [u8; 8] = [b'.', b'b', b'u', b'n', 0, 0, 0, 0];

fn view_at<T: bytemuck::Pod>(buf: &[u8], off: usize) -> Result<&T, Error> {
    const { assert!(align_of::<T>() == 1) };
    let end = off + size_of::<T>();
    let bytes = buf.get(off..end).ok_or(Error::OutOfBounds)?;
    Ok(bytemuck::from_bytes(bytes))
}

fn view_at_mut<T: bytemuck::Pod>(buf: &mut [u8], off: usize) -> Result<&mut T, Error> {
    const { assert!(align_of::<T>() == 1) };
    let end = off + size_of::<T>();
    let bytes = buf.get_mut(off..end).ok_or(Error::OutOfBounds)?;
    Ok(bytemuck::from_bytes_mut(bytes))
}

fn section_headers_at(buf: &[u8], off: usize, count: u16) -> Result<&[SectionHeader], Error> {
    const { assert!(align_of::<SectionHeader>() == 1) };
    let end = off + size_of::<SectionHeader>() * count as usize;
    let bytes = buf.get(off..end).ok_or(Error::OutOfBounds)?;
    Ok(bytemuck::cast_slice(bytes))
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
    fn get_pe_header_mut(&mut self) -> Result<&mut PEHeader, Error> {
        view_at_mut(&mut self.data, self.pe_header_offset)
    }

    fn get_optional_header(&self) -> Result<&OptionalHeader64, Error> {
        view_at(&self.data, self.optional_header_offset)
    }

    fn get_optional_header_mut(&mut self) -> Result<&mut OptionalHeader64, Error> {
        view_at_mut(&mut self.data, self.optional_header_offset)
    }

    fn get_section_headers(&self) -> Result<&[SectionHeader], Error> {
        section_headers_at(&self.data, self.section_headers_offset, self.num_sections)
    }

    pub fn init(pe_data: &[u8]) -> Result<Box<PEFile>, Error> {
        // 1. Reserve capacity as before
        let mut data: Vec<u8> = Vec::with_capacity(pe_data.len() + 64 * 1024);
        data.extend_from_slice(pe_data);

        // 2. Validate DOS header
        if data.len() < size_of::<DOSHeader>() {
            return Err(Error::InvalidPEFile);
        }

        let dos_header = view_at::<DOSHeader>(&data, 0)?;
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
        let pe_header = view_at::<PEHeader>(&data, pe_off)?;
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
        let optional_header = view_at::<OptionalHeader64>(&data, optional_header_offset)?;
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

        // 7. Validate each section's aligned virtual extent up front.
        let section_alignment = optional_header.section_alignment;
        for section in section_headers_at(&data, section_headers_offset, num_sections)? {
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
        // Read Security directory (index 4)
        let security = self.get_optional_header()?.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
        let sec_off_u32 = security.virtual_address; // file offset (not RVA)
        let sec_size_u32 = security.size;

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

        let opt = self.get_optional_header_mut()?;
        opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY] = DataDirectory {
            virtual_address: 0,
            size: 0,
        };
        opt.dll_characteristics &= !IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY;

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

        self.get_optional_header_mut()?.checksum = final_sum;
        Ok(())
    }

    /// Add a new section to the PE file for storing Bun module data
    pub fn add_bun_section(&mut self, data_to_embed: &[u8]) -> Result<(), Error> {
        // 1. Strip Authenticode (before any addition)
        self.strip_authenticode()?;

        // 2. Read the optional header
        let opt = self.get_optional_header()?;
        let file_alignment = opt.file_alignment;
        let section_alignment = opt.section_alignment;

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
        self.data[new_sh_off..new_sh_off + size_of::<SectionHeader>()]
            .copy_from_slice(bytemuck::bytes_of(&sh));

        // 8. Write payload
        // At data[new_raw ..]: write u64 LE length prefix, then data
        let new_raw_usize = new_raw as usize;
        self.data[new_raw_usize..new_raw_usize + 8]
            .copy_from_slice(&(data_to_embed.len() as u64).to_le_bytes());
        self.data[new_raw_usize + 8..new_raw_usize + 8 + data_to_embed.len()]
            .copy_from_slice(data_to_embed);

        // 9. Update headers
        self.get_pe_header_mut()?.number_of_sections += 1;
        self.num_sections += 1;

        let opt = self.get_optional_header_mut()?;
        if opt.size_of_headers < new_size_of_headers {
            opt.size_of_headers = new_size_of_headers;
        }
        // Calculate size_of_image: aligned end of last section
        let section_va_end = new_va + sh.virtual_size;
        opt.size_of_image = align_up_u32(section_va_end, opt.section_alignment)?;

        // Security directory must be zero (signature invalidated by change)
        opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY] = DataDirectory {
            virtual_address: 0,
            size: 0,
        };

        // Do not touch size_of_initialized_data (leave as is)

        // 10. Recompute checksum (recommended)
        self.recompute_pe_checksum()?;
        Ok(())
    }

    /// Set the Windows subsystem field in the optional header. Does not recompute the checksum.
    pub fn set_subsystem(&mut self, subsystem: u16) -> Result<(), Error> {
        self.get_optional_header_mut()?.subsystem = subsystem;
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

// External C interface declarations - these are implemented in C++ bindings
// (src/jsc/bindings/c-bindings.cpp). The C++ code uses Windows PE APIs to
// directly access the .bun section from the current process memory without
// loading the entire executable.
unsafe extern "C" {
    pub fn Bun__getStandaloneModuleGraphPELength() -> u64;
    pub fn Bun__getStandaloneModuleGraphPEData() -> *mut u8;
}
