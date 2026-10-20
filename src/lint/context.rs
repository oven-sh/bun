//! The context passed to a rule's listeners along with the node: the file, the rule's state, and the reporting API.

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

/// A rule's finding, modeled on ESLint's `LintMessage`.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    /// The index of the rule among those that run on the file.
    pub rule: u16,
    pub severity: Severity,
    pub message_id: &'static str,
    pub message: Vec<u8>,
    pub span: Span,
    /// The reported node, or the one passed to [`Report::called_with`] or [`Report::listened_on`]. `None` if a token, a
    /// name or a span was reported.
    pub node: Option<Packed>,
    /// True if `node` was set explicitly by [`Report::called_with`] and the like, rather than being what was reported.
    pub has_explicit_node: bool,
    /// True if ESLint was given a position instead of a range, so it reports no `endLine` or `endColumn`.
    pub has_no_end: bool,
    pub when: When,
    pub details: Option<Box<Details>>,
    /// oxlint's extra texts (help, label, note), unless `details` already has them. The ones with placeholders are
    /// filled in and written to `details` once the report is complete.
    pub constant_help: Option<Help>,
    pub fix: Option<Fix>,
    pub suggestions: Vec<Suggestion>,
}

/// Fields that few diagnostics need: what an oxlint diagnostic has besides its message and position (an empty text
/// means it's absent), and positions that override `span`.
#[derive(Clone, Debug, Default)]
pub struct Details {
    /// The start to report instead of `span`'s. See [`Report::start_at`].
    pub start_position: Option<Position>,
    /// The end to report instead of `span`'s. See [`Report::end_at`].
    pub end_position: Option<Position>,
    /// [`Report::comments_apply_at`]
    pub comments_apply_at: Option<Span>,
    /// [`Report::claims`], or [`Report::unless_claimed`]
    pub(crate) claim: Option<Claim>,
    /// [`Report::listened_on`]
    pub listened_on: Option<Span>,
    /// The label at the reported position.
    pub first_label: Cow<'static, str>,
    /// The other labeled spans, each with its text.
    pub labels: Vec<(Span, Cow<'static, str>)>,
    pub help: Cow<'static, str>,
    pub note: Cow<'static, str>,
}

impl Details {
    /// Sets the label at the reported position.
    pub fn first(&mut self, text: impl Into<Cow<'static, str>>) {
        self.first_label = text.into();
    }

    /// Adds another labeled span.
    pub fn push(&mut self, at: impl Spanned, text: impl Into<Cow<'static, str>>) {
        self.labels.push((at.span(), text.into()));
    }
}

#[derive(Clone, Debug)]
pub struct Suggestion {
    pub message_id: &'static str,
    pub message: Vec<u8>,
    /// The values of the message's placeholders, which ESLint includes with a suggestion.
    pub data: Vec<(&'static str, Vec<u8>)>,
    pub fix: Fix,
    pub kind: SuggestionKind,
}

/// Collects the rules' reports for one file.
#[derive(Default)]
pub(crate) struct Sink {
    pub(crate) diagnostics: RefCell<Vec<Diagnostic>>,
    /// True if anything reads `Diagnostic::fix` and `Diagnostic::suggestions`. Otherwise they aren't computed.
    pub(crate) wants_fixes: Cell<bool>,
    /// True if nothing reads [`Fix::text`] because fixable problems are only counted. A fix often contains its node's
    /// text, so the fixes of n nested nodes add up to O(n²) bytes.
    pub(crate) drops_fix_texts: Cell<bool>,
    /// True if anything reads oxlint's help. Otherwise it isn't looked up.
    pub(crate) wants_help: Cell<bool>,
    /// True if nothing reads [`Diagnostic::message`] and [`Suggestion::message`] because problems are only counted.
    /// They're left empty.
    pub(crate) drops_messages: Cell<bool>,
    /// The error a rule threw. If several threw, it's the one earliest in the text, which ESLint reaches first.
    pub(crate) thrown: RefCell<Option<Thrown>>,
    /// [`File::jest_calls_in_oxlint_order`]
    pub(crate) jest_calls_in_oxlint_order: OnceCell<Box<[(Span, u32)]>>,
    /// True if a rule has requested [`File::modules`], so the file may be linted again.
    pub(crate) has_requested_modules: Cell<bool>,
    /// The rules of the [pairs](crate::rule_set::Pairs) active on the file. Each entry is the rule's [`CxBase::rule`],
    /// its pair's number in the file, and whether it's the type-aware rule.
    pub(crate) paired: RefCell<SmallVec<[(u16, u8, bool); 8]>>,
}

/// The node in which a rule of a [pair](crate::rule_set::Pairs) reports a problem, identified by its span. Both ends
/// are needed because nested nodes can share a start or an end: `a.filter(f)[0].filter(f)`,
/// `async () => async () => 1`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Claim {
    start: u32,
    end: u32,
    pair: u8,
    /// True if the report comes from the type-aware rule.
    pub(crate) with_types: bool,
}

impl Claim {
    /// The claim that the type-aware rule's report has for the same node.
    pub(crate) fn with_types(self) -> Claim {
        Claim {
            with_types: true,
            ..self
        }
    }
}

impl Sink {
    /// `rule` is a [`CxBase::rule`]. `None` if it isn't the type-aware rule (or, with `with_types` false, the untyped
    /// rule) of a pair active on the file. That lets code shared by both rules of a pair call both `claims` and
    /// `unless_claimed`.
    fn claim_of(&self, rule: u16, with_types: bool, node: Span) -> Option<Claim> {
        let paired = self.paired.borrow();
        let pair = paired
            .iter()
            .find(|it| it.0 == rule && it.2 == with_types)?
            .1;
        let Span { start, end } = node;
        Some(Claim {
            start,
            end,
            pair,
            with_types,
        })
    }
}

impl File<'_> {
    /// For a rule that oxlint runs on Jest calls, when it reports under an oxlint config. oxlint visits these calls
    /// after the nodes, in its own order. `calls` runs once per file and returns the calls sorted by start, longer ones
    /// first, each with its index in oxlint's order.
    #[inline]
    pub fn jest_calls_in_oxlint_order(&self, calls: impl FnOnce() -> Box<[(Span, u32)]>) {
        self.sink.jest_calls_in_oxlint_order.get_or_init(calls);
    }
}

/// [`Cx::throw`], [`Cx::throw_for_selector`]
pub(crate) struct Thrown {
    /// Same as `Diagnostic::rule`.
    pub(crate) rule: u16,
    /// `None` if it's thrown before ESLint reaches any node, outside the rule's code.
    pub(crate) at: Option<u32>,
    /// `error.name`
    pub(crate) name: &'static str,
    /// `error.message`
    pub(crate) message: Vec<u8>,
}

/// The context of the rule `R` for the file being linted. It dereferences to the [`File`].
pub struct Cx<'a, R: Rule> {
    /// The value [`Rule::register`] returned.
    pub state: R::State<'a>,
    pub(crate) base: CxBase<'a>,
}

