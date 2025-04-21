const std = @import("std");
const bun = @import("bun");

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

pub fn getFreeMemory() u64 {}

pub fn getTotalMemory() u64 {}

pub fn getSystemUptime() u64 {}

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

pub const FD_CLOEXEC = bun.c.FD_CLOEXEC;
pub const freeifaddrs = bun.c.freeifaddrs;
pub const getifaddrs = bun.c.getifaddrs;
pub const ifaddrs = bun.c.ifaddrs;
pub const IFF_LOOPBACK = bun.c.IFF_LOOPBACK;
pub const IFF_RUNNING = bun.c.IFF_RUNNING;
pub const IFF_UP = bun.c.IFF_UP;
pub const MSG_DONTWAIT = bun.c.MSG_DONTWAIT;
pub const MSG_NOSIGNAL = bun.c.MSG_NOSIGNAL;

pub const F = struct {
    pub const DUPFD_CLOEXEC = bun.c.F_DUPFD_CLOEXEC;
    pub const DUPFD = bun.c.F_DUPFD;
};

pub extern "c" fn umask(bun.Mode) bun.Mode;

pub const getuid = std.os.linux.getuid;
pub const getgid = std.os.linux.getgid;
pub const linux_fs = bun.c;

/// https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
///
/// Support for FICLONE is dependent on the filesystem driver.
pub fn ioctl_ficlone(dest_fd: bun.FileDescriptor, srcfd: bun.FileDescriptor) usize {
    return std.os.linux.ioctl(dest_fd.cast(), bun.c.FICLONE, @intCast(srcfd.native()));
}

pub extern "c" fn sys_preadv2(
    fd: c_int,
    iov: [*]const std.posix.iovec,
    iovcnt: c_int,
    offset: std.posix.off_t,
    flags: c_uint,
) isize;

pub extern "c" fn sys_pwritev2(
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

pub extern "c" fn quick_exit(code: c_int) noreturn;
pub extern "c" fn memrchr(ptr: [*]const u8, val: c_int, len: usize) ?[*]const u8;

export fn sys_epoll_pwait2(epfd: i32, events: ?[*]std.os.linux.epoll_event, maxevents: i32, timeout: ?*const std.os.linux.timespec, sigmask: ?*const std.os.linux.sigset_t) isize {
    return @bitCast(
        std.os.linux.syscall6(
            .epoll_pwait2,
            @bitCast(@as(isize, @intCast(epfd))),
            @intFromPtr(events),
            @bitCast(@as(isize, @intCast(maxevents))),
            @intFromPtr(timeout),
            @intFromPtr(sigmask),
            // This is the correct value. glibc claims to pass `sizeof sigset_t` for this argument,
            // which would be 128, but they actually pass 8 which is what the kernel expects.
            // https://github.com/ziglang/zig/issues/12715
            8,
        ),
    );
}
