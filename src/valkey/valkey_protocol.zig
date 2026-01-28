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
};

pub fn valkeyErrorToJS(globalObject: *jsc.JSGlobalObject, message: ?[]const u8, err: RedisError) jsc.JSValue {
    const error_code: jsc.Error = switch (err) {
        error.ConnectionClosed => .REDIS_CONNECTION_CLOSED,
        error.InvalidResponse => .REDIS_INVALID_RESPONSE,
        error.InvalidBulkString => .REDIS_INVALID_BULK_STRING,
        error.InvalidArray => .REDIS_INVALID_ARRAY,
        error.InvalidInteger => .REDIS_INVALID_INTEGER,
        error.InvalidSimpleString => .REDIS_INVALID_SIMPLE_STRING,
        error.InvalidErrorString => .REDIS_INVALID_ERROR_STRING,
        error.InvalidDouble,
        error.InvalidBoolean,
        error.InvalidNull,
        error.InvalidMap,
        error.InvalidSet,
        error.InvalidBigNumber,
        error.InvalidVerbatimString,
        error.InvalidBlobError,
        error.InvalidAttribute,
        error.InvalidPush,
        => .REDIS_INVALID_RESPONSE,
        error.AuthenticationFailed => .REDIS_AUTHENTICATION_FAILED,
        error.InvalidCommand => .REDIS_INVALID_COMMAND,
        error.InvalidArgument => .REDIS_INVALID_ARGUMENT,
        error.UnsupportedProtocol => .REDIS_INVALID_RESPONSE,
        error.InvalidResponseType => .REDIS_INVALID_RESPONSE_TYPE,
        error.ConnectionTimeout => .REDIS_CONNECTION_TIMEOUT,
        error.IdleTimeout => .REDIS_IDLE_TIMEOUT,
        error.JSError => return globalObject.takeException(error.JSError),
        error.OutOfMemory => globalObject.throwOutOfMemory() catch return globalObject.takeException(error.JSError),
        error.JSTerminated => return globalObject.takeException(error.JSTerminated),
    };

    if (message) |msg| {
        return error_code.fmt(globalObject, "{s}", .{msg});
    }
    return error_code.fmt(globalObject, "Valkey error: {s}", .{@errorName(err)});
}

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

    pub fn toJS(self: *RESPValue, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return self.toJSWithOptions(globalObject, .{});
    }

    pub const ToJSOptions = struct {
        return_as_buffer: bool = false,
    };

    fn valkeyStrToJSValue(globalObject: *jsc.JSGlobalObject, str: []const u8, options: *const ToJSOptions) bun.JSError!jsc.JSValue {
        if (options.return_as_buffer) {
            // TODO: handle values > 4.7 GB
            return try jsc.ArrayBuffer.createBuffer(globalObject, str);
        } else {
            return bun.String.createUTF8ForJS(globalObject, str);
        }
    }

    pub fn toJSWithOptions(self: *RESPValue, globalObject: *jsc.JSGlobalObject, options: ToJSOptions) bun.JSError!jsc.JSValue {
        switch (self.*) {
            .SimpleString => |str| return valkeyStrToJSValue(globalObject, str, &options),
            .Error => |str| return valkeyErrorToJS(globalObject, str, RedisError.InvalidResponse),
            .Integer => |int| return jsc.JSValue.jsNumber(int),
            .BulkString => |maybe_str| {
                if (maybe_str) |str| {
                    return valkeyStrToJSValue(globalObject, str, &options);
                } else {
                    return jsc.JSValue.jsNull();
                }
            },
            .Array => |array| {
                var js_array = try jsc.JSValue.createEmptyArray(globalObject, array.len);
                for (array, 0..) |*item, i| {
                    const js_item = try item.toJSWithOptions(globalObject, options);
                    try js_array.putIndex(globalObject, @intCast(i), js_item);
                }
                return js_array;
            },
            .Null => return jsc.JSValue.jsNull(),
            .Double => |d| return jsc.JSValue.jsNumber(d),
            .Boolean => |b| return jsc.JSValue.jsBoolean(b),
            .BlobError => |str| return valkeyErrorToJS(globalObject, str, RedisError.InvalidBlobError),
            .VerbatimString => |verbatim| return valkeyStrToJSValue(globalObject, verbatim.content, &options),
            .Map => |entries| {
                var js_obj = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);
                for (entries) |*entry| {
                    const js_key = try entry.key.toJSWithOptions(globalObject, .{});
                    var key_str = try js_key.toBunString(globalObject);
                    defer key_str.deref();
                    const js_value = try entry.value.toJSWithOptions(globalObject, options);

                    try js_obj.putMayBeIndex(globalObject, &key_str, js_value);
                }
                return js_obj;
            },
            .Set => |set| {
                var js_array = try jsc.JSValue.createEmptyArray(globalObject, set.len);
                for (set, 0..) |*item, i| {
                    const js_item = try item.toJSWithOptions(globalObject, options);
                    try js_array.putIndex(globalObject, @intCast(i), js_item);
                }
                return js_array;
            },
            .Attribute => |attribute| {
                // For now, we just return the value and ignore attributes
                // In the future, we could attach the attributes as a hidden property
                return try attribute.value.toJSWithOptions(globalObject, options);
            },
            .Push => |push| {
                var js_obj = jsc.JSValue.createEmptyObjectWithNullPrototype(globalObject);

                // Add the push type
                const kind_str = try bun.String.createUTF8ForJS(globalObject, push.kind);
                js_obj.put(globalObject, "type", kind_str);

                // Add the data as an array
                var data_array = try jsc.JSValue.createEmptyArray(globalObject, push.data.len);
                for (push.data, 0..) |*item, i| {
                    const js_item = try item.toJSWithOptions(globalObject, options);
                    try data_array.putIndex(globalObject, @intCast(i), js_item);
                }
                js_obj.put(globalObject, "data", data_array);

                return js_obj;
            },
            .BigNumber => |str| {
                // Try to parse as number if possible
                if (std.fmt.parseInt(i64, str, 10)) |int| {
                    return jsc.JSValue.jsNumber(int);
                } else |_| {
                    // If it doesn't fit in an i64, return as string
                    return bun.String.createUTF8ForJS(globalObject, str);
                }
            },
        }
    }
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

    pub fn readValue(self: *ValkeyReader, allocator: std.mem.Allocator) RedisError!RESPValue {
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
                    array[i] = try self.readValue(allocator);
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
                    entries[i] = .{ .key = try self.readValue(allocator), .value = try self.readValue(allocator) };
                }
                return RESPValue{ .Map = entries };
            },
            .Set => {
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
                    set[i] = try self.readValue(allocator);
                }
                return RESPValue{ .Set = set };
            },
            .Attribute => {
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
                    var key = try self.readValue(allocator);
                    errdefer key.deinit(allocator);
                    const value = try self.readValue(allocator);
                    attrs[i] = .{ .key = key, .value = value };
                }

                // Read the actual value that follows the attributes
                const value_ptr = try allocator.create(RESPValue);
                errdefer {
                    allocator.destroy(value_ptr);
                }
                value_ptr.* = try self.readValue(allocator);

                return RESPValue{ .Attribute = .{
                    .attributes = attrs,
                    .value = value_ptr,
                } };
            },
            .Push => {
                const len = try self.readInteger();
                if (len < 0 or len == 0) return error.InvalidPush;

                // First element is the push type
                const push_type = try self.readValue(allocator);
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
                    data[i] = try self.readValue(allocator);
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

const std = @import("std");

const bun = @import("bun");
const String = bun.String;
const jsc = bun.jsc;
