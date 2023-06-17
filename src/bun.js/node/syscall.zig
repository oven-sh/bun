// This file is entirely based on Zig's std.os
// The differences are in error handling
const std = @import("std");
const os = std.os;
const builtin = @import("builtin");

const Syscall = @This();
const Environment = @import("root").bun.Environment;
const default_allocator = @import("root").bun.default_allocator;
const JSC = @import("root").bun.JSC;
const SystemError = JSC.SystemError;
const bun = @import("root").bun;
const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
const fd_t = bun.FileDescriptor;
const C = @import("root").bun.C;
const linux = os.linux;
const Maybe = JSC.Maybe;

const log = bun.Output.scoped(.SYS, false);
pub const syslog = log;

// On Linux AARCh64, zig is missing stat & lstat syscalls
const use_libc = (Environment.isLinux and Environment.isAarch64) or Environment.isMac;
pub const system = if (Environment.isLinux) linux else @import("root").bun.AsyncIO.darwin;
pub const S = struct {
    pub usingnamespace if (Environment.isLinux) linux.S else std.os.S;
};
const sys = std.os.system;

const statSym = if (use_libc)
    C.stat
else if (Environment.isLinux)
    linux.stat
else
    @compileError("STAT");

const fstatSym = if (use_libc)
    C.fstat
else if (Environment.isLinux)
    linux.fstat
else
    @compileError("STAT");

const lstat64 = if (use_libc)
    C.lstat
else if (Environment.isLinux)
    linux.lstat
else
    @compileError("STAT");

pub const Tag = enum(u8) {
    TODO,

    access,
    chmod,
    chown,
    clonefile,
    close,
    copy_file_range,
    copyfile,
    fchmod,
    fchown,
    fcntl,
    fdatasync,
    fstat,
    fsync,
    ftruncate,
    futimens,
    getdents64,
    getdirentries64,
    lchmod,
    lchown,
    link,
    lseek,
    lstat,
    lutimes,
    mkdir,
    mkdtemp,
    fnctl,
    mmap,
    munmap,
    open,
    pread,
    pwrite,
    read,
    readlink,
    rename,
    stat,
    symlink,
    unlink,
    utimes,
    write,
    getcwd,
    chdir,
    fcopyfile,
    recv,
    send,
    sendfile,
    splice,
    rmdir,

    kevent,
    kqueue,
    epoll_ctl,
    kill,
    waitpid,
    posix_spawn,
    getaddrinfo,
    pub var strings = std.EnumMap(Tag, JSC.C.JSStringRef).initFull(null);
};
const PathString = @import("root").bun.PathString;

const mode_t = os.mode_t;

const open_sym = system.open;

const mem = std.mem;

pub fn getcwd(buf: *[bun.MAX_PATH_BYTES]u8) Maybe([]const u8) {
    const Result = Maybe([]const u8);
    buf[0] = 0;
    const rc = std.c.getcwd(buf, bun.MAX_PATH_BYTES);
    return if (rc != null)
        Result{ .result = std.mem.sliceTo(rc.?[0..bun.MAX_PATH_BYTES], 0) }
    else
        Result.errnoSys(0, .getcwd).?;
}

pub fn fchmod(fd: bun.FileDescriptor, mode: JSC.Node.Mode) Maybe(void) {
    return Maybe(void).errnoSys(C.fchmod(fd, mode), .fchmod) orelse
        Maybe(void).success;
}

pub fn chdir(destination: [:0]const u8) Maybe(void) {
    const rc = sys.chdir(destination);
    return Maybe(void).errnoSys(rc, .chdir) orelse Maybe(void).success;
}

