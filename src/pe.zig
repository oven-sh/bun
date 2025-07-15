const std = @import("std");
const mem = std.mem;
const Allocator = mem.Allocator;
const bun = @import("bun");
const strings = bun.strings;

pub const BLOB_HEADER_ALIGNMENT = 16 * 1024;

/// Windows PE Binary manipulation for codesigning standalone executables
pub const PEFile = struct {
    data: std.ArrayList(u8),
    allocator: Allocator,
    dos_header: *DOSHeader,
    pe_header: *PEHeader,
    optional_header: *OptionalHeader64,
    section_headers: []SectionHeader,
    
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

    pub fn init(allocator: Allocator, pe_data: []const u8) !*PEFile {
        var data = try std.ArrayList(u8).initCapacity(allocator, pe_data.len + BLOB_HEADER_ALIGNMENT);
        try data.appendSlice(pe_data);

        const self = try allocator.create(PEFile);
        errdefer allocator.destroy(self);

        // Parse DOS header
        if (data.items.len < @sizeOf(DOSHeader)) {
            return error.InvalidPEFile;
        }

        const dos_header: *DOSHeader = @ptrCast(@alignCast(data.items.ptr));
        if (dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Parse PE header
        if (data.items.len < dos_header.e_lfanew + @sizeOf(PEHeader)) {
            return error.InvalidPEFile;
        }

        const pe_header: *PEHeader = @ptrCast(@alignCast(data.items.ptr + dos_header.e_lfanew));
        if (pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Parse optional header
        const optional_header_offset = dos_header.e_lfanew + @sizeOf(PEHeader);
        if (data.items.len < optional_header_offset + @sizeOf(OptionalHeader64)) {
            return error.InvalidPEFile;
        }

        const optional_header: *OptionalHeader64 = @ptrCast(@alignCast(data.items.ptr + optional_header_offset));
        if (optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Parse section headers
        const section_headers_offset = optional_header_offset + pe_header.size_of_optional_header;
        const section_headers_size = @sizeOf(SectionHeader) * pe_header.number_of_sections;
        if (data.items.len < section_headers_offset + section_headers_size) {
            return error.InvalidPEFile;
        }

        const section_headers: []SectionHeader = @as([*]SectionHeader, @ptrCast(@alignCast(data.items.ptr + section_headers_offset)))[0..pe_header.number_of_sections];

        self.* = .{
            .data = data,
            .allocator = allocator,
            .dos_header = dos_header,
            .pe_header = pe_header,
            .optional_header = optional_header,
            .section_headers = section_headers,
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
        const aligned_size = alignSize(@intCast(data_to_embed.len + @sizeOf(u32)), self.optional_header.file_alignment);
        
        // Check if we can add another section
        if (self.pe_header.number_of_sections >= 95) { // PE limit is 96 sections
            return error.TooManySections;
        }

        // Find the last section to determine where to place the new one
        var last_section_end: u32 = 0;
        var last_virtual_end: u32 = 0;
        
        for (self.section_headers) |section| {
            const section_file_end = section.pointer_to_raw_data + section.size_of_raw_data;
            const section_virtual_end = section.virtual_address + alignSize(section.virtual_size, self.optional_header.section_alignment);
            
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
            .virtual_address = alignSize(last_virtual_end, self.optional_header.section_alignment),
            .size_of_raw_data = aligned_size,
            .pointer_to_raw_data = alignSize(last_section_end, self.optional_header.file_alignment),
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

        // Write the section header
        const section_headers_offset = self.dos_header.e_lfanew + @sizeOf(PEHeader) + self.pe_header.size_of_optional_header;
        const new_section_offset = section_headers_offset + @sizeOf(SectionHeader) * self.pe_header.number_of_sections;
        
        const new_section_ptr: *SectionHeader = @ptrCast(@alignCast(self.data.items.ptr + new_section_offset));
        new_section_ptr.* = new_section;

        // Write the data with size header
        const data_offset = new_section.pointer_to_raw_data;
        std.mem.writeInt(u32, self.data.items[data_offset..][0..4], @intCast(data_to_embed.len), .little);
        @memcpy(self.data.items[data_offset + 4..][0..data_to_embed.len], data_to_embed);

        // Update PE header
        self.pe_header.number_of_sections += 1;

        // Update optional header
        self.optional_header.size_of_image = alignSize(new_section.virtual_address + new_section.virtual_size, self.optional_header.section_alignment);
        self.optional_header.size_of_initialized_data += new_section.size_of_raw_data;

        // Update section headers slice
        self.section_headers = @as([*]SectionHeader, @ptrCast(@alignCast(self.data.items.ptr + section_headers_offset)))[0..self.pe_header.number_of_sections];
    }

    /// Find the .bun section and return its data
    pub fn getBunSectionData(self: *const PEFile) ![]const u8 {
        for (self.section_headers) |section| {
            if (strings.eqlComptime(section.name[0..4], ".bun")) {
                if (section.size_of_raw_data < @sizeOf(u32)) {
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
        for (self.section_headers) |section| {
            if (strings.eqlComptime(section.name[0..4], ".bun")) {
                if (section.size_of_raw_data < @sizeOf(u32)) {
                    return error.InvalidBunSection;
                }
                
                const section_data = self.data.items[section.pointer_to_raw_data..][0..section.size_of_raw_data];
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
        if (self.dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Check PE header
        if (self.pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Check optional header
        if (self.optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Validate section headers
        for (self.section_headers) |section| {
            if (section.pointer_to_raw_data + section.size_of_raw_data > self.data.items.len) {
                return error.InvalidSectionData;
            }
        }
    }
};

/// Align size to the nearest multiple of alignment
fn alignSize(size: u32, alignment: u32) u32 {
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

/// Global storage for the embedded Bun data (similar to macOS BUN_COMPILED)
var bun_section_data: ?[]const u8 = null;
var bun_section_length: u32 = 0;

/// Initialize the Bun section data from the current executable
/// This should be called once at startup
pub fn initializeBunSection() void {
    if (bun_section_data != null) return; // Already initialized
    
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();
    
    // Try to read the current executable
    const exe_path = std.fs.selfExePathAlloc(allocator) catch return;
    defer allocator.free(exe_path);
    
    const exe_file = std.fs.openFileAbsolute(exe_path, .{}) catch return;
    defer exe_file.close();
    
    const exe_size = exe_file.getEndPos() catch return;
    const exe_data = allocator.alloc(u8, exe_size) catch return;
    defer allocator.free(exe_data);
    
    _ = exe_file.readAll(exe_data) catch return;
    
    // Parse the PE file
    const pe_file = PEFile.init(allocator, exe_data) catch return;
    defer pe_file.deinit();
    
    // Get the Bun section data
    const section_data = pe_file.getBunSectionData() catch return;
    
    // Allocate persistent storage for the section data
    const persistent_data = std.heap.page_allocator.alloc(u8, section_data.len) catch return;
    @memcpy(persistent_data, section_data);
    
    bun_section_data = persistent_data;
    bun_section_length = @intCast(section_data.len);
}

/// External C interface for accessing the Bun section length
/// This will be called from C++ code to get the embedded data size
export fn Bun__getStandaloneModuleGraphPELength() callconv(.C) u32 {
    if (bun_section_data == null) {
        initializeBunSection();
    }
    return bun_section_length;
}

/// External C interface for accessing the Bun section data
/// This will be called from C++ code to get the embedded data
export fn Bun__getStandaloneModuleGraphPEData() callconv(.C) ?[*]const u8 {
    if (bun_section_data == null) {
        initializeBunSection();
    }
    return if (bun_section_data) |data| data.ptr else null;
}