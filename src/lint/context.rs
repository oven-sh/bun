//! What a listener of a rule is given besides the node: the file, the state of the rule, and the
//! means to report.

use crate::ast::{File, Ident, Name, Node, Packed};
use crate::fix::{Fix, Fixer, IntoFix, SuggestionKind};
use crate::oxlint_help::{self, Edits, Found, Help, Part};
use crate::oxlint_messages;
use crate::rule::{Message, Meta, Plugin, Rule, When};
use crate::span::{Position, Span, Spanned};
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::{Cell, OnceCell, RefCell};

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
    /// The node that was reported, or the one that [`Report::called_with`] or [`Report::listened_on`] was given. `None`: it was a
    /// token, a name or a span.
    pub node: Option<Packed>,
    /// `node` is not what was reported.
    pub states_node: bool,
    /// ESLint was given a position, not a range: it reports no `endLine` and `endColumn`.
    pub has_no_end: bool,
    pub when: When,
    pub details: Option<Box<Details>>,
    /// What oxlint says besides the message, where `details` does not say it. What of it has values is in `details` once the report
    /// is complete.
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
    /// [`Report::listened_on`]
    pub listened_on: Option<Span>,
    /// What is said at the place of the report.
    pub first_label: Cow<'static, str>,
    /// The other places that are marked, and what is said at each.
    pub labels: Vec<(Span, Cow<'static, str>)>,
    pub help: Cow<'static, str>,
    pub note: Cow<'static, str>,
}

impl Details {
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
    /// Nothing reads [`Fix::text`]: what can be fixed is only counted. A fix often has the text of its node, so those of n nodes
    /// that are in each other have n² bytes.
    pub(crate) drops_texts_of_fixes: Cell<bool>,
    /// Whether anything reads the help of oxlint. If not, it is not looked up.
    pub(crate) wants_help: Cell<bool>,
    /// Nothing reads [`Diagnostic::message`] and [`Suggestion::message`]: what is found is only counted. They are empty.
    pub(crate) drops_messages: Cell<bool>,
    /// What a rule has thrown: of all the first in the text, which ESLint comes to first.
    pub(crate) thrown: RefCell<Option<Thrown>>,
    /// [`File::calls_in_turns`]
    pub(crate) calls_in_turns: OnceCell<Box<[(Span, u32)]>>,
    /// A rule has asked for [`File::modules`]: the file may be linted again.
    pub(crate) asks_about_modules: Cell<bool>,
}

impl File<'_> {
    /// For a rule that oxlint calls with the calls of Jest, when it reports under a configuration of oxlint. oxlint goes through
    /// these calls after the nodes, in an order of its own. `calls` is asked once per file: the calls by where they start, the
    /// longer first, each with the how manyth it is for oxlint.
    #[inline]
    pub fn calls_in_turns(&self, calls: impl FnOnce() -> Box<[(Span, u32)]>) {
        self.sink.calls_in_turns.get_or_init(calls);
    }
}

