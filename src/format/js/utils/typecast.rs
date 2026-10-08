//! `/** @type {T} */ (e)`: a type cast of the Closure Compiler and of TypeScript in JavaScript. It
//! only is one with the parentheses, so they stay.

use crate::prelude::*;
use crate::{format_args, write};

/// If the node at `span` is what a type cast comment is written before: the comments to print
/// before it, which are none if the cast comment is printed already.
pub(crate) fn is_type_cast_node<'a>(span: Span, f: &Formatter<'a>) -> Option<&'a [Comment]> {
    let comments = f.comments();
    if !comments.has_type_cast_comments() {
        return None;
    }
    let source = f.source_text();

    // There has to be a `)` after the node, possibly after comments.
    if !source.next_non_whitespace_byte_is(span.end, b')') {
        let mut start = span.end;
        for comment in comments.comments_after(span.end) {
            if !source.bytes_range(start, comment.span.start).trim_ascii_start().is_empty() {
                break;
            }
            start = comment.span.end;
        }
        if !source.next_non_whitespace_byte_is(start, b')') {
            return None;
        }
    }

    if !comments.is_handled_type_cast_comment()
        && let Some(last_printed_comment) = comments.printed_comments().last()
        && last_printed_comment.span.end <= span.start
        && source.next_non_whitespace_byte_is(last_printed_comment.span.end, b'(')
        && comments.is_type_cast_comment(last_printed_comment)
    {
        // `(/** @type {T} */ (a).b)`: the cast is of `a`, not of `a.b`.
        let node_source_text = source.bytes_range(last_printed_comment.span.end, span.end);
        match has_closed_parentheses(node_source_text) {
            true => None,
            false => Some(&[]),
        }
    } else if let Some(index) = comments.get_type_cast_comment_index(span) {
        let unprinted = comments.unprinted_comments();
        let node_source_text = source.bytes_range(unprinted.get(index)?.span.end, span.end);
        match has_closed_parentheses(node_source_text) {
            true => None,
            false => unprinted.get(..=index),
        }
    } else {
        None
    }
}

/// Writes `node` in parentheses if it is what a type cast comment is written before. Returns
/// whether it has.
pub(crate) fn format_type_cast_comment_node<'a>(
    node: &(impl Format<'a> + Spanned),
    is_object_or_array_expression: bool,
    f: &mut Formatter<'a>,
) -> bool {
    let span = node.span();
    let Some(type_cast_comments) = is_type_cast_node(span, f) else {
        return false;
    };
    if !type_cast_comments.is_empty() {
        write!(f, FormatLeadingComments::Comments(type_cast_comments));
    }
    f.comments_mut().mark_as_type_cast_node(&span);

    if is_object_or_array_expression && !f.comments().has_comment_before(span.start) {
        write!(f, group(&format_args!("(", node, ")")));
    } else {
        write!(f, group(&format_args!("(", soft_block_indent(node), ")")));
    }
    true
}

/// Whether the first `(` in `source` is closed in it.
fn has_closed_parentheses(source: &[u8]) -> bool {
    let mut paren_count = 0i32;
    let mut i = 0;
    while let Some(&byte) = source.get(i) {
        match byte {
            b'(' => paren_count += 1,
            b')' => {
                paren_count -= 1;
                if paren_count == 0 {
                    return true;
                }
            }
            b'/' if source.get(i + 1) == Some(&b'/') => {
                let rest = &source[i..];
                i += bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                continue;
            }
            b'/' if source.get(i + 1) == Some(&b'*') => {
                let rest = &source[i + 2..];
                i += 2 + bun_core::strings::index_of(rest, b"*/").map_or(rest.len(), |at| at + 2);
                continue;
            }
            quote @ (b'"' | b'\'' | b'`') => {
                i += 1;
                while let Some(&byte) = source.get(i) {
                    match byte {
                        _ if byte == quote => break,
                        b'\\' => i += 1,
                        _ => {}
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    paren_count == 0
}
