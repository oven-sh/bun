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
            // PORT NOTE: read `dest.ctx` directly (Copy) — `Printer::context()`
            // ties the borrow to `&self`, which conflicts with `&mut dest`.
            let ctx = dest.ctx;
            serialize_selector_list(scope_start.v.slice(), dest, ctx, false)?;
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
                // PORT NOTE: Zig passed an anon-struct fn pointer; the Rust
                // `Printer::with_context` carries the captured state as the
                // first closure arg (no `&self` capture across `&mut dest`).
                dest.with_context(
                    scope_start,
                    scope_end,
                    |scope_end: &SelectorList, d: &mut Printer| -> Result<(), PrintErr> {
                        let ctx = d.ctx;
                        serialize_selector_list(scope_end.v.slice(), d, ctx, false)
                    },
                )?;
            } else {
                let ctx = dest.ctx;
                return serialize_selector_list(scope_end.v.slice(), dest, ctx, false);
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
        dest.with_cleared_context(&self.rules, |rules, d: &mut Printer| rules.to_css(d))?;
        dest.dedent();
        dest.newline()?;
        dest.write_char(b'}')?;
        Ok(())
    }
}

impl<R> ScopeRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk. `SelectorList::
        // deep_clone()` intentionally drops the `&Arena` (selectors/parser.rs
        // — every payload is arena-static); routed via `dc::selector_list`.
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

// ported from: src/css/rules/scope.zig
