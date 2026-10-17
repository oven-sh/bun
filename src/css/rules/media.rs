use crate::css_rules::{CssRuleList, Location};
use crate::media_query::{LoweredClauses, MediaList};
use crate::{PrintErr, Printer};

/// A `@media` rule.
pub struct MediaRule<R> {
    /// The media query list.
    pub query: MediaList,
    /// The rules within the `@media` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// ─── behavior bodies ──────────────────────────────────────────────────────
// `minify` lives in `rules/mod.rs` (hoisted next to `CssRuleList::minify` so
// the dispatch can call it without re-exporting `MinifyContext` here).
impl<R> MediaRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if dest.minify && self.query.always_matches() {
            self.rules.to_css(dest)?;
            return Ok(());
        }
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        if let Some(clauses) = self.query.lowered_clauses(&dest.targets) {
            return self.write_clauses(&clauses, 0, dest);
        }

        dest.write_str("@media ")?;
        self.query.to_css_as_written(dest)?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }

    /// Writes one `@media` per clause from `clause` on, each nested in the one before,
    /// around the rules: nesting is how CSS says "and" between query lists.
    #[cold]
    fn write_clauses(
        &self,
        clauses: &LoweredClauses<'_>,
        clause: u32,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        dest.write_str("@media ")?;
        clauses.write(clause, dest)?;
        dest.block(|d| {
            d.newline()?;
            if clause + 1 < clauses.count() {
                self.write_clauses(clauses, clause + 1, d)
            } else {
                self.rules.to_css(d)
            }
        })
    }
}

impl<R> MediaRule<R> {
    pub(crate) fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        Self {
            query: super::dc::media_list(&self.query, bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
