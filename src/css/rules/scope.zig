const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const MediaList = css.MediaList;
const CustomMedia = css.CustomMedia;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrinterError = css.PrinterError;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;
const style = css.css_rules.style;
const CssRuleList = css.CssRuleList;

/// A [@scope](https://drafts.csswg.org/css-cascade-6/#scope-atrule) rule.
///
/// @scope (<scope-start>) [to (<scope-end>)]? {
///  <stylesheet>
/// }
pub fn ScopeRule(comptime R: type) type {
    return struct {
        /// A selector list used to identify the scoping root(s).
        scope_start: ?css.selector.parser.SelectorList,
        /// A selector list used to identify any scoping limits.
        scope_end: ?css.selector.parser.SelectorList,
        /// Nested rules within the `@scope` rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@scope");
            try dest.whitespace();
            if (this.scope_start) |*scope_start| {
                try dest.writeChar('(');
                // try scope_start.toCss(W, dest);
                try css.selector.serialize.serializeSelectorList(scope_start.v.slice(), W, dest, dest.context(), false);
                try dest.writeChar(')');
                try dest.whitespace();
            }
            if (this.scope_end) |*scope_end| {
                if (dest.minify) {
                    try dest.writeChar(' ');
                }
                try dest.writeStr("to (");
                // <scope-start> is treated as an ancestor of scope end.
                // https://drafts.csswg.org/css-nesting/#nesting-at-scope
                if (this.scope_start) |*scope_start| {
                    try dest.withContext(scope_start, scope_end, struct {
                        pub fn toCssFn(scope_end_: *const css.selector.parser.SelectorList, comptime WW: type, d: *Printer(WW)) PrintErr!void {
                            return css.selector.serialize.serializeSelectorList(scope_end_.v.slice(), WW, d, d.context(), false);
                        }
                    }.toCssFn);
                } else {
                    return css.selector.serialize.serializeSelectorList(scope_end.v.slice(), W, dest, dest.context(), false);
                }
                try dest.writeChar(')');
                try dest.whitespace();
            }
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            // Nested style rules within @scope are implicitly relative to the <scope-start>
            // so clear our style context while printing them to avoid replacing & ourselves.
            // https://drafts.csswg.org/css-cascade-6/#scoped-rules
            try dest.withClearedContext(&this.rules, CssRuleList(R).toCss);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}
