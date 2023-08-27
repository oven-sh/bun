/// How to add a new function or property to the Bun global
///
/// - Add a callback or property to the below struct
/// - @export it in the appropriate place
/// - Update "@begin bunObjectTable" in BunObject.cpp
///     - Getters use a generated wrapper function `BunObject_getter_wrap_<name>`
/// - Update "BunObject+exports.h"
/// - Run "make dev"
pub const BunObject = struct {
    // --- Callbacks ---
    pub const DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump = dump_mimalloc;
    pub const _Os = Bun._Os;
    pub const _Path = Bun._Path;
    pub const allocUnsafe = Bun.allocUnsafe;
    pub const build = Bun.JSBundler.buildFn;
    pub const connect = JSC.wrapStaticMethod(JSC.API.Listener, "connect", false);
    pub const deflateSync = JSC.wrapStaticMethod(JSZlib, "deflateSync", true);
    pub const file = WebCore.Blob.constructBunFile;
    pub const fs = Bun.fs;
    pub const gc = Bun.runGC;
    pub const generateHeapSnapshot = Bun.generateHeapSnapshot;
    pub const getImportedStyles = Bun.getImportedStyles;
    pub const getPublicPath = Bun.getPublicPathJS;
    pub const gunzipSync = JSC.wrapStaticMethod(JSZlib, "gunzipSync", true);
    pub const gzipSync = JSC.wrapStaticMethod(JSZlib, "gzipSync", true);
    pub const indexOfLine = Bun.indexOfLine;
    pub const inflateSync = JSC.wrapStaticMethod(JSZlib, "inflateSync", true);
    pub const jest = @import("../test/jest.zig").Jest.call;
    pub const listen = JSC.wrapStaticMethod(JSC.API.Listener, "listen", false);
    pub const mmap = Bun.mmapFile;
    pub const nanoseconds = Bun.nanoseconds;
    pub const openInEditor = Bun.openInEditor;
    pub const registerMacro = Bun.registerMacro;
    pub const resolve = Bun.resolve;
    pub const resolveSync = Bun.resolveSync;
    pub const serve = Bun.serve;
    pub const sha = JSC.wrapStaticMethod(Crypto.SHA512_256, "hash_", true);
    pub const shrink = Bun.shrink;
    pub const sleepSync = Bun.sleepSync;
    pub const spawn = JSC.wrapStaticMethod(JSC.Subprocess, "spawn", false);
    pub const spawnSync = JSC.wrapStaticMethod(JSC.Subprocess, "spawnSync", false);
    pub const which = Bun.which;
    pub const write = JSC.WebCore.Blob.writeFile;
    // --- Callbacks ---

    // --- Getters ---
    pub const CryptoHasher = Crypto.CryptoHasher.getter;
    pub const FFI = Bun.FFIObject.getter;
    pub const FileSystemRouter = Bun.getFileSystemRouter;
    pub const MD4 = Crypto.MD4.getter;
    pub const MD5 = Crypto.MD5.getter;
    pub const SHA1 = Crypto.SHA1.getter;
    pub const SHA224 = Crypto.SHA224.getter;
    pub const SHA256 = Crypto.SHA256.getter;
    pub const SHA384 = Crypto.SHA384.getter;
    pub const SHA512 = Crypto.SHA512.getter;
    pub const SHA512_256 = Crypto.SHA512_256.getter;
    pub const TOML = Bun.getTOMLObject;
    pub const Transpiler = Bun.getTranspilerConstructor;
    pub const argv = Bun.getArgv;
    pub const assetPrefix = Bun.getAssetPrefix;
    pub const cwd = Bun.getCWD;
    pub const enableANSIColors = Bun.enableANSIColors;
    pub const hash = Bun.getHashObject;
    pub const inspect = Bun.getInspect;
    pub const main = Bun.getMain;
    pub const origin = Bun.getOrigin;
    pub const stderr = Bun.getStderr;
    pub const stdin = Bun.getStdin;
    pub const stdout = Bun.getStdout;
    pub const unsafe = Bun.getUnsafe;
    // --- Getters ---

    fn getterName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_getter_" ++ baseName;
    }

    fn callbackName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_callback_" ++ baseName;
    }

    pub fn exportAll() void {
        if (!@inComptime()) {
            @compileError("Must be comptime");
        }

        if (JSC.is_bindgen) {
            return;
        }

        // --- Getters ---
        @export(BunObject.CryptoHasher, .{ .name = getterName("CryptoHasher") });
        @export(BunObject.FFI, .{ .name = getterName("FFI") });
        @export(BunObject.FileSystemRouter, .{ .name = getterName("FileSystemRouter") });
        @export(BunObject.MD4, .{ .name = getterName("MD4") });
        @export(BunObject.MD5, .{ .name = getterName("MD5") });
        @export(BunObject.SHA1, .{ .name = getterName("SHA1") });
        @export(BunObject.SHA224, .{ .name = getterName("SHA224") });
        @export(BunObject.SHA256, .{ .name = getterName("SHA256") });
        @export(BunObject.SHA384, .{ .name = getterName("SHA384") });
        @export(BunObject.SHA512, .{ .name = getterName("SHA512") });
        @export(BunObject.SHA512_256, .{ .name = getterName("SHA512_256") });
        @export(BunObject.TOML, .{ .name = getterName("TOML") });
        @export(BunObject.Transpiler, .{ .name = getterName("Transpiler") });
        @export(BunObject.argv, .{ .name = getterName("argv") });
        @export(BunObject.assetPrefix, .{ .name = getterName("assetPrefix") });
        @export(BunObject.cwd, .{ .name = getterName("cwd") });
        @export(BunObject.enableANSIColors, .{ .name = getterName("enableANSIColors") });
        @export(BunObject.hash, .{ .name = getterName("hash") });
        @export(BunObject.inspect, .{ .name = getterName("inspect") });
        @export(BunObject.main, .{ .name = getterName("main") });
        @export(BunObject.origin, .{ .name = getterName("origin") });
        @export(BunObject.stderr, .{ .name = getterName("stderr") });
        @export(BunObject.stdin, .{ .name = getterName("stdin") });
        @export(BunObject.stdout, .{ .name = getterName("stdout") });
        @export(BunObject.unsafe, .{ .name = getterName("unsafe") });
        // --- Getters --

        // -- Callbacks --
        @export(BunObject.DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump, .{ .name = callbackName("DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump") });
        @export(BunObject._Os, .{ .name = callbackName("_Os") });
        @export(BunObject._Path, .{ .name = callbackName("_Path") });
        @export(BunObject.allocUnsafe, .{ .name = callbackName("allocUnsafe") });
        @export(BunObject.build, .{ .name = callbackName("build") });
        @export(BunObject.connect, .{ .name = callbackName("connect") });
        @export(BunObject.deflateSync, .{ .name = callbackName("deflateSync") });
        @export(BunObject.file, .{ .name = callbackName("file") });
        @export(BunObject.fs, .{ .name = callbackName("fs") });
        @export(BunObject.gc, .{ .name = callbackName("gc") });
        @export(BunObject.generateHeapSnapshot, .{ .name = callbackName("generateHeapSnapshot") });
        @export(BunObject.getImportedStyles, .{ .name = callbackName("getImportedStyles") });
        @export(BunObject.gunzipSync, .{ .name = callbackName("gunzipSync") });
        @export(BunObject.gzipSync, .{ .name = callbackName("gzipSync") });
        @export(BunObject.indexOfLine, .{ .name = callbackName("indexOfLine") });
        @export(BunObject.inflateSync, .{ .name = callbackName("inflateSync") });
        @export(BunObject.jest, .{ .name = callbackName("jest") });
        @export(BunObject.listen, .{ .name = callbackName("listen") });
        @export(BunObject.mmap, .{ .name = callbackName("mmap") });
        @export(BunObject.nanoseconds, .{ .name = callbackName("nanoseconds") });
        @export(BunObject.openInEditor, .{ .name = callbackName("openInEditor") });
        @export(BunObject.registerMacro, .{ .name = callbackName("registerMacro") });
        @export(BunObject.resolve, .{ .name = callbackName("resolve") });
        @export(BunObject.resolveSync, .{ .name = callbackName("resolveSync") });
        @export(BunObject.serve, .{ .name = callbackName("serve") });
        @export(BunObject.sha, .{ .name = callbackName("sha") });
        @export(BunObject.shrink, .{ .name = callbackName("shrink") });
        @export(BunObject.sleepSync, .{ .name = callbackName("sleepSync") });
        @export(BunObject.spawn, .{ .name = callbackName("spawn") });
        @export(BunObject.spawnSync, .{ .name = callbackName("spawnSync") });
        @export(BunObject.which, .{ .name = callbackName("which") });
        @export(BunObject.write, .{ .name = callbackName("write") });
        // -- Callbacks --
    }
};

const Bun = @This();
const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.HTTP.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");

const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const logger = @import("root").bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = bun.Bundler;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const http = @import("../../bun_dev_http_server.zig");
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = @import("root").bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./filesystem_router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.bundler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = @import("root").bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const js = @import("root").bun.JSC.C;
const JSC = @import("root").bun.JSC;
const JSError = @import("../base.zig").JSError;

const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = @import("root").bun.JSC.JSValue;

const Microtask = @import("root").bun.JSC.Microtask;
const JSGlobalObject = @import("root").bun.JSC.JSGlobalObject;
const ExceptionValueRef = @import("root").bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = @import("root").bun.JSC.JSPrivateDataPtr;
const ZigConsoleClient = @import("root").bun.JSC.ZigConsoleClient;
const Node = @import("root").bun.JSC.Node;
const ZigException = @import("root").bun.JSC.ZigException;
const ZigStackTrace = @import("root").bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = @import("root").bun.JSC.ErrorableResolvedSource;
const ResolvedSource = @import("root").bun.JSC.ResolvedSource;
const JSPromise = @import("root").bun.JSC.JSPromise;
const JSInternalPromise = @import("root").bun.JSC.JSInternalPromise;
const JSModuleLoader = @import("root").bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = @import("root").bun.JSC.JSPromiseRejectionOperation;
const Exception = @import("root").bun.JSC.Exception;
const ErrorableZigString = @import("root").bun.JSC.ErrorableZigString;
const ZigGlobalObject = @import("root").bun.JSC.ZigGlobalObject;
const VM = @import("root").bun.JSC.VM;
const JSFunction = @import("root").bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = bun.JSC.API.JSTranspiler;
const JSBundler = bun.JSC.API.JSBundler;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;
const zlib = @import("../../zlib.zig");
const Which = @import("../../which.zig");
const ErrorableString = JSC.ErrorableString;
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
            VirtualMachine.get().allocator,
            import_record.path.text.len,
        ) catch unreachable;
        css_imports_buf_loaded = true;
    }

    var writer = css_imports_buf.writer();
    const offset = css_imports_buf.items.len;
    css_imports_list[css_imports_list_tail] = .{
        .offset = @as(u32, @truncate(offset)),
        .length = 0,
    };
    getPublicPath(resolve_result.path_pair.primary.text, origin, @TypeOf(writer), writer);
    const length = css_imports_buf.items.len - offset;
    css_imports_list[css_imports_list_tail].length = @as(u32, @truncate(length));
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
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments_ = callframe.arguments(2);
    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const path_arg = arguments.nextEat() orelse {
        globalThis.throw("which: expected 1 argument, got 0", .{});
        return JSC.JSValue.jsUndefined();
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
        return JSC.JSValue.jsNull();
    }

    bin_str = path_arg.toSlice(globalThis, globalThis.bunVM().allocator);

    if (bin_str.len >= bun.MAX_PATH_BYTES) {
        globalThis.throw("bin path is too long", .{});
        return JSC.JSValue.jsUndefined();
    }

    if (bin_str.len == 0) {
        return JSC.JSValue.jsNull();
    }

    path_str = ZigString.Slice.fromUTF8NeverFree(
        globalThis.bunVM().bundler.env.map.get("PATH") orelse "",
    );
    cwd_str = ZigString.Slice.fromUTF8NeverFree(
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
        return ZigString.init(bin_path).withEncoding().toValueGC(globalThis);
    }

    return JSC.JSValue.jsNull();
}

pub fn inspect(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(4).slice();
    if (arguments.len == 0)
        return bun.String.empty.toJSConst(globalThis);

    for (arguments) |arg| {
        arg.protect();
    }
    defer {
        for (arguments) |arg| {
            arg.unprotect();
        }
    }

    var formatOptions = ZigConsoleClient.FormatOptions{
        .enable_colors = false,
        .add_newline = false,
        .flush = false,
        .max_depth = 8,
        .quote_strings = true,
        .ordered_properties = false,
    };
    const value = arguments[0];

    if (arguments.len > 1) {
        const arg1 = arguments[1];

        if (arg1.isObject()) {
            if (arg1.getTruthy(globalThis, "depth")) |opt| {
                if (opt.isInt32()) {
                    const arg = opt.toInt32();
                    if (arg < 0) {
                        globalThis.throwInvalidArguments("expected depth to be greater than or equal to 0, got {d}", .{arg});
                        return .zero;
                    }
                    formatOptions.max_depth = @as(u16, @truncate(@as(u32, @intCast(@min(arg, std.math.maxInt(u16))))));
                } else if (opt.isNumber()) {
                    const v = opt.asDouble();
                    if (std.math.isInf(v)) {
                        formatOptions.max_depth = std.math.maxInt(u16);
                    } else {
                        globalThis.throwInvalidArguments("expected depth to be an integer, got {d}", .{v});
                        return .zero;
                    }
                }
            }
            if (arg1.getOptional(globalThis, "colors", bool) catch return .zero) |opt| {
                formatOptions.enable_colors = opt;
            }
            if (arg1.getOptional(globalThis, "sorted", bool) catch return .zero) |opt| {
                formatOptions.ordered_properties = opt;
            }
        } else {
            // formatOptions.show_hidden = arg1.toBoolean();
            if (arguments.len > 2) {
                var depthArg = arguments[1];
                if (depthArg.isInt32()) {
                    const arg = depthArg.toInt32();
                    if (arg < 0) {
                        globalThis.throwInvalidArguments("expected depth to be greater than or equal to 0, got {d}", .{arg});
                        return .zero;
                    }
                    formatOptions.max_depth = @as(u16, @truncate(@as(u32, @intCast(@min(arg, std.math.maxInt(u16))))));
                } else if (depthArg.isNumber()) {
                    const v = depthArg.asDouble();
                    if (std.math.isInf(v)) {
                        formatOptions.max_depth = std.math.maxInt(u16);
                    } else {
                        globalThis.throwInvalidArguments("expected depth to be an integer, got {d}", .{v});
                        return .zero;
                    }
                }
                if (arguments.len > 3) {
                    formatOptions.enable_colors = arguments[2].toBoolean();
                }
            }
        }
    }

    // very stable memory address
    var array = MutableString.init(getAllocator(globalThis), 0) catch unreachable;
    var buffered_writer_ = MutableString.BufferedWriter{ .context = &array };
    var buffered_writer = &buffered_writer_;

    var writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ZigConsoleClient.format(
        .Debug,
        globalThis,
        @as([*]const JSValue, @ptrCast(&value)),
        1,
        Writer,
        Writer,
        writer,
        formatOptions,
    );
    buffered_writer.flush() catch {
        return .undefined;
    };

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    var out = ZigString.init(array.toOwnedSliceLeaky()).withEncoding();
    const ret = out.toValueGC(globalThis);
    array.deinit();
    return ret;
}

