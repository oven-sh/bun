/// Windows PE resource types
pub const RT = enum(u16) {
    CURSOR = 1,
    BITMAP = 2,
    ICON = 3,
    MENU = 4,
    DIALOG = 5,
    STRING = 6,
    FONTDIR = 7,
    FONT = 8,
    ACCELERATOR = 9,
    RCDATA = 10,
    MESSAGETABLE = 11,
    GROUP_CURSOR = 12,
    GROUP_ICON = 14,
    VERSION = 16,
    DLGINCLUDE = 17,
    PLUGPLAY = 19,
    VXD = 20,
    ANICURSOR = 21,
    ANIICON = 22,
    HTML = 23,
    MANIFEST = 24,
};

/// Resource name or ordinal (ID)
pub const NameOrOrdinal = union(enum) {
    name: []const u16,
    ordinal: u16,

    pub fn deinit(self: NameOrOrdinal, allocator: Allocator) void {
        switch (self) {
            .name => |n| allocator.free(n),
            .ordinal => {},
        }
    }

    pub fn clone(self: NameOrOrdinal, allocator: Allocator) !NameOrOrdinal {
        return switch (self) {
            .name => |n| .{ .name = try allocator.dupe(u16, n) },
            .ordinal => |o| .{ .ordinal = o },
        };
    }

    pub fn byteLen(self: NameOrOrdinal) usize {
        return switch (self) {
            .name => |n| 2 + n.len * 2, // length prefix + UTF-16 string
            .ordinal => 4, // 0xFFFF + ordinal value
        };
    }

    pub fn hash(self: NameOrOrdinal) u32 {
        var hasher = std.hash.Wyhash.init(0);
        switch (self) {
            .name => |n| {
                hasher.update("name");
                hasher.update(std.mem.sliceAsBytes(n));
            },
            .ordinal => |o| {
                hasher.update("ordinal");
                hasher.update(std.mem.asBytes(&o));
            },
        }
        return @truncate(hasher.final());
    }

    pub fn eql(a: NameOrOrdinal, b: NameOrOrdinal) bool {
        return switch (a) {
            .name => |a_name| switch (b) {
                .name => |b_name| std.mem.eql(u16, a_name, b_name),
                .ordinal => false,
            },
            .ordinal => |a_ord| switch (b) {
                .ordinal => |b_ord| a_ord == b_ord,
                .name => false,
            },
        };
    }
};

/// Language identifier
pub const Language = struct {
    primary: u10,
    sub: u6,

    pub fn asInt(self: Language) u16 {
        return @as(u16, self.sub) << 10 | self.primary;
    }

    pub const neutral = Language{ .primary = 0, .sub = 0 };
    pub const en_US = Language{ .primary = 0x09, .sub = 0x01 };
};

/// Resource memory flags
pub const MemoryFlags = packed struct(u16) {
    _reserved: u4 = 0,
    moveable: bool = true,
    _reserved2: u1 = 0,
    pure: bool = false,
    _reserved3: u1 = 0,
    preload: bool = false,
    _reserved4: u7 = 0,
};

/// Individual resource entry
pub const Resource = struct {
    type_value: NameOrOrdinal,
    name_value: NameOrOrdinal,
    language: Language,
    data: []const u8,
    memory_flags: MemoryFlags = .{},
    version: u32 = 0,
    characteristics: u32 = 0,

    pub fn deinit(self: *Resource, allocator: Allocator) void {
        self.type_value.deinit(allocator);
        self.name_value.deinit(allocator);
        allocator.free(self.data);
    }
};

/// Resource directory structures as defined by PE/COFF spec
pub const ResourceDirectoryTable = extern struct {
    characteristics: u32,
    timestamp: u32,
    major_version: u16,
    minor_version: u16,
    number_of_name_entries: u16,
    number_of_id_entries: u16,

    pub fn write(self: ResourceDirectoryTable, writer: anytype) !void {
        try writer.writeStruct(self);
    }
};

pub const ResourceDirectoryEntry = extern struct {
    entry: packed union {
        name_offset: packed struct(u32) {
            address: u31,
            to_string: bool = true,
        },
        integer_id: u32,
    },
    offset: packed struct(u32) {
        address: u31,
        to_subdirectory: bool,
    },

    pub fn write(self: ResourceDirectoryEntry, writer: anytype) !void {
        try writer.writeInt(u32, @bitCast(self.entry), .little);
        try writer.writeInt(u32, @bitCast(self.offset), .little);
    }

    pub fn create(id_or_name: NameOrOrdinal, offset: u32, is_dir: bool, string_offsets: []const u31, getStringIndex: anytype) ResourceDirectoryEntry {
        const entry_value = switch (id_or_name) {
            .name => |_| packed union {
                name_offset: packed struct(u32) {
                    address: u31,
                    to_string: bool = true,
                },
                integer_id: u32,
            }{ .name_offset = .{ .address = string_offsets[getStringIndex(id_or_name)] } },
            .ordinal => |id| packed union {
                name_offset: packed struct(u32) {
                    address: u31,
                    to_string: bool = true,
                },
                integer_id: u32,
            }{ .integer_id = id },
        };

        return .{
            .entry = entry_value,
            .offset = .{
                .address = @intCast(offset),
                .to_subdirectory = is_dir,
            },
        };
    }
};

pub const ResourceDataEntry = extern struct {
    data_rva: u32,
    size: u32,
    codepage: u32,
    reserved: u32 = 0,

    pub fn write(self: ResourceDataEntry, writer: anytype) !void {
        try writer.writeStruct(self);
    }
};

