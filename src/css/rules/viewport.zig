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

/// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
pub const ViewportRule = struct {
    /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
    vendor_prefix: css.VendorPrefix,
    /// The declarations within the `@viewport` rule.
    declarations: css.DeclarationBlock,
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        try dest.writeChar('@');
        try this.vendor_prefix.toCss(W, dest);
        try dest.writeStr("viewport");
        try this.declarations.toCssBlock(W, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
