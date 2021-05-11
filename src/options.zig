const std = @import("std");
const log = @import("logger.zig");
const fs = @import("fs.zig");
const alloc = @import("alloc.zig");

usingnamespace @import("global.zig");

const assert = std.debug.assert;

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

    pub const Runtime = enum { classic, automatic };
};

const TypeScript = struct {
    parse: bool = false,
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
    path: []u8,
    contents: []u8,
};

pub const TransformResult = struct { errors: []log.Msg, warnings: []log.Msg, output_files: []OutputFile };

test "TransformOptions.initUncached" {
    try alloc.setup(std.heap.page_allocator);
    const opts = try TransformOptions.initUncached(alloc.dynamic, "lol.jsx", "<Hi />");

    std.testing.expectEqualStrings("lol", opts.entry_point.path.name.base);
    std.testing.expectEqualStrings(".jsx", opts.entry_point.path.name.ext);
    std.testing.expect(Loader.jsx == opts.loader);
}
