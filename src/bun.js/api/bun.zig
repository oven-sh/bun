const Bun = @This();
const default_allocator = @import("../../global.zig").default_allocator;
const bun = @import("../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../global.zig").Output;
const MutableString = @import("../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../bundler.zig").MacroEntryPoint;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../js_printer.zig");
const js_parser = @import("../../js_parser.zig");
const js_ast = @import("../../js_ast.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("../../jsc.zig").ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = @import("../../bundler.zig").ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../jsc.zig").C;
const JSC = @import("../../jsc.zig");
const JSError = @import("../base.zig").JSError;
const d = @import("../base.zig").d;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("../../jsc.zig").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../jsc.zig").ZigConsoleClient;
const Node = @import("../../jsc.zig").Node;
const ZigException = @import("../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../jsc.zig").Exception;
const ErrorableZigString = @import("../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../jsc.zig").ZigGlobalObject;
const VM = @import("../../jsc.zig").VM;
const JSFunction = @import("../../jsc.zig").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;
const zlib = @import("../../zlib.zig");
const Which = @import("../../which.zig");

const is_bindgen = JSC.is_bindgen;
const max_addressible_memory = std.math.maxInt(u56);

threadlocal var css_imports_list_strings: [512]ZigString = undefined;
threadlocal var css_imports_list: [512]Api.StringPointer = undefined;
threadlocal var css_imports_list_tail: u16 = 0;
threadlocal var css_imports_buf: std.ArrayList(u8) = undefined;
threadlocal var css_imports_buf_loaded: bool = false;

threadlocal var routes_list_strings: [1024]ZigString = undefined;

pub fn onImportCSS(
    resolve_result: *const Resolver.Result,
    import_record: *ImportRecord,
    origin: URL,
) void {
    if (!css_imports_buf_loaded) {
        css_imports_buf = std.ArrayList(u8).initCapacity(
            VirtualMachine.vm.allocator,
            import_record.path.text.len,
        ) catch unreachable;
        css_imports_buf_loaded = true;
    }

    var writer = css_imports_buf.writer();
    const offset = css_imports_buf.items.len;
    css_imports_list[css_imports_list_tail] = .{
        .offset = @truncate(u32, offset),
        .length = 0,
    };
    getPublicPath(resolve_result.path_pair.primary.text, origin, @TypeOf(writer), writer);
    const length = css_imports_buf.items.len - offset;
    css_imports_list[css_imports_list_tail].length = @truncate(u32, length);
    css_imports_list_tail += 1;
}

pub fn flushCSSImports() void {
    if (css_imports_buf_loaded) {
        css_imports_buf.clearRetainingCapacity();
        css_imports_list_tail = 0;
    }
}

pub fn getCSSImports() []ZigString {
    var i: u16 = 0;
    const tail = css_imports_list_tail;
    while (i < tail) : (i += 1) {
        ZigString.fromStringPointer(css_imports_list[i], css_imports_buf.items, &css_imports_list_strings[i]);
    }
    return css_imports_list_strings[0..tail];
}

pub fn which(
    // this
    _: void,
    globalThis: js.JSContextRef,
    // function
    _: js.JSObjectRef,
    // thisObject
    _: js.JSObjectRef,
    arguments_: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var arguments = JSC.Node.ArgumentsSlice.from(globalThis.bunVM(), arguments_);
    defer arguments.deinit();
    const path_arg = arguments.nextEat() orelse {
        JSC.throwInvalidArguments("which: expected 1 argument, got 0", .{}, globalThis, exception);
        return JSC.JSValue.jsUndefined().asObjectRef();
    };

    var path_str: ZigString.Slice = ZigString.Slice.empty;
    var bin_str: ZigString.Slice = ZigString.Slice.empty;
    var cwd_str: ZigString.Slice = ZigString.Slice.empty;
    defer {
        path_str.deinit();
        bin_str.deinit();
        cwd_str.deinit();
    }

    if (path_arg.isEmptyOrUndefinedOrNull()) {
        return JSC.JSValue.jsNull().asObjectRef();
    }

    bin_str = path_arg.toSlice(globalThis, globalThis.bunVM().allocator);

    if (bin_str.len >= bun.MAX_PATH_BYTES) {
        JSC.throwInvalidArguments("bin path is too long", .{}, globalThis, exception);
        return JSC.JSValue.jsUndefined().asObjectRef();
    }

    if (bin_str.len == 0) {
        return JSC.JSValue.jsNull().asObjectRef();
    }

    path_str = ZigString.Slice.fromUTF8(
        globalThis.bunVM().bundler.env.map.get("PATH") orelse "",
    );
    cwd_str = ZigString.Slice.fromUTF8(
        globalThis.bunVM().bundler.fs.top_level_dir,
    );

    if (arguments.nextEat()) |arg| {
        if (!arg.isEmptyOrUndefinedOrNull() and arg.isObject()) {
            if (arg.get(globalThis, "PATH")) |str_| {
                path_str = str_.toSlice(globalThis, globalThis.bunVM().allocator);
            }

            if (arg.get(globalThis, "cwd")) |str_| {
                cwd_str = str_.toSlice(globalThis, globalThis.bunVM().allocator);
            }
        }
    }

    if (Which.which(
        &path_buf,
        path_str.slice(),
        cwd_str.slice(),
        bin_str.slice(),
    )) |bin_path| {
        return ZigString.init(bin_path).withEncoding().toValueGC(globalThis).asObjectRef();
    }

    return JSC.JSValue.jsNull().asObjectRef();
}

pub fn inspect(
    // this
    _: void,
    ctx: js.JSContextRef,
    // function
    _: js.JSObjectRef,
    // thisObject
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (arguments.len == 0)
        return ZigString.Empty.toValue(ctx.ptr()).asObjectRef();

    for (arguments) |arg| {
        JSC.C.JSValueProtect(ctx, arg);
    }
    defer {
        for (arguments) |arg| {
            JSC.C.JSValueUnprotect(ctx, arg);
        }
    }

    // very stable memory address
    var array = MutableString.init(getAllocator(ctx), 0) catch unreachable;
    var buffered_writer_ = MutableString.BufferedWriter{ .context = &array };
    var buffered_writer = &buffered_writer_;

    var writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ZigConsoleClient.format(
        .Debug,
        ctx.ptr(),
        @ptrCast([*]const JSValue, arguments.ptr),
        arguments.len,
        Writer,
        Writer,
        writer,
        false,
        false,
        false,
    );
    buffered_writer.flush() catch {
        return JSC.C.JSValueMakeUndefined(ctx);
    };

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    var out = ZigString.init(array.toOwnedSliceLeaky()).withEncoding();
    const ret = out.toValueGC(ctx);
    array.deinit();
    return ret.asObjectRef();

    // // when it's a small thing, rely on GC to manage the memory
    // if (writer.context.pos < 2048 and array.list.items.len == 0) {
    //     var slice = writer.context.buffer[0..writer.context.pos];
    //     if (slice.len == 0) {
    //         return ZigString.Empty.toValue(ctx.ptr()).asObjectRef();
    //     }

    //     var zig_str =
    //     return zig_str.toValueGC(ctx.ptr()).asObjectRef();
    // }

    // // when it's a big thing, we will manage it
    // {
    //     writer.context.flush() catch {};
    //     var slice = writer.context.context.toOwnedSlice();

    //     var zig_str = ZigString.init(slice).withEncoding();
    //     if (!zig_str.isUTF8()) {
    //         return zig_str.toExternalValue(ctx.ptr()).asObjectRef();
    //     } else {
    //         return zig_str.toValueGC(ctx.ptr()).asObjectRef();
    //     }
    // }
}

