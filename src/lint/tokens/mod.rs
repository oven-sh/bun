//! Tokens and comments.
//!
//! The HIR does not store tokens. Two ways to get at them:
//! - [`skip_trivia`], [`skip_trivia_back`], [`token_len`] and [`next_token`] look at the text next
//!   to a position that is known to be a token boundary, such as the end of a node. They cost
//!   nothing up front. Each says where it cannot be used.
//! - The methods of [`File`] below are those of ESLint's `SourceCode`, as iterators. The first
//!   call scans the whole file, so a rule should decide from the syntax whether there is anything
//!   to report, and look at tokens only then. After that a call is a binary search. The methods
//!   that only return comments (`comments*`) need no scan: the parser lists the comments.
//!
//! The tokens have the ranges and the types that ESLint's parser for the file gives them:
//! typescript-estree for TypeScript and where `languageOptions.parser` says so, otherwise espree.
//! See [`TokenKind`] for where the two differ.
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
//! | `getLastTokens(node, { count: 2 })` | `file.tokens_in(node).rev().take(2)`, **the last first** |
//! | `getTokensAfter(x)` | `file.tokens_after(x)` |
//! | `getTokenAfter(x, { skip: 1 })` | `file.tokens_after(x).nth(1)` |
//! | `getTokenAfter(x, isCommaToken)` | `file.tokens_after(x).find(is_comma_token)` |
//! | `getTokensAfter(x, { count: 2 })` | `file.tokens_after(x).take(2)` |
//! | `getTokensBefore(x)` | `file.tokens_before(x)`, **the nearest first** |
//! | `getTokenBefore(x, { skip: 1 })` | `file.tokens_before(x).nth(1)` |
//! | `getTokenBefore(x, isCommaToken)` | `file.tokens_before(x).find(is_comma_token)` |
//! | `getTokensBetween(a, b)`, `getFirstTokensBetween(a, b)` | `file.tokens_between(a, b)` |
//! | `getFirstTokenBetween(a, b)` | `file.tokens_between(a, b).next()` |
//! | `getLastTokenBetween(a, b)` | `file.tokens_between(a, b).next_back()` |
//! | `{ filter, skip }`, `{ filter, count }` | `.filter(..).nth(skip)`, `.filter(..).take(count)`: ESLint filters first too |
//! | `{ includeComments: true }` | `.with_comments()` on any of the iterators, before anything else |
//! | `getTokenBefore(x, { includeComments: true })` | `file.tokens_before(x).with_comments().next()` |
//! | `getTokens(node, 1, 2)`, `getTokensBetween(a, b, 1)` | `.padded(1, 2)`, `.padded(1, 1)` |
//! | `getTokenByRangeStart(i)` | `file.token_at(i)` |
//! | `getTokenByRangeStart(i, { includeComments: true })` | `file.token_or_comment_at(i)` |
//! | (what is at an index of the text) | `file.token_around(i)`, `file.comment_around(i)`, `file.token_or_comment_around(i)` |
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
//! `x`, `a`, `b` are anything with a [`Span`]: a node, a token, a comment, a span. As in ESLint,
//! only its range counts, and the range should start and end where a token or a comment does.
//! A token "in" a range is entirely inside it.

mod scan;

use crate::ast::File;
use crate::span::{Span, Spanned};
use bun_sema::check::spans;
use std::borrow::Cow;
use std::cell::OnceCell;

/// From `at`, past whitespace and comments: the start of the next token, or the end of the text.
///
/// `at` has to be between tokens: the end of a node or of a token, or inside whitespace. It cannot
/// be used among the children of a JSX element, where whitespace and `//` are text.
#[inline]
pub fn skip_trivia(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia(text, at as usize) as u32
}

/// From `at` back over whitespace and comments: the end of the previous token, or 0.
///
/// `at` has to be between tokens, and not among the children of a JSX element. Going backwards, a
/// `//` comment can only be recognized by looking at its line from the start, and only that line
/// is looked at. So the result is wrong where the line before `at` has a `//` that is not a
/// comment and is not in a string that starts on the same line: in a regular expression
/// (`/\/\//`), or in a template that started on an earlier line. `file.token_before(..)` is always
/// right.
#[inline]
pub fn skip_trivia_back(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia_back(text, at as usize) as u32
}