pub fn stat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    const rc = statSym(path, &stat_);

    if (comptime Environment.allow_assert)
        log("stat({s}) = {d}", .{ bun.asByteSlice(path), rc });

    if (Maybe(os.Stat).errnoSys(rc, .stat)) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn lstat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errnoSys(lstat64(path, &stat_), .lstat)) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn fstat(fd: bun.FileDescriptor) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);

    const rc = fstatSym(fd, &stat_);

    if (comptime Environment.allow_assert)
        log("fstat({d}) = {d}", .{ fd, rc });

    if (Maybe(os.Stat).errnoSys(rc, .fstat)) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn mkdir(file_path: [:0]const u8, flags: JSC.Node.Mode) Maybe(void) {
    if (comptime Environment.isMac) {
        return Maybe(void).errnoSysP(system.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success;
    }

    if (comptime Environment.isLinux) {
        return Maybe(void).errnoSysP(linux.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success;
    }
}

pub fn fcntl(fd: bun.FileDescriptor, cmd: i32, arg: usize) Maybe(usize) {
    const result = fcntl_symbol(fd, cmd, arg);
    if (Maybe(usize).errnoSys(result, .fcntl)) |err| return err;
    return .{ .result = @intCast(usize, result) };
}

pub fn getErrno(rc: anytype) std.os.E {
    if (comptime Environment.isMac) return std.os.errno(rc);
    const Type = @TypeOf(rc);

    return switch (Type) {
        comptime_int, usize => std.os.linux.getErrno(@as(usize, rc)),
        i32, c_int, isize => std.os.linux.getErrno(@bitCast(usize, @as(isize, rc))),
        else => @compileError("Not implemented yet for type " ++ @typeName(Type)),
    };
}

pub fn openat(dirfd: bun.FileDescriptor, file_path: [:0]const u8, flags: JSC.Node.Mode, perm: JSC.Node.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isMac) {
        // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
        const rc = bun.AsyncIO.darwin.@"openat$NOCANCEL"(dirfd, file_path.ptr, @intCast(c_uint, flags), @intCast(c_int, perm));
        log("openat({d}, {s}) = {d}", .{ dirfd, file_path, rc });

        return switch (Syscall.getErrno(rc)) {
            .SUCCESS => .{ .result = @intCast(bun.FileDescriptor, rc) },
            else => |err| .{
                .err = .{
                    .errno = @truncate(Syscall.Error.Int, @enumToInt(err)),
                    .syscall = .open,
                },
            },
        };
    }

    while (true) {
        const rc = Syscall.system.openat(@intCast(Syscall.system.fd_t, dirfd), file_path, flags, perm);
        log("openat({d}, {s}) = {d}", .{ dirfd, file_path, rc });
        return switch (Syscall.getErrno(rc)) {
            .SUCCESS => .{ .result = @intCast(bun.FileDescriptor, rc) },
            .INTR => continue,
            else => |err| {
                return Maybe(std.os.fd_t){
                    .err = .{
                        .errno = @truncate(Syscall.Error.Int, @enumToInt(err)),
                        .syscall = .open,
                    },
                };
            },
        };
    }

    unreachable;
}

pub fn open(file_path: [:0]const u8, flags: JSC.Node.Mode, perm: JSC.Node.Mode) Maybe(bun.FileDescriptor) {
    // this is what open() does anyway.
    return openat(@intCast(bun.FileDescriptor, std.fs.cwd().fd), file_path, flags, perm);
}

/// This function will prevent stdout and stderr from being closed.
pub fn close(fd: std.os.fd_t) ?Syscall.Error {
    if (fd == std.os.STDOUT_FILENO or fd == std.os.STDERR_FILENO) {
        log("close({d}) SKIPPED", .{fd});
        return null;
    }

    return closeAllowingStdoutAndStderr(fd);
}

pub fn closeAllowingStdoutAndStderr(fd: std.os.fd_t) ?Syscall.Error {
    log("close({d})", .{fd});
    std.debug.assert(fd != bun.invalid_fd);
    if (comptime std.meta.trait.isSignedInt(@TypeOf(fd)))
        std.debug.assert(fd > -1);

    if (comptime Environment.isMac) {
        // This avoids the EINTR problem.
        return switch (system.getErrno(system.@"close$NOCANCEL"(fd))) {
            .BADF => Syscall.Error{ .errno = @enumToInt(os.E.BADF), .syscall = .close },
            else => null,
        };
    }

    if (comptime Environment.isLinux) {
        return switch (linux.getErrno(linux.close(fd))) {
            .BADF => Syscall.Error{ .errno = @enumToInt(os.E.BADF), .syscall = .close },
            else => null,
        };
    }

    @compileError("Not implemented yet");
}

const max_count = switch (builtin.os.tag) {
    .linux => 0x7ffff000,
    .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
    else => std.math.maxInt(isize),
};

pub fn write(fd: os.fd_t, bytes: []const u8) Maybe(usize) {
    const adjusted_len = @min(max_count, bytes.len);

    if (comptime Environment.isMac) {
        const rc = system.@"write$NOCANCEL"(fd, bytes.ptr, adjusted_len);
        log("write({d}, {d}) = {d}", .{ fd, adjusted_len, rc });

        if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = sys.write(fd, bytes.ptr, adjusted_len);
            log("write({d}, {d}) = {d}", .{ fd, adjusted_len, rc });

            if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @intCast(usize, rc) };
        }
        unreachable;
    }
}

