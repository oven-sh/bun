//! `@ts-ignore` and `@ts-expect-error` comments: processCommentDirective of typescript-go's internal/scanner/scanner.go, and its two calls in Scan.

use crate::Range;

/// `ast.CommentDirectiveKind`
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentDirectiveKind {
    ExpectError = 1,
    Ignore = 2,
}

/// `ast.CommentDirective`: a `//` comment from `start` to `end`, or the last line of a block comment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub start: u32,
    pub end: u32,
    pub kind: CommentDirectiveKind,
}

const _: () = assert!(core::mem::size_of::<CommentDirective>() == 12);

/// `SourceFile.CommentDirectives`: what Scan records for `comments`, every comment of `text` in the order of the source.
pub fn get_comment_directives(text: &[u8], comments: &[Range]) -> Vec<CommentDirective> {
    let mut comment_directives = Vec::new();
    for comment in comments {
        let Some((token_start, pos)) = bounds(text, *comment) else {
            continue;
        };
        match text.get(token_start..token_start + 2) {
            // Single-line comment
            Some(b"//") => {
                process_comment_directive(text, token_start, pos, false, &mut comment_directives);
            }
            // Multi-line comment
            Some(b"/*") => {
                let last_line_start = last_line_start(text, token_start, pos);
                process_comment_directive(
                    text,
                    last_line_start,
                    pos,
                    true,
                    &mut comment_directives,
                );
            }
            _ => {}
        }
    }
    comment_directives
}

/// Where `comment` starts and ends in `text`, the end not after the end of `text`. `None`: it starts before `text` or after it, or ends before it starts.
pub(crate) fn bounds(text: &[u8], comment: Range) -> Option<(usize, usize)> {
    let start = usize::try_from(comment.loc.start).ok()?;
    let len = usize::try_from(comment.len).ok()?;
    if start > text.len() {
        return None;
    }
    Some((start, start.saturating_add(len).min(text.len())))
}

/// The offset `pos` as a record holds it.
pub(crate) fn offset_of(pos: usize) -> u32 {
    u32::try_from(pos).unwrap_or(u32::MAX)
}

/// `lastLineStart` of Scan: the offset after the last line break inside the block comment from `token_start` to `end`, or `token_start`.
fn last_line_start(text: &[u8], token_start: usize, end: usize) -> usize {
    let mut last_line_start = token_start;
    let mut pos = token_start + 2;
    while pos < end {
        let size = line_break_len(text, pos);
        if size == 0 {
            pos += 1;
            continue;
        }
        pos += size;
        last_line_start = pos;
    }
    last_line_start.min(end)
}

/// The length of the line break of stringutil.IsLineBreak that starts at `pos`, 0 where none starts: U+2028 and U+2029 take three bytes.
pub(crate) fn line_break_len(text: &[u8], pos: usize) -> usize {
    match text.get(pos) {
        Some(b'\n' | b'\r') => 1,
        Some(0xE2)
            if text.get(pos + 1) == Some(&0x80)
                && matches!(text.get(pos + 2), Some(0xA8 | 0xA9)) =>
        {
            3
        }
        _ => 0,
    }
}

/// scanner.go processCommentDirective.
fn process_comment_directive(
    text: &[u8],
    start: usize,
    end: usize,
    multiline: bool,
    comment_directives: &mut Vec<CommentDirective>,
) {
    let is_blank = |pos: usize| matches!(text.get(pos), Some(b' ' | b'\t'));
    // Skip starting slashes and whitespace
    let mut pos = start;
    if multiline {
        // Skip whitespace
        while pos < end && is_blank(pos) {
            pos += 1;
        }
        // Skip combinations of / and *
        while pos < end && matches!(text.get(pos), Some(b'/' | b'*')) {
            pos += 1;
        }
    } else {
        // Skip opening //
        pos += 2;
        // Skip another / if present
        while pos < end && text.get(pos) == Some(&b'/') {
            pos += 1;
        }
    }
    // Skip whitespace
    while pos < end && is_blank(pos) {
        pos += 1;
    }
    // Directive must start with '@'
    if !(pos < end && text.get(pos) == Some(&b'@')) {
        return;
    }
    pos += 1;
    let rest = text.get(pos..).unwrap_or(b"");
    let kind = if rest.starts_with(b"ts-expect-error") {
        CommentDirectiveKind::ExpectError
    } else if rest.starts_with(b"ts-ignore") {
        CommentDirectiveKind::Ignore
    } else {
        return;
    };
    comment_directives.push(CommentDirective {
        start: offset_of(start),
        end: offset_of(end),
        kind,
    });
}

#[cfg(test)]
mod tests {
    use super::CommentDirectiveKind::{ExpectError, Ignore};
    use super::*;
    use crate::Loc;

    type Directive = (CommentDirectiveKind, u32, u32);

    /// The directives of `comments`, each a start and an end in `text`, as kind, start and end.
    fn directives(text: &[u8], comments: &[(i32, i32)]) -> Vec<Directive> {
        let comments: Vec<Range> = comments
            .iter()
            .map(|&(start, end)| Range {
                loc: Loc { start },
                len: end - start,
            })
            .collect();
        get_comment_directives(text, &comments)
            .iter()
            .map(|directive| (directive.kind, directive.start, directive.end))
            .collect()
    }

