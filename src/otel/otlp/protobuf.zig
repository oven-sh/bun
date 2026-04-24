//! Protobuf wire-format primitives for OTLP encoding/decoding.
//!
//! This is not a general protobuf runtime — it implements only the wire types
//! OTLP uses (varint, fixed64, fixed32, length-delimited) and a bounds-checked
//! reader. Messages are encoded by callers walking their own structs and
//! emitting tags + values directly; there is no reflection or descriptor table.

pub const WireType = tags.WireType;
pub const Tag = tags.Tag;

pub const Writer = struct {
    buf: *std.ArrayList(u8),
    gpa: std.mem.Allocator,

    pub fn init(gpa: std.mem.Allocator, buf: *std.ArrayList(u8)) Writer {
        return .{ .gpa = gpa, .buf = buf };
    }

    pub fn writeVarint(w: Writer, value: u64) OOM!void {
        var v = value;
        while (v >= 0x80) {
            try w.buf.append(w.gpa, @as(u8, @truncate(v)) | 0x80);
            v >>= 7;
        }
        try w.buf.append(w.gpa, @as(u8, @truncate(v)));
    }

    pub inline fn writeTag(w: Writer, comptime tag: Tag) OOM!void {
        try w.writeVarint((@as(u64, tag.num) << 3) | @intFromEnum(tag.wire));
    }

    pub fn writeBytes(w: Writer, comptime tag: Tag, bytes: []const u8) OOM!void {
        comptime bun.assert(tag.wire == .len);
        try w.writeTag(tag);
        try w.writeVarint(bytes.len);
        try w.buf.appendSlice(w.gpa, bytes);
    }

    pub inline fn writeString(w: Writer, comptime tag: Tag, str: []const u8) OOM!void {
        try w.writeBytes(tag, str);
    }

    pub fn writeFixed64(w: Writer, comptime tag: Tag, value: u64) OOM!void {
        comptime bun.assert(tag.wire == .i64);
        try w.writeTag(tag);
        try w.buf.appendSlice(w.gpa, std.mem.asBytes(&std.mem.nativeToLittle(u64, value)));
    }

    pub fn writeFixed32(w: Writer, comptime tag: Tag, value: u32) OOM!void {
        comptime bun.assert(tag.wire == .i32);
        try w.writeTag(tag);
        try w.buf.appendSlice(w.gpa, std.mem.asBytes(&std.mem.nativeToLittle(u32, value)));
    }

    pub fn writeDouble(w: Writer, comptime tag: Tag, value: f64) OOM!void {
        try w.writeFixed64(tag, @bitCast(value));
    }

    pub fn writeBool(w: Writer, comptime tag: Tag, value: bool) OOM!void {
        comptime bun.assert(tag.wire == .varint);
        try w.writeTag(tag);
        try w.buf.append(w.gpa, if (value) 1 else 0);
    }

    pub fn writeUint32(w: Writer, comptime tag: Tag, value: u32) OOM!void {
        comptime bun.assert(tag.wire == .varint);
        try w.writeTag(tag);
        try w.writeVarint(value);
    }

    pub fn writeInt64(w: Writer, comptime tag: Tag, value: i64) OOM!void {
        comptime bun.assert(tag.wire == .varint);
        try w.writeTag(tag);
        try w.writeVarint(@bitCast(value));
    }

    pub fn writeEnum(w: Writer, comptime tag: Tag, value: u32) OOM!void {
        try w.writeUint32(tag, value);
    }

    /// Encode a sub-message. Protobuf length-prefixes sub-messages, so we
    /// reserve a 1-byte varint slot optimistically (most sub-messages are
    /// <128 bytes), write the body, then back-patch — shifting right if more
    /// length bytes are needed.
    pub fn writeSubmessage(
        w: Writer,
        comptime tag: Tag,
        ctx: anytype,
        comptime body: fn (Writer, @TypeOf(ctx)) OOM!void,
    ) OOM!void {
        comptime bun.assert(tag.wire == .len);
        try w.writeTag(tag);
        const len_pos = w.buf.items.len;
        try w.buf.append(w.gpa, 0);
        const body_start = w.buf.items.len;
        try body(w, ctx);
        const body_len = w.buf.items.len - body_start;
        if (body_len < 0x80) {
            w.buf.items[len_pos] = @intCast(body_len);
        } else {
            const n = varintSize(body_len);
            const extra = n - 1;
            try w.buf.appendNTimes(w.gpa, 0, extra);
            std.mem.copyBackwards(u8, w.buf.items[body_start + extra ..], w.buf.items[body_start .. body_start + body_len]);
            var v = body_len;
            var i: usize = 0;
            while (v >= 0x80) : (i += 1) {
                w.buf.items[len_pos + i] = @as(u8, @truncate(v)) | 0x80;
                v >>= 7;
            }
            w.buf.items[len_pos + i] = @as(u8, @truncate(v));
        }
    }
};

