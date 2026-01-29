const Bun = @This();

/// How to add a new function or property to the Bun global
///
/// - Add a callback or property to the below struct
/// - @export it in the appropriate place
/// - Update "@begin bunObjectTable" in BunObject.cpp
///     - Getters use a generated wrapper function `BunObject_getter_wrap_<name>`
/// - Update "BunObject+exports.h"
/// - Run `bun run build`
pub const BunObject = struct {
    // --- Callbacks ---
    pub const allocUnsafe = toJSCallback(Bun.allocUnsafe);
    pub const build = toJSCallback(Bun.JSBundler.buildFn);
    pub const color = toJSCallback(bun.css.CssColor.jsFunctionColor);
    pub const connect = toJSCallback(host_fn.wrapStaticMethod(api.Listener, "connect", false));
    pub const createParsedShellScript = toJSCallback(bun.shell.ParsedShellScript.createParsedShellScript);
    pub const createShellInterpreter = toJSCallback(bun.shell.Interpreter.createShellInterpreter);
    pub const deflateSync = toJSCallback(JSZlib.deflateSync);
    pub const file = toJSCallback(WebCore.Blob.constructBunFile);
    pub const gunzipSync = toJSCallback(JSZlib.gunzipSync);
    pub const gzipSync = toJSCallback(JSZlib.gzipSync);
    pub const indexOfLine = toJSCallback(Bun.indexOfLine);
    pub const inflateSync = toJSCallback(JSZlib.inflateSync);
    pub const jest = toJSCallback(@import("../test/jest.zig").Jest.call);
    pub const listen = toJSCallback(host_fn.wrapStaticMethod(api.Listener, "listen", false));
    pub const mmap = toJSCallback(Bun.mmapFile);
    pub const nanoseconds = toJSCallback(Bun.nanoseconds);
    pub const openInEditor = toJSCallback(Bun.openInEditor);
    pub const registerMacro = toJSCallback(Bun.registerMacro);
    pub const resolve = toJSCallback(Bun.resolve);
    pub const resolveSync = toJSCallback(Bun.resolveSync);
    pub const serve = toJSCallback(Bun.serve);
    pub const sha = toJSCallback(host_fn.wrapStaticMethod(Crypto.SHA512_256, "hash_", true));
    pub const shellEscape = toJSCallback(Bun.shellEscape);
    pub const shrink = toJSCallback(Bun.shrink);
    pub const sleepSync = toJSCallback(Bun.sleepSync);
    pub const spawn = toJSCallback(host_fn.wrapStaticMethod(api.Subprocess, "spawn", false));
    pub const spawnSync = toJSCallback(host_fn.wrapStaticMethod(api.Subprocess, "spawnSync", false));
    pub const udpSocket = toJSCallback(host_fn.wrapStaticMethod(api.UDPSocket, "udpSocket", false));
    pub const which = toJSCallback(Bun.which);
    pub const write = toJSCallback(jsc.WebCore.Blob.writeFile);
    pub const zstdCompressSync = toJSCallback(JSZstd.compressSync);
    pub const zstdDecompressSync = toJSCallback(JSZstd.decompressSync);
    pub const zstdCompress = toJSCallback(JSZstd.compress);
    pub const zstdDecompress = toJSCallback(JSZstd.decompress);

    // --- Callbacks ---

    // --- Lazy property callbacks ---
    pub const Archive = toJSLazyPropertyCallback(Bun.getArchiveConstructor);
    pub const CryptoHasher = toJSLazyPropertyCallback(Crypto.CryptoHasher.getter);
    pub const CSRF = toJSLazyPropertyCallback(Bun.getCSRFObject);
    pub const FFI = toJSLazyPropertyCallback(Bun.FFIObject.getter);
    pub const FileSystemRouter = toJSLazyPropertyCallback(Bun.getFileSystemRouter);
    pub const Glob = toJSLazyPropertyCallback(Bun.getGlobConstructor);
    pub const MD4 = toJSLazyPropertyCallback(Crypto.MD4.getter);
    pub const MD5 = toJSLazyPropertyCallback(Crypto.MD5.getter);
    pub const SHA1 = toJSLazyPropertyCallback(Crypto.SHA1.getter);
    pub const SHA224 = toJSLazyPropertyCallback(Crypto.SHA224.getter);
    pub const SHA256 = toJSLazyPropertyCallback(Crypto.SHA256.getter);
    pub const SHA384 = toJSLazyPropertyCallback(Crypto.SHA384.getter);
    pub const SHA512 = toJSLazyPropertyCallback(Crypto.SHA512.getter);
    pub const SHA512_256 = toJSLazyPropertyCallback(Crypto.SHA512_256.getter);
    pub const JSONC = toJSLazyPropertyCallback(Bun.getJSONCObject);
    pub const TOML = toJSLazyPropertyCallback(Bun.getTOMLObject);
    pub const JSON5 = toJSLazyPropertyCallback(Bun.getJSON5Object);
    pub const YAML = toJSLazyPropertyCallback(Bun.getYAMLObject);
    pub const Transpiler = toJSLazyPropertyCallback(Bun.getTranspilerConstructor);
    pub const argv = toJSLazyPropertyCallback(Bun.getArgv);
    pub const cwd = toJSLazyPropertyCallback(Bun.getCWD);
    pub const embeddedFiles = toJSLazyPropertyCallback(Bun.getEmbeddedFiles);
    pub const enableANSIColors = toJSLazyPropertyCallback(Bun.enableANSIColors);
    pub const hash = toJSLazyPropertyCallback(Bun.getHashObject);
    pub const inspect = toJSLazyPropertyCallback(Bun.getInspect);
    pub const origin = toJSLazyPropertyCallback(Bun.getOrigin);
    pub const semver = toJSLazyPropertyCallback(Bun.getSemver);
    pub const unsafe = toJSLazyPropertyCallback(Bun.getUnsafe);
    pub const S3Client = toJSLazyPropertyCallback(Bun.getS3ClientConstructor);
    pub const s3 = toJSLazyPropertyCallback(Bun.getS3DefaultClient);
    pub const ValkeyClient = toJSLazyPropertyCallback(Bun.getValkeyClientConstructor);
    pub const valkey = toJSLazyPropertyCallback(Bun.getValkeyDefaultClient);
    pub const Terminal = toJSLazyPropertyCallback(Bun.getTerminalConstructor);
    // --- Lazy property callbacks ---

    // --- Getters ---
    pub const main = Bun.getMain;
    // --- Getters ---

    // --- Setters ---
    pub const setMain = Bun.setMain;
    // --- Setters ---

    fn lazyPropertyCallbackName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_lazyPropCb_" ++ baseName;
    }

    fn callbackName(comptime baseName: anytype) [:0]const u8 {
        return "BunObject_callback_" ++ baseName;
    }

    const toJSCallback = jsc.toJSHostFn;

    const LazyPropertyCallback = fn (*jsc.JSGlobalObject, *jsc.JSObject) callconv(jsc.conv) JSValue;

    fn toJSLazyPropertyCallback(comptime wrapped: anytype) LazyPropertyCallback {
        return struct {
            pub fn callback(this: *jsc.JSGlobalObject, object: *jsc.JSObject) callconv(jsc.conv) JSValue {
                return bun.jsc.toJSHostCall(this, @src(), wrapped, .{ this, object });
            }
        }.callback;
    }

    pub fn exportAll() void {
        if (!@inComptime()) {
            @compileError("Must be comptime");
        }

        // --- Lazy property callbacks ---
        @export(&BunObject.Archive, .{ .name = lazyPropertyCallbackName("Archive") });
        @export(&BunObject.CryptoHasher, .{ .name = lazyPropertyCallbackName("CryptoHasher") });
        @export(&BunObject.CSRF, .{ .name = lazyPropertyCallbackName("CSRF") });
        @export(&BunObject.FFI, .{ .name = lazyPropertyCallbackName("FFI") });
        @export(&BunObject.FileSystemRouter, .{ .name = lazyPropertyCallbackName("FileSystemRouter") });
        @export(&BunObject.MD4, .{ .name = lazyPropertyCallbackName("MD4") });
        @export(&BunObject.MD5, .{ .name = lazyPropertyCallbackName("MD5") });
        @export(&BunObject.SHA1, .{ .name = lazyPropertyCallbackName("SHA1") });
        @export(&BunObject.SHA224, .{ .name = lazyPropertyCallbackName("SHA224") });
        @export(&BunObject.SHA256, .{ .name = lazyPropertyCallbackName("SHA256") });
        @export(&BunObject.SHA384, .{ .name = lazyPropertyCallbackName("SHA384") });
        @export(&BunObject.SHA512, .{ .name = lazyPropertyCallbackName("SHA512") });
        @export(&BunObject.SHA512_256, .{ .name = lazyPropertyCallbackName("SHA512_256") });
        @export(&BunObject.JSONC, .{ .name = lazyPropertyCallbackName("JSONC") });
        @export(&BunObject.TOML, .{ .name = lazyPropertyCallbackName("TOML") });
        @export(&BunObject.JSON5, .{ .name = lazyPropertyCallbackName("JSON5") });
        @export(&BunObject.YAML, .{ .name = lazyPropertyCallbackName("YAML") });
        @export(&BunObject.Glob, .{ .name = lazyPropertyCallbackName("Glob") });
        @export(&BunObject.Transpiler, .{ .name = lazyPropertyCallbackName("Transpiler") });
        @export(&BunObject.argv, .{ .name = lazyPropertyCallbackName("argv") });
        @export(&BunObject.cwd, .{ .name = lazyPropertyCallbackName("cwd") });
        @export(&BunObject.enableANSIColors, .{ .name = lazyPropertyCallbackName("enableANSIColors") });
        @export(&BunObject.hash, .{ .name = lazyPropertyCallbackName("hash") });
        @export(&BunObject.inspect, .{ .name = lazyPropertyCallbackName("inspect") });
        @export(&BunObject.origin, .{ .name = lazyPropertyCallbackName("origin") });
        @export(&BunObject.unsafe, .{ .name = lazyPropertyCallbackName("unsafe") });
        @export(&BunObject.semver, .{ .name = lazyPropertyCallbackName("semver") });
        @export(&BunObject.embeddedFiles, .{ .name = lazyPropertyCallbackName("embeddedFiles") });
        @export(&BunObject.S3Client, .{ .name = lazyPropertyCallbackName("S3Client") });
        @export(&BunObject.s3, .{ .name = lazyPropertyCallbackName("s3") });
        @export(&BunObject.ValkeyClient, .{ .name = lazyPropertyCallbackName("ValkeyClient") });
        @export(&BunObject.valkey, .{ .name = lazyPropertyCallbackName("valkey") });
        @export(&BunObject.Terminal, .{ .name = lazyPropertyCallbackName("Terminal") });
        // --- Lazy property callbacks ---

        // --- Callbacks ---
        @export(&BunObject.allocUnsafe, .{ .name = callbackName("allocUnsafe") });
        @export(&BunObject.build, .{ .name = callbackName("build") });
        @export(&BunObject.color, .{ .name = callbackName("color") });
        @export(&BunObject.connect, .{ .name = callbackName("connect") });
        @export(&BunObject.createParsedShellScript, .{ .name = callbackName("createParsedShellScript") });
        @export(&BunObject.createShellInterpreter, .{ .name = callbackName("createShellInterpreter") });
        @export(&BunObject.deflateSync, .{ .name = callbackName("deflateSync") });
        @export(&BunObject.file, .{ .name = callbackName("file") });
        @export(&BunObject.gunzipSync, .{ .name = callbackName("gunzipSync") });
        @export(&BunObject.gzipSync, .{ .name = callbackName("gzipSync") });
        @export(&BunObject.indexOfLine, .{ .name = callbackName("indexOfLine") });
        @export(&BunObject.inflateSync, .{ .name = callbackName("inflateSync") });
        @export(&BunObject.jest, .{ .name = callbackName("jest") });
        @export(&BunObject.listen, .{ .name = callbackName("listen") });
        @export(&BunObject.mmap, .{ .name = callbackName("mmap") });
        @export(&BunObject.nanoseconds, .{ .name = callbackName("nanoseconds") });
        @export(&BunObject.openInEditor, .{ .name = callbackName("openInEditor") });
        @export(&BunObject.registerMacro, .{ .name = callbackName("registerMacro") });
        @export(&BunObject.resolve, .{ .name = callbackName("resolve") });
        @export(&BunObject.resolveSync, .{ .name = callbackName("resolveSync") });
        @export(&BunObject.serve, .{ .name = callbackName("serve") });
        @export(&BunObject.sha, .{ .name = callbackName("sha") });
        @export(&BunObject.shellEscape, .{ .name = callbackName("shellEscape") });
        @export(&BunObject.shrink, .{ .name = callbackName("shrink") });
        @export(&BunObject.sleepSync, .{ .name = callbackName("sleepSync") });
        @export(&BunObject.spawn, .{ .name = callbackName("spawn") });
        @export(&BunObject.spawnSync, .{ .name = callbackName("spawnSync") });
        @export(&BunObject.udpSocket, .{ .name = callbackName("udpSocket") });
        @export(&BunObject.which, .{ .name = callbackName("which") });
        @export(&BunObject.write, .{ .name = callbackName("write") });
        @export(&BunObject.zstdCompressSync, .{ .name = callbackName("zstdCompressSync") });
        @export(&BunObject.zstdDecompressSync, .{ .name = callbackName("zstdDecompressSync") });
        @export(&BunObject.zstdCompress, .{ .name = callbackName("zstdCompress") });
        @export(&BunObject.zstdDecompress, .{ .name = callbackName("zstdDecompress") });
        // --- Callbacks ---

        // --- LazyProperty initializers ---
        @export(&createBunStdin, .{ .name = "BunObject__createBunStdin" });
        @export(&createBunStderr, .{ .name = "BunObject__createBunStderr" });
        @export(&createBunStdout, .{ .name = "BunObject__createBunStdout" });
        // --- LazyProperty initializers ---

        // --- Getters ---
        @export(&BunObject.main, .{ .name = "BunObject_getter_main" });
        // --- Getters ---

        // --- Setters ---
        @export(&BunObject.setMain, .{ .name = "BunObject_setter_main" });
        // --- Setters ---
    }
};

