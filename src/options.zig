/// This file is mostly the API schema but with all the options normalized.
/// Normalization is necessary because most fields in the API schema are optional
const std = @import("std");
const logger = bun.logger;
const Fs = @import("fs.zig");

const resolver = @import("./resolver/resolver.zig");
const api = @import("./api/schema.zig");
const Api = api.Api;
const defines = @import("./defines.zig");
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

    pub const Map = bun.ComptimeStringMap(Target, .{
        .{ "browser", Target.browser },
        .{ "bun", Target.bun },
        .{ "bun_macro", Target.bun_macro },
        .{ "macro", Target.bun_macro },
        .{ "node", Target.node },
    });

    pub fn fromJS(global: *JSC.JSGlobalObject, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Target {
        if (!value.jsType().isStringLike()) {
            JSC.throwInvalidArguments("target must be a string", .{}, global, exception);

            return null;
        }
        return Map.fromJS(global, value);
    }

    pub fn toAPI(this: Target) Api.Target {
        return switch (this) {
            .node => .node,
            .browser => .browser,
            .bun => .bun,
            .bun_macro => .bun_macro,
        };
    }

    pub inline fn isServerSide(this: Target) bool {
        return switch (this) {
            .bun_macro, .node, .bun => true,
            else => false,
        };
    }

    pub inline fn isBun(this: Target) bool {
        return switch (this) {
            .bun_macro, .bun => true,
            else => false,
        };
    }

    pub inline fn isNotBun(this: Target) bool {
        return switch (this) {
            .bun_macro, .bun => false,
            else => true,
        };
    }

    pub inline fn isClient(this: Target) bool {
        return switch (this) {
            .bun_macro, .bun => false,
            else => true,
        };
    }

    pub inline fn isNode(this: Target) bool {
        return switch (this) {
            .node => true,
            else => false,
        };
    }

    pub inline fn supportsBrowserField(this: Target) bool {
        return switch (this) {
            .browser => true,
            else => false,
        };
    }

    const browser_define_value_true = "true";
    const browser_define_value_false = "false";

    pub inline fn processBrowserDefineValue(this: Target) ?string {
        return switch (this) {
            .browser => browser_define_value_true,
            .bun_macro, .bun, .node => browser_define_value_false,
        };
    }

    pub inline fn isWebLike(target: Target) bool {
        return switch (target) {
            .browser => true,
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

    pub fn outExtensions(target: Target, allocator: std.mem.Allocator) bun.StringHashMap(string) {
        var exts = bun.StringHashMap(string).init(allocator);

        const js = Extensions.Out.JavaScript[0];
        const mjs = Extensions.Out.JavaScript[1];

        if (target == .node) {
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

        // Original comment:
        // The neutral target is for people that don't want esbuild to try to
        // pick good defaults for their platform. In that case, the list of main
        // fields is empty by default. You must explicitly configure it yourself.
        // array.set(Target.neutral, &listc);

        break :brk array;
    };

    pub const DefaultConditions: std.EnumArray(Target, []const string) = brk: {
        var array = std.EnumArray(Target, []const string).initUndefined();

        array.set(Target.node, &[_]string{
            "node",
        });
        array.set(Target.browser, &[_]string{
            "browser",
            "module",
        });
        array.set(Target.bun, &[_]string{
            "bun",
            "node",
        });
        array.set(Target.bun_macro, &[_]string{
            "macro",
            "bun",
            "node",
        });

        break :brk array;
    };
};

pub const Format = enum {
    esm,
    cjs,
    iife,

    pub const Map = bun.ComptimeStringMap(Format, .{
        .{ "esm", .esm },
        .{ "cjs", .cjs },
        .{ "iife", .iife },
    });

    pub fn fromJS(global: *JSC.JSGlobalObject, format: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Format {
        if (format.isUndefinedOrNull()) return null;

        if (!format.jsType().isStringLike()) {
            JSC.throwInvalidArguments("format must be a string", .{}, global, exception);
            return null;
        }

        return Map.fromJS(global, format) orelse {
            JSC.throwInvalidArguments("Invalid format - must be esm, cjs, or iife", .{}, global, exception);
            return null;
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

    pub inline fn isSQLite(this: Loader) bool {
        return switch (this) {
            .sqlite, .sqlite_embedded => true,
            else => false,
        };
    }

    pub fn shouldCopyForBundling(this: Loader) bool {
        return switch (this) {
            .file,
            // TODO: CSS
            .css,
            .napi,
            .sqlite,
            .sqlite_embedded,
            => true,
            else => false,
        };
    }

    pub fn toMimeType(this: Loader) bun.http.MimeType {
        return switch (this) {
            .jsx, .js, .ts, .tsx => bun.http.MimeType.javascript,
            .css => bun.http.MimeType.css,
            .toml, .json => bun.http.MimeType.json,
            .wasm => bun.http.MimeType.wasm,
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
            .jsx, .js, .ts, .tsx, .json, .wasm, .bunsh => true,
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
            JSC.throwInvalidArguments("invalid loader - must be js, jsx, tsx, ts, css, file, toml, wasm, bunsh, or json", .{}, global, exception);
            return null;
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
        .{ "toml", .toml },
        .{ "wasm", .wasm },
        .{ "node", .napi },
        .{ "dataurl", .dataurl },
        .{ "base64", .base64 },
        .{ "txt", .text },
        .{ "text", .text },
        .{ "sh", .file },
        .{ "sqlite", .sqlite },
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
};
const default_loaders_win32 = default_loaders_posix ++ .{
    .{ ".sh", .bunsh },
};

const default_loaders = if (Environment.isWindows) default_loaders_win32 else default_loaders_posix;
pub const defaultLoaders = bun.ComptimeStringMap(Loader, default_loaders);

// https://webpack.js.org/guides/package-exports/#reference-syntax
pub const ESMConditions = struct {
    default: ConditionsMap = undefined,
    import: ConditionsMap = undefined,
    require: ConditionsMap = undefined,

    pub fn init(allocator: std.mem.Allocator, defaults: []const string) !ESMConditions {
        var default_condition_amp = ConditionsMap.init(allocator);

        var import_condition_map = ConditionsMap.init(allocator);
        var require_condition_map = ConditionsMap.init(allocator);

        try default_condition_amp.ensureTotalCapacity(defaults.len + 2);
        try import_condition_map.ensureTotalCapacity(defaults.len + 2);
        try require_condition_map.ensureTotalCapacity(defaults.len + 2);

        import_condition_map.putAssumeCapacity("import", {});
        require_condition_map.putAssumeCapacity("require", {});

        for (defaults) |default| {
            default_condition_amp.putAssumeCapacityNoClobber(default, {});
            import_condition_map.putAssumeCapacityNoClobber(default, {});
            require_condition_map.putAssumeCapacityNoClobber(default, {});
        }

        default_condition_amp.putAssumeCapacity("default", {});
        import_condition_map.putAssumeCapacity("default", {});
        require_condition_map.putAssumeCapacity("default", {});

        return ESMConditions{
            .default = default_condition_amp,
            .import = import_condition_map,
            .require = require_condition_map,
        };
    }

    pub fn appendSlice(self: *ESMConditions, conditions: []const string) !void {
        try self.default.ensureUnusedCapacity(conditions.len);
        try self.import.ensureUnusedCapacity(conditions.len);
        try self.require.ensureUnusedCapacity(conditions.len);

        for (conditions) |condition| {
            self.default.putAssumeCapacityNoClobber(condition, {});
            self.import.putAssumeCapacityNoClobber(condition, {});
            self.require.putAssumeCapacityNoClobber(condition, {});
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
        runtime: JSX.Runtime = JSX.Runtime.automatic,
        import_source: ImportSource = .{},

        /// Facilitates automatic JSX importing
        /// Set on a per file basis like this:
        /// /** @jsxImportSource @emotion/core */
        classic_import_source: string = "react",
        package_name: []const u8 = "react",
        // https://github.com/facebook/react/commit/2f26eb85d657a08c21edbac1e00f9626d68f84ae
        refresh_runtime: string = "react-refresh/runtime",
        supports_fast_refresh: bool = true,
        use_embedded_refresh_runtime: bool = false,

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
            return strings.eqlComptime(pragma.package_name, "react") or strings.eqlComptime(pragma.package_name, "@emotion/jsx") or strings.eqlComptime(pragma.package_name, "@emotion/react");
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

    const resolved_defines = try defines.DefineData.from_input(user_defines, log, allocator);

    return try defines.Define.init(
        allocator,
        resolved_defines,
        environment_defines,
    );
}

const default_loader_ext_bun = [_]string{".node"};
const default_loader_ext = [_]string{
    ".jsx",  ".json",
    ".js",   ".mjs",
    ".cjs",  ".css",

    // https://devblogs.microsoft.com/typescript/announcing-typescript-4-5-beta/#new-file-extensions
    ".ts",   ".tsx",
    ".mts",  ".cts",

    ".toml", ".wasm",
    ".txt",  ".text",
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
    ".css",
    ".tsx",
    ".cts",
    ".wasm",
    ".text",
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
            .stmt, .entry_point, .dynamic => this.group(is_node_modules).esm,
            else => this.group(is_node_modules).default,
        };
    }

    pub const Group = struct {
        esm: []const string = &BundleOptions.Defaults.ModuleExtensionOrder,
        default: []const string = &BundleOptions.Defaults.ExtensionOrder,
    };
};

pub fn loadersFromTransformOptions(allocator: std.mem.Allocator, _loaders: ?Api.LoaderMap, target: Target) !bun.StringArrayHashMap(Loader) {
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

pub const OutputFormat = enum {
    preserve,

    /// ES module format
    /// This is the default format
    esm,
    /// Immediately-invoked function expression
    /// (
    ///   function(){}
    /// )();
    iife,
    /// CommonJS
    cjs,

    pub fn keepES6ImportExportSyntax(this: OutputFormat) bool {
        return this == .esm;
    }

    pub inline fn isESM(this: OutputFormat) bool {
        return this == .esm;
    }
};

/// BundleOptions is used when ResolveMode is not set to "disable".
/// BundleOptions is effectively webpack + babel
pub const BundleOptions = struct {
    footer: string = "",
    banner: string = "",
    define: *defines.Define,
    loaders: Loader.HashTable,
    resolve_dir: string = "/",
    jsx: JSX.Pragma = JSX.Pragma{},
    emit_decorator_metadata: bool = false,
    auto_import_jsx: bool = true,
    allow_runtime: bool = true,

    trim_unused_imports: ?bool = null,
    mark_builtins_as_external: bool = false,
    react_server_components: bool = false,
    react_server_components_boundary: string = "",
    hot_module_reloading: bool = false,
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
    timings: Timings = Timings{},
    production: bool = false,
    serve: bool = false,

    // only used by bundle_v2
    output_format: OutputFormat = .esm,

    append_package_version_in_query_string: bool = false,

    jsx_optimization_inline: ?bool = null,
    jsx_optimization_hoist: ?bool = null,

    resolve_mode: api.Api.ResolveMode,
    tsconfig_override: ?string = null,
    target: Target = Target.browser,
    main_fields: []const string = Target.DefaultMainFields.get(Target.browser),
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
    framework: ?Framework = null,
    routes: RouteConfig = RouteConfig.zero(),
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

    disable_transpilation: bool = false,

    global_cache: GlobalCache = .disable,
    prefer_offline_install: bool = false,
    prefer_latest_install: bool = false,
    install: ?*Api.BunInstall = null,

    inlining: bool = false,
    minify_whitespace: bool = false,
    minify_syntax: bool = false,
    minify_identifiers: bool = false,
    dead_code_elimination: bool = true,

    code_coverage: bool = false,
    debugger: bool = false,

    compile: bool = false,

    /// This is a list of packages which even when require() is used, we will
    /// instead convert to ESM import statements.
    ///
    /// This is not normally a safe transformation.
    ///
    /// So we have a list of packages which we know are safe to do this with.
    unwrap_commonjs_packages: []const string = &default_unwrap_commonjs_packages,

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
        "__bun-test-unwrap-commonjs__",
    };

    pub inline fn cssImportBehavior(this: *const BundleOptions) Api.CssInJsBehavior {
        switch (this.target) {
            .browser => {
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
            .resolve_mode = transform.resolve orelse .dev,
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
        };

        Analytics.Features.define += @as(usize, @intFromBool(transform.define != null));
        Analytics.Features.loaders += @as(usize, @intFromBool(transform.loaders != null));

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

        opts.conditions = try ESMConditions.init(allocator, Target.DefaultConditions.get(opts.target));

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

        if (transform.framework) |_framework| {
            opts.framework = try Framework.fromApi(_framework, allocator);
        }

        if (transform.router) |routes| {
            opts.routes = try RouteConfig.fromApi(routes, allocator);
        }

        if (transform.main_fields.len > 0) {
            opts.main_fields = transform.main_fields;
        }

        opts.external = ExternalModules.init(allocator, &fs.fs, fs.top_level_dir, transform.external, log, opts.target);
        opts.out_extensions = opts.target.outExtensions(allocator);

        opts.source_map = SourceMapOption.fromApi(transform.source_map orelse .none);

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

        Analytics.Features.filesystem_router += @as(usize, @intFromBool(opts.routes.routes_enabled));
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

// Instead of keeping files in-memory, we:
// 1. Write directly to disk
// 2. (Optional) move the file to the destination
// This saves us from allocating a buffer
pub const OutputFile = struct {
    loader: Loader,
    input_loader: Loader = .js,
    src_path: Fs.Path,
    value: Value,
    size: usize = 0,
    size_without_sourcemap: usize = 0,
    mtime: ?i128 = null,
    hash: u64 = 0,
    is_executable: bool = false,
    source_map_index: u32 = std.math.maxInt(u32),
    output_kind: JSC.API.BuildArtifact.OutputKind = .chunk,
    dest_path: []const u8 = "",

    // Depending on:
    // - The target
    // - The number of open file handles
    // - Whether or not a file of the same name exists
    // We may use a different system call
    pub const FileOperation = struct {
        pathname: string,
        fd: FileDescriptorType = bun.invalid_fd,
        dir: FileDescriptorType = bun.invalid_fd,
        is_tmpdir: bool = false,
        is_outdir: bool = false,
        close_handle_on_complete: bool = false,
        autowatch: bool = true,

        pub fn fromFile(fd: anytype, pathname: string) FileOperation {
            return .{
                .pathname = pathname,
                .fd = bun.toFD(fd),
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
        move: FileOperation,
        copy: FileOperation,
        noop: u0,
        buffer: struct {
            allocator: std.mem.Allocator,
            bytes: []const u8,
        },
        pending: resolver.Result,
        saved: SavedFile,
    };

    pub const SavedFile = struct {
        pub fn toJS(
            globalThis: *JSC.JSGlobalObject,
            path: []const u8,
            byte_size: usize,
        ) JSC.JSValue {
            const mime_type = globalThis.bunVM().mimeType(path);
            const store = JSC.WebCore.Blob.Store.initFile(
                JSC.Node.PathOrFileDescriptor{
                    .path = JSC.Node.PathLike{
                        .string = JSC.PathString.init(path),
                    },
                },
                mime_type,
                bun.default_allocator,
            ) catch unreachable;

            var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
            blob.* = JSC.WebCore.Blob.initWithStore(store, globalThis);
            if (mime_type) |mime| {
                blob.content_type = mime.value;
            }
            blob.size = @as(JSC.WebCore.Blob.SizeType, @truncate(byte_size));
            blob.allocator = bun.default_allocator;
            return blob.toJS(globalThis);
        }
    };

    pub const Kind = enum { move, copy, noop, buffer, pending, saved };

    pub fn initPending(loader: Loader, pending: resolver.Result) OutputFile {
        return .{
            .loader = loader,
            .src_path = pending.pathConst().?.*,
            .size = 0,
            .value = .{ .pending = pending },
        };
    }

    pub fn initFile(file: std.fs.File, pathname: string, size: usize) OutputFile {
        return .{
            .loader = .file,
            .src_path = Fs.Path.init(pathname),
            .size = size,
            .value = .{ .copy = FileOperation.fromFile(file.handle, pathname) },
        };
    }

    pub fn initFileWithDir(file: std.fs.File, pathname: string, size: usize, dir: std.fs.Dir) OutputFile {
        var res = initFile(file, pathname, size);
        res.value.copy.dir_handle = bun.toFD(dir.fd);
        return res;
    }

    pub const Options = struct {
        loader: Loader,
        input_loader: Loader,
        hash: ?u64 = null,
        source_map_index: ?u32 = null,
        output_path: string,
        size: ?usize = null,
        input_path: []const u8 = "",
        display_size: u32 = 0,
        output_kind: JSC.API.BuildArtifact.OutputKind = .chunk,
        is_executable: bool = false,
        data: union(enum) {
            buffer: struct {
                allocator: std.mem.Allocator,
                data: []const u8,
            },
            file: struct {
                file: std.fs.File,
                size: usize,
                dir: std.fs.Dir,
            },
            saved: usize,
        },
    };

    pub fn init(options: Options) OutputFile {
        return OutputFile{
            .loader = options.loader,
            .input_loader = options.input_loader,
            .src_path = Fs.Path.init(options.input_path),
            .dest_path = options.output_path,
            .size = options.size orelse switch (options.data) {
                .buffer => |buf| buf.data.len,
                .file => |file| file.size,
                .saved => 0,
            },
            .size_without_sourcemap = options.display_size,
            .hash = options.hash orelse 0,
            .output_kind = options.output_kind,
            .source_map_index = options.source_map_index orelse std.math.maxInt(u32),
            .is_executable = options.is_executable,
            .value = switch (options.data) {
                .buffer => |buffer| Value{ .buffer = .{ .allocator = buffer.allocator, .bytes = buffer.data } },
                .file => |file| Value{
                    .copy = brk: {
                        var op = FileOperation.fromFile(file.file.handle, options.output_path);
                        op.dir = bun.toFD(file.dir.fd);
                        break :brk op;
                    },
                },
                .saved => Value{ .saved = .{} },
            },
        };
    }

    pub fn initBuf(buf: []const u8, allocator: std.mem.Allocator, pathname: string, loader: Loader, hash: ?u64, source_map_index: ?u32) OutputFile {
        return .{
            .loader = loader,
            .src_path = Fs.Path.init(pathname),
            .size = buf.len,
            .hash = hash orelse 0,
            .source_map_index = source_map_index orelse std.math.maxInt(u32),
            .value = .{
                .buffer = .{
                    .bytes = buf,
                    .allocator = allocator,
                },
            },
        };
    }

    pub fn moveTo(file: *const OutputFile, _: string, rel_path: []u8, dir: FileDescriptorType) !void {
        try bun.C.moveFileZ(file.value.move.dir, bun.sliceTo(&(try std.posix.toPosixPath(file.value.move.getPathname())), 0), dir, bun.sliceTo(&(try std.posix.toPosixPath(rel_path)), 0));
    }

    pub fn copyTo(file: *const OutputFile, _: string, rel_path: []u8, dir: FileDescriptorType) !void {
        const file_out = (try dir.asDir().createFile(rel_path, .{}));

        const fd_out = file_out.handle;
        var do_close = false;
        const fd_in = (try std.fs.openFileAbsolute(file.src_path.text, .{ .mode = .read_only })).handle;

        if (Environment.isWindows) {
            Fs.FileSystem.setMaxFd(fd_out);
            Fs.FileSystem.setMaxFd(fd_in);
            do_close = Fs.FileSystem.instance.fs.needToCloseFiles();

            // use paths instead of bun.getFdPathW()
            @panic("TODO windows");
        }

        defer {
            if (do_close) {
                _ = bun.sys.close(bun.toFD(fd_out));
                _ = bun.sys.close(bun.toFD(fd_in));
            }
        }

        try bun.copyFile(fd_in, fd_out).unwrap();
    }

    pub fn toJS(
        this: *OutputFile,
        owned_pathname: ?[]const u8,
        globalObject: *JSC.JSGlobalObject,
    ) bun.JSC.JSValue {
        return switch (this.value) {
            .move, .pending => @panic("Unexpected pending output file"),
            .noop => JSC.JSValue.undefined,
            .copy => |copy| brk: {
                const file_blob = JSC.WebCore.Blob.Store.initFile(
                    if (copy.fd != .zero)
                        JSC.Node.PathOrFileDescriptor{
                            .fd = copy.fd,
                        }
                    else
                        JSC.Node.PathOrFileDescriptor{
                            .path = JSC.Node.PathLike{ .string = bun.PathString.init(globalObject.allocator().dupe(u8, copy.pathname) catch unreachable) },
                        },
                    this.loader.toMimeType(),
                    globalObject.allocator(),
                ) catch |err| {
                    Output.panic("error: Unable to create file blob: \"{s}\"", .{@errorName(err)});
                };

                var build_output = bun.new(JSC.API.BuildArtifact, .{
                    .blob = JSC.WebCore.Blob.initWithStore(file_blob, globalObject),
                    .hash = this.hash,
                    .loader = this.input_loader,
                    .output_kind = this.output_kind,
                    .path = bun.default_allocator.dupe(u8, copy.pathname) catch @panic("Failed to allocate path"),
                });

                break :brk build_output.toJS(globalObject);
            },
            .saved => brk: {
                var build_output = bun.default_allocator.create(JSC.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
                const path_to_use = owned_pathname orelse this.src_path.text;

                const file_blob = JSC.WebCore.Blob.Store.initFile(
                    JSC.Node.PathOrFileDescriptor{
                        .path = JSC.Node.PathLike{ .string = bun.PathString.init(owned_pathname orelse (bun.default_allocator.dupe(u8, this.src_path.text) catch unreachable)) },
                    },
                    this.loader.toMimeType(),
                    globalObject.allocator(),
                ) catch |err| {
                    Output.panic("error: Unable to create file blob: \"{s}\"", .{@errorName(err)});
                };

                build_output.* = JSC.API.BuildArtifact{
                    .blob = JSC.WebCore.Blob.initWithStore(file_blob, globalObject),
                    .hash = this.hash,
                    .loader = this.input_loader,
                    .output_kind = this.output_kind,
                    .path = bun.default_allocator.dupe(u8, path_to_use) catch @panic("Failed to allocate path"),
                };

                break :brk build_output.toJS(globalObject);
            },
            .buffer => |buffer| brk: {
                var blob = JSC.WebCore.Blob.init(@constCast(buffer.bytes), buffer.allocator, globalObject);
                if (blob.store) |store| {
                    store.mime_type = this.loader.toMimeType();
                    blob.content_type = store.mime_type.value;
                } else {
                    blob.content_type = this.loader.toMimeType().value;
                }

                blob.size = @as(JSC.WebCore.Blob.SizeType, @truncate(buffer.bytes.len));

                var build_output = bun.default_allocator.create(JSC.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
                build_output.* = JSC.API.BuildArtifact{
                    .blob = blob,
                    .hash = this.hash,
                    .loader = this.input_loader,
                    .output_kind = this.output_kind,
                    .path = owned_pathname orelse bun.default_allocator.dupe(u8, this.src_path.text) catch unreachable,
                };
                break :brk build_output.toJS(globalObject);
            },
        };
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
    override_modules: Api.StringMap,
    override_modules_hashes: []u64 = &[_]u64{},

    client_css_in_js: Api.CssInJsBehavior = .auto_onimportcss,

    pub const fallback_html: string = @embedFile("./fallback.html");

    pub fn platformEntryPoint(this: *const Framework, target: Target) ?*const EntryPoint {
        const entry: *const EntryPoint = switch (target) {
            .browser => &this.client,
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
        return strings.contains(this.data, comptime "[" ++ @tagName(field) ++ "]");
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
                        try writer.print("{any}", .{(hashFormatter(hash))});
                    }
                },
            }
            remain = remain[end_len + 1 ..];
        }

        try writeReplacingSlashesOnWindows(writer, remain);
    }

    pub const hashFormatter = bun.fmt.hexIntLower;

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
