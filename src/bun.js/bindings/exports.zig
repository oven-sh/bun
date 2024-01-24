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

const Backtrace = @import("../../crash_reporter.zig");
const JSPrinter = bun.js_printer;
const JSLexer = bun.js_lexer;
const typeBaseName = @import("../../meta.zig").typeBaseName;
const String = bun.String;
const JestPrettyFormat = @import("../test/pretty_format.zig").JestPrettyFormat;

pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *anyopaque;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(JS.VirtualMachine);

    pub fn create(
        console: *anyopaque,
        context_id: i32,
        mini_mode: bool,
        worker_ptr: ?*anyopaque,
    ) *JSGlobalObject {
        const global = shim.cppFn("create", .{ console, context_id, mini_mode, worker_ptr });
        Backtrace.reloadHandlers() catch unreachable;
        return global;
    }

    pub fn getModuleRegistryMap(global: *JSGlobalObject) *anyopaque {
        return shim.cppFn("getModuleRegistryMap", .{global});
    }

    pub fn resetModuleRegistryMap(global: *JSGlobalObject, map: *anyopaque) bool {
        return shim.cppFn("resetModuleRegistryMap", .{ global, map });
    }

    pub fn import(global: *JSGlobalObject, specifier: *bun.String, source: *bun.String) callconv(.C) ErrorableString {
        JSC.markBinding(@src());

        return @call(.always_inline, Interface.import, .{ global, specifier, source });
    }
    pub fn resolve(res: *ErrorableString, global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, query: *ZigString) callconv(.C) void {
        JSC.markBinding(@src());
        @call(.always_inline, Interface.resolve, .{ res, global, specifier, source, query });
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
            .promiseRejectionTracker = promiseRejectionTracker,
            .reportUncaughtException = reportUncaughtException,
            .onCrash = onCrash,
        },
    );

    pub const Extern = [_][]const u8{ "create", "getModuleRegistryMap", "resetModuleRegistryMap" };

    comptime {
        @export(import, .{ .name = Export[0].symbol_name });
        @export(resolve, .{ .name = Export[1].symbol_name });
        @export(promiseRejectionTracker, .{ .name = Export[2].symbol_name });
        @export(reportUncaughtException, .{ .name = Export[3].symbol_name });
        @export(onCrash, .{ .name = Export[4].symbol_name });
    }
};

const ErrorCodeInt = u16;

pub const ErrorCode = enum(ErrorCodeInt) {
    _,

    pub inline fn from(code: anyerror) ErrorCode {
        return @as(ErrorCode, @enumFromInt(@intFromError(code)));
    }

    pub const ParserError = @intFromEnum(ErrorCode.from(error.ParserError));
    pub const JSErrorObject = @intFromEnum(ErrorCode.from(error.JSErrorObject));

    pub const Type = ErrorCodeInt;
};

pub const ZigErrorType = extern struct {
    pub const shim = Shimmer("Zig", "ErrorType", @This());
    pub const name = "ErrorType";
    pub const namespace = shim.namespace;

    code: ErrorCode,
    ptr: ?*anyopaque,
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
pub const JSUVStreamSink = JSC.WebCore.UVStreamSink.JSSink;

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

    specifier: bun.String = bun.String.empty,
    source_code: bun.String = bun.String.empty,
    source_url: bun.String = bun.String.empty,
    commonjs_exports: ?[*]ZigString = null,
    commonjs_exports_len: u32 = 0,

    hash: u32 = 0,

    allocator: ?*anyopaque = null,

    tag: Tag = Tag.javascript,
    needs_deref: bool = true,

    pub const Tag = @import("ResolvedSourceTag").ResolvedSourceTag;
};

const Mimalloc = @import("../../allocators/mimalloc.zig");

