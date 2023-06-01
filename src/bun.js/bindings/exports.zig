const JSC = @import("root").bun.JSC;
const Fs = @import("../../fs.zig");
const CAPI = JSC.C;
const JS = @import("../javascript.zig");
const JSBase = @import("../base.zig");
const ZigURL = @import("../../url.zig").URL;
const Api = @import("../../api/schema.zig").Api;
const bun = @import("root").bun;
const std = @import("std");
const Shimmer = @import("./shimmer.zig").Shimmer;
const strings = @import("root").bun.strings;
const default_allocator = bun.default_allocator;
const NewGlobalObject = JSC.NewGlobalObject;
const JSGlobalObject = JSC.JSGlobalObject;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const ZigString = JSC.ZigString;
const string = bun.string;
const JSValue = JSC.JSValue;
const Output = bun.Output;
const Environment = bun.Environment;
const ScriptArguments = opaque {};
const JSPromise = JSC.JSPromise;
const JSPromiseRejectionOperation = JSC.JSPromiseRejectionOperation;
const Exception = JSC.Exception;
const JSModuleLoader = JSC.JSModuleLoader;
const Microtask = JSC.Microtask;
const JSPrivateDataPtr = @import("../base.zig").JSPrivateDataPtr;
const Backtrace = @import("../../crash_reporter.zig");
const JSPrinter = bun.js_printer;
const JSLexer = bun.js_lexer;
const typeBaseName = @import("../../meta.zig").typeBaseName;

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
        Backtrace.reloadHandlers() catch unreachable;
        return global;
    }

    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return shim.cppFn("getModuleRegistryMap", .{global});
    }

    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return shim.cppFn("resetModuleRegistryMap", .{ global, map });
    }

    pub fn import(global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) ErrorableZigString {
        JSC.markBinding(@src());

        return @call(.always_inline, Interface.import, .{ global, specifier, source });
    }
    pub fn resolve(res: *ErrorableZigString, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString, query: *ZigString) callconv(.C) void {
        JSC.markBinding(@src());
        @call(.always_inline, Interface.resolve, .{ res, global, specifier, source, query });
    }
    pub fn fetch(ret: *ErrorableResolvedSource, global: *JSGlobalObject, specifier: *ZigString, source: *ZigString) callconv(.C) void {
        JSC.markBinding(@src());
        @call(.always_inline, Interface.fetch, .{ ret, global, specifier, source });
    }

    pub fn promiseRejectionTracker(global: *JSGlobalObject, promise: *JSPromise, rejection: JSPromiseRejectionOperation) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(.always_inline, Interface.promiseRejectionTracker, .{ global, promise, rejection });
    }

    pub fn reportUncaughtException(global: *JSGlobalObject, exception: *Exception) callconv(.C) JSValue {
        JSC.markBinding(@src());
        return @call(.always_inline, Interface.reportUncaughtException, .{ global, exception });
    }

    pub fn onCrash() callconv(.C) void {
        JSC.markBinding(@src());
        return @call(.always_inline, Interface.onCrash, .{});
    }

    pub const Export = shim.exportFunctions(
        .{
            .import = import,
            .resolve = resolve,
            .fetch = fetch,
            // .@"eval" = eval,
            .promiseRejectionTracker = promiseRejectionTracker,
            .reportUncaughtException = reportUncaughtException,
            .onCrash = onCrash,
        },
    );

    pub const Extern = [_][]const u8{ "create", "getModuleRegistryMap", "resetModuleRegistryMap" };

    comptime {
        @export(import, .{ .name = Export[0].symbol_name });
        @export(resolve, .{ .name = Export[1].symbol_name });
        @export(fetch, .{ .name = Export[2].symbol_name });
        @export(promiseRejectionTracker, .{ .name = Export[3].symbol_name });
        @export(reportUncaughtException, .{ .name = Export[4].symbol_name });
        @export(onCrash, .{ .name = Export[5].symbol_name });
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
        .isPrivateData = isPrivateData,
    });

    comptime {
        @export(isPrivateData, .{
            .name = Export[0].symbol_name,
        });
    }
};

pub const NodePath = JSC.Node.Path;

// Web Streams
pub const JSReadableStreamBlob = JSC.WebCore.ByteBlobLoader.Source.JSReadableStreamSource;
pub const JSReadableStreamFile = JSC.WebCore.FileReader.Source.JSReadableStreamSource;
pub const JSReadableStreamBytes = JSC.WebCore.ByteStream.Source.JSReadableStreamSource;

// Sinks
pub const JSArrayBufferSink = JSC.WebCore.ArrayBufferSink.JSSink;
pub const JSHTTPSResponseSink = JSC.WebCore.HTTPSResponseSink.JSSink;
pub const JSHTTPResponseSink = JSC.WebCore.HTTPResponseSink.JSSink;
pub const JSFileSink = JSC.WebCore.FileSink.JSSink;

// WebSocket
pub const WebSocketHTTPClient = @import("../../http/websocket_http_client.zig").WebSocketHTTPClient;
pub const WebSocketHTTPSClient = @import("../../http/websocket_http_client.zig").WebSocketHTTPSClient;
pub const WebSocketClient = @import("../../http/websocket_http_client.zig").WebSocketClient;
pub const WebSocketClientTLS = @import("../../http/websocket_http_client.zig").WebSocketClientTLS;

