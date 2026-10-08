//! What a listener of a rule is given besides the node: the file, the state of the rule, and the
//! means to report.

use crate::ast::{File, Ident, Name};
use crate::fix::{Fix, Fixer, IntoFix};
use crate::rule::{Message, Rule};
use crate::span::{Position, Span, Spanned};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::{Cell, RefCell};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Severity {
    Off,
    Warn,
    Error,
}

/// What a rule has found, as ESLint's `LintMessage`.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The index of the rule among those that run on the file.
    pub rule: u16,
    pub severity: Severity,
    pub message_id: &'static str,
    pub message: Vec<u8>,
    pub span: Span,
    /// ESLint was given a position, not a range: it reports no `endLine` and `endColumn`.
    pub has_no_end: bool,
    /// The start that is reported in place of that of `span`: [`Report::start_at`].
    pub start_position: Option<Position>,
    /// The end that is reported in place of that of `span`: [`Report::end_at`].
    pub end_position: Option<Position>,
    /// [`Report::comments_apply_at`]
    pub comments_apply_at: Option<Span>,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggestion>,
}

#[derive(Clone, Debug)]
pub struct Suggestion {
    pub message_id: &'static str,
    pub message: Vec<u8>,
    /// What the placeholders of the message stand for, which ESLint passes on with a suggestion.
    pub data: Vec<(&'static str, Vec<u8>)>,
    pub fix: Fix,
}

/// Collects what the rules report about one file.
#[derive(Default)]
pub(crate) struct Sink {
    pub(crate) diagnostics: RefCell<Vec<Diagnostic>>,
    /// Whether anything reads `Diagnostic::fix` and `Diagnostic::suggestions`. If not, they are
    /// not computed.
    pub(crate) wants_fixes: Cell<bool>,
}

/// The context of the rule `R` in the file that is linted. It dereferences to the [`File`].
pub struct Cx<'a, R: Rule> {
    /// What [`Rule::register`] returned.
    pub state: R::State<'a>,
    pub(crate) file: &'a File<'a>,
    pub(crate) rule: u16,
    pub(crate) severity: Severity,
}

impl<'a, R: Rule> std::ops::Deref for Cx<'a, R> {
    type Target = File<'a>;
    #[inline]
    fn deref(&self) -> &File<'a> {
        self.file
    }
}

impl<'a, R: Rule> Cx<'a, R> {
    #[inline]
    pub fn file(&self) -> &'a File<'a> {
        self.file
    }

    /// Reports `message` at a node, a token, a comment or a [`Span`].
    ///
    /// What is returned adds to the report, which is made when it goes out of scope:
    ///
    /// ```ignore
    /// cx.report(ident, UNUSED)
    ///     .data("name", ident.name())
    ///     .fix(|fixer| fixer.remove(declaration));
    /// ```
    #[cold]
    pub fn report(&self, at: impl Spanned, message: Message) -> Report<'a> {
        Report {
            file: self.file,
            message,
            data: SmallVec::new(),
            diagnostic: Some(Diagnostic {
                rule: self.rule,
                severity: self.severity,
                message_id: message.id,
                message: Vec::new(),
                span: at.span(),
                has_no_end: false,
                start_position: None,
                end_position: None,
                comments_apply_at: None,
                fix: None,
                suggestions: Vec::new(),
            }),
        }
    }

    /// Reports `message` at a position: where ESLint's `loc` is a `{ line, column }` and not a
    /// range.
    #[cold]
    pub fn report_at(&self, offset: u32, message: Message) -> Report<'a> {
        let mut report = self.report(Span::empty(offset), message);
        if let Some(diagnostic) = &mut report.diagnostic {
            diagnostic.has_no_end = true;
        }
        report
    }
}

type Data<'a> = SmallVec<[(&'static str, Cow<'a, [u8]>); 2]>;

/// A report in the making. See [`Cx::report`].
pub struct Report<'a> {
    file: &'a File<'a>,
    message: Message,
    data: Data<'a>,
    diagnostic: Option<Diagnostic>,
}

impl<'a> Report<'a> {
    /// What `{{name}}` in the message stands for.
    pub fn data(mut self, name: &'static str, value: impl IntoText<'a>) -> Self {
        self.data.push((name, value.into_text()));
        self
    }

