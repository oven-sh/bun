const std = @import("std");
const sysResource = @cImport(@cInclude("sys/resource.h"));
const bun = @import("bun");
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

    const LabelMap = std.EnumMap(SystemErrno, []const u8);
    pub const labels: LabelMap = brk: {
        var map: LabelMap = LabelMap.initFull("");

        map.put(.EPERM, "Operation not permitted");
        map.put(.ENOENT, "No such file or directory");
        map.put(.ESRCH, "No such process");
        map.put(.EINTR, "Interrupted system call");
        map.put(.EIO, "I/O error");
        map.put(.ENXIO, "No such device or address");
        map.put(.E2BIG, "Argument list too long");
        map.put(.ENOEXEC, "Exec format error");
        map.put(.EBADF, "Bad file number");
        map.put(.ECHILD, "No child processes");
        map.put(.EAGAIN, "Try again");
        map.put(.ENOMEM, "Out of memory");
        map.put(.EACCES, "Permission denied");
        map.put(.EFAULT, "Bad address");
        map.put(.ENOTBLK, "Block device required");
        map.put(.EBUSY, "Device or resource busy");
        map.put(.EEXIST, "File or folder exists");
        map.put(.EXDEV, "Cross-device link");
        map.put(.ENODEV, "No such device");
        map.put(.ENOTDIR, "Not a directory");
        map.put(.EISDIR, "Is a directory");
        map.put(.EINVAL, "Invalid argument");
        map.put(.ENFILE, "File table overflow");
        map.put(.EMFILE, "Too many open files");
        map.put(.ENOTTY, "Not a typewriter");
        map.put(.ETXTBSY, "Text file busy");
        map.put(.EFBIG, "File too large");
        map.put(.ENOSPC, "No space left on device");
        map.put(.ESPIPE, "Illegal seek");
        map.put(.EROFS, "Read-only file system");
        map.put(.EMLINK, "Too many links");
        map.put(.EPIPE, "Broken pipe");
        map.put(.EDOM, "Math argument out of domain of func");
        map.put(.ERANGE, "Math result not representable");
        map.put(.EDEADLK, "Resource deadlock would occur");
        map.put(.ENAMETOOLONG, "File name too long");
        map.put(.ENOLCK, "No record locks available");
        map.put(.ENOSYS, "Function not implemented");
        map.put(.ENOTEMPTY, "Directory not empty");
        map.put(.ELOOP, "Too many symbolic links encountered");
        map.put(.ENOMSG, "No message of desired type");
        map.put(.EIDRM, "Identifier removed");
        map.put(.ECHRNG, "Channel number out of range");
        map.put(.EL2NSYNC, "Level 2 not synchronized");
        map.put(.EL3HLT, "Level 3 halted");
        map.put(.EL3RST, "Level 3 reset");
        map.put(.ELNRNG, "Link number out of range");
        map.put(.EUNATCH, "Protocol driver not attached");
        map.put(.ENOCSI, "No CSI structure available");
        map.put(.EL2HLT, "Level 2 halted");
        map.put(.EBADE, "Invalid exchange");
        map.put(.EBADR, "Invalid request descriptor");
        map.put(.EXFULL, "Exchange full");
        map.put(.ENOANO, "No anode");
        map.put(.EBADRQC, "Invalid request code");
        map.put(.EBADSLT, "Invalid slot");
        map.put(.EBFONT, "Bad font file format");
        map.put(.ENOSTR, "Device not a stream");
        map.put(.ENODATA, "No data available");
        map.put(.ETIME, "Timer expired");
        map.put(.ENOSR, "Out of streams resources");
        map.put(.ENONET, "Machine is not on the network");
        map.put(.ENOPKG, "Package not installed");
        map.put(.EREMOTE, "Object is remote");
        map.put(.ENOLINK, "Link has been severed");
        map.put(.EADV, "Advertise error");
        map.put(.ESRMNT, "Srmount error");
        map.put(.ECOMM, "Communication error on send");
        map.put(.EPROTO, "Protocol error");
        map.put(.EMULTIHOP, "Multihop attempted");
        map.put(.EDOTDOT, "RFS specific error");
        map.put(.EBADMSG, "Not a data message");
        map.put(.EOVERFLOW, "Value too large for defined data type");
        map.put(.ENOTUNIQ, "Name not unique on network");
        map.put(.EBADFD, "File descriptor in bad state");
        map.put(.EREMCHG, "Remote address changed");
        map.put(.ELIBACC, "Can not access a needed shared library");
        map.put(.ELIBBAD, "Accessing a corrupted shared library");
        map.put(.ELIBSCN, "lib section in a.out corrupted");
        map.put(.ELIBMAX, "Attempting to link in too many shared libraries");
        map.put(.ELIBEXEC, "Cannot exec a shared library directly");
        map.put(.EILSEQ, "Illegal byte sequence");
        map.put(.ERESTART, "Interrupted system call should be restarted");
        map.put(.ESTRPIPE, "Streams pipe error");
        map.put(.EUSERS, "Too many users");
        map.put(.ENOTSOCK, "Socket operation on non-socket");
        map.put(.EDESTADDRREQ, "Destination address required");
        map.put(.EMSGSIZE, "Message too long");
        map.put(.EPROTOTYPE, "Protocol wrong type for socket");
        map.put(.ENOPROTOOPT, "Protocol not available");
        map.put(.EPROTONOSUPPORT, "Protocol not supported");
        map.put(.ESOCKTNOSUPPORT, "Socket type not supported");
        map.put(.ENOTSUP, "Operation not supported on transport endpoint");
        map.put(.EPFNOSUPPORT, "Protocol family not supported");
        map.put(.EAFNOSUPPORT, "Address family not supported by protocol");
        map.put(.EADDRINUSE, "Address already in use");
        map.put(.EADDRNOTAVAIL, "Cannot assign requested address");
        map.put(.ENETDOWN, "Network is down");
        map.put(.ENETUNREACH, "Network is unreachable");
        map.put(.ENETRESET, "Network dropped connection because of reset");
        map.put(.ECONNABORTED, "Software caused connection abort");
        map.put(.ECONNRESET, "Connection reset by peer");
        map.put(.ENOBUFS, "No buffer space available");
        map.put(.EISCONN, "Transport endpoint is already connected");
        map.put(.ENOTCONN, "Transport endpoint is not connected");
        map.put(.ESHUTDOWN, "Cannot send after transport endpoint shutdown");
        map.put(.ETOOMANYREFS, "Too many references: cannot splice");
        map.put(.ETIMEDOUT, "Connection timed out");
        map.put(.ECONNREFUSED, "Connection refused");
        map.put(.EHOSTDOWN, "Host is down");
        map.put(.EHOSTUNREACH, "No route to host");
        map.put(.EALREADY, "Operation already in progress");
        map.put(.EINPROGRESS, "Operation now in progress");
        map.put(.ESTALE, "Stale NFS file handle");
        map.put(.EUCLEAN, "Structure needs cleaning");
        map.put(.ENOTNAM, "Not a XENIX named type file");
        map.put(.ENAVAIL, "No XENIX semaphores available");
        map.put(.EISNAM, "Is a named type file");
        map.put(.EREMOTEIO, "Remote I/O error");
        map.put(.EDQUOT, "Quota exceeded");
        map.put(.ENOMEDIUM, "No medium found");
        map.put(.EMEDIUMTYPE, "Wrong medium type");
        map.put(.ECANCELED, "Operation Canceled");
        map.put(.ENOKEY, "Required key not available");
        map.put(.EKEYEXPIRED, "Key has expired");
        map.put(.EKEYREVOKED, "Key has been revoked");
        map.put(.EKEYREJECTED, "Key was rejected by service");
        map.put(.EOWNERDEAD, "Owner died");
        map.put(.ENOTRECOVERABLE, "State not recoverable");
        break :brk map;
    };
};

