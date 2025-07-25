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

const bun = @import("bun");
const Environment = bun.Environment;

const std = @import("std");
const posix = std.posix;
