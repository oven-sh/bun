use crate::css_rules::Location;
use crate::media_query::MediaList;
use crate::values::ident::{DashedIdent, DashedIdentFns};
use crate::{PrintErr, Printer};
use bun_alloc::Arena;

/// A [@custom-media](https://drafts.csswg.org/mediaqueries-5/#custom-mq) rule.
pub struct CustomMediaRule {
    /// The name of the declared media query.
    pub(crate) name: DashedIdent,
    /// The media query to declare.
    pub(crate) query: MediaList,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl CustomMediaRule {
    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        Self {
            name: self.name,
            query: self.query.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        dest.write_str("@custom-media ")?;
        DashedIdentFns::to_css(&self.name, dest)?;
        dest.write_char(b' ')?;
        self.query.to_css(dest)?;
        dest.write_char(b';')?;
        Ok(())
    }
}
