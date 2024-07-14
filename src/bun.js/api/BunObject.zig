const conv = std.builtin.CallingConvention.Unspecified;
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
    pub const connect = toJSCallback(JSC.wrapStaticMethod(JSC.API.Listener, "connect", false));
    pub const deflateSync = toJSCallback(JSC.wrapStaticMethod(JSZlib, "deflateSync", true));
    pub const file = toJSCallback(WebCore.Blob.constructBunFile);
    pub const gc = toJSCallback(Bun.runGC);
    pub const generateHeapSnapshot = toJSCallback(Bun.generateHeapSnapshot);
    pub const gunzipSync = toJSCallback(JSC.wrapStaticMethod(JSZlib, "gunzipSync", true));
    pub const gzipSync = toJSCallback(JSC.wrapStaticMethod(JSZlib, "gzipSync", true));
    pub const indexOfLine = toJSCallback(Bun.indexOfLine);
    pub const inflateSync = toJSCallback(JSC.wrapStaticMethod(JSZlib, "inflateSync", true));
    pub const jest = toJSCallback(@import("../test/jest.zig").Jest.call);
    pub const listen = toJSCallback(JSC.wrapStaticMethod(JSC.API.Listener, "listen", false));
    pub const udpSocket = toJSCallback(JSC.wrapStaticMethod(JSC.API.UDPSocket, "udpSocket", false));
    pub const mmap = toJSCallback(Bun.mmapFile);
    pub const nanoseconds = toJSCallback(Bun.nanoseconds);
    pub const openInEditor = toJSCallback(Bun.openInEditor);
    pub const registerMacro = toJSCallback(Bun.registerMacro);
    pub const resolve = toJSCallback(Bun.resolve);
    pub const resolveSync = toJSCallback(Bun.resolveSync);
    pub const serve = toJSCallback(Bun.serve);
    pub const sha = toJSCallback(JSC.wrapStaticMethod(Crypto.SHA512_256, "hash_", true));
    pub const shrink = toJSCallback(Bun.shrink);
    pub const sleepSync = toJSCallback(Bun.sleepSync);
    pub const spawn = toJSCallback(JSC.wrapStaticMethod(JSC.Subprocess, "spawn", false));
    pub const spawnSync = toJSCallback(JSC.wrapStaticMethod(JSC.Subprocess, "spawnSync", false));
    pub const which = toJSCallback(Bun.which);
    pub const write = toJSCallback(JSC.WebCore.Blob.writeFile);
    pub const stringWidth = toJSCallback(Bun.stringWidth);
    pub const braces = toJSCallback(Bun.braces);
    pub const shellEscape = toJSCallback(Bun.shellEscape);
    pub const createParsedShellScript = toJSCallback(bun.shell.ParsedShellScript.createParsedShellScript);
    pub const createShellInterpreter = toJSCallback(bun.shell.Interpreter.createShellInterpreter);
    // --- Callbacks ---

    // --- Getters ---
    pub const CryptoHasher = toJSGetter(Crypto.CryptoHasher.getter);
    pub const FFI = toJSGetter(Bun.FFIObject.getter);
    pub const FileSystemRouter = toJSGetter(Bun.getFileSystemRouter);
    pub const MD4 = toJSGetter(Crypto.MD4.getter);
    pub const MD5 = toJSGetter(Crypto.MD5.getter);
    pub const SHA1 = toJSGetter(Crypto.SHA1.getter);
    pub const SHA224 = toJSGetter(Crypto.SHA224.getter);
    pub const SHA256 = toJSGetter(Crypto.SHA256.getter);
    pub const SHA384 = toJSGetter(Crypto.SHA384.getter);
    pub const SHA512 = toJSGetter(Crypto.SHA512.getter);
    pub const SHA512_256 = toJSGetter(Crypto.SHA512_256.getter);
    pub const TOML = toJSGetter(Bun.getTOMLObject);
    pub const Glob = toJSGetter(Bun.getGlobConstructor);
    pub const Transpiler = toJSGetter(Bun.getTranspilerConstructor);
    pub const argv = toJSGetter(Bun.getArgv);
    pub const assetPrefix = toJSGetter(Bun.getAssetPrefix);
    pub const cwd = toJSGetter(Bun.getCWD);
    pub const enableANSIColors = toJSGetter(Bun.enableANSIColors);
    pub const hash = toJSGetter(Bun.getHashObject);
    pub const inspect = toJSGetter(Bun.getInspect);
    pub const main = toJSGetter(Bun.getMain);
    pub const origin = toJSGetter(Bun.getOrigin);
    pub const stderr = toJSGetter(Bun.getStderr);
    pub const stdin = toJSGetter(Bun.getStdin);
    pub const stdout = toJSGetter(Bun.getStdout);
    pub const unsafe = toJSGetter(Bun.getUnsafe);
    pub const semver = toJSGetter(Bun.getSemver);
    // --- Getters ---

    fn getterName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_getter_" ++ baseName;
    }

    fn callbackName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_callback_" ++ baseName;
    }

    const toJSCallback = JSC.toJSHostFunction;

    const LazyPropertyCallback = fn (*JSC.JSGlobalObject, *JSC.JSObject) callconv(JSC.conv) JSC.JSValue;

    fn toJSGetter(comptime getter: anytype) LazyPropertyCallback {
        return struct {
            pub fn callback(this: *JSC.JSGlobalObject, object: *JSC.JSObject) callconv(JSC.conv) JSC.JSValue {
                return @call(.always_inline, getter, .{ this, object });
            }
        }.callback;
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
        @export(BunObject.Glob, .{ .name = getterName("Glob") });
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
        @export(BunObject.semver, .{ .name = getterName("semver") });
        // --- Getters --

        // -- Callbacks --
        @export(BunObject.createParsedShellScript, .{ .name = callbackName("createParsedShellScript") });
        @export(BunObject.createShellInterpreter, .{ .name = callbackName("createShellInterpreter") });
        @export(BunObject.allocUnsafe, .{ .name = callbackName("allocUnsafe") });
        @export(BunObject.braces, .{ .name = callbackName("braces") });
        @export(BunObject.build, .{ .name = callbackName("build") });
        @export(BunObject.connect, .{ .name = callbackName("connect") });
        @export(BunObject.deflateSync, .{ .name = callbackName("deflateSync") });
        @export(BunObject.file, .{ .name = callbackName("file") });
        @export(BunObject.gc, .{ .name = callbackName("gc") });
        @export(BunObject.generateHeapSnapshot, .{ .name = callbackName("generateHeapSnapshot") });
        @export(BunObject.gunzipSync, .{ .name = callbackName("gunzipSync") });
        @export(BunObject.gzipSync, .{ .name = callbackName("gzipSync") });
        @export(BunObject.indexOfLine, .{ .name = callbackName("indexOfLine") });
        @export(BunObject.inflateSync, .{ .name = callbackName("inflateSync") });
        @export(BunObject.jest, .{ .name = callbackName("jest") });
        @export(BunObject.listen, .{ .name = callbackName("listen") });
        @export(BunObject.udpSocket, .{ .name = callbackName("udpSocket") });
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
        @export(BunObject.stringWidth, .{ .name = callbackName("stringWidth") });
        @export(BunObject.shellEscape, .{ .name = callbackName("shellEscape") });
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

const MacroEntryPoint = bun.bundler.MacroEntryPoint;
const logger = bun.logger;
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = bun.Bundler;
const ServerEntryPoint = bun.bundler.ServerEntryPoint;
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
const ParseResult = bun.bundler.ParseResult;
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
const Exception = bun.JSC.Exception;
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
const is_bindgen = JSC.is_bindgen;
const max_addressible_memory = std.math.maxInt(u56);
const glob = @import("../../glob.zig");
const Async = bun.Async;
const SemverObject = @import("../../install/semver.zig").SemverObject;
const Braces = @import("../../shell/braces.zig");
const Shell = @import("../../shell/shell.zig");

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

    const writer = css_imports_buf.writer();
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
    const tail = css_imports_list_tail;
    for (0..tail) |i| {
        ZigString.fromStringPointer(css_imports_list[i], css_imports_buf.items, &css_imports_list_strings[i]);
    }
    return css_imports_list_strings[0..tail];
}

