const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("../css_parser.zig");
pub const Error = css.Error;

pub const SupportsCondition = union(enum) {
    pub fn parse(input: *css.Parser) Error!SupportsCondition {
        _ = input; // autofix
    }

    pub fn parseDeclaration(input: *css.Parser) Error!SupportsCondition {
        _ = input; // autofix
    }
};
