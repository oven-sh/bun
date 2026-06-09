use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::{DeclarationBlock, PrintErr, Printer};

/// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
pub struct CounterStyleRule {
    /// The name of the counter style to declare.
    pub name: CustomIdent,
    /// Declarations in the `@counter-style` rule.
    // `DeclarationBlock<'bump>` borrows the parser arena; lifetime erased to
    // `'static` here per the rules/mod.rs `CssRule<R>` lifetime-erasure note.
    pub declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl CounterStyleRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@counter-style")?;
        super::custom_ident_to_css(&self.name, dest)?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl CounterStyleRule {
    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            name: self.name.deep_clone(bump),
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
