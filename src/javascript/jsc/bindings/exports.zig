usingnamespace @import("./bindings.zig");
usingnamespace @import("./shared.zig");

pub const ZigGlobalObject = extern struct {
    pub const shim = Shimmer("Zig", "GlobalObject", @This());
    bytes: shim.Bytes,
    pub const Type = *c_void;
    pub const name = "Zig::GlobalObject";
    pub const include = "\"ZigGlobalObject.h\"";
    pub const namespace = shim.namespace;
    pub const Interface: type = NewGlobalObject(std.meta.globalOption("JSGlobalObject", type) orelse struct {});

    pub fn create(vm: ?*VM, console: *c_void) *JSGlobalObject {
        return shim.cppFn("create", .{ vm, console });
    }

    pub fn import(global: *JSGlobalObject, loader: *JSModuleLoader, specifier: *JSString, referrer: JSValue, origin: *const SourceOrigin) callconv(.C) *JSInternalPromise {
        // if (comptime is_bindgen) {
        //     unreachable;
        // }

        return @call(.{ .modifier = .always_inline }, Interface.import, .{ global, loader, specifier, referrer, origin });
    }
    pub fn resolve(global: *JSGlobalObject, loader: *JSModuleLoader, specifier: JSValue, value: JSValue, origin: *const SourceOrigin) callconv(.C) Identifier {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.resolve, .{ global, loader, specifier, value, origin });
    }
    pub fn fetch(global: *JSGlobalObject, loader: *JSModuleLoader, value1: JSValue, value2: JSValue, value3: JSValue) callconv(.C) *JSInternalPromise {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.fetch, .{ global, loader, value1, value2, value3 });
    }
    pub fn eval(global: *JSGlobalObject, loader: *JSModuleLoader, key: JSValue, moduleRecordValue: JSValue, scriptFetcher: JSValue, awaitedValue: JSValue, resumeMode: JSValue) callconv(.C) JSValue {
        if (comptime is_bindgen) {
            unreachable;
        }
        return @call(.{ .modifier = .always_inline }, Interface.eval, .{ global, loader, key, moduleRecordValue, scriptFetcher, awaitedValue, resumeMode });
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

    pub const Export = shim.exportFunctions(.{
        .@"import" = import,
        .@"resolve" = resolve,
        .@"fetch" = fetch,
        .@"eval" = eval,
        .@"promiseRejectionTracker" = promiseRejectionTracker,
        .@"reportUncaughtException" = reportUncaughtException,
        .@"createImportMetaProperties" = createImportMetaProperties,
    });

    pub const Extern = [_][]const u8{"create"};

    comptime {
        @export(import, .{ .name = Export[0].symbol_name });
        @export(resolve, .{ .name = Export[1].symbol_name });
        @export(fetch, .{ .name = Export[2].symbol_name });
        @export(eval, .{ .name = Export[3].symbol_name });
        @export(promiseRejectionTracker, .{ .name = Export[4].symbol_name });
        @export(reportUncaughtException, .{ .name = Export[5].symbol_name });
        @export(createImportMetaProperties, .{ .name = Export[6].symbol_name });
    }
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

    pub fn init(allocator: *std.mem.Allocator) !*ZigConsoleClient {
        var console = try allocator.create(ZigConsoleClient);
        console.* = ZigConsoleClient{
            .error_writer = BufferedWriter{ .unbuffered_writer = Output.errorWriter() },
            .writer = BufferedWriter{ .unbuffered_writer = Output.writer() },
        };
        return console;
    }

    pub fn messageWithTypeAndLevel(
        console_: ZigConsoleClient.Type,
        message_type: u32,
        message_level: u32,
        global: *JSGlobalObject,
        args: *ScriptArguments,
    ) callconv(.C) void {
        var console = zigCast(ZigConsoleClient, console_);
        var i: usize = 0;
        const len = args.argumentCount();
        defer args.release();
        var writer = console.writer;

        if (len == 1) {
            var str = args.getFirstArgumentAsString();
            _ = writer.unbuffered_writer.write(str.slice()) catch 0;
            return;
        }

        defer writer.flush() catch {};

        while (i < len) : (i += 1) {
            var str = args.argumentAt(i).toWTFString(global);
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
