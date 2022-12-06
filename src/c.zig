const std = @import("std");
const bun = @import("bun");
const Environment = @import("./env.zig");

const PlatformSpecific = switch (@import("builtin").target.os.tag) {
    .macos => @import("./darwin_c.zig"),
    .linux => @import("./linux_c.zig"),
    else => struct {},
};
pub usingnamespace PlatformSpecific;

const C = std.c;
const builtin = @import("builtin");
const os = std.os;
const mem = std.mem;
const Stat = std.fs.File.Stat;
const Kind = std.fs.File.Kind;
const StatError = std.fs.File.StatError;
const errno = os.errno;
const mode_t = C.mode_t;
const libc_stat = C.Stat;
const zeroes = mem.zeroes;
pub const darwin = @import("./darwin_c.zig");
pub const linux = @import("./linux_c.zig");
pub extern "c" fn chmod([*c]const u8, mode_t) c_int;
pub extern "c" fn fchmod(std.c.fd_t, mode_t) c_int;
pub extern "c" fn umask(mode_t) mode_t;
pub extern "c" fn fchmodat(c_int, [*c]const u8, mode_t, c_int) c_int;
pub extern "c" fn fchown(std.c.fd_t, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lchown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn chown(path: [*:0]const u8, std.c.uid_t, std.c.gid_t) c_int;
pub extern "c" fn lstat64([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn fstat64([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn stat64([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn lchmod(path: [*:0]const u8, mode: mode_t) c_int;
pub extern "c" fn truncate([*:0]const u8, i64) c_int; // note: truncate64 is not a thing

pub extern "c" fn lutimes(path: [*:0]const u8, times: *const [2]std.os.timeval) c_int;
pub extern "c" fn mkdtemp(template: [*c]u8) ?[*:0]u8;

pub const lstat = lstat64;
pub const fstat = fstat64;
pub const stat = stat64;

pub fn lstat_absolute(path: [:0]const u8) !Stat {
    if (builtin.os.tag == .windows) {
        @compileError("Not implemented yet");
    }

    var st = zeroes(libc_stat);
    switch (errno(lstat64(path.ptr, &st))) {
        .SUCCESS => {},
        .NOENT => return error.FileNotFound,
        // .EINVAL => unreachable,
        .BADF => unreachable, // Always a race condition.
        .NOMEM => return error.SystemResources,
        .ACCES => return error.AccessDenied,
        else => |err| return os.unexpectedErrno(err),
    }

    const atime = st.atime();
    const mtime = st.mtime();
    const ctime = st.ctime();
    return Stat{
        .inode = st.ino,
        .size = @bitCast(u64, st.size),
        .mode = st.mode,
        .kind = switch (builtin.os.tag) {
            .wasi => switch (st.filetype) {
                os.FILETYPE_BLOCK_DEVICE => Kind.BlockDevice,
                os.FILETYPE_CHARACTER_DEVICE => Kind.CharacterDevice,
                os.FILETYPE_DIRECTORY => Kind.Directory,
                os.FILETYPE_SYMBOLIC_LINK => Kind.SymLink,
                os.FILETYPE_REGULAR_FILE => Kind.File,
                os.FILETYPE_SOCKET_STREAM, os.FILETYPE_SOCKET_DGRAM => Kind.UnixDomainSocket,
                else => Kind.Unknown,
            },
            else => switch (st.mode & os.S.IFMT) {
                os.S.IFBLK => Kind.BlockDevice,
                os.S.IFCHR => Kind.CharacterDevice,
                os.S.IFDIR => Kind.Directory,
                os.S.IFIFO => Kind.NamedPipe,
                os.S.IFLNK => Kind.SymLink,
                os.S.IFREG => Kind.File,
                os.S.IFSOCK => Kind.UnixDomainSocket,
                else => Kind.Unknown,
            },
        },
        .atime = @as(i128, atime.tv_sec) * std.time.ns_per_s + atime.tv_nsec,
        .mtime = @as(i128, mtime.tv_sec) * std.time.ns_per_s + mtime.tv_nsec,
        .ctime = @as(i128, ctime.tv_sec) * std.time.ns_per_s + ctime.tv_nsec,
    };
}

// renameatZ fails when renaming across mount points
// we assume that this is relatively uncommon
pub fn moveFileZ(from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    std.os.renameatZ(from_dir, filename, to_dir, destination) catch |err| {
        switch (err) {
            error.RenameAcrossMountPoints => {
                try moveFileZSlow(from_dir, filename, to_dir, destination);
            },
            else => {
                return err;
            },
        }
    };
}

pub fn moveFileZWithHandle(from_handle: std.os.fd_t, from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    std.os.renameatZ(from_dir, filename, to_dir, destination) catch |err| {
        switch (err) {
            error.RenameAcrossMountPoints => {
                try moveFileZSlowWithHandle(from_handle, to_dir, destination);
            },
            else => {
                return err;
            },
        }
    };
}

// On Linux, this will be fast because sendfile() supports copying between two file descriptors on disk
// macOS & BSDs will be slow because
pub fn moveFileZSlow(from_dir: std.os.fd_t, filename: [*:0]const u8, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const in_handle = try std.os.openatZ(from_dir, filename, std.os.O.RDONLY | std.os.O.CLOEXEC, 0600);
    try moveFileZSlowWithHandle(in_handle, to_dir, destination);
}

pub fn moveFileZSlowWithHandle(in_handle: std.os.fd_t, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const stat_ = try std.os.fstat(in_handle);
    // delete if exists, don't care if it fails. it may fail due to the file not existing
    // delete here because we run into weird truncation issues if we do not
    // ftruncate() instead didn't work.
    // this is technically racy because it could end up deleting the file without saving
    std.os.unlinkatZ(to_dir, destination, 0) catch {};
    const out_handle = try std.os.openatZ(to_dir, destination, std.os.O.WRONLY | std.os.O.CREAT | std.os.O.CLOEXEC, 022);
    defer std.os.close(out_handle);
    if (comptime Environment.isLinux) {
        _ = std.os.system.fallocate(out_handle, 0, 0, @intCast(i64, stat_.size));
        _ = try std.os.sendfile(out_handle, in_handle, 0, @intCast(usize, stat_.size), &[_]std.os.iovec_const{}, &[_]std.os.iovec_const{}, 0);
    } else {
        if (comptime Environment.isMac) {
            // if this fails, it doesn't matter
            // we only really care about read & write succeeding
            PlatformSpecific.preallocate_file(
                out_handle,
                @intCast(std.os.off_t, 0),
                @intCast(std.os.off_t, stat_.size),
            ) catch {};
        }

        var buf: [8092 * 2]u8 = undefined;
        var total_read: usize = 0;
        while (true) {
            const read = try std.os.pread(in_handle, &buf, total_read);
            total_read += read;
            if (read == 0) break;
            const bytes = buf[0..read];
            const written = try std.os.write(out_handle, bytes);
            if (written == 0) break;
        }
    }

    _ = fchmod(out_handle, stat_.mode);
    _ = fchown(out_handle, stat_.uid, stat_.gid);
}

pub fn kindFromMode(mode: os.mode_t) std.fs.File.Kind {
    return switch (mode & os.S.IFMT) {
        os.S.IFBLK => std.fs.File.Kind.BlockDevice,
        os.S.IFCHR => std.fs.File.Kind.CharacterDevice,
        os.S.IFDIR => std.fs.File.Kind.Directory,
        os.S.IFIFO => std.fs.File.Kind.NamedPipe,
        os.S.IFLNK => std.fs.File.Kind.SymLink,
        os.S.IFREG => std.fs.File.Kind.File,
        os.S.IFSOCK => std.fs.File.Kind.UnixDomainSocket,
        else => .Unknown,
    };
}

pub fn getSelfExeSharedLibPaths(allocator: std.mem.Allocator) error{OutOfMemory}![][:0]u8 {
    const List = std.ArrayList([:0]u8);
    switch (builtin.os.tag) {
        .linux,
        .freebsd,
        .netbsd,
        .dragonfly,
        .openbsd,
        .solaris,
        => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            try os.dl_iterate_phdr(&paths, error{OutOfMemory}, struct {
                fn callback(info: *os.dl_phdr_info, size: usize, list: *List) !void {
                    _ = size;
                    const name = info.dlpi_name orelse return;
                    if (name[0] == '/') {
                        const item = try list.allocator.dupeZ(u8, mem.sliceTo(name, 0));
                        errdefer list.allocator.free(item);
                        try list.append(item);
                    }
                }
            }.callback);
            return paths.toOwnedSlice();
        },
        .macos, .ios, .watchos, .tvos => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            const img_count = std.c._dyld_image_count();
            var i: u32 = 0;
            while (i < img_count) : (i += 1) {
                const name = std.c._dyld_get_image_name(i);
                const item = try allocator.dupeZ(u8, mem.sliceTo(name, 0));
                errdefer allocator.free(item);
                try paths.append(item);
            }
            return paths.toOwnedSlice();
        },
        // revisit if Haiku implements dl_iterat_phdr (https://dev.haiku-os.org/ticket/15743)
        .haiku => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }

            var b = "/boot/system/runtime_loader";
            const item = try allocator.dupeZ(u8, mem.sliceTo(b, 0));
            errdefer allocator.free(item);
            try paths.append(item);

            return paths.toOwnedSlice();
        },
        else => @compileError("getSelfExeSharedLibPaths unimplemented for this target"),
    }
}

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
///     MADV_FREE        Indicates that the application will not need the infor-mation information
///                      mation contained in this address range, so the pages may
///                      be reused right away.  The address range will remain
///                      valid.  This is used with madvise() system call.
///
///     The posix_madvise() behaves same as madvise() except that it uses values
///     with POSIX_ prefix for the advice system call argument.
pub extern "c" fn posix_madvise(ptr: *anyopaque, len: usize, advice: i32) c_int;

// System related
pub fn getFreeMemory() u64 {
    if (comptime Environment.isLinux) {
        return linux.get_free_memory();
    } else if (comptime Environment.isMac) {
        return darwin.get_free_memory();
    } else {
        return -1;
    }
}

pub fn getTotalMemory() u64 {
    if (comptime Environment.isLinux) {
        return linux.get_total_memory();
    } else if (comptime Environment.isMac) {
        return darwin.get_total_memory();
    } else {
        return -1;
    }
}

pub fn getSystemUptime() u64 {
    if (comptime Environment.isLinux) {
        return linux.get_system_uptime();
    } else {
        return darwin.get_system_uptime();
    }
}

pub fn getSystemLoadavg() [3]f64 {
    if (comptime Environment.isLinux) {
        return linux.get_system_loadavg();
    } else {
        return darwin.get_system_loadavg();
    }
}

pub fn getProcessPriority(pid_: i32) i32 {
    const pid = @intCast(c_uint, pid_);

    if (comptime Environment.isLinux) {
        return linux.get_process_priority(pid);
    } else if (comptime Environment.isMac) {
        return darwin.get_process_priority(pid);
    } else {
        return -1;
    }
}

pub fn setProcessPriority(pid_: i32, priority_: i32) std.c.E {
    if (pid_ < 0) return .SRCH;

    const pid = @intCast(c_uint, pid_);
    const priority = @intCast(c_int, priority_);

    var code: i32 = 0;
    if (comptime Environment.isLinux) {
        code = linux.set_process_priority(pid, priority);
    } else if (comptime Environment.isMac) {
        code = darwin.set_process_priority(pid, priority);
    } else {
        code = -2;
    }

    if (code == -2) return .SRCH;
    if (code == 0) return .SUCCESS;

    const errcode = std.c.getErrno(code);
    return errcode;
}

pub fn getVersion(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_version(buf.ptr[0..std.os.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_version(buf);
    } else {
        return "unknown";
    }
}

pub fn getRelease(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_release(buf.ptr[0..std.os.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_release(buf);
    } else {
        return "unknown";
    }
}

pub extern fn memmem(haystack: [*]const u8, haystacklen: usize, needle: [*]const u8, needlelen: usize) ?[*]const u8;
pub extern fn cfmakeraw(*std.os.termios) void;

const LazyStatus = enum {
    pending,
    loaded,
    failed,
};
pub fn dlsym(comptime Type: type, comptime name: [:0]const u8) ?Type {
    const Wrapper = struct {
        pub var function: Type = undefined;
        pub var loaded: LazyStatus = LazyStatus.pending;
    };

    if (Wrapper.loaded == .pending) {
        const RTLD_DEFAULT = if (bun.Environment.isMac)
            @intToPtr(?*anyopaque, @bitCast(usize, @as(isize, -2)))
        else
            @intToPtr(?*anyopaque, @as(usize, 0));
        const result = std.c.dlsym(RTLD_DEFAULT, name);

        if (result) |ptr| {
            Wrapper.function = bun.cast(Type, ptr);
            Wrapper.loaded = .loaded;
            return Wrapper.function;
        } else {
            Wrapper.loaded = .failed;
            return null;
        }
    }

    if (Wrapper.loaded == .loaded) {
        return Wrapper.function;
    }

    return null;
}
