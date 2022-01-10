const std = @import("std");
const _global = @import("../../../global.zig");
const strings = _global.strings;
const string = _global.string;
const AsyncIO = @import("io");
const JSC = @import("../../../jsc.zig");
const PathString = JSC.PathString;
const Environment = _global.Environment;
const C = _global.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
const Buffer = JSC.MarkedArrayBuffer;
pub const FileDescriptor = os.fd_t;
pub const Flavor = enum {
    sync,
    promise,
    callback,

    pub fn Wrap(comptime this: Flavor, comptime Type: type) type {
        return comptime brk: {
            switch (this) {
                .sync => break :brk Type,
                // .callback => {
                //     const Callback = CallbackTask(Type);
                // },
                else => @compileError("Not implemented yet"),
            }
        };
    }
};

/// Node.js expects the error to include contextual information
/// - "syscall"
/// - "path"
/// - "errno"
pub fn Maybe(comptime ReturnType: type) type {
    return union(Tag) {
        err: Syscall.Error,
        result: ReturnType,

        pub const Tag = enum { err, result };

        pub const success: @This() = @This(){
            .result = std.mem.zeroes(ReturnType),
        };

        pub const todo = .{ .err = Syscall.Error.todo };

        pub inline fn getErrno(this: @This()) os.E {
            return switch (this) {
                .result => os.E.SUCCESS,
                .err => |err| @intToEnum(os.E, err.errno),
            };
        }

        pub inline fn errno(rc: anytype) ?@This() {
            return switch (std.os.errno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .errno = @truncate(Syscall.Error.Int, err),
                },
            };
        }
    };
}

// We can't really use Zig's error handling for syscalls because Node.js expects the "real" errno to be returned
// and various issues with std.os that make it too unstable for arbitrary user input (e.g. how .BADF is marked as unreachable)

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
pub const Encoding = enum {
    utf8,
    ucs2,
    utf16le,
    latin1,
    ascii,
    base64,
    base64url,
    hex,

    /// Refer to the buffer's encoding
    buffer,
};

const PathOrBuffer = union(Tag) {
    path: PathString,
    buffer: Buffer,

    pub const Tag = enum { path, buffer };

    pub inline fn slice(this: PathOrBuffer) []const u8 {
        return this.path.slice();
    }
};

pub const SystemError = struct {
    errno: c_int = 0,
    path: PathString,
    syscall: [:0]const u8 = "",
};

pub fn CallbackTask(comptime Result: type) type {
    return struct {
        callback: JSC.C.JSObjectRef,
        option: Option,
        success: bool = false,
        completion: AsyncIO.Completion,

        pub const Option = union {
            err: SystemError,
            result: Result,
        };
    };
}

const PathLike = union(Tag) {
    string: PathString,
    buffer: void,
    url: void,

    pub const Tag = enum { string, buffer, url };

    pub inline fn slice(this: PathLike) string {
        return this.string.slice();
    }

    pub fn sliceZWithForceCopy(this: PathLike, buf: [:0]u8, comptime force: bool) [:0]const u8 {
        var sliced = this.string.slice();
        if (comptime !force) {
            if (sliced[sliced.len - 1] == 0) {
                var sliced_ptr = sliced.ptr;
                return sliced_ptr[0 .. sliced.len - 1 :0];
            }
        }

        @memcpy(&buf, sliced.ptr, sliced.len);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub inline fn sliceZ(this: PathLike, buf: [:0]u8) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }
};

const PathOrFileDescriptor = union(Tag) {
    path: PathLike,
    fd: FileDescriptor,

    pub const Tag = enum { fd, path };
};
