use crate::css_rules::{CssRuleList, Location};
use crate::{PrintErr, Printer};

/// A [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule) rule.
pub struct StartingStyleRule<'bump, R> {
    /// Nested rules within the `@starting-style` rule.
    pub rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> StartingStyleRule<'_, R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@starting-style")?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

impl<R> StartingStyleRule<'_, R> {
    pub fn deep_clone<'b>(&self, bump: &'b bun_alloc::Arena) -> StartingStyleRule<'b, R>
    where
        R: crate::generics::DeepClone<'b>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        StartingStyleRule {
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/starting_style.zig
