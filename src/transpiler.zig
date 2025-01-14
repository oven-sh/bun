const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;
const C = bun.C;
const std = @import("std");
const lex = bun.js_lexer;
const logger = bun.logger;
pub const options = @import("options.zig");
const js_parser = bun.js_parser;
const JSON = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("linker.zig");
const Ref = @import("ast/base.zig").Ref;
const Define = @import("defines.zig").Define;
const DebugOptions = @import("./cli.zig").Command.DebugOptions;
const ThreadPoolLib = @import("./thread_pool.zig");

const Fs = @import("fs.zig");
const schema = @import("api/schema.zig");
const Api = schema.Api;
const _resolver = @import("./resolver/resolver.zig");
const sync = @import("sync.zig");
const ImportRecord = @import("./import_record.zig").ImportRecord;
const allocators = @import("./allocators.zig");
const MimeType = @import("./http/mime_type.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const runtime = @import("./runtime.zig");
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
const DebugLogs = _resolver.DebugLogs;
const Router = @import("./router.zig");
const isPackagePath = _resolver.isPackagePath;
const Css = @import("css_scanner.zig");
const DotEnv = @import("./env_loader.zig");
const Lock = bun.Mutex;
const NodeFallbackModules = @import("./node_fallbacks.zig");
const CacheEntry = @import("./cache.zig").FsCacheEntry;
const Analytics = @import("./analytics/analytics_thread.zig");
const URL = @import("./url.zig").URL;
const Linker = linker.Linker;
const Resolver = _resolver.Resolver;
const TOML = @import("./toml/toml_parser.zig").TOML;
const JSC = bun.JSC;
const PackageManager = @import("./install/install.zig").PackageManager;
const DataURL = @import("./resolver/data_url.zig").DataURL;

pub fn MacroJSValueType_() type {
    if (comptime JSC.is_bindgen) {
        return struct {
            pub const zero = @This(){};
        };
    }
    return JSC.JSValue;
}
pub const MacroJSValueType = MacroJSValueType_();
const default_macro_js_value = if (JSC.is_bindgen) MacroJSValueType{} else JSC.JSValue.zero;

const EntryPoints = @import("./bundler/entry_points.zig");
const SystemTimer = @import("./system_timer.zig").Timer;
pub usingnamespace EntryPoints;
pub const ParseResult = struct {
    source: logger.Source,
    loader: options.Loader,
    ast: js_ast.Ast,
    already_bundled: AlreadyBundled = .none,
    input_fd: ?StoredFileDescriptorType = null,
    empty: bool = false,
    pending_imports: _resolver.PendingResolution.List = .{},

    runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,

    pub const AlreadyBundled = union(enum) {
        none: void,
        source_code: void,
        source_code_cjs: void,
        bytecode: []u8,
        bytecode_cjs: []u8,

        pub fn bytecodeSlice(this: AlreadyBundled) []u8 {
            return switch (this) {
                inline .bytecode, .bytecode_cjs => |slice| slice,
                else => &.{},
            };
        }

        pub fn isBytecode(this: AlreadyBundled) bool {
            return this == .bytecode or this == .bytecode_cjs;
        }

        pub fn isCommonJS(this: AlreadyBundled) bool {
            return this == .source_code_cjs or this == .bytecode_cjs;
        }
    };

    pub fn isPendingImport(this: *const ParseResult, id: u32) bool {
        const import_record_ids = this.pending_imports.items(.import_record_id);

        return std.mem.indexOfScalar(u32, import_record_ids, id) != null;
    }

    /// **DO NOT CALL THIS UNDER NORMAL CIRCUMSTANCES**
    /// Normally, we allocate each AST in an arena and free all at once
    /// So this function only should be used when we globally allocate an AST
    pub fn deinit(this: *ParseResult) void {
        _resolver.PendingResolution.deinitListItems(this.pending_imports, bun.default_allocator);
        this.pending_imports.deinit(bun.default_allocator);
        this.ast.deinit();
        bun.default_allocator.free(@constCast(this.source.contents));
    }
};

const cache_files = false;

pub const PluginRunner = struct {
    global_object: *JSC.JSGlobalObject,
    allocator: std.mem.Allocator,

    pub fn extractNamespace(specifier: string) string {
        const colon = strings.indexOfChar(specifier, ':') orelse return "";
        if (Environment.isWindows and
            colon == 1 and
            specifier.len > 3 and
            bun.path.isSepAny(specifier[2]) and
            ((specifier[0] > 'a' and specifier[0] < 'z') or (specifier[0] > 'A' and specifier[0] < 'Z')))
            return "";
        return specifier[0..colon];
    }

    pub fn couldBePlugin(specifier: string) bool {
        if (strings.lastIndexOfChar(specifier, '.')) |last_dor| {
            const ext = specifier[last_dor + 1 ..];
            // '.' followed by either a letter or a non-ascii character
            // maybe there are non-ascii file extensions?
            // we mostly want to cheaply rule out "../" and ".." and "./"
            if (ext.len > 0 and ((ext[0] >= 'a' and ext[0] <= 'z') or (ext[0] >= 'A' and ext[0] <= 'Z') or ext[0] > 127))
                return true;
        }
        return (!std.fs.path.isAbsolute(specifier) and strings.containsChar(specifier, ':'));
    }

    pub fn onResolve(
        this: *PluginRunner,
        specifier: []const u8,
        importer: []const u8,
        log: *logger.Log,
        loc: logger.Loc,
        target: JSC.JSGlobalObject.BunPluginTarget,
    ) bun.JSError!?Fs.Path {
        var global = this.global_object;
        const namespace_slice = extractNamespace(specifier);
        const namespace = if (namespace_slice.len > 0 and !strings.eqlComptime(namespace_slice, "file"))
            bun.String.init(namespace_slice)
        else
            bun.String.empty;
        const on_resolve_plugin = global.runOnResolvePlugins(
            namespace,
            bun.String.init(specifier).substring(if (namespace.length() > 0) namespace.length() + 1 else 0),
            bun.String.init(importer),
            target,
        ) orelse return null;
        const path_value = try on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            log.addError(null, loc, "Expected \"path\" to be a string") catch unreachable;
            return null;
        }

        const file_path = path_value.toBunString(global);
        defer file_path.deref();

        if (file_path.length() == 0) {
            log.addError(
                null,
                loc,
                "Expected \"path\" to be a non-empty string in onResolve plugin",
            ) catch unreachable;
            return null;
        } else if
        // TODO: validate this better
        (file_path.eqlComptime(".") or
            file_path.eqlComptime("..") or
            file_path.eqlComptime("...") or
            file_path.eqlComptime(" "))
        {
            log.addError(
                null,
                loc,
                "Invalid file path from onResolve plugin",
            ) catch unreachable;
            return null;
        }
        var static_namespace = true;
        const user_namespace: bun.String = brk: {
            if (try on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    log.addError(null, loc, "Expected \"namespace\" to be a string") catch unreachable;
                    return null;
                }

                const namespace_str = namespace_value.toBunString(global);
                if (namespace_str.length() == 0) {
                    namespace_str.deref();
                    break :brk bun.String.init("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    namespace_str.deref();
                    break :brk bun.String.init("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    namespace_str.deref();
                    break :brk bun.String.init("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    namespace_str.deref();
                    break :brk bun.String.init("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk bun.String.init("file");
        };
        defer user_namespace.deref();

        if (static_namespace) {
            return Fs.Path.initWithNamespace(
                std.fmt.allocPrint(this.allocator, "{any}", .{file_path}) catch unreachable,
                user_namespace.byteSlice(),
            );
        } else {
            return Fs.Path.initWithNamespace(
                std.fmt.allocPrint(this.allocator, "{any}", .{file_path}) catch unreachable,
                std.fmt.allocPrint(this.allocator, "{any}", .{user_namespace}) catch unreachable,
            );
        }
    }

    pub fn onResolveJSC(this: *const PluginRunner, namespace: bun.String, specifier: bun.String, importer: bun.String, target: JSC.JSGlobalObject.BunPluginTarget) bun.JSError!?JSC.ErrorableString {
        var global = this.global_object;
        const on_resolve_plugin = global.runOnResolvePlugins(
            if (namespace.length() > 0 and !namespace.eqlComptime("file"))
                namespace
            else
                bun.String.static(""),
            specifier,
            importer,
            target,
        ) orelse return null;
        const path_value = try on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            return JSC.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("Expected \"path\" to be a string in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        }

        const file_path = path_value.toBunString(global);

        if (file_path.length() == 0) {
            return JSC.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("Expected \"path\" to be a non-empty string in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        } else if
        // TODO: validate this better
        (file_path.eqlComptime(".") or
            file_path.eqlComptime("..") or
            file_path.eqlComptime("...") or
            file_path.eqlComptime(" "))
        {
            return JSC.ErrorableString.err(
                error.JSErrorObject,
                bun.String.static("\"path\" is invalid in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        }
        var static_namespace = true;
        const user_namespace: bun.String = brk: {
            if (try on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    return JSC.ErrorableString.err(
                        error.JSErrorObject,
                        bun.String.static("Expected \"namespace\" to be a string").toErrorInstance(this.global_object).asVoid(),
                    );
                }

                const namespace_str = namespace_value.toBunString(global);
                if (namespace_str.length() == 0) {
                    break :brk bun.String.static("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    defer namespace_str.deref();
                    break :brk bun.String.static("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk bun.String.static("file");
        };
        defer user_namespace.deref();

        // Our super slow way of cloning the string into memory owned by JSC
        const combined_string = std.fmt.allocPrint(
            this.allocator,
            "{any}:{any}",
            .{ user_namespace, file_path },
        ) catch unreachable;
        var out_ = bun.String.init(combined_string);
        const out = out_.toJS(this.global_object).toBunString(this.global_object);
        this.allocator.free(combined_string);
        return JSC.ErrorableString.ok(out);
    }
};

/// This structure was the JavaScript transpiler before bundle_v2 was written. It now
/// acts mostly as a configuration object, but it also contains stateful logic around
/// logging errors (.log) and module resolution (.resolve_queue)
///
/// This object is not exclusive to bundle_v2/Bun.build, one of these is stored
/// on every VM so that the options can be used for transpilation.
pub const Transpiler = struct {
    options: options.BundleOptions,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    result: options.TransformResult,
    resolver: Resolver,
    fs: *Fs.FileSystem,
    output_files: std.ArrayList(options.OutputFile),
    resolve_results: *ResolveResults,
    resolve_queue: ResolveQueue,
    elapsed: u64 = 0,
    needs_runtime: bool = false,
    router: ?Router = null,
    source_map: options.SourceMapOption = .none,

    linker: Linker,
    timer: SystemTimer,
    env: *DotEnv.Loader,

    macro_context: ?js_ast.Macro.MacroContext = null,

    pub const isCacheEnabled = cache_files;

    pub fn clone(this: *Transpiler, allocator: std.mem.Allocator, to: *Transpiler) !void {
        to.* = this.*;
        to.setAllocator(allocator);
        to.log = try allocator.create(logger.Log);
        to.log.* = logger.Log.init(allocator);
        to.setLog(to.log);
        to.macro_context = null;
        to.linker.resolver = &to.resolver;
    }

    pub inline fn getPackageManager(this: *Transpiler) *PackageManager {
        return this.resolver.getPackageManager();
    }

    pub fn setLog(this: *Transpiler, log: *logger.Log) void {
        this.log = log;
        this.linker.log = log;
        this.resolver.log = log;
    }

    pub fn setAllocator(this: *Transpiler, allocator: std.mem.Allocator) void {
        this.allocator = allocator;
        this.linker.allocator = allocator;
        this.resolver.allocator = allocator;
    }

    fn _resolveEntryPoint(transpiler: *Transpiler, entry_point: string) !_resolver.Result {
        return transpiler.resolver.resolveWithFramework(transpiler.fs.top_level_dir, entry_point, .entry_point) catch |err| {
            // Relative entry points that were not resolved to a node_modules package are
            // interpreted as relative to the current working directory.
            if (!std.fs.path.isAbsolute(entry_point) and
                !(strings.hasPrefix(entry_point, "./") or strings.hasPrefix(entry_point, ".\\")))
            {
                brk: {
                    return transpiler.resolver.resolve(
                        transpiler.fs.top_level_dir,
                        try strings.append(transpiler.allocator, "./", entry_point),
                        .entry_point,
                    ) catch {
                        // return the original error
                        break :brk;
                    };
                }
            }
            return err;
        };
    }

    pub fn resolveEntryPoint(transpiler: *Transpiler, entry_point: string) !_resolver.Result {
        return _resolveEntryPoint(transpiler, entry_point) catch |err| {
            var cache_bust_buf: bun.PathBuffer = undefined;

            // Bust directory cache and try again
            const buster_name = name: {
                if (std.fs.path.isAbsolute(entry_point)) {
                    if (std.fs.path.dirname(entry_point)) |dir| {
                        // Normalized with trailing slash
                        break :name bun.strings.normalizeSlashesOnly(&cache_bust_buf, dir, std.fs.path.sep);
                    }
                }

                var parts = [_]string{
                    entry_point,
                    bun.pathLiteral(".."),
                };

                break :name bun.path.joinAbsStringBufZ(
                    transpiler.fs.top_level_dir,
                    &cache_bust_buf,
                    &parts,
                    .auto,
                );
            };

            // Only re-query if we previously had something cached.
            if (transpiler.resolver.bustDirCache(bun.strings.withoutTrailingSlashWindowsPath(buster_name))) {
                if (_resolveEntryPoint(transpiler, entry_point)) |result|
                    return result
                else |_| {
                    // ignore this error, we will print the original error
                }
            }

            transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{s} resolving \"{s}\" (entry point)", .{ @errorName(err), entry_point }) catch bun.outOfMemory();
            return err;
        };
    }

    pub fn init(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
        env_loader_: ?*DotEnv.Loader,
    ) !Transpiler {
        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();

        const fs = try Fs.FileSystem.init(opts.absolute_working_dir);
        const bundle_options = try options.BundleOptions.fromApi(
            allocator,
            fs,
            log,
            opts,
        );

        var env_loader: *DotEnv.Loader = env_loader_ orelse DotEnv.instance orelse brk: {
            const map = try allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(allocator);

            const loader = try allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, allocator);
            break :brk loader;
        };

        if (DotEnv.instance == null) {
            DotEnv.instance = env_loader;
        }

        // hide elapsed time when loglevel is warn or error
        env_loader.quiet = !log.level.atLeast(.info);

        // var pool = try allocator.create(ThreadPool);
        // try pool.init(ThreadPool.InitConfig{
        //     .allocator = allocator,
        // });
        const resolve_results = try allocator.create(ResolveResults);
        resolve_results.* = ResolveResults.init(allocator);
        return Transpiler{
            .options = bundle_options,
            .fs = fs,
            .allocator = allocator,
            .timer = SystemTimer.start() catch @panic("Timer fail"),
            .resolver = Resolver.init1(allocator, log, fs, bundle_options),
            .log = log,
            // .thread_pool = pool,
            .linker = undefined,
            .result = options.TransformResult{ .outbase = bundle_options.output_dir },
            .resolve_results = resolve_results,
            .resolve_queue = ResolveQueue.init(allocator),
            .output_files = std.ArrayList(options.OutputFile).init(allocator),
            .env = env_loader,
        };
    }

    pub fn configureLinkerWithAutoJSX(transpiler: *Transpiler, auto_jsx: bool) void {
        transpiler.linker = Linker.init(
            transpiler.allocator,
            transpiler.log,
            &transpiler.resolve_queue,
            &transpiler.options,
            &transpiler.resolver,
            transpiler.resolve_results,
            transpiler.fs,
        );

        if (auto_jsx) {
            // Most of the time, this will already be cached
            if (transpiler.resolver.readDirInfo(transpiler.fs.top_level_dir) catch null) |root_dir| {
                if (root_dir.tsconfig_json) |tsconfig| {
                    // If we don't explicitly pass JSX, try to get it from the root tsconfig
                    if (transpiler.options.transform_options.jsx == null) {
                        transpiler.options.jsx = tsconfig.jsx;
                    }
                    transpiler.options.emit_decorator_metadata = tsconfig.emit_decorator_metadata;
                }
            }
        }
    }

    pub fn configureLinker(transpiler: *Transpiler) void {
        transpiler.configureLinkerWithAutoJSX(true);
    }

    pub fn runEnvLoader(this: *Transpiler, skip_default_env: bool) !void {
        switch (this.options.env.behavior) {
            .prefix, .load_all, .load_all_without_inlining => {
                // Step 1. Load the project root.
                const dir_info = this.resolver.readDirInfo(this.fs.top_level_dir) catch return orelse return;

                if (dir_info.tsconfig_json) |tsconfig| {
                    this.options.jsx = tsconfig.mergeJSX(this.options.jsx);
                }

                const dir = dir_info.getEntries(this.resolver.generation) orelse return;

                // Process always has highest priority.
                const was_production = this.options.production;
                this.env.loadProcess();
                const has_production_env = this.env.isProduction();
                if (!was_production and has_production_env) {
                    this.options.setProduction(true);
                }

                if (this.options.isTest() or this.env.isTest()) {
                    try this.env.load(dir, this.options.env.files, .@"test", skip_default_env);
                } else if (this.options.production) {
                    try this.env.load(dir, this.options.env.files, .production, skip_default_env);
                } else {
                    try this.env.load(dir, this.options.env.files, .development, skip_default_env);
                }
            },
            .disable => {
                this.env.loadProcess();
                if (this.env.isProduction()) {
                    this.options.setProduction(true);
                }
            },
            else => {},
        }

        if (strings.eqlComptime(this.env.get("BUN_DISABLE_TRANSPILER") orelse "0", "1")) {
            this.options.disable_transpilation = true;
        }
    }

    // This must be run after a framework is configured, if a framework is enabled
    pub fn configureDefines(this: *Transpiler) !void {
        if (this.options.defines_loaded) {
            return;
        }

        if (this.options.target == .bun_macro) {
            this.options.env.behavior = .prefix;
            this.options.env.prefix = "BUN_";
        }

        try this.runEnvLoader(false);

        this.options.jsx.setProduction(this.env.isProduction());

        js_ast.Expr.Data.Store.create();
        js_ast.Stmt.Data.Store.create();

        defer js_ast.Expr.Data.Store.reset();
        defer js_ast.Stmt.Data.Store.reset();

        try this.options.loadDefines(this.allocator, this.env, &this.options.env);

        if (this.options.define.dots.get("NODE_ENV")) |NODE_ENV| {
            if (NODE_ENV.len > 0 and NODE_ENV[0].data.value == .e_string and NODE_ENV[0].data.value.e_string.eqlComptime("production")) {
                this.options.production = true;
            }
        }
    }

    pub fn resetStore(_: *const Transpiler) void {
        js_ast.Expr.Data.Store.reset();
        js_ast.Stmt.Data.Store.reset();
    }

    pub noinline fn dumpEnvironmentVariables(transpiler: *const Transpiler) void {
        @setCold(true);
        const opts = std.json.StringifyOptions{
            .whitespace = .indent_2,
        };
        Output.flush();
        std.json.stringify(transpiler.env.map.*, opts, Output.writer()) catch unreachable;
        Output.flush();
    }

    pub const BuildResolveResultPair = struct {
        written: usize,
        input_fd: ?StoredFileDescriptorType,
        empty: bool = false,
    };

    pub fn buildWithResolveResult(
        transpiler: *Transpiler,
        resolve_result: _resolver.Result,
        allocator: std.mem.Allocator,
        loader: options.Loader,
        comptime Writer: type,
        writer: Writer,
        comptime import_path_format: options.BundleOptions.ImportPathFormat,
        file_descriptor: ?StoredFileDescriptorType,
        filepath_hash: u32,
        comptime WatcherType: type,
        watcher: *WatcherType,
        client_entry_point: ?*EntryPoints.ClientEntryPoint,
        origin: URL,
        comptime is_source_map: bool,
        source_map_handler: ?js_printer.SourceMapHandler,
    ) !BuildResolveResultPair {
        if (resolve_result.is_external) {
            return BuildResolveResultPair{
                .written = 0,
                .input_fd = null,
            };
        }

        errdefer transpiler.resetStore();

        var file_path = (resolve_result.pathConst() orelse {
            return BuildResolveResultPair{
                .written = 0,
                .input_fd = null,
            };
        }).*;

        if (strings.indexOf(file_path.text, transpiler.fs.top_level_dir)) |i| {
            file_path.pretty = file_path.text[i + transpiler.fs.top_level_dir.len ..];
        } else if (!file_path.is_symlink) {
            file_path.pretty = allocator.dupe(u8, transpiler.fs.relativeTo(file_path.text)) catch unreachable;
        }

        const old_bundler_allocator = transpiler.allocator;
        transpiler.allocator = allocator;
        defer transpiler.allocator = old_bundler_allocator;
        const old_linker_allocator = transpiler.linker.allocator;
        defer transpiler.linker.allocator = old_linker_allocator;
        transpiler.linker.allocator = allocator;

        switch (loader) {
            .css => {
                const CSSBundlerHMR = Css.NewBundler(
                    Writer,
                    @TypeOf(&transpiler.linker),
                    @TypeOf(&transpiler.resolver.caches.fs),
                    WatcherType,
                    @TypeOf(transpiler.fs),
                    true,
                    import_path_format,
                );

                const CSSBundler = Css.NewBundler(
                    Writer,
                    @TypeOf(&transpiler.linker),
                    @TypeOf(&transpiler.resolver.caches.fs),
                    WatcherType,
                    @TypeOf(transpiler.fs),
                    false,
                    import_path_format,
                );

                const written = brk: {
                    if (transpiler.options.hot_module_reloading) {
                        break :brk (try CSSBundlerHMR.bundle(
                            file_path.text,
                            transpiler.fs,
                            writer,
                            watcher,
                            &transpiler.resolver.caches.fs,
                            filepath_hash,
                            file_descriptor,
                            allocator,
                            transpiler.log,
                            &transpiler.linker,
                            origin,
                        )).written;
                    } else {
                        break :brk (try CSSBundler.bundle(
                            file_path.text,
                            transpiler.fs,
                            writer,
                            watcher,
                            &transpiler.resolver.caches.fs,
                            filepath_hash,
                            file_descriptor,
                            allocator,
                            transpiler.log,
                            &transpiler.linker,
                            origin,
                        )).written;
                    }
                };

                return BuildResolveResultPair{
                    .written = written,
                    .input_fd = file_descriptor,
                };
            },
            else => {
                var result = transpiler.parse(
                    ParseOptions{
                        .allocator = allocator,
                        .path = file_path,
                        .loader = loader,
                        .dirname_fd = resolve_result.dirname_fd,
                        .file_descriptor = file_descriptor,
                        .file_hash = filepath_hash,
                        .macro_remappings = transpiler.options.macro_remap,
                        .emit_decorator_metadata = resolve_result.emit_decorator_metadata,
                        .jsx = resolve_result.jsx,
                    },
                    client_entry_point,
                ) orelse {
                    transpiler.resetStore();
                    return BuildResolveResultPair{
                        .written = 0,
                        .input_fd = null,
                    };
                };

                if (result.empty) {
                    return BuildResolveResultPair{ .written = 0, .input_fd = result.input_fd, .empty = true };
                }

                if (transpiler.options.target.isBun()) {
                    if (!transpiler.options.transform_only) {
                        try transpiler.linker.link(file_path, &result, origin, import_path_format, false, true);
                    }

                    return BuildResolveResultPair{
                        .written = switch (result.ast.exports_kind) {
                            .esm => try transpiler.printWithSourceMapMaybe(
                                result.ast,
                                &result.source,
                                Writer,
                                writer,
                                .esm_ascii,
                                is_source_map,
                                source_map_handler,
                                null,
                            ),
                            .cjs => try transpiler.printWithSourceMapMaybe(
                                result.ast,
                                &result.source,
                                Writer,
                                writer,
                                .cjs,
                                is_source_map,
                                source_map_handler,
                                null,
                            ),
                            else => unreachable,
                        },
                        .input_fd = result.input_fd,
                    };
                }

                if (!transpiler.options.transform_only) {
                    try transpiler.linker.link(file_path, &result, origin, import_path_format, false, false);
                }

                return BuildResolveResultPair{
                    .written = switch (result.ast.exports_kind) {
                        .none, .esm => try transpiler.printWithSourceMapMaybe(
                            result.ast,
                            &result.source,
                            Writer,
                            writer,
                            .esm,
                            is_source_map,
                            source_map_handler,
                            null,
                        ),
                        .cjs => try transpiler.printWithSourceMapMaybe(
                            result.ast,
                            &result.source,
                            Writer,
                            writer,
                            .cjs,
                            is_source_map,
                            source_map_handler,
                            null,
                        ),
                        else => unreachable,
                    },
                    .input_fd = result.input_fd,
                };
            },
        }
    }

    pub fn buildWithResolveResultEager(
        transpiler: *Transpiler,
        resolve_result: _resolver.Result,
        comptime import_path_format: options.BundleOptions.ImportPathFormat,
        comptime Outstream: type,
        outstream: Outstream,
        client_entry_point_: ?*EntryPoints.ClientEntryPoint,
    ) !?options.OutputFile {
        if (resolve_result.is_external) {
            return null;
        }

        var file_path = (resolve_result.pathConst() orelse return null).*;

        // Step 1. Parse & scan
        const loader = transpiler.options.loader(file_path.name.ext);

        if (client_entry_point_) |client_entry_point| {
            file_path = client_entry_point.source.path;
        }

        file_path.pretty = Linker.relative_paths_list.append(string, transpiler.fs.relativeTo(file_path.text)) catch unreachable;

        var output_file = options.OutputFile{
            .src_path = file_path,
            .loader = loader,
            .value = undefined,
            .side = null,
            .entry_point_index = null,
            .output_kind = .chunk,
        };

        switch (loader) {
            .jsx, .tsx, .js, .ts, .json, .toml, .text => {
                var result = transpiler.parse(
                    ParseOptions{
                        .allocator = transpiler.allocator,
                        .path = file_path,
                        .loader = loader,
                        .dirname_fd = resolve_result.dirname_fd,
                        .file_descriptor = null,
                        .file_hash = null,
                        .macro_remappings = transpiler.options.macro_remap,
                        .jsx = resolve_result.jsx,
                        .emit_decorator_metadata = resolve_result.emit_decorator_metadata,
                    },
                    client_entry_point_,
                ) orelse {
                    return null;
                };
                if (!transpiler.options.transform_only) {
                    if (!transpiler.options.target.isBun())
                        try transpiler.linker.link(
                            file_path,
                            &result,
                            transpiler.options.origin,
                            import_path_format,
                            false,
                            false,
                        )
                    else
                        try transpiler.linker.link(
                            file_path,
                            &result,
                            transpiler.options.origin,
                            import_path_format,
                            false,
                            true,
                        );
                }

                const buffer_writer = try js_printer.BufferWriter.init(transpiler.allocator);
                var writer = js_printer.BufferPrinter.init(buffer_writer);

                output_file.size = switch (transpiler.options.target) {
                    .browser, .node => try transpiler.print(
                        result,
                        *js_printer.BufferPrinter,
                        &writer,
                        .esm,
                    ),
                    .bun, .bun_macro, .bake_server_components_ssr => try transpiler.print(
                        result,
                        *js_printer.BufferPrinter,
                        &writer,
                        .esm_ascii,
                    ),
                };
                output_file.value = .{
                    .buffer = .{
                        .allocator = transpiler.allocator,
                        .bytes = writer.ctx.written,
                    },
                };
            },
            .dataurl, .base64 => {
                Output.panic("TODO: dataurl, base64", .{}); // TODO
            },
            .css => {
                if (transpiler.options.experimental.css) {
                    const alloc = transpiler.allocator;

                    const entry = transpiler.resolver.caches.fs.readFileWithAllocator(
                        transpiler.allocator,
                        transpiler.fs,
                        file_path.text,
                        resolve_result.dirname_fd,
                        false,
                        null,
                    ) catch |err| {
                        transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{s} reading \"{s}\"", .{ @errorName(err), file_path.pretty }) catch {};
                        return null;
                    };
                    var sheet = switch (bun.css.StyleSheet(bun.css.DefaultAtRule).parse(alloc, entry.contents, bun.css.ParserOptions.default(alloc, transpiler.log), null)) {
                        .result => |v| v,
                        .err => |e| {
                            transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{} parsing", .{e}) catch unreachable;
                            return null;
                        },
                    };
                    if (sheet.minify(alloc, bun.css.MinifyOptions.default()).asErr()) |e| {
                        transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{} while minifying", .{e.kind}) catch bun.outOfMemory();
                        return null;
                    }
                    const result = sheet.toCss(alloc, bun.css.PrinterOptions{
                        .targets = bun.css.Targets.forBundlerTarget(transpiler.options.target),
                        .minify = transpiler.options.minify_whitespace,
                    }, null) catch |e| {
                        bun.handleErrorReturnTrace(e, @errorReturnTrace());
                        return null;
                    };
                    output_file.value = .{ .buffer = .{ .allocator = alloc, .bytes = result.code } };
                } else {
                    var file: bun.sys.File = undefined;

                    if (Outstream == std.fs.Dir) {
                        const output_dir = outstream;

                        if (std.fs.path.dirname(file_path.pretty)) |dirname| {
                            try output_dir.makePath(dirname);
                        }
                        file = bun.sys.File.from(try output_dir.createFile(file_path.pretty, .{}));
                    } else {
                        file = bun.sys.File.from(outstream);
                    }

                    const CSSBuildContext = struct {
                        origin: URL,
                    };
                    const build_ctx = CSSBuildContext{ .origin = transpiler.options.origin };

                    const BufferedWriter = std.io.CountingWriter(std.io.BufferedWriter(8192, bun.sys.File.Writer));
                    const CSSWriter = Css.NewWriter(
                        BufferedWriter.Writer,
                        @TypeOf(&transpiler.linker),
                        import_path_format,
                        CSSBuildContext,
                    );
                    var buffered_writer = BufferedWriter{
                        .child_stream = .{ .unbuffered_writer = file.writer() },
                        .bytes_written = 0,
                    };
                    const entry = transpiler.resolver.caches.fs.readFile(
                        transpiler.fs,
                        file_path.text,
                        resolve_result.dirname_fd,
                        !cache_files,
                        null,
                    ) catch return null;

                    const _file = Fs.PathContentsPair{ .path = file_path, .contents = entry.contents };
                    var source = try logger.Source.initFile(_file, transpiler.allocator);
                    source.contents_is_recycled = !cache_files;

                    var css_writer = CSSWriter.init(
                        &source,
                        buffered_writer.writer(),
                        &transpiler.linker,
                        transpiler.log,
                    );

                    css_writer.buildCtx = build_ctx;

                    try css_writer.run(transpiler.log, transpiler.allocator);
                    try css_writer.ctx.context.child_stream.flush();
                    output_file.size = css_writer.ctx.context.bytes_written;
                    var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                    file_op.fd = bun.toFD(file.handle);

                    file_op.is_tmpdir = false;

                    if (Outstream == std.fs.Dir) {
                        file_op.dir = bun.toFD(outstream.fd);

                        if (transpiler.fs.fs.needToCloseFiles()) {
                            file.close();
                            file_op.fd = .zero;
                        }
                    }

                    output_file.value = .{ .move = file_op };
                }
            },

            .html, .bunsh, .sqlite_embedded, .sqlite, .wasm, .file, .napi => {
                const hashed_name = try transpiler.linker.getHashedFilename(file_path, null);
                var pathname = try transpiler.allocator.alloc(u8, hashed_name.len + file_path.name.ext.len);
                bun.copy(u8, pathname, hashed_name);
                bun.copy(u8, pathname[hashed_name.len..], file_path.name.ext);
                const dir = if (transpiler.options.output_dir_handle) |output_handle| bun.toFD(output_handle.fd) else .zero;

                output_file.value = .{
                    .copy = options.OutputFile.FileOperation{
                        .pathname = pathname,
                        .dir = dir,
                        .is_outdir = true,
                    },
                };
            },
        }

        return output_file;
    }

    pub fn printWithSourceMapMaybe(
        transpiler: *Transpiler,
        ast: js_ast.Ast,
        source: *const logger.Source,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
        comptime enable_source_map: bool,
        source_map_context: ?js_printer.SourceMapHandler,
        runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache,
    ) !usize {
        const tracer = bun.tracy.traceNamed(@src(), if (enable_source_map) "JSPrinter.printWithSourceMap" else "JSPrinter.print");
        defer tracer.end();

        const symbols = js_ast.Symbol.NestedList.init(&[_]js_ast.Symbol.List{ast.symbols});

        return switch (format) {
            .cjs => try js_printer.printCommonJS(
                Writer,
                writer,
                ast,
                js_ast.Symbol.Map.initList(symbols),
                source,
                false,
                .{
                    .bundling = false,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .css_import_behavior = transpiler.options.cssImportBehavior(),
                    .source_map_handler = source_map_context,
                    .minify_whitespace = transpiler.options.minify_whitespace,
                    .minify_syntax = transpiler.options.minify_syntax,
                    .minify_identifiers = transpiler.options.minify_identifiers,
                    .transform_only = transpiler.options.transform_only,
                    .runtime_transpiler_cache = runtime_transpiler_cache,
                    .print_dce_annotations = transpiler.options.emit_dce_annotations,
                },
                enable_source_map,
            ),

            .esm => try js_printer.printAst(
                Writer,
                writer,
                ast,
                js_ast.Symbol.Map.initList(symbols),
                source,
                false,
                .{
                    .bundling = false,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .source_map_handler = source_map_context,
                    .css_import_behavior = transpiler.options.cssImportBehavior(),
                    .minify_whitespace = transpiler.options.minify_whitespace,
                    .minify_syntax = transpiler.options.minify_syntax,
                    .minify_identifiers = transpiler.options.minify_identifiers,
                    .transform_only = transpiler.options.transform_only,
                    .import_meta_ref = ast.import_meta_ref,
                    .runtime_transpiler_cache = runtime_transpiler_cache,
                    .print_dce_annotations = transpiler.options.emit_dce_annotations,
                },
                enable_source_map,
            ),
            .esm_ascii => switch (transpiler.options.target.isBun()) {
                inline else => |is_bun| try js_printer.printAst(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    is_bun,
                    .{
                        .bundling = false,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = transpiler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .minify_whitespace = transpiler.options.minify_whitespace,
                        .minify_syntax = transpiler.options.minify_syntax,
                        .minify_identifiers = transpiler.options.minify_identifiers,
                        .transform_only = transpiler.options.transform_only,
                        .module_type = if (is_bun and transpiler.options.transform_only)
                            // this is for when using `bun build --no-bundle`
                            // it should copy what was passed for the cli
                            transpiler.options.output_format
                        else if (ast.exports_kind == .cjs)
                            .cjs
                        else
                            .esm,
                        .inline_require_and_import_errors = false,
                        .import_meta_ref = ast.import_meta_ref,
                        .runtime_transpiler_cache = runtime_transpiler_cache,
                        .target = transpiler.options.target,
                        .print_dce_annotations = transpiler.options.emit_dce_annotations,
                    },
                    enable_source_map,
                ),
            },
            else => unreachable,
        };
    }

    pub fn print(
        transpiler: *Transpiler,
        result: ParseResult,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
    ) !usize {
        return transpiler.printWithSourceMapMaybe(
            result.ast,
            &result.source,
            Writer,
            writer,
            format,
            false,
            null,
            null,
        );
    }

    pub fn printWithSourceMap(
        transpiler: *Transpiler,
        result: ParseResult,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
        handler: js_printer.SourceMapHandler,
    ) !usize {
        if (bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS")) {
            return transpiler.printWithSourceMapMaybe(
                result.ast,
                &result.source,
                Writer,
                writer,
                format,
                false,
                handler,
                result.runtime_transpiler_cache,
            );
        }
        return transpiler.printWithSourceMapMaybe(
            result.ast,
            &result.source,
            Writer,
            writer,
            format,
            true,
            handler,
            result.runtime_transpiler_cache,
        );
    }

    pub const ParseOptions = struct {
        allocator: std.mem.Allocator,
        dirname_fd: StoredFileDescriptorType,
        file_descriptor: ?StoredFileDescriptorType = null,
        file_hash: ?u32 = null,

        /// On exception, we might still want to watch the file.
        file_fd_ptr: ?*StoredFileDescriptorType = null,

        path: Fs.Path,
        loader: options.Loader,
        jsx: options.JSX.Pragma,
        macro_remappings: MacroRemap,
        macro_js_ctx: MacroJSValueType = default_macro_js_value,
        virtual_source: ?*const logger.Source = null,
        replace_exports: runtime.Runtime.Features.ReplaceableExport.Map = .{},
        inject_jest_globals: bool = false,
        set_breakpoint_on_first_line: bool = false,
        emit_decorator_metadata: bool = false,
        remove_cjs_module_wrapper: bool = false,

        dont_bundle_twice: bool = false,
        allow_commonjs: bool = false,

        runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,

        keep_json_and_toml_as_one_statement: bool = false,
        allow_bytecode_cache: bool = false,
    };

    pub fn parse(
        transpiler: *Transpiler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
    ) ?ParseResult {
        return parseMaybeReturnFileOnly(transpiler, this_parse, client_entry_point_, false);
    }

    pub fn parseMaybeReturnFileOnly(
        transpiler: *Transpiler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
        comptime return_file_only: bool,
    ) ?ParseResult {
        return parseMaybeReturnFileOnlyAllowSharedBuffer(
            transpiler,
            this_parse,
            client_entry_point_,
            return_file_only,
            false,
        );
    }

    pub fn parseMaybeReturnFileOnlyAllowSharedBuffer(
        transpiler: *Transpiler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
        comptime return_file_only: bool,
        comptime use_shared_buffer: bool,
    ) ?ParseResult {
        var allocator = this_parse.allocator;
        const dirname_fd = this_parse.dirname_fd;
        const file_descriptor = this_parse.file_descriptor;
        const file_hash = this_parse.file_hash;
        const path = this_parse.path;
        const loader = this_parse.loader;

        var input_fd: ?StoredFileDescriptorType = null;

        const source: logger.Source = brk: {
            if (this_parse.virtual_source) |virtual_source| {
                break :brk virtual_source.*;
            }

            if (client_entry_point_) |client_entry_point| {
                if (@hasField(std.meta.Child(@TypeOf(client_entry_point)), "source")) {
                    break :brk client_entry_point.source;
                }
            }

            if (strings.eqlComptime(path.namespace, "node")) {
                if (NodeFallbackModules.contentsFromPath(path.text)) |code| {
                    break :brk logger.Source.initPathString(path.text, code);
                }

                break :brk logger.Source.initPathString(path.text, "");
            }

            if (strings.startsWith(path.text, "data:")) {
                const data_url = DataURL.parseWithoutCheck(path.text) catch |err| {
                    transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{s} parsing data url \"{s}\"", .{ @errorName(err), path.text }) catch {};
                    return null;
                };
                const body = data_url.decodeData(this_parse.allocator) catch |err| {
                    transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{s} decoding data \"{s}\"", .{ @errorName(err), path.text }) catch {};
                    return null;
                };
                break :brk logger.Source.initPathString(path.text, body);
            }

            const entry = transpiler.resolver.caches.fs.readFileWithAllocator(
                if (use_shared_buffer) bun.fs_allocator else this_parse.allocator,
                transpiler.fs,
                path.text,
                dirname_fd,
                use_shared_buffer,
                file_descriptor,
            ) catch |err| {
                transpiler.log.addErrorFmt(null, logger.Loc.Empty, transpiler.allocator, "{s} reading \"{s}\"", .{ @errorName(err), path.text }) catch {};
                return null;
            };
            input_fd = entry.fd;
            if (this_parse.file_fd_ptr) |file_fd_ptr| {
                file_fd_ptr.* = entry.fd;
            }
            break :brk logger.Source.initRecycledFile(.{ .path = path, .contents = entry.contents }, transpiler.allocator) catch return null;
        };

        if (comptime return_file_only) {
            return ParseResult{ .source = source, .input_fd = input_fd, .loader = loader, .empty = true, .ast = js_ast.Ast.empty };
        }

        if (loader != .wasm and source.contents.len == 0 and source.contents.len < 33 and std.mem.trim(u8, source.contents, "\n\r ").len == 0) {
            return ParseResult{ .source = source, .input_fd = input_fd, .loader = loader, .empty = true, .ast = js_ast.Ast.empty };
        }

        switch (loader) {
            .js,
            .jsx,
            .ts,
            .tsx,
            => {
                // wasm magic number
                if (source.isWebAssembly()) {
                    return ParseResult{
                        .source = source,
                        .input_fd = input_fd,
                        .loader = .wasm,
                        .empty = true,
                        .ast = js_ast.Ast.empty,
                    };
                }

                const target = transpiler.options.target;

                var jsx = this_parse.jsx;
                jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(jsx, loader);

                opts.features.emit_decorator_metadata = this_parse.emit_decorator_metadata;
                opts.features.allow_runtime = transpiler.options.allow_runtime;
                opts.features.set_breakpoint_on_first_line = this_parse.set_breakpoint_on_first_line;
                opts.features.trim_unused_imports = transpiler.options.trim_unused_imports orelse loader.isTypeScript();
                opts.features.no_macros = transpiler.options.no_macros;
                opts.features.runtime_transpiler_cache = this_parse.runtime_transpiler_cache;
                opts.transform_only = transpiler.options.transform_only;

                opts.ignore_dce_annotations = transpiler.options.ignore_dce_annotations;

                // @bun annotation
                opts.features.dont_bundle_twice = this_parse.dont_bundle_twice;

                opts.features.commonjs_at_runtime = this_parse.allow_commonjs;

                opts.tree_shaking = transpiler.options.tree_shaking;
                opts.features.inlining = transpiler.options.inlining;

                opts.filepath_hash_for_hmr = file_hash orelse 0;
                opts.features.auto_import_jsx = transpiler.options.auto_import_jsx;
                opts.warn_about_unbundled_modules = !target.isBun();

                opts.features.inject_jest_globals = this_parse.inject_jest_globals;
                opts.features.minify_syntax = transpiler.options.minify_syntax;
                opts.features.minify_identifiers = transpiler.options.minify_identifiers;
                opts.features.dead_code_elimination = transpiler.options.dead_code_elimination;
                opts.features.remove_cjs_module_wrapper = this_parse.remove_cjs_module_wrapper;

                if (transpiler.macro_context == null) {
                    transpiler.macro_context = js_ast.Macro.MacroContext.init(transpiler);
                }

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.macro_context = &transpiler.macro_context.?;
                if (comptime !JSC.is_bindgen) {
                    if (target != .bun_macro) {
                        opts.macro_context.javascript_object = this_parse.macro_js_ctx;
                    }
                }

                opts.features.is_macro_runtime = target == .bun_macro;
                opts.features.replace_exports = this_parse.replace_exports;

                return switch ((transpiler.resolver.caches.js.parse(
                    allocator,
                    opts,
                    transpiler.options.define,
                    transpiler.log,
                    &source,
                ) catch null) orelse return null) {
                    .ast => |value| ParseResult{
                        .ast = value,
                        .source = source,
                        .loader = loader,
                        .input_fd = input_fd,
                        .runtime_transpiler_cache = this_parse.runtime_transpiler_cache,
                    },
                    .cached => ParseResult{
                        .ast = undefined,
                        .runtime_transpiler_cache = this_parse.runtime_transpiler_cache,
                        .source = source,
                        .loader = loader,
                        .input_fd = input_fd,
                    },
                    .already_bundled => |already_bundled| ParseResult{
                        .ast = undefined,
                        .already_bundled = switch (already_bundled) {
                            .bun => .source_code,
                            .bun_cjs => .source_code_cjs,
                            .bytecode_cjs, .bytecode => brk: {
                                const default_value: ParseResult.AlreadyBundled = if (already_bundled == .bytecode_cjs) .source_code_cjs else .source_code;
                                if (this_parse.virtual_source == null and this_parse.allow_bytecode_cache) {
                                    var path_buf2: bun.PathBuffer = undefined;
                                    @memcpy(path_buf2[0..path.text.len], path.text);
                                    path_buf2[path.text.len..][0..bun.bytecode_extension.len].* = bun.bytecode_extension.*;
                                    const bytecode = bun.sys.File.toSourceAt(dirname_fd, path_buf2[0 .. path.text.len + bun.bytecode_extension.len], bun.default_allocator).asValue() orelse break :brk default_value;
                                    if (bytecode.contents.len == 0) {
                                        break :brk default_value;
                                    }
                                    break :brk if (already_bundled == .bytecode_cjs) .{ .bytecode_cjs = @constCast(bytecode.contents) } else .{ .bytecode = @constCast(bytecode.contents) };
                                }
                                break :brk default_value;
                            },
                        },
                        .source = source,
                        .loader = loader,
                        .input_fd = input_fd,
                    },
                };
            },
            // TODO: use lazy export AST
            inline .toml, .json => |kind| {
                var expr = if (kind == .json)
                    // We allow importing tsconfig.*.json or jsconfig.*.json with comments
                    // These files implicitly become JSONC files, which aligns with the behavior of text editors.
                    if (source.path.isJSONCFile())
                        JSON.parseTSConfig(&source, transpiler.log, allocator, false) catch return null
                    else
                        JSON.parse(&source, transpiler.log, allocator, false) catch return null
                else if (kind == .toml)
                    TOML.parse(&source, transpiler.log, allocator, false) catch return null
                else
                    @compileError("unreachable");

                var symbols: []js_ast.Symbol = &.{};

                const parts = brk: {
                    if (this_parse.keep_json_and_toml_as_one_statement) {
                        var stmts = allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                        stmts[0] = js_ast.Stmt.allocate(allocator, js_ast.S.SExpr, js_ast.S.SExpr{ .value = expr }, logger.Loc{ .start = 0 });
                        var parts_ = allocator.alloc(js_ast.Part, 1) catch unreachable;
                        parts_[0] = js_ast.Part{ .stmts = stmts };
                        break :brk parts_;
                    }

                    if (expr.data == .e_object) {
                        const properties: []js_ast.G.Property = expr.data.e_object.properties.slice();
                        if (properties.len > 0) {
                            var stmts = allocator.alloc(js_ast.Stmt, 3) catch return null;
                            var decls = allocator.alloc(js_ast.G.Decl, properties.len) catch return null;
                            symbols = allocator.alloc(js_ast.Symbol, properties.len) catch return null;
                            var export_clauses = allocator.alloc(js_ast.ClauseItem, properties.len) catch return null;
                            var duplicate_key_checker = bun.StringHashMap(u32).init(allocator);
                            defer duplicate_key_checker.deinit();
                            var count: usize = 0;
                            for (properties, decls, symbols, 0..) |*prop, *decl, *symbol, i| {
                                const name = prop.key.?.data.e_string.slice(allocator);
                                // Do not make named exports for "default" exports
                                if (strings.eqlComptime(name, "default"))
                                    continue;

                                const visited = duplicate_key_checker.getOrPut(name) catch continue;
                                if (visited.found_existing) {
                                    decls[visited.value_ptr.*].value = prop.value.?;
                                    continue;
                                }
                                visited.value_ptr.* = @truncate(i);

                                symbol.* = js_ast.Symbol{
                                    .original_name = MutableString.ensureValidIdentifier(name, allocator) catch return null,
                                };

                                const ref = Ref.init(@truncate(i), 0, false);
                                decl.* = js_ast.G.Decl{
                                    .binding = js_ast.Binding.alloc(allocator, js_ast.B.Identifier{
                                        .ref = ref,
                                    }, prop.key.?.loc),
                                    .value = prop.value.?,
                                };
                                export_clauses[i] = js_ast.ClauseItem{
                                    .name = .{
                                        .ref = ref,
                                        .loc = prop.key.?.loc,
                                    },
                                    .alias = name,
                                    .alias_loc = prop.key.?.loc,
                                };
                                prop.value = js_ast.Expr.initIdentifier(ref, prop.value.?.loc);
                                count += 1;
                            }

                            stmts[0] = js_ast.Stmt.alloc(
                                js_ast.S.Local,
                                js_ast.S.Local{
                                    .decls = js_ast.G.Decl.List.init(decls[0..count]),
                                    .kind = .k_var,
                                },
                                logger.Loc{
                                    .start = 0,
                                },
                            );
                            stmts[1] = js_ast.Stmt.alloc(
                                js_ast.S.ExportClause,
                                js_ast.S.ExportClause{
                                    .items = export_clauses[0..count],
                                },
                                logger.Loc{
                                    .start = 0,
                                },
                            );
                            stmts[2] = js_ast.Stmt.alloc(
                                js_ast.S.ExportDefault,
                                js_ast.S.ExportDefault{
                                    .value = js_ast.StmtOrExpr{ .expr = expr },
                                    .default_name = js_ast.LocRef{
                                        .loc = logger.Loc{},
                                        .ref = Ref.None,
                                    },
                                },
                                logger.Loc{
                                    .start = 0,
                                },
                            );

                            var parts_ = allocator.alloc(js_ast.Part, 1) catch unreachable;
                            parts_[0] = js_ast.Part{ .stmts = stmts };
                            break :brk parts_;
                        }
                    }

                    {
                        var stmts = allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                        stmts[0] = js_ast.Stmt.alloc(js_ast.S.ExportDefault, js_ast.S.ExportDefault{
                            .value = js_ast.StmtOrExpr{ .expr = expr },
                            .default_name = js_ast.LocRef{
                                .loc = logger.Loc{},
                                .ref = Ref.None,
                            },
                        }, logger.Loc{ .start = 0 });

                        var parts_ = allocator.alloc(js_ast.Part, 1) catch unreachable;
                        parts_[0] = js_ast.Part{ .stmts = stmts };
                        break :brk parts_;
                    }
                };
                var ast = js_ast.Ast.fromParts(parts);
                ast.symbols = js_ast.Symbol.List.init(symbols);

                return ParseResult{
                    .ast = ast,
                    .source = source,
                    .loader = loader,
                    .input_fd = input_fd,
                };
            },
            // TODO: use lazy export AST
            .text => {
                const expr = js_ast.Expr.init(js_ast.E.String, js_ast.E.String{
                    .data = source.contents,
                }, logger.Loc.Empty);
                const stmt = js_ast.Stmt.alloc(js_ast.S.ExportDefault, js_ast.S.ExportDefault{
                    .value = js_ast.StmtOrExpr{ .expr = expr },
                    .default_name = js_ast.LocRef{
                        .loc = logger.Loc{},
                        .ref = Ref.None,
                    },
                }, logger.Loc{ .start = 0 });
                var stmts = allocator.alloc(js_ast.Stmt, 1) catch unreachable;
                stmts[0] = stmt;
                var parts = allocator.alloc(js_ast.Part, 1) catch unreachable;
                parts[0] = js_ast.Part{ .stmts = stmts };

                return ParseResult{
                    .ast = js_ast.Ast.initTest(parts),
                    .source = source,
                    .loader = loader,
                    .input_fd = input_fd,
                };
            },
            .wasm => {
                if (transpiler.options.target.isBun()) {
                    if (!source.isWebAssembly()) {
                        transpiler.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            transpiler.allocator,
                            "Invalid wasm file \"{s}\" (missing magic header)",
                            .{path.text},
                        ) catch {};
                        return null;
                    }

                    return ParseResult{
                        .ast = js_ast.Ast.empty,
                        .source = source,
                        .loader = loader,
                        .input_fd = input_fd,
                    };
                }
            },
            .css => {},
            else => Output.panic("Unsupported loader {s} for path: {s}", .{ @tagName(loader), source.path.text }),
        }

        return null;
    }

    // This is public so it can be used by the HTTP handler when matching against public dir.
    pub threadlocal var tmp_buildfile_buf: bun.PathBuffer = undefined;
    threadlocal var tmp_buildfile_buf2: bun.PathBuffer = undefined;
    threadlocal var tmp_buildfile_buf3: bun.PathBuffer = undefined;

    pub fn buildFile(
        transpiler: *Transpiler,
        log: *logger.Log,
        path_to_use_: string,
        comptime client_entry_point_enabled: bool,
    ) !ServeResult {
        const old_log = transpiler.log;

        transpiler.setLog(log);
        defer transpiler.setLog(old_log);

        var path_to_use = path_to_use_;

        defer {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
        }

        // All non-absolute paths are ./paths
        if (path_to_use[0] != '/' and path_to_use[0] != '.') {
            tmp_buildfile_buf3[0..2].* = "./".*;
            @memcpy(tmp_buildfile_buf3[2..][0..path_to_use.len], path_to_use);
            path_to_use = tmp_buildfile_buf3[0 .. 2 + path_to_use.len];
        }

        const resolved = if (comptime !client_entry_point_enabled) (try transpiler.resolver.resolve(transpiler.fs.top_level_dir, path_to_use, .stmt)) else brk: {
            const absolute_pathname = Fs.PathName.init(path_to_use);

            const loader_for_ext = transpiler.options.loader(absolute_pathname.ext);

            // The expected pathname looks like:
            // /pages/index.entry.tsx
            // /pages/index.entry.js
            // /pages/index.entry.ts
            // /pages/index.entry.jsx
            if (loader_for_ext.supportsClientEntryPoint()) {
                const absolute_pathname_pathname = Fs.PathName.init(absolute_pathname.base);

                if (strings.eqlComptime(absolute_pathname_pathname.ext, ".entry")) {
                    const trail_dir = absolute_pathname.dirWithTrailingSlash();
                    var len = trail_dir.len;

                    bun.copy(u8, &tmp_buildfile_buf2, trail_dir);
                    bun.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname_pathname.base);
                    len += absolute_pathname_pathname.base.len;
                    bun.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname.ext);
                    len += absolute_pathname.ext.len;

                    if (comptime Environment.allow_assert) bun.assert(len > 0);

                    const decoded_entry_point_path = tmp_buildfile_buf2[0..len];
                    break :brk try transpiler.resolver.resolve(transpiler.fs.top_level_dir, decoded_entry_point_path, .entry_point);
                }
            }

            break :brk (try transpiler.resolver.resolve(transpiler.fs.top_level_dir, path_to_use, .stmt));
        };

        const path = (resolved.pathConst() orelse return error.ModuleNotFound);

        const loader = transpiler.options.loader(path.name.ext);
        const mime_type_ext = transpiler.options.out_extensions.get(path.name.ext) orelse path.name.ext;

        switch (loader) {
            .js, .jsx, .ts, .tsx, .css => {
                return ServeResult{
                    .file = options.OutputFile.initPending(loader, resolved),
                    .mime_type = MimeType.byLoader(
                        loader,
                        mime_type_ext[1..],
                    ),
                };
            },
            .toml, .json => {
                return ServeResult{
                    .file = options.OutputFile.initPending(loader, resolved),
                    .mime_type = MimeType.transpiled_json,
                };
            },
            else => {
                const abs_path = path.text;
                const file = try std.fs.openFileAbsolute(abs_path, .{ .mode = .read_only });
                const size = try file.getEndPos();
                return ServeResult{
                    .file = options.OutputFile.initFile(file, abs_path, size),
                    .mime_type = MimeType.byLoader(
                        loader,
                        mime_type_ext[1..],
                    ),
                };
            },
        }
    }

    pub fn normalizeEntryPointPath(transpiler: *Transpiler, _entry: string) string {
        var paths = [_]string{_entry};
        var entry = transpiler.fs.abs(&paths);

        std.fs.accessAbsolute(entry, .{}) catch
            return _entry;

        entry = transpiler.fs.relativeTo(entry);

        if (!strings.startsWith(entry, "./")) {
            // Entry point paths without a leading "./" are interpreted as package
            // paths. This happens because they go through general path resolution
            // like all other import paths so that plugins can run on them. Requiring
            // a leading "./" for a relative path simplifies writing plugins because
            // entry points aren't a special case.
            //
            // However, requiring a leading "./" also breaks backward compatibility
            // and makes working with the CLI more difficult. So attempt to insert
            // "./" automatically when needed. We don't want to unconditionally insert
            // a leading "./" because the path may not be a file system path. For
            // example, it may be a URL. So only insert a leading "./" when the path
            // is an exact match for an existing file.
            var __entry = transpiler.allocator.alloc(u8, "./".len + entry.len) catch unreachable;
            __entry[0] = '.';
            __entry[1] = '/';
            bun.copy(u8, __entry[2..__entry.len], entry);
            entry = __entry;
        }

        return entry;
    }

    fn enqueueEntryPoints(transpiler: *Transpiler, entry_points: []_resolver.Result, comptime normalize_entry_point: bool) usize {
        var entry_point_i: usize = 0;

        for (transpiler.options.entry_points) |_entry| {
            const entry: string = if (comptime normalize_entry_point) transpiler.normalizeEntryPointPath(_entry) else _entry;

            defer {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();
            }

            const result = transpiler.resolver.resolve(transpiler.fs.top_level_dir, entry, .entry_point) catch |err| {
                Output.prettyError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                continue;
            };

            if (result.pathConst() == null) {
                Output.prettyError("\"{s}\" is disabled due to \"browser\" field in package.json.\n", .{
                    entry,
                });
                continue;
            }

            if (transpiler.linker.enqueueResolveResult(&result) catch unreachable) {
                entry_points[entry_point_i] = result;
                entry_point_i += 1;
            }
        }

        return entry_point_i;
    }

    pub fn transform(
        transpiler: *Transpiler,
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        _ = opts;
        var entry_points = try allocator.alloc(_resolver.Result, transpiler.options.entry_points.len);
        entry_points = entry_points[0..transpiler.enqueueEntryPoints(entry_points, true)];

        if (log.level.atLeast(.debug)) {
            transpiler.resolver.debug_logs = try DebugLogs.init(allocator);
        }
        transpiler.options.transform_only = true;
        const did_start = false;

        if (transpiler.options.output_dir_handle == null) {
            const outstream = bun.sys.File.from(std.io.getStdOut());

            if (!did_start) {
                try switch (transpiler.options.import_path_format) {
                    .relative => transpiler.processResolveQueue(.relative, false, @TypeOf(outstream), outstream),
                    .absolute_url => transpiler.processResolveQueue(.absolute_url, false, @TypeOf(outstream), outstream),
                    .absolute_path => transpiler.processResolveQueue(.absolute_path, false, @TypeOf(outstream), outstream),
                    .package_path => transpiler.processResolveQueue(.package_path, false, @TypeOf(outstream), outstream),
                };
            }
        } else {
            const output_dir = transpiler.options.output_dir_handle orelse {
                Output.printError("Invalid or missing output directory.", .{});
                Global.crash();
            };

            if (!did_start) {
                try switch (transpiler.options.import_path_format) {
                    .relative => transpiler.processResolveQueue(.relative, false, std.fs.Dir, output_dir),
                    .absolute_url => transpiler.processResolveQueue(.absolute_url, false, std.fs.Dir, output_dir),
                    .absolute_path => transpiler.processResolveQueue(.absolute_path, false, std.fs.Dir, output_dir),
                    .package_path => transpiler.processResolveQueue(.package_path, false, std.fs.Dir, output_dir),
                };
            }
        }

        // if (log.level == .verbose) {
        //     for (log.msgs.items) |msg| {
        //         try msg.writeFormat(std.io.getStdOut().writer());
        //     }
        // }

        if (transpiler.linker.any_needs_runtime) {
            // try transpiler.output_files.append(
            //     options.OutputFile.initBuf(
            //         runtime.Runtime.source_code,
            //         bun.default_allocator,
            //         Linker.runtime_source_path,
            //         .js,
            //         null,
            //         null,
            //     ),
            // );
        }

        if (FeatureFlags.tracing and transpiler.options.log.level.atLeast(.info)) {
            Output.prettyErrorln(
                "<r><d>\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n<r>",
                .{
                    transpiler.resolver.elapsed,
                    transpiler.elapsed,
                },
            );
        }

        var final_result = try options.TransformResult.init(try allocator.dupe(u8, transpiler.result.outbase), try transpiler.output_files.toOwnedSlice(), log, allocator);
        final_result.root_dir = transpiler.options.output_dir_handle;
        return final_result;
    }

    // pub fn processResolveQueueWithThreadPool(transpiler)

    pub fn processResolveQueue(
        transpiler: *Transpiler,
        comptime import_path_format: options.BundleOptions.ImportPathFormat,
        comptime wrap_entry_point: bool,
        comptime Outstream: type,
        outstream: Outstream,
    ) !void {
        // var count: u8 = 0;
        while (transpiler.resolve_queue.readItem()) |item| {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();

            // defer count += 1;

            if (comptime wrap_entry_point) {
                const path = item.pathConst() orelse unreachable;
                const loader = transpiler.options.loader(path.name.ext);

                if (item.import_kind == .entry_point and loader.supportsClientEntryPoint()) {
                    var client_entry_point = try transpiler.allocator.create(EntryPoints.ClientEntryPoint);
                    client_entry_point.* = EntryPoints.ClientEntryPoint{};
                    try client_entry_point.generate(Transpiler, transpiler, path.name, transpiler.options.framework.?.client.path);

                    const entry_point_output_file = transpiler.buildWithResolveResultEager(
                        item,
                        import_path_format,
                        Outstream,
                        outstream,
                        client_entry_point,
                    ) catch continue orelse continue;
                    transpiler.output_files.append(entry_point_output_file) catch unreachable;

                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();

                    // At this point, the entry point will be de-duped.
                    // So we just immediately build it.
                    var item_not_entrypointed = item;
                    item_not_entrypointed.import_kind = .stmt;
                    const original_output_file = transpiler.buildWithResolveResultEager(
                        item_not_entrypointed,
                        import_path_format,
                        Outstream,
                        outstream,
                        null,
                    ) catch continue orelse continue;
                    transpiler.output_files.append(original_output_file) catch unreachable;

                    continue;
                }
            }

            const output_file = transpiler.buildWithResolveResultEager(
                item,
                import_path_format,
                Outstream,
                outstream,
                null,
            ) catch continue orelse continue;
            transpiler.output_files.append(output_file) catch unreachable;

            // if (count >= 3) return try transpiler.processResolveQueueWithThreadPool(import_path_format, wrap_entry_point, Outstream, outstream);
        }
    }
};

pub const ServeResult = struct {
    file: options.OutputFile,
    mime_type: MimeType,
};
pub const ResolveResults = std.AutoHashMap(
    u64,
    void,
);
pub const ResolveQueue = std.fifo.LinearFifo(
    _resolver.Result,
    std.fifo.LinearFifoBufferType.Dynamic,
);