/// The length of the token that `text` starts with, which is 0 only if `text` is empty.
///
/// It knows nothing of what is before:
/// - A `/` is a `/` or a `/=`, never a regular expression.
/// - A `>` is always a token of its own: of `>=`, `>>` and `>>>=` it is the first character.
/// - A `<<` is one token, also where it opens two lists of type parameters.
/// - A template ends after its first `${`. A `}` is a `}`, not the continuation of a template.
/// - In a JSX tag, the name `a-b` ends at the `-`, and a `\` in a string skips a character.
#[inline]
pub fn token_len(text: &[u8]) -> usize {
    spans::token_end(text, 0, false)
}

/// The token after `at`, past whitespace and comments. Empty at the end of the text.
///
/// For the punctuation and the keywords around a node: the `(` after a callee, the `=` after a
/// pattern, the `,` after an element. The limits of [`skip_trivia`] and [`token_len`] apply.
#[inline]
pub fn next_token(text: &[u8], at: u32) -> Span {
    let start = skip_trivia(text, at);
    let len = token_len(text.get(start as usize..).unwrap_or_default());
    Span::new(start, start + len as u32)
}

/// ESLint's `token.type`.
///
/// The parsers that ESLint uses agree on where the tokens are, and on their types except for some
/// words. A JavaScript file gets what espree says, unless `languageOptions.parser` is
/// `@typescript-eslint/parser`. Every other file gets what typescript-estree says:
///
/// | | espree | typescript-estree |
/// | --- | --- | --- |
/// | `let`, `static`, `yield` that are a name: `a.static`, `{ let: 1 }`, `var yield` | `Keyword` | `Identifier` |
/// | the same with `ecmaVersion` 3 or 5 | only `static` is a `Keyword` | |
/// | `a` and `b` of the expression `a.b`, anywhere inside a JSX element: `<i>{a.b}</i>` | `Identifier` | `JsxIdentifier` |
/// | `a` and `b` of `<a:b c:d="">` | `JsxIdentifier` | `Identifier` |
/// | `this` of `<this.a>` | `JsxIdentifier` | `Keyword` |
///
/// For both:
/// - A reserved word that is a name is an `Identifier`: `a.if`, `{ default: 1 }`, `class { new() {} }`,
///   `export { a as default }`, `function (this: T) {}`, `a as const`.
/// - A word that is a keyword only in some places is always an `Identifier`: `async`, `await`, `of`,
///   `get`, `set`, `as`, `from`, `type`, `declare`, `readonly`, `abstract`, `namespace`, `any`, `string`, ..
///   In TypeScript `implements`, `interface`, `private`, `protected`, `public` (and `let`, `static`,
///   `yield`) are a `Keyword` where they act as one.
/// - The string that is the value of a JSX attribute is a `JsxText`.
/// - `` `a${ ``, `}b${` and `` }c` `` are one `Template` each.
/// - `</` and `/>` are two tokens each. The `>>` that closes two lists of type arguments is two.
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
    /// `#a`, with the `#`
    PrivateIdentifier,
    Punctuator,
    RegularExpression,
    String,
    Template,
    /// `// ..`. For espree, in a file that is not a module, also `<!-- ..` and, at the start of a
    /// line, `--> ..`.
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

