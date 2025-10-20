//! Module for higher-level Windows utilities. Unlike sys.zig, this module has a slightly higher
//! level of abstraction and is not a direct mapping to Win32 APIs, but is still very
//! Windows-specific.

/// Utilities for retrieving C:\Windows, D:\Windows or whatnot. Does not support POSIX.
pub const WinDir = if (bun.Environment.isWindows) struct {
    const Self = @This();

    #path: union(enum) {
        managed: paths.AutoAbsPath,
        unmanaged: []const u8,
    },

    pub fn slice(self: *const Self) []const u8 {
        return switch (self.#path) {
            .managed => self.#path.managed.slice(),
            .unmanaged => self.#path.unmanaged,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.#path) {
            .managed => return self.#path.managed.deinit(),
            .unmanaged => {},
        }
    }

    /// Query the system installation directory, typically C:\Windows.
    ///
    /// May or may not allocate. Make no assumptions -- call .deinit(), as that will handle both
    /// cases for you.
    pub fn query(allocator: std.mem.Allocator) bun.sys.Maybe(Self) {
        const env_path = bun.getenvZ("WINDIR") orelse bun.getenvZ("SYSTEMROOT");
        if (env_path) |p| {
            return .initResult(.{ .#path = .{ .unmanaged = p } });
        }

        // This is the slow and expensive path -- we have to actually query the system. Oof.
        var stack = std.heap.stackFallback(bun.windows.MAX_PATH * @sizeOf(u16), allocator);
        var alloc = stack.get();

        var wchar_buf = alloc.alloc(u16, bun.windows.MAX_PATH) catch {
            return .initErr(.fromCode(.NOMEM, .GetSystemWindowsDirectoryW));
        };
        defer alloc.free(wchar_buf);

        const rc = queryIntoSlice(wchar_buf);
        switch (rc) {
            .err => |e| {
                return .initErr(e);
            },
            .result => |r| {
                if (r <= wchar_buf.len) {
                    var path = paths.AutoAbsPath.init();
                    // GetSystemWindowsDirectoryW returns the length without the null terminator.
                    path.append(wchar_buf[0..@as(usize, @intCast(r))]);
                    return .initResult(.{ .#path = .{ .managed = path } });
                }

                // We need a bigger buffer.
                wchar_buf = alloc.realloc(wchar_buf, @as(usize, @intCast(r))) catch {
                    return .initErr(.fromCode(.NOMEM, .GetSystemWindowsDirectoryW));
                };
                const rc2 = queryIntoSlice(wchar_buf);

                switch (rc2) {
                    .err => |e| {
                        return .initErr(e);
                    },
                    .result => |r2| {
                        if (r2 <= wchar_buf.len) {
                            var path = paths.AutoAbsPath.init();
                            // GetSystemWindowsDirectoryW returns the length without the null
                            // terminator.
                            path.append(wchar_buf[0..@as(usize, @intCast(r2))]);
                            return .initResult(.{ .#path = .{ .managed = path } });
                        }
                    },
                }

                // If the buffer is STILL too small, then the system is pulling our leg.
                bun.Output.panic("GetSystemWindowsDirectoryW keeps returning a size larger than " ++
                    "the buffer we provide. This is a bug in Bun. Please report it.", .{});
            },
        }
    }

    fn queryIntoSlice(wchar_buf: []u16) bun.sys.Maybe(usize) {
        const rc = bun.windows.GetSystemWindowsDirectoryW(
            @ptrCast(wchar_buf.ptr),
            @intCast(wchar_buf.len),
        );

        // If the function fails, the return value is zero. To get extended error information, call
        // GetLastError.
        if (rc == 0) {
            const err = bun.windows.GetLastError();
            // TODO(markovejnovic): This whole conversion between Win32Error -> SystemErrno -> E
            //                      feels very wrong.
            return .initErr(.fromCode(@enumFromInt(@intFromEnum(err)), .GetSystemWindowsDirectoryW));
        }

        // If the function succeeds, the return value is the length of the string copied to the
        // buffer, in TCHARs, not including the terminating null character.
        // If the length is greater than the size of the buffer, the return value is the size of
        // the buffer required to hold the path.
        //
        // In both cases, we return the actual length.
        return .initResult(rc);
    }
} else struct {};

/// Utilities for retrieving C:\Users\<User> or whatnot.
pub const UserProfile = if (bun.Environment.isWindows) struct {
    const Self = @This();

    #path: union(enum) {
        managed: paths.AutoAbsPath,
        unmanaged: []const u8,
    },

    pub fn slice(self: *const Self) []const u8 {
        return switch (self.#path) {
            .managed => self.#path.managed.slice(),
            .unmanaged => self.#path.unmanaged,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.#path) {
            .managed => return self.#path.managed.deinit(),
            .unmanaged => {},
        }
    }

    pub fn query(allocator: std.mem.Allocator) bun.sys.Maybe(Self) {
        const env_path = bun.getenvZ("HOME");
        if (env_path) |p| {
            // @markovejnovic:
            // This feels very counter-intuitive to me but it matches what libuv does -- we run
            // some heuristics to test the quality of the environment variable. I think this is
            // kind of misguided, but decided not to deviate from libuv here.
            if (p.len < "C:\\".len) {
                return .initErr(.fromCode(.NOENT, .GetUserProfileDirectoryW));
            }

            return .initResult(.{ .#path = .{ .unmanaged = p } });
        }

        var stack = std.heap.stackFallback(bun.windows.MAX_PATH * @sizeOf(u16), allocator);
        var alloc = stack.get();

        var wchar_buf = alloc.alloc(u16, bun.windows.MAX_PATH) catch {
            return .initErr(.fromCode(.NOMEM, .GetUserProfileDirectoryW));
        };
        defer alloc.free(wchar_buf);

        const rc = queryIntoSlice(wchar_buf);
        switch (rc) {
            .err => |e| {
                return .initErr(e);
            },
            .result => |r| {
                if (r <= wchar_buf.len) {
                    var path = paths.AutoAbsPath.init();
                    // -1 because we don't want the null terminator.
                    path.append(wchar_buf[0..@as(usize, if (r == 0) 0 else @intCast(r - 1))]);
                    return .initResult(.{ .#path = .{ .managed = path } });
                }

                // We need a bigger buffer.
                wchar_buf = alloc.realloc(wchar_buf, @as(usize, @intCast(r))) catch {
                    return .initErr(.fromCode(.NOMEM, .GetUserProfileDirectoryW));
                };
                const rc2 = queryIntoSlice(wchar_buf);

                switch (rc2) {
                    .err => |e| {
                        return .initErr(e);
                    },
                    .result => |r2| {
                        if (r2 <= wchar_buf.len) {
                            var path = paths.AutoAbsPath.init();
                            // -1 because we don't want the null terminator.
                            path.append(
                                wchar_buf[0..@as(usize, if (r2 == 0) 0 else @intCast(r2 - 1))],
                            );
                            return .initResult(.{ .#path = .{ .managed = path } });
                        }
                    },
                }

                // If the buffer is STILL too small, then the system is pulling our leg.
                bun.Output.panic("GetUserProfileDirectoryW keeps returning a size larger than " ++
                    "the buffer we provide. This is a bug in Bun. Please report it.", .{});
            },
        }
    }

    fn queryIntoSlice(wchar_buf: []u16) bun.sys.Maybe(usize) {
        var proc_token: bun.windows.HANDLE = undefined;
        const proc_hndl = bun.windows.GetCurrentProcess();
        var rc = bun.windows.OpenProcessToken(proc_hndl, bun.windows.TOKEN_QUERY, &proc_token);
        if (rc == bun.windows.FALSE) {
            const err = bun.windows.GetLastError();
            // TODO(markovejnovic): This whole conversion between Win32Error -> SystemErrno -> E
            //                      feels very wrong.
            return .initErr(.fromCode(@enumFromInt(@intFromEnum(err)), .OpenProcessToken));
        }
        defer _ = bun.windows.CloseHandle(proc_token);

        var path_size: bun.windows.DWORD = @as(bun.windows.DWORD, @intCast(wchar_buf.len));
        rc = bun.windows.GetUserProfileDirectoryW(
            proc_token,
            @ptrCast(wchar_buf.ptr),
            &path_size,
        );

        if (rc == bun.windows.FALSE and
            path_size <= @as(bun.windows.DWORD, @intCast(wchar_buf.len)))
        {
            // Otherwise we found ourselves some really weird error.
            const err = bun.windows.GetLastError();
            // TODO(markovejnovic): This whole conversion between Win32Error -> SystemErrno -> E
            //                      feels very wrong.
            return .initErr(.fromCode(@enumFromInt(@intFromEnum(err)), .GetUserProfileDirectoryW));
        }

        // Either the buffer was too small (in which case path_size contains the required size),
        // or we succeeded (in which case path_size contains the actual size).
        return .initResult(@intCast(path_size));
    }
} else struct {};

// Windows-specific TMP/TEMP directory retrieval.
pub const TempDir = if (bun.Environment.isWindows) struct {
    const Self = @This();

    #path: union(enum) {
        unmanaged: []const u8,
        managed: struct {
            allocator: std.mem.Allocator,
            buf: []u8,
        },
    },

    pub fn slice(self: *const Self) []const u8 {
        return switch (self.#path) {
            .unmanaged => self.#path.unmanaged,
            .managed => |*m| m.buf,
        };
    }

    pub fn deinit(self: *Self) void {
        switch (self.#path) {
            .unmanaged => {},
            .managed => |*m| {
                m.allocator.free(m.buf);
            },
        }
    }

    pub fn query(allocator: std.mem.Allocator) bun.sys.Maybe(Self) {
        // Kind of mimics what GetTempPath2 does.
        //
        // Microsoft says:
        // For non-system processes, the GetTempPath2 function checks for the existence of
        // environment variables in the following order and uses the first path found:
        //   1. The path specified by the TMP environment variable.
        //   2. The path specified by the TEMP environment variable.
        //   3. The path specified by the USERPROFILE environment variable.
        //   4. The Windows directory.
        // The maximum possible return value is MAX_PATH+1 (261).
        //
        // They also say:
        //
        // When calling this function from a process running as SYSTEM it will
        // return the path C:\Windows\SystemTemp, which is inaccessible to non-SYSTEM processes.
        // For non-SYSTEM processes, GetTempPath2 will behave the same as GetTemppaths.
        //
        // For system processes, the GetTempPath2 function checks for the existence of the
        // environment variable SystemTemp. If this environment variable is set, it will use the
        // value of the environment variable as the path instead of the default system provided
        // path on the C: drive.
        //
        // We do not implement this SYSTEM-specific behavior. There is no reason to call Bun as a
        // SYSTEM process.
        //
        // Furthermore, we deviate from the documented behavior of GetTempPath2 since it's fucking
        // stupid -- why on earth would we ever want to polute the user directory, or worse even
        // the Windows directory? That makes zero sense. Therefore, if we do fall that far down the
        // list, we will append temp to the path.
        //
        // This matches Node and is close to what CPython does.
        if (bun.getenvZ("TMP")) |t| {
            return .initResult(.{ .#path = .{ .unmanaged = t } });
        }

        if (bun.getenvZ("TEMP")) |t| {
            return .initResult(.{ .#path = .{ .unmanaged = t } });
        }

        var user_profile = UserProfile.query(allocator);
        if (user_profile.asValuePtr()) |up| {
            defer up.deinit();
            return .initResult(.{ .#path = .{ .managed = .{
                .allocator = allocator,
                .buf = std.mem.concat(allocator, u8, &.{ up.slice(), "\\Temp" }) catch |err| {
                    switch (err) {
                        error.OutOfMemory => return .initErr(.fromCode(.NOMEM, .GetTempPath2)),
                    }
                },
            } } });
        }

        var win_dir = WinDir.query(allocator);
        if (win_dir.asValuePtr()) |wd| {
            defer wd.deinit();
            return .initResult(.{ .#path = .{ .managed = .{
                .allocator = allocator,
                .buf = std.mem.concat(allocator, u8, &.{ wd.slice(), "\\Temp" }) catch |err| {
                    switch (err) {
                        error.OutOfMemory => return .initErr(.fromCode(.NOMEM, .GetTempPath2)),
                    }
                },
            } } });
        }

        return .initErr(user_profile.asErr() orelse
            win_dir.asErr() orelse
            .fromCode(.UNKNOWN, .GetTempPath2));
    }
} else struct {};

const std = @import("std");

const bun = @import("bun");
const paths = bun.paths;
