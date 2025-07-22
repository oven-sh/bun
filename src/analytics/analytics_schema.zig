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
        const read_count = @min(count, this.remain.len);
        if (read_count < count) {
            return error.EOF;
        }

        const slice = this.remain[0..read_count];

        this.remain = this.remain[read_count..];

        return slice;
    }

    pub inline fn readAs(this: *Self, comptime T: type) !T {
        if (!std.meta.hasUniqueRepresentation(T)) {
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

    pub fn readArray(this: *Self, comptime T: type) ![]const T {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]T{});
        }

        switch (T) {
            u8 => {
                return try this.read(length);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, this.read(length * @sizeOf(T)));
            },
            [:0]const u8, []const u8 => {
                const array = try this.allocator.alloc(T, length);
                for (array) |*a| a.* = try this.readArray(u8);
                return array;
            },
            else => {
                switch (comptime @typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                const slice = try this.read(sizeof * length);
                                return std.mem.bytesAsSlice(T, slice);
                            },
                            else => {},
                        }
                    },
                    .Enum => |type_info| {
                        const enum_values = try this.read(length * @sizeOf(type_info.tag_type));
                        return @as([*]T, @ptrCast(enum_values.ptr))[0..length];
                    },
                    else => {},
                }

                const array = try this.allocator.alloc(T, length);
                for (array) |*v| v.* = try this.readValue(T);
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
        const slice = try this.read(@sizeOf(T));

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
                                return @as(*align(1) T, @ptrCast(slice[0..sizeof])).*;
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
            try this.writeInt(@intFromEnum(val));
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

        pub fn writeArray(this: *Self, comptime T: type, slice: anytype) !void {
            try this.writeInt(@as(u32, @truncate(slice.len)));

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

pub const analytics = struct {
    pub const OperatingSystem = enum(u8) {
        _none,
        /// linux
        linux,

        /// macos
        macos,

        /// windows
        windows,

        /// wsl
        wsl,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Architecture = enum(u8) {
        _none,
        /// x64
        x64,

        /// arm
        arm,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Platform = struct {
        /// os
        os: OperatingSystem,

        /// arch
        arch: Architecture,

        /// version
        version: []const u8,

        pub fn decode(reader: anytype) anyerror!Platform {
            var this = std.mem.zeroes(Platform);

            this.os = try reader.readValue(OperatingSystem);
            this.arch = try reader.readValue(Architecture);
            this.version = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.os);
            try writer.writeEnum(this.arch);
            try writer.writeArray(u8, this.version);
        }
    };

    pub const EventKind = enum(u32) {
        _none,
        /// bundle_success
        bundle_success,

        /// bundle_fail
        bundle_fail,

        /// http_start
        http_start,

        /// http_build
        http_build,

        /// bundle_start
        bundle_start,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Uint64 = packed struct {
        /// first
        first: u32 = 0,

        /// second
        second: u32 = 0,

        pub fn decode(reader: anytype) anyerror!Uint64 {
            var this = std.mem.zeroes(Uint64);

            this.first = try reader.readValue(u32);
            this.second = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.first);
            try writer.writeInt(this.second);
        }
    };

    pub const EventListHeader = struct {
        /// machine_id
        machine_id: Uint64,

        /// session_id
        session_id: u32 = 0,

        /// platform
        platform: Platform,

        /// build_id
        build_id: u32 = 0,

        /// project_id
        project_id: Uint64,

        /// session_length
        session_length: u32 = 0,

        /// feature_usage
        feature_usage: u32 = 0,

        pub fn decode(reader: anytype) anyerror!EventListHeader {
            var this = std.mem.zeroes(EventListHeader);

            this.machine_id = try reader.readValue(Uint64);
            this.session_id = try reader.readValue(u32);
            this.platform = try reader.readValue(Platform);
            this.build_id = try reader.readValue(u32);
            this.project_id = try reader.readValue(Uint64);
            this.session_length = try reader.readValue(u32);
            this.feature_usage = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.machine_id), this.machine_id);
            try writer.writeInt(this.session_id);
            try writer.writeValue(@TypeOf(this.platform), this.platform);
            try writer.writeInt(this.build_id);
            try writer.writeValue(@TypeOf(this.project_id), this.project_id);
            try writer.writeInt(this.session_length);
            try writer.writeInt(this.feature_usage);
        }
    };

    pub const EventHeader = struct {
        /// timestamp
        timestamp: Uint64,

        /// kind
        kind: EventKind,

        pub fn decode(reader: anytype) anyerror!EventHeader {
            var this = std.mem.zeroes(EventHeader);

            this.timestamp = try reader.readValue(Uint64);
            this.kind = try reader.readValue(EventKind);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.timestamp), this.timestamp);
            try writer.writeEnum(this.kind);
        }
    };

    pub const EventList = struct {
        /// header
        header: EventListHeader,

        /// event_count
        event_count: u32 = 0,

        pub fn decode(reader: anytype) anyerror!EventList {
            var this = std.mem.zeroes(EventList);

            this.header = try reader.readValue(EventListHeader);
            this.event_count = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.header), this.header);
            try writer.writeInt(this.event_count);
        }
    };
};

const std = @import("std");
