const std = @import("std");
const bun = @import("root").bun;
pub extern "C" fn memmem(haystack: [*]const u8, haystacklen: usize, needle: [*]const u8, needlelen: usize) ?[*]const u8;
pub const SystemErrno = enum(u8) {
    SUCCESS = 0,
    EPERM = 1,
    ENOENT = 2,
    ESRCH = 3,
    EINTR = 4,
    EIO = 5,
    ENXIO = 6,
    E2BIG = 7,
    ENOEXEC = 8,
    EBADF = 9,
    ECHILD = 10,
    EAGAIN = 11,
    ENOMEM = 12,
    EACCES = 13,
    EFAULT = 14,
    ENOTBLK = 15,
    EBUSY = 16,
    EEXIST = 17,
    EXDEV = 18,
    ENODEV = 19,
    ENOTDIR = 20,
    EISDIR = 21,
    EINVAL = 22,
    ENFILE = 23,
    EMFILE = 24,
    ENOTTY = 25,
    ETXTBSY = 26,
    EFBIG = 27,
    ENOSPC = 28,
    ESPIPE = 29,
    EROFS = 30,
    EMLINK = 31,
    EPIPE = 32,
    EDOM = 33,
    ERANGE = 34,
    EDEADLK = 35,
    ENAMETOOLONG = 36,
    ENOLCK = 37,
    ENOSYS = 38,
    ENOTEMPTY = 39,
    ELOOP = 40,
    EWOULDBLOCK = 41,
    ENOMSG = 42,
    EIDRM = 43,
    ECHRNG = 44,
    EL2NSYNC = 45,
    EL3HLT = 46,
    EL3RST = 47,
    ELNRNG = 48,
    EUNATCH = 49,
    ENOCSI = 50,
    EL2HLT = 51,
    EBADE = 52,
    EBADR = 53,
    EXFULL = 54,
    ENOANO = 55,
    EBADRQC = 56,
    EBADSLT = 57,
    EDEADLOCK = 58,
    EBFONT = 59,
    ENOSTR = 60,
    ENODATA = 61,
    ETIME = 62,
    ENOSR = 63,
    ENONET = 64,
    ENOPKG = 65,
    EREMOTE = 66,
    ENOLINK = 67,
    EADV = 68,
    ESRMNT = 69,
    ECOMM = 70,
    EPROTO = 71,
    EMULTIHOP = 72,
    EDOTDOT = 73,
    EBADMSG = 74,
    EOVERFLOW = 75,
    ENOTUNIQ = 76,
    EBADFD = 77,
    EREMCHG = 78,
    ELIBACC = 79,
    ELIBBAD = 80,
    ELIBSCN = 81,
    ELIBMAX = 82,
    ELIBEXEC = 83,
    EILSEQ = 84,
    ERESTART = 85,
    ESTRPIPE = 86,
    EUSERS = 87,
    ENOTSOCK = 88,
    EDESTADDRREQ = 89,
    EMSGSIZE = 90,
    EPROTOTYPE = 91,
    ENOPROTOOPT = 92,
    EPROTONOSUPPORT = 93,
    ESOCKTNOSUPPORT = 94,
    /// For Linux, EOPNOTSUPP is the real value
    /// but it's ~the same and is incompatible across operating systems
    /// https://lists.gnu.org/archive/html/bug-glibc/2002-08/msg00017.html
    ENOTSUP = 95,
    EPFNOSUPPORT = 96,
    EAFNOSUPPORT = 97,
    EADDRINUSE = 98,
    EADDRNOTAVAIL = 99,
    ENETDOWN = 100,
    ENETUNREACH = 101,
    ENETRESET = 102,
    ECONNABORTED = 103,
    ECONNRESET = 104,
    ENOBUFS = 105,
    EISCONN = 106,
    ENOTCONN = 107,
    ESHUTDOWN = 108,
    ETOOMANYREFS = 109,
    ETIMEDOUT = 110,
    ECONNREFUSED = 111,
    EHOSTDOWN = 112,
    EHOSTUNREACH = 113,
    EALREADY = 114,
    EINPROGRESS = 115,
    ESTALE = 116,
    EUCLEAN = 117,
    ENOTNAM = 118,
    ENAVAIL = 119,
    EISNAM = 120,
    EREMOTEIO = 121,
    EDQUOT = 122,
    ENOMEDIUM = 123,
    EMEDIUMTYPE = 124,
    ECANCELED = 125,
    ENOKEY = 126,
    EKEYEXPIRED = 127,
    EKEYREVOKED = 128,
    EKEYREJECTED = 129,
    EOWNERDEAD = 130,
    ENOTRECOVERABLE = 131,
    ERFKILL = 132,
    EHWPOISON = 133,

    pub const max = 134;

    pub fn init(code: anytype) ?SystemErrno {
        if (code < 0) {
            if (code <= -max) {
                return null;
            }
            return @enumFromInt(-code);
        }
        if (code >= max) return null;
        return @enumFromInt(code);
    }
};