    #[test]
    fn a_line_comment_is_a_directive_from_its_start() {
        let cases: [(&[u8], &[(i32, i32)], &[Directive]); 8] = [
            (
                b"// @ts-ignore\nlet x: number = 'a';",
                &[(0, 13)],
                &[(Ignore, 0, 13)],
            ),
            (b"/// @ts-ignore\nx;", &[(0, 14)], &[(Ignore, 0, 14)]),
            (
                b"//@ts-expect-error: reason\nx;",
                &[(0, 26)],
                &[(ExpectError, 0, 26)],
            ),
            (
                b"//\t \t@ts-expect-error\nx;",
                &[(0, 21)],
                &[(ExpectError, 0, 21)],
            ),
            (
                b"x; // @ts-ignore\ny; /* @ts-expect-error */ z;\n",
                &[(3, 16), (20, 42)],
                &[(Ignore, 3, 16), (ExpectError, 20, 42)],
            ),
            (b"x;\n// @ts-ignore", &[(3, 16)], &[(Ignore, 3, 16)]),
            (
                b"// @ts-ignoreXYZ\n// @ts-expect-errors\nx;",
                &[(0, 16), (17, 37)],
                &[(Ignore, 0, 16), (ExpectError, 17, 37)],
            ),
            (
                b"// @ts-ignore\r\nx;\r\n/*\r\n @ts-expect-error */\r\ny;\r\n",
                &[(0, 13), (19, 43)],
                &[(Ignore, 0, 13), (ExpectError, 23, 43)],
            ),
        ];
        for (text, comments, expected) in cases {
            assert_eq!(directives(text, comments), expected, "{:?}", text);
        }
    }

    #[test]
    fn a_block_comment_is_a_directive_from_the_start_of_its_last_line() {
        let cases: [(&[u8], &[(i32, i32)], &[Directive]); 8] = [
            (
                b"/* @ts-expect-error */\nx;",
                &[(0, 22)],
                &[(ExpectError, 0, 22)],
            ),
            (b"/*\n * @ts-ignore */\nx;", &[(0, 19)], &[(Ignore, 3, 19)]),
            (b"/* @ts-ignore\n */\nx;", &[(0, 17)], &[]),
            (
                b"/**\n * text\n * @ts-expect-error */\nx;",
                &[(0, 34)],
                &[(ExpectError, 12, 34)],
            ),
            (
                b"/*\n   // @ts-expect-error */\nx;",
                &[(0, 28)],
                &[(ExpectError, 3, 28)],
            ),
            (
                b"/* a\xE2\x80\xA8 @ts-ignore */\nx;",
                &[(0, 21)],
                &[(Ignore, 7, 21)],
            ),
            (b"/*\r @ts-ignore */\rx;", &[(0, 17)], &[(Ignore, 3, 17)]),
            (b"/*\n\t*/ @ts-ignore\n", &[(0, 6)], &[]),
        ];
        for (text, comments, expected) in cases {
            assert_eq!(directives(text, comments), expected, "{:?}", text);
        }
    }

    #[test]
    fn a_comment_with_anything_else_before_the_at_is_no_directive() {
        let cases: [(&[u8], &[(i32, i32)]); 7] = [
            (b"// see @ts-ignore\nx;", &[(0, 17)]),
            (b"/* x @ts-ignore */\nx;", &[(0, 18)]),
            (b"// @TS-IGNORE\nx;", &[(0, 13)]),
            (b"// @ ts-ignore\nx;", &[(0, 14)]),
            (
                b"// @ts-nocheck\n// @ts-check\n// @ts-expect-erro\n",
                &[(0, 14), (15, 27), (28, 46)],
            ),
            (b"//@\nts-ignore", &[(0, 3)]),
            (b"let s = '// @ts-ignore';", &[]),
        ];
        for (text, comments) in cases {
            assert_eq!(directives(text, comments), &[], "{:?}", text);
        }
    }

    #[test]
    fn a_directive_is_read_as_typescript_go_reads_it_where_tsc_differs() {
        // tsc takes two or three slashes and any white space: typescript-go takes any count of slashes, and blanks and tabs.
        let cases: [(&[u8], &[(i32, i32)], &[Directive]); 3] = [
            (b"//// @ts-ignore\nx;", &[(0, 15)], &[(Ignore, 0, 15)]),
            (b"//\xC2\xA0@ts-ignore\nx;", &[(0, 14)], &[]),
            (b"//\x0B@ts-ignore\nx;", &[(0, 13)], &[]),
        ];
        for (text, comments, expected) in cases {
            assert_eq!(directives(text, comments), expected, "{:?}", text);
        }
    }

    #[test]
    fn a_range_that_is_no_comment_of_the_text_is_no_directive() {
        let text: &[u8] = b"// @ts-ignore";
        let cases: [&[(i32, i32)]; 9] = [
            &[(0, 1)],
            &[(0, 2)],
            &[(5, 3)],
            &[(-4, 9)],
            &[(0, -1)],
            &[(13, 13)],
            &[(40, 50)],
            &[(3, 13)],
            &[(0, i32::MAX)],
        ];
        for comments in cases {
            let expected: &[Directive] = if comments == [(0, i32::MAX)] {
                &[(Ignore, 0, 13)]
            } else {
                &[]
            };
            assert_eq!(directives(text, comments), expected, "{:?}", comments);
        }
        assert_eq!(directives(b"", &[(0, 0), (0, 9)]), &[]);
        assert_eq!(directives(b"/", &[(0, 1)]), &[]);
        assert_eq!(directives(b"/*", &[(0, 2)]), &[]);
        assert_eq!(directives(b"/*@ts-ignore", &[(0, 12)]), &[(Ignore, 0, 12)]);
        assert_eq!(directives(b"/*\xE2\x80", &[(0, 4)]), &[]);
    }
}
