//! ESLint's `lib/rules/utils/ast-utils.js`.
//!
//! Every export is here under its name in snake case. What differs throughout:
//!
//! - No function takes `sourceCode` or a scope: a handle knows its file. Those that have no handle
//!   to ask take the `&File` first.
//! - A function is a [`Func`], whatever owns it. Where ESLint looks at `node.parent` of a function
//!   to find the `MethodDefinition`, the `PropertyDefinition` or the `Property`, that is done here.
//! - `ChainExpression` is not a node, so `skipChainExpression` is the identity and everything that
//!   calls it upstream takes the member access or the call itself.
//! - A name or a pattern that upstream takes as `string | RegExp` is an `Option<&str>` here, with a
//!   `_with` variant that takes functions.
//! - The predicates of tokens take `&Token`, which is what `Iterator::find`, `filter`,
//!   `take_while` and `skip_while` give: `file.tokens_after(node).find(is_comma_token)`.
//! - A location is a [`Span`], which is what `cx.report` takes.

use super::ancestor_memo::AncestorMemo;
use super::estree_compat::{
    estree_parent, estree_span, get_node_by_range_index, is_assignment_target, is_chain_root,
    is_expression_statement, is_in_type_query, type_annotation_span,
};
use super::text;
use crate::ast::{
    BinOp, Case, Chain, Expr, ExprKind, ExprTag, File, Flags, FnBody, FnKind, Func, Key, KeyKind,
    Member, MemberKind, Name, Node, PatKind, PatProp, Prop, PropKind, Stmt, StmtKind, UnOp,
    VarKind,
};
use crate::semantic::{Reference, Scope, Symbol};
use crate::span::{Position, Span, Spanned};
use crate::tokens::{Token, TokenKind, skip_trivia, skip_trivia_back, token_len};
use bun_core::strings;
use bun_sema::hir;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::borrow::Cow;

// ───────────────────────────── constants ─────────────────────────────

/// ESLint's `LINEBREAK_MATCHER.test(text)`. `LINEBREAK_MATCHER.exec` is
/// [`text::find_line_break`].
#[inline]
pub fn has_linebreak(text: &[u8]) -> bool {
    text::has_line_break(text)
}

/// ESLint's `createGlobalLinebreakMatcher`: where each line break of `text` starts, and its length
/// in bytes. `text.split(createGlobalLinebreakMatcher())` is [`text::lines`].
pub fn create_global_linebreak_matcher(text: &[u8]) -> impl Iterator<Item = (usize, usize)> + '_ {
    let mut from = 0;
    std::iter::from_fn(move || {
        let (at, len) = text::find_line_break(text.get(from..)?)?;
        let start = from + at;
        from = start + len;
        Some((start, len))
    })
}

/// ESLint's `SHEBANG_MATCHER`: what follows the `#!` that `text` starts with, to the end of the
/// line.
pub fn match_shebang(text: &[u8]) -> Option<&[u8]> {
    let rest = text.strip_prefix(b"#!")?;
    let end = strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len());
    (end > 0).then(|| &rest[..end])
}

/// ESLint's `COMMENTS_IGNORE_PATTERN.test(value)`, for the value of a comment.
pub fn matches_comments_ignore_pattern(value: &[u8]) -> bool {
    let rest = text::trim_start(value);
    if rest.starts_with(b"eslint") || rest.starts_with(b"jscs") {
        return true;
    }
    [
        "jshint", "jslint", "istanbul", "globals", "global", "exported",
    ]
    .iter()
    .filter_map(|word| rest.strip_prefix(word.as_bytes()))
    .any(|after| text::first_code_point(after).is_some_and(text::is_js_whitespace))
}

/// ESLint's `STATEMENT_LIST_PARENTS.has(node.type)`, for the parent of a statement: a `Program`, a
/// `BlockStatement`, a `StaticBlock` or a `SwitchCase`. The body of a function is a
/// `BlockStatement`, and the parent of a statement in it is the `Func`.
pub fn is_statement_list_parent(parent: Node<'_>) -> bool {
    match parent {
        Node::File(_) | Node::Func(_) | Node::Case(_) => true,
        Node::Stmt(statement) => matches!(
            statement.kind(),
            StmtKind::Block(_) | StmtKind::Switch { .. }
        ),
        _ => false,
    }
}

/// The version of ECMAScript that defines the global variable `name`, as
/// `LanguageOptions::ecma_version` counts them. ESLint's `conf/globals.js`.
pub fn ecmascript_global_since(name: &[u8]) -> Option<u32> {
    Some(match name {
        b"Array"
        | b"Boolean"
        | b"constructor"
        | b"Date"
        | b"decodeURI"
        | b"decodeURIComponent"
        | b"encodeURI"
        | b"encodeURIComponent"
        | b"Error"
        | b"escape"
        | b"eval"
        | b"EvalError"
        | b"Function"
        | b"hasOwnProperty"
        | b"Infinity"
        | b"isFinite"
        | b"isNaN"
        | b"isPrototypeOf"
        | b"Math"
        | b"NaN"
        | b"Number"
        | b"Object"
        | b"parseFloat"
        | b"parseInt"
        | b"propertyIsEnumerable"
        | b"RangeError"
        | b"ReferenceError"
        | b"RegExp"
        | b"String"
        | b"SyntaxError"
        | b"toLocaleString"
        | b"toString"
        | b"TypeError"
        | b"undefined"
        | b"unescape"
        | b"URIError"
        | b"valueOf" => 3,
        b"JSON" => 5,
        b"ArrayBuffer" | b"DataView" | b"Float32Array" | b"Float64Array" | b"Int16Array"
        | b"Int32Array" | b"Int8Array" | b"Intl" | b"Map" | b"Promise" | b"Proxy" | b"Reflect"
        | b"Set" | b"Symbol" | b"Uint16Array" | b"Uint32Array" | b"Uint8Array"
        | b"Uint8ClampedArray" | b"WeakMap" | b"WeakSet" => 2015,
        b"Atomics" | b"SharedArrayBuffer" => 2017,
        b"BigInt" | b"BigInt64Array" | b"BigUint64Array" | b"globalThis" => 2020,
        b"AggregateError" | b"FinalizationRegistry" | b"WeakRef" => 2021,
        b"Float16Array" | b"Iterator" => 2025,
        b"AsyncDisposableStack" | b"DisposableStack" | b"SuppressedError" | b"Temporal" => 2026,
        _ => return None,
    })
}

/// ESLint's `name in ECMASCRIPT_GLOBALS`: the latest version of ECMAScript defines the global
/// variable `name`.
#[inline]
pub fn is_ecmascript_global(name: &[u8]) -> bool {
    ecmascript_global_since(name).is_some()
}

/// Whether `name` is in oxlint's list of the built-in globals, which has neither `Temporal` nor what
/// the global object inherits from `Object.prototype`.
pub fn is_builtin_global_of_oxlint(name: &[u8]) -> bool {
    !matches!(
        name,
        b"constructor"
            | b"hasOwnProperty"
            | b"isPrototypeOf"
            | b"propertyIsEnumerable"
            | b"Temporal"
            | b"toLocaleString"
            | b"toString"
            | b"valueOf"
    ) && is_ecmascript_global(name)
}

// ───────────────────────────── tokens ─────────────────────────────

macro_rules! punctuator_predicates {
    ($($is:ident $is_js:literal, $is_not:ident $is_not_js:literal, $text:literal;)*) => {
        $(
            #[doc = concat!("ESLint's `", $is_js, "`.")]
            #[inline]
            pub fn $is(token: &Token<'_>) -> bool {
                token.is_punctuator($text)
            }

            #[doc = concat!("ESLint's `", $is_not_js, "`.")]
            #[inline]
            pub fn $is_not(token: &Token<'_>) -> bool {
                !token.is_punctuator($text)
            }
        )*
    };
}

punctuator_predicates! {
    is_dot_token "isDotToken", is_not_dot_token "isNotDotToken", ".";
    is_eq_token "isEqToken", is_not_eq_token "isNotEqToken", "=";
    is_question_dot_token "isQuestionDotToken", is_not_question_dot_token "isNotQuestionDotToken", "?.";
}

pub use super::eslint_utils::{
    is_arrow_token, is_closing_brace_token, is_closing_bracket_token, is_closing_paren_token,
    is_colon_token, is_comma_token, is_comment_token, is_not_arrow_token,
    is_not_closing_brace_token, is_not_closing_bracket_token, is_not_closing_paren_token,
    is_not_colon_token, is_not_comma_token, is_not_comment_token, is_not_opening_brace_token,
    is_not_opening_bracket_token, is_not_opening_paren_token, is_not_semicolon_token,
    is_opening_brace_token, is_opening_bracket_token, is_opening_paren_token, is_semicolon_token,
};

/// ESLint's `isKeywordToken`.
#[inline]
pub fn is_keyword_token(token: &Token<'_>) -> bool {
    token.kind() == TokenKind::Keyword
}

/// ESLint's `isTokenOnSameLine`: `left` ends on the line on which `right` starts. Each is a token,
/// a comment or a node.
pub fn is_token_on_same_line(file: &File<'_>, left: impl Spanned, right: impl Spanned) -> bool {
    let between = left.span().between(right.span());
    match between.start <= between.end {
        true => is_on_one_line(file, between),
        false => file.line_of(between.start) == file.line_of(between.end),
    }
}

/// Whether there is no line break in `span`. The start of it is looked at, where most that have one have the first. What is
/// left of a long one, such as many comments between two tokens, is asked of the lines of the file, which does not take time in
/// proportion to its length.
#[inline]
pub fn is_on_one_line(file: &File<'_>, span: Span) -> bool {
    const LOOKED_AT: u32 = 512;
    if span.len() <= LOOKED_AT {
        return !text::has_line_break(file.slice(span));
    }
    let middle = span.start + LOOKED_AT;
    !text::has_line_break(file.slice(Span::new(span.start, middle)))
        && file.is_on_same_line(middle, span.end)
}