pub const UV_E2BIG: i32 = @intFromEnum(SystemErrno.E2BIG);
pub const UV_EACCES: i32 = @intFromEnum(SystemErrno.EACCES);
pub const UV_EADDRINUSE: i32 = @intFromEnum(SystemErrno.EADDRINUSE);
pub const UV_EADDRNOTAVAIL: i32 = @intFromEnum(SystemErrno.EADDRNOTAVAIL);
pub const UV_EAFNOSUPPORT: i32 = @intFromEnum(SystemErrno.EAFNOSUPPORT);
pub const UV_EAGAIN: i32 = @intFromEnum(SystemErrno.EAGAIN);
pub const UV_EALREADY: i32 = @intFromEnum(SystemErrno.EALREADY);
pub const UV_EBADF: i32 = @intFromEnum(SystemErrno.EBADF);
pub const UV_EBUSY: i32 = @intFromEnum(SystemErrno.EBUSY);
pub const UV_ECANCELED: i32 = @intFromEnum(SystemErrno.ECANCELED);
pub const UV_ECHARSET: i32 = -bun.windows.libuv.UV_ECHARSET;
pub const UV_ECONNABORTED: i32 = @intFromEnum(SystemErrno.ECONNABORTED);
pub const UV_ECONNREFUSED: i32 = @intFromEnum(SystemErrno.ECONNREFUSED);
pub const UV_ECONNRESET: i32 = @intFromEnum(SystemErrno.ECONNRESET);
pub const UV_EDESTADDRREQ: i32 = @intFromEnum(SystemErrno.EDESTADDRREQ);
pub const UV_EEXIST: i32 = @intFromEnum(SystemErrno.EEXIST);
pub const UV_EFAULT: i32 = @intFromEnum(SystemErrno.EFAULT);
pub const UV_EHOSTUNREACH: i32 = @intFromEnum(SystemErrno.EHOSTUNREACH);
pub const UV_EINTR: i32 = @intFromEnum(SystemErrno.EINTR);
pub const UV_EINVAL: i32 = @intFromEnum(SystemErrno.EINVAL);
pub const UV_EIO: i32 = @intFromEnum(SystemErrno.EIO);
pub const UV_EISCONN: i32 = @intFromEnum(SystemErrno.EISCONN);
pub const UV_EISDIR: i32 = @intFromEnum(SystemErrno.EISDIR);
pub const UV_ELOOP: i32 = @intFromEnum(SystemErrno.ELOOP);
pub const UV_EMFILE: i32 = @intFromEnum(SystemErrno.EMFILE);
pub const UV_EMSGSIZE: i32 = @intFromEnum(SystemErrno.EMSGSIZE);
pub const UV_ENAMETOOLONG: i32 = @intFromEnum(SystemErrno.ENAMETOOLONG);
pub const UV_ENETDOWN: i32 = @intFromEnum(SystemErrno.ENETDOWN);
pub const UV_ENETUNREACH: i32 = @intFromEnum(SystemErrno.ENETUNREACH);
pub const UV_ENFILE: i32 = @intFromEnum(SystemErrno.ENFILE);
pub const UV_ENOBUFS: i32 = @intFromEnum(SystemErrno.ENOBUFS);
pub const UV_ENODEV: i32 = @intFromEnum(SystemErrno.ENODEV);
pub const UV_ENOENT: i32 = @intFromEnum(SystemErrno.ENOENT);
pub const UV_ENOMEM: i32 = @intFromEnum(SystemErrno.ENOMEM);
pub const UV_ENONET: i32 = @intFromEnum(SystemErrno.ENONET);
pub const UV_ENOSPC: i32 = @intFromEnum(SystemErrno.ENOSPC);
pub const UV_ENOSYS: i32 = @intFromEnum(SystemErrno.ENOSYS);
pub const UV_ENOTCONN: i32 = @intFromEnum(SystemErrno.ENOTCONN);
pub const UV_ENOTDIR: i32 = @intFromEnum(SystemErrno.ENOTDIR);
pub const UV_ENOTEMPTY: i32 = @intFromEnum(SystemErrno.ENOTEMPTY);
pub const UV_ENOTSOCK: i32 = @intFromEnum(SystemErrno.ENOTSOCK);
pub const UV_ENOTSUP: i32 = @intFromEnum(SystemErrno.ENOTSUP);
pub const UV_EPERM: i32 = @intFromEnum(SystemErrno.EPERM);
pub const UV_EPIPE: i32 = @intFromEnum(SystemErrno.EPIPE);
pub const UV_EPROTO: i32 = @intFromEnum(SystemErrno.EPROTO);
pub const UV_EPROTONOSUPPORT: i32 = @intFromEnum(SystemErrno.EPROTONOSUPPORT);
pub const UV_EPROTOTYPE: i32 = @intFromEnum(SystemErrno.EPROTOTYPE);
pub const UV_EROFS: i32 = @intFromEnum(SystemErrno.EROFS);
pub const UV_ESHUTDOWN: i32 = @intFromEnum(SystemErrno.ESHUTDOWN);
pub const UV_ESPIPE: i32 = @intFromEnum(SystemErrno.ESPIPE);
pub const UV_ESRCH: i32 = @intFromEnum(SystemErrno.ESRCH);
pub const UV_ETIMEDOUT: i32 = @intFromEnum(SystemErrno.ETIMEDOUT);
pub const UV_ETXTBSY: i32 = @intFromEnum(SystemErrno.ETXTBSY);
pub const UV_EXDEV: i32 = @intFromEnum(SystemErrno.EXDEV);
pub const UV_EFBIG: i32 = @intFromEnum(SystemErrno.EFBIG);
pub const UV_ENOPROTOOPT: i32 = @intFromEnum(SystemErrno.ENOPROTOOPT);
pub const UV_ERANGE: i32 = @intFromEnum(SystemErrno.ERANGE);
pub const UV_ENXIO: i32 = @intFromEnum(SystemErrno.ENXIO);
pub const UV_EMLINK: i32 = @intFromEnum(SystemErrno.EMLINK);
pub const UV_EHOSTDOWN: i32 = @intFromEnum(SystemErrno.EHOSTDOWN);
pub const UV_EREMOTEIO: i32 = @intFromEnum(SystemErrno.EREMOTEIO);
pub const UV_ENOTTY: i32 = @intFromEnum(SystemErrno.ENOTTY);
pub const UV_EFTYPE: i32 = -bun.windows.libuv.UV_EFTYPE;
pub const UV_EILSEQ: i32 = @intFromEnum(SystemErrno.EILSEQ);
pub const UV_EOVERFLOW: i32 = @intFromEnum(SystemErrno.EOVERFLOW);
pub const UV_ESOCKTNOSUPPORT: i32 = @intFromEnum(SystemErrno.ESOCKTNOSUPPORT);
pub const UV_ENODATA: i32 = @intFromEnum(SystemErrno.ENODATA);
pub const UV_EUNATCH: i32 = @intFromEnum(SystemErrno.EUNATCH);