pub const DecodeError = error{
    Truncated,
    VarintTooLong,
    InvalidWireType,
    InvalidFieldNumber,
    LengthExceedsBuffer,
    NestingTooDeep,
};

pub const Reader = struct {
    buf: []const u8,
    pos: usize = 0,

    pub fn init(buf: []const u8) Reader {
        return .{ .buf = buf };
    }

    pub inline fn remaining(r: *const Reader) usize {
        return r.buf.len - r.pos;
    }

    pub inline fn done(r: *const Reader) bool {
        return r.pos >= r.buf.len;
    }

    pub fn readVarint(r: *Reader) DecodeError!u64 {
        var result: u64 = 0;
        var shift: u6 = 0;
        var i: usize = 0;
        while (true) : (i += 1) {
            if (r.pos >= r.buf.len) return error.Truncated;
            const b = r.buf[r.pos];
            r.pos += 1;
            result |= @as(u64, b & 0x7f) << shift;
            if (b < 0x80) return result;
            if (i >= 9) return error.VarintTooLong;
            shift += 7;
        }
    }

    pub const FieldHeader = struct {
        num: u32,
        wire: WireType,
    };

    pub fn readTag(r: *Reader) DecodeError!FieldHeader {
        const key = try r.readVarint();
        const wire_raw: u3 = @truncate(key & 0x7);
        const wire: WireType = switch (wire_raw) {
            0 => .varint,
            1 => .i64,
            2 => .len,
            5 => .i32,
            else => return error.InvalidWireType,
        };
        const num = key >> 3;
        // Protobuf field numbers are 1..2^29-1; anything outside is malformed.
        if (num == 0 or num > std.math.maxInt(u29)) return error.InvalidFieldNumber;
        return .{ .num = @intCast(num), .wire = wire };
    }

    pub fn readBytes(r: *Reader) DecodeError![]const u8 {
        const len = try r.readVarint();
        if (len > r.remaining()) return error.LengthExceedsBuffer;
        const start = r.pos;
        r.pos += @intCast(len);
        return r.buf[start..r.pos];
    }

    pub fn readFixed64(r: *Reader) DecodeError!u64 {
        if (r.remaining() < 8) return error.Truncated;
        const v = std.mem.readInt(u64, r.buf[r.pos..][0..8], .little);
        r.pos += 8;
        return v;
    }

    pub fn readFixed32(r: *Reader) DecodeError!u32 {
        if (r.remaining() < 4) return error.Truncated;
        const v = std.mem.readInt(u32, r.buf[r.pos..][0..4], .little);
        r.pos += 4;
        return v;
    }

    /// Skip a field whose tag has already been read.
    pub fn skip(r: *Reader, wire: WireType) DecodeError!void {
        switch (wire) {
            .varint => _ = try r.readVarint(),
            .i64 => {
                if (r.remaining() < 8) return error.Truncated;
                r.pos += 8;
            },
            .i32 => {
                if (r.remaining() < 4) return error.Truncated;
                r.pos += 4;
            },
            .len => _ = try r.readBytes(),
        }
    }

    /// Return a sub-reader scoped to the next length-delimited field's body.
    pub fn submessage(r: *Reader) DecodeError!Reader {
        const body = try r.readBytes();
        return .{ .buf = body };
    }
};

