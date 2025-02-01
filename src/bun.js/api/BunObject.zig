const conv = std.builtin.CallingConvention.Unspecified;
const S3File = @import("../webcore/S3File.zig");
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
    pub const allocUnsafe = toJSCallback(Bun.allocUnsafe);
    pub const build = toJSCallback(Bun.JSBundler.buildFn);
    pub const color = toJSCallback(bun.css.CssColor.jsFunctionColor);
    pub const connect = toJSCallback(JSC.wrapStaticMethod(JSC.API.Listener, "connect", false));
    pub const createParsedShellScript = toJSCallback(bun.shell.ParsedShellScript.createParsedShellScript);
    pub const createShellInterpreter = toJSCallback(bun.shell.Interpreter.createShellInterpreter);
    pub const deflateSync = toJSCallback(JSZlib.deflateSync);
    pub const file = toJSCallback(WebCore.Blob.constructBunFile);
    pub const gunzipSync = toJSCallback(JSZlib.gunzipSync);
    pub const gzipSync = toJSCallback(JSZlib.gzipSync);
    pub const indexOfLine = toJSCallback(Bun.indexOfLine);
    pub const inflateSync = toJSCallback(JSZlib.inflateSync);
    pub const jest = toJSCallback(@import("../test/jest.zig").Jest.call);
    pub const listen = toJSCallback(JSC.wrapStaticMethod(JSC.API.Listener, "listen", false));
    pub const mmap = toJSCallback(Bun.mmapFile);
    pub const nanoseconds = toJSCallback(Bun.nanoseconds);
    pub const openInEditor = toJSCallback(Bun.openInEditor);
    pub const registerMacro = toJSCallback(Bun.registerMacro);
    pub const resolve = toJSCallback(Bun.resolve);
    pub const resolveSync = toJSCallback(Bun.resolveSync);
    pub const serve = toJSCallback(Bun.serve);
    pub const sha = toJSCallback(JSC.wrapStaticMethod(Crypto.SHA512_256, "hash_", true));
    pub const shellEscape = toJSCallback(Bun.shellEscape);
    pub const shrink = toJSCallback(Bun.shrink);
    pub const sleepSync = toJSCallback(Bun.sleepSync);
    pub const spawn = toJSCallback(JSC.wrapStaticMethod(JSC.Subprocess, "spawn", false));
    pub const spawnSync = toJSCallback(JSC.wrapStaticMethod(JSC.Subprocess, "spawnSync", false));
    pub const udpSocket = toJSCallback(JSC.wrapStaticMethod(JSC.API.UDPSocket, "udpSocket", false));
    pub const which = toJSCallback(Bun.which);
    pub const write = toJSCallback(JSC.WebCore.Blob.writeFile);
    // --- Callbacks ---

    // --- Getters ---
    pub const CryptoHasher = toJSGetter(Crypto.CryptoHasher.getter);
    pub const FFI = toJSGetter(Bun.FFIObject.getter);
    pub const FileSystemRouter = toJSGetter(Bun.getFileSystemRouter);
    pub const Glob = toJSGetter(Bun.getGlobConstructor);
    pub const MD4 = toJSGetter(Crypto.MD4.getter);
    pub const MD5 = toJSGetter(Crypto.MD5.getter);
    pub const SHA1 = toJSGetter(Crypto.SHA1.getter);
    pub const SHA224 = toJSGetter(Crypto.SHA224.getter);
    pub const SHA256 = toJSGetter(Crypto.SHA256.getter);
    pub const SHA384 = toJSGetter(Crypto.SHA384.getter);
    pub const SHA512 = toJSGetter(Crypto.SHA512.getter);
    pub const SHA512_256 = toJSGetter(Crypto.SHA512_256.getter);
    pub const TOML = toJSGetter(Bun.getTOMLObject);
    pub const Transpiler = toJSGetter(Bun.getTranspilerConstructor);
    pub const argv = toJSGetter(Bun.getArgv);
    pub const cwd = toJSGetter(Bun.getCWD);
    pub const embeddedFiles = toJSGetter(Bun.getEmbeddedFiles);
    pub const enableANSIColors = toJSGetter(Bun.enableANSIColors);
    pub const hash = toJSGetter(Bun.getHashObject);
    pub const inspect = toJSGetter(Bun.getInspect);
    pub const main = toJSGetter(Bun.getMain);
    pub const origin = toJSGetter(Bun.getOrigin);
    pub const semver = toJSGetter(Bun.getSemver);
    pub const stderr = toJSGetter(Bun.getStderr);
    pub const stdin = toJSGetter(Bun.getStdin);
    pub const stdout = toJSGetter(Bun.getStdout);
    pub const unsafe = toJSGetter(Bun.getUnsafe);
    pub const S3Client = toJSGetter(Bun.getS3ClientConstructor);
    pub const s3 = toJSGetter(Bun.getS3DefaultClient);
    // --- Getters ---

    fn getterName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_getter_" ++ baseName;
    }

    fn callbackName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_callback_" ++ baseName;
    }

    const toJSCallback = JSC.toJSHostFunction;

    const LazyPropertyCallback = fn (*JSC.JSGlobalObject, *JSC.JSObject) callconv(JSC.conv) JSValue;

    fn toJSGetter(comptime getter: anytype) LazyPropertyCallback {
        return struct {
            pub fn callback(this: *JSC.JSGlobalObject, object: *JSC.JSObject) callconv(JSC.conv) JSValue {
                return @call(.always_inline, getter, .{ this, object });
            }
        }.callback;
    }

    pub fn exportAll() void {
        if (!@inComptime()) {
            @compileError("Must be comptime");
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
        @export(BunObject.Glob, .{ .name = getterName("Glob") });
        @export(BunObject.Transpiler, .{ .name = getterName("Transpiler") });
        @export(BunObject.argv, .{ .name = getterName("argv") });
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
        @export(BunObject.semver, .{ .name = getterName("semver") });
        @export(BunObject.embeddedFiles, .{ .name = getterName("embeddedFiles") });
        @export(BunObject.S3Client, .{ .name = getterName("S3Client") });
        @export(BunObject.s3, .{ .name = getterName("s3") });

        // --- Getters --

        // -- Callbacks --
        @export(BunObject.allocUnsafe, .{ .name = callbackName("allocUnsafe") });
        @export(BunObject.build, .{ .name = callbackName("build") });
        @export(BunObject.color, .{ .name = callbackName("color") });
        @export(BunObject.connect, .{ .name = callbackName("connect") });
        @export(BunObject.createParsedShellScript, .{ .name = callbackName("createParsedShellScript") });
        @export(BunObject.createShellInterpreter, .{ .name = callbackName("createShellInterpreter") });
        @export(BunObject.deflateSync, .{ .name = callbackName("deflateSync") });
        @export(BunObject.file, .{ .name = callbackName("file") });
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
        @export(BunObject.shellEscape, .{ .name = callbackName("shellEscape") });
        @export(BunObject.shrink, .{ .name = callbackName("shrink") });
        @export(BunObject.sleepSync, .{ .name = callbackName("sleepSync") });
        @export(BunObject.spawn, .{ .name = callbackName("spawn") });
        @export(BunObject.spawnSync, .{ .name = callbackName("spawnSync") });
        @export(BunObject.udpSocket, .{ .name = callbackName("udpSocket") });
        @export(BunObject.which, .{ .name = callbackName("which") });
        @export(BunObject.write, .{ .name = callbackName("write") });
        // -- Callbacks --
    }
};

const Bun = @This();
const default_allocator = bun.default_allocator;
const bun = @import("root").bun;
const uv = bun.windows.libuv;
const Environment = bun.Environment;

const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const Fs = @import("../../fs.zig");
const Resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");

const MacroEntryPoint = bun.transpiler.MacroEntryPoint;
const logger = bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const ServerEntryPoint = bun.transpiler.ServerEntryPoint;
const js_printer = bun.js_printer;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const NodeFallbackModules = @import("../../node_fallbacks.zig");
const ImportKind = ast.ImportKind;
const Analytics = @import("../../analytics/analytics_thread.zig");
const ZigString = bun.JSC.ZigString;
const Runtime = @import("../../runtime.zig");
const Router = @import("./filesystem_router.zig");
const ImportRecord = ast.ImportRecord;
const DotEnv = @import("../../env_loader.zig");
const ParseResult = bun.transpiler.ParseResult;
const PackageJSON = @import("../../resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("../../resolver/package_json.zig").MacroMap;
const WebCore = bun.JSC.WebCore;
const Request = WebCore.Request;
const Response = WebCore.Response;
const Headers = WebCore.Headers;
const Fetch = WebCore.Fetch;
const js = bun.JSC.C;
const JSC = bun.JSC;
const JSError = @import("../base.zig").JSError;

const MarkedArrayBuffer = @import("../base.zig").MarkedArrayBuffer;
const getAllocator = @import("../base.zig").getAllocator;
const JSValue = bun.JSC.JSValue;

const JSGlobalObject = bun.JSC.JSGlobalObject;
const ExceptionValueRef = bun.JSC.ExceptionValueRef;
const JSPrivateDataPtr = bun.JSC.JSPrivateDataPtr;
const ConsoleObject = bun.JSC.ConsoleObject;
const Node = bun.JSC.Node;
const ZigException = bun.JSC.ZigException;
const ZigStackTrace = bun.JSC.ZigStackTrace;
const ErrorableResolvedSource = bun.JSC.ErrorableResolvedSource;
const ResolvedSource = bun.JSC.ResolvedSource;
const JSPromise = bun.JSC.JSPromise;
const JSInternalPromise = bun.JSC.JSInternalPromise;
const JSModuleLoader = bun.JSC.JSModuleLoader;
const JSPromiseRejectionOperation = bun.JSC.JSPromiseRejectionOperation;
const ErrorableZigString = bun.JSC.ErrorableZigString;
const ZigGlobalObject = bun.JSC.ZigGlobalObject;
const VM = bun.JSC.VM;
const JSFunction = bun.JSC.JSFunction;
const Config = @import("../config.zig");
const URL = @import("../../url.zig").URL;
const Transpiler = bun.JSC.API.JSTranspiler;
const JSBundler = bun.JSC.API.JSBundler;
const VirtualMachine = JSC.VirtualMachine;
const IOTask = JSC.IOTask;
const zlib = @import("../../zlib.zig");
const Which = @import("../../which.zig");
const ErrorableString = JSC.ErrorableString;
const max_addressable_memory = std.math.maxInt(u56);
const glob = @import("../../glob.zig");
const Async = bun.Async;
const SemverObject = @import("../../install/semver.zig").SemverObject;
const Braces = @import("../../shell/braces.zig");
const Shell = @import("../../shell/shell.zig");

pub fn shellEscape(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalThis.throw("shell escape expected at least 1 argument", .{});
    }

    const jsval = arguments.ptr[0];
    const bunstr = jsval.toBunString(globalThis);
    if (globalThis.hasException()) return .zero;
    defer bunstr.deref();

    var outbuf = std.ArrayList(u8).init(bun.default_allocator);
    defer outbuf.deinit();

    if (bun.shell.needsEscapeBunstr(bunstr)) {
        const result = try bun.shell.escapeBunStr(bunstr, &outbuf, true);
        if (!result) {
            return globalThis.throw("String has invalid utf-16: {s}", .{bunstr.byteSlice()});
        }
        var str = bun.String.createUTF8(outbuf.items[0..]);
        return str.transferToJS(globalThis);
    }

    return jsval;
}

const gen = bun.gen.BunObject;

pub fn braces(global: *JSC.JSGlobalObject, brace_str: bun.String, opts: gen.BracesOptions) bun.JSError!JSC.JSValue {
    const brace_slice = brace_str.toUTF8(bun.default_allocator);
    defer brace_slice.deinit();

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    var lexer_output = Braces.Lexer.tokenize(arena.allocator(), brace_slice.slice()) catch |err| {
        return global.throwError(err, "failed to tokenize braces");
    };

    const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]) catch |err| {
        return global.throwError(err, "failed to calculate brace expansion amount");
    };

    if (opts.tokenize) {
        const str = try std.json.stringifyAlloc(global.bunVM().allocator, lexer_output.tokens.items[0..], .{});
        defer global.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(global);
    }
    if (opts.parse) {
        var parser = Braces.Parser.init(lexer_output.tokens.items[0..], arena.allocator());
        const ast_node = parser.parse() catch |err| {
            return global.throwError(err, "failed to parse braces");
        };
        const str = try std.json.stringifyAlloc(global.bunVM().allocator, ast_node, .{});
        defer global.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(global);
    }

    if (expansion_count == 0) {
        return bun.String.toJSArray(global, &.{brace_str});
    }

    var expanded_strings = try arena.allocator().alloc(std.ArrayList(u8), expansion_count);

    for (0..expansion_count) |i| {
        expanded_strings[i] = std.ArrayList(u8).init(arena.allocator());
    }

    Braces.expand(
        arena.allocator(),
        lexer_output.tokens.items[0..],
        expanded_strings,
        lexer_output.contains_nested,
    ) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.UnexpectedToken => return global.throwPretty("Unexpected token while expanding braces", .{}),
        error.StackFull => return global.throwPretty("Too much nesting while expanding braces", .{}),
    };

    var out_strings = try arena.allocator().alloc(bun.String, expansion_count);
    for (0..expansion_count) |i| {
        out_strings[i] = bun.String.fromBytes(expanded_strings[i].items[0..]);
    }

    return bun.String.toJSArray(global, out_strings[0..]);
}

