const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Result = css.Result;
pub const Printer = css.Printer;
pub const PrintErr = css.PrintErr;

/// A quoted CSS string.
pub const CSSString = []const u8;
pub const CSSStringFns = struct {
    pub fn parse(input: *css.Parser) Result(CSSString) {
        return input.expectString();
    }

    pub fn toCss(this: *const []const u8, comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.serializer.serializeString(this.*, dest) catch return dest.addFmtError();
    }
};