/// [`Cx::throw`], [`Cx::throw_for_selector`]
pub(crate) struct Thrown {
    /// As `Diagnostic::rule`.
    pub(crate) rule: u16,
    /// `None`: before ESLint comes to a node, and not in the rule.
    pub(crate) at: Option<u32>,
    /// `error.name`
    pub(crate) name: &'static str,
    /// `error.message`
    pub(crate) message: Vec<u8>,
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
    /// [`oxlint_messages::of_rule`], from the first report on.
    pub(crate) said_by_oxlint: OnceCell<[&'static [Message]; 2]>,
}

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
    #[inline]
    pub fn report(&self, at: impl Spanned, message: Message) -> Report<'a> {
        self.base.report(at.span(), at.packed_node(), message)
    }

    /// Does what `throw new Error(message)` does in a JavaScript rule. It's for a rule that can't do its job, for example because
    /// a file named in its options is missing. `name` is the class of the error, and `at` is the node whose listener throws.
    ///
    /// The severity of the rule doesn't matter. With an oxlint config, the file gets one error that has no rule name and that no
    /// comment disables. The rest is what oxlint does when a rule of a JavaScript plugin throws. The findings of the rules that
    /// oxlint has itself stay. Those of every other rule for the file go: this rule's, the JavaScript plugins', and those of the
    /// other native rules that oxlint doesn't have, which it could only run as rules of a JavaScript plugin. With an ESLint
    /// config, or with none, the run ends with exit code 2.
    ///
    /// Only one throw per file counts, so it's fine to call this for every node. The call returns, so `return` after it.
    #[inline]
    pub fn throw(&self, at: impl Spanned, name: &'static str, message: impl Into<Vec<u8>>) {
        self.base.throw(at.span().start, name, message.into());
    }

    /// How often `" ".repeat(count)` of JavaScript repeats. `None`: it throws, and so does the rule: see [`Cx::throw`]. `at`: the
    /// node that ESLint is at. The rules that oxlint has itself do not throw. The text itself: [`Fixer::repeat`].
    pub fn repeat_count(&self, count: f64, at: impl Spanned) -> Option<u64> {
        match self.base.repeat_count(count) {
            Ok(count) => Some(count),
            Err(message) => {
                self.throw(at, "RangeError", message);
                None
            }
        }
    }

    /// A selector that the rule listens for cannot be matched. ESLint throws when it reads the selectors, before it comes to
    /// a node: that ends the run.
    #[cold]
    pub fn throw_for_selector(&self, error: &crate::selector::Error) {
        *self.base.file.sink.thrown.borrow_mut() = Some(Thrown {
            rule: self.base.rule,
            at: None,
            name: "Error",
            message: error.message().to_vec(),
        });
    }

    /// [`Cx::throw_for_selector`] has been called for this file: nothing that is found in it is reported.
    #[inline]
    pub fn has_thrown_for_selector(&self) -> bool {
        let thrown = self.base.file.sink.thrown.borrow();
        thrown.as_ref().is_some_and(|it| it.at.is_none())
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
    fn report(&self, span: Span, node: Option<Packed>, message: Message) -> Report<'a> {
        let (language, sink) = (self.file.language(), &self.file.sink);
        // The rules of `bun:test` say what those of oxlint say, whatever the configuration.
        let has_help =
            language.is_oxlint || self.meta.follows_oxlint || self.meta.plugin == Plugin::BunTest;
        let wants_help = has_help && sink.wants_help.get();
        let wants_text = !sink.drops_messages.get();
        let message = match language.is_oxlint {
            // What oxlint says has the same id.
            true if !wants_text && !wants_help => message,
            true => {
                let said =
                    (self.said_by_oxlint).get_or_init(|| oxlint_messages::of_rule(self.meta));
                oxlint_messages::of(said, message)
            }
            false if language.eslint_8.is_some() => {
                crate::linter::config::eslint8::message_of(self.meta, message)
            }
            false => message,
        };
        let help = match wants_help {
            true => oxlint_help::of(self.meta, message),
            false => None,
        };
        let diagnostic = Diagnostic {
            rule: self.rule,
            severity: self.severity,
            message_id: message.id,
            message: Vec::new(),
            span,
            node,
            states_node: false,
            has_no_end: false,
            when: self.meta.reports,
            details: None,
            constant_help: help,
            fix: None,
            suggestions: Vec::new(),
        };
        Report {
            file: self.file,
            message,
            data: SmallVec::new(),
            reads_data: wants_text && message.may_have_placeholders || help.is_some(),
            reads_hints: self.meta.has_hints && !language.is_oxlint && sink.wants_help.get(),
            diagnostic: Some(diagnostic),
        }
    }

    /// `Err`: the message of the `RangeError`.
    fn repeat_count(&self, count: f64) -> Result<u64, Vec<u8>> {
        // `ToIntegerOrInfinity`
        let whole = if count.is_nan() { 0.0 } else { count.trunc() };
        let message = match whole {
            _ if whole < 0.0 || whole.is_infinite() => {
                let count = crate::utils::text::number_to_string(count);
                [&b"Invalid count value: "[..], &count].concat()
            }
            _ if whole > crate::fix::MAX_STRING_LENGTH as f64 => b"Invalid string length".to_vec(),
            _ => return Ok(whole as u64),
        };
        let name = self.meta.name.as_bytes();
        match self.file.language().is_oxlint && crate::linter::config::is_rule_of_oxlint(name) {
            true => Ok(whole.max(0.0) as u64),
            false => Err(message),
        }
    }

    #[cold]
    #[inline(never)]
    fn throw(&self, at: u32, name: &'static str, message: Vec<u8>) {
        let (rule, at) = (self.rule, Some(at));
        let mut thrown = self.file.sink.thrown.borrow_mut();
        // Listeners are called in no particular order here. ESLint gets to the first node in the text first.
        if thrown.as_ref().is_none_or(|it| at < it.at) {
            *thrown = Some(Thrown {
                rule,
                at,
                name,
                message,
            });
        }
    }

    #[cold]
    #[inline(never)]
    fn report_at(&self, offset: u32, message: Message) -> Report<'a> {
        let mut report = self.report(Span::empty(offset), None, message);
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
    /// A text is made of `data`.
    reads_data: bool,
    /// Whether hints are shown. See [`Report::hint`].
    reads_hints: bool,
    diagnostic: Option<Diagnostic>,
}