pub fn getInspect(globalObject: *JSC.JSGlobalObject, _: *JSC.JSObject) callconv(.C) JSC.JSValue {
    const fun = JSC.createCallback(globalObject, ZigString.static("inspect"), 2, &inspect);
    var str = ZigString.init("nodejs.util.inspect.custom");
    fun.put(globalObject, ZigString.static("custom"), JSC.JSValue.symbolFor(globalObject, &str));
    return fun;
}

pub fn registerMacro(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments_ = callframe.arguments(2);
    const arguments = arguments_.slice();
    if (arguments.len != 2 or !arguments[0].isNumber()) {
        globalObject.throwInvalidArguments("Internal error registering macros: invalid args", .{});
        return .undefined;
    }
    const id = arguments[0].toInt32();
    if (id == -1 or id == 0) {
        globalObject.throwInvalidArguments("Internal error registering macros: invalid id", .{});
        return .undefined;
    }

    if (!arguments[1].isCell() or !arguments[1].isCallable(globalObject.vm())) {
        // TODO: add "toTypeOf" helper
        globalObject.throw("Macro must be a function", .{});
        return .undefined;
    }

    var get_or_put_result = VirtualMachine.get().macros.getOrPut(id) catch unreachable;
    if (get_or_put_result.found_existing) {
        get_or_put_result.value_ptr.*.?.value().unprotect();
    }

    arguments[1].protect();
    get_or_put_result.value_ptr.* = arguments[1].asObjectRef();

    return .undefined;
}

pub fn getCWD(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().bundler.fs.top_level_dir).toValueGC(globalThis);
}

pub fn getOrigin(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().origin.origin).toValueGC(globalThis);
}

pub fn getStdin(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdin();
    store.ref();
    var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
    blob.* = JSC.WebCore.Blob.initWithStore(store, globalThis);
    return blob.toJS(globalThis);
}

pub fn getStderr(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stderr();
    store.ref();
    var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
    blob.* = JSC.WebCore.Blob.initWithStore(store, globalThis);
    return blob.toJS(globalThis);
}

pub fn getStdout(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdout();
    store.ref();
    var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
    blob.* = JSC.WebCore.Blob.initWithStore(store, globalThis);
    return blob.toJS(globalThis);
}

pub fn enableANSIColors(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    _ = globalThis;
    return JSValue.jsBoolean(Output.enable_ansi_colors);
}
pub fn getMain(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return ZigString.init(globalThis.bunVM().main).toValueGC(globalThis);
}

pub fn getAssetPrefix(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().bundler.options.routes.asset_prefix_path).toValueGC(globalThis);
}

pub fn getArgv(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return JSC.Node.Process.getArgv(globalThis);
}

const Editor = @import("../../open.zig").Editor;
pub fn openInEditor(
    globalThis: js.JSContextRef,
    callframe: *JSC.CallFrame,
) callconv(.C) JSValue {
    var edit = &VirtualMachine.get().rareData().editor_context;
    const args = callframe.arguments(4);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args.slice());
    defer arguments.deinit();
    var path: string = "";
    var editor_choice: ?Editor = null;
    var line: ?string = null;
    var column: ?string = null;

    if (arguments.nextEat()) |file_path_| {
        path = file_path_.toSlice(globalThis, arguments.arena.allocator()).slice();
    }

    if (arguments.nextEat()) |opts| {
        if (!opts.isUndefinedOrNull()) {
            if (opts.getTruthy(globalThis, "editor")) |editor_val| {
                var sliced = editor_val.toSlice(globalThis, arguments.arena.allocator());
                var prev_name = edit.name;

                if (!strings.eqlLong(prev_name, sliced.slice(), true)) {
                    var prev = edit.*;
                    edit.name = sliced.slice();
                    edit.detectEditor(VirtualMachine.get().bundler.env);
                    editor_choice = edit.editor;
                    if (editor_choice == null) {
                        edit.* = prev;
                        globalThis.throw("Could not find editor \"{s}\"", .{sliced.slice()});
                        return .undefined;
                    } else if (edit.name.ptr == edit.path.ptr) {
                        edit.name = arguments.arena.allocator().dupe(u8, edit.path) catch unreachable;
                        edit.path = edit.path;
                    }
                }
            }

            if (opts.getTruthy(globalThis, "line")) |line_| {
                line = line_.toSlice(globalThis, arguments.arena.allocator()).slice();
            }

            if (opts.getTruthy(globalThis, "column")) |column_| {
                column = column_.toSlice(globalThis, arguments.arena.allocator()).slice();
            }
        }
    }

    const editor = editor_choice orelse edit.editor orelse brk: {
        edit.autoDetectEditor(VirtualMachine.get().bundler.env);
        if (edit.editor == null) {
            globalThis.throw("Failed to auto-detect editor", .{});
            return .zero;
        }

        break :brk edit.editor.?;
    };

    if (path.len == 0) {
        globalThis.throw("No file path specified", .{});
        return .zero;
    }

    editor.open(edit.path, path, line, column, arguments.arena.allocator()) catch |err| {
        globalThis.throw("Opening editor failed {s}", .{@errorName(err)});
        return .zero;
    };

    return JSC.JSValue.jsUndefined();
}

pub fn getPublicPath(to: string, origin: URL, comptime Writer: type, writer: Writer) void {
    return getPublicPathWithAssetPrefix(to, VirtualMachine.get().bundler.fs.top_level_dir, origin, VirtualMachine.get().bundler.options.routes.asset_prefix_path, comptime Writer, writer);
}

pub fn getPublicPathWithAssetPrefix(to: string, dir: string, origin: URL, asset_prefix: string, comptime Writer: type, writer: Writer) void {
    const relative_path = if (strings.hasPrefix(to, dir))
        strings.withoutTrailingSlash(to[dir.len..])
    else
        VirtualMachine.get().bundler.fs.relative(dir, to);
    if (origin.isAbsolute()) {
        if (strings.hasPrefix(relative_path, "..") or strings.hasPrefix(relative_path, "./")) {
            writer.writeAll(origin.origin) catch return;
            writer.writeAll("/abs:") catch return;
            if (std.fs.path.isAbsolute(to)) {
                writer.writeAll(to) catch return;
            } else {
                writer.writeAll(VirtualMachine.get().bundler.fs.abs(&[_]string{to})) catch return;
            }
        } else {
            origin.joinWrite(
                Writer,
                writer,
                asset_prefix,
                "",
                relative_path,
                "",
            ) catch return;
        }
    } else {
        writer.writeAll(std.mem.trimLeft(u8, relative_path, "/")) catch unreachable;
    }
}

pub fn sleepSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(1);

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if (arguments.len < 1) {
        globalObject.throwNotEnoughArguments("sleepSync", 1, 0);
        return .undefined;
    }
    const arg = arguments.slice()[0];

    // The argument must be a number
    if (!arg.isNumber()) {
        globalObject.throwInvalidArgumentType("sleepSync", "milliseconds", "number");
        return .undefined;
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    const milliseconds = arg.coerce(i32, globalObject);
    if (milliseconds < 0) {
        globalObject.throwInvalidArguments("argument to sleepSync must not be negative, got {d}", .{milliseconds});
        return .undefined;
    }

    std.time.sleep(@as(u64, @intCast(milliseconds)) * std.time.ns_per_ms);
    return .undefined;
}

pub fn generateHeapSnapshot(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    return globalObject.generateHeapSnapshot();
}

pub fn runGC(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments_ = callframe.arguments(1);
    const arguments = arguments_.slice();
    return globalObject.bunVM().garbageCollect(arguments.len > 0 and arguments[0].isBoolean() and arguments[0].toBoolean());
}
pub fn shrink(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    globalObject.vm().shrinkFootprint();
    return .undefined;
}

fn doResolve(
    globalThis: *JSC.JSGlobalObject,
    arguments: []const JSValue,
    exception: js.ExceptionRef,
) ?JSC.JSValue {
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const specifier = args.protectEatNext() orelse {
        JSC.throwInvalidArguments("Expected a specifier and a from path", .{}, globalThis, exception);
        return null;
    };

    if (specifier.isUndefinedOrNull()) {
        JSC.throwInvalidArguments("specifier must be a string", .{}, globalThis, exception);
        return null;
    }

    const from = args.protectEatNext() orelse {
        JSC.throwInvalidArguments("Expected a from path", .{}, globalThis, exception);
        return null;
    };

    if (from.isUndefinedOrNull()) {
        JSC.throwInvalidArguments("from must be a string", .{}, globalThis, exception);
        return null;
    }

    var is_esm = true;
    if (args.nextEat()) |next| {
        if (next.isBoolean()) {
            is_esm = next.toBoolean();
        } else {
            JSC.throwInvalidArguments("esm must be a boolean", .{}, globalThis, exception);
            return null;
        }
    }

    return doResolveWithArgs(globalThis, specifier.toBunString(globalThis), from.toBunString(globalThis), exception, is_esm, false);
}

fn doResolveWithArgs(
    ctx: js.JSContextRef,
    specifier: bun.String,
    from: bun.String,
    exception: js.ExceptionRef,
    is_esm: bool,
    comptime is_file_path: bool,
) ?JSC.JSValue {
    var errorable: ErrorableString = undefined;
    var query_string = ZigString.Empty;

    if (comptime is_file_path) {
        VirtualMachine.resolveFilePathForAPI(
            &errorable,
            ctx.ptr(),
            specifier,
            from,
            &query_string,
            is_esm,
        );
    } else {
        VirtualMachine.resolveForAPI(
            &errorable,
            ctx.ptr(),
            specifier,
            from,
            &query_string,
            is_esm,
        );
    }

    if (!errorable.success) {
        exception.* = bun.cast(JSC.JSValueRef, errorable.result.err.ptr.?);
        return null;
    }

    if (query_string.len > 0) {
        var stack = std.heap.stackFallback(1024, ctx.allocator());
        const allocator = stack.get();
        var arraylist = std.ArrayList(u8).initCapacity(allocator, 1024) catch unreachable;
        defer arraylist.deinit();
        arraylist.writer().print("{any}{any}", .{
            errorable.result.value,
            query_string,
        }) catch {
            JSC.JSError(allocator, "Failed to allocate memory", .{}, ctx, exception);
            return null;
        };

        return ZigString.initUTF8(arraylist.items).toValueGC(ctx);
    }

    return errorable.result.value.toJS(ctx);
}

pub fn resolveSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    const arguments = callframe.arguments(3);
    const result = doResolve(globalObject, arguments.slice(), exception);

    if (exception_[0] != null) {
        globalObject.throwValue(exception_[0].?.value());
    }

    return result orelse .zero;
}

pub fn resolve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    const arguments = callframe.arguments(3);
    const value = doResolve(globalObject, arguments.slice(), exception) orelse {
        return JSC.JSPromise.rejectedPromiseValue(globalObject, exception_[0].?.value());
    };
    return JSC.JSPromise.resolvedPromiseValue(globalObject, value);
}

export fn Bun__resolve(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    const value = doResolveWithArgs(global, specifier.toBunString(global), source.toBunString(global), exception, is_esm, true) orelse {
        return JSC.JSPromise.rejectedPromiseValue(global, exception_[0].?.value());
    };
    return JSC.JSPromise.resolvedPromiseValue(global, value);
}

export fn Bun__resolveSync(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    return doResolveWithArgs(global, specifier.toBunString(global), source.toBunString(global), exception, is_esm, true) orelse {
        return JSC.JSValue.fromRef(exception[0]);
    };
}

export fn Bun__resolveSyncWithSource(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: *bun.String,
    is_esm: bool,
) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    var exception = &exception_;
    return doResolveWithArgs(global, specifier.toBunString(global), source.*, exception, is_esm, true) orelse {
        return JSC.JSValue.fromRef(exception[0]);
    };
}

comptime {
    if (!is_bindgen) {
        _ = Bun__resolve;
        _ = Bun__resolveSync;
        _ = Bun__resolveSyncWithSource;
    }
}

pub fn getPublicPathJS(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    if (arguments.len < 1) {
        return bun.String.empty.toJSConst(globalObject);
    }
    var public_path_temp_str: [bun.MAX_PATH_BYTES]u8 = undefined;

    const to = arguments[0].toSlice(globalObject, bun.default_allocator);
    defer to.deinit();
    var stream = std.io.fixedBufferStream(&public_path_temp_str);
    var writer = stream.writer();
    getPublicPath(to.slice(), VirtualMachine.get().origin, @TypeOf(&writer), &writer);

    return ZigString.init(stream.buffer[0..stream.pos]).toValueGC(globalObject);
}

fn fs(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    var module = globalObject.allocator().create(JSC.Node.NodeJSFS) catch unreachable;
    module.* = .{};
    var vm = globalObject.bunVM();
    if (vm.standalone_module_graph != null)
        module.node_fs.vm = vm;

    return module.toJS(globalObject);
}

fn _Os(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    return Node.Os.create(globalObject);
}

fn _Path(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(1);
    const args = arguments.slice();
    const is_windows = args.len == 1 and args[0].toBoolean();
    return Node.Path.create(globalObject, is_windows);
}

/// @deprecated
fn getImportedStyles(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    defer flushCSSImports();
    const styles = getCSSImports();
    if (styles.len == 0) {
        return JSC.JSValue.createEmptyArray(globalObject, 0);
    }

    return JSValue.createStringArray(globalObject, styles.ptr, styles.len, true);
}

pub fn dump_mimalloc(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    globalObject.bunVM().arena.dumpStats();
    return .undefined;
}

pub fn indexOfLine(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
    const arguments_ = callframe.arguments(2);
    const arguments = arguments_.slice();
    if (arguments.len == 0) {
        return JSC.JSValue.jsNumberFromInt32(-1);
    }

    var buffer = arguments[0].asArrayBuffer(globalThis) orelse {
        return JSC.JSValue.jsNumberFromInt32(-1);
    };

    var offset: usize = 0;
    if (arguments.len > 1) {
        offset = @as(
            usize,
            @intCast(@max(
                arguments[1].to(u32),
                0,
            )),
        );
    }

    const bytes = buffer.byteSlice();
    var current_offset = offset;
    const end = @as(u32, @truncate(bytes.len));

    while (current_offset < end) {
        if (strings.indexOfNewlineOrNonASCII(bytes, @as(u32, @truncate(current_offset)))) |i| {
            const byte = bytes[i];
            if (byte > 0x7F) {
                current_offset += @max(strings.wtf8ByteSequenceLength(byte), 1);
                continue;
            }

            if (byte == '\r') {
                if (i + 1 < bytes.len and bytes[i + 1] == '\n') {
                    return JSC.JSValue.jsNumber(i + 1);
                }
            } else if (byte == '\n') {
                return JSC.JSValue.jsNumber(i);
            }

            current_offset = i + 1;
        } else {
            break;
        }
    }

    return JSC.JSValue.jsNumberFromInt32(-1);
}

