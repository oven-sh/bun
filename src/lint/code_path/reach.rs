//! Which statements can be reached, without the graphs.
//!
//! Whether a segment is reachable is decided when ESLint makes it, from those before it, and
//! never changes. So what `CodePathState` does can be done with that one bit in the place of each
//! segment, and the answers are the same. Nothing in an expression makes anything unreachable, so
//! only statements are looked at: this takes a few instructions for each statement of a function.
//! The exception is the start of a `try` block, where ESLint looks for the first node that may
//! throw.
//!
//! The names of the methods are those of `CodePathState`, in snake case. Where this gives up (a
//! generator with a `try` statement, deep nesting), the analysis itself answers.

use super::analyzer::{
    self, boolean_value_if_simple_constant, has_code_path, is_binding_a_reference, is_breakable,
    is_property_definition, starts_with_identifier_reference,
};
use super::matters::Marks;
use crate::ast::{
    Case, Expr, ExprTag, File, FnBody, FnKind, Func, List, Node, PatTag, PropKind, Stmt, StmtKind,
    VarDecl,
};
use bun_sema::atom::Atom;

/// What can be reached in a file.
pub(crate) struct Reach {
    /// The statements that cannot be reached.
    unreachable: Marks,
    has_unreachable: bool,
    /// The statements whose end can be reached. Not known where the analysis has answered.
    ends: Marks,
    /// The cases whose end can be reached.
    case_ends: Marks,
    /// The functions whose end can be reached.
    fn_ends: Marks,
    is_end_reachable: bool,
}

impl Reach {
    pub(super) fn new<'a>(file: &'a File<'a>, method: Method) -> Reach {
        let mut reach = Reach {
            unreachable: Marks::new(file.hir.stmts.len()),
            has_unreachable: false,
            ends: Marks::new(file.hir.stmts.len()),
            case_ends: Marks::new(file.hir.cases.len()),
            fn_ends: Marks::new(file.hir.fns.len()),
            is_end_reachable: true,
        };
        reach.is_end_reachable = is_end_reachable(Node::File(file), method, Some(&mut reach));
        file.every_func(|func| {
            if func.has_body() && is_end_reachable(Node::Func(func), method, Some(&mut reach)) {
                reach.fn_ends.add(func.id().idx());
            }
        });
        reach.has_unreachable = reach.unreachable.is_any();
        reach
    }

    #[inline]
    pub(super) fn has_unreachable(&self) -> bool {
        self.has_unreachable
    }

    #[inline]
    pub(super) fn is_reachable(&self, stmt: Stmt) -> bool {
        !self.unreachable.has(stmt.id().idx())
    }

    #[inline]
    pub(super) fn is_known_to_complete(&self, stmt: Stmt) -> bool {
        self.ends.has(stmt.id().idx())
    }

    #[inline]
    pub(super) fn is_case_end_reachable(&self, case: Case) -> bool {
        self.case_ends.has(case.id().idx())
    }

    #[inline]
    pub(super) fn is_fn_end_reachable(&self, func: Func) -> bool {
        self.fn_ends.has(func.id().idx())
    }

    #[inline]
    pub(super) fn is_file_end_reachable(&self) -> bool {
        self.is_end_reachable
    }

    /// What the analysis has found.
    pub(super) fn set_statement(&mut self, stmt: Stmt, is_reachable: bool) {
        self.unreachable.set(stmt.id().idx(), !is_reachable);
        self.ends.set(stmt.id().idx(), false);
    }

    /// What the analysis has found.
    pub(super) fn set_case_end(&mut self, case: Case, is_reachable: bool) {
        self.case_ends.set(case.id().idx(), is_reachable);
    }
}

/// How to find out.
#[derive(Copy, Clone, PartialEq, Eq)]
#[doc(hidden)]
pub enum Method {
    /// From the statements, and by the analysis only where that gives up.
    Quick,
    /// By the analysis. For comparing the two.
    Analysis,
}

