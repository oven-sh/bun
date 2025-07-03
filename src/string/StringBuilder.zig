const StringBuilder = @This();
const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;
const Environment = bun.Environment;
const assert = bun.assert;

len: usize = 0,
cap: usize = 0,
ptr: ?[*]u8 = null,

pub fn initCapacity(
    allocator: std.mem.Allocator,
    cap: usize,
) Allocator.Error!StringBuilder {
    return StringBuilder{
        .cap = cap,
        .len = 0,
        .ptr = (try allocator.alloc(u8, cap)).ptr,
    };
}

pub fn countZ(this: *StringBuilder, slice: []const u8) void {
    this.cap += slice.len + 1;
}

pub fn count(this: *StringBuilder, slice: []const u8) void {
    this.cap += slice.len;
}

pub fn allocate(this: *StringBuilder, allocator: Allocator) Allocator.Error!void {
    const slice = try allocator.alloc(u8, this.cap);
    this.ptr = slice.ptr;
    this.len = 0;
}

pub fn deinit(this: *StringBuilder, allocator: Allocator) void {
    if (this.ptr == null or this.cap == 0) return;
    allocator.free(this.ptr.?[0..this.cap]);
}

pub fn count16(this: *StringBuilder, slice: []const u16) void {
    const result = bun.simdutf.length.utf8.from.utf16.le(slice);
    this.cap += result;
}

pub fn count16Z(this: *StringBuilder, slice: [:0]const u16) void {
    const result = bun.strings.elementLengthUTF16IntoUTF8([:0]const u16, slice);
    this.cap += result + 1;
}

pub fn append16(this: *StringBuilder, slice: []const u16, fallback_allocator: std.mem.Allocator) ?[:0]u8 {
    var buf = this.writable();
    if (slice.len == 0) {
        buf[0] = 0;
        this.len += 1;
        return buf[0..0 :0];
    }

    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(slice, buf);
    if (result.status == .success) {
        this.len += result.count + 1;
        buf[result.count] = 0;
        return buf[0..result.count :0];
    } else {
        var list = std.ArrayList(u8).init(fallback_allocator);
        var out = bun.strings.toUTF8ListWithTypeBun(&list, []const u16, slice, false) catch return null;
        out.append(0) catch return null;
        return list.items[0 .. list.items.len - 1 :0];
    }
}

pub fn appendZ(this: *StringBuilder, slice: []const u8) [:0]const u8 {
    if (comptime Environment.allow_assert) {
        assert(this.len + 1 <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
    this.ptr.?[this.len + slice.len] = 0;
    const result = this.ptr.?[this.len..this.cap][0..slice.len :0];
    this.len += slice.len + 1;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return result;
}

pub fn appendStr(this: *StringBuilder, str: bun.String) []const u8 {
    const slice = str.toUTF8(bun.default_allocator);
    defer slice.deinit();
    return this.append(slice.slice());
}

pub fn append(this: *StringBuilder, slice: []const u8) []const u8 {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
    const result = this.ptr.?[this.len..this.cap][0..slice.len];
    this.len += slice.len;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return result;
}

pub fn addConcat(this: *StringBuilder, slices: []const []const u8) bun.StringPointer {
    var remain = this.allocatedSlice()[this.len..];
    var len: usize = 0;
    for (slices) |slice| {
        @memcpy(remain[0..slice.len], slice);
        remain = remain[slice.len..];
        len += slice.len;
    }
    return this.add(len);
}

pub fn add(this: *StringBuilder, len: usize) bun.StringPointer {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const start = this.len;
    this.len += len;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return bun.StringPointer{ .offset = @as(u32, @truncate(start)), .length = @as(u32, @truncate(len)) };
}
pub fn appendCount(this: *StringBuilder, slice: []const u8) bun.StringPointer {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const start = this.len;
    bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
    const result = this.ptr.?[this.len..this.cap][0..slice.len];
    _ = result;
    this.len += slice.len;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return bun.StringPointer{ .offset = @as(u32, @truncate(start)), .length = @as(u32, @truncate(slice.len)) };
}

pub fn appendCountZ(this: *StringBuilder, slice: []const u8) bun.StringPointer {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const start = this.len;
    bun.copy(u8, this.ptr.?[this.len..this.cap], slice);
    this.ptr.?[this.len + slice.len] = 0;
    const result = this.ptr.?[this.len..this.cap][0..slice.len];
    _ = result;
    this.len += slice.len;
    this.len += 1;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return bun.StringPointer{ .offset = @as(u32, @truncate(start)), .length = @as(u32, @truncate(slice.len)) };
}

pub fn fmt(this: *StringBuilder, comptime str: []const u8, args: anytype) []const u8 {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const buf = this.ptr.?[this.len..this.cap];
    const out = std.fmt.bufPrint(buf, str, args) catch unreachable;
    this.len += out.len;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return out;
}

pub fn fmtAppendCount(this: *StringBuilder, comptime str: []const u8, args: anytype) bun.StringPointer {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const buf = this.ptr.?[this.len..this.cap];
    const out = std.fmt.bufPrint(buf, str, args) catch unreachable;
    const off = this.len;
    this.len += out.len;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return bun.StringPointer{
        .offset = @as(u32, @truncate(off)),
        .length = @as(u32, @truncate(out.len)),
    };
}

pub fn fmtAppendCountZ(this: *StringBuilder, comptime str: []const u8, args: anytype) bun.StringPointer {
    if (comptime Environment.allow_assert) {
        assert(this.len <= this.cap); // didn't count everything
        assert(this.ptr != null); // must call allocate first
    }

    const buf = this.ptr.?[this.len..this.cap];
    const out = std.fmt.bufPrintZ(buf, str, args) catch unreachable;
    const off = this.len;
    this.len += out.len;
    this.len += 1;

    if (comptime Environment.allow_assert) assert(this.len <= this.cap);

    return bun.StringPointer{
        .offset = @as(u32, @truncate(off)),
        .length = @as(u32, @truncate(out.len)),
    };
}

pub fn fmtCount(this: *StringBuilder, comptime str: []const u8, args: anytype) void {
    this.cap += std.fmt.count(str, args);
}

pub fn allocatedSlice(this: *StringBuilder) []u8 {
    var ptr = this.ptr orelse return &[_]u8{};
    if (comptime Environment.allow_assert) {
        assert(this.cap > 0);
    }
    return ptr[0..this.cap];
}

pub fn writable(this: *StringBuilder) []u8 {
    var ptr = this.ptr orelse return &[_]u8{};
    if (comptime Environment.allow_assert) {
        assert(this.cap > 0);
    }
    return ptr[this.len..this.cap];
}
