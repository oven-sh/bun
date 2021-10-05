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
        const read_count = std.math.min(count, this.remain.len);
        if (read_count < count) {
            return error.EOF;
        }

        var slice = this.remain[0..read_count];

        this.remain = this.remain[read_count..];

        return slice;
    }

    pub fn readAs(this: *Self, comptime T: type) !T {
        if (!std.meta.trait.hasUniqueRepresentation(T)) {
            @compileError(@typeName(T) ++ " must have unique representation.");
        }

        return std.mem.bytesAsValue(T, try this.read(@sizeOf(T)));
    }

    pub fn readByte(this: *Self) !u8 {
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
            []const u8 => {
                var i: u32 = 0;
                var array = try this.allocator.alloc([]const u8, length);
                while (i < length) : (i += 1) {
                    array[i] = try this.readArray(u8);
                }
                return array;
            },
            else => {
                switch (@typeInfo(T)) {
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

    pub fn readByteArray(this: *Self) ![]u8 {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]u8{});
        }

        return try this.read(@intCast(usize, length));
    }

    pub fn readInt(this: *Self, comptime T: type) !T {
        var slice = try this.read(@sizeOf(T));

        return std.mem.readIntSliceNative(T, slice);
    }

    pub fn readBool(this: *Self) !bool {
        return (try this.readByte()) > 0;
    }

    pub fn readValue(this: *Self, comptime T: type) !T {
        switch (T) {
            bool => {
                return try this.readBool();
            },
            u8 => {
                return try this.readByte();
            },
            []const u8 => {
                return try this.readArray(u8);
            },

            []const []const u8 => {
                return try this.readArray([]const u8);
            },
            []u8 => {
                return try this.readArray([]u8);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, try this.read(@sizeOf(T)));
            },
            else => {
                switch (@typeInfo(T)) {
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

        pub fn write(this: *Self, bytes: anytype) !void {
            _ = try this.writable.write(bytes);
        }

        pub fn writeByte(this: *Self, byte: u8) !void {
            _ = try this.writable.write(&[1]u8{byte});
        }

        pub fn writeInt(this: *Self, int: anytype) !void {
            try this.write(std.mem.asBytes(&int));
        }

        pub fn writeFieldID(this: *Self, comptime id: comptime_int) !void {
            try this.writeByte(id);
        }

        pub fn writeEnum(this: *Self, val: anytype) !void {
            try this.writeInt(@enumToInt(val));
        }

        pub fn writeValue(this: *Self, slice: anytype) !void {
            switch (@TypeOf(slice)) {
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
                => {
                    try this.writeArray(@TypeOf(slice), slice);
                },

                []u8, []const u8 => {
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
            try this.writeInt(@truncate(u32, slice.len));

            switch (T) {
                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },
                []u8,
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
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

        pub fn endMessage(this: *Self) !void {
            try this.writeByte(0);
        }
    };
}

pub const ByteWriter = Writer(*std.io.FixedBufferStream([]u8));
pub const FileWriter = Writer(std.fs.File);

pub const Analytics = struct {
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

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Architecture = enum(u8) {
        _none,
        /// x64
        x64,

        /// arm
        arm,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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
            this.version = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.os);
            try writer.writeEnum(this.arch);
            try writer.writeValue(this.version);
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

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
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

        /// session_length
        session_length: u32 = 0,

        pub fn decode(reader: anytype) anyerror!EventListHeader {
            var this = std.mem.zeroes(EventListHeader);

            this.machine_id = try reader.readValue(Uint64);
            this.session_id = try reader.readValue(u32);
            this.platform = try reader.readValue(Platform);
            this.build_id = try reader.readValue(u32);
            this.session_length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(this.machine_id);
            try writer.writeInt(this.session_id);
            try writer.writeValue(this.platform);
            try writer.writeInt(this.build_id);
            try writer.writeInt(this.session_length);
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
            try writer.writeValue(this.timestamp);
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
            try writer.writeValue(this.header);
            try writer.writeInt(this.event_count);
        }
    };
};

const ExamplePackedStruct = packed struct {
    len: u32 = 0,
    offset: u32 = 0,

    pub fn encode(this: *const ExamplePackedStruct, writer: anytype) !void {
        try writer.write(std.mem.asBytes(this));
    }

    pub fn decode(reader: anytype) !ExamplePackedStruct {
        return try reader.readAs(ExamplePackedStruct);
    }
};

const ExampleStruct = struct {
    name: []const u8 = "",
    age: u32 = 0,

    pub fn encode(this: *const ExampleStruct, writer: anytype) !void {
        try writer.writeArray(u8, this.name);
        try writer.writeInt(this.age);
    }

    pub fn decode(reader: anytype) !ExampleStruct {
        var this = std.mem.zeroes(ExampleStruct);
        this.name = try reader.readArray(u8);
        this.age = try reader.readInt(u32);

        return this;
    }
};

const EnumValue = enum(u8) { hey, hi, heyopoo };

const ExampleMessage = struct {
    examples: ?[]ExampleStruct = &([_]ExampleStruct{}),
    pack: ?[]ExamplePackedStruct = &([_]ExamplePackedStruct{}),
    hey: ?u8 = 0,
    hey16: ?u16 = 0,
    hey32: ?u16 = 0,
    heyi32: ?i32 = 0,
    heyi16: ?i16 = 0,
    heyi8: ?i8 = 0,
    boolean: ?bool = null,
    heyooo: ?EnumValue = null,

    pub fn encode(this: *const ExampleMessage, writer: anytype) !void {
        if (this.examples) |examples| {
            try writer.writeFieldID(1);
            try writer.writeArray(ExampleStruct, examples);
        }

        if (this.pack) |pack| {
            try writer.writeFieldID(2);
            try writer.writeArray(ExamplePackedStruct, pack);
        }

        if (this.hey) |hey| {
            try writer.writeFieldID(3);
            try writer.writeInt(hey);
        }
        if (this.hey16) |hey16| {
            try writer.writeFieldID(4);
            try writer.writeInt(hey16);
        }
        if (this.hey32) |hey32| {
            try writer.writeFieldID(5);
            try writer.writeInt(hey32);
        }
        if (this.heyi32) |heyi32| {
            try writer.writeFieldID(6);
            try writer.writeInt(heyi32);
        }
        if (this.heyi16) |heyi16| {
            try writer.writeFieldID(7);
            try writer.writeInt(heyi16);
        }
        if (this.heyi8) |heyi8| {
            try writer.writeFieldID(8);
            try writer.writeInt(heyi8);
        }
        if (this.boolean) |boolean| {
            try writer.writeFieldID(9);
            try writer.writeInt(boolean);
        }

        if (this.heyooo) |heyoo| {
            try writer.writeFieldID(10);
            try writer.writeEnum(heyoo);
        }

        try writer.endMessage();
    }

    pub fn decode(reader: anytype) !ExampleMessage {
        var this = std.mem.zeroes(ExampleMessage);
        while (true) {
            switch (try reader.readByte()) {
                0 => {
                    return this;
                },

                1 => {
                    this.examples = try reader.readArray(std.meta.Child(@TypeOf(this.examples.?)));
                },
                2 => {
                    this.pack = try reader.readArray(std.meta.Child(@TypeOf(this.pack.?)));
                },
                3 => {
                    this.hey = try reader.readValue(@TypeOf(this.hey.?));
                },
                4 => {
                    this.hey16 = try reader.readValue(@TypeOf(this.hey16.?));
                },
                5 => {
                    this.hey32 = try reader.readValue(@TypeOf(this.hey32.?));
                },
                6 => {
                    this.heyi32 = try reader.readValue(@TypeOf(this.heyi32.?));
                },
                7 => {
                    this.heyi16 = try reader.readValue(@TypeOf(this.heyi16.?));
                },
                8 => {
                    this.heyi8 = try reader.readValue(@TypeOf(this.heyi8.?));
                },
                9 => {
                    this.boolean = try reader.readValue(@TypeOf(this.boolean.?));
                },
                10 => {
                    this.heyooo = try reader.readValue(@TypeOf(this.heyooo.?));
                },
                else => {
                    return error.InvalidValue;
                },
            }
        }

        return this;
    }
};

test "ExampleMessage" {
    var base = std.mem.zeroes(ExampleMessage);
    base.hey = 1;
    var buf: [4096]u8 = undefined;
    var writable = std.io.fixedBufferStream(&buf);
    var writer = ByteWriter.init(writable);
    var examples = [_]ExamplePackedStruct{
        .{ .len = 2, .offset = 5 },
        .{ .len = 0, .offset = 10 },
    };

    var more_examples = [_]ExampleStruct{
        .{ .name = "bacon", .age = 10 },
        .{ .name = "slime", .age = 300 },
    };
    base.examples = &more_examples;
    base.pack = &examples;
    base.heyooo = EnumValue.hey;
    try base.encode(&writer);
    var reader = Reader.init(&buf, std.heap.c_allocator);
    var compare = try ExampleMessage.decode(&reader);
    try std.testing.expectEqual(base.hey orelse 255, 1);

    const cmp_pack = compare.pack.?;
    for (cmp_pack) |item, id| {
        try std.testing.expectEqual(item, examples[id]);
    }

    const cmp_ex = compare.examples.?;
    for (cmp_ex) |item, id| {
        try std.testing.expectEqualStrings(item.name, more_examples[id].name);
        try std.testing.expectEqual(item.age, more_examples[id].age);
    }

    try std.testing.expectEqual(cmp_pack[0].len, examples[0].len);
    try std.testing.expectEqual(base.heyooo, compare.heyooo);
}
