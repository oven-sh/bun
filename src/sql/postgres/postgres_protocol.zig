const std = @import("std");
const bun = @import("bun");
const postgres = bun.api.Postgres;
const Data = postgres.Data;
const protocol = @This();
const PostgresInt32 = postgres.PostgresInt32;
const PostgresShort = postgres.PostgresShort;
const String = bun.String;
const debug = postgres.debug;
const JSValue = JSC.JSValue;
const JSC = bun.JSC;
const short = postgres.short;
const int4 = postgres.int4;
const int8 = postgres.int8;
const PostgresInt64 = postgres.PostgresInt64;
const types = postgres.types;
const AnyPostgresError = postgres.AnyPostgresError;
pub const ArrayList = struct {
    array: *std.ArrayList(u8),

    pub fn offset(this: @This()) usize {
        return this.array.items.len;
    }

    pub fn write(this: @This(), bytes: []const u8) AnyPostgresError!void {
        try this.array.appendSlice(bytes);
    }

    pub fn pwrite(this: @This(), bytes: []const u8, i: usize) AnyPostgresError!void {
        @memcpy(this.array.items[i..][0..bytes.len], bytes);
    }

    pub const Writer = NewWriter(@This());
};

pub const StackReader = struct {
    buffer: []const u8 = "",
    offset: *usize,
    message_start: *usize,

    pub fn markMessageStart(this: @This()) void {
        this.message_start.* = this.offset.*;
    }

    pub fn ensureLength(this: @This(), length: usize) bool {
        return this.buffer.len >= (this.offset.* + length);
    }

    pub fn init(buffer: []const u8, offset: *usize, message_start: *usize) protocol.NewReader(StackReader) {
        return .{
            .wrapped = .{
                .buffer = buffer,
                .offset = offset,
                .message_start = message_start,
            },
        };
    }

    pub fn peek(this: StackReader) []const u8 {
        return this.buffer[this.offset.*..];
    }
    pub fn skip(this: StackReader, count: usize) void {
        if (this.offset.* + count > this.buffer.len) {
            this.offset.* = this.buffer.len;
            return;
        }

        this.offset.* += count;
    }
    pub fn ensureCapacity(this: StackReader, count: usize) bool {
        return this.buffer.len >= (this.offset.* + count);
    }
    pub fn read(this: StackReader, count: usize) AnyPostgresError!Data {
        const offset = this.offset.*;
        if (!this.ensureCapacity(count)) {
            return error.ShortRead;
        }

        this.skip(count);
        return Data{
            .temporary = this.buffer[offset..this.offset.*],
        };
    }
    pub fn readZ(this: StackReader) AnyPostgresError!Data {
        const remaining = this.peek();
        if (bun.strings.indexOfChar(remaining, 0)) |zero| {
            this.skip(zero + 1);
            return Data{
                .temporary = remaining[0..zero],
            };
        }

        return error.ShortRead;
    }
};

pub fn NewWriterWrap(
    comptime Context: type,
    comptime offsetFn_: (fn (ctx: Context) usize),
    comptime writeFunction_: (fn (ctx: Context, bytes: []const u8) AnyPostgresError!void),
    comptime pwriteFunction_: (fn (ctx: Context, bytes: []const u8, offset: usize) AnyPostgresError!void),
) type {
    return struct {
        wrapped: Context,

        const writeFn = writeFunction_;
        const pwriteFn = pwriteFunction_;
        const offsetFn = offsetFn_;
        pub const Ctx = Context;

        pub const WrappedWriter = @This();

        pub inline fn write(this: @This(), data: []const u8) AnyPostgresError!void {
            try writeFn(this.wrapped, data);
        }

        pub const LengthWriter = struct {
            index: usize,
            context: WrappedWriter,

            pub fn write(this: LengthWriter) AnyPostgresError!void {
                try this.context.pwrite(&Int32(this.context.offset() - this.index), this.index);
            }

            pub fn writeExcludingSelf(this: LengthWriter) AnyPostgresError!void {
                try this.context.pwrite(&Int32(this.context.offset() -| (this.index + 4)), this.index);
            }
        };

        pub inline fn length(this: @This()) AnyPostgresError!LengthWriter {
            const i = this.offset();
            try this.int4(0);
            return LengthWriter{
                .index = i,
                .context = this,
            };
        }

        pub inline fn offset(this: @This()) usize {
            return offsetFn(this.wrapped);
        }

        pub inline fn pwrite(this: @This(), data: []const u8, i: usize) AnyPostgresError!void {
            try pwriteFn(this.wrapped, data, i);
        }

        pub fn int4(this: @This(), value: PostgresInt32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn int8(this: @This(), value: PostgresInt64) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn sint4(this: @This(), value: i32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(value)));
        }

        pub fn @"f64"(this: @This(), value: f64) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u64, @bitCast(value)))));
        }

        pub fn @"f32"(this: @This(), value: f32) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u32, @bitCast(value)))));
        }

        pub fn short(this: @This(), value: anytype) !void {
            try this.write(std.mem.asBytes(&@byteSwap(@as(u16, @intCast(value)))));
        }

        pub fn string(this: @This(), value: []const u8) !void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn bytes(this: @This(), value: []const u8) !void {
            try this.write(value);
            if (value.len == 0 or value[value.len - 1] != 0)
                try this.write(&[_]u8{0});
        }

        pub fn @"bool"(this: @This(), value: bool) !void {
            try this.write(if (value) "t" else "f");
        }

        pub fn @"null"(this: @This()) !void {
            try this.int4(std.math.maxInt(PostgresInt32));
        }

        pub fn String(this: @This(), value: bun.String) !void {
            if (value.isEmpty()) {
                try this.write(&[_]u8{0});
                return;
            }

            var sliced = value.toUTF8(bun.default_allocator);
            defer sliced.deinit();
            const slice = sliced.slice();

            try this.write(slice);
            if (slice.len == 0 or slice[slice.len - 1] != 0)
                try this.write(&[_]u8{0});
        }
    };
}

