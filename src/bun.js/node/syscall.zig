// This file is entirely based on Zig's std.os
// The differences are in error handling
const std = @import("std");
const os = std.os;
const builtin = @import("builtin");

const Syscall = @This();
const Environment = @import("../../global.zig").Environment;
const default_allocator = @import("../../global.zig").default_allocator;
const JSC = @import("../../jsc.zig");
const SystemError = JSC.SystemError;
const bun = @import("../../global.zig");
const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
const fd_t = bun.FileDescriptorType;
const C = @import("../../global.zig").C;
const linux = os.linux;
const Maybe = JSC.Maybe;

// On Linux AARCh64, zig is missing stat & lstat syscalls
const use_libc = (Environment.isLinux and Environment.isAarch64) or Environment.isMac;
pub const system = if (Environment.isLinux) linux else @import("io").darwin;
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
    pub var strings = std.EnumMap(Tag, JSC.C.JSStringRef).initFull(null);
};
const PathString = @import("../../global.zig").PathString;

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

pub fn fchmod(fd: JSC.Node.FileDescriptor, mode: JSC.Node.Mode) Maybe(void) {
    return Maybe(void).errnoSys(C.fchmod(fd, mode), .fchmod) orelse
        Maybe(void).success;
}

pub fn chdir(destination: [:0]const u8) Maybe(void) {
    const rc = sys.chdir(destination);
    return Maybe(void).errnoSys(rc, .chdir) orelse Maybe(void).success;
}

pub fn stat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errnoSys(statSym(path, &stat_), .stat)) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn lstat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errnoSys(lstat64(path, &stat_), .lstat)) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn fstat(fd: JSC.Node.FileDescriptor) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errnoSys(fstatSym(fd, &stat_), .fstat)) |err| return err;
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

pub fn fcntl(fd: JSC.Node.FileDescriptor, cmd: i32, arg: usize) Maybe(usize) {
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

pub fn open(file_path: [:0]const u8, flags: JSC.Node.Mode, perm: JSC.Node.Mode) Maybe(JSC.Node.FileDescriptor) {
    while (true) {
        const rc = Syscall.system.open(file_path, flags, perm);
        return switch (Syscall.getErrno(rc)) {
            .SUCCESS => .{ .result = @intCast(JSC.Node.FileDescriptor, rc) },
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

// The zig standard library marks BADF as unreachable
// That error is not unreachable for us
pub fn close(fd: std.os.fd_t) ?Syscall.Error {
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
    const adjusted_len = @minimum(max_count, bytes.len);

    while (true) {
        const rc = sys.write(fd, bytes.ptr, adjusted_len);
        if (Maybe(usize).errnoSys(rc, .write)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    }
    unreachable;
}

const pread_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    sys.pread64
else if (builtin.os.tag.isDarwin())
    system.@"pread$NOCANCEL"
else
    system.pread;

const fcntl_symbol = system.fcntl;

pub fn pread(fd: os.fd_t, buf: []u8, offset: i64) Maybe(usize) {
    const adjusted_len = @minimum(buf.len, max_count);
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
    const adjusted_len = @minimum(bytes.len, max_count);

    const ioffset = @bitCast(i64, offset); // the OS treats this as unsigned
    while (true) {
        const rc = pwrite_sym(fd, bytes.ptr, adjusted_len, ioffset);
        return if (Maybe(usize).errnoSys(rc, .pwrite)) |err| {
            switch (err.getErrno()) {
                .INTR => continue,
                else => return err,
            }
        } else Maybe(usize){ .result = @intCast(usize, rc) };
    }

    unreachable;
}

pub fn read(fd: os.fd_t, buf: []u8) Maybe(usize) {
    const adjusted_len = @minimum(buf.len, max_count);
    if (comptime Environment.isMac) {
        const rc = system.@"read$NOCANCEL"(fd, buf.ptr, adjusted_len);
        if (Maybe(usize).errnoSys(rc, .read)) |err| {
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = sys.read(fd, buf.ptr, adjusted_len);
            if (Maybe(usize).errnoSys(rc, .read)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }
            return Maybe(usize){ .result = @intCast(usize, rc) };
        }
    }
    unreachable;
}

pub fn recv(fd: os.fd_t, buf: []u8, flag: u32) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = system.@"recvfrom$NOCANCEL"(fd, buf.ptr, buf.len, flag, null, null);
        if (Maybe(usize).errnoSys(rc, .recv)) |err| {
            return err;
        }
        return Maybe(usize){ .result = @intCast(usize, rc) };
    } else {
        while (true) {
            const rc = linux.recvfrom(fd, buf.ptr, buf.len, flag | os.SOCK.CLOEXEC | linux.MSG.CMSG_CLOEXEC, null, null);
            if (Maybe(usize).errnoSys(rc, .recv)) |err| {
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
            @memset(out_buffer, 0, MAX_PATH_BYTES);
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

    if (wanted_size) |size_| size = @minimum(size, size_);

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
            err = @maximum(err, @enumToInt(errn));
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
