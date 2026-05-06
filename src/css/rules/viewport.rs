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

// blocked_on: DeepClone derive.
#[cfg(any())]
impl ViewportRule {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone is comptime field reflection; replace with #[derive(DeepClone)] or trait impl in Phase B
        crate::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/viewport.zig (31 lines)
//   confidence: high
//   todos:      1
//   notes:      struct un-gated; to_css/deep_clone gated on DeclarationBlock::to_css_block + DeepClone; DeclarationBlock<'static> until 'bump threaded
// ──────────────────────────────────────────────────────────────────────────
