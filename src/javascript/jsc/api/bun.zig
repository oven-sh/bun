const Bun = @This();
const default_allocator = @import("../../../global.zig").default_allocator;
const bun = @import("../../../global.zig");
const Environment = bun.Environment;
const NetworkThread = @import("http").NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("../../../global.zig").Output;
const MutableString = @import("../../../global.zig").MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../../identity_context.zig").IdentityContext;
const Fs = @import("../../../fs.zig");
const Resolver = @import("../../../resolver/resolver.zig");
const ast = @import("../../../import_record.zig");
const NodeModuleBundle = @import("../../../node_module_bundle.zig").NodeModuleBundle;
const MacroEntryPoint = @import("../../../bundler.zig").MacroEntryPoint;
const logger = @import("../../../logger.zig");
const Api = @import("../../../api/schema.zig").Api;
const options = @import("../../../options.zig");
const Bundler = @import("../../../bundler.zig").Bundler;
const ServerEntryPoint = @import("../../../bundler.zig").ServerEntryPoint;
const js_printer = @import("../../../js_printer.zig");
const js_parser = @import("../../../js_parser.zig");
const js_ast = @import("../../../js_ast.zig");
const hash_map = @import("../../../hash_map.zig");
const http = @import("../../../http.zig");
const NodeFallbackModules = @import("../../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../../analytics/analytics_thread.zig");
const ZigString = @import("../../../jsc.zig").ZigString;
const Runtime = @import("../../../runtime.zig");
const Router = @import("./router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../../env_loader.zig");
const ParseResult = @import("../../../bundler.zig").ParseResult;
const PackageJSON = @import("../../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../../resolver/package_json.zig").MacroMap;
const WebCore = @import("../../../jsc.zig").WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const FetchEvent = WebCore.FetchEvent;
const js = @import("../../../jsc.zig").C;
const JSC = @import("../../../jsc.zig");
const JSError = @import("../base.zig").JSError;
const d = @import("../base.zig").d;
const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("../../../jsc.zig").JSValue;
const NewClass = @import("../base.zig").NewClass;
const Microtask = @import("../../../jsc.zig").Microtask;
const JSGlobalObject = @import("../../../jsc.zig").JSGlobalObject;
const ExceptionValueRef = @import("../../../jsc.zig").ExceptionValueRef;
const JSPrivateDataPtr = @import("../../../jsc.zig").JSPrivateDataPtr;
const ZigConsoleClient = @import("../../../jsc.zig").ZigConsoleClient;
const Node = @import("../../../jsc.zig").Node;
const ZigException = @import("../../../jsc.zig").ZigException;
const ZigStackTrace = @import("../../../jsc.zig").ZigStackTrace;
const ErrorableResolvedSource = @import("../../../jsc.zig").ErrorableResolvedSource;
const ResolvedSource = @import("../../../jsc.zig").ResolvedSource;
const JSPromise = @import("../../../jsc.zig").JSPromise;
const JSInternalPromise = @import("../../../jsc.zig").JSInternalPromise;
const JSModuleLoader = @import("../../../jsc.zig").JSModuleLoader;
const JSPromiseRejectionOperation = @import("../../../jsc.zig").JSPromiseRejectionOperation;
const Exception = @import("../../../jsc.zig").Exception;
const ErrorableZigString = @import("../../../jsc.zig").ErrorableZigString;
const ZigGlobalObject = @import("../../../jsc.zig").ZigGlobalObject;
const VM = @import("../../../jsc.zig").VM;
const JSFunction = @import("../../../jsc.zig").JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../../url.zig").URL;
const Transpiler = @import("./transpiler.zig");
const VirtualMachine = @import("../javascript.zig").VirtualMachine;
const IOTask = JSC.IOTask;

