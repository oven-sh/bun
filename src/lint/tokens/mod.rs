//! Tokens and comments.
//!
//! The HIR doesn't store tokens. There are two ways to get them:
//! - [`skip_trivia`], [`skip_trivia_back`], [`token_len`] and [`next_token`] scan the text next to a position that's
//!   known to be a token boundary, such as the end of a node. They have no up-front cost. Each one documents where it
//!   can't be used.
//! - The [`File`] methods below are ESLint's `SourceCode` methods, as iterators. The first call scans the whole file,
//!   so a rule should decide from the syntax whether there's anything to report and only then look at tokens. After
//!   that, a call is a binary search. The methods that only return comments (`comments*`) don't need the scan, because
//!   the parser already lists the comments.
//!
//! Tokens have the ranges and types that ESLint's parser for the file gives them: typescript-estree for TypeScript
//! files and when `languageOptions.parser` selects it, espree otherwise. With an oxlint config they're what oxlint
//! passes to a plugin. See [`TokenKind`] for the differences.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `getFirstToken(node)` | `file.first_token(node)` |
//! | `getLastToken(node)` | `file.last_token(node)` |
//! | `getTokenBefore(x)` | `file.token_before(x)` |
//! | `getTokenAfter(x)` | `file.token_after(x)` |
//! | `getTokens(node)`, `getFirstTokens(node)` | `file.tokens_in(node)` |
//! | `getFirstToken(node, { skip: 1 })` | `file.tokens_in(node).nth(1)` |
//! | `getLastToken(node, { skip: 1 })` | `file.tokens_in(node).nth_back(1)` |
//! | `getFirstToken(node, isCommaToken)` | `file.tokens_in(node).find(is_comma_token)` |
//! | `getLastToken(node, isCommaToken)` | `file.tokens_in(node).rfind(is_comma_token)` |
//! | `getFirstTokens(node, { count: 2 })` | `file.tokens_in(node).take(2)` |
//! | `getLastTokens(node, { count: 2 })` | `file.tokens_in(node).rev().take(2)`, **last one first** |
//! | `getTokensAfter(x)` | `file.tokens_after(x)` |
//! | `getTokenAfter(x, { skip: 1 })` | `file.tokens_after(x).nth(1)` |
//! | `getTokenAfter(x, isCommaToken)` | `file.tokens_after(x).find(is_comma_token)` |
//! | `getTokensAfter(x, { count: 2 })` | `file.tokens_after(x).take(2)` |
//! | `getTokensBefore(x)` | `file.tokens_before(x)`, **nearest first** |
//! | `getTokenBefore(x, { skip: 1 })` | `file.tokens_before(x).nth(1)` |
//! | `getTokenBefore(x, isCommaToken)` | `file.tokens_before(x).find(is_comma_token)` |
//! | `getTokensBetween(a, b)`, `getFirstTokensBetween(a, b)` | `file.tokens_between(a, b)` |
//! | `getFirstTokenBetween(a, b)` | `file.tokens_between(a, b).next()` |
//! | `getLastTokenBetween(a, b)` | `file.tokens_between(a, b).next_back()` |
//! | `{ filter, skip }`, `{ filter, count }` | `.filter(..).nth(skip)`, `.filter(..).take(count)`: ESLint filters first too |
//! | `{ includeComments: true }` | `.with_comments()` on any of the iterators, before anything else |
//! | `getTokenBefore(x, { includeComments: true })` | `file.tokens_before(x).with_comments().next()` |
//! | `getTokenByRangeStart(i)` | `file.token_at(i)` |
//! | (the token or comment at a text index) | `file.token_containing(i)`, `file.comment_containing(i)`, `file.token_or_comment_containing(i)` |
//! | `ast.tokens` | `file.tokens()` |
//! | `getAllComments()`, `ast.comments` | `file.comments()` |
//! | `getCommentsBefore(x)` | `file.comments_before(x)` |
//! | `getCommentsAfter(x)` | `file.comments_after(x)` |
//! | `getCommentsInside(node)` | `file.comments_in(node)` |
//! | `commentsExistBetween(a, b)` | `file.comments_exist_between(a, b)` |
//! | `isSpaceBetween(a, b)` | `file.is_space_between(a, b)` |
//! | `token.type`, `token.value`, `token.range` | `token.kind()`, `token.value()` (`token.text()` is `getText(token)`), `token.span()` |
//! | `a.value === b.value` | `a.has_same_value(b)`: espree decodes `\u0061` in a name |
//! | `isCommaToken`, `isOpeningParenToken`, .. | `utils::ast_utils`, or `token.is_punctuator(",")` |
//!
//! `x`, `a` and `b` can be anything with a [`Span`]: a node, a token, a comment or a span. As in ESLint, only the range
//! matters, and it should start and end where a token or comment does. A token is "in" a range if it's entirely inside
//! it.

