const std = @import("std");
const logger = @import("logger.zig");
const fs = @import("fs.zig");
const alloc = @import("alloc.zig");
const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const defines = @import("./defines.zig");

usingnamespace @import("global.zig");

const assert = std.debug.assert;

pub fn validatePath(log: *logger.Log, fs: *fs.FileSystem.Implementation, cwd: string, rel_path: string, allocator: *std.mem.Allocator, path_kind: string) string {
    if (rel_path.len == 0) {
        return "";
    }
    const paths = [_]string{ cwd, rel_path };
    const out = std.fs.path.resolve(allocator, &path) catch |err| {
        log.addErrorFmt(null, logger.Loc{}, allocator, "Invalid {s}: {s}", .{ path_kind, rel_path }) catch unreachable;
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

    pub fn init(allocator: *std.mem.Allocator, fs: *fs.FileSystem.Implementation, cwd: string, externals: []string, log: *logger.Log) ExternalModules {
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
            if (strings.indexOfChar(path, '*')) |i| {
                if (strings.indexOfChar(path[i + 1 .. path.len], '*') != null) {
                    log.addErrorFmt(null, .empty, allocator, "External path \"{s}\" cannot have more than one \"*\" wildcard", .{external}) catch unreachable;
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
    pub const DefaultMainFields: std.EnumArray(Platform, []string) = comptime {
        var array = std.EnumArray(Platform, []string).initUndefined();

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
        factory: string = "React.createElement",
        fragment: string = "React.Fragment",
        runtime: JSX.Runtime = JSX.Runtime.automatic,

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        import_source: string = "react",
        jsx: string = "jsxDEV",

        development: bool = true,
        parse: bool = true,

        pub fn fromApi(jsx: api.Api.Jsx) Pragma {
            var pragma = JSX.Pragma{};

            if (jsx.fragment.len > 0) {
                pragma.jsx = jsx.fragment;
            }

            if (jsx.factory.len > 0) {
                pragma.jsx = jsx.factory;
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
    define: defines.Define,
    loaders: std.StringHashMap(Loader),
    resolve_dir: string = "/",
    jsx: ?JSX.Pragma,
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    public_url: string = "/",
    output_dir: string = "",
    write: bool = false,
    preserve_symlinks: bool = false,
    resolve_mode: api.Api.ResolveMode,
    tsconfig_override: ?string = null,
    fs: *fs.FileSystem,
    platform: Platform = Platform.browser,
    main_fields: []string = Platform.DefaultMainFields.get(Platform.browser),
    log: *logger.Log,
    external: ExternalModules,
    entry_points: []string,
    pub fn fromApi(
        allocator: *std.mem.Allocator,
        transform: Api.TransformOptions,
    ) !BundleOptions {
        var log = logger.Log.init(allocator);
        var opts: BundleOptions = std.mem.zeroes(BundleOptions);

        opts.fs = try fs.FileSystem.init1(allocator, transform.absolute_working_dir, false);
        opts.write = transform.write;
        if (transform.jsx) |jsx| {
            opts.jsx = JSX.Pragma.fromApi(jsx);
        }

        options.loaders = try stringHashMapFromArrays(std.StringHashMap(Loader), allocator, transform.loader_keys, transform.loader_values);
        var user_defines = try stringHashMapFromArrays(defines.RawDefines, allocator, transform.define_keys, transform.define_values);

        if (transform.define_keys.len == 0) {
            try user_defines.put("process.env.NODE_ENV", "development");
        }

        var resolved_defines = try defines.DefineData.from_input(user_defines, log, allocator);
        options.defines = try defines.Define.init(
            allocator,
        );

        if (transform.external.len > 0) {
            opts.external = try ExternalModules.init(allocator, opts.fs, opts.fs.top_level_dir, transform.external, &log);
        }

        if (transform.platform) |plat| {
            opts.platform = plat;
            opts.main_fields = Platform.DefaultMainFields.get(plat);
        }

        if (transform.main_fields.len > 0) {
            options.main_fields = transform.main_fields;
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
    entry_point: fs.File,
    resolve_paths: bool = false,
    tsconfig_override: ?string = null,

    platform: Platform = Platform.browser,
    main_fields: []string = Platform.DefaultMainFields.get(Platform.browser),

    pub fn initUncached(allocator: *std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        var entryPoint = fs.File{
            .path = fs.Path.init(entryPointName),
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