/// Tree structure for organizing resources hierarchically
pub const ResourceTree = struct {
    /// Type -> Name -> Language -> Resource
    type_to_name_map: std.ArrayHashMapUnmanaged(NameOrOrdinal, NameToLanguageMap, NameOrOrdinalContext, true) = .{},
    /// String table for resource names
    string_table: std.ArrayListUnmanaged(NameOrOrdinal) = .{},
    /// Actual resource data
    resources: std.ArrayListUnmanaged(Resource) = .{},
    allocator: Allocator,

    const NameOrOrdinalContext = struct {
        pub fn hash(self: @This(), key: NameOrOrdinal) u32 {
            _ = self;
            return @truncate(key.hash());
        }
        pub fn eql(self: @This(), a: NameOrOrdinal, b: NameOrOrdinal, b_index: usize) bool {
            _ = self;
            _ = b_index;
            return a.eql(b);
        }
    };

    const LanguageToResourceMap = std.AutoArrayHashMapUnmanaged(Language, usize); // index into resources array
    const NameToLanguageMap = std.ArrayHashMapUnmanaged(NameOrOrdinal, LanguageToResourceMap, NameOrOrdinalContext, true);

    pub fn init(allocator: Allocator) ResourceTree {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ResourceTree) void {
        var type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            type_entry.key_ptr.deinit(self.allocator);
            var name_iter = type_entry.value_ptr.iterator();
            while (name_iter.next()) |name_entry| {
                name_entry.key_ptr.deinit(self.allocator);
                name_entry.value_ptr.deinit(self.allocator);
            }
            type_entry.value_ptr.deinit(self.allocator);
        }
        self.type_to_name_map.deinit(self.allocator);

        for (self.string_table.items) |*name| {
            name.deinit(self.allocator);
        }
        self.string_table.deinit(self.allocator);

        for (self.resources.items) |*resource| {
            resource.deinit(self.allocator);
        }
        self.resources.deinit(self.allocator);
    }

    pub fn addResource(self: *ResourceTree, resource: Resource) !void {
        const resource_index = self.resources.items.len;
        try self.resources.append(self.allocator, resource);
        errdefer _ = self.resources.pop();

        const name_to_lang_map = blk: {
            const gop_result = try self.type_to_name_map.getOrPut(self.allocator, resource.type_value);
            if (!gop_result.found_existing) {
                gop_result.key_ptr.* = try resource.type_value.clone(self.allocator);
                gop_result.value_ptr.* = .{};
            }
            break :blk gop_result.value_ptr;
        };

        const lang_to_resource_map = blk: {
            const gop_result = try name_to_lang_map.getOrPut(self.allocator, resource.name_value);
            if (!gop_result.found_existing) {
                gop_result.key_ptr.* = try resource.name_value.clone(self.allocator);
                gop_result.value_ptr.* = .{};
            }
            break :blk gop_result.value_ptr;
        };

        const gop_result = try lang_to_resource_map.getOrPut(self.allocator, resource.language);
        if (gop_result.found_existing) {
            _ = self.resources.pop();
            return error.DuplicateResource;
        }
        gop_result.value_ptr.* = resource_index;

        // Add to string table if needed
        if (resource.type_value == .name) {
            try self.ensureInStringTable(resource.type_value);
        }
        if (resource.name_value == .name) {
            try self.ensureInStringTable(resource.name_value);
        }
    }

    fn ensureInStringTable(self: *ResourceTree, name: NameOrOrdinal) !void {
        for (self.string_table.items) |existing| {
            if (std.meta.eql(existing, name)) return;
        }
        try self.string_table.append(self.allocator, try name.clone(self.allocator));
    }

    pub const Lengths = struct {
        level1: u32, // Type directory
        level2: u32, // Name directories
        level3: u32, // Language directories
        data_entries: u32,
        strings: u32,
        padding: u32,
        data: u32,
        total: u32,
    };

    /// Calculate all sizes and offsets - PASS 1
    pub fn calculateLayout(self: *const ResourceTree) Lengths {
        var lengths = Lengths{
            .level1 = 0,
            .level2 = 0,
            .level3 = 0,
            .data_entries = 0,
            .strings = 0,
            .padding = 0,
            .data = 0,
            .total = 0,
        };

        // Level 1: Type directory
        lengths.level1 = @sizeOf(ResourceDirectoryTable);
        lengths.level1 += @intCast(self.type_to_name_map.count() * @sizeOf(ResourceDirectoryEntry));

        // Level 2: Name directories
        var type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            lengths.level2 += @sizeOf(ResourceDirectoryTable);
            lengths.level2 += @intCast(type_entry.value_ptr.count() * @sizeOf(ResourceDirectoryEntry));

            // Level 3: Language directories
            var name_iter = type_entry.value_ptr.iterator();
            while (name_iter.next()) |name_entry| {
                lengths.level3 += @sizeOf(ResourceDirectoryTable);
                lengths.level3 += @intCast(name_entry.value_ptr.count() * @sizeOf(ResourceDirectoryEntry));

                // Data entries
                lengths.data_entries += @intCast(name_entry.value_ptr.count() * @sizeOf(ResourceDataEntry));
            }
        }

        // String table
        for (self.string_table.items) |name| {
            lengths.strings += 2; // length prefix
            lengths.strings += @intCast(name.name.len * 2); // UTF-16 string
        }

        // Resource data
        for (self.resources.items) |resource| {
            const aligned_size = std.mem.alignForward(usize, resource.data.len, 8);
            lengths.data += @intCast(aligned_size);
        }

        // Calculate total before data
        const before_data = lengths.level1 + lengths.level2 + lengths.level3 + lengths.data_entries + lengths.strings;
        lengths.padding = @intCast((4 -% before_data) % 4);
        lengths.total = before_data + lengths.padding + lengths.data;

        return lengths;
    }

    /// Write the resource section - PASS 2
    pub fn write(self: *const ResourceTree, writer: anytype, virtual_base: u32) !void {
        const lengths = self.calculateLayout();

        // Pre-calculate all string offsets
        var string_offsets = try self.allocator.alloc(u31, self.string_table.items.len);
        defer self.allocator.free(string_offsets);
        {
            const strings_start = lengths.level1 + lengths.level2 + lengths.level3 + lengths.data_entries;
            var offset: u31 = @intCast(strings_start);
            for (self.string_table.items, 0..) |name, i| {
                string_offsets[i] = offset;
                offset += 2 + @as(u31, @intCast(name.name.len * 2));
            }
        }

        // Write level 1 (type directory)
        {
            var name_count: u16 = 0;
            var id_count: u16 = 0;
            for (self.type_to_name_map.keys()) |key| {
                switch (key) {
                    .name => name_count += 1,
                    .ordinal => id_count += 1,
                }
            }

            const type_dir = ResourceDirectoryTable{
                .characteristics = 0,
                .timestamp = 0,
                .major_version = 0,
                .minor_version = 0,
                .number_of_name_entries = name_count,
                .number_of_id_entries = id_count,
            };
            try type_dir.write(writer);
        }

        // Write type entries and level 2
        var level2_offset: u32 = lengths.level1;
        var level3_offset: u32 = lengths.level1 + lengths.level2;
        var data_entry_offset: u32 = lengths.level1 + lengths.level2 + lengths.level3;
        var data_offset: u32 = lengths.level1 + lengths.level2 + lengths.level3 + lengths.data_entries + lengths.strings + lengths.padding;

        // Write type directory entries
        var type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            const entry = ResourceDirectoryEntry{
                .entry = switch (type_entry.key_ptr.*) {
                    .name => .{ .name_offset = .{ .address = string_offsets[self.getStringIndex(type_entry.key_ptr.*)] } },
                    .ordinal => .{ .integer_id = type_entry.key_ptr.ordinal },
                },
                .offset = .{
                    .address = @intCast(level2_offset),
                    .to_subdirectory = true,
                },
            };
            try entry.write(writer);
            level2_offset += @sizeOf(ResourceDirectoryTable) + @as(u32, @intCast(type_entry.value_ptr.count() * @sizeOf(ResourceDirectoryEntry)));
        }

        // Write level 2 (name directories)
        type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            var name_count: u16 = 0;
            var id_count: u16 = 0;
            for (type_entry.value_ptr.keys()) |key| {
                switch (key) {
                    .name => name_count += 1,
                    .ordinal => id_count += 1,
                }
            }

            const name_dir = ResourceDirectoryTable{
                .characteristics = 0,
                .timestamp = 0,
                .major_version = 0,
                .minor_version = 0,
                .number_of_name_entries = name_count,
                .number_of_id_entries = id_count,
            };
            try name_dir.write(writer);

            // Write name entries
            var name_iter = type_entry.value_ptr.iterator();
            while (name_iter.next()) |name_entry| {
                const entry = ResourceDirectoryEntry{
                    .entry = switch (name_entry.key_ptr.*) {
                        .name => .{ .name_offset = .{ .address = string_offsets[self.getStringIndex(name_entry.key_ptr.*)] } },
                        .ordinal => .{ .integer_id = name_entry.key_ptr.ordinal },
                    },
                    .offset = .{
                        .address = @intCast(level3_offset),
                        .to_subdirectory = true,
                    },
                };
                try entry.write(writer);
                level3_offset += @sizeOf(ResourceDirectoryTable) + @as(u32, @intCast(name_entry.value_ptr.count() * @sizeOf(ResourceDirectoryEntry)));
            }
        }

        // Write level 3 (language directories)
        type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            var name_iter = type_entry.value_ptr.iterator();
            while (name_iter.next()) |name_entry| {
                const lang_dir = ResourceDirectoryTable{
                    .characteristics = 0,
                    .timestamp = 0,
                    .major_version = 0,
                    .minor_version = 0,
                    .number_of_name_entries = 0,
                    .number_of_id_entries = @intCast(name_entry.value_ptr.count()),
                };
                try lang_dir.write(writer);

                // Write language entries
                var lang_iter = name_entry.value_ptr.iterator();
                while (lang_iter.next()) |lang_entry| {
                    const entry = ResourceDirectoryEntry{
                        .entry = .{ .integer_id = lang_entry.key_ptr.asInt() },
                        .offset = .{
                            .address = @intCast(data_entry_offset),
                            .to_subdirectory = false,
                        },
                    };
                    try entry.write(writer);
                    data_entry_offset += @sizeOf(ResourceDataEntry);
                }
            }
        }

        // Write data entries
        type_iter = self.type_to_name_map.iterator();
        while (type_iter.next()) |type_entry| {
            var name_iter = type_entry.value_ptr.iterator();
            while (name_iter.next()) |name_entry| {
                var lang_iter = name_entry.value_ptr.iterator();
                while (lang_iter.next()) |lang_entry| {
                    const resource = &self.resources.items[lang_entry.value_ptr.*];
                    const data_entry = ResourceDataEntry{
                        .data_rva = virtual_base +% data_offset,
                        .size = @intCast(resource.data.len),
                        .codepage = 0,
                    };
                    try data_entry.write(writer);
                    const aligned_size = std.mem.alignForward(usize, resource.data.len, 8);
                    data_offset += @intCast(aligned_size);
                }
            }
        }

        // Write string table
        for (self.string_table.items) |name| {
            try writer.writeInt(u16, @intCast(name.name.len), .little);
            try writer.writeAll(std.mem.sliceAsBytes(name.name));
        }

        // Write padding
        try writer.writeByteNTimes(0, lengths.padding);

        // Write resource data
        for (self.resources.items) |resource| {
            try writer.writeAll(resource.data);
            const padding = std.mem.alignForward(usize, resource.data.len, 8) - resource.data.len;
            try writer.writeByteNTimes(0, padding);
        }
    }

    fn getStringIndex(self: *const ResourceTree, name: NameOrOrdinal) usize {
        for (self.string_table.items, 0..) |existing, i| {
            if (std.meta.eql(existing, name)) return i;
        }
        unreachable; // Should have been added in ensureInStringTable
    }
};

