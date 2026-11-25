//! Numbers the counters of a file by its code alone: once to place them, and once more to read their counts.

use bun_ast::coverage::{Anchor, Anchors, Event, GoesOn, Role};
use bun_core::strings;
use bun_sema::atom::{Atom, Intern, known};
use bun_sema::check::spans::token_end;
use bun_sema::hir::{
    BinOp, CaseId, ClassId, ExprId, ExprKind, FileBuilder, Flags, FnBody, FnId, FnKind, IdList,
    ModifierId, ModifierKind, PatId, PatKind, PropId, PropKey, PropKind, Span, StmtId, StmtKind,
    VarDeclId, end_of_expr, has_body, parentheses_around,
};

use crate::hints::{Hint, Hints};
use crate::locs::{self, starts_with, token_after};
use crate::positions::Positions;
use crate::report::{Arms, Branch, Counted, Function, KnownTo, Report, UNKNOWN};

pub(crate) fn find_anchors(hir: &FileBuilder, text: &[u8]) -> Anchors {
    let mut walk = Walk::new(hir, text, None);
    walk.run();
    walk.anchors
}

pub(crate) enum NoReport {
    IsIgnored,
    CannotBeParsed,
}

/// `counts`: `None` if the file was not loaded.
pub(crate) fn report<'a>(
    hir: &FileBuilder,
    atoms: &dyn Intern,
    text: &'a [u8],
    counts: Option<&[u64]>,
) -> Result<Report<'a>, NoReport> {
    let positions = Positions::new(text);
    let hints = Hints::find(&hir.comments, text, &positions);
    if hints.ignores_file {
        return Err(NoReport::IsIgnored);
    }
    if counts.is_none() && hir.syntax_errors().next().is_some() {
        return Err(NoReport::CannotBeParsed);
    }
    let mut report = Report::new(positions);
    let reporting = Reporting {
        report: &mut report,
        counts,
        atoms,
        hints,
    };
    let mut walk = Walk::new(hir, text, Some(reporting));
    walk.run();
    if counts.is_some_and(|it| it.len() != walk.anchors.counters as usize) {
        return Err(NoReport::CannotBeParsed);
    }
    report.finish();
    Ok(report)
}

struct Reporting<'a, 't> {
    report: &'a mut Report<'t>,
    counts: Option<&'a [u64]>,
    atoms: &'a dyn Intern,
    hints: Hints,
}

/// The counter of the code around.
#[derive(Clone, Copy)]
struct At {
    counter: u32,
    /// Nothing has run since it went up.
    is_exact: bool,
    is_ignored: bool,
    /// In a function that is not in the code that ran.
    is_gone: bool,
}

impl At {
    fn later(self) -> At {
        let is_exact = false;
        At { is_exact, ..self }
    }

    fn counted_by(self, counter: u32) -> At {
        At {
            counter,
            is_exact: true,
            ..self
        }
    }

    fn ignored_if(self, is_ignored: bool) -> At {
        let is_ignored = is_ignored || self.is_ignored;
        At { is_ignored, ..self }
    }
}

/// What a function that has no name of its own is called.
#[derive(Clone, Copy)]
struct Name {
    owner: Atom,
    name: Atom,
}

impl Name {
    const NONE: Name = Name::new(Atom::NONE);

    const fn new(name: Atom) -> Name {
        let owner = Atom::NONE;
        Name { owner, name }
    }
}

enum Work {
    Statements(IdList<StmtId>, At),
    Statement(StmtId, At),
    Expression(ExprId, At, Name),
    Target(ExprId, At),
    Pattern(PatId, At),
}

struct Walk<'a, 't> {
    hir: &'a FileBuilder,
    text: &'a [u8],
    anchors: Anchors,
    reporting: Option<Reporting<'a, 't>>,
    work: Vec<Work>,
    links: Vec<ExprId>,
    operands: Vec<(ExprId, At)>,
}

impl<'a, 't> Walk<'a, 't> {
    fn new(hir: &'a FileBuilder, text: &'a [u8], reporting: Option<Reporting<'a, 't>>) -> Self {
        Walk {
            hir,
            text,
            anchors: Anchors::default(),
            reporting,
            work: Vec::new(),
            links: Vec::new(),
            operands: Vec::new(),
        }
    }

    fn run(&mut self) {
        let file = At {
            counter: self.counter(Role::File, Event::Reached, 0),
            is_exact: false,
            is_ignored: false,
            is_gone: false,
        };
        let body = self.body_of_commonjs_wrapper().unwrap_or(self.hir.body);
        self.statements(body, file);
        while let Some(work) = self.work.pop() {
            match work {
                Work::Statements(it, at) => self.statements(it, at),
                Work::Statement(it, at) => _ = self.statement(it, at),
                Work::Expression(it, at, name) => self.expression(it, at, name),
                Work::Target(it, at) => self.target(it, at),
                Work::Pattern(it, at) => self.pattern(it, at),
            }
        }
    }

