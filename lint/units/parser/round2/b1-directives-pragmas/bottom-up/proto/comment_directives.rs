//! `processCommentDirective` of typescript-go's internal/scanner/scanner.go and the two arms of `Scan` that call it: the `@ts-ignore` and `@ts-expect-error` comments of a file.

/// `ast.CommentDirectiveKind`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentDirectiveKind {
    ExpectError,
    Ignore,
}

/// `ast.CommentDirective`: `start..end` is a `//` comment, or a block comment from where its last line starts.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub start: u32,
    pub end: u32,
    pub kind: CommentDirectiveKind,
}

const _: () = assert!(core::mem::size_of::<CommentDirective>() == 12);

/// `Scanner.CommentDirectives` after the file is read. `comments` has the start and the end of every comment between two tokens once, in the order of the source.
#[cold]
pub(crate) fn scan_comment_directives(
    text: &[u8],
    comments: impl IntoIterator<Item = (u32, u32)>,
) -> Vec<CommentDirective> {
    let mut comment_directives = Vec::new();
    for (token_start, pos) in comments {
        let (token_start, pos) = (token_start as usize, (pos as usize).min(text.len()));
        if token_start >= pos {
            continue;
        }
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

/// The multi-line arm of `Scan`: where the last line of the block comment `token_start..end` starts, which is `token_start` when it has one line.
fn last_line_start(text: &[u8], token_start: usize, end: usize) -> usize {
    let mut last_line_start = token_start;
    let mut pos = token_start + 2;
    while pos < end {
        match text.get(pos..end) {
            Some([b'\n' | b'\r', ..]) => {
                pos += 1;
                last_line_start = pos;
            }
            // U+2028 and U+2029
            Some([0xE2, 0x80, 0xA8 | 0xA9, ..]) => {
                pos += 3;
                last_line_start = pos;
            }
            _ => pos += 1,
        }
    }
    last_line_start
}

/// processCommentDirective
fn process_comment_directive(
    text: &[u8],
    start: usize,
    end: usize,
    multiline: bool,
    comment_directives: &mut Vec<CommentDirective>,
) {
    let at = |pos: usize| text.get(pos).copied();
    // Skip starting slashes and whitespace
    let mut pos = start;
    if multiline {
        // Skip whitespace
        while pos < end && matches!(at(pos), Some(b' ' | b'\t')) {
            pos += 1;
        }
        // Skip combinations of / and *
        while pos < end && matches!(at(pos), Some(b'/' | b'*')) {
            pos += 1;
        }
    } else {
        // Skip opening //
        pos += 2;
        // Skip another / if present
        while pos < end && at(pos) == Some(b'/') {
            pos += 1;
        }
    }
    // Skip whitespace
    while pos < end && matches!(at(pos), Some(b' ' | b'\t')) {
        pos += 1;
    }
    // Directive must start with '@'
    if !(pos < end && at(pos) == Some(b'@')) {
        return;
    }
    pos += 1;
    let rest = text.get(pos..).unwrap_or(&[]);
    let kind = if rest.starts_with(b"ts-expect-error") {
        CommentDirectiveKind::ExpectError
    } else if rest.starts_with(b"ts-ignore") {
        CommentDirectiveKind::Ignore
    } else {
        return;
    };
    let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end)) else {
        return;
    };
    comment_directives.push(CommentDirective { start, end, kind });
}
