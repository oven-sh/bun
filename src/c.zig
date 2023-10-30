const std = @import("std");
const bun = @import("root").bun;
const Environment = @import("./env.zig");

const PlatformSpecific = switch (Environment.os) {
    .mac => @import("./darwin_c.zig"),
    .linux => @import("./linux_c.zig"),
    .windows => @import("./windows_c.zig"),
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
// TODO: this is wrong on Windows
const libc_stat = bun.Stat;

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
// TODO: this is wrong on Windows
pub extern "c" fn lstat64([*c]const u8, [*c]libc_stat) c_int;
// TODO: this is wrong on Windows
pub extern "c" fn fstat64([*c]const u8, [*c]libc_stat) c_int;
// TODO: this is wrong on Windows
pub extern "c" fn stat64([*c]const u8, [*c]libc_stat) c_int;
pub extern "c" fn lchmod(path: [*:0]const u8, mode: mode_t) c_int;
pub extern "c" fn truncate([*:0]const u8, i64) c_int; // note: truncate64 is not a thing

pub extern "c" fn lutimes(path: [*:0]const u8, times: *const [2]std.os.timeval) c_int;
pub extern "c" fn mkdtemp(template: [*c]u8) ?[*:0]u8;

pub extern "c" fn memcmp(s1: [*c]const u8, s2: [*c]const u8, n: usize) c_int;
pub extern "c" fn memchr(s: [*]const u8, c: u8, n: usize) ?[*]const u8;

pub const lstat = lstat64;
pub const fstat = fstat64;
pub const stat = stat64;

pub extern "c" fn strchr(str: [*]const u8, char: u8) ?[*]const u8;

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
        .size = @as(u64, @bitCast(st.size)),
        .mode = st.mode,
        .kind = switch (builtin.os.tag) {
            .wasi => switch (st.filetype) {
                os.FILETYPE_BLOCK_DEVICE => Kind.block_device,
                os.FILETYPE_CHARACTER_DEVICE => Kind.character_device,
                os.FILETYPE_DIRECTORY => Kind.directory,
                os.FILETYPE_SYMBOLIC_LINK => Kind.sym_link,
                os.FILETYPE_REGULAR_FILE => Kind.file,
                os.FILETYPE_SOCKET_STREAM, os.FILETYPE_SOCKET_DGRAM => Kind.unix_domain_socket,
                else => Kind.unknown,
            },
            else => switch (st.mode & os.S.IFMT) {
                os.S.IFBLK => Kind.block_device,
                os.S.IFCHR => Kind.character_device,
                os.S.IFDIR => Kind.directory,
                os.S.IFIFO => Kind.named_pipe,
                os.S.IFLNK => Kind.sym_link,
                os.S.IFREG => Kind.file,
                os.S.IFSOCK => Kind.unix_domain_socket,
                else => Kind.unknown,
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
                try copyFileZSlowWithHandle(from_handle, to_dir, destination);
                std.os.unlinkatZ(from_dir, filename, 0) catch {};
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
    const in_handle = try std.os.openatZ(from_dir, filename, std.os.O.RDONLY | std.os.O.CLOEXEC, if (Environment.isWindows) 0 else 0o600);
    defer std.os.close(in_handle);
    try copyFileZSlowWithHandle(in_handle, to_dir, destination);
    std.os.unlinkatZ(from_dir, filename, 0) catch {};
}

pub fn copyFileZSlowWithHandle(in_handle: std.os.fd_t, to_dir: std.os.fd_t, destination: [*:0]const u8) !void {
    const stat_ = if (comptime Environment.isPosix) try std.os.fstat(in_handle) else void{};
    const size = brk: {
        if (comptime Environment.isPosix) {
            break :brk stat_.size;
        }

        break :brk try std.os.windows.GetFileSizeEx(in_handle);
    };

    // delete if exists, don't care if it fails. it may fail due to the file not existing
    // delete here because we run into weird truncation issues if we do not
    // ftruncate() instead didn't work.
    // this is technically racy because it could end up deleting the file without saving
    std.os.unlinkatZ(to_dir, destination, 0) catch {};
    const out_handle = try std.os.openatZ(
        to_dir,
        destination,
        std.os.O.WRONLY | std.os.O.CREAT | std.os.O.CLOEXEC,
        if (comptime Environment.isPosix) 0o022 else 0,
    );
    defer std.os.close(out_handle);
    if (comptime Environment.isLinux) {
        _ = std.os.system.fallocate(out_handle, 0, 0, @as(i64, @intCast(size)));
        _ = try std.os.sendfile(out_handle, in_handle, 0, @as(usize, @intCast(size)), &[_]std.os.iovec_const{}, &[_]std.os.iovec_const{}, 0);
    } else {
        if (comptime Environment.isMac) {
            // if this fails, it doesn't matter
            // we only really care about read & write succeeding
            PlatformSpecific.preallocate_file(
                out_handle,
                @as(std.os.off_t, @intCast(0)),
                @as(std.os.off_t, @intCast(size)),
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

    if (comptime Environment.isPosix) {
        _ = fchmod(out_handle, stat_.mode);
        _ = fchown(out_handle, stat_.uid, stat_.gid);
    }
}

pub fn kindFromMode(mode: os.mode_t) std.fs.File.Kind {
    if (comptime Environment.isWindows) {
        return bun.todo(@src(), std.fs.File.Kind.unknown);
    }
    return switch (mode & os.S.IFMT) {
        os.S.IFBLK => std.fs.File.Kind.block_device,
        os.S.IFCHR => std.fs.File.Kind.character_device,
        os.S.IFDIR => std.fs.File.Kind.directory,
        os.S.IFIFO => std.fs.File.Kind.named_pipe,
        os.S.IFLNK => std.fs.File.Kind.sym_link,
        os.S.IFREG => std.fs.File.Kind.file,
        os.S.IFSOCK => std.fs.File.Kind.unix_domain_socket,
        else => .unknown,
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
                const slice = paths.toOwnedSlice() catch &.{};
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
            return try paths.toOwnedSlice();
        },
        .macos, .ios, .watchos, .tvos => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice() catch &.{};
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
            return try paths.toOwnedSlice();
        },
        // revisit if Haiku implements dl_iterat_phdr (https://dev.haiku-os.org/ticket/15743)
        .haiku => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice() catch &.{};
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }

            var b = "/boot/system/runtime_loader";
            const item = try allocator.dupeZ(u8, mem.sliceTo(b, 0));
            errdefer allocator.free(item);
            try paths.append(item);

            return try paths.toOwnedSlice();
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

pub fn getProcessPriority(pid_: i32) i32 {
    const pid = @as(c_uint, @intCast(pid_));
    return get_process_priority(pid);
}

pub fn setProcessPriority(pid_: i32, priority_: i32) std.c.E {
    if (pid_ < 0) return .SRCH;

    const pid = @as(c_uint, @intCast(pid_));
    const priority = @as(c_int, @intCast(priority_));

    const code: i32 = set_process_priority(pid, priority);

    if (code == -2) return .SRCH;
    if (code == 0) return .SUCCESS;

    const errcode = std.c.getErrno(code);
    return errcode;
}

pub fn getVersion(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_version(buf.ptr[0..bun.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_version(buf);
    } else {
        return bun.todo(@src(), "unknown");
    }
}

pub fn getRelease(buf: []u8) []const u8 {
    if (comptime Environment.isLinux) {
        return linux.get_release(buf.ptr[0..bun.HOST_NAME_MAX]);
    } else if (comptime Environment.isMac) {
        return darwin.get_release(buf);
    } else {
        return bun.todo(@src(), "unknown");
    }
}

pub extern fn memmem(haystack: [*]const u8, haystacklen: usize, needle: [*]const u8, needlelen: usize) ?[*]const u8;
pub extern fn cfmakeraw(*std.os.termios) void;

const LazyStatus = enum {
    pending,
    loaded,
    failed,
};

fn _dlsym(handle: ?*anyopaque, name: [:0]const u8) ?*anyopaque {
    if (comptime Environment.isWindows) {
        return bun.windows.GetProcAddressA(handle, name);
    } else if (comptime Environment.isMac or Environment.isLinux) {
        return std.c.dlsym(handle, name.ptr);
    }

    return bun.todo(@src(), null);
}

pub fn dlsymWithHandle(comptime Type: type, comptime name: [:0]const u8, comptime handle_getter: fn () ?*anyopaque) ?Type {
    if (comptime @typeInfo(Type) != .Pointer) {
        @compileError("dlsym must be a pointer type (e.g. ?const *fn()). Received " ++ @typeName(Type) ++ ".");
    }

    const Wrapper = struct {
        pub var function: Type = undefined;
        pub var loaded: LazyStatus = LazyStatus.pending;
    };

    if (Wrapper.loaded == .pending) {
        const result = _dlsym(@call(.always_inline, handle_getter, .{}), name);

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

pub fn dlsym(comptime Type: type, comptime name: [:0]const u8) ?Type {
    const handle_getter = struct {
        const RTLD_DEFAULT = if (bun.Environment.isMac)
            @as(?*anyopaque, @ptrFromInt(@as(usize, @bitCast(@as(isize, -2)))))
        else
            @as(?*anyopaque, @ptrFromInt(@as(usize, 0)));

        pub fn getter() ?*anyopaque {
            return RTLD_DEFAULT;
        }
    }.getter;

    return dlsymWithHandle(Type, name, handle_getter);
}

// set in c-bindings.cpp
pub extern fn get_process_priority(pid: c_uint) i32;
pub extern fn set_process_priority(pid: c_uint, priority: c_int) i32;

pub extern fn strncasecmp(s1: [*]const u8, s2: [*]const u8, n: usize) i32;
pub extern fn memmove(dest: [*]u8, src: [*]const u8, n: usize) void;

// https://man7.org/linux/man-pages/man3/fmod.3.html
pub extern fn fmod(f64, f64) f64;

pub fn dlopen(filename: [:0]const u8, flags: i32) ?*anyopaque {
    if (comptime Environment.isWindows) {
        return bun.windows.LoadLibraryA(filename);
    }

    return std.c.dlopen(filename, flags);
}
