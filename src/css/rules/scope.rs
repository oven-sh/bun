use crate::css_rules::{CssRuleList, Location};
use crate::selectors::SelectorList;
use crate::{PrintErr, Printer};

/// A [@scope](https://drafts.csswg.org/css-cascade-6/#scope-atrule) rule.
///
/// @scope (<scope-start>) [to (<scope-end>)]? {
///  <stylesheet>
/// }
pub struct ScopeRule<R> {
    /// A selector list used to identify the scoping root(s).
    pub scope_start: Option<SelectorList>,
    /// A selector list used to identify any scoping limits.
    pub scope_end: Option<SelectorList>,
    /// Nested rules within the `@scope` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// ─── behavior bodies ──────────────────────────────────────────────────────
// blocked_on: CssRuleList::to_css (gated in rules/mod.rs),
// selector::serialize::serialize_selector_list (selector.rs body gated on
// values/ident Fns), Printer::{with_context,with_cleared_context} (printer.rs
// gated context helpers), DeepClone derive.
#[cfg(any())]
impl<R> ScopeRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use crate::selectors::selector::serialize::serialize_selector_list;
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@scope")?;
        dest.whitespace()?;
        if let Some(scope_start) = &self.scope_start {
            dest.write_char(b'(')?;
            // scope_start.to_css(dest)?;
            serialize_selector_list(scope_start.v.as_slice(), dest, dest.context(), false)?;
            dest.write_char(b')')?;
            dest.whitespace()?;
        }
        if let Some(scope_end) = &self.scope_end {
            if dest.minify {
                dest.write_char(b' ')?;
            }
            dest.write_str("to (")?;
            // <scope-start> is treated as an ancestor of scope end.
            // https://drafts.csswg.org/css-nesting/#nesting-at-scope
            if let Some(scope_start) = &self.scope_start {
                // PORT NOTE: Zig passed an anon-struct fn pointer; Rust uses a closure capturing scope_end.
                dest.with_context(scope_start, |d: &mut Printer| -> Result<(), PrintErr> {
                    serialize_selector_list(scope_end.v.as_slice(), d, d.context(), false)
                })?;
            } else {
                return serialize_selector_list(scope_end.v.as_slice(), dest, dest.context(), false);
            }
            dest.write_char(b')')?;
            dest.whitespace()?;
        }
        dest.write_char(b'{')?;
        dest.indent();
        dest.newline()?;
        // Nested style rules within @scope are implicitly relative to the <scope-start>
        // so clear our style context while printing them to avoid replacing & ourselves.
        // https://drafts.csswg.org/css-cascade-6/#scoped-rules
        dest.with_cleared_context(|d: &mut Printer| self.rules.to_css(d))?;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')?;
        Ok(())
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with a
        // DeepClone trait/derive in Phase B.
        crate::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/scope.zig (76 lines)
//   confidence: medium
//   todos:      1
//   notes:      struct un-gated; to_css/deep_clone gated on CssRuleList::to_css + selector serialize + Printer context helpers; with_context/with_cleared_context reshaped to closures
// ──────────────────────────────────────────────────────────────────────────
