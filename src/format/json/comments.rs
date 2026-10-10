//! Which node a comment belongs to. Prettier's `main/comments/attach.js`, with the two of the
//! handlers of `language-js/comments/handle-comments.js` that have a say in JSON.

use super::parser::{Comment, Owner, Tree};
use crate::text::{has_newline, has_newline_backwards};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Placement {
    Leading,
    Trailing,
    Dangling,
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Attached {
    pub(super) owner: Owner,
    /// The index of the comment.
    pub(super) comment: u32,
    pub(super) placement: Placement,
}

/// `/^[\s(]*$/`
fn is_gap(text: &[u8]) -> bool {
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        let (c, len) = if byte < 0x80 {
            (u32::from(byte), 1)
        } else {
            bun_core::strings::wtf8_codepoint_at(text, at)
        };
        if c != u32::from(b'(') && !bun_core::strings::is_js_whitespace(c) {
            return false;
        }
        at += len;
    }
    true
}

/// `!/[\S\n  ]/`: white space without a line break.
fn is_blank_without_line_break(text: &[u8]) -> bool {
    is_gap(text)
        && !bun_core::strings::contains_char(text, b'(')
        && !bun_core::strings::contains_char(text, b'\n')
        && !bun_core::strings::contains(text, &[0xE2, 0x80, 0xA8])
        && !bun_core::strings::contains(text, &[0xE2, 0x80, 0xA9])
}

/// A JSDoc comment with `@type` or `@satisfies`: Prettier's `isTypeCastComment`.
fn is_type_cast_comment(source: &[u8]) -> bool {
    let is_word_end = |rest: &[u8]| {
        !rest
            .first()
            .is_some_and(|b| b.is_ascii_alphanumeric() || *b == b'_')
    };
    let has_tag = |tag: &[u8]| {
        let mut rest = source;
        while let Some(at) = bun_core::strings::index_of(rest, tag) {
            rest = &rest[at + tag.len()..];
            if is_word_end(rest) {
                return true;
            }
        }
        false
    };
    source.starts_with(b"/**") && (has_tag(b"@type") || has_tag(b"@satisfies"))
}

/// Comments with text before and after them on their line, between the same two nodes.
struct Ties {
    /// The index of the first.
    first: usize,
    count: usize,
}

/// Fills `attached`, which ends up sorted by owner, and for one owner by position.
pub(super) fn attach(text: &[u8], tree: &Tree, attached: &mut Vec<Attached>) {
    attached.clear();
    let comments = &tree.comments[..];
    let slice = |start: u32, end: u32| text.get(start as usize..end as usize).unwrap_or_default();
    let start_of = |owner: Owner| tree.nodes.get(owner.index()).map_or(0, |node| node.start);
    let mut ties = Ties { first: 0, count: 0 };

    // Prettier's `breakTies`: those that only have white space between them and the node after
    // them lead it, the others trail the node before them.
    let break_ties = |ties: &mut Ties, attached: &mut Vec<Attached>| {
        let tied = comments
            .get(ties.first..ties.first + ties.count)
            .unwrap_or_default();
        ties.count = 0;
        let Some(first) = tied.first() else {
            return;
        };
        let mut gap_end = start_of(first.following);
        let mut leading_from = tied.len();
        while let Some(comment) = leading_from.checked_sub(1).and_then(|at| tied.get(at))
            && is_gap(slice(comment.end, gap_end))
        {
            gap_end = comment.start;
            leading_from -= 1;
        }
        for (index, comment) in tied.iter().enumerate() {
            let (owner, placement) = match index < leading_from {
                true => (comment.preceding, Placement::Trailing),
                false => (comment.following, Placement::Leading),
            };
            attached.push(Attached {
                owner,
                comment: (ties.first + index) as u32,
                placement,
            });
        }
    };

    // Of the comments next to each other on a line that the comment at hand is one of: where the first starts, and
    // the index of the last and where it ends.
    let mut start = 0;
    let mut last = None;
    for (index, comment) in comments.iter().enumerate() {
        let Comment {
            enclosing,
            preceding,
            following,
            ..
        } = *comment;

        let follows_another = preceding != Owner::NONE
            && index
                .checked_sub(1)
                .and_then(|previous| comments.get(previous))
                .is_some_and(|other| {
                    other.preceding == preceding
                        && is_blank_without_line_break(slice(other.end, comment.start))
                });
        if !follows_another {
            start = comment.start;
        }
        let end = match last {
            Some((last, end)) if index <= last => end,
            _ => {
                let (mut last_index, mut end) = (index, comment.end);
                if following != Owner::NONE {
                    for other in &comments[index + 1..] {
                        if other.following != following
                            || !is_blank_without_line_break(slice(end, other.start))
                        {
                            break;
                        }
                        (last_index, end) = (last_index + 1, other.end);
                    }
                }
                last = Some((last_index, end));
                end
            }
        };

        let (first_choice, second_choice) = if has_newline_backwards(text, start as usize) {
            // On a line of its own
            (
                (following, Placement::Leading),
                (preceding, Placement::Trailing),
            )
        } else if has_newline(text, end as usize) {
            // At the end of a line
            if following != Owner::NONE
                && comment.is_block
                && is_type_cast_comment(slice(comment.start, comment.end))
            {
                (
                    (following, Placement::Leading),
                    (following, Placement::Leading),
                )
            } else if enclosing.is_property() {
                // Prettier's `handlePropertyComments`
                (
                    (enclosing, Placement::Leading),
                    (enclosing, Placement::Leading),
                )
            } else {
                (
                    (preceding, Placement::Trailing),
                    (following, Placement::Leading),
                )
            }
        } else if preceding != Owner::NONE && following != Owner::NONE {
            if ties.count > 0
                && comments
                    .get(ties.first)
                    .is_some_and(|tie| tie.following != following)
            {
                break_ties(&mut ties, attached);
            }
            if ties.count == 0 {
                ties.first = index;
            }
            // Between two comments that are tied there can be one that is not.
            if ties.first + ties.count != index {
                break_ties(&mut ties, attached);
                ties.first = index;
            }
            ties.count += 1;
            continue;
        } else {
            (
                (preceding, Placement::Trailing),
                (following, Placement::Leading),
            )
        };
        let (owner, placement) = match (first_choice, second_choice) {
            ((owner, placement), _) | (_, (owner, placement)) if owner != Owner::NONE => {
                (owner, placement)
            }
            _ => (enclosing, Placement::Dangling),
        };
        attached.push(Attached {
            owner,
            comment: index as u32,
            placement,
        });
    }
    break_ties(&mut ties, attached);
    crate::sort::sort_by_key(&mut attached[..], |it| (it.owner, it.comment));
}

/// The comments of `owner`.
pub(super) fn comments_of(attached: &[Attached], owner: Owner) -> &[Attached] {
    let start = attached.partition_point(|it| it.owner < owner);
    let len = attached[start..].partition_point(|it| it.owner == owner);
    &attached[start..start + len]
}
