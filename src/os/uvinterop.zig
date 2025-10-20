//! Utilities for interoping with libuv.
//!
//! TODO(markovejnovic): This file probably doesn't belong in src/os. Consider moving it to
//! src/bunuv or similar.
extern fn uv_translate_sys_error(sys_errno: c_int) callconv(.C) c_int;
fn translateSysErrorToUv(sys_errno: c_int) c_int {
    // TODO(markovejnovic): This is a hack because uv_translate_sys_error is stubbed out on POSIX.
    if (bun.Environment.isPosix) {
        // Exactly matches libuv's behavior.
        return if (sys_errno <= 0) sys_errno else -sys_errno;
    }

    if (bun.Environment.isWindows) {
        return uv_translate_sys_error(sys_errno);
    }
}

pub export fn bunuv__os_homedir(buffer: ?[*]u8, size: ?*usize) callconv(.C) c_int {
    if (buffer == null or size == null) {
        return translateSysErrorToUv(@intFromEnum(bun.sys.E.INVAL));
    }

    // TODO(markovejnovic): This implementation could be slightly better. I don't know how to
    //                      return the total size needed (from os.HomeDir.query) if the buffer is
    //                      too small.
    var homedir = bun.os.HomeDir.query(bun.default_allocator);
    switch (homedir) {
        .result => |*r| {
            defer r.deinit();

            const out = r.slice();
            // +1 for null terminator
            if (out.len + 1 > size.?.*) {
                size.?.* = out.len + 1;
                return libuv.UV_ENOBUFS;
            }

            @memcpy(buffer.?[0..out.len], out);
            buffer.?[out.len] = 0; // null terminator
            size.?.* = out.len + 1;
            return 0;
        },
        .err => |err| {
            return translateSysErrorToUv(err.errno);
        },
    }
}

const bun = @import("bun");
const libuv = @import("../deps/libuv.zig");
