const std = @import("std");
const BigInt = std.math.big.int.Const;
const mem = std.mem;
const Allocator = mem.Allocator;
const ArenaAllocator = std.heap.ArenaAllocator;

// zig fmt: off
pub const Tag = enum(u8) {
    bool              = 0x01,
    int               = 0x02,
    bit_string        = 0x03,
    octet_string      = 0x04,
    @"null"           = 0x05,
    object_identifier = 0x06,
    utf8_string       = 0x0c,
    printable_string  = 0x13,
    ia5_string        = 0x16,
    utc_time          = 0x17,
    bmp_string        = 0x1e,
    sequence          = 0x30,
    set               = 0x31,
    // Bogus value
    context_specific  = 0xff,
};
// zig fmt: on

pub const ObjectIdentifier = struct {
    data: [16]u32,
    len: u8,
};

pub const BitString = struct {
    data: []const u8,
    bit_len: usize,
};

pub const Value = union(Tag) {
    bool: bool,
    int: BigInt,
    bit_string: BitString,
    octet_string: []const u8,
    @"null",
    // @TODO Make this []u32, owned?
    object_identifier: ObjectIdentifier,
    utf8_string: []const u8,
    printable_string: []const u8,
    ia5_string: []const u8,
    utc_time: []const u8,
    bmp_string: []const u16,
    sequence: []const @This(),
    set: []const @This(),
    context_specific: struct {
        child: *const Value,
        number: u8,
    },

    pub fn deinit(self: @This(), alloc: *Allocator) void {
        switch (self) {
            .int => |i| alloc.free(i.limbs),
            .bit_string => |bs| alloc.free(bs.data),
            .octet_string,
            .utf8_string,
            .printable_string,
            .ia5_string,
            .utc_time,
            => |s| alloc.free(s),
            .bmp_string => |s| alloc.free(s),
            .sequence, .set => |s| {
                for (s) |c| {
                    c.deinit(alloc);
                }
                alloc.free(s);
            },
            .context_specific => |cs| {
                cs.child.deinit(alloc);
                alloc.destroy(cs.child);
            },
            else => {},
        }
    }

    fn formatInternal(
        self: Value,
        comptime fmt: []const u8,
        options: std.fmt.FormatOptions,
        indents: usize,
        writer: anytype,
    ) @TypeOf(writer).Error!void {
        try writer.writeByteNTimes(' ', indents);
        switch (self) {
            .bool => |b| try writer.print("BOOLEAN {}\n", .{b}),
            .int => |i| {
                try writer.writeAll("INTEGER ");
                try i.format(fmt, options, writer);
                try writer.writeByte('\n');
            },
            .bit_string => |bs| {
                try writer.print("BIT STRING ({} bits) ", .{bs.bit_len});
                const bits_to_show = std.math.min(8 * 3, bs.bit_len);
                const bytes = std.math.divCeil(usize, bits_to_show, 8) catch unreachable;

                var bit_idx: usize = 0;
                var byte_idx: usize = 0;
                while (byte_idx < bytes) : (byte_idx += 1) {
                    const byte = bs.data[byte_idx];
                    var cur_bit_idx: u3 = 0;
                    while (bit_idx < bits_to_show) {
                        const mask = @as(u8, 0x80) >> cur_bit_idx;
                        try writer.print("{}", .{@boolToInt(byte & mask == mask)});
                        cur_bit_idx += 1;
                        bit_idx += 1;
                        if (cur_bit_idx == 7)
                            break;
                    }
                }
                if (bits_to_show != bs.bit_len)
                    try writer.writeAll("...");
                try writer.writeByte('\n');
            },
            .octet_string => |s| try writer.print("OCTET STRING ({} bytes) {X}\n", .{ s.len, s }),
            .@"null" => try writer.writeAll("NULL\n"),
            .object_identifier => |oid| {
                try writer.writeAll("OBJECT IDENTIFIER ");
                var i: u8 = 0;
                while (i < oid.len) : (i += 1) {
                    if (i != 0) try writer.writeByte('.');
                    try writer.print("{}", .{oid.data[i]});
                }
                try writer.writeByte('\n');
            },
            .utf8_string => |s| try writer.print("UTF8 STRING ({} bytes) {}\n", .{ s.len, s }),
            .printable_string => |s| try writer.print("PRINTABLE STRING ({} bytes) {}\n", .{ s.len, s }),
            .ia5_string => |s| try writer.print("IA5 STRING ({} bytes) {}\n", .{ s.len, s }),
            .utc_time => |s| try writer.print("UTC TIME {}\n", .{s}),
            .bmp_string => |s| try writer.print("BMP STRING ({} words) {}\n", .{
                s.len,
                @ptrCast([*]const u16, s.ptr)[0 .. s.len * 2],
            }),
            .sequence => |children| {
                try writer.print("SEQUENCE ({} elems)\n", .{children.len});
                for (children) |child| try child.formatInternal(fmt, options, indents + 2, writer);
            },
            .set => |children| {
                try writer.print("SET ({} elems)\n", .{children.len});
                for (children) |child| try child.formatInternal(fmt, options, indents + 2, writer);
            },
            .context_specific => |cs| {
                try writer.print("[{}]\n", .{cs.number});
                try cs.child.formatInternal(fmt, options, indents + 2, writer);
            },
        }
    }

    pub fn format(self: Value, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
        try self.formatInternal(fmt, options, 0, writer);
    }
};

