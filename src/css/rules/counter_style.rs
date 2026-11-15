use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::{DeclarationBlock, PrintErr, Printer};

/// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
pub struct CounterStyleRule<'bump> {
    /// The name of the counter style to declare.
    pub name: CustomIdent<'bump>,
    /// Declarations in the `@counter-style` rule.
    pub(crate) declarations: DeclarationBlock<'bump>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl CounterStyleRule<'_> {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@counter-style ")?;
        // `list-style` and `counter()` name it unhashed, so a CSS module leaves it global.
        self.name.to_css_with_options(dest, false)?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl<'bump> CounterStyleRule<'bump> {
    pub(crate) fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self {
        Self {
            name: self.name.deep_clone(bump),
            declarations: super::dc::decl_block(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