pub fn shellEscape(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1);
    if (arguments.len < 1) {
        return globalThis.throw("shell escape expected at least 1 argument", .{});
    }

    const jsval = arguments.ptr[0];
    const bunstr = try jsval.toBunString(globalThis);
    if (globalThis.hasException()) return .zero;
    defer bunstr.deref();

    var outbuf = std.array_list.Managed(u8).init(bun.default_allocator);
    defer outbuf.deinit();

    if (bun.shell.needsEscapeBunstr(bunstr)) {
        const result = try bun.shell.escapeBunStr(bunstr, &outbuf, true);
        if (!result) {
            return globalThis.throw("String has invalid utf-16: {s}", .{bunstr.byteSlice()});
        }
        var str = bun.String.cloneUTF8(outbuf.items[0..]);
        return str.transferToJS(globalThis);
    }

    return jsval;
}

pub fn braces(global: *jsc.JSGlobalObject, brace_str: bun.String, opts: gen.BracesOptions) bun.JSError!jsc.JSValue {
    const brace_slice = brace_str.toUTF8(bun.default_allocator);
    defer brace_slice.deinit();

    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    var lexer_output = lexer_output: {
        if (bun.strings.isAllASCII(brace_slice.slice())) {
            break :lexer_output Braces.Lexer.tokenize(arena.allocator(), brace_slice.slice()) catch |err| {
                return global.throwError(err, "failed to tokenize braces");
            };
        }

        break :lexer_output Braces.NewLexer(.wtf8).tokenize(arena.allocator(), brace_slice.slice()) catch |err| {
            return global.throwError(err, "failed to tokenize braces");
        };
    };

    const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]);

    if (opts.tokenize) {
        const str = bun.handleOom(std.fmt.allocPrint(global.bunVM().allocator, "{f}", .{std.json.fmt(lexer_output.tokens.items[0..], .{})}));
        defer global.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(global);
    }
    if (opts.parse) {
        var parser = Braces.Parser.init(lexer_output.tokens.items[0..], arena.allocator());
        const ast_node = parser.parse() catch |err| {
            return global.throwError(err, "failed to parse braces");
        };
        const str = bun.handleOom(std.fmt.allocPrint(global.bunVM().allocator, "{f}", .{std.json.fmt(ast_node, .{})}));
        defer global.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(global);
    }

    if (expansion_count == 0) {
        return bun.String.toJSArray(global, &.{brace_str});
    }

    var expanded_strings = try arena.allocator().alloc(std.array_list.Managed(u8), expansion_count);

    for (0..expansion_count) |i| {
        expanded_strings[i] = std.array_list.Managed(u8).init(arena.allocator());
    }

    Braces.expand(
        arena.allocator(),
        lexer_output.tokens.items[0..],
        expanded_strings,
        lexer_output.contains_nested,
    ) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.UnexpectedToken => return global.throwPretty("Unexpected token while expanding braces", .{}),
    };

    var out_strings = try arena.allocator().alloc(bun.String, expansion_count);
    for (0..expansion_count) |i| {
        out_strings[i] = bun.String.fromBytes(expanded_strings[i].items[0..]);
    }

    return bun.String.toJSArray(global, out_strings[0..]);
}

