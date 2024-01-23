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

// Transfer all the data between two file descriptors in the most efficient way.
// The copy starts at offset 0, the initial offsets are preserved.
// No metadata is transferred over.

const InputType = if (Environment.isWindows) bun.OSPathSliceZ else os.fd_t;
pub fn copyFile(in: InputType, out: InputType) CopyFileError!void {
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
        if (can_use_ioctl_ficlone()) {
            // We only check once if the ioctl is supported, and cache the result.
            // EXT4 does not support FICLONE.
            const rc = bun.C.linux.ioctl_ficlone(bun.toFD(out), bun.toFD(in));
            switch (std.os.linux.getErrno(rc)) {
                .SUCCESS => return,
                .FBIG => return error.FileTooBig,
                .IO => return error.InputOutput,
                .ISDIR => return error.IsDir,
                .NOMEM => return error.OutOfMemory,
                .NOSPC => return error.NoSpaceLeft,
                .OVERFLOW => return error.Unseekable,
                .TXTBSY => return error.FileBusy,
                .XDEV => {},
                .ACCES, .BADF, .INVAL, .OPNOTSUPP, .NOSYS, .PERM => {
                    bun.Output.debug("ioctl_ficlonerange is NOT supported", .{});
                    can_use_ioctl_ficlone_.store(-1, .Monotonic);
                },
                else => |err| return os.unexpectedErrno(err),
            }
        }

        // Try copy_file_range first as that works at the FS level and is the
        // most efficient method (if available).
        var offset: u64 = 0;
        cfr_loop: while (true) {
            // The kernel checks the u64 value `offset+count` for overflow, use
            // a 32 bit value so that the syscall won't return EINVAL except for
            // impossibly large files (> 2^64-1 - 2^32-1).
            const amt = try copyFileRange(in, offset, out, offset, math.maxInt(u32), 0);
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

const Platform = @import("root").bun.analytics.GenerateHeader.GeneratePlatform;

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
pub fn copyFileRange(in: fd_t, off_in: u64, out: fd_t, off_out: u64, len: usize, flags: u32) CopyFileRangeError!usize {
    if (canUseCopyFileRangeSyscall()) {
        var off_in_copy = @as(i64, @bitCast(off_in));
        var off_out_copy = @as(i64, @bitCast(off_out));

        const rc = std.os.linux.copy_file_range(in, &off_in_copy, out, &off_out_copy, len, flags);
        switch (std.os.linux.getErrno(rc)) {
            .SUCCESS => return @as(usize, @intCast(rc)),
            .BADF => return error.FilesOpenedWithWrongFlags,
            .FBIG => return error.FileTooBig,
            .IO => return error.InputOutput,
            .ISDIR => return error.IsDir,
            .NOMEM => return error.OutOfMemory,
            .NOSPC => return error.NoSpaceLeft,
            .OVERFLOW => return error.Unseekable,
            .PERM => return error.PermissionDenied,
            .TXTBSY => return error.FileBusy,
            // these may not be regular files, try fallback
            .INVAL => {},
            // support for cross-filesystem copy added in Linux 5.3, use fallback
            .XDEV => {},
            // syscall added in Linux 4.5, use fallback
            .NOSYS => {
                bun.Output.debug("copy_file_range is NOT supported", .{});
                can_use_copy_file_range.store(-1, .Monotonic);
            },
            else => |err| return os.unexpectedErrno(err),
        }
    }

    var buf: [8 * 4096]u8 = undefined;
    const adjusted_count = @min(buf.len, len);
    const amt_read = try os.pread(in, buf[0..adjusted_count], off_in);
    if (amt_read == 0) return 0;
    return os.pwrite(out, buf[0..amt_read], off_out);
}
