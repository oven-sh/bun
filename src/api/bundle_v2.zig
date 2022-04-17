const std = @import("std");

pub const Reader = struct {
    const Self = @This();
    pub const ReadError = error{EOF};

    buf: []u8,
    remain: []u8,
    allocator: std.mem.Allocator,

    pub fn init(buf: []u8, allocator: std.mem.Allocator) Reader {
        return Reader{
            .buf = buf,
            .remain = buf,
            .allocator = allocator,
        };
    }

    pub fn read(this: *Self, count: usize) ![]u8 {
        const read_count = @minimum(count, this.remain.len);
        if (read_count < count) {
            return error.EOF;
        }

        var slice = this.remain[0..read_count];

        this.remain = this.remain[read_count..];

        return slice;
    }

    pub inline fn readAs(this: *Self, comptime T: type) !T {
        if (!std.meta.trait.hasUniqueRepresentation(T)) {
            @compileError(@typeName(T) ++ " must have unique representation.");
        }

        return std.mem.bytesAsValue(T, try this.read(@sizeOf(T)));
    }

    pub inline fn readByte(this: *Self) !u8 {
        return (try this.read(1))[0];
    }

    pub fn readEnum(this: *Self, comptime Enum: type) !Enum {
        const E = error{
            /// An integer was read, but it did not match any of the tags in the supplied enum.
            InvalidValue,
        };
        const type_info = @typeInfo(Enum).Enum;
        const tag = try this.readInt(type_info.tag_type);

        inline for (std.meta.fields(Enum)) |field| {
            if (tag == field.value) {
                return @field(Enum, field.name);
            }
        }

        return E.InvalidValue;
    }

    pub inline fn readArray(this: *Self, comptime T: type) ![]const T {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]T{});
        }

        switch (comptime T) {
            u8 => {
                return try this.read(length);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, this.read(length * @sizeOf(T)));
            },
            [:0]const u8, []const u8 => {
                var i: u32 = 0;
                var array = try this.allocator.alloc(T, length);
                while (i < length) : (i += 1) {
                    array[i] = try this.readArray(u8);
                }
                return array;
            },
            else => {
                switch (comptime @typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                var slice = try this.read(sizeof * length);
                                return std.mem.bytesAsSlice(T, slice);
                            },
                            else => {},
                        }
                    },
                    .Enum => |type_info| {
                        const enum_values = try this.read(length * @sizeOf(type_info.tag_type));
                        return @ptrCast([*]T, enum_values.ptr)[0..length];
                    },
                    else => {},
                }

                var i: u32 = 0;
                var array = try this.allocator.alloc(T, length);
                while (i < length) : (i += 1) {
                    array[i] = try this.readValue(T);
                }

                return array;
            },
        }
    }

    pub inline fn readByteArray(this: *Self) ![]u8 {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]u8{});
        }

        return try this.read(@as(usize, length));
    }

    pub inline fn readInt(this: *Self, comptime T: type) !T {
        var slice = try this.read(@sizeOf(T));

        return std.mem.readIntSliceNative(T, slice);
    }

    pub inline fn readBool(this: *Self) !bool {
        return (try this.readByte()) > 0;
    }

    pub inline fn readValue(this: *Self, comptime T: type) !T {
        switch (comptime T) {
            bool => {
                return try this.readBool();
            },
            u8 => {
                return try this.readByte();
            },
            [*:0]const u8, [:0]const u8, []const u8 => {
                return try this.readArray(u8);
            },

            []const [:0]const u8, []const [*:0]const u8, []const []const u8 => {
                return try this.readArray([]const u8);
            },
            []u8, [:0]u8, [*:0]u8 => {
                return try this.readArray([]u8);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, try this.read(@sizeOf(T)));
            },
            else => {
                switch (comptime @typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                var slice = try this.read(sizeof);
                                return @ptrCast(*T, slice[0..sizeof]).*;
                            },
                            else => {},
                        }
                    },
                    .Enum => {
                        return try this.readEnum(T);
                    },
                    else => {},
                }

                return try T.decode(this);
            },
        }

        @compileError("Invalid type passed to readValue");
    }
};