pub fn which(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments_ = callframe.arguments_old(2);
    const path_buf = bun.path_buffer_pool.get();
    defer bun.path_buffer_pool.put(path_buf);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
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
        return jsc.JSValue.jsNull();
    }

    bin_str = try path_arg.toSlice(globalThis, globalThis.bunVM().allocator);
    if (globalThis.hasException()) {
        return .zero;
    }

    if (bin_str.len >= bun.MAX_PATH_BYTES) {
        return globalThis.throw("bin path is too long", .{});
    }

    if (bin_str.len == 0) {
        return jsc.JSValue.jsNull();
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

    return jsc.JSValue.jsNull();
}

pub fn inspectTable(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var args_buf = callframe.argumentsUndef(5);
    var all_arguments = args_buf.mut();
    if (all_arguments[0].isUndefinedOrNull() or !all_arguments[0].isObject())
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
    const value = arguments[0];

    if (!arguments[1].isArray()) {
        arguments[2] = arguments[1];
        arguments[1] = .js_undefined;
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

    // very stable memory address
    var array = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer array.deinit();
    const writer = &array.writer;

    const Writer = @TypeOf(writer);
    const properties: JSValue = if (arguments[1].jsType().isArray()) arguments[1] else .js_undefined;
    var table_printer = try ConsoleObject.TablePrinter.init(
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

    writer.flush() catch |e| switch (e) {
        error.WriteFailed => return error.OutOfMemory,
    };

    return bun.String.createUTF8ForJS(globalThis, array.written());
}

pub fn inspect(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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

    // very stable memory address
    var array = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer array.deinit();
    const writer = &array.writer;
    // we buffer this because it'll almost always be < 4096
    // when it's under 4096, we want to avoid the dynamic allocation
    try ConsoleObject.format2(
        .Debug,
        globalThis,
        arguments.ptr,
        1,
        writer,
        formatOptions,
    );
    if (globalThis.hasException()) return error.JSError;
    writer.flush() catch return globalThis.throwOutOfMemory();

    // we are going to always clone to keep things simple for now
    // the common case here will be stack-allocated, so it should be fine
    var out = ZigString.init(array.written()).withEncoding();
    const ret = out.toJS(globalThis);

    return ret;
}

export fn Bun__inspect(globalThis: *JSGlobalObject, value: JSValue) bun.String {
    // very stable memory address
    var array = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer array.deinit();
    const writer = &array.writer;

    var formatter = ConsoleObject.Formatter{ .globalThis = globalThis };
    defer formatter.deinit();
    writer.print("{f}", .{value.toFmt(&formatter)}) catch return .empty;
    writer.flush() catch return .empty;
    return bun.String.cloneUTF8(array.written());
}

export fn Bun__inspect_singleline(globalThis: *JSGlobalObject, value: JSValue) bun.String {
    var array = std.Io.Writer.Allocating.init(bun.default_allocator);
    defer array.deinit();
    const writer = &array.writer;
    ConsoleObject.format2(.Debug, globalThis, (&value)[0..1].ptr, 1, writer, .{
        .enable_colors = false,
        .add_newline = false,
        .flush = false,
        .max_depth = std.math.maxInt(u16),
        .quote_strings = true,
        .ordered_properties = false,
        .single_line = true,
    }) catch return .empty;
    if (globalThis.hasException()) return .empty;
    writer.flush() catch return .empty;
    return bun.String.cloneUTF8(array.written());
}

pub fn getInspect(globalObject: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    const fun = jsc.JSFunction.create(globalObject, "inspect", inspect, 2, .{});
    var str = ZigString.init("nodejs.util.inspect.custom");
    fun.put(globalObject, ZigString.static("custom"), jsc.JSValue.symbolFor(globalObject, &str));
    fun.put(globalObject, ZigString.static("table"), jsc.JSFunction.create(globalObject, "table", inspectTable, 3, .{}));
    return fun;
}

pub fn registerMacro(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    if (arguments.len != 2 or !arguments[0].isNumber()) {
        return globalObject.throwInvalidArguments("Internal error registering macros: invalid args", .{});
    }
    const id = arguments[0].toInt32();
    if (id == -1 or id == 0) {
        return globalObject.throwInvalidArguments("Internal error registering macros: invalid id", .{});
    }

    if (!arguments[1].isCell() or !arguments[1].isCallable()) {
        // TODO: add "toTypeOf" helper
        return globalObject.throw("Macro must be a function", .{});
    }

    const get_or_put_result = VirtualMachine.get().macros.getOrPut(id) catch unreachable;
    if (get_or_put_result.found_existing) {
        get_or_put_result.value_ptr.*.?.value().unprotect();
    }

    arguments[1].protect();
    get_or_put_result.value_ptr.* = arguments[1].asObjectRef();

    return .js_undefined;
}

pub fn getCWD(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return ZigString.init(VirtualMachine.get().transpiler.fs.top_level_dir).toJS(globalThis);
}

pub fn getOrigin(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return ZigString.init(VirtualMachine.get().origin.origin).toJS(globalThis);
}

pub fn enableANSIColors(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    _ = globalThis;
    return JSValue.jsBoolean(Output.enable_ansi_colors_stdout or Output.enable_ansi_colors_stderr);
}

fn getMain(globalThis: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
    const vm = globalThis.bunVM();
    // If JS has set it to a custom value, use that one
    if (vm.overridden_main.get()) |overridden_main| return overridden_main;

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

            defer fd.close();
            if (comptime Environment.isWindows) {
                var wpath: bun.WPathBuffer = undefined;
                const fdpath = bun.getFdPathW(fd, &wpath) catch break :use_resolved_path;
                vm.main_resolved_path = bun.String.cloneUTF16(fdpath);
            } else {
                var path: bun.PathBuffer = undefined;
                const fdpath = bun.getFdPath(fd, &path) catch break :use_resolved_path;

                // Bun.main === otherId will be compared many times, so let's try to create an atom string if we can.
                if (bun.String.tryCreateAtom(fdpath)) |atom| {
                    vm.main_resolved_path = atom;
                } else {
                    vm.main_resolved_path = bun.String.cloneUTF8(fdpath);
                }
            }
        }

        return vm.main_resolved_path.toJS(globalThis) catch .zero;
    }

    return ZigString.init(vm.main).toJS(globalThis);
}

