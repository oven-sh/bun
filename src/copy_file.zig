// Transfer all the data between two file descriptors in the most efficient way.
// The copy starts at offset 0, the initial offsets are preserved.
// No metadata is transferred over.
const std = @import("std");
const os = std.os;
const math = std.math;
const bun = @import("root").bun;
const strings = bun.strings;
const Environment = bun.Environment;

pub const CopyFileRangeError = error{
    FileTooBig,
    InputOutput,
    /// `in` is not open for reading; or `out` is not open  for  writing;
    /// or the  `O.APPEND`  flag  is  set  for `out`.
    FilesOpenedWithWrongFlags,
    IsDir,
    OutOfMemory,
    NoSpaceLeft,
    Unseekable,
    PermissionDenied,
    FileBusy,
} || os.PReadError || os.PWriteError || os.UnexpectedError;

const CopyFileError = error{SystemResources} || CopyFileRangeError || os.SendFileError;

const InputType = if (Environment.isWindows) bun.OSPathSliceZ else os.fd_t;

/// In a `bun install` with prisma, this reduces the system call count from ~18,000 to ~12,000
///
/// The intended order here is:
/// 1. ioctl_ficlone
/// 2. copy_file_range
/// 3. sendfile()
/// 4. read() write() loop
///
/// copy_file_range is supposed to do all the fast ways. It might be unnecessary
/// to do ioctl_ficlone.
///
/// sendfile() is a good fallback to avoid the read-write loops. sendfile() improves
/// performance by moving the copying step to the kernel.
///
/// On Linux, sendfile() can work between any two file descriptors which can be mmap'd.
/// This means that it cannot work with TTYs and some special devices
/// But it can work with two ordinary files
///
/// on macoS and other platforms, sendfile() only works when one of the ends is a socket
/// and in general on macOS, it doesn't seem to have much performance impact.
const LinuxCopyFileState = packed struct {
    /// This is the most important flag for reducing the system call count
    /// When copying files from one folder to another, if we see EXDEV once
    /// there's a very good chance we will see it for every file thereafter in that folder.
    /// So we should remember whether or not we saw it and keep the state for roughly one directory tree.
    has_seen_exdev: bool = false,
    has_ioctl_ficlone_failed: bool = false,
    has_copy_file_range_failed: bool = false,
    has_sendfile_failed: bool = false,
};
const EmptyCopyFileState = struct {};
pub const CopyFileState = if (Environment.isLinux) LinuxCopyFileState else EmptyCopyFileState;
pub fn copyFileWithState(in: InputType, out: InputType, copy_file_state: *CopyFileState) CopyFileError!void {
    if (comptime Environment.isMac) {
        const rc = os.system.fcopyfile(in, out, null, os.system.COPYFILE_DATA);
        switch (os.errno(rc)) {
            .SUCCESS => return,
            .NOMEM => return error.SystemResources,
            // The source file is not a directory, symbolic link, or regular file.
            // Try with the fallback path before giving up.
            .OPNOTSUPP => {},
            else => |err| return os.unexpectedErrno(err),
        }
    }

    if (comptime Environment.isLinux) {
        if (can_use_ioctl_ficlone() and !copy_file_state.has_seen_exdev and !copy_file_state.has_ioctl_ficlone_failed) {
            // We only check once if the ioctl is supported, and cache the result.
            // EXT4 does not support FICLONE.
            const rc = bun.C.linux.ioctl_ficlone(bun.toFD(out), bun.toFD(in));
            // the ordering is flipped but it is consistent with other system calls.
            bun.sys.syslog("ioctl_ficlone({d}, {d}) = {d}", .{ in, out, rc });
            switch (std.os.linux.getErrno(rc)) {
                .SUCCESS => return,
                .XDEV => {
                    copy_file_state.has_seen_exdev = true;
                },

                // Don't worry about EINTR here.
                .INTR => {},

                .ACCES, .BADF, .INVAL, .OPNOTSUPP, .NOSYS, .PERM => {
                    bun.Output.debug("ioctl_ficlonerange is NOT supported", .{});
                    can_use_ioctl_ficlone_.store(-1, .Monotonic);
                    copy_file_state.has_ioctl_ficlone_failed = true;
                },
                else => {
                    // Failed for some other reason
                    copy_file_state.has_ioctl_ficlone_failed = true;
                },
            }
        }

        // Try copy_file_range first as that works at the FS level and is the
        // most efficient method (if available).
        var offset: u64 = 0;
        cfr_loop: while (true) {
            // The kernel checks the u64 value `offset+count` for overflow, use
            // a 32 bit value so that the syscall won't return EINVAL except for
            // impossibly large files (> 2^64-1 - 2^32-1).
            const amt = try copyFileRange(in, out, math.maxInt(i32) - 1, 0, copy_file_state);
            // Terminate when no data was copied
            if (amt == 0) break :cfr_loop;
            offset += amt;
        }
        return;
    }

    if (comptime Environment.isWindows) {
        if (bun.windows.CopyFileW(in.ptr, out.ptr, 0) == bun.windows.FALSE) {
            switch (@as(bun.C.E, @enumFromInt(@intFromEnum(bun.windows.GetLastError())))) {
                .SUCCESS => return,
                .FBIG => return error.FileTooBig,
                .IO => return error.InputOutput,
                .ISDIR => return error.IsDir,
                .NOMEM => return error.OutOfMemory,
                .NOSPC => return error.NoSpaceLeft,
                .OVERFLOW => return error.Unseekable,
                .PERM => return error.PermissionDenied,
                .TXTBSY => return error.FileBusy,
                else => return error.Unexpected,
            }
        }

        return;
    }

    // Sendfile is a zero-copy mechanism iff the OS supports it, otherwise the
    // fallback code will copy the contents chunk by chunk.
    const empty_iovec = [0]os.iovec_const{};
    var offset: u64 = 0;
    sendfile_loop: while (true) {
        const amt = try os.sendfile(out, in, offset, 0, &empty_iovec, &empty_iovec, 0);
        // Terminate when no data was copied
        if (amt == 0) break :sendfile_loop;
        offset += amt;
    }
}
pub fn copyFile(in: InputType, out: InputType) CopyFileError!void {
    var state: CopyFileState = .{};
    return copyFileWithState(in, out, &state);
}
const Platform = bun.analytics.GenerateHeader.GeneratePlatform;