    /// In what the transpiler or the bundler printed.
    fn body_of_commonjs_wrapper(&self) -> Option<IdList<StmtId>> {
        let hir = self.hir;
        let only = hir.ids(hir.body).next().filter(|_| hir.body.len() == 1)?;
        let StmtKind::Expr(e) = hir[only].kind else {
            return None;
        };
        let ExprKind::Fn(wrapper) = hir[e].kind else {
            return None;
        };
        let names = (hir[wrapper].params.iter()).map(|it| self.name_of(hir[it].pat).name);
        let expected = [known::exports, known::require, known::module];
        match hir[wrapper].body {
            FnBody::Block(body) if names.take(expected.len()).eq(expected) => Some(body),
            _ => None,
        }
    }

    fn counter(&mut self, role: Role, event: Event, loc: u32) -> u32 {
        let counter = self.anchors.counters;
        self.anchors.counters += 1;
        self.anchor(counter, role, event, loc);
        counter
    }

    fn anchor(&mut self, counter: u32, role: Role, event: Event, loc: u32) {
        if self.reporting.is_none() {
            self.anchors.all.push(Anchor {
                loc,
                role,
                event,
                counter,
            });
        }
    }

    fn reached(&mut self, role: Role, loc: u32, at: At) -> At {
        if !at.is_exact {
            return at.counted_by(self.counter(role, Event::Reached, loc));
        }
        self.anchor(at.counter, role, Event::Reached, loc);
        at
    }

    fn evaluated(&mut self, e: ExprId, at: At) -> At {
        self.reached(Role::Expression, locs::of_expression(self.hir, e), at)
    }

    /// For what a test decides about.
    fn sometimes_evaluated(&mut self, e: ExprId, at: At) -> At {
        self.evaluated(e, at.later().ignored_if(self.is_hinted(e)))
    }

    fn count(&self, at: At) -> u64 {
        let counts = self.reporting.as_ref().and_then(|it| it.counts);
        match counts.and_then(|it| it.get(at.counter as usize)) {
            Some(&count) if !at.is_gone => count,
            _ => 0,
        }
    }

    fn called(&mut self, body: u32, outside: At) -> At {
        let mut called = self.reached(Role::Body, body, outside);
        called.is_gone |= self.count(called) == UNKNOWN;
        called
    }

    fn has_hint(&self, node: u32, hint: Hint) -> bool {
        (self.reporting.as_ref()).is_some_and(|it| it.hints.has(node, hint))
    }

    fn hinted(&self, node: u32, at: At) -> At {
        at.ignored_if(self.has_hint(node, Hint::Next))
    }

    fn is_hinted(&self, e: ExprId) -> bool {
        self.reporting.as_ref().is_some_and(|it| {
            let mut parentheses = parentheses_around(self.hir, e).iter();
            it.hints.has(self.start(e), Hint::Next)
                || parentheses.any(|open| it.hints.has(open.1, Hint::Next))
        })
    }

    /// `at`, for the one thing that starts at `start`.
    fn on_line(&self, start: u32, at: At) -> At {
        at.ignored_if((self.reporting.as_ref()).is_none_or(|it| it.hints.ignores_line_at(start)))
    }

