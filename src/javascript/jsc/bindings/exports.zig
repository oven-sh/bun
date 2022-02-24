const JSC = @import("../../../jsc.zig");
const Fs = @import("../../../fs.zig");
const CAPI = @import("../../../jsc.zig").C;
const JS = @import("../javascript.zig");
const JSBase = @import("../base.zig");
const ZigURL = @import("../../../query_string_map.zig").URL;
const Api = @import("../../../api/schema.zig").Api;
const _global = @import("../../../global.zig");
const std = @import("std");
const Shimmer = @import("./shimmer.zig").Shimmer;
const strings = @import("strings");
const default_allocator = _global.default_allocator;
const NewGlobalObject = JSC.NewGlobalObject;
const JSGlobalObject = JSC.JSGlobalObject;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const ZigString = JSC.ZigString;
const string = _global.string;
const JSValue = JSC.JSValue;
const Output = _global.Output;
const Environment = _global.Environment;
const ScriptArguments = JSC.ScriptArguments;
const JSPromise = JSC.JSPromise;
const JSPromiseRejectionOperation = JSC.JSPromiseRejectionOperation;
const Exception = JSC.Exception;
const JSModuleLoader = JSC.JSModuleLoader;
const JSModuleRecord = JSC.JSModuleRecord;
const Microtask = JSC.Microtask;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const Backtrace = @import("../../../deps/backtrace.zig");

pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *anyopaque;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(JS.VirtualMachine);

    pub fn create(class_ref: [*]CAPI.JSClassRef, count: i32, console: *anyopaque) *JSGlobalObject {
        var global = shim.cppFn("create", .{ class_ref, count, console });
        Backtrace.reloadHandlers();
        return global;
    }

    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return shim.cppFn("getModuleRegistryMap", .{global});
    }

    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return shim.cppFn("resetModuleRegistryMap", .{ global, map });
    }

    pub fn import(global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) ErrorableZigString {
        if (comptime is_bindgen) {
            unreachable;
        }

        return @call(.{ .modifier = .always_inline }, Interface.import, .{ global, specifier, source });
    }
    pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
        if (comptime is_bindgen) {
            unreachable;
        }
        @call(.{ .modifier = .always_inline }, Interface.resolve, .{ res, global, specifier, source });
    }
    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
        if (comptime is_bindgen) {
            unreachable;
        }
        @call(.{ .modifier = .always_inline }, Interface.fetch, .{ ret, global, specifier, source });
    }

    pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.promiseRejectionTracker, .{ global, promise, rejection });
    }

    pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.reportUncaughtException, .{ global, exception });
    }

    pub fn createImportMetaProperties(global: *JSGlobalObject, loader: *JSModuleLoader, obj: JSValue, record: *JSModuleRecord, specifier: JSValue) callconv(.C) JSValue {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.createImportMetaProperties, .{ global, loader, obj, record, specifier });
    }

    pub fn onCrash() callconv(.C) void {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.onCrash, .{});
    }

    pub fn queueMicrotaskToEventLoop(global: *JSGlobalObject, microtask: *Microtask) callconv(.C) void {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.queueMicrotaskToEventLoop, .{ global, microtask });
    }

    pub const Export = shim.exportFunctions(
        .{
            .@"import" = import,
            .@"resolve" = resolve,
            .@"fetch" = fetch,
            // .@"eval" = eval,
            .@"promiseRejectionTracker" = promiseRejectionTracker,
            .@"reportUncaughtException" = reportUncaughtException,
            .@"createImportMetaProperties" = createImportMetaProperties,
            .@"onCrash" = onCrash,
            .@"queueMicrotaskToEventLoop" = queueMicrotaskToEventLoop,
        },
    );

    pub const Extern = [_][]const u8{ "create", "getModuleRegistryMap", "resetModuleRegistryMap" };

    comptime {
        @export(import, .{ .name = Export[0].symbol_name });
        @export(resolve, .{ .name = Export[1].symbol_name });
        @export(fetch, .{ .name = Export[2].symbol_name });
        @export(promiseRejectionTracker, .{ .name = Export[3].symbol_name });
        @export(reportUncaughtException, .{ .name = Export[4].symbol_name });
        @export(createImportMetaProperties, .{ .name = Export[5].symbol_name });
        @export(onCrash, .{ .name = Export[6].symbol_name });
        @export(queueMicrotaskToEventLoop, .{ .name = Export[7].symbol_name });
    }
};

const ErrorCodeInt = u16;

pub const ErrorCode = enum(ErrorCodeInt) {
    _,

    pub inline fn from(code: anyerror) ErrorCode {
        return @intToEnum(ErrorCode, @errorToInt(code));
    }

    pub const ParserError = @enumToInt(ErrorCode.from(error.ParserError));
    pub const JSErrorObject = @enumToInt(ErrorCode.from(error.JSErrorObject));

    pub const Type = ErrorCodeInt;
};

pub const ZigErrorType = extern struct {
    pub const shim = Shimmer("Zig", "ErrorType", @This());
    pub const name = "ErrorType";
    pub const namespace = shim.namespace;

    code: ErrorCode,
    ptr: ?*anyopaque,

    pub fn isPrivateData(ptr: ?*anyopaque) callconv(.C) bool {
        return JSBase.JSPrivateDataPtr.isValidPtr(ptr);
    }

    pub const Export = shim.exportFunctions(.{
        .@"isPrivateData" = isPrivateData,
    });

    comptime {
        @export(isPrivateData, .{
            .name = Export[0].symbol_name,
        });
    }
};

/// do not use this reference directly, use JSC.Node.Readable
pub const NodeReadableStream = JSC.Node.Readable.State;
/// do not use this reference directly, use JSC.Node.Writable
pub const NodeWritableStream = JSC.Node.Writable.State;

pub const NodePath = JSC.Node.Path;

pub fn Errorable(comptime Type: type) type {
    return extern struct {
        result: Result,
        success: bool,
        pub const name = "Errorable" ++ @typeName(Type);

        pub const Result = extern union {
            value: Type,
            err: ZigErrorType,
        };

        pub fn value(val: Type) @This() {
            return @This(){ .result = .{ .value = val }, .success = true };
        }

        pub fn ok(val: Type) @This() {
            return @This(){ .result = .{ .value = val }, .success = true };
        }

        threadlocal var err_buf: [4096]u8 = undefined;
        pub fn err(code: anyerror, ptr: *anyopaque) @This() {
            return @This(){
                .result = .{
                    .err = .{
                        .code = ErrorCode.from(code),
                        .ptr = ptr,
                    },
                },
                .success = false,
            };
        }
    };
}

pub const ResolvedSource = extern struct {
    pub const shim = Shimmer("Zig", "ResolvedSource", @This());
    pub const name = "ResolvedSource";
    pub const namespace = shim.namespace;

    specifier: ZigString,
    source_code: ZigString,
    source_url: ZigString,
    hash: u32,

    allocator: ?*anyopaque,

    // 0 means disabled
    bytecodecache_fd: u64,
};

