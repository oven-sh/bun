pub const RedisError = error{
    AuthenticationFailed,
    ConnectionClosed,
    InvalidArgument,
    InvalidArray,
    InvalidAttribute,
    InvalidBigNumber,
    InvalidBlobError,
    InvalidBoolean,
    InvalidBulkString,
    InvalidCommand,
    InvalidDouble,
    InvalidErrorString,
    InvalidInteger,
    InvalidMap,
    InvalidNull,
    InvalidPush,
    InvalidResponse,
    InvalidResponseType,
    InvalidSet,
    InvalidSimpleString,
    InvalidVerbatimString,
    JSError,
    OutOfMemory,
    JSTerminated,
    UnsupportedProtocol,
    ConnectionTimeout,
    IdleTimeout,
    NestingDepthExceeded,
};

pub const valkeyErrorToJS = @import("../runtime/valkey_jsc/protocol_jsc.zig").valkeyErrorToJS;

// RESP protocol types
pub const RESPType = enum(u8) {
    // RESP2 types
    SimpleString = '+',
    Error = '-',
    Integer = ':',
    BulkString = '$',
    Array = '*',

    // RESP3 types
    Null = '_',
    Double = ',',
    Boolean = '#',
    BlobError = '!',
    VerbatimString = '=',
    Map = '%',
    Set = '~',
    Attribute = '|',
    Push = '>',
    BigNumber = '(',

    pub fn fromByte(byte: u8) ?RESPType {
        return switch (byte) {
            @intFromEnum(RESPType.SimpleString) => .SimpleString,
            @intFromEnum(RESPType.Error) => .Error,
            @intFromEnum(RESPType.Integer) => .Integer,
            @intFromEnum(RESPType.BulkString) => .BulkString,
            @intFromEnum(RESPType.Array) => .Array,
            @intFromEnum(RESPType.Null) => .Null,
            @intFromEnum(RESPType.Double) => .Double,
            @intFromEnum(RESPType.Boolean) => .Boolean,
            @intFromEnum(RESPType.BlobError) => .BlobError,
            @intFromEnum(RESPType.VerbatimString) => .VerbatimString,
            @intFromEnum(RESPType.Map) => .Map,
            @intFromEnum(RESPType.Set) => .Set,
            @intFromEnum(RESPType.Attribute) => .Attribute,
            @intFromEnum(RESPType.Push) => .Push,
            @intFromEnum(RESPType.BigNumber) => .BigNumber,
            else => null,
        };
    }
};

pub const RESPValue = union(RESPType) {
    // RESP2 types
    SimpleString: []const u8,
    Error: []const u8,
    Integer: i64,
    BulkString: ?[]const u8,
    Array: []RESPValue,

    // RESP3 types
    Null: void,
    Double: f64,
    Boolean: bool,
    BlobError: []const u8,
    VerbatimString: VerbatimString,
    Map: []MapEntry,
    Set: []RESPValue,
    Attribute: Attribute,
    Push: Push,
    BigNumber: []const u8,

    pub fn deinit(self: *RESPValue, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .SimpleString => |str| allocator.free(str),
            .Error => |str| allocator.free(str),
            .Integer => {},
            .BulkString => |maybe_str| if (maybe_str) |str| allocator.free(str),
            .Array => |array| {
                for (array) |*value| {
                    value.deinit(allocator);
                }
                allocator.free(array);
            },
            .Null => {},
            .Double => {},
            .Boolean => {},
            .BlobError => |str| allocator.free(str),
            .VerbatimString => |*verbatim| {
                allocator.free(verbatim.format);
                allocator.free(verbatim.content);
            },
            .Map => |entries| {
                for (entries) |*entry| {
                    entry.deinit(allocator);
                }
                allocator.free(entries);
            },
            .Set => |set| {
                for (set) |*value| {
                    value.deinit(allocator);
                }
                allocator.free(set);
            },
            .Attribute => |*attribute| {
                attribute.deinit(allocator);
            },
            .Push => |*push| {
                push.deinit(allocator);
            },
            .BigNumber => |str| allocator.free(str),
        }
    }

    pub fn format(self: @This(), writer: *std.Io.Writer) !void {
        switch (self) {
            .SimpleString => |str| try writer.writeAll(str),
            .Error => |str| try writer.writeAll(str),
            .Integer => |int| try writer.print("{d}", .{int}),
            .BulkString => |maybe_str| {
                if (maybe_str) |str| {
                    try writer.writeAll(str);
                } else {
                    try writer.writeAll("(nil)");
                }
            },
            .Array => |array| {
                try writer.writeAll("[");
                for (array, 0..) |value, i| {
                    if (i > 0) try writer.writeAll(", ");
                    try value.format(writer);
                }
                try writer.writeAll("]");
            },
            .Null => try writer.writeAll("(nil)"),
            .Double => |d| try writer.print("{d}", .{d}),
            .Boolean => |b| try writer.print("{}", .{b}),
            .BlobError => |str| try writer.print("Error: {s}", .{str}),
            .VerbatimString => |verbatim| try writer.print("{s}:{s}", .{ verbatim.format, verbatim.content }),
            .Map => |entries| {
                try writer.writeAll("{");
                for (entries, 0..) |entry, i| {
                    if (i > 0) try writer.writeAll(", ");
                    try entry.key.format(writer);
                    try writer.writeAll(": ");
                    try entry.value.format(writer);
                }
                try writer.writeAll("}");
            },
            .Set => |set| {
                try writer.writeAll("Set{");
                for (set, 0..) |value, i| {
                    if (i > 0) try writer.writeAll(", ");
                    try value.format(writer);
                }
                try writer.writeAll("}");
            },
            .Attribute => |attribute| {
                try writer.writeAll("(Attr: ");
                try writer.writeAll("{");
                for (attribute.attributes, 0..) |entry, i| {
                    if (i > 0) try writer.writeAll(", ");
                    try entry.key.format(writer);
                    try writer.writeAll(": ");
                    try entry.value.format(writer);
                }
                try writer.writeAll("} => ");
                try attribute.value.format(writer);
                try writer.writeAll(")");
            },
            .Push => |push| {
                try writer.print("Push({s}: [", .{push.kind});
                for (push.data, 0..) |value, i| {
                    if (i > 0) try writer.writeAll(", ");
                    try value.format(writer);
                }
                try writer.writeAll("])");
            },
            .BigNumber => |str| try writer.print("BigNumber({s})", .{str}),
        }
    }

    pub const toJS = @import("../runtime/valkey_jsc/protocol_jsc.zig").respValueToJS;
    pub const ToJSOptions = @import("../runtime/valkey_jsc/protocol_jsc.zig").ToJSOptions;
    pub const toJSWithOptions = @import("../runtime/valkey_jsc/protocol_jsc.zig").respValueToJSWithOptions;
};