/// Version information structures
pub const VS_FIXEDFILEINFO = extern struct {
    signature: u32 = 0xFEEF04BD,
    struct_version: u32 = 0x00010000,
    file_version_ms: u32,
    file_version_ls: u32,
    product_version_ms: u32,
    product_version_ls: u32,
    file_flags_mask: u32 = 0x3F,
    file_flags: u32 = 0,
    file_os: u32 = 0x00040004, // VOS_NT_WINDOWS32
    file_type: u32 = 0x00000001, // VFT_APP
    file_subtype: u32 = 0,
    file_date_ms: u32 = 0,
    file_date_ls: u32 = 0,

    pub fn write(self: VS_FIXEDFILEINFO, writer: anytype) !void {
        try writer.writeStruct(self);
    }
};

/// Icon directory structures
pub const IconDirEntry = extern struct {
    width: u8,
    height: u8,
    color_count: u8,
    reserved: u8 = 0,
    planes: u16,
    bit_count: u16,
    bytes_in_res: u32,
    image_offset: u32,

    pub fn parse(reader: anytype) !IconDirEntry {
        return IconDirEntry{
            .width = try reader.readInt(u8, .little),
            .height = try reader.readInt(u8, .little),
            .color_count = try reader.readInt(u8, .little),
            .reserved = try reader.readInt(u8, .little),
            .planes = try reader.readInt(u16, .little),
            .bit_count = try reader.readInt(u16, .little),
            .bytes_in_res = try reader.readInt(u32, .little),
            .image_offset = try reader.readInt(u32, .little),
        };
    }
};

pub const GroupIconDirEntry = extern struct {
    width: u8,
    height: u8,
    color_count: u8,
    reserved: u8 = 0,
    planes: u16,
    bit_count: u16,
    bytes_in_res: u32,
    id: u16,

    pub fn write(self: GroupIconDirEntry, writer: anytype) !void {
        try writer.writeInt(u8, self.width, .little);
        try writer.writeInt(u8, self.height, .little);
        try writer.writeInt(u8, self.color_count, .little);
        try writer.writeInt(u8, self.reserved, .little);
        try writer.writeInt(u16, self.planes, .little);
        try writer.writeInt(u16, self.bit_count, .little);
        try writer.writeInt(u32, self.bytes_in_res, .little);
        try writer.writeInt(u16, self.id, .little);
    }
};

/// Version info header structure
const VersionInfoHeader = extern struct {
    length: u16,
    value_length: u16,
    type: u16,
    // key follows (UTF-16 string)
};

/// String table header
const StringTableHeader = extern struct {
    length: u16,
    value_length: u16,
    type: u16,
    // key follows (UTF-16 string "000004b0")
};

/// String entry header
const StringEntryHeader = extern struct {
    length: u16,
    value_length: u16,
    type: u16,
    // key and value follow (UTF-16 strings)
};