export fn ZigString__free(ptr: [*]const u8, len: usize, allocator_: ?*anyopaque) void {
    var allocator: std.mem.Allocator = @ptrCast(*std.mem.Allocator, @alignCast(@alignOf(*std.mem.Allocator), allocator_ orelse return)).*;

    var str = ptr[0..len];
    allocator.free(str);
}

export fn ZigString__free_global(ptr: [*]const u8, len: usize) void {
    var str = ptr[0..len];
    default_allocator.free(str);
}

pub const JSErrorCode = enum(u8) {
    Error = 0,
    EvalError = 1,
    RangeError = 2,
    ReferenceError = 3,
    SyntaxError = 4,
    TypeError = 5,
    URIError = 6,
    AggregateError = 7,

    // StackOverflow & OutOfMemoryError is not an ErrorType in <JavaScriptCore/ErrorType.h> within JSC, so the number here is just totally made up
    OutOfMemoryError = 8,
    BundlerError = 252,
    StackOverflow = 253,
    UserErrorCode = 254,
    _,
};

pub const JSRuntimeType = enum(u16) {
    Nothing = 0x0,
    Function = 0x1,
    Undefined = 0x2,
    Null = 0x4,
    Boolean = 0x8,
    AnyInt = 0x10,
    Number = 0x20,
    String = 0x40,
    Object = 0x80,
    Symbol = 0x100,
    BigInt = 0x200,

    _,
};

pub const ZigStackFrameCode = enum(u8) {
    None = 0,
    // 🏃
    Eval = 1,
    // 📦
    Module = 2,
    // λ
    Function = 3,
    // 🌎
    Global = 4,
    // ⚙️
    Wasm = 5,
    // 👷
    Constructor = 6,
    _,

    pub fn emoji(this: ZigStackFrameCode) u21 {
        return switch (this) {
            .Eval => 0x1F3C3,
            .Module => 0x1F4E6,
            .Function => 0x03BB,
            .Global => 0x1F30E,
            .Wasm => 0xFE0F,
            .Constructor => 0xF1477,
            else => ' ',
        };
    }

    pub fn ansiColor(this: ZigStackFrameCode) string {
        return switch (this) {
            .Eval => "\x1b[31m",
            .Module => "\x1b[36m",
            .Function => "\x1b[32m",
            .Global => "\x1b[35m",
            .Wasm => "\x1b[37m",
            .Constructor => "\x1b[33m",
            else => "",
        };
    }
};

pub const Process = extern struct {
    pub const shim = Shimmer("Bun", "Process", @This());
    pub const name = "Process";
    pub const namespace = shim.namespace;
    const _bun: string = "bun";

    pub fn getTitle(_: *JSGlobalObject, title: *ZigString) callconv(.C) void {
        title.* = ZigString.init(_bun);
    }

    // TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
    pub fn setTitle(globalObject: *JSGlobalObject, _: *ZigString) callconv(.C) JSValue {
        return ZigString.init(_bun).toValue(globalObject);
    }

    pub const getArgv = JSC.Node.Process.getArgv;
    pub const getCwd = JSC.Node.Process.getCwd;
    pub const setCwd = JSC.Node.Process.setCwd;

    pub const Export = shim.exportFunctions(.{
        .@"getTitle" = getTitle,
        .@"setTitle" = setTitle,
        .@"getArgv" = getArgv,
        .@"getCwd" = getCwd,
        .@"setCwd" = setCwd,
    });

    comptime {
        if (!is_bindgen) {
            @export(getTitle, .{
                .name = Export[0].symbol_name,
            });
            @export(setTitle, .{
                .name = Export[1].symbol_name,
            });
            @export(getArgv, .{
                .name = Export[2].symbol_name,
            });
            @export(getCwd, .{
                .name = Export[3].symbol_name,
            });
            @export(setCwd, .{
                .name = Export[4].symbol_name,
            });
        }
    }
};

pub const ZigStackTrace = extern struct {
    source_lines_ptr: [*c]ZigString,
    source_lines_numbers: [*c]i32,
    source_lines_len: u8,
    source_lines_to_collect: u8,

    frames_ptr: [*c]ZigStackFrame,
    frames_len: u8,

    pub fn toAPI(this: *const ZigStackTrace, allocator: std.mem.Allocator) !Api.StackTrace {
        var stack_trace: Api.StackTrace = std.mem.zeroes(Api.StackTrace);
        {
            var source_lines_iter = this.sourceLineIterator();

            var source_line_len: usize = 0;
            var count: usize = 0;
            while (source_lines_iter.next()) |source| {
                count += 1;
                source_line_len += source.text.len;
            }

            if (count > 0 and source_line_len > 0) {
                var source_lines = try allocator.alloc(Api.SourceLine, count);
                var source_line_buf = try allocator.alloc(u8, source_line_len);
                source_lines_iter = this.sourceLineIterator();
                var remain_buf = source_line_buf[0..];
                var i: usize = 0;
                while (source_lines_iter.next()) |source| {
                    std.mem.copy(u8, remain_buf, source.text);
                    const copied_line = remain_buf[0..source.text.len];
                    remain_buf = remain_buf[source.text.len..];
                    source_lines[i] = .{ .text = copied_line, .line = source.line };
                    i += 1;
                }
                stack_trace.source_lines = source_lines;
            }
        }
        {
            var _frames = this.frames();
            if (_frames.len > 0) {
                var stack_frames = try allocator.alloc(Api.StackFrame, _frames.len);
                stack_trace.frames = stack_frames;

                for (_frames) |frame, i| {
                    stack_frames[i] = try frame.toAPI(allocator);
                }
            }
        }

        return stack_trace;
    }

    pub fn frames(this: *const ZigStackTrace) []const ZigStackFrame {
        return this.frames_ptr[0..this.frames_len];
    }

    pub const SourceLineIterator = struct {
        trace: *const ZigStackTrace,
        i: i16,

        pub const SourceLine = struct {
            line: i32,
            text: string,
        };

        pub fn untilLast(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 1) return null;
            return this.next();
        }

        pub fn next(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 0) return null;

            const source_line = this.trace.source_lines_ptr[@intCast(usize, this.i)];
            const result = SourceLine{
                .line = this.trace.source_lines_numbers[@intCast(usize, this.i)],
                .text = source_line.slice(),
            };
            this.i -= 1;
            return result;
        }
    };

    pub fn sourceLineIterator(this: *const ZigStackTrace) SourceLineIterator {
        var i: usize = 0;
        for (this.source_lines_numbers[0..this.source_lines_len]) |num, j| {
            if (num > 0) {
                i = j;
            }
        }
        return SourceLineIterator{ .trace = this, .i = @intCast(i16, i) };
    }
};

