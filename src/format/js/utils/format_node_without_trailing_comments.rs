use crate::prelude::*;

/// Prints a node without the trailing comments it owns. The caller prints them.
pub(crate) struct FormatNodeWithoutTrailingComments<'b, T>(pub(crate) &'b T);

impl<'a, T: Format<'a> + Spanned> Format<'a> for FormatNodeWithoutTrailingComments<'_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return self.0.fmt(f);
        }
        f.context_mut().set_skip_trailing_comments(true);
        self.0.fmt(f);
        f.context_mut().set_skip_trailing_comments(false);
    }
}
