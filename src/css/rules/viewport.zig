pub const css = @import("../css_parser.zig");
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Location = css.css_rules.Location;

/// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
pub const ViewportRule = struct {
    /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
    vendor_prefix: css.VendorPrefix,
    /// The declarations within the `@viewport` rule.
    declarations: css.DeclarationBlock,
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        try dest.writeChar('@');
        try this.vendor_prefix.toCss(dest);
        try dest.writeStr("viewport");
        try this.declarations.toCssBlock(dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

const std = @import("std");
