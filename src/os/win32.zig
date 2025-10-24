//! Module for higher-level Windows utilities. Unlike sys.zig, this module has a slightly higher
//! level of abstraction and is not a direct mapping to Win32 APIs, but is still very
//! Windows-specific.

const AtomicMaybeManagedPath = struct {
    const DataPtr = bun.ptr.TaggedPointerUnion(.{ []const u8, []u8 });

    fn forceAsSlice(data_ptr: DataPtr) []const u8 {
        return switch (data_ptr.tag()) {
            DataPtr.case([]const u8) => data_ptr.as([]const u8).*,
            DataPtr.case([]u8) => data_ptr.as([]u8).*,
            else => unreachable,
        };
    }

    atomic_data: std.atomic.Value(DataPtr) = .init(DataPtr.Null),

    fn getSlice(self: AtomicMaybeManagedPath) ?[]const u8 {
        const data = self.atomic_data.load(.acquire);
        return if (data != DataPtr.Null) forceAsSlice(data) else null;
    }

    /// Attempt to store the given value into the atomic data pointer, if it is not already set.
    /// Returns the existing value if it was already set.
    fn tryStore(self: *AtomicMaybeManagedPath, value: DataPtr) ?DataPtr {
        // Failure order requires that we observe the changes to DataPtr, so we need acquire.
        // Success order requires that we publish our changes to DataPtr, so we need release.
        return self.atomic_data.cmpxchgStrong(DataPtr.Null, value, .release, .acquire);
    }
};

/// Many Win32 calls require you provide them with a buffer. If the buffer ends up being too small,
/// the call will return the required size, and you are expected to reallocate the buffer and try
/// again.
///
/// This function does all of that for you -- you just tell it what syscall to call.
fn runWin32CallWithResizingBuffer(
    allocator: std.mem.Allocator,
    comptime syscall_tag: bun.sys.Tag,
    comptime queryFn: fn ([]u16) bun.sys.Maybe(usize),
) bun.sys.Maybe(struct {
    buf: []u16,
    slice: []const u16,
}) {
    var wchar_buf = allocator.alloc(u16, bun.windows.MAX_PATH) catch {
        return .initErr(.fromCode(.NOMEM, syscall_tag));
    };

    const rc = queryFn(wchar_buf);
    switch (rc) {
        .err => |e| {
            allocator.free(wchar_buf);
            return .initErr(e);
        },
        .result => |r| {
            if (r <= wchar_buf.len) {
                return .initResult(.{
                    .buf = wchar_buf,
                    .slice = wchar_buf[0..@as(usize, @intCast(r))],
                });
            }

            wchar_buf = allocator.realloc(wchar_buf, @as(usize, @intCast(r))) catch {
                allocator.free(wchar_buf);
                return .initErr(.fromCode(.NOMEM, syscall_tag));
            };

            const rc2 = queryFn(wchar_buf);

            switch (rc2) {
                .err => |e| {
                    allocator.free(wchar_buf);
                    return .initErr(e);
                },
                .result => |r2| {
                    if (r2 <= wchar_buf.len) {
                        return .initResult(.{
                            .buf = wchar_buf,
                            .slice = wchar_buf[0..@as(usize, @intCast(r2))],
                        });
                    }

                    bun.Output.panic(
                        @tagName(syscall_tag) ++ "keeps returning a size larger than the " ++
                            "buffer we provide. This is a bug in Bun. Please report it on Github.",
                        .{},
                    );
                },
            }
        },
    }
}