/// What `equal_tokens` is for the texts `left` and `right`, if that shows without splitting them into tokens: they are compared
/// byte by byte, whitespace against whitespace. `None` where more than that is to be known: at a comment, a regular expression,
/// a template, an escape, a character that is not ASCII, and where only one of the two has whitespace, which may or may not
/// separate two tokens.
fn equal_tokens_of_plain_text(left: &[u8], right: &[u8]) -> Option<bool> {
    let is_blank = |byte: Option<&u8>| matches!(byte, Some(b'\t'..=b'\r' | b' '));
    let (mut l, mut r) = (0, 0);
    // The quote of the string that both are in.
    let mut quote = None;
    loop {
        if quote.is_none() && (is_blank(left.get(l)) || is_blank(right.get(r))) {
            if !is_blank(left.get(l)) || !is_blank(right.get(r)) {
                return None;
            }
            while is_blank(left.get(l)) {
                l += 1;
            }
            while is_blank(right.get(r)) {
                r += 1;
            }
        }
        let (a, b) = match (left.get(l), right.get(r)) {
            (None, None) => return Some(true),
            (Some(&a), Some(&b)) => (a, b),
            _ => return quote.is_none().then_some(false),
        };
        if a == b'\\' || b == b'\\' {
            return None;
        }
        if quote.is_none() {
            if matches!(a, b'/' | b'`' | 0x80..) || matches!(b, b'/' | b'`' | 0x80..) {
                return None;
            }
            // `<!--` and `-->` can start a comment.
            if a == b'-' && left.get(l + 1) == Some(&b'-')
                || b == b'-' && right.get(r + 1) == Some(&b'-')
            {
                return None;
            }
        }
        if a != b {
            return Some(false);
        }
        match quote {
            None if matches!(a, b'"' | b'\'') => quote = Some(a),
            Some(open) if open == a => quote = None,
            _ => {}
        }
        (l, r) = (l + 1, r + 1);
    }
}

/// ESLint's `equalTokens`: `left` and `right` consist of the same tokens.
pub fn equal_tokens<'a>(file: &'a File<'a>, left: impl Spanned, right: impl Spanned) -> bool {
    // In JSX whitespace can be text, and what a name is depends on where it is.
    if file.hir.jsx.is_empty()
        && let Some(answer) =
            equal_tokens_of_plain_text(file.slice(left.span()), file.slice(right.span()))
    {
        return answer;
    }
    let (left, right) = (file.tokens_in(left), file.tokens_in(right));
    left.len() == right.len()
        && left
            .zip(right)
            .all(|(l, r)| l.kind() == r.kind() && l.has_same_value(r))
}

/// ESLint's `canContinueExpressionInClassBody`.
pub fn can_continue_expression_in_class_body(token: &Token<'_>) -> bool {
    match token.kind() {
        TokenKind::Punctuator => token.is("[") || token.is("*"),
        TokenKind::Identifier | TokenKind::Keyword => token.is("in") || token.is("instanceof"),
        _ => false,
    }
}

/// `/^(?:0|0[0-7]*[89]\d*|[1-9](?:_?\d)*)$/u`
fn is_decimal_integer_text(raw: &[u8]) -> bool {
    match raw {
        [b'0'] => true,
        [b'0', rest @ ..] => {
            rest.iter().all(u8::is_ascii_digit) && strings::index_of_any(rest, b"89").is_some()
        }
        [b'1'..=b'9', rest @ ..] => {
            let mut after_separator = false;
            for &c in rest {
                match c {
                    b'_' if !after_separator => after_separator = true,
                    b'0'..=b'9' => after_separator = false,
                    _ => return false,
                }
            }
            !after_separator
        }
        _ => false,
    }
}

/// ESLint's `isDirectiveComment`.
pub fn is_directive_comment(comment: &Token<'_>) -> bool {
    let value = text::trim(comment.comment_value());
    match comment.kind() {
        TokenKind::Line => value.starts_with(b"eslint-"),
        TokenKind::Block => ["eslint-", "eslint ", "globals ", "global ", "exported "]
            .iter()
            .any(|prefix| value.starts_with(prefix.as_bytes())),
        _ => false,
    }
}

/// A token, or source text that is tokenized: what [`can_tokens_be_adjacent`] takes.
#[derive(Copy, Clone)]
pub enum TokenOrText<'t> {
    Token(TokenKind, &'t [u8]),
    Text(&'t [u8]),
}

impl<'t, 'a: 't> From<Token<'a>> for TokenOrText<'t> {
    #[inline]
    fn from(token: Token<'a>) -> Self {
        TokenOrText::Token(token.kind(), token.text())
    }
}
impl<'t, 'a: 't> From<&Token<'a>> for TokenOrText<'t> {
    #[inline]
    fn from(token: &Token<'a>) -> Self {
        TokenOrText::Token(token.kind(), token.text())
    }
}
impl<'t> From<&'t str> for TokenOrText<'t> {
    #[inline]
    fn from(text: &'t str) -> Self {
        TokenOrText::Text(text.as_bytes())
    }
}
impl<'t> From<&'t [u8]> for TokenOrText<'t> {
    #[inline]
    fn from(text: &'t [u8]) -> Self {
        TokenOrText::Text(text)
    }
}
impl<'t> From<&'t Vec<u8>> for TokenOrText<'t> {
    #[inline]
    fn from(text: &'t Vec<u8>) -> Self {
        TokenOrText::Text(text)
    }
}

type Piece<'t> = (TokenKind, &'t [u8]);

/// The end of the piece of a template that starts at `at`, after its `` ` `` or `}`, and whether a
/// substitution follows.
fn end_of_template_piece(text: &[u8], mut at: usize) -> Option<(usize, bool)> {
    loop {
        at += strings::index_of_any(text.get(at..)?, b"`$\\")?;
        match text[at] {
            b'`' => return Some((at + 1, false)),
            b'$' if text.get(at + 1) == Some(&b'{') => return Some((at + 2, true)),
            b'$' => at += 1,
            _ => at += 2,
        }
    }
}

fn end_of_string(text: &[u8], start: usize) -> Option<usize> {
    let quote = text[start];
    let mut at = start + 1;
    loop {
        match *text.get(at)? {
            b'\\' => {
                at += if text.get(at + 1..at + 3) == Some(b"\r\n") {
                    3
                } else {
                    2
                }
            }
            b'\n' | b'\r' => return None,
            c if c == quote => return Some(at + 1),
            _ => at += 1,
        }
    }
}

fn end_of_regex(text: &[u8], start: usize) -> Option<usize> {
    let (mut at, mut in_class) = (start + 1, false);
    loop {
        if text::line_break_len(text.get(at..)?) != 0 {
            return None;
        }
        match *text.get(at)? {
            b'\\' => at += 1,
            b'[' => in_class = true,
            b']' => in_class = false,
            b'/' if !in_class => break,
            _ => {}
        }
        at += 1;
    }
    Some(bun_core::lexer::end_of_run(text, at + 1, |c| {
        text::is_identifier_part(c as u32)
    }))
}

/// A word after which a `/` starts a regular expression.
fn is_keyword_before_expression(word: &[u8]) -> bool {
    matches!(
        word,
        b"await"
            | b"case"
            | b"delete"
            | b"do"
            | b"else"
            | b"in"
            | b"instanceof"
            | b"new"
            | b"of"
            | b"return"
            | b"throw"
            | b"typeof"
            | b"void"
            | b"yield"
    )
}

/// The first and the last of the tokens and comments of `text`. `None` if there are none, or if
/// `text` cannot be tokenized.
fn first_and_last_token(text: &[u8]) -> Option<(Piece<'_>, Piece<'_>)> {
    let mut first = None;
    let mut last = None;
    // Whether a `/` starts a regular expression, as opposed to dividing by what precedes it.
    let mut is_regex_allowed = true;
    // For each open `{`, whether it is the `${` of a template.
    let mut braces: SmallVec<[bool; 8]> = SmallVec::new();
    let mut at = 0;
    loop {
        at = bun_core::lexer::end_of_run(text, at, |c| text::is_js_whitespace(c as u32));
        let Some(&c) = text.get(at) else {
            break;
        };
        let next = text.get(at + 1).copied();
        let (kind, end) = match c {
            b'/' if next == Some(b'/') => {
                let rest = &text[at..];
                (
                    TokenKind::Line,
                    at + text::find_line_break(rest).map_or(rest.len(), |it| it.0),
                )
            }
            b'/' if next == Some(b'*') => (
                TokenKind::Block,
                at + 4 + strings::index_of(text.get(at + 2..)?, b"*/")?,
            ),
            b'/' if is_regex_allowed => (TokenKind::RegularExpression, end_of_regex(text, at)?),
            b'"' | b'\'' => (TokenKind::String, end_of_string(text, at)?),
            b'`' => {
                let (end, opens) = end_of_template_piece(text, at + 1)?;
                if opens {
                    braces.push(true);
                }
                (TokenKind::Template, end)
            }
            b'}' if braces.last() == Some(&true) => {
                let (end, opens) = end_of_template_piece(text, at + 1)?;
                if !opens {
                    braces.pop();
                }
                (TokenKind::Template, end)
            }
            b'#' if at == 0 && next == Some(b'!') => (
                TokenKind::Shebang,
                text::find_line_break(text).map_or(text.len(), |it| it.0),
            ),
            b'#' => (
                TokenKind::PrivateIdentifier,
                at + 1 + token_len(&text[at + 1..]),
            ),
            b'0'..=b'9' => (TokenKind::Numeric, at + token_len(&text[at..])),
            b'.' if next.is_some_and(|c| c.is_ascii_digit()) => {
                (TokenKind::Numeric, at + token_len(&text[at..]))
            }
            _ => {
                let end = at + token_len(&text[at..]).max(1);
                let is_word = c == b'\\'
                    || text::first_code_point(&text[at..]).is_some_and(text::is_identifier_start);
                match is_word {
                    true if is_keyword_before_expression(&text[at..end]) => {
                        (TokenKind::Keyword, end)
                    }
                    true => (TokenKind::Identifier, end),
                    false => {
                        match c {
                            b'{' => braces.push(false),
                            b'}' => _ = braces.pop(),
                            _ => {}
                        }
                        (TokenKind::Punctuator, end)
                    }
                }
            }
        };
        let piece = (kind, text.get(at..end)?);
        first = first.or(Some(piece));
        last = Some(piece);
        is_regex_allowed = match piece {
            (TokenKind::Punctuator, b"++" | b"--") => is_regex_allowed,
            (TokenKind::Punctuator, text) => !matches!(text, b")" | b"]" | b"}"),
            (TokenKind::Keyword, _) => true,
            (kind, _) => kind.is_comment() && is_regex_allowed,
        };
        at = end;
    }
    Some((first?, last?))
}