const is_bindgen = JSC.is_bindgen;

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

    // when it's a small thing, rely on GC to manage the memory
    if (writer.context.pos < 2048 and array.list.items.len == 0) {
        var slice = writer.context.buffer[0..writer.context.pos];
        if (slice.len == 0) {
            return ZigString.Empty.toValue(ctx.ptr()).asObjectRef();
        }

        var zig_str = ZigString.init(slice).withEncoding();
        return zig_str.toValueGC(ctx.ptr()).asObjectRef();
    }

    // when it's a big thing, we will manage it
    {
        writer.context.flush() catch {};
        var slice = writer.context.context.toOwnedSlice();

        var zig_str = ZigString.init(slice).withEncoding();
        if (!zig_str.isUTF8()) {
            return zig_str.toExternalValue(ctx.ptr()).asObjectRef();
        } else {
            return zig_str.toValueGC(ctx.ptr()).asObjectRef();
        }
    }
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

    if (!js.JSValueIsObject(ctx, arguments[1]) or !js.JSObjectIsFunction(ctx, arguments[1])) {
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("BunSTDIN"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stdin();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            &ZigString.init("BunSTDIN"),
            JSC.JSValue.fromRef(JSC.WebCore.Blob.Class.make(ctx, blob)),
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("BunSTDERR"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stderr();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            &ZigString.init("BunSTDERR"),
            JSC.JSValue.fromRef(JSC.WebCore.Blob.Class.make(ctx, blob)),
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("BunSTDOUT"));
    if (existing.isEmpty()) {
        var rare_data = JSC.VirtualMachine.vm.rareData();
        var store = rare_data.stdout();
        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, ctx.ptr());

        return ctx.ptr().putCachedObject(
            &ZigString.init("BunSTDOUT"),
            JSC.JSValue.fromRef(JSC.WebCore.Blob.Class.make(ctx, blob)),
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

const Editor = @import("../../../open.zig").Editor;
pub fn openInEditor(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    args: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var edit = &VirtualMachine.vm.rareData().editor_context;

    var arguments = JSC.Node.ArgumentsSlice.from(args);
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
    var args = JSC.Node.ArgumentsSlice.from(arguments);
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

comptime {
    if (!is_bindgen) {
        _ = Bun__resolve;
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
        .ts = .{
            .module = .{
                .path = "bun.js/router",
                .tsdoc = "Filesystem Router supporting dynamic routes, exact routes, catch-all routes, and optional catch-all routes. Implemented in native code and only available with Bun.js.",
            },
        },
    },
    .{
        .match = .{
            .rfn = Router.match,
            .ts = Router.match_type_definition,
        },

        .sleepSync = .{
            .rfn = sleepSync,
        },
        .fetch = .{
            .rfn = Fetch.call,
            .ts = d.ts{},
        },
        .getImportedStyles = .{
            .rfn = Bun.getImportedStyles,
            .ts = d.ts{
                .name = "getImportedStyles",
                .@"return" = "string[]",
            },
        },
        .inspect = .{
            .rfn = Bun.inspect,
            .ts = d.ts{
                .name = "inspect",
                .@"return" = "string",
            },
        },
        .getRouteFiles = .{
            .rfn = Bun.getRouteFiles,
            .ts = d.ts{
                .name = "getRouteFiles",
                .@"return" = "string[]",
            },
        },
        ._Path = .{
            .rfn = Bun.newPath,
            .ts = d.ts{},
        },
        .getRouteNames = .{
            .rfn = Bun.getRouteNames,
            .ts = d.ts{
                .name = "getRouteNames",
                .@"return" = "string[]",
            },
        },
        .readFile = .{
            .rfn = Bun.readFileAsString,
            .ts = d.ts{
                .name = "readFile",
                .@"return" = "string",
            },
        },
        .resolveSync = .{
            .rfn = Bun.resolveSync,
            .ts = d.ts{
                .name = "resolveSync",
                .@"return" = "string",
            },
        },
        .resolve = .{
            .rfn = Bun.resolve,
            .ts = d.ts{
                .name = "resolve",
                .@"return" = "string",
            },
        },
        .readFileBytes = .{
            .rfn = Bun.readFileAsBytes,
            .ts = d.ts{
                .name = "readFile",
                .@"return" = "Uint8Array",
            },
        },
        .getPublicPath = .{
            .rfn = Bun.getPublicPathJS,
            .ts = d.ts{
                .name = "getPublicPath",
                .@"return" = "string",
            },
        },
        .registerMacro = .{
            .rfn = Bun.registerMacro,
            .ts = d.ts{
                .name = "registerMacro",
                .@"return" = "undefined",
            },
            .enumerable = false,
        },
        .fs = .{
            .rfn = Bun.createNodeFS,
            .ts = d.ts{},
            .enumerable = false,
        },
        .jest = .{
            .rfn = @import("../test/jest.zig").Jest.call,
            .ts = d.ts{},
            .enumerable = false,
        },
        .gc = .{
            .rfn = Bun.runGC,
            .ts = d.ts{},
        },
        .allocUnsafe = .{
            .rfn = Bun.allocUnsafe,
            .ts = .{},
        },
        .mmap = .{
            .rfn = Bun.mmapFile,
            .ts = .{},
        },
        .generateHeapSnapshot = .{
            .rfn = Bun.generateHeapSnapshot,
            .ts = d.ts{},
        },
        .shrink = .{
            .rfn = Bun.shrink,
            .ts = d.ts{},
        },
        .openInEditor = .{
            .rfn = Bun.openInEditor,
            .ts = d.ts{},
        },
        .readAllStdinSync = .{
            .rfn = Bun.readAllStdinSync,
            .ts = d.ts{},
        },
        .serve = .{
            .rfn = Bun.serve,
            .ts = d.ts{},
        },
        .file = .{
            .rfn = JSC.WebCore.Blob.constructFile,
            .ts = d.ts{},
        },
        .write = .{
            .rfn = JSC.WebCore.Blob.writeFile,
            .ts = d.ts{},
        },
        .sha = .{
            .rfn = JSC.wrapWithHasContainer(Crypto.SHA512_256, "hash", false, false),
        },
    },
    .{
        .main = .{
            .get = getMain,
            .ts = d.ts{ .name = "main", .@"return" = "string" },
        },
        .cwd = .{
            .get = getCWD,
            .ts = d.ts{ .name = "cwd", .@"return" = "string" },
        },
        .origin = .{
            .get = getOrigin,
            .ts = d.ts{ .name = "origin", .@"return" = "string" },
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
            .ts = d.ts{ .name = "routesDir", .@"return" = "string" },
        },
        .assetPrefix = .{
            .get = getAssetPrefix,
            .ts = d.ts{ .name = "assetPrefix", .@"return" = "string" },
        },
        .argv = .{
            .get = getArgv,
            .ts = d.ts{ .name = "argv", .@"return" = "string[]" },
        },
        .env = .{
            .get = EnvironmentVariables.getter,
        },

        .enableANSIColors = .{
            .get = enableANSIColors,
        },
        .Transpiler = .{
            .get = getTranspilerConstructor,
            .ts = d.ts{ .name = "Transpiler", .@"return" = "Transpiler.prototype" },
        },
        .hash = .{
            .get = getHashObject,
        },
        .TOML = .{
            .get = getTOMLObject,
            .ts = d.ts{ .name = "TOML", .@"return" = "TOML.prototype" },
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
    },
);

pub const Crypto = struct {
    const Hashers = @import("../../../sha.zig");

    fn CryptoHasher(comptime Hasher: type, comptime name: [:0]const u8, cached_constructor_name: []const u8) type {
        return struct {
            hashing: Hasher = Hasher{},

            pub fn byteLength(
                _: void,
                _: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSValueRef {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest)).asObjectRef();
            }

            pub fn byteLength2(
                _: *@This(),
                _: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSValueRef {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest)).asObjectRef();
            }

            pub const Constructor = JSC.NewConstructor(
                @This(),
                .{
                    .hash = .{
                        .rfn = JSC.wrapWithHasContainer(@This(), "hash", false, false),
                    },
                    .constructor = .{ .rfn = constructor },
                },
                .{
                    .byteLength = .{
                        .get = byteLength,
                    },
                },
            );

            pub const Class = JSC.NewClass(
                @This(),
                .{
                    .name = name,
                },
                .{
                    .update = .{
                        .rfn = JSC.wrapSync(@This(), "update"),
                    },
                    .digest = .{
                        .rfn = JSC.wrapSync(@This(), "digest"),
                    },
                    .finalize = finalize,
                },
                .{
                    .byteLength = .{
                        .get = byteLength2,
                    },
                },
            );

            fn hashToEncoding(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                encoding: JSC.Node.Encoding,
                exception: JSC.C.ExceptionRef,
            ) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;

                Hasher.hash(input.slice(), &output_digest_buf, JSC.VirtualMachine.vm.rareData().boringEngine());

                return encoding.encodeWithSize(globalThis, Hasher.digest, &output_digest_buf, exception);
            }

            fn hashToBytes(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                output: ?JSC.ArrayBuffer,
                exception: JSC.C.ExceptionRef,
            ) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        JSC.JSError(
                            bun.default_allocator,
                            comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}),
                            .{},
                            globalThis.ref(),
                            exception,
                        );
                        return JSC.JSValue.zero;
                    }
                    output_digest_slice = bytes[0..Hasher.digest];
                }

                Hasher.hash(input.slice(), output_digest_slice, JSC.VirtualMachine.vm.rareData().boringEngine());

                if (output) |output_buf| {
                    return output_buf.value;
                } else {
                    var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, output_digest_slice) catch unreachable, .Uint8Array);
                    return array_buffer_out.toJSUnchecked(globalThis.ref(), exception);
                }
            }

            pub fn hash(
                globalThis: *JSGlobalObject,
                input: JSC.Node.StringOrBuffer,
                output: ?JSC.Node.StringOrBuffer,
                exception: JSC.C.ExceptionRef,
            ) JSC.JSValue {
                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        .string => |str| {
                            const encoding = JSC.Node.Encoding.from(str) orelse {
                                JSC.JSError(
                                    bun.default_allocator,
                                    "Unknown encoding",
                                    .{},
                                    globalThis.ref(),
                                    exception,
                                );
                                return JSC.JSValue.zero;
                            };

                            return hashToEncoding(globalThis, input, encoding, exception);
                        },
                        .buffer => |buffer| {
                            return hashToBytes(globalThis, input, buffer.buffer, exception);
                        },
                    }
                } else {
                    return hashToBytes(globalThis, input, null, exception);
                }
            }

            pub fn constructor(
                ctx: js.JSContextRef,
                _: js.JSObjectRef,
                _: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSObjectRef {
                var this = bun.default_allocator.create(@This()) catch {
                    JSC.JSError(bun.default_allocator, "Failed to create new object", .{}, ctx, exception);
                    return null;
                };

                this.* = .{ .hashing = Hasher.init() };
                return @This().Class.make(ctx, this);
            }

            pub fn getter(
                _: void,
                ctx: js.JSContextRef,
                _: js.JSValueRef,
                _: js.JSStringRef,
                _: js.ExceptionRef,
            ) js.JSValueRef {
                var existing = ctx.ptr().getCachedObject(&ZigString.init(cached_constructor_name));
                if (existing.isEmpty()) {
                    return ctx.ptr().putCachedObject(
                        &ZigString.init(cached_constructor_name),
                        JSC.JSValue.fromRef(@This().Constructor.constructor(ctx)),
                    ).asObjectRef();
                }

                return existing.asObjectRef();
            }

            pub fn update(this: *@This(), thisObj: JSC.C.JSObjectRef, buffer: JSC.Node.StringOrBuffer) JSC.JSValue {
                this.hashing.update(buffer.slice());
                return JSC.JSValue.c(thisObj);
            }

            pub fn digest(
                this: *@This(),
                globalThis: *JSGlobalObject,
                output: ?JSC.Node.StringOrBuffer,
                exception: JSC.C.ExceptionRef,
            ) JSC.JSValue {
                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        .string => |str| {
                            const encoding = JSC.Node.Encoding.from(str) orelse {
                                JSC.JSError(
                                    bun.default_allocator,
                                    "Unknown encoding",
                                    .{},
                                    globalThis.ref(),
                                    exception,
                                );
                                return JSC.JSValue.zero;
                            };

                            return this.digestToEncoding(globalThis, exception, encoding);
                        },
                        .buffer => |buffer| {
                            return this.digestToBytes(
                                globalThis,
                                exception,
                                buffer.buffer,
                            );
                        },
                    }
                } else {
                    return this.digestToBytes(globalThis, exception, null);
                }
            }

            fn digestToBytes(this: *@This(), globalThis: *JSGlobalObject, exception: JSC.C.ExceptionRef, output: ?JSC.ArrayBuffer) JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        JSC.JSError(
                            bun.default_allocator,
                            comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{@as(usize, Hasher.digest)}),
                            .{},
                            globalThis.ref(),
                            exception,
                        );
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
                    return array_buffer_out.toJSUnchecked(globalThis.ref(), exception);
                }
            }

            fn digestToEncoding(this: *@This(), globalThis: *JSGlobalObject, exception: JSC.C.ExceptionRef, encoding: JSC.Node.Encoding) JSC.JSValue {
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

                return encoding.encodeWithSize(globalThis, Hasher.digest, output_digest_slice, exception);
            }

            pub fn finalize(this: *@This()) void {
                VirtualMachine.vm.allocator.destroy(this);
            }
        };
    }

    pub const SHA1 = CryptoHasher(Hashers.SHA1, "SHA1", "Bun_Crypto_SHA1");
    pub const MD5 = CryptoHasher(Hashers.MD5, "MD5", "Bun_Crypto_MD5");
    pub const MD4 = CryptoHasher(Hashers.MD4, "MD4", "Bun_Crypto_MD4");
    pub const SHA224 = CryptoHasher(Hashers.SHA224, "SHA224", "Bun_Crypto_SHA224");
    pub const SHA512 = CryptoHasher(Hashers.SHA512, "SHA512", "Bun_Crypto_SHA512");
    pub const SHA384 = CryptoHasher(Hashers.SHA384, "SHA384", "Bun_Crypto_SHA384");
    pub const SHA256 = CryptoHasher(Hashers.SHA256, "SHA256", "Bun_Crypto_SHA256");
    pub const SHA512_256 = CryptoHasher(Hashers.SHA512_256, "SHA512_256", "Bun_Crypto_SHA512_256");
    pub const MD5_SHA1 = CryptoHasher(Hashers.MD5_SHA1, "MD5_SHA1", "Bun_Crypto_MD5_SHA1");
};