pub const Crypto = struct {
    const Hashers = @import("../../sha.zig");

    const BoringSSL = bun.BoringSSL;
    const EVP = struct {
        ctx: BoringSSL.EVP_MD_CTX = undefined,
        md: *const BoringSSL.EVP_MD = undefined,
        algorithm: Algorithm,

        // we do this to avoid asking BoringSSL what the digest name is
        // because that API is confusing
        pub const Algorithm = enum {
            // @"DSA-SHA",
            // @"DSA-SHA1",
            // @"MD5-SHA1",
            // @"RSA-MD5",
            // @"RSA-RIPEMD160",
            // @"RSA-SHA1",
            // @"RSA-SHA1-2",
            // @"RSA-SHA224",
            // @"RSA-SHA256",
            // @"RSA-SHA384",
            // @"RSA-SHA512",
            // @"ecdsa-with-SHA1",
            blake2b256,
            md4,
            md5,
            ripemd160,
            sha1,
            sha224,
            sha256,
            sha384,
            sha512,
            @"sha512-256",

            pub const names: std.EnumArray(Algorithm, ZigString) = brk: {
                var all = std.EnumArray(Algorithm, ZigString).initUndefined();
                var iter = all.iterator();
                while (iter.next()) |entry| {
                    entry.value.* = ZigString.init(@tagName(entry.key));
                }
                break :brk all;
            };

            pub const map = bun.ComptimeStringMap(Algorithm, .{
                .{ "blake2b256", .blake2b256 },
                .{ "ripemd160", .ripemd160 },
                .{ "rmd160", .ripemd160 },
                .{ "md4", .md4 },
                .{ "md5", .md5 },
                .{ "sha1", .sha1 },
                .{ "sha128", .sha1 },
                .{ "sha224", .sha224 },
                .{ "sha256", .sha256 },
                .{ "sha384", .sha384 },
                .{ "sha512", .sha512 },
                .{ "sha-1", .sha1 },
                .{ "sha-224", .sha224 },
                .{ "sha-256", .sha256 },
                .{ "sha-384", .sha384 },
                .{ "sha-512", .sha512 },
                .{ "sha-512/256", .@"sha512-256" },
                .{ "sha-512_256", .@"sha512-256" },
                .{ "sha-512256", .@"sha512-256" },
                .{ "sha512-256", .@"sha512-256" },
                .{ "sha384", .sha384 },
                // .{ "md5-sha1", .@"MD5-SHA1" },
                // .{ "dsa-sha", .@"DSA-SHA" },
                // .{ "dsa-sha1", .@"DSA-SHA1" },
                // .{ "ecdsa-with-sha1", .@"ecdsa-with-SHA1" },
                // .{ "rsa-md5", .@"RSA-MD5" },
                // .{ "rsa-sha1", .@"RSA-SHA1" },
                // .{ "rsa-sha1-2", .@"RSA-SHA1-2" },
                // .{ "rsa-sha224", .@"RSA-SHA224" },
                // .{ "rsa-sha256", .@"RSA-SHA256" },
                // .{ "rsa-sha384", .@"RSA-SHA384" },
                // .{ "rsa-sha512", .@"RSA-SHA512" },
                // .{ "rsa-ripemd160", .@"RSA-RIPEMD160" },
            });
        };

        pub const Digest = [BoringSSL.EVP_MAX_MD_SIZE]u8;

        pub fn init(algorithm: Algorithm, md: *const BoringSSL.EVP_MD, engine: *BoringSSL.ENGINE) EVP {
            BoringSSL.load();

            var ctx: BoringSSL.EVP_MD_CTX = undefined;
            BoringSSL.EVP_MD_CTX_init(&ctx);
            _ = BoringSSL.EVP_DigestInit_ex(&ctx, md, engine);
            return .{
                .ctx = ctx,
                .md = md,
                .algorithm = algorithm,
            };
        }

        pub fn reset(this: *EVP, engine: *BoringSSL.ENGINE) void {
            _ = BoringSSL.EVP_DigestInit_ex(&this.ctx, this.md, engine);
        }

        pub fn hash(this: *EVP, engine: *BoringSSL.ENGINE, input: []const u8, output: []u8) ?u32 {
            var outsize: c_uint = @min(@as(u16, @truncate(output.len)), this.size());
            if (BoringSSL.EVP_Digest(input.ptr, input.len, output.ptr, &outsize, this.md, engine) != 1) {
                return null;
            }

            return outsize;
        }

        pub fn final(this: *EVP, engine: *BoringSSL.ENGINE, output: []u8) []const u8 {
            var outsize: u32 = @min(@as(u16, @truncate(output.len)), this.size());
            if (BoringSSL.EVP_DigestFinal_ex(
                &this.ctx,
                output.ptr,
                &outsize,
            ) != 1) {
                return "";
            }

            this.reset(engine);

            return output[0..outsize];
        }

        pub fn update(this: *EVP, input: []const u8) void {
            _ = BoringSSL.EVP_DigestUpdate(&this.ctx, input.ptr, input.len);
        }

        pub fn size(this: *EVP) u16 {
            return @as(u16, @truncate(BoringSSL.EVP_MD_CTX_size(&this.ctx)));
        }

        pub fn copy(this: *const EVP, engine: *BoringSSL.ENGINE) error{OutOfMemory}!EVP {
            var new = init(this.algorithm, this.md, engine);
            if (BoringSSL.EVP_MD_CTX_copy_ex(&new.ctx, &this.ctx) == 0) {
                return error.OutOfMemory;
            }
            return new;
        }

        pub fn byNameAndEngine(engine: *BoringSSL.ENGINE, name: []const u8) ?EVP {
            if (Algorithm.map.getWithEql(name, strings.eqlCaseInsensitiveASCIIIgnoreLength)) |algorithm| {
                if (algorithm == .blake2b256) {
                    return EVP.init(algorithm, BoringSSL.EVP_blake2b256(), engine);
                }

                switch (algorithm) {
                    .md4 => return EVP.init(algorithm, BoringSSL.EVP_md4(), engine),
                    .md5 => return EVP.init(algorithm, BoringSSL.EVP_md5(), engine),
                    .sha1 => return EVP.init(algorithm, BoringSSL.EVP_sha1(), engine),
                    .sha224 => return EVP.init(algorithm, BoringSSL.EVP_sha224(), engine),
                    .sha256 => return EVP.init(algorithm, BoringSSL.EVP_sha256(), engine),
                    .sha384 => return EVP.init(algorithm, BoringSSL.EVP_sha384(), engine),
                    .sha512 => return EVP.init(algorithm, BoringSSL.EVP_sha512(), engine),
                    .@"sha512-256" => return EVP.init(algorithm, BoringSSL.EVP_sha512_256(), engine),
                    else => {
                        if (BoringSSL.EVP_get_digestbyname(@tagName(algorithm))) |md|
                            return EVP.init(algorithm, md, engine);
                    },
                }
            }

            return null;
        }

        pub fn byName(name: ZigString, global: *JSC.JSGlobalObject) ?EVP {
            var name_str = name.toSlice(global.allocator());
            defer name_str.deinit();
            return byNameAndEngine(global.bunVM().rareData().boringEngine(), name_str.slice());
        }

        pub fn deinit(this: *EVP) void {
            // https://github.com/oven-sh/bun/issues/3250
            _ = BoringSSL.EVP_MD_CTX_cleanup(&this.ctx);
        }
    };

    fn createCryptoError(globalThis: *JSC.JSGlobalObject, err_code: u32) JSValue {
        var outbuf: [128 + 1 + "BoringSSL error: ".len]u8 = undefined;
        @memset(&outbuf, 0);
        outbuf[0.."BoringSSL error: ".len].* = "BoringSSL error: ".*;
        var message_buf = outbuf["BoringSSL error: ".len..];

        _ = BoringSSL.ERR_error_string_n(err_code, message_buf, message_buf.len);

        const error_message: []const u8 = bun.sliceTo(outbuf[0..], 0);
        if (error_message.len == "BoringSSL error: ".len) {
            return ZigString.static("Unknown BoringSSL error").toErrorInstance(globalThis);
        }

        return ZigString.fromUTF8(error_message).toErrorInstance(globalThis);
    }
    const unknown_password_algorithm_message = "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";

    pub const PasswordObject = struct {
        pub const pwhash = std.crypto.pwhash;
        pub const Algorithm = enum {
            argon2i,
            argon2d,
            argon2id,
            bcrypt,

            pub const Value = union(Algorithm) {
                argon2i: Argon2Params,
                argon2d: Argon2Params,
                argon2id: Argon2Params,
                // bcrypt only accepts "cost"
                bcrypt: u6,

                pub const bcrpyt_default = 10;

                pub const default = Algorithm.Value{
                    .argon2id = .{},
                };

                pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) ?Value {
                    if (value.isObject()) {
                        if (value.getTruthy(globalObject, "algorithm")) |algorithm_value| {
                            if (!algorithm_value.isString()) {
                                globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                                return null;
                            }

                            const algorithm_string = algorithm_value.getZigString(globalObject);

                            switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                                globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                                return null;
                            }) {
                                .bcrypt => {
                                    var algorithm = PasswordObject.Algorithm.Value{
                                        .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                                    };

                                    if (value.getTruthy(globalObject, "cost")) |rounds_value| {
                                        if (!rounds_value.isNumber()) {
                                            globalObject.throwInvalidArgumentType("hash", "cost", "number");
                                            return null;
                                        }

                                        const rounds = rounds_value.coerce(i32, globalObject);

                                        if (rounds < 4 or rounds > 31) {
                                            globalObject.throwInvalidArguments("Rounds must be between 4 and 31", .{});
                                            return null;
                                        }

                                        algorithm.bcrypt = @as(u6, @intCast(rounds));
                                    }

                                    return algorithm;
                                },
                                inline .argon2id, .argon2d, .argon2i => |tag| {
                                    var argon = Algorithm.Argon2Params{};

                                    if (value.getTruthy(globalObject, "timeCost")) |time_value| {
                                        if (!time_value.isNumber()) {
                                            globalObject.throwInvalidArgumentType("hash", "timeCost", "number");
                                            return null;
                                        }

                                        const time_cost = time_value.coerce(i32, globalObject);

                                        if (time_cost < 1) {
                                            globalObject.throwInvalidArguments("Time cost must be greater than 0", .{});
                                            return null;
                                        }

                                        argon.time_cost = @as(u32, @intCast(time_cost));
                                    }

                                    if (value.getTruthy(globalObject, "memoryCost")) |memory_value| {
                                        if (!memory_value.isNumber()) {
                                            globalObject.throwInvalidArgumentType("hash", "memoryCost", "number");
                                            return null;
                                        }

                                        const memory_cost = memory_value.coerce(i32, globalObject);

                                        if (memory_cost < 1) {
                                            globalObject.throwInvalidArguments("Memory cost must be greater than 0", .{});
                                            return null;
                                        }

                                        argon.memory_cost = @as(u32, @intCast(memory_cost));
                                    }

                                    return @unionInit(Algorithm.Value, @tagName(tag), argon);
                                },
                            }

                            unreachable;
                        } else {
                            globalObject.throwInvalidArgumentType("hash", "options.algorithm", "string");
                            return null;
                        }
                    } else if (value.isString()) {
                        const algorithm_string = value.getZigString(globalObject);

                        switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                            globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                            return null;
                        }) {
                            .bcrypt => {
                                return PasswordObject.Algorithm.Value{
                                    .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                                };
                            },
                            .argon2id => {
                                return PasswordObject.Algorithm.Value{
                                    .argon2id = .{},
                                };
                            },
                            .argon2d => {
                                return PasswordObject.Algorithm.Value{
                                    .argon2d = .{},
                                };
                            },
                            .argon2i => {
                                return PasswordObject.Algorithm.Value{
                                    .argon2i = .{},
                                };
                            },
                        }
                    } else {
                        globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                        return null;
                    }

                    unreachable;
                }
            };

            pub const Argon2Params = struct {
                // we don't support the other options right now, but can add them later if someone asks
                memory_cost: u32 = pwhash.argon2.Params.interactive_2id.m,
                time_cost: u32 = pwhash.argon2.Params.interactive_2id.t,

                pub fn toParams(this: Argon2Params) pwhash.argon2.Params {
                    return pwhash.argon2.Params{
                        .t = this.time_cost,
                        .m = this.memory_cost,
                        .p = 1,
                    };
                }
            };

            pub const argon2 = Algorithm.argon2id;

            pub const label = bun.ComptimeStringMap(
                Algorithm,
                .{
                    .{ "argon2i", .argon2i },
                    .{ "argon2d", .argon2d },
                    .{ "argon2id", .argon2id },
                    .{ "bcrypt", .bcrypt },
                },
            );

            pub const default = Algorithm.argon2;

            pub fn get(pw: []const u8) ?Algorithm {
                if (pw[0] != '$') {
                    return null;
                }

                // PHC format looks like $<algorithm>$<params>$<salt>$<hash><optional stuff>
                if (strings.hasPrefixComptime(pw[1..], "argon2d$")) {
                    return .argon2d;
                }
                if (strings.hasPrefixComptime(pw[1..], "argon2i$")) {
                    return .argon2i;
                }
                if (strings.hasPrefixComptime(pw[1..], "argon2id$")) {
                    return .argon2id;
                }

                if (strings.hasPrefixComptime(pw[1..], "bcrypt")) {
                    return .bcrypt;
                }

                // https://en.wikipedia.org/wiki/Crypt_(C)
                if (strings.hasPrefixComptime(pw[1..], "2")) {
                    return .bcrypt;
                }

                return null;
            }
        };

        pub const HashError = pwhash.Error || error{UnsupportedAlgorithm};

        // This is purposely simple because nobody asked to make it more complicated
        pub fn hash(
            allocator: std.mem.Allocator,
            password: []const u8,
            algorithm: Algorithm.Value,
        ) HashError![]const u8 {
            switch (algorithm) {
                inline .argon2i, .argon2d, .argon2id => |argon| {
                    var outbuf: [4096]u8 = undefined;
                    const hash_options = pwhash.argon2.HashOptions{
                        .params = argon.toParams(),
                        .allocator = allocator,
                        .mode = switch (algorithm) {
                            .argon2i => .argon2i,
                            .argon2d => .argon2d,
                            .argon2id => .argon2id,
                            else => unreachable,
                        },
                        .encoding = .phc,
                    };
                    // warning: argon2's code may spin up threads if paralellism is set to > 0
                    // we don't expose this option
                    // but since it parses from phc format, it's possible that it will be set
                    // eventually we should do something that about that.
                    const out_bytes = try pwhash.argon2.strHash(password, hash_options, &outbuf);
                    return try allocator.dupe(u8, out_bytes);
                },
                .bcrypt => |cost| {
                    var outbuf: [4096]u8 = undefined;
                    var outbuf_slice: []u8 = outbuf[0..];
                    var password_to_use = password;
                    // bcrypt silently truncates passwords longer than 72 bytes
                    // we use SHA512 to hash the password if it's longer than 72 bytes
                    if (password.len > 72) {
                        var sha_256 = bun.sha.SHA512.init();
                        defer sha_256.deinit();
                        sha_256.update(password);
                        sha_256.final(outbuf[0..bun.sha.SHA512.digest]);
                        password_to_use = outbuf[0..bun.sha.SHA512.digest];
                        outbuf_slice = outbuf[bun.sha.SHA512.digest..];
                    }

                    const hash_options = pwhash.bcrypt.HashOptions{
                        .params = pwhash.bcrypt.Params{ .rounds_log = cost },
                        .allocator = allocator,
                        .encoding = .crypt,
                    };
                    const out_bytes = try pwhash.bcrypt.strHash(password_to_use, hash_options, outbuf_slice);
                    return try allocator.dupe(u8, out_bytes);
                },
            }
        }

        pub fn verify(
            allocator: std.mem.Allocator,
            password: []const u8,
            previous_hash: []const u8,
            algorithm: ?Algorithm,
        ) HashError!bool {
            if (previous_hash.len == 0) {
                return false;
            }

            return verifyWithAlgorithm(
                allocator,
                password,
                previous_hash,
                algorithm orelse Algorithm.get(previous_hash) orelse return error.UnsupportedAlgorithm,
            );
        }

        pub fn verifyWithAlgorithm(
            allocator: std.mem.Allocator,
            password: []const u8,
            previous_hash: []const u8,
            algorithm: Algorithm,
        ) HashError!bool {
            switch (algorithm) {
                .argon2id, .argon2d, .argon2i => {
                    pwhash.argon2.strVerify(previous_hash, password, .{ .allocator = allocator }) catch |err| {
                        if (err == error.PasswordVerificationFailed) {
                            return false;
                        }

                        return err;
                    };
                    return true;
                },
                .bcrypt => {
                    pwhash.bcrypt.strVerify(previous_hash, password, .{ .allocator = allocator }) catch |err| {
                        if (err == error.PasswordVerificationFailed) {
                            return false;
                        }

                        return err;
                    };
                    return true;
                },
            }
        }
    };

    pub const JSPasswordObject = struct {
        const PascalToUpperUnderscoreCaseFormatter = struct {
            input: []const u8,
            pub fn format(self: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                for (self.input) |c| {
                    if (std.ascii.isUpper(c)) {
                        try writer.writeByte('_');
                        try writer.writeByte(c);
                    } else if (std.ascii.isLower(c)) {
                        try writer.writeByte(std.ascii.toUpper(c));
                    } else {
                        try writer.writeByte(c);
                    }
                }
            }
        };

        pub export fn JSPasswordObject__create(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            var object = JSValue.createEmptyObject(globalObject, 4);
            object.put(
                globalObject,
                ZigString.static("hash"),
                JSC.createCallback(globalObject, ZigString.static("hash"), 2, JSPasswordObject__hash),
            );
            object.put(
                globalObject,
                ZigString.static("hashSync"),
                JSC.createCallback(globalObject, ZigString.static("hashSync"), 2, JSPasswordObject__hashSync),
            );
            object.put(
                globalObject,
                ZigString.static("verify"),
                JSC.createCallback(globalObject, ZigString.static("verify"), 2, JSPasswordObject__verify),
            );
            object.put(
                globalObject,
                ZigString.static("verifySync"),
                JSC.createCallback(globalObject, ZigString.static("verifySync"), 2, JSPasswordObject__verifySync),
            );
            return object;
        }

        const HashJob = struct {
            algorithm: PasswordObject.Algorithm.Value,
            password: []const u8,
            promise: JSC.JSPromise.Strong,
            event_loop: *JSC.EventLoop,
            global: *JSC.JSGlobalObject,
            ref: JSC.PollRef = .{},
            task: JSC.WorkPoolTask = .{ .callback = &run },

            pub const Result = struct {
                value: Value,
                ref: JSC.PollRef = .{},

                task: JSC.AnyTask = undefined,
                promise: JSC.JSPromise.Strong,
                global: *JSC.JSGlobalObject,

                pub const Value = union(enum) {
                    err: PasswordObject.HashError,
                    hash: []const u8,

                    pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                        var error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD_{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch @panic("out of memory");
                        defer bun.default_allocator.free(error_code);
                        const instance = globalObject.createErrorInstance("Password hashing failed with error \"{s}\"", .{@errorName(this.err)});
                        instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toValueGC(globalObject));
                        return instance;
                    }
                };

                pub fn runFromJS(this: *Result) void {
                    var promise = this.promise;
                    this.promise = .{};
                    this.ref.unref(this.global.bunVM());
                    var global = this.global;
                    switch (this.value) {
                        .err => {
                            const error_instance = this.value.toErrorInstance(global);
                            bun.default_allocator.destroy(this);
                            promise.reject(global, error_instance);
                        },
                        .hash => |value| {
                            const js_string = JSC.ZigString.init(value).toValueGC(global);
                            bun.default_allocator.destroy(this);
                            promise.resolve(global, js_string);
                        },
                    }
                }
            };

            pub fn deinit(this: *HashJob) void {
                this.ref = .{};
                this.promise.strong.deinit();
                bun.default_allocator.free(this.password);
                bun.default_allocator.destroy(this);
            }

            pub fn getValue(password: []const u8, algorithm: PasswordObject.Algorithm.Value) Result.Value {
                const value = PasswordObject.hash(bun.default_allocator, password, algorithm) catch |err| {
                    return Result.Value{ .err = err };
                };
                return Result.Value{ .hash = value };
            }

            pub fn run(task: *bun.ThreadPool.Task) void {
                var this = @fieldParentPtr(HashJob, "task", task);

                var result = bun.default_allocator.create(Result) catch @panic("out of memory");
                result.* = Result{
                    .value = getValue(this.password, this.algorithm),
                    .task = JSC.AnyTask.New(Result, Result.runFromJS).init(result),
                    .promise = this.promise,
                    .global = this.global,
                    .ref = this.ref,
                };
                this.ref = .{};
                this.promise.strong = .{};

                var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("out of memory");
                concurrent_task.* = JSC.ConcurrentTask{
                    .task = JSC.Task.init(&result.task),
                    .auto_delete = true,
                };
                this.event_loop.enqueueTaskConcurrent(concurrent_task);
                this.deinit();
            }
        };
        pub fn hash(
            globalObject: *JSC.JSGlobalObject,
            password: []const u8,
            algorithm: PasswordObject.Algorithm.Value,
            comptime sync: bool,
        ) JSC.JSValue {
            std.debug.assert(password.len > 0); // caller must check

            if (comptime sync) {
                const value = HashJob.getValue(password, algorithm);
                switch (value) {
                    .err => {
                        const error_instance = value.toErrorInstance(globalObject);
                        globalObject.throwValue(error_instance);
                    },
                    .hash => |h| {
                        return JSC.ZigString.init(h).toValueGC(globalObject);
                    },
                }

                unreachable;
            }

            var job = bun.default_allocator.create(HashJob) catch @panic("out of memory");
            var promise = JSC.JSPromise.Strong.init(globalObject);

            job.* = HashJob{
                .algorithm = algorithm,
                .password = password,
                .promise = promise,
                .event_loop = globalObject.bunVM().eventLoop(),
                .global = globalObject,
            };

            job.ref.ref(globalObject.bunVM());
            JSC.WorkPool.schedule(&job.task);

            return promise.value();
        }

        pub fn verify(
            globalObject: *JSC.JSGlobalObject,
            password: []const u8,
            prev_hash: []const u8,
            algorithm: ?PasswordObject.Algorithm,
            comptime sync: bool,
        ) JSC.JSValue {
            std.debug.assert(password.len > 0); // caller must check

            if (comptime sync) {
                const value = VerifyJob.getValue(password, prev_hash, algorithm);
                switch (value) {
                    .err => {
                        const error_instance = value.toErrorInstance(globalObject);
                        globalObject.throwValue(error_instance);
                        return JSC.JSValue.undefined;
                    },
                    .pass => |pass| {
                        return JSC.JSValue.jsBoolean(pass);
                    },
                }

                unreachable;
            }

            var job = bun.default_allocator.create(VerifyJob) catch @panic("out of memory");
            var promise = JSC.JSPromise.Strong.init(globalObject);

            job.* = VerifyJob{
                .algorithm = algorithm,
                .password = password,
                .prev_hash = prev_hash,
                .promise = promise,
                .event_loop = globalObject.bunVM().eventLoop(),
                .global = globalObject,
            };

            job.ref.ref(globalObject.bunVM());
            JSC.WorkPool.schedule(&job.task);

            return promise.value();
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub export fn JSPasswordObject__hash(
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments_ = callframe.arguments(2);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 1) {
                globalObject.throwNotEnoughArguments("hash", 1, 0);
                return JSC.JSValue.undefined;
            }

            var algorithm = PasswordObject.Algorithm.Value.default;

            if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
                algorithm = PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]) orelse
                    return JSC.JSValue.undefined;
            }

            var string_or_buffer = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            if (string_or_buffer.slice().len == 0) {
                globalObject.throwInvalidArguments("password must not be empty", .{});
                string_or_buffer.deinit();
                return JSC.JSValue.undefined;
            }

            string_or_buffer.ensureCloned(bun.default_allocator) catch {
                globalObject.throwOutOfMemory();
                return JSC.JSValue.undefined;
            };

            return hash(globalObject, string_or_buffer.slice(), algorithm, false);
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub export fn JSPasswordObject__hashSync(
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments_ = callframe.arguments(2);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 1) {
                globalObject.throwNotEnoughArguments("hash", 1, 0);
                return JSC.JSValue.undefined;
            }

            var algorithm = PasswordObject.Algorithm.Value.default;

            if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
                algorithm = PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]) orelse
                    return JSC.JSValue.undefined;
            }

            var string_or_buffer = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            if (string_or_buffer.slice().len == 0) {
                globalObject.throwInvalidArguments("password must not be empty", .{});
                string_or_buffer.deinit();
                return JSC.JSValue.undefined;
            }

            string_or_buffer.ensureCloned(bun.default_allocator) catch {
                globalObject.throwOutOfMemory();
                return JSC.JSValue.undefined;
            };
            defer string_or_buffer.deinit();

            return hash(globalObject, string_or_buffer.slice(), algorithm, true);
        }

        const VerifyJob = struct {
            algorithm: ?PasswordObject.Algorithm = null,
            password: []const u8,
            prev_hash: []const u8,
            promise: JSC.JSPromise.Strong,
            event_loop: *JSC.EventLoop,
            global: *JSC.JSGlobalObject,
            ref: JSC.PollRef = .{},
            task: JSC.WorkPoolTask = .{ .callback = &run },

            pub const Result = struct {
                value: Value,
                ref: JSC.PollRef = .{},

                task: JSC.AnyTask = undefined,
                promise: JSC.JSPromise.Strong,
                global: *JSC.JSGlobalObject,

                pub const Value = union(enum) {
                    err: PasswordObject.HashError,
                    pass: bool,

                    pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                        var error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch @panic("out of memory");
                        defer bun.default_allocator.free(error_code);
                        const instance = globalObject.createErrorInstance("Password verification failed with error \"{s}\"", .{@errorName(this.err)});
                        instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toValueGC(globalObject));
                        return instance;
                    }
                };

                pub fn runFromJS(this: *Result) void {
                    var promise = this.promise;
                    this.promise = .{};
                    this.ref.unref(this.global.bunVM());
                    var global = this.global;
                    switch (this.value) {
                        .err => {
                            const error_instance = this.value.toErrorInstance(global);
                            bun.default_allocator.destroy(this);
                            promise.reject(global, error_instance);
                        },
                        .pass => |pass| {
                            bun.default_allocator.destroy(this);
                            promise.resolve(global, JSC.JSValue.jsBoolean(pass));
                        },
                    }
                }
            };

            pub fn deinit(this: *VerifyJob) void {
                this.ref = .{};
                this.promise.strong.deinit();
                bun.default_allocator.free(this.password);
                bun.default_allocator.free(this.prev_hash);
                bun.default_allocator.destroy(this);
            }

            pub fn getValue(password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm) Result.Value {
                const pass = PasswordObject.verify(bun.default_allocator, password, prev_hash, algorithm) catch |err| {
                    return Result.Value{ .err = err };
                };
                return Result.Value{ .pass = pass };
            }

            pub fn run(task: *bun.ThreadPool.Task) void {
                var this = @fieldParentPtr(VerifyJob, "task", task);

                var result = bun.default_allocator.create(Result) catch @panic("out of memory");
                result.* = Result{
                    .value = getValue(this.password, this.prev_hash, this.algorithm),
                    .task = JSC.AnyTask.New(Result, Result.runFromJS).init(result),
                    .promise = this.promise,
                    .global = this.global,
                    .ref = this.ref,
                };
                this.ref = .{};
                this.promise.strong = .{};

                var concurrent_task = bun.default_allocator.create(JSC.ConcurrentTask) catch @panic("out of memory");
                concurrent_task.* = JSC.ConcurrentTask{
                    .task = JSC.Task.init(&result.task),
                    .auto_delete = true,
                };
                this.event_loop.enqueueTaskConcurrent(concurrent_task);
                this.deinit();
            }
        };

        // Once we have bindings generator, this should be replaced with a generated function
        pub export fn JSPasswordObject__verify(
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments_ = callframe.arguments(3);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 2) {
                globalObject.throwNotEnoughArguments("verify", 2, 0);
                return JSC.JSValue.undefined;
            }

            var algorithm: ?PasswordObject.Algorithm = null;

            if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
                if (!arguments[2].isString()) {
                    globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                    return JSC.JSValue.undefined;
                }

                const algorithm_string = arguments[2].getZigString(globalObject);

                algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                    globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                    return JSC.JSValue.undefined;
                };
            }

            var password = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            var hash_ = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[1]) orelse {
                password.deinit();
                globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            if (hash_.slice().len == 0) {
                password.deinit();
                return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
            }

            if (password.slice().len == 0) {
                hash_.deinit();
                return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
            }

            password.ensureCloned(bun.default_allocator) catch {
                hash_.deinit();
                globalObject.throwOutOfMemory();
                return JSC.JSValue.undefined;
            };

            hash_.ensureCloned(bun.default_allocator) catch {
                password.deinit();
                globalObject.throwOutOfMemory();
                return JSC.JSValue.undefined;
            };

            return verify(globalObject, password.slice(), hash_.slice(), algorithm, false);
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub export fn JSPasswordObject__verifySync(
            globalObject: *JSC.JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const arguments_ = callframe.arguments(3);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 2) {
                globalObject.throwNotEnoughArguments("verify", 2, 0);
                return JSC.JSValue.undefined;
            }

            var algorithm: ?PasswordObject.Algorithm = null;

            if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
                if (!arguments[2].isString()) {
                    globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                    return JSC.JSValue.undefined;
                }

                const algorithm_string = arguments[2].getZigString(globalObject);

                algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                    globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                    return JSC.JSValue.undefined;
                };
            }

            var password = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            var hash_ = JSC.Node.SliceOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[1]) orelse {
                password.deinit();
                globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
                return JSC.JSValue.undefined;
            };

            defer password.deinit();
            defer hash_.deinit();

            if (hash_.slice().len == 0) {
                return JSC.JSValue.jsBoolean(false);
            }

            if (password.slice().len == 0) {
                return JSC.JSValue.jsBoolean(false);
            }

            return verify(globalObject, password.slice(), hash_.slice(), algorithm, true);
        }
    };

    pub const CryptoHasher = struct {
        evp: EVP = undefined,

        const Digest = EVP.Digest;

        pub usingnamespace JSC.Codegen.JSCryptoHasher;

        pub const digest = JSC.wrapInstanceMethod(CryptoHasher, "digest_", false);
        pub const hash = JSC.wrapStaticMethod(CryptoHasher, "hash_", false);

        pub fn getByteLength(
            this: *CryptoHasher,
            _: *JSC.JSGlobalObject,
        ) callconv(.C) JSC.JSValue {
            return JSC.JSValue.jsNumber(@as(u16, @truncate(this.evp.size())));
        }

        pub fn getAlgorithm(
            this: *CryptoHasher,
            globalObject: *JSC.JSGlobalObject,
        ) callconv(.C) JSC.JSValue {
            return ZigString.fromUTF8(bun.asByteSlice(@tagName(this.evp.algorithm))).toValueGC(globalObject);
        }

        pub fn getAlgorithms(
            globalThis_: *JSC.JSGlobalObject,
            _: JSValue,
            _: JSValue,
        ) callconv(.C) JSC.JSValue {
            var values = EVP.Algorithm.names.values;
            return JSC.JSValue.createStringArray(globalThis_, &values, values.len, true);
        }

        fn hashToEncoding(
            globalThis: *JSGlobalObject,
            evp: *EVP,
            input: JSC.Node.SliceOrBuffer,
            encoding: JSC.Node.Encoding,
        ) JSC.JSValue {
            var output_digest_buf: Digest = undefined;
            defer input.deinit();

            const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), &output_digest_buf) orelse {
                const err = BoringSSL.ERR_get_error();
                const instance = createCryptoError(globalThis, err);
                BoringSSL.ERR_clear_error();
                globalThis.throwValue(instance);
                return .zero;
            };
            return encoding.encodeWithMaxSize(globalThis, len, BoringSSL.EVP_MAX_MD_SIZE, &output_digest_buf);
        }

        fn hashToBytes(
            globalThis: *JSGlobalObject,
            evp: *EVP,
            input: JSC.Node.SliceOrBuffer,
            output: ?JSC.ArrayBuffer,
        ) JSC.JSValue {
            var output_digest_buf: Digest = undefined;
            var output_digest_slice: []u8 = &output_digest_buf;
            defer input.deinit();
            if (output) |output_buf| {
                const size = evp.size();
                var bytes = output_buf.byteSlice();
                if (bytes.len < size) {
                    globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{size});
                    return JSC.JSValue.zero;
                }
                output_digest_slice = bytes[0..size];
            }

            const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), output_digest_slice) orelse {
                const err = BoringSSL.ERR_get_error();
                const instance = createCryptoError(globalThis, err);
                BoringSSL.ERR_clear_error();
                globalThis.throwValue(instance);
                return .zero;
            };

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                // Clone to GC-managed memory
                return JSC.ArrayBuffer.create(globalThis, output_digest_slice[0..len], .Buffer);
            }
        }

        pub fn hash_(
            globalThis: *JSGlobalObject,
            algorithm: ZigString,
            input: JSC.Node.SliceOrBuffer,
            output: ?JSC.Node.StringOrBuffer,
        ) JSC.JSValue {
            var evp = EVP.byName(algorithm, globalThis) orelse {
                globalThis.throwInvalidArguments("Unsupported algorithm \"{any}\"", .{algorithm});
                return .zero;
            };
            defer evp.deinit();

            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    .string => |str| {
                        const encoding = JSC.Node.Encoding.from(str) orelse {
                            globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str});
                            return JSC.JSValue.zero;
                        };

                        return hashToEncoding(globalThis, &evp, input, encoding);
                    },
                    .buffer => |buffer| {
                        return hashToBytes(globalThis, &evp, input, buffer.buffer);
                    },
                }
            } else {
                return hashToBytes(globalThis, &evp, input, null);
            }
        }

        pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*CryptoHasher {
            var arguments = callframe.arguments(2);
            if (arguments.len == 0) {
                globalThis.throwInvalidArguments("Expected an algorithm name as an argument", .{});
                return null;
            }

            const algorithm_name = arguments.ptr[0];
            if (algorithm_name.isEmptyOrUndefinedOrNull() or !algorithm_name.isString()) {
                globalThis.throwInvalidArguments("algorithm must be a string", .{});
                return null;
            }

            const algorithm = algorithm_name.getZigString(globalThis);

            if (algorithm.len == 0) {
                globalThis.throwInvalidArguments("Invalid algorithm name", .{});
                return null;
            }

            const evp = EVP.byName(algorithm, globalThis) orelse {
                globalThis.throwInvalidArguments("Unsupported algorithm {any}", .{algorithm});
                return null;
            };
            var this = bun.default_allocator.create(CryptoHasher) catch return null;
            this.evp = evp;
            return this;
        }

        pub fn getter(
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.JSObject,
        ) callconv(.C) JSC.JSValue {
            return CryptoHasher.getConstructor(globalObject);
        }

        pub fn update(this: *CryptoHasher, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const thisValue = callframe.this();
            const arguments = callframe.arguments(2);
            const input = arguments.ptr[0];
            const encoding = arguments.ptr[1];
            const buffer = JSC.Node.SliceOrBuffer.fromJSWithEncoding(globalThis, globalThis.bunVM().allocator, input, encoding) orelse {
                globalThis.throwInvalidArguments("expected string or buffer", .{});
                return JSC.JSValue.zero;
            };

            defer buffer.deinit();

            this.evp.update(buffer.slice());
            const err = BoringSSL.ERR_get_error();
            if (err != 0) {
                const instance = createCryptoError(globalThis, err);
                BoringSSL.ERR_clear_error();
                globalThis.throwValue(instance);
                return .zero;
            }

            return thisValue;
        }

        pub fn copy(
            this: *CryptoHasher,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            const new = bun.default_allocator.create(CryptoHasher) catch @panic("Out of memory");
            new.evp = this.evp.copy(globalObject.bunVM().rareData().boringEngine()) catch @panic("Out of memory");
            return new.toJS(globalObject);
        }

        pub fn digest_(
            this: *@This(),
            globalThis: *JSGlobalObject,
            output: ?JSC.Node.SliceOrBuffer,
        ) JSC.JSValue {
            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    .string => |str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            globalThis.throwInvalidArguments("Unknown encoding: {}", .{str});
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

        fn digestToBytes(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) JSC.JSValue {
            var output_digest_buf: EVP.Digest = undefined;
            var output_digest_slice: []u8 = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < output_digest_buf.len) {
                    globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{output_digest_buf.len}), .{});
                    return JSC.JSValue.zero;
                }
                output_digest_slice = bytes[0..bytes.len];
            } else {
                output_digest_buf = std.mem.zeroes(EVP.Digest);
            }

            const result = this.evp.final(globalThis.bunVM().rareData().boringEngine(), output_digest_slice);

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                // Clone to GC-managed memory
                return JSC.ArrayBuffer.create(globalThis, result, .Buffer);
            }
        }

        fn digestToEncoding(this: *CryptoHasher, globalThis: *JSGlobalObject, encoding: JSC.Node.Encoding) JSC.JSValue {
            var output_digest_buf: EVP.Digest = std.mem.zeroes(EVP.Digest);

            var output_digest_slice: []u8 = &output_digest_buf;

            const out = this.evp.final(globalThis.bunVM().rareData().boringEngine(), output_digest_slice);

            return encoding.encodeWithMaxSize(globalThis, out.len, BoringSSL.EVP_MAX_MD_SIZE, out);
        }

        pub fn finalize(this: *CryptoHasher) callconv(.C) void {
            // https://github.com/oven-sh/bun/issues/3250
            this.evp.deinit();

            bun.default_allocator.destroy(this);
        }
    };

    fn StaticCryptoHasher(comptime Hasher: type, comptime name: [:0]const u8) type {
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

                if (comptime @typeInfo(@TypeOf(Hasher.hash)).Fn.params.len == 3) {
                    Hasher.hash(input.slice(), &output_digest_buf, JSC.VirtualMachine.get().rareData().boringEngine());
                } else {
                    Hasher.hash(input.slice(), &output_digest_buf);
                }

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

                if (comptime @typeInfo(@TypeOf(Hasher.hash)).Fn.params.len == 3) {
                    Hasher.hash(input.slice(), output_digest_slice, JSC.VirtualMachine.get().rareData().boringEngine());
                } else {
                    Hasher.hash(input.slice(), output_digest_slice);
                }

                if (output) |output_buf| {
                    return output_buf.value;
                } else {
                    var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, output_digest_slice) catch unreachable, .Uint8Array);
                    return array_buffer_out.toJSUnchecked(globalThis, null);
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
                globalObject: *JSC.JSGlobalObject,
                _: *JSC.JSObject,
            ) callconv(.C) JSC.JSValue {
                return ThisHasher.getConstructor(globalObject);
            }

            pub fn update(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
                const thisValue = callframe.this();
                const input = callframe.argument(0);
                const buffer = JSC.Node.SliceOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, input) orelse {
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
                output: ?JSC.Node.SliceOrBuffer,
            ) JSC.JSValue {
                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        .string => |str| {
                            const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                                globalThis.throwInvalidArguments("Unknown encoding: \"{s}\"", .{str.slice()});
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
                    return array_buffer_out.toJSUnchecked(globalThis, null);
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
                VirtualMachine.get().allocator.destroy(this);
            }
        };
    }

    pub const SHA1 = StaticCryptoHasher(Hashers.SHA1, "SHA1");
    pub const MD5 = StaticCryptoHasher(Hashers.MD5, "MD5");
    pub const MD4 = StaticCryptoHasher(Hashers.MD4, "MD4");
    pub const SHA224 = StaticCryptoHasher(Hashers.SHA224, "SHA224");
    pub const SHA512 = StaticCryptoHasher(Hashers.SHA512, "SHA512");
    pub const SHA384 = StaticCryptoHasher(Hashers.SHA384, "SHA384");
    pub const SHA256 = StaticCryptoHasher(Hashers.SHA256, "SHA256");
    pub const SHA512_256 = StaticCryptoHasher(Hashers.SHA512_256, "SHA512_256");
};