/// ESLint's `canTokensBeAdjacent`: whether `left` directly followed by `right` is still these two
/// tokens. Each is a [`Token`], or text, of which the last or the first token counts.
pub fn can_tokens_be_adjacent<'t>(
    left: impl Into<TokenOrText<'t>>,
    right: impl Into<TokenOrText<'t>>,
) -> bool {
    use TokenKind::{
        Block, Line, Numeric, PrivateIdentifier, Punctuator, RegularExpression, Shebang, String,
        Template,
    };
    let left = match left.into() {
        TokenOrText::Token(kind, text) => Some((kind, text)),
        TokenOrText::Text(text) => first_and_last_token(text).map(|it| it.1),
    };
    let right = match right.into() {
        TokenOrText::Token(kind, text) => Some((kind, text)),
        TokenOrText::Text(text) => first_and_last_token(text).map(|it| it.0),
    };
    let (Some((left, left_text)), Some((right, right_text))) = (left, right) else {
        return false;
    };
    if left == Shebang {
        return false;
    }
    if left == Punctuator || right == Punctuator {
        if left == Punctuator && right == Punctuator {
            let both = |a: &[u8], b: &[u8]| {
                (left_text == a || left_text == b) && (right_text == a || right_text == b)
            };
            return !(both(b"+", b"++") || both(b"-", b"--"));
        }
        if left == Punctuator && left_text == b"/" {
            return !matches!(right, Block | Line | RegularExpression);
        }
        return true;
    }
    matches!(left, String | Template | Block)
        || matches!(right, String | Template | Block | Line | PrivateIdentifier)
        || (left != Numeric && right == Numeric && right_text.starts_with(b"."))
}

/// ESLint's `getNameLocationInGlobalDirectiveComment`: where `name` is written in a
/// `/* global name */` comment.
pub fn get_name_location_in_global_directive_comment(comment: &Token<'_>, name: &[u8]) -> Span {
    let value = comment.comment_value();
    let base = comment.start() + 2;
    let is_separator = |c: u32| text::is_js_whitespace(c) || c == u32::from(b',');
    let limit = strings::index_of(value, b"global")
        .map_or(5, |at| at + 6)
        .min(value.len());
    let mut from = limit;
    while !name.is_empty()
        && let Some(found) = value
            .get(from..)
            .and_then(|rest| strings::index_of(rest, name))
    {
        let at = from + found;
        let after = text::first_code_point(&value[at + name.len()..]);
        if text::last_code_point(&value[limit..at]).is_some_and(is_separator)
            && after.is_none_or(|c| is_separator(c) || c == u32::from(b':'))
        {
            let start = base + at as u32;
            return Span::new(start, start + name.len() as u32);
        }
        from = at + 1;
    }
    Span::new(base, base + 1)
}

// ───────────────────────────── kinds of nodes ─────────────────────────────

/// Whether `func` is a `FunctionDeclaration`, a `FunctionExpression` or an
/// `ArrowFunctionExpression` of ESTree: it has a body, and is not a static block.
#[inline]
pub fn is_function_with_body(func: Func<'_>) -> bool {
    func.has_body() && func.kind() != FnKind::StaticBlock
}

/// Whether ESTree calls `member` a `PropertyDefinition`.
pub fn is_property_definition(member: Member<'_>) -> bool {
    member.kind() == MemberKind::Property
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && matches!(member.parent(), Node::Class(_))
}

/// The function that `node` is, if ESLint's `isFunction` holds for it: a `Func`, or the `Expr` or
/// the `Stmt` that owns one.
#[inline]
pub fn as_function<'a>(node: impl Into<Node<'a>>) -> Option<Func<'a>> {
    function_of(node.into())
}

fn function_of(node: Node<'_>) -> Option<Func<'_>> {
    let func = match node {
        Node::Func(func) => func,
        Node::Expr(e) => e.as_fn()?,
        Node::Stmt(statement) => match statement.kind() {
            StmtKind::Fn(func) => func,
            _ => return None,
        },
        _ => return None,
    };
    is_function_with_body(func).then_some(func)
}

/// ESLint's `isFunction`. An overload, a signature, a function type and a static block are not
/// functions: ESTree has other nodes for them.
#[inline]
pub fn is_function<'a>(node: impl Into<Node<'a>>) -> bool {
    as_function(node).is_some()
}

/// ESLint's `isLoop`.
#[inline]
pub fn is_loop<'a>(node: impl Into<Node<'a>>) -> bool {
    matches!(node.into(), Node::Stmt(statement) if statement.is_loop())
}

/// ESLint's `isInLoop`: `node` is a loop or is in one, in the same function.
pub fn is_in_loop<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    for at in std::iter::once(node).chain(node.ancestors()) {
        if is_function(at) {
            return false;
        }
        if is_loop(at) {
            return true;
        }
    }
    false
}

/// ESLint's `getUpperFunction`: `node` if it is a function, or else the innermost function around
/// it.
pub fn get_upper_function<'a>(node: impl Into<Node<'a>>) -> Option<Func<'a>> {
    let node = node.into();
    std::iter::once(node)
        .chain(node.ancestors())
        .find_map(as_function)
}

/// ESLint's `isBreakableStatement`: a loop or a `switch`.
#[inline]
pub fn is_breakable_statement(statement: Stmt<'_>) -> bool {
    statement.is_loop() || matches!(statement.kind(), StmtKind::Switch { .. })
}

/// `node.type === "Literal"`
#[inline]
pub fn is_literal(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
    )
}

/// `node.type === "MemberExpression"`: an `ExprKind::Dot` or an `ExprKind::Index`, but not the `a.b`
/// of `<a.b />`, a `JSXMemberExpression`, nor that of the type `typeof a.b`, a `TSQualifiedName`.
pub fn is_member_expression(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Index { .. } => true,
        ExprKind::Dot { .. } => !e.is_jsx_tag_name() && !is_in_type_query(e),
        _ => false,
    }
}

/// ESLint's `isNullLiteral`.
#[inline]
pub fn is_null_literal(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Null)
}

/// ESLint's `isNullOrUndefined`: `null`, `undefined` or `void something`.
pub fn is_null_or_undefined(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::Null | ExprKind::Unary { op: UnOp::Void, .. } => true,
        ExprKind::Ident(name) => name.is("undefined"),
        _ => false,
    }
}

/// ESLint's `isStringLiteral`: a string literal or a template literal.
#[inline]
pub fn is_string_literal(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::String(_) | ExprKind::Template(_))
}

/// ESLint's `isNumericLiteral`: a number or a bigint.
#[inline]
pub fn is_numeric_literal(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Number(_) | ExprKind::BigInt(_))
}

/// ESLint's `isStaticTemplateLiteral`: a template literal without substitutions.
#[inline]
pub fn is_static_template_literal(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Template(template) if template.exprs().is_empty())
}

/// ESLint's `isDecimalInteger`: `5`, `1_000`, `089`, but not `5.0`, `0x5`, `05`, `5e0` or `5n`.
#[inline]
pub fn is_decimal_integer(e: Expr<'_>) -> bool {
    matches!(e.kind(), ExprKind::Number(_)) && is_decimal_integer_text(e.text())
}

/// ESLint's `isLogicalExpression`: `&&` or `||`, not `??`.
#[inline]
pub fn is_logical_expression(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or,
            ..
        }
    )
}

/// ESLint's `isCoalesceExpression`: `??`.
#[inline]
pub fn is_coalesce_expression(e: Expr<'_>) -> bool {
    matches!(
        e.kind(),
        ExprKind::Binary {
            op: BinOp::Nullish,
            ..
        }
    )
}

/// ESLint's `isMixedLogicalAndCoalesceExpressions`.
pub fn is_mixed_logical_and_coalesce_expressions(left: Expr<'_>, right: Expr<'_>) -> bool {
    (is_logical_expression(left) && is_coalesce_expression(right))
        || (is_coalesce_expression(left) && is_logical_expression(right))
}

/// ESLint's `isLogicalAssignmentOperator`, for the `op` of an `ExprKind::Assign`: `&&=`, `||=` or
/// `??=`.
#[inline]
pub fn is_logical_assignment_operator(op: Option<BinOp>) -> bool {
    matches!(op, Some(BinOp::And | BinOp::Or | BinOp::Nullish))
}

/// ESLint's `isCallee`: `e` is what a call calls. Not what `new` constructs.
#[inline]
pub fn is_callee(e: Expr<'_>) -> bool {
    matches!(e.parent().as_expr().map(Expr::kind), Some(ExprKind::Call(call)) if call.callee() == e)
}

/// ESLint's `isEmptyBlock`. The body of a function is not a `Stmt`: see [`is_empty_function`].
#[inline]
pub fn is_empty_block(statement: Stmt<'_>) -> bool {
    statement.as_block().is_some_and(|body| body.is_empty())
}

/// ESLint's `isEmptyFunction`: its body is a block without statements.
#[inline]
pub fn is_empty_function(func: Func<'_>) -> bool {
    is_function_with_body(func) && func.body_statements().is_some_and(|body| body.is_empty())
}

/// ESLint's `isDirective`: the parser has given the statement a `directive`. espree gives none in ES3.
/// typescript-estree does not ask for the version, and also gives one to the strings at the start of
/// a static block.
pub fn is_directive(statement: Stmt<'_>) -> bool {
    let file = statement.file();
    if !file.uses_typescript_parser() {
        return file.language().ecma_version >= 5 && statement.directive().is_some();
    }
    let is_string = |it: &Stmt<'_>| matches!(it.kind(), StmtKind::Expr(e) if e.as_string().is_some() && !e.is_parenthesized());
    match statement.parent() {
        Node::Func(block) if block.kind() == FnKind::StaticBlock => {
            let statements = block.body_statements().into_iter().flatten();
            statements.take_while(is_string).any(|it| it == statement)
        }
        _ => statement.directive().is_some(),
    }
}

/// ESLint's `isTopLevelExpressionStatement`: an expression statement directly in the file, in a
/// namespace or in the body of a function.
pub fn is_top_level_expression_statement(statement: Stmt<'_>) -> bool {
    is_expression_statement(statement)
        && match statement.parent() {
            Node::File(_) => true,
            Node::Func(func) => func.kind() != FnKind::StaticBlock,
            Node::Stmt(parent) => matches!(parent.kind(), StmtKind::Module(_)),
            _ => false,
        }
}

/// ESLint's `isStartOfExpressionStatement`: an expression statement starts with the first token of
/// `node`.
pub fn is_start_of_expression_statement<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    let start = node.span().start;
    node.ancestors()
        .take_while(|ancestor| !matches!(ancestor, Node::File(_)) && ancestor.span().start == start)
        .any(|it| matches!(it, Node::Stmt(statement) if is_expression_statement(statement)))
}

/// ESLint's `getDirectivePrologue`, for a `File` or a function: the expression statements at the
/// start of its body that consist of a literal.
pub fn get_directive_prologue<'a>(node: impl Into<Node<'a>>) -> impl Iterator<Item = Stmt<'a>> {
    let node = node.into();
    let statements = match node {
        Node::File(file) => Some(file.body()),
        _ => as_function(node).and_then(Func::body_statements),
    };
    statements
        .into_iter()
        .flatten()
        .take_while(|it| matches!(it.kind(), StmtKind::Expr(e) if is_literal(e)))
}

