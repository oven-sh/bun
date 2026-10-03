//! Where nodes end. The tree only says where they start, so the end of a node is worked out from its parts and the source text, and
//! only for a node an error is reported on.
//!
//! The end of a node is the end of its last part, or of the token that closes it, which is looked for from the end of the last part
//! on. Only what the tree keeps nothing of is skipped token by token.

use super::Checker;
use crate::atom::{Atom, known};
use crate::bind::{ClassOwner, FnOwner, MemberOwner};
use crate::hir::{
    CaseId, ClassId, EnumMemberId, ExportSpecId, ExprId, ExprKind, File, FileKind, FnBody, FnId,
    FnKind, IdList, ImportSpecId, MemberId, MemberKind, ModifierKind, Node, NodeData, ParamId,
    Part, PatElemId, PatId, PatPropId, PropId, PropKey, Span, Stmt, StmtId, StmtKind, TupleElemId,
    TypeNodeId, TypeParamId, VarDeclId, is_parenthesized,
};
use crate::program::FileId;
use bun_core::lexer;
use bun_core::strings::{lexer_step, wtf8_byte_sequence_length};

// ───────────────────────────── the text ─────────────────────────────

/// `IsWhiteSpaceLike`, of a character that is not ASCII: how many bytes it takes, 0 if there is none at `at`.
fn white_space_len(text: &[u8], at: usize) -> usize {
    let byte = |i: usize| text.get(at + i).copied().unwrap_or(0);
    match (byte(0), byte(1), byte(2)) {
        (0xC2, 0x85 | 0xA0, _) => 2,
        (0xE1, 0x9A, 0x80)
        | (0xE2, 0x80, 0x80..=0x8B | 0xA8 | 0xA9 | 0xAF)
        | (0xE2, 0x81, 0x9F)
        | (0xE3, 0x80, 0x80)
        | (0xEF, 0xBB, 0xBF) => 3,
        _ => 0,
    }
}

/// `IsLineBreak`: how many bytes the line break at `at` takes, 0 if there is none. `\r\n` is two of them.
pub(super) fn line_break_len(text: &[u8], at: usize) -> usize {
    match text.get(at) {
        Some(b'\n' | b'\r') => 1,
        Some(0xE2)
            if text.get(at + 1) == Some(&0x80) && matches!(text.get(at + 2), Some(0xA8 | 0xA9)) =>
        {
            3
        }
        _ => 0,
    }
}

/// `ComputeECMALineStarts`: where each line of `text` starts.
pub fn compute_ecma_line_starts(text: &[u8]) -> Vec<u32> {
    let mut starts = vec![0u32];
    let mut i = 0;
    // 0xE2 starts U+2028 and U+2029, which end a line too.
    while let Some(found) = bun_core::strings::index_of_any(&text[i..], b"\n\r\xE2") {
        i += found;
        match text[i] {
            b'\r' if text.get(i + 1) == Some(&b'\n') => i += 1,
            0xE2 => {
                if text.get(i + 1) != Some(&0x80) || !matches!(text.get(i + 2), Some(0xA8 | 0xA9)) {
                    i += 1;
                    continue;
                }
                i += 2;
            }
            _ => {}
        }
        i += 1;
        starts.push(i as u32);
    }
    starts
}

/// Where the line `at` is on ends, before its line break.
fn line_end(text: &[u8], mut at: usize) -> usize {
    while at < text.len() && line_break_len(text, at) == 0 {
        at += 1;
    }
    at.min(text.len())
}

/// `SkipTrivia`: from `at`, past blanks and comments.
pub(crate) fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C) => at += 1,
            Some(b'/') => match text.get(at + 1) {
                Some(b'/') => at = line_end(text, at + 2),
                Some(b'*') => {
                    at = bun_core::strings::index_of(&text[at + 2..], b"*/")
                        .map_or(text.len(), |end| at + end + 4);
                }
                _ => return at,
            },
            Some(&b) if b >= 0x80 => match white_space_len(text, at) {
                0 => return at,
                len => at += len,
            },
            Some(_) => return at,
            None => return at.min(text.len()),
        }
    }
}

/// `GetLeadingCommentRanges`
pub(super) fn get_leading_comment_ranges(text: &[u8], pos: usize) -> Vec<(usize, usize)> {
    iterate_comment_ranges(text, pos, false)
}

/// `GetTrailingCommentRanges`
pub(super) fn get_trailing_comment_ranges(text: &[u8], pos: usize) -> Vec<(usize, usize)> {
    iterate_comment_ranges(text, pos, true)
}

/// `iterateCommentRanges`: the comments that follow `pos`, from where to where. A `//` comment goes up to its line break. Those on
/// the line of `pos` trail what is before it: they are left out unless `trailing`, which stops at the end of that line.
fn iterate_comment_ranges(text: &[u8], mut pos: usize, trailing: bool) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut collecting = trailing;
    if pos == 0 {
        collecting = true;
        // `isShebangTrivia`, `scanShebangTrivia`
        if text.starts_with(b"#!") {
            pos = line_end(text, 2);
        }
    }
    while let Some(&ch) = text.get(pos) {
        match ch {
            b'\r' | b'\n' => {
                pos += if ch == b'\r' && text.get(pos + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
                if trailing {
                    break;
                }
                collecting = true;
            }
            b'\t' | 0x0B | 0x0C | b' ' => pos += 1,
            b'/' if matches!(text.get(pos + 1), Some(b'/' | b'*')) => {
                let start = pos;
                pos = if text[pos + 1] == b'/' {
                    line_end(text, pos + 2)
                } else {
                    bun_core::strings::index_of(&text[pos + 2..], b"*/")
                        .map_or(text.len(), |end| pos + end + 4)
                };
                if collecting {
                    ranges.push((start, pos));
                }
            }
            _ => match white_space_len(text, pos) {
                0 => break,
                len => pos += len,
            },
        }
    }
    ranges
}

/// Where the `//` comment that ends `line` starts.
fn line_comment_start(line: &[u8]) -> Option<usize> {
    let mut at = 0;
    while let Some(&c) = line.get(at) {
        match c {
            b'"' | b'\'' | b'`' => {
                at += 1;
                while let Some(&s) = line.get(at) {
                    at += 1;
                    if s == b'\\' {
                        at += 1;
                    } else if s == c {
                        break;
                    }
                }
            }
            b'/' if line.get(at + 1) == Some(&b'/') => return Some(at),
            b'/' if line.get(at + 1) == Some(&b'*') => {
                at = bun_core::strings::index_of(&line[at + 2..], b"*/").map(|end| at + end + 4)?;
            }
            _ => at += 1,
        }
    }
    None
}

/// Where the token before `pos` ends: back over blanks and comments. A missing node is there (`createMissingNode`).
pub(crate) fn skip_trivia_back(text: &[u8], pos: usize) -> usize {
    let mut at = pos.min(text.len());
    loop {
        let before = at;
        while at > 0 {
            let b = text[at - 1];
            if matches!(b, b'\n' | b'\r') {
                at -= 1;
                let line = text[..at]
                    .iter()
                    .rposition(|&c| matches!(c, b'\n' | b'\r'))
                    .map_or(0, |i| i + 1);
                if let Some(comment) = line_comment_start(&text[line..at]) {
                    at = line + comment;
                }
            } else if matches!(b, b' ' | b'\t' | 0x0B | 0x0C) {
                at -= 1;
            } else if at >= 2 && white_space_len(text, at - 2) == 2 {
                at -= 2;
            } else if at >= 3 && white_space_len(text, at - 3) == 3 {
                at -= 3;
            } else {
                break;
            }
        }
        if text[..at].ends_with(b"*/")
            && let Some(open) = bun_core::strings::last_index_of(&text[..at - 2], b"/*")
        {
            at = open;
        }
        if at == before {
            return at;
        }
    }
}

