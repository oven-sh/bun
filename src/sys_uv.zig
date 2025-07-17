//! bun.sys.sys_uv is a polyfill of bun.sys but with libuv.
//! TODO: Probably should merge this into bun.sys itself with isWindows checks
const bun = @import("bun");

const assertIsValidWindowsPath = bun.strings.assertIsValidWindowsPath;
const uv = bun.windows.libuv;

const Environment = bun.Environment;
const FileDescriptor = bun.FileDescriptor;
const JSC = bun.JSC;
const Maybe = JSC.Maybe;

comptime {
    bun.assert(Environment.isWindows);
}

pub const log = bun.sys.syslog;
pub const Error = bun.sys.Error;

// libuv dont support openat (https://github.com/libuv/libuv/issues/4167)
pub const openat = bun.sys.openat;
pub const getFdPath = bun.sys.getFdPath;
pub const setFileOffset = bun.sys.setFileOffset;
pub const openatOSPath = bun.sys.openatOSPath;
pub const mkdirOSPath = bun.sys.mkdirOSPath;
pub const access = bun.sys.access;

// Note: `req = undefined; req.deinit()` has a safety-check in a debug build

pub fn open(file_path: [:0]const u8, c_flags: i32, _perm: bun.Mode) Maybe(bun.FileDescriptor) {
    assertIsValidWindowsPath(u8, file_path);

    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();

    const flags = uv.O.fromBunO(c_flags);

    var perm = _perm;
    if (perm == 0) {
        // Set a sensible default, otherwise on windows the file will be unusable
        perm = 0o644;
    }

    const rc = uv.uv_fs_open(uv.Loop.get(), &req, file_path.ptr, flags, perm, null);
    log("uv open({s}, {d}, {d}) = {d}", .{ file_path, flags, perm, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .open, .path = file_path } }
    else
        .{ .result = req.result.toFD() };
}

pub fn mkdir(file_path: [:0]const u8, flags: bun.Mode) Maybe(void) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_mkdir(uv.Loop.get(), &req, file_path.ptr, flags, null);

    log("uv mkdir({s}, {d}) = {d}", .{ file_path, flags, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .mkdir, .path = file_path } }
    else
        .{ .result = {} };
}

pub fn chmod(file_path: [:0]const u8, flags: bun.Mode) Maybe(void) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();

    const rc = uv.uv_fs_chmod(uv.Loop.get(), &req, file_path.ptr, flags, null);

    log("uv chmod({s}, {d}) = {d}", .{ file_path, flags, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .chmod, .path = file_path } }
    else
        .{ .result = {} };
}

pub fn fchmod(fd: FileDescriptor, flags: bun.Mode) Maybe(void) {
    const uv_fd = fd.uv();
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_fchmod(uv.Loop.get(), &req, uv_fd, flags, null);

    log("uv fchmod({}, {d}) = {d}", .{ uv_fd, flags, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .fchmod, .fd = fd } }
    else
        .{ .result = {} };
}

pub fn statfs(file_path: [:0]const u8) Maybe(bun.StatFS) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_statfs(uv.Loop.get(), &req, file_path.ptr, null);

    log("uv statfs({s}) = {d}", .{ file_path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .statfs, .path = file_path } }
    else
        .{ .result = bun.StatFS.init(req.ptrAs(*align(1) bun.StatFS)) };
}

pub fn chown(file_path: [:0]const u8, uid: uv.uv_uid_t, gid: uv.uv_uid_t) Maybe(void) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_chown(uv.Loop.get(), &req, file_path.ptr, uid, gid, null);

    log("uv chown({s}, {d}, {d}) = {d}", .{ file_path, uid, gid, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .chown, .path = file_path } }
    else
        .{ .result = {} };
}

pub fn fchown(fd: FileDescriptor, uid: uv.uv_uid_t, gid: uv.uv_uid_t) Maybe(void) {
    const uv_fd = fd.uv();

    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_fchown(uv.Loop.get(), &req, uv_fd, uid, gid, null);

    log("uv chown({}, {d}, {d}) = {d}", .{ uv_fd, uid, gid, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .fchown, .fd = fd } }
    else
        .{ .result = {} };
}

pub fn rmdir(file_path: [:0]const u8) Maybe(void) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_rmdir(uv.Loop.get(), &req, file_path.ptr, null);

    log("uv rmdir({s}) = {d}", .{ file_path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .rmdir, .path = file_path } }
    else
        .{ .result = {} };
}

