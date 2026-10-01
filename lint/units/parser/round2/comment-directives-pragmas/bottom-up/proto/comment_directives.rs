//! `processCommentDirective` of typescript-go's scanner.go: the `@ts-ignore` and `@ts-expect-error` comments of a file.

/// `ast.CommentDirectiveKind`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentDirectiveKind {
    ExpectError,
    Ignore,
}

/// `ast.CommentDirective`: a `//` comment, or a block comment from where its last line starts.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub start: u32,
    pub end: u32,
    pub kind: CommentDirectiveKind,
}

const _: () = assert!(core::mem::size_of::<CommentDirective>() == 12);

/// `SourceFile.CommentDirectives`. `comments` has the start and the end of every comment between two tokens, in source order.
#[cold]
pub(crate) fn comment_directives(
    text: &[u8],
    comments: impl IntoIterator<Item = (u32, u32)>,
) -> Vec<CommentDirective> {
    let mut directives = Vec::new();
    for (start, end) in comments {
        let (start, end) = (start as usize, (end as usize).min(text.len()));
        let directive = match text.get(start..start + 2) {
            Some(b"//") => process_comment_directive(text, start, end, false),
            Some(b"/*") => {
                process_comment_directive(text, last_line_start(text, start, end), end, true)
            }
            _ => None,
        };
        directives.extend(directive);
    }
    directives
}

/// The `/*` arm of Scan: where the last line of the block comment `start..end` starts.
fn last_line_start(text: &[u8], start: usize, end: usize) -> usize {
    let mut last_line_start = start;
    let mut pos = start + 2;
    while pos < end {
        match text.get(pos) {
            Some(b'\n' | b'\r') => {
                pos += 1;
                last_line_start = pos;
            }
            Some(0xE2) if matches!(text.get(pos + 1..pos + 3), Some([0x80, 0xA8 | 0xA9])) => {
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
) -> Option<CommentDirective> {
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
        return None;
    }
    pos += 1;
    let rest = text.get(pos..).unwrap_or(&[]);
    let kind = if rest.starts_with(b"ts-expect-error") {
        CommentDirectiveKind::ExpectError
    } else if rest.starts_with(b"ts-ignore") {
        CommentDirectiveKind::Ignore
    } else {
        return None;
    };
    Some(CommentDirective {
        start: u32::try_from(start).ok()?,
        end: u32::try_from(end).ok()?,
        kind,
    })
}
