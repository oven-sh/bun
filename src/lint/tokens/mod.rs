//! Tokens and comments.
//!
//! The HIR does not store tokens. Two ways to get at them:
//! - [`skip_trivia`], [`skip_trivia_back`] and [`token_len`] look at the text next to a position
//!   that is known to be a token boundary, such as the end of a node. They cost nothing up front.
//! - The methods of [`File`] below are those of ESLint's `SourceCode`, as iterators. The first
//!   call scans the whole file, so a rule should decide from the syntax whether there is anything
//!   to report, and look at tokens only then.
//!
//! | ESLint | here |
//! | --- | --- |
//! | `getFirstToken(node)` | `file.tokens_in(node).next()` |
//! | `getLastToken(node)` | `file.tokens_in(node).next_back()` |
//! | `getTokens(node)` | `file.tokens_in(node)` |
//! | `getTokenBefore(x)` | `file.tokens_before(x).next()` |
//! | `getTokenAfter(x)` | `file.tokens_after(x).next()` |
//! | `getTokenAfter(x, { skip: 1 })` | `file.tokens_after(x).nth(1)` |
//! | `getTokenAfter(x, isCommaToken)` | `file.tokens_after(x).find(\|t\| t.is(","))` |
//! | `getTokensAfter(x, { count: 2 })` | `file.tokens_after(x).take(2)` |
//! | `getTokensBetween(a, b)` | `file.tokens_between(a, b)` |
//! | `getFirstTokenBetween(a, b)` | `file.tokens_between(a, b).next()` |
//! | `getLastTokenBetween(a, b)` | `file.tokens_between(a, b).next_back()` |
//! | `{ includeComments: true }` | `.with_comments()` on any of these |
//! | `getTokenByRangeStart(i)` | `file.token_at(i)` |
//! | `getAllComments()` | `file.comments()` |
//! | `getCommentsBefore(x)` | `file.comments_before(x)` |
//! | `getCommentsAfter(x)` | `file.comments_after(x)` |
//! | `getCommentsInside(node)` | `file.comments_in(node)` |
//! | `commentsExistBetween(a, b)` | `file.comments_between(a, b).next().is_some()` |
//! | `isSpaceBetween(a, b)` | `file.is_space_between(a, b)` |

mod scan;

use crate::ast::File;
use crate::span::{Span, Spanned};
use bun_sema::check::spans;

/// From `at`, past whitespace and comments: the start of the next token.
#[inline]
pub fn skip_trivia(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia(text, at as usize) as u32
}

/// From `at` back over whitespace and comments: the end of the previous token.
#[inline]
pub fn skip_trivia_back(text: &[u8], at: u32) -> u32 {
    spans::skip_trivia_back(text, at as usize) as u32
}

/// The length of the token that `text` starts with. A template ends at its first `${`, and a `/`
/// is never a regular expression.
#[inline]
pub fn token_len(text: &[u8]) -> usize {
    spans::token_end(text, 0, false)
}

/// ESLint's `token.type`.
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
    PrivateIdentifier,
    Punctuator,
    RegularExpression,
    String,
    Template,
    /// `// ..`
    Line,
    /// `/* .. */`
    Block,
    /// `#!..` on the first line
    Shebang,
}

impl TokenKind {
    #[inline]
    pub fn is_comment(self) -> bool {
        matches!(self, TokenKind::Line | TokenKind::Block | TokenKind::Shebang)
    }
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct RawToken {
    pub(crate) start: u32,
    pub(crate) end: u32,
    pub(crate) kind: TokenKind,
}

/// The tokens and the comments of a file, each in source order.
#[derive(Default)]
pub(crate) struct TokenStore {
    pub(crate) tokens: Vec<RawToken>,
    pub(crate) comments: Vec<RawToken>,
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
            TokenKind::Line | TokenKind::Shebang => self.span().shrink(2, 0),
            _ => self.span(),
        };
        self.file.slice(span)
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
    /// ESLint's `{ includeComments: true }`.
    pub fn with_comments(mut self) -> Self {
        self.comments = within(&self.file.token_store().comments, self.within);
        self
    }

    fn front(&mut self) -> Option<RawToken> {
        match (self.tokens.first(), self.comments.first()) {
            (Some(token), Some(comment)) if comment.start < token.start => self.comments.split_off_first(),
            (Some(_), _) => self.tokens.split_off_first(),
            (None, _) => self.comments.split_off_first(),
        }
        .copied()
    }

    fn back(&mut self) -> Option<RawToken> {
        match (self.tokens.last(), self.comments.last()) {
            (Some(token), Some(comment)) if comment.start > token.start => self.comments.split_off_last(),
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

/// Scans `file` without keeping the result, to measure it. Returns the number of tokens and
/// comments.
#[doc(hidden)]
pub fn scan_again(file: &File) -> usize {
    let store = scan::scan(file);
    store.tokens.len() + store.comments.len()
}

impl<'a> File<'a> {
    pub(crate) fn token_store(&self) -> &TokenStore {
        self.lazy.tokens.get_or_init(|| scan::scan(self))
    }

    fn tokens_within(&'a self, span: Span, is_reversed: bool) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: within(&self.token_store().tokens, span),
            comments: &[],
            within: span,
            is_reversed,
        }
    }

    /// All the tokens of the file.
    pub fn tokens(&'a self) -> Tokens<'a> {
        self.tokens_within(self.span(), false)
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

    /// The token that starts at `offset`.
    pub fn token_at(&'a self, offset: u32) -> Option<Token<'a>> {
        let tokens = &self.token_store().tokens;
        let at = tokens.binary_search_by_key(&offset, |token| token.start).ok()?;
        Some(Token {
            file: self,
            raw: tokens[at],
        })
    }

    fn comments_within(&'a self, span: Span) -> Tokens<'a> {
        Tokens {
            file: self,
            tokens: &[],
            comments: within(&self.token_store().comments, span),
            within: span,
            is_reversed: false,
        }
    }

    /// All the comments of the file.
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

    /// The comments directly before a node or a token: after the token that precedes it. In
    /// source order.
    pub fn comments_before(&'a self, at: impl Spanned) -> Tokens<'a> {
        let start = at.span().start;
        let previous = self.tokens_before(Span::empty(start)).next();
        self.comments_within(Span::new(previous.map_or(0, Token::end), start))
    }

    /// The comments directly after a node or a token: before the token that follows it.
    pub fn comments_after(&'a self, at: impl Spanned) -> Tokens<'a> {
        let end = at.span().end;
        let next = self.tokens_after(Span::empty(end)).next();
        self.comments_within(Span::new(end, next.map_or(self.span().end, Token::start)))
    }

    /// ESLint's `isSpaceBetween`: whether there is whitespace between the end of `a` and the start
    /// of `b`, outside of tokens and comments.
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
