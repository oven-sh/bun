use super::chain_member::{CallExpressionPosition, ChainMember};
use crate::js::print::program::is_next_line_empty;
use crate::prelude::*;
use crate::write;

/// Prettier's `shouldInsertEmptyLineAfter`: true if the line after `e`, or after the `)` following it, is empty.
pub(super) fn should_insert_empty_line_after<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let (source_text, end) = (f.source_text(), e.span().end);
    let next = bun_lint::tokens::skip_trivia(source_text.as_bytes(), end);
    match source_text.byte_at(next) {
        Some(b')') => is_next_line_empty(source_text, next + 1),
        _ => is_next_line_empty(source_text, end),
    }
}

/// A group's links.
pub(super) struct FormatMemberChainGroup<'a, 'b>(pub(super) &'b [ChainMember<'a>]);

impl<'a> Format<'a> for FormatMemberChainGroup<'a, '_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut members = self.0.iter().peekable();
        while let Some(member) = members.next() {
            write!(f, member);
            // Prettier prints a line break after a call that's followed by an empty line, which makes an empty line at
            // the end of a group. It does that in the middle of a group too. oxfmt doesn't.
            if let ChainMember::CallExpression {
                expression,
                position: CallExpressionPosition::Middle,
            } = *member
                && members.peek().is_some()
                && !f.options().flavor.is_oxfmt()
                && should_insert_empty_line_after(expression, f)
            {
                write!(f, hard_line_break());
            }
        }
    }
}