mod scan;

use crate::ast::File;
use crate::span::{Span, Spanned};
use bun_sema::check::spans;
use std::borrow::Cow;
use std::cell::OnceCell;

/// Skips whitespace and comments from `at`. Returns the start of the next token, or the end of the text.
///
/// `at` must be between tokens: at the end of a node or token, or inside whitespace. Don't use it among a JSX element's
/// children, where whitespace and `//` are text.
#[inline]
pub fn skip_trivia(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia(text, at as usize) as u32
}

/// Skips whitespace and comments backward from `at`. Returns the end of the previous token, or 0.
///
/// `at` must be between tokens and not among a JSX element's children. Going backward, a `//` comment can only be
/// recognized by scanning its line from the start, and only that line is scanned. So the result is wrong if the line
/// before `at` has a `//` that isn't a comment and isn't in a string that starts on the same line: in a regular
/// expression (`/\/\//`), or in a template that started on an earlier line. `file.token_before(..)` is always right.
#[inline]
pub fn skip_trivia_back(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia_back(text, at as usize) as u32
}

/// Returns the length of the token at the start of `text`. It's 0 only if `text` is empty.
///
/// It has no context from the preceding text:
/// - A `/` is a `/` or a `/=`, never a regular expression.
/// - A `>` is always its own token, even as the first character of `>=`, `>>` or `>>>=`.
/// - A `<<` is one token, even where it opens two type parameter lists.
/// - A template ends after its first `${`. A `}` is a `}`, not the continuation of a template.
/// - In a JSX tag, the name `a-b` ends at the `-`, and a `\` in a string skips a character.
#[inline]
pub fn token_len(text: &[u8]) -> usize {
    spans::token_end(text, 0, false)
}

/// Returns the token after `at`, skipping whitespace and comments. Empty at the end of the text.
///
/// For the punctuation and keywords around a node: the `(` after a callee, the `=` after a pattern, the `,` after an
/// element. The limits of [`skip_trivia`] and [`token_len`] apply.
#[inline]
pub fn next_token(text: &[u8], at: u32) -> Span {
    let start = skip_trivia(text, at);
    let len = token_len(text.get(start as usize..).unwrap_or_default());
    Span::new(start, start + len as u32)
}

/// ESLint's `token.type`.
///
/// ESLint's parsers agree on where the tokens are, and on their types except for a few words. A JavaScript file gets
/// espree's types unless `languageOptions.parser` is `@typescript-eslint/parser`. Every other file gets
/// typescript-estree's:
///
/// | | espree | typescript-estree |
/// | --- | --- | --- |
/// | `let`, `static`, `yield` used as a name: `a.static`, `{ let: 1 }`, `var yield` | `Keyword` | `Identifier` |
/// | the same with `ecmaVersion` 3 or 5 | only `static` is a `Keyword` | |
/// | `a` and `b` in the expression `a.b`, anywhere inside a JSX element: `<i>{a.b}</i>` | `Identifier` | `JsxIdentifier` |
/// | `a` and `b` in `<a:b c:d="">` | `JsxIdentifier` | `Identifier` |
/// | `this` in `<this.a>` | `JsxIdentifier` | `Keyword` |
///
/// With an oxlint config every file gets the same types, whatever its language: espree's, except for the last row.
///
/// In both parsers:
/// - A reserved word used as a name is an `Identifier`: `a.if`, `{ default: 1 }`, `class { new() {} }`,
///   `export { a as default }`, `function (this: T) {}`, `a as const`.
/// - A contextual keyword is always an `Identifier`: `async`, `await`, `of`, `get`, `set`, `as`, `from`, `type`,
///   `declare`, `readonly`, `abstract`, `namespace`, `any`, `string`, .. In TypeScript `implements`, `interface`,
///   `private`, `protected`, `public` (and `let`, `static`, `yield`) are a `Keyword` where they act as one.
/// - A JSX attribute's string value is a `JsxText`.
/// - `` `a${ ``, `}b${` and `` }c` `` are one `Template` each.
/// - `</` and `/>` are two tokens each. The `>>` that closes two type argument lists is two tokens.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum TokenKind {
    Boolean,
    Identifier,
    JsxIdentifier,
    JsxText,
    Keyword,
    Null,
    Numeric,
    /// `#a`, including the `#`
    PrivateIdentifier,
    Punctuator,
    RegularExpression,
    String,
    Template,
    /// `// ..`. In a non-module file, espree and oxc also count `<!-- ..` and, at the start of a line, `--> ..`.
    Line,
    /// `/* .. */`
    Block,
    /// `#!..` on the first line
    Shebang,
}