pub fn registerMacro(
    // this
    _: void,
    ctx: js.JSContextRef,
    // function
    _: js.JSObjectRef,
    // thisObject
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    if (arguments.len != 2 or !js.JSValueIsNumber(ctx, arguments[0])) {
        JSError(getAllocator(ctx), "Internal error registering macros: invalid args", .{}, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }
    // TODO: make this faster
    const id = @truncate(i32, @floatToInt(i64, js.JSValueToNumber(ctx, arguments[0], exception)));
    if (id == -1 or id == 0) {
        JSError(getAllocator(ctx), "Internal error registering macros: invalid id", .{}, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }

    if (!arguments[1].?.value().isCell() or !arguments[1].?.value().isCallable(ctx.vm())) {
        JSError(getAllocator(ctx), "Macro must be a function. Received: {s}", .{@tagName(js.JSValueGetType(ctx, arguments[1]))}, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }

    var get_or_put_result = VirtualMachine.vm.macros.getOrPut(id) catch unreachable;
    if (get_or_put_result.found_existing) {
        js.JSValueUnprotect(ctx, get_or_put_result.value_ptr.*);
    }

    js.JSValueProtect(ctx, arguments[1]);
    get_or_put_result.value_ptr.* = arguments[1];

    return js.JSValueMakeUndefined(ctx);
}

pub fn getCWD(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(VirtualMachine.vm.bundler.fs.top_level_dir).toValue(ctx.ptr()).asRef();
}

pub fn getOrigin(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(VirtualMachine.vm.origin.origin).toValue(ctx.ptr()).asRef();
}

pub fn getStdin(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("BunSTDIN"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stdin();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            ZigString.static("BunSTDIN"),
            blob.toJS(ctx),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub fn getStderr(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("BunSTDERR"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stderr();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            ZigString.static("BunSTDERR"),
            blob.toJS(ctx),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub fn getStdout(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("BunSTDOUT"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stdout();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            &ZigString.init("BunSTDOUT"),
            blob.toJS(ctx),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub fn enableANSIColors(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return js.JSValueMakeBoolean(ctx, Output.enable_ansi_colors);
}
pub fn getMain(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(VirtualMachine.vm.main).toValue(ctx.ptr()).asRef();
}

pub fn getAssetPrefix(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ZigString.init(VirtualMachine.vm.bundler.options.routes.asset_prefix_path).toValue(ctx.ptr()).asRef();
}

pub fn getArgv(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (comptime Environment.isWindows) {
        @compileError("argv not supported on windows");
    }

    var argv_list = std.heap.stackFallback(128, getAllocator(ctx));
    var allocator = argv_list.get();
    var argv = allocator.alloc(ZigString, std.os.argv.len) catch unreachable;
    defer if (argv.len > 128) allocator.free(argv);
    for (std.os.argv) |arg, i| {
        argv[i] = ZigString.init(std.mem.span(arg));
    }

    return JSValue.createStringArray(ctx.ptr(), argv.ptr, argv.len, true).asObjectRef();
}

pub fn getRoutesDir(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (!VirtualMachine.vm.bundler.options.routes.routes_enabled or VirtualMachine.vm.bundler.options.routes.dir.len == 0) {
        return js.JSValueMakeUndefined(ctx);
    }

    return ZigString.init(VirtualMachine.vm.bundler.options.routes.dir).toValue(ctx.ptr()).asRef();
}

pub fn getFilePath(ctx: js.JSContextRef, arguments: []const js.JSValueRef, buf: []u8, exception: js.ExceptionRef) ?string {
    if (arguments.len != 1) {
        JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
        return null;
    }

    const value = arguments[0];
    if (js.JSValueIsString(ctx, value)) {
        var out = ZigString.Empty;
        JSValue.toZigString(JSValue.fromRef(value), &out, ctx.ptr());
        var out_slice = out.slice();

        // The dots are kind of unnecessary. They'll be normalized.
        if (out.len == 0 or @ptrToInt(out.ptr) == 0 or std.mem.eql(u8, out_slice, ".") or std.mem.eql(u8, out_slice, "..") or std.mem.eql(u8, out_slice, "../")) {
            JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
            return null;
        }

        var parts = [_]string{out_slice};
        // This does the equivalent of Node's path.normalize(path.join(cwd, out_slice))
        var res = VirtualMachine.vm.bundler.fs.absBuf(&parts, buf);

        return res;
    } else if (js.JSValueIsArray(ctx, value)) {
        var temp_strings_list: [32]string = undefined;
        var temp_strings_list_len: u8 = 0;
        defer {
            for (temp_strings_list[0..temp_strings_list_len]) |_, i| {
                temp_strings_list[i] = "";
            }
        }

        var iter = JSValue.fromRef(value).arrayIterator(ctx.ptr());
        while (iter.next()) |item| {
            if (temp_strings_list_len >= temp_strings_list.len) {
                break;
            }

            if (!item.isString()) {
                JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                return null;
            }

            var out = ZigString.Empty;
            JSValue.toZigString(item, &out, ctx.ptr());
            const out_slice = out.slice();

            temp_strings_list[temp_strings_list_len] = out_slice;
            // The dots are kind of unnecessary. They'll be normalized.
            if (out.len == 0 or @ptrToInt(out.ptr) == 0 or std.mem.eql(u8, out_slice, ".") or std.mem.eql(u8, out_slice, "..") or std.mem.eql(u8, out_slice, "../")) {
                JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
                return null;
            }
            temp_strings_list_len += 1;
        }

        if (temp_strings_list_len == 0) {
            JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
            return null;
        }

        return VirtualMachine.vm.bundler.fs.absBuf(temp_strings_list[0..temp_strings_list_len], buf);
    } else {
        JSError(getAllocator(ctx), "Expected a file path as a string or an array of strings to be part of a file path.", .{}, ctx, exception);
        return null;
    }
}

pub fn getImportedStyles(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    defer flushCSSImports();
    const styles = getCSSImports();
    if (styles.len == 0) {
        return js.JSObjectMakeArray(ctx, 0, null, null);
    }

    return JSValue.createStringArray(ctx.ptr(), styles.ptr, styles.len, true).asRef();
}

pub fn newOs(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return Node.Os.create(ctx.ptr()).asObjectRef();
}

pub fn newPath(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    args: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    const is_windows = args.len == 1 and JSValue.fromRef(args[0]).toBoolean();
    return Node.Path.create(ctx.ptr(), is_windows).asObjectRef();
}

pub fn readFileAsStringCallback(
    ctx: js.JSContextRef,
    buf_z: [:0]const u8,
    exception: js.ExceptionRef,
) js.JSValueRef {
    const path = buf_z.ptr[0..buf_z.len];
    var file = std.fs.cwd().openFileZ(buf_z, .{ .mode = .read_only }) catch |err| {
        JSError(getAllocator(ctx), "Opening file {s} for path: \"{s}\"", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    defer file.close();

    const stat = file.stat() catch |err| {
        JSError(getAllocator(ctx), "Getting file size {s} for \"{s}\"", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    if (stat.kind != .File) {
        JSError(getAllocator(ctx), "Can't read a {s} as a string (\"{s}\")", .{ @tagName(stat.kind), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }

    var contents_buf = VirtualMachine.vm.allocator.alloc(u8, stat.size + 2) catch unreachable; // OOM
    defer VirtualMachine.vm.allocator.free(contents_buf);
    const contents_len = file.readAll(contents_buf) catch |err| {
        JSError(getAllocator(ctx), "{s} reading file (\"{s}\")", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    contents_buf[contents_len] = 0;

    // Very slow to do it this way. We're copying the string twice.
    // But it's important that this string is garbage collected instead of manually managed.
    // We can't really recycle this one.
    // TODO: use external string
    return js.JSValueMakeString(ctx, js.JSStringCreateWithUTF8CString(contents_buf.ptr));
}

pub fn readFileAsBytesCallback(
    ctx: js.JSContextRef,
    buf_z: [:0]const u8,
    exception: js.ExceptionRef,
) js.JSValueRef {
    const path = buf_z.ptr[0..buf_z.len];

    var file = std.fs.cwd().openFileZ(buf_z, .{ .mode = .read_only }) catch |err| {
        JSError(getAllocator(ctx), "Opening file {s} for path: \"{s}\"", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    defer file.close();

    const stat = file.stat() catch |err| {
        JSError(getAllocator(ctx), "Getting file size {s} for \"{s}\"", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    if (stat.kind != .File) {
        JSError(getAllocator(ctx), "Can't read a {s} as a string (\"{s}\")", .{ @tagName(stat.kind), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }

    var contents_buf = VirtualMachine.vm.allocator.alloc(u8, stat.size + 2) catch unreachable; // OOM
    errdefer VirtualMachine.vm.allocator.free(contents_buf);
    const contents_len = file.readAll(contents_buf) catch |err| {
        JSError(getAllocator(ctx), "{s} reading file (\"{s}\")", .{ @errorName(err), path }, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    };

    contents_buf[contents_len] = 0;

    var marked_array_buffer = VirtualMachine.vm.allocator.create(MarkedArrayBuffer) catch unreachable;
    marked_array_buffer.* = MarkedArrayBuffer.fromBytes(
        contents_buf[0..contents_len],
        VirtualMachine.vm.allocator,
        .Uint8Array,
    );

    return marked_array_buffer.toJSObjectRef(ctx, exception);
}

pub fn getRouteFiles(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (VirtualMachine.vm.bundler.router == null) return js.JSObjectMakeArray(ctx, 0, null, null);

    const router = &VirtualMachine.vm.bundler.router.?;
    const list = router.getPublicPaths() catch unreachable;

    for (routes_list_strings[0..@minimum(list.len, routes_list_strings.len)]) |_, i| {
        routes_list_strings[i] = ZigString.init(list[i]);
    }

    const ref = JSValue.createStringArray(ctx.ptr(), &routes_list_strings, list.len, true).asRef();
    return ref;
}

pub fn getRouteNames(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (VirtualMachine.vm.bundler.router == null) return js.JSObjectMakeArray(ctx, 0, null, null);

    const router = &VirtualMachine.vm.bundler.router.?;
    const list = router.getNames() catch unreachable;

    for (routes_list_strings[0..@minimum(list.len, routes_list_strings.len)]) |_, i| {
        routes_list_strings[i] = ZigString.init(list[i]);
    }

    const ref = JSValue.createStringArray(ctx.ptr(), &routes_list_strings, list.len, true).asRef();
    return ref;
}

const Editor = @import("../../open.zig").Editor;
pub fn openInEditor(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    args: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var edit = &VirtualMachine.vm.rareData().editor_context;

    var arguments = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), args);
    defer arguments.deinit();
    var path: string = "";
    var editor_choice: ?Editor = null;
    var line: ?string = null;
    var column: ?string = null;

    if (arguments.nextEat()) |file_path_| {
        path = file_path_.toSlice(ctx.ptr(), bun.default_allocator).slice();
    }

    if (arguments.nextEat()) |opts| {
        if (!opts.isUndefinedOrNull()) {
            if (opts.getTruthy(ctx.ptr(), "editor")) |editor_val| {
                var sliced = editor_val.toSlice(ctx.ptr(), bun.default_allocator);
                var prev_name = edit.name;

                if (!strings.eqlLong(prev_name, sliced.slice(), true)) {
                    var prev = edit.*;
                    edit.name = sliced.slice();
                    edit.detectEditor(VirtualMachine.vm.bundler.env);
                    editor_choice = edit.editor;
                    if (editor_choice == null) {
                        edit.* = prev;
                        JSError(getAllocator(ctx), "Could not find editor \"{s}\"", .{sliced.slice()}, ctx, exception);
                        return js.JSValueMakeUndefined(ctx);
                    } else if (edit.name.ptr == edit.path.ptr) {
                        edit.name = bun.default_allocator.dupe(u8, edit.path) catch unreachable;
                        edit.path = edit.path;
                    }
                }
            }

            if (opts.getTruthy(ctx.ptr(), "line")) |line_| {
                line = line_.toSlice(ctx.ptr(), bun.default_allocator).slice();
            }

            if (opts.getTruthy(ctx.ptr(), "column")) |column_| {
                column = column_.toSlice(ctx.ptr(), bun.default_allocator).slice();
            }
        }
    }

    const editor = editor_choice orelse edit.editor orelse brk: {
        edit.autoDetectEditor(VirtualMachine.vm.bundler.env);
        if (edit.editor == null) {
            JSC.JSError(bun.default_allocator, "Failed to auto-detect editor", .{}, ctx, exception);
            return null;
        }

        break :brk edit.editor.?;
    };

    if (path.len == 0) {
        JSError(getAllocator(ctx), "No file path specified", .{}, ctx, exception);
        return js.JSValueMakeUndefined(ctx);
    }

    editor.open(edit.path, path, line, column, bun.default_allocator) catch |err| {
        JSC.JSError(bun.default_allocator, "Opening editor failed {s}", .{@errorName(err)}, ctx, exception);
        return null;
    };

    return JSC.JSValue.jsUndefined().asObjectRef();
}

pub fn readFileAsBytes(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    const path = getFilePath(ctx, arguments, &buf, exception) orelse return null;
    buf[path.len] = 0;

    const buf_z: [:0]const u8 = buf[0..path.len :0];
    const result = readFileAsBytesCallback(ctx, buf_z, exception);
    return result;
}

pub fn readFileAsString(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    const path = getFilePath(ctx, arguments, &buf, exception) orelse return null;
    buf[path.len] = 0;

    const buf_z: [:0]const u8 = buf[0..path.len :0];
    const result = readFileAsStringCallback(ctx, buf_z, exception);
    return result;
}

pub fn getPublicPath(to: string, origin: URL, comptime Writer: type, writer: Writer) void {
    const relative_path = VirtualMachine.vm.bundler.fs.relativeTo(to);
    if (origin.isAbsolute()) {
        if (strings.hasPrefix(relative_path, "..") or strings.hasPrefix(relative_path, "./")) {
            writer.writeAll(origin.origin) catch return;
            writer.writeAll("/abs:") catch return;
            if (std.fs.path.isAbsolute(to)) {
                writer.writeAll(to) catch return;
            } else {
                writer.writeAll(VirtualMachine.vm.bundler.fs.abs(&[_]string{to})) catch return;
            }
        } else {
            origin.joinWrite(
                Writer,
                writer,
                VirtualMachine.vm.bundler.options.routes.asset_prefix_path,
                "",
                relative_path,
                "",
            ) catch return;
        }
    } else {
        writer.writeAll(std.mem.trimLeft(u8, relative_path, "/")) catch unreachable;
    }
}

pub fn sleepSync(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    if (js.JSValueIsNumber(ctx, arguments[0])) {
        const seconds = JSValue.fromRef(arguments[0]).asNumber();
        if (seconds > 0 and std.math.isFinite(seconds)) std.time.sleep(@floatToInt(u64, seconds * 1000) * std.time.ns_per_ms);
    }

    return js.JSValueMakeUndefined(ctx);
}

pub fn createNodeFS(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return Node.NodeFSBindings.make(
        ctx,
        VirtualMachine.vm.nodeFS(),
    );
}

pub fn generateHeapSnapshot(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    return ctx.ptr().generateHeapSnapshot().asObjectRef();
}

pub fn runGC(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    // it should only force cleanup on thread exit

    Global.mimalloc_cleanup(false);

    return ctx.ptr().vm().runGC(arguments.len > 0 and JSValue.fromRef(arguments[0]).toBoolean()).asRef();
}

pub fn shrink(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    ctx.ptr().vm().shrinkFootprint();
    return JSValue.jsUndefined().asRef();
}

fn doResolve(
    ctx: js.JSContextRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) ?JSC.JSValue {
    var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
    defer args.deinit();
    const specifier = args.protectEatNext() orelse {
        JSC.throwInvalidArguments("Expected a specifier and a from path", .{}, ctx, exception);
        return null;
    };

    if (specifier.isUndefinedOrNull()) {
        JSC.throwInvalidArguments("specifier must be a string", .{}, ctx, exception);
        return null;
    }

    const from = args.protectEatNext() orelse {
        JSC.throwInvalidArguments("Expected a from path", .{}, ctx, exception);
        return null;
    };

    if (from.isUndefinedOrNull()) {
        JSC.throwInvalidArguments("from must be a string", .{}, ctx, exception);
        return null;
    }

    return doResolveWithArgs(ctx, specifier.getZigString(ctx.ptr()), from.getZigString(ctx.ptr()), exception, false);
}

fn doResolveWithArgs(
    ctx: js.JSContextRef,
    specifier: ZigString,
    from: ZigString,
    exception: js.ExceptionRef,
    comptime is_file_path: bool,
) ?JSC.JSValue {
    var errorable: ErrorableZigString = undefined;

    if (comptime is_file_path) {
        VirtualMachine.resolveFilePathForAPI(
            &errorable,
            ctx.ptr(),
            specifier,
            from,
        );
    } else {
        VirtualMachine.resolveForAPI(
            &errorable,
            ctx.ptr(),
            specifier,
            from,
        );
    }

    if (!errorable.success) {
        exception.* = bun.cast(JSC.JSValueRef, errorable.result.err.ptr.?);
        return null;
    }

    return errorable.result.value.toValue(ctx.ptr());
}

pub fn resolveSync(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    const value = doResolve(ctx, arguments, exception) orelse return null;
    return value.asObjectRef();
}

pub fn resolve(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    const value = doResolve(ctx, arguments, exception) orelse {
        var exception_value = exception.*.?;
        exception.* = null;
        return JSC.JSPromise.rejectedPromiseValue(ctx.ptr(), JSC.JSValue.fromRef(exception_value)).asObjectRef();
    };
    return JSC.JSPromise.resolvedPromiseValue(ctx.ptr(), value).asObjectRef();
}

export fn Bun__resolve(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    const value = doResolveWithArgs(global.ref(), specifier.getZigString(global), source.getZigString(global), exception, true) orelse {
        return JSC.JSPromise.rejectedPromiseValue(global, JSC.JSValue.fromRef(exception[0]));
    };
    return JSC.JSPromise.resolvedPromiseValue(global, value);
}

export fn Bun__resolveSync(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    return doResolveWithArgs(global.ref(), specifier.getZigString(global), source.getZigString(global), exception, true) orelse {
        return JSC.JSValue.fromRef(exception[0]);
    };
}

comptime {
    if (!is_bindgen) {
        _ = Bun__resolve;
        _ = Bun__resolveSync;
    }
}

pub fn readAllStdinSync(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    _: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var stack = std.heap.stackFallback(2048, getAllocator(ctx));
    var allocator = stack.get();

    var stdin = std.io.getStdIn();
    var result = stdin.readToEndAlloc(allocator, std.math.maxInt(u32)) catch |err| {
        JSError(undefined, "{s} reading stdin", .{@errorName(err)}, ctx, exception);
        return null;
    };
    var out = ZigString.init(result);
    out.detectEncoding();
    return out.toValueGC(ctx.ptr()).asObjectRef();
}

var public_path_temp_str: [bun.MAX_PATH_BYTES]u8 = undefined;

pub fn getPublicPathJS(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var zig_str: ZigString = ZigString.Empty;
    JSValue.toZigString(JSValue.fromRef(arguments[0]), &zig_str, ctx.ptr());

    const to = zig_str.slice();

    var stream = std.io.fixedBufferStream(&public_path_temp_str);
    var writer = stream.writer();
    getPublicPath(to, VirtualMachine.vm.origin, @TypeOf(&writer), &writer);

    return ZigString.init(stream.buffer[0..stream.pos]).toValueGC(ctx.ptr()).asObjectRef();
}

pub const Class = NewClass(
    void,
    .{
        .name = "Bun",
        .read_only = true,
    },
    .{
        .match = .{
            .rfn = Router.match,
        },
        .sleepSync = .{
            .rfn = sleepSync,
        },
        .fetch = .{
            .rfn = Fetch.call,
        },
        .getImportedStyles = .{
            .rfn = Bun.getImportedStyles,
        },
        .inspect = .{
            .rfn = Bun.inspect,
        },
        .getRouteFiles = .{
            .rfn = Bun.getRouteFiles,
        },
        ._Os = .{
            .rfn = Bun.newOs,
        },
        ._Path = .{
            .rfn = Bun.newPath,
        },
        .getRouteNames = .{
            .rfn = Bun.getRouteNames,
        },
        .readFile = .{
            .rfn = Bun.readFileAsString,
        },
        .resolveSync = .{
            .rfn = Bun.resolveSync,
        },
        .resolve = .{
            .rfn = Bun.resolve,
        },
        .readFileBytes = .{
            .rfn = Bun.readFileAsBytes,
        },
        .getPublicPath = .{
            .rfn = Bun.getPublicPathJS,
        },
        .registerMacro = .{
            .rfn = Bun.registerMacro,
            .enumerable = false,
        },
        .fs = .{
            .rfn = Bun.createNodeFS,
            .enumerable = false,
        },
        .jest = .{
            .rfn = @import("../test/jest.zig").Jest.call,
            .enumerable = false,
        },
        .gc = .{
            .rfn = Bun.runGC,
        },
        .allocUnsafe = .{
            .rfn = Bun.allocUnsafe,
        },
        .mmap = .{
            .rfn = Bun.mmapFile,
        },
        .generateHeapSnapshot = .{
            .rfn = Bun.generateHeapSnapshot,
        },
        .shrink = .{
            .rfn = Bun.shrink,
        },
        .openInEditor = .{
            .rfn = Bun.openInEditor,
        },
        .readAllStdinSync = .{
            .rfn = Bun.readAllStdinSync,
        },
        .serve = .{
            .rfn = Bun.serve,
        },
        .file = .{
            .rfn = JSC.WebCore.Blob.constructFile,
        },
        .write = .{
            .rfn = JSC.WebCore.Blob.writeFile,
        },
        .sha = .{
            .rfn = JSC.wrapWithHasContainer(Crypto.SHA512_256, "hash_", false, false, true),
        },
        .nanoseconds = .{
            .rfn = nanoseconds,
        },
        .DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump = .{
            .rfn = dump_mimalloc,
        },
        .gzipSync = .{
            .rfn = JSC.wrapWithHasContainer(JSZlib, "gzipSync", false, false, true),
        },
        .deflateSync = .{
            .rfn = JSC.wrapWithHasContainer(JSZlib, "deflateSync", false, false, true),
        },
        .gunzipSync = .{
            .rfn = JSC.wrapWithHasContainer(JSZlib, "gunzipSync", false, false, true),
        },
        .inflateSync = .{
            .rfn = JSC.wrapWithHasContainer(JSZlib, "inflateSync", false, false, true),
        },

        .which = .{
            .rfn = which,
        },
        .spawn = .{
            .rfn = JSC.wrapWithHasContainer(Subprocess, "spawn", false, false, false),
        },
    },
    .{
        .main = .{
            .get = getMain,
        },
        .cwd = .{
            .get = getCWD,
        },
        .origin = .{
            .get = getOrigin,
        },
        .stdin = .{
            .get = getStdin,
        },
        .stdout = .{
            .get = getStdout,
        },
        .stderr = .{
            .get = getStderr,
        },
        .routesDir = .{
            .get = getRoutesDir,
        },
        .assetPrefix = .{
            .get = getAssetPrefix,
        },
        .argv = .{
            .get = getArgv,
        },
        .env = .{
            .get = EnvironmentVariables.getter,
        },

        .enableANSIColors = .{
            .get = enableANSIColors,
        },
        .Transpiler = .{
            .get = getTranspilerConstructor,
        },
        .hash = .{
            .get = getHashObject,
        },
        .TOML = .{
            .get = getTOMLObject,
        },
        .unsafe = .{
            .get = getUnsafe,
        },
        .SHA1 = .{
            .get = Crypto.SHA1.getter,
        },
        .MD5 = .{
            .get = Crypto.MD5.getter,
        },
        .MD4 = .{
            .get = Crypto.MD4.getter,
        },
        .SHA224 = .{
            .get = Crypto.SHA224.getter,
        },
        .SHA512 = .{
            .get = Crypto.SHA512.getter,
        },
        .SHA384 = .{
            .get = Crypto.SHA384.getter,
        },
        .SHA256 = .{
            .get = Crypto.SHA256.getter,
        },
        .SHA512_256 = .{
            .get = Crypto.SHA512_256.getter,
        },
        .FFI = .{
            .get = FFI.getter,
        },
    },
);

fn dump_mimalloc(
    _: void,
    globalThis: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    _: []const JSC.C.JSValueRef,
    _: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    globalThis.bunVM().arena.dumpThreadStats();
    return JSC.JSValue.jsUndefined().asObjectRef();
}

pub const Crypto = struct {
    const Hashers = @import("../../sha.zig");

    fn CryptoHasher(comptime Hasher: type, name: [:0]const u8) type {
        return struct {
            hashing: Hasher = Hasher{},

            const ThisHasher = @This();

            pub usingnamespace @field(JSC.Codegen, "JS" ++ name);

            pub const digest = JSC.wrapInstanceMethod(ThisHasher, "digest_", false);
            pub const hash = JSC.wrapStaticMethod(ThisHasher, "hash_", false);

            pub fn getByteLength(
                _: *@This(),
                _: *JSC.JSGlobalObject,
            ) callconv(.C) JSC.JSValue {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
            }

            pub fn getByteLengthStatic(
                _: *JSC.JSGlobalObject,
                _: JSValue,
                _: JSValue,
            ) callconv(.C) JSC.JSValue {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
            }

            fn hashToEncoding(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                encoding: JSC.Node.Encoding,
            ) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;

                Hasher.hash(input.slice(), &output_digest_buf, JSC.VirtualMachine.vm.rareData().boringEngine());

                return encoding.encodeWithSize(globalThis, Hasher.digest, &output_digest_buf);
            }

            fn hashToBytes(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                output: ?JSC.ArrayBuffer,
            ) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                        return JSC.JSValue.zero;
                    }
                    output_digest_slice = bytes[0..Hasher.digest];
                }

                Hasher.hash(input.slice(), output_digest_slice, JSC.VirtualMachine.vm.rareData().boringEngine());

                if (output) |output_buf| {
                    return output_buf.value;
                } else {
                    var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, output_digest_slice) catch unreachable, .Uint8Array);
                    return array_buffer_out.toJSUnchecked(globalThis.ref(), null);
                }
            }

            pub fn hash_(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                output: ?JSC.Node.StringOrBuffer,
            ) JSC.JSValue {
                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        .string => |str| {
                            const encoding = JSC.Node.Encoding.from(str) orelse {
                                globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str});
                                return JSC.JSValue.zero;
                            };

                            return hashToEncoding(globalThis, input, encoding);
                        },
                        .buffer => |buffer| {
                            return hashToBytes(globalThis, input, buffer.buffer);
                        },
                    }
                } else {
                    return hashToBytes(globalThis, input, null);
                }
            }

            pub fn constructor(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*@This() {
                var this = bun.default_allocator.create(@This()) catch return null;

                this.* = .{ .hashing = Hasher.init() };
                return this;
            }

            pub fn getter(
                _: void,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSValueRef {
                return ThisHasher.getConstructor(ctx).asObjectRef();
            }

            pub fn update(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                const thisValue = callframe.this();
                const input = callframe.argument(0);
                const buffer = JSC.Node.SliceOrBuffer.fromJS(globalThis.ptr(), globalThis.bunVM().allocator, input) orelse {
                    globalThis.throwInvalidArguments("expected string or buffer", .{});
                    return JSC.JSValue.zero;
                };
                defer buffer.deinit();
                this.hashing.update(buffer.slice());
                return thisValue;
            }

            pub fn digest_(
                this: *@This(),
                globalThis: *JSGlobalObject,
                output: ?JSC.Node.StringOrBuffer,
            ) JSC.JSValue {
                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        .string => |str| {
                            const encoding = JSC.Node.Encoding.from(str) orelse {
                                globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str});
                                return JSC.JSValue.zero;
                            };

                            return this.digestToEncoding(globalThis, encoding);
                        },
                        .buffer => |buffer| {
                            return this.digestToBytes(
                                globalThis,
                                buffer.buffer,
                            );
                        },
                    }
                } else {
                    return this.digestToBytes(globalThis, null);
                }
            }

            fn digestToBytes(this: *@This(), globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                        return JSC.JSValue.zero;
                    }
                    output_digest_slice = bytes[0..Hasher.digest];
                } else {
                    output_digest_buf = comptime brk: {
                        var bytes: Hasher.Digest = undefined;
                        var i: usize = 0;
                        while (i < Hasher.digest) {
                            bytes[i] = 0;
                            i += 1;
                        }
                        break :brk bytes;
                    };
                }

                this.hashing.final(output_digest_slice);

                if (output) |output_buf| {
                    return output_buf.value;
                } else {
                    var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, &output_digest_buf) catch unreachable, .Uint8Array);
                    return array_buffer_out.toJSUnchecked(globalThis.ref(), null);
                }
            }

            fn digestToEncoding(this: *@This(), globalThis: *JSGlobalObject, encoding: JSC.Node.Encoding) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = comptime brk: {
                    var bytes: Hasher.Digest = undefined;
                    var i: usize = 0;
                    while (i < Hasher.digest) {
                        bytes[i] = 0;
                        i += 1;
                    }
                    break :brk bytes;
                };

                var output_digest_slice: *Hasher.Digest = &output_digest_buf;

                this.hashing.final(output_digest_slice);

                return encoding.encodeWithSize(globalThis, Hasher.digest, output_digest_slice);
            }

            pub fn finalize(this: *@This()) callconv(.C) void {
                VirtualMachine.vm.allocator.destroy(this);
            }
        };
    }

    pub const SHA1 = CryptoHasher(Hashers.SHA1, "SHA1");
    pub const MD5 = CryptoHasher(Hashers.MD5, "MD5");
    pub const MD4 = CryptoHasher(Hashers.MD4, "MD4");
    pub const SHA224 = CryptoHasher(Hashers.SHA224, "SHA224");
    pub const SHA512 = CryptoHasher(Hashers.SHA512, "SHA512");
    pub const SHA384 = CryptoHasher(Hashers.SHA384, "SHA384");
    pub const SHA256 = CryptoHasher(Hashers.SHA256, "SHA256");
    pub const SHA512_256 = CryptoHasher(Hashers.SHA512_256, "SHA512_256");
};

pub fn nanoseconds(
    _: void,
    _: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    _: []const JSC.C.JSValueRef,
    _: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    const ns = JSC.VirtualMachine.vm.origin_timer.read();
    return JSC.JSValue.jsNumberFromUint64(ns).asObjectRef();
}

pub fn serve(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
    var config = JSC.API.ServerConfig.fromJS(ctx.ptr(), &args, exception);
    if (exception.* != null) {
        return null;
    }

    // Listen happens on the next tick!
    // This is so we can return a Server object
    if (config.ssl_config != null) {
        if (config.development) {
            var server = JSC.API.DebugSSLServer.init(config, ctx.ptr());
            server.listen();
            if (!server.thisObject.isEmpty()) {
                exception.* = server.thisObject.asObjectRef();
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return null;
            }
            var obj = JSC.API.DebugSSLServer.Class.make(ctx, server);
            JSC.C.JSValueProtect(ctx, obj);
            server.thisObject = JSValue.c(obj);
            return obj;
        } else {
            var server = JSC.API.SSLServer.init(config, ctx.ptr());
            server.listen();
            if (!server.thisObject.isEmpty()) {
                exception.* = server.thisObject.asObjectRef();
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return null;
            }
            var obj = JSC.API.SSLServer.Class.make(ctx, server);
            JSC.C.JSValueProtect(ctx, obj);
            server.thisObject = JSValue.c(obj);
            return obj;
        }
    } else {
        if (config.development) {
            var server = JSC.API.DebugServer.init(config, ctx.ptr());
            server.listen();
            if (!server.thisObject.isEmpty()) {
                exception.* = server.thisObject.asObjectRef();
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return null;
            }
            var obj = JSC.API.DebugServer.Class.make(ctx, server);
            JSC.C.JSValueProtect(ctx, obj);
            server.thisObject = JSValue.c(obj);
            return obj;
        } else {
            var server = JSC.API.Server.init(config, ctx.ptr());
            server.listen();
            if (!server.thisObject.isEmpty()) {
                exception.* = server.thisObject.asObjectRef();
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return null;
            }
            var obj = JSC.API.Server.Class.make(ctx, server);
            JSC.C.JSValueProtect(ctx, obj);
            server.thisObject = JSValue.c(obj);
            return obj;
        }
    }

    unreachable;
}

pub export fn Bun__escapeHTML16(globalObject: *JSC.JSGlobalObject, input_value: JSValue, ptr: [*]const u16, len: usize) JSValue {
    std.debug.assert(len > 0);
    const input_slice = ptr[0..len];
    const escaped = strings.escapeHTMLForUTF16Input(globalObject.bunVM().allocator, input_slice) catch {
        globalObject.vm().throwError(globalObject, ZigString.init("Out of memory").toValue(globalObject));
        return JSC.JSValue.jsUndefined();
    };

    switch (escaped) {
        .static => |val| {
            return ZigString.init(val).toValue(globalObject);
        },
        .original => return input_value,
        .allocated => |escaped_html| {
            if (comptime Environment.allow_assert) {
                // assert that re-encoding the string produces the same result
                std.debug.assert(
                    std.mem.eql(
                        u16,
                        (strings.toUTF16Alloc(bun.default_allocator, strings.toUTF8Alloc(bun.default_allocator, escaped_html) catch unreachable, false) catch unreachable).?,
                        escaped_html,
                    ),
                );

                // assert we do not allocate a new string unnecessarily
                std.debug.assert(
                    !std.mem.eql(
                        u16,
                        input_slice,
                        escaped_html,
                    ),
                );

                // the output should always be longer than the input
                std.debug.assert(escaped_html.len > input_slice.len);
            }

            return ZigString.from16(escaped_html.ptr, escaped_html.len).toExternalValue(globalObject);
        },
    }
}

pub export fn Bun__escapeHTML8(globalObject: *JSC.JSGlobalObject, input_value: JSValue, ptr: [*]const u8, len: usize) JSValue {
    std.debug.assert(len > 0);

    const input_slice = ptr[0..len];
    var stack_allocator = std.heap.stackFallback(256, globalObject.bunVM().allocator);
    const allocator = if (input_slice.len <= 32) stack_allocator.get() else stack_allocator.fallback_allocator;

    const escaped = strings.escapeHTMLForLatin1Input(allocator, input_slice) catch {
        globalObject.vm().throwError(globalObject, ZigString.init("Out of memory").toValue(globalObject));
        return JSC.JSValue.jsUndefined();
    };

    switch (escaped) {
        .static => |val| {
            return ZigString.init(val).toValue(globalObject);
        },
        .original => return input_value,
        .allocated => |escaped_html| {
            if (comptime Environment.allow_assert) {
                // the output should always be longer than the input
                std.debug.assert(escaped_html.len > input_slice.len);

                // assert we do not allocate a new string unnecessarily
                std.debug.assert(
                    !std.mem.eql(
                        u8,
                        input_slice,
                        escaped_html,
                    ),
                );
            }

            if (input_slice.len <= 32) {
                const zig_str = ZigString.init(escaped_html);
                const out = zig_str.toAtomicValue(globalObject);
                return out;
            }

            return ZigString.init(escaped_html).toExternalValue(globalObject);
        },
    }
}

comptime {
    if (!JSC.is_bindgen) {
        _ = Bun__escapeHTML8;
        _ = Bun__escapeHTML16;
    }
}

pub fn allocUnsafe(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);

    const length = @intCast(
        usize,
        @minimum(
            @maximum(1, (args.nextEat() orelse JSC.JSValue.jsNumber(@as(i32, 1))).toInt32()),
            std.math.maxInt(i32),
        ),
    );
    var bytes = bun.default_allocator.alloc(u8, length) catch {
        JSC.JSError(bun.default_allocator, "OOM! Out of memory", .{}, ctx, exception);
        return null;
    };

    return JSC.MarkedArrayBuffer.fromBytes(
        bytes,
        bun.default_allocator,
        .Uint8Array,
    ).toJSObjectRef(ctx, null);
}

pub fn mmapFile(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);

    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    const path = getFilePath(ctx, arguments[0..@minimum(1, arguments.len)], &buf, exception) orelse return null;
    args.eat();

    buf[path.len] = 0;

    const buf_z: [:0]const u8 = buf[0..path.len :0];

    const sync_flags: u32 = if (@hasDecl(std.os.MAP, "SYNC")) std.os.MAP.SYNC | std.os.MAP.SHARED_VALIDATE else 0;
    const file_flags: u32 = if (@hasDecl(std.os.MAP, "FILE")) std.os.MAP.FILE else 0;

    // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
    var offset: usize = 0;
    var flags = file_flags;
    var map_size: ?usize = null;

    if (args.nextEat()) |opts| {
        const sync = opts.get(ctx.ptr(), "sync") orelse JSC.JSValue.jsBoolean(false);
        const shared = opts.get(ctx.ptr(), "shared") orelse JSC.JSValue.jsBoolean(true);
        flags |= @as(u32, if (sync.toBoolean()) sync_flags else 0);
        flags |= @as(u32, if (shared.toBoolean()) std.os.MAP.SHARED else std.os.MAP.PRIVATE);

        if (opts.get(ctx.ptr(), "size")) |value| {
            map_size = @intCast(usize, value.toInt64());
        }

        if (opts.get(ctx.ptr(), "offset")) |value| {
            offset = @intCast(usize, value.toInt64());
            offset = std.mem.alignBackwardAnyAlign(offset, std.mem.page_size);
        }
    } else {
        flags |= std.os.MAP.SHARED;
    }

    const map = switch (JSC.Node.Syscall.mmapFile(buf_z, flags, map_size, offset)) {
        .result => |map| map,

        .err => |err| {
            exception.* = err.toJS(ctx);
            return null;
        },
    };

    return JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(ctx, JSC.C.JSTypedArrayType.kJSTypedArrayTypeUint8Array, @ptrCast(?*anyopaque, map.ptr), map.len, struct {
        pub fn x(ptr: ?*anyopaque, size: ?*anyopaque) callconv(.C) void {
            _ = JSC.Node.Syscall.munmap(@ptrCast([*]align(std.mem.page_size) u8, @alignCast(std.mem.page_size, ptr))[0..@ptrToInt(size)]);
        }
    }.x, @intToPtr(?*anyopaque, map.len), exception);
}

pub fn getTranspilerConstructor(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("BunTranspiler"));
    if (existing.isEmpty()) {
        return ctx.ptr().putCachedObject(
            &ZigString.init("BunTranspiler"),
            JSC.JSValue.fromRef(Transpiler.Constructor.constructor(ctx)),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub fn getHashObject(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("BunHash"));
    if (existing.isEmpty()) {
        return ctx.ptr().putCachedObject(
            &ZigString.init("BunHash"),
            JSC.JSValue.fromRef(JSC.C.JSObjectMake(ctx, Hash.Class.get().*, null)),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub const Hash = struct {
    pub const Class = NewClass(
        void,
        .{
            .name = "Hash",
        },
        .{
            .call = .{
                .rfn = call,
            },
            .wyhash = .{
                .rfn = hashWrap(std.hash.Wyhash).hash,
            },
            .adler32 = .{
                .rfn = hashWrap(std.hash.Adler32).hash,
            },
            .crc32 = .{
                .rfn = hashWrap(std.hash.Crc32).hash,
            },
            .cityHash32 = .{
                .rfn = hashWrap(std.hash.CityHash32).hash,
            },
            .cityHash64 = .{
                .rfn = hashWrap(std.hash.CityHash64).hash,
            },
            .murmur32v2 = .{
                .rfn = hashWrap(std.hash.murmur.Murmur2_32).hash,
            },
            .murmur32v3 = .{
                .rfn = hashWrap(std.hash.murmur.Murmur3_32).hash,
            },
            .murmur64v2 = .{
                .rfn = hashWrap(std.hash.murmur.Murmur2_64).hash,
            },
        },
        .{},
    );

    pub fn call(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSObjectRef {
        return hashWrap(std.hash.Wyhash).hash(void{}, ctx, null, null, arguments, exception);
    }
    fn hashWrap(comptime Hasher: anytype) type {
        return struct {
            pub fn hash(
                _: void,
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                var args = JSC.Node.ArgumentsSlice.from(ctx.bunVM(), arguments);
                var input: []const u8 = "";
                var input_slice = ZigString.Slice.empty;
                defer input_slice.deinit();
                if (args.nextEat()) |arg| {
                    if (arg.as(JSC.WebCore.Blob)) |blob| {
                        // TODO: files
                        input = blob.sharedView();
                    } else {
                        switch (arg.jsTypeLoose()) {
                            .ArrayBuffer, .Int8Array, .Uint8Array, .Uint8ClampedArray, .Int16Array, .Uint16Array, .Int32Array, .Uint32Array, .Float32Array, .Float64Array, .BigInt64Array, .BigUint64Array, .DataView => {
                                var array_buffer = arg.asArrayBuffer(ctx.ptr()) orelse {
                                    JSC.throwInvalidArguments("ArrayBuffer conversion error", .{}, ctx, exception);
                                    return null;
                                };
                                input = array_buffer.slice();
                            },
                            else => {
                                input_slice = arg.toSlice(ctx.ptr(), bun.default_allocator);
                                input = input_slice.slice();
                            },
                        }
                    }
                }

                // std.hash has inconsistent interfaces
                //
                const Function = if (@hasDecl(Hasher, "hashWithSeed")) Hasher.hashWithSeed else Hasher.hash;
                var function_args: std.meta.ArgsTuple(@TypeOf(Function)) = undefined;
                if (comptime std.meta.fields(std.meta.ArgsTuple(@TypeOf(Function))).len == 1) {
                    return JSC.JSValue.jsNumber(Function(input)).asObjectRef();
                } else {
                    var seed: u64 = 0;
                    if (args.nextEat()) |arg| {
                        if (arg.isNumber()) {
                            seed = arg.toU32();
                        }
                    }
                    if (comptime std.meta.trait.isNumber(@TypeOf(function_args[0]))) {
                        function_args[0] = @intCast(@TypeOf(function_args[0]), seed);
                        function_args[1] = input;
                    } else {
                        function_args[1] = @intCast(@TypeOf(function_args[1]), seed);
                        function_args[0] = input;
                    }

                    const value = @call(.{}, Function, function_args);

                    if (@TypeOf(value) == u32) {
                        return JSC.JSValue.jsNumber(@bitCast(i32, value)).asObjectRef();
                    }
                    return JSC.JSValue.jsNumber(value).asObjectRef();
                }
            }
        };
    }
};

pub fn getTOMLObject(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("TOML"));
    if (existing.isEmpty()) {
        return ctx.ptr().putCachedObject(
            &ZigString.init("TOML"),
            JSValue.fromRef(js.JSObjectMake(ctx, TOML.Class.get().?[0], null)),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub fn getUnsafe(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSValueRef,
    _: js.JSStringRef,
    _: js.ExceptionRef,
) js.JSValueRef {
    var existing = ctx.ptr().getCachedObject(ZigString.static("Unsafe"));
    if (existing.isEmpty()) {
        return ctx.ptr().putCachedObject(
            &ZigString.init("Unsafe"),
            JSValue.fromRef(js.JSObjectMake(ctx, Unsafe.Class.get().?[0], null)),
        ).asObjectRef();
    }

    return existing.asObjectRef();
}

pub const Unsafe = struct {
    pub const Class = NewClass(
        void,
        .{ .name = "Unsafe", .read_only = true },
        .{
            .segfault = .{
                .rfn = __debug__doSegfault,
            },
            .arrayBufferToString = .{
                .rfn = arrayBufferToString,
            },
        },
        .{},
    );

    // For testing the segfault handler
    pub fn __debug__doSegfault(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        _ = ctx;
        const Reporter = @import("../../report.zig");
        Reporter.globalError(error.SegfaultTest);
    }

    pub fn arrayBufferToString(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        args: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        const array_buffer = JSC.ArrayBuffer.fromTypedArray(ctx, JSC.JSValue.fromRef(args[0]), exception);
        switch (array_buffer.typed_array_type) {
            .Uint16Array, .Int16Array => {
                var zig_str = ZigString.init("");
                zig_str.ptr = @ptrCast([*]const u8, @alignCast(@alignOf([*]align(1) const u16), array_buffer.ptr));
                zig_str.len = array_buffer.len;
                zig_str.markUTF16();
                // the deinitializer for string causes segfaults
                // if we don't clone it
                return ZigString.toValueGC(&zig_str, ctx.ptr()).asObjectRef();
            },
            else => {
                // the deinitializer for string causes segfaults
                // if we don't clone it
                return ZigString.init(array_buffer.slice()).toValueGC(ctx.ptr()).asObjectRef();
            },
        }
    }
};

// pub const Lockfile = struct {
//     const BunLockfile = @import("../../install/install.zig").Lockfile;
//     lockfile: *BunLockfile,

//     pub const RefCountedLockfile = bun.RefCount(Lockfile, true);

//     pub const StaticClass = NewClass(
//         void,
//         .{
//             .name = "Lockfile",
//             .read_only = true,
//         },
//         .{
//             .load = .{
//                 .rfn = BunLockfile.load,
//             },
//         },
//         .{},
//     );

//     pub const Class = NewClass(
//         RefCountedLockfile,
//         .{
//             .name = "Lockfile",
//             .read_only = true,
//         },
//         .{
//             .findPackagesByName = .{
//                 .rfn = BunLockfile.load,
//             },
//             .dependencies = .{
//                 .rfn = BunLockfile.load,
//             },
//         },
//         .{},
//     );

//     pub fn deinit(this: *Lockfile) void {
//         this.lockfile.deinit();
//     }

//     pub fn load(
//         // this
//         _: void,
//         ctx: js.JSContextRef,
//         // function
//         _: js.JSObjectRef,
//         // thisObject
//         _: js.JSObjectRef,
//         arguments: []const js.JSValueRef,
//         exception: js.ExceptionRef,
//     ) js.JSValueRef {
//         if (arguments.len == 0) {
//             JSError(undefined, "Expected file path string or buffer", .{}, ctx, exception);
//             return null;
//         }

//         var lockfile: *BunLockfile = getAllocator(ctx).create(BunLockfile) catch return JSValue.jsUndefined().asRef();

//         var log = logger.Log.init(default_allocator);
//         var args_slice = @ptrCast([*]const JSValue, arguments.ptr)[0..arguments.len];

//         var arguments_slice = Node.ArgumentsSlice.init(args_slice);
//         var path_or_buffer = Node.PathLike.fromJS(ctx, &arguments_slice, exception) orelse {
//             getAllocator(ctx).destroy(lockfile);
//             JSError(undefined, "Expected file path string or buffer", .{}, ctx, exception);
//             return null;
//         };

//         const load_from_disk_result = switch (path_or_buffer) {
//             Node.PathLike.Tag.string => lockfile.loadFromDisk(getAllocator(ctx), &log, path_or_buffer.string),
//             Node.PathLike.Tag.buffer => lockfile.loadFromBytes(getAllocator(ctx), path_or_buffer.buffer.slice(), &log),
//             else => {
//                 getAllocator(ctx).destroy(lockfile);
//                 JSError(undefined, "Expected file path string or buffer", .{}, ctx, exception);
//                 return null;
//             },
//         };

//         switch (load_from_disk_result) {
//             .err => |cause| {
//                 defer getAllocator(ctx).destroy(lockfile);
//                 switch (cause.step) {
//                     .open_file => {
//                         JSError(undefined, "error opening lockfile: {s}", .{
//                             @errorName(cause.value),
//                         }, ctx, exception);
//                         return null;
//                     },
//                     .parse_file => {
//                         JSError(undefined, "error parsing lockfile: {s}", .{
//                             @errorName(cause.value),
//                         }, ctx, exception);
//                         return null;
//                     },
//                     .read_file => {
//                         JSError(undefined, "error reading lockfile: {s}", .{
//                             @errorName(cause.value),
//                         }, ctx, exception);
//                         return null;
//                     },
//                 }
//             },
//             .ok => {},
//         }
//     }
// };

pub const TOML = struct {
    const TOMLParser = @import("../../toml/toml_parser.zig").TOML;
    pub const Class = NewClass(
        void,
        .{
            .name = "TOML",
            .read_only = true,
        },
        .{
            .parse = .{
                .rfn = TOML.parse,
            },
        },
        .{},
    );

    pub fn parse(
        // this
        _: void,
        ctx: js.JSContextRef,
        // function
        _: js.JSObjectRef,
        // thisObject
        _: js.JSObjectRef,
        arguments: []const js.JSValueRef,
        exception: js.ExceptionRef,
    ) js.JSValueRef {
        var arena = std.heap.ArenaAllocator.init(getAllocator(ctx));
        var allocator = arena.allocator();
        defer arena.deinit();
        var log = logger.Log.init(default_allocator);
        var input_str = ZigString.init("");
        JSValue.fromRef(arguments[0]).toZigString(&input_str, ctx.ptr());
        var needs_deinit = false;
        var input = input_str.slice();
        if (input_str.is16Bit()) {
            input = std.fmt.allocPrint(allocator, "{}", .{input_str}) catch unreachable;
            needs_deinit = true;
        }
        var source = logger.Source.initPathString("input.toml", input);
        var parse_result = TOMLParser.parse(&source, &log, allocator) catch {
            exception.* = log.toJS(ctx.ptr(), default_allocator, "Failed to parse toml").asObjectRef();
            return null;
        };

        // for now...
        var buffer_writer = try js_printer.BufferWriter.init(allocator);
        var writer = js_printer.BufferPrinter.init(buffer_writer);
        _ = js_printer.printJSON(*js_printer.BufferPrinter, &writer, parse_result, &source) catch {
            exception.* = log.toJS(ctx.ptr(), default_allocator, "Failed to print toml").asObjectRef();
            return null;
        };

        var slice = writer.ctx.buffer.toOwnedSliceLeaky();
        var out = ZigString.init(slice);

        const out_value = js.JSValueMakeFromJSONString(ctx, out.toJSStringRef());
        return out_value;
    }
};

pub const Timer = struct {
    last_id: i32 = 0,
    warned: bool = false,
    active: u32 = 0,
    timeouts: TimeoutMap = TimeoutMap{},

    const TimeoutMap = std.AutoArrayHashMapUnmanaged(i32, *Timeout);

    pub fn getNextID() callconv(.C) i32 {
        VirtualMachine.vm.timer.last_id += 1;
        return VirtualMachine.vm.timer.last_id;
    }

    const Pool = bun.ObjectPool(Timeout, null, true, 1000);

    pub const Timeout = struct {
        id: i32 = 0,
        callback: JSValue,
        interval: i32 = 0,
        completion: NetworkThread.Completion = undefined,
        repeat: bool = false,
        io_task: ?*TimeoutTask = null,
        cancelled: bool = false,

        pub const TimeoutTask = IOTask(Timeout);

        pub fn run(this: *Timeout, _task: *TimeoutTask) void {
            this.io_task = _task;
            NetworkThread.global.io.timeout(
                *Timeout,
                this,
                onCallback,
                &this.completion,
                if (this.interval > 0) std.time.ns_per_ms * @intCast(
                    u63,
                    this.interval,
                ) else 1,
            );
        }

        pub fn onCallback(this: *Timeout, _: *NetworkThread.Completion, _: NetworkThread.AsyncIO.TimeoutError!void) void {
            this.io_task.?.onFinish();
        }

        pub fn then(this: *Timeout, global: *JSGlobalObject) void {
            if (comptime JSC.is_bindgen)
                unreachable;

            var vm = global.bunVM();

            if (!this.cancelled) {
                if (this.repeat) {
                    this.io_task.?.deinit();
                    var task = Timeout.TimeoutTask.createOnJSThread(vm.allocator, global, this) catch unreachable;
                    vm.timer.timeouts.put(vm.allocator, this.id, this) catch unreachable;
                    this.io_task = task;
                    task.schedule();
                }

                _ = JSC.C.JSObjectCallAsFunction(global.ref(), this.callback.asObjectRef(), null, 0, null, null);

                if (this.repeat)
                    return;

                vm.timer.active -|= 1;
                vm.active_tasks -|= 1;
            } else {
                // the active tasks count is already cleared for canceled timeout,
                // add one here to neutralize the `-|= 1` in event loop.
                vm.active_tasks +|= 1;
            }

            this.clear(global);
        }

        pub fn clear(this: *Timeout, global: *JSGlobalObject) void {
            if (comptime JSC.is_bindgen)
                unreachable;

            this.cancelled = true;
            JSC.C.JSValueUnprotect(global.ref(), this.callback.asObjectRef());
            _ = VirtualMachine.vm.timer.timeouts.swapRemove(this.id);
            if (this.io_task) |task| {
                task.deinit();
                this.io_task = null;
            }
            Pool.releaseValue(this);
        }
    };

    fn set(
        id: i32,
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
        repeat: bool,
    ) !void {
        if (comptime is_bindgen) unreachable;
        var timeout = Pool.first(globalThis.bunVM().allocator);
        js.JSValueProtect(globalThis.ref(), callback.asObjectRef());
        timeout.* = Timeout{ .id = id, .callback = callback, .interval = countdown.toInt32(), .repeat = repeat };
        var task = try Timeout.TimeoutTask.createOnJSThread(VirtualMachine.vm.allocator, globalThis, timeout);
        VirtualMachine.vm.timer.timeouts.put(VirtualMachine.vm.allocator, id, timeout) catch unreachable;
        VirtualMachine.vm.timer.active +|= 1;
        VirtualMachine.vm.active_tasks +|= 1;
        task.schedule();
    }

    pub fn setTimeout(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
    ) callconv(.C) JSValue {
        if (comptime is_bindgen) unreachable;
        const id = VirtualMachine.vm.timer.last_id;
        VirtualMachine.vm.timer.last_id +%= 1;

        Timer.set(id, globalThis, callback, countdown, false) catch
            return JSValue.jsUndefined();

        return JSValue.jsNumberWithType(i32, id);
    }
    pub fn setInterval(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
    ) callconv(.C) JSValue {
        if (comptime is_bindgen) unreachable;
        const id = VirtualMachine.vm.timer.last_id;
        VirtualMachine.vm.timer.last_id +%= 1;

        Timer.set(id, globalThis, callback, countdown, true) catch
            return JSValue.jsUndefined();

        return JSValue.jsNumberWithType(i32, id);
    }

    pub fn clearTimer(id: JSValue, _: *JSGlobalObject) void {
        if (comptime is_bindgen) unreachable;
        var timer: *Timeout = VirtualMachine.vm.timer.timeouts.get(id.toInt32()) orelse return;
        timer.cancelled = true;
        VirtualMachine.vm.timer.active -|= 1;
        // here we also remove the active task count added in event_loop.
        VirtualMachine.vm.active_tasks -|= 2;
    }

    pub fn clearTimeout(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        if (comptime is_bindgen) unreachable;
        Timer.clearTimer(id, globalThis);
        return JSValue.jsUndefined();
    }
    pub fn clearInterval(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        if (comptime is_bindgen) unreachable;
        Timer.clearTimer(id, globalThis);
        return JSValue.jsUndefined();
    }

    const Shimmer = @import("../bindings/shimmer.zig").Shimmer;

    pub const shim = Shimmer("Bun", "Timer", @This());
    pub const name = "Bun__Timer";
    pub const include = "";
    pub const namespace = shim.namespace;

    pub const Export = shim.exportFunctions(.{
        .@"setTimeout" = setTimeout,
        .@"setInterval" = setInterval,
        .@"clearTimeout" = clearTimeout,
        .@"clearInterval" = clearInterval,
        .@"getNextID" = getNextID,
    });

    comptime {
        if (!JSC.is_bindgen) {
            @export(setTimeout, .{ .name = Export[0].symbol_name });
            @export(setInterval, .{ .name = Export[1].symbol_name });
            @export(clearTimeout, .{ .name = Export[2].symbol_name });
            @export(clearInterval, .{ .name = Export[3].symbol_name });
            @export(getNextID, .{ .name = Export[4].symbol_name });
        }
    }
};

pub const FFI = struct {
    pub const Class = NewClass(
        void,
        .{ .name = "FFI", .has_dom_calls = true },
        .{
            .viewSource = .{
                .rfn = JSC.wrapWithHasContainer(JSC.FFI, "print", false, false, true),
            },
            .dlopen = .{
                .rfn = JSC.wrapWithHasContainer(JSC.FFI, "open", false, false, true),
            },
            .callback = .{
                .rfn = JSC.wrapWithHasContainer(JSC.FFI, "callback", false, false, false),
            },
            .linkSymbols = .{
                .rfn = JSC.wrapWithHasContainer(JSC.FFI, "linkSymbols", false, false, false),
            },
            .ptr = JSC.DOMCall("FFI", @This(), "ptr", f64, JSC.DOMEffect.forRead(.TypedArrayProperties)),

            .toBuffer = .{
                .rfn = JSC.wrapWithHasContainer(@This(), "toBuffer", false, false, true),
            },
            .toArrayBuffer = .{
                .rfn = JSC.wrapWithHasContainer(@This(), "toArrayBuffer", false, false, true),
            },
        },
        .{
            .read = .{
                .get = FFI.Reader.getter,
            },
            .CString = .{
                .get = UnsafeCString.getter,
            },
        },
    );

    pub const Reader = struct {
        pub const Class = NewClass(
            void,
            .{ .name = "FFI", .has_dom_calls = true },
            .{
                .@"u8" = JSC.DOMCall("Reader", @This(), "u8", i32, JSC.DOMEffect.forRead(.World)),
                .@"u16" = JSC.DOMCall("Reader", @This(), "u16", i32, JSC.DOMEffect.forRead(.World)),
                .@"u32" = JSC.DOMCall("Reader", @This(), "u32", i32, JSC.DOMEffect.forRead(.World)),
                .@"ptr" = JSC.DOMCall("Reader", @This(), "ptr", i52, JSC.DOMEffect.forRead(.World)),
                .@"i8" = JSC.DOMCall("Reader", @This(), "i8", i32, JSC.DOMEffect.forRead(.World)),
                .@"i16" = JSC.DOMCall("Reader", @This(), "i16", i32, JSC.DOMEffect.forRead(.World)),
                .@"i32" = JSC.DOMCall("Reader", @This(), "i32", i32, JSC.DOMEffect.forRead(.World)),
                .@"i64" = JSC.DOMCall("Reader", @This(), "i64", i64, JSC.DOMEffect.forRead(.World)),
                .@"u64" = JSC.DOMCall("Reader", @This(), "u64", u64, JSC.DOMEffect.forRead(.World)),
                .@"intptr" = JSC.DOMCall("Reader", @This(), "intptr", i52, JSC.DOMEffect.forRead(.World)),
                .@"f32" = JSC.DOMCall("Reader", @This(), "f32", f64, JSC.DOMEffect.forRead(.World)),
                .@"f64" = JSC.DOMCall("Reader", @This(), "f64", f64, JSC.DOMEffect.forRead(.World)),
            },
            .{},
        );

        pub fn @"u8"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) u8, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u16"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) u16, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) u32, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"ptr"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) u64, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i8"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) i8, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i16"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) i16, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) i32, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"intptr"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) i64, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) f32, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f64"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) f64, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"i64"(
            global: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) i64, addr).*;
            return JSValue.fromInt64NoTruncate(global, value);
        }

        pub fn @"u64"(
            global: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @intCast(usize, arguments[1].to(i32)) else @as(usize, 0);
            const value = @intToPtr(*align(1) u64, addr).*;
            return JSValue.fromUInt64NoTruncate(global, value);
        }

        pub fn @"u8WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) u8, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u16WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) u16, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u32WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) u32, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"ptrWithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) u64, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i8WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) i8, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i16WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) i16, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i32WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) i32, addr).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"intptrWithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) i64, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f32WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) f32, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f64WithoutTypeChecks"(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) f64, addr).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"u64WithoutTypeChecks"(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) u64, addr).*;
            return JSValue.fromUInt64NoTruncate(global, value);
        }

        pub fn @"i64WithoutTypeChecks"(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @intCast(usize, raw_addr) + @intCast(usize, offset);
            const value = @intToPtr(*align(1) i64, addr).*;
            return JSValue.fromInt64NoTruncate(global, value);
        }

        pub fn getter(
            _: void,
            ctx: js.JSContextRef,
            _: js.JSValueRef,
            _: js.JSStringRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            var existing = ctx.ptr().getCachedObject(ZigString.static("FFIReader"));
            if (existing.isEmpty()) {
                var prototype = JSC.C.JSObjectMake(ctx, FFI.Reader.Class.get().?[0], null);
                var base = JSC.C.JSObjectMake(ctx, null, null);
                JSC.C.JSObjectSetPrototype(ctx, base, prototype);
                FFI.Reader.Class.putDOMCalls(ctx, JSC.JSValue.c(base));
                return ctx.ptr().putCachedObject(
                    ZigString.static("FFIReader"),
                    JSValue.fromRef(base),
                ).asObjectRef();
            }

            return existing.asObjectRef();
        }
    };

    pub fn ptr(
        globalThis: *JSGlobalObject,
        _: JSValue,
        arguments: []const JSValue,
    ) JSValue {
        return switch (arguments.len) {
            0 => ptr_(globalThis, JSValue.zero, null),
            1 => ptr_(globalThis, arguments[0], null),
            else => ptr_(globalThis, arguments[0], arguments[1]),
        };
    }

    pub fn ptrWithoutTypeChecks(
        _: *JSGlobalObject,
        _: *anyopaque,
        array: *JSC.JSUint8Array,
    ) callconv(.C) JSValue {
        return JSValue.fromPtrAddress(@ptrToInt(array.ptr()));
    }

    fn ptr_(
        globalThis: *JSGlobalObject,
        value: JSValue,
        byteOffset: ?JSValue,
    ) JSValue {
        if (value.isEmpty()) {
            return JSC.JSValue.jsNull();
        }

        const array_buffer = value.asArrayBuffer(globalThis) orelse {
            return JSC.toInvalidArguments("Expected ArrayBufferView but received {s}", .{@tagName(value.jsType())}, globalThis.ref());
        };

        if (array_buffer.len == 0) {
            return JSC.toInvalidArguments("ArrayBufferView must have a length > 0. A pointer to empty memory doesn't work", .{}, globalThis.ref());
        }

        var addr: usize = @ptrToInt(array_buffer.ptr);
        // const Sizes = @import("../bindings/sizes.zig");
        // std.debug.assert(addr == @ptrToInt(value.asEncoded().ptr) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector);

        if (byteOffset) |off| {
            if (!off.isEmptyOrUndefinedOrNull()) {
                if (!off.isNumber()) {
                    return JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis.ref());
                }
            }

            const bytei64 = off.toInt64();
            if (bytei64 < 0) {
                addr -|= @intCast(usize, bytei64 * -1);
            } else {
                addr += @intCast(usize, bytei64);
            }

            if (addr > @ptrToInt(array_buffer.ptr) + @as(usize, array_buffer.byte_len)) {
                return JSC.toInvalidArguments("byteOffset out of bounds", .{}, globalThis.ref());
            }
        }

        if (addr > max_addressible_memory) {
            return JSC.toInvalidArguments("Pointer is outside max addressible memory, which usually means a bug in your program.", .{}, globalThis.ref());
        }

        if (addr == 0) {
            return JSC.toInvalidArguments("Pointer must not be 0", .{}, globalThis.ref());
        }

        if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
            return JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis.ref());
        }

        if (comptime Environment.allow_assert) {
            std.debug.assert(JSC.JSValue.fromPtrAddress(addr).asPtrAddress() == addr);
        }

        return JSC.JSValue.fromPtrAddress(addr);
    }

    const ValueOrError = union(enum) {
        err: JSValue,
        slice: []u8,
    };

    pub fn getPtrSlice(globalThis: *JSGlobalObject, value: JSValue, byteOffset: ?JSValue, byteLength: ?JSValue) ValueOrError {
        if (!value.isNumber()) {
            return .{ .err = JSC.toInvalidArguments("ptr must be a number.", .{}, globalThis.ref()) };
        }

        const num = value.asPtrAddress();
        if (num == 0) {
            return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis.ref()) };
        }

        // if (!std.math.isFinite(num)) {
        //     return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis.ref()) };
        // }

        var addr = @bitCast(usize, num);

        if (byteOffset) |byte_off| {
            if (byte_off.isNumber()) {
                const off = byte_off.toInt64();
                if (off < 0) {
                    addr -|= @intCast(usize, off * -1);
                } else {
                    addr +|= @intCast(usize, off);
                }

                if (addr == 0) {
                    return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis.ref()) };
                }

                if (!std.math.isFinite(byte_off.asNumber())) {
                    return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis.ref()) };
                }
            } else if (!byte_off.isEmptyOrUndefinedOrNull()) {
                // do nothing
            } else {
                return .{ .err = JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis.ref()) };
            }
        }

        if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
            return .{ .err = JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis.ref()) };
        }

        if (byteLength) |valueLength| {
            if (!valueLength.isEmptyOrUndefinedOrNull()) {
                if (!valueLength.isNumber()) {
                    return .{ .err = JSC.toInvalidArguments("length must be a number.", .{}, globalThis.ref()) };
                }

                if (valueLength.asNumber() == 0.0) {
                    return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis.ref()) };
                }

                const length_i = valueLength.toInt64();
                if (length_i < 0) {
                    return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis.ref()) };
                }

                if (length_i > max_addressible_memory) {
                    return .{ .err = JSC.toInvalidArguments("length exceeds max addressable memory. This usually means a bug in your code.", .{}, globalThis.ref()) };
                }

                const length = @intCast(usize, length_i);
                return .{ .slice = @intToPtr([*]u8, addr)[0..length] };
            }
        }

        return .{ .slice = bun.span(@intToPtr([*:0]u8, addr)) };
    }

    fn getCPtr(value: JSValue) ?usize {
        // pointer to C function
        if (value.isNumber()) {
            const addr = value.asPtrAddress();
            if (addr > 0) return addr;
        } else if (value.isBigInt()) {
            const addr = @bitCast(u64, value.toUInt64NoTruncate());
            if (addr > 0) {
                return addr;
            }
        }

        return null;
    }

    pub fn toArrayBuffer(
        globalThis: *JSGlobalObject,
        value: JSValue,
        byteOffset: ?JSValue,
        valueLength: ?JSValue,
        finalizationCtxOrPtr: ?JSValue,
        finalizationCallback: ?JSValue,
    ) JSC.JSValue {
        switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
            .err => |erro| {
                return erro;
            },
            .slice => |slice| {
                var callback: JSC.C.JSTypedArrayBytesDeallocator = null;
                var ctx: ?*anyopaque = null;
                if (finalizationCallback) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @intToPtr(JSC.C.JSTypedArrayBytesDeallocator, callback_ptr);

                        if (finalizationCtxOrPtr) |ctx_value| {
                            if (getCPtr(ctx_value)) |ctx_ptr| {
                                ctx = @intToPtr(*anyopaque, ctx_ptr);
                            } else if (!ctx_value.isUndefinedOrNull()) {
                                return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                            }
                        }
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                } else if (finalizationCtxOrPtr) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @intToPtr(JSC.C.JSTypedArrayBytesDeallocator, callback_ptr);
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                }

                return JSC.ArrayBuffer.fromBytes(slice, JSC.JSValue.JSType.ArrayBuffer).toJSWithContext(globalThis.ref(), ctx, callback, null);
            },
        }
    }

    pub fn toBuffer(
        globalThis: *JSGlobalObject,
        value: JSValue,
        byteOffset: ?JSValue,
        valueLength: ?JSValue,
        finalizationCtxOrPtr: ?JSValue,
        finalizationCallback: ?JSValue,
    ) JSC.JSValue {
        switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
            .err => |erro| {
                return erro;
            },
            .slice => |slice| {
                var callback: JSC.C.JSTypedArrayBytesDeallocator = null;
                var ctx: ?*anyopaque = null;
                if (finalizationCallback) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @intToPtr(JSC.C.JSTypedArrayBytesDeallocator, callback_ptr);

                        if (finalizationCtxOrPtr) |ctx_value| {
                            if (getCPtr(ctx_value)) |ctx_ptr| {
                                ctx = @intToPtr(*anyopaque, ctx_ptr);
                            } else if (!ctx_value.isEmptyOrUndefinedOrNull()) {
                                return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                            }
                        }
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                } else if (finalizationCtxOrPtr) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @intToPtr(JSC.C.JSTypedArrayBytesDeallocator, callback_ptr);
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                }

                if (callback != null or ctx != null) {
                    return JSC.JSValue.createBufferWithCtx(globalThis, slice, ctx, callback);
                }

                return JSC.JSValue.createBuffer(globalThis, slice, null);
            },
        }
    }

    pub fn toCStringBuffer(
        globalThis: *JSGlobalObject,
        value: JSValue,
        byteOffset: ?JSValue,
        valueLength: ?JSValue,
    ) JSC.JSValue {
        switch (getPtrSlice(globalThis, value, byteOffset, valueLength)) {
            .err => |erro| {
                return erro;
            },
            .slice => |slice| {
                return JSC.JSValue.createBuffer(globalThis, slice, null);
            },
        }
    }

    pub fn getter(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var existing = ctx.ptr().getCachedObject(ZigString.static("FFI"));
        if (existing.isEmpty()) {
            var prototype = JSC.C.JSObjectMake(ctx, FFI.Class.get().?[0], null);
            var base = JSC.C.JSObjectMake(ctx, null, null);
            JSC.C.JSObjectSetPrototype(ctx, base, prototype);
            FFI.Class.putDOMCalls(ctx, JSC.JSValue.c(base));
            return ctx.ptr().putCachedObject(
                ZigString.static("FFI"),
                JSValue.fromRef(base),
            ).asObjectRef();
        }

        return existing.asObjectRef();
    }
};

