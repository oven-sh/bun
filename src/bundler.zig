const bun = @import("global.zig");
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
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
const Ref = @import("ast/base.zig").Ref;
const Define = @import("defines.zig").Define;
const DebugOptions = @import("./cli.zig").Command.DebugOptions;
const ThreadPoolLib = @import("./thread_pool.zig");

const panicky = @import("panic_handler.zig");
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
const hash_map = @import("hash_map.zig");
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
const DebugLogs = _resolver.DebugLogs;
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
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
const JSC = @import("javascript_core");

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
// How it works end-to-end
// 1. Resolve a file path from input using the resolver
// 2. Look at the extension of that file path, and determine a loader
// 3. If the loader is .js, .jsx, .ts, .tsx, or .json, run it through our JavaScript Parser
// IF serving via HTTP and it's parsed without errors:
// 4. If parsed without errors, generate a strong ETag & write the output to a buffer that sends to the in the Printer.
// 4. Else, write any errors to error page (which doesn't exist yet)
// IF writing to disk AND it's parsed without errors:
// 4. Write the output to a temporary file.
//    Why? Two reasons.
//    1. At this point, we don't know what the best output path is.
//       Most of the time, you want the shortest common path, which you can't know until you've
//       built & resolved all paths.
//       Consider this directory tree:
//          - /Users/jarred/Code/app/src/index.tsx
//          - /Users/jarred/Code/app/src/Button.tsx
//          - /Users/jarred/Code/app/assets/logo.png
//          - /Users/jarred/Code/app/src/Button.css
//          - /Users/jarred/Code/app/node_modules/react/index.js
//          - /Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Remember that we cannot know which paths need to be resolved without parsing the JavaScript.
//        If we stopped here: /Users/jarred/Code/app/src/Button.tsx
//        We would choose /Users/jarred/Code/app/src/ as the directory
//        Then, that would result in a directory structure like this:
//         - /Users/jarred/Code/app/src/Users/jarred/Code/app/node_modules/react/cjs/react.development.js
//        Which is absolutely insane
//
//    2. We will need to write to disk at some point!
//          - If we delay writing to disk, we need to print & allocate a potentially quite large
//          buffer (react-dom.development.js is 550 KB)
//             ^ This is how it used to work!
//          - If we delay printing, we need to keep the AST around. Which breaks all our
//          memory-saving recycling logic since that could be many many ASTs.
//  5. Once all files are written, determine the shortest common path
//  6. Move all the temporary files to their intended destinations
// IF writing to disk AND it's a file-like loader
// 4. Hash the contents
//     - rewrite_paths.put(absolute_path, hash(file(absolute_path)))
// 5. Resolve any imports of this file to that hash(file(absolute_path))
// 6. Append to the files array with the new filename
// 7. When parsing & resolving is over, just copy the file.
//     - on macOS, ensure it does an APFS shallow clone so that doesn't use disk space (only possible if file doesn't already exist)
//          fclonefile
// IF serving via HTTP AND it's a file-like loader:
// 4. Use os.sendfile so copying/reading the file happens in the kernel instead of in bun.
//      This unfortunately means content hashing for HTTP server is unsupported, but metadata etags work
// For each imported file, GOTO 1.

pub const ParseResult = struct {
    source: logger.Source,
    loader: options.Loader,
    ast: js_ast.Ast,
    input_fd: ?StoredFileDescriptorType = null,
    empty: bool = false,
};

const cache_files = false;

