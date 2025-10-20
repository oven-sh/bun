/// Opaque type representing the user ID.
pub const Uid = if (bun.Environment.isPosix) struct {
    const Self = @This();

    _underlying: std.c.uid_t,

    pub fn queryEffective() Self {
        // TODO(markovejnovic): Unfortunately, geteuid is not available in Zig's stdlib at the
        //                      moment, so we need to use @cImport above.
        return .{ ._underlying = bun.c.geteuid() };
    }

    pub fn queryReal() Self {
        // TODO(markovejnovic): Unfortunately, getuid is not available in Zig's stdlib at the
        //                      moment, so we need to use @cImport above.
        return .{ ._underlying = bun.c.getuid() };
    }

    /// Falls back to queryEffective.
    pub fn queryCurrent() Self {
        return queryEffective();
    }

    fn init(underlying: std.c.uid_t) Self {
        return .{ ._underlying = underlying };
    }
} else struct {};

/// Fully managed representation of a passwd entry.
pub const PasswdEntry = if (bun.Environment.isPosix) struct {
    const Self = @This();

    var _pwbuf_size: std.atomic.Value(usize) = .init(0);

    allocator: std.mem.Allocator,
    buffer: []u8,
    entry: bun.c.struct_passwd,
    entry_ptr: *bun.c.struct_passwd,

    #memo: struct {
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

    pub fn pwUid(self: *const Self) Uid {
        return .init(self.pwUidC());
    }

    pub fn pwGidC(self: *Self) std.c.gid_t {
        return self.entry_ptr.pw_gid;
    }

    pub fn pwDir(self: *Self) ?[]u8 {
        self.#memo.pw_dir_len = std.mem.len(self.entry_ptr.pw_dir);
        return self.entry_ptr.pw_dir[0..self.#memo.pw_dir_len.?];
    }

    pub fn pwDirZ(self: *Self) ?[*:0]u8 {
        return self.entry_ptr.pw_dir;
    }

    pub fn pwShellZ(self: *Self) ?[*:0]u8 {
        return self.entry_ptr.pw_shell;
    }

    /// Attempt to retrieve the result of getpwuid_r.
    ///
    /// May spinlock for an extremely brief period of time as it allocates memory.
    pub fn init(user: Uid, alloc: std.mem.Allocator) bun.sys.Maybe(Self) {
        // Every iteration we will increase the buffer size by this factor.
        const buf_size_gain = 2;

        // Claude said that _SC_GETPW_R_SIZE_MAX is by default 1024 on Linux. I don't trust Claude
        // with anything so we're going 4X that.
        const default_buf_size: usize = 4096;

        // The maximum total number of attempts we will have at reading getpwuid_r before giving
        // up. There are a few cases which benefit from re-attempting a read.
        const max_buf_size: comptime_int = 1 * 1024 * 1024; // If we need to load a 1MB buffer,
        // something is very wrong.

        var buffer_size: usize = Self._pwbuf_size.load(.monotonic);
        if (buffer_size == 0) {
            // We know that we haven't initialized it yet. Let's try to do so now.
            const initial_buf_size: usize =
                @intCast(bun.sys.sysconf(bun.c._SC_GETPW_R_SIZE_MAX, .{
                    .default = default_buf_size,
                }));

            buffer_size = initial_buf_size;
        }

        var result: ?*bun.c.struct_passwd = undefined;
        var self: Self = .{
            .allocator = alloc,
            .buffer = alloc.alloc(u8, buffer_size) catch {
                return .initErr(.fromCode(.NOMEM, .getpwuid_r));
            },
            .entry = undefined,
            .entry_ptr = undefined,
        };
        errdefer self.allocator.free(self.buffer);

        while (buffer_size <= max_buf_size) {
            const rc = bun.c.getpwuid_r(
                user._underlying,
                &self.entry,
                self.buffer.ptr,
                self.buffer.len,
                @ptrCast(&result),
            );
            if (rc == 0) {
                // Since we found the correct buffer size, let's store it for future use.
                Self._pwbuf_size.store(buffer_size, .monotonic);

                if (result) |r| {
                    self.entry_ptr = r;
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
} else struct {};

/// Utilities for fetching and interacting with the current user's home directory.
pub const HomeDir = if (bun.Environment.isPosix) struct {
    const Self = @This();

    #path: union(enum) {
        managed: PasswdEntry,
        unmanaged: []const u8,
    },

    pub fn slice(self: *Self) []const u8 {
        return switch (self.#path) {
            // Safe to unwrap since all processes which add a .managed field validate that the
            // field is non-null.
            .managed => self.#path.managed.pwDir().?,
            .unmanaged => self.#path.unmanaged,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.#path) {
            .managed => self.#path.managed.deinit(),
            .unmanaged => {},
        }
    }

    /// Deduces the current user's home directory on POSIX systems.
    ///
    /// Whichever of the following returns a value is returned.
    /// - Per doi:10.1109/IEEESTD.2018.8277153, the `$HOME` variable.
    /// - The `getpwuid_r` function.
    pub fn query(allocator: std.mem.Allocator) bun.sys.Maybe(Self) {
        if (bun.getenvZ("HOME") orelse bun.getenvZ("USERPROFILE")) |home| {
            // The user may override $HOME with a non-absolute path. We know that's wrong.
            if (std.fs.path.isAbsolute(home)) {
                return .initResult(.{ .#path = .{ .unmanaged = home } });
            }
        }

        var passwd_entry = PasswdEntry.init(Uid.queryCurrent(), allocator);
        switch (passwd_entry) {
            .err => |e| {
                return .initErr(e);
            },
            .result => |*r| {
                return if (r.pwDir() != null)
                    .initResult(.{ .#path = .{ .managed = r.* } })
                else
                    .initErr(.fromCode(.NOENT, .getpwuid_r));
            },
        }
    }
} else struct {};

/// Work with the system temporary directory.
pub const SysTmpDir = if (bun.Environment.isPosix) struct {
    const Self = @This();

    pub fn deinit(self: *Self) void {
        _ = self; // self is unused, it's there for concept compatibility.
    }

    pub fn slice(self: *const Self) []const u8 {
        _ = self; // self is unused, it's there for concept compatibility.

        // Implementations are encouraged to provide suitable directory names in the environment
        // variable TMPDIR and applications are encouraged to use the contents of TMPDIR for
        // creating temporary files.
        // - IEEE Std 1003_1-2017 (POSIX 2017)
        if (bun.getenvZ("TMPDIR")) |tmpdir| {
            return tmpdir;
        }

        // The /tmp directory is retained in POSIX.1-2017 to accommodate historical applications
        // that assume its availability.
        return "/tmp";
    }

    pub fn query(allocator: std.mem.Allocator) bun.sys.Maybe(Self) {
        _ = allocator; // Never allocates, used for conformance to
        return .initResult(.{});
    }
} else struct {};

const bun = @import("bun");
const std = @import("std");
