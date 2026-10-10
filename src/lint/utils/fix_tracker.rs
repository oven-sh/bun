//! ESLint's `lib/rules/utils/fix-tracker.js`.

use super::ast_utils::get_upper_function;
use super::estree_compat::estree_span;
use crate::ast::{File, Node};
use crate::context::IntoText;
use crate::fix::{Fix, Fixer};
use crate::span::{Span, Spanned};
use crate::tokens::{Token, skip_trivia};

/// ESLint's `FixTracker`. Makes a fix whose range is wider than what it changes, so that no other
/// fix changes the rest of the range in the same pass.
///
/// `new FixTracker(fixer, sourceCode).retainRange(range).remove(node)` is
/// `FixTracker::new(fixer).retain_range(range).remove(node)`.
#[derive(Copy, Clone)]
pub struct FixTracker<'a> {
    fixer: Fixer<'a>,
    retained: Option<Span>,
}

impl<'a> FixTracker<'a> {
    /// ESLint's `new FixTracker(fixer, sourceCode)`.
    #[inline]
    pub fn new(fixer: Fixer<'a>) -> Self {
        FixTracker {
            fixer,
            retained: None,
        }
    }

    /// ESLint's `retainRange`. Replaces what was retained before.
    #[inline]
    pub fn retain_range(mut self, range: Span) -> Self {
        self.retained = Some(range);
        self
    }

    /// ESLint's `retainEnclosingFunction`. Retains the innermost function that `node` is or is in,
    /// or else the whole program.
    pub fn retain_enclosing_function(self, node: impl Into<Node<'a>>) -> Self {
        self.retain_range(match get_upper_function(node) {
            Some(function) => estree_span(function.into()),
            None => program_span(self.fixer.file()),
        })
    }

    /// ESLint's `retainSurroundingTokens`. Retains from the token before `at`, which is a node or a
    /// token, to the token after it.
    pub fn retain_surrounding_tokens(self, at: impl Spanned) -> Self {
        let (file, at) = (self.fixer.file(), at.span());
        let start = file.tokens_before(at).next().map_or(at.start, Token::start);
        let end = file.tokens_after(at).next().map_or(at.end, Token::end);
        self.retain_range(Span::new(start, end))
    }

    /// ESLint's `replaceTextRange`.
    pub fn replace_text_range<'t>(self, range: Span, text: impl IntoText<'t>) -> Fix {
        let Some(retained) = self.retained else {
            return self.fixer.replace(range, text);
        };
        let file = self.fixer.file();
        let actual = Span::new(retained.start.min(range.start), retained.end.max(range.end));
        let text = text.into_text();
        let (before, after) = (
            file.slice(Span::new(actual.start, range.start)),
            file.slice(Span::new(range.end, actual.end)),
        );
        let mut all = Vec::with_capacity(before.len() + text.len() + after.len());
        all.extend_from_slice(before);
        all.extend_from_slice(&text);
        all.extend_from_slice(after);
        Fix {
            span: actual,
            text: all,
        }
    }

    /// ESLint's `remove`.
    #[inline]
    pub fn remove(self, at: impl Spanned) -> Fix {
        self.replace_text_range(at.span(), "")
    }
}

/// ESLint's `sourceCode.ast.range`. espree's `Program` is the whole text, typescript-estree's starts
/// at the first token.
fn program_span(file: &File<'_>) -> Span {
    let whole = file.span();
    match file.is_javascript() {
        true => whole,
        false => Span::new(skip_trivia(file.text(), 0).min(whole.end), whole.end),
    }
}