pub const FieldType = enum(u8) {
    /// Severity: the field contents are ERROR, FATAL, or PANIC (in an error message), or WARNING, NOTICE, DEBUG, INFO, or LOG (in a notice message), or a localized translation of one of these. Always present.
    severity = 'S',

    /// Severity: the field contents are ERROR, FATAL, or PANIC (in an error message), or WARNING, NOTICE, DEBUG, INFO, or LOG (in a notice message). This is identical to the S field except that the contents are never localized. This is present only in messages generated by PostgreSQL versions 9.6 and later.
    localized_severity = 'V',

    /// Code: the SQLSTATE code for the error (see Appendix A). Not localizable. Always present.
    code = 'C',

    /// Message: the primary human-readable error message. This should be accurate but terse (typically one line). Always present.
    message = 'M',

    /// Detail: an optional secondary error message carrying more detail about the problem. Might run to multiple lines.
    detail = 'D',

    /// Hint: an optional suggestion what to do about the problem. This is intended to differ from Detail in that it offers advice (potentially inappropriate) rather than hard facts. Might run to multiple lines.
    hint = 'H',

    /// Position: the field value is a decimal ASCII integer, indicating an error cursor position as an index into the original query string. The first character has index 1, and positions are measured in characters not bytes.
    position = 'P',

    /// Internal position: this is defined the same as the P field, but it is used when the cursor position refers to an internally generated command rather than the one submitted by the client. The q field will always appear when this field appears.
    internal_position = 'p',

    /// Internal query: the text of a failed internally-generated command. This could be, for example, an SQL query issued by a PL/pgSQL function.
    internal = 'q',

    /// Where: an indication of the context in which the error occurred. Presently this includes a call stack traceback of active procedural language functions and internally-generated queries. The trace is one entry per line, most recent first.
    where = 'W',

    /// Schema name: if the error was associated with a specific database object, the name of the schema containing that object, if any.
    schema = 's',

    /// Table name: if the error was associated with a specific table, the name of the table. (Refer to the schema name field for the name of the table's schema.)
    table = 't',

    /// Column name: if the error was associated with a specific table column, the name of the column. (Refer to the schema and table name fields to identify the table.)
    column = 'c',

    /// Data type name: if the error was associated with a specific data type, the name of the data type. (Refer to the schema name field for the name of the data type's schema.)
    datatype = 'd',

    /// Constraint name: if the error was associated with a specific constraint, the name of the constraint. Refer to fields listed above for the associated table or domain. (For this purpose, indexes are treated as constraints, even if they weren't created with constraint syntax.)
    constraint = 'n',

    /// File: the file name of the source-code location where the error was reported.
    file = 'F',

    /// Line: the line number of the source-code location where the error was reported.
    line = 'L',

    /// Routine: the name of the source-code routine reporting the error.
    routine = 'R',

    _,
};