/// ESLint's `getTrailingStatement`, which is `esutils.ast.trailingStatement`: the statement that
/// `statement` ends with. It knows nothing of `for`-`of`.
pub fn get_trailing_statement(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    match statement.kind() {
        StmtKind::If { yes, no, .. } => Some(no.unwrap_or(yes)),
        StmtKind::Labeled { body, .. }
        | StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::While { body, .. }
        | StmtKind::With { body, .. } => Some(body),
        _ => None,
    }
}

/// ESLint's `areBracesNecessary`, for a block with one statement: without the braces, the
/// statement would be a declaration where none is allowed, or an `else` after the block would
/// belong to an `if` in it.
pub fn are_braces_necessary(block: Stmt<'_>) -> bool {
    are_braces_necessary_if(block, || {
        let text = block.file().text();
        let next = text
            .get(skip_trivia(text, block.span().end) as usize..)
            .unwrap_or_default();
        next.starts_with(b"else") && token_len(next) == 4
    })
}

/// [`are_braces_necessary`], where `is_followed_by_else` says whether an `else` follows the block.
pub fn are_braces_necessary_if(
    block: Stmt<'_>,
    is_followed_by_else: impl FnOnce() -> bool,
) -> bool {
    fn has_unsafe_if(statement: Stmt<'_>) -> bool {
        let mut at = statement;
        loop {
            at = match at.kind() {
                StmtKind::If { no: None, .. } => return true,
                StmtKind::If { no: Some(no), .. } => no,
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::Labeled { body, .. }
                | StmtKind::With { body, .. }
                | StmtKind::While { body, .. } => body,
                _ => return false,
            }
        }
    }
    let Some(statement) = block.as_block().and_then(|body| body.first()) else {
        return false;
    };
    let is_lexical_declaration = match statement.kind() {
        StmtKind::Var(declarations) => declarations
            .first()
            .is_some_and(|it| it.var_kind() != VarKind::Var),
        StmtKind::Fn(func) => func.has_body(),
        StmtKind::Class(_) => true,
        _ => false,
    };
    is_lexical_declaration || has_unsafe_if(statement) && is_followed_by_else()
}

// ───────────────────────────── values and names ─────────────────────────────

/// ESTree's `Literal.bigint`: the digits as they are written, without the `n` and the `_`.
pub fn get_bigint_text(e: Expr<'_>) -> Cow<'_, [u8]> {
    let raw = e.text();
    let digits = raw.strip_suffix(b"n").unwrap_or(raw);
    match strings::contains_char(digits, b'_') {
        false => Cow::Borrowed(digits),
        true => Cow::Owned(digits.iter().copied().filter(|&c| c != b'_').collect()),
    }
}

/// ESLint's `getStaticStringValue`: `String(value)` of a literal or of a template literal without
/// substitutions.
pub fn get_static_string_value(e: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    Some(match e.kind() {
        ExprKind::String(value) => Cow::Borrowed(value.bytes()),
        ExprKind::Number(value) => Cow::Owned(text::number_to_string(value)),
        ExprKind::True => Cow::Borrowed(b"true"),
        ExprKind::False => Cow::Borrowed(b"false"),
        ExprKind::Null => Cow::Borrowed(b"null"),
        ExprKind::Regex(regex) => {
            // `String(regex)` has the flags in the order of `RegExp.prototype.flags`.
            let flags = regex.flags();
            match flags.is_sorted() {
                true => Cow::Borrowed(e.text()),
                false => {
                    let mut text = e.text().to_vec();
                    let at = text.len() - flags.len();
                    crate::utils::sort::sort_unstable(&mut text[at..]);
                    Cow::Owned(text)
                }
            }
        }
        // In decimal notation.
        ExprKind::BigInt(value) => Cow::Borrowed(value.bytes()),
        ExprKind::Template(template) => Cow::Borrowed(template.as_static()?.bytes()),
        _ => return None,
    })
}

/// ESLint's `getStaticPropertyName`, for a [`Key`]. `None` for a private name and for a computed
/// key that is not a literal.
pub fn get_static_key_name(key: Key<'_>) -> Option<Cow<'_, [u8]>> {
    match key.kind() {
        KeyKind::Ident(name)
        | KeyKind::String(name)
        | KeyKind::Number(name)
        | KeyKind::ComputedString(name)
        | KeyKind::ComputedNumber(name) => Some(Cow::Borrowed(name.bytes())),
        KeyKind::Private(_) => None,
        KeyKind::Computed(e) => get_static_string_value(e),
    }
}

/// ESLint's `getStaticPropertyName`: the name of the property that a member access (`Expr`)
/// reads, or that a `Prop`, a `Member` or a `PatProp` defines, if it is known without evaluating
/// anything. `None` for a private name.
#[inline]
pub fn get_static_property_name<'a>(node: impl Into<Node<'a>>) -> Option<Cow<'a, [u8]>> {
    static_property_name_of(node.into())
}

fn static_property_name_of(node: Node<'_>) -> Option<Cow<'_, [u8]>> {
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::Dot { name, .. } if !name.bytes().starts_with(b"#") => {
                Some(Cow::Borrowed(name.bytes()))
            }
            ExprKind::Index { index, .. } => get_static_string_value(index),
            _ => None,
        },
        Node::Prop(prop) => get_static_key_name(prop.key()?),
        Node::PatProp(prop) => get_static_key_name(prop.key()?),
        Node::Member(member) if member.kind() == MemberKind::Constructor => {
            Some(Cow::Borrowed(b"constructor"))
        }
        Node::Member(member) => get_static_key_name(member.key()?),
        _ => None,
    }
}

/// ESLint's `skipChainExpression`. `ChainExpression` is not a node, so this is `e`.
#[inline]
pub fn skip_chain_expression(e: Expr<'_>) -> Expr<'_> {
    e
}

/// ESLint's `isSpecificId`.
#[inline]
pub fn is_specific_id(e: Expr<'_>, name: &str) -> bool {
    e.is_ident(name)
}

/// ESLint's `isSpecificId` with a `RegExp`.
#[inline]
pub fn is_specific_id_with(e: Expr<'_>, name: impl FnOnce(&[u8]) -> bool) -> bool {
    e.as_ident().is_some_and(|it| name(it.bytes()))
}

/// The object of a member access.
#[inline]
pub fn member_object(e: Expr<'_>) -> Option<Expr<'_>> {
    match e.kind() {
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
        _ => None,
    }
}

/// ESLint's `isSpecificMemberAccess`: `e` is `objectName.propertyName`,
/// `objectName["propertyName"]` or the same with `?.`. `None` allows anything.
pub fn is_specific_member_access(
    e: Expr<'_>,
    object_name: Option<&str>,
    property_name: Option<&str>,
) -> bool {
    let Some(object) = member_object(e) else {
        return false;
    };
    object_name.is_none_or(|name| object.is_ident(name))
        && property_name.is_none_or(|name| match e.kind() {
            ExprKind::Dot { name: written, .. } => written.name().is(name),
            _ => get_static_property_name(e).is_some_and(|it| *it == *name.as_bytes()),
        })
}

/// Whether `e` is a member access whose property has one of `names`, whatever the object.
pub fn is_member_access_of_any(e: Expr<'_>, names: &[&str]) -> bool {
    match e.kind() {
        ExprKind::Dot { name, .. } => name.name().is_any(names),
        ExprKind::Index { .. } => get_static_property_name(e)
            .is_some_and(|it| names.iter().any(|name| *it == *name.as_bytes())),
        _ => false,
    }
}

/// ESLint's `equalLiteralValue`, for two literals.
pub fn equal_literal_value<'a>(left: Expr<'a>, right: Expr<'a>) -> bool {
    match (left.kind(), right.kind()) {
        (ExprKind::Regex(l), ExprKind::Regex(r)) => {
            l.pattern() == r.pattern() && l.flags() == r.flags()
        }
        (ExprKind::BigInt(_), ExprKind::BigInt(_)) => {
            get_bigint_text(left) == get_bigint_text(right)
        }
        (ExprKind::String(l), ExprKind::String(r)) => l == r,
        (ExprKind::Number(l), ExprKind::Number(r)) => l == r,
        (ExprKind::True, ExprKind::True)
        | (ExprKind::False, ExprKind::False)
        | (ExprKind::Null, ExprKind::Null) => true,
        _ => false,
    }
}

/// ESLint's `isSameReference`: `a` and `b` are the same variable or the same chain of
/// member accesses: `a.b.c` and `a["b"]?.c`. With `disable_static_computed_key`, `a.b` and `a["b"]`
/// are not the same.
pub fn is_same_reference<'a>(a: Expr<'a>, b: Expr<'a>, disable_static_computed_key: bool) -> bool {
    let (mut left, mut right) = (a, b);
    loop {
        let (left_object, right_object) = match (left.kind(), right.kind()) {
            (ExprKind::Super, ExprKind::Super) | (ExprKind::This, ExprKind::This) => return true,
            (ExprKind::Ident(l), ExprKind::Ident(r))
            | (ExprKind::PrivateIdentifier(l), ExprKind::PrivateIdentifier(r)) => return l == r,
            (
                ExprKind::Dot {
                    obj: l, name: a, ..
                },
                ExprKind::Dot {
                    obj: r, name: b, ..
                },
            ) => {
                if a.name() != b.name() {
                    return false;
                }
                (l, r)
            }
            (
                ExprKind::Dot { obj: l, .. } | ExprKind::Index { obj: l, .. },
                ExprKind::Dot { obj: r, .. } | ExprKind::Index { obj: r, .. },
            ) => {
                let name = match disable_static_computed_key {
                    true => None,
                    false => get_static_property_name(left),
                };
                let is_same_property = match (name, left.kind(), right.kind()) {
                    (Some(name), ..) => Some(name) == get_static_property_name(right),
                    (None, ExprKind::Index { index: a, .. }, ExprKind::Index { index: b, .. }) => {
                        is_same_reference(a, b, disable_static_computed_key)
                    }
                    _ => false,
                };
                if !is_same_property {
                    return false;
                }
                (l, r)
            }
            _ => return is_literal(left) && is_literal(right) && equal_literal_value(left, right),
        };
        (left, right) = (left_object, right_object);
    }
}

