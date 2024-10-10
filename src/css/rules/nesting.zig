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

/// A [@nest](https://www.w3.org/TR/css-nesting-1/#at-nest) rule.
pub fn NestingRule(comptime R: type) type {
    return struct {
        /// The style rule that defines the selector and declarations for the `@nest` rule.
        style: style.StyleRule(R),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);
            if (dest.context() == null) {
                try dest.writeStr("@nest ");
            }
            return try this.style.toCss(W, dest);
        }
    };
}
