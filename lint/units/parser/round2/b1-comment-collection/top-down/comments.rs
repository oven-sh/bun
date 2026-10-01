//! The comments of a lint-parsed file: `Lexer::all_comments` with the kind of each, for the passes after the parse.

use bun_ast::Range;

/// What the scanner of the reference makes of a comment.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentKind {
    /// `//` up to the line break.
    Line,
    /// `/*` up to `*/`.
    Block,
    /// A block comment that starts with `/**` and is not `/**/`.
    JSDoc,
}

/// A comment: `start` is the offset of its first `/`, `end` the offset after its last character.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Comment {
    pub start: u32,
    pub end: u32,
    pub kind: CommentKind,
}

const _: () = assert!(core::mem::size_of::<Comment>() == 12);

/// Every comment of a file in source order, each once. The `#!` line is none.
#[derive(Default)]
pub struct Comments {
    pub list: Vec<Comment>,
    /// How many of them stand before the first token of the file.
    leading: u32,
}

impl Comments {
    /// The table for `ranges`, the comments that the lexer read in `source`: `first_token` is the offset of the first token after the `#!` line.
    #[cold]
    #[inline(never)]
    pub(crate) fn of(source: &[u8], ranges: &[Range], first_token: usize) -> Comments {
        let mut list = Vec::with_capacity(ranges.len());
        let mut leading = 0u32;
        for range in ranges {
            let (start, end) = (range.loc.i(), range.end_i());
            let (Ok(start32), Ok(end32)) = (u32::try_from(start), u32::try_from(end)) else {
                continue;
            };
            if end <= first_token {
                leading += 1;
            }
            list.push(Comment {
                start: start32,
                end: end32,
                kind: kind_at(source, start),
            });
        }
        Comments { list, leading }
    }

    /// The comments before the first token of the file: what the reference reads pragmas from.
    pub fn leading(&self) -> &[Comment] {
        self.list.get(..self.leading as usize).unwrap_or(&[])
    }
}

/// The kind of the comment that starts at `start`: the scanner of the reference tells JSDoc by the two characters after `/*`.
fn kind_at(source: &[u8], start: usize) -> CommentKind {
    if source.get(start + 1) == Some(&b'/') {
        return CommentKind::Line;
    }
    if source.get(start + 2) == Some(&b'*') && source.get(start + 3) != Some(&b'/') {
        return CommentKind::JSDoc;
    }
    CommentKind::Block
}
