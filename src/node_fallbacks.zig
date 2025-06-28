const std = @import("std");
const string = @import("./string_types.zig").string;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const logger = bun.logger;
const Fs = @import("./fs.zig");
const bun = @import("bun");
const Environment = bun.Environment;

pub const import_path = "/bun-vfs$$/node_modules/";

comptime {
    // Ensure that checking for the prefix should be a cheap lookup (bun.strings.hasPrefixComptime)
    // because 24 bytes == 8 * 3 --> read and compare three u64s
    bun.assert(import_path.len % 8 == 0);
}

pub const FallbackModule = struct {
    path: Fs.Path,
    package_json: *const PackageJSON,
    code: *const fn () string,

    // This workaround exists to allow bun.runtimeEmbedFile to work.
    // Using `@embedFile` forces you to wait for the Zig build to finish in
    // debug builds, even when you only changed JS builtins.
    fn createSourceCodeGetter(comptime code_path: string) *const fn () string {
        const Getter = struct {
            fn get() string {
                if (bun.Environment.codegen_embed) {
                    return @embedFile(code_path);
                }

                return bun.runtimeEmbedFile(.codegen, code_path);
            }
        };

        return Getter.get;
    }

    pub fn init(comptime name: string) FallbackModule {
        @setEvalBranchQuota(99999);
        const version = "0.0.0-polyfill";
        const code_path = "node-fallbacks/" ++ name ++ ".js";
        return .{
            .path = Fs.Path.initWithNamespaceVirtual(import_path ++ name ++ "/index.js", "node", name),
            .package_json = &PackageJSON{
                .name = name,
                .version = version,
                .module_type = .esm,
                .main_fields = undefined,
                .browser_map = undefined,
                .source = logger.Source.initPathString(import_path ++ name ++ "/package.json", ""),
                .side_effects = .false,
            },
            .code = createSourceCodeGetter(code_path),
        };
    }
};

pub const Map = bun.ComptimeStringMap(FallbackModule, .{
    .{ "assert", FallbackModule.init("assert") },
    .{ "buffer", FallbackModule.init("buffer") },
    .{ "console", FallbackModule.init("console") },
    .{ "constants", FallbackModule.init("constants") },
    .{ "crypto", FallbackModule.init("crypto") },
    .{ "domain", FallbackModule.init("domain") },
    .{ "events", FallbackModule.init("events") },
    .{ "http", FallbackModule.init("http") },
    .{ "https", FallbackModule.init("https") },
    .{ "net", FallbackModule.init("net") },
    .{ "os", FallbackModule.init("os") },
    .{ "path", FallbackModule.init("path") },
    .{ "process", FallbackModule.init("process") },
    .{ "punycode", FallbackModule.init("punycode") },
    .{ "querystring", FallbackModule.init("querystring") },
    .{ "stream", FallbackModule.init("stream") },
    .{ "string_decoder", FallbackModule.init("string_decoder") },
    .{ "sys", FallbackModule.init("sys") },
    .{ "timers", FallbackModule.init("timers") },
    .{ "tty", FallbackModule.init("tty") },
    .{ "url", FallbackModule.init("url") },
    .{ "util", FallbackModule.init("util") },
    .{ "zlib", FallbackModule.init("zlib") },
});

pub fn contentsFromPath(path: string) ?string {
    if (Environment.allow_assert)
        bun.assert(bun.strings.hasPrefixComptime(path, import_path));

    var module_name = path[import_path.len..];
    module_name = module_name[0 .. std.mem.indexOfScalar(u8, module_name, '/') orelse module_name.len];

    if (Map.get(module_name)) |mod| {
        return mod.code();
    }

    return null;
}