/// ESLint's `getBooleanValue`, for a literal: whether it is truthy.
pub fn get_boolean_value(e: Expr<'_>) -> Option<bool> {
    Some(match e.kind() {
        ExprKind::Null | ExprKind::False => false,
        ExprKind::True | ExprKind::Regex(_) => true,
        ExprKind::String(value) => !value.bytes().is_empty(),
        ExprKind::Number(value) => value != 0.0 && !value.is_nan(),
        ExprKind::BigInt(_) => {
            let digits = get_bigint_text(e);
            let digits = match digits.get(..2) {
                Some([b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B']) => &digits[2..],
                _ => &digits[..],
            };
            digits.iter().any(|&c| c != b'0')
        }
        _ => return None,
    })
}

/// ESLint's `isSurroundedBy`.
#[inline]
pub fn is_surrounded_by(value: &[u8], character: u8) -> bool {
    value.first() == Some(&character) && value.last() == Some(&character)
}

/// ESLint's `hasOctalOrNonOctalDecimalEscapeSequence`, for the raw text of a string: it has `\1` to
/// `\9`, or `\0` before a digit.
pub fn has_octal_or_non_octal_decimal_escape_sequence(raw: &[u8]) -> bool {
    let mut at = 0;
    while let Some(found) = raw
        .get(at..)
        .and_then(|rest| strings::index_of_char_usize(rest, b'\\'))
    {
        at += found + 1;
        match raw.get(at) {
            Some(b'1'..=b'9') => return true,
            Some(b'0') if raw.get(at + 1).is_some_and(u8::is_ascii_digit) => return true,
            _ => at += 1,
        }
    }
    false
}

/// ESLint's `startsWithUpperCase`.
pub fn starts_with_upper_case(name: &[u8]) -> bool {
    match name.first() {
        None => false,
        Some(first) if first.is_ascii() => first.is_ascii_uppercase(),
        Some(_) => {
            let size = bun_core::lexer::char_and_size(name, 0).1;
            !text::is_lower_case(&name[..size])
        }
    }
}

// ───────────────────────────── precedence and parentheses ─────────────────────────────

/// ESLint's `getPrecedence({ type: "BinaryExpression", operator })`, or with `"LogicalExpression"`
/// or `"SequenceExpression"`: that of an `ExprKind::Binary` with the operator `op`.
pub fn get_binary_operator_precedence(op: BinOp) -> i32 {
    match op {
        BinOp::Comma => 0,
        BinOp::Or | BinOp::Nullish => 4,
        BinOp::And => 5,
        BinOp::BitOr => 6,
        BinOp::BitXor => 7,
        BinOp::BitAnd => 8,
        BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq => 9,
        BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge | BinOp::In | BinOp::Instanceof => 10,
        BinOp::Shl | BinOp::Shr | BinOp::UShr => 11,
        BinOp::Add | BinOp::Sub => 12,
        BinOp::Mul | BinOp::Div | BinOp::Rem => 13,
        BinOp::Pow => 15,
    }
}

/// ESLint's `getPrecedence`. The root of an optional chain is a `ChainExpression`, 18. It is -1 for
/// the expressions of TypeScript, which ESLint does not know.
pub fn get_precedence(e: Expr<'_>) -> i32 {
    match e.kind() {
        ExprKind::Binary { op, .. } => get_binary_operator_precedence(op),
        ExprKind::Assign { op: None, .. } if is_assignment_target(e) => 20,
        ExprKind::Assign { .. } | ExprKind::Yield { .. } => 1,
        ExprKind::Fn(func) if func.is_arrow() => 1,
        ExprKind::Cond { .. } => 3,
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            ..
        } => 17,
        ExprKind::Unary { .. } | ExprKind::Await(_) => 16,
        ExprKind::Call(_) | ExprKind::ImportCall { .. } => 18,
        ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::NonNull(_)
            if is_chain_root(e) =>
        {
            18
        }
        ExprKind::New(_) => 19,
        ExprKind::As { .. }
        | ExprKind::AsConst(_)
        | ExprKind::Satisfies { .. }
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. } => -1,
        _ => 20,
    }
}

/// The `(` directly before `span` and the `)` directly after it, if both are there.
fn parentheses_around(text: &[u8], span: Span) -> Option<Span> {
    let before = skip_trivia_back(text, span.start).checked_sub(1)?;
    let after = skip_trivia(text, span.end);
    (text.get(before as usize) == Some(&b'(') && text.get(after as usize) == Some(&b')'))
        .then(|| Span::new(before, after + 1))
}

/// ESLint's `isParenthesised`: the token before `node` is a `(` and the token after it a `)`.
///
/// This also holds for the `a` of `f(a)`, `if (a)` and `new (a)`, whose parentheses are not around
/// the expression but part of the syntax of the parent. [`Expr::is_parenthesized`] is without
/// those, as is `isParenthesized` of `eslint-utils`.
pub fn is_parenthesised<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    parentheses_around(node.file().text(), node.span()).is_some()
}

/// ESLint's `getParenthesisedText`: the text of `node` with every pair of parentheses directly
/// around it, those of [`is_parenthesised`].
pub fn get_parenthesised_text<'a>(node: impl Into<Node<'a>>) -> &'a [u8] {
    let node = node.into();
    let (file, mut span) = (node.file(), node.span());
    while let Some(outer) = parentheses_around(file.text(), span) {
        span = outer;
    }
    file.slice(span)
}

// ───────────────────────────── scopes ─────────────────────────────

/// Whether something other than the code of the file defines the global variable `name`, as a
/// value: [`File::global`].
#[inline]
pub fn is_configured_global<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    file.global(name)
        .is_some_and(|global| global.accepts(false))
}

/// ESLint's `sourceCode.isGlobalReference`: `e` is an identifier that refers to a global variable
/// which the file does not declare, but the configuration, a `/* global */` comment or a library of
/// TypeScript does.
///
/// It goes by the scopes as ESLint has them, not by [`Expr::symbol`]: `namespace Promise {}` hides
/// the global although it has no value, what another block of a merged namespace exports does not,
/// and `interface Object {}` in a script is a definition of the global variable itself.
///
/// The rules of ESLint 8 that ask this today went by the name. With a configuration of ESLint 8, which has `Promise` only if `env`
/// says so, nothing need declare the variable.
pub fn is_global_reference(e: Expr<'_>) -> bool {
    let (Some(name), file) = (e.as_ident(), e.file()) else {
        return false;
    };
    (file.global_named(name).is_some() || file.language().eslint_8.is_some())
        && e.reference().is_some_and(|it| it.global().is_some())
        && file.scope().get_name(name).is_none()
}

/// ESLint's `isReferenceToGlobalVariable(sourceCode.getScope(node), e)`, for a `node` that `e` is or
/// is in, with no function or class between them: [`is_global_reference`], but upstream looks for the
/// reference among those of that scope, where it is not if `e` is in the discriminant of a `switch`,
/// the object of a `with`, or a decorator of a class or of a parameter.
pub fn is_reference_to_global_variable(e: Expr<'_>) -> bool {
    is_global_reference(e)
        && e.reference()
            .is_some_and(|it| it.scope() == Node::Expr(e).scope())
}

/// ESLint's `getVariableByName`. A global variable that the file does not declare is not a
/// [`Symbol`]: see [`is_configured_global`].
#[inline]
pub fn get_variable_by_name<'a>(scope: Scope<'a>, name: &str) -> Option<Symbol<'a>> {
    scope.resolve(name)
}

/// ESLint's `getModifyingReferences`: those of the references to a variable that write to it,
/// other than the initializer of its declaration.
pub fn get_modifying_references<'a>(
    references: impl IntoIterator<Item = Reference<'a>>,
) -> impl Iterator<Item = Reference<'a>> {
    let mut previous = None;
    references.into_iter().filter(move |reference| {
        let span = reference.span();
        let is_other_identifier = previous.replace(span) != Some(span);
        !reference.is_init() && reference.is_write() && is_other_identifier
    })
}

// ───────────────────────────── well-known calls ─────────────────────────────

/// ESLint's `isReflectApply`, for a callee.
#[inline]
pub fn is_reflect_apply(e: Expr<'_>) -> bool {
    is_specific_member_access(e, Some("Reflect"), Some("apply"))
}

/// ESLint's `isArrayFromMethod`, for a callee: `Array.from`, `Int8Array.from`, ..
pub fn is_array_from_method(e: Expr<'_>) -> bool {
    is_specific_member_access(e, None, Some("from"))
        && member_object(e)
            .is_some_and(|it| is_specific_id_with(it, |name| name.ends_with(b"Array")))
}

/// ESLint's `isArrayFromAsyncMethod`, for a callee.
#[inline]
pub fn is_array_from_async_method(e: Expr<'_>) -> bool {
    is_specific_member_access(e, Some("Array"), Some("fromAsync"))
}

/// ESLint's `isMethodWhichHasThisArg`, for a callee: a method of arrays whose second argument is
/// the `this` of the callback.
pub fn is_method_which_has_this_arg(e: Expr<'_>) -> bool {
    is_member_access_of_any(
        e,
        &[
            "every",
            "filter",
            "find",
            "findIndex",
            "findLast",
            "findLastIndex",
            "flatMap",
            "forEach",
            "map",
            "some",
        ],
    )
}

/// ESLint's `isArgumentOfGlobalMethodCall`: `e` is the argument at `index` of a call of
/// `objectName.methodName`, where `objectName` is the global variable.
pub fn is_argument_of_global_method_call(
    e: Expr<'_>,
    object_name: &str,
    method_name: &str,
    index: usize,
) -> bool {
    let Some(ExprKind::Call(call)) = e.parent().as_expr().map(Expr::kind) else {
        return false;
    };
    call.args().get(index) == Some(e)
        && is_specific_member_access(call.callee(), Some(object_name), Some(method_name))
        && member_object(call.callee()).is_some_and(is_global_reference)
}

/// ESLint's `isPropertyDescriptor`: `e` is given as a property descriptor to
/// `Object.defineProperty`, `Reflect.defineProperty`, `Object.create` or
/// `Object.defineProperties`.
pub fn is_property_descriptor(e: Expr<'_>) -> bool {
    if is_argument_of_global_method_call(e, "Object", "defineProperty", 2)
        || is_argument_of_global_method_call(e, "Reflect", "defineProperty", 2)
    {
        return true;
    }
    let Node::Prop(prop) = e.parent() else {
        return false;
    };
    let Node::Expr(object) = prop.parent() else {
        return false;
    };
    prop.value() == Some(e)
        && prop.kind() != PropKind::Spread
        && matches!(object.kind(), ExprKind::Object(_))
        && !is_assignment_target(object)
        && (is_argument_of_global_method_call(object, "Object", "create", 1)
            || is_argument_of_global_method_call(object, "Object", "defineProperties", 1))
}