fn setMain(global_this: *jsc.JSGlobalObject, new_value: JSValue) callconv(jsc.conv) bool {
    global_this.bunVM().overridden_main.set(global_this, new_value);
    return true;
}

pub fn getArgv(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return node.process.getArgv(globalThis);
}

pub fn openInEditor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    var edit = &VirtualMachine.get().rareData().editor_context;
    const args = callframe.arguments_old(4);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), args.slice());
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

    return .js_undefined;
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

pub fn sleepSync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
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
    const milliseconds = try arg.coerce(i32, globalObject);
    if (milliseconds < 0) {
        return globalObject.throwInvalidArguments("argument to sleepSync must not be negative, got {d}", .{milliseconds});
    }

    std.Thread.sleep(@as(u64, @intCast(milliseconds)) * std.time.ns_per_ms);
    return .js_undefined;
}

pub const gc = Bun__gc;
export fn Bun__gc(vm: *jsc.VirtualMachine, sync: bool) callconv(.c) usize {
    return vm.garbageCollect(sync);
}

pub fn shrink(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    globalObject.vm().shrinkFootprint();
    return .js_undefined;
}

fn doResolve(globalThis: *jsc.JSGlobalObject, arguments: []const JSValue) bun.JSError!jsc.JSValue {
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
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

    const specifier_str = try specifier.toBunString(globalThis);
    defer specifier_str.deref();
    const from_str = try from.toBunString(globalThis);
    defer from_str.deref();
    return doResolveWithArgs(
        globalThis,
        specifier_str,
        from_str,
        is_esm,
        false,
        false,
    );
}

fn doResolveWithArgs(ctx: *jsc.JSGlobalObject, specifier: bun.String, from: bun.String, is_esm: bool, comptime is_file_path: bool, is_user_require_resolve: bool) bun.JSError!jsc.JSValue {
    var errorable: ErrorableString = undefined;
    var query_string = ZigString.Empty;

    const specifier_decoded = if (specifier.hasPrefixComptime("file://"))
        bun.jsc.URL.pathFromFileURL(specifier)
    else
        specifier.dupeRef();
    defer specifier_decoded.deref();

    try VirtualMachine.resolveMaybeNeedsTrailingSlash(
        &errorable,
        ctx,
        specifier_decoded,
        from,
        &query_string,
        is_esm,
        is_file_path,
        is_user_require_resolve,
    );

    if (!errorable.success) {
        return ctx.throwValue(errorable.result.err.value);
    }

    if (query_string.len > 0) {
        var stack = std.heap.stackFallback(1024, ctx.allocator());
        const allocator = stack.get();
        var arraylist = std.array_list.Managed(u8).initCapacity(allocator, 1024) catch unreachable;
        defer arraylist.deinit();
        try arraylist.writer().print("{f}{f}", .{
            errorable.result.value,
            query_string,
        });

        return ZigString.initUTF8(arraylist.items).toJS(ctx);
    }

    return errorable.result.value.toJS(ctx);
}

pub fn resolveSync(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return try doResolve(globalObject, callframe.arguments());
}

pub fn resolve(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(3);
    const value = doResolve(globalObject, arguments.slice()) catch |e| {
        const err = globalObject.takeError(e);
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalObject, err);
    };
    return jsc.JSPromise.resolvedPromiseValue(globalObject, value);
}

export fn Bun__resolve(global: *JSGlobalObject, specifier: JSValue, source: JSValue, is_esm: bool) jsc.JSValue {
    const specifier_str = specifier.toBunString(global) catch return .zero;
    defer specifier_str.deref();

    const source_str = source.toBunString(global) catch return .zero;
    defer source_str.deref();

    const value = doResolveWithArgs(global, specifier_str, source_str, is_esm, true, false) catch {
        const err = global.tryTakeException().?;
        return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(global, err);
    };

    return jsc.JSPromise.resolvedPromiseValue(global, value);
}

export fn Bun__resolveSync(global: *JSGlobalObject, specifier: JSValue, source: JSValue, is_esm: bool, is_user_require_resolve: bool) jsc.JSValue {
    const specifier_str = specifier.toBunString(global) catch return .zero;
    defer specifier_str.deref();

    if (specifier_str.length() == 0) {
        return global.ERR(.INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", .{}).throw() catch .zero;
    }

    const source_str = source.toBunString(global) catch return .zero;
    defer source_str.deref();

    return jsc.toJSHostCall(global, @src(), doResolveWithArgs, .{ global, specifier_str, source_str, is_esm, true, is_user_require_resolve });
}

export fn Bun__resolveSyncWithPaths(
    global: *JSGlobalObject,
    specifier: JSValue,
    source: JSValue,
    is_esm: bool,
    is_user_require_resolve: bool,
    paths_ptr: ?[*]const bun.String,
    paths_len: usize,
) jsc.JSValue {
    const paths: []const bun.String = if (paths_len == 0) &.{} else paths_ptr.?[0..paths_len];

    const specifier_str = specifier.toBunString(global) catch return .zero;
    defer specifier_str.deref();

    if (specifier_str.length() == 0) {
        return global.ERR(.INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", .{}).throw() catch .zero;
    }

    const source_str = source.toBunString(global) catch return .zero;
    defer source_str.deref();

    const bun_vm = global.bunVM();
    bun.assert(bun_vm.transpiler.resolver.custom_dir_paths == null);
    bun_vm.transpiler.resolver.custom_dir_paths = paths;
    defer bun_vm.transpiler.resolver.custom_dir_paths = null;

    return jsc.toJSHostCall(global, @src(), doResolveWithArgs, .{ global, specifier_str, source_str, is_esm, true, is_user_require_resolve });
}

export fn Bun__resolveSyncWithStrings(global: *JSGlobalObject, specifier: *bun.String, source: *bun.String, is_esm: bool) jsc.JSValue {
    Output.scoped(.importMetaResolve, .visible)("source: {f}, specifier: {f}", .{ source.*, specifier.* });
    return jsc.toJSHostCall(global, @src(), doResolveWithArgs, .{ global, specifier.*, source.*, is_esm, true, false });
}

export fn Bun__resolveSyncWithSource(global: *JSGlobalObject, specifier: JSValue, source: *bun.String, is_esm: bool, is_user_require_resolve: bool) jsc.JSValue {
    const specifier_str = specifier.toBunString(global) catch return .zero;
    defer specifier_str.deref();
    if (specifier_str.length() == 0) {
        return global.ERR(.INVALID_ARG_VALUE, "The argument 'id' must be a non-empty string. Received ''", .{}).throw() catch .zero;
    }
    return jsc.toJSHostCall(global, @src(), doResolveWithArgs, .{ global, specifier_str, source.*, is_esm, true, is_user_require_resolve });
}

pub fn indexOfLine(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments_ = callframe.arguments_old(2);
    const arguments = arguments_.slice();
    if (arguments.len == 0) {
        return jsc.JSValue.jsNumberFromInt32(-1);
    }

    var buffer = arguments[0].asArrayBuffer(globalThis) orelse {
        return jsc.JSValue.jsNumberFromInt32(-1);
    };

    var offset: usize = 0;
    if (arguments.len > 1) {
        const offset_value = try arguments[1].coerce(i64, globalThis);
        offset = @intCast(@max(offset_value, 0));
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
                return jsc.JSValue.jsNumber(i);
            }

            current_offset = i + 1;
        } else {
            break;
        }
    }

    return jsc.JSValue.jsNumberFromInt32(-1);
}