/// `text` up to where its last token ends.
pub(super) fn trim_trivia_end(text: &[u8]) -> &[u8] {
    &text[..skip_trivia_back(text, text.len())]
}

/// `peekUnicodeEscape`: how long `\\uXXXX` or `\\u{X}` at `at` is, and what it stands for.
fn unicode_escape(text: &[u8], at: usize) -> Option<(usize, u32)> {
    if text.get(at) != Some(&b'\\') || text.get(at + 1) != Some(&b'u') {
        return None;
    }
    let is_braced = text.get(at + 2) == Some(&b'{');
    let start = at + 2 + usize::from(is_braced);
    let (len, ch) = text[start.min(text.len())..]
        .iter()
        .take_while(|b| b.is_ascii_hexdigit())
        .take(if is_braced { 8 } else { 4 })
        .fold((0usize, 0u32), |(len, ch), &b| {
            (len + 1, ch << 4 | (b as char).to_digit(16).unwrap_or(0))
        });
    let is_whole = match is_braced {
        true => len > 0 && text.get(start + len) == Some(&b'}'),
        false => len == 4,
    };
    is_whole.then_some((start + len + usize::from(is_braced) - at, ch))
}

/// Where the token `written` starts that comes right before `at`, trivia aside. `None`: something else is written there.
pub(crate) fn start_of_token_before(text: &[u8], at: u32, written: &[u8]) -> Option<u32> {
    let before = trim_trivia_end(&text[..(at as usize).min(text.len())]);
    before
        .ends_with(written)
        .then(|| (before.len() - written.len()) as u32)
}

/// The name or keyword that starts at `at`, which may be none.
pub(super) fn word_at(text: &[u8], at: usize) -> &[u8] {
    text.get(at..ident_end(text, at)).unwrap_or_default()
}

/// Whether `word` is written at `at`, and ends there.
pub(super) fn is_word_at(text: &[u8], at: usize, word: &[u8]) -> bool {
    word_at(text, at) == word
}

/// Where the word that ends at `end` starts. What is not ASCII is part of it if `ident_end` says so.
pub(super) fn word_start(text: &[u8], end: usize) -> usize {
    let end = end.min(text.len());
    let mut start = end;
    while start > 0 && is_identifier_part(text[start - 1]) {
        start -= 1;
    }
    while ident_end(text, start) < end {
        let blank = ident_end(text, start);
        start = (blank + wtf8_byte_sequence_length(text[blank]) as usize).min(end);
    }
    start
}

/// The word that ends at `end`, which may be none.
pub(super) fn word_before(text: &[u8], end: usize) -> &[u8] {
    &text[word_start(text, end)..end.min(text.len())]
}

/// `scanIdentifierParts`
pub(super) fn ident_end(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(&b) if b.is_ascii_alphanumeric() || b == b'_' || b == b'$' => at += 1,
            Some(b'\\') => match unicode_escape(text, at) {
                Some((len, ch)) if lexer::is_identifier_part(ch) => at += len,
                _ => return at,
            },
            Some(&b) if b >= 0x80 => {
                let mut next = at;
                let ch = lexer_step::next_codepoint_multibyte(text, &mut next, b);
                if !lexer::is_identifier_part(ch as u32) {
                    return at;
                }
                at = next;
            }
            Some(_) => return at,
            None => return at.min(text.len()),
        }
    }
}

/// `scanIdentifier`: the same from where a name starts, which what is no `IsIdentifierStart` does not.
pub(super) fn identifier_end(text: &[u8], at: usize) -> usize {
    let first = match (text.get(at), unicode_escape(text, at)) {
        (_, Some((_, ch))) => ch,
        (Some(&b), None) if b >= 0x80 => {
            let mut next = at;
            lexer_step::next_codepoint_multibyte(text, &mut next, b) as u32
        }
        _ => return ident_end(text, at),
    };
    if lexer::is_identifier_start(first) {
        ident_end(text, at)
    } else {
        at
    }
}

/// The same for a name that may be private.
pub(super) fn word_end(text: &[u8], at: usize) -> usize {
    if text.get(at) == Some(&b'#') {
        ident_end(text, at + 1)
    } else {
        ident_end(text, at)
    }
}

/// `scanString`, at the quote.
fn string_end(text: &[u8], at: usize) -> usize {
    let quote = text.get(at).copied();
    let mut end = at + 1;
    loop {
        match text.get(end).copied() {
            None => return text.len(),
            c if c == quote => return end + 1,
            Some(b'\\') => {
                end += if text.get(end + 1) == Some(&b'\r') && text.get(end + 2) == Some(&b'\n') {
                    3
                } else {
                    2
                };
            }
            // Not terminated.
            Some(b'\n' | b'\r') => return end,
            Some(_) => end += 1,
        }
    }
}

/// `scanString(jsxAttributeString)`: nothing is escaped, and it goes on over line breaks.
fn jsx_string_end(text: &[u8], at: usize) -> usize {
    let quote = text.get(at).copied();
    let rest = text.get(at + 1..).unwrap_or_default();
    rest.iter()
        .position(|&c| Some(c) == quote)
        .map_or(text.len(), |end| at + end + 2)
}

/// `scanTemplateAndSetTokenValue`, from inside the text of a template: where the text ends, past the `` ` `` or the `${`, and whether
/// it is the latter.
fn template_text(text: &[u8], mut at: usize) -> (usize, bool) {
    loop {
        match text.get(at) {
            None => return (text.len(), false),
            Some(b'`') => return (at + 1, false),
            Some(b'$') if text.get(at + 1) == Some(&b'{') => return (at + 2, true),
            Some(b'\\') => at += 2,
            Some(_) => at += 1,
        }
    }
}

/// `scanNumber`, and what `Scan` does for `0x`, `0b` and `0o`.
fn number_end(text: &[u8], start: usize) -> usize {
    let byte = |i: usize| text.get(i).copied().unwrap_or(0);
    let mut at = start;
    if byte(at) == b'0' && matches!(byte(at + 1) | 0x20, b'x' | b'b' | b'o') {
        let radix = byte(at + 1) | 0x20;
        let is_digit = |b: u8| match radix {
            b'x' => b.is_ascii_hexdigit(),
            b'b' => matches!(b, b'0' | b'1'),
            _ => matches!(b, b'0'..=b'7'),
        };
        at += 2;
        while is_digit(byte(at)) || byte(at) == b'_' {
            at += 1;
        }
        return if byte(at) == b'n' { at + 1 } else { at };
    }
    // `scanNumberFragment`
    let fragment = |mut i: usize| {
        while byte(i).is_ascii_digit() || byte(i) == b'_' {
            i += 1;
        }
        i
    };
    let mut has_leading_zero = false;
    if byte(at) == b'0' {
        at += 1;
        if byte(at) == b'_' {
            at = fragment(start);
        } else {
            let digits = at;
            let mut is_octal = true;
            while byte(at).is_ascii_digit() {
                is_octal &= byte(at) <= b'7';
                at += 1;
            }
            if at > digits {
                if is_octal {
                    return at;
                }
                has_leading_zero = true;
            }
        }
    } else {
        at = fragment(at);
    }
    let fixed_part_end = at;
    if byte(at) == b'.' {
        at = fragment(at + 1);
    }
    if matches!(byte(at), b'e' | b'E') {
        at += 1;
        if matches!(byte(at), b'+' | b'-') {
            at += 1;
        }
        at = fragment(at);
    }
    if has_leading_zero {
        return at;
    }
    // After a fraction or an exponent the `n` is an error, and taken all the same.
    if byte(at) == b'n' && (fixed_part_end == at || ident_end(text, at) == at + 1) {
        at += 1;
    }
    at
}