/// ESLint's `isImportAttributeKey`, for the property whose key it is: a key in the
/// `with { type: "json" }` of an import or an export, or in the options of `import()`.
pub fn is_import_attribute_key(prop: Prop<'_>) -> bool {
    let mut prop = prop;
    loop {
        if prop.key().is_none_or(Key::is_computed) {
            return false;
        }
        let Node::Expr(object) = prop.parent() else {
            return false;
        };
        if !matches!(object.kind(), ExprKind::Object(_)) {
            return false;
        }
        match object.parent() {
            Node::Expr(parent) => {
                return matches!(parent.kind(), ExprKind::ImportCall { args } if args.get(1) == Some(object));
            }
            Node::Prop(outer) if outer.value() == Some(object) => prop = outer,
            _ => {
                return object.file().is_import_attributes(object.id());
            }
        }
    }
}

// ───────────────────────────── constant expressions ─────────────────────────────

/// ESLint's `isLogicalIdentity`: `e` decides the result of `e operator anything`. `operator` is
/// `BinOp::Or` or `BinOp::And`.
pub fn is_logical_identity(mut e: Expr<'_>, operator: BinOp) -> bool {
    loop {
        e = match e.kind() {
            ExprKind::Unary { op: UnOp::Void, .. } => return operator == BinOp::And,
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => {
                if op != operator || is_logical_identity(right, operator) {
                    return op == operator;
                }
                left
            }
            ExprKind::Assign {
                op: Some(op @ (BinOp::Or | BinOp::And)),
                value,
                ..
            } if op == operator => value,
            ExprKind::Assign {
                op: Some(BinOp::Or | BinOp::And),
                ..
            } => return false,
            _ if is_literal(e) => {
                return match operator {
                    BinOp::Or => get_boolean_value(e) == Some(true),
                    BinOp::And => get_boolean_value(e) == Some(false),
                    _ => false,
                };
            }
            _ => return false,
        }
    }
}

/// What [`is_constant_in`] has found out about the links of long chains of binary operators, for a rule that asks about each
/// link of a chain: `a && b`, `a && b && c`, ..
#[derive(Default)]
pub struct Constants {
    /// By the expression and `in_boolean_position`.
    known: FxHashMap<(hir::ExprId, bool), Constant>,
}

#[derive(Copy, Clone)]
struct Constant {
    is_constant: bool,
    /// [`is_logical_identity`] for `&&` and for `||`.
    is_identity_of_and: bool,
    is_identity_of_or: bool,
}

/// ESLint's `isConstant`: the value of `e`, or with `in_boolean_position` its truthiness, is the
/// same each time it is evaluated.
pub fn is_constant(e: Expr<'_>, in_boolean_position: bool) -> bool {
    match e.tag() {
        ExprTag::Binary => is_constant_in(e, in_boolean_position, &mut Constants::default()),
        _ => is_constant_unless_binary(e, in_boolean_position),
    }
}

