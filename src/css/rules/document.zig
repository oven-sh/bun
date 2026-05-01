pub const css = @import("../css_parser.zig");
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;

/// A [@-moz-document](https://www.w3.org/TR/2012/WD-css3-conditional-20120911/#at-document) rule.
///
/// Note that only the `url-prefix()` function with no arguments is supported, and only the `-moz` prefix
/// is allowed since Firefox was the only browser that ever implemented this rule.
pub fn MozDocumentRule(comptime R: type) type {
    return struct {
        /// Nested rules within the `@-moz-document` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);
            try dest.writeStr("@-moz-document url-prefix()");
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