pub const FieldMessage = union(FieldType) {
    severity: String,
    localized_severity: String,
    code: String,
    message: String,
    detail: String,
    hint: String,
    position: String,
    internal_position: String,
    internal: String,
    where: String,
    schema: String,
    table: String,
    column: String,
    datatype: String,
    constraint: String,
    file: String,
    line: String,
    routine: String,

    pub fn format(this: FieldMessage, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (this) {
            inline else => |str| {
                try std.fmt.format(writer, "{}", .{str});
            },
        }
    }

    pub fn deinit(this: *FieldMessage) void {
        switch (this.*) {
            inline else => |*message| {
                message.deref();
            },
        }
    }

    pub fn decodeList(comptime Context: type, reader: NewReader(Context)) !std.ArrayListUnmanaged(FieldMessage) {
        var messages = std.ArrayListUnmanaged(FieldMessage){};
        while (true) {
            const field_int = try reader.int(u8);
            if (field_int == 0) break;
            const field: FieldType = @enumFromInt(field_int);

            var message = try reader.readZ();
            defer message.deinit();
            if (message.slice().len == 0) break;

            try messages.append(bun.default_allocator, FieldMessage.init(field, message.slice()) catch continue);
        }

        return messages;
    }

    pub fn init(tag: FieldType, message: []const u8) !FieldMessage {
        return switch (tag) {
            .severity => FieldMessage{ .severity = String.createUTF8(message) },
            // Ignore this one for now.
            // .localized_severity => FieldMessage{ .localized_severity = String.createUTF8(message) },
            .code => FieldMessage{ .code = String.createUTF8(message) },
            .message => FieldMessage{ .message = String.createUTF8(message) },
            .detail => FieldMessage{ .detail = String.createUTF8(message) },
            .hint => FieldMessage{ .hint = String.createUTF8(message) },
            .position => FieldMessage{ .position = String.createUTF8(message) },
            .internal_position => FieldMessage{ .internal_position = String.createUTF8(message) },
            .internal => FieldMessage{ .internal = String.createUTF8(message) },
            .where => FieldMessage{ .where = String.createUTF8(message) },
            .schema => FieldMessage{ .schema = String.createUTF8(message) },
            .table => FieldMessage{ .table = String.createUTF8(message) },
            .column => FieldMessage{ .column = String.createUTF8(message) },
            .datatype => FieldMessage{ .datatype = String.createUTF8(message) },
            .constraint => FieldMessage{ .constraint = String.createUTF8(message) },
            .file => FieldMessage{ .file = String.createUTF8(message) },
            .line => FieldMessage{ .line = String.createUTF8(message) },
            .routine => FieldMessage{ .routine = String.createUTF8(message) },
            else => error.UnknownFieldType,
        };
    }
};

pub fn NewReaderWrap(
    comptime Context: type,
    comptime markMessageStartFn_: (fn (ctx: Context) void),
    comptime peekFn_: (fn (ctx: Context) []const u8),
    comptime skipFn_: (fn (ctx: Context, count: usize) void),
    comptime ensureCapacityFn_: (fn (ctx: Context, count: usize) bool),
    comptime readFunction_: (fn (ctx: Context, count: usize) AnyPostgresError!Data),
    comptime readZ_: (fn (ctx: Context) AnyPostgresError!Data),
) type {
    return struct {
        wrapped: Context,
        const readFn = readFunction_;
        const readZFn = readZ_;
        const ensureCapacityFn = ensureCapacityFn_;
        const skipFn = skipFn_;
        const peekFn = peekFn_;
        const markMessageStartFn = markMessageStartFn_;

        pub const Ctx = Context;

        pub inline fn markMessageStart(this: @This()) void {
            markMessageStartFn(this.wrapped);
        }

        pub inline fn read(this: @This(), count: usize) AnyPostgresError!Data {
            return try readFn(this.wrapped, count);
        }

        pub inline fn eatMessage(this: @This(), comptime msg_: anytype) AnyPostgresError!void {
            const msg = msg_[1..];
            try this.ensureCapacity(msg.len);

            var input = try readFn(this.wrapped, msg.len);
            defer input.deinit();
            if (bun.strings.eqlComptime(input.slice(), msg)) return;
            return error.InvalidMessage;
        }

        pub fn skip(this: @This(), count: usize) AnyPostgresError!void {
            skipFn(this.wrapped, count);
        }

        pub fn peek(this: @This()) []const u8 {
            return peekFn(this.wrapped);
        }

        pub inline fn readZ(this: @This()) AnyPostgresError!Data {
            return try readZFn(this.wrapped);
        }

        pub inline fn ensureCapacity(this: @This(), count: usize) AnyPostgresError!void {
            if (!ensureCapacityFn(this.wrapped, count)) {
                return error.ShortRead;
            }
        }

        pub fn int(this: @This(), comptime Int: type) !Int {
            var data = try this.read(@sizeOf((Int)));
            defer data.deinit();
            if (comptime Int == u8) {
                return @as(Int, data.slice()[0]);
            }
            return @byteSwap(@as(Int, @bitCast(data.slice()[0..@sizeOf(Int)].*)));
        }

        pub fn peekInt(this: @This(), comptime Int: type) ?Int {
            const remain = this.peek();
            if (remain.len < @sizeOf(Int)) {
                return null;
            }
            return @byteSwap(@as(Int, @bitCast(remain[0..@sizeOf(Int)].*)));
        }

        pub fn expectInt(this: @This(), comptime Int: type, comptime value: comptime_int) !bool {
            const actual = try this.int(Int);
            return actual == value;
        }

        pub fn int4(this: @This()) !PostgresInt32 {
            return this.int(PostgresInt32);
        }

        pub fn short(this: @This()) !PostgresShort {
            return this.int(PostgresShort);
        }

        pub fn length(this: @This()) !PostgresInt32 {
            const expected = try this.int(PostgresInt32);
            if (expected > -1) {
                try this.ensureCapacity(@intCast(expected -| 4));
            }

            return expected;
        }

        pub const bytes = read;

        pub fn String(this: @This()) !bun.String {
            var result = try this.readZ();
            defer result.deinit();
            return bun.String.fromUTF8(result.slice());
        }
    };
}

