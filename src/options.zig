const std = @import("std");
const logger = @import("logger.zig");
const Fs = @import("fs.zig");
const alloc = @import("alloc.zig");
const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const defines = @import("./defines.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;

usingnamespace @import("global.zig");

const assert = std.debug.assert;

pub const WriteDestination = enum {
    stdout,
    disk,
    // eventaully: wasm
};

pub fn validatePath(log: *logger.Log, fs: *Fs.FileSystem.Implementation, cwd: string, rel_path: string, allocator: *std.mem.Allocator, path_kind: string) string {
    if (rel_path.len == 0) {
        return "";
    }
    const paths = [_]string{ cwd, rel_path };
    const out = std.fs.path.resolve(allocator, &paths) catch |err| {
        log.addErrorFmt(null, logger.Loc{}, allocator, "Invalid {s}: {s}", .{ path_kind, rel_path }) catch unreachable;
        Global.panic("", .{});
    };

    return out;
}

pub fn stringHashMapFromArrays(comptime t: type, allocator: *std.mem.Allocator, keys: anytype, values: anytype) !t {
    var hash_map = t.init(allocator);
    if (keys.len > 0) {
        try hash_map.ensureCapacity(@intCast(u32, keys.len));
        for (keys) |key, i| {
            try hash_map.put(key, values[i]);
        }
    }

    return hash_map;
}

pub const ExternalModules = struct {
    node_modules: std.BufSet,
    abs_paths: std.BufSet,
    patterns: []WildcardPattern,
    pub const WildcardPattern = struct {
        prefix: string,
        suffix: string,
    };

    pub fn isNodeBuiltin(str: string) bool {
        return NodeBuiltinsMap.has(str);
    }

    pub fn init(
        allocator: *std.mem.Allocator,
        fs: *Fs.FileSystem.Implementation,
        cwd: string,
        externals: []const string,
        log: *logger.Log,
        platform: Platform,
    ) ExternalModules {
        var result = ExternalModules{
            .node_modules = std.BufSet.init(allocator),
            .abs_paths = std.BufSet.init(allocator),
            .patterns = &([_]WildcardPattern{}),
        };

        if (platform == .node) {
            // TODO: fix this stupid copy
            result.node_modules.hash_map.ensureCapacity(NodeBuiltinPatterns.len) catch unreachable;
            for (NodeBuiltinPatterns) |pattern| {
                result.node_modules.insert(pattern) catch unreachable;
            }
        }

        if (externals.len == 0) {
            return result;
        }

        var patterns = std.ArrayList(WildcardPattern).init(allocator);

        for (externals) |external| {
            const path = external;
            if (strings.indexOfChar(path, '*')) |i| {
                if (strings.indexOfChar(path[i + 1 .. path.len], '*') != null) {
                    log.addErrorFmt(null, logger.Loc.Empty, allocator, "External path \"{s}\" cannot have more than one \"*\" wildcard", .{external}) catch unreachable;
                    return result;
                }

                patterns.append(WildcardPattern{
                    .prefix = external[0..i],
                    .suffix = external[i + 1 .. external.len],
                }) catch unreachable;
            } else if (resolver.isPackagePath(external)) {
                result.node_modules.insert(external) catch unreachable;
            } else {
                const normalized = validatePath(log, fs, cwd, external, allocator, "external path");

                if (normalized.len > 0) {
                    result.abs_paths.insert(normalized) catch unreachable;
                }
            }
        }

        result.patterns = patterns.toOwnedSlice();

        return result;
    }

    pub const NodeBuiltinPatterns = [_]string{
        "_http_agent",
        "_http_client",
        "_http_common",
        "_http_incoming",
        "_http_outgoing",
        "_http_server",
        "_stream_duplex",
        "_stream_passthrough",
        "_stream_readable",
        "_stream_transform",
        "_stream_wrap",
        "_stream_writable",
        "_tls_common",
        "_tls_wrap",
        "assert",
        "async_hooks",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "diagnostics_channel",
        "dns",
        "domain",
        "events",
        "fs",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "sys",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "wasi",
        "worker_threads",
        "zlib",
    };

    pub const NodeBuiltinsMap = std.ComptimeStringMap(bool, .{
        .{ "_http_agent", true },
        .{ "_http_client", true },
        .{ "_http_common", true },
        .{ "_http_incoming", true },
        .{ "_http_outgoing", true },
        .{ "_http_server", true },
        .{ "_stream_duplex", true },
        .{ "_stream_passthrough", true },
        .{ "_stream_readable", true },
        .{ "_stream_transform", true },
        .{ "_stream_wrap", true },
        .{ "_stream_writable", true },
        .{ "_tls_common", true },
        .{ "_tls_wrap", true },
        .{ "assert", true },
        .{ "async_hooks", true },
        .{ "buffer", true },
        .{ "child_process", true },
        .{ "cluster", true },
        .{ "console", true },
        .{ "constants", true },
        .{ "crypto", true },
        .{ "dgram", true },
        .{ "diagnostics_channel", true },
        .{ "dns", true },
        .{ "domain", true },
        .{ "events", true },
        .{ "fs", true },
        .{ "http", true },
        .{ "http2", true },
        .{ "https", true },
        .{ "inspector", true },
        .{ "module", true },
        .{ "net", true },
        .{ "os", true },
        .{ "path", true },
        .{ "perf_hooks", true },
        .{ "process", true },
        .{ "punycode", true },
        .{ "querystring", true },
        .{ "readline", true },
        .{ "repl", true },
        .{ "stream", true },
        .{ "string_decoder", true },
        .{ "sys", true },
        .{ "timers", true },
        .{ "tls", true },
        .{ "trace_events", true },
        .{ "tty", true },
        .{ "url", true },
        .{ "util", true },
        .{ "v8", true },
        .{ "vm", true },
        .{ "wasi", true },
        .{ "worker_threads", true },
        .{ "zlib", true },
    });
};

pub const ModuleType = enum {
    unknown,
    cjs,
    esm,

    pub const List = std.ComptimeStringMap(ModuleType, .{
        .{ "commonjs", ModuleType.cjs },
        .{ "module", ModuleType.esm },
    });
};

pub const Platform = enum {
    neutral,
    browser,
    speedy,
    node,

    pub fn implementsRequire(platform: Platform) bool {
        return switch (platform) {
            .speedy, .node => true,
            else => false,
        };
    }

    pub const Extensions = struct {
        pub const In = struct {
            pub const JavaScript = [_]string{ ".js", ".ts", ".tsx", ".jsx", ".json" };
        };
        pub const Out = struct {
            pub const JavaScript = [_]string{
                ".js",
                ".mjs",
            };
        };
    };

    pub fn outExtensions(platform: Platform, allocator: *std.mem.Allocator) std.StringHashMap(string) {
        var exts = std.StringHashMap(string).init(allocator);

        const js = Extensions.Out.JavaScript[0];
        const mjs = Extensions.Out.JavaScript[1];

        if (platform == .node) {
            for (Extensions.In.JavaScript) |ext| {
                exts.put(ext, mjs) catch unreachable;
            }
        } else {
            exts.put(mjs, js) catch unreachable;
        }

        for (Extensions.In.JavaScript) |ext| {
            exts.put(ext, js) catch unreachable;
        }

        return exts;
    }

    pub fn from(plat: ?api.Api.Platform) Platform {
        return switch (plat orelse api.Api.Platform._none) {
            .node => .node,
            .browser => .browser,
            .speedy => .speedy,
            else => .browser,
        };
    }

    const MAIN_FIELD_NAMES = [_]string{ "browser", "module", "main" };
    pub const DefaultMainFields: std.EnumArray(Platform, []const string) = {
        var array = std.EnumArray(Platform, []const string).initUndefined();

        // Note that this means if a package specifies "module" and "main", the ES6
        // module will not be selected. This means tree shaking will not work when
        // targeting node environments.
        //
        // This is unfortunately necessary for compatibility. Some packages
        // incorrectly treat the "module" field as "code for the browser". It
        // actually means "code for ES6 environments" which includes both node
        // and the browser.
        //
        // For example, the package "@firebase/app" prints a warning on startup about
        // the bundler incorrectly using code meant for the browser if the bundler
        // selects the "module" field instead of the "main" field.
        //
        // If you want to enable tree shaking when targeting node, you will have to
        // configure the main fields to be "module" and then "main". Keep in mind
        // that some packages may break if you do this.
        var list = [_]string{ MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[2] };
        array.set(Platform.node, &list);

        // Note that this means if a package specifies "main", "module", and
        // "browser" then "browser" will win out over "module". This is the
        // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
        //
        // This is deliberate because the presence of the "browser" field is a
        // good signal that the "module" field may have non-browser stuff in it,
        // which will crash or fail to be bundled when targeting the browser.
        var listc = [_]string{ MAIN_FIELD_NAMES[0], MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[2] };
        array.set(Platform.browser, &listc);
        array.set(Platform.speedy, &listc);

        // The neutral platform is for people that don't want esbuild to try to
        // pick good defaults for their platform. In that case, the list of main
        // fields is empty by default. You must explicitly configure it yourself.
        array.set(Platform.neutral, &([_]string{}));

        return array;
    };
};

pub const Loader = enum {
    jsx,
    js,
    ts,
    tsx,
    css,
    file,
    json,

    pub fn toAPI(loader: Loader) Api.Loader {
        return switch (loader) {
            .jsx => .jsx,
            .js => .js,
            .ts => .ts,
            .tsx => .tsx,
            .css => .css,
            .json => .json,
            else => .file,
        };
    }

    pub fn isJSX(loader: Loader) bool {
        return loader == .jsx or loader == .tsx;
    }
    pub fn isTypeScript(loader: Loader) bool {
        return loader == .tsx or loader == .ts;
    }

    pub fn forFileName(filename: string, obj: anytype) ?Loader {
        const ext = std.fs.path.extension(filename);
        if (ext.len == 0 or (ext.len == 1 and ext[0] == '.')) return null;

        return obj.get(ext);
    }
};

pub const defaultLoaders = std.ComptimeStringMap(Loader, .{
    .{ ".jsx", Loader.jsx },
    .{ ".json", Loader.json },
    .{ ".js", Loader.jsx },
    .{ ".mjs", Loader.js },
    .{ ".css", Loader.css },
    .{ ".ts", Loader.ts },
    .{ ".tsx", Loader.tsx },
});

pub const JSX = struct {
    pub const Pragma = struct {
        // these need to be arrays
        factory: []const string = &(Defaults.Factory),
        fragment: []const string = &(Defaults.Fragment),
        runtime: JSX.Runtime = JSX.Runtime.automatic,

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        import_source: string = "react/jsx-dev-runtime",
        classic_import_source: string = "react",
        package_name: []const u8 = "react",
        supports_fast_refresh: bool = false,

        jsx: string = "jsxDEV",

        development: bool = true,
        parse: bool = true,

        pub fn parsePackageName(str: string) string {
            if (str[0] == '@') {
                if (strings.indexOfChar(str[1..], '/')) |first_slash| {
                    var remainder = str[1 + first_slash + 1 ..];

                    if (strings.indexOfChar(remainder, '/')) |last_slash| {
                        return str[0 .. first_slash + 1 + last_slash + 1];
                    }
                }
            }

            if (strings.indexOfChar(str, '/')) |first_slash| {
                return str[0..first_slash];
            }

            return str;
        }

        pub fn isReactLike(pragma: *const Pragma) bool {
            return strings.eqlComptime(pragma.package_name, "react") or strings.eqlComptime(pragma.package_name, "@emotion/jsx") or strings.eqlComptime(pragma.package_name, "@emotion/react");
        }

        pub const Defaults = struct {
            pub var Factory = [_]string{ "React", "createElement" };
            pub var Fragment = [_]string{ "React", "Fragment" };
            pub const ImportSourceDev = "react/jsx-dev-runtime";
            pub const ImportSource = "react/jsx-runtime";
            pub const JSXFunction = "jsx";
            pub const JSXFunctionDev = "jsxDEV";
        };

        // "React.createElement" => ["React", "createElement"]
        // ...unless new is "React.createElement" and original is ["React", "createElement"]
        // saves an allocation for the majority case
        pub fn memberListToComponentsIfDifferent(allocator: *std.mem.Allocator, original: []const string, new: string) ![]const string {
            var splitter = std.mem.split(new, ".");

            var needs_alloc = false;
            var count: usize = 0;
            while (splitter.next()) |str| {
                const i = (splitter.index orelse break);
                count = i;
                if (i > original.len) {
                    needs_alloc = true;
                    break;
                }

                if (!strings.eql(original[i], str)) {
                    needs_alloc = true;
                    break;
                }
            }

            if (!needs_alloc) {
                return original;
            }

            var out = try allocator.alloc(string, count + 1);

            splitter = std.mem.split(new, ".");
            var i: usize = 0;
            while (splitter.next()) |str| {
                out[i] = str;
                i += 1;
            }
            return out;
        }

        pub fn fromApi(jsx: api.Api.Jsx, allocator: *std.mem.Allocator) !Pragma {
            var pragma = JSX.Pragma{};

            if (jsx.fragment.len > 0) {
                pragma.fragment = try memberListToComponentsIfDifferent(allocator, pragma.fragment, jsx.fragment);
            }

            if (jsx.factory.len > 0) {
                pragma.factory = try memberListToComponentsIfDifferent(allocator, pragma.factory, jsx.factory);
            }

            if (jsx.import_source.len > 0) {
                pragma.import_source = jsx.import_source;
                pragma.package_name = parsePackageName(pragma.import_source);
                pragma.supports_fast_refresh = pragma.development and pragma.isReactLike();
            } else if (jsx.development) {
                pragma.import_source = Defaults.ImportSourceDev;
                pragma.jsx = Defaults.JSXFunctionDev;
                pragma.supports_fast_refresh = true;
                pragma.package_name = "react";
            } else {
                pragma.import_source = Defaults.ImportSource;
                pragma.jsx = Defaults.JSXFunction;
                pragma.supports_fast_refresh = false;
            }

            pragma.development = jsx.development;
            pragma.runtime = jsx.runtime;
            pragma.parse = true;
            return pragma;
        }
    };

    pub const Runtime = api.Api.JsxRuntime;
};

const TypeScript = struct {
    parse: bool = false,
};

pub const Timings = struct {
    resolver: i128 = 0,
    parse: i128 = 0,
    print: i128 = 0,
    http: i128 = 0,
    read_file: i128 = 0,
};

pub const DefaultUserDefines = struct {
    pub const HotModuleReloading = struct {
        pub const Key = "process.env.SPEEDY_HMR_ENABLED";
        pub const Value = "true";
    };
    pub const HotModuleReloadingVerbose = struct {
        pub const Key = "process.env.SPEEDY_HMR_VERBOSE";
        pub const Value = "true";
    };
    // This must be globally scoped so it doesn't disappear
    pub const NodeEnv = struct {
        pub const Key = "process.env.NODE_ENV";
        pub const Value = "\"development\"";
    };
};

pub fn definesFromTransformOptions(allocator: *std.mem.Allocator, log: *logger.Log, _input_define: ?Api.StringMap, hmr: bool) !*defines.Define {
    var input_user_define = _input_define orelse std.mem.zeroes(Api.StringMap);

    var user_defines = try stringHashMapFromArrays(
        defines.RawDefines,
        allocator,
        input_user_define.keys,
        input_user_define.values,
    );
    if (input_user_define.keys.len == 0) {
        try user_defines.put(DefaultUserDefines.NodeEnv.Key, DefaultUserDefines.NodeEnv.Value);
    }

    if (hmr) {
        try user_defines.put(DefaultUserDefines.HotModuleReloading.Key, DefaultUserDefines.HotModuleReloading.Value);
    }

    var resolved_defines = try defines.DefineData.from_input(user_defines, log, allocator);
    return try defines.Define.init(
        allocator,
        resolved_defines,
    );
}

pub fn loadersFromTransformOptions(allocator: *std.mem.Allocator, _loaders: ?Api.LoaderMap) !std.StringHashMap(Loader) {
    var input_loaders = _loaders orelse std.mem.zeroes(Api.LoaderMap);
    var loader_values = try allocator.alloc(Loader, input_loaders.loaders.len);
    for (loader_values) |_, i| {
        const loader = switch (input_loaders.loaders[i]) {
            .jsx => Loader.jsx,
            .js => Loader.js,
            .ts => Loader.ts,
            .css => Loader.css,
            .tsx => Loader.tsx,
            .json => Loader.json,
            else => unreachable,
        };

        loader_values[i] = loader;
    }

    var loaders = try stringHashMapFromArrays(
        std.StringHashMap(Loader),
        allocator,
        input_loaders.extensions,
        loader_values,
    );
    const default_loader_ext = comptime [_]string{ ".jsx", ".json", ".js", ".mjs", ".css", ".ts", ".tsx" };

    inline for (default_loader_ext) |ext| {
        if (!loaders.contains(ext)) {
            try loaders.put(ext, defaultLoaders.get(ext).?);
        }
    }

    return loaders;
}

pub const BundleOptions = struct {
    footer: string = "",
    banner: string = "",
    define: *defines.Define,
    loaders: std.StringHashMap(Loader),
    resolve_dir: string = "/",
    jsx: JSX.Pragma = JSX.Pragma{},

    hot_module_reloading: bool = false,
    inject: ?[]string = null,
    public_url: string = "",
    public_dir: string = "public",
    public_dir_enabled: bool = true,
    output_dir: string = "",
    output_dir_handle: ?std.fs.Dir = null,
    node_modules_bundle_url: string = "",
    public_dir_handle: ?std.fs.Dir = null,
    write: bool = false,
    preserve_symlinks: bool = false,
    preserve_extensions: bool = false,
    timings: Timings = Timings{},
    node_modules_bundle: ?*NodeModuleBundle = null,

    append_package_version_in_query_string: bool = false,

    resolve_mode: api.Api.ResolveMode,
    tsconfig_override: ?string = null,
    platform: Platform = Platform.browser,
    main_fields: []const string = Platform.DefaultMainFields.get(Platform.browser),
    log: *logger.Log,
    external: ExternalModules = ExternalModules{},
    entry_points: []const string,
    extension_order: []const string = &Defaults.ExtensionOrder,
    out_extensions: std.StringHashMap(string),
    import_path_format: ImportPathFormat = ImportPathFormat.relative,

    pub fn asJavascriptBundleConfig(this: *const BundleOptions) Api.JavascriptBundleConfig {}

    pub const ImportPathFormat = enum {
        relative,
        // omit file extension for Node.js packages
        relative_nodejs,
        absolute_url,
        // omit file extension
        absolute_path,
        package_path,
    };

    pub const Defaults = struct {
        pub var ExtensionOrder = [_]string{ ".tsx", ".ts", ".jsx", ".js", ".json", ".css" };
    };

    pub fn fromApi(allocator: *std.mem.Allocator, fs: *Fs.FileSystem, log: *logger.Log, transform: Api.TransformOptions, node_modules_bundle_existing: ?*NodeModuleBundle) !BundleOptions {
        const output_dir_parts = [_]string{ try std.process.getCwdAlloc(allocator), transform.output_dir orelse "out" };
        var opts: BundleOptions = BundleOptions{
            .log = log,
            .resolve_mode = transform.resolve orelse .dev,
            .define = try definesFromTransformOptions(allocator, log, transform.define, transform.serve orelse false),
            .loaders = try loadersFromTransformOptions(allocator, transform.loaders),
            .output_dir = try fs.absAlloc(allocator, &output_dir_parts),
            .platform = Platform.from(transform.platform),
            .write = transform.write orelse false,
            .external = undefined,
            .entry_points = transform.entry_points,
            .out_extensions = undefined,
        };

        if (transform.public_url) |public_url| {
            opts.import_path_format = ImportPathFormat.absolute_url;
            opts.public_url = public_url;
        }

        if (transform.jsx) |jsx| {
            opts.jsx = try JSX.Pragma.fromApi(jsx, allocator);
        }

        if (transform.extension_order.len > 0) {
            opts.extension_order = transform.extension_order;
        }

        if (transform.platform) |plat| {
            opts.platform = Platform.from(plat);
            opts.main_fields = Platform.DefaultMainFields.get(opts.platform);
        }

        switch (opts.platform) {
            .node => {
                opts.import_path_format = .relative_nodejs;
            },
            .speedy => {
                // If we're doing SSR, we want all the URLs to be the same as what it would be in the browser
                // If we're not doing SSR, we want all the import paths to be absolute
                opts.import_path_format = if (opts.import_path_format == .absolute_url) .absolute_url else .absolute_path;
            },
            else => {},
        }

        if (transform.main_fields.len > 0) {
            opts.main_fields = transform.main_fields;
        }

        opts.external = ExternalModules.init(allocator, &fs.fs, fs.top_level_dir, transform.external, log, opts.platform);
        opts.out_extensions = opts.platform.outExtensions(allocator);

        if (transform.serve orelse false) {
            opts.preserve_extensions = true;
            opts.append_package_version_in_query_string = true;
            opts.resolve_mode = .lazy;
            var _dirs = [_]string{transform.public_dir orelse opts.public_dir};
            opts.public_dir = try fs.absAlloc(allocator, &_dirs);
            opts.public_dir_handle = std.fs.openDirAbsolute(opts.public_dir, .{ .iterate = true }) catch |err| brk: {
                var did_warn = false;
                switch (err) {
                    error.FileNotFound => {
                        // Be nice.
                        // Check "static" since sometimes people use that instead.
                        // Don't switch to it, but just tell "hey try --public-dir=static" next time
                        if (transform.public_dir == null or transform.public_dir.?.len == 0) {
                            _dirs[0] = "static";
                            const check_static = try fs.joinAlloc(allocator, &_dirs);
                            defer allocator.free(check_static);

                            std.fs.accessAbsolute(check_static, .{}) catch {
                                Output.printError("warn: \"public\" folder missing. If there are external assets used in your project, pass --public-dir=\"public-folder-name\"", .{});
                                did_warn = true;
                            };
                        }

                        if (!did_warn) {
                            Output.printError("warn: \"public\" folder missing. If you want to use \"static\" as the public folder, pass --public-dir=\"static\".", .{});
                        }
                        opts.public_dir_enabled = false;
                    },
                    error.AccessDenied => {
                        Output.printError(
                            "error: access denied when trying to open public_dir: \"{s}\".\nPlease re-open Speedy with access to this folder or pass a different folder via \"--public-dir\". Note: --public-dir is relative to --cwd (or the process' current working directory).\n\nThe public folder is where static assets such as images, fonts, and .html files go.",
                            .{opts.public_dir},
                        );
                        std.process.exit(1);
                    },
                    else => {
                        Output.printError(
                            "error: \"{s}\" when accessing public folder: \"{s}\"",
                            .{ @errorName(err), opts.public_dir },
                        );
                        std.process.exit(1);
                    },
                }

                break :brk null;
            };

            // Windows has weird locking rules for files
            // so it's a bad idea to keep a file handle open for a long time on Windows.
            if (isWindows and opts.public_dir_handle != null) {
                opts.public_dir_handle.?.close();
            }
            opts.hot_module_reloading = true;
        }

        if (opts.write and opts.output_dir.len > 0) {
            opts.output_dir_handle = try openOutputDir(opts.output_dir);
        }

        if (!(transform.generate_node_module_bundle orelse false)) {
            if (node_modules_bundle_existing) |node_mods| {
                opts.node_modules_bundle = node_mods;
                const pretty_path = fs.relativeTo(transform.node_modules_bundle_path.?);
                opts.node_modules_bundle_url = try std.fmt.allocPrint(allocator, "{s}{s}", .{
                    opts.public_url,
                    pretty_path,
                });
            } else if (transform.node_modules_bundle_path) |bundle_path| {
                if (bundle_path.len > 0) {
                    load_bundle: {
                        const pretty_path = fs.relativeTo(bundle_path);
                        var bundle_file = std.fs.openFileAbsolute(bundle_path, .{ .read = true, .write = true }) catch |err| {
                            Output.disableBuffering();
                            defer Output.enableBuffering();
                            Output.prettyErrorln("<r>error opening <d>\"<r><b>{s}<r><d>\":<r> <b><red>{s}<r>", .{ pretty_path, @errorName(err) });
                            break :load_bundle;
                        };

                        const time_start = std.time.nanoTimestamp();
                        if (NodeModuleBundle.loadBundle(allocator, bundle_file)) |bundle| {
                            var node_module_bundle = try allocator.create(NodeModuleBundle);
                            node_module_bundle.* = bundle;
                            opts.node_modules_bundle = node_module_bundle;
                            if (opts.public_url.len > 0) {
                                var relative = node_module_bundle.bundle.import_from_name;
                                if (relative[0] == std.fs.path.sep) {
                                    relative = relative[1..];
                                }

                                opts.node_modules_bundle_url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ opts.public_url, relative });
                            }
                            const elapsed = @intToFloat(f64, (std.time.nanoTimestamp() - time_start)) / std.time.ns_per_ms;
                            Output.prettyErrorln(
                                "<r><b><d>\"{s}\"<r><d> - {d} modules, {d} packages <b>[{d:>.2}ms]<r>",
                                .{
                                    pretty_path,
                                    node_module_bundle.bundle.modules.len,
                                    node_module_bundle.bundle.packages.len,
                                    elapsed,
                                },
                            );
                            Output.flush();
                        } else |err| {
                            Output.disableBuffering();
                            Output.prettyErrorln(
                                "<r>error reading <d>\"<r><b>{s}<r><d>\":<r> <b><red>{s}<r>, <b>deleting it<r> so you don't keep seeing this message.",
                                .{ pretty_path, @errorName(err) },
                            );
                            bundle_file.close();
                        }
                    }
                }
            }
        }

        return opts;
    }
};

