// This file is entirely based on Zig's std.posix
// The differences are in error handling
const std = @import("std");
const builtin = @import("builtin");

const bun = @import("root").bun;
const posix = std.posix;

const assertIsValidWindowsPath = bun.strings.assertIsValidWindowsPath;
const default_allocator = bun.default_allocator;
const kernel32 = bun.windows;
const mem = std.mem;
const mode_t = posix.mode_t;
const libc = std.posix.system;

const windows = bun.windows;

const C = bun.C;
const Environment = bun.Environment;
const JSC = bun.JSC;
const MAX_PATH_BYTES = bun.MAX_PATH_BYTES;
const PathString = bun.PathString;
const Syscall = @This();
const SystemError = JSC.SystemError;

const linux = syscall;

pub const sys_uv = if (Environment.isWindows) @import("./sys_uv.zig") else Syscall;

const log = bun.Output.scoped(.SYS, false);
pub const syslog = log;

pub const syscall = switch (Environment.os) {
    .linux => std.os.linux,

    // This is actually libc on MacOS
    // We don't directly use the Darwin syscall interface.
    .mac => bun.AsyncIO.system,

    else => @compileError("not implemented"),
};

fn toPackedO(number: anytype) std.posix.O {
    return @bitCast(number);
}

pub const O = switch (Environment.os) {
    .mac => struct {
        pub const PATH = 0x0000;
        pub const RDONLY = 0x0000;
        pub const WRONLY = 0x0001;
        pub const RDWR = 0x0002;
        pub const NONBLOCK = 0x0004;
        pub const APPEND = 0x0008;
        pub const CREAT = 0x0200;
        pub const TRUNC = 0x0400;
        pub const EXCL = 0x0800;
        pub const SHLOCK = 0x0010;
        pub const EXLOCK = 0x0020;
        pub const NOFOLLOW = 0x0100;
        pub const SYMLINK = 0x200000;
        pub const EVTONLY = 0x8000;
        pub const CLOEXEC = 0x1000000;
        pub const ACCMODE = 3;
        pub const ALERT = 536870912;
        pub const ASYNC = 64;
        pub const DIRECTORY = 1048576;
        pub const DP_GETRAWENCRYPTED = 1;
        pub const DP_GETRAWUNENCRYPTED = 2;
        pub const DSYNC = 4194304;
        pub const FSYNC = SYNC;
        pub const NOCTTY = 131072;
        pub const POPUP = 2147483648;
        pub const SYNC = 128;

        pub const toPacked = toPackedO;
    },
    .linux, .wasm => switch (Environment.isX86) {
        true => struct {
            pub const RDONLY = 0x0000;
            pub const WRONLY = 0x0001;
            pub const RDWR = 0x0002;

            pub const CREAT = 0o100;
            pub const EXCL = 0o200;
            pub const NOCTTY = 0o400;
            pub const TRUNC = 0o1000;
            pub const APPEND = 0o2000;
            pub const NONBLOCK = 0o4000;
            pub const DSYNC = 0o10000;
            pub const SYNC = 0o4010000;
            pub const RSYNC = 0o4010000;
            pub const DIRECTORY = 0o200000;
            pub const NOFOLLOW = 0o400000;
            pub const CLOEXEC = 0o2000000;

            pub const ASYNC = 0o20000;
            pub const DIRECT = 0o40000;
            pub const LARGEFILE = 0;
            pub const NOATIME = 0o1000000;
            pub const PATH = 0o10000000;
            pub const TMPFILE = 0o20200000;
            pub const NDELAY = NONBLOCK;

            pub const toPacked = toPackedO;
        },
        false => struct {
            pub const RDONLY = 0x0000;
            pub const WRONLY = 0x0001;
            pub const RDWR = 0x0002;

            pub const CREAT = 0o100;
            pub const EXCL = 0o200;
            pub const NOCTTY = 0o400;
            pub const TRUNC = 0o1000;
            pub const APPEND = 0o2000;
            pub const NONBLOCK = 0o4000;
            pub const DSYNC = 0o10000;
            pub const SYNC = 0o4010000;
            pub const RSYNC = 0o4010000;
            pub const DIRECTORY = 0o40000;
            pub const NOFOLLOW = 0o100000;
            pub const CLOEXEC = 0o2000000;

            pub const ASYNC = 0o20000;
            pub const DIRECT = 0o200000;
            pub const LARGEFILE = 0o400000;
            pub const NOATIME = 0o1000000;
            pub const PATH = 0o10000000;
            pub const TMPFILE = 0o20040000;
            pub const NDELAY = NONBLOCK;

            pub const toPacked = toPackedO;
        },
    },
    .windows => struct {
        pub const RDONLY = 0o0;
        pub const WRONLY = 0o1;
        pub const RDWR = 0o2;

        pub const CREAT = 0o100;
        pub const EXCL = 0o200;
        pub const NOCTTY = 0o400;
        pub const TRUNC = 0o1000;
        pub const APPEND = 0o2000;
        pub const NONBLOCK = 0o4000;
        pub const DSYNC = 0o10000;
        pub const SYNC = 0o4010000;
        pub const RSYNC = 0o4010000;
        pub const DIRECTORY = 0o200000;
        pub const NOFOLLOW = 0o400000;
        pub const CLOEXEC = 0o2000000;

        pub const ASYNC = 0o20000;
        pub const DIRECT = 0o40000;
        pub const LARGEFILE = 0;
        pub const NOATIME = 0o1000000;
        pub const PATH = 0o10000000;
        pub const TMPFILE = 0o20200000;
        pub const NDELAY = NONBLOCK;

        pub const toPacked = toPackedO;
    },
};

pub const S = if (Environment.isLinux) linux.S else if (Environment.isPosix) std.posix.S else struct {};

pub const Tag = enum(u8) {
    TODO,

    dup,
    access,
    connect,
    chmod,
    chown,
    clonefile,
    close,
    copy_file_range,
    copyfile,
    fchmod,
    fchmodat,
    fchown,
    fcntl,
    fdatasync,
    fstat,
    fstatat,
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
    memfd_create,
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
    symlinkat,
    unlink,
    utimes,
    write,
    getcwd,
    getenv,
    chdir,
    fcopyfile,
    recv,
    send,
    sendfile,
    sendmmsg,
    splice,
    rmdir,
    truncate,
    realpath,
    futime,
    pidfd_open,
    poll,
    watch,

    kevent,
    kqueue,
    epoll_ctl,
    kill,
    waitpid,
    posix_spawn,
    getaddrinfo,
    writev,
    pwritev,
    readv,
    preadv,
    ioctl_ficlone,
    accept,
    bind2,
    connect2,
    listen,
    pipe,
    try_write,
    socketpair,
    setsockopt,

    uv_spawn,
    uv_pipe,
    uv_tty_set_mode,
    uv_open_osfhandle,
    uv_os_homedir,

    // Below this line are Windows API calls only.

    WriteFile,
    NtQueryDirectoryFile,
    NtSetInformationFile,
    GetFinalPathNameByHandle,
    CloseHandle,
    SetFilePointerEx,
    SetEndOfFile,

    pub fn isWindows(this: Tag) bool {
        return @intFromEnum(this) > @intFromEnum(Tag.WriteFile);
    }

    pub var strings = std.EnumMap(Tag, JSC.C.JSStringRef).initFull(null);
};

pub const Error = struct {
    const E = bun.C.E;

    const retry_errno = if (Environment.isLinux)
        @as(Int, @intCast(@intFromEnum(E.AGAIN)))
    else if (Environment.isMac)
        @as(Int, @intCast(@intFromEnum(E.AGAIN)))
    else
        @as(Int, @intCast(@intFromEnum(E.INTR)));

    const todo_errno = std.math.maxInt(Int) - 1;

    pub const Int = if (Environment.isWindows) u16 else u8; // @TypeOf(@intFromEnum(E.BADF));

    /// TODO: convert to function
    pub const oom = fromCode(E.NOMEM, .read);

    errno: Int = todo_errno,
    fd: bun.FileDescriptor = bun.invalid_fd,
    from_libuv: if (Environment.isWindows) bool else void = if (Environment.isWindows) false else undefined,
    path: []const u8 = "",
    syscall: Syscall.Tag = Syscall.Tag.TODO,
    dest: []const u8 = "",

    pub fn clone(this: *const Error, allocator: std.mem.Allocator) !Error {
        var copy = this.*;
        copy.path = try allocator.dupe(u8, copy.path);
        copy.dest = try allocator.dupe(u8, copy.dest);
        return copy;
    }

    pub fn fromCode(errno: E, syscall_tag: Syscall.Tag) Error {
        return .{
            .errno = @as(Int, @intCast(@intFromEnum(errno))),
            .syscall = syscall_tag,
        };
    }

    pub fn fromCodeInt(errno: anytype, syscall_tag: Syscall.Tag) Error {
        return .{
            .errno = @as(Int, @intCast(if (Environment.isWindows) @abs(errno) else errno)),
            .syscall = syscall_tag,
        };
    }

    pub fn format(self: Error, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        try self.toSystemError().format(fmt, opts, writer);
    }

    pub inline fn getErrno(this: Error) E {
        return @as(E, @enumFromInt(this.errno));
    }

    pub inline fn isRetry(this: *const Error) bool {
        return this.getErrno() == .AGAIN;
    }

    pub const retry = Error{
        .errno = retry_errno,
        .syscall = .read,
    };

    pub inline fn withFd(this: Error, fd: anytype) Error {
        if (Environment.allow_assert) bun.assert(fd != bun.invalid_fd);
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .fd = fd,
        };
    }

    pub inline fn withPath(this: Error, path: anytype) Error {
        if (std.meta.Child(@TypeOf(path)) == u16) {
            @compileError("Do not pass WString path to withPath, it needs the path encoded as utf8");
        }
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .path = bun.span(path),
        };
    }

    pub inline fn withPathLike(this: Error, pathlike: anytype) Error {
        return switch (pathlike) {
            .fd => |fd| this.withFd(fd),
            .path => |path| this.withPath(path.slice()),
        };
    }

    pub fn name(this: *const Error) []const u8 {
        if (comptime Environment.isWindows) {
            const system_errno = brk: {
                // setRuntimeSafety(false) because we use tagName function, which will be null on invalid enum value.
                @setRuntimeSafety(false);
                if (this.from_libuv) {
                    break :brk @as(C.SystemErrno, @enumFromInt(@intFromEnum(bun.windows.libuv.translateUVErrorToE(this.errno))));
                }

                break :brk @as(C.SystemErrno, @enumFromInt(this.errno));
            };
            if (bun.tagName(bun.C.SystemErrno, system_errno)) |errname| {
                return errname;
            }
        } else if (this.errno > 0 and this.errno < C.SystemErrno.max) {
            const system_errno = @as(C.SystemErrno, @enumFromInt(this.errno));
            if (bun.tagName(bun.C.SystemErrno, system_errno)) |errname| {
                return errname;
            }
        }

        return "UNKNOWN";
    }

    pub fn toZigErr(this: Error) anyerror {
        return bun.errnoToZigErr(this.errno);
    }

    pub fn toSystemError(this: Error) SystemError {
        var err = SystemError{
            .errno = @as(c_int, this.errno) * -1,
            .syscall = bun.String.static(@tagName(this.syscall)),
        };

        // errno label
        if (!Environment.isWindows) {
            if (this.errno > 0 and this.errno < C.SystemErrno.max) {
                const system_errno = @as(C.SystemErrno, @enumFromInt(this.errno));
                err.code = bun.String.static(@tagName(system_errno));
                if (C.SystemErrno.labels.get(system_errno)) |label| {
                    err.message = bun.String.static(label);
                }
            }
        } else {
            const system_errno = brk: {
                // setRuntimeSafety(false) because we use tagName function, which will be null on invalid enum value.
                @setRuntimeSafety(false);
                if (this.from_libuv) {
                    break :brk @as(C.SystemErrno, @enumFromInt(@intFromEnum(bun.windows.libuv.translateUVErrorToE(err.errno))));
                }

                break :brk @as(C.SystemErrno, @enumFromInt(this.errno));
            };
            if (bun.tagName(bun.C.SystemErrno, system_errno)) |errname| {
                err.code = bun.String.static(errname);
                if (C.SystemErrno.labels.get(system_errno)) |label| {
                    err.message = bun.String.static(label);
                }
            }
        }

        if (this.path.len > 0) {
            err.path = bun.String.createUTF8(this.path);
        }

        if (this.dest.len > 0) {
            err.dest = bun.String.createUTF8(this.dest);
        }

        if (this.fd != bun.invalid_fd) {
            err.fd = this.fd;
        }

        return err;
    }

    pub inline fn todo() Error {
        if (Environment.isDebug) {
            @panic("bun.sys.Error.todo() was called");
        }
        return Error{ .errno = todo_errno, .syscall = .TODO };
    }

    pub fn toJS(this: Error, ctx: JSC.C.JSContextRef) JSC.C.JSObjectRef {
        return this.toSystemError().toErrorInstance(ctx).asObjectRef();
    }

    pub fn toJSC(this: Error, ptr: *JSC.JSGlobalObject) JSC.JSValue {
        return this.toSystemError().toErrorInstance(ptr);
    }
};

pub fn Maybe(comptime ReturnTypeT: type) type {
    return JSC.Node.Maybe(ReturnTypeT, Error);
}

pub fn getcwd(buf: *bun.PathBuffer) Maybe([]const u8) {
    const Result = Maybe([]const u8);
    return switch (getcwdZ(buf)) {
        .err => |err| Result{ .err = err },
        .result => |cwd| Result{ .result = cwd },
    };
}

pub fn getcwdZ(buf: *bun.PathBuffer) Maybe([:0]const u8) {
    const Result = Maybe([:0]const u8);
    buf[0] = 0;

    if (comptime Environment.isWindows) {
        var wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        const len: windows.DWORD = kernel32.GetCurrentDirectoryW(wbuf.len, wbuf);
        if (Result.errnoSysP(len, .getcwd, buf)) |err| return err;
        return Result{ .result = bun.strings.fromWPath(buf, wbuf[0..len]) };
    }

    const rc: ?[*:0]u8 = @ptrCast(std.c.getcwd(buf, bun.MAX_PATH_BYTES));
    return if (rc != null)
        Result{ .result = rc.?[0..std.mem.len(rc.?) :0] }
    else
        Result.errnoSysP(@as(c_int, 0), .getcwd, buf).?;
}

pub fn fchmod(fd: bun.FileDescriptor, mode: bun.Mode) Maybe(void) {
    if (comptime Environment.isWindows) {
        return sys_uv.fchmod(fd, mode);
    }

    return Maybe(void).errnoSysFd(C.fchmod(fd.cast(), mode), .fchmod, fd) orelse
        Maybe(void).success;
}

pub fn fchmodat(fd: bun.FileDescriptor, path: [:0]const u8, mode: bun.Mode, flags: i32) Maybe(void) {
    if (comptime Environment.isWindows) @compileError("Use fchmod instead");

    return Maybe(void).errnoSysFd(C.fchmodat(fd.cast(), path.ptr, mode, flags), .fchmodat, fd) orelse
        Maybe(void).success;
}

