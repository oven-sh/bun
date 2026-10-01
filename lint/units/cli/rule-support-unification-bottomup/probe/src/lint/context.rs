//! What a rule handler is given: the text, the names, the reports, and the services that read the text.

use bun_ast::{Case, Expr, Loc, Log, Ref, Source};
use bun_core::StackCheck;
use bun_js_parser::parse::parse_entry::ParsedOnly;

use super::Diagnostic;
use super::rule::Rule;
use super::tokens::{self, CaseTest, Tokens};

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
    parsed: &'p ParsedOnly<'p, 'a>,
    source: &'a Source,
    arena: &'a bun_alloc::Arena,
    /// What the lexer says when a re-scan meets text it cannot read. Never printed.
    scan_log: Log,
    pub(crate) stack_check: StackCheck,
    reports: Vec<Diagnostic>,
    /// Reports that hold only when one of their names is not declared in the file.
    held: Vec<(Diagnostic, Globals)>,
    declared: Globals,
    cut: bool,
    /// Probe only: [binaries, members, indexes, cases, cases whose keyword the text before the test shows], and what failed.
    stress: [u64; 5],
    stress_failed: Vec<(&'static str, i32)>,
}

const TOO_DEEP: Rule = Rule {
    name: "internal-error",
    category: super::rule::Category::Correctness,
};

