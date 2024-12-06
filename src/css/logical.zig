const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const Error = css.Error;

const ArrayList = std.ArrayListUnmanaged;

pub const PropertyCategory = enum {
    logical,
    physical,

    pub fn default() PropertyCategory {
        return .physical;
    }
};

pub const LogicalGroup = enum {
    border_color,
    border_style,
    border_width,
    border_radius,
    margin,
    scroll_margin,
    padding,
    scroll_padding,
    inset,
    size,
    min_size,
    max_size,
};