const ShellTask = struct {
    arena: std.heap.Arena,
    script: std.ArrayList(u8),
    interpreter: Shell.InterpreterSync,

    pub const AsyncShellTask = JSC.ConcurrentPromiseTask(ShellTask);
};

pub fn shell(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const Interpreter = @import("../../shell/interpreter.zig").Interpreter;

    // var allocator = globalThis.bunVM().allocator;
    const allocator = getAllocator(globalThis);
    var arena = bun.ArenaAllocator.init(allocator);

    const arguments_ = callframe.arguments(8);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    const string_args = arguments.nextEat() orelse {
        globalThis.throw("shell: expected 2 arguments, got 0", .{});
        return JSC.JSValue.jsUndefined();
    };

    const template_args_js = arguments.nextEat() orelse {
        globalThis.throw("shell: expected 2 arguments, got 0", .{});
        return .undefined;
    };
    var template_args = template_args_js.arrayIterator(globalThis);
    var jsobjs = std.ArrayList(JSValue).init(arena.allocator());
    var script = std.ArrayList(u8).init(arena.allocator());

    if (!(bun.shell.shellCmdFromJS(globalThis, string_args, &template_args, &jsobjs, &script) catch {
        if (!globalThis.hasException())
            globalThis.throwOutOfMemory();
        return JSValue.undefined;
    })) {
        return .undefined;
    }

    if (globalThis.hasException()) {
        arena.deinit();
        return .undefined;
    }

    const lex_result = brk: {
        if (bun.strings.isAllASCII(script.items[0..])) {
            var lexer = Shell.LexerAscii.new(arena.allocator(), script.items[0..]);
            lexer.lex() catch |err| {
                globalThis.throwError(err, "failed to lex shell");
                return JSValue.undefined;
            };
            break :brk lexer.get_result();
        }
        var lexer = Shell.LexerUnicode.new(arena.allocator(), script.items[0..]);
        lexer.lex() catch |err| {
            globalThis.throwError(err, "failed to lex shell");
            return JSValue.undefined;
        };
        break :brk lexer.get_result();
    };

    var parser = Shell.Parser.new(arena.allocator(), lex_result, jsobjs.items[0..]) catch |err| {
        globalThis.throwError(err, "failed to create shell parser");
        return JSValue.undefined;
    };

    const script_ast = parser.parse() catch |err| {
        globalThis.throwError(err, "failed to parse shell");
        return JSValue.undefined;
    };

    const script_heap = arena.allocator().create(Shell.AST.Script) catch {
        globalThis.throwOutOfMemory();
        return JSValue.undefined;
    };

    script_heap.* = script_ast;

    const interpreter = Interpreter.init(
        globalThis,
        allocator,
        &arena,
        script_heap,
        jsobjs.items[0..],
    ) catch {
        arena.deinit();
        return .false;
    };
    _ = interpreter; // autofix

    // return interpreter;
    return .undefined;

    // return interpreter.start(globalThis) catch {
    //     return .false;
    // };
}