pub fn Errorable(comptime Type: type) type {
    return extern struct {
        result: Result,
        success: bool,
        pub const name = "Errorable" ++ typeBaseName(@typeName(Type));

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
    commonjs_exports: ?[*]ZigString = null,
    commonjs_exports_len: u32 = 0,

    hash: u32,

    allocator: ?*anyopaque,

    tag: Tag = Tag.javascript,

    pub const Tag = enum(u64) {
        javascript = 0,
        wasm = 1,
        object = 2,
        file = 3,

        @"node:buffer" = 1024,
        @"node:process" = 1025,
        @"bun:events_native" = 1026,
        @"node:string_decoder" = 1027,
        @"node:module" = 1028,
        @"node:tty" = 1029,
        @"node:util/types" = 1030,
    };
};

const Mimalloc = @import("../../allocators/mimalloc.zig");

export fn ZigString__free(raw: [*]const u8, len: usize, allocator_: ?*anyopaque) void {
    var allocator: std.mem.Allocator = @ptrCast(*std.mem.Allocator, @alignCast(@alignOf(*std.mem.Allocator), allocator_ orelse return)).*;
    var ptr = ZigString.init(raw[0..len]).slice().ptr;
    if (comptime Environment.allow_assert) {
        std.debug.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    var str = ptr[0..len];

    allocator.free(str);
}

export fn ZigString__free_global(ptr: [*]const u8, len: usize) void {
    var untagged = @intToPtr(*anyopaque, @ptrToInt(ZigString.init(ptr[0..len]).slice().ptr));
    if (comptime Environment.allow_assert) {
        std.debug.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    // we must untag the string pointer
    Mimalloc.mi_free(untagged);
}

export fn Zig__getAPIGlobals(count: *usize) [*]JSC.C.JSClassRef {
    var globals = JSC.VirtualMachine.getAPIGlobals();
    count.* = globals.len;
    return globals.ptr;
}

export fn Zig__getAPIConstructors(count: *usize, ctx: *JSGlobalObject) [*]const JSValue {
    var globals = JSC.VirtualMachine.getAPIConstructors(ctx);
    count.* = globals.len;
    return globals.ptr;
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

    // StackOverflow & OutOfMemoryError is not an ErrorType in "JavaScriptCore/ErrorType.h" within JSC, so the number here is just totally made up
    OutOfMemoryError = 8,
    BundlerError = 252,
    StackOverflow = 253,
    UserErrorCode = 254,
    _,
};

pub const EventType = enum(u8) {
    Event,
    MessageEvent,
    CloseEvent,
    ErrorEvent,
    OpenEvent,
    unknown = 254,
    _,

    pub const map = bun.ComptimeStringMap(EventType, .{
        .{ EventType.Event.label(), EventType.Event },
        .{ EventType.MessageEvent.label(), EventType.MessageEvent },
        .{ EventType.CloseEvent.label(), EventType.CloseEvent },
        .{ EventType.ErrorEvent.label(), EventType.ErrorEvent },
        .{ EventType.OpenEvent.label(), EventType.OpenEvent },
    });

    pub fn label(this: EventType) string {
        return switch (this) {
            .Event => "event",
            .MessageEvent => "message",
            .CloseEvent => "close",
            .ErrorEvent => "error",
            .OpenEvent => "open",
            else => "event",
        };
    }
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
    pub const exit = JSC.Node.Process.exit;
    pub const getArgv0 = JSC.Node.Process.getArgv0;
    pub const getExecPath = JSC.Node.Process.getExecPath;
    pub const getExecArgv = JSC.Node.Process.getExecArgv;

    pub const Export = shim.exportFunctions(.{
        .getTitle = getTitle,
        .setTitle = setTitle,
        .getArgv = getArgv,
        .getCwd = getCwd,
        .setCwd = setCwd,
        .exit = exit,
        .getArgv0 = getArgv0,
        .getExecPath = getExecPath,
        .getExecArgv = getExecArgv,
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
            @export(exit, .{
                .name = Export[5].symbol_name,
            });
            @export(getArgv0, .{
                .name = Export[6].symbol_name,
            });
            @export(getExecPath, .{
                .name = Export[7].symbol_name,
            });

            @export(getExecArgv, .{
                .name = Export[8].symbol_name,
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

    pub fn toAPI(
        this: *const ZigStackTrace,
        allocator: std.mem.Allocator,
        root_path: string,
        origin: ?*const ZigURL,
    ) !Api.StackTrace {
        var stack_trace: Api.StackTrace = comptime std.mem.zeroes(Api.StackTrace);
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
                    bun.copy(u8, remain_buf, source.text);
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

                for (_frames, 0..) |frame, i| {
                    stack_frames[i] = try frame.toAPI(
                        root_path,
                        origin,
                        allocator,
                    );
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
        for (this.source_lines_numbers[0..this.source_lines_len], 0..) |num, j| {
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

    /// This informs formatters whether to display as a blob URL or not
    remapped: bool = false,

    pub fn toAPI(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, allocator: std.mem.Allocator) !Api.StackFrame {
        var frame: Api.StackFrame = comptime std.mem.zeroes(Api.StackFrame);
        if (this.function_name.len > 0) {
            frame.function_name = try allocator.dupe(u8, this.function_name.slice());
        }

        if (this.source_url.len > 0) {
            frame.file = try std.fmt.allocPrint(allocator, "{any}", .{this.sourceURLFormatter(root_path, origin, true, false)});
        }

        frame.position.source_offset = this.position.source_offset;

        // For remapped code, we add 1 to the line number
        frame.position.line = this.position.line + @as(i32, @boolToInt(this.remapped));

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
        exclude_line_column: bool = false,
        remapped: bool = false,
        root_path: string = "",
        pub fn format(this: SourceURLFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            if (this.enable_color) {
                try writer.writeAll(Output.prettyFmt("<r><cyan>", true));
            }

            var source_slice = this.source_url.slice();

            if (!this.remapped) {
                if (this.origin) |origin| {
                    try writer.writeAll(origin.displayProtocol());
                    try writer.writeAll("://");
                    try writer.writeAll(origin.displayHostname());
                    try writer.writeAll(":");
                    try writer.writeAll(origin.port);
                    try writer.writeAll("/blob:");

                    if (strings.startsWith(source_slice, this.root_path)) {
                        source_slice = source_slice[this.root_path.len..];
                    }
                }
            }

            try writer.writeAll(source_slice);

            if (this.enable_color) {
                if (this.position.line > -1) {
                    try writer.writeAll(comptime Output.prettyFmt("<r>", true));
                } else {
                    try writer.writeAll(comptime Output.prettyFmt("<r>", true));
                }
            }

            if (!this.exclude_line_column) {
                if (this.position.line > -1 and this.position.column_start > -1) {
                    if (this.enable_color) {
                        try std.fmt.format(
                            writer,
                            // :
                            comptime Output.prettyFmt("<d>:<r><yellow>{d}<r><d>:<yellow>{d}<r>", true),
                            .{ this.position.line + 1, this.position.column_start },
                        );
                    } else {
                        try std.fmt.format(writer, ":{d}:{d}", .{ this.position.line + 1, this.position.column_start });
                    }
                } else if (this.position.line > -1) {
                    if (this.enable_color) {
                        try std.fmt.format(
                            writer,
                            comptime Output.prettyFmt("<d>:<r><yellow>{d}<r>", true),
                            .{
                                this.position.line + 1,
                            },
                        );
                    } else {
                        try std.fmt.format(writer, ":{d}", .{
                            this.position.line + 1,
                        });
                    }
                }
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
                    // try writer.writeAll("(esm)");
                },
                .Function => {
                    if (name.len > 0) {
                        if (this.enable_color) {
                            try std.fmt.format(writer, comptime Output.prettyFmt("<r><b><i>{s}<r>", true), .{name});
                        } else {
                            try std.fmt.format(writer, "{s}", .{name});
                        }
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

    pub fn sourceURLFormatter(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, exclude_line_column: bool, comptime enable_color: bool) SourceURLFormatter {
        return SourceURLFormatter{
            .source_url = this.source_url,
            .exclude_line_column = exclude_line_column,
            .origin = origin,
            .root_path = root_path,
            .position = this.position,
            .enable_color = enable_color,
            .remapped = this.remapped,
        };
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

    remapped: bool = false,

    fd: i32 = -1,

    pub const shim = Shimmer("Zig", "Exception", @This());
    pub const name = "ZigException";
    pub const namespace = shim.namespace;

    pub const Holder = extern struct {
        const frame_count = 32;
        pub const source_lines_count = 6;
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

    pub fn addToErrorList(
        this: *ZigException,
        error_list: *std.ArrayList(Api.JsException),
        root_path: string,
        origin: ?*const ZigURL,
    ) !void {
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
            api_exception.stack = try this.stack.toAPI(error_list.allocator, root_path, origin);
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
    const Counter = std.AutoHashMapUnmanaged(u64, u32);

    const BufferedWriter = std.io.BufferedWriter(4096, Output.WriterType);
    error_writer: BufferedWriter,
    writer: BufferedWriter,

    counts: Counter = .{},

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
        if (comptime is_bindgen) {
            return;
        }

        var console = global.bunVM().console;

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

        const Writer = @TypeOf(writer);
        if (len > 0)
            format(
                level,
                global,
                vals,
                len,
                @TypeOf(buffered_writer.unbuffered_writer.context),
                Writer,
                writer,
                .{
                    .enable_colors = enable_colors,
                    .add_newline = true,
                    .flush = true,
                },
            )
        else if (message_type == .Log) {
            _ = console.writer.write("\n") catch 0;
            console.writer.flush() catch {};
        } else if (message_type != .Trace)
            writer.writeAll("undefined\n") catch unreachable;

        if (message_type == .Trace) {
            writeTrace(Writer, writer, global);
            buffered_writer.flush() catch unreachable;
        }
    }

    pub fn writeTrace(comptime Writer: type, writer: Writer, global: *JSGlobalObject) void {
        var holder = ZigException.Holder.init();

        var exception = holder.zigException();
        var err = ZigString.init("trace output").toErrorInstance(global);
        err.toZigException(global, exception);
        JS.VirtualMachine.get().remapZigException(exception, err, null);

        if (Output.enable_ansi_colors_stderr)
            JS.VirtualMachine.printStackTrace(
                Writer,
                writer,
                exception.stack,
                true,
            ) catch unreachable
        else
            JS.VirtualMachine.printStackTrace(
                Writer,
                writer,
                exception.stack,
                false,
            ) catch unreachable;
    }

    pub const FormatOptions = struct {
        enable_colors: bool,
        add_newline: bool,
        flush: bool,
        ordered_properties: bool = false,
        quote_strings: bool = false,
        max_depth: u16 = 8,
    };

    pub fn format(
        level: MessageLevel,
        global: *JSGlobalObject,
        vals: [*]const JSValue,
        len: usize,
        comptime RawWriter: type,
        comptime Writer: type,
        writer: Writer,
        options: FormatOptions,
    ) void {
        var fmt: ZigConsoleClient.Formatter = undefined;
        defer {
            if (fmt.map_node) |node| {
                node.data = fmt.map;
                node.data.clearRetainingCapacity();
                node.release();
            }
        }

        if (len == 1) {
            fmt = ZigConsoleClient.Formatter{
                .remaining_values = &[_]JSValue{},
                .globalThis = global,
                .ordered_properties = options.ordered_properties,
                .quote_strings = options.quote_strings,
                .max_depth = options.max_depth,
            };
            const tag = ZigConsoleClient.Formatter.Tag.get(vals[0], global);

            var unbuffered_writer = if (comptime Writer != RawWriter)
                writer.context.unbuffered_writer.context.writer()
            else
                writer;

            if (tag.tag == .String) {
                if (options.enable_colors) {
                    if (level == .Error) {
                        unbuffered_writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
                    }
                    fmt.format(
                        tag,
                        @TypeOf(unbuffered_writer),
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
                        @TypeOf(unbuffered_writer),
                        unbuffered_writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                if (options.add_newline) _ = unbuffered_writer.write("\n") catch 0;
            } else {
                defer {
                    if (comptime Writer != RawWriter) {
                        if (options.flush) writer.context.flush() catch {};
                    }
                }
                if (options.enable_colors) {
                    fmt.format(
                        tag,
                        Writer,
                        writer,
                        vals[0],
                        global,
                        true,
                    );
                } else {
                    fmt.format(
                        tag,
                        Writer,
                        writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                if (options.add_newline) _ = writer.write("\n") catch 0;
            }

            return;
        }

        defer {
            if (comptime Writer != RawWriter) {
                if (options.flush) writer.context.flush() catch {};
            }
        }

        var this_value: JSValue = vals[0];
        fmt = ZigConsoleClient.Formatter{
            .remaining_values = vals[0..len][1..],
            .globalThis = global,
            .ordered_properties = options.ordered_properties,
            .quote_strings = options.quote_strings,
        };
        var tag: ZigConsoleClient.Formatter.Tag.Result = undefined;

        var any = false;
        if (options.enable_colors) {
            if (level == .Error) {
                writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
            }
            while (true) {
                if (any) {
                    _ = writer.write(" ") catch 0;
                }
                any = true;

                tag = ZigConsoleClient.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                fmt.format(tag, Writer, writer, this_value, global, true);
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
                tag = ZigConsoleClient.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                fmt.format(tag, Writer, writer, this_value, global, false);
                if (fmt.remaining_values.len == 0)
                    break;

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = fmt.remaining_values[1..];
            }
        }

        if (options.add_newline) _ = writer.write("\n") catch 0;
    }

    pub const Formatter = struct {
        remaining_values: []const JSValue = &[_]JSValue{},
        map: Visited.Map = undefined,
        map_node: ?*Visited.Pool.Node = null,
        hide_native: bool = false,
        globalThis: *JSGlobalObject,
        indent: u32 = 0,
        depth: u16 = 0,
        max_depth: u16 = 8,
        quote_strings: bool = false,
        quote_keys: bool = false,
        failed: bool = false,
        estimated_line_length: usize = 0,
        always_newline_scope: bool = false,
        ordered_properties: bool = false,

        pub fn goodTimeForANewLine(this: *@This()) bool {
            if (this.estimated_line_length > 80) {
                this.resetLine();
                return true;
            }
            return false;
        }

        pub fn resetLine(this: *@This()) void {
            this.estimated_line_length = this.indent * 2;
        }

        pub fn addForNewLine(this: *@This(), len: usize) void {
            this.estimated_line_length +|= len;
        }

        pub const ZigFormatter = struct {
            formatter: *ZigConsoleClient.Formatter,
            global: *JSGlobalObject,
            value: JSValue,

            pub const WriteError = error{UhOh};
            pub fn format(self: ZigFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                self.formatter.remaining_values = &[_]JSValue{self.value};
                defer {
                    self.formatter.remaining_values = &[_]JSValue{};
                }
                self.formatter.globalThis = self.global;
                self.formatter.format(
                    Tag.get(self.value, self.global),
                    @TypeOf(writer),
                    writer,
                    self.value,
                    self.formatter.globalThis,
                    false,
                );
            }
        };

        // For detecting circular references
        pub const Visited = struct {
            const ObjectPool = @import("../../pool.zig").ObjectPool;
            pub const Map = std.AutoHashMap(JSValue.Type, void);
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
            toJSON,
            NativeCode,
            ArrayBuffer,

            JSX,
            Event,

            Getter,

            pub fn isPrimitive(this: Tag) bool {
                return switch (this) {
                    .String,
                    .StringPossiblyFormatted,
                    .Undefined,
                    .Double,
                    .Integer,
                    .Null,
                    .Boolean,
                    .Symbol,
                    .BigInt,
                    => true,
                    else => false,
                };
            }

            pub inline fn canHaveCircularReferences(tag: Tag) bool {
                return tag == .Array or tag == .Object or tag == .Map or tag == .Set;
            }

            const Result = struct {
                tag: Tag,
                cell: JSValue.JSType = JSValue.JSType.Cell,
            };

            pub fn get(value: JSValue, globalThis: *JSGlobalObject) Result {
                return getAdvanced(value, globalThis, .{ .hide_global = false });
            }

            pub const Options = struct {
                hide_global: bool = false,
            };

            pub fn getAdvanced(value: JSValue, globalThis: *JSGlobalObject, opts: Options) Result {
                switch (@enumToInt(value)) {
                    0, 0xa => return Result{
                        .tag = .Undefined,
                    },
                    0x2 => return Result{
                        .tag = .Null,
                    },
                    else => {},
                }

                if (value.isInt32()) {
                    return .{
                        .tag = .Integer,
                    };
                } else if (value.isNumber()) {
                    return .{
                        .tag = .Double,
                    };
                } else if (value.isBoolean()) {
                    return .{
                        .tag = .Boolean,
                    };
                }

                if (!value.isCell())
                    return .{
                        .tag = .NativeCode,
                    };

                const js_type = value.jsType();

                if (js_type.isHidden()) return .{
                    .tag = .NativeCode,
                    .cell = js_type,
                };

                // Cell is the "unknown" type
                // if we call JSObjectGetPrivate, it can segfault
                if (js_type == .Cell) {
                    return .{
                        .tag = .NativeCode,
                        .cell = js_type,
                    };
                }

                if (js_type == .DOMWrapper) {
                    return .{
                        .tag = .Private,
                        .cell = js_type,
                    };
                }

                if (CAPI.JSObjectGetPrivate(value.asObjectRef()) != null)
                    return .{
                        .tag = .Private,
                        .cell = js_type,
                    };

                // If we check an Object has a method table and it does not
                // it will crash
                const callable = js_type != .Object and value.isCallable(globalThis.vm());

                if (value.isClass(globalThis) and !callable) {
                    return .{
                        .tag = .Object,
                        .cell = js_type,
                    };
                }

                if (callable and js_type == .JSFunction) {
                    return .{
                        .tag = .Function,
                        .cell = js_type,
                    };
                } else if (callable and js_type == .InternalFunction) {
                    return .{
                        .tag = .Object,
                        .cell = js_type,
                    };
                }

                if (js_type == .GlobalProxy) {
                    if (!opts.hide_global) {
                        return Tag.get(
                            JSC.JSValue.c(JSC.C.JSObjectGetProxyTarget(value.asObjectRef())),
                            globalThis,
                        );
                    }
                    return .{
                        .tag = .GlobalObject,
                        .cell = js_type,
                    };
                }

                // Is this a react element?
                if (js_type.isObject()) {
                    if (value.get(globalThis, "$$typeof")) |typeof_symbol| {
                        var reactElement = ZigString.init("react.element");
                        var react_fragment = ZigString.init("react.fragment");

                        if (JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &reactElement), globalThis) or JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &react_fragment), globalThis)) {
                            return .{ .tag = .JSX, .cell = js_type };
                        }
                    }
                }

                return .{
                    .tag = switch (js_type) {
                        JSValue.JSType.ErrorInstance => .Error,
                        JSValue.JSType.NumberObject => .Double,
                        JSValue.JSType.DerivedArray, JSValue.JSType.Array => .Array,
                        JSValue.JSType.DerivedStringObject, JSValue.JSType.String, JSValue.JSType.StringObject => .String,
                        JSValue.JSType.RegExpObject => .String,
                        JSValue.JSType.Symbol => .Symbol,
                        JSValue.JSType.BooleanObject => .Boolean,
                        JSValue.JSType.JSFunction => .Function,
                        JSValue.JSType.JSWeakMap, JSValue.JSType.JSMap => .Map,
                        JSValue.JSType.JSWeakSet, JSValue.JSType.JSSet => .Set,
                        JSValue.JSType.JSDate => .JSON,
                        JSValue.JSType.JSPromise => .Promise,
                        JSValue.JSType.Object,
                        JSValue.JSType.FinalObject,
                        .ModuleNamespaceObject,
                        => .Object,

                        .GlobalObject => if (!opts.hide_global)
                            .Object
                        else
                            .GlobalObject,

                        .ArrayBuffer,
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
                        .DataView,
                        => .TypedArray,

                        .HeapBigInt => .BigInt,

                        // None of these should ever exist here
                        // But we're going to check anyway
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

                        .Event => .Event,

                        .GetterSetter, .CustomGetterSetter => .Getter,

                        .JSAsJSONType => .toJSON,

                        else => .JSON,
                    },
                    .cell = js_type,
                };
            }
        };

        const CellType = CAPI.CellType;
        threadlocal var name_buf: [512]u8 = undefined;

        fn writeWithFormatting(
            this: *ZigConsoleClient.Formatter,
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
            var any_non_ascii = false;
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
                        if (!any_non_ascii)
                            writer.writeAll(end)
                        else
                            writer.writeAll(end);
                        any_non_ascii = false;
                        slice = slice[@min(slice.len, i + 1)..];
                        i = 0;
                        len = @truncate(u32, slice.len);
                        const next_value = this.remaining_values[0];
                        this.remaining_values = this.remaining_values[1..];
                        switch (token) {
                            Tag.String => this.printAs(Tag.String, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                            Tag.Double => this.printAs(Tag.Double, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                            Tag.Object => this.printAs(Tag.Object, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                            Tag.Integer => this.printAs(Tag.Integer, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),

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
                    128...255 => {
                        any_non_ascii = true;
                    },
                    else => {},
                }
            }

            if (slice.len > 0) writer.writeAll(slice);
        }

        pub fn WrappedWriter(comptime Writer: type) type {
            return struct {
                ctx: Writer,
                failed: bool = false,
                estimated_line_length: *usize = undefined,

                pub fn print(self: *@This(), comptime fmt: string, args: anytype) void {
                    self.ctx.print(fmt, args) catch {
                        self.failed = true;
                    };
                }

                pub fn writeLatin1(self: *@This(), buf: []const u8) void {
                    var remain = buf;
                    while (remain.len > 0) {
                        if (strings.firstNonASCII(remain)) |i| {
                            if (i > 0) {
                                self.ctx.writeAll(remain[0..i]) catch {
                                    self.failed = true;
                                    return;
                                };
                            }
                            self.ctx.writeAll(&strings.latin1ToCodepointBytesAssumeNotASCII(remain[i])) catch {
                                self.failed = true;
                            };
                            remain = remain[i + 1 ..];
                        } else {
                            break;
                        }
                    }

                    self.ctx.writeAll(remain) catch return;
                }

                pub inline fn writeAll(self: *@This(), buf: []const u8) void {
                    self.ctx.writeAll(buf) catch {
                        self.failed = true;
                    };
                }

                pub inline fn writeString(self: *@This(), str: ZigString) void {
                    self.print("{}", .{str});
                }

                pub inline fn write16Bit(self: *@This(), input: []const u16) void {
                    strings.formatUTF16Type([]const u16, input, self.ctx) catch {
                        self.failed = true;
                    };
                }
            };
        }

        pub fn writeIndent(
            this: *ZigConsoleClient.Formatter,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            const indent = @min(this.indent, 32);
            var buf = [_]u8{' '} ** 64;
            var total_remain: usize = indent;
            while (total_remain > 0) {
                const written = @min(32, total_remain);
                try writer.writeAll(buf[0 .. written * 2]);
                total_remain -|= written;
            }
        }

        pub fn printComma(this: *ZigConsoleClient.Formatter, comptime Writer: type, writer: Writer, comptime enable_ansi_colors: bool) !void {
            try writer.writeAll(comptime Output.prettyFmt("<r><d>,<r>", enable_ansi_colors));
            this.estimated_line_length += 1;
        }

        pub fn MapIterator(comptime Writer: type, comptime enable_ansi_colors: bool) type {
            return struct {
                formatter: *ZigConsoleClient.Formatter,
                writer: Writer,
                pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    const key = JSC.JSObject.getIndex(nextValue, globalObject, 0);
                    const value = JSC.JSObject.getIndex(nextValue, globalObject, 1);
                    this.formatter.writeIndent(Writer, this.writer) catch unreachable;
                    const key_tag = Tag.getAdvanced(key, globalObject, .{ .hide_global = true });

                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        key,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                    this.writer.writeAll(": ") catch unreachable;
                    const value_tag = Tag.getAdvanced(value, globalObject, .{ .hide_global = true });
                    this.formatter.format(
                        value_tag,
                        Writer,
                        this.writer,
                        value,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll("\n") catch unreachable;
                }
            };
        }

        pub fn SetIterator(comptime Writer: type, comptime enable_ansi_colors: bool) type {
            return struct {
                formatter: *ZigConsoleClient.Formatter,
                writer: Writer,
                pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                    const key_tag = Tag.getAdvanced(nextValue, globalObject, .{ .hide_global = true });
                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        nextValue,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );

                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll("\n") catch unreachable;
                }
            };
        }

        pub fn PropertyIterator(comptime Writer: type, comptime enable_ansi_colors_: bool) type {
            return struct {
                formatter: *ZigConsoleClient.Formatter,
                writer: Writer,
                i: usize = 0,
                always_newline: bool = false,
                parent: JSValue,
                const enable_ansi_colors = enable_ansi_colors_;
                pub fn handleFirstProperty(this: *@This(), globalThis: *JSC.JSGlobalObject, value: JSValue) void {
                    if (!value.jsType().isFunction() and !value.isClass(globalThis)) {
                        var writer = WrappedWriter(Writer){
                            .ctx = this.writer,
                            .failed = false,
                        };
                        var name_str = ZigString.init("");

                        value.getNameProperty(globalThis, &name_str);
                        if (name_str.len > 0 and !strings.eqlComptime(name_str.slice(), "Object")) {
                            writer.print("{} ", .{name_str});
                        } else {
                            value.getPrototype(globalThis).getNameProperty(globalThis, &name_str);
                            if (name_str.len > 0 and !strings.eqlComptime(name_str.slice(), "Object")) {
                                writer.print("{} ", .{name_str});
                            }
                        }
                    }

                    this.always_newline = true;
                    this.formatter.estimated_line_length = this.formatter.indent * 2 + 1;
                    this.writer.writeAll("{\n") catch {};
                    this.formatter.indent += 1;
                    this.formatter.depth += 1;
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                }

                pub fn forEach(
                    globalThis: *JSGlobalObject,
                    ctx_ptr: ?*anyopaque,
                    key_: [*c]ZigString,
                    value: JSValue,
                    is_symbol: bool,
                ) callconv(.C) void {
                    const key = key_.?[0];
                    if (key.eqlComptime("constructor")) return;
                    if (key.eqlComptime("call")) return;

                    var ctx: *@This() = bun.cast(*@This(), ctx_ptr orelse return);
                    var this = ctx.formatter;
                    var writer_ = ctx.writer;
                    var writer = WrappedWriter(Writer){
                        .ctx = writer_,
                        .failed = false,
                    };

                    const tag = Tag.getAdvanced(value, globalThis, .{ .hide_global = true });

                    if (tag.cell.isHidden()) return;
                    if (ctx.i == 0) {
                        handleFirstProperty(ctx, globalThis, ctx.parent);
                    } else {
                        this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                    }

                    defer ctx.i += 1;
                    if (ctx.i > 0) {
                        if (ctx.always_newline or this.always_newline_scope or this.goodTimeForANewLine()) {
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch {};
                            this.resetLine();
                        } else {
                            this.estimated_line_length += 1;
                            writer.writeAll(" ");
                        }
                    }

                    if (!is_symbol) {

                        // TODO: make this one pass?
                        if (!key.is16Bit() and (!this.quote_keys and JSLexer.isLatin1Identifier(@TypeOf(key.slice()), key.slice()))) {
                            this.addForNewLine(key.len + 1);

                            writer.print(
                                comptime Output.prettyFmt("<r>{}<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit() and (!this.quote_keys and JSLexer.isLatin1Identifier(@TypeOf(key.utf16SliceAligned()), key.utf16SliceAligned()))) {
                            this.addForNewLine(key.len + 1);

                            writer.print(
                                comptime Output.prettyFmt("<r>{}<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit()) {
                            var utf16Slice = key.utf16SliceAligned();

                            this.addForNewLine(utf16Slice.len + 2);

                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                            }

                            writer.writeAll("\"");

                            while (strings.indexOfAny16(utf16Slice, "\"")) |j| {
                                writer.write16Bit(utf16Slice[0..j]);
                                writer.writeAll("\"");
                                utf16Slice = utf16Slice[j + 1 ..];
                            }

                            writer.write16Bit(utf16Slice);

                            writer.print(
                                comptime Output.prettyFmt("\"<r><d>:<r> ", enable_ansi_colors),
                                .{},
                            );
                        } else {
                            this.addForNewLine(key.len + 2);

                            writer.print(
                                comptime Output.prettyFmt("<r><green>{s}<r><d>:<r> ", enable_ansi_colors),
                                .{JSPrinter.formatJSONString(key.slice())},
                            );
                        }
                    } else {
                        this.addForNewLine(1 + "[Symbol()]:".len + key.len);
                        writer.print(
                            comptime Output.prettyFmt("<r><d>[<r><blue>Symbol({any})<r><d>]:<r> ", enable_ansi_colors),
                            .{
                                key,
                            },
                        );
                    }

                    if (tag.cell.isStringLike()) {
                        if (comptime enable_ansi_colors) {
                            writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                        }
                    }

                    this.format(tag, Writer, ctx.writer, value, globalThis, enable_ansi_colors);

                    if (tag.cell.isStringLike()) {
                        if (comptime enable_ansi_colors) {
                            writer.writeAll(comptime Output.prettyFmt("<r>", true));
                        }
                    }
                }
            };
        }

        pub fn printAs(
            this: *ZigConsoleClient.Formatter,
            comptime Format: ZigConsoleClient.Formatter.Tag,
            comptime Writer: type,
            writer_: Writer,
            value: JSValue,
            jsType: JSValue.JSType,
            comptime enable_ansi_colors: bool,
        ) void {
            if (this.failed)
                return;
            var writer = WrappedWriter(Writer){ .ctx = writer_, .estimated_line_length = &this.estimated_line_length };
            defer {
                if (writer.failed) {
                    this.failed = true;
                }
            }
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

            defer {
                if (comptime Format.canHaveCircularReferences()) {
                    _ = this.map.remove(@enumToInt(value));
                }
            }

            switch (comptime Format) {
                .StringPossiblyFormatted => {
                    var str = value.toSlice(this.globalThis, bun.default_allocator);
                    defer str.deinit();
                    this.addForNewLine(str.len);
                    const slice = str.slice();
                    this.writeWithFormatting(Writer, writer_, @TypeOf(slice), slice, this.globalThis, enable_ansi_colors);
                },
                .String => {
                    var str = ZigString.init("");
                    value.toZigString(&str, this.globalThis);
                    this.addForNewLine(str.len);

                    if (this.quote_strings and jsType != .RegExpObject) {
                        if (str.len == 0) {
                            writer.writeAll("\"\"");
                            return;
                        }

                        if (comptime enable_ansi_colors) {
                            writer.writeAll(Output.prettyFmt("<r><green>", true));
                        }

                        defer if (comptime enable_ansi_colors)
                            writer.writeAll(Output.prettyFmt("<r>", true));

                        if (str.is16Bit()) {
                            this.printAs(.JSON, Writer, writer_, value, .StringObject, enable_ansi_colors);
                            return;
                        }

                        JSPrinter.writeJSONString(str.slice(), Writer, writer_, .latin1) catch unreachable;

                        return;
                    }

                    if (jsType == .RegExpObject and enable_ansi_colors) {
                        writer.print(comptime Output.prettyFmt("<r><red>", enable_ansi_colors), .{});
                    }

                    if (str.is16Bit()) {
                        // streaming print
                        writer.print("{}", .{str});
                    } else if (strings.isAllASCII(str.slice())) {
                        // fast path
                        writer.writeAll(str.slice());
                    } else if (str.len > 0) {
                        // slow path
                        var buf = strings.allocateLatin1IntoUTF8(bun.default_allocator, []const u8, str.slice()) catch &[_]u8{};
                        if (buf.len > 0) {
                            defer bun.default_allocator.free(buf);
                            writer.writeAll(buf);
                        }
                    }

                    if (jsType == .RegExpObject and enable_ansi_colors) {
                        writer.print(comptime Output.prettyFmt("<r>", enable_ansi_colors), .{});
                    }
                },
                .Integer => {
                    const int = value.toInt64();
                    if (int < std.math.maxInt(u32)) {
                        var i = int;
                        const is_negative = i < 0;
                        if (is_negative) {
                            i = -i;
                        }
                        const digits = if (i != 0)
                            bun.fmt.fastDigitCount(@intCast(usize, i)) + @as(usize, @boolToInt(is_negative))
                        else
                            1;
                        this.addForNewLine(digits);
                    } else {
                        this.addForNewLine(bun.fmt.count("{d}", .{int}));
                    }
                    writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{int});
                },
                .BigInt => {
                    var out_str = value.getZigString(this.globalThis).slice();
                    this.addForNewLine(out_str.len);

                    writer.print(comptime Output.prettyFmt("<r><yellow>{s}n<r>", enable_ansi_colors), .{out_str});
                },
                .Double => {
                    if (value.isCell()) {
                        var number_name = ZigString.Empty;
                        value.getClassName(this.globalThis, &number_name);

                        var number_value = ZigString.Empty;
                        value.toZigString(&number_value, this.globalThis);

                        if (!strings.eqlComptime(number_name.slice(), "Number")) {
                            this.addForNewLine(number_name.len + number_value.len + "[Number ():]".len);
                            writer.print(comptime Output.prettyFmt("<r><yellow>[Number ({s}): {s}]<r>", enable_ansi_colors), .{
                                number_name,
                                number_value,
                            });
                            return;
                        }

                        this.addForNewLine(number_name.len + number_value.len + 4);
                        writer.print(comptime Output.prettyFmt("<r><yellow>[{s}: {s}]<r>", enable_ansi_colors), .{
                            number_name,
                            number_value,
                        });
                        return;
                    }

                    const num = value.asNumber();

                    if (std.math.isPositiveInf(num)) {
                        this.addForNewLine("Infinity".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>Infinity<r>", enable_ansi_colors), .{});
                    } else if (std.math.isNegativeInf(num)) {
                        this.addForNewLine("-Infinity".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>-Infinity<r>", enable_ansi_colors), .{});
                    } else if (std.math.isNan(num)) {
                        this.addForNewLine("NaN".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>NaN<r>", enable_ansi_colors), .{});
                    } else {
                        this.addForNewLine(std.fmt.count("{d}", .{num}));
                        writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{num});
                    }
                },
                .Undefined => {
                    this.addForNewLine(9);
                    writer.print(comptime Output.prettyFmt("<r><d>undefined<r>", enable_ansi_colors), .{});
                },
                .Null => {
                    this.addForNewLine(4);
                    writer.print(comptime Output.prettyFmt("<r><yellow>null<r>", enable_ansi_colors), .{});
                },
                .Symbol => {
                    const description = value.getDescription(this.globalThis);
                    this.addForNewLine("Symbol".len);

                    if (description.len > 0) {
                        this.addForNewLine(description.len + "()".len);
                        writer.print(comptime Output.prettyFmt("<r><blue>Symbol({any})<r>", enable_ansi_colors), .{description});
                    } else {
                        writer.print(comptime Output.prettyFmt("<r><blue>Symbol<r>", enable_ansi_colors), .{});
                    }
                },
                .Error => {
                    JS.VirtualMachine.get().printErrorlikeObject(
                        value,
                        null,
                        null,
                        Writer,
                        writer_,
                        enable_ansi_colors,
                    );
                },
                .Class => {
                    var printable = ZigString.init(&name_buf);
                    value.getClassName(this.globalThis, &printable);
                    this.addForNewLine(printable.len);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("[class]", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("[class <cyan>{}<r>]", enable_ansi_colors), .{printable});
                    }
                },
                .Function => {
                    var printable = ZigString.init(&name_buf);
                    value.getNameProperty(this.globalThis, &printable);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function<d>:<r> <cyan>{}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Getter => {
                    writer.print(comptime Output.prettyFmt("<cyan>[Getter]<r>", enable_ansi_colors), .{});
                },
                .Array => {
                    const len = @truncate(u32, value.getLength(this.globalThis));
                    if (len == 0) {
                        writer.writeAll("[]");
                        this.addForNewLine(2);
                        return;
                    }

                    var was_good_time = this.always_newline_scope;
                    {
                        this.indent += 1;
                        this.depth += 1;
                        defer this.depth -|= 1;
                        defer this.indent -|= 1;

                        this.addForNewLine(2);

                        var ref = value.asObjectRef();

                        var prev_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = prev_quote_strings;

                        {
                            const element = JSValue.fromRef(CAPI.JSObjectGetPropertyAtIndex(this.globalThis, ref, 0, null));
                            const tag = Tag.getAdvanced(element, this.globalThis, .{ .hide_global = true });

                            was_good_time = was_good_time or !tag.tag.isPrimitive() or this.goodTimeForANewLine();

                            if (this.ordered_properties or was_good_time) {
                                this.resetLine();
                                writer.writeAll("[");
                                writer.writeAll("\n");
                                this.writeIndent(Writer, writer_) catch unreachable;
                                this.addForNewLine(1);
                            } else {
                                writer.writeAll("[ ");
                            }

                            this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                            if (tag.cell.isStringLike()) {
                                if (comptime enable_ansi_colors) {
                                    writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                }
                            }
                        }

                        var i: u32 = 1;
                        while (i < len) : (i += 1) {
                            this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                            if (this.ordered_properties or this.goodTimeForANewLine()) {
                                writer.writeAll("\n");
                                this.writeIndent(Writer, writer_) catch unreachable;
                            } else {
                                writer.writeAll(" ");
                            }

                            const element = JSValue.fromRef(CAPI.JSObjectGetPropertyAtIndex(this.globalThis, ref, i, null));
                            const tag = Tag.getAdvanced(element, this.globalThis, .{ .hide_global = true });

                            this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                            if (tag.cell.isStringLike()) {
                                if (comptime enable_ansi_colors) {
                                    writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                }
                            }
                        }
                    }

                    if (this.ordered_properties or was_good_time or this.goodTimeForANewLine()) {
                        this.resetLine();
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                        writer.writeAll("]");
                        this.resetLine();
                        this.addForNewLine(1);
                    } else {
                        writer.writeAll(" ]");
                        this.addForNewLine(2);
                    }
                },
                .Private => {
                    if (value.as(JSC.WebCore.Response)) |response| {
                        response.writeFormat(ZigConsoleClient.Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.WebCore.Request)) |request| {
                        request.writeFormat(ZigConsoleClient.Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.API.BuildArtifact)) |build| {
                        build.writeFormat(ZigConsoleClient.Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.WebCore.Blob)) |blob| {
                        blob.writeFormat(ZigConsoleClient.Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.FetchHeaders) != null) {
                        if (value.get(this.globalThis, "toJSON")) |toJSONFunction| {
                            this.addForNewLine("Headers ".len);
                            writer.writeAll(comptime Output.prettyFmt("<r>Headers ", enable_ansi_colors));
                            const prev_quote_keys = this.quote_keys;
                            this.quote_keys = true;
                            defer this.quote_keys = prev_quote_keys;

                            return this.printAs(
                                .Object,
                                Writer,
                                writer_,
                                toJSONFunction.callWithThis(this.globalThis, value, &.{}),
                                .Object,
                                enable_ansi_colors,
                            );
                        }
                    } else if (value.as(JSC.DOMFormData) != null) {
                        if (value.get(this.globalThis, "toJSON")) |toJSONFunction| {
                            const prev_quote_keys = this.quote_keys;
                            this.quote_keys = true;
                            defer this.quote_keys = prev_quote_keys;

                            return this.printAs(
                                .Object,
                                Writer,
                                writer_,
                                toJSONFunction.callWithThis(this.globalThis, value, &.{}),
                                .Object,
                                enable_ansi_colors,
                            );
                        }

                        // this case should never happen
                        return this.printAs(.Undefined, Writer, writer_, .undefined, .Cell, enable_ansi_colors);
                    } else if (value.as(JSC.API.Bun.Timer.TimerObject)) |timer| {
                        this.addForNewLine("Timeout(# ) ".len + bun.fmt.fastDigitCount(@intCast(u64, @max(timer.id, 0))));
                        if (timer.kind == .setInterval) {
                            this.addForNewLine("repeats ".len + bun.fmt.fastDigitCount(@intCast(u64, @max(timer.id, 0))));
                            writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>, repeats)<r>", enable_ansi_colors), .{
                                timer.id,
                            });
                        } else {
                            writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>)<r>", enable_ansi_colors), .{
                                timer.id,
                            });
                        }

                        return;
                    } else if (value.as(JSC.BuildMessage)) |build_log| {
                        build_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.ResolveMessage)) |resolve_log| {
                        resolve_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (jsType != .DOMWrapper) {
                        if (value.isCallable(this.globalThis.vm())) {
                            return this.printAs(.Function, Writer, writer_, value, jsType, enable_ansi_colors);
                        }

                        return this.printAs(.Object, Writer, writer_, value, jsType, enable_ansi_colors);
                    }
                    return this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
                },
                .NativeCode => {
                    this.addForNewLine("[native code]".len);
                    writer.writeAll("[native code]");
                },
                .Promise => {
                    if (this.goodTimeForANewLine()) {
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                    }

                    writer.writeAll("Promise { " ++ comptime Output.prettyFmt("<r><cyan>", enable_ansi_colors));

                    switch (JSPromise.status(@ptrCast(*JSPromise, value.asObjectRef().?), this.globalThis.vm())) {
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
                    if (value.isCell()) {
                        var bool_name = ZigString.Empty;
                        value.getClassName(this.globalThis, &bool_name);
                        var bool_value = ZigString.Empty;
                        value.toZigString(&bool_value, this.globalThis);

                        if (!strings.eqlComptime(bool_name.slice(), "Boolean")) {
                            this.addForNewLine(bool_value.len + bool_name.len + "[Boolean (): ]".len);
                            writer.print(comptime Output.prettyFmt("<r><yellow>[Boolean ({s}): {s}]<r>", enable_ansi_colors), .{
                                bool_name,
                                bool_value,
                            });
                            return;
                        }
                        this.addForNewLine(bool_value.len + "[Boolean: ]".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>[Boolean: {s}]<r>", enable_ansi_colors), .{bool_value});
                        return;
                    }
                    if (value.toBoolean()) {
                        this.addForNewLine(4);
                        writer.writeAll(comptime Output.prettyFmt("<r><yellow>true<r>", enable_ansi_colors));
                    } else {
                        this.addForNewLine(5);
                        writer.writeAll(comptime Output.prettyFmt("<r><yellow>false<r>", enable_ansi_colors));
                    }
                },
                .GlobalObject => {
                    const fmt = "[Global Object]";
                    this.addForNewLine(fmt.len);
                    writer.writeAll(comptime Output.prettyFmt("<cyan>" ++ fmt ++ "<r>", enable_ansi_colors));
                },
                .Map => {
                    const length_value = value.get(this.globalThis, "size") orelse JSC.JSValue.jsNumberFromInt32(0);
                    const length = length_value.toInt32();

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    const map_name = if (value.jsType() == .JSWeakMap) "WeakMap" else "Map";

                    if (length == 0) {
                        return writer.print("{s} {{}}", .{map_name});
                    }

                    writer.print("{s}({d}) {{\n", .{ map_name, length });
                    {
                        this.indent += 1;
                        this.depth +|= 1;
                        defer this.indent -|= 1;
                        defer this.depth -|= 1;
                        var iter = MapIterator(Writer, enable_ansi_colors){
                            .formatter = this,
                            .writer = writer_,
                        };
                        value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                },
                .Set => {
                    const length_value = value.get(this.globalThis, "size") orelse JSC.JSValue.jsNumberFromInt32(0);
                    const length = length_value.toInt32();

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    this.writeIndent(Writer, writer_) catch {};

                    const set_name = if (value.jsType() == .JSWeakSet) "WeakSet" else "Set";

                    if (length == 0) {
                        return writer.print("{s} {{}}", .{set_name});
                    }

                    writer.print("{s}({d}) {{\n", .{ set_name, length });
                    {
                        this.indent += 1;
                        this.depth +|= 1;
                        defer this.indent -|= 1;
                        defer this.depth -|= 1;
                        var iter = SetIterator(Writer, enable_ansi_colors){
                            .formatter = this,
                            .writer = writer_,
                        };
                        value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                },
                .toJSON => {
                    if (value.get(this.globalThis, "toJSON")) |func| {
                        const result = func.callWithThis(this.globalThis, value, &.{});
                        if (result.toError() == null) {
                            const prev_quote_keys = this.quote_keys;
                            this.quote_keys = true;
                            defer this.quote_keys = prev_quote_keys;
                            this.printAs(.Object, Writer, writer_, result, value.jsType(), enable_ansi_colors);
                            return;
                        }
                    }

                    writer.writeAll("{}");
                },
                .JSON => {
                    var str = ZigString.init("");
                    value.jsonStringify(this.globalThis, this.indent, &str);
                    this.addForNewLine(str.len);
                    if (jsType == JSValue.JSType.JSDate) {
                        // in the code for printing dates, it never exceeds this amount
                        var iso_string_buf: [36]u8 = undefined;
                        var out_buf: []const u8 = std.fmt.bufPrint(&iso_string_buf, "{}", .{str}) catch "";

                        if (strings.eql(out_buf, "null")) {
                            out_buf = "Invalid Date";
                        } else if (out_buf.len > 2) {
                            // trim the quotes
                            out_buf = out_buf[1 .. out_buf.len - 1];
                        }

                        writer.print(comptime Output.prettyFmt("<r><magenta>{s}<r>", enable_ansi_colors), .{out_buf});
                        return;
                    }

                    writer.print("{}", .{str});
                },
                .Event => {
                    const event_type = EventType.map.getWithEql(value.get(this.globalThis, "type").?.getZigString(this.globalThis), ZigString.eqlComptime) orelse EventType.unknown;
                    if (event_type != .MessageEvent and event_type != .ErrorEvent) {
                        return this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
                    }

                    writer.print(
                        comptime Output.prettyFmt("<r><cyan>{s}<r> {{\n", enable_ansi_colors),
                        .{
                            @tagName(event_type),
                        },
                    );
                    {
                        this.indent += 1;
                        this.depth +|= 1;
                        defer this.indent -|= 1;
                        defer this.depth -|= 1;
                        const old_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = old_quote_strings;
                        this.writeIndent(Writer, writer_) catch unreachable;

                        writer.print(
                            comptime Output.prettyFmt("<r>type: <green>\"{s}\"<r><d>,<r>\n", enable_ansi_colors),
                            .{
                                event_type.label(),
                            },
                        );
                        this.writeIndent(Writer, writer_) catch unreachable;

                        switch (event_type) {
                            .MessageEvent => {
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>data<d>:<r> ", enable_ansi_colors),
                                    .{},
                                );
                                const data = value.get(this.globalThis, "data").?;
                                const tag = Tag.getAdvanced(data, this.globalThis, .{ .hide_global = true });
                                if (tag.cell.isStringLike()) {
                                    this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                } else {
                                    this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                }
                            },
                            .ErrorEvent => {
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>error<d>:<r>\n", enable_ansi_colors),
                                    .{},
                                );

                                const data = value.get(this.globalThis, "error").?;
                                const tag = Tag.getAdvanced(data, this.globalThis, .{ .hide_global = true });
                                this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                            },
                            else => unreachable,
                        }
                        writer.writeAll("\n");
                    }

                    this.writeIndent(Writer, writer_) catch unreachable;
                    writer.writeAll("}");
                },
                .JSX => {
                    writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));

                    writer.writeAll("<");

                    var needs_space = false;
                    var tag_name_str = ZigString.init("");

                    var tag_name_slice: ZigString.Slice = ZigString.Slice.empty;
                    var is_tag_kind_primitive = false;

                    defer if (tag_name_slice.isAllocated()) tag_name_slice.deinit();

                    if (value.get(this.globalThis, "type")) |type_value| {
                        const _tag = Tag.getAdvanced(type_value, this.globalThis, .{ .hide_global = true });

                        if (_tag.cell == .Symbol) {} else if (_tag.cell.isStringLike()) {
                            type_value.toZigString(&tag_name_str, this.globalThis);
                            is_tag_kind_primitive = true;
                        } else if (_tag.cell.isObject() or type_value.isCallable(this.globalThis.vm())) {
                            type_value.getNameProperty(this.globalThis, &tag_name_str);
                            if (tag_name_str.len == 0) {
                                tag_name_str = ZigString.init("NoName");
                            }
                        } else {
                            type_value.toZigString(&tag_name_str, this.globalThis);
                        }

                        tag_name_slice = tag_name_str.toSlice(default_allocator);
                        needs_space = true;
                    } else {
                        tag_name_slice = ZigString.init("unknown").toSlice(default_allocator);

                        needs_space = true;
                    }

                    if (!is_tag_kind_primitive)
                        writer.writeAll(comptime Output.prettyFmt("<cyan>", enable_ansi_colors))
                    else
                        writer.writeAll(comptime Output.prettyFmt("<green>", enable_ansi_colors));
                    writer.writeAll(tag_name_slice.slice());
                    if (enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));

                    if (value.get(this.globalThis, "key")) |key_value| {
                        if (!key_value.isUndefinedOrNull()) {
                            if (needs_space)
                                writer.writeAll(" key=")
                            else
                                writer.writeAll("key=");

                            const old_quote_strings = this.quote_strings;
                            this.quote_strings = true;
                            defer this.quote_strings = old_quote_strings;

                            this.format(Tag.getAdvanced(key_value, this.globalThis, .{ .hide_global = true }), Writer, writer_, key_value, this.globalThis, enable_ansi_colors);

                            needs_space = true;
                        }
                    }

                    if (value.get(this.globalThis, "props")) |props| {
                        const prev_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = prev_quote_strings;

                        var props_iter = JSC.JSPropertyIterator(.{
                            .skip_empty_name = true,

                            .include_value = true,
                        }).init(this.globalThis, props.asObjectRef());
                        defer props_iter.deinit();

                        var children_prop = props.get(this.globalThis, "children");
                        if (props_iter.len > 0) {
                            {
                                this.indent += 1;
                                defer this.indent -|= 1;
                                const count_without_children = props_iter.len - @as(usize, @boolToInt(children_prop != null));

                                while (props_iter.next()) |prop| {
                                    if (prop.eqlComptime("children"))
                                        continue;

                                    var property_value = props_iter.value;
                                    const tag = Tag.getAdvanced(property_value, this.globalThis, .{ .hide_global = true });

                                    if (tag.cell.isHidden()) continue;

                                    if (needs_space) writer.writeAll(" ");
                                    needs_space = false;

                                    writer.print(
                                        comptime Output.prettyFmt("<r><blue>{s}<d>=<r>", enable_ansi_colors),
                                        .{prop.trunc(128)},
                                    );

                                    if (tag.cell.isStringLike()) {
                                        if (comptime enable_ansi_colors) {
                                            writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                                        }
                                    }

                                    this.format(tag, Writer, writer_, property_value, this.globalThis, enable_ansi_colors);

                                    if (tag.cell.isStringLike()) {
                                        if (comptime enable_ansi_colors) {
                                            writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                        }
                                    }

                                    if (
                                    // count_without_children is necessary to prevent printing an extra newline
                                    // if there are children and one prop and the child prop is the last prop
                                    props_iter.i + 1 < count_without_children and
                                        // 3 is arbitrary but basically
                                        //  <input type="text" value="foo" />
                                        //  ^ should be one line
                                        // <input type="text" value="foo" bar="true" baz={false} />
                                        //  ^ should be multiple lines
                                        props_iter.i > 3)
                                    {
                                        writer.writeAll("\n");
                                        this.writeIndent(Writer, writer_) catch unreachable;
                                    } else if (props_iter.i + 1 < count_without_children) {
                                        writer.writeAll(" ");
                                    }
                                }
                            }

                            if (children_prop) |children| {
                                const tag = Tag.get(children, this.globalThis);

                                const print_children = switch (tag.tag) {
                                    .String, .JSX, .Array => true,
                                    else => false,
                                };

                                if (print_children) {
                                    print_children: {
                                        switch (tag.tag) {
                                            .String => {
                                                var children_string = children.getZigString(this.globalThis);
                                                if (children_string.len == 0) break :print_children;
                                                if (comptime enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", true));

                                                writer.writeAll(">");
                                                if (children_string.len < 128) {
                                                    writer.writeString(children_string);
                                                } else {
                                                    this.indent += 1;
                                                    writer.writeAll("\n");
                                                    this.writeIndent(Writer, writer_) catch unreachable;
                                                    this.indent -|= 1;
                                                    writer.writeString(children_string);
                                                    writer.writeAll("\n");
                                                    this.writeIndent(Writer, writer_) catch unreachable;
                                                }
                                            },
                                            .JSX => {
                                                writer.writeAll(">\n");

                                                {
                                                    this.indent += 1;
                                                    this.writeIndent(Writer, writer_) catch unreachable;
                                                    defer this.indent -|= 1;
                                                    this.format(Tag.get(children, this.globalThis), Writer, writer_, children, this.globalThis, enable_ansi_colors);
                                                }

                                                writer.writeAll("\n");
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                            },
                                            .Array => {
                                                const length = children.getLength(this.globalThis);
                                                if (length == 0) break :print_children;
                                                writer.writeAll(">\n");

                                                {
                                                    this.indent += 1;
                                                    this.writeIndent(Writer, writer_) catch unreachable;
                                                    const _prev_quote_strings = this.quote_strings;
                                                    this.quote_strings = false;
                                                    defer this.quote_strings = _prev_quote_strings;

                                                    defer this.indent -|= 1;

                                                    var j: usize = 0;
                                                    while (j < length) : (j += 1) {
                                                        const child = JSC.JSObject.getIndex(children, this.globalThis, @intCast(u32, j));
                                                        this.format(Tag.getAdvanced(child, this.globalThis, .{ .hide_global = true }), Writer, writer_, child, this.globalThis, enable_ansi_colors);
                                                        if (j + 1 < length) {
                                                            writer.writeAll("\n");
                                                            this.writeIndent(Writer, writer_) catch unreachable;
                                                        }
                                                    }
                                                }

                                                writer.writeAll("\n");
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                            },
                                            else => unreachable,
                                        }

                                        writer.writeAll("</");
                                        if (!is_tag_kind_primitive)
                                            writer.writeAll(comptime Output.prettyFmt("<r><cyan>", enable_ansi_colors))
                                        else
                                            writer.writeAll(comptime Output.prettyFmt("<r><green>", enable_ansi_colors));
                                        writer.writeAll(tag_name_slice.slice());
                                        if (enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));
                                        writer.writeAll(">");
                                    }

                                    return;
                                }
                            }
                        }
                    }

                    writer.writeAll(" />");
                },
                .Object => {
                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    const Iterator = PropertyIterator(Writer, enable_ansi_colors);

                    // We want to figure out if we should print this object
                    // on one line or multiple lines
                    //
                    // The 100% correct way would be to print everything to
                    // a temporary buffer and then check how long each line was
                    //
                    // But it's important that console.log() is fast. So we
                    // do a small compromise to avoid multiple passes over input
                    //
                    // We say:
                    //
                    //   If the object has at least 2 properties and ANY of the following conditions are met:
                    //      - total length of all the property names is more than
                    //        14 characters
                    //     - the parent object is printing each property on a new line
                    //     - The first property is a DOM object, ESM namespace, Map, Set, or Blob
                    //
                    //   Then, we print it each property on a new line, recursively.
                    //
                    const prev_always_newline_scope = this.always_newline_scope;
                    defer this.always_newline_scope = prev_always_newline_scope;
                    var iter = Iterator{
                        .formatter = this,
                        .writer = writer_,
                        .always_newline = this.always_newline_scope or this.goodTimeForANewLine(),
                        .parent = value,
                    };

                    if (this.depth > this.max_depth) {
                        if (this.always_newline_scope or this.goodTimeForANewLine()) {
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch {};
                            this.resetLine();
                        }

                        var display_name = value.getName(this.globalThis);
                        if (display_name.len == 0) {
                            display_name = ZigString.init("Object");
                        }
                        writer.print(comptime Output.prettyFmt("<r><cyan>[{} ...]<r>", enable_ansi_colors), .{
                            display_name,
                        });
                        return;
                    } else if (this.ordered_properties) {
                        value.forEachPropertyOrdered(this.globalThis, &iter, Iterator.forEach);
                    } else {
                        value.forEachProperty(this.globalThis, &iter, Iterator.forEach);
                    }

                    if (iter.i == 0) {
                        if (value.isClass(this.globalThis) and !value.isCallable(this.globalThis.vm()))
                            this.printAs(.Class, Writer, writer_, value, jsType, enable_ansi_colors)
                        else if (value.isCallable(this.globalThis.vm()))
                            this.printAs(.Function, Writer, writer_, value, jsType, enable_ansi_colors)
                        else
                            writer.writeAll("{}");
                    } else {
                        this.depth -= 1;

                        if (iter.always_newline) {
                            this.indent -|= 1;
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch {};
                            writer.writeAll("}");
                            this.estimated_line_length += 1;
                        } else {
                            this.estimated_line_length += 2;
                            writer.writeAll(" }");
                        }
                    }
                },
                .TypedArray => {
                    const arrayBuffer = value.asArrayBuffer(this.globalThis).?;
                    const slice = arrayBuffer.byteSlice();

                    writer.writeAll(bun.asByteSlice(@tagName(arrayBuffer.typed_array_type)));
                    writer.print("({d}) [ ", .{arrayBuffer.len});

                    if (slice.len > 0) {
                        switch (jsType) {
                            .Int8Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                i8,
                                @alignCast(std.meta.alignment([]i8), std.mem.bytesAsSlice(i8, slice)),
                                enable_ansi_colors,
                            ),
                            .Int16Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                i16,
                                @alignCast(std.meta.alignment([]i16), std.mem.bytesAsSlice(i16, slice)),
                                enable_ansi_colors,
                            ),
                            .Uint16Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                u16,
                                @alignCast(std.meta.alignment([]u16), std.mem.bytesAsSlice(u16, slice)),
                                enable_ansi_colors,
                            ),
                            .Int32Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                i32,
                                @alignCast(std.meta.alignment([]i32), std.mem.bytesAsSlice(i32, slice)),
                                enable_ansi_colors,
                            ),
                            .Uint32Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                u32,
                                @alignCast(std.meta.alignment([]u32), std.mem.bytesAsSlice(u32, slice)),
                                enable_ansi_colors,
                            ),
                            .Float32Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                f32,
                                @alignCast(std.meta.alignment([]f32), std.mem.bytesAsSlice(f32, slice)),
                                enable_ansi_colors,
                            ),
                            .Float64Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                f64,
                                @alignCast(std.meta.alignment([]f64), std.mem.bytesAsSlice(f64, slice)),
                                enable_ansi_colors,
                            ),
                            .BigInt64Array => this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                i64,
                                @alignCast(std.meta.alignment([]i64), std.mem.bytesAsSlice(i64, slice)),
                                enable_ansi_colors,
                            ),
                            .BigUint64Array => {
                                this.writeTypedArray(
                                    *@TypeOf(writer),
                                    &writer,
                                    u64,
                                    @alignCast(std.meta.alignment([]u64), std.mem.bytesAsSlice(u64, slice)),
                                    enable_ansi_colors,
                                );
                            },

                            // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                            else => this.writeTypedArray(*@TypeOf(writer), &writer, u8, slice, enable_ansi_colors),
                        }
                    }

                    writer.writeAll(" ]");
                },
                else => {},
            }
        }

        fn writeTypedArray(this: *ZigConsoleClient.Formatter, comptime WriterWrapped: type, writer: WriterWrapped, comptime Number: type, slice: []const Number, comptime enable_ansi_colors: bool) void {
            const fmt_ = if (Number == i64 or Number == u64)
                "<r><yellow>{d}n<r>"
            else
                "<r><yellow>{d}<r>";
            const more = if (Number == i64 or Number == u64)
                "<r><d>n, ... {d} more<r>"
            else
                "<r><d>, ... {d} more<r>";

            writer.print(comptime Output.prettyFmt(fmt_, enable_ansi_colors), .{slice[0]});
            var leftover = slice[1..];
            const max = 512;
            leftover = leftover[0..@min(leftover.len, max)];
            for (leftover) |el| {
                this.printComma(@TypeOf(&writer.ctx), &writer.ctx, enable_ansi_colors) catch return;
                writer.writeAll(" ");

                writer.print(comptime Output.prettyFmt(fmt_, enable_ansi_colors), .{el});
            }

            if (slice.len > max + 1) {
                writer.print(comptime Output.prettyFmt(more, enable_ansi_colors), .{slice.len - max - 1});
            }
        }

        pub fn format(this: *ZigConsoleClient.Formatter, result: Tag.Result, comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) void {
            if (comptime is_bindgen) {
                return;
            }
            var prevGlobalThis = this.globalThis;
            defer this.globalThis = prevGlobalThis;
            this.globalThis = globalThis;

            // This looks incredibly redundant. We make the ZigConsoleClient.Formatter.Tag a
            // comptime var so we have to repeat it here. The rationale there is
            // it _should_ limit the stack usage because each version of the
            // function will be relatively small
            return switch (result.tag) {
                .StringPossiblyFormatted => this.printAs(.StringPossiblyFormatted, Writer, writer, value, result.cell, enable_ansi_colors),
                .String => this.printAs(.String, Writer, writer, value, result.cell, enable_ansi_colors),
                .Undefined => this.printAs(.Undefined, Writer, writer, value, result.cell, enable_ansi_colors),
                .Double => this.printAs(.Double, Writer, writer, value, result.cell, enable_ansi_colors),
                .Integer => this.printAs(.Integer, Writer, writer, value, result.cell, enable_ansi_colors),
                .Null => this.printAs(.Null, Writer, writer, value, result.cell, enable_ansi_colors),
                .Boolean => this.printAs(.Boolean, Writer, writer, value, result.cell, enable_ansi_colors),
                .Array => this.printAs(.Array, Writer, writer, value, result.cell, enable_ansi_colors),
                .Object => this.printAs(.Object, Writer, writer, value, result.cell, enable_ansi_colors),
                .Function => this.printAs(.Function, Writer, writer, value, result.cell, enable_ansi_colors),
                .Class => this.printAs(.Class, Writer, writer, value, result.cell, enable_ansi_colors),
                .Error => this.printAs(.Error, Writer, writer, value, result.cell, enable_ansi_colors),
                .ArrayBuffer, .TypedArray => this.printAs(.TypedArray, Writer, writer, value, result.cell, enable_ansi_colors),
                .Map => this.printAs(.Map, Writer, writer, value, result.cell, enable_ansi_colors),
                .Set => this.printAs(.Set, Writer, writer, value, result.cell, enable_ansi_colors),
                .Symbol => this.printAs(.Symbol, Writer, writer, value, result.cell, enable_ansi_colors),
                .BigInt => this.printAs(.BigInt, Writer, writer, value, result.cell, enable_ansi_colors),
                .GlobalObject => this.printAs(.GlobalObject, Writer, writer, value, result.cell, enable_ansi_colors),
                .Private => this.printAs(.Private, Writer, writer, value, result.cell, enable_ansi_colors),
                .Promise => this.printAs(.Promise, Writer, writer, value, result.cell, enable_ansi_colors),

                // Call JSON.stringify on the value
                .JSON => this.printAs(.JSON, Writer, writer, value, result.cell, enable_ansi_colors),

                // Call value.toJSON() and print as an object
                .toJSON => this.printAs(.toJSON, Writer, writer, value, result.cell, enable_ansi_colors),

                .NativeCode => this.printAs(.NativeCode, Writer, writer, value, result.cell, enable_ansi_colors),
                .JSX => this.printAs(.JSX, Writer, writer, value, result.cell, enable_ansi_colors),
                .Event => this.printAs(.Event, Writer, writer, value, result.cell, enable_ansi_colors),
                .Getter => this.printAs(.Getter, Writer, writer, value, result.cell, enable_ansi_colors),
            };
        }
    };

    pub fn count(
        // console
        _: ZigConsoleClient.Type,
        // global
        globalThis: *JSGlobalObject,
        // chars
        ptr: [*]const u8,
        // len
        len: usize,
    ) callconv(.C) void {
        var this = globalThis.bunVM().console;
        const slice = ptr[0..len];
        const hash = bun.hash(slice);
        // we don't want to store these strings, it will take too much memory
        var counter = this.counts.getOrPut(globalThis.allocator(), hash) catch unreachable;
        const current = @as(u32, if (counter.found_existing) counter.value_ptr.* else @as(u32, 0)) + 1;
        counter.value_ptr.* = current;

        var writer_ctx = &this.writer;
        var writer = &writer_ctx.writer();
        if (Output.enable_ansi_colors_stdout)
            writer.print(comptime Output.prettyFmt("<r>{s}<d>: <r><yellow>{d}<r>\n", true), .{ slice, current }) catch unreachable
        else
            writer.print(comptime Output.prettyFmt("<r>{s}<d>: <r><yellow>{d}<r>\n", false), .{ slice, current }) catch unreachable;
        writer_ctx.flush() catch unreachable;
    }
    pub fn countReset(
        // console
        _: ZigConsoleClient.Type,
        // global
        globalThis: *JSGlobalObject,
        // chars
        ptr: [*]const u8,
        // len
        len: usize,
    ) callconv(.C) void {
        var this = globalThis.bunVM().console;
        const slice = ptr[0..len];
        const hash = bun.hash(slice);
        // we don't delete it because deleting is implemented via tombstoning
        var entry = this.counts.getEntry(hash) orelse return;
        entry.value_ptr.* = 0;
    }

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
        var value: std.time.Timer = result.value orelse return;
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
        chars: [*]const u8,
        // len
        len: usize,
        // args
        _: *ScriptArguments,
    ) callconv(.C) void {
        if (!pending_time_logs_loaded) {
            return;
        }

        const id = std.hash.Wyhash.hash(0, chars[0..len]);
        var value: std.time.Timer = (pending_time_logs.get(id) orelse return) orelse return;
        // get the duration in microseconds
        // then display it in milliseconds
        Output.printElapsed(@intToFloat(f64, value.read() / std.time.ns_per_us) / std.time.us_per_ms);
        switch (len) {
            0 => Output.printErrorln("\n", .{}),
            else => Output.printErrorln(" {s}", .{chars[0..len]}),
        }

        Output.flush();

        // TODO: print the arguments
    }
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
        .messageWithTypeAndLevel = messageWithTypeAndLevel,
        .count = count,
        .countReset = countReset,
        .time = time,
        .timeLog = timeLog,
        .timeEnd = timeEnd,
        .profile = profile,
        .profileEnd = profileEnd,
        .takeHeapSnapshot = takeHeapSnapshot,
        .timeStamp = timeStamp,
        .record = record,
        .recordEnd = recordEnd,
        .screenshot = screenshot,
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
//                 "ResolveMessage: {s} while resolving \"{s}\"\nfrom \"{s}\"",
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

const Bun = @import("../api/bun.zig");
pub const BunTimer = Bun.Timer;
pub const Formatter = ZigConsoleClient.Formatter;
pub const HTTPServerRequestContext = JSC.API.Server.RequestContext;
pub const HTTPSSLServerRequestContext = JSC.API.SSLServer.RequestContext;
pub const HTTPDebugServerRequestContext = JSC.API.DebugServer.RequestContext;
pub const HTTPDebugSSLServerRequestContext = JSC.API.DebugSSLServer.RequestContext;
pub const TestScope = @import("../test/jest.zig").TestScope;
comptime {
    if (!is_bindgen) {
        WebSocketHTTPClient.shim.ref();
        WebSocketHTTPSClient.shim.ref();
        WebSocketClient.shim.ref();
        WebSocketClientTLS.shim.ref();

        HTTPServerRequestContext.shim.ref();
        HTTPSSLServerRequestContext.shim.ref();
        HTTPDebugServerRequestContext.shim.ref();
        HTTPDebugSSLServerRequestContext.shim.ref();

        _ = Process.getTitle;
        _ = Process.setTitle;
        _ = Zig__getAPIGlobals;
        _ = Zig__getAPIConstructors;
        Bun.Timer.shim.ref();
        NodePath.shim.ref();
        JSReadableStreamBlob.shim.ref();
        JSArrayBufferSink.shim.ref();
        JSHTTPResponseSink.shim.ref();
        JSHTTPSResponseSink.shim.ref();
        JSFileSink.shim.ref();
        JSReadableStreamBytes.shim.ref();
        JSReadableStreamFile.shim.ref();
        _ = ZigString__free;
        _ = ZigString__free_global;

        TestScope.shim.ref();
    }
}
