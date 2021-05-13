const std = @import("std");
const logger = @import("logger.zig");
const Fs = @import("fs.zig");
const alloc = @import("alloc.zig");
const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const defines = @import("./defines.zig");

usingnamespace @import("global.zig");

const assert = std.debug.assert;

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
    try hash_map.ensureCapacity(@intCast(u32, keys.len));
    for (keys) |key, i| {
        try hash_map.put(key, values[i]);
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

    pub fn init(allocator: *std.mem.Allocator, fs: *Fs.FileSystem.Implementation, cwd: string, externals: []const string, log: *logger.Log) ExternalModules {
        var result = ExternalModules{
            .node_modules = std.BufSet.init(allocator),
            .abs_paths = std.BufSet.init(allocator),
            .patterns = &([_]WildcardPattern{}),
        };

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
            } else if (resolver.Resolver.isPackagePath(external)) {
                result.node_modules.put(external) catch unreachable;
            } else {
                const normalized = validatePath(log, fs, cwd, external, allocator, "external path");

                if (normalized.len > 0) {
                    result.abs_paths.put(normalized) catch unreachable;
                }
            }
        }

        result.patterns = patterns.toOwnedSlice();

        return result;
    }
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
    node,
    browser,
    neutral,

    const MAIN_FIELD_NAMES = [_]string{ "browser", "module", "main" };
    pub const DefaultMainFields: std.EnumArray(Platform, []const string) = comptime {
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
    .{ ".js", Loader.js },
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
        import_source: string = "react",
        jsx: string = "jsxDEV",

        development: bool = true,
        parse: bool = true,
        pub const Defaults = struct {
            pub var Factory = [_]string{ "React", "createElement" };
            pub var Fragment = [_]string{ "React", "Fragment" };
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
                pragma.jsx = jsx.import_source;
            }

            pragma.development = jsx.development;
            pragma.runtime = jsx.runtime;
            pragma.parse = true;
            return pragma;
        }
    };

    parse: bool = true,
    factory: string = "createElement",
    fragment: string = "Fragment",
    jsx: string = "jsxDEV",
    runtime: Runtime = Runtime.automatic,
    development: bool = true,

    /// Set on a per file basis like this:
    /// /** @jsxImportSource @emotion/core */
    import_source: string = "react",

    pub const Runtime = api.Api.JsxRuntime;
};

const TypeScript = struct {
    parse: bool = false,
};

pub const BundleOptions = struct {
    footer: string = "",
    banner: string = "",
    define: *defines.Define,
    loaders: std.StringHashMap(Loader),
    resolve_dir: string = "/",
    jsx: JSX.Pragma = JSX.Pragma{},
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    public_url: string = "/",
    output_dir: string = "",
    write: bool = false,
    preserve_symlinks: bool = false,
    resolve_mode: api.Api.ResolveMode,
    tsconfig_override: ?string = null,
    platform: Platform = Platform.browser,
    main_fields: []const string = Platform.DefaultMainFields.get(Platform.browser),
    log: *logger.Log,
    external: ExternalModules = ExternalModules{},
    entry_points: []const string,
    extension_order: []const string = &Defaults.ExtensionOrder,

    pub const Defaults = struct {
        pub var ExtensionOrder = [_]string{ ".tsx", ".ts", ".jsx", ".js", ".json" };
    };

    pub fn fromApi(
        allocator: *std.mem.Allocator,
        fs: *Fs.FileSystem,
        log: *logger.Log,
        transform: Api.TransformOptions,
    ) !BundleOptions {
        var loader_values = try allocator.alloc(Loader, transform.loader_values.len);
        for (loader_values) |_, i| {
            const loader = switch (transform.loader_values[i]) {
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
        var user_defines = try stringHashMapFromArrays(defines.RawDefines, allocator, transform.define_keys, transform.define_values);
        if (transform.define_keys.len == 0) {
            try user_defines.put("process.env.NODE_ENV", "development");
        }

        var resolved_defines = try defines.DefineData.from_input(user_defines, log, allocator);

        var opts: BundleOptions = BundleOptions{
            .log = log,
            .resolve_mode = transform.resolve orelse .dev,
            .define = try defines.Define.init(
                allocator,
                resolved_defines,
            ),
            .loaders = try stringHashMapFromArrays(std.StringHashMap(Loader), allocator, transform.loader_keys, loader_values),
            .write = transform.write orelse false,
            .external = ExternalModules.init(allocator, &fs.fs, fs.top_level_dir, transform.external, log),
            .entry_points = transform.entry_points,
        };

        if (transform.jsx) |jsx| {
            opts.jsx = try JSX.Pragma.fromApi(jsx, allocator);
        }

        if (transform.extension_order.len > 0) {
            opts.extension_order = transform.extension_order;
        }

        if (transform.platform) |plat| {
            opts.platform = if (plat == .browser) .browser else .node;
            opts.main_fields = Platform.DefaultMainFields.get(opts.platform);
        }

        if (transform.main_fields.len > 0) {
            opts.main_fields = transform.main_fields;
        }

        return opts;
    }
};

pub const TransformOptions = struct {
    footer: string = "",
    banner: string = "",
    define: std.StringHashMap(string),
    loader: Loader = Loader.js,
    resolve_dir: string = "/",
    jsx: ?JSX.Pragma,
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    public_url: string = "/",
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

pub const OutputFile = struct {
    path: string,
    contents: string,
};

pub const TransformResult = struct {
    errors: []logger.Msg,
    warnings: []logger.Msg,
    output_files: []OutputFile,
    pub fn init(
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
            .output_files = output_files,
            .errors = errors.toOwnedSlice(),
            .warnings = warnings.toOwnedSlice(),
        };
    }
};

test "TransformOptions.initUncached" {
    try alloc.setup(std.heap.page_allocator);
    const opts = try TransformOptions.initUncached(alloc.dynamic, "lol.jsx", "<Hi />");

    std.testing.expectEqualStrings("lol", opts.entry_point.path.name.base);
    std.testing.expectEqualStrings(".jsx", opts.entry_point.path.name.ext);
    std.testing.expect(Loader.jsx == opts.loader);
}
