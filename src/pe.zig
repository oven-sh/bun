// Windows PE sections use standard file alignment (typically 512 bytes)
// No special 16KB alignment needed like macOS code signing

// New error types for PE manipulation
pub const Error = error{
    OutOfBounds,
    BadAlignment,
    Overflow,
    InvalidPEFile,
    InvalidDOSSignature,
    InvalidPESignature,
    UnsupportedPEFormat,
    InsufficientHeaderSpace,
    TooManySections,
    SectionExists,
    InputIsSigned,
    InvalidSecurityDirectory,
    SecurityDirInsideImage,
    UnexpectedOverlayPresent,
    InvalidSectionData,
    BunSectionNotFound,
    InvalidBunSection,
    InsufficientSpace,
    SizeOfImageMismatch,
};

// Enums for strip modes and options
pub const StripMode = enum { none, strip_if_signed, strip_always };
pub const StripOpts = struct {
    require_overlay: bool = true,
    recompute_checksum: bool = true,
};

/// Windows PE Binary manipulation for codesigning standalone executables
pub const PEFile = struct {
    data: std.array_list.Managed(u8),
    allocator: Allocator,
    // Store offsets instead of pointers to avoid invalidation after resize
    dos_header_offset: usize,
    pe_header_offset: usize,
    optional_header_offset: usize,
    section_headers_offset: usize,
    num_sections: u16,
    // Cached values from init
    first_raw: u32,
    last_file_end: u32,
    last_va_end: u32,

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

    // Directory indices and DLL characteristics
    const IMAGE_DIRECTORY_ENTRY_EXPORT: usize = 0;
    const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
    const IMAGE_DIRECTORY_ENTRY_EXCEPTION: usize = 3;
    const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
    const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
    const IMAGE_DIRECTORY_ENTRY_TLS: usize = 9;
    const IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG: usize = 10;
    const IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT: usize = 13;
    const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

    // Base-relocation types (high 4 bits of each 16-bit entry)
    const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;
    const IMAGE_REL_BASED_DIR64: u16 = 10;

    // Import-thunk ordinal flag (PE32+)
    const IMAGE_ORDINAL_FLAG64: u64 = 0x8000000000000000;

    // Windows page-protection constants (for LinkedAddon.sections[].final_protect)
    const PAGE_READONLY: u32 = 0x02;
    const PAGE_READWRITE: u32 = 0x04;
    const PAGE_EXECUTE_READ: u32 = 0x20;
    const PAGE_EXECUTE_READWRITE: u32 = 0x40;

    const ImageImportDescriptor = extern struct {
        original_first_thunk: u32, // RVA of ILT
        time_date_stamp: u32,
        forwarder_chain: u32,
        name: u32, // RVA of null-terminated DLL name
        first_thunk: u32, // RVA of IAT
    };

    const ImageDelayloadDescriptor = extern struct {
        attributes: u32,
        dll_name_rva: u32,
        module_handle_rva: u32,
        import_address_table_rva: u32,
        import_name_table_rva: u32,
        bound_import_address_table_rva: u32,
        unload_information_table_rva: u32,
        time_date_stamp: u32,
    };

    const ImageExportDirectory = extern struct {
        characteristics: u32,
        time_date_stamp: u32,
        major_version: u16,
        minor_version: u16,
        name: u32,
        base: u32,
        number_of_functions: u32,
        number_of_names: u32,
        address_of_functions: u32, // RVA of u32[number_of_functions]
        address_of_names: u32, // RVA of u32[number_of_names] (each an RVA to a name)
        address_of_name_ordinals: u32, // RVA of u16[number_of_names]
    };

    const ImageBaseRelocation = extern struct {
        virtual_address: u32, // page RVA
        size_of_block: u32, // includes this header
    };

    const RuntimeFunction = extern struct {
        begin_address: u32,
        end_address: u32,
        unwind_info: u32,
    };

    // Section name constant for exact comparison
    const BUN_SECTION_NAME = [_]u8{ '.', 'b', 'u', 'n', 0, 0, 0, 0 };
    const BUNL_SECTION_NAME = [_]u8{ '.', 'b', 'u', 'n', 'L', 0, 0, 0 };

    // Safe access helpers for unaligned views
    fn viewAtConst(comptime T: type, buf: []const u8, off: usize) !*align(1) const T {
        if (off + @sizeOf(T) > buf.len) return error.OutOfBounds;
        return @ptrCast(buf[off .. off + @sizeOf(T)].ptr);
    }

    fn viewAtMut(comptime T: type, buf: []u8, off: usize) !*align(1) T {
        if (off + @sizeOf(T) > buf.len) return error.OutOfBounds;
        return @ptrCast(buf[off .. off + @sizeOf(T)].ptr);
    }

    fn isPow2(x: u32) bool {
        return x != 0 and (x & (x - 1)) == 0;
    }

    fn alignUpU32(v: u32, a: u32) !u32 {
        if (a == 0) return v;
        if (!isPow2(a)) return error.BadAlignment;
        const add = a - 1;
        if (v > std.math.maxInt(u32) - add) return error.Overflow;
        return (v + add) & ~add;
    }

    fn alignUpUsize(v: usize, a: usize) !usize {
        if (a == 0) return v;
        if ((a & (a - 1)) != 0) return error.BadAlignment;
        const add = a - 1;
        if (v > std.math.maxInt(usize) - add) return error.Overflow;
        return (v + add) & ~add;
    }

    // Helper methods to safely access headers using unaligned pointers
    fn getDosHeader(self: *const PEFile) !*align(1) const DOSHeader {
        return viewAtConst(DOSHeader, self.data.items, self.dos_header_offset);
    }

    fn getDosHeaderMut(self: *PEFile) !*align(1) DOSHeader {
        return viewAtMut(DOSHeader, self.data.items, self.dos_header_offset);
    }

    fn getPEHeader(self: *const PEFile) !*align(1) const PEHeader {
        return viewAtConst(PEHeader, self.data.items, self.pe_header_offset);
    }

    fn getPEHeaderMut(self: *PEFile) !*align(1) PEHeader {
        return viewAtMut(PEHeader, self.data.items, self.pe_header_offset);
    }

    fn getOptionalHeader(self: *const PEFile) !*align(1) const OptionalHeader64 {
        return viewAtConst(OptionalHeader64, self.data.items, self.optional_header_offset);
    }

    fn getOptionalHeaderMut(self: *PEFile) !*align(1) OptionalHeader64 {
        return viewAtMut(OptionalHeader64, self.data.items, self.optional_header_offset);
    }

    fn getSectionHeaders(self: *const PEFile) ![]align(1) const SectionHeader {
        const start = self.section_headers_offset;
        const size = @sizeOf(SectionHeader) * self.num_sections;
        if (start + size > self.data.items.len) return error.OutOfBounds;
        const ptr: [*]align(1) const SectionHeader = @ptrCast(self.data.items[start..].ptr);
        return ptr[0..self.num_sections];
    }

    fn getSectionHeadersMut(self: *PEFile) ![]align(1) SectionHeader {
        const start = self.section_headers_offset;
        const size = @sizeOf(SectionHeader) * self.num_sections;
        if (start + size > self.data.items.len) return error.OutOfBounds;
        const ptr: [*]align(1) SectionHeader = @ptrCast(self.data.items[start..].ptr);
        return ptr[0..self.num_sections];
    }

    pub fn init(allocator: Allocator, pe_data: []const u8) !*PEFile {
        // 1. Reserve capacity as before
        var data = try std.array_list.Managed(u8).initCapacity(allocator, pe_data.len + 64 * 1024);
        try data.appendSlice(pe_data);

        const self = try allocator.create(PEFile);
        errdefer allocator.destroy(self);

        // 2. Validate DOS header
        if (data.items.len < @sizeOf(DOSHeader)) {
            return error.InvalidPEFile;
        }

        const dos_header = try viewAtConst(DOSHeader, data.items, 0);
        if (dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        // Bound e_lfanew against file size, not 0x1000
        if (dos_header.e_lfanew < @sizeOf(DOSHeader)) {
            return error.InvalidPEFile;
        }
        if (dos_header.e_lfanew > data.items.len -| @sizeOf(PEHeader)) {
            return error.InvalidPEFile;
        }

        // 3. Read PE header via viewAtMut
        const pe_off = dos_header.e_lfanew;
        const pe_header = try viewAtMut(PEHeader, data.items, pe_off);
        if (pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // 4. Compute optional_header_offset
        const optional_header_offset = pe_off + @sizeOf(PEHeader);
        if (data.items.len < optional_header_offset + pe_header.size_of_optional_header) {
            return error.InvalidPEFile;
        }
        if (pe_header.size_of_optional_header < @sizeOf(OptionalHeader64)) {
            return error.InvalidPEFile;
        }

        // 5. Read optional header
        const optional_header = try viewAtMut(OptionalHeader64, data.items, optional_header_offset);
        if (optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Validate file_alignment and section_alignment
        if (!isPow2(optional_header.file_alignment) or !isPow2(optional_header.section_alignment)) {
            return error.BadAlignment;
        }
        // If section_alignment < 4096, then file_alignment == section_alignment
        if (optional_header.section_alignment < 4096) {
            if (optional_header.file_alignment != optional_header.section_alignment) {
                return error.InvalidPEFile;
            }
        }

        // 6. Compute section_headers_offset
        const section_headers_offset = optional_header_offset + pe_header.size_of_optional_header;
        const num_sections = pe_header.number_of_sections;
        if (num_sections > 96) { // PE limit
            return error.TooManySections;
        }
        const section_headers_size = @sizeOf(SectionHeader) * num_sections;
        if (data.items.len < section_headers_offset + section_headers_size) {
            return error.InvalidPEFile;
        }

        // 7. Precompute first_raw, last_file_end, last_va_end
        var first_raw: u32 = @intCast(data.items.len);
        var last_file_end: u32 = 0;
        var last_va_end: u32 = 0;

        if (num_sections > 0) {
            const sections_ptr: [*]align(1) const SectionHeader = @ptrCast(data.items[section_headers_offset..].ptr);
            const sections = sections_ptr[0..num_sections];

            for (sections) |section| {
                if (section.size_of_raw_data > 0) {
                    if (section.pointer_to_raw_data < first_raw) {
                        first_raw = section.pointer_to_raw_data;
                    }
                    const file_end = section.pointer_to_raw_data + section.size_of_raw_data;
                    if (file_end > last_file_end) {
                        last_file_end = file_end;
                    }
                }
                // Use effective virtual size (max of virtual_size and size_of_raw_data)
                const vs_effective = @max(section.virtual_size, section.size_of_raw_data);
                const va_end = section.virtual_address + (try alignUpU32(vs_effective, optional_header.section_alignment));
                if (va_end > last_va_end) {
                    last_va_end = va_end;
                }
            }
        }

        self.* = .{
            .data = data,
            .allocator = allocator,
            .dos_header_offset = 0,
            .pe_header_offset = pe_off,
            .optional_header_offset = optional_header_offset,
            .section_headers_offset = section_headers_offset,
            .num_sections = num_sections,
            .first_raw = first_raw,
            .last_file_end = last_file_end,
            .last_va_end = last_va_end,
        };

        return self;
    }

    pub fn deinit(self: *PEFile) void {
        self.data.deinit();
        self.allocator.destroy(self);
    }

    /// Strip Authenticode signatures from the PE file
    pub fn stripAuthenticode(self: *PEFile, opts: StripOpts) !void {
        const data = self.data.items;
        const opt = try viewAtMut(OptionalHeader64, data, self.optional_header_offset);

        // Read Security directory (index 4)
        const dd_ptr: *align(1) DataDirectory = &opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
        const sec_off_u32 = dd_ptr.virtual_address; // file offset (not RVA)
        const sec_size_u32 = dd_ptr.size;

        if (sec_off_u32 == 0 or sec_size_u32 == 0) return; // nothing to strip

        // Compute last_file_end from sections (reuse cached or recompute)
        var last_raw_end: u32 = 0;
        const sections = try self.getSectionHeaders();
        for (sections) |s| {
            const end = s.pointer_to_raw_data + s.size_of_raw_data;
            if (end > last_raw_end) last_raw_end = end;
        }

        const file_len = data.len;
        const sec_off = @as(usize, sec_off_u32);
        const sec_size = @as(usize, sec_size_u32);

        if (sec_off >= file_len or sec_size == 0) return error.InvalidSecurityDirectory;
        if (opts.require_overlay and sec_off < @as(usize, last_raw_end))
            return error.SecurityDirInsideImage;

        // Remove certificate plus 8-byte padding at tail
        const end_raw = try alignUpUsize(sec_off + sec_size, 8);
        if (end_raw > file_len) return error.InvalidSecurityDirectory;

        if (end_raw == file_len) {
            try self.data.resize(sec_off);
        } else {
            const tail_len = file_len - end_raw;
            // Use copyBackwards for potentially overlapping memory regions
            std.mem.copyBackwards(u8, self.data.items[sec_off .. sec_off + tail_len], self.data.items[end_raw..file_len]);
            try self.data.resize(sec_off + tail_len);
        }

        // Re-get pointers after resize
        const opt_after = try self.getOptionalHeaderMut();
        const dd_after: *align(1) DataDirectory = &opt_after.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];

        // Zero Security directory entry
        dd_after.virtual_address = 0;
        dd_after.size = 0;

        // Clear FORCE_INTEGRITY bit if set
        if ((opt_after.dll_characteristics & IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY) != 0)
            opt_after.dll_characteristics &= ~IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY;

        // Recompute checksum (recommended)
        if (opts.recompute_checksum) try self.recomputePEChecksum();

        // After strip, ensure no remaining overlay beyond last section
        const after_strip_len = self.data.items.len;
        if (@as(usize, last_raw_end) < after_strip_len)
            return error.UnexpectedOverlayPresent;
    }

    /// Recompute PE checksum according to Windows spec
    fn recomputePEChecksum(self: *PEFile) !void {
        const data = self.data.items;
        const checksum_off = self.optional_header_offset + @offsetOf(OptionalHeader64, "checksum");

        // Zero checksum field before summing
        @memset(self.data.items[checksum_off .. checksum_off + 4], 0);

        var sum: u64 = 0;
        var i: usize = 0;

        // Sum 16-bit words
        while (i + 1 < data.len) : (i += 2) {
            const w: u16 = @as(u16, data[i]) | (@as(u16, data[i + 1]) << 8);
            sum += w;
            sum = (sum & 0xffff) + (sum >> 16); // fold periodically
        }
        // Odd trailing byte
        if ((data.len & 1) != 0) {
            sum += data[data.len - 1];
        }

        // Final folds + add length
        sum = (sum & 0xffff) + (sum >> 16);
        sum = (sum & 0xffff) + (sum >> 16);
        sum += @as(u64, @intCast(data.len));
        sum = (sum & 0xffff) + (sum >> 16);
        const final_sum: u32 = @intCast((sum & 0xffff) + (sum >> 16));

        const opt = try self.getOptionalHeaderMut();
        opt.checksum = final_sum;
    }

    /// Add a new section to the PE file for storing Bun module data
    pub fn addBunSection(self: *PEFile, data_to_embed: []const u8, strip: StripMode) !void {
        // 1. Optional strip (before any addition)
        if (strip == .strip_always) {
            try self.stripAuthenticode(.{ .require_overlay = true, .recompute_checksum = true });
        } else if (strip == .strip_if_signed) {
            // Read Security directory to check if signed
            const opt = try self.getOptionalHeader();
            const dd = opt.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
            if (dd.virtual_address != 0 or dd.size != 0) {
                try self.stripAuthenticode(.{ .require_overlay = true, .recompute_checksum = true });
            }
        }

        // 2. Re-read PE/Optional (pointers may have moved due to resize in strip)
        const opt = try self.getOptionalHeaderMut();

        // 3. Duplicate .bun guard - compare all 8 bytes exactly
        const section_headers = try self.getSectionHeaders();
        for (section_headers) |section| {
            if (std.mem.eql(u8, section.name[0..8], &BUN_SECTION_NAME)) {
                return error.SectionExists;
            }
        }

        // Check if we can add another section
        if (self.num_sections >= 96) { // PE limit
            return error.TooManySections;
        }

        // 4. Compute header slack requirement
        const new_headers_end = self.section_headers_offset + @sizeOf(SectionHeader) * (self.num_sections + 1);
        const new_size_of_headers = try alignUpU32(@intCast(new_headers_end), opt.file_alignment);

        // Determine first_raw (min PointerToRawData among sections with raw data, else data.len)
        var first_raw: u32 = @intCast(self.data.items.len);
        for (section_headers) |section| {
            if (section.size_of_raw_data > 0) {
                if (section.pointer_to_raw_data < first_raw) {
                    first_raw = section.pointer_to_raw_data;
                }
            }
        }

        // Require new_size_of_headers <= first_raw
        if (new_size_of_headers > first_raw) {
            return error.InsufficientHeaderSpace;
        }

        // 5. Placement calculations
        // Recompute last_file_end and last_va_end after strip
        var last_file_end: u32 = 0;
        var last_va_end: u32 = 0;
        for (section_headers) |section| {
            const file_end = section.pointer_to_raw_data + section.size_of_raw_data;
            if (file_end > last_file_end) {
                last_file_end = file_end;
            }
            // Use effective virtual size (max of virtual_size and size_of_raw_data)
            const vs_effective = @max(section.virtual_size, section.size_of_raw_data);
            const va_end = section.virtual_address + (try alignUpU32(vs_effective, opt.section_alignment));
            if (va_end > last_va_end) {
                last_va_end = va_end;
            }
        }

        // Check for overflow before adding 8
        if (data_to_embed.len > std.math.maxInt(u32) - 8) {
            return error.Overflow;
        }
        const payload_len = @as(u32, @intCast(data_to_embed.len + 8)); // 8 for LE length prefix
        const raw_size = try alignUpU32(payload_len, opt.file_alignment);
        const new_va = try alignUpU32(last_va_end, opt.section_alignment);
        const new_raw = try alignUpU32(last_file_end, opt.file_alignment);

        // 6. Resize & zero only the new section area
        const new_file_size = @as(usize, new_raw) + @as(usize, raw_size);
        try self.data.resize(new_file_size);
        @memset(self.data.items[@intCast(new_raw)..new_file_size], 0);

        // 7. Write the new SectionHeader by byte copy
        const sh = SectionHeader{
            .name = [_]u8{ '.', 'b', 'u', 'n', 0, 0, 0, 0 },
            .virtual_size = payload_len,
            .virtual_address = new_va,
            .size_of_raw_data = raw_size,
            .pointer_to_raw_data = new_raw,
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };

        const new_sh_off = self.section_headers_offset + @sizeOf(SectionHeader) * self.num_sections;
        // Bounds check against first_raw (not file length)
        if (new_sh_off + @sizeOf(SectionHeader) > first_raw) {
            return error.InsufficientHeaderSpace;
        }
        std.mem.copyForwards(u8, self.data.items[new_sh_off .. new_sh_off + @sizeOf(SectionHeader)], std.mem.asBytes(&sh));

        // 8. Write payload
        // At data[new_raw ..]: write u64 LE length prefix, then data
        std.mem.writeInt(u64, self.data.items[new_raw..][0..8], @intCast(data_to_embed.len), .little);
        @memcpy(self.data.items[new_raw + 8 ..][0..data_to_embed.len], data_to_embed);

        // 9. Update headers
        // Get fresh pointers after resize
        const pe_after = try self.getPEHeaderMut();
        pe_after.number_of_sections += 1;
        self.num_sections += 1;

        const opt_after = try self.getOptionalHeaderMut();
        // If opt.size_of_headers < new_size_of_headers
        if (opt_after.size_of_headers < new_size_of_headers) {
            opt_after.size_of_headers = new_size_of_headers;
        }
        // Calculate size_of_image: aligned end of last section
        const section_va_end = new_va + sh.virtual_size;
        opt_after.size_of_image = try alignUpU32(section_va_end, opt_after.section_alignment);

        // Security directory must be zero (signature invalidated by change)
        const dd_ptr: *align(1) DataDirectory = &opt_after.data_directories[IMAGE_DIRECTORY_ENTRY_SECURITY];
        if (dd_ptr.virtual_address != 0 or dd_ptr.size != 0) {
            dd_ptr.virtual_address = 0;
            dd_ptr.size = 0;
        }

        // Do not touch size_of_initialized_data (leave as is)

        // 10. Recompute checksum (recommended)
        try self.recomputePEChecksum();
    }

    /// Per-addon metadata produced by `addLinkedAddon` for use at runtime.
    ///
    /// Instead of writing the `.node` DLL to a temp file and calling
    /// `LoadLibraryExW` (which requires real disk I/O and leaves a file
    /// behind until reboot via `MOVEFILE_DELAY_UNTIL_REBOOT`), we merge the
    /// addon's sections into bun.exe at compile time so the Windows loader
    /// maps them with the rest of the image.  At `process.dlopen` the
    /// runtime applies the ASLR delta, binds the IAT, fixes page
    /// protections, registers `.pdata`, and calls the addon's entry point
    /// manually.  No temp file, no `LoadLibrary`.
    ///
    /// All RVAs here are relative to bun.exe's image base.  The addon's own
    /// preferred base is irrelevant after `addLinkedAddon` has applied the
    /// build-time delta; only the runtime ASLR delta
    /// (`GetModuleHandle(NULL) - preferred_base`) still needs applying.
    pub const LinkedAddon = struct {
        /// `$bunfs/...` virtual path, so runtime can match `process.dlopen`
        /// arguments to this metadata.
        name: []const u8,
        /// bun.exe RVA where the addon's RVA 0 lands.  Every RVA copied
        /// from the addon has had this added already; stored here only for
        /// diagnostics / thread-attach calls.
        rva_base: u32,
        /// The addon's original `SizeOfImage`.  Together with `rva_base`
        /// this is the span to flush/protect.
        image_size: u32,
        /// bun-relative RVA of the addon's `AddressOfEntryPoint`
        /// (`_DllMainCRTStartup`), or 0 if the addon has none.
        entry_point: u32,
        /// bun.exe's `OptionalHeader.ImageBase` at the time the merge was
        /// done.  Runtime computes `delta = GetModuleHandle(NULL) -
        /// preferred_base` and applies it to `relocs`.
        preferred_base: u64,

        sections: []SectionInfo,
        /// Raw `IMAGE_BASE_RELOCATION` blocks copied from the addon with
        /// their page RVAs already rebased to bun-relative.  Runtime walks
        /// these and adds `delta` to each `DIR64` slot.
        relocs: []const u8,
        imports: []ImportLib,
        /// bun-relative RVA of the addon's `.pdata` (already rebased); fed
        /// to `RtlAddFunctionTable` so SEH/C++ exceptions inside the addon
        /// unwind correctly.
        pdata_rva: u32,
        pdata_count: u32,
        /// bun-relative RVAs of the symbols `process.dlopen` needs.  Zero
        /// means "not exported by this addon".
        export_register: u32, // napi_register_module_v1
        export_api_version: u32, // node_api_module_get_api_version_v1
        export_plugin_name: u32, // BUN_PLUGIN_NAME

        pub const SectionInfo = extern struct {
            rva: u32,
            size: u32,
            /// Windows `PAGE_*` constant to `VirtualProtect` this range to
            /// once relocs + IAT are written.  The on-disk section is RW so
            /// the runtime can patch it; this restores the addon's
            /// intended protection.
            final_protect: u32,
        };

        pub const ImportLib = struct {
            /// DLL name as it appeared in the addon's import descriptor.
            name: []const u8,
            /// True when the DLL is the host process (node.exe / bun.exe /
            /// the delay-load hook target).  Runtime resolves these against
            /// `GetModuleHandle(NULL)` instead of `LoadLibraryA(name)`.
            is_host: bool,
            entries: []Entry,

            pub const Entry = struct {
                /// bun-relative RVA of the IAT slot to overwrite.
                iat_rva: u32,
                ordinal: u16,
                /// Empty when importing by ordinal.
                name: []const u8,
            };
        };

        pub fn deinit(self: *LinkedAddon, allocator: Allocator) void {
            allocator.free(self.sections);
            allocator.free(self.relocs);
            for (self.imports) |*lib| {
                for (lib.entries) |*e| if (e.name.len > 0) allocator.free(e.name);
                allocator.free(lib.entries);
                allocator.free(lib.name);
            }
            allocator.free(self.imports);
        }
    };

    /// Read-only view over an addon PE for `addLinkedAddon`. Uses file
    /// offsets into `bytes` rather than a loaded image, so every "RVA"
    /// access goes through `rvaToOff`.
    const AddonView = struct {
        bytes: []const u8,
        pe: *align(1) const PEHeader,
        opt: *align(1) const OptionalHeader64,
        sections: []align(1) const SectionHeader,

        fn init(bytes: []const u8) !AddonView {
            if (bytes.len < @sizeOf(DOSHeader)) return error.InvalidPEFile;
            const dos = try viewAtConst(DOSHeader, bytes, 0);
            if (dos.e_magic != DOS_SIGNATURE) return error.InvalidDOSSignature;
            if (dos.e_lfanew < @sizeOf(DOSHeader) or
                dos.e_lfanew > bytes.len -| @sizeOf(PEHeader)) return error.InvalidPEFile;
            const pe = try viewAtConst(PEHeader, bytes, dos.e_lfanew);
            if (pe.signature != PE_SIGNATURE) return error.InvalidPESignature;
            const opt_off = @as(usize, dos.e_lfanew) + @sizeOf(PEHeader);
            if (pe.size_of_optional_header < @sizeOf(OptionalHeader64)) return error.UnsupportedPEFormat;
            const opt = try viewAtConst(OptionalHeader64, bytes, opt_off);
            if (opt.magic != OPTIONAL_HEADER_MAGIC_64) return error.UnsupportedPEFormat;
            const sh_off = opt_off + pe.size_of_optional_header;
            const n: usize = pe.number_of_sections;
            if (sh_off + n * @sizeOf(SectionHeader) > bytes.len) return error.InvalidPEFile;
            const sh: [*]align(1) const SectionHeader = @ptrCast(bytes[sh_off..].ptr);
            return .{ .bytes = bytes, .pe = pe, .opt = opt, .sections = sh[0..n] };
        }

        /// Translate an addon-relative RVA to a file offset. Section
        /// header fields are attacker-controlled so every add is
        /// saturating; callers then reject via the bytes.len check.
        fn rvaToOff(self: *const AddonView, rva: u32) !u32 {
            for (self.sections) |s| {
                const vs = @max(s.virtual_size, s.size_of_raw_data);
                if (rva >= s.virtual_address and rva < s.virtual_address +| vs) {
                    const delta = rva - s.virtual_address;
                    if (delta >= s.size_of_raw_data) return error.OutOfBounds; // bss / past raw
                    const off = s.pointer_to_raw_data +| delta;
                    if (off >= self.bytes.len) return error.OutOfBounds;
                    return off;
                }
            }
            return error.OutOfBounds;
        }

        fn sliceAtRva(self: *const AddonView, rva: u32, len: u32) ![]const u8 {
            const off = try self.rvaToOff(rva);
            if (@as(u64, off) + len > self.bytes.len) return error.OutOfBounds;
            return self.bytes[off..][0..len];
        }

        fn cstrAtRva(self: *const AddonView, rva: u32) ![]const u8 {
            const off = try self.rvaToOff(rva);
            const max = self.bytes.len - off;
            const z = std.mem.indexOfScalar(u8, self.bytes[off..][0..max], 0) orelse return error.OutOfBounds;
            return self.bytes[off..][0..z];
        }

        fn dir(self: *const AddonView, idx: usize) DataDirectory {
            if (idx >= self.opt.number_of_rva_and_sizes) return .{ .virtual_address = 0, .size = 0 };
            return self.opt.data_directories[idx];
        }
    };

    /// DLL names an addon may import its napi/uv symbols from. These are
    /// all satisfied by bun.exe's own export table, so at runtime they are
    /// resolved against `GetModuleHandle(NULL)` rather than a real
    /// `LoadLibrary`.
    fn isHostImport(dll_name: []const u8) bool {
        // node-gyp emits a delay-load against "node.exe"; napi-rs against
        // "node.dll"; some toolchains against the literal host name.
        const lower_eq = std.ascii.eqlIgnoreCase;
        if (lower_eq(dll_name, "node.exe")) return true;
        if (lower_eq(dll_name, "node.dll")) return true;
        if (lower_eq(dll_name, "bun.exe")) return true;
        if (dll_name.len >= 4 and lower_eq(dll_name[0..4], "bun-")) return true;
        return false;
    }

    fn sectionFinalProtect(ch: u32) u32 {
        const x = ch & IMAGE_SCN_MEM_EXECUTE != 0;
        const w = ch & IMAGE_SCN_MEM_WRITE != 0;
        if (x and w) return PAGE_EXECUTE_READWRITE;
        if (x) return PAGE_EXECUTE_READ;
        if (w) return PAGE_READWRITE;
        return PAGE_READONLY;
    }

    /// Merge one `.node` PE into this image as a single new section, apply
    /// the build-time relocation delta, and collect the runtime metadata.
    ///
    /// The addon's internal RVA layout is preserved: its RVA 0 maps to the
    /// new section's `virtual_address`, so every intra-addon reference is a
    /// single constant add.  The new section is marked RW (not executable)
    /// on disk; runtime flips each original-section range to its real
    /// protection via `VirtualProtect` after binding.
    ///
    /// Returns `null` when the addon uses a feature we do not merge (static
    /// TLS).  Caller should then keep the raw bytes so runtime can fall back
    /// to the extract-to-tempfile path.
    pub fn addLinkedAddon(
        self: *PEFile,
        allocator: Allocator,
        addon_bytes: []const u8,
        addon_index: u32,
        virtual_path: []const u8,
    ) !?LinkedAddon {
        const addon = AddonView.init(addon_bytes) catch return null;

        // Refuse anything we would get wrong. The extract-to-tempfile
        // path stays as the behavioural fallback.
        //
        // Implicit TLS (`__declspec(thread)`, Rust `thread_local!`) needs
        // an index reserved in the loader's private `LdrpTlsBitmap` and a
        // template installed in every existing thread's
        // `ThreadLocalStoragePointer` array. Neither has a userspace API;
        // faking it invites index collisions with later `LoadLibrary`
        // calls and misses threads that already exist. Let `LoadLibraryExW`
        // handle these via the fallback.
        if (addon.dir(IMAGE_DIRECTORY_ENTRY_TLS).size != 0 or
            addon.dir(IMAGE_DIRECTORY_ENTRY_TLS).virtual_address != 0)
        {
            return null;
        }
        // Without base relocations we cannot rebase the addon's absolute
        // addresses into bun.exe's image. A DLL built with /FIXED would
        // also fail LoadLibrary unless its preferred base happened to be
        // free, so falling back is no loss of functionality.
        const IMAGE_FILE_RELOCS_STRIPPED: u16 = 0x0001;
        if (addon.pe.characteristics & IMAGE_FILE_RELOCS_STRIPPED != 0) return null;

        const host_opt = try self.getOptionalHeader();
        const sect_align = host_opt.section_alignment;
        const file_align = host_opt.file_alignment;
        const preferred_base = host_opt.image_base;

        // Work out where the new section goes.
        var last_file_end: u32 = 0;
        var last_va_end: u32 = 0;
        const host_sections = try self.getSectionHeaders();
        for (host_sections) |s| {
            const fend = s.pointer_to_raw_data + s.size_of_raw_data;
            if (fend > last_file_end) last_file_end = fend;
            const vs = @max(s.virtual_size, s.size_of_raw_data);
            const vend = s.virtual_address + (try alignUpU32(vs, sect_align));
            if (vend > last_va_end) last_va_end = vend;
        }

        // Header slack: this addon's section, the trailing `.bunL`
        // metadata section, and the final `.bun` module-graph section.
        // If we consumed a slot that `.bunL`/`.bun` will need later the
        // build would hard-fail in addLinkedAddonSection/addBunSection
        // instead of falling back, so refuse *here* while the caller
        // can still skip this addon and keep going. `addBunSection`
        // later rounds `SizeOfHeaders` up to `file_align`, so apply the
        // same rounding here or a host with partial slack in that last
        // alignment bucket would pass this gate and then hard-fail.
        const want_sections: u32 = self.num_sections + 3;
        const new_headers_end = self.section_headers_offset + @sizeOf(SectionHeader) * want_sections;
        const reserved_headers = try alignUpU32(@intCast(new_headers_end), file_align);
        var first_raw: u32 = @intCast(self.data.items.len);
        for (host_sections) |s| if (s.size_of_raw_data > 0 and s.pointer_to_raw_data < first_raw) {
            first_raw = s.pointer_to_raw_data;
        };
        if (reserved_headers > first_raw) return error.InsufficientHeaderSpace;

        // The addon's RVA 0 maps to this RVA in bun.exe.
        const rva_base = try alignUpU32(last_va_end, sect_align);
        const addon_image = addon.opt.size_of_image;
        // AddressOfEntryPoint is attacker-controlled. A value outside
        // the image we are about to copy would make the runtime jump
        // into unrelated bun.exe code or unmapped memory. Check here,
        // before any host mutation, so a skip leaves the host image
        // untouched.
        const entry_rva = addon.opt.address_of_entry_point;
        if (entry_rva != 0 and entry_rva >= addon_image) return null;
        // SizeOfImage is attacker-controlled. Refuse anything that would
        // either blow the build-time allocation or push bun.exe's own
        // SizeOfImage past 2 GiB (RVAs are signed in several Windows
        // structures). The tempfile fallback has no such limit.
        if (addon_image == 0) return null;
        if (addon_image > 512 * 1024 * 1024) return null;
        if (@as(u64, rva_base) + addon_image > std.math.maxInt(i32)) return null;

        // Build a memory-image of the addon (zero-filled then sections
        // copied in at their original RVAs) so the on-disk section is laid
        // out exactly as the addon expects to find itself at runtime.
        var image = try allocator.alloc(u8, addon_image);
        defer allocator.free(image);
        @memset(image, 0);

        var section_infos = std.array_list.Managed(LinkedAddon.SectionInfo).init(allocator);
        errdefer section_infos.deinit();

        for (addon.sections) |s| {
            if (s.virtual_address >= addon_image) return null;
            // A section whose raw bytes lie past EOF is malformed. Do
            // not merge a zeroed stand-in and then trust the rest of
            // the metadata — fail closed so the tempfile path handles
            // it (where LoadLibrary will also reject it, but loudly).
            if (s.size_of_raw_data > 0 and
                @as(u64, s.pointer_to_raw_data) + s.size_of_raw_data > addon_bytes.len)
            {
                return null;
            }
            const copy_len = @min(s.size_of_raw_data, addon_image - s.virtual_address);
            if (copy_len > 0) {
                @memcpy(
                    image[s.virtual_address..][0..copy_len],
                    addon_bytes[s.pointer_to_raw_data..][0..copy_len],
                );
            }
            const vs = @max(s.virtual_size, s.size_of_raw_data);
            if (vs == 0) continue;
            // Clamp the VirtualProtect span to what we actually copied
            // (and therefore what the loader will map). A section header
            // that lies about its virtual size cannot make the runtime
            // protect pages outside the merged addon.
            try section_infos.append(.{
                .rva = rva_base + s.virtual_address,
                .size = @min(vs, addon_image - s.virtual_address),
                .final_protect = sectionFinalProtect(s.characteristics),
            });
        }

        // Apply the build-time relocation delta so absolute addresses in
        // the copied image point at bun.exe's preferred base. Also rewrite
        // the reloc blocks' page RVAs to be bun-relative so the runtime can
        // apply the remaining ASLR delta without a translation table.
        const addon_base = addon.opt.image_base;
        const build_delta: i64 = @as(i64, @bitCast(preferred_base + rva_base)) - @as(i64, @bitCast(addon_base));

        var relocs_out = std.array_list.Managed(u8).init(allocator);
        errdefer relocs_out.deinit();

        const reloc_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_BASERELOC);
        if (reloc_dir.size > 0) {
            const reloc_bytes = addon.sliceAtRva(reloc_dir.virtual_address, reloc_dir.size) catch return null;
            var off: usize = 0;
            while (off + @sizeOf(ImageBaseRelocation) <= reloc_bytes.len) {
                const block: *align(1) const ImageBaseRelocation = @ptrCast(reloc_bytes[off..].ptr);
                const block_size = block.size_of_block;
                // A zero-sized (terminator) or malformed block mid-stream
                // means we cannot know whether more relocations follow,
                // and stopping here would leave a half-relocated image
                // that looks valid. Some linkers emit a single zero block
                // as the terminator, which this also covers.
                if (block_size == 0 and block.virtual_address == 0) break;
                if (block_size < @sizeOf(ImageBaseRelocation) or
                    off + @as(usize, block_size) > reloc_bytes.len)
                {
                    return null;
                }
                const page_rva = block.virtual_address;
                const n_entries = (block_size - @sizeOf(ImageBaseRelocation)) / 2;
                const entries: [*]align(1) const u16 = @ptrCast(reloc_bytes[off + @sizeOf(ImageBaseRelocation) ..].ptr);

                // A block whose page RVA lies outside the image cannot
                // describe any slot we copied. Skip the whole addon —
                // quietly applying only some relocations would leave a
                // half-relocated image.
                if (page_rva >= addon_image) return null;

                // Emit header with bun-relative page RVA.
                var out_hdr: ImageBaseRelocation = .{
                    .virtual_address = rva_base + page_rva,
                    .size_of_block = block_size,
                };
                try relocs_out.appendSlice(std.mem.asBytes(&out_hdr));

                var i: usize = 0;
                while (i < n_entries) : (i += 1) {
                    const entry = entries[i];
                    try relocs_out.appendSlice(std.mem.asBytes(&entry));
                    const typ: u16 = entry >> 12;
                    if (typ == IMAGE_REL_BASED_ABSOLUTE) continue; // padding
                    if (typ != IMAGE_REL_BASED_DIR64) {
                        // Unknown fixup kind on PE32+ — do not risk it.
                        relocs_out.deinit();
                        section_infos.deinit();
                        return null;
                    }
                    const in_page: u32 = entry & 0x0FFF;
                    // page_rva < addon_image and in_page < 0x1000, so
                    // this cannot wrap; just guard the 8-byte write.
                    const target_rva = page_rva + in_page;
                    if (@as(u64, target_rva) + 8 > addon_image) return null;
                    const slot = image[target_rva..][0..8];
                    const old = std.mem.readInt(u64, slot, .little);
                    std.mem.writeInt(u64, slot, @bitCast(@as(i64, @bitCast(old)) +% build_delta), .little);
                }
                off += block_size;
            }
        }

        // Imports: record what the runtime needs to bind, and zero the IAT
        // slots in the image so it is obvious if binding is skipped.
        var imports = std.array_list.Managed(LinkedAddon.ImportLib).init(allocator);
        errdefer {
            for (imports.items) |*lib| {
                for (lib.entries) |*e| if (e.name.len > 0) allocator.free(e.name);
                allocator.free(lib.entries);
                allocator.free(lib.name);
            }
            imports.deinit();
        }

        if (try self.collectImports(allocator, &addon, &imports, image, rva_base, false)) return null;
        if (try self.collectImports(allocator, &addon, &imports, image, rva_base, true)) return null;

        // Exception table. The RUNTIME_FUNCTION array and every RVA inside
        // the UNWIND_INFO structures it points at (chained unwind entries,
        // language-specific handler RVAs) are all interpreted relative to
        // the single BaseAddress passed to RtlAddFunctionTable. Rebasing
        // only the outer array would leave the inner RVAs wrong, so keep
        // the whole thing addon-relative and have the runtime pass
        // `exe_base + rva_base` as BaseAddress instead.
        var pdata_rva: u32 = 0;
        var pdata_count: u32 = 0;
        const pdata_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_EXCEPTION);
        if (pdata_dir.size >= @sizeOf(RuntimeFunction) and
            @as(u64, pdata_dir.virtual_address) + pdata_dir.size <= addon_image)
        {
            pdata_rva = rva_base + pdata_dir.virtual_address;
            pdata_count = pdata_dir.size / @sizeOf(RuntimeFunction);
        }

        // Exports we care about.
        var export_register: u32 = 0;
        var export_api_version: u32 = 0;
        var export_plugin_name: u32 = 0;
        const exp_dir = addon.dir(IMAGE_DIRECTORY_ENTRY_EXPORT);
        if (exp_dir.size >= @sizeOf(ImageExportDirectory)) blk: {
            const exp_bytes = addon.sliceAtRva(exp_dir.virtual_address, @sizeOf(ImageExportDirectory)) catch break :blk;
            const exp: *align(1) const ImageExportDirectory = @ptrCast(exp_bytes.ptr);
            // Counts are attacker-controlled. Saturate the multiplies so a
            // hostile number_of_names=0x40000000 turns into a length that
            // sliceAtRva cleanly rejects instead of wrapping to a small
            // value and succeeding on the wrong bytes.
            const n_names = exp.number_of_names;
            const n_funcs = exp.number_of_functions;
            const names = addon.sliceAtRva(exp.address_of_names, n_names *| 4) catch break :blk;
            const ords = addon.sliceAtRva(exp.address_of_name_ordinals, n_names *| 2) catch break :blk;
            const funcs = addon.sliceAtRva(exp.address_of_functions, n_funcs *| 4) catch break :blk;
            var i: u32 = 0;
            while (i < n_names) : (i += 1) {
                const name_rva = std.mem.readInt(u32, names[i * 4 ..][0..4], .little);
                const name = addon.cstrAtRva(name_rva) catch continue;
                const ord = std.mem.readInt(u16, ords[i * 2 ..][0..2], .little);
                if (ord >= n_funcs) continue;
                const fn_rva = std.mem.readInt(u32, funcs[@as(u32, ord) * 4 ..][0..4], .little);
                // A forwarder or deliberately bogus RVA can point past
                // the addon image; clamp so the rebase cannot wrap.
                if (fn_rva == 0 or fn_rva >= addon_image) continue;
                const bun_rva = rva_base + fn_rva;
                if (std.mem.eql(u8, name, "napi_register_module_v1")) {
                    export_register = bun_rva;
                } else if (std.mem.eql(u8, name, "node_api_module_get_api_version_v1")) {
                    export_api_version = bun_rva;
                } else if (std.mem.eql(u8, name, "BUN_PLUGIN_NAME")) {
                    export_plugin_name = bun_rva;
                }
            }
        }

        // Write the merged section to self.
        const raw_size = try alignUpU32(addon_image, file_align);
        const new_raw = try alignUpU32(last_file_end, file_align);
        const new_file_size = @as(usize, new_raw) + raw_size;
        try self.data.resize(new_file_size);
        @memset(self.data.items[new_raw..new_file_size], 0);
        @memcpy(self.data.items[new_raw..][0..addon_image], image);

        var name_buf: [8]u8 = .{ '.', 'b', 'n', 0, 0, 0, 0, 0 };
        _ = std.fmt.bufPrint(name_buf[3..], "{d}", .{addon_index}) catch {};
        const sh = SectionHeader{
            .name = name_buf,
            .virtual_size = addon_image,
            .virtual_address = rva_base,
            .size_of_raw_data = raw_size,
            .pointer_to_raw_data = new_raw,
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            // RW so runtime can apply ASLR relocs and bind the IAT without
            // an initial VirtualProtect. Not executable yet — runtime
            // promotes the addon's .text range after binding.
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_WRITE,
        };
        const sh_off = self.section_headers_offset + @sizeOf(SectionHeader) * self.num_sections;
        std.mem.copyForwards(u8, self.data.items[sh_off..][0..@sizeOf(SectionHeader)], std.mem.asBytes(&sh));

        const pe_hdr = try self.getPEHeaderMut();
        pe_hdr.number_of_sections += 1;
        self.num_sections += 1;

        const opt_after = try self.getOptionalHeaderMut();
        opt_after.size_of_image = try alignUpU32(rva_base + addon_image, sect_align);

        return LinkedAddon{
            .name = virtual_path,
            .rva_base = rva_base,
            .image_size = addon_image,
            .entry_point = if (entry_rva != 0) rva_base + entry_rva else 0,
            .preferred_base = preferred_base,
            .sections = try section_infos.toOwnedSlice(),
            .relocs = try relocs_out.toOwnedSlice(),
            .imports = try imports.toOwnedSlice(),
            .pdata_rva = pdata_rva,
            .pdata_count = pdata_count,
            .export_register = export_register,
            .export_api_version = export_api_version,
            .export_plugin_name = export_plugin_name,
        };
    }

    /// Walk either the normal or the delay-load import directory of `addon`
    /// and append `ImportLib` descriptors to `out`.  Returns true when the
    /// directory is malformed enough that we should abandon the merge.
    fn collectImports(
        self: *PEFile,
        allocator: Allocator,
        addon: *const AddonView,
        out: *std.array_list.Managed(LinkedAddon.ImportLib),
        image: []u8,
        rva_base: u32,
        comptime delay: bool,
    ) !bool {
        _ = self;
        const Desc = if (delay) ImageDelayloadDescriptor else ImageImportDescriptor;
        const dir_idx = if (delay) IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT else IMAGE_DIRECTORY_ENTRY_IMPORT;
        const dir = addon.dir(dir_idx);
        if (dir.size == 0 or dir.virtual_address == 0) return false;

        // Walk at most as many descriptors as the directory claims to
        // hold, plus one for the terminator. A hostile image that points
        // the directory into a region with no zero terminator cannot make
        // us loop past that.
        const max_descs: u32 = dir.size / @sizeOf(Desc) +| 1;

        var desc_rva = dir.virtual_address;
        var di: u32 = 0;
        while (di < max_descs) : ({
            di += 1;
            desc_rva +|= @sizeOf(Desc);
        }) {
            const desc_bytes = addon.sliceAtRva(desc_rva, @sizeOf(Desc)) catch return true;
            const desc: *align(1) const Desc = @ptrCast(desc_bytes.ptr);
            const name_rva: u32 = if (delay) desc.dll_name_rva else desc.name;
            if (name_rva == 0) break; // terminator
            const dll_name = addon.cstrAtRva(name_rva) catch return true;

            // Some toolchains emit a v1 delayload descriptor (no RVA
            // attribute bit) with VA-style pointers. We only handle the
            // modern RVA form; treat the legacy form as "extract instead".
            if (delay and (desc.attributes & 1) == 0) return true;

            const ilt_rva: u32 = if (delay)
                desc.import_name_table_rva
            else if (desc.original_first_thunk != 0)
                desc.original_first_thunk
            else
                desc.first_thunk; // some linkers omit the ILT
            const iat_rva: u32 = if (delay) desc.import_address_table_rva else desc.first_thunk;
            if (ilt_rva == 0 or iat_rva == 0) return true;

            var entries = std.array_list.Managed(LinkedAddon.ImportLib.Entry).init(allocator);
            errdefer {
                for (entries.items) |*e| if (e.name.len > 0) allocator.free(e.name);
                entries.deinit();
            }

            // Thunks are walked until a zero terminator. Bound the walk
            // by the addon image so a missing terminator cannot run us
            // off the end or allocate unbounded entries; any real addon
            // with more imports than fit in its own image is malformed.
            const max_thunks: u32 = addon.opt.size_of_image / 8 +| 1;

            var idx: u32 = 0;
            while (idx < max_thunks) : (idx += 1) {
                const thunk_rva = ilt_rva +| idx *| 8;
                const thunk_bytes = addon.sliceAtRva(thunk_rva, 8) catch return true;
                const thunk = std.mem.readInt(u64, thunk_bytes[0..8], .little);
                if (thunk == 0) break;
                const slot_rva = iat_rva +| idx *| 8;
                // The IAT slot the runtime will bind must live inside the
                // merged image, or we would later write through a bogus
                // pointer.
                if (slot_rva >= image.len or slot_rva + 8 > image.len) return true;
                // Zero it so a missed bind is an obvious null-deref
                // rather than a jump into junk.
                @memset(image[slot_rva..][0..8], 0);

                if (thunk & IMAGE_ORDINAL_FLAG64 != 0) {
                    try entries.append(.{
                        .iat_rva = rva_base + slot_rva,
                        .ordinal = @truncate(thunk & 0xFFFF),
                        .name = "",
                    });
                } else {
                    // IMAGE_IMPORT_BY_NAME: u16 hint then NUL-terminated
                    // name. The PE spec reserves bits 62:31 of a
                    // by-name thunk as zero; anything there is
                    // malformed and truncating it would resolve the
                    // wrong symbol instead of falling back.
                    if (thunk >> 31 != 0) return true;
                    const hint_rva: u32 = @intCast(thunk);
                    const name = addon.cstrAtRva(hint_rva +| 2) catch return true;
                    try entries.append(.{
                        .iat_rva = rva_base + slot_rva,
                        .ordinal = 0,
                        .name = try allocator.dupe(u8, name),
                    });
                }
            } else return true; // no terminator within bounds

            try out.append(.{
                .name = try allocator.dupe(u8, dll_name),
                .is_host = isHostImport(dll_name),
                .entries = try entries.toOwnedSlice(),
            });
        } else return true; // dir.size under-reports: no terminator
        return false;
    }

    /// Flatten a set of `LinkedAddon`s into the on-disk `.bunL` blob.
    ///
    /// The format is deliberately dumb: little-endian fixed-width integers
    /// and length-prefixed byte strings, walked front-to-back.  It never
    /// needs to be seekable or patchable and is only ever produced by the
    /// same build of bun that consumes it (mismatch falls back to tmpfile
    /// extraction), so there is no attempt at forward compatibility beyond
    /// the magic+version gate.
    pub const linked_magic: u32 = 0x4B4E4C42; // 'BLNK'
    pub const linked_version: u32 = 1;

    pub fn serializeLinkedAddons(allocator: Allocator, addons: []const LinkedAddon) ![]u8 {
        var buf = std.array_list.Managed(u8).init(allocator);
        errdefer buf.deinit();
        const W = struct {
            fn u32_(b: *std.array_list.Managed(u8), v: u32) !void {
                try b.appendSlice(std.mem.asBytes(&v));
            }
            fn u64_(b: *std.array_list.Managed(u8), v: u64) !void {
                try b.appendSlice(std.mem.asBytes(&v));
            }
            fn str(b: *std.array_list.Managed(u8), s: []const u8) !void {
                try u32_(b, @intCast(s.len));
                try b.appendSlice(s);
            }
        };
        try W.u32_(&buf, linked_magic);
        try W.u32_(&buf, linked_version);
        try W.u32_(&buf, @intCast(addons.len));
        for (addons) |a| {
            try W.str(&buf, a.name);
            try W.u32_(&buf, a.rva_base);
            try W.u32_(&buf, a.image_size);
            try W.u32_(&buf, a.entry_point);
            try W.u64_(&buf, a.preferred_base);
            try W.u32_(&buf, a.pdata_rva);
            try W.u32_(&buf, a.pdata_count);
            try W.u32_(&buf, a.export_register);
            try W.u32_(&buf, a.export_api_version);
            try W.u32_(&buf, a.export_plugin_name);
            try W.u32_(&buf, @intCast(a.sections.len));
            try buf.appendSlice(std.mem.sliceAsBytes(a.sections));
            try W.str(&buf, a.relocs);
            try W.u32_(&buf, @intCast(a.imports.len));
            for (a.imports) |lib| {
                try W.str(&buf, lib.name);
                try buf.append(@intFromBool(lib.is_host));
                try W.u32_(&buf, @intCast(lib.entries.len));
                for (lib.entries) |e| {
                    try W.u32_(&buf, e.iat_rva);
                    var ord_bytes: [2]u8 = undefined;
                    std.mem.writeInt(u16, &ord_bytes, e.ordinal, .little);
                    try buf.appendSlice(&ord_bytes);
                    try W.str(&buf, e.name);
                }
            }
        }
        return buf.toOwnedSlice();
    }

    /// Append the `.bunL` section carrying serialized `LinkedAddon`
    /// metadata.  Layout mirrors `.bun`: `[u64 len][blob][pad]`.  Must be
    /// called after all `addLinkedAddon` calls and before `addBunSection`
    /// (which finalises the checksum and security directory).
    pub fn addLinkedAddonSection(self: *PEFile, blob: []const u8) !void {
        const opt = try self.getOptionalHeader();
        const sect_align = opt.section_alignment;
        const file_align = opt.file_alignment;

        var last_file_end: u32 = 0;
        var last_va_end: u32 = 0;
        var first_raw: u32 = @intCast(self.data.items.len);
        const sections = try self.getSectionHeaders();
        for (sections) |s| {
            if (s.size_of_raw_data > 0 and s.pointer_to_raw_data < first_raw) first_raw = s.pointer_to_raw_data;
            const fend = s.pointer_to_raw_data + s.size_of_raw_data;
            if (fend > last_file_end) last_file_end = fend;
            const vs = @max(s.virtual_size, s.size_of_raw_data);
            const vend = s.virtual_address + (try alignUpU32(vs, sect_align));
            if (vend > last_va_end) last_va_end = vend;
        }

        // Reserve room for this section *and* the `.bun` section that
        // `addBunSection` will append next. Taking the last slot here
        // would turn a skippable merge into a hard build failure.
        // `addBunSection` rounds `SizeOfHeaders` up to `file_align`, so
        // the same rounding applies here.
        const new_headers_end = self.section_headers_offset + @sizeOf(SectionHeader) * (self.num_sections + 2);
        const reserved_headers = try alignUpU32(@intCast(new_headers_end), file_align);
        if (reserved_headers > first_raw) return error.InsufficientHeaderSpace;

        if (blob.len > std.math.maxInt(u32) - 8) return error.Overflow;
        const payload: u32 = @intCast(blob.len + 8);
        const raw_size = try alignUpU32(payload, file_align);
        const new_va = try alignUpU32(last_va_end, sect_align);
        const new_raw = try alignUpU32(last_file_end, file_align);
        const new_file_size = @as(usize, new_raw) + raw_size;
        try self.data.resize(new_file_size);
        @memset(self.data.items[new_raw..new_file_size], 0);
        std.mem.writeInt(u64, self.data.items[new_raw..][0..8], blob.len, .little);
        @memcpy(self.data.items[new_raw + 8 ..][0..blob.len], blob);

        const sh = SectionHeader{
            .name = BUNL_SECTION_NAME,
            .virtual_size = payload,
            .virtual_address = new_va,
            .size_of_raw_data = raw_size,
            .pointer_to_raw_data = new_raw,
            .pointer_to_relocations = 0,
            .pointer_to_line_numbers = 0,
            .number_of_relocations = 0,
            .number_of_line_numbers = 0,
            .characteristics = IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ,
        };
        const sh_off = self.section_headers_offset + @sizeOf(SectionHeader) * self.num_sections;
        std.mem.copyForwards(u8, self.data.items[sh_off..][0..@sizeOf(SectionHeader)], std.mem.asBytes(&sh));

        const pe_hdr = try self.getPEHeaderMut();
        pe_hdr.number_of_sections += 1;
        self.num_sections += 1;

        const opt_after = try self.getOptionalHeaderMut();
        opt_after.size_of_image = try alignUpU32(new_va + payload, sect_align);
    }

    /// Find the .bun section and return its data
    pub fn getBunSectionData(self: *const PEFile) ![]const u8 {
        const section_headers = try self.getSectionHeaders();
        for (section_headers) |section| {
            if (std.mem.eql(u8, section.name[0..8], &BUN_SECTION_NAME)) {
                // Header: 8 bytes size (u64)
                if (section.size_of_raw_data < @sizeOf(u64)) {
                    return error.InvalidBunSection;
                }

                // Bounds check
                if (section.pointer_to_raw_data >= self.data.items.len or
                    section.pointer_to_raw_data + section.size_of_raw_data > self.data.items.len)
                {
                    return error.InvalidBunSection;
                }

                const section_data = self.data.items[section.pointer_to_raw_data..][0..section.size_of_raw_data];
                const data_size = std.mem.readInt(u64, section_data[0..8], .little);

                if (data_size + @sizeOf(u64) > section.size_of_raw_data) {
                    return error.InvalidBunSection;
                }

                // Data starts at offset 8 (after u64 size)
                return section_data[8..][0..data_size];
            }
        }
        return error.BunSectionNotFound;
    }

    /// Get the length of the Bun section data
    pub fn getBunSectionLength(self: *const PEFile) !u64 {
        const section_headers = try self.getSectionHeaders();
        for (section_headers) |section| {
            if (std.mem.eql(u8, section.name[0..8], &BUN_SECTION_NAME)) {
                if (section.size_of_raw_data < @sizeOf(u64)) {
                    return error.InvalidBunSection;
                }

                // Bounds check
                if (section.pointer_to_raw_data >= self.data.items.len or
                    section.pointer_to_raw_data + @sizeOf(u64) > self.data.items.len)
                {
                    return error.InvalidBunSection;
                }

                const section_data = self.data.items[section.pointer_to_raw_data..];
                return std.mem.readInt(u64, section_data[0..8], .little);
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
        // Check DOS & PE signatures
        const dos_header = try self.getDosHeader();
        if (dos_header.e_magic != DOS_SIGNATURE) {
            return error.InvalidDOSSignature;
        }

        const pe_header = try self.getPEHeader();
        if (pe_header.signature != PE_SIGNATURE) {
            return error.InvalidPESignature;
        }

        // Check optional header magic is 0x20B (64-bit)
        const optional_header = try self.getOptionalHeader();
        if (optional_header.magic != OPTIONAL_HEADER_MAGIC_64) {
            return error.UnsupportedPEFormat;
        }

        // Validate file_alignment, section_alignment sanity
        if (!isPow2(optional_header.file_alignment) or !isPow2(optional_header.section_alignment)) {
            return error.BadAlignment;
        }
        // Relational rule
        if (optional_header.section_alignment < 4096) {
            if (optional_header.file_alignment != optional_header.section_alignment) {
                return error.InvalidPEFile;
            }
        }

        // Section headers region fits within size_of_headers and file
        const section_headers_end = self.section_headers_offset + @sizeOf(SectionHeader) * self.num_sections;
        if (section_headers_end > optional_header.size_of_headers or
            section_headers_end > self.data.items.len)
        {
            return error.InvalidPEFile;
        }

        // Validate each section
        const section_headers = try self.getSectionHeaders();
        var max_va_end: u32 = 0;

        for (section_headers, 0..) |section, i| {
            // If size_of_raw_data > 0, validate raw data bounds
            if (section.size_of_raw_data > 0) {
                if (section.pointer_to_raw_data < optional_header.size_of_headers or
                    section.pointer_to_raw_data + section.size_of_raw_data > self.data.items.len)
                {
                    return error.InvalidSectionData;
                }

                // Check for overlaps with other sections using correct interval test
                for (section_headers[i + 1 ..]) |other| {
                    if (other.size_of_raw_data > 0) {
                        const section_start = section.pointer_to_raw_data;
                        const section_end = section_start + section.size_of_raw_data;
                        const other_start = other.pointer_to_raw_data;
                        const other_end = other_start + other.size_of_raw_data;
                        // Standard overlap test: max(start) < min(end)
                        if (@max(section_start, other_start) < @min(section_end, other_end)) {
                            return error.InvalidPEFile; // Section raw ranges overlap
                        }
                    }
                }
            }

            // Track max virtual address end using effective virtual size
            const vs_effective = @max(section.virtual_size, section.size_of_raw_data);
            const va_end = section.virtual_address + (try alignUpU32(vs_effective, optional_header.section_alignment));
            if (va_end > max_va_end) {
                max_va_end = va_end;
            }
        }

        // Verify size_of_image equals alignUp(max(VA + alignUp(VS, SA)), SA)
        const expected_size_of_image = try alignUpU32(max_va_end, optional_header.section_alignment);
        if (optional_header.size_of_image != expected_size_of_image) {
            return error.SizeOfImageMismatch;
        }

        // Security directory should be 0,0 post-change (if we modified it)
        // (This is optional validation, not critical)

        // If checksum recomputed, field should be non-zero
        // (Unless we intentionally write zero, which is allowed)
    }
};

/// Direct access to `addLinkedAddon` for adversarial tests. Lets tests
/// feed malformed / hostile addon images on any platform without needing
/// a Windows bun.exe template or a `bun build --compile` round-trip, and
/// assert that the merge either (a) produces a well-formed PE or (b) is
/// cleanly skipped — never hangs, never corrupts the host image.
pub const TestingAPIs = struct {
    const jsc = bun.jsc;

    pub fn linkAddon(global: *jsc.JSGlobalObject, call: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = call.arguments();
        if (args.len < 3) return global.throwNotEnoughArguments("linkAddon", 3, args.len);

        const host_slice = args[0].asArrayBuffer(global) orelse
            return global.throwInvalidArgumentType("linkAddon", "host", "Uint8Array");
        const addon_slice = args[1].asArrayBuffer(global) orelse
            return global.throwInvalidArgumentType("linkAddon", "addon", "Uint8Array");
        const name_str = try args[2].toBunString(global);
        defer name_str.deref();
        const name_utf8 = name_str.toUTF8(bun.default_allocator);
        defer name_utf8.deinit();

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const alloc = arena.allocator();

        const result = jsc.JSValue.createEmptyObject(global, 5);
        const putErr = struct {
            fn do(g: *jsc.JSGlobalObject, r: jsc.JSValue, comptime where: []const u8, e: anyerror) bun.JSError!jsc.JSValue {
                var msg = try bun.String.createFormat(where ++ ": {s}", .{@errorName(e)});
                r.put(g, jsc.ZigString.static("error"), try msg.transferToJS(g));
                return r;
            }
        }.do;

        var host = PEFile.init(alloc, host_slice.byteSlice()) catch |err| return putErr(global, result, "host", err);
        defer host.deinit();

        const linked = host.addLinkedAddon(alloc, addon_slice.byteSlice(), 0, name_utf8.slice()) catch |err|
            return putErr(global, result, "addon", err);
        if (linked == null) {
            result.put(global, jsc.ZigString.static("skipped"), .true);
            return result;
        }
        var la = linked.?;
        defer la.deinit(alloc);

        const meta = PEFile.serializeLinkedAddons(alloc, &.{la}) catch |err|
            return putErr(global, result, "serialize", err);
        host.addLinkedAddonSection(meta) catch |err|
            return putErr(global, result, "bunL", err);
        host.validate() catch |err|
            return putErr(global, result, "validate", err);

        result.put(global, jsc.ZigString.static("skipped"), .false);
        result.put(global, jsc.ZigString.static("output"), try jsc.ArrayBuffer.createBuffer(global, host.data.items));
        result.put(global, jsc.ZigString.static("metadata"), try jsc.ArrayBuffer.createBuffer(global, meta));
        result.put(global, jsc.ZigString.static("rvaBase"), jsc.JSValue.jsNumber(la.rva_base));
        return result;
    }
};

/// Utilities for PE file detection and validation
pub const utils = struct {
    pub fn isPE(data: []const u8) bool {
        if (data.len < @sizeOf(PEFile.DOSHeader)) return false;

        const dos: *align(1) const PEFile.DOSHeader = @ptrCast(data.ptr);
        if (dos.e_magic != PEFile.DOS_SIGNATURE) return false;

        const off = dos.e_lfanew;
        if (off < @sizeOf(PEFile.DOSHeader) or off > data.len -| @sizeOf(PEFile.PEHeader)) return false;

        const pe: *align(1) const PEFile.PEHeader = @ptrCast(data[off..].ptr);
        return pe.signature == PEFile.PE_SIGNATURE;
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

const bun = @import("bun");
const std = @import("std");

const mem = std.mem;
const Allocator = mem.Allocator;