pub const UnsafeCString = struct {
    pub fn constructor(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        len: usize,
        args: [*c]const js.JSValueRef,
        exception: js.ExceptionRef,
    ) callconv(.C) js.JSObjectRef {
        if (len == 0) {
            JSC.throwInvalidArguments("Expected a ptr", .{}, ctx, exception);
            return null;
        }

        return newCString(ctx.ptr(), JSC.JSValue.fromRef(args[0]), if (len > 1) JSC.JSValue.fromRef(args[1]) else null, if (len > 2) JSC.JSValue.fromRef(args[2]) else null).asObjectRef();
    }

    pub fn newCString(globalThis: *JSGlobalObject, value: JSValue, byteOffset: ?JSValue, lengthValue: ?JSValue) JSC.JSValue {
        switch (FFI.getPtrSlice(globalThis, value, byteOffset, lengthValue)) {
            .err => |err| {
                return err;
            },
            .slice => |slice| {
                return WebCore.Encoder.toString(slice.ptr, slice.len, globalThis, .utf8);
            },
        }
    }

    pub fn getter(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var existing = ctx.ptr().getCachedObject(ZigString.static("UnsafeCString"));
        if (existing.isEmpty()) {
            return ctx.ptr().putCachedObject(
                ZigString.static("UnsafeCString"),
                JSValue.fromRef(JSC.C.JSObjectMakeConstructor(ctx, null, constructor)),
            ).asObjectRef();
        }

        return existing.asObjectRef();
    }
};

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
// This is aliased to Bun.env
pub const EnvironmentVariables = struct {
    pub const Class = NewClass(
        void,
        .{
            .name = "DotEnv",
            .read_only = true,
        },
        .{
            .getProperty = .{
                .rfn = getProperty,
            },
            .setProperty = .{
                .rfn = setProperty,
            },
            .deleteProperty = .{
                .rfn = deleteProperty,
            },
            .convertToType = .{ .rfn = convertToType },
            .hasProperty = .{
                .rfn = hasProperty,
            },
            .getPropertyNames = .{
                .rfn = getPropertyNames,
            },
            .toJSON = .{
                .rfn = toJSON,
                .name = "toJSON",
            },
        },
        .{},
    );

    pub fn getter(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSValueRef,
        _: js.JSStringRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var existing = ctx.ptr().getCachedObject(ZigString.static("Bun.env"));
        if (existing.isEmpty()) {
            return ctx.ptr().putCachedObject(
                ZigString.static("Bun.env"),
                JSValue.fromRef(js.JSObjectMake(ctx, EnvironmentVariables.Class.get().*, null)),
            ).asObjectRef();
        }

        return existing.asObjectRef();
    }

    pub const BooleanString = struct {
        pub const @"true": string = "true";
        pub const @"false": string = "false";
    };

    pub fn getProperty(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        propertyName: js.JSStringRef,
        _: js.ExceptionRef,
    ) callconv(.C) js.JSValueRef {
        const len = js.JSStringGetLength(propertyName);
        var ptr = js.JSStringGetCharacters8Ptr(propertyName);
        var name = ptr[0..len];
        if (VirtualMachine.vm.bundler.env.map.get(name)) |value| {
            return ZigString.toRef(value, ctx.ptr());
        }

        if (Output.enable_ansi_colors) {
            // https://github.com/chalk/supports-color/blob/main/index.js
            if (strings.eqlComptime(name, "FORCE_COLOR")) {
                return ZigString.toRef(BooleanString.@"true", ctx.ptr());
            }
        }

        return js.JSValueMakeUndefined(ctx);
    }

    pub fn toJSON(
        _: void,
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        _: js.JSObjectRef,
        _: []const js.JSValueRef,
        _: js.ExceptionRef,
    ) js.JSValueRef {
        var map = VirtualMachine.vm.bundler.env.map.map;
        var keys = map.keys();
        var values = map.values();
        const StackFallback = std.heap.StackFallbackAllocator(32 * 2 * @sizeOf(ZigString));
        var stack = StackFallback{
            .buffer = undefined,
            .fallback_allocator = bun.default_allocator,
            .fixed_buffer_allocator = undefined,
        };
        var allocator = stack.get();
        var key_strings_ = allocator.alloc(ZigString, keys.len * 2) catch unreachable;
        var key_strings = key_strings_[0..keys.len];
        var value_strings = key_strings_[keys.len..];

        for (keys) |key, i| {
            key_strings[i] = ZigString.init(key);
            key_strings[i].detectEncoding();
            value_strings[i] = ZigString.init(values[i]);
            value_strings[i].detectEncoding();
        }

        var result = JSValue.fromEntries(ctx.ptr(), key_strings.ptr, value_strings.ptr, keys.len, false).asObjectRef();
        allocator.free(key_strings_);
        return result;
        // }
        // ZigConsoleClient.Formatter.format(this: *Formatter, result: Tag.Result, comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool)
    }

    pub fn deleteProperty(
        _: js.JSContextRef,
        _: js.JSObjectRef,
        propertyName: js.JSStringRef,
        _: js.ExceptionRef,
    ) callconv(.C) bool {
        const len = js.JSStringGetLength(propertyName);
        var ptr = js.JSStringGetCharacters8Ptr(propertyName);
        var name = ptr[0..len];
        _ = VirtualMachine.vm.bundler.env.map.map.swapRemove(name);
        return true;
    }

    pub fn setProperty(
        ctx: js.JSContextRef,
        _: js.JSObjectRef,
        propertyName: js.JSStringRef,
        value: js.JSValueRef,
        exception: js.ExceptionRef,
    ) callconv(.C) bool {
        const len = js.JSStringGetLength(propertyName);
        var ptr = js.JSStringGetCharacters8Ptr(propertyName);
        var name = ptr[0..len];
        var val = ZigString.init("");
        JSValue.fromRef(value).toZigString(&val, ctx.ptr());
        if (exception.* != null) return false;
        var result = std.fmt.allocPrint(VirtualMachine.vm.allocator, "{}", .{val}) catch unreachable;
        VirtualMachine.vm.bundler.env.map.put(name, result) catch unreachable;

        return true;
    }

    pub fn hasProperty(
        _: js.JSContextRef,
        _: js.JSObjectRef,
        propertyName: js.JSStringRef,
    ) callconv(.C) bool {
        const len = js.JSStringGetLength(propertyName);
        const ptr = js.JSStringGetCharacters8Ptr(propertyName);
        const name = ptr[0..len];
        return VirtualMachine.vm.bundler.env.map.get(name) != null or (Output.enable_ansi_colors and strings.eqlComptime(name, "FORCE_COLOR"));
    }

    pub fn convertToType(ctx: js.JSContextRef, obj: js.JSObjectRef, kind: js.JSType, exception: js.ExceptionRef) callconv(.C) js.JSValueRef {
        _ = ctx;
        _ = obj;
        _ = kind;
        _ = exception;
        return obj;
    }

    pub fn getPropertyNames(
        _: js.JSContextRef,
        _: js.JSObjectRef,
        props: js.JSPropertyNameAccumulatorRef,
    ) callconv(.C) void {
        var iter = VirtualMachine.vm.bundler.env.map.iter();

        while (iter.next()) |item| {
            const str = item.key_ptr.*;
            js.JSPropertyNameAccumulatorAddName(props, js.JSStringCreateStatic(str.ptr, str.len));
        }
    }
};

