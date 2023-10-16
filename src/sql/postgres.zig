const bun = @import("root").bun;
const JSC = bun.JSC;
const String = bun.String;
const uws = bun.uws;
const std = @import("std");
const debug = bun.Output.scoped(.Postgres, false);
const int32 = u32;
const PostgresInt32 = int32;
const short = u16;
const PostgresShort = u16;
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

    pub fn slice(this: @This()) []const u8 {
        return switch (this) {
            .owned => this.owned.slice(),
            .temporary => this.temporary,
            .empty => "",
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
            };

            pub inline fn length(this: @This()) anyerror!LengthWriter {
                const i = this.offset();
                try this.int32(0);
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

            pub fn int32(this: @This(), value: PostgresInt32) !void {
                try this.write(std.mem.asBytes(&@byteSwap(value)));
            }

            pub fn @"f64"(this: @This(), value: f64) !void {
                try this.write(std.mem.asBytes(&@byteSwap(@as(u64, @bitCast(value)))));
            }

            pub fn short(this: @This(), value: PostgresShort) !void {
                try this.write(std.mem.asBytes(&@byteSwap(value)));
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

            pub fn boolean(this: @This(), value: bool) !void {
                try this.write(if (value) "t" else "f");
            }

            pub fn @"null"(this: @This()) !void {
                try this.int32(std.math.maxInt(PostgresInt32));
            }

            pub fn String(this: @This(), value: bun.String) !void {
                if (value.isEmpty()) {
                    try this.write(&[_]u8{0});
                    return;
                }

                var sliced = value.toUTF8(bun.default_allocator);
                defer sliced.deinit();
                var slice = sliced.slice();

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
                .S => FieldMessage{ .S = String.create(message) },
                .V => FieldMessage{ .V = String.create(message) },
                .C => FieldMessage{ .C = String.create(message) },
                .M => FieldMessage{ .M = String.create(message) },
                .D => FieldMessage{ .D = String.create(message) },
                .H => FieldMessage{ .H = String.create(message) },
                .P => FieldMessage{ .P = String.create(message) },
                .p => FieldMessage{ .p = String.create(message) },
                .q => FieldMessage{ .q = String.create(message) },
                .W => FieldMessage{ .W = String.create(message) },
                .s => FieldMessage{ .s = String.create(message) },
                .t => FieldMessage{ .t = String.create(message) },
                .c => FieldMessage{ .c = String.create(message) },
                .d => FieldMessage{ .d = String.create(message) },
                .n => FieldMessage{ .n = String.create(message) },
                .F => FieldMessage{ .F = String.create(message) },
                .L => FieldMessage{ .L = String.create(message) },
                .R => FieldMessage{ .R = String.create(message) },
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
                if (remain.len < @sizeOf((Int))) {
                    return null;
                }
                return @byteSwap(@as(Int, remain.slice()[0..@sizeOf(Int)].*));
            }

            pub fn expectInt(this: @This(), comptime Int: type, comptime value: comptime_int) !bool {
                var actual = try this.int(Int);
                return actual == value;
            }

            pub fn int32(this: @This()) !PostgresInt32 {
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

    comptime {
        if (@import("builtin").cpu.arch.endian() != .Little) {
            @compileError("Postgres protocol implementation assumes little endian");
        }
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
        SASL: struct {
            mechanisms: Data,
            data: Data = .{ .empty = {} },
        },
        SASLContinue: struct {
            data: Data,
        },
        SASLFinal: struct {
            data: Data,
        },
        Unknown: void,

        pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
            const message_length = try reader.length();

            switch (try reader.int32()) {
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
                    const remaining: usize = @intCast(@max(message_length -| (8 - 1), 0));
                    const bytes = try reader.read(@intCast(remaining));
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
                    const remaining: usize = @intCast(@max(message_length -| (8 - 1), 0));
                    const bytes = try reader.read(remaining);
                    this.* = .{
                        .SASL = .{
                            .mechanisms = bytes,
                        },
                    };
                },

                11 => {
                    if (message_length < 9) return error.InvalidMessageLength;
                    const remaining: usize = @intCast(@max(message_length -| (8 - 1), 0));

                    const bytes = try reader.read(remaining);
                    this.* = .{
                        .SASLContinue = .{
                            .data = bytes,
                        },
                    };
                },

                12 => {
                    if (message_length < 9) return error.InvalidMessageLength;
                    const remaining: usize = @intCast(@max(message_length -| (8 - 1), 0));

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
            std.debug.assert(length >= 4);

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
                .process_id = @bitCast(try reader.int32()),
                .secret_key = @bitCast(try reader.int32()),
            };
        }
    };

    pub const ErrorResponse = struct {
        messages: std.ArrayListUnmanaged(FieldMessage) = .{},

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
        return @bitCast(@byteSwap(@as(int32, @intCast(value))));
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
            std.debug.assert(length >= 4);

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

    pub const DataRow = struct {
        pub fn decode(context: anytype, comptime ContextType: type, reader: NewReader(ContextType), comptime forEach: fn (@TypeOf(context), index: u32, bytes: ?*Data) anyerror!bool) anyerror!void {
            var remaining_bytes = try reader.length();
            remaining_bytes -|= 4;

            var remaining_fields: usize = @intCast(@max(try reader.short(), 0));

            for (0..remaining_fields) |index| {
                const byte_length = try reader.int32();
                switch (byte_length) {
                    0 => break,
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
        table_oid: int32 = 0,
        column_index: short = 0,
        type_oid: short = 0,

        pub fn deinit(this: *@This()) void {
            this.name.deinit();
        }

        pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
            var name = try reader.readZ();
            errdefer {
                name.deinit();
            }
            this.* = .{
                .table_oid = try reader.int32(),
                .column_index = try reader.short(),
                .type_oid = @truncate(try reader.int32()),
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
        parameters: []int32 = &[_]int32{},

        pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
            var remaining_bytes = try reader.length();
            remaining_bytes -|= 4;

            const count = try reader.short();
            var parameters = try bun.default_allocator.alloc(int32, @intCast(@max(count, 0)));

            var data = try reader.read(@as(usize, @intCast(@max(count, 0))) * @sizeOf((int32)));
            defer data.deinit();
            const input_params: []align(1) const int32 = toInt32Slice(int32, data.slice());
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
        pid: int32 = 0,
        channel: bun.ByteList = .{},
        payload: bun.ByteList = .{},

        pub fn deinit(this: *@This()) void {
            this.channel.deinitWithAllocator(bun.default_allocator);
            this.payload.deinitWithAllocator(bun.default_allocator);
        }

        pub fn decodeInternal(this: *@This(), comptime Container: type, reader: NewReader(Container)) !void {
            const length = try reader.length();
            std.debug.assert(length >= 4);

            this.* = .{
                .pid = try reader.int32(),
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
            std.debug.assert(length >= 4);

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
        params: []const int32 = &.{},

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
            try writer.short(@intCast(parameters.len));
            for (parameters) |parameter| {
                try writer.int32(parameter);
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
            const count: usize = @sizeOf((u32)) + mechanism.len + 1 + data.len + 1;
            const header = [_]u8{
                'p',
            } ++ toBytes(Int32(count));
            try writer.write(&header);
            try writer.string(mechanism);
            try writer.string(data);
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
            const count: usize = @sizeOf((u32)) + data.len + 1;
            const header = [_]u8{
                'p',
            } ++ toBytes(Int32(count));
            try writer.write(&header);
            try writer.string(data);
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

            const count: usize = @sizeOf((int32)) + @sizeOf((int32)) + zFieldCount("user", user) + zFieldCount("database", database) + zFieldCount("client_encoding", "UTF8") + zFieldCount("", options) + 1;

            const header = toBytes(Int32(@as(u32, @truncate(count))));
            try writer.write(&header);
            try writer.int32(196608);

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
        max_rows: int32 = 0,
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
            try writer.int32(this.max_rows);
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
        version: int32 = 0,
        unrecognized_options: std.ArrayListUnmanaged(String) = .{},

        pub fn decodeInternal(
            this: *@This(),
            comptime Container: type,
            reader: NewReader(Container),
        ) !void {
            const length = try reader.length();
            std.debug.assert(length >= 4);

            const version = try reader.int32();
            this.* = .{
                .version = version,
            };

            const unrecognized_options_count: u32 = @intCast(@max(try reader.int32(), 0));
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
            _ = try reader.int32();

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
    pub const Tag = enum(short) {
        string = 25,
        number = 0,
        json = 114,
        boolean = 16,
        date = 1184,
        datetime = 1114,
        time = 1082,
        bytea = 17,
        bigint = 20,
        _,

        fn toJSWithType(
            tag: Tag,
            globalObject: *JSC.JSGlobalObject,
            comptime Type: type,
            value: Type,
        ) anyerror!JSC.JSValue {
            switch (tag) {
                .number => {
                    return number.toJS(globalObject, value);
                },

                .json => {
                    return json.toJS(globalObject, value);
                },

                .boolean => {
                    return boolean.toJS(globalObject, value);
                },

                .date => {
                    return date.toJS(globalObject, value);
                },

                .bytea => {
                    return bytea.toJS(globalObject, value);
                },

                .bigint => {
                    return JSC.JSValue.fromInt64NoTruncate(globalObject, value);
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
        ) anyerror!JSC.JSValue {
            return toJSWithType(tag, globalObject, @TypeOf(value), value);
        }

        pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) anyerror!Tag {
            if (value.isEmptyOrUndefinedOrNull()) {
                return Tag.number;
            }

            if (value.isCell()) {
                const tag = value.jsType();
                if (tag.isStringLike()) {
                    return .string;
                }

                if (tag == .JSDate) {
                    return .date;
                }

                if (tag.isTypedArray()) {
                    return .bytea;
                }

                if (tag == .HeapBigInt) {
                    return .bigint;
                }

                if (tag.isArrayLike() and value.getLength(globalObject) > 0) {
                    return Tag.fromJS(globalObject, value.getIndex(globalObject, 0));
                }

                if (!tag.isIndexable()) {
                    return error.JSError;
                }
            }

            if (value.isNumber()) {
                return .number;
            }

            if (value.isBoolean()) {
                return .boolean;
            }

            return Tag.number;
        }
    };

    pub const string = struct {
        pub const to = 25;
        pub const from = [_]short{};

        pub fn toJSWithType(
            globalThis: *JSC.JSGlobalObject,
            comptime Type: type,
            value: Type,
        ) anyerror!JSC.JSValue {
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
        ) !JSC.JSValue {
            var str = try toJSWithType(globalThis, @TypeOf(value), value);
            defer str.deinit();
            return str.toJS(globalThis);
        }
    };

    pub const number = struct {
        pub const to = 0;
        pub const from = [_]short{ 21, 23, 26, 700, 701 };

        pub fn toJS(
            _: *JSC.JSGlobalObject,
            value: anytype,
        ) anyerror!JSC.JSValue {
            return JSC.JSValue.jsNumber(value);
        }
    };

    pub const json = struct {
        pub const to = 114;
        pub const from = [_]short{ 114, 3802 };

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSC.JSValue {
            defer value.deinit();
            var str = bun.String.fromUTF8(value.slice());
            defer str.deref();
            const parse_result = JSC.JSValue.parseJSON(str.toJS(globalObject), globalObject);
            if (parse_result.isAnyError()) {
                globalObject.throwValue(parse_result);
                return error.JSError;
            }

            return parse_result;
        }
    };

    pub const boolean = struct {
        pub const to = 16;
        pub const from = [_]short{16};

        pub fn toJS(
            _: *JSC.JSGlobalObject,
            value: bool,
        ) anyerror!JSC.JSValue {
            return JSC.JSValue.jsBoolean(value);
        }
    };

    pub const date = struct {
        pub const to = 1184;
        pub const from = [_]short{ 1082, 1114, 1184 };

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSC.JSValue {
            defer value.deinit();
            return JSC.JSValue.fromDateString(globalObject, value.sliceZ().ptr);
        }
    };

    pub const bytea = struct {
        pub const to = 17;
        pub const from = [_]short{17};

        pub fn toJS(
            globalObject: *JSC.JSGlobalObject,
            value: *Data,
        ) anyerror!JSC.JSValue {
            defer value.deinit();

            // var slice = value.slice()[@min(1, value.len)..];
            // _ = slice;
            return JSC.JSValue.createBuffer(globalObject, value.slice(), null);
        }
    };
};

const Socket = uws.AnySocket;
const PreparedStatementsMap = std.HashMapUnmanaged(u64, *PostgresSQLStatement, bun.IdentityContext(u64), 80);

pub const PostgresSQLContext = struct {
    tcp: ?*uws.SocketContext = null,

    onQueryResolveFn: JSC.Strong = .{},
    onQueryRejectFn: JSC.Strong = .{},

    pub fn init(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
    thisValue: JSC.JSValue = .undefined,
    target: JSC.JSValue = .undefined,
    status: Status = Status.pending,
    ref_count: u32 = 1,

    pub usingnamespace JSC.Codegen.JSPostgresSQLQuery;

    pub const Status = enum(u8) {
        pending,
        running,
        success,
        fail,
    };

    pub fn hasPendingActivity(this: *@This()) callconv(.C) bool {
        return this.status == .running;
    }

    pub fn deinit(this: *@This()) void {
        if (this.statement) |statement| {
            statement.deref();
        }
        this.query.deref();
        this.cursor_name.deref();
    }

    pub fn finalize(this: *@This()) callconv(.C) void {
        this.thisValue = .zero;
        this.target = .zero;
        this.deref();
    }

    pub fn deref(this: *@This()) void {
        const ref_count = this.ref_count;
        this.ref_count -= 1;

        if (ref_count == 1) {
            this.deinit();
            bun.default_allocator.destroy(this);
        }
    }

    pub fn ref(this: *@This()) void {
        std.debug.assert(this.ref_count > 0);
        this.ref_count += 1;
    }

    pub fn onNoData(this: *@This(), globalObject: *JSC.JSGlobalObject) void {
        const thisValue = this.thisValue;
        const targetValue = this.target;
        if (thisValue == .zero) {
            this.deref();
            return;
        }

        this.deref();
        var vm = JSC.VirtualMachine.get();
        // TODO: error handling
        _ = vm.rareData().postgresql_context.onQueryResolveFn.get().?.callWithThis(
            globalObject,
            targetValue,
            &[_]JSC.JSValue{
                JSC.JSValue.undefined,
            },
        );
    }
    pub fn onError(this: *@This(), err: protocol.ErrorResponse, globalObject: *JSC.JSGlobalObject) void {
        const thisValue = this.thisValue;
        const targetValue = this.target;
        if (thisValue == .zero) {
            this.deref();
            return;
        }
        var b = bun.StringBuilder{};
        for (err.messages.items) |msg| {
            b.cap += switch (msg) {
                inline else => |m| m.utf8ByteLength(),
            } + 1;
        }
        b.allocate(bun.default_allocator) catch {};

        for (err.messages.items) |msg| {
            var str = switch (msg) {
                inline else => |m| m.toUTF8(bun.default_allocator),
            };
            defer str.deinit();
            _ = b.append(str.slice());
            _ = b.append("\n");
        }
        const instance = globalObject.createSyntaxErrorInstance("Postgres error occurred\n{s}", .{b.allocatedSlice()[0..b.len]});
        this.status = .fail;
        b.deinit(bun.default_allocator);

        this.deref();
        // TODO: error handling
        _ = JSC.VirtualMachine.get().rareData().postgresql_context.onQueryRejectFn.get().?.callWithThis(
            globalObject,
            targetValue,
            &[_]JSC.JSValue{
                instance,
            },
        );
    }

    pub fn onSuccess(this: *@This(), _: []const u8, globalObject: *JSC.JSGlobalObject) void {
        const thisValue = this.thisValue;
        const targetValue = this.target;
        if (thisValue == .zero) {
            this.deref();
            return;
        }

        const pending_value = PostgresSQLQuery.pendingValueGetCached(thisValue) orelse JSC.JSValue.undefined;
        this.status = .success;
        this.deref();

        // TODO: error handling
        _ = JSC.VirtualMachine.get().rareData().postgresql_context.onQueryResolveFn.get().?.callWithThis(
            globalObject,
            targetValue,
            &[_]JSC.JSValue{
                pending_value,
            },
        );
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*PostgresSQLQuery {
        _ = callframe;
        globalThis.throw("PostgresSQLQuery cannot be constructed directly", .{});
        return null;
    }

    pub fn estimatedSize(this: *PostgresSQLQuery) callconv(.C) usize {
        _ = this;
        return @sizeOf(PostgresSQLQuery);
    }

    pub fn call(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();
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

        var ptr = bun.default_allocator.create(PostgresSQLQuery) catch |err| {
            globalThis.throwError(err, "failed to allocate query");
            return .zero;
        };

        const this_value = ptr.toJS(globalThis);
        this_value.ensureStillAlive();
        PostgresSQLQuery.bindingSetCached(this_value, globalThis, values);

        ptr.* = .{
            .query = query.toBunString(globalThis),
            .thisValue = this_value,
            .target = query,
        };
        ptr.query.ref();

        return this_value;
    }

    pub fn push(this: *PostgresSQLQuery, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
        var pending_value = PostgresSQLQuery.pendingValueGetCached(this.thisValue) orelse JSC.JSValue.zero;
        if (pending_value.isEmptyOrUndefinedOrNull()) {
            pending_value = JSC.JSValue.createEmptyArray(globalThis, 0);
            PostgresSQLQuery.pendingValueSetCached(this.thisValue, globalThis, pending_value);
        }

        pending_value.push(globalThis, value);
    }

    pub fn doRun(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
        this.target = query;
        this.thisValue = callframe.this();
        const binding_value = PostgresSQLQuery.bindingGetCached(callframe.this()) orelse .zero;

        var writer = connection.writer();
        if (this.statement) |stmt| {
            PostgresRequest.bindAndExecute(globalObject, stmt, binding_value, PostgresSQLConnection.Writer, writer) catch |err| {
                globalObject.throwError(err, "failed to bind and execute query");
                return .zero;
            };
        } else {
            const signature = PostgresRequest.prepareAndQuery(globalObject, this.query, binding_value, PostgresSQLConnection.Writer, writer) catch |err| {
                globalObject.throwError(err, "failed to prepare query");
                return .zero;
            };
            var stmt = bun.default_allocator.create(PostgresSQLStatement) catch |err| {
                globalObject.throwError(err, "failed to allocate statement");
                return .zero;
            };

            stmt.* = .{
                .signature = signature,
            };
            this.statement = stmt;
        }

        connection.flushData();

        connection.requests.writeItem(this) catch {};
        this.ref();
        this.status = .running;

        return .undefined;
    }

    pub fn doCancel(this: *PostgresSQLQuery, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
        values_array: JSC.JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !void {
        try writer.write("B");
        const length = try writer.length();

        try writer.String(cursor_name);
        try writer.string(name);

        var iter = JSC.JSArrayIterator.init(values_array, globalObject);

        if (iter.len > 0) {
            try writer.short(@intCast(iter.len));

            while (iter.next()) |value| {
                if (value.isUndefinedOrNull()) {
                    try writer.short(0);
                    continue;
                }

                const tag = try types.Tag.fromJS(globalObject, value);

                switch (tag) {
                    .bytea, .number => {
                        try writer.short(0);
                    },
                    else => {
                        try writer.short(1);
                    },
                }
            }

            try writer.short(@intCast(iter.len));
        } else {
            try writer.short(0);
            try writer.short(0);
        }

        iter = JSC.JSArrayIterator.init(values_array, globalObject);

        debug("Bind: {} ({d} args)", .{ bun.strings.QuotedFormatter{ .text = name }, iter.len });

        while (iter.next()) |value| {
            if (value.isUndefinedOrNull()) {
                debug("  -> NULL", .{});
                try writer.int32(4);
                try writer.null();
                continue;
            }

            const tag = try types.Tag.fromJS(globalObject, value);
            switch (tag) {
                .number => {
                    debug("  -> {s}", .{@tagName(tag)});
                    if (value.isInt32()) {
                        try writer.int32(4);
                        try writer.int32(value.to(int32));
                    } else {
                        try writer.int32(8);
                        try writer.f64(value.coerceToDouble(globalObject));
                    }
                },
                .json => {
                    debug("  -> {s}", .{@tagName(tag)});
                    var str = bun.String.empty;
                    value.jsonStringify(globalObject, 0, &str);
                    try writer.String(str);
                },
                .boolean => {
                    debug("  -> {s}", .{@tagName(tag)});
                    try writer.boolean(value.toBoolean());
                    try writer.write(&[_]u8{0});
                },
                .time, .datetime, .date => {
                    debug("  -> {s}", .{@tagName(tag)});
                    var buf = std.mem.zeroes([28]u8);
                    const str = value.toISOString(globalObject, &buf);
                    try writer.string(str);
                },
                .bytea => {
                    var bytes: []const u8 = "";
                    if (value.asArrayBuffer(globalObject)) |buf| {
                        bytes = buf.byteSlice();
                    }
                    try writer.int32(@intCast(bytes.len));
                    debug("  -> {s}: {d}", .{ @tagName(tag), bytes.len });

                    try writer.bytes(bytes);
                },
                else => {
                    debug("  -> string", .{});
                    // TODO: check if this leaks
                    var str = value.toBunString(globalObject);
                    try writer.String(str);
                },
            }
        }

        try writer.short(0);

        try length.write();
    }

    pub fn writeQuery(
        query: []const u8,
        name: []const u8,
        params: []const int32,
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
            debug("Parse: {}", .{bun.strings.QuotedFormatter{ .text = query }});
        }

        {
            var d = protocol.Describe{
                .p = .{
                    .prepared_statement = name,
                },
            };
            try d.writeInternal(Context, writer);
            debug("Describe: {}", .{bun.strings.QuotedFormatter{ .text = name }});
        }
    }

    pub fn prepareAndQuery(
        globalObject: *JSC.JSGlobalObject,
        query: bun.String,
        array_value: JSC.JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !Signature {
        var query_ = query.toUTF8(bun.default_allocator);
        defer query_.deinit();
        var signature = try Signature.generate(globalObject, query_.slice(), array_value);
        errdefer {
            signature.deinit();
        }

        try writeQuery(query_.slice(), signature.name, signature.fields, Context, writer);
        try writeBind(signature.name, bun.String.empty, globalObject, array_value, Context, writer);
        var exec = protocol.Execute{
            .p = .{
                .prepared_statement = signature.name,
            },
        };
        try exec.writeInternal(Context, writer);

        try writer.write(&protocol.Flush);

        return signature;
    }

    pub fn bindAndExecute(
        globalObject: *JSC.JSGlobalObject,
        statement: *PostgresSQLStatement,
        array_value: JSC.JSValue,
        comptime Context: type,
        writer: protocol.NewWriter(Context),
    ) !void {
        try writeBind(statement.signature.name, bun.String.empty, globalObject, array_value, Context, writer);
        var exec = protocol.Execute{
            .p = .{
                .prepared_statement = statement.signature.name,
            },
        };
        try exec.writeInternal(Context, writer);

        try writer.write(&protocol.Flush);
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

    poll_ref: bun.JSC.PollRef = .{},
    globalObject: *JSC.JSGlobalObject,

    statements: PreparedStatementsMap,
    has_pending_activity: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(false),
    js_value: JSC.JSValue = JSC.JSValue.undefined,

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

    pub const Status = enum {
        disconnected,
        connecting,
        connected,
        failed,
    };

    pub usingnamespace JSC.Codegen.JSPostgresSQLConnection;

    pub fn hasPendingActivity(this: *PostgresSQLConnection) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    fn updateHasPendingActivity(this: *PostgresSQLConnection) void {
        @fence(.Release);
        this.has_pending_activity.store(this.requests.readableLength() > 0 or this.status == .connecting, .Release);
    }

    pub fn setStatus(this: *PostgresSQLConnection, status: Status) void {
        defer this.updateHasPendingActivity();

        if (this.status == status) return;

        this.status = status;
        switch (status) {
            .connected => {
                const on_connect = this.on_connect.swap();
                if (on_connect == .zero) return;
                this.poll_ref.unref(this.globalObject.bunVM());
                this.updateHasPendingActivity();
                _ = on_connect.callWithThis(
                    this.globalObject,
                    this.js_value,
                    &[_]JSC.JSValue{
                        this.js_value,
                    },
                );
            },
            else => {},
        }
    }

    pub fn finalize(this: *PostgresSQLConnection) callconv(.C) void {
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
        instance.put(this.globalObject, &JSC.ZigString.init("code"), bun.String.init(@errorName(err)).toJSConst(this.globalObject));
        _ = on_close.callWithThis(
            this.globalObject,
            this.js_value,
            &[_]JSC.JSValue{
                instance,
            },
        );
    }

    pub fn onClose(this: *PostgresSQLConnection) void {
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
        _ = this;
        debug("onTimeout", .{});
    }

    pub fn onDrain(this: *PostgresSQLConnection) void {
        this.flushData();
    }

    pub fn onData(this: *PostgresSQLConnection, data: []const u8) void {
        if (this.read_buffer.remaining().len == 0) {
            var consumed: usize = 0;
            var offset: usize = 0;
            const reader = protocol.StackReader.init(data, &consumed, &offset);
            PostgresRequest.onData(this, protocol.StackReader, reader) catch |err| {
                if (err == error.ShortRead) {
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
            this.read_buffer.write(bun.default_allocator, data) catch @panic("failed to write to read buffer");
            PostgresRequest.onData(this, Reader, this.bufferedReader()) catch |err| {
                if (err != error.ShortRead) {
                    if (comptime bun.Environment.allow_assert) {
                        if (@errorReturnTrace()) |trace| {
                            debug("Error: {s}\n{}", .{ @errorName(err), trace });
                        }
                    }
                    this.fail("Failed to read data", err);
                }
                return;
            };
            this.last_message_start = 0;
        }
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*PostgresSQLConnection {
        var vm = globalObject.bunVM();
        const arguments = callframe.arguments(9).slice();
        const hostname_str = arguments[0].toBunString(globalObject);
        const port = arguments[1].coerce(i32, globalObject);

        const username_str = arguments[2].toBunString(globalObject);
        const password_str = arguments[3].toBunString(globalObject);
        const database_str = arguments[4].toBunString(globalObject);
        const tls_object = arguments[5];
        var username: []const u8 = "";
        var password: []const u8 = "";
        var database: []const u8 = "";
        var options: []const u8 = "";

        const options_str = arguments[6].toBunString(globalObject);

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
            return null;
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

        {
            const hostname = hostname_str.toUTF8(bun.default_allocator);
            defer hostname.deinit();
            if (tls_object.isEmptyOrUndefinedOrNull()) {
                var ctx = vm.rareData().postgresql_context.tcp orelse brk: {
                    var ctx_ = uws.us_create_bun_socket_context(0, vm.event_loop_handle, @sizeOf(*PostgresSQLConnection), uws.us_bun_socket_context_options_t{}).?;
                    uws.NewSocketHandler(false).configure(ctx_, true, *PostgresSQLConnection, SocketHandler(false));
                    vm.rareData().postgresql_context.tcp = ctx_;
                    break :brk ctx_;
                };
                ptr.socket = .{
                    .SocketTCP = uws.SocketTCP.connectAnon(hostname.slice(), port, ctx, ptr) orelse {
                        globalObject.throwError(error.ConnectionFailed, "failed to connect to postgresql");
                        ptr.deinit();
                        return null;
                    },
                };
            } else {
                // TODO:
                globalObject.throwTODO("TLS is not supported yet");
                ptr.deinit();
                return null;
            }
        }
        ptr.updateHasPendingActivity();
        ptr.poll_ref.ref(vm);

        return ptr;
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
        std.debug.assert(this.ref_count > 0);
        this.ref_count += 1;
    }

    pub fn doRef(this: *@This(), _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        this.poll_ref.ref(this.globalObject.bunVM());
        this.updateHasPendingActivity();
        return .undefined;
    }

    pub fn doUnref(this: *@This(), _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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

    pub fn doClose(this: *@This(), globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
            this.connection.read_buffer.head = @min(this.connection.read_buffer.head + @as(u32, @truncate(count)), this.connection.read_buffer.len());
        }
        pub fn ensureCapacity(this: Reader, count: usize) bool {
            return this.connection.read_buffer.head + count <= this.connection.read_buffer.len();
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

    const CellPutter = struct {
        object: JSC.JSValue,
        vm: *JSC.VM,
        globalObject: *JSC.JSGlobalObject,
        fields: []const protocol.FieldDescription,

        pub fn put(this: *const CellPutter, index: u32, optional_bytes: ?*Data) anyerror!bool {
            const putDirectOffset = JSC.JSObject.putDirectOffset;
            var bytes_ = optional_bytes orelse {
                putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsNull());
                return true;
            };
            defer bytes_.deinit();
            const bytes = bytes_.slice();

            switch (@as(types.Tag, @enumFromInt(this.fields[index].type_oid))) {
                .number => {
                    switch (bytes.len) {
                        0 => {
                            putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsNull());
                        },
                        2 => {
                            putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsNumber(@as(int32, @as(short, @bitCast(bytes[0..2].*)))));
                        },
                        4 => {
                            putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsNumber(@as(int32, @bitCast(bytes[0..4].*))));
                        },
                        else => {
                            var eight: usize = 0;
                            @memcpy(@as(*[8]u8, @ptrCast(&eight))[0..bytes.len], bytes[0..@min(8, bytes.len)]);
                            eight = @byteSwap(eight);
                            putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsNumber(@as(f64, @bitCast(eight))));
                        },
                    }
                },
                .json => {
                    var str = bun.String.fromUTF8(bytes);
                    defer str.deref();
                    putDirectOffset(this.object, this.vm, index, str.toJSForParseJSON(this.globalObject));
                },
                .boolean => {
                    putDirectOffset(this.object, this.vm, index, JSC.JSValue.jsBoolean(bytes.len > 0 and bytes[0] == 't'));
                },
                .time, .datetime, .date => {
                    putDirectOffset(this.object, this.vm, index, JSC.JSValue.fromDateString(this.globalObject, bytes_.sliceZ()));
                },
                .bytea => {
                    putDirectOffset(this.object, this.vm, index, JSC.ArrayBuffer.createBuffer(this.globalObject, bytes));
                },
                else => {
                    var str = bun.String.fromUTF8(bytes);
                    defer str.deref();
                    putDirectOffset(this.object, this.vm, index, str.toJS(this.globalObject));
                },
            }
            return true;
        }
    };

    pub fn on(this: *PostgresSQLConnection, comptime MessageType: @Type(.EnumLiteral), comptime Context: type, reader: protocol.NewReader(Context)) !void {
        debug("on({s})", .{@tagName(MessageType)});
        if (comptime MessageType != .ReadyForQuery) {
            this.is_ready_for_query = false;
        }

        switch (comptime MessageType) {
            .DataRow => {
                var request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;
                var structure = statement.structure(this.globalObject);
                std.debug.assert(!structure.isEmptyOrUndefinedOrNull());

                var row = JSC.JSObject.uninitialized(this.globalObject, structure);
                row.ensureStillAlive();
                var putter = CellPutter{
                    .object = row,
                    .vm = this.globalObject.vm(),
                    .globalObject = this.globalObject,
                    .fields = statement.fields,
                };
                try protocol.DataRow.decode(
                    &putter,
                    Context,
                    reader,
                    CellPutter.put,
                );
                request.push(this.globalObject, row);
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

                this.flushData();
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
                this.updateRef();
                request.onSuccess(cmd.command_tag.slice(), this.globalObject);
            },
            .BindComplete => {
                try reader.eatMessage(protocol.BindComplete);
                _ = this.current() orelse return error.ExpectedRequest;
            },
            .ParseComplete => {
                try reader.eatMessage(protocol.ParseComplete);
                _ = this.current() orelse return error.ExpectedRequest;
            },
            .ParameterDescription => {
                var description: protocol.ParameterDescription = undefined;
                try description.decodeInternal(Context, reader);
                var request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;
                statement.parameters = description.parameters;
            },
            .RowDescription => {
                var description: protocol.RowDescription = undefined;
                try description.decodeInternal(Context, reader);
                errdefer description.deinit();
                var request = this.current() orelse return error.ExpectedRequest;
                var statement = request.statement orelse return error.ExpectedStatement;
                statement.fields = description.fields;
            },
            .Authentication => {
                var auth: protocol.Authentication = undefined;
                try auth.decodeInternal(Context, reader);

                debug("TODO auth: {s}", .{@tagName(std.meta.activeTag(auth))});
            },
            .NoData => {
                try reader.eatMessage(protocol.NoData);
                var request = this.current() orelse return error.ExpectedRequest;
                _ = this.requests.discard(1);
                this.updateRef();

                request.onNoData(this.globalObject);
            },
            .BackendKeyData => {
                try this.backend_key_data.decodeInternal(Context, reader);
            },
            .ErrorResponse => {
                var err: protocol.ErrorResponse = undefined;
                try err.decodeInternal(Context, reader);
                defer {
                    err.deinit();
                }
                var request = this.current() orelse return error.ExpectedRequest;
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
        if (this.has_pending_activity.loadUnchecked()) {
            this.poll_ref.ref(this.globalObject.bunVM());
        } else {
            this.poll_ref.unref(this.globalObject.bunVM());
        }
    }

    pub fn doFlush(this: *PostgresSQLConnection, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = callframe;
        _ = globalObject;
        _ = this;

        return .undefined;
    }

    pub fn createQuery(this: *PostgresSQLConnection, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = callframe;
        _ = globalObject;
        _ = this;

        return .undefined;
    }

    pub fn getConnected(this: *PostgresSQLConnection, _: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.status == Status.connected);
    }
};

pub const PostgresSQLStatement = struct {
    cached_structure: JSC.Strong = .{},
    ref_count: u32 = 1,
    fields: []const protocol.FieldDescription = &[_]protocol.FieldDescription{},
    parameters: []const int32 = &[_]int32{},
    signature: Signature,
    pub fn ref(this: *@This()) void {
        std.debug.assert(this.ref_count > 0);
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
        std.debug.assert(this.ref_count == 0);

        for (this.fields) |*field| {
            @constCast(field).deinit();
        }
        bun.default_allocator.free(this.fields);
        bun.default_allocator.free(this.parameters);
        this.cached_structure.deinit();
        this.signature.deinit();
        bun.default_allocator.destroy(this);
    }

    pub fn structure(this: *PostgresSQLStatement, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return this.cached_structure.get() orelse {
            var names = bun.default_allocator.alloc(bun.String, this.fields.len) catch return .undefined;
            defer {
                for (names) |*name| {
                    name.deref();
                }
                bun.default_allocator.free(names);
            }
            for (this.fields, names) |*field, *name| {
                name.* = String.createAtomIfPossible(field.name.slice());
            }
            var structure_ = JSC.JSObject.createStructure(
                globalObject,
                @truncate(this.fields.len),
                names.ptr,
            );
            this.cached_structure.set(globalObject, structure_);
            return structure_;
        };
    }
};

const Signature = struct {
    fields: []const int32,
    name: []const u8,
    query: []const u8,

    pub fn deinit(this: *Signature) void {
        bun.default_allocator.free(this.fields);
        bun.default_allocator.free(this.name);
        bun.default_allocator.free(this.query);
    }

    pub fn hash(this: *const Signature) u64 {
        var hasher = std.hash.Wyhash.init(0);
        defer hasher.deinit();
        hasher.update(this.name);
        hasher.update(std.mem.sliceAsBytes(this.fields));
        return hasher.final();
    }

    pub fn generate(globalObject: *JSC.JSGlobalObject, query: []const u8, array_value: JSC.JSValue) !Signature {
        var fields = std.ArrayList(int32).init(bun.default_allocator);
        var name = try std.ArrayList(u8).initCapacity(bun.default_allocator, query.len);

        name.appendSliceAssumeCapacity(query);

        errdefer {
            fields.deinit();
            name.deinit();
        }

        var iter = JSC.JSArrayIterator.init(array_value, globalObject);

        while (iter.next()) |value| {
            if (value.isUndefinedOrNull()) {
                try fields.append(@byteSwap(@as(int32, std.math.maxInt(int32))));
                try name.appendSlice(".null");
                continue;
            }

            const tag = try types.Tag.fromJS(globalObject, value);
            try fields.append(@byteSwap(@intFromEnum(tag)));
            switch (tag) {
                .number => try name.appendSlice(".number"),
                .json => try name.appendSlice(".json"),
                .boolean => try name.appendSlice(".boolean"),
                .date => try name.appendSlice(".date"),
                .datetime => try name.appendSlice(".datetime"),
                .time => try name.appendSlice(".time"),
                .bytea => try name.appendSlice(".bytea"),
                .bigint => try name.appendSlice(".bigint"),
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
