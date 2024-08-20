const bun = @import("root").bun;
const JSC = bun.JSC;
const String = bun.String;
const uws = bun.uws;
const std = @import("std");
const debug = bun.Output.scoped(.Postgres, false);
const int4 = u32;
const PostgresInt32 = int4;
const short = u16;
const PostgresShort = u16;
const Crypto = JSC.API.Bun.Crypto;
const JSValue = JSC.JSValue;

const Data = union(enum) {
    owned: bun.ByteList,
    temporary: []const u8,
    empty: void,

    pub fn toOwned(this: @This()) !bun.ByteList {
        return switch (this) {
            .owned => this.owned,
            .temporary => bun.ByteList.init(try bun.default_allocator.dupe(u8, this.temporary)),
            .empty => bun.ByteList.init(&.{}),
        };
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .owned => this.owned.deinitWithAllocator(bun.default_allocator),
            .temporary => {},
            .empty => {},
        }
    }

    /// Zero bytes before deinit
    /// Generally, for security reasons.
    pub fn zdeinit(this: *@This()) void {
        switch (this.*) {
            .owned => {

                // Zero bytes before deinit
                @memset(this.owned.slice(), 0);

                this.owned.deinitWithAllocator(bun.default_allocator);
            },
            .temporary => {},
            .empty => {},
        }
    }

    pub fn slice(this: @This()) []const u8 {
        return switch (this) {
            .owned => this.owned.slice(),
            .temporary => this.temporary,
            .empty => "",
        };
    }

    pub fn substring(this: @This(), start_index: usize, end_index: usize) Data {
        return switch (this) {
            .owned => .{ .temporary = this.owned.slice()[start_index..end_index] },
            .temporary => .{ .temporary = this.temporary[start_index..end_index] },
            .empty => .{ .empty = {} },
        };
    }

    pub fn sliceZ(this: @This()) [:0]const u8 {
        return switch (this) {
            .owned => this.owned.slice()[0..this.owned.len :0],
            .temporary => this.temporary[0..this.temporary.len :0],
            .empty => "",
        };
    }
};