pub fn preallocate_file(fd: std.os.fd_t, offset: std.os.off_t, len: std.os.off_t) anyerror!void {
    _ = std.os.linux.fallocate(fd, 0, @intCast(i64, offset), len);
}

/// splice() moves data between two file descriptors without copying
/// between kernel address space and user address space.  It
/// transfers up to len bytes of data from the file descriptor fd_in
/// to the file descriptor fd_out, where one of the file descriptors
/// must refer to a pipe.
pub fn splice(fd_in: std.os.fd_t, off_in: ?*i64, fd_out: std.os.fd_t, off_out: ?*i64, len: usize, flags: u32) usize {
    return std.os.linux.syscall6(
        .splice,
        @bitCast(usize, @as(isize, fd_in)),
        @ptrToInt(off_in),
        @bitCast(usize, @as(isize, fd_out)),
        @ptrToInt(off_out),
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
        return @ptrCast(ReturnType, @alignCast(@alignOf(u8), @ptrCast(Intermediate, self) + 108));
    }
};
pub extern fn sysinfo(__info: [*c]struct_sysinfo) c_int;

pub fn get_free_memory() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @bitCast(u64, info.freeram) *% @bitCast(c_ulong, @as(c_ulong, info.mem_unit));
    return 0;
}

pub fn get_total_memory() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @bitCast(u64, info.totalram) *% @bitCast(c_ulong, @as(c_ulong, info.mem_unit));
    return 0;
}

