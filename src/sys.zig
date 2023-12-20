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
const kernel32 = bun.windows;

pub const sys_uv = if (Environment.isWindows) @import("./sys_uv.zig") else Syscall;

const log = bun.Output.scoped(.SYS, false);
pub const syslog = log;

// On Linux AARCh64, zig is missing stat & lstat syscalls
const use_libc = !(Environment.isLinux and Environment.isX64);
pub const system = switch (Environment.os) {
    .linux => linux,
    .mac => bun.AsyncIO.system,
    else => @compileError("not implemented"),
};
pub const S = struct {
    pub usingnamespace if (Environment.isLinux) linux.S else if (Environment.isPosix) std.os.S else struct {};
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

const windows = bun.windows;

pub const Tag = enum(u8) {
    TODO,
    dup,
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
    truncate,
    realpath,
    futime,

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

    uv_spawn,
    uv_pipe,

    WriteFile,
    NtQueryDirectoryFile,
    GetFinalPathNameByHandle,
    CloseHandle,
    SetFilePointerEx,

    pub fn isWindows(this: Tag) bool {
        return @intFromEnum(this) > @intFromEnum(Tag.WriteFile);
    }

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

pub fn fchmod(fd: bun.FileDescriptor, mode: bun.Mode) Maybe(void) {
    return Maybe(void).errnoSys(C.fchmod(fd, mode), .fchmod) orelse
        Maybe(void).success;
}

pub fn chdirOSPath(destination: bun.OSPathSlice) Maybe(void) {
    if (comptime Environment.isPosix) {
        const rc = sys.chdir(destination);
        return Maybe(void).errnoSys(rc, .chdir) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        if (kernel32.SetCurrentDirectory(destination) == windows.FALSE) {
            log("SetCurrentDirectory({}) = {d}", .{ bun.strings.fmtUTF16(destination), kernel32.GetLastError() });
            return Maybe(void).errnoSys(0, .chdir) orelse Maybe(void).success;
        }

        log("SetCurrentDirectory({}) = {d}", .{ bun.strings.fmtUTF16(destination), 0 });

        return Maybe(void).success;
    }

    @compileError("Not implemented yet");
}

pub fn chdir(destination: anytype) Maybe(void) {
    const Type = @TypeOf(destination);

    if (comptime Environment.isPosix) {
        if (comptime Type == []u8 or Type == []const u8) {
            return chdirOSPath(
                &(std.os.toPosixPath(destination) catch return .{ .err = .{
                    .errno = @intFromEnum(bun.C.SystemErrno.EINVAL),
                    .syscall = .chdir,
                } }),
            );
        }

        return chdirOSPath(destination);
    }

    if (comptime Environment.isWindows) {
        if (comptime Type == *[*:0]u16) {
            if (kernel32.SetCurrentDirectory(destination) != 0) {
                return Maybe(void).errnoSys(0, .chdir) orelse Maybe(void).success;
            }

            return Maybe(void).success;
        }

        if (comptime Type == bun.OSPathSlice or Type == [:0]u16) {
            return chdirOSPath(@as(bun.OSPathSlice, destination));
        }

        var wbuf: bun.WPathBuffer = undefined;
        return chdirOSPath(bun.strings.toWDirPath(&wbuf, destination));
    }

    return Maybe(void).todo();
}

pub fn stat(path: [:0]const u8) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        return sys_uv.stat(path);
    } else {
        var stat_ = mem.zeroes(bun.Stat);
        const rc = statSym(path, &stat_);

        if (comptime Environment.allow_assert)
            log("stat({s}) = {d}", .{ bun.asByteSlice(path), rc });

        if (Maybe(bun.Stat).errnoSys(rc, .stat)) |err| return err;
        return Maybe(bun.Stat){ .result = stat_ };
    }
}

pub fn lstat(path: [:0]const u8) Maybe(bun.Stat) {
    if (Environment.isWindows) {
        return sys_uv.lstat(path);
    } else {
        var stat_ = mem.zeroes(bun.Stat);
        if (Maybe(bun.Stat).errnoSys(lstat64(path, &stat_), .lstat)) |err| return err;
        return Maybe(bun.Stat){ .result = stat_ };
    }
}

pub fn fstat(fd: bun.FileDescriptor) Maybe(bun.Stat) {
    if (Environment.isWindows) return sys_uv.fstat(fd);

    var stat_ = mem.zeroes(bun.Stat);

    const rc = fstatSym(fd, &stat_);

    if (comptime Environment.allow_assert)
        log("fstat({d}) = {d}", .{ fd, rc });

    if (Maybe(bun.Stat).errnoSys(rc, .fstat)) |err| return err;
    return Maybe(bun.Stat){ .result = stat_ };
}

