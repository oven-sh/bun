/// Fully managed representation of a passwd entry.
pub const PasswdEntry = struct {
    const Self = @This();

    allocator: std.mem.Allocator,
    buffer: []u8,
    entry: bun.c.struct_passwd,
    entry_ptr: *bun.c.struct_passwd,

    _memo: struct {
        // Holds the length of the pw_dir string slice to avoid recomputing it from the C string.
        pw_dir_len: ?usize = null,
    } = .{},

    pub fn deinit(self: *Self) void {
        self.allocator.free(self.buffer);
    }

    pub fn pwNameZ(self: *Self) ?[*:0]u8 {
        return self.entry_ptr.pw_name;
    }

    pub fn pwUidC(self: *const Self) std.c.uid_t {
        return self.entry_ptr.pw_uid;
    }

    pub fn pwGidC(self: *Self) std.c.gid_t {
        return self.entry_ptr.pw_gid;
    }

    pub fn pwDir(self: *Self) ?[]u8 {
        if (self.entry_ptr.pw_dir == null) {
            return null;
        }

        self._memo.pw_dir_len = std.mem.len(self.entry_ptr.pw_dir);
        return self.entry_ptr.pw_dir[0..self._memo.pw_dir_len.?];
    }

    pub fn pwDirZ(self: *Self) ?[*:0]u8 {
        return self.entry_ptr.pw_dir;
    }

    pub fn pwShellZ(self: *Self) ?[*:0]u8 {
        return self.entry_ptr.pw_shell;
    }

    /// Query an entry in the system passwd database by user ID.
    /// May spinlock for an extremely brief period of time as it allocates memory.
    pub fn query(user: std.c.uid_t, alloc: std.mem.Allocator) bun.sys.Maybe(PasswdEntry) {
        const Memo = struct {
            var pwbuf_size: std.atomic.Value(usize) = .init(0);
        };

        // Every iteration we will increase the buffer size by this factor.
        // mem_allocated(n) = buf_size_gain^n
        const buf_size_gain = 2;

        const default_buf_size: usize = 4096;

        // The maximum total number of attempts we will have at reading getpwuid_r before giving
        // up. There are a few cases which benefit from re-attempting a read.
        const max_buf_size: comptime_int = 1 * 1024 * 1024; // 1MB

        // I try to be slightly clever here and memoize the last successful buffer size.
        var buffer_size: usize = Memo.pwbuf_size.load(.monotonic);
        if (buffer_size == 0) {
            // We know that we haven't initialized it yet. Let's try to do so now.
            const initial_buf_size: usize = @intCast(
                bun.sys.sysconf(bun.c._SC_GETPW_R_SIZE_MAX) catch default_buf_size,
            );

            buffer_size = initial_buf_size;
        }

        var result: ?*bun.c.struct_passwd = undefined;
        var self: PasswdEntry = .{
            .allocator = alloc,
            .buffer = alloc.alloc(u8, buffer_size) catch {
                return .initErr(.fromCode(.NOMEM, .getpwuid_r));
            },
            .entry = undefined,
            .entry_ptr = undefined,
        };
        var deallocate_buffer: bool = true;
        defer {
            if (deallocate_buffer) {
                self.allocator.free(self.buffer);
            }
        }

        while (buffer_size <= max_buf_size) {
            const rc = bun.c.getpwuid_r(
                user,
                &self.entry,
                self.buffer.ptr,
                self.buffer.len,
                @ptrCast(&result),
            );
            if (rc == 0) {
                // Since we found the correct buffer size, let's store it for future use.
                Memo.pwbuf_size.store(buffer_size, .monotonic);

                if (result) |r| {
                    self.entry_ptr = r;
                    deallocate_buffer = false;
                    return .initResult(self);
                }

                return .initErr(.fromCode(.NOENT, .getpwuid_r));
            }

            const err = std.posix.errno(rc);
            switch (err) {
                .NOMEM, .RANGE => {
                    // ENOMEM -- Insufficient memory to allocate passwd structure.
                    // ERANGE -- Insufficient buffer space supplied.
                    buffer_size *= buf_size_gain;
                    self.buffer = alloc.realloc(self.buffer, buffer_size) catch {
                        return .initErr(.fromCode(.NOMEM, .getpwuid_r));
                    };
                    continue;
                },
                .INTR => {
                    // We got hit by a signal, let's just try again.
                    continue;
                },
                .IO, .MFILE, .NFILE => {
                    return .initErr(.fromCode(err, .getpwuid_r));
                },
                else => {
                    // The man page says we have covered the total set of error codes.
                    @branchHint(.cold);
                    return .initErr(.fromCode(err, .getpwuid_r));
                },
            }
        }

        return .initErr(.fromCode(.SRCH, .getpwuid_r));
    }
};