pub fn openOutputDir(output_dir: string) !std.fs.Dir {
    return std.fs.openDirAbsolute(output_dir, std.fs.Dir.OpenDirOptions{}) catch brk: {
        std.fs.makeDirAbsolute(output_dir) catch |err| {
            Output.printErrorln("error: Unable to mkdir \"{s}\": \"{s}\"", .{ output_dir, @errorName(err) });
            Global.crash();
        };

        var handle = std.fs.openDirAbsolute(output_dir, std.fs.Dir.OpenDirOptions{}) catch |err2| {
            Output.printErrorln("error: Unable to open \"{s}\": \"{s}\"", .{ output_dir, @errorName(err2) });
            Global.crash();
        };
        break :brk handle;
    };
}

pub const TransformOptions = struct {
    footer: string = "",
    banner: string = "",
    define: std.StringHashMap(string),
    loader: Loader = Loader.js,
    resolve_dir: string = "/",
    jsx: ?JSX.Pragma,
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    public_url: string = "",
    preserve_symlinks: bool = false,
    entry_point: Fs.File,
    resolve_paths: bool = false,
    tsconfig_override: ?string = null,

    platform: Platform = Platform.browser,
    main_fields: []string = Platform.DefaultMainFields.get(Platform.browser),

    pub fn initUncached(allocator: *std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        var entryPoint = Fs.File{
            .path = Fs.Path.init(entryPointName),
            .contents = code,
        };

        var cwd: string = "/";
        if (isWasi or isNative) {
            cwd = try std.process.getCwdAlloc(allocator);
        }

        var define = std.StringHashMap(string).init(allocator);
        try define.ensureCapacity(1);

        define.putAssumeCapacity("process.env.NODE_ENV", "development");

        var loader = Loader.file;
        if (defaultLoaders.get(entryPoint.path.name.ext)) |defaultLoader| {
            loader = defaultLoader;
        }
        assert(code.len > 0);

        return TransformOptions{
            .entry_point = entryPoint,
            .define = define,
            .loader = loader,
            .resolve_dir = entryPoint.path.name.dir,
            .main_fields = Platform.DefaultMainFields.get(Platform.browser),
            .jsx = if (Loader.isJSX(loader)) JSX.Pragma{} else null,
        };
    }
};