pub fn Writer(comptime WritableStream: type) type {
    return struct {
        const Self = @This();
        writable: WritableStream,

        pub fn init(writable: WritableStream) Self {
            return Self{ .writable = writable };
        }

        pub inline fn write(this: *Self, bytes: anytype) !void {
            _ = try this.writable.write(bytes);
        }

        pub inline fn writeByte(this: *Self, byte: u8) !void {
            _ = try this.writable.write(&[1]u8{byte});
        }

        pub inline fn writeInt(this: *Self, int: anytype) !void {
            try this.write(std.mem.asBytes(&int));
        }

        pub inline fn writeFieldID(this: *Self, comptime id: comptime_int) !void {
            try this.writeByte(id);
        }

        pub inline fn writeEnum(this: *Self, val: anytype) !void {
            try this.writeInt(@enumToInt(val));
        }

        pub fn writeValue(this: *Self, comptime SliceType: type, slice: SliceType) !void {
            switch (SliceType) {
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                [:0]u16,
                [:0]u32,
                [:0]i16,
                [:0]i32,
                [:0]i8,
                [:0]const u16,
                [:0]const u32,
                [:0]const i16,
                [:0]const i32,
                [:0]const i8,
                [*:0]u16,
                [*:0]u32,
                [*:0]i16,
                [*:0]i32,
                [*:0]i8,
                [*:0]const u16,
                [*:0]const u32,
                [*:0]const i16,
                [*:0]const i32,
                [*:0]const i8,
                => {
                    try this.writeArray(SliceType, slice);
                },

                []u8,
                []const u8,
                [:0]u8,
                [:0]const u8,
                [*:0]u8,
                [*:0]const u8,
                => {
                    try this.writeArray(u8, slice);
                },

                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },

                else => {
                    try slice.encode(this);
                },
            }
        }

        pub inline fn writeArray(this: *Self, comptime T: type, slice: anytype) !void {
            try this.writeInt(@truncate(u32, slice.len));

            switch (T) {
                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },
                [:0]u8,
                []u8,
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u8,
                [:0]const u8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                [:0]u16,
                [:0]u32,
                [:0]i16,
                [:0]i32,
                [:0]i8,
                [:0]const u16,
                [:0]const u32,
                [:0]const i16,
                [:0]const i32,
                [:0]const i8,
                [*:0]u16,
                [*:0]u32,
                [*:0]i16,
                [*:0]i32,
                [*:0]i8,
                [*:0]const u16,
                [*:0]const u32,
                [*:0]const i16,
                [*:0]const i32,
                [*:0]const i8,
                => {
                    for (slice) |num_slice| {
                        try this.writeArray(std.meta.Child(@TypeOf(num_slice)), num_slice);
                    }
                },
                else => {
                    for (slice) |val| {
                        try val.encode(this);
                    }
                },
            }
        }

        pub inline fn endMessage(this: *Self) !void {
            try this.writeByte(0);
        }
    };
}

pub const ByteWriter = Writer(*std.io.FixedBufferStream([]u8));
pub const FileWriter = Writer(std.fs.File);

