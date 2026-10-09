//! What a listener of a rule is given besides the node: the file, the state of the rule, and the
//! means to report.

use crate::ast::{File, Ident, Name};
use crate::fix::{Fix, Fixer, IntoFix, SuggestionKind};
use crate::oxlint_help::{self, Help};
use crate::rule::{Message, Meta, Rule};
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
    pub details: Option<Box<Details>>,
    /// The help of oxlint, if `details` has none. Once the report is complete it is one without values.
    pub constant_help: Option<Help>,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggestion>,
}

/// What few diagnostics have: what one of oxlint has besides its message and its place, where a text that is empty is not there,
/// and a place that is not that of `span`.
#[derive(Clone, Debug, Default)]
pub struct Details {
    /// The start that is reported in place of that of `span`: [`Report::start_at`].
    pub start_position: Option<Position>,
    /// The end that is reported in place of that of `span`: [`Report::end_at`].
    pub end_position: Option<Position>,
    /// [`Report::comments_apply_at`]
    pub comments_apply_at: Option<Span>,
    /// What is said at the place of the report.
    pub first_label: Cow<'static, str>,
    /// The other places that are marked, and what is said at each.
    pub labels: Vec<(Span, Cow<'static, str>)>,
    pub help: Cow<'static, str>,
    pub note: Cow<'static, str>,
}

impl Details {
    fn len(&self) -> usize {
        let labels = self.labels.iter().map(|it| it.1.len());
        self.first_label.len() + self.help.len() + self.note.len() + labels.sum::<usize>()
    }

    /// What is said at the place of the report.
    pub fn first(&mut self, text: impl Into<Cow<'static, str>>) {
        self.first_label = text.into();
    }

    /// One more place that is marked, and what is said there.
    pub fn push(&mut self, at: impl Spanned, text: impl Into<Cow<'static, str>>) {
        self.labels.push((at.span(), text.into()));
    }
}

#[derive(Clone, Debug)]
pub struct Suggestion {
    pub message_id: &'static str,
    pub message: Vec<u8>,
    /// What the placeholders of the message stand for, which ESLint passes on with a suggestion.
    pub data: Vec<(&'static str, Vec<u8>)>,
    pub fix: Fix,
    pub kind: SuggestionKind,
}

/// Collects what the rules report about one file.
#[derive(Default)]
pub(crate) struct Sink {
    pub(crate) diagnostics: RefCell<Vec<Diagnostic>>,
    /// Whether anything reads `Diagnostic::fix` and `Diagnostic::suggestions`. If not, they are
    /// not computed.
    pub(crate) wants_fixes: Cell<bool>,
    /// Whether anything reads the help of oxlint. If not, it is not looked up.
    pub(crate) wants_help: Cell<bool>,
    /// By `Diagnostic::rule`: how many bytes the messages, fixes and suggestions of the rule have.
    pub(crate) bytes: RefCell<Vec<u64>>,
}

/// The context of the rule `R` in the file that is linted. It dereferences to the [`File`].
pub struct Cx<'a, R: Rule> {
    /// What [`Rule::register`] returned.
    pub state: R::State<'a>,
    pub(crate) base: CxBase<'a>,
}

/// What of a [`Cx`] is the same for all rules, so that what is done with it is compiled once and not for each rule.
pub(crate) struct CxBase<'a> {
    pub(crate) file: &'a File<'a>,
    pub(crate) meta: &'static Meta,
    pub(crate) rule: u16,
    pub(crate) severity: Severity,
    /// How often the rule has reported in this file.
    pub(crate) reports: Cell<u32>,
    /// [`Cx::has_reported_too_much`]
    pub(crate) is_capped: Cell<bool>,
}

/// How many problems a rule can report in one file. A few rules report each pair of n things, as they do in ESLint, which takes
/// more memory than there is for an n that a generated file can have.
pub const MAX_REPORTS: u32 = 65_536;

/// How many bytes the messages, fixes and suggestions of a rule can have in one file. A few rules quote in each of n messages,
/// or replace in each of n fixes, a text whose length grows with n.
pub const MAX_REPORTED_BYTES: u64 = 256 << 20;

const TOO_MANY_PROBLEMS: Message = Message::new(
    "tooManyProblems",
    "This rule reported more than 65,536 problems in this file. The rest are not shown.",
);
const TOO_LARGE_PROBLEMS: Message = Message::new(
    "tooLargeProblems",
    "The problems that this rule reported in this file take more than 256 MB with their fixes. The rest are not shown.",
);

impl<'a, R: Rule> std::ops::Deref for Cx<'a, R> {
    type Target = File<'a>;
    #[inline]
    fn deref(&self) -> &File<'a> {
        self.base.file
    }
}

