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

pub const Stdio = union(enum) {
    /// When set to true, it means to capture the output
    inherit: struct { captured: ?*bun.ByteList = null },
    ignore: void,
    fd: bun.FileDescriptor,
    dup2: struct { out: OutKind, to: OutKind },
    path: JSC.Node.PathLike,
    blob: JSC.WebCore.AnyBlob,
    pipe: ?JSC.WebCore.ReadableStream,
    array_buffer: struct { buf: JSC.ArrayBuffer.Strong, from_jsc: bool = false },

    pub fn isPiped(self: Stdio) bool {
        return switch (self) {
            .array_buffer, .blob, .pipe => true,
            .inherit => self.inherit.captured != null,
            else => false,
        };
    }

    pub fn setUpChildIoPosixSpawn(
        stdio: @This(),
        actions: *PosixSpawn.Actions,
        pipe_fd: [2]bun.FileDescriptor,
        stderr_pipe_fds: [2]bun.FileDescriptor,
        comptime std_fileno: bun.FileDescriptor,
    ) !void {
        switch (stdio) {
            .dup2 => {
                // This is a hack to get around the ordering of the spawn actions.
                // If stdout is set so that it redirects to stderr, the order of actions will be like this:
                // 0. dup2(stderr, stdout) - this makes stdout point to stderr
                // 1. setup stderr (will make stderr point to write end of `stderr_pipe_fds`)
                // This is actually wrong, 0 will execute before 1 so stdout ends up writing to stderr instead of the pipe
                // So we have to instead do `dup2(stderr_pipe_fd[1], stdout)`
                // Right now we only allow one output redirection so it's okay.
                if (comptime std_fileno == bun.STDOUT_FD) {
                    const idx: usize = if (std_fileno == bun.STDIN_FD) 0 else 1;
                    try actions.dup2(stderr_pipe_fds[idx], stdio.dup2.out.toFd());
                } else try actions.dup2(stdio.dup2.to.toFd(), stdio.dup2.out.toFd());
            },
            .array_buffer, .blob, .pipe => {
                std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                const idx: usize = if (std_fileno == bun.STDIN_FD) 0 else 1;

                try actions.dup2(pipe_fd[idx], std_fileno);
                try actions.close(pipe_fd[1 - idx]);
            },
            .inherit => {
                if (stdio.inherit.captured != null) {
                    // Same as above
                    std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                    const idx: usize = if (std_fileno == bun.STDIN_FD) 0 else 1;

                    try actions.dup2(pipe_fd[idx], std_fileno);
                    try actions.close(pipe_fd[1 - idx]);
                    return;
                }

                if (comptime Environment.isMac) {
                    try actions.inherit(std_fileno);
                } else {
                    try actions.dup2(std_fileno, std_fileno);
                }
            },
            .fd => |fd| {
                try actions.dup2(fd, std_fileno);
            },
            .path => |pathlike| {
                const flag = if (std_fileno == bun.STDIN_FD) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                try actions.open(std_fileno, pathlike.slice(), flag | std.os.O.CREAT, 0o664);
            },
            .ignore => {
                const flag = if (std_fileno == bun.STDIN_FD) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                try actions.openZ(std_fileno, "/dev/null", flag, 0o664);
            },
        }
    }
};

pub fn extractStdioBlob(
    globalThis: *JSC.JSGlobalObject,
    blob: JSC.WebCore.AnyBlob,
    i: u32,
    stdio_array: []Stdio,
) bool {
    const fd = bun.stdio(i);

    if (blob.needsToReadFile()) {
        if (blob.store()) |store| {
            if (store.data.file.pathlike == .fd) {
                if (store.data.file.pathlike.fd == fd) {
                    stdio_array[i] = Stdio{ .inherit = .{} };
                } else {
                    switch (bun.FDTag.get(i)) {
                        .stdin => {
                            if (i == 1 or i == 2) {
                                globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                return false;
                            }
                        },

                        .stdout, .stderr => {
                            if (i == 0) {
                                globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                                return false;
                            }
                        },
                        else => {},
                    }

                    stdio_array[i] = Stdio{ .fd = store.data.file.pathlike.fd };
                }

                return true;
            }

            stdio_array[i] = .{ .path = store.data.file.pathlike.path };
            return true;
        }
    }

    if (i == 1 or i == 2) {
        globalThis.throwInvalidArguments("Blobs are immutable, and cannot be used for stdout/stderr", .{});
        return false;
    }

    stdio_array[i] = .{ .blob = blob };
    return true;
}

pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;
