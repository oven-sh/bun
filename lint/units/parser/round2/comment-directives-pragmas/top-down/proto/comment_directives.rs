//! `@ts-ignore` and `@ts-expect-error` comments: processCommentDirective of typescript-go's internal/scanner/scanner.go.

/// A comment of the file. Stand-in for the record of the comment list of the side table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Comment {
    pub start: u32,
    pub end: u32,
    pub kind: CommentKind,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentKind {
    Line,
    Block,
    JsDoc,
}

/// ast.CommentDirectiveKind, with its numbers.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommentDirectiveKind {
    ExpectError = 1,
    Ignore = 2,
}

/// ast.CommentDirective: `start..end` is the comment, and for a block comment its last line.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommentDirective {
    pub start: u32,
    pub end: u32,
    pub kind: CommentDirectiveKind,
}

const _: () = assert!(core::mem::size_of::<CommentDirective>() == 12);

/// `SourceFile.CommentDirectives`: the scanner calls processCommentDirective for every comment that it skips.
pub fn get_comment_directives(text: &[u8], comments: &[Comment]) -> Vec<CommentDirective> {
    let mut directives = Vec::new();
    for comment in comments {
        let start = comment.start as usize;
        let end = (comment.end as usize).min(text.len());
        let directive = match comment.kind {
            CommentKind::Line => process_comment_directive(text, start, end, false),
            CommentKind::Block | CommentKind::JsDoc => {
                process_comment_directive(text, last_line_start(text, start, end), end, true)
            }
        };
        directives.extend(directive);
    }
    directives
}

/// `lastLineStart` of Scan: the offset after the last line break inside the block comment at `start..end`, or `start`.
fn last_line_start(text: &[u8], start: usize, end: usize) -> usize {
    let mut last = start;
    let mut pos = start + 2;
    while pos < end {
        let len = line_break_len(text, pos);
        if len == 0 {
            pos += 1;
            continue;
        }
        pos += len;
        last = pos;
    }
    last.min(end)
}

/// The length of the line break of stringutil.IsLineBreak that starts at `pos`: 0 where none starts.
pub(crate) fn line_break_len(text: &[u8], pos: usize) -> usize {
    match text.get(pos) {
        Some(b'\n' | b'\r') => 1,
        // U+2028 and U+2029
        Some(0xE2) if text.get(pos + 1) == Some(&0x80) && matches!(text.get(pos + 2), Some(0xA8 | 0xA9)) => 3,
        _ => 0,
    }
}

/// scanner.go processCommentDirective.
fn process_comment_directive(text: &[u8], start: usize, end: usize, multiline: bool) -> Option<CommentDirective> {
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
        return None;
    }
    pos += 1;
    let rest = text.get(pos..)?;
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
