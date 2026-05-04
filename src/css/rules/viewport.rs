use crate::css_parser as css;
use crate::css_parser::{PrintErr, Printer};
use crate::css_rules::Location;

/// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
pub struct ViewportRule {
    /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
    pub vendor_prefix: css::VendorPrefix,
    /// The declarations within the `@viewport` rule.
    pub declarations: css::DeclarationBlock,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl ViewportRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_char('@')?;
        self.vendor_prefix.to_css(dest)?;
        dest.write_str("viewport")?;
        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime field reflection; replace with #[derive(DeepClone)] or trait impl in Phase B
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/viewport.zig (31 lines)
//   confidence: high
//   todos:      1
//   notes:      implementDeepClone is comptime reflection — needs derive/trait in Phase B
// ──────────────────────────────────────────────────────────────────────────