pub fn NewReader(comptime Context: type) type {
    return NewReaderWrap(Context, Context.markMessageStart, Context.peek, Context.skip, Context.ensureLength, Context.read, Context.readZ);
}

pub fn NewWriter(comptime Context: type) type {
    return NewWriterWrap(Context, Context.offset, Context.write, Context.pwrite);
}

fn decoderWrap(comptime Container: type, comptime decodeFn: anytype) type {
    return struct {
        pub fn decode(this: *Container, context: anytype) AnyPostgresError!void {
            const Context = @TypeOf(context);
            try decodeFn(this, Context, NewReader(Context){ .wrapped = context });
        }
    };
}

fn writeWrap(comptime Container: type, comptime writeFn: anytype) type {
    return struct {
        pub fn write(this: *Container, context: anytype) AnyPostgresError!void {
            const Context = @TypeOf(context);
            try writeFn(this, Context, NewWriter(Context){ .wrapped = context });
        }
    };
}

pub const Authentication = union(enum) {
    Ok: void,
    ClearTextPassword: struct {},
    MD5Password: struct {
        salt: [4]u8,
    },
    KerberosV5: struct {},
    SCMCredential: struct {},
    GSS: struct {},
    GSSContinue: struct {
        data: Data,
    },
    SSPI: struct {},
    SASL: struct {},
    SASLContinue: struct {
        data: Data,
        r: []const u8,
        s: []const u8,
        i: []const u8,

        pub fn iterationCount(this: *const @This()) !u32 {
            return try std.fmt.parseInt(u32, this.i, 0);
        }
    },
    SASLFinal: struct {
        data: Data,
    },
    Unknown: void,

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .MD5Password => {},
            .SASL => {},
            .SASLContinue => {
                this.SASLContinue.data.zdeinit();
            },
            .SASLFinal => {
                this.SASLFinal.data.zdeinit();
            },
            else => {},
        }
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const message_length = try reader.length();

        switch (try reader.int4()) {
            0 => {
                if (message_length != 8) return error.InvalidMessageLength;
                this.* = .{ .Ok = {} };
            },
            2 => {
                if (message_length != 8) return error.InvalidMessageLength;
                this.* = .{
                    .KerberosV5 = .{},
                };
            },
            3 => {
                if (message_length != 8) return error.InvalidMessageLength;
                this.* = .{
                    .ClearTextPassword = .{},
                };
            },
            5 => {
                if (message_length != 12) return error.InvalidMessageLength;
                var salt_data = try reader.bytes(4);
                defer salt_data.deinit();
                this.* = .{
                    .MD5Password = .{
                        .salt = salt_data.slice()[0..4].*,
                    },
                };
            },
            7 => {
                if (message_length != 8) return error.InvalidMessageLength;
                this.* = .{
                    .GSS = .{},
                };
            },

            8 => {
                if (message_length < 9) return error.InvalidMessageLength;
                const bytes = try reader.read(message_length - 8);
                this.* = .{
                    .GSSContinue = .{
                        .data = bytes,
                    },
                };
            },
            9 => {
                if (message_length != 8) return error.InvalidMessageLength;
                this.* = .{
                    .SSPI = .{},
                };
            },

            10 => {
                if (message_length < 9) return error.InvalidMessageLength;
                try reader.skip(message_length - 8);
                this.* = .{
                    .SASL = .{},
                };
            },

            11 => {
                if (message_length < 9) return error.InvalidMessageLength;
                var bytes = try reader.bytes(message_length - 8);
                errdefer {
                    bytes.deinit();
                }

                var iter = bun.strings.split(bytes.slice(), ",");
                var r: ?[]const u8 = null;
                var i: ?[]const u8 = null;
                var s: ?[]const u8 = null;

                while (iter.next()) |item| {
                    if (item.len > 2) {
                        const key = item[0];
                        const after_equals = item[2..];
                        if (key == 'r') {
                            r = after_equals;
                        } else if (key == 's') {
                            s = after_equals;
                        } else if (key == 'i') {
                            i = after_equals;
                        }
                    }
                }

                if (r == null) {
                    debug("Missing r", .{});
                }

                if (s == null) {
                    debug("Missing s", .{});
                }

                if (i == null) {
                    debug("Missing i", .{});
                }

                this.* = .{
                    .SASLContinue = .{
                        .data = bytes,
                        .r = r orelse return error.InvalidMessage,
                        .s = s orelse return error.InvalidMessage,
                        .i = i orelse return error.InvalidMessage,
                    },
                };
            },

            12 => {
                if (message_length < 9) return error.InvalidMessageLength;
                const remaining: usize = message_length - 8;

                const bytes = try reader.read(remaining);
                this.* = .{
                    .SASLFinal = .{
                        .data = bytes,
                    },
                };
            },

            else => {
                this.* = .{ .Unknown = {} };
            },
        }
    }

    pub const decode = decoderWrap(Authentication, decodeInternal).decode;
};