/// [`is_constant`]. The left operand of a binary operator is not looked at twice, however often it is asked about.
pub fn is_constant_in(e: Expr<'_>, in_boolean_position: bool, constants: &mut Constants) -> bool {
    /// The links of a shorter chain are not worth remembering.
    const LONG: usize = 16;
    // `a + b + c` is `(a + b) + c`, as deep as it is long: down the left operands, and up again.
    let mut chain: SmallVec<[(Expr<'_>, bool); 8]> = SmallVec::new();
    let (mut at, mut in_boolean) = (e, in_boolean_position);
    let mut found = loop {
        match at.kind() {
            ExprKind::Binary { op, left, .. } if op != BinOp::Comma => {
                if let Some(&known) = constants.known.get(&(at.id(), in_boolean)) {
                    break known;
                }
                chain.push((at, in_boolean));
                in_boolean &= matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
                at = left;
            }
            _ => {
                break Constant {
                    is_constant: is_constant_unless_binary(at, in_boolean),
                    is_identity_of_and: is_logical_identity(at, BinOp::And),
                    is_identity_of_or: is_logical_identity(at, BinOp::Or),
                };
            }
        }
    };
    let is_long = chain.len() >= LONG;
    for (link, in_boolean) in chain.into_iter().rev() {
        let ExprKind::Binary { op, right, .. } = link.kind() else {
            continue;
        };
        let left = found;
        found = match op {
            BinOp::And | BinOp::Or | BinOp::Nullish => {
                let is_left_identity = match op {
                    BinOp::And => left.is_identity_of_and,
                    BinOp::Or => left.is_identity_of_or,
                    _ => false,
                };
                let is_right_constant = is_constant(right, in_boolean);
                let is_identity_of = |operator: BinOp, is_left: bool| {
                    op == operator && (is_left || is_logical_identity(right, operator))
                };
                Constant {
                    is_constant: left.is_constant && (is_right_constant || is_left_identity)
                        || in_boolean && is_right_constant && is_logical_identity(right, op),
                    is_identity_of_and: is_identity_of(BinOp::And, left.is_identity_of_and),
                    is_identity_of_or: is_identity_of(BinOp::Or, left.is_identity_of_or),
                }
            }
            _ => Constant {
                is_constant: left.is_constant && op != BinOp::In && is_constant(right, false),
                is_identity_of_and: false,
                is_identity_of_or: false,
            },
        };
        if is_long {
            constants.known.insert((link.id(), in_boolean), found);
        }
    }
    found.is_constant
}

fn is_constant_unless_binary(mut e: Expr<'_>, mut in_boolean_position: bool) -> bool {
    // Not by recursion where the answer is that for one operand: `a = a = ..` and `!!..a` are nested
    // tens of thousands deep.
    loop {
        (e, in_boolean_position) = match e.kind() {
            // A hole in an array.
            ExprKind::Missing => return true,
            ExprKind::Object(_)
            | ExprKind::Array(_)
            | ExprKind::Assign { op: None, .. }
            | ExprKind::Spread(_)
                if is_assignment_target(e) =>
            {
                return false;
            }
            ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Object(_) => return true,
            ExprKind::Template(template) => {
                let has_text = || {
                    (0..template.quasi_count())
                        .any(|i| template.cooked(i).is_some_and(|it| !it.bytes().is_empty()))
                };
                return (in_boolean_position && has_text())
                    || template.exprs().iter().all(|it| is_constant(it, false));
            }
            ExprKind::Array(elements) => {
                return in_boolean_position || elements.iter().all(|it| is_constant(it, false));
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Void => return true,
                UnOp::Typeof if in_boolean_position => return true,
                UnOp::Not => (operand, true),
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => return false,
                _ => (operand, false),
            },
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => (right, in_boolean_position),
            ExprKind::Binary { .. } => return is_constant(e, in_boolean_position),
            ExprKind::New(_) => return in_boolean_position,
            ExprKind::Assign { op, value, .. } => match op {
                None => (value, in_boolean_position),
                Some(op @ (BinOp::Or | BinOp::And)) if in_boolean_position => {
                    return is_logical_identity(value, op);
                }
                Some(_) => return false,
            },
            ExprKind::Spread(operand) => (operand, in_boolean_position),
            ExprKind::Call(call) => {
                return call.chain() == Chain::No
                    && call.callee().is_ident("Boolean")
                    && call.args().first().is_none_or(|it| is_constant(it, true))
                    && is_reference_to_global_variable(call.callee());
            }
            ExprKind::Ident(name) => {
                return name.is("undefined") && is_reference_to_global_variable(e);
            }
            _ => return is_literal(e),
        };
    }
}

/// ESLint's `couldBeError`: the value of `e` can be an `Error` object, as far as the syntax tells.
pub fn could_be_error(mut e: Expr<'_>) -> bool {
    loop {
        e = match e.kind() {
            ExprKind::Assign { op: None, .. } if is_assignment_target(e) => return false,
            ExprKind::NonNull(_) => return is_chain_root(e),
            ExprKind::Ident(_)
            | ExprKind::Call(_)
            | ExprKind::New(_)
            | ExprKind::Dot { .. }
            | ExprKind::Index { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Yield { .. }
            | ExprKind::Await(_) => return true,
            ExprKind::Assign { op, target, value } => match op {
                None | Some(BinOp::And) => value,
                Some(BinOp::Or | BinOp::Nullish) if could_be_error(target) => return true,
                Some(BinOp::Or | BinOp::Nullish) => value,
                Some(_) => return false,
            },
            ExprKind::Binary { op, left, right } => match op {
                BinOp::Comma | BinOp::And => right,
                BinOp::Or | BinOp::Nullish if could_be_error(right) => return true,
                BinOp::Or | BinOp::Nullish => left,
                _ => return false,
            },
            ExprKind::Cond { yes, .. } if could_be_error(yes) => return true,
            ExprKind::Cond { no, .. } => no,
            _ => return false,
        }
    }
}

// ───────────────────────────── functions ─────────────────────────────

/// ESLint's `isES5Constructor`: the name of the function starts with a capital letter.
#[inline]
pub fn is_es5_constructor(func: Func<'_>) -> bool {
    func.name()
        .is_some_and(|name| starts_with_upper_case(name.bytes()))
}

/// What ESLint finds as the `parent` of a function.
#[derive(Copy, Clone)]
enum FunctionParent<'a> {
    /// `MethodDefinition`
    Method(Member<'a>),
    /// `PropertyDefinition`, whose value the function is.
    Field(Member<'a>),
    /// `Property` of an object literal.
    Prop(Prop<'a>),
    /// `Property` of an object pattern, in whose computed key the function is.
    PatProp(PatProp<'a>),
    /// The function is itself a `TSMethodSignature`.
    Signature(Member<'a>),
    /// `TSMethodSignature` or `TSPropertySignature`, in whose computed key the function is.
    SignatureKey(Member<'a>),
    Other,
}

impl<'a> FunctionParent<'a> {
    fn of(func: Func<'a>) -> Self {
        // The parent of a function type is a `TSTypeAnnotation` or another type.
        if matches!(func.owner(), Node::Type(_)) {
            return FunctionParent::Other;
        }
        match estree_parent(Node::Func(func)) {
            Node::Member(member) if member.flags().contains(Flags::ABSTRACT) => {
                FunctionParent::Other
            }
            // The parent of what is in a decorator is the `Decorator`.
            Node::Member(member) if member.decorators().any(|it| it.as_fn() == Some(func)) => {
                FunctionParent::Other
            }
            Node::Member(member) if member.is_signature() && member.func() != Some(func) => {
                FunctionParent::SignatureKey(member)
            }
            Node::Member(member) => {
                let in_class = matches!(member.parent(), Node::Class(_));
                match member.kind() {
                    MemberKind::Method
                    | MemberKind::Getter
                    | MemberKind::Setter
                    | MemberKind::Constructor => match in_class {
                        true => FunctionParent::Method(member),
                        false => FunctionParent::Signature(member),
                    },
                    MemberKind::Property
                        if in_class && !member.flags().contains(Flags::ACCESSOR) =>
                    {
                        FunctionParent::Field(member)
                    }
                    _ => FunctionParent::Other,
                }
            }
            Node::Prop(prop) if !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread => {
                FunctionParent::Prop(prop)
            }
            // The default value is in an `AssignmentPattern`.
            Node::PatProp(prop) if prop.default().and_then(Expr::as_fn) != Some(func) => {
                FunctionParent::PatProp(prop)
            }
            _ => FunctionParent::Other,
        }
    }

    fn node(self) -> Option<Node<'a>> {
        match self {
            FunctionParent::Method(member)
            | FunctionParent::Field(member)
            | FunctionParent::Signature(member)
            | FunctionParent::SignatureKey(member) => Some(Node::Member(member)),
            FunctionParent::Prop(prop) => Some(Node::Prop(prop)),
            FunctionParent::PatProp(prop) => Some(Node::PatProp(prop)),
            FunctionParent::Other => None,
        }
    }

    /// The `#name` of a class member.
    fn private_name(self) -> Option<Name<'a>> {
        match self {
            FunctionParent::Method(member) | FunctionParent::Field(member) => {
                match member.key()?.kind() {
                    KeyKind::Private(name) => Some(name),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

/// ESLint's `getFunctionNameWithKind`: `"function 'foo'"`, `"arrow function"`,
/// `"static async method 'foo'"`, `"private getter #foo"`, `"constructor"`.
pub fn get_function_name_with_kind(func: Func<'_>) -> Vec<u8> {
    let parent = FunctionParent::of(func);
    let private_name = parent.private_name();
    let mut tokens: SmallVec<[&[u8]; 6]> = SmallVec::new();
    if let FunctionParent::Method(member) | FunctionParent::Field(member) = parent {
        if member.is_static() {
            tokens.push(b"static");
        }
        if private_name.is_some() {
            tokens.push(b"private");
        }
    }
    if func.is_async() {
        tokens.push(b"async");
    }
    if func.is_generator() {
        tokens.push(b"generator");
    }
    match parent {
        FunctionParent::Method(member) | FunctionParent::Signature(member) => {
            tokens.push(match member.kind() {
                _ if member.is_constructor() => return b"constructor".to_vec(),
                MemberKind::Getter => b"getter",
                MemberKind::Setter => b"setter",
                _ => b"method",
            });
        }
        FunctionParent::Prop(prop) => tokens.push(match prop.kind() {
            PropKind::Getter => b"getter",
            PropKind::Setter => b"setter",
            _ => b"method",
        }),
        FunctionParent::PatProp(_) | FunctionParent::Field(_) => tokens.push(b"method"),
        FunctionParent::SignatureKey(_) | FunctionParent::Other => {
            if func.is_arrow() {
                tokens.push(b"arrow");
            }
            tokens.push(b"function");
        }
    }
    let mut out = tokens.join(&b' ');
    let name = match (
        private_name,
        parent.node().and_then(get_static_property_name),
    ) {
        (Some(name), _) => {
            out.push(b' ');
            out.extend_from_slice(name.bytes());
            return out;
        }
        (None, Some(name)) => Some(name),
        (None, None) if matches!(parent, FunctionParent::Signature(_)) => {
            Some(Cow::Borrowed(&b"null"[..]))
        }
        (None, None) => func.name().map(|name| Cow::Borrowed(name.bytes())),
    };
    if let Some(name) = name {
        out.extend_from_slice(b" '");
        out.extend_from_slice(&name);
        out.push(b'\'');
    }
    out
}

/// ESLint's `getOpeningParenOfParams`: the `(` of the parameters. For an arrow function with one
/// parameter and no parentheses, the first token of the parameter.
///
/// As upstream, it is the first `(` after the name, which is a wrong one if the type parameters
/// have one.
pub fn get_opening_paren_of_params(func: Func<'_>) -> Option<Span> {
    let (file, text) = (func.file(), func.file().text());
    let mut params = func.params_with_this();
    if func.is_arrow()
        && let (Some(only), None) = (params.next(), params.next())
    {
        let start = only.span().start;
        let before = skip_trivia_back(text, start);
        return Some(
            match before.checked_sub(1).map(|at| (at, text.get(at as usize))) {
                Some((at, Some(b'('))) => Span::new(at, before),
                _ => Span::new(start, start + token_len(text.get(start as usize..)?) as u32),
            },
        );
    }
    if func.type_params().is_empty()
        && let Some(at) = func.open_paren()
    {
        return Some(Span::new(at, at + 1));
    }
    let whole = estree_span(Node::Func(func));
    let from = func.name().map_or(whole.start, |name| name.span().end);
    file.tokens_in(Span::new(from, whole.end))
        .find(is_opening_paren_token)
        .map(Token::span)
}

/// ESLint's `getFunctionHeadLoc`: what to report for a function, so that not all of it is
/// underlined. The `=>` of an arrow function, otherwise from the start of the function, or of the
/// method or the property that it is the value of, to the `(` of the parameters.
pub fn get_function_head_loc(func: Func<'_>) -> Span {
    let to_paren = |start: u32| {
        Span::new(
            start,
            get_opening_paren_of_params(func).map_or(start, |paren| paren.start),
        )
    };
    match FunctionParent::of(func).node() {
        Some(parent) => to_paren(parent.span().start),
        None => match (func.arrow_span(), func.kind(), func.return_type()) {
            (Some(arrow), ..) => arrow,
            (None, FnKind::FunctionType, Some(ty)) => {
                let start = type_annotation_span(ty).start;
                Span::new(start, start + 2)
            }
            _ => to_paren(estree_span(Node::Func(func)).start),
        },
    }
}

/// `/^[\s*]*@this/mu.test(value)`
fn has_this_tag(value: &[u8]) -> bool {
    let mut from = 0;
    while let Some(found) = value
        .get(from..)
        .and_then(|rest| strings::index_of(rest, b"@this"))
    {
        let at = from + found;
        let mut before = &value[..at];
        loop {
            let Some(c) = text::last_code_point(before) else {
                return true;
            };
            if text::is_line_terminator(c) {
                return true;
            }
            if !text::is_js_whitespace(c) && c != u32::from(b'*') {
                break;
            }
            before = &before[..bun_core::lexer::last_char(before).1];
        }
        from = at + 1;
    }
    false
}

fn find_jsdoc_comment<'a>(file: &'a File<'a>, start: u32) -> Option<Token<'a>> {
    let before = file
        .tokens_before(Span::empty(start))
        .with_comments()
        .next()?;
    (before.kind() == TokenKind::Block
        && before.comment_value().starts_with(b"*")
        && file
            .line_of(start)
            .saturating_sub(file.line_of(before.end()))
            <= 1)
        .then_some(before)
}

/// The braces of the `JSXExpressionContainer` that ESLint has as the parent of `node`.
fn jsx_container_of(node: Node<'_>) -> Option<Span> {
    let owner = match node {
        Node::Func(func) => func.owner(),
        Node::Class(class) => class.owner(),
        _ => node,
    };
    owner.as_expr()?.jsx_container_span()
}

/// ESLint's `getJSDocComment`, for a function or a class: the `/** .. */` comment that documents
/// it. `documented_at`: that of a [`ThisBindingMemo`].
fn get_jsdoc_comment<'a>(
    node: Node<'a>,
    documented_at: &mut AncestorMemo<'a, Option<u32>>,
) -> Option<Token<'a>> {
    let node = super::estree_compat::normalize(node);
    let file = node.file();
    match node {
        Node::Class(class) => match class.owner() {
            Node::Expr(e) => {
                find_jsdoc_comment(file, estree_parent(estree_parent(e.into())).span().start)
            }
            owner => find_jsdoc_comment(file, owner.span().start),
        },
        Node::Func(func) if func.kind() == FnKind::Decl => func
            .has_body()
            .then(|| find_jsdoc_comment(file, func.owner().span().start))?,
        Node::Func(func) if is_function_with_body(func) => {
            let is_argument = matches!(
                estree_parent(node).as_expr().map(Expr::kind),
                Some(ExprKind::Call(_) | ExprKind::New(_))
            );
            let of_ancestor = |child: Node<'a>, parent: Node<'a>| {
                if let Some(braces) = jsx_container_of(child)
                    && file.comments_before(braces).next().is_some()
                {
                    return Some(Some(braces.start));
                }
                match parent {
                    Node::File(_) => Some(None),
                    Node::Func(outer) if outer.kind() == FnKind::Decl => Some(None),
                    Node::Func(outer) if outer.kind() != FnKind::StaticBlock => {
                        Some(Some(estree_span(parent).start))
                    }
                    Node::Member(member)
                        if !matches!(
                            member.kind(),
                            MemberKind::Property | MemberKind::StaticBlock
                        ) =>
                    {
                        Some(Some(member.span().start))
                    }
                    // A `SpreadElement` and a `JSXAttribute` are no `Property`.
                    Node::Prop(prop)
                        if prop.kind() != PropKind::Spread && !prop.is_jsx_attribute() =>
                    {
                        Some(Some(parent.span().start))
                    }
                    Node::PatProp(_) => Some(Some(parent.span().start)),
                    _ if file.comments_before(parent).next().is_some() => {
                        Some(Some(parent.span().start))
                    }
                    _ => None,
                }
            };
            let start = match is_argument {
                true => None,
                false => documented_at
                    .find_with(node, estree_parent, of_ancestor)
                    .flatten(),
            };
            find_jsdoc_comment(file, start.unwrap_or_else(|| estree_span(node).start))
        }
        _ => None,
    }
}

/// ESLint's `hasJSDocThisTag`: the JSDoc comment of the function, or a comment directly before it,
/// has `@this`.
fn has_jsdoc_this_tag<'a>(
    func: Func<'a>,
    documented_at: &mut AncestorMemo<'a, Option<u32>>,
) -> bool {
    get_jsdoc_comment(Node::Func(func), documented_at)
        .is_some_and(|comment| has_this_tag(comment.comment_value()))
        || (func.file())
            .comments_before(estree_span(Node::Func(func)))
            .any(|comment| has_this_tag(comment.comment_value()))
}

/// ESLint's `isDefaultThisBinding`: `this` in `func`, which is not an arrow function, is the
/// default binding: `undefined` in strict mode, otherwise the global object. That is unless the
/// function is a method, a constructor, is bound, or is given to something with a `this` to call it
/// with.
///
/// `cap_is_constructor`: a function whose name starts with a capital letter is a constructor.
/// Upstream's default is `true`.
pub fn is_default_this_binding(func: Func<'_>, cap_is_constructor: bool) -> bool {
    is_default_this_binding_with(func, cap_is_constructor, &mut ThisBindingMemo::default())
}

/// What [`is_default_this_binding`] passes on its ways up from a function. The functions that are operands of one chain of
/// operators, or are returned in one chain of `else if`, all go up that chain.
#[derive(Default)]
pub struct ThisBindingMemo<'a> {
    /// Where the JSDoc comment of a function expression is looked for, if that is before something around it.
    documented_at: AncestorMemo<'a, Option<u32>>,
    /// The outermost of the `||`, `&&`, `??` and `?:` that an expression is an operand of, or the expression itself.
    outermost_operand: AncestorMemo<'a, Expr<'a>>,
    /// [`get_upper_function`]
    upper_function: AncestorMemo<'a, Func<'a>>,
}

/// [`is_default_this_binding`] for a rule that asks about many functions of a file, with one `memo` for all of them.
pub fn is_default_this_binding_with<'a>(
    func: Func<'a>,
    cap_is_constructor: bool,
    memo: &mut ThisBindingMemo<'a>,
) -> bool {
    let is_capitalized = |name: Option<Name<'_>>| {
        cap_is_constructor
            && func.name().is_none()
            && name.is_some_and(|it| starts_with_upper_case(it.bytes()))
    };
    if func.kind() == FnKind::StaticBlock
        || func.this_param().is_some()
        || func
            .params()
            .iter()
            .any(|param| param.pat().as_ident().is_some_and(|name| name.is("this")))
    {
        return false;
    }
    let mut current = match func.owner() {
        Node::Expr(e) => e,
        // The value of a `MethodDefinition`.
        Node::Member(_) => return false,
        _ => {
            return !((cap_is_constructor && is_es5_constructor(func))
                || has_jsdoc_this_tag(func, &mut memo.documented_at));
        }
    };
    let is_value_of = |member: Member<'_>, value: Expr<'_>| {
        member.init().is_some_and(|init| init.id() == value.id())
            && !member.flags().contains(Flags::ACCESSOR)
    };
    if matches!(current.parent(), Node::Member(member) if is_value_of(member, current)) {
        return false;
    }
    if (cap_is_constructor && is_es5_constructor(func))
        || has_jsdoc_this_tag(func, &mut memo.documented_at)
    {
        return false;
    }
    /// The call whose callee is the function `inner`: `(function() { return current; })()`.
    fn call_of(inner: Func<'_>) -> Option<Expr<'_>> {
        match inner.owner() {
            Node::Expr(callee) if is_callee(callee) => callee.parent().as_expr(),
            _ => None,
        }
    }
    let outermost_operand =
        |child: Node<'a>, parent: Node<'a>| match parent.as_expr().map(Expr::kind) {
            Some(
                ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                }
                | ExprKind::Cond { .. },
            ) => None,
            _ => child.as_expr(),
        };
    loop {
        current = (memo.outermost_operand)
            .find(Node::Expr(current), outermost_operand)
            .unwrap_or(current);
        match current.parent() {
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Assign { target, .. } => {
                    return !is_member_expression(target) && !is_capitalized(target.as_ident());
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    if obj != current
                        || !is_member_access_of_any(parent, &["bind", "call", "apply"])
                    {
                        return true;
                    }
                    return match parent.parent().as_expr().map(Expr::kind) {
                        Some(ExprKind::Call(call)) if call.callee() == parent => {
                            call.args().first().is_none_or(is_null_or_undefined)
                        }
                        _ => true,
                    };
                }
                ExprKind::Call(call) => {
                    let (callee, args) = (call.callee(), call.args());
                    // How many arguments, where the function is, where its `this` is.
                    let (count, callback, this_arg) = if is_reflect_apply(callee) {
                        (3, 0, 1)
                    } else if is_array_from_method(callee) || is_array_from_async_method(callee) {
                        (3, 1, 2)
                    } else if is_method_which_has_this_arg(callee) {
                        (2, 0, 1)
                    } else {
                        return true;
                    };
                    return args.len() != count
                        || args.get(callback) != Some(current)
                        || args.get(this_arg).is_none_or(is_null_or_undefined);
                }
                _ => return true,
            },
            Node::Stmt(statement) if matches!(statement.kind(), StmtKind::Return(_)) => {
                let upper_function = (memo.upper_function)
                    .find(Node::Stmt(statement), |_, parent| as_function(parent));
                match upper_function.and_then(call_of) {
                    Some(call) => current = call,
                    None => return true,
                }
            }
            Node::Func(arrow) => {
                let is_body = matches!(arrow.body(), FnBody::Expr(body) if body == current);
                match call_of(arrow).filter(|_| is_body) {
                    Some(call) => current = call,
                    None => return true,
                }
            }
            // A `SpreadElement` and a `JSXAttribute` are no `Property`.
            Node::Prop(prop) => {
                return prop.is_jsx_attribute()
                    || prop.kind() == PropKind::Spread
                    || prop.value() != Some(current);
            }
            Node::Member(member) => return !is_value_of(member, current),
            Node::VarDecl(declaration) => {
                return !(declaration.init() == Some(current)
                    && is_capitalized(declaration.pat().as_ident()));
            }
            // An `AssignmentPattern`.
            Node::Param(param) => return !is_capitalized(param.pat().as_ident()),
            Node::PatProp(prop) => {
                return prop.default() != Some(current) || !is_capitalized(prop.value().as_ident());
            }
            Node::PatElem(element) => {
                return !is_capitalized(element.pat().and_then(|pat| match pat.kind() {
                    PatKind::Ident(name) => Some(name),
                    _ => None,
                }));
            }
            _ => return true,
        }
    }
}

// ───────────────────────────── positions ─────────────────────────────

/// ESLint's `getSwitchCaseColonToken`: the `:` after `case test` or `default`.
pub fn get_switch_case_colon_token(case: Case<'_>) -> Option<Token<'_>> {
    let file = case.file();
    match case.test() {
        Some(test) => file.tokens_after(test).find(is_colon_token),
        None => file.tokens_in(case).nth(1),
    }
}

/// ESLint's `getNextLocation`: the position after `position`, which is the start of the next line
/// if it is at the end of one. `None` at the end of the file.
pub fn get_next_location(file: &File<'_>, position: Position) -> Option<Position> {
    // Not by the length of the line in UTF-16 code units, which takes time in proportion to it.
    if file.offset(position) < file.line_span(position.line).end {
        return Some(Position {
            line: position.line,
            column: position.column + 1,
        });
    }
    (position.line < file.line_count()).then_some(Position {
        line: position.line + 1,
        column: 0,
    })
}

/// Whether `node` is in the type of a type annotation, an `as` or `satisfies` expression or a type
/// alias.
fn is_in_type(node: Node<'_>) -> bool {
    let mut child = node;
    for parent in node.ancestors() {
        if matches!(child, Node::Type(_))
            && match parent {
                Node::VarDecl(_) | Node::Param(_) | Node::Member(_) | Node::Func(_) => true,
                Node::Expr(e) => {
                    matches!(e.kind(), ExprKind::As { .. } | ExprKind::Satisfies { .. })
                }
                Node::Stmt(statement) => matches!(statement.kind(), StmtKind::TypeAlias(_)),
                Node::Type(ty) => matches!(ty.kind(), crate::ast::TypeKind::Predicate { .. }),
                _ => false,
            }
        {
            return true;
        }
        child = parent;
    }
    false
}

/// ESLint's `needsPrecedingSemicolon`: whether a `;` is needed before `node`, the start of an
/// expression statement, if it is replaced by something that starts with `(`, `[`, `` ` ``, `/`, `+`
/// or `-`, which could continue what precedes it.
pub fn needs_preceding_semicolon<'a>(node: impl Into<Node<'a>>) -> bool {
    let node = node.into();
    let file = node.file();
    let Some(previous) = file.tokens_before(node).next() else {
        return false;
    };
    let kind = previous.kind();
    if kind == TokenKind::Punctuator
        && matches!(previous.text(), b":" | b";" | b"{" | b"=>" | b"++" | b"--")
    {
        return false;
    }
    let at = get_node_by_range_index(file, previous.start());

    // The key of a class field without a value.
    if let Node::Member(member) = at
        && member.kind() == MemberKind::Property
        && !member.flags().intersects(Flags::ACCESSOR | Flags::ABSTRACT)
        && matches!(member.parent(), Node::Class(_))
        && member
            .key()
            .is_some_and(|key| key.span(file).contains(previous.span()))
    {
        return false;
    }
    let is_type_syntax = match at {
        Node::Type(_) | Node::TypeParam(_) | Node::TupleElem(_) => is_in_type(at),
        Node::Func(func) => func.kind() == FnKind::Decl && !func.has_body(),
        Node::Expr(e) => matches!(
            e.kind(),
            ExprKind::As { .. } | ExprKind::AsConst(_) | ExprKind::Satisfies { .. }
        ),
        Node::Stmt(statement) => {
            matches!(
                statement.kind(),
                StmtKind::ImportEquals(_) | StmtKind::TypeAlias(_)
            )
        }
        _ => false,
    };
    if is_type_syntax || is_in_type(at) {
        return false;
    }
    if is_closing_paren_token(&previous) {
        return !matches!(
            at.as_stmt().map(Stmt::kind),
            Some(
                StmtKind::DoWhile { .. }
                    | StmtKind::ForIn { .. }
                    | StmtKind::ForOf { .. }
                    | StmtKind::For { .. }
                    | StmtKind::If { .. }
                    | StmtKind::While { .. }
                    | StmtKind::With { .. }
            )
        );
    }
    if is_closing_brace_token(&previous) {
        return match at {
            Node::Func(func) => match func.kind() {
                FnKind::Expr => true,
                FnKind::Method | FnKind::Getter | FnKind::Setter => {
                    matches!(func.owner(), Node::Expr(_))
                }
                _ => false,
            },
            Node::Class(class) => matches!(class.owner(), Node::Expr(_)),
            Node::Expr(e) => matches!(e.kind(), ExprKind::Object(_)) && !is_assignment_target(e),
            _ => false,
        };
    }
    if matches!(kind, TokenKind::Identifier | TokenKind::Keyword) {
        return match at {
            Node::Pat(pat) => {
                !matches!(pat.parent(), Node::VarDecl(declaration) if declaration.init().is_none())
            }
            Node::Stmt(statement) => !matches!(
                (statement.kind(), previous.text()),
                (StmtKind::Break(_) | StmtKind::Continue(_), _)
                    | (StmtKind::Debugger, b"debugger")
                    | (StmtKind::DoWhile { .. }, b"do")
                    | (StmtKind::If { .. }, b"else")
                    | (StmtKind::Return(_), b"return")
            ),
            Node::Expr(e) => !(matches!(e.kind(), ExprKind::Yield { .. }) && previous.is("yield")),
            _ => true,
        };
    }
    if kind == TokenKind::String {
        return !matches!(
            at.as_stmt().map(Stmt::kind),
            Some(StmtKind::Import(_) | StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. })
        );
    }
    true
}