pub fn varintSize(value: u64) usize {
    var n: usize = 1;
    var v = value >> 7;
    while (v > 0) : (v >>= 7) n += 1;
    return n;
}

test "varint encode/decode" {
    const cases = [_]struct { v: u64, bytes: []const u8 }{
        .{ .v = 0, .bytes = &.{0x00} },
        .{ .v = 1, .bytes = &.{0x01} },
        .{ .v = 127, .bytes = &.{0x7f} },
        .{ .v = 128, .bytes = &.{ 0x80, 0x01 } },
        .{ .v = 300, .bytes = &.{ 0xac, 0x02 } },
        .{ .v = 0xffffffff, .bytes = &.{ 0xff, 0xff, 0xff, 0xff, 0x0f } },
        .{ .v = std.math.maxInt(u64), .bytes = &.{ 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01 } },
    };
    const gpa = std.testing.allocator;
    for (cases) |c| {
        var list: std.ArrayList(u8) = .empty;
        defer list.deinit(gpa);
        try (Writer{ .gpa = gpa, .buf = &list }).writeVarint(c.v);
        try std.testing.expectEqualSlices(u8, c.bytes, list.items);

        var r = Reader.init(c.bytes);
        try std.testing.expectEqual(c.v, try r.readVarint());
        try std.testing.expect(r.done());
    }
}

test "reader bounds checking" {
    var r = Reader.init(&.{ 0x80, 0x80 });
    try std.testing.expectError(error.Truncated, r.readVarint());

    r = Reader.init(&.{ 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01 });
    try std.testing.expectError(error.VarintTooLong, r.readVarint());

    r = Reader.init(&.{ 0x05, 0x01, 0x02 });
    try std.testing.expectError(error.LengthExceedsBuffer, r.readBytes());

    r = Reader.init(&.{ 0x01, 0x02, 0x03 });
    try std.testing.expectError(error.Truncated, r.readFixed64());
}

test "tag round-trip" {
    const gpa = std.testing.allocator;
    var list: std.ArrayList(u8) = .empty;
    defer list.deinit(gpa);
    const w = Writer{ .gpa = gpa, .buf = &list };
    try w.writeTag(.{ .num = 5, .wire = .len });
    var r = Reader.init(list.items);
    const hdr = try r.readTag();
    try std.testing.expectEqual(@as(u32, 5), hdr.num);
    try std.testing.expectEqual(WireType.len, hdr.wire);
}

test "submessage with backpatch >128 bytes" {
    const gpa = std.testing.allocator;
    var list: std.ArrayList(u8) = .empty;
    defer list.deinit(gpa);
    const w = Writer{ .gpa = gpa, .buf = &list };
    const big = "x" ** 200;
    try w.writeSubmessage(.{ .num = 1, .wire = .len }, {}, struct {
        fn body(ww: Writer, _: void) OOM!void {
            try ww.writeString(.{ .num = 1, .wire = .len }, big);
        }
    }.body);
    var r = Reader.init(list.items);
    const hdr = try r.readTag();
    try std.testing.expectEqual(@as(u32, 1), hdr.num);
    var sub = try r.submessage();
    const hdr2 = try sub.readTag();
    try std.testing.expectEqual(@as(u32, 1), hdr2.num);
    const got = try sub.readBytes();
    try std.testing.expectEqualSlices(u8, big, got);
}

const bun = @import("bun");
const std = @import("std");
const tags = @import("OtlpProtoTags");
const OOM = std.mem.Allocator.Error;
