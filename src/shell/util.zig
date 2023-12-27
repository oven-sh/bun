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

fn destroyPipe(pipe: [2]os.fd_t) void {
    os.close(pipe[0]);
    if (pipe[0] != pipe[1]) os.close(pipe[1]);
}

pub const OutKind = enum { stdout, stderr };

pub const Stdio = union(enum) {
    inherit: void,
    ignore: void,
    fd: bun.FileDescriptor,
    path: JSC.Node.PathLike,
    blob: JSC.WebCore.AnyBlob,
    pipe: ?JSC.WebCore.ReadableStream,
    array_buffer: struct { buf: JSC.ArrayBuffer.Strong, from_jsc: bool = false },

    pub fn isPiped(self: Stdio) bool {
        return switch (self) {
            .array_buffer, .blob, .pipe => true,
            else => false,
        };
    }

    pub fn setUpChildIoPosixSpawn(
        stdio: @This(),
        actions: *PosixSpawn.Actions,
        pipe_fd: [2]i32,
        std_fileno: i32,
    ) !void {
        switch (stdio) {
            .array_buffer, .blob, .pipe => {
                std.debug.assert(!(stdio == .blob and stdio.blob.needsToReadFile()));
                const idx: usize = if (std_fileno == 0) 0 else 1;

                try actions.dup2(pipe_fd[idx], std_fileno);
                try actions.close(pipe_fd[1 - idx]);
            },
            .fd => |fd| {
                try actions.dup2(fd, std_fileno);
            },
            .path => |pathlike| {
                const flag = if (std_fileno == bun.STDIN_FD) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                try actions.open(std_fileno, pathlike.slice(), flag | std.os.O.CREAT, 0o664);
            },
            .inherit => {
                if (comptime Environment.isMac) {
                    try actions.inherit(std_fileno);
                } else {
                    try actions.dup2(std_fileno, std_fileno);
                }
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
                    stdio_array[i] = Stdio{ .inherit = {} };
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

    stdio_array[i] = .{ .blob = blob };
    return true;
}

pub fn extractStdio(
    globalThis: *JSC.JSGlobalObject,
    i: u32,
    value: JSValue,
    stdio_array: []Stdio,
) bool {
    if (value.isEmptyOrUndefinedOrNull()) {
        return true;
    }

    if (value.isString()) {
        const str = value.getZigString(globalThis);
        if (str.eqlComptime("inherit")) {
            stdio_array[i] = Stdio{ .inherit = {} };
        } else if (str.eqlComptime("ignore")) {
            stdio_array[i] = Stdio{ .ignore = {} };
        } else if (str.eqlComptime("pipe")) {
            stdio_array[i] = Stdio{ .pipe = null };
        } else {
            globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null", .{});
            return false;
        }

        return true;
    } else if (value.isNumber()) {
        const fd_ = value.toInt64();
        if (fd_ < 0) {
            globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
            return false;
        }

        const fd = @as(bun.FileDescriptor, @intCast(fd_));

        switch (bun.FDTag.get(fd)) {
            .stdin => {
                if (i == bun.STDERR_FD or i == bun.STDOUT_FD) {
                    globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                    return false;
                }
            },

            .stdout, .stderr => {
                if (i == bun.STDIN_FD) {
                    globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                    return false;
                }
            },
            else => {},
        }

        stdio_array[i] = Stdio{ .fd = fd };

        return true;
    } else if (value.as(JSC.WebCore.Blob)) |blob| {
        return extractStdioBlob(globalThis, .{ .Blob = blob.dupe() }, i, stdio_array);
    } else if (value.as(JSC.WebCore.Request)) |req| {
        req.getBodyValue().toBlobIfPossible();
        return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
    } else if (value.as(JSC.WebCore.Response)) |req| {
        req.getBodyValue().toBlobIfPossible();
        return extractStdioBlob(globalThis, req.getBodyValue().useAsAnyBlob(), i, stdio_array);
    } else if (JSC.WebCore.ReadableStream.fromJS(value, globalThis)) |req_const| {
        var req = req_const;
        if (i == bun.STDIN_FD) {
            if (req.toAnyBlob(globalThis)) |blob| {
                return extractStdioBlob(globalThis, blob, i, stdio_array);
            }

            switch (req.ptr) {
                .File, .Blob => unreachable,
                .Direct, .JavaScript, .Bytes => {
                    if (req.isLocked(globalThis)) {
                        globalThis.throwInvalidArguments("ReadableStream cannot be locked", .{});
                        return false;
                    }

                    stdio_array[i] = .{ .pipe = req };
                    return true;
                },
                else => {},
            }

            globalThis.throwInvalidArguments("Unsupported ReadableStream type", .{});
            return false;
        }
    } else if (value.asArrayBuffer(globalThis)) |array_buffer| {
        if (array_buffer.slice().len == 0) {
            globalThis.throwInvalidArguments("ArrayBuffer cannot be empty", .{});
            return false;
        }

        stdio_array[i] = .{
            .array_buffer = .{ .buf = JSC.ArrayBuffer.Strong{
                .array_buffer = array_buffer,
                .held = JSC.Strong.create(array_buffer.value, globalThis),
            } },
        };

        return true;
    }

    globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
    return false;
}

pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;