export fn Bun__reportError(_: *JSGlobalObject, err: JSC.JSValue) void {
    JSC.VirtualMachine.vm.runErrorHandler(err, null);
}

comptime {
    if (!is_bindgen) {
        _ = Bun__reportError;
    }
}

pub const JSZlib = struct {
    export fn reader_deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        var reader: *zlib.ZlibReaderArrayList = bun.cast(*zlib.ZlibReaderArrayList, ctx.?);
        reader.list.deinit(reader.allocator);
        reader.deinit();
    }

    export fn compressor_deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        var compressor: *zlib.ZlibCompressorArrayList = bun.cast(*zlib.ZlibCompressorArrayList, ctx.?);
        compressor.list.deinit(compressor.allocator);
        compressor.deinit();
    }

    pub fn gzipSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
        options_val_: ?JSValue,
    ) JSValue {
        return gzipOrDeflateSync(globalThis, buffer, options_val_, true);
    }

    pub fn deflateSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
        options_val_: ?JSValue,
    ) JSValue {
        return gzipOrDeflateSync(globalThis, buffer, options_val_, false);
    }

    pub fn gzipOrDeflateSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
        options_val_: ?JSValue,
        is_gzip: bool,
    ) JSValue {
        var opts = zlib.Options{ .gzip = is_gzip };
        if (options_val_) |options_val| {
            if (options_val.isObject()) {
                if (options_val.get(globalThis, "windowBits")) |window| {
                    opts.windowBits = window.toInt32();
                }

                if (options_val.get(globalThis, "level")) |level| {
                    opts.level = level.toInt32();
                }

                if (options_val.get(globalThis, "memLevel")) |memLevel| {
                    opts.memLevel = memLevel.toInt32();
                }

                if (options_val.get(globalThis, "strategy")) |strategy| {
                    opts.strategy = strategy.toInt32();
                }
            }
        }

        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.vm.allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibCompressorArrayList.init(compressed, &list, allocator, opts) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis.ref());
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis.ref());
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis.ref(), reader, reader_deallocator, null);
    }

    pub fn inflateSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
    ) JSValue {
        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.vm.allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibReaderArrayList.initWithOptions(compressed, &list, allocator, .{
            .windowBits = -15,
        }) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis.ref());
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis.ref());
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis.ref(), reader, reader_deallocator, null);
    }

    pub fn gunzipSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
    ) JSValue {
        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.vm.allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibReaderArrayList.init(compressed, &list, allocator) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis.ref());
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis.ref());
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis.ref(), reader, reader_deallocator, null);
    }
};

