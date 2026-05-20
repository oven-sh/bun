use crate::css_rules::Location;
use crate::css_values::ident::CustomIdent;
use crate::{DeclarationBlock, PrintErr, Printer};

/// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
pub struct CounterStyleRule<'bump> {
    /// The name of the counter style to declare.
    pub name: CustomIdent,
    /// Declarations in the `@counter-style` rule.
    pub declarations: DeclarationBlock<'bump>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl CounterStyleRule<'_> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@counter-style")?;
        super::custom_ident_to_css(&self.name, dest)?;
        super::decl_block_to_css(&self.declarations, dest)
    }
}

impl CounterStyleRule<'_> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> CounterStyleRule<'bump> {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        CounterStyleRule {
            name: self.name.deep_clone(bump),
            declarations: super::dc::decl_block(&self.declarations, bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/counter_style.zig