/// Get the path to the Windows directory, eg. C:\Windows.
pub fn queryWinDir() bun.sys.Maybe([]const u8) {
    const allocator = bun.default_allocator;

    const Static = struct {
        var path: AtomicMaybeManagedPath = .{};
    };

    if (Static.path.getSlice()) |s| {
        return .initResult(s);
    }

    if (bun.getenvZ("WINDIR") orelse bun.getenvZ("SYSTEMROOT")) |wd| use_envvar: {
        if (!std.fs.path.isAbsolute(wd)) {
            break :use_envvar;
        }

        const hpath = bun.handleOom(allocator.create([]const u8));
        hpath.* = wd;

        if (Static.path.tryStore(.init(hpath))) |v| {
            allocator.destroy(hpath);
            return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
        }

        bun.memory.INTENTIONALLY_LEAK(
            allocator,
            @ptrCast(hpath),
            "windows directory considered singleton",
        );
        return .initResult(wd);
    }

    switch (runWin32CallWithResizingBuffer(
        allocator,
        .GetSystemWindowsDirectoryW,
        (struct {
            fn doSyscall(wchar_buf: []u16) bun.sys.Maybe(usize) {
                const rc = bun.windows.GetSystemWindowsDirectoryW(
                    @ptrCast(wchar_buf.ptr),
                    @intCast(wchar_buf.len),
                );

                if (rc == 0) {
                    const err = bun.windows.GetLastError();
                    // TODO(markovejnovic): This conversion between Win32Error -> SystemErrno -> E
                    //                      feels very wrong.
                    return .initErr(
                        .fromCode(@enumFromInt(@intFromEnum(err)), .GetSystemWindowsDirectoryW),
                    );
                }

                return .initResult(rc);
            }
        }).doSyscall,
    )) {
        .err => |e| {
            return .initErr(e);
        },
        .result => |res| {
            defer allocator.free(res.buf);
            const data_ptr = bun.handleOom(allocator.create([]u8));
            data_ptr.* = bun.handleOom(bun.strings.toUTF8Alloc(
                allocator,
                res.slice,
            ));

            if (Static.path.tryStore(.init(data_ptr))) |v| {
                allocator.free(data_ptr.*);
                allocator.destroy(data_ptr);
                return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
            }

            bun.memory.INTENTIONALLY_LEAK(
                allocator,
                @ptrCast(data_ptr),
                "windows directory considered singleton",
            );
            return .initResult(data_ptr.*);
        },
    }
}

/// Get the path to the current user directory, eg. C:\Users\<User>.
pub fn queryUserProfile() bun.sys.Maybe([]const u8) {
    const allocator = bun.default_allocator;

    const Static = struct {
        var path: AtomicMaybeManagedPath = .{};
    };

    if (Static.path.getSlice()) |s| {
        return .initResult(s);
    }

    if (bun.getenvZ("USERPROFILE")) |p| {
        // @markovejnovic:
        // This feels very counter-intuitive to me but it matches what libuv does -- we run
        // some heuristics to test the quality of the environment variable. I think this is
        // kind of misguided, but decided not to deviate from libuv here.
        if (p.len < "C:\\".len) {
            return .initErr(.fromCode(.NOENT, .GetUserProfileDirectoryW));
        }

        const hpath = bun.handleOom(allocator.create([]const u8));
        hpath.* = p;

        if (Static.path.tryStore(.init(hpath))) |v| {
            allocator.destroy(hpath);
            return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
        }

        bun.memory.INTENTIONALLY_LEAK(
            allocator,
            @ptrCast(hpath),
            "user profile directory considered singleton",
        );
        return .initResult(p);
    }

    switch (runWin32CallWithResizingBuffer(
        allocator,
        .GetUserProfileDirectoryW,
        (struct {
            fn doSyscall(wchar_buf: []u16) bun.sys.Maybe(usize) {
                var proc_token: bun.windows.HANDLE = undefined;
                const proc_hndl = bun.windows.GetCurrentProcess();
                var rc = bun.windows.OpenProcessToken(
                    proc_hndl,
                    bun.windows.TOKEN_READ,
                    &proc_token,
                );

                if (rc == bun.windows.FALSE) {
                    const err = bun.windows.GetLastError();
                    // TODO(markovejnovic): This conversion between Win32Error -> SystemErrno -> E
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
                    // TODO(markovejnovic): This conversion between Win32Error -> SystemErrno -> E
                    //                      feels very wrong.
                    return .initErr(
                        .fromCode(@enumFromInt(@intFromEnum(err)), .GetUserProfileDirectoryW),
                    );
                }

                // Either the buffer was too small (in which case path_size contains the required
                // size), or we succeeded (in which case path_size contains the actual size).
                return .initResult(@intCast(path_size));
            }
        }).doSyscall,
    )) {
        .err => |e| {
            return .initErr(e);
        },
        .result => |res| {
            defer allocator.free(res.buf);
            const data_ptr = bun.handleOom(allocator.create([]u8));
            data_ptr.* = bun.handleOom(bun.strings.toUTF8Alloc(
                allocator,
                res.slice,
            ));

            if (Static.path.tryStore(.init(data_ptr))) |v| {
                allocator.free(data_ptr.*);
                allocator.destroy(data_ptr);
                return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
            }

            bun.memory.INTENTIONALLY_LEAK(
                allocator,
                @ptrCast(data_ptr),
                "windows directory considered singleton",
            );
            return .initResult(data_ptr.*);
        },
    }
}