/// Build version info resource data
pub fn buildVersionInfo(allocator: Allocator, version: WindowsVersion, description: []const u8, title: ?[]const u8, publisher: ?[]const u8) ![]u8 {
    var buffer = std.ArrayList(u8).init(allocator);
    defer buffer.deinit();
    const writer = buffer.writer();

    // VS_VERSIONINFO structure
    const vs_versioninfo_start = buffer.items.len;
    const version_header = VersionInfoHeader{
        .length = 0, // Will be updated
        .value_length = @sizeOf(VS_FIXEDFILEINFO),
        .type = 0, // Binary
    };
    try writer.writeStruct(version_header);
    try writer.writeAll(std.mem.sliceAsBytes(&[_]u16{ 'V', 'S', '_', 'V', 'E', 'R', 'S', 'I', 'O', 'N', 'I', 'N', 'F', 'O', 0 }));

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // VS_FIXEDFILEINFO
    const file_version_ms = (@as(u32, version.major) << 16) | version.minor;
    const file_version_ls = (@as(u32, version.patch) << 16) | version.build;
    const fixed_info = VS_FIXEDFILEINFO{
        .file_version_ms = file_version_ms,
        .file_version_ls = file_version_ls,
        .product_version_ms = file_version_ms,
        .product_version_ls = file_version_ls,
    };
    try fixed_info.write(writer);

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // StringFileInfo
    const string_file_info_start = buffer.items.len;
    try writer.writeInt(u16, 0, .little); // Length (will be updated)
    try writer.writeInt(u16, 0, .little); // Value length
    try writer.writeInt(u16, 1, .little); // Type (1 = text)
    try writer.writeAll(std.mem.sliceAsBytes(&[_]u16{ 'S', 't', 'r', 'i', 'n', 'g', 'F', 'i', 'l', 'e', 'I', 'n', 'f', 'o', 0 }));

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // StringTable (040904E4 = US English, Unicode)
    const string_table_start = buffer.items.len;
    try writer.writeInt(u16, 0, .little); // Length (will be updated)
    try writer.writeInt(u16, 0, .little); // Value length
    try writer.writeInt(u16, 1, .little); // Type
    try writer.writeAll(std.mem.sliceAsBytes(&[_]u16{ '0', '4', '0', '9', '0', '4', 'E', '4', 0 }));

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // Build string entries dynamically
    var string_entries = std.ArrayList(struct { key: []const u8, value: []const u8 }).init(allocator);
    defer string_entries.deinit();
    
    // Always add FileDescription
    try string_entries.append(.{ .key = "FileDescription", .value = description });
    
    // Add ProductName if provided
    if (title) |t| {
        try string_entries.append(.{ .key = "ProductName", .value = t });
    }
    
    // Add CompanyName if provided
    if (publisher) |p| {
        try string_entries.append(.{ .key = "CompanyName", .value = p });
    }
    
    // Add standard version strings
    const version_str = try std.fmt.allocPrint(allocator, "{d}.{d}.{d}.{d}", .{
        version.major, version.minor, version.patch, version.build,
    });
    defer allocator.free(version_str);
    
    try string_entries.append(.{ .key = "FileVersion", .value = version_str });
    try string_entries.append(.{ .key = "ProductVersion", .value = version_str });

    for (string_entries.items) |entry| {
        const string_start = buffer.items.len;
        const string_header_pos = buffer.items.len;
        try writer.writeStruct(StringEntryHeader{ .length = 0, .value_length = 0, .type = 1 });

        // Write key as UTF-16
        const key_utf16 = try std.unicode.utf8ToUtf16LeAlloc(allocator, entry.key);
        defer allocator.free(key_utf16);
        try writer.writeAll(std.mem.sliceAsBytes(key_utf16));
        try writer.writeInt(u16, 0, .little); // Null terminator
        while (buffer.items.len % 4 != 0) try writer.writeByte(0);

        // Write value as UTF-16
        const value_utf16 = try std.unicode.utf8ToUtf16LeAlloc(allocator, entry.value);
        defer allocator.free(value_utf16);
        try writer.writeAll(std.mem.sliceAsBytes(value_utf16));
        try writer.writeInt(u16, 0, .little); // Null terminator
        while (buffer.items.len % 4 != 0) try writer.writeByte(0);

        // Update string entry header
        const string_len = buffer.items.len - string_start;
        const header = StringEntryHeader{
            .length = @intCast(string_len),
            .value_length = @intCast(value_utf16.len + 1),
            .type = 1,
        };
        @memcpy(buffer.items[string_header_pos..][0..@sizeOf(StringEntryHeader)], std.mem.asBytes(&header));
    }

    // Update StringTable length
    const string_table_len = buffer.items.len - string_table_start;
    const string_table_header = StringTableHeader{
        .length = @intCast(string_table_len),
        .value_length = 0,
        .type = 1,
    };
    @memcpy(buffer.items[string_table_start..][0..@sizeOf(StringTableHeader)], std.mem.asBytes(&string_table_header));

    // Update StringFileInfo length
    const string_file_info_len = buffer.items.len - string_file_info_start;
    const string_file_info_header = VersionInfoHeader{
        .length = @intCast(string_file_info_len),
        .value_length = 0,
        .type = 1,
    };
    @memcpy(buffer.items[string_file_info_start..][0..@sizeOf(VersionInfoHeader)], std.mem.asBytes(&string_file_info_header));

    // VarFileInfo - MANDATORY for Windows to recognize version info
    const var_file_info_start = buffer.items.len;
    try writer.writeInt(u16, 0, .little); // Length (will be updated)
    try writer.writeInt(u16, 0, .little); // Value length
    try writer.writeInt(u16, 1, .little); // Type (1 = text)
    try writer.writeAll(std.mem.sliceAsBytes(&[_]u16{ 'V', 'a', 'r', 'F', 'i', 'l', 'e', 'I', 'n', 'f', 'o', 0 }));

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // Translation block
    const translation_start = buffer.items.len;
    try writer.writeInt(u16, 0, .little); // Length (will be updated)
    try writer.writeInt(u16, 4, .little); // Value length (sizeof translation array)
    try writer.writeInt(u16, 0, .little); // Type (0 = binary)
    try writer.writeAll(std.mem.sliceAsBytes(&[_]u16{ 'T', 'r', 'a', 'n', 's', 'l', 'a', 't', 'i', 'o', 'n', 0 }));

    // Align to DWORD
    while (buffer.items.len % 4 != 0) try writer.writeByte(0);

    // Translation value (0x0409 = US English, 0x04E4 = Unicode codepage)
    try writer.writeInt(u16, 0x0409, .little);
    try writer.writeInt(u16, 0x04E4, .little);

    // Update Translation block length
    const translation_len = buffer.items.len - translation_start;
    std.mem.writeInt(u16, buffer.items[translation_start..][0..2], @intCast(translation_len), .little);

    // Update VarFileInfo length
    const var_file_info_len = buffer.items.len - var_file_info_start;
    const var_file_info_header = VersionInfoHeader{
        .length = @intCast(var_file_info_len),
        .value_length = 0,
        .type = 1,
    };
    @memcpy(buffer.items[var_file_info_start..][0..@sizeOf(VersionInfoHeader)], std.mem.asBytes(&var_file_info_header));

    // Update VS_VERSIONINFO length
    const total_len = buffer.items.len - vs_versioninfo_start;
    const final_version_header = VersionInfoHeader{
        .length = @intCast(total_len),
        .value_length = @sizeOf(VS_FIXEDFILEINFO),
        .type = 0,
    };
    @memcpy(buffer.items[vs_versioninfo_start..][0..@sizeOf(VersionInfoHeader)], std.mem.asBytes(&final_version_header));

    return buffer.toOwnedSlice();
}