pub fn chmod(path: [:0]const u8, mode: bun.Mode) Maybe(void) {
    if (comptime Environment.isWindows) {
        return sys_uv.chmod(path, mode);
    }

    return Maybe(void).errnoSysP(C.chmod(path.ptr, mode), .chmod, path) orelse
        Maybe(void).success;
}

pub fn chdirOSPath(path: bun.stringZ, destination: if (Environment.isPosix) bun.stringZ else bun.string) Maybe(void) {
    if (comptime Environment.isPosix) {
        const rc = syscall.chdir(destination);
        return Maybe(void).errnoSysPD(rc, .chdir, path, destination) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        const wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        if (kernel32.SetCurrentDirectory(bun.strings.toWDirPath(wbuf, destination)) == windows.FALSE) {
            log("SetCurrentDirectory({s}) = {d}", .{ destination, kernel32.GetLastError() });
            return Maybe(void).errnoSysPD(0, .chdir, path, destination) orelse Maybe(void).success;
        }

        log("SetCurrentDirectory({s}) = {d}", .{ destination, 0 });

        return Maybe(void).success;
    }

    @compileError("Not implemented yet");
}

pub fn chdir(path: anytype, destination: anytype) Maybe(void) {
    const Type = @TypeOf(destination);

    if (comptime Environment.isPosix) {
        if (comptime Type == []u8 or Type == []const u8) {
            return chdirOSPath(
                &(std.posix.toPosixPath(path) catch return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.EINVAL),
                    .syscall = .chdir,
                } }),
                &(std.posix.toPosixPath(destination) catch return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.EINVAL),
                    .syscall = .chdir,
                } }),
            );
        }

        return chdirOSPath(path, destination);
    }

    if (comptime Environment.isWindows) {
        if (comptime Type == *[*:0]u16) {
            if (kernel32.SetCurrentDirectory(destination) != 0) {
                return Maybe(void).errnoSysPD(0, .chdir, path, destination) orelse Maybe(void).success;
            }

            return Maybe(void).success;
        }

        if (comptime Type == bun.OSPathSliceZ or Type == [:0]u16) {
            return chdirOSPath(path, @as(bun.OSPathSliceZ, destination));
        }

        return chdirOSPath(path, destination);
    }

    return Maybe(void).todo();
}

pub fn sendfile(src: bun.FileDescriptor, dest: bun.FileDescriptor, len: usize) Maybe(usize) {
    while (true) {
        const rc = std.os.linux.sendfile(
            dest.cast(),
            src.cast(),
            null,
            // we set a maximum to avoid EINVAL
            @min(len, std.math.maxInt(i32) - 1),
        );
        if (Maybe(usize).errnoSysFd(rc, .sendfile, src)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }

        return .{ .result = rc };
    }
}

pub fn stat(path: [:0]const u8) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        return sys_uv.stat(path);
    } else {
        var stat_ = mem.zeroes(bun.Stat);
        const rc = C.stat(path, &stat_);

        if (comptime Environment.allow_assert)
            log("stat({s}) = {d}", .{ bun.asByteSlice(path), rc });

        if (Maybe(bun.Stat).errnoSysP(rc, .stat, path)) |err| return err;
        return Maybe(bun.Stat){ .result = stat_ };
    }
}

pub fn lstat(path: [:0]const u8) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        return sys_uv.lstat(path);
    } else {
        var stat_ = mem.zeroes(bun.Stat);
        if (Maybe(bun.Stat).errnoSysP(C.lstat(path, &stat_), .lstat, path)) |err| return err;
        return Maybe(bun.Stat){ .result = stat_ };
    }
}

pub fn fstat(fd: bun.FileDescriptor) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        const dec = bun.FDImpl.decode(fd);
        if (dec.kind == .system) {
            const uvfd = bun.toLibUVOwnedFD(fd) catch return .{ .err = Error.fromCode(.MFILE, .uv_open_osfhandle) };
            return sys_uv.fstat(uvfd);
        } else return sys_uv.fstat(fd);
    }

    var stat_ = mem.zeroes(bun.Stat);

    const rc = C.fstat(fd.cast(), &stat_);

    if (comptime Environment.allow_assert)
        log("fstat({}) = {d}", .{ fd, rc });

    if (Maybe(bun.Stat).errnoSysFd(rc, .fstat, fd)) |err| return err;
    return Maybe(bun.Stat){ .result = stat_ };
}

pub fn mkdiratA(dir_fd: bun.FileDescriptor, file_path: []const u8) Maybe(void) {
    const buf = bun.WPathBufferPool.get();
    defer bun.WPathBufferPool.put(buf);
    return mkdiratW(dir_fd, bun.strings.toWPathNormalized(buf, file_path));
}

pub fn mkdiratZ(dir_fd: bun.FileDescriptor, file_path: [*:0]const u8, mode: mode_t) Maybe(void) {
    return switch (Environment.os) {
        .mac => Maybe(void).errnoSysP(syscall.mkdirat(@intCast(dir_fd.cast()), file_path, mode), .mkdir, file_path) orelse Maybe(void).success,
        .linux => Maybe(void).errnoSysP(linux.mkdirat(@intCast(dir_fd.cast()), file_path, mode), .mkdir, file_path) orelse Maybe(void).success,
        else => @compileError("mkdir is not implemented on this platform"),
    };
}

fn mkdiratPosix(dir_fd: bun.FileDescriptor, file_path: []const u8, mode: mode_t) Maybe(void) {
    return mkdiratZ(
        dir_fd,
        &(std.posix.toPosixPath(file_path) catch return .{ .err = Error.fromCode(.NAMETOOLONG, .mkdir) }),
        mode,
    );
}

pub const mkdirat = if (Environment.isWindows)
    mkdiratW
else
    mkdiratPosix;

pub fn mkdiratW(dir_fd: bun.FileDescriptor, file_path: []const u16, _: i32) Maybe(void) {
    const dir_to_make = openDirAtWindowsNtPath(dir_fd, file_path, .{ .iterable = false, .can_rename_or_delete = true, .create = true });
    if (dir_to_make == .err) {
        return .{ .err = dir_to_make.err };
    }

    _ = close(dir_to_make.result);
    return .{ .result = {} };
}

pub fn fstatat(fd: bun.FileDescriptor, path: [:0]const u8) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        return switch (openatWindowsA(fd, path, 0)) {
            .result => |file| {
                // :(
                defer _ = close(file);
                return fstat(file);
            },
            .err => |err| Maybe(bun.Stat){ .err = err },
        };
    }
    var stat_ = mem.zeroes(bun.Stat);
    if (Maybe(bun.Stat).errnoSysFP(syscall.fstatat(fd.int(), path, &stat_, 0), .fstatat, fd, path)) |err| {
        log("fstatat({}, {s}) = {s}", .{ fd, path, @tagName(err.getErrno()) });
        return err;
    }
    log("fstatat({}, {s}) = 0", .{ fd, path });
    return Maybe(bun.Stat){ .result = stat_ };
}

pub fn mkdir(file_path: [:0]const u8, flags: bun.Mode) Maybe(void) {
    return switch (Environment.os) {
        .mac => Maybe(void).errnoSysP(syscall.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success,

        .linux => Maybe(void).errnoSysP(syscall.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success,

        .windows => {
            const wbuf = bun.WPathBufferPool.get();
            defer bun.WPathBufferPool.put(wbuf);
            return Maybe(void).errnoSysP(
                kernel32.CreateDirectoryW(bun.strings.toWPath(wbuf, file_path).ptr, null),
                .mkdir,
                file_path,
            ) orelse Maybe(void).success;
        },

        else => @compileError("mkdir is not implemented on this platform"),
    };
}

pub fn mkdirA(file_path: []const u8, flags: bun.Mode) Maybe(void) {
    if (comptime Environment.isMac) {
        return Maybe(void).errnoSysP(syscall.mkdir(&(std.posix.toPosixPath(file_path) catch return Maybe(void){
            .err = .{
                .errno = @intFromEnum(bun.C.E.NOMEM),
                .syscall = .open,
            },
        }), flags), .mkdir, file_path) orelse Maybe(void).success;
    }

    if (comptime Environment.isLinux) {
        return Maybe(void).errnoSysP(linux.mkdir(&(std.posix.toPosixPath(file_path) catch return Maybe(void){
            .err = .{
                .errno = @intFromEnum(bun.C.E.NOMEM),
                .syscall = .open,
            },
        }), flags), .mkdir, file_path) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        const wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        const wpath = bun.strings.toWPath(wbuf, file_path);
        assertIsValidWindowsPath(u16, wpath);
        return Maybe(void).errnoSysP(
            kernel32.CreateDirectoryW(wpath.ptr, null),
            .mkdir,
            file_path,
        ) orelse Maybe(void).success;
    }
}

pub fn mkdirOSPath(file_path: bun.OSPathSliceZ, flags: bun.Mode) Maybe(void) {
    return switch (Environment.os) {
        else => mkdir(file_path, flags),
        .windows => {
            const rc = kernel32.CreateDirectoryW(file_path, null);

            if (Maybe(void).errnoSys(
                rc,
                .mkdir,
            )) |err| {
                log("CreateDirectoryW({}) = {s}", .{ bun.fmt.fmtOSPath(file_path, .{}), err.err.name() });
                return err;
            }

            log("CreateDirectoryW({}) = 0", .{bun.fmt.fmtOSPath(file_path, .{})});
            return Maybe(void).success;
        },
    };
}

const fnctl_int = if (Environment.isLinux) usize else c_int;
pub fn fcntl(fd: bun.FileDescriptor, cmd: i32, arg: fnctl_int) Maybe(fnctl_int) {
    while (true) {
        const result = fcntl_symbol(fd.cast(), cmd, arg);
        if (Maybe(fnctl_int).errnoSysFd(result, .fcntl, fd)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return .{ .result = @intCast(result) };
    }

    unreachable;
}

pub fn getErrno(rc: anytype) bun.C.E {
    if (comptime Environment.isWindows) {
        if (comptime @TypeOf(rc) == bun.windows.NTSTATUS) {
            return bun.windows.translateNTStatusToErrno(rc);
        }

        if (bun.windows.Win32Error.get().toSystemErrno()) |e| {
            return e.toE();
        }

        return bun.C.E.UNKNOWN;
    }

    return bun.C.getErrno(rc);
}

const w = std.os.windows;

pub fn normalizePathWindows(
    comptime T: type,
    dir_fd: bun.FileDescriptor,
    path_: []const T,
    buf: *bun.WPathBuffer,
) Maybe([:0]const u16) {
    if (comptime T != u8 and T != u16) {
        @compileError("normalizePathWindows only supports u8 and u16 character types");
    }
    const wbuf = if (T != u16) bun.WPathBufferPool.get() else {};
    defer if (T != u16) bun.WPathBufferPool.put(wbuf);
    var path = if (T == u16) path_ else bun.strings.convertUTF8toUTF16InBuffer(wbuf, path_);

    if (std.fs.path.isAbsoluteWindowsWTF16(path)) {
        // handle the special "nul" device
        // we technically should handle the other DOS devices too.
        if (path_.len >= "\\nul".len and
            (bun.strings.eqlComptimeT(T, path_[path_.len - "\\nul".len ..], "\\nul") or
            bun.strings.eqlComptimeT(T, path_[path_.len - "\\NUL".len ..], "\\NUL")))
        {
            @memcpy(buf[0..bun.strings.w("\\??\\NUL").len], bun.strings.w("\\??\\NUL"));
            buf[bun.strings.w("\\??\\NUL").len] = 0;
            return .{ .result = buf[0..bun.strings.w("\\??\\NUL").len :0] };
        }

        const norm = bun.path.normalizeStringGenericTZ(u16, path, buf, .{ .add_nt_prefix = true, .zero_terminate = true });
        return .{ .result = norm };
    }

    if (bun.strings.indexOfAnyT(T, path_, &.{ '\\', '/', '.' }) == null) {
        if (buf.len < path.len) {
            return .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.NOMEM),
                    .syscall = .open,
                },
            };
        }

        // Skip the system call to get the final path name if it doesn't have any of the above characters.
        @memcpy(buf[0..path.len], path);
        buf[path.len] = 0;
        return .{
            .result = buf[0..path.len :0],
        };
    }

    const base_fd = if (dir_fd == bun.invalid_fd)
        std.fs.cwd().fd
    else
        dir_fd.cast();

    const base_path = bun.windows.GetFinalPathNameByHandle(base_fd, w.GetFinalPathNameByHandleFormat{}, buf) catch {
        return .{ .err = .{
            .errno = @intFromEnum(bun.C.E.BADFD),
            .syscall = .open,
        } };
    };

    if (path.len >= 2 and bun.path.isDriveLetterT(u16, path[0]) and path[1] == ':') {
        path = path[2..];
    }

    const buf1 = bun.WPathBufferPool.get();
    defer bun.WPathBufferPool.put(buf1);
    @memcpy(buf1[0..base_path.len], base_path);
    buf1[base_path.len] = '\\';
    @memcpy(buf1[base_path.len + 1 .. base_path.len + 1 + path.len], path);
    const norm = bun.path.normalizeStringGenericTZ(u16, buf1[0 .. base_path.len + 1 + path.len], buf, .{ .add_nt_prefix = true, .zero_terminate = true });
    return .{
        .result = norm,
    };
}

fn openDirAtWindowsNtPath(
    dirFd: bun.FileDescriptor,
    path: []const u16,
    options: WindowsOpenDirOptions,
) Maybe(bun.FileDescriptor) {
    const iterable = options.iterable;
    const no_follow = options.no_follow;
    const can_rename_or_delete = options.can_rename_or_delete;
    const read_only = options.read_only;
    assertIsValidWindowsPath(u16, path);
    const base_flags = w.STANDARD_RIGHTS_READ | w.FILE_READ_ATTRIBUTES | w.FILE_READ_EA |
        w.SYNCHRONIZE | w.FILE_TRAVERSE;
    const iterable_flag: u32 = if (iterable) w.FILE_LIST_DIRECTORY else 0;
    const rename_flag: u32 = if (can_rename_or_delete) w.DELETE else 0;
    const read_only_flag: u32 = if (read_only) 0 else w.FILE_ADD_FILE | w.FILE_ADD_SUBDIRECTORY;
    const flags: u32 = iterable_flag | base_flags | rename_flag | read_only_flag;

    const path_len_bytes: u16 = @truncate(path.len * 2);
    var nt_name = w.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = @constCast(path.ptr),
    };
    var attr = w.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(path))
            null
        else if (dirFd == bun.invalid_fd)
            std.fs.cwd().fd
        else
            dirFd.cast(),
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    const open_reparse_point: w.DWORD = if (no_follow) w.FILE_OPEN_REPARSE_POINT else 0x0;
    var fd: w.HANDLE = w.INVALID_HANDLE_VALUE;
    var io: w.IO_STATUS_BLOCK = undefined;

    const rc = w.ntdll.NtCreateFile(
        &fd,
        flags,
        &attr,
        &io,
        null,
        0,
        FILE_SHARE,
        if (options.create) w.FILE_OPEN_IF else w.FILE_OPEN,
        w.FILE_DIRECTORY_FILE | w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_FOR_BACKUP_INTENT | open_reparse_point,
        null,
        0,
    );

    if (comptime Environment.allow_assert) {
        if (rc == .INVALID_PARAMETER) {
            // Double check what flags you are passing to this
            //
            // - access_mask probably needs w.SYNCHRONIZE,
            // - options probably needs w.FILE_SYNCHRONOUS_IO_NONALERT
            // - disposition probably needs w.FILE_OPEN
            bun.Output.debugWarn("NtCreateFile({}, {}) = {s} (dir) = {d}\nYou are calling this function with the wrong flags!!!", .{ dirFd, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(fd) });
        } else if (rc == .OBJECT_PATH_SYNTAX_BAD or rc == .OBJECT_NAME_INVALID) {
            bun.Output.debugWarn("NtCreateFile({}, {}) = {s} (dir) = {d}\nYou are calling this function without normalizing the path correctly!!!", .{ dirFd, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(fd) });
        } else {
            log("NtCreateFile({}, {}) = {s} (dir) = {d}", .{ dirFd, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(fd) });
        }
    }

    switch (windows.Win32Error.fromNTStatus(rc)) {
        .SUCCESS => {
            return .{
                .result = bun.toFD(fd),
            };
        },
        else => |code| {
            if (code.toSystemErrno()) |sys_err| {
                return .{
                    .err = .{
                        .errno = @intFromEnum(sys_err),
                        .syscall = .open,
                    },
                };
            }

            return .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.UNKNOWN),
                    .syscall = .open,
                },
            };
        },
    }
}