pub const BundleV2 = struct {
    pub const StringPointer = packed struct {
        /// offset
        offset: u32 = 0,

        /// length
        length: u32 = 0,

        pub fn decode(reader: anytype) anyerror!StringPointer {
            var this = std.mem.zeroes(StringPointer);

            this.offset = try reader.readValue(u32);
            this.length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.offset);
            try writer.writeInt(this.length);
        }
    };

    pub const JavascriptBundledPart = struct {
        /// code
        code: StringPointer,

        /// dependencies_offset
        dependencies_offset: u32 = 0,

        /// dependencies_length
        dependencies_length: u32 = 0,

        /// exports_offset
        exports_offset: u32 = 0,

        /// exports_length
        exports_length: u32 = 0,

        /// from_module
        from_module: u32 = 0,

        pub fn decode(reader: anytype) anyerror!JavascriptBundledPart {
            var this = std.mem.zeroes(JavascriptBundledPart);

            this.code = try reader.readValue(StringPointer);
            this.dependencies_offset = try reader.readValue(u32);
            this.dependencies_length = try reader.readValue(u32);
            this.exports_offset = try reader.readValue(u32);
            this.exports_length = try reader.readValue(u32);
            this.from_module = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.code), this.code);
            try writer.writeInt(this.dependencies_offset);
            try writer.writeInt(this.dependencies_length);
            try writer.writeInt(this.exports_offset);
            try writer.writeInt(this.exports_length);
            try writer.writeInt(this.from_module);
        }
    };

    pub const JavascriptBundledModule = struct {
        /// path
        path: StringPointer,

        /// parts_offset
        parts_offset: u32 = 0,

        /// parts_length
        parts_length: u32 = 0,

        /// exports_offset
        exports_offset: u32 = 0,

        /// exports_length
        exports_length: u32 = 0,

        /// package_id
        package_id: u32 = 0,

        /// path_extname_length
        path_extname_length: u8 = 0,

        pub fn decode(reader: anytype) anyerror!JavascriptBundledModule {
            var this = std.mem.zeroes(JavascriptBundledModule);

            this.path = try reader.readValue(StringPointer);
            this.parts_offset = try reader.readValue(u32);
            this.parts_length = try reader.readValue(u32);
            this.exports_offset = try reader.readValue(u32);
            this.exports_length = try reader.readValue(u32);
            this.package_id = try reader.readValue(u32);
            this.path_extname_length = try reader.readValue(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeInt(this.parts_offset);
            try writer.writeInt(this.parts_length);
            try writer.writeInt(this.exports_offset);
            try writer.writeInt(this.exports_length);
            try writer.writeInt(this.package_id);
            try writer.writeInt(this.path_extname_length);
        }
    };

    pub const JavascriptBundledPackage = struct {
        /// name
        name: StringPointer,

        /// version
        version: StringPointer,

        /// hash
        hash: u32 = 0,

        /// modules_offset
        modules_offset: u32 = 0,

        /// modules_length
        modules_length: u32 = 0,

        pub fn decode(reader: anytype) anyerror!JavascriptBundledPackage {
            var this = std.mem.zeroes(JavascriptBundledPackage);

            this.name = try reader.readValue(StringPointer);
            this.version = try reader.readValue(StringPointer);
            this.hash = try reader.readValue(u32);
            this.modules_offset = try reader.readValue(u32);
            this.modules_length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.name), this.name);
            try writer.writeValue(@TypeOf(this.version), this.version);
            try writer.writeInt(this.hash);
            try writer.writeInt(this.modules_offset);
            try writer.writeInt(this.modules_length);
        }
    };

    pub const JavascriptBundle = struct {
        /// modules
        modules: []const JavascriptBundledModule,

        /// packages
        packages: []const JavascriptBundledPackage,

        /// parts
        parts: []const JavascriptBundledPart,

        /// export_names
        export_names: []const StringPointer,

        /// export_parts
        export_parts: []const u32,

        /// etag
        etag: []const u8,

        /// generated_at
        generated_at: u32 = 0,

        /// import_from_name
        import_from_name: []const u8,

        /// manifest_string
        manifest_string: []const u8,

        pub fn decode(reader: anytype) anyerror!JavascriptBundle {
            var this = std.mem.zeroes(JavascriptBundle);

            this.modules = try reader.readArray(JavascriptBundledModule);
            this.packages = try reader.readArray(JavascriptBundledPackage);
            this.parts = try reader.readArray(JavascriptBundledPart);
            this.export_names = try reader.readArray(StringPointer);
            this.export_parts = try reader.readArray(u32);
            this.etag = try reader.readArray(u8);
            this.generated_at = try reader.readValue(u32);
            this.import_from_name = try reader.readArray(u8);
            this.manifest_string = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray(JavascriptBundledModule, this.modules);
            try writer.writeArray(JavascriptBundledPackage, this.packages);
            try writer.writeArray(JavascriptBundledPart, this.parts);
            try writer.writeArray(StringPointer, this.export_names);
            try writer.writeArray(u32, this.export_parts);
            try writer.writeArray(u8, this.etag);
            try writer.writeInt(this.generated_at);
            try writer.writeArray(u8, this.import_from_name);
            try writer.writeArray(u8, this.manifest_string);
        }
    };

    pub const JavascriptBundleContainer = struct {
        /// bundle_format_version
        bundle_format_version: ?u32 = null,

        /// bundle
        bundle: ?JavascriptBundle = null,

        /// code_length
        code_length: ?u32 = null,

        pub fn decode(reader: anytype) anyerror!JavascriptBundleContainer {
            var this = std.mem.zeroes(JavascriptBundleContainer);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.bundle_format_version = try reader.readValue(u32);
                    },
                    2 => {
                        this.bundle = try reader.readValue(JavascriptBundle);
                    },
                    3 => {
                        this.code_length = try reader.readValue(u32);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.bundle_format_version) |bundle_format_version| {
                try writer.writeFieldID(1);
                try writer.writeInt(bundle_format_version);
            }
            if (this.bundle) |bundle| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(bundle), bundle);
            }
            if (this.code_length) |code_length| {
                try writer.writeFieldID(3);
                try writer.writeInt(code_length);
            }
            try writer.endMessage();
        }
    };
};