impl<'p, 'a> Context<'p, 'a> {
    pub(crate) fn new(
        parsed: &'p ParsedOnly<'p, 'a>,
        source: &'a Source,
        arena: &'a bun_alloc::Arena,
    ) -> Self {
        Context {
            parsed,
            source,
            arena,
            scan_log: Log::init(),
            stack_check: StackCheck::init(),
            reports: Vec::new(),
            held: Vec::new(),
            declared: Globals::NONE,
            cut: false,
            stress: [0; 5],
            stress_failed: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn source(&self) -> &'a Source {
        self.source
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

    pub(crate) fn report(&mut self, rule: &'static Rule, start: u32, len: u32, text: Vec<u8>) {
        self.report_if_global(rule, start, len, text, Globals::NONE);
    }

    /// Held until the walk ends; dropped when the file declares every name of `names`.
    pub(crate) fn report_if_global(
        &mut self,
        rule: &'static Rule,
        start: u32,
        len: u32,
        text: Vec<u8>,
        names: Globals,
    ) {
        let Some(severity) = rule.category.default_level() else {
            return;
        };
        let diagnostic = Diagnostic {
            start,
            len,
            severity,
            code: rule.name,
            text,
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
            let start = u32::try_from(loc.start).unwrap_or(0);
            self.report(
                &TOO_DEEP,
                start,
                0,
                b"This file is nested too deeply to check all of it.".to_vec(),
            );
        }
    }

    pub(crate) fn finish(mut self) -> Vec<Diagnostic> {
        let declared = self.declared;
        for (diagnostic, names) in self.held {
            if names.0 & !declared.0 != 0 {
                self.reports.push(diagnostic);
            }
        }
        self.reports
    }

    /// How many `(` before `own` belong to the node whose token at `to` follows its first operand. `None`: not known.
    pub(crate) fn closes(&mut self, own: u32, to: Loc, under: &[&Expr]) -> Option<u32> {
        let to = u32::try_from(to.start).ok()?;
        let spans = tokens::spans_under(self.text(), under, self.stack_check)?;
        let mut tokens = Tokens::new(&mut self.scan_log, self.source, self.arena, &spans, own);
        tokens::closes_between(&mut tokens, to)
    }

    /// Where ESLint starts the node whose first own token is at `own`: at the `(` of a first operand in parentheses.
    /// `None`: there are such parentheses, and a comment or a line break stands between one and what it opens.
    pub(crate) fn start_of(&mut self, own: Loc, to: Loc, under: &[&Expr]) -> Option<u32> {
        let own = u32::try_from(own.start).ok()?;
        let closes = self.closes(own, to, under)?;
        tokens::before_opens(self.text(), own, closes)
    }

    pub(crate) fn case_test(&mut self, value: &Expr) -> Option<CaseTest> {
        let from = u32::try_from(value.loc.start).ok()?;
        let spans = tokens::spans_under(self.text(), &[value], self.stack_check)?;
        let mut tokens = Tokens::new(&mut self.scan_log, self.source, self.arena, &spans, from);
        CaseTest::read(&mut tokens)
    }

    /// Where a clause starts and how long its first token is: the keyword that the parser recorded, else the one
    /// that the text before the test shows, else the test.
    pub(crate) fn case_start(&mut self, case: &Case, value: &Expr) -> (u32, u32) {
        if let Ok(start) = u32::try_from(case.loc.start) {
            return (start, 4);
        }
        let own = u32::try_from(value.loc.start).unwrap_or(0);
        match tokens::case_before(self.text(), own) {
            Some(start) => (start, 4),
            None => (own, self.token_len(own)),
        }
    }

    /// The `]` after the index expression of a member.
    pub(crate) fn close_bracket(&mut self, index: &Expr) -> Option<u32> {
        let from = u32::try_from(index.loc.start).ok()?;
        let spans = tokens::spans_under(self.text(), &[index], self.stack_check)?;
        let mut tokens = Tokens::new(&mut self.scan_log, self.source, self.arena, &spans, from);
        tokens::close_bracket(&mut tokens)
    }

    /// The length of the token that starts at `at`. 0 when the text there does not read.
    pub(crate) fn token_len(&mut self, at: u32) -> u32 {
        let mut tokens = Tokens::new(&mut self.scan_log, self.source, self.arena, &[], at);
        match tokens.next() {
            Some(token) if token.start == at => token.end - token.start,
            _ => 0,
        }
    }

    /// Probe only. A span longer than 64 KiB is not scanned: a chain of n operands would cost n scans of its head.
    pub(crate) fn stress_binary(&mut self, node: &bun_ast::E::Binary, loc: Loc) {
        let Ok(own) = u32::try_from(loc.start) else {
            return;
        };
        if node.right.loc.start - loc.start > 65536 {
            return;
        }
        self.stress[0] += 1;
        if self
            .closes(own, node.right.loc, &[&node.left, &node.right])
            .is_none()
        {
            self.stress_failed.push(("binary", loc.start));
        }
    }

    pub(crate) fn stress_member(&mut self, loc: Loc, to: Loc, target: &Expr, index: Option<&Expr>) {
        let Ok(own) = u32::try_from(loc.start) else {
            return;
        };
        if to.start - loc.start > 65536 {
            return;
        }
        self.stress[1] += 1;
        if self.closes(own, to, &[target]).is_none() {
            self.stress_failed.push(("member", loc.start));
        }
        if let Some(index) = index {
            if !matches!(index.data, bun_ast::ExprData::EPrivateIdentifier(_)) {
                self.stress[2] += 1;
                if self.close_bracket(index).is_none() {
                    self.stress_failed.push(("index", loc.start));
                }
            }
        }
    }

    pub(crate) fn stress_switch(&mut self, node: &bun_ast::S::Switch) {
        for case in node.cases.slice() {
            let Some(value) = &case.value else { continue };
            self.stress[3] += 1;
            if self.case_test(value).is_none() {
                self.stress_failed.push(("case", value.loc.start));
            }
            if tokens::case_before(self.text(), u32::try_from(value.loc.start).unwrap_or(0))
                .is_some()
            {
                self.stress[4] += 1;
            }
        }
    }

    #[allow(clippy::disallowed_macros, clippy::disallowed_methods)]
    pub(crate) fn stress_report(&self) {
        eprintln!(
            "stress: {} binaries, {} members, {} indexes, {} cases ({} with the keyword found), {} failed",
            self.stress[0],
            self.stress[1],
            self.stress[2],
            self.stress[3],
            self.stress[4],
            self.stress_failed.len()
        );
        for (kind, at) in self.stress_failed.iter().take(12) {
            let from = (*at as usize).saturating_sub(40);
            let to = (*at as usize + 80).min(self.text().len());
            eprintln!(
                "  failed {kind} at {at}: {:?}",
                String::from_utf8_lossy(&self.text()[from..to])
            );
        }
    }
}
