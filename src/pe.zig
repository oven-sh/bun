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

    // Resource types
    const RT_ICON = 3;
    const RT_GROUP_ICON = 14;
    const RT_VERSION = 16;

    // Language and code page IDs
    const LANGUAGE_ID_EN_US: u16 = 1033; // 0x0409, en-US
    const CODE_PAGE_ID_EN_US: u16 = 1200; // 0x04B0, UTF-16LE

    // Version info constants
    const VS_FFI_SIGNATURE: u32 = 0xFEEF04BD;
    const VS_FFI_STRUCVERSION: u32 = 0x00010000;
    const VS_FFI_FILEFLAGSMASK: u32 = 0x0000003F;
    const VOS_NT_WINDOWS32: u32 = 0x00040004;
    const VFT_APP: u32 = 0x00000001;

    // Resource directory structures
    const ResourceDirectoryTable = extern struct {
        characteristics: u32,
        time_date_stamp: u32,
        major_version: u16,
        minor_version: u16,
        number_of_name_entries: u16,
        number_of_id_entries: u16,
    };

    const ResourceDirectoryEntry = extern struct {
        name_or_id: u32,
        offset_to_data: u32,
    };

    const ResourceDataEntry = extern struct {
        offset_to_data: u32,
        size: u32,
        code_page: u32,
        reserved: u32,
    };

    // Icon structures
    const IconDirectory = extern struct {
        reserved: u16,
        type: u16,
        count: u16,
    };

    const IconDirectoryEntry = extern struct {
        width: u8,
        height: u8,
        color_count: u8,
        reserved: u8,
        planes: u16,
        bit_count: u16,
        bytes_in_res: u32,
        image_offset: u32,
    };

    const GroupIconDirectoryEntry = extern struct {
        width: u8,
        height: u8,
        color_count: u8,
        reserved: u8,
        planes: u16,
        bit_count: u16,
        bytes_in_res: u32,
        id: u16,
    };

    // Version info structures
    const VS_FIXEDFILEINFO = extern struct {
        signature: u32,
        struct_version: u32,
        file_version_ms: u32,
        file_version_ls: u32,
        product_version_ms: u32,
        product_version_ls: u32,
        file_flags_mask: u32,
        file_flags: u32,
        file_os: u32,
        file_type: u32,
        file_subtype: u32,
        file_date_ms: u32,
        file_date_ls: u32,
    };

    const VS_VERSIONINFO = struct {
        length: u16,
        value_length: u16,
        type: u16,
        key: []const u16, // "VS_VERSION_INFO"
        padding1: []const u8,
        fixed_file_info: VS_FIXEDFILEINFO,
        padding2: []const u8,
        children: []const u8,
    };

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

        // Update PE checksum after adding section
        self.updateChecksum();
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

    /// Calculate PE checksum using the standard Windows algorithm
    pub fn calculateChecksum(self: *const PEFile) u32 {
        const data = self.data.items;
        const file_size = data.len;

        // Find checksum field offset
        const checksum_offset = self.optional_header_offset + @offsetOf(OptionalHeader64, "checksum");

        var checksum: u64 = 0;
        var i: usize = 0;

        // Process file as 16-bit words
        while (i + 1 < file_size) : (i += 2) {
            // Skip the checksum field itself (4 bytes)
            if (i == checksum_offset) {
                i += 2; // Skip 4 bytes total
                continue;
            }

            // Add 16-bit word to checksum
            const word = std.mem.readInt(u16, data[i..][0..2], .little);
            checksum += word;

            // Handle overflow - fold back the carry
            if (checksum > 0xFFFF) {
                checksum = (checksum & 0xFFFF) + (checksum >> 16);
            }
        }

        // If file size is odd, last byte is treated as if followed by 0x00
        if (file_size & 1 != 0) {
            checksum += data[file_size - 1];
            if (checksum > 0xFFFF) {
                checksum = (checksum & 0xFFFF) + (checksum >> 16);
            }
        }

        // Final fold
        checksum = (checksum & 0xFFFF) + (checksum >> 16);
        checksum = (checksum + (checksum >> 16)) & 0xFFFF;

        // Add file size to checksum
        checksum += file_size;

        return @intCast(checksum);
    }

    /// Update the PE checksum field
    pub fn updateChecksum(self: *PEFile) void {
        const checksum = self.calculateChecksum();
        const optional_header = self.getOptionalHeader();
        optional_header.checksum = checksum;
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

    // Resource editing functionality
    fn getResourceSection(self: *const PEFile) ?*SectionHeader {
        const section_headers = self.getSectionHeaders();
        for (section_headers) |*section| {
            if (strings.eqlComptime(section.name[0..6], ".rsrc\x00")) {
                return section;
            }
        }
        return null;
    }

    fn getResourceDirectory(self: *const PEFile) !?*ResourceDirectoryTable {
        const rsrc_section = self.getResourceSection() orelse return null;

        if (rsrc_section.pointer_to_raw_data >= self.data.items.len or
            rsrc_section.pointer_to_raw_data + rsrc_section.size_of_raw_data > self.data.items.len)
        {
            return error.InvalidResourceSection;
        }

        return @ptrCast(@alignCast(self.data.items.ptr + rsrc_section.pointer_to_raw_data));
    }

    fn findResourceEntry(self: *const PEFile, dir_offset: u32, resource_type: u32, resource_id: u32, language_id: u16) !?*ResourceDataEntry {
        const rsrc_section = self.getResourceSection() orelse return null;
        const rsrc_base = rsrc_section.pointer_to_raw_data;

        // Level 1: Type
        const type_dir: *ResourceDirectoryTable = @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + dir_offset));
        const type_entries = @as([*]ResourceDirectoryEntry, @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + dir_offset + @sizeOf(ResourceDirectoryTable))));

        const total_entries = type_dir.number_of_name_entries + type_dir.number_of_id_entries;
        var type_entry: ?*ResourceDirectoryEntry = null;

        for (0..total_entries) |i| {
            if ((type_entries[i].name_or_id & 0x7FFFFFFF) == resource_type) {
                type_entry = &type_entries[i];
                break;
            }
        }

        if (type_entry == null) return null;
        if ((type_entry.?.offset_to_data & 0x80000000) == 0) return null; // Must be directory

        // Level 2: Name/ID
        const name_dir_offset = type_entry.?.offset_to_data & 0x7FFFFFFF;
        const name_dir: *ResourceDirectoryTable = @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + name_dir_offset));
        const name_entries = @as([*]ResourceDirectoryEntry, @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + name_dir_offset + @sizeOf(ResourceDirectoryTable))));

        var name_entry: ?*ResourceDirectoryEntry = null;
        for (0..name_dir.number_of_name_entries + name_dir.number_of_id_entries) |i| {
            if ((name_entries[i].name_or_id & 0x7FFFFFFF) == resource_id) {
                name_entry = &name_entries[i];
                break;
            }
        }

        if (name_entry == null) return null;
        if ((name_entry.?.offset_to_data & 0x80000000) == 0) return null; // Must be directory

        // Level 3: Language
        const lang_dir_offset = name_entry.?.offset_to_data & 0x7FFFFFFF;
        const lang_dir: *ResourceDirectoryTable = @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + lang_dir_offset));
        const lang_entries = @as([*]ResourceDirectoryEntry, @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + lang_dir_offset + @sizeOf(ResourceDirectoryTable))));

        for (0..lang_dir.number_of_named_entries + lang_dir.number_of_id_entries) |i| {
            if ((lang_entries[i].name_or_id & 0x7FFFFFFF) == language_id) {
                if ((lang_entries[i].offset_to_data & 0x80000000) == 0) {
                    // This is a data entry
                    return @ptrCast(@alignCast(self.data.items.ptr + rsrc_base + lang_entries[i].offset_to_data));
                }
            }
        }

        return null;
    }

    pub fn applyWindowsSettings(self: *PEFile, settings: *const bun.options.WindowsSettings, allocator: Allocator) !void {
        // Handle hide console first (simple modification)
        if (settings.hide_console) {
            const optional_header = self.getOptionalHeader();
            // Change subsystem from IMAGE_SUBSYSTEM_WINDOWS_CUI (3) to IMAGE_SUBSYSTEM_WINDOWS_GUI (2)
            if (optional_header.subsystem == 3) {
                optional_header.subsystem = 2;
            }
        }

        // If no resource modifications needed, return early
        if (settings.icon == null and settings.version == null and settings.description == null and
            settings.publisher == null and settings.title == null and settings.copyright == null)
        {
            return;
        }

        // Find or create resource section
        const rsrc_section = self.getResourceSection();
        if (rsrc_section == null) {
            return error.MissingResourceSection;
        }

        // Build new resource directory
        var resource_builder = ResourceBuilder.init(allocator);
        defer resource_builder.deinit();

        // Load and process icon if provided
        if (settings.icon) |icon_path| {

            // Simple approach - just read the file
            const icon_data = std.fs.cwd().readFileAlloc(allocator, icon_path, std.math.maxInt(usize)) catch {
                return error.FileNotFound;
            };
            defer allocator.free(icon_data);

            try resource_builder.setIcon(icon_data);
        }

        // Build version info if any version fields provided
        if (settings.version != null or settings.description != null or
            settings.publisher != null or settings.title != null or settings.copyright != null)
        {
            const version_str = if (settings.version) |v| v else "1.0.0.0";
            try resource_builder.setVersionInfo(
                version_str,
                settings.description,
                settings.publisher,
                settings.title,
                settings.copyright,
            );
        }

        // Build the resource data
        const resource_data = try resource_builder.build(rsrc_section.?.virtual_address);
        defer allocator.free(resource_data);

        // Update the resource section
        try self.updateResourceSection(rsrc_section.?, resource_data);

        // Update PE checksum after all modifications
        self.updateChecksum();
    }

    fn updateResourceSection(self: *PEFile, section: *SectionHeader, data: []const u8) !void {
        const optional_header = self.getOptionalHeader();

        // Calculate aligned size
        const aligned_size = alignSize(@intCast(data.len), optional_header.file_alignment);

        // Check if we need to resize the section
        if (aligned_size > section.size_of_raw_data) {
            // This is complex - would need to move all following sections
            // For now, just error if the resource data is too large
            return error.ResourceDataTooLarge;
        }

        // Update section data
        const section_offset = section.pointer_to_raw_data;
        @memcpy(self.data.items[section_offset..][0..data.len], data);

        // Zero out remaining space
        if (data.len < section.size_of_raw_data) {
            @memset(self.data.items[section_offset + data.len .. section_offset + section.size_of_raw_data], 0);
        }

        // Update section header
        section.virtual_size = @intCast(data.len);

        // Update data directory
        optional_header.data_directories[2].size = @intCast(data.len);
    }
};