impl<'a, R: Rule> Cx<'a, R> {
    #[inline]
    pub fn file(&self) -> &'a File<'a> {
        self.base.file
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
    ///
    /// After [`MAX_REPORTS`] reports, or [`MAX_REPORTED_BYTES`] bytes, one more says so where the next would be, and nothing is
    /// made of the rest.
    #[inline]
    pub fn report(&self, at: impl Spanned, message: Message) -> Report<'a> {
        self.base.report(at.span(), message)
    }

    /// Whether the rule has reported as much as it can in this file: whatever else it finds is not shown. For a rule that can
    /// find many times as much, to stop looking.
    #[inline]
    pub fn has_reported_too_much(&self) -> bool {
        self.base.is_capped.get()
    }

    /// Reports `message` at a position: where ESLint's `loc` is a `{ line, column }` and not a
    /// range.
    #[inline]
    pub fn report_at(&self, offset: u32, message: Message) -> Report<'a> {
        self.base.report_at(offset, message)
    }

    /// Reports `message` about the file as a whole, at no place in it: a diagnostic of oxlint without a label. Where a format
    /// wants numbers it has line 0 and column 0, and there is no excerpt.
    #[inline]
    pub fn report_file(&self, message: Message) -> Report<'a> {
        let nowhere = Position {
            line: 0,
            column: u32::MAX,
        };
        self.base.report_at(0, message).start_at(nowhere)
    }
}

