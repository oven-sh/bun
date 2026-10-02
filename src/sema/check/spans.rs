//! Where nodes end. The tree only says where they start, so the end of a node is worked out from its parts and the source text, and
//! only for a node an error is reported on.
//!
//! The end of a node is the end of its last part, or of the token that closes it, which is looked for from the end of the last part
//! on. Only what the tree keeps nothing of is skipped token by token.

use super::Checker;
use crate::atom::{Atom, known};
use crate::bind::{FnOwner, MemberOwner};
use crate::hir::{
    CallId, CaseId, ClassId, EnumMemberId, ExportSpecId, Expr, ExprId, ExprKind, File, FileKind,
    Flags, FnBody, FnId, FnKind, Func, INCOMPLETE_TEMPLATE, IdList, ImportSpecId, InterfaceId,
    JsxId, Keyword, MemberId, MemberKind, ParamId, PatElemId, PatId, PatKind, PatPropId, PropId,
    PropKey, PropKind, Span, Stmt, StmtId, StmtKind, TupleElemId, TypeNode, TypeNodeId,
    TypeNodeKind, TypeParamId, UnOp, VarDeclId, is_parenthesized, open_parenthesis,
    start_inside_parentheses,
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
pub(super) fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C) => at += 1,
            Some(b'/') => match text.get(at + 1) {
                Some(b'/') => at = line_end(text, at + 2),
                Some(b'*') => {
                    at = text[at + 2..]
                        .windows(2)
                        .position(|w| w == b"*/")
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
                at = line[at + 2..]
                    .windows(2)
                    .position(|w| w == b"*/")
                    .map(|end| at + end + 4)?;
            }
            _ => at += 1,
        }
    }
    None
}

/// `isConflictMarkerTrivia`, of what is written at `line`, where a line starts.
fn is_conflict_marker_trivia(text: &[u8], line: usize) -> bool {
    text.get(line..line + 8).is_some_and(|marker| {
        matches!(marker[0], b'<' | b'>' | b'=' | b'|')
            && marker[..7].iter().all(|&b| b == marker[0])
            && (marker[0] == b'=' || marker[7] == b' ')
    })
}

/// `scanConflictMarkerTrivia`, backwards from the marker at `line`: where the trivia starts that ends with that line. All from a
/// `|||||||` or a `=======` to the `>>>>>>>` is trivia.
fn conflict_marker_trivia_start(text: &[u8], line: usize) -> usize {
    let (mut start, mut at) = (line, line);
    while text[line] == b'>' && at > 0 {
        at = text[..at - 1]
            .iter()
            .rposition(|&c| matches!(c, b'\n' | b'\r'))
            .map_or(0, |i| i + 1);
        if is_conflict_marker_trivia(text, at) {
            match text[at] {
                b'=' | b'|' => start = at,
                _ => break,
            }
        }
    }
    start
}

