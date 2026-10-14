use crate::js::format::write_ignored_node;
use crate::prelude::*;

/// Writes a node and leaves the comments after it to the caller.
pub(crate) struct FormatNodeWithoutTrailingComments<'b, T>(pub(crate) &'b T);

impl<'a, T: Format<'a> + Spanned> Format<'a> for FormatNodeWithoutTrailingComments<'_, T> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.is_quiet() {
            return self.0.fmt(f);
        }
        let span = self.0.span();
        if f.comments().has_trailing_suppression_comment(span.end) {
            return write_ignored_node(self.0.as_node(), span, f);
        }
        // The comments after the node are hidden while it is written.
        let previous_limit = f.comments_mut().limit_comments_up_to(span.end);
        self.0.fmt(f);
        f.comments_mut().restore_view_limit(previous_limit);
    }
}