var can_use_copy_file_range = std.atomic.Value(i32).init(0);
pub inline fn disableCopyFileRangeSyscall() void {
    if (comptime !Environment.isLinux) {
        return;
    }
    can_use_copy_file_range.store(-1, .Monotonic);
}
pub fn canUseCopyFileRangeSyscall() bool {
    const result = can_use_copy_file_range.load(.Monotonic);
    if (result == 0) {
        // This flag mostly exists to make other code more easily testable.
        if (bun.getenvZ("BUN_CONFIG_DISABLE_COPY_FILE_RANGE") != null) {
            bun.Output.debug("copy_file_range is disabled by BUN_CONFIG_DISABLE_COPY_FILE_RANGE", .{});
            can_use_copy_file_range.store(-1, .Monotonic);
            return false;
        }

        const kernel = Platform.kernelVersion();
        if (kernel.orderWithoutTag(.{ .major = 4, .minor = 5 }).compare(.gte)) {
            bun.Output.debug("copy_file_range is supported", .{});
            can_use_copy_file_range.store(1, .Monotonic);
            return true;
        } else {
            bun.Output.debug("copy_file_range is NOT supported", .{});
            can_use_copy_file_range.store(-1, .Monotonic);
            return false;
        }
    }

    return result == 1;
}

pub var can_use_ioctl_ficlone_ = std.atomic.Value(i32).init(0);
pub inline fn disable_ioctl_ficlone() void {
    if (comptime !Environment.isLinux) {
        return;
    }
    can_use_ioctl_ficlone_.store(-1, .Monotonic);
}
pub fn can_use_ioctl_ficlone() bool {
    const result = can_use_ioctl_ficlone_.load(.Monotonic);
    if (result == 0) {
        // This flag mostly exists to make other code more easily testable.
        if (bun.getenvZ("BUN_CONFIG_DISABLE_ioctl_ficlonerange") != null) {
            bun.Output.debug("ioctl_ficlonerange is disabled by BUN_CONFIG_DISABLE_ioctl_ficlonerange", .{});
            can_use_ioctl_ficlone_.store(-1, .Monotonic);
            return false;
        }

        const kernel = Platform.kernelVersion();
        if (kernel.orderWithoutTag(.{ .major = 4, .minor = 5 }).compare(.gte)) {
            bun.Output.debug("ioctl_ficlonerange is supported", .{});
            can_use_ioctl_ficlone_.store(1, .Monotonic);
            return true;
        } else {
            bun.Output.debug("ioctl_ficlonerange is NOT supported", .{});
            can_use_ioctl_ficlone_.store(-1, .Monotonic);
            return false;
        }
    }

    return result == 1;
}

