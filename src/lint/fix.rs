//! Changes to the source text.

use crate::ast::File;
use crate::context::IntoText;
use crate::span::{Span, Spanned};

/// Replaces `span` by `text`.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Fix {
    pub span: Span,
    pub text: Vec<u8>,
}

/// How much a change that `--fix` does not make can be trusted: oxlint's `FixKind`. ESLint knows the first only.
#[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
pub enum SuggestionKind {
    /// It may change what the program does: `--fix-suggestions` makes it.
    #[default]
    Suggestion,
    /// It may break the program: `--fix-dangerously` makes it.
    DangerousFix,
    /// Both flags together make it.
    DangerousSuggestion,
}

/// The longest string that JavaScript has, in V8: `" ".repeat(n)` throws beyond it.
pub const MAX_STRING_LENGTH: u64 = (1 << 29) - 24;

/// Makes [`Fix`]es, as ESLint's `fixer`. Each method takes a node, a token, a comment or a
/// [`Span`].
#[derive(Copy, Clone)]
pub struct Fixer<'a> {
    file: &'a File<'a>,
}

impl<'a> Fixer<'a> {
    #[inline]
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        Fixer { file }
    }

    #[inline]
    pub fn file(self) -> &'a File<'a> {
        self.file
    }

    /// `byte`, `count` times: the only way to a text whose length a number in the options decides. `None`: it would be longer than
    /// what fixes may make of the file ([`max_fixed_len`](crate::linter::max_fixed_len)), so that it could not be applied: it is
    /// not built. See [`Cx::repeat_count`](crate::context::Cx::repeat_count).
    pub fn repeat(self, byte: u8, count: u64) -> Option<Vec<u8>> {
        let most = crate::linter::max_fixed_len(self.file.text().len()) as u64;
        (count <= most).then(|| vec![byte; count as usize])
    }

    /// `replaceText`, `replaceTextRange`
    pub fn replace<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: at.span(),
            text: text.into_text().into_owned(),
        }
    }

    /// `remove`, `removeRange`
    pub fn remove(self, at: impl Spanned) -> Fix {
        Fix {
            span: at.span(),
            text: Vec::new(),
        }
    }

    /// `insertTextBefore`, `insertTextBeforeRange`
    pub fn insert_before<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: Span::empty(at.span().start),
            text: text.into_text().into_owned(),
        }
    }

    /// `insertTextAfter`, `insertTextAfterRange`
    pub fn insert_after<'t>(self, at: impl Spanned, text: impl IntoText<'t>) -> Fix {
        Fix {
            span: Span::empty(at.span().end),
            text: text.into_text().into_owned(),
        }
    }
}

/// What the function given to [`Report::fix`](crate::context::Report::fix) returns.
pub trait IntoFix {
    /// ESLint's `mergeFixes`: one fix that does what all of them do. `None` if there are none, or
    /// if two overlap.
    fn into_fix(self, file: &File) -> Option<Fix>;

    /// The one that was made first.
    fn first_fix(&self) -> Option<&Fix>;
}

impl IntoFix for Fix {
    #[inline]
    fn into_fix(self, _: &File) -> Option<Fix> {
        Some(self)
    }

    #[inline]
    fn first_fix(&self) -> Option<&Fix> {
        Some(self)
    }
}

impl<T: IntoFix> IntoFix for Option<T> {
    #[inline]
    fn into_fix(self, file: &File) -> Option<Fix> {
        self?.into_fix(file)
    }

    #[inline]
    fn first_fix(&self) -> Option<&Fix> {
        self.as_ref()?.first_fix()
    }
}

impl IntoFix for Vec<Fix> {
    fn first_fix(&self) -> Option<&Fix> {
        self[..].first()
    }
    fn into_fix(mut self, file: &File) -> Option<Fix> {
        if self.len() <= 1 {
            return self.pop();
        }
        crate::utils::sort::sort_by_key(&mut self, |fix| (fix.span.start, fix.span.end));
        let (start, end) = (self.first()?.span.start, self.last()?.span.end);
        let mut text = Vec::new();
        let mut at = start;
        for fix in &self {
            if fix.span.start < at {
                return None;
            }
            text.extend_from_slice(file.slice(Span::before(at, fix.span)));
            text.extend_from_slice(&fix.text);
            at = fix.span.end;
        }
        Some(Fix {
            span: Span::new(start, end.max(at)),
            text,
        })
    }
}

impl<const N: usize> IntoFix for [Fix; N] {
    fn first_fix(&self) -> Option<&Fix> {
        self[..].first()
    }
    fn into_fix(self, file: &File) -> Option<Fix> {
        Vec::from(self).into_fix(file)
    }
}

/// ESLint's `SourceCodeFixer.applyFixes`: applies those of `fixes` that do not overlap an earlier
/// one, and returns the new text. `None` if nothing is applied.
pub fn apply_fixes(text: &[u8], fixes: &mut Vec<&Fix>) -> Option<Vec<u8>> {
    crate::utils::sort::sort_by_key(fixes, |fix| (fix.span.start, fix.span.end));
    let mut out = Vec::with_capacity(text.len());
    // ESLint starts at -1, so that an insertion at 0 does not conflict with nothing.
    let mut last: i64 = -1;
    let mut at = 0usize;
    let mut applied = false;
    for fix in fixes.iter() {
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        if last >= start as i64 || start > end {
            continue;
        }
        // A range can go beyond the text, as for `String.prototype.slice`.
        let start = start.min(text.len());
        out.extend_from_slice(&text[at.min(start)..start]);
        out.extend_from_slice(&fix.text);
        at = end.min(text.len());
        last = end as i64;
        applied = true;
    }
    out.extend_from_slice(&text[at..]);
    applied.then_some(out)
}
