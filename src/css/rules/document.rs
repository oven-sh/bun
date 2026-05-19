use crate::css_rules::{CssRuleList, Location};
use crate::{PrintErr, Printer};

/// A [@-moz-document](https://www.w3.org/TR/2012/WD-css3-conditional-20120911/#at-document) rule.
///
/// Note that only the `url-prefix()` function with no arguments is supported, and only the `-moz` prefix
/// is allowed since Firefox was the only browser that ever implemented this rule.
pub struct MozDocumentRule<'bump, R> {
    /// Nested rules within the `@-moz-document` rule.
    pub rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> MozDocumentRule<'_, R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str("@-moz-document url-prefix()")?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

impl<R> MozDocumentRule<'_, R> {
    pub fn deep_clone<'b>(&self, bump: &'b bun_alloc::Arena) -> MozDocumentRule<'b, R>
    where
        R: crate::generics::DeepClone<'b>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        MozDocumentRule {
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/document.zig
