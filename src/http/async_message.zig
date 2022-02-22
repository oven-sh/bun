const std = @import("std");
const ObjectPool = @import("../pool.zig").ObjectPool;
const AsyncIO = @import("io");

pub const buffer_pool_len = std.math.maxInt(u16);
pub const BufferPoolBytes = [buffer_pool_len]u8;
pub const BufferPool = ObjectPool(BufferPoolBytes, null, false, 4);
const Environment = @import("../env.zig");
const AsyncMessage = @This();

used: u32 = 0,
sent: u32 = 0,
completion: AsyncIO.Completion = undefined,
buf: []u8 = undefined,
pooled: ?*BufferPool.Node = null,
allocator: std.mem.Allocator,
next: ?*AsyncMessage = null,
context: *anyopaque = undefined,
released: bool = false,

var _first_ssl: ?*AsyncMessage = null;

pub fn getSSL(allocator: std.mem.Allocator) *AsyncMessage {
    if (_first_ssl) |first| {
        var prev = first;

        std.debug.assert(prev.released);
        if (prev.next) |next| {
            _first_ssl = next;
            prev.next = null;
        } else {
            _first_ssl = null;
        }
        prev.released = false;

        return prev;
    }

    var msg = allocator.create(AsyncMessage) catch unreachable;
    msg.* = AsyncMessage{
        .allocator = allocator,
        .pooled = null,
        .buf = &[_]u8{},
    };
    return msg;
}

var _first: ?*AsyncMessage = null;
pub fn get(allocator: std.mem.Allocator) *AsyncMessage {
    if (_first) |first| {
        var prev = first;
        if (Environment.allow_assert) std.debug.assert(prev.released);
        prev.released = false;

        if (first.next) |next| {
            _first = next;
            prev.next = null;
            return prev;
        } else {
            _first = null;
        }

        return prev;
    }

    var msg = allocator.create(AsyncMessage) catch unreachable;
    var pooled = BufferPool.get(allocator);
    msg.* = AsyncMessage{ .allocator = allocator, .buf = &pooled.data, .pooled = pooled };
    return msg;
}

pub fn release(self: *AsyncMessage) void {
    self.used = 0;
    self.sent = 0;
    if (self.released) return;
    self.released = true;

    if (self.pooled != null) {
        var old = _first;
        _first = self;
        self.next = old;
    } else {
        var old = _first_ssl;
        self.next = old;
        _first_ssl = self;
    }
}

const WriteResponse = struct {
    written: u32 = 0,
    overflow: bool = false,
};

pub fn writeAll(this: *AsyncMessage, buffer: []const u8) WriteResponse {
    var remain = this.buf[this.used..];
    var writable = buffer[0..@minimum(buffer.len, remain.len)];
    if (writable.len == 0) {
        return .{ .written = 0, .overflow = buffer.len > 0 };
    }

    std.mem.copy(u8, remain, writable);
    this.used += @intCast(u16, writable.len);

    return .{ .written = @truncate(u32, writable.len), .overflow = writable.len == remain.len };
}

pub inline fn slice(this: *const AsyncMessage) []const u8 {
    return this.buf[0..this.used][this.sent..];
}

pub inline fn available(this: *AsyncMessage) []u8 {
    return this.buf[0 .. this.buf.len - this.used];
}