pub const preallocate_length = 2048 * 1024;
pub fn preallocate_file(fd: std.posix.fd_t, offset: std.posix.off_t, len: std.posix.off_t) anyerror!void {
    // https://gist.github.com/Jarred-Sumner/b37b93399b63cbfd86e908c59a0a37df
    //  ext4 NVME Linux kernel 5.17.0-1016-oem x86_64
    //
    // hyperfine "./micro 1024 temp" "./micro 1024 temp --preallocate" --prepare="rm -rf temp && free && sync && echo 3 > /proc/sys/vm/drop_caches && free"
    // Benchmark 1: ./micro 1024 temp
    //   Time (mean ± σ):       1.8 ms ±   0.2 ms    [User: 0.6 ms, System: 0.1 ms]
    //   Range (min … max):     1.2 ms …   2.3 ms    67 runs
    // Benchmark 2: ./micro 1024 temp --preallocate
    //   Time (mean ± σ):       1.8 ms ±   0.1 ms    [User: 0.6 ms, System: 0.1 ms]
    //   Range (min … max):     1.4 ms …   2.2 ms    121 runs
    // Summary
    //   './micro 1024 temp --preallocate' ran
    //     1.01 ± 0.13 times faster than './micro 1024 temp'

    // hyperfine "./micro 65432 temp" "./micro 65432 temp --preallocate" --prepare="rm -rf temp && free && sync && echo 3 > /proc/sys/vm/drop_caches && free"
    // Benchmark 1: ./micro 65432 temp
    //   Time (mean ± σ):       1.8 ms ±   0.2 ms    [User: 0.7 ms, System: 0.1 ms]
    //   Range (min … max):     1.2 ms …   2.3 ms    94 runs
    // Benchmark 2: ./micro 65432 temp --preallocate
    //   Time (mean ± σ):       2.0 ms ±   0.1 ms    [User: 0.6 ms, System: 0.1 ms]
    //   Range (min … max):     1.7 ms …   2.3 ms    108 runs
    // Summary
    //   './micro 65432 temp' ran
    //     1.08 ± 0.12 times faster than './micro 65432 temp --preallocate'

    // hyperfine "./micro 654320 temp" "./micro 654320 temp --preallocate" --prepare="rm -rf temp && free && sync && echo 3 > /proc/sys/vm/drop_caches && free"
    // Benchmark 1: ./micro 654320 temp
    //   Time (mean ± σ):       2.3 ms ±   0.2 ms    [User: 0.9 ms, System: 0.3 ms]
    //   Range (min … max):     1.9 ms …   2.9 ms    96 runs

    // Benchmark 2: ./micro 654320 temp --preallocate
    //   Time (mean ± σ):       2.2 ms ±   0.1 ms    [User: 0.9 ms, System: 0.2 ms]
    //   Range (min … max):     1.9 ms …   2.7 ms    115 runs

    //   Warning: Command took less than 5 ms to complete. Results might be inaccurate.

    // Summary
    //   './micro 654320 temp --preallocate' ran
    //     1.04 ± 0.10 times faster than './micro 654320 temp'

    // hyperfine "./micro 6543200 temp" "./micro 6543200 temp --preallocate" --prepare="rm -rf temp && free && sync && echo 3 > /proc/sys/vm/drop_caches && free"
    // Benchmark 1: ./micro 6543200 temp
    //   Time (mean ± σ):       6.3 ms ±   0.4 ms    [User: 0.4 ms, System: 4.9 ms]
    //   Range (min … max):     5.8 ms …   8.6 ms    84 runs

    // Benchmark 2: ./micro 6543200 temp --preallocate
    //   Time (mean ± σ):       5.5 ms ±   0.3 ms    [User: 0.5 ms, System: 3.9 ms]
    //   Range (min … max):     5.1 ms …   7.1 ms    93 runs

    // Summary
    //   './micro 6543200 temp --preallocate' ran
    //     1.14 ± 0.09 times faster than './micro 6543200 temp'

    // hyperfine "./micro 65432000 temp" "./micro 65432000 temp --preallocate" --prepare="rm -rf temp && free && sync && echo 3 > /proc/sys/vm/drop_caches && free"
    // Benchmark 1: ./micro 65432000 temp
    //   Time (mean ± σ):      52.9 ms ±   0.4 ms    [User: 3.1 ms, System: 48.7 ms]
    //   Range (min … max):    52.4 ms …  54.4 ms    36 runs

    // Benchmark 2: ./micro 65432000 temp --preallocate
    //   Time (mean ± σ):      44.6 ms ±   0.8 ms    [User: 2.3 ms, System: 41.2 ms]
    //   Range (min … max):    44.0 ms …  47.3 ms    37 runs

    // Summary
    //   './micro 65432000 temp --preallocate' ran
    //     1.19 ± 0.02 times faster than './micro 65432000 temp'

    // hyperfine "./micro 65432000 temp" "./micro 65432000 temp --preallocate" --prepare="rm -rf temp"
    // Benchmark 1: ./micro 65432000 temp
    //   Time (mean ± σ):      51.7 ms ±   0.9 ms    [User: 2.1 ms, System: 49.6 ms]
    //   Range (min … max):    50.7 ms …  54.1 ms    49 runs

    // Benchmark 2: ./micro 65432000 temp --preallocate
    //   Time (mean ± σ):      43.8 ms ±   2.3 ms    [User: 2.2 ms, System: 41.4 ms]
    //   Range (min … max):    42.7 ms …  54.7 ms    56 runs

    // Summary
    //   './micro 65432000 temp --preallocate' ran
    //     1.18 ± 0.06 times faster than './micro 65432000 temp'
    //
    _ = std.os.linux.fallocate(fd, 0, @as(i64, @intCast(offset)), len);
}

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

