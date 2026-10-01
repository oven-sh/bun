//! Signatures, and what the declarations of one name have to agree on.
//!
//! * Type parameters: 2368 2716 2706 2744 2636 2637, and 2344 (or what says more) for a default that is not what the parameter extends.
//! * Parameter lists: 1098, 1014 1013 1047 1048 1015 1016, 1346 1347, 7060 1200; parameters: 2398 2681 2784.
//! * Accessors, methods, constructors, properties: 1005 1318, 1221 1222, 1092 1093, 1245 1267, 2676 2808.
//! * Return types: 2505 1064 1058 1062, 2705 2712, 1228 1229 2677 1230 1225.
//! * Overloads: 2383 2384 2385 2386 2512. Declarations that merge: 2395 2652.
//! * `erasableSyntaxOnly`: 1294.
//!
//! Follows `checkTypeParameter`, `checkTypeParameterDeferred`, `checkTypeParameters`, `checkTypeParametersNotReferenced`, `checkParameter`,
//! `checkPropertyDeclaration`, `checkSignatureDeclaration`, `checkAsyncFunctionReturnType`, `checkMethodDeclaration`,
//! `checkAccessorDeclaration`, `checkTypePredicate`, `checkFunctionOrConstructorSymbolWorker`, `checkExportsOnMergedDeclarations`,
//! `createPromiseReturnType`, `getAwaitedTypeNoAliasEx` and `checkAssertion` of TypeScript 7.0.2's checker.go,
//! `checkGrammarTypeParameterList`, `checkGrammarParameterList`, `checkGrammarForUseStrictSimpleParameterList`,
//! `checkGrammarArrowFunction`, `checkGrammarForGenerator`, `checkGrammarAccessor`, `checkGrammarMethod` and
//! `checkGrammarConstructorTypeParameters` of its grammarchecks.go, and `declareSymbolEx`, `declareModuleMember` and
//! `setExportContextFlag` of its binder.go.
//!
//! The summary of a file does not keep everything these ask about: a body where none belongs, a `this` parameter, `"use strict"`, where a
//! `?` or a modifier is. That is read from the text, from a place the summary does have.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, FnOwner, MemberOwner, Parent, ScopeKind, SymbolId};
use crate::resolve::ScriptTarget;
use crate::util::FxHashSet;

// ───────────────────────────── the text ─────────────────────────────

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

fn is_space(b: u8) -> bool {
    b.is_ascii_whitespace() || b == 0x0b
}

/// `SkipTrivia`: past white space and comments.
fn skip_trivia(text: &[u8], mut i: usize) -> usize {
    while let Some(&b) = text.get(i) {
        if is_space(b) {
            i += 1;
        } else if b == b'/' && text.get(i + 1) == Some(&b'/') {
            i += text[i..]
                .iter()
                .position(|&c| c == b'\n' || c == b'\r')
                .unwrap_or(text.len() - i);
        } else if b == b'/' && text.get(i + 1) == Some(&b'*') {
            i = match text[i + 2..].windows(2).position(|w| w == b"*/") {
                Some(end) => i + end + 4,
                None => text.len(),
            };
        } else {
            break;
        }
    }
    i.min(text.len())
}

/// Where the `//` comment starts that the line ending at `end` ends with, if it ends with one.
fn line_comment_start(text: &[u8], end: usize) -> Option<usize> {
    let mut i = text[..end]
        .iter()
        .rposition(|&b| b == b'\n' || b == b'\r')
        .map_or(0, |at| at + 1);
    // The line may begin in a comment that an earlier one opens.
    if let Some(close) = text[i..end].windows(2).position(|w| w == b"*/")
        && !text[i..i + close].windows(2).any(|w| w == b"/*")
    {
        i += close + 2;
    }
    while i + 1 < end {
        match text[i] {
            b'/' if text[i + 1] == b'/' => return Some(i),
            b'/' if text[i + 1] == b'*' => {
                i += 4 + text[i + 2..end].windows(2).position(|w| w == b"*/")?
            }
            b'"' | b'\'' | b'`' => i = skip_string(text, i).filter(|&after| after <= end)?,
            _ => i += 1,
        }
    }
    None
}

/// Where the comment opens that the `*/` at `close` closes.
fn block_comment_start(text: &[u8], close: usize) -> Option<usize> {
    let mut open = text[..close].windows(2).rposition(|w| w == b"/*")?;
    if text[open + 2..close].windows(2).any(|w| w == b"*/") {
        return None;
    }
    // Comments do not nest: one that opens earlier and is not closed in between goes on until here.
    while let Some(earlier) = text[..open].windows(2).rposition(|w| w == b"/*")
        && !text[earlier + 2..open].windows(2).any(|w| w == b"*/")
    {
        open = earlier;
    }
    Some(open)
}

/// Back over white space and comments: where what comes before `i` ends.
fn skip_trivia_back(text: &[u8], i: usize) -> usize {
    let mut i = i.min(text.len());
    loop {
        let from = i;
        while i > 0 && is_space(text[i - 1]) {
            i -= 1;
        }
        if has_line_break(text, i, from)
            && let Some(comment) = line_comment_start(text, i)
        {
            i = comment;
        } else if i >= 4
            && text[..i].ends_with(b"*/")
            && let Some(open) = block_comment_start(text, i - 2)
        {
            i = open;
        } else {
            return i;
        }
    }
}

/// The word that starts at `start`, which may be none.
fn word_at(text: &[u8], start: usize) -> &[u8] {
    let rest = text.get(start..).unwrap_or(&[]);
    &rest[..rest
        .iter()
        .position(|&b| !is_word_byte(b))
        .unwrap_or(rest.len())]
}

/// The word that ends at `end`, which may be none.
fn word_before(text: &[u8], end: usize) -> &[u8] {
    let before = &text[..end.min(text.len())];
    &before[before
        .iter()
        .rposition(|&b| !is_word_byte(b))
        .map_or(0, |i| i + 1)..]
}

fn has_line_break(text: &[u8], from: usize, to: usize) -> bool {
    text.get(from..to)
        .is_some_and(|between| between.iter().any(|&b| b == b'\n' || b == b'\r'))
}

const MEMBER_MODIFIERS: &[(&[u8], Flags)] = &[
    (b"public", Flags::PUBLIC),
    (b"private", Flags::PRIVATE),
    (b"protected", Flags::PROTECTED),
    (b"static", Flags::STATIC),
    (b"abstract", Flags::ABSTRACT),
    (b"override", Flags::OVERRIDE),
    (b"readonly", Flags::READONLY),
    (b"declare", Flags::AMBIENT),
    (b"async", Flags::ASYNC),
    (b"accessor", Flags::ACCESSOR),
];

const TYPE_PARAMETER_MODIFIERS: &[(&[u8], Flags)] = &[
    (b"in", Flags::IN),
    (b"out", Flags::OUT),
    (b"const", Flags::CONST),
];

/// The start of the node named at `name`, modifiers included. Only looks for the modifiers in `flags`; one may be repeated (`in out in T`).
fn start_with_modifiers(text: &[u8], name: u32, flags: Flags, modifiers: &[(&[u8], Flags)]) -> u32 {
    let mut start = name as usize;
    if start > text.len() {
        return name;
    }
    loop {
        let end = skip_trivia_back(text, start);
        let word = word_before(text, end);
        if !modifiers.iter().any(|m| m.0 == word && flags.contains(m.1)) {
            return start as u32;
        }
        start = end - word.len();
    }
}

/// Where the type the summary has at `pos` starts as it is written. Neither the parentheses around a type are kept nor a `|` or a `&`
/// before its only member. Only for a type that follows a `:`, a `=`, an `is` or a `<`, which none of these can be mistaken for.
fn start_of_written_type(text: &[u8], pos: u32) -> u32 {
    let mut start = pos as usize;
    if start > text.len() {
        return pos;
    }
    loop {
        let before = skip_trivia_back(text, start);
        if before == 0 || !matches!(text[before - 1], b'(' | b'|' | b'&') {
            return start as u32;
        }
        start = before - 1;
    }
}