pub const ZigStackFrame = extern struct {
    function_name: ZigString,
    source_url: ZigString,
    position: ZigStackFramePosition,
    code_type: ZigStackFrameCode,

    pub fn toAPI(this: *const ZigStackFrame, allocator: std.mem.Allocator) !Api.StackFrame {
        var frame: Api.StackFrame = std.mem.zeroes(Api.StackFrame);
        if (this.function_name.len > 0) {
            frame.function_name = try allocator.dupe(u8, this.function_name.slice());
        }

        if (this.source_url.len > 0) {
            frame.file = try allocator.dupe(u8, this.source_url.slice());
        }

        frame.position.source_offset = this.position.source_offset;
        frame.position.line = this.position.line;
        frame.position.line_start = this.position.line_start;
        frame.position.line_stop = this.position.line_stop;
        frame.position.column_start = this.position.column_start;
        frame.position.column_stop = this.position.column_stop;
        frame.position.expression_start = this.position.expression_start;
        frame.position.expression_stop = this.position.expression_stop;
        frame.scope = @intToEnum(Api.StackFrameScope, @enumToInt(this.code_type));

        return frame;
    }

    pub const SourceURLFormatter = struct {
        source_url: ZigString,
        position: ZigStackFramePosition,
        enable_color: bool,
        origin: ?*const ZigURL,

        root_path: string = "",
        pub fn format(this: SourceURLFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.origin) |origin| {
                try writer.writeAll(origin.displayProtocol());
                try writer.writeAll("://");
                try writer.writeAll(origin.displayHostname());
                try writer.writeAll(":");
                try writer.writeAll(origin.port);
                try writer.writeAll("/blob:");
            }

            var source_slice = this.source_url.slice();
            if (strings.startsWith(source_slice, this.root_path)) {
                source_slice = source_slice[this.root_path.len..];
            }

            try writer.writeAll(source_slice);
            if (this.position.line > -1 and this.position.column_start > -1) {
                try std.fmt.format(writer, ":{d}:{d}", .{ this.position.line + 1, this.position.column_start });
            } else if (this.position.line > -1) {
                try std.fmt.format(writer, ":{d}", .{
                    this.position.line + 1,
                });
            }
        }
    };

    pub const NameFormatter = struct {
        function_name: ZigString,
        code_type: ZigStackFrameCode,
        enable_color: bool,

        pub fn format(this: NameFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const name = this.function_name.slice();

            switch (this.code_type) {
                .Eval => {
                    try writer.writeAll("(eval)");
                },
                .Module => {
                    try writer.writeAll("(esm)");
                },
                .Function => {
                    if (name.len > 0) {
                        try std.fmt.format(writer, "{s}", .{name});
                    } else {
                        try writer.writeAll("(anonymous)");
                    }
                },
                .Global => {
                    if (name.len > 0) {
                        try std.fmt.format(writer, "globalThis {s}", .{name});
                    } else {
                        try writer.writeAll("globalThis");
                    }
                },
                .Wasm => {
                    try std.fmt.format(writer, "WASM {s}", .{name});
                },
                .Constructor => {
                    try std.fmt.format(writer, "new {s}", .{name});
                },
                else => {},
            }
        }
    };

    pub const Zero: ZigStackFrame = ZigStackFrame{
        .function_name = ZigString{ .ptr = "", .len = 0 },
        .code_type = ZigStackFrameCode.None,
        .source_url = ZigString{ .ptr = "", .len = 0 },
        .position = ZigStackFramePosition.Invalid,
    };

    pub fn nameFormatter(this: *const ZigStackFrame, comptime enable_color: bool) NameFormatter {
        return NameFormatter{ .function_name = this.function_name, .code_type = this.code_type, .enable_color = enable_color };
    }

    pub fn sourceURLFormatter(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, comptime enable_color: bool) SourceURLFormatter {
        return SourceURLFormatter{ .source_url = this.source_url, .origin = origin, .root_path = root_path, .position = this.position, .enable_color = enable_color };
    }
};

pub const ZigStackFramePosition = extern struct {
    source_offset: i32,
    line: i32,
    line_start: i32,
    line_stop: i32,
    column_start: i32,
    column_stop: i32,
    expression_start: i32,
    expression_stop: i32,

    pub const Invalid = ZigStackFramePosition{
        .source_offset = -1,
        .line = -1,
        .line_start = -1,
        .line_stop = -1,
        .column_start = -1,
        .column_stop = -1,
        .expression_start = -1,
        .expression_stop = -1,
    };
    pub fn isInvalid(this: *const ZigStackFramePosition) bool {
        return std.mem.eql(u8, std.mem.asBytes(this), std.mem.asBytes(&Invalid));
    }
};

pub const ZigException = extern struct {
    code: JSErrorCode,
    runtime_type: JSRuntimeType,

    /// SystemError only
    errno: c_int = 0,
    /// SystemError only
    syscall: ZigString = ZigString.Empty,
    /// SystemError only
    system_code: ZigString = ZigString.Empty,
    /// SystemError only
    path: ZigString = ZigString.Empty,

    name: ZigString,
    message: ZigString,
    stack: ZigStackTrace,

    exception: ?*anyopaque,

    pub const shim = Shimmer("Zig", "Exception", @This());
    pub const name = "ZigException";
    pub const namespace = shim.namespace;

    pub const Holder = extern struct {
        const frame_count = 24;
        const source_lines_count = 6;
        source_line_numbers: [source_lines_count]i32,
        source_lines: [source_lines_count]ZigString,
        frames: [frame_count]ZigStackFrame,
        loaded: bool,
        zig_exception: ZigException,

        pub const Zero: Holder = Holder{
            .frames = brk: {
                var _frames: [frame_count]ZigStackFrame = undefined;
                std.mem.set(ZigStackFrame, &_frames, ZigStackFrame.Zero);
                break :brk _frames;
            },
            .source_line_numbers = brk: {
                var lines: [source_lines_count]i32 = undefined;
                std.mem.set(i32, &lines, -1);
                break :brk lines;
            },

            .source_lines = brk: {
                var lines: [source_lines_count]ZigString = undefined;
                std.mem.set(ZigString, &lines, ZigString.Empty);
                break :brk lines;
            },
            .zig_exception = undefined,
            .loaded = false,
        };

        pub fn init() Holder {
            return Holder.Zero;
        }

        pub fn zigException(this: *Holder) *ZigException {
            if (!this.loaded) {
                this.zig_exception = ZigException{
                    .code = @intToEnum(JSErrorCode, 255),
                    .runtime_type = JSRuntimeType.Nothing,
                    .name = ZigString.Empty,
                    .message = ZigString.Empty,
                    .exception = null,
                    .stack = ZigStackTrace{
                        .source_lines_ptr = &this.source_lines,
                        .source_lines_numbers = &this.source_line_numbers,
                        .source_lines_len = source_lines_count,
                        .source_lines_to_collect = source_lines_count,
                        .frames_ptr = &this.frames,
                        .frames_len = this.frames.len,
                    },
                };
                this.loaded = true;
            }

            return &this.zig_exception;
        }
    };

    pub fn fromException(exception: *Exception) ZigException {
        return shim.cppFn("fromException", .{exception});
    }

    pub fn addToErrorList(this: *ZigException, error_list: *std.ArrayList(Api.JsException)) !void {
        const _name: string = @field(this, "name").slice();
        const message: string = @field(this, "message").slice();

        var is_empty = true;
        var api_exception = Api.JsException{
            .runtime_type = @enumToInt(this.runtime_type),
            .code = @enumToInt(this.code),
        };

        if (_name.len > 0) {
            api_exception.name = try error_list.allocator.dupe(u8, _name);
            is_empty = false;
        }

        if (message.len > 0) {
            api_exception.message = try error_list.allocator.dupe(u8, message);
            is_empty = false;
        }

        if (this.stack.frames_len > 0) {
            api_exception.stack = try this.stack.toAPI(error_list.allocator);
            is_empty = false;
        }

        if (!is_empty) {
            try error_list.append(api_exception);
        }
    }

    pub const Extern = [_][]const u8{"fromException"};
};

