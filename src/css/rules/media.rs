use crate::css_rules::{CssRuleList, Location, StyleContext};
use crate::media_query::MediaList;
use crate::{PrintErr, Printer};

/// A `@media` rule.
pub struct MediaRule<'bump, R> {
    /// The media query list.
    pub(crate) query: MediaList<'bump>,
    /// The rules within the `@media` rule.
    pub(crate) rules: CssRuleList<'bump, R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
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
        block_to_css(&self.query, dest, |d| self.rules.to_css(d, ctx))
    }
}

pub(crate) fn block_to_css<'p>(
    query: &MediaList,
    dest: &mut Printer<'p>,
    body: impl FnOnce(&mut Printer<'p>) -> Result<(), PrintErr>,
) -> Result<(), PrintErr> {
    if dest.minify && query.always_matches() {
        return body(dest);
    }

    dest.write_str("@media ")?;
    query.to_css(dest)?;
    dest.block(|d| {
        d.newline()?;
        body(d)
    })
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