impl<'a> Report<'a> {
    /// What `{{name}}` in the message stands for.
    #[inline]
    pub fn data(mut self, name: &'static str, value: impl IntoText<'a>) -> Self {
        value.put_into(&mut self, name);
        self
    }

    /// What of [`Report::data`] is the same for all values.
    #[inline(never)]
    fn push_data(&mut self, name: &'static str, value: Cow<'a, [u8]>) {
        if self.reads_data {
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

    /// The original reports this from the listener of `node`, which is not what is reported but is around it: an element for
    /// its child, a tag for its attribute or a token. ESLint has it where that listener is called among what starts at one place.
    pub fn listened_on(mut self, node: impl Spanned) -> Self {
        if let Some(details) = self.details() {
            details.listened_on = Some(node.span());
        }
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = node.packed_node();
            diagnostic.states_node = true;
        }
        self
    }

    /// oxlint calls its rule with `node`, or with something around it, when it reports this. It prints what it reports in the order
    /// in which it comes to the nodes, and what it reports about one node in the order in which the rule reports. To be said where
    /// what is reported is not in that node, where a node in between is of a kind that oxlint also calls the rule with, and
    /// where many tokens or names are reported, for which the node is searched otherwise. It means nothing to ESLint.
    #[inline]
    pub fn called_with(mut self, node: impl Into<Node<'a>>) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = Some(node.into().packed());
            diagnostic.states_node = true;
        }
        self
    }