pub const WindowsOpenDirOptions = packed struct {
    iterable: bool = false,
    no_follow: bool = false,
    can_rename_or_delete: bool = false,
    create: bool = false,
    read_only: bool = false,
};

fn openDirAtWindowsT(
    comptime T: type,
    dirFd: bun.FileDescriptor,
    path: []const T,
    options: WindowsOpenDirOptions,
) Maybe(bun.FileDescriptor) {
    const wbuf = bun.WPathBufferPool.get();
    defer bun.WPathBufferPool.put(wbuf);

    const norm = switch (normalizePathWindows(T, dirFd, path, wbuf)) {
        .err => |err| return .{ .err = err },
        .result => |norm| norm,
    };

    if (comptime T == u8) {
        log("openDirAtWindows({s}) = {s}", .{ path, bun.fmt.utf16(norm) });
    } else {
        log("openDirAtWindowsT({s}) = {s}", .{ bun.fmt.utf16(path), bun.fmt.utf16(norm) });
    }
    return openDirAtWindowsNtPath(dirFd, norm, options);
}

pub fn openDirAtWindows(
    dirFd: bun.FileDescriptor,
    path: []const u16,
    options: WindowsOpenDirOptions,
) Maybe(bun.FileDescriptor) {
    return openDirAtWindowsT(u16, dirFd, path, options);
}

pub noinline fn openDirAtWindowsA(
    dirFd: bun.FileDescriptor,
    path: []const u8,
    options: WindowsOpenDirOptions,
) Maybe(bun.FileDescriptor) {
    return openDirAtWindowsT(u8, dirFd, path, options);
}

/// For this function to open an absolute path, it must start with "\??\". Otherwise
/// you need a reference file descriptor the "invalid_fd" file descriptor is used
/// to signify that the current working directory should be used.
///
/// When using this function I highly recommend reading this first:
/// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
///
/// It is very very very easy to mess up flags here. Please review existing
/// examples to this call and the above function that maps unix flags to
/// the windows ones.
///
/// It is very easy to waste HOURS on the subtle semantics of this function.
///
/// In the zig standard library, messing up the input to their equivalent
/// will trigger `unreachable`. Here there will be a debug log with the path.
pub fn openFileAtWindowsNtPath(
    dir: bun.FileDescriptor,
    path: []const u16,
    access_mask: w.ULONG,
    disposition: w.ULONG,
    options: w.ULONG,
) Maybe(bun.FileDescriptor) {
    // Another problem re: normalization is that you can use relative paths, but no leading '.\' or './''
    // this path is probably already backslash normalized so we're only going to check for '.\'
    // const path = if (bun.strings.hasPrefixComptimeUTF16(path_maybe_leading_dot, ".\\")) path_maybe_leading_dot[2..] else path_maybe_leading_dot;
    // bun.assert(!bun.strings.hasPrefixComptimeUTF16(path_maybe_leading_dot, "./"));
    assertIsValidWindowsPath(u16, path);

    var result: windows.HANDLE = undefined;

    const path_len_bytes = std.math.cast(u16, path.len * 2) orelse return .{
        .err = .{
            .errno = @intFromEnum(bun.C.E.NOMEM),
            .syscall = .open,
        },
    };
    var nt_name = windows.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = @constCast(path.ptr),
    };
    var attr = windows.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(windows.OBJECT_ATTRIBUTES),
        // From the Windows Documentation:
        //
        // [ObjectName] must be a fully qualified file specification or the name of a device object,
        // unless it is the name of a file relative to the directory specified by RootDirectory.
        // For example, \Device\Floppy1\myfile.dat or \??\B:\myfile.dat could be the fully qualified
        // file specification, provided that the floppy driver and overlying file system are already
        // loaded. For more information, see File Names, Paths, and Namespaces.
        .ObjectName = &nt_name,
        .RootDirectory = if (bun.strings.hasPrefixComptimeType(u16, path, windows.nt_object_prefix))
            null
        else if (dir == bun.invalid_fd)
            std.fs.cwd().fd
        else
            dir.cast(),
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    var io: windows.IO_STATUS_BLOCK = undefined;

    var attributes: w.DWORD = w.FILE_ATTRIBUTE_NORMAL;

    while (true) {
        const rc = windows.ntdll.NtCreateFile(
            &result,
            access_mask,
            &attr,
            &io,
            null,
            attributes,
            FILE_SHARE,
            disposition,
            options,
            null,
            0,
        );

        if (comptime Environment.allow_assert) {
            if (rc == .INVALID_PARAMETER) {
                // Double check what flags you are passing to this
                //
                // - access_mask probably needs w.SYNCHRONIZE,
                // - options probably needs w.FILE_SYNCHRONOUS_IO_NONALERT
                // - disposition probably needs w.FILE_OPEN
                bun.Output.debugWarn("NtCreateFile({}, {}) = {s} (file) = {d}\nYou are calling this function with the wrong flags!!!", .{ dir, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(result) });
            } else if (rc == .OBJECT_PATH_SYNTAX_BAD or rc == .OBJECT_NAME_INVALID) {
                // See above comment. For absolute paths you must have \??\ at the start.
                bun.Output.debugWarn("NtCreateFile({}, {}) = {s} (file) = {d}\nYou are calling this function without normalizing the path correctly!!!", .{ dir, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(result) });
            } else {
                log("NtCreateFile({}, {}) = {s} (file) = {d}", .{ dir, bun.fmt.utf16(path), @tagName(rc), @intFromPtr(result) });
            }
        }

        if (rc == .ACCESS_DENIED and
            attributes == w.FILE_ATTRIBUTE_NORMAL and
            (access_mask & (w.GENERIC_READ | w.GENERIC_WRITE)) == w.GENERIC_WRITE)
        {
            // > If CREATE_ALWAYS and FILE_ATTRIBUTE_NORMAL are specified,
            // > CreateFile fails and sets the last error to ERROR_ACCESS_DENIED
            // > if the file exists and has the FILE_ATTRIBUTE_HIDDEN or
            // > FILE_ATTRIBUTE_SYSTEM attribute. To avoid the error, specify the
            // > same attributes as the existing file.
            //
            // The above also applies to NtCreateFile. In order to make this work,
            // we retry but only in the case that the file was opened for writing.
            //
            // See https://github.com/oven-sh/bun/issues/6820
            //     https://github.com/libuv/libuv/pull/3380
            attributes = w.FILE_ATTRIBUTE_HIDDEN;
            continue;
        }

        switch (windows.Win32Error.fromNTStatus(rc)) {
            .SUCCESS => {
                if (access_mask & w.FILE_APPEND_DATA != 0) {
                    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
                    const FILE_END = 2;
                    if (kernel32.SetFilePointerEx(result, 0, null, FILE_END) == 0) {
                        return .{
                            .err = .{
                                .errno = @intFromEnum(bun.C.E.UNKNOWN),
                                .syscall = .SetFilePointerEx,
                            },
                        };
                    }
                }
                return JSC.Maybe(bun.FileDescriptor){
                    .result = bun.toFD(result),
                };
            },
            else => |code| {
                if (code.toSystemErrno()) |sys_err| {
                    return .{
                        .err = .{
                            .errno = @intFromEnum(sys_err),
                            .syscall = .open,
                        },
                    };
                }

                return .{
                    .err = .{
                        .errno = @intFromEnum(bun.C.E.UNKNOWN),
                        .syscall = .open,
                    },
                };
            },
        }
    }
}

pub fn openFileAtWindowsT(
    comptime T: type,
    dirFd: bun.FileDescriptor,
    path: []const T,
    access_mask: w.ULONG,
    disposition: w.ULONG,
    options: w.ULONG,
) Maybe(bun.FileDescriptor) {
    const wbuf = bun.WPathBufferPool.get();
    defer bun.WPathBufferPool.put(wbuf);

    const norm = switch (normalizePathWindows(T, dirFd, path, wbuf)) {
        .err => |err| return .{ .err = err },
        .result => |norm| norm,
    };

    return openFileAtWindowsNtPath(dirFd, norm, access_mask, disposition, options);
}

pub fn openFileAtWindows(
    dirFd: bun.FileDescriptor,
    path: []const u16,
    access_mask: w.ULONG,
    disposition: w.ULONG,
    options: w.ULONG,
) Maybe(bun.FileDescriptor) {
    return openFileAtWindowsT(u16, dirFd, path, access_mask, disposition, options);
}

pub noinline fn openFileAtWindowsA(
    dirFd: bun.FileDescriptor,
    path: []const u8,
    access_mask: w.ULONG,
    disposition: w.ULONG,
    options: w.ULONG,
) Maybe(bun.FileDescriptor) {
    return openFileAtWindowsT(u8, dirFd, path, access_mask, disposition, options);
}

pub fn openatWindowsT(comptime T: type, dir: bun.FileDescriptor, path: []const T, flags: bun.Mode) Maybe(bun.FileDescriptor) {
    return openatWindowsTMaybeNormalize(T, dir, path, flags, true);
}

fn openatWindowsTMaybeNormalize(comptime T: type, dir: bun.FileDescriptor, path: []const T, flags: bun.Mode, comptime normalize: bool) Maybe(bun.FileDescriptor) {
    if (flags & O.DIRECTORY != 0) {
        const windows_options: WindowsOpenDirOptions = .{ .iterable = flags & O.PATH == 0, .no_follow = flags & O.NOFOLLOW != 0, .can_rename_or_delete = false };
        if (comptime !normalize and T == u16) {
            return openDirAtWindowsNtPath(dir, path, windows_options);
        }

        // we interpret O_PATH as meaning that we don't want iteration
        return openDirAtWindowsT(
            T,
            dir,
            path,
            windows_options,
        );
    }

    const nonblock = flags & O.NONBLOCK != 0;
    const overwrite = flags & O.WRONLY != 0 and flags & O.APPEND == 0;

    var access_mask: w.ULONG = w.READ_CONTROL | w.FILE_WRITE_ATTRIBUTES | w.SYNCHRONIZE;
    if (flags & O.RDWR != 0) {
        access_mask |= w.GENERIC_READ | w.GENERIC_WRITE;
    } else if (flags & O.APPEND != 0) {
        access_mask |= w.GENERIC_WRITE | w.FILE_APPEND_DATA;
    } else if (flags & O.WRONLY != 0) {
        access_mask |= w.GENERIC_WRITE;
    } else {
        access_mask |= w.GENERIC_READ;
    }

    const creation: w.ULONG = blk: {
        if (flags & O.CREAT != 0) {
            if (flags & O.EXCL != 0) {
                break :blk w.FILE_CREATE;
            }
            break :blk if (overwrite) w.FILE_OVERWRITE_IF else w.FILE_OPEN_IF;
        }
        break :blk if (overwrite) w.FILE_OVERWRITE else w.FILE_OPEN;
    };

    const blocking_flag: windows.ULONG = if (!nonblock) windows.FILE_SYNCHRONOUS_IO_NONALERT else 0;
    const file_or_dir_flag: windows.ULONG = switch (flags & O.DIRECTORY != 0) {
        // .file_only => windows.FILE_NON_DIRECTORY_FILE,
        true => windows.FILE_DIRECTORY_FILE,
        false => 0,
    };
    const follow_symlinks = flags & O.NOFOLLOW == 0;

    const options: windows.ULONG = if (follow_symlinks) file_or_dir_flag | blocking_flag else file_or_dir_flag | windows.FILE_OPEN_REPARSE_POINT;

    if (comptime !normalize and T == u16) {
        return openFileAtWindowsNtPath(dir, path, access_mask, creation, options);
    }

    return openFileAtWindowsT(T, dir, path, access_mask, creation, options);
}

pub fn openatWindows(
    dir: anytype,
    path: []const u16,
    flags: bun.Mode,
) Maybe(bun.FileDescriptor) {
    return openatWindowsT(u16, bun.toFD(dir), path, flags);
}

pub fn openatWindowsA(
    dir: bun.FileDescriptor,
    path: []const u8,
    flags: bun.Mode,
) Maybe(bun.FileDescriptor) {
    return openatWindowsT(u8, dir, path, flags);
}

pub fn openatOSPath(dirfd: bun.FileDescriptor, file_path: bun.OSPathSliceZ, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isMac) {
        // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
        const rc = syscall.@"openat$NOCANCEL"(dirfd.cast(), file_path.ptr, @as(c_uint, @intCast(flags)), @as(c_int, @intCast(perm)));
        if (comptime Environment.allow_assert)
            log("openat({}, {s}) = {d}", .{ dirfd, bun.sliceTo(file_path, 0), rc });

        return Maybe(bun.FileDescriptor).errnoSysFP(rc, .open, dirfd, file_path) orelse .{ .result = bun.toFD(rc) };
    } else if (comptime Environment.isWindows) {
        return openatWindowsT(bun.OSPathChar, dirfd, file_path, flags);
    }

    while (true) {
        const rc = syscall.openat(dirfd.cast(), file_path, bun.O.toPacked(flags), perm);
        if (comptime Environment.allow_assert)
            log("openat({}, {s}) = {d}", .{ dirfd, bun.sliceTo(file_path, 0), rc });
        return switch (Syscall.getErrno(rc)) {
            .SUCCESS => .{ .result = bun.toFD(@as(i32, @intCast(rc))) },
            .INTR => continue,
            else => |err| {
                return .{
                    .err = .{
                        .errno = @truncate(@intFromEnum(err)),
                        .syscall = .open,
                    },
                };
            },
        };
    }
}

pub fn access(path: bun.OSPathSliceZ, mode: bun.Mode) Maybe(void) {
    return Maybe(void).errnoSysP(syscall.access(path, mode), .access, path) orelse .{ .result = {} };
}