const pread_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    sys.pread64
else if (builtin.os.tag.isDarwin())
    system.@"pread$NOCANCEL"
else
    system.pread;

const fcntl_symbol = system.fcntl;

pub fn pread(fd: os.fd_t, buf: []u8, offset: i64) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);
    const ioffset = @bitCast(i64, offset); // the OS treats this as unsigned
    while (true) {
        const rc = pread_sym(fd, buf.ptr, adjusted_len, ioffset);
        if (Maybe(usize).errnoSys(rc, .pread)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    }
    unreachable;
}

const pwrite_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    sys.pwrite64
else
    sys.pwrite;

pub fn pwrite(fd: os.fd_t, bytes: []const u8, offset: i64) Maybe(usize) {
    const adjusted_len = @min(bytes.len, max_count);

    const ioffset = @bitCast(i64, offset); // the OS treats this as unsigned
    while (true) {
        const rc = pwrite_sym(fd, bytes.ptr, adjusted_len, ioffset);
        return if (Maybe(usize).errnoSysFd(rc, .pwrite, fd)) |err| {
            switch (err.getErrno()) {
                .INTR => continue,
                else => return err,
            }
        } else Maybe(usize){ .result = @intCast(usize, rc) };
    }

    unreachable;
}

pub fn read(fd: os.fd_t, buf: []u8) Maybe(usize) {
    const debug_timer = bun.Output.DebugTimer.start();
    const adjusted_len = @min(buf.len, max_count);
    if (comptime Environment.isMac) {
        const rc = system.@"read$NOCANCEL"(fd, buf.ptr, adjusted_len);

        log("read({d}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

        if (Maybe(usize).errnoSys(rc, .read)) |err| {
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = sys.read(fd, buf.ptr, adjusted_len);
            log("read({d}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

            if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }
            return Maybe(usize){ .result = @intCast(usize, rc) };
        }
    }
    unreachable;
}

pub fn recv(fd: os.fd_t, buf: []u8, flag: u32) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);

    if (comptime Environment.isMac) {
        const rc = system.@"recvfrom$NOCANCEL"(fd, buf.ptr, adjusted_len, flag, null, null);
        log("recv({d}, {d}, {d}) = {d}", .{ fd, adjusted_len, flag, rc });

        if (Maybe(usize).errnoSys(rc, .recv)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = linux.recvfrom(fd, buf.ptr, adjusted_len, flag | os.SOCK.CLOEXEC | linux.MSG.CMSG_CLOEXEC, null, null);
            log("recv({d}, {d}, {d}) = {d}", .{ fd, adjusted_len, flag, rc });

            if (Maybe(usize).errnoSysFd(rc, .recv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }
            return Maybe(usize){ .result = @intCast(usize, rc) };
        }
    }
    unreachable;
}

pub fn send(fd: os.fd_t, buf: []const u8, flag: u32) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = system.@"sendto$NOCANCEL"(fd, buf.ptr, buf.len, flag, null, 0);
        if (Maybe(usize).errnoSys(rc, .send)) |err| {
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = linux.sendto(fd, buf.ptr, buf.len, flag | os.SOCK.CLOEXEC | os.MSG.NOSIGNAL, null, 0);

            if (Maybe(usize).errnoSys(rc, .send)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @intCast(usize, rc) };
        }
    }
    unreachable;
}