/// `ReScanSlashToken`, at the `/`.
fn regex_end(text: &[u8], start: usize) -> usize {
    let body = start + 1;
    let (mut at, mut in_escape, mut in_class) = (body, false, false);
    loop {
        match text.get(at) {
            None | Some(b'\n' | b'\r') => break,
            Some(_) if in_escape => in_escape = false,
            Some(b'/') if !in_class => return ident_end(text, at + 1),
            Some(b'[') => in_class = true,
            Some(b'\\') => in_escape = true,
            Some(b']') => in_class = false,
            Some(_) => {}
        }
        at += 1;
    }
    // Not terminated: it ends at the nearest bracket that closes nothing.
    let body_end = at.min(text.len());
    let (mut class_depth, mut group_depth, mut in_quantifier) = (0u32, 0u32, false);
    (at, in_escape) = (body, false);
    while at < body_end {
        let c = text[at];
        if in_escape {
            in_escape = false;
        } else if c == b'\\' {
            in_escape = true;
        } else if c == b'[' {
            class_depth += 1;
        } else if c == b']' && class_depth != 0 {
            class_depth -= 1;
        } else if class_depth == 0 {
            if c == b'{' {
                in_quantifier = true;
            } else if c == b'}' && in_quantifier {
                in_quantifier = false;
            } else if !in_quantifier {
                if c == b'(' {
                    group_depth += 1;
                } else if c == b')' && group_depth != 0 {
                    group_depth -= 1;
                } else if matches!(c, b')' | b']' | b'}') {
                    break;
                }
            }
        }
        at += 1;
    }
    while at > body {
        if matches!(text[at - 1], b' ' | b'\t' | 0x0B | 0x0C | b';') {
            at -= 1;
        } else if at >= body + 2 && white_space_len(text, at - 2) == 2 {
            at -= 2;
        } else if at >= body + 3 && white_space_len(text, at - 3) == 3 {
            at -= 3;
        } else {
            break;
        }
    }
    at
}

/// `ScanJsxIdentifier`
pub(crate) fn jsx_identifier_end(text: &[u8], mut at: usize) -> usize {
    loop {
        let end = ident_end(text, at);
        if text.get(end) != Some(&b'-') {
            return end;
        }
        at = end + 1;
    }
}

/// The same, and the `:name` of `parseJsxAttributeName` and `parseJsxTagName`.
fn jsx_name_end(text: &[u8], at: usize) -> usize {
    let end = jsx_identifier_end(text, at);
    let colon = skip_trivia(text, end);
    if text.get(colon) == Some(&b':') {
        let name = skip_trivia(text, colon + 1);
        let name_end = jsx_identifier_end(text, name);
        // The name after the `:` may be missing.
        return if name_end > name { name_end } else { colon + 1 };
    }
    end
}

/// `parseJsxElementName`: `a`, `a-b`, `a:b`, `a.b.c`
fn jsx_tag_name_end(text: &[u8], at: usize) -> usize {
    let mut end = jsx_name_end(text, at);
    // "`a:b.c` is invalid syntax, don't even look for the `.` if we parse `a:b`"
    if end == at || text[at..end].contains(&b':') {
        return end;
    }
    loop {
        let dot = skip_trivia(text, end);
        if text.get(dot) != Some(&b'.') {
            return end;
        }
        let name = skip_trivia(text, dot + 1);
        match ident_end(text, name) {
            name_end if name_end > name => end = name_end,
            _ => return end,
        }
    }
}

/// The operators of more than one character, the longer first. `>` is always scanned by itself.
const LONG_OPERATORS: [&[u8]; 28] = [
    b"...", b"===", b"!==", b"**=", b"<<=", b"&&=", b"||=", b"??=", b"=>", b"==", b"!=", b"<=",
    b"++", b"--", b"+=", b"-=", b"*=", b"/=", b"%=", b"&=", b"|=", b"^=", b"&&", b"||", b"??",
    b"**", b"<<", b"?.",
];

/// `Scan`: where the token that starts at `at` ends. A template ends at its first `${`, and a `/` is never a regular expression.
pub(super) fn token_end(text: &[u8], at: usize, is_jsx: bool) -> usize {
    let Some(&first) = text.get(at) else {
        return at.min(text.len());
    };
    let next_is_digit = |i: usize| text.get(i).is_some_and(u8::is_ascii_digit);
    match first {
        b'"' | b'\'' => return string_end(text, at),
        b'`' => return template_text(text, at + 1).0,
        b'0'..=b'9' => return number_end(text, at),
        b'.' if next_is_digit(at + 1) => return number_end(text, at),
        b'#' => return ident_end(text, at + 1),
        b'<' if is_jsx && text.get(at + 1) == Some(&b'/') && text.get(at + 2) != Some(&b'*') => {
            return at + 2;
        }
        b'?' if text.get(at + 1) == Some(&b'.') && next_is_digit(at + 2) => return at + 1,
        _ => {}
    }
    if let Some(operator) = LONG_OPERATORS
        .iter()
        .find(|operator| text[at..].starts_with(operator))
    {
        return at + operator.len();
    }
    match identifier_end(text, at) {
        end if end > at => end,
        _ => (at + wtf8_byte_sequence_length(first) as usize).min(text.len()),
    }
}

/// Whether an expression can start after the word `word`, so that a `/` there starts a regular expression and a `<` a JSX element.
pub(super) fn is_keyword_before_expression(word: &[u8]) -> bool {
    matches!(
        word,
        b"return"
            | b"typeof"
            | b"instanceof"
            | b"in"
            | b"of"
            | b"new"
            | b"delete"
            | b"void"
            | b"throw"
            | b"case"
            | b"default"
            | b"do"
            | b"else"
            | b"yield"
            | b"await"
    )
}

/// `IsIdentifierPart`, of a byte: as `is_identifier_start`, and the digits.
pub(super) fn is_identifier_part(c: u8) -> bool {
    c.is_ascii_digit() || is_identifier_start(c)
}

fn is_identifier_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || matches!(c, b'_' | b'$' | b'\\') || c >= 0x80
}

/// How deep JSX elements are looked into while skipping. In a file without JSX the depth is 0.
const MAX_JSX_DEPTH: u32 = 64;

/// Past the type arguments whose `<` is at `open`, if that is what they are.
fn type_arguments_end(text: &[u8], open: usize, jsx_depth: u32) -> Option<usize> {
    let (mut at, mut depth) = (open, 0u32);
    loop {
        at = skip_trivia(text, at);
        match *text.get(at)? {
            b'<' => {
                depth += 1;
                at += 1;
            }
            b'>' => {
                depth = depth.checked_sub(1)?;
                at += 1;
                if depth == 0 {
                    return Some(at);
                }
            }
            b'=' if text.get(at + 1) == Some(&b'>') => at += 2,
            b'(' => at = close_from(text, at + 1, b')', jsx_depth),
            b'[' => at = close_from(text, at + 1, b']', jsx_depth),
            b'{' => at = close_from(text, at + 1, b'}', jsx_depth),
            b')' | b']' | b'}' | b';' | b'`' => return None,
            b'"' | b'\'' => at = string_end(text, at),
            _ => at += 1,
        }
    }
}