pub fn get_system_uptime() u64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) return @bitCast(u64, info.uptime);
    return 0;
}

pub fn get_system_loadavg() [3]f64 {
    var info: struct_sysinfo = undefined;
    if (sysinfo(&info) == @as(c_int, 0)) {
        return [3]f64{
            std.math.ceil((@intToFloat(f64, info.loads[0]) / 65536.0) * 100.0) / 100.0,
            std.math.ceil((@intToFloat(f64, info.loads[1]) / 65536.0) * 100.0) / 100.0,
            std.math.ceil((@intToFloat(f64, info.loads[2]) / 65536.0) * 100.0) / 100.0,
        };
    }
    return [3]f64{ 0, 0, 0 };
}

pub fn get_process_priority(pid: c_uint) i32 {
    return sysResource.getpriority(sysResource.PRIO_PROCESS, pid);
}

pub fn set_process_priority(pid: c_uint, priority: c_int) i32 {
    return sysResource.setpriority(sysResource.PRIO_PROCESS, pid, priority);
}

pub fn get_version(name_buffer: *[std.os.HOST_NAME_MAX]u8) []const u8 {
    const uts = std.os.uname();
    const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.version, 0), 0);
    std.mem.copy(u8, name_buffer, result);

    return name_buffer[0..result.len];
}

pub fn get_release(name_buffer: *[std.os.HOST_NAME_MAX]u8) []const u8 {
    const uts = std.os.uname();
    const result = std.mem.sliceTo(std.meta.assumeSentinel(&uts.release, 0), 0);
    std.mem.copy(u8, name_buffer, result);

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

const fd_t = std.os.fd_t;
const pid_t = std.os.pid_t;
const mode_t = std.os.mode_t;
const sigset_t = std.c.sigset_t;
const sched_param = std.os.sched_param;

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

const posix_spawn_file_actions_addfchdir_np_type = fn (actions: *posix_spawn_file_actions_t, filedes: fd_t) c_int;
const posix_spawn_file_actions_addchdir_np_type = fn (actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int;

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addfchdir_np(actions: *posix_spawn_file_actions_t, filedes: std.os.fd_t) c_int {
    var function = bun.C.dlsym(posix_spawn_file_actions_addfchdir_np_type, "posix_spawn_file_actions_addfchdir_np") orelse
        return 0;
    return function(actions, filedes);
}

/// When not available, these functions will return 0.
pub fn posix_spawn_file_actions_addchdir_np(actions: *posix_spawn_file_actions_t, path: [*:0]const u8) c_int {
    var function = bun.C.dlsym(posix_spawn_file_actions_addchdir_np_type, "posix_spawn_file_actions_addchdir_np") orelse
        return 0;
    return function(actions, path);
}

pub extern fn vmsplice(fd: c_int, iovec: [*]const std.os.iovec, iovec_count: usize, flags: u32) isize;