impl TokenKind {
    #[inline]
    pub fn is_comment(self) -> bool {
        matches!(
            self,
            TokenKind::Line | TokenKind::Block | TokenKind::Shebang
        )
    }
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct RawToken {
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) kind: TokenKind,
}

impl RawToken {
    #[inline]
    const fn span(self) -> Span {
        Span::new(self.start, self.end)
    }
}

/// A file's tokens and comments, each in source order and each computed on first use.
#[derive(Default)]
pub(crate) struct TokenStore {
    tokens: OnceCell<Vec<RawToken>>,
    comments: OnceCell<Vec<RawToken>>,
}

/// A token or a comment.
#[derive(Copy, Clone)]
pub struct Token<'a> {
    file: &'a File<'a>,
    raw: RawToken,
}

impl<'a> Token<'a> {
    #[inline]
    pub fn kind(self) -> TokenKind {
        self.raw.kind
    }

    #[inline]
    pub fn span(self) -> Span {
        self.raw.span()
    }

    #[inline]
    pub fn start(self) -> u32 {
        self.raw.start
    }

    #[inline]
    pub fn end(self) -> u32 {
        self.raw.end
    }

    /// The source text. A comment includes its delimiters.
    #[inline]
    pub fn text(self) -> &'a [u8] {
        self.file.slice(self.span())
    }

    /// ESLint's `comment.value`: the comment's text without its delimiters.
    pub fn comment_value(self) -> &'a [u8] {
        self.file.slice(self.comment_value_span())
    }

    /// The span of [`Token::comment_value`], like oxc's `Comment::content_span`.
    pub fn comment_value_span(self) -> Span {
        match self.raw.kind {
            TokenKind::Block => self.span().shrink(2, 2),
            TokenKind::Line if self.text().starts_with(b"<!--") => self.span().shrink(4, 0),
            TokenKind::Line if self.text().starts_with(b"-->") => self.span().shrink(3, 0),
            TokenKind::Line | TokenKind::Shebang => self.span().shrink(2, 0),
            _ => self.span(),
        }
    }

    /// ESLint's `token.value` minus espree's decoding: the source text, except that a comment loses its delimiters and
    /// a private identifier its `#`.
    ///
    /// espree (but not typescript-estree) decodes two things that stay verbatim here:
    /// - Escape sequences in a name: the value of `a\u0062` is `ab`. oxlint does this too. Use
    ///   [`Token::decoded_value`] or [`Token::has_same_value`] for that.
    /// - Text between JSX tags (not an attribute's string): the value of `&amp;` is `&`, and a `\r\n` becomes `\n`.
    ///   Nothing here does that.
    pub fn value(self) -> &'a [u8] {
        match self.raw.kind {
            TokenKind::PrivateIdentifier => self.file.slice(self.span().shrink(1, 0)),
            _ => self.comment_value(),
        }
    }

    /// True if espree or oxlint would decode escape sequences in this token: the file uses one of those parsers, the
    /// token is a name, and it contains a `\`.
    fn has_decoded_value(self) -> bool {
        use TokenKind::{Boolean, Identifier, Keyword, Null, PrivateIdentifier};
        matches!(
            self.raw.kind,
            Identifier | Keyword | PrivateIdentifier | Boolean | Null
        ) && bun_core::strings::contains_char(self.text(), b'\\')
            && scan::decodes_names(self.file)
    }

    /// [`Token::value`], with `\u0061` and `\u{61}` in a name decoded where espree and oxlint decode them.
    pub fn decoded_value(self) -> Cow<'a, [u8]> {
        if !self.has_decoded_value() {
            return Cow::Borrowed(self.value());
        }
        let mut decoded = Vec::with_capacity(self.value().len());
        for c in code_points(self.value()) {
            let c = char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER);
            decoded.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
        }
        Cow::Owned(decoded)
    }

    /// ESLint's `a.value === b.value`, without allocating. (But see [`Token::value`] for JSX text.)
    pub fn has_same_value(self, other: Token<'a>) -> bool {
        match self.has_decoded_value() || other.has_decoded_value() {
            true => code_points(self.value()).eq(code_points(other.value())),
            false => self.value() == other.value(),
        }
    }

    /// True if the source text is `text`.
    #[inline]
    pub fn is(self, text: &str) -> bool {
        self.text() == text.as_bytes()
    }

    /// True if this is the punctuator `text`.
    #[inline]
    pub fn is_punctuator(self, text: &str) -> bool {
        self.raw.kind == TokenKind::Punctuator && self.is(text)
    }

    /// True if this is the keyword `text`.
    #[inline]
    pub fn is_keyword(self, text: &str) -> bool {
        self.raw.kind == TokenKind::Keyword && self.is(text)
    }

    #[inline]
    pub fn is_comment(self) -> bool {
        self.raw.kind.is_comment()
    }
}