pub const PluginRunner = struct {
    global_object: *JSC.JSGlobalObject,
    allocator: std.mem.Allocator,

    pub fn extractNamespace(specifier: string) string {
        const colon = strings.indexOfChar(specifier, ':') orelse return "";
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
            JSC.ZigString.init(namespace_slice)
        else
            JSC.ZigString.init("");
        const on_resolve_plugin = global.runOnResolvePlugins(
            namespace,
            JSC.ZigString.init(specifier).substring(if (namespace.len > 0) namespace.len + 1 else 0),
            JSC.ZigString.init(importer),
            target,
        ) orelse return null;
        const path_value = on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            log.addError(null, loc, "Expected \"path\" to be a string") catch unreachable;
            return null;
        }

        var file_path = path_value.getZigString(global);

        if (file_path.len == 0) {
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
        const user_namespace: JSC.ZigString = brk: {
            if (on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    log.addError(null, loc, "Expected \"namespace\" to be a string") catch unreachable;
                    return null;
                }

                const namespace_str = namespace_value.getZigString(global);
                if (namespace_str.len == 0) {
                    break :brk JSC.ZigString.init("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    break :brk JSC.ZigString.init("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    break :brk JSC.ZigString.init("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    break :brk JSC.ZigString.init("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk JSC.ZigString.init("file");
        };

        if (static_namespace) {
            return Fs.Path.initWithNamespace(
                std.fmt.allocPrint(this.allocator, "{any}", .{file_path}) catch unreachable,
                user_namespace.slice(),
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
        namespace: JSC.ZigString,
        specifier: JSC.ZigString,
        importer: JSC.ZigString,
        target: JSC.JSGlobalObject.BunPluginTarget,
    ) ?JSC.ErrorableZigString {
        var global = this.global_object;
        const on_resolve_plugin = global.runOnResolvePlugins(
            if (namespace.len > 0 and !namespace.eqlComptime("file"))
                namespace
            else
                JSC.ZigString.init(""),
            specifier,
            importer,
            target,
        ) orelse return null;
        const path_value = on_resolve_plugin.get(global, "path") orelse return null;
        if (path_value.isEmptyOrUndefinedOrNull()) return null;
        if (!path_value.isString()) {
            return JSC.ErrorableZigString.err(
                error.JSErrorObject,
                JSC.ZigString.init("Expected \"path\" to be a string in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        }

        const file_path = path_value.getZigString(global);

        if (file_path.len == 0) {
            return JSC.ErrorableZigString.err(
                error.JSErrorObject,
                JSC.ZigString.init("Expected \"path\" to be a non-empty string in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        } else if
        // TODO: validate this better
        (file_path.eqlComptime(".") or
            file_path.eqlComptime("..") or
            file_path.eqlComptime("...") or
            file_path.eqlComptime(" "))
        {
            return JSC.ErrorableZigString.err(
                error.JSErrorObject,
                JSC.ZigString.init("\"path\" is invalid in onResolve plugin").toErrorInstance(this.global_object).asVoid(),
            );
        }
        var static_namespace = true;
        const user_namespace: JSC.ZigString = brk: {
            if (on_resolve_plugin.get(global, "namespace")) |namespace_value| {
                if (!namespace_value.isString()) {
                    return JSC.ErrorableZigString.err(
                        error.JSErrorObject,
                        JSC.ZigString.init("Expected \"namespace\" to be a string").toErrorInstance(this.global_object).asVoid(),
                    );
                }

                const namespace_str = namespace_value.getZigString(global);
                if (namespace_str.len == 0) {
                    break :brk JSC.ZigString.init("file");
                }

                if (namespace_str.eqlComptime("file")) {
                    break :brk JSC.ZigString.init("file");
                }

                if (namespace_str.eqlComptime("bun")) {
                    break :brk JSC.ZigString.init("bun");
                }

                if (namespace_str.eqlComptime("node")) {
                    break :brk JSC.ZigString.init("node");
                }

                static_namespace = false;

                break :brk namespace_str;
            }

            break :brk JSC.ZigString.init("file");
        };

        // Our super slow way of cloning the string into memory owned by JSC
        var combined_string = std.fmt.allocPrint(
            this.allocator,
            "{any}:{any}",
            .{ user_namespace, file_path },
        ) catch unreachable;
        const out = JSC.ZigString.init(combined_string).toValueGC(this.global_object).getZigString(this.global_object);
        this.allocator.free(combined_string);
        return JSC.ErrorableZigString.ok(out);
    }
};

pub const Bundler = struct {
    options: options.BundleOptions,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    result: options.TransformResult = undefined,
    resolver: Resolver,
    fs: *Fs.FileSystem,
    // thread_pool: *ThreadPool,
    output_files: std.ArrayList(options.OutputFile),
    resolve_results: *ResolveResults,
    resolve_queue: ResolveQueue,
    elapsed: u64 = 0,
    needs_runtime: bool = false,
    router: ?Router = null,

    linker: Linker,
    timer: SystemTimer = undefined,
    env: *DotEnv.Loader,

    macro_context: ?js_ast.Macro.MacroContext = null,

    pub const isCacheEnabled = cache_files;

    pub fn clone(this: *ThisBundler, allocator: std.mem.Allocator, to: *ThisBundler) !void {
        to.* = this.*;
        to.setAllocator(allocator);
        to.log = try allocator.create(logger.Log);
        to.log.* = logger.Log.init(allocator);
        to.setLog(to.log);
        to.macro_context = null;
    }

    pub fn setLog(this: *ThisBundler, log: *logger.Log) void {
        this.log = log;
        this.linker.log = log;
        this.resolver.log = log;
    }

    pub fn setAllocator(this: *ThisBundler, allocator: std.mem.Allocator) void {
        this.allocator = allocator;
        this.linker.allocator = allocator;
        this.resolver.allocator = allocator;
    }

    pub inline fn resolveEntryPoint(bundler: *ThisBundler, entry_point: string) !_resolver.Result {
        return bundler.resolver.resolve(bundler.fs.top_level_dir, entry_point, .entry_point) catch |err| {
            const has_dot_slash_form = !strings.hasPrefix(entry_point, "./") and brk: {
                _ = bundler.resolver.resolve(bundler.fs.top_level_dir, try strings.append(bundler.allocator, "./", entry_point), .entry_point) catch break :brk false;
                break :brk true;
            };

            if (has_dot_slash_form) {
                bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} resolving \"{s}\". Did you mean: \"./{s}\"", .{
                    @errorName(err),
                    entry_point,
                    entry_point,
                }) catch unreachable;
            } else {
                bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} resolving \"{s}\" (entry point)", .{ @errorName(err), entry_point }) catch unreachable;
            }

            return err;
        };
    }

    // to_bundle:

    // thread_pool: *ThreadPool,

    pub fn init(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        env_loader_: ?*DotEnv.Loader,
    ) !ThisBundler {
        js_ast.Expr.Data.Store.create(allocator);
        js_ast.Stmt.Data.Store.create(allocator);
        var fs = try Fs.FileSystem.init1(
            allocator,
            opts.absolute_working_dir,
        );
        const bundle_options = try options.BundleOptions.fromApi(
            allocator,
            fs,
            log,
            opts,
            existing_bundle,
        );

        var env_loader: *DotEnv.Loader = env_loader_ orelse DotEnv.instance orelse brk: {
            var map = try allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(allocator);

            var loader = try allocator.create(DotEnv.Loader);
            loader.* = DotEnv.Loader.init(map, allocator);
            break :brk loader;
        };

        if (DotEnv.instance == null) {
            DotEnv.instance = env_loader;
        }

        env_loader.quiet = log.level == .err;

        // var pool = try allocator.create(ThreadPool);
        // try pool.init(ThreadPool.InitConfig{
        //     .allocator = allocator,
        // });
        var resolve_results = try allocator.create(ResolveResults);
        resolve_results.* = ResolveResults.init(allocator);
        return ThisBundler{
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

    pub fn configureLinkerWithAutoJSX(bundler: *ThisBundler, auto_jsx: bool) void {
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
            // If we don't explicitly pass JSX, try to get it from the root tsconfig
            if (bundler.options.transform_options.jsx == null) {
                // Most of the time, this will already be cached
                if (bundler.resolver.readDirInfo(bundler.fs.top_level_dir) catch null) |root_dir| {
                    if (root_dir.tsconfig_json) |tsconfig| {
                        bundler.options.jsx = tsconfig.jsx;
                    }
                }
            }
        }
    }

    pub fn configureLinker(bundler: *ThisBundler) void {
        bundler.configureLinkerWithAutoJSX(true);
    }

    pub fn runEnvLoader(this: *ThisBundler) !void {
        switch (this.options.env.behavior) {
            .prefix, .load_all => {
                // Step 1. Load the project root.
                var dir: *Fs.FileSystem.DirEntry = ((this.resolver.readDirInfo(this.fs.top_level_dir) catch return) orelse return).getEntries() orelse return;

                // Process always has highest priority.
                this.env.loadProcess();
                if (this.options.production) {
                    try this.env.load(&this.fs.fs, dir, false);
                } else {
                    try this.env.load(&this.fs.fs, dir, true);
                }
            },
            .disable => {
                this.env.loadProcess();
            },
            else => {},
        }

        if (this.env.map.get("DISABLE_BUN_ANALYTICS")) |should_disable| {
            if (strings.eqlComptime(should_disable, "1")) {
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
    pub fn configureDefines(this: *ThisBundler) !void {
        if (this.options.defines_loaded) {
            return;
        }

        if (this.options.platform == .bun_macro) {
            this.options.env.behavior = .prefix;
            this.options.env.prefix = "BUN_";
        }

        try this.runEnvLoader();

        js_ast.Expr.Data.Store.create(this.allocator);
        js_ast.Stmt.Data.Store.create(this.allocator);

        defer js_ast.Expr.Data.Store.reset();
        defer js_ast.Stmt.Data.Store.reset();

        if (this.options.framework) |framework| {
            if (this.options.platform.isClient()) {
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
                this.options.jsx.development = false;

                if (this.options.jsx.import_source.ptr == options.JSX.Pragma.Defaults.ImportSourceDev) {
                    this.options.jsx.import_source = options.JSX.Pragma.Defaults.ImportSource;
                }

                if (options.JSX.Pragma.Defaults.ImportSource == this.options.jsx.import_source.ptr or
                    strings.eqlComptime(this.options.jsx.import_source, comptime options.JSX.Pragma.Defaults.ImportSource) or strings.eqlComptime(this.options.jsx.package_name, "react"))
                {
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

    pub fn configureFramework(
        this: *ThisBundler,
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
                    if (this.options.platform.isClient()) {
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

    pub fn configureFrameworkWithResolveResult(this: *ThisBundler, comptime client: bool) !?_resolver.Result {
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

    pub fn configureRouter(this: *ThisBundler, comptime load_defines: bool) !void {
        try this.configureFramework(load_defines);
        defer {
            if (load_defines) {
                this.configureDefines() catch {};
            }
        }

        // if you pass just a directory, activate the router configured for the pages directory
        // for now:
        // - "." is not supported
        // - multiple pages directories is not supported
        if (!this.options.routes.routes_enabled and this.options.entry_points.len == 1 and !this.options.serve) {

            // When inferring:
            // - pages directory with a file extension is not supported. e.g. "pages.app/" won't work.
            //     This is a premature optimization to avoid this magical auto-detection we do here from meaningfully increasing startup time if you're just passing a file
            //     readDirInfo is a recursive lookup, top-down instead of bottom-up. It opens each folder handle and potentially reads the package.jsons
            // So it is not fast! Unless it's already cached.
            var paths = [_]string{std.mem.trimLeft(u8, this.options.entry_points[0], "./")};
            if (std.mem.indexOfScalar(u8, paths[0], '.') == null) {
                var pages_dir_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var entry = this.fs.absBuf(&paths, &pages_dir_buf);

                if (std.fs.path.extension(entry).len == 0) {
                    bun.constStrToU8(entry).ptr[entry.len] = '/';

                    // Only throw if they actually passed in a route config and the directory failed to load
                    var dir_info_ = this.resolver.readDirInfo(entry) catch return;
                    var dir_info = dir_info_ orelse return;

                    this.options.routes.dir = dir_info.abs_path;
                    this.options.routes.extensions = std.mem.span(&options.RouteConfig.DefaultExtensions);
                    this.options.routes.routes_enabled = true;
                    this.router = try Router.init(this.fs, this.allocator, this.options.routes);
                    try this.router.?.loadRoutes(
                        this.log,
                        dir_info,
                        Resolver,
                        &this.resolver,
                    );
                    this.router.?.routes.client_framework_enabled = this.options.isFrontendFrameworkEnabled();
                    return;
                }
            }
        } else if (this.options.routes.routes_enabled) {
            var dir_info_ = try this.resolver.readDirInfo(this.options.routes.dir);
            var dir_info = dir_info_ orelse return error.MissingRoutesDir;

            this.options.routes.dir = dir_info.abs_path;

            this.router = try Router.init(this.fs, this.allocator, this.options.routes);
            try this.router.?.loadRoutes(this.log, dir_info, Resolver, &this.resolver);
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

    pub fn resetStore(_: *const ThisBundler) void {
        js_ast.Expr.Data.Store.reset();
        js_ast.Stmt.Data.Store.reset();
    }

    pub noinline fn dumpEnvironmentVariables(bundler: *const ThisBundler) void {
        @setCold(true);
        const opts = std.json.StringifyOptions{
            .whitespace = std.json.StringifyOptions.Whitespace{
                .separator = true,
            },
        };
        Output.flush();
        std.json.stringify(bundler.env.map.*, opts, Output.writer()) catch unreachable;
        Output.flush();
    }

    pub const GenerateNodeModulesBundle = @import("./bundler/generate_node_modules_bundle.zig");

    pub const BuildResolveResultPair = struct {
        written: usize,
        input_fd: ?StoredFileDescriptorType,
        empty: bool = false,
    };
    pub fn buildWithResolveResult(
        bundler: *ThisBundler,
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

        var old_bundler_allocator = bundler.allocator;
        bundler.allocator = allocator;
        defer bundler.allocator = old_bundler_allocator;
        var old_linker_allocator = bundler.linker.allocator;
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

                if (bundler.options.platform.isBun()) {
                    try bundler.linker.link(file_path, &result, origin, import_path_format, false, true);
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
                            ),
                            .cjs => try bundler.printWithSourceMapMaybe(
                                result.ast,
                                &result.source,
                                Writer,
                                writer,
                                .cjs_ascii,
                                is_source_map,
                                source_map_handler,
                            ),
                            else => unreachable,
                        },
                        .input_fd = result.input_fd,
                    };
                }

                try bundler.linker.link(file_path, &result, origin, import_path_format, false, false);

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
                        ),
                        .cjs => try bundler.printWithSourceMapMaybe(
                            result.ast,
                            &result.source,
                            Writer,
                            writer,
                            .cjs,
                            is_source_map,
                            source_map_handler,
                        ),
                        else => unreachable,
                    },
                    .input_fd = result.input_fd,
                };
            },
        }
    }

    pub fn buildWithResolveResultEager(
        bundler: *ThisBundler,
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
            .input = file_path,
            .loader = loader,
            .value = undefined,
        };

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

        switch (loader) {
            .jsx, .tsx, .js, .ts, .json, .toml => {
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
                    },
                    client_entry_point_,
                ) orelse {
                    return null;
                };
                if (!bundler.options.platform.isBun())
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

                output_file.size = switch (bundler.options.platform) {
                    .neutral, .browser, .node => try bundler.print(
                        result,
                        js_printer.FileWriter,
                        js_printer.NewFileWriter(file),
                        .esm,
                    ),
                    .bun, .bun_macro => try bundler.print(
                        result,
                        js_printer.FileWriter,
                        js_printer.NewFileWriter(file),
                        .esm_ascii,
                    ),
                };

                var file_op = options.OutputFile.FileOperation.fromFile(file.handle, file_path.pretty);

                file_op.fd = file.handle;

                file_op.is_tmpdir = false;

                if (Outstream == std.fs.Dir) {
                    file_op.dir = outstream.fd;

                    if (bundler.fs.fs.needToCloseFiles()) {
                        file.close();
                        file_op.fd = 0;
                    }
                }

                output_file.value = .{ .move = file_op };
            },
            .css => {
                const CSSBuildContext = struct {
                    origin: URL,
                };
                var build_ctx = CSSBuildContext{ .origin = bundler.options.origin };

                const BufferedWriter = std.io.CountingWriter(std.io.BufferedWriter(8096, std.fs.File.Writer));
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

                const _file = Fs.File{ .path = file_path, .contents = entry.contents };
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

                file_op.fd = file.handle;

                file_op.is_tmpdir = false;

                if (Outstream == std.fs.Dir) {
                    file_op.dir = outstream.fd;

                    if (bundler.fs.fs.needToCloseFiles()) {
                        file.close();
                        file_op.fd = 0;
                    }
                }

                output_file.value = .{ .move = file_op };
            },
            .wasm, .file, .napi => {
                var hashed_name = try bundler.linker.getHashedFilename(file_path, null);
                var pathname = try bundler.allocator.alloc(u8, hashed_name.len + file_path.name.ext.len);
                std.mem.copy(u8, pathname, hashed_name);
                std.mem.copy(u8, pathname[hashed_name.len..], file_path.name.ext);
                const dir = if (bundler.options.output_dir_handle) |output_handle| output_handle.fd else 0;

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
        bundler: *ThisBundler,
        ast: js_ast.Ast,
        source: *const logger.Source,
        comptime Writer: type,
        writer: Writer,
        comptime format: js_printer.Format,
        comptime enable_source_map: bool,
        source_map_context: ?js_printer.SourceMapHandler,
    ) !usize {
        var symbols: [][]js_ast.Symbol = &([_][]js_ast.Symbol{ast.symbols});

        return switch (format) {
            .cjs => try js_printer.printCommonJS(
                Writer,
                writer,
                ast,
                js_ast.Symbol.Map.initList(symbols),
                source,
                false,
                js_printer.Options{
                    .to_module_ref = Ref.RuntimeRef,
                    .externals = ast.externals,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .css_import_behavior = bundler.options.cssImportBehavior(),
                    .source_map_handler = source_map_context,
                    .rewrite_require_resolve = bundler.options.platform != .node,
                },
                Linker,
                &bundler.linker,
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
                    .to_module_ref = Ref.RuntimeRef,
                    .externals = ast.externals,
                    .runtime_imports = ast.runtime_imports,
                    .require_ref = ast.require_ref,
                    .source_map_handler = source_map_context,
                    .css_import_behavior = bundler.options.cssImportBehavior(),
                    .rewrite_require_resolve = bundler.options.platform != .node,
                },
                Linker,
                &bundler.linker,
                enable_source_map,
            ),
            .esm_ascii => if (bundler.options.platform.isBun())
                try js_printer.printAst(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    true,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .rewrite_require_resolve = bundler.options.platform != .node,
                    },
                    Linker,
                    &bundler.linker,
                    enable_source_map,
                )
            else
                try js_printer.printAst(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .rewrite_require_resolve = bundler.options.platform != .node,
                    },
                    Linker,
                    &bundler.linker,
                    enable_source_map,
                ),
            .cjs_ascii => if (bundler.options.platform.isBun())
                try js_printer.printCommonJS(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    true,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .rewrite_require_resolve = bundler.options.platform != .node,
                    },
                    Linker,
                    &bundler.linker,
                    enable_source_map,
                )
            else
                try js_printer.printCommonJS(
                    Writer,
                    writer,
                    ast,
                    js_ast.Symbol.Map.initList(symbols),
                    source,
                    false,
                    js_printer.Options{
                        .to_module_ref = Ref.RuntimeRef,
                        .externals = ast.externals,
                        .runtime_imports = ast.runtime_imports,
                        .require_ref = ast.require_ref,
                        .css_import_behavior = bundler.options.cssImportBehavior(),
                        .source_map_handler = source_map_context,
                        .rewrite_require_resolve = bundler.options.platform != .node,
                    },
                    Linker,
                    &bundler.linker,
                    enable_source_map,
                ),
        };
    }

    pub fn print(
        bundler: *ThisBundler,
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
        );
    }

    pub fn printWithSourceMap(
        bundler: *ThisBundler,
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
        );
    }

    pub const ParseOptions = struct {
        allocator: std.mem.Allocator,
        dirname_fd: StoredFileDescriptorType,
        file_descriptor: ?StoredFileDescriptorType = null,
        file_hash: ?u32 = null,
        path: Fs.Path,
        loader: options.Loader,
        jsx: options.JSX.Pragma,
        macro_remappings: MacroRemap,
        macro_js_ctx: MacroJSValueType = default_macro_js_value,
        virtual_source: ?*const logger.Source = null,
        replace_exports: runtime.Runtime.Features.ReplaceableExport.Map = .{},
        hoist_bun_plugin: bool = false,
    };

    pub fn parse(
        bundler: *ThisBundler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
    ) ?ParseResult {
        return parseMaybeReturnFileOnly(bundler, this_parse, client_entry_point_, false);
    }

    pub fn parseMaybeReturnFileOnly(
        bundler: *ThisBundler,
        this_parse: ParseOptions,
        client_entry_point_: anytype,
        comptime return_file_only: bool,
    ) ?ParseResult {
        var allocator = this_parse.allocator;
        const dirname_fd = this_parse.dirname_fd;
        const file_descriptor = this_parse.file_descriptor;
        const file_hash = this_parse.file_hash;
        const path = this_parse.path;
        const loader = this_parse.loader;

        if (FeatureFlags.tracing) {
            bundler.timer.reset();
        }
        defer {
            if (FeatureFlags.tracing) {
                bundler.elapsed += bundler.timer.read();
            }
        }
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

            const entry = bundler.resolver.caches.fs.readFile(
                bundler.fs,
                path.text,
                dirname_fd,
                true,
                file_descriptor,
            ) catch |err| {
                bundler.log.addErrorFmt(null, logger.Loc.Empty, bundler.allocator, "{s} reading \"{s}\"", .{ @errorName(err), path.text }) catch {};
                return null;
            };
            input_fd = entry.fd;
            break :brk logger.Source.initRecycledFile(Fs.File{ .path = path, .contents = entry.contents }, bundler.allocator) catch return null;
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
                const platform = bundler.options.platform;

                var jsx = this_parse.jsx;
                jsx.parse = loader.isJSX();

                var opts = js_parser.Parser.Options.init(jsx, loader);
                opts.enable_bundling = false;
                opts.transform_require_to_import = bundler.options.allow_runtime and !bundler.options.platform.isBun();
                opts.features.allow_runtime = bundler.options.allow_runtime;
                opts.features.trim_unused_imports = bundler.options.trim_unused_imports orelse loader.isTypeScript();
                opts.features.should_fold_numeric_constants = platform.isBun();
                opts.features.dynamic_require = platform.isBun();

                opts.can_import_from_bundle = bundler.options.node_modules_bundle != null;

                opts.tree_shaking = bundler.options.tree_shaking;

                // HMR is enabled when devserver is running
                // unless you've explicitly disabled it
                // or you're running in SSR
                // or the file is a node_module
                opts.features.hot_module_reloading = bundler.options.hot_module_reloading and
                    platform.isNotBun() and
                    (!opts.can_import_from_bundle or
                    (opts.can_import_from_bundle and !path.isNodeModule()));
                opts.features.react_fast_refresh = opts.features.hot_module_reloading and
                    jsx.parse and
                    bundler.options.jsx.supports_fast_refresh;
                opts.filepath_hash_for_hmr = file_hash orelse 0;
                opts.features.auto_import_jsx = bundler.options.auto_import_jsx;
                opts.warn_about_unbundled_modules = platform.isNotBun();
                opts.features.jsx_optimization_inline = (bundler.options.jsx_optimization_inline orelse (platform.isBun() and jsx.parse and
                    !jsx.development)) and
                    (jsx.runtime == .automatic or jsx.runtime == .classic);

                opts.features.jsx_optimization_hoist = bundler.options.jsx_optimization_hoist orelse opts.features.jsx_optimization_inline;
                opts.features.hoist_bun_plugin = this_parse.hoist_bun_plugin;
                if (bundler.macro_context == null) {
                    bundler.macro_context = js_ast.Macro.MacroContext.init(bundler);
                }

                // we'll just always enable top-level await
                // this is incorrect for Node.js files which are CommonJS modules
                opts.features.top_level_await = true;

                opts.macro_context = &bundler.macro_context.?;
                if (comptime !JSC.is_bindgen) {
                    if (platform != .bun_macro) {
                        opts.macro_context.javascript_object = this_parse.macro_js_ctx;
                    }
                }

                opts.features.is_macro_runtime = platform == .bun_macro;
                opts.features.replace_exports = this_parse.replace_exports;

                const value = (bundler.resolver.caches.js.parse(
                    allocator,
                    opts,
                    bundler.options.define,
                    bundler.log,
                    &source,
                ) catch null) orelse return null;
                return ParseResult{
                    .ast = value,
                    .source = source,
                    .loader = loader,
                    .input_fd = input_fd,
                };
            },
            .json => {
                var expr = json_parser.ParseJSON(&source, bundler.log, allocator) catch return null;
                var stmt = js_ast.Stmt.alloc(js_ast.S.ExportDefault, js_ast.S.ExportDefault{
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
            .toml => {
                var expr = TOML.parse(&source, bundler.log, allocator) catch return null;
                var stmt = js_ast.Stmt.alloc(js_ast.S.ExportDefault, js_ast.S.ExportDefault{
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
                if (bundler.options.platform.isBun()) {
                    if (source.contents.len < 4 or @bitCast(u32, source.contents[0..4].*) != @bitCast(u32, [4]u8{ 0, 'a', 's', 'm' })) {
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
            else => Global.panic("Unsupported loader {s} for path: {s}", .{ loader, source.path.text }),
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
        bundler: *ThisBundler,
        log: *logger.Log,
        path_to_use_: string,
        comptime client_entry_point_enabled: bool,
    ) !ServeResult {
        var old_log = bundler.log;

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
            @memcpy(tmp_buildfile_buf3[2..], path_to_use.ptr, path_to_use.len);
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
                    var len: usize = trail_dir.len;
                    std.mem.copy(u8, tmp_buildfile_buf2[0..len], trail_dir);

                    std.mem.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname_pathname.base);
                    len += absolute_pathname_pathname.base.len;
                    std.mem.copy(u8, tmp_buildfile_buf2[len..], absolute_pathname.ext);
                    len += absolute_pathname.ext.len;
                    std.debug.assert(len > 0);
                    const decoded_entry_point_path = tmp_buildfile_buf2[0..len];
                    break :brk (try bundler.resolver.resolve(bundler.fs.top_level_dir, decoded_entry_point_path, .entry_point));
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
                var abs_path = path.text;
                const file = try std.fs.openFileAbsolute(abs_path, .{ .mode = .read_only });
                var stat = try file.stat();
                return ServeResult{
                    .file = options.OutputFile.initFile(file, abs_path, stat.size),
                    .mime_type = MimeType.byLoader(
                        loader,
                        mime_type_ext[1..],
                    ),
                };
            },
        }
    }

    pub fn normalizeEntryPointPath(bundler: *ThisBundler, _entry: string) string {
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
            std.mem.copy(u8, __entry[2..__entry.len], entry);
            entry = __entry;
        }

        return entry;
    }

    fn enqueueEntryPoints(bundler: *ThisBundler, entry_points: []_resolver.Result, comptime normalize_entry_point: bool) usize {
        var entry_point_i: usize = 0;

        for (bundler.options.entry_points) |_entry| {
            var entry: string = if (comptime normalize_entry_point) bundler.normalizeEntryPointPath(_entry) else _entry;

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

    pub fn bundle(
        allocator: std.mem.Allocator,
        log: *logger.Log,
        opts: Api.TransformOptions,
    ) !options.TransformResult {
        var bundler = try ThisBundler.init(allocator, log, opts, null, null);
        bundler.configureLinker();
        try bundler.configureRouter(false);
        try bundler.configureDefines();
        bundler.macro_context = js_ast.Macro.MacroContext.init(&bundler);

        var skip_normalize = false;
        var load_from_routes = false;
        if (bundler.options.routes.routes_enabled and bundler.options.entry_points.len == 0) {
            if (bundler.router) |router| {
                bundler.options.entry_points = try router.getEntryPoints();
                skip_normalize = true;
                load_from_routes = true;
            }
        }

        //  100.00 µs std.fifo.LinearFifo(resolver.Result,std.fifo.LinearFifoBufferType { .Dynamic = {}}).writeItemAssumeCapacity
        if (bundler.options.resolve_mode != .lazy) {
            try bundler.resolve_queue.ensureUnusedCapacity(3);
        }

        var entry_points = try allocator.alloc(_resolver.Result, bundler.options.entry_points.len);
        if (skip_normalize) {
            entry_points = entry_points[0..bundler.enqueueEntryPoints(entry_points, false)];
        } else {
            entry_points = entry_points[0..bundler.enqueueEntryPoints(entry_points, true)];
        }

        if (log.level == .verbose) {
            bundler.resolver.debug_logs = try DebugLogs.init(allocator);
        }

        var did_start = false;

        if (bundler.options.output_dir_handle == null) {
            const outstream = std.io.getStdOut();

            if (load_from_routes) {
                if (bundler.options.framework) |*framework| {
                    if (framework.client.isEnabled()) {
                        did_start = true;
                        try switch (bundler.options.import_path_format) {
                            .relative => bundler.processResolveQueue(.relative, true, @TypeOf(outstream), outstream),
                            .absolute_url => bundler.processResolveQueue(.absolute_url, true, @TypeOf(outstream), outstream),
                            .absolute_path => bundler.processResolveQueue(.absolute_path, true, @TypeOf(outstream), outstream),
                            .package_path => bundler.processResolveQueue(.package_path, true, @TypeOf(outstream), outstream),
                        };
                    }
                }
            }

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

            if (load_from_routes) {
                if (bundler.options.framework) |*framework| {
                    if (framework.client.isEnabled()) {
                        did_start = true;
                        try switch (bundler.options.import_path_format) {
                            .relative => bundler.processResolveQueue(.relative, true, std.fs.Dir, output_dir),
                            .absolute_url => bundler.processResolveQueue(.absolute_url, true, std.fs.Dir, output_dir),
                            .absolute_path => bundler.processResolveQueue(.absolute_path, true, std.fs.Dir, output_dir),
                            .package_path => bundler.processResolveQueue(.package_path, true, std.fs.Dir, output_dir),
                        };
                    }
                }
            }

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
            try bundler.output_files.append(
                options.OutputFile.initBuf(runtime.Runtime.sourceContent(false), Linker.runtime_source_path, .js),
            );
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

        var final_result = try options.TransformResult.init(try allocator.dupe(u8, bundler.result.outbase), bundler.output_files.toOwnedSlice(), log, allocator);
        final_result.root_dir = bundler.options.output_dir_handle;
        return final_result;
    }

    // pub fn processResolveQueueWithThreadPool(bundler)

    pub fn processResolveQueue(
        bundler: *ThisBundler,
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
                var path = item.pathConst() orelse unreachable;
                const loader = bundler.options.loader(path.name.ext);

                if (item.import_kind == .entry_point and loader.supportsClientEntryPoint()) {
                    var client_entry_point = try bundler.allocator.create(EntryPoints.ClientEntryPoint);
                    client_entry_point.* = EntryPoints.ClientEntryPoint{};
                    try client_entry_point.generate(ThisBundler, bundler, path.name, bundler.options.framework.?.client.path);

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
