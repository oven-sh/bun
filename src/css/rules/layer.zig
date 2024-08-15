const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Error = css.Error;

const ArrayList = std.ArrayListUnmanaged;

// TODO: make this equivalent of SmallVec<[CowArcStr<'i>; 1]