    fn report_for(&mut self, start: u32, at: At) -> Option<&mut Report<'t>> {
        let is_left_out = self.on_line(start, at).is_ignored || self.count(at) == UNKNOWN;
        (self.reporting.as_mut().filter(|_| !is_left_out)).map(|it| &mut *it.report)
    }

    /// It makes its line one with code.
    fn token(&mut self, start: u32, at: At) {
        let count = self.count(at);
        if let Some(report) = self.report_for(start, at) {
            report.count_line_at(start, count);
        }
    }

    fn last_token(&mut self, end: u32, at: At) {
        self.token(end.saturating_sub(1), at);
    }

    fn add_statement(&mut self, known_to: KnownTo, owner: u32, (start, end): (u32, u32), at: At) {
        let count = self.count(at);
        if let Some(report) = self.report_for(start, at) {
            let statement = Counted { start, end, count };
            report.statements.push((known_to.order(owner), statement));
        }
    }

    fn branch(
        &mut self,
        known_to: KnownTo,
        kind: &'static str,
        decision: (u32, u32),
        at: At,
    ) -> Option<Branch> {
        self.token(decision.0, at);
        (self.reporting.is_some() && !at.is_ignored).then(|| Branch {
            order: known_to.order(decision.0),
            kind,
            decision,
            arms: Arms::new(),
        })
    }

    /// `at` has been through `on_line`.
    fn arm(&self, branch: &mut Option<Branch>, (start, end): (u32, u32), at: At) {
        let count = self.count(at);
        if let Some(branch) = branch
            && !at.is_ignored
            && count != UNKNOWN
        {
            branch.arms.push(Counted { start, end, count });
        }
    }

    fn arm_at(&self, branch: &mut Option<Branch>, range: (u32, u32), at: At) {
        self.arm(branch, range, self.on_line(range.0, at));
    }

    fn add(&mut self, branch: Option<Branch>) {
        let (Some(branch), Some(reporting)) = (branch, &mut self.reporting) else {
            return;
        };
        // genhtml refuses a branch on a line without code, or that was taken on a line that did not run.
        if let Some(most) = branch.arms.iter().map(|it| it.count).max() {
            reporting.report.count_line_at(branch.decision.0, most);
        }
        reporting.report.branches.push(branch);
    }

    /// Code of which Istanbul does not say whether it ran.
    fn add_only_arm(&mut self, kind: &'static str, decision: (u32, u32), arm: (u32, u32), at: At) {
        let mut branch = self.branch(KnownTo::Bun, kind, decision, at);
        self.arm_at(&mut branch, arm, at);
        self.add(branch);
    }

    fn start(&self, e: ExprId) -> u32 {
        match self.hir[e].kind {
            ExprKind::Class(class) => self.hir[class].start,
            _ => self.hir[e].pos,
        }
    }

    fn range(&self, e: ExprId) -> (u32, u32) {
        (self.start(e), self.hir[e].end)
    }

    fn keyword(&self, start: u32) -> (u32, u32) {
        let rest = self.text.get(start as usize..).unwrap_or_default();
        let letters = rest.iter().take_while(|it| it.is_ascii_lowercase());
        (start, start + letters.count() as u32)
    }

    fn walk(&mut self, e: ExprId, at: At) {
        self.walk_named(e, at, Name::NONE);
    }

    fn walk_named(&mut self, e: ExprId, at: At, name: Name) {
        match self.hir.exprs.get(e.idx()).map(|it| it.kind) {
            None => {}
            Some(
                ExprKind::Ident(_) | ExprKind::This | ExprKind::String(_) | ExprKind::Number(_),
            ) if self.reporting.is_none() => {}
            Some(_) => self.work.push(Work::Expression(e, at, name)),
        }
    }

    fn walk_all(&mut self, list: IdList<ExprId>, mut at: At) {
        for e in self.hir.ids(list) {
            self.walk(e, at);
            at = at.later();
        }
    }

    fn walk_target(&mut self, e: ExprId, at: At) {
        self.work.push(Work::Target(e, at));
    }

    fn walk_pattern(&mut self, pattern: PatId, at: At) {
        match self.hir[pattern].kind {
            PatKind::Ident(_) => self.token(self.hir[pattern].pos, at),
            _ => self.work.push(Work::Pattern(pattern, at)),
        }
    }

    fn walk_statement(&mut self, s: StmtId, at: At) {
        if s.is_some() {
            self.work.push(Work::Statement(s, at));
        }
    }

    fn walk_statements(&mut self, list: IdList<StmtId>, at: At) {
        self.work.push(Work::Statements(list, at));
    }

    fn statements(&mut self, list: IdList<StmtId>, mut at: At) {
        let hir = self.hir;
        let mut counted_with_next = Vec::new();
        for s in kept_statements(hir, list) {
            let runs_nothing = match hir[s].kind {
                StmtKind::Var(all) => all.iter().all(|it| hir[it].init.is_none()),
                kind => matches!(kind, StmtKind::Directive { .. }),
            };
            if runs_nothing {
                counted_with_next.push(s);
            } else if let Some(counter) = self.statement(s, at) {
                at = at.counted_by(counter).later();
                for s in counted_with_next.drain(..) {
                    self.walk_statement(s, at);
                }
                if self.reporting.is_none() {
                    self.anchors
                        .statements
                        .push((counter, goes_on(hir[s].kind)));
                }
            }
        }
        for s in counted_with_next {
            self.walk_statement(s, at);
        }
        if let Some(last) = self.anchors.statements.last_mut() {
            last.1 = GoesOn::Never;
        }
    }

    /// The counter that goes up when control gets to it, if it has one.
    fn statement(&mut self, s: StmtId, at: At) -> Option<u32> {
        let hir = self.hir;
        let range @ (start, end) = (hir[s].start, hir[s].loc.end);
        let at = self.hinted(start, at);
        let known_to = match hir[s].kind {
            StmtKind::Expr(e) => {
                let at = self.evaluated(e, at);
                self.add_statement(KnownTo::Istanbul, start, range, at);
                self.walk(e, at);
                return Some(at.counter);
            }
            StmtKind::Var(all) => return self.variables(start, all, at),
            StmtKind::Fn(it) => {
                let range = (hir[it].text_start, end);
                self.function(KnownTo::Istanbul, it, range, Name::new(known::default), at);
                return None;
            }
            StmtKind::Block(list) => {
                let at = self.reached(Role::Statement, start, at);
                self.walk_statements(list, at);
                return Some(at.counter);
            }
            StmtKind::Empty | StmtKind::Directive { .. } => {
                self.token(start, at);
                return None;
            }
            // The `b` of `namespace a.b`
            StmtKind::Module(it) if hir[it].name_pos == start => {
                self.walk_statements(hir[it].body, at);
                return None;
            }
            // A name can be that of a type.
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e)
                if !matches!(hir[e].kind, ExprKind::Ident(_)) =>
            {
                KnownTo::Bun
            }
            StmtKind::Class(_) | StmtKind::Enum(_) | StmtKind::Module(_) => KnownTo::Bun,
            kind if kind.may_have_modifiers() => return None,
            _ => KnownTo::Istanbul,
        };
        let at = self.reached(Role::Statement, locs::of_statement(hir, self.text, s), at);
        self.add_statement(known_to, start, range, at);
        self.token(start, at);
        match hir[s].kind {
            StmtKind::Class(it) => self.class(it, at.later(), known::default),
            StmtKind::Enum(it) => {
                for it in hir[it].members.iter() {
                    let at = self.hinted(hir[it].pos, at.later());
                    self.token(hir[it].pos, at);
                    self.walk(hir[it].init, at);
                }
            }
            StmtKind::Module(it) => self.walk_statements(hir[it].body, at),
            StmtKind::ExportDefault(e) | StmtKind::ExportAssign(e) => {
                self.walk_named(e, at, Name::new(known::default));
            }
            StmtKind::Return(e) | StmtKind::Throw(e) if e.is_some() => {
                self.evaluated(e, at);
                self.walk(e, at);
            }
            StmtKind::If { test, yes, no } => self.if_statement(range, test, (yes, no), at),
            StmtKind::For { test, body, .. }
            | StmtKind::While { test, body }
            | StmtKind::DoWhile { body, test } => {
                if let StmtKind::For { init, update, .. } = hir[s].kind {
                    match init.some().map(|it| hir[it].kind) {
                        Some(StmtKind::Expr(e)) => self.walk(e, at),
                        _ => self.walk_statement(init, at),
                    }
                    let updated = self.updated(start, update, at);
                    self.walk(update, updated);
                }
                if test.is_some() {
                    let tested = self.evaluated(test, at.later());
                    self.walk(test, tested);
                }
                self.loop_body(start, body, at);
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                self.walk(expr, at);
                let entered = self.loop_body(start, body, at);
                match hir[left].kind {
                    StmtKind::Expr(e) => self.walk_target(e, entered.later()),
                    _ => self.walk_statement(left, entered.later()),
                }
            }
            StmtKind::With { object, body } => {
                self.walk(object, at);
                self.walk_statement(body, at.later());
            }
            StmtKind::Switch { expr, cases } => {
                self.walk(expr, at);
                self.cases(range, cases, at);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.walk_statement(block, at);
                if handler.is_some() {
                    let keyword = token_after(self.text, hir[block].loc.end);
                    self.catch_clause(keyword, param, handler, at);
                }
                if finalizer.is_some() {
                    let brace = locs::of_finally_block(hir, self.text, finalizer);
                    let at = self.clause(hir[finalizer].start, brace, at);
                    self.walk_statement(finalizer, at);
                }
            }
            StmtKind::Labeled { body, .. } => self.walk_statement(body, at),
            _ => {}
        }
        Some(at.counter)
    }

    fn variables(&mut self, start: u32, all: Span<VarDeclId>, mut at: At) -> Option<u32> {
        let hir = self.hir;
        let first = all.iter().find(|&it| hir[it].init.is_some());
        if let Some(first) = first {
            at = self.evaluated(hir[first].init, at);
        }
        let reached = first.map(|_| at.counter);
        self.token(start, at);
        for id in all.iter() {
            let it = hir[id];
            let owner = hir[it.pat].pos;
            if it.init.is_some() {
                if Some(id) != first {
                    at = self.evaluated(it.init, at.later());
                }
                let at = self.hinted(owner, at);
                self.add_statement(KnownTo::Istanbul, owner, self.range(it.init), at);
                self.walk_named(it.init, at, self.name_of(it.pat));
            }
            self.walk_pattern(it.pat, self.hinted(owner, at.later()));
        }
        reached
    }

    fn if_statement(
        &mut self,
        range @ (start, end): (u32, u32),
        test: ExprId,
        (yes, no): (StmtId, StmtId),
        at: At,
    ) {
        let hir = self.hir;
        let ignores = |hint, arm: StmtId| {
            self.has_hint(start, hint) || arm.is_some() && self.has_hint(hir[arm].start, Hint::Next)
        };
        let ignores = (ignores(Hint::If, yes), ignores(Hint::Else, no));
        let taken = self.reached(Role::Guarded, start, at.later().ignored_if(ignores.0));
        let not_taken = self.counter(Role::Guarded, Event::Skipped, start);
        let not_taken = at.counted_by(not_taken).ignored_if(ignores.1);
        self.walk_statement(yes, taken);
        let mut last_keyword = start;
        if no.is_some() {
            last_keyword = token_after(self.text, hir[yes].loc.end);
            self.token(last_keyword, not_taken);
            self.walk_statement(no, not_taken);
        }
        let mut other = no.some().map_or((start, start), |it| (hir[it].start, end));
        let not_taken = self.on_line(other.0, not_taken);
        let mut branch = self.branch(KnownTo::Istanbul, "if", range, at);
        self.arm(&mut branch, range, self.on_line(hir[yes].start, taken));
        // Istanbul merges branches whose first arms have one range, and its HTML report throws if there is none.
        if let Some(branch) = branch.as_mut().filter(|it| it.arms.is_empty()) {
            (branch.kind, other) = ("else", self.keyword(last_keyword));
        }
        self.arm(&mut branch, other, not_taken);
        self.add(branch);
        self.walk(test, at);
    }

    /// On another line than the `for` it has a count of its own.
    fn updated(&mut self, start: u32, e: ExprId, at: At) -> At {
        let header =
            (e.some()).and_then(|e| self.text.get(start as usize..self.hir[e].end as usize));
        match header.is_some_and(|it| strings::contains_char(it, b'\n')) {
            true => self.evaluated(e, at.later()),
            false => at.later(),
        }
    }

    fn loop_body(&mut self, start: u32, body: StmtId, at: At) -> At {
        let entered = self.reached(Role::Guarded, start, at.later());
        self.walk_statement(body, entered);
        entered
    }

    fn cases(&mut self, range: (u32, u32), cases: Span<CaseId>, at: At) {
        let hir = self.hir;
        let mut branch = self.branch(KnownTo::Istanbul, "switch", range, at);
        for case in cases.iter().map(|it| hir[it]) {
            let at = self.hinted(case.pos, at.later());
            let reached = self.reached(Role::Case, case.pos, at);
            self.arm_at(&mut branch, (case.pos, case.end), reached);
            self.token(case.pos, reached);
            self.walk(case.test, reached.later());
            self.walk_statements(case.body, reached);
        }
        self.add(branch);
    }

    fn catch_clause(&mut self, keyword: u32, param: VarDeclId, handler: StmtId, mut at: At) {
        let (hir, brace) = (self.hir, self.hir[handler].start);
        let is_empty = match hir[handler].kind {
            StmtKind::Block(list) => kept_statements(hir, list).next().is_none(),
            _ => false,
        };
        if is_empty {
            at = self.hinted(token_after(self.text, brace + 1), at);
        }
        let caught = self.clause(keyword, brace, at);
        self.walk_statement(handler, caught);
        if param.is_some() {
            self.walk_pattern(hir[param].pat, caught.later());
        }
        if is_empty {
            let keyword = self.keyword(keyword);
            self.add_only_arm("catch", keyword, keyword, caught);
        }
    }

    /// `catch` or `finally`
    fn clause(&mut self, keyword: u32, brace: u32, at: At) -> At {
        let at = self.hinted(keyword, self.hinted(brace, at.later()));
        let at = self.reached(Role::Body, brace, at);
        self.token(keyword, at);
        at
    }

    fn name_of(&self, pattern: PatId) -> Name {
        match self.hir[pattern].kind {
            PatKind::Ident(name) => Name::new(name),
            _ => Name::NONE,
        }
    }

    fn name_of_target(&self, target: ExprId) -> Name {
        let (mut object, name) = match self.hir[target].kind {
            ExprKind::Ident(name) => return Name::new(name),
            ExprKind::Dot { obj, name, .. } => (obj, name),
            _ => return Name::NONE,
        };
        if let ExprKind::Dot {
            obj,
            name: known::prototype,
            ..
        } = self.hir[object].kind
        {
            object = obj;
        }
        match self.hir[object].kind {
            ExprKind::Ident(owner) if owner != known::exports => Name { owner, name },
            _ => Name::new(name),
        }
    }

    fn default_value(&mut self, start: u32, value: ExprId, at: At, name: Name) {
        let used = self.sometimes_evaluated(value, at);
        let range = (start, end_of_expr(self.hir, value));
        let mut branch = self.branch(KnownTo::Istanbul, "default-arg", range, at);
        self.arm_at(&mut branch, self.range(value), used);
        self.add(branch);
        self.walk_named(value, used, name);
    }

    fn binding(&mut self, pattern: PatId, default: ExprId, at: At) {
        let start = self.hir[pattern].pos;
        let at = self.hinted(start, at);
        self.walk_pattern(pattern, at);
        if default.is_some() {
            self.default_value(start, default, at, self.name_of(pattern));
        }
    }

    fn pattern(&mut self, pattern: PatId, at: At) {
        let hir = self.hir;
        match hir[pattern].kind {
            PatKind::Object(all) => {
                for it in all.iter().map(|it| hir[it]) {
                    let at = self.hinted(it.pos, at);
                    self.key(it.key, it.pos, at);
                    self.binding(it.value, it.default, at);
                }
            }
            PatKind::Array(all) => {
                for it in all.iter().map(|it| hir[it]) {
                    self.binding(it.pat, it.default, at);
                }
            }
            PatKind::Missing | PatKind::Ident(_) => {}
        }
    }

    fn target(&mut self, e: ExprId, at: At) {
        let hir = self.hir;
        match hir[e].kind {
            ExprKind::Array(all) => {
                for it in hir.ids(all) {
                    self.element_of_target(it, at.later());
                }
            }
            ExprKind::Object(all) => {
                for it in all.iter().map(|it| hir[it]) {
                    let at = self.hinted(it.start, at.later());
                    self.key(it.key, it.pos, at);
                    self.element_of_target(it.value, at);
                }
            }
            _ => return self.walk(e, at),
        }
        self.token(hir[e].pos, at);
        self.last_token(hir[e].end, at);
    }

    fn element_of_target(&mut self, e: ExprId, at: At) {
        match self.hir[e].kind {
            ExprKind::Assign {
                op: None,
                target,
                value,
            } => {
                let at = self.hinted(self.hir[e].pos, at);
                self.walk_target(target, at);
                self.default_value(self.hir[e].pos, value, at, self.name_of_target(target));
            }
            ExprKind::Spread(it) => self.walk_target(it, at),
            _ => self.walk_target(e, at),
        }
    }

    fn key(&mut self, key: PropKey, start: u32, at: At) -> Atom {
        self.token(start, at);
        self.computed_key(key, at)
    }

    fn computed_key(&mut self, key: PropKey, at: At) -> Atom {
        if let PropKey::Computed(e) = key {
            self.walk(e, at);
        }
        key.name().unwrap_or(Atom::NONE)
    }

    fn decorators(&mut self, modifiers: Span<ModifierId>, at: At) {
        for it in modifiers.iter() {
            if let ModifierKind::Decorator(e) = self.hir[it].kind {
                self.walk(e, at);
            }
        }
    }

    fn function(
        &mut self,
        known_to: KnownTo,
        id: FnId,
        (start, end): (u32, u32),
        name: Name,
        outside: At,
    ) {
        let hir = self.hir;
        let function = &hir[id];
        let outside = self.hinted(function.text_start, outside.later());
        let (body, called) = match function.body {
            FnBody::None => return,
            FnBody::Block(list) if function.kind == FnKind::StaticBlock => {
                return self.walk_statements(list, outside);
            }
            FnBody::Block(list) => {
                let Some(brace) = locs::of_function_block(hir, id) else {
                    return;
                };
                let called = self.called(brace, outside);
                let first = match function.kind {
                    // Fields can be initialized in between.
                    FnKind::Constructor => self.hinted(brace, called.later()),
                    _ => self.hinted(brace, called),
                };
                self.walk_statements(list, first);
                ((brace, end), called)
            }
            FnBody::Expr(e) => {
                let called = self.called(function.anchor, outside);
                self.evaluated(e, called);
                self.add_statement(KnownTo::Istanbul, self.start(e), self.range(e), called);
                self.walk(e, called);
                (self.range(e), called)
            }
        };
        self.reached(Role::Body, function.text_start, called);
        self.token(function.text_start, called);
        for id in function.params.iter() {
            let it = &hir[id];
            self.decorators(hir.param_modifiers(id), outside);
            self.binding(it.pat, it.default, self.hinted(it.pos, called.later()));
        }
        let Some(&Reporting { atoms, .. }) = self.reporting.as_ref() else {
            return;
        };
        let (name, declaration) = match function.kind {
            FnKind::Decl | FnKind::Expr if function.name.is_some() => {
                let end = token_end(self.text, function.name_pos as usize, false) as u32;
                (
                    atoms.bytes(function.name).to_vec(),
                    (function.name_pos, end),
                )
            }
            kind => (
                spell(kind, name, atoms),
                (function.text_start, function.text_start + 1),
            ),
        };
        self.token(declaration.0, called);
        let count = self.count(called);
        if let Some(report) = self.report_for(function.text_start, called) {
            report.functions.push(Function {
                order: known_to.order(start),
                name,
                declaration,
                body: Counted {
                    start: body.0,
                    end: body.1,
                    count,
                },
            });
        }
    }

    fn class(&mut self, id: ClassId, at: At, name: Atom) {
        let hir = self.hir;
        let class = &hir[id];
        let at = self.hinted(class.text_start, at);
        let owner = if class.name.is_some() {
            class.name
        } else {
            name
        };
        self.token(class.text_start, at);
        self.decorators(class.modifiers, at);
        self.walk(class.extends, at);
        for it in class.members.iter().map(|it| &hir[it]) {
            let is_signature = it.func.is_some() && !has_body(&hir[it.func]);
            if is_signature || it.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT) {
                continue;
            }
            let at = self.hinted(it.start, at);
            self.decorators(it.modifiers, at);
            let name = self.computed_key(it.key, at);
            let name = Name { owner, name };
            let known_to = match it.func.is_some() {
                true if matches!(it.key, PropKey::Private(_)) => KnownTo::Bun,
                false if it.flags.contains(Flags::ACCESSOR) => KnownTo::Bun,
                _ => KnownTo::Istanbul,
            };
            if it.func.is_some() {
                self.function(known_to, it.func, (it.start, it.loc.end), name, at);
            } else if it.init.is_some() {
                let at = self.evaluated(it.init, at);
                self.token(it.name_pos, at);
                self.add_statement(known_to, it.start, self.range(it.init), at);
                self.walk_named(it.init, at, name);
            } else {
                self.token(it.name_pos, at);
            }
        }
    }

    fn properties(&mut self, all: Span<PropId>, at: At, owner: Atom) {
        let hir = self.hir;
        for it in all.iter().map(|it| &hir[it]) {
            let at = self.hinted(it.start, at);
            match (it.kind, it.value.some().map(|it| hir[it].kind)) {
                (
                    PropKind::Method | PropKind::Getter | PropKind::Setter,
                    Some(ExprKind::Fn(id)),
                ) => {
                    let name = self.computed_key(it.key, at);
                    let range = (it.start, hir[it.value].end);
                    self.function(KnownTo::Istanbul, id, range, Name { owner, name }, at);
                }
                _ => {
                    let name = self.key(it.key, it.start, at);
                    self.walk_named(it.value, at, Name { owner, name });
                }
            }
        }
    }

    fn logical(&mut self, e: ExprId, at: At) {
        let at = self.reached(Role::FirstOperand, locs::of_expression(self.hir, e), at);
        let mut branch = self.branch(KnownTo::Istanbul, "binary-expr", self.range(e), at);
        self.operands.push((e, at));
        while let Some((it, at)) = self.operands.pop() {
            let Some((left, right)) = self.as_logical(it) else {
                self.arm_at(&mut branch, self.range(it), at);
                self.walk(it, at);
                continue;
            };
            let evaluated = self.sometimes_evaluated(right, at);
            let at = at.ignored_if(self.is_hinted(left));
            self.operands.extend([(right, evaluated), (left, at)]);
        }
        self.add(branch);
    }

    fn as_logical(&self, e: ExprId) -> Option<(ExprId, ExprId)> {
        match self.hir[e].kind {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => Some((left, right)),
            _ => None,
        }
    }

    /// `a.b`, `a[b]`, `a(b)` and what they are applied to.
    fn links(&mut self, e: ExprId, outside: At) {
        let hir = self.hir;
        let mut base = e;
        while let Some(before) = starts_with(hir, base) {
            self.links.push(base);
            base = before;
            let is_link = matches!(
                hir[base].kind,
                ExprKind::Dot { .. }
                    | ExprKind::Index { .. }
                    | ExprKind::Call(_)
                    | ExprKind::NonNull(_)
            );
            if !is_link || !parentheses_around(hir, base).is_empty() {
                self.walk(base, outside);
                break;
            }
        }
        let mut at = outside.later();
        while let Some(link) = self.links.pop() {
            if let Some(loc) = locs::of_optional_link(hir, link) {
                let went_on = self.reached(Role::Chain, loc, at).later();
                at = self.optional_chain(base, hir[e].end, went_on);
            }
            match hir[link].kind {
                ExprKind::Dot { .. } => self.token(hir.name_pos(link), at),
                ExprKind::Index { index, .. } => self.walk(index, at),
                ExprKind::Call(it) => {
                    self.walk_all(hir[it].args, at);
                    self.last_token(hir[link].end, at);
                }
                _ => {}
            }
            base = link;
        }
    }

    fn optional_chain(&mut self, base: ExprId, end: u32, went_on: At) -> At {
        if self.reporting.is_none() {
            return went_on;
        }
        let start = token_after(self.text, end_of_expr(self.hir, base));
        let next = token_after(self.text, start + "?.".len() as u32);
        let at = self.hinted(start, self.hinted(next, went_on));
        self.add_only_arm("optional-chain", (start, end), (start, end), at);
        at
    }

    fn conditional(&mut self, e: ExprId, test: ExprId, arms: [ExprId; 2], at: At) {
        let mut branch = self.branch(KnownTo::Istanbul, "cond-expr", self.range(e), at);
        for it in arms {
            let at = self.sometimes_evaluated(it, at);
            self.arm_at(&mut branch, self.range(it), at);
            self.walk(it, at);
        }
        self.add(branch);
        self.walk(test, at);
    }

    fn assignment(&mut self, e: ExprId, op: Option<BinOp>, target: ExprId, value: ExprId, at: At) {
        self.walk_target(target, at);
        let name = self.name_of_target(target);
        match (op, self.hir[target].kind) {
            (Some(BinOp::And | BinOp::Or | BinOp::Nullish), _) => {
                self.token(self.start(e), at);
                let at = self.sometimes_evaluated(value, at);
                self.add_only_arm("logical-assignment", self.range(e), self.range(value), at);
                self.walk_named(value, at, name);
            }
            (None, ExprKind::Ident(_)) => self.walk_named(value, at, name),
            _ => self.walk_named(value, at.later(), name),
        }
    }

    fn expression(&mut self, e: ExprId, at: At, name: Name) {
        let hir = self.hir;
        let at = at.ignored_if(self.is_hinted(e));
        let (start, end) = (hir[e].pos, hir[e].end);
        match hir[e].kind {
            ExprKind::Missing => return,
            ExprKind::Binary { .. } if self.as_logical(e).is_some() => return self.logical(e, at),
            ExprKind::Binary { left, right, .. } => {
                self.walk(left, at);
                return self.walk(right, at.later());
            }
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                return self.conditional(e, test, [branches.yes, branches.no], at);
            }
            ExprKind::Assign { op, target, value } => {
                return self.assignment(e, op, target, value, at);
            }
            ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) => {
                return self.links(e, at);
            }
            ExprKind::TaggedTemplate(it) => {
                self.walk(hir[it].callee, at);
                return self.walk_all(hir[it].args, at.later());
            }
            ExprKind::Fn(it) => {
                return self.function(KnownTo::Istanbul, it, (start, end), name, at);
            }
            ExprKind::Class(it) => return self.class(it, at.later(), name.name),
            _ if let Some(operand) = hir.type_assertion_operand(e) => {
                return self.walk_named(operand, at, name);
            }
            ExprKind::JsxText(_) => {
                let text = self.text.get(start as usize..end as usize);
                let length = text.unwrap_or_default().trim_ascii_start().len() as u32;
                return self.token(end - length, at);
            }
            ExprKind::New(it) => {
                self.walk(hir[it].callee, at);
                self.walk_all(hir[it].args, at.later());
                self.last_token(end, at);
            }
            ExprKind::Array(all) => {
                self.walk_all(all, at);
                self.last_token(end, at);
            }
            ExprKind::Object(all) => {
                self.properties(all, at.later(), name.name);
                self.last_token(end, at);
            }
            ExprKind::Jsx(it) => {
                self.properties(hir[it].attrs, at.later(), Atom::NONE);
                self.walk_all(hir[it].children, at.later());
                self.last_token(end, at);
            }
            ExprKind::Template { exprs: all } | ExprKind::ImportCall { args: all } => {
                self.walk_all(all, at);
            }
            ExprKind::Unary { operand: it, .. }
            | ExprKind::Spread(it)
            | ExprKind::Await(it)
            | ExprKind::Yield { value: it, .. } => self.walk(it, at),
            _ => {}
        }
        self.token(start, at);
    }
}