impl PartialEq for Token<'_> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.raw.start == other.raw.start && self.raw.end == other.raw.end
    }
}
impl Eq for Token<'_> {}
impl std::fmt::Debug for Token<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}({:?})", self.raw.kind, bstr::BStr::new(self.text()))
    }
}
impl Spanned for Token<'_> {
    #[inline]
    fn span(&self) -> Span {
        Token::span(*self)
    }
}

/// A run of consecutive tokens in a file. [`Tokens::with_comments`] adds the comments among them.
#[derive(Copy, Clone)]
pub struct Tokens<'a> {
    file: &'a File<'a>,
    tokens: &'a [RawToken],
    /// Empty unless comments are included.
    comments: &'a [RawToken],
    /// The text range `tokens` was selected by. `with_comments` selects the comments by it too.
    within: Span,
    /// Nearest first, as `tokens_before` returns them.
    is_reversed: bool,
}

impl<'a> Tokens<'a> {
    /// ESLint's `{ includeComments: true }`. Call it before taking anything from the iterator.
    pub fn with_comments(mut self) -> Self {
        self.comments = within(self.file.raw_comments(), self.within);
        self
    }

    fn front(&mut self) -> Option<RawToken> {
        match (self.tokens.first(), self.comments.first()) {
            (Some(token), Some(comment)) if comment.start < token.start => {
                self.comments.split_off_first()
            }
            (Some(_), _) => self.tokens.split_off_first(),
            (None, _) => self.comments.split_off_first(),
        }
        .copied()
    }

    fn back(&mut self) -> Option<RawToken> {
        match (self.tokens.last(), self.comments.last()) {
            (Some(token), Some(comment)) if comment.start > token.start => {
                self.comments.split_off_last()
            }
            (Some(_), _) => self.tokens.split_off_last(),
            (None, _) => self.comments.split_off_last(),
        }
        .copied()
    }
}

impl<'a> Iterator for Tokens<'a> {
    type Item = Token<'a>;

    #[inline]
    fn next(&mut self) -> Option<Token<'a>> {
        let raw = match self.is_reversed {
            true => self.back(),
            false => self.front(),
        }?;
        Some(Token {
            file: self.file,
            raw,
        })
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = self.tokens.len() + self.comments.len();
        (len, Some(len))
    }
}

impl DoubleEndedIterator for Tokens<'_> {
    #[inline]
    fn next_back(&mut self) -> Option<Self::Item> {
        let raw = match self.is_reversed {
            true => self.front(),
            false => self.back(),
        }?;
        Some(Token {
            file: self.file,
            raw,
        })
    }
}

impl ExactSizeIterator for Tokens<'_> {}

/// Returns the tokens of `all` that are entirely inside `span`.
fn within(all: &[RawToken], span: Span) -> &[RawToken] {
    let first = all.partition_point(|token| token.start < span.start);
    let count = all[first..].partition_point(|token| token.end <= span.end);
    &all[first..first + count]
}

