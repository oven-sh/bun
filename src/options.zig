/// This file is mostly the API schema but with all the options normalized.
/// Normalization is necessary because most fields in the API schema are optional
const std = @import("std");
const logger = bun.logger;
const Fs = @import("fs.zig");

const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const URL = @import("./url.zig").URL;
const ConditionsMap = @import("./resolver/package_json.zig").ESModule.ConditionsMap;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FileDescriptorType = bun.FileDescriptor;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const JSC = bun.JSC;
const Runtime = @import("./runtime.zig").Runtime;
const Analytics = @import("./analytics/analytics_thread.zig");
const MacroRemap = @import("./resolver/package_json.zig").MacroMap;
const DotEnv = @import("./env_loader.zig");

pub const defines = @import("./defines.zig");
pub const Define = defines.Define;

const assert = bun.assert;

pub const WriteDestination = enum {
    stdout,
    disk,
    // eventually: wasm
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
    // TODO: switch to getFdPath()-based implementation
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
        try hash_map.ensureTotalCapacity(@as(u32, @intCast(keys.len)));
        for (keys, 0..) |key, i| {
            hash_map.putAssumeCapacity(key, values[i]);
        }
    }

    return hash_map;
}

pub const ExternalModules = struct {
    node_modules: std.BufSet = undefined,
    abs_paths: std.BufSet = undefined,
    patterns: []const WildcardPattern = undefined,

    pub const WildcardPattern = struct {
        prefix: string,
        suffix: string,
    };

    pub fn isNodeBuiltin(str: string) bool {
        return bun.JSC.HardcodedModule.Aliases.has(str, .node);
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
        target: Target,
    ) ExternalModules {
        var result = ExternalModules{
            .node_modules = std.BufSet.init(allocator),
            .abs_paths = std.BufSet.init(allocator),
            .patterns = default_wildcard_patterns[0..],
        };

        switch (target) {
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
        patterns.appendSliceAssumeCapacity(default_wildcard_patterns[0..]);

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

        result.patterns = patterns.toOwnedSlice() catch @panic("TODO");

        return result;
    }

    const NodeBuiltinPatternsRaw = [_]string{
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

    pub const NodeBuiltinPatterns = NodeBuiltinPatternsRaw ++ brk: {
        var builtins = NodeBuiltinPatternsRaw;
        for (&builtins) |*builtin| {
            builtin.* = "node:" ++ builtin.*;
        }
        break :brk builtins;
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

    pub const NodeBuiltinsMap = bun.ComptimeStringMap(void, .{
        .{ "_http_agent", {} },
        .{ "_http_client", {} },
        .{ "_http_common", {} },
        .{ "_http_incoming", {} },
        .{ "_http_outgoing", {} },
        .{ "_http_server", {} },
        .{ "_stream_duplex", {} },
        .{ "_stream_passthrough", {} },
        .{ "_stream_readable", {} },
        .{ "_stream_transform", {} },
        .{ "_stream_wrap", {} },
        .{ "_stream_writable", {} },
        .{ "_tls_common", {} },
        .{ "_tls_wrap", {} },
        .{ "assert", {} },
        .{ "async_hooks", {} },
        .{ "buffer", {} },
        .{ "child_process", {} },
        .{ "cluster", {} },
        .{ "console", {} },
        .{ "constants", {} },
        .{ "crypto", {} },
        .{ "dgram", {} },
        .{ "diagnostics_channel", {} },
        .{ "dns", {} },
        .{ "domain", {} },
        .{ "events", {} },
        .{ "fs", {} },
        .{ "http", {} },
        .{ "http2", {} },
        .{ "https", {} },
        .{ "inspector", {} },
        .{ "module", {} },
        .{ "net", {} },
        .{ "os", {} },
        .{ "path", {} },
        .{ "perf_hooks", {} },
        .{ "process", {} },
        .{ "punycode", {} },
        .{ "querystring", {} },
        .{ "readline", {} },
        .{ "repl", {} },
        .{ "stream", {} },
        .{ "string_decoder", {} },
        .{ "sys", {} },
        .{ "timers", {} },
        .{ "tls", {} },
        .{ "trace_events", {} },
        .{ "tty", {} },
        .{ "url", {} },
        .{ "util", {} },
        .{ "v8", {} },
        .{ "vm", {} },
        .{ "wasi", {} },
        .{ "worker_threads", {} },
        .{ "zlib", {} },
    });
};

pub const BundlePackage = enum {
    always,
    never,

    pub const Map = bun.StringArrayHashMapUnmanaged(BundlePackage);
};

pub const ModuleType = enum {
    unknown,
    cjs,
    esm,

    pub const List = bun.ComptimeStringMap(ModuleType, .{
        .{ "commonjs", ModuleType.cjs },
        .{ "module", ModuleType.esm },
    });
};

pub const Target = enum {
    browser,
    bun,
    bun_macro,
    node,

    /// This is used by bake.Framework.ServerComponents.separate_ssr_graph
    bake_server_components_ssr,

    pub const Map = bun.ComptimeStringMap(Target, .{
        .{ "browser", .browser },
        .{ "bun", .bun },
        .{ "bun_macro", .bun_macro },
        .{ "macro", .bun_macro },
        .{ "node", .node },
    });

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue) bun.JSError!?Target {
        if (!value.isString()) {
            return global.throwInvalidArguments("target must be a string", .{});
        }
        return Map.fromJS(global, value);
    }

    pub fn toAPI(this: Target) Api.Target {
        return switch (this) {
            .node => .node,
            .browser => .browser,
            .bun, .bake_server_components_ssr => .bun,
            .bun_macro => .bun_macro,
        };
    }

    pub inline fn isServerSide(this: Target) bool {
        return switch (this) {
            .bun_macro, .node, .bun, .bake_server_components_ssr => true,
            else => false,
        };
    }

    pub inline fn isBun(this: Target) bool {
        return switch (this) {
            .bun_macro, .bun, .bake_server_components_ssr => true,
            else => false,
        };
    }

    pub inline fn isNode(this: Target) bool {
        return switch (this) {
            .node => true,
            else => false,
        };
    }

    pub inline fn processBrowserDefineValue(this: Target) ?string {
        return switch (this) {
            .browser => "true",
            else => "false",
        };
    }

    pub fn bakeGraph(target: Target) bun.bake.Graph {
        return switch (target) {
            .browser => .client,
            .bake_server_components_ssr => .ssr,
            .bun_macro, .bun, .node => .server,
        };
    }

    pub fn outExtensions(target: Target, allocator: std.mem.Allocator) bun.StringHashMap(string) {
        var exts = bun.StringHashMap(string).init(allocator);

        const out_extensions_list = [_][]const u8{ ".js", ".cjs", ".mts", ".cts", ".ts", ".tsx", ".jsx", ".json" };

        if (target == .node) {
            exts.ensureTotalCapacity(out_extensions_list.len * 2) catch unreachable;
            for (out_extensions_list) |ext| {
                exts.put(ext, ".mjs") catch unreachable;
            }
        } else {
            exts.ensureTotalCapacity(out_extensions_list.len + 1) catch unreachable;
            exts.put(".mjs", ".js") catch unreachable;
        }

        for (out_extensions_list) |ext| {
            exts.put(ext, ".js") catch unreachable;
        }

        return exts;
    }

    pub fn from(plat: ?api.Api.Target) Target {
        return switch (plat orelse api.Api.Target._none) {
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
    pub const DefaultMainFields: std.EnumArray(Target, []const string) = brk: {
        var array = std.EnumArray(Target, []const string).initUndefined();

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
        const list = [_]string{ MAIN_FIELD_NAMES[2], MAIN_FIELD_NAMES[1] };
        array.set(Target.node, &list);

        // Note that this means if a package specifies "main", "module", and
        // "browser" then "browser" will win out over "module". This is the
        // same behavior as webpack: https://github.com/webpack/webpack/issues/4674.
        //
        // This is deliberate because the presence of the "browser" field is a
        // good signal that this should be preferred. Some older packages might only use CJS in their "browser"
        // but in such a case they probably don't have any ESM files anyway.
        const listc = [_]string{ MAIN_FIELD_NAMES[0], MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[3], MAIN_FIELD_NAMES[2] };
        const listd = [_]string{ MAIN_FIELD_NAMES[1], MAIN_FIELD_NAMES[2], MAIN_FIELD_NAMES[3] };

        array.set(Target.browser, &listc);
        array.set(Target.bun, &listd);
        array.set(Target.bun_macro, &listd);
        array.set(Target.bake_server_components_ssr, &listd);

        // Original comment:
        // The neutral target is for people that don't want esbuild to try to
        // pick good defaults for their platform. In that case, the list of main
        // fields is empty by default. You must explicitly configure it yourself.
        // array.set(Target.neutral, &listc);

        break :brk array;
    };

    pub const default_conditions: std.EnumArray(Target, []const string) = brk: {
        var array = std.EnumArray(Target, []const string).initUndefined();

        array.set(Target.node, &.{
            "node",
        });
        array.set(Target.browser, &.{
            "browser",
            "module",
        });
        array.set(Target.bun, &.{
            "bun",
            "node",
        });
        array.set(Target.bake_server_components_ssr, &.{
            "bun",
            "node",
        });
        array.set(Target.bun_macro, &.{
            "macro",
            "bun",
            "node",
        });

        break :brk array;
    };

    pub fn defaultConditions(t: Target) []const []const u8 {
        return default_conditions.get(t);
    }
};

pub const Format = enum {
    /// ES module format
    /// This is the default format
    esm,

    /// Immediately-invoked function expression
    /// (function(){
    ///     ...
    /// })();
    iife,

    /// CommonJS
    cjs,

    /// Bake uses a special module format for Hot-module-reloading. It includes a
    /// runtime payload, sourced from src/bake/hmr-runtime-{side}.ts.
    ///
    /// ((input_graph, config) => {
    ///   ... runtime code ...
    /// })({
    ///   "module1.ts"(module) { ... },
    ///   "module2.ts"(module) { ... },
    /// }, { metadata });
    internal_bake_dev,

    pub fn keepES6ImportExportSyntax(this: Format) bool {
        return this == .esm;
    }

    pub inline fn isESM(this: Format) bool {
        return this == .esm;
    }

    pub inline fn isAlwaysStrictMode(this: Format) bool {
        return this == .esm;
    }

    pub const Map = bun.ComptimeStringMap(Format, .{
        .{ "esm", .esm },
        .{ "cjs", .cjs },
        .{ "iife", .iife },

        // TODO: Disable this outside of debug builds
        .{ "internal_bake_dev", .internal_bake_dev },
    });

    pub fn fromJS(global: *JSC.JSGlobalObject, format: JSC.JSValue) bun.JSError!?Format {
        if (format.isUndefinedOrNull()) return null;

        if (!format.isString()) {
            return global.throwInvalidArguments("format must be a string", .{});
        }

        return Map.fromJS(global, format) orelse {
            return global.throwInvalidArguments("Invalid format - must be esm, cjs, or iife", .{});
        };
    }

    pub fn fromString(slice: string) ?Format {
        return Map.getWithEql(slice, strings.eqlComptime);
    }
};

pub const Loader = enum(u8) {
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
    base64,
    dataurl,
    text,
    bunsh,
    sqlite,
    sqlite_embedded,
    html,

    pub fn disableHTML(this: Loader) Loader {
        return switch (this) {
            .html => .file,
            else => this,
        };
    }

    pub inline fn isSQLite(this: Loader) bool {
        return switch (this) {
            .sqlite, .sqlite_embedded => true,
            else => false,
        };
    }

    pub fn shouldCopyForBundling(this: Loader) bool {
        return switch (this) {
            .file,
            .napi,
            .sqlite,
            .sqlite_embedded,
            // TODO: loader for reading bytes and creating module or instance
            .wasm,
            => true,
            .css => false,
            .html => false,
            else => false,
        };
    }

    pub fn toMimeType(this: Loader) bun.http.MimeType {
        return switch (this) {
            .jsx, .js, .ts, .tsx => bun.http.MimeType.javascript,
            .css => bun.http.MimeType.css,
            .toml, .json => bun.http.MimeType.json,
            .wasm => bun.http.MimeType.wasm,
            .html => bun.http.MimeType.html,
            else => bun.http.MimeType.other,
        };
    }

    pub const HashTable = bun.StringArrayHashMap(Loader);

    pub fn canHaveSourceMap(this: Loader) bool {
        return switch (this) {
            .jsx, .js, .ts, .tsx => true,
            else => false,
        };
    }

    pub fn canBeRunByBun(this: Loader) bool {
        return switch (this) {
            .jsx, .js, .ts, .tsx, .wasm, .bunsh => true,
            else => false,
        };
    }

    pub const Map = std.EnumArray(Loader, string);
    pub const stdin_name: Map = brk: {
        var map = Map.initFill("");
        map.set(.jsx, "input.jsx");
        map.set(.js, "input.js");
        map.set(.ts, "input.ts");
        map.set(.tsx, "input.tsx");
        map.set(.css, "input.css");
        map.set(.file, "input");
        map.set(.json, "input.json");
        map.set(.toml, "input.toml");
        map.set(.wasm, "input.wasm");
        map.set(.napi, "input.node");
        map.set(.text, "input.txt");
        map.set(.bunsh, "input.sh");
        map.set(.html, "input.html");
        break :brk map;
    };

    pub inline fn stdinName(this: Loader) string {
        return stdin_name.get(this);
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, loader: JSC.JSValue) bun.JSError!?Loader {
        if (loader.isUndefinedOrNull()) return null;

        if (!loader.isString()) {
            return global.throwInvalidArguments("loader must be a string", .{});
        }

        var zig_str = JSC.ZigString.init("");
        loader.toZigString(&zig_str, global);
        if (zig_str.len == 0) return null;

        return fromString(zig_str.slice()) orelse {
            return global.throwInvalidArguments("invalid loader - must be js, jsx, tsx, ts, css, file, toml, wasm, bunsh, or json", .{});
        };
    }

    pub const names = bun.ComptimeStringMap(Loader, .{
        .{ "js", .js },
        .{ "mjs", .js },
        .{ "cjs", .js },
        .{ "cts", .ts },
        .{ "mts", .ts },
        .{ "jsx", .jsx },
        .{ "ts", .ts },
        .{ "tsx", .tsx },
        .{ "css", .css },
        .{ "file", .file },
        .{ "json", .json },
        .{ "jsonc", .json },
        .{ "toml", .toml },
        .{ "wasm", .wasm },
        .{ "node", .napi },
        .{ "dataurl", .dataurl },
        .{ "base64", .base64 },
        .{ "txt", .text },
        .{ "text", .text },
        .{ "sh", .bunsh },
        .{ "sqlite", .sqlite },
        .{ "sqlite_embedded", .sqlite_embedded },
        .{ "html", .html },
    });

    pub const api_names = bun.ComptimeStringMap(Api.Loader, .{
        .{ "js", .js },
        .{ "mjs", .js },
        .{ "cjs", .js },
        .{ "cts", .ts },
        .{ "mts", .ts },
        .{ "jsx", .jsx },
        .{ "ts", .ts },
        .{ "tsx", .tsx },
        .{ "css", .css },
        .{ "file", .file },
        .{ "json", .json },
        .{ "jsonc", .json },
        .{ "toml", .toml },
        .{ "wasm", .wasm },
        .{ "node", .napi },
        .{ "dataurl", .dataurl },
        .{ "base64", .base64 },
        .{ "txt", .text },
        .{ "text", .text },
        .{ "sh", .file },
        .{ "sqlite", .sqlite },
        .{ "html", .html },
    });

    pub fn fromString(slice_: string) ?Loader {
        var slice = slice_;
        if (slice.len > 0 and slice[0] == '.') {
            slice = slice[1..];
        }

        return names.getWithEql(slice, strings.eqlCaseInsensitiveASCIIICheckLength);
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
            .html => .html,
            .file, .bunsh => .file,
            .json => .json,
            .toml => .toml,
            .wasm => .wasm,
            .napi => .napi,
            .base64 => .base64,
            .dataurl => .dataurl,
            .text => .text,
            .sqlite_embedded, .sqlite => .sqlite,
        };
    }

    pub fn fromAPI(loader: Api.Loader) Loader {
        return switch (loader) {
            ._none => .file,
            .jsx => .jsx,
            .js => .js,
            .ts => .ts,
            .tsx => .tsx,
            .css => .css,
            .file => .file,
            .json => .json,
            .toml => .toml,
            .wasm => .wasm,
            .napi => .napi,
            .base64 => .base64,
            .dataurl => .dataurl,
            .text => .text,
            .html => .html,
            .sqlite => .sqlite,
            _ => .file,
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

            // toml is included because we can serialize to the same AST as JSON
            .toml => true,

            else => false,
        };
    }

    pub fn forFileName(filename: string, obj: anytype) ?Loader {
        const ext = std.fs.path.extension(filename);
        if (ext.len == 0 or (ext.len == 1 and ext[0] == '.')) return null;

        return obj.get(ext);
    }
};

const default_loaders_posix = .{
    .{ ".jsx", .jsx },
    .{ ".json", .json },
    .{ ".js", .jsx },

    .{ ".mjs", .js },
    .{ ".cjs", .js },

    .{ ".css", .css },
    .{ ".ts", .ts },
    .{ ".tsx", .tsx },

    .{ ".mts", .ts },
    .{ ".cts", .ts },

    .{ ".toml", .toml },
    .{ ".wasm", .wasm },
    .{ ".node", .napi },
    .{ ".txt", .text },
    .{ ".text", .text },
    .{ ".html", .html },
    .{ ".jsonc", .json },
};
const default_loaders_win32 = default_loaders_posix ++ .{
    .{ ".sh", .bunsh },
};

const default_loaders = if (Environment.isWindows) default_loaders_win32 else default_loaders_posix;
pub const defaultLoaders = bun.ComptimeStringMap(Loader, default_loaders);

// https://webpack.js.org/guides/package-exports/#reference-syntax
pub const ESMConditions = struct {
    default: ConditionsMap,
    import: ConditionsMap,
    require: ConditionsMap,
    style: ConditionsMap,

    pub fn init(allocator: std.mem.Allocator, defaults: []const string) !ESMConditions {
        var default_condition_amp = ConditionsMap.init(allocator);

        var import_condition_map = ConditionsMap.init(allocator);
        var require_condition_map = ConditionsMap.init(allocator);
        var style_condition_map = ConditionsMap.init(allocator);

        try default_condition_amp.ensureTotalCapacity(defaults.len + 2);
        try import_condition_map.ensureTotalCapacity(defaults.len + 2);
        try require_condition_map.ensureTotalCapacity(defaults.len + 2);
        try style_condition_map.ensureTotalCapacity(defaults.len + 2);

        import_condition_map.putAssumeCapacity("import", {});
        require_condition_map.putAssumeCapacity("require", {});
        style_condition_map.putAssumeCapacity("style", {});

        for (defaults) |default| {
            default_condition_amp.putAssumeCapacityNoClobber(default, {});
            import_condition_map.putAssumeCapacityNoClobber(default, {});
            require_condition_map.putAssumeCapacityNoClobber(default, {});
            style_condition_map.putAssumeCapacityNoClobber(default, {});
        }

        default_condition_amp.putAssumeCapacity("default", {});
        import_condition_map.putAssumeCapacity("default", {});
        require_condition_map.putAssumeCapacity("default", {});
        style_condition_map.putAssumeCapacity("default", {});

        return .{
            .default = default_condition_amp,
            .import = import_condition_map,
            .require = require_condition_map,
            .style = style_condition_map,
        };
    }

    pub fn clone(self: *const ESMConditions) !ESMConditions {
        var default = try self.default.clone();
        errdefer default.deinit();
        var import = try self.import.clone();
        errdefer import.deinit();
        var require = try self.require.clone();
        errdefer require.deinit();
        var style = try self.style.clone();
        errdefer style.deinit();

        return .{
            .default = default,
            .import = import,
            .require = require,
            .style = style,
        };
    }

    pub fn appendSlice(self: *ESMConditions, conditions: []const string) !void {
        try self.default.ensureUnusedCapacity(conditions.len);
        try self.import.ensureUnusedCapacity(conditions.len);
        try self.require.ensureUnusedCapacity(conditions.len);
        try self.style.ensureUnusedCapacity(conditions.len);

        for (conditions) |condition| {
            self.default.putAssumeCapacity(condition, {});
            self.import.putAssumeCapacity(condition, {});
            self.require.putAssumeCapacity(condition, {});
            self.style.putAssumeCapacity(condition, {});
        }
    }
};

pub const JSX = struct {
    pub const RuntimeMap = bun.ComptimeStringMap(JSX.Runtime, .{
        .{ "classic", .classic },
        .{ "automatic", .automatic },
        .{ "react", .classic },
        .{ "react-jsx", .automatic },
        .{ "react-jsxdev", .automatic },
        .{ "solid", .solid },
    });

    pub const Pragma = struct {
        // these need to be arrays
        factory: []const string = Defaults.Factory,
        fragment: []const string = Defaults.Fragment,
        runtime: JSX.Runtime = .automatic,
        import_source: ImportSource = .{},

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        classic_import_source: string = "react",
        package_name: []const u8 = "react",

        development: bool = true,
        parse: bool = true,

        pub const ImportSource = struct {
            development: string = "react/jsx-dev-runtime",
            production: string = "react/jsx-runtime",
        };

        pub fn hashForRuntimeTranspiler(this: *const Pragma, hasher: *std.hash.Wyhash) void {
            for (this.factory) |factory| hasher.update(factory);
            for (this.fragment) |fragment| hasher.update(fragment);
            hasher.update(this.import_source.development);
            hasher.update(this.import_source.production);
            hasher.update(this.classic_import_source);
            hasher.update(this.package_name);
        }

        pub fn importSource(this: *const Pragma) string {
            return switch (this.development) {
                true => this.import_source.development,
                false => this.import_source.production,
            };
        }

        pub fn parsePackageName(str: string) string {
            if (str.len == 0) return str;
            if (str[0] == '@') {
                if (strings.indexOfChar(str[1..], '/')) |first_slash| {
                    const remainder = str[1 + first_slash + 1 ..];

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
            return strings.eqlComptime(pragma.package_name, "react") or
                strings.eqlComptime(pragma.package_name, "@emotion/jsx") or
                strings.eqlComptime(pragma.package_name, "@emotion/react");
        }

        pub fn setImportSource(pragma: *Pragma, allocator: std.mem.Allocator) void {
            strings.concatIfNeeded(
                allocator,
                &pragma.import_source.development,
                &[_]string{
                    pragma.package_name,
                    "/jsx-dev-runtime",
                },
                &.{
                    Defaults.ImportSourceDev,
                },
            ) catch unreachable;

            strings.concatIfNeeded(
                allocator,
                &pragma.import_source.production,
                &[_]string{
                    pragma.package_name,
                    "/jsx-runtime",
                },
                &.{
                    Defaults.ImportSource,
                },
            ) catch unreachable;
        }

        pub fn setProduction(pragma: *Pragma, is_production: bool) void {
            pragma.development = !is_production;
        }

        pub const Defaults = struct {
            pub const Factory = &[_]string{ "React", "createElement" };
            pub const Fragment = &[_]string{ "React", "Fragment" };
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
            const count = strings.countChar(new, '.') + 1;

            var needs_alloc = false;
            var current_i: usize = 0;
            while (splitter.next()) |str| {
                if (str.len == 0) continue;
                if (current_i >= original.len) {
                    needs_alloc = true;
                    break;
                }

                if (!strings.eql(original[current_i], str)) {
                    needs_alloc = true;
                    break;
                }
                current_i += 1;
            }

            if (!needs_alloc) {
                return original;
            }

            var out = try allocator.alloc(string, count);

            splitter = std.mem.split(u8, new, ".");
            var i: usize = 0;
            while (splitter.next()) |str| {
                if (str.len == 0) continue;
                out[i] = str;
                i += 1;
            }
            return out[0..i];
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
                pragma.package_name = jsx.import_source;
                pragma.setImportSource(allocator);
                pragma.classic_import_source = pragma.package_name;
            }

            pragma.development = jsx.development;
            pragma.parse = true;
            return pragma;
        }
    };

    pub const Runtime = api.Api.JsxRuntime;
};

pub const DefaultUserDefines = struct {
    // This must be globally scoped so it doesn't disappear
    pub const NodeEnv = struct {
        pub const Key = "process.env.NODE_ENV";
        pub const Value = "\"development\"";
    };
    pub const ProcessBrowserDefine = struct {
        pub const Key = "process.browser";
        pub const Value = []string{ "false", "true" };
    };
};

pub fn definesFromTransformOptions(
    allocator: std.mem.Allocator,
    log: *logger.Log,
    maybe_input_define: ?Api.StringMap,
    target: Target,
    env_loader: ?*DotEnv.Loader,
    framework_env: ?*const Env,
    NODE_ENV: ?string,
    drop: []const []const u8,
) !*defines.Define {
    const input_user_define = maybe_input_define orelse std.mem.zeroes(Api.StringMap);

    var user_defines = try stringHashMapFromArrays(
        defines.RawDefines,
        allocator,
        input_user_define.keys,
        input_user_define.values,
    );

    var environment_defines = defines.UserDefinesArray.init(allocator);
    defer environment_defines.deinit();

    var behavior: Api.DotEnvBehavior = .disable;

    load_env: {
        const env = env_loader orelse break :load_env;
        const framework = framework_env orelse break :load_env;

        if (Environment.allow_assert) {
            bun.assert(framework.behavior != ._none);
        }

        behavior = framework.behavior;
        if (behavior == .load_all_without_inlining or behavior == .disable)
            break :load_env;

        try env.copyForDefine(
            defines.RawDefines,
            &user_defines,
            defines.UserDefinesArray,
            &environment_defines,
            framework.toAPI().defaults,
            framework.behavior,
            framework.prefix,
            allocator,
        );
    }

    if (behavior != .load_all_without_inlining) {
        const quoted_node_env: string = brk: {
            if (NODE_ENV) |node_env| {
                if (node_env.len > 0) {
                    if ((strings.startsWithChar(node_env, '"') and strings.endsWithChar(node_env, '"')) or
                        (strings.startsWithChar(node_env, '\'') and strings.endsWithChar(node_env, '\'')))
                    {
                        break :brk node_env;
                    }

                    // avoid allocating if we can
                    if (strings.eqlComptime(node_env, "production")) {
                        break :brk "\"production\"";
                    } else if (strings.eqlComptime(node_env, "development")) {
                        break :brk "\"development\"";
                    } else if (strings.eqlComptime(node_env, "test")) {
                        break :brk "\"test\"";
                    } else {
                        break :brk try std.fmt.allocPrint(allocator, "\"{s}\"", .{node_env});
                    }
                }
            }
            break :brk "\"development\"";
        };

        _ = try user_defines.getOrPutValue(
            "process.env.NODE_ENV",
            quoted_node_env,
        );
        _ = try user_defines.getOrPutValue(
            "process.env.BUN_ENV",
            quoted_node_env,
        );

        // Automatically set `process.browser` to `true` for browsers and false for node+js
        // This enables some extra dead code elimination
        if (target.processBrowserDefineValue()) |value| {
            _ = try user_defines.getOrPutValue(DefaultUserDefines.ProcessBrowserDefine.Key, value);
        }
    }

    if (target.isBun()) {
        if (!user_defines.contains("window")) {
            _ = try environment_defines.getOrPutValue("window", .{
                .valueless = true,
                .original_name = "window",
                .value = .{ .e_undefined = .{} },
            });
        }
    }

    const resolved_defines = try defines.DefineData.fromInput(user_defines, drop, log, allocator);

    const drop_debugger = for (drop) |item| {
        if (strings.eqlComptime(item, "debugger")) break true;
    } else false;

    return try defines.Define.init(
        allocator,
        resolved_defines,
        environment_defines,
        drop_debugger,
    );
}

const default_loader_ext_bun = [_]string{ ".node", ".html" };
const default_loader_ext = [_]string{
    ".jsx",   ".json",
    ".js",    ".mjs",
    ".cjs",   ".css",

    // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#new-file-extensions
    ".ts",    ".tsx",
    ".mts",   ".cts",

    ".toml",  ".wasm",
    ".txt",   ".text",

    ".jsonc",
};

// Only set it for browsers by default.
const default_loader_ext_browser = [_]string{
    ".html",
};

const node_modules_default_loader_ext_bun = [_]string{".node"};
const node_modules_default_loader_ext = [_]string{
    ".jsx",
    ".js",
    ".cjs",
    ".mjs",
    ".ts",
    ".mts",
    ".toml",
    ".txt",
    ".json",
    ".jsonc",
    ".css",
    ".tsx",
    ".cts",
    ".wasm",
    ".text",
    ".html",
};

pub const ResolveFileExtensions = struct {
    node_modules: Group = .{
        .esm = &BundleOptions.Defaults.NodeModules.ModuleExtensionOrder,
        .default = &BundleOptions.Defaults.NodeModules.ExtensionOrder,
    },
    default: Group = .{},

    inline fn group(this: *const ResolveFileExtensions, is_node_modules: bool) *const Group {
        return switch (is_node_modules) {
            true => &this.node_modules,
            false => &this.default,
        };
    }

    pub fn kind(this: *const ResolveFileExtensions, kind_: bun.ImportKind, is_node_modules: bool) []const string {
        return switch (kind_) {
            .stmt, .entry_point_build, .entry_point_run, .dynamic => this.group(is_node_modules).esm,
            else => this.group(is_node_modules).default,
        };
    }

    pub const Group = struct {
        esm: []const string = &BundleOptions.Defaults.ModuleExtensionOrder,
        default: []const string = &BundleOptions.Defaults.ExtensionOrder,
    };
};

pub fn loadersFromTransformOptions(allocator: std.mem.Allocator, _loaders: ?Api.LoaderMap, target: Target) std.mem.Allocator.Error!bun.StringArrayHashMap(Loader) {
    const input_loaders = _loaders orelse std.mem.zeroes(Api.LoaderMap);
    const loader_values = try allocator.alloc(Loader, input_loaders.loaders.len);

    for (loader_values, input_loaders.loaders) |*loader, input| {
        loader.* = Loader.fromAPI(input);
    }

    var loaders = try stringHashMapFromArrays(
        bun.StringArrayHashMap(Loader),
        allocator,
        input_loaders.extensions,
        loader_values,
    );

    inline for (default_loader_ext) |ext| {
        _ = try loaders.getOrPutValue(ext, defaultLoaders.get(ext).?);
    }

    if (target.isBun()) {
        inline for (default_loader_ext_bun) |ext| {
            _ = try loaders.getOrPutValue(ext, defaultLoaders.get(ext).?);
        }
    }

    if (target == .browser) {
        inline for (default_loader_ext_browser) |ext| {
            _ = try loaders.getOrPutValue(ext, defaultLoaders.get(ext).?);
        }
    }

    return loaders;
}

const Dir = std.fs.Dir;

pub const SourceMapOption = enum {
    none,
    @"inline",
    external,
    linked,

    pub fn fromApi(source_map: ?Api.SourceMapMode) SourceMapOption {
        return switch (source_map orelse .none) {
            .external => .external,
            .@"inline" => .@"inline",
            .linked => .linked,
            else => .none,
        };
    }

    pub fn toAPI(source_map: ?SourceMapOption) Api.SourceMapMode {
        return switch (source_map orelse .none) {
            .external => .external,
            .@"inline" => .@"inline",
            .linked => .linked,
            .none => .none,
        };
    }

    pub fn hasExternalFiles(mode: SourceMapOption) bool {
        return switch (mode) {
            .linked, .external => true,
            else => false,
        };
    }

    pub const Map = bun.ComptimeStringMap(SourceMapOption, .{
        .{ "none", .none },
        .{ "inline", .@"inline" },
        .{ "external", .external },
        .{ "linked", .linked },
    });
};

pub const PackagesOption = enum {
    bundle,
    external,

    pub fn fromApi(packages: ?Api.PackagesMode) PackagesOption {
        return switch (packages orelse .bundle) {
            .external => .external,
            .bundle => .bundle,
            else => .bundle,
        };
    }

    pub fn toAPI(packages: ?PackagesOption) Api.PackagesMode {
        return switch (packages orelse .bundle) {
            .external => .external,
            .bundle => .bundle,
        };
    }

    pub const Map = bun.ComptimeStringMap(PackagesOption, .{
        .{ "external", .external },
        .{ "bundle", .bundle },
    });
};

/// BundleOptions is used when ResolveMode is not set to "disable".
/// BundleOptions is effectively webpack + babel
pub const BundleOptions = struct {
    footer: string = "",
    banner: string = "",
    define: *defines.Define,
    drop: []const []const u8 = &.{},
    loaders: Loader.HashTable,
    resolve_dir: string = "/",
    jsx: JSX.Pragma = JSX.Pragma{},
    emit_decorator_metadata: bool = false,
    auto_import_jsx: bool = true,
    allow_runtime: bool = true,

    trim_unused_imports: ?bool = null,
    mark_builtins_as_external: bool = false,
    server_components: bool = false,
    hot_module_reloading: bool = false,
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    origin: URL = URL{},
    output_dir_handle: ?Dir = null,

    output_dir: string = "out",
    root_dir: string = "",
    node_modules_bundle_url: string = "",
    node_modules_bundle_pretty_path: string = "",

    write: bool = false,
    preserve_symlinks: bool = false,
    preserve_extensions: bool = false,
    production: bool = false,

    // only used by bundle_v2
    output_format: Format = .esm,

    append_package_version_in_query_string: bool = false,

    tsconfig_override: ?string = null,
    target: Target = Target.browser,
    main_fields: []const string = Target.DefaultMainFields.get(Target.browser),
    /// TODO: remove this in favor accessing bundler.log
    log: *logger.Log,
    external: ExternalModules = ExternalModules{},
    entry_points: []const string,
    entry_naming: []const u8 = "",
    asset_naming: []const u8 = "",
    chunk_naming: []const u8 = "",
    public_path: []const u8 = "",
    extension_order: ResolveFileExtensions = .{},
    main_field_extension_order: []const string = &Defaults.MainFieldExtensionOrder,
    out_extensions: bun.StringHashMap(string),
    import_path_format: ImportPathFormat = ImportPathFormat.relative,
    defines_loaded: bool = false,
    env: Env = Env{},
    transform_options: Api.TransformOptions,
    polyfill_node_globals: bool = false,
    transform_only: bool = false,
    load_tsconfig_json: bool = true,

    rewrite_jest_for_tests: bool = false,

    macro_remap: MacroRemap = MacroRemap{},
    no_macros: bool = false,

    conditions: ESMConditions = undefined,
    tree_shaking: bool = false,
    code_splitting: bool = false,
    source_map: SourceMapOption = SourceMapOption.none,
    packages: PackagesOption = PackagesOption.bundle,

    disable_transpilation: bool = false,

    global_cache: GlobalCache = .disable,
    prefer_offline_install: bool = false,
    prefer_latest_install: bool = false,
    install: ?*Api.BunInstall = null,

    inlining: bool = false,
    inline_entrypoint_import_meta_main: bool = false,
    minify_whitespace: bool = false,
    minify_syntax: bool = false,
    minify_identifiers: bool = false,
    dead_code_elimination: bool = true,
    css_chunking: bool,

    ignore_dce_annotations: bool = false,
    emit_dce_annotations: bool = false,
    bytecode: bool = false,

    code_coverage: bool = false,
    debugger: bool = false,

    compile: bool = false,

    /// Set when bake.DevServer is bundling.
    dev_server: ?*bun.bake.DevServer = null,
    /// Set when Bake is bundling. Affects module resolution.
    framework: ?*bun.bake.Framework = null,

    serve_plugins: ?[]const []const u8 = null,
    bunfig_path: string = "",

    /// This is a list of packages which even when require() is used, we will
    /// instead convert to ESM import statements.
    ///
    /// This is not normally a safe transformation.
    ///
    /// So we have a list of packages which we know are safe to do this with.
    unwrap_commonjs_packages: []const string = &default_unwrap_commonjs_packages,

    supports_multiple_outputs: bool = true,

    pub fn isTest(this: *const BundleOptions) bool {
        return this.rewrite_jest_for_tests;
    }

    pub fn setProduction(this: *BundleOptions, value: bool) void {
        this.production = value;
        this.jsx.development = !value;
    }

    pub const default_unwrap_commonjs_packages = [_]string{
        "react",
        "react-is",
        "react-dom",
        "scheduler",
        "react-client",
        "react-server",
        "react-refresh",
    };

    pub inline fn cssImportBehavior(this: *const BundleOptions) Api.CssInJsBehavior {
        switch (this.target) {
            .browser => {
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
            this.target,
            loader_,
            env,
            node_env: {
                if (loader_) |e|
                    if (e.map.get("BUN_ENV") orelse e.map.get("NODE_ENV")) |env_| break :node_env env_;

                if (this.isTest()) {
                    break :node_env "\"test\"";
                }

                if (this.production) {
                    break :node_env "\"production\"";
                }

                break :node_env "\"development\"";
            },
            this.drop,
        );
        this.defines_loaded = true;
    }

    pub fn loader(this: *const BundleOptions, ext: string) Loader {
        return this.loaders.get(ext) orelse .file;
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

        pub const MainFieldExtensionOrder = [_]string{
            ".js",
            ".cjs",
            ".cts",
            ".tsx",
            ".ts",
            ".jsx",
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

        pub const NodeModules = struct {
            pub const ExtensionOrder = [_]string{
                ".jsx",
                ".cjs",
                ".js",
                ".mjs",
                ".mts",
                ".tsx",
                ".ts",
                ".cts",
                ".json",
            };

            pub const ModuleExtensionOrder = [_]string{
                ".mjs",
                ".jsx",
                ".mts",
                ".js",
                ".cjs",
                ".tsx",
                ".ts",
                ".cts",
                ".json",
            };
        };
    };

    pub fn fromApi(
        allocator: std.mem.Allocator,
        fs: *Fs.FileSystem,
        log: *logger.Log,
        transform: Api.TransformOptions,
    ) !BundleOptions {
        var opts: BundleOptions = BundleOptions{
            .log = log,
            .define = undefined,
            .loaders = try loadersFromTransformOptions(allocator, transform.loaders, Target.from(transform.target)),
            .output_dir = transform.output_dir orelse "out",
            .target = Target.from(transform.target),
            .write = transform.write orelse false,
            .external = undefined,
            .entry_points = transform.entry_points,
            .out_extensions = undefined,
            .env = Env.init(allocator),
            .transform_options = transform,
            .css_chunking = false,
            .drop = transform.drop,
        };

        Analytics.Features.define += @as(usize, @intFromBool(transform.define != null));
        Analytics.Features.loaders += @as(usize, @intFromBool(transform.loaders != null));

        opts.serve_plugins = transform.serve_plugins;
        opts.bunfig_path = transform.bunfig_path;

        if (transform.env_files.len > 0) {
            opts.env.files = transform.env_files;
        }

        if (transform.origin) |origin| {
            opts.origin = URL.parse(origin);
        }

        if (transform.jsx) |jsx| {
            opts.jsx = try JSX.Pragma.fromApi(jsx, allocator);
        }

        if (transform.extension_order.len > 0) {
            opts.extension_order.default.default = transform.extension_order;
        }

        if (transform.target) |t| {
            opts.target = Target.from(t);
            opts.main_fields = Target.DefaultMainFields.get(opts.target);
        }

        opts.conditions = try ESMConditions.init(allocator, opts.target.defaultConditions());

        if (transform.conditions.len > 0) {
            opts.conditions.appendSlice(transform.conditions) catch bun.outOfMemory();
        }

        switch (opts.target) {
            .node => {
                opts.import_path_format = .relative;
                opts.allow_runtime = false;
            },
            .bun => {
                opts.import_path_format = if (opts.import_path_format == .absolute_url) .absolute_url else .absolute_path;

                opts.env.behavior = .load_all;
                if (transform.extension_order.len == 0) {
                    // we must also support require'ing .node files
                    opts.extension_order.default.default = comptime Defaults.ExtensionOrder ++ &[_][]const u8{".node"};
                    opts.extension_order.node_modules.default = comptime Defaults.NodeModules.ExtensionOrder ++ &[_][]const u8{".node"};
                }
            },
            else => {},
        }

        if (transform.main_fields.len > 0) {
            opts.main_fields = transform.main_fields;
        }

        opts.external = ExternalModules.init(allocator, &fs.fs, fs.top_level_dir, transform.external, log, opts.target);
        opts.out_extensions = opts.target.outExtensions(allocator);

        opts.source_map = SourceMapOption.fromApi(transform.source_map orelse .none);

        opts.packages = PackagesOption.fromApi(transform.packages orelse .bundle);

        opts.tree_shaking = opts.target.isBun() or opts.production;
        opts.inlining = opts.tree_shaking;
        if (opts.inlining)
            opts.minify_syntax = true;

        if (opts.origin.isAbsolute()) {
            opts.import_path_format = ImportPathFormat.absolute_url;
        }

        if (opts.write and opts.output_dir.len > 0) {
            opts.output_dir_handle = try openOutputDir(opts.output_dir);
            opts.output_dir = try fs.getFdPath(bun.toFD(opts.output_dir_handle.?.fd));
        }

        opts.polyfill_node_globals = opts.target == .browser;

        Analytics.Features.macros += @as(usize, @intFromBool(opts.target == .bun_macro));
        Analytics.Features.external += @as(usize, @intFromBool(transform.external.len > 0));
        return opts;
    }
};

pub fn openOutputDir(output_dir: string) !std.fs.Dir {
    return std.fs.cwd().openDir(output_dir, .{}) catch brk: {
        std.fs.cwd().makeDir(output_dir) catch |err| {
            Output.printErrorln("error: Unable to mkdir \"{s}\": \"{s}\"", .{ output_dir, @errorName(err) });
            Global.crash();
        };

        const handle = std.fs.cwd().openDir(output_dir, .{}) catch |err2| {
            Output.printErrorln("error: Unable to open \"{s}\": \"{s}\"", .{ output_dir, @errorName(err2) });
            Global.crash();
        };
        break :brk handle;
    };
}

pub const TransformOptions = struct {
    footer: string = "",
    banner: string = "",
    define: bun.StringHashMap(string),
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

    target: Target = Target.browser,
    main_fields: []string = Target.DefaultMainFields.get(Target.browser),

    pub fn initUncached(allocator: std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        const entryPoint = Fs.File{
            .path = Fs.Path.init(entryPointName),
            .contents = code,
        };

        var cwd: string = "/";
        if (Environment.isWasi or Environment.isWindows) {
            cwd = try bun.getcwdAlloc(allocator);
        }

        var define = bun.StringHashMap(string).init(allocator);
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
            .main_fields = Target.DefaultMainFields.get(Target.browser),
            .jsx = if (Loader.isJSX(loader)) JSX.Pragma{} else null,
        };
    }
};

pub const OutputFile = @import("./OutputFile.zig");

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
            .errors = try errors.toOwnedSlice(),
            .warnings = try warnings.toOwnedSlice(),
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

    /// List of explicit env files to load (e..g specified by --env-file args)
    files: []const []const u8 = &[_][]u8{},

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

        for (defaults.keys, 0..) |key, i| {
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
        bun.assert(std.fs.path.isAbsolute(this.path));
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
            bun.copy(u8, out[2..], str);
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
    extensions: []const string = &[_]string{},
    routes_enabled: bool = false,

    static_dir: string = "",
    static_dir_handle: ?std.fs.Dir = null,
    static_dir_enabled: bool = false,
    single_page_app_routing: bool = false,
    single_page_app_fd: StoredFileDescriptorType = .zero,

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
            .extensions = DefaultExtensions[0..],
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

        const static_dir: string = std.mem.trimRight(u8, router_.static_dir orelse "", "/\\");
        const asset_prefix: string = std.mem.trimRight(u8, router_.asset_prefix orelse "", "/\\");

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

            const extensions = try allocator.alloc(string, count);
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

pub const GlobalCache = @import("./resolver/resolver.zig").GlobalCache;

pub const PathTemplate = struct {
    data: string = "",
    placeholder: Placeholder = .{},

    pub fn needs(this: *const PathTemplate, comptime field: std.meta.FieldEnum(Placeholder)) bool {
        return strings.containsComptime(this.data, "[" ++ @tagName(field) ++ "]");
    }

    inline fn writeReplacingSlashesOnWindows(w: anytype, slice: []const u8) !void {
        if (Environment.isWindows) {
            var remain = slice;
            while (strings.indexOfChar(remain, '/')) |i| {
                try w.writeAll(remain[0..i]);
                try w.writeByte('\\');
                remain = remain[i + 1 ..];
            }
            try w.writeAll(remain);
        } else {
            try w.writeAll(slice);
        }
    }

    pub fn format(self: PathTemplate, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var remain = self.data;
        while (strings.indexOfChar(remain, '[')) |j| {
            try writeReplacingSlashesOnWindows(writer, remain[0..j]);
            remain = remain[j + 1 ..];
            if (remain.len == 0) {
                // TODO: throw error
                try writer.writeAll("[");
                break;
            }

            var count: isize = 1;
            var end_len: usize = remain.len;
            for (remain) |*c| {
                count += switch (c.*) {
                    '[' => 1,
                    ']' => -1,
                    else => 0,
                };

                if (count == 0) {
                    end_len = @intFromPtr(c) - @intFromPtr(remain.ptr);
                    bun.assert(end_len <= remain.len);
                    break;
                }
            }

            const placeholder = remain[0..end_len];

            const field = PathTemplate.Placeholder.map.get(placeholder) orelse {
                try writeReplacingSlashesOnWindows(writer, placeholder);
                remain = remain[end_len..];
                continue;
            };

            switch (field) {
                .dir => try writeReplacingSlashesOnWindows(writer, if (self.placeholder.dir.len > 0) self.placeholder.dir else "."),
                .name => try writeReplacingSlashesOnWindows(writer, self.placeholder.name),
                .ext => try writeReplacingSlashesOnWindows(writer, self.placeholder.ext),
                .hash => {
                    if (self.placeholder.hash) |hash| {
                        try writer.print("{any}", .{bun.fmt.truncatedHash32(hash)});
                    }
                },
            }
            remain = remain[end_len + 1 ..];
        }

        try writeReplacingSlashesOnWindows(writer, remain);
    }

    pub const Placeholder = struct {
        dir: []const u8 = "",
        name: []const u8 = "",
        ext: []const u8 = "",
        hash: ?u64 = null,

        pub const map = bun.ComptimeStringMap(std.meta.FieldEnum(Placeholder), .{
            .{ "dir", .dir },
            .{ "name", .name },
            .{ "ext", .ext },
            .{ "hash", .hash },
        });
    };

    pub const chunk = PathTemplate{
        .data = "./chunk-[hash].[ext]",
        .placeholder = .{
            .name = "chunk",
            .ext = "js",
            .dir = "",
        },
    };

    pub const file = PathTemplate{
        .data = "[dir]/[name].[ext]",
        .placeholder = .{},
    };

    pub const asset = PathTemplate{
        .data = "./[name]-[hash].[ext]",
        .placeholder = .{},
    };
};
