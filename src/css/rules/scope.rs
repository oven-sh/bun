use crate::css_rules::{CssRuleList, Location, StyleContext};
use crate::selectors::SelectorList;
use crate::{PrintErr, Printer};

/// A [@scope](https://drafts.csswg.org/css-cascade-6/#scope-atrule) rule.
///
/// @scope (<scope-start>) [to (<scope-end>)]? {
///  <stylesheet>
/// }
pub struct ScopeRule<'bump, R> {
    /// A selector list used to identify the scoping root(s).
    pub(crate) scope_start: Option<SelectorList<'bump>>,
    /// A selector list used to identify any scoping limits.
    pub(crate) scope_end: Option<SelectorList<'bump>>,
    /// Nested rules within the `@scope` rule.
    pub(crate) rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<'bump, R> ScopeRule<'bump, R> {
    pub fn to_css(
        &self,
        dest: &mut Printer,
        ctx: Option<&StyleContext<'_, 'bump>>,
    ) -> Result<(), PrintErr> {
        use crate::selectors::selector::serialize::serialize_selector_list;
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@scope")?;
        dest.whitespace()?;
        // The scope preludes get their own budget for `&` substitutions when
        // compiling nesting, like style rule preludes do (see
        // `serialize::serialize_nesting`).
        dest.nesting_expansions = 0;
        if let Some(scope_start) = &self.scope_start {
            dest.write_char(b'(')?;
            // scope_start.to_css(dest)?;
            serialize_selector_list(scope_start.v.slice(), dest, ctx, false)?;
            dest.write_char(b')')?;
            dest.whitespace()?;
        }
        let was_in_scope_rule = core::mem::replace(&mut dest.in_scope_rule, true);
        if let Some(scope_end) = &self.scope_end {
            if dest.minify {
                dest.write_char(b' ')?;
            }
            dest.write_str("to (")?;
            // `&` in <scope-end> is the scoping root, not <scope-start>.
            serialize_selector_list(scope_end.v.slice(), dest, None, false)?;
            dest.write_char(b')')?;
            dest.whitespace()?;
        }
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;
        // Nested style rules within @scope are implicitly relative to the <scope-start>
        // so clear our style context while printing them to avoid replacing & ourselves.
        // https://drafts.csswg.org/css-cascade-6/#scoped-rules
        self.rules.to_css(dest, None)?;
        dest.in_scope_rule = was_in_scope_rule;
        dest.pending_semicolon = false;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')?;
        Ok(())
    }
}

impl<'bump, R> ScopeRule<'bump, R> {
    pub(crate) fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        Self {
            scope_start: self
                .scope_start
                .as_ref()
                .map(|s| super::dc::selector_list(s, bump)),
            scope_end: self
                .scope_end
                .as_ref()
                .map(|s| super::dc::selector_list(s, bump)),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