/// Where the token before `pos` ends: back over blanks, comments, conflict markers and a shebang. A missing node is there
/// (`createMissingNode`).
pub(super) fn skip_trivia_back(text: &[u8], pos: usize) -> usize {
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
                if is_conflict_marker_trivia(text, line) {
                    at = conflict_marker_trivia_start(text, line);
                } else if line == 0 && text.starts_with(b"#!") {
                    at = 0;
                } else if let Some(comment) = line_comment_start(&text[line..at]) {
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
            && let Some(open) = text[..at - 2].windows(2).rposition(|w| w == b"/*")
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
pub(super) fn start_of_token_before(text: &[u8], at: u32, written: &[u8]) -> Option<u32> {
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
pub(super) fn jsx_identifier_end(text: &[u8], mut at: usize) -> usize {
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
pub(super) fn jsx_tag_name_end(text: &[u8], at: usize) -> usize {
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
        let Some(&c) = text.get(at) else {
            return None;
        };
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

fn keyword_text(keyword: Keyword) -> &'static [u8] {
    match keyword {
        Keyword::Any => b"any",
        Keyword::Unknown => b"unknown",
        Keyword::Never => b"never",
        Keyword::Void => b"void",
        Keyword::Undefined => b"undefined",
        Keyword::Null => b"null",
        Keyword::String => b"string",
        Keyword::Number => b"number",
        Keyword::Boolean => b"boolean",
        Keyword::BigInt => b"bigint",
        Keyword::Symbol => b"symbol",
        Keyword::Object => b"object",
        Keyword::This => b"this",
        Keyword::Intrinsic => b"intrinsic",
    }
}

// ───────────────────────────── the tree ─────────────────────────────

/// The tree of a file and its text. Every function gives `node.End()` of what it is named after, unless it says otherwise.
#[derive(Copy, Clone)]
struct Spans<'a> {
    hir: &'a File,
    text: &'a [u8],
}

impl<'a> Spans<'a> {
    fn of(hir: &'a File) -> Self {
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

    /// The name or keyword that starts at `at`.
    fn word_at(self, at: usize) -> &'a [u8] {
        word_at(self.text, at)
    }

    /// Past `token` if it is the next thing after `at`. Otherwise `at`.
    fn eat(self, at: usize, token: &[u8]) -> usize {
        let start = self.skip_trivia(at);
        match self.text.get(start..) {
            Some(rest) if rest.starts_with(token) => start + token.len(),
            _ => at,
        }
    }

    /// Past the word `word` if it is the next thing after `at`. Otherwise `at`.
    fn eat_word(self, at: usize, word: &[u8]) -> usize {
        let start = self.skip_trivia(at);
        if self.word_at(start) == word {
            start + word.len()
        } else {
            at
        }
    }

    /// Past the name after `at`, if one is next.
    fn eat_name(self, at: usize) -> usize {
        let start = self.skip_trivia(at);
        match word_end(self.text, start) {
            end if end > start => end,
            _ => at,
        }
    }

    /// `parseTypeMemberSemicolon`
    fn member_separator(self, at: usize) -> usize {
        match self.eat(at, b",") {
            end if end != at => end,
            _ => self.eat(at, b";"),
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

    /// `close`, of the array or object literal that opens at `open`, unless the parser missed its closer.
    fn close_literal(self, open: usize, at: usize, closer: u8) -> usize {
        let unclosed = &self.hir.unclosed_literals;
        match unclosed.binary_search_by_key(&(open as u32), |literal| literal.0) {
            Ok(found) => unclosed[found].1 as usize,
            Err(_) => self.close(at, closer),
        }
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

    /// Past the braces that open after `at`. `at` if none do.
    fn braces_after(self, at: usize) -> usize {
        let open = self.skip_trivia(at);
        if self.byte(open) == b'{' {
            self.close(open + 1, b'}')
        } else {
            at
        }
    }

    /// Right after the first `{` from `at` on that is in no other bracket. For the head of a declaration whose braces are empty.
    fn inside_braces_after(self, mut at: usize) -> usize {
        loop {
            at = self.skip_trivia(at);
            match self.byte(at) {
                b'{' => return at + 1,
                b'(' | b'[' => at = self.bracket(at),
                _ if at >= self.text.len() => return self.text.len(),
                _ => at = self.token(at).max(at + 1),
            }
        }
    }

    fn close_parens(self, mut at: usize, count: usize) -> usize {
        for _ in 0..count {
            at = self.eat(at, b")");
        }
        at
    }

    /// `GetRangeOfTokenAtPosition`
    fn token(self, at: usize) -> usize {
        token_end(self.text, at, self.is_jsx())
    }

    /// A string or a template without substitutions.
    fn quoted(self, at: usize) -> usize {
        match self.byte(at) {
            b'"' | b'\'' => string_end(self.text, at),
            b'`' => template_text(self.text, at + 1).0,
            _ => self.token(at),
        }
    }

    /// The name that starts at `at`: an identifier, a private name, a string, a number, `[computed]`, or a binding pattern. Any
    /// other token by itself.
    fn name(self, at: usize) -> usize {
        match self.byte(at) {
            b'[' | b'{' => self.bracket(at),
            _ => self.token(at),
        }
    }

    /// Past the template that opens at `open`. `end_of_part`: where what is substituted ends, given which it is and where its `${`
    /// ends.
    fn template(self, open: usize, end_of_part: &dyn Fn(usize, usize) -> usize) -> usize {
        let (mut at, mut is_substitution) = template_text(self.text, open + 1);
        let mut index = 0;
        while is_substitution {
            let inside = end_of_part(index, at).max(at);
            // `parseLiteralOfTemplateSpan`: the rest is a missing `TemplateTail`.
            if self.hir.has_parse_diagnostics && self.byte(self.skip_trivia(inside)) != b'}' {
                return inside;
            }
            (at, is_substitution) = template_text(self.text, self.close(inside, b'}'));
            index += 1;
        }
        at
    }

    /// `A.B.C` at `at`. An empty name stands for one that is missing.
    fn entity_name(self, at: usize, names: IdList<Atom>) -> usize {
        let mut end = match self.hir.ids(names).next() {
            Some(known::empty) => at,
            _ => word_end(self.text, at),
        };
        for name in self.hir.ids(names).skip(1) {
            let dot = self.eat(end, b".");
            if dot == end {
                break;
            }
            end = if name == known::empty {
                dot
            } else {
                self.eat_name(dot)
            };
        }
        end
    }

    // ───────────────────────────── expressions ─────────────────────────────

    fn expr_pos(self, e: ExprId) -> usize {
        self.hir.exprs.get(e.idx()).map_or(0, |e| e.pos as usize)
    }

    fn type_pos(self, node: TypeNodeId) -> usize {
        self.hir.types.get(node.idx()).map_or(0, |t| t.pos as usize)
    }

    /// How many `(` are written one after the other from `open` on, before `inside`.
    fn parens_from(self, open: usize, inside: usize) -> usize {
        let (mut at, mut count) = (open, 0);
        loop {
            at = self.skip_trivia(at);
            if at >= inside || self.byte(at) != b'(' {
                return count;
            }
            at += 1;
            count += 1;
        }
    }

    /// `e` as it is written, with the parentheses around it.
    fn expr(self, e: ExprId) -> usize {
        self.expr_from(e, 0)
    }

    /// `e` with those of the parentheses around it that open at `start` or later.
    fn expr_from(self, e: ExprId, start: usize) -> usize {
        let end = self.expr_inside(e);
        match open_parenthesis(self.hir, e) {
            Some(open) => {
                let inside = start_inside_parentheses(self.hir, e) as usize;
                let count = self.parens_from((open as usize).max(start), inside);
                self.close_parens(end, count)
            }
            None => end,
        }
    }

    /// `e` itself, whatever parentheses it is in.
    fn expr_inside(self, e: ExprId) -> usize {
        let Some(&Expr { kind, pos }) = self.hir.exprs.get(e.idx()) else {
            return 0;
        };
        let pos = pos as usize;
        let end = match kind {
            ExprKind::Missing | ExprKind::Ident(known::empty) => {
                return skip_trivia_back(self.text, pos);
            }
            ExprKind::Ident(_) | ExprKind::This | ExprKind::Super | ExprKind::Null => {
                self.token(pos)
            }
            ExprKind::True | ExprKind::False => self.token(pos),
            ExprKind::Number(_) | ExprKind::BigInt(_) => number_end(self.text, pos),
            ExprKind::String(_) => match self.byte(pos) {
                b'"' | b'\'' | b'`' => self.quoted(pos),
                b'#' => word_end(self.text, pos),
                // JSX text is put where its element starts.
                b'<' => self.token(pos),
                // The name of an intrinsic element.
                _ => jsx_name_end(self.text, pos),
            },
            ExprKind::Regex => regex_end(self.text, pos),
            ExprKind::Template { exprs, .. } => self.template_of_exprs(pos, exprs),
            ExprKind::TaggedTemplate(c) => {
                let Some(call) = self.hir.calls.get(c.idx()) else {
                    return self.token(pos);
                };
                let tag_end = self.type_args(call.type_args, self.expr(call.callee));
                let open = self.skip_trivia(self.eat(tag_end, b"?."));
                if self.byte(open) == b'`' {
                    self.template_of_exprs(open, call.args)
                } else {
                    tag_end
                }
            }
            ExprKind::Array(items) => {
                // Holes take no room.
                let last = self.hir.ids(items).rev().find(|&item| {
                    !matches!(
                        self.hir.exprs.get(item.idx()),
                        None | Some(Expr {
                            kind: ExprKind::Missing,
                            ..
                        })
                    )
                });
                self.close_literal(pos, last.map_or(pos + 1, |last| self.expr(last)), b']')
            }
            ExprKind::Object(props) => {
                let last = props.iter().next_back();
                self.close_literal(pos, last.map_or(pos + 1, |last| self.prop(last)), b'}')
            }
            ExprKind::Fn(f) => self.func(f),
            ExprKind::Class(c) => self.class(c),
            ExprKind::Dot {
                obj,
                name: known::empty,
                ..
            } => {
                let obj_end = self.expr(obj);
                let dot_end = match self.eat(obj_end, b"?.") {
                    end if end != obj_end => end,
                    _ => self.eat(obj_end, b"."),
                };
                // `parseRightSideOfDot`: a private name that is not allowed there is consumed all the same.
                match self.skip_trivia(dot_end) {
                    name if self.byte(name) == b'#' => word_end(self.text, name),
                    _ => dot_end,
                }
            }
            ExprKind::Dot { name_pos, .. } => word_end(self.text, name_pos as usize),
            ExprKind::Index { index, .. } => self.close(self.expr(index), b']'),
            ExprKind::Call(c) | ExprKind::New(c) => self.call(c, pos),
            ExprKind::Unary {
                op: op @ (UnOp::PostInc | UnOp::PostDec),
                operand,
            } => self.eat(
                self.expr(operand),
                if op == UnOp::PostInc { b"++" } else { b"--" },
            ),
            ExprKind::Unary { operand: last, .. }
            | ExprKind::Binary { right: last, .. }
            | ExprKind::Assign { value: last, .. }
            | ExprKind::Cond { no: last, .. }
            | ExprKind::Spread(last)
            | ExprKind::Await(last) => self.expr(last),
            ExprKind::Yield { value, star } => {
                if value.is_some() {
                    self.expr(value)
                } else if star {
                    self.eat(self.token(pos), b"*")
                } else {
                    self.token(pos)
                }
            }
            // `x as T`, or `<T>x`.
            ExprKind::As { expr, ty } => {
                if self.type_pos(ty) > self.expr_pos(expr) {
                    self.ty_in(ty, 0)
                } else {
                    self.expr(expr)
                }
            }
            // `x satisfies T`, or what a `@satisfies` tag before `x` makes.
            ExprKind::Satisfies { expr, ty } => {
                if self.type_pos(ty) > self.expr_pos(expr) {
                    self.ty_in(ty, 0)
                } else {
                    self.expr(expr)
                }
            }
            // `x as const`, or `<const>x`.
            ExprKind::AsConst(x) => {
                let operand_end = self.expr(x);
                let after_as = self.eat_word(operand_end, b"as");
                match self.eat_word(after_as, b"const") {
                    end if after_as != operand_end && end != after_as => end,
                    _ => operand_end,
                }
            }
            ExprKind::NonNull(x) => self.eat(self.expr(x), b"!"),
            ExprKind::Instantiation { expr, type_args } => {
                self.type_args(type_args, self.expr(expr))
            }
            ExprKind::Jsx(jsx) => self.jsx(pos, jsx),
            ExprKind::ImportCall(specifier, more) => {
                let mut deferred = self.hir.deferred_import_calls.iter();
                if let Some(&(_, close)) = deferred.find(|call| call.0 == specifier)
                    && self.byte(close as usize) == b')'
                {
                    return close as usize + 1;
                }
                let last = self.hir.ids(more).last().unwrap_or(specifier);
                self.close(self.expr(last).max(pos), b')')
            }
            // `import.meta`, `new.target`
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                self.eat_name(self.eat(self.token(pos), b"."))
            }
        };
        end.max(pos)
    }

    fn template_of_exprs(self, open: usize, exprs: IdList<ExprId>) -> usize {
        self.template(open, &|index, from| {
            if index < exprs.len() {
                self.expr(self.hir.id_at(exprs, index))
            } else {
                from
            }
        })
    }

    /// A call or a `new` expression that starts at `pos`.
    fn call(self, c: CallId, pos: usize) -> usize {
        let Some(call) = self.hir.calls.get(c.idx()) else {
            return self.token(pos);
        };
        // The `)`, or where it is missed the last character of the last token of the call (`finishNode`).
        if call.close_pos < INCOMPLETE_TEMPLATE {
            return call.close_pos as usize + 1;
        }
        // `new C<T>`
        self.type_args(call.type_args, self.expr(call.callee))
    }

    /// A property of an object literal.
    fn prop(self, p: PropId) -> usize {
        let Some(prop) = self.hir.props.get(p.idx()) else {
            return 0;
        };
        if prop.value.is_some() {
            self.expr(prop.value)
        } else {
            self.prop_name(p)
        }
    }

    /// The name of a property of an object literal.
    fn prop_name(self, p: PropId) -> usize {
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

    // ───────────────────────────── JSX ─────────────────────────────

    /// The element whose `<` is at `pos`.
    fn jsx(self, pos: usize, jsx: JsxId) -> usize {
        match self.hir.jsx.get(jsx.idx()) {
            Some(element) if element.close_pos != u32::MAX => self.jsx_closing(jsx),
            _ => self.jsx_opening(pos, jsx),
        }
    }

    /// Where the opening or closing tag whose `<` is at `less_than` ends, if the parser objected to something in it.
    fn jsx_tag_end(self, less_than: usize) -> Option<usize> {
        let ends = &self.hir.jsx_tag_ends;
        let found = ends
            .binary_search_by_key(&(less_than as u32), |tag| tag.0)
            .ok()?;
        Some(ends[found].1 as usize)
    }

    /// `<tag attrs>`, `<>`, or all of `<tag attrs />`. The `<` is at `pos`.
    fn jsx_opening(self, pos: usize, jsx: JsxId) -> usize {
        if let Some(end) = self.jsx_tag_end(pos) {
            return end;
        }
        let Some(element) = self.hir.jsx.get(jsx.idx()) else {
            return self.token(pos);
        };
        let at = match element.attrs.iter().next_back() {
            Some(last) => self.jsx_attr(last),
            None if element.tag.is_some() => {
                self.type_args(element.type_args, self.expr(element.tag))
            }
            None => pos + 1,
        };
        self.eat(self.eat(at, b"/"), b">")
    }

    /// `</tag>`, `</>`
    fn jsx_closing(self, jsx: JsxId) -> usize {
        let Some(element) = self.hir.jsx.get(jsx.idx()) else {
            return 0;
        };
        if element.close_pos == u32::MAX {
            return 0;
        }
        let name = self.hir.exprs.get(element.close_tag.idx());
        if name.is_some_and(|name| matches!(name.kind, ExprKind::Missing)) {
            return element.close_pos as usize;
        }
        if let Some(end) = self.jsx_tag_end(element.close_pos as usize) {
            return end;
        }
        let slash_end = self.eat(self.eat(element.close_pos as usize, b"<"), b"/");
        let name = self.skip_trivia(slash_end);
        match jsx_tag_name_end(self.text, name) {
            name_end if name_end > name => self.eat(name_end, b">"),
            _ => self.eat(slash_end, b">"),
        }
    }

    /// `name`, `name="v"`, `name={e}`, `{...e}`
    fn jsx_attr(self, p: PropId) -> usize {
        let Some(prop) = self.hir.props.get(p.idx()) else {
            return 0;
        };
        if prop.kind == PropKind::Spread {
            return self.close(self.expr(prop.value).max(prop.pos as usize), b'}');
        }
        let name_end = jsx_name_end(self.text, prop.pos as usize);
        let equals = self.eat(name_end, b"=");
        if equals == name_end {
            return name_end;
        }
        let value = self.skip_trivia(equals);
        match self.byte(value) {
            b'"' | b'\'' => jsx_string_end(self.text, value),
            b'{' => {
                let is_written = self
                    .hir
                    .exprs
                    .get(prop.value.idx())
                    .is_some_and(|e| !matches!(e.kind, ExprKind::Missing));
                if is_written {
                    self.close(self.expr(prop.value).max(value + 1), b'}')
                } else {
                    self.bracket(value)
                }
            }
            b'<' => self.expr(prop.value),
            _ => equals,
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    /// Where `node` starts. The `new` of a constructor type is not counted in where it is said to be.
    fn type_start(self, node: TypeNodeId) -> usize {
        let mut at = self.type_pos(node);
        if let Some(&TypeNode {
            kind: TypeNodeKind::Fn(f),
            ..
        }) = self.hir.types.get(node.idx())
            && self
                .hir
                .fns
                .get(f.idx())
                .is_some_and(|f| f.kind == FnKind::ConstructorType)
        {
            let words: [&[u8]; 2] = [b"new", b"abstract"];
            for word in words {
                let end = skip_trivia_back(self.text, at);
                if self.text[..end].ends_with(word) {
                    at = end - word.len();
                }
            }
        }
        at
    }

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
        let mut end = self.non_null_suffix(self.ty(node));
        for _ in 0..self.parens_before(floor, self.type_start(node)) {
            end = self.non_null_suffix(self.eat(end, b")"));
        }
        end
    }

    /// Past the `!` of JSDoc's `T!`, of which only `T` is kept (`parsePostfixTypeOrHigher`). `T` ends at `at`.
    fn non_null_suffix(self, at: usize) -> usize {
        let next = self.skip_trivia(at);
        if self.byte(next) == b'!' && self.byte(next + 1) != b'=' && line_end(self.text, at) >= next
        {
            next + 1
        } else {
            at
        }
    }

    /// `node` itself, whatever parentheses it is in.
    fn ty(self, node: TypeNodeId) -> usize {
        let Some(&TypeNode { kind, pos }) = self.hir.types.get(node.idx()) else {
            return 0;
        };
        let pos = pos as usize;
        let end = match kind {
            TypeNodeKind::Error | TypeNodeKind::BoolLit(_) => self.token(pos),
            TypeNodeKind::Keyword(keyword) => {
                if self.is_written_keyword(node) {
                    pos + keyword_text(keyword).len()
                } else if self.byte(pos) == b'*' {
                    // JSDoc's `*`
                    pos + 1
                } else {
                    // One the lowering made: the `null` of JSDoc's `T?`.
                    return skip_trivia_back(self.text, pos);
                }
            }
            // A type that is missing.
            TypeNodeKind::Ref { name, args }
                if args.is_empty() && self.hir.ids(name).eq([known::empty]) =>
            {
                return skip_trivia_back(self.text, pos);
            }
            TypeNodeKind::Ref { name, args } => self.type_args(args, self.entity_name(pos, name)),
            TypeNodeKind::StringLit(_) => self.quoted(pos),
            TypeNodeKind::NumberLit(_) | TypeNodeKind::BigIntLit { .. } => {
                number_end(self.text, self.skip_trivia(self.eat(pos, b"-")))
            }
            TypeNodeKind::Template { types, .. } => self.template(pos, &|index, from| {
                if index < types.len() {
                    self.ty_in(self.hir.id_at(types, index), from)
                } else {
                    from
                }
            }),
            TypeNodeKind::Array(element) => {
                self.eat(self.eat(self.ty_in(element, pos), b"["), b"]")
            }
            TypeNodeKind::Tuple(elements) => {
                let last = elements.iter().next_back();
                self.close(last.map_or(pos + 1, |last| self.tuple_elem(last)), b']')
            }
            TypeNodeKind::Union(members) | TypeNodeKind::Intersection(members) => {
                let mut members = self.hir.ids(members);
                let Some(last) = members.next_back() else {
                    return self.token(pos);
                };
                // JSDoc's `T?` and `?T` are kept as `T | null`, with the keyword put where the whole starts.
                if self.type_pos(last) == pos
                    && !self.is_written_keyword(last)
                    && let Some(operand) = members.next_back()
                {
                    let operand_end = self.ty_in(operand, pos);
                    return if self.byte(pos) == b'?' {
                        operand_end
                    } else {
                        self.eat(operand_end, b"?")
                    };
                }
                self.ty_in(last, pos)
            }
            TypeNodeKind::Fn(f) => self.func(f),
            TypeNodeKind::Object(members) => {
                let last = members.iter().next_back();
                self.close(
                    last.map_or(pos + 1, |last| self.hir[last].loc.end as usize),
                    b'}',
                )
            }
            TypeNodeKind::Cond { no: last, .. }
            | TypeNodeKind::Keyof(last)
            | TypeNodeKind::Readonly(last) => self.ty_in(last, pos),
            TypeNodeKind::Infer(tp) => self.type_param(tp),
            TypeNodeKind::Mapped(mapped) => {
                let Some(mapped) = self.hir.mapped.get(mapped.idx()) else {
                    return self.token(pos);
                };
                let last_end = if mapped.ty.is_some() {
                    self.ty_in(mapped.ty, pos)
                } else if mapped.name_ty.is_some() {
                    self.ty_in(mapped.name_ty, pos)
                } else {
                    self.type_param(mapped.param)
                };
                self.close(last_end.max(pos + 1), b'}')
            }
            TypeNodeKind::IndexedAccess { index, .. } => self.close(self.ty_in(index, pos), b']'),
            // `unique symbol`
            TypeNodeKind::UniqueSymbol => self.eat_name(self.token(pos)),
            TypeNodeKind::Typeof { name, args, expr } => {
                let name_end = if expr.is_some() {
                    self.expr(expr)
                } else {
                    self.entity_name(self.skip_trivia(self.token(pos)), name)
                };
                self.type_args(args, name_end)
            }
            TypeNodeKind::Import {
                spec,
                args,
                is_typeof,
                ..
            } => {
                let import = if is_typeof {
                    self.skip_trivia(self.token(pos))
                } else {
                    pos
                };
                let keyword_end = self.token(import);
                let open = self.skip_trivia(keyword_end);
                if self.byte(open) != b'(' {
                    return keyword_end;
                }
                let mut at = self.bracket(open);
                loop {
                    let dot = self.eat(at, b".");
                    let end = self.eat_name(dot);
                    if dot == at || end == dot {
                        break;
                    }
                    at = end;
                }
                // Without a specifier `args` holds what is written in its place.
                if spec.is_some() {
                    self.type_args(args, at)
                } else {
                    at
                }
            }
            TypeNodeKind::Predicate { ty, .. } => {
                if ty.is_some() {
                    self.ty_in(ty, pos)
                } else {
                    // `asserts x`
                    self.eat_name(self.token(pos))
                }
            }
        };
        end.max(pos)
    }

    /// Whether `node` is a keyword that is written where it is said to be. One that is not stands for something else.
    fn is_written_keyword(self, node: TypeNodeId) -> bool {
        match self.hir.types.get(node.idx()) {
            Some(&TypeNode {
                kind: TypeNodeKind::Keyword(keyword),
                pos,
            }) => self.word_at(pos as usize) == keyword_text(keyword),
            _ => true,
        }
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

    /// Past the type parameters `params`. `at` if there are none.
    fn type_params(self, params: Span<TypeParamId>, at: usize) -> usize {
        match params.iter().next_back() {
            Some(last) => self.close_angle(self.type_param(last)),
            None => at,
        }
    }

    fn tuple_elem(self, elem: TupleElemId) -> usize {
        let Some(elem) = self.hir.tuple_elems.get(elem.idx()) else {
            return 0;
        };
        let type_end = self.ty_in(elem.ty, 0);
        if elem.optional && elem.name.is_none() {
            self.eat(type_end, b"?")
        } else {
            type_end
        }
    }

    fn type_param(self, tp: TypeParamId) -> usize {
        let Some(tp) = self.hir.type_params.get(tp.idx()) else {
            return 0;
        };
        if tp.default.is_some() {
            self.ty_in(tp.default, 0)
        } else if tp.constraint.is_some() {
            self.ty_in(tp.constraint, 0)
        } else {
            self.token(tp.pos as usize)
        }
    }

    // ───────────────────────────── patterns ─────────────────────────────

    fn pat(self, pat: PatId) -> usize {
        let Some(pat) = self.hir.pats.get(pat.idx()) else {
            return 0;
        };
        let pos = pat.pos as usize;
        match pat.kind {
            PatKind::Missing | PatKind::Ident(known::empty) => skip_trivia_back(self.text, pos),
            PatKind::Ident(_) => self.token(pos),
            PatKind::Object(props) => {
                let last = props.iter().next_back();
                self.close(last.map_or(pos + 1, |last| self.pat_prop(last)), b'}')
            }
            PatKind::Array(elems) => {
                // Holes take no room.
                let last = elems.iter().rev().find(|&elem| {
                    let elem = self.hir[elem];
                    elem.default.is_some()
                        || self
                            .hir
                            .pats
                            .get(elem.pat.idx())
                            .is_some_and(|pat| !matches!(pat.kind, PatKind::Missing))
                });
                self.close(last.map_or(pos + 1, |last| self.pat_elem(last)), b']')
            }
        }
    }

    fn pat_prop(self, p: PatPropId) -> usize {
        let Some(prop) = self.hir.pat_props.get(p.idx()) else {
            return 0;
        };
        if prop.default.is_some() {
            self.expr(prop.default)
        } else if prop.value.is_some() {
            self.pat(prop.value)
        } else {
            self.key(prop.key, prop.pos as usize)
        }
    }

    fn pat_elem(self, p: PatElemId) -> usize {
        let Some(elem) = self.hir.pat_elems.get(p.idx()) else {
            return 0;
        };
        if elem.default.is_some() {
            self.expr(elem.default)
        } else {
            self.pat(elem.pat)
        }
    }

    // ───────────────────────────── declarations ─────────────────────────────

    fn var_decl(self, decl: VarDeclId) -> usize {
        let Some(decl) = self.hir.var_decls.get(decl.idx()) else {
            return 0;
        };
        if decl.init.is_some() {
            self.expr(decl.init)
        } else if decl.ty.is_some() {
            self.ty_in(decl.ty, 0)
        } else if decl.flags.contains(Flags::DEFINITE) {
            self.eat(self.pat(decl.pat), b"!")
        } else {
            self.pat(decl.pat)
        }
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
        let Some(param) = self.hir.params.get(param.idx()) else {
            return 0;
        };
        let pos = param.pos as usize;
        // `reparseJSDocSignature`: one that is made from a `@param` tag is as long as the tag.
        if self.byte(pos) == b'@' && self.hir.is_in_jsdoc(param.pos) {
            return self.jsdoc_tag(pos);
        }
        // The type a JSDoc comment gives it is written before it, and is no part of it.
        let is_typed = param.ty.is_some() && self.type_pos(param.ty) >= pos;
        if param.default.is_some() {
            self.expr(param.default)
        } else if is_typed {
            self.ty_in(param.ty, 0)
        } else if param.flags.contains(Flags::OPTIONAL) {
            self.eat(self.pat(param.pat), b"?")
        } else {
            self.pat(param.pat)
        }
    }

    /// Where the head of `func` ends: after the return type or else the parameters, after the `=>` of an arrow function.
    fn signature(self, func: &Func) -> usize {
        let anchor = func.anchor as usize;
        if func.kind == FnKind::Arrow {
            return self.eat(anchor, b"=>");
        }
        let closer = match self.byte(anchor) {
            b'(' => b')',
            b'[' => b']',
            // `static { }`
            b'{' => return anchor,
            // `createMissingList`: no parameters are written. The anchor is in the token before.
            _ => 0,
        };
        let params_end = if closer == 0 {
            ident_end(self.text, anchor).max(anchor + 1)
        } else {
            let inside = match func.params.iter().next_back() {
                Some(last) => self.param(last),
                None if func.this_ty(self.hir).is_some() => self.ty_in(func.this_ty(self.hir), 0),
                None => anchor + 1,
            };
            self.close(inside.max(anchor + 1), closer)
        };
        // The return type a JSDoc comment gives it is written before it, and is no part of it.
        if func.ret.is_some() && self.type_pos(func.ret) >= anchor {
            self.ty_in(func.ret, 0)
        } else {
            params_end
        }
    }

    /// Whatever `f` is: a function, a method, an accessor, a signature with its `;`, a function type.
    fn func(self, f: FnId) -> usize {
        let Some(func) = self.hir.fns.get(f.idx()) else {
            return 0;
        };
        match func.body {
            FnBody::Expr(e) => self.expr(e),
            FnBody::Block(stmts) => match self.hir.ids(stmts).next_back() {
                Some(last) => self.close(self.hir[last].loc.end as usize, b'}'),
                None => self.braces_after(self.signature(func)),
            }
            .max(func.anchor as usize),
            FnBody::None => {
                let head_end = self.signature(func);
                if matches!(func.kind, FnKind::FunctionType | FnKind::ConstructorType)
                    || func.flags.contains(Flags::MISSING_BODY)
                {
                    head_end
                } else if func.flags.contains(Flags::BODY_DROPPED) {
                    self.braces_after(head_end)
                } else {
                    self.member_separator(head_end)
                }
            }
        }
    }

    fn class(self, c: ClassId) -> usize {
        let Some(class) = self.hir.classes.get(c.idx()) else {
            return 0;
        };
        let inside = match class.members.iter().next_back() {
            Some(last) => self.hir[last].loc.end as usize,
            None => {
                // The last thing in the head that is kept.
                let head = if let Some(last) = self.hir.ids(class.implements).next_back() {
                    self.ty_in(last, 0)
                } else if class.extends.is_some() {
                    self.type_args(class.extends_args, self.expr(class.extends))
                } else if class.name.is_some() {
                    self.type_params(class.type_params, self.token(class.name_pos as usize))
                } else {
                    self.type_params(class.type_params, class.pos as usize)
                };
                self.inside_braces_after(head)
            }
        };
        self.close(inside.max(class.pos as usize), b'}')
    }

    fn interface(self, i: InterfaceId) -> usize {
        let Some(interface) = self.hir.interfaces.get(i.idx()) else {
            return 0;
        };
        let inside = match interface.members.iter().next_back() {
            Some(last) => self.hir[last].loc.end as usize,
            None => {
                let head = match self.hir.ids(interface.extends).next_back() {
                    Some(last) => self.ty_in(last, 0),
                    None => self.type_params(
                        interface.type_params,
                        self.token(interface.name_pos as usize),
                    ),
                };
                self.inside_braces_after(head)
            }
        };
        self.close(inside.max(interface.name_pos as usize), b'}')
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// Past the `:` of a `case` or `default` clause. `None` if where it is written is not kept.
    fn case_label(self, case: CaseId) -> Option<usize> {
        let case = self.hir.cases.get(case.idx())?;
        if case.test.is_some() {
            return Some(self.eat(self.expr(case.test), b":"));
        }
        let pos = case.pos as usize;
        (self.word_at(pos) == b"default").then(|| self.eat(pos + b"default".len(), b":"))
    }

    /// `getErrorRangeForArrowFunction`: an arrow function whose block goes over several lines is pointed at by the first of them.
    fn arrow_error_end(self, f: FnId) -> usize {
        let end = self.func(f);
        match self.hir.fns.get(f.idx()) {
            Some(func) if matches!(func.body, FnBody::Block(_)) => {
                line_end(self.text, self.signature(func)).min(end)
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
                Some(FnKind::Arrow) => return spans.arrow_error_end(f) as u32,
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
        if self.is_jsx_attr(file, p) {
            self.spans(file).jsx_attr(p) as u32
        } else {
            self.spans(file).prop(p) as u32
        }
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

    /// `node.End()` of `<tag attrs>`, of `<>`, or of the whole of `<tag attrs />`. `e` is the element, `jsx` what it holds.
    pub(super) fn end_of_jsx_opening(&self, file: FileId, e: ExprId, jsx: JsxId) -> u32 {
        let spans = self.spans(file);
        spans.jsx_opening(spans.expr_pos(e), jsx) as u32
    }

    /// `node.End()` of `</tag>` or `</>`, which starts at `close_pos`.
    pub(super) fn end_of_jsx_closing(&self, file: FileId, jsx: JsxId) -> u32 {
        self.spans(file).jsx_closing(jsx) as u32
    }

    /// `node.End()` of the attribute `p` of a JSX element: `name`, `name="v"`, `name={e}`, `{...e}`.
    pub(super) fn end_of_jsx_attr(&self, file: FileId, p: PropId) -> u32 {
        self.spans(file).jsx_attr(p) as u32
    }

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
        spans.parens_before(floor as usize, spans.type_start(node))
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
        let Some(&Stmt { kind, pos, loc, .. }) = hir.stmts.get(s.idx()) else {
            return (0, 0);
        };
        let name = match kind {
            StmtKind::Fn(f) => hir.fns.get(f.idx()).map(|f| (f.name, f.name_pos)),
            StmtKind::Class(c) => hir.classes.get(c.idx()).map(|c| (c.name, c.name_pos)),
            StmtKind::Interface(i) => hir.interfaces.get(i.idx()).map(|i| (i.name, i.name_pos)),
            StmtKind::TypeAlias(a) => hir.aliases.get(a.idx()).map(|a| (a.name, a.name_pos)),
            StmtKind::Enum(e) => hir.enums.get(e.idx()).map(|e| (e.name, e.name_pos)),
            StmtKind::Module(m) => hir.modules.get(m.idx()).map(|m| (known::empty, m.name_pos)),
            StmtKind::Return(_) => Some((Atom::NONE, pos)),
            _ => return (pos, loc.end),
        };
        let start = match name {
            Some((name, name_pos)) if name.is_some() => name_pos,
            _ => pos,
        };
        (start, spans.token(start as usize) as u32)
    }

    /// `GetErrorRangeForNode` of a `case` or `default` clause: up to its `:`.
    pub(super) fn error_range_of_case(&self, file: FileId, case: CaseId) -> (u32, u32) {
        let start = self.hir(file).cases.get(case.idx()).map_or(0, |c| c.pos);
        (start, self.spans(file).case_label(case).unwrap_or(0) as u32)
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
        self.spans(file).func(func) as u32
    }

    /// `GetErrorRangeForNode` of whatever `func` is: the name of a function, an accessor or a method with a body to it, or else its
    /// first token; the first line of an arrow function; the whole of a signature or a function type. The name a function expression
    /// is given to is not looked for: `error_range_of_expr`.
    pub(super) fn error_range_of_fn(&self, file: FileId, f: FnId) -> (u32, u32) {
        let spans = self.spans(file);
        let Some(func) = self.hir(file).fns.get(f.idx()) else {
            return (0, 0);
        };
        if let Some(FnOwner::Member(m)) = self.bound(file).fns.get(f.idx()).map(|f| f.owner) {
            return self.error_range_of_member(file, m);
        }
        match func.kind {
            FnKind::Decl | FnKind::Expr | FnKind::Method | FnKind::Getter | FnKind::Setter => {
                (func.name_pos, spans.name(func.name_pos as usize) as u32)
            }
            FnKind::Arrow => (func.pos, spans.arrow_error_end(f) as u32),
            _ => (func.pos, spans.func(f) as u32),
        }
    }

    /// Where the head of `func` ends: after its return type, or else after the `)` of its parameters. After the `=>` of an arrow
    /// function.
    pub(super) fn end_of_signature(&self, file: FileId, func: FnId) -> u32 {
        match self.hir(file).fns.get(func.idx()) {
            Some(func) => self.spans(file).signature(func) as u32,
            None => 0,
        }
    }

    /// `node.End()` of a class.
    pub(super) fn end_of_class(&self, file: FileId, class: ClassId) -> u32 {
        self.spans(file).class(class) as u32
    }

    /// `node.End()` of an interface.
    pub(super) fn end_of_interface(&self, file: FileId, interface: InterfaceId) -> u32 {
        self.spans(file).interface(interface) as u32
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
            Some(member) => self.spans(file).key(member.key, member.pos as usize) as u32,
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
                return (member.start, spans.token(member.pos as usize) as u32);
            }
            _ => return (member.pos, member.loc.end),
        }
        (
            member.pos,
            spans.key(member.key, member.pos as usize) as u32,
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
            Some(spec) => self.end_of_token_at(file, spec.pos.max(spec.imported_pos)),
            None => 0,
        }
    }

    /// `node.End()` of `a` or `a as b` in an export.
    pub(super) fn end_of_export_spec(&self, file: FileId, spec: ExportSpecId) -> u32 {
        match self.hir(file).export_specs.get(spec.idx()) {
            Some(spec) => self.end_of_token_at(file, spec.pos.max(spec.local_pos)),
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

    /// `node.End()` of the template that opens at `open`, whatever is substituted in it.
    pub(super) fn end_of_template_at(&self, file: FileId, open: u32) -> u32 {
        self.spans(file).template(open as usize, &|_, from| from) as u32
    }

    /// Where what the bracket at `open` opens is closed: after the matching `)`, `]`, `}`.
    pub(super) fn end_of_bracket_at(&self, file: FileId, open: u32) -> u32 {
        self.spans(file).bracket(open as usize) as u32
    }

    /// `SkipTrivia`: from `pos`, past blanks and comments.
    pub(super) fn skip_trivia_from(&self, file: FileId, pos: u32) -> u32 {
        self.spans(file).skip_trivia(pos as usize) as u32
    }

    /// Where the qualifier of the import type `node` starts: the `A` of `import("m").A.B`, the `a` of `typeof import("m").a`.
    pub(super) fn start_of_import_type_qualifier(
        &self,
        file: FileId,
        node: TypeNodeId,
    ) -> Option<u32> {
        let spans = self.spans(file);
        let &TypeNode {
            kind: TypeNodeKind::Import { is_typeof, .. },
            pos,
        } = spans.hir.types.get(node.idx())?
        else {
            return None;
        };
        let import = if is_typeof {
            spans.skip_trivia(spans.token(pos as usize))
        } else {
            pos as usize
        };
        let open = spans.skip_trivia(spans.token(import));
        if spans.byte(open) != b'(' {
            return None;
        }
        let after = spans.bracket(open);
        let dot = spans.eat(after, b".");
        (dot != after).then(|| spans.skip_trivia(dot) as u32)
    }

    /// The range of each name of the entity name `A.B.C` that is written at `pos`, up to a name that is missing.
    pub(super) fn entity_name_ranges(
        &self,
        file: FileId,
        pos: u32,
        names: IdList<Atom>,
    ) -> Vec<(u32, u32)> {
        let spans = self.spans(file);
        let mut ranges = Vec::with_capacity(names.len());
        let mut start = pos as usize;
        for name in spans.hir.ids(names) {
            if name == known::empty {
                break;
            }
            let end = word_end(spans.text, start);
            ranges.push((start as u32, end as u32));
            let dot = spans.eat(end, b".");
            if dot == end {
                break;
            }
            start = spans.skip_trivia(dot);
        }
        ranges
    }

    /// Where what `import x = a.b.c` or `import x = require("m")` refers to starts.
    pub(super) fn start_of_import_equals_reference(
        &self,
        file: FileId,
        import: crate::hir::ImportEqualsId,
    ) -> Option<u32> {
        let spans = self.spans(file);
        let name_pos = spans.hir.import_equals.get(import.idx())?.name_pos;
        let name_end = spans.token(name_pos as usize);
        let equals = spans.eat(name_end, b"=");
        (equals != name_end).then(|| spans.skip_trivia(equals) as u32)
    }

    /// Where the token before `pos` ends: back over blanks and comments. Where a missing node is, and `node.Pos()` of what starts at
    /// `pos`.
    pub(super) fn end_of_token_before(&self, file: FileId, pos: u32) -> u32 {
        skip_trivia_back(&self.hir(file).text, pos as usize) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_tokens() {
        let cases = [
            ("abc.d", 3),
            ("\\u0061b c", 7),
            ("\\u{61}b c", 7),
            ("#x.y", 2),
            ("'a\\'b' c", 6),
            ("\"a\nb", 2),
            ("`a${b}`", 4),
            ("`a` b", 3),
            ("1_000.5e+3n", 11),
            ("0x1Fn+", 5),
            ("0b102", 4),
            ("017", 3),
            ("089.5", 5),
            ("1.toString", 2),
            (".5", 2),
            ("1e", 2),
            ("...a", 3),
            ("=>", 2),
            ("===", 3),
            (">>=", 1),
            ("?.a", 2),
            ("?.5", 1),
            ("??=", 3),
            ("@dec", 1),
            ("caf\u{e9}\u{a0}x", 5),
        ];
        for (text, end) in cases {
            assert_eq!(token_end(text.as_bytes(), 0, false), end, "{text}");
        }
        assert_eq!(token_end(b"</a", 0, true), 2);
        assert_eq!(token_end(b"</a", 0, false), 1);
    }

    #[test]
    fn scans_regular_expressions() {
        assert_eq!(regex_end(b"/a[/]b/gi.test", 0), 9);
        assert_eq!(regex_end(b"/\\//.x", 0), 4);
        // Not terminated.
        assert_eq!(regex_end(b"/abc) ;\n", 0), 4);
        assert_eq!(regex_end(b"/a", 0), 2);
    }

    #[test]
    fn scans_jsx_names_and_strings() {
        assert_eq!(jsx_name_end(b"data-a:b-c=", 0), 10);
        assert_eq!(jsx_tag_name_end(b"a.b . c>", 0), 7);
        assert_eq!(jsx_string_end(b"'a\\' b'", 0), 4);
        assert_eq!(string_end(b"'a\\' b'", 0), 7);
    }

    #[test]
    fn skips_trivia_both_ways() {
        let text = b"a /* b */ // c\n  d";
        assert_eq!(skip_trivia(text, 1), 17);
        assert_eq!(skip_trivia_back(text, 17), 1);
        let text = b"x = 'a//b' // c\r\n\t(y";
        assert_eq!(skip_trivia_back(text, 18), 10);
    }

    /// The bracket group that `text` starts with.
    fn group(text: &str, jsx_depth: u32) -> &str {
        let closer = match text.as_bytes()[0] {
            b'(' => b')',
            b'[' => b']',
            _ => b'}',
        };
        &text[..close_from(text.as_bytes(), 1, closer, jsx_depth)]
    }

    #[test]
    fn matches_brackets() {
        let cases = [
            (
                "{ a: '}', b: `${ {c: 1} }}` } x",
                "{ a: '}', b: `${ {c: 1} }}` }",
            ),
            ("( /[)]/ ) x", "( /[)]/ )"),
            ("(a / b) / c)", "(a / b)"),
            ("(a++ / 2, b) / 3)", "(a++ / 2, b)"),
            ("[1, [2, 3], /* ] */ 4] x", "[1, [2, 3], /* ] */ 4]"),
            ("{ return /}/ } }", "{ return /}/ }"),
            ("{ ) } x", "{ ) }"),
            ("(a", "(a"),
        ];
        for (text, expected) in cases {
            assert_eq!(group(text, 0), expected);
        }
    }

    #[test]
    fn skips_jsx_elements() {
        let cases = [
            (
                "{c && <p>Don't {a} <b x='}'/></p>} x",
                "{c && <p>Don't {a} <b x='}'/></p>}",
            ),
            ("{ f: <T>(x: T) => void } x", "{ f: <T>(x: T) => void }"),
            (
                "{ f: <T extends U>(x: T) => { } } x",
                "{ f: <T extends U>(x: T) => { } }",
            ),
            ("{ a < b, c > (d) } x", "{ a < b, c > (d) }"),
        ];
        for (text, expected) in cases {
            assert_eq!(group(text, MAX_JSX_DEPTH), expected);
        }
    }
}