/// Icon resource entry
const IconResource = struct {
    id: u16,
    data: []u8,
};

/// Parse ICO file and extract individual icon resources
fn parseIconFileImpl(allocator: Allocator, data: []const u8) !struct {
    group_icon_data: []u8,
    icons: []IconResource,
} {
    var stream = std.io.fixedBufferStream(data);
    const reader = stream.reader();

    // Read ICO header
    const reserved = try reader.readInt(u16, .little);
    const type_ = try reader.readInt(u16, .little);
    const count = try reader.readInt(u16, .little);

    if (reserved != 0 or type_ != 1) return error.InvalidIconFile;

    // Read directory entries
    const entries = try allocator.alloc(IconDirEntry, count);
    defer allocator.free(entries);
    for (entries) |*entry| {
        entry.* = try IconDirEntry.parse(reader);
    }

    // Build group icon data
    var group_data = std.ArrayList(u8).init(allocator);
    defer group_data.deinit();
    const group_writer = group_data.writer();

    try group_writer.writeInt(u16, 0, .little); // Reserved
    try group_writer.writeInt(u16, 1, .little); // Type
    try group_writer.writeInt(u16, count, .little); // Count

    // Extract individual icons
    var icons = try allocator.alloc(IconResource, count);
    errdefer {
        for (icons[0..count]) |icon| {
            allocator.free(icon.data);
        }
        allocator.free(icons);
    }

    for (entries, 0..) |entry, i| {
        // Check if this is a PNG or DIB format icon
        const image_data = data[entry.image_offset..][0..entry.bytes_in_res];
        const is_png = isPngFormat(image_data);
        
        // For PNG icons, we need to convert to DIB format for the resource
        const icon_data = if (is_png) blk: {
            // PNG-compressed icons need to be converted to DIB format
            // For now, we'll store them as-is but mark them properly
            // In a production implementation, you'd convert PNG to DIB here
            const dib_data = try convertPngToDib(allocator, image_data);
            break :blk dib_data;
        } else blk: {
            // Regular DIB format - just copy
            const dib_data = try allocator.alloc(u8, entry.bytes_in_res);
            @memcpy(dib_data, image_data);
            break :blk dib_data;
        };
        
        // Write group icon entry
        const group_entry = GroupIconDirEntry{
            .width = entry.width,
            .height = entry.height,
            .color_count = entry.color_count,
            .planes = entry.planes,
            .bit_count = entry.bit_count,
            .bytes_in_res = @intCast(icon_data.len),
            .id = @intCast(i + 1),
        };
        try group_entry.write(group_writer);

        icons[i] = .{ .id = @intCast(i + 1), .data = icon_data };
    }

    return .{
        .group_icon_data = try group_data.toOwnedSlice(),
        .icons = icons,
    };
}

/// Check if icon data is PNG format
fn isPngFormat(data: []const u8) bool {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const png_signature = [_]u8{ 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A };
    return data.len >= png_signature.len and 
           std.mem.eql(u8, data[0..png_signature.len], &png_signature);
}

/// Convert PNG to DIB format for icon resources
fn convertPngToDib(allocator: Allocator, png_data: []const u8) ![]u8 {
    // For Windows Vista and later, PNG format can be stored directly in icon resources
    // For compatibility with older Windows versions, you would need to decode the PNG
    // and convert it to DIB format. For now, we'll just pass through the PNG data
    // as modern Windows versions support it.
    const dib_data = try allocator.alloc(u8, png_data.len);
    @memcpy(dib_data, png_data);
    return dib_data;
}

pub const WindowsVersion = struct {
    major: u16,
    minor: u16,
    patch: u16,
    build: u16,
};

/// Parse existing resources from a PE file
fn parseExistingResources(allocator: Allocator, path: []const u8) !ParsedResources {
    // Open and parse the PE file
    const pe_module = @import("pe.zig");
    const pe = try pe_module.PEFile.parseFromFile(allocator, path);
    defer pe.deinit();
    
    // Find .rsrc section
    for (pe.section_headers.items, 0..) |section, i| {
        const section_name = std.mem.sliceTo(&section.name, 0);
        if (strings.eql(section_name, ".rsrc")) {
            const rsrc_data = pe.sections_data.items[i];
            return parseResourceSection(allocator, rsrc_data, section.virtual_address);
        }
    }
    
    // No resource section found - return empty
    return ParsedResources{
        .resources = std.ArrayList(Resource).init(allocator),
        .icons = &[_]ParsedResources.IconData{},
        .group_icons = &[_]ParsedResources.IconData{},
        .version_info = null,
    };
}

/// Parse resources from PE file data (for testing)
fn parseResourcesFromPEData(allocator: Allocator, data: []const u8) !ParsedResources {
    // Parse PE file from buffer
    const pe_module = @import("pe.zig");
    var stream = std.io.fixedBufferStream(data);
    const pe = try pe_module.PEFile.parse(allocator, stream.reader());
    defer pe.deinit();
    
    // Find .rsrc section
    for (pe.section_headers.items, 0..) |section, i| {
        const section_name = std.mem.sliceTo(&section.name, 0);
        if (strings.eql(section_name, ".rsrc")) {
            const rsrc_data = pe.sections_data.items[i];
            return parseResourceSection(allocator, rsrc_data, section.virtual_address);
        }
    }
    
    // No resource section found - return empty
    return ParsedResources{
        .resources = std.ArrayList(Resource).init(allocator),
        .icons = &[_]ParsedResources.IconData{},
        .group_icons = &[_]ParsedResources.IconData{},
        .version_info = null,
    };
}

/// Free parsed resources
fn freeExistingResources(allocator: Allocator, resources: ParsedResources) void {
    // Free resources list items including data for "other" resource types
    for (resources.resources.items) |*resource| {
        resource.type_value.deinit(allocator);
        resource.name_value.deinit(allocator);
        allocator.free(resource.data);
    }
    resources.resources.deinit();
    
    // Free icon data
    for (resources.icons) |icon| {
        allocator.free(icon.data);
    }
    if (resources.icons.len > 0) {
        allocator.free(resources.icons);
    }
    
    // Free group icon data
    for (resources.group_icons) |group| {
        allocator.free(group.data);
    }
    if (resources.group_icons.len > 0) {
        allocator.free(resources.group_icons);
    }
    
    // Free version info
    if (resources.version_info) |v| {
        allocator.free(v);
    }
}