export fn ZigString__free(raw: [*]const u8, len: usize, allocator_: ?*anyopaque) void {
    var allocator: std.mem.Allocator = @as(*std.mem.Allocator, @ptrCast(@alignCast(allocator_ orelse return))).*;
    var ptr = ZigString.init(raw[0..len]).slice().ptr;
    if (comptime Environment.allow_assert) {
        std.debug.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    const str = ptr[0..len];

    allocator.free(str);
}

export fn ZigString__free_global(ptr: [*]const u8, len: usize) void {
    const untagged = @as(*anyopaque, @ptrFromInt(@intFromPtr(ZigString.init(ptr[0..len]).slice().ptr)));
    if (comptime Environment.allow_assert) {
        std.debug.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    // we must untag the string pointer
    Mimalloc.mi_free(untagged);
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
    source_lines_ptr: [*]bun.String,
    source_lines_numbers: [*]i32,
    source_lines_len: u8,
    source_lines_to_collect: u8,

    frames_ptr: [*]ZigStackFrame,
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

            const source_line_len = source_lines_iter.getLength();

            if (source_line_len > 0) {
                var source_lines = try allocator.alloc(Api.SourceLine, @as(usize, @intCast(@max(source_lines_iter.i + 1, 0))));
                var source_line_buf = try allocator.alloc(u8, source_line_len);
                source_lines_iter = this.sourceLineIterator();
                var remain_buf = source_line_buf[0..];
                var i: usize = 0;
                while (source_lines_iter.next()) |source| {
                    const text = source.text.slice();
                    defer source.text.deinit();
                    bun.copy(
                        u8,
                        remain_buf,
                        text,
                    );
                    const copied_line = remain_buf[0..text.len];
                    remain_buf = remain_buf[text.len..];
                    source_lines[i] = .{ .text = copied_line, .line = source.line };
                    i += 1;
                }
                stack_trace.source_lines = source_lines;
            }
        }
        {
            const _frames = this.frames();
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
            text: ZigString.Slice,
        };

        pub fn getLength(this: *SourceLineIterator) usize {
            var count: usize = 0;
            for (this.trace.source_lines_ptr[0..@as(usize, @intCast(this.i + 1))]) |*line| {
                count += line.length();
            }

            return count;
        }

        pub fn untilLast(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 1) return null;
            return this.next();
        }

        pub fn next(this: *SourceLineIterator) ?SourceLine {
            if (this.i < 0) return null;

            const source_line = this.trace.source_lines_ptr[@as(usize, @intCast(this.i))];
            const result = SourceLine{
                .line = this.trace.source_lines_numbers[@as(usize, @intCast(this.i))],
                .text = source_line.toUTF8(bun.default_allocator),
            };
            this.i -= 1;
            return result;
        }
    };

    pub fn sourceLineIterator(this: *const ZigStackTrace) SourceLineIterator {
        var i: usize = 0;
        for (this.source_lines_numbers[0..this.source_lines_len], 0..) |num, j| {
            if (num >= 0) {
                i = @max(j, i);
            }
        }
        return SourceLineIterator{ .trace = this, .i = @as(i16, @intCast(i)) };
    }
};