// System related
pub const struct_sysinfo = extern struct {
    uptime: c_long align(8),
    loads: [3]c_ulong,
    totalram: c_ulong,
    freeram: c_ulong,
    sharedram: c_ulong,
    bufferram: c_ulong,
    totalswap: c_ulong,
    freeswap: c_ulong,
    procs: u16,
    pad: u16,
    totalhigh: c_ulong,
    freehigh: c_ulong,
    mem_unit: u32,
    pub fn _f(self: anytype) @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8) {
        const Intermediate = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8);
        const ReturnType = @import("std").zig.c_translation.FlexibleArrayType(@TypeOf(self), u8);
        return @as(ReturnType, @ptrCast(@alignCast(@as(Intermediate, @ptrCast(self)) + 108)));
    }
};
pub extern fn sysinfo(__info: [*c]struct_sysinfo) c_int;

pub fn getFreeMemory() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @as(u64, @bitCast(info.freeram)) *% @as(c_ulong, @bitCast(@as(c_ulong, info.mem_unit)));
    return 0;
}

pub fn getTotalMemory() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @as(u64, @bitCast(info.totalram)) *% @as(c_ulong, @bitCast(@as(c_ulong, info.mem_unit)));
    return 0;
}

pub fn getSystemUptime() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @as(u64, @bitCast(info.uptime));
    return 0;
}