pub fn openat(dirfd: bun.FileDescriptor, file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        return openatWindowsT(u8, dirfd, file_path, flags);
    } else {
        return openatOSPath(dirfd, file_path, flags, perm);
    }
}

pub fn openatA(dirfd: bun.FileDescriptor, file_path: []const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        return openatWindowsT(u8, dirfd, file_path, flags);
    }

    const pathZ = std.posix.toPosixPath(file_path) catch return Maybe(bun.FileDescriptor){
        .err = .{
            .errno = @intFromEnum(bun.C.E.NAMETOOLONG),
            .syscall = .open,
        },
    };

    return openatOSPath(
        dirfd,
        &pathZ,
        flags,
        perm,
    );
}

pub fn openA(file_path: []const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    // this is what open() does anyway.
    return openatA(bun.toFD((std.fs.cwd().fd)), file_path, flags, perm);
}

pub fn open(file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    // TODO(@paperdave): this should not need to use libuv
    if (comptime Environment.isWindows) {
        return sys_uv.open(file_path, flags, perm);
    }

    // this is what open() does anyway.
    return openat(bun.toFD((std.fs.cwd().fd)), file_path, flags, perm);
}

/// This function will prevent stdout and stderr from being closed.
pub fn close(fd: bun.FileDescriptor) ?Syscall.Error {
    return bun.FDImpl.decode(fd).close();
}

pub fn close2(fd: bun.FileDescriptor) ?Syscall.Error {
    if (fd == bun.STDOUT_FD or fd == bun.STDERR_FD or fd == bun.STDIN_FD) {
        log("close({}) SKIPPED", .{fd});
        return null;
    }

    return closeAllowingStdoutAndStderr(fd);
}

pub fn closeAllowingStdoutAndStderr(fd: bun.FileDescriptor) ?Syscall.Error {
    return bun.FDImpl.decode(fd).closeAllowingStdoutAndStderr();
}

pub const max_count = switch (builtin.os.tag) {
    .linux => 0x7ffff000,
    .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
    .windows => std.math.maxInt(u32),
    else => std.math.maxInt(isize),
};

pub fn write(fd: bun.FileDescriptor, bytes: []const u8) Maybe(usize) {
    const adjusted_len = @min(max_count, bytes.len);
    var debug_timer = bun.Output.DebugTimer.start();

    defer {
        if (Environment.isDebug) {
            if (debug_timer.timer.read() > std.time.ns_per_ms) {
                log("write({}, {d}) blocked for {}", .{ fd, bytes.len, debug_timer });
            }
        }
    }

    return switch (Environment.os) {
        .mac => {
            const rc = syscall.@"write$NOCANCEL"(fd.cast(), bytes.ptr, adjusted_len);
            log("write({}, {d}) = {d} ({})", .{ fd, adjusted_len, rc, debug_timer });

            if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                return err;
            }

            return Maybe(usize){ .result = @intCast(rc) };
        },
        .linux => {
            while (true) {
                const rc = syscall.write(fd.cast(), bytes.ptr, adjusted_len);
                log("write({}, {d}) = {d} {}", .{ fd, adjusted_len, rc, debug_timer });

                if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                    if (err.getErrno() == .INTR) continue;
                    return err;
                }

                return Maybe(usize){ .result = @intCast(rc) };
            }
        },
        .windows => {
            // "WriteFile sets this value to zero before doing any work or error checking."
            var bytes_written: u32 = undefined;
            bun.assert(bytes.len > 0);
            const rc = kernel32.WriteFile(
                fd.cast(),
                bytes.ptr,
                adjusted_len,
                &bytes_written,
                null,
            );
            if (rc == 0) {
                log("WriteFile({}, {d}) = {s}", .{ fd, adjusted_len, @tagName(bun.windows.getLastErrno()) });
                return .{
                    .err = Syscall.Error{
                        .errno = @intFromEnum(bun.windows.getLastErrno()),
                        .syscall = .WriteFile,
                        .fd = fd,
                    },
                };
            }

            log("WriteFile({}, {d}) = {d}", .{ fd, adjusted_len, bytes_written });

            return Maybe(usize){ .result = bytes_written };
        },
        else => @compileError("Not implemented yet"),
    };
}

fn veclen(buffers: anytype) usize {
    var len: usize = 0;
    for (buffers) |buffer| {
        len += buffer.len;
    }
    return len;
}

pub fn writev(fd: bun.FileDescriptor, buffers: []std.posix.iovec) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = writev_sym(fd.cast(), @as([*]std.posix.iovec_const, @ptrCast(buffers.ptr)), @as(i32, @intCast(buffers.len)));
        if (comptime Environment.allow_assert)
            log("writev({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .writev, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = writev_sym(fd.cast(), @as([*]std.posix.iovec_const, @ptrCast(buffers.ptr)), buffers.len);
            if (comptime Environment.allow_assert)
                log("writev({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .writev, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn pwritev(fd: bun.FileDescriptor, buffers: []const bun.PlatformIOVecConst, position: isize) Maybe(usize) {
    if (comptime Environment.isWindows) {
        return sys_uv.pwritev(fd, buffers, position);
    }
    if (comptime Environment.isMac) {
        const rc = pwritev_sym(fd.cast(), buffers.ptr, @as(i32, @intCast(buffers.len)), position);
        if (comptime Environment.allow_assert)
            log("pwritev({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .pwritev, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = pwritev_sym(fd.cast(), buffers.ptr, buffers.len, position);
            if (comptime Environment.allow_assert)
                log("pwritev({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .pwritev, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn readv(fd: bun.FileDescriptor, buffers: []std.posix.iovec) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buffers.len == 0) {
            bun.Output.debugWarn("readv() called with 0 length buffer", .{});
        }
    }

    if (comptime Environment.isMac) {
        const rc = readv_sym(fd.cast(), buffers.ptr, @as(i32, @intCast(buffers.len)));
        if (comptime Environment.allow_assert)
            log("readv({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .readv, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = readv_sym(fd.cast(), buffers.ptr, buffers.len);
            if (comptime Environment.allow_assert)
                log("readv({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .readv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn preadv(fd: bun.FileDescriptor, buffers: []std.posix.iovec, position: isize) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buffers.len == 0) {
            bun.Output.debugWarn("preadv() called with 0 length buffer", .{});
        }
    }

    if (comptime Environment.isMac) {
        const rc = preadv_sym(fd.cast(), buffers.ptr, @as(i32, @intCast(buffers.len)), position);
        if (comptime Environment.allow_assert)
            log("preadv({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .preadv, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = preadv_sym(fd.cast(), buffers.ptr, buffers.len, position);
            if (comptime Environment.allow_assert)
                log("preadv({}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .preadv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

const preadv_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.preadv
else if (builtin.os.tag.isDarwin())
    syscall.@"preadv$NOCANCEL"
else
    syscall.preadv;

const readv_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.readv
else if (builtin.os.tag.isDarwin())
    syscall.@"readv$NOCANCEL"
else
    syscall.readv;

const pwritev_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.pwritev
else if (builtin.os.tag.isDarwin())
    syscall.@"pwritev$NOCANCEL"
else
    syscall.pwritev;

const writev_sym = if (builtin.os.tag.isDarwin())
    syscall.@"writev$NOCANCEL"
else
    syscall.writev;

const pread_sym = if (builtin.os.tag.isDarwin())
    syscall.@"pread$NOCANCEL"
else
    syscall.pread;

const fcntl_symbol = syscall.fcntl;

pub fn pread(fd: bun.FileDescriptor, buf: []u8, offset: i64) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);

    if (comptime Environment.allow_assert) {
        if (adjusted_len == 0) {
            bun.Output.debugWarn("pread() called with 0 length buffer", .{});
        }
    }

    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    while (true) {
        const rc = pread_sym(fd.cast(), buf.ptr, adjusted_len, ioffset);
        if (Maybe(usize).errnoSysFd(rc, .pread, fd)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }
}

const pwrite_sym = if (builtin.os.tag == .linux and builtin.link_libc and !bun.Environment.isMusl)
    libc.pwrite64
else
    syscall.pwrite;

pub fn pwrite(fd: bun.FileDescriptor, bytes: []const u8, offset: i64) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (bytes.len == 0) {
            bun.Output.debugWarn("pwrite() called with 0 length buffer", .{});
        }
    }

    const adjusted_len = @min(bytes.len, max_count);

    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    while (true) {
        const rc = pwrite_sym(fd.cast(), bytes.ptr, adjusted_len, ioffset);
        return if (Maybe(usize).errnoSysFd(rc, .pwrite, fd)) |err| {
            switch (err.getErrno()) {
                .INTR => continue,
                else => return err,
            }
        } else Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }
}

pub fn read(fd: bun.FileDescriptor, buf: []u8) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buf.len == 0) {
            bun.Output.debugWarn("read() called with 0 length buffer", .{});
        }
    }
    const debug_timer = bun.Output.DebugTimer.start();
    const adjusted_len = @min(buf.len, max_count);
    return switch (Environment.os) {
        .mac => {
            const rc = syscall.@"read$NOCANCEL"(fd.cast(), buf.ptr, adjusted_len);

            if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                log("read({}, {d}) = {s} ({any})", .{ fd, adjusted_len, err.err.name(), debug_timer });
                return err;
            }
            log("read({}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        },
        .linux => {
            while (true) {
                const rc = syscall.read(fd.cast(), buf.ptr, adjusted_len);
                log("read({}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

                if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                    if (err.getErrno() == .INTR) continue;
                    return err;
                }
                return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
            }
        },
        .windows => if (bun.FDImpl.decode(fd).kind == .uv)
            sys_uv.read(fd, buf)
        else {
            var amount_read: u32 = 0;
            const rc = kernel32.ReadFile(fd.cast(), buf.ptr, @as(u32, @intCast(adjusted_len)), &amount_read, null);
            if (rc == windows.FALSE) {
                const ret = .{
                    .err = Syscall.Error{
                        .errno = @intFromEnum(bun.windows.getLastErrno()),
                        .syscall = .read,
                        .fd = fd,
                    },
                };

                if (comptime Environment.isDebug) {
                    log("ReadFile({}, {d}) = {s} ({})", .{ fd, adjusted_len, ret.err.name(), debug_timer });
                }

                return ret;
            }
            log("ReadFile({}, {d}) = {d} ({})", .{ fd, adjusted_len, amount_read, debug_timer });

            return Maybe(usize){ .result = amount_read };
        },
        else => @compileError("read is not implemented on this platform"),
    };
}

const socket_flags_nonblock = bun.C.MSG_DONTWAIT | bun.C.MSG_NOSIGNAL;

pub fn recvNonBlock(fd: bun.FileDescriptor, buf: []u8) Maybe(usize) {
    return recv(fd, buf, socket_flags_nonblock);
}

pub fn recv(fd: bun.FileDescriptor, buf: []u8, flag: u32) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);
    const debug_timer = bun.Output.DebugTimer.start();
    if (comptime Environment.allow_assert) {
        if (adjusted_len == 0) {
            bun.Output.debugWarn("recv() called with 0 length buffer", .{});
        }
    }

    if (comptime Environment.isMac) {
        const rc = syscall.@"recvfrom$NOCANCEL"(fd.cast(), buf.ptr, adjusted_len, flag, null, null);

        if (Maybe(usize).errnoSysFd(rc, .recv, fd)) |err| {
            log("recv({}, {d}) = {s} {}", .{ fd, adjusted_len, err.err.name(), debug_timer });
            return err;
        }

        log("recv({}, {d}) = {d} {}", .{ fd, adjusted_len, rc, debug_timer });

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = linux.recvfrom(fd.cast(), buf.ptr, adjusted_len, flag, null, null);

            if (Maybe(usize).errnoSysFd(rc, .recv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                log("recv({}, {d}) = {s} {}", .{ fd, adjusted_len, err.err.name(), debug_timer });
                return err;
            }
            log("recv({}, {d}) = {d} {}", .{ fd, adjusted_len, rc, debug_timer });
            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
    }
}

pub fn sendNonBlock(fd: bun.FileDescriptor, buf: []const u8) Maybe(usize) {
    return send(fd, buf, socket_flags_nonblock);
}

pub fn send(fd: bun.FileDescriptor, buf: []const u8, flag: u32) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = syscall.@"sendto$NOCANCEL"(fd.cast(), buf.ptr, buf.len, flag, null, 0);

        if (Maybe(usize).errnoSysFd(rc, .send, fd)) |err| {
            syslog("send({}, {d}) = {s}", .{ fd, buf.len, err.err.name() });
            return err;
        }

        syslog("send({}, {d}) = {d}", .{ fd, buf.len, rc });

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = linux.sendto(fd.cast(), buf.ptr, buf.len, flag, null, 0);

            if (Maybe(usize).errnoSysFd(rc, .send, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                syslog("send({}, {d}) = {s}", .{ fd, buf.len, err.err.name() });
                return err;
            }

            syslog("send({}, {d}) = {d}", .{ fd, buf.len, rc });
            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
    }
}

pub fn lseek(fd: bun.FileDescriptor, offset: i64, whence: usize) Maybe(usize) {
    while (true) {
        const rc = syscall.lseek(fd.cast(), offset, whence);
        if (Maybe(usize).errnoSysFd(rc, .lseek, fd)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }

        return Maybe(usize){ .result = rc };
    }
}