pub const ValkeyReader = struct {
    buffer: []const u8,
    pos: usize = 0,

    pub fn init(buffer: []const u8) ValkeyReader {
        return .{
            .buffer = buffer,
        };
    }

    pub fn readByte(self: *ValkeyReader) RedisError!u8 {
        if (self.pos >= self.buffer.len) return error.InvalidResponse;
        const byte = self.buffer[self.pos];
        self.pos += 1;
        return byte;
    }

    pub fn readUntilCRLF(self: *ValkeyReader) RedisError![]const u8 {
        const buffer = self.buffer[self.pos..];
        for (buffer, 0..) |byte, i| {
            if (byte == '\r' and buffer.len > i + 1 and buffer[i + 1] == '\n') {
                const result = buffer[0..i];
                self.pos += i + 2;
                return result;
            }
        }

        return error.InvalidResponse;
    }

    pub fn readInteger(self: *ValkeyReader) RedisError!i64 {
        const str = try self.readUntilCRLF();
        return std.fmt.parseInt(i64, str, 10) catch return error.InvalidInteger;
    }

    pub fn readDouble(self: *ValkeyReader) RedisError!f64 {
        const str = try self.readUntilCRLF();

        // Handle special values
        if (std.mem.eql(u8, str, "inf")) return std.math.inf(f64);
        if (std.mem.eql(u8, str, "-inf")) return -std.math.inf(f64);
        if (std.mem.eql(u8, str, "nan")) return std.math.nan(f64);

        // Parse normal double
        return std.fmt.parseFloat(f64, str) catch return error.InvalidDouble;
    }

    pub fn readBoolean(self: *ValkeyReader) RedisError!bool {
        const str = try self.readUntilCRLF();
        if (str.len != 1) return error.InvalidBoolean;

        return switch (str[0]) {
            't' => true,
            'f' => false,
            else => error.InvalidBoolean,
        };
    }

    pub fn readVerbatimString(self: *ValkeyReader, allocator: std.mem.Allocator) RedisError!VerbatimString {
        const len = try self.readInteger();
        if (len < 0) return error.InvalidVerbatimString;
        if (self.pos + @as(usize, @intCast(len)) > self.buffer.len) return error.InvalidVerbatimString;

        const content_with_format = self.buffer[self.pos .. self.pos + @as(usize, @intCast(len))];
        self.pos += @as(usize, @intCast(len));

        // Expect CRLF after content
        const crlf = try self.readUntilCRLF();
        if (crlf.len != 0) return error.InvalidVerbatimString;

        // Format should be "xxx:" followed by content
        if (content_with_format.len < 4 or content_with_format[3] != ':') {
            return error.InvalidVerbatimString;
        }

        const format = try allocator.dupe(u8, content_with_format[0..3]);
        const content = try allocator.dupe(u8, content_with_format[4..]);

        return VerbatimString{
            .format = format,
            .content = content,
        };
    }

    /// Maximum allowed nesting depth for RESP aggregate types.
    /// This limits recursion to prevent excessive stack usage from
    /// deeply nested responses.
    const max_nesting_depth = 128;

    pub fn readValue(self: *ValkeyReader, allocator: std.mem.Allocator) RedisError!RESPValue {
        return self.readValueWithDepth(allocator, 0);
    }

    fn readValueWithDepth(self: *ValkeyReader, allocator: std.mem.Allocator, depth: usize) RedisError!RESPValue {
        const type_byte = try self.readByte();

        return switch (RESPType.fromByte(type_byte) orelse return error.InvalidResponseType) {
            // RESP2 types
            .SimpleString => {
                const str = try self.readUntilCRLF();
                const owned = try allocator.dupe(u8, str);
                return RESPValue{ .SimpleString = owned };
            },
            .Error => {
                const str = try self.readUntilCRLF();
                const owned = try allocator.dupe(u8, str);
                return RESPValue{ .Error = owned };
            },
            .Integer => {
                const int = try self.readInteger();
                return RESPValue{ .Integer = int };
            },
            .BulkString => {
                const len = try self.readInteger();
                if (len < 0) return RESPValue{ .BulkString = null };
                if (self.pos + @as(usize, @intCast(len)) > self.buffer.len) return error.InvalidResponse;
                const str = self.buffer[self.pos .. self.pos + @as(usize, @intCast(len))];
                self.pos += @as(usize, @intCast(len));
                const crlf = try self.readUntilCRLF();
                if (crlf.len != 0) return error.InvalidBulkString;
                const owned = try allocator.dupe(u8, str);
                return RESPValue{ .BulkString = owned };
            },
            .Array => {
                if (depth >= max_nesting_depth) return error.NestingDepthExceeded;
                const len = try self.readInteger();
                if (len < 0) return RESPValue{ .Array = &[_]RESPValue{} };
                const array = try allocator.alloc(RESPValue, @as(usize, @intCast(len)));
                errdefer allocator.free(array);
                var i: usize = 0;
                errdefer {
                    for (array[0..i]) |*item| {
                        item.deinit(allocator);
                    }
                }
                while (i < len) : (i += 1) {
                    array[i] = try self.readValueWithDepth(allocator, depth + 1);
                }
                return RESPValue{ .Array = array };
            },

            // RESP3 types
            .Null => {
                _ = try self.readUntilCRLF(); // Read and discard CRLF
                return RESPValue{ .Null = {} };
            },
            .Double => {
                const d = try self.readDouble();
                return RESPValue{ .Double = d };
            },
            .Boolean => {
                const b = try self.readBoolean();
                return RESPValue{ .Boolean = b };
            },
            .BlobError => {
                const len = try self.readInteger();
                if (len < 0) return error.InvalidBlobError;
                if (self.pos + @as(usize, @intCast(len)) > self.buffer.len) return error.InvalidBlobError;
                const str = self.buffer[self.pos .. self.pos + @as(usize, @intCast(len))];
                self.pos += @as(usize, @intCast(len));
                const crlf = try self.readUntilCRLF();
                if (crlf.len != 0) return error.InvalidBlobError;
                const owned = try allocator.dupe(u8, str);
                return RESPValue{ .BlobError = owned };
            },
            .VerbatimString => {
                return RESPValue{ .VerbatimString = try self.readVerbatimString(allocator) };
            },
            .Map => {
                if (depth >= max_nesting_depth) return error.NestingDepthExceeded;
                const len = try self.readInteger();
                if (len < 0) return error.InvalidMap;

                const entries = try allocator.alloc(MapEntry, @as(usize, @intCast(len)));
                errdefer allocator.free(entries);
                var i: usize = 0;
                errdefer {
                    for (entries[0..i]) |*entry| {
                        entry.deinit(allocator);
                    }
                }

                while (i < len) : (i += 1) {
                    var key = try self.readValueWithDepth(allocator, depth + 1);
                    errdefer key.deinit(allocator);
                    const value = try self.readValueWithDepth(allocator, depth + 1);
                    entries[i] = .{ .key = key, .value = value };
                }
                return RESPValue{ .Map = entries };
            },
            .Set => {
                if (depth >= max_nesting_depth) return error.NestingDepthExceeded;
                const len = try self.readInteger();
                if (len < 0) return error.InvalidSet;

                var set = try allocator.alloc(RESPValue, @as(usize, @intCast(len)));
                errdefer allocator.free(set);
                var i: usize = 0;
                errdefer {
                    for (set[0..i]) |*item| {
                        item.deinit(allocator);
                    }
                }
                while (i < len) : (i += 1) {
                    set[i] = try self.readValueWithDepth(allocator, depth + 1);
                }
                return RESPValue{ .Set = set };
            },
            .Attribute => {
                if (depth >= max_nesting_depth) return error.NestingDepthExceeded;
                const len = try self.readInteger();
                if (len < 0) return error.InvalidAttribute;

                var attrs = try allocator.alloc(MapEntry, @as(usize, @intCast(len)));
                errdefer allocator.free(attrs);
                var i: usize = 0;
                errdefer {
                    for (attrs[0..i]) |*entry| {
                        entry.deinit(allocator);
                    }
                }
                while (i < len) : (i += 1) {
                    var key = try self.readValueWithDepth(allocator, depth + 1);
                    errdefer key.deinit(allocator);
                    const value = try self.readValueWithDepth(allocator, depth + 1);
                    attrs[i] = .{ .key = key, .value = value };
                }

                // Read the actual value that follows the attributes
                const value_ptr = try allocator.create(RESPValue);
                errdefer {
                    allocator.destroy(value_ptr);
                }
                value_ptr.* = try self.readValueWithDepth(allocator, depth + 1);

                return RESPValue{ .Attribute = .{
                    .attributes = attrs,
                    .value = value_ptr,
                } };
            },
            .Push => {
                if (depth >= max_nesting_depth) return error.NestingDepthExceeded;
                const len = try self.readInteger();
                if (len < 0 or len == 0) return error.InvalidPush;

                // First element is the push type
                var push_type = try self.readValueWithDepth(allocator, depth + 1);
                defer push_type.deinit(allocator);
                var push_type_str: []const u8 = "";

                switch (push_type) {
                    .SimpleString => |str| push_type_str = str,
                    .BulkString => |maybe_str| {
                        if (maybe_str) |str| {
                            push_type_str = str;
                        } else {
                            return error.InvalidPush;
                        }
                    },
                    else => return error.InvalidPush,
                }

                // Copy the push type string since the original will be freed
                const push_type_dup = try allocator.dupe(u8, push_type_str);
                errdefer allocator.free(push_type_dup);

                // Read the rest of the data
                var data = try allocator.alloc(RESPValue, @as(usize, @intCast(len - 1)));
                errdefer allocator.free(data);
                var i: usize = 0;
                errdefer {
                    for (data[0..i]) |*item| {
                        item.deinit(allocator);
                    }
                }
                while (i < len - 1) : (i += 1) {
                    data[i] = try self.readValueWithDepth(allocator, depth + 1);
                }

                return RESPValue{ .Push = .{
                    .kind = push_type_dup,
                    .data = data,
                } };
            },
            .BigNumber => {
                const str = try self.readUntilCRLF();
                const owned = try allocator.dupe(u8, str);
                return RESPValue{ .BigNumber = owned };
            },
        };
    }
};