// Windows-specific TMP/TEMP directory retrieval.
pub fn querySysTmpDir() bun.sys.Maybe([]const u8) {
    // Microsoft says:
    // For non-system processes, the GetTempPath2 function checks for the existence of environment
    // variables in the following order and uses the first path found:
    //   1. The path specified by the TMP environment variable.
    //   2. The path specified by the TEMP environment variable.
    //   3. The path specified by the USERPROFILE environment variable.
    //   4. The Windows directory.
    // The maximum possible return value is MAX_PATH+1 (261).
    //
    // They also say:
    //
    // When calling this function from a process running as SYSTEM it will return the path
    // C:\Windows\SystemTemp, which is inaccessible to non-SYSTEM processes. For non-SYSTEM
    // processes, GetTempPath2 will behave the same as GetTemppaths.
    //
    // For system processes, the GetTempPath2 function checks for the existence of the environment
    // variable SystemTemp. If this environment variable is set, it will use the value of the
    // environment variable as the path instead of the default system provided path on the C:
    // drive.
    //
    // We do not implement this SYSTEM-specific behavior. There is no reason to call Bun as a
    // SYSTEM process.
    //
    // Furthermore, we deviate from the documented behavior of GetTempPath2 since it's fucking
    // stupid -- why on earth would we ever want to polute the user directory, or worse even the
    // Windows directory? That makes zero sense. Therefore, if we do fall that far down the list,
    // we will append temp to the path.
    //
    // This matches Node and is close to what CPython does.
    const allocator = bun.default_allocator;

    const Static = struct {
        var path: AtomicMaybeManagedPath = .{};
    };

    if (Static.path.getSlice()) |s| {
        return .initResult(s);
    }

    if (bun.getenvZ("TMP") orelse bun.getenvZ("TEMP")) |t| use_envvar: {
        if (!std.fs.path.isAbsolute(t)) {
            break :use_envvar;
        }

        const hpath = bun.handleOom(allocator.create([]const u8));
        hpath.* = t;

        if (Static.path.tryStore(.init(hpath))) |v| {
            allocator.destroy(hpath);
            return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
        }
        return .initResult(t);
    }

    const user_profile = queryUserProfile();
    if (user_profile.asValue()) |up| {
        const result = std.mem.concat(allocator, u8, &.{ up, "\\Temp" }) catch |err| {
            switch (err) {
                error.OutOfMemory => return .initErr(.fromCode(.NOMEM, .GetTempPath2)),
            }
        };

        const hpath = bun.handleOom(allocator.create([]u8));
        hpath.* = result;

        if (Static.path.tryStore(.init(hpath))) |v| {
            allocator.free(result);
            allocator.destroy(hpath);
            return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
        }

        bun.memory.INTENTIONALLY_LEAK(
            allocator,
            @ptrCast(hpath),
            "temp directory considered singleton",
        );
        return .initResult(result);
    }

    const win_dir = queryWinDir();
    if (win_dir.asValue()) |wd| {
        const result = std.mem.concat(allocator, u8, &.{ wd, "\\Temp" }) catch |err| {
            switch (err) {
                error.OutOfMemory => return .initErr(.fromCode(.NOMEM, .GetTempPath2)),
            }
        };

        const hpath = bun.handleOom(allocator.create([]u8));
        hpath.* = result;

        if (Static.path.tryStore(.init(hpath))) |v| {
            allocator.destroy(hpath);
            return .initResult(AtomicMaybeManagedPath.forceAsSlice(v));
        }

        bun.memory.INTENTIONALLY_LEAK(
            allocator,
            @ptrCast(hpath),
            "root directory considered singleton",
        );
        return .initResult(result);
    }

    return .initErr(
        user_profile.asErr() orelse win_dir.asErr() orelse .fromCode(.UNKNOWN, .GetTempPath2),
    );
}

const bun = @import("bun");
const std = @import("std");
