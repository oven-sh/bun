const std = @import("std");
const log = @import("logger.zig");
const fs = @import("fs.zig");

usingnamespace @import("strings.zig");

const assert = std.debug.assert;

pub const Loader = enum {
    jsx,
    js,
    ts,
    tsx,
    css,
    file,
};

pub const defaultLoaders = std.ComptimeStringMap(Loader, .{
    .{ ".jsx", Loader.jsx },
    .{ ".js", Loader.js },
    .{ ".mjs", Loader.js },
    .{ ".css", Loader.css },
    .{ ".ts", Loader.ts },
    .{ ".tsx", Loader.tsx },
});

pub const TransformOptions = struct {
    footer: []const u8 = "",
    banner: []const u8 = "",
    define: std.StringHashMap(string),
    loader: Loader = Loader.tsx,
    resolve_dir: []const u8 = "/",
    react_fast_refresh: bool = false,
    jsx_factory: []const u8 = "React.createElement",
    jsx_pragma: []const u8 = "jsx",
    inject: ?[][]const u8 = null,
    public_url: []const u8 = "/",
    filesystem_cache: std.StringHashMap(fs.File),
    entry_point: *fs.File,

    pub fn initUncached(allocator: *std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        const filesystemCache = std.StringHashMap(string).init(allocator);

        var entryPoint = !allocator.Create(fs.file);
        entryPoint.path = fs.Path.init(entryPointName, allocator);
        entryPoint.contents = code;

        const define = std.StringHashMap(string).init(allocator);
        try define.ensureCapacity(1);

        define.putAssumeCapacity("process.env.NODE_ENV", "development");

        var loader = Loader.file;
        if (defaultLoaders.get(entryPoint.path.name.ext)) |defaultLoader| {
            loader = defaultLoader;
        }

        assert(loader != .file);
        assert(code.len > 0);
        try filesystemCache.put(entryPointName, entryPoint);

        return TransformOptions{
            .entry_point = entryPoint,
            .define = define,
            .loader = loader,
            .filesystem_cache = filesystemCache,
            .resolve_dir = entryPoint.path.name.dir,
        };
    }
};

pub const OutputFile = struct {
    path: []u8,
    contents: []u8,
};

pub const TransformResult = struct { errors: []log.Msg, warnings: []log.Msg, output_files: []OutputFile };