pub fn readlink(in: [:0]const u8, buf: []u8) Maybe(usize) {
    while (true) {
        const rc = sys.readlink(in, buf.ptr, buf.len);

        if (Maybe(usize).errnoSys(rc, .readlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    }
    unreachable;
}

pub fn ftruncate(fd: fd_t, size: isize) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(sys.ftruncate(fd, size), .ftruncate)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn rename(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(sys.rename(from, to), .rename)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn chown(path: [:0]const u8, uid: os.uid_t, gid: os.gid_t) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(C.chown(path, uid, gid), .chown)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn symlink(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(sys.symlink(from, to), .symlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn clonefile(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    if (comptime !Environment.isMac) @compileError("macOS only");

    while (true) {
        if (Maybe(void).errnoSys(C.darwin.clonefile(from, to, 0), .clonefile)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn copyfile(from: [:0]const u8, to: [:0]const u8, flags: c_int) Maybe(void) {
    if (comptime !Environment.isMac) @compileError("macOS only");

    while (true) {
        if (Maybe(void).errnoSys(C.darwin.copyfile(from, to, null, flags), .copyfile)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn fcopyfile(fd_in: std.os.fd_t, fd_out: std.os.fd_t, flags: u32) Maybe(void) {
    if (comptime !Environment.isMac) @compileError("macOS only");

    while (true) {
        if (Maybe(void).errnoSys(system.fcopyfile(fd_in, fd_out, null, flags), .fcopyfile)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn unlink(from: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(sys.unlink(from), .unlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn getFdPath(fd: fd_t, out_buffer: *[MAX_PATH_BYTES]u8) Maybe([]u8) {
    switch (comptime builtin.os.tag) {
        .windows => {
            const windows = std.os.windows;
            var wide_buf: [windows.PATH_MAX_WIDE]u16 = undefined;
            const wide_slice = windows.GetFinalPathNameByHandle(fd, .{}, wide_buf[0..]) catch {
                return Maybe([]u8){ .err = .{ .errno = .EBADF } };
            };

            // Trust that Windows gives us valid UTF-16LE.
            const end_index = std.unicode.utf16leToUtf8(out_buffer, wide_slice) catch unreachable;
            return .{ .result = out_buffer[0..end_index] };
        },
        .macos, .ios, .watchos, .tvos => {
            // On macOS, we can use F.GETPATH fcntl command to query the OS for
            // the path to the file descriptor.
            bun.oldMemset(out_buffer, 0, MAX_PATH_BYTES);
            if (Maybe([]u8).errnoSys(system.fcntl(fd, os.F.GETPATH, out_buffer), .fcntl)) |err| {
                return err;
            }
            const len = mem.indexOfScalar(u8, out_buffer[0..], @as(u8, 0)) orelse MAX_PATH_BYTES;
            return .{ .result = out_buffer[0..len] };
        },
        .linux => {
            // TODO: alpine linux may not have /proc/self
            var procfs_buf: ["/proc/self/fd/-2147483648".len:0]u8 = undefined;
            const proc_path = std.fmt.bufPrintZ(procfs_buf[0..], "/proc/self/fd/{d}\x00", .{fd}) catch unreachable;

            return switch (readlink(proc_path, out_buffer)) {
                .err => |err| return .{ .err = err },
                .result => |len| return .{ .result = out_buffer[0..len] },
            };
        },
        // .solaris => {
        //     var procfs_buf: ["/proc/self/path/-2147483648".len:0]u8 = undefined;
        //     const proc_path = std.fmt.bufPrintZ(procfs_buf[0..], "/proc/self/path/{d}", .{fd}) catch unreachable;

        //     const target = readlinkZ(proc_path, out_buffer) catch |err| switch (err) {
        //         error.UnsupportedReparsePointType => unreachable,
        //         error.NotLink => unreachable,
        //         else => |e| return e,
        //     };
        //     return target;
        // },
        else => @compileError("querying for canonical path of a handle is unsupported on this host"),
    }
}

/// Use of a mapped region can result in these signals:
/// * SIGSEGV - Attempted write into a region mapped as read-only.
/// * SIGBUS - Attempted  access to a portion of the buffer that does not correspond to the file
fn mmap(
    ptr: ?[*]align(mem.page_size) u8,
    length: usize,
    prot: u32,
    flags: u32,
    fd: os.fd_t,
    offset: u64,
) Maybe([]align(mem.page_size) u8) {
    const ioffset = @bitCast(i64, offset); // the OS treats this as unsigned
    const rc = std.c.mmap(ptr, length, prot, flags, fd, ioffset);
    const fail = std.c.MAP.FAILED;
    if (rc == fail) {
        return Maybe([]align(mem.page_size) u8){
            .err = .{ .errno = @truncate(Syscall.Error.Int, @enumToInt(std.c.getErrno(@bitCast(i64, @ptrToInt(fail))))), .syscall = .mmap },
        };
    }

    return Maybe([]align(mem.page_size) u8){ .result = @ptrCast([*]align(mem.page_size) u8, @alignCast(mem.page_size, rc))[0..length] };
}

pub fn mmapFile(path: [:0]const u8, flags: u32, wanted_size: ?usize, offset: usize) Maybe([]align(mem.page_size) u8) {
    const fd = switch (open(path, os.O.RDWR, 0)) {
        .result => |fd| fd,
        .err => |err| return .{ .err = err },
    };

    var size = std.math.sub(usize, @intCast(usize, switch (fstat(fd)) {
        .result => |result| result.size,
        .err => |err| {
            _ = close(fd);
            return .{ .err = err };
        },
    }), offset) catch 0;

    if (wanted_size) |size_| size = @min(size, size_);

    const map = switch (mmap(null, size, os.PROT.READ | os.PROT.WRITE, flags, fd, offset)) {
        .result => |map| map,

        .err => |err| {
            _ = close(fd);
            return .{ .err = err };
        },
    };

    if (close(fd)) |err| {
        _ = munmap(map);
        return .{ .err = err };
    }

    return .{ .result = map };
}

pub fn munmap(memory: []align(mem.page_size) const u8) Maybe(void) {
    if (Maybe(void).errnoSys(system.munmap(memory.ptr, memory.len), .munmap)) |err| {
        return err;
    } else return Maybe(void).success;
}

pub const Error = struct {
    const max_errno_value = brk: {
        const errno_values = std.enums.values(os.E);
        var err = @enumToInt(os.E.SUCCESS);
        for (errno_values) |errn| {
            err = @max(err, @enumToInt(errn));
        }
        break :brk err;
    };
    pub const Int: type = std.math.IntFittingRange(0, max_errno_value + 5);

    errno: Int,
    syscall: Syscall.Tag = @intToEnum(Syscall.Tag, 0),
    path: []const u8 = "",
    fd: i32 = -1,

    pub inline fn isRetry(this: *const Error) bool {
        return this.getErrno() == .AGAIN;
    }

    pub fn fromCode(errno: os.E, syscall: Syscall.Tag) Error {
        return .{ .errno = @truncate(Int, @enumToInt(errno)), .syscall = syscall };
    }

    pub fn format(self: Error, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        try self.toSystemError().format(fmt, opts, writer);
    }

    pub const oom = fromCode(os.E.NOMEM, .read);

    pub const retry = Error{
        .errno = if (Environment.isLinux)
            @intCast(Int, @enumToInt(os.E.AGAIN))
        else if (Environment.isMac)
            @intCast(Int, @enumToInt(os.E.WOULDBLOCK))
        else
            @intCast(Int, @enumToInt(os.E.INTR)),
        .syscall = .retry,
    };

    pub inline fn getErrno(this: Error) os.E {
        return @intToEnum(os.E, this.errno);
    }

    pub inline fn withPath(this: Error, path: anytype) Error {
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .path = bun.span(path),
        };
    }

    pub inline fn withFd(this: Error, fd: anytype) Error {
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .fd = @intCast(i32, fd),
        };
    }

    pub inline fn withPathLike(this: Error, pathlike: anytype) Error {
        return switch (pathlike) {
            .fd => |fd| this.withFd(fd),
            .path => |path| this.withPath(path.slice()),
        };
    }

    pub inline fn withSyscall(this: Error, syscall: Syscall) Error {
        return Error{
            .errno = this.errno,
            .syscall = syscall,
            .path = this.path,
        };
    }

    pub const todo_errno = std.math.maxInt(Int) - 1;
    pub const todo = Error{ .errno = todo_errno };

    pub fn toSystemError(this: Error) SystemError {
        var err = SystemError{
            .errno = @as(c_int, this.errno) * -1,
            .syscall = JSC.ZigString.init(@tagName(this.syscall)),
        };

        // errno label
        if (this.errno > 0 and this.errno < C.SystemErrno.max) {
            const system_errno = @intToEnum(C.SystemErrno, this.errno);
            err.code = JSC.ZigString.init(@tagName(system_errno));
            if (C.SystemErrno.labels.get(system_errno)) |label| {
                err.message = JSC.ZigString.init(label);
            }
        }

        if (this.path.len > 0) {
            err.path = JSC.ZigString.init(this.path);
        }

        if (this.fd != -1) {
            err.fd = this.fd;
        }

        return err;
    }

    pub fn toJS(this: Error, ctx: JSC.C.JSContextRef) JSC.C.JSObjectRef {
        return this.toSystemError().toErrorInstance(ctx.ptr()).asObjectRef();
    }

    pub fn toJSC(this: Error, ptr: *JSC.JSGlobalObject) JSC.JSValue {
        return this.toSystemError().toErrorInstance(ptr);
    }
};

pub fn setPipeCapacityOnLinux(fd: bun.FileDescriptor, capacity: usize) Maybe(usize) {
    if (comptime !Environment.isLinux) @compileError("Linux-only");
    std.debug.assert(capacity > 0);

    // In  Linux  versions  before 2.6.11, the capacity of a
    // pipe was the same as the system page size (e.g., 4096
    // bytes on i386).  Since Linux 2.6.11, the pipe
    // capacity is 16 pages (i.e., 65,536 bytes in a system
    // with a page size of 4096 bytes).  Since Linux 2.6.35,
    // the default pipe capacity is 16 pages, but the
    // capacity can be queried  and  set  using  the
    // fcntl(2) F_GETPIPE_SZ and F_SETPIPE_SZ operations.
    // See fcntl(2) for more information.
    //:# define F_SETPIPE_SZ    1031    /* Set pipe page size array.
    const F_SETPIPE_SZ = 1031;
    const F_GETPIPE_SZ = 1032;

    // We don't use glibc here
    // It didn't work. Always returned 0.
    const pipe_len = std.os.linux.fcntl(fd, F_GETPIPE_SZ, 0);
    if (Maybe(usize).errno(pipe_len)) |err| return err;
    if (pipe_len == 0) return Maybe(usize){ .result = 0 };
    if (pipe_len >= capacity) return Maybe(usize){ .result = pipe_len };

    const new_pipe_len = std.os.linux.fcntl(fd, F_SETPIPE_SZ, capacity);
    if (Maybe(usize).errno(new_pipe_len)) |err| return err;
    return Maybe(usize){ .result = new_pipe_len };
}

pub fn getMaxPipeSizeOnLinux() usize {
    return @intCast(
        usize,
        bun.once(struct {
            fn once() c_int {
                const strings = bun.strings;
                const default_out_size = 512 * 1024;
                const pipe_max_size_fd = switch (JSC.Node.Syscall.open("/proc/sys/fs/pipe-max-size", std.os.O.RDONLY, 0)) {
                    .result => |fd2| fd2,
                    .err => |err| {
                        log("Failed to open /proc/sys/fs/pipe-max-size: {d}\n", .{err.errno});
                        return default_out_size;
                    },
                };
                defer _ = JSC.Node.Syscall.close(pipe_max_size_fd);
                var max_pipe_size_buf: [128]u8 = undefined;
                const max_pipe_size = switch (JSC.Node.Syscall.read(pipe_max_size_fd, max_pipe_size_buf[0..])) {
                    .result => |bytes_read| std.fmt.parseInt(i64, strings.trim(max_pipe_size_buf[0..bytes_read], "\n"), 10) catch |err| {
                        log("Failed to parse /proc/sys/fs/pipe-max-size: {any}\n", .{@errorName(err)});
                        return default_out_size;
                    },
                    .err => |err| {
                        log("Failed to read /proc/sys/fs/pipe-max-size: {d}\n", .{err.errno});
                        return default_out_size;
                    },
                };

                // we set the absolute max to 8 MB because honestly that's a huge pipe
                // my current linux machine only goes up to 1 MB, so that's very unlikely to be hit
                return @min(@truncate(c_int, max_pipe_size -| 32), 1024 * 1024 * 8);
            }
        }.once, c_int),
    );
}