pub const ErrorableResolvedSource = Errorable(ResolvedSource);
pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);

pub const ZigConsoleClient = struct {
    pub const shim = Shimmer("Zig", "ConsoleClient", @This());
    pub const Type = *anyopaque;
    pub const name = "Zig::ConsoleClient";
    pub const include = "\"ZigConsoleClient.h\"";
    pub const namespace = shim.namespace;
    pub const Counter = struct {
        // if it turns out a hash table is a better idea we'll do that later
        pub const Entry = struct {
            hash: u32,
            count: u32,

            pub const List = std.MultiArrayList(Entry);
        };
        counts: Entry.List,
        allocator: std.mem.Allocator,
    };
    const BufferedWriter = std.io.BufferedWriter(4096, Output.WriterType);
    error_writer: BufferedWriter,
    writer: BufferedWriter,

    pub fn init(error_writer: Output.WriterType, writer: Output.WriterType) ZigConsoleClient {
        return ZigConsoleClient{
            .error_writer = BufferedWriter{ .unbuffered_writer = error_writer },
            .writer = BufferedWriter{ .unbuffered_writer = writer },
        };
    }

    pub const MessageLevel = enum(u32) {
        Log = 0,
        Warning = 1,
        Error = 2,
        Debug = 3,
        Info = 4,
        _,
    };

    pub const MessageType = enum(u32) {
        Log = 0,
        Dir = 1,
        DirXML = 2,
        Table = 3,
        Trace = 4,
        StartGroup = 5,
        StartGroupCollapsed = 6,
        EndGroup = 7,
        Clear = 8,
        Assert = 9,
        Timing = 10,
        Profile = 11,
        ProfileEnd = 12,
        Image = 13,
        _,
    };

    /// https://console.spec.whatwg.org/#formatter
    pub fn messageWithTypeAndLevel(
        //console_: ZigConsoleClient.Type,
        _: ZigConsoleClient.Type,
        message_type: MessageType,
        //message_level: u32,
        level: MessageLevel,
        global: *JSGlobalObject,
        vals: [*]JSValue,
        len: usize,
    ) callconv(.C) void {
        if (comptime @hasDecl(@import("root"), "bindgen")) {
            return;
        }

        var console = JS.VirtualMachine.vm.console;

        if (message_type == .Clear) {
            Output.resetTerminal();
            return;
        }

        if (message_type == .Assert and len == 0) {
            const text = if (Output.enable_ansi_colors_stderr)
                Output.prettyFmt("<r><red>Assertion failed<r>\n", true)
            else
                "Assertion failed\n";
            console.error_writer.unbuffered_writer.writeAll(text) catch unreachable;
            return;
        }

        const enable_colors = if (level == .Warning or level == .Error)
            Output.enable_ansi_colors_stderr
        else
            Output.enable_ansi_colors_stdout;
        var buffered_writer = if (level == .Warning or level == .Error)
            console.error_writer
        else
            console.writer;
        var writer = buffered_writer.writer();

        const BufferedWriterType = @TypeOf(writer);

        var fmt: Formatter = undefined;
        defer {
            if (fmt.map_node) |node| {
                node.data = fmt.map;
                node.data.clearRetainingCapacity();
                node.release();
            }
        }

        if (len == 1) {
            fmt = Formatter{ .remaining_values = &[_]JSValue{} };
            const tag = Formatter.Tag.get(vals[0], global);

            var unbuffered_writer = buffered_writer.unbuffered_writer.context.writer();
            const UnbufferedWriterType = @TypeOf(unbuffered_writer);

            if (tag.tag == .String) {
                if (enable_colors) {
                    if (level == .Error) {
                        unbuffered_writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
                    }
                    fmt.format(
                        tag,
                        UnbufferedWriterType,
                        unbuffered_writer,
                        vals[0],
                        global,
                        true,
                    );
                    if (level == .Error) {
                        unbuffered_writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch unreachable;
                    }
                } else {
                    fmt.format(
                        tag,
                        UnbufferedWriterType,
                        unbuffered_writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                _ = unbuffered_writer.write("\n") catch 0;
            } else {
                defer buffered_writer.flush() catch {};
                if (enable_colors) {
                    fmt.format(
                        tag,
                        BufferedWriterType,
                        writer,
                        vals[0],
                        global,
                        true,
                    );
                } else {
                    fmt.format(
                        tag,
                        BufferedWriterType,
                        writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                _ = writer.write("\n") catch 0;
            }

            return;
        }

        defer buffered_writer.flush() catch {};

        var this_value: JSValue = vals[0];
        fmt = Formatter{ .remaining_values = vals[0..len][1..] };
        var tag: Formatter.Tag.Result = undefined;

        var any = false;
        if (enable_colors) {
            if (level == .Error) {
                writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
            }
            while (true) {
                if (any) {
                    _ = writer.write(" ") catch 0;
                }
                any = true;

                tag = Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                fmt.format(tag, BufferedWriterType, writer, this_value, global, true);
                if (fmt.remaining_values.len == 0) {
                    break;
                }

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = fmt.remaining_values[1..];
            }
            if (level == .Error) {
                writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch unreachable;
            }
        } else {
            while (true) {
                if (any) {
                    _ = writer.write(" ") catch 0;
                }
                any = true;
                tag = Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                fmt.format(tag, BufferedWriterType, writer, this_value, global, false);
                if (fmt.remaining_values.len == 0)
                    break;

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = fmt.remaining_values[1..];
            }
        }

        _ = writer.write("\n") catch 0;
    }

    pub const Formatter = struct {
        remaining_values: []JSValue = &[_]JSValue{},
        map: Visited.Map = undefined,
        map_node: ?*Visited.Pool.Node = null,
        hide_native: bool = false,

        pub const ZigFormatter = struct {
            formatter: *Formatter,
            global: *JSGlobalObject,
            value: JSValue,

            pub const WriteError = error{UhOh};
            pub fn format(self: ZigFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                self.formatter.remaining_values = &[_]JSValue{self.value};
                defer {
                    self.formatter.remaining_values = &[_]JSValue{};
                }

                self.formatter.format(
                    Tag.get(self.value, self.global),
                    @TypeOf(writer),
                    writer,
                    self.value,
                    self.global,
                    false,
                );
            }
        };

        // For detecting circular references
        pub const Visited = struct {
            const ObjectPool = @import("../../../pool.zig").ObjectPool;
            pub const Map = std.AutoHashMap(i64, void);
            pub const Pool = ObjectPool(
                Map,
                struct {
                    pub fn init(allocator: std.mem.Allocator) anyerror!Map {
                        return Map.init(allocator);
                    }
                }.init,
                true,
                16,
            );
        };

        pub const Tag = enum {
            StringPossiblyFormatted,
            String,
            Undefined,
            Double,
            Integer,
            Null,
            Boolean,
            Array,
            Object,
            Function,
            Class,
            Error,
            TypedArray,
            Map,
            Set,
            Symbol,
            BigInt,

            GlobalObject,
            Private,
            Promise,

            JSON,
            NativeCode,
            ArrayBuffer,

            pub inline fn canHaveCircularReferences(tag: Tag) bool {
                return tag == .Array or tag == .Object or tag == .Map or tag == .Set;
            }

            const Result = struct {
                tag: Tag,
                cell: JSValue.JSType = JSValue.JSType.Cell,
            };

            pub fn get(value: JSValue, globalThis: *JSGlobalObject) Result {
                if (value.isInt32()) {
                    return .{
                        .tag = .Integer,
                    };
                } else if (value.isNumber()) {
                    return .{
                        .tag = .Double,
                    };
                } else if (value.isUndefined()) {
                    return .{
                        .tag = .Undefined,
                    };
                } else if (value.isNull()) {
                    return .{
                        .tag = .Null,
                    };
                } else if (value.isBoolean()) {
                    return .{
                        .tag = .Boolean,
                    };
                }

                const js_type = value.jsType();

                if (js_type.isHidden()) return .{ .tag = .NativeCode };

                if (CAPI.JSObjectGetPrivate(value.asObjectRef()) != null)
                    return .{
                        .tag = .Private,
                    };

                // If we check an Object has a method table and it does not
                // it will crash
                const callable = js_type != .Object and value.isCallable(globalThis.vm());

                if (value.isClass(globalThis) and !callable) {
                    // Temporary workaround
                    // console.log(process.env) shows up as [class JSCallbackObject]
                    // We want to print it like an object
                    if (CAPI.JSValueIsObjectOfClass(globalThis.ref(), value.asObjectRef(), JSC.Bun.EnvironmentVariables.Class.get().?[0])) {
                        return .{
                            .tag = .Object,
                        };
                    }
                    return .{
                        .tag = .Class,
                    };
                }

                if (callable) {
                    return .{
                        .tag = .Function,
                    };
                }

                return .{
                    .tag = switch (js_type) {
                        JSValue.JSType.ErrorInstance => .Error,
                        JSValue.JSType.NumberObject => .Double,
                        JSValue.JSType.DerivedArray, JSValue.JSType.Array => .Array,
                        JSValue.JSType.DerivedStringObject, JSValue.JSType.String, JSValue.JSType.StringObject => .String,
                        JSValue.JSType.RegExpObject,
                        JSValue.JSType.Symbol,
                        => .String,
                        JSValue.JSType.BooleanObject => .Boolean,
                        JSValue.JSType.JSFunction => .Function,
                        JSValue.JSType.JSWeakMap, JSValue.JSType.JSMap => .Map,
                        JSValue.JSType.JSWeakSet, JSValue.JSType.JSSet => .Set,
                        JSValue.JSType.JSDate => .JSON,
                        JSValue.JSType.JSPromise => .Promise,
                        JSValue.JSType.Object, JSValue.JSType.FinalObject => .Object,

                        JSValue.JSType.Int8Array,
                        JSValue.JSType.Uint8Array,
                        JSValue.JSType.Uint8ClampedArray,
                        JSValue.JSType.Int16Array,
                        JSValue.JSType.Uint16Array,
                        JSValue.JSType.Int32Array,
                        JSValue.JSType.Uint32Array,
                        JSValue.JSType.Float32Array,
                        JSValue.JSType.Float64Array,
                        JSValue.JSType.BigInt64Array,
                        JSValue.JSType.BigUint64Array,
                        => .TypedArray,

                        // None of these should ever exist here
                        // But we're going to check anyway
                        .GetterSetter,
                        .CustomGetterSetter,
                        .APIValueWrapper,
                        .NativeExecutable,
                        .ProgramExecutable,
                        .ModuleProgramExecutable,
                        .EvalExecutable,
                        .FunctionExecutable,
                        .UnlinkedFunctionExecutable,
                        .UnlinkedProgramCodeBlock,
                        .UnlinkedModuleProgramCodeBlock,
                        .UnlinkedEvalCodeBlock,
                        .UnlinkedFunctionCodeBlock,
                        .CodeBlock,
                        .JSImmutableButterfly,
                        .JSSourceCode,
                        .JSScriptFetcher,
                        .JSScriptFetchParameters,
                        .JSCallee,
                        .GlobalLexicalEnvironment,
                        .LexicalEnvironment,
                        .ModuleEnvironment,
                        .StrictEvalActivation,
                        .WithScope,
                        => .NativeCode,
                        else => .JSON,
                    },
                    .cell = js_type,
                };
            }
        };

        const CellType = CAPI.CellType;
        threadlocal var name_buf: [512]u8 = undefined;

        fn writeWithFormatting(
            this: *Formatter,
            comptime Writer: type,
            writer_: Writer,
            comptime Slice: type,
            slice_: Slice,
            globalThis: *JSGlobalObject,
            comptime enable_ansi_colors: bool,
        ) void {
            var writer = WrappedWriter(Writer){ .ctx = writer_ };
            var slice = slice_;
            var i: u32 = 0;
            var len: u32 = @truncate(u32, slice.len);
            while (i < len) : (i += 1) {
                switch (slice[i]) {
                    '%' => {
                        i += 1;
                        if (i >= len)
                            break;

                        const token = switch (slice[i]) {
                            's' => Tag.String,
                            'f' => Tag.Double,
                            'o' => Tag.Undefined,
                            'O' => Tag.Object,
                            'd', 'i' => Tag.Integer,
                            else => continue,
                        };

                        // Flush everything up to the %
                        const end = slice[0 .. i - 1];
                        writer.writeAll(end);
                        slice = slice[@minimum(slice.len, i + 1)..];
                        i = 0;
                        len = @truncate(u32, slice.len);
                        const next_value = this.remaining_values[0];
                        this.remaining_values = this.remaining_values[1..];
                        switch (token) {
                            Tag.String => this.printAs(Tag.String, Writer, writer_, next_value, globalThis, next_value.jsType(), enable_ansi_colors),
                            Tag.Double => this.printAs(Tag.Double, Writer, writer_, next_value, globalThis, next_value.jsType(), enable_ansi_colors),
                            Tag.Object => this.printAs(Tag.Object, Writer, writer_, next_value, globalThis, next_value.jsType(), enable_ansi_colors),
                            Tag.Integer => this.printAs(Tag.Integer, Writer, writer_, next_value, globalThis, next_value.jsType(), enable_ansi_colors),

                            // undefined is overloaded to mean the '%o" field
                            Tag.Undefined => this.format(Tag.get(next_value, globalThis), Writer, writer_, next_value, globalThis, enable_ansi_colors),

                            else => unreachable,
                        }
                        if (this.remaining_values.len == 0) break;
                    },
                    '\\' => {
                        i += 1;
                        if (i >= len)
                            break;
                        if (slice[i] == '%') i += 2;
                    },
                    else => {},
                }
            }

            if (slice.len > 0) writer.writeAll(slice);
        }

        pub fn WrappedWriter(comptime Writer: type) type {
            return struct {
                ctx: Writer,

                pub fn print(self: *@This(), comptime fmt: string, args: anytype) void {
                    self.ctx.print(fmt, args) catch unreachable;
                }

                pub inline fn writeAll(self: *@This(), buf: []const u8) void {
                    self.ctx.writeAll(buf) catch unreachable;
                }
            };
        }

        pub fn printAs(
            this: *Formatter,
            comptime Format: Formatter.Tag,
            comptime Writer: type,
            writer_: Writer,
            value: JSValue,
            globalThis: *JSGlobalObject,
            jsType: JSValue.JSType,
            comptime enable_ansi_colors: bool,
        ) void {
            var writer = WrappedWriter(Writer){ .ctx = writer_ };

            if (comptime Format.canHaveCircularReferences()) {
                if (this.map_node == null) {
                    this.map_node = Visited.Pool.get(default_allocator);
                    this.map_node.?.data.clearRetainingCapacity();
                    this.map = this.map_node.?.data;
                }

                var entry = this.map.getOrPut(@enumToInt(value)) catch unreachable;
                if (entry.found_existing) {
                    writer.writeAll(comptime Output.prettyFmt("<r><cyan>[Circular]<r>", enable_ansi_colors));
                    return;
                }
            }

            switch (comptime Format) {
                .StringPossiblyFormatted => {
                    var str = ZigString.init("");
                    value.toZigString(&str, globalThis);

                    if (!str.is16Bit()) {
                        const slice = str.slice();
                        this.writeWithFormatting(Writer, writer_, @TypeOf(slice), slice, globalThis, enable_ansi_colors);
                    } else {
                        // TODO: UTF16
                        writer.print("{}", .{str});
                    }
                },
                .String => {
                    var str = ZigString.init("");
                    value.toZigString(&str, globalThis);
                    if (jsType == .RegExpObject) {
                        writer.print(comptime Output.prettyFmt("<r><red>", enable_ansi_colors), .{});
                    }

                    writer.print("{}", .{str});

                    if (jsType == .RegExpObject) {
                        writer.print(comptime Output.prettyFmt("<r>", enable_ansi_colors), .{});
                    }
                },
                .Integer => {
                    writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{value.toInt32()});
                },
                .Double => {
                    writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{value.asNumber()});
                },
                .Undefined => {
                    writer.print(comptime Output.prettyFmt("<r><d>undefined<r>", enable_ansi_colors), .{});
                },
                .Null => {
                    writer.print(comptime Output.prettyFmt("<r><yellow>null<r>", enable_ansi_colors), .{});
                },
                .Error => {
                    JS.VirtualMachine.printErrorlikeObject(JS.VirtualMachine.vm, value, null, null, enable_ansi_colors);
                },
                .Class => {
                    var printable = ZigString.init(&name_buf);
                    value.getClassName(globalThis, &printable);
                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("[class]", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("[class <cyan>{}<r>]", enable_ansi_colors), .{printable});
                    }
                },
                .Function => {
                    var printable = ZigString.init(&name_buf);
                    value.getNameProperty(globalThis, &printable);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function<d>:<r> <cyan>{}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Array => {
                    const len = value.getLengthOfArray(globalThis);
                    if (len == 0) {
                        writer.writeAll("[]");
                        return;
                    }

                    writer.writeAll("[ ");
                    var i: u32 = 0;
                    var ref = value.asObjectRef();
                    while (i < len) : (i += 1) {
                        if (i > 0) {
                            writer.writeAll(", ");
                        }

                        const element = JSValue.fromRef(CAPI.JSObjectGetPropertyAtIndex(globalThis.ref(), ref, i, null));
                        const tag = Tag.get(element, globalThis);

                        if (tag.cell.isStringLike()) {
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                            }
                            writer.writeAll("\"");
                        }

                        this.format(tag, Writer, writer_, element, globalThis, enable_ansi_colors);

                        if (tag.cell.isStringLike()) {
                            writer.writeAll("\"");
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r>", true));
                            }
                        }
                    }

                    writer.writeAll(" ]");
                },
                .Private => {
                    if (CAPI.JSObjectGetPrivate(value.asRef())) |private_data_ptr| {
                        const priv_data = JSPrivateDataPtr.from(private_data_ptr);
                        switch (priv_data.tag()) {
                            .BuildError => {
                                const build_error = priv_data.as(JS.BuildError);
                                build_error.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                                return;
                            },
                            .ResolveError => {
                                const resolve_error = priv_data.as(JS.ResolveError);
                                resolve_error.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                                return;
                            },
                            else => {},
                        }
                    }

                    writer.writeAll("[native code]");
                },
                .NativeCode => {
                    writer.writeAll("[native code]");
                },
                .Promise => {
                    writer.writeAll("Promise { " ++ comptime Output.prettyFmt("<r><cyan>", enable_ansi_colors));

                    switch (JSPromise.status(@ptrCast(*JSPromise, value.asObjectRef().?), globalThis.vm())) {
                        JSPromise.Status.Pending => {
                            writer.writeAll("<pending>");
                        },
                        JSPromise.Status.Fulfilled => {
                            writer.writeAll("<resolved>");
                        },
                        JSPromise.Status.Rejected => {
                            writer.writeAll("<rejected>");
                        },
                    }

                    writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors) ++ " }");
                },
                .Boolean => {
                    if (value.toBoolean()) {
                        writer.writeAll(comptime Output.prettyFmt("<r><yellow>true<r>", enable_ansi_colors));
                    } else {
                        writer.writeAll(comptime Output.prettyFmt("<r><yellow>false<r>", enable_ansi_colors));
                    }
                },
                .GlobalObject => {
                    writer.writeAll(comptime Output.prettyFmt("<cyan>[globalThis]<r>", enable_ansi_colors));
                },
                .Map => {},
                .Set => {},
                .JSON => {
                    var str = ZigString.init("");
                    value.jsonStringify(globalThis, 0, &str);
                    if (jsType == JSValue.JSType.JSDate) {
                        // in the code for printing dates, it never exceeds this amount
                        var iso_string_buf: [36]u8 = undefined;
                        var out_buf: []const u8 = std.fmt.bufPrint(&iso_string_buf, "{}", .{str}) catch "";
                        if (out_buf.len > 2) {
                            // trim the quotes
                            out_buf = out_buf[1 .. out_buf.len - 1];
                        }

                        writer.print(comptime Output.prettyFmt("<r><magenta>{s}<r>", enable_ansi_colors), .{out_buf});
                        return;
                    }

                    writer.print("{}", .{str});
                },
                .Object => {
                    var object = value.asObjectRef();
                    var array = CAPI.JSObjectCopyPropertyNames(globalThis.ref(), object);
                    defer CAPI.JSPropertyNameArrayRelease(array);
                    const count_ = CAPI.JSPropertyNameArrayGetCount(array);
                    var i: usize = 0;

                    var name_str = ZigString.init("");
                    value.getPrototype(globalThis).getNameProperty(globalThis, &name_str);

                    if (name_str.len > 0 and !strings.eqlComptime(name_str.slice(), "Object")) {
                        writer.print("{} ", .{name_str});
                    }

                    if (count_ == 0) {
                        writer.writeAll("{ }");
                        return;
                    }

                    writer.writeAll("{ ");

                    while (i < count_) : (i += 1) {
                        var property_name_ref = CAPI.JSPropertyNameArrayGetNameAtIndex(array, i);
                        defer CAPI.JSStringRelease(property_name_ref);
                        var prop = CAPI.JSStringGetCharacters8Ptr(property_name_ref)[0..CAPI.JSStringGetLength(property_name_ref)];

                        var property_value = CAPI.JSObjectGetProperty(globalThis.ref(), object, property_name_ref, null);
                        const tag = Tag.get(JSValue.fromRef(property_value), globalThis);

                        if (tag.cell.isHidden()) continue;

                        writer.print(
                            comptime Output.prettyFmt("{s}<d>:<r> ", enable_ansi_colors),
                            .{prop[0..@minimum(prop.len, 128)]},
                        );

                        if (tag.cell.isStringLike()) {
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                            }
                            writer.writeAll("\"");
                        }

                        this.format(tag, Writer, writer_, JSValue.fromRef(property_value), globalThis, enable_ansi_colors);

                        if (tag.cell.isStringLike()) {
                            writer.writeAll("\"");
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r>", true));
                            }
                        }

                        if (i + 1 < count_) {
                            writer.writeAll(", ");
                        }
                    }

                    writer.writeAll(" }");
                },
                .TypedArray => {
                    const len = value.getLengthOfArray(globalThis);
                    if (len == 0) {
                        writer.writeAll("[]");
                        return;
                    }

                    writer.writeAll("[ ");
                    var i: u32 = 0;
                    var buffer = JSC.Buffer.fromJS(globalThis, value, null).?;
                    const slice = buffer.slice();
                    while (i < len) : (i += 1) {
                        if (i > 0) {
                            writer.writeAll(", ");
                        }

                        writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{slice[i]});
                    }

                    writer.writeAll(" ]");
                },
                else => {},
            }
        }

        pub fn format(this: *Formatter, result: Tag.Result, comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) void {
            if (comptime @hasDecl(@import("root"), "bindgen")) {
                return;
            }

            // This looks incredibly redudant. We make the Formatter.Tag a
            // comptime var so we have to repeat it here. The rationale there is
            // it _should_ limit the stack usage because each version of the
            // function will be relatively small
            return switch (result.tag) {
                .StringPossiblyFormatted => this.printAs(.StringPossiblyFormatted, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .String => this.printAs(.String, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Undefined => this.printAs(.Undefined, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Double => this.printAs(.Double, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Integer => this.printAs(.Integer, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Null => this.printAs(.Null, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Boolean => this.printAs(.Boolean, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Array => this.printAs(.Array, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Object => this.printAs(.Object, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Function => this.printAs(.Function, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Class => this.printAs(.Class, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Error => this.printAs(.Error, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .TypedArray => this.printAs(.TypedArray, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Map => this.printAs(.Map, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Set => this.printAs(.Set, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Symbol => this.printAs(.Symbol, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .BigInt => this.printAs(.BigInt, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .GlobalObject => this.printAs(.GlobalObject, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Private => this.printAs(.Private, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .Promise => this.printAs(.Promise, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .JSON => this.printAs(.JSON, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .NativeCode => this.printAs(.NativeCode, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
                .ArrayBuffer => this.printAs(.ArrayBuffer, Writer, writer, value, globalThis, result.cell, enable_ansi_colors),
            };
        }
    };

    pub fn count(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
    ) callconv(.C) void {}
    pub fn countReset(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
    ) callconv(.C) void {}

    const PendingTimers = std.AutoHashMap(u64, ?std.time.Timer);
    threadlocal var pending_time_logs: PendingTimers = undefined;
    threadlocal var pending_time_logs_loaded = false;

    pub fn time(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        chars: [*]const u8,
        len: usize,
    ) callconv(.C) void {
        const id = std.hash.Wyhash.hash(0, chars[0..len]);
        if (!pending_time_logs_loaded) {
            pending_time_logs = PendingTimers.init(default_allocator);
            pending_time_logs_loaded = true;
        }

        var result = pending_time_logs.getOrPut(id) catch unreachable;

        if (!result.found_existing or (result.found_existing and result.value_ptr.* == null)) {
            result.value_ptr.* = std.time.Timer.start() catch unreachable;
        }
    }
    pub fn timeEnd(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        chars: [*]const u8,
        len: usize,
    ) callconv(.C) void {
        if (!pending_time_logs_loaded) {
            return;
        }

        const id = std.hash.Wyhash.hash(0, chars[0..len]);
        var result = (pending_time_logs.fetchPut(id, null) catch null) orelse return;
        const value: std.time.Timer = result.value orelse return;
        // get the duration in microseconds
        // then display it in milliseconds
        Output.printElapsed(@intToFloat(f64, value.read() / std.time.ns_per_us) / std.time.us_per_ms);
        switch (len) {
            0 => Output.printErrorln("\n", .{}),
            else => Output.printErrorln(" {s}", .{chars[0..len]}),
        }

        Output.flush();
    }

    pub fn timeLog(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {}
    pub fn profile(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
    ) callconv(.C) void {}
    pub fn profileEnd(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
    ) callconv(.C) void {}
    pub fn takeHeapSnapshot(
        // console
        _: ZigConsoleClient.Type,
        // global
        globalThis: *JSGlobalObject,
        // chars
        _: [*]const u8,
        // len
        _: usize,
    ) callconv(.C) void {
        // TODO: this does an extra JSONStringify and we don't need it to!
        var snapshot: [1]JSValue = .{globalThis.generateHeapSnapshot()};
        ZigConsoleClient.messageWithTypeAndLevel(undefined, MessageType.Log, MessageLevel.Debug, globalThis, &snapshot, 1);
    }
    pub fn timeStamp(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {}
    pub fn record(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {}
    pub fn recordEnd(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {}
    pub fn screenshot(
        // console
        _: ZigConsoleClient.Type,
        // global
        _: *JSGlobalObject,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {}

    pub const Export = shim.exportFunctions(.{
        .@"messageWithTypeAndLevel" = messageWithTypeAndLevel,
        .@"count" = count,
        .@"countReset" = countReset,
        .@"time" = time,
        .@"timeLog" = timeLog,
        .@"timeEnd" = timeEnd,
        .@"profile" = profile,
        .@"profileEnd" = profileEnd,
        .@"takeHeapSnapshot" = takeHeapSnapshot,
        .@"timeStamp" = timeStamp,
        .@"record" = record,
        .@"recordEnd" = recordEnd,
        .@"screenshot" = screenshot,
    });

    comptime {
        @export(messageWithTypeAndLevel, .{
            .name = Export[0].symbol_name,
        });
        @export(count, .{
            .name = Export[1].symbol_name,
        });
        @export(countReset, .{
            .name = Export[2].symbol_name,
        });
        @export(time, .{
            .name = Export[3].symbol_name,
        });
        @export(timeLog, .{
            .name = Export[4].symbol_name,
        });
        @export(timeEnd, .{
            .name = Export[5].symbol_name,
        });
        @export(profile, .{
            .name = Export[6].symbol_name,
        });
        @export(profileEnd, .{
            .name = Export[7].symbol_name,
        });
        @export(takeHeapSnapshot, .{
            .name = Export[8].symbol_name,
        });
        @export(timeStamp, .{
            .name = Export[9].symbol_name,
        });
        @export(record, .{
            .name = Export[10].symbol_name,
        });
        @export(recordEnd, .{
            .name = Export[11].symbol_name,
        });
        @export(screenshot, .{
            .name = Export[12].symbol_name,
        });
    }
};

// pub const CommonJSModuleConstructor = struct {
//     pub const shim = Shimmer("Zig", "CommonJSModuleConstructor", @This());
//     pub const name = "Zig::CommonJSModuleConstructor";
//     pub const include = "\"CommonJSModule.h\"";
//     pub const namespace = shim.namespace;

//     pub fn construct(global: *JSGlobalObject, module: *CommonJSModule) callconv(.C) ErrorableJSValue {}
// };

// pub const CommonJSModulePrototype = struct {
//     pub const shim = Shimmer("Zig", "CommonJSModulePrototype", @This());
//     pub const name = "Zig::CommonJSModulePrototype";
//     pub const include = "\"CommonJSModule.h\"";
//     pub const namespace = shim.namespace;

//     bytes: shim.Bytes,
// };

// pub const CommonJSModule = struct {
//     pub const shim = Shimmer("Zig", "CommonJSModule", @This());
//     pub const Type = *anyopaque;
//     pub const name = "Zig::CommonJSModule";
//     pub const include = "\"CommonJSModule.h\"";
//     pub const namespace = shim.namespace;

//     path: Fs.Path,
//     reload_pending: bool = false,

//     exports: JSValue,
//     instance: *CommonJSModulePrototype,
//     loaded: bool = false,

//     pub fn finishLoading(module: *CommonJSModule, global: *JSGlobalObject, exports: JSValue, instance: *CommonJSModulePrototype) callconv(.C) ErrorableJSValue {
//         module.loaded = true;
//         module.instance = instance;
//         module.exports = exports;
//     }

//     pub fn onCallRequire(module: *CommonJSModule, global: *JSGlobalObject, input: []const u8) callconv(.C) ErrorableJSValue {
//         const resolve = ModuleLoader.resolve(global, input, module) catch |err| {
//             return ErrorableJSValue.errFmt(
//                 err,
//                 "ResolveError: {s} while resolving \"{s}\"\nfrom \"{s}\"",
//                 .{
//                     @errorName(err),
//                     input,
//                     module.path.pretty,
//                 },
//             );
//         };

//         const hash = ModuleLoader.hashid(resolve.path_pair.primary.text);
//         var reload_pending = false;
//         if (ModuleLoader.require_cache.get(hash)) |obj| {
//             reload_pending = obj.reload_pending;

//             return ErrorableJSValue.ok(obj.exports);
//         }

//         const result = ModuleLoader.load(global, resolve) catch |err| {
//             return ErrorableJSValue.errFmt(
//                 err,
//                 "LoadError: {s} while loading \"{s}\"",
//                 .{
//                     @errorName(err),
//                     input,
//                     module.path.pretty,
//                 },
//             );
//         };

//         switch (result) {
//             .value => |value| {
//                 return value;
//             },
//             .module => |mod| {
//                 return ErrorableJSValue.ok(mod.exports);
//             },
//             .bundled_module_export => |bundled_module_export| {
//                 return ErrorableJSValue.ok(bundled_module_export);
//             },
//             .path => |path| {
//                 return ErrorableJSValue.ok(ZigString.init(path.text).toJSValue(global));
//             },
//         }
//     }
// };

pub inline fn toGlobalContextRef(ptr: *JSGlobalObject) CAPI.JSGlobalContextRef {
    return @ptrCast(CAPI.JSGlobalContextRef, ptr);
}

comptime {
    @export(ErrorCode.ParserError, .{ .name = "Zig_ErrorCodeParserError" });
    @export(ErrorCode.JSErrorObject, .{ .name = "Zig_ErrorCodeJSErrorObject" });
}

const Bun = @import("../javascript.zig").Bun;
pub const BunTimer = Bun.Timer;

comptime {
    if (!is_bindgen) {
        _ = Process.getTitle;
        _ = Process.setTitle;
        std.testing.refAllDecls(NodeReadableStream);
        std.testing.refAllDecls(Bun.Timer);
        std.testing.refAllDecls(NodeWritableStream);
        std.testing.refAllDecls(NodePath);
        _ = ZigString__free;
        _ = ZigString__free_global;
    }
}