/// Whether the end of the code path of `root`, which is a function or the file, can be reached.
/// Fills in `reach` for the statements and cases of that code path.
pub(super) fn is_end_reachable(root: Node, method: Method, mut reach: Option<&mut Reach>) -> bool {
    let statements = match root {
        Node::File(file) => file.body(),
        Node::Func(func) => match func.body() {
            FnBody::Block(statements) => statements,
            FnBody::Expr(_) | FnBody::None => return true,
        },
        _ => return true,
    };
    if method == Method::Quick {
        let mut quick = Quick {
            reach: reach.as_deref_mut(),
            head: 1,
            rest: 0,
            count: 1,
            tries: Vec::new(),
            targets: Vec::new(),
            label: None,
            depth: 0,
            is_generator: matches!(root, Node::Func(func) if func.is_generator()),
            has_given_up: false,
        };
        quick.statements(statements);
        if !quick.has_given_up {
            return quick.head != 0;
        }
    }
    analyzer::is_end_reachable(root, reach)
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Position {
    Try,
    Catch,
    Finally,
}

/// ESLint's `TryContext`. A fork context is `None` if it is empty, or else what `makeNext(0, -1)`
/// of it is.
struct Try {
    has_finalizer: bool,
    position: Position,
    count: u32,
    returned: Option<u64>,
    thrown: Option<u64>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Target {
    /// A labeled statement that is neither a loop nor a `switch`.
    Label,
    Switch,
    /// A loop whose `continueDestSegments` are known when its body starts.
    Loop,
    ForInOf,
    DoWhile,
}

/// ESLint's `BreakContext`, with the `LoopContext` of a loop.
struct Jumps {
    target: Target,
    label: Option<Atom>,
    count: u32,
    /// `brokenForkContext`
    broken: u64,
    /// `continueForkContext`
    continued: u64,
}

/// More nesting than this is left to the analysis, which does not recurse.
const MAX_DEPTH: u32 = 200;

/// ESLint's `CodePathState`, with a bit in the place of a segment.
struct Quick<'r> {
    reach: Option<&'r mut Reach>,
    /// `forkContext.head`: a bit for each of the `count` parallel routes.
    head: u64,
    /// The other entries of `forkContext`, joined. There are some only in a `catch` block.
    rest: u64,
    /// `forkContext.count`
    count: u32,
    tries: Vec<Try>,
    targets: Vec<Jumps>,
    /// The label of the statement that is about to be entered.
    label: Option<Atom>,
    depth: u32,
    is_generator: bool,
    has_given_up: bool,
}

/// `mergeExtraSegments`: joins the two halves of `routes` until there are `to` of them.
fn merge(mut routes: u64, mut from: u32, to: u32) -> u64 {
    while from > to {
        from /= 2;
        routes = (routes | routes >> from) & ((1 << from) - 1);
    }
    routes
}

/// `forkContext.add(routes)`
fn add(context: &mut Option<u64>, routes: u64) {
    *context = Some(context.unwrap_or(0) | routes);
}

impl<'a> Quick<'_> {
    fn statements(&mut self, statements: List<'a, Stmt<'a>>) {
        for stmt in statements {
            self.statement(stmt);
        }
    }

    #[inline]
    fn enter(&mut self, stmt: Stmt<'a>) {
        if self.head == 0
            && let Some(reach) = &mut self.reach
        {
            reach.unreachable.add(stmt.id().idx());
        }
    }

    /// What is in the head of a `for`.
    fn head_of_for(&mut self, stmt: Stmt<'a>) {
        if !stmt.is_wrapper() {
            self.enter(stmt);
        }
        self.may_throw(stmt.into());
    }

    fn statement(&mut self, stmt: Stmt<'a>) {
        if self.has_given_up {
            return;
        }
        self.enter(stmt);
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            self.has_given_up = true;
        }
        let label = self.label.take();
        match stmt.kind() {
            StmtKind::Empty | StmtKind::Debugger => {}
            StmtKind::Expr(e) => self.may_throw(e.into()),
            StmtKind::Block(statements) => self.statements(statements),
            StmtKind::Module(module) => self.statements(module.innermost().body()),
            StmtKind::Return(value) => {
                self.may_throw_if_any(value);
                self.make_return();
            }
            StmtKind::Throw(value) => {
                self.may_throw(value.into());
                self.make_throw();
            }
            StmtKind::Break(label) => self.make_break(label.map(|it| it.atom())),
            StmtKind::Continue(label) => self.make_continue(label.map(|it| it.atom())),
            StmtKind::If { test, yes, no } => {
                self.may_throw(test.into());
                let after_test = self.head;
                self.statement(yes);
                let after_yes = std::mem::replace(&mut self.head, after_test);
                if let Some(no) = no {
                    self.statement(no);
                }
                self.head |= after_yes;
            }
            StmtKind::Labeled { label, body } => {
                if is_breakable(body) {
                    self.label = Some(label.atom());
                    self.statement(body);
                } else {
                    self.push(Target::Label, Some(label.atom()));
                    self.statement(body);
                    self.head |= self.pop().broken;
                }
            }
            StmtKind::With { object, body } => {
                self.may_throw(object.into());
                self.statement(body);
            }
            StmtKind::While { test, body } => {
                self.push(Target::Loop, label);
                // `makeWhileTest` makes the next of all the entries.
                self.add_rest();
                self.may_throw(test.into());
                let after_test = self.head;
                self.statement(body);
                self.head = self.pop().broken;
                if boolean_value_if_simple_constant(test) != Some(true) {
                    self.head |= after_test;
                }
            }
            StmtKind::DoWhile { body, test } => {
                self.push(Target::DoWhile, label);
                self.statement(body);
                let jumps = self.pop();
                self.head |= jumps.continued;
                self.may_throw(test.into());
                if boolean_value_if_simple_constant(test) == Some(true) {
                    self.head = 0;
                }
                self.head |= jumps.broken;
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.push(Target::Loop, label);
                if let Some(init) = init {
                    self.head_of_for(init);
                }
                self.may_throw_if_any(test);
                self.may_throw_if_any(update);
                let before_body = self.head;
                self.statement(body);
                self.head = self.pop().broken;
                if test.is_some_and(|test| boolean_value_if_simple_constant(test) != Some(true)) {
                    self.head |= before_body;
                }
            }
            StmtKind::ForIn { left, expr, body }
            | StmtKind::ForOf {
                left, expr, body, ..
            } => {
                self.push(Target::ForInOf, label);
                self.head_of_for(left);
                self.may_throw(expr.into());
                let before_body = self.head;
                self.statement(body);
                self.head |= before_body | self.pop().broken;
            }
            StmtKind::Switch { expr, cases } => self.switch(expr, cases, label),
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => self.try_statement(block, param, handler, finalizer),
            _ => self.may_throw(stmt.into()),
        }
        self.depth -= 1;
        if self.head != 0
            && let Some(reach) = &mut self.reach
        {
            reach.ends.add(stmt.id().idx());
        }
    }

    // ── `break`, `continue`, `return`, `throw` ──

    fn push(&mut self, target: Target, label: Option<Atom>) {
        self.targets.push(Jumps {
            target,
            label,
            count: self.count,
            broken: 0,
            continued: 0,
        });
    }

    fn pop(&mut self) -> Jumps {
        self.targets.pop().unwrap_or(Jumps {
            target: Target::Label,
            label: None,
            count: 1,
            broken: 0,
            continued: 0,
        })
    }

    fn make_break(&mut self, label: Option<Atom>) {
        let jumps = self.targets.iter_mut().rev().find(|it| match label {
            Some(_) => it.label == label,
            None => it.target != Target::Label,
        });
        if let Some(jumps) = jumps {
            jumps.broken |= merge(self.head, self.count, jumps.count);
        }
        self.head = 0;
    }

    fn make_continue(&mut self, label: Option<Atom>) {
        let mut loops = (self.targets.iter_mut().rev())
            .filter(|it| !matches!(it.target, Target::Label | Target::Switch));
        let jumps = match label {
            Some(_) => loops.find(|it| it.label == label),
            None => loops.next(),
        };
        if let Some(jumps) = jumps {
            let routes = merge(self.head, self.count, jumps.count);
            match jumps.target {
                Target::ForInOf => jumps.broken |= routes,
                Target::DoWhile => jumps.continued |= routes,
                _ => {}
            }
        }
        self.head = 0;
    }

    /// `getReturnContext(this).returnedForkContext.add(routes)`
    fn add_returned(&mut self, routes: u64, count: u32) {
        let context = (self.tries.iter_mut().rev())
            .find(|it| it.has_finalizer && it.position != Position::Finally);
        if let Some(context) = context {
            add(&mut context.returned, merge(routes, count, context.count));
        }
    }

    /// `getThrowContext`
    fn throw_context(&mut self) -> Option<&mut Try> {
        self.tries.iter_mut().rev().find(|it| {
            it.position == Position::Try || it.has_finalizer && it.position == Position::Catch
        })
    }

    fn add_thrown(&mut self, routes: u64, count: u32) {
        if let Some(context) = self.throw_context() {
            add(&mut context.thrown, merge(routes, count, context.count));
        }
    }

    fn make_return(&mut self) {
        if self.head != 0 {
            self.add_returned(self.head, self.count);
            self.head = 0;
        }
    }

    fn make_throw(&mut self) {
        if self.head != 0 {
            self.add_thrown(self.head, self.count);
            self.head = 0;
        }
    }

    /// In a `catch` block, ESLint lets a `while` loop and the first `case` of a `switch` also follow
    /// the end of the `try` block. What cannot be reached from what precedes it can be reached that
    /// way: there, that the end of a statement can be reached does not tell that there is a way
    /// from its start, which is what [`Reach::is_known_to_complete`] is about.
    fn add_rest(&mut self) {
        if self.rest & !self.head != 0 && self.reach.is_some() {
            self.has_given_up = true;
        }
        self.head |= self.rest;
    }

    // ── `switch` ──

    fn switch(&mut self, expr: Expr<'a>, cases: List<'a, Case<'a>>, label: Option<Atom>) {
        self.may_throw(expr.into());
        self.push(Target::Switch, label);
        let has_case = cases.iter().any(|case| !case.is_default());
        let (tests, rest) = (self.head, self.rest);
        if has_case {
            self.add_rest();
        }
        let (mut end_of_previous, mut has_default_body) = (rest, false);
        let (mut found_empty_default, mut last_is_default) = (false, false);
        for case in cases {
            let body = case.body();
            if has_case {
                self.head = tests;
                self.may_throw_if_any(case.test());
                // `makeSwitchCaseBody`
                self.head = tests | end_of_previous;
                self.rest = 0;
                match (case.is_default(), body.is_empty()) {
                    (true, true) => found_empty_default = true,
                    (true, false) => has_default_body = true,
                    (false, false) if found_empty_default => {
                        found_empty_default = false;
                        has_default_body = true;
                    }
                    _ => {}
                }
                last_is_default = case.is_default();
            }
            self.statements(body);
            end_of_previous = self.head;
            // The rules are not told that the body of an empty case starts.
            let current = if has_case && body.is_empty() {
                tests
            } else {
                self.head
            };
            if current != 0
                && let Some(reach) = &mut self.reach
            {
                reach.case_ends.add(case.id().idx());
            }
        }
        self.rest = rest;
        // `popSwitchContext`
        self.head |= self.pop().broken;
        if has_case && !last_is_default && !has_default_body {
            self.head |= tests;
        }
    }

    // ── `try` ──

    fn try_statement(
        &mut self,
        block: Stmt<'a>,
        param: Option<VarDecl<'a>>,
        handler: Option<Stmt<'a>>,
        finalizer: Option<Stmt<'a>>,
    ) {
        // A `yield` can be left by a `return` or a `throw`, and is in an expression.
        if self.is_generator {
            self.has_given_up = true;
            return;
        }
        self.tries.push(Try {
            has_finalizer: finalizer.is_some(),
            position: Position::Try,
            count: self.count,
            returned: None,
            thrown: None,
        });
        self.statement(block);
        let rest = self.rest;
        if let (Some(handler), Some(context)) = (handler, self.tries.last_mut()) {
            // `makeCatchBlock`
            context.position = Position::Catch;
            self.rest = self.head;
            self.head |= context.thrown.take().unwrap_or(0);
            if let Some(param) = param {
                self.may_throw(param.into());
            }
            self.statement(handler);
        }
        let head_of_leaving = self.head;
        if handler.is_some() {
            // `popForkContext`
            self.head |= self.rest;
            self.rest = rest;
        }
        let Some(context) = self.tries.last_mut() else {
            return;
        };
        let Some(finalizer) = finalizer else {
            self.tries.pop();
            return;
        };
        // `makeFinallyBlock`
        context.position = Position::Finally;
        let (returned, thrown) = (context.returned, context.thrown);
        if returned.is_none() && thrown.is_none() {
            self.statement(finalizer);
            self.tries.pop();
            return;
        }
        let count = self.count;
        if 2 * count > u64::BITS {
            self.has_given_up = true;
            return;
        }
        let leaving = head_of_leaving | returned.unwrap_or(0) | thrown.unwrap_or(0);
        self.head |= leaving << count;
        self.count = 2 * count;
        self.rest = 0;
        self.statement(finalizer);
        // `popTryContext`
        self.tries.pop();
        let leaving = self.head >> count;
        self.head &= (1 << count) - 1;
        self.count = count;
        self.rest = rest;
        if returned.is_some() {
            self.add_returned(leaving, count);
        }
        if thrown.is_some() {
            self.add_thrown(leaving, count);
        }
    }

    fn may_throw_if_any(&mut self, e: Option<Expr<'a>>) {
        if let Some(e) = e {
            self.may_throw(e.into());
        }
    }

    /// `makeFirstThrowablePathInTryOrCatchBlock`, if something in `node` may throw.
    #[inline]
    fn may_throw(&mut self, node: Node<'a>) {
        if !self.tries.is_empty() && self.head != 0 {
            self.look_for_first_throwable(node);
        }
    }

    fn look_for_first_throwable(&mut self, node: Node<'a>) {
        let (head, count) = (self.head, self.count);
        let Some(context) = self.throw_context().filter(|it| it.thrown.is_none()) else {
            return;
        };
        match has_throwable(node) {
            Some(true) => context.thrown = Some(merge(head, count, context.count)),
            Some(false) => {}
            None => self.has_given_up = true,
        }
    }
}

