const std = @import("std");
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;

pub fn ValidSelectorParser(comptime T: type) type {
    _ = T.SelectorParser.Impl;
}