// Resource builder for creating Windows PE resources
const ResourceBuilder = struct {
    allocator: Allocator,
    root: ResourceTable,

    const ResourceTable = struct {
        entries: std.ArrayList(ResourceTableEntry),
    };

    const ResourceTableEntry = struct {
        id: u32,
        subtable: ?*ResourceTable = null,
        data: ?[]const u8 = null,
        data_offset: ?u32 = null,
        data_size: ?u32 = null,
        code_page: u32 = PEFile.CODE_PAGE_ID_EN_US,
    };

    pub fn init(allocator: Allocator) ResourceBuilder {
        return .{
            .allocator = allocator,
            .root = .{
                .entries = std.ArrayList(ResourceTableEntry).init(allocator),
            },
        };
    }

    pub fn deinit(self: *ResourceBuilder) void {
        // Recursively free all entries
        self.freeTable(&self.root);
    }

    fn freeTable(self: *ResourceBuilder, table: *ResourceTable) void {
        for (table.entries.items) |*entry| {
            if (entry.subtable) |subtable| {
                self.freeTable(subtable);
                self.allocator.destroy(subtable);
            }
            if (entry.data) |data| {
                self.allocator.free(data);
            }
        }
        table.entries.deinit();
    }

    pub fn setIcon(self: *ResourceBuilder, icon_data: []const u8) !void {
        // Parse ICO file header
        if (icon_data.len < @sizeOf(PEFile.IconDirectory)) {
            return error.InvalidIconFile;
        }

        const icon_dir = std.mem.bytesAsValue(PEFile.IconDirectory, icon_data[0..@sizeOf(PEFile.IconDirectory)]).*;
        if (icon_dir.reserved != 0 or icon_dir.type != 1) {
            return error.InvalidIconFormat;
        }

        // Get or create RT_ICON table
        const icon_table = try self.getOrCreateTable(&self.root, PEFile.RT_ICON);

        // Find first free icon ID
        var first_free_icon_id: u32 = 1;
        for (icon_table.entries.items) |entry| {
            if (entry.id >= first_free_icon_id) {
                first_free_icon_id = entry.id + 1;
            }
        }

        // Read icon entries
        var offset: usize = @sizeOf(PEFile.IconDirectory);
        var group_icon_data = std.ArrayList(u8).init(self.allocator);
        defer group_icon_data.deinit();

        // Write GRPICONDIR header
        try group_icon_data.appendSlice(std.mem.asBytes(&icon_dir));

        var i: usize = 0;
        while (i < icon_dir.count) : (i += 1) {
            if (offset + @sizeOf(PEFile.IconDirectoryEntry) > icon_data.len) {
                return error.InvalidIconFile;
            }

            const entry = std.mem.bytesAsValue(PEFile.IconDirectoryEntry, icon_data[offset..][0..@sizeOf(PEFile.IconDirectoryEntry)]).*;
            offset += @sizeOf(PEFile.IconDirectoryEntry);

            // Read the actual icon image data
            if (entry.image_offset + entry.bytes_in_res > icon_data.len) {
                return error.InvalidIconFile;
            }

            const image_data = icon_data[entry.image_offset..][0..entry.bytes_in_res];
            const icon_id = first_free_icon_id + @as(u32, @intCast(i));

            // Add individual icon to RT_ICON table
            const id_table = try self.getOrCreateTable(icon_table, icon_id);
            const lang_table = try self.getOrCreateTable(id_table, PEFile.LANGUAGE_ID_EN_US);

            // Add the actual icon data
            const data_copy = try self.allocator.dupe(u8, image_data);
            try lang_table.entries.append(.{
                .id = 0,
                .data = data_copy,
                .data_size = @intCast(data_copy.len),
                .code_page = PEFile.CODE_PAGE_ID_EN_US,
            });

            // Create GRPICONDIRENTRY for group icon
            const grp_entry = PEFile.GroupIconDirectoryEntry{
                .width = entry.width,
                .height = entry.height,
                .color_count = entry.color_count,
                .reserved = entry.reserved,
                .planes = entry.planes,
                .bit_count = entry.bit_count,
                .bytes_in_res = entry.bytes_in_res,
                .id = @intCast(icon_id),
            };
            try group_icon_data.appendSlice(std.mem.asBytes(&grp_entry));
        }

        // Get or create RT_GROUP_ICON table
        const group_table = try self.getOrCreateTable(&self.root, PEFile.RT_GROUP_ICON);
        const name_table = try self.getOrCreateTable(group_table, 1); // MAINICON ID
        const lang_table = try self.getOrCreateTable(name_table, PEFile.LANGUAGE_ID_EN_US);

        // Add group icon data
        const group_data_copy = try group_icon_data.toOwnedSlice();
        try lang_table.entries.append(.{
            .id = 0,
            .data = group_data_copy,
            .data_size = @intCast(group_data_copy.len),
            .code_page = PEFile.CODE_PAGE_ID_EN_US,
        });
    }

    // Helper to write a string as UTF-16LE with null terminator
    // Returns the number of UTF-16 characters written (including null terminator)
    fn writeUtf16String(data: *std.ArrayList(u8), str: []const u8) !u32 {
        // For simple ASCII strings (which all our resource strings are),
        // we can do a straightforward conversion
        var char_count: u32 = 0;

        for (str) |c| {
            // Write as UTF-16LE (little-endian)
            try data.append(c); // Low byte
            try data.append(0); // High byte (0 for ASCII)
            char_count += 1;
        }

        // Add null terminator
        try data.append(0);
        try data.append(0);
        char_count += 1;

        return char_count;
    }

    // Helper to align to 32-bit boundary
    fn alignTo32Bit(data: *std.ArrayList(u8)) !void {
        while (data.items.len % 4 != 0) {
            try data.append(0);
        }
    }

    // Note: Do NOT use a struct here as it gets padded to 8 bytes
    // We need exactly 6 bytes for the header

    pub fn setVersionInfo(self: *ResourceBuilder, version: []const u8, description: ?[]const u8, company: ?[]const u8, product: ?[]const u8, copyright: ?[]const u8) !void {
        // Parse version string
        var version_parts: [4]u16 = .{ 1, 0, 0, 0 };
        var iter = std.mem.tokenizeScalar(u8, version, '.');
        var i: usize = 0;
        while (iter.next()) |part| : (i += 1) {
            if (i >= 4) break;
            version_parts[i] = std.fmt.parseInt(u16, part, 10) catch 0;
        }

        const file_version_ms = (@as(u32, version_parts[0]) << 16) | version_parts[1];
        const file_version_ls = (@as(u32, version_parts[2]) << 16) | version_parts[3];

        // Build VS_VERSIONINFO structure
        var data = std.ArrayList(u8).init(self.allocator);
        defer data.deinit();

        // VS_VERSIONINFO root structure
        const vs_version_info_start = data.items.len;
        // Write header fields individually (6 bytes total) to avoid struct padding
        try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
        try data.writer().writeInt(u16, @sizeOf(PEFile.VS_FIXEDFILEINFO), .little); // wValueLength
        try data.writer().writeInt(u16, 0, .little); // wType (0 = binary)
        _ = try writeUtf16String(&data, "VS_VERSION_INFO");
        try alignTo32Bit(&data);

        // VS_FIXEDFILEINFO
        const fixed_info = PEFile.VS_FIXEDFILEINFO{
            .signature = PEFile.VS_FFI_SIGNATURE,
            .struct_version = PEFile.VS_FFI_STRUCVERSION,
            .file_version_ms = file_version_ms,
            .file_version_ls = file_version_ls,
            .product_version_ms = file_version_ms,
            .product_version_ls = file_version_ls,
            .file_flags_mask = PEFile.VS_FFI_FILEFLAGSMASK,
            .file_flags = 0,
            .file_os = PEFile.VOS_NT_WINDOWS32,
            .file_type = PEFile.VFT_APP,
            .file_subtype = 0,
            .file_date_ms = 0,
            .file_date_ls = 0,
        };
        try data.appendSlice(std.mem.asBytes(&fixed_info));
        try alignTo32Bit(&data);

        // StringFileInfo
        const string_file_info_start = data.items.len;
        // Write header fields individually to avoid struct padding
        try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
        try data.writer().writeInt(u16, 0, .little); // wValueLength
        try data.writer().writeInt(u16, 1, .little); // wType (1 = text)
        _ = try writeUtf16String(&data, "StringFileInfo");
        try alignTo32Bit(&data);

        // StringTable for 040904B0 (US English, Unicode)
        const string_table_start = data.items.len;
        // Write header fields individually to avoid struct padding
        try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
        try data.writer().writeInt(u16, 0, .little); // wValueLength
        try data.writer().writeInt(u16, 1, .little); // wType (1 = text)
        _ = try writeUtf16String(&data, "040904B0");
        try alignTo32Bit(&data);

        // Add string entries
        const version_strings = [_]struct { key: []const u8, value: ?[]const u8 }{
            .{ .key = "CompanyName", .value = company },
            .{ .key = "FileDescription", .value = description },
            .{ .key = "FileVersion", .value = version },
            .{ .key = "LegalCopyright", .value = copyright },
            .{ .key = "ProductName", .value = product },
            .{ .key = "ProductVersion", .value = version },
        };

        for (version_strings) |str| {
            if (str.value) |value| {
                const string_start = data.items.len;
                // Write header fields individually to avoid struct padding
                try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
                try data.writer().writeInt(u16, 0, .little); // wValueLength (will be updated)
                try data.writer().writeInt(u16, 1, .little); // wType (1 = text)
                _ = try writeUtf16String(&data, str.key);
                try alignTo32Bit(&data);

                // Write value and get character count for wValueLength
                const value_char_count = try writeUtf16String(&data, value);
                // wValueLength should be character count including null terminator
                const value_len = value_char_count;

                // Update string header
                const string_len = data.items.len - string_start;
                if (string_len > std.math.maxInt(u16)) return error.StringTooLong;
                if (value_len > std.math.maxInt(u16)) return error.ValueTooLong;
                std.mem.writeInt(u16, data.items[string_start..][0..2], @intCast(string_len), .little);
                std.mem.writeInt(u16, data.items[string_start + 2 ..][0..2], @intCast(value_len), .little);

                try alignTo32Bit(&data);
            }
        }

        // Update StringTable header
        const string_table_len = data.items.len - string_table_start;
        if (string_table_len > std.math.maxInt(u16)) return error.StringTableTooLong;
        std.mem.writeInt(u16, data.items[string_table_start..][0..2], @intCast(string_table_len), .little);

        // Update StringFileInfo header
        const string_file_info_len = data.items.len - string_file_info_start;
        if (string_file_info_len > std.math.maxInt(u16)) return error.StringFileInfoTooLong;
        std.mem.writeInt(u16, data.items[string_file_info_start..][0..2], @intCast(string_file_info_len), .little);

        // VarFileInfo
        const var_file_info_start = data.items.len;
        // Write header fields individually to avoid struct padding
        try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
        try data.writer().writeInt(u16, 0, .little); // wValueLength
        try data.writer().writeInt(u16, 1, .little); // wType (1 = text)
        _ = try writeUtf16String(&data, "VarFileInfo");
        try alignTo32Bit(&data);

        // Translation
        const translation_start = data.items.len;
        // Write header fields individually to avoid struct padding
        try data.writer().writeInt(u16, 0, .little); // wLength (will be updated)
        try data.writer().writeInt(u16, 4, .little); // wValueLength
        try data.writer().writeInt(u16, 0, .little); // wType (0 = binary)
        _ = try writeUtf16String(&data, "Translation");
        try alignTo32Bit(&data);

        // Language and code page
        try data.appendSlice(&[_]u8{ 0x09, 0x04, 0xB0, 0x04 }); // 0x0409, 0x04B0

        // Update Translation header
        const translation_len = data.items.len - translation_start;
        if (translation_len > std.math.maxInt(u16)) return error.TranslationTooLong;
        std.mem.writeInt(u16, data.items[translation_start..][0..2], @intCast(translation_len), .little);

        // Update VarFileInfo header
        const var_file_info_len = data.items.len - var_file_info_start;
        if (var_file_info_len > std.math.maxInt(u16)) return error.VarFileInfoTooLong;
        std.mem.writeInt(u16, data.items[var_file_info_start..][0..2], @intCast(var_file_info_len), .little);

        // Update VS_VERSIONINFO header
        const vs_version_info_len = data.items.len - vs_version_info_start;
        if (vs_version_info_len > std.math.maxInt(u16)) return error.VersionInfoTooLong;
        std.mem.writeInt(u16, data.items[vs_version_info_start..][0..2], @intCast(vs_version_info_len), .little);

        // Add to resource table
        const version_table = try self.getOrCreateTable(&self.root, PEFile.RT_VERSION);
        const id_table = try self.getOrCreateTable(version_table, 1);
        const lang_table = try self.getOrCreateTable(id_table, PEFile.LANGUAGE_ID_EN_US);

        const version_bytes = try data.toOwnedSlice();
        try lang_table.entries.append(.{
            .id = 0,
            .data = version_bytes,
            .data_size = @intCast(version_bytes.len),
            .code_page = PEFile.CODE_PAGE_ID_EN_US,
        });
    }

    fn getOrCreateTable(self: *ResourceBuilder, parent: *ResourceTable, id: u32) !*ResourceTable {
        // Look for existing entry
        for (parent.entries.items) |*entry| {
            if (entry.id == id) {
                if (entry.subtable) |subtable| {
                    return subtable;
                }
                return error.ExpectedDirectory;
            }
        }

        // Create new subtable
        const new_table = try self.allocator.create(ResourceTable);
        new_table.* = .{
            .entries = std.ArrayList(ResourceTableEntry).init(self.allocator),
        };

        try parent.entries.append(.{
            .id = id,
            .subtable = new_table,
        });

        return new_table;
    }

    pub fn build(self: *ResourceBuilder, virtual_address: u32) ![]u8 {
        var tables = std.ArrayList(u8).init(self.allocator);
        defer tables.deinit();
        var data_entries = std.ArrayList(u8).init(self.allocator);
        defer data_entries.deinit();
        var data_bytes = std.ArrayList(u8).init(self.allocator);
        defer data_bytes.deinit();

        // Calculate total sizes first
        var total_table_size: u32 = 0;
        var total_data_entries: u32 = 0;
        self.calculateTableSizes(&self.root, &total_table_size, &total_data_entries);

        // Now build with known offsets
        var tables_offset: u32 = 0;
        var data_entries_offset = total_table_size;
        var data_offset = total_table_size + total_data_entries;

        try self.writeTableRecursive(&tables, &data_entries, &data_bytes, virtual_address, &self.root, &tables_offset, &data_entries_offset, &data_offset);

        // Combine all parts
        var output = std.ArrayList(u8).init(self.allocator);
        try output.appendSlice(tables.items);
        try output.appendSlice(data_entries.items);
        try output.appendSlice(data_bytes.items);

        return output.toOwnedSlice();
    }

    fn calculateTableSizes(self: *const ResourceBuilder, table: *const ResourceTable, table_size: *u32, data_entries: *u32) void {
        const entry_count = table.entries.items.len;
        const size_increase = @sizeOf(PEFile.ResourceDirectoryTable) + entry_count * @sizeOf(PEFile.ResourceDirectoryEntry);
        table_size.* += @as(u32, @intCast(size_increase));

        for (table.entries.items) |*entry| {
            if (entry.subtable) |subtable| {
                self.calculateTableSizes(subtable, table_size, data_entries);
            } else if (entry.data != null) {
                data_entries.* += @sizeOf(PEFile.ResourceDataEntry);
            }
        }
    }

    fn writeTableRecursive(
        self: *ResourceBuilder,
        tables: *std.ArrayList(u8),
        data_entries: *std.ArrayList(u8),
        data_bytes: *std.ArrayList(u8),
        virtual_address: u32,
        table: *const ResourceTable,
        tables_offset: *u32,
        data_entries_offset: *u32,
        data_offset: *u32,
    ) !void {
        _ = tables.items.len; // dir_start - may be used for debugging

        // Write directory header
        const dir_header = PEFile.ResourceDirectoryTable{
            .characteristics = 0,
            .time_date_stamp = 0,
            .major_version = 0,
            .minor_version = 0,
            .number_of_name_entries = 0,
            .number_of_id_entries = @intCast(table.entries.items.len),
        };
        try tables.appendSlice(std.mem.asBytes(&dir_header));

        // Calculate where subdirectories will be placed
        var subdirs = std.ArrayList(struct { entry: *const ResourceTableEntry, offset: u32 }).init(self.allocator);
        defer subdirs.deinit();

        var next_table_offset = tables_offset.* + @as(u32, @intCast(tables.items.len + table.entries.items.len * @sizeOf(PEFile.ResourceDirectoryEntry)));

        // Write directory entries
        for (table.entries.items) |*entry| {
            if (entry.subtable) |subtable| {
                // Calculate subdirectory size
                var subdir_size: u32 = 0;
                var subdir_data_entries: u32 = 0;
                self.calculateTableSizes(subtable, &subdir_size, &subdir_data_entries);

                const dir_entry = PEFile.ResourceDirectoryEntry{
                    .name_or_id = entry.id,
                    .offset_to_data = 0x80000000 | (next_table_offset - tables_offset.*),
                };
                try tables.appendSlice(std.mem.asBytes(&dir_entry));

                try subdirs.append(.{ .entry = entry, .offset = next_table_offset });
                next_table_offset += subdir_size;
            } else if (entry.data) |_| {
                const data_entry_offset = data_entries_offset.* + @as(u32, @intCast(data_entries.items.len * @sizeOf(PEFile.ResourceDataEntry)));
                const dir_entry = PEFile.ResourceDirectoryEntry{
                    .name_or_id = entry.id,
                    .offset_to_data = data_entry_offset | 0x80000000, // Set high bit to indicate data entry
                };
                try tables.appendSlice(std.mem.asBytes(&dir_entry));

                // Write the data entry
                const data_byte_offset = data_offset.* + @as(u32, @intCast(data_bytes.items.len));
                const res_data_entry = PEFile.ResourceDataEntry{
                    .offset_to_data = virtual_address + data_byte_offset,
                    .size = entry.data_size.?,
                    .code_page = entry.code_page,
                    .reserved = 0,
                };
                try data_entries.appendSlice(std.mem.asBytes(&res_data_entry));
                try data_bytes.appendSlice(entry.data.?);
            }
        }

        tables_offset.* = next_table_offset;

        // Write subdirectories
        for (subdirs.items) |subdir| {
            try self.writeTableRecursive(tables, data_entries, data_bytes, virtual_address, subdir.entry.subtable.?, tables_offset, data_entries_offset, data_offset);
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