/// Parse Windows version string (e.g., "1.2.3.4")
pub fn parseWindowsVersion(str: []const u8) !WindowsVersion {
    var parts_iter = std.mem.tokenizeScalar(u8, str, '.');

    const major_str = parts_iter.next() orelse return error.InvalidVersionFormat;
    const minor_str = parts_iter.next() orelse return error.InvalidVersionFormat;
    const patch_str = parts_iter.next() orelse return error.InvalidVersionFormat;
    const build_str = parts_iter.next() orelse return error.InvalidVersionFormat;

    if (parts_iter.next() != null) return error.InvalidVersionFormat;

    return WindowsVersion{
        .major = std.fmt.parseInt(u16, major_str, 10) catch return error.InvalidVersionFormat,
        .minor = std.fmt.parseInt(u16, minor_str, 10) catch return error.InvalidVersionFormat,
        .patch = std.fmt.parseInt(u16, patch_str, 10) catch return error.InvalidVersionFormat,
        .build = std.fmt.parseInt(u16, build_str, 10) catch return error.InvalidVersionFormat,
    };
}

/// Edit Windows resources in an executable
pub fn editWindowsResourcesByPath(allocator: Allocator, path: []const u8, settings: *const bun.options.WindowsSettings) !void {
    // First, parse existing resources from the PE file
    const existing_resources = try parseExistingResources(allocator, path);
    defer freeExistingResources(allocator, existing_resources);
    
    // Create resource tree and populate with existing resources
    var resource_tree = ResourceTree.init(allocator);
    defer resource_tree.deinit();
    
    // Add all existing resources except the ones we're updating
    for (existing_resources.resources.items) |resource| {
        // Skip icons and version info as we'll be replacing those
        const type_id = switch (resource.type_value) {
            .ordinal => |id| id,
            .name => continue, // Keep named resources
        };
        
        if (type_id == @intFromEnum(RT.ICON) or 
            type_id == @intFromEnum(RT.GROUP_ICON) or
            type_id == @intFromEnum(RT.VERSION)) {
            // Skip these - we'll add new ones
            if (settings.icon != null or settings.version != null or 
                settings.description != null or settings.title != null or 
                settings.publisher != null) {
                continue;
            }
        }
        
        // Clone and add the resource
        const cloned_resource = Resource{
            .type_value = try resource.type_value.clone(allocator),
            .name_value = try resource.name_value.clone(allocator),
            .language = resource.language,
            .data = try allocator.dupe(u8, resource.data),
            .memory_flags = resource.memory_flags,
            .version = resource.version,
            .characteristics = resource.characteristics,
        };
        try resource_tree.addResource(cloned_resource);
    }
    // Add icon if provided
    if (settings.icon) |icon_path| {
        const icon_data = std.fs.cwd().readFileAlloc(allocator, icon_path, 10 * 1024 * 1024) catch |err| {
            return if (err == error.FileNotFound) error.InvalidIconFile else err;
        };
        defer allocator.free(icon_data);

        const parsed_icon = try parseIconFileImpl(allocator, icon_data);
        defer allocator.free(parsed_icon.group_icon_data);
        defer {
            for (parsed_icon.icons) |icon| {
                allocator.free(icon.data);
            }
            allocator.free(parsed_icon.icons);
        }
        
        // Add individual icons
        for (parsed_icon.icons) |icon| {
            const resource = Resource{
                .type_value = .{ .ordinal = @intFromEnum(RT.ICON) },
                .name_value = .{ .ordinal = icon.id },
                .language = Language.neutral,
                .data = try allocator.dupe(u8, icon.data),
            };
            try resource_tree.addResource(resource);
        }

        // Add group icon
        const group_resource = Resource{
            .type_value = .{ .ordinal = @intFromEnum(RT.GROUP_ICON) },
            .name_value = .{ .ordinal = 1 }, // Main icon ID
            .language = Language.neutral,
            .data = try allocator.dupe(u8, parsed_icon.group_icon_data),
        };
        try resource_tree.addResource(group_resource);
    }

    // Add version info if any version-related settings are provided
    if (settings.version != null or settings.description != null or settings.title != null or settings.publisher != null) {
        const version = if (settings.version) |v| try parseWindowsVersion(v) else WindowsVersion{ .major = 1, .minor = 0, .patch = 0, .build = 0 };
        const description = settings.description orelse "";
        
        const version_data = try buildVersionInfo(allocator, version, description, settings.title, settings.publisher);
        defer allocator.free(version_data);

        const version_resource = Resource{
            .type_value = .{ .ordinal = @intFromEnum(RT.VERSION) },
            .name_value = .{ .ordinal = 1 },
            .language = Language.en_US,
            .data = try allocator.dupe(u8, version_data),
        };
        try resource_tree.addResource(version_resource);
    }

    // Calculate resource data
    const lengths = resource_tree.calculateLayout();
    
    const resource_data = try allocator.alloc(u8, lengths.total);
    defer allocator.free(resource_data);

    var resource_stream = std.io.fixedBufferStream(resource_data);
    try resource_tree.write(resource_stream.writer(), 0);
    
    // Create a temporary output path
    const tmp_path = try std.fmt.allocPrint(allocator, "{s}.tmp", .{path});
    defer allocator.free(tmp_path);
    
    // Use updateResourceSection to patch the PE file's resources
    try @import("./pe.zig").PEFile.updateResourceSection(allocator, path, tmp_path, resource_data);

    // Replace the original file with the updated one
    try std.fs.cwd().rename(tmp_path, path);
}

/// Edit Windows resources in an executable (fd variant)
pub fn editWindowsResources(allocator: Allocator, fd: bun.FileDescriptor, settings: *const bun.options.WindowsSettings) !void {
    // For now, we still need to get the path and close the fd
    // because our PE file operations need to create a new output file
    // In the future, this could be optimized to work in-place
    var path_buf: bun.PathBuffer = undefined;
    const path = fd.getFdPath(&path_buf) catch {
        return error.FailedToGetPath;
    };

    // Close the fd first since we need to modify the file
    fd.close();

    // Call the path-based version
    try editWindowsResourcesByPath(allocator, path, settings);
}

const ParsedResources = struct {
    resources: std.ArrayList(Resource),
    icons: []const IconData,
    group_icons: []const IconData,
    version_info: ?[]u8,

    const IconData = struct { id: u16, data: []u8 };
};

