const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");

// TODO: this should be generated
pub const Feature = enum {
    comptime {
        @compileError(css.todo_stuff.depth);
    }
};
