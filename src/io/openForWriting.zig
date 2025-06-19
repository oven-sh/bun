pub fn openForWriting(
    dir: bun.FileDescriptor,
    input_path: anytype,
    input_flags: i32,
    mode: bun.Mode,
    pollable: *bool,
    is_socket: *bool,
    force_sync: bool,
    out_nonblocking: *bool,
    comptime Ctx: type,
    ctx: Ctx,
    comptime onForceSyncOrIsaTTY: *const fn (Ctx) void,
    comptime isPollable: *const fn (mode: bun.Mode) bool,
) JSC.Maybe(bun.FileDescriptor) {
    return openForWritingImpl(
        dir,
        input_path,
        input_flags,
        mode,
        pollable,
        is_socket,
        force_sync,
        out_nonblocking,
        Ctx,
        ctx,
        onForceSyncOrIsaTTY,
        isPollable,
        bun.sys.openat,
    );
}

pub fn openForWritingImpl(
    dir: bun.FileDescriptor,
    input_path: anytype,
    input_flags: i32,
    mode: bun.Mode,
    pollable: *bool,
    is_socket: *bool,
    force_sync: bool,
    out_nonblocking: *bool,
    comptime Ctx: type,
    ctx: Ctx,
    comptime onForceSyncOrIsaTTY: *const fn (Ctx) void,
    comptime isPollable: *const fn (mode: bun.Mode) bool,
    comptime openat: *const fn (dir: bun.FileDescriptor, path: [:0]const u8, flags: i32, mode: bun.Mode) JSC.Maybe(bun.FileDescriptor),
) JSC.Maybe(bun.FileDescriptor) {
    const PathT = @TypeOf(input_path);
    if (PathT != bun.webcore.PathOrFileDescriptor and PathT != [:0]const u8 and PathT != [:0]u8) {
        @compileError("Only string or PathOrFileDescriptor is supported but got: " ++ @typeName(PathT));
    }

    // TODO: this should be concurrent.
    var isatty = false;
    var is_nonblocking = false;
    const result =
        switch (PathT) {
            bun.webcore.PathOrFileDescriptor => switch (input_path) {
                .path => |path| brk: {
                    is_nonblocking = true;
                    break :brk bun.sys.openatA(dir, path.slice(), input_flags, mode);
                },
                .fd => |fd_| brk: {
                    const duped = bun.sys.dupWithFlags(fd_, 0);

                    break :brk duped;
                },
            },
            [:0]const u8, [:0]u8 => openat(dir, input_path, input_flags, mode),
            else => unreachable,
        };
    const fd = switch (result) {
        .err => |err| return .{ .err = err },
        .result => |fd| fd,
    };

    if (comptime Environment.isPosix) {
        switch (bun.sys.fstat(fd)) {
            .err => |err| {
                fd.close();
                return .{ .err = err };
            },
            .result => |stat| {
                // pollable.* = bun.sys.isPollable(stat.mode);
                pollable.* = isPollable(stat.mode);
                if (!pollable.*) {
                    isatty = std.posix.isatty(fd.native());
                }

                if (isatty) {
                    pollable.* = true;
                }

                is_socket.* = std.posix.S.ISSOCK(stat.mode);

                if (force_sync or isatty) {
                    // Prevents interleaved or dropped stdout/stderr output for terminals.
                    // As noted in the following reference, local TTYs tend to be quite fast and
                    // this behavior has become expected due historical functionality on OS X,
                    // even though it was originally intended to change in v1.0.2 (Libuv 1.2.1).
                    // Ref: https://github.com/nodejs/node/pull/1771#issuecomment-119351671
                    _ = bun.sys.updateNonblocking(fd, false);
                    is_nonblocking = false;
                    // this.force_sync = true;
                    // this.writer.force_sync = true;
                    onForceSyncOrIsaTTY(ctx);
                } else if (!is_nonblocking) {
                    const flags = switch (bun.sys.getFcntlFlags(fd)) {
                        .result => |flags| flags,
                        .err => |err| {
                            fd.close();
                            return .{ .err = err };
                        },
                    };
                    is_nonblocking = (flags & @as(@TypeOf(flags), bun.O.NONBLOCK)) != 0;

                    if (!is_nonblocking) {
                        if (bun.sys.setNonblocking(fd) == .result) {
                            is_nonblocking = true;
                        }
                    }
                }

                out_nonblocking.* = is_nonblocking and pollable.*;
            },
        }

        return .{ .result = fd };
    }

    if (comptime Environment.isWindows) {
        pollable.* = (bun.windows.GetFileType(fd.cast()) & bun.windows.FILE_TYPE_PIPE) != 0 and !force_sync;
        return .{ .result = fd };
    }
}

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const JSC = bun.JSC;
