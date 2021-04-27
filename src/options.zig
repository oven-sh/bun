const std = @import("std");
const log = @import("logger.zig");
const fs = @import("fs.zig");
const alloc = @import("alloc.zig");

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

pub const JSX = struct {
    parse: bool = true,
    factory: string = "React.createElement",
    fragment: string = "jsx",
};

const TypeScript = struct {
    parse: bool = false,
};

pub const TransformOptions = struct {
    footer: string = "",
    banner: string = "",
    define: std.StringHashMap(string),
    loader: Loader = Loader.tsx,
    resolve_dir: string = "/",
    jsx_factory: string = "React.createElement",
    jsx_fragment: string = "jsx",
    ts: bool = true,
    react_fast_refresh: bool = false,
    inject: ?[]string = null,
    public_url: string = "/",
    filesystem_cache: std.StringHashMap(fs.File),
    entry_point: fs.File,
    resolve_paths: bool = false,

    pub fn initUncached(allocator: *std.mem.Allocator, entryPointName: string, code: string) !TransformOptions {
        assert(entryPointName.len > 0);

        var filesystemCache = std.StringHashMap(fs.File).init(allocator);

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

test "TransformOptions.initUncached" {
    try alloc.setup(std.heap.page_allocator);
    const opts = try TransformOptions.initUncached(alloc.dynamic, "lol.jsx", "<Hi />");

    std.testing.expectEqualStrings("lol", opts.entry_point.path.name.base);
    std.testing.expectEqualStrings(".jsx", opts.entry_point.path.name.ext);
    std.testing.expect(Loader.jsx == opts.loader);
}
