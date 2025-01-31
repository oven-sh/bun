const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;

var title_mutex = bun.Mutex{};

pub fn setTitle(allocator: std.mem.Allocator, value: []const u8) void {
    if (builtin.os.tag == .linux) {
        const trunc = allocator.dupeZ(u8, value[0..@min(value.len, 16)]) catch bun.outOfMemory();
        defer allocator.free(trunc);

        // TODO: we should handle the error differently
        _ = std.posix.prctl(std.posix.PR.SET_NAME, .{@intFromPtr(value.ptr)}) catch @panic("Bad syscall");
    } else {
        title_mutex.lock();
        defer title_mutex.unlock();
        if (bun.CLI.Bun__Node__ProcessTitle) |_| bun.default_allocator.free(bun.CLI.Bun__Node__ProcessTitle.?);
        bun.CLI.Bun__Node__ProcessTitle = allocator.dupe(u8, bun.default_allocator) catch bun.outOfMemory();
    }
}

pub fn getTitle(allocator: std.mem.Allocator) []const u8 {
    title_mutex.lock();
    defer title_mutex.unlock();
    if (builtin.os.tag == .linux) {
        var buffer: [16]u8 = [_]u8{0} ** 16;
        // TODO: we should handle the error differently
        _ = std.posix.prctl(std.posix.PR.GET_NAME, .{@intFromPtr(&buffer)}) catch @panic("Bad syscall");

        if (bun.CLI.Bun__Node__ProcessTitle) |_| bun.default_allocator.free(bun.CLI.Bun__Node__ProcessTitle.?);
        bun.CLI.Bun__Node__ProcessTitle = allocator.dupe(u8, std.mem.sliceTo(&buffer, 0)) catch bun.outOfMemory();
    }

    return bun.CLI.Bun__Node__ProcessTitle orelse "bun";
}