pub const Crypto = @import("./crypto.zig");

pub fn nanoseconds(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const ns = globalThis.bunVM().origin_timer.read();
    return jsc.JSValue.jsNumberFromUint64(ns);
}

pub fn serve(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var config: jsc.API.ServerConfig = brk: {
        var args = jsc.CallFrame.ArgumentsSlice.init(globalObject.bunVM(), arguments);
        var config: jsc.API.ServerConfig = .{};

        try jsc.API.ServerConfig.fromJS(
            globalObject,
            &config,
            &args,
            .{
                .allow_bake_config = bun.FeatureFlags.bake(),
                .is_fetch_required = true,
                .has_user_routes = false,
            },
        );

        if (globalObject.hasException()) {
            config.deinit();
            return .zero;
        }

        break :brk config;
    };

    const vm = globalObject.bunVM();

    if (config.allow_hot) {
        if (vm.hotMap()) |hot| {
            if (config.id.len == 0) {
                config.id = config.computeID(globalObject.allocator());
            }

            if (hot.getEntry(config.id)) |entry| {
                switch (entry.tag()) {
                    @field(@TypeOf(entry.tag()), @typeName(jsc.API.HTTPServer)) => {
                        var server: *jsc.API.HTTPServer = entry.as(jsc.API.HTTPServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.js_value.tryGet() orelse .js_undefined;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(jsc.API.DebugHTTPServer)) => {
                        var server: *jsc.API.DebugHTTPServer = entry.as(jsc.API.DebugHTTPServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.js_value.tryGet() orelse .js_undefined;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(jsc.API.DebugHTTPSServer)) => {
                        var server: *jsc.API.DebugHTTPSServer = entry.as(jsc.API.DebugHTTPSServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.js_value.tryGet() orelse .js_undefined;
                    },
                    @field(@TypeOf(entry.tag()), @typeName(jsc.API.HTTPSServer)) => {
                        var server: *jsc.API.HTTPSServer = entry.as(jsc.API.HTTPSServer);
                        server.onReloadFromZig(&config, globalObject);
                        return server.js_value.tryGet() orelse .js_undefined;
                    },
                    else => {},
                }
            }
        }
    }

    switch (config.ssl_config != null) {
        inline else => |has_ssl_config| {
            switch (config.isDevelopment()) {
                inline else => |development| {
                    const ServerType = comptime switch (development) {
                        true => switch (has_ssl_config) {
                            true => jsc.API.DebugHTTPSServer,
                            false => jsc.API.DebugHTTPServer,
                        },
                        false => switch (has_ssl_config) {
                            true => jsc.API.HTTPSServer,
                            false => jsc.API.HTTPServer,
                        },
                    };

                    var server = try ServerType.init(&config, globalObject);
                    if (globalObject.hasException()) {
                        return .zero;
                    }
                    const route_list_object = server.listen();
                    if (globalObject.hasException()) {
                        return .zero;
                    }
                    const obj = server.toJS(globalObject);
                    if (route_list_object != .zero) {
                        ServerType.js.routeListSetCached(obj, globalObject, route_list_object);
                    }
                    server.js_value.setStrong(obj, globalObject);

                    if (config.allow_hot) {
                        if (globalObject.bunVM().hotMap()) |hot| {
                            hot.insert(config.id, server);
                        }
                    }

                    if (vm.debugger) |*debugger| {
                        debugger.http_server_agent.notifyServerStarted(
                            jsc.API.AnyServer.from(server),
                        );
                        debugger.http_server_agent.notifyServerRoutesUpdated(
                            jsc.API.AnyServer.from(server),
                        ) catch |err| bun.handleOom(err);
                    }

                    return obj;
                },
            }
        },
    }
}

pub export fn Bun__escapeHTML16(globalObject: *jsc.JSGlobalObject, input_value: JSValue, ptr: [*]const u16, len: usize) JSValue {
    assert(len > 0);
    const input_slice = ptr[0..len];
    const escaped = strings.escapeHTMLForUTF16Input(globalObject.bunVM().allocator, input_slice) catch {
        return globalObject.throwValue(ZigString.init("Out of memory").toErrorInstance(globalObject)) catch return .zero;
    };

    return switch (escaped) {
        .static => |val| ZigString.init(val).toJS(globalObject),
        .original => input_value,
        .allocated => |escaped_html| ZigString.from16(escaped_html.ptr, escaped_html.len).toExternalValue(globalObject),
    };
}

pub export fn Bun__escapeHTML8(globalObject: *jsc.JSGlobalObject, input_value: JSValue, ptr: [*]const u8, len: usize) JSValue {
    assert(len > 0);

    const input_slice = ptr[0..len];
    var stack_allocator = std.heap.stackFallback(256, globalObject.bunVM().allocator);
    const allocator = if (input_slice.len <= 32) stack_allocator.get() else stack_allocator.fallback_allocator;

    const escaped = strings.escapeHTMLForLatin1Input(allocator, input_slice) catch {
        return globalObject.throwValue(ZigString.init("Out of memory").toErrorInstance(globalObject)) catch return .zero;
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

pub fn allocUnsafe(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1);
    const size = arguments.ptr[0];
    if (!size.isUInt32AsAnyInt()) {
        return globalThis.throwInvalidArguments("Expected a positive number", .{});
    }
    return jsc.JSValue.createUninitializedUint8Array(globalThis, size.toUInt64NoTruncate());
}

pub fn mmapFile(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (comptime Environment.isWindows) {
        return globalThis.throwTODO("mmapFile is not supported on Windows");
    }

    const arguments_ = callframe.arguments_old(2);
    var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
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
        flags.TYPE = if ((try opts.getBooleanLoose(globalThis, "shared")) orelse true)
            .SHARED
        else
            .PRIVATE;

        if (@hasField(std.c.MAP, "SYNC")) {
            if ((try opts.getBooleanLoose(globalThis, "sync")) orelse false) {
                flags.TYPE = .SHARED_VALIDATE;
                flags.SYNC = true;
            }
        }

        if (try opts.get(globalThis, "size")) |value| {
            const size_value = try value.coerceToInt64(globalThis);
            if (size_value < 0) {
                return globalThis.throwInvalidArguments("size must be a non-negative integer", .{});
            }
            map_size = @intCast(size_value);
        }

        if (try opts.get(globalThis, "offset")) |value| {
            const offset_value = try value.coerceToInt64(globalThis);
            if (offset_value < 0) {
                return globalThis.throwInvalidArguments("offset must be a non-negative integer", .{});
            }
            offset = @intCast(offset_value);
            offset = std.mem.alignBackwardAnyAlign(usize, offset, std.heap.pageSize());
        }
    }

    const map = switch (bun.sys.mmapFile(buf_z, flags, map_size, offset)) {
        .result => |map| map,

        .err => |err| {
            return globalThis.throwValue(try err.toJS(globalThis));
        },
    };

    const S = struct {
        pub fn x(ptr: ?*anyopaque, size: ?*anyopaque) callconv(.c) void {
            _ = bun.sys.munmap(@as([*]align(std.heap.page_size_min) const u8, @ptrCast(@alignCast(ptr)))[0..@intFromPtr(size)]);
        }
    };
    return bun.jsc.array_buffer.makeTypedArrayWithBytesNoCopy(globalThis, .TypeUint8, map.ptr, map.len, S.x, @ptrFromInt(map.len));
}

pub fn getTranspilerConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.API.JSTranspiler.js.getConstructor(globalThis);
}

pub fn getFileSystemRouter(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.API.FileSystemRouter.js.getConstructor(globalThis);
}

pub fn getHashObject(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return HashObject.create(globalThis);
}

pub fn getJSONCObject(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return JSONCObject.create(globalThis);
}
pub fn getTOMLObject(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return TOMLObject.create(globalThis);
}

pub fn getJSON5Object(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return JSON5Object.create(globalThis);
}

pub fn getYAMLObject(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return YAMLObject.create(globalThis);
}

pub fn getArchiveConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.API.Archive.js.getConstructor(globalThis);
}

pub fn getGlobConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.API.Glob.js.getConstructor(globalThis);
}

