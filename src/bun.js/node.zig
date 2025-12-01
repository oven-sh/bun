//! Node.js APIs in Bun. Access this namespace with `bun.api.node`
comptime {
    _ = process.getTitle;
    _ = process.setTitle;
    _ = @import("./node/util/parse_args.zig");
}

/// node:fs
pub const fs = @import("./node/node_fs.zig");
/// node:path
pub const path = @import("./node/path.zig");
/// node:crypto
pub const crypto = @import("./node/node_crypto_binding.zig");
/// node:os
pub const os = @import("./node/node_os.zig");
/// node:process
pub const process = @import("./node/node_process.zig");
pub const validators = @import("./node/util/validators.zig");
pub const ErrorCode = @import("./node/nodejs_error_code.zig").Code;

pub const Buffer = jsc.MarkedArrayBuffer;

pub const PathOrBlob = types.PathOrBlob;
pub const Dirent = types.Dirent;
pub const FileSystemFlags = types.FileSystemFlags;
pub const PathOrFileDescriptor = types.PathOrFileDescriptor;
pub const modeFromJS = types.modeFromJS;
pub const VectorArrayBuffer = types.VectorArrayBuffer;
pub const Valid = types.Valid;
pub const PathLike = types.PathLike;
pub const CallbackTask = types.CallbackTask;
pub const PathOrBuffer = types.PathOrBuffer;
pub const jsAssertEncodingValid = types.jsAssertEncodingValid;
pub const Encoding = types.Encoding;
pub const StringOrBuffer = types.StringOrBuffer;
pub const BlobOrStringOrBuffer = types.BlobOrStringOrBuffer;

pub const FSEvents = @import("./node/fs_events.zig");
pub const Stats = stat.Stats;
pub const StatsBig = stat.StatsBig;
pub const StatsSmall = stat.StatsSmall;

pub const StatFSSmall = statfs.StatFSSmall;
pub const StatFSBig = statfs.StatFSBig;
pub const StatFS = statfs.StatFS;

pub const uid_t = if (Environment.isPosix) std.posix.uid_t else bun.windows.libuv.uv_uid_t;
pub const gid_t = if (Environment.isPosix) std.posix.gid_t else bun.windows.libuv.uv_gid_t;

pub const time_like = @import("./node/time_like.zig");
pub const TimeLike = time_like.TimeLike;
pub const timeLikeFromJS = time_like.fromJS;