pub const ParameterStatus = struct {
    name: Data = .{ .empty = {} },
    value: Data = .{ .empty = {} },

    pub fn deinit(this: *@This()) void {
        this.name.deinit();
        this.value.deinit();
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const length = try reader.length();
        bun.assert(length >= 4);

        this.* = .{
            .name = try reader.readZ(),
            .value = try reader.readZ(),
        };
    }

    pub const decode = decoderWrap(ParameterStatus, decodeInternal).decode;
};

pub const BackendKeyData = struct {
    process_id: u32 = 0,
    secret_key: u32 = 0,
    pub const decode = decoderWrap(BackendKeyData, decodeInternal).decode;

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        if (!try reader.expectInt(u32, 12)) {
            return error.InvalidBackendKeyData;
        }

        this.* = .{
            .process_id = @bitCast(try reader.int4()),
            .secret_key = @bitCast(try reader.int4()),
        };
    }
};

pub const ErrorResponse = struct {
    messages: std.ArrayListUnmanaged(FieldMessage) = .{},

    pub fn format(formatter: ErrorResponse, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        for (formatter.messages.items) |message| {
            try std.fmt.format(writer, "{}\n", .{message});
        }
    }

    pub fn deinit(this: *ErrorResponse) void {
        for (this.messages.items) |*message| {
            message.deinit();
        }
        this.messages.deinit(bun.default_allocator);
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        var remaining_bytes = try reader.length();
        if (remaining_bytes < 4) return error.InvalidMessageLength;
        remaining_bytes -|= 4;

        if (remaining_bytes > 0) {
            this.* = .{
                .messages = try FieldMessage.decodeList(Container, reader),
            };
        }
    }

    pub const decode = decoderWrap(ErrorResponse, decodeInternal).decode;

    pub fn toJS(this: ErrorResponse, globalObject: *JSC.JSGlobalObject) JSValue {
        var b = bun.StringBuilder{};
        defer b.deinit(bun.default_allocator);

        // Pre-calculate capacity to avoid reallocations
        for (this.messages.items) |*msg| {
            b.cap += switch (msg.*) {
                inline else => |m| m.utf8ByteLength(),
            } + 1;
        }
        b.allocate(bun.default_allocator) catch {};

        // Build a more structured error message
        var severity: String = String.dead;
        var code: String = String.dead;
        var message: String = String.dead;
        var detail: String = String.dead;
        var hint: String = String.dead;
        var position: String = String.dead;
        var where: String = String.dead;
        var schema: String = String.dead;
        var table: String = String.dead;
        var column: String = String.dead;
        var datatype: String = String.dead;
        var constraint: String = String.dead;
        var file: String = String.dead;
        var line: String = String.dead;
        var routine: String = String.dead;

        for (this.messages.items) |*msg| {
            switch (msg.*) {
                .severity => |str| severity = str,
                .code => |str| code = str,
                .message => |str| message = str,
                .detail => |str| detail = str,
                .hint => |str| hint = str,
                .position => |str| position = str,
                .where => |str| where = str,
                .schema => |str| schema = str,
                .table => |str| table = str,
                .column => |str| column = str,
                .datatype => |str| datatype = str,
                .constraint => |str| constraint = str,
                .file => |str| file = str,
                .line => |str| line = str,
                .routine => |str| routine = str,
                else => {},
            }
        }

        var needs_newline = false;
        construct_message: {
            if (!message.isEmpty()) {
                _ = b.appendStr(message);
                needs_newline = true;
                break :construct_message;
            }
            if (!detail.isEmpty()) {
                if (needs_newline) {
                    _ = b.append("\n");
                } else {
                    _ = b.append(" ");
                }
                needs_newline = true;
                _ = b.appendStr(detail);
            }
            if (!hint.isEmpty()) {
                if (needs_newline) {
                    _ = b.append("\n");
                } else {
                    _ = b.append(" ");
                }
                needs_newline = true;
                _ = b.appendStr(hint);
            }
        }

        const possible_fields = .{
            .{ "detail", detail, void },
            .{ "hint", hint, void },
            .{ "column", column, void },
            .{ "constraint", constraint, void },
            .{ "datatype", datatype, void },
            // in the past this was set to i32 but postgres returns a strings lets keep it compatible
            .{ "errno", code, void },
            .{ "position", position, i32 },
            .{ "schema", schema, void },
            .{ "table", table, void },
            .{ "where", where, void },
        };
        const error_code: JSC.Error =
            // https://www.postgresql.org/docs/8.1/errcodes-appendix.html
            if (code.eqlComptime("42601"))
                .POSTGRES_SYNTAX_ERROR
            else
                .POSTGRES_SERVER_ERROR;
        const err = error_code.fmt(globalObject, "{s}", .{b.allocatedSlice()[0..b.len]});

        inline for (possible_fields) |field| {
            if (!field.@"1".isEmpty()) {
                const value = brk: {
                    if (field.@"2" == i32) {
                        if (field.@"1".toInt32()) |val| {
                            break :brk JSC.JSValue.jsNumberFromInt32(val);
                        }
                    }

                    break :brk field.@"1".toJS(globalObject);
                };

                err.put(globalObject, JSC.ZigString.static(field.@"0"), value);
            }
        }

        return err;
    }
};

