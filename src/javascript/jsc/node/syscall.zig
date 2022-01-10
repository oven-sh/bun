const std = @import("std");
const system = std.os.system;
const os = std.os;
const builtin = @import("builtin");
const Maybe = @import("./types.zig").Maybe;
const Syscall = @This();
const Environment = @import("../../../global.zig").Environment;

const darwin = os.darwin;

const linux = os.linux;
// TODO

pub const Tag = enum(u8) {
    TODO,

    open,
    close,
    read,
    write,
    lseek,
    fstat,
    fsync,
    ftruncate,
    fdatasync,
    fchmod,
    fchown,
    mkdtemp,
    mkdir,
    _,
};

const mode_t = os.mode_t;

const open_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    system.open64
else
    system.open;

const fstat_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    system.fstat64
else
    system.fstat;

const mem = std.mem;

pub fn stat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errno(system.stat(path, &stat_))) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn lstat(path: [:0]const u8) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errno(system.lstat(path, &stat_))) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn fstat(fd: std.os.fd_t) Maybe(os.Stat) {
    var stat_ = mem.zeroes(os.Stat);
    if (Maybe(os.Stat).errno(fstat_sym(fd, &stat_))) |err| return err;
    return Maybe(os.Stat){ .result = stat_ };
}

pub fn open(file_path: [:0]const u8, flags: u32, perm: std.os.mode_t) Maybe(std.os.fd_t) {
    while (true) {
        const rc = open_sym(file_path, flags, perm);
        switch (system.getErrno(rc)) {
            .SUCCESS => .{ .result = rc },
            .INTR => continue,
            else => |err| {
                return Maybe(std.os.fd_t){
                    .err = .{
                        .errno = @truncate(Syscall.Error.Int, @enumToInt(err)),
                    },
                };
            },
        }
    }

    unreachable;
}

// The zig standard library marks BADF as unreachable
// That error is not unreachable for us
pub fn close(fd: std.os.fd_t) ?Syscall.Error {
    if (comptime Environment.isMac) {
        // This avoids the EINTR problem.
        switch (darwin.getErrno(darwin.@"close$NOCANCEL"(fd))) {
            .BADF => Syscall.Error{ .errno = .BADF, .syscall = .close },
            else => return null,
        }
    }

    if (comptime Environment.isLinux) {
        return switch (linux.getErrno(linux.close(fd))) {
            .BADF => Syscall.Error{ .errno = .BADF, .syscall = .close },
            else => void{},
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
        const rc = system.write(fd, bytes.ptr, adjusted_len);
        if (Maybe(usize).errno(rc)) |err| {
            if (err.err.errno == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = rc };
    }
}

const pread_sym = if (builtin.os.tag == .linux and builtin.link_libc)
    system.pread64
else
    system.pread;

pub fn pread(fd: os.fd_t, buf: []u8, offset: i64) Maybe(usize) {
    const adjusted_len = @minimum(buf.len, max_count);

    const ioffset = @bitCast(i64, offset); // the OS treats this as unsigned
    while (true) {
        const rc = pread_sym(fd, buf.ptr, adjusted_len, ioffset);
        if (Maybe(usize).errno(rc)) |err| {
            if (err.err.errno == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = rc };
    }
}

pub fn read(fd: os.fd_t, buf: []u8) Maybe(usize) {
    const adjusted_len = @minimum(buf.len, max_count);
    while (true) {
        const rc = system.read(fd, buf.ptr, adjusted_len);
        if (Maybe(usize).errno(rc)) |err| {
            if (err.err.errno == .INTR) continue;
            return err;
        }
        return Maybe(usize){ .result = rc };
    }
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
    path: ?[:0]const u8 = null,

    pub inline fn withPath(this: Error, path: ?[:0]const u8) Error {
        return Error{
            .errno = this.errno,
            .syscall = this.syscall,
            .path = path,
        };
    }

    pub const todo = Error{ .errno = std.math.maxInt(Int) - 5 };
};