/// Returns a name's code points, with escape sequences decoded.
fn code_points(name: &[u8]) -> impl Iterator<Item = u32> {
    let mut at = 0;
    std::iter::from_fn(move || {
        let (c, size) = match name.get(at)? {
            b'\\' => bun_core::lexer::peek_unicode_escape(name, at)
                .unwrap_or_else(|| (i32::from(b'\\'), 1)),
            _ => bun_core::lexer::char_and_size(name, at),
        };
        at += size.max(1);
        Some(c as u32)
    })
}

/// Returns the token of `all` that contains `offset`.
fn containing(all: &[RawToken], offset: u32) -> Option<&RawToken> {
    let after = all.partition_point(|token| token.start <= offset);
    all.get(after.checked_sub(1)?)
        .filter(|token| offset < token.end)
}

/// True if `text`, which is next to a comment, is all whitespace.
fn is_whitespace(text: &[u8]) -> bool {
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        at += match bun_core::lexer::char_and_size(text, at) {
            _ if byte <= b' ' => 1,
            (0x2028 | 0x2029, size) => size,
            (c @ 0x80.., size) if bun_core::lexer::is_white_space_single_line(c) => size,
            _ => return false,
        };
    }
    true
}

impl<'a> File<'a> {
    fn raw_tokens(&'a self) -> &'a [RawToken] {
        let store = self.lazy.tokens.get_or_init(TokenStore::default);
        store.tokens.get_or_init(|| {
            let (tokens, comments) = scan::scan(self);
            // Already set if the comments were requested first.
            let _ = store.comments.set(comments);
            tokens
        })
    }

    fn raw_comments(&'a self) -> &'a [RawToken] {
        let store = self.lazy.tokens.get_or_init(TokenStore::default);
        if let Some(comments) = store.comments.get() {
            return comments;
        }
        if let Some(comments) = scan::comments(self) {
            return store.comments.get_or_init(|| comments);
        }
        self.raw_tokens();
        store.comments.get().map_or(&[], |comments| comments)
    }

    #[inline]
    fn token(&'a self, raw: Option<&RawToken>) -> Option<Token<'a>> {
        raw.map(|&raw| Token { file: self, raw })
    }

    fn tokens_within(&'a self, span: Span, is_reversed: bool) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: within(self.raw_tokens(), span),
            comments: &[],
            within: span,
            is_reversed,
        }
    }

    /// All tokens in the file.
    pub fn tokens(&'a self) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: self.raw_tokens(),
            comments: &[],
            within: self.span(),
            is_reversed: false,
        }
    }

    /// A node's tokens.
    pub fn tokens_in(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(at.span(), false)
    }

    /// The tokens after a node, a token or a comment, to the end of the file.
    pub fn tokens_after(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(Span::new(at.span().end, self.span().end), false)
    }

    /// The tokens before a node, a token or a comment, **nearest first**.
    pub fn tokens_before(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(Span::before(0, at.span()), true)
    }

    /// The tokens between the end of `a` and the start of `b`.
    pub fn tokens_between(&'a self, a: impl Spanned, b: impl Spanned) -> Tokens<'a> {
        self.tokens_within(a.span().between(b.span()), false)
    }

    /// A node's first token.
    pub fn first_token(&'a self, at: impl Spanned) -> Option<Token<'a>> {
        let (tokens, span) = (self.raw_tokens(), at.span());
        let first = tokens.get(tokens.partition_point(|token| token.start < span.start));
        self.token(first.filter(|token| token.end <= span.end))
    }

    /// A node's last token.
    pub fn last_token(&'a self, at: impl Spanned) -> Option<Token<'a>> {
        let (tokens, span) = (self.raw_tokens(), at.span());
        let after = tokens.partition_point(|token| token.end <= span.end);
        let last = after.checked_sub(1).and_then(|last| tokens.get(last));
        self.token(last.filter(|token| token.start >= span.start))
    }

    /// The token before a node, a token or a comment.
    pub fn token_before(&'a self, at: impl Spanned) -> Option<Token<'a>> {
        let (tokens, start) = (self.raw_tokens(), at.span().start);
        let after = tokens.partition_point(|token| token.end <= start);
        self.token(after.checked_sub(1).and_then(|before| tokens.get(before)))
    }

    /// The token after a node, a token or a comment.
    pub fn token_after(&'a self, at: impl Spanned) -> Option<Token<'a>> {
        let (tokens, end) = (self.raw_tokens(), at.span().end);
        self.token(tokens.get(tokens.partition_point(|token| token.start < end)))
    }

    /// The token that starts at `offset`.
    pub fn token_at(&'a self, offset: u32) -> Option<Token<'a>> {
        let tokens = self.raw_tokens();
        let at = tokens
            .binary_search_by_key(&offset, |token| token.start)
            .ok()?;
        self.token(tokens.get(at))
    }

    /// The token that contains `offset` (`start <= offset < end`). `None` between tokens.
    pub fn token_containing(&'a self, offset: u32) -> Option<Token<'a>> {
        self.token(containing(self.raw_tokens(), offset))
    }

    /// The comment that contains `offset`.
    pub fn comment_containing(&'a self, offset: u32) -> Option<Token<'a>> {
        self.token(containing(self.raw_comments(), offset))
    }

    /// The token or comment that contains `offset`. `None` in whitespace.
    pub fn token_or_comment_containing(&'a self, offset: u32) -> Option<Token<'a>> {
        self.comment_containing(offset)
            .or_else(|| self.token_containing(offset))
    }

    fn comments_within(&'a self, span: Span) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: &[],
            comments: within(self.raw_comments(), span),
            within: span,
            is_reversed: false,
        }
    }

    /// All comments in the file. A `#!` line comes first.
    pub fn comments(&'a self) -> Tokens<'a> {
        self.comments_within(self.span())
    }

    /// The comments inside a node.
    pub fn comments_in(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.comments_within(at.span())
    }

    /// The comments between the end of `a` and the start of `b`.
    pub fn comments_between(&'a self, a: impl Spanned, b: impl Spanned) -> Tokens<'a> {
        self.comments_within(a.span().between(b.span()))
    }

    /// True if there's a comment between the end of `a` and the start of `b`.
    pub fn comments_exist_between(&'a self, a: impl Spanned, b: impl Spanned) -> bool {
        let (comments, between) = (self.raw_comments(), a.span().between(b.span()));
        let first = comments.get(comments.partition_point(|comment| comment.start < between.start));
        first.is_some_and(|comment| comment.end <= between.end)
    }

    /// The comments directly before a node, a token or a comment, that is, after the preceding token. In source order.
    pub fn comments_before(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.comments_ending_before(at.span().start)
    }

    fn comments_ending_before(&'a self, end: u32) -> Tokens<'a> {
        let comments = self.raw_comments();
        let after = comments.partition_point(|comment| comment.end <= end);
        let (mut first, mut start) = (after, end);
        while let Some(comment) = first.checked_sub(1).and_then(|before| comments.get(before))
            && is_whitespace(self.slice(Span::after(comment.span(), start)))
        {
            (first, start) = (first - 1, comment.start);
        }
        Tokens {
            file: self,
            tokens: &[],
            comments: &comments[first..after],
            within: Span::new(start, end),
            is_reversed: false,
        }
    }

    /// The comments directly after a node, a token or a comment, that is, before the next token.
    pub fn comments_after(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.comments_starting_after(at.span().end)
    }

    fn comments_starting_after(&'a self, start: u32) -> Tokens<'a> {
        let comments = self.raw_comments();
        let first = comments.partition_point(|comment| comment.start < start);
        let (mut after, mut end) = (first, start);
        while let Some(comment) = comments.get(after)
            && is_whitespace(self.slice(Span::before(end, comment.span())))
        {
            (after, end) = (after + 1, comment.end);
        }
        Tokens {
            file: self,
            tokens: &[],
            comments: &comments[first..after],
            within: Span::new(start, end),
            is_reversed: false,
        }
    }

    /// ESLint's `isSpaceBetween`: true if there's whitespace between `a` and `b`, in either order, outside tokens and
    /// comments. Whitespace in a `JsxText` doesn't count. False if they overlap.
    pub fn is_space_between(&'a self, a: impl Spanned, b: impl Spanned) -> bool {
        let (a, b) = (a.span(), b.span());
        let (first, second) = if a.end <= b.start { (a, b) } else { (b, a) };
        let mut at = first.end;
        for token in self.tokens_between(first, second).with_comments() {
            if token.start() > at {
                return true;
            }
            at = token.end();
        }
        second.start > at
    }
}
