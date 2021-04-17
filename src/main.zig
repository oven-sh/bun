const std = @import("std");
const lex = @import("lexer/js_lexer.zig");

pub fn main() anyerror!void {
    std.log.info("All your codebase are belong to us. {s}", .{lex.Keywords.get("hey")});
}
