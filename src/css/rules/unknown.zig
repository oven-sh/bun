pub const css = @import("../css_parser.zig");
pub const css_values = @import("../values/values.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// An unknown at-rule, stored as raw tokens.
pub const UnknownAtRule = struct {
    /// The name of the at-rule (without the @).
    name: []const u8,
    /// The prelude of the rule.
    prelude: css.TokenList,
    /// The contents of the block, if any.
    block: ?css.TokenList,
    /// The location of the rule in the source file.
    loc: css.Location,

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeChar('@');
        try dest.writeStr(this.name);

        if (this.prelude.v.items.len > 0) {
            try dest.writeChar(' ');
            try this.prelude.toCss(dest, false);
        }

        if (this.block) |*block| {
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try block.toCss(dest, false);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        } else {
            try dest.writeChar(';');
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;