pub fn shellEscape(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throw("shell escape expected at least 1 argument", .{});
        return .undefined;
    }

    const jsval = arguments.ptr[0];
    const bunstr = jsval.toBunString(globalThis);
    if (globalThis.hasException()) return .zero;
    defer bunstr.deref();

    var outbuf = std.ArrayList(u8).init(bun.default_allocator);
    defer outbuf.deinit();

    if (bunstr.isUTF16()) {
        if (bun.shell.needsEscapeUTF16(bunstr.utf16())) {
            const result = bun.shell.escapeUtf16(bunstr.utf16(), &outbuf, true) catch {
                globalThis.throwOutOfMemory();
                return .undefined;
            };
            if (result.is_invalid) {
                globalThis.throw("String has invalid utf-16: {s}", .{bunstr.byteSlice()});
                return .undefined;
            }
            return bun.String.createUTF8(outbuf.items[0..]).toJS(globalThis);
        }
        return jsval;
    }

    if (bun.shell.needsEscapeUtf8AsciiLatin1(bunstr.latin1())) {
        bun.shell.escape8Bit(bunstr.byteSlice(), &outbuf, true) catch {
            globalThis.throwOutOfMemory();
            return .undefined;
        };
        return bun.String.createUTF8(outbuf.items[0..]).toJS(globalThis);
    }

    return jsval;
}