pub const protocol = struct {
    pub const ArrayList = struct {
        array: *std.ArrayList(u8),

        pub fn offset(this: @This()) usize {
            return this.array.items.len;
        }

        pub fn write(this: @This(), bytes: []const u8) anyerror!void {
            try this.array.appendSlice(bytes);
        }

        pub fn pwrite(this: @This(), bytes: []const u8, i: usize) anyerror!void {
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
        pub fn read(this: StackReader, count: usize) anyerror!Data {
            const offset = this.offset.*;
            if (!this.ensureCapacity(count)) {
                return error.ShortRead;
            }

            this.skip(count);
            return Data{
                .temporary = this.buffer[offset..this.offset.*],
            };
        }
        pub fn readZ(this: StackReader) anyerror!Data {
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
        comptime writeFunction_: (fn (ctx: Context, bytes: []const u8) anyerror!void),
        comptime pwriteFunction_: (fn (ctx: Context, bytes: []const u8, offset: usize) anyerror!void),
    ) type {
        return struct {
            wrapped: Context,

            const writeFn = writeFunction_;
            const pwriteFn = pwriteFunction_;
            const offsetFn = offsetFn_;
            pub const Ctx = Context;

            pub const WrappedWriter = @This();

            pub inline fn write(this: @This(), data: []const u8) anyerror!void {
                try writeFn(this.wrapped, data);
            }

            pub const LengthWriter = struct {
                index: usize,
                context: WrappedWriter,

                pub fn write(this: LengthWriter) anyerror!void {
                    try this.context.pwrite(&Int32(this.context.offset() - this.index), this.index);
                }

                pub fn writeExcludingSelf(this: LengthWriter) anyerror!void {
                    try this.context.pwrite(&Int32(this.context.offset() -| (this.index + 4)), this.index);
                }
            };

            pub inline fn length(this: @This()) anyerror!LengthWriter {
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

            pub inline fn pwrite(this: @This(), data: []const u8, i: usize) anyerror!void {
                try pwriteFn(this.wrapped, data, i);
            }

            pub fn int4(this: @This(), value: PostgresInt32) !void {
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
        S = 'S',

        /// Severity: the field contents are ERROR, FATAL, or PANIC (in an error message), or WARNING, NOTICE, DEBUG, INFO, or LOG (in a notice message). This is identical to the S field except that the contents are never localized. This is present only in messages generated by PostgreSQL versions 9.6 and later.
        V = 'V',

        /// Code: the SQLSTATE code for the error (see Appendix A). Not localizable. Always present.
        C = 'C',

        /// Message: the primary human-readable error message. This should be accurate but terse (typically one line). Always present.
        M = 'M',

        /// Detail: an optional secondary error message carrying more detail about the problem. Might run to multiple lines.
        D = 'D',

        /// Hint: an optional suggestion what to do about the problem. This is intended to differ from Detail in that it offers advice (potentially inappropriate) rather than hard facts. Might run to multiple lines.
        H = 'H',

        /// Position: the field value is a decimal ASCII integer, indicating an error cursor position as an index into the original query string. The first character has index 1, and positions are measured in characters not bytes.
        P = 'P',

        /// Internal position: this is defined the same as the P field, but it is used when the cursor position refers to an internally generated command rather than the one submitted by the client. The q field will always appear when this field appears.
        p = 'p',

        /// Internal query: the text of a failed internally-generated command. This could be, for example, an SQL query issued by a PL/pgSQL function.
        q = 'q',

        /// Where: an indication of the context in which the error occurred. Presently this includes a call stack traceback of active procedural language functions and internally-generated queries. The trace is one entry per line, most recent first.
        W = 'W',

        /// Schema name: if the error was associated with a specific database object, the name of the schema containing that object, if any.
        s = 's',

        /// Table name: if the error was associated with a specific table, the name of the table. (Refer to the schema name field for the name of the table's schema.)
        t = 't',

        /// Column name: if the error was associated with a specific table column, the name of the column. (Refer to the schema and table name fields to identify the table.)
        c = 'c',

        /// Data type name: if the error was associated with a specific data type, the name of the data type. (Refer to the schema name field for the name of the data type's schema.)
        d = 'd',

        /// Constraint name: if the error was associated with a specific constraint, the name of the constraint. Refer to fields listed above for the associated table or domain. (For this purpose, indexes are treated as constraints, even if they weren't created with constraint syntax.)
        n = 'n',

        /// File: the file name of the source-code location where the error was reported.
        F = 'F',

        /// Line: the line number of the source-code location where the error was reported.
        L = 'L',

        /// Routine: the name of the source-code routine reporting the error.
        R = 'R',

        _,
    };

    pub const FieldMessage = union(FieldType) {
        S: String,
        V: String,
        C: String,
        M: String,
        D: String,
        H: String,
        P: String,
        p: String,
        q: String,
        W: String,
        s: String,
        t: String,
        c: String,
        d: String,
        n: String,
        F: String,
        L: String,
        R: String,

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
                .S => FieldMessage{ .S = String.createUTF8(message) },
                .V => FieldMessage{ .V = String.createUTF8(message) },
                .C => FieldMessage{ .C = String.createUTF8(message) },
                .M => FieldMessage{ .M = String.createUTF8(message) },
                .D => FieldMessage{ .D = String.createUTF8(message) },
                .H => FieldMessage{ .H = String.createUTF8(message) },
                .P => FieldMessage{ .P = String.createUTF8(message) },
                .p => FieldMessage{ .p = String.createUTF8(message) },
                .q => FieldMessage{ .q = String.createUTF8(message) },
                .W => FieldMessage{ .W = String.createUTF8(message) },
                .s => FieldMessage{ .s = String.createUTF8(message) },
                .t => FieldMessage{ .t = String.createUTF8(message) },
                .c => FieldMessage{ .c = String.createUTF8(message) },
                .d => FieldMessage{ .d = String.createUTF8(message) },
                .n => FieldMessage{ .n = String.createUTF8(message) },
                .F => FieldMessage{ .F = String.createUTF8(message) },
                .L => FieldMessage{ .L = String.createUTF8(message) },
                .R => FieldMessage{ .R = String.createUTF8(message) },
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
        comptime readFunction_: (fn (ctx: Context, count: usize) anyerror!Data),
        comptime readZ_: (fn (ctx: Context) anyerror!Data),
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

            pub inline fn read(this: @This(), count: usize) anyerror!Data {
                return try readFn(this.wrapped, count);
            }

            pub inline fn eatMessage(this: @This(), comptime msg_: anytype) anyerror!void {
                const msg = msg_[1..];
                try this.ensureCapacity(msg.len);

                var input = try readFn(this.wrapped, msg.len);
                defer input.deinit();
                if (bun.strings.eqlComptime(input.slice(), msg)) return;
                return error.InvalidMessage;
            }

            pub fn skip(this: @This(), count: usize) anyerror!void {
                skipFn(this.wrapped, count);
            }

            pub fn peek(this: @This()) []const u8 {
                return peekFn(this.wrapped);
            }

            pub inline fn readZ(this: @This()) anyerror!Data {
                return try readZFn(this.wrapped);
            }

            pub inline fn ensureCapacity(this: @This(), count: usize) anyerror!void {
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
            pub fn decode(this: *Container, context: anytype) anyerror!void {
                const Context = @TypeOf(context);
                try decodeFn(this, Context, NewReader(Context){ .wrapped = context });
            }
        };
    }

    fn writeWrap(comptime Container: type, comptime writeFn: anytype) type {
        return struct {
            pub fn write(this: *Container, context: anytype) anyerror!void {
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
                    if (!try reader.expectInt(u32, 5)) {
                        return error.InvalidMessage;
                    }
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

            return globalObject.createSyntaxErrorInstance("Postgres error occurred\n{s}", .{b.allocatedSlice()[0..b.len]});
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

    pub const FormatCode = enum {
        text,
        binary,

        pub fn from(value: short) !FormatCode {
            return switch (value) {
                0 => .text,
                1 => .binary,
                else => error.UnknownFormatCode,
            };
        }
    };

    pub const null_int4 = 4294967295;

    pub const DataRow = struct {
        pub fn decode(context: anytype, comptime ContextType: type, reader: NewReader(ContextType), comptime forEach: fn (@TypeOf(context), index: u32, bytes: ?*Data) anyerror!bool) anyerror!void {
            var remaining_bytes = try reader.length();
            remaining_bytes -|= 4;

            const remaining_fields: usize = @intCast(@max(try reader.short(), 0));

            for (0..remaining_fields) |index| {
                const byte_length = try reader.int4();
                switch (byte_length) {
                    0 => break,
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

    pub const FieldDescription = struct {
        name: Data = .{ .empty = {} },
        table_oid: int4 = 0,
        column_index: short = 0,
        type_oid: int4 = 0,

        pub fn typeTag(this: @This()) types.Tag {
            return @enumFromInt(@as(short, @truncate(this.type_oid)));
        }

        pub fn deinit(this: *@This()) void {
            this.name.deinit();
        }

        pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
            var name = try reader.readZ();
            errdefer {
                name.deinit();
            }
            // If the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
            // Int16
            // If the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
            // Int32
            // The object ID of the field's data type.
            // Int16
            // The data type size (see pg_type.typlen). Note that negative values denote variable-width types.
            // Int32
            // The type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
            // Int16
            // The format code being used for the field. Currently will be zero (text) or one (binary). In a RowDescription returned from the statement variant of Describe, the format code is not yet known and will always be zero.
            this.* = .{
                .table_oid = try reader.int4(),
                .column_index = try reader.short(),
                .type_oid = try reader.int4(),
                .name = .{ .owned = try name.toOwned() },
            };

            try reader.skip(2 + 4 + 2);
        }

        pub const decode = decoderWrap(FieldDescription, decodeInternal).decode;
    };

    pub const RowDescription = struct {
        fields: []const FieldDescription = &[_]FieldDescription{},
        pub fn deinit(this: *@This()) void {
            for (this.fields) |*field| {
                @constCast(field).deinit();
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

            const count: usize = @sizeOf((int4)) + @sizeOf((int4)) + zFieldCount("user", user) + zFieldCount("database", database) + zFieldCount("client_encoding", "UTF8") + zFieldCount("", options) + 1;

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

            if (options.len > 0)
                try writer.string(options);

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

    pub const Query = struct {
        message: Data = .{ .empty = {} },

        pub fn deinit(this: *@This()) void {
            this.message.deinit();
        }

        pub fn writeInternal(
            this: *const @This(),
            comptime Context: type,
            writer: NewWriter(Context),
        ) !void {
            const message = this.message.slice();
            const count: u32 = @sizeOf((u32)) + message.len + 1;
            const header = [_]u8{
                'Q',
            } ++ toBytes(Int32(count));
            try writer.write(&header);
            try writer.string(message);
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
        std.debug.panic("TODO: not implemented {s}", .{bun.meta.typeBaseName(@typeName(Type))});
    }
};

pub const types = struct {
    //     select b.typname,  b.oid, b.typarray
    //       from pg_catalog.pg_type a
    //       left join pg_catalog.pg_type b on b.oid = a.typelem
    //       where a.typcategory = 'A'
    //       group by b.oid, b.typarray
    //       order by b.oid
    // ;
    //                 typname                |  oid  | typarray
    // ---------------------------------------+-------+----------
    //  bool                                  |    16 |     1000
    //  bytea                                 |    17 |     1001
    //  char                                  |    18 |     1002
    //  name                                  |    19 |     1003
    //  int8                                  |    20 |     1016
    //  int2                                  |    21 |     1005
    //  int2vector                            |    22 |     1006
    //  int4                                  |    23 |     1007
    //  regproc                               |    24 |     1008
    //  text                                  |    25 |     1009
    //  oid                                   |    26 |     1028
    //  tid                                   |    27 |     1010
    //  xid                                   |    28 |     1011
    //  cid                                   |    29 |     1012
    //  oidvector                             |    30 |     1013
    //  pg_type                               |    71 |      210
    //  pg_attribute                          |    75 |      270
    //  pg_proc                               |    81 |      272
    //  pg_class                              |    83 |      273
    //  json                                  |   114 |      199
    //  xml                                   |   142 |      143
    //  point                                 |   600 |     1017
    //  lseg                                  |   601 |     1018
    //  path                                  |   602 |     1019
    //  box                                   |   603 |     1020
    //  polygon                               |   604 |     1027
    //  line                                  |   628 |      629
    //  cidr                                  |   650 |      651
    //  float4                                |   700 |     1021
    //  float8                                |   701 |     1022
    //  circle                                |   718 |      719
    //  macaddr8                              |   774 |      775
    //  money                                 |   790 |      791
    //  macaddr                               |   829 |     1040
    //  inet                                  |   869 |     1041
    //  aclitem                               |  1033 |     1034
    //  bpchar                                |  1042 |     1014
    //  varchar                               |  1043 |     1015
    //  date                                  |  1082 |     1182
    //  time                                  |  1083 |     1183
    //  timestamp                             |  1114 |     1115
    //  timestamptz                           |  1184 |     1185
    //  interval                              |  1186 |     1187
    //  pg_database                           |  1248 |    12052
    //  timetz                                |  1266 |     1270
    //  bit                                   |  1560 |     1561
    //  varbit                                |  1562 |     1563
    //  numeric                               |  1700 |     1231
    pub const Tag = enum(short) {
        bool = 16,
        bytea = 17,
        char = 18,
        name = 19,
        int8 = 20,
        int2 = 21,
        int2vector = 22,
        int4 = 23,
        // regproc = 24,
        text = 25,
        // oid = 26,
        // tid = 27,
        // xid = 28,
        // cid = 29,
        // oidvector = 30,
        // pg_type = 71,
        // pg_attribute = 75,
        // pg_proc = 81,
        // pg_class = 83,
        json = 114,
        xml = 142,
        point = 600,
        lseg = 601,
        path = 602,
        box = 603,
        polygon = 604,
        line = 628,
        cidr = 650,
        float4 = 700,
        float8 = 701,
        circle = 718,
        macaddr8 = 774,
        money = 790,
        macaddr = 829,
        inet = 869,
        aclitem = 1033,
        bpchar = 1042,
        varchar = 1043,
        date = 1082,
        time = 1083,
        timestamp = 1114,
        timestamptz = 1184,
        interval = 1186,
        pg_database = 1248,
        timetz = 1266,
        bit = 1560,
        varbit = 1562,
        numeric = 1700,
        uuid = 2950,

        bool_array = 1000,
        bytea_array = 1001,
        char_array = 1002,
        name_array = 1003,
        int8_array = 1016,
        int2_array = 1005,
        int2vector_array = 1006,
        int4_array = 1007,
        // regproc_array = 1008,
        text_array = 1009,
        oid_array = 1028,
        tid_array = 1010,
        xid_array = 1011,
        cid_array = 1012,
        // oidvector_array = 1013,
        // pg_type_array = 210,
        // pg_attribute_array = 270,
        // pg_proc_array = 272,
        // pg_class_array = 273,
        json_array = 199,
        xml_array = 143,
        point_array = 1017,
        lseg_array = 1018,
        path_array = 1019,
        box_array = 1020,
        polygon_array = 1027,
        line_array = 629,
        cidr_array = 651,
        float4_array = 1021,
        float8_array = 1022,
        circle_array = 719,
        macaddr8_array = 775,
        money_array = 791,
        macaddr_array = 1040,
        inet_array = 1041,
        aclitem_array = 1034,
        bpchar_array = 1014,
        varchar_array = 1015,
        date_array = 1182,
        time_array = 1183,
        timestamp_array = 1115,
        timestamptz_array = 1185,
        interval_array = 1187,
        pg_database_array = 12052,
        timetz_array = 1270,
        bit_array = 1561,
        varbit_array = 1563,
        numeric_array = 1231,
        _,

        pub fn isBinaryFormatSupported(this: Tag) bool {
            return switch (this) {
                // TODO: .int2_array, .float8_array,
                .int4_array, .float4_array, .int4, .float8, .float4, .bytea, .numeric => true,

                else => false,
            };
        }

        pub fn formatCode(this: Tag) short {
            if (this.isBinaryFormatSupported()) {
                return 1;
            }

            return 0;
        }

        fn PostgresBinarySingleDimensionArray(comptime T: type) type {
            return extern struct {
                // struct array_int4 {
                //   int4_t ndim; /* Number of dimensions */
                //   int4_t _ign; /* offset for data, removed by libpq */
                //   Oid elemtype; /* type of element in the array */

                //   /* First dimension */
                //   int4_t size; /* Number of elements */
                //   int4_t index; /* Index of first element */
                //   int4_t first_value; /* Beginning of integer data */
                // };

                ndim: i32,
                offset_for_data: i32,
                element_type: i32,

                len: i32,
                index: i32,
                first_value: T,

                pub fn slice(this: *@This()) []T {
                    if (this.len == 0) return &.{};

                    var head = @as([*]T, @ptrCast(&this.first_value));
                    var current = head;
                    const len: usize = @intCast(this.len);
                    for (0..len) |i| {
                        // Skip every other value as it contains the size of the element
                        current = current[1..];

                        const val = current[0];
                        const Int = std.meta.Int(.unsigned, @bitSizeOf(T));
                        const swapped = @byteSwap(@as(Int, @bitCast(val)));

                        head[i] = @bitCast(swapped);

                        current = current[1..];
                    }

                    return head[0..len];
                }

                pub fn init(bytes: []const u8) *@This() {
                    const this: *@This() = @alignCast(@ptrCast(@constCast(bytes.ptr)));
                    this.ndim = @byteSwap(this.ndim);
                    this.offset_for_data = @byteSwap(this.offset_for_data);
                    this.element_type = @byteSwap(this.element_type);
                    this.len = @byteSwap(this.len);
                    this.index = @byteSwap(this.index);
                    return this;
                }
            };
        }

        pub fn toJSTypedArrayType(comptime T: Tag) JSValue.JSType {
            return comptime switch (T) {
                .int4_array => .Int32Array,
                // .int2_array => .Uint2Array,
                .float4_array => .Float32Array,
                // .float8_array => .Float64Array,
                else => @compileError("TODO: not implemented"),
            };
        }

        pub fn byteArrayType(comptime T: Tag) type {
            return comptime switch (T) {
                .int4_array => i32,
                // .int2_array => i16,
                .float4_array => f32,
                // .float8_array => f64,
                else => @compileError("TODO: not implemented"),
            };
        }

        pub fn unsignedByteArrayType(comptime T: Tag) type {
            return comptime switch (T) {
                .int4_array => u32,
                // .int2_array => u16,
                .float4_array => f32,
                // .float8_array => f64,
                else => @compileError("TODO: not implemented"),
            };
        }

        pub fn pgArrayType(comptime T: Tag) type {
            return PostgresBinarySingleDimensionArray(byteArrayType(T));
        }

        fn toJSWithType(
            tag: Tag,
            globalObject: *JSC.JSGlobalObject,
            comptime Type: type,
            value: Type,
        ) anyerror!JSValue {
            switch (tag) {
                .numeric => {
                    return numeric.toJS(globalObject, value);
                },

                .float4, .float8 => {
                    return numeric.toJS(globalObject, value);
                },

                .json => {
                    return json.toJS(globalObject, value);
                },

                .bool => {
                    return @"bool".toJS(globalObject, value);
                },

                .timestamp, .timestamptz => {
                    return date.toJS(globalObject, value);
                },

                .bytea => {
                    return bytea.toJS(globalObject, value);
                },

                .int8 => {
                    return JSValue.fromInt64NoTruncate(globalObject, value);
                },

                .int4 => {
                    return numeric.toJS(globalObject, value);
                },

                else => {
                    return string.toJS(globalObject, value);
                },
            }
        }

        pub fn toJS(
            tag: Tag,
            globalObject: *JSC.JSGlobalObject,
            value: anytype,
        ) anyerror!JSValue {
            return toJSWithType(tag, globalObject, @TypeOf(value), value);
        }

        pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSValue) anyerror!Tag {
            if (value.isEmptyOrUndefinedOrNull()) {
                return Tag.numeric;
            }

            if (value.isCell()) {
                const tag = value.jsType();
                if (tag.isStringLike()) {
                    return .text;
                }

                if (tag == .JSDate) {
                    return .timestamp;
                }

                if (tag.isTypedArray()) {
                    if (tag == .Int32Array)
                        return .int4_array;

                    return .bytea;
                }

                if (tag == .HeapBigInt) {
                    return .int8;
                }

                if (tag.isArrayLike() and value.getLength(globalObject) > 0) {
                    return Tag.fromJS(globalObject, value.getIndex(globalObject, 0));
                }

                // Ban these types:
                if (tag == .NumberObject) {
                    return error.JSError;
                }

                if (tag == .BooleanObject) {
                    return error.JSError;
                }

                // It's something internal
                if (!tag.isIndexable()) {
                    return error.JSError;
                }

                // We will JSON.stringify anything else.
                if (tag.isObject()) {
                    return .json;
                }
            }

            if (value.isInt32()) {
                return .int4;
            }

            if (value.isNumber()) {
                return .float8;
            }

            if (value.isBoolean()) {
                return .bool;
            }

            return .numeric;
        }
    };

    pub const string = struct {
        pub const to = 25;
        pub const from = [_]short{1002};

        pub fn toJSWithType(
            globalThis: *JSC.JSGlobalObject,
            comptime Type: type,
            value: Type,
        ) anyerror!JSValue {
            switch (comptime Type) {
                [:0]u8, []u8, []const u8, [:0]const u8 => {
                    var str = String.fromUTF8(value);
                    defer str.deinit();
                    return str.toJS(globalThis);
                },

                bun.String => {
                    return value.toJS(globalThis);
                },

                *Data => {
                    var str = String.fromUTF8(value.slice());
                    defer str.deinit();
                    defer value.deinit();
                    return str.toJS(globalThis);
                },

                else => {
                    @compileError("unsupported type " ++ @typeName(Type));
                },
            }
        }

        pub fn toJS(
            globalThis: *JSC.JSGlobalObject,
            value: anytype,
        ) !JSValue {
            var str = try toJSWithType(globalThis, @TypeOf(value), value);
            defer str.deinit();
            return str.toJS(globalThis);
        }
    };

    pub const numeric = struct {
        pub const to = 0;
        pub const from = [_]short{ 21, 23, 26, 700, 701 };

        pub fn toJS(
            _: *JSC.JSGlobalObject,
            value: anytype,
        ) anyerror!JSValue {
            return JSValue.jsNumber(value);
        }
    };

    pub const json = struct {
        pub const to = 114;
        pub const from = [_]short{ 114, 3802 };

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSValue {
            defer value.deinit();
            var str = bun.String.fromUTF8(value.slice());
            defer str.deref();
            const parse_result = JSValue.parseJSON(str.toJS(globalObject), globalObject);
            if (parse_result.isAnyError()) {
                globalObject.throwValue(parse_result);
                return error.JSError;
            }

            return parse_result;
        }
    };

    pub const @"bool" = struct {
        pub const to = 16;
        pub const from = [_]short{16};

        pub fn toJS(
            _: *JSC.JSGlobalObject,
            value: bool,
        ) anyerror!JSValue {
            return JSValue.jsBoolean(value);
        }
    };

    pub const date = struct {
        pub const to = 1184;
        pub const from = [_]short{ 1082, 1114, 1184 };

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSValue {
            defer value.deinit();
            return JSValue.fromDateString(globalObject, value.sliceZ().ptr);
        }
    };

    pub const bytea = struct {
        pub const to = 17;
        pub const from = [_]short{17};

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSValue {
            defer value.deinit();

            // var slice = value.slice()[@min(1, value.len)..];
            // _ = slice;
            return JSValue.createBuffer(globalObject, value.slice(), null);
        }
    };
};

const Socket = uws.AnySocket;
const PreparedStatementsMap = std.HashMapUnmanaged(u64, *PostgresSQLStatement, bun.IdentityContext(u64), 80);

pub const PostgresSQLContext = struct {
    tcp: ?*uws.SocketContext = null,

    onQueryResolveFn: JSC.Strong = .{},
    onQueryRejectFn: JSC.Strong = .{},

    pub fn init(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        var ctx = &globalObject.bunVM().rareData().postgresql_context;
        ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
        ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

        return .undefined;
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(init, .{
                .name = "PostgresSQLContext__init",
            });
        }
    }
};

pub const PostgresSQLQuery = struct {
    statement: ?*PostgresSQLStatement = null,
    query: bun.String = bun.String.empty,
    cursor_name: bun.String = bun.String.empty,
    thisValue: JSValue = .undefined,
    target: JSC.Strong = JSC.Strong.init(),
    status: Status = Status.pending,
    is_done: bool = false,
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
    binary: bool = false,
    pending_value: JSC.Strong = .{},

    pub usingnamespace JSC.Codegen.JSPostgresSQLQuery;

    pub const Status = enum(u8) {
        pending,
        written,
        running,
        binding,
        success,
        fail,

        pub fn isRunning(this: Status) bool {
            return this == .running or this == .binding;
        }
    };

    pub fn hasPendingActivity(this: *@This()) bool {
        return this.ref_count.load(.monotonic) > 1;
    }

    pub fn deinit(this: *@This()) void {
        if (this.statement) |statement| {
            statement.deref();
        }
        this.query.deref();
        this.cursor_name.deref();
        this.target.deinit();
        this.pending_value.deinit();

        bun.default_allocator.destroy(this);
    }

    pub fn finalize(this: *@This()) void {
        debug("PostgresSQLQuery finalize", .{});
        this.thisValue = .zero;
        this.deref();
    }

    pub fn deref(this: *@This()) void {
        const ref_count = this.ref_count.fetchSub(1, .monotonic);

        if (ref_count == 1) {
            this.deinit();
        }
    }

    pub fn ref(this: *@This()) void {
        bun.assert(this.ref_count.fetchAdd(1, .monotonic) > 0);
    }

    pub fn onNoData(this: *@This(), globalObject: *JSC.JSGlobalObject) void {
        this.status = .success;
        defer this.deref();

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().postgresql_context.onQueryResolveFn.get().?;
        const event_loop = vm.eventLoop();
        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            this.pending_value.trySwap() orelse .undefined,
            JSValue.jsNumber(0),
            JSValue.jsNumber(0),
        });
    }
    pub fn onWriteFail(this: *@This(), err: anyerror, globalObject: *JSC.JSGlobalObject) void {
        this.status = .fail;
        this.pending_value.deinit();
        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        const instance = globalObject.createErrorInstance("Failed to bind query: {s}", .{@errorName(err)});

        // TODO: error handling
        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
        const event_loop = vm.eventLoop();
        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            instance,
        });
    }

    pub fn onError(this: *@This(), err: protocol.ErrorResponse, globalObject: *JSC.JSGlobalObject) void {
        this.status = .fail;
        defer this.deref();

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            return;
        }

        // TODO: error handling
        var vm = JSC.VirtualMachine.get();
        const function = vm.rareData().postgresql_context.onQueryRejectFn.get().?;
        globalObject.queueMicrotask(function, &[_]JSValue{ targetValue, err.toJS(globalObject) });
    }

    const CommandTag = union(enum) {
        // For an INSERT command, the tag is INSERT oid rows, where rows is the
        // number of rows inserted. oid used to be the object ID of the inserted
        // row if rows was 1 and the target table had OIDs, but OIDs system
        // columns are not supported anymore; therefore oid is always 0.
        INSERT: u64,
        // For a DELETE command, the tag is DELETE rows where rows is the number
        // of rows deleted.
        DELETE: u64,
        // For an UPDATE command, the tag is UPDATE rows where rows is the
        // number of rows updated.
        UPDATE: u64,
        // For a MERGE command, the tag is MERGE rows where rows is the number
        // of rows inserted, updated, or deleted.
        MERGE: u64,
        // For a SELECT or CREATE TABLE AS command, the tag is SELECT rows where
        // rows is the number of rows retrieved.
        SELECT: u64,
        // For a MOVE command, the tag is MOVE rows where rows is the number of
        // rows the cursor's position has been changed by.
        MOVE: u64,
        // For a FETCH command, the tag is FETCH rows where rows is the number
        // of rows that have been retrieved from the cursor.
        FETCH: u64,
        // For a COPY command, the tag is COPY rows where rows is the number of
        // rows copied. (Note: the row count appears only in PostgreSQL 8.2 and
        // later.)
        COPY: u64,

        other: []const u8,

        pub fn toJSTag(this: CommandTag, globalObject: *JSC.JSGlobalObject) JSValue {
            return switch (this) {
                .INSERT => JSValue.jsNumber(1),
                .DELETE => JSValue.jsNumber(2),
                .UPDATE => JSValue.jsNumber(3),
                .MERGE => JSValue.jsNumber(4),
                .SELECT => JSValue.jsNumber(5),
                .MOVE => JSValue.jsNumber(6),
                .FETCH => JSValue.jsNumber(7),
                .COPY => JSValue.jsNumber(8),
                .other => |tag| JSC.ZigString.init(tag).toJS(globalObject),
            };
        }

        pub fn toJSNumber(this: CommandTag) JSValue {
            return switch (this) {
                .other => JSValue.jsNumber(0),
                inline else => |val| JSValue.jsNumber(val),
            };
        }

        const KnownCommand = enum {
            INSERT,
            DELETE,
            UPDATE,
            MERGE,
            SELECT,
            MOVE,
            FETCH,
            COPY,

            pub const Map = bun.ComptimeEnumMap(KnownCommand);
        };

        pub fn init(tag: []const u8) CommandTag {
            const first_space_index = bun.strings.indexOfChar(tag, ' ') orelse return .{ .other = tag };
            const cmd = KnownCommand.Map.get(tag[0..first_space_index]) orelse return .{
                .other = tag,
            };

            const number = brk: {
                switch (cmd) {
                    .INSERT => {
                        var remaining = tag[@min(first_space_index + 1, tag.len)..];
                        const second_space = bun.strings.indexOfChar(remaining, ' ') orelse return .{ .other = tag };
                        remaining = remaining[@min(second_space + 1, remaining.len)..];
                        break :brk std.fmt.parseInt(u64, remaining, 0) catch |err| {
                            debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                            return .{ .other = tag };
                        };
                    },
                    else => {
                        const after_tag = tag[@min(first_space_index + 1, tag.len)..];
                        break :brk std.fmt.parseInt(u64, after_tag, 0) catch |err| {
                            debug("CommandTag failed to parse number: {s}", .{@errorName(err)});
                            return .{ .other = tag };
                        };
                    },
                }
            };

            switch (cmd) {
                inline else => |t| return @unionInit(CommandTag, @tagName(t), number),
            }
        }
    };

    pub fn onSuccess(this: *@This(), command_tag_str: []const u8, globalObject: *JSC.JSGlobalObject) void {
        this.status = .success;
        defer this.deref();

        const thisValue = this.thisValue;
        const targetValue = this.target.trySwap() orelse JSValue.zero;
        if (thisValue == .zero or targetValue == .zero) {
            this.pending_value.deinit();
            return;
        }

        const tag = CommandTag.init(command_tag_str);

        const vm = JSC.VirtualMachine.get();
        const function = vm.rareData().postgresql_context.onQueryResolveFn.get().?;
        const event_loop = vm.eventLoop();

        event_loop.runCallback(function, globalObject, thisValue, &.{
            targetValue,
            this.pending_value.trySwap() orelse .undefined,
            tag.toJSTag(globalObject),
            tag.toJSNumber(),
        });
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*PostgresSQLQuery {
        _ = callframe;
        globalThis.throw("PostgresSQLQuery cannot be constructed directly", .{});
        return null;
    }

    pub fn estimatedSize(this: *PostgresSQLQuery) usize {
        _ = this;
        return @sizeOf(PostgresSQLQuery);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        const arguments = callframe.arguments(3).slice();
        const query = arguments[0];
        const values = arguments[1];

        if (!query.isString()) {
            globalThis.throw("query must be a string", .{});
            return .zero;
        }

        if (values.jsType() != .Array) {
            globalThis.throw("values must be an array", .{});
            return .zero;
        }

        const pending_value = arguments[2];
        if (!pending_value.jsType().isArrayLike()) {
            globalThis.throwInvalidArgumentType("query", "pendingValue", "Array");
            return .zero;
        }

        var ptr = bun.default_allocator.create(PostgresSQLQuery) catch |err| {
            globalThis.throwError(err, "failed to allocate query");
            return .zero;
        };

        const this_value = ptr.toJS(globalThis);
        this_value.ensureStillAlive();

        ptr.* = .{
            .query = query.toBunString(globalThis),
            .thisValue = this_value,
        };
        ptr.query.ref();

        PostgresSQLQuery.bindingSetCached(this_value, globalThis, values);
        PostgresSQLQuery.pendingValueSetCached(this_value, globalThis, pending_value);
        ptr.pending_value.set(globalThis, pending_value);

        return this_value;
    }

    pub fn push(this: *PostgresSQLQuery, globalThis: *JSC.JSGlobalObject, value: JSValue) void {
        var pending_value = this.pending_value.get() orelse return;
        pending_value.push(globalThis, value);
    }

    pub fn doDone(this: *@This(), globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        _ = globalObject;
        this.is_done = true;
        return .undefined;
    }

    pub fn doRun(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        var arguments_ = callframe.arguments(2);
        const arguments = arguments_.slice();
        var connection = arguments[0].as(PostgresSQLConnection) orelse {
            globalObject.throw("connection must be a PostgresSQLConnection", .{});
            return .zero;
        };
        var query = arguments[1];

        if (!query.isObject()) {
            globalObject.throwInvalidArgumentType("run", "query", "Query");
            return .zero;
        }

        this.target.set(globalObject, query);
        const binding_value = PostgresSQLQuery.bindingGetCached(callframe.this()) orelse .zero;
        var query_str = this.query.toUTF8(bun.default_allocator);
        defer query_str.deinit();

        var signature = Signature.generate(globalObject, query_str.slice(), binding_value) catch |err| {
            globalObject.throwError(err, "failed to generate signature");
            return .zero;
        };

        var writer = connection.writer();

        const entry = connection.statements.getOrPut(bun.default_allocator, bun.hash(signature.name)) catch |err| {
            globalObject.throwError(err, "failed to allocate statement");
            signature.deinit();
            return .zero;
        };

        const has_params = signature.fields.len > 0;
        var did_write = false;

        enqueue: {
            if (entry.found_existing) {
                this.statement = entry.value_ptr.*;
                this.statement.?.ref();
                signature.deinit();

                if (has_params and this.statement.?.status == .parsing) {
                    // if it has params, we need to wait for ParamDescription to be received before we can write the data
                } else {
                    this.binary = this.statement.?.fields.len > 0;

                    PostgresRequest.bindAndExecute(globalObject, this.statement.?, binding_value, PostgresSQLConnection.Writer, writer) catch |err| {
                        globalObject.throwError(err, "failed to bind and execute query");

                        return .zero;
                    };
                    did_write = true;
                }

                break :enqueue;
            }

            // If it does not have params, we can write and execute immediately in one go
            if (!has_params) {
                PostgresRequest.prepareAndQueryWithSignature(globalObject, query_str.slice(), binding_value, PostgresSQLConnection.Writer, writer, &signature) catch |err| {
                    globalObject.throwError(err, "failed to prepare and query");
                    signature.deinit();
                    return .zero;
                };
                did_write = true;
            } else {
                PostgresRequest.writeQuery(query_str.slice(), signature.name, signature.fields, PostgresSQLConnection.Writer, writer) catch |err| {
                    globalObject.throwError(err, "failed to write query");
                    signature.deinit();
                    return .zero;
                };
                writer.write(&protocol.Sync) catch |err| {
                    globalObject.throwError(err, "failed to flush");
                    signature.deinit();
                    return .zero;
                };
            }

            {
                const stmt = bun.default_allocator.create(PostgresSQLStatement) catch |err| {
                    globalObject.throwError(err, "failed to allocate statement");
                    return .zero;
                };

                stmt.* = .{ .signature = signature, .ref_count = 2, .status = PostgresSQLStatement.Status.parsing };
                this.statement = stmt;
                entry.value_ptr.* = stmt;
            }
        }

        connection.requests.writeItem(this) catch {};
        this.ref();
        this.status = if (did_write) .binding else .pending;

        if (connection.is_ready_for_query)
            connection.flushData();

        return .undefined;
    }

    pub fn doCancel(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        _ = callframe;
        _ = globalObject;
        _ = this;

        return .undefined;
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(call, .{ .name = "PostgresSQLQuery__createInstance" });
        }
    }
};

pub const PostgresRequest = struct {
    pub fn writeBind(
        name: []const u8,
        cursor_name: bun.String,
        globalObject: *JSC.JSGlobalObject,
        values_array: JSValue,
        result_fields: []const protocol.FieldDescription,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !void {
        try writer.write("B");
        const length = try writer.length();

        try writer.String(cursor_name);
        try writer.string(name);

        var iter = JSC.JSArrayIterator.init(values_array, globalObject);

        // The number of parameter format codes that follow (denoted C
        // below). This can be zero to indicate that there are no
        // parameters or that the parameters all use the default format
        // (text); or one, in which case the specified format code is
        // applied to all parameters; or it can equal the actual number
        // of parameters.
        try writer.short(iter.len);

        while (iter.next()) |value| {
            const tag = try types.Tag.fromJS(globalObject, value);

            try writer.short(
                tag.formatCode(),
            );
        }

        // The number of parameter values that follow (possibly zero). This
        // must match the number of parameters needed by the query.
        try writer.short(iter.len);

        iter = JSC.JSArrayIterator.init(values_array, globalObject);

        debug("Bind: {} ({d} args)", .{ bun.fmt.quote(name), iter.len });

        while (iter.next()) |value| {
            if (value.isUndefinedOrNull()) {
                debug("  -> NULL", .{});
                //  As a special case, -1 indicates a
                // NULL parameter value. No value bytes follow in the NULL case.
                try writer.int4(@bitCast(@as(i32, -1)));
                continue;
            }

            const tag = try types.Tag.fromJS(globalObject, value);

            debug("  -> {s}", .{@tagName(tag)});
            switch (tag) {
                .json => {
                    var str = bun.String.empty;
                    defer str.deref();
                    value.jsonStringify(globalObject, 0, &str);
                    const slice = str.toUTF8WithoutRef(bun.default_allocator);
                    defer slice.deinit();
                    const l = try writer.length();
                    try writer.write(slice.slice());
                    try l.writeExcludingSelf();
                },
                .bool => {
                    const l = try writer.length();
                    try writer.bool(value.toBoolean());
                    try l.writeExcludingSelf();
                },
                .time, .timestamp, .timestamptz => {
                    var buf = std.mem.zeroes([28]u8);
                    const str = value.toISOString(globalObject, &buf);
                    const l = try writer.length();
                    try writer.write(str);
                    try l.writeExcludingSelf();
                },
                .bytea => {
                    var bytes: []const u8 = "";
                    if (value.asArrayBuffer(globalObject)) |buf| {
                        bytes = buf.byteSlice();
                    }
                    const l = try writer.length();
                    debug("    {d} bytes", .{bytes.len});

                    try writer.write(bytes);
                    try l.writeExcludingSelf();
                },
                .int4 => {
                    const l = try writer.length();
                    try writer.int4(@bitCast(value.coerceToInt32(globalObject)));
                    try l.writeExcludingSelf();
                },
                .int4_array => {
                    const l = try writer.length();
                    try writer.int4(@bitCast(value.coerceToInt32(globalObject)));
                    try l.writeExcludingSelf();
                },
                .float8 => {
                    const l = try writer.length();
                    try writer.f64(@bitCast(value.coerceToDouble(globalObject)));
                    try l.writeExcludingSelf();
                },
                else => {
                    const str = String.fromJSRef(value, globalObject);
                    defer str.deref();
                    const slice = str.toUTF8WithoutRef(bun.default_allocator);
                    defer slice.deinit();
                    const l = try writer.length();
                    try writer.write(slice.slice());
                    try l.writeExcludingSelf();
                },
            }
        }

        var any_non_text_fields: bool = false;
        for (result_fields) |field| {
            if (field.typeTag().isBinaryFormatSupported()) {
                any_non_text_fields = true;
                break;
            }
        }

        if (any_non_text_fields) {
            try writer.short(result_fields.len);
            for (result_fields) |field| {
                try writer.short(
                    field.typeTag().formatCode(),
                );
            }
        } else {
            try writer.short(0);
        }

        try length.write();
    }

    pub fn writeQuery(
        query: []const u8,
        name: []const u8,
        params: []const int4,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !void {
        {
            var q = protocol.Parse{
                .name = name,
                .params = params,
                .query = query,
            };
            try q.writeInternal(Context, writer);
            debug("Parse: {}", .{bun.fmt.quote(query)});
        }

        {
            var d = protocol.Describe{
                .p = .{
                    .prepared_statement = name,
                },
            };
            try d.writeInternal(Context, writer);
            debug("Describe: {}", .{bun.fmt.quote(name)});
        }
    }

    pub fn prepareAndQueryWithSignature(
        globalObject: *JSC.JSGlobalObject,
        query: []const u8,
        array_value: JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
        signature: *Signature,
    ) !void {
        try writeQuery(query, signature.name, signature.fields, Context, writer);
        try writeBind(signature.name, bun.String.empty, globalObject, array_value, &.{}, Context, writer);
        var exec = protocol.Execute{
            .p = .{
                .prepared_statement = signature.name,
            },
        };
        try exec.writeInternal(Context, writer);

        try writer.write(&protocol.Flush);
        try writer.write(&protocol.Sync);
    }

    pub fn prepareAndQuery(
        globalObject: *JSC.JSGlobalObject,
        query: bun.String,
        array_value: JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !Signature {
        var query_ = query.toUTF8(bun.default_allocator);
        defer query_.deinit();
        var signature = try Signature.generate(globalObject, query_.slice(), array_value);
        errdefer {
            signature.deinit();
        }

        try prepareAndQueryWithSignature(globalObject, query_.slice(), array_value, Context, writer, &signature);

        return signature;
    }

    pub fn bindAndExecute(
        globalObject: *JSC.JSGlobalObject,
        statement: *PostgresSQLStatement,
        array_value: JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !void {
        try writeBind(statement.signature.name, bun.String.empty, globalObject, array_value, statement.fields, Context, writer);
        var exec = protocol.Execute{
            .p = .{
                .prepared_statement = statement.signature.name,
            },
        };
        try exec.writeInternal(Context, writer);

        try writer.write(&protocol.Flush);
        try writer.write(&protocol.Sync);
    }

    pub fn onData(
        connection: *PostgresSQLConnection,
        comptime Context: type,
        reader: protocol.NewReader(Context),
    ) !void {
        while (true) {
            reader.markMessageStart();

            switch (try reader.int(u8)) {
                'D' => try connection.on(.DataRow, Context, reader),
                'd' => try connection.on(.CopyData, Context, reader),
                'S' => try connection.on(.ParameterStatus, Context, reader),
                'Z' => try connection.on(.ReadyForQuery, Context, reader),
                'C' => try connection.on(.CommandComplete, Context, reader),
                '2' => try connection.on(.BindComplete, Context, reader),
                '1' => try connection.on(.ParseComplete, Context, reader),
                't' => try connection.on(.ParameterDescription, Context, reader),
                'T' => try connection.on(.RowDescription, Context, reader),
                'R' => try connection.on(.Authentication, Context, reader),
                'n' => try connection.on(.NoData, Context, reader),
                'K' => try connection.on(.BackendKeyData, Context, reader),
                'E' => try connection.on(.ErrorResponse, Context, reader),
                's' => try connection.on(.PortalSuspended, Context, reader),
                '3' => try connection.on(.CloseComplete, Context, reader),
                'G' => try connection.on(.CopyInResponse, Context, reader),
                'N' => try connection.on(.NoticeResponse, Context, reader),
                'I' => try connection.on(.EmptyQueryResponse, Context, reader),
                'H' => try connection.on(.CopyOutResponse, Context, reader),
                'c' => try connection.on(.CopyDone, Context, reader),
                'W' => try connection.on(.CopyBothResponse, Context, reader),

                else => |c| {
                    debug("Unknown message: {d}", .{c});
                    const to_skip = try reader.length() -| 1;
                    try reader.skip(@intCast(@max(to_skip, 0)));
                },
            }
        }
    }

    pub const Queue = std.fifo.LinearFifo(*PostgresSQLQuery, .Dynamic);
};

pub const PostgresSQLConnection = struct {
    socket: Socket,
    status: Status = Status.connecting,
    ref_count: u32 = 1,

    write_buffer: bun.OffsetByteList = .{},
    read_buffer: bun.OffsetByteList = .{},
    last_message_start: u32 = 0,
    requests: PostgresRequest.Queue,

    poll_ref: bun.Async.KeepAlive = .{},
    globalObject: *JSC.JSGlobalObject,

    statements: PreparedStatementsMap,
    pending_activity_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    js_value: JSValue = JSValue.undefined,

    is_ready_for_query: bool = false,

    backend_parameters: bun.StringMap = bun.StringMap.init(bun.default_allocator, true),
    backend_key_data: protocol.BackendKeyData = .{},

    pending_disconnect: bool = false,

    on_connect: JSC.Strong = .{},
    on_close: JSC.Strong = .{},

    database: []const u8 = "",
    user: []const u8 = "",
    password: []const u8 = "",
    options: []const u8 = "",
    options_buf: []const u8 = "",

    authentication_state: AuthenticationState = .{ .pending = {} },

    pub const AuthenticationState = union(enum) {
        pending: void,
        SASL: SASL,
        ok: void,

        pub fn zero(this: *AuthenticationState) void {
            const bytes = std.mem.asBytes(this);
            @memset(bytes, 0);
        }

        pub const SASL = struct {
            const nonce_byte_len = 18;
            const nonce_base64_len = bun.base64.encodeLenFromSize(nonce_byte_len);

            const server_signature_byte_len = 32;
            const server_signature_base64_len = bun.base64.encodeLenFromSize(server_signature_byte_len);

            const salted_password_byte_len = 32;

            nonce_base64_bytes: [nonce_base64_len]u8 = .{0} ** nonce_base64_len,
            nonce_len: u8 = 0,

            server_signature_base64_bytes: [server_signature_base64_len]u8 = .{0} ** server_signature_base64_len,
            server_signature_len: u8 = 0,

            salted_password_bytes: [salted_password_byte_len]u8 = .{0} ** salted_password_byte_len,
            salted_password_created: bool = false,

            status: SASLStatus = .init,

            pub const SASLStatus = enum {
                init,
                @"continue",
            };

            fn hmac(password: []const u8, data: []const u8) ?[32]u8 {
                var buf = std.mem.zeroes([bun.BoringSSL.EVP_MAX_MD_SIZE]u8);

                // TODO: I don't think this is failable.
                const result = bun.hmac.generate(password, data, .sha256, &buf) orelse return null;

                assert(result.len == 32);
                return buf[0..32].*;
            }

            pub fn computeSaltedPassword(this: *SASL, salt_bytes: []const u8, iteration_count: u32, connection: *PostgresSQLConnection) !void {
                this.salted_password_created = true;
                if (Crypto.EVP.pbkdf2(&this.salted_password_bytes, connection.password, salt_bytes, iteration_count, .sha256) == null) {
                    return error.PBKDF2Failed;
                }
            }

            pub fn saltedPassword(this: *const SASL) []const u8 {
                assert(this.salted_password_created);
                return this.salted_password_bytes[0..salted_password_byte_len];
            }

            pub fn serverSignature(this: *const SASL) []const u8 {
                assert(this.server_signature_len > 0);
                return this.server_signature_base64_bytes[0..this.server_signature_len];
            }

            pub fn computeServerSignature(this: *SASL, auth_string: []const u8) !void {
                assert(this.server_signature_len == 0);

                const server_key = hmac(this.saltedPassword(), "Server Key") orelse return error.InvalidServerKey;
                const server_signature_bytes = hmac(&server_key, auth_string) orelse return error.InvalidServerSignature;
                this.server_signature_len = @intCast(bun.base64.encode(&this.server_signature_base64_bytes, &server_signature_bytes));
            }

            pub fn clientKey(this: *const SASL) [32]u8 {
                return hmac(this.saltedPassword(), "Client Key").?;
            }

            pub fn clientKeySignature(_: *const SASL, client_key: []const u8, auth_string: []const u8) [32]u8 {
                var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
                bun.sha.SHA256.hash(client_key, &sha_digest, JSC.VirtualMachine.get().rareData().boringEngine());
                return hmac(&sha_digest, auth_string).?;
            }

            pub fn nonce(this: *SASL) []const u8 {
                if (this.nonce_len == 0) {
                    var bytes: [nonce_byte_len]u8 = .{0} ** nonce_byte_len;
                    bun.rand(&bytes);
                    this.nonce_len = @intCast(bun.base64.encode(&this.nonce_base64_bytes, &bytes));
                }
                return this.nonce_base64_bytes[0..this.nonce_len];
            }

            pub fn deinit(this: *SASL) void {
                this.nonce_len = 0;
                this.salted_password_created = false;
                this.server_signature_len = 0;
                this.status = .init;
            }
        };
    };

    pub const Status = enum {
        disconnected,
        connecting,
        connected,
        failed,
    };

    pub usingnamespace JSC.Codegen.JSPostgresSQLConnection;

    pub fn hasPendingActivity(this: *PostgresSQLConnection) bool {
        @fence(.acquire);
        return this.pending_activity_count.load(.acquire) > 0;
    }

    fn updateHasPendingActivity(this: *PostgresSQLConnection) void {
        @fence(.release);
        const a: u32 = if (this.requests.readableLength() > 0) 1 else 0;
        const b: u32 = if (this.status != .disconnected) 1 else 0;
        this.pending_activity_count.store(a + b, .release);
    }

    pub fn setStatus(this: *PostgresSQLConnection, status: Status) void {
        defer this.updateHasPendingActivity();

        if (this.status == status) return;

        this.status = status;
        switch (status) {
            .connected => {
                const on_connect = this.on_connect.swap();
                if (on_connect == .zero) return;
                const js_value = this.js_value;
                js_value.ensureStillAlive();
                this.globalObject.queueMicrotask(on_connect, &[_]JSValue{ JSValue.jsNull(), js_value });
                this.poll_ref.unref(this.globalObject.bunVM());
                this.updateHasPendingActivity();
            },
            else => {},
        }
    }

    pub fn finalize(this: *PostgresSQLConnection) void {
        debug("PostgresSQLConnection finalize", .{});
        this.js_value = .zero;
        this.deref();
    }

    pub fn flushData(this: *PostgresSQLConnection) void {
        const chunk = this.write_buffer.remaining();
        if (chunk.len == 0) return;
        const wrote = this.socket.write(chunk, false);
        if (wrote > 0) {
            this.write_buffer.consume(@intCast(wrote));
        }
    }

    pub fn fail(this: *PostgresSQLConnection, message: []const u8, err: anyerror) void {
        defer this.updateHasPendingActivity();
        if (this.status == .failed) return;
        debug("failed: {s}: {s}", .{ message, @errorName(err) });

        this.status = .failed;
        if (!this.socket.isClosed()) this.socket.close();
        const on_close = this.on_close.swap();
        if (on_close == .zero) return;
        const instance = this.globalObject.createErrorInstance("{s}", .{message});
        instance.put(this.globalObject, JSC.ZigString.static("code"), String.init(@errorName(err)).toJS(this.globalObject));
        _ = on_close.call(
            this.globalObject,
            this.js_value,
            &[_]JSValue{
                instance,
            },
        );
    }

    pub fn onClose(this: *PostgresSQLConnection) void {
        var vm = this.globalObject.bunVM();
        defer vm.drainMicrotasks();
        this.fail("Connection closed", error.ConnectionClosed);
    }

    pub fn onOpen(this: *PostgresSQLConnection, socket: uws.AnySocket) void {
        this.socket = socket;

        this.poll_ref.ref(this.globalObject.bunVM());
        this.updateHasPendingActivity();

        var msg = protocol.StartupMessage{ .user = Data{ .temporary = this.user }, .database = Data{ .temporary = this.database }, .options = Data{ .temporary = this.options } };
        msg.writeInternal(Writer, this.writer()) catch |err| {
            socket.close();
            this.fail("Failed to write startup message", err);
        };

        this.flushData();
    }

    pub fn onTimeout(this: *PostgresSQLConnection) void {
        var vm = this.globalObject.bunVM();
        defer vm.drainMicrotasks();
        debug("onTimeout", .{});
    }

    pub fn onDrain(this: *PostgresSQLConnection) void {
        var vm = this.globalObject.bunVM();
        defer vm.drainMicrotasks();
        this.flushData();
    }

    pub fn onData(this: *PostgresSQLConnection, data: []const u8) void {
        var vm = this.globalObject.bunVM();
        defer vm.drainMicrotasks();
        if (this.read_buffer.remaining().len == 0) {
            var consumed: usize = 0;
            var offset: usize = 0;
            const reader = protocol.StackReader.init(data, &consumed, &offset);
            PostgresRequest.onData(this, protocol.StackReader, reader) catch |err| {
                if (err == error.ShortRead) {
                    if (comptime bun.Environment.allow_assert) {
                        // if (@errorReturnTrace()) |trace| {
                        //     debug("Received short read: last_message_start: {d}, head: {d}, len: {d}\n{}", .{
                        //         offset,
                        //         consumed,
                        //         data.len,
                        //         trace,
                        //     });
                        // } else {
                        debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                            offset,
                            consumed,
                            data.len,
                        });
                        // }
                    }

                    this.read_buffer.head = 0;
                    this.last_message_start = 0;
                    this.read_buffer.byte_list.len = 0;
                    this.read_buffer.write(bun.default_allocator, data[offset..]) catch @panic("failed to write to read buffer");
                } else {
                    if (comptime bun.Environment.allow_assert) {
                        if (@errorReturnTrace()) |trace| {
                            debug("Error: {s}\n{}", .{ @errorName(err), trace });
                        }
                    }
                    this.fail("Failed to read data", err);
                }
            };
            return;
        }

        {
            this.read_buffer.head = this.last_message_start;
            this.read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
            PostgresRequest.onData(this, Reader, this.bufferedReader()) catch |err| {
                if (err != error.ShortRead) {
                    if (comptime bun.Environment.allow_assert) {
                        if (@errorReturnTrace()) |trace| {
                            debug("Error: {s}\n{}", .{ @errorName(err), trace });
                        }
                    }
                    this.fail("Failed to read data", err);
                    return;
                }

                if (comptime bun.Environment.allow_assert) {
                    // if (@errorReturnTrace()) |trace| {
                    //     debug("Received short read: last_message_start: {d}, head: {d}, len: {d}\n{}", .{
                    //         this.last_message_start,
                    //         this.read_buffer.head,
                    //         this.read_buffer.byte_list.len,
                    //         trace,
                    //     });
                    // } else {
                    debug("Received short read: last_message_start: {d}, head: {d}, len: {d}", .{
                        this.last_message_start,
                        this.read_buffer.head,
                        this.read_buffer.byte_list.len,
                    });
                    // }
                }

                return;
            };

            this.last_message_start = 0;
            this.read_buffer.head = 0;
        }
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*PostgresSQLConnection {
        _ = callframe;
        globalObject.throw("PostgresSQLConnection cannot be constructed directly", .{});
        return null;
    }

    comptime {
        if (!JSC.is_bindgen) {
            @export(call, .{ .name = "PostgresSQLConnection__createInstance" });
        }
    }

    pub fn call(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
        var vm = globalObject.bunVM();
        const arguments = callframe.arguments(9).slice();
        const hostname_str = arguments[0].toBunString(globalObject);
        defer hostname_str.deref();
        const port = arguments[1].coerce(i32, globalObject);

        const username_str = arguments[2].toBunString(globalObject);
        defer username_str.deref();
        const password_str = arguments[3].toBunString(globalObject);
        defer password_str.deref();
        const database_str = arguments[4].toBunString(globalObject);
        defer database_str.deref();
        const tls_object = arguments[5];
        var username: []const u8 = "";
        var password: []const u8 = "";
        var database: []const u8 = "";
        var options: []const u8 = "";

        const options_str = arguments[6].toBunString(globalObject);
        defer options_str.deref();

        const options_buf: []u8 = brk: {
            var b = bun.StringBuilder{};
            b.cap += username_str.utf8ByteLength() + 1 + password_str.utf8ByteLength() + 1 + database_str.utf8ByteLength() + 1 + options_str.utf8ByteLength() + 1;

            b.allocate(bun.default_allocator) catch {};
            var u = username_str.toUTF8WithoutRef(bun.default_allocator);
            defer u.deinit();
            username = b.append(u.slice());

            var p = password_str.toUTF8WithoutRef(bun.default_allocator);
            defer p.deinit();
            password = b.append(p.slice());

            var d = database_str.toUTF8WithoutRef(bun.default_allocator);
            defer d.deinit();
            database = b.append(d.slice());

            var o = options_str.toUTF8WithoutRef(bun.default_allocator);
            defer o.deinit();
            options = b.append(o.slice());

            break :brk b.allocatedSlice();
        };

        const on_connect = arguments[7];
        const on_close = arguments[8];
        var ptr = bun.default_allocator.create(PostgresSQLConnection) catch |err| {
            globalObject.throwError(err, "failed to allocate connection");
            return .zero;
        };

        ptr.* = PostgresSQLConnection{
            .globalObject = globalObject,
            .on_connect = JSC.Strong.create(on_connect, globalObject),
            .on_close = JSC.Strong.create(on_close, globalObject),
            .database = database,
            .user = username,
            .password = password,
            .options = options,
            .options_buf = options_buf,
            .socket = undefined,
            .requests = PostgresRequest.Queue.init(bun.default_allocator),
            .statements = PreparedStatementsMap{},
        };

        ptr.updateHasPendingActivity();
        ptr.poll_ref.ref(vm);
        const js_value = ptr.toJS(globalObject);
        js_value.ensureStillAlive();
        ptr.js_value = js_value;

        {
            const hostname = hostname_str.toUTF8(bun.default_allocator);
            defer hostname.deinit();
            if (tls_object.isEmptyOrUndefinedOrNull()) {
                const ctx = vm.rareData().postgresql_context.tcp orelse brk: {
                    const ctx_ = uws.us_create_bun_socket_context(0, vm.uwsLoop(), @sizeOf(*PostgresSQLConnection), uws.us_bun_socket_context_options_t{}).?;
                    uws.NewSocketHandler(false).configure(ctx_, true, *PostgresSQLConnection, SocketHandler(false));
                    vm.rareData().postgresql_context.tcp = ctx_;
                    break :brk ctx_;
                };
                ptr.socket = .{
                    .SocketTCP = uws.SocketTCP.connectAnon(hostname.slice(), port, ctx, ptr) catch |err| {
                        globalObject.throwError(err, "failed to connect to postgresql");
                        ptr.deinit();
                        return .zero;
                    },
                };
            } else {
                // TODO:
                globalObject.throwTODO("TLS is not supported yet");
                ptr.deinit();
                return .zero;
            }
        }

        return js_value;
    }

    fn SocketHandler(comptime ssl: bool) type {
        return struct {
            const SocketType = uws.NewSocketHandler(ssl);
            fn _socket(s: SocketType) Socket {
                if (comptime ssl) {
                    return Socket{ .SocketTLS = s };
                }

                return Socket{ .SocketTCP = s };
            }
            pub fn onOpen(this: *PostgresSQLConnection, socket: SocketType) void {
                this.onOpen(_socket(socket));
            }

            pub fn onClose(this: *PostgresSQLConnection, socket: SocketType, _: i32, _: ?*anyopaque) void {
                _ = socket;
                this.onClose();
            }

            pub fn onEnd(this: *PostgresSQLConnection, socket: SocketType) void {
                _ = socket;
                this.onClose();
            }

            pub fn onConnectError(this: *PostgresSQLConnection, socket: SocketType, _: i32) void {
                _ = socket;
                this.onClose();
            }

            pub fn onTimeout(this: *PostgresSQLConnection, socket: SocketType) void {
                _ = socket;
                this.onTimeout();
            }

            pub fn onData(this: *PostgresSQLConnection, socket: SocketType, data: []const u8) void {
                _ = socket;
                this.onData(data);
            }

            pub fn onWritable(this: *PostgresSQLConnection, socket: SocketType) void {
                _ = socket;
                this.onDrain();
            }
        };
    }

    pub fn ref(this: *@This()) void {
        bun.assert(this.ref_count > 0);
        this.ref_count += 1;
    }

    pub fn doRef(this: *@This(), _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        this.poll_ref.ref(this.globalObject.bunVM());
        this.updateHasPendingActivity();
        return .undefined;
    }

    pub fn doUnref(this: *@This(), _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        this.poll_ref.unref(this.globalObject.bunVM());
        this.updateHasPendingActivity();
        return .undefined;
    }

    pub fn deref(this: *@This()) void {
        const ref_count = this.ref_count;
        this.ref_count -= 1;

        if (ref_count == 1) {
            this.disconnect();
            this.deinit();
        }
    }

    pub fn doClose(this: *@This(), globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        _ = globalObject;
        this.disconnect();
        this.write_buffer.deinit(bun.default_allocator);

        return .undefined;
    }

    pub fn deinit(this: *@This()) void {
        var iter = this.statements.valueIterator();
        while (iter.next()) |stmt_ptr| {
            var stmt = stmt_ptr.*;
            stmt.deref();
        }
        this.statements.deinit(bun.default_allocator);
        this.write_buffer.deinit(bun.default_allocator);
        this.read_buffer.deinit(bun.default_allocator);
        this.on_close.deinit();
        this.on_connect.deinit();
        this.backend_parameters.deinit();
        bun.default_allocator.free(this.options_buf);
        bun.default_allocator.destroy(this);
    }

    pub fn disconnect(this: *@This()) void {
        if (this.status == .connected) {
            this.status = .disconnected;
            this.poll_ref.disable();
            this.socket.close();
        }
    }

    fn current(this: *PostgresSQLConnection) ?*PostgresSQLQuery {
        if (this.requests.readableLength() == 0) {
            return null;
        }

        return this.requests.peekItem(0);
    }

    pub const Writer = struct {
        connection: *PostgresSQLConnection,

        pub fn write(this: Writer, data: []const u8) anyerror!void {
            var buffer = &this.connection.write_buffer;
            try buffer.write(bun.default_allocator, data);
        }

        pub fn pwrite(this: Writer, data: []const u8, index: usize) anyerror!void {
            @memcpy(this.connection.write_buffer.byte_list.slice()[index..][0..data.len], data);
        }

        pub fn offset(this: Writer) usize {
            return this.connection.write_buffer.len();
        }
    };

    pub fn writer(this: *PostgresSQLConnection) protocol.NewWriter(Writer) {
        return .{
            .wrapped = .{
                .connection = this,
            },
        };
    }

    pub const Reader = struct {
        connection: *PostgresSQLConnection,

        pub fn markMessageStart(this: Reader) void {
            this.connection.last_message_start = this.connection.read_buffer.head;
        }

        pub const ensureLength = ensureCapacity;

        pub fn peek(this: Reader) []const u8 {
            return this.connection.read_buffer.remaining();
        }
        pub fn skip(this: Reader, count: usize) void {
            this.connection.read_buffer.head = @min(this.connection.read_buffer.head + @as(u32, @truncate(count)), this.connection.read_buffer.byte_list.len);
        }
        pub fn ensureCapacity(this: Reader, count: usize) bool {
            return @as(usize, this.connection.read_buffer.head) + count <= @as(usize, this.connection.read_buffer.byte_list.len);
        }
        pub fn read(this: Reader, count: usize) anyerror!Data {
            var remaining = this.connection.read_buffer.remaining();
            if (@as(usize, remaining.len) < count) {
                return error.ShortRead;
            }

            this.skip(count);
            return Data{
                .temporary = remaining[0..count],
            };
        }
        pub fn readZ(this: Reader) anyerror!Data {
            const remain = this.connection.read_buffer.remaining();

            if (bun.strings.indexOfChar(remain, 0)) |zero| {
                this.skip(zero + 1);
                return Data{
                    .temporary = remain[0..zero],
                };
            }

            return error.ShortRead;
        }
    };

    pub fn bufferedReader(this: *PostgresSQLConnection) protocol.NewReader(Reader) {
        return .{
            .wrapped = .{ .connection = this },
        };
    }

    pub const DataCell = extern struct {
        tag: Tag,

        value: Value,
        free_value: u8 = 0,

        pub const Tag = enum(u8) {
            null = 0,
            string = 1,
            float8 = 2,
            int4 = 3,
            int8 = 4,
            bool = 5,
            date = 6,
            bytea = 7,
            json = 8,
            array = 9,
            typed_array = 10,
        };

        pub const Value = extern union {
            null: u8,
            string: bun.WTF.StringImpl,
            float8: f64,
            int4: i32,
            int8: i64,
            bool: u8,
            date: f64,
            bytea: [2]usize,
            json: bun.WTF.StringImpl,
            array: Array,
            typed_array: TypedArray,
        };

        pub const Array = extern struct {
            ptr: ?[*]DataCell = null,
            len: u32,

            pub fn slice(this: *Array) []DataCell {
                const ptr = this.ptr orelse return &.{};
                return ptr[0..this.len];
            }
        };
        pub const TypedArray = extern struct {
            head_ptr: ?[*]u8 = null,
            ptr: ?[*]u8 = null,
            len: u32,
            byte_len: u32,
            type: JSValue.JSType,

            pub fn slice(this: *TypedArray) []u8 {
                const ptr = this.ptr orelse return &.{};
                return ptr[0..this.len];
            }

            pub fn byteSlice(this: *TypedArray) []u8 {
                const ptr = this.head_ptr orelse return &.{};
                return ptr[0..this.len];
            }
        };

        pub fn deinit(this: *DataCell) void {
            if (this.free_value == 0) return;

            switch (this.tag) {
                .string => {
                    this.value.string.deref();
                },
                .json => {
                    this.value.json.deref();
                },
                .bytea => {
                    if (this.value.bytea[1] == 0) return;
                    const slice = @as([*]u8, @ptrFromInt(this.value.bytea[0]))[0..this.value.bytea[1]];
                    bun.default_allocator.free(slice);
                },
                .array => {
                    for (this.value.array.slice()) |*cell| {
                        cell.deinit();
                    }
                    bun.default_allocator.free(this.value.array.slice());
                },
                .typed_array => {
                    bun.default_allocator.free(this.value.typed_array.byteSlice());
                },

                else => {},
            }
        }

        pub fn fromBytes(binary: bool, oid: int4, bytes: []const u8, globalObject: *JSC.JSGlobalObject) anyerror!DataCell {
            switch (@as(types.Tag, @enumFromInt(@as(short, @intCast(oid))))) {
                // TODO: .int2_array, .float8_array
                inline .int4_array, .float4_array => |tag| {
                    if (binary) {
                        if (bytes.len < 16) {
                            return error.InvalidBinaryData;
                        }
                        // https://github.com/postgres/postgres/blob/master/src/backend/utils/adt/arrayfuncs.c#L1549-L1645
                        const dimensions_raw: int4 = @bitCast(bytes[0..4].*);
                        const contains_nulls: int4 = @bitCast(bytes[4..8].*);

                        const dimensions = @byteSwap(dimensions_raw);
                        if (dimensions > 1) {
                            return error.MultidimensionalArrayNotSupportedYet;
                        }

                        if (contains_nulls != 0) {
                            return error.NullsInArrayNotSupportedYet;
                        }

                        if (dimensions == 0) {
                            return DataCell{
                                .tag = .typed_array,
                                .value = .{
                                    .typed_array = .{
                                        .ptr = null,
                                        .len = 0,
                                        .byte_len = 0,
                                        .type = tag.toJSTypedArrayType(),
                                    },
                                },
                            };
                        }

                        const elements = tag.pgArrayType().init(bytes).slice();

                        return DataCell{
                            .tag = .typed_array,
                            .value = .{
                                .typed_array = .{
                                    .head_ptr = if (bytes.len > 0) @constCast(bytes.ptr) else null,
                                    .ptr = if (elements.len > 0) @ptrCast(elements.ptr) else null,
                                    .len = @truncate(elements.len),
                                    .byte_len = @truncate(bytes.len),
                                    .type = tag.toJSTypedArrayType(),
                                },
                            },
                        };
                    } else {
                        // TODO:
                        return fromBytes(false, @intFromEnum(types.Tag.bytea), bytes, globalObject);
                    }
                },
                .int4 => {
                    if (binary) {
                        return DataCell{ .tag = .int4, .value = .{ .int4 = try parseBinary(.int4, i32, bytes) } };
                    } else {
                        return DataCell{ .tag = .int4, .value = .{ .int4 = bun.fmt.parseInt(i32, bytes, 0) catch 0 } };
                    }
                },
                .float8 => {
                    if (binary and bytes.len == 8) {
                        return DataCell{ .tag = .float8, .value = .{ .float8 = try parseBinary(.float8, f64, bytes) } };
                    } else {
                        const float8: f64 = bun.parseDouble(bytes) catch std.math.nan(f64);
                        return DataCell{ .tag = .float8, .value = .{ .float8 = float8 } };
                    }
                },
                .float4 => {
                    if (binary and bytes.len == 4) {
                        return DataCell{ .tag = .float8, .value = .{ .float8 = try parseBinary(.float4, f32, bytes) } };
                    } else {
                        const float4: f64 = bun.parseDouble(bytes) catch std.math.nan(f64);
                        return DataCell{ .tag = .float8, .value = .{ .float8 = float4 } };
                    }
                },
                .json => {
                    return DataCell{ .tag = .json, .value = .{ .json = String.createUTF8(bytes).value.WTFStringImpl }, .free_value = 1 };
                },
                .bool => {
                    return DataCell{ .tag = .bool, .value = .{ .bool = @intFromBool(bytes.len > 0 and bytes[0] == 't') } };
                },
                .time, .timestamp, .timestamptz => {
                    var str = bun.String.init(bytes);
                    defer str.deref();
                    return DataCell{ .tag = .date, .value = .{ .date = str.parseDate(globalObject) } };
                },
                .bytea => {
                    if (binary) {
                        return DataCell{ .tag = .bytea, .value = .{ .bytea = .{ @intFromPtr(bytes.ptr), bytes.len } } };
                    } else {
                        if (bun.strings.hasPrefixComptime(bytes, "\\x")) {
                            const hex = bytes[2..];
                            const len = hex.len / 2;
                            const buf = try bun.default_allocator.alloc(u8, len);
                            errdefer bun.default_allocator.free(buf);

                            return DataCell{
                                .tag = .bytea,
                                .value = .{
                                    .bytea = .{
                                        @intFromPtr(buf.ptr),
                                        try bun.strings.decodeHexToBytes(buf, u8, hex),
                                    },
                                },
                                .free_value = 1,
                            };
                        } else {
                            return error.UnsupportedByteaFormat;
                        }
                    }
                },
                else => {
                    return DataCell{ .tag = .string, .value = .{ .string = bun.String.createUTF8(bytes).value.WTFStringImpl }, .free_value = 1 };
                },
            }
        }

        // #define pg_hton16(x)		(x)
        // #define pg_hton32(x)		(x)
        // #define pg_hton64(x)		(x)

        // #define pg_ntoh16(x)		(x)
        // #define pg_ntoh32(x)		(x)
        // #define pg_ntoh64(x)		(x)

        fn pg_ntoT(comptime IntSize: usize, i: anytype) std.meta.Int(.unsigned, IntSize) {
            @setRuntimeSafety(false);
            const T = @TypeOf(i);
            if (@typeInfo(T) == .Array) {
                return pg_ntoT(IntSize, @as(std.meta.Int(.unsigned, IntSize), @bitCast(i)));
            }

            const casted: std.meta.Int(.unsigned, IntSize) = @intCast(i);
            return @byteSwap(casted);
        }
        fn pg_ntoh16(x: anytype) u16 {
            return pg_ntoT(16, x);
        }

        fn pg_ntoh32(x: anytype) u32 {
            return pg_ntoT(32, x);
        }

        pub fn parseBinary(comptime tag: types.Tag, comptime ReturnType: type, bytes: []const u8) anyerror!ReturnType {
            switch (comptime tag) {
                .float8 => {
                    return @as(f64, @bitCast(try parseBinary(.int8, i64, bytes)));
                },
                .int8 => {
                    // pq_getmsgfloat8
                    if (bytes.len != 8) return error.InvalidBinaryData;
                    return @byteSwap(@as(i64, @bitCast(bytes[0..8].*)));
                },
                .int4 => {
                    // pq_getmsgint
                    switch (bytes.len) {
                        1 => {
                            return bytes[0];
                        },
                        2 => {
                            return pg_ntoh16(@as(u16, @bitCast(bytes[0..2].*)));
                        },
                        4 => {
                            return @bitCast(pg_ntoh32(@as(u32, @bitCast(bytes[0..4].*))));
                        },
                        else => {
                            return error.UnsupportedIntegerSize;
                        },
                    }
                },
                .int2 => {
                    // pq_getmsgint
                    switch (bytes.len) {
                        1 => {
                            return bytes[0];
                        },
                        2 => {
                            return pg_ntoh16(@as(u16, @bitCast(bytes[0..2].*)));
                        },
                        else => {
                            return error.UnsupportedIntegerSize;
                        },
                    }
                },
                .float4 => {
                    // pq_getmsgfloat4
                    return @as(f32, @bitCast(try parseBinary(.int4, i32, bytes)));
                },
                else => @compileError("TODO"),
            }
        }

        pub const Putter = struct {
            list: []DataCell,
            fields: []const protocol.FieldDescription,
            binary: bool = false,
            count: usize = 0,
            globalObject: *JSC.JSGlobalObject,

            extern fn JSC__constructObjectFromDataCell(*JSC.JSGlobalObject, JSValue, JSValue, [*]DataCell, u32) JSValue;
            pub fn toJS(this: *Putter, globalObject: *JSC.JSGlobalObject, array: JSValue, structure: JSValue) JSValue {
                return JSC__constructObjectFromDataCell(globalObject, array, structure, this.list.ptr, @truncate(this.fields.len));
            }

            pub fn put(this: *Putter, index: u32, optional_bytes: ?*Data) anyerror!bool {
                const oid = this.fields[index].type_oid;
                debug("index: {d}, oid: {d}", .{ index, oid });

                this.list[index] = if (optional_bytes) |data|
                    try DataCell.fromBytes(this.binary, oid, data.slice(), this.globalObject)
                else
                    DataCell{
                        .tag = .null,
                        .value = .{
                            .null = 0,
                        },
                    };
                this.count += 1;
                return true;
            }
        };
    };

    fn advance(this: *PostgresSQLConnection) !bool {
        defer this.updateRef();
        var any = false;

        while (this.requests.readableLength() > 0) {
            var req: *PostgresSQLQuery = this.requests.peekItem(0);
            switch (req.status) {
                .pending => {
                    const stmt = req.statement orelse return error.ExpectedStatement;
                    if (stmt.status == .failed) {
                        req.onError(stmt.error_response, this.globalObject);
                        this.requests.discard(1);
                        any = true;
                    } else {
                        break;
                    }
                },
                .success, .fail => {
                    this.requests.discard(1);
                    req.deref();
                    any = true;
                },
                else => break,
            }
        }

        while (this.requests.readableLength() > 0) {
            var req: *PostgresSQLQuery = this.requests.peekItem(0);
            const stmt = req.statement orelse return error.ExpectedStatement;

            switch (stmt.status) {
                .prepared => {
                    if (req.status == .pending and stmt.status == .prepared) {
                        const binding_value = PostgresSQLQuery.bindingGetCached(req.thisValue) orelse .zero;
                        PostgresRequest.bindAndExecute(this.globalObject, stmt, binding_value, PostgresSQLConnection.Writer, this.writer()) catch |err| {
                            req.onWriteFail(err, this.globalObject);
                            req.deref();
                            this.requests.discard(1);
                            continue;
                        };
                        req.status = .binding;
                        req.binary = stmt.fields.len > 0;
                        any = true;
                    } else {
                        break;
                    }
                },
                else => break,
            }
        }

        return any;
    }

    pub fn on(this: *PostgresSQLConnection, comptime MessageType: @Type(.EnumLiteral), comptime Context: type, reader: protocol.NewReader(Context)) !void {
        debug("on({s})", .{@tagName(MessageType)});
        if (comptime MessageType != .ReadyForQuery) {
            this.is_ready_for_query = false;
        }

        switch (comptime MessageType) {
            .DataRow => {
                const request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;

                var putter = DataCell.Putter{
                    .list = &.{},
                    .fields = statement.fields,
                    .binary = request.binary,
                    .globalObject = this.globalObject,
                };

                var stack_buf: [64]DataCell = undefined;
                var cells: []DataCell = stack_buf[0..@min(statement.fields.len, stack_buf.len)];
                defer {
                    for (cells[0..putter.count]) |*cell| {
                        cell.deinit();
                    }
                }

                var free_cells = false;
                defer if (free_cells) bun.default_allocator.free(cells);
                if (statement.fields.len >= 64) {
                    cells = try bun.default_allocator.alloc(DataCell, statement.fields.len);
                    free_cells = true;
                }
                putter.list = cells;

                try protocol.DataRow.decode(
                    &putter,
                    Context,
                    reader,
                    DataCell.Putter.put,
                );

                const pending_value = PostgresSQLQuery.pendingValueGetCached(request.thisValue) orelse .zero;
                pending_value.ensureStillAlive();
                const result = putter.toJS(this.globalObject, pending_value, statement.structure(this.js_value, this.globalObject));

                if (pending_value == .zero) {
                    PostgresSQLQuery.pendingValueSetCached(request.thisValue, this.globalObject, result);
                }
            },
            .CopyData => {
                var copy_data: protocol.CopyData = undefined;
                try copy_data.decodeInternal(Context, reader);
                copy_data.data.deinit();
            },
            .ParameterStatus => {
                var parameter_status: protocol.ParameterStatus = undefined;
                try parameter_status.decodeInternal(Context, reader);
                defer {
                    parameter_status.deinit();
                }
                try this.backend_parameters.insert(parameter_status.name.slice(), parameter_status.value.slice());
            },
            .ReadyForQuery => {
                var ready_for_query: protocol.ReadyForQuery = undefined;
                try ready_for_query.decodeInternal(Context, reader);

                if (this.pending_disconnect) {
                    this.disconnect();
                    return;
                }

                this.setStatus(.connected);
                this.is_ready_for_query = true;
                this.socket.setTimeout(300);

                if (try this.advance() or this.is_ready_for_query) {
                    this.flushData();
                }
            },
            .CommandComplete => {
                var request = this.current() orelse return error.ExpectedRequest;

                var cmd: protocol.CommandComplete = undefined;
                try cmd.decodeInternal(Context, reader);
                defer {
                    cmd.deinit();
                }
                debug("-> {s}", .{cmd.command_tag.slice()});
                _ = this.requests.discard(1);
                defer this.updateRef();
                request.onSuccess(cmd.command_tag.slice(), this.globalObject);
            },
            .BindComplete => {
                try reader.eatMessage(protocol.BindComplete);
                var request = this.current() orelse return error.ExpectedRequest;
                if (request.status == .binding) {
                    request.status = .running;
                }
            },
            .ParseComplete => {
                try reader.eatMessage(protocol.ParseComplete);
                const request = this.current() orelse return error.ExpectedRequest;
                if (request.statement) |statement| {
                    if (statement.status == .parsing) {
                        statement.status = .prepared;
                    }
                }
            },
            .ParameterDescription => {
                var description: protocol.ParameterDescription = undefined;
                try description.decodeInternal(Context, reader);
                const request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;
                statement.parameters = description.parameters;
            },
            .RowDescription => {
                var description: protocol.RowDescription = undefined;
                try description.decodeInternal(Context, reader);
                errdefer description.deinit();
                const request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;
                statement.fields = description.fields;
            },
            .Authentication => {
                var auth: protocol.Authentication = undefined;
                try auth.decodeInternal(Context, reader);
                defer auth.deinit();

                switch (auth) {
                    .SASL => {
                        if (this.authentication_state != .SASL) {
                            this.authentication_state = .{ .SASL = .{} };
                        }

                        var mechanism_buf: [128]u8 = undefined;
                        const mechanism = std.fmt.bufPrintZ(&mechanism_buf, "n,,n=*,r={s}", .{this.authentication_state.SASL.nonce()}) catch unreachable;
                        var response = protocol.SASLInitialResponse{
                            .mechanism = .{
                                .temporary = "SCRAM-SHA-256",
                            },
                            .data = .{
                                .temporary = mechanism,
                            },
                        };

                        try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                        debug("SASL", .{});
                        this.flushData();
                    },
                    .SASLContinue => |*cont| {
                        if (this.authentication_state != .SASL) {
                            debug("Unexpected SASLContinue for authentiation state: {s}", .{@tagName(std.meta.activeTag(this.authentication_state))});
                            return error.UnexpectedMessage;
                        }
                        var sasl = &this.authentication_state.SASL;

                        if (sasl.status != .init) {
                            debug("Unexpected SASLContinue for SASL state: {s}", .{@tagName(sasl.status)});
                            return error.UnexpectedMessage;
                        }
                        debug("SASLContinue", .{});

                        const iteration_count = try cont.iterationCount();

                        const server_salt_decoded_base64 = try bun.base64.decodeAlloc(bun.z_allocator, cont.s);
                        defer bun.z_allocator.free(server_salt_decoded_base64);
                        try sasl.computeSaltedPassword(server_salt_decoded_base64, iteration_count, this);

                        const auth_string = try std.fmt.allocPrint(
                            bun.z_allocator,
                            "n=*,r={s},r={s},s={s},i={s},c=biws,r={s}",
                            .{
                                sasl.nonce(),
                                cont.r,
                                cont.s,
                                cont.i,
                                cont.r,
                            },
                        );
                        defer bun.z_allocator.free(auth_string);
                        try sasl.computeServerSignature(auth_string);

                        const client_key = sasl.clientKey();
                        const client_key_signature = sasl.clientKeySignature(&client_key, auth_string);
                        var client_key_xor_buffer: [32]u8 = undefined;
                        for (&client_key_xor_buffer, client_key, client_key_signature) |*out, a, b| {
                            out.* = a ^ b;
                        }

                        var client_key_xor_base64_buf = std.mem.zeroes([bun.base64.encodeLenFromSize(32)]u8);
                        const xor_base64_len = bun.base64.encode(&client_key_xor_base64_buf, &client_key_xor_buffer);

                        const payload = try std.fmt.allocPrint(
                            bun.z_allocator,
                            "c=biws,r={s},p={s}",
                            .{ cont.r, client_key_xor_base64_buf[0..xor_base64_len] },
                        );
                        defer bun.z_allocator.free(payload);

                        var response = protocol.SASLResponse{
                            .data = .{
                                .temporary = payload,
                            },
                        };

                        try response.writeInternal(PostgresSQLConnection.Writer, this.writer());
                        sasl.status = .@"continue";
                        this.flushData();
                    },
                    .SASLFinal => |final| {
                        if (this.authentication_state != .SASL) {
                            debug("SASLFinal - Unexpected SASLContinue for authentiation state: {s}", .{@tagName(std.meta.activeTag(this.authentication_state))});
                            return error.UnexpectedMessage;
                        }
                        var sasl = &this.authentication_state.SASL;

                        if (sasl.status != .@"continue") {
                            debug("SASLFinal - Unexpected SASLContinue for SASL state: {s}", .{@tagName(sasl.status)});
                            return error.UnexpectedMessage;
                        }

                        if (sasl.server_signature_len == 0) {
                            debug("SASLFinal - Server signature is empty", .{});
                            return error.UnexpectedMessage;
                        }

                        const server_signature = sasl.serverSignature();

                        // This will usually start with "v="
                        const comparison_signature = final.data.slice();

                        if (comparison_signature.len < 2 or !bun.strings.eqlLong(server_signature, comparison_signature[2..], true)) {
                            debug("SASLFinal - SASL Server signature mismatch\nExpected: {s}\nActual: {s}", .{ server_signature, comparison_signature[2..] });
                            this.fail("The server did not return the correct signature", error.SASL_SIGNATURE_MISMATCH);
                        } else {
                            debug("SASLFinal - SASL Server signature match", .{});
                            this.authentication_state.zero();
                        }
                    },
                    .Ok => {
                        debug("Authentication OK", .{});
                        this.authentication_state.zero();
                        this.authentication_state = .{ .ok = {} };
                    },

                    .Unknown => {
                        this.fail("Unknown authentication method", error.UNKNOWN_AUTHENTICATION_METHOD);
                    },

                    else => {
                        debug("TODO auth: {s}", .{@tagName(std.meta.activeTag(auth))});
                    },
                }
            },
            .NoData => {
                try reader.eatMessage(protocol.NoData);
                var request = this.current() orelse return error.ExpectedRequest;
                if (request.status == .binding) {
                    request.status = .running;
                }
            },
            .BackendKeyData => {
                try this.backend_key_data.decodeInternal(Context, reader);
            },
            .ErrorResponse => {
                var err: protocol.ErrorResponse = undefined;
                try err.decodeInternal(Context, reader);

                if (this.status == .connecting) {
                    this.status = .failed;
                    defer {
                        err.deinit();
                        this.poll_ref.unref(this.globalObject.bunVM());
                        this.updateHasPendingActivity();
                    }

                    const on_connect = this.on_connect.swap();
                    if (on_connect == .zero) return;
                    const js_value = this.js_value;
                    js_value.ensureStillAlive();
                    this.globalObject.queueMicrotask(on_connect, &[_]JSValue{ err.toJS(this.globalObject), js_value });

                    // it shouldn't enqueue any requests while connecting
                    bun.assert(this.requests.count == 0);
                    return;
                }

                var request = this.current() orelse {
                    debug("ErrorResponse: {}", .{err});
                    return error.ExpectedRequest;
                };
                var is_error_owned = true;
                defer {
                    if (is_error_owned) {
                        err.deinit();
                    }
                }
                if (request.statement) |stmt| {
                    if (stmt.status == PostgresSQLStatement.Status.parsing) {
                        stmt.status = PostgresSQLStatement.Status.failed;
                        stmt.error_response = err;
                        is_error_owned = false;
                        if (this.statements.remove(bun.hash(stmt.signature.name))) {
                            stmt.deref();
                        }
                    }
                }
                _ = this.requests.discard(1);
                this.updateRef();

                request.onError(err, this.globalObject);
            },
            .PortalSuspended => {
                // try reader.eatMessage(&protocol.PortalSuspended);
                // var request = this.current() orelse return error.ExpectedRequest;
                // _ = request;
                // _ = this.requests.discard(1);
                debug("TODO PortalSuspended", .{});
            },
            .CloseComplete => {
                try reader.eatMessage(protocol.CloseComplete);
                var request = this.current() orelse return error.ExpectedRequest;
                _ = this.requests.discard(1);
                request.onSuccess("CLOSECOMPLETE", this.globalObject);
            },
            .CopyInResponse => {
                debug("TODO CopyInResponse", .{});
            },
            .NoticeResponse => {
                debug("UNSUPPORTED NoticeResponse", .{});
                var resp: protocol.NoticeResponse = undefined;

                try resp.decodeInternal(Context, reader);
                resp.deinit();
            },
            .EmptyQueryResponse => {
                try reader.eatMessage(protocol.EmptyQueryResponse);
                var request = this.current() orelse return error.ExpectedRequest;
                _ = this.requests.discard(1);
                this.updateRef();
                request.onSuccess("", this.globalObject);
            },
            .CopyOutResponse => {
                debug("TODO CopyOutResponse", .{});
            },
            .CopyDone => {
                debug("TODO CopyDone", .{});
            },
            .CopyBothResponse => {
                debug("TODO CopyBothResponse", .{});
            },
            else => @compileError("Unknown message type: " ++ @tagName(MessageType)),
        }
    }

    pub fn updateRef(this: *PostgresSQLConnection) void {
        this.updateHasPendingActivity();
        if (this.pending_activity_count.raw > 0) {
            this.poll_ref.ref(this.globalObject.bunVM());
        } else {
            this.poll_ref.unref(this.globalObject.bunVM());
        }
    }

    pub fn doFlush(this: *PostgresSQLConnection, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        _ = callframe;
        _ = globalObject;
        _ = this;

        return .undefined;
    }

    pub fn createQuery(this: *PostgresSQLConnection, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        _ = callframe;
        _ = globalObject;
        _ = this;

        return .undefined;
    }

    pub fn getConnected(this: *PostgresSQLConnection, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsBoolean(this.status == Status.connected);
    }
};

pub const PostgresSQLStatement = struct {
    cached_structure: JSC.Strong = .{},
    ref_count: u32 = 1,
    fields: []const protocol.FieldDescription = &[_]protocol.FieldDescription{},
    parameters: []const int4 = &[_]int4{},
    signature: Signature,
    status: Status = Status.parsing,
    error_response: protocol.ErrorResponse = .{},

    pub const Status = enum {
        parsing,
        prepared,
        failed,
    };
    pub fn ref(this: *@This()) void {
        bun.assert(this.ref_count > 0);
        this.ref_count += 1;
    }

    pub fn deref(this: *@This()) void {
        const ref_count = this.ref_count;
        this.ref_count -= 1;

        if (ref_count == 1) {
            this.deinit();
        }
    }

    pub fn deinit(this: *PostgresSQLStatement) void {
        debug("PostgresSQLStatement deinit", .{});

        bun.assert(this.ref_count == 0);

        for (this.fields) |*field| {
            @constCast(field).deinit();
        }
        bun.default_allocator.free(this.fields);
        bun.default_allocator.free(this.parameters);
        this.cached_structure.deinit();
        this.error_response.deinit();
        this.signature.deinit();
        bun.default_allocator.destroy(this);
    }

    pub fn structure(this: *PostgresSQLStatement, owner: JSValue, globalObject: *JSC.JSGlobalObject) JSValue {
        return this.cached_structure.get() orelse {
            const names = bun.default_allocator.alloc(bun.String, this.fields.len) catch return .undefined;
            defer {
                for (names) |*name| {
                    name.deref();
                }
                bun.default_allocator.free(names);
            }
            for (this.fields, names) |*field, *name| {
                name.* = String.fromUTF8(field.name.slice());
            }
            const structure_ = JSC.JSObject.createStructure(
                globalObject,
                owner,
                @truncate(this.fields.len),
                names.ptr,
            );
            this.cached_structure.set(globalObject, structure_);
            return structure_;
        };
    }
};

const Signature = struct {
    fields: []const int4,
    name: []const u8,
    query: []const u8,

    pub fn deinit(this: *Signature) void {
        bun.default_allocator.free(this.fields);
        bun.default_allocator.free(this.name);
        bun.default_allocator.free(this.query);
    }

    pub fn hash(this: *const Signature) u64 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(this.name);
        hasher.update(std.mem.sliceAsBytes(this.fields));
        return hasher.final();
    }

    pub fn generate(globalObject: *JSC.JSGlobalObject, query: []const u8, array_value: JSValue) !Signature {
        var fields = std.ArrayList(int4).init(bun.default_allocator);
        var name = try std.ArrayList(u8).initCapacity(bun.default_allocator, query.len);

        name.appendSliceAssumeCapacity(query);

        errdefer {
            fields.deinit();
            name.deinit();
        }

        var iter = JSC.JSArrayIterator.init(array_value, globalObject);

        while (iter.next()) |value| {
            if (value.isUndefinedOrNull()) {
                try fields.append(0);
                try name.appendSlice(".null");
                continue;
            }

            const tag = try types.Tag.fromJS(globalObject, value);
            try fields.append(@intFromEnum(tag));

            switch (tag) {
                .int8 => try name.appendSlice(".int8"),
                .int4 => try name.appendSlice(".int4"),
                // .int4_array => try name.appendSlice(".int4_array"),
                .int2 => try name.appendSlice(".int2"),
                .float8 => try name.appendSlice(".float8"),
                .float4 => try name.appendSlice(".float4"),
                .numeric => try name.appendSlice(".numeric"),
                .json => try name.appendSlice(".json"),
                .bool => try name.appendSlice(".bool"),
                .timestamp => try name.appendSlice(".timestamp"),
                .timestamptz => try name.appendSlice(".timestamptz"),
                .time => try name.appendSlice(".time"),
                .bytea => try name.appendSlice(".bytea"),
                else => try name.appendSlice(".string"),
            }
        }

        return Signature{
            .name = name.items,
            .fields = fields.items,
            .query = try bun.default_allocator.dupe(u8, query),
        };
    }
};

pub fn createBinding(globalObject: *JSC.JSGlobalObject) JSValue {
    const binding = JSValue.createEmptyObjectWithNullPrototype(globalObject);
    binding.put(globalObject, ZigString.static("PostgresSQLConnection"), PostgresSQLConnection.getConstructor(globalObject));
    binding.put(globalObject, ZigString.static("init"), JSC.JSFunction.create(globalObject, "init", PostgresSQLContext.init, 0, .{}));
    binding.put(
        globalObject,
        ZigString.static("createQuery"),
        JSC.JSFunction.create(globalObject, "createQuery", PostgresSQLQuery.call, 2, .{}),
    );

    binding.put(
        globalObject,
        ZigString.static("createConnection"),
        JSC.JSFunction.create(globalObject, "createQuery", PostgresSQLConnection.call, 2, .{}),
    );

    return binding;
}

const ZigString = JSC.ZigString;

const assert = bun.assert;
