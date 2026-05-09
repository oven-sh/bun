use crate::css_rules::{CssRuleList, Location};
use crate::media_query::MediaList;
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
// PORT NOTE: `minify` lives in `rules/mod.rs` (hoisted next to `CssRuleList::
// minify` so the dispatch can call it without re-exporting `MinifyContext`
// here). `to_css` un-gated this round — `MediaList::{always_matches,to_css}`
// and `CssRuleList::to_css` are both real now.
impl<R> MediaRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if dest.minify && self.query.always_matches() {
            self.rules.to_css(dest)?;
            return Ok(());
        }
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@media ")?;
        self.query.to_css(dest)?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

impl<R> MediaRule<R> {
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        // PORT NOTE: `css.implementDeepClone` field-walk.
        Self {
            query: super::dc::media_list(&self.query, bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/media.zig
