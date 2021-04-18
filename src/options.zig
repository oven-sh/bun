const std = @import("std");
const log = @import("logger.zig");

pub const Loader = enum {
    jsx,
    js,
    ts,
    tsx,
};

pub const TransformOptions = struct {
    footer: []u8 = "",
    banner: []u8 = "",
    define: std.StringHashMap([]u8),
    loader: Loader = Loader.tsx,
    resolve_dir: []u8 = "/",
    react_fast_refresh: bool = false,
    jsx_factory: []u8 = "React.createElement",
    jsx_pragma: []u8 = "jsx",
    inject: [][]u8,
    public_url: []u8,
    filesystem_cache: std.StringHashMap(fs.File),
    entry_point: fs.File,
};

pub const OutputFile = struct {
    path: []u8,
    contents: []u8,
};

pub const TransformResult = struct { errors: []log.Msg, warnings: []log.Msg, output_files: []OutputFile };
