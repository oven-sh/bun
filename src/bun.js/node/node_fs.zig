// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated
const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("root").bun.AsyncIO;
const JSC = @import("root").bun.JSC;
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Flavor = JSC.Node.Flavor;
const system = std.os.system;
const Maybe = JSC.Maybe;
const Encoding = JSC.Node.Encoding;
const Syscall = @import("./syscall.zig");
const Constants = @import("./node_fs_constant.zig").Constants;
const builtin = @import("builtin");
const os = @import("std").os;
const darwin = os.darwin;
const linux = os.linux;
const PathOrBuffer = JSC.Node.PathOrBuffer;
const PathLike = JSC.Node.PathLike;
const PathOrFileDescriptor = JSC.Node.PathOrFileDescriptor;
const FileDescriptor = bun.FileDescriptor;
const DirIterator = @import("./dir_iterator.zig");
const Path = @import("../../resolver/resolve_path.zig");
const FileSystem = @import("../../fs.zig").FileSystem;
const StringOrBuffer = JSC.Node.StringOrBuffer;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const TimeLike = JSC.Node.TimeLike;
const Mode = JSC.Node.Mode;

const uid_t = std.os.uid_t;
const gid_t = std.os.gid_t;

/// u63 to allow one null bit
const ReadPosition = u63;

const Stats = JSC.Node.Stats;
const Dirent = JSC.Node.Dirent;

pub const FlavoredIO = struct {
    io: *AsyncIO,
};

pub const default_permission = Syscall.S.IRUSR |
    Syscall.S.IWUSR |
    Syscall.S.IRGRP |
    Syscall.S.IWGRP |
    Syscall.S.IROTH |
    Syscall.S.IWOTH;

const ArrayBuffer = JSC.MarkedArrayBuffer;
const Buffer = JSC.Buffer;
const FileSystemFlags = JSC.Node.FileSystemFlags;

