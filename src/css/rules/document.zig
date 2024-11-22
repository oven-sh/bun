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
const Dependency = css.Dependency;
const dependencies = css.dependencies;
const Url = css.css_values.url.Url;
const Size2D = css.css_values.size.Size2D;
const fontprops = css.css_properties.font;
const LayerName = css.css_rules.layer.LayerName;
const Location = css.css_rules.Location;
const Angle = css.css_values.angle.Angle;
const FontStyleProperty = css.css_properties.font.FontStyle;
const FontFamily = css.css_properties.font.FontFamily;
const FontWeight = css.css_properties.font.FontWeight;
const FontStretch = css.css_properties.font.FontStretch;
const CustomProperty = css.css_properties.custom.CustomProperty;
const CustomPropertyName = css.css_properties.custom.CustomPropertyName;
const DashedIdent = css.css_values.ident.DashedIdent;

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

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);
            try dest.writeStr("@-moz-document url-prefix()");
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();
            try this.rules.toCss(W, dest);
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
        }
    };
}
