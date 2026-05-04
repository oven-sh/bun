use crate::values::ident::{DashedIdent, DashedIdentFns};
use crate::{Location, MediaList, PrintErr, Printer};
use bun_alloc::Arena;

/// A [@custom-media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) rule.
pub struct CustomMediaRule {
    /// The name of the declared media query.
    pub name: DashedIdent,
    /// The media query to declare.
    pub query: MediaList,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl CustomMediaRule {
    pub fn deep_clone(&self, bump: &Arena) -> Self {
        Self {
            name: self.name,
            query: self.query.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str("@custom-media ")?;
        DashedIdentFns::to_css(&self.name, dest)?;
        dest.write_char(' ')?;
        self.query.to_css(dest)?;
        dest.write_char(';')?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/custom_media.zig (38 lines)
//   confidence: high
//   todos:      0
//   notes:      arena param threaded as &bun_alloc::Arena; DashedIdentFns kept as free-fn namespace
// ──────────────────────────────────────────────────────────────────────────