pub const Subprocess = struct {
    pub usingnamespace JSC.Codegen.JSSubprocess;

    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: std.os.fd_t = std.math.maxInt(std.os.fd_t),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,

    killed: bool = false,
    has_ref: bool = false,

    exit_promise: JSValue = JSValue.zero,
    this_jsvalue: JSValue = JSValue.zero,

    exit_code: ?u8 = null,
    waitpid_err: ?JSC.Node.Syscall.Error = null,

    has_waitpid_task: bool = false,
    notification_task: JSC.AnyTask = undefined,
    waitpid_task: JSC.AnyTask = undefined,

    wait_task: JSC.ConcurrentTask = .{},

    finalized: bool = false,

    globalThis: *JSC.JSGlobalObject,

    pub fn constructor(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Subprocess {
        return null;
    }

    const Readable = union(enum) {
        fd: JSC.Node.FileDescriptor,
        pipe: JSC.WebCore.ReadableStream,
        inherit: void,
        ignore: void,
        closed: void,

        pub fn init(stdio: std.meta.Tag(Stdio), fd: i32, globalThis: *JSC.JSGlobalObject) Readable {
            return switch (stdio) {
                .inherit => Readable{ .inherit = {} },
                .ignore => Readable{ .ignore = {} },
                .pipe => brk: {
                    var blob = JSC.WebCore.Blob.findOrCreateFileFromPath(.{ .fd = fd }, globalThis);
                    defer blob.detach();

                    var stream = JSC.WebCore.ReadableStream.fromBlob(globalThis, &blob, 0);

                    break :brk Readable{ .pipe = JSC.WebCore.ReadableStream.fromJS(stream, globalThis).? };
                },
                .callback, .fd, .path, .blob => Readable{ .fd = @intCast(JSC.Node.FileDescriptor, fd) },
            };
        }

        pub fn close(this: *Readable) void {
            switch (this.*) {
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
                },
                .pipe => |pipe| {
                    pipe.done();
                },
                else => {},
            }

            this.* = .closed;
        }

        pub fn toJS(this: Readable) JSValue {
            switch (this) {
                .fd => |fd| {
                    return JSValue.jsNumber(fd);
                },
                .pipe => |pipe| {
                    return pipe.toJS();
                },
                else => {
                    return JSValue.jsUndefined();
                },
            }
        }
    };

    pub fn getStderr(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stderr.toJS();
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stdin.toJS(globalThis);
    }

    pub fn getStdout(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return this.stdout.toJS();
    }

    pub fn kill(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        var arguments = callframe.arguments(1);
        var sig: i32 = 0;

        if (arguments.len > 0) {
            sig = arguments.ptr[0].toInt32();
        }

        if (!(sig > -1 and sig < std.math.maxInt(u8))) {
            globalThis.throwInvalidArguments("Invalid signal: must be > -1 and < 255", .{});
            return JSValue.jsUndefined();
        }

        if (this.killed) {
            return JSValue.jsUndefined();
        }

        if (comptime Environment.isLinux) {
            // should this be handled differently?
            // this effectively shouldn't happen
            if (this.pidfd == std.math.maxInt(std.os.fd_t)) {
                return JSValue.jsUndefined();
            }

            // first appeared in Linux 5.1
            const rc = std.os.linux.pidfd_send_signal(this.pidfd, @intCast(u8, sig), null, 0);

            if (rc != 0) {
                globalThis.throwValue(JSC.Node.Syscall.Error.fromCode(std.os.linux.getErrno(rc), .kill).toJSC(globalThis));
                return JSValue.jsUndefined();
            }
        } else {
            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                return JSC.Node.Syscall.Error.fromCode(std.c.getErrno(err), .kill).toJSC(globalThis);
            }
        }

        return JSValue.jsUndefined();
    }

    pub fn onKill(
        this: *Subprocess,
    ) void {
        if (this.killed) {
            return;
        }

        this.killed = true;
        this.closePorts();
    }

    pub fn closePorts(this: *Subprocess) void {
        if (comptime Environment.isLinux) {
            if (this.pidfd != std.math.maxInt(std.os.fd_t)) {
                _ = std.os.close(this.pidfd);
                this.pidfd = std.math.maxInt(std.os.fd_t);
            }
        }

        if (this.stdout == .pipe) {
            this.stdout.pipe.cancel(this.globalThis);
        }

        if (this.stderr == .pipe) {
            this.stderr.pipe.cancel(this.globalThis);
        }

        this.stdin.close();
        this.stdout.close();
        this.stderr.close();
    }

    pub fn unref(this: *Subprocess) void {
        if (!this.has_ref)
            return;
        this.has_ref = false;
        this.globalThis.bunVM().active_tasks -= 1;
    }

    pub fn ref(this: *Subprocess) void {
        if (this.has_ref)
            return;
        this.has_ref = true;
        this.globalThis.bunVM().active_tasks += 1;
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(this.pid);
    }

    pub fn getKilled(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.killed);
    }

    const Writable = union(enum) {
        pipe: *JSC.WebCore.FileSink,
        fd: JSC.Node.FileDescriptor,
        inherit: void,
        ignore: void,

        pub fn init(stdio: std.meta.Tag(Stdio), fd: i32, globalThis: *JSC.JSGlobalObject) !Writable {
            switch (stdio) {
                .path, .pipe, .callback => {
                    var sink = try globalThis.bunVM().allocator.create(JSC.WebCore.FileSink);
                    sink.* = .{
                        .opened_fd = fd,
                        .buffer = bun.ByteList.init(&.{}),
                        .allocator = globalThis.bunVM().allocator,
                    };

                    return Writable{ .pipe = sink };
                },
                .blob, .fd => {
                    return Writable{ .fd = @intCast(JSC.Node.FileDescriptor, fd) };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .ignore => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        pub fn toJS(this: Writable, globalThis: *JSC.JSGlobalObject) JSValue {
            return switch (this) {
                .pipe => |pipe| pipe.toJS(globalThis),
                .fd => |fd| JSValue.jsNumber(fd),
                .ignore => JSValue.jsUndefined(),
                .inherit => JSValue.jsUndefined(),
            };
        }

        pub fn close(this: *Writable) void {
            return switch (this.*) {
                .pipe => |pipe| {
                    _ = pipe.end(null);
                },
                .fd => |fd| {
                    _ = JSC.Node.Syscall.close(fd);
                },
                .ignore => {},
                .inherit => {},
            };
        }
    };

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        this.unref();
        this.closePorts();
        this.finalized = true;

        if (this.exit_code != null)
            bun.default_allocator.destroy(this);
    }

    pub fn getExitStatus(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.exit_code) |code| {
            return JSC.JSPromise.resolvedPromiseValue(globalThis, JSC.JSValue.jsNumber(code));
        }

        if (this.exit_promise == .zero) {
            this.exit_promise = JSC.JSPromise.create(globalThis).asValue(globalThis);
        }

        return this.exit_promise;
    }

    pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue) JSValue {
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var allocator = arena.allocator();

        var env: [*:null]?[*:0]const u8 = undefined;

        var env_array = std.ArrayListUnmanaged(?[*:0]const u8){
            .items = &.{},
            .capacity = 0,
        };

        var cwd = globalThis.bunVM().bundler.fs.top_level_dir;

        var stdio = [3]Stdio{
            .{ .ignore = .{} },
            .{ .inherit = .{} },
            .{ .pipe = .{} },
        };

        var PATH = globalThis.bunVM().bundler.env.get("PATH") orelse "";
        var argv: std.ArrayListUnmanaged(?[*:0]const u8) = undefined;
        {
            var cmd_value = args.get(globalThis, "cmd") orelse {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            };

            var cmds_array = cmd_value.arrayIterator(globalThis);
            argv = @TypeOf(argv).initCapacity(allocator, cmds_array.len) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            };

            if (cmd_value.isEmptyOrUndefinedOrNull()) {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            }

            if (cmds_array.len == 0) {
                globalThis.throwInvalidArguments("cmd must not be empty", .{});
                return JSValue.jsUndefined();
            }

            {
                var first_cmd = cmds_array.next().?;
                var arg0 = first_cmd.toSlice(globalThis, allocator);
                defer arg0.deinit();
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var resolved = Which.which(&path_buf, PATH, cwd, arg0.slice()) orelse {
                    globalThis.throwInvalidArguments("cmd not in $PATH: {s}", .{arg0});
                    return JSValue.jsUndefined();
                };
                argv.appendAssumeCapacity(allocator.dupeZ(u8, bun.span(resolved)) catch {
                    globalThis.throw("out of memory", .{});
                    return JSValue.jsUndefined();
                });
            }

            while (cmds_array.next()) |value| {
                argv.appendAssumeCapacity(value.getZigString(globalThis).toOwnedSliceZ(allocator) catch {
                    globalThis.throw("out of memory", .{});
                    return JSValue.jsUndefined();
                });
            }

            if (argv.items.len == 0) {
                globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                return JSValue.jsUndefined();
            }

            if (args.get(globalThis, "cwd")) |cwd_| {
                if (!cwd_.isEmptyOrUndefinedOrNull()) {
                    cwd = cwd_.getZigString(globalThis).toOwnedSliceZ(allocator) catch {
                        globalThis.throw("out of memory", .{});
                        return JSValue.jsUndefined();
                    };
                }
            }

            if (args.get(globalThis, "env")) |object| {
                if (!object.isEmptyOrUndefinedOrNull()) {
                    if (!object.isObject()) {
                        globalThis.throwInvalidArguments("env must be an object", .{});
                        return JSValue.jsUndefined();
                    }

                    var object_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = false,
                        .include_value = true,
                    }).init(globalThis, object.asObjectRef());
                    defer object_iter.deinit();
                    env_array.ensureTotalCapacityPrecise(allocator, object_iter.len) catch {
                        globalThis.throw("out of memory", .{});
                        return JSValue.jsUndefined();
                    };

                    while (object_iter.next()) |key| {
                        var value = object_iter.value;
                        var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ key, value.getZigString(globalThis) }) catch {
                            globalThis.throw("out of memory", .{});
                            return JSValue.jsUndefined();
                        };

                        if (key.eqlComptime("PATH")) {
                            PATH = bun.span(line["PATH=".len..]);
                        }
                        env_array.append(allocator, line) catch {
                            globalThis.throw("out of memory", .{});
                            return JSValue.jsUndefined();
                        };
                    }
                }
            }

            if (args.get(globalThis, "stdio")) |stdio_val| {
                if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                    if (stdio_val.jsType().isArray()) {
                        var stdio_iter = stdio_val.arrayIterator(globalThis);
                        stdio_iter.len = @minimum(stdio_iter.len, 3);
                        var i: usize = 0;
                        while (stdio_iter.next()) |value| : (i += 1) {
                            if (!extractStdio(globalThis, i, value, &stdio))
                                return JSC.JSValue.jsUndefined();
                        }
                    } else {
                        globalThis.throwInvalidArguments("stdio must be an array", .{});
                        return JSValue.jsUndefined();
                    }
                }
            } else {
                if (args.get(globalThis, "stdin")) |value| {
                    if (!extractStdio(globalThis, std.os.STDIN_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }

                if (args.get(globalThis, "stderr")) |value| {
                    if (!extractStdio(globalThis, std.os.STDERR_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }

                if (args.get(globalThis, "stdout")) |value| {
                    if (!extractStdio(globalThis, std.os.STDOUT_FILENO, value, &stdio))
                        return JSC.JSValue.jsUndefined();
                }
            }
        }

        var attr = PosixSpawn.Attr.init() catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        defer attr.deinit();
        var actions = PosixSpawn.Actions.init() catch |err| return globalThis.handleError(err, "in posix_spawn");
        if (comptime Environment.isMac) {
            attr.set(
                os.darwin.POSIX_SPAWN_CLOEXEC_DEFAULT | os.darwin.POSIX_SPAWN_SETSIGDEF | os.darwin.POSIX_SPAWN_SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        } else if (comptime Environment.isLinux) {
            attr.set(
                bun.C.linux.POSIX_SPAWN.SETSIGDEF | bun.C.linux.POSIX_SPAWN.SETSIGMASK,
            ) catch |err| return globalThis.handleError(err, "in posix_spawn");
        }
        defer actions.deinit();

        if (env_array.items.len == 0) {
            env_array.items = globalThis.bunVM().bundler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.handleError(err, "in posix_spawn");
            env_array.capacity = env_array.items.len;
        }

        const any_ignore = stdio[0] == .ignore or stdio[1] == .ignore or stdio[2] == .ignore;
        const dev_null_fd = @intCast(
            i32,
            if (any_ignore)
                std.os.openZ("/dev/null", std.os.O.RDONLY | std.os.O.WRONLY, 0) catch |err| {
                    globalThis.throw("failed to open /dev/null: {s}", .{err});
                    return JSValue.jsUndefined();
                }
            else
                -1,
        );

        const stdin_pipe = if (stdio[0].isPiped()) os.pipe2(os.O.NONBLOCK) catch |err| {
            globalThis.throw("failed to create stdin pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[0].isPiped()) destroyPipe(stdin_pipe);

        const stdout_pipe = if (stdio[1].isPiped()) os.pipe2(os.O.NONBLOCK) catch |err| {
            globalThis.throw("failed to create stdout pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[1].isPiped()) destroyPipe(stdout_pipe);

        const stderr_pipe = if (stdio[2].isPiped()) os.pipe2(os.O.NONBLOCK) catch |err| {
            globalThis.throw("failed to create stderr pipe: {s}", .{err});
            return JSValue.jsUndefined();
        } else undefined;
        errdefer if (stdio[2].isPiped()) destroyPipe(stderr_pipe);

        stdio[0].setUpChildIoPosixSpawn(
            &actions,
            stdin_pipe,
            std.os.STDIN_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdin");

        stdio[1].setUpChildIoPosixSpawn(
            &actions,
            stdout_pipe,
            std.os.STDOUT_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stdout");

        stdio[2].setUpChildIoPosixSpawn(
            &actions,
            stderr_pipe,
            std.os.STDERR_FILENO,
            dev_null_fd,
        ) catch |err| return globalThis.handleError(err, "in configuring child stderr");

        actions.chdir(cwd) catch |err| return globalThis.handleError(err, "in chdir()");

        argv.append(allocator, null) catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        if (env_array.items.len > 0) {
            env_array.append(allocator, null) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            };
            env = @ptrCast(@TypeOf(env), env_array.items.ptr);
        }

        const pid = switch (PosixSpawn.spawnZ(argv.items[0].?, actions, attr, @ptrCast([*:null]?[*:0]const u8, argv.items[0..].ptr), env)) {
            .err => |err| return err.toJSC(globalThis),
            .result => |pid_| pid_,
        };

        const pidfd: std.os.fd_t = brk: {
            if (Environment.isMac) {
                break :brk @intCast(std.os.fd_t, pid);
            }

            const kernel = @import("../../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

            // pidfd_nonblock only supported in 5.10+
            const flags: u32 = if (kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
                std.os.O.NONBLOCK
            else
                0;

            const fd = std.os.linux.pidfd_open(
                pid,
                flags,
            );

            switch (std.os.linux.getErrno(fd)) {
                .SUCCESS => break :brk @intCast(std.os.fd_t, fd),
                else => |err| {
                    globalThis.throwValue(JSC.Node.Syscall.Error.fromCode(err, .open).toJSC(globalThis));
                    var status: u32 = 0;
                    // ensure we don't leak the child process on error
                    _ = std.os.linux.waitpid(pid, &status, 0);
                    return JSValue.jsUndefined();
                },
            }
        };

        var subprocess = globalThis.allocator().create(Subprocess) catch {
            globalThis.throw("out of memory", .{});
            return JSValue.jsUndefined();
        };

        subprocess.* = Subprocess{
            .globalThis = globalThis,
            .pid = pid,
            .pidfd = pidfd,
            .stdin = Writable.init(std.meta.activeTag(stdio[std.os.STDIN_FILENO]), stdin_pipe[1], globalThis) catch {
                globalThis.throw("out of memory", .{});
                return JSValue.jsUndefined();
            },
            .stdout = Readable.init(std.meta.activeTag(stdio[std.os.STDOUT_FILENO]), stdout_pipe[0], globalThis),
            .stderr = Readable.init(std.meta.activeTag(stdio[std.os.STDERR_FILENO]), stderr_pipe[0], globalThis),
        };

        subprocess.this_jsvalue = subprocess.toJS(globalThis);
        subprocess.this_jsvalue.ensureStillAlive();

        switch (globalThis.bunVM().poller.watch(
            @intCast(JSC.Node.FileDescriptor, pidfd),
            .process,
            Subprocess,
            subprocess,
        )) {
            .result => {},
            .err => |err| {
                if (err.getErrno() == .SRCH) {
                    @panic("This shouldn't happen");
                }

                // process has already exited
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.onExitNotification();
            },
        }

        return subprocess.this_jsvalue;
    }

    pub fn onExitNotification(
        this: *Subprocess,
    ) void {
        this.wait(this.globalThis.bunVM());
    }

    pub fn wait(this: *Subprocess, vm: *JSC.VirtualMachine) void {
        if (this.has_waitpid_task) {
            return;
        }

        vm.uws_event_loop.?.active -|= 1;

        this.has_waitpid_task = true;
        const pid = this.pid;
        switch (PosixSpawn.waitpid(pid, 0)) {
            .err => |err| {
                this.waitpid_err = err;
            },
            .result => |status| {
                this.exit_code = @truncate(u8, status.status);
            },
        }

        this.waitpid_task = JSC.AnyTask.New(Subprocess, onExit).init(this);
        this.has_waitpid_task = true;
        vm.eventLoop().enqueueTask(JSC.Task.init(&this.waitpid_task));
    }

    fn onExit(this: *Subprocess) void {
        this.closePorts();

        this.has_waitpid_task = false;

        if (this.exit_promise != .zero) {
            var promise = this.exit_promise;
            this.exit_promise = .zero;
            if (this.exit_code) |code| {
                promise.asPromise().?.resolve(this.globalThis, JSValue.jsNumber(code));
            } else if (this.waitpid_err) |err| {
                this.waitpid_err = null;
                promise.asPromise().?.reject(this.globalThis, err.toJSC(this.globalThis));
            } else {
                // crash in debug mode
                if (comptime Environment.allow_assert)
                    unreachable;
            }
        }

        this.unref();

        if (this.finalized) {
            this.finalize();
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    const PosixSpawn = @import("./bun/spawn.zig").PosixSpawn;

    const Stdio = union(enum) {
        inherit: void,
        ignore: void,
        fd: JSC.Node.FileDescriptor,
        path: JSC.Node.PathLike,
        blob: JSC.WebCore.Blob,
        pipe: void,
        callback: JSC.JSValue,

        pub fn isPiped(self: Stdio) bool {
            return switch (self) {
                .blob, .callback, .pipe => true,
                else => false,
            };
        }

        fn setUpChildIoPosixSpawn(
            stdio: @This(),
            actions: *PosixSpawn.Actions,
            pipe_fd: [2]i32,
            std_fileno: i32,
            _: i32,
        ) !void {
            switch (stdio) {
                .blob, .callback, .pipe => {
                    const idx: usize = if (std_fileno == 0) 0 else 1;
                    try actions.dup2(pipe_fd[idx], std_fileno);
                    try actions.close(pipe_fd[1 - idx]);
                },
                .fd => |fd| {
                    try actions.dup2(fd, std_fileno);
                },
                .path => |pathlike| {
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.WRONLY) else @as(u32, std.os.O.RDONLY);
                    try actions.open(std_fileno, pathlike.slice(), flag | std.os.O.CREAT, 0o664);
                },
                .inherit => {
                    if (comptime Environment.isMac) {
                        try actions.inherit(std_fileno);
                    } else {
                        try actions.dup2(std_fileno, std_fileno);
                    }
                },
                .ignore => {
                    const flag = if (std_fileno == std.os.STDIN_FILENO) @as(u32, os.O.RDONLY) else @as(u32, std.os.O.WRONLY);
                    try actions.openZ(std_fileno, "/dev/null", flag, 0o664);
                },
            }
        }
    };

    fn extractStdio(
        globalThis: *JSC.JSGlobalObject,
        i: usize,
        value: JSValue,
        stdio_array: []Stdio,
    ) bool {
        if (value.isEmptyOrUndefinedOrNull()) {
            return true;
        }

        if (value.isString()) {
            const str = value.getZigString(globalThis);
            if (str.eqlComptime("inherit")) {
                stdio_array[i] = Stdio{ .inherit = {} };
            } else if (str.eqlComptime("ignore")) {
                stdio_array[i] = Stdio{ .ignore = {} };
            } else if (str.eqlComptime("pipe")) {
                stdio_array[i] = Stdio{ .pipe = {} };
            } else {
                globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
                return false;
            }

            return true;
        } else if (value.isNumber()) {
            const fd_ = value.toInt64();
            if (fd_ < 0) {
                globalThis.throwInvalidArguments("file descriptor must be a positive integer", .{});
                return false;
            }

            const fd = @intCast(JSC.Node.FileDescriptor, fd_);

            switch (@intCast(std.os.fd_t, i)) {
                std.os.STDIN_FILENO => {
                    if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                        globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                        return false;
                    }
                },

                std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                    if (i == std.os.STDIN_FILENO) {
                        globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                        return false;
                    }
                },
                else => {},
            }

            stdio_array[i] = Stdio{ .fd = fd };

            return true;
        } else if (value.as(JSC.WebCore.Blob)) |blob| {
            var store = blob.store orelse {
                globalThis.throwInvalidArguments("Blob is detached (in stdio)", .{});
                return false;
            };

            if (i == std.os.STDIN_FILENO and store.data == .bytes) {
                stdio_array[i] = .{ .blob = blob.dupe() };
                return true;
            }

            if (store.data != .file) {
                globalThis.throwInvalidArguments("Blob is not a file (in stdio)", .{});
                return false;
            }

            if (store.data.file.pathlike == .fd) {
                if (store.data.file.pathlike.fd == @intCast(JSC.Node.FileDescriptor, i)) {
                    stdio_array[i] = Stdio{ .inherit = {} };
                } else {
                    switch (@intCast(std.os.fd_t, i)) {
                        std.os.STDIN_FILENO => {
                            if (i == std.os.STDERR_FILENO or i == std.os.STDOUT_FILENO) {
                                globalThis.throwInvalidArguments("stdin cannot be used for stdout or stderr", .{});
                                return false;
                            }
                        },

                        std.os.STDOUT_FILENO, std.os.STDERR_FILENO => {
                            if (i == std.os.STDIN_FILENO) {
                                globalThis.throwInvalidArguments("stdout and stderr cannot be used for stdin", .{});
                                return false;
                            }
                        },
                        else => {},
                    }

                    stdio_array[i] = Stdio{ .fd = store.data.file.pathlike.fd };
                }

                return true;
            }

            stdio_array[i] = .{ .path = store.data.file.pathlike.path };
            return true;
        } else if (value.isCallable(globalThis.vm())) {
            stdio_array[i] = .{ .callback = value };
            value.ensureStillAlive();
            return true;
        }

        globalThis.throwInvalidArguments("stdio must be an array of 'inherit', 'ignore', or null", .{});
        return false;
    }
};