/// Deduces the effective user's home directory on POSIX systems.
///
/// Memoizes the result for future calls. There is no way to "unset" the home directory once it has
/// been set. The user must restart the process to reset it.
///
/// Whichever of the following returns a value is returned.
/// - Per doi:10.1109/IEEESTD.2018.8277153, the `$HOME` variable -- does not allocate.
/// - The `getpwuid_r` function -- allocates.
///
/// Ensure you call `.deinit` on the result type.
pub fn queryHomeDir() bun.sys.Maybe([]const u8) {
    const allocator = bun.default_allocator;

    const Store = struct {
        const DataPtr = bun.TaggedPointerUnion(.{
            PasswdEntry,
            []const u8,
        });

        var atomic_data = std.atomic.Value(DataPtr).init(DataPtr.Null);

        fn getSlice() ?[]const u8 {
            const data = atomic_data.load(.acquire);
            return if (data != DataPtr.Null) switch (data.tag()) {
                DataPtr.case([]const u8) => data.as([]const u8).*,
                DataPtr.case(PasswdEntry) => data.as(PasswdEntry).pwDir().?,
                else => unreachable,
            } else null;
        }
    };

    if (Store.getSlice()) |s| {
        return .initResult(s);
    }

    if (bun.getenvZ("HOME") orelse bun.getenvZ("USERPROFILE")) |home| use_envvar: {
        // The user may override $HOME with a non-absolute path. We know that's wrong.
        if (!std.fs.path.isAbsolute(home)) {
            break :use_envvar;
        }

        const hpath = bun.handleOom(allocator.create([]const u8));
        hpath.* = home;

        // Failure order requires that we observe the changes to DataPtr, so we need acquire.
        // Success order requires that we publish our changes to DataPtr, so we need release.
        if (Store.atomic_data.cmpxchgStrong(
            Store.DataPtr.Null,
            .init(hpath),
            .release,
            .acquire,
        )) |d| {
            // Another thread beat us to it.
            allocator.destroy(hpath);
            return .initResult(switch (d.tag()) {
                Store.DataPtr.case([]const u8) => d.as([]const u8).*,
                Store.DataPtr.case(PasswdEntry) => d.as(PasswdEntry).pwDir().?,
                else => unreachable,
            });
        }

        bun.memory.INTENTIONALLY_LEAK(
            allocator,
            @ptrCast(hpath),
            "home directory considered singleton",
        );
        return .initResult(hpath.*);
    }

    var passwd_entry = PasswdEntry.query(bun.c.geteuid(), allocator);
    switch (passwd_entry) {
        .err => |e| {
            return .initErr(e);
        },
        .result => |*r| {
            if (r.pwDir() == null) {
                r.deinit();
                return .initErr(.fromCode(.NOENT, .getpwuid_r));
            }

            const pwent = bun.handleOom(allocator.create(PasswdEntry));
            pwent.* = r.*;

            // Failure order requires that we observe the changes to DataPtr, so we need acquire.
            // Success order requires that we publish our changes to DataPtr, so we need release.
            if (Store.atomic_data.cmpxchgStrong(
                Store.DataPtr.Null,
                .init(pwent),
                .release,
                .acquire,
            )) |d| {
                // Another thread beat us to it.
                pwent.deinit();
                allocator.destroy(pwent);
                return .initResult(switch (d.tag()) {
                    Store.DataPtr.case([]const u8) => d.as([]const u8).*,
                    Store.DataPtr.case(PasswdEntry) => d.as(PasswdEntry).pwDir().?,
                    else => unreachable,
                });
            }

            bun.memory.INTENTIONALLY_LEAK(
                allocator,
                @ptrCast(pwent),
                "home directory considered singleton",
            );
            return .initResult(pwent.pwDir().?);
        },
    }
}

/// Query the system temporary directory.
/// Follows the suggestions of IEEE Std 1003.1-2017 (POSIX 2017).
pub fn getSysTmpDir() []const u8 {
    // Implementations are encouraged to provide suitable directory names in the environment
    // variable TMPDIR and applications are encouraged to use the contents of TMPDIR for creating
    // temporary files.
    // - IEEE Std 1003_1-2017 (POSIX 2017)
    return if (bun.getenvZ("TMPDIR")) |tmpdir|
        tmpdir
        // The /tmp directory is retained in POSIX.1-2017 to accommodate historical applications
        // that assume its availability.
    else
        "/tmp";
}

const bun = @import("bun");
const std = @import("std");