/// The part of a [`Cx`] that's the same for all rules, so code that uses it is compiled once instead of once per rule.
pub(crate) struct CxBase<'a> {
    pub(crate) file: &'a File<'a>,
    pub(crate) meta: &'static Meta,
    pub(crate) rule: u16,
    pub(crate) severity: Severity,
    /// [`oxlint_messages::of_rule`], computed on the first report.
    pub(crate) oxlint_rule_messages: OnceCell<[&'static [Message]; 2]>,
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
    /// The returned builder adds to the report, which is submitted when the builder is dropped:
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

    /// Does what `throw new Error(message)` does in a JavaScript rule. It's for a rule that can't do its job, for
    /// example because a file named in its options is missing. `name` is the class of the error, and `at` is the node
    /// whose listener throws.
    ///
    /// The rule's severity doesn't matter. With an oxlint config, the file gets one error that has no rule name and
    /// that no comment can disable. The rest matches what oxlint does when a JavaScript plugin rule throws. Findings
    /// from oxlint's built-in rules are kept. Findings from every other rule for the file are dropped: this rule's, the
    /// JavaScript plugins', and those of the other native rules that oxlint doesn't have, which it could only run as
    /// JavaScript plugin rules. With an ESLint config, or with none, the run ends with exit code 2.
    ///
    /// Only one throw per file counts, so it's fine to call this for every node. The call returns, so `return` after
    /// it.
    #[inline]
    pub fn throw(&self, at: impl Spanned, name: &'static str, message: impl Into<Vec<u8>>) {
        self.base.throw(at.span().start, name, message.into());
    }

    /// The repeat count that JavaScript's `" ".repeat(count)` would use. `None` if it would throw, in which case the
    /// rule throws too (see [`Cx::throw`]). `at` is the node ESLint is visiting. oxlint's built-in rules don't throw.
    /// Use [`Fixer::repeat`] for the text itself.
    pub fn repeat_count(&self, count: f64, at: impl Spanned) -> Option<u64> {
        match self.base.repeat_count(count) {
            Ok(count) => Some(count),
            Err(message) => {
                self.throw(at, "RangeError", message);
                None
            }
        }
    }

    /// Call it when a selector the rule listens for can't be matched. ESLint throws when it reads the selectors, before
    /// it visits any node, which ends the run.
    #[cold]
    pub fn throw_for_selector(&self, error: &crate::selector::Error) {
        *self.base.file.sink.thrown.borrow_mut() = Some(Thrown {
            rule: self.base.rule,
            at: None,
            name: "Error",
            message: error.message().to_vec(),
        });
    }

    /// True if [`Cx::throw_for_selector`] has been called for this file, so none of its findings are reported.
    #[inline]
    pub fn has_thrown_for_selector(&self) -> bool {
        let thrown = self.base.file.sink.thrown.borrow();
        thrown.as_ref().is_some_and(|it| it.at.is_none())
    }

    /// Reports `message` at a position, for when ESLint's `loc` is a `{ line, column }` instead of a range.
    #[inline]
    pub fn report_at(&self, offset: u32, message: Message) -> Report<'a> {
        self.base.report_at(offset, message)
    }

    /// Reports `message` about the file as a whole, with no position, like an oxlint diagnostic without a label.
    /// Formats that need numbers print line 0 and column 0, and there's no code excerpt. With no config it's reported
    /// at the start of the file.
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
        // The `bun:test` rules use oxlint's texts whatever the configuration.
        let has_help =
            language.is_oxlint || self.meta.follows_oxlint || self.meta.plugin == Plugin::BunTest;
        let wants_help = has_help && sink.wants_help.get();
        let wants_text = !sink.drops_messages.get();
        let message = match language.is_oxlint {
            // oxlint's message has the same id.
            true if !wants_text && !wants_help => message,
            true => {
                let oxlint_texts =
                    (self.oxlint_rule_messages).get_or_init(|| oxlint_messages::of_rule(self.meta));
                oxlint_messages::of(oxlint_texts, message)
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
            has_explicit_node: false,
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

    /// `Err` has the `RangeError`'s message.
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
        match self.file.language().is_oxlint && crate::linter::config::is_oxlint_rule(name) {
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

/// A report being built. See [`Cx::report`].
pub struct Report<'a> {
    file: &'a File<'a>,
    message: Message,
    data: Data<'a>,
    /// True if some text is built from `data`.
    reads_data: bool,
    /// True if hints are shown. See [`Report::hint`].
    reads_hints: bool,
    diagnostic: Option<Diagnostic>,
}

impl<'a> Report<'a> {
    /// Sets the value for `{{name}}` in the message.
    #[inline]
    pub fn data(mut self, name: &'static str, value: impl IntoText<'a>) -> Self {
        value.put_into(&mut self, name);
        self
    }

    /// The part of [`Report::data`] that doesn't depend on the value's type.
    #[inline(never)]
    fn push_data(&mut self, name: &'static str, value: Cow<'a, [u8]>) {
        if self.reads_data {
            self.data.push((name, value));
        }
    }

    /// Reports `start` as the start, for the rare rule whose `loc.start` is a line and column that aren't in the text.
    /// Some rules report configuration problems at line 0.
    pub fn start_at(mut self, start: Position) -> Self {
        if let Some(details) = self.details() {
            details.start_position = Some(start);
        }
        self
    }

    /// Reports `end` as the end, for the rare rule whose `loc.end` is a line and column that aren't in the text.
    /// ESLint's column -1 is `u32::MAX`.
    pub fn end_at(mut self, end: Position) -> Self {
        if let Some(details) = self.details() {
            details.end_position = Some(end);
        }
        self
    }

    /// For a type-aware rule that has a [pair](crate::rule_set::Pairs): marks `node` as the node with the problem.
    /// While this report is shown, the untyped rule's report [about `node`](Report::unless_claimed) is hidden. Both
    /// have to pass the same node. See [`LintMessage::hide_claimed`](crate::linter::LintMessage::hide_claimed).
    pub fn claims(self, node: impl Spanned) -> Self {
        self.claim(true, node.span())
    }

    /// For an untyped rule that has a [pair](crate::rule_set::Pairs). See [`Report::claims`].
    pub fn unless_claimed(self, node: impl Spanned) -> Self {
        self.claim(false, node.span())
    }

    fn claim(mut self, with_types: bool, node: Span) -> Self {
        let rule = self.diagnostic.as_ref().map(|it| it.rule);
        let claim = rule.and_then(|rule| self.file.sink.claim_of(rule, with_types, node));
        if claim.is_some()
            && let Some(details) = self.details()
        {
            details.claim = claim;
        }
        self
    }

    /// For a port of an oxlint rule whose diagnostic has several labels. oxlint prints the first label's position,
    /// which is the reported one, but uses the primary label, `primary`, to decide whether a comment disables the rule.
    pub fn comments_apply_at(mut self, primary: impl Spanned) -> Self {
        if let Some(details) = self.details() {
            details.comments_apply_at = Some(primary.span());
        }
        self
    }

    /// The original rule reports this from the listener for `node`, which isn't the reported node but contains it: an
    /// element for its child, a tag for its attribute or a token. Among reports that start at the same position, ESLint
    /// orders it by when that listener is called.
    pub fn listened_on(mut self, node: impl Spanned) -> Self {
        if let Some(details) = self.details() {
            details.listened_on = Some(node.span());
        }
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = node.packed_node();
            diagnostic.has_explicit_node = true;
        }
        self
    }

    /// Records that oxlint is running its rule on `node`, or on something that contains it, when it reports this.
    /// oxlint prints reports in the order it visits the nodes, and reports from one node in the order the rule makes
    /// them. Call this when the reported span isn't inside that node, when a node in between is of a kind that oxlint
    /// also runs the rule on, or when many tokens or names are reported, since otherwise the node has to be searched
    /// for. It has no effect with ESLint.
    #[inline]
    pub fn called_with(mut self, node: impl Into<Node<'a>>) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = Some(node.into().packed());
            diagnostic.has_explicit_node = true;
        }
        self
    }

    /// [`Report::called_with`] for when oxlint runs its rule on exactly what's reported, but that's a name, which isn't
    /// a node here.
    #[inline]
    pub fn called_with_name(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.node = None;
            diagnostic.has_explicit_node = true;
        }
        self
    }

    /// Like [`Meta::reports_on_exit`](crate::rule::Meta::reports_on_exit), for a rule where only some listeners run on
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

    /// Like [`Meta::reports_at_the_end`](crate::rule::Meta::reports_at_the_end), for a rule where only some listeners
    /// run when the program ends.
    pub fn at_the_end(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = When::AtTheEnd;
        }
        self
    }

    /// The original rule listens with a selector that's more specific than a node kind. For a given node, ESLint calls
    /// such a listener after the ones for the bare kind, regardless of rule order.
    pub fn by_selector(mut self) -> Self {
        if let Some(diagnostic) = &mut self.diagnostic {
            diagnostic.when = When::EnteringBySelector;
        }
        self
    }

    /// Among the rule's reports that start at the same position, orders this one shorter first.
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

    /// For a port of an oxlint rule: oxlint's label at the reported position. Like [`Report::label`], [`Report::help`]
    /// and [`Report::note`], it's shown by oxlint's formats and by the formats that show code.
    pub fn first_label(mut self, text: impl Into<Cow<'static, str>>) -> Self {
        if self.file.sink.wants_help.get()
            && let Some(details) = self.details()
        {
            details.first_label = text.into();
        }
        self
    }

    /// Another span that oxlint labels, with its text.
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

    /// oxlint's labels, for when a span has to be searched for or a text has to be built, and for a rule that ESLint
    /// has too. `labels` runs immediately, and only with an oxlint config and a format that shows labels.
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

    /// Like [`Report::help`], for text that has to be built. `text` runs right away, and only if the help is read.
    pub fn help_with(mut self, text: impl FnOnce() -> String) -> Self {
        if self.file.sink.wants_help.get() && self.diagnostic.is_some() {
            self.set_help(Cow::Owned(text()));
        }
        self
    }

    /// Adds Bun's own sentence under an ESLint message that doesn't say what's wrong or what to do. It replaces
    /// [`Report::help`] and is never shown with an oxlint config. The rule must set [`Meta::hints`]. Empty means no
    /// hint.
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

    /// The fix, like ESLint's `fix`. `fix` returns a [`Fix`], an `Option` of one, or several in an array or a `Vec`,
    /// which must not overlap and are applied together.
    ///
    /// It's only called if the fix will be applied or shown, or if oxlint derives its help from it.
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
        let fix = fix.map(|it| self.without_unread_text(it));
        if self.file.sink.wants_fixes.get()
            && let Some(diagnostic) = &mut self.diagnostic
        {
            diagnostic.fix = fix;
        }
    }

    #[inline(never)]
    fn reads_fixes(&self) -> bool {
        self.diagnostic.is_some()
            && (self.file.sink.wants_fixes.get() || self.derives_help_from_fix())
    }

    #[inline]
    fn without_unread_text(&self, mut fix: Fix) -> Fix {
        if self.file.sink.drops_fix_texts.get() {
            fix.text = Vec::new();
        }
        fix
    }

    #[inline]
    fn derives_help_from_fix(&self) -> bool {
        let help = self.diagnostic.as_ref().and_then(|it| it.constant_help);
        help.is_some_and(Help::is_fix_description)
    }

    /// [`IntoFix::into_fix`], plus the help that oxlint derives from the fix.
    #[inline(never)]
    fn merged<F: IntoFix>(&mut self, fix: F) -> Option<Fix> {
        if !self.derives_help_from_fix() {
            return fix.into_fix(self.file);
        }
        self.set_help_from_fix(fix.first_fix(), Edits::First);
        let fix = fix.into_fix(self.file);
        self.set_help_from_fix(fix.as_ref(), Edits::All);
        fix
    }

    /// oxlint's `LintContext::finish_create_fix`: a diagnostic without a help gets `RuleFixer`'s description of the
    /// fix. `of` tells whether `fix` is the first edit or all of them.
    #[inline(never)]
    fn set_help_from_fix(&mut self, fix: Option<&Fix>, of: Edits) {
        let help = self.diagnostic.as_ref().and_then(|it| it.constant_help);
        let Some(Found::FixDescription { removes, edits }) = help.map(|it| it.found(Part::Help))
        else {
            return;
        };
        let Some(fix) = fix.filter(|_| edits == of) else {
            return;
        };
        // `possibly_truncate_snippet`
        let truncated = |text: &[u8]| -> Vec<u8> {
            if text.len() <= 256 {
                return text.to_vec();
            }
            let mut characters = text.iter().enumerate().filter(|it| (*it.1 as i8) >= -0x40);
            let end = characters.nth(256).map_or(text.len(), |it| it.0);
            [text.get(..end).unwrap_or(text), b"..."].concat()
        };
        let (before, after) = (truncated(self.file.slice(fix.span)), truncated(&fix.text));
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

    /// A change an editor can offer, like an element of ESLint's `suggest`.
    pub fn suggest<F: IntoFix>(self, message: Message, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        self.suggest_with(message, &[], fix)
    }

    /// Like [`Report::suggest`], for a message with `{{placeholders}}`.
    pub fn suggest_with<F: IntoFix>(
        self,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        self.suggest_as(SuggestionKind::Suggestion, message, data, fix)
    }

    /// A suggestion that changes the program's behavior or whether it type checks. ESLint and editors treat it as an
    /// ordinary suggestion. With no config file, `--fix-suggestions` skips it, because that flag applies everything in
    /// one go without review, and only `--fix-dangerously` applies it.
    pub fn suggest_behavior_change<F: IntoFix>(
        self,
        message: Message,
        data: &[(&'static str, &[u8])],
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        let kind = match self.file.language().has_no_foreign_config {
            true => SuggestionKind::DangerousSuggestion,
            false => SuggestionKind::Suggestion,
        };
        self.suggest_as(kind, message, data, fix)
    }

    /// oxlint's `diagnostic_with_dangerous_fix`. It's a suggestion with the same message as the report.
    pub fn fix_dangerously<F: IntoFix>(self, fix: impl FnOnce(Fixer<'a>) -> F) -> Self {
        // The message is copied in when the report is submitted.
        self.suggest_as(SuggestionKind::DangerousFix, Message::new("", ""), &[], fix)
    }

    /// Attaches a fix that's only correct for some code: [`Report::fix`] if `is_safe` returns true, otherwise
    /// [`Report::fix_dangerously`]. `--fix` must not change a program's behavior or break type checking, whatever the
    /// original tool's `--fix` does. `is_safe` is only called if the fix is read, so it can afford to look at scopes.
    pub fn fix_where_safe<F: IntoFix>(
        self,
        is_safe: impl FnOnce() -> bool,
        fix: impl FnOnce(Fixer<'a>) -> F,
    ) -> Self {
        if !self.reads_fixes() {
            return self;
        }
        match is_safe() {
            true => self.fix(fix),
            false => self.fix_dangerously(fix),
        }
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

    /// The part of [`Report::suggest_as`] that doesn't depend on the closure.
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
        let fix = self.without_unread_text(fix);
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
            for (part, slot) in parts {
                if let (Found::WithData(text), true) = (texts.found(part), slot.is_empty()) {
                    let text = interpolate_text(text, data);
                    let text = std::str::from_utf8(&text).unwrap_or_default();
                    *slot = Cow::Owned(text.to_owned());
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

/// ESLint's `interpolate`: replaces each `{{ name }}` with `data(name)`, or leaves it alone if that's `None`. A name
/// can't contain braces, so `{{{name}}}` becomes `{`, the value, `}`.
fn interpolate<'d>(message: Message, data: impl Fn(&str) -> Option<&'d [u8]>) -> Vec<u8> {
    match message.may_have_placeholders {
        true => interpolate_text(message.text, data),
        false => message.text.as_bytes().to_vec(),
    }
}

/// Like `interpolate`, for text that isn't known at compile time, as when a rule puts part of its options into its
/// message.
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

/// A value that can be inserted into a message or a fix.
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