/// Past the string that starts at `start`.
fn skip_string(text: &[u8], start: usize) -> Option<usize> {
    let quote = *text.get(start)?;
    let mut i = start + 1;
    while let Some(&b) = text.get(i) {
        match b {
            b'\\' => i += 1,
            b'\n' | b'\r' => return None,
            _ if b == quote => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Past the template that starts at `start`.
fn skip_template(text: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    while let Some(&b) = text.get(i) {
        match b {
            b'\\' => i += 2,
            b'`' => return Some(i + 1),
            b'$' if text.get(i + 1) == Some(&b'{') => i = skip_balanced(text, i + 1)?,
            _ => i += 1,
        }
    }
    None
}

/// Past the regular expression that starts at `start`, flags aside.
fn skip_regular_expression(text: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    let mut in_class = false;
    while let Some(&b) = text.get(i) {
        match b {
            b'\\' => i += 1,
            b'\n' | b'\r' => return None,
            b'[' => in_class = true,
            b']' => in_class = false,
            b'/' if !in_class => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Past the bracket that closes the one at `open`.
fn skip_balanced(text: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0u32;
    let mut i = open;
    // The last byte that is neither white space nor in a comment: it tells a regular expression from a division.
    let mut last = 0u8;
    while let Some(&b) = text.get(i) {
        match b {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            b'"' | b'\'' => {
                i = skip_string(text, i)?;
                last = b;
                continue;
            }
            b'`' => {
                i = skip_template(text, i)?;
                last = b;
                continue;
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            b'/' if !(is_word_byte(last)
                || matches!(last, b')' | b']' | b'}' | b'"' | b'\'' | b'`')) =>
            {
                i = skip_regular_expression(text, i)?;
                last = b;
                continue;
            }
            _ => {}
        }
        if !is_space(b) {
            last = b;
        }
        i += 1;
    }
    None
}

/// Past the `>` that closes the `<` at `open`, in a type.
fn skip_angle_brackets(text: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0u32;
    let mut i = open;
    while let Some(&b) = text.get(i) {
        match b {
            b'<' => depth += 1,
            // Not the `>` of `=>`.
            b'>' if i > 0 && text[i - 1] == b'=' => {}
            b'>' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(i + 1);
                }
            }
            b'(' | b'[' | b'{' => {
                i = skip_balanced(text, i)?;
                continue;
            }
            b'"' | b'\'' => {
                i = skip_string(text, i)?;
                continue;
            }
            b'`' => {
                i = skip_template(text, i)?;
                continue;
            }
            b'/' if matches!(text.get(i + 1), Some(b'/' | b'*')) => {
                i = skip_trivia(text, i);
                continue;
            }
            b')' | b']' | b'}' | b';' => return None,
            _ => {}
        }
        i += 1;
    }
    None
}

/// Where the type that starts at or after `i` ends: past its last token. `None`: it cannot be told.
fn skip_type(text: &[u8], mut i: usize) -> Option<usize> {
    let mut wants_operand = true;
    let mut open_conditionals = 0u32;
    let mut end = i;
    loop {
        let at = skip_trivia(text, i);
        let Some(&b) = text.get(at) else {
            return (!wants_operand).then_some(end);
        };
        if wants_operand {
            match b {
                b'{' | b'(' | b'[' => {
                    i = skip_balanced(text, at)?;
                    wants_operand = false;
                }
                // The type parameters of a function type.
                b'<' => i = skip_angle_brackets(text, at)?,
                b'"' | b'\'' => {
                    i = skip_string(text, at)?;
                    wants_operand = false;
                }
                b'`' => {
                    i = skip_template(text, at)?;
                    wants_operand = false;
                }
                b'|' | b'&' | b'-' => i = at + 1,
                _ if is_word_byte(b) => {
                    let word = word_at(text, at);
                    i = at + word.len();
                    let next = skip_trivia(text, i);
                    wants_operand = match word {
                        b"keyof" | b"typeof" | b"readonly" | b"unique" | b"infer" | b"new"
                        | b"abstract" => true,
                        b"asserts" => {
                            !has_line_break(text, i, next)
                                && text.get(next).is_some_and(|&n| is_word_byte(n))
                        }
                        _ => false,
                    };
                }
                _ => return None,
            }
            end = i;
            continue;
        }
        let is_on_the_same_line = !has_line_break(text, end, at);
        match b {
            b'.' => {
                i = at + 1;
                wants_operand = true;
            }
            b'<' if is_on_the_same_line => i = skip_angle_brackets(text, at)?,
            b'[' if is_on_the_same_line => i = skip_balanced(text, at)?,
            b'(' if text[..end].ends_with(b"import") => i = skip_balanced(text, at)?,
            b'|' | b'&' => {
                i = at + 1;
                wants_operand = true;
            }
            b'=' if text.get(at + 1) == Some(&b'>') => {
                i = at + 2;
                wants_operand = true;
            }
            b'?' => {
                open_conditionals += 1;
                i = at + 1;
                wants_operand = true;
            }
            b':' if open_conditionals > 0 => {
                open_conditionals -= 1;
                i = at + 1;
                wants_operand = true;
            }
            _ if word_at(text, at) == b"extends"
                || is_on_the_same_line && word_at(text, at) == b"is" =>
            {
                i = at + word_at(text, at).len();
                wants_operand = true;
            }
            _ => return Some(end),
        }
        if !wants_operand {
            end = i;
        }
    }
}

/// Where the signature of `f` ends as it is written: past the `)` of the parameters, or past the return type.
fn end_of_signature(hir: &hir::File, f: FnId) -> Option<usize> {
    let (text, func) = (&hir.text[..], &hir[f]);
    if func.kind == FnKind::Arrow || text.get(func.anchor as usize) != Some(&b'(') {
        return None;
    }
    let close = skip_balanced(text, func.anchor as usize)?;
    let next = skip_trivia(text, close);
    if text.get(next) == Some(&b':') {
        skip_type(text, next + 1)
    } else {
        Some(close)
    }
}

/// The `{` of the body of `f` as it is written. Where a body is out of place (`abstract m() {}`, `declare function f() {}`) the summary
/// does not keep it.
fn written_body(hir: &hir::File, f: FnId) -> Option<usize> {
    let (text, func) = (&hir.text[..], &hir[f]);
    let end = if func.kind == FnKind::Arrow {
        let arrow = func.anchor as usize;
        if !text
            .get(arrow..)
            .is_some_and(|rest| rest.starts_with(b"=>"))
        {
            return None;
        }
        arrow + 2
    } else {
        end_of_signature(hir, f)?
    };
    let at = skip_trivia(text, end);
    (text.get(at) == Some(&b'{')).then_some(at)
}

/// `NodeIsPresent(node.Body())`
fn has_written_body(hir: &hir::File, f: FnId) -> bool {
    !matches!(hir[f].body, FnBody::None) || written_body(hir, f).is_some()
}

/// Where the leading `this` parameter of `f` is, if it has one.
fn this_parameter(hir: &hir::File, f: FnId) -> Option<u32> {
    let (text, func) = (&hir.text[..], &hir[f]);
    if func.kind == FnKind::Arrow || text.get(func.anchor as usize) != Some(&b'(') {
        return None;
    }
    let at = skip_trivia(text, func.anchor as usize + 1);
    (word_at(text, at) == b"this").then_some(at as u32)
}

/// The `?` after the name or the pattern `pat` of a parameter.
fn question_token(hir: &hir::File, pat: PatId) -> Option<u32> {
    let text = &hir.text[..];
    let start = hir[pat].pos as usize;
    let end = match hir[pat].kind {
        PatKind::Ident(_) => start + word_at(text, start).len(),
        PatKind::Object(_) | PatKind::Array(_) => skip_balanced(text, start)?,
        PatKind::Missing => return None,
    };
    let at = skip_trivia(text, end);
    (end > start && text.get(at) == Some(&b'?')).then_some(at as u32)
}

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax: told
/// apart by the code, going by which of them parser.go and scanner.go say of a TypeScript file while it is parsed. Not among them: what
/// they only say of JavaScript (1206) or of a regular expression, which is scanned for its errors by the checker, and 1359 2427 2457,
/// which the binder and the checker say more often, and 18016: the parser's own sets `hir.has_parse_diagnostics`, one that is left in
/// `early_errors` without it is `checkGrammarObjectLiteralExpression`'s.
pub(super) fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.early_errors.iter().any(|e| {
            matches!(
                e.1,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1084 | 1109 | 1110 | 1121 | 1124..=1132 | 1134..=1140 | 1142
                    | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1228 | 1260 | 1327 | 1328 | 1351..=1353
                    | 1357 | 1381 | 1382 | 1385..=1390 | 1433..=1443 | 1453 | 1472 | 1477 | 1478 | 1486..=1490 | 2657 | 2754 | 2809
                    | 2819 | 2880 | 6188 | 6189 | 17002 | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

/// Whether `checkGrammarModifiers` objected to a modifier of what is named at `name`: something was said of a word before it, with
/// nothing but modifiers and keywords in between.
fn has_modifier_error(hir: &hir::File, name: u32) -> bool {
    let text = &hir.text[..];
    hir.early_errors.iter().any(|&(at, _)| {
        let mut i = at as usize;
        if at >= name {
            return false;
        }
        loop {
            i = skip_trivia(text, i);
            if i >= name as usize {
                return i == name as usize;
            }
            if text.get(i) == Some(&b'*') {
                i += 1;
                continue;
            }
            let word = word_at(text, i);
            if !matches!(
                word,
                b"public"
                    | b"private"
                    | b"protected"
                    | b"static"
                    | b"abstract"
                    | b"override"
                    | b"readonly"
                    | b"declare"
                    | b"async"
                    | b"accessor"
                    | b"export"
                    | b"default"
                    | b"function"
                    | b"get"
                    | b"set"
                    | b"const"
                    | b"in"
                    | b"out"
            ) {
                return false;
            }
            i += word.len();
        }
    })
}

// ───────────────────────────── the grammar of signatures ─────────────────────────────

/// `checkGrammarTypeParameterList`: `<>`, which the summary has nothing of. (Not before an arrow function, where the parser refuses it.)
fn check_grammar_type_parameter_list(hir: &hir::File, f: FnId, out: &mut Vec<Diagnostic>) -> bool {
    let (text, func) = (&hir.text[..], &hir[f]);
    if !func.type_params.is_empty()
        || func.kind == FnKind::Arrow
        || text.get(func.anchor as usize) != Some(&b'(')
    {
        return false;
    }
    let close = skip_trivia_back(text, func.anchor as usize);
    if !text[..close].ends_with(b">") {
        return false;
    }
    let open = skip_trivia_back(text, close - 1);
    if !text[..open].ends_with(b"<") {
        return false;
    }
    out.push(Diagnostic {
        start: open as u32 - 1,
        code: 1098,
    });
    true
}

/// `checkGrammarParameterList`. Whether it objects to anything that ends the checks of the signature.
fn check_grammar_parameter_list(hir: &hir::File, f: FnId, out: &mut Vec<Diagnostic>) -> bool {
    let (text, func) = (&hir.text[..], &hir[f]);
    let count = func.params.len();
    let mut seen_optional = false;
    for (i, p) in func.params.iter().enumerate() {
        let param = &hir[p];
        let name = hir[param.pat].pos;
        let question = question_token(hir, param.pat);
        if param.flags.contains(Flags::REST) {
            if i != count - 1 {
                let dots = skip_trivia_back(text, name as usize);
                if !text[..dots].ends_with(b"...") {
                    return false;
                }
                out.push(Diagnostic {
                    start: dots as u32 - 3,
                    code: 1014,
                });
                return true;
            }
            // Whether a signature without a body is ambient is not always known. One with a body is not.
            if !matches!(func.body, FnBody::None)
                && func.kind != FnKind::Arrow
                && text.get(func.anchor as usize) == Some(&b'(')
                && let Some(close) = skip_balanced(text, func.anchor as usize)
            {
                let comma = skip_trivia_back(text, close - 1);
                if text[..comma].ends_with(b",") {
                    out.push(Diagnostic {
                        start: comma as u32 - 1,
                        code: 1013,
                    });
                }
            }
            if let Some(start) = question {
                out.push(Diagnostic { start, code: 1047 });
                return true;
            }
            if param.default.is_some() {
                out.push(Diagnostic {
                    start: name,
                    code: 1048,
                });
                return true;
            }
        } else if question.is_some() || param.flags.contains(Flags::OPTIONAL) {
            seen_optional = true;
            if param.default.is_some() {
                out.push(Diagnostic {
                    start: name,
                    code: 1015,
                });
                return true;
            }
        } else if seen_optional && param.default.is_none() {
            out.push(Diagnostic {
                start: name,
                code: 1016,
            });
            return true;
        }
    }
    false
}

/// `checkGrammarArrowFunction`. `is_reserved`: the file is `.mts` or `.cts`, where `<T>() => x` could be taken for JSX.
fn check_grammar_arrow_function(
    hir: &hir::File,
    f: FnId,
    is_reserved: bool,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let (text, func) = (&hir.text[..], &hir[f]);
    if func.kind != FnKind::Arrow {
        return false;
    }
    if is_reserved && func.type_params.len() == 1 {
        let first = &hir[func.type_params.at(0)];
        let mut end = Some(first.pos as usize + word_at(text, first.pos as usize).len());
        if first.default.is_some() {
            end = end
                .map(|end| skip_trivia(text, end))
                .filter(|&equals| text.get(equals) == Some(&b'='))
                .and_then(|equals| skip_type(text, equals + 1));
        }
        if first.constraint.is_none()
            && let Some(end) = end
            && text.get(skip_trivia(text, end)) == Some(&b'>')
        {
            out.push(Diagnostic {
                start: start_with_modifiers(text, first.pos, first.flags, TYPE_PARAMETER_MODIFIERS),
                code: 7060,
            });
        }
    }
    // A line ends between what comes before the arrow and the arrow.
    let arrow = func.anchor as usize;
    if !text
        .get(arrow..)
        .is_some_and(|rest| rest.starts_with(b"=>"))
    {
        return false;
    }
    let mut i = arrow;
    let is_on_a_new_line = loop {
        while i > 0 && matches!(text[i - 1], b' ' | b'\t') {
            i -= 1;
        }
        if i > 0 && matches!(text[i - 1], b'\n' | b'\r') {
            break true;
        }
        match text[..i]
            .ends_with(b"*/")
            .then(|| text[..i - 2].windows(2).rposition(|w| w == b"/*"))
            .flatten()
        {
            Some(open) if has_line_break(text, open, i) => break true,
            Some(open) => i = open,
            None => break false,
        }
    };
    if is_on_a_new_line {
        out.push(Diagnostic {
            start: func.anchor,
            code: 1200,
        });
    }
    is_on_a_new_line
}

/// `FindUseStrictPrologue`, of the block that opens at `open`.
fn use_strict_prologue(text: &[u8], open: usize) -> Option<u32> {
    let mut i = open + 1;
    loop {
        let at = skip_trivia(text, i);
        if !matches!(text.get(at), Some(b'"' | b'\'')) {
            return None;
        }
        let end = skip_string(text, at)?;
        // Only a statement that is nothing but the string is a directive.
        let next = skip_trivia(text, end);
        match text.get(next) {
            Some(b';') => i = next + 1,
            Some(b'}') | None => i = next,
            Some(&b) if has_line_break(text, end, next) => {
                let goes_on = if is_word_byte(b) {
                    matches!(word_at(text, next), b"in" | b"instanceof")
                } else {
                    !matches!(b, b'"' | b'\'' | b'{' | b'@' | b'#')
                };
                if goes_on {
                    return None;
                }
                i = next;
            }
            Some(_) => return None,
        }
        if matches!(&text[at..end], b"\"use strict\"" | b"'use strict'") {
            return Some(at as u32);
        }
    }
}

/// `checkGrammarForUseStrictSimpleParameterList`
fn check_use_strict_with_simple_parameters(
    hir: &hir::File,
    f: FnId,
    out: &mut Vec<Diagnostic>,
) -> bool {
    let func = &hir[f];
    let is_simple = |p: ParamId| {
        hir[p].default.is_none()
            && matches!(hir[hir[p].pat].kind, PatKind::Ident(_))
            && !hir[p].flags.contains(Flags::REST)
    };
    if func.params.iter().all(is_simple) {
        return false;
    }
    let Some(directive) =
        written_body(hir, f).and_then(|open| use_strict_prologue(&hir.text, open))
    else {
        return false;
    };
    out.extend(
        func.params
            .iter()
            .filter(|&p| !is_simple(p))
            .map(|p| Diagnostic {
                start: hir[p].pos,
                code: 1346,
            }),
    );
    out.push(Diagnostic {
        start: directive,
        code: 1347,
    });
    true
}

/// `checkGrammarForGenerator`. `name`: where the name is, which the `*` comes before.
fn check_grammar_generator(
    hir: &hir::File,
    f: FnId,
    name: u32,
    is_ambient: bool,
    out: &mut Vec<Diagnostic>,
) -> bool {
    if !hir[f].flags.contains(Flags::GENERATOR) {
        return false;
    }
    let asterisk = skip_trivia_back(&hir.text, name as usize);
    if !hir.text[..asterisk].ends_with(b"*") {
        return false;
    }
    let code = if is_ambient {
        1221
    } else if !has_written_body(hir, f) {
        1222
    } else {
        return false;
    };
    out.push(Diagnostic {
        start: asterisk as u32 - 1,
        code,
    });
    true
}

// ───────────────────────────── namespaces ─────────────────────────────

/// `ModuleInstanceState`, numbered as it is there: where two are compared, it is by number.
const UNKNOWN_STATE: u8 = 0;
const NON_INSTANTIATED: u8 = 1;
const INSTANTIATED: u8 = 2;
const CONST_ENUM_ONLY: u8 = 3;

/// `GetModuleInstanceState`
fn module_instance_state(hir: &hir::File, bound: &Bound, m: ModuleId) -> u8 {
    body_instance_state(hir, bound, m, &mut Vec::new())
}

/// `getModuleInstanceStateCached`, of the body of `m`. `visited`: the bodies that have been asked about. One that is asked about
/// while it is being looked at is not instantiated on that account. (A statement can only lead back to itself through a body.)
fn body_instance_state(
    hir: &hir::File,
    bound: &Bound,
    m: ModuleId,
    visited: &mut Vec<(ModuleId, u8)>,
) -> u8 {
    if !hir[m].has_body {
        return INSTANTIATED;
    }
    if let Some(&(_, state)) = visited.iter().find(|v| v.0 == m) {
        return if state == UNKNOWN_STATE {
            NON_INSTANTIATED
        } else {
            state
        };
    }
    let slot = visited.len();
    visited.push((m, UNKNOWN_STATE));
    let mut state = NON_INSTANTIATED;
    for s in hir.ids(hir[m].body) {
        match statement_instance_state(hir, bound, s, visited) {
            INSTANTIATED => {
                state = INSTANTIATED;
                break;
            }
            CONST_ENUM_ONLY => state = CONST_ENUM_ONLY,
            _ => {}
        }
    }
    visited[slot].1 = state;
    state
}

/// `getModuleInstanceStateWorker`, of a statement.
fn statement_instance_state(
    hir: &hir::File,
    bound: &Bound,
    s: StmtId,
    visited: &mut Vec<(ModuleId, u8)>,
) -> u8 {
    match hir[s].kind {
        StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Import(_) => NON_INSTANTIATED,
        StmtKind::Enum(e) if hir[e].flags.contains(Flags::CONST) => CONST_ENUM_ONLY,
        StmtKind::ImportEquals(i) if !hir[i].flags.contains(Flags::EXPORT) => NON_INSTANTIATED,
        StmtKind::ExportNamed(e) if hir[e].spec.is_none() => {
            let mut state = NON_INSTANTIATED;
            for item in hir[e].items.iter() {
                state = state.max(alias_target_instance_state(
                    hir,
                    bound,
                    hir[item].local,
                    s,
                    visited,
                ));
                if state == INSTANTIATED {
                    break;
                }
            }
            state
        }
        StmtKind::Module(inner) => body_instance_state(hir, bound, inner, visited),
        _ => INSTANTIATED,
    }
}

/// `NodeHasName`
fn statement_has_name(hir: &hir::File, s: StmtId, name: Atom) -> bool {
    match hir[s].kind {
        StmtKind::Fn(f) => hir[f].name == name,
        StmtKind::Class(c) => hir[c].name == name,
        StmtKind::Interface(i) => hir[i].name == name,
        StmtKind::TypeAlias(a) => hir[a].name == name,
        StmtKind::Enum(e) => hir[e].name == name,
        StmtKind::Module(m) => hir[m].name == ModuleName::Ident(name),
        StmtKind::ImportEquals(i) => hir[i].name == name,
        StmtKind::Var(decls) => decls
            .iter()
            .any(|d| matches!(hir[hir[d].pat].kind, PatKind::Ident(n) if n == name)),
        _ => false,
    }
}

/// `getModuleInstanceStateForAliasTarget`: of what `export { name }`, the statement `from`, exports.
fn alias_target_instance_state(
    hir: &hir::File,
    bound: &Bound,
    name: Atom,
    from: StmtId,
    visited: &mut Vec<(ModuleId, u8)>,
) -> u8 {
    let mut parent = bound.stmt_parent[from.idx()];
    loop {
        let list = match parent {
            Parent::Module(m) => hir[m].body,
            Parent::File => hir.body,
            Parent::Stmt(s) if s.is_some() => match hir[s].kind {
                StmtKind::Block(list) => list,
                _ => {
                    parent = bound.stmt_parent[s.idx()];
                    continue;
                }
            },
            _ => return INSTANTIATED,
        };
        let mut found = None;
        for s in hir.ids(list) {
            if !statement_has_name(hir, s, name) {
                continue;
            }
            let state = statement_instance_state(hir, bound, s, visited);
            if found.is_none_or(|known| state > known) {
                found = Some(state);
            }
            if found == Some(INSTANTIATED) {
                return INSTANTIATED;
            }
            // What an alias that is exported again stands for is not looked into.
            if matches!(hir[s].kind, StmtKind::ImportEquals(_)) {
                found = Some(INSTANTIATED);
            }
        }
        if let Some(found) = found {
            return found;
        }
        parent = match parent {
            Parent::Module(m) => match hir
                .stmts
                .iter()
                .position(|s| matches!(s.kind, StmtKind::Module(x) if x == m))
            {
                Some(s) => bound.stmt_parent[s],
                None => return INSTANTIATED,
            },
            Parent::Stmt(s) => bound.stmt_parent[s.idx()],
            _ => return INSTANTIATED,
        };
    }
}

// ───────────────────────────── what a block declares ─────────────────────────────

const FUNCTION_SCOPED_VARIABLE: u32 = 1 << 0;
const BLOCK_SCOPED_VARIABLE: u32 = 1 << 1;
const FUNCTION: u32 = 1 << 2;
const CLASS: u32 = 1 << 3;
const INTERFACE: u32 = 1 << 4;
const CONST_ENUM: u32 = 1 << 5;
const REGULAR_ENUM: u32 = 1 << 6;
const VALUE_MODULE: u32 = 1 << 7;
const NAMESPACE_MODULE: u32 = 1 << 8;
const TYPE_ALIAS: u32 = 1 << 9;
const ALIAS: u32 = 1 << 10;
/// What the local symbol of an exported value is marked with: it goes with everything.
const EXPORT_VALUE: u32 = 1 << 11;
const VALUE: u32 = FUNCTION_SCOPED_VARIABLE
    | BLOCK_SCOPED_VARIABLE
    | FUNCTION
    | CLASS
    | CONST_ENUM
    | REGULAR_ENUM
    | VALUE_MODULE;
const TYPE: u32 = CLASS | INTERFACE | CONST_ENUM | REGULAR_ENUM | TYPE_ALIAS;

/// `DeclarationSpaces`
const SPACE_VALUE: u8 = 1;
const SPACE_TYPE: u8 = 2;
const SPACE_NAMESPACE: u8 = 4;

/// A list of statements that has a table of locals of its own.
#[derive(Copy, Clone)]
struct Block {
    file: FileId,
    list: IdList<StmtId>,
    /// The namespace it is the body of. `NONE` for a file, the body of a function, a block.
    module: ModuleId,
    /// It is the body of a module or a namespace: what is declared in it can be exported.
    has_exports: bool,
    is_ambient: bool,
    /// `NodeFlagsExportContext`: ambient, and without an `export { }` or an `export =`: everything in it is exported.
    is_export_context: bool,
    is_global_augmentation: bool,
}

/// `hasExportDeclarations`
fn has_export_declarations(hir: &hir::File, list: IdList<StmtId>) -> bool {
    hir.ids(list).any(|s| {
        matches!(
            hir[s].kind,
            StmtKind::ExportNamed(_)
                | StmtKind::ExportStar { .. }
                | StmtKind::ExportAssign(_)
                | StmtKind::ExportDefault(_)
        )
    })
}

impl Block {
    fn plain(file: FileId, list: IdList<StmtId>, has_exports: bool) -> Block {
        Block {
            file,
            list,
            module: ModuleId::NONE,
            has_exports,
            is_ambient: false,
            is_export_context: false,
            is_global_augmentation: false,
        }
    }

    /// `setExportContextFlag` for the source file. `bindSourceFileIfExternalModule` calls it for scripts and modules alike, and
    /// every node of a declaration file is ambient.
    fn from_source_file(hir: &hir::File, file: FileId, has_exports: bool) -> Block {
        let is_ambient = hir.kind == FileKind::Declaration;
        Block {
            is_ambient,
            is_export_context: is_ambient && !has_export_declarations(hir, hir.body),
            ..Block::plain(file, hir.body, has_exports)
        }
    }

    /// `setExportContextFlag`
    fn of_module(hir: &hir::File, file: FileId, m: ModuleId) -> Block {
        let module = &hir[m];
        let is_ambient = module.flags.contains(Flags::AMBIENT)
            || hir.kind == FileKind::Declaration
            || !matches!(module.name, ModuleName::Ident(_));
        Block {
            file,
            list: module.body,
            module: m,
            has_exports: true,
            is_ambient,
            is_export_context: is_ambient && !has_export_declarations(hir, module.body),
            is_global_augmentation: module.name == ModuleName::Global,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DeclaredAs {
    Function,
    /// A variable, a class, an interface, a type alias, an enum, a namespace: what `checkExportsOnMergedDeclarations` is called for.
    Other,
    ImportSpecifier,
    /// `import a`, `import * as a`, `import a = b`: it takes up the room of what it stands for.
    Alias,
}

/// One declaration of a name in a block.
#[derive(Copy, Clone)]
struct Declared {
    name: Atom,
    /// Where the name is written.
    at: u32,
    what: DeclaredAs,
    is_variable: bool,
    /// `EXPORT`, `DEFAULT` and `AMBIENT`, as `getEffectiveDeclarationFlags` has them.
    flags: Flags,
    /// `declareModuleMember` gives it a symbol among the exports besides the local one.
    is_exported: bool,
    /// What it makes of its name, and what that does not go with.
    includes: u32,
    excludes: u32,
    spaces: u8,
    /// Of a function.
    has_body: bool,
}

/// How a declaration is written in its block.
#[derive(Copy, Clone)]
struct Written {
    /// The block is its parent, not just somewhere around it.
    is_child_of_block: bool,
    /// It says `declare` itself.
    says_declare: bool,
}

/// Whether the statement `s` says `declare` itself, whatever it is written in.
fn says_declare(hir: &hir::File, s: StmtId) -> bool {
    let text = &hir.text[..];
    // A statement is said to start at its `export`, or else past its `declare`.
    let start = hir[s].pos as usize;
    let past_export = if word_at(text, start) == b"export" {
        skip_trivia(text, start + 6)
    } else {
        start
    };
    word_at(text, past_export) == b"declare"
        || word_before(text, skip_trivia_back(text, start)) == b"declare"
}

/// `own`: the modifiers of the declaration, and what it inherits.
fn declaration(
    block: &Block,
    name: Atom,
    at: u32,
    own: Flags,
    written: Written,
    (includes, excludes, spaces): (u32, u32, u8),
) -> Declared {
    let mut flags = own & (Flags::EXPORT | Flags::DEFAULT);
    if block.is_ambient || own.contains(Flags::AMBIENT) {
        if block.is_export_context
            && !written.says_declare
            && !(written.is_child_of_block && block.is_global_augmentation)
        {
            flags |= Flags::EXPORT;
        }
        flags |= Flags::AMBIENT;
    }
    Declared {
        name,
        at,
        what: DeclaredAs::Other,
        is_variable: false,
        flags,
        is_exported: block.has_exports
            && includes != ALIAS
            && (own.contains(Flags::EXPORT) || block.is_export_context),
        includes,
        excludes,
        spaces,
        has_body: false,
    }
}

fn names_bound_by(hir: &hir::File, pat: PatId, into: &mut Vec<(Atom, u32)>) {
    match hir[pat].kind {
        PatKind::Ident(name) => into.push((name, hir[pat].pos)),
        PatKind::Object(props) => props
            .iter()
            .for_each(|p| names_bound_by(hir, hir[p].value, into)),
        PatKind::Array(elems) => elems
            .iter()
            .for_each(|e| names_bound_by(hir, hir[e].pat, into)),
        PatKind::Missing => {}
    }
}

/// What the statement `s` puts in the table of locals of `block`. Not `is_at_the_top`: it is inside a statement of the block, from where
/// only `var` gets there.
fn declared_by_statement(
    hir: &hir::File,
    bound: &Bound,
    block: &Block,
    s: StmtId,
    is_at_the_top: bool,
    all: &mut Vec<Declared>,
) {
    if s.is_none() {
        return;
    }
    let within = |list: &[StmtId], all: &mut Vec<Declared>| {
        list.iter()
            .for_each(|&x| declared_by_statement(hir, bound, block, x, false, all))
    };
    // Only where everything is exported does it matter who says `declare`.
    let child = Written {
        is_child_of_block: true,
        says_declare: block.is_export_context && says_declare(hir, s),
    };
    let inside = Written {
        is_child_of_block: false,
        ..child
    };
    match hir[s].kind {
        StmtKind::Var(decls) => {
            let mut names = Vec::new();
            for d in decls.iter() {
                let decl = &hir[d];
                let table = match decl.kind {
                    VarKind::Var => (
                        FUNCTION_SCOPED_VARIABLE,
                        VALUE & !FUNCTION_SCOPED_VARIABLE,
                        SPACE_VALUE,
                    ),
                    _ if !is_at_the_top => continue,
                    _ => (BLOCK_SCOPED_VARIABLE, VALUE, SPACE_VALUE),
                };
                names.clear();
                names_bound_by(hir, decl.pat, &mut names);
                for &(name, at) in &names {
                    all.push(Declared {
                        is_variable: true,
                        ..declaration(block, name, at, decl.flags, inside, table)
                    });
                }
            }
        }
        StmtKind::Block(list) => hir
            .ids(list)
            .for_each(|x| declared_by_statement(hir, bound, block, x, false, all)),
        StmtKind::If { yes, no, .. } => within(&[yes, no], all),
        StmtKind::For { init, body, .. } => within(&[init, body], all),
        StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. } => {
            within(&[left, body], all)
        }
        StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. }
        | StmtKind::Labeled { body, .. } => within(&[body], all),
        StmtKind::Switch { cases, .. } => {
            for case in cases.iter() {
                hir.ids(hir[case].body)
                    .for_each(|x| declared_by_statement(hir, bound, block, x, false, all));
            }
        }
        StmtKind::Try {
            block: tried,
            handler,
            finalizer,
            ..
        } => within(&[tried, handler, finalizer], all),
        _ if !is_at_the_top => {}
        StmtKind::Fn(f) if hir[f].name.is_some() => {
            let table = (
                FUNCTION,
                VALUE & !(FUNCTION | VALUE_MODULE | CLASS),
                SPACE_VALUE,
            );
            all.push(Declared {
                what: DeclaredAs::Function,
                has_body: has_written_body(hir, f),
                ..declaration(
                    block,
                    hir[f].name,
                    hir[f].name_pos,
                    hir[f].flags,
                    child,
                    table,
                )
            });
        }
        StmtKind::Class(c) if hir[c].name.is_some() => {
            let table = (
                CLASS,
                (VALUE | TYPE) & !(VALUE_MODULE | INTERFACE | FUNCTION),
                SPACE_TYPE | SPACE_VALUE,
            );
            all.push(declaration(
                block,
                hir[c].name,
                hir[c].name_pos,
                hir[c].flags,
                child,
                table,
            ));
        }
        StmtKind::Interface(i) => {
            all.push(declaration(
                block,
                hir[i].name,
                hir[i].name_pos,
                hir[i].flags,
                child,
                (INTERFACE, TYPE & !(INTERFACE | CLASS), SPACE_TYPE),
            ));
        }
        StmtKind::TypeAlias(a) => all.push(declaration(
            block,
            hir[a].name,
            hir[a].name_pos,
            hir[a].flags,
            child,
            (TYPE_ALIAS, TYPE, SPACE_TYPE),
        )),
        StmtKind::Enum(e) => {
            let table = if hir[e].flags.contains(Flags::CONST) {
                (
                    CONST_ENUM,
                    (VALUE | TYPE) & !CONST_ENUM,
                    SPACE_TYPE | SPACE_VALUE,
                )
            } else {
                (
                    REGULAR_ENUM,
                    (VALUE | TYPE) & !(REGULAR_ENUM | VALUE_MODULE),
                    SPACE_TYPE | SPACE_VALUE,
                )
            };
            all.push(declaration(
                block,
                hir[e].name,
                hir[e].name_pos,
                hir[e].flags,
                child,
                table,
            ));
        }
        StmtKind::Module(m) => {
            let ModuleName::Ident(name) = hir[m].name else {
                return;
            };
            let table = if module_instance_state(hir, bound, m) != NON_INSTANTIATED {
                (
                    VALUE_MODULE,
                    VALUE & !(FUNCTION | CLASS | REGULAR_ENUM | VALUE_MODULE),
                    SPACE_NAMESPACE | SPACE_VALUE,
                )
            } else {
                (NAMESPACE_MODULE, 0, SPACE_NAMESPACE)
            };
            all.push(declaration(
                block,
                name,
                hir[m].name_pos,
                hir[m].flags,
                child,
                table,
            ));
        }
        StmtKind::Import(i) => {
            let import = &hir[i];
            for (name, at) in [
                (import.default, import.default_pos),
                (import.namespace, import.namespace_pos),
            ] {
                if name.is_some() {
                    all.push(Declared {
                        what: DeclaredAs::Alias,
                        ..declaration(block, name, at, Flags::empty(), inside, (ALIAS, ALIAS, 0))
                    });
                }
            }
            for spec in import.named.iter() {
                let table = (ALIAS, ALIAS, SPACE_VALUE);
                all.push(Declared {
                    what: DeclaredAs::ImportSpecifier,
                    ..declaration(
                        block,
                        hir[spec].local,
                        hir[spec].pos,
                        Flags::empty(),
                        inside,
                        table,
                    )
                });
            }
        }
        // One that is exported goes straight to the exports.
        StmtKind::ImportEquals(i) if !hir[i].flags.contains(Flags::EXPORT) => {
            all.push(Declared {
                what: DeclaredAs::Alias,
                ..declaration(
                    block,
                    hir[i].name,
                    hir[i].name_pos,
                    hir[i].flags,
                    child,
                    (ALIAS, ALIAS, 0),
                )
            });
        }
        _ => {}
    }
}

/// What the statements of `block` declare, in the order the binder gets to them: `bindEachStatementFunctionsFirst`.
fn declared_in_block(hir: &hir::File, bound: &Bound, block: &Block) -> Vec<Declared> {
    let mut all = Vec::new();
    for functions in [true, false] {
        for s in hir.ids(block.list) {
            if matches!(hir[s].kind, StmtKind::Fn(_)) == functions {
                declared_by_statement(hir, bound, block, s, true, &mut all);
            }
        }
    }
    all
}

/// `declareSymbolEx`: calls `f` with the declarations of each name that has several, those that end up as one symbol in the table, and
/// whether any was refused. `as_locals`: it is the table of locals, where what is exported only leaves a mark.
fn for_each_symbol(all: &[Declared], as_locals: bool, mut f: impl FnMut(&[usize], bool)) {
    let mut order: Vec<usize> = (0..all.len()).collect();
    order.sort_by_key(|&i| all[i].name);
    let mut group = Vec::new();
    let mut start = 0;
    while start < order.len() {
        let name = all[order[start]].name;
        let end = start
            + order[start..]
                .iter()
                .take_while(|&&i| all[i].name == name)
                .count();
        if end - start > 1 {
            group.clear();
            let (mut flags, mut is_any_refused) = (0, false);
            for &i in &order[start..end] {
                let d = &all[i];
                if flags & d.excludes != 0 {
                    is_any_refused = true;
                    continue;
                }
                flags |= match as_locals && d.is_exported {
                    true if d.includes & VALUE != 0 => EXPORT_VALUE,
                    true => 0,
                    false => d.includes,
                };
                group.push(i);
            }
            f(&group, is_any_refused);
        }
        start = end;
    }
}

// ───────────────────────────── overloads ─────────────────────────────

/// One declaration of a symbol that functions, methods or constructors declare.
#[derive(Copy, Clone)]
struct Overload {
    file: FileId,
    /// What it is written directly in.
    parent: (FileId, u32, u32),
    /// Where an error about it goes: its name, or where a constructor starts.
    at: u32,
    flags: Flags,
    is_optional: bool,
    /// As opposed to whatever else shares the symbol: a namespace, a class, an interface.
    is_function: bool,
    has_body: bool,
}

/// `getCanonicalOverload`
fn canonical_overload(first: Overload, implementation: Option<Overload>) -> Overload {
    match implementation {
        Some(implementation) if implementation.parent == first.parent => implementation,
        _ => first,
    }
}

/// `checkFlagAgreementBetweenOverloads` and `checkQuestionTokenAgreementBetweenOverloads`, as `checkFunctionOrConstructorSymbolWorker`
/// calls them for the declarations `all` of a symbol. What is said about `file` is kept.
fn check_overloads_agree(file: FileId, all: &[Overload], out: &mut Vec<Diagnostic>) {
    const CHECKED: Flags = Flags::EXPORT
        .union(Flags::AMBIENT)
        .union(Flags::PRIVATE)
        .union(Flags::PROTECTED)
        .union(Flags::ABSTRACT);
    let (mut some, mut every) = (Flags::empty(), CHECKED);
    let (mut is_some_optional, mut is_every_optional) = (false, true);
    let mut has_overloads = false;
    let mut implementation = None;
    for o in all.iter().filter(|o| o.is_function) {
        some |= o.flags & CHECKED;
        every &= o.flags;
        is_some_optional |= o.is_optional;
        is_every_optional &= o.is_optional;
        if !o.has_body {
            has_overloads = true;
        } else if implementation.is_none() {
            implementation = Some(*o);
        }
    }
    let (Some(&first), Some(&first_here)) = (all.first(), all.iter().find(|o| o.file == file))
    else {
        return;
    };
    if !has_overloads {
        return;
    }
    if some != every {
        let canonical = canonical_overload(first, implementation).flags & CHECKED;
        let canonical_here = canonical_overload(first_here, implementation).flags & CHECKED;
        for o in all.iter().filter(|o| o.file == file) {
            let deviation = (o.flags & CHECKED) ^ canonical;
            let deviation_here = (o.flags & CHECKED) ^ canonical_here;
            let code = if deviation_here.contains(Flags::EXPORT) {
                2383
            } else if deviation_here.contains(Flags::AMBIENT) {
                2384
            } else if deviation.intersects(Flags::PRIVATE | Flags::PROTECTED) {
                2385
            } else if deviation.contains(Flags::ABSTRACT) {
                2512
            } else {
                continue;
            };
            out.push(Diagnostic { start: o.at, code });
        }
    }
    if is_some_optional != is_every_optional {
        let canonical = canonical_overload(first, implementation).is_optional;
        out.extend(
            all.iter()
                .filter(|o| o.file == file && o.is_optional != canonical)
                .map(|o| Diagnostic {
                    start: o.at,
                    code: 2386,
                }),
        );
    }
}

impl Checker<'_> {
    pub(super) fn check_x_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.has_errors || hir.kind == FileKind::Json {
            return;
        }
        self.check_type_parameter_declarations(file, out);
        self.check_type_parameter_lists(file, out);
        self.check_variance_annotations(file, out);
        self.check_grammar_of_signatures(file, out);
        // `checkSourceFile` checks a declaration file like any other file. The passes after this branch are not enabled for
        // declaration files.
        if hir.kind == FileKind::Declaration {
            self.check_declarations_of_blocks(file, out);
            return;
        }
        self.check_parameters_of_signatures(file, out);
        self.check_abstract_members_and_accessor_pairs(file, out);
        self.check_type_predicates(file, out);
        self.check_generator_return_types(file, out);
        self.check_async_functions_and_awaits(file, out);
        self.check_promise_constructor_is_there(file, out);
        self.check_member_overloads_agree(file, out);
        self.check_declarations_of_blocks(file, out);
        self.check_erasable_syntax(file, out);
    }

    /// Whether `source` is known not to fit `target`.
    fn is_known_not_to_fit(&mut self, source: TypeId, target: TypeId) -> bool {
        if !self.is_known(source) || !self.is_known(target) {
            return false;
        }
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let fits = self.is_assignable(source, target);
        let is_sure = !self.relation_gave_up;
        self.relation_gave_up |= gave_up_before;
        !fits && is_sure
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    /// `checkTypeParameter`: 2716, 2344, 2368.
    fn check_type_parameter_declarations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_defaults = hir.type_params.iter().any(|p| p.default.is_some());
        // In the order they are written: which parameter of a circle is the one to blame depends on where the circle is entered.
        let mut order: Vec<usize> = (0..hir.type_params.len())
            .filter(|&i| bound.type_param_symbol[i].is_some())
            .collect();
        order.sort_by_key(|&i| hir.type_params[i].pos);
        let mut resolution = DefaultResolution::default();
        for i in order {
            let (tp, decl) = (TypeParamId(i as u32), &hir.type_params[i]);
            if has_defaults {
                self.work_out_written_type(file, decl.constraint, &mut resolution, 0);
                self.work_out_written_type(file, decl.default, &mut resolution, 0);
            }
            if decl.default.is_some() {
                self.resolve_type_parameter_default((file, tp), &mut resolution, 0);
                let start = start_of_written_type(&hir.text, hir[decl.default].pos);
                if resolution.states.get(&(file, tp)) == Some(&DefaultState::Circular) {
                    out.push(Diagnostic { start, code: 2716 });
                } else {
                    // `getConstraintOfTypeParameter`: another declaration of a merged class or interface may write the constraint.
                    let param = self.type_param(file, tp);
                    if let (Some(constraint), Some(default)) = (
                        self.constraint_of_type_param(param),
                        self.default_of_type_param(param),
                    ) {
                        let mapper = self.mapper_from(&[param], &[default]);
                        let constraint = self.instantiate(constraint, mapper);
                        let constraint = self.type_with_this_argument(constraint, default);
                        if self.is_known_not_to_fit(default, constraint) {
                            self.report_not_assignable(default, constraint, start, 2344, out);
                        }
                    }
                }
            }
            // `checkTypeNameIsReserved`
            if matches!(
                self.files().atoms.bytes(decl.name),
                b"any"
                    | b"unknown"
                    | b"never"
                    | b"number"
                    | b"bigint"
                    | b"boolean"
                    | b"string"
                    | b"symbol"
                    | b"void"
                    | b"object"
                    | b"undefined"
            ) {
                out.push(Diagnostic {
                    start: decl.pos,
                    code: 2368,
                });
            }
        }
    }

    /// `getResolvedTypeParameterDefault`: one that is asked for while it is being worked out is circular.
    fn resolve_type_parameter_default(
        &mut self,
        param: (FileId, TypeParamId),
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if let Some(state) = resolution.states.get_mut(&param) {
            if *state == DefaultState::Resolving {
                *state = DefaultState::Circular;
            }
            return;
        }
        resolution.states.insert(param, DefaultState::Resolving);
        let default = self.hir(param.0)[param.1].default;
        self.work_out_written_type(param.0, default, resolution, depth + 1);
        if let Some(state) = resolution.states.get_mut(&param)
            && *state == DefaultState::Resolving
        {
            *state = DefaultState::Resolved;
        }
    }

    /// `getTypeFromTypeNode`, for the defaults of type parameters it asks for: those a generic type is named without arguments for
    /// (`fillMissingTypeArguments`). Only what is looked into at once counts: not what is in an object type or a function type, nor
    /// what a type alias stands for, where such a reference waits until it is needed.
    fn work_out_written_type(
        &mut self,
        file: FileId,
        node: TypeNodeId,
        resolution: &mut DefaultResolution,
        depth: u32,
    ) {
        if node.is_none() || depth > 64 || resolution.done.contains(&(file, node)) {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        match hir[node].kind {
            TypeNodeKind::Union(list) | TypeNodeKind::Intersection(list) => {
                for t in hir.ids(list) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
            }
            TypeNodeKind::Array(t) | TypeNodeKind::Keyof(t) | TypeNodeKind::Readonly(t) => {
                self.work_out_written_type(file, t, resolution, depth + 1)
            }
            TypeNodeKind::Tuple(elems) => {
                for e in elems.iter() {
                    self.work_out_written_type(file, hir[e].ty, resolution, depth + 1);
                }
            }
            TypeNodeKind::IndexedAccess { obj, index } => {
                self.work_out_written_type(file, obj, resolution, depth + 1);
                self.work_out_written_type(file, index, resolution, depth + 1);
            }
            TypeNodeKind::Ref { name, args } => {
                for t in hir.ids(args) {
                    self.work_out_written_type(file, t, resolution, depth + 1);
                }
                let names: Vec<Atom> = hir.ids(name).collect();
                let sym = self.files().resolve_entity(
                    file,
                    bound.type_scope[node.idx()],
                    &names,
                    SymFlags::TYPE,
                );
                if let Some(sym) = sym.and_then(|sym| self.files().resolve_alias_if_needed(sym)) {
                    let (least, most) = self.type_argument_arity(sym);
                    if (least..=most).contains(&args.len()) {
                        let params = self.type_params_of_symbol(sym);
                        for &param in params.iter().skip(args.len()) {
                            if let TypeData::TypeParam(of, tp, _) = *self.data(param) {
                                self.resolve_type_parameter_default(
                                    (of, tp),
                                    resolution,
                                    depth + 1,
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        resolution.done.insert((file, node));
    }

    /// `checkTypeParameters` and `checkTypeParametersNotReferenced`: 2706, 2744.
    fn check_type_parameter_lists(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        if !hir.type_params.iter().any(|p| p.default.is_some()) {
            return;
        }
        let lists = hir
            .fns
            .iter()
            .map(|f| f.type_params)
            .chain(hir.classes.iter().map(|c| c.type_params))
            .chain(hir.interfaces.iter().map(|i| i.type_params))
            .chain(hir.aliases.iter().map(|a| a.type_params));
        // Each default, the list it is in and where in the list.
        let mut defaults: Vec<(TypeNodeId, Span<TypeParamId>, usize)> = Vec::new();
        for list in lists {
            if list.is_empty() || bound.type_param_symbol[list.start as usize].is_none() {
                continue;
            }
            let mut seen_default = false;
            for (index, p) in list.iter().enumerate() {
                let decl = &hir[p];
                if decl.default.is_some() {
                    seen_default = true;
                    defaults.push((decl.default, list, index));
                } else if seen_default {
                    out.push(Diagnostic {
                        start: start_with_modifiers(
                            &hir.text,
                            decl.pos,
                            decl.flags,
                            TYPE_PARAMETER_MODIFIERS,
                        ),
                        code: 2706,
                    });
                }
            }
        }
        if defaults.is_empty() {
            return;
        }
        defaults.sort_unstable_by_key(|d| d.0);
        let parents = Self::type_node_parents(hir, bound);
        for t in 0..hir.types.len() {
            let TypeNodeKind::Ref { name, .. } = hir.types[t].kind else {
                continue;
            };
            let scope = bound.type_scope[t];
            if name.len() != 1 || scope.is_none() {
                continue;
            }
            let mut symbol = None;
            // Out through every default it is written in.
            let mut at = TypeNodeId(t as u32);
            while at.is_some() {
                if let Ok(found) = defaults.binary_search_by_key(&at, |d| d.0) {
                    let (_, list, index) = defaults[found];
                    let symbol = *symbol.get_or_insert_with(|| {
                        bound.resolve(scope, hir.id_at(name, 0), SymFlags::TYPE)
                    });
                    if symbol.is_some_and(|symbol| {
                        list.iter()
                            .skip(index)
                            .any(|p| bound.type_param_symbol[p.idx()] == symbol)
                    }) {
                        out.push(Diagnostic {
                            start: hir.types[t].pos,
                            code: 2744,
                        });
                    }
                }
                at = parents[at.idx()];
            }
        }
    }

    /// `checkTypeParameterDeferred`: 2637, 2636.
    fn check_variance_annotations(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_annotations = hir
            .type_params
            .iter()
            .any(|p| p.flags.intersects(Flags::IN | Flags::OUT));
        let mut owners: Vec<(SymbolId, Span<TypeParamId>, bool)> = Vec::new();
        if has_annotations {
            owners.extend(
                hir.aliases
                    .iter()
                    .enumerate()
                    .map(|(a, alias)| (bound.alias_symbol[a], alias.type_params, true)),
            );
        }
        owners.extend(
            hir.classes
                .iter()
                .enumerate()
                .map(|(c, class)| (bound.class_symbol[c], class.type_params, false)),
        );
        owners.extend(
            hir.interfaces
                .iter()
                .enumerate()
                .map(|(i, interface)| (bound.interface_symbol[i], interface.type_params, false)),
        );
        for (symbol, params, is_alias) in owners {
            if symbol.is_none() || params.is_empty() {
                continue;
            }
            // A file without annotations is still checked where a declaration in another file annotates the same type parameter.
            if !has_annotations && !bound.symbols[symbol.idx()].flags.contains(SymFlags::MERGED) {
                continue;
            }
            let sym = self.files().sym(file, symbol);
            // The declarations of a class or an interface share their type parameters, by name.
            let mut lists: Vec<(FileId, Span<TypeParamId>)> = Vec::new();
            if !is_alias {
                for (of, decl) in self.files().decls(sym) {
                    match decl {
                        Decl::Class(c) => lists.push((of, self.hir(of)[c].type_params)),
                        Decl::Interface(i) => lists.push((of, self.hir(of)[i].type_params)),
                        _ => {}
                    }
                }
            }
            for tp in params.iter() {
                let decl = &hir[tp];
                // `getTypeParameterModifiers`: what any of its declarations says.
                let mut modifiers = decl.flags;
                for &(of, list) in &lists {
                    let other = self.hir(of);
                    modifiers = list
                        .iter()
                        .filter(|&p| other[p].name == decl.name)
                        .fold(modifiers, |all, p| all | other[p].flags);
                }
                let modifiers = modifiers & (Flags::IN | Flags::OUT);
                if modifiers.is_empty() {
                    continue;
                }
                let declared = self.declared_type(sym);
                let declared = self.force(declared);
                if !self.is_known(declared) {
                    continue;
                }
                let start =
                    start_with_modifiers(&hir.text, decl.pos, decl.flags, TYPE_PARAMETER_MODIFIERS);
                // `ObjectFlagsAnonymous | ObjectFlagsMapped`
                if is_alias
                    && !matches!(
                        self.data(declared),
                        TypeData::Anon { .. } | TypeData::Fns { .. } | TypeData::Synth(_)
                    )
                {
                    out.push(Diagnostic { start, code: 2637 });
                    continue;
                }
                if modifiers == Flags::IN | Flags::OUT {
                    continue;
                }
                // `createMarkerType`. A reference to a class or an interface takes the outer type parameters first, and one of
                // them may have the same name.
                let own = self.type_param(file, tp);
                let all = if is_alias {
                    self.type_params_of_symbol(sym)
                } else {
                    self.all_type_params_of_symbol(sym)
                };
                let index = all.iter().rposition(|&p| {
                    self.type_param_decl(p)
                        .is_some_and(|(_, d)| d.name == decl.name)
                });
                let mut with = |marker: TypeId| {
                    if is_alias {
                        let mapper = self.mapper_from(&[own], &[marker]);
                        return self.instantiate(declared, mapper);
                    }
                    let mut args = all.to_vec();
                    if let Some(index) = index {
                        args[index] = marker;
                    }
                    self.intern(TypeData::Ref {
                        target: sym,
                        args: args.into(),
                    })
                };
                // The check has its own markers, so a variance measurement never reuses a relation cached here.
                let (sub, sup) = (
                    with(TypeId::MARKER_SUB_FOR_CHECK),
                    with(TypeId::MARKER_SUPER_FOR_CHECK),
                );
                let (source, target) = if modifiers == Flags::OUT {
                    (sub, sup)
                } else {
                    (sup, sub)
                };
                // `reportUnreliableWorker` ignores these markers. `report_unreliable` fires on every marker, so its flags are dropped.
                let reliability = self.reliability;
                let is_wrong = self.is_known_not_to_fit(source, target);
                self.reliability = reliability;
                if is_wrong {
                    out.push(Diagnostic { start, code: 2636 });
                }
            }
        }
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// Whether `f` is a member of a class or of an object literal, as opposed to one of an interface or a type literal.
    fn is_member_with_room_for_a_body(&self, file: FileId, f: FnId) -> bool {
        let bound = self.bound(file);
        match bound.fns[f.idx()].owner {
            FnOwner::Member(m) => matches!(bound.member_owner[m.idx()], MemberOwner::Class(_)),
            FnOwner::Expr(_) => true,
            _ => false,
        }
    }

    /// `checkGrammarFunctionLikeDeclaration`, and what those who call it go on to: `checkGrammarForGenerator`, `checkGrammarMethod`,
    /// `checkGrammarAccessor`, `checkGrammarConstructorTypeParameters`, `checkGrammarConstructorTypeAnnotation`.
    fn check_grammar_of_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text = &hir.text[..];
        // Nothing is said of the grammar of a file that does not parse, and none of these checks then ends the others.
        let is_silent = has_parse_diagnostics(hir);
        let path = self.files().module(file).path.as_str();
        let is_reserved = path.ends_with(".mts") || path.ends_with(".cts");
        // `None`: it is not said, and is the latest.
        let target = self.p.files.options.target;
        let checks_use_strict = target == ScriptTarget::None || target >= ScriptTarget::ES2016;
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            if matches!(bound.fns[i].owner, FnOwner::None)
                || matches!(func.kind, FnKind::StaticBlock | FnKind::IndexSignature)
            {
                continue;
            }
            let has_room_for_a_body = self.is_member_with_room_for_a_body(file, f);
            let is_named = func.name.is_some()
                || matches!(
                    func.kind,
                    FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor
                );
            let mut has_objected = !is_silent
                && (is_named && has_modifier_error(hir, func.name_pos)
                    || check_grammar_type_parameter_list(hir, f, out)
                    || check_grammar_parameter_list(hir, f, out)
                    || check_grammar_arrow_function(hir, f, is_reserved, out));
            // `IsFunctionLikeDeclaration`
            let is_declaration = match func.kind {
                FnKind::Decl | FnKind::Expr | FnKind::Arrow | FnKind::Constructor => true,
                FnKind::Method | FnKind::Getter | FnKind::Setter => has_room_for_a_body,
                _ => false,
            };
            if !has_objected && is_declaration && checks_use_strict {
                has_objected = check_use_strict_with_simple_parameters(hir, f, out);
            }
            if is_silent {
                continue;
            }
            let is_ambient = func.flags.contains(Flags::AMBIENT);
            match func.kind {
                FnKind::Decl if func.name.is_some() => {
                    check_grammar_generator(hir, f, func.name_pos, is_ambient, out);
                }
                FnKind::Method if has_room_for_a_body && !has_objected => {
                    // `{ m(); }`
                    if matches!(bound.fns[i].owner, FnOwner::Expr(_)) && !has_written_body(hir, f) {
                        if let Some(start) = self.end_of_bodiless_declaration(file, f) {
                            out.push(Diagnostic { start, code: 1005 });
                        }
                        continue;
                    }
                    check_grammar_generator(hir, f, func.name_pos, is_ambient, out);
                }
                FnKind::Getter | FnKind::Setter if has_room_for_a_body && !has_objected => {
                    let is_abstract = func.flags.contains(Flags::ABSTRACT);
                    if has_written_body(hir, f) {
                        if is_abstract {
                            out.push(Diagnostic {
                                start: func.name_pos,
                                code: 1318,
                            });
                        }
                    } else if !is_ambient
                        && !is_abstract
                        && let Some(start) = self.end_of_bodiless_declaration(file, f)
                    {
                        out.push(Diagnostic { start, code: 1005 });
                    }
                }
                FnKind::Constructor => {
                    // The type parameters come between the name and the `(`.
                    let name = func.name_pos as usize;
                    let after_name = match text.get(name) {
                        Some(b'"' | b'\'') => skip_string(text, name),
                        _ => Some(name + word_at(text, name).len()),
                    };
                    let less_than = after_name
                        .map(|end| skip_trivia(text, end))
                        .filter(|&at| text.get(at) == Some(&b'<'));
                    if let Some(less_than) = less_than {
                        let first = skip_trivia(text, less_than + 1);
                        let start = if text.get(first) == Some(&b'>') {
                            less_than + 1
                        } else {
                            first
                        };
                        out.push(Diagnostic {
                            start: start as u32,
                            code: 1092,
                        });
                    } else if func.ret.is_some() {
                        out.push(Diagnostic {
                            start: start_of_written_type(text, hir[func.ret].pos),
                            code: 1093,
                        });
                    } else if text.get(func.anchor as usize) == Some(&b'(')
                        && let Some(close) = skip_balanced(text, func.anchor as usize)
                        && text.get(skip_trivia(text, close)) == Some(&b':')
                    {
                        out.push(Diagnostic {
                            start: skip_trivia(text, skip_trivia(text, close) + 1) as u32,
                            code: 1093,
                        });
                    }
                }
                _ => {}
            }
        }
    }

    /// `node.End() - 1`, of a method or an accessor that is written without a body: the `;` after it, or else the last of it.
    fn end_of_bodiless_declaration(&self, file: FileId, f: FnId) -> Option<u32> {
        let hir = self.hir(file);
        let end = end_of_signature(hir, f)?;
        let next = skip_trivia(&hir.text, end);
        let last = if hir.text.get(next) == Some(&b';') {
            next
        } else {
            end - 1
        };
        Some(last as u32)
    }

    /// `checkParameter`: 1294, 2398, 2681, 2784.
    fn check_parameters_of_signatures(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `shouldCheckErasableSyntax`
        let is_erasable_only = self.p.files.options.erasable_syntax_only && !hir.is_js;
        for i in 0..hir.fns.len() {
            let func = &hir.fns[i];
            if matches!(bound.fns[i].owner, FnOwner::None) {
                continue;
            }
            for p in func.params.iter() {
                let param = &hir[p];
                if !param.flags.contains(Flags::PARAMETER_PROPERTY) {
                    continue;
                }
                if is_erasable_only {
                    out.push(Diagnostic {
                        start: param.pos,
                        code: 1294,
                    });
                }
                if func.kind == FnKind::Constructor
                    && matches!(hir[param.pat].kind, PatKind::Ident(known::constructor))
                {
                    out.push(Diagnostic {
                        start: hir[param.pat].pos,
                        code: 2398,
                    });
                }
            }
            let code = match func.kind {
                FnKind::Constructor | FnKind::ConstructSignature | FnKind::ConstructorType => 2681,
                FnKind::Getter | FnKind::Setter => 2784,
                _ => continue,
            };
            if let Some(start) = this_parameter(hir, FnId(i as u32)) {
                out.push(Diagnostic { start, code });
            }
            // A `this` that is not the first parameter is listed in `params`.
            let is_this =
                |p: &ParamId| matches!(hir[hir[*p].pat].kind, PatKind::Ident(known::this));
            out.extend(func.params.iter().filter(is_this).map(|p| Diagnostic {
                start: hir[p].pos,
                code,
            }));
        }
    }

    /// `checkPropertyDeclaration`: 1267. `checkMethodDeclaration`: 1245. `checkAccessorDeclaration`: 2676, 2808.
    fn check_abstract_members_and_accessor_pairs(
        &mut self,
        file: FileId,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for c in 0..hir.classes.len() {
            if bound.class_symbol[c].is_none() {
                continue;
            }
            let members = hir.classes[c].members;
            let mut may_disagree = false;
            for m in members.iter() {
                let member = &hir[m];
                match member.kind {
                    MemberKind::Property
                        if member.flags.contains(Flags::ABSTRACT) && member.init.is_some() =>
                    {
                        out.push(Diagnostic {
                            start: member.pos,
                            code: 1267,
                        });
                    }
                    MemberKind::Method
                        if member.flags.contains(Flags::ABSTRACT)
                            && member.func.is_some()
                            && has_written_body(hir, member.func) =>
                    {
                        out.push(Diagnostic {
                            start: member.pos,
                            code: 1245,
                        });
                    }
                    MemberKind::Getter | MemberKind::Setter => {
                        may_disagree |= member
                            .flags
                            .intersects(Flags::ABSTRACT | Flags::PRIVATE | Flags::PROTECTED)
                    }
                    _ => {}
                }
            }
            if !may_disagree {
                continue;
            }
            // `hasBindableName`. In the order they are written, what is static apart.
            let mut named: Vec<(Atom, bool, MemberId)> = Vec::new();
            for m in members.iter() {
                if matches!(
                    hir[m].kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                ) && let Some(name) = self.member_name(file, hir[m].key)
                {
                    named.push((name, hir[m].flags.contains(Flags::STATIC), m));
                }
            }
            for (i, &(name, is_static, _)) in named.iter().enumerate() {
                if named[..i].iter().any(|n| n.0 == name && n.1 == is_static) {
                    continue;
                }
                // `declareSymbolEx`: the getter and the setter that the table of members takes for one symbol. What it refuses is a
                // symbol of its own.
                const PROPERTY: u8 = 1;
                const METHOD: u8 = 2;
                const GET: u8 = 4;
                const SET: u8 = 8;
                let (mut flags, mut getter, mut setter) = (0, None, None);
                for &(_, _, m) in named[i..]
                    .iter()
                    .filter(|n| n.0 == name && n.1 == is_static)
                {
                    let (includes, excludes) = match hir[m].kind {
                        MemberKind::Getter => (GET, GET | METHOD),
                        MemberKind::Setter => (SET, SET | METHOD),
                        MemberKind::Method => (METHOD, PROPERTY | GET | SET),
                        _ if hir[m].flags.contains(Flags::ACCESSOR) => {
                            (GET | SET, GET | SET | METHOD)
                        }
                        _ => (PROPERTY, METHOD),
                    };
                    if flags & excludes != 0 {
                        // An accessor that something else ran into is both accessors to whatever comes after.
                        if flags & (GET | SET) != 0 && flags & (GET | SET) != includes & (GET | SET)
                        {
                            flags |= GET | SET;
                        }
                        continue;
                    }
                    flags |= includes;
                    match hir[m].kind {
                        MemberKind::Getter => getter = Some(m),
                        MemberKind::Setter => setter = Some(m),
                        _ => {}
                    }
                }
                let (Some(getter), Some(setter)) = (getter, setter) else {
                    continue;
                };
                let (get, set) = (hir[getter].flags, hir[setter].flags);
                let mut both = |code: u32| {
                    out.extend([getter, setter].map(|m| Diagnostic {
                        start: hir[m].pos,
                        code,
                    }))
                };
                if get.contains(Flags::ABSTRACT) != set.contains(Flags::ABSTRACT) {
                    both(2676);
                }
                if get.contains(Flags::PROTECTED)
                    && !set.intersects(Flags::PROTECTED | Flags::PRIVATE)
                    || get.contains(Flags::PRIVATE) && !set.contains(Flags::PRIVATE)
                {
                    both(2808);
                }
            }
        }
    }

    // ───────────────────────────── what is returned ─────────────────────────────

    /// `checkTypePredicate`: 1228, 1229, 2677, 1230, 1225.
    fn check_type_predicates(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let text = &hir.text[..];
        for t in 0..hir.types.len() {
            if bound.type_scope[t].is_none() {
                continue;
            }
            let (param, ty, asserts) = match hir.types[t].kind {
                TypeNodeKind::Predicate { param, ty, asserts } => (param, ty, asserts),
                // `this is T` is a predicate wherever a type can be written. Only where a function says what it returns is it kept as one.
                TypeNodeKind::Keyword(Keyword::This) => {
                    let end = hir.types[t].pos as usize + 4;
                    let next = skip_trivia(text, end);
                    if word_at(text, next) == b"is" && !has_line_break(text, end, next) {
                        out.push(Diagnostic {
                            start: hir.types[t].pos,
                            code: 1228,
                        });
                    }
                    continue;
                }
                // So is `asserts x`, which is kept as a type by the name of `asserts` elsewhere.
                TypeNodeKind::Ref { name, args }
                    if name.len() == 1
                        && args.is_empty()
                        && self.files().atoms.bytes(hir.id_at(name, 0)) == b"asserts" =>
                {
                    let end = hir.types[t].pos as usize + 7;
                    let next = skip_trivia(text, end);
                    let word = word_at(text, next);
                    if !word.is_empty()
                        && !word[0].is_ascii_digit()
                        && word != b"extends"
                        && !has_line_break(text, end, next)
                    {
                        out.push(Diagnostic {
                            start: hir.types[t].pos,
                            code: 1228,
                        });
                    }
                    continue;
                }
                _ => continue,
            };
            // `getTypePredicateParent`
            let node = TypeNodeId(t as u32);
            let parent = hir.fns.iter().position(|f| f.ret == node).filter(|&f| {
                matches!(
                    hir.fns[f].kind,
                    FnKind::Arrow
                        | FnKind::CallSignature
                        | FnKind::Decl
                        | FnKind::Expr
                        | FnKind::FunctionType
                        | FnKind::Method
                )
            });
            let Some(parent) = parent else {
                out.push(Diagnostic {
                    start: hir.types[t].pos,
                    code: 1228,
                });
                continue;
            };
            if param == known::this {
                continue;
            }
            // The parameter name is the first word of the node, or the one after `asserts`.
            let start = hir.types[t].pos;
            let name_pos = if asserts {
                skip_trivia(text, start as usize + b"asserts".len()) as u32
            } else {
                start
            };
            let params = hir.fns[parent].params;
            let Some(index) = params.iter().position(
                |p| matches!(hir[hir[p].pat].kind, PatKind::Ident(name) if name == param),
            ) else {
                // `checkIfTypePredicateVariableIsDeclaredInBindingPattern`
                let mut names = Vec::new();
                params
                    .iter()
                    .for_each(|p| names_bound_by(hir, hir[p].pat, &mut names));
                let is_in_pattern = names.iter().any(|&(name, _)| name == param);
                out.push(Diagnostic {
                    start: name_pos,
                    code: if is_in_pattern { 1230 } else { 1225 },
                });
                continue;
            };
            let p = params.at(index);
            if hir[p].flags.contains(Flags::REST) && index == params.len() - 1 {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 1229,
                });
                continue;
            }
            if ty.is_none() {
                continue;
            }
            if hir[p].ty.is_none() {
                self.prepare_fn(file, FnId(parent as u32));
            }
            let (narrowed, declared) = (self.type_from_node(file, ty), self.type_of_param(file, p));
            if self.is_known_not_to_fit(narrowed, declared) {
                out.push(Diagnostic {
                    start: start_of_written_type(text, hir[ty].pos),
                    code: 2677,
                });
            }
        }
    }

    /// From `checkSignatureDeclaration`: 2505.
    fn check_generator_return_types(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            if !func.flags.contains(Flags::GENERATOR)
                || func.ret.is_none()
                || matches!(bound.fns[i].owner, FnOwner::None)
            {
                continue;
            }
            let is_declaration = matches!(func.kind, FnKind::Decl | FnKind::Expr)
                || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f);
            if is_declaration
                && has_written_body(hir, f)
                && self.type_from_node(file, func.ret) == TypeId::VOID
            {
                out.push(Diagnostic {
                    start: start_of_written_type(&hir.text, hir[func.ret].pos),
                    code: 2505,
                });
            }
        }
    }

    /// Where an error about the function `f` as a whole goes: `GetErrorRangeForNode`.
    fn start_of_function_error(&self, file: FileId, f: FnId) -> u32 {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let func = &hir[f];
        let owner = bound.fns[f.idx()].owner;
        match (func.kind, owner) {
            (FnKind::Arrow, _) => func.pos,
            (FnKind::Constructor, FnOwner::Member(m)) => {
                start_with_modifiers(&hir.text, hir[m].pos, hir[m].flags, MEMBER_MODIFIERS)
            }
            (FnKind::Method | FnKind::Getter | FnKind::Setter, _) => func.name_pos,
            _ if func.name.is_some() => func.name_pos,
            // `GetAssignedName`: one without a name goes by what it is given to, if it is written right there.
            (FnKind::Expr, FnOwner::Expr(e))
                if hir.parens.binary_search_by_key(&e.0, |p| p.0.0).is_err() =>
            {
                match bound.expr_parent[e.idx()] {
                    Parent::VarInit(d) if matches!(hir[hir[d].pat].kind, PatKind::Ident(_)) => {
                        hir[hir[d].pat].pos
                    }
                    // Of an object literal: an attribute of a JSX element gives no name.
                    Parent::Prop(p)
                        if hir[p].kind == PropKind::Init
                            && bound.prop_owner[p.idx()]
                                .some()
                                .is_some_and(|o| matches!(hir[o].kind, ExprKind::Object(_))) =>
                    {
                        hir[p].pos
                    }
                    Parent::PatPropDefault(p) => hir[hir[p].value].pos,
                    Parent::PatElemDefault(p) => hir[hir[p].pat].pos,
                    Parent::Expr(x) => match hir[x].kind {
                        ExprKind::Assign {
                            target: left,
                            value: right,
                            ..
                        }
                        | ExprKind::Binary { left, right, .. }
                            if right == e =>
                        {
                            match hir[left].kind {
                                ExprKind::Ident(_) => hir[left].pos,
                                ExprKind::Dot { name_pos, .. } => name_pos,
                                ExprKind::Index { index, .. }
                                    if matches!(
                                        hir[index].kind,
                                        ExprKind::String(_) | ExprKind::Number(_)
                                    ) =>
                                {
                                    hir[index].pos
                                }
                                _ => func.pos,
                            }
                        }
                        _ => func.pos,
                    },
                    _ => func.pos,
                }
            }
            _ => func.pos,
        }
    }

    /// `getPromisedTypeOfPromiseEx`, of what is neither a union nor generic.
    fn promised_type_of_promise_like(&mut self, t: TypeId) -> Option<TypeId> {
        if self.is_any(t) {
            return None;
        }
        if let Some(args) = self.is_global_ref(t, known::Promise) {
            return args.first().copied();
        }
        // What is not an object is not taken for a promise, whatever it has.
        if t == TypeId::NEVER || self.is_primitive(t) {
            return None;
        }
        let then = self.type_of_then(t)?;
        // What is not known is passed on as such.
        if !self.is_known(then) {
            return Some(TypeId::UNRESOLVED);
        }
        if self.is_any(then) {
            return None;
        }
        let mut first_parameters = Vec::new();
        for sig in self.signatures(then, false) {
            if let Some(this) = self.sig_this_type(sig)
                && this != TypeId::VOID
                && !self.is_subtype(t, this)
            {
                continue;
            }
            let params = self.sig_params(sig);
            first_parameters.push(self.param_type_at(&params, 0).unwrap_or(TypeId::NEVER));
        }
        if first_parameters.is_empty() {
            return None;
        }
        let on_fulfilled = self.union(&first_parameters);
        let on_fulfilled = self.non_nullable(on_fulfilled);
        if !self.is_known(on_fulfilled) {
            return Some(TypeId::UNRESOLVED);
        }
        if self.is_any(on_fulfilled) {
            return None;
        }
        let callbacks = self.signatures(on_fulfilled, false);
        if callbacks.is_empty() {
            return None;
        }
        let mut values = Vec::with_capacity(callbacks.len());
        for callback in callbacks {
            let params = self.sig_params(callback);
            values.push(self.param_type_at(&params, 0).unwrap_or(TypeId::NEVER));
        }
        Some(self.union_reduced(&values))
    }

    /// `getTypeOfPropertyOfType(t, "then")`
    fn type_of_then(&mut self, t: TypeId) -> Option<TypeId> {
        let apparent = self.apparent_type(t);
        let (prop, mapper) = self.prop_of(apparent, known::then)?;
        Some(self.type_of_prop_as_read(&prop, mapper))
    }

    /// `getAwaitedTypeNoAliasEx`, for what it reports. `false`: there is no awaited type.
    fn look_for_awaited_type(&mut self, t: TypeId, state: &mut Awaiting) -> bool {
        let t = self.force(t);
        if !self.is_known(t) || state.stack.len() > 64 {
            state.found |= Awaiting::UNKNOWN;
            return true;
        }
        if self.is_any(t) || self.awaited_argument(t).is_some() || state.settled.contains(&t) {
            return true;
        }
        if self.is_union(t) {
            if state.stack.contains(&t) {
                state.found |= Awaiting::CIRCULAR;
                return false;
            }
            state.stack.push(t);
            let mut is_there = false;
            for &member in self.parts(t) {
                is_there |= self.look_for_awaited_type(member, state);
            }
            state.stack.pop();
            // `mapType` leaves out the members that have none. What is left is remembered, whatever was said on the way.
            if is_there {
                state.settled.push(t);
            }
            return is_there;
        }
        // `isAwaitedTypeNeeded`. What is generic and does not need `Awaited` extends nothing that has a `then`: it is what it is either way.
        if self.is_deferred(t) || self.is_generic_object_type(t) {
            return true;
        }
        if let Some(promised) = self.promised_type_of_promise_like(t) {
            let promised = self.force(promised);
            if t == promised || state.stack.contains(&promised) {
                state.found |= Awaiting::CIRCULAR;
                return false;
            }
            state.stack.push(t);
            let is_there = self.look_for_awaited_type(promised, state);
            state.stack.pop();
            if is_there {
                state.settled.push(t);
            }
            return is_there;
        }
        // `isThenableType`
        if t != TypeId::NEVER
            && !self.is_primitive(t)
            && let Some(then) = self.type_of_then(t)
        {
            if !self.is_known(then) {
                state.found |= Awaiting::UNKNOWN;
                return true;
            }
            let then = self.non_nullable(then);
            if !self.signatures(then, false).is_empty() {
                state.found |= Awaiting::THENABLE;
                return false;
            }
        }
        state.settled.push(t);
        true
    }

    /// `checkAsyncFunctionReturnType`: 1064. `checkAwaitedType`, where an `await`, the return type of an asynchronous function or what such a
    /// function returns is looked at: 1062, 1058. (1320, which is what is said of the operand of `await`, is not said here.)
    fn check_async_functions_and_awaits(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let has_promise_type = self.global_type_symbol(known::Promise).is_some();
        // Where it is written, what is awaited, where an error goes (nowhere, if none is asked for), and what is said of what has a
        // `then` but is no promise.
        let mut sites: Vec<(u32, Result<ExprId, TypeId>, Option<u32>, u32)> = Vec::new();
        for (i, e) in hir.exprs.iter().enumerate() {
            if let ExprKind::Await(operand) = e.kind
                && !matches!(bound.expr_parent[i], Parent::None)
            {
                sites.push((e.pos, Ok(operand), Some(e.pos), 0));
            }
        }
        let mut branches = Vec::new();
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            if !func.flags.contains(Flags::ASYNC) || matches!(bound.fns[i].owner, FnOwner::None) {
                continue;
            }
            if !(matches!(func.kind, FnKind::Decl | FnKind::Expr | FnKind::Arrow)
                || func.kind == FnKind::Method && self.is_member_with_room_for_a_body(file, f))
            {
                continue;
            }
            let whole = self.start_of_function_error(file, f);
            let is_annotated = func.ret.is_some();
            if is_annotated && !func.flags.contains(Flags::GENERATOR) {
                let ret = self.type_from_node(file, func.ret);
                let ret = self.force(ret);
                let start = start_of_written_type(&hir.text, hir[func.ret].pos);
                // What is in error is `any` here too: only an `any` that is written out is known not to be.
                if self.is_known(ret)
                    && (ret != TypeId::ANY
                        || matches!(hir[func.ret].kind, TypeNodeKind::Keyword(Keyword::Any)))
                {
                    if has_promise_type && self.is_global_ref(ret, known::Promise).is_none() {
                        out.push(Diagnostic { start, code: 1064 });
                        // What could have been meant is part of the message: it is awaited for that, and no more is said.
                        sites.push((start, Err(ret), None, 0));
                    } else {
                        sites.push((start, Err(ret), Some(whole), 1058));
                    }
                }
            }
            // `checkReturnExpression` where it says what it returns, `checkAndAggregateReturnExpressionTypes` and `getReturnTypeFromBody`
            // where it does not.
            let is_block = matches!(func.body, FnBody::Block(_));
            let mut returned: Vec<(ExprId, u32)> = Vec::new();
            match func.body {
                FnBody::Expr(e) => returned.push((e, self.start_of(file, e))),
                FnBody::Block(_) => {
                    for s in bound.ids(bound.fns[i].returns) {
                        if let StmtKind::Return(e) = hir[s].kind
                            && e.is_some()
                        {
                            returned.push((e, hir[s].pos));
                        }
                    }
                }
                FnBody::None => {}
            }
            for (e, statement) in returned {
                if is_annotated {
                    branches.clear();
                    branches.push(e);
                    while let Some(e) = branches.pop() {
                        match hir[e].kind {
                            ExprKind::Cond { yes, no, .. } => branches.extend([no, yes]),
                            // What `await` gives has been awaited, or is in error and can be anything.
                            ExprKind::Await(_) => {}
                            _ => sites.push((hir[e].pos, Ok(e), Some(statement), 1058)),
                        }
                    }
                    continue;
                }
                // Only after `return` is the operand of an `await` looked at in its stead, and a call of the function itself passed over.
                let e = match hir[e].kind {
                    ExprKind::Await(operand) if is_block => operand,
                    ExprKind::Await(_) => continue,
                    _ => e,
                };
                if is_block && is_call_of_itself(hir, bound, f, e) {
                    continue;
                }
                sites.push((hir[e].pos, Ok(e), Some(whole), 1058));
            }
        }
        // What awaiting a type came to is remembered, whatever was said on the way: that is said the first time only.
        sites.sort_by_key(|s| s.0);
        let mut state = Awaiting {
            stack: Vec::new(),
            settled: Vec::new(),
            found: 0,
        };
        for (_, what, start, code) in sites {
            let ty = match what {
                Ok(e) => {
                    let ty = self.type_of_expr(file, e);
                    if self.is_uncertain(file, e) {
                        continue;
                    }
                    ty
                }
                Err(ty) => ty,
            };
            state.found = 0;
            state.stack.clear();
            self.look_for_awaited_type(ty, &mut state);
            let Some(start) = start else { continue };
            if state.found & Awaiting::UNKNOWN != 0 {
                continue;
            }
            if state.found & Awaiting::CIRCULAR != 0 {
                out.push(Diagnostic { start, code: 1062 });
            }
            if state.found & Awaiting::THENABLE != 0 && code != 0 {
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// `createPromiseReturnType`, where there is a `Promise` to name as a type but none to make one with: 2712, 2705.
    fn check_promise_constructor_is_there(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        if self.global_type_symbol(known::Promise).is_none()
            || self
                .files()
                .global(known::Promise, SymFlags::VALUE)
                .is_some()
        {
            return;
        }
        let (hir, bound) = (self.hir(file), self.bound(file));
        for (i, e) in hir.exprs.iter().enumerate() {
            if matches!(e.kind, ExprKind::ImportCall(_))
                && !matches!(bound.expr_parent[i], Parent::None)
                && word_at(&hir.text, e.pos as usize) == b"import"
            {
                out.push(Diagnostic {
                    start: e.pos,
                    code: 2712,
                });
            }
        }
        // `getReturnTypeFromBody` only gets there for a function that returns nothing, calls of itself aside.
        for i in 0..hir.fns.len() {
            let (f, func) = (FnId(i as u32), &hir.fns[i]);
            let info = &bound.fns[i];
            if !func.flags.contains(Flags::ASYNC)
                || func.flags.contains(Flags::GENERATOR)
                || func.ret.is_some()
                || !matches!(func.body, FnBody::Block(_))
                || bound.ids(info.returns).any(|s| match hir[s].kind {
                    StmtKind::Return(e) if e.is_some() => match hir[e].kind {
                        ExprKind::Await(operand) => !is_call_of_itself(hir, bound, f, operand),
                        _ => !is_call_of_itself(hir, bound, f, e),
                    },
                    _ => false,
                })
            {
                continue;
            }
            // What it returns has to be asked for: it always is of an expression, by a `return`, and by a call.
            let is_asked = match (func.kind, info.owner) {
                (FnKind::Expr | FnKind::Arrow | FnKind::Method, FnOwner::Expr(_)) => true,
                (FnKind::Decl | FnKind::Method, FnOwner::Stmt(_) | FnOwner::Member(_))
                    if !info.returns.is_empty() =>
                {
                    true
                }
                (FnKind::Decl, FnOwner::Stmt(_)) => {
                    let symbol = bound.fn_symbol[i];
                    symbol.is_some()
                        && bound.symbols[symbol.idx()].decls.len() == 1
                        && hir.exprs.iter().any(|e| {
                            matches!(e.kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
                        })
                }
                _ => false,
            };
            if is_asked {
                out.push(Diagnostic {
                    start: self.start_of_function_error(file, f),
                    code: 2705,
                });
            }
        }
    }

    // ───────────────────────────── what declarations agree on ─────────────────────────────

    /// `checkFunctionOrConstructorSymbolWorker`, of methods and constructors: 2385 2512 2386.
    fn check_member_overloads_agree(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The declarations of a class or an interface share one table of members.
        for i in 0..bound.symbols.len() {
            if !bound.symbols[i]
                .flags
                .intersects(SymFlags::CLASS | SymFlags::INTERFACE)
            {
                continue;
            }
            let sym = self.files().sym(file, SymbolId(i as u32));
            if sym.file == file && sym.id.idx() != i {
                continue;
            }
            let mut lists: Vec<(FileId, Span<MemberId>, u32, u32)> = Vec::new();
            for (of, decl) in self.files().decls(sym) {
                match decl {
                    Decl::Class(c) => lists.push((of, self.hir(of)[c].members, 0, c.0)),
                    Decl::Interface(x) => lists.push((of, self.hir(of)[x].members, 1, x.0)),
                    _ => {}
                }
            }
            self.check_member_lists_agree(file, &lists, out);
        }
        for (t, node) in hir.types.iter().enumerate() {
            if let TypeNodeKind::Object(members) = node.kind
                && bound.type_scope[t].is_some()
            {
                self.check_member_lists_agree(file, &[(file, members, 2, t as u32)], out);
            }
        }
    }

    /// `lists`: the members that go into one table, by the declaration that lists them: its file, and what tells it from others.
    fn check_member_lists_agree(
        &mut self,
        file: FileId,
        lists: &[(FileId, Span<MemberId>, u32, u32)],
        out: &mut Vec<Diagnostic>,
    ) {
        let is_overloadable = |member: &Member| {
            matches!(member.kind, MemberKind::Method | MemberKind::Constructor)
                && member.func.is_some()
        };
        // Where nothing is said there is nothing to disagree about.
        let says_something = lists.iter().any(|&(of, members, ..)| {
            let hir = self.hir(of);
            members.iter().any(|m| {
                is_overloadable(&hir[m])
                    && hir[m].flags.intersects(
                        Flags::PRIVATE | Flags::PROTECTED | Flags::ABSTRACT | Flags::OPTIONAL,
                    )
            })
        });
        if !says_something {
            return;
        }
        // By name, what is static apart. Constructors go by no name.
        let mut entries: Vec<(Atom, bool, Overload)> = Vec::new();
        for &(of, members, kind, id) in lists {
            let hir = self.hir(of);
            for m in members.iter() {
                let member = &hir[m];
                if !is_overloadable(member) {
                    continue;
                }
                let (name, checked, at) = if member.kind == MemberKind::Constructor {
                    (
                        Atom::NONE,
                        Flags::PRIVATE | Flags::PROTECTED,
                        start_with_modifiers(&hir.text, member.pos, member.flags, MEMBER_MODIFIERS),
                    )
                } else {
                    let Some(name) = self.member_name(of, member.key) else {
                        continue;
                    };
                    (
                        name,
                        Flags::PRIVATE | Flags::PROTECTED | Flags::ABSTRACT,
                        member.pos,
                    )
                };
                let overload = Overload {
                    file: of,
                    parent: (of, kind, id),
                    at,
                    flags: member.flags & checked,
                    is_optional: member.flags.contains(Flags::OPTIONAL),
                    is_function: true,
                    has_body: has_written_body(hir, member.func),
                };
                entries.push((name, member.flags.contains(Flags::STATIC), overload));
            }
        }
        entries.sort_by_key(|e| (e.0, e.1));
        let mut group = Vec::new();
        let mut start = 0;
        while start < entries.len() {
            let key = (entries[start].0, entries[start].1);
            let end = start
                + entries[start..]
                    .iter()
                    .take_while(|e| (e.0, e.1) == key)
                    .count();
            if end - start > 1 {
                group.clear();
                group.extend(entries[start..end].iter().map(|e| e.2));
                let said = out.len();
                check_overloads_agree(file, &group, out);
                // `declareSymbolEx`: a name is what it is first declared as. After a property or an accessor, each method is a symbol of
                // its own, with nothing to agree with.
                if out.len() > said
                    && key.0.is_some()
                    && !self.is_first_declared_as_a_method(lists, key.0, key.1)
                {
                    out.truncate(said);
                }
            }
            start = end;
        }
    }

    /// Whether the first of the members in `lists` that go by `name` is a method.
    fn is_first_declared_as_a_method(
        &mut self,
        lists: &[(FileId, Span<MemberId>, u32, u32)],
        name: Atom,
        is_static: bool,
    ) -> bool {
        for &(of, members, ..) in lists {
            let hir = self.hir(of);
            for m in members.iter() {
                let member = &hir[m];
                if matches!(
                    member.kind,
                    MemberKind::Property
                        | MemberKind::Method
                        | MemberKind::Getter
                        | MemberKind::Setter
                ) && member.flags.contains(Flags::STATIC) == is_static
                    && self.member_name(of, member.key) == Some(name)
                {
                    return member.kind == MemberKind::Method;
                }
            }
        }
        true
    }

    /// What is declared in each list of statements: 2395 2652, and 2383 2384 for functions.
    fn check_declarations_of_blocks(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        let is_module = self.files().module(file).is_module();
        // Where nothing can be exported, only a function without a body has anything to agree with.
        let has_overloads = |list: IdList<StmtId>| {
            hir.ids(list).any(
                |s| matches!(hir[s].kind, StmtKind::Fn(f) if matches!(hir[f].body, FnBody::None)),
            )
        };
        let mut blocks = Vec::new();
        if is_module || has_overloads(hir.body) {
            blocks.push(Block::from_source_file(hir, file, is_module));
        }
        for m in 0..hir.modules.len() {
            if bound.module_symbol[m].is_some() && hir.modules[m].has_body {
                blocks.push(Block::of_module(hir, file, ModuleId(m as u32)));
            }
        }
        for (i, f) in hir.fns.iter().enumerate() {
            if let FnBody::Block(list) = f.body
                && !matches!(bound.fns[i].owner, FnOwner::None)
                && has_overloads(list)
            {
                blocks.push(Block::plain(file, list, false));
            }
        }
        for (i, s) in hir.stmts.iter().enumerate() {
            if let StmtKind::Block(list) = s.kind
                && !matches!(bound.stmt_parent[i], Parent::None)
                && has_overloads(list)
            {
                blocks.push(Block::plain(file, list, false));
            }
        }
        let mut overloads = Vec::new();
        // The local symbols.
        for (index, block) in blocks.iter().enumerate() {
            let all = declared_in_block(hir, bound, block);
            for_each_symbol(&all, true, |group, is_any_refused| {
                if block.has_exports {
                    self.check_exports_on_merged_declarations(
                        block,
                        &all,
                        group,
                        is_any_refused,
                        out,
                    );
                }
                if group
                    .iter()
                    .any(|&i| all[i].what == DeclaredAs::Function && !all[i].has_body)
                {
                    overloads.clear();
                    overloads.extend(
                        group
                            .iter()
                            .map(|&i| overload_of_declared(&all[i], file, index as u32)),
                    );
                    check_overloads_agree(file, &overloads, out);
                }
            });
        }
        // The symbols among the exports, which the blocks of a namespace share, in whichever file they are.
        let mut seen: Vec<Sym> = Vec::new();
        for block in blocks.iter().filter(|b| b.has_exports) {
            let mut sharing = vec![*block];
            if block.module.is_some() {
                let sym = self
                    .files()
                    .sym(file, bound.module_symbol[block.module.idx()]);
                if seen.contains(&sym) {
                    continue;
                }
                seen.push(sym);
                sharing.clear();
                for (of, decl) in self.files().decls(sym) {
                    if let Decl::Module(m) = decl
                        && self.hir(of)[m].has_body
                    {
                        sharing.push(Block::of_module(self.hir(of), of, m));
                    }
                }
            }
            let mut all: Vec<Declared> = Vec::new();
            let mut homes: Vec<usize> = Vec::new();
            for (index, b) in sharing.iter().enumerate() {
                for mut d in declared_in_block(self.hir(b.file), self.bound(b.file), b) {
                    if !d.is_exported {
                        continue;
                    }
                    // The exported symbol of `export default function f` goes by `default`.
                    if d.flags.contains(Flags::DEFAULT) {
                        d.name = known::default;
                    }
                    all.push(d);
                    homes.push(index);
                }
            }
            if !all
                .iter()
                .any(|d| d.what == DeclaredAs::Function && !d.has_body)
            {
                continue;
            }
            for_each_symbol(&all, false, |group, _| {
                if group
                    .iter()
                    .any(|&i| all[i].what == DeclaredAs::Function && !all[i].has_body)
                {
                    overloads.clear();
                    overloads.extend(group.iter().map(|&i| {
                        overload_of_declared(&all[i], sharing[homes[i]].file, homes[i] as u32)
                    }));
                    check_overloads_agree(file, &overloads, out);
                }
            });
        }
    }

    /// `checkExportsOnMergedDeclarations`, of the declarations `group` (of `all`) that share a local symbol of `block`.
    fn check_exports_on_merged_declarations(
        &mut self,
        block: &Block,
        all: &[Declared],
        group: &[usize],
        is_any_refused: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        // Something is exported, or there is no more to the symbol than what is local; and it is not asked of functions and imports.
        if !group.iter().any(|&i| all[i].is_exported)
            || !group.iter().any(|&i| all[i].what == DeclaredAs::Other)
        {
            return;
        }
        let spaces: Vec<u8> = group
            .iter()
            .map(|&i| match all[i].what {
                DeclaredAs::Alias => self
                    .declaration_spaces_of_alias(block, all[i].name)
                    .unwrap_or(0),
                _ => all[i].spaces,
            })
            .collect();
        let (mut exported, mut non_exported, mut default_exported) = (0, 0, 0);
        for (&i, &spaces) in group.iter().zip(&spaces) {
            if !all[i].flags.contains(Flags::EXPORT) {
                non_exported |= spaces;
            } else if all[i].flags.contains(Flags::DEFAULT) {
                default_exported |= spaces;
            } else {
                exported |= spaces;
            }
        }
        let common_for_exports_and_locals = exported & non_exported;
        let common_for_default_and_non_default = default_exported & (exported | non_exported);
        if common_for_exports_and_locals == 0 && common_for_default_and_non_default == 0 {
            return;
        }
        for (&i, &spaces) in group.iter().zip(&spaces) {
            if spaces & common_for_default_and_non_default != 0 {
                out.push(Diagnostic {
                    start: all[i].at,
                    code: 2652,
                });
            } else if spaces & common_for_exports_and_locals != 0 {
                out.push(Diagnostic {
                    start: all[i].at,
                    code: 2395,
                });
            }
        }
        // `declareModuleMember`: what is exported and what is not are two symbols, and neither table refuses what only the other has.
        // What has been said on the assumption that they are one is taken back, where it is plain that neither table refuses anything.
        let is_only_block = block.module.is_none() || {
            let sym = self.files().sym(
                block.file,
                self.bound(block.file).module_symbol[block.module.idx()],
            );
            self.files()
                .decls(sym)
                .iter()
                .filter(|d| matches!(d.1, Decl::Module(_)))
                .count()
                == 1
        };
        if is_any_refused || !is_only_block {
            return;
        }
        let mut flags = 0;
        let do_exports_go_together = group.iter().filter(|&&i| all[i].is_exported).all(|&i| {
            let fits = flags & all[i].excludes == 0;
            flags |= all[i].includes;
            fits
        });
        if do_exports_go_together {
            out.retain(|d| {
                !(matches!(d.code, 2300 | 2451 | 2567)
                    && group.iter().any(|&i| all[i].at == d.start))
            });
        }
        // 2403 compares a variable with the first declaration of its own symbol.
        let variables = |is_exported: bool| {
            group
                .iter()
                .filter(|&&i| all[i].is_variable && all[i].is_exported == is_exported)
                .count()
        };
        if variables(true) <= 1 && variables(false) <= 1 {
            out.retain(|d| {
                !(d.code == 2403
                    && group
                        .iter()
                        .any(|&i| all[i].is_variable && all[i].at == d.start))
            });
        }
    }

    /// `getDeclarationSpaces`, of the import that declares `name` in `block`.
    fn declaration_spaces_of_alias(&self, block: &Block, name: Atom) -> Option<u8> {
        let bound = self.bound(block.file);
        let scope = if block.module.is_none() {
            0
        } else {
            bound
                .scopes
                .iter()
                .position(|s| s.kind == ScopeKind::Module(block.module))?
        };
        let symbol = bound.lookup(bound.scopes.get(scope)?.locals, name)?;
        let target = self
            .files()
            .resolve_alias(self.files().sym(block.file, symbol))?;
        Some(self.declaration_spaces_of_symbol(target, 0))
    }

    /// `getDeclarationSpaces`, of all the declarations of `sym` together.
    fn declaration_spaces_of_symbol(&self, sym: Sym, depth: u32) -> u8 {
        let sym = self.files().canonical(sym);
        let mut spaces = 0;
        for (of, decl) in self.files().decls(sym) {
            let hir = self.hir(of);
            spaces |= match decl {
                Decl::Interface(_) | Decl::Alias(_) => SPACE_TYPE,
                Decl::Module(m)
                    if matches!(hir[m].name, ModuleName::Ident(_))
                        && module_instance_state(hir, self.bound(of), m) == NON_INSTANTIATED =>
                {
                    SPACE_NAMESPACE
                }
                Decl::Module(_) => SPACE_NAMESPACE | SPACE_VALUE,
                Decl::Class(_) | Decl::Enum(_) | Decl::EnumMember(_) => SPACE_TYPE | SPACE_VALUE,
                Decl::File => SPACE_TYPE | SPACE_VALUE | SPACE_NAMESPACE,
                Decl::Var(_) | Decl::Fn(_) | Decl::ImportSpec(_) => SPACE_VALUE,
                Decl::ExportExpr(_) if !self.files().flags(sym).contains(SymFlags::ALIAS) => {
                    SPACE_VALUE
                }
                Decl::ExportExpr(_)
                | Decl::ImportDefault(_)
                | Decl::ImportNamespace(_)
                | Decl::ImportEquals(_)
                    if depth < 8 =>
                {
                    match self.files().resolve_alias(sym) {
                        Some(target) if target != sym => {
                            self.declaration_spaces_of_symbol(target, depth + 1)
                        }
                        _ => 0,
                    }
                }
                _ => 0,
            };
        }
        spaces
    }

    // ───────────────────────────── erasableSyntaxOnly ─────────────────────────────

    /// 1294, from `checkEnumDeclaration`, `checkModuleDeclaration`, `checkImportEqualsDeclaration`, `checkExportAssignment` and
    /// `checkAssertion`. (`checkParameter` has its own.)
    fn check_erasable_syntax(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `shouldCheckErasableSyntax`
        if !self.p.files.options.erasable_syntax_only || hir.is_js {
            return;
        }
        let text = &hir.text[..];
        // `ShouldPreserveConstEnums`
        let preserves_const_enums =
            self.p.files.options.preserve_const_enums || self.p.files.options.isolated_modules;
        for (i, s) in hir.stmts.iter().enumerate() {
            let parent = bound.stmt_parent[i];
            // `checkGrammarModuleElementContext`: elsewhere something else is wrong, and that is all that is said.
            let is_module_element = matches!(parent, Parent::File | Parent::Module(_));
            let start = match s.kind {
                StmtKind::Enum(e)
                    if !matches!(parent, Parent::None)
                        && !hir[e].flags.contains(Flags::AMBIENT) =>
                {
                    hir[e].name_pos
                }
                StmtKind::Module(m)
                    if is_module_element
                        && !hir[m].flags.contains(Flags::AMBIENT)
                        && matches!(hir[m].name, ModuleName::Ident(_)) =>
                {
                    let state = module_instance_state(hir, bound, m);
                    if !(state == INSTANTIATED || preserves_const_enums && state == CONST_ENUM_ONLY)
                    {
                        continue;
                    }
                    hir[m].name_pos
                }
                StmtKind::ImportEquals(x)
                    if is_module_element && !hir[x].flags.contains(Flags::AMBIENT) =>
                {
                    s.pos
                }
                // `NodeFlagsAmbient`: in an ambient module or anywhere in a declaration file.
                StmtKind::ExportAssign(_)
                    if is_module_element
                        && hir.kind != FileKind::Declaration
                        && !matches!(parent, Parent::Module(m) if hir[m].flags.contains(Flags::AMBIENT)) =>
                {
                    s.pos
                }
                _ => continue,
            };
            out.push(Diagnostic { start, code: 1294 });
        }
        // `<T>e`, from the `<`.
        for (i, e) in hir.exprs.iter().enumerate() {
            if matches!(bound.expr_parent[i], Parent::None) {
                continue;
            }
            let less_than = match e.kind {
                // The type comes before the operand. In `x as T` it comes after.
                ExprKind::As { expr, ty } if hir[ty].pos < hir[expr].pos => {
                    skip_trivia_back(text, start_of_written_type(text, hir[ty].pos) as usize)
                }
                ExprKind::AsConst(operand) => {
                    let close = skip_trivia_back(text, self.start_of(file, operand) as usize);
                    if !text[..close].ends_with(b">") {
                        continue;
                    }
                    let word = skip_trivia_back(text, close - 1);
                    if word_before(text, word) != b"const" {
                        continue;
                    }
                    skip_trivia_back(text, word - 5)
                }
                _ => continue,
            };
            if text[..less_than].ends_with(b"<") {
                out.push(Diagnostic {
                    start: less_than as u32 - 1,
                    code: 1294,
                });
            }
        }
    }
}

/// Whether `e` calls the function `f` by its own name, which says nothing about what `f` returns.
fn is_call_of_itself(hir: &hir::File, bound: &Bound, f: FnId, e: ExprId) -> bool {
    let symbol = bound.fn_symbol[f.idx()];
    symbol.is_some()
        && matches!(hir[e].kind, ExprKind::Call(call) if matches!(hir[hir[call].callee].kind, ExprKind::Ident(_)) && bound.expr_symbol[hir[call].callee.idx()] == symbol)
}

fn overload_of_declared(d: &Declared, file: FileId, block: u32) -> Overload {
    Overload {
        file,
        parent: (file, 3, block),
        at: d.at,
        flags: d.flags & (Flags::EXPORT | Flags::AMBIENT),
        is_optional: false,
        is_function: d.what == DeclaredAs::Function,
        has_body: d.has_body,
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum DefaultState {
    Resolving,
    Resolved,
    Circular,
}

/// How far `getResolvedTypeParameterDefault` has got with each type parameter it was asked about, and the types written whose
/// working out is over and done with.
#[derive(Default)]
struct DefaultResolution {
    states: FxHashMap<(FileId, TypeParamId), DefaultState>,
    done: FxHashSet<(FileId, TypeNodeId)>,
}

/// What `look_for_awaited_type` keeps track of.
struct Awaiting {
    /// `awaitedTypeStack`
    stack: Vec<TypeId>,
    /// The types whose awaited type has been worked out: `cachedTypes`.
    settled: Vec<TypeId>,
    found: u8,
}

impl Awaiting {
    /// 1062
    const CIRCULAR: u8 = 1;
    /// It has a `then` that can be called, and is no promise.
    const THENABLE: u8 = 2;
    /// It rests on something that is not known.
    const UNKNOWN: u8 = 4;
}