pub const PortalOrPreparedStatement = union(enum) {
    portal: []const u8,
    prepared_statement: []const u8,

    pub fn slice(this: @This()) []const u8 {
        return switch (this) {
            .portal => this.portal,
            .prepared_statement => this.prepared_statement,
        };
    }

    pub fn tag(this: @This()) u8 {
        return switch (this) {
            .portal => 'P',
            .prepared_statement => 'S',
        };
    }
};

/// Close (F)
/// Byte1('C')
/// - Identifies the message as a Close command.
/// Int32
/// - Length of message contents in bytes, including self.
/// Byte1
/// - 'S' to close a prepared statement; or 'P' to close a portal.
/// String
/// - The name of the prepared statement or portal to close (an empty string selects the unnamed prepared statement or portal).
pub const Close = struct {
    p: PortalOrPreparedStatement,

    fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const p = this.p;
        const count: u32 = @sizeOf((u32)) + 1 + p.slice().len + 1;
        const header = [_]u8{
            'C',
        } ++ @byteSwap(count) ++ [_]u8{
            p.tag(),
        };
        try writer.write(&header);
        try writer.write(p.slice());
        try writer.write(&[_]u8{0});
    }

    pub const write = writeWrap(@This(), writeInternal);
};

pub const CloseComplete = [_]u8{'3'} ++ toBytes(Int32(4));
pub const EmptyQueryResponse = [_]u8{'I'} ++ toBytes(Int32(4));
pub const Terminate = [_]u8{'X'} ++ toBytes(Int32(4));

fn Int32(value: anytype) [4]u8 {
    return @bitCast(@byteSwap(@as(int4, @intCast(value))));
}

const toBytes = std.mem.toBytes;

pub const TransactionStatusIndicator = enum(u8) {
    /// if idle (not in a transaction block)
    I = 'I',

    /// if in a transaction block
    T = 'T',

    /// if in a failed transaction block
    E = 'E',

    _,
};

pub const ReadyForQuery = struct {
    status: TransactionStatusIndicator = .I,
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const length = try reader.length();
        bun.assert(length >= 4);

        const status = try reader.int(u8);
        this.* = .{
            .status = @enumFromInt(status),
        };
    }

    pub const decode = decoderWrap(ReadyForQuery, decodeInternal).decode;
};

pub const null_int4 = 4294967295;

