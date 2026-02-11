pub const css = @import("../css_parser.zig");
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const style = css.css_rules.style;
const CssRuleList = css.CssRuleList;

/// A [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule) rule.
pub fn StartingStyleRule(comptime R: type) type {
    return struct {
        /// Nested rules within the `@starting-style` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@starting-style");
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}

const std = @import("std");
