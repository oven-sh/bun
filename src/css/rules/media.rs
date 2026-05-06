use crate as css;
use crate::css_rules::{CssRuleList, Location, MinifyContext};
use crate::error::MinifyErr;
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
// blocked_on: CssRuleList::{minify,to_css} (gated in rules/mod.rs until leaf
// rules un-gate) and MediaList::{always_matches,never_matches,to_css} (gated
// in media_query.rs until the values/ calc lattice un-gates).
#[cfg(any())]
impl<R> MediaRule<R> {
    pub fn minify(&mut self, context: &mut MinifyContext, parent_is_unused: bool) -> Result<bool, MinifyErr> {
        self.rules.minify(context, parent_is_unused)?;

        Ok(self.rules.v.len() == 0 || self.query.never_matches())
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if dest.minify && self.query.always_matches() {
            self.rules.to_css(dest)?;
            return Ok(());
        }
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@media ")?;
        self.query.to_css(dest)?;
        dest.whitespace()?;
        dest.write_char('{')?;
        dest.indent();
        dest.newline()?;
        self.rules.to_css(dest)?;
        dest.dedent();
        dest.newline()?;
        dest.write_char('}')
    }

    pub fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        // TODO(port): css.implementDeepClone uses @typeInfo field reflection — replace with
        // a DeepClone trait/derive in Phase B.
        css::implement_deep_clone(self, bump)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/media.zig (51 lines)
//   confidence: high
//   todos:      1
//   notes:      struct un-gated; minify/to_css/deep_clone bodies gated on CssRuleList + MediaList behavior; rules.v assumed Vec-like (.len()).
// ──────────────────────────────────────────────────────────────────────────