pub fn nanoseconds(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const ns = globalThis.bunVM().origin_timer.read();
    return JSC.JSValue.jsNumberFromUint64(ns);
}

pub fn serve(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(2).slice();
    var config: JSC.API.ServerConfig = brk: {
        var exception_ = [1]JSC.JSValueRef{null};
        var exception = &exception_;

        var args = JSC.Node.ArgumentsSlice.init(globalObject.bunVM(), arguments);
        const config_ = JSC.API.ServerConfig.fromJS(globalObject.ptr(), &args, exception);
        if (exception[0] != null) {
            globalObject.throwValue(exception_[0].?.value());
            return .undefined;
        }

        break :brk config_;
    };

    var exception_value: *JSC.JSValue = undefined;

    if (config.allow_hot) {
        if (globalObject.bunVM().hotMap()) |hot| {
            if (config.id.len == 0) {
                config.id = config.computeID(globalObject.allocator());
            }

            if (hot.getEntry(config.id)) |entry| {
                switch (entry.tag()) {
                    @field(@TypeOf(entry.tag()), @typeName(JSC.API.HTTPServer)) => {
                        var server: *JSC.API.HTTPServer = entry.as(JSC.API.HTTPServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.thisObject;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(JSC.API.DebugHTTPServer)) => {
                        var server: *JSC.API.DebugHTTPServer = entry.as(JSC.API.DebugHTTPServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.thisObject;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(JSC.API.DebugHTTPSServer)) => {
                        var server: *JSC.API.DebugHTTPSServer = entry.as(JSC.API.DebugHTTPSServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.thisObject;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(JSC.API.HTTPSServer)) => {
                        var server: *JSC.API.HTTPSServer = entry.as(JSC.API.HTTPSServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.thisObject;
                    },
                    else => {},
                }
            }
        }
    }

    // Listen happens on the next tick!
    // This is so we can return a Server object
    if (config.ssl_config != null) {
        if (config.development) {
            var server = JSC.API.DebugHTTPSServer.init(config, globalObject.ptr());
            exception_value = &server.thisObject;
            server.listen();
            if (!server.thisObject.isEmpty()) {
                exception_value.unprotect();
                globalObject.throwValue(server.thisObject);
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return .zero;
            }
            const obj = server.toJS(globalObject);
            obj.protect();

            server.thisObject = obj;

            if (config.allow_hot) {
                if (globalObject.bunVM().hotMap()) |hot| {
                    hot.insert(config.id, server);
                }
            }
            return obj;
        } else {
            var server = JSC.API.HTTPSServer.init(config, globalObject.ptr());
            exception_value = &server.thisObject;
            server.listen();
            if (!exception_value.isEmpty()) {
                exception_value.unprotect();
                globalObject.throwValue(exception_value.*);
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return .zero;
            }
            const obj = server.toJS(globalObject);
            obj.protect();
            server.thisObject = obj;

            if (config.allow_hot) {
                if (globalObject.bunVM().hotMap()) |hot| {
                    hot.insert(config.id, server);
                }
            }
            return obj;
        }
    } else {
        if (config.development) {
            var server = JSC.API.DebugHTTPServer.init(config, globalObject.ptr());
            exception_value = &server.thisObject;
            server.listen();
            if (!exception_value.isEmpty()) {
                exception_value.unprotect();
                globalObject.throwValue(exception_value.*);
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return .zero;
            }
            const obj = server.toJS(globalObject);
            obj.protect();
            server.thisObject = obj;

            if (config.allow_hot) {
                if (globalObject.bunVM().hotMap()) |hot| {
                    hot.insert(config.id, server);
                }
            }
            return obj;
        } else {
            var server = JSC.API.HTTPServer.init(config, globalObject.ptr());
            exception_value = &server.thisObject;
            server.listen();
            if (!exception_value.isEmpty()) {
                exception_value.unprotect();
                globalObject.throwValue(exception_value.*);
                server.thisObject = JSC.JSValue.zero;
                server.deinit();
                return .zero;
            }
            const obj = server.toJS(globalObject);
            obj.protect();

            server.thisObject = obj;

            if (config.allow_hot) {
                if (globalObject.bunVM().hotMap()) |hot| {
                    hot.insert(config.id, server);
                }
            }
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
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(1);
    const size = arguments.ptr[0];
    if (!size.isUInt32AsAnyInt()) {
        globalThis.throwInvalidArguments("Expected a positive number", .{});
        return JSC.JSValue.zero;
    }

    return JSC.JSValue.createUninitializedUint8Array(globalThis, size.toUInt64NoTruncate());
}

pub fn mmapFile(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    if (comptime Environment.isWindows) {
        globalThis.throwTODO("mmapFile is not supported on Windows");
        return JSC.JSValue.zero;
    }

    const arguments_ = callframe.arguments(2);
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer args.deinit();

    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    const path = brk: {
        if (args.nextEat()) |path| {
            if (path.isString()) {
                const path_str = path.toSlice(globalThis, args.arena.allocator());
                if (path_str.len > bun.MAX_PATH_BYTES) {
                    globalThis.throwInvalidArguments("Path too long", .{});
                    return JSC.JSValue.zero;
                }
                const paths = &[_]string{path_str.slice()};
                break :brk bun.path.joinAbsStringBuf(bun.fs.FileSystem.instance.top_level_dir, &buf, paths, .auto);
            }
        }
        globalThis.throwInvalidArguments("Expected a path", .{});
        return JSC.JSValue.zero;
    };

    buf[path.len] = 0;

    const buf_z: [:0]const u8 = buf[0..path.len :0];

    const sync_flags: u32 = if (@hasDecl(std.os.MAP, "SYNC")) std.os.MAP.SYNC | std.os.MAP.SHARED_VALIDATE else 0;
    const file_flags: u32 = if (@hasDecl(std.os.MAP, "FILE")) std.os.MAP.FILE else 0;

    // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
    var offset: usize = 0;
    var flags = file_flags;
    var map_size: ?usize = null;

    if (args.nextEat()) |opts| {
        const sync = opts.get(globalThis, "sync") orelse JSC.JSValue.jsBoolean(false);
        const shared = opts.get(globalThis, "shared") orelse JSC.JSValue.jsBoolean(true);
        flags |= @as(u32, if (sync.toBoolean()) sync_flags else 0);
        flags |= @as(u32, if (shared.toBoolean()) std.os.MAP.SHARED else std.os.MAP.PRIVATE);

        if (opts.get(globalThis, "size")) |value| {
            map_size = @as(usize, @intCast(value.toInt64()));
        }

        if (opts.get(globalThis, "offset")) |value| {
            offset = @as(usize, @intCast(value.toInt64()));
            offset = std.mem.alignBackwardAnyAlign(offset, std.mem.page_size);
        }
    } else {
        flags |= std.os.MAP.SHARED;
    }

    const map = switch (bun.sys.mmapFile(buf_z, flags, map_size, offset)) {
        .result => |map| map,

        .err => |err| {
            globalThis.throwValue(err.toJSC(globalThis));
            return .zero;
        },
    };

    return JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(globalThis, JSC.C.JSTypedArrayType.kJSTypedArrayTypeUint8Array, @as(?*anyopaque, @ptrCast(map.ptr)), map.len, struct {
        pub fn x(ptr: ?*anyopaque, size: ?*anyopaque) callconv(.C) void {
            _ = bun.sys.munmap(@as([*]align(std.mem.page_size) u8, @ptrCast(@alignCast(ptr)))[0..@intFromPtr(size)]);
        }
    }.x, @as(?*anyopaque, @ptrFromInt(map.len)), null).?.value();
}

pub fn getTranspilerConstructor(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return JSC.API.JSTranspiler.getConstructor(globalThis);
}

pub fn getFileSystemRouter(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return JSC.API.FileSystemRouter.getConstructor(globalThis);
}

pub fn getHashObject(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return HashObject.create(globalThis);
}

const HashObject = struct {
    pub const wyhash = hashWrap(std.hash.Wyhash).hash;
    pub const adler32 = hashWrap(std.hash.Adler32).hash;
    pub const crc32 = hashWrap(std.hash.Crc32).hash;
    pub const cityHash32 = hashWrap(std.hash.CityHash32).hash;
    pub const cityHash64 = hashWrap(std.hash.CityHash64).hash;
    pub const murmur32v2 = hashWrap(std.hash.murmur.Murmur2_32).hash;
    pub const murmur32v3 = hashWrap(std.hash.murmur.Murmur3_32).hash;
    pub const murmur64v2 = hashWrap(std.hash.murmur.Murmur2_64).hash;

    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const function = JSC.createCallback(globalThis, ZigString.static("hash"), 1, &wyhash);
        const fns = comptime .{
            "wyhash",
            "adler32",
            "crc32",
            "cityHash32",
            "cityHash64",
            "murmur32v2",
            "murmur32v3",
            "murmur64v2",
        };
        inline for (fns) |name| {
            const value = JSC.createCallback(
                globalThis,
                ZigString.static(name),
                1,
                &@field(HashObject, name),
            );
            function.put(globalThis, comptime ZigString.static(name), value);
        }

        return function;
    }

    fn hashWrap(comptime Hasher_: anytype) type {
        return struct {
            const Hasher = Hasher_;
            pub fn hash(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(.C) JSC.JSValue {
                const arguments = callframe.arguments(2).slice();
                var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
                defer args.deinit();

                var input: []const u8 = "";
                var input_slice = ZigString.Slice.empty;
                defer input_slice.deinit();
                if (args.nextEat()) |arg| {
                    if (arg.as(JSC.WebCore.Blob)) |blob| {
                        // TODO: files
                        input = blob.sharedView();
                    } else {
                        switch (arg.jsTypeLoose()) {
                            .ArrayBuffer,
                            .Int8Array,
                            .Uint8Array,
                            .Uint8ClampedArray,
                            .Int16Array,
                            .Uint16Array,
                            .Int32Array,
                            .Uint32Array,
                            .Float32Array,
                            .Float64Array,
                            .BigInt64Array,
                            .BigUint64Array,
                            .DataView,
                            => {
                                var array_buffer = arg.asArrayBuffer(globalThis) orelse {
                                    globalThis.throwInvalidArguments("ArrayBuffer conversion error", .{});
                                    return .zero;
                                };
                                input = array_buffer.byteSlice();
                            },
                            else => {
                                input_slice = arg.toSlice(globalThis, bun.default_allocator);
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
                    return JSC.JSValue.jsNumber(Function(input));
                } else {
                    var seed: u64 = 0;
                    if (args.nextEat()) |arg| {
                        if (arg.isNumber() or arg.isBigInt()) {
                            seed = arg.toUInt64NoTruncate();
                        }
                    }
                    if (comptime std.meta.trait.isNumber(@TypeOf(function_args[0]))) {
                        function_args[0] = @as(@TypeOf(function_args[0]), @truncate(seed));
                        function_args[1] = input;
                    } else {
                        function_args[0] = input;
                        function_args[1] = @as(@TypeOf(function_args[1]), @truncate(seed));
                    }

                    const value = @call(.auto, Function, function_args);

                    if (@TypeOf(value) == u32) {
                        return JSC.JSValue.jsNumber(@as(u32, @bitCast(value)));
                    }
                    return JSC.JSValue.fromUInt64NoTruncate(globalThis, value);
                }
            }
        };
    }
};

pub fn getTOMLObject(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return TOMLObject.create(globalThis);
}

pub fn getUnsafe(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(.C) JSC.JSValue {
    return UnsafeObject.create(globalThis);
}

const UnsafeObject = struct {
    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const object = JSValue.createEmptyObject(globalThis, 3);
        const fields = comptime .{
            .gcAggressionLevel = &gcAggressionLevel,
            .segfault = &__debug__doSegfault,
            .arrayBufferToString = &arrayBufferToString,
        };
        inline for (comptime std.meta.fieldNames(@TypeOf(fields))) |name| {
            object.put(
                globalThis,
                comptime ZigString.static(name),
                JSC.createCallback(globalThis, comptime ZigString.static(name), 1, comptime @field(fields, name)),
            );
        }
        return object;
    }

    pub fn gcAggressionLevel(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const ret = JSValue.jsNumber(@as(i32, @intFromEnum(globalThis.bunVM().aggressive_garbage_collection)));
        const value = callframe.arguments(1).ptr[0];

        if (!value.isEmptyOrUndefinedOrNull()) {
            switch (value.coerce(i32, globalThis)) {
                1 => globalThis.bunVM().aggressive_garbage_collection = .mild,
                2 => globalThis.bunVM().aggressive_garbage_collection = .aggressive,
                0 => globalThis.bunVM().aggressive_garbage_collection = .none,
                else => {},
            }
        }
        return ret;
    }

    // For testing the segfault handler
    pub fn __debug__doSegfault(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const Reporter = @import("../../report.zig");
        Reporter.globalError(error.SegfaultTest, null);
    }

    pub fn arrayBufferToString(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        const args = callframe.arguments(2).slice();
        const array_buffer = JSC.ArrayBuffer.fromTypedArray(globalThis, args[0]);
        switch (array_buffer.typed_array_type) {
            .Uint16Array, .Int16Array => {
                var zig_str = ZigString.init("");
                zig_str._unsafe_ptr_do_not_use = @as([*]const u8, @ptrCast(@alignCast(array_buffer.ptr)));
                zig_str.len = array_buffer.len;
                zig_str.markUTF16();
                return zig_str.toValueGC(globalThis);
            },
            else => {
                return ZigString.init(array_buffer.slice()).toValueGC(globalThis);
            },
        }
    }
};

const TOMLObject = struct {
    const TOMLParser = @import("../../toml/toml_parser.zig").TOML;

    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const object = JSValue.createEmptyObject(globalThis, 1);
        object.put(
            globalThis,
            ZigString.static("parse"),
            JSC.createCallback(
                globalThis,
                ZigString.static("parse"),
                1,
                &parse,
            ),
        );

        return object;
    }

    pub fn parse(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        var arena = @import("root").bun.ArenaAllocator.init(globalThis.allocator());
        var allocator = arena.allocator();
        defer arena.deinit();
        var log = logger.Log.init(default_allocator);
        const arguments = callframe.arguments(1).slice();

        var input_slice = arguments[0].toSlice(globalThis, bun.default_allocator);
        defer input_slice.deinit();
        var source = logger.Source.initPathString("input.toml", input_slice.slice());
        var parse_result = TOMLParser.parse(&source, &log, allocator) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to parse toml"));
            return .zero;
        };

        // for now...
        var buffer_writer = js_printer.BufferWriter.init(allocator) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
            return .zero;
        };
        var writer = js_printer.BufferPrinter.init(buffer_writer);
        _ = js_printer.printJSON(*js_printer.BufferPrinter, &writer, parse_result, &source) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
            return .zero;
        };

        var slice = writer.ctx.buffer.toOwnedSliceLeaky();
        var out = bun.String.fromUTF8(slice);
        defer out.deref();

        return out.toJSForParseJSON(globalThis);
    }
};

const Debugger = JSC.Debugger;

pub const Timer = struct {
    last_id: i32 = 1,
    warned: bool = false,

    // We split up the map here to avoid storing an extra "repeat" boolean
    maps: struct {
        setTimeout: TimeoutMap = .{},
        setInterval: TimeoutMap = .{},
        setImmediate: TimeoutMap = .{},

        pub inline fn get(this: *@This(), kind: Timeout.Kind) *TimeoutMap {
            return switch (kind) {
                .setTimeout => &this.setTimeout,
                .setInterval => &this.setInterval,
                .setImmediate => &this.setImmediate,
            };
        }
    } = .{},

    /// TimeoutMap is map of i32 to nullable Timeout structs
    /// i32 is exposed to JavaScript and can be used with clearTimeout, clearInterval, etc.
    /// When Timeout is null, it means the tasks have been scheduled but not yet executed.
    /// Timeouts are enqueued as a task to be run on the next tick of the task queue
    /// The task queue runs after the event loop tasks have been run
    /// Therefore, there is a race condition where you cancel the task after it has already been enqueued
    /// In that case, it shouldn't run. It should be skipped.
    pub const TimeoutMap = std.AutoArrayHashMapUnmanaged(
        i32,
        ?Timeout,
    );

    pub fn getNextID() callconv(.C) i32 {
        VirtualMachine.get().timer.last_id +%= 1;
        return VirtualMachine.get().timer.last_id;
    }

    const uws = @import("root").bun.uws;

    // TODO: reference count to avoid multiple Strong references to the same
    // object in setInterval
    const CallbackJob = struct {
        id: i32 = 0,
        task: JSC.AnyTask = undefined,
        ref: JSC.Ref = JSC.Ref.init(),
        globalThis: *JSC.JSGlobalObject,
        callback: JSC.Strong = .{},
        arguments: JSC.Strong = .{},
        kind: Timeout.Kind = .setTimeout,

        pub const Task = JSC.AnyTask.New(CallbackJob, perform);

        pub export fn CallbackJob__onResolve(_: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const args = callframe.arguments(2);
            if (args.len < 2) {
                return JSValue.jsUndefined();
            }

            var this = args.ptr[1].asPtr(CallbackJob);
            this.deinit();
            return JSValue.jsUndefined();
        }

        pub export fn CallbackJob__onReject(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const args = callframe.arguments(2);
            if (args.len < 2) {
                return JSValue.jsUndefined();
            }

            var this = args.ptr[1].asPtr(CallbackJob);
            globalThis.bunVM().onUnhandledError(globalThis, args.ptr[0]);
            this.deinit();
            return JSValue.jsUndefined();
        }

        pub fn deinit(this: *CallbackJob) void {
            this.callback.deinit();
            this.arguments.deinit();
            this.ref.unref(this.globalThis.bunVM());
            bun.default_allocator.destroy(this);
        }

        pub fn perform(this: *CallbackJob) void {
            var globalThis = this.globalThis;
            var vm = globalThis.bunVM();
            const kind = this.kind;
            var map: *TimeoutMap = vm.timer.maps.get(kind);

            const should_cancel_job = brk: {
                // This doesn't deinit the timer
                // Timers are deinit'd separately
                // We do need to handle when the timer is cancelled after the job has been enqueued
                if (kind != .setInterval) {
                    if (map.get(this.id)) |tombstone_or_timer| {
                        break :brk tombstone_or_timer != null;
                    } else {
                        // clearTimeout has been called
                        break :brk true;
                    }
                } else {
                    if (map.getPtr(this.id)) |tombstone_or_timer| {
                        // Disable thundering herd of setInterval() calls
                        if (tombstone_or_timer.* != null) {
                            tombstone_or_timer.*.?.has_scheduled_job = false;
                        }

                        // .refresh() was called after CallbackJob enqueued
                        break :brk tombstone_or_timer.* == null;
                    }
                }

                break :brk false;
            };

            if (should_cancel_job) {
                if (vm.isInspectorEnabled()) {
                    Debugger.didCancelAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
                }
                this.deinit();
                return;
            } else if (kind != .setInterval) {
                _ = map.swapRemove(this.id);
            }

            var args_buf: [8]JSC.JSValue = undefined;
            var args: []JSC.JSValue = &.{};
            var args_needs_deinit = false;
            defer if (args_needs_deinit) bun.default_allocator.free(args);

            const callback = this.callback.get() orelse @panic("Expected CallbackJob to have a callback function");

            if (this.arguments.trySwap()) |arguments| {
                // Bun.sleep passes a Promise
                if (arguments.jsType() == .JSPromise) {
                    args_buf[0] = arguments;
                    args = args_buf[0..1];
                } else {
                    const count = arguments.getLength(globalThis);
                    if (count > 0) {
                        if (count > args_buf.len) {
                            args = bun.default_allocator.alloc(JSC.JSValue, count) catch unreachable;
                            args_needs_deinit = true;
                        } else {
                            args = args_buf[0..count];
                        }
                        var arg = args.ptr;
                        var i: u32 = 0;
                        while (i < count) : (i += 1) {
                            arg[0] = JSC.JSObject.getIndex(arguments, globalThis, @as(u32, @truncate(i)));
                            arg += 1;
                        }
                    }
                }
            }

            if (vm.isInspectorEnabled()) {
                Debugger.willDispatchAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
            }

            const result = callback.callWithGlobalThis(
                globalThis,
                args,
            );

            if (vm.isInspectorEnabled()) {
                Debugger.didDispatchAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = this.id, .kind = kind }));
            }

            if (result.isEmptyOrUndefinedOrNull() or !result.isCell()) {
                this.deinit();
                return;
            }

            if (result.isAnyError()) {
                vm.onUnhandledError(globalThis, result);
                this.deinit();
                return;
            }

            if (result.asAnyPromise()) |promise| {
                switch (promise.status(globalThis.vm())) {
                    .Rejected => {
                        this.deinit();
                        vm.onUnhandledError(globalThis, promise.result(globalThis.vm()));
                    },
                    .Fulfilled => {
                        this.deinit();

                        // get the value out of the promise
                        _ = promise.result(globalThis.vm());
                    },
                    .Pending => {
                        result.then(globalThis, this, CallbackJob__onResolve, CallbackJob__onReject);
                    },
                }
            } else {
                this.deinit();
            }
        }
    };

    pub const TimerObject = struct {
        id: i32 = -1,
        kind: Timeout.Kind = .setTimeout,
        ref_count: u16 = 1,
        interval: i32 = 0,
        // we do not allow the timer to be refreshed after we call clearInterval/clearTimeout
        has_cleaned_up: bool = false,

        pub usingnamespace JSC.Codegen.JSTimeout;

        pub fn init(globalThis: *JSGlobalObject, id: i32, kind: Timeout.Kind, interval: i32, callback: JSValue, arguments: JSValue) JSValue {
            var timer = globalThis.allocator().create(TimerObject) catch unreachable;
            timer.* = .{
                .id = id,
                .kind = kind,
                .interval = interval,
            };
            var timer_js = timer.toJS(globalThis);
            timer_js.ensureStillAlive();
            TimerObject.argumentsSetCached(timer_js, globalThis, arguments);
            TimerObject.callbackSetCached(timer_js, globalThis, callback);
            timer_js.ensureStillAlive();
            return timer_js;
        }

        pub fn doRef(this: *TimerObject, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const this_value = callframe.this();
            this_value.ensureStillAlive();
            if (this.ref_count > 0)
                this.ref_count +|= 1;

            var vm = globalObject.bunVM();
            switch (this.kind) {
                .setTimeout, .setImmediate, .setInterval => {
                    if (vm.timer.maps.get(this.kind).getPtr(this.id)) |val_| {
                        if (val_.*) |*val| {
                            val.poll_ref.ref(vm);

                            if (val.did_unref_timer) {
                                val.did_unref_timer = false;
                                vm.uws_event_loop.?.num_polls += 1;
                            }
                        }
                    }
                },
            }

            return this_value;
        }

        pub fn doRefresh(this: *TimerObject, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            // TODO: this is not the optimal way to do this but it works, we should revisit this and optimize it
            // like truly resetting the timer instead of removing and re-adding when possible
            const this_value = callframe.this();

            // setImmediate does not support refreshing and we do not support refreshing after cleanup
            if (this.has_cleaned_up or this.id == -1 or this.kind == .setImmediate) {
                return JSValue.jsUndefined();
            }
            const vm = globalThis.bunVM();
            var map = vm.timer.maps.get(this.kind);

            // reschedule the event
            if (TimerObject.callbackGetCached(this_value)) |callback| {
                callback.ensureStillAlive();

                const id: Timeout.ID = .{
                    .id = this.id,
                    .kind = this.kind,
                };

                if (this.kind == .setTimeout and this.interval == 0) {
                    var cb: CallbackJob = .{
                        .callback = JSC.Strong.create(callback, globalThis),
                        .globalThis = globalThis,
                        .id = this.id,
                        .kind = this.kind,
                    };

                    if (TimerObject.argumentsGetCached(this_value)) |arguments| {
                        arguments.ensureStillAlive();
                        cb.arguments = JSC.Strong.create(arguments, globalThis);
                    }

                    var job = vm.allocator.create(CallbackJob) catch @panic(
                        "Out of memory while allocating Timeout",
                    );

                    job.* = cb;
                    job.task = CallbackJob.Task.init(job);
                    job.ref.ref(vm);

                    // cancel the current event if exists before re-adding it
                    if (map.fetchSwapRemove(this.id)) |timer| {
                        if (timer.value != null) {
                            var value = timer.value.?;
                            value.deinit();
                        }
                    }

                    vm.enqueueTask(JSC.Task.init(&job.task));
                    if (vm.isInspectorEnabled()) {
                        Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, id.asyncID(), true);
                    }

                    map.put(vm.allocator, this.id, null) catch unreachable;
                    return this_value;
                }

                var timeout = Timeout{
                    .callback = JSC.Strong.create(callback, globalThis),
                    .globalThis = globalThis,
                    .timer = uws.Timer.create(
                        vm.uws_event_loop.?,
                        id,
                    ),
                };

                if (TimerObject.argumentsGetCached(this_value)) |arguments| {
                    arguments.ensureStillAlive();
                    timeout.arguments = JSC.Strong.create(arguments, globalThis);
                }

                timeout.poll_ref.ref(vm);

                // cancel the current event if exists before re-adding it
                if (map.fetchSwapRemove(this.id)) |timer| {
                    if (timer.value != null) {
                        var value = timer.value.?;
                        value.deinit();
                    }
                }

                map.put(vm.allocator, this.id, timeout) catch unreachable;

                timeout.timer.set(
                    id,
                    Timeout.run,
                    this.interval,
                    @as(i32, @intFromBool(this.kind == .setInterval)) * this.interval,
                );
                return this_value;
            }
            return JSValue.jsUndefined();
        }

        pub fn doUnref(this: *TimerObject, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            const this_value = callframe.this();
            this_value.ensureStillAlive();
            this.ref_count -|= 1;
            var vm = globalObject.bunVM();
            switch (this.kind) {
                .setTimeout, .setImmediate, .setInterval => {
                    if (vm.timer.maps.get(this.kind).getPtr(this.id)) |val_| {
                        if (val_.*) |*val| {
                            val.poll_ref.unref(vm);

                            if (!val.did_unref_timer) {
                                val.did_unref_timer = true;
                                vm.uws_event_loop.?.num_polls -= 1;
                            }
                        }
                    }
                },
            }

            return this_value;
        }
        pub fn hasRef(this: *TimerObject, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
            return JSValue.jsBoolean(this.ref_count > 0 and globalObject.bunVM().timer.maps.get(this.kind).contains(this.id));
        }
        pub fn toPrimitive(this: *TimerObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
            return JSValue.jsNumber(this.id);
        }

        pub fn markHasClear(this: *TimerObject) void {
            this.has_cleaned_up = true;
        }

        pub fn finalize(this: *TimerObject) callconv(.C) void {
            bun.default_allocator.destroy(this);
        }
    };

    pub const Timeout = struct {
        callback: JSC.Strong = .{},
        globalThis: *JSC.JSGlobalObject,
        timer: *uws.Timer,
        did_unref_timer: bool = false,
        poll_ref: JSC.PollRef = JSC.PollRef.init(),
        arguments: JSC.Strong = .{},
        has_scheduled_job: bool = false,

        pub const Kind = enum(u32) {
            setTimeout,
            setInterval,
            setImmediate,
        };

        // this is sized to be the same as one pointer
        pub const ID = extern struct {
            id: i32,

            kind: Kind = Kind.setTimeout,

            pub inline fn asyncID(this: ID) u64 {
                return @bitCast(this);
            }

            pub fn repeats(this: ID) bool {
                return this.kind == .setInterval;
            }
        };

        pub fn run(timer: *uws.Timer) callconv(.C) void {
            const timer_id: ID = timer.as(ID);

            // use the threadlocal despite being slow on macOS
            // to handle the timeout being cancelled after already enqueued
            var vm = JSC.VirtualMachine.get();

            const repeats = timer_id.repeats();

            var map = vm.timer.maps.get(timer_id.kind);

            var this_: ?Timeout = map.get(
                timer_id.id,
            ) orelse return;
            var this = this_ orelse
                return;

            var globalThis = this.globalThis;

            // Disable thundering herd of setInterval() calls
            // Skip setInterval() calls when the previous one has not been run yet.
            if (repeats and this.has_scheduled_job) {
                return;
            }

            var cb: CallbackJob = .{
                .callback = if (repeats)
                    JSC.Strong.create(
                        this.callback.get() orelse {
                            // if the callback was freed, that's an error
                            if (comptime Environment.allow_assert)
                                unreachable;

                            this.deinit();
                            _ = map.swapRemove(timer_id.id);
                            return;
                        },
                        globalThis,
                    )
                else
                    this.callback,
                .arguments = if (repeats and this.arguments.has())
                    JSC.Strong.create(
                        this.arguments.get() orelse {
                            // if the arguments freed, that's an error
                            if (comptime Environment.allow_assert)
                                unreachable;

                            this.deinit();
                            _ = map.swapRemove(timer_id.id);
                            return;
                        },
                        globalThis,
                    )
                else
                    this.arguments,
                .globalThis = globalThis,
                .id = timer_id.id,
                .kind = timer_id.kind,
            };

            // This allows us to:
            //  - free the memory before the job is run
            //  - reuse the JSC.Strong
            if (!repeats) {
                this.callback = .{};
                this.arguments = .{};
                map.put(vm.allocator, timer_id.id, null) catch unreachable;
                this.deinit();
            } else {
                this.has_scheduled_job = true;
                map.put(vm.allocator, timer_id.id, this) catch {};
            }

            var job = vm.allocator.create(CallbackJob) catch @panic(
                "Out of memory while allocating Timeout",
            );

            job.* = cb;
            job.task = CallbackJob.Task.init(job);
            job.ref.ref(vm);

            vm.enqueueTask(JSC.Task.init(&job.task));
            if (vm.isInspectorEnabled()) {
                Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, timer_id.asyncID(), !repeats);
            }
        }

        pub fn deinit(this: *Timeout) void {
            JSC.markBinding(@src());

            var vm = this.globalThis.bunVM();

            this.poll_ref.unref(vm);

            this.timer.deinit();

            // balance double unreffing in doUnref
            vm.uws_event_loop.?.num_polls += @as(i32, @intFromBool(this.did_unref_timer));

            this.callback.deinit();
            this.arguments.deinit();
        }
    };

    fn set(
        id: i32,
        globalThis: *JSGlobalObject,
        callback: JSValue,
        interval: i32,
        arguments_array_or_zero: JSValue,
        repeat: bool,
    ) !void {
        JSC.markBinding(@src());
        var vm = globalThis.bunVM();

        const kind: Timeout.Kind = if (repeat) .setInterval else .setTimeout;

        var map = vm.timer.maps.get(kind);

        // setImmediate(foo)
        // setTimeout(foo, 0)
        if (kind == .setTimeout and interval == 0) {
            var cb: CallbackJob = .{
                .callback = JSC.Strong.create(callback, globalThis),
                .globalThis = globalThis,
                .id = id,
                .kind = kind,
            };

            if (arguments_array_or_zero != .zero) {
                cb.arguments = JSC.Strong.create(arguments_array_or_zero, globalThis);
            }

            var job = vm.allocator.create(CallbackJob) catch @panic(
                "Out of memory while allocating Timeout",
            );

            job.* = cb;
            job.task = CallbackJob.Task.init(job);
            job.ref.ref(vm);

            vm.enqueueTask(JSC.Task.init(&job.task));
            if (vm.isInspectorEnabled()) {
                Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
            }
            map.put(vm.allocator, id, null) catch unreachable;
            return;
        }

        var timeout = Timeout{
            .callback = JSC.Strong.create(callback, globalThis),
            .globalThis = globalThis,
            .timer = uws.Timer.create(
                vm.uws_event_loop.?,
                Timeout.ID{
                    .id = id,
                    .kind = kind,
                },
            ),
        };

        if (arguments_array_or_zero != .zero) {
            timeout.arguments = JSC.Strong.create(arguments_array_or_zero, globalThis);
        }

        timeout.poll_ref.ref(vm);
        map.put(vm.allocator, id, timeout) catch unreachable;

        if (vm.isInspectorEnabled()) {
            Debugger.didScheduleAsyncCall(globalThis, .DOMTimer, Timeout.ID.asyncID(.{ .id = id, .kind = kind }), !repeat);
        }

        timeout.timer.set(
            Timeout.ID{
                .id = id,
                .kind = kind,
            },
            Timeout.run,
            interval,
            @as(i32, @intFromBool(kind == .setInterval)) * interval,
        );
    }

    pub fn setTimeout(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
        arguments: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const id = globalThis.bunVM().timer.last_id;
        globalThis.bunVM().timer.last_id +%= 1;

        const interval: i32 = @max(
            countdown.coerce(i32, globalThis),
            0,
        );

        const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

        Timer.set(id, globalThis, wrappedCallback, interval, arguments, false) catch
            return JSValue.jsUndefined();

        return TimerObject.init(globalThis, id, .setTimeout, interval, wrappedCallback, arguments);
    }
    pub fn setInterval(
        globalThis: *JSGlobalObject,
        callback: JSValue,
        countdown: JSValue,
        arguments: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const id = globalThis.bunVM().timer.last_id;
        globalThis.bunVM().timer.last_id +%= 1;

        const wrappedCallback = callback.withAsyncContextIfNeeded(globalThis);

        // We don't deal with nesting levels directly
        // but we do set the minimum timeout to be 1ms for repeating timers
        const interval: i32 = @max(
            countdown.coerce(i32, globalThis),
            1,
        );
        Timer.set(id, globalThis, wrappedCallback, interval, arguments, true) catch
            return JSValue.jsUndefined();

        return TimerObject.init(globalThis, id, .setInterval, interval, wrappedCallback, arguments);
    }

    pub fn clearTimer(timer_id_value: JSValue, globalThis: *JSGlobalObject, repeats: bool) void {
        JSC.markBinding(@src());

        const kind: Timeout.Kind = if (repeats) .setInterval else .setTimeout;
        var vm = globalThis.bunVM();
        var map = vm.timer.maps.get(kind);

        const id: Timeout.ID = .{
            .id = brk: {
                if (timer_id_value.isAnyInt()) {
                    break :brk timer_id_value.coerce(i32, globalThis);
                }

                if (TimerObject.fromJS(timer_id_value)) |timer_obj| {
                    timer_obj.markHasClear();
                    break :brk timer_obj.id;
                }

                return;
            },
            .kind = kind,
        };

        var timer = map.fetchSwapRemove(id.id) orelse return;
        if (vm.isInspectorEnabled()) {
            Debugger.didCancelAsyncCall(globalThis, .DOMTimer, id.asyncID());
        }

        if (timer.value == null) {
            // this timer was scheduled to run but was cancelled before it was run
            // so long as the callback isn't already in progress, fetchSwapRemove will handle invalidating it
            return;
        }

        timer.value.?.deinit();
    }

    pub fn clearTimeout(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        Timer.clearTimer(id, globalThis, false);
        return JSValue.jsUndefined();
    }
    pub fn clearInterval(
        globalThis: *JSGlobalObject,
        id: JSValue,
    ) callconv(.C) JSValue {
        JSC.markBinding(@src());
        Timer.clearTimer(id, globalThis, true);
        return JSValue.jsUndefined();
    }

    const Shimmer = @import("../bindings/shimmer.zig").Shimmer;

    pub const shim = Shimmer("Bun", "Timer", @This());
    pub const name = "Bun__Timer";
    pub const include = "";
    pub const namespace = shim.namespace;

    pub const Export = shim.exportFunctions(.{
        .setTimeout = setTimeout,
        .setInterval = setInterval,
        .clearTimeout = clearTimeout,
        .clearInterval = clearInterval,
        .getNextID = getNextID,
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

pub const FFIObject = struct {
    const fields = .{
        .viewSource = JSC.wrapStaticMethod(
            JSC.FFI,
            "print",
            false,
        ),
        .dlopen = JSC.wrapStaticMethod(JSC.FFI, "open", false),
        .callback = JSC.wrapStaticMethod(JSC.FFI, "callback", false),
        .linkSymbols = JSC.wrapStaticMethod(JSC.FFI, "linkSymbols", false),
        .toBuffer = JSC.wrapStaticMethod(@This(), "toBuffer", false),
        .toArrayBuffer = JSC.wrapStaticMethod(@This(), "toArrayBuffer", false),
        .closeCallback = JSC.wrapStaticMethod(JSC.FFI, "closeCallback", false),
        .CString = JSC.wrapStaticMethod(Bun.FFIObject, "newCString", false),
    };

    pub fn newCString(globalThis: *JSGlobalObject, value: JSValue, byteOffset: ?JSValue, lengthValue: ?JSValue) JSC.JSValue {
        switch (FFIObject.getPtrSlice(globalThis, value, byteOffset, lengthValue)) {
            .err => |err| {
                return err;
            },
            .slice => |slice| {
                return WebCore.Encoder.toString(slice.ptr, slice.len, globalThis, .utf8);
            },
        }
    }

    pub const dom_call = JSC.DOMCall("FFI", @This(), "ptr", f64, JSC.DOMEffect.forRead(.TypedArrayProperties));

    pub fn toJS(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        const object = JSC.JSValue.createEmptyObject(globalObject, comptime std.meta.fieldNames(@TypeOf(fields)).len + 2);
        inline for (comptime std.meta.fieldNames(@TypeOf(fields))) |field| {
            object.put(
                globalObject,
                comptime ZigString.static(field),
                JSC.createCallback(globalObject, comptime ZigString.static(field), 1, comptime @field(fields, field)),
            );
        }

        dom_call.put(globalObject, object);
        object.put(globalObject, ZigString.static("read"), Reader.toJS(globalObject));

        return object;
    }

    pub const Reader = struct {
        pub const DOMCalls = .{
            .u8 = JSC.DOMCall("Reader", @This(), "u8", i32, JSC.DOMEffect.forRead(.World)),
            .u16 = JSC.DOMCall("Reader", @This(), "u16", i32, JSC.DOMEffect.forRead(.World)),
            .u32 = JSC.DOMCall("Reader", @This(), "u32", i32, JSC.DOMEffect.forRead(.World)),
            .ptr = JSC.DOMCall("Reader", @This(), "ptr", i52, JSC.DOMEffect.forRead(.World)),
            .i8 = JSC.DOMCall("Reader", @This(), "i8", i32, JSC.DOMEffect.forRead(.World)),
            .i16 = JSC.DOMCall("Reader", @This(), "i16", i32, JSC.DOMEffect.forRead(.World)),
            .i32 = JSC.DOMCall("Reader", @This(), "i32", i32, JSC.DOMEffect.forRead(.World)),
            .i64 = JSC.DOMCall("Reader", @This(), "i64", i64, JSC.DOMEffect.forRead(.World)),
            .u64 = JSC.DOMCall("Reader", @This(), "u64", u64, JSC.DOMEffect.forRead(.World)),
            .intptr = JSC.DOMCall("Reader", @This(), "intptr", i52, JSC.DOMEffect.forRead(.World)),
            .f32 = JSC.DOMCall("Reader", @This(), "f32", f64, JSC.DOMEffect.forRead(.World)),
            .f64 = JSC.DOMCall("Reader", @This(), "f64", f64, JSC.DOMEffect.forRead(.World)),
        };

        pub fn toJS(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            const obj = JSC.JSValue.createEmptyObject(globalThis, std.meta.fieldNames(@TypeOf(Reader.DOMCalls)).len);

            inline for (comptime std.meta.fieldNames(@TypeOf(Reader.DOMCalls))) |field| {
                @field(Reader.DOMCalls, field).put(globalThis, obj);
            }

            return obj;
        }

        pub fn @"u8"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u16"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn ptr(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i8"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i16"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn intptr(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f32"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f64"(
            _: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"i64"(
            global: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.fromInt64NoTruncate(global, value);
        }

        pub fn @"u64"(
            global: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.fromUInt64NoTruncate(global, value);
        }

        pub fn u8WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn u16WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn u32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn ptrWithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i8WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i16WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn intptrWithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn f32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn f64WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn u64WithoutTypeChecks(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.fromUInt64NoTruncate(global, value);
        }

        pub fn i64WithoutTypeChecks(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(.C) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.fromInt64NoTruncate(global, value);
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
        return JSValue.fromPtrAddress(@intFromPtr(array.ptr()));
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
            return JSC.toInvalidArguments("Expected ArrayBufferView but received {s}", .{@tagName(value.jsType())}, globalThis);
        };

        if (array_buffer.len == 0) {
            return JSC.toInvalidArguments("ArrayBufferView must have a length > 0. A pointer to empty memory doesn't work", .{}, globalThis);
        }

        var addr: usize = @intFromPtr(array_buffer.ptr);
        // const Sizes = @import("../bindings/sizes.zig");
        // std.debug.assert(addr == @intFromPtr(value.asEncoded().ptr) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector);

        if (byteOffset) |off| {
            if (!off.isEmptyOrUndefinedOrNull()) {
                if (!off.isNumber()) {
                    return JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis);
                }
            }

            const bytei64 = off.toInt64();
            if (bytei64 < 0) {
                addr -|= @as(usize, @intCast(bytei64 * -1));
            } else {
                addr += @as(usize, @intCast(bytei64));
            }

            if (addr > @intFromPtr(array_buffer.ptr) + @as(usize, array_buffer.byte_len)) {
                return JSC.toInvalidArguments("byteOffset out of bounds", .{}, globalThis);
            }
        }

        if (addr > max_addressible_memory) {
            return JSC.toInvalidArguments("Pointer is outside max addressible memory, which usually means a bug in your program.", .{}, globalThis);
        }

        if (addr == 0) {
            return JSC.toInvalidArguments("Pointer must not be 0", .{}, globalThis);
        }

        if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
            return JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis);
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
            return .{ .err = JSC.toInvalidArguments("ptr must be a number.", .{}, globalThis) };
        }

        const num = value.asPtrAddress();
        if (num == 0) {
            return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis) };
        }

        // if (!std.math.isFinite(num)) {
        //     return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis) };
        // }

        var addr = @as(usize, @bitCast(num));

        if (byteOffset) |byte_off| {
            if (byte_off.isNumber()) {
                const off = byte_off.toInt64();
                if (off < 0) {
                    addr -|= @as(usize, @intCast(off * -1));
                } else {
                    addr +|= @as(usize, @intCast(off));
                }

                if (addr == 0) {
                    return .{ .err = JSC.toInvalidArguments("ptr cannot be zero, that would segfault Bun :(", .{}, globalThis) };
                }

                if (!std.math.isFinite(byte_off.asNumber())) {
                    return .{ .err = JSC.toInvalidArguments("ptr must be a finite number.", .{}, globalThis) };
                }
            } else if (!byte_off.isEmptyOrUndefinedOrNull()) {
                // do nothing
            } else {
                return .{ .err = JSC.toInvalidArguments("Expected number for byteOffset", .{}, globalThis) };
            }
        }

        if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
            return .{ .err = JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis) };
        }

        if (byteLength) |valueLength| {
            if (!valueLength.isEmptyOrUndefinedOrNull()) {
                if (!valueLength.isNumber()) {
                    return .{ .err = JSC.toInvalidArguments("length must be a number.", .{}, globalThis) };
                }

                if (valueLength.asNumber() == 0.0) {
                    return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis) };
                }

                const length_i = valueLength.toInt64();
                if (length_i < 0) {
                    return .{ .err = JSC.toInvalidArguments("length must be > 0. This usually means a bug in your code.", .{}, globalThis) };
                }

                if (length_i > max_addressible_memory) {
                    return .{ .err = JSC.toInvalidArguments("length exceeds max addressable memory. This usually means a bug in your code.", .{}, globalThis) };
                }

                const length = @as(usize, @intCast(length_i));
                return .{ .slice = @as([*]u8, @ptrFromInt(addr))[0..length] };
            }
        }

        return .{ .slice = bun.span(@as([*:0]u8, @ptrFromInt(addr))) };
    }

    fn getCPtr(value: JSValue) ?usize {
        // pointer to C function
        if (value.isNumber()) {
            const addr = value.asPtrAddress();
            if (addr > 0) return addr;
        } else if (value.isBigInt()) {
            const addr = @as(u64, @bitCast(value.toUInt64NoTruncate()));
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
                        callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));

                        if (finalizationCtxOrPtr) |ctx_value| {
                            if (getCPtr(ctx_value)) |ctx_ptr| {
                                ctx = @as(*anyopaque, @ptrFromInt(ctx_ptr));
                            } else if (!ctx_value.isUndefinedOrNull()) {
                                return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                            }
                        }
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                } else if (finalizationCtxOrPtr) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                }

                return JSC.ArrayBuffer.fromBytes(slice, JSC.JSValue.JSType.ArrayBuffer).toJSWithContext(globalThis, ctx, callback, null);
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
                        callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));

                        if (finalizationCtxOrPtr) |ctx_value| {
                            if (getCPtr(ctx_value)) |ctx_ptr| {
                                ctx = @as(*anyopaque, @ptrFromInt(ctx_ptr));
                            } else if (!ctx_value.isEmptyOrUndefinedOrNull()) {
                                return JSC.toInvalidArguments("Expected user data to be a C pointer (number or BigInt)", .{}, globalThis);
                            }
                        }
                    } else if (!callback_value.isEmptyOrUndefinedOrNull()) {
                        return JSC.toInvalidArguments("Expected callback to be a C pointer (number or BigInt)", .{}, globalThis);
                    }
                } else if (finalizationCtxOrPtr) |callback_value| {
                    if (getCPtr(callback_value)) |callback_ptr| {
                        callback = @as(JSC.C.JSTypedArrayBytesDeallocator, @ptrFromInt(callback_ptr));
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
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.JSObject,
    ) callconv(.C) JSC.JSValue {
        return FFIObject.toJS(globalObject);
    }
};

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
// This is aliased to Bun.env
pub const EnvironmentVariables = struct {
    pub export fn Bun__getEnvNames(globalObject: *JSC.JSGlobalObject, names: [*]ZigString, max: usize) usize {
        return getEnvNames(globalObject, names[0..max]);
    }

    pub export fn Bun__getEnvValue(globalObject: *JSC.JSGlobalObject, name: *ZigString, value: *ZigString) bool {
        if (getEnvValue(globalObject, name.*)) |val| {
            value.* = val;
            return true;
        }

        return false;
    }

    pub fn getEnvNames(globalObject: *JSC.JSGlobalObject, names: []ZigString) usize {
        var vm = globalObject.bunVM();
        const keys = vm.bundler.env.map.map.keys();
        const len = @min(names.len, keys.len);
        for (keys[0..len], names[0..len]) |key, *name| {
            name.* = ZigString.initUTF8(key);
        }
        return len;
    }
    pub fn getEnvValue(globalObject: *JSC.JSGlobalObject, name: ZigString) ?ZigString {
        var vm = globalObject.bunVM();
        var sliced = name.toSlice(vm.allocator);
        defer sliced.deinit();
        const value = vm.bundler.env.map.map.get(sliced.slice()) orelse return null;
        return ZigString.initUTF8(value);
    }
};