pub fn getSystemLoadavg() [3]f64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) {
        return [3]f64{
            std.math.ceil((@as(f64, @floatFromInt(info.loads[0])) / 65536.0) * 100.0) / 100.0,
            std.math.ceil((@as(f64, @floatFromInt(info.loads[1])) / 65536.0) * 100.0) / 100.0,
            std.math.ceil((@as(f64, @floatFromInt(info.loads[2])) / 65536.0) * 100.0) / 100.0,
        };
    }
    return [3]f64{ 0, 0, 0 };
}

pub fn get_version(name_buffer: *[bun.HOST_NAME_MAX]u8) []const u8 {
    const uts = std.posix.uname();
    const result = bun.sliceTo(&uts.version, 0);
    bun.copy(u8, name_buffer, result);

    return name_buffer[0..result.len];
}

pub fn get_release(name_buffer: *[bun.HOST_NAME_MAX]u8) []const u8 {
    const uts = std.posix.uname();
    const result = bun.sliceTo(&uts.release, 0);
    bun.copy(u8, name_buffer, result);

    return name_buffer[0..result.len];
}

// Taken from spawn.h header
pub const POSIX_SPAWN = struct {
    pub const RESETIDS = 0x01;
    pub const SETPGROUP = 0x02;
    pub const SETSIGDEF = 0x04;
    pub const SETSIGMASK = 0x08;
    pub const SETSCHEDPARAM = 0x10;
    pub const SETSCHEDULER = 0x20;
    pub const USEVFORK = 0x40;
    pub const SETSID = 0x80;
};

const fd_t = std.posix.fd_t;
const pid_t = std.posix.pid_t;
const mode_t = std.posix.mode_t;
const sigset_t = std.c.sigset_t;
const sched_param = std.posix.sched_param;