impl<'a> CxBase<'a> {
    #[cold]
    #[inline(never)]
    fn report(&self, span: Span, message: Message) -> Report<'a> {
        let language = self.file.language();
        let message = match language.is_oxlint {
            true => crate::oxlint_messages::of(self.meta, message),
            false if language.eslint_8.is_some() => {
                crate::linter::config::eslint8::message_of(self.meta, message)
            }
            false => message,
        };
        let help = match language.is_oxlint && self.file.sink.wants_help.get() {
            true => oxlint_help::of(self.meta, message),
            false => None,
        };
        let diagnostic = |message: Message, constant_help: Option<Help>| Diagnostic {
            rule: self.rule,
            severity: self.severity,
            message_id: message.id,
            message: Vec::new(),
            span,
            has_no_end: false,
            details: None,
            constant_help,
            fix: None,
            suggestions: Vec::new(),
        };
        if !self.is_capped.get() {
            let bytes = self
                .file
                .sink
                .bytes
                .borrow()
                .get(self.rule as usize)
                .copied();
            let closing = match self.reports.get() {
                MAX_REPORTS => Some(TOO_MANY_PROBLEMS),
                _ if bytes.is_some_and(|it| it > MAX_REPORTED_BYTES) => Some(TOO_LARGE_PROBLEMS),
                reports => {
                    self.reports.set(reports + 1);
                    None
                }
            };
            if let Some(closing) = closing {
                self.is_capped.set(true);
                drop(Report {
                    file: self.file,
                    message: closing,
                    data: SmallVec::new(),
                    diagnostic: Some(diagnostic(closing, None)),
                });
            }
        }
        Report {
            file: self.file,
            message,
            data: SmallVec::new(),
            diagnostic: (!self.is_capped.get()).then(|| diagnostic(message, help)),
        }
    }

    #[cold]
    #[inline(never)]
    fn report_at(&self, offset: u32, message: Message) -> Report<'a> {
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
    #[inline]
    pub fn data(mut self, name: &'static str, value: impl IntoText<'a>) -> Self {
        self.push_data(name, value.into_text());
        self
    }

    /// What of [`Report::data`] is the same for all values.
    #[inline(never)]
    fn push_data(&mut self, name: &'static str, value: Cow<'a, [u8]>) {
        if self.diagnostic.is_some() {
            self.data.push((name, value));
        }
    }

    /// Reports `start` as the start, for the rare rule whose `loc.start` is a line and a column that are not in the text: some
    /// report what concerns the configuration at line 0.
    pub fn start_at(mut self, start: Position) -> Self {
        if let Some(details) = self.details() {
            details.start_position = Some(start);
        }
        self
    }

    /// Reports `end` as the end, for the rare rule whose `loc.end` is a line and a column that are not in the text. ESLint's
    /// column -1 is `u32::MAX`.
    pub fn end_at(mut self, end: Position) -> Self {
        if let Some(details) = self.details() {
            details.end_position = Some(end);
        }
        self
    }

    /// For a port of a rule of oxlint whose diagnostic has several labels. oxlint prints where the first is, which is what is
    /// reported. Whether a comment disables the rule there it decides by the primary label: `primary`.
    pub fn comments_apply_at(mut self, primary: impl Spanned) -> Self {
        if let Some(details) = self.details() {
            details.comments_apply_at = Some(primary.span());
        }
        self
    }

    fn details(&mut self) -> Option<&mut Details> {
        let diagnostic = self.diagnostic.as_mut()?;
        Some(&mut **diagnostic.details.get_or_insert_default())
    }

    /// For a port of a rule of oxlint: what oxlint says at the place of the report. Like [`Report::label`], [`Report::help`]
    /// and [`Report::note`] it is shown by the formats that oxlint has, and by those that show the code.
    pub fn first_label(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if let Some(details) = self.details() {
            details.first_label = text.into();
        }
        self
    }

    /// One more place that oxlint marks, and what it says there.
    pub fn label(mut self, at: impl Spanned, text: impl Into<Cow<'static, str>>) -> Self {
        if let Some(details) = self.details() {
            details.labels.push((at.span(), text.into()));
        }
        self
    }

    /// The labels of oxlint where a place has to be looked for or a text has to be made, and in a rule that ESLint has as well:
    /// `labels` is called at once, and only with a configuration of oxlint and a format that shows labels.
    pub fn labels_with(mut self, labels: impl FnOnce(&mut Details)) -> Self {
        if self.file.language().is_oxlint
            && self.file.sink.wants_help.get()
            && let Some(details) = self.details()
        {
            labels(details);
        }
        self
    }

    /// oxlint's `help`: what to do about it.
    pub fn help(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if self.file.sink.wants_help.get()
            && let Some(details) = self.details()
        {
            details.help = text.into();
        }
        self
    }

    /// The same for a text that has to be made. `text` is called at once, and only if the help is read.
    pub fn help_with(self, text: impl FnOnce() -> String) -> Self {
        match self.file.sink.wants_help.get() && self.diagnostic.is_some() {
            true => self.help(text()),
            false => self,
        }
    }

    /// oxlint's `note`
    pub fn note(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if let Some(details) = self.details() {
            details.note = text.into();
        }
        self
    }

    /// How to fix it, as ESLint's `fix`. `fix` returns a [`Fix`], an `Option` of one, or several
    /// in an array or a `Vec`, which must not overlap and are applied together.
    ///
    /// It is called only if the fix is going to be applied or shown, or if oxlint makes its help of it.
    pub fn fix<F: IntoFix>(mut self, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        if self.reads_fixes() {
            let fix = fix(Fixer::new(self.file));
            self.take_help_of(fix.first_fix());
            if self.file.sink.wants_fixes.get()
                && let Some(diagnostic) = &mut self.diagnostic
            {
                diagnostic.fix = fix.into_fix(self.file);
            }
        }
        self
    }

    fn reads_fixes(&self) -> bool {
        self.diagnostic.as_ref().is_some_and(|it| {
            let help = it.constant_help.map(Help::found);
            let makes_help = matches!(help, Some(oxlint_help::Found::OfTheFix { .. }));
            makes_help || self.file.sink.wants_fixes.get()
        })
    }

    /// `LintContext::finish_create_fix` of oxlint: a diagnostic without a help takes what `RuleFixer` says about the fix: `first`.
    #[inline(never)]
    fn take_help_of(&mut self, first: Option<&Fix>) {
        let help = self.diagnostic.as_ref().and_then(|it| it.constant_help);
        let Some(oxlint_help::Found::OfTheFix { removes }) = help.map(Help::found) else {
            return;
        };
        let Some(fix) = first else {
            return;
        };
        // `possibly_truncate_snippet`
        let shown = |text: &[u8]| -> Vec<u8> {
            if text.len() <= 256 {
                return text.to_vec();
            }
            let mut characters = text.iter().enumerate().filter(|it| (*it.1 as i8) >= -0x40);
            let end = characters.nth(256).map_or(text.len(), |it| it.0);
            [text.get(..end).unwrap_or(text), b"..."].concat()
        };
        let (before, after) = (shown(self.file.slice(fix.span)), shown(&fix.text));
        let help = match (fix.span.is_empty(), fix.text.is_empty()) {
            (true, _) => [b"Insert `", &after[..], b"`"].concat(),
            (false, true) if removes => [b"Remove `", &before[..], b"`."].concat(),
            (false, true) => b"Delete this code.".to_vec(),
            (false, false) => [b"Replace `", &before[..], b"` with `", &after[..], b"`."].concat(),
        };
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.constant_help = None;
        }
        if let (Ok(help), Some(details)) = (std::str::from_utf8(&help), self.details())
            && details.help.is_empty()
        {
            details.help = Cow::Owned(help.to_owned());
        }
    }

    /// A change that an editor can offer, as an element of ESLint's `suggest`.
    pub fn suggest<F: IntoFix>(self, message: Message, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        self.suggest_with(message, &[], fix)
    }

    /// The same for a message with `{{placeholders}}`.
    pub fn suggest_with<F: IntoFix>(
        self,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        self.suggest_as(SuggestionKind::Suggestion, message, data, fix)
    }

    /// oxlint's `diagnostic_with_dangerous_fix`. It is a suggestion that says what the report says.
    pub fn fix_dangerously<F: IntoFix>(self, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        // The text is there when the report is made.
        self.suggest_as(SuggestionKind::DangerousFix, Message::new("", ""), &[], fix)
    }

    /// oxlint's `diagnostic_with_dangerous_suggestion`.
    pub fn suggest_dangerously<F: IntoFix>(
        self,
        message: Message,
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        self.suggest_as(SuggestionKind::DangerousSuggestion, message, &[], fix)
    }

    fn suggest_as<F: IntoFix>(
        mut self,
        kind: SuggestionKind,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        if self.reads_fixes() {
            let fix = fix(Fixer::new(self.file));
            self.take_help_of(fix.first_fix());
            if self.file.sink.wants_fixes.get()
                && let Some(fix) = fix.into_fix(self.file)
            {
                self.push_suggestion(kind, message, data, fix);
            }
        }
        self
    }

    /// What of [`Report::suggest_as`] is the same for all closures.
    #[inline(never)]
    fn push_suggestion(
        &mut self,
        kind: SuggestionKind,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: Fix,
    ) {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.suggestions.push(Suggestion {
                message_id: message.id,
                message: interpolate(message, |name| {
                    data.iter().find(|it| it.0 == name).map(|it| it.1)
                }),
                data: data.iter().map(|it| (it.0, it.1.to_vec())).collect(),
                fix,
                kind,
            });
        }
    }
}

