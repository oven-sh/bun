use crate::css_rules::Location;
use crate::{DeclarationBlock, PrintErr, Printer, VendorPrefix};

/// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
pub struct ViewportRule {
    /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
    pub vendor_prefix: VendorPrefix,
    /// The declarations within the `@viewport` rule.
    // `DeclarationBlock<'bump>` borrows the parser arena; the lifetime is
    // erased to `'static` here, matching `CssRule<R>` in rules/mod.rs
    // (the `'bump` arena lifetime is re-threaded crate-wide in one pass).
    pub declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl ViewportRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_char(b'@')?;
        super::vendor_prefix_to_css(self.vendor_prefix, dest)?;
        dest.write_str("viewport")?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl ViewportRule {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            vendor_prefix: self.vendor_prefix,
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
