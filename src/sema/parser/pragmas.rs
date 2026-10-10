//! The pragmas in the comments before the first token: `/// <reference .. />`, `// @ts-check` and
//! `// @ts-nocheck`, `/* @jsx h */` and similar.

use bun_sema::atom::Atom;
use bun_sema::hir::{
    Diagnostic, DiagnosticKind, FileBuilder, FileKind, JsxPragmas, ReferenceKind, ResolutionMode,
};

/// `getCommentPragmas` and `processPragmasIntoFields`. `leading`: the comments before the first
/// token. False: TypeScript reports an error about one of them. With `recovers` the error is among
/// the diagnostics of the file instead.
pub(crate) fn process_pragmas_into_fields(
    text: &[u8],
    leading: &[(u32, u32)],
    recovers: bool,
    intern: &mut dyn FnMut(&[u8]) -> Atom,
    file: &mut FileBuilder,
) -> bool {
    for &(start, end) in leading {
        let comment = &text[start as usize..end as usize];
        match comment.get(..2) {
            Some(b"//") => {
                if !single_line_pragma(comment, start as usize, recovers, intern, file) {
                    return false;
                }
            }
            // Only read for files that can contain JSX.
            Some(b"/*") if file.kind == FileKind::Tsx => {
                multi_line_pragmas(comment, intern, &mut file.jsx_pragmas);
            }
            _ => {}
        }
    }
    true
}

/// `extractPragmas` for the `//` comment `text` at `comment_pos`, followed by
/// `processPragmasIntoFields`.
fn single_line_pragma(
    text: &[u8],
    comment_pos: usize,
    recovers: bool,
    intern: &mut dyn FnMut(&[u8]) -> Atom,
    file: &mut FileBuilder,
) -> bool {
    let mut pos = 2;
    let triple_slash = text.get(pos) == Some(&b'/');
    if triple_slash {
        pos += 1;
    }
    pos = skip_blanks(text, pos);
    if text.get(pos) == Some(&b'@') {
        // "_last_ of either nocheck or check in a file is the "winner""
        let name = extract_name(text, pos + 1);
        if name.eq_ignore_ascii_case(b"ts-check") {
            file.check_directive = Some(true);
        } else if name.eq_ignore_ascii_case(b"ts-nocheck") {
            file.check_directive = Some(false);
        }
        return true;
    }
    if !triple_slash
        || text.get(pos) != Some(&b'<')
        || !extract_name(text, pos + 1).eq_ignore_ascii_case(b"reference")
    {
        return true;
    }
    pos += "<reference".len();
    const NAMES: [&[u8]; 5] = [
        b"types",
        b"lib",
        b"path",
        b"resolution-mode",
        b"no-default-lib",
    ];
    // `PragmaArgument.TextRange`, relative to the comment. The last of two arguments with the same
    // name wins.
    let mut args: [Option<(usize, usize)>; 5] = [None; 5];
    loop {
        pos = skip_blanks(text, pos);
        let name = extract_name(text, pos);
        if name.is_empty() {
            break;
        }
        pos = skip_blanks(text, pos + name.len());
        if text.get(pos) != Some(&b'=') {
            break;
        }
        pos = skip_blanks(text, pos + 1);
        let Some(value) = extract_quoted_string(text, pos) else {
            break;
        };
        if let Some(n) = NAMES.iter().position(|it| name.eq_ignore_ascii_case(it)) {
            args[n] = Some((pos + 1, pos + 1 + value.len()));
        }
        pos += value.len() + 2;
    }
    let [types, lib, path, resolution_mode, no_default_lib] = args;
    if no_default_lib.is_some_and(|(from, to)| &text[from..to] == b"true") {
        return true;
    }
    let (kind, (from, to)) = match (types, lib, path) {
        (Some(types), ..) => (ReferenceKind::Types, types),
        (None, Some(lib), _) => (ReferenceKind::Lib, lib),
        (None, None, Some(path)) => (ReferenceKind::Path, path),
        (None, None, None) => {
            let at = (comment_pos as u32, (comment_pos + text.len()) as u32);
            if recovers {
                let error = Diagnostic::new(DiagnosticKind::Parse, at, 1084, &[]);
                file.diagnostics.push(error);
            }
            return recovers;
        }
    };
    // `parseResolutionMode`
    let mode = match resolution_mode.filter(|_| kind == ReferenceKind::Types) {
        Some((from, to)) => match &text[from..to] {
            b"import" => ResolutionMode::Import,
            b"require" => ResolutionMode::Require,
            _ if !recovers => return false,
            _ => {
                let at = ((comment_pos + from) as u32, (comment_pos + to) as u32);
                let error = Diagnostic::new(DiagnosticKind::Parse, at, 1453, &[]);
                file.diagnostics.push(error);
                ResolutionMode::None
            }
        },
        None => ResolutionMode::None,
    };
    let value = intern(&text[from..to]);
    file.references
        .push((kind, value, (comment_pos + from) as u32, mode));
    true
}

