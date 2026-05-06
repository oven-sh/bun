use crate::css_rules::{CssRuleList, Location};
use crate::{PrintErr, Printer};

/// A [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule) rule.
pub struct StartingStyleRule<R> {
    /// Nested rules within the `@starting-style` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> StartingStyleRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@starting-style")?;
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

// blocked_on: DeepClone derive.
#[cfg(any())]
impl<R> StartingStyleRule<R> {
    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with a DeepClone trait/derive in Phase B
        crate::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/starting_style.zig (39 lines)
//   confidence: high
//   todos:      1
//   notes:      struct un-gated; to_css/deep_clone gated on CssRuleList::to_css + DeepClone trait
// ──────────────────────────────────────────────────────────────────────────
