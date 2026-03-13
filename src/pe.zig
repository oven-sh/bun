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
    const IMAGE_DIRECTORY_ENTRY_SECURITY: usize = 4;
    const IMAGE_DLLCHARACTERISTICS_FORCE_INTEGRITY: u16 = 0x0080;

    // Section name constant for exact comparison
    const BUN_SECTION_NAME = [_]u8{ '.', 'b', 'u', 'n', 0, 0, 0, 0 };

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
