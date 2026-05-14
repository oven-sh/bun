use crate::css_rules::Location;
use crate::{DeclarationBlock, PrintErr, Printer, VendorPrefix};

/// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
pub struct ViewportRule {
    /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
    pub vendor_prefix: VendorPrefix,
    /// The declarations within the `@viewport` rule.
    // PORT NOTE: `DeclarationBlock<'bump>` borrows the parser arena; lifetime
    // erased to `'static` here per the rules/mod.rs `CssRule<R>` PORT NOTE
    // (the `'bump` arena lifetime is re-threaded crate-wide in one pass).
    pub declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl ViewportRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_char(b'@')?;
        super::vendor_prefix_to_css(self.vendor_prefix, dest)?;
        dest.write_str("viewport")?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl ViewportRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // PORT NOTE: `css.implementDeepClone` field-walk. `VendorPrefix` is a
        // `Copy` bitflag (generics.zig "simple copy types" → identity).
        Self {
            vendor_prefix: self.vendor_prefix,
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/viewport.zig