impl Drop for Report<'_> {
    fn drop(&mut self) {
        if let Some(mut diagnostic) = self.diagnostic.take() {
            let data = |name: &str| self.data.iter().find(|it| it.0 == name).map(|it| &*it.1);
            diagnostic.message = interpolate(self.message, data);
            let help = diagnostic.constant_help.map(Help::found);
            // There was no fix.
            if let Some(oxlint_help::Found::OfTheFix { .. }) = help {
                diagnostic.constant_help = None;
            }
            if let Some(oxlint_help::Found::WithData(text)) = help {
                diagnostic.constant_help = None;
                let details = diagnostic.details.get_or_insert_default();
                if details.help.is_empty() {
                    let help = Message {
                        id: "",
                        text,
                        may_have_placeholders: true,
                        key: 0,
                    };
                    let help = interpolate(help, data);
                    let help = std::str::from_utf8(&help).unwrap_or_default();
                    details.help = Cow::Owned(help.to_owned());
                }
            }
            for suggestion in &mut diagnostic.suggestions {
                if suggestion.kind == SuggestionKind::DangerousFix {
                    suggestion.message.clone_from(&diagnostic.message);
                }
            }
            let suggested = diagnostic
                .suggestions
                .iter()
                .map(|it| it.message.len() + it.fix.text.len());
            let size = diagnostic.message.len()
                + diagnostic.details.as_deref().map_or(0, Details::len)
                + diagnostic.fix.as_ref().map_or(0, |it| it.text.len())
                + suggested.sum::<usize>();
            let mut bytes = self.file.sink.bytes.borrow_mut();
            if bytes.len() <= diagnostic.rule as usize {
                bytes.resize(diagnostic.rule as usize + 1, 0);
            }
            bytes[diagnostic.rule as usize] += size as u64;
            self.file.sink.diagnostics.borrow_mut().push(diagnostic);
        }
    }
}

/// ESLint's `interpolate`: replaces each `{{ name }}` by `data(name)`, and leaves it if there is none. A name has no braces in it,
/// so `{{{name}}}` is `{`, the value, `}`.
fn interpolate<'d>(message: Message, data: impl Fn(&str) -> Option<&'d [u8]>) -> Vec<u8> {
    match message.may_have_placeholders {
        true => interpolate_text(message.text, data),
        false => message.text.as_bytes().to_vec(),
    }
}

/// The same for a text that is not known before: where a rule puts a part of its options into its message.
pub fn interpolate_text<'d>(text: &str, data: impl Fn(&str) -> Option<&'d [u8]>) -> Vec<u8> {
    let bytes = text.as_bytes();
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
        let name_len = bun_core::strings::index_of_any(&bytes[name_start..], b"{}")
            .unwrap_or(bytes.len() - name_start);
        let name_end = name_start + name_len;
        let value = match name_len > 0 && bytes[name_end..].starts_with(b"}}") {
            true => data(text[name_start..name_end].trim()),
            false => None,
        };
        match value {
            Some(value) => {
                out.extend_from_slice(&bytes[at..open]);
                bun_core::strings::push_wtf8_well_formed(&mut out, value);
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
