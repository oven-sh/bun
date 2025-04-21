//! Platform specific APIs for Linux
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

pub const memfd_allocator = @import("allocators/linux_memfd_allocator.zig").LinuxMemFdAllocator;

/// splice() moves data between two file descriptors without copying
/// between kernel address space and user address space.  It
/// transfers up to len bytes of data from the file descriptor fd_in
/// to the file descriptor fd_out, where one of the file descriptors
/// must refer to a pipe.
pub fn splice(fd_in: std.posix.fd_t, off_in: ?*i64, fd_out: std.posix.fd_t, off_out: ?*i64, len: usize, flags: u32) usize {
    return std.os.linux.syscall6(
        .splice,
        @as(usize, @bitCast(@as(isize, fd_in))),
        @intFromPtr(off_in),
        @as(usize, @bitCast(@as(isize, fd_out))),
        @intFromPtr(off_out),
        len,
        flags,
    );
}

pub const RWFFlagSupport = enum(u8) {
    unknown = 0,
    unsupported = 2,
    supported = 1,

    var rwf_bool = std.atomic.Value(RWFFlagSupport).init(RWFFlagSupport.unknown);

    pub fn isLinuxKernelVersionWithBuggyRWF_NONBLOCK() bool {
        return bun.linuxKernelVersion().major == 5 and switch (bun.linuxKernelVersion().minor) {
            9, 10 => true,
            else => false,
        };
    }

    pub fn disable() void {
        rwf_bool.store(.unsupported, .monotonic);
    }

    /// Workaround for https://github.com/google/gvisor/issues/2601
    pub fn isMaybeSupported() bool {
        if (comptime !bun.Environment.isLinux) return false;
        switch (rwf_bool.load(.monotonic)) {
            .unknown => {
                if (isLinuxKernelVersionWithBuggyRWF_NONBLOCK() or bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK")) {
                    rwf_bool.store(.unsupported, .monotonic);
                    return false;
                }

                rwf_bool.store(.supported, .monotonic);
                return true;
            },
            .supported => {
                return true;
            },
            else => {
                return false;
            },
        }

        unreachable;
    }
};

/// https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
///
/// Support for FICLONE is dependent on the filesystem driver.
pub fn ioctl_ficlone(dest_fd: bun.FileDescriptor, srcfd: bun.FileDescriptor) usize {
    return std.os.linux.ioctl(dest_fd.native(), bun.c.FICLONE, @intCast(srcfd.native()));
}

const std = @import("std");
const bun = @import("bun");