// TODO: to improve performance for all of these
// The tagged unions for each type should become regular unions
// and the tags should be passed in as comptime arguments to the functions performing the syscalls
// This would reduce stack size, at the cost of instruction cache misses
pub const Arguments = struct {
    pub const Rename = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Rename {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "oldPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "newPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            return Rename{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Truncate = struct {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        path: PathOrFileDescriptor,
        len: JSC.WebCore.Blob.SizeType = 0,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Truncate {
            const path = PathOrFileDescriptor.fromJS(ctx, arguments, arguments.arena.allocator(), exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const len: JSC.WebCore.Blob.SizeType = brk: {
                const len_value = arguments.next() orelse break :brk 0;

                if (len_value.isNumber()) {
                    arguments.eat();
                    break :brk len_value.to(JSC.WebCore.Blob.SizeType);
                }

                break :brk 0;
            };

            return Truncate{ .path = path, .len = len };
        }
    };

    pub const FTruncate = struct {
        fd: FileDescriptor,
        len: ?JSC.WebCore.Blob.SizeType = null,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FTruncate {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

            const len: JSC.WebCore.Blob.SizeType = brk: {
                const len_value = arguments.next() orelse break :brk 0;
                if (len_value.isNumber()) {
                    arguments.eat();
                    break :brk len_value.to(JSC.WebCore.Blob.SizeType);
                }

                break :brk 0;
            };

            return FTruncate{ .fd = fd, .len = len };
        }
    };

    pub const Chown = struct {
        path: PathLike,
        uid: uid_t = 0,
        gid: gid_t = 0,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Chown {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "uid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @intCast(uid_t, uid_value.toInt32());
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "gid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @intCast(gid_t, gid_value.toInt32());
            };

            return Chown{ .path = path, .uid = uid, .gid = gid };
        }
    };

    pub const Fchown = struct {
        fd: FileDescriptor,
        uid: uid_t,
        gid: gid_t,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fchown {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "uid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @intCast(uid_t, uid_value.toInt32());
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "gid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @intCast(gid_t, gid_value.toInt32());
            };

            return Fchown{ .fd = fd, .uid = uid, .gid = gid };
        }
    };

    pub const LChown = Chown;

    pub const Lutimes = struct {
        path: PathLike,
        atime: TimeLike,
        mtime: TimeLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Lutimes {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }

                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime must be a number or a Date",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }

                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime must be a number or a Date",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            return Lutimes{ .path = path, .atime = atime, .mtime = mtime };
        }
    };

    pub const Chmod = struct {
        path: PathLike,
        mode: Mode = 0x777,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Chmod {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const mode: Mode = JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode must be a string or integer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            return Chmod{ .path = path, .mode = mode };
        }
    };

    pub const FChmod = struct {
        fd: FileDescriptor,
        mode: Mode = 0x777,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FChmod {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            arguments.eat();

            const mode: Mode = JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode must be a string or integer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            return FChmod{ .fd = fd, .mode = mode };
        }
    };

    pub const LCHmod = Chmod;

    pub const Stat = struct {
        path: PathLike,
        big_int: bool = false,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Stat {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.ptr().vm())) break :brk false;
                        arguments.eat();

                        if (next_val.getIfPropertyExists(ctx.ptr(), "bigint")) |big_int| {
                            break :brk big_int.toBoolean();
                        }
                    }
                }
                break :brk false;
            };

            if (exception.* != null) return null;

            return Stat{ .path = path, .big_int = big_int };
        }
    };

    pub const Fstat = struct {
        fd: FileDescriptor,
        big_int: bool = false,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fstat {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.ptr().vm())) break :brk false;
                        arguments.eat();

                        if (next_val.getIfPropertyExists(ctx.ptr(), "bigint")) |big_int| {
                            break :brk big_int.toBoolean();
                        }
                    }
                }
                break :brk false;
            };

            if (exception.* != null) return null;

            return Fstat{ .fd = fd, .big_int = big_int };
        }
    };

    pub const Lstat = Stat;

    pub const Link = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Link {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "oldPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "newPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Link{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Symlink = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Symlink {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "target must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            if (arguments.next()) |next_val| {
                // The type argument is only available on Windows and
                // ignored on other platforms. It can be set to 'dir',
                // 'file', or 'junction'. If the type argument is not set,
                // Node.js will autodetect target type and use 'file' or
                // 'dir'. If the target does not exist, 'file' will be used.
                // Windows junction points require the destination path to
                // be absolute. When using 'junction', the target argument
                // will automatically be normalized to absolute path.
                if (next_val.isString()) {
                    comptime if (Environment.isWindows) @compileError("Add support for type argument on Windows");
                    arguments.eat();
                }
            }

            return Symlink{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Readlink = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Readlink {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromStringValue(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
                        }
                    },
                }
            }

            return Readlink{ .path = path, .encoding = encoding };
        }
    };

    pub const Realpath = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Realpath {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromStringValue(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
                        }
                    },
                }
            }

            return Realpath{ .path = path, .encoding = encoding };
        }
    };

    pub const Unlink = struct {
        path: PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Unlink {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Unlink{
                .path = path,
            };
        }
    };

    pub const Rm = struct {
        path: PathLike,
        force: bool = false,
        max_retries: u32 = 0,
        recursive: bool = false,
        retry_delay: c_uint = 100,
    };

    pub const RmDir = struct {
        path: PathLike,

        force: bool = false,

        max_retries: u32 = 0,
        recursive: bool = false,
        retry_delay: c_uint = 100,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?RmDir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var recursive = false;
            var force = false;
            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.get(ctx.ptr(), "recursive")) |boolean| {
                        recursive = boolean.toBoolean();
                    }

                    if (val.get(ctx.ptr(), "force")) |boolean| {
                        force = boolean.toBoolean();
                    }
                }
            }

            return RmDir{
                .path = path,
                .recursive = recursive,
                .force = force,
            };
        }
    };

    /// https://github.com/nodejs/node/blob/master/lib/fs.js#L1285
    pub const Mkdir = struct {
        path: PathLike,
        /// Indicates whether parent folders should be created.
        /// If a folder was created, the path to the first created folder will be returned.
        /// @default false
        recursive: bool = false,
        /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
        /// @default
        mode: Mode = 0o777,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Mkdir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var recursive = false;
            var mode: Mode = 0o777;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.getIfPropertyExists(ctx.ptr(), "recursive")) |recursive_| {
                        recursive = recursive_.toBoolean();
                    }

                    if (val.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse mode;
                    }
                }
            }

            return Mkdir{
                .path = path,
                .recursive = recursive,
                .mode = mode,
            };
        }
    };

    const MkdirTemp = struct {
        prefix: JSC.Node.SliceOrBuffer = .{ .buffer = .{ .buffer = JSC.ArrayBuffer.empty } },
        encoding: Encoding = Encoding.utf8,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?MkdirTemp {
            const prefix_value = arguments.next() orelse return MkdirTemp{};

            var prefix = JSC.Node.SliceOrBuffer.fromJS(ctx, arguments.arena.allocator(), prefix_value) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "prefix must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            arguments.eat();

            var encoding = Encoding.utf8;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromStringValue(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
                        }
                    },
                }
            }

            return MkdirTemp{
                .prefix = prefix,
                .encoding = encoding,
            };
        }
    };

    pub const Readdir = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,
        with_file_types: bool = false,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Readdir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.utf8;
            var with_file_types = false;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromStringValue(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }

                            if (val.getIfPropertyExists(ctx.ptr(), "withFileTypes")) |with_file_types_| {
                                with_file_types = with_file_types_.toBoolean();
                            }
                        }
                    },
                }
            }

            return Readdir{
                .path = path,
                .encoding = encoding,
                .with_file_types = with_file_types,
            };
        }
    };

    pub const Close = struct {
        fd: FileDescriptor,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Close {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Close{
                .fd = fd,
            };
        }
    };

    pub const Open = struct {
        path: PathLike,
        flags: FileSystemFlags = FileSystemFlags.r,
        mode: Mode = default_permission,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Open {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var flags = FileSystemFlags.r;
            var mode: Mode = default_permission;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.getTruthy(ctx.ptr(), "flags")) |flags_| {
                        flags = FileSystemFlags.fromJS(ctx, flags_, exception) orelse flags;
                    }

                    if (val.getTruthy(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse mode;
                    }
                } else if (!val.isEmpty()) {
                    if (!val.isUndefinedOrNull())
                        // error is handled below
                        flags = FileSystemFlags.fromJS(ctx, val, exception) orelse flags;

                    if (arguments.nextEat()) |next| {
                        mode = JSC.Node.modeFromJS(ctx, next, exception) orelse mode;
                    }
                }
            }

            if (exception.* != null) return null;

            return Open{
                .path = path,
                .flags = flags,
                .mode = mode,
            };
        }
    };

    /// Change the file system timestamps of the object referenced by `path`.
    ///
    /// The `atime` and `mtime` arguments follow these rules:
    ///
    /// * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
    /// * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
    /// @since v0.4.2
    pub const Utimes = Lutimes;

    pub const Futimes = struct {
        fd: FileDescriptor,
        atime: TimeLike,
        mtime: TimeLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Futimes {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };
            arguments.eat();
            if (exception.* != null) return null;

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime must be a number, Date or string",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime must be a number, Date or string",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Futimes{
                .fd = fd,
                .atime = atime,
                .mtime = mtime,
            };
        }
    };

    pub const FSync = struct {
        fd: FileDescriptor,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FSync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return FSync{
                .fd = fd,
            };
        }
    };

    /// Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
    /// must have an own `toString` function property.
    ///
    /// `offset` determines the part of the buffer to be written, and `length` is
    /// an integer specifying the number of bytes to write.
    ///
    /// `position` refers to the offset from the beginning of the file where this data
    /// should be written. If `typeof position !== 'number'`, the data will be written
    /// at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
    ///
    /// The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
    ///
    /// If this method is invoked as its `util.promisify()` ed version, it returns
    /// a promise for an `Object` with `bytesWritten` and `buffer` properties.
    ///
    /// It is unsafe to use `fs.write()` multiple times on the same file without waiting
    /// for the callback. For this scenario, {@link createWriteStream} is
    /// recommended.
    ///
    /// On Linux, positional writes don't work when the file is opened in append mode.
    /// The kernel ignores the position argument and always appends the data to
    /// the end of the file.
    /// @since v0.0.2
    ///
    pub const Write = struct {
        fd: FileDescriptor,
        buffer: StringOrBuffer,
        // buffer_val: JSC.JSValue = JSC.JSValue.zero,
        offset: u64 = 0,
        length: u64 = std.math.maxInt(u64),
        position: ?ReadPosition = null,
        encoding: Encoding = Encoding.buffer,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Write {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

            const buffer = StringOrBuffer.fromJS(ctx.ptr(), arguments.arena.allocator(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };
            if (exception.* != null) return null;

            var args = Write{
                .fd = fd,
                .buffer = buffer,
                .encoding = switch (buffer) {
                    .string => Encoding.utf8,
                    .buffer => Encoding.buffer,
                },
            };

            arguments.eat();

            // TODO: make this faster by passing argument count at comptime
            if (arguments.next()) |current_| {
                parse: {
                    var current = current_;
                    switch (buffer) {
                        // fs.write(fd, string[, position[, encoding]], callback)
                        .string => {
                            if (current.isNumber()) {
                                args.position = current.toU32();
                                arguments.eat();
                                current = arguments.next() orelse break :parse;
                            }

                            if (current.isString()) {
                                args.encoding = Encoding.fromStringValue(current, ctx.ptr()) orelse Encoding.utf8;
                                arguments.eat();
                            }
                        },
                        // fs.write(fd, buffer[, offset[, length[, position]]], callback)
                        .buffer => {
                            if (!current.isNumber()) {
                                break :parse;
                            }

                            if (!current.isNumber()) break :parse;
                            args.offset = current.toU32();
                            arguments.eat();
                            current = arguments.next() orelse break :parse;

                            if (!current.isNumber()) break :parse;
                            args.length = current.toU32();
                            arguments.eat();
                            current = arguments.next() orelse break :parse;

                            if (!current.isNumber()) break :parse;
                            args.position = current.toU32();
                            arguments.eat();
                        },
                    }
                }
            }

            return args;
        }
    };

    pub const Read = struct {
        fd: FileDescriptor,
        buffer: Buffer,
        offset: u64 = 0,
        length: u64 = std.math.maxInt(u64),
        position: ?ReadPosition = null,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Read {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

            const buffer = Buffer.fromJS(ctx.ptr(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffer is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffer must be a TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            arguments.eat();

            var args = Read{
                .fd = fd,
                .buffer = buffer,
            };

            if (arguments.next()) |current| {
                arguments.eat();
                if (current.isNumber()) {
                    args.offset = current.toU32();

                    if (arguments.remaining.len < 2) {
                        JSC.throwInvalidArguments(
                            "length and position are required",
                            .{},
                            ctx,
                            exception,
                        );

                        return null;
                    }

                    args.length = arguments.remaining[0].toU32();

                    if (args.length == 0) {
                        JSC.throwInvalidArguments(
                            "length must be greater than 0",
                            .{},
                            ctx,
                            exception,
                        );

                        return null;
                    }

                    const position: i32 = if (arguments.remaining[1].isNumber())
                        arguments.remaining[1].toInt32()
                    else
                        -1;

                    args.position = if (position > -1) @intCast(ReadPosition, position) else null;
                    arguments.remaining = arguments.remaining[2..];
                } else if (current.isObject()) {
                    if (current.getIfPropertyExists(ctx.ptr(), "offset")) |num| {
                        args.offset = num.toU32();
                    }

                    if (current.getIfPropertyExists(ctx.ptr(), "length")) |num| {
                        args.length = num.toU32();
                    }

                    if (current.getIfPropertyExists(ctx.ptr(), "position")) |num| {
                        const position: i32 = if (num.isEmptyOrUndefinedOrNull()) -1 else num.coerce(i32, ctx);
                        if (position > -1) {
                            args.position = @intCast(ReadPosition, position);
                        }
                    }
                }
            }

            return args;
        }
    };

    /// Asynchronously reads the entire contents of a file.
    /// @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
    /// If a file descriptor is provided, the underlying file will _not_ be closed automatically.
    /// @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
    /// If a flag is not provided, it defaults to `'r'`.
    pub const ReadFile = struct {
        path: PathOrFileDescriptor,
        encoding: Encoding = Encoding.utf8,

        offset: JSC.WebCore.Blob.SizeType = 0,
        max_size: ?JSC.WebCore.Blob.SizeType = null,

        flag: FileSystemFlags = FileSystemFlags.r,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?ReadFile {
            const path = PathOrFileDescriptor.fromJS(ctx, arguments, arguments.arena.allocator(), exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromStringValue(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                        if (!encoding_.isUndefinedOrNull()) {
                            encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse {
                                if (exception.* == null) {
                                    JSC.throwInvalidArguments(
                                        "Invalid encoding",
                                        .{},
                                        ctx,
                                        exception,
                                    );
                                }
                                return null;
                            };
                        }
                    }

                    if (arg.getTruthy(ctx.ptr(), "flag")) |flag_| {
                        flag = FileSystemFlags.fromJS(ctx, flag_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }
                }
            }

            // Note: Signal is not implemented
            return ReadFile{
                .path = path,
                .encoding = encoding,
                .flag = flag,
            };
        }
    };

    pub const WriteFile = struct {
        encoding: Encoding = Encoding.utf8,
        flag: FileSystemFlags = FileSystemFlags.w,
        mode: Mode = 0o666,
        file: PathOrFileDescriptor,
        data: StringOrBuffer,
        dirfd: FileDescriptor = @intCast(FileDescriptor, std.fs.cwd().fd),

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?WriteFile {
            const file = PathOrFileDescriptor.fromJS(ctx, arguments, arguments.arena.allocator(), exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const data = StringOrBuffer.fromJS(ctx.ptr(), arguments.arena.allocator(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            arguments.eat();

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.w;
            var mode: Mode = default_permission;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromStringValue(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getTruthy(ctx.ptr(), "encoding")) |encoding_| {
                        encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flag")) |flag_| {
                        flag = FileSystemFlags.fromJS(ctx, flag_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }
                }
            }

            // Note: Signal is not implemented
            return WriteFile{
                .file = file,
                .encoding = encoding,
                .flag = flag,
                .mode = mode,
                .data = data,
            };
        }
    };

    pub const AppendFile = WriteFile;

    pub const OpenDir = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        /// Number of directory entries that are buffered internally when reading from the directory. Higher values lead to better performance but higher memory usage. Default: 32
        buffer_size: c_int = 32,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?OpenDir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.buffer;
            var buffer_size: c_int = 32;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromStringValue(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                        if (!encoding_.isUndefinedOrNull()) {
                            encoding = Encoding.fromStringValue(encoding_, ctx.ptr()) orelse {
                                if (exception.* == null) {
                                    JSC.throwInvalidArguments(
                                        "Invalid encoding",
                                        .{},
                                        ctx,
                                        exception,
                                    );
                                }
                                return null;
                            };
                        }
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "bufferSize")) |buffer_size_| {
                        buffer_size = buffer_size_.toInt32();
                        if (buffer_size < 0) {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "bufferSize must be > 0",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        }
                    }
                }
            }

            return OpenDir{
                .path = path,
                .encoding = encoding,
                .buffer_size = buffer_size,
            };
        }
    };
    pub const Exists = struct {
        path: ?PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Exists {
            return Exists{
                .path = PathLike.fromJS(ctx, arguments, exception),
            };
        }
    };

    pub const Access = struct {
        path: PathLike,
        mode: FileSystemFlags = FileSystemFlags.r,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Access {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var mode = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    mode = FileSystemFlags.fromJS(ctx, arg, exception) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid mode",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                }
            }

            return Access{
                .path = path,
                .mode = mode,
            };
        }
    };

    pub const CreateReadStream = struct {
        file: PathOrFileDescriptor,
        flags: FileSystemFlags = FileSystemFlags.r,
        encoding: Encoding = Encoding.utf8,
        mode: Mode = default_permission,
        autoClose: bool = true,
        emitClose: bool = true,
        start: i32 = 0,
        end: i32 = std.math.maxInt(i32),
        highwater_mark: u32 = 64 * 1024,
        global_object: *JSC.JSGlobalObject,

        pub fn copyToState(this: CreateReadStream, state: *JSC.Node.Readable.State) void {
            state.encoding = this.encoding;
            state.highwater_mark = this.highwater_mark;
            state.start = this.start;
            state.end = this.end;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CreateReadStream {
            var path = PathLike.fromJS(ctx, arguments, exception);
            if (exception.* != null) return null;
            if (path == null) arguments.eat();

            var stream = CreateReadStream{
                .file = undefined,
                .global_object = ctx.ptr(),
            };
            var fd: FileDescriptor = bun.invalid_fd;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    stream.encoding = Encoding.fromStringValue(arg, ctx.ptr()) orelse {
                        if (exception.* != null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        stream.mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid mode",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding| {
                        stream.encoding = Encoding.fromStringValue(encoding, ctx.ptr()) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flags")) |flags| {
                        stream.flags = FileSystemFlags.fromJS(ctx, flags, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flags",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "fd")) |flags| {
                        fd = JSC.Node.fileDescriptorFromJS(ctx, flags, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid file descriptor",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "autoClose")) |autoClose| {
                        stream.autoClose = autoClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "emitClose")) |emitClose| {
                        stream.emitClose = emitClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "start")) |start| {
                        stream.start = start.coerce(i32, ctx);
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "end")) |end| {
                        stream.end = end.coerce(i32, ctx);
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "highWaterMark")) |highwaterMark| {
                        stream.highwater_mark = highwaterMark.toU32();
                    }
                }
            }

            if (fd != bun.invalid_fd) {
                stream.file = .{ .fd = fd };
            } else if (path) |path_| {
                stream.file = .{ .path = path_ };
            } else {
                JSC.throwInvalidArguments("Missing path or file descriptor", .{}, ctx, exception);
                return null;
            }
            return stream;
        }
    };

    pub const CreateWriteStream = struct {
        file: PathOrFileDescriptor,
        flags: FileSystemFlags = FileSystemFlags.w,
        encoding: Encoding = Encoding.utf8,
        mode: Mode = default_permission,
        autoClose: bool = true,
        emitClose: bool = true,
        start: i32 = 0,
        highwater_mark: u32 = 256 * 1024,
        global_object: *JSC.JSGlobalObject,

        pub fn copyToState(this: CreateWriteStream, state: *JSC.Node.Writable.State) void {
            state.encoding = this.encoding;
            state.highwater_mark = this.highwater_mark;
            state.start = this.start;
            state.emit_close = this.emitClose;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CreateWriteStream {
            var path = PathLike.fromJS(ctx, arguments, exception);
            if (exception.* != null) return null;
            if (path == null) arguments.eat();

            var stream = CreateWriteStream{
                .file = undefined,
                .global_object = ctx.ptr(),
            };
            var fd: FileDescriptor = bun.invalid_fd;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    stream.encoding = Encoding.fromStringValue(arg, ctx.ptr()) orelse {
                        if (exception.* != null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        stream.mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid mode",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding| {
                        stream.encoding = Encoding.fromStringValue(encoding, ctx.ptr()) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flags")) |flags| {
                        stream.flags = FileSystemFlags.fromJS(ctx, flags, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flags",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "fd")) |flags| {
                        fd = JSC.Node.fileDescriptorFromJS(ctx, flags, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid file descriptor",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "autoClose")) |autoClose| {
                        stream.autoClose = autoClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "emitClose")) |emitClose| {
                        stream.emitClose = emitClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "start")) |start| {
                        stream.start = start.toInt32();
                    }
                }
            }

            if (fd != bun.invalid_fd) {
                stream.file = .{ .fd = fd };
            } else if (path) |path_| {
                stream.file = .{ .path = path_ };
            } else {
                JSC.throwInvalidArguments("Missing path or file descriptor", .{}, ctx, exception);
                return null;
            }
            return stream;
        }
    };

    pub const FdataSync = struct {
        fd: FileDescriptor,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FdataSync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return FdataSync{
                .fd = fd,
            };
        }
    };

    pub const CopyFile = struct {
        src: PathLike,
        dest: PathLike,
        mode: Constants.Copyfile,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CopyFile {
            const src = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "src must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const dest = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "dest must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var mode: i32 = 0;
            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isNumber()) {
                    mode = arg.coerce(i32, ctx);
                }
            }

            return CopyFile{
                .src = src,
                .dest = dest,
                .mode = @intToEnum(Constants.Copyfile, mode),
            };
        }
    };

    pub const WriteEv = struct {
        fd: FileDescriptor,
        buffers: []const ArrayBuffer,
        position: ReadPosition,
    };

    pub const ReadEv = struct {
        fd: FileDescriptor,
        buffers: []ArrayBuffer,
        position: ReadPosition,
    };

    pub const Copy = struct {
        pub const FilterCallback = *const fn (source: string, destination: string) bool;
        /// Dereference symlinks
        /// @default false
        dereference: bool = false,

        /// When `force` is `false`, and the destination
        /// exists, throw an error.
        /// @default false
        errorOnExist: bool = false,

        /// Function to filter copied files/directories. Return
        /// `true` to copy the item, `false` to ignore it.
        filter: ?FilterCallback = null,

        /// Overwrite existing file or directory. _The copy
        /// operation will ignore errors if you set this to false and the destination
        /// exists. Use the `errorOnExist` option to change this behavior.
        /// @default true
        force: bool = true,

        /// When `true` timestamps from `src` will
        /// be preserved.
        /// @default false
        preserve_timestamps: bool = false,

        /// Copy directories recursively.
        /// @default false
        recursive: bool = false,
    };

    pub const UnwatchFile = void;
    pub const Watch = void;
    pub const WatchFile = void;
    pub const Fsync = struct {
        fd: FileDescriptor,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fsync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Fsync{
                .fd = fd,
            };
        }
    };
};

