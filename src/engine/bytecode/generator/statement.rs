//! Statements. `completion` is where the value goes that a script or `eval` code ends with.

use bun_engine_number::exact_int32;
use bun_engine_syntax::ast::{
    BindingFlags, BindingKind, CaseId, ExprId, ExprKind, FunctionId, List, PatternId, ScopeId,
    Stmt, StmtId, StmtKind,
};
use bun_engine_syntax::{FunctionFlags, Name};
use smallvec::SmallVec;

use super::control::Exit;
use super::operator::Branch;
use super::{Dest, Generator, Suspension, Tail, This};
use crate::assembler::Label;
use crate::code::{CodeKind, HandlerKind};
use crate::operand::{DebugHook, Operand, Register, Unresolved};

const FEWEST_CASES_IN_A_TABLE: u32 = 3;

impl Generator<'_> {
    fn reset_completion(&mut self, completion: Option<Register>) {
        if let Some(completion) = completion {
            let undefined = self.undefined();
            self.asm().mov(completion, undefined);
        }
    }

    #[inline]
    fn reset_if_jumps_early(&mut self, completion: Option<Register>, body: StmtId) {
        if self.ast[body].jumps_early {
            self.reset_completion(completion);
        }
    }

    pub(super) fn statements(
        &mut self,
        list: List<StmtId>,
        completion: Option<Register>,
        end: u32,
    ) {
        let ast = self.ast;
        let outer_end = core::mem::replace(&mut self.statements_end, end);
        let last_with_value =
            completion.and_then(|_| ast.iter(list).rfind(|&it| ast[it].has_value));
        for (index, statement) in (0..).zip(ast.iter(list)) {
            if Some(statement) == last_with_value {
                self.reset_completion(completion);
            }
            if self.covers {
                self.covered_statement(statement, list.skip(index + 1), completion);
            } else {
                self.statement(statement, completion);
            }
        }
        self.statements_end = outer_end;
    }

    /// What follows a statement that control may leave, or never come back to, is a block of its own.
    #[cold]
    fn covered_statement(&mut self, id: StmtId, rest: List<StmtId>, completion: Option<Register>) {
        let (ast, suspensions) = (self.ast, self.suspensions);
        self.statement(id, completion);
        let runs_through = matches!(
            ast[id].kind,
            StmtKind::Empty
                | StmtKind::Debugger
                | StmtKind::Expression(_)
                | StmtKind::Variables(_)
                | StmtKind::Function(_)
                | StmtKind::Class(_)
                | StmtKind::ModuleItem
                | StmtKind::Export(_)
                | StmtKind::DefineField { .. }
                | StmtKind::StaticBlock { .. }
        ) || matches!(ast[id].kind, StmtKind::Block { body, .. } if body.is_empty());
        let runs_here = |it: StmtId| !matches!(ast[it].kind, StmtKind::Function(_));
        if (!runs_through || self.suspensions != suspensions) && ast.iter(rest).any(runs_here) {
            self.cover(ast[id].end, self.statements_end);
        }
    }

    pub(super) fn statement(&mut self, id: StmtId, completion: Option<Register>) {
        if !self.can_recurse() {
            return;
        }
        let node = &self.ast[id];
        if self.debugs
            && node.pause
            && !matches!(node.kind, StmtKind::Debugger | StmtKind::StaticBlock { .. })
        {
            self.debug_hook(DebugHook::WillExecuteStatement, node.start);
        }
        let mark = self.top;
        match node.kind {
            StmtKind::Empty | StmtKind::ModuleItem => {}
            StmtKind::Debugger => self.debug_hook(DebugHook::DidReachDebuggerStatement, node.start),
            StmtKind::Expression(expression) => match completion {
                Some(completion) => _ = self.expr(expression, Dest::Local(completion)),
                None => self.effect(expression),
            },
            StmtKind::Variables(expression) | StmtKind::Class(expression) => {
                self.effect(expression);
            }
            StmtKind::Block { body, scope } => self.block(node, body, scope, completion),
            StmtKind::Function(function) => self.hoist_function(function, node.start),
            StmtKind::If { .. } => self.if_statement(id, completion),
            StmtKind::Return(value) => self.return_statement(node.start, value),
            StmtKind::DoWhile { body, test } => self.do_while(node, body, test, completion),
            StmtKind::While {
                test,
                body,
                test_has_closure,
            } => {
                self.reset_if_jumps_early(completion, body);
                let test = Some((test, test_has_closure));
                self.test_first_loop(test, None, body, None, completion);
            }
            StmtKind::For { .. } => self.for_statement(node, completion),
            StmtKind::ForIn(ref it) => {
                self.reset_if_jumps_early(completion, it.body);
                self.for_in(it, completion);
            }
            StmtKind::ForOf(ref it) => {
                self.reset_if_jumps_early(completion, it.body);
                self.for_of(it, completion);
            }
            StmtKind::ForAwait(ref it) => {
                self.reset_if_jumps_early(completion, it.body);
                self.for_await(it, completion);
            }
            StmtKind::Continue(label) => {
                if let Some(target) = self.continue_target(label) {
                    self.exit(Exit::Jump(target));
                }
            }
            StmtKind::Break(label) => {
                if let Some(target) = self.break_target(label) {
                    self.exit(Exit::Jump(target));
                }
            }
            StmtKind::With {
                object,
                body,
                object_start,
                object_end,
            } => {
                let object = self.expr(object, Dest::Any);
                self.position(object_end, object_start, object_end);
                self.enter_with_scope(object);
                self.reset_if_jumps_early(completion, body);
                self.statement(body, completion);
                self.close_scope();
            }
            StmtKind::Switch {
                discriminant,
                cases,
                scope,
            } => self.switch(discriminant, cases, scope, completion),
            StmtKind::Labeled { .. } => self.labeled(id, completion),
            StmtKind::Throw { value, end } => {
                let value = self.expr(value, Dest::Any);
                self.position(end, node.start, end);
                self.asm().throw(value);
            }
            StmtKind::Try { .. } => self.try_statement(node, completion),
            StmtKind::Export(declaration) => self.statement(declaration, None),
            StmtKind::DefineField { index, key, value } => {
                self.define_field(node.start, index, key, value);
            }
            StmtKind::StaticBlock { function } => self.run_static_block(node, function),
        }
        self.top = mark;
    }

    #[inline(never)]
    fn block(
        &mut self,
        node: &Stmt,
        body: List<StmtId>,
        scope: Option<ScopeId>,
        completion: Option<Register>,
    ) {
        let end = node.end.min(self.statements_end);
        let Some(id) = scope else {
            return self.statements(body, completion, end);
        };
        self.enter_block_scope(id);
        self.with_disposal(scope, |generator| {
            generator.statements(body, completion, end);
        });
        self.close_scope();
    }

    #[inline(never)]
    fn labeled(&mut self, mut id: StmtId, completion: Option<Register>) {
        let (first, on_break) = (self.b.labels.len(), self.asm().label());
        while let StmtKind::Labeled { label, body } = self.ast[id].kind {
            self.open_label(label, on_break);
            id = body;
        }
        self.first_label_of_loop = first;
        self.statement(id, completion);
        self.b.labels.truncate(first);
        self.asm().bind(on_break);
    }

    /// The statements of a function, which tell when `this` comes to be bound.
    pub(super) fn constructor_body(&mut self, list: List<StmtId>) {
        let ast = self.ast;
        for statement in ast.iter(list) {
            self.statement(statement, None);
            if let StmtKind::Expression(expression) = ast[statement].kind
                && let ExprKind::Call { callee, .. } = ast[expression].kind
                && self.is_super(callee)
                && let This::Unbound(this) | This::UnboundInScope(this) = self.this
            {
                self.this = This::Register(this);
            }
        }
    }

    #[inline(never)]
    fn hoist_function(&mut self, function: FunctionId, position: u32) {
        let node = &self.ast[function];
        if !node.flags.contains(FunctionFlags::HOISTED_AS_VARIABLE) {
            return;
        }
        let name = self.declared_name(function);
        let variable = self.resolve(name, position);
        let value = self.load(&variable, None, Dest::Any, Unresolved::Throw);
        if let CodeKind::Script | CodeKind::Eval = self.kind {
            let (value, name) = (self.in_register(value), self.identifier(name));
            self.asm().put_hoisted(Register::SCOPE, name, value);
        } else {
            let place = self.place_below_lexicals(name);
            self.put(place, name, None, value);
        }
    }

    /// Where `if (..) break;` jumps, if that is all there is to it.
    fn jump_only(&mut self, mut id: StmtId) -> Option<Label> {
        if self.debugs || self.covers {
            return None;
        }
        if let StmtKind::Block { body, .. } = self.ast[id].kind
            && body.len() == 1
        {
            id = self.ast.at(body, 0);
        }
        let target = match self.ast[id].kind {
            StmtKind::Break(label) => self.break_target(label)?,
            StmtKind::Continue(label) => self.continue_target(label)?,
            _ => return None,
        };
        self.plain_jump(target)
    }

    #[inline(never)]
    fn if_statement(&mut self, mut id: StmtId, completion: Option<Register>) {
        let (ast, done) = (self.ast, self.asm().label());
        while let StmtKind::If {
            test,
            consequent,
            alternate,
        } = ast[id].kind
        {
            if ast[consequent].jumps_early || alternate.is_some_and(|it| ast[it].jumps_early) {
                self.reset_completion(completion);
            }
            if let Some(target) = self.jump_only(consequent) {
                self.enter_if_false(test, target);
            } else {
                let otherwise = match alternate {
                    Some(_) => self.asm().label(),
                    None => done,
                };
                self.enter_if_true(test, otherwise);
                self.cover(ast[consequent].start, ast[consequent].end);
                self.statement(consequent, completion);
                if alternate.is_some() {
                    self.asm().jump(done);
                    self.asm().bind(otherwise);
                }
            }
            let Some(alternate) = alternate else {
                break;
            };
            self.cover(ast[consequent].end, ast[alternate].end);
            if !matches!(ast[alternate].kind, StmtKind::If { .. }) {
                self.statement(alternate, completion);
                break;
            }
            id = alternate;
        }
        self.asm().bind(done);
    }

    fn allows_tail_calls(&self) -> bool {
        self.kind == CodeKind::Call
            && self.function_flags.contains(FunctionFlags::STRICT)
            && self.suspension == Suspension::None
            && self.tail_blockers == 0
    }

    #[inline(never)]
    fn return_statement(&mut self, start: u32, value: Option<ExprId>) {
        let value = match value {
            None => self.undefined(),
            Some(value) if self.allows_tail_calls() => self.expr_in(value, Dest::Any, Tail::Yes),
            Some(value) if self.suspension == Suspension::AsyncGenerator => {
                let result = self.temp();
                let value = self.expr(value, Dest::Prefer(result));
                self.await_value(result, value, start);
                result.into()
            }
            Some(value) => self.expr(value, self.return_dest()),
        };
        self.exit(Exit::Return(value));
    }

    // Loops

    #[inline(never)]
    fn do_while(&mut self, node: &Stmt, body: StmtId, test: ExprId, completion: Option<Register>) {
        self.reset_if_jumps_early(completion, body);
        let [top, on_continue, on_break] = core::array::from_fn(|_| self.asm().label());
        self.asm().bind_loop_head(top);
        self.asm().loop_hint();
        self.plain_loop_body(body, on_break, on_continue, completion);
        self.cover(self.ast[body].end, node.end);
        let branch = Branch {
            if_true: top,
            if_false: on_break,
            falls_to: false,
        };
        self.condition(test, branch);
        self.asm().bind(on_break);
    }

    fn plain_loop_body(
        &mut self,
        body: StmtId,
        on_break: Label,
        on_continue: Label,
        completion: Option<Register>,
    ) {
        self.cover(self.ast[body].start, self.ast[body].end);
        let outer = self.enter_loop(on_break, on_continue);
        self.statement(body, completion);
        self.targets = outer;
        self.asm().bind(on_continue);
    }

    /// The test comes twice, so that a turn takes one jump, unless its flag says that there is a closure in it.
    #[inline(never)]
    fn test_first_loop(
        &mut self,
        test: Option<(ExprId, bool)>,
        update: Option<ExprId>,
        body: StmtId,
        copied_scope: Option<Register>,
        completion: Option<Register>,
    ) {
        let [top, on_continue, on_break] = core::array::from_fn(|_| self.asm().label());
        let (repeated, once) = match test {
            Some((test, false)) => (Some(test), None),
            _ => (None, test.map(|it| it.0)),
        };
        self.enter_loop_if(repeated, on_break);
        self.asm().bind_loop_head(top);
        self.asm().loop_hint();
        self.enter_loop_if(once, on_break);
        self.plain_loop_body(body, on_break, on_continue, completion);
        if let Some(scope) = copied_scope {
            self.asm().copy_scope(scope);
        }
        self.cover_loop_header(update);
        if let Some(update) = update {
            self.effect(update);
        }
        self.cover_loop_header(repeated);
        match repeated {
            Some(test) => {
                let branch = Branch {
                    if_true: top,
                    if_false: on_break,
                    falls_to: false,
                };
                self.condition(test, branch);
            }
            None => self.asm().jump(top),
        }
        self.asm().bind(on_break);
    }

    fn enter_loop_if(&mut self, test: Option<ExprId>, on_break: Label) {
        self.cover_loop_header(test);
        if let Some(test) = test {
            self.enter_if_true(test, on_break);
        }
    }

    #[inline(never)]
    fn for_statement(&mut self, node: &Stmt, completion: Option<Register>) {
        let StmtKind::For {
            init,
            test,
            update,
            body,
            scope,
            init_has_closure,
            test_has_closure,
        } = node.kind
        else {
            return;
        };
        self.reset_if_jumps_early(completion, body);
        let mut copied_scope = None;
        if let Some(scope) = scope {
            self.enter_block_scope(scope);
            let is_per_turn = self.ast.bindings(scope).iter().any(|binding| {
                binding.kind == BindingKind::Let && binding.flags.contains(BindingFlags::CAPTURED)
            });
            copied_scope = is_per_turn.then_some(self.scope);
        }
        self.with_disposal(scope, |generator| {
            if let Some(init) = init {
                generator.effect(init);
            }
            if let Some(scope) = copied_scope.filter(|_| init_has_closure) {
                generator.asm().copy_scope(scope);
            }
            let test = test.map(|test| (test, test_has_closure));
            generator.test_first_loop(test, update, body, copied_scope, completion);
        });
        if scope.is_some() {
            self.close_scope();
        }
    }

    // `switch`

    #[inline(never)]
    fn switch(
        &mut self,
        discriminant: ExprId,
        cases: List<CaseId>,
        scope: Option<ScopeId>,
        completion: Option<Register>,
    ) {
        let ast = self.ast;
        self.reset_completion(completion);
        let tests = || ast.iter(cases).filter_map(|case| ast[case].test);
        let tests_assign = tests().any(|test| self.may_assign(test));
        let value = self.stable_expr(discriminant, tests_assign);
        if let Some(scope) = scope {
            self.enter_block_scope(scope);
        }
        let on_break = self.asm().label();
        let labels: SmallVec<[Label; 16]> = ast.iter(cases).map(|_| self.asm().label()).collect();
        let default = (ast.iter(cases).position(|case| ast[case].test.is_none()))
            .map_or(on_break, |index| labels[index]);
        if !self.switch_by_table(value, cases, &labels, default) {
            let was_in_case_test = core::mem::replace(&mut self.is_in_case_test, true);
            for (case, &label) in ast.iter(cases).zip(&labels) {
                if let Some(test) = ast[case].test {
                    let mark = self.top;
                    let test = self.expr(test, Dest::Any);
                    if self.has_identity(test) {
                        self.asm().jump_if_identical(test, value, label);
                    } else {
                        self.asm().jump_if_strict_equal(test, value, label);
                    }
                    self.top = mark;
                }
            }
            self.is_in_case_test = was_in_case_test;
            self.asm().jump(default);
        }
        let outer = self.enter_switch(on_break);
        for (case, &label) in ast.iter(cases).zip(&labels) {
            let case = &ast[case];
            self.asm().bind(label);
            self.cover(case.start, case.end);
            self.statements(case.body, completion, case.end);
        }
        self.targets = outer;
        if scope.is_some() {
            self.close_scope();
        }
        self.asm().bind(on_break);
    }

    #[inline(never)]
    fn switch_by_table(
        &mut self,
        value: Operand,
        cases: List<CaseId>,
        labels: &[Label],
        default: Label,
    ) -> bool {
        let ast = self.ast;
        let tests = || {
            (ast.iter(cases).zip(labels))
                .filter_map(|(case, &label)| Some((ast[ast[case].test?].kind, label)))
        };
        if (tests().count() as u32) < FEWEST_CASES_IN_A_TABLE {
            return false;
        }
        let integers = tests().map(|(test, label)| match test {
            ExprKind::Number { value, .. } => Some((exact_int32(value.get() + 0.0)?, label)),
            _ => None,
        });
        if let Some(integers) = integers.collect::<Option<SmallVec<[_; 16]>>>() {
            let table = self.asm().add_int_switch(default, &integers);
            self.asm().switch_int(value, table);
            return true;
        }
        let strings = tests().map(|(test, label)| match test {
            ExprKind::String(name) => Some((name, label)),
            _ => None,
        });
        let Some(strings) = strings.collect::<Option<SmallVec<[(Name, Label); 16]>>>() else {
            return false;
        };
        if strings.iter().all(|&(name, _)| self.name_length(name) == 1) {
            let units: SmallVec<[_; 16]> = (strings.iter())
                .map(|&(name, label)| (i32::from(self.text_of(name).at(0)), label))
                .collect();
            let table = self.asm().add_int_switch(default, &units);
            self.asm().switch_char(value, table);
            return true;
        }
        let keys = strings.iter().map(|&(name, _)| self.atom(name)).collect();
        self.b.string_switches.push(keys);
        let targets: SmallVec<[_; 16]> = strings.iter().map(|&(_, label)| label).collect();
        let table = self.asm().add_string_switch(default, &targets);
        self.asm().switch_string(value, table);
        true
    }

    // `try`

    #[inline(never)]
    fn try_statement(&mut self, node: &Stmt, completion: Option<Register>) {
        let StmtKind::Try {
            block,
            parameter,
            parameter_scope,
            handler,
            finalizer,
        } = node.kind
        else {
            return;
        };
        let Some(finalizer) = finalizer else {
            self.reset_if_jumps_early(completion, block);
            let done = self.asm().label();
            self.try_catch(block, parameter, parameter_scope, handler, completion, done);
            return self.asm().bind(done);
        };
        let inner_completion = completion.map(|_| self.temp());
        self.reset_completion(inner_completion);
        let (entry, on_throw) = (self.open_finally(), self.asm().label());
        self.asm().push_try(on_throw, HandlerKind::Finally);
        self.try_catch(
            block,
            parameter,
            parameter_scope,
            handler,
            inner_completion,
            entry,
        );
        self.asm().pop_try();
        let thrown = self.temp();
        let Some(finally) = self.enter_finally(on_throw, thrown) else {
            return;
        };
        let before = &self.ast[handler.unwrap_or(block)];
        self.cover(before.end, self.ast[finalizer].end);
        self.reset_if_jumps_early(completion, finalizer);
        self.statement(finalizer, completion);
        if let (Some(completion), Some(inner)) = (completion, inner_completion) {
            self.asm().mov(completion, inner);
        }
        self.leave_finally(&finally);
    }

    fn try_catch(
        &mut self,
        block: StmtId,
        parameter: Option<PatternId>,
        parameter_scope: Option<ScopeId>,
        handler: Option<StmtId>,
        completion: Option<Register>,
        done: Label,
    ) {
        let Some(handler) = handler else {
            return self.statement(block, completion);
        };
        let on_throw = self.asm().label();
        self.asm().push_try(on_throw, HandlerKind::Catch);
        self.tail_blockers += 1;
        self.statement(block, completion);
        self.tail_blockers -= 1;
        self.asm().pop_try();
        self.asm().jump(done);
        self.asm().bind(on_throw);
        let (mark, value) = (self.top, self.temp());
        let exception = self.temp();
        self.asm().catch(exception, value);
        self.top -= 1;
        let catch = self.asm().last();
        let scope = parameter.and(parameter_scope);
        if let Some(scope) = scope {
            self.enter_catch_scope(scope);
        }
        if let Some(parameter) = parameter {
            match (self.resolve_pattern_register(parameter), catch) {
                (Some(register), Some((site, _))) => {
                    use crate::operand::Field;
                    self.asm().set_operand(site, 0, value.word());
                    self.asm().set_operand(site, 1, register.word());
                }
                _ => self.bind_pattern(parameter, value.into()),
            }
        }
        self.cover(self.ast[block].end, self.ast[handler].end);
        self.reset_completion(completion);
        self.statement(handler, completion);
        if scope.is_some() {
            self.close_scope();
        }
        self.top = mark;
    }
}
