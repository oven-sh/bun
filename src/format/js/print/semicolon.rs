use crate::prelude::*;

/// A `;`, unless the options say to leave them out.
pub(crate) struct OptionalSemicolon;

impl<'a> Format<'a> for OptionalSemicolon {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().semicolons.is_always() {
            ";".fmt(f);
        }
    }
}
