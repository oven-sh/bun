const std = @import("std");
const os = std.os;
const math = std.math;
const bun = @import("root").bun;

pub const CopyFileRangeError = error{
    FileTooBig,
    InputOutput,
    /// `fd_in` is not open for reading; or `fd_out` is not open  for  writing;
    /// or the  `O.APPEND`  flag  is  set  for `fd_out`.
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
pub fn copyFile(fd_in: os.fd_t, fd_out: os.fd_t) CopyFileError!void {
    if (comptime bun.Environment.isMac) {
        const rc = os.system.fcopyfile(fd_in, fd_out, null, os.system.COPYFILE_DATA);
        switch (os.errno(rc)) {
            .SUCCESS => return,
            .INVAL => unreachable,
            .NOMEM => return error.SystemResources,
            // The source file is not a directory, symbolic link, or regular file.
            // Try with the fallback path before giving up.
            .OPNOTSUPP => {},
            else => |err| return os.unexpectedErrno(err),
        }
    }

    if (comptime bun.Environment.isLinux) {
        // Try copy_file_range first as that works at the FS level and is the
        // most efficient method (if available).
        var offset: u64 = 0;
        cfr_loop: while (true) {
            // The kernel checks the u64 value `offset+count` for overflow, use
            // a 32 bit value so that the syscall won't return EINVAL except for
            // impossibly large files (> 2^64-1 - 2^32-1).
            const amt = try copyFileRange(fd_in, offset, fd_out, offset, math.maxInt(u32), 0);
            // Terminate when no data was copied
            if (amt == 0) break :cfr_loop;
            offset += amt;
        }
        return;
    }

    // Sendfile is a zero-copy mechanism iff the OS supports it, otherwise the
    // fallback code will copy the contents chunk by chunk.
    const empty_iovec = [0]os.iovec_const{};
    var offset: u64 = 0;
    sendfile_loop: while (true) {
        const amt = try os.sendfile(fd_out, fd_in, offset, 0, &empty_iovec, &empty_iovec, 0);
        // Terminate when no data was copied
        if (amt == 0) break :sendfile_loop;
        offset += amt;
    }
}

const Platform = @import("root").bun.analytics.GenerateHeader.GeneratePlatform;

var can_use_copy_file_range = std.atomic.Atomic(i32).init(0);
fn canUseCopyFileRangeSyscall() bool {
    const result = can_use_copy_file_range.load(.Monotonic);
    if (result == 0) {
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

const fd_t = std.os.fd_t;
pub fn copyFileRange(fd_in: fd_t, off_in: u64, fd_out: fd_t, off_out: u64, len: usize, flags: u32) CopyFileRangeError!usize {
    if (canUseCopyFileRangeSyscall()) {
        var off_in_copy = @bitCast(i64, off_in);
        var off_out_copy = @bitCast(i64, off_out);

        const rc = std.os.linux.copy_file_range(fd_in, &off_in_copy, fd_out, &off_out_copy, len, flags);
        switch (std.os.linux.getErrno(rc)) {
            .SUCCESS => return @intCast(usize, rc),
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
    const amt_read = try os.pread(fd_in, buf[0..adjusted_count], off_in);
    // TODO without @as the line below fails to compile for wasm32-wasi:
    // error: integer value 0 cannot be coerced to type 'os.PWriteError!usize'
    if (amt_read == 0) return @as(usize, 0);
    return os.pwrite(fd_out, buf[0..amt_read], off_out);
}
