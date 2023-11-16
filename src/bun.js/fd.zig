const std = @import("std");
const bun = @import("root").bun;
const env = bun.Environment;

const fd_t = std.os.fd_t;
const fd_int = std.meta.Int(.unsigned, @sizeOf(fd_t));

const uv_file = switch (env.os == .windows) {
    .windows => bun.windows.libuv.uv_file,
    else => fd_t,
};

fn handleToNumber(handle: fd_t) fd_int {
    if (@typeInfo(fd_t) == .Pointer) {
        return @intFromPtr(handle);
    } else {
        return handle;
    }
}

fn numberToHandle(handle: fd_int) fd_t {
    if (@typeInfo(fd_t) == .Pointer) {
        return @ptrFromInt(handle);
    } else {
        return handle;
    }
}

// TODO: i dont know if i even want to go with this approach. maybe just using windows apis alone is better.
//       it could be argued all of this extra effort is not worth the friction of simply *doing* the syscalls.

/// Abstraction over file descriptors. This struct does nothing on '!isWindows'
///
/// On Windows builds we have two kinds of file descriptors:
/// - system: A "std.os.windows.HANDLE" that windows APIs can interact with.
///           In this case it is actually just an "*anyopaque" that points to some windows internals.
/// - uv:     A libuv file descriptor that looks like a linux file descriptor.
///
/// When converting UVFDs into Windows FDs, they are still said to be owned by libuv, and they
/// say to NOT close the handle. This is tracked by a flag `owned_by_libuv`.
///
/// Converting a windows pointer into a UVFD one will require that you set this bit
const FD = packed struct {
    owned_by_libuv: if (env.os == .windows) bool else void,
    kind: Kind,
    value: if (env.os == .windows)
        struct { as_system: u62, as_uv: uv_file }
    else
        struct { as_system: uv_file, as_uv: uv_file },

    comptime {
        std.debug.assert(@sizeOf(FD) == @sizeOf(fd_t));

        if (env.os == .windows) {
            // we want the conversion from FD to fd_t to be a integer truncate
            std.debug.assert(@as(FD, @bitCast(@as(u64, 512))).value == 512);
        }
    }

    const Kind = if (env.os == .windows)
        enum(u1) { system, uv }
    else
        enum(u0) { system };

    pub fn initSys(system_fd: fd_t) FD {
        return FD{
            .owned_by_libuv = if (env.os == .windows) false else {},
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn initSysUV(system_fd: fd_t) FD {
        return FD{
            .owned_by_libuv = if (env.os == .windows) true else {},
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn initUV(uv_fd: uv_file) FD {
        return switch (env.os) {
            else => FD{
                .owned_by_libuv = {},
                .kind = .system,
                .value = .{ .as_system = uv_fd },
            },
            .windows => FD{
                .owned_by_libuv = true,
                .kind = .uv,
                .value = .{ .as_uv = uv_fd },
            },
        };
    }
};