pub fn which(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments_ = callframe.arguments_old(2);
    const path_buf = bun.PathBufferPool.get();
    defer bun.PathBufferPool.put(path_buf);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();
    const path_arg = arguments.nextEat() orelse {
        return globalThis.throw("which: expected 1 argument, got 0", .{});
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

    bin_str = try path_arg.toSlice(globalThis, globalThis.bunVM().allocator);
    if (globalThis.hasException()) {
        return .zero;
    }

    if (bin_str.len >= bun.MAX_PATH_BYTES) {
        return globalThis.throw("bin path is too long", .{});
    }

    if (bin_str.len == 0) {
        return JSC.JSValue.jsNull();
    }

    path_str = ZigString.Slice.fromUTF8NeverFree(
        globalThis.bunVM().transpiler.env.get("PATH") orelse "",
    );
    cwd_str = ZigString.Slice.fromUTF8NeverFree(
        globalThis.bunVM().transpiler.fs.top_level_dir,
    );

    if (arguments.nextEat()) |arg| {
        if (!arg.isEmptyOrUndefinedOrNull() and arg.isObject()) {
            if (try arg.get(globalThis, "PATH")) |str_| {
                path_str = try str_.toSlice(globalThis, globalThis.bunVM().allocator);
            }

            if (try arg.get(globalThis, "cwd")) |str_| {
                cwd_str = try str_.toSlice(globalThis, globalThis.bunVM().allocator);
            }
        }
    }

    if (Which.which(
        path_buf,
        path_str.slice(),
        cwd_str.slice(),
        bin_str.slice(),
    )) |bin_path| {
        return ZigString.init(bin_path).withEncoding().toJS(globalThis);
    }

    return JSC.JSValue.jsNull();
}

pub fn inspectTable(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var args_buf = callframe.argumentsUndef(5);
    var all_arguments = args_buf.mut();
    if (all_arguments[0].isUndefined() or all_arguments[0].isNull())
        return bun.String.empty.toJS(globalThis);

    for (all_arguments) |arg| {
        arg.protect();
    }
    defer {
        for (all_arguments) |arg| {
            arg.unprotect();
        }
    }

    var arguments = all_arguments[0..];

    if (!arguments[1].isArray()) {
        arguments[2] = arguments[1];
        arguments[1] = .undefined;
    }

    var formatOptions = ConsoleObject.FormatOptions{
        .enable_colors = false,
        .add_newline = false,
        .flush = false,
        .max_depth = 5,
        .quote_strings = true,
        .ordered_properties = false,
        .single_line = true,
    };
    if (arguments[2].isObject()) {
        try formatOptions.fromJS(globalThis, arguments[2..]);
    }
    const value = arguments[0];

    // very stable memory address
    var array = MutableString.init(getAllocator(globalThis), 0) catch bun.outOfMemory();
    defer array.deinit();
    var buffered_writer_ = MutableString.BufferedWriter{ .context = &array };
    var buffered_writer = &buffered_writer_;

    const writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    const properties = if (arguments[1].jsType().isArray()) arguments[1] else JSValue.undefined;
    var table_printer = ConsoleObject.TablePrinter.init(
        globalThis,
        .Log,
        value,
        properties,
    );
    table_printer.value_formatter.depth = formatOptions.max_depth;
    table_printer.value_formatter.ordered_properties = formatOptions.ordered_properties;
    table_printer.value_formatter.single_line = formatOptions.single_line;

    switch (formatOptions.enable_colors) {
        inline else => |colors| table_printer.printTable(Writer, writer, colors) catch {
            if (!globalThis.hasException())
                return globalThis.throwOutOfMemory();
            return .zero;
        },
    }

    try buffered_writer.flush();

    return bun.String.createUTF8ForJS(globalThis, array.slice());
}

pub fn inspect(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(4).slice();
    if (arguments.len == 0)
        return bun.String.empty.toJS(globalThis);

    for (arguments) |arg| {
        arg.protect();
    }
    defer {
        for (arguments) |arg| {
            arg.unprotect();
        }
    }

    var formatOptions = ConsoleObject.FormatOptions{
        .enable_colors = false,
        .add_newline = false,
        .flush = false,
        .max_depth = 8,
        .quote_strings = true,
        .ordered_properties = false,
    };
    if (arguments.len > 1) {
        try formatOptions.fromJS(globalThis, arguments[1..]);
    }
    const value = arguments[0];

    // very stable memory address
    var array = MutableString.init(getAllocator(globalThis), 0) catch unreachable;
    defer array.deinit();
    var buffered_writer_ = MutableString.BufferedWriter{ .context = &array };
    var buffered_writer = &buffered_writer_;

    const writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    try ConsoleObject.format2(
        .Debug,
        globalThis,
        @as([*]const JSValue, @ptrCast(&value)),
        1,
        Writer,
        Writer,
        writer,
        formatOptions,
    );
    if (globalThis.hasException()) return error.JSError;
    buffered_writer.flush() catch return globalThis.throwOutOfMemory();

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    var out = ZigString.init(array.slice()).withEncoding();
    const ret = out.toJS(globalThis);

    return ret;
}

export fn Bun__inspect(globalThis: *JSGlobalObject, value: JSValue) ZigString {
    // very stable memory address
    var array = MutableString.init(getAllocator(globalThis), 0) catch unreachable;
    var buffered_writer = MutableString.BufferedWriter{ .context = &array };
    const writer = buffered_writer.writer();

    var formatter = ConsoleObject.Formatter{ .globalThis = globalThis };
    writer.print("{}", .{value.toFmt(&formatter)}) catch return ZigString.Empty;
    buffered_writer.flush() catch return ZigString.Empty;

    return ZigString.init(array.slice()).withEncoding();
}

pub fn getInspect(globalObject: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    const fun = JSC.createCallback(globalObject, ZigString.static("inspect"), 2, inspect);
    var str = ZigString.init("nodejs.util.inspect.custom");
    fun.put(globalObject, ZigString.static("custom"), JSC.JSValue.symbolFor(globalObject, &str));
    fun.put(globalObject, ZigString.static("table"), JSC.createCallback(globalObject, ZigString.static("table"), 3, inspectTable));
    return fun;
}

pub fn registerMacro(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    if (arguments.len != 2 or !arguments[0].isNumber()) {
        return globalObject.throwInvalidArguments("Internal error registering macros: invalid args", .{});
    }
    const id = arguments[0].toInt32();
    if (id == -1 or id == 0) {
        return globalObject.throwInvalidArguments("Internal error registering macros: invalid id", .{});
    }

    if (!arguments[1].isCell() or !arguments[1].isCallable(globalObject.vm())) {
        // TODO: add "toTypeOf" helper
        return globalObject.throw("Macro must be a function", .{});
    }

    const get_or_put_result = VirtualMachine.get().macros.getOrPut(id) catch unreachable;
    if (get_or_put_result.found_existing) {
        get_or_put_result.value_ptr.*.?.value().unprotect();
    }

    arguments[1].protect();
    get_or_put_result.value_ptr.* = arguments[1].asObjectRef();

    return .undefined;
}

pub fn getCWD(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().transpiler.fs.top_level_dir).toJS(globalThis);
}

pub fn getOrigin(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().origin.origin).toJS(globalThis);
}

pub fn getStdin(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdin();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn getStderr(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stderr();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn getStdout(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdout();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn enableANSIColors(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    _ = globalThis;
    return JSValue.jsBoolean(Output.enable_ansi_colors);
}

pub fn getMain(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    const vm = globalThis.bunVM();

    // Attempt to use the resolved filesystem path
    // This makes `eval('require.main === module')` work when the main module is a symlink.
    // This behavior differs slightly from Node. Node sets the `id` to `.` when the main module is a symlink.
    use_resolved_path: {
        if (vm.main_resolved_path.isEmpty()) {
            // If it's from eval, don't try to resolve it.
            if (strings.hasSuffixComptime(vm.main, "[eval]")) {
                break :use_resolved_path;
            }
            if (strings.hasSuffixComptime(vm.main, "[stdin]")) {
                break :use_resolved_path;
            }

            const fd = bun.sys.openatA(
                if (comptime Environment.isWindows) bun.invalid_fd else bun.FD.cwd(),
                vm.main,

                // Open with the minimum permissions necessary for resolving the file path.
                if (comptime Environment.isLinux) bun.O.PATH else bun.O.RDONLY,

                0,
            ).unwrap() catch break :use_resolved_path;

            defer _ = bun.sys.close(fd);
            if (comptime Environment.isWindows) {
                var wpath: bun.WPathBuffer = undefined;
                const fdpath = bun.getFdPathW(fd, &wpath) catch break :use_resolved_path;
                vm.main_resolved_path = bun.String.createUTF16(fdpath);
            } else {
                var path: bun.PathBuffer = undefined;
                const fdpath = bun.getFdPath(fd, &path) catch break :use_resolved_path;

                // Bun.main === otherId will be compared many times, so let's try to create an atom string if we can.
                if (bun.String.tryCreateAtom(fdpath)) |atom| {
                    vm.main_resolved_path = atom;
                } else {
                    vm.main_resolved_path = bun.String.createUTF8(fdpath);
                }
            }
        }

        return vm.main_resolved_path.toJS(globalThis);
    }

    return ZigString.init(vm.main).toJS(globalThis);
}

pub fn getArgv(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return JSC.Node.Process.getArgv(globalThis);
}

const Editor = @import("../../open.zig").Editor;

pub fn openInEditor(globalThis: js.JSContextRef, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    var edit = &VirtualMachine.get().rareData().editor_context;
    const args = callframe.arguments_old(4);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), args.slice());
    defer arguments.deinit();
    var path: string = "";
    var editor_choice: ?Editor = null;
    var line: ?string = null;
    var column: ?string = null;

    if (arguments.nextEat()) |file_path_| {
        path = (try file_path_.toSlice(globalThis, arguments.arena.allocator())).slice();
    }

    if (arguments.nextEat()) |opts| {
        if (!opts.isUndefinedOrNull()) {
            if (try opts.getTruthy(globalThis, "editor")) |editor_val| {
                var sliced = try editor_val.toSlice(globalThis, arguments.arena.allocator());
                const prev_name = edit.name;

                if (!strings.eqlLong(prev_name, sliced.slice(), true)) {
                    const prev = edit.*;
                    edit.name = sliced.slice();
                    edit.detectEditor(VirtualMachine.get().transpiler.env);
                    editor_choice = edit.editor;
                    if (editor_choice == null) {
                        edit.* = prev;
                        return globalThis.throw("Could not find editor \"{s}\"", .{sliced.slice()});
                    } else if (edit.name.ptr == edit.path.ptr) {
                        edit.name = arguments.arena.allocator().dupe(u8, edit.path) catch unreachable;
                        edit.path = edit.path;
                    }
                }
            }

            if (try opts.getTruthy(globalThis, "line")) |line_| {
                line = (try line_.toSlice(globalThis, arguments.arena.allocator())).slice();
            }

            if (try opts.getTruthy(globalThis, "column")) |column_| {
                column = (try column_.toSlice(globalThis, arguments.arena.allocator())).slice();
            }
        }
    }

    const editor = editor_choice orelse edit.editor orelse brk: {
        edit.autoDetectEditor(VirtualMachine.get().transpiler.env);
        if (edit.editor == null) {
            return globalThis.throw("Failed to auto-detect editor", .{});
        }

        break :brk edit.editor.?;
    };

    if (path.len == 0) {
        return globalThis.throw("No file path specified", .{});
    }

    editor.open(edit.path, path, line, column, arguments.arena.allocator()) catch |err| {
        return globalThis.throw("Opening editor failed {s}", .{@errorName(err)});
    };

    return .undefined;
}

pub fn getPublicPath(to: string, origin: URL, comptime Writer: type, writer: Writer) void {
    return getPublicPathWithAssetPrefix(
        to,
        VirtualMachine.get().transpiler.fs.top_level_dir,
        origin,
        "",
        comptime Writer,
        writer,
        .loose,
    );
}

pub fn getPublicPathWithAssetPrefix(
    to: string,
    dir: string,
    origin: URL,
    asset_prefix: string,
    comptime Writer: type,
    writer: Writer,
    comptime platform: bun.path.Platform,
) void {
    const relative_path = if (strings.hasPrefix(to, dir))
        strings.withoutTrailingSlash(to[dir.len..])
    else
        VirtualMachine.get().transpiler.fs.relativePlatform(dir, to, platform);
    if (origin.isAbsolute()) {
        if (strings.hasPrefix(relative_path, "..") or strings.hasPrefix(relative_path, "./")) {
            writer.writeAll(origin.origin) catch return;
            writer.writeAll("/abs:") catch return;
            if (std.fs.path.isAbsolute(to)) {
                writer.writeAll(to) catch return;
            } else {
                writer.writeAll(VirtualMachine.get().transpiler.fs.abs(&[_]string{to})) catch return;
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

pub fn sleepSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);

    // Expect at least one argument.  We allow more than one but ignore them; this
    //  is useful for supporting things like `[1, 2].map(sleepSync)`
    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("sleepSync", 1, 0);
    }
    const arg = arguments.slice()[0];

    // The argument must be a number
    if (!arg.isNumber()) {
        return globalObject.throwInvalidArgumentType("sleepSync", "milliseconds", "number");
    }

    //NOTE: if argument is > max(i32) then it will be truncated
    const milliseconds = arg.coerce(i32, globalObject);
    if (milliseconds < 0) {
        return globalObject.throwInvalidArguments("argument to sleepSync must not be negative, got {d}", .{milliseconds});
    }

    std.time.sleep(@as(u64, @intCast(milliseconds)) * std.time.ns_per_ms);
    return .undefined;
}

pub fn gc(vm: *JSC.VirtualMachine, sync: bool) usize {
    return vm.garbageCollect(sync);
}
export fn Bun__gc(vm: *JSC.VirtualMachine, sync: bool) callconv(.C) usize {
    return @call(.always_inline, gc, .{ vm, sync });
}

pub fn shrink(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    globalObject.vm().shrinkFootprint();
    return .undefined;
}

fn doResolve(globalThis: *JSC.JSGlobalObject, arguments: []const JSValue) bun.JSError!JSC.JSValue {
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const specifier = args.protectEatNext() orelse {
        return globalThis.throwInvalidArguments("Expected a specifier and a from path", .{});
    };

    if (specifier.isUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("specifier must be a string", .{});
    }

    const from = args.protectEatNext() orelse {
        return globalThis.throwInvalidArguments("Expected a from path", .{});
    };

    if (from.isUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("from must be a string", .{});
    }

    var is_esm = true;
    if (args.nextEat()) |next| {
        if (next.isBoolean()) {
            is_esm = next.toBoolean();
        } else {
            return globalThis.throwInvalidArguments("esm must be a boolean", .{});
        }
    }

    const specifier_str = specifier.toBunString(globalThis);
    defer specifier_str.deref();
    const from_str = from.toBunString(globalThis);
    defer from_str.deref();
    return doResolveWithArgs(
        globalThis,
        specifier_str,
        from_str,
        is_esm,
        false,
    );
}

fn doResolveWithArgs(ctx: js.JSContextRef, specifier: bun.String, from: bun.String, is_esm: bool, comptime is_file_path: bool) bun.JSError!JSC.JSValue {
    var errorable: ErrorableString = undefined;
    var query_string = ZigString.Empty;

    const specifier_decoded = if (specifier.hasPrefixComptime("file://"))
        bun.JSC.URL.pathFromFileURL(specifier)
    else
        specifier.dupeRef();
    defer specifier_decoded.deref();

    if (comptime is_file_path) {
        VirtualMachine.resolveFilePathForAPI(
            &errorable,
            ctx,
            specifier_decoded,
            from,
            &query_string,
            is_esm,
        );
    } else {
        VirtualMachine.resolveForAPI(
            &errorable,
            ctx,
            specifier_decoded,
            from,
            &query_string,
            is_esm,
        );
    }

    if (!errorable.success) {
        return ctx.throwValue(bun.cast(JSC.JSValueRef, errorable.result.err.ptr.?).?.value());
    }

    if (query_string.len > 0) {
        var stack = std.heap.stackFallback(1024, ctx.allocator());
        const allocator = stack.get();
        var arraylist = std.ArrayList(u8).initCapacity(allocator, 1024) catch unreachable;
        defer arraylist.deinit();
        try arraylist.writer().print("{any}{any}", .{
            errorable.result.value,
            query_string,
        });

        return ZigString.initUTF8(arraylist.items).toJS(ctx);
    }

    return errorable.result.value.toJS(ctx);
}

pub fn resolveSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(3);
    return try doResolve(globalObject, arguments.slice());
}

pub fn resolve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(3);
    const value = doResolve(globalObject, arguments.slice()) catch {
        const err = globalObject.tryTakeException().?;
        return JSC.JSPromise.rejectedPromiseValue(globalObject, err);
    };
    return JSC.JSPromise.resolvedPromiseValue(globalObject, value);
}

