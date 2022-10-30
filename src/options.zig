/// This file is mostly the API schema but with all the options normalized.
/// Normalization is necessary because most fields in the API schema are optional
const std = @import("std");
const logger = @import("logger.zig");
const Fs = @import("fs.zig");

const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const defines = @import("./defines.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const URL = @import("./url.zig").URL;
const ConditionsMap = @import("./resolver/package_json.zig").ESModule.ConditionsMap;
const bun = @import("global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FileDescriptorType = bun.FileDescriptorType;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const JSC = @import("javascript_core");
const Runtime = @import("./runtime.zig").Runtime;
const Analytics = @import("./analytics/analytics_thread.zig");
const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
const DotEnv = @import("./env_loader.zig");
const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;

const assert = std.debug.assert;

pub const WriteDestination = enum {
    stdout,
    disk,
    // eventaully: wasm
};

pub fn validatePath(
    log: *logger.Log,
    _: *Fs.FileSystem.Implementation,
    cwd: string,
    rel_path: string,
    allocator: std.mem.Allocator,
    _: string,
) string {
    if (rel_path.len == 0) {
        return "";
    }
    const paths = [_]string{ cwd, rel_path };
    // TODO: switch to getFdPath()-based implemetation
    const out = std.fs.path.resolve(allocator, &paths) catch |err| {
        log.addErrorFmt(
            null,
            logger.Loc.Empty,
            allocator,
            "<r><red>{s}<r> resolving external: <b>\"{s}\"<r>",
            .{ @errorName(err), rel_path },
        ) catch unreachable;
        return "";
    };

    return out;
}

pub fn stringHashMapFromArrays(comptime t: type, allocator: std.mem.Allocator, keys: anytype, values: anytype) !t {
    var hash_map = t.init(allocator);
    if (keys.len > 0) {
        try hash_map.ensureTotalCapacity(@intCast(u32, keys.len));
        for (keys) |key, i| {
            hash_map.putAssumeCapacity(key, values[i]);
        }
    }

    return hash_map;
}

pub const ExternalModules = struct {
    node_modules: std.BufSet,
    abs_paths: std.BufSet,
    patterns: []const WildcardPattern,
    pub const WildcardPattern = struct {
        prefix: string,
        suffix: string,
    };

    pub fn isNodeBuiltin(str: string) bool {
        return NodeBuiltinsMap.has(str);
    }

    const default_wildcard_patterns = &[_]WildcardPattern{
        .{
            .prefix = "/bun:",
            .suffix = "",
        },
        // .{
        //     .prefix = "/src:",
        //     .suffix = "",
        // },
        // .{
        //     .prefix = "/blob:",
        //     .suffix = "",
        // },
    };

    pub fn init(
        allocator: std.mem.Allocator,
        fs: *Fs.FileSystem.Implementation,
        cwd: string,
        externals: []const string,
        log: *logger.Log,
        platform: Platform,
    ) ExternalModules {
        var result = ExternalModules{
            .node_modules = std.BufSet.init(allocator),
            .abs_paths = std.BufSet.init(allocator),
            .patterns = std.mem.span(default_wildcard_patterns),
        };

        switch (platform) {
            .node => {
                // TODO: fix this stupid copy
                result.node_modules.hash_map.ensureTotalCapacity(NodeBuiltinPatterns.len) catch unreachable;
                for (NodeBuiltinPatterns) |pattern| {
                    result.node_modules.insert(pattern) catch unreachable;
                }
            },
            .bun => {

                // // TODO: fix this stupid copy
                // result.node_modules.hash_map.ensureTotalCapacity(BunNodeBuiltinPatternsCompat.len) catch unreachable;
                // for (BunNodeBuiltinPatternsCompat) |pattern| {
                //     result.node_modules.insert(pattern) catch unreachable;
                // }
            },
            else => {},
        }

        if (externals.len == 0) {
            return result;
        }

        var patterns = std.ArrayList(WildcardPattern).initCapacity(allocator, default_wildcard_patterns.len) catch unreachable;
        patterns.appendSliceAssumeCapacity(std.mem.span(default_wildcard_patterns));

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

    pub const BunNodeBuiltinPatternsCompat = [_]string{
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
        // "buffer",
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
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        // "path",
        "perf_hooks",
        // "process",
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

    pub const NodeBuiltinsMap = ComptimeStringMap(void, .{
        .{ "_http_agent", void{} },
        .{ "_http_client", void{} },
        .{ "_http_common", void{} },
        .{ "_http_incoming", void{} },
        .{ "_http_outgoing", void{} },
        .{ "_http_server", void{} },
        .{ "_stream_duplex", void{} },
        .{ "_stream_passthrough", void{} },
        .{ "_stream_readable", void{} },
        .{ "_stream_transform", void{} },
        .{ "_stream_wrap", void{} },
        .{ "_stream_writable", void{} },
        .{ "_tls_common", void{} },
        .{ "_tls_wrap", void{} },
        .{ "assert", void{} },
        .{ "async_hooks", void{} },
        .{ "buffer", void{} },
        .{ "child_process", void{} },
        .{ "cluster", void{} },
        .{ "console", void{} },
        .{ "constants", void{} },
        .{ "crypto", void{} },
        .{ "dgram", void{} },
        .{ "diagnostics_channel", void{} },
        .{ "dns", void{} },
        .{ "domain", void{} },
        .{ "events", void{} },
        .{ "fs", void{} },
        .{ "http", void{} },
        .{ "http2", void{} },
        .{ "https", void{} },
        .{ "inspector", void{} },
        .{ "module", void{} },
        .{ "net", void{} },
        .{ "os", void{} },
        .{ "path", void{} },
        .{ "perf_hooks", void{} },
        .{ "process", void{} },
        .{ "punycode", void{} },
        .{ "querystring", void{} },
        .{ "readline", void{} },
        .{ "repl", void{} },
        .{ "stream", void{} },
        .{ "string_decoder", void{} },
        .{ "sys", void{} },
        .{ "timers", void{} },
        .{ "tls", void{} },
        .{ "trace_events", void{} },
        .{ "tty", void{} },
        .{ "url", void{} },
        .{ "util", void{} },
        .{ "v8", void{} },
        .{ "vm", void{} },
        .{ "wasi", void{} },
        .{ "worker_threads", void{} },
        .{ "zlib", void{} },
    });
};

pub const BundlePackage = enum {
    always,
    never,

    pub const Map = std.StringArrayHashMapUnmanaged(BundlePackage);
};

pub const ModuleType = enum {
    unknown,
    cjs,
    esm,

    pub const List = ComptimeStringMap(ModuleType, .{
        .{ "commonjs", ModuleType.cjs },
        .{ "module", ModuleType.esm },
    });
};

pub const Platform = enum {
    neutral,
    browser,
    bun,
    bun_macro,
    node,

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Platform {
        if (!value.jsType().isStringLike()) {
            JSC.throwInvalidArguments("platform must be a string", .{}, global, exception);

            return null;
        }
        var zig_str = JSC.ZigString.init("");
        value.toZigString(&zig_str, global);

        var slice = zig_str.slice();

        const Eight = strings.ExactSizeMatcher(8);

        return switch (Eight.match(slice)) {
            Eight.case("deno"), Eight.case("browser") => Platform.browser,
            Eight.case("bun") => Platform.bun,
            Eight.case("macro") => Platform.bun_macro,
            Eight.case("node") => Platform.node,
            Eight.case("neutral") => Platform.neutral,
            else => {
                JSC.throwInvalidArguments("platform must be one of: deno, browser, bun, macro, node, neutral", .{}, global, exception);

                return null;
            },
        };
    }

    pub fn toAPI(this: Platform) Api.Platform {
        return switch (this) {
            .node => .node,
            .browser => .browser,
            .bun => .bun,
            .bun_macro => .bun_macro,
            else => ._none,
        };
    }

    pub inline fn isServerSide(this: Platform) bool {
        return switch (this) {
            .bun_macro, .node, .bun => true,
            else => false,
        };
    }

    pub inline fn isBun(this: Platform) bool {
        return switch (this) {
            .bun_macro, .bun => true,
            else => false,
        };
    }

    pub inline fn isNotBun(this: Platform) bool {
        return switch (this) {
            .bun_macro, .bun => false,
            else => true,
        };
    }

    pub inline fn isClient(this: Platform) bool {
        return switch (this) {
            .bun_macro, .bun => false,
            else => true,
        };
    }

    pub inline fn supportsBrowserField(this: Platform) bool {
        return switch (this) {
            .neutral, .browser => true,
            else => false,
        };
    }

    const browser_define_value_true = "true";
    const browser_define_value_false = "false";

    pub inline fn processBrowserDefineValue(this: Platform) ?string {
        return switch (this) {
            .browser => browser_define_value_true,
            .bun_macro, .bun, .node => browser_define_value_false,
            else => null,
        };
    }

    pub inline fn isWebLike(platform: Platform) bool {
        return switch (platform) {
            .neutral, .browser => true,
            else => false,
        };
    }

    pub const Extensions = struct {
        pub const In = struct {
            pub const JavaScript = [_]string{ ".js", ".cjs", ".mts", ".cts", ".ts", ".tsx", ".jsx", ".json" };
        };
        pub const Out = struct {
            pub const JavaScript = [_]string{
                ".js",
                ".mjs",
            };
        };
    };

    pub fn outExtensions(platform: Platform, allocator: std.mem.Allocator) std.StringHashMap(string) {
        var exts = std.StringHashMap(string).init(allocator);

        const js = Extensions.Out.JavaScript[0];
        const mjs = Extensions.Out.JavaScript[1];

        if (platform == .node) {
            exts.ensureTotalCapacity(Extensions.In.JavaScript.len * 2) catch unreachable;
            for (Extensions.In.JavaScript) |ext| {
                exts.put(ext, mjs) catch unreachable;
            }
        } else {
            exts.ensureTotalCapacity(Extensions.In.JavaScript.len + 1) catch unreachable;
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
            .bun => .bun,
            .bun_macro => .bun_macro,
            else => .browser,
        };
    }

    const MAIN_FIELD_NAMES = [_]string{
        "browser",
        "module",

        "main",

        // https://github.com/jsforum/jsforum/issues/5
        // Older packages might use jsnext:main in place of module
        "jsnext:main",
    };
    pub const DefaultMainFields: std.EnumArray(Platform, []const string) = brk: {
        var array = std.EnumArray(Platform, []const string).initUndefined();

        // Note that this means if a package specifies "module" and "main", the ES6
        // module will not be selected. This means tree shaking will not work when
        // targeting node environments.
        //
        // Some packages incorrectly treat the "module" field as "code for the browser". It
        // actually means "code for ES6 environments" which includes both node and the browser.
        //
        // For example, the package "@firebase/app" prints a warning on startup about
        // the bundler incorrectly using code meant for the browser if the bundler
        // selects the "module" field instead of the "main" field.
        //
        // This is unfortunate but it's a problem on the side of those packages.
        // They won't work correctly with other popular bundlers (with node as a target) anyway.
        var list = [_]string{ MAIN_FIELD_NAMES[2], MAIN_FIELD_NAMES[1] };
        array.set(Platform.node, &list);

        // Note that this means if a package specifies "main", "module", and
        // "browser" then "browser" will win out over "module". This is the
        // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
        //
        // This is deliberate because the presence of the "browser" field is a
        // good signal that this should be preferred. Some older packages might only use CJS in their "browser"
        // but in such a case they probably don't have any ESM files anyway.
        var listc = [_]string{ MAIN_FIELD_NAMES[0], MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[3], MAIN_FIELD_NAMES[2] };
        var listd = [_]string{ MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[2], MAIN_FIELD_NAMES[3] };

        array.set(Platform.browser, &listc);
        array.set(Platform.bun, &listd);
        array.set(Platform.bun_macro, &listd);

        // Original comment:
        // The neutral platform is for people that don't want esbuild to try to
        // pick good defaults for their platform. In that case, the list of main
        // fields is empty by default. You must explicitly configure it yourself.

        array.set(Platform.neutral, &listc);

        break :brk array;
    };

    pub const default_conditions_strings = .{
        .browser = @as(string, "browser"),
        .import = @as(string, "import"),
        .worker = @as(string, "worker"),
        .require = @as(string, "require"),
        .node = @as(string, "node"),
        .default = @as(string, "default"),
        .bun = @as(string, "bun"),
        .bun_macro = @as(string, "bun_macro"),
        .module = @as(string, "module"), // used in tslib
        .development = @as(string, "development"),
        .production = @as(string, "production"),
    };

    pub const DefaultConditions: std.EnumArray(Platform, []const string) = brk: {
        var array = std.EnumArray(Platform, []const string).initUndefined();

        array.set(Platform.node, &[_]string{
            default_conditions_strings.node,
            default_conditions_strings.module,
        });

        var listc = [_]string{
            default_conditions_strings.browser,
            default_conditions_strings.module,
        };
        array.set(Platform.browser, &listc);
        array.set(
            Platform.bun,
            &[_]string{
                default_conditions_strings.bun,
                default_conditions_strings.worker,
                default_conditions_strings.module,
                default_conditions_strings.browser,
            },
        );
        array.set(
            Platform.bun_macro,
            &[_]string{
                default_conditions_strings.bun,
                default_conditions_strings.worker,
                default_conditions_strings.module,
                default_conditions_strings.browser,
            },
        );
        // array.set(Platform.bun_macro, [_]string{ default_conditions_strings.bun_macro, default_conditions_strings.browser, default_conditions_strings.default, },);

        // Original comment:
        // The neutral platform is for people that don't want esbuild to try to
        // pick good defaults for their platform. In that case, the list of main
        // fields is empty by default. You must explicitly configure it yourself.

        array.set(Platform.neutral, &listc);

        break :brk array;
    };
};

pub const Loader = enum(u4) {
    jsx,
    js,
    ts,
    tsx,
    css,
    file,
    json,
    toml,
    wasm,
    napi,

    pub const Map = std.EnumArray(Loader, string);
    pub const stdin_name: Map = brk: {
        var map = Map.initFill("");
        map.set(Loader.jsx, "input.jsx");
        map.set(Loader.js, "input.js");
        map.set(Loader.ts, "input.ts");
        map.set(Loader.tsx, "input.tsx");
        map.set(Loader.css, "input.css");
        map.set(Loader.file, "input");
        map.set(Loader.json, "input.json");
        map.set(Loader.toml, "input.toml");
        map.set(Loader.wasm, "input.wasm");
        map.set(Loader.napi, "input.node");
        break :brk map;
    };

    pub inline fn stdinName(this: Loader) string {
        return stdin_name.get(this);
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, loader: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Loader {
        if (loader.isUndefinedOrNull()) return null;

        if (!loader.jsType().isStringLike()) {
            JSC.throwInvalidArguments("loader must be a string", .{}, global, exception);
            return null;
        }

        var zig_str = JSC.ZigString.init("");
        loader.toZigString(&zig_str, global);
        if (zig_str.len == 0) return null;

        return fromString(zig_str.slice()) orelse {
            JSC.throwInvalidArguments("invalid loader – must be js, jsx, tsx, ts, css, file, toml, wasm, or json", .{}, global, exception);
            return null;
        };
    }

    pub fn fromString(slice_: string) ?Loader {
        const LoaderMatcher = strings.ExactSizeMatcher(4);
        var slice = slice_;
        if (slice.len > 0 and slice[0] == '.') {
            slice = slice[1..];
        }

        return switch (LoaderMatcher.matchLower(slice)) {
            LoaderMatcher.case("js") => Loader.js,
            LoaderMatcher.case("jsx") => Loader.jsx,
            LoaderMatcher.case("ts") => Loader.ts,
            LoaderMatcher.case("tsx") => Loader.tsx,
            LoaderMatcher.case("css") => Loader.css,
            LoaderMatcher.case("file") => Loader.file,
            LoaderMatcher.case("json") => Loader.json,
            LoaderMatcher.case("toml") => Loader.toml,
            LoaderMatcher.case("wasm") => Loader.wasm,
            LoaderMatcher.case("node") => Loader.napi,
            else => null,
        };
    }

    pub fn supportsClientEntryPoint(this: Loader) bool {
        return switch (this) {
            .jsx, .js, .ts, .tsx => true,
            else => false,
        };
    }

    pub fn toAPI(loader: Loader) Api.Loader {
        return switch (loader) {
            .jsx => .jsx,
            .js => .js,
            .ts => .ts,
            .tsx => .tsx,
            .css => .css,
            .json => .json,
            .toml => .toml,
            .wasm => .wasm,
            .napi => .napi,
            else => .file,
        };
    }

    pub fn isJSX(loader: Loader) bool {
        return loader == .jsx or loader == .tsx;
    }
    pub fn isTypeScript(loader: Loader) bool {
        return loader == .tsx or loader == .ts;
    }

    pub fn isJavaScriptLike(loader: Loader) bool {
        return switch (loader) {
            .jsx, .js, .ts, .tsx => true,
            else => false,
        };
    }

    pub fn isJavaScriptLikeOrJSON(loader: Loader) bool {
        return switch (loader) {
            .jsx, .js, .ts, .tsx, .json => true,
            else => false,
        };
    }

    pub fn forFileName(filename: string, obj: anytype) ?Loader {
        const ext = std.fs.path.extension(filename);
        if (ext.len == 0 or (ext.len == 1 and ext[0] == '.')) return null;

        return obj.get(ext);
    }
};

pub const defaultLoaders = ComptimeStringMap(Loader, .{
    .{ ".jsx", Loader.jsx },
    .{ ".json", Loader.json },
    .{ ".js", Loader.jsx },

    .{ ".mjs", Loader.js },
    .{ ".cjs", Loader.js },

    .{ ".css", Loader.css },
    .{ ".ts", Loader.ts },
    .{ ".tsx", Loader.tsx },

    .{ ".mts", Loader.ts },
    .{ ".cts", Loader.ts },

    .{ ".toml", Loader.toml },
    .{ ".wasm", Loader.wasm },
    .{ ".node", Loader.napi },
});

// https://webpack.js.org/guides/package-exports/#reference-syntax
pub const ESMConditions = struct {
    default: ConditionsMap = undefined,
    import: ConditionsMap = undefined,
    require: ConditionsMap = undefined,

    pub fn init(allocator: std.mem.Allocator, defaults: []const string) !ESMConditions {
        var default_condition_amp = ConditionsMap.init(allocator);

        var import_condition_map = ConditionsMap.init(allocator);
        var require_condition_map = ConditionsMap.init(allocator);

        try default_condition_amp.ensureTotalCapacity(defaults.len + 1);
        try import_condition_map.ensureTotalCapacity(defaults.len + 1);
        try require_condition_map.ensureTotalCapacity(defaults.len + 1);

        import_condition_map.putAssumeCapacityNoClobber(Platform.default_conditions_strings.import, void{});
        require_condition_map.putAssumeCapacityNoClobber(Platform.default_conditions_strings.require, void{});
        default_condition_amp.putAssumeCapacityNoClobber(Platform.default_conditions_strings.default, void{});

        for (defaults) |default| {
            default_condition_amp.putAssumeCapacityNoClobber(default, void{});
            import_condition_map.putAssumeCapacityNoClobber(default, void{});
            require_condition_map.putAssumeCapacityNoClobber(default, void{});
        }

        return ESMConditions{
            .default = default_condition_amp,
            .import = import_condition_map,
            .require = require_condition_map,
        };
    }
};

pub const JSX = struct {
    pub const RuntimeMap = bun.ComptimeStringMap(JSX.Runtime, .{
        .{ "react", JSX.Runtime.classic },
        .{ "react-jsx", JSX.Runtime.automatic },
        .{ "react-jsxDEV", JSX.Runtime.automatic },
        .{ "solid", JSX.Runtime.solid },
    });

    pub const Pragma = struct {
        // these need to be arrays
        factory: []const string = Defaults.Factory,
        fragment: []const string = Defaults.Fragment,
        runtime: JSX.Runtime = JSX.Runtime.automatic,

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        import_source: string = "react/jsx-dev-runtime",
        classic_import_source: string = "react",
        package_name: []const u8 = "react",
        // https://github.com/facebook/react/commit/2f26eb85d657a08c21edbac1e00f9626d68f84ae
        refresh_runtime: string = "react-refresh/runtime",
        supports_fast_refresh: bool = true,
        use_embedded_refresh_runtime: bool = false,

        jsx: string = Defaults.JSXFunctionDev,
        jsx_static: string = Defaults.JSXStaticFunction,

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
            pub const Factory = &[_]string{"createElement"};
            pub const Fragment = &[_]string{"Fragment"};
            pub const ImportSourceDev = "react/jsx-dev-runtime";
            pub const ImportSource = "react/jsx-runtime";
            pub const JSXFunction = "jsx";
            pub const JSXStaticFunction = "jsxs";
            pub const JSXFunctionDev = "jsxDEV";
        };

        // "React.createElement" => ["React", "createElement"]
        // ...unless new is "React.createElement" and original is ["React", "createElement"]
        // saves an allocation for the majority case
        pub fn memberListToComponentsIfDifferent(allocator: std.mem.Allocator, original: []const string, new: string) ![]const string {
            var splitter = std.mem.split(u8, new, ".");

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

            splitter = std.mem.split(u8, new, ".");
            var i: usize = 0;
            while (splitter.next()) |str| {
                out[i] = str;
                i += 1;
            }
            return out;
        }

        pub fn fromApi(jsx: api.Api.Jsx, allocator: std.mem.Allocator) !Pragma {
            var pragma = JSX.Pragma{};

            if (jsx.fragment.len > 0) {
                pragma.fragment = try memberListToComponentsIfDifferent(allocator, pragma.fragment, jsx.fragment);
            }

            if (jsx.factory.len > 0) {
                pragma.factory = try memberListToComponentsIfDifferent(allocator, pragma.factory, jsx.factory);
            }

            pragma.runtime = jsx.runtime;

            if (jsx.import_source.len > 0) {
                pragma.import_source = jsx.import_source;
                if (jsx.import_source.len > "solid-js".len and strings.eqlComptime(jsx.import_source[0.."solid-js".len], "solid-js")) {
                    pragma.runtime = .solid;
                    pragma.supports_fast_refresh = false;
                }
                pragma.package_name = parsePackageName(pragma.import_source);
            } else if (jsx.development) {
                pragma.import_source = Defaults.ImportSourceDev;
                pragma.package_name = "react";
            } else {
                pragma.import_source = Defaults.ImportSource;
            }

            if (jsx.development) {
                pragma.jsx = Defaults.JSXFunctionDev;
            } else {
                pragma.jsx = Defaults.JSXFunction;
            }

            pragma.supports_fast_refresh = if (pragma.runtime == .solid) false else pragma.supports_fast_refresh;
            pragma.development = jsx.development;
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
        pub const Key = "process.env.BUN_HMR_ENABLED";
        pub const Value = "true";
    };
    pub const HotModuleReloadingVerbose = struct {
        pub const Key = "process.env.BUN_HMR_VERBOSE";
        pub const Value = "true";
    };
    // This must be globally scoped so it doesn't disappear
    pub const NodeEnv = struct {
        pub const Key = "process.env.NODE_ENV";
        pub const Value = "\"development\"";
    };

    pub const PlatformDefine = struct {
        pub const Key = "process.browser";
        pub const Value = []string{ "false", "true" };
    };
};

pub fn definesFromTransformOptions(
    allocator: std.mem.Allocator,
    log: *logger.Log,
    _input_define: ?Api.StringMap,
    hmr: bool,
    platform: Platform,
    loader: ?*DotEnv.Loader,
    framework_env: ?*const Env,
) !*defines.Define {
    var input_user_define = _input_define orelse std.mem.zeroes(Api.StringMap);

    var user_defines = try stringHashMapFromArrays(
        defines.RawDefines,
        allocator,
        input_user_define.keys,
        input_user_define.values,
    );

    var environment_defines = defines.UserDefinesArray.init(allocator);
    defer environment_defines.deinit();

    if (loader) |_loader| {
        if (framework_env) |framework| {
            _ = try _loader.copyForDefine(
                defines.RawDefines,
                &user_defines,
                defines.UserDefinesArray,
                &environment_defines,
                framework.toAPI().defaults,
                framework.behavior,
                framework.prefix,
                allocator,
            );
        } else {
            _ = try _loader.copyForDefine(
                defines.RawDefines,
                &user_defines,
                defines.UserDefinesArray,
                &environment_defines,
                std.mem.zeroes(Api.StringMap),
                Api.DotEnvBehavior.disable,
                "",
                allocator,
            );
        }
    }

    if (input_user_define.keys.len == 0) {
        try user_defines.put(DefaultUserDefines.NodeEnv.Key, DefaultUserDefines.NodeEnv.Value);
    }

    if (hmr) {
        try user_defines.put(DefaultUserDefines.HotModuleReloading.Key, DefaultUserDefines.HotModuleReloading.Value);
    }

    // Automatically set `process.browser` to `true` for browsers and false for node+js
    // This enables some extra dead code elimination
    if (platform.processBrowserDefineValue()) |value| {
        _ = try user_defines.getOrPutValue(DefaultUserDefines.PlatformDefine.Key, value);
    }

    if (platform.isBun()) {
        if (!user_defines.contains("window")) {
            _ = try environment_defines.getOrPutValue("window", .{
                .valueless = true,
                .original_name = "window",
                .value = .{ .e_undefined = .{} },
            });
        }
    }

    var resolved_defines = try defines.DefineData.from_input(user_defines, log, allocator);

    return try defines.Define.init(
        allocator,
        resolved_defines,
        environment_defines,
    );
}

pub fn loadersFromTransformOptions(allocator: std.mem.Allocator, _loaders: ?Api.LoaderMap, platform: Platform) !std.StringHashMap(Loader) {
    var input_loaders = _loaders orelse std.mem.zeroes(Api.LoaderMap);
    var loader_values = try allocator.alloc(Loader, input_loaders.loaders.len);

    if (platform.isBun()) {
        for (loader_values) |_, i| {
            const loader = switch (input_loaders.loaders[i]) {
                .jsx => Loader.jsx,
                .js => Loader.js,
                .ts => Loader.ts,
                .css => Loader.css,
                .tsx => Loader.tsx,
                .json => Loader.json,
                .toml => Loader.toml,
                .wasm => Loader.wasm,
                .napi => Loader.napi,
                else => unreachable,
            };

            loader_values[i] = loader;
        }
    } else {
        for (loader_values) |_, i| {
            const loader = switch (input_loaders.loaders[i]) {
                .jsx => Loader.jsx,
                .js => Loader.js,
                .ts => Loader.ts,
                .css => Loader.css,
                .tsx => Loader.tsx,
                .json => Loader.json,
                .toml => Loader.toml,
                .wasm => Loader.wasm,
                else => unreachable,
            };

            loader_values[i] = loader;
        }
    }

    var loaders = try stringHashMapFromArrays(
        std.StringHashMap(Loader),
        allocator,
        input_loaders.extensions,
        loader_values,
    );
    const default_loader_ext = comptime [_]string{
        ".jsx",  ".json",
        ".js",   ".mjs",
        ".cjs",  ".css",

        // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#new-file-extensions
        ".ts",   ".tsx",
        ".mts",  ".cts",

        ".toml", ".wasm",
    };

    const default_loader_ext_bun = [_]string{".node"};

    inline for (default_loader_ext) |ext| {
        if (!loaders.contains(ext)) {
            try loaders.put(ext, defaultLoaders.get(ext).?);
        }
    }

    if (platform.isBun()) {
        inline for (default_loader_ext_bun) |ext| {
            if (!loaders.contains(ext)) {
                try loaders.put(ext, defaultLoaders.get(ext).?);
            }
        }
    }

    return loaders;
}

const Dir = std.fs.Dir;

pub const SourceMapOption = enum {
    none,
    @"inline",
    external,

    pub fn fromApi(source_map: ?Api.SourceMapMode) SourceMapOption {
        return switch (source_map orelse Api.SourceMapMode._none) {
            Api.SourceMapMode.external => .external,
            Api.SourceMapMode.inline_into_file => .@"inline",
            else => .none,
        };
    }

    pub fn toAPI(source_map: ?SourceMapOption) Api.SourceMapMode {
        return switch (source_map orelse .none) {
            .external => .external,
            .@"inline" => .@"inline_into_file",
            else => ._none,
        };
    }

    pub const map = ComptimeStringMap(SourceMapOption, .{
        .{ "none", .none },
        .{ "inline", .@"inline" },
        .{ "external", .@"external" },
    });
};

/// BundleOptions is used when ResolveMode is not set to "disable".
/// BundleOptions is effectively webpack + babel
pub const BundleOptions = struct {
    footer: string = "",
    banner: string = "",
    define: *defines.Define,
    loaders: std.StringHashMap(Loader),
    resolve_dir: string = "/",
    jsx: JSX.Pragma = JSX.Pragma{},
    auto_import_jsx: bool = true,
    allow_runtime: bool = true,

    trim_unused_imports: ?bool = null,

    hot_module_reloading: bool = false,
    inject: ?[]string = null,
    origin: URL = URL{},
    output_dir_handle: ?Dir = null,

    output_dir: string = "out",
    node_modules_bundle_url: string = "",
    node_modules_bundle_pretty_path: string = "",

    write: bool = false,
    preserve_symlinks: bool = false,
    preserve_extensions: bool = false,
    timings: Timings = Timings{},
    node_modules_bundle: ?*NodeModuleBundle = null,
    production: bool = false,
    serve: bool = false,

    append_package_version_in_query_string: bool = false,

    jsx_optimization_inline: ?bool = null,
    jsx_optimization_hoist: ?bool = null,

    resolve_mode: api.Api.ResolveMode,
    tsconfig_override: ?string = null,
    platform: Platform = Platform.browser,
    main_fields: []const string = Platform.DefaultMainFields.get(Platform.browser),
    log: *logger.Log,
    external: ExternalModules = ExternalModules{},
    entry_points: []const string,
    extension_order: []const string = &Defaults.ExtensionOrder,
    esm_extension_order: []const string = &Defaults.ModuleExtensionOrder,
    out_extensions: std.StringHashMap(string),
    import_path_format: ImportPathFormat = ImportPathFormat.relative,
    framework: ?Framework = null,
    routes: RouteConfig = RouteConfig.zero(),
    defines_loaded: bool = false,
    env: Env = Env{},
    transform_options: Api.TransformOptions,
    polyfill_node_globals: bool = true,

    rewrite_jest_for_tests: bool = false,

    macro_remap: MacroRemap = MacroRemap{},

    conditions: ESMConditions = undefined,
    tree_shaking: bool = false,
    sourcemap: SourceMapOption = SourceMapOption.none,

    disable_transpilation: bool = false,

    enable_auto_install: bool = false,

    pub inline fn cssImportBehavior(this: *const BundleOptions) Api.CssInJsBehavior {
        switch (this.platform) {
            .neutral, .browser => {
                if (this.framework) |framework| {
                    return framework.client_css_in_js;
                }

                return .auto_onimportcss;
            },
            else => return .facade,
        }
    }

    pub fn areDefinesUnset(this: *const BundleOptions) bool {
        return !this.defines_loaded;
    }

    pub fn loadDefines(this: *BundleOptions, allocator: std.mem.Allocator, loader_: ?*DotEnv.Loader, env: ?*const Env) !void {
        if (this.defines_loaded) {
            return;
        }
        this.define = try definesFromTransformOptions(
            allocator,
            this.log,
            this.transform_options.define,
            this.transform_options.serve orelse false,
            this.platform,
            loader_,
            env,
        );
        this.defines_loaded = true;
    }

    pub fn loader(this: *const BundleOptions, ext: string) Loader {
        return this.loaders.get(ext) orelse .file;
    }

    pub fn isFrontendFrameworkEnabled(this: *const BundleOptions) bool {
        const framework: *const Framework = &(this.framework orelse return false);
        return framework.resolved and (framework.client.isEnabled() or framework.fallback.isEnabled());
    }

    pub const ImportPathFormat = enum {
        relative,
        absolute_url,
        // omit file extension
        absolute_path,
        package_path,
    };

    pub const Defaults = struct {
        pub const ExtensionOrder = [_]string{
            ".tsx",
            ".ts",
            ".jsx",
            ".cts",
            ".cjs",
            ".js",
            ".mjs",
            ".mts",
            ".json",
        };

        pub const ModuleExtensionOrder = [_]string{
            ".tsx",
            ".jsx",
            ".mts",
            ".ts",
            ".mjs",
            ".js",
            ".cts",
            ".cjs",
            ".json",
        };

        pub const CSSExtensionOrder = [_]string{
            ".css",
        };
    };

    pub fn fromApi(
        allocator: std.mem.Allocator,
        fs: *Fs.FileSystem,
        log: *logger.Log,
        transform: Api.TransformOptions,
        node_modules_bundle_existing: ?*NodeModuleBundle,
    ) !BundleOptions {
        var opts: BundleOptions = BundleOptions{
            .log = log,
            .resolve_mode = transform.resolve orelse .dev,
            .define = undefined,
            .loaders = try loadersFromTransformOptions(allocator, transform.loaders, Platform.from(transform.platform)),
            .output_dir = transform.output_dir orelse "out",
            .platform = Platform.from(transform.platform),
            .write = transform.write orelse false,
            .external = undefined,
            .entry_points = transform.entry_points,
            .out_extensions = undefined,
            .env = Env.init(allocator),
            .transform_options = transform,
        };

        Analytics.Features.define = Analytics.Features.define or transform.define != null;
        Analytics.Features.loaders = Analytics.Features.loaders or transform.loaders != null;

        if (transform.origin) |origin| {
            opts.origin = URL.parse(origin);
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

        opts.conditions = try ESMConditions.init(allocator, Platform.DefaultConditions.get(opts.platform));

        if (transform.serve orelse false) {
            // When we're serving, we need some kind of URL.
            if (!opts.origin.isAbsolute()) {
                const protocol: string = if (opts.origin.hasHTTPLikeProtocol()) opts.origin.protocol else "http";

                const had_valid_port = opts.origin.hasValidPort();
                const port: string = if (had_valid_port) opts.origin.port else "3000";

                opts.origin = URL.parse(
                    try std.fmt.allocPrint(
                        allocator,
                        "{s}://localhost:{s}{s}",
                        .{
                            protocol,
                            port,
                            opts.origin.path,
                        },
                    ),
                );
                opts.origin.port_was_automatically_set = !had_valid_port;
            }
        }

        switch (opts.platform) {
            .node => {
                opts.import_path_format = .relative;
                opts.allow_runtime = false;
            },
            .bun => {
                // If we're doing SSR, we want all the URLs to be the same as what it would be in the browser
                // If we're not doing SSR, we want all the import paths to be absolute
                opts.import_path_format = if (opts.import_path_format == .absolute_url) .absolute_url else .absolute_path;
                opts.env.behavior = .load_all;
            },
            else => {},
        }

        const is_generating_bundle = (transform.generate_node_module_bundle orelse false);

        if (!is_generating_bundle) {
            if (node_modules_bundle_existing) |node_mods| {
                opts.node_modules_bundle = node_mods;
                const pretty_path = fs.relativeTo(transform.node_modules_bundle_path.?);
                opts.node_modules_bundle_url = try std.fmt.allocPrint(allocator, "{s}{s}", .{
                    opts.origin,
                    pretty_path,
                });
            } else if (transform.node_modules_bundle_path) |bundle_path| {
                if (bundle_path.len > 0) {
                    load_bundle: {
                        const pretty_path = fs.relativeTo(bundle_path);
                        var bundle_file = std.fs.openFileAbsolute(bundle_path, .{ .mode = .read_write }) catch |err| {
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

                            if (opts.origin.isAbsolute()) {
                                opts.node_modules_bundle_url = try opts.origin.joinAlloc(
                                    allocator,
                                    "",
                                    "",
                                    node_module_bundle.bundle.import_from_name,
                                    "",
                                    "",
                                );
                                opts.node_modules_bundle_pretty_path = opts.node_modules_bundle_url[opts.node_modules_bundle_url.len - node_module_bundle.bundle.import_from_name.len - 1 ..];
                            } else {
                                opts.node_modules_bundle_pretty_path = try allocator.dupe(u8, pretty_path);
                            }

                            const elapsed = @intToFloat(f64, (std.time.nanoTimestamp() - time_start)) / std.time.ns_per_ms;
                            Output.printElapsed(elapsed);
                            Output.prettyErrorln(
                                " <b><d>\"{s}\"<r><d> - {d} modules, {d} packages<r>",
                                .{
                                    pretty_path,
                                    bundle.bundle.modules.len,
                                    bundle.bundle.packages.len,
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
        // }

        if (transform.framework) |_framework| {
            opts.framework = try Framework.fromApi(_framework, allocator);
        }

        if (transform.router) |routes| {
            opts.routes = try RouteConfig.fromApi(routes, allocator);
        }

        if (transform.main_fields.len > 0) {
            opts.main_fields = transform.main_fields;
        }

        if (opts.framework == null and is_generating_bundle)
            opts.env.behavior = .load_all;

        opts.external = ExternalModules.init(allocator, &fs.fs, fs.top_level_dir, transform.external, log, opts.platform);
        opts.out_extensions = opts.platform.outExtensions(allocator);

        if (transform.serve orelse false) {
            opts.preserve_extensions = true;
            opts.append_package_version_in_query_string = true;
            if (opts.framework == null)
                opts.env.behavior = .load_all;

            opts.sourcemap = SourceMapOption.fromApi(transform.source_map orelse Api.SourceMapMode.external);

            opts.resolve_mode = .lazy;

            var dir_to_use: string = opts.routes.static_dir;
            const static_dir_set = opts.routes.static_dir_enabled or dir_to_use.len == 0;
            var disabled_static = false;

            var chosen_dir = dir_to_use;

            if (!static_dir_set) {
                chosen_dir = choice: {
                    if (fs.fs.readDirectory(fs.top_level_dir, null)) |dir_| {
                        const dir: *const Fs.FileSystem.RealFS.EntriesOption = dir_;
                        switch (dir.*) {
                            .entries => {
                                if (dir.entries.getComptimeQuery("public")) |q| {
                                    if (q.entry.kind(&fs.fs) == .dir) {
                                        break :choice "public";
                                    }
                                }

                                if (dir.entries.getComptimeQuery("static")) |q| {
                                    if (q.entry.kind(&fs.fs) == .dir) {
                                        break :choice "static";
                                    }
                                }

                                break :choice ".";
                            },
                            else => {
                                break :choice "";
                            },
                        }
                    } else |_| {
                        break :choice "";
                    }
                };

                if (chosen_dir.len == 0) {
                    disabled_static = true;
                    opts.routes.static_dir_enabled = false;
                }
            }

            if (!disabled_static) {
                var _dirs = [_]string{chosen_dir};
                opts.routes.static_dir = try fs.absAlloc(allocator, &_dirs);
                opts.routes.static_dir_handle = std.fs.openDirAbsolute(opts.routes.static_dir, .{ .iterate = true }) catch |err| brk: {
                    switch (err) {
                        error.FileNotFound => {
                            opts.routes.static_dir_enabled = false;
                        },
                        error.AccessDenied => {
                            Output.prettyErrorln(
                                "error: access denied when trying to open directory for static files: \"{s}\".\nPlease re-open bun with access to this folder or pass a different folder via \"--public-dir\". Note: --public-dir is relative to --cwd (or the process' current working directory).\n\nThe public folder is where static assets such as images, fonts, and .html files go.",
                                .{opts.routes.static_dir},
                            );
                            std.process.exit(1);
                        },
                        else => {
                            Output.prettyErrorln(
                                "error: \"{s}\" when accessing public folder: \"{s}\"",
                                .{ @errorName(err), opts.routes.static_dir },
                            );
                            std.process.exit(1);
                        },
                    }

                    break :brk null;
                };
                opts.routes.static_dir_enabled = opts.routes.static_dir_handle != null;
            }

            const should_try_to_find_a_index_html_file = (opts.framework == null or !opts.framework.?.server.isEnabled()) and
                !opts.routes.routes_enabled;

            if (opts.routes.static_dir_enabled and should_try_to_find_a_index_html_file) {
                const dir = opts.routes.static_dir_handle.?;
                var index_html_file = dir.openFile("index.html", .{ .mode = .read_only }) catch |err| brk: {
                    switch (err) {
                        error.FileNotFound => {},
                        else => {
                            Output.prettyErrorln(
                                "{s} when trying to open {s}/index.html. single page app routing is disabled.",
                                .{ @errorName(err), opts.routes.static_dir },
                            );
                        },
                    }

                    opts.routes.single_page_app_routing = false;
                    break :brk null;
                };

                if (index_html_file) |index_dot_html| {
                    opts.routes.single_page_app_routing = true;
                    opts.routes.single_page_app_fd = index_dot_html.handle;
                }
            }

            if (!opts.routes.single_page_app_routing and should_try_to_find_a_index_html_file) {
                attempt: {
                    var abs_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    // If it's not in static-dir/index.html, check if it's in top level dir/index.html
                    var parts = [_]string{"index.html"};
                    var full_path = resolve_path.joinAbsStringBuf(fs.top_level_dir, &abs_buf, &parts, .auto);
                    abs_buf[full_path.len] = 0;
                    var abs_buf_z: [:0]u8 = abs_buf[0..full_path.len :0];

                    const file = std.fs.openFileAbsoluteZ(abs_buf_z, .{ .mode = .read_only }) catch |err| {
                        switch (err) {
                            error.FileNotFound => {},
                            else => {
                                Output.prettyErrorln(
                                    "{s} when trying to open {s}/index.html. single page app routing is disabled.",
                                    .{ @errorName(err), fs.top_level_dir },
                                );
                            },
                        }
                        break :attempt;
                    };

                    opts.routes.single_page_app_routing = true;
                    opts.routes.single_page_app_fd = file.handle;
                }
            }

            // Windows has weird locking rules for file access.
            // so it's a bad idea to keep a file handle open for a long time on Windows.
            if (Environment.isWindows and opts.routes.static_dir_handle != null) {
                opts.routes.static_dir_handle.?.close();
            }
            opts.hot_module_reloading = opts.platform.isWebLike();

            if (transform.disable_hmr orelse false)
                opts.hot_module_reloading = false;

            opts.serve = true;
        } else {
            opts.sourcemap = SourceMapOption.fromApi(transform.source_map orelse Api.SourceMapMode._none);
        }

        opts.tree_shaking = opts.serve or opts.platform.isBun() or opts.production or is_generating_bundle;

        if (opts.origin.isAbsolute()) {
            opts.import_path_format = ImportPathFormat.absolute_url;
        }

        if (opts.write and opts.output_dir.len > 0) {
            opts.output_dir_handle = try openOutputDir(opts.output_dir);
            opts.output_dir = try fs.getFdPath(opts.output_dir_handle.?.fd);
        }

        opts.polyfill_node_globals = opts.platform != .node;

        Analytics.Features.framework = Analytics.Features.framework or opts.framework != null;
        Analytics.Features.filesystem_router = Analytics.Features.filesystem_router or opts.routes.routes_enabled;
        Analytics.Features.origin = Analytics.Features.origin or transform.origin != null;
        Analytics.Features.public_folder = Analytics.Features.public_folder or opts.routes.static_dir_enabled;
        Analytics.Features.bun_bun = Analytics.Features.bun_bun or transform.node_modules_bundle_path != null;
        Analytics.Features.bunjs = Analytics.Features.bunjs or transform.node_modules_bundle_path_server != null;
        Analytics.Features.macros = Analytics.Features.macros or opts.platform == .bun_macro;
        Analytics.Features.external = Analytics.Features.external or transform.external.len > 0;
        Analytics.Features.single_page_app_routing = Analytics.Features.single_page_app_routing or opts.routes.single_page_app_routing;
        return opts;
    }
};

pub fn openOutputDir(output_dir: string) !std.fs.Dir {
    return std.fs.cwd().openDir(output_dir, std.fs.Dir.OpenDirOptions{ .iterate = true }) catch brk: {
        std.fs.cwd().makeDir(output_dir) catch |err| {
            Output.printErrorln("error: Unable to mkdir \"{s}\": \"{s}\"", .{ output_dir, @errorName(err) });
            Global.crash();
        };

        var handle = std.fs.cwd().openDir(output_dir, std.fs.Dir.OpenDirOptions{ .iterate = true }) catch |err2| {
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
    origin: string = "",
    preserve_symlinks: bool = false,
    entry_point: Fs.File,
    resolve_paths: bool = false,
    tsconfig_override: ?string = null,

    platform: Platform = Platform.browser,
    main_fields: []string = Platform.DefaultMainFields.get(Platform.browser),

    pub fn initUncached(allocator: std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        var entryPoint = Fs.File{
            .path = Fs.Path.init(entryPointName),
            .contents = code,
        };

        var cwd: string = "/";
        if (Environment.isWasi or Environment.isWindows) {
            cwd = try std.process.getCwdAlloc(allocator);
        }

        var define = std.StringHashMap(string).init(allocator);
        try define.ensureTotalCapacity(1);

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
        close_handle_on_complete: bool = false,
        autowatch: bool = true,

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
            .loader = loader,
            .input = pending.pathConst().?.*,
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

    pub fn copyTo(file: *const OutputFile, _: string, rel_path: []u8, dir: FileDescriptorType) !void {
        var dir_obj = std.fs.Dir{ .fd = dir };
        const file_out = (try dir_obj.createFile(rel_path, .{}));

        const fd_out = file_out.handle;
        var do_close = false;
        // TODO: close file_out on error
        const fd_in = (try std.fs.openFileAbsolute(file.input.text, .{ .mode = .read_only })).handle;

        if (Environment.isWindows) {
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

        if (comptime @import("builtin").target.isDarwin()) {
            const rc = os.system.fcopyfile(fd_in, fd_out, null, os.system.COPYFILE_DATA);
            if (rc == 0) {
                return;
            }
        }

        if (@import("builtin").target.os.tag == .linux) {
            // Try copy_file_range first as that works at the FS level and is the
            // most efficient method (if available).
            var offset: u64 = 0;
            cfr_loop: while (true) {
                const math = std.math;
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
        allocator: std.mem.Allocator,
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

pub const Env = struct {
    const Entry = struct {
        key: string,
        value: string,
    };
    const List = std.MultiArrayList(Entry);

    behavior: Api.DotEnvBehavior = Api.DotEnvBehavior.disable,
    prefix: string = "",
    defaults: List = List{},
    allocator: std.mem.Allocator = undefined,

    pub fn init(
        allocator: std.mem.Allocator,
    ) Env {
        return Env{
            .allocator = allocator,
            .defaults = List{},
            .prefix = "",
            .behavior = Api.DotEnvBehavior.disable,
        };
    }

    pub fn ensureTotalCapacity(this: *Env, capacity: u64) !void {
        try this.defaults.ensureTotalCapacity(this.allocator, capacity);
    }

    pub fn setDefaultsMap(this: *Env, defaults: Api.StringMap) !void {
        this.defaults.shrinkRetainingCapacity(0);

        if (defaults.keys.len == 0) {
            return;
        }

        try this.defaults.ensureTotalCapacity(this.allocator, defaults.keys.len);

        for (defaults.keys) |key, i| {
            this.defaults.appendAssumeCapacity(.{ .key = key, .value = defaults.values[i] });
        }
    }

    // For reading from API
    pub fn setFromAPI(this: *Env, config: Api.EnvConfig) !void {
        this.setBehaviorFromPrefix(config.prefix orelse "");

        if (config.defaults) |defaults| {
            try this.setDefaultsMap(defaults);
        }
    }

    pub fn setBehaviorFromPrefix(this: *Env, prefix: string) void {
        this.behavior = Api.DotEnvBehavior.disable;
        this.prefix = "";

        if (strings.eqlComptime(prefix, "*")) {
            this.behavior = Api.DotEnvBehavior.load_all;
        } else if (prefix.len > 0) {
            this.behavior = Api.DotEnvBehavior.prefix;
            this.prefix = prefix;
        }
    }

    pub fn setFromLoaded(this: *Env, config: Api.LoadedEnvConfig, allocator: std.mem.Allocator) !void {
        this.allocator = allocator;
        this.behavior = switch (config.dotenv) {
            Api.DotEnvBehavior.prefix => Api.DotEnvBehavior.prefix,
            Api.DotEnvBehavior.load_all => Api.DotEnvBehavior.load_all,
            else => Api.DotEnvBehavior.disable,
        };

        this.prefix = config.prefix;

        try this.setDefaultsMap(config.defaults);
    }

    pub fn toAPI(this: *const Env) Api.LoadedEnvConfig {
        var slice = this.defaults.slice();

        return Api.LoadedEnvConfig{
            .dotenv = this.behavior,
            .prefix = this.prefix,
            .defaults = .{ .keys = slice.items(.key), .values = slice.items(.value) },
        };
    }

    // For reading from package.json
    pub fn getOrPutValue(this: *Env, key: string, value: string) !void {
        var slice = this.defaults.slice();
        const keys = slice.items(.key);
        for (keys) |_key| {
            if (strings.eql(key, _key)) {
                return;
            }
        }

        try this.defaults.append(this.allocator, .{ .key = key, .value = value });
    }
};

pub const EntryPoint = struct {
    path: string = "",
    env: Env = Env{},
    kind: Kind = Kind.disabled,

    pub fn isEnabled(this: *const EntryPoint) bool {
        return this.kind != .disabled and this.path.len > 0;
    }

    pub const Kind = enum {
        client,
        server,
        fallback,
        disabled,

        pub fn toAPI(this: Kind) Api.FrameworkEntryPointType {
            return switch (this) {
                .client => .client,
                .server => .server,
                .fallback => .fallback,
                else => unreachable,
            };
        }
    };

    pub fn toAPI(this: *const EntryPoint, allocator: std.mem.Allocator, toplevel_path: string, kind: Kind) !?Api.FrameworkEntryPoint {
        if (this.kind == .disabled)
            return null;

        return Api.FrameworkEntryPoint{ .kind = kind.toAPI(), .env = this.env.toAPI(), .path = try this.normalizedPath(allocator, toplevel_path) };
    }

    fn normalizedPath(this: *const EntryPoint, allocator: std.mem.Allocator, toplevel_path: string) !string {
        std.debug.assert(std.fs.path.isAbsolute(this.path));
        var str = this.path;
        if (strings.indexOf(str, toplevel_path)) |top| {
            str = str[top + toplevel_path.len ..];
        }

        // if it *was* a node_module path, we don't do any allocation, we just keep it as a package path
        if (strings.indexOf(str, "node_modules" ++ std.fs.path.sep_str)) |node_module_i| {
            return str[node_module_i + "node_modules".len + 1 ..];
            // otherwise, we allocate a new string and copy the path into it with a leading "./"

        } else {
            var out = try allocator.alloc(u8, str.len + 2);
            out[0] = '.';
            out[1] = '/';
            std.mem.copy(u8, out[2..], str);
            return out;
        }
    }

    pub fn fromLoaded(
        this: *EntryPoint,
        framework_entry_point: Api.FrameworkEntryPoint,
        allocator: std.mem.Allocator,
        kind: Kind,
    ) !void {
        this.path = framework_entry_point.path;
        this.kind = kind;
        this.env.setFromLoaded(framework_entry_point.env, allocator) catch {};
    }

    pub fn fromAPI(
        this: *EntryPoint,
        framework_entry_point: Api.FrameworkEntryPointMessage,
        allocator: std.mem.Allocator,
        kind: Kind,
    ) !void {
        this.path = framework_entry_point.path orelse "";
        this.kind = kind;

        if (this.path.len == 0) {
            this.kind = .disabled;
            return;
        }

        if (framework_entry_point.env) |env| {
            this.env.allocator = allocator;
            try this.env.setFromAPI(env);
        }
    }
};

pub const Framework = struct {
    client: EntryPoint = EntryPoint{},
    server: EntryPoint = EntryPoint{},
    fallback: EntryPoint = EntryPoint{},

    display_name: string = "",
    /// "version" field in package.json
    version: string = "",
    /// "name" field in package.json
    package: string = "",
    development: bool = true,
    resolved: bool = false,
    from_bundle: bool = false,

    resolved_dir: string = "",
    override_modules: Api.StringMap = Api.StringMap{},
    override_modules_hashes: []u64 = &[_]u64{},

    client_css_in_js: Api.CssInJsBehavior = .auto_onimportcss,

    pub const fallback_html: string = @embedFile("./fallback.html");

    pub fn platformEntryPoint(this: *const Framework, platform: Platform) ?*const EntryPoint {
        const entry: *const EntryPoint = switch (platform) {
            .neutral, .browser => &this.client,
            .bun => &this.server,
            .node => return null,
        };

        if (entry.kind == .disabled) return null;
        return entry;
    }

    pub fn fromLoadedFramework(loaded: Api.LoadedFramework, allocator: std.mem.Allocator) !Framework {
        var framework = Framework{
            .package = loaded.package,
            .development = loaded.development,
            .from_bundle = true,
            .client_css_in_js = loaded.client_css_in_js,
            .display_name = loaded.display_name,
            .override_modules = loaded.override_modules,
        };

        if (loaded.entry_points.fallback) |fallback| {
            try framework.fallback.fromLoaded(fallback, allocator, .fallback);
        }

        if (loaded.entry_points.client) |client| {
            try framework.client.fromLoaded(client, allocator, .client);
        }

        if (loaded.entry_points.server) |server| {
            try framework.server.fromLoaded(server, allocator, .server);
        }

        return framework;
    }

    pub fn toAPI(
        this: *const Framework,
        allocator: std.mem.Allocator,
        toplevel_path: string,
    ) !?Api.LoadedFramework {
        if (this.client.kind == .disabled and this.server.kind == .disabled and this.fallback.kind == .disabled) return null;

        return Api.LoadedFramework{
            .package = this.package,
            .development = this.development,
            .display_name = this.display_name,
            .entry_points = .{
                .client = try this.client.toAPI(allocator, toplevel_path, .client),
                .fallback = try this.fallback.toAPI(allocator, toplevel_path, .fallback),
                .server = try this.server.toAPI(allocator, toplevel_path, .server),
            },
            .client_css_in_js = this.client_css_in_js,
            .override_modules = this.override_modules,
        };
    }

    pub fn needsResolveFromPackage(this: *const Framework) bool {
        return !this.resolved and this.package.len > 0;
    }

    pub fn fromApi(
        transform: Api.FrameworkConfig,
        allocator: std.mem.Allocator,
    ) !Framework {
        var client = EntryPoint{};
        var server = EntryPoint{};
        var fallback = EntryPoint{};

        if (transform.client) |_client| {
            try client.fromAPI(_client, allocator, .client);
        }

        if (transform.server) |_server| {
            try server.fromAPI(_server, allocator, .server);
        }

        if (transform.fallback) |_fallback| {
            try fallback.fromAPI(_fallback, allocator, .fallback);
        }

        return Framework{
            .client = client,
            .server = server,
            .fallback = fallback,
            .package = transform.package orelse "",
            .display_name = transform.display_name orelse "",
            .development = transform.development orelse true,
            .override_modules = transform.override_modules orelse .{ .keys = &.{}, .values = &.{} },
            .resolved = false,
            .client_css_in_js = switch (transform.client_css_in_js orelse .auto_onimportcss) {
                .facade_onimportcss => .facade_onimportcss,
                .facade => .facade,
                else => .auto_onimportcss,
            },
        };
    }
};

pub const RouteConfig = struct {
    dir: string = "",
    possible_dirs: []const string = &[_]string{},

    // Frameworks like Next.js (and others) use a special prefix for bundled/transpiled assets
    // This is combined with "origin" when printing import paths
    asset_prefix_path: string = "",

    // TODO: do we need a separate list for data-only extensions?
    // e.g. /foo.json just to get the data for the route, without rendering the html
    // I think it's fine to hardcode as .json for now, but if I personally were writing a framework
    // I would consider using a custom binary format to minimize request size
    // maybe like CBOR
    extensions: []const string = &[_][]const string{},
    routes_enabled: bool = false,

    static_dir: string = "",
    static_dir_handle: ?std.fs.Dir = null,
    static_dir_enabled: bool = false,
    single_page_app_routing: bool = false,
    single_page_app_fd: StoredFileDescriptorType = 0,

    pub fn toAPI(this: *const RouteConfig) Api.LoadedRouteConfig {
        return .{
            .asset_prefix = this.asset_prefix_path,
            .dir = if (this.routes_enabled) this.dir else "",
            .extensions = this.extensions,
            .static_dir = if (this.static_dir_enabled) this.static_dir else "",
        };
    }

    pub const DefaultDir = "pages";
    pub const DefaultStaticDir: string = "public";
    pub const DefaultExtensions = [_]string{ "tsx", "ts", "mjs", "jsx", "js" };
    pub inline fn zero() RouteConfig {
        return RouteConfig{
            .dir = DefaultDir,
            .extensions = std.mem.span(&DefaultExtensions),
            .static_dir = DefaultStaticDir,
            .routes_enabled = false,
        };
    }

    pub fn fromLoadedRoutes(loaded: Api.LoadedRouteConfig) RouteConfig {
        return RouteConfig{
            .extensions = loaded.extensions,
            .dir = loaded.dir,
            .asset_prefix_path = loaded.asset_prefix,
            .static_dir = loaded.static_dir,
            .routes_enabled = loaded.dir.len > 0,
            .static_dir_enabled = loaded.static_dir.len > 0,
        };
    }

    pub fn fromApi(router_: Api.RouteConfig, allocator: std.mem.Allocator) !RouteConfig {
        var router = zero();

        var static_dir: string = std.mem.trimRight(u8, router_.static_dir orelse "", "/\\");
        var asset_prefix: string = std.mem.trimRight(u8, router_.asset_prefix orelse "", "/\\");

        switch (router_.dir.len) {
            0 => {},
            1 => {
                router.dir = std.mem.trimRight(u8, router_.dir[0], "/\\");
                router.routes_enabled = router.dir.len > 0;
            },
            else => {
                router.possible_dirs = router_.dir;
                for (router_.dir) |dir| {
                    const trimmed = std.mem.trimRight(u8, dir, "/\\");
                    if (trimmed.len > 0) {
                        router.dir = trimmed;
                    }
                }

                router.routes_enabled = router.dir.len > 0;
            },
        }

        if (static_dir.len > 0) {
            router.static_dir = static_dir;
        }

        if (asset_prefix.len > 0) {
            router.asset_prefix_path = asset_prefix;
        }

        if (router_.extensions.len > 0) {
            var count: usize = 0;
            for (router_.extensions) |_ext| {
                const ext = std.mem.trimLeft(u8, _ext, ".");

                if (ext.len == 0) {
                    continue;
                }

                count += 1;
            }

            var extensions = try allocator.alloc(string, count);
            var remainder = extensions;

            for (router_.extensions) |_ext| {
                const ext = std.mem.trimLeft(u8, _ext, ".");

                if (ext.len == 0) {
                    continue;
                }

                remainder[0] = ext;
                remainder = remainder[1..];
            }

            router.extensions = extensions;
        }

        return router;
    }
};
