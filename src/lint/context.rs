//! What a rule handler is given: the text, the names, the reports, and the services that read the text again.

use std::borrow::Cow;

use bun_ast::{E, Expr, Loc, Log, Ref, Source};
use bun_core::StackCheck;
use bun_js_parser::parse::parse_entry::ParsedOnly;

use crate::FileId;
use crate::diagnostic::{Category, Code, Diagnostic};
use crate::rule::Rule;
use crate::tokens::{self, Tokens};

/// The global names that a report can depend on.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Globals(u8);

impl Globals {
    pub(crate) const NONE: Globals = Globals(0);
    pub(crate) const NAN: Globals = Globals(1);
    pub(crate) const NUMBER: Globals = Globals(2);
    pub(crate) const UNDEFINED: Globals = Globals(4);

    pub(crate) const fn or(self, other: Globals) -> Globals {
        Globals(self.0 | other.0)
    }

    pub(crate) const fn is_none(self) -> bool {
        self.0 == 0
    }

    fn named(name: &[u8]) -> Globals {
        match name {
            b"NaN" => Globals::NAN,
            b"Number" => Globals::NUMBER,
            b"undefined" => Globals::UNDEFINED,
            _ => Globals::NONE,
        }
    }
}

pub(crate) struct Context<'p, 'a> {
    /// The file of every diagnostic that is reported here.
    file: FileId,
    parsed: &'p ParsedOnly<'p, 'a>,
    source: &'a Source,
    arena: &'a bun_alloc::Arena,
    pub(crate) stack_check: StackCheck,
    reports: Vec<Diagnostic>,
    /// Reports that hold only when one of their names is not declared in the file.
    held: Vec<(Diagnostic, Globals)>,
    declared: Globals,
    cut: bool,
}

impl<'p, 'a> Context<'p, 'a> {
    pub(crate) fn new(
        file: FileId,
        parsed: &'p ParsedOnly<'p, 'a>,
        source: &'a Source,
        arena: &'a bun_alloc::Arena,
    ) -> Self {
        Context {
            file,
            parsed,
            source,
            arena,
            stack_check: StackCheck::init(),
            reports: Vec::new(),
            held: Vec::new(),
            declared: Globals::NONE,
            cut: false,
        }
    }