pub fn getS3ClientConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.WebCore.S3Client.js.getConstructor(globalThis);
}

pub fn getS3DefaultClient(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return globalThis.bunVM().rareData().s3DefaultClient(globalThis);
}

pub fn getTLSDefaultCiphers(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return globalThis.bunVM().rareData().tlsDefaultCiphers();
}

pub fn setTLSDefaultCiphers(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject, ciphers: jsc.JSValue) jsc.JSValue {
    globalThis.bunVM().rareData().setTLSDefaultCiphers(ciphers);
    return .js_undefined;
}

pub fn getValkeyDefaultClient(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    const SubscriptionCtx = @import("../../valkey/js_valkey.zig").SubscriptionCtx;

    var valkey = jsc.API.Valkey.createNoJsNoPubsub(globalThis, &.{.js_undefined}) catch |err| {
        if (err != error.JSError) {
            _ = globalThis.throwError(err, "Failed to create Redis client") catch {};
            return .zero;
        }
        return .zero;
    };

    const as_js = valkey.toJS(globalThis);

    valkey.this_value = jsc.JSRef.initWeak(as_js);
    valkey._subscription_ctx = SubscriptionCtx.init(valkey) catch |err| {
        if (err != error.JSError) {
            _ = globalThis.throwError(err, "Failed to create Redis client") catch {};
            return .zero;
        }
        return .zero;
    };

    return as_js;
}

pub fn getValkeyClientConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return jsc.API.Valkey.js.getConstructor(globalThis);
}

pub fn getTerminalConstructor(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return api.Terminal.js.getConstructor(globalThis);
}

pub fn getEmbeddedFiles(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) bun.JSError!jsc.JSValue {
    const vm = globalThis.bunVM();
    const graph = vm.standalone_module_graph orelse return try jsc.JSValue.createEmptyArray(globalThis, 0);

    const unsorted_files = graph.files.values();
    var sort_indices = bun.handleOom(std.array_list.Managed(u32).initCapacity(bun.default_allocator, unsorted_files.len));
    defer sort_indices.deinit();
    for (0..unsorted_files.len) |index| {
        // Some % of people using `bun build --compile` want to obscure the source code
        // We don't really do that right now, but exposing the output source
        // code here as an easily accessible Blob is even worse for them.
        // So let's omit any source code files from the list.
        if (!unsorted_files[index].appearsInEmbeddedFilesArray()) continue;
        sort_indices.appendAssumeCapacity(@intCast(index));
    }

    var i: u32 = 0;
    var array = try jsc.JSValue.createEmptyArray(globalThis, sort_indices.items.len);
    std.mem.sort(u32, sort_indices.items, unsorted_files, bun.StandaloneModuleGraph.File.lessThanByIndex);
    for (sort_indices.items) |index| {
        const file = &unsorted_files[index];
        // We call .dupe() on this to ensure that we don't return a blob that might get freed later.
        const input_blob = file.blob(globalThis);
        const blob = jsc.WebCore.Blob.new(input_blob.dupeWithContentType(true));
        blob.name = input_blob.name.dupeRef();
        try array.putIndex(globalThis, i, blob.toJS(globalThis));
        i += 1;
    }

    return array;
}

pub fn getSemver(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return SemverObject.create(globalThis);
}

pub fn getUnsafe(globalThis: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return UnsafeObject.create(globalThis);
}

pub fn stringWidth(str: bun.String, opts: gen.StringWidthOptions) usize {
    if (str.length() == 0)
        return 0;

    if (opts.count_ansi_escape_codes)
        return str.visibleWidth(!opts.ambiguous_is_narrow);

    return str.visibleWidthExcludeANSIColors(!opts.ambiguous_is_narrow);
}

/// EnvironmentVariables is runtime defined.
/// Also, you can't iterate over process.env normally since it only exists at build-time otherwise
pub fn getCSRFObject(globalObject: *jsc.JSGlobalObject, _: *jsc.JSObject) jsc.JSValue {
    return CSRFObject.create(globalObject);
}

const CSRFObject = struct {
    pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        const object = JSValue.createEmptyObject(globalThis, 2);

        object.put(
            globalThis,
            ZigString.static("generate"),
            jsc.JSFunction.create(globalThis, "generate", @import("../../csrf.zig").csrf__generate, 1, .{}),
        );

        object.put(
            globalThis,
            ZigString.static("verify"),
            jsc.JSFunction.create(globalThis, "verify", @import("../../csrf.zig").csrf__verify, 1, .{}),
        );

        return object;
    }
};

// This is aliased to Bun.env
pub const EnvironmentVariables = struct {
    pub export fn Bun__getEnvCount(globalObject: *jsc.JSGlobalObject, ptr: *[*][]const u8) usize {
        const bunVM = globalObject.bunVM();
        ptr.* = bunVM.transpiler.env.map.map.keys().ptr;
        return bunVM.transpiler.env.map.map.unmanaged.entries.len;
    }

    pub export fn Bun__getEnvKey(ptr: [*][]const u8, i: usize, data_ptr: *[*]const u8) usize {
        const item = ptr[i];
        data_ptr.* = item.ptr;
        return item.len;
    }

    pub export fn Bun__getEnvValue(globalObject: *jsc.JSGlobalObject, name: *ZigString, value: *ZigString) bool {
        if (getEnvValue(globalObject, name.*)) |val| {
            value.* = val;
            return true;
        }

        return false;
    }

    pub fn getEnvNames(globalObject: *jsc.JSGlobalObject, names: []ZigString) usize {
        var vm = globalObject.bunVM();
        const keys = vm.transpiler.env.map.map.keys();
        const len = @min(names.len, keys.len);
        for (keys[0..len], names[0..len]) |key, *name| {
            name.* = ZigString.initUTF8(key);
        }
        return len;
    }

    pub fn getEnvValue(globalObject: *jsc.JSGlobalObject, name: ZigString) ?ZigString {
        var vm = globalObject.bunVM();
        var sliced = name.toSlice(vm.allocator);
        defer sliced.deinit();
        const value = vm.transpiler.env.get(sliced.slice()) orelse return null;
        return ZigString.initUTF8(value);
    }
};

