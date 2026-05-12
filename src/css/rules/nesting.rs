use crate::css_rules::Location;
use crate::css_rules::style::StyleRule;
use crate::{PrintErr, Printer};

/// A [@nest](https://www.w3.org/TR/css-nesting-1/#at-nest) rule.
pub struct NestingRule<R> {
    /// The style rule that defines the selector and declarations for the `@nest` rule.
    pub style: StyleRule<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> NestingRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if dest.context().is_none() {
            dest.write_str("@nest ")?;
        }
        // NOTE: dispatches to the `StyleRule` to_css shim in rules/mod.rs until
        // style.rs un-gates its real body (selector serialize + Property::Composes).
        self.style.to_css(dest)
    }
}

impl<R> NestingRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            style: self.style.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/nesting.zig