const Return = struct {
    pub const Access = void;
    pub const AppendFile = void;
    pub const Close = void;
    pub const CopyFile = void;
    pub const Exists = bool;
    pub const Fchmod = void;
    pub const Chmod = void;
    pub const Fchown = void;
    pub const Fdatasync = void;
    pub const Fstat = Stats;
    pub const Rm = void;
    pub const Fsync = void;
    pub const Ftruncate = void;
    pub const Futimes = void;
    pub const Lchmod = void;
    pub const Lchown = void;
    pub const Link = void;
    pub const Lstat = Stats;
    pub const Mkdir = string;
    pub const Mkdtemp = JSC.ZigString;
    pub const Open = FileDescriptor;
    pub const WriteFile = void;
    pub const Read = struct {
        bytes_read: u52,

        pub fn toJS(this: Read, _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_read).asObjectRef();
        }
    };
    pub const ReadPromise = struct {
        bytes_read: u52,
        buffer_val: JSC.JSValue = JSC.JSValue.zero,
        const fields = .{
            .bytesRead = JSC.ZigString.init("bytesRead"),
            .buffer = JSC.ZigString.init("buffer"),
        };
        pub fn toJS(this: Read, ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull())
                JSC.C.JSValueUnprotect(ctx, this.buffer_val.asObjectRef());

            return JSC.JSValue.createObject2(
                ctx.ptr(),
                &fields.bytesRead,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@intCast(u52, @min(std.math.maxInt(u52), this.bytes_read))),
                this.buffer_val,
            ).asObjectRef();
        }
    };

    pub const WritePromise = struct {
        bytes_written: u52,
        buffer: StringOrBuffer,
        buffer_val: JSC.JSValue = JSC.JSValue.zero,
        const fields = .{
            .bytesWritten = JSC.ZigString.init("bytesWritten"),
            .buffer = JSC.ZigString.init("buffer"),
        };

        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn toJS(this: Write, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull() and this.buffer == .buffer)
                JSC.C.JSValueUnprotect(ctx, this.buffer_val.asObjectRef());

            return JSC.JSValue.createObject2(
                ctx.ptr(),
                &fields.bytesWritten,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@intCast(u52, @min(std.math.maxInt(u52), this.bytes_written))),
                if (this.buffer == .buffer)
                    this.buffer_val
                else
                    JSC.JSValue.fromRef(this.buffer.toJS(ctx, exception)),
            ).asObjectRef();
        }
    };
    pub const Write = struct {
        bytes_written: u52,
        const fields = .{
            .bytesWritten = JSC.ZigString.init("bytesWritten"),
        };

        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn toJS(this: Write, _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_written).asObjectRef();
        }
    };

    pub const Readdir = union(Tag) {
        with_file_types: []Dirent,
        buffers: []const Buffer,
        files: []const JSC.ZigString,

        pub const Tag = enum {
            with_file_types,
            buffers,
            files,
        };

        pub fn toJS(this: Readdir, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return switch (this) {
                .with_file_types => JSC.To.JS.withType([]const Dirent, this.with_file_types, ctx, exception),
                .buffers => JSC.To.JS.withType([]const Buffer, this.buffers, ctx, exception),
                .files => JSC.To.JS.withType([]const JSC.ZigString, this.files, ctx, exception),
            };
        }
    };
    pub const ReadFile = JSC.Node.StringOrNodeBuffer;
    pub const ReadFileWithOptions = union(enum) {
        string: string,
        buffer: JSC.Node.Buffer,
        null_terminated: [:0]const u8,
    };
    pub const Readlink = StringOrBuffer;
    pub const Realpath = StringOrBuffer;
    pub const RealpathNative = Realpath;
    pub const Rename = void;
    pub const Rmdir = void;
    pub const Stat = Stats;

    pub const Symlink = void;
    pub const Truncate = void;
    pub const Unlink = void;
    pub const UnwatchFile = void;
    pub const Watch = void;
    pub const WatchFile = void;
    pub const Utimes = void;

    pub const Chown = void;
    pub const Lutimes = void;
};

