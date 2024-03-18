const IPC = @import("../bun.js/ipc.zig");
const Allocator = std.mem.Allocator;
const uws = bun.uws;
const std = @import("std");
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const Async = bun.Async;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../which.zig");
const Output = @import("root").bun.Output;
const PosixSpawn = @import("../bun.js/api/bun/spawn.zig").PosixSpawn;
const os = std.os;

pub const OutKind = enum {
    stdout,
    stderr,
    pub fn toFd(this: OutKind) bun.FileDescriptor {
        return switch (this) {
            .stdout => bun.STDOUT_FD,
            .stderr => bun.STDERR_FD,
        };
    }
};

pub const Stdio = bun.spawn.Stdio;

pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;