    #[inline]
    pub(crate) fn text(&self) -> &'a [u8] {
        &self.source.contents
    }

    /// The spelling of an identifier or of a binding. Empty for a reference that names nothing.
    pub(crate) fn name_of(&self, r#ref: Ref) -> &'a [u8] {
        if r#ref.is_valid() {
            self.parsed.name_of(r#ref)
        } else {
            b""
        }
    }

    /// A declaration of `ref` is somewhere in the file.
    pub(crate) fn declare(&mut self, r#ref: Ref) {
        self.declared = self.declared.or(Globals::named(self.name_of(r#ref)));
    }

    /// A diagnostic of `rule` at the token that starts at `at`. Its length is that token.
    pub(crate) fn report(
        &mut self,
        rule: &'static Rule,
        at: Loc,
        text: impl Into<Cow<'static, [u8]>>,
    ) {
        self.report_if_global(rule, at, text, Globals::NONE);
    }

    /// Held until the walk ends; dropped when the file declares every name of `names`.
    pub(crate) fn report_if_global(
        &mut self,
        rule: &'static Rule,
        at: Loc,
        text: impl Into<Cow<'static, [u8]>>,
        names: Globals,
    ) {
        let (Some(category), Ok(start)) = (rule.default_level(), u32::try_from(at.start)) else {
            return;
        };
        let diagnostic = Diagnostic {
            file: Some(self.file),
            start,
            length: self.token_len(start),
            category,
            code: Code::Name(rule.name),
            text: text.into(),
            chain: Vec::new(),
            related: Vec::new(),
        };
        if names.is_none() {
            self.reports.push(diagnostic);
        } else {
            self.held.push((diagnostic, names));
        }
    }

    /// The walk stops going deeper at `loc`. Said once.
    pub(crate) fn too_deep(&mut self, loc: Loc) {
        if !core::mem::replace(&mut self.cut, true) {
            self.reports.push(Diagnostic {
                file: Some(self.file),
                start: u32::try_from(loc.start).unwrap_or(0),
                length: 0,
                category: Category::Error,
                code: Code::INTERNAL_ERROR,
                text: Cow::Borrowed(b"This file is nested too deeply to check all of it."),
                chain: Vec::new(),
                related: Vec::new(),
            });
        }
    }

    /// Every report of the file, in the order of the walk, then the held ones that hold.
    pub(crate) fn finish(mut self) -> Vec<Diagnostic> {
        // A walk that was cut has not seen every declaration: what depends on one is not said.
        if !self.cut {
            let declared = self.declared;
            for (diagnostic, names) in self.held {
                if names.0 & !declared.0 != 0 {
                    self.reports.push(diagnostic);
                }
            }
        }
        self.reports
    }

    /// How many `)` between `from` and the token at `to` close a `(` that stands before `from`. `None`: not known.
    pub(crate) fn closes(&self, from: Loc, to: Loc, under: &[&Expr]) -> Option<u32> {
        let (from, to) = (
            u32::try_from(from.start).ok()?,
            u32::try_from(to.start).ok()?,
        );
        let spans = tokens::spans_under(self.text(), under, self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        tokens::closes_between(&mut tokens, to)
    }

    /// Where the binary expression `node` starts whose first own token is at `own`: at the `(` of a left operand in them.
    pub(crate) fn binary_start(&self, node: &E::Binary, own: Loc) -> Loc {
        let Ok(at) = u32::try_from(own.start) else {
            return own;
        };
        // No `(` stands right before the first token: no scan would move the start.
        if tokens::before_opens(self.text(), at, 1).1 == 1 {
            return own;
        }
        // The scan ends where the right operand starts: only the left one has spans it can meet.
        self.start_of(own, node.right.loc, &[&node.left])
            .map_or(own, |(start, _)| start)
    }

    /// Where the node starts whose first own token is at `own`: at the `(` of its first operand, which ends before `to`.
    pub(crate) fn start_of(&self, own: Loc, to: Loc, under: &[&Expr]) -> Option<(Loc, u32)> {
        let closes = self.closes(own, to, under)?;
        let (start, missing) =
            tokens::before_opens(self.text(), u32::try_from(own.start).ok()?, closes);
        Some((
            Loc {
                start: i32::try_from(start).ok()?,
            },
            missing,
        ))
    }

    /// What ESLint compares of the test of a `case`. `None`: its text does not read.
    pub(crate) fn case_test(&self, value: &Expr) -> Option<Vec<u8>> {
        let from = u32::try_from(value.loc.start).ok()?;
        let spans = tokens::spans_under(self.text(), &[value], self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        tokens::case_key(&mut tokens, self.text())
    }

    /// Where the clause with the test `value` starts: the `case` that the text before the test shows, else the test.
    pub(crate) fn case_start(&self, value: &Expr) -> Loc {
        u32::try_from(value.loc.start)
            .ok()
            .and_then(|own| tokens::case_before(self.text(), own))
            .and_then(|start| i32::try_from(start).ok())
            .map_or(value.loc, |start| Loc { start })
    }

    /// The `]` after the index expression of a member.
    pub(crate) fn close_bracket(&self, index: &Expr) -> Option<u32> {
        let from = u32::try_from(index.loc.start).ok()?;
        let spans = tokens::spans_under(self.text(), &[index], self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        tokens::close_bracket(&mut tokens)
    }

    /// After the token that starts at `at`. `None` when the text there does not read.
    pub(crate) fn token_end(&self, at: Loc) -> Option<u32> {
        let at = u32::try_from(at.start).ok()?;
        match self.token_len(at) {
            0 => None,
            len => at.checked_add(len),
        }
    }

    /// The length of the token that starts at `at`, read without the tree. 0 when the text there does not read.
    fn token_len(&self, at: u32) -> u32 {
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &[], at);
        match tokens.next() {
            Some(token) if token.start == at => token.end.saturating_sub(token.start),
            _ => 0,
        }
    }
}