/// `extractPragmas` for the `/* */` comment `text`. The last of two identical pragmas wins
/// (`GetPragmaFromSourceFile`).
fn multi_line_pragmas(
    text: &[u8],
    intern: &mut dyn FnMut(&[u8]) -> Atom,
    pragmas: &mut JsxPragmas,
) {
    let text = text.strip_suffix(b"*/").unwrap_or(text);
    let mut pos = 2;
    // `skipTo`
    while let Some(found) = text
        .get(pos..)
        .and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'@'))
    {
        pos += found;
        // "the '@' must be immediately followed by a non-whitespace pragma name, and the remainder of the line is consumed as that
        // pragma's arguments"
        let name_end = skip_non_blanks(text, pos + 1);
        if name_end == pos + 1 {
            pos += 1;
            continue;
        }
        let name = &text[pos + 1..name_end];
        let start = skip_blanks(text, name_end);
        let argument = &text[start..skip_non_blanks(text, start)];
        let is = |it: &[u8]| !argument.is_empty() && name.eq_ignore_ascii_case(it);
        if is(b"jsx") {
            pragmas.factory = intern(argument);
        } else if is(b"jsxFrag") {
            pragmas.fragment_factory = intern(argument);
        } else if is(b"jsxImportSource") {
            pragmas.import_source = intern(argument);
        } else if is(b"jsxRuntime") {
            // `GetJSXImplicitImportBase`
            pragmas.classic = match argument {
                b"classic" => Some(true),
                b"automatic" => Some(false),
                _ => None,
            };
        }
        pos = line_end_pos(text, pos);
    }
}

fn skip_blanks(text: &[u8], mut pos: usize) -> usize {
    while pos < text.len() && matches!(text[pos], b' ' | b'\t') {
        pos += 1;
    }
    pos
}

fn skip_non_blanks(text: &[u8], mut pos: usize) -> usize {
    while pos < text.len() && !matches!(text[pos], b' ' | b'\t' | b'\r' | b'\n') {
        pos += 1;
    }
    pos
}

fn line_end_pos(text: &[u8], pos: usize) -> usize {
    (pos..text.len())
        .find(|&at| {
            matches!(text[at], b'\n' | b'\r') || matches!(text[at..], [0xE2, 0x80, 0xA8 | 0xA9, ..])
        })
        .unwrap_or(text.len())
}

/// Not lowercased, unlike `extractName`: callers compare case-insensitively.
fn extract_name(text: &[u8], pos: usize) -> &[u8] {
    let rest = text.get(pos..).unwrap_or_default();
    let len = rest
        .iter()
        .take_while(|c| c.is_ascii_alphabetic() || **c == b'-')
        .count();
    &rest[..len]
}

fn extract_quoted_string(text: &[u8], pos: usize) -> Option<&[u8]> {
    let quote = *text.get(pos)?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    let rest = &text[pos + 1..];
    Some(&rest[..rest.iter().position(|&c| c == quote)?])
}
