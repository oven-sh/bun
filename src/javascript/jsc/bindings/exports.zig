usingnamespace @import("./bindings.zig");
usingnamespace @import("./shared.zig");
const Fs = @import("../../../fs.zig");
const CAPI = @import("../JavaScriptCore.zig");
const JS = @import("../javascript.zig");
const Handler = struct {
    pub export fn global_signal_handler_fn(sig: i32, info: *const std.os.siginfo_t, ctx_ptr: ?*const c_void) callconv(.C) void {
        Global.panic("C++ Crash!!", .{});
    }
};

pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *c_void;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(std.meta.globalOption("JavaScriptVirtualMachine", type) orelse struct {});

    pub var sigaction: std.os.Sigaction = undefined;
    pub var sigaction_installed = false;

    pub fn create(class_ref: [*]CAPI.JSClassRef, count: i32, console: *c_void) *JSGlobalObject {
        if (!sigaction_installed) {
            sigaction_installed = true;

            sigaction = std.mem.zeroes(std.os.Sigaction);
            sigaction.handler = .{ .sigaction = Handler.global_signal_handler_fn };

            std.os.sigaction(std.os.SIGABRT, &sigaction, null);
        }

        return shim.cppFn("create", .{ class_ref, count, console });
    }

    pub fn import(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {
        if (comptime is_bindgen) {
            unreachable;
        }

        return @call(.{ .modifier = .always_inline }, Interface.import, .{ global, specifier, source });
    }
    pub fn resolve(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableZigString {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.resolve, .{ global, specifier, source });
    }
    pub fn fetch(global: *JSGlobalObject, specifier: ZigString, source: ZigString) callconv(.C) ErrorableResolvedSource {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.fetch, .{ global, specifier, source });
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

    pub const Export = shim.exportFunctions(.{
        .@"import" = import,
        .@"resolve" = resolve,
        .@"fetch" = fetch,
        // .@"eval" = eval,
        .@"promiseRejectionTracker" = promiseRejectionTracker,
        .@"reportUncaughtException" = reportUncaughtException,
        .@"createImportMetaProperties" = createImportMetaProperties,
        .@"onCrash" = onCrash,
    });

    pub const Extern = [_][]const u8{"create"};

    comptime {
        @export(import, .{ .name = Export[0].symbol_name });
        @export(resolve, .{ .name = Export[1].symbol_name });
        @export(fetch, .{ .name = Export[2].symbol_name });
        @export(promiseRejectionTracker, .{ .name = Export[3].symbol_name });
        @export(reportUncaughtException, .{ .name = Export[4].symbol_name });
        @export(createImportMetaProperties, .{ .name = Export[5].symbol_name });
        @export(onCrash, .{ .name = Export[6].symbol_name });
    }
};

const ErrorCodeInt = std.meta.Int(.unsigned, @sizeOf(anyerror) * 8);
pub const ErrorCode = enum(ErrorCodeInt) {
    _,

    pub inline fn from(code: anyerror) ErrorCode {
        return @intToEnum(ErrorCode, @errorToInt(code));
    }

    pub const Type = switch (@sizeOf(anyerror)) {
        0, 1 => u8,
        2 => u16,
        3 => u32,
        4 => u64,
        else => @compileError("anyerror is too big"),
    };
};

pub const ZigErrorType = extern struct {
    code: ErrorCode,
    message: ZigString,
};

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
        pub fn errFmt(code: anyerror, comptime fmt: []const u8, args: anytype) @This() {
            const message = std.fmt.bufPrint(&err_buf, fmt, args) catch @as([]const u8, @errorName(code)[0..]);

            return @call(.{ .modifier = .always_inline }, err, .{ code, message });
        }

        pub fn err(code: anyerror, msg: []const u8) @This() {
            return @This(){
                .result = .{
                    .err = .{
                        .code = ErrorCode.from(code),
                        .message = ZigString.init(msg),
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

    // 0 means disabled
    bytecodecache_fd: u64,
};

pub const ErrorableResolvedSource = Errorable(ResolvedSource);

pub const ErrorableZigString = Errorable(ZigString);
pub const ErrorableJSValue = Errorable(JSValue);

pub const ZigException = extern struct {
    pub const shim = Shimmer("Zig", "Exception", @This());
    pub const name = "ZigException";
    pub const namespace = shim.namespace;

    code: JSErrorCode,
    runtime_type: JSRuntimeType,
    name: ZigString,
    message: ZigString,
    sourceURL: ZigString,
    line: i32,
    column: i32,
    stack: ZigString,
    exception: ?*c_void,

    pub fn fromException(exception: *Exception) ZigException {
        return shim.cppFn("fromException", .{exception});
    }

    pub const Extern = [_][]const u8{"fromException"};
};

pub const ZigConsoleClient = struct {
    pub const shim = Shimmer("Zig", "ConsoleClient", @This());
    pub const Type = *c_void;
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
        allocator: *std.mem.Allocator,
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

    pub fn messageWithTypeAndLevel(
        console_: ZigConsoleClient.Type,
        message_type: u32,
        message_level: u32,
        global: *JSGlobalObject,
        vals: [*]JSValue,
        len: usize,
    ) callconv(.C) void {
        var console = JS.VirtualMachine.vm.console;
        var i: usize = 0;
        var writer = console.writer;

        if (len == 1) {
            var str = vals[0].toWTFString(global);
            var slice = str.slice();
            var written = writer.unbuffered_writer.write(slice) catch 0;
            if (written > 0 and slice[slice.len - 1] != '\n') {
                _ = writer.unbuffered_writer.write("\n") catch 0;
            }
            return;
        }

        var values = vals[0..len];
        defer writer.flush() catch {};

        while (i < len) : (i += 1) {
            var str = values[i].toWTFString(global);
            _ = writer.write(str.slice()) catch 0;
        }
    }
    pub fn count(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn countReset(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn time(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
    pub fn timeLog(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize, args: *ScriptArguments) callconv(.C) void {}
    pub fn timeEnd(console: ZigConsoleClient.Type, global: *JSGlobalObject, chars: [*]const u8, len: usize) callconv(.C) void {}
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
//     pub const Type = *c_void;
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
