// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

/// Windows PE Binary manipulation for codesigning standalone executables
pub const PEFile = struct {
    allocator: Allocator,
    // Parsed headers stored in memory
    dos_header: DOSHeader,
    pe_header: PEHeader,
    optional_header: OptionalHeader64,
    section_headers: std.ArrayList(SectionHeader),
    // Raw section data
    sections_data: std.ArrayList([]u8),
    // PE structure offsets for reconstruction
    pe_header_offset: u32,

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

        pub fn parse(reader: anytype) !DOSHeader {
            var header: DOSHeader = undefined;
            header.e_magic = try reader.readInt(u16, .little);
            header.e_cblp = try reader.readInt(u16, .little);
            header.e_cp = try reader.readInt(u16, .little);
            header.e_crlc = try reader.readInt(u16, .little);
            header.e_cparhdr = try reader.readInt(u16, .little);
            header.e_minalloc = try reader.readInt(u16, .little);
            header.e_maxalloc = try reader.readInt(u16, .little);
            header.e_ss = try reader.readInt(u16, .little);
            header.e_sp = try reader.readInt(u16, .little);
            header.e_csum = try reader.readInt(u16, .little);
            header.e_ip = try reader.readInt(u16, .little);
            header.e_cs = try reader.readInt(u16, .little);
            header.e_lfarlc = try reader.readInt(u16, .little);
            header.e_ovno = try reader.readInt(u16, .little);
            for (&header.e_res) |*r| {
                r.* = try reader.readInt(u16, .little);
            }
            header.e_oemid = try reader.readInt(u16, .little);
            header.e_oeminfo = try reader.readInt(u16, .little);
            for (&header.e_res2) |*r| {
                r.* = try reader.readInt(u16, .little);
            }
            header.e_lfanew = try reader.readInt(u32, .little);
            return header;
        }

        pub fn write(self: DOSHeader, writer: anytype) !void {
            try writer.writeInt(u16, self.e_magic, .little);
            try writer.writeInt(u16, self.e_cblp, .little);
            try writer.writeInt(u16, self.e_cp, .little);
            try writer.writeInt(u16, self.e_crlc, .little);
            try writer.writeInt(u16, self.e_cparhdr, .little);
            try writer.writeInt(u16, self.e_minalloc, .little);
            try writer.writeInt(u16, self.e_maxalloc, .little);
            try writer.writeInt(u16, self.e_ss, .little);
            try writer.writeInt(u16, self.e_sp, .little);
            try writer.writeInt(u16, self.e_csum, .little);
            try writer.writeInt(u16, self.e_ip, .little);
            try writer.writeInt(u16, self.e_cs, .little);
            try writer.writeInt(u16, self.e_lfarlc, .little);
            try writer.writeInt(u16, self.e_ovno, .little);
            for (self.e_res) |r| {
                try writer.writeInt(u16, r, .little);
            }
            try writer.writeInt(u16, self.e_oemid, .little);
            try writer.writeInt(u16, self.e_oeminfo, .little);
            for (self.e_res2) |r| {
                try writer.writeInt(u16, r, .little);
            }
            try writer.writeInt(u32, self.e_lfanew, .little);
        }
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

        pub fn parse(reader: anytype) !PEHeader {
            return PEHeader{
                .signature = try reader.readInt(u32, .little),
                .machine = try reader.readInt(u16, .little),
                .number_of_sections = try reader.readInt(u16, .little),
                .time_date_stamp = try reader.readInt(u32, .little),
                .pointer_to_symbol_table = try reader.readInt(u32, .little),
                .number_of_symbols = try reader.readInt(u32, .little),
                .size_of_optional_header = try reader.readInt(u16, .little),
                .characteristics = try reader.readInt(u16, .little),
            };
        }

        pub fn write(self: PEHeader, writer: anytype) !void {
            try writer.writeInt(u32, self.signature, .little);
            try writer.writeInt(u16, self.machine, .little);
            try writer.writeInt(u16, self.number_of_sections, .little);
            try writer.writeInt(u32, self.time_date_stamp, .little);
            try writer.writeInt(u32, self.pointer_to_symbol_table, .little);
            try writer.writeInt(u32, self.number_of_symbols, .little);
            try writer.writeInt(u16, self.size_of_optional_header, .little);
            try writer.writeInt(u16, self.characteristics, .little);
        }
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

        pub fn parse(reader: anytype) !OptionalHeader64 {
            var header: OptionalHeader64 = undefined;
            header.magic = try reader.readInt(u16, .little);
            header.major_linker_version = try reader.readByte();
            header.minor_linker_version = try reader.readByte();
            header.size_of_code = try reader.readInt(u32, .little);
            header.size_of_initialized_data = try reader.readInt(u32, .little);
            header.size_of_uninitialized_data = try reader.readInt(u32, .little);
            header.address_of_entry_point = try reader.readInt(u32, .little);
            header.base_of_code = try reader.readInt(u32, .little);
            header.image_base = try reader.readInt(u64, .little);
            header.section_alignment = try reader.readInt(u32, .little);
            header.file_alignment = try reader.readInt(u32, .little);
            header.major_operating_system_version = try reader.readInt(u16, .little);
            header.minor_operating_system_version = try reader.readInt(u16, .little);
            header.major_image_version = try reader.readInt(u16, .little);
            header.minor_image_version = try reader.readInt(u16, .little);
            header.major_subsystem_version = try reader.readInt(u16, .little);
            header.minor_subsystem_version = try reader.readInt(u16, .little);
            header.win32_version_value = try reader.readInt(u32, .little);
            header.size_of_image = try reader.readInt(u32, .little);
            header.size_of_headers = try reader.readInt(u32, .little);
            header.checksum = try reader.readInt(u32, .little);
            header.subsystem = try reader.readInt(u16, .little);
            header.dll_characteristics = try reader.readInt(u16, .little);
            header.size_of_stack_reserve = try reader.readInt(u64, .little);
            header.size_of_stack_commit = try reader.readInt(u64, .little);
            header.size_of_heap_reserve = try reader.readInt(u64, .little);
            header.size_of_heap_commit = try reader.readInt(u64, .little);
            header.loader_flags = try reader.readInt(u32, .little);
            header.number_of_rva_and_sizes = try reader.readInt(u32, .little);
            for (&header.data_directories) |*dir| {
                dir.* = try DataDirectory.parse(reader);
            }
            return header;
        }

        pub fn write(self: OptionalHeader64, writer: anytype) !void {
            try writer.writeInt(u16, self.magic, .little);
            try writer.writeByte(self.major_linker_version);
            try writer.writeByte(self.minor_linker_version);
            try writer.writeInt(u32, self.size_of_code, .little);
            try writer.writeInt(u32, self.size_of_initialized_data, .little);
            try writer.writeInt(u32, self.size_of_uninitialized_data, .little);
            try writer.writeInt(u32, self.address_of_entry_point, .little);
            try writer.writeInt(u32, self.base_of_code, .little);
            try writer.writeInt(u64, self.image_base, .little);
            try writer.writeInt(u32, self.section_alignment, .little);
            try writer.writeInt(u32, self.file_alignment, .little);
            try writer.writeInt(u16, self.major_operating_system_version, .little);
            try writer.writeInt(u16, self.minor_operating_system_version, .little);
            try writer.writeInt(u16, self.major_image_version, .little);
            try writer.writeInt(u16, self.minor_image_version, .little);
            try writer.writeInt(u16, self.major_subsystem_version, .little);
            try writer.writeInt(u16, self.minor_subsystem_version, .little);
            try writer.writeInt(u32, self.win32_version_value, .little);
            try writer.writeInt(u32, self.size_of_image, .little);
            try writer.writeInt(u32, self.size_of_headers, .little);
            try writer.writeInt(u32, self.checksum, .little);
            try writer.writeInt(u16, self.subsystem, .little);
            try writer.writeInt(u16, self.dll_characteristics, .little);
            try writer.writeInt(u64, self.size_of_stack_reserve, .little);
            try writer.writeInt(u64, self.size_of_stack_commit, .little);
            try writer.writeInt(u64, self.size_of_heap_reserve, .little);
            try writer.writeInt(u64, self.size_of_heap_commit, .little);
            try writer.writeInt(u32, self.loader_flags, .little);
            try writer.writeInt(u32, self.number_of_rva_and_sizes, .little);
            for (self.data_directories) |dir| {
                try dir.write(writer);
            }
        }
    };

    const DataDirectory = extern struct {
        virtual_address: u32,
        size: u32,

        pub fn parse(reader: anytype) !DataDirectory {
            return DataDirectory{
                .virtual_address = try reader.readInt(u32, .little),
                .size = try reader.readInt(u32, .little),
            };
        }

        pub fn write(self: DataDirectory, writer: anytype) !void {
            try writer.writeInt(u32, self.virtual_address, .little);
            try writer.writeInt(u32, self.size, .little);
        }
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

        pub fn parse(reader: anytype) !SectionHeader {
            var header: SectionHeader = undefined;
            _ = try reader.read(&header.name);
            header.virtual_size = try reader.readInt(u32, .little);
            header.virtual_address = try reader.readInt(u32, .little);
            header.size_of_raw_data = try reader.readInt(u32, .little);
            header.pointer_to_raw_data = try reader.readInt(u32, .little);
            header.pointer_to_relocations = try reader.readInt(u32, .little);
            header.pointer_to_line_numbers = try reader.readInt(u32, .little);
            header.number_of_relocations = try reader.readInt(u16, .little);
            header.number_of_line_numbers = try reader.readInt(u16, .little);
            header.characteristics = try reader.readInt(u32, .little);
            return header;
        }

        pub fn write(self: SectionHeader, writer: anytype) !void {
            try writer.writeAll(&self.name);
            try writer.writeInt(u32, self.virtual_size, .little);
            try writer.writeInt(u32, self.virtual_address, .little);
            try writer.writeInt(u32, self.size_of_raw_data, .little);
            try writer.writeInt(u32, self.pointer_to_raw_data, .little);
            try writer.writeInt(u32, self.pointer_to_relocations, .little);
            try writer.writeInt(u32, self.pointer_to_line_numbers, .little);
            try writer.writeInt(u16, self.number_of_relocations, .little);
            try writer.writeInt(u16, self.number_of_line_numbers, .little);
            try writer.writeInt(u32, self.characteristics, .little);
        }
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

    // Data directory indices
    const IMAGE_DIRECTORY_ENTRY_RESOURCE = 2;

    pub fn parseFromFile(allocator: Allocator, file_path: []const u8) !*PEFile {
        const file = try std.fs.cwd().openFile(file_path, .{});
        defer file.close();
        
        const stream = file.reader();
        return parse(allocator, stream);
    }

    pub fn parse(allocator: Allocator, reader: anytype) !*PEFile {
        const self = try allocator.create(PEFile);
        errdefer allocator.destroy(self);

        // Parse DOS header
        self.dos_header = try DOSHeader.parse(reader);
        if (self.dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Validate e_lfanew offset (should be reasonable)
        if (self.dos_header.e_lfanew < @sizeOf(DOSHeader) or self.dos_header.e_lfanew > 0x1000) {
            return error.InvalidPEFile;
        }

        // Seek to PE header
        try reader.context.seekTo(self.dos_header.e_lfanew);
        self.pe_header_offset = self.dos_header.e_lfanew;

        // Parse PE header
        self.pe_header = try PEHeader.parse(reader);
        if (self.pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Parse optional header
        self.optional_header = try OptionalHeader64.parse(reader);
        if (self.optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Skip any extra optional header data
        // The size_of_optional_header might be smaller than our struct if it's an older PE format
        if (self.pe_header.size_of_optional_header > @sizeOf(OptionalHeader64)) {
            const optional_header_extra = self.pe_header.size_of_optional_header - @sizeOf(OptionalHeader64);
            try reader.skipBytes(optional_header_extra, .{});
        }

        // Parse section headers
        self.section_headers = std.ArrayList(SectionHeader).init(allocator);
        errdefer self.section_headers.deinit();
        try self.section_headers.ensureTotalCapacity(self.pe_header.number_of_sections);
        
        var i: u16 = 0;
        while (i < self.pe_header.number_of_sections) : (i += 1) {
            const section = try SectionHeader.parse(reader);
            try self.section_headers.append(section);
        }

        // Read section data
        self.sections_data = std.ArrayList([]u8).init(allocator);
        errdefer {
            for (self.sections_data.items) |data| {
                allocator.free(data);
            }
            self.sections_data.deinit();
        }

        for (self.section_headers.items, 0..) |section, idx| {
            if (section.size_of_raw_data > 0) {
                const data = try allocator.alloc(u8, section.size_of_raw_data);
                errdefer allocator.free(data);
                
                // For buffer-based streams, check if the section is within bounds
                var can_read = true;
                if (std.io.FixedBufferStream([]const u8) == @TypeOf(reader.context)) {
                    const buffer_len = reader.context.buffer.len;
                    if (section.pointer_to_raw_data >= buffer_len or 
                        section.pointer_to_raw_data + section.size_of_raw_data > buffer_len) {
                        can_read = false;
                    }
                } else if (std.io.FixedBufferStream([]u8) == @TypeOf(reader.context)) {
                    const buffer_len = reader.context.buffer.len;
                    if (section.pointer_to_raw_data >= buffer_len or 
                        section.pointer_to_raw_data + section.size_of_raw_data > buffer_len) {
                        can_read = false;
                    }
                }
                
                if (can_read) {
                    // For file-based streams, seek to section data
                    // For buffer-based streams, sections should be in order
                    if (std.io.StreamSource == @TypeOf(reader.context)) {
                        try reader.context.seekTo(section.pointer_to_raw_data);
                    } else if (std.io.FixedBufferStream([]const u8) == @TypeOf(reader.context)) {
                        try reader.context.seekTo(section.pointer_to_raw_data);
                    } else if (std.io.FixedBufferStream([]u8) == @TypeOf(reader.context)) {
                        try reader.context.seekTo(section.pointer_to_raw_data);
                    }
                    
                    try reader.readNoEof(data);
                } else {
                    // Section is out of bounds - fill with zeros
                    @memset(data, 0);
                }
                
                try self.sections_data.append(data);
            } else {
                try self.sections_data.append(&.{});
            }
        }

        self.allocator = allocator;
        return self;
    }

    pub fn deinit(self: *PEFile) void {
        self.section_headers.deinit();
        for (self.sections_data.items) |data| {
            if (data.len > 0) {
                self.allocator.free(data);
            }
        }
        self.sections_data.deinit();
        self.allocator.destroy(self);
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
        for (self.section_headers.items, self.sections_data.items) |section, data| {
            if (section.size_of_raw_data != data.len) {
                return error.InvalidSectionData;
            }
        }
    }

    /// Calculate PE checksum (required for valid executables)
    fn calculateChecksum(file_data: []const u8) u32 {
        var checksum: u64 = 0;
        var i: usize = 0;
        
        // Process file as 16-bit words
        while (i + 2 <= file_data.len) : (i += 2) {
            const word = @as(u16, file_data[i]) | (@as(u16, file_data[i + 1]) << 8);
            checksum = (checksum & 0xFFFF) +% word +% (checksum >> 16);
        }
        
        // Handle odd byte at end
        if (i < file_data.len) {
            checksum = (checksum & 0xFFFF) +% file_data[i] +% (checksum >> 16);
        }
        
        // Fold carry bits
        checksum = (checksum & 0xFFFF) +% (checksum >> 16);
        checksum = (checksum & 0xFFFF) +% (checksum >> 16);
        
        // Final checksum - need to use wrapping add to avoid overflow
        const result = @as(u32, @truncate(checksum)) +% @as(u32, @truncate(file_data.len));
        return result;
    }

    /// Add .bun section to PE file for standalone executables
    pub fn addBunSection(
        allocator: Allocator,
        input_path: []const u8,
        output_path: []const u8,
        bun_data: []const u8,
    ) !void {
        
        // Read entire file into memory
        const file_data = try std.fs.cwd().readFileAlloc(allocator, input_path, 500 * 1024 * 1024);
        defer allocator.free(file_data);
        
        // Parse PE structure
        var stream = std.io.fixedBufferStream(file_data);
        const pe = try PEFile.parse(allocator, stream.reader());
        defer pe.deinit();
        
        // Check if .bun section already exists
        for (pe.section_headers.items) |section| {
            const name = std.mem.sliceTo(&section.name, 0);
            if (strings.eql(name, BUN_COMPILED_SECTION_NAME)) {
                return error.BunSectionAlreadyExists;
            }
        }
        
        // Calculate new section parameters
        var last_section_virtual_addr: u32 = 0;
        var last_section_file_offset: u32 = pe.optional_header.size_of_headers;
        
        for (pe.section_headers.items) |section| {
            const virtual_end = section.virtual_address +% alignSize(
                if (section.virtual_size > 0) section.virtual_size else section.size_of_raw_data,
                pe.optional_header.section_alignment
            );
            if (virtual_end > last_section_virtual_addr) {
                last_section_virtual_addr = virtual_end;
            }
            
            const file_end = section.pointer_to_raw_data +% section.size_of_raw_data;
            if (file_end > last_section_file_offset) {
                last_section_file_offset = file_end;
            }
        }
        
        // Create new .bun section header
        const aligned_bun_size = alignSize(@intCast(bun_data.len), pe.optional_header.file_alignment);
        const new_bun_section = SectionHeader{
            .name = ".bun\x00\x00\x00\x00".*,
            .virtual_size = @intCast(bun_data.len),
            .virtual_address = alignSize(last_section_virtual_addr, pe.optional_header.section_alignment),
            .size_of_raw_data = aligned_bun_size,
            .pointer_to_raw_data = alignSize(last_section_file_offset, pe.optional_header.file_alignment),
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };
        
        // Calculate new headers size
        const new_section_count = pe.pe_header.number_of_sections +% 1;
        const headers_size = pe.pe_header_offset +% @sizeOf(PEHeader) +% pe.pe_header.size_of_optional_header +% 
                           @as(u32, new_section_count) *% @sizeOf(SectionHeader);
        const new_size_of_headers = alignSize(headers_size, pe.optional_header.file_alignment);
        
        if (new_size_of_headers > pe.optional_header.size_of_headers) {
            return error.NotEnoughSpaceForNewSection;
        }
        
        // Allocate buffer for modified file
        const output_size = new_bun_section.pointer_to_raw_data +% new_bun_section.size_of_raw_data;
        const output_data = try allocator.alloc(u8, output_size);
        defer allocator.free(output_data);
        
        // Copy original file up to section headers
        const section_headers_offset = pe.pe_header_offset +% @sizeOf(PEHeader) +% pe.pe_header.size_of_optional_header;
        @memcpy(output_data[0..section_headers_offset], file_data[0..section_headers_offset]);
        
        // Update PE header with new section count
        std.mem.writeInt(u16, output_data[pe.pe_header_offset +% 6..][0..2], new_section_count, .little);
        
        // Copy existing section headers
        const existing_sections_size = @as(u32, pe.pe_header.number_of_sections) *% @sizeOf(SectionHeader);
        @memcpy(output_data[section_headers_offset..][0..existing_sections_size], 
                file_data[section_headers_offset..][0..existing_sections_size]);
        
        // Write new .bun section header
        const new_section_offset = section_headers_offset +% existing_sections_size;
        @memcpy(output_data[new_section_offset..][0..@sizeOf(SectionHeader)], std.mem.asBytes(&new_bun_section));
        
        // Copy rest of original file (section data)
        const remaining_start = section_headers_offset +% existing_sections_size +% @sizeOf(SectionHeader);
        const remaining_size = file_data.len -% (section_headers_offset +% existing_sections_size);
        if (remaining_size > 0 and remaining_start < file_data.len) {
            const copy_size = @min(remaining_size, output_data.len - remaining_start);
            @memcpy(output_data[remaining_start..][0..copy_size], 
                    file_data[section_headers_offset +% existing_sections_size..][0..copy_size]);
        }
        
        // Write .bun section data
        @memcpy(output_data[new_bun_section.pointer_to_raw_data..][0..bun_data.len], bun_data);
        if (aligned_bun_size > bun_data.len) {
            @memset(output_data[new_bun_section.pointer_to_raw_data +% bun_data.len..][0..aligned_bun_size -% bun_data.len], 0);
        }
        
        // Update SizeOfImage
        const new_size_of_image = new_bun_section.virtual_address +% 
                                alignSize(new_bun_section.virtual_size, pe.optional_header.section_alignment);
        const size_of_image_offset = pe.pe_header_offset +% @sizeOf(PEHeader) +% 56;
        std.mem.writeInt(u32, output_data[size_of_image_offset..][0..4], new_size_of_image, .little);
        
        // Calculate and update PE checksum
        const checksum_offset = pe.pe_header_offset +% @sizeOf(PEHeader) +% 64;
        std.mem.writeInt(u32, output_data[checksum_offset..][0..4], 0, .little);
        const new_checksum = calculateChecksum(output_data);
        std.mem.writeInt(u32, output_data[checksum_offset..][0..4], new_checksum, .little);
        
        // Write output file
        // Use Bun's file writing utilities for better cross-platform support
        std.fs.cwd().writeFile(.{
            .sub_path = output_path,
            .data = output_data,
        }) catch |err| {
            // If we get permission errors, it might be because we're in a temp directory
            // Try to ensure the parent directory exists and is writable
            if (err == error.AccessDenied or err == error.FileNotFound) {
                const dir_path = std.fs.path.dirname(output_path) orelse ".";
                std.fs.cwd().makePath(dir_path) catch {};
                
                // Try again
                return std.fs.cwd().writeFile(.{
                    .sub_path = output_path,
                    .data = output_data,
                });
            }
            return err;
        };
    }
    
    /// Update PE file resources - handles both in-place updates and section expansion
    pub fn updateResourceSection(
        allocator: Allocator,
        input_path: []const u8,
        output_path: []const u8,
        resource_data: []const u8,
    ) !void {
        // Open files for streaming
        const in_file = try std.fs.cwd().openFile(input_path, .{});
        defer in_file.close();
        
        const out_file = try std.fs.cwd().createFile(output_path, .{ .mode = 0o666, .read = true });
        defer out_file.close();
        
        // Parse PE headers
        const pe = try PEFile.parse(allocator, in_file.reader());
        defer pe.deinit();
        
        // Reset file position
        try in_file.seekTo(0);
        
        // Find .rsrc section
        var rsrc_index: ?usize = null;
        var rsrc_section: ?*SectionHeader = null;
        var is_bun_rsrc = false;
        for (pe.section_headers.items, 0..) |*section, i| {
            const name = std.mem.sliceTo(&section.name, 0);
            if (strings.eql(name, ".rsrc")) {
                rsrc_index = i;
                rsrc_section = section;
                
                // Check if this is Bun's internal .rsrc section
                if (i < pe.sections_data.items.len and pe.sections_data.items[i].len >= 4) {
                    const section_data = pe.sections_data.items[i];
                    const characteristics = std.mem.readInt(u32, section_data[0..4], .little);
                    if (characteristics == 0x03b0cef9) { // Bun's magic bytes (little-endian)
                        is_bun_rsrc = true;
                    }
                }
                break;
            }
        }

        const aligned_resource_size = alignSize(@intCast(resource_data.len), pe.optional_header.file_alignment);
        
        if (rsrc_section) |section| {
            // For Bun executables with internal .rsrc data, always move the section to the end
            if (is_bun_rsrc) {
                try appendResourceSection(allocator, in_file, out_file, pe, rsrc_index.?, resource_data);
            } else if (aligned_resource_size <= section.size_of_raw_data) {
                // Case 1: Update existing .rsrc section in-place
                // New resources fit - copy file up to resource section
                try copyBytes(in_file, out_file, section.pointer_to_raw_data);
                
                // Write new resource data
                try out_file.writeAll(resource_data);
                
                
                // Pad to maintain alignment
                const padding = section.size_of_raw_data - resource_data.len;
                if (padding > 0) {
                    const zero_buf = try allocator.alloc(u8, @min(padding, 4096));
                    defer allocator.free(zero_buf);
                    @memset(zero_buf, 0);
                    
                    var remaining = padding;
                    while (remaining > 0) {
                        const to_write = @min(remaining, zero_buf.len);
                        try out_file.writeAll(zero_buf[0..to_write]);
                        remaining -= to_write;
                    }
                }
                
                // Copy rest of file
                try in_file.seekTo(section.pointer_to_raw_data + section.size_of_raw_data);
                try copyToEnd(in_file, out_file);
                
                // Now update headers in the output file
                try updateResourceDirectory(out_file, pe, section.virtual_address, @intCast(resource_data.len));
                
                // Update virtual size in section header
                const section_header_offset = pe.pe_header_offset + @sizeOf(PEHeader) + pe.pe_header.size_of_optional_header + 
                                            (rsrc_index.? * @sizeOf(SectionHeader));
                try out_file.seekTo(section_header_offset + @offsetOf(SectionHeader, "virtual_size"));
                var buf: [4]u8 = undefined;
                std.mem.writeInt(u32, &buf, @intCast(resource_data.len), .little);
                try out_file.writeAll(&buf);
                
                // Update checksum
                try updateChecksum(allocator, out_file, pe.pe_header_offset);
            } else {
                // New resources don't fit - need to move section to end of file
                try appendResourceSection(allocator, in_file, out_file, pe, rsrc_index.?, resource_data);
            }
        } else {
            // Case 2: No .rsrc section exists - need to add one
            try addNewResourceSection(allocator, in_file, out_file, pe, resource_data);
        }
        
        // Ensure all data is written to disk
        try out_file.sync();
    }
    
    /// Copy bytes from input to output
    fn copyBytes(in_file: std.fs.File, out_file: std.fs.File, count: usize) !void {
        var buf: [8192]u8 = undefined;
        var remaining = count;
        while (remaining > 0) {
            const to_read = @min(remaining, buf.len);
            const bytes_read = try in_file.read(buf[0..to_read]);
            if (bytes_read == 0) break;
            try out_file.writeAll(buf[0..bytes_read]);
            remaining -= bytes_read;
        }
    }
    
    /// Copy from current position to end of file
    fn copyToEnd(in_file: std.fs.File, out_file: std.fs.File) !void {
        var buf: [8192]u8 = undefined;
        while (true) {
            const bytes_read = try in_file.read(&buf);
            if (bytes_read == 0) break;
            try out_file.writeAll(buf[0..bytes_read]);
        }
    }
    
    /// Update resource directory in PE headers
    fn updateResourceDirectory(file: std.fs.File, pe: *const PEFile, rva: u32, size: u32) !void {
        const data_dir_offset = pe.pe_header_offset + @sizeOf(PEHeader) + 120 + 
                              (IMAGE_DIRECTORY_ENTRY_RESOURCE * @sizeOf(DataDirectory));
        try file.seekTo(data_dir_offset);
        var buf: [8]u8 = undefined;
        std.mem.writeInt(u32, buf[0..4], rva, .little);
        std.mem.writeInt(u32, buf[4..8], size, .little);
        try file.writeAll(&buf);
    }
    
    /// Append resource section when it doesn't fit in existing space
    fn appendResourceSection(
        allocator: Allocator,
        in_file: std.fs.File,
        out_file: std.fs.File,
        pe: *const PEFile,
        rsrc_index: usize,
        resource_data: []const u8,
    ) !void {
        _ = try in_file.getEndPos(); // Validate file is readable
        const aligned_resource_size = alignSize(@intCast(resource_data.len), pe.optional_header.file_alignment);
        
        // Calculate new file layout
        var last_section_end: u32 = 0;
        for (pe.section_headers.items, 0..) |section, i| {
            const section_end = section.pointer_to_raw_data + section.size_of_raw_data;
            if (section_end > last_section_end) {
                last_section_end = section_end;
            }
        }
        
        // Get the actual file size to ensure we place resources after all data
        const file_size = try in_file.getEndPos();
        
        // New pointer to raw data for the moved resource section - must be after all file data
        const new_pointer_to_raw_data = alignSize(@max(last_section_end, @as(u32, @intCast(file_size))), pe.optional_header.file_alignment);
        
        // Copy file up to resource section
        try in_file.seekTo(0);
        const rsrc_section = &pe.section_headers.items[rsrc_index];
        try copyBytes(in_file, out_file, rsrc_section.pointer_to_raw_data);
        
        
        // Pad to new resource location
        const current_pos = try out_file.getPos();
        const padding_needed = if (new_pointer_to_raw_data > current_pos) new_pointer_to_raw_data - current_pos else 0;
        if (padding_needed > 0) {
            const zero_buf = try allocator.alloc(u8, @min(padding_needed, 4096));
            defer allocator.free(zero_buf);
            @memset(zero_buf, 0);
            
            var remaining = padding_needed;
            while (remaining > 0) {
                const to_write = @min(remaining, zero_buf.len);
                try out_file.writeAll(zero_buf[0..to_write]);
                remaining -= to_write;
            }
        }
        
        // Write new resource data
        try out_file.writeAll(resource_data);
        
        // Pad resource data
        const resource_padding = aligned_resource_size - resource_data.len;
        if (resource_padding > 0) {
            const zero_buf = try allocator.alloc(u8, @min(resource_padding, 4096));
            defer allocator.free(zero_buf);
            @memset(zero_buf, 0);
            
            var remaining = resource_padding;
            while (remaining > 0) {
                const to_write = @min(remaining, zero_buf.len);
                try out_file.writeAll(zero_buf[0..to_write]);
                remaining -= to_write;
            }
        }
        
        // Copy everything after the old .rsrc section
        const old_rsrc_end = rsrc_section.pointer_to_raw_data + rsrc_section.size_of_raw_data;
        
        if (old_rsrc_end < file_size) {
            try in_file.seekTo(old_rsrc_end);
            try copyToEnd(in_file, out_file);
        }
        
        // The resources were already written at new_pointer_to_raw_data, so use that as the final location
        const final_pointer_to_raw_data = new_pointer_to_raw_data;
        
        // Now update the headers
        // Update section header for resource section
        const section_header_offset = pe.pe_header_offset + @sizeOf(PEHeader) + pe.pe_header.size_of_optional_header + 
                                    (rsrc_index * @sizeOf(SectionHeader));
        try out_file.seekTo(section_header_offset + @offsetOf(SectionHeader, "size_of_raw_data"));
        var buf: [4]u8 = undefined;
        std.mem.writeInt(u32, &buf, aligned_resource_size, .little);
        try out_file.writeAll(&buf);
        
        try out_file.seekTo(section_header_offset + @offsetOf(SectionHeader, "pointer_to_raw_data"));
        std.mem.writeInt(u32, &buf, final_pointer_to_raw_data, .little);
        try out_file.writeAll(&buf);
        
        // Update virtual size if needed
        try out_file.seekTo(section_header_offset + @offsetOf(SectionHeader, "virtual_size"));
        std.mem.writeInt(u32, &buf, @intCast(resource_data.len), .little);
        try out_file.writeAll(&buf);
        
        // Update sections that come after the resource section
        for (pe.section_headers.items, 0..) |section, i| {
            if (section.pointer_to_raw_data > rsrc_section.pointer_to_raw_data) {
                const offset_diff = final_pointer_to_raw_data - rsrc_section.pointer_to_raw_data;
                const this_section_header_offset = pe.pe_header_offset + @sizeOf(PEHeader) + 
                                                 pe.pe_header.size_of_optional_header + (i * @sizeOf(SectionHeader));
                try out_file.seekTo(this_section_header_offset + @offsetOf(SectionHeader, "pointer_to_raw_data"));
                std.mem.writeInt(u32, &buf, section.pointer_to_raw_data + offset_diff, .little);
                try out_file.writeAll(&buf);
            }
        }
        
        // Update SizeOfImage if needed
        const new_size_of_image = calculateSizeOfImage(pe, rsrc_section.virtual_address, aligned_resource_size);
        const size_of_image_offset = pe.pe_header_offset + @sizeOf(PEHeader) + 56;
        try out_file.seekTo(size_of_image_offset);
        std.mem.writeInt(u32, &buf, new_size_of_image, .little);
        try out_file.writeAll(&buf);
        
        // Update resource directory
        try updateResourceDirectory(out_file, pe, rsrc_section.virtual_address, @intCast(resource_data.len));
        
        // Update checksum
        try updateChecksum(allocator, out_file, pe.pe_header_offset);
    }
    
    /// Add a completely new resource section
    fn addNewResourceSection(
        allocator: Allocator,
        in_file: std.fs.File,
        out_file: std.fs.File,
        pe: *const PEFile,
        resource_data: []const u8,
    ) !void {
        // Check if we have space in the headers for a new section
        const new_section_count = pe.pe_header.number_of_sections + 1;
        const headers_size = pe.pe_header_offset + @sizeOf(PEHeader) + pe.pe_header.size_of_optional_header + 
                           @as(u32, new_section_count) * @sizeOf(SectionHeader);
        const new_size_of_headers = alignSize(headers_size, pe.optional_header.file_alignment);
        
        if (new_size_of_headers > pe.optional_header.size_of_headers) {
            return error.NotEnoughSpaceForNewSection;
        }
        
        // Find last section
        var last_section_virtual_addr: u32 = 0;
        var last_section_file_offset: u32 = pe.optional_header.size_of_headers;
        
        for (pe.section_headers.items) |section| {
            const virtual_end = section.virtual_address + alignSize(
                if (section.virtual_size > 0) section.virtual_size else section.size_of_raw_data,
                pe.optional_header.section_alignment
            );
            if (virtual_end > last_section_virtual_addr) {
                last_section_virtual_addr = virtual_end;
            }
            
            const file_end = section.pointer_to_raw_data + section.size_of_raw_data;
            if (file_end > last_section_file_offset) {
                last_section_file_offset = file_end;
            }
        }
        
        const aligned_resource_size = alignSize(@intCast(resource_data.len), pe.optional_header.file_alignment);
        
        // Create new .rsrc section header
        const new_rsrc_section = SectionHeader{
            .name = ".rsrc\x00\x00\x00".*,
            .virtual_size = @intCast(resource_data.len),
            .virtual_address = alignSize(last_section_virtual_addr, pe.optional_header.section_alignment),
            .size_of_raw_data = aligned_resource_size,
            .pointer_to_raw_data = alignSize(last_section_file_offset, pe.optional_header.file_alignment),
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };
        
        // Copy file up to section headers
        try in_file.seekTo(0);
        const section_headers_offset = pe.pe_header_offset + @sizeOf(PEHeader) + pe.pe_header.size_of_optional_header;
        try copyBytes(in_file, out_file, section_headers_offset);
        
        // Update PE header with new section count
        try out_file.seekTo(pe.pe_header_offset + 6);
        var buf: [2]u8 = undefined;
        std.mem.writeInt(u16, &buf, new_section_count, .little);
        try out_file.writeAll(&buf);
        
        // Copy existing section headers
        try out_file.seekTo(section_headers_offset);
        try in_file.seekTo(section_headers_offset);
        const existing_sections_size = @as(u32, pe.pe_header.number_of_sections) * @sizeOf(SectionHeader);
        try copyBytes(in_file, out_file, existing_sections_size);
        
        // Write new section header
        var section_buf: [@sizeOf(SectionHeader)]u8 = undefined;
        @memcpy(&section_buf, std.mem.asBytes(&new_rsrc_section));
        try out_file.writeAll(&section_buf);
        
        // Copy rest of file up to where new resource section will go
        const current_pos = section_headers_offset + existing_sections_size + @sizeOf(SectionHeader);
        const bytes_to_copy = new_rsrc_section.pointer_to_raw_data - current_pos;
        try copyBytes(in_file, out_file, bytes_to_copy);
        
        // Write resource data
        try out_file.writeAll(resource_data);
        
        // Pad resource section
        const padding = aligned_resource_size - resource_data.len;
        if (padding > 0) {
            const zero_buf = try allocator.alloc(u8, @min(padding, 4096));
            defer allocator.free(zero_buf);
            @memset(zero_buf, 0);
            
            var remaining = padding;
            while (remaining > 0) {
                const to_write = @min(remaining, zero_buf.len);
                try out_file.writeAll(zero_buf[0..to_write]);
                remaining -= to_write;
            }
        }
        
        // Update headers
        const new_size_of_image = new_rsrc_section.virtual_address + 
                                alignSize(new_rsrc_section.virtual_size, pe.optional_header.section_alignment);
        const size_of_image_offset = pe.pe_header_offset + @sizeOf(PEHeader) + 56;
        try out_file.seekTo(size_of_image_offset);
        var buf4: [4]u8 = undefined;
        std.mem.writeInt(u32, &buf4, new_size_of_image, .little);
        try out_file.writeAll(&buf4);
        
        // Update resource directory
        try updateResourceDirectory(out_file, pe, new_rsrc_section.virtual_address, @intCast(resource_data.len));
        
        // Update checksum
        try updateChecksum(allocator, out_file, pe.pe_header_offset);
    }
    
    fn calculateSizeOfImage(pe: *const PEFile, new_rsrc_va: u32, new_rsrc_size: u32) u32 {
        var max_va: u32 = 0;
        for (pe.section_headers.items) |section| {
            if (std.mem.eql(u8, std.mem.sliceTo(&section.name, 0), ".rsrc")) {
                const end_va = new_rsrc_va + alignSize(new_rsrc_size, pe.optional_header.section_alignment);
                if (end_va > max_va) max_va = end_va;
            } else {
                const size = if (section.virtual_size > 0) section.virtual_size else section.size_of_raw_data;
                const end_va = section.virtual_address + alignSize(size, pe.optional_header.section_alignment);
                if (end_va > max_va) max_va = end_va;
            }
        }
        return max_va;
    }
    
    /// Update checksum by reading the entire file
    fn updateChecksum(allocator: Allocator, file: std.fs.File, pe_header_offset: u32) !void {
        const file_size = try file.getEndPos();
        const data = try allocator.alloc(u8, file_size);
        defer allocator.free(data);
        
        try file.seekTo(0);
        _ = try file.read(data);
        
        // Zero out checksum field before calculation
        const checksum_offset = pe_header_offset + @sizeOf(PEHeader) + 64;
        std.mem.writeInt(u32, data[checksum_offset..][0..4], 0, .little);
        
        const new_checksum = calculateChecksum(data);
        
        // Write new checksum
        try file.seekTo(checksum_offset);
        var buf: [4]u8 = undefined;
        std.mem.writeInt(u32, &buf, new_checksum, .little);
        try file.writeAll(&buf);
    }
};

/// Align size to the nearest multiple of alignment
fn alignSize(size: u32, alignment: u32) u32 {
    if (alignment == 0) return size;
    return (size +% alignment -% 1) & ~(alignment -% 1);
}

/// Utilities for PE file detection and validation
pub const utils = struct {
    pub fn isPE(reader: anytype) bool {
        const start_pos = reader.context.getPos() catch return false;
        defer reader.context.seekTo(start_pos) catch {};

        const dos_header = PEFile.DOSHeader.parse(reader) catch return false;
        if (dos_header.e_magic != PEFile.DOS_SIGNATURE) return false;

        reader.context.seekTo(dos_header.e_lfanew) catch return false;
        const pe_signature = reader.readInt(u32, .little) catch return false;
        
        return pe_signature == PEFile.PE_SIGNATURE;
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