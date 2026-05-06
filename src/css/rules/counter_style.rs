use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::{DeclarationBlock, PrintErr, Printer};

/// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
pub struct CounterStyleRule {
    /// The name of the counter style to declare.
    pub name: CustomIdent,
    /// Declarations in the `@counter-style` rule.
    // PORT NOTE: `DeclarationBlock<'bump>` borrows the parser arena; lifetime
    // erased to `'static` here per the rules/mod.rs `CssRule<R>` PORT NOTE.
    pub declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// ─── behavior bodies ──────────────────────────────────────────────────────
// blocked_on: DeclarationBlock::to_css_block (gated in declaration.rs) +
// DeepClone derive.
#[cfg(any())]
impl CounterStyleRule {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::css_values::ident::CustomIdentFns;
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@counter-style")?;
        CustomIdentFns::to_css(&self.name, dest)?;
        self.declarations.to_css_block(dest)
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with
        // #[derive(DeepClone)] or hand-written per-field clone in Phase B.
        crate::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/counter_style.zig (31 lines)
//   confidence: high
//   todos:      1
//   notes:      struct un-gated; to_css/deep_clone gated on DeclarationBlock::to_css_block + DeepClone; DeclarationBlock<'static> until 'bump threaded
// ──────────────────────────────────────────────────────────────────────────