pub fn mkdir(file_path: [:0]const u8, flags: bun.Mode) Maybe(void) {
    return switch (Environment.os) {
        .mac => Maybe(void).errnoSysP(system.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success,

        .linux => Maybe(void).errnoSysP(linux.mkdir(file_path, flags), .mkdir, file_path) orelse Maybe(void).success,

        .windows => {
            var wbuf: bun.WPathBuffer = undefined;
            const rc = kernel32.CreateDirectoryW(bun.strings.toWPath(&wbuf, file_path).ptr, null);
            return Maybe(void).errnoSys(rc, .mkdir) orelse Maybe(void).success;
        },

        else => @compileError("mkdir is not implemented on this platform"),
    };
}

pub fn mkdirA(file_path: []const u8, flags: bun.Mode) Maybe(void) {
    if (comptime Environment.isMac) {
        return Maybe(void).errnoSysP(system.mkdir(&(std.os.toPosixPath(file_path) catch return Maybe(void){
            .err = .{
                .errno = @intFromEnum(bun.C.E.NOMEM),
                .syscall = .open,
            },
        }), flags), .mkdir, file_path) orelse Maybe(void).success;
    }

    if (comptime Environment.isLinux) {
        return Maybe(void).errnoSysP(linux.mkdir(&(std.os.toPosixPath(file_path) catch return Maybe(void){
            .err = .{
                .errno = @intFromEnum(bun.C.E.NOMEM),
                .syscall = .open,
            },
        }), flags), .mkdir, file_path) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        var wbuf: bun.WPathBuffer = undefined;
        const rc = kernel32.CreateDirectoryW(bun.strings.toWPath(&wbuf, file_path).ptr, null);

        return Maybe(void).errnoSys(rc, .mkdir) orelse Maybe(void).success;
    }
}

pub fn mkdirOSPath(file_path: bun.OSPathSlice, flags: bun.Mode) Maybe(void) {
    return switch (Environment.os) {
        else => mkdir(file_path, flags),
        .windows => {
            const rc = kernel32.CreateDirectoryW(file_path, null);
            return if (rc != 0)
                Maybe(void).success
            else
                Maybe(void).errnoSys(rc, .mkdir) orelse Maybe(void).success;
        },
    };
}

pub fn fcntl(fd: bun.FileDescriptor, cmd: i32, arg: usize) Maybe(usize) {
    const result = fcntl_symbol(fd, cmd, arg);
    if (Maybe(usize).errnoSys(result, .fcntl)) |err| return err;
    return .{ .result = @as(usize, @intCast(result)) };
}

pub fn getErrno(rc: anytype) bun.C.E {
    if (comptime Environment.isWindows) {
        if (bun.windows.Win32Error.get().toSystemErrno()) |e| {
            return e.toE();
        }

        return bun.C.E.UNKNOWN;
    }

    if (comptime Environment.isMac) return std.os.errno(rc);
    const Type = @TypeOf(rc);

    return switch (Type) {
        usize => std.os.linux.getErrno(@as(usize, rc)),
        comptime_int, i32, c_int, isize => std.os.errno(rc),
        else => @compileError("Not implemented yet for type " ++ @typeName(Type)),
    };
}

// pub fn openOptionsFromFlagsWindows(flags: u32) windows.OpenFileOptions {
//     const w = windows;
//     const O = std.os.O;

//     var access_mask: w.ULONG = w.READ_CONTROL | w.FILE_WRITE_ATTRIBUTES | w.SYNCHRONIZE;
//     if (flags & O.RDWR != 0) {
//         access_mask |= w.GENERIC_READ | w.GENERIC_WRITE;
//     } else if (flags & O.WRONLY != 0) {
//         access_mask |= w.GENERIC_WRITE;
//     } else {
//         access_mask |= w.GENERIC_READ | w.GENERIC_WRITE;
//     }

//     const filter: windows.OpenFileOptions.Filter = if (flags & O.DIRECTORY != 0) .dir_only else .file_only;
//     const follow_symlinks: bool = flags & O.NOFOLLOW == 0;

//     const creation: w.ULONG = blk: {
//         if (flags & O.CREAT != 0) {
//             if (flags & O.EXCL != 0) {
//                 break :blk w.FILE_CREATE;
//             }
//         }
//         break :blk w.FILE_OPEN;
//     };

//     return .{
//         .access_mask = access_mask,
//         .io_mode = .blocking,
//         .creation = creation,
//         .filter = filter,
//         .follow_symlinks = follow_symlinks,
//     };
// }
const O = std.os.O;
const w = std.os.windows;

pub fn openDirAtWindows(
    dirFd: bun.FileDescriptor,
    path: [:0]const u16,
    iterable: bool,
    no_follow: bool,
) Maybe(bun.FileDescriptor) {
    const base_flags = w.STANDARD_RIGHTS_READ | w.FILE_READ_ATTRIBUTES | w.FILE_READ_EA |
        w.SYNCHRONIZE | w.FILE_TRAVERSE;
    const flags: u32 = if (iterable) base_flags | w.FILE_LIST_DIRECTORY else base_flags;

    const path_len_bytes: u16 = @truncate(path.len * 2);
    var nt_name = w.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = @constCast(path.ptr),
    };
    var attr = w.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsW(path)) null else bun.fdcast(dirFd),
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
        w.FILE_SHARE_READ | w.FILE_SHARE_WRITE,
        w.FILE_OPEN,
        w.FILE_DIRECTORY_FILE | w.FILE_SYNCHRONOUS_IO_NONALERT | w.FILE_OPEN_FOR_BACKUP_INTENT | open_reparse_point,
        null,
        0,
    );

    if (comptime Environment.allow_assert) {
        log("NtCreateFile({d}, {}) = {d} (dir) = {d}", .{ dirFd, bun.strings.fmtUTF16(path), rc, @intFromPtr(fd) });
    }

    switch (windows.Win32Error.fromNTStatus(rc)) {
        .SUCCESS => {
            return JSC.Maybe(bun.FileDescriptor){
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

pub noinline fn openDirAtWindowsA(
    dirFd: bun.FileDescriptor,
    path: []const u8,
    iterable: bool,
    no_follow: bool,
) Maybe(bun.FileDescriptor) {
    var wbuf: bun.WPathBuffer = undefined;
    return openDirAtWindows(dirFd, bun.strings.toNTDir(&wbuf, path), iterable, no_follow);
}
pub fn openatWindows(dirfd: bun.FileDescriptor, path_: []const u16, flags: bun.Mode) Maybe(bun.FileDescriptor) {
    const nonblock = flags & O.NONBLOCK != 0;

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

    const overwrite = flags & O.WRONLY != 0 and flags & O.APPEND == 0;

    var result: windows.HANDLE = undefined;

    const path = if (bun.strings.hasPrefixComptimeUTF16(path_, ".\\")) path_[2..] else path_;

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
        .RootDirectory = if (std.fs.path.isAbsoluteWindowsWTF16(path))
            null
        else if (dirfd == bun.invalid_fd)
            std.fs.cwd().fd
        else
            bun.fdcast(dirfd),
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    var io: windows.IO_STATUS_BLOCK = undefined;
    const blocking_flag: windows.ULONG = if (!nonblock) windows.FILE_SYNCHRONOUS_IO_NONALERT else 0;
    const file_or_dir_flag: windows.ULONG = switch (flags & O.DIRECTORY != 0) {
        // .file_only => windows.FILE_NON_DIRECTORY_FILE,
        true => windows.FILE_DIRECTORY_FILE,
        false => 0,
    };
    const follow_symlinks = flags & O.NOFOLLOW == 0;
    const creation: w.ULONG = blk: {
        if (flags & O.CREAT != 0) {
            if (flags & O.EXCL != 0) {
                break :blk w.FILE_CREATE;
            }
            break :blk if (overwrite) w.FILE_OVERWRITE_IF else w.FILE_OPEN_IF;
        }
        break :blk if (overwrite) w.FILE_OVERWRITE else w.FILE_OPEN;
    };

    const wflags: windows.ULONG = if (follow_symlinks) file_or_dir_flag | blocking_flag else file_or_dir_flag | windows.FILE_OPEN_REPARSE_POINT;

    while (true) {
        const rc = windows.ntdll.NtCreateFile(
            &result,
            access_mask,
            &attr,
            &io,
            null,
            w.FILE_ATTRIBUTE_NORMAL,
            w.FILE_SHARE_WRITE | w.FILE_SHARE_READ | w.FILE_SHARE_DELETE,
            creation,
            wflags,
            null,
            0,
        );

        if (comptime Environment.allow_assert) {
            log("NtCreateFile({d}, {}) = {d} (file) = {d}", .{ dirfd, bun.strings.fmtUTF16(path), rc, @intFromPtr(result) });
        }

        switch (windows.Win32Error.fromNTStatus(rc)) {
            .SUCCESS => {
                if (flags & O.APPEND != 0) {
                    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
                    const FILE_END = 2;
                    if (windows.kernel32.SetFilePointerEx(result, 0, null, FILE_END) == 0) {
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

pub fn openatOSPath(dirfd: bun.FileDescriptor, file_path: bun.OSPathSlice, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isMac) {
        // https://opensource.apple.com/source/xnu/xnu-7195.81.3/libsyscall/wrappers/open-base.c
        const rc = system.@"openat$NOCANCEL"(dirfd, file_path.ptr, @as(c_uint, @intCast(flags)), @as(c_int, @intCast(perm)));
        if (comptime Environment.allow_assert)
            log("openat({d}, {s}) = {d}", .{ dirfd, bun.sliceTo(file_path, 0), rc });

        return Maybe(bun.FileDescriptor).errnoSys(rc, .open) orelse .{ .result = @intCast(rc) };
    }

    if (comptime Environment.isWindows) {
        return openatWindows(dirfd, file_path, flags);
    }

    while (true) {
        const rc = Syscall.system.openat(@as(Syscall.system.fd_t, @intCast(dirfd)), file_path, flags, perm);
        if (comptime Environment.allow_assert)
            log("openat({d}, {s}) = {d}", .{ dirfd, bun.sliceTo(file_path, 0), rc });
        return switch (Syscall.getErrno(rc)) {
            .SUCCESS => .{ .result = @as(bun.FileDescriptor, @intCast(rc)) },
            .INTR => continue,
            else => |err| {
                return Maybe(std.os.fd_t){
                    .err = .{
                        .errno = @truncate(@intFromEnum(err)),
                        .syscall = .open,
                    },
                };
            },
        };
    }

    unreachable;
}

pub fn openat(dirfd: bun.FileDescriptor, file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        if (flags & O.DIRECTORY != 0) {
            return openDirAtWindowsA(dirfd, file_path, false, flags & O.NOFOLLOW != 0);
        }

        var wbuf: bun.WPathBuffer = undefined;
        return openatWindows(dirfd, bun.strings.toNTPath(&wbuf, file_path), flags);
    }

    return openatOSPath(dirfd, file_path, flags, perm);
}

pub fn openatA(dirfd: bun.FileDescriptor, file_path: []const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        if (flags & O.DIRECTORY != 0) {
            return openDirAtWindowsA(dirfd, file_path, false, flags & O.NOFOLLOW != 0);
        }

        var wbuf: bun.WPathBuffer = undefined;
        return openatWindows(dirfd, bun.strings.toNTPath(&wbuf, file_path), flags);
    }

    return openatOSPath(
        dirfd,
        &(std.os.toPosixPath(file_path) catch return Maybe(bun.FileDescriptor){
            .err = .{
                .errno = @intFromEnum(bun.C.E.NOMEM),
                .syscall = .open,
            },
        }),
        flags,
        perm,
    );
}

pub fn openA(file_path: []const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    // this is what open() does anyway.
    return openatA(bun.toFD((std.fs.cwd().fd)), file_path, flags, perm);
}

pub fn open(file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
    // this is what open() does anyway.
    return openat(bun.toFD((std.fs.cwd().fd)), file_path, flags, perm);
}

/// This function will prevent stdout and stderr from being closed.
pub fn close(fd: bun.FileDescriptor) ?Syscall.Error {
    return bun.FDImpl.decode(fd).close();
}

pub fn closeAllowingStdoutAndStderr(fd: bun.FileDescriptor) ?Syscall.Error {
    return bun.FDImpl.decode(fd).closeAllowingStdoutAndStderr();
}

pub const max_count = switch (builtin.os.tag) {
    .linux => 0x7ffff000,
    .macos, .ios, .watchos, .tvos => std.math.maxInt(i32),
    else => std.math.maxInt(isize),
};

pub fn write(fd: bun.FileDescriptor, bytes: []const u8) Maybe(usize) {
    const adjusted_len = @min(max_count, bytes.len);

    return switch (Environment.os) {
        .mac => {
            const rc = system.@"write$NOCANCEL"(fd, bytes.ptr, adjusted_len);
            log("write({d}, {d}) = {d}", .{ fd, adjusted_len, rc });

            if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        },
        .linux => {
            while (true) {
                const rc = sys.write(fd, bytes.ptr, adjusted_len);
                log("write({d}, {d}) = {d}", .{ fd, adjusted_len, rc });

                if (Maybe(usize).errnoSysFd(rc, .write, fd)) |err| {
                    if (err.getErrno() == .INTR) continue;
                    return err;
                }

                return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
            }
        },
        .windows => sys_uv.write(fd, bytes),
        else => @compileError("Not implemented yet"),
    };
}

fn veclen(buffers: anytype) usize {
    var len: usize = 0;
    for (buffers) |buffer| {
        len += buffer.iov_len;
    }
    return len;
}

pub fn writev(fd: bun.FileDescriptor, buffers: []std.os.iovec) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = writev_sym(fd, @as([*]std.os.iovec_const, @ptrCast(buffers.ptr)), @as(i32, @intCast(buffers.len)));
        if (comptime Environment.allow_assert)
            log("writev({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .writev, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = writev_sym(fd, @as([*]std.os.iovec_const, @ptrCast(buffers.ptr)), buffers.len);
            if (comptime Environment.allow_assert)
                log("writev({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .writev, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn pwritev(fd: bun.FileDescriptor, buffers: []std.os.iovec, position: isize) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = pwritev_sym(fd, @as([*]std.os.iovec_const, @ptrCast(buffers.ptr)), @as(i32, @intCast(buffers.len)), position);
        if (comptime Environment.allow_assert)
            log("pwritev({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .pwritev, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = pwritev_sym(fd, @as([*]std.os.iovec_const, @ptrCast(buffers.ptr)), buffers.len, position);
            if (comptime Environment.allow_assert)
                log("pwritev({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .pwritev, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn readv(fd: bun.FileDescriptor, buffers: []std.os.iovec) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buffers.len == 0) {
            @panic("readv() called with 0 length buffer");
        }
    }

    if (comptime Environment.isMac) {
        const rc = readv_sym(fd, buffers.ptr, @as(i32, @intCast(buffers.len)));
        if (comptime Environment.allow_assert)
            log("readv({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .readv, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = readv_sym(fd, buffers.ptr, buffers.len);
            if (comptime Environment.allow_assert)
                log("readv({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

            if (Maybe(usize).errnoSysFd(rc, .readv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
        unreachable;
    }
}

pub fn preadv(fd: bun.FileDescriptor, buffers: []std.os.iovec, position: isize) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buffers.len == 0) {
            @panic("preadv() called with 0 length buffer");
        }
    }

    if (comptime Environment.isMac) {
        const rc = preadv_sym(fd, buffers.ptr, @as(i32, @intCast(buffers.len)), position);
        if (comptime Environment.allow_assert)
            log("preadv({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

        if (Maybe(usize).errnoSysFd(rc, .preadv, fd)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = preadv_sym(fd, buffers.ptr, buffers.len, position);
            if (comptime Environment.allow_assert)
                log("preadv({d}, {d}) = {d}", .{ fd, veclen(buffers), rc });

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
    system.@"preadv$NOCANCEL"
else
    system.preadv;

const readv_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.readv
else if (builtin.os.tag.isDarwin())
    system.@"readv$NOCANCEL"
else
    system.readv;

const pwritev_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.pwritev
else if (builtin.os.tag.isDarwin())
    system.@"pwritev$NOCANCEL"
else
    system.pwritev;

const writev_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    std.os.linux.writev
else if (builtin.os.tag.isDarwin())
    system.@"writev$NOCANCEL"
else
    system.writev;

const pread_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    sys.pread64
else if (builtin.os.tag.isDarwin())
    system.@"pread$NOCANCEL"
else
    system.pread;

const fcntl_symbol = system.fcntl;

pub fn pread(fd: bun.FileDescriptor, buf: []u8, offset: i64) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);

    if (comptime Environment.allow_assert) {
        if (adjusted_len == 0) {
            @panic("pread() called with 0 length buffer");
        }
    }

    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    while (true) {
        const rc = pread_sym(fd, buf.ptr, adjusted_len, ioffset);
        if (Maybe(usize).errnoSys(rc, .pread)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }
    unreachable;
}

const pwrite_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    sys.pwrite64
else
    sys.pwrite;

pub fn pwrite(fd: bun.FileDescriptor, bytes: []const u8, offset: i64) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (bytes.len == 0) {
            @panic("pwrite() called with 0 length buffer");
        }
    }

    const adjusted_len = @min(bytes.len, max_count);

    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    while (true) {
        const rc = pwrite_sym(fd, bytes.ptr, adjusted_len, ioffset);
        return if (Maybe(usize).errnoSysFd(rc, .pwrite, fd)) |err| {
            switch (err.getErrno()) {
                .INTR => continue,
                else => return err,
            }
        } else Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }

    unreachable;
}

pub fn read(fd: bun.FileDescriptor, buf: []u8) Maybe(usize) {
    if (comptime Environment.allow_assert) {
        if (buf.len == 0) {
            @panic("read() called with 0 length buffer");
        }
    }
    const debug_timer = bun.Output.DebugTimer.start();
    const adjusted_len = @min(buf.len, max_count);
    return switch (Environment.os) {
        .mac => {
            const rc = system.@"read$NOCANCEL"(fd, buf.ptr, adjusted_len);

            log("read({d}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

            if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        },
        .linux => {
            while (true) {
                const rc = sys.read(fd, buf.ptr, adjusted_len);
                log("read({d}, {d}) = {d} ({any})", .{ fd, adjusted_len, rc, debug_timer });

                if (Maybe(usize).errnoSysFd(rc, .read, fd)) |err| {
                    if (err.getErrno() == .INTR) continue;
                    return err;
                }
                return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
            }
        },
        .windows => sys_uv.read(fd, buf),
        else => @compileError("read is not implemented on this platform"),
    };
}

pub fn recv(fd: bun.FileDescriptor, buf: []u8, flag: u32) Maybe(usize) {
    const adjusted_len = @min(buf.len, max_count);
    if (comptime Environment.allow_assert) {
        if (adjusted_len == 0) {
            @panic("recv() called with 0 length buffer");
        }
    }

    if (comptime Environment.isMac) {
        const rc = system.@"recvfrom$NOCANCEL"(fd, buf.ptr, adjusted_len, flag, null, null);
        log("recv({d}, {d}, {d}) = {d}", .{ fd, adjusted_len, flag, rc });

        if (Maybe(usize).errnoSys(rc, .recv)) |err| {
            return err;
        }

        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = linux.recvfrom(fd, buf.ptr, adjusted_len, flag | os.SOCK.CLOEXEC | linux.MSG.CMSG_CLOEXEC, null, null);
            log("recv({d}, {d}, {d}) = {d}", .{ fd, adjusted_len, flag, rc });

            if (Maybe(usize).errnoSysFd(rc, .recv, fd)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }
            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
        }
    }
    unreachable;
}

pub fn send(fd: bun.FileDescriptor, buf: []const u8, flag: u32) Maybe(usize) {
    if (comptime Environment.isMac) {
        const rc = system.@"sendto$NOCANCEL"(fd, buf.ptr, buf.len, flag, null, 0);
        if (Maybe(usize).errnoSys(rc, .send)) |err| {
            return err;
        }
        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    } else {
        while (true) {
            const rc = linux.sendto(fd, buf.ptr, buf.len, flag | os.SOCK.CLOEXEC | os.MSG.NOSIGNAL, null, 0);

            if (Maybe(usize).errnoSys(rc, .send)) |err| {
                if (err.getErrno() == .INTR) continue;
                return err;
            }

            return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
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
        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }
    unreachable;
}

pub fn readlinkat(fd: bun.FileDescriptor, in: [:0]const u8, buf: []u8) Maybe(usize) {
    while (true) {
        const rc = sys.readlinkat(fd, in, buf.ptr, buf.len);

        if (Maybe(usize).errnoSys(rc, .readlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = @as(usize, @intCast(rc)) };
    }
    unreachable;
}

pub fn ftruncate(fd: fd_t, size: isize) Maybe(void) {
    if (comptime Environment.isWindows) {
        if (kernel32.SetFileValidData(bun.fdcast(fd), size) == 0) {
            return Maybe(void).errnoSys(0, .ftruncate) orelse Maybe(void).success;
        }

        return Maybe(void).success;
    }

    return while (true) {
        if (Maybe(void).errnoSys(sys.ftruncate(fd, size), .ftruncate)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    };
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

pub fn renameat(from_dir: bun.FileDescriptor, from: [:0]const u8, to_dir: bun.FileDescriptor, to: [:0]const u8) Maybe(void) {
    if (Environment.isWindows) {
        return Maybe(void).todo();
    }
    while (true) {
        if (Maybe(void).errnoSys(sys.renameat(from_dir, from, to_dir, to), .rename)) |err| {
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

pub fn rmdirat(dirfd: bun.FileDescriptor, to: anytype) Maybe(void) {
    if (Environment.isWindows) {
        return Maybe(void).todo();
    }
    while (true) {
        if (Maybe(void).errnoSys(sys.unlinkat(dirfd, to, 1), .unlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn unlinkat(dirfd: bun.FileDescriptor, to: anytype) Maybe(void) {
    if (Environment.isWindows) {
        return Maybe(void).todo();
    }
    while (true) {
        if (Maybe(void).errnoSys(sys.unlinkat(dirfd, to, 0), .unlink)) |err| {
            if (err.getErrno() == .INTR) continue;
            return err;
        }
        return Maybe(void).success;
    }
    unreachable;
}

pub fn getFdPath(fd: bun.FileDescriptor, out_buffer: *[MAX_PATH_BYTES]u8) Maybe([]u8) {
    switch (comptime builtin.os.tag) {
        .windows => {
            var wide_buf: [windows.PATH_MAX_WIDE]u16 = undefined;
            const wide_slice = std.os.windows.GetFinalPathNameByHandle(bun.fdcast(fd), .{}, wide_buf[0..]) catch {
                return Maybe([]u8){ .err = .{ .errno = @intFromEnum(bun.C.SystemErrno.EBADF), .syscall = .GetFinalPathNameByHandle } };
            };

            // Trust that Windows gives us valid UTF-16LE.
            return .{ .result = @constCast(bun.strings.fromWPath(out_buffer, wide_slice)) };
        },
        .macos, .ios, .watchos, .tvos => {
            // On macOS, we can use F.GETPATH fcntl command to query the OS for
            // the path to the file descriptor.
            @memset(out_buffer[0..MAX_PATH_BYTES], 0);
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
    fd: bun.FileDescriptor,
    offset: u64,
) Maybe([]align(mem.page_size) u8) {
    const ioffset = @as(i64, @bitCast(offset)); // the OS treats this as unsigned
    const rc = std.c.mmap(ptr, length, prot, flags, fd, ioffset);
    const fail = std.c.MAP.FAILED;
    if (rc == fail) {
        return Maybe([]align(mem.page_size) u8){
            .err = .{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(std.c.getErrno(@as(i64, @bitCast(@intFromPtr(fail))))))), .syscall = .mmap },
        };
    }

    return Maybe([]align(mem.page_size) u8){ .result = @as([*]align(mem.page_size) u8, @ptrCast(@alignCast(rc)))[0..length] };
}

pub fn mmapFile(path: [:0]const u8, flags: u32, wanted_size: ?usize, offset: usize) Maybe([]align(mem.page_size) u8) {
    const fd = switch (open(path, os.O.RDWR, 0)) {
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
    const E = bun.C.E;

    pub const Int = if (Environment.isWindows) u16 else u8; // @TypeOf(@intFromEnum(E.BADF));

    errno: Int,
    syscall: Syscall.Tag,
    path: []const u8 = "",
    fd: bun.FileDescriptor = bun.invalid_fd,

    pub inline fn isRetry(this: *const Error) bool {
        return this.getErrno() == .AGAIN;
    }

    pub fn fromCode(errno: E, syscall: Syscall.Tag) Error {
        return .{
            .errno = @as(Int, @intCast(@intFromEnum(errno))),
            .syscall = syscall,
        };
    }

    pub fn fromCodeInt(errno: anytype, syscall: Syscall.Tag) Error {
        return .{
            .errno = @as(Int, @intCast(if (Environment.isWindows) @abs(errno) else errno)),
            .syscall = syscall,
        };
    }

    pub fn format(self: Error, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
        try self.toSystemError().format(fmt, opts, writer);
    }

    /// TODO: convert to function
    pub const oom = fromCode(E.NOMEM, .read);

    pub const retry = Error{
        .errno = if (Environment.isLinux)
            @as(Int, @intCast(@intFromEnum(E.AGAIN)))
        else if (Environment.isMac)
            @as(Int, @intCast(@intFromEnum(E.WOULDBLOCK)))
        else
            @as(Int, @intCast(@intFromEnum(E.INTR))),
        .syscall = .retry,
    };

    pub inline fn getErrno(this: Error) E {
        return @as(E, @enumFromInt(this.errno));
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

    pub inline fn withFd(this: Error, fd: anytype) Error {
        if (Environment.allow_assert) std.debug.assert(fd != bun.invalid_fd);
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .fd = bun.toFD(fd),
        };
    }

    pub inline fn withPathLike(this: Error, pathlike: anytype) Error {
        return switch (pathlike) {
            .fd => |fd| this.withFd(fd),
            .path => |path| this.withPath(path.slice()),
        };
    }

    const todo_errno = std.math.maxInt(Int) - 1;

    pub inline fn todo() Error {
        if (Environment.isDebug) {
            @panic("bun.sys.Error.todo() was called");
        }
        return Error{ .errno = todo_errno, .syscall = .TODO };
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
                break :brk @as(C.SystemErrno, @enumFromInt(@intFromEnum(bun.windows.libuv.translateUVErrorToE(err.errno))));
            };
            if (std.enums.tagName(bun.C.SystemErrno, system_errno)) |errname| {
                err.code = bun.String.static(errname);
                if (C.SystemErrno.labels.get(system_errno)) |label| {
                    err.message = bun.String.static(label);
                }
            }
        }

        if (this.path.len > 0) {
            err.path = bun.String.create(this.path);
        }

        if (this.fd != bun.invalid_fd) {
            if (this.fd <= std.math.maxInt(i32)) {
                err.fd = @intCast(this.fd);
            }
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
    if (Maybe(usize).errnoSys(pipe_len, .fcntl)) |err| return err;
    if (pipe_len == 0) return Maybe(usize){ .result = 0 };
    if (pipe_len >= capacity) return Maybe(usize){ .result = pipe_len };

    const new_pipe_len = std.os.linux.fcntl(fd, F_SETPIPE_SZ, capacity);
    if (Maybe(usize).errnoSys(new_pipe_len, .fcntl)) |err| return err;
    return Maybe(usize){ .result = new_pipe_len };
}

pub fn getMaxPipeSizeOnLinux() usize {
    return @as(
        usize,
        @intCast(bun.once(struct {
            fn once() c_int {
                const strings = bun.strings;
                const default_out_size = 512 * 1024;
                const pipe_max_size_fd = switch (bun.sys.open("/proc/sys/fs/pipe-max-size", std.os.O.RDONLY, 0)) {
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

pub fn existsOSPath(path: bun.OSPathSlice) bool {
    if (comptime Environment.isPosix) {
        return system.access(path, 0) == 0;
    }

    if (comptime Environment.isWindows) {
        const result = kernel32.GetFileAttributesW(path.ptr);
        if (Environment.isDebug) {
            log("GetFileAttributesW({}) = {d}", .{ bun.strings.fmtUTF16(path), result });
        }
        return result != windows.INVALID_FILE_ATTRIBUTES;
    }

    @compileError("TODO: existsOSPath");
}

pub fn exists(path: []const u8) bool {
    if (comptime Environment.isPosix) {
        return system.access(&(std.os.toPosixPath(path) catch return false), 0) == 0;
    }

    if (comptime Environment.isWindows) {
        var wbuf: bun.WPathBuffer = undefined;
        const path_to_use = bun.strings.toWPath(&wbuf, path);
        return kernel32.GetFileAttributesW(path_to_use.ptr) != windows.INVALID_FILE_ATTRIBUTES;
    }

    @compileError("TODO: existsOSPath");
}

pub fn existsAt(fd: bun.FileDescriptor, subpath: []const u8) bool {
    if (comptime Environment.isPosix) {
        return system.faccessat(bun.toFD(fd), &(std.os.toPosixPath(subpath) catch return false), 0, 0) == 0;
    }

    if (comptime Environment.isWindows) {
        // TODO(dylan-conway): this is not tested
        var wbuf: bun.MAX_WPATH = undefined;
        const path_to_use = bun.strings.toWPath(&wbuf, subpath);
        const nt_name = windows.UNICODE_STRING{
            .Length = path_to_use.len * 2,
            .MaximumLength = path_to_use.len * 2,
            .Buffer = path_to_use,
        };
        const attr = windows.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(windows.OBJECT_ATTRIBUTES),
            .RootDirectory = bun.toFD(fd),
            .Attributes = 0,
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        const basic_info: windows.FILE_BASIC_INFORMATION = undefined;
        return switch (kernel32.NtQueryAttributesFile(&attr, basic_info)) {
            .SUCCESS => true,
            else => false,
        };
    }

    @compileError("TODO: existsAtOSPath");
}

pub extern "C" fn is_executable_file(path: [*:0]const u8) bool;

pub fn isExecutableFileOSPath(path: bun.OSPathSlice) bool {
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

        // log("GetBinaryTypeW({}) = {d}. isExecutable={}", .{ bun.strings.fmtUTF16(path), out, result });

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
                &(std.os.toPosixPath(path) catch return false),
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
            linux.lseek(fd, @intCast(offset), os.SEEK.SET),
            .lseek,
            fd,
        ) orelse Maybe(void).success;
    }

    if (comptime Environment.isMac) {
        return Maybe(void).errnoSysFd(
            std.c.lseek(fd, @intCast(offset), os.SEEK.SET),
            .lseek,
            fd,
        ) orelse Maybe(void).success;
    }

    if (comptime Environment.isWindows) {
        const offset_high: u64 = @as(u32, @intCast(offset >> 32));
        const offset_low: u64 = @as(u32, @intCast(offset & 0xFFFFFFFF));
        var plarge_integer: i64 = @bitCast(offset_high);
        const rc = kernel32.SetFilePointerEx(
            bun.fdcast(fd),
            @as(windows.LARGE_INTEGER, @bitCast(offset_low)),
            &plarge_integer,
            windows.FILE_BEGIN,
        );
        if (rc == windows.FALSE) {
            return Maybe(void).errnoSys(0, .lseek) orelse Maybe(void).success;
        }
        return Maybe(void).success;
    }
}

pub fn dup(fd: bun.FileDescriptor) Maybe(bun.FileDescriptor) {
    if (comptime Environment.isWindows) {
        const target: *windows.HANDLE = undefined;
        const process = kernel32.GetCurrentProcess();
        const out = kernel32.DuplicateHandle(
            process,
            bun.fdcast(fd),
            process,
            target,
            0,
            w.TRUE,
            w.DUPLICATE_SAME_ACCESS,
        );
        if (out == 0) {
            if (Maybe(bun.FileDescriptor).errnoSysFd(0, .dup, fd)) |err| {
                return err;
            }
        }
        return Maybe(bun.FileDescriptor){ .result = bun.toFD(out) };
    }

    const out = std.c.dup(fd);
    return Maybe(bun.FileDescriptor).errnoSysFd(out, .dup, fd) orelse Maybe(bun.FileDescriptor){ .result = bun.toFD(out) };
}

pub fn linkat(dir_fd: bun.FileDescriptor, basename: []const u8, dest_dir_fd: bun.FileDescriptor, dest_name: []const u8) Maybe(void) {
    return Maybe(void).errnoSysP(
        std.c.linkat(
            @intCast(dir_fd),
            &(std.os.toPosixPath(basename) catch return .{
                .err = .{
                    .errno = @intFromEnum(bun.C.E.NOMEM),
                    .syscall = .open,
                },
            }),
            @intCast(dest_dir_fd),
            &(std.os.toPosixPath(dest_name) catch return .{
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

    if (comptime Environment.allow_assert)
        std.debug.assert(!std.fs.path.isAbsolute(name)); // absolute path will get ignored.

    return Maybe(void).errnoSysP(
        std.os.linux.linkat(
            bun.fdcast(tmpfd),
            "",
            dirfd,
            name,
            os.AT.EMPTY_PATH,
        ),
        .link,
        name,
    ) orelse Maybe(void).success;
}