fn kept_statements(hir: &FileBuilder, list: IdList<StmtId>) -> impl Iterator<Item = StmtId> {
    (hir.ids(list))
        .filter(|&s| !matches!(hir[s].kind, StmtKind::Empty) && !hir.is_erased_statement(s))
}

fn goes_on(statement: StmtKind) -> GoesOn {
    match statement {
        StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Return(_) | StmtKind::Throw(_) => {
            GoesOn::Never
        }
        StmtKind::Expr(_) => GoesOn::Always,
        _ if statement.may_have_modifiers() => GoesOn::Always,
        _ => GoesOn::Sometimes,
    }
}

fn spell(kind: FnKind, Name { owner, name }: Name, atoms: &dyn Intern) -> Vec<u8> {
    let prefix: &[u8] = match kind {
        _ if name.is_none() => return Vec::new(),
        FnKind::Getter => b"get ",
        FnKind::Setter => b"set ",
        _ => b"",
    };
    let dot: &[u8] = if owner.is_some() { b"." } else { b"" };
    let spelled = [prefix, atoms.bytes(owner), dot, atoms.bytes(name)].concat();
    let ends_field_of_lcov =
        |it: &char| it.is_control() || matches!(it, ',' | '\u{2028}' | '\u{2029}');
    let characters = strings::wtf8_codepoints(&spelled)
        .map(|it| char::from_u32(it.1).filter(|it| !ends_field_of_lcov(it)));
    String::from_iter(characters.map(|it| it.unwrap_or('_'))).into_bytes()
}
