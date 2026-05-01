pub const css = @import("../css_parser.zig");
pub const css_values = @import("../values/values.zig");
pub const Error = css.Error;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

/// A [@custom-media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) rule.
pub const CustomMediaRule = struct {
    /// The name of the declared media query.
    name: css_values.ident.DashedIdent,
    /// The media query to declare.
    query: css.MediaList,
    /// The location of the rule in the source file.
    loc: css.Location,

    const This = @This();

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return This{
            .name = this.name,
            .query = this.query.deepClone(allocator),
            .loc = this.loc,
        };
    }

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        try dest.writeStr("@custom-media ");
        try css_values.ident.DashedIdentFns.toCss(&this.name, dest);
        try dest.writeChar(' ');
        try this.query.toCss(dest);
        try dest.writeChar(';');
    }
};

const std = @import("std");
const Allocator = std.mem.Allocator;