pub fn readlink(in: [:0]const u8, buf: []u8) Maybe([:0]u8) {
    if (comptime Environment.isWindows) {
        return sys_uv.readlink(in, buf);
    }

    while (true) {
        const rc = syscall.readlink(in, buf.ptr, buf.len);

        if (Maybe([:0]u8).errnoSysP(rc, .readlink, in)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        buf[@intCast(rc)] = 0;
        return .{ .result = buf[0..@intCast(rc) :0] };
    }
}

pub fn readlinkat(fd: bun.FileDescriptor, in: [:0]const u8, buf: []u8) Maybe([:0]u8) {
    while (true) {
        const rc = syscall.readlinkat(fd.cast(), in, buf.ptr, buf.len);

        if (Maybe([:0]u8).errnoSysFP(rc, .readlink, fd, in)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        buf[@intCast(rc)] = 0;
        return Maybe([:0]u8){ .result = buf[0..@intCast(rc) :0] };
    }
}

pub fn ftruncate(fd: bun.FileDescriptor, size: isize) Maybe(void) {
    if (comptime Environment.isWindows) {
        if (kernel32.SetFileValidData(fd.cast(), size) == 0) {
            return Maybe(void).errnoSysFd(0, .ftruncate, fd) orelse Maybe(void).success;
        }

        return Maybe(void).success;
    }

    return while (true) {
        if (Maybe(void).errnoSysFd(syscall.ftruncate(fd.cast(), size), .ftruncate, fd)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    };
}

pub fn rename(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(syscall.rename(from, to), .rename)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
}

pub const RenameAt2Flags = packed struct {
    exchange: bool = false,
    exclude: bool = false,
    nofollow: bool = false,

    pub fn int(self: RenameAt2Flags) u32 {
        var flags: u32 = 0;

        if (comptime Environment.isMac) {
            if (self.exchange) flags |= bun.C.RENAME_SWAP;
            if (self.exclude) flags |= bun.C.RENAME_EXCL;
            if (self.nofollow) flags |= bun.C.RENAME_NOFOLLOW_ANY;
        } else {
            if (self.exchange) flags |= bun.C.RENAME_EXCHANGE;
            if (self.exclude) flags |= bun.C.RENAME_NOREPLACE;
        }

        return flags;
    }
};

pub fn renameatConcurrently(
    from_dir_fd: bun.FileDescriptor,
    from: [:0]const u8,
    to_dir_fd: bun.FileDescriptor,
    to: [:0]const u8,
    comptime opts: struct { move_fallback: bool = false },
) Maybe(void) {
    switch (renameatConcurrentlyWithoutFallback(from_dir_fd, from, to_dir_fd, to)) {
        .result => return Maybe(void).success,
        .err => |e| {
            if (opts.move_fallback and e.getErrno() == bun.C.E.XDEV) {
                bun.Output.debugWarn("renameatConcurrently() failed with E.XDEV, falling back to moveFileZSlowMaybe()", .{});
                return bun.C.moveFileZSlowMaybe(from_dir_fd, from, to_dir_fd, to);
            }
            return .{ .err = e };
        },
    }
}

pub fn renameatConcurrentlyWithoutFallback(
    from_dir_fd: bun.FileDescriptor,
    from: [:0]const u8,
    to_dir_fd: bun.FileDescriptor,
    to: [:0]const u8,
) Maybe(void) {
    var did_atomically_replace = false;

    attempt_atomic_rename_and_fallback_to_racy_delete: {
        {
            // Happy path: the folder doesn't exist in the cache dir, so we can
            // just rename it. We don't need to delete anything.
            var err = switch (bun.sys.renameat2(from_dir_fd, from, to_dir_fd, to, .{
                .exclude = true,
            })) {
                // if ENOENT don't retry
                .err => |err| if (err.getErrno() == .NOENT) return .{ .err = err } else err,
                .result => break :attempt_atomic_rename_and_fallback_to_racy_delete,
            };

            // Windows doesn't have any equivalent with renameat with swap
            if (!bun.Environment.isWindows) {
                // Fallback path: the folder exists in the cache dir, it might be in a strange state
                // let's attempt to atomically replace it with the temporary folder's version
                if (switch (err.getErrno()) {
                    .EXIST, .NOTEMPTY, .OPNOTSUPP => true,
                    else => false,
                }) {
                    did_atomically_replace = true;
                    switch (bun.sys.renameat2(from_dir_fd, from, to_dir_fd, to, .{
                        .exchange = true,
                    })) {
                        .err => {},
                        .result => break :attempt_atomic_rename_and_fallback_to_racy_delete,
                    }
                    did_atomically_replace = false;
                }
            }
        }

        //  sad path: let's try to delete the folder and then rename it
        if (to_dir_fd.isValid()) {
            var to_dir = to_dir_fd.asDir();
            to_dir.deleteTree(to) catch {};
        } else {
            std.fs.deleteTreeAbsolute(to) catch {};
        }
        switch (bun.sys.renameat(from_dir_fd, from, to_dir_fd, to)) {
            .err => |err| {
                return .{ .err = err };
            },
            .result => {},
        }
    }

    return Maybe(void).success;
}

pub fn renameat2(from_dir: bun.FileDescriptor, from: [:0]const u8, to_dir: bun.FileDescriptor, to: [:0]const u8, flags: RenameAt2Flags) Maybe(void) {
    if (Environment.isWindows) {
        return renameat(from_dir, from, to_dir, to);
    }

    while (true) {
        const rc = switch (comptime Environment.os) {
            .linux => std.os.linux.renameat2(@intCast(from_dir.cast()), from.ptr, @intCast(to_dir.cast()), to.ptr, flags.int()),
            .mac => bun.C.renameatx_np(@intCast(from_dir.cast()), from.ptr, @intCast(to_dir.cast()), to.ptr, flags.int()),
            else => @compileError("renameat2() is not implemented on this platform"),
        };

        if (Maybe(void).errnoSys(rc, .rename)) |err| {
            if (err.getErrno() == .INTR) continue;
            if (comptime Environment.allow_assert)
                log("renameat2({}, {s}, {}, {s}) = {d}", .{ from_dir, from, to_dir, to, @intFromEnum(err.getErrno()) });
            return err;
        }
        if (comptime Environment.allow_assert)
            log("renameat2({}, {s}, {}, {s}) = {d}", .{ from_dir, from, to_dir, to, 0 });
        return Maybe(void).success;
    }
}

pub fn renameat(from_dir: bun.FileDescriptor, from: [:0]const u8, to_dir: bun.FileDescriptor, to: [:0]const u8) Maybe(void) {
    if (Environment.isWindows) {
        const w_buf_from = bun.WPathBufferPool.get();
        const w_buf_to = bun.WPathBufferPool.get();
        defer {
            bun.WPathBufferPool.put(w_buf_from);
            bun.WPathBufferPool.put(w_buf_to);
        }

        const rc = bun.C.renameAtW(
            from_dir,
            bun.strings.toNTPath(w_buf_from, from),
            to_dir,
            bun.strings.toNTPath(w_buf_to, to),
            true,
        );

        return rc;
    }
    while (true) {
        if (Maybe(void).errnoSys(syscall.renameat(from_dir.cast(), from, to_dir.cast(), to), .rename)) |err| {
            if (err.getErrno() == .INTR) continue;
            if (comptime Environment.allow_assert)
                log("renameat({}, {s}, {}, {s}) = {d}", .{ from_dir, from, to_dir, to, @intFromEnum(err.getErrno()) });
            return err;
        }
        if (comptime Environment.allow_assert)
            log("renameat({}, {s}, {}, {s}) = {d}", .{ from_dir, from, to_dir, to, 0 });
        return Maybe(void).success;
    }
}

pub fn chown(path: [:0]const u8, uid: posix.uid_t, gid: posix.gid_t) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSysP(C.chown(path, uid, gid), .chown, path)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
}

pub fn symlink(target: [:0]const u8, dest: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSysPD(syscall.symlink(target, dest), .symlink, target, dest)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
}

pub fn symlinkat(target: [:0]const u8, dirfd: bun.FileDescriptor, dest: [:0]const u8) Maybe(void) {
    while (true) {
        if (Maybe(void).errnoSys(syscall.symlinkat(target, dirfd.cast(), dest), .symlinkat)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
}

pub const WindowsSymlinkOptions = packed struct {
    directory: bool = false,

    var symlink_flags: u32 = w.SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE;
    pub fn flags(this: WindowsSymlinkOptions) u32 {
        if (this.directory) {
            symlink_flags |= w.SYMBOLIC_LINK_FLAG_DIRECTORY;
        }

        return symlink_flags;
    }

    pub fn denied() void {
        symlink_flags = 0;
    }

    pub var has_failed_to_create_symlink = false;
};

pub fn symlinkOrJunction(dest: [:0]const u8, target: [:0]const u8) Maybe(void) {
    if (comptime !Environment.isWindows) @compileError("symlinkOrJunction is windows only");

    if (!WindowsSymlinkOptions.has_failed_to_create_symlink) {
        const sym16 = bun.WPathBufferPool.get();
        const target16 = bun.WPathBufferPool.get();
        defer {
            bun.WPathBufferPool.put(sym16);
            bun.WPathBufferPool.put(target16);
        }
        const sym_path = bun.strings.toWPathNormalizeAutoExtend(sym16, dest);
        const target_path = bun.strings.toWPathNormalizeAutoExtend(target16, target);
        switch (symlinkW(sym_path, target_path, .{ .directory = true })) {
            .result => {
                return Maybe(void).success;
            },
            .err => |err| {
                if (err.getErrno() == .EXIST) {
                    return .{ .err = err };
                }
            },
        }
    }

    return sys_uv.symlinkUV(target, dest, bun.windows.libuv.UV_FS_SYMLINK_JUNCTION);
}

pub fn symlinkW(dest: [:0]const u16, target: [:0]const u16, options: WindowsSymlinkOptions) Maybe(void) {
    while (true) {
        const flags = options.flags();

        if (windows.kernel32.CreateSymbolicLinkW(dest, target, flags) == 0) {
            const errno = bun.windows.Win32Error.get();
            log("CreateSymbolicLinkW({}, {}, {any}) = {s}", .{
                bun.fmt.fmtPath(u16, dest, .{}),
                bun.fmt.fmtPath(u16, target, .{}),
                flags,
                @tagName(errno),
            });
            switch (errno) {
                .INVALID_PARAMETER => {
                    if ((flags & w.SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != 0) {
                        WindowsSymlinkOptions.denied();
                        continue;
                    }
                },
                else => {},
            }

            if (errno.toSystemErrno()) |err| {
                WindowsSymlinkOptions.has_failed_to_create_symlink = true;
                return .{
                    .err = .{
                        .errno = @intFromEnum(err),
                        .syscall = .symlink,
                    },
                };
            }
        }

        log("CreateSymbolicLinkW({}, {}, {any}) = 0", .{
            bun.fmt.fmtPath(u16, dest, .{}),
            bun.fmt.fmtPath(u16, target, .{}),
            flags,
        });

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
}

pub fn fcopyfile(fd_in: bun.FileDescriptor, fd_out: bun.FileDescriptor, flags: u32) Maybe(void) {
    if (comptime !Environment.isMac) @compileError("macOS only");

    while (true) {
        if (Maybe(void).errnoSys(syscall.fcopyfile(fd_in.cast(), fd_out.cast(), null, flags), .fcopyfile)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
}

pub fn unlinkW(from: [:0]const u16) Maybe(void) {
    if (windows.DeleteFileW(from.ptr) != 0) {
        return .{ .err = Error.fromCode(bun.windows.getLastErrno(), .unlink) };
    }

    return Maybe(void).success;
}

pub fn unlink(from: [:0]const u8) Maybe(void) {
    if (comptime Environment.isWindows) {
        const w_buf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(w_buf);
        return unlinkW(bun.strings.toNTPath(w_buf, from));
    }

    while (true) {
        if (Maybe(void).errnoSysP(syscall.unlink(from), .unlink, from)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }

        log("unlink({s}) = 0", .{from});
        return Maybe(void).success;
    }
}

pub fn rmdirat(dirfd: bun.FileDescriptor, to: anytype) Maybe(void) {
    return unlinkatWithFlags(dirfd, to, std.posix.AT.REMOVEDIR);
}

pub fn unlinkatWithFlags(dirfd: bun.FileDescriptor, to: anytype, flags: c_uint) Maybe(void) {
    if (Environment.isWindows) {
        if (comptime std.meta.Elem(@TypeOf(to)) == u8) {
            const w_buf = bun.WPathBufferPool.get();
            defer bun.WPathBufferPool.put(w_buf);
            return unlinkatWithFlags(dirfd, bun.strings.toNTPath(w_buf, bun.span(to)), flags);
        }

        return bun.windows.DeleteFileBun(to, .{
            .dir = if (dirfd != bun.invalid_fd) dirfd.cast() else null,
            .remove_dir = flags & std.posix.AT.REMOVEDIR != 0,
        });
    }

    while (true) {
        if (Maybe(void).errnoSysFP(syscall.unlinkat(dirfd.cast(), to, flags), .unlink, dirfd, to)) |err| {
            if (err.getErrno() == .INTR) continue;
            if (comptime Environment.allow_assert)
                log("unlinkat({}, {s}) = {d}", .{ dirfd, bun.sliceTo(to, 0), @intFromEnum(err.getErrno()) });
            return err;
        }
        if (comptime Environment.allow_assert)
            log("unlinkat({}, {s}) = 0", .{ dirfd, bun.sliceTo(to, 0) });
        return Maybe(void).success;
    }
    unreachable;
}

pub fn unlinkat(dirfd: bun.FileDescriptor, to: anytype) Maybe(void) {
    if (Environment.isWindows) {
        return unlinkatWithFlags(dirfd, to, 0);
    }
    while (true) {
        if (Maybe(void).errnoSysFP(syscall.unlinkat(dirfd.cast(), to, 0), .unlink, dirfd, to)) |err| {
            if (err.getErrno() == .INTR) continue;
            if (comptime Environment.allow_assert)
                log("unlinkat({}, {s}) = {d}", .{ dirfd, bun.sliceTo(to, 0), @intFromEnum(err.getErrno()) });
            return err;
        }
        if (comptime Environment.allow_assert)
            log("unlinkat({}, {s}) = 0", .{ dirfd, bun.sliceTo(to, 0) });
        return Maybe(void).success;
    }
}

pub fn getFdPath(fd: bun.FileDescriptor, out_buffer: *[MAX_PATH_BYTES]u8) Maybe([]u8) {
    switch (comptime builtin.os.tag) {
        .windows => {
            var wide_buf: [windows.PATH_MAX_WIDE]u16 = undefined;
            const wide_slice = bun.windows.GetFinalPathNameByHandle(fd.cast(), .{}, wide_buf[0..]) catch {
                return Maybe([]u8){ .err = .{ .errno = @intFromEnum(bun.C.SystemErrno.EBADF), .syscall = .GetFinalPathNameByHandle } };
            };

            // Trust that Windows gives us valid UTF-16LE.
            return .{ .result = @constCast(bun.strings.fromWPath(out_buffer, wide_slice)) };
        },
        .macos, .ios, .watchos, .tvos => {
            // On macOS, we can use F.GETPATH fcntl command to query the OS for
            // the path to the file descriptor.
            @memset(out_buffer[0..MAX_PATH_BYTES], 0);
            if (Maybe([]u8).errnoSys(syscall.fcntl(fd.cast(), posix.F.GETPATH, out_buffer), .fcntl)) |err| {
                return err;
            }
            const len = mem.indexOfScalar(u8, out_buffer[0..], @as(u8, 0)) orelse MAX_PATH_BYTES;
            return .{ .result = out_buffer[0..len] };
        },
        .linux => {
            // TODO: alpine linux may not have /proc/self
            var procfs_buf: ["/proc/self/fd/-2147483648".len + 1:0]u8 = undefined;
            const proc_path = std.fmt.bufPrintZ(&procfs_buf, "/proc/self/fd/{d}", .{fd.cast()}) catch unreachable;
            return switch (readlink(proc_path, out_buffer)) {
                .err => |err| return .{ .err = err },
                .result => |result| .{ .result = result },
            };
        },
        else => @compileError("querying for canonical path of a handle is unsupported on this host"),
    }
}

/// Use of a mapped region can result in these signals:
/// * SIGSEGV - Attempted write into a region mapped as read-only.
/// * SIGBUS - Attempted  access to a portion of the buffer that does not correspond to the file
pub fn mmap(
    ptr: ?[*]align(mem.page_size) u8,
    length: usize,
    prot: u32,
    flags: std.posix.MAP,
    fd: bun.FileDescriptor,
    offset: u64,
) Maybe([]align(mem.page_size) u8) {
    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    const rc = std.c.mmap(ptr, length, prot, flags, fd.cast(), ioffset);
    const fail = std.c.MAP_FAILED;
    if (rc == fail) {
        return Maybe([]align(mem.page_size) u8){
            .err = .{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(bun.C.getErrno(@as(i64, @bitCast(@intFromPtr(fail))))))), .syscall = .mmap },
        };
    }

    return Maybe([]align(mem.page_size) u8){ .result = @as([*]align(mem.page_size) u8, @ptrCast(@alignCast(rc)))[0..length] };
}

pub fn mmapFile(path: [:0]const u8, flags: std.c.MAP, wanted_size: ?usize, offset: usize) Maybe([]align(mem.page_size) u8) {
    assertIsValidWindowsPath(u8, path);
    const fd = switch (open(path, bun.O.RDWR, 0)) {
        .result => |fd| fd,
        .err => |err| return .{ .err = err },
    };

    var size = std.math.sub(usize, @as(usize, @intCast(switch (fstat(fd)) {
        .result => |result| result.size,
        .err => |err| {
            _ = close(fd);
            return .{ .err = err };
        },
    })), offset) catch 0;

    if (wanted_size) |size_| size = @min(size, size_);

    const map = switch (mmap(null, size, posix.PROT.READ | posix.PROT.WRITE, flags, fd, offset)) {
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

pub fn setCloseOnExec(fd: bun.FileDescriptor) Maybe(void) {
    switch (fcntl(fd, std.posix.F.GETFD, 0)) {
        .result => |fl| {
            switch (fcntl(fd, std.posix.F.SETFD, fl | std.posix.FD_CLOEXEC)) {
                .result => {},
                .err => |err| return .{ .err = err },
            }
        },
        .err => |err| return .{ .err = err },
    }

    return .{ .result = {} };
}

pub fn setsockopt(fd: bun.FileDescriptor, level: c_int, optname: u32, value: i32) Maybe(i32) {
    while (true) {
        const rc = syscall.setsockopt(fd.cast(), level, optname, &value, @sizeOf(i32));
        if (Maybe(i32).errnoSysFd(rc, .setsockopt, fd)) |err| {
            if (err.getErrno() == .INTR) continue;
            log("setsockopt() = {d} {s}", .{ err.err.errno, err.err.name() });
            return err;
        }
        log("setsockopt({d}, {d}, {d}) = {d}", .{ fd.cast(), level, optname, rc });
        return .{ .result = @intCast(rc) };
    }

    unreachable;
}

pub fn setNoSigpipe(fd: bun.FileDescriptor) Maybe(void) {
    if (comptime Environment.isMac) {
        return switch (setsockopt(fd, std.posix.SOL.SOCKET, std.posix.SO.NOSIGPIPE, 1)) {
            .result => .{ .result = {} },
            .err => |err| .{ .err = err },
        };
    }

    return .{ .result = {} };
}

const socketpair_t = if (Environment.isLinux) i32 else c_uint;

/// libc socketpair() except it defaults to:
/// - SOCK_CLOEXEC on Linux
/// - SO_NOSIGPIPE on macOS
///
/// On POSIX it otherwise makes it do O_CLOEXEC.
pub fn socketpair(domain: socketpair_t, socktype: socketpair_t, protocol: socketpair_t, nonblocking_status: enum { blocking, nonblocking }) Maybe([2]bun.FileDescriptor) {
    if (comptime !Environment.isPosix) @compileError("linux only!");

    var fds_i: [2]syscall.fd_t = .{ 0, 0 };

    if (comptime Environment.isLinux) {
        while (true) {
            const nonblock_flag: i32 = if (nonblocking_status == .nonblocking) linux.SOCK.NONBLOCK else 0;
            const rc = std.os.linux.socketpair(domain, socktype | linux.SOCK.CLOEXEC | nonblock_flag, protocol, &fds_i);
            if (Maybe([2]bun.FileDescriptor).errnoSys(rc, .socketpair)) |err| {
                if (err.getErrno() == .INTR) continue;

                log("socketpair() = {d} {s}", .{ err.err.errno, err.err.name() });
                return err;
            }

            break;
        }
    } else {
        while (true) {
            const err = libc.socketpair(domain, socktype, protocol, &fds_i);

            if (Maybe([2]bun.FileDescriptor).errnoSys(err, .socketpair)) |err2| {
                if (err2.getErrno() == .INTR) continue;
                log("socketpair() = {d} {s}", .{ err2.err.errno, err2.err.name() });
                return err2;
            }

            break;
        }

        const err: ?Syscall.Error = err: {

            // Set O_CLOEXEC first.
            inline for (0..2) |i| {
                switch (setCloseOnExec(bun.toFD(fds_i[i]))) {
                    .err => |err| break :err err,
                    .result => {},
                }
            }

            if (comptime Environment.isMac) {
                inline for (0..2) |i| {
                    switch (setNoSigpipe(bun.toFD(fds_i[i]))) {
                        .err => |err| break :err err,
                        else => {},
                    }
                }
            }

            if (nonblocking_status == .nonblocking) {
                inline for (0..2) |i| {
                    switch (setNonblocking(bun.toFD(fds_i[i]))) {
                        .err => |err| break :err err,
                        .result => {},
                    }
                }
            }

            break :err null;
        };

        // On any error after socketpair(), we need to close it.
        if (err) |errr| {
            inline for (0..2) |i| {
                _ = close(bun.toFD(fds_i[i]));
            }

            log("socketpair() = {d} {s}", .{ errr.errno, errr.name() });

            return .{ .err = errr };
        }
    }

    log("socketpair() = [{d} {d}]", .{ fds_i[0], fds_i[1] });

    return Maybe([2]bun.FileDescriptor){ .result = .{ bun.toFD(fds_i[0]), bun.toFD(fds_i[1]) } };
}

pub fn munmap(memory: []align(mem.page_size) const u8) Maybe(void) {
    if (Maybe(void).errnoSys(syscall.munmap(memory.ptr, memory.len), .munmap)) |err| {
        return err;
    } else return Maybe(void).success;
}

pub fn memfd_create(name: [:0]const u8, flags: u32) Maybe(bun.FileDescriptor) {
    if (comptime !Environment.isLinux) @compileError("linux only!");

    const rc = std.os.linux.memfd_create(name, flags);

    log("memfd_create({s}, {d}) = {d}", .{ name, flags, rc });

    return Maybe(bun.FileDescriptor).errnoSys(rc, .memfd_create) orelse
        .{ .result = bun.toFD(@as(c_int, @intCast(rc))) };
}

pub fn setPipeCapacityOnLinux(fd: bun.FileDescriptor, capacity: usize) Maybe(usize) {
    if (comptime !Environment.isLinux) @compileError("Linux-only");
    bun.assert(capacity > 0);

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
    const pipe_len = std.os.linux.fcntl(fd.cast(), F_GETPIPE_SZ, 0);
    if (Maybe(usize).errnoSysFd(pipe_len, .fcntl, fd)) |err| return err;
    if (pipe_len == 0) return Maybe(usize){ .result = 0 };
    if (pipe_len >= capacity) return Maybe(usize){ .result = pipe_len };

    const new_pipe_len = std.os.linux.fcntl(fd.cast(), F_SETPIPE_SZ, capacity);
    if (Maybe(usize).errnoSysFd(new_pipe_len, .fcntl, fd)) |err| return err;
    return Maybe(usize){ .result = new_pipe_len };
}

pub fn getMaxPipeSizeOnLinux() usize {
    return @as(
        usize,
        @intCast(bun.once(struct {
            fn once() c_int {
                const strings = bun.strings;
                const default_out_size = 512 * 1024;
                const pipe_max_size_fd = switch (bun.sys.open("/proc/sys/fs/pipe-max-size", bun.O.RDONLY, 0)) {
                    .result => |fd2| fd2,
                    .err => |err| {
                        log("Failed to open /proc/sys/fs/pipe-max-size: {d}\n", .{err.errno});
                        return default_out_size;
                    },
                };
                defer _ = bun.sys.close(pipe_max_size_fd);
                var max_pipe_size_buf: [128]u8 = undefined;
                const max_pipe_size = switch (bun.sys.read(pipe_max_size_fd, max_pipe_size_buf[0..])) {
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
                return @min(@as(c_int, @truncate(max_pipe_size -| 32)), 1024 * 1024 * 8);
            }
        }.once, c_int)),
    );
}

pub const WindowsFileAttributes = packed struct(windows.DWORD) {
    //1 0x00000001 FILE_ATTRIBUTE_READONLY
    is_readonly: bool,
    //2 0x00000002 FILE_ATTRIBUTE_HIDDEN
    is_hidden: bool,
    //4 0x00000004 FILE_ATTRIBUTE_SYSTEM
    is_system: bool,
    //8
    _03: bool,
    //1 0x00000010 FILE_ATTRIBUTE_DIRECTORY
    is_directory: bool,
    //2 0x00000020 FILE_ATTRIBUTE_ARCHIVE
    is_archive: bool,
    //4 0x00000040 FILE_ATTRIBUTE_DEVICE
    is_device: bool,
    //8 0x00000080 FILE_ATTRIBUTE_NORMAL
    is_normal: bool,
    //1 0x00000100 FILE_ATTRIBUTE_TEMPORARY
    is_temporary: bool,
    //2 0x00000200 FILE_ATTRIBUTE_SPARSE_FILE
    is_sparse_file: bool,
    //4 0x00000400 FILE_ATTRIBUTE_REPARSE_POINT
    is_reparse_point: bool,
    //8 0x00000800 FILE_ATTRIBUTE_COMPRESSED
    is_compressed: bool,
    //1 0x00001000 FILE_ATTRIBUTE_OFFLINE
    is_offline: bool,
    //2 0x00002000 FILE_ATTRIBUTE_NOT_CONTENT_INDEXED
    is_not_content_indexed: bool,
    //4 0x00004000 FILE_ATTRIBUTE_ENCRYPTED
    is_encrypted: bool,
    //8 0x00008000 FILE_ATTRIBUTE_INTEGRITY_STREAM
    is_integrity_stream: bool,
    //1 0x00010000 FILE_ATTRIBUTE_VIRTUAL
    is_virtual: bool,
    //2 0x00020000 FILE_ATTRIBUTE_NO_SCRUB_DATA
    is_no_scrub_data: bool,
    //4 0x00040000 FILE_ATTRIBUTE_EA
    is_ea: bool,
    //8 0x00080000 FILE_ATTRIBUTE_PINNED
    is_pinned: bool,
    //1 0x00100000 FILE_ATTRIBUTE_UNPINNED
    is_unpinned: bool,
    //2
    _21: bool,
    //4 0x00040000 FILE_ATTRIBUTE_RECALL_ON_OPEN
    is_recall_on_open: bool,
    //8
    _23: bool,
    //1
    _24: bool,
    //2
    _25: bool,
    //4 0x00400000 FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
    is_recall_on_data_access: bool,
    //
    __: u5,
};

pub fn getFileAttributes(path: anytype) ?WindowsFileAttributes {
    if (comptime !Environment.isWindows) @compileError("Windows only");

    const T = std.meta.Child(@TypeOf(path));
    if (T == u16) {
        assertIsValidWindowsPath(bun.OSPathChar, path);
        const dword = kernel32.GetFileAttributesW(path.ptr);
        if (comptime Environment.isDebug) {
            log("GetFileAttributesW({}) = {d}", .{ bun.fmt.utf16(path), dword });
        }
        if (dword == windows.INVALID_FILE_ATTRIBUTES) {
            return null;
        }
        const attributes: WindowsFileAttributes = @bitCast(dword);
        return attributes;
    } else {
        const wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        const path_to_use = bun.strings.toWPath(wbuf, path);
        return getFileAttributes(path_to_use);
    }
}

pub fn existsOSPath(path: bun.OSPathSliceZ, file_only: bool) bool {
    if (comptime Environment.isPosix) {
        return syscall.access(path, 0) == 0;
    }

    if (comptime Environment.isWindows) {
        const attributes = getFileAttributes(path) orelse return false;

        if (file_only and attributes.is_directory) {
            return false;
        }

        return true;
    }

    @compileError("TODO: existsOSPath");
}

pub fn exists(path: []const u8) bool {
    if (comptime Environment.isPosix) {
        return syscall.access(&(std.posix.toPosixPath(path) catch return false), 0) == 0;
    }

    if (comptime Environment.isWindows) {
        return getFileAttributes(path) != null;
    }

    @compileError("TODO: existsOSPath");
}

pub fn existsZ(path: [:0]const u8) bool {
    if (comptime Environment.isPosix) {
        return syscall.access(path, 0) == 0;
    }

    if (comptime Environment.isWindows) {
        return getFileAttributes(path) != null;
    }
}

pub fn faccessat(dir_: anytype, subpath: anytype) JSC.Maybe(bool) {
    const has_sentinel = std.meta.sentinel(@TypeOf(subpath)) != null;
    const dir_fd = bun.toFD(dir_);

    if (comptime !has_sentinel) {
        const path = std.os.toPosixPath(subpath) catch return JSC.Maybe(bool){ .err = Error.fromCode(.NAMETOOLONG, .access) };
        return faccessat(dir_fd, path);
    }

    if (comptime Environment.isLinux) {
        // avoid loading the libc symbol for this to reduce chances of GLIBC minimum version requirements
        const rc = linux.faccessat(dir_fd.cast(), subpath, linux.F_OK, 0);
        syslog("faccessat({}, {}, O_RDONLY, 0) = {d}", .{ dir_fd, bun.fmt.fmtOSPath(subpath, .{}), if (rc == 0) 0 else @intFromEnum(bun.C.getErrno(rc)) });
        if (rc == 0) {
            return JSC.Maybe(bool){ .result = true };
        }

        return JSC.Maybe(bool){ .result = false };
    }

    // on other platforms use faccessat from libc
    const rc = std.c.faccessat(dir_fd.cast(), subpath, std.posix.F_OK, 0);
    syslog("faccessat({}, {}, O_RDONLY, 0) = {d}", .{ dir_fd, bun.fmt.fmtOSPath(subpath, .{}), if (rc == 0) 0 else @intFromEnum(bun.C.getErrno(rc)) });
    if (rc == 0) {
        return JSC.Maybe(bool){ .result = true };
    }

    return JSC.Maybe(bool){ .result = false };
}

pub fn directoryExistsAt(dir_: anytype, subpath: anytype) JSC.Maybe(bool) {
    const dir_fd = bun.toFD(dir_);
    if (comptime Environment.isWindows) {
        const wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        const path = bun.strings.toNTPath(wbuf, subpath);
        const path_len_bytes: u16 = @truncate(path.len * 2);
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = @constCast(path.ptr),
        };
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(path))
                null
            else if (dir_fd == bun.invalid_fd)
                std.fs.cwd().fd
            else
                dir_fd.cast(),
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        var basic_info: w.FILE_BASIC_INFORMATION = undefined;
        const rc = kernel32.NtQueryAttributesFile(&attr, &basic_info);
        if (JSC.Maybe(bool).errnoSysP(rc, .access, subpath)) |err| {
            syslog("NtQueryAttributesFile({}, {}, O_DIRECTORY | O_RDONLY, 0) = {}", .{ dir_fd, bun.fmt.fmtOSPath(path, .{}), err });
            return err;
        }

        const is_dir = basic_info.FileAttributes != kernel32.INVALID_FILE_ATTRIBUTES and
            basic_info.FileAttributes & kernel32.FILE_ATTRIBUTE_DIRECTORY != 0 and
            basic_info.FileAttributes & kernel32.FILE_ATTRIBUTE_READONLY == 0;
        syslog("NtQueryAttributesFile({}, {}, O_DIRECTORY | O_RDONLY, 0) = {d}", .{ dir_fd, bun.fmt.fmtOSPath(path, .{}), @intFromBool(is_dir) });

        return .{
            .result = is_dir,
        };
    }

    return faccessat(dir_fd, subpath);
}

pub fn setNonblocking(fd: bun.FileDescriptor) Maybe(void) {
    const flags = switch (bun.sys.fcntl(
        fd,
        std.posix.F.GETFL,
        0,
    )) {
        .result => |f| f,
        .err => |err| return .{ .err = err },
    };

    const new_flags = flags | bun.O.NONBLOCK;

    switch (bun.sys.fcntl(fd, std.posix.F.SETFL, new_flags)) {
        .err => |err| return .{ .err = err },
        .result => {},
    }

    return Maybe(void).success;
}

pub fn existsAt(fd: bun.FileDescriptor, subpath: [:0]const u8) bool {
    if (comptime Environment.isPosix) {
        return faccessat(fd, subpath).result;
    }

    if (comptime Environment.isWindows) {
        const wbuf = bun.WPathBufferPool.get();
        defer bun.WPathBufferPool.put(wbuf);
        const path = bun.strings.toNTPath(wbuf, subpath);
        const path_len_bytes: u16 = @truncate(path.len * 2);
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = @constCast(path.ptr),
        };
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(path))
                null
            else if (fd == bun.invalid_fd)
                std.fs.cwd().fd
            else
                fd.cast(),
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        var basic_info: w.FILE_BASIC_INFORMATION = undefined;
        const rc = kernel32.NtQueryAttributesFile(&attr, &basic_info);
        if (JSC.Maybe(bool).errnoSysP(rc, .access, subpath)) |err| {
            syslog("NtQueryAttributesFile({}, O_RDONLY, 0) = {}", .{ bun.fmt.fmtOSPath(path, .{}), err });
            return false;
        }

        const is_regular_file = basic_info.FileAttributes != kernel32.INVALID_FILE_ATTRIBUTES and
            // from libuv: directories cannot be read-only
            // https://github.com/libuv/libuv/blob/eb5af8e3c0ea19a6b0196d5db3212dae1785739b/src/win/fs.c#L2144-L2146
            (basic_info.FileAttributes & kernel32.FILE_ATTRIBUTE_DIRECTORY == 0 or
            basic_info.FileAttributes & kernel32.FILE_ATTRIBUTE_READONLY == 0);
        syslog("NtQueryAttributesFile({}, O_RDONLY, 0) = {d}", .{ bun.fmt.fmtOSPath(path, .{}), @intFromBool(is_regular_file) });

        return is_regular_file;
    }

    @compileError("TODO: existsAtOSPath");
}

pub extern "C" fn is_executable_file(path: [*:0]const u8) bool;

pub fn isExecutableFileOSPath(path: bun.OSPathSliceZ) bool {
    if (comptime Environment.isPosix) {
        return is_executable_file(path);
    }

    if (comptime Environment.isWindows) {
        // Rationale: `GetBinaryTypeW` does not work on .cmd files.
        // Windows does not have executable permission like posix does, instead we
        // can just look at the file extension to determine executable status.
        @compileError("Do not use isExecutableFilePath on Windows");

        // var out: windows.DWORD = 0;
        // const rc = kernel32.GetBinaryTypeW(path, &out);

        // const result = if (rc == windows.FALSE)
        //     false
        // else switch (out) {
        //     kernel32.SCS_32BIT_BINARY,
        //     kernel32.SCS_64BIT_BINARY,
        //     kernel32.SCS_DOS_BINARY,
        //     kernel32.SCS_OS216_BINARY,
        //     kernel32.SCS_PIF_BINARY,
        //     kernel32.SCS_POSIX_BINARY,
        //     => true,
        //     else => false,
        // };

        // log("GetBinaryTypeW({}) = {d}. isExecutable={}", .{ bun.fmt.utf16(path), out, result });

        // return result;
    }

    @compileError("TODO: isExecutablePath");
}

pub fn isExecutableFilePath(path: anytype) bool {
    const Type = @TypeOf(path);
    if (comptime Environment.isPosix) {
        switch (Type) {
            *[*:0]const u8, *[*:0]u8, [*:0]const u8, [*:0]u8 => return is_executable_file(path),
            [:0]const u8, [:0]u8 => return is_executable_file(path.ptr),
            []const u8, []u8 => return is_executable_file(
                &(std.posix.toPosixPath(path) catch return false),
            ),
            else => @compileError("TODO: isExecutableFilePath"),
        }
    }

    if (comptime Environment.isWindows) {
        var buf: [(bun.MAX_PATH_BYTES / 2) + 1]u16 = undefined;
        return isExecutableFileOSPath(bun.strings.toWPath(&buf, path));
    }

    @compileError("TODO: isExecutablePath");
}

pub fn setFileOffset(fd: bun.FileDescriptor, offset: usize) Maybe(void) {
    if (comptime Environment.isLinux) {
        return Maybe(void).errnoSysFd(
            linux.lseek(fd.cast(), @intCast(offset), posix.SEEK.SET),
            .lseek,
            fd,
        ) orelse Maybe(void).success;
    }

    if (comptime Environment.isMac) {
        return Maybe(void).errnoSysFd(
            std.c.lseek(fd.cast(), @intCast(offset), posix.SEEK.SET),
            .lseek,
            fd,
        ) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        const offset_high: u64 = @as(u32, @intCast(offset >> 32));
        const offset_low: u64 = @as(u32, @intCast(offset & 0xFFFFFFFF));
        var plarge_integer: i64 = @bitCast(offset_high);
        const rc = kernel32.SetFilePointerEx(
            fd.cast(),
            @as(windows.LARGE_INTEGER, @bitCast(offset_low)),
            &plarge_integer,
            windows.FILE_BEGIN,
        );
        if (rc == windows.FALSE) {
            return Maybe(void).errnoSysFd(0, .lseek, fd) orelse Maybe(void).success;
        }
        return Maybe(void).success;
    }
}

pub fn setFileOffsetToEndWindows(fd: bun.FileDescriptor) Maybe(usize) {
    if (comptime Environment.isWindows) {
        var new_ptr: std.os.windows.LARGE_INTEGER = undefined;
        const rc = kernel32.SetFilePointerEx(fd.cast(), 0, &new_ptr, windows.FILE_END);
        if (rc == windows.FALSE) {
            return Maybe(usize).errnoSysFd(0, .lseek, fd) orelse Maybe(usize){ .result = 0 };
        }
        return Maybe(usize){ .result = @intCast(new_ptr) };
    }
    @compileError("Not Implemented");
}

extern fn Bun__disableSOLinger(fd: if (Environment.isWindows) windows.HANDLE else i32) void;
pub fn disableLinger(fd: bun.FileDescriptor) void {
    Bun__disableSOLinger(fd.cast());
}

pub fn pipe() Maybe([2]bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        @panic("TODO: Implement `pipe()` for Windows");
    }

    var fds: [2]i32 = undefined;
    const rc = syscall.pipe(&fds);
    if (Maybe([2]bun.FileDescriptor).errnoSys(rc, .pipe)) |err| {
        return err;
    }
    log("pipe() = [{d}, {d}]", .{ fds[0], fds[1] });
    return .{ .result = .{ bun.toFD(fds[0]), bun.toFD(fds[1]) } };
}

pub fn openNullDevice() Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        return sys_uv.open("nul", 0, 0);
    }

    return open("/dev/null", bun.O.RDWR, 0);
}

pub fn dupWithFlags(fd: bun.FileDescriptor, flags: i32) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        var target: windows.HANDLE = undefined;
        const process = kernel32.GetCurrentProcess();
        const out = kernel32.DuplicateHandle(
            process,
            fd.cast(),
            process,
            &target,
            0,
            w.TRUE,
            w.DUPLICATE_SAME_ACCESS,
        );
        if (out == 0) {
            if (Maybe(bun.FileDescriptor).errnoSysFd(0, .dup, fd)) |err| {
                log("dup({}) = {}", .{ fd, err });
                return err;
            }
        }
        log("dup({}) = {}", .{ fd, bun.toFD(target) });
        return Maybe(bun.FileDescriptor){ .result = bun.toFD(target) };
    }

    const ArgType = if (comptime Environment.isLinux) usize else c_int;
    const out = syscall.fcntl(fd.cast(), @as(i32, bun.C.F.DUPFD_CLOEXEC), @as(ArgType, 0));
    log("dup({d}) = {d}", .{ fd.cast(), out });
    if (Maybe(bun.FileDescriptor).errnoSysFd(out, .dup, fd)) |err| {
        return err;
    }

    if (flags != 0) {
        const fd_flags: ArgType = @intCast(syscall.fcntl(@intCast(out), @as(i32, std.posix.F.GETFD), @as(ArgType, 0)));
        _ = syscall.fcntl(@intCast(out), @as(i32, std.posix.F.SETFD), @as(ArgType, @intCast(fd_flags | @as(ArgType, @intCast(flags)))));
    }

    return Maybe(bun.FileDescriptor){
        .result = bun.toFD(@as(u32, @intCast(out))),
    };
}

