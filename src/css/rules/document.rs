use crate::css_rules::{CssRuleList, Location};
use crate::{PrintErr, Printer};

/// A [@-moz-document](https://www.w3.org/TR/2012/WD-css3-conditional-20120911/#at-document) rule.
///
/// Note that only the `url-prefix()` function with no arguments is supported, and only the `-moz` prefix
/// is allowed since Firefox was the only browser that ever implemented this rule.
pub struct MozDocumentRule<R> {
    /// Nested rules within the `@-moz-document` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> MozDocumentRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str("@-moz-document url-prefix()")?;
        dest.whitespace()?;
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')?;
        Ok(())
    }
}

// blocked_on: DeepClone trait derive.
#[cfg(any())]
impl<R> MozDocumentRule<R> {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — map to a
        // DeepClone trait/derive in Phase B. For now defer to the crate helper.
        crate::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/document.zig (39 lines)
//   confidence: high
//   todos:      1
//   notes:      struct un-gated; to_css/deep_clone gated on CssRuleList::to_css + DeepClone trait
// ──────────────────────────────────────────────────────────────────────────
