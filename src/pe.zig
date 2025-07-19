// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

/// Windows PE Binary manipulation for codesigning standalone executables
pub const PEFile = struct {
    data: std.ArrayList(u8),
    allocator: Allocator,
    // Store offsets instead of pointers to avoid invalidation after resize
    dos_header_offset: usize,
    pe_header_offset: usize,
    optional_header_offset: usize,
    section_headers_offset: usize,
    num_sections: u16,

    const DOSHeader = extern struct {
        e_magic: u16, // Magic number
        e_cblp: u16, // Bytes on last page of file
        e_cp: u16, // Pages in file
        e_crlc: u16, // Relocations
        e_cparhdr: u16, // Size of header in paragraphs
        e_minalloc: u16, // Minimum extra paragraphs needed
        e_maxalloc: u16, // Maximum extra paragraphs needed
        e_ss: u16, // Initial relative SS value
        e_sp: u16, // Initial SP value
        e_csum: u16, // Checksum
        e_ip: u16, // Initial IP value
        e_cs: u16, // Initial relative CS value
        e_lfarlc: u16, // Address of relocation table
        e_ovno: u16, // Overlay number
        e_res: [4]u16, // Reserved words
        e_oemid: u16, // OEM identifier (for e_oeminfo)
        e_oeminfo: u16, // OEM information; e_oemid specific
        e_res2: [10]u16, // Reserved words
        e_lfanew: u32, // File address of new exe header
    };

    const PEHeader = extern struct {
        signature: u32, // PE signature
        machine: u16, // Machine type
        number_of_sections: u16, // Number of sections
        time_date_stamp: u32, // Time/date stamp
        pointer_to_symbol_table: u32, // Pointer to symbol table
        number_of_symbols: u32, // Number of symbols
        size_of_optional_header: u16, // Size of optional header
        characteristics: u16, // Characteristics
    };

    const OptionalHeader64 = extern struct {
        magic: u16, // Magic number
        major_linker_version: u8, // Major linker version
        minor_linker_version: u8, // Minor linker version
        size_of_code: u32, // Size of code
        size_of_initialized_data: u32, // Size of initialized data
        size_of_uninitialized_data: u32, // Size of uninitialized data
        address_of_entry_point: u32, // Address of entry point
        base_of_code: u32, // Base of code
        image_base: u64, // Image base
        section_alignment: u32, // Section alignment
        file_alignment: u32, // File alignment
        major_operating_system_version: u16, // Major OS version
        minor_operating_system_version: u16, // Minor OS version
        major_image_version: u16, // Major image version
        minor_image_version: u16, // Minor image version
        major_subsystem_version: u16, // Major subsystem version
        minor_subsystem_version: u16, // Minor subsystem version
        win32_version_value: u32, // Win32 version value
        size_of_image: u32, // Size of image
        size_of_headers: u32, // Size of headers
        checksum: u32, // Checksum
        subsystem: u16, // Subsystem
        dll_characteristics: u16, // DLL characteristics
        size_of_stack_reserve: u64, // Size of stack reserve
        size_of_stack_commit: u64, // Size of stack commit
        size_of_heap_reserve: u64, // Size of heap reserve
        size_of_heap_commit: u64, // Size of heap commit
        loader_flags: u32, // Loader flags
        number_of_rva_and_sizes: u32, // Number of RVA and sizes
        data_directories: [16]DataDirectory, // Data directories
    };

    const DataDirectory = extern struct {
        virtual_address: u32,
        size: u32,
    };

    const SectionHeader = extern struct {
        name: [8]u8, // Section name
        virtual_size: u32, // Virtual size
        virtual_address: u32, // Virtual address
        size_of_raw_data: u32, // Size of raw data
        pointer_to_raw_data: u32, // Pointer to raw data
        pointer_to_relocations: u32, // Pointer to relocations
        pointer_to_line_numbers: u32, // Pointer to line numbers
        number_of_relocations: u16, // Number of relocations
        number_of_line_numbers: u16, // Number of line numbers
        characteristics: u32, // Characteristics
    };

    const PE_SIGNATURE = 0x00004550; // "PE\0\0"
    const DOS_SIGNATURE = 0x5A4D; // "MZ"
    const OPTIONAL_HEADER_MAGIC_64 = 0x020B;

    // Section characteristics
    const IMAGE_SCN_CNT_CODE = 0x00000020;
    const IMAGE_SCN_CNT_INITIALIZED_DATA = 0x00000040;
    const IMAGE_SCN_MEM_READ = 0x40000000;
    const IMAGE_SCN_MEM_WRITE = 0x80000000;
    const IMAGE_SCN_MEM_EXECUTE = 0x20000000;

    // Helper methods to safely access headers
    fn getDosHeader(self: *const PEFile) *DOSHeader {
        return @ptrCast(@alignCast(self.data.items.ptr + self.dos_header_offset));
    }

    fn getPEHeader(self: *const PEFile) *PEHeader {
        return @ptrCast(@alignCast(self.data.items.ptr + self.pe_header_offset));
    }

    fn getOptionalHeader(self: *const PEFile) *OptionalHeader64 {
        return @ptrCast(@alignCast(self.data.items.ptr + self.optional_header_offset));
    }

    fn getSectionHeaders(self: *const PEFile) []SectionHeader {
        return @as([*]SectionHeader, @ptrCast(@alignCast(self.data.items.ptr + self.section_headers_offset)))[0..self.num_sections];
    }

    pub fn init(allocator: Allocator, pe_data: []const u8) !*PEFile {
        // Reserve some extra space for adding sections, but no need for 16KB alignment
        var data = try std.ArrayList(u8).initCapacity(allocator, pe_data.len + 64 * 1024);
        try data.appendSlice(pe_data);

        const self = try allocator.create(PEFile);
        errdefer allocator.destroy(self);

        // Parse DOS header
        if (data.items.len < @sizeOf(DOSHeader)) {
            return error.InvalidPEFile;
        }

        const dos_header: *const DOSHeader = @ptrCast(@alignCast(data.items.ptr));
        if (dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Validate e_lfanew offset (should be reasonable)
        if (dos_header.e_lfanew < @sizeOf(DOSHeader) or dos_header.e_lfanew > 0x1000) {
            return error.InvalidPEFile;
        }

        // Calculate offsets
        const pe_header_offset = dos_header.e_lfanew;
        const optional_header_offset = pe_header_offset + @sizeOf(PEHeader);

        // Parse PE header
        if (data.items.len < pe_header_offset + @sizeOf(PEHeader)) {
            return error.InvalidPEFile;
        }

        const pe_header: *const PEHeader = @ptrCast(@alignCast(data.items.ptr + pe_header_offset));
        if (pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Parse optional header
        if (data.items.len < optional_header_offset + @sizeOf(OptionalHeader64)) {
            return error.InvalidPEFile;
        }

        const optional_header: *const OptionalHeader64 = @ptrCast(@alignCast(data.items.ptr + optional_header_offset));
        if (optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Parse section headers
        const section_headers_offset = optional_header_offset + pe_header.size_of_optional_header;
        const section_headers_size = @sizeOf(SectionHeader) * pe_header.number_of_sections;
        if (data.items.len < section_headers_offset + section_headers_size) {
            return error.InvalidPEFile;
        }

        // Check if we have space for at least one more section header (for future addition)
        const max_sections_space = section_headers_offset + @sizeOf(SectionHeader) * 96; // PE max sections
        if (data.items.len < max_sections_space) {
            // Not enough space to add sections - we'll need to handle this in addBunSection
        }

        self.* = .{
            .data = data,
            .allocator = allocator,
            .dos_header_offset = 0,
            .pe_header_offset = pe_header_offset,
            .optional_header_offset = optional_header_offset,
            .section_headers_offset = section_headers_offset,
            .num_sections = pe_header.number_of_sections,
        };

        return self;
    }

    pub fn deinit(self: *PEFile) void {
        self.data.deinit();
        self.allocator.destroy(self);
    }

    /// Add a new section to the PE file for storing Bun module data
    pub fn addBunSection(self: *PEFile, data_to_embed: []const u8) !void {
        const section_name = ".bun\x00\x00\x00\x00";
        const optional_header = self.getOptionalHeader();
        const aligned_size = alignSize(@intCast(data_to_embed.len + @sizeOf(u32)), optional_header.file_alignment);

        // Check if we can add another section
        if (self.num_sections >= 95) { // PE limit is 96 sections
            return error.TooManySections;
        }

        // Find the last section to determine where to place the new one
        var last_section_end: u32 = 0;
        var last_virtual_end: u32 = 0;

        const section_headers = self.getSectionHeaders();
        for (section_headers) |section| {
            const section_file_end = section.pointer_to_raw_data + section.size_of_raw_data;
            const section_virtual_end = section.virtual_address + alignSize(section.virtual_size, optional_header.section_alignment);

            if (section_file_end > last_section_end) {
                last_section_end = section_file_end;
            }
            if (section_virtual_end > last_virtual_end) {
                last_virtual_end = section_virtual_end;
            }
        }

        // Create new section header
        const new_section = SectionHeader{
            .name = section_name.*,
            .virtual_size = @intCast(data_to_embed.len + @sizeOf(u32)),
            .virtual_address = alignSize(last_virtual_end, optional_header.section_alignment),
            .size_of_raw_data = aligned_size,
            .pointer_to_raw_data = alignSize(last_section_end, optional_header.file_alignment),
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };

        // Resize data to accommodate new section
        const new_data_size = new_section.pointer_to_raw_data + new_section.size_of_raw_data;
        try self.data.resize(new_data_size);

        // Zero out the new section data
        @memset(self.data.items[last_section_end..new_data_size], 0);

        // Write the section header - use our stored offset
        const new_section_offset = self.section_headers_offset + @sizeOf(SectionHeader) * self.num_sections;

        // Check bounds before writing
        if (new_section_offset + @sizeOf(SectionHeader) > self.data.items.len) {
            return error.InsufficientSpace;
        }

        const new_section_ptr: *SectionHeader = @ptrCast(@alignCast(self.data.items.ptr + new_section_offset));
        new_section_ptr.* = new_section;

        // Write the data with size header
        const data_offset = new_section.pointer_to_raw_data;
        std.mem.writeInt(u32, self.data.items[data_offset..][0..4], @intCast(data_to_embed.len), .little);
        @memcpy(self.data.items[data_offset + 4 ..][0..data_to_embed.len], data_to_embed);

        // Update PE header - get fresh pointer after resize
        const pe_header = self.getPEHeader();
        pe_header.number_of_sections += 1;
        self.num_sections += 1;

        // Update optional header - get fresh pointer after resize
        const updated_optional_header = self.getOptionalHeader();
        updated_optional_header.size_of_image = alignSize(new_section.virtual_address + new_section.virtual_size, updated_optional_header.section_alignment);
        updated_optional_header.size_of_initialized_data += new_section.size_of_raw_data;
    }

    /// Find the .bun section and return its data
    pub fn getBunSectionData(self: *const PEFile) ![]const u8 {
        const section_headers = self.getSectionHeaders();
        for (section_headers) |section| {
            if (strings.eqlComptime(section.name[0..4], ".bun")) {
                if (section.size_of_raw_data < @sizeOf(u32)) {
                    return error.InvalidBunSection;
                }

                // Bounds check
                if (section.pointer_to_raw_data >= self.data.items.len or
                    section.pointer_to_raw_data + section.size_of_raw_data > self.data.items.len)
                {
                    return error.InvalidBunSection;
                }

                const section_data = self.data.items[section.pointer_to_raw_data..][0..section.size_of_raw_data];
                const data_size = std.mem.readInt(u32, section_data[0..4], .little);

                if (data_size + @sizeOf(u32) > section.size_of_raw_data) {
                    return error.InvalidBunSection;
                }

                return section_data[4..][0..data_size];
            }
        }
        return error.BunSectionNotFound;
    }

    /// Get the length of the Bun section data
    pub fn getBunSectionLength(self: *const PEFile) !u32 {
        const section_headers = self.getSectionHeaders();
        for (section_headers) |section| {
            if (strings.eqlComptime(section.name[0..4], ".bun")) {
                if (section.size_of_raw_data < @sizeOf(u32)) {
                    return error.InvalidBunSection;
                }

                // Bounds check
                if (section.pointer_to_raw_data >= self.data.items.len or
                    section.pointer_to_raw_data + @sizeOf(u32) > self.data.items.len)
                {
                    return error.InvalidBunSection;
                }

                const section_data = self.data.items[section.pointer_to_raw_data..];
                return std.mem.readInt(u32, section_data[0..4], .little);
            }
        }
        return error.BunSectionNotFound;
    }

    /// Write the modified PE file
    pub fn write(self: *const PEFile, writer: anytype) !void {
        try writer.writeAll(self.data.items);
    }

    /// Validate the PE file structure
    pub fn validate(self: *const PEFile) !void {
        // Check DOS header
        const dos_header = self.getDosHeader();
        if (dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Check PE header
        const pe_header = self.getPEHeader();
        if (pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Check optional header
        const optional_header = self.getOptionalHeader();
        if (optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Validate section headers
        const section_headers = self.getSectionHeaders();
        for (section_headers) |section| {
            if (section.pointer_to_raw_data + section.size_of_raw_data > self.data.items.len) {
                return error.InvalidSectionData;
            }
        }
    }
};

/// Align size to the nearest multiple of alignment
fn alignSize(size: u32, alignment: u32) u32 {
    if (alignment == 0) return size;
    // Check for overflow
    if (size > std.math.maxInt(u32) - alignment + 1) return std.math.maxInt(u32);
    return (size + alignment - 1) & ~(alignment - 1);
}

/// Utilities for PE file detection and validation
pub const utils = struct {
    pub fn isPE(data: []const u8) bool {
        if (data.len < @sizeOf(PEFile.DOSHeader)) return false;

        const dos_header: *const PEFile.DOSHeader = @ptrCast(@alignCast(data.ptr));
        if (dos_header.e_magic != PEFile.DOS_SIGNATURE) return false;

        if (data.len < dos_header.e_lfanew + @sizeOf(PEFile.PEHeader)) return false;

        const pe_header: *const PEFile.PEHeader = @ptrCast(@alignCast(data.ptr + dos_header.e_lfanew));
        return pe_header.signature == PEFile.PE_SIGNATURE;
    }
};

/// Windows-specific external interface for accessing embedded Bun data
/// This matches the macOS interface but for PE files
pub const BUN_COMPILED_SECTION_NAME = ".bun";

/// External C interface declarations - these are implemented in C++ bindings
/// The C++ code uses Windows PE APIs to directly access the .bun section
/// from the current process memory without loading the entire executable
extern "C" fn Bun__getStandaloneModuleGraphPELength() u32;
extern "C" fn Bun__getStandaloneModuleGraphPEData() ?[*]u8;

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const mem = std.mem;
const Allocator = mem.Allocator;