/// Past the JSX element or fragment whose `<` is at `open`. `None` if it is none, or not a whole one: then the `<` is an operator, or
/// opens the type parameters of an arrow function or of a function type.
fn jsx_element_end(text: &[u8], open: usize, jsx_depth: u32) -> Option<usize> {
    let inner_depth = jsx_depth.checked_sub(1)?;
    let mut at = skip_trivia(text, open + 1);
    if text.get(at) == Some(&b'>') {
        at += 1;
    } else {
        let name = at;
        at = jsx_tag_name_end(text, name);
        if at == name || !is_identifier_start(text[name]) {
            return None;
        }
        // `isArrowFunctionInJsx`
        let next = skip_trivia(text, at);
        let next_word = &text[next..ident_end(text, next)];
        if matches!(text.get(next), Some(b',' | b'='))
            || &text[name..at] == b"const" && !next_word.is_empty()
            || next_word == b"extends"
                && !matches!(
                    text.get(skip_trivia(text, next + next_word.len())),
                    Some(b'=' | b'>' | b'/')
                )
        {
            return None;
        }
        if text.get(next) == Some(&b'<') {
            at = type_arguments_end(text, next, inner_depth)?;
        }
        // The attributes.
        loop {
            at = skip_trivia(text, at);
            match *text.get(at)? {
                b'/' => {
                    let close = skip_trivia(text, at + 1);
                    return (text.get(close) == Some(&b'>')).then_some(close + 1);
                }
                b'>' => {
                    at += 1;
                    break;
                }
                b'{' => at = close_from(text, at + 1, b'}', inner_depth),
                c if is_identifier_start(c) => {
                    let name_end = jsx_name_end(text, at);
                    if name_end == at {
                        return None;
                    }
                    at = name_end;
                    let equals = skip_trivia(text, at);
                    if text.get(equals) == Some(&b'=') {
                        let value = skip_trivia(text, equals + 1);
                        at = match *text.get(value)? {
                            b'"' | b'\'' => jsx_string_end(text, value),
                            b'{' => close_from(text, value + 1, b'}', inner_depth),
                            b'<' => jsx_element_end(text, value, inner_depth)?,
                            _ => return None,
                        };
                    }
                }
                _ => return None,
            }
        }
    }
    // The children, up to the closing tag.
    loop {
        match *text.get(at)? {
            b'{' => at = close_from(text, at + 1, b'}', inner_depth),
            b'<' => {
                let next = skip_trivia(text, at + 1);
                if text.get(next) == Some(&b'/') {
                    let name = skip_trivia(text, next + 1);
                    let close = skip_trivia(text, jsx_tag_name_end(text, name));
                    return (text.get(close) == Some(&b'>')).then_some(close + 1);
                }
                at = jsx_element_end(text, at, inner_depth)?;
            }
            // Neither can be written in JSX text.
            b'}' | b'>' => return None,
            _ => at += 1,
        }
    }
}

/// From `start`, which is directly inside brackets, to after the `closer` that closes them. What is in between is skipped token
/// by token: brackets are matched, and strings, templates, comments, regular expressions and JSX text are not looked into. The end
/// of the text if they are never closed.
fn close_from(text: &[u8], start: usize, closer: u8, jsx_depth: u32) -> usize {
    try_close_from(text, start, closer, jsx_depth).unwrap_or(text.len())
}

/// Past the bracket that closes the one at `open`, JSX aside. `None`: no bracket is at `open`, or it is never closed.
pub(super) fn end_of_brackets(text: &[u8], open: usize) -> Option<usize> {
    let closer = match text.get(open)? {
        b'(' => b')',
        b'[' => b']',
        b'{' => b'}',
        _ => return None,
    };
    try_close_from(text, open + 1, closer, 0)
}

/// `close_from`. `None`: they are never closed.
fn try_close_from(text: &[u8], start: usize, closer: u8, jsx_depth: u32) -> Option<usize> {
    let next = skip_trivia(text, start);
    if text.get(next) == Some(&closer) {
        return Some(next + 1);
    }
    // What is open, outermost first. A `` ` `` stands for the `${` of a template.
    let mut open = vec![closer];
    let mut at = start;
    let mut expression_can_start = start
        .checked_sub(1)
        .and_then(|before| text.get(before))
        .is_none_or(|b| b.is_ascii_whitespace() || b"([{},;:=!&|?+-*%<>~^".contains(b));
    loop {
        at = skip_trivia(text, at);
        let &c = text.get(at)?;
        match c {
            b'(' | b'[' | b'{' => {
                open.push(match c {
                    b'(' => b')',
                    b'[' => b']',
                    _ => b'}',
                });
                at += 1;
                expression_can_start = true;
            }
            b'}' if open.last() == Some(&b'`') => {
                let (end, is_substitution) = template_text(text, at + 1);
                if !is_substitution {
                    open.pop();
                }
                at = end;
                expression_can_start = is_substitution;
            }
            b')' | b']' | b'}' => {
                at += 1;
                // One that closes nothing is skipped. One that closes an outer bracket closes what is open inside it.
                if let Some(depth) = open.iter().rposition(|&o| o == c) {
                    open.truncate(depth);
                    if open.is_empty() {
                        return Some(at);
                    }
                }
                expression_can_start = c == b'}';
            }
            b'"' | b'\'' => {
                at = string_end(text, at);
                expression_can_start = false;
            }
            b'`' => {
                let (end, is_substitution) = template_text(text, at + 1);
                if is_substitution {
                    open.push(b'`');
                }
                at = end;
                expression_can_start = is_substitution;
            }
            b'/' if expression_can_start => {
                at = regex_end(text, at);
                expression_can_start = false;
            }
            b'<' => {
                let element = if expression_can_start {
                    jsx_element_end(text, at, jsx_depth)
                } else {
                    None
                };
                if let Some(end) = element {
                    at = end;
                    expression_can_start = false;
                } else if text.get(at + 1) == Some(&b'/')
                    && !matches!(text.get(at + 2), Some(b'*' | b'/'))
                {
                    // The start of a closing tag.
                    at += 2;
                    expression_can_start = false;
                } else {
                    at += 1;
                    expression_can_start = true;
                }
            }
            // Before or after an operand: what can follow stays the same.
            b'+' | b'-' if text.get(at + 1) == Some(&c) => at += 2,
            b'0'..=b'9' => {
                at = number_end(text, at);
                expression_can_start = false;
            }
            b'.' if text.get(at + 1).is_some_and(u8::is_ascii_digit) => {
                at = number_end(text, at);
                expression_can_start = false;
            }
            _ if is_identifier_start(c) || c == b'#' => {
                let end = word_end(text, at).max(at + 1).min(text.len());
                expression_can_start = is_keyword_before_expression(&text[at..end]);
                at = end;
            }
            _ => {
                at += 1;
                expression_can_start = true;
            }
        }
    }
}

// ───────────────────────────── the tree ─────────────────────────────

/// The tree of a file and its text. Every function gives `node.End()` of what it is named after, unless it says otherwise.
#[derive(Copy, Clone)]
pub(crate) struct Spans<'a> {
    pub(crate) hir: &'a File,
    pub(crate) text: &'a [u8],
}

impl<'a> Spans<'a> {
    pub(crate) fn of(hir: &'a File) -> Self {
        Spans {
            hir,
            text: &hir.text,
        }
    }

