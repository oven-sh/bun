const JSC = @import("./bindings.zig");
usingnamespace @import("./shared.zig");
const Fs = @import("../../../fs.zig");
const CAPI = @import("../JavascriptCore.zig");
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

const Handler = struct {
    pub export fn global_signal_handler_fn(sig: i32, info: *const std.os.siginfo_t, ctx_ptr: ?*const anyopaque) callconv(.C) void {
        var stdout = std.io.getStdOut();
        var stderr = std.io.getStdErr();
        var source = Output.Source.init(stdout, stderr);
        Output.Source.set(&source);

        if (Output.isEmojiEnabled()) {
            Output.prettyErrorln("<r><red>Bun will crash now<r> 😭😭😭\n", .{});
            Output.flush();
        } else {
            stderr.writeAll("Bun has crashed :'(\n") catch {};
        }
        std.mem.doNotOptimizeAway(source);

        std.os.exit(6);
    }
};

pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *anyopaque;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(JS.VirtualMachine);

    pub var sigaction: std.os.Sigaction = undefined;
    pub var sigaction_installed = false;

    pub fn create(class_ref: [*]CAPI.JSClassRef, count: i32, console: *anyopaque) *JSGlobalObject {
        if (!sigaction_installed) {
            sigaction_installed = true;

            sigaction = std.mem.zeroes(std.os.Sigaction);
            sigaction.handler = .{ .sigaction = Handler.global_signal_handler_fn };

            std.os.sigaction(std.os.SIGABRT, &sigaction, null);
            if (comptime !Environment.isDebug) {
                std.os.sigaction(std.os.SIGTRAP, &sigaction, null);
            }
        }

        return shim.cppFn("create", .{ class_ref, count, console });
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
    var allocator: std.mem.Allocator = @ptrCast(std.mem.Allocator, @alignCast(@alignOf(std.mem.Allocator), allocator_ orelse return));

    var str = ptr[0..len];
    allocator.free(str);
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
        origin: *const ZigURL,
        root_path: string = "",
        pub fn format(this: SourceURLFormatter, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll(this.origin.displayProtocol());
            try writer.writeAll("://");
            try writer.writeAll(this.origin.displayHostname());
            try writer.writeAll(":");
            try writer.writeAll(this.origin.port);
            try writer.writeAll("/blob:");

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

        pub fn format(this: NameFormatter, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
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

    pub fn sourceURLFormatter(this: *const ZigStackFrame, root_path: string, origin: *const ZigURL, comptime enable_color: bool) SourceURLFormatter {
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

    /// TODO: support %s %d %f %o %O
    /// https://console.spec.whatwg.org/#formatter
    pub fn messageWithTypeAndLevel(
        console_: ZigConsoleClient.Type,
        message_type: u32,
        message_level: u32,
        global: *JSGlobalObject,
        vals: [*]JSValue,
        len: usize,
    ) callconv(.C) void {
        if (comptime @hasDecl(@import("root"), "bindgen")) {
            return;
        }

        var console = JS.VirtualMachine.vm.console;
        var i: usize = 0;
        var buffered_writer = console.writer;
        var writer = buffered_writer.writer();

        if (len == 1) {
            if (Output.enable_ansi_colors) {
                FormattableType.format(
                    @TypeOf(buffered_writer.unbuffered_writer),
                    buffered_writer.unbuffered_writer,
                    vals[0],
                    global,
                    true,
                ) catch {};
            } else {
                FormattableType.format(
                    @TypeOf(buffered_writer.unbuffered_writer),
                    buffered_writer.unbuffered_writer,
                    vals[0],
                    global,
                    false,
                ) catch {};
            }

            _ = buffered_writer.unbuffered_writer.write("\n") catch 0;

            return;
        }

        var values = vals[0..len];
        defer buffered_writer.flush() catch {};
        var last_count: usize = 0;
        var tail: u8 = 0;

        if (Output.enable_ansi_colors) {
            while (i < len) : (i += 1) {
                _ = if (i > 0) (writer.write(" ") catch 0);

                FormattableType.format(@TypeOf(writer), writer, values[i], global, true) catch {};
            }
        } else {
            while (i < len) : (i += 1) {
                _ = if (i > 0) (writer.write(" ") catch 0);

                FormattableType.format(@TypeOf(writer), writer, values[i], global, false) catch {};
            }
        }

        _ = writer.write("\n") catch 0;
    }

    const FormattableType = enum {
        Error,
        String,
        Undefined,
        Double,
        Integer,
        Null,
        Boolean,
        const CellType = CAPI.CellType;
        threadlocal var name_buf: [512]u8 = undefined;
        pub fn format(comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) anyerror!void {
            if (comptime @hasDecl(@import("root"), "bindgen")) {
                return;
            }

            if (value.isCell()) {
                if (CAPI.JSObjectGetPrivate(value.asRef())) |private_data_ptr| {
                    const priv_data = JS.JSPrivateDataPtr.from(private_data_ptr);
                    switch (priv_data.tag()) {
                        .BuildError => {
                            const build_error = priv_data.as(JS.BuildError);
                            try build_error.msg.formatWriter(Writer, writer, enable_ansi_colors);
                            return;
                        },
                        .ResolveError => {
                            const resolve_error = priv_data.as(JS.ResolveError);
                            try resolve_error.msg.formatWriter(Writer, writer, enable_ansi_colors);
                            return;
                        },
                        else => {},
                    }
                }

                switch (@intToEnum(CellType, value.asCell().getType())) {
                    CellType.ErrorInstanceType => {
                        JS.VirtualMachine.printErrorlikeObject(JS.VirtualMachine.vm, value, null, null, enable_ansi_colors);
                        return;
                    },

                    CellType.GlobalObjectType => {
                        _ = try writer.write("[globalThis]");
                        return;
                    },
                    else => {},
                }
            }

            if (value.isInt32()) {
                try writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{value.toInt32()});
            } else if (value.isNumber()) {
                try writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{value.asNumber()});
            } else if (value.isUndefined()) {
                try writer.print(comptime Output.prettyFmt("<r><d>undefined<r>", enable_ansi_colors), .{});
            } else if (value.isNull()) {
                try writer.print(comptime Output.prettyFmt("<r><yellow>null<r>", enable_ansi_colors), .{});
            } else if (value.isBoolean()) {
                if (value.toBoolean()) {
                    try writer.print(comptime Output.prettyFmt("<r><yellow>true<r>", enable_ansi_colors), .{});
                } else {
                    try writer.print(comptime Output.prettyFmt("<r><yellow>false<r>", enable_ansi_colors), .{});
                }
                // } else if (value.isSymbol()) {
                //     try writer.print(comptime Output.prettyFmt("<r><yellow>Symbol(\"{s}\")<r>", enable_ansi_colors), .{ value.getDescriptionProperty() });
            } else if (value.isClass(globalThis)) {
                var printable = ZigString.init(&name_buf);
                value.getClassName(globalThis, &printable);
                try writer.print("[class {s}]", .{printable.slice()});
            } else if (value.isCallable(globalThis.vm())) {
                var printable = ZigString.init(&name_buf);
                value.getNameProperty(globalThis, &printable);
                try writer.print("[Function {s}]", .{printable.slice()});
            } else {
                var str = value.toWTFString(JS.VirtualMachine.vm.global);
                _ = try writer.write(str.slice());
            }
        }
    };

    pub fn count(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn countReset(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}

    const PendingTimers = std.AutoHashMap(u64, ?std.time.Timer);
    threadlocal var pending_time_logs: PendingTimers = undefined;
    threadlocal var pending_time_logs_loaded = false;

    pub fn time(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {
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
    pub fn timeEnd(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {
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

    pub fn timeLog(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize, args: *ScriptArguments) callconv(.C) void {}
    pub fn profile(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn profileEnd(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn takeHeapSnapshot(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn timeStamp(console: ZigConsoleClient.Type, global: *JSGlobalObject, args: *ScriptArguments) callconv(.C) void {}
    pub fn record(console: ZigConsoleClient.Type, global: *JSGlobalObject, args: *ScriptArguments) callconv(.C) void {}
    pub fn recordEnd(console: ZigConsoleClient.Type, global: *JSGlobalObject, args: *ScriptArguments) callconv(.C) void {}
    pub fn screenshot(console: ZigConsoleClient.Type, global: *JSGlobalObject, args: *ScriptArguments) callconv(.C) void {}

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