    /// [`Report::called_with`] where oxlint calls its rule with just what is reported, which is no node here: a name.
    #[inline]
    pub fn called_with_the_name(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = None;
            diagnostic.states_node = true;
        }
        self
    }

    /// [`Meta::reports_on_exit`](crate::rule::Meta::reports_on_exit), for a rule of which only some listeners are called on
    /// leaving a node.
    pub fn on_exit(mut self, is_on_exit: bool) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = match is_on_exit {
                true => When::Leaving,
                false => When::Entering,
            };
        }
        self
    }

    /// [`Meta::reports_at_the_end`](crate::rule::Meta::reports_at_the_end), for a rule of which only some listeners are called
    /// when the program ends.
    pub fn at_the_end(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = When::AtTheEnd;
        }
        self
    }

    /// The original listens with a selector that says more than a kind of node. On one node ESLint calls such a listener after
    /// those for the kind alone, wherever their rules stand.
    pub fn by_selector(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = When::EnteringBySelector;
        }
        self
    }

    /// Of what the rule reports at one start, this comes with the shorter first.
    pub fn shorter_first(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = When::EnteringShorterFirst;
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
        if self.file.sink.wants_help.get()
            && let Some(details) = self.details()
        {
            details.first_label = text.into();
        }
        self
    }

    /// One more place that oxlint marks, and what it says there.
    pub fn label(mut self, at: impl Spanned, text: impl Into<Cow<'static, str>>) -> Self {
        if self.file.sink.wants_help.get() {
            self.push_label(at.span(), text.into());
        }
        self
    }

    #[inline(never)]
    fn push_label(&mut self, at: Span, text: Cow<'static, str>) {
        if let Some(details) = self.details() {
            details.labels.push((at, text));
        }
    }

    /// The labels of oxlint where a place has to be looked for or a text has to be made, and in a rule that ESLint has as well:
    /// `labels` is called at once, and only with a configuration of oxlint and a format that shows labels.
    pub fn labels_with(mut self, labels: impl FnOnce(&mut Details)) -> Self {
        if let Some(details) = self.details_for_labels() {
            labels(details);
        }
        self
    }

    /// `None` unless [`Report::labels_with`] should run its closure. These builders are compiled once per closure, so
    /// whatever doesn't depend on the closure is kept out of line.
    #[inline(never)]
    fn details_for_labels(&mut self) -> Option<&mut Details> {
        match self.file.language().is_oxlint && self.file.sink.wants_help.get() {
            true => self.details(),
            false => None,
        }
    }

    /// oxlint's `help`: what to do about it.
    pub fn help(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if self.file.sink.wants_help.get() {
            self.set_help(text.into());
        }
        self
    }

    #[inline(never)]
    fn set_help(&mut self, text: Cow<'static, str>) {
        if let Some(details) = self.details() {
            details.help = text;
        }
    }

    /// The same for a text that has to be made. `text` is called at once, and only if the help is read.
    pub fn help_with(mut self, text: impl FnOnce() -> String) -> Self {
        if self.file.sink.wants_help.get() && self.diagnostic.is_some() {
            self.set_help(Cow::Owned(text()));
        }
        self
    }

    /// Adds Bun's own sentence under an ESLint message that doesn't say what's wrong or what to do. It replaces
    /// [`Report::help`] and is never shown with an oxlint config. The rule must set [`Meta::hints`]. Empty means no hint.
    pub fn hint(mut self, text: &'static str) -> Self {
        if self.reads_hints && !text.is_empty() {
            self.set_help(Cow::Borrowed(text));
        }
        self
    }

    /// Like [`Report::hint`], for text that has to be built. `text` runs right away, and only if hints are shown.
    pub fn hint_with(mut self, text: impl FnOnce() -> Option<String>) -> Self {
        if self.reads_hints
            && let Some(text) = text()
        {
            self.set_help(Cow::Owned(text));
        }
        self
    }

    /// oxlint's `note`
    pub fn note(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if self.file.sink.wants_help.get()
            && let Some(details) = self.details()
        {
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
            let fix = self.merged(fix);
            self.set_fix(fix);
        }
        self
    }

    #[inline(never)]
    fn set_fix(&mut self, fix: Option<Fix>) {
        let fix = fix.map(|it| self.as_it_is_read(it));
        if self.file.sink.wants_fixes.get()
            && let Some(diagnostic) = &mut self.diagnostic
        {
            diagnostic.fix = fix;
        }
    }

    #[inline(never)]
    fn reads_fixes(&self) -> bool {
        self.diagnostic.is_some() && (self.file.sink.wants_fixes.get() || self.makes_help_of_fix())
    }

    #[inline]
    fn as_it_is_read(&self, mut fix: Fix) -> Fix {
        if self.file.sink.drops_texts_of_fixes.get() {
            fix.text = Vec::new();
        }
        fix
    }

    #[inline]
    fn makes_help_of_fix(&self) -> bool {
        let help = self.diagnostic.as_ref().and_then(|it| it.constant_help);
        help.is_some_and(Help::is_of_the_fix)
    }

    /// [`IntoFix::into_fix`], and the help that oxlint makes of the fix.
    #[inline(never)]
    fn merged<F: IntoFix>(&mut self, fix: F) -> Option<Fix> {
        if !self.makes_help_of_fix() {
            return fix.into_fix(self.file);
        }
        self.take_help_of(fix.first_fix(), Edits::First);
        let fix = fix.into_fix(self.file);
        self.take_help_of(fix.as_ref(), Edits::All);
        fix
    }

    /// `LintContext::finish_create_fix` of oxlint: a diagnostic without a help takes what `RuleFixer` says about the fix. `fix` does
    /// what `of` of its edits do.
    #[inline(never)]
    fn take_help_of(&mut self, fix: Option<&Fix>, of: Edits) {
        let help = self.diagnostic.as_ref().and_then(|it| it.constant_help);
        let Some(Found::OfTheFix { removes, edits }) = help.map(|it| it.found(Part::Help)) else {
            return;
        };
        let Some(fix) = fix.filter(|_| edits == of) else {
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

    /// A suggestion that changes what the program does, or whether it type checks. It's an ordinary suggestion to ESLint and to an
    /// editor. With no config file `--fix-suggestions` leaves it alone, because it applies everything at once with nobody looking,
    /// and only `--fix-dangerously` makes it.
    pub fn suggest_change_of_behavior<F: IntoFix>(
        self,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        let kind = match self.file.language().stands_alone {
            true => SuggestionKind::DangerousSuggestion,
            false => SuggestionKind::Suggestion,
        };
        self.suggest_as(kind, message, data, fix)
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
            let fix = self.merged(fix);
            self.push_suggestion(kind, message, data, fix);
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
        fix: Option<Fix>,
    ) {
        let Some(fix) = fix.filter(|_| self.file.sink.wants_fixes.get()) else {
            return;
        };
        let fix = self.as_it_is_read(fix);
        let wants_text = !self.file.sink.drops_messages.get();
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.suggestions.push(Suggestion {
                message_id: message.id,
                message: match wants_text {
                    true => interpolate(message, |name| {
                        data.iter().find(|it| it.0 == name).map(|it| it.1)
                    }),
                    false => Vec::new(),
                },
                data: data.iter().map(|it| (it.0, it.1.to_vec())).collect(),
                fix,
                kind,
            });
        }
    }
}

