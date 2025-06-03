const bun = @import("bun");
const std = @import("std");

/// When cloning large amounts of data potentially multiple times, we can
/// leverage copy-on-write memory to avoid actually copying the data. To do that
/// on Linux, we need to use a memfd, which is a Linux-specific feature.
///
/// The steps are roughly:
///
/// 1. Create a memfd
/// 2. Write the data to the memfd
/// 3. Map the memfd into memory
///
/// Then, to clone the data later, we can just call `mmap` again.
///
/// The big catch is that mmap(), memfd_create(), write() all have overhead. And
/// often we will re-use virtual memory within the process. This does not reuse
/// the virtual memory. So we should only really use this for large blobs of
/// data that we expect to be cloned multiple times. Such as Blob in FormData.
pub const LinuxMemFdAllocator = struct {
    const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
    pub const new = bun.TrivialNew(@This());
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    fd: bun.FileDescriptor = .invalid,
    size: usize = 0,

    var memfd_counter = std.atomic.Value(usize).init(0);

    fn deinit(this: *LinuxMemFdAllocator) void {
        this.fd.close();
        bun.destroy(this);
    }

    pub fn allocator(this: *LinuxMemFdAllocator) std.mem.Allocator {
        return .{
            .ptr = this,
            .vtable = AllocatorInterface.VTable,
        };
    }

    pub fn from(allocator_: std.mem.Allocator) ?*LinuxMemFdAllocator {
        if (allocator_.vtable == AllocatorInterface.VTable) {
            return @alignCast(@ptrCast(allocator_.ptr));
        }

        return null;
    }

    const AllocatorInterface = struct {
        fn alloc(_: *anyopaque, _: usize, _: std.mem.Alignment, _: usize) ?[*]u8 {
            // it should perform no allocations or resizes
            return null;
        }

        fn free(
            ptr: *anyopaque,
            buf: []u8,
            _: std.mem.Alignment,
            _: usize,
        ) void {
            var this: *LinuxMemFdAllocator = @alignCast(@ptrCast(ptr));
            defer this.deref();
            bun.sys.munmap(@alignCast(@ptrCast(buf))).unwrap() catch |err| {
                bun.Output.debugWarn("Failed to munmap memfd: {}", .{err});
            };
        }

        pub const VTable = &std.mem.Allocator.VTable{
            .alloc = &AllocatorInterface.alloc,
            .resize = &std.mem.Allocator.noResize,
            .remap = &std.mem.Allocator.noRemap,
            .free = &free,
        };
    };

    pub fn alloc(this: *LinuxMemFdAllocator, len: usize, offset: usize, flags: std.posix.MAP) bun.JSC.Maybe(bun.webcore.Blob.Store.Bytes) {
        var size = len;

        // size rounded up to nearest page
        size = std.mem.alignForward(usize, size, std.heap.pageSize());

        var flags_mut = flags;
        flags_mut.TYPE = .SHARED;

        switch (bun.sys.mmap(
            null,
            @min(size, this.size),
            std.posix.PROT.READ | std.posix.PROT.WRITE,
            flags_mut,
            this.fd,
            offset,
        )) {
            .result => |slice| {
                return .{
                    .result = bun.webcore.Blob.Store.Bytes{
                        .cap = @truncate(slice.len),
                        .ptr = slice.ptr,
                        .len = @truncate(len),
                        .allocator = this.allocator(),
                    },
                };
            },
            .err => |errno| {
                return .{ .err = errno };
            },
        }
    }

    pub fn shouldUse(bytes: []const u8) bool {
        if (comptime !bun.Environment.isLinux) {
            return false;
        }

        if (bun.JSC.VirtualMachine.is_smol_mode) {
            return bytes.len >= 1024 * 1024 * 1;
        }

        // This is a net 2x - 4x slowdown to new Blob([huge])
        // so we must be careful
        return bytes.len >= 1024 * 1024 * 8;
    }

    pub fn create(bytes: []const u8) bun.JSC.Maybe(bun.webcore.Blob.Store.Bytes) {
        if (comptime !bun.Environment.isLinux) {
            unreachable;
        }

        var label_buf: [128]u8 = undefined;
        const label = std.fmt.bufPrintZ(&label_buf, "memfd-num-{d}", .{memfd_counter.fetchAdd(1, .monotonic)}) catch "";

        // Using huge pages was slower.
        const fd = switch (bun.sys.memfd_create(label, std.os.linux.MFD.CLOEXEC)) {
            .err => |err| return .{ .err = bun.sys.Error.fromCode(err.getErrno(), .open) },
            .result => |fd| fd,
        };

        if (bytes.len > 0)
            // Hint at the size of the file
            _ = bun.sys.ftruncate(fd, @intCast(bytes.len));

        // Dump all the bytes in there
        var written: isize = 0;

        var remain = bytes;
        while (remain.len > 0) {
            switch (bun.sys.pwrite(fd, remain, written)) {
                .err => |err| {
                    if (err.getErrno() == .AGAIN) {
                        continue;
                    }

                    bun.Output.debugWarn("Failed to write to memfd: {}", .{err});
                    fd.close();
                    return .{ .err = err };
                },
                .result => |result| {
                    if (result == 0) {
                        bun.Output.debugWarn("Failed to write to memfd: EOF", .{});
                        fd.close();
                        return .{ .err = bun.sys.Error.fromCode(.NOMEM, .write) };
                    }
                    written += @intCast(result);
                    remain = remain[result..];
                },
            }
        }

        var linux_memfd_allocator = LinuxMemFdAllocator.new(.{
            .fd = fd,
            .ref_count = .init(),
            .size = bytes.len,
        });

        switch (linux_memfd_allocator.alloc(bytes.len, 0, .{ .TYPE = .SHARED })) {
            .result => |res| {
                return .{ .result = res };
            },
            .err => |err| {
                linux_memfd_allocator.deref();
                return .{ .err = err };
            },
        }
    }
};
