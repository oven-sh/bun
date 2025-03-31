//! Adding to this namespace is considered deprecated.
//!
//! If the declaration truly came from C, it should be perfectly possible to
//! translate the definition and put it in `c-headers-for-zig.h`, and available
//! via the lowercase `c` namespace. Wrappers around functions should go in a
//! more specific namespace, such as `bun.spawn`, `bun.strings` or `bun.sys`
//!
//! By avoiding manual transcription of C headers into Zig, we avoid bugs due to
//! different definitions between platforms, as well as very common mistakes
//! that can be made when porting definitions. It also keeps code much cleaner.
const std = @import("std");
const bun = @import("root").bun;
const Environment = @import("./env.zig");

pub const translated = @import("translated-c-headers");

const PlatformSpecific = switch (Environment.os) {
    .mac => @import("./darwin_c.zig"),
    .linux => @import("./linux_c.zig"),
    .windows => @import("./windows_c.zig"),
    else => struct {},
};
pub usingnamespace PlatformSpecific;

const C = std.c;
const builtin = @import("builtin");
const posix = std.posix;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const errno = posix.errno;
const mode_t = bun.Mode;
// TODO: this is wrong on Windows
const libc_stat = bun.Stat;

const zeroes = mem.zeroes;
pub const darwin = @import("./darwin_c.zig");
pub const linux = @import("./linux_c.zig");
pub extern "c" fn chmod([*c]const u8, mode_t) c_int;
pub extern "c" fn fchmod(std.c.fd_t, mode_t) c_int;
pub extern "c" fn fchmodat(c_int, [*c]const u8, mode_t, c_int) c_int;
pub extern "c" fn fchown(std.c.fd_t, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lchown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn chown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lchmod(path: [*:0]const u8, mode: mode_t) c_int;
pub extern "c" fn truncate([*:0]const u8, i64) c_int; // note: truncate64 is not a thing

pub extern "c" fn lutimes(path: [*:0]const u8, times: *const [2]std.posix.timeval) c_int;
pub extern "c" fn mkdtemp(template: [*c]u8) ?[*:0]u8;

pub extern "c" fn memcmp(s1: [*c]const u8, s2: [*c]const u8, n: usize) c_int;
pub extern "c" fn memchr(s: [*]const u8, c: u8, n: usize) ?[*]const u8;

pub extern "c" fn strchr(str: [*]const u8, char: u8) ?[*]const u8;

pub fn lstat_absolute(path: [:0]const u8) !Stat {
    if (builtin.os.tag == .windows) {
        @compileError("Not implemented yet, consider using bun.sys.lstat()");
    }

    var st = zeroes(libc_stat);
    switch (errno(bun.C.lstat(path.ptr, &st))) {
        .SUCCESS => {},
        .NOENT => return error.FileNotFound,
        // .EINVAL => unreachable,
        .BADF => unreachable, // Always a race condition.
        .NOMEM => return error.SystemResources,
        .ACCES => return error.AccessDenied,
        else => |err| return posix.unexpectedErrno(err),
    }

    const atime = st.atime();
    const mtime = st.mtime();
    const ctime = st.ctime();
    return Stat{
        .inode = st.ino,
        .size = @as(u64, @bitCast(st.size)),
        .mode = st.mode,
        .kind = switch (builtin.os.tag) {
            .wasi => switch (st.filetype) {
                posix.FILETYPE_BLOCK_DEVICE => Kind.block_device,
                posix.FILETYPE_CHARACTER_DEVICE => Kind.character_device,
                posix.FILETYPE_DIRECTORY => Kind.directory,
                posix.FILETYPE_SYMBOLIC_LINK => Kind.sym_link,
                posix.FILETYPE_REGULAR_FILE => Kind.file,
                posix.FILETYPE_SOCKET_STREAM, posix.FILETYPE_SOCKET_DGRAM => Kind.unix_domain_socket,
                else => Kind.unknown,
            },
            else => switch (st.mode & posix.S.IFMT) {
                posix.S.IFBLK => Kind.block_device,
                posix.S.IFCHR => Kind.character_device,
                posix.S.IFDIR => Kind.directory,
                posix.S.IFIFO => Kind.named_pipe,
                posix.S.IFLNK => Kind.sym_link,
                posix.S.IFREG => Kind.file,
                posix.S.IFSOCK => Kind.unix_domain_socket,
                else => Kind.unknown,
            },
        },
        .atime = @as(i128, atime.sec) * std.time.ns_per_s + atime.nsec,
        .mtime = @as(i128, mtime.sec) * std.time.ns_per_s + mtime.nsec,
        .ctime = @as(i128, ctime.sec) * std.time.ns_per_s + ctime.nsec,
    };
}

// renameatZ fails when renaming across mount points
// we assume that this is relatively uncommon
pub fn moveFileZ(from_dir: bun.FileDescriptor, filename: [:0]const u8, to_dir: bun.FileDescriptor, destination: [:0]const u8) !void {
    switch (bun.sys.renameatConcurrentlyWithoutFallback(from_dir, filename, to_dir, destination)) {
        .err => |err| {
            // allow over-writing an empty directory
            if (err.getErrno() == .ISDIR) {
                _ = bun.sys.rmdirat(to_dir, destination.ptr);
                try bun.sys.renameat(from_dir, filename, to_dir, destination).unwrap();
                return;
            }

            if (err.getErrno() == .XDEV) {
                try moveFileZSlow(from_dir, filename, to_dir, destination);
            } else {
                return bun.errnoToZigErr(err.errno);
            }
        },
        .result => {},
    }
}

pub fn moveFileZWithHandle(from_handle: bun.FileDescriptor, from_dir: bun.FileDescriptor, filename: [:0]const u8, to_dir: bun.FileDescriptor, destination: [:0]const u8) !void {
    switch (bun.sys.renameat(from_dir, filename, to_dir, destination)) {
        .err => |err| {
            // allow over-writing an empty directory
            if (err.getErrno() == .ISDIR) {
                _ = bun.sys.rmdirat(to_dir, destination.ptr);

                try (bun.sys.renameat(from_dir, filename, to_dir, destination).unwrap());
                return;
            }

            if (err.getErrno() == .XDEV) {
                try copyFileZSlowWithHandle(from_handle, to_dir, destination).unwrap();
                _ = bun.sys.unlinkat(from_dir, filename);
            }

            return bun.errnoToZigErr(err.errno);
        },
        .result => {},
    }
}

const Maybe = bun.sys.Maybe;

// On Linux, this will be fast because sendfile() supports copying between two file descriptors on disk
// macOS & BSDs will be slow because
pub fn moveFileZSlow(from_dir: bun.FileDescriptor, filename: [:0]const u8, to_dir: bun.FileDescriptor, destination: [:0]const u8) !void {
    return try moveFileZSlowMaybe(from_dir, filename, to_dir, destination).unwrap();
}

pub fn moveFileZSlowMaybe(from_dir: bun.FileDescriptor, filename: [:0]const u8, to_dir: bun.FileDescriptor, destination: [:0]const u8) Maybe(void) {
    const in_handle = switch (bun.sys.openat(from_dir, filename, bun.O.RDONLY | bun.O.CLOEXEC, if (Environment.isWindows) 0 else 0o644)) {
        .result => |f| f,
        .err => |e| return .{ .err = e },
    };
    defer _ = bun.sys.close(in_handle);
    _ = bun.sys.unlinkat(from_dir, filename);
    return copyFileZSlowWithHandle(in_handle, to_dir, destination);
}

pub fn copyFileZSlowWithHandle(in_handle: bun.FileDescriptor, to_dir: bun.FileDescriptor, destination: [:0]const u8) Maybe(void) {
    if (comptime Environment.isWindows) {
        var buf0: bun.WPathBuffer = undefined;
        var buf1: bun.WPathBuffer = undefined;

        const dest = switch (bun.sys.normalizePathWindows(u8, to_dir, destination, &buf0, .{})) {
            .result => |x| x,
            .err => |e| return .{ .err = e },
        };
        const src_len = bun.windows.GetFinalPathNameByHandleW(in_handle.cast(), &buf1, buf1.len, 0);
        if (src_len == 0) {
            return Maybe(void).errno(bun.C.E.BUSY, .GetFinalPathNameByHandle);
        } else if (src_len >= buf1.len) {
            return Maybe(void).errno(bun.C.E.NAMETOOLONG, .GetFinalPathNameByHandle);
        }
        const src = buf1[0..src_len :0];
        return bun.copyFile(src, dest);
    } else {
        const stat_ = switch (bun.sys.fstat(in_handle)) {
            .result => |s| s,
            .err => |e| return .{ .err = e },
        };

        // Attempt to delete incase it already existed.
        // This fixes ETXTBUSY on Linux
        _ = bun.sys.unlinkat(to_dir, destination);

        const out_handle = switch (bun.sys.openat(
            to_dir,
            destination,
            bun.O.WRONLY | bun.O.CREAT | bun.O.CLOEXEC | bun.O.TRUNC,
            if (comptime Environment.isPosix) 0o644 else 0,
        )) {
            .result => |fd| fd,
            .err => |e| return .{ .err = e },
        };
        defer _ = bun.sys.close(out_handle);

        if (comptime Environment.isLinux) {
            _ = std.os.linux.fallocate(out_handle.cast(), 0, 0, @intCast(stat_.size));
        }

        switch (bun.copyFile(in_handle.cast(), out_handle.cast())) {
            .err => |e| return .{ .err = e },
            .result => {},
        }

        if (comptime Environment.isPosix) {
            _ = fchmod(out_handle.cast(), stat_.mode);
            _ = fchown(out_handle.cast(), stat_.uid, stat_.gid);
        }

        return Maybe(void).success;
    }
}

pub fn kindFromMode(mode: mode_t) std.fs.File.Kind {
    return switch (mode & bun.S.IFMT) {
        bun.S.IFBLK => std.fs.File.Kind.block_device,
        bun.S.IFCHR => std.fs.File.Kind.character_device,
        bun.S.IFDIR => std.fs.File.Kind.directory,
        bun.S.IFIFO => std.fs.File.Kind.named_pipe,
        bun.S.IFLNK => std.fs.File.Kind.sym_link,
        bun.S.IFREG => std.fs.File.Kind.file,
        bun.S.IFSOCK => std.fs.File.Kind.unix_domain_socket,
        else => .unknown,
    };
}

pub fn getSelfExeSharedLibPaths(allocator: std.mem.Allocator) error{OutOfMemory}![][:0]u8 {
    const List = std.ArrayList([:0]u8);
    switch (builtin.os.tag) {
        .linux,
        .freebsd,
        .netbsd,
        .dragonfly,
        .openbsd,
        .solaris,
        => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice() catch &.{};
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            try posix.dl_iterate_phdr(&paths, error{OutOfMemory}, struct {
                fn callback(info: *posix.dl_phdr_info, size: usize, list: *List) !void {
                    _ = size;
                    const name = info.dlpi_name orelse return;
                    if (name[0] == '/') {
                        const item = try list.allocator.dupeZ(u8, mem.sliceTo(name, 0));
                        errdefer list.allocator.free(item);
                        try list.append(item);
                    }
                }
            }.callback);
            return try paths.toOwnedSlice();
        },
        .macos, .ios, .watchos, .tvos => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice() catch &.{};
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            const img_count = std.c._dyld_image_count();
            for (0..img_count) |i| {
                const name = std.c._dyld_get_image_name(i);
                const item = try allocator.dupeZ(u8, mem.sliceTo(name, 0));
                errdefer allocator.free(item);
                try paths.append(item);
            }
            return try paths.toOwnedSlice();
        },
        // revisit if Haiku implements dl_iterat_phdr (https://dev.haiku-os.org/ticket/15743)
        .haiku => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice() catch &.{};
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }

            const b = "/boot/system/runtime_loader";
            const item = try allocator.dupeZ(u8, mem.sliceTo(b, 0));
            errdefer allocator.free(item);
            try paths.append(item);

            return try paths.toOwnedSlice();
        },
        else => @compileError("getSelfExeSharedLibPaths unimplemented for this target"),
    }
}

