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
const bun = @import("bun");
const Environment = @import("./env.zig");

const translated = @import("translated-c-headers");

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

pub extern fn strlen(ptr: [*c]const u8) usize;