pub fn braces(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments_ = callframe.arguments(2);
    var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer arguments.deinit();

    const brace_str_js = arguments.nextEat() orelse {
        globalThis.throw("braces: expected at least 1 argument, got 0", .{});
        return JSC.JSValue.jsUndefined();
    };
    const brace_str = brace_str_js.toBunString(globalThis);
    defer brace_str.deref();
    if (globalThis.hasException()) return .zero;

    const brace_slice = brace_str.toUTF8(bun.default_allocator);
    defer brace_slice.deinit();

    var tokenize: bool = false;
    var parse: bool = false;
    if (arguments.nextEat()) |opts_val| {
        if (opts_val.isObject()) {
            if (comptime bun.Environment.allow_assert) {
                if (opts_val.getTruthy(globalThis, "tokenize")) |tokenize_val| {
                    tokenize = if (tokenize_val.isBoolean()) tokenize_val.asBoolean() else false;
                }

                if (opts_val.getTruthy(globalThis, "parse")) |tokenize_val| {
                    parse = if (tokenize_val.isBoolean()) tokenize_val.asBoolean() else false;
                }
            }
        }
    }
    if (globalThis.hasException()) return .zero;

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    var lexer_output = Braces.Lexer.tokenize(arena.allocator(), brace_slice.slice()) catch |err| {
        globalThis.throwError(err, "failed to tokenize braces");
        return .undefined;
    };

    const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]) catch |err| {
        globalThis.throwError(err, "failed to calculate brace expansion amount");
        return .undefined;
    };

    if (tokenize) {
        const str = std.json.stringifyAlloc(globalThis.bunVM().allocator, lexer_output.tokens.items[0..], .{}) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        };
        defer globalThis.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(globalThis);
    }
    if (parse) {
        var parser = Braces.Parser.init(lexer_output.tokens.items[0..], arena.allocator());
        const ast_node = parser.parse() catch |err| {
            globalThis.throwError(err, "failed to parse braces");
            return .undefined;
        };
        const str = std.json.stringifyAlloc(globalThis.bunVM().allocator, ast_node, .{}) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        };
        defer globalThis.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(globalThis);
    }

    if (expansion_count == 0) {
        return bun.String.toJSArray(globalThis, &.{brace_str});
    }

    var expanded_strings = arena.allocator().alloc(std.ArrayList(u8), expansion_count) catch {
        globalThis.throwOutOfMemory();
        return .undefined;
    };

    for (0..expansion_count) |i| {
        expanded_strings[i] = std.ArrayList(u8).init(arena.allocator());
    }

    Braces.expand(
        arena.allocator(),
        lexer_output.tokens.items[0..],
        expanded_strings,
        lexer_output.contains_nested,
    ) catch {
        globalThis.throwOutOfMemory();
        return .undefined;
    };

    var out_strings = arena.allocator().alloc(bun.String, expansion_count) catch {
        globalThis.throwOutOfMemory();
        return .undefined;
    };
    for (0..expansion_count) |i| {
        out_strings[i] = bun.String.fromBytes(expanded_strings[i].items[0..]);
    }

    return bun.String.toJSArray(globalThis, out_strings[0..]);
}

pub fn which(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments_ = callframe.arguments(2);
    var path_buf: bun.PathBuffer = undefined;
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
    if (globalThis.hasException()) {
        return .zero;
    }

    if (bin_str.len >= bun.MAX_PATH_BYTES) {
        globalThis.throw("bin path is too long", .{});
        return JSC.JSValue.jsUndefined();
    }

    if (bin_str.len == 0) {
        return JSC.JSValue.jsNull();
    }

    path_str = ZigString.Slice.fromUTF8NeverFree(
        globalThis.bunVM().bundler.env.get("PATH") orelse "",
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
        return ZigString.init(bin_path).withEncoding().toJS(globalThis);
    }

    return JSC.JSValue.jsNull();
}

pub fn inspect(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(4).slice();
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
                    const v = opt.coerce(f64, globalThis);
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
                    const v = depthArg.coerce(f64, globalThis);
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

    const writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    ConsoleObject.format2(
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
    const ret = out.toJS(globalThis);
    array.deinit();
    return ret;
}

pub fn getInspect(globalObject: *JSC.JSGlobalObject, _: *JSC.JSObject) JSC.JSValue {
    const fun = JSC.createCallback(globalObject, ZigString.static("inspect"), 2, inspect);
    var str = ZigString.init("nodejs.util.inspect.custom");
    fun.put(globalObject, ZigString.static("custom"), JSC.JSValue.symbolFor(globalObject, &str));
    return fun;
}

pub fn registerMacro(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
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

    const get_or_put_result = VirtualMachine.get().macros.getOrPut(id) catch unreachable;
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
) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().bundler.fs.top_level_dir).toJS(globalThis);
}

pub fn getOrigin(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().origin.origin).toJS(globalThis);
}