/// Distinguished encoding rules
pub const der = struct {
    pub fn DecodeError(comptime Reader: type) type {
        return Reader.Error || error{
            OutOfMemory,
            EndOfStream,
            InvalidLength,
            InvalidTag,
            InvalidContainerLength,
            DoesNotMatchSchema,
        };
    }

    fn DERReaderState(comptime Reader: type) type {
        return struct {
            der_reader: Reader,
            length: usize,
            idx: usize = 0,
        };
    }

    fn DERReader(comptime Reader: type) type {
        const S = struct {
            pub fn read(state: *DERReaderState(Reader), buffer: []u8) DecodeError(Reader)!usize {
                const out_bytes = std.math.min(buffer.len, state.length - state.idx);
                const res = try state.der_reader.readAll(buffer[0..out_bytes]);
                state.idx += res;
                return res;
            }
        };

        return std.io.Reader(*DERReaderState(Reader), DecodeError(Reader), S.read);
    }

    pub fn parse_schema(
        schema: anytype,
        captures: anytype,
        der_reader: anytype,
    ) !void {
        const res = try parse_schema_tag_len_internal(null, null, schema, captures, der_reader);
        if (res != null) return error.DoesNotMatchSchema;
    }

    pub fn parse_schema_tag_len(
        existing_tag_byte: ?u8,
        existing_length: ?usize,
        schema: anytype,
        captures: anytype,
        der_reader: anytype,
    ) !void {
        const res = try parse_schema_tag_len_internal(
            existing_tag_byte,
            existing_length,
            schema,
            captures,
            der_reader,
        );
        if (res != null) return error.DoesNotMatchSchema;
    }

    const TagLength = struct {
        tag: u8,
        length: usize,
    };

    pub fn parse_schema_tag_len_internal(
        existing_tag_byte: ?u8,
        existing_length: ?usize,
        schema: anytype,
        captures: anytype,
        der_reader: anytype,
    ) !?TagLength {
        const Reader = @TypeOf(der_reader);

        const isEnumLit = comptime std.meta.trait.is(.EnumLiteral);
        comptime var tag_idx = 0;

        const has_capture = comptime isEnumLit(@TypeOf(schema[tag_idx])) and schema[tag_idx] == .capture;
        if (has_capture) tag_idx += 2;

        const is_optional = comptime isEnumLit(@TypeOf(schema[tag_idx])) and schema[tag_idx] == .optional;
        if (is_optional) tag_idx += 1;

        const tag_literal = schema[tag_idx];
        comptime std.debug.assert(isEnumLit(@TypeOf(tag_literal)));

        const tag_byte = existing_tag_byte orelse (der_reader.readByte() catch |err| switch (err) {
            error.EndOfStream => return if (is_optional) null else error.EndOfStream,
            else => |e| return e,
        });

        const length = existing_length orelse try parse_length(der_reader);
        if (tag_literal == .sequence_of) {
            if (tag_byte != @enumToInt(Tag.sequence)) {
                if (is_optional) return TagLength{ .tag = tag_byte, .length = length };
                return error.InvalidTag;
            }

            var curr_tag_length: ?TagLength = null;
            const sub_schema = schema[tag_idx + 1];
            while (true) {
                if (curr_tag_length == null) {
                    curr_tag_length = .{
                        .tag = der_reader.readByte() catch |err| switch (err) {
                            error.EndOfStream => {
                                curr_tag_length = null;
                                break;
                            },
                            else => |e| return e,
                        },
                        .length = try parse_length(der_reader),
                    };
                }

                curr_tag_length = parse_schema_tag_len_internal(
                    curr_tag_length.?.tag,
                    curr_tag_length.?.length,
                    sub_schema,
                    captures,
                    der_reader,
                ) catch |err| switch (err) {
                    error.DoesNotMatchSchema => break,
                    else => |e| return e,
                };
            }
            return curr_tag_length;
        } else if (tag_literal == .any) {
            if (!has_capture) {
                try der_reader.skipBytes(length, .{});
                return null;
            }

            var reader_state = DERReaderState(Reader){
                .der_reader = der_reader,
                .idx = 0,
                .length = length,
            };
            var reader = DERReader(@TypeOf(der_reader)){ .context = &reader_state };
            const capture_context = captures[schema[1] * 2];
            const capture_action = captures[schema[1] * 2 + 1];
            try capture_action(capture_context, tag_byte, length, reader);

            // Skip remaining bytes
            try der_reader.skipBytes(reader_state.length - reader_state.idx, .{});
            return null;
        } else if (tag_literal == .context_specific) {
            const cs_number = schema[tag_idx + 1];
            if (tag_byte & 0xC0 == 0x80 and tag_byte - 0xa0 == cs_number) {
                if (!has_capture) {
                    if (schema.len > tag_idx + 2) {
                        return try parse_schema_tag_len_internal(null, null, schema[tag_idx + 2], captures, der_reader);
                    }

                    try der_reader.skipBytes(length, .{});
                    return null;
                }

                var reader_state = DERReaderState(Reader){
                    .der_reader = der_reader,
                    .idx = 0,
                    .length = length,
                };
                var reader = DERReader(Reader){ .context = &reader_state };
                const capture_context = captures[schema[1] * 2];
                const capture_action = captures[schema[1] * 2 + 1];
                try capture_action(capture_context, tag_byte, length, reader);

                // Skip remaining bytes
                try der_reader.skipBytes(reader_state.length - reader_state.idx, .{});
                return null;
            } else if (is_optional)
                return TagLength{ .tag = tag_byte, .length = length }
            else
                return error.DoesNotMatchSchema;
        }

        const schema_tag: Tag = tag_literal;
        const actual_tag = std.meta.intToEnum(Tag, tag_byte) catch return error.InvalidTag;
        if (actual_tag != schema_tag) {
            if (is_optional) return TagLength{ .tag = tag_byte, .length = length };
            return error.DoesNotMatchSchema;
        }

        const single_seq = schema_tag == .sequence and schema.len == 1;
        if ((!has_capture and schema_tag != .sequence) or (!has_capture and single_seq)) {
            try der_reader.skipBytes(length, .{});
            return null;
        }

        if (has_capture) {
            var reader_state = DERReaderState(Reader){
                .der_reader = der_reader,
                .idx = 0,
                .length = length,
            };
            var reader = DERReader(Reader){ .context = &reader_state };
            const capture_context = captures[schema[1] * 2];
            const capture_action = captures[schema[1] * 2 + 1];
            try capture_action(capture_context, tag_byte, length, reader);

            // Skip remaining bytes
            try der_reader.skipBytes(reader_state.length - reader_state.idx, .{});
            return null;
        }

        var cur_tag_length: ?TagLength = null;
        const sub_schemas = schema[tag_idx + 1];
        comptime var i = 0;
        inline while (i < sub_schemas.len) : (i += 1) {
            const curr_tag = if (cur_tag_length) |tl| tl.tag else null;
            const curr_length = if (cur_tag_length) |tl| tl.length else null;
            cur_tag_length = try parse_schema_tag_len_internal(curr_tag, curr_length, sub_schemas[i], captures, der_reader);
        }
        return cur_tag_length;
    }

    pub const EncodedLength = struct {
        data: [@sizeOf(usize) + 1]u8,
        len: usize,

        pub fn slice(self: @This()) []const u8 {
            if (self.len == 1) return self.data[0..1];
            return self.data[0 .. 1 + self.len];
        }
    };

    pub fn encode_length(length: usize) EncodedLength {
        var enc = EncodedLength{ .data = undefined, .len = 0 };
        if (length < 128) {
            enc.data[0] = @truncate(u8, length);
            enc.len = 1;
        } else {
            const bytes_needed = @intCast(u8, std.math.divCeil(
                usize,
                std.math.log2_int_ceil(usize, length),
                8,
            ) catch unreachable);
            enc.data[0] = bytes_needed | 0x80;
            mem.copy(
                u8,
                enc.data[1 .. bytes_needed + 1],
                mem.asBytes(&length)[0..bytes_needed],
            );
            if (std.builtin.target.cpu.arch.endian() != .Big) {
                mem.reverse(u8, enc.data[1 .. bytes_needed + 1]);
            }
            enc.len = bytes_needed;
        }
        return enc;
    }

    fn parse_int_internal(alloc: *Allocator, bytes_read: *usize, der_reader: anytype) !BigInt {
        const length = try parse_length_internal(bytes_read, der_reader);
        return try parse_int_with_length_internal(alloc, bytes_read, length, der_reader);
    }

    pub fn parse_int(alloc: *Allocator, der_reader: anytype) !BigInt {
        var bytes: usize = undefined;
        return try parse_int_internal(alloc, &bytes, der_reader);
    }

    pub fn parse_int_with_length(alloc: *Allocator, length: usize, der_reader: anytype) !BigInt {
        var read: usize = 0;
        return try parse_int_with_length_internal(alloc, &read, length, der_reader);
    }

    fn parse_int_with_length_internal(alloc: *Allocator, bytes_read: *usize, length: usize, der_reader: anytype) !BigInt {
        const first_byte = try der_reader.readByte();
        if (first_byte == 0x0 and length > 1) {
            // Positive number with highest bit set to 1 in the rest.
            const limb_count = std.math.divCeil(usize, length - 1, @sizeOf(usize)) catch unreachable;
            const limbs = try alloc.alloc(usize, limb_count);
            std.mem.set(usize, limbs, 0);
            errdefer alloc.free(limbs);

            var limb_ptr = @ptrCast([*]u8, limbs.ptr);
            try der_reader.readNoEof(limb_ptr[0 .. length - 1]);
            // We always reverse because the standard library big int expects little endian.
            mem.reverse(u8, limb_ptr[0 .. length - 1]);

            bytes_read.* += length;
            return BigInt{ .limbs = limbs, .positive = true };
        }
        std.debug.assert(length != 0);
        // Write first_byte
        // Twos complement
        const limb_count = std.math.divCeil(usize, length, @sizeOf(usize)) catch unreachable;
        const limbs = try alloc.alloc(usize, limb_count);
        std.mem.set(usize, limbs, 0);
        errdefer alloc.free(limbs);

        var limb_ptr = @ptrCast([*]u8, limbs.ptr);
        limb_ptr[0] = first_byte & ~@as(u8, 0x80);
        try der_reader.readNoEof(limb_ptr[1..length]);

        // We always reverse because the standard library big int expects little endian.
        mem.reverse(u8, limb_ptr[0..length]);
        bytes_read.* += length;
        return BigInt{ .limbs = limbs, .positive = (first_byte & 0x80) == 0x00 };
    }

    pub fn parse_length(der_reader: anytype) !usize {
        var bytes: usize = 0;
        return try parse_length_internal(&bytes, der_reader);
    }

    fn parse_length_internal(bytes_read: *usize, der_reader: anytype) !usize {
        const first_byte = try der_reader.readByte();
        bytes_read.* += 1;
        if (first_byte & 0x80 == 0x00) {
            // 1 byte value
            return first_byte;
        }
        const length = @truncate(u7, first_byte);
        if (length > @sizeOf(usize))
            @panic("DER length does not fit in usize");

        var res_buf = std.mem.zeroes([@sizeOf(usize)]u8);
        try der_reader.readNoEof(res_buf[0..length]);
        bytes_read.* += length;

        if (std.builtin.target.cpu.arch.endian() != .Big) {
            mem.reverse(u8, res_buf[0..length]);
        }
        return mem.bytesToValue(usize, &res_buf);
    }

    fn parse_value_with_tag_byte(
        tag_byte: u8,
        alloc: *Allocator,
        bytes_read: *usize,
        der_reader: anytype,
    ) DecodeError(@TypeOf(der_reader))!Value {
        const tag = std.meta.intToEnum(Tag, tag_byte) catch {
            // tag starts with '0b10...', this is the context specific class.
            if (tag_byte & 0xC0 == 0x80) {
                const length = try parse_length_internal(bytes_read, der_reader);
                var cur_read_bytes: usize = 0;
                var child = try alloc.create(Value);
                errdefer alloc.destroy(child);

                child.* = try parse_value_internal(alloc, &cur_read_bytes, der_reader);
                if (cur_read_bytes != length)
                    return error.InvalidContainerLength;
                bytes_read.* += length;
                return Value{ .context_specific = .{ .child = child, .number = tag_byte - 0xa0 } };
            }

            return error.InvalidTag;
        };
        switch (tag) {
            .bool => {
                if ((try der_reader.readByte()) != 0x1)
                    return error.InvalidLength;
                defer bytes_read.* += 2;
                return Value{ .bool = (try der_reader.readByte()) != 0x0 };
            },
            .int => return Value{ .int = try parse_int_internal(alloc, bytes_read, der_reader) },
            .bit_string => {
                const length = try parse_length_internal(bytes_read, der_reader);
                const unused_bits = try der_reader.readByte();
                std.debug.assert(unused_bits < 8);
                const bit_count = (length - 1) * 8 - unused_bits;
                const bit_memory = try alloc.alloc(u8, std.math.divCeil(usize, bit_count, 8) catch unreachable);
                errdefer alloc.free(bit_memory);
                try der_reader.readNoEof(bit_memory[0 .. length - 1]);

                bytes_read.* += length;
                return Value{ .bit_string = .{ .data = bit_memory, .bit_len = bit_count } };
            },
            .octet_string, .utf8_string, .printable_string, .utc_time, .ia5_string => {
                const length = try parse_length_internal(bytes_read, der_reader);
                const str_mem = try alloc.alloc(u8, length);
                try der_reader.readNoEof(str_mem);
                bytes_read.* += length;
                return @as(Value, switch (tag) {
                    .octet_string => .{ .octet_string = str_mem },
                    .utf8_string => .{ .utf8_string = str_mem },
                    .printable_string => .{ .printable_string = str_mem },
                    .utc_time => .{ .utc_time = str_mem },
                    .ia5_string => .{ .ia5_string = str_mem },
                    else => unreachable,
                });
            },
            .@"null" => {
                std.debug.assert((try parse_length_internal(bytes_read, der_reader)) == 0x00);
                return .@"null";
            },
            .object_identifier => {
                const length = try parse_length_internal(bytes_read, der_reader);
                const first_byte = try der_reader.readByte();
                var ret = Value{ .object_identifier = .{ .data = undefined, .len = 0 } };
                ret.object_identifier.data[0] = first_byte / 40;
                ret.object_identifier.data[1] = first_byte % 40;

                var out_idx: u8 = 2;
                var i: usize = 0;
                while (i < length - 1) {
                    var current_value: u32 = 0;
                    var current_byte = try der_reader.readByte();
                    i += 1;
                    while (current_byte & 0x80 == 0x80) : (i += 1) {
                        // Increase the base of the previous bytes
                        current_value *= 128;
                        // Add the current byte in base 128
                        current_value += @as(u32, current_byte & ~@as(u8, 0x80)) * 128;
                        current_byte = try der_reader.readByte();
                    } else {
                        current_value += current_byte;
                    }
                    ret.object_identifier.data[out_idx] = current_value;
                    out_idx += 1;
                }
                ret.object_identifier.len = out_idx;
                std.debug.assert(out_idx <= 16);
                bytes_read.* += length;
                return ret;
            },
            .bmp_string => {
                const length = try parse_length_internal(bytes_read, der_reader);
                const str_mem = try alloc.alloc(u16, @divExact(length, 2));
                errdefer alloc.free(str_mem);

                for (str_mem) |*wide_char| {
                    wide_char.* = try der_reader.readIntBig(u16);
                }
                bytes_read.* += length;
                return Value{ .bmp_string = str_mem };
            },
            .sequence, .set => {
                const length = try parse_length_internal(bytes_read, der_reader);
                var cur_read_bytes: usize = 0;
                var arr = std.ArrayList(Value).init(alloc);
                errdefer arr.deinit();

                while (cur_read_bytes < length) {
                    (try arr.addOne()).* = try parse_value_internal(alloc, &cur_read_bytes, der_reader);
                }
                if (cur_read_bytes != length)
                    return error.InvalidContainerLength;
                bytes_read.* += length;

                return @as(Value, switch (tag) {
                    .sequence => .{ .sequence = arr.toOwnedSlice() },
                    .set => .{ .set = arr.toOwnedSlice() },
                    else => unreachable,
                });
            },
            .context_specific => unreachable,
        }
    }

    fn parse_value_internal(alloc: *Allocator, bytes_read: *usize, der_reader: anytype) DecodeError(@TypeOf(der_reader))!Value {
        const tag_byte = try der_reader.readByte();
        bytes_read.* += 1;
        return try parse_value_with_tag_byte(tag_byte, alloc, bytes_read, der_reader);
    }

    pub fn parse_value(alloc: *Allocator, der_reader: anytype) DecodeError(@TypeOf(der_reader))!Value {
        var read: usize = 0;
        return try parse_value_internal(alloc, &read, der_reader);
    }
};

test "der.parse_value" {
    const github_der = @embedFile("../test/github.der");
    var fbs = std.io.fixedBufferStream(github_der);

    var arena = ArenaAllocator.init(std.testing.allocator);
    defer arena.deinit();

    _ = try der.parse_value(&arena.allocator, fbs.reader());
}
