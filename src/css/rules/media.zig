pub const css = @import("../css_parser.zig");
const MediaList = css.MediaList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const CssRuleList = css.CssRuleList;

pub fn MediaRule(comptime R: type) type {
    return struct {
        /// The media query list.
        query: css.MediaList,
        /// The rules within the `@media` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn minify(this: *This, context: *css.MinifyContext, parent_is_unused: bool) css.MinifyErr!bool {
            try this.rules.minify(context, parent_is_unused);

            return this.rules.v.items.len == 0 or this.query.neverMatches();
        }

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            if (dest.minify and this.query.alwaysMatches()) {
                try this.rules.toCss(dest);
                return;
            }
            // #[cfg(feature = "sourcemap")]
            // dest.addMapping(this.loc);

            try dest.writeStr("@media ");
            try this.query.toCss(dest);
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(dest);
            dest.dedent();
            try dest.newline();
            return dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}

const std = @import("std");