pub const posix_spawnattr_t = extern struct {
    __flags: c_short,
    __pgrp: pid_t,
    __sd: sigset_t,
    __ss: sigset_t,
    __sp: struct_sched_param,
    __policy: c_int,
    __pad: [16]c_int,
};
pub const struct_sched_param = extern struct {
    sched_priority: c_int,
};
pub const struct___spawn_action = opaque {};
pub const posix_spawn_file_actions_t = extern struct {
    __allocated: c_int,
    __used: c_int,
    __actions: ?*struct___spawn_action,
    __pad: [16]c_int,
};

pub extern "c" fn posix_spawn(
    pid: *pid_t,
    path: [*:0]const u8,
    actions: ?*const posix_spawn_file_actions_t,
    attr: ?*const posix_spawnattr_t,
    argv: [*:null]?[*:0]const u8,
    env: [*:null]?[*:0]const u8,
) c_int;
pub extern "c" fn posix_spawnp(
    pid: *pid_t,
    path: [*:0]const u8,
    actions: ?*const posix_spawn_file_actions_t,
    attr: ?*const posix_spawnattr_t,
    argv: [*:null]?[*:0]const u8,
    env: [*:null]?[*:0]const u8,
) c_int;
pub extern fn posix_spawnattr_init(__attr: *posix_spawnattr_t) c_int;
pub extern fn posix_spawnattr_destroy(__attr: *posix_spawnattr_t) c_int;
pub extern fn posix_spawnattr_getsigdefault(noalias __attr: [*c]const posix_spawnattr_t, noalias __sigdefault: [*c]sigset_t) c_int;
pub extern fn posix_spawnattr_setsigdefault(noalias __attr: [*c]posix_spawnattr_t, noalias __sigdefault: [*c]const sigset_t) c_int;
pub extern fn posix_spawnattr_getsigmask(noalias __attr: [*c]const posix_spawnattr_t, noalias __sigmask: [*c]sigset_t) c_int;
pub extern fn posix_spawnattr_setsigmask(noalias __attr: [*c]posix_spawnattr_t, noalias __sigmask: [*c]const sigset_t) c_int;
pub extern fn posix_spawnattr_getflags(noalias __attr: [*c]const posix_spawnattr_t, noalias __flags: [*c]c_short) c_int;
pub extern fn posix_spawnattr_setflags(_attr: [*c]posix_spawnattr_t, __flags: c_short) c_int;
pub extern fn posix_spawnattr_getpgroup(noalias __attr: [*c]const posix_spawnattr_t, noalias __pgroup: [*c]pid_t) c_int;
pub extern fn posix_spawnattr_setpgroup(__attr: [*c]posix_spawnattr_t, __pgroup: pid_t) c_int;
pub extern fn posix_spawnattr_getschedpolicy(noalias __attr: [*c]const posix_spawnattr_t, noalias __schedpolicy: [*c]c_int) c_int;
pub extern fn posix_spawnattr_setschedpolicy(__attr: [*c]posix_spawnattr_t, __schedpolicy: c_int) c_int;
pub extern fn posix_spawnattr_getschedparam(noalias __attr: [*c]const posix_spawnattr_t, noalias __schedparam: [*c]struct_sched_param) c_int;
pub extern fn posix_spawnattr_setschedparam(noalias __attr: [*c]posix_spawnattr_t, noalias __schedparam: [*c]const struct_sched_param) c_int;
pub extern fn posix_spawn_file_actions_init(__file_actions: *posix_spawn_file_actions_t) c_int;
pub extern fn posix_spawn_file_actions_destroy(__file_actions: *posix_spawn_file_actions_t) c_int;
pub extern fn posix_spawn_file_actions_addopen(noalias __file_actions: *posix_spawn_file_actions_t, __fd: c_int, noalias __path: [*:0]const u8, __oflag: c_int, __mode: mode_t) c_int;
pub extern fn posix_spawn_file_actions_addclose(__file_actions: *posix_spawn_file_actions_t, __fd: c_int) c_int;
pub extern fn posix_spawn_file_actions_adddup2(__file_actions: *posix_spawn_file_actions_t, __fd: c_int, __newfd: c_int) c_int;
pub const POSIX_SPAWN_RESETIDS = @as(c_int, 0x01);
pub const POSIX_SPAWN_SETPGROUP = @as(c_int, 0x02);
pub const POSIX_SPAWN_SETSIGDEF = @as(c_int, 0x04);
pub const POSIX_SPAWN_SETSIGMASK = @as(c_int, 0x08);
pub const POSIX_SPAWN_SETSCHEDPARAM = @as(c_int, 0x10);
pub const POSIX_SPAWN_SETSCHEDULER = @as(c_int, 0x20);
pub const POSIX_SPAWN_SETSID = @as(c_int, 0x80);

