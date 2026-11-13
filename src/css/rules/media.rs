use crate::css_rules::{CssRuleList, Location, StyleContext};
use crate::media_query::MediaList;
use crate::{PrintErr, Printer};

/// A `@media` rule.
pub struct MediaRule<'bump, R> {
    /// The media query list.
    pub query: MediaList<'bump>,
    /// The rules within the `@media` rule.
    pub rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

// ─── behavior bodies ──────────────────────────────────────────────────────
// `minify` lives in `rules/mod.rs` (hoisted next to `CssRuleList::minify` so
// the dispatch can call it without re-exporting `MinifyContext` here).
impl<'bump, R> MediaRule<'bump, R> {
    pub fn to_css(
        &self,
        dest: &mut Printer,
        ctx: Option<&StyleContext<'_, 'bump>>,
    ) -> Result<(), PrintErr> {
        if dest.minify && self.query.always_matches() {
            self.rules.to_css(dest, ctx)?;
            return Ok(());
        }
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@media ")?;
        self.query.to_css(dest)?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d, ctx)
        })
    }
}

impl<'bump, R> MediaRule<'bump, R> {
    pub(crate) fn deep_clone(&self, bump: &'bump bun_alloc::Arena) -> Self
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