/// Whether ESLint takes a node in `root` for one that may throw, not looking into what has a code
/// path of its own. `None` if that depends on more than is looked at here.
fn has_throwable(root: Node) -> Option<bool> {
    let mut todo = vec![root];
    let mut is_sure = true;
    while let Some(node) = todo.pop() {
        if starts_with_identifier_reference(node) {
            return Some(true);
        }
        match node {
            Node::Expr(e) => match e.tag() {
                ExprTag::Call
                | ExprTag::New
                | ExprTag::Index
                | ExprTag::ImportCall
                | ExprTag::NewTarget
                | ExprTag::ImportMeta
                | ExprTag::AsConst => return Some(true),
                ExprTag::Dot | ExprTag::Ident if e.is_jsx_tag_name() => continue,
                ExprTag::Dot => return Some(true),
                // Not in an `ArrayPattern` or a `RestElement`, which look like literals here.
                ExprTag::Ident => match e.parent() {
                    Node::Expr(parent)
                        if matches!(parent.tag(), ExprTag::Array | ExprTag::Spread) =>
                    {
                        is_sure = false;
                    }
                    Node::Prop(prop) if prop.kind() == PropKind::Spread => is_sure = false,
                    _ => return Some(true),
                },
                ExprTag::Fn => continue,
                ExprTag::Yield => is_sure = false,
                _ => {}
            },
            Node::Pat(pat) => {
                if pat.tag() == PatTag::Ident && is_binding_a_reference(pat) {
                    return Some(true);
                }
            }
            Node::Func(func) if has_code_path(func) || func.kind() == FnKind::StaticBlock => {
                continue;
            }
            Node::Member(member) if is_property_definition(member) => {
                let init = member.init().map(Node::Expr);
                node.for_each_child(|child| {
                    if Some(child) != init {
                        todo.push(child);
                    }
                });
                continue;
            }
            _ => {}
        }
        node.for_each_child(|child| todo.push(child));
    }
    is_sure.then_some(false)
}
