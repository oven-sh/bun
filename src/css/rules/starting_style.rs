use crate::css_rules::{CssRuleList, Location, StyleContext};
use crate::{PrintErr, Printer};

/// A [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule) rule.
pub struct StartingStyleRule<'bump, R> {
    /// Nested rules within the `@starting-style` rule.
    pub(crate) rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<'bump, R> StartingStyleRule<'bump, R> {
    pub(crate) fn to_css(
        &self,
        dest: &mut Printer,
        ctx: Option<&StyleContext<'_, 'bump>>,
    ) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@starting-style")?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d, ctx)
        })
    }
}

impl<'bump, R> StartingStyleRule<'bump, R> {
    pub(crate) fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        Self {
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