pub fn dup(fd: bun.FileDescriptor) Maybe(bun.FileDescriptor) {
    return dupWithFlags(fd, 0);
}

pub fn linkat(dir_fd: bun.FileDescriptor, basename: []const u8, dest_dir_fd: bun.FileDescriptor, dest_name: []const u8) Maybe(void) {
    return Maybe(void).errnoSysP(
        std.c.linkat(
            @intCast(dir_fd),
            &(std.posix.toPosixPath(basename) catch return .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.NOMEM),
                    .syscall = .open,
                },
            }),
            @intCast(dest_dir_fd),
            &(std.posix.toPosixPath(dest_name) catch return .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.NOMEM),
                    .syscall = .open,
                },
            }),
            0,
        ),
        .link,
        basename,
    ) orelse Maybe(void).success;
}

pub fn linkatTmpfile(tmpfd: bun.FileDescriptor, dirfd: bun.FileDescriptor, name: [:0]const u8) Maybe(void) {
    if (comptime !Environment.isLinux) {
        @compileError("Linux only.");
    }

    const CAP_DAC_READ_SEARCH = struct {
        pub var status = std.atomic.Value(i32).init(0);
    };

    while (true) {
        // This is racy but it's fine if we call linkat() with an empty path multiple times.
        const current_status = CAP_DAC_READ_SEARCH.status.load(.monotonic);

        const rc = if (current_status != -1) std.os.linux.linkat(
            tmpfd.cast(),
            "",
            dirfd.cast(),
            name,
            posix.AT.EMPTY_PATH,
        ) else brk: {
            //
            // snprintf(path, PATH_MAX,  "/proc/self/fd/%d", fd);
            // linkat(AT_FDCWD, path, AT_FDCWD, "/path/for/file",
            //        AT_SYMLINK_FOLLOW);
            //
            var procfs_buf: ["/proc/self/fd/-2147483648".len + 1:0]u8 = undefined;
            const path = std.fmt.bufPrintZ(&procfs_buf, "/proc/self/fd/{d}", .{tmpfd.cast()}) catch unreachable;

            break :brk std.os.linux.linkat(
                posix.AT.FDCWD,
                path,
                dirfd.cast(),
                name,
                posix.AT.SYMLINK_FOLLOW,
            );
        };

        if (Maybe(void).errnoSysFd(rc, .link, tmpfd)) |err| {
            switch (err.getErrno()) {
                .INTR => continue,
                .ISDIR, .NOENT, .OPNOTSUPP, .PERM, .INVAL => {
                    // CAP_DAC_READ_SEARCH is required to linkat with an empty path.
                    if (current_status == 0) {
                        CAP_DAC_READ_SEARCH.status.store(-1, .monotonic);
                        continue;
                    }
                },
                else => {},
            }

            return err;
        }

        if (current_status == 0) {
            CAP_DAC_READ_SEARCH.status.store(1, .monotonic);
        }

        return Maybe(void).success;
    }
}