export fn Bun__reportError(globalObject: *JSGlobalObject, err: JSC.JSValue) void {
    JSC.VirtualMachine.runErrorHandlerWithDedupe(globalObject.bunVM(), err, null);
}

comptime {
    if (!is_bindgen) {
        _ = Bun__reportError;
        _ = EnvironmentVariables.Bun__getEnvNames;
        _ = EnvironmentVariables.Bun__getEnvValue;
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
                    opts.windowBits = window.coerce(i32, globalThis);
                }

                if (options_val.get(globalThis, "level")) |level| {
                    opts.level = level.coerce(i32, globalThis);
                }

                if (options_val.get(globalThis, "memLevel")) |memLevel| {
                    opts.memLevel = memLevel.coerce(i32, globalThis);
                }

                if (options_val.get(globalThis, "strategy")) |strategy| {
                    opts.strategy = strategy.coerce(i32, globalThis);
                }
            }
        }

        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.get().allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibCompressorArrayList.init(compressed, &list, allocator, opts) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis);
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis);
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) catch @panic("TODO") };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
    }

    pub fn inflateSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
    ) JSValue {
        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.get().allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibReaderArrayList.initWithOptions(compressed, &list, allocator, .{
            .windowBits = -15,
        }) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis);
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis);
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) catch @panic("TODO") };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
    }

    pub fn gunzipSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
    ) JSValue {
        var compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.get().allocator;
        var list = std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32) catch unreachable;
        var reader = zlib.ZlibReaderArrayList.init(compressed, &list, allocator) catch |err| {
            if (err == error.InvalidArgument) {
                return JSC.toInvalidArguments("Invalid buffer", .{}, globalThis);
            }

            return JSC.toInvalidArguments("Unexpected", .{}, globalThis);
        };

        reader.readAll() catch {
            defer reader.deinit();
            if (reader.errorMessage()) |msg| {
                return ZigString.init(msg).toErrorInstance(globalThis);
            }
            return ZigString.init("Zlib returned an error").toErrorInstance(globalThis);
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) catch @panic("TODO") };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
    }
};

pub usingnamespace @import("./bun/subprocess.zig");

comptime {
    if (!JSC.is_bindgen) {
        _ = Crypto.JSPasswordObject.JSPasswordObject__create;
        BunObject.exportAll();
    }
}
