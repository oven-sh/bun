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
const logger = @import("root").bun.logger;
const options = @import("options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
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
const Lock = @import("./lock.zig").Lock;
const NodeFallbackModules = @import("./node_fallbacks.zig");
const CacheEntry = @import("./cache.zig").FsCacheEntry;
const Analytics = @import("./analytics/analytics_thread.zig");
const URL = @import("./url.zig").URL;
const Report = @import("./report.zig");
const Linker = linker.Linker;
const Resolver = _resolver.Resolver;
const TOML = @import("./toml/toml_parser.zig").TOML;
const JSC = @import("root").bun.JSC;
const PackageManager = @import("./install/install.zig").PackageManager;

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
    already_bundled: bool = false,
    input_fd: ?StoredFileDescriptorType = null,
    empty: bool = false,
    pending_imports: _resolver.PendingResolution.List = .{},

    runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,

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
    ) ?Fs.Path {
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
        const path_value = on_resolve_plugin.get(global, "path") orelse return null;
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
            if (on_resolve_plugin.get(global, "namespace")) |namespace_value| {
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

    pub fn onResolveJSC(
        this: *const PluginRunner,
        namespace: bun.String,
        specifier: bun.String,
        importer: bun.String,
        target: JSC.JSGlobalObject.BunPluginTarget,
    ) ?JSC.ErrorableString {
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
        const path_value = on_resolve_plugin.get(global, "path") orelse return null;
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
            if (on_resolve_plugin.get(global, "namespace")) |namespace_value| {
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

pub const Bundler = struct {
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

    pub fn clone(this: *Bundler, allocator: std.mem.Allocator, to: *Bundler) !void {
        to.* = this.*;
        to.setAllocator(allocator);
        to.log = try allocator.create(logger.Log);
        to.log.* = logger.Log.init(allocator);
        to.setLog(to.log);
        to.macro_context = null;
        to.linker.resolver = &to.resolver;
    }

    pub inline fn getPackageManager(this: *Bundler) *PackageManager {
        return this.resolver.getPackageManager();
    }

    pub fn setLog(this: *Bundler, log: *logger.Log) void {
        this.log = log;
        this.linker.log = log;
        this.resolver.log = log;
    }

    pub fn setAllocator(this: *Bundler, allocator: std.mem.Allocator) void {
        this.allocator = allocator;
        this.linker.allocator = allocator;
        this.resolver.allocator = allocator;
    }

    pub inline fn resolveEntryPoint(bundler: *Bundler, entry_point: string) anyerror!_resolver.Result {
        return bundler.resolver.resolve(bundler.fs.top_level_dir, entry_point, .entry_point) catch |err| {
            const has_dot_slash_form = !strings.hasPrefix(entry_point, "./") and brk: {
                return bundler.resolver.resolve(bundler.fs.top_level_dir, try strings.append(bundler.allocator, "./", entry_point), .entry_point) catch break :brk false;
            };
            _ = has_dot_slash_form;

            bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} resolving \"{s}\" (entry point)", .{ @errorName(err), entry_point }) catch unreachable;

            return err;
        };
    }

    pub fn init(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
        env_loader_: ?*DotEnv.Loader,
    ) !Bundler {
        js_ast.Expr.Data.Store.create(allocator);
        js_ast.Stmt.Data.Store.create(allocator);
        const fs = try Fs.FileSystem.init(
            opts.absolute_working_dir,
        );
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
        return Bundler{
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

    pub fn configureLinkerWithAutoJSX(bundler: *Bundler, auto_jsx: bool) void {
        bundler.linker = Linker.init(
            bundler.allocator,
            bundler.log,
            &bundler.resolve_queue,
            &bundler.options,
            &bundler.resolver,
            bundler.resolve_results,
            bundler.fs,
        );

        if (auto_jsx) {
            // Most of the time, this will already be cached
            if (bundler.resolver.readDirInfo(bundler.fs.top_level_dir) catch null) |root_dir| {
                if (root_dir.tsconfig_json) |tsconfig| {
                    // If we don't explicitly pass JSX, try to get it from the root tsconfig
                    if (bundler.options.transform_options.jsx == null) {
                        bundler.options.jsx = tsconfig.jsx;
                    }
                    bundler.options.emit_decorator_metadata = tsconfig.emit_decorator_metadata;
                }
            }
        }
    }

    pub fn configureLinker(bundler: *Bundler) void {
        bundler.configureLinkerWithAutoJSX(true);
    }

    pub fn runEnvLoader(this: *Bundler) !void {
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

                if (!has_production_env and this.options.isTest()) {
                    try this.env.load(dir, this.options.env.files, .@"test");
                } else if (this.options.production) {
                    try this.env.load(dir, this.options.env.files, .production);
                } else {
                    try this.env.load(dir, this.options.env.files, .development);
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

        if (this.env.map.get("DO_NOT_TRACK")) |dnt| {
            // https://do-not-track.dev/
            if (strings.eqlComptime(dnt, "1")) {
                Analytics.disabled = true;
            }
        }

        Analytics.is_ci = Analytics.is_ci or this.env.isCI();

        if (strings.eqlComptime(this.env.map.get("BUN_DISABLE_TRANSPILER") orelse "0", "1")) {
            this.options.disable_transpilation = true;
        }

        Analytics.disabled = Analytics.disabled or this.env.map.get("HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET") != null;
    }

    // This must be run after a framework is configured, if a framework is enabled
    pub fn configureDefines(this: *Bundler) !void {
        if (this.options.defines_loaded) {
            return;
        }

        if (this.options.target == .bun_macro) {
            this.options.env.behavior = .prefix;
            this.options.env.prefix = "BUN_";
        }

        try this.runEnvLoader();

        this.options.jsx.setProduction(this.env.isProduction());

        js_ast.Expr.Data.Store.create(this.allocator);
        js_ast.Stmt.Data.Store.create(this.allocator);

        defer js_ast.Expr.Data.Store.reset();
        defer js_ast.Stmt.Data.Store.reset();

        if (this.options.framework) |framework| {
            if (this.options.target.isClient()) {
                try this.options.loadDefines(this.allocator, this.env, &framework.client.env);
            } else {
                try this.options.loadDefines(this.allocator, this.env, &framework.server.env);
            }
        } else {
            try this.options.loadDefines(this.allocator, this.env, &this.options.env);
        }

        if (this.options.define.dots.get("NODE_ENV")) |NODE_ENV| {
            if (NODE_ENV.len > 0 and NODE_ENV[0].data.value == .e_string and NODE_ENV[0].data.value.e_string.eqlComptime("production")) {
                this.options.production = true;

                if (this.options.target.isBun()) {
                    if (strings.eqlComptime(this.options.jsx.package_name, "react")) {
                        if (this.options.jsx_optimization_inline == null) {
                            this.options.jsx_optimization_inline = true;
                        }

                        if (this.options.jsx_optimization_hoist == null and (this.options.jsx_optimization_inline orelse false)) {
                            this.options.jsx_optimization_hoist = true;
                        }
                    }
                }
            }
        }
    }

    pub fn configureFramework(
        this: *Bundler,
        comptime load_defines: bool,
    ) !void {
        if (this.options.framework) |*framework| {
            if (framework.needsResolveFromPackage()) {
                var route_config = this.options.routes;
                var pair = PackageJSON.FrameworkRouterPair{ .framework = framework, .router = &route_config };

                if (framework.development) {
                    try this.resolver.resolveFramework(framework.package, &pair, .development, load_defines);
                } else {
                    try this.resolver.resolveFramework(framework.package, &pair, .production, load_defines);
                }

                if (this.options.areDefinesUnset()) {
                    if (this.options.target.isClient()) {
                        this.options.env = framework.client.env;
                    } else {
                        this.options.env = framework.server.env;
                    }
                }

                if (pair.loaded_routes) {
                    this.options.routes = route_config;
                }
                framework.resolved = true;
                this.options.framework = framework.*;
            } else if (!framework.resolved) {
                Global.panic("directly passing framework path is not implemented yet!", .{});
            }
        }
    }

    pub fn configureFrameworkWithResolveResult(this: *Bundler, comptime client: bool) !?_resolver.Result {
        if (this.options.framework != null) {
            try this.configureFramework(true);
            if (comptime client) {
                if (this.options.framework.?.client.isEnabled()) {
                    return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.client.path, .stmt);
                }

                if (this.options.framework.?.fallback.isEnabled()) {
                    return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.fallback.path, .stmt);
                }
            } else {
                if (this.options.framework.?.server.isEnabled()) {
                    return try this.resolver.resolve(this.fs.top_level_dir, this.options.framework.?.server, .stmt);
                }
            }
        }

        return null;
    }

    pub fn configureRouter(this: *Bundler, comptime load_defines: bool) !void {
        try this.configureFramework(load_defines);
        defer {
            if (load_defines) {
                this.configureDefines() catch {};
            }
        }

        if (this.options.routes.routes_enabled) {
            const dir_info_ = try this.resolver.readDirInfo(this.options.routes.dir);
            const dir_info = dir_info_ orelse return error.MissingRoutesDir;

            this.options.routes.dir = dir_info.abs_path;

            this.router = try Router.init(this.fs, this.allocator, this.options.routes);
            try this.router.?.loadRoutes(
                this.log,
                dir_info,
                Resolver,
                &this.resolver,
                this.fs.top_level_dir,
            );
            this.router.?.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
            return;
        }

        // If we get this far, it means they're trying to run the bundler without a preconfigured router
        if (this.options.entry_points.len > 0) {
            this.options.routes.routes_enabled = false;
        }

        if (this.router) |*router| {
            router.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
        }
    }

    pub fn resetStore(_: *const Bundler) void {
        js_ast.Expr.Data.Store.reset();
        js_ast.Stmt.Data.Store.reset();
    }

    pub noinline fn dumpEnvironmentVariables(bundler: *const Bundler) void {
        @setCold(true);
        const opts = std.json.StringifyOptions{
            .whitespace = .indent_2,
        };
        Output.flush();
        std.json.stringify(bundler.env.map.*, opts, Output.writer()) catch unreachable;
        Output.flush();
    }

    pub const BuildResolveResultPair = struct {
        written: usize,
        input_fd: ?StoredFileDescriptorType,
        empty: bool = false,
    };
    pub fn buildWithResolveResult(
        bundler: *Bundler,
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

        errdefer bundler.resetStore();

        var file_path = (resolve_result.pathConst() orelse {
            return BuildResolveResultPair{
                .written = 0,
                .input_fd = null,
            };
        }).*;

        if (strings.indexOf(file_path.text, bundler.fs.top_level_dir)) |i| {
            file_path.pretty = file_path.text[i + bundler.fs.top_level_dir.len ..];
        } else if (!file_path.is_symlink) {
            file_path.pretty = allocator.dupe(u8, bundler.fs.relativeTo(file_path.text)) catch unreachable;
        }

        const old_bundler_allocator = bundler.allocator;
        bundler.allocator = allocator;
        defer bundler.allocator = old_bundler_allocator;
        const old_linker_allocator = bundler.linker.allocator;
        defer bundler.linker.allocator = old_linker_allocator;
        bundler.linker.allocator = allocator;

        switch (loader) {
            .css => {
                const CSSBundlerHMR = Css.NewBundler(
                    Writer,
                    @TypeOf(&bundler.linker),
                    @TypeOf(&bundler.resolver.caches.fs),
                    WatcherType,
                    @TypeOf(bundler.fs),
                    true,
                    import_path_format,
                );

                const CSSBundler = Css.NewBundler(
                    Writer,
                    @TypeOf(&bundler.linker),
                    @TypeOf(&bundler.resolver.caches.fs),
                    WatcherType,
                    @TypeOf(bundler.fs),
                    false,
                    import_path_format,
                );

                const written = brk: {
                    if (bundler.options.hot_module_reloading) {
                        break :brk (try CSSBundlerHMR.bundle(
                            file_path.text,
                            bundler.fs,
                            writer,
                            watcher,
                            &bundler.resolver.caches.fs,
                            filepath_hash,
                            file_descriptor,
                            allocator,
                            bundler.log,
                            &bundler.linker,
                            origin,
                        )).written;
                    } else {
                        break :brk (try CSSBundler.bundle(
                            file_path.text,
                            bundler.fs,
                            writer,
                            watcher,
                            &bundler.resolver.caches.fs,
                            filepath_hash,
                            file_descriptor,
                            allocator,
                            bundler.log,
                            &bundler.linker,
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
                var result = bundler.parse(
                    ParseOptions{
                        .allocator = allocator,
                        .path = file_path,
                        .loader = loader,
                        .dirname_fd = resolve_result.dirname_fd,
                        .file_descriptor = file_descriptor,
                        .file_hash = filepath_hash,
                        .macro_remappings = bundler.options.macro_remap,
                        .emit_decorator_metadata = resolve_result.emit_decorator_metadata,
                        .jsx = resolve_result.jsx,
                    },
                    client_entry_point,
                ) orelse {
                    bundler.resetStore();
                    return BuildResolveResultPair{
                        .written = 0,
                        .input_fd = null,
                    };
                };

                if (result.empty) {
                    return BuildResolveResultPair{ .written = 0, .input_fd = result.input_fd, .empty = true };
                }

                if (bundler.options.target.isBun()) {
                    if (!bundler.options.transform_only) {
                        try bundler.linker.link(file_path, &result, origin, import_path_format, false, true);
                    }

                    return BuildResolveResultPair{
                        .written = switch (result.ast.exports_kind) {
                            .esm => try bundler.printWithSourceMapMaybe(
                                result.ast,
                                &result.source,
                                Writer,
                                writer,
                                .esm_ascii,
                                is_source_map,
                                source_map_handler,
                                null,
                            ),
                            .cjs => try bundler.printWithSourceMapMaybe(
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

                if (!bundler.options.transform_only) {
                    try bundler.linker.link(file_path, &result, origin, import_path_format, false, false);
                }

                return BuildResolveResultPair{
                    .written = switch (result.ast.exports_kind) {
                        .none, .esm => try bundler.printWithSourceMapMaybe(
                            result.ast,
                            &result.source,
                            Writer,
                            writer,
                            .esm,
                            is_source_map,
                            source_map_handler,
                            null,
                        ),
                        .cjs => try bundler.printWithSourceMapMaybe(
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
        bundler: *Bundler,
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
        const loader = bundler.options.loader(file_path.name.ext);

        if (client_entry_point_) |client_entry_point| {
            file_path = client_entry_point.source.path;
        }

        file_path.pretty = Linker.relative_paths_list.append(string, bundler.fs.relativeTo(file_path.text)) catch unreachable;

        var output_file = options.OutputFile{
            .src_path = file_path,
            .loader = loader,
            .value = undefined,
        };

        switch (loader) {
            .jsx, .tsx, .js, .ts, .json, .toml, .text => {
                var result = bundler.parse(
                    ParseOptions{
                        .allocator = bundler.allocator,
                        .path = file_path,
                        .loader = loader,
                        .dirname_fd = resolve_result.dirname_fd,
                        .file_descriptor = null,
                        .file_hash = null,
                        .macro_remappings = bundler.options.macro_remap,
                        .jsx = resolve_result.jsx,
                        .emit_decorator_metadata = resolve_result.emit_decorator_metadata,
                    },
                    client_entry_point_,
                ) orelse {
                    return null;
                };
                if (!bundler.options.transform_only) {
                    if (!bundler.options.target.isBun())
                        try bundler.linker.link(
                            file_path,
                            &result,
                            bundler.options.origin,
                            import_path_format,
                            false,
                            false,
                        )
                    else
                        try bundler.linker.link(
                            file_path,
                            &result,
                            bundler.options.origin,
                            import_path_format,
                            false,
                            true,
                        );
                }

                const buffer_writer = try js_printer.BufferWriter.init(bundler.allocator);
                var writer = js_printer.BufferPrinter.init(buffer_writer);

                output_file.size = switch (bundler.options.target) {
                    .browser, .node => try bundler.print(
                        result,
                        *js_printer.BufferPrinter,
                        &writer,
                        .esm,
                    ),
                    .bun, .bun_macro => try bundler.print(
                        result,
                        *js_printer.BufferPrinter,
                        &writer,
                        .esm_ascii,
                    ),
                };
                output_file.value = .{
                    .buffer = .{
                        .allocator = bundler.allocator,
                        .bytes = writer.ctx.written,
                    },
                };
            },
            .dataurl, .base64 => {
                Output.panic("TODO: dataurl, base64", .{}); // TODO
            },
            .css => {
                var file: std.fs.File = undefined;

                if (Outstream == std.fs.Dir) {
                    const output_dir = outstream;

                    if (std.fs.path.dirname(file_path.pretty)) |dirname| {
                        try output_dir.makePath(dirname);
                    }
                    file = try output_dir.createFile(file_path.pretty, .{});
                } else {
                    file = outstream;
                }

                const CSSBuildContext = struct {
                    origin: URL,
                };
                const build_ctx = CSSBuildContext{ .origin = bundler.options.origin };

                const BufferedWriter = std.io.CountingWriter(std.io.BufferedWriter(8192, std.fs.File.Writer));
                const CSSWriter = Css.NewWriter(
                    BufferedWriter.Writer,
                    @TypeOf(&bundler.linker),
                    import_path_format,
                    CSSBuildContext,
                );
                var buffered_writer = BufferedWriter{
                    .child_stream = .{ .unbuffered_writer = file.writer() },
                    .bytes_written = 0,
                };
                const entry = bundler.resolver.caches.fs.readFile(
                    bundler.fs,
                    file_path.text,
                    resolve_result.dirname_fd,
                    !cache_files,
                    null,
                ) catch return null;

                const _file = Fs.PathContentsPair{ .path = file_path, .contents = entry.contents };
                var source = try logger.Source.initFile(_file, bundler.allocator);
                source.contents_is_recycled = !cache_files;

                var css_writer = CSSWriter.init(
                    &source,
                    buffered_writer.writer(),
                    &bundler.linker,
                    bundler.log,
                );

                css_writer.buildCtx = build_ctx;

                try css_writer.run(bundler.log, bundler.allocator);
                try css_writer.ctx.context.child_stream.flush();
                output_file.size = css_writer.ctx.context.bytes_written;
                var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                file_op.fd = bun.toFD(file.handle);

                file_op.is_tmpdir = false;

                if (Outstream == std.fs.Dir) {
                    file_op.dir = bun.toFD(outstream.fd);

                    if (bundler.fs.fs.needToCloseFiles()) {
                        file.close();
                        file_op.fd = .zero;
                    }
                }

                output_file.value = .{ .move = file_op };
            },

            .bunsh, .sqlite_embedded, .sqlite, .wasm, .file, .napi => {
                const hashed_name = try bundler.linker.getHashedFilename(file_path, null);
                var pathname = try bundler.allocator.alloc(u8, hashed_name.len + file_path.name.ext.len);
                bun.copy(u8, pathname, hashed_name);
                bun.copy(u8, pathname[hashed_name.len..], file_path.name.ext);
                const dir = if (bundler.options.output_dir_handle) |output_handle| bun.toFD(output_handle.fd) else .zero;

                output_file.value = .{
                    .copy = options.OutputFile.FileOperation{
                        .pathname = pathname,
                        .dir = dir,
                        .is_outdir = true,
                    },
                };
            },

            // // TODO:
            // else => {},
        }

        return output_file;
    }

    pub fn printWithSourceMapMaybe(
        bundler: *Bundler,
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
                js_printer.Options{
                    .externals = ast.externals,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .css_import_behavior = bundler.options.cssImportBehavior(),
                    .source_map_handler = source_map_context,
                    .minify_whitespace = bundler.options.minify_whitespace,
                    .minify_syntax = bundler.options.minify_syntax,
                    .minify_identifiers = bundler.options.minify_identifiers,
                    .transform_only = bundler.options.transform_only,
                    .runtime_transpiler_cache = runtime_transpiler_cache,
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
                js_printer.Options{
                    .externals = ast.externals,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .source_map_handler = source_map_context,
                    .css_import_behavior = bundler.options.cssImportBehavior(),
                    .minify_whitespace = bundler.options.minify_whitespace,
                    .minify_syntax = bundler.options.minify_syntax,
                    .minify_identifiers = bundler.options.minify_identifiers,
                    .transform_only = bundler.options.transform_only,
                    .import_meta_ref = ast.import_meta_ref,
                    .runtime_transpiler_cache = runtime_transpiler_cache,
                },
                enable_source_map,
            ),
            .esm_ascii => switch (bundler.options.target.isBun()) {
                inline else => |is_bun| try js_printer.printAst(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    is_bun,
                    js_printer.Options{
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .minify_whitespace = bundler.options.minify_whitespace,
                        .minify_syntax = bundler.options.minify_syntax,
                        .minify_identifiers = bundler.options.minify_identifiers,
                        .transform_only = bundler.options.transform_only,
                        .module_type = if (is_bun and bundler.options.transform_only)
                            // this is for when using `bun build --no-bundle`
                            // it should copy what was passed for the cli
                            bundler.options.output_format
                        else if (ast.exports_kind == .cjs)
                            .cjs
                        else
                            .esm,
                        .inline_require_and_import_errors = false,
                        .import_meta_ref = ast.import_meta_ref,
                        .runtime_transpiler_cache = runtime_transpiler_cache,
                    },
                    enable_source_map,
                ),
            },
            else => unreachable,
        };
    }

    pub fn print(
        bundler: *Bundler,
        result: ParseResult,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
    ) !usize {
        return bundler.printWithSourceMapMaybe(
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
        bundler: *Bundler,
        result: ParseResult,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
        handler: js_printer.SourceMapHandler,
    ) !usize {
        return bundler.printWithSourceMapMaybe(
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

        dont_bundle_twice: bool = false,
        allow_commonjs: bool = false,

        runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,
    };

    pub fn parse(
        bundler: *Bundler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
    ) ?ParseResult {
        return parseMaybeReturnFileOnly(bundler, this_parse, client_entry_point_, false);
    }

    pub fn parseMaybeReturnFileOnly(
        bundler: *Bundler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
        comptime return_file_only: bool,
    ) ?ParseResult {
        return parseMaybeReturnFileOnlyAllowSharedBuffer(
            bundler,
            this_parse,
            client_entry_point_,
            return_file_only,
            false,
        );
    }

    pub fn parseMaybeReturnFileOnlyAllowSharedBuffer(
        bundler: *Bundler,
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

            const entry = bundler.resolver.caches.fs.readFileWithAllocator(
                if (use_shared_buffer) bun.fs_allocator else this_parse.allocator,
                bundler.fs,
                path.text,
                dirname_fd,
                use_shared_buffer,
                file_descriptor,
            ) catch |err| {
                bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} reading \"{s}\"", .{ @errorName(err), path.text }) catch {};
                return null;
            };
            input_fd = entry.fd;
            if (this_parse.file_fd_ptr) |file_fd_ptr| {
                file_fd_ptr.* = entry.fd;
            }
            break :brk logger.Source.initRecycledFile(.{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;
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

                const target = bundler.options.target;

                var jsx = this_parse.jsx;
                jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(jsx, loader);

                opts.legacy_transform_require_to_import = bundler.options.allow_runtime and !bundler.options.target.isBun();
                opts.features.emit_decorator_metadata = this_parse.emit_decorator_metadata;
                opts.features.allow_runtime = bundler.options.allow_runtime;
                opts.features.set_breakpoint_on_first_line = this_parse.set_breakpoint_on_first_line;
                opts.features.trim_unused_imports = bundler.options.trim_unused_imports orelse loader.isTypeScript();
                opts.features.should_fold_typescript_constant_expressions = loader.isTypeScript() or target.isBun() or bundler.options.minify_syntax;
                opts.features.use_import_meta_require = target.isBun();
                opts.features.no_macros = bundler.options.no_macros;
                opts.features.runtime_transpiler_cache = this_parse.runtime_transpiler_cache;
                opts.transform_only = bundler.options.transform_only;

                // @bun annotation
                opts.features.dont_bundle_twice = this_parse.dont_bundle_twice;

                opts.features.commonjs_at_runtime = this_parse.allow_commonjs;

                opts.tree_shaking = bundler.options.tree_shaking;
                opts.features.inlining = bundler.options.inlining;

                opts.features.react_fast_refresh = opts.features.hot_module_reloading and
                    jsx.parse and
                    bundler.options.jsx.supports_fast_refresh;
                opts.filepath_hash_for_hmr = file_hash orelse 0;
                opts.features.auto_import_jsx = bundler.options.auto_import_jsx;
                opts.warn_about_unbundled_modules = target.isNotBun();
                opts.features.jsx_optimization_inline = opts.features.allow_runtime and
                    (bundler.options.jsx_optimization_inline orelse (target.isBun() and jsx.parse and
                    !jsx.development)) and
                    (jsx.runtime == .automatic or jsx.runtime == .classic) and
                    strings.eqlComptime(jsx.import_source.production, "react/jsx-runtime");

                opts.features.jsx_optimization_hoist = bundler.options.jsx_optimization_hoist orelse opts.features.jsx_optimization_inline;
                opts.features.inject_jest_globals = this_parse.inject_jest_globals;
                opts.features.minify_syntax = bundler.options.minify_syntax;
                opts.features.minify_identifiers = bundler.options.minify_identifiers;
                opts.features.dead_code_elimination = bundler.options.dead_code_elimination;

                if (bundler.macro_context == null) {
                    bundler.macro_context = js_ast.Macro.MacroContext.init(bundler);
                }

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.macro_context = &bundler.macro_context.?;
                if (comptime !JSC.is_bindgen) {
                    if (target != .bun_macro) {
                        opts.macro_context.javascript_object = this_parse.macro_js_ctx;
                    }
                }

                opts.features.is_macro_runtime = target == .bun_macro;
                opts.features.replace_exports = this_parse.replace_exports;

                return switch ((bundler.resolver.caches.js.parse(
                    allocator,
                    opts,
                    bundler.options.define,
                    bundler.log,
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
                    .already_bundled => ParseResult{
                        .ast = undefined,
                        .already_bundled = true,
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
                        json_parser.ParseTSConfig(&source, bundler.log, allocator) catch return null
                    else
                        json_parser.ParseJSON(&source, bundler.log, allocator) catch return null
                else if (kind == .toml)
                    TOML.parse(&source, bundler.log, allocator) catch return null
                else
                    @compileError("unreachable");

                var symbols: []js_ast.Symbol = &.{};

                const parts = brk: {
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
                if (bundler.options.target.isBun()) {
                    if (!source.isWebAssembly()) {
                        bundler.log.addErrorFmt(
                            null,
                            logger.Loc.Empty,
                            bundler.allocator,
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
            else => Global.panic("Unsupported loader {s} for path: {s}", .{ @tagName(loader), source.path.text }),
        }

        return null;
    }

    // This is public so it can be used by the HTTP handler when matching against public dir.
    pub threadlocal var tmp_buildfile_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var tmp_buildfile_buf2: [bun.MAX_PATH_BYTES]u8 = undefined;
    threadlocal var tmp_buildfile_buf3: [bun.MAX_PATH_BYTES]u8 = undefined;

    // We try to be mostly stateless when serving
    // This means we need a slightly different resolver setup
    pub fn buildFile(
        bundler: *Bundler,
        log: *logger.Log,
        path_to_use_: string,
        comptime client_entry_point_enabled: bool,
    ) !ServeResult {
        const old_log = bundler.log;

        bundler.setLog(log);
        defer bundler.setLog(old_log);

        var path_to_use = path_to_use_;

        defer {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();
        }

        // If the extension is .js, omit it.
        // if (absolute_path.len > ".js".len and strings.eqlComptime(absolute_path[absolute_path.len - ".js".len ..], ".js")) {
        //     absolute_path = absolute_path[0 .. absolute_path.len - ".js".len];
        // }

        // All non-absolute paths are ./paths
        if (path_to_use[0] != '/' and path_to_use[0] != '.') {
            tmp_buildfile_buf3[0..2].* = "./".*;
            @memcpy(tmp_buildfile_buf3[2..][0..path_to_use.len], path_to_use);
            path_to_use = tmp_buildfile_buf3[0 .. 2 + path_to_use.len];
        }

        const resolved = if (comptime !client_entry_point_enabled) (try bundler.resolver.resolve(bundler.fs.top_level_dir, path_to_use, .stmt)) else brk: {
            const absolute_pathname = Fs.PathName.init(path_to_use);

            const loader_for_ext = bundler.options.loader(absolute_pathname.ext);

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

                    if (comptime Environment.allow_assert) std.debug.assert(len > 0);

                    const decoded_entry_point_path = tmp_buildfile_buf2[0..len];
                    break :brk try bundler.resolver.resolve(bundler.fs.top_level_dir, decoded_entry_point_path, .entry_point);
                }
            }

            break :brk (try bundler.resolver.resolve(bundler.fs.top_level_dir, path_to_use, .stmt));
        };

        const path = (resolved.pathConst() orelse return error.ModuleNotFound);

        const loader = bundler.options.loader(path.name.ext);
        const mime_type_ext = bundler.options.out_extensions.get(path.name.ext) orelse path.name.ext;

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

    pub fn normalizeEntryPointPath(bundler: *Bundler, _entry: string) string {
        var paths = [_]string{_entry};
        var entry = bundler.fs.abs(&paths);

        std.fs.accessAbsolute(entry, .{}) catch
            return _entry;

        entry = bundler.fs.relativeTo(entry);

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
            var __entry = bundler.allocator.alloc(u8, "./".len + entry.len) catch unreachable;
            __entry[0] = '.';
            __entry[1] = '/';
            bun.copy(u8, __entry[2..__entry.len], entry);
            entry = __entry;
        }

        return entry;
    }

    fn enqueueEntryPoints(bundler: *Bundler, entry_points: []_resolver.Result, comptime normalize_entry_point: bool) usize {
        var entry_point_i: usize = 0;

        for (bundler.options.entry_points) |_entry| {
            const entry: string = if (comptime normalize_entry_point) bundler.normalizeEntryPointPath(_entry) else _entry;

            defer {
                js_ast.Expr.Data.Store.reset();
                js_ast.Stmt.Data.Store.reset();
            }

            const result = bundler.resolver.resolve(bundler.fs.top_level_dir, entry, .entry_point) catch |err| {
                Output.prettyError("Error resolving \"{s}\": {s}\n", .{ entry, @errorName(err) });
                continue;
            };

            if (result.pathConst() == null) {
                Output.prettyError("\"{s}\" is disabled due to \"browser\" field in package.json.\n", .{
                    entry,
                });
                continue;
            }

            if (bundler.linker.enqueueResolveResult(&result) catch unreachable) {
                entry_points[entry_point_i] = result;
                entry_point_i += 1;
            }
        }

        return entry_point_i;
    }

    pub fn transform(
        bundler: *Bundler,
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        _ = opts;
        var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);
        entry_points = entry_points[0..bundler.enqueueEntryPoints(entry_points, true)];

        if (log.level.atLeast(.debug)) {
            bundler.resolver.debug_logs = try DebugLogs.init(allocator);
        }
        bundler.options.transform_only = true;
        const did_start = false;

        if (bundler.options.output_dir_handle == null) {
            const outstream = std.io.getStdOut();

            if (!did_start) {
                try switch (bundler.options.import_path_format) {
                    .relative => bundler.processResolveQueue(.relative, false, @TypeOf(outstream), outstream),
                    .absolute_url => bundler.processResolveQueue(.absolute_url, false, @TypeOf(outstream), outstream),
                    .absolute_path => bundler.processResolveQueue(.absolute_path, false, @TypeOf(outstream), outstream),
                    .package_path => bundler.processResolveQueue(.package_path, false, @TypeOf(outstream), outstream),
                };
            }
        } else {
            const output_dir = bundler.options.output_dir_handle orelse {
                Output.printError("Invalid or missing output directory.", .{});
                Global.crash();
            };

            if (!did_start) {
                try switch (bundler.options.import_path_format) {
                    .relative => bundler.processResolveQueue(.relative, false, std.fs.Dir, output_dir),
                    .absolute_url => bundler.processResolveQueue(.absolute_url, false, std.fs.Dir, output_dir),
                    .absolute_path => bundler.processResolveQueue(.absolute_path, false, std.fs.Dir, output_dir),
                    .package_path => bundler.processResolveQueue(.package_path, false, std.fs.Dir, output_dir),
                };
            }
        }

        // if (log.level == .verbose) {
        //     for (log.msgs.items) |msg| {
        //         try msg.writeFormat(std.io.getStdOut().writer());
        //     }
        // }

        if (bundler.linker.any_needs_runtime) {
            // try bundler.output_files.append(
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

        if (FeatureFlags.tracing and bundler.options.log.level.atLeast(.info)) {
            Output.prettyErrorln(
                "<r><d>\n---Tracing---\nResolve time:      {d}\nParsing time:      {d}\n---Tracing--\n\n<r>",
                .{
                    bundler.resolver.elapsed,
                    bundler.elapsed,
                },
            );
        }

        var final_result = try options.TransformResult.init(try allocator.dupe(u8, bundler.result.outbase), try bundler.output_files.toOwnedSlice(), log, allocator);
        final_result.root_dir = bundler.options.output_dir_handle;
        return final_result;
    }

    // pub fn processResolveQueueWithThreadPool(bundler)

    pub fn processResolveQueue(
        bundler: *Bundler,
        comptime import_path_format: options.BundleOptions.ImportPathFormat,
        comptime wrap_entry_point: bool,
        comptime Outstream: type,
        outstream: Outstream,
    ) !void {
        // var count: u8 = 0;
        while (bundler.resolve_queue.readItem()) |item| {
            js_ast.Expr.Data.Store.reset();
            js_ast.Stmt.Data.Store.reset();

            // defer count += 1;

            if (comptime wrap_entry_point) {
                const path = item.pathConst() orelse unreachable;
                const loader = bundler.options.loader(path.name.ext);

                if (item.import_kind == .entry_point and loader.supportsClientEntryPoint()) {
                    var client_entry_point = try bundler.allocator.create(EntryPoints.ClientEntryPoint);
                    client_entry_point.* = EntryPoints.ClientEntryPoint{};
                    try client_entry_point.generate(Bundler, bundler, path.name, bundler.options.framework.?.client.path);

                    const entry_point_output_file = bundler.buildWithResolveResultEager(
                        item,
                        import_path_format,
                        Outstream,
                        outstream,
                        client_entry_point,
                    ) catch continue orelse continue;
                    bundler.output_files.append(entry_point_output_file) catch unreachable;

                    js_ast.Expr.Data.Store.reset();
                    js_ast.Stmt.Data.Store.reset();

                    // At this point, the entry point will be de-duped.
                    // So we just immediately build it.
                    var item_not_entrypointed = item;
                    item_not_entrypointed.import_kind = .stmt;
                    const original_output_file = bundler.buildWithResolveResultEager(
                        item_not_entrypointed,
                        import_path_format,
                        Outstream,
                        outstream,
                        null,
                    ) catch continue orelse continue;
                    bundler.output_files.append(original_output_file) catch unreachable;

                    continue;
                }
            }

            const output_file = bundler.buildWithResolveResultEager(
                item,
                import_path_format,
                Outstream,
                outstream,
                null,
            ) catch continue orelse continue;
            bundler.output_files.append(output_file) catch unreachable;

            // if (count >= 3) return try bundler.processResolveQueueWithThreadPool(import_path_format, wrap_entry_point, Outstream, outstream);
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