    /// The byte at `at`, 0 past the end.
    fn byte(self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    fn skip_trivia(self, at: usize) -> usize {
        skip_trivia(self.text, at)
    }

    /// Past `token` if it is the next thing after `at`. Otherwise `at`.
    fn eat(self, at: usize, token: &[u8]) -> usize {
        let start = self.skip_trivia(at);
        match self.text.get(start..) {
            Some(rest) if rest.starts_with(token) => start + token.len(),
            _ => at,
        }
    }

    /// `LanguageVariantJSX`
    fn is_jsx(self) -> bool {
        self.hir.kind == FileKind::Tsx || self.hir.is_js
    }

    /// From `at`, which is directly inside brackets, to after the `closer` that closes them.
    fn close(self, at: usize, closer: u8) -> usize {
        let jsx_depth = if self.is_jsx() { MAX_JSX_DEPTH } else { 0 };
        close_from(self.text, at, closer, jsx_depth)
    }

    /// Past what the bracket at `open` opens.
    fn bracket(self, open: usize) -> usize {
        match self.byte(open) {
            b'(' => self.close(open + 1, b')'),
            b'[' => self.close(open + 1, b']'),
            b'{' => self.close(open + 1, b'}'),
            _ => self.token(open),
        }
    }

    /// `GetRangeOfTokenAtPosition`
    fn token(self, at: usize) -> usize {
        token_end(self.text, at, self.is_jsx())
    }

    /// The name that starts at `at`: an identifier, a private name, a string, a number, `[computed]`, or a binding pattern. Any
    /// other token by itself.
    fn name(self, at: usize) -> usize {
        match self.byte(at) {
            b'[' | b'{' => self.bracket(at),
            _ => self.token(at),
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn type_pos(self, node: TypeNodeId) -> usize {
        self.hir.types.get(node.idx()).map_or(0, |t| t.pos as usize)
    }

    /// `e` as it is written, with the parentheses around it.
    pub(crate) fn expr(self, e: ExprId) -> usize {
        self.expr_from(e, 0)
    }

    /// `e` with those of the parentheses around it that open at `start` or later.
    fn expr_from(self, e: ExprId, start: usize) -> usize {
        let around = crate::hir::parentheses_around(self.hir, e).iter();
        match around.take_while(|p| p.1 as usize >= start).last() {
            Some(outermost) => outermost.2 as usize,
            None => self.expr_inside(e),
        }
    }

    /// `e` itself, whatever parentheses it is in.
    fn expr_inside(self, e: ExprId) -> usize {
        self.hir.exprs.get(e.idx()).map_or(0, |e| e.end as usize)
    }

    /// A property of an object literal.
    pub(crate) fn prop(self, p: PropId) -> usize {
        self.hir
            .props
            .get(p.idx())
            .map_or(0, |prop| prop.end as usize)
    }

    /// The name of a property of an object literal.
    pub(crate) fn prop_name(self, p: PropId) -> usize {
        let Some(prop) = self.hir.props.get(p.idx()) else {
            return 0;
        };
        self.key(prop.key, prop.pos as usize)
    }

    /// The name `key`, which is written at `pos`.
    fn key(self, key: PropKey, pos: usize) -> usize {
        match key {
            PropKey::Computed(e) => {
                let end = self.expr(e);
                // `parseComputedPropertyName`
                let is_missed = self.byte(self.skip_trivia(end)) != b']';
                if is_missed && self.hir.has_parse_diagnostics {
                    return end;
                }
                self.close(end, b']')
            }
            _ => self.name(pos),
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// How many `(` are written right before `pos`, at `floor` or later. Parentheses around a type are not kept.
    fn parens_before(self, floor: usize, pos: usize) -> usize {
        let (mut at, mut count) = (pos, 0);
        loop {
            let end = skip_trivia_back(self.text, at);
            if end == 0 || end <= floor {
                return count;
            }
            match self.text[end - 1] {
                b'(' => count += 1,
                // A bar before the whole of a type leads it, and so does the `!` of JSDoc.
                b'|' | b'&' | b'!' => {}
                _ => return count,
            }
            at = end - 1;
        }
    }

    /// `node` as it is written, with those of the parentheses around it that open at `floor` or later. `floor` is where the type
    /// that `node` is the first part of starts, which the parentheses before that are around. 0 for a type that is part of no other.
    fn ty_in(self, node: TypeNodeId, floor: usize) -> usize {
        let mut end = self.ty(node);
        for _ in 0..self.parens_before(floor, self.type_pos(node)) {
            end = self.eat(end, b")");
        }
        end
    }

    /// `node` itself, whatever parentheses it is in.
    fn ty(self, node: TypeNodeId) -> usize {
        self.hir
            .types
            .get(node.idx())
            .map_or(0, |node| node.end as usize)
    }

    /// Past the type arguments `args`, which are written after `at`. `at` if there are none.
    fn type_args(self, args: IdList<TypeNodeId>, at: usize) -> usize {
        match self.hir.ids(args).next_back() {
            Some(last) => self.close_angle(self.ty_in(last, at)),
            None => {
                // `f<>`
                let open = self.eat(at, b"<");
                match self.eat(open, b">") {
                    close if open != at && close != open => close,
                    _ => at,
                }
            }
        }
    }

    /// Past the `>` of a list whose last element ends at `at`.
    fn close_angle(self, at: usize) -> usize {
        self.eat(self.eat(at, b","), b">")
    }

    fn tuple_elem(self, elem: TupleElemId) -> usize {
        self.hir
            .tuple_elems
            .get(elem.idx())
            .map_or(0, |elem| elem.end as usize)
    }

    fn type_param(self, tp: TypeParamId) -> usize {
        self.hir
            .type_params
            .get(tp.idx())
            .map_or(0, |tp| tp.end as usize)
    }

    // ───────────────────────────── patterns ─────────────────────────────

    fn pat(self, pat: PatId) -> usize {
        self.hir
            .pats
            .get(pat.idx())
            .map_or(0, |node| node.end as usize)
    }

    fn pat_prop(self, p: PatPropId) -> usize {
        self.hir
            .pat_props
            .get(p.idx())
            .map_or(0, |node| node.end as usize)
    }

    fn pat_elem(self, p: PatElemId) -> usize {
        self.hir
            .pat_elems
            .get(p.idx())
            .map_or(0, |node| node.end as usize)
    }

    // ───────────────────────────── declarations ─────────────────────────────

    fn var_decl(self, decl: VarDeclId) -> usize {
        self.hir
            .var_decls
            .get(decl.idx())
            .map_or(0, |decl| decl.loc.end as usize)
    }

    /// Where the tag of a JSDoc comment that starts at `at` ends: where the next one starts, or else before the `*/`.
    /// `parseTagComments`: an `@` in braces or inside a word starts none.
    fn jsdoc_tag(self, at: usize) -> usize {
        let comments = &self.hir.jsdoc_comments;
        let Some(&(_, comment_end)) = comments
            .partition_point(|comment| comment.0 as usize <= at)
            .checked_sub(1)
            .and_then(|index| comments.get(index))
        else {
            return at;
        };
        let last = (comment_end as usize)
            .saturating_sub(2)
            .min(self.text.len());
        let mut depth = 0usize;
        for next in at + 1..last {
            match self.text[next] {
                b'{' => depth += 1,
                b'}' => depth = depth.saturating_sub(1),
                b'@' if depth == 0 && !self.text[next - 1].is_ascii_alphanumeric() => return next,
                _ => {}
            }
        }
        last.max(at)
    }

    fn param(self, param: ParamId) -> usize {
        self.hir
            .params
            .get(param.idx())
            .map_or(0, |param| param.loc.end as usize)
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `getErrorRangeForArrowFunction`: an arrow function whose block goes over several lines is pointed at by the first of them.
    fn arrow_error_end(self, e: ExprId, f: FnId) -> usize {
        let end = self.expr_inside(e);
        match self.hir.fns.get(f.idx()) {
            Some(func) if matches!(func.body, FnBody::Block(_)) => {
                line_end(self.text, self.eat(func.anchor as usize, b"=>")).min(end)
            }
            _ => end,
        }
    }
}

// ───────────────────────────── for the checker ─────────────────────────────

impl Checker<'_> {
    fn spans(&self, file: FileId) -> Spans<'_> {
        Spans::of(self.hir(file))
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `node.End()` of the expression `e` as it is written: after the parentheses around it. Goes with `start_of`.
    pub fn end_of_expr(&self, file: FileId, e: ExprId) -> u32 {
        self.spans(file).expr(e) as u32
    }

    /// `node.End()` of `e` itself, before any `)` around the whole of it. Goes with `start_inside_parentheses`.
    pub(super) fn end_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        self.spans(file).expr_inside(e) as u32
    }

    /// `node.End()` of the node for `e` that starts at `start`: closes the parentheses around `e` that open at `start` or later.
    pub(super) fn end_of_expr_from(&self, file: FileId, e: ExprId, start: u32) -> u32 {
        self.spans(file).expr_from(e, start as usize) as u32
    }

    /// The end of `GetErrorRangeForNode` of `e` as it is written. Goes with `error_start_of`.
    pub(super) fn error_end_of(&self, file: FileId, e: ExprId) -> u32 {
        if is_parenthesized(self.hir(file), e) {
            self.end_of_expr(file, e)
        } else {
            self.error_end_inside_parentheses(file, e)
        }
    }

    /// The same, of `e` itself, whatever parentheses it is in. Goes with `error_start_inside_parentheses`.
    pub(super) fn error_end_inside_parentheses(&self, file: FileId, e: ExprId) -> u32 {
        let (hir, spans) = (self.hir(file), self.spans(file));
        let Some(expr) = hir.exprs.get(e.idx()) else {
            return 0;
        };
        let is_pointed_at_by_a_token = match expr.kind {
            ExprKind::Fn(f) => match hir.fns.get(f.idx()).map(|f| f.kind) {
                Some(FnKind::Arrow) => return spans.arrow_error_end(e, f) as u32,
                kind => kind == Some(FnKind::Expr),
            },
            ExprKind::Class(_) | ExprKind::Satisfies { .. } | ExprKind::Yield { .. } => true,
            _ => false,
        };
        if is_pointed_at_by_a_token {
            // A name, the keyword, or the first token where there is no name.
            spans.name(self.error_start_inside_parentheses(file, e) as usize) as u32
        } else {
            spans.expr_inside(e) as u32
        }
    }

    /// `GetErrorRangeForNode` of `e` as it is written: `(error_start_of, error_end_of)`.
    pub(super) fn error_range_of_expr(&self, file: FileId, e: ExprId) -> (u32, u32) {
        (self.error_start_of(file, e), self.error_end_of(file, e))
    }

    /// `node.End()` of the property `p` of an object literal, or of the JSX attribute `p`.
    pub(super) fn end_of_prop(&self, file: FileId, p: PropId) -> u32 {
        self.spans(file).prop(p) as u32
    }

    /// `node.End()` of the name of the property `p` of an object literal, `[computed]` included, or of the JSX attribute `p`.
    pub(super) fn end_of_prop_name(&self, file: FileId, p: PropId) -> u32 {
        if self.is_jsx_attr(file, p) {
            self.end_of_jsx_attr_name(file, p)
        } else {
            self.spans(file).prop_name(p) as u32
        }
    }

    fn is_jsx_attr(&self, file: FileId, p: PropId) -> bool {
        self.bound(file)
            .prop_owner
            .get(p.idx())
            .and_then(|owner| self.hir(file).exprs.get(owner.idx()))
            .is_some_and(|owner| matches!(owner.kind, ExprKind::Jsx(_)))
    }

    // ───────────────────────────── JSX ─────────────────────────────

    /// `node.End()` of the name of the attribute `p` of a JSX element.
    pub(super) fn end_of_jsx_attr_name(&self, file: FileId, p: PropId) -> u32 {
        let hir = self.hir(file);
        match hir.props.get(p.idx()) {
            Some(prop) => jsx_name_end(&hir.text, prop.pos as usize) as u32,
            None => 0,
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `node.End()` of the type node `node`. Parentheses around a type are not kept, and those around the whole of `node` are not
    /// counted: goes with `hir[node].pos`.
    pub fn end_of_type_node(&self, file: FileId, node: TypeNodeId) -> u32 {
        self.spans(file).ty(node) as u32
    }

    /// `node.End()` of the node for `node` that starts at `start`: closes the parentheses around `node` that open at `start` or later.
    pub(super) fn end_of_type_node_from(&self, file: FileId, node: TypeNodeId, start: u32) -> u32 {
        self.spans(file).ty_in(node, start as usize) as u32
    }

    /// How many `ParenthesizedType` nodes are around `node`, of those that open at `floor` or later. 0 where the text is not kept.
    pub(super) fn parenthesized_type_depth(
        &self,
        file: FileId,
        node: TypeNodeId,
        floor: u32,
    ) -> usize {
        let spans = self.spans(file);
        spans.parens_before(floor as usize, spans.type_pos(node))
    }

    /// Where the last of the types `args` ends, parentheses included: the end of the list, before its `>`. 0 for an empty list.
    pub(super) fn end_of_type_args(&self, file: FileId, args: IdList<TypeNodeId>) -> u32 {
        match self.hir(file).ids(args).next_back() {
            Some(last) => self.spans(file).ty_in(last, 0) as u32,
            None => 0,
        }
    }

    /// `node.End()` of an element of a tuple type.
    pub(super) fn end_of_tuple_elem(&self, file: FileId, elem: TupleElemId) -> u32 {
        self.spans(file).tuple_elem(elem) as u32
    }

    /// `node.End()` of a type parameter.
    pub(super) fn end_of_type_param(&self, file: FileId, tp: TypeParamId) -> u32 {
        self.spans(file).type_param(tp) as u32
    }

    // ───────────────────────────── patterns ─────────────────────────────

    /// `node.End()` of the binding name or pattern `pat`.
    pub fn end_of_pat(&self, file: FileId, pat: PatId) -> u32 {
        self.spans(file).pat(pat) as u32
    }

    /// `node.End()` of the binding element `p` of an object pattern.
    pub(super) fn end_of_pat_prop(&self, file: FileId, p: PatPropId) -> u32 {
        self.spans(file).pat_prop(p) as u32
    }

    /// `node.End()` of the binding element `p` of an array pattern.
    pub(super) fn end_of_pat_elem(&self, file: FileId, p: PatElemId) -> u32 {
        self.spans(file).pat_elem(p) as u32
    }

    fn range_of_pat(&self, file: FileId, pat: PatId) -> (u32, u32) {
        let start = self.hir(file).pats.get(pat.idx()).map_or(0, |pat| pat.pos);
        (start, self.end_of_pat(file, pat))
    }

    /// `GetErrorRangeForNode` of the binding element `p` of an object pattern: the name or pattern it binds.
    pub(super) fn error_range_of_pat_prop(&self, file: FileId, p: PatPropId) -> (u32, u32) {
        match self.hir(file).pat_props.get(p.idx()) {
            Some(prop) => self.range_of_pat(file, prop.value),
            None => (0, 0),
        }
    }

    /// `GetErrorRangeForNode` of the binding element `p` of an array pattern: the name or pattern it binds.
    pub(super) fn error_range_of_pat_elem(&self, file: FileId, p: PatElemId) -> (u32, u32) {
        match self.hir(file).pat_elems.get(p.idx()) {
            Some(elem) => self.range_of_pat(file, elem.pat),
            None => (0, 0),
        }
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `node.End()` of the statement `s`, its `;` included. The declarations in the head of a `for` are a statement here and have
    /// none.
    pub fn end_of_stmt(&self, file: FileId, s: StmtId) -> u32 {
        self.hir(file).stmts.get(s.idx()).map_or(0, |s| s.loc.end)
    }

    /// `GetErrorRangeForNode` of the statement `s`: the name of a declaration or else its first token, the keyword of a `return`,
    /// the whole of anything else.
    pub(super) fn error_range_of_stmt(&self, file: FileId, s: StmtId) -> (u32, u32) {
        let (hir, spans) = (self.hir(file), self.spans(file));
        let Some(&Stmt {
            kind, start, loc, ..
        }) = hir.stmts.get(s.idx())
        else {
            return (0, 0);
        };
        let name = match kind {
            StmtKind::Fn(f) => hir.fns.get(f.idx()).map(|f| (f.name, f.name_pos)),
            StmtKind::Class(c) => hir.classes.get(c.idx()).map(|c| (c.name, c.name_pos)),
            StmtKind::Interface(i) => hir.interfaces.get(i.idx()).map(|i| (i.name, i.name_pos)),
            StmtKind::TypeAlias(a) => hir.aliases.get(a.idx()).map(|a| (a.name, a.name_pos)),
            StmtKind::Enum(e) => hir.enums.get(e.idx()).map(|e| (e.name, e.name_pos)),
            StmtKind::Module(m) => hir.modules.get(m.idx()).map(|m| (known::empty, m.name_pos)),
            StmtKind::Return(_) => Some((Atom::NONE, start)),
            _ => return (start, loc.end),
        };
        let at = match name {
            Some((name, name_pos)) if name.is_some() => name_pos,
            _ => start,
        };
        (at, spans.token(at as usize) as u32)
    }

    /// Where the first token after the modifiers of the statement `s` is: of a variable statement, its `VariableDeclarationList`.
    pub(super) fn start_after_modifiers(&self, file: FileId, s: StmtId) -> u32 {
        let hir = self.hir(file);
        let Some(last) = hir.modifier_list(hir[s].modifiers).last() else {
            return hir[s].start;
        };
        let end = match last.kind {
            ModifierKind::Decorator(e) => self.end_of_expr(file, e),
            ModifierKind::Keyword(_) => self.end_of_token_at(file, last.pos),
        };
        self.skip_trivia_from(file, end)
    }

    /// `GetErrorRangeForNode` of a `case` or `default` clause: up to its `:`.
    pub(super) fn error_range_of_case(&self, file: FileId, case: CaseId) -> (u32, u32) {
        let hir = self.hir(file);
        let Some(case) = hir.cases.get(case.idx()) else {
            return (0, 0);
        };
        match hir.ids(case.body).next() {
            Some(first) => (case.pos, hir[first].loc.pos),
            None => (case.pos, case.end),
        }
    }

    /// `GetErrorRangeForNode` of one declaration of a variable statement: its name or pattern.
    pub(super) fn error_range_of_var_decl(&self, file: FileId, decl: VarDeclId) -> (u32, u32) {
        match self.hir(file).var_decls.get(decl.idx()) {
            Some(decl) => self.range_of_pat(file, decl.pat),
            None => (0, 0),
        }
    }

    /// `node.End()` of a `VariableDeclarationList`: the statement without its `;`. 0 if nothing is declared.
    pub(super) fn end_of_var_decl_list(&self, file: FileId, decls: Span<VarDeclId>) -> u32 {
        match decls.iter().next_back() {
            Some(last) => self.spans(file).var_decl(last) as u32,
            None => 0,
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `node.End()` of whatever `func` is: a function, a method, an accessor, a signature with its `;`, a function type.
    pub(super) fn end_of_fn(&self, file: FileId, func: FnId) -> u32 {
        let hir = self.hir(file);
        match self.bound(file).fns.get(func.idx()).map(|func| func.owner) {
            Some(FnOwner::Expr(e)) => hir[e].end,
            Some(FnOwner::Stmt(s)) => hir[s].loc.end,
            Some(FnOwner::Member(m)) => hir[m].loc.end,
            Some(FnOwner::Type(node)) => hir[node].end,
            Some(FnOwner::None) | None => 0,
        }
    }

    /// `GetErrorRangeForNode`, of whatever `f` is.
    pub(super) fn error_range_of_fn(&self, file: FileId, f: FnId) -> (u32, u32) {
        let spans = self.spans(file);
        let Some(func) = self.hir(file).fns.get(f.idx()) else {
            return (0, 0);
        };
        match self.bound(file).fns.get(f.idx()).map(|f| f.owner) {
            Some(FnOwner::Member(m)) => self.error_range_of_member(file, m),
            Some(FnOwner::Stmt(s)) => self.error_range_of_stmt(file, s),
            Some(FnOwner::Expr(e)) if matches!(func.kind, FnKind::Expr | FnKind::Arrow) => (
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            _ if matches!(func.kind, FnKind::Method | FnKind::Getter | FnKind::Setter) => {
                (func.name_pos, spans.name(func.name_pos as usize) as u32)
            }
            _ => (func.start, self.end_of_fn(file, f)),
        }
    }

    /// `node.End()` of a class.
    pub(super) fn end_of_class(&self, file: FileId, class: ClassId) -> u32 {
        let hir = self.hir(file);
        match self.bound(file).class_owner[class.idx()] {
            ClassOwner::Expr(e) => hir[e].end,
            ClassOwner::Stmt(s) => hir[s].loc.end,
        }
    }

    /// `node.End()` of `Base<Args>` in the `extends` clause of a class (`ExpressionWithTypeArguments`). 0 if there is none.
    pub(super) fn end_of_class_extends(&self, file: FileId, class: ClassId) -> u32 {
        let spans = self.spans(file);
        match self.hir(file).classes.get(class.idx()) {
            Some(class) if class.extends.is_some() => {
                spans.type_args(class.extends_args, spans.expr(class.extends)) as u32
            }
            _ => 0,
        }
    }

    /// `node.End()` of the tag of a JSDoc comment that starts at `pos`, and of what is made from it.
    pub(super) fn end_of_jsdoc_tag(&self, file: FileId, pos: u32) -> u32 {
        self.spans(file).jsdoc_tag(pos as usize) as u32
    }

    /// `node.End()` of a parameter.
    pub(super) fn end_of_param(&self, file: FileId, param: ParamId) -> u32 {
        self.spans(file).param(param) as u32
    }

    /// `node.End()` of the name of a member, `[computed]` included.
    pub(super) fn end_of_member_name(&self, file: FileId, member: MemberId) -> u32 {
        match self.hir(file).members.get(member.idx()) {
            Some(member) => self.spans(file).key(member.key, member.name_pos as usize) as u32,
            None => 0,
        }
    }

    /// `GetErrorRangeForNode` of a member: the name of a property, an accessor or a method of a class; a constructor from its first
    /// modifier to the keyword; the whole of a signature.
    pub(super) fn error_range_of_member(&self, file: FileId, m: MemberId) -> (u32, u32) {
        let (hir, spans) = (self.hir(file), self.spans(file));
        let Some(member) = hir.members.get(m.idx()) else {
            return (0, 0);
        };
        let is_in_class = matches!(
            self.bound(file).member_owner.get(m.idx()),
            Some(MemberOwner::Class(_))
        );
        match member.kind {
            MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {}
            MemberKind::Method if is_in_class => {}
            MemberKind::Constructor => {
                return (member.start, spans.token(member.name_pos as usize) as u32);
            }
            _ => return (member.start, member.loc.end),
        }
        (
            member.name_pos,
            spans.key(member.key, member.name_pos as usize) as u32,
        )
    }

    /// `GetErrorRangeForNode` of a member of an enum: its name.
    pub(super) fn error_range_of_enum_member(&self, file: FileId, m: EnumMemberId) -> (u32, u32) {
        match self.hir(file).enum_members.get(m.idx()) {
            Some(member) => (member.pos, self.end_of_name_at(file, member.pos)),
            None => (0, 0),
        }
    }

    /// `node.End()` of `a` or `a as b` in an import.
    pub(super) fn end_of_import_spec(&self, file: FileId, spec: ImportSpecId) -> u32 {
        match self.hir(file).import_specs.get(spec.idx()) {
            Some(spec) => spec.end,
            None => 0,
        }
    }

    /// `node.End()` of `a` or `a as b` in an export.
    pub(super) fn end_of_export_spec(&self, file: FileId, spec: ExportSpecId) -> u32 {
        match self.hir(file).export_specs.get(spec.idx()) {
            Some(spec) => spec.end,
            None => 0,
        }
    }

    // ───────────────────────────── text ─────────────────────────────

    /// Where the name that starts at `pos` ends: an identifier, a private name, a string, a number, `[computed]`, a binding pattern.
    pub(super) fn end_of_name_at(&self, file: FileId, pos: u32) -> u32 {
        self.spans(file).name(pos as usize) as u32
    }

    /// `GetRangeOfTokenAtPosition`: where the token that starts at `pos` ends, operators of any length included. `pos` where there is
    /// no text: that of the default library is not kept.
    pub(super) fn end_of_token_at(&self, file: FileId, pos: u32) -> u32 {
        (self.spans(file).token(pos as usize) as u32).max(pos)
    }

    /// Where what the bracket at `open` opens is closed: after the matching `)`, `]`, `}`.
    pub(super) fn end_of_bracket_at(&self, file: FileId, open: u32) -> u32 {
        self.spans(file).bracket(open as usize) as u32
    }

    /// `SkipTrivia`: from `pos`, past blanks and comments.
    pub(super) fn skip_trivia_from(&self, file: FileId, pos: u32) -> u32 {
        self.spans(file).skip_trivia(pos as usize) as u32
    }

    /// Where the token before `pos` ends: back over blanks and comments. Where a missing node is, and `node.Pos()` of what starts at
    /// `pos`.
    pub(super) fn end_of_token_before(&self, file: FileId, pos: u32) -> u32 {
        skip_trivia_back(&self.hir(file).text, pos as usize) as u32
    }
}

impl Checker<'_> {
    /// `node.End()`
    pub(super) fn end_of_node(&self, file: FileId, node: Node) -> u32 {
        let hir = self.hir(file);
        match hir.data(node) {
            NodeData::None => 0,
            NodeData::File => hir.source_len,
            NodeData::Part(Part::Name, row) if matches!(hir.data(row), NodeData::Prop(_)) => {
                match hir.data(row) {
                    NodeData::Prop(p) => self.end_of_prop_name(file, p),
                    _ => 0,
                }
            }
            NodeData::Part(
                Part::Name
                | Part::PropertyName
                | Part::BindingsName
                | Part::Label
                | Part::ConstType,
                _,
            ) => self.end_of_name_at(file, hir.start(node)),
            NodeData::Part(Part::Base, row) => {
                let class = hir.class_of(row);
                match hir.ids(hir[class].extends_args).next_back() {
                    Some(_) => self.end_of_class_extends(file, class),
                    None => self.end_of_expr(file, hir[class].extends),
                }
            }
            NodeData::Part(Part::Qualified, row) => self.end_of_node(file, row),
            NodeData::Paren(p) => hir.parens[p.idx()].2,
            NodeData::Part(Part::Namespace | Part::LocalName, _) => {
                jsx_identifier_end(&hir.text, hir.start(node) as usize) as u32
            }
            NodeData::Part(Part::ImportClause, row) => match hir.data(row) {
                NodeData::Stmt(s) => match hir[s].kind {
                    StmtKind::Import(i) => hir[i].clause_end,
                    _ => 0,
                },
                _ => 0,
            },
            NodeData::Part(Part::NamedBindings, row) => {
                self.end_of_node(file, row.with(Part::ImportClause))
            }
            NodeData::Part(Part::Body | Part::Literal, row) => self.end_of_node(file, row),
            NodeData::Part(
                Part::Extends | Part::Implements | Part::DeclarationList | Part::CatchClause,
                _,
            ) => {
                let mut last = Node::NONE;
                hir.for_each_child(node, &mut |child| {
                    last = child;
                    false
                });
                self.end_of_node(file, last)
            }
            NodeData::Part(
                Part::NameLiteral | Part::Operand | Part::Keyword | Part::Specifier,
                _,
            ) if hir.start(node) != 0 => self.end_of_token_at(file, hir.start(node)),
            NodeData::Part(Part::ExportClause, row) => {
                self.end_of_node(file, row.with(Part::BindingsName))
            }
            // The tree does not say.
            NodeData::Part(..) => 0,
            NodeData::Expr(e) => self.end_inside_parentheses(file, e),
            NodeData::Stmt(s) => self.end_of_stmt(file, s),
            NodeData::Type(t) => self.end_of_type_node(file, t),
            NodeData::Pat(p) => self.end_of_pat(file, p),
            NodeData::PatProp(p) => self.end_of_pat_prop(file, p),
            NodeData::PatElem(e) => self.end_of_pat_elem(file, e),
            NodeData::Param(p) => self.end_of_param(file, p),
            NodeData::TypeParam(p) => self.end_of_type_param(file, p),
            NodeData::Member(m) => hir[m].loc.end,
            NodeData::Prop(p) => self.end_of_prop(file, p),
            NodeData::VarDecl(d) => hir[d].loc.end,
            NodeData::Case(c) => match hir.ids(hir[c].body).next_back() {
                Some(last) => self.end_of_stmt(file, last),
                None => self.error_range_of_case(file, c).1,
            },
            NodeData::EnumMember(m) => hir[m].loc.end,
            NodeData::ImportSpec(s) => self.end_of_import_spec(file, s),
            NodeData::ExportSpec(s) => self.end_of_export_spec(file, s),
            NodeData::TupleElem(e) => self.end_of_tuple_elem(file, e),
            NodeData::Modifier(m) => match hir[m].kind {
                ModifierKind::Decorator(e) => self.end_of_expr(file, e),
                ModifierKind::Keyword(_) => self.end_of_token_at(file, hir[m].pos),
            },
            NodeData::Name(n) => self.end_of_token_at(file, hir[n].pos()),
        }
    }

    /// `GetErrorRangeForNode`
    pub(super) fn get_error_range_for_node(&self, file: FileId, node: Node) -> (u32, u32) {
        let hir = self.hir(file);
        match hir.data(node) {
            // The file goes by its first token.
            NodeData::File => {
                let start = self.skip_trivia_from(file, 0);
                (start, self.end_of_token_at(file, start))
            }
            NodeData::Expr(e) => (
                self.error_start_inside_parentheses(file, e),
                self.error_end_inside_parentheses(file, e),
            ),
            NodeData::Stmt(s) => self.error_range_of_stmt(file, s),
            NodeData::Member(m) => self.error_range_of_member(file, m),
            NodeData::Prop(_) if hir.function_of(node).is_some() => {
                self.error_range_of_fn(file, hir.function_of(node))
            }
            NodeData::PatProp(p) => self.error_range_of_pat_prop(file, p),
            NodeData::PatElem(e) => self.error_range_of_pat_elem(file, e),
            NodeData::VarDecl(d) => self.error_range_of_var_decl(file, d),
            NodeData::Case(c) => self.error_range_of_case(file, c),
            NodeData::EnumMember(m) => self.error_range_of_enum_member(file, m),
            NodeData::Part(Part::NamedBindings, _) if hir.name(node).is_some() => {
                self.get_error_range_for_node(file, hir.name(node))
            }
            _ => (hir.start(node), self.end_of_node(file, node)),
        }
    }
}