///     The madvise() system call allows a process that has knowledge of its mem-ory memory
///     ory behavior to describe it to the system.  The advice passed in may be
///     used by the system to alter its virtual memory paging strategy.  This
///     advice may improve application and system performance.  The behavior
///     specified in advice can only be one of the following values:
///
///     MADV_NORMAL      Indicates that the application has no advice to give on
///                      its behavior in the specified address range.  This is
///                      the system default behavior.  This is used with
///                      madvise() system call.
///
///     POSIX_MADV_NORMAL
///                      Same as MADV_NORMAL but used with posix_madvise() system
///                      call.
///
///     MADV_SEQUENTIAL  Indicates that the application expects to access this
///                      address range in a sequential manner.  This is used with
///                      madvise() system call.
///
///     POSIX_MADV_SEQUENTIAL
///                      Same as MADV_SEQUENTIAL but used with posix_madvise()
///                      system call.
///
///     MADV_RANDOM      Indicates that the application expects to access this
///                      address range in a random manner.  This is used with
///                      madvise() system call.
///
///     POSIX_MADV_RANDOM
///                      Same as MADV_RANDOM but used with posix_madvise() system
///                      call.
///
///     MADV_WILLNEED    Indicates that the application expects to access this
///                      address range soon.  This is used with madvise() system
///                      call.
///
///     POSIX_MADV_WILLNEED
///                      Same as MADV_WILLNEED but used with posix_madvise() sys-tem system
///                      tem call.
///
///     MADV_DONTNEED    Indicates that the application is not expecting to
///                      access this address range soon.  This is used with
///                      madvise() system call.
///
///     POSIX_MADV_DONTNEED
///                      Same as MADV_DONTNEED but used with posix_madvise() sys-tem system
///                      tem call.
///
///     MADV_FREE        Indicates that the application will not need the information
///                      contained in this address range, so the pages may
///                      be reused right away.  The address range will remain
///                      valid.  This is used with madvise() system call.
///
///     The posix_madvise() behaves same as madvise() except that it uses values
///     with POSIX_ prefix for the advice system call argument.
pub extern "c" fn posix_madvise(ptr: *anyopaque, len: usize, advice: i32) c_int;