export fn Bun__reportError(globalObject: *JSGlobalObject, err: jsc.JSValue) void {
    _ = jsc.VirtualMachine.get().uncaughtException(globalObject, err, false);
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
        bun.allocators.freeWithoutSize(ctx);
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
    inline fn getOptions(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!struct { jsc.Node.StringOrBuffer, ?JSValue } {
        const arguments = callframe.arguments_old(2).slice();
        const buffer_value: JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;
        const options_val: ?JSValue =
            if (arguments.len > 1 and arguments[1].isObject())
                arguments[1]
            else if (arguments.len > 1 and !arguments[1].isUndefined()) {
                return globalThis.throwInvalidArguments("Expected options to be an object", .{});
            } else null;

        if (try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, buffer_value)) |buffer| {
            return .{ buffer, options_val };
        }

        return globalThis.throwInvalidArguments("Expected buffer to be a string or buffer", .{});
    }

    pub fn gzipSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gzipOrDeflateSync(globalThis, buffer, options_val, true);
    }

    pub fn inflateSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gunzipOrInflateSync(globalThis, buffer, options_val, false);
    }

    pub fn deflateSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gzipOrDeflateSync(globalThis, buffer, options_val, false);
    }

    pub fn gunzipSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();
        return gunzipOrInflateSync(globalThis, buffer, options_val, true);
    }

    pub fn gunzipOrInflateSync(globalThis: *JSGlobalObject, buffer: jsc.Node.StringOrBuffer, options_val_: ?JSValue, is_gzip: bool) bun.JSError!JSValue {
        var opts = zlib.Options{
            .gzip = is_gzip,
            .windowBits = if (is_gzip) 31 else -15,
        };

        var library: Library = .zlib;
        if (options_val_) |options_val| {
            if (try options_val.get(globalThis, "windowBits")) |window| {
                opts.windowBits = try window.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.get(globalThis, "level")) |level| {
                opts.level = try level.coerce(i32, globalThis);
            }

            if (try options_val.get(globalThis, "memLevel")) |memLevel| {
                opts.memLevel = try memLevel.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.get(globalThis, "strategy")) |strategy| {
                opts.strategy = try strategy.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.getTruthy(globalThis, "library")) |library_value| {
                if (!library_value.isString()) {
                    return globalThis.throwInvalidArguments("Expected library to be a string", .{});
                }

                library = try Library.map.fromJS(globalThis, library_value) orelse {
                    return globalThis.throwInvalidArguments("Expected library to be one of 'zlib' or 'libdeflate'", .{});
                };
            }
        }

        if (globalThis.hasException()) return .zero;

        const compressed = buffer.slice();
        const allocator = jsc.VirtualMachine.get().allocator;

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

                reader.readAll(true) catch {
                    defer reader.deinit();
                    return globalThis.throwValue(ZigString.init(reader.errorMessage() orelse "Zlib returned an error").toErrorInstance(globalThis));
                };
                reader.list = .{ .items = reader.list.items };
                reader.list.capacity = reader.list.items.len;
                reader.list_ptr = &reader.list;

                var array_buffer = jsc.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator);
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

                var array_buffer = jsc.ArrayBuffer.fromBytes(list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, list.items.ptr, global_deallocator);
            },
        }
    }

    pub fn gzipOrDeflateSync(
        globalThis: *JSGlobalObject,
        buffer: jsc.Node.StringOrBuffer,
        options_val_: ?JSValue,
        is_gzip: bool,
    ) bun.JSError!JSValue {
        var level: ?i32 = null;
        var library: Library = .zlib;
        var windowBits: i32 = 0;

        if (options_val_) |options_val| {
            if (try options_val.get(globalThis, "windowBits")) |window| {
                windowBits = try window.coerce(i32, globalThis);
                library = .zlib;
            }

            if (try options_val.getTruthy(globalThis, "library")) |library_value| {
                if (!library_value.isString()) {
                    return globalThis.throwInvalidArguments("Expected library to be a string", .{});
                }

                library = try Library.map.fromJS(globalThis, library_value) orelse {
                    return globalThis.throwInvalidArguments("Expected library to be one of 'zlib' or 'libdeflate'", .{});
                };
            }

            if (try options_val.get(globalThis, "level")) |level_value| {
                level = try level_value.coerce(i32, globalThis);
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
                reader.list = .{ .items = bun.handleOom(reader.list.toOwnedSlice(allocator)) };
                reader.list.capacity = reader.list.items.len;
                reader.list_ptr = &reader.list;

                var array_buffer = jsc.ArrayBuffer.fromBytes(reader.list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, reader, reader_deallocator);
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

                var array_buffer = jsc.ArrayBuffer.fromBytes(list.items, .Uint8Array);
                return array_buffer.toJSWithContext(globalThis, list.items.ptr, global_deallocator);
            },
        }
    }
};

