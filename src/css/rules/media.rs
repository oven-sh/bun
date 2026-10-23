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
// `minify` lives in `rules/mod.rs` (hoisted next to `CssRuleList::minify` so
// the dispatch can call it without re-exporting `MinifyContext` here).
impl<R> MediaRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        if !open_block(&self.query, dest)? {
            self.rules.to_css(dest)?;
            return Ok(());
        }
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.block_end()
    }
}

/// Prints `@media <query> {`. When minifying a query that always matches, it
/// prints nothing and returns false: the rules then print without a block.
pub(crate) fn open_block(query: &MediaList, dest: &mut Printer) -> Result<bool, PrintErr> {
    if dest.minify && query.always_matches() {
        return Ok(false);
    }
    dest.write_str("@media ")?;
    query.to_css(dest)?;
    dest.block_start()?;
    Ok(true)
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