/// Bun's implementation of the Node.js "fs" module
/// https://nodejs.org/api/fs.html
/// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
pub const NodeFS = struct {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that JSC can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodefS struct
    sync_error_buf: [bun.MAX_PATH_BYTES]u8 = undefined,

    pub const ReturnType = Return;

    pub fn access(this: *NodeFS, args: Arguments.Access, comptime _: Flavor) Maybe(Return.Access) {
        var path = args.path.sliceZ(&this.sync_error_buf);
        const rc = Syscall.system.access(path, @enumToInt(args.mode));
        return Maybe(Return.Access).errnoSysP(rc, .access, path) orelse Maybe(Return.Access).success;
    }

    pub fn appendFile(this: *NodeFS, args: Arguments.AppendFile, comptime flavor: Flavor) Maybe(Return.AppendFile) {
        var data = args.data.slice();

        switch (args.file) {
            .fd => |fd| {
                switch (comptime flavor) {
                    .sync => {
                        while (data.len > 0) {
                            const written = switch (Syscall.write(fd, data)) {
                                .result => |result| result,
                                .err => |err| return .{ .err = err },
                            };
                            data = data[written..];
                        }

                        return Maybe(Return.AppendFile).success;
                    },
                    else => {
                        @compileError("Not implemented yet");
                    },
                }
            },
            .path => |path_| {
                const path = path_.sliceZ(&this.sync_error_buf);
                switch (comptime flavor) {
                    .sync => {
                        const fd = switch (Syscall.open(path, @enumToInt(FileSystemFlags.a), 0o000666)) {
                            .result => |result| result,
                            .err => |err| return .{ .err = err },
                        };

                        defer {
                            _ = Syscall.close(fd);
                        }

                        while (data.len > 0) {
                            const written = switch (Syscall.write(fd, data)) {
                                .result => |result| result,
                                .err => |err| return .{ .err = err },
                            };
                            data = data[written..];
                        }

                        return Maybe(Return.AppendFile).success;
                    },
                    else => {
                        @compileError("Not implemented yet");
                    },
                }
            },
        }

        return Maybe(Return.AppendFile).todo;
    }

    pub fn close(_: *NodeFS, args: Arguments.Close, comptime flavor: Flavor) Maybe(Return.Close) {
        switch (comptime flavor) {
            .sync => {
                return if (Syscall.close(args.fd)) |err| .{ .err = err } else Maybe(Return.Close).success;
            },
            else => {},
        }

        return .{ .err = Syscall.Error.todo };
    }

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    pub fn copyFile(_: *NodeFS, args: Arguments.CopyFile, comptime flavor: Flavor) Maybe(Return.CopyFile) {
        const ret = Maybe(Return.CopyFile);

        switch (comptime flavor) {
            .sync => {
                var src_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var src = args.src.sliceZ(&src_buf);
                var dest = args.dest.sliceZ(&dest_buf);

                // TODO: do we need to fchown?
                if (comptime Environment.isMac) {
                    if (args.mode.isForceClone()) {
                        // https://www.manpagez.com/man/2/clonefile/
                        return ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) orelse ret.success;
                    } else {
                        const stat_ = switch (Syscall.stat(src)) {
                            .result => |result| result,
                            .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(src) },
                        };

                        if (!os.S.ISREG(stat_.mode)) {
                            return Maybe(Return.CopyFile){ .err = .{ .errno = @enumToInt(C.SystemErrno.ENOTSUP) } };
                        }

                        // 64 KB is about the break-even point for clonefile() to be worth it
                        // at least, on an M1 with an NVME SSD.
                        if (stat_.size > 128 * 1024) {
                            if (!args.mode.shouldntOverwrite()) {
                                // clonefile() will fail if it already exists
                                _ = Syscall.unlink(dest);
                            }

                            if (ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) == null) {
                                _ = C.chmod(dest, stat_.mode);
                                return ret.success;
                            }
                        } else {
                            const src_fd = switch (Syscall.open(src, std.os.O.RDONLY, 0o644)) {
                                .result => |result| result,
                                .err => |err| return .{ .err = err.withPath(args.src.slice()) },
                            };
                            defer {
                                _ = Syscall.close(src_fd);
                            }

                            var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
                            var wrote: usize = 0;
                            if (args.mode.shouldntOverwrite()) {
                                flags |= std.os.O.EXCL;
                            }

                            const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                                .result => |result| result,
                                .err => |err| return Maybe(Return.CopyFile){ .err = err },
                            };
                            defer {
                                _ = std.c.ftruncate(dest_fd, @intCast(std.c.off_t, @truncate(u63, wrote)));
                                _ = Syscall.close(dest_fd);
                            }

                            // stack buffer of 16 KB
                            // this code path isn't hit unless the buffer is < 128 KB
                            // 16 writes is ok
                            // 16 KB is high end of what is okay to use for stack space
                            // good thing we ask for absurdly large stack sizes
                            var buf: [16384]u8 = undefined;
                            var remain = @intCast(u64, @max(stat_.size, 0));
                            toplevel: while (remain > 0) {
                                const amt = switch (Syscall.read(src_fd, buf[0..@min(buf.len, remain)])) {
                                    .result => |result| result,
                                    .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(src) },
                                };
                                // 0 == EOF
                                if (amt == 0) {
                                    break :toplevel;
                                }
                                wrote += amt;
                                remain -|= amt;

                                var slice = buf[0..amt];
                                while (slice.len > 0) {
                                    const written = switch (Syscall.write(dest_fd, slice)) {
                                        .result => |result| result,
                                        .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(dest) },
                                    };
                                    if (written == 0) break :toplevel;
                                    slice = slice[written..];
                                }
                            } else {
                                outer: while (true) {
                                    const amt = switch (Syscall.read(src_fd, &buf)) {
                                        .result => |result| result,
                                        .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(src) },
                                    };
                                    // we don't know the size
                                    // so we just go forever until we get an EOF
                                    if (amt == 0) {
                                        break;
                                    }
                                    wrote += amt;

                                    var slice = buf[0..amt];
                                    while (slice.len > 0) {
                                        const written = switch (Syscall.write(dest_fd, slice)) {
                                            .result => |result| result,
                                            .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(dest) },
                                        };
                                        slice = slice[written..];
                                        if (written == 0) break :outer;
                                    }
                                }
                            }
                            // can't really do anything with this error
                            _ = C.fchmod(dest_fd, stat_.mode);

                            return ret.success;
                        }
                    }

                    // we fallback to copyfile() when the file is > 128 KB and clonefile fails
                    // clonefile() isn't supported on all devices
                    // nor is it supported across devices
                    var mode: Mode = C.darwin.COPYFILE_ACL | C.darwin.COPYFILE_DATA;
                    if (args.mode.shouldntOverwrite()) {
                        mode |= C.darwin.COPYFILE_EXCL;
                    }

                    return ret.errnoSysP(C.copyfile(src, dest, null, mode), .copyfile, src) orelse ret.success;
                }

                if (comptime Environment.isLinux) {
                    // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
                    if (args.mode.isForceClone()) {
                        return Maybe(Return.CopyFile).todo;
                    }

                    const src_fd = switch (Syscall.open(src, std.os.O.RDONLY, 0o644)) {
                        .result => |result| result,
                        .err => |err| return .{ .err = err },
                    };
                    defer {
                        _ = Syscall.close(src_fd);
                    }

                    const stat_: linux.Stat = switch (Syscall.fstat(src_fd)) {
                        .result => |result| result,
                        .err => |err| return Maybe(Return.CopyFile){ .err = err },
                    };

                    if (!os.S.ISREG(stat_.mode)) {
                        return Maybe(Return.CopyFile){ .err = .{ .errno = @enumToInt(C.SystemErrno.ENOTSUP) } };
                    }

                    var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
                    var wrote: usize = 0;
                    if (args.mode.shouldntOverwrite()) {
                        flags |= std.os.O.EXCL;
                    }

                    const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                        .result => |result| result,
                        .err => |err| return Maybe(Return.CopyFile){ .err = err },
                    };

                    var size = @intCast(usize, @max(stat_.size, 0));

                    defer {
                        _ = linux.ftruncate(dest_fd, @intCast(i64, @truncate(u63, wrote)));
                        _ = Syscall.close(dest_fd);
                    }

                    var off_in_copy = @bitCast(i64, @as(u64, 0));
                    var off_out_copy = @bitCast(i64, @as(u64, 0));

                    if (size == 0) {
                        // copy until EOF
                        while (true) {

                            // Linux Kernel 5.3 or later
                            const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, std.mem.page_size, 0);
                            if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                                // TODO: handle EXDEV
                                // seems like zfs does not support copy_file_range across devices
                                // see https://discord.com/channels/876711213126520882/876711213126520885/1006465112707698770
                                return err;
                            }
                            // wrote zero bytes means EOF
                            if (written == 0) break;
                            wrote +|= written;
                        }
                    } else {
                        while (size > 0) {
                            // Linux Kernel 5.3 or later
                            const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, size, 0);
                            if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                                // TODO: handle EXDEV
                                // seems like zfs does not support copy_file_range across devices
                                // see https://discord.com/channels/876711213126520882/876711213126520885/1006465112707698770
                                return err;
                            }
                            // wrote zero bytes means EOF
                            if (written == 0) break;
                            wrote +|= written;
                            size -|= written;
                        }
                    }
                    _ = linux.fchmod(dest_fd, stat_.mode);
                    return ret.success;
                }
            },
            else => {},
        }

        return Maybe(Return.CopyFile).todo;
    }
    pub fn exists(this: *NodeFS, args: Arguments.Exists, comptime flavor: Flavor) Maybe(Return.Exists) {
        const Ret = Maybe(Return.Exists);
        switch (comptime flavor) {
            .sync => {
                const path = args.path orelse return Ret{ .result = false };
                const slice = path.sliceZ(&this.sync_error_buf);
                // access() may not work correctly on NFS file systems with UID
                // mapping enabled, because UID mapping is done on the server and
                // hidden from the client, which checks permissions. Similar
                // problems can occur to FUSE mounts.
                const rc = (system.access(slice, std.os.F_OK));
                return Ret{ .result = rc == 0 };
            },
            else => {},
        }

        return Ret.todo;
    }

    pub fn chown(this: *NodeFS, args: Arguments.Chown, comptime flavor: Flavor) Maybe(Return.Chown) {
        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => return Syscall.chown(path, args.uid, args.gid),
            else => {},
        }

        return Maybe(Return.Chown).todo;
    }

    /// This should almost never be async
    pub fn chmod(this: *NodeFS, args: Arguments.Chmod, comptime flavor: Flavor) Maybe(Return.Chmod) {
        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Chmod).errnoSysP(C.chmod(path, args.mode), .chmod, path) orelse
                    Maybe(Return.Chmod).success;
            },
            else => {},
        }

        return Maybe(Return.Chmod).todo;
    }

    /// This should almost never be async
    pub fn fchmod(_: *NodeFS, args: Arguments.FChmod, comptime flavor: Flavor) Maybe(Return.Fchmod) {
        switch (comptime flavor) {
            .sync => {
                return Syscall.fchmod(args.fd, args.mode);
            },
            else => {},
        }

        return Maybe(Return.Fchmod).todo;
    }
    pub fn fchown(_: *NodeFS, args: Arguments.Fchown, comptime flavor: Flavor) Maybe(Return.Fchown) {
        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Fchown).errnoSys(C.fchown(args.fd, args.uid, args.gid), .fchown) orelse
                    Maybe(Return.Fchown).success;
            },
            else => {},
        }

        return Maybe(Return.Fchown).todo;
    }
    pub fn fdatasync(_: *NodeFS, args: Arguments.FdataSync, comptime flavor: Flavor) Maybe(Return.Fdatasync) {
        switch (comptime flavor) {
            .sync => return Maybe(Return.Fdatasync).errnoSys(system.fdatasync(args.fd), .fdatasync) orelse
                Maybe(Return.Fdatasync).success,
            else => {},
        }

        return Maybe(Return.Fdatasync).todo;
    }
    pub fn fstat(_: *NodeFS, args: Arguments.Fstat, comptime flavor: Flavor) Maybe(Return.Fstat) {
        if (args.big_int) return Maybe(Return.Fstat).todo;

        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.fstat(args.fd)) {
                    .result => |result| Maybe(Return.Fstat){ .result = Stats.init(result, false) },
                    .err => |err| Maybe(Return.Fstat){ .err = err },
                };
            },
            else => {},
        }

        return Maybe(Return.Fstat).todo;
    }

    pub fn fsync(_: *NodeFS, args: Arguments.Fsync, comptime flavor: Flavor) Maybe(Return.Fsync) {
        switch (comptime flavor) {
            .sync => return Maybe(Return.Fsync).errnoSys(system.fsync(args.fd), .fsync) orelse
                Maybe(Return.Fsync).success,
            else => {},
        }

        return Maybe(Return.Fsync).todo;
    }

    pub fn ftruncateSync(args: Arguments.FTruncate) Maybe(Return.Ftruncate) {
        return Maybe(Return.Ftruncate).errnoSys(system.ftruncate(args.fd, args.len orelse 0), .ftruncate) orelse
            Maybe(Return.Ftruncate).success;
    }

    pub fn ftruncate(_: *NodeFS, args: Arguments.FTruncate, comptime flavor: Flavor) Maybe(Return.Ftruncate) {
        switch (comptime flavor) {
            .sync => return ftruncateSync(args),
            else => {},
        }

        return Maybe(Return.Ftruncate).todo;
    }
    pub fn futimes(_: *NodeFS, args: Arguments.Futimes, comptime flavor: Flavor) Maybe(Return.Futimes) {
        var times = [2]std.os.timespec{
            .{
                .tv_sec = args.mtime,
                .tv_nsec = 0,
            },
            .{
                .tv_sec = args.atime,
                .tv_nsec = 0,
            },
        };

        switch (comptime flavor) {
            .sync => return if (Maybe(Return.Futimes).errnoSys(system.futimens(args.fd, &times), .futimens)) |err|
                err
            else
                Maybe(Return.Futimes).success,
            else => {},
        }

        return Maybe(Return.Futimes).todo;
    }

    pub fn lchmod(this: *NodeFS, args: Arguments.LCHmod, comptime flavor: Flavor) Maybe(Return.Lchmod) {
        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchmod).errnoSysP(C.lchmod(path, args.mode), .lchmod, path) orelse
                    Maybe(Return.Lchmod).success;
            },
            else => {},
        }

        return Maybe(Return.Lchmod).todo;
    }

    pub fn lchown(this: *NodeFS, args: Arguments.LChown, comptime flavor: Flavor) Maybe(Return.Lchown) {
        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchown).errnoSysP(C.lchown(path, args.uid, args.gid), .lchown, path) orelse
                    Maybe(Return.Lchown).success;
            },
            else => {},
        }

        return Maybe(Return.Lchown).todo;
    }
    pub fn link(this: *NodeFS, args: Arguments.Link, comptime flavor: Flavor) Maybe(Return.Link) {
        var new_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const from = args.old_path.sliceZ(&this.sync_error_buf);
        const to = args.new_path.sliceZ(&new_path_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Link).errnoSysP(system.link(from, to, 0), .link, from) orelse
                    Maybe(Return.Link).success;
            },
            else => {},
        }

        return Maybe(Return.Link).todo;
    }
    pub fn lstat(this: *NodeFS, args: Arguments.Lstat, comptime flavor: Flavor) Maybe(Return.Lstat) {
        if (args.big_int) return Maybe(Return.Lstat).todo;

        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.lstat(
                    args.path.sliceZ(
                        &this.sync_error_buf,
                    ),
                )) {
                    .result => |result| Maybe(Return.Lstat){ .result = Return.Lstat.init(result, false) },
                    .err => |err| Maybe(Return.Lstat){ .err = err },
                };
            },
            else => {},
        }

        return Maybe(Return.Lstat).todo;
    }

    pub fn mkdir(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        return if (args.recursive) mkdirRecursive(this, args, flavor) else mkdirNonRecursive(this, args, flavor);
    }
    // Node doesn't absolute the path so we don't have to either
    fn mkdirNonRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        switch (comptime flavor) {
            .sync => {
                const path = args.path.sliceZ(&this.sync_error_buf);
                return switch (Syscall.mkdir(path, args.mode)) {
                    .result => Maybe(Return.Mkdir){ .result = "" },
                    .err => |err| Maybe(Return.Mkdir){ .err = err },
                };
            },
            else => {},
        }

        return Maybe(Return.Mkdir).todo;
    }

    // TODO: windows
    // TODO: verify this works correctly with unicode codepoints
    pub fn mkdirRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        const Option = Maybe(Return.Mkdir);
        if (comptime Environment.isWindows) @compileError("This needs to be implemented on Windows.");

        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const path = args.path.sliceZWithForceCopy(&buf, true);
                const len = @truncate(u16, path.len);

                // First, attempt to create the desired directory
                // If that fails, then walk back up the path until we have a match
                switch (Syscall.mkdir(path, args.mode)) {
                    .err => |err| {
                        switch (err.getErrno()) {
                            else => {
                                @memcpy(&this.sync_error_buf, path.ptr, len);
                                return .{ .err = err.withPath(this.sync_error_buf[0..len]) };
                            },

                            .EXIST => {
                                return Option{ .result = "" };
                            },
                            // continue
                            .NOENT => {},
                        }
                    },
                    .result => {
                        return Option{ .result = args.path.slice() };
                    },
                }

                var working_mem = &this.sync_error_buf;
                @memcpy(working_mem, path.ptr, len);

                var i: u16 = len - 1;

                // iterate backwards until creating the directory works successfully
                while (i > 0) : (i -= 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0..i :0];

                        switch (Syscall.mkdir(parent, args.mode)) {
                            .err => |err| {
                                working_mem[i] = std.fs.path.sep;
                                switch (err.getErrno()) {
                                    .EXIST => {
                                        // Handle race condition
                                        break;
                                    },
                                    .NOENT => {
                                        continue;
                                    },
                                    else => return .{ .err = err.withPath(parent) },
                                }
                            },
                            .result => {
                                // We found a parent that worked
                                working_mem[i] = std.fs.path.sep;
                                break;
                            },
                        }
                    }
                }
                var first_match: u16 = i;
                i += 1;
                // after we find one that works, we go forward _after_ the first working directory
                while (i < len) : (i += 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0..i :0];

                        switch (Syscall.mkdir(parent, args.mode)) {
                            .err => |err| {
                                working_mem[i] = std.fs.path.sep;
                                switch (err.getErrno()) {
                                    .EXIST => {
                                        if (Environment.allow_assert) std.debug.assert(false);
                                        continue;
                                    },
                                    else => return .{ .err = err },
                                }
                            },

                            .result => {
                                working_mem[i] = std.fs.path.sep;
                            },
                        }
                    }
                }

                working_mem[len] = 0;

                // Our final directory will not have a trailing separator
                // so we have to create it once again
                switch (Syscall.mkdir(working_mem[0..len :0], args.mode)) {
                    .err => |err| {
                        switch (err.getErrno()) {
                            // handle the race condition
                            .EXIST => {
                                var display_path: []const u8 = "";
                                if (first_match != std.math.maxInt(u16)) {
                                    // TODO: this leaks memory
                                    display_path = bun.default_allocator.dupe(u8, display_path[0..first_match]) catch unreachable;
                                }
                                return Option{ .result = display_path };
                            },

                            // NOENT shouldn't happen here
                            else => return .{
                                .err = err.withPath(path),
                            },
                        }
                    },
                    .result => {
                        var display_path = args.path.slice();
                        if (first_match != std.math.maxInt(u16)) {
                            // TODO: this leaks memory
                            display_path = bun.default_allocator.dupe(u8, display_path[0..first_match]) catch unreachable;
                        }
                        return Option{ .result = display_path };
                    },
                }
            },
            else => {},
        }

        return Maybe(Return.Mkdir).todo;
    }

    pub fn mkdtemp(this: *NodeFS, args: Arguments.MkdirTemp, comptime _: Flavor) Maybe(Return.Mkdtemp) {
        var prefix_buf = &this.sync_error_buf;
        const prefix_slice = args.prefix.slice();
        const len = @min(prefix_slice.len, prefix_buf.len -| 7);
        if (len > 0) {
            @memcpy(prefix_buf, prefix_slice.ptr, len);
        }
        prefix_buf[len..][0..6].* = "XXXXXX".*;
        prefix_buf[len..][6] = 0;

        // The mkdtemp() function returns  a  pointer  to  the  modified  template
        // string  on  success, and NULL on failure, in which case errno is set to
        // indicate the error

        const rc = C.mkdtemp(prefix_buf);
        if (rc) |ptr| {
            return .{
                .result = JSC.ZigString.dupeForJS(bun.sliceTo(ptr, 0), bun.default_allocator) catch unreachable,
            };
        }
        // std.c.getErrno(rc) returns SUCCESS if rc is null so we call std.c._errno() directly
        const errno = @intToEnum(std.c.E, std.c._errno().*);
        return .{ .err = Syscall.Error{ .errno = @truncate(Syscall.Error.Int, @enumToInt(errno)), .syscall = .mkdtemp } };
    }
    pub fn open(this: *NodeFS, args: Arguments.Open, comptime flavor: Flavor) Maybe(Return.Open) {
        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                const path = args.path.sliceZ(&this.sync_error_buf);
                return switch (Syscall.open(path, @enumToInt(args.flags), args.mode)) {
                    .err => |err| .{
                        .err = err.withPath(args.path.slice()),
                    },
                    .result => |fd| .{ .result = fd },
                };
            },
            else => {},
        }

        return Maybe(Return.Open).todo;
    }
    pub fn openDir(_: *NodeFS, _: Arguments.OpenDir, comptime _: Flavor) Maybe(Return.OpenDir) {
        return Maybe(Return.OpenDir).todo;
    }

    fn _read(_: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        if (Environment.allow_assert) std.debug.assert(args.position == null);

        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf = args.buffer.slice();
                buf = buf[@min(args.offset, buf.len)..];
                buf = buf[0..@min(buf.len, args.length)];

                return switch (Syscall.read(args.fd, buf)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{
                        .result = .{
                            .bytes_read = @truncate(u52, amt),
                        },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    fn _pread(_: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        switch (comptime flavor) {
            .sync => {
                var buf = args.buffer.slice();
                buf = buf[@min(args.offset, buf.len)..];
                buf = buf[0..@min(buf.len, args.length)];

                return switch (Syscall.pread(args.fd, buf, args.position.?)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{
                        .result = .{
                            .bytes_read = @truncate(u52, amt),
                        },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    pub fn read(this: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        return if (args.position != null)
            this._pread(
                args,
                comptime flavor,
            )
        else
            this._read(
                args,
                comptime flavor,
            );
    }

    pub fn write(this: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        return if (args.position != null) _pwrite(this, args, flavor) else _write(this, args, flavor);
    }
    fn _write(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        switch (comptime flavor) {
            .sync => {
                var buf = args.buffer.slice();
                buf = buf[@min(args.offset, buf.len)..];
                buf = buf[0..@min(buf.len, args.length)];

                return switch (Syscall.write(args.fd, buf)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{
                        .result = .{
                            .bytes_written = @truncate(u52, amt),
                        },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _pwrite(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        const position = args.position.?;

        switch (comptime flavor) {
            .sync => {
                var buf = args.buffer.slice();
                buf = buf[@min(args.offset, buf.len)..];
                buf = buf[0..@min(args.length, buf.len)];

                return switch (Syscall.pwrite(args.fd, buf, position)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{ .result = .{
                        .bytes_written = @truncate(u52, amt),
                    } },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    pub fn readdir(this: *NodeFS, args: Arguments.Readdir, comptime flavor: Flavor) Maybe(Return.Readdir) {
        return switch (args.encoding) {
            .buffer => _readdir(
                this,
                args,
                Buffer,
                flavor,
            ),
            else => {
                if (!args.with_file_types) {
                    return _readdir(
                        this,
                        args,
                        JSC.ZigString,
                        flavor,
                    );
                }

                return _readdir(
                    this,
                    args,
                    Dirent,
                    flavor,
                );
            },
        };
    }

    pub fn _readdir(
        this: *NodeFS,
        args: Arguments.Readdir,
        comptime ExpectedType: type,
        comptime flavor: Flavor,
    ) Maybe(Return.Readdir) {
        const file_type = comptime switch (ExpectedType) {
            Dirent => "with_file_types",
            JSC.ZigString => "files",
            Buffer => "buffers",
            else => unreachable,
        };

        switch (comptime flavor) {
            .sync => {
                var path = args.path.sliceZ(&this.sync_error_buf);
                const flags = os.O.DIRECTORY | os.O.RDONLY;
                const fd = switch (Syscall.open(path, flags, 0)) {
                    .err => |err| return .{
                        .err = err.withPath(args.path.slice()),
                    },
                    .result => |fd_| fd_,
                };
                defer {
                    _ = Syscall.close(fd);
                }

                var entries = std.ArrayList(ExpectedType).init(bun.default_allocator);
                var dir = std.fs.Dir{ .fd = fd };
                var iterator = DirIterator.iterate(dir);
                var entry = iterator.next();
                while (switch (entry) {
                    .err => |err| {
                        for (entries.items) |*item| {
                            switch (comptime ExpectedType) {
                                Dirent => {
                                    bun.default_allocator.free(item.name.slice());
                                },
                                Buffer => {
                                    item.destroy();
                                },
                                JSC.ZigString => {
                                    bun.default_allocator.free(item.slice());
                                },
                                else => unreachable,
                            }
                        }

                        entries.deinit();

                        return .{
                            .err = err.withPath(args.path.slice()),
                        };
                    },
                    .result => |ent| ent,
                }) |current| : (entry = iterator.next()) {
                    switch (comptime ExpectedType) {
                        Dirent => {
                            entries.append(.{
                                .name = PathString.init(bun.default_allocator.dupe(u8, current.name.slice()) catch unreachable),
                                .kind = current.kind,
                            }) catch unreachable;
                        },
                        Buffer => {
                            const slice = current.name.slice();
                            entries.append(Buffer.fromString(slice, bun.default_allocator) catch unreachable) catch unreachable;
                        },
                        JSC.ZigString => {
                            entries.append(JSC.ZigString.dupeForJS(current.name.slice(), bun.default_allocator) catch unreachable) catch unreachable;
                        },
                        else => unreachable,
                    }
                }

                return .{ .result = @unionInit(Return.Readdir, file_type, entries.items) };
            },
            else => {},
        }

        return Maybe(Return.Readdir).todo;
    }

    pub const StringType = enum {
        default,
        null_terminated,
    };

    pub fn readFile(this: *NodeFS, args: Arguments.ReadFile, comptime flavor: Flavor) Maybe(Return.ReadFile) {
        const ret = readFileWithOptions(this, args, flavor, .default);
        return switch (ret) {
            .err => .{ .err = ret.err },
            .result => switch (ret.result) {
                .buffer => .{
                    .result = .{
                        .buffer = ret.result.buffer,
                    },
                },
                .string => .{
                    .result = .{
                        .string = ret.result.string,
                    },
                },
                else => unreachable,
            },
        };
    }

    pub fn readFileWithOptions(this: *NodeFS, args: Arguments.ReadFile, comptime flavor: Flavor, comptime string_type: StringType) Maybe(Return.ReadFileWithOptions) {
        var path: [:0]const u8 = undefined;
        switch (comptime flavor) {
            .sync => {
                const fd = switch (args.path) {
                    .path => brk: {
                        path = args.path.path.sliceZ(&this.sync_error_buf);
                        break :brk switch (Syscall.open(
                            path,
                            os.O.RDONLY | os.O.NOCTTY,
                            0,
                        )) {
                            .err => |err| return .{
                                .err = err.withPath(if (args.path == .path) args.path.path.slice() else ""),
                            },
                            .result => |fd_| fd_,
                        };
                    },
                    .fd => |_fd| _fd,
                };

                defer {
                    if (args.path == .path)
                        _ = Syscall.close(fd);
                }

                const stat_ = switch (Syscall.fstat(fd)) {
                    .err => |err| return .{
                        .err = err,
                    },
                    .result => |stat_| stat_,
                };

                // Only used in DOMFormData
                if (args.offset > 0) {
                    std.os.lseek_SET(fd, args.offset) catch {};
                }

                // For certain files, the size might be 0 but the file might still have contents.
                const size = @intCast(
                    u64,
                    @max(
                        @min(
                            stat_.size,
                            @intCast(
                                @TypeOf(stat_.size),
                                // Only used in DOMFormData
                                args.max_size orelse std.math.maxInt(
                                    JSC.WebCore.Blob.SizeType,
                                ),
                            ),
                        ),
                        0,
                    ),
                ) + if (comptime string_type == .null_terminated) 1 else 0;

                var buf = std.ArrayList(u8).init(bun.default_allocator);
                buf.ensureTotalCapacityPrecise(size + 16) catch unreachable;
                buf.expandToCapacity();
                var total: usize = 0;

                while (total < size) {
                    switch (Syscall.read(fd, buf.items.ptr[total..buf.capacity])) {
                        .err => |err| return .{
                            .err = err,
                        },
                        .result => |amt| {
                            total += amt;
                            // There are cases where stat()'s size is wrong or out of date
                            if (total > size and amt != 0) {
                                buf.ensureUnusedCapacity(8096) catch unreachable;
                                buf.expandToCapacity();
                                continue;
                            }

                            if (amt == 0) {
                                break;
                            }
                        },
                    }
                } else {
                    // https://github.com/oven-sh/bun/issues/1220
                    while (true) {
                        switch (Syscall.read(fd, buf.items.ptr[total..buf.capacity])) {
                            .err => |err| return .{
                                .err = err,
                            },
                            .result => |amt| {
                                total += amt;
                                // There are cases where stat()'s size is wrong or out of date
                                if (total > size and amt != 0) {
                                    buf.ensureUnusedCapacity(8096) catch unreachable;
                                    buf.expandToCapacity();
                                    continue;
                                }

                                if (amt == 0) {
                                    break;
                                }
                            },
                        }
                    }
                }

                buf.items.len = if (comptime string_type == .null_terminated) total + 1 else total;
                if (total == 0) {
                    buf.deinit();
                    return switch (args.encoding) {
                        .buffer => .{
                            .result = .{
                                .buffer = Buffer.empty,
                            },
                        },
                        else => brk: {
                            if (comptime string_type == .default) {
                                break :brk .{
                                    .result = .{
                                        .string = "",
                                    },
                                };
                            } else {
                                break :brk .{
                                    .result = .{
                                        .null_terminated = "",
                                    },
                                };
                            }
                        },
                    };
                }

                return switch (args.encoding) {
                    .buffer => .{
                        .result = .{
                            .buffer = Buffer.fromBytes(buf.items, bun.default_allocator, .Uint8Array),
                        },
                    },
                    else => brk: {
                        if (comptime string_type == .default) {
                            break :brk .{
                                .result = .{
                                    .string = buf.items,
                                },
                            };
                        } else {
                            break :brk .{
                                .result = .{
                                    .null_terminated = buf.toOwnedSliceSentinel(0) catch unreachable,
                                },
                            };
                        }
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.ReadFile).todo;
    }

    pub fn writeFileWithPathBuffer(pathbuf: *[bun.MAX_PATH_BYTES]u8, args: Arguments.WriteFile) Maybe(Return.WriteFile) {
        var path: [:0]const u8 = undefined;

        const fd = switch (args.file) {
            .path => brk: {
                path = args.file.path.sliceZ(pathbuf);
                break :brk switch (Syscall.openat(
                    args.dirfd,
                    path,
                    @enumToInt(args.flag) | os.O.NOCTTY,
                    args.mode,
                )) {
                    .err => |err| return .{
                        .err = err.withPath(path),
                    },
                    .result => |fd_| fd_,
                };
            },
            .fd => |_fd| _fd,
        };

        defer {
            if (args.file == .path)
                _ = Syscall.close(fd);
        }

        var buf = args.data.slice();
        var written: usize = 0;

        // Attempt to pre-allocate large files
        if (Environment.isLinux) {
            preallocate: {
                // Worthwhile after 6 MB at least on ext4 linux
                if (buf.len >= bun.C.preallocate_length) {
                    const offset: usize = if (args.file == .path)
                        // on mac, it's relatively positioned
                        0
                    else brk: {
                        // on linux, it's absolutely positioned
                        const pos = JSC.Node.Syscall.system.lseek(
                            fd,
                            @intCast(std.os.off_t, 0),
                            std.os.linux.SEEK.CUR,
                        );

                        switch (JSC.Node.Syscall.getErrno(pos)) {
                            .SUCCESS => break :brk @intCast(usize, pos),
                            else => break :preallocate,
                        }
                    };

                    bun.C.preallocate_file(
                        fd,
                        @intCast(std.os.off_t, offset),
                        @intCast(std.os.off_t, buf.len),
                    ) catch {};
                }
            }
        }

        while (buf.len > 0) {
            switch (Syscall.write(fd, buf)) {
                .err => |err| return .{
                    .err = err,
                },
                .result => |amt| {
                    buf = buf[amt..];
                    written += amt;
                    if (amt == 0) {
                        break;
                    }
                },
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        if ((@enumToInt(args.flag) & std.os.O.APPEND) == 0) {
            _ = ftruncateSync(.{ .fd = fd, .len = @truncate(JSC.WebCore.Blob.SizeType, written) });
        }

        return Maybe(Return.WriteFile).success;
    }

    pub fn writeFile(this: *NodeFS, args: Arguments.WriteFile, comptime flavor: Flavor) Maybe(Return.WriteFile) {
        switch (comptime flavor) {
            .sync => return writeFileWithPathBuffer(&this.sync_error_buf, args),
            else => {},
        }

        return Maybe(Return.WriteFile).todo;
    }

    pub fn readlink(this: *NodeFS, args: Arguments.Readlink, comptime flavor: Flavor) Maybe(Return.Readlink) {
        var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var inbuf = &this.sync_error_buf;
        switch (comptime flavor) {
            .sync => {
                const path = args.path.sliceZ(inbuf);

                const len = switch (Syscall.readlink(path, &outbuf)) {
                    .err => |err| return .{
                        .err = err.withPath(args.path.slice()),
                    },
                    .result => |buf_| buf_,
                };

                return .{
                    .result = switch (args.encoding) {
                        .buffer => .{
                            .buffer = Buffer.fromString(outbuf[0..len], bun.default_allocator) catch unreachable,
                        },
                        else => .{
                            .string = bun.default_allocator.dupe(u8, outbuf[0..len]) catch unreachable,
                        },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Readlink).todo;
    }
    pub fn realpath(this: *NodeFS, args: Arguments.Realpath, comptime flavor: Flavor) Maybe(Return.Realpath) {
        var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var inbuf = &this.sync_error_buf;
        if (comptime Environment.allow_assert) std.debug.assert(FileSystem.instance_loaded);

        switch (comptime flavor) {
            .sync => {
                var path_slice = args.path.slice();

                var parts = [_]string{ FileSystem.instance.top_level_dir, path_slice };
                var path_ = FileSystem.instance.absBuf(&parts, inbuf);
                inbuf[path_.len] = 0;
                var path: [:0]u8 = inbuf[0..path_.len :0];

                const flags = if (comptime Environment.isLinux)
                    // O_PATH is faster
                    std.os.O.PATH
                else
                    std.os.O.RDONLY;

                const fd = switch (Syscall.open(path, flags, 0)) {
                    .err => |err| return .{
                        .err = err.withPath(path),
                    },
                    .result => |fd_| fd_,
                };

                defer {
                    _ = Syscall.close(fd);
                }

                const buf = switch (Syscall.getFdPath(fd, &outbuf)) {
                    .err => |err| return .{
                        .err = err.withPath(path),
                    },
                    .result => |buf_| buf_,
                };

                return .{
                    .result = switch (args.encoding) {
                        .buffer => .{
                            .buffer = Buffer.fromString(buf, bun.default_allocator) catch unreachable,
                        },
                        else => .{
                            .string = bun.default_allocator.dupe(u8, buf) catch unreachable,
                        },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Realpath).todo;
    }
    pub const realpathNative = realpath;
    // pub fn realpathNative(this: *NodeFS,  args: Arguments.Realpath, comptime flavor: Flavor) Maybe(Return.Realpath) {
    //     _ = args;
    //
    //
    //     return error.NotImplementedYet;
    // }
    pub fn rename(this: *NodeFS, args: Arguments.Rename, comptime flavor: Flavor) Maybe(Return.Rename) {
        var from_buf = &this.sync_error_buf;
        var to_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        switch (comptime flavor) {
            .sync => {
                var from = args.old_path.sliceZ(from_buf);
                var to = args.new_path.sliceZ(&to_buf);
                return Syscall.rename(from, to);
            },
            else => {},
        }

        return Maybe(Return.Rename).todo;
    }
    pub fn rmdir(this: *NodeFS, args: Arguments.RmDir, comptime flavor: Flavor) Maybe(Return.Rmdir) {
        switch (comptime flavor) {
            .sync => {
                if (comptime Environment.isMac) {
                    if (args.recursive) {
                        var dest = args.path.sliceZ(&this.sync_error_buf);

                        var flags: u32 = bun.C.darwin.RemoveFileFlags.cross_mount |
                            bun.C.darwin.RemoveFileFlags.allow_long_paths |
                            bun.C.darwin.RemoveFileFlags.recursive;

                        while (true) {
                            if (Maybe(Return.Rmdir).errnoSys(bun.C.darwin.removefileat(std.os.AT.FDCWD, dest, null, flags), .rmdir)) |errno| {
                                switch (@intToEnum(os.E, errno.err.errno)) {
                                    .AGAIN, .INTR => continue,
                                    .NOENT => return Maybe(Return.Rmdir).success,
                                    .MLINK => {
                                        var copy: [bun.MAX_PATH_BYTES]u8 = undefined;
                                        @memcpy(&copy, dest.ptr, dest.len);
                                        copy[dest.len] = 0;
                                        var dest_copy = copy[0..dest.len :0];
                                        switch (Syscall.unlink(dest_copy).getErrno()) {
                                            .AGAIN, .INTR => continue,
                                            .NOENT => return errno,
                                            .SUCCESS => continue,
                                            else => return errno,
                                        }
                                    },
                                    .SUCCESS => unreachable,
                                    else => return errno,
                                }
                            }

                            return Maybe(Return.Rmdir).success;
                        }
                    }

                    return Maybe(Return.Rmdir).errnoSysP(system.rmdir(args.path.sliceZ(&this.sync_error_buf)), .rmdir, args.path.slice()) orelse
                        Maybe(Return.Rmdir).success;
                } else if (comptime Environment.isLinux) {
                    if (args.recursive) {
                        std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                            const errno: std.os.E = switch (err) {
                                error.InvalidHandle => .BADF,
                                error.AccessDenied => .PERM,
                                error.FileTooBig => .FBIG,
                                error.SymLinkLoop => .LOOP,
                                error.ProcessFdQuotaExceeded => .NFILE,
                                error.NameTooLong => .NAMETOOLONG,
                                error.SystemFdQuotaExceeded => .MFILE,
                                error.SystemResources => .NOMEM,
                                error.ReadOnlyFileSystem => .ROFS,
                                error.FileSystem => .IO,
                                error.FileBusy => .BUSY,
                                error.DeviceBusy => .BUSY,

                                // One of the path components was not a directory.
                                // This error is unreachable if `sub_path` does not contain a path separator.
                                error.NotDir => .NOTDIR,
                                // On Windows, file paths must be valid Unicode.
                                error.InvalidUtf8 => .INVAL,

                                // On Windows, file paths cannot contain these characters:
                                // '/', '*', '?', '"', '<', '>', '|'
                                error.BadPathName => .INVAL,

                                else => .FAULT,
                            };
                            return Maybe(Return.Rm){
                                .err = JSC.Node.Syscall.Error.fromCode(errno, .rmdir),
                            };
                        };

                        return Maybe(Return.Rmdir).success;
                    }

                    return Maybe(Return.Rmdir).errnoSysP(system.rmdir(args.path.sliceZ(&this.sync_error_buf)), .rmdir, args.path.slice()) orelse
                        Maybe(Return.Rmdir).success;
                }
            },
            else => {},
        }

        return Maybe(Return.Rmdir).todo;
    }
    pub fn rm(this: *NodeFS, args: Arguments.RmDir, comptime flavor: Flavor) Maybe(Return.Rm) {
        switch (comptime flavor) {
            .sync => {
                if (comptime Environment.isMac) {
                    var dest = args.path.sliceZ(&this.sync_error_buf);

                    while (true) {
                        var flags: u32 = 0;
                        if (args.recursive) {
                            flags |= bun.C.darwin.RemoveFileFlags.cross_mount;
                            flags |= bun.C.darwin.RemoveFileFlags.allow_long_paths;
                            flags |= bun.C.darwin.RemoveFileFlags.recursive;
                        }

                        if (Maybe(Return.Rm).errnoSys(bun.C.darwin.removefileat(std.os.AT.FDCWD, dest, null, flags), .unlink)) |errno| {
                            switch (@intToEnum(os.E, errno.err.errno)) {
                                .AGAIN, .INTR => continue,
                                .NOENT => {
                                    if (args.force) {
                                        return Maybe(Return.Rm).success;
                                    }

                                    return errno;
                                },

                                .MLINK => {
                                    var copy: [bun.MAX_PATH_BYTES]u8 = undefined;
                                    @memcpy(&copy, dest.ptr, dest.len);
                                    copy[dest.len] = 0;
                                    var dest_copy = copy[0..dest.len :0];
                                    switch (Syscall.unlink(dest_copy).getErrno()) {
                                        .AGAIN, .INTR => continue,
                                        .NOENT => {
                                            if (args.force) {
                                                continue;
                                            }

                                            return errno;
                                        },
                                        .SUCCESS => continue,
                                        else => return errno,
                                    }
                                },
                                .SUCCESS => unreachable,
                                else => return errno,
                            }
                        }

                        return Maybe(Return.Rm).success;
                    }
                } else if (comptime Environment.isLinux) {
                    if (args.recursive) {
                        std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                            const errno: std.os.E = switch (err) {
                                error.InvalidHandle => .BADF,
                                error.AccessDenied => .PERM,
                                error.FileTooBig => .FBIG,
                                error.SymLinkLoop => .LOOP,
                                error.ProcessFdQuotaExceeded => .NFILE,
                                error.NameTooLong => .NAMETOOLONG,
                                error.SystemFdQuotaExceeded => .MFILE,
                                error.SystemResources => .NOMEM,
                                error.ReadOnlyFileSystem => .ROFS,
                                error.FileSystem => .IO,
                                error.FileBusy => .BUSY,
                                error.DeviceBusy => .BUSY,

                                // One of the path components was not a directory.
                                // This error is unreachable if `sub_path` does not contain a path separator.
                                error.NotDir => .NOTDIR,
                                // On Windows, file paths must be valid Unicode.
                                error.InvalidUtf8 => .INVAL,

                                // On Windows, file paths cannot contain these characters:
                                // '/', '*', '?', '"', '<', '>', '|'
                                error.BadPathName => .INVAL,

                                else => .FAULT,
                            };
                            if (args.force) {
                                return Maybe(Return.Rm).success;
                            }
                            return Maybe(Return.Rm){
                                .err = JSC.Node.Syscall.Error.fromCode(errno, .unlink),
                            };
                        };
                        return Maybe(Return.Rm).success;
                    }
                }

                {
                    var dest = args.path.sliceZ(&this.sync_error_buf);
                    std.os.unlinkZ(dest) catch |er| {
                        // empircally, it seems to return AccessDenied when the
                        // file is actually a directory on macOS.
                        if (args.recursive and
                            (er == error.IsDir or er == error.NotDir or er == error.AccessDenied))
                        {
                            std.os.rmdirZ(dest) catch |err| {
                                if (args.force) {
                                    return Maybe(Return.Rm).success;
                                }

                                const code: std.os.E = switch (err) {
                                    error.AccessDenied => .PERM,
                                    error.SymLinkLoop => .LOOP,
                                    error.NameTooLong => .NAMETOOLONG,
                                    error.SystemResources => .NOMEM,
                                    error.ReadOnlyFileSystem => .ROFS,
                                    error.FileBusy => .BUSY,
                                    error.FileNotFound => .NOENT,
                                    error.InvalidUtf8 => .INVAL,
                                    error.BadPathName => .INVAL,
                                    else => .FAULT,
                                };

                                return .{
                                    .err = JSC.Node.Syscall.Error.fromCode(
                                        code,
                                        .rmdir,
                                    ),
                                };
                            };

                            return Maybe(Return.Rm).success;
                        }

                        if (args.force) {
                            return Maybe(Return.Rm).success;
                        }

                        {
                            const code: std.os.E = switch (er) {
                                error.AccessDenied => .PERM,
                                error.SymLinkLoop => .LOOP,
                                error.NameTooLong => .NAMETOOLONG,
                                error.SystemResources => .NOMEM,
                                error.ReadOnlyFileSystem => .ROFS,
                                error.FileBusy => .BUSY,
                                error.InvalidUtf8 => .INVAL,
                                error.BadPathName => .INVAL,
                                error.FileNotFound => .NOENT,
                                else => .FAULT,
                            };

                            return .{
                                .err = JSC.Node.Syscall.Error.fromCode(
                                    code,
                                    .unlink,
                                ),
                            };
                        }
                    };

                    return Maybe(Return.Rm).success;
                }
            },
            else => {},
        }

        return Maybe(Return.Rm).todo;
    }
    pub fn stat(this: *NodeFS, args: Arguments.Stat, comptime flavor: Flavor) Maybe(Return.Stat) {
        if (args.big_int) return Maybe(Return.Stat).todo;

        switch (comptime flavor) {
            .sync => {
                return @as(Maybe(Return.Stat), switch (Syscall.stat(
                    args.path.sliceZ(
                        &this.sync_error_buf,
                    ),
                )) {
                    .result => |result| Maybe(Return.Stat){ .result = Return.Stat.init(result, false) },
                    .err => |err| Maybe(Return.Stat){ .err = err },
                });
            },
            else => {},
        }

        return Maybe(Return.Stat).todo;
    }

    pub fn symlink(this: *NodeFS, args: Arguments.Symlink, comptime flavor: Flavor) Maybe(Return.Symlink) {
        var to_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        switch (comptime flavor) {
            .sync => {
                return Syscall.symlink(
                    args.old_path.sliceZ(&this.sync_error_buf),
                    args.new_path.sliceZ(&to_buf),
                );
            },
            else => {},
        }

        return Maybe(Return.Symlink).todo;
    }
    fn _truncate(this: *NodeFS, path: PathLike, len: JSC.WebCore.Blob.SizeType, comptime flavor: Flavor) Maybe(Return.Truncate) {
        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Truncate).errno(C.truncate(path.sliceZ(&this.sync_error_buf), len)) orelse
                    Maybe(Return.Truncate).success;
            },
            else => {},
        }

        return Maybe(Return.Truncate).todo;
    }
    pub fn truncate(this: *NodeFS, args: Arguments.Truncate, comptime flavor: Flavor) Maybe(Return.Truncate) {
        return switch (args.path) {
            .fd => |fd| this.ftruncate(
                Arguments.FTruncate{ .fd = fd, .len = args.len },
                flavor,
            ),
            .path => this._truncate(
                args.path.path,
                args.len,
                flavor,
            ),
        };
    }
    pub fn unlink(this: *NodeFS, args: Arguments.Unlink, comptime flavor: Flavor) Maybe(Return.Unlink) {
        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Unlink).errnoSysP(system.unlink(args.path.sliceZ(&this.sync_error_buf)), .unlink, args.path.slice()) orelse
                    Maybe(Return.Unlink).success;
            },
            else => {},
        }

        return Maybe(Return.Unlink).todo;
    }
    pub fn unwatchFile(_: *NodeFS, _: Arguments.UnwatchFile, comptime _: Flavor) Maybe(Return.UnwatchFile) {
        return Maybe(Return.UnwatchFile).todo;
    }
    pub fn utimes(this: *NodeFS, args: Arguments.Utimes, comptime flavor: Flavor) Maybe(Return.Utimes) {
        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.mtime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
            .{
                .tv_sec = args.atime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
        };

        switch (comptime flavor) {
            // futimes uses the syscall version
            // we use libc because here, not for a good reason
            // just missing from the linux syscall interface in zig and I don't want to modify that right now
            .sync => return if (Maybe(Return.Utimes).errnoSysP(std.c.utimes(args.path.sliceZ(&this.sync_error_buf), &times), .utimes, args.path.slice())) |err|
                err
            else
                Maybe(Return.Utimes).success,
            else => {},
        }

        return Maybe(Return.Utimes).todo;
    }

    pub fn lutimes(this: *NodeFS, args: Arguments.Lutimes, comptime flavor: Flavor) Maybe(Return.Lutimes) {
        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.mtime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
            .{
                .tv_sec = args.atime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
        };

        switch (comptime flavor) {
            // futimes uses the syscall version
            // we use libc because here, not for a good reason
            // just missing from the linux syscall interface in zig and I don't want to modify that right now
            .sync => return if (Maybe(Return.Lutimes).errnoSysP(C.lutimes(args.path.sliceZ(&this.sync_error_buf), &times), .lutimes, args.path.slice())) |err|
                err
            else
                Maybe(Return.Lutimes).success,
            else => {},
        }

        return Maybe(Return.Lutimes).todo;
    }
    pub fn watch(_: *NodeFS, _: Arguments.Watch, comptime _: Flavor) Maybe(Return.Watch) {
        return Maybe(Return.Watch).todo;
    }
    pub fn createReadStream(_: *NodeFS, _: Arguments.CreateReadStream, comptime _: Flavor) Maybe(Return.CreateReadStream) {
        return Maybe(Return.CreateReadStream).todo;
    }
    pub fn createWriteStream(_: *NodeFS, _: Arguments.CreateWriteStream, comptime _: Flavor) Maybe(Return.CreateWriteStream) {
        return Maybe(Return.CreateWriteStream).todo;
    }
};

pub export fn Bun__mkdirp(globalThis: *JSC.JSGlobalObject, path: [*:0]const u8) bool {
    return globalThis.bunVM().nodeFS().mkdirRecursive(
        Arguments.Mkdir{
            .path = PathLike{ .string = PathString.init(bun.span(path)) },
            .recursive = true,
        },
        .sync,
    ) != .err;
}

comptime {
    if (!JSC.is_bindgen)
        _ = Bun__mkdirp;
}
