pub const CloseComplete = [_]u8{'3'} ++ toBytes(Int32(4));
pub const EmptyQueryResponse = [_]u8{'I'} ++ toBytes(Int32(4));
pub const Terminate = [_]u8{'X'} ++ toBytes(Int32(4));

pub const BindComplete = [_]u8{'2'} ++ toBytes(Int32(4));

pub const ParseComplete = [_]u8{'1'} ++ toBytes(Int32(4));

pub const PasswordMessage = struct {
    password: Data = .{ .empty = {} },

    pub fn deinit(this: *PasswordMessage) void {
        this.password.deinit();
    }

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const password = this.password.slice();
        const count: usize = @sizeOf((u32)) + password.len + 1;
        const header = [_]u8{
            'p',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.string(password);
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const CopyData = struct {
    data: Data = .{ .empty = {} },

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const length = try reader.length();

        const data = try reader.read(@intCast(length -| 5));
        this.* = .{
            .data = data,
        };
    }

    pub const decode = DecoderWrap(CopyData, decodeInternal).decode;

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const data = this.data.slice();
        const count: u32 = @sizeOf((u32)) + data.len + 1;
        const header = [_]u8{
            'd',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.string(data);
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const CopyDone = [_]u8{'c'} ++ toBytes(Int32(4));
pub const Sync = [_]u8{'S'} ++ toBytes(Int32(4));
pub const Flush = [_]u8{'H'} ++ toBytes(Int32(4));
pub const SSLRequest = toBytes(Int32(8)) ++ toBytes(Int32(80877103));
pub const NoData = [_]u8{'n'} ++ toBytes(Int32(4));

pub fn writeQuery(query: []const u8, comptime Context: type, writer: NewWriter(Context)) !void {
    const count: u32 = @sizeOf((u32)) + @as(u32, @intCast(query.len)) + 1;
    const header = [_]u8{
        'Q',
    } ++ toBytes(Int32(count));
    try writer.write(&header);
    try writer.string(query);
}
pub const SASLInitialResponse = struct {
    mechanism: Data = .{ .empty = {} },
    data: Data = .{ .empty = {} },

    pub fn deinit(this: *SASLInitialResponse) void {
        this.mechanism.deinit();
        this.data.deinit();
    }

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const mechanism = this.mechanism.slice();
        const data = this.data.slice();
        const count: usize = @sizeOf(u32) + mechanism.len + 1 + data.len + @sizeOf(u32);
        const header = [_]u8{
            'p',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.string(mechanism);
        try writer.int4(@truncate(data.len));
        try writer.write(data);
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const SASLResponse = struct {
    data: Data = .{ .empty = {} },

    pub fn deinit(this: *SASLResponse) void {
        this.data.deinit();
    }

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const data = this.data.slice();
        const count: usize = @sizeOf(u32) + data.len;
        const header = [_]u8{
            'p',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.write(data);
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const StartupMessage = struct {
    user: Data,
    database: Data,
    options: Data = Data{ .empty = {} },

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const user = this.user.slice();
        const database = this.database.slice();
        const options = this.options.slice();
        const count: usize = @sizeOf((int4)) + @sizeOf((int4)) + zFieldCount("user", user) + zFieldCount("database", database) + zFieldCount("client_encoding", "UTF8") + options.len + 1;

        const header = toBytes(Int32(@as(u32, @truncate(count))));
        try writer.write(&header);
        try writer.int4(196608);

        try writer.string("user");
        if (user.len > 0)
            try writer.string(user);

        try writer.string("database");

        if (database.len == 0) {
            // The database to connect to. Defaults to the user name.
            try writer.string(user);
        } else {
            try writer.string(database);
        }
        try writer.string("client_encoding");
        try writer.string("UTF8");
        if (options.len > 0) {
            try writer.write(options);
        }
        try writer.write(&[_]u8{0});
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const Execute = struct {
    max_rows: int4 = 0,
    p: PortalOrPreparedStatement,

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        try writer.write("E");
        const length = try writer.length();
        if (this.p == .portal)
            try writer.string(this.p.portal)
        else
            try writer.write(&[_]u8{0});
        try writer.int4(this.max_rows);
        try length.write();
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const Describe = struct {
    p: PortalOrPreparedStatement,

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const message = this.p.slice();
        try writer.write(&[_]u8{
            'D',
        });
        const length = try writer.length();
        try writer.write(&[_]u8{
            this.p.tag(),
        });
        try writer.string(message);
        try length.write();
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const NegotiateProtocolVersion = struct {
    version: int4 = 0,
    unrecognized_options: std.ArrayListUnmanaged(String) = .{},

    pub fn decodeInternal(
        this: *@This(),
        comptime Container: type,
        reader: NewReader(Container),
    ) !void {
        const length = try reader.length();
        bun.assert(length >= 4);

        const version = try reader.int4();
        this.* = .{
            .version = version,
        };

        const unrecognized_options_count: u32 = @intCast(@max(try reader.int4(), 0));
        try this.unrecognized_options.ensureTotalCapacity(bun.default_allocator, unrecognized_options_count);
        errdefer {
            for (this.unrecognized_options.items) |*option| {
                option.deinit();
            }
            this.unrecognized_options.deinit(bun.default_allocator);
        }
        for (0..unrecognized_options_count) |_| {
            var option = try reader.readZ();
            if (option.slice().len == 0) break;
            defer option.deinit();
            this.unrecognized_options.appendAssumeCapacity(
                String.fromUTF8(option),
            );
        }
    }
};

pub const NoticeResponse = struct {
    messages: std.ArrayListUnmanaged(FieldMessage) = .{},
    pub fn deinit(this: *NoticeResponse) void {
        for (this.messages.items) |*message| {
            message.deinit();
        }
        this.messages.deinit(bun.default_allocator);
    }
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        var remaining_bytes = try reader.length();
        remaining_bytes -|= 4;

        if (remaining_bytes > 0) {
            this.* = .{
                .messages = try FieldMessage.decodeList(Container, reader),
            };
        }
    }
    pub const decode = DecoderWrap(NoticeResponse, decodeInternal).decode;

    pub fn toJS(this: NoticeResponse, globalObject: *JSC.JSGlobalObject) JSValue {
        var b = bun.StringBuilder{};
        defer b.deinit(bun.default_allocator);

        for (this.messages.items) |msg| {
            b.cap += switch (msg) {
                inline else => |m| m.utf8ByteLength(),
            } + 1;
        }
        b.allocate(bun.default_allocator) catch {};

        for (this.messages.items) |msg| {
            var str = switch (msg) {
                inline else => |m| m.toUTF8(bun.default_allocator),
            };
            defer str.deinit();
            _ = b.append(str.slice());
            _ = b.append("\n");
        }

        return JSC.ZigString.init(b.allocatedSlice()[0..b.len]).toJS(globalObject);
    }
};

pub const CopyFail = struct {
    message: Data = .{ .empty = {} },

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        _ = try reader.int4();

        const message = try reader.readZ();
        this.* = .{
            .message = message,
        };
    }

    pub const decode = DecoderWrap(CopyFail, decodeInternal).decode;

    pub fn writeInternal(
        this: *@This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const message = this.message.slice();
        const count: u32 = @sizeOf((u32)) + message.len + 1;
        const header = [_]u8{
            'f',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.string(message);
    }

    pub const write = WriteWrap(@This(), writeInternal).write;
};

pub const CopyInResponse = struct {
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        _ = reader;
        _ = this;
        TODO(@This());
    }

    pub const decode = DecoderWrap(CopyInResponse, decodeInternal).decode;
};

pub const CopyOutResponse = struct {
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        _ = reader;
        _ = this;
        TODO(@This());
    }

    pub const decode = DecoderWrap(CopyInResponse, decodeInternal).decode;
};

fn TODO(comptime Type: type) !void {
    bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(Type))});
}

const debug = bun.Output.scoped(.Postgres, false);

// @sortImports

const std = @import("std");
const AnyPostgresError = @import("./AnyPostgresError.zig").AnyPostgresError;
const Data = @import("./Data.zig").Data;
const toBytes = std.mem.toBytes;

const types = @import("./PostgresTypes.zig");
const PostgresInt32 = types.PostgresInt32;
const PostgresInt64 = types.PostgresInt64;
const PostgresShort = types.PostgresShort;
const int4 = types.int4;
const int8 = types.int8;
const short = types.short;

const bun = @import("bun");
const String = bun.String;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const int_types = @import("./types/int_types.zig");
const Int32 = int_types.Int32;

pub const ArrayList = @import("./protocol/ArrayList.zig");
pub const StackReader = @import("./protocol/StackReader.zig");
pub const FieldType = @import("./protocol/FieldType.zig").FieldType;
pub const FieldMessage = @import("./protocol/FieldMessage.zig").FieldMessage;
pub const NewReader = @import("./protocol/NewReader.zig").NewReader;
pub const NewWriter = @import("./protocol/NewWriter.zig").NewWriter;
pub const DecoderWrap = @import("./protocol/DecoderWrap.zig").DecoderWrap;
pub const WriteWrap = @import("./protocol/WriteWrap.zig").WriteWrap;
pub const PortalOrPreparedStatement = @import("./protocol/PortalOrPreparedStatement.zig").PortalOrPreparedStatement;
pub const ErrorResponse = @import("./protocol/ErrorResponse.zig");
pub const BackendKeyData = @import("./protocol/BackendKeyData.zig");
pub const ColumnIdentifier = @import("./protocol/ColumnIdentifier.zig").ColumnIdentifier;
pub const Parse = @import("./protocol/Parse.zig");
pub const FieldDescription = @import("./protocol/FieldDescription.zig");
pub const RowDescription = @import("./protocol/RowDescription.zig");
pub const ParameterDescription = @import("./protocol/ParameterDescription.zig");
pub const NotificationResponse = @import("./protocol/NotificationResponse.zig");
pub const CommandComplete = @import("./protocol/CommandComplete.zig");
pub const Authentication = @import("./protocol/Authentication.zig").Authentication;
const zHelpers = @import("./protocol/zHelpers.zig");
const zCount = zHelpers.zCount;
const zFieldCount = zHelpers.zFieldCount;
