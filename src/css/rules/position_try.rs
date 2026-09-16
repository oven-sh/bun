use crate::css_rules::Location;
use crate::css_values::ident::DashedIdent;
use crate::{DeclarationBlock, PrintErr, Printer};

/// A [@position-try](https://drafts.csswg.org/css-anchor-position-1/#at-ruledef-position-try) rule.
pub struct PositionTryRule {
    /// The name of the position try fallback.
    pub name: DashedIdent,
    /// Declarations in the `@position-try` rule.
    // Lifetime erased to `'static` per the rules/mod.rs `CssRule<R>` note.
    pub(crate) declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl PositionTryRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_str("@position-try ")?;
        super::dashed_ident_to_css(&self.name, dest)?;
        super::decl_block_to_css(&self.declarations, dest)
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            name: self.name.deep_clone(bump),
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