// Instead of keeping files in-memory, we:
// 1. Write directly to disk
// 2. (Optional) move the file to the destination
// This saves us from allocating a buffer
pub const OutputFile = struct {
    loader: Loader,
    input: Fs.Path,
    value: Value,
    size: usize = 0,
    mtime: ?i128 = null,

    // Depending on:
    // - The platform
    // - The number of open file handles
    // - Whether or not a file of the same name exists
    // We may use a different system call
    pub const FileOperation = struct {
        pathname: string,
        fd: FileDescriptorType = 0,
        dir: FileDescriptorType = 0,
        is_tmpdir: bool = false,
        is_outdir: bool = false,

        pub fn fromFile(fd: FileDescriptorType, pathname: string) FileOperation {
            return .{
                .pathname = pathname,
                .fd = fd,
            };
        }

        pub fn getPathname(file: *const FileOperation) string {
            if (file.is_tmpdir) {
                return resolve_path.joinAbs(@TypeOf(Fs.FileSystem.instance.fs).tmpdir_path, .auto, file.pathname);
            } else {
                return file.pathname;
            }
        }
    };

    pub const Value = union(Kind) {
        buffer: []const u8,
        move: FileOperation,
        copy: FileOperation,
        noop: u0,
        pending: resolver.Result,
    };

    pub const Kind = enum { move, copy, noop, buffer, pending };

    pub fn initPending(loader: Loader, pending: resolver.Result) OutputFile {
        return .{
            .loader = .file,
            .input = pending.path_pair.primary,
            .size = 0,
            .value = .{ .pending = pending },
        };
    }

    pub fn initFile(file: std.fs.File, pathname: string, size: usize) OutputFile {
        return .{
            .loader = .file,
            .input = Fs.Path.init(pathname),
            .size = size,
            .value = .{ .copy = FileOperation.fromFile(file.handle, pathname) },
        };
    }

    pub fn initFileWithDir(file: std.fs.File, pathname: string, size: usize, dir: std.fs.Dir) OutputFile {
        var res = initFile(file, pathname, size);
        res.value.copy.dir_handle = dir.fd;
        return res;
    }

    pub fn initBuf(buf: []const u8, pathname: string, loader: Loader) OutputFile {
        return .{
            .loader = loader,
            .input = Fs.Path.init(pathname),
            .size = buf.len,
            .value = .{ .buffer = buf },
        };
    }

    pub fn moveTo(file: *const OutputFile, base_path: string, rel_path: []u8, dir: FileDescriptorType) !void {
        var move = file.value.move;
        if (move.dir > 0) {
            std.os.renameat(move.dir, move.pathname, dir, rel_path) catch |err| {
                const dir_ = std.fs.Dir{ .fd = dir };
                if (std.fs.path.dirname(rel_path)) |dirname| {
                    dir_.makePath(dirname) catch {};
                    std.os.renameat(move.dir, move.pathname, dir, rel_path) catch {};
                    return;
                }
            };
            return;
        }

        try std.os.rename(move.pathname, resolve_path.joinAbs(base_path, .auto, rel_path));
    }

    pub fn copyTo(file: *const OutputFile, base_path: string, rel_path: []u8, dir: FileDescriptorType) !void {
        var copy = file.value.copy;

        var dir_obj = std.fs.Dir{ .fd = dir };
        const file_out = (try dir_obj.createFile(rel_path, .{}));

        const fd_out = file_out.handle;
        var do_close = false;
        // TODO: close file_out on error
        const fd_in = (try std.fs.openFileAbsolute(file.input.text, .{ .read = true })).handle;

        if (isNative) {
            Fs.FileSystem.setMaxFd(fd_out);
            Fs.FileSystem.setMaxFd(fd_in);
            do_close = Fs.FileSystem.instance.fs.needToCloseFiles();
        }

        defer {
            if (do_close) {
                std.os.close(fd_out);
                std.os.close(fd_in);
            }
        }

        const os = std.os;

        if (comptime std.Target.current.isDarwin()) {
            const rc = os.system.fcopyfile(fd_in, fd_out, null, os.system.COPYFILE_DATA);
            if (os.errno(rc) == 0) {
                return;
            }
        }

        if (std.Target.current.os.tag == .linux) {
            // Try copy_file_range first as that works at the FS level and is the
            // most efficient method (if available).
            var offset: u64 = 0;
            cfr_loop: while (true) {
                // The kernel checks the u64 value `offset+count` for overflow, use
                // a 32 bit value so that the syscall won't return EINVAL except for
                // impossibly large files (> 2^64-1 - 2^32-1).
                const amt = try os.copy_file_range(fd_in, offset, fd_out, offset, math.maxInt(u32), 0);
                // Terminate when no data was copied
                if (amt == 0) break :cfr_loop;
                offset += amt;
            }
            return;
        }

        // Sendfile is a zero-copy mechanism iff the OS supports it, otherwise the
        // fallback code will copy the contents chunk by chunk.
        const empty_iovec = [0]os.iovec_const{};
        var offset: u64 = 0;
        sendfile_loop: while (true) {
            const amt = try os.sendfile(fd_out, fd_in, offset, 0, &empty_iovec, &empty_iovec, 0);
            // Terminate when no data was copied
            if (amt == 0) break :sendfile_loop;
            offset += amt;
        }
    }
};

pub const TransformResult = struct {
    errors: []logger.Msg = &([_]logger.Msg{}),
    warnings: []logger.Msg = &([_]logger.Msg{}),
    output_files: []OutputFile = &([_]OutputFile{}),
    outbase: string,
    root_dir: ?std.fs.Dir = null,
    pub fn init(
        outbase: string,
        output_files: []OutputFile,
        log: *logger.Log,
        allocator: *std.mem.Allocator,
    ) !TransformResult {
        var errors = try std.ArrayList(logger.Msg).initCapacity(allocator, log.errors);
        var warnings = try std.ArrayList(logger.Msg).initCapacity(allocator, log.warnings);
        for (log.msgs.items) |msg| {
            switch (msg.kind) {
                logger.Kind.err => {
                    errors.append(msg) catch unreachable;
                },
                logger.Kind.warn => {
                    warnings.append(msg) catch unreachable;
                },
                else => {},
            }
        }

        return TransformResult{
            .outbase = outbase,
            .output_files = output_files,
            .errors = errors.toOwnedSlice(),
            .warnings = warnings.toOwnedSlice(),
        };
    }
};