pub const DataRow = struct {
    pub fn decode(context: anytype, comptime ContextType: type, reader: NewReader(ContextType), comptime forEach: fn (@TypeOf(context), index: u32, bytes: ?*Data) AnyPostgresError!bool) AnyPostgresError!void {
        var remaining_bytes = try reader.length();
        remaining_bytes -|= 4;

        const remaining_fields: usize = @intCast(@max(try reader.short(), 0));

        for (0..remaining_fields) |index| {
            const byte_length = try reader.int4();
            switch (byte_length) {
                0 => {
                    var empty = Data.Empty;
                    if (!try forEach(context, @intCast(index), &empty)) break;
                },
                null_int4 => {
                    if (!try forEach(context, @intCast(index), null)) break;
                },
                else => {
                    var bytes = try reader.bytes(@intCast(byte_length));
                    if (!try forEach(context, @intCast(index), &bytes)) break;
                },
            }
        }
    }
};

pub const BindComplete = [_]u8{'2'} ++ toBytes(Int32(4));

pub const ColumnIdentifier = union(enum) {
    name: Data,
    index: u32,
    duplicate: void,

    pub fn init(name: Data) !@This() {
        if (switch (name.slice().len) {
            1..."4294967295".len => true,
            0 => return .{ .name = .{ .empty = {} } },
            else => false,
        }) might_be_int: {
            // use a u64 to avoid overflow
            var int: u64 = 0;
            for (name.slice()) |byte| {
                int = int * 10 + switch (byte) {
                    '0'...'9' => @as(u64, byte - '0'),
                    else => break :might_be_int,
                };
            }

            // JSC only supports indexed property names up to 2^32
            if (int < std.math.maxInt(u32))
                return .{ .index = @intCast(int) };
        }

        return .{ .name = .{ .owned = try name.toOwned() } };
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .name => |*name| name.deinit(),
            else => {},
        }
    }
};
pub const FieldDescription = struct {
    /// JavaScriptCore treats numeric property names differently than string property names.
    /// so we do the work to figure out if the property name is a number ahead of time.
    name_or_index: ColumnIdentifier = .{
        .name = .{ .empty = {} },
    },
    table_oid: int4 = 0,
    column_index: short = 0,
    type_oid: int4 = 0,
    binary: bool = false,
    pub fn typeTag(this: @This()) types.Tag {
        return @enumFromInt(@as(short, @truncate(this.type_oid)));
    }

    pub fn deinit(this: *@This()) void {
        this.name_or_index.deinit();
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) AnyPostgresError!void {
        var name = try reader.readZ();
        errdefer {
            name.deinit();
        }

        // Field name (null-terminated string)
        const field_name = try ColumnIdentifier.init(name);
        // Table OID (4 bytes)
        // If the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
        const table_oid = try reader.int4();

        // Column attribute number (2 bytes)
        // If the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
        const column_index = try reader.short();

        // Data type OID (4 bytes)
        // The object ID of the field's data type. The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
        const type_oid = try reader.int4();

        // Data type size (2 bytes) The data type size (see pg_type.typlen). Note that negative values denote variable-width types.
        // Type modifier (4 bytes) The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
        try reader.skip(6);

        // Format code (2 bytes)
        // The format code being used for the field. Currently will be zero (text) or one (binary). In a RowDescription returned from the statement variant of Describe, the format code is not yet known and will always be zero.
        const binary = switch (try reader.short()) {
            0 => false,
            1 => true,
            else => return error.UnknownFormatCode,
        };
        this.* = .{
            .table_oid = table_oid,
            .column_index = column_index,
            .type_oid = type_oid,
            .binary = binary,
            .name_or_index = field_name,
        };
    }

    pub const decode = decoderWrap(FieldDescription, decodeInternal).decode;
};

pub const RowDescription = struct {
    fields: []FieldDescription = &[_]FieldDescription{},
    pub fn deinit(this: *@This()) void {
        for (this.fields) |*field| {
            field.deinit();
        }

        bun.default_allocator.free(this.fields);
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        var remaining_bytes = try reader.length();
        remaining_bytes -|= 4;

        const field_count: usize = @intCast(@max(try reader.short(), 0));
        var fields = try bun.default_allocator.alloc(
            FieldDescription,
            field_count,
        );
        var remaining = fields;
        errdefer {
            for (fields[0 .. field_count - remaining.len]) |*field| {
                field.deinit();
            }

            bun.default_allocator.free(fields);
        }
        while (remaining.len > 0) {
            try remaining[0].decodeInternal(Container, reader);
            remaining = remaining[1..];
        }
        this.* = .{
            .fields = fields,
        };
    }

    pub const decode = decoderWrap(RowDescription, decodeInternal).decode;
};