pub const MapEntry = struct {
    key: RESPValue,
    value: RESPValue,

    pub fn deinit(self: *MapEntry, allocator: std.mem.Allocator) void {
        self.key.deinit(allocator);
        self.value.deinit(allocator);
    }
};

pub const VerbatimString = struct {
    format: []const u8, // e.g. "txt" or "mkd"
    content: []const u8,

    pub fn deinit(self: *VerbatimString, allocator: std.mem.Allocator) void {
        allocator.free(self.format);
        allocator.free(self.content);
    }
};

pub const Push = struct {
    kind: []const u8,
    data: []RESPValue,

    pub fn deinit(self: *Push, allocator: std.mem.Allocator) void {
        allocator.free(self.kind);
        for (self.data) |*item| {
            item.deinit(allocator);
        }
        allocator.free(self.data);
    }
};
pub const Attribute = struct {
    attributes: []MapEntry,
    value: *RESPValue,

    pub fn deinit(self: *Attribute, allocator: std.mem.Allocator) void {
        for (self.attributes) |*entry| {
            entry.deinit(allocator);
        }
        allocator.free(self.attributes);
        self.value.deinit(allocator);
        allocator.destroy(self.value);
    }
};

pub const SubscriptionPushMessage = enum(u2) {
    message,
    subscribe,
    unsubscribe,

    pub const map = bun.ComptimeStringMap(SubscriptionPushMessage, .{
        .{ "message", .message },
        .{ "subscribe", .subscribe },
        .{ "unsubscribe", .unsubscribe },
    });
};

const bun = @import("bun");
const std = @import("std");