pub fn setProcessPriority(pid: i32, priority: i32) std.c.E {
    if (pid < 0) return .SRCH;

    const code: i32 = set_process_priority(pid, priority);

    if (code == -2) return .SRCH;
    if (code == 0) return .SUCCESS;

    const errcode = bun.sys.getErrno(code);
    return @enumFromInt(@intFromEnum(errcode));
}

pub fn getVersion(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_version(buf.ptr[0..bun.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_version(buf);
    } else {
        var info: bun.windows.libuv.uv_utsname_s = undefined;
        const err = bun.windows.libuv.uv_os_uname(&info);
        if (err != 0) {
            return "unknown";
        }
        const slice = bun.sliceTo(&info.version, 0);
        @memcpy(buf[0..slice.len], slice);
        return buf[0..slice.len];
    }
}

pub fn getRelease(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_release(buf.ptr[0..bun.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_release(buf);
    } else {
        var info: bun.windows.libuv.uv_utsname_s = undefined;
        const err = bun.windows.libuv.uv_os_uname(&info);
        if (err != 0) {
            return "unknown";
        }
        const release = bun.sliceTo(&info.release, 0);
        @memcpy(buf[0..release.len], release);
        return buf[0..release.len];
    }
}

pub extern fn cfmakeraw(*std.posix.termios) void;

const LazyStatus = enum {
    pending,
    loaded,
    failed,
};

pub fn _dlsym(handle: ?*anyopaque, name: [:0]const u8) ?*anyopaque {
    if (comptime Environment.isWindows) {
        return bun.windows.GetProcAddressA(handle, name);
    } else if (comptime Environment.isMac or Environment.isLinux) {
        return std.c.dlsym(handle, name.ptr);
    }

    @compileError("dlsym unimplemented for this target");
}

pub fn dlsymWithHandle(comptime Type: type, comptime name: [:0]const u8, comptime handle_getter: fn () ?*anyopaque) ?Type {
    if (comptime @typeInfo(Type) != .pointer) {
        @compileError("dlsym must be a pointer type (e.g. ?const *fn()). Received " ++ @typeName(Type) ++ ".");
    }

    const Wrapper = struct {
        pub var function: Type = undefined;
        var failed = false;
        pub var once = std.once(loadOnce);
        fn loadOnce() void {
            function = bun.cast(Type, _dlsym(@call(bun.callmod_inline, handle_getter, .{}), name) orelse {
                failed = true;
                return;
            });
        }
    };
    Wrapper.once.call();
    if (Wrapper.failed) {
        return null;
    }
    return Wrapper.function;
}

pub fn dlsym(comptime Type: type, comptime name: [:0]const u8) ?Type {
    const handle_getter = struct {
        const RTLD_DEFAULT = if (bun.Environment.isMac)
            @as(?*anyopaque, @ptrFromInt(@as(usize, @bitCast(@as(isize, -2)))))
        else
            @as(?*anyopaque, @ptrFromInt(@as(usize, 0)));

        pub fn getter() ?*anyopaque {
            return RTLD_DEFAULT;
        }
    }.getter;

    return dlsymWithHandle(Type, name, handle_getter);
}

/// Error condition is encoded as null
/// The only error in this function is ESRCH (no process found)
pub fn getProcessPriority(pid: i32) ?i32 {
    return switch (get_process_priority(pid)) {
        std.math.maxInt(i32) => null,
        else => |prio| prio,
    };
}

// set in c-bindings.cpp
extern fn get_process_priority(pid: i32) i32;
pub extern fn set_process_priority(pid: i32, priority: i32) i32;

pub extern fn strncasecmp(s1: [*]const u8, s2: [*]const u8, n: usize) i32;
pub extern fn memmove(dest: [*]u8, src: [*]const u8, n: usize) void;

pub fn move(dest: []u8, src: []const u8) void {
    if (comptime Environment.allow_assert) {
        if (src.len != dest.len) {
            bun.Output.panic("Move: src.len != dest.len, {d} != {d}", .{ src.len, dest.len });
        }
    }
    memmove(dest.ptr, src.ptr, src.len);
}

// https://man7.org/linux/man-pages/man3/fmod.3.html
pub extern fn fmod(f64, f64) f64;

pub fn dlopen(filename: [:0]const u8, flags: C.RTLD) ?*anyopaque {
    if (comptime Environment.isWindows) {
        return bun.windows.LoadLibraryA(filename);
    }

    return std.c.dlopen(filename, flags);
}

pub extern "c" fn Bun__ttySetMode(fd: c_int, mode: c_int) c_int;

pub extern "c" fn bun_initialize_process() void;
pub extern "c" fn bun_restore_stdio() void;
pub extern "c" fn open_as_nonblocking_tty(i32, i32) i32;

pub extern fn strlen(ptr: [*c]const u8) usize;

pub const passwd = translated.passwd;
pub const geteuid = translated.geteuid;
pub const getpwuid_r = translated.getpwuid_r;

export fn Bun__errnoName(err: c_int) ?[*:0]const u8 {
    return @tagName(bun.C.SystemErrno.init(err) orelse return null);
}
