const string = @import("string_types.zig").string;
const Allocator = @import("std").mem.Allocator;
const assert = @import("std").debug.assert;
const copy = @import("std").mem.copy;

const StringBuilder = @This();

len: usize = 0,
cap: usize = 0,
ptr: ?[*]u8 = null,

pub fn count(this: *StringBuilder, slice: string) void {
    this.cap += slice.len;
}

pub fn allocate(this: *StringBuilder, allocator: Allocator) !void {
    var slice = try allocator.alloc(u8, this.cap);
    this.ptr = slice.ptr;
    this.len = 0;
}

pub fn append(this: *StringBuilder, slice: string) string {
    assert(this.len <= this.cap); // didn't count everything
    assert(this.ptr != null); // must call allocate first

    copy(u8, this.ptr.?[this.len..this.cap], slice);
    const result = this.ptr.?[this.len..this.cap][0..slice.len];
    this.len += slice.len;

    assert(this.len <= this.cap);
    return result;
}

const std = @import("std");
pub fn fmt(this: *StringBuilder, comptime str: string, args: anytype) string {
    assert(this.len <= this.cap); // didn't count everything
    assert(this.ptr != null); // must call allocate first

    var buf = this.ptr.?[this.len..this.cap];
    const out = std.fmt.bufPrint(buf, str, args) catch unreachable;
    this.len += out.len;

    assert(this.len <= this.cap);

    return out;
}