/// The tokens and the comments of a file, each in source order, each once it is asked for.
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
        Span::new(self.raw.start, self.raw.end)
    }

    #[inline]
    pub fn start(self) -> u32 {
        self.raw.start
    }

    #[inline]
    pub fn end(self) -> u32 {
        self.raw.end
    }

    /// As it is written. For a comment, with its delimiters.
    #[inline]
    pub fn text(self) -> &'a [u8] {
        self.file.slice(self.span())
    }

    /// ESLint's `comment.value`: the text of a comment without its delimiters.
    pub fn comment_value(self) -> &'a [u8] {
        let span = match self.raw.kind {
            TokenKind::Block => self.span().shrink(2, 2),
            TokenKind::Line if self.text().starts_with(b"<!--") => self.span().shrink(4, 0),
            TokenKind::Line if self.text().starts_with(b"-->") => self.span().shrink(3, 0),
            TokenKind::Line | TokenKind::Shebang => self.span().shrink(2, 0),
            _ => self.span(),
        };
        self.file.slice(span)
    }

    /// ESLint's `token.value`, except for what espree decodes: as it is written, but a comment
    /// without its delimiters and a private identifier without its `#`.
    ///
    /// espree, not typescript-estree, decodes two things, which stay as they are written here:
    /// - The escape sequences of a name: the value of `a\u0062` is `ab`. [`Token::decoded_value`] and
    ///   [`Token::has_same_value`] do that.
    /// - The text between JSX tags (not the string of an attribute): the value of `&amp;` is `&`, and
    ///   that of a `\r\n` is `\n`. Nothing here does that.
    pub fn value(self) -> &'a [u8] {
        match self.raw.kind {
            TokenKind::PrivateIdentifier => self.file.slice(self.span().shrink(1, 0)),
            _ => self.comment_value(),
        }
    }

    /// Whether espree decodes escape sequences in it: the file is one of espree's, this is a name,
    /// and there is a `\` in it.
    fn has_decoded_value(self) -> bool {
        use TokenKind::{Boolean, Identifier, Keyword, Null, PrivateIdentifier};
        matches!(
            self.raw.kind,
            Identifier | Keyword | PrivateIdentifier | Boolean | Null
        ) && bun_core::strings::contains_char(self.text(), b'\\')
            && scan::is_espree(self.file)
    }

    /// [`Token::value`], and for espree a name with what its `\u0061` and `\u{61}` stand for.
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

    /// Whether it is written `text`.
    #[inline]
    pub fn is(self, text: &str) -> bool {
        self.text() == text.as_bytes()
    }

    /// Whether it is the punctuator `text`.
    #[inline]
    pub fn is_punctuator(self, text: &str) -> bool {
        self.raw.kind == TokenKind::Punctuator && self.is(text)
    }

    /// Whether it is the keyword `text`.
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

/// Some consecutive tokens of a file. [`Tokens::with_comments`] adds the comments among them.
#[derive(Copy, Clone)]
pub struct Tokens<'a> {
    file: &'a File<'a>,
    tokens: &'a [RawToken],
    /// Empty unless comments are included.
    comments: &'a [RawToken],
    /// The range of the text that `tokens` was selected by, to select the comments by.
    within: Span,
    /// The nearest first: what `tokens_before` returns.
    is_reversed: bool,
}

impl<'a> Tokens<'a> {
    /// ESLint's `{ includeComments: true }`. To be called before anything is taken from the
    /// iterator.
    pub fn with_comments(mut self) -> Self {
        self.comments = within(self.file.raw_comments(), self.within);
        self
    }