const fd_t = std.os.fd_t;

pub fn copyFileRange(in: fd_t, out: fd_t, len: usize, flags: u32, copy_file_state: *CopyFileState) CopyFileRangeError!usize {
    if (canUseCopyFileRangeSyscall() and !copy_file_state.has_seen_exdev and !copy_file_state.has_copy_file_range_failed) {
        while (true) {
            const rc = std.os.linux.copy_file_range(in, null, out, null, len, flags);
            bun.sys.syslog("copy_file_range({d}, {d}, {d}) = {d}", .{ in, out, len, rc });
            switch (std.os.linux.getErrno(rc)) {
                .SUCCESS => return @as(usize, @intCast(rc)),
                // these may not be regular files, try fallback
                .INVAL => {
                    copy_file_state.has_copy_file_range_failed = true;
                },
                // support for cross-filesystem copy added in Linux 5.3
                // and even then, it is frequently not supported.
                .XDEV => {
                    copy_file_state.has_seen_exdev = true;
                    copy_file_state.has_copy_file_range_failed = true;
                },
                // syscall added in Linux 4.5, use fallback
                .OPNOTSUPP, .NOSYS => {
                    copy_file_state.has_copy_file_range_failed = true;
                    bun.Output.debug("copy_file_range is NOT supported", .{});
                    can_use_copy_file_range.store(-1, .Monotonic);
                },
                .INTR => continue,
                else => {
                    // failed for some other reason
                    copy_file_state.has_copy_file_range_failed = true;
                },
            }
            break;
        }
    }

    while (!copy_file_state.has_sendfile_failed) {
        const rc = std.os.linux.sendfile(@intCast(out), @intCast(in), null, len);
        bun.sys.syslog("sendfile({d}, {d}, {d}) = {d}", .{ in, out, len, rc });
        switch (std.os.linux.getErrno(rc)) {
            .SUCCESS => return @as(usize, @intCast(rc)),
            .INTR => continue,
            // these may not be regular files, try fallback
            .INVAL => {
                copy_file_state.has_sendfile_failed = true;
            },
            // This shouldn't happen?
            .XDEV => {
                copy_file_state.has_seen_exdev = true;
                copy_file_state.has_sendfile_failed = true;
            },
            // they might not support it
            .OPNOTSUPP, .NOSYS => {
                copy_file_state.has_sendfile_failed = true;
            },
            else => {
                // failed for some other reason, fallback to read-write loop
                copy_file_state.has_sendfile_failed = true;
            },
        }
        break;
    }

    var buf: [8 * 4096]u8 = undefined;
    const adjusted_count = @min(buf.len, len);
    const amt_read = try os.read(in, buf[0..adjusted_count]);
    if (amt_read == 0) return 0;
    return os.write(out, buf[0..amt_read]);
}