export fn Bun__resolve(global: *JSGlobalObject, specifier: JSValue, source: JSValue, is_esm: bool) JSC.JSValue {
    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();

    const source_str = source.toBunString(global);
    defer source_str.deref();

    const value = doResolveWithArgs(global, specifier_str, source_str, is_esm, true) catch {
        const err = global.tryTakeException().?;
        return JSC.JSPromise.rejectedPromiseValue(global, err);
    };

    return JSC.JSPromise.resolvedPromiseValue(global, value);
}

export fn Bun__resolveSync(global: *JSGlobalObject, specifier: JSValue, source: JSValue, is_esm: bool) JSC.JSValue {
    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();

    const source_str = source.toBunString(global);
    defer source_str.deref();

    return JSC.toJSHostValue(global, doResolveWithArgs(global, specifier_str, source_str, is_esm, true));
}

export fn Bun__resolveSyncWithStrings(global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, is_esm: bool) JSC.JSValue {
    Output.scoped(.importMetaResolve, false)("source: {s}, specifier: {s}", .{ source.*, specifier.* });
    return JSC.toJSHostValue(global, doResolveWithArgs(global, specifier.*, source.*, is_esm, true));
}

export fn Bun__resolveSyncWithSource(global: *JSGlobalObject, specifier: JSValue, source: *bun.String, is_esm: bool) JSC.JSValue {
    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();
    return JSC.toJSHostValue(global, doResolveWithArgs(global, specifier_str, source.*, is_esm, true));
}

extern fn dump_zone_malloc_stats() void;

fn dump_mimalloc(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    globalObject.bunVM().arena.dumpStats();
    if (bun.heap_breakdown.enabled) {
        dump_zone_malloc_stats();
    }
    return .undefined;
}