    /// With the `before` tokens before the first and the `after` tokens after the last, as many as
    /// there are: ESLint's `getTokens(node, before, after)`. To be called before anything is taken
    /// from the iterator. Comments are not included, as in ESLint.
    pub fn padded(mut self, before: usize, after: usize) -> Self {
        let all = self.file.raw_tokens();
        let first = all.partition_point(|token| token.start < self.within.start);
        let end = (first + self.tokens.len() + after).min(all.len());
        self.tokens = &all[first.saturating_sub(before)..end];
        self.comments = &[];
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

/// Those of `all` that are entirely inside `span`.
fn within(all: &[RawToken], span: Span) -> &[RawToken] {
    let first = all.partition_point(|token| token.start < span.start);
    let count = all[first..].partition_point(|token| token.end <= span.end);
    &all[first..first + count]
}

/// The code points of a name, with what its escape sequences stand for.
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

/// The one of `all` that `offset` is in.
fn around(all: &[RawToken], offset: u32) -> Option<&RawToken> {
    let after = all.partition_point(|token| token.start <= offset);
    all.get(after.checked_sub(1)?)
        .filter(|token| offset < token.end)
}

/// Whether there is nothing but whitespace in `text`, which is next to a comment.
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

/// Scans `file` without keeping the result, to measure it. Returns the number of tokens and
/// comments.
#[doc(hidden)]
pub fn scan_again(file: &File) -> usize {
    let (tokens, comments) = scan::scan(file);
    tokens.len() + comments.len()
}

/// The same for the comments alone, which are made from the list of the parser.
#[doc(hidden)]
pub fn comments_again(file: &File) -> usize {
    scan::comments(file).map_or(0, |comments| comments.len())
}

/// Whether the parser lists the comments that the scan finds: their number, `None` if not.
#[doc(hidden)]
pub fn scan_comments_again(file: &File) -> Option<usize> {
    let Some(comments) = scan::comments(file) else {
        return Some(0);
    };
    let range = |comment: &RawToken| (comment.start, comment.end, comment.kind);
    comments
        .iter()
        .map(range)
        .eq(scan::scan(file).1.iter().map(range))
        .then_some(comments.len())
}

impl<'a> File<'a> {
    fn raw_tokens(&self) -> &[RawToken] {
        let store = self.lazy.tokens.get_or_init(TokenStore::default);
        store.tokens.get_or_init(|| {
            let (tokens, comments) = scan::scan(self);
            // Already there if the comments were asked for first.
            let _ = store.comments.set(comments);
            tokens
        })
    }

    fn raw_comments(&self) -> &[RawToken] {
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

    /// All the tokens of the file.
    pub fn tokens(&'a self) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: self.raw_tokens(),
            comments: &[],
            within: self.span(),
            is_reversed: false,
        }
    }

    /// The tokens of a node.
    pub fn tokens_in(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(at.span(), false)
    }

    /// The tokens after a node, a token or a comment, to the end of the file.
    pub fn tokens_after(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(Span::new(at.span().end, self.span().end), false)
    }

    /// The tokens before a node, a token or a comment, **the nearest first**.
    pub fn tokens_before(&'a self, at: impl Spanned) -> Tokens<'a> {
        self.tokens_within(Span::new(0, at.span().start), true)
    }

    /// The tokens between the end of `a` and the start of `b`.
    pub fn tokens_between(&'a self, a: impl Spanned, b: impl Spanned) -> Tokens<'a> {
        self.tokens_within(a.span().between(b.span()), false)
    }

    /// The first token of a node.
    pub fn first_token(&'a self, at: impl Spanned) -> Option<Token<'a>> {
        let (tokens, span) = (self.raw_tokens(), at.span());
        let first = tokens.get(tokens.partition_point(|token| token.start < span.start));
        self.token(first.filter(|token| token.end <= span.end))
    }

    /// The last token of a node.
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

    /// The token or the comment that starts at `offset`.
    pub fn token_or_comment_at(&'a self, offset: u32) -> Option<Token<'a>> {
        self.token_at(offset).or_else(|| {
            let comments = self.raw_comments();
            let at = comments
                .binary_search_by_key(&offset, |comment| comment.start)
                .ok()?;
            self.token(comments.get(at))
        })
    }

    /// The token that `offset` is in: `start <= offset < end`. `None` between tokens.
    pub fn token_around(&'a self, offset: u32) -> Option<Token<'a>> {
        self.token(around(self.raw_tokens(), offset))
    }

    /// The comment that `offset` is in.
    pub fn comment_around(&'a self, offset: u32) -> Option<Token<'a>> {
        self.token(around(self.raw_comments(), offset))
    }

    /// The token or the comment that `offset` is in. `None` in whitespace.
    pub fn token_or_comment_around(&'a self, offset: u32) -> Option<Token<'a>> {
        self.comment_around(offset)
            .or_else(|| self.token_around(offset))
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

    /// All the comments of the file. A `#!` line is the first of them.
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

    /// Whether there is a comment between the end of `a` and the start of `b`.
    pub fn comments_exist_between(&'a self, a: impl Spanned, b: impl Spanned) -> bool {
        let (comments, between) = (self.raw_comments(), a.span().between(b.span()));
        let first = comments.get(comments.partition_point(|comment| comment.start < between.start));
        first.is_some_and(|comment| comment.end <= between.end)
    }

    /// The comments directly before a node, a token or a comment: after the token that precedes
    /// it. In source order.
    pub fn comments_before(&'a self, at: impl Spanned) -> Tokens<'a> {
        let (comments, end) = (self.raw_comments(), at.span().start);
        let after = comments.partition_point(|comment| comment.end <= end);
        let (mut first, mut start) = (after, end);
        while let Some(comment) = first.checked_sub(1).and_then(|before| comments.get(before))
            && is_whitespace(self.slice(Span::new(comment.end, start)))
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

    /// The comments directly after a node, a token or a comment: before the token that follows it.
    pub fn comments_after(&'a self, at: impl Spanned) -> Tokens<'a> {
        let (comments, start) = (self.raw_comments(), at.span().end);
        let first = comments.partition_point(|comment| comment.start < start);
        let (mut after, mut end) = (first, start);
        while let Some(comment) = comments.get(after)
            && is_whitespace(self.slice(Span::new(end, comment.start)))
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

    /// ESLint's `isSpaceBetween`: whether there is whitespace between `a` and `b`, in either order,
    /// outside of tokens and comments. Whitespace in a `JsxText` does not count. False if they
    /// overlap.
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