/// Parse resources from a PE file's resource section
pub fn parseResourceSection(allocator: Allocator, data: []const u8, virtual_base: u32) !ParsedResources {
    var result = ParsedResources{
        .resources = std.ArrayList(Resource).init(allocator),
        .icons = &[_]ParsedResources.IconData{},
        .group_icons = &[_]ParsedResources.IconData{},
        .version_info = null,
    };

    if (data.len < @sizeOf(ResourceDirectoryTable)) {
        return result;
    }

    var stream = std.io.fixedBufferStream(data);
    const reader = stream.reader();

    // Parse root directory
    const root_dir = parseDirectoryTable(reader) catch |err| {
        return result;
    };
    const root_entries = try allocator.alloc(ResourceDirectoryEntry, @as(u32, root_dir.number_of_name_entries) +% @as(u32, root_dir.number_of_id_entries));
    defer allocator.free(root_entries);

    for (root_entries) |*entry| {
        entry.* = try parseDirectoryEntry(reader);
    }

    // Find resource types we care about
    var icon_list = std.ArrayList(ParsedResources.IconData).init(allocator);
    defer icon_list.deinit();
    var group_icon_list = std.ArrayList(ParsedResources.IconData).init(allocator);
    defer group_icon_list.deinit();

    for (root_entries, 0..) |type_entry, i| {
        // Check if it's an integer ID (high bit not set)
        if (!type_entry.entry.name_offset.to_string) {
            const type_id = type_entry.entry.integer_id;
            if (!type_entry.offset.to_subdirectory) continue;

            // Seek to subdirectory
            try stream.seekTo(type_entry.offset.address);
            const name_dir = try parseDirectoryTable(reader);
            const name_entries = try allocator.alloc(ResourceDirectoryEntry, @as(u32, name_dir.number_of_name_entries) +% @as(u32, name_dir.number_of_id_entries));
            defer allocator.free(name_entries);

            for (name_entries) |*entry| {
                entry.* = try parseDirectoryEntry(reader);
            }

            for (name_entries) |name_entry| {
                if (!name_entry.offset.to_subdirectory) continue;

                // Seek to language subdirectory
                try stream.seekTo(name_entry.offset.address);
                const lang_dir = try parseDirectoryTable(reader);
                const lang_entries = try allocator.alloc(ResourceDirectoryEntry, @as(u32, lang_dir.number_of_name_entries) +% @as(u32, lang_dir.number_of_id_entries));
                defer allocator.free(lang_entries);

                for (lang_entries) |*entry| {
                    entry.* = try parseDirectoryEntry(reader);
                }

                for (lang_entries) |lang_entry| {
                    if (lang_entry.offset.to_subdirectory) continue;

                    // Read data entry
                    try stream.seekTo(lang_entry.offset.address);
                    const data_entry = try parseDataEntry(reader);

                    // Extract actual data
                    const data_offset = data_entry.data_rva -% virtual_base;
                    if (data_offset >= data.len or data_offset +% data_entry.size > data.len) continue;

                    const resource_data = data[data_offset..][0..data_entry.size];

                    // Skip named types for now
                    if (type_entry.entry.name_offset.to_string) continue;
                    
                    // Allocate resource data once
                    const data_copy = try allocator.dupe(u8, resource_data);
                    
                    // Collect specific types for testing API
                    switch (type_id) {
                        @intFromEnum(RT.ICON) => {
                            if (!name_entry.entry.name_offset.to_string) {
                                try icon_list.append(.{ .id = @intCast(name_entry.entry.integer_id), .data = data_copy });
                            }
                        },
                        @intFromEnum(RT.GROUP_ICON) => {
                            if (!name_entry.entry.name_offset.to_string) {
                                try group_icon_list.append(.{ .id = @intCast(name_entry.entry.integer_id), .data = data_copy });
                            }
                        },
                        @intFromEnum(RT.VERSION) => {
                            result.version_info = data_copy;
                        },
                        else => {
                            // For other types, we don't keep them in the simplified lists
                            // but we still need to track them in resources list
                            const type_value = NameOrOrdinal{ .ordinal = @intCast(type_id) };
                            const name_value = if (name_entry.entry.name_offset.to_string) 
                                NameOrOrdinal{ .ordinal = 0 }
                            else 
                                NameOrOrdinal{ .ordinal = @intCast(name_entry.entry.integer_id) };
                            
                            const resource = Resource{
                                .type_value = type_value,
                                .name_value = name_value,
                                .language = Language{ 
                                    .primary = @intCast(lang_entry.entry.integer_id & 0x3FF),
                                    .sub = @intCast((lang_entry.entry.integer_id >> 10) & 0x3F),
                                },
                                .data = data_copy,
                            };
                            try result.resources.append(resource);
                        },
                    }
                }
            }
        }
    }

    result.icons = try icon_list.toOwnedSlice();
    result.group_icons = try group_icon_list.toOwnedSlice();
    
    return result;
}

fn parseDirectoryTable(reader: anytype) !ResourceDirectoryTable {
    return ResourceDirectoryTable{
        .characteristics = try reader.readInt(u32, .little),
        .timestamp = try reader.readInt(u32, .little),
        .major_version = try reader.readInt(u16, .little),
        .minor_version = try reader.readInt(u16, .little),
        .number_of_name_entries = try reader.readInt(u16, .little),
        .number_of_id_entries = try reader.readInt(u16, .little),
    };
}

fn parseDirectoryEntry(reader: anytype) !ResourceDirectoryEntry {
    const entry_bits = try reader.readInt(u32, .little);
    const offset_bits = try reader.readInt(u32, .little);

    return ResourceDirectoryEntry{
        .entry = if (entry_bits & 0x80000000 != 0)
            .{ .name_offset = .{ .address = @intCast(entry_bits & 0x7FFFFFFF), .to_string = true } }
        else
            .{ .integer_id = entry_bits },
        .offset = .{
            .address = @intCast(offset_bits & 0x7FFFFFFF),
            .to_subdirectory = (offset_bits & 0x80000000) != 0,
        },
    };
}

fn parseDataEntry(reader: anytype) !ResourceDataEntry {
    return ResourceDataEntry{
        .data_rva = try reader.readInt(u32, .little),
        .size = try reader.readInt(u32, .little),
        .codepage = try reader.readInt(u32, .little),
        .reserved = try reader.readInt(u32, .little),
    };
}