pub fn indexOfLine(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments_ = callframe.arguments_old(2);
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

            if (byte == '\n') {
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
    pub const HMAC = struct {
        ctx: BoringSSL.HMAC_CTX,
        algorithm: EVP.Algorithm,

        pub usingnamespace bun.New(@This());

        pub fn init(algorithm: EVP.Algorithm, key: []const u8) ?*HMAC {
            const md = algorithm.md() orelse return null;
            var ctx: BoringSSL.HMAC_CTX = undefined;
            BoringSSL.HMAC_CTX_init(&ctx);
            if (BoringSSL.HMAC_Init_ex(&ctx, key.ptr, @intCast(key.len), md, null) != 1) {
                BoringSSL.HMAC_CTX_cleanup(&ctx);
                return null;
            }
            return HMAC.new(.{
                .ctx = ctx,
                .algorithm = algorithm,
            });
        }

        pub fn update(this: *HMAC, data: []const u8) void {
            _ = BoringSSL.HMAC_Update(&this.ctx, data.ptr, data.len);
        }

        pub fn size(this: *const HMAC) usize {
            return BoringSSL.HMAC_size(&this.ctx);
        }

        pub fn copy(this: *HMAC) !*HMAC {
            var ctx: BoringSSL.HMAC_CTX = undefined;
            BoringSSL.HMAC_CTX_init(&ctx);
            if (BoringSSL.HMAC_CTX_copy(&ctx, &this.ctx) != 1) {
                BoringSSL.HMAC_CTX_cleanup(&ctx);
                return error.BoringSSLError;
            }
            return HMAC.new(.{
                .ctx = ctx,
                .algorithm = this.algorithm,
            });
        }

        pub fn final(this: *HMAC, out: []u8) []u8 {
            var outlen: c_uint = undefined;
            _ = BoringSSL.HMAC_Final(&this.ctx, out.ptr, &outlen);
            return out[0..outlen];
        }

        pub fn deinit(this: *HMAC) void {
            BoringSSL.HMAC_CTX_cleanup(&this.ctx);
            this.destroy();
        }
    };

    pub const EVP = struct {
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
            blake2b512,
            md4,
            md5,
            ripemd160,
            sha1,
            sha224,
            sha256,
            sha384,
            sha512,
            @"sha512-224",
            @"sha512-256",

            @"sha3-224",
            @"sha3-256",
            @"sha3-384",
            @"sha3-512",
            shake128,
            shake256,

            pub fn md(this: Algorithm) ?*const BoringSSL.EVP_MD {
                return switch (this) {
                    .blake2b256 => BoringSSL.EVP_blake2b256(),
                    .blake2b512 => BoringSSL.EVP_blake2b512(),
                    .md4 => BoringSSL.EVP_md4(),
                    .md5 => BoringSSL.EVP_md5(),
                    .ripemd160 => BoringSSL.EVP_ripemd160(),
                    .sha1 => BoringSSL.EVP_sha1(),
                    .sha224 => BoringSSL.EVP_sha224(),
                    .sha256 => BoringSSL.EVP_sha256(),
                    .sha384 => BoringSSL.EVP_sha384(),
                    .sha512 => BoringSSL.EVP_sha512(),
                    .@"sha512-224" => BoringSSL.EVP_sha512_224(),
                    .@"sha512-256" => BoringSSL.EVP_sha512_256(),
                    else => null,
                };
            }

            pub const names: std.EnumArray(Algorithm, bun.String) = brk: {
                var all = std.EnumArray(Algorithm, bun.String).initUndefined();
                var iter = all.iterator();
                while (iter.next()) |entry| {
                    entry.value.* = bun.String.init(@tagName(entry.key));
                }
                break :brk all;
            };

            pub const map = bun.ComptimeStringMap(Algorithm, .{
                .{ "blake2b256", .blake2b256 },
                .{ "blake2b512", .blake2b512 },
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
                .{ "sha-512/224", .@"sha512-224" },
                .{ "sha-512_224", .@"sha512-224" },
                .{ "sha-512224", .@"sha512-224" },
                .{ "sha512-224", .@"sha512-224" },
                .{ "sha-512/256", .@"sha512-256" },
                .{ "sha-512_256", .@"sha512-256" },
                .{ "sha-512256", .@"sha512-256" },
                .{ "sha512-256", .@"sha512-256" },
                .{ "sha384", .sha384 },
                .{ "sha3-224", .@"sha3-224" },
                .{ "sha3-256", .@"sha3-256" },
                .{ "sha3-384", .@"sha3-384" },
                .{ "sha3-512", .@"sha3-512" },
                .{ "shake128", .shake128 },
                .{ "shake256", .shake256 },
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

        /// For usage in Zig
        pub fn pbkdf2(
            output: []u8,
            password: []const u8,
            salt: []const u8,
            iteration_count: u32,
            algorithm: Algorithm,
        ) ?[]const u8 {
            var pbk = PBKDF2{
                .algorithm = algorithm,
                .password = JSC.Node.StringOrBuffer{ .encoded_slice = JSC.ZigString.Slice.fromUTF8NeverFree(password) },
                .salt = JSC.Node.StringOrBuffer{ .encoded_slice = JSC.ZigString.Slice.fromUTF8NeverFree(salt) },
                .iteration_count = iteration_count,
                .length = @intCast(output.len),
            };

            if (!pbk.run(output)) {
                return null;
            }

            return output;
        }

        pub const PBKDF2 = struct {
            password: JSC.Node.StringOrBuffer = JSC.Node.StringOrBuffer.empty,
            salt: JSC.Node.StringOrBuffer = JSC.Node.StringOrBuffer.empty,
            iteration_count: u32 = 1,
            length: i32 = 0,
            algorithm: EVP.Algorithm,

            pub fn run(this: *PBKDF2, output: []u8) bool {
                const password = this.password.slice();
                const salt = this.salt.slice();
                const algorithm = this.algorithm;
                const iteration_count = this.iteration_count;
                const length = this.length;

                @memset(output, 0);
                assert(this.length <= @as(i32, @intCast(output.len)));
                BoringSSL.ERR_clear_error();
                const rc = BoringSSL.PKCS5_PBKDF2_HMAC(
                    if (password.len > 0) password.ptr else null,
                    @intCast(password.len),
                    salt.ptr,
                    @intCast(salt.len),
                    @intCast(iteration_count),
                    algorithm.md().?,
                    @intCast(length),
                    output.ptr,
                );

                if (rc <= 0) {
                    return false;
                }

                return true;
            }

            pub const Job = struct {
                pbkdf2: PBKDF2,
                output: []u8 = &[_]u8{},
                task: JSC.WorkPoolTask = .{ .callback = &runTask },
                promise: JSC.JSPromise.Strong = .{},
                vm: *JSC.VirtualMachine,
                err: ?u32 = null,
                any_task: JSC.AnyTask = undefined,
                poll: Async.KeepAlive = .{},

                pub usingnamespace bun.New(@This());

                pub fn runTask(task: *JSC.WorkPoolTask) void {
                    const job: *PBKDF2.Job = @fieldParentPtr("task", task);
                    defer job.vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(job.any_task.task()));
                    job.output = bun.default_allocator.alloc(u8, @as(usize, @intCast(job.pbkdf2.length))) catch {
                        job.err = BoringSSL.EVP_R_MEMORY_LIMIT_EXCEEDED;
                        return;
                    };
                    if (!job.pbkdf2.run(job.output)) {
                        job.err = BoringSSL.ERR_get_error();
                        BoringSSL.ERR_clear_error();

                        bun.default_allocator.free(job.output);
                        job.output = &[_]u8{};
                    }
                }

                pub fn runFromJS(this: *Job) void {
                    defer this.deinit();
                    if (this.vm.isShuttingDown()) {
                        return;
                    }

                    const globalThis = this.promise.strong.globalThis orelse this.vm.global;
                    const promise = this.promise.swap();
                    if (this.err) |err| {
                        promise.reject(globalThis, createCryptoError(globalThis, err));
                        return;
                    }

                    const output_slice = this.output;
                    assert(output_slice.len == @as(usize, @intCast(this.pbkdf2.length)));
                    const buffer_value = JSC.JSValue.createBuffer(globalThis, output_slice, bun.default_allocator);
                    if (buffer_value == .zero) {
                        promise.reject(globalThis, ZigString.init("Failed to create buffer").toErrorInstance(globalThis));
                        return;
                    }

                    this.output = &[_]u8{};
                    promise.resolve(globalThis, buffer_value);
                }

                pub fn deinit(this: *Job) void {
                    this.poll.unref(this.vm);
                    this.pbkdf2.deinitAndUnprotect();
                    this.promise.deinit();
                    bun.default_allocator.free(this.output);
                    this.destroy();
                }

                pub fn create(vm: *JSC.VirtualMachine, globalThis: *JSC.JSGlobalObject, data: *const PBKDF2) *Job {
                    var job = Job.new(.{
                        .pbkdf2 = data.*,
                        .vm = vm,
                        .any_task = undefined,
                    });

                    job.promise = JSC.JSPromise.Strong.init(globalThis);
                    job.any_task = JSC.AnyTask.New(@This(), &runFromJS).init(job);
                    job.poll.ref(vm);
                    JSC.WorkPool.schedule(&job.task);

                    return job;
                }
            };

            pub fn deinitAndUnprotect(this: *PBKDF2) void {
                this.password.deinitAndUnprotect();
                this.salt.deinitAndUnprotect();
            }

            pub fn deinit(this: *PBKDF2) void {
                this.password.deinit();
                this.salt.deinit();
            }

            pub fn fromJS(globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue, is_async: bool) bun.JSError!PBKDF2 {
                if (arguments.len < 5) {
                    return globalThis.throwNotEnoughArguments("pbkdf2", 5, arguments.len);
                }

                if (!arguments[3].isNumber()) {
                    return globalThis.throwInvalidArgumentTypeValue("keylen", "number", arguments[3]);
                }

                const keylen_num = arguments[3].asNumber();

                if (std.math.isInf(keylen_num) or std.math.isNan(keylen_num)) {
                    return globalThis.throwRangeError(keylen_num, .{
                        .field_name = "keylen",
                        .msg = "an integer",
                    });
                }

                if (keylen_num < 0 or keylen_num > std.math.maxInt(i32)) {
                    return globalThis.throwRangeError(keylen_num, .{ .field_name = "keylen", .min = 0, .max = std.math.maxInt(i32) });
                }

                const keylen: i32 = @intFromFloat(keylen_num);

                if (globalThis.hasException()) {
                    return error.JSError;
                }

                if (!arguments[2].isAnyInt()) {
                    return globalThis.throwInvalidArgumentTypeValue("iterations", "number", arguments[2]);
                }

                const iteration_count = arguments[2].coerce(i64, globalThis);

                if (!globalThis.hasException() and (iteration_count < 1 or iteration_count > std.math.maxInt(i32))) {
                    return globalThis.throwRangeError(iteration_count, .{ .field_name = "iterations", .min = 1, .max = std.math.maxInt(i32) + 1 });
                }

                if (globalThis.hasException()) {
                    return error.JSError;
                }

                const algorithm = brk: {
                    if (!arguments[4].isString()) {
                        return globalThis.throwInvalidArgumentTypeValue("digest", "string", arguments[4]);
                    }

                    invalid: {
                        switch (EVP.Algorithm.map.fromJSCaseInsensitive(globalThis, arguments[4]) orelse break :invalid) {
                            .shake128, .shake256, .@"sha3-224", .@"sha3-256", .@"sha3-384", .@"sha3-512" => break :invalid,
                            else => |alg| break :brk alg,
                        }
                    }

                    if (!globalThis.hasException()) {
                        const slice = try arguments[4].toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        const name = slice.slice();
                        return globalThis.ERR_CRYPTO_INVALID_DIGEST("Invalid digest: {s}", .{name}).throw();
                    }
                    return error.JSError;
                };

                var out = PBKDF2{
                    .iteration_count = @intCast(iteration_count),
                    .length = keylen,
                    .algorithm = algorithm,
                };
                defer {
                    if (globalThis.hasException()) {
                        if (is_async)
                            out.deinitAndUnprotect()
                        else
                            out.deinit();
                    }
                }

                const allow_string_object = true;
                out.salt = JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arguments[1], is_async, allow_string_object) orelse {
                    return globalThis.throwInvalidArgumentTypeValue("salt", "string or buffer", arguments[1]);
                };

                if (out.salt.slice().len > std.math.maxInt(i32)) {
                    return globalThis.throwInvalidArguments("salt is too long", .{});
                }

                out.password = JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arguments[0], is_async, allow_string_object) orelse {
                    if (!globalThis.hasException()) {
                        return globalThis.throwInvalidArgumentTypeValue("password", "string or buffer", arguments[0]);
                    }
                    return error.JSError;
                };

                if (out.password.slice().len > std.math.maxInt(i32)) {
                    return globalThis.throwInvalidArguments("password is too long", .{});
                }

                if (is_async) {
                    if (!arguments[5].isFunction()) {
                        return globalThis.throwInvalidArgumentTypeValue("callback", "function", arguments[5]);
                    }
                }

                return out;
            }
        };

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
            BoringSSL.ERR_clear_error();
            _ = BoringSSL.EVP_DigestInit_ex(&this.ctx, this.md, engine);
        }

        pub fn hash(this: *EVP, engine: *BoringSSL.ENGINE, input: []const u8, output: []u8) ?u32 {
            BoringSSL.ERR_clear_error();
            var outsize: c_uint = @min(@as(u16, @truncate(output.len)), this.size());
            if (BoringSSL.EVP_Digest(input.ptr, input.len, output.ptr, &outsize, this.md, engine) != 1) {
                return null;
            }

            return outsize;
        }

        pub fn final(this: *EVP, engine: *BoringSSL.ENGINE, output: []u8) []u8 {
            BoringSSL.ERR_clear_error();
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
            BoringSSL.ERR_clear_error();
            _ = BoringSSL.EVP_DigestUpdate(&this.ctx, input.ptr, input.len);
        }

        pub fn size(this: *EVP) u16 {
            return @as(u16, @truncate(BoringSSL.EVP_MD_CTX_size(&this.ctx)));
        }

        pub fn copy(this: *const EVP, engine: *BoringSSL.ENGINE) error{OutOfMemory}!EVP {
            BoringSSL.ERR_clear_error();
            var new = init(this.algorithm, this.md, engine);
            if (BoringSSL.EVP_MD_CTX_copy_ex(&new.ctx, &this.ctx) == 0) {
                return error.OutOfMemory;
            }
            return new;
        }

        pub fn byNameAndEngine(engine: *BoringSSL.ENGINE, name: []const u8) ?EVP {
            if (Algorithm.map.getWithEql(name, strings.eqlCaseInsensitiveASCIIIgnoreLength)) |algorithm| {
                if (algorithm.md()) |md| {
                    return EVP.init(algorithm, md, engine);
                }

                if (BoringSSL.EVP_get_digestbyname(@tagName(algorithm))) |md| {
                    return EVP.init(algorithm, md, engine);
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

    pub fn createCryptoError(globalThis: *JSC.JSGlobalObject, err_code: u32) JSValue {
        return BoringSSL.ERR_toJS(globalThis, err_code);
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

                pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) bun.JSError!Value {
                    if (value.isObject()) {
                        if (try value.getTruthy(globalObject, "algorithm")) |algorithm_value| {
                            if (!algorithm_value.isString()) {
                                return globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                            }

                            const algorithm_string = algorithm_value.getZigString(globalObject);

                            switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                                return globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                            }) {
                                .bcrypt => {
                                    var algorithm = PasswordObject.Algorithm.Value{
                                        .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                                    };

                                    if (try value.getTruthy(globalObject, "cost")) |rounds_value| {
                                        if (!rounds_value.isNumber()) {
                                            return globalObject.throwInvalidArgumentType("hash", "cost", "number");
                                        }

                                        const rounds = rounds_value.coerce(i32, globalObject);

                                        if (rounds < 4 or rounds > 31) {
                                            return globalObject.throwInvalidArguments("Rounds must be between 4 and 31", .{});
                                        }

                                        algorithm.bcrypt = @as(u6, @intCast(rounds));
                                    }

                                    return algorithm;
                                },
                                inline .argon2id, .argon2d, .argon2i => |tag| {
                                    var argon = Algorithm.Argon2Params{};

                                    if (try value.getTruthy(globalObject, "timeCost")) |time_value| {
                                        if (!time_value.isNumber()) {
                                            return globalObject.throwInvalidArgumentType("hash", "timeCost", "number");
                                        }

                                        const time_cost = time_value.coerce(i32, globalObject);

                                        if (time_cost < 1) {
                                            return globalObject.throwInvalidArguments("Time cost must be greater than 0", .{});
                                        }

                                        argon.time_cost = @as(u32, @intCast(time_cost));
                                    }

                                    if (try value.getTruthy(globalObject, "memoryCost")) |memory_value| {
                                        if (!memory_value.isNumber()) {
                                            return globalObject.throwInvalidArgumentType("hash", "memoryCost", "number");
                                        }

                                        const memory_cost = memory_value.coerce(i32, globalObject);

                                        if (memory_cost < 1) {
                                            return globalObject.throwInvalidArguments("Memory cost must be greater than 0", .{});
                                        }

                                        argon.memory_cost = @as(u32, @intCast(memory_cost));
                                    }

                                    return @unionInit(Algorithm.Value, @tagName(tag), argon);
                                },
                            }

                            unreachable;
                        } else {
                            return globalObject.throwInvalidArgumentType("hash", "options.algorithm", "string");
                        }
                    } else if (value.isString()) {
                        const algorithm_string = value.getZigString(globalObject);

                        switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                            return globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
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
                        return globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
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
                        var sha_512 = bun.sha.SHA512.init();
                        defer sha_512.deinit();
                        sha_512.update(password);
                        sha_512.final(outbuf[0..bun.sha.SHA512.digest]);
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
                    var password_to_use = password;
                    var outbuf: [bun.sha.SHA512.digest]u8 = undefined;

                    // bcrypt silently truncates passwords longer than 72 bytes
                    // we use SHA512 to hash the password if it's longer than 72 bytes
                    if (password.len > 72) {
                        var sha_512 = bun.sha.SHA512.init();
                        defer sha_512.deinit();
                        sha_512.update(password);
                        sha_512.final(&outbuf);
                        password_to_use = &outbuf;
                    }
                    pwhash.bcrypt.strVerify(previous_hash, password_to_use, .{ .allocator = allocator }) catch |err| {
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
            ref: Async.KeepAlive = .{},
            task: JSC.WorkPoolTask = .{ .callback = &run },

            pub usingnamespace bun.New(@This());

            pub const Result = struct {
                value: Value,
                ref: Async.KeepAlive = .{},

                task: JSC.AnyTask = undefined,
                promise: JSC.JSPromise.Strong,
                global: *JSC.JSGlobalObject,

                pub usingnamespace bun.New(@This());

                pub const Value = union(enum) {
                    err: PasswordObject.HashError,
                    hash: []const u8,

                    pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                        const error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD_{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch bun.outOfMemory();
                        defer bun.default_allocator.free(error_code);
                        const instance = globalObject.createErrorInstance("Password hashing failed with error \"{s}\"", .{@errorName(this.err)});
                        instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toJS(globalObject));
                        return instance;
                    }
                };

                pub fn runFromJS(this: *Result) void {
                    var promise = this.promise;
                    defer promise.deinit();
                    this.promise = .{};
                    this.ref.unref(this.global.bunVM());
                    const global = this.global;
                    switch (this.value) {
                        .err => {
                            const error_instance = this.value.toErrorInstance(global);
                            this.destroy();
                            promise.reject(global, error_instance);
                        },
                        .hash => |value| {
                            const js_string = JSC.ZigString.init(value).toJS(global);
                            this.destroy();
                            promise.resolve(global, js_string);
                        },
                    }
                }
            };

            pub fn deinit(this: *HashJob) void {
                this.promise.deinit();
                bun.default_allocator.free(this.password);
                this.destroy();
            }

            pub fn getValue(password: []const u8, algorithm: PasswordObject.Algorithm.Value) Result.Value {
                const value = PasswordObject.hash(bun.default_allocator, password, algorithm) catch |err| {
                    return Result.Value{ .err = err };
                };
                return Result.Value{ .hash = value };
            }

            pub fn run(task: *bun.ThreadPool.Task) void {
                var this: *HashJob = @fieldParentPtr("task", task);

                var result = Result.new(.{
                    .value = getValue(this.password, this.algorithm),
                    .task = undefined,
                    .promise = this.promise,
                    .global = this.global,
                    .ref = this.ref,
                });
                result.task = JSC.AnyTask.New(Result, Result.runFromJS).init(result);
                this.ref = .{};
                this.promise.strong = .{};
                this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
                this.deinit();
            }
        };

        pub fn hash(globalObject: *JSC.JSGlobalObject, password: []const u8, algorithm: PasswordObject.Algorithm.Value, comptime sync: bool) bun.JSError!JSC.JSValue {
            assert(password.len > 0); // caller must check

            if (comptime sync) {
                const value = HashJob.getValue(password, algorithm);
                switch (value) {
                    .err => {
                        const error_instance = value.toErrorInstance(globalObject);
                        return globalObject.throwValue(error_instance);
                    },
                    .hash => |h| {
                        return JSC.ZigString.init(h).toJS(globalObject);
                    },
                }

                unreachable;
            }

            const promise = JSC.JSPromise.Strong.init(globalObject);

            var job = HashJob.new(.{
                .algorithm = algorithm,
                .password = password,
                .promise = promise,
                .event_loop = globalObject.bunVM().eventLoop(),
                .global = globalObject,
            });
            job.ref.ref(globalObject.bunVM());
            JSC.WorkPool.schedule(&job.task);

            return promise.value();
        }

        pub fn verify(globalObject: *JSC.JSGlobalObject, password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm, comptime sync: bool) bun.JSError!JSC.JSValue {
            assert(password.len > 0); // caller must check

            if (comptime sync) {
                const value = VerifyJob.getValue(password, prev_hash, algorithm);
                switch (value) {
                    .err => {
                        const error_instance = value.toErrorInstance(globalObject);
                        return globalObject.throwValue(error_instance);
                    },
                    .pass => |pass| {
                        return JSC.JSValue.jsBoolean(pass);
                    },
                }

                unreachable;
            }

            var promise = JSC.JSPromise.Strong.init(globalObject);

            const job = VerifyJob.new(.{
                .algorithm = algorithm,
                .password = password,
                .prev_hash = prev_hash,
                .promise = promise,
                .event_loop = globalObject.bunVM().eventLoop(),
                .global = globalObject,
            });
            job.ref.ref(globalObject.bunVM());
            JSC.WorkPool.schedule(&job.task);

            return promise.value();
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub fn JSPasswordObject__hash(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments_ = callframe.arguments_old(2);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 1) {
                return globalObject.throwNotEnoughArguments("hash", 1, 0);
            }

            var algorithm = PasswordObject.Algorithm.Value.default;

            if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
                algorithm = try PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]);
            }

            const password_to_hash = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator) catch {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
                }
                return error.JSError;
            };
            errdefer bun.default_allocator.free(password_to_hash);

            if (password_to_hash.len == 0) {
                return globalObject.throwInvalidArguments("password must not be empty", .{});
            }

            return hash(globalObject, password_to_hash, algorithm, false);
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub fn JSPasswordObject__hashSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments_ = callframe.arguments_old(2);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 1) {
                return globalObject.throwNotEnoughArguments("hash", 1, 0);
            }

            var algorithm = PasswordObject.Algorithm.Value.default;

            if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
                algorithm = try PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]);
            }

            var string_or_buffer = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
                }
                return error.JSError;
            };
            defer string_or_buffer.deinit();

            if (string_or_buffer.slice().len == 0) {
                return globalObject.throwInvalidArguments("password must not be empty", .{});
            }

            return hash(globalObject, string_or_buffer.slice(), algorithm, true);
        }

        const VerifyJob = struct {
            algorithm: ?PasswordObject.Algorithm = null,
            password: []const u8,
            prev_hash: []const u8,
            promise: JSC.JSPromise.Strong,
            event_loop: *JSC.EventLoop,
            global: *JSC.JSGlobalObject,
            ref: Async.KeepAlive = .{},
            task: JSC.WorkPoolTask = .{ .callback = &run },

            pub usingnamespace bun.New(@This());

            pub const Result = struct {
                value: Value,
                ref: Async.KeepAlive = .{},

                task: JSC.AnyTask = undefined,
                promise: JSC.JSPromise.Strong,
                global: *JSC.JSGlobalObject,

                pub usingnamespace bun.New(@This());

                pub const Value = union(enum) {
                    err: PasswordObject.HashError,
                    pass: bool,

                    pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                        const error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch bun.outOfMemory();
                        defer bun.default_allocator.free(error_code);
                        const instance = globalObject.createErrorInstance("Password verification failed with error \"{s}\"", .{@errorName(this.err)});
                        instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toJS(globalObject));
                        return instance;
                    }
                };

                pub fn runFromJS(this: *Result) void {
                    var promise = this.promise;
                    defer promise.deinit();
                    this.promise = .{};
                    this.ref.unref(this.global.bunVM());
                    const global = this.global;
                    switch (this.value) {
                        .err => {
                            const error_instance = this.value.toErrorInstance(global);
                            this.destroy();
                            promise.reject(global, error_instance);
                        },
                        .pass => |pass| {
                            this.destroy();
                            promise.resolve(global, JSC.JSValue.jsBoolean(pass));
                        },
                    }
                }
            };

            pub fn deinit(this: *VerifyJob) void {
                this.promise.deinit();
                bun.default_allocator.free(this.password);
                bun.default_allocator.free(this.prev_hash);
                this.destroy();
            }

            pub fn getValue(password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm) Result.Value {
                const pass = PasswordObject.verify(bun.default_allocator, password, prev_hash, algorithm) catch |err| {
                    return Result.Value{ .err = err };
                };
                return Result.Value{ .pass = pass };
            }

            pub fn run(task: *bun.ThreadPool.Task) void {
                var this: *VerifyJob = @fieldParentPtr("task", task);

                var result = Result.new(.{
                    .value = getValue(this.password, this.prev_hash, this.algorithm),
                    .task = undefined,
                    .promise = this.promise,
                    .global = this.global,
                    .ref = this.ref,
                });
                result.task = JSC.AnyTask.New(Result, Result.runFromJS).init(result);
                this.ref = .{};
                this.promise.strong = .{};
                this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
                this.deinit();
            }
        };

        // Once we have bindings generator, this should be replaced with a generated function
        pub fn JSPasswordObject__verify(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments_ = callframe.arguments_old(3);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 2) {
                return globalObject.throwNotEnoughArguments("verify", 2, 0);
            }

            var algorithm: ?PasswordObject.Algorithm = null;

            if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
                if (!arguments[2].isString()) {
                    return globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                }

                const algorithm_string = arguments[2].getZigString(globalObject);

                algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                    if (!globalObject.hasException()) {
                        return globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                    }
                    return error.JSError;
                };
            }

            const owned_password = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator) catch {
                if (!globalObject.hasException()) return globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
                return error.JSError;
            };

            const owned_hash = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[1], bun.default_allocator) catch {
                bun.default_allocator.free(owned_password);
                if (!globalObject.hasException()) return globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
                return error.JSError;
            };

            if (owned_hash.len == 0) {
                bun.default_allocator.free(owned_password);
                return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
            }

            if (owned_password.len == 0) {
                bun.default_allocator.free(owned_hash);
                return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
            }

            return verify(globalObject, owned_password, owned_hash, algorithm, false);
        }

        // Once we have bindings generator, this should be replaced with a generated function
        pub fn JSPasswordObject__verifySync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments_ = callframe.arguments_old(3);
            const arguments = arguments_.ptr[0..arguments_.len];

            if (arguments.len < 2) {
                return globalObject.throwNotEnoughArguments("verify", 2, 0);
            }

            var algorithm: ?PasswordObject.Algorithm = null;

            if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
                if (!arguments[2].isString()) {
                    return globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                }

                const algorithm_string = arguments[2].getZigString(globalObject);

                algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                    if (!globalObject.hasException()) {
                        return globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                    }
                    return .zero;
                };
            }

            var password = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
                }
                return .zero;
            };

            var hash_ = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[1]) orelse {
                password.deinit();
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
                }
                return .zero;
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

    pub const CryptoHasher = union(enum) {
        // HMAC_CTX contains 3 EVP_CTX, so let's store it as a pointer.
        hmac: ?*HMAC,

        evp: EVP,
        zig: CryptoHasherZig,

        const Digest = EVP.Digest;

        pub usingnamespace JSC.Codegen.JSCryptoHasher;
        usingnamespace bun.New(@This());

        pub const digest = JSC.wrapInstanceMethod(CryptoHasher, "digest_", false);
        pub const hash = JSC.wrapStaticMethod(CryptoHasher, "hash_", false);

        fn throwHmacConsumed(globalThis: *JSC.JSGlobalObject) bun.JSError {
            return globalThis.throw("HMAC has been consumed and is no longer usable", .{});
        }

        pub fn getByteLength(this: *CryptoHasher, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            return JSC.JSValue.jsNumber(switch (this.*) {
                .evp => |*inner| inner.size(),
                .hmac => |inner| if (inner) |hmac| hmac.size() else {
                    throwHmacConsumed(globalThis) catch return .zero;
                },
                .zig => |*inner| inner.digest_length,
            });
        }

        pub fn getAlgorithm(this: *CryptoHasher, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return switch (this.*) {
                inline .evp, .zig => |*inner| ZigString.fromUTF8(bun.asByteSlice(@tagName(inner.algorithm))).toJS(globalObject),
                .hmac => |inner| if (inner) |hmac| ZigString.fromUTF8(bun.asByteSlice(@tagName(hmac.algorithm))).toJS(globalObject) else {
                    throwHmacConsumed(globalObject) catch return .zero;
                },
            };
        }

        pub fn getAlgorithms(
            globalThis_: *JSC.JSGlobalObject,
            _: JSValue,
            _: JSValue,
        ) JSC.JSValue {
            return bun.String.toJSArray(globalThis_, &EVP.Algorithm.names.values);
        }

        fn hashToEncoding(globalThis: *JSGlobalObject, evp: *EVP, input: JSC.Node.BlobOrStringOrBuffer, encoding: JSC.Node.Encoding) bun.JSError!JSC.JSValue {
            var output_digest_buf: Digest = undefined;
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), &output_digest_buf) orelse {
                const err = BoringSSL.ERR_get_error();
                const instance = createCryptoError(globalThis, err);
                BoringSSL.ERR_clear_error();
                return globalThis.throwValue(instance);
            };
            return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, output_digest_buf[0..len]);
        }

        fn hashToBytes(globalThis: *JSGlobalObject, evp: *EVP, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.ArrayBuffer) bun.JSError!JSC.JSValue {
            var output_digest_buf: Digest = undefined;
            var output_digest_slice: []u8 = &output_digest_buf;
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            if (output) |output_buf| {
                const size = evp.size();
                var bytes = output_buf.byteSlice();
                if (bytes.len < size) {
                    return globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{size});
                }
                output_digest_slice = bytes[0..size];
            }

            const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), output_digest_slice) orelse {
                const err = BoringSSL.ERR_get_error();
                const instance = createCryptoError(globalThis, err);
                BoringSSL.ERR_clear_error();
                return globalThis.throwValue(instance);
            };

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                // Clone to GC-managed memory
                return JSC.ArrayBuffer.createBuffer(globalThis, output_digest_slice[0..len]);
            }
        }

        pub fn hash_(
            globalThis: *JSGlobalObject,
            algorithm: ZigString,
            input: JSC.Node.BlobOrStringOrBuffer,
            output: ?JSC.Node.StringOrBuffer,
        ) bun.JSError!JSC.JSValue {
            var evp = EVP.byName(algorithm, globalThis) orelse return try CryptoHasherZig.hashByName(globalThis, algorithm, input, output) orelse {
                return globalThis.throwInvalidArguments("Unsupported algorithm \"{any}\"", .{algorithm});
            };
            defer evp.deinit();

            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            return globalThis.ERR_INVALID_ARG_VALUE("Unknown encoding: {s}", .{str.slice()}).throw();
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

        // Bun.CryptoHasher(algorithm, hmacKey?: string | Buffer)
        pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*CryptoHasher {
            const arguments = callframe.arguments_old(2);
            if (arguments.len == 0) {
                return globalThis.throwInvalidArguments("Expected an algorithm name as an argument", .{});
            }

            const algorithm_name = arguments.ptr[0];
            if (algorithm_name.isEmptyOrUndefinedOrNull() or !algorithm_name.isString()) {
                return globalThis.throwInvalidArguments("algorithm must be a string", .{});
            }

            const algorithm = algorithm_name.getZigString(globalThis);

            if (algorithm.len == 0) {
                return globalThis.throwInvalidArguments("Invalid algorithm name", .{});
            }

            const hmac_value = arguments.ptr[1];
            var hmac_key: ?JSC.Node.StringOrBuffer = null;
            defer {
                if (hmac_key) |*key| {
                    key.deinit();
                }
            }

            if (!hmac_value.isEmptyOrUndefinedOrNull()) {
                hmac_key = JSC.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, hmac_value) orelse {
                    return globalThis.throwInvalidArguments("key must be a string or buffer", .{});
                };
            }

            return CryptoHasher.new(brk: {
                if (hmac_key) |*key| {
                    const chosen_algorithm = try algorithm_name.toEnumFromMap(globalThis, "algorithm", EVP.Algorithm, EVP.Algorithm.map);
                    if (chosen_algorithm == .ripemd160) {
                        // crashes at runtime.
                        return globalThis.throw("ripemd160 is not supported", .{});
                    }

                    break :brk .{
                        .hmac = HMAC.init(chosen_algorithm, key.slice()) orelse {
                            if (!globalThis.hasException()) {
                                const err = BoringSSL.ERR_get_error();
                                if (err != 0) {
                                    const instance = createCryptoError(globalThis, err);
                                    BoringSSL.ERR_clear_error();
                                    return globalThis.throwValue(instance);
                                } else {
                                    return globalThis.throwTODO("HMAC is not supported for this algorithm yet");
                                }
                            }
                            return error.JSError;
                        },
                    };
                }

                break :brk .{
                    .evp = EVP.byName(algorithm, globalThis) orelse return CryptoHasherZig.constructor(algorithm) orelse {
                        return globalThis.throwInvalidArguments("Unsupported algorithm {any}", .{algorithm});
                    },
                };
            });
        }

        pub fn getter(
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.JSObject,
        ) JSC.JSValue {
            return CryptoHasher.getConstructor(globalObject);
        }

        pub fn update(this: *CryptoHasher, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const thisValue = callframe.this();
            const arguments = callframe.arguments_old(2);
            const input = arguments.ptr[0];
            if (input.isEmptyOrUndefinedOrNull()) {
                return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
            }
            const encoding = arguments.ptr[1];
            const buffer = try JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValue(globalThis, globalThis.bunVM().allocator, input, encoding) orelse {
                if (!globalThis.hasException()) return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
                return error.JSError;
            };
            defer buffer.deinit();
            if (buffer == .blob and buffer.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            switch (this.*) {
                .evp => |*inner| {
                    inner.update(buffer.slice());
                    const err = BoringSSL.ERR_get_error();
                    if (err != 0) {
                        const instance = createCryptoError(globalThis, err);
                        BoringSSL.ERR_clear_error();
                        return globalThis.throwValue(instance);
                    }
                },
                .hmac => |inner| {
                    const hmac = inner orelse {
                        return throwHmacConsumed(globalThis);
                    };

                    hmac.update(buffer.slice());
                    const err = BoringSSL.ERR_get_error();
                    if (err != 0) {
                        const instance = createCryptoError(globalThis, err);
                        BoringSSL.ERR_clear_error();
                        return globalThis.throwValue(instance);
                    }
                },
                .zig => |*inner| {
                    inner.update(buffer.slice());
                    return thisValue;
                },
            }

            return thisValue;
        }

        pub fn copy(
            this: *CryptoHasher,
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.CallFrame,
        ) bun.JSError!JSC.JSValue {
            var new: CryptoHasher = undefined;
            switch (this.*) {
                .evp => |*inner| {
                    new = .{ .evp = inner.copy(globalObject.bunVM().rareData().boringEngine()) catch bun.outOfMemory() };
                },
                .hmac => |inner| {
                    const hmac = inner orelse {
                        return throwHmacConsumed(globalObject);
                    };
                    new = .{
                        .hmac = hmac.copy() catch {
                            const err = createCryptoError(globalObject, BoringSSL.ERR_get_error());
                            BoringSSL.ERR_clear_error();
                            return globalObject.throwValue(err);
                        },
                    };
                },
                .zig => |*inner| {
                    new = .{ .zig = inner.copy() };
                },
            }
            return CryptoHasher.new(new).toJS(globalObject);
        }

        pub fn digest_(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?JSC.Node.StringOrBuffer) bun.JSError!JSC.JSValue {
            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            return globalThis.ERR_INVALID_ARG_VALUE("Unknown encoding: {s}", .{str.slice()}).throw();
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

        fn digestToBytes(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) bun.JSError!JSC.JSValue {
            var output_digest_buf: EVP.Digest = undefined;
            var output_digest_slice: []u8 = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < output_digest_buf.len) {
                    return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{output_digest_buf.len}), .{});
                }
                output_digest_slice = bytes[0..bytes.len];
            } else {
                output_digest_buf = std.mem.zeroes(EVP.Digest);
            }

            const result = this.final(globalThis, output_digest_slice) catch return .zero;
            if (globalThis.hasException()) {
                return error.JSError;
            }

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                // Clone to GC-managed memory
                return JSC.ArrayBuffer.createBuffer(globalThis, result);
            }
        }

        fn digestToEncoding(this: *CryptoHasher, globalThis: *JSGlobalObject, encoding: JSC.Node.Encoding) bun.JSError!JSC.JSValue {
            var output_digest_buf: EVP.Digest = std.mem.zeroes(EVP.Digest);
            const output_digest_slice: []u8 = &output_digest_buf;
            const out = this.final(globalThis, output_digest_slice) catch return .zero;
            if (globalThis.hasException()) {
                return error.JSError;
            }
            return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, out);
        }

        fn final(this: *CryptoHasher, globalThis: *JSGlobalObject, output_digest_slice: []u8) bun.JSError![]u8 {
            return switch (this.*) {
                .hmac => |inner| brk: {
                    const hmac: *HMAC = inner orelse {
                        return throwHmacConsumed(globalThis);
                    };
                    this.hmac = null;
                    defer hmac.deinit();
                    break :brk hmac.final(output_digest_slice);
                },
                .evp => |*inner| inner.final(globalThis.bunVM().rareData().boringEngine(), output_digest_slice),
                .zig => |*inner| inner.final(output_digest_slice),
            };
        }

        pub fn finalize(this: *CryptoHasher) void {
            switch (this.*) {
                .evp => |*inner| {
                    // https://github.com/oven-sh/bun/issues/3250
                    inner.deinit();
                },
                .zig => |*inner| {
                    inner.deinit();
                },
                .hmac => |inner| {
                    if (inner) |hmac| {
                        hmac.deinit();
                    }
                },
            }
            this.destroy();
        }
    };

    const CryptoHasherZig = struct {
        algorithm: EVP.Algorithm,
        state: *anyopaque,
        digest_length: u8,

        const algo_map = [_]struct { string, type }{
            .{ "sha3-224", std.crypto.hash.sha3.Sha3_224 },
            .{ "sha3-256", std.crypto.hash.sha3.Sha3_256 },
            .{ "sha3-384", std.crypto.hash.sha3.Sha3_384 },
            .{ "sha3-512", std.crypto.hash.sha3.Sha3_512 },
            .{ "shake128", std.crypto.hash.sha3.Shake128 },
            .{ "shake256", std.crypto.hash.sha3.Shake256 },
        };

        inline fn digestLength(Algorithm: type) comptime_int {
            return switch (Algorithm) {
                std.crypto.hash.sha3.Shake128 => 16,
                std.crypto.hash.sha3.Shake256 => 32,
                else => Algorithm.digest_length,
            };
        }

        pub fn hashByName(globalThis: *JSGlobalObject, algorithm: ZigString, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.Node.StringOrBuffer) bun.JSError!?JSC.JSValue {
            inline for (algo_map) |item| {
                if (bun.strings.eqlComptime(algorithm.slice(), item[0])) {
                    return try hashByNameInner(globalThis, item[1], input, output);
                }
            }
            return null;
        }

        fn hashByNameInner(globalThis: *JSGlobalObject, comptime Algorithm: type, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.Node.StringOrBuffer) bun.JSError!JSC.JSValue {
            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            return globalThis.ERR_INVALID_ARG_VALUE("Unknown encoding: {s}", .{str.slice()}).throw();
                        };

                        if (encoding == .buffer) {
                            return hashByNameInnerToBytes(globalThis, Algorithm, input, null);
                        }

                        return hashByNameInnerToString(globalThis, Algorithm, input, encoding);
                    },
                    .buffer => |buffer| {
                        return hashByNameInnerToBytes(globalThis, Algorithm, input, buffer.buffer);
                    },
                }
            }
            return hashByNameInnerToBytes(globalThis, Algorithm, input, null);
        }

        fn hashByNameInnerToString(globalThis: *JSGlobalObject, comptime Algorithm: type, input: JSC.Node.BlobOrStringOrBuffer, encoding: JSC.Node.Encoding) bun.JSError!JSC.JSValue {
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            var h = Algorithm.init(.{});
            h.update(input.slice());

            var out: [digestLength(Algorithm)]u8 = undefined;
            h.final(&out);

            return encoding.encodeWithSize(globalThis, digestLength(Algorithm), &out);
        }

        fn hashByNameInnerToBytes(globalThis: *JSGlobalObject, comptime Algorithm: type, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.ArrayBuffer) bun.JSError!JSC.JSValue {
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            var h = Algorithm.init(.{});
            const digest_length_comptime = digestLength(Algorithm);

            if (output) |output_buf| {
                if (output_buf.byteSlice().len < digest_length_comptime) {
                    return globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{digest_length_comptime});
                }
            }

            h.update(input.slice());

            if (output) |output_buf| {
                h.final(output_buf.slice()[0..digest_length_comptime]);
                return output_buf.value;
            } else {
                var out: [digestLength(Algorithm)]u8 = undefined;
                h.final(&out);
                // Clone to GC-managed memory
                return JSC.ArrayBuffer.createBuffer(globalThis, &out);
            }
        }

        fn constructor(algorithm: ZigString) ?*CryptoHasher {
            inline for (algo_map) |item| {
                if (bun.strings.eqlComptime(algorithm.slice(), item[0])) {
                    return CryptoHasher.new(.{ .zig = .{
                        .algorithm = @field(EVP.Algorithm, item[0]),
                        .state = bun.new(item[1], item[1].init(.{})),
                        .digest_length = digestLength(item[1]),
                    } });
                }
            }
            return null;
        }

        fn update(self: *CryptoHasherZig, bytes: []const u8) void {
            inline for (algo_map) |item| {
                if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                    return item[1].update(@ptrCast(@alignCast(self.state)), bytes);
                }
            }
            @panic("unreachable");
        }

        fn copy(self: *const CryptoHasherZig) CryptoHasherZig {
            inline for (algo_map) |item| {
                if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                    return .{
                        .algorithm = self.algorithm,
                        .state = bun.dupe(item[1], @ptrCast(@alignCast(self.state))),
                        .digest_length = self.digest_length,
                    };
                }
            }
            @panic("unreachable");
        }

        fn final(self: *CryptoHasherZig, output_digest_slice: []u8) []u8 {
            inline for (algo_map) |item| {
                if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                    item[1].final(@ptrCast(@alignCast(self.state)), @ptrCast(output_digest_slice));
                    return output_digest_slice[0..self.digest_length];
                }
            }
            @panic("unreachable");
        }

        fn deinit(self: *CryptoHasherZig) void {
            inline for (algo_map) |item| {
                if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                    return bun.destroy(@as(*item[1], @ptrCast(@alignCast(self.state))));
                }
            }
            @panic("unreachable");
        }
    };

    fn StaticCryptoHasher(comptime Hasher: type, comptime name: [:0]const u8) type {
        return struct {
            hashing: Hasher = Hasher{},
            digested: bool = false,

            const ThisHasher = @This();

            pub usingnamespace @field(JSC.Codegen, "JS" ++ name);

            pub const digest = JSC.wrapInstanceMethod(ThisHasher, "digest_", false);
            pub const hash = JSC.wrapStaticMethod(ThisHasher, "hash_", false);

            pub fn getByteLength(
                _: *@This(),
                _: *JSC.JSGlobalObject,
            ) JSC.JSValue {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
            }

            pub fn getByteLengthStatic(
                _: *JSC.JSGlobalObject,
                _: JSValue,
                _: JSValue,
            ) JSC.JSValue {
                return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
            }

            fn hashToEncoding(globalThis: *JSGlobalObject, input: JSC.Node.BlobOrStringOrBuffer, encoding: JSC.Node.Encoding) bun.JSError!JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;

                if (input == .blob and input.blob.isBunFile()) {
                    return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                }

                if (comptime @typeInfo(@TypeOf(Hasher.hash)).Fn.params.len == 3) {
                    Hasher.hash(input.slice(), &output_digest_buf, JSC.VirtualMachine.get().rareData().boringEngine());
                } else {
                    Hasher.hash(input.slice(), &output_digest_buf);
                }

                return encoding.encodeWithSize(globalThis, Hasher.digest, &output_digest_buf);
            }

            fn hashToBytes(globalThis: *JSGlobalObject, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.ArrayBuffer) bun.JSError!JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
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
                input: JSC.Node.BlobOrStringOrBuffer,
                output: ?JSC.Node.StringOrBuffer,
            ) bun.JSError!JSC.JSValue {
                defer input.deinit();

                if (input == .blob and input.blob.isBunFile()) {
                    return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                }

                if (output) |string_or_buffer| {
                    switch (string_or_buffer) {
                        inline else => |*str| {
                            defer str.deinit();
                            const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                                return globalThis.ERR_INVALID_ARG_VALUE("Unknown encoding: {s}", .{str.slice()}).throw();
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

            pub fn constructor(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*@This() {
                const this = try bun.default_allocator.create(@This());
                this.* = .{ .hashing = Hasher.init() };
                return this;
            }

            pub fn getter(
                globalObject: *JSC.JSGlobalObject,
                _: *JSC.JSObject,
            ) JSC.JSValue {
                return ThisHasher.getConstructor(globalObject);
            }

            pub fn update(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                if (this.digested) {
                    return globalThis.ERR_INVALID_STATE(name ++ " hasher already digested, create a new instance to update", .{}).throw();
                }
                const thisValue = callframe.this();
                const input = callframe.argument(0);
                const buffer = JSC.Node.BlobOrStringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, input) orelse {
                    return globalThis.throwInvalidArguments("expected blob or string or buffer", .{});
                };
                defer buffer.deinit();

                if (buffer == .blob and buffer.blob.isBunFile()) {
                    return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                }
                this.hashing.update(buffer.slice());
                return thisValue;
            }

            pub fn digest_(
                this: *@This(),
                globalThis: *JSGlobalObject,
                output: ?JSC.Node.StringOrBuffer,
            ) bun.JSError!JSC.JSValue {
                if (this.digested) {
                    return globalThis.ERR_INVALID_STATE(name ++ " hasher already digested, create a new instance to digest again", .{}).throw();
                }
                if (output) |*string_or_buffer| {
                    switch (string_or_buffer.*) {
                        inline else => |*str| {
                            defer str.deinit();
                            const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                                return globalThis.ERR_INVALID_ARG_VALUE("Unknown encoding: {s}", .{str.slice()}).throw();
                            };

                            return this.digestToEncoding(globalThis, encoding);
                        },
                        .buffer => |*buffer| {
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

            fn digestToBytes(this: *@This(), globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) bun.JSError!JSC.JSValue {
                var output_digest_buf: Hasher.Digest = undefined;
                var output_digest_slice: *Hasher.Digest = &output_digest_buf;
                if (output) |output_buf| {
                    var bytes = output_buf.byteSlice();
                    if (bytes.len < Hasher.digest) {
                        return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                    }
                    output_digest_slice = bytes[0..Hasher.digest];
                } else {
                    output_digest_buf = std.mem.zeroes(Hasher.Digest);
                }

                this.hashing.final(output_digest_slice);
                this.digested = true;

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

                const output_digest_slice: *Hasher.Digest = &output_digest_buf;

                this.hashing.final(output_digest_slice);
                this.digested = true;

                return encoding.encodeWithSize(globalThis, Hasher.digest, output_digest_slice);
            }

            pub fn finalize(this: *@This()) void {
                VirtualMachine.get().allocator.destroy(this);
            }
        };
    }

    pub const MD4 = StaticCryptoHasher(Hashers.MD4, "MD4");
    pub const MD5 = StaticCryptoHasher(Hashers.MD5, "MD5");
    pub const SHA1 = StaticCryptoHasher(Hashers.SHA1, "SHA1");
    pub const SHA224 = StaticCryptoHasher(Hashers.SHA224, "SHA224");
    pub const SHA256 = StaticCryptoHasher(Hashers.SHA256, "SHA256");
    pub const SHA384 = StaticCryptoHasher(Hashers.SHA384, "SHA384");
    pub const SHA512 = StaticCryptoHasher(Hashers.SHA512, "SHA512");
    pub const SHA512_256 = StaticCryptoHasher(Hashers.SHA512_256, "SHA512_256");
};

pub fn nanoseconds(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const ns = globalThis.bunVM().origin_timer.read();
    return JSC.JSValue.jsNumberFromUint64(ns);
}

pub fn serve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var config: JSC.API.ServerConfig = brk: {
        var args = JSC.Node.ArgumentsSlice.init(globalObject.bunVM(), arguments);
        var config: JSC.API.ServerConfig = .{};

        try JSC.API.ServerConfig.fromJS(
            globalObject,
            &config,
            &args,
            callframe.isFromBunMain(globalObject.vm()),
            true,
        );

        if (globalObject.hasException()) {
            config.deinit();
            return .zero;
        }

        break :brk config;
    };

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

    switch (config.ssl_config != null) {
        inline else => |has_ssl_config| {
            switch (config.development) {
                inline else => |development| {
                    const ServerType = comptime switch (development) {
                        true => switch (has_ssl_config) {
                            true => JSC.API.DebugHTTPSServer,
                            false => JSC.API.DebugHTTPServer,
                        },
                        false => switch (has_ssl_config) {
                            true => JSC.API.HTTPSServer,
                            false => JSC.API.HTTPServer,
                        },
                    };

                    var server = try ServerType.init(&config, globalObject);
                    if (globalObject.hasException()) {
                        return .zero;
                    }
                    server.listen();
                    if (globalObject.hasException()) {
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
                },
            }
        },
    }
}

pub export fn Bun__escapeHTML16(globalObject: *JSC.JSGlobalObject, input_value: JSValue, ptr: [*]const u16, len: usize) JSValue {
    assert(len > 0);
    const input_slice = ptr[0..len];
    const escaped = strings.escapeHTMLForUTF16Input(globalObject.bunVM().allocator, input_slice) catch {
        return globalObject.throwValue(bun.String.static("Out of memory").toJS(globalObject)) catch .zero;
    };

    return switch (escaped) {
        .static => |val| ZigString.init(val).toJS(globalObject),
        .original => input_value,
        .allocated => |escaped_html| ZigString.from16(escaped_html.ptr, escaped_html.len).toExternalValue(globalObject),
    };
}

pub export fn Bun__escapeHTML8(globalObject: *JSC.JSGlobalObject, input_value: JSValue, ptr: [*]const u8, len: usize) JSValue {
    assert(len > 0);

    const input_slice = ptr[0..len];
    var stack_allocator = std.heap.stackFallback(256, globalObject.bunVM().allocator);
    const allocator = if (input_slice.len <= 32) stack_allocator.get() else stack_allocator.fallback_allocator;

    const escaped = strings.escapeHTMLForLatin1Input(allocator, input_slice) catch {
        return globalObject.throwValue(bun.String.static("Out of memory").toJS(globalObject)) catch .zero;
    };

    switch (escaped) {
        .static => |val| {
            return ZigString.init(val).toJS(globalObject);
        },
        .original => return input_value,
        .allocated => |escaped_html| {
            if (comptime Environment.allow_assert) {
                // the output should always be longer than the input
                assert(escaped_html.len > input_slice.len);

                // assert we do not allocate a new string unnecessarily
                assert(
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
    _ = Bun__escapeHTML8;
    _ = Bun__escapeHTML16;
}

pub fn allocUnsafe(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(1);
    const size = arguments.ptr[0];
    if (!size.isUInt32AsAnyInt()) {
        return globalThis.throwInvalidArguments("Expected a positive number", .{});
    }

    return JSC.JSValue.createUninitializedUint8Array(globalThis, size.toUInt64NoTruncate());
}

pub fn mmapFile(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    if (comptime Environment.isWindows) {
        return globalThis.throwTODO("mmapFile is not supported on Windows");
    }

    const arguments_ = callframe.arguments_old(2);
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer args.deinit();

    var buf: bun.PathBuffer = undefined;
    const path = brk: {
        if (args.nextEat()) |path| {
            if (path.isString()) {
                const path_str = try path.toSlice(globalThis, args.arena.allocator());
                if (path_str.len > bun.MAX_PATH_BYTES) {
                    return globalThis.throwInvalidArguments("Path too long", .{});
                }
                const paths = &[_]string{path_str.slice()};
                break :brk bun.path.joinAbsStringBuf(bun.fs.FileSystem.instance.top_level_dir, &buf, paths, .auto);
            }
        }
        return globalThis.throwInvalidArguments("Expected a path", .{});
    };

    buf[path.len] = 0;

    const buf_z: [:0]const u8 = buf[0..path.len :0];

    var flags: std.c.MAP = .{ .TYPE = .SHARED };

    // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
    var offset: usize = 0;
    var map_size: ?usize = null;

    if (args.nextEat()) |opts| {
        flags.TYPE = if ((try opts.get(globalThis, "shared") orelse JSValue.true).toBoolean())
            .SHARED
        else
            .PRIVATE;

        if (@hasField(std.c.MAP, "SYNC")) {
            if ((try opts.get(globalThis, "sync") orelse JSValue.false).toBoolean()) {
                flags.TYPE = .SHARED_VALIDATE;
                flags.SYNC = true;
            }
        }

        if (try opts.get(globalThis, "size")) |value| {
            map_size = @as(usize, @intCast(value.toInt64()));
        }

        if (try opts.get(globalThis, "offset")) |value| {
            offset = @as(usize, @intCast(value.toInt64()));
            offset = std.mem.alignBackwardAnyAlign(offset, std.mem.page_size);
        }
    }

    const map = switch (bun.sys.mmapFile(buf_z, flags, map_size, offset)) {
        .result => |map| map,

        .err => |err| {
            return globalThis.throwValue(err.toJSC(globalThis));
        },
    };

    return JSC.C.JSObjectMakeTypedArrayWithBytesNoCopy(globalThis, JSC.C.JSTypedArrayType.kJSTypedArrayTypeUint8Array, @as(?*anyopaque, @ptrCast(map.ptr)), map.len, struct {
        pub fn x(ptr: ?*anyopaque, size: ?*anyopaque) callconv(.C) void {
            _ = bun.sys.munmap(@as([*]align(std.mem.page_size) u8, @ptrCast(@alignCast(ptr)))[0..@intFromPtr(size)]);
        }
    }.x, @as(?*anyopaque, @ptrFromInt(map.len)), null).?.value();
}

pub fn getTranspilerConstructor(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return JSC.API.JSTranspiler.getConstructor(globalThis);
}

pub fn getFileSystemRouter(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return JSC.API.FileSystemRouter.getConstructor(globalThis);
}

pub fn getHashObject(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return HashObject.create(globalThis);
}

const HashObject = struct {
    pub const wyhash = hashWrap(std.hash.Wyhash);
    pub const adler32 = hashWrap(std.hash.Adler32);
    pub const crc32 = hashWrap(std.hash.Crc32);
    pub const cityHash32 = hashWrap(std.hash.CityHash32);
    pub const cityHash64 = hashWrap(std.hash.CityHash64);
    pub const xxHash32 = hashWrap(struct {
        pub fn hash(seed: u32, bytes: []const u8) u32 {
            // sidestep .hash taking in anytype breaking ArgTuple
            // downstream by forcing a type signature on the input
            return std.hash.XxHash32.hash(seed, bytes);
        }
    });
    pub const xxHash64 = hashWrap(struct {
        pub fn hash(seed: u32, bytes: []const u8) u64 {
            // sidestep .hash taking in anytype breaking ArgTuple
            // downstream by forcing a type signature on the input
            return std.hash.XxHash64.hash(seed, bytes);
        }
    });
    pub const xxHash3 = hashWrap(struct {
        pub fn hash(seed: u32, bytes: []const u8) u64 {
            // sidestep .hash taking in anytype breaking ArgTuple
            // downstream by forcing a type signature on the input
            return std.hash.XxHash3.hash(seed, bytes);
        }
    });
    pub const murmur32v2 = hashWrap(std.hash.murmur.Murmur2_32);
    pub const murmur32v3 = hashWrap(std.hash.murmur.Murmur3_32);
    pub const murmur64v2 = hashWrap(std.hash.murmur.Murmur2_64);

    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const function = JSC.createCallback(globalThis, ZigString.static("hash"), 1, wyhash);
        const fns = comptime .{
            "wyhash",
            "adler32",
            "crc32",
            "cityHash32",
            "cityHash64",
            "xxHash32",
            "xxHash64",
            "xxHash3",
            "murmur32v2",
            "murmur32v3",
            "murmur64v2",
        };
        inline for (fns) |name| {
            const value = JSC.createCallback(
                globalThis,
                ZigString.static(name),
                1,
                @field(HashObject, name),
            );
            function.put(globalThis, comptime ZigString.static(name), value);
        }

        return function;
    }

    fn hashWrap(comptime Hasher_: anytype) JSC.JSHostZigFunction {
        return struct {
            const Hasher = Hasher_;
            pub fn hash(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
                const arguments = callframe.arguments_old(2).slice();
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
                            .Float16Array,
                            .Float32Array,
                            .Float64Array,
                            .BigInt64Array,
                            .BigUint64Array,
                            .DataView,
                            => {
                                var array_buffer = arg.asArrayBuffer(globalThis) orelse {
                                    return globalThis.throwInvalidArguments("ArrayBuffer conversion error", .{});
                                };
                                input = array_buffer.byteSlice();
                            },
                            else => {
                                input_slice = try arg.toSlice(globalThis, bun.default_allocator);
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
                    if (comptime bun.trait.isNumber(@TypeOf(function_args[0]))) {
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
        }.hash;
    }
};

pub fn getTOMLObject(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return TOMLObject.create(globalThis);
}

pub fn getGlobConstructor(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return JSC.API.Glob.getConstructor(globalThis);
}
pub fn getS3ClientConstructor(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return JSC.WebCore.S3Client.getConstructor(globalThis);
}
pub fn getS3DefaultClient(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return globalThis.bunVM().rareData().s3DefaultClient(globalThis);
}
pub fn getEmbeddedFiles(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    const vm = globalThis.bunVM();
    const graph = vm.standalone_module_graph orelse return JSC.JSValue.createEmptyArray(globalThis, 0);

    const unsorted_files = graph.files.values();
    var sort_indices = std.ArrayList(u32).initCapacity(bun.default_allocator, unsorted_files.len) catch bun.outOfMemory();
    defer sort_indices.deinit();
    for (0..unsorted_files.len) |index| {
        // Some % of people using `bun build --compile` want to obscure the source code
        // We don't really do that right now, but exposing the output source
        // code here as an easily accessible Blob is even worse for them.
        // So let's omit any source code files from the list.
        if (unsorted_files[index].loader.isJavaScriptLike()) continue;
        sort_indices.appendAssumeCapacity(@intCast(index));
    }

    var i: u32 = 0;
    var array = JSC.JSValue.createEmptyArray(globalThis, sort_indices.items.len);
    std.mem.sort(u32, sort_indices.items, unsorted_files, bun.StandaloneModuleGraph.File.lessThanByIndex);
    for (sort_indices.items) |index| {
        const file = &unsorted_files[index];
        // We call .dupe() on this to ensure that we don't return a blob that might get freed later.
        const input_blob = file.blob(globalThis);
        const blob = JSC.WebCore.Blob.new(input_blob.dupeWithContentType(true));
        blob.allocator = bun.default_allocator;
        blob.name = input_blob.name.dupeRef();
        array.putIndex(globalThis, i, blob.toJS(globalThis));
        i += 1;
    }

    return array;
}

pub fn getSemver(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return SemverObject.create(globalThis);
}

pub fn getUnsafe(globalThis: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    return UnsafeObject.create(globalThis);
}

const UnsafeObject = struct {
    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const object = JSValue.createEmptyObject(globalThis, 3);
        const fields = comptime .{
            .gcAggressionLevel = gcAggressionLevel,
            .arrayBufferToString = arrayBufferToString,
            .mimallocDump = dump_mimalloc,
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
    ) bun.JSError!JSC.JSValue {
        const ret = JSValue.jsNumber(@as(i32, @intFromEnum(globalThis.bunVM().aggressive_garbage_collection)));
        const value = callframe.arguments_old(1).ptr[0];

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

    pub fn arrayBufferToString(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callframe.arguments_old(2).slice();
        if (args.len < 1 or !args[0].isCell() or !args[0].jsType().isTypedArray()) {
            return globalThis.throwInvalidArguments("Expected an ArrayBuffer", .{});
        }

        const array_buffer = JSC.ArrayBuffer.fromTypedArray(globalThis, args[0]);
        switch (array_buffer.typed_array_type) {
            .Uint16Array, .Int16Array => {
                var zig_str = ZigString.init("");
                zig_str._unsafe_ptr_do_not_use = @as([*]const u8, @ptrCast(@alignCast(array_buffer.ptr)));
                zig_str.len = array_buffer.len;
                zig_str.markUTF16();
                return zig_str.toJS(globalThis);
            },
            else => {
                return ZigString.init(array_buffer.slice()).toJS(globalThis);
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
                parse,
            ),
        );

        return object;
    }

    pub fn parse(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        var arena = bun.ArenaAllocator.init(globalThis.allocator());
        const allocator = arena.allocator();
        defer arena.deinit();
        var log = logger.Log.init(default_allocator);
        const arguments = callframe.arguments_old(1).slice();
        if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("Expected a string to parse", .{});
        }

        var input_slice = try arguments[0].toSlice(globalThis, bun.default_allocator);
        defer input_slice.deinit();
        var source = logger.Source.initPathString("input.toml", input_slice.slice());
        const parse_result = TOMLParser.parse(&source, &log, allocator, false) catch {
            return globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to parse toml"));
        };

        // for now...
        const buffer_writer = js_printer.BufferWriter.init(allocator) catch {
            return globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
        };
        var writer = js_printer.BufferPrinter.init(buffer_writer);
        _ = js_printer.printJSON(*js_printer.BufferPrinter, &writer, parse_result, &source, .{}) catch {
            return globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
        };

        const slice = writer.ctx.buffer.slice();
        var out = bun.String.fromUTF8(slice);
        defer out.deref();

        return out.toJSByParseJSON(globalThis);
    }
};

const Debugger = JSC.Debugger;

pub const Timer = @import("./Timer.zig");

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
                return bun.String.createUTF8ForJS(globalThis, slice);
            },
        }
    }

    pub const dom_call = JSC.DOMCall("FFI", @This(), "ptr", JSC.DOMEffect.forRead(.TypedArrayProperties));

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
            .u8 = JSC.DOMCall("Reader", @This(), "u8", JSC.DOMEffect.forRead(.World)),
            .u16 = JSC.DOMCall("Reader", @This(), "u16", JSC.DOMEffect.forRead(.World)),
            .u32 = JSC.DOMCall("Reader", @This(), "u32", JSC.DOMEffect.forRead(.World)),
            .ptr = JSC.DOMCall("Reader", @This(), "ptr", JSC.DOMEffect.forRead(.World)),
            .i8 = JSC.DOMCall("Reader", @This(), "i8", JSC.DOMEffect.forRead(.World)),
            .i16 = JSC.DOMCall("Reader", @This(), "i16", JSC.DOMEffect.forRead(.World)),
            .i32 = JSC.DOMCall("Reader", @This(), "i32", JSC.DOMEffect.forRead(.World)),
            .i64 = JSC.DOMCall("Reader", @This(), "i64", JSC.DOMEffect.forRead(.World)),
            .u64 = JSC.DOMCall("Reader", @This(), "u64", JSC.DOMEffect.forRead(.World)),
            .intptr = JSC.DOMCall("Reader", @This(), "intptr", JSC.DOMEffect.forRead(.World)),
            .f32 = JSC.DOMCall("Reader", @This(), "f32", JSC.DOMEffect.forRead(.World)),
            .f64 = JSC.DOMCall("Reader", @This(), "f64", JSC.DOMEffect.forRead(.World)),
        };

        pub fn toJS(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            const obj = JSC.JSValue.createEmptyObject(globalThis, std.meta.fieldNames(@TypeOf(Reader.DOMCalls)).len);

            inline for (comptime std.meta.fieldNames(@TypeOf(Reader.DOMCalls))) |field| {
                @field(Reader.DOMCalls, field).put(globalThis, obj);
            }

            return obj;
        }

        pub fn @"u8"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u16"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn ptr(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i8"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i16"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn intptr(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"i64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.fromInt64NoTruncate(globalObject, value);
        }

        pub fn @"u64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) bun.JSError!JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                return globalObject.throwInvalidArguments("Expected a pointer", .{});
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.fromUInt64NoTruncate(globalObject, value);
        }

        pub fn u8WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn u16WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn u32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn ptrWithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i8WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i16WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn i32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn intptrWithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn f32WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn f64WithoutTypeChecks(
            _: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn u64WithoutTypeChecks(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
            const addr = @as(usize, @intCast(raw_addr)) + @as(usize, @intCast(offset));
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.fromUInt64NoTruncate(global, value);
        }

        pub fn i64WithoutTypeChecks(
            global: *JSGlobalObject,
            _: *anyopaque,
            raw_addr: i64,
            offset: i32,
        ) callconv(JSC.conv) JSValue {
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
    ) callconv(JSC.conv) JSValue {
        return JSValue.fromPtrAddress(@intFromPtr(array.ptr()));
    }

    fn ptr_(
        globalThis: *JSGlobalObject,
        value: JSValue,
        byteOffset: ?JSValue,
    ) JSValue {
        if (value == .zero) {
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
        // assert(addr == @intFromPtr(value.asEncoded().ptr) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector);

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

        if (addr > max_addressable_memory) {
            return JSC.toInvalidArguments("Pointer is outside max addressible memory, which usually means a bug in your program.", .{}, globalThis);
        }

        if (addr == 0) {
            return JSC.toInvalidArguments("Pointer must not be 0", .{}, globalThis);
        }

        if (addr == 0xDEADBEEF or addr == 0xaaaaaaaa or addr == 0xAAAAAAAA) {
            return JSC.toInvalidArguments("ptr to invalid memory, that would segfault Bun :(", .{}, globalThis);
        }

        if (comptime Environment.allow_assert) {
            assert(JSC.JSValue.fromPtrAddress(addr).asPtrAddress() == addr);
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

                if (length_i > max_addressable_memory) {
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
            .err => |err| {
                return err;
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
            .err => |err| {
                return err;
            },
            .slice => |slice| {
                return JSC.JSValue.createBuffer(globalThis, slice, null);
            },
        }
    }

    pub fn getter(
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.JSObject,
    ) JSC.JSValue {
        return FFIObject.toJS(globalObject);
    }
};

pub fn stringWidth(str: bun.String, opts: gen.StringWidthOptions) usize {
    if (str.length() == 0)
        return 0;

    if (opts.count_ansi_escape_codes)
        return str.visibleWidth(!opts.ambiguous_is_narrow);

    return str.visibleWidthExcludeANSIColors(!opts.ambiguous_is_narrow);
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
// This is aliased to Bun.env
pub const EnvironmentVariables = struct {
    pub export fn Bun__getEnvCount(globalObject: *JSC.JSGlobalObject, ptr: *[*][]const u8) usize {
        const bunVM = globalObject.bunVM();
        ptr.* = bunVM.transpiler.env.map.map.keys().ptr;
        return bunVM.transpiler.env.map.map.unmanaged.entries.len;
    }

    pub export fn Bun__getEnvKey(ptr: [*][]const u8, i: usize, data_ptr: *[*]const u8) usize {
        const item = ptr[i];
        data_ptr.* = item.ptr;
        return item.len;
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
        const keys = vm.transpiler.env.map.map.keys();
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
        const value = vm.transpiler.env.get(sliced.slice()) orelse return null;
        return ZigString.initUTF8(value);
    }
};

export fn Bun__reportError(globalObject: *JSGlobalObject, err: JSC.JSValue) void {
    _ = JSC.VirtualMachine.get().uncaughtException(globalObject, err, false);
}

comptime {
    _ = Bun__reportError;
    _ = EnvironmentVariables.Bun__getEnvCount;
    _ = EnvironmentVariables.Bun__getEnvKey;
    _ = EnvironmentVariables.Bun__getEnvValue;
}

pub const JSZlib = struct {
    export fn reader_deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        var reader: *zlib.ZlibReaderArrayList = bun.cast(*zlib.ZlibReaderArrayList, ctx.?);
        reader.list.deinit(reader.allocator);
        reader.deinit();
    }
    export fn global_deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        comptime assert(bun.use_mimalloc);
        bun.Mimalloc.mi_free(ctx);
    }
    export fn compressor_deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        var compressor: *zlib.ZlibCompressorArrayList = bun.cast(*zlib.ZlibCompressorArrayList, ctx.?);
        compressor.list.deinit(compressor.allocator);
        compressor.deinit();
    }

    const Library = enum {
        zlib,
        libdeflate,

        pub const map = bun.ComptimeEnumMap(Library);
    };

    // This has to be `inline` due to the callframe.
    inline fn getOptions(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!struct { JSC.Node.StringOrBuffer, ?JSValue } {
        const arguments = callframe.arguments_old(2).slice();
        const buffer_value = if (arguments.len > 0) arguments[0] else .undefined;
        const options_val: ?JSValue =
            if (arguments.len > 1 and arguments[1].isObject())
            arguments[1]
        else if (arguments.len > 1 and !arguments[1].isUndefined()) {
            return globalThis.throwInvalidArguments("Expected options to be an object", .{});
        } else null;

        if (JSC.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, buffer_value)) |buffer| {
            return .{ buffer, options_val };
        }

        return globalThis.throwInvalidArguments("Expected buffer to be a string or buffer", .{});
    }

    pub fn gzipSync(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gzipOrDeflateSync(globalThis, buffer, options_val, true);
    }

    pub fn inflateSync(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gunzipOrInflateSync(globalThis, buffer, options_val, false);
    }

    pub fn deflateSync(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gzipOrDeflateSync(globalThis, buffer, options_val, false);
    }

    pub fn gunzipSync(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gunzipOrInflateSync(globalThis, buffer, options_val, true);
    }

    pub fn gunzipOrInflateSync(globalThis: *JSGlobalObject, buffer: JSC.Node.StringOrBuffer, options_val_: ?JSValue, is_gzip: bool) bun.JSError!JSValue {
        var opts = zlib.Options{
            .gzip = is_gzip,
            .windowBits = if (is_gzip) 31 else -15,
        };

        var library: Library = .zlib;
        if (options_val_) |options_val| {
            if (try options_val.get(globalThis, "windowBits")) |window| {
                opts.windowBits = window.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.get(globalThis, "level")) |level| {
                opts.level = level.coerce(i32, globalThis);
            }

            if (try options_val.get(globalThis, "memLevel")) |memLevel| {
                opts.memLevel = memLevel.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.get(globalThis, "strategy")) |strategy| {
                opts.strategy = strategy.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.getTruthy(globalThis, "library")) |library_value| {
                if (!library_value.isString()) {
                    return globalThis.throwInvalidArguments("Expected library to be a string", .{});
                }

                library = Library.map.fromJS(globalThis, library_value) orelse {
                    return globalThis.throwInvalidArguments("Expected library to be one of 'zlib' or 'libdeflate'", .{});
                };
            }
        }

        if (globalThis.hasException()) return .zero;

        const compressed = buffer.slice();
        const allocator = JSC.VirtualMachine.get().allocator;

        var list = brk: {
            if (is_gzip and compressed.len > 64) {
                //   0   1   2   3   4   5   6   7
                //  +---+---+---+---+---+---+---+---+
                //  |     CRC32     |     ISIZE     |
                //  +---+---+---+---+---+---+---+---+
                const estimated_size: u32 = @bitCast(compressed[compressed.len - 4 ..][0..4].*);
                // If it's > 256 MB, let's rely on dynamic allocation to minimize the risk of OOM.
                if (estimated_size > 0 and estimated_size < 256 * 1024 * 1024) {
                    break :brk try std.ArrayListUnmanaged(u8).initCapacity(allocator, @max(estimated_size, 64));
                }
            }

            break :brk try std.ArrayListUnmanaged(u8).initCapacity(allocator, if (compressed.len > 512) compressed.len else 32);
        };

        switch (library) {
            .zlib => {
                var reader = zlib.ZlibReaderArrayList.initWithOptions(compressed, &list, allocator, .{
                    .windowBits = opts.windowBits,
                    .level = opts.level,
                }) catch |err| {
                    list.deinit(allocator);
                    if (err == error.InvalidArgument) {
                        return globalThis.throw("Zlib error: Invalid argument", .{});
                    }

                    return globalThis.throwError(err, "Zlib error") catch return .zero;
                };

                reader.readAll() catch {
                    defer reader.deinit();
                    return globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
                };
                reader.list = .{ .items = reader.list.items };
                reader.list.capacity = reader.list.items.len;
                reader.list_ptr = &reader.list;

                var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
            },
            .libdeflate => {
                var decompressor: *bun.libdeflate.Decompressor = bun.libdeflate.Decompressor.alloc() orelse {
                    list.deinit(allocator);
                    return globalThis.throwOutOfMemory();
                };
                defer decompressor.deinit();
                while (true) {
                    const result = decompressor.decompress(compressed, list.allocatedSlice(), if (is_gzip) .gzip else .deflate);

                    list.items.len = result.written;

                    if (result.status == .insufficient_space) {
                        if (list.capacity > 1024 * 1024 * 1024) {
                            list.deinit(allocator);
                            return globalThis.throwOutOfMemory();
                        }

                        list.ensureTotalCapacity(allocator, list.capacity * 2) catch {
                            list.deinit(allocator);
                            return globalThis.throwOutOfMemory();
                        };
                        continue;
                    }

                    if (result.status == .success) {
                        list.items.len = result.written;
                        break;
                    }

                    list.deinit(allocator);
                    return globalThis.throw("libdeflate returned an error: {s}", .{@tagName(result.status)});
                }

                var array_buffer = JSC.ArrayBuffer.fromBytes(list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, list.items.ptr, global_deallocator, null);
            },
        }
    }

    pub fn gzipOrDeflateSync(
        globalThis: *JSGlobalObject,
        buffer: JSC.Node.StringOrBuffer,
        options_val_: ?JSValue,
        is_gzip: bool,
    ) bun.JSError!JSValue {
        var level: ?i32 = null;
        var library: Library = .zlib;
        var windowBits: i32 = 0;

        if (options_val_) |options_val| {
            if (try options_val.get(globalThis, "windowBits")) |window| {
                windowBits = window.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.getTruthy(globalThis, "library")) |library_value| {
                if (!library_value.isString()) {
                    return globalThis.throwInvalidArguments("Expected library to be a string", .{});
                }

                library = Library.map.fromJS(globalThis, library_value) orelse {
                    return globalThis.throwInvalidArguments("Expected library to be one of 'zlib' or 'libdeflate'", .{});
                };
            }

            if (try options_val.get(globalThis, "level")) |level_value| {
                level = level_value.coerce(i32, globalThis);
                if (globalThis.hasException()) return .zero;
            }
        }

        if (globalThis.hasException()) return .zero;

        const compressed = buffer.slice();
        const allocator = bun.default_allocator;

        switch (library) {
            .zlib => {
                var list = try std.ArrayListUnmanaged(u8).initCapacity(
                    allocator,
                    if (compressed.len > 512) compressed.len else 32,
                );

                var reader = zlib.ZlibCompressorArrayList.init(compressed, &list, allocator, .{
                    .windowBits = 15,
                    .gzip = is_gzip,
                    .level = level orelse 6,
                }) catch |err| {
                    defer list.deinit(allocator);
                    if (err == error.InvalidArgument) {
                        return globalThis.throw("Zlib error: Invalid argument", .{});
                    }

                    return globalThis.throwError(err, "Zlib error");
                };

                reader.readAll() catch {
                    defer reader.deinit();
                    return globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
                };
                reader.list = .{ .items = reader.list.toOwnedSlice(allocator) catch @panic("TODO") };
                reader.list.capacity = reader.list.items.len;
                reader.list_ptr = &reader.list;

                var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
            },
            .libdeflate => {
                var compressor: *bun.libdeflate.Compressor = bun.libdeflate.Compressor.alloc(level orelse 6) orelse {
                    return globalThis.throwOutOfMemory();
                };
                const encoding: bun.libdeflate.Encoding = if (is_gzip) .gzip else .deflate;
                defer compressor.deinit();

                var list = try std.ArrayListUnmanaged(u8).initCapacity(
                    allocator,
                    // This allocation size is unfortunate, but it's not clear how to avoid it with libdeflate.
                    compressor.maxBytesNeeded(compressed, encoding),
                );

                while (true) {
                    const result = compressor.compress(compressed, list.allocatedSlice(), encoding);

                    list.items.len = result.written;

                    if (result.status == .success) {
                        list.items.len = result.written;
                        break;
                    }

                    list.deinit(allocator);
                    return globalThis.throw("libdeflate error: {s}", .{@tagName(result.status)});
                }

                var array_buffer = JSC.ArrayBuffer.fromBytes(list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, list.items.ptr, global_deallocator, null);
            },
        }
    }
};

pub usingnamespace @import("./bun/subprocess.zig");

const InternalTestingAPIs = struct {
    pub fn BunInternalFunction__syntaxHighlighter(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const args = callframe.arguments_old(1);
        if (args.len < 1) {
            globalThis.throwNotEnoughArguments("code", 1, 0);
        }

        const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
        defer code.deinit();
        var buffer = MutableString.initEmpty(bun.default_allocator);
        defer buffer.deinit();
        var writer = buffer.bufferedWriter();
        const formatter = bun.fmt.fmtJavaScript(code.slice(), .{
            .enable_colors = true,
            .check_for_unhighlighted_write = false,
        });
        std.fmt.format(writer.writer(), "{}", .{formatter}) catch |err| {
            return globalThis.throwError(err, "Error formatting code");
        };

        writer.flush() catch |err| {
            return globalThis.throwError(err, "Error formatting code");
        };

        return bun.String.createUTF8ForJS(globalThis, buffer.list.items);
    }
};

comptime {
    _ = Crypto.JSPasswordObject.JSPasswordObject__create;
    BunObject.exportAll();
}

const assert = bun.assert;
