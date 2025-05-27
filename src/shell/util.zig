const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const posix = std.posix;

pub const OutKind = enum {
    stdout,
    stderr,

    pub fn toFd(this: OutKind) bun.FileDescriptor {
        return switch (this) {
            .stdout => .stdout(),
            .stderr => .stderr(),
        };
    }
};

pub const Stdio = bun.spawn.Stdio;

pub const WatchFd = if (Environment.isLinux) posix.fd_t else i32;