pub fn serve(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var args = JSC.Node.ArgumentsSlice.from(arguments);
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

pub fn allocUnsafe(
    _: void,
    ctx: js.JSContextRef,
    _: js.JSObjectRef,
    _: js.JSObjectRef,
    arguments: []const js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef {
    var args = JSC.Node.ArgumentsSlice.from(arguments);

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
    var args = JSC.Node.ArgumentsSlice.from(arguments);

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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("BunTranspiler"));
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("BunHash"));
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
                var args = JSC.Node.ArgumentsSlice.from(arguments);
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("TOML"));
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
    var existing = ctx.ptr().getCachedObject(&ZigString.init("Unsafe"));
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
        const Reporter = @import("../../../report.zig");
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
                return ZigString.toValue(&zig_str, ctx.ptr()).asObjectRef();
            },
            else => {
                return ZigString.init(array_buffer.slice()).toValue(ctx.ptr()).asObjectRef();
            },
        }
    }
};

// pub const Lockfile = struct {
//     const BunLockfile = @import("../../../install/install.zig").Lockfile;
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
    const TOMLParser = @import("../../../toml/toml_parser.zig").TOML;
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
            NetworkThread.global.pool.io.?.timeout(
                *Timeout,
                this,
                onCallback,
                &this.completion,
                std.time.ns_per_ms * @intCast(
                    u63,
                    @maximum(
                        this.interval,
                        1,
                    ),
                ),
            );
        }

        pub fn onCallback(this: *Timeout, _: *NetworkThread.Completion, _: NetworkThread.AsyncIO.TimeoutError!void) void {
            this.io_task.?.onFinish();
        }

        pub fn then(this: *Timeout, global: *JSGlobalObject) void {
            if (comptime JSC.is_bindgen)
                unreachable;

            if (!this.cancelled) {
                if (this.repeat) {
                    this.io_task.?.deinit();
                    var task = Timeout.TimeoutTask.createOnJSThread(VirtualMachine.vm.allocator, global, this) catch unreachable;
                    this.io_task = task;
                    task.schedule();
                }

                _ = JSC.C.JSObjectCallAsFunction(global.ref(), this.callback.asObjectRef(), null, 0, null, null);

                if (this.repeat)
                    return;
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
            }
            VirtualMachine.vm.allocator.destroy(this);
            VirtualMachine.vm.timer.active -|= 1;
            VirtualMachine.vm.active_tasks -|= 1;
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
        var timeout = try VirtualMachine.vm.allocator.create(Timeout);
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
        var existing = ctx.ptr().getCachedObject(&ZigString.init("Bun.env"));
        if (existing.isEmpty()) {
            return ctx.ptr().putCachedObject(
                &ZigString.init("Bun.env"),
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
    JSC.VirtualMachine.vm.defaultErrorHandler(err, null);
}

comptime {
    if (!is_bindgen) {
        _ = Bun__reportError;
    }
}