pub const ZigStackFrame = extern struct {
    function_name: String,
    source_url: String,
    position: ZigStackFramePosition,
    code_type: ZigStackFrameCode,

    /// This informs formatters whether to display as a blob URL or not
    remapped: bool = false,

    pub fn deinit(this: *ZigStackFrame) void {
        this.function_name.deref();
        this.source_url.deref();
    }

    pub fn toAPI(this: *const ZigStackFrame, root_path: string, origin: ?*const ZigURL, allocator: std.mem.Allocator) !Api.StackFrame {
        var frame: Api.StackFrame = comptime std.mem.zeroes(Api.StackFrame);
        if (!this.function_name.isEmpty()) {
            var slicer = this.function_name.toUTF8(allocator);
            defer slicer.deinit();
            frame.function_name = (try slicer.clone(allocator)).slice();
        }

        if (!this.source_url.isEmpty()) {
            frame.file = try std.fmt.allocPrint(allocator, "{any}", .{this.sourceURLFormatter(root_path, origin, true, false)});
        }

        frame.position.source_offset = this.position.source_offset;

        // For remapped code, we add 1 to the line number
        frame.position.line = this.position.line + @as(i32, @intFromBool(this.remapped));

        frame.position.line_start = this.position.line_start;
        frame.position.line_stop = this.position.line_stop;
        frame.position.column_start = this.position.column_start;
        frame.position.column_stop = this.position.column_stop;
        frame.position.expression_start = this.position.expression_start;
        frame.position.expression_stop = this.position.expression_stop;
        frame.scope = @as(Api.StackFrameScope, @enumFromInt(@intFromEnum(this.code_type)));

        return frame;
    }

    pub const SourceURLFormatter = struct {
        source_url: bun.String,
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

            var source_slice_ = this.source_url.toUTF8(bun.default_allocator);
            var source_slice = source_slice_.slice();
            defer source_slice_.deinit();

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
                            .{ this.position.line + 1, this.position.column_start + 1 },
                        );
                    } else {
                        try std.fmt.format(writer, ":{d}:{d}", .{ this.position.line + 1, this.position.column_start + 1 });
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
        function_name: String,
        code_type: ZigStackFrameCode,
        enable_color: bool,

        pub fn format(this: NameFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const name = this.function_name;

            switch (this.code_type) {
                .Eval => {
                    try writer.writeAll("(eval)");
                    if (!name.isEmpty()) {
                        try std.fmt.format(writer, "{}", .{name});
                    }
                },
                .Function => {
                    if (!name.isEmpty()) {
                        if (this.enable_color) {
                            try std.fmt.format(writer, comptime Output.prettyFmt("<r><b><i>{}<r>", true), .{name});
                        } else {
                            try std.fmt.format(writer, "{}", .{name});
                        }
                    }
                },
                .Global => {
                    if (!name.isEmpty()) {
                        try std.fmt.format(writer, "globalThis {}", .{name});
                    } else {
                        try writer.writeAll("globalThis");
                    }
                },
                .Wasm => {
                    try std.fmt.format(writer, "WASM {}", .{name});
                },
                .Constructor => {
                    try std.fmt.format(writer, "new {}", .{name});
                },
                else => {
                    if (!name.isEmpty()) {
                        try std.fmt.format(writer, "{}", .{name});
                    }
                },
            }
        }
    };

    pub const Zero: ZigStackFrame = ZigStackFrame{
        .function_name = String.empty,
        .code_type = ZigStackFrameCode.None,
        .source_url = String.empty,
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
    syscall: String = String.empty,
    /// SystemError only
    system_code: String = String.empty,
    /// SystemError only
    path: String = String.empty,

    name: String,
    message: String,
    stack: ZigStackTrace,

    exception: ?*anyopaque,

    remapped: bool = false,

    fd: i32 = -1,

    pub fn deinit(this: *ZigException) void {
        this.syscall.deref();
        this.system_code.deref();
        this.path.deref();

        this.name.deref();
        this.message.deref();

        for (this.stack.frames_ptr[0..this.stack.frames_len]) |*frame| {
            frame.deinit();
        }
    }

    pub const shim = Shimmer("Zig", "Exception", @This());
    pub const name = "ZigException";
    pub const namespace = shim.namespace;

    pub const Holder = extern struct {
        const frame_count = 32;
        pub const source_lines_count = 6;
        source_line_numbers: [source_lines_count]i32,
        source_lines: [source_lines_count]String,
        frames: [frame_count]ZigStackFrame,
        loaded: bool,
        zig_exception: ZigException,

        pub const Zero: Holder = Holder{
            .frames = brk: {
                var _frames: [frame_count]ZigStackFrame = undefined;
                @memset(&_frames, ZigStackFrame.Zero);
                break :brk _frames;
            },
            .source_line_numbers = brk: {
                var lines: [source_lines_count]i32 = undefined;
                @memset(&lines, -1);
                break :brk lines;
            },

            .source_lines = brk: {
                var lines: [source_lines_count]String = undefined;
                @memset(&lines, String.empty);
                break :brk lines;
            },
            .zig_exception = undefined,
            .loaded = false,
        };

        pub fn init() Holder {
            return Holder.Zero;
        }

        pub fn deinit(this: *Holder) void {
            this.zigException().deinit();
        }

        pub fn zigException(this: *Holder) *ZigException {
            if (!this.loaded) {
                this.zig_exception = ZigException{
                    .code = @as(JSErrorCode, @enumFromInt(255)),
                    .runtime_type = JSRuntimeType.Nothing,
                    .name = String.empty,
                    .message = String.empty,
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
        const name_slice = @field(this, "name").toUTF8(bun.default_allocator);
        const message_slice = @field(this, "message").toUTF8(bun.default_allocator);

        const _name = name_slice.slice();
        defer name_slice.deinit();
        const message = message_slice.slice();
        defer message_slice.deinit();

        var is_empty = true;
        var api_exception = Api.JsException{
            .runtime_type = @intFromEnum(this.runtime_type),
            .code = @intFromEnum(this.code),
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
pub const ErrorableString = Errorable(bun.String);
pub const ConsoleObject = @import("../ConsoleObject.zig");

pub inline fn toGlobalContextRef(ptr: *JSGlobalObject) CAPI.JSGlobalContextRef {
    return @as(CAPI.JSGlobalContextRef, @ptrCast(ptr));
}

comptime {
    @export(ErrorCode.ParserError, .{ .name = "Zig_ErrorCodeParserError" });
    @export(ErrorCode.JSErrorObject, .{ .name = "Zig_ErrorCodeJSErrorObject" });
}

const Bun = JSC.API.Bun;
pub const BunTimer = Bun.Timer;
pub const Formatter = ConsoleObject.Formatter;
pub const HTTPServerRequestContext = JSC.API.HTTPServer.RequestContext;
pub const HTTPSSLServerRequestContext = JSC.API.HTTPSServer.RequestContext;
pub const HTTPDebugServerRequestContext = JSC.API.DebugHTTPServer.RequestContext;
pub const HTTPDebugSSLServerRequestContext = JSC.API.DebugHTTPSServer.RequestContext;
pub const BodyValueBuffererContext = JSC.WebCore.BodyValueBufferer;
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
        Bun.Timer.shim.ref();
        NodePath.shim.ref();
        JSReadableStreamBlob.shim.ref();
        JSArrayBufferSink.shim.ref();
        JSHTTPResponseSink.shim.ref();
        JSHTTPSResponseSink.shim.ref();
        JSFileSink.shim.ref();
        JSUVStreamSink.shim.ref();
        JSReadableStreamBytes.shim.ref();
        JSReadableStreamFile.shim.ref();
        _ = ZigString__free;
        _ = ZigString__free_global;

        TestScope.shim.ref();
        BodyValueBuffererContext.shim.ref();
    }
}