const posix_spawn_file_actions_addfchdir_np_type = *const fn (actions: *posix_spawn_file_actions_t, filedes: fd_t) c_int;
const posix_spawn_file_actions_addchdir_np_type = *const fn (actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int;

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addfchdir_np(actions: *posix_spawn_file_actions_t, filedes: std.posix.fd_t) c_int {
    const function = bun.C.dlsym(posix_spawn_file_actions_addfchdir_np_type, "posix_spawn_file_actions_addfchdir_np") orelse
        return 0;
    return function(actions, filedes);
}

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addchdir_np(actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int {
    const function = bun.C.dlsym(posix_spawn_file_actions_addchdir_np_type, "posix_spawn_file_actions_addchdir_np") orelse
        return 0;
    return function(actions, path);
}

pub extern fn vmsplice(fd: c_int, iovec: [*]const std.posix.iovec, iovec_count: usize, flags: u32) isize;

const net_c = @cImport({
    // TODO: remove this c import! instead of adding to it, add to
    // c-headers-for-zig.h and use bun.C.translated.
    @cInclude("ifaddrs.h"); // getifaddrs, freeifaddrs
    @cInclude("net/if.h"); // IFF_RUNNING, IFF_UP
    @cInclude("fcntl.h"); // F_DUPFD_CLOEXEC
    @cInclude("sys/socket.h");
});

pub const FD_CLOEXEC = net_c.FD_CLOEXEC;
pub const freeifaddrs = net_c.freeifaddrs;
pub const getifaddrs = net_c.getifaddrs;
pub const ifaddrs = net_c.ifaddrs;
pub const IFF_LOOPBACK = net_c.IFF_LOOPBACK;
pub const IFF_RUNNING = net_c.IFF_RUNNING;
pub const IFF_UP = net_c.IFF_UP;
pub const MSG_DONTWAIT = net_c.MSG_DONTWAIT;
pub const MSG_NOSIGNAL = net_c.MSG_NOSIGNAL;

pub const F = struct {
    pub const DUPFD_CLOEXEC = net_c.F_DUPFD_CLOEXEC;
    pub const DUPFD = net_c.F_DUPFD;
};

pub const Mode = u32;
pub const E = std.posix.E;
pub const S = std.posix.S;

pub extern "c" fn umask(Mode) Mode;

pub fn getErrno(rc: anytype) E {
    const Type = @TypeOf(rc);

    return switch (Type) {
        // raw system calls from std.os.linux.* will return usize
        // the errno is stored in this value
        usize => {
            const signed: isize = @bitCast(rc);
            const int = if (signed > -4096 and signed < 0) -signed else 0;
            return @enumFromInt(int);
        },

        // glibc system call wrapper returns i32/int
        // the errno is stored in a thread local variable
        //
        // TODO: the inclusion of  'u32' and 'isize' seems suspicous
        i32, c_int, u32, isize, i64 => if (rc == -1)
            @enumFromInt(std.c._errno().*)
        else
            .SUCCESS,

        else => @compileError("Not implemented yet for type " ++ @typeName(Type)),
    };
}

pub const getuid = std.os.linux.getuid;
pub const getgid = std.os.linux.getgid;
pub const linux_fs = if (bun.Environment.isLinux) @cImport({
    // TODO: remove this c import! instead of adding to it, add to
    // c-headers-for-zig.h and use bun.C.translated.
    @cInclude("linux/fs.h");
}) else struct {};

/// https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
///
/// Support for FICLONE is dependent on the filesystem driver.
pub fn ioctl_ficlone(dest_fd: bun.FileDescriptor, srcfd: bun.FileDescriptor) usize {
    return std.os.linux.ioctl(dest_fd.cast(), linux_fs.FICLONE, @intCast(srcfd.int()));
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

pub extern "C" fn sys_preadv2(
    fd: c_int,
    iov: [*]const std.posix.iovec,
    iovcnt: c_int,
    offset: std.posix.off_t,
    flags: c_uint,
) isize;

pub extern "C" fn sys_pwritev2(
    fd: c_int,
    iov: [*]const std.posix.iovec_const,
    iovcnt: c_int,
    offset: std.posix.off_t,
    flags: c_uint,
) isize;

// #define RENAME_NOREPLACE    (1 << 0)    /* Don't overwrite target */
// #define RENAME_EXCHANGE     (1 << 1)    /* Exchange source and dest */
// #define RENAME_WHITEOUT     (1 << 2)    /* Whiteout source */

pub const RENAME_NOREPLACE = 1 << 0;
pub const RENAME_EXCHANGE = 1 << 1;
pub const RENAME_WHITEOUT = 1 << 2;

pub extern "C" fn quick_exit(code: c_int) noreturn;
pub extern "C" fn memrchr(ptr: [*]const u8, val: c_int, len: usize) ?[*]const u8;

export fn sys_epoll_pwait2(epfd: i32, events: ?[*]std.os.linux.epoll_event, maxevents: i32, timeout: ?*const std.os.linux.timespec, sigmask: ?*const std.os.linux.sigset_t) isize {
    return @bitCast(
        std.os.linux.syscall6(
            .epoll_pwait2,
            @bitCast(@as(isize, @intCast(epfd))),
            @intFromPtr(events),
            @bitCast(@as(isize, @intCast(maxevents))),
            @intFromPtr(timeout),
            @intFromPtr(sigmask),
            8,
        ),
    );
}

// *********************************************************************************
// libc overrides
// *********************************************************************************

fn simulateLibcErrno(rc: usize) c_int {
    const signed: isize = @bitCast(rc);
    const int: c_int = @intCast(if (signed > -4096 and signed < 0) -signed else 0);
    std.c._errno().* = int;
    return if (signed > -4096 and signed < 0) -1 else int;
}

pub export fn stat(path: [*:0]const u8, buf: *std.os.linux.Stat) c_int {
    // https://git.musl-libc.org/cgit/musl/tree/src/stat/stat.c
    const rc = std.os.linux.fstatat(std.os.linux.AT.FDCWD, path, buf, 0);
    return simulateLibcErrno(rc);
}

pub const stat64 = stat;
pub const lstat64 = lstat;
pub const fstat64 = fstat;
pub const fstatat64 = fstatat;

pub export fn lstat(path: [*:0]const u8, buf: *std.os.linux.Stat) c_int {
    // https://git.musl-libc.org/cgit/musl/tree/src/stat/lstat.c
    const rc = std.os.linux.fstatat(std.os.linux.AT.FDCWD, path, buf, std.os.linux.AT.SYMLINK_NOFOLLOW);
    return simulateLibcErrno(rc);
}

pub export fn fstat(fd: c_int, buf: *std.os.linux.Stat) c_int {
    const rc = std.os.linux.fstat(fd, buf);
    return simulateLibcErrno(rc);
}

pub export fn fstatat(dirfd: i32, path: [*:0]const u8, buf: *std.os.linux.Stat, flags: u32) c_int {
    const rc = std.os.linux.fstatat(dirfd, path, buf, flags);
    return simulateLibcErrno(rc);
}

pub export fn statx(dirfd: i32, path: [*:0]const u8, flags: u32, mask: u32, buf: *std.os.linux.Statx) c_int {
    const rc = std.os.linux.statx(dirfd, path, flags, mask, buf);
    return simulateLibcErrno(rc);
}

comptime {
    _ = stat;
    _ = stat64;
    _ = lstat;
    _ = lstat64;
    _ = fstat;
    _ = fstat64;
    _ = fstatat;
    _ = statx;
    @export(stat, .{ .name = "stat64" });
    @export(lstat, .{ .name = "lstat64" });
    @export(fstat, .{ .name = "fstat64" });
    @export(fstatat, .{ .name = "fstatat64" });
}

// *********************************************************************************
