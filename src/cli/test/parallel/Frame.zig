//! Wire protocol on both stdin and fd 3: length-prefixed binary frames.
//!   [u32 LE payload_len][u8 kind][payload]
//! Strings within a payload are [u32 LE len][bytes].

pub const Kind = enum(u8) {
    // worker → coordinator
    ready, // (empty)
    file_start, // u32 file_idx
    test_done, // u32 file_idx, str formatted_line (ANSI included; printed verbatim)
    file_done, // 9 × u32: file_idx, pass, fail, skip, todo, expectations, skipped_label, files, unhandled
    repeat_bufs, // 3 × str: failures, skips, todos (verbatim repeat-buffer bytes)
    junit_file, // str path
    coverage_file, // str path
    // coordinator → worker
    run, // u32 file_idx, str path
    shutdown, // (empty)
};

/// Upper bound on a single IPC frame payload. The protocol is internal but
/// fd 3 is reachable from test JS via `fs.writeSync(3, ...)`; rejecting
/// nonsensical lengths up-front prevents both a `5 + len` u32 overflow and
/// an unbounded allocation.
pub const max_payload: u32 = 64 * 1024 * 1024;

/// Minimal length-prefixed binary codec. Frames build into a reusable buffer
/// then flush in a single write so partial reads on the other side never see a
/// torn header.
pub const Frame = @This();

buf: std.ArrayListUnmanaged(u8) = .empty,

pub fn begin(self: *Frame, kind: Kind) void {
    self.buf.clearRetainingCapacity();
    // reserve header; payload_len patched in send()
    bun.handleOom(self.buf.appendNTimes(bun.default_allocator, 0, 4));
    bun.handleOom(self.buf.append(bun.default_allocator, @intFromEnum(kind)));
}
pub fn u32_(self: *Frame, v: u32) void {
    var le: [4]u8 = undefined;
    std.mem.writeInt(u32, &le, v, .little);
    bun.handleOom(self.buf.appendSlice(bun.default_allocator, &le));
}
pub fn str(self: *Frame, s: []const u8) void {
    self.u32_(@intCast(s.len));
    bun.handleOom(self.buf.appendSlice(bun.default_allocator, s));
}
pub fn send(self: *Frame, fd: bun.FD) void {
    const payload_len: u32 = @intCast(self.buf.items.len - 5);
    std.mem.writeInt(u32, self.buf.items[0..4], payload_len, .little);
    writeAll(fd, self.buf.items);
}
pub fn deinit(self: *Frame) void {
    self.buf.deinit(bun.default_allocator);
}

/// Payload reader; bounds-checked, returns zero/empty on truncation.
pub const Reader = struct {
    p: []const u8,
    pub fn u32_(self: *Reader) u32 {
        if (self.p.len < 4) return 0;
        const v = std.mem.readInt(u32, self.p[0..4], .little);
        self.p = self.p[4..];
        return v;
    }
    pub fn str(self: *Reader) []const u8 {
        const n = self.u32_();
        if (self.p.len < n) return "";
        const s = self.p[0..n];
        self.p = self.p[n..];
        return s;
    }
};

/// fd 3 in the worker. On Windows this must be a libuv (CRT) fd so
/// `uv_get_osfhandle(3)` resolves to the inherited handle; can't be a
/// file-scope const because `FD.fromUV` rejects >2 at comptime.
pub fn ipcFd() bun.FD {
    return .fromUV(3);
}

pub fn writeAll(fd: bun.FD, bytes: []const u8) void {
    var remaining = bytes;
    while (remaining.len > 0) {
        switch (bun.sys.write(fd, remaining)) {
            .result => |n| remaining = remaining[n..],
            .err => |e| switch (e.getErrno()) {
                .INTR => continue,
                else => return,
            },
        }
    }
}

/// Blocking read until one complete frame header sits at buf[0..]. Returns
/// {kind, len}; payload is buf.items[5 .. 5+len]. Caller consumes before the
/// next call.
pub fn readBlocking(fd: bun.FD, buf: *std.ArrayListUnmanaged(u8)) ?struct { kind: Kind, len: u32 } {
    while (true) {
        if (buf.items.len >= 5) {
            const len = std.mem.readInt(u32, buf.items[0..4], .little);
            if (len > max_payload) return null;
            if (buf.items.len >= @as(usize, 5) + len) {
                const kind = std.meta.intToEnum(Kind, buf.items[4]) catch return null;
                return .{ .kind = kind, .len = len };
            }
        }
        var chunk: [4096]u8 = undefined;
        switch (bun.sys.read(fd, &chunk)) {
            .result => |n| {
                if (n == 0) return null;
                bun.handleOom(buf.appendSlice(bun.default_allocator, chunk[0..n]));
            },
            .err => |e| switch (e.getErrno()) {
                .INTR => continue,
                else => return null,
            },
        }
    }
}

const bun = @import("bun");
const std = @import("std");