impl Drop for Report<'_> {
    fn drop(&mut self) {
        let Some(diagnostic) = &mut self.diagnostic else {
            return;
        };
        let data = |name: &str| self.data.iter().find(|it| it.0 == name).map(|it| &*it.1);
        if !self.file.sink.drops_messages.get() {
            diagnostic.message = interpolate(self.message, data);
        }
        if let Some(texts) = diagnostic.constant_help.filter(|it| it.has_values()) {
            let details = &mut **diagnostic.details.get_or_insert_default();
            let parts = [
                (Part::Help, &mut details.help),
                (Part::FirstLabel, &mut details.first_label),
                (Part::Note, &mut details.note),
            ];
            for (part, said) in parts {
                if let (Found::WithData(text), true) = (texts.found(part), said.is_empty()) {
                    let text = interpolate_text(text, data);
                    let text = std::str::from_utf8(&text).unwrap_or_default();
                    *said = Cow::Owned(text.to_owned());
                }
            }
        }
        for suggestion in &mut diagnostic.suggestions {
            if suggestion.kind == SuggestionKind::DangerousFix {
                suggestion.message.clone_from(&diagnostic.message);
            }
        }
        let mut diagnostics = self.file.sink.diagnostics.borrow_mut();
        diagnostics.extend(self.diagnostic.take());
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
            true => data(match &bytes[name_start..name_end] {
                [first, .., last] if first.is_ascii_graphic() && last.is_ascii_graphic() => {
                    &text[name_start..name_end]
                }
                _ => text[name_start..name_end].trim(),
            }),
            false => None,
        };
        match value {
            Some(value) => {
                out.extend_from_slice(&bytes[at..open]);
                match value.is_ascii() {
                    true => out.extend_from_slice(value),
                    false => bun_core::strings::push_wtf8_well_formed(&mut out, value),
                }
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
pub trait IntoText<'a>: Sized {
    fn into_text(self) -> Cow<'a, [u8]>;

    /// [`Report::data`]
    #[inline]
    fn put_into(self, report: &mut Report<'a>, name: &'static str) {
        report.push_data(name, self.into_text());
    }
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

            fn put_into(self, report: &mut Report<'a>, name: &'static str) {
                if report.reads_data {
                    report.push_data(name, self.into_text());
                }
            }
        })*
    };
}
numbers_into_text!(u8 u16 u32 u64 usize i32 i64 isize char);
