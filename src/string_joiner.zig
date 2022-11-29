/// Rope-like data structure for joining many small strings into one big string.
const Joiner = @This();

const string = @import("string_types.zig").string;
const Allocator = @import("std").mem.Allocator;
const assert = @import("std").debug.assert;
const copy = @import("std").mem.copy;
const Env = @import("./env.zig");
const ObjectPool = @import("./pool.zig").ObjectPool;

const default_allocator = @import("bun").default_allocator;

const Joinable = struct {
    offset: u31 = 0,
    needs_deinit: bool = false,
    allocator: std.mem.Allocator = undefined,
    slice: []const u8 = "",

    pub const Pool = ObjectPool(Joinable, null, true, 4);
};

last_byte: u8 = 0,
len: usize = 0,
use_pool: bool = true,
node_allocator: std.mem.Allocator = undefined,

head: ?*Joinable.Pool.Node = null,
tail: ?*Joinable.Pool.Node = null,

pub fn done(this: *Joiner, allocator: std.mem.Allocator) ![]u8 {
    if (this.head == null) {
        var out: []u8 = &[_]u8{};
        return out;
    }

    var slice = try allocator.alloc(u8, this.len);
    var remaining = slice;
    var el_ = this.head;
    while (el_) |join| {
        const to_join = join.data.slice[join.data.offset..];
        @memcpy(remaining.ptr, to_join.ptr, to_join.len);

        remaining = remaining[@minimum(remaining.len, to_join.len)..];

        var prev = join;
        el_ = join.next;
        if (prev.data.needs_deinit) {
            prev.data.allocator.free(prev.data.slice);
            prev.data = Joinable{};
        }

        if (this.use_pool) prev.release();
    }

    return slice[0 .. slice.len - remaining.len];
}

pub fn lastByte(this: *const Joiner) u8 {
    if (this.tail) |tail| {
        const slice = tail.data.slice[tail.data.offset..];
        return if (slice.len > 0) slice[slice.len - 1] else 0;
    }

    return 0;
}

pub fn append(this: *Joiner, slice: string, offset: u32, allocator: ?std.mem.Allocator) void {
    const data = slice[offset..];
    this.len += @truncate(u32, data.len);

    var new_tail = if (this.use_pool)
        Joinable.Pool.get(default_allocator)
    else
        (this.node_allocator.create(Joinable.Pool.Node) catch unreachable);

    new_tail.* = .{
        .allocator = default_allocator,
        .data = Joinable{
            .offset = @truncate(u31, offset),
            .allocator = allocator orelse undefined,
            .needs_deinit = allocator != null,
            .slice = slice,
        },
    };

    var tail = this.tail orelse {
        this.tail = new_tail;
        this.head = new_tail;
        return;
    };
    tail.next = new_tail;
    this.tail = new_tail;
}

const std = @import("std");
