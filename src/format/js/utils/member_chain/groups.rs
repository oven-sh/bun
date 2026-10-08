use super::chain_member::{CallExpressionPosition, ChainMember};
use crate::js::utils::call_expression::is_next_line_empty;
use crate::prelude::*;
use crate::write;

/// Prettier's `shouldInsertEmptyLineAfter`: whether the line after `e`, or after the `)` behind it,
/// is empty.
pub(super) fn should_insert_empty_line_after<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let (source_text, end) = (f.source_text(), e.span().end);
    let next = bun_lint::tokens::skip_trivia(source_text.as_bytes(), end);
    match source_text.byte_at(next) {
        Some(b')') => is_next_line_empty(source_text, next + 1),
        _ => is_next_line_empty(source_text, end),
    }
}

/// The links of a group.
pub(super) struct FormatMemberChainGroup<'a, 'b>(pub(super) &'b [ChainMember<'a>]);

impl<'a> Format<'a> for FormatMemberChainGroup<'a, '_> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut members = self.0.iter().peekable();
        while let Some(member) = members.next() {
            write!(f, member);
            // Prettier writes a line break after a call that an empty line follows, which makes an
            // empty line at the end of a group. It is there in the middle of a group as well.
            if let ChainMember::CallExpression {
                expression,
                position: CallExpressionPosition::Middle,
            } = *member
                && members.peek().is_some()
                && should_insert_empty_line_after(expression, f)
            {
                write!(f, hard_line_break());
            }
        }
    }
}