pub const ParameterDescription = struct {
    parameters: []int4 = &[_]int4{},

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        var remaining_bytes = try reader.length();
        remaining_bytes -|= 4;

        const count = try reader.short();
        const parameters = try bun.default_allocator.alloc(int4, @intCast(@max(count, 0)));

        var data = try reader.read(@as(usize, @intCast(@max(count, 0))) * @sizeOf((int4)));
        defer data.deinit();
        const input_params: []align(1) const int4 = toInt32Slice(int4, data.slice());
        for (input_params, parameters) |src, *dest| {
            dest.* = @byteSwap(src);
        }

        this.* = .{
            .parameters = parameters,
        };
    }

    pub const decode = decoderWrap(ParameterDescription, decodeInternal).decode;
};

// workaround for zig compiler TODO
fn toInt32Slice(comptime Int: type, slice: []const u8) []align(1) const Int {
    return @as([*]align(1) const Int, @ptrCast(slice.ptr))[0 .. slice.len / @sizeOf((Int))];
}

pub const NotificationResponse = struct {
    pid: int4 = 0,
    channel: bun.ByteList = .{},
    payload: bun.ByteList = .{},

    pub fn deinit(this: *@This()) void {
        this.channel.deinitWithAllocator(bun.default_allocator);
        this.payload.deinitWithAllocator(bun.default_allocator);
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const length = try reader.length();
        bun.assert(length >= 4);

        this.* = .{
            .pid = try reader.int4(),
            .channel = (try reader.readZ()).toOwned(),
            .payload = (try reader.readZ()).toOwned(),
        };
    }

    pub const decode = decoderWrap(NotificationResponse, decodeInternal).decode;
};

pub const CommandComplete = struct {
    command_tag: Data = .{ .empty = {} },

    pub fn deinit(this: *@This()) void {
        this.command_tag.deinit();
    }

    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        const length = try reader.length();
        bun.assert(length >= 4);

        const tag = try reader.readZ();
        this.* = .{
            .command_tag = tag,
        };
    }

    pub const decode = decoderWrap(CommandComplete, decodeInternal).decode;
};

pub const Parse = struct {
    name: []const u8 = "",
    query: []const u8 = "",
    params: []const int4 = &.{},

    pub fn deinit(this: *Parse) void {
        _ = this;
    }

    pub fn writeInternal(
        this: *const @This(),
        comptime Context: type,
        writer: NewWriter(Context),
    ) !void {
        const parameters = this.params;
        const count: usize = @sizeOf((u32)) + @sizeOf(u16) + (parameters.len * @sizeOf(u32)) + @max(zCount(this.name), 1) + @max(zCount(this.query), 1);
        const header = [_]u8{
            'P',
        } ++ toBytes(Int32(count));
        try writer.write(&header);
        try writer.string(this.name);
        try writer.string(this.query);
        try writer.short(parameters.len);
        for (parameters) |parameter| {
            try writer.int4(parameter);
        }
    }

    pub const write = writeWrap(@This(), writeInternal).write;
};

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

    pub const write = writeWrap(@This(), writeInternal).write;
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

    pub const decode = decoderWrap(CopyData, decodeInternal).decode;

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

    pub const write = writeWrap(@This(), writeInternal).write;
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

    pub const write = writeWrap(@This(), writeInternal).write;
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

    pub const write = writeWrap(@This(), writeInternal).write;
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

    pub const write = writeWrap(@This(), writeInternal).write;
};

fn zCount(slice: []const u8) usize {
    return if (slice.len > 0) slice.len + 1 else 0;
}

fn zFieldCount(prefix: []const u8, slice: []const u8) usize {
    if (slice.len > 0) {
        return zCount(prefix) + zCount(slice);
    }

    return zCount(prefix);
}

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

    pub const write = writeWrap(@This(), writeInternal).write;
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

    pub const write = writeWrap(@This(), writeInternal).write;
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
    pub const decode = decoderWrap(NoticeResponse, decodeInternal).decode;

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

    pub const decode = decoderWrap(CopyFail, decodeInternal).decode;

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

    pub const write = writeWrap(@This(), writeInternal).write;
};

pub const CopyInResponse = struct {
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        _ = reader;
        _ = this;
        TODO(@This());
    }

    pub const decode = decoderWrap(CopyInResponse, decodeInternal).decode;
};

pub const CopyOutResponse = struct {
    pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
        _ = reader;
        _ = this;
        TODO(@This());
    }

    pub const decode = decoderWrap(CopyInResponse, decodeInternal).decode;
};

fn TODO(comptime Type: type) !void {
    bun.Output.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(Type))});
}
