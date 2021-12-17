const std = @import("std");

pub const Reader = struct {
    const Self = @This();
    pub const ReadError = error{EOF};

    buf: []u8,
    remain: []u8,
    allocator: *std.mem.Allocator,

    pub fn init(buf: []u8, allocator: *std.mem.Allocator) Reader {
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
                var i: u32 = 0;
                var array = try this.allocator.alloc(T, length);
                while (i < length) : (i += 1) {
                    array[i] = std.mem.readIntSliceNative(T, (try this.read(@sizeOf(T)))[0..@sizeOf(T)]);
                }
                return array;
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
                    .Enum => |type_info| {
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
                    try this.write(std.mem.sliceAsBytes(slice));
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

pub const Hop = struct {
    pub const StringPointer = packed struct {
        /// off
        off: u32 = 0,

        /// len
        len: u32 = 0,

        pub fn decode(reader: anytype) anyerror!StringPointer {
            var this = std.mem.zeroes(StringPointer);

            this.off = try reader.readValue(u32);
            this.len = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.off);
            try writer.writeInt(this.len);
        }
    };

    pub const File = packed struct {
        /// name
        name: StringPointer,

        /// name_hash
        name_hash: u32 = 0,

        /// chmod
        chmod: u32 = 0,

        /// mtime
        mtime: u32 = 0,

        /// ctime
        ctime: u32 = 0,

        /// data
        data: StringPointer,

        pub fn decode(reader: anytype) anyerror!File {
            var this = File{ .name = StringPointer{}, .data = .{} };

            this.name = try reader.readValue(StringPointer);
            this.name_hash = try reader.readValue(u32);
            this.chmod = try reader.readValue(u32);
            this.mtime = try reader.readValue(u32);
            this.ctime = try reader.readValue(u32);
            this.data = try reader.readValue(StringPointer);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.name), this.name);
            try writer.writeInt(this.name_hash);
            try writer.writeInt(this.chmod);
            try writer.writeInt(this.mtime);
            try writer.writeInt(this.ctime);
            try writer.writeValue(@TypeOf(this.data), this.data);
        }
    };

    pub const Archive = struct {
        /// version
        version: ?u32 = null,

        /// content_offset
        content_offset: ?u32 = null,

        /// files
        files: []align(1) const File,

        /// name_hashes
        name_hashes: []align(1) const u32,

        /// metadata
        metadata: []align(1) const u8,

        pub fn decode(reader: anytype) anyerror!Archive {
            var this = std.mem.zeroes(Archive);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.version = try reader.readValue(u32);
                    },
                    2 => {
                        this.content_offset = try reader.readValue(u32);
                    },
                    3 => {
                        this.files = try reader.readArray(File);
                    },
                    4 => {
                        this.name_hashes = try reader.readArray(u32);
                    },
                    5 => {
                        this.metadata = try reader.readArray(u8);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.version) |version| {
                try writer.writeFieldID(1);
                try writer.writeInt(version);
            }
            if (this.content_offset) |content_offset| {
                try writer.writeFieldID(2);
                try writer.writeInt(content_offset);
            }
            if (this.files.len > 0) {
                try writer.writeFieldID(3);
                try writer.writeArray(File, this.files);
            }
            if (this.name_hashes.len > 0) {
                try writer.writeFieldID(4);
                try writer.writeArray(u32, this.name_hashes);
            }
            if (this.metadata.len > 0) {
                try writer.writeFieldID(5);
                try writer.writeArray(u8, this.metadata);
            }
            try writer.endMessage();
        }
    };
};