pub const JSZstd = struct {
    export fn deallocator(_: ?*anyopaque, ctx: ?*anyopaque) void {
        bun.allocators.freeWithoutSize(ctx);
    }

    inline fn getOptions(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!struct { jsc.Node.StringOrBuffer, ?JSValue } {
        const arguments = callframe.arguments();
        const buffer_value: JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;
        const options_val: ?JSValue =
            if (arguments.len > 1 and arguments[1].isObject())
                arguments[1]
            else if (arguments.len > 1 and !arguments[1].isUndefined()) {
                return globalThis.throwInvalidArguments("Expected options to be an object", .{});
            } else null;

        if (try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, buffer_value)) |buffer| {
            return .{ buffer, options_val };
        }

        return globalThis.throwInvalidArguments("Expected buffer to be a string or buffer", .{});
    }

    fn getLevel(globalThis: *JSGlobalObject, options_val: ?JSValue) bun.JSError!i32 {
        if (options_val) |option_obj| {
            if (try option_obj.get(globalThis, "level")) |level_val| {
                const value = try level_val.coerce(i32, globalThis);
                if (globalThis.hasException()) return error.JSError;

                if (value < 1 or value > 22) {
                    return globalThis.throwInvalidArguments("Compression level must be between 1 and 22", .{});
                }

                return value;
            }
        }

        return 3;
    }

    inline fn getOptionsAsync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!struct { jsc.Node.StringOrBuffer, ?JSValue, i32 } {
        const arguments = callframe.arguments();
        const buffer_value: JSValue = if (arguments.len > 0) arguments[0] else .js_undefined;
        const options_val: ?JSValue =
            if (arguments.len > 1 and arguments[1].isObject())
                arguments[1]
            else if (arguments.len > 1 and !arguments[1].isUndefined()) {
                return globalThis.throwInvalidArguments("Expected options to be an object", .{});
            } else null;

        const level = try getLevel(globalThis, options_val);

        const allow_string_object = true;
        if (try jsc.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, buffer_value, true, allow_string_object)) |buffer| {
            return .{ buffer, options_val, level };
        }

        return globalThis.throwInvalidArguments("Expected buffer to be a string or buffer", .{});
    }

    pub fn compressSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, const options_val = try getOptions(globalThis, callframe);
        defer buffer.deinit();

        const level = try getLevel(globalThis, options_val);

        const input = buffer.slice();
        const allocator = bun.default_allocator;

        // Calculate max compressed size
        const max_size = bun.zstd.compressBound(input.len);
        var output = try allocator.alloc(u8, max_size);

        // Perform compression with context
        const compressed_size = switch (bun.zstd.compress(output, input, level)) {
            .success => |size| size,
            .err => |err| {
                allocator.free(output);
                return globalThis.ERR(.ZSTD, "{s}", .{err}).throw();
            },
        };

        // Resize to actual compressed size
        if (compressed_size < output.len) {
            output = try allocator.realloc(output, compressed_size);
        }

        return jsc.JSValue.createBuffer(globalThis, output);
    }

    pub fn decompressSync(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, _ = try getOptions(globalThis, callframe);
        defer buffer.deinit();

        const input = buffer.slice();
        const allocator = bun.default_allocator;

        const output = bun.zstd.decompressAlloc(allocator, input) catch |err| {
            return globalThis.ERR(.ZSTD, "Decompression failed: {s}", .{@errorName(err)}).throw();
        };

        return jsc.JSValue.createBuffer(globalThis, output);
    }

    // --- Async versions ---

    pub const ZstdJob = struct {
        buffer: jsc.Node.StringOrBuffer = jsc.Node.StringOrBuffer.empty,
        is_compress: bool = true,
        level: i32 = 3,
        task: jsc.WorkPoolTask = .{ .callback = &runTask },
        promise: jsc.JSPromise.Strong = .{},
        vm: *jsc.VirtualMachine,
        output: []u8 = &[_]u8{},
        error_message: ?[]const u8 = null,
        any_task: jsc.AnyTask = undefined,
        poll: Async.KeepAlive = .{},

        pub const new = bun.TrivialNew(@This());

        pub fn runTask(task: *jsc.WorkPoolTask) void {
            const job: *ZstdJob = @fieldParentPtr("task", task);
            defer job.vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(job.any_task.task()));

            const input = job.buffer.slice();
            const allocator = bun.default_allocator;

            if (job.is_compress) {
                // Compression path
                // Calculate max compressed size
                const max_size = bun.zstd.compressBound(input.len);
                job.output = allocator.alloc(u8, max_size) catch {
                    job.error_message = "Out of memory";
                    return;
                };

                // Perform compression
                job.output = switch (bun.zstd.compress(job.output, input, job.level)) {
                    .success => |size| blk: {
                        // Resize to actual compressed size
                        if (size < job.output.len) {
                            break :blk allocator.realloc(job.output, size) catch {
                                job.error_message = "Out of memory";
                                return;
                            };
                        }
                        break :blk job.output;
                    },
                    .err => |err| {
                        allocator.free(job.output);
                        job.output = &[_]u8{};
                        job.error_message = err;
                        return;
                    },
                };
            } else {
                // Decompression path
                job.output = bun.zstd.decompressAlloc(allocator, input) catch {
                    job.error_message = "Decompression failed";
                    return;
                };
            }
        }

        pub fn runFromJS(this: *ZstdJob) bun.JSTerminated!void {
            defer this.deinit();

            if (this.vm.isShuttingDown()) {
                return;
            }

            const globalThis = this.vm.global;
            const promise = this.promise.swap();

            if (this.error_message) |err_msg| {
                try promise.reject(globalThis, globalThis.ERR(.ZSTD, "{s}", .{err_msg}).toJS());
                return;
            }

            const output_slice = this.output;
            const buffer_value = jsc.JSValue.createBuffer(globalThis, output_slice);
            this.output = &[_]u8{};
            try promise.resolve(globalThis, buffer_value);
        }

        pub fn deinit(this: *ZstdJob) void {
            this.poll.unref(this.vm);
            this.buffer.deinitAndUnprotect();
            this.promise.deinit();
            bun.default_allocator.free(this.output);
            bun.destroy(this);
        }

        pub fn create(vm: *jsc.VirtualMachine, globalThis: *jsc.JSGlobalObject, buffer: jsc.Node.StringOrBuffer, is_compress: bool, level: i32) *ZstdJob {
            var job = ZstdJob.new(.{
                .buffer = buffer,
                .is_compress = is_compress,
                .level = level,
                .vm = vm,
                .any_task = undefined,
            });

            job.promise = jsc.JSPromise.Strong.init(globalThis);
            job.any_task = jsc.AnyTask.New(@This(), &runFromJS).init(job);
            job.poll.ref(vm);
            jsc.WorkPool.schedule(&job.task);

            return job;
        }
    };

    pub fn compress(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, _, const level = try getOptionsAsync(globalThis, callframe);

        const vm = globalThis.bunVM();
        var job = ZstdJob.create(vm, globalThis, buffer, true, level);
        return job.promise.value();
    }

    pub fn decompress(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const buffer, _, _ = try getOptionsAsync(globalThis, callframe);

        const vm = globalThis.bunVM();
        var job = ZstdJob.create(vm, globalThis, buffer, false, 0); // level is ignored for decompression
        return job.promise.value();
    }
};

// const InternalTestingAPIs = struct {
//     pub fn BunInternalFunction__syntaxHighlighter(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
//         const args = callframe.arguments_old(1);
//         if (args.len < 1) {
//             globalThis.throwNotEnoughArguments("code", 1, 0);
//         }

//         const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
//         defer code.deinit();
//         var buffer = MutableString.initEmpty(bun.default_allocator);
//         defer buffer.deinit();
//         var writer = buffer.bufferedWriter();
//         const formatter = bun.fmt.fmtJavaScript(code.slice(), .{
//             .enable_colors = true,
//             .check_for_unhighlighted_write = false,
//         });
//         writer.writer().print("{f}", .{formatter}) catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };

//         writer.flush() catch |err| {
//             return globalThis.throwError(err, "Error formatting code");
//         };

//         return bun.String.createUTF8ForJS(globalThis, buffer.list.items);
//     }
// };

comptime {
    _ = Crypto.JSPasswordObject.JSPasswordObject__create;
    _ = @import("../../btjs.zig").dumpBtjsTrace;
    BunObject.exportAll();
}

const string = []const u8;

// LazyProperty initializers for stdin/stderr/stdout
pub fn createBunStdin(globalThis: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdin();
    store.ref();
    var blob = jsc.WebCore.Blob.new(
        jsc.WebCore.Blob.initWithStore(store, globalThis),
    );
    return blob.toJS(globalThis);
}

pub fn createBunStderr(globalThis: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stderr();
    store.ref();
    var blob = jsc.WebCore.Blob.new(
        jsc.WebCore.Blob.initWithStore(store, globalThis),
    );
    return blob.toJS(globalThis);
}

pub fn createBunStdout(globalThis: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    var rare_data = globalThis.bunVM().rareData();
    var store = rare_data.stdout();
    store.ref();
    var blob = jsc.WebCore.Blob.new(
        jsc.WebCore.Blob.initWithStore(store, globalThis),
    );
    return blob.toJS(globalThis);
}

const Braces = @import("../../shell/braces.zig");
const Which = @import("../../which.zig");
const options = @import("../../options.zig");
const std = @import("std");
const zlib = @import("../../zlib.zig");
const Editor = @import("../../open.zig").Editor;
const URL = @import("../../url.zig").URL;
const conv = std.builtin.CallingConvention.Unspecified;

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const MutableString = bun.MutableString;
const Output = bun.Output;
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const SemverObject = bun.Semver.SemverObject;
const gen = bun.gen.BunObject;

const api = bun.api;
const FFIObject = bun.api.FFIObject;
const HashObject = bun.api.HashObject;
const JSON5Object = bun.api.JSON5Object;
const JSONCObject = bun.api.JSONCObject;
const TOMLObject = bun.api.TOMLObject;
const UnsafeObject = bun.api.UnsafeObject;
const YAMLObject = bun.api.YAMLObject;
const node = bun.api.node;

const jsc = bun.jsc;
const ConsoleObject = bun.jsc.ConsoleObject;
const ErrorableString = jsc.ErrorableString;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSPromise = bun.jsc.JSPromise;
const JSValue = bun.jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const WebCore = bun.jsc.WebCore;
const ZigString = bun.jsc.ZigString;
const host_fn = bun.jsc.host_fn;

const JSBundler = bun.jsc.API.JSBundler;
const Transpiler = bun.jsc.API.JSTranspiler;