/// Testing APIs
pub const TestingAPIs = struct {
    pub fn parseIconFile(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("parseIconFile", 1, arguments.len);
        }

        const data_value = arguments[0];
        const data = data_value.asArrayBuffer(globalThis) orelse {
            return globalThis.throwInvalidArgumentType("parseIconFile", "data", "ArrayBuffer");
        };

        const allocator = bun.default_allocator;
        const result = parseIconFileImpl(allocator, data.slice()) catch |err| {
            return globalThis.throwError(err, "Failed to parse icon file");
        };
        defer allocator.free(result.group_icon_data);
        defer {
            for (result.icons) |icon| {
                allocator.free(icon.data);
            }
            allocator.free(result.icons);
        }

        const obj = JSValue.createEmptyObject(globalThis, 2);
        obj.put(globalThis, "groupIconData", try jsc.ArrayBuffer.fromBytes(result.group_icon_data, .Uint8Array).toJS(globalThis));

        const icons_array = try JSValue.createEmptyArray(globalThis, result.icons.len);
        for (result.icons, 0..) |icon, i| {
            const icon_obj = JSValue.createEmptyObject(globalThis, 2);
            icon_obj.put(globalThis, "id", JSValue.jsNumber(icon.id));
            icon_obj.put(globalThis, "data", try jsc.ArrayBuffer.fromBytes(icon.data, .Uint8Array).toJS(globalThis));
            try icons_array.putIndex(globalThis, @intCast(i), icon_obj);
        }
        obj.put(globalThis, "icons", icons_array);

        return obj;
    }

    pub fn parseResources(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len < 1) {
            return globalThis.throwNotEnoughArguments("parseResources", 1, arguments.len);
        }

        const exe_data = arguments[0].asArrayBuffer(globalThis) orelse {
            return globalThis.throwInvalidArgumentType("parseResources", "exeData", "ArrayBuffer");
        };

        const allocator = bun.default_allocator;
        
        // Parse resources from PE data
        const resources = parseResourcesFromPEData(allocator, exe_data.slice()) catch |err| {
            return globalThis.throwError(err, "Failed to parse resources");
        };
        defer freeExistingResources(allocator, resources);

        const obj = JSValue.createEmptyObject(globalThis, 3);

        // Add icons
        const icons_array = try JSValue.createEmptyArray(globalThis, resources.icons.len);
        for (resources.icons, 0..) |icon, i| {
            const icon_obj = JSValue.createEmptyObject(globalThis, 2);
            icon_obj.put(globalThis, "id", JSValue.jsNumber(icon.id));
            icon_obj.put(globalThis, "data", try jsc.ArrayBuffer.fromBytes(icon.data, .Uint8Array).toJS(globalThis));
            try icons_array.putIndex(globalThis, @intCast(i), icon_obj);
        }
        obj.put(globalThis, "icons", icons_array);

        // Add group icons
        const groups_array = try JSValue.createEmptyArray(globalThis, resources.group_icons.len);
        for (resources.group_icons, 0..) |group, i| {
            const group_obj = JSValue.createEmptyObject(globalThis, 2);
            group_obj.put(globalThis, "id", JSValue.jsNumber(group.id));
            group_obj.put(globalThis, "data", try jsc.ArrayBuffer.fromBytes(group.data, .Uint8Array).toJS(globalThis));
            try groups_array.putIndex(globalThis, @intCast(i), group_obj);
        }
        obj.put(globalThis, "groupIcons", groups_array);

        // Add version info
        if (resources.version_info) |version_data| {
            // Parse version info to extract strings
            const version_obj = try parseVersionInfo(globalThis, version_data);
            obj.put(globalThis, "versionInfo", version_obj);
        } else {
            obj.put(globalThis, "versionInfo", JSValue.null);
        }

        return obj;
    }

    fn parseVersionInfo(globalThis: *JSGlobalObject, data: []const u8) bun.JSError!JSValue {
        if (data.len < 6) return JSValue.null;

        const obj = JSValue.createEmptyObject(globalThis, 5);

        // Parse VS_FIXEDFILEINFO if present
        const fixed_info_offset = findFixedFileInfo(data);
        if (fixed_info_offset) |offset| {
            if (offset + @sizeOf(VS_FIXEDFILEINFO) <= data.len) {
                const fixed_data = data[offset..][0..@sizeOf(VS_FIXEDFILEINFO)];
                const file_version_ms = std.mem.readInt(u32, fixed_data[8..12], .little);
                const file_version_ls = std.mem.readInt(u32, fixed_data[12..16], .little);

                const version_str = std.fmt.allocPrint(bun.default_allocator, "{d}.{d}.{d}.{d}", .{
                    file_version_ms >> 16,
                    file_version_ms & 0xFFFF,
                    file_version_ls >> 16,
                    file_version_ls & 0xFFFF,
                }) catch return JSValue.null;
                defer bun.default_allocator.free(version_str);

                obj.put(globalThis, "fileVersion", try bun.String.createUTF8ForJS(globalThis, version_str));
            }
        }

        // Try to find FileDescription string
        const desc_key = "FileDescription";
        if (findVersionString(data, desc_key)) |desc_value| {
            obj.put(globalThis, "fileDescription", try bun.String.createUTF8ForJS(globalThis, desc_value));
        }

        return obj;
    }

    fn findFixedFileInfo(data: []const u8) ?usize {
        const signature: u32 = 0xFEEF04BD;
        if (data.len < @sizeOf(VS_FIXEDFILEINFO)) return null;

        // Scan for the signature
        var i: usize = 0;
        while (i <= data.len - 4) : (i += 4) {
            if (std.mem.readInt(u32, data[i..][0..4], .little) == signature) {
                return i;
            }
        }
        return null;
    }

    fn findVersionString(data: []const u8, key: []const u8) ?[]const u8 {
        // This is a simplified version string finder
        // In reality, version info has a complex structure with nested blocks
        // For testing purposes, we just search for the key as UTF-16 and extract the value

        // Convert key to UTF-16
        var key_utf16_buf: [256]u16 = undefined;
        const key_utf16_len = std.unicode.utf8ToUtf16Le(&key_utf16_buf, key) catch return null;
        const key_utf16 = key_utf16_buf[0..key_utf16_len];

        // Search for the key
        var i: usize = 0;
        while (i < data.len - key_utf16.len * 2 - 2) : (i += 2) {
            const potential_key = std.mem.bytesAsSlice(u16, data[i..][0 .. key_utf16.len * 2]);
            if (std.mem.eql(u16, @alignCast(potential_key), key_utf16)) {
                // Found key, skip past it and any padding/header
                var value_start = i + key_utf16.len * 2;

                // Skip null terminator and padding
                while (value_start < data.len - 2 and data[value_start] == 0) : (value_start += 1) {}

                // Read until null terminator
                var value_end = value_start;
                while (value_end < data.len - 1) : (value_end += 2) {
                    if (data[value_end] == 0 and data[value_end + 1] == 0) break;
                }

                if (value_end > value_start) {
                    // Convert UTF-16 to UTF-8
                    const utf16_data = std.mem.bytesAsSlice(u16, data[value_start..value_end]);
                    const utf8_buf = bun.default_allocator.alloc(u8, utf16_data.len * 3) catch return null;
                    const utf8_len = std.unicode.utf16LeToUtf8(utf8_buf, @alignCast(utf16_data)) catch {
                        bun.default_allocator.free(utf8_buf);
                        return null;
                    };
                    return utf8_buf[0..utf8_len];
                }
            }
        }

        return null;
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