pub fn unlink(file_path: [:0]const u8) Maybe(void) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_unlink(uv.Loop.get(), &req, file_path.ptr, null);

    log("uv unlink({s}) = {d}", .{ file_path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .unlink, .path = file_path } }
    else
        .{ .result = {} };
}

pub fn readlink(file_path: [:0]const u8, buf: []u8) Maybe([:0]u8) {
    assertIsValidWindowsPath(u8, file_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    // Edge cases: http://docs.libuv.org/en/v1.x/fs.html#c.uv_fs_realpath
    const rc = uv.uv_fs_readlink(uv.Loop.get(), &req, file_path.ptr, null);

    if (rc.errno()) |errno| {
        log("uv readlink({s}) = {d}, [err]", .{ file_path, rc.int() });
        return .{ .err = .{ .errno = errno, .syscall = .readlink, .path = file_path } };
    } else {
        // Seems like `rc` does not contain the size?
        bun.assert(rc.int() == 0);
        const slice = bun.span(req.ptrAs([*:0]u8));
        if (slice.len > buf.len) {
            log("uv readlink({s}) = {d}, {s} TRUNCATED", .{ file_path, rc.int(), slice });
            return .{ .err = .{ .errno = @intFromEnum(bun.sys.E.NOMEM), .syscall = .readlink, .path = file_path } };
        }
        log("uv readlink({s}) = {d}, {s}", .{ file_path, rc.int(), slice });
        @memcpy(buf[0..slice.len], slice);
        buf[slice.len] = 0;
        return .{ .result = buf[0..slice.len :0] };
    }
}

pub fn rename(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    assertIsValidWindowsPath(u8, from);
    assertIsValidWindowsPath(u8, to);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_rename(uv.Loop.get(), &req, from.ptr, to.ptr, null);

    log("uv rename({s}, {s}) = {d}", .{ from, to, rc.int() });
    return if (rc.errno()) |errno|
        // which one goes in the .path field?
        .{ .err = .{ .errno = errno, .syscall = .rename } }
    else
        .{ .result = {} };
}

pub fn link(from: [:0]const u8, to: [:0]const u8) Maybe(void) {
    assertIsValidWindowsPath(u8, from);
    assertIsValidWindowsPath(u8, to);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_link(uv.Loop.get(), &req, from.ptr, to.ptr, null);

    log("uv link({s}, {s}) = {d}", .{ from, to, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .link, .path = from, .dest = to } }
    else
        .{ .result = {} };
}

pub fn symlinkUV(target: [:0]const u8, new_path: [:0]const u8, flags: c_int) Maybe(void) {
    assertIsValidWindowsPath(u8, target);
    assertIsValidWindowsPath(u8, new_path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_symlink(uv.Loop.get(), &req, target.ptr, new_path.ptr, flags, null);

    log("uv symlink({s}, {s}) = {d}", .{ target, new_path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .symlink } }
    else
        .{ .result = {} };
}

pub fn ftruncate(fd: FileDescriptor, size: isize) Maybe(void) {
    const uv_fd = fd.uv();
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_ftruncate(uv.Loop.get(), &req, uv_fd, size, null);

    log("uv ftruncate({}, {d}) = {d}", .{ uv_fd, size, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .ftruncate, .fd = fd } }
    else
        .{ .result = {} };
}

pub fn fstat(fd: FileDescriptor) Maybe(bun.Stat) {
    const uv_fd = fd.uv();
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_fstat(uv.Loop.get(), &req, uv_fd, null);

    log("uv fstat({}) = {d}", .{ uv_fd, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .fstat, .fd = fd } }
    else
        .{ .result = req.statbuf };
}

pub fn fdatasync(fd: FileDescriptor) Maybe(void) {
    const uv_fd = fd.uv();
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_fdatasync(uv.Loop.get(), &req, uv_fd, null);

    log("uv fdatasync({}) = {d}", .{ uv_fd, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .fdatasync, .fd = fd } }
    else
        .{ .result = {} };
}

pub fn fsync(fd: FileDescriptor) Maybe(void) {
    const uv_fd = fd.uv();
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_fsync(uv.Loop.get(), &req, uv_fd, null);

    log("uv fsync({d}) = {d}", .{ uv_fd, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .fsync, .fd = fd } }
    else
        .{ .result = {} };
}

pub fn stat(path: [:0]const u8) Maybe(bun.Stat) {
    assertIsValidWindowsPath(u8, path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_stat(uv.Loop.get(), &req, path.ptr, null);

    log("uv stat({s}) = {d}", .{ path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .stat, .path = path } }
    else
        .{ .result = req.statbuf };
}

pub fn lstat(path: [:0]const u8) Maybe(bun.Stat) {
    assertIsValidWindowsPath(u8, path);
    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();
    const rc = uv.uv_fs_lstat(uv.Loop.get(), &req, path.ptr, null);

    log("uv lstat({s}) = {d}", .{ path, rc.int() });
    return if (rc.errno()) |errno|
        .{ .err = .{ .errno = errno, .syscall = .lstat, .path = path } }
    else
        .{ .result = req.statbuf };
}

pub fn close(fd: FileDescriptor) ?bun.sys.Error {
    return fd.closeAllowingBadFileDescriptor(@returnAddress());
}

pub fn closeAllowingStdoutAndStderr(fd: FileDescriptor) ?bun.sys.Error {
    return fd.closeAllowingStandardIo(@returnAddress());
}

pub fn preadv(fd: FileDescriptor, bufs: []const bun.PlatformIOVec, position: i64) Maybe(usize) {
    const uv_fd = fd.uv();
    comptime bun.assert(bun.PlatformIOVec == uv.uv_buf_t);

    const debug_timer = bun.Output.DebugTimer.start();

    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();

    const rc = uv.uv_fs_read(
        uv.Loop.get(),
        &req,
        uv_fd,
        bufs.ptr,
        @intCast(bufs.len),
        position,
        null,
    );

    if (Environment.isDebug) {
        var total_bytes: usize = 0;
        for (bufs) |buf| {
            total_bytes += buf.len;
        }
        log("uv read({}, {d} total bytes) = {d} ({any})", .{ uv_fd, total_bytes, rc.int(), debug_timer });
    }

    if (rc.errno()) |errno| {
        return .{ .err = .{ .errno = errno, .fd = fd, .syscall = .read } };
    } else {
        return .{ .result = @as(usize, @intCast(rc.int())) };
    }
}

pub fn pwritev(fd: FileDescriptor, bufs: []const bun.PlatformIOVecConst, position: i64) Maybe(usize) {
    const uv_fd = fd.uv();
    comptime bun.assert(bun.PlatformIOVec == uv.uv_buf_t);

    const debug_timer = bun.Output.DebugTimer.start();

    var req: uv.fs_t = uv.fs_t.uninitialized;
    defer req.deinit();

    const rc = uv.uv_fs_write(
        uv.Loop.get(),
        &req,
        uv_fd,
        bufs.ptr,
        @intCast(bufs.len),
        position,
        null,
    );

    if (Environment.isDebug) {
        var total_bytes: usize = 0;
        for (bufs) |buf| {
            total_bytes += buf.len;
        }
        log("uv write({}, {d} total bytes) = {d} ({any})", .{ uv_fd, total_bytes, rc.int(), debug_timer });
    }

    if (rc.errno()) |errno| {
        return .{ .err = .{ .errno = errno, .fd = fd, .syscall = .write } };
    } else {
        return .{ .result = @as(usize, @intCast(rc.int())) };
    }
}

pub inline fn readv(fd: FileDescriptor, bufs: []bun.PlatformIOVec) Maybe(usize) {
    return preadv(fd, bufs, -1);
}

pub inline fn pread(fd: FileDescriptor, buf: []u8, position: i64) Maybe(usize) {
    var bufs: [1]bun.PlatformIOVec = .{bun.platformIOVecCreate(buf)};
    return preadv(fd, &bufs, position);
}

pub inline fn read(fd: FileDescriptor, buf: []u8) Maybe(usize) {
    var bufs: [1]bun.PlatformIOVec = .{bun.platformIOVecCreate(buf)};
    return readv(fd, &bufs);
}

pub inline fn writev(fd: FileDescriptor, bufs: []bun.PlatformIOVec) Maybe(usize) {
    return pwritev(fd, bufs, -1);
}

pub inline fn pwrite(fd: FileDescriptor, buf: []const u8, position: i64) Maybe(usize) {
    var bufs: [1]bun.PlatformIOVec = .{bun.platformIOVecCreate(buf)};
    return pwritev(fd, &bufs, position);
}

pub inline fn write(fd: FileDescriptor, buf: []const u8) Maybe(usize) {
    var bufs: [1]bun.PlatformIOVec = .{bun.platformIOVecCreate(buf)};
    return writev(fd, &bufs);
}

pub const Tag = @import("./sys.zig").Tag;
