//! When bundling with --target=browser, we want to allow using some of the
//! `node:*` builtins.  The implementations of these polyfills are in
//! `./src/node_fallbacks`, with this file being the glue to add them to the
//! resolver.
const std = @import("std");
const bun = @import("root").bun;

const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const logger = bun.logger;
const Fs = @import("./fs.zig");

pub const prefix = "/bun-vfs$$/node_modules/";

comptime {
    // Ensure that checking for the prefix should be a cheap lookup (bun.strings.hasPrefixComptime)
    // because 24 bytes == 8 * 3 --> read and compare three u64s
    bun.assert(prefix.len % 8 == 0);
}

pub const Module = struct {
    path: Fs.Path,
    code: []const u8,
    package_json: *const PackageJSON,
};

pub fn contentsFromPath(path: []const u8) ?[]const u8 {
    if (bun.Environment.allow_assert)
        bun.assert(bun.strings.hasPrefixComptime(path, prefix));

    var module_name = path[prefix.len..];
    module_name = module_name[0 .. std.mem.indexOfScalar(u8, module_name, '/') orelse module_name.len];

    if (Map.get(module_name)) |mod| {
        return mod.code;
    }

    return null;
}

pub const Map = bun.ComptimeStringMap(Module, .{
    .{ "assert", nodeFallback("assert", @embedFile("./node-fallbacks/out/assert.js")) },
    .{ "buffer", nodeFallback("buffer", @embedFile("./node-fallbacks/out/buffer.js")) },
    .{ "console", nodeFallback("console", @embedFile("./node-fallbacks/out/console.js")) },
    .{ "constants", nodeFallback("constants", @embedFile("./node-fallbacks/out/constants.js")) },
    .{ "crypto", nodeFallback("crypto", @embedFile("./node-fallbacks/out/crypto.js")) },
    .{ "domain", nodeFallback("domain", @embedFile("./node-fallbacks/out/domain.js")) },
    .{ "events", nodeFallback("events", @embedFile("./node-fallbacks/out/events.js")) },
    .{ "http", nodeFallback("http", @embedFile("./node-fallbacks/out/http.js")) },
    .{ "https", nodeFallback("https", @embedFile("./node-fallbacks/out/https.js")) },
    .{ "net", nodeFallback("net", @embedFile("./node-fallbacks/out/net.js")) },
    .{ "os", nodeFallback("os", @embedFile("./node-fallbacks/out/os.js")) },
    .{ "path", nodeFallback("path", @embedFile("./node-fallbacks/out/path.js")) },
    .{ "process", nodeFallback("process", @embedFile("./node-fallbacks/out/process.js")) },
    .{ "punycode", nodeFallback("punycode", @embedFile("./node-fallbacks/out/punycode.js")) },
    .{ "querystring", nodeFallback("querystring", @embedFile("./node-fallbacks/out/querystring.js")) },
    .{ "stream", nodeFallback("stream", @embedFile("./node-fallbacks/out/stream.js")) },
    .{ "string_decoder", nodeFallback("string", @embedFile("./node-fallbacks/out/string_decoder.js")) },
    .{ "timers", nodeFallback("timers", @embedFile("./node-fallbacks/out/timers.js")) },
    .{ "timers/promises", nodeFallback("timers/promises", @embedFile("./node-fallbacks/out/timers.promises.js")) },
    .{ "tty", nodeFallback("tty", @embedFile("./node-fallbacks/out/tty.js")) },
    .{ "url", nodeFallback("url", @embedFile("./node-fallbacks/out/url.js")) },
    .{ "util", nodeFallback("util", @embedFile("./node-fallbacks/out/util.js")) },
    .{ "zlib", nodeFallback("zlib", @embedFile("./node-fallbacks/out/zlib.js")) },

    // sys is an alias of util
    .{ "sys", nodeFallback("util", @embedFile("./node-fallbacks/out/util.js")) },
});

fn nodeFallback(comptime name: []const u8, comptime code: []const u8) Module {
    const path_text = prefix ++ name ++ "/index.js";

    @setEvalBranchQuota(100_000);

    return comptime .{
        .path = .{
            .pretty = "node:" ++ name ++ " browser polyfill",
            .is_symlink = true,
            .text = path_text,
            .namespace = "node",
            .name = Fs.PathName.init(path_text),
        },
        .package_json = &.{
            .name = name,
            .version = "0.0.0-polyfill",
            .module_type = .esm,
            .hash = bun.hash32(name ++ "@0.0.0-polyfill"),
            .main_fields = undefined,
            .browser_map = undefined,
            .source = logger.Source.initPathString(prefix ++ name ++ "/package.json", ""),
        },
        .code = code,
    };
}