    /// Reports `start` as the start, for the rare rule whose `loc.start` is a line and a column that are not in the text: some
    /// report what concerns the configuration at line 0.
    pub fn start_at(mut self, start: Position) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.start_position = Some(start);
        }
        self
    }

    /// Reports `end` as the end, for the rare rule whose `loc.end` is a line and a column that are not in the text. ESLint's
    /// column -1 is `u32::MAX`.
    pub fn end_at(mut self, end: Position) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.end_position = Some(end);
        }
        self
    }

    /// For a port of a rule of oxlint whose diagnostic has several labels. oxlint prints where the first is, which is what is
    /// reported. Whether a comment disables the rule there it decides by the primary label: `primary`.
    pub fn comments_apply_at(mut self, primary: impl Spanned) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.comments_apply_at = Some(primary.span());
        }
        self
    }

    /// How to fix it, as ESLint's `fix`. `fix` returns a [`Fix`], an `Option` of one, or several
    /// in an array or a `Vec`, which must not overlap and are applied together.
    ///
    /// It is called only if the fix is going to be applied or shown.
    pub fn fix<F: IntoFix>(mut self, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        if self.file.sink.wants_fixes.get()
            && let Some(diagnostic) = &mut self.diagnostic
        {
            diagnostic.fix = fix(Fixer::new(self.file)).into_fix(self.file);
        }
        self
    }

    /// A change that an editor can offer, as an element of ESLint's `suggest`.
    pub fn suggest<F: IntoFix>(self, message: Message, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        self.suggest_with(message, &[], fix)
    }

    /// The same for a message with `{{placeholders}}`.
    pub fn suggest_with<F: IntoFix>(
        mut self,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        if self.file.sink.wants_fixes.get()
            && let Some(diagnostic) = &mut self.diagnostic
            && let Some(fix) = fix(Fixer::new(self.file)).into_fix(self.file)
        {
            diagnostic.suggestions.push(Suggestion {
                message_id: message.id,
                message: interpolate(message, |name| data.iter().find(|it| it.0 == name).map(|it| it.1)),
                data: data.iter().map(|it| (it.0, it.1.to_vec())).collect(),
                fix,
            });
        }
        self
    }
}

impl Drop for Report<'_> {
    fn drop(&mut self) {
        if let Some(mut diagnostic) = self.diagnostic.take() {
            diagnostic.message = interpolate(self.message, |name| self.data.iter().find(|it| it.0 == name).map(|it| &*it.1));
            self.file.sink.diagnostics.borrow_mut().push(diagnostic);
        }
    }
}

/// ESLint's `interpolate`: replaces each `{{ name }}` by `data(name)`, and leaves it if there is none. A name has no braces in it,
/// so `{{{name}}}` is `{`, the value, `}`.
fn interpolate<'d>(message: Message, data: impl Fn(&str) -> Option<&'d [u8]>) -> Vec<u8> {
    let text = message.text;
    let bytes = text.as_bytes();
    if !message.may_have_placeholders {
        return bytes.to_vec();
    }
    let mut out = Vec::with_capacity(text.len() + 16);
    let mut at = 0;
    while let Some(found) = bun_core::strings::index_of_char_usize(&bytes[at..], b'{') {
        let open = at + found;
        if bytes.get(open + 1) != Some(&b'{') {
            out.extend_from_slice(&bytes[at..=open]);
            at = open + 1;
            continue;
        }
        let name_start = open + 2;
        let name_len = bun_core::strings::index_of_any(&bytes[name_start..], b"{}").unwrap_or(bytes.len() - name_start);
        let name_end = name_start + name_len;
        let value = match name_len > 0 && bytes[name_end..].starts_with(b"}}") {
            true => data(text[name_start..name_end].trim()),
            false => None,
        };
        match value {
            Some(value) => {
                out.extend_from_slice(&bytes[at..open]);
                out.extend_from_slice(value);
                at = name_end + 2;
            }
            // The second brace can be the first of the next pair.
            None => {
                out.extend_from_slice(&bytes[at..=open]);
                at = open + 1;
            }
        }
    }
    out.extend_from_slice(&bytes[at..]);
    out
}

/// What can be put into a message or a fix.
pub trait IntoText<'a> {
    fn into_text(self) -> Cow<'a, [u8]>;
}

impl<'a> IntoText<'a> for &'a [u8] {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self)
    }
}
impl<'a, const N: usize> IntoText<'a> for &'a [u8; N] {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self)
    }
}
impl<'a> IntoText<'a> for &'a str {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self.as_bytes())
    }
}
impl<'a> IntoText<'a> for Vec<u8> {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Owned(self)
    }
}
impl<'a> IntoText<'a> for String {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Owned(self.into_bytes())
    }
}
impl<'a> IntoText<'a> for Cow<'a, [u8]> {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        self
    }
}
impl<'a> IntoText<'a> for Name<'a> {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self.bytes())
    }
}
impl<'a> IntoText<'a> for Ident<'a> {
    #[inline]
    fn into_text(self) -> Cow<'a, [u8]> {
        Cow::Borrowed(self.bytes())
    }
}

macro_rules! numbers_into_text {
    ($($ty:ty)*) => {
        $(impl<'a> IntoText<'a> for $ty {
            fn into_text(self) -> Cow<'a, [u8]> {
                Cow::Owned(self.to_string().into_bytes())
            }
        })*
    };
}
numbers_into_text!(u8 u16 u32 u64 usize i32 i64 isize char);