/// Node.js expects the error to include contextual information
/// - "syscall"
/// - "path"
/// - "errno"
///
/// We can't really use Zig's error handling for syscalls because Node.js expects the "real" errno to be returned
/// and various issues with std.posix that make it too unstable for arbitrary user input (e.g. how .BADF is marked as unreachable)
pub fn Maybe(comptime ReturnTypeT: type, comptime ErrorTypeT: type) type {
    // can't call @hasDecl on void, anyerror, etc
    const has_any_decls = ErrorTypeT != void and ErrorTypeT != anyerror;
    const has_retry = has_any_decls and @hasDecl(ErrorTypeT, "retry");
    const has_todo = has_any_decls and @hasDecl(ErrorTypeT, "todo");

    return union(Tag) {
        pub const ErrorType = ErrorTypeT;
        pub const ReturnType = ReturnTypeT;

        err: ErrorType,
        result: ReturnType,

        pub const Tag = enum { err, result };

        pub const retry: @This() = if (has_retry) .{ .err = ErrorType.retry } else .{ .err = .{} };
        pub const success: @This() = .{
            .result = std.mem.zeroes(ReturnType),
        };
        /// This value is technically garbage, but that is okay as `.aborted` is
        /// only meant to be returned in an operation when there is an aborted
        /// `AbortSignal` object associated with the operation.
        pub const aborted: @This() = .{ .err = .{
            .errno = @intFromEnum(posix.E.INTR),
            .syscall = .access,
        } };

        pub inline fn todo() @This() {
            if (Environment.allow_assert) {
                if (comptime ReturnType == void) {
                    @panic("TODO called!");
                }
                @panic(comptime "TODO: Maybe(" ++ bun.meta.typeName(ReturnType) ++ ")");
            }
            if (has_todo) {
                return .{ .err = ErrorType.todo() };
            }
            return .{ .err = ErrorType{} };
        }

        pub fn isTrue(this: @This()) bool {
            if (comptime ReturnType != bool) @compileError("This function can only be called on bool");
            return switch (this) {
                .result => |r| r,
                else => false,
            };
        }

        pub fn unwrap(this: @This()) !ReturnType {
            return switch (this) {
                .result => |r| r,
                .err => |e| bun.errnoToZigErr(e.errno),
            };
        }

        /// Unwrap the value if it is `result` or use the provided `default_value`
        pub inline fn unwrapOr(this: @This(), default_value: ReturnType) ReturnType {
            return switch (this) {
                .result => |v| v,
                .err => default_value,
            };
        }

        pub inline fn initErr(e: ErrorType) Maybe(ReturnType, ErrorType) {
            return .{ .err = e };
        }

        pub inline fn initErrWithP(e: bun.sys.SystemErrno, syscall: sys.Tag, file_path: anytype) Maybe(ReturnType, ErrorType) {
            return .{ .err = .{
                .errno = @intFromEnum(e),
                .syscall = syscall,
                .path = file_path,
            } };
        }

        pub inline fn asErr(this: *const @This()) ?ErrorType {
            if (this.* == .err) return this.err;
            return null;
        }

        pub inline fn asValue(this: *const @This()) ?ReturnType {
            if (this.* == .result) return this.result;
            return null;
        }

        pub inline fn isOk(this: *const @This()) bool {
            return switch (this.*) {
                .result => true,
                .err => false,
            };
        }

        pub inline fn isErr(this: *const @This()) bool {
            return switch (this.*) {
                .result => false,
                .err => true,
            };
        }

        pub inline fn initResult(result: ReturnType) Maybe(ReturnType, ErrorType) {
            return .{ .result = result };
        }

        pub inline fn mapErr(this: @This(), comptime E: type, err_fn: *const fn (ErrorTypeT) E) Maybe(ReturnType, E) {
            return switch (this) {
                .result => |v| .{ .result = v },
                .err => |e| .{ .err = err_fn(e) },
            };
        }

        pub inline fn toCssResult(this: @This()) Maybe(ReturnType, bun.css.ParseError(bun.css.ParserError)) {
            return switch (ErrorTypeT) {
                bun.css.BasicParseError => {
                    return switch (this) {
                        .result => |v| return .{ .result = v },
                        .err => |e| return .{ .err = e.intoDefaultParseError() },
                    };
                },
                bun.css.ParseError(bun.css.ParserError) => @compileError("Already a ParseError(ParserError)"),
                else => @compileError("Bad!"),
            };
        }

        pub fn toJS(this: @This(), globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
            return switch (this) {
                .result => |r| switch (ReturnType) {
                    jsc.JSValue => r,

                    void => .js_undefined,
                    bool => jsc.JSValue.jsBoolean(r),

                    jsc.ArrayBuffer => r.toJS(globalObject),
                    []u8 => jsc.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalObject),

                    else => switch (@typeInfo(ReturnType)) {
                        .int, .float, .comptime_int, .comptime_float => jsc.JSValue.jsNumber(r),
                        .@"struct", .@"enum", .@"opaque", .@"union" => r.toJS(globalObject),
                        .pointer => {
                            if (bun.trait.isZigString(ReturnType))
                                jsc.ZigString.init(bun.asByteSlice(r)).withEncoding().toJS(globalObject);

                            return r.toJS(globalObject);
                        },
                    },
                },
                .err => |e| e.toJS(globalObject),
            };
        }

        pub fn toArrayBuffer(this: @This(), globalObject: *jsc.JSGlobalObject) jsc.JSValue {
            return switch (this) {
                .result => |r| jsc.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalObject, null),
                .err => |e| e.toJS(globalObject),
            };
        }

        pub fn getErrno(this: @This()) posix.E {
            return switch (this) {
                .result => posix.E.SUCCESS,
                .err => |e| @enumFromInt(e.errno),
            };
        }

        pub fn errnoSys(rc: anytype, syscall: sys.Tag) ?@This() {
            if (comptime Environment.isWindows) {
                if (comptime @TypeOf(rc) == std.os.windows.NTSTATUS) {} else {
                    if (rc != 0) return null;
                }
            }
            return switch (sys.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                    },
                },
            };
        }

        pub fn errno(err: anytype, syscall: sys.Tag) @This() {
            return @This(){
                // always truncate
                .err = .{
                    .errno = translateToErrInt(err),
                    .syscall = syscall,
                },
            };
        }

        pub fn errnoSysFd(rc: anytype, syscall: sys.Tag, fd: bun.FileDescriptor) ?@This() {
            if (comptime Environment.isWindows) {
                if (comptime @TypeOf(rc) == std.os.windows.NTSTATUS) {} else {
                    if (rc != 0) return null;
                }
            }
            return switch (sys.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .fd = fd,
                    },
                },
            };
        }

        pub fn errnoSysP(rc: anytype, syscall: sys.Tag, file_path: anytype) ?@This() {
            if (bun.meta.Item(@TypeOf(file_path)) == u16) {
                @compileError("Do not pass WString path to errnoSysP, it needs the path encoded as utf8");
            }
            if (comptime Environment.isWindows) {
                if (comptime @TypeOf(rc) == std.os.windows.NTSTATUS) {} else {
                    if (rc != 0) return null;
                }
            }
            return switch (sys.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .path = bun.asByteSlice(file_path),
                    },
                },
            };
        }

        pub fn errnoSysFP(rc: anytype, syscall: sys.Tag, fd: bun.FileDescriptor, file_path: anytype) ?@This() {
            if (comptime Environment.isWindows) {
                if (comptime @TypeOf(rc) == std.os.windows.NTSTATUS) {} else {
                    if (rc != 0) return null;
                }
            }
            return switch (sys.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .fd = fd,
                        .path = bun.asByteSlice(file_path),
                    },
                },
            };
        }

        pub fn errnoSysPD(rc: anytype, syscall: sys.Tag, file_path: anytype, dest: anytype) ?@This() {
            if (bun.meta.Item(@TypeOf(file_path)) == u16) {
                @compileError("Do not pass WString path to errnoSysPD, it needs the path encoded as utf8");
            }
            if (comptime Environment.isWindows) {
                if (comptime @TypeOf(rc) == std.os.windows.NTSTATUS) {} else {
                    if (rc != 0) return null;
                }
            }
            return switch (sys.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .path = bun.asByteSlice(file_path),
                        .dest = bun.asByteSlice(dest),
                    },
                },
            };
        }

        pub fn format(this: @This(), writer: *std.Io.Writer) !void {
            return switch (this) {
                .result => try writer.print("Result(...)", .{}),
                .err => |e| try writer.print("Error(" ++ bun.deprecated.autoFormatLabelFallback(ErrorType, "{any}") ++ ")", .{e}),
            };
        }
    };
}

fn translateToErrInt(err: anytype) bun.sys.Error.Int {
    return switch (@TypeOf(err)) {
        bun.windows.NTSTATUS => @intFromEnum(bun.windows.translateNTStatusToErrno(err)),
        else => @truncate(@intFromEnum(err)),
    };
}

const stat = @import("./node/Stat.zig");
const statfs = @import("./node/StatFS.zig");
const types = @import("./node/types.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const meta = bun.meta;
const sys = bun.sys;
const windows = bun.windows;

const std = @import("std");
const posix = std.posix;
