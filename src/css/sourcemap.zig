const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
const Ident = css_values.ident.Ident;
pub const Error = css.Error;
const Location = css.Location;
const ArrayList = std.ArrayListUnmanaged;

pub const SourceMap = struct {
    project_root: []const u8,
    inner: SourceMapInner,
};

pub const SourceMapInner = struct {
    sources: ArrayList([]const u8),
    sources_content: ArrayList([]const u8),
    names: ArrayList([]const u8),
    mapping_lines: ArrayList(MappingLine),
};

pub const MappingLine = struct { mappings: ArrayList(LineMapping), last_column: u32, is_sorted: bool };

pub const LineMapping = struct { generated_column: u32, original: ?OriginalLocation };

pub const OriginalLocation = struct {
    original_line: u32,
    original_column: u32,
    source: u32,
    name: ?u32,
};
