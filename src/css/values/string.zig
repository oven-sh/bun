const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Error = css.Error;
pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

/// A quoted CSS string.
pub const CSSString = []const u8;
pub const CSSStringFns = struct {
    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        _ = this; // autofix
        _ = dest; // autofix
        @compileError(css.todo_stuff.depth);
    }
};