/// On Linux, this `preadv2(2)` to attempt to read a blocking file descriptor without blocking.
///
/// On other platforms, this is just a wrapper around `read(2)`.
pub fn readNonblocking(fd: bun.FileDescriptor, buf: []u8) Maybe(usize) {
    if (Environment.isLinux) {
        while (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
            const iovec = [1]std.posix.iovec{.{
                .base = buf.ptr,
                .len = buf.len,
            }};
            var debug_timer = bun.Output.DebugTimer.start();

            // Note that there is a bug on Linux Kernel 5
            const rc = C.sys_preadv2(@intCast(fd.int()), &iovec, 1, -1, std.os.linux.RWF.NOWAIT);

            if (comptime Environment.isDebug) {
                log("preadv2({}, {d}) = {d} ({})", .{ fd, buf.len, rc, debug_timer });

                if (debug_timer.timer.read() > std.time.ns_per_ms) {
                    bun.Output.debugWarn("preadv2({}, {d}) blocked for {}", .{ fd, buf.len, debug_timer });
                }
            }

            if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                switch (err.getErrno()) {
                    .OPNOTSUPP, .NOSYS => {
                        bun.C.linux.RWFFlagSupport.disable();
                        switch (bun.isReadable(fd)) {
                            .hup, .ready => return read(fd, buf),
                            else => return .{ .err = Error.retry },
                        }
                    },
                    .INTR => continue,
                    else => return err,
                }
            }

            return .{ .result = @as(usize, @intCast(rc)) };
        }
    }

    return read(fd, buf);
}

/// On Linux, this `pwritev(2)` to attempt to read a blocking file descriptor without blocking.
///
/// On other platforms, this is just a wrapper around `read(2)`.
pub fn writeNonblocking(fd: bun.FileDescriptor, buf: []const u8) Maybe(usize) {
    if (Environment.isLinux) {
        while (bun.C.linux.RWFFlagSupport.isMaybeSupported()) {
            const iovec = [1]std.posix.iovec_const{.{
                .base = buf.ptr,
                .len = buf.len,
            }};

            var debug_timer = bun.Output.DebugTimer.start();

            const rc = C.sys_pwritev2(@intCast(fd.int()), &iovec, 1, -1, std.os.linux.RWF.NOWAIT);

            if (comptime Environment.isDebug) {
                log("pwritev2({}, {d}) = {d} ({})", .{ fd, buf.len, rc, debug_timer });

                if (debug_timer.timer.read() > std.time.ns_per_ms) {
                    bun.Output.debugWarn("pwritev2({}, {d}) blocked for {}", .{ fd, buf.len, debug_timer });
                }
            }

            if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                switch (err.getErrno()) {
                    .OPNOTSUPP, .NOSYS => {
                        bun.C.linux.RWFFlagSupport.disable();
                        switch (bun.isWritable(fd)) {
                            .hup, .ready => return write(fd, buf),
                            else => return .{ .err = Error.retry },
                        }
                    },
                    .INTR => continue,
                    else => return err,
                }
            }

            return .{ .result = @as(usize, @intCast(rc)) };
        }
    }

    return write(fd, buf);
}

