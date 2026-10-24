use crate::css_parser::MAX_NESTING_DEPTH;
use crate::css_rules::{CssRuleList, Location};
use crate::error::PrinterErrorKind;
use crate::media_query::{LoweredList, MediaList};
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

        if let Some(lowered) = self.query.lowered(dest) {
            return self.to_css_lowered(&lowered, dest);
        }

        dest.write_str("@media ")?;
        self.query.to_css(dest)?;
        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }

    /// Writes the rules once for each chain of `lowered`, inside the nested `@media`
    /// rules of that chain.
    #[cold]
    fn to_css_lowered(
        &self,
        lowered: &LoweredList<'_>,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        for chain in 0..lowered.chains() {
            let depth = lowered.depth(chain);
            // The parser reads no stylesheet that nests deeper, so a block in the
            // source cannot get here. A query with that many strict bounds can.
            if dest.indent_amt / 2 + depth > MAX_NESTING_DEPTH {
                return dest.new_error(PrinterErrorKind::maximum_media_query_expansion, None);
            }
            if chain == 0 {
                self.write_chain(lowered, chain, 0, depth, dest)?;
                continue;
            }
            if !dest.minify {
                dest.write_char(b'\n')?;
            }
            dest.newline()?;
            let bytes_before = dest.bytes_written();
            self.write_chain(lowered, chain, 0, depth, dest)?;
            dest.charge_duplicate_pass(
                bytes_before,
                PrinterErrorKind::maximum_media_query_expansion,
            )?;
        }
        Ok(())
    }

    /// Writes rule number `clause` of the chain, around the rules after it and the
    /// block: nesting is how CSS says "and" between query lists.
    fn write_chain(
        &self,
        lowered: &LoweredList<'_>,
        chain: u32,
        clause: u32,
        depth: u32,
        dest: &mut Printer,
    ) -> Result<(), PrintErr> {
        dest.write_str("@media ")?;
        lowered.write(chain, clause, dest)?;
        dest.block(|d| {
            d.newline()?;
            if clause + 1 < depth {
                self.write_chain(lowered, chain, clause + 1, depth, d)
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