pub fn getStdin(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdin();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn getStderr(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stderr();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn getStdout(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdout();
    store.ref();
    var blob = JSC.WebCore.Blob.new(
        JSC.WebCore.Blob.initWithStore(store, globalThis),
    );
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn enableANSIColors(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    _ = globalThis;
    return JSValue.jsBoolean(Output.enable_ansi_colors);
}
pub fn getMain(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
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

pub fn getAssetPrefix(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return ZigString.init(VirtualMachine.get().bundler.options.routes.asset_prefix_path).toJS(globalThis);
}

pub fn getArgv(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return JSC.Node.Process.getArgv(globalThis);
}

const Editor = @import("../../open.zig").Editor;
pub fn openInEditor(
    globalThis: js.JSContextRef,
    callframe: *JSC.CallFrame,
) JSValue {
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
                const prev_name = edit.name;

                if (!strings.eqlLong(prev_name, sliced.slice(), true)) {
                    const prev = edit.*;
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
    return getPublicPathWithAssetPrefix(
        to,
        VirtualMachine.get().bundler.fs.top_level_dir,
        origin,
        VirtualMachine.get().bundler.options.routes.asset_prefix_path,
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
        VirtualMachine.get().bundler.fs.relativePlatform(dir, to, platform);
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

pub fn sleepSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
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

pub fn generateHeapSnapshot(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
    return globalObject.generateHeapSnapshot();
}

pub fn runGC(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments_ = callframe.arguments(1);
    const arguments = arguments_.slice();
    return globalObject.bunVM().garbageCollect(arguments.len > 0 and arguments[0].isBoolean() and arguments[0].toBoolean());
}
pub fn shrink(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
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

    const specifier_str = specifier.toBunString(globalThis);
    defer specifier_str.deref();
    const from_str = from.toBunString(globalThis);
    defer from_str.deref();
    return doResolveWithArgs(
        globalThis,
        specifier_str,
        from_str,
        exception,
        is_esm,
        false,
    );
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

    const specifier_decoded = if (specifier.hasPrefixComptime("file://"))
        bun.JSC.URL.pathFromFileURL(specifier)
    else
        specifier.dupeRef();
    defer specifier_decoded.deref();

    if (comptime is_file_path) {
        VirtualMachine.resolveFilePathForAPI(
            &errorable,
            ctx.ptr(),
            specifier_decoded,
            from,
            &query_string,
            is_esm,
        );
    } else {
        VirtualMachine.resolveForAPI(
            &errorable,
            ctx.ptr(),
            specifier_decoded,
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

        return ZigString.initUTF8(arraylist.items).toJS(ctx);
    }

    return errorable.result.value.toJS(ctx);
}

pub fn resolveSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    const exception = &exception_;
    const arguments = callframe.arguments(3);
    const result = doResolve(globalObject, arguments.slice(), exception);

    if (exception_[0] != null) {
        globalObject.throwValue(exception_[0].?.value());
    }

    return result orelse .zero;
}

pub fn resolve(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    var exception_ = [1]JSC.JSValueRef{null};
    const exception = &exception_;
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
    const exception = &exception_;
    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();

    const source_str = source.toBunString(global);
    defer source_str.deref();

    const value = doResolveWithArgs(global, specifier_str, source_str, exception, is_esm, true) orelse {
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
    const exception = &exception_;

    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();

    const source_str = source.toBunString(global);
    defer source_str.deref();

    return doResolveWithArgs(global, specifier_str, source_str, exception, is_esm, true) orelse {
        return JSC.JSValue.fromRef(exception[0]);
    };
}

export fn Bun__resolveSyncWithStrings(
    global: *JSGlobalObject,
    specifier: *bun.String,
    source: *bun.String,
    is_esm: bool,
) JSC.JSValue {
    Output.scoped(.importMetaResolve, false)("source: {s}, specifier: {s}", .{ source.*, specifier.* });
    var exception = [1]JSC.JSValueRef{null};
    return doResolveWithArgs(global, specifier.*, source.*, &exception, is_esm, true) orelse {
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
    const specifier_str = specifier.toBunString(global);
    defer specifier_str.deref();

    const exception = &exception_;
    return doResolveWithArgs(global, specifier_str, source.*, exception, is_esm, true) orelse {
        return JSC.JSValue.fromRef(exception[0]);
    };
}

pub fn getPublicPathJS(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments = callframe.arguments(1).slice();
    if (arguments.len < 1) {
        return bun.String.empty.toJS(globalObject);
    }
    var public_path_temp_str: bun.PathBuffer = undefined;

    const to = arguments[0].toSlice(globalObject, bun.default_allocator);
    defer to.deinit();
    var stream = std.io.fixedBufferStream(&public_path_temp_str);
    var writer = stream.writer();
    getPublicPath(to.slice(), VirtualMachine.get().origin, @TypeOf(&writer), &writer);

    return ZigString.init(stream.buffer[0..stream.pos]).toJS(globalObject);
}

extern fn dump_zone_malloc_stats() void;

fn dump_mimalloc(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
    globalObject.bunVM().arena.dumpStats();
    if (bun.heap_breakdown.enabled) {
        dump_zone_malloc_stats();
    }
    return .undefined;
}

pub fn indexOfLine(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
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

pub const Crypto = @import("./crypto.zig");

pub fn nanoseconds(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.CallFrame,
) JSC.JSValue {
    const ns = globalThis.bunVM().origin_timer.read();
    return JSC.JSValue.jsNumberFromUint64(ns);
}

pub fn serve(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(2).slice();
    var config: JSC.API.ServerConfig = brk: {
        var exception_ = [1]JSC.JSValueRef{null};
        const exception = &exception_;

        var args = JSC.Node.ArgumentsSlice.init(globalObject.bunVM(), arguments);
        var config_ = JSC.API.ServerConfig.fromJS(globalObject.ptr(), &args, exception);
        if (exception[0] != null) {
            config_.deinit();

            globalObject.throwValue(exception_[0].?.value());
            return .undefined;
        }

        if (globalObject.hasException()) {
            config_.deinit();

            return .zero;
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
    assert(len > 0);
    const input_slice = ptr[0..len];
    const escaped = strings.escapeHTMLForUTF16Input(globalObject.bunVM().allocator, input_slice) catch {
        globalObject.vm().throwError(globalObject, ZigString.init("Out of memory").toJS(globalObject));
        return JSC.JSValue.jsUndefined();
    };

    switch (escaped) {
        .static => |val| {
            return ZigString.init(val).toJS(globalObject);
        },
        .original => return input_value,
        .allocated => |escaped_html| {
            if (comptime Environment.allow_assert) {
                // assert that re-encoding the string produces the same result
                assert(
                    std.mem.eql(
                        u16,
                        (strings.toUTF16Alloc(bun.default_allocator, strings.toUTF8Alloc(bun.default_allocator, escaped_html) catch unreachable, false, false) catch unreachable).?,
                        escaped_html,
                    ),
                );

                // assert we do not allocate a new string unnecessarily
                assert(
                    !std.mem.eql(
                        u16,
                        input_slice,
                        escaped_html,
                    ),
                );

                // the output should always be longer than the input
                assert(escaped_html.len > input_slice.len);
            }

            return ZigString.from16(escaped_html.ptr, escaped_html.len).toExternalValue(globalObject);
        },
    }
}

pub export fn Bun__escapeHTML8(globalObject: *JSC.JSGlobalObject, input_value: JSValue, ptr: [*]const u8, len: usize) JSValue {
    assert(len > 0);

    const input_slice = ptr[0..len];
    var stack_allocator = std.heap.stackFallback(256, globalObject.bunVM().allocator);
    const allocator = if (input_slice.len <= 32) stack_allocator.get() else stack_allocator.fallback_allocator;

    const escaped = strings.escapeHTMLForLatin1Input(allocator, input_slice) catch {
        globalObject.vm().throwError(globalObject, ZigString.init("Out of memory").toJS(globalObject));
        return JSC.JSValue.jsUndefined();
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
    if (!JSC.is_bindgen) {
        _ = Bun__escapeHTML8;
        _ = Bun__escapeHTML16;
    }
}

pub fn allocUnsafe(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
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
) JSC.JSValue {
    if (comptime Environment.isWindows) {
        globalThis.throwTODO("mmapFile is not supported on Windows");
        return JSC.JSValue.zero;
    }

    const arguments_ = callframe.arguments(2);
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
    defer args.deinit();

    var buf: bun.PathBuffer = undefined;
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

    var flags: std.c.MAP = .{ .TYPE = .SHARED };

    // Conforming applications must specify either MAP_PRIVATE or MAP_SHARED.
    var offset: usize = 0;
    var map_size: ?usize = null;

    if (args.nextEat()) |opts| {
        flags.TYPE = if ((opts.get(globalThis, "shared") orelse JSValue.true).toBoolean())
            .SHARED
        else
            .PRIVATE;

        if (@hasField(std.c.MAP, "SYNC")) {
            if ((opts.get(globalThis, "sync") orelse JSValue.false).toBoolean()) {
                flags.TYPE = .SHARED_VALIDATE;
                flags.SYNC = true;
            }
        }

        if (opts.get(globalThis, "size")) |value| {
            map_size = @as(usize, @intCast(value.toInt64()));
        }

        if (opts.get(globalThis, "offset")) |value| {
            offset = @as(usize, @intCast(value.toInt64()));
            offset = std.mem.alignBackwardAnyAlign(offset, std.mem.page_size);
        }
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
) JSC.JSValue {
    return JSC.API.JSTranspiler.getConstructor(globalThis);
}

pub fn getFileSystemRouter(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return JSC.API.FileSystemRouter.getConstructor(globalThis);
}

pub fn getHashObject(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return HashObject.create(globalThis);
}

const HashObject = struct {
    pub const wyhash = hashWrap(std.hash.Wyhash);
    pub const adler32 = hashWrap(std.hash.Adler32);
    pub const crc32 = hashWrap(std.hash.Crc32);
    pub const cityHash32 = hashWrap(std.hash.CityHash32);
    pub const cityHash64 = hashWrap(std.hash.CityHash64);
    pub const murmur32v2 = hashWrap(std.hash.murmur.Murmur2_32);
    pub const murmur32v3 = hashWrap(std.hash.murmur.Murmur3_32);
    pub const murmur64v2 = hashWrap(std.hash.murmur.Murmur2_64);

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
                @field(HashObject, name),
            );
            function.put(globalThis, comptime ZigString.static(name), value);
        }

        return function;
    }

    fn hashWrap(comptime Hasher_: anytype) JSC.JSHostFunctionType {
        return struct {
            const Hasher = Hasher_;
            pub fn hash(
                globalThis: *JSC.JSGlobalObject,
                callframe: *JSC.CallFrame,
            ) callconv(JSC.conv) JSC.JSValue {
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

pub fn getTOMLObject(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return TOMLObject.create(globalThis);
}

pub fn getGlobConstructor(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return JSC.API.Glob.getConstructor(globalThis);
}

pub fn getSemver(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
    return SemverObject.create(globalThis);
}

pub fn getUnsafe(
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) JSC.JSValue {
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
    ) JSC.JSValue {
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

    pub fn arrayBufferToString(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const args = callframe.arguments(2).slice();
        if (args.len < 1 or !args[0].isCell() or !args[0].jsType().isTypedArray()) {
            globalThis.throwInvalidArguments("Expected an ArrayBuffer", .{});
            return .zero;
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
    ) JSC.JSValue {
        var arena = bun.ArenaAllocator.init(globalThis.allocator());
        const allocator = arena.allocator();
        defer arena.deinit();
        var log = logger.Log.init(default_allocator);
        const arguments = callframe.arguments(1).slice();
        if (arguments.len == 0 or arguments[0].isEmptyOrUndefinedOrNull()) {
            globalThis.throwInvalidArguments("Expected a string to parse", .{});
            return .zero;
        }

        var input_slice = arguments[0].toSlice(globalThis, bun.default_allocator);
        defer input_slice.deinit();
        var source = logger.Source.initPathString("input.toml", input_slice.slice());
        const parse_result = TOMLParser.parse(&source, &log, allocator) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to parse toml"));
            return .zero;
        };

        // for now...
        const buffer_writer = js_printer.BufferWriter.init(allocator) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
            return .zero;
        };
        var writer = js_printer.BufferPrinter.init(buffer_writer);
        _ = js_printer.printJSON(*js_printer.BufferPrinter, &writer, parse_result, &source, .{}) catch {
            globalThis.throwValue(log.toJS(globalThis, default_allocator, "Failed to print toml"));
            return .zero;
        };

        const slice = writer.ctx.buffer.toOwnedSliceLeaky();
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
                return WebCore.Encoder.toString(slice.ptr, slice.len, globalThis, .utf8);
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
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u16"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"u32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn ptr(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) u64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i8"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i8, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i16"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i16, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn @"i32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }
        pub fn intptr(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f32"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f32, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"f64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) f64, @ptrFromInt(addr)).*;
            return JSValue.jsNumber(value);
        }

        pub fn @"i64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
            }
            const addr = arguments[0].asPtrAddress() + if (arguments.len > 1) @as(usize, @intCast(arguments[1].to(i32))) else @as(usize, 0);
            const value = @as(*align(1) i64, @ptrFromInt(addr)).*;
            return JSValue.fromInt64NoTruncate(globalObject, value);
        }

        pub fn @"u64"(
            globalObject: *JSGlobalObject,
            _: JSValue,
            arguments: []const JSValue,
        ) JSValue {
            if (arguments.len == 0 or !arguments[0].isNumber()) {
                globalObject.throwInvalidArguments("Expected a pointer", .{});
                return .zero;
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
    ) JSC.JSValue {
        return FFIObject.toJS(globalObject);
    }
};

fn stringWidth(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments = callframe.arguments(2).slice();
    const value = if (arguments.len > 0) arguments[0] else JSC.JSValue.jsUndefined();
    const options_object = if (arguments.len > 1) arguments[1] else JSC.JSValue.jsUndefined();

    if (!value.isString()) {
        return JSC.jsNumber(0);
    }

    const str = value.toBunString(globalObject);
    defer str.deref();

    var count_ansi_escapes = false;
    var ambiguous_as_wide = false;

    if (options_object.isObject()) {
        if (options_object.getTruthy(globalObject, "countAnsiEscapeCodes")) |count_ansi_escapes_value| {
            if (count_ansi_escapes_value.isBoolean())
                count_ansi_escapes = count_ansi_escapes_value.toBoolean();
        }
        if (options_object.getTruthy(globalObject, "ambiguousIsNarrow")) |ambiguous_is_narrow| {
            if (ambiguous_is_narrow.isBoolean())
                ambiguous_as_wide = !ambiguous_is_narrow.toBoolean();
        }
    }

    if (count_ansi_escapes) {
        return JSC.jsNumber(str.visibleWidth(ambiguous_as_wide));
    }

    return JSC.jsNumber(str.visibleWidthExcludeANSIColors(ambiguous_as_wide));
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
// This is aliased to Bun.env
pub const EnvironmentVariables = struct {
    pub export fn Bun__getEnvCount(globalObject: *JSC.JSGlobalObject, ptr: *[*][]const u8) usize {
        const bunVM = globalObject.bunVM();
        ptr.* = bunVM.bundler.env.map.map.keys().ptr;
        return bunVM.bundler.env.map.map.unmanaged.entries.len;
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
        const value = vm.bundler.env.get(sliced.slice()) orelse return null;
        return ZigString.initUTF8(value);
    }
};

export fn Bun__reportError(globalObject: *JSGlobalObject, err: JSC.JSValue) void {
    _ = JSC.VirtualMachine.get().uncaughtException(globalObject, err, false);
}

comptime {
    if (!is_bindgen) {
        _ = Bun__reportError;
        _ = EnvironmentVariables.Bun__getEnvCount;
        _ = EnvironmentVariables.Bun__getEnvKey;
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

        const compressed = buffer.slice();
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
            globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
            return .zero;
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
        const compressed = buffer.slice();
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
            globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
            return .zero;
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
        const compressed = buffer.slice();
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
            globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
            return .zero;
        };
        reader.list = .{ .items = reader.list.toOwnedSlice(allocator) catch @panic("TODO") };
        reader.list.capacity = reader.list.items.len;
        reader.list_ptr = &reader.list;

        var array_buffer = JSC.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
        return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator, null);
    }
};

pub usingnamespace @import("./bun/subprocess.zig");

const InternalTestingAPIs = struct {
    pub fn BunInternalFunction__syntaxHighlighter(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        const args = callframe.arguments(1);
        if (args.len < 1) {
            globalThis.throwNotEnoughArguments("code", 1, 0);
        }

        const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
        defer code.deinit();
        var buffer = MutableString.initEmpty(bun.default_allocator);
        defer buffer.deinit();
        var writer = buffer.bufferedWriter();
        var formatter = bun.fmt.fmtJavaScript(code.slice(), true);
        formatter.limited = false;
        std.fmt.format(writer.writer(), "{}", .{formatter}) catch |err| {
            globalThis.throwError(err, "Error formatting code");
            return .zero;
        };

        writer.flush() catch |err| {
            globalThis.throwError(err, "Error formatting code");
            return .zero;
        };

        var str = bun.String.createUTF8(buffer.list.items);
        defer str.deref();
        return str.toJS(globalThis);
    }
};

comptime {
    _ = Crypto.JSPasswordObject.JSPasswordObject__create;
    BunObject.exportAll();
}

const assert = bun.assert;