pub fn getFileSize(fd: bun.FileDescriptor) Maybe(usize) {
    if (Environment.isWindows) {
        var size: windows.LARGE_INTEGER = undefined;
        if (windows.GetFileSizeEx(fd.cast(), &size) == windows.FALSE) {
            const err = Error.fromCode(windows.getLastErrno(), .fstat);
            log("GetFileSizeEx({}) = {s}", .{ fd, err.name() });
            return .{ .err = err };
        }
        log("GetFileSizeEx({}) = {d}", .{ fd, size });
        return .{ .result = @intCast(@max(size, 0)) };
    }

    switch (fstat(fd)) {
        .result => |*stat_| {
            return .{ .result = @intCast(@max(stat_.size, 0)) };
        },
        .err => |err| {
            return .{ .err = err };
        },
    }
}

pub fn isPollable(mode: mode_t) bool {
    return posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode);
}

const This = @This();

pub const File = struct {
    // "handle" matches std.fs.File
    handle: bun.FileDescriptor,

    pub fn openat(other: anytype, path: [:0]const u8, flags: bun.Mode, mode: bun.Mode) Maybe(File) {
        return switch (This.openat(bun.toFD(other), path, flags, mode)) {
            .result => |fd| .{ .result = .{ .handle = fd } },
            .err => |err| .{ .err = err },
        };
    }

    pub fn open(path: [:0]const u8, flags: bun.Mode, mode: bun.Mode) Maybe(File) {
        return File.openat(bun.FD.cwd(), path, flags, mode);
    }

    pub fn openatOSPath(other: anytype, path: bun.OSPathSliceZ, flags: bun.Mode, mode: bun.Mode) Maybe(File) {
        return switch (This.openatOSPath(bun.toFD(other), path, flags, mode)) {
            .result => |fd| .{ .result = .{ .handle = fd } },
            .err => |err| .{ .err = err },
        };
    }

    pub fn from(other: anytype) File {
        const T = @TypeOf(other);

        if (T == File) {
            return other;
        }

        if (T == std.posix.fd_t) {
            return File{ .handle = bun.toFD(other) };
        }

        if (T == bun.FileDescriptor) {
            return File{ .handle = other };
        }

        if (T == std.fs.File) {
            return File{ .handle = bun.toFD(other.handle) };
        }

        if (T == std.fs.Dir) {
            return File{ .handle = bun.toFD(other.fd) };
        }

        if (comptime Environment.isWindows) {
            if (T == bun.windows.HANDLE) {
                return File{ .handle = bun.toFD(other) };
            }
        }

        if (comptime Environment.isLinux) {
            if (T == u64) {
                return File{ .handle = bun.toFD(other) };
            }
        }

        @compileError("Unsupported type " ++ bun.meta.typeName(T));
    }

    pub fn write(self: File, buf: []const u8) Maybe(usize) {
        return This.write(self.handle, buf);
    }

    pub fn read(self: File, buf: []u8) Maybe(usize) {
        return This.read(self.handle, buf);
    }

    pub fn writeAll(self: File, buf: []const u8) Maybe(void) {
        var remain = buf;
        while (remain.len > 0) {
            const rc = This.write(self.handle, remain);
            switch (rc) {
                .err => |err| return .{ .err = err },
                .result => |amt| {
                    if (amt == 0) {
                        return .{ .result = {} };
                    }
                    remain = remain[amt..];
                },
            }
        }

        return .{ .result = {} };
    }

    pub fn writeFile(
        relative_dir_or_cwd: anytype,
        path: bun.OSPathSliceZ,
        data: []const u8,
    ) Maybe(void) {
        const file = switch (File.openatOSPath(relative_dir_or_cwd, path, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
            .err => |err| return .{ .err = err },
            .result => |fd| fd,
        };
        defer file.close();
        switch (file.writeAll(data)) {
            .err => |err| return .{ .err = err },
            .result => {},
        }
        return .{ .result = {} };
    }

    pub const ReadError = anyerror;

    pub fn closeAndMoveTo(this: File, src: [:0]const u8, dest: [:0]const u8) !void {
        // On POSIX, close the file after moving it.
        defer if (Environment.isPosix) this.close();
        // On Windows, close the file before moving it.
        if (Environment.isWindows) this.close();
        try bun.C.moveFileZWithHandle(this.handle, bun.toFD(std.fs.cwd()), src, bun.toFD(std.fs.cwd()), dest);
    }

    fn stdIoRead(this: File, buf: []u8) ReadError!usize {
        return try this.read(buf).unwrap();
    }

    pub const Reader = std.io.Reader(File, anyerror, stdIoRead);

    pub fn reader(self: File) Reader {
        return Reader{ .context = self };
    }

    pub const WriteError = anyerror;
    fn stdIoWrite(this: File, bytes: []const u8) WriteError!usize {
        try this.writeAll(bytes).unwrap();

        return bytes.len;
    }

    fn stdIoWriteQuietDebug(this: File, bytes: []const u8) WriteError!usize {
        bun.Output.disableScopedDebugWriter();
        defer bun.Output.enableScopedDebugWriter();
        try this.writeAll(bytes).unwrap();

        return bytes.len;
    }

    pub const Writer = std.io.Writer(File, anyerror, stdIoWrite);
    pub const QuietWriter = if (Environment.isDebug) std.io.Writer(File, anyerror, stdIoWriteQuietDebug) else Writer;

    pub fn writer(self: File) Writer {
        return Writer{ .context = self };
    }

    pub fn quietWriter(self: File) QuietWriter {
        return QuietWriter{ .context = self };
    }

    pub fn isTty(self: File) bool {
        return std.posix.isatty(self.handle.cast());
    }

    pub fn close(self: File) void {
        // TODO: probably return the error? we have a lot of code paths which do not so we are keeping for now
        _ = This.close(self.handle);
    }

    pub fn getEndPos(self: File) Maybe(usize) {
        return getFileSize(self.handle);
    }

    pub fn stat(self: File) Maybe(bun.Stat) {
        return fstat(self.handle);
    }

    /// Be careful about using this on Linux or macOS.
    ///
    /// This calls stat() internally.
    pub fn kind(self: File) Maybe(std.fs.File.Kind) {
        if (Environment.isWindows) {
            const rt = windows.GetFileType(self.handle.cast());
            if (rt == windows.FILE_TYPE_UNKNOWN) {
                switch (bun.windows.GetLastError()) {
                    .SUCCESS => {},
                    else => |err| {
                        return .{ .err = Error.fromCode((bun.C.SystemErrno.init(err) orelse bun.C.SystemErrno.EUNKNOWN).toE(), .fstat) };
                    },
                }
            }

            return .{
                .result = switch (rt) {
                    windows.FILE_TYPE_CHAR => .character_device,
                    windows.FILE_TYPE_REMOTE, windows.FILE_TYPE_DISK => .file,
                    windows.FILE_TYPE_PIPE => .named_pipe,
                    windows.FILE_TYPE_UNKNOWN => .unknown,
                    else => .file,
                },
            };
        }

        const st = switch (self.stat()) {
            .err => |err| return .{ .err = err },
            .result => |s| s,
        };

        const m = st.mode & posix.S.IFMT;
        switch (m) {
            posix.S.IFBLK => return .{ .result = .block_device },
            posix.S.IFCHR => return .{ .result = .character_device },
            posix.S.IFDIR => return .{ .result = .directory },
            posix.S.IFIFO => return .{ .result = .named_pipe },
            posix.S.IFLNK => return .{ .result = .sym_link },
            posix.S.IFREG => return .{ .result = .file },
            posix.S.IFSOCK => return .{ .result = .unix_domain_socket },
            else => {
                return .{ .result = .file };
            },
        }
    }

    pub const ReadToEndResult = struct {
        bytes: std.ArrayList(u8) = std.ArrayList(u8).init(default_allocator),
        err: ?Error = null,

        pub fn unwrap(self: *const ReadToEndResult) ![]u8 {
            if (self.err) |err| {
                try (JSC.Maybe(void){ .err = err }).unwrap();
            }
            return self.bytes.items;
        }
    };

    pub fn readFillBuf(this: File, buf: []u8) Maybe([]u8) {
        var read_amount: usize = 0;
        while (read_amount < buf.len) {
            switch (if (comptime Environment.isPosix)
                bun.sys.pread(this.handle, buf[read_amount..], @intCast(read_amount))
            else
                bun.sys.read(this.handle, buf[read_amount..])) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => |bytes_read| {
                    if (bytes_read == 0) {
                        break;
                    }

                    read_amount += bytes_read;
                },
            }
        }

        return .{ .result = buf[0..read_amount] };
    }

    pub fn readToEndWithArrayList(this: File, list: *std.ArrayList(u8), probably_small: bool) Maybe(usize) {
        if (probably_small) {
            list.ensureUnusedCapacity(64) catch bun.outOfMemory();
        } else {
            list.ensureTotalCapacityPrecise(
                switch (this.getEndPos()) {
                    .err => |err| {
                        return .{ .err = err };
                    },
                    .result => |s| s,
                } + 16,
            ) catch bun.outOfMemory();
        }

        var total: i64 = 0;
        while (true) {
            if (list.unusedCapacitySlice().len == 0) {
                list.ensureUnusedCapacity(16) catch bun.outOfMemory();
            }

            switch (if (comptime Environment.isPosix)
                bun.sys.pread(this.handle, list.unusedCapacitySlice(), total)
            else
                bun.sys.read(this.handle, list.unusedCapacitySlice())) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => |bytes_read| {
                    if (bytes_read == 0) {
                        break;
                    }

                    list.items.len += bytes_read;
                    total += @intCast(bytes_read);
                },
            }
        }

        return .{ .result = @intCast(total) };
    }

    /// Use this function on potentially large files.
    /// Calls fstat() on the file to get the size of the file and avoids reallocations + extra read() calls.
    pub fn readToEnd(this: File, allocator: std.mem.Allocator) ReadToEndResult {
        var list = std.ArrayList(u8).init(allocator);
        return switch (readToEndWithArrayList(this, &list, false)) {
            .err => |err| .{ .err = err, .bytes = list },
            .result => .{ .err = null, .bytes = list },
        };
    }

    /// Use this function on small files <= 1024 bytes.
    /// This will skip the fstat() call, preallocating 64 bytes instead of the file's size.
    pub fn readToEndSmall(this: File, allocator: std.mem.Allocator) ReadToEndResult {
        var list = std.ArrayList(u8).init(allocator);
        return switch (readToEndWithArrayList(this, &list, true)) {
            .err => |err| .{ .err = err, .bytes = list },
            .result => .{ .err = null, .bytes = list },
        };
    }

    pub fn getPath(this: File, out_buffer: *[MAX_PATH_BYTES]u8) Maybe([]u8) {
        return getFdPath(this.handle, out_buffer);
    }

    /// 1. Normalize the file path
    /// 2. Open a file for reading
    /// 2. Read the file to a buffer
    /// 3. Return the File handle and the buffer
    pub fn readFromUserInput(dir_fd: anytype, input_path: anytype, allocator: std.mem.Allocator) Maybe([:0]u8) {
        var buf: bun.PathBuffer = undefined;
        const normalized = bun.path.joinAbsStringBufZ(
            bun.fs.FileSystem.instance.top_level_dir,
            &buf,
            &.{input_path},
            .loose,
        );
        return readFrom(dir_fd, normalized, allocator);
    }

    /// 1. Open a file for reading
    /// 2. Read the file to a buffer
    /// 3. Return the File handle and the buffer
    pub fn readFileFrom(dir_fd: anytype, path: anytype, allocator: std.mem.Allocator) Maybe(struct { File, [:0]u8 }) {
        const ElementType = std.meta.Elem(@TypeOf(path));

        const rc = brk: {
            if (comptime Environment.isWindows and ElementType == u16) {
                break :brk openatWindowsTMaybeNormalize(u16, from(dir_fd).handle, path, O.RDONLY, false);
            }

            if (comptime ElementType == u8 and std.meta.sentinel(@TypeOf(path)) == null) {
                break :brk Syscall.openatA(from(dir_fd).handle, path, O.RDONLY, 0);
            }

            break :brk Syscall.openat(from(dir_fd).handle, path, O.RDONLY, 0);
        };

        const this = switch (rc) {
            .err => |err| return .{ .err = err },
            .result => |fd| from(fd),
        };

        var result = this.readToEnd(allocator);

        if (result.err) |err| {
            this.close();
            result.bytes.deinit();
            return .{ .err = err };
        }

        if (result.bytes.items.len == 0) {
            // Don't allocate an empty string.
            // We won't be modifying an empty slice, anyway.
            return .{ .result = .{ this, @ptrCast(@constCast("")) } };
        }

        result.bytes.append(0) catch bun.outOfMemory();

        return .{ .result = .{ this, result.bytes.items[0 .. result.bytes.items.len - 1 :0] } };
    }

    /// 1. Open a file for reading relative to a directory
    /// 2. Read the file to a buffer
    /// 3. Close the file
    /// 4. Return the buffer
    pub fn readFrom(dir_fd: anytype, path: anytype, allocator: std.mem.Allocator) Maybe([:0]u8) {
        const file, const bytes = switch (readFileFrom(dir_fd, path, allocator)) {
            .err => |err| return .{ .err = err },
            .result => |result| result,
        };

        file.close();
        return .{ .result = bytes };
    }

    pub fn toSourceAt(dir_fd: anytype, path: anytype, allocator: std.mem.Allocator) Maybe(bun.logger.Source) {
        return switch (readFrom(dir_fd, path, allocator)) {
            .err => |err| .{ .err = err },
            .result => |bytes| .{ .result = bun.logger.Source.initPathString(path, bytes) },
        };
    }

    pub fn toSource(path: anytype, allocator: std.mem.Allocator) Maybe(bun.logger.Source) {
        return toSourceAt(std.fs.cwd(), path, allocator);
    }
};

pub inline fn toLibUVOwnedFD(
    maybe_windows_fd: bun.FileDescriptor,
    comptime syscall_tag: Syscall.Tag,
    comptime error_case: enum { close_on_fail, leak_fd_on_fail },
) Maybe(bun.FileDescriptor) {
    if (!Environment.isWindows) {
        return .{ .result = maybe_windows_fd };
    }

    return .{
        .result = bun.toLibUVOwnedFD(maybe_windows_fd) catch |err| switch (err) {
            error.SystemFdQuotaExceeded => {
                if (error_case == .close_on_fail) {
                    _ = close(maybe_windows_fd);
                }
                return .{
                    .err = .{
                        .errno = @intFromEnum(bun.C.E.MFILE),
                        .syscall = syscall_tag,
                    },
                };
            },
        },
    };
}

pub const Dir = @import("./dir.zig");
const FILE_SHARE = w.FILE_SHARE_WRITE | w.FILE_SHARE_READ | w.FILE_SHARE_DELETE;
