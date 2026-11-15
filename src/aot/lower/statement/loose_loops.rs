use bun_sema::atom::known;
use bun_sema::bind::{Binding, BindingInitializer, CodeUnit, Decl, Parent, SymbolId};
use bun_sema::fold::Constant;
use bun_sema::hir::{
    BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, IdList, MemberKey, PatId, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind,
};
use smallvec::{SmallVec, smallvec};

use crate::ir::{Edge, TypeTable, ValueId, WellKnownSymbol};
use crate::lower::expression::find_constant;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Clone, Debug)]
pub(in crate::lower) struct LooseLoop {
    statement: StmtId,
    call: ExprId,
    iterated: ExprId,
    reads: SmallVec<[ExprId; 2]>,
    closing: Option<ClosingCalls>,
    passed: ExprId,
    opening: LoopOpening,
    element: Option<ValueId>,
}

#[derive(Copy, Clone, Debug)]
struct ClosingCalls {
    start: ExprId,
    fail: ExprId,
    finish: ExprId,
}

#[derive(Copy, Clone, Debug)]
enum LoopOpening {
    Ahead,
    Begun,
    Given(ValueId),
    Done(ValueId),
}

impl LoopOpening {
    fn given(self) -> Option<ValueId> {
        match self {
            LoopOpening::Given(given) => Some(given),
            LoopOpening::Ahead | LoopOpening::Begun | LoopOpening::Done(_) => None,
        }
    }

    fn list(self) -> Option<ValueId> {
        match self {
            LoopOpening::Done(list) => Some(list),
            LoopOpening::Ahead | LoopOpening::Begun | LoopOpening::Given(_) => None,
        }
    }
}

#[derive(Copy, Clone, Debug)]
struct TestOfLooseLoop {
    target: ExprId,
    stepping: ExprId,
}

type InitialValues = SmallVec<[(SymbolId, Option<bool>); 4]>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum LoopHelper {
    Loose,
    Closing,
}

impl FileLowering<'_, '_, '_, '_> {
    fn read_method_call(
        &self,
        call: ExprId,
    ) -> Option<(ExprId, bun_sema::atom::Atom, SmallVec<[ExprId; 2]>)> {
        let hir = self.hir;
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        let (object, MemberKey::Name(name)) = hir.member_key(site.callee)? else {
            return None;
        };
        let is_plain = site.chain == Chain::No
            && matches!(
                hir[site.callee].kind,
                ExprKind::Dot {
                    chain: Chain::No,
                    ..
                }
            );
        is_plain.then(|| (object, name, hir.ids(site.args).collect()))
    }

    fn is_name_of(&self, name: ExprId, symbol: SymbolId) -> bool {
        self.symbol_named_by(name) == Some(symbol)
    }

    fn only_statement(&self, statement: StmtId) -> StmtId {
        match self.hir[statement].kind {
            StmtKind::Block(statements) if statements.len() == 1 => self.hir.id_at(statements, 0),
            _ => statement,
        }
    }

    fn read_sequence(&self, statements: IdList<StmtId>) -> Option<SmallVec<[ExprId; 4]>> {
        let hir = self.hir;
        let mut found = SmallVec::new();
        let count = statements.len();
        for (place, statement) in hir.ids(statements).enumerate() {
            let expression = match hir[statement].kind {
                StmtKind::Expr(expression) => expression,
                StmtKind::Return(returned) if place + 1 == count && returned.is_some() => returned,
                _ => return None,
            };
            let mut parts: SmallVec<[ExprId; 4]> = SmallVec::new();
            let mut rest = expression;
            while let ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } = hir[rest].kind
            {
                parts.push(right);
                rest = left;
            }
            parts.push(rest);
            found.extend(parts.into_iter().rev());
        }
        Some(found)
    }

    fn read_assignment(&self, expression: ExprId) -> Option<(SymbolId, ExprId)> {
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = self.hir[expression].kind
        else {
            return None;
        };
        Some((self.symbol_named_by(target)?, value))
    }

    fn is_true(&self, expression: ExprId) -> bool {
        find_constant(self, expression) == Some(Constant::Boolean(true))
    }

    fn read_head_of_loop_helper(&mut self, function: FnId) -> Option<(SymbolId, SymbolId)> {
        let (hir, bound) = (self.hir, self.bound);
        let node = hir[function];
        let FnBody::Block(statements) = node.body else {
            return None;
        };
        if !matches!(node.kind, FnKind::Decl | FnKind::Expr)
            || node.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return None;
        }
        let is_plain = node.params.iter().map(|it| hir[it]).all(|it| {
            it.default.is_none()
                && !it.flags.contains(Flags::REST)
                && matches!(hir[it.pat].kind, PatKind::Ident(_))
        });
        let parameter = hir[node.params.iter().next()?];
        if !is_plain {
            return None;
        }
        let Binding::Symbol(list) = bound.initialized_binding(parameter.pat) else {
            return None;
        };
        let StmtKind::Var(declarations) = hir[hir.ids(statements).next()?].kind else {
            return None;
        };
        let mut declarations = declarations.iter();
        let (Some(declaration), None) = (declarations.next(), declarations.next()) else {
            return None;
        };
        let declaration = hir[declaration];
        let Binding::Symbol(method) = bound.initialized_binding(declaration.pat) else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::Or,
            left,
            ..
        } = hir[declaration.init.some()?].kind
        else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::And,
            left: guard,
            right: read,
        } = hir[left].kind
        else {
            return None;
        };
        let ExprKind::Binary {
            op: BinOp::NotEq | BinOp::NotEqEq,
            left: one,
            right: other,
        } = hir[guard].kind
        else {
            return None;
        };
        let asks_for_symbol = [(one, other), (other, one)].into_iter().any(|(text, asked)| {
            matches!(hir[text].kind, ExprKind::String(known::undefined))
                && matches!(
                    hir[asked].kind,
                    ExprKind::Unary { op: UnOp::Typeof, operand } if self.is_free_name(operand, b"Symbol")
                )
        });
        let ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } = hir[read].kind
        else {
            return None;
        };
        let iterator_key = self.symbol_key(WellKnownSymbol::Iterator);
        let reads_iterator =
            self.is_name_of(obj, list) && self.find_locked_symbol_key(index) == Some(iterator_key);
        (asks_for_symbol && reads_iterator).then_some((list, method))
    }

    fn is_free_name(&self, name: ExprId, spelling: &[u8]) -> bool {
        let atoms = &self.queries.files().atoms;
        matches!(self.hir[name].kind, ExprKind::Ident(it) if atoms.bytes(it) == spelling)
            && self.bound.binding(name) == Binding::Free
    }

    fn is_rest_of_loop_helper(&self, statements: &[StmtId], list: SymbolId) -> bool {
        let hir = self.hir;
        let (fallback, thrown) = match *statements {
            [thrown] => (None, thrown),
            [fallback, thrown] => (Some(fallback), thrown),
            _ => return false,
        };
        let throws_type_error = match hir[thrown].kind {
            StmtKind::Throw(error) => matches!(
                hir[error].kind,
                ExprKind::New(site) if self.is_free_name(hir[site].callee, b"TypeError")
            ),
            _ => false,
        };
        let is_for_arrays = fallback.is_none_or(|fallback| {
            let StmtKind::If { test, no, .. } = hir[fallback].kind else {
                return false;
            };
            let mut first = test;
            while let ExprKind::Binary {
                op: BinOp::Or,
                left,
                ..
            } = hir[first].kind
            {
                first = left;
            }
            let Some((object, method, arguments)) = self.read_method_call(first) else {
                return false;
            };
            no.is_none()
                && self.queries.files().atoms.bytes(method) == b"isArray"
                && self.is_free_name(object, b"Array")
                && matches!(arguments[..], [it] if self.is_name_of(it, list))
        });
        throws_type_error && is_for_arrays
    }

    fn is_loose_iteration_helper(&mut self, function: FnId) -> bool {
        let Some((list, method)) = self.read_head_of_loop_helper(function) else {
            return false;
        };
        let hir = self.hir;
        let FnBody::Block(statements) = hir[function].body else {
            return false;
        };
        let statements: SmallVec<[StmtId; 8]> = hir.ids(statements).collect();
        let [_, second, ref rest @ ..] = statements[..] else {
            return false;
        };
        let StmtKind::If { test, yes, no } = hir[second].kind else {
            return false;
        };
        if !self.is_rest_of_loop_helper(rest, list) {
            return false;
        }
        let StmtKind::Return(returned) = hir[self.only_statement(yes)].kind else {
            return false;
        };
        if !self.is_name_of(test, method) || no.is_some() || !returned.is_some() {
            return false;
        }
        let Some((next, known::bind, bound_to)) = self.read_method_call(returned) else {
            return false;
        };
        let ExprKind::Dot {
            obj: assignment,
            name: known::next,
            chain: Chain::No,
            ..
        } = hir[next].kind
        else {
            return false;
        };
        let Some((target, value)) = self.read_assignment(assignment) else {
            return false;
        };
        target == method
            && matches!(bound_to[..], [it] if self.is_name_of(it, method))
            && self.calls_iterator_method(value, method, list)
    }

    fn calls_iterator_method(&self, call: ExprId, method: SymbolId, list: SymbolId) -> bool {
        let Some((called, known::call, receivers)) = self.read_method_call(call) else {
            return false;
        };
        self.is_name_of(called, method)
            && matches!(receivers[..], [it] if self.is_name_of(it, list))
    }

    fn is_closing_iteration_helper(&mut self, function: FnId) -> bool {
        let Some((list, iterator)) = self.read_head_of_loop_helper(function) else {
            return false;
        };
        let hir = self.hir;
        let FnBody::Block(statements) = hir[function].body else {
            return false;
        };
        let mut rest = hir.ids(statements).skip(1);
        let is_missing = rest.next().is_some_and(|second| match hir[second].kind {
            StmtKind::If { test, yes, no } => {
                let statements: SmallVec<[StmtId; 4]> = match hir[yes].kind {
                    StmtKind::Block(statements) => hir.ids(statements).collect(),
                    _ => smallvec![yes],
                };
                no.is_none()
                    && matches!(hir[test].kind, ExprKind::Unary { op: UnOp::Not, operand } if self.is_name_of(operand, iterator))
                    && self.is_rest_of_loop_helper(&statements, list)
            }
            _ => false,
        });
        if !is_missing {
            return false;
        }
        let mut returned = None;
        let mut variables = InitialValues::new();
        for statement in rest {
            match hir[statement].kind {
                StmtKind::Var(declarations) if returned.is_none() => {
                    for declaration in declarations.iter().map(|it| hir[it]) {
                        let value = match declaration.init.some().map(|it| find_constant(self, it))
                        {
                            None => None,
                            Some(Some(Constant::Boolean(value))) => Some(value),
                            Some(_) => return false,
                        };
                        let Some(variable) = self
                            .bound
                            .declared_symbol(Decl::Var(declaration.pat))
                            .some()
                        else {
                            return false;
                        };
                        if [list, iterator].contains(&variable)
                            || variables.iter().any(|it| it.0 == variable)
                        {
                            return false;
                        }
                        variables.push((variable, value));
                    }
                }
                StmtKind::Return(value) if returned.is_none() && value.is_some() => {
                    returned = Some(value)
                }
                _ => return false,
            }
        }
        returned.is_some_and(|it| self.is_closing_iterator(it, iterator, list, &variables))
    }

    fn is_closing_iterator(
        &self,
        literal: ExprId,
        iterator: SymbolId,
        list: SymbolId,
        variables: &[(SymbolId, Option<bool>)],
    ) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let atoms = &self.queries.files().atoms;
        let mut functions: [Option<FnId>; 4] = [None; 4];
        for property in properties.iter() {
            let property = hir[property];
            let (PropKind::Init | PropKind::Method, PropKey::Name(name)) =
                (property.kind, property.key)
            else {
                return false;
            };
            let Some(place) = [b"s", b"n", b"e", b"f"]
                .iter()
                .position(|it| atoms.bytes(name) == &it[..])
            else {
                return false;
            };
            let ExprKind::Fn(function) = hir[property.value].kind else {
                return false;
            };
            functions[place] = Some(function);
        }
        let [Some(start), Some(next), Some(fail), Some(finish)] = functions else {
            return false;
        };
        let statements_of = |function: FnId, parameters: usize| match hir[function].body {
            FnBody::Block(statements)
                if hir[function].params.len() == parameters
                    && !hir[function]
                        .flags
                        .intersects(Flags::ASYNC | Flags::GENERATOR) =>
            {
                Some(statements)
            }
            _ => None,
        };
        let (Some(start), Some(next), Some(fail_body), Some(finish)) = (
            statements_of(start, 0),
            statements_of(next, 0),
            statements_of(fail, 1),
            statements_of(finish, 0),
        ) else {
            return false;
        };
        let starts = self
            .read_sequence(start)
            .is_some_and(|parts| match parts[..] {
                [only] => self.read_assignment(only).is_some_and(|(target, value)| {
                    target == iterator && self.calls_iterator_method(value, iterator, list)
                }),
                _ => false,
            });
        let mut next = hir.ids(next);
        let stepped = next.next().and_then(|first| {
            let StmtKind::Var(declarations) = hir[first].kind else {
                return None;
            };
            let mut declarations = declarations.iter();
            let (declaration, None) = (hir[declarations.next()?], declarations.next()) else {
                return None;
            };
            let (stepped, known::next, arguments) =
                self.read_method_call(declaration.init.some()?)?
            else {
                return None;
            };
            let Binding::Symbol(step) = bound.initialized_binding(declaration.pat) else {
                return None;
            };
            (self.is_name_of(stepped, iterator) && arguments.is_empty()).then_some(step)
        });
        let Some(step) = stepped else {
            return false;
        };
        let mut parts: SmallVec<[ExprId; 4]> = SmallVec::new();
        for statement in next {
            let expression = match hir[statement].kind {
                StmtKind::Expr(it) => it,
                StmtKind::Return(it) if it.is_some() => it,
                _ => return false,
            };
            match hir[expression].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    right,
                } => parts.extend([left, right]),
                _ => parts.push(expression),
            }
        }
        let [noted, returned] = parts[..] else {
            return false;
        };
        let completed =
            self.read_assignment(noted)
                .and_then(|(target, value)| match hir[value].kind {
                    ExprKind::Dot {
                        obj,
                        name: known::done,
                        chain: Chain::No,
                        ..
                    } if self.is_name_of(obj, step) => Some(target),
                    _ => None,
                });
        let Some(completed) = completed else {
            return false;
        };
        if !starts || !self.is_name_of(returned, step) {
            return false;
        }
        let Some(parameter) = hir[fail].params.iter().next().map(|it| hir[it]) else {
            return false;
        };
        let Binding::Symbol(thrown) = bound.initialized_binding(parameter.pat) else {
            return false;
        };
        if parameter.default.is_some()
            || parameter.flags.contains(Flags::REST)
            || !matches!(hir[parameter.pat].kind, PatKind::Ident(_))
        {
            return false;
        }
        let Some(parts) = self.read_sequence(fail_body) else {
            return false;
        };
        let [failing, keeping] = parts[..] else {
            return false;
        };
        let (Some((failed, value)), Some((error, kept))) =
            (self.read_assignment(failing), self.read_assignment(keeping))
        else {
            return false;
        };
        if !self.is_true(value)
            || !self.is_name_of(kept, thrown)
            || failed == error
            || [failed, error].contains(&completed)
        {
            return false;
        }
        let is_own = |variable: SymbolId| variables.iter().any(|it| it.0 == variable);
        if !variables.contains(&(failed, Some(false))) || !is_own(error) || !is_own(completed) {
            return false;
        }
        let mut finish = hir.ids(finish);
        let (Some(only), None) = (finish.next(), finish.next()) else {
            return false;
        };
        let StmtKind::Try {
            block,
            param: _,
            handler,
            finalizer,
        } = hir[only].kind
        else {
            return false;
        };
        if handler.is_some() || finalizer.is_none() {
            return false;
        }
        let StmtKind::If { test, yes, no } = hir[self.only_statement(finalizer)].kind else {
            return false;
        };
        let StmtKind::Throw(rethrown) = hir[self.only_statement(yes)].kind else {
            return false;
        };
        self.is_name_of(test, failed)
            && no.is_none()
            && self.is_name_of(rethrown, error)
            && self.closes_iterator(self.only_statement(block), iterator, completed)
    }

    fn closes_iterator(&self, statement: StmtId, iterator: SymbolId, completed: SymbolId) -> bool {
        let hir = self.hir;
        let atoms = &self.queries.files().atoms;
        let reads_return = |read: ExprId| {
            matches!(
                hir[read].kind,
                ExprKind::Dot { obj, name, chain: Chain::No, .. }
                    if self.is_name_of(obj, iterator) && atoms.bytes(name) == b"return"
            )
        };
        let calls_return = |call: ExprId| match hir[call].kind {
            ExprKind::Call(site) => {
                let site = hir[site];
                site.chain == Chain::No && site.args.is_empty() && reads_return(site.callee)
            }
            _ => false,
        };
        let compares = |test: ExprId, wanted: BinOp| match hir[test].kind {
            ExprKind::Binary { op, left, right } if op == wanted => [(left, right), (right, left)]
                .into_iter()
                .any(|(null, read)| matches!(hir[null].kind, ExprKind::Null) && reads_return(read)),
            _ => false,
        };
        match hir[statement].kind {
            StmtKind::Expr(expression) => {
                let ExprKind::Binary {
                    op: BinOp::Or,
                    left,
                    right,
                } = hir[expression].kind
                else {
                    return false;
                };
                let ExprKind::Binary {
                    op: BinOp::Or,
                    left: done,
                    right: has_none,
                } = hir[left].kind
                else {
                    return false;
                };
                self.is_name_of(done, completed)
                    && compares(has_none, BinOp::EqEq)
                    && calls_return(right)
            }
            StmtKind::If { test, yes, no } => {
                let ExprKind::Binary {
                    op: BinOp::And,
                    left,
                    right,
                } = hir[test].kind
                else {
                    return false;
                };
                let StmtKind::Expr(called) = hir[self.only_statement(yes)].kind else {
                    return false;
                };
                no.is_none()
                    && matches!(hir[left].kind, ExprKind::Unary { op: UnOp::Not, operand } if self.is_name_of(operand, completed))
                    && compares(right, BinOp::NotEq)
                    && calls_return(called)
            }
            _ => false,
        }
    }

    fn is_plain_read_of_value(&self, read: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        if !matches!(
            hir[read].kind,
            ExprKind::Dot {
                name: known::value,
                chain: Chain::No,
                ..
            }
        ) {
            return false;
        }
        match bound.parent_of_expr(read) {
            Parent::VarInit(_) => true,
            Parent::Expr(user) => user.some().is_some_and(|user| match hir[user].kind {
                ExprKind::Call(site) | ExprKind::New(site) => hir[site].callee != read,
                ExprKind::Dot {
                    obj,
                    chain: Chain::No,
                    ..
                } => obj == read,
                ExprKind::Assign {
                    op: None, value, ..
                } => value == read,
                ExprKind::Binary { .. } => true,
                _ => false,
            }),
            _ => false,
        }
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn read_test_of_loose_loop(&mut self, statement: StmtId) -> Option<TestOfLooseLoop> {
        let hir = self.file.hir;
        let StmtKind::For {
            test, update, body, ..
        } = hir[statement].kind
        else {
            return None;
        };
        let test = test.some()?;
        let ExprKind::Unary {
            op: UnOp::Not,
            operand: done,
        } = hir[test].kind
        else {
            return None;
        };
        let ExprKind::Dot {
            obj: stepped,
            name: known::done,
            chain: Chain::No,
            ..
        } = hir[done].kind
        else {
            return None;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value: stepping,
        } = hir[stepped].kind
        else {
            return None;
        };
        let ExprKind::Call(site) = hir[stepping].kind else {
            return None;
        };
        let site = hir[site];
        let is_plain = update.is_none()
            && site.chain == Chain::No
            && site.args.is_empty()
            && self.file.counted_places.is_none()
            && !self.file.decisions().is_dead_stmt(body)
            && ![test, done, stepped, stepping]
                .into_iter()
                .any(|it| self.file.is_statically_resolved(it))
            && self.find_local(target).is_some()
            && self.file.is_loose_iteration_intact();
        is_plain.then_some(TestOfLooseLoop { target, stepping })
    }

    fn is_in_plain_function(&self, statement: StmtId) -> bool {
        let (hir, bound) = (self.file.hir, self.file.bound);
        match bound.code_unit(bound.scope_of_stmt(statement)) {
            CodeUnit::Function(around) => !hir[around]
                .flags
                .intersects(Flags::ASYNC | Flags::GENERATOR),
            _ => false,
        }
    }

    fn read_call_of_loop_helper(&mut self, call: ExprId, helper: LoopHelper) -> Option<ExprId> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let ExprKind::Call(site) = hir[call].kind else {
            return None;
        };
        let site = hir[site];
        let callee = self.file.symbol_named_by(site.callee)?;
        let mut arguments = hir.ids(site.args);
        let iterated = arguments.next()?;
        let has_one_list = !matches!(hir[iterated].kind, ExprKind::Spread(_))
            && arguments.all(|it| {
                matches!(
                    hir[it].kind,
                    ExprKind::True | ExprKind::False | ExprKind::Number(_)
                )
            });
        if site.chain != Chain::No
            || !has_one_list
            || self.file.is_statically_resolved(call)
            || !bound.is_stable_binding(callee)
        {
            return None;
        }
        let BindingInitializer::Function(function) = bound.binding_initializer(hir, callee) else {
            return None;
        };
        let is_helper = match helper {
            LoopHelper::Loose => self.file.is_loose_iteration_helper(function),
            LoopHelper::Closing => self.file.is_closing_iteration_helper(function),
        };
        is_helper.then_some(iterated)
    }

    fn find_reads_of_step(
        &mut self,
        statement: StmtId,
        target: ExprId,
    ) -> Option<SmallVec<[ExprId; 2]>> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let StmtKind::For { test, .. } = hir[statement].kind else {
            return None;
        };
        let step = self.file.symbol_named_by(target)?;
        let range = hir[test].pos..hir[statement].loc.end;
        let mut reads = SmallVec::new();
        for &(_, reference) in self.file.queries.references_of_binding(step) {
            if reference == target {
                continue;
            }
            let Parent::Expr(read) = bound.parent_of_expr(reference) else {
                return None;
            };
            let read = read.some()?;
            if !range.contains(&hir[read].pos) || !self.file.is_plain_read_of_value(read) {
                return None;
            }
            reads.push(read);
        }
        Some(reads)
    }

    pub(super) fn find_loose_loop(&mut self, statement: StmtId) -> Option<LooseLoop> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let TestOfLooseLoop { target, stepping } = self.read_test_of_loose_loop(statement)?;
        let ExprKind::Call(site) = hir[stepping].kind else {
            return None;
        };
        let called = hir[site].callee;
        let iterator = self.file.symbol_named_by(called)?;
        if self.find_local(called).is_none() || !self.is_in_plain_function(statement) {
            return None;
        }
        let StmtKind::For { init, .. } = hir[statement].kind else {
            return None;
        };
        let StmtKind::Var(declarations) = hir[init.some()?].kind else {
            return None;
        };
        let mut declarations = declarations.iter().map(|it| hir[it]);
        let opening = declarations.find(|it| {
            it.kind == VarKind::Var
                && matches!(hir[it.pat].kind, PatKind::Ident(_))
                && bound.initialized_binding(it.pat) == Binding::Symbol(iterator)
        })?;
        let call = opening.init.some()?;
        let iterated = self.read_call_of_loop_helper(call, LoopHelper::Loose)?;
        let calls = self.file.queries.references_of_binding(iterator);
        if !matches!(calls, [(_, only)] if *only == called) {
            return None;
        }
        let reads = self.find_reads_of_step(statement, target)?;
        Some(LooseLoop {
            statement,
            call,
            iterated,
            reads,
            closing: None,
            passed: ExprId::NONE,
            opening: LoopOpening::Ahead,
            element: None,
        })
    }

    pub(super) fn note_closing_loop(
        &mut self,
        pattern: PatId,
        call: ExprId,
        behind: IdList<StmtId>,
    ) {
        let found = self.find_closing_loop(pattern, call, behind);
        self.loose_loops.extend(found);
    }

    fn find_closing_loop(
        &mut self,
        pattern: PatId,
        call: ExprId,
        behind: IdList<StmtId>,
    ) -> Option<LooseLoop> {
        let (hir, bound) = (self.file.hir, self.file.bound);
        let StmtKind::Try {
            block,
            param,
            handler,
            finalizer,
        } = hir[hir.ids(behind).next()?].kind
        else {
            return None;
        };
        if handler.is_none()
            || finalizer.is_none()
            || !matches!(hir[pattern].kind, PatKind::Ident(_))
        {
            return None;
        }
        let mut statement = self.file.only_statement(block);
        if let StmtKind::Labeled { body, .. } = hir[statement].kind {
            statement = body;
        }
        let Binding::Symbol(iterator) = bound.initialized_binding(pattern) else {
            return None;
        };
        let TestOfLooseLoop { target, stepping } = self.read_test_of_loose_loop(statement)?;
        let StmtKind::For { init, .. } = hir[statement].kind else {
            return None;
        };
        let expression_of = |statement: StmtId| match hir[statement].kind {
            StmtKind::Expr(expression) => Some(expression),
            _ => None,
        };
        let start = expression_of(init.some()?)?;
        let fail = expression_of(self.file.only_statement(handler))?;
        let finish = expression_of(self.file.only_statement(finalizer))?;
        let atoms = &self.file.queries.files().atoms;
        let mut names = SmallVec::<[ExprId; 4]>::new();
        let mut arguments_of_fail = SmallVec::new();
        for (call, name) in [
            (start, b"s"),
            (stepping, b"n"),
            (fail, b"e"),
            (finish, b"f"),
        ] {
            let (object, called, arguments) = self.file.read_method_call(call)?;
            if atoms.bytes(called) != &name[..]
                || !self.file.is_name_of(object, iterator)
                || self.file.is_statically_resolved(call)
            {
                return None;
            }
            names.push(object);
            match call == fail {
                true => arguments_of_fail = arguments,
                false if arguments.is_empty() => {}
                false => return None,
            }
        }
        let caught = param
            .some()
            .map(|param| bound.initialized_binding(hir[param].pat));
        let [error] = arguments_of_fail[..] else {
            return None;
        };
        if caught != Some(bound.binding(error)) || !matches!(hir[error].kind, ExprKind::Ident(_)) {
            return None;
        }
        if self.find_local(names[0]).is_none() || !self.is_in_plain_function(statement) {
            return None;
        }
        let iterated = self.read_call_of_loop_helper(call, LoopHelper::Closing)?;
        let references = self.file.queries.references_of_binding(iterator);
        if references.len() != names.len() || !references.iter().all(|(_, it)| names.contains(it)) {
            return None;
        }
        let reads = self.find_reads_of_step(statement, target)?;
        Some(LooseLoop {
            statement,
            call,
            iterated,
            reads,
            closing: Some(ClosingCalls {
                start,
                fail,
                finish,
            }),
            passed: ExprId::NONE,
            opening: LoopOpening::Ahead,
            element: None,
        })
    }

    pub(in crate::lower) fn try_lower_in_loose_loop(
        &mut self,
        expression: ExprId,
    ) -> Option<ValueId> {
        let place = self.loose_loops.iter().rposition(|it| {
            [it.call, it.iterated].contains(&expression) || it.reads.contains(&expression)
        })?;
        let innermost = &self.loose_loops[place];
        if innermost.iterated == expression {
            return innermost.opening.given();
        }
        if innermost.call != expression {
            return self.read_value_of_loose_loop(place, expression);
        }
        match innermost.opening {
            LoopOpening::Ahead => Some(self.open_loose_loop(place)),
            LoopOpening::Begun | LoopOpening::Given(_) | LoopOpening::Done(_) => None,
        }
    }

    pub(in crate::lower) fn try_lower_closing_call(&mut self, call: ExprId) -> Option<ValueId> {
        let place = self.loose_loops.iter().rposition(|it| {
            it.closing
                .is_some_and(|it| [it.start, it.fail, it.finish].contains(&call))
        })?;
        let LooseLoop {
            opening,
            closing,
            passed,
            ..
        } = self.loose_loops[place];
        let (list, closing) = (opening.list()?, closing?);
        if passed == call {
            return None;
        }
        let after = self.create_block();
        let split = self.split_on_type(list, TypeTable::UNDEFINED);
        self.builder.switch_to(split.taken);
        self.loose_loops[place].passed = call;
        self.lower_expression_for_effect(call);
        self.loose_loops[place].passed = ExprId::NONE;
        self.jump(after);
        self.builder.switch_to(split.not_taken);
        if call == closing.fail {
            let hir = self.file.hir;
            let ExprKind::Call(site) = hir[call].kind else {
                unreachable!("the helper's object is called");
            };
            let error = self.lower_expression(hir.id_at(hir[site].args, 0));
            self.emit_throw(error);
        }
        self.jump(after);
        self.continue_in(after);
        Some(self.builder.undefined())
    }

    fn open_loose_loop(&mut self, place: usize) -> ValueId {
        let LooseLoop { call, iterated, .. } = self.loose_loops[place];
        self.loose_loops[place].opening = LoopOpening::Begun;
        let iterated = self.lower_expression(iterated);
        self.set_position(self.file.hir[call].pos);
        let uses_helper = self.create_block();
        let opened = self.create_block();
        let list = self.builder.add_parameter(opened, None);
        let iterator = self.builder.add_parameter(opened, None);

        let split = self.split_on_type(iterated, TypeTable::ARRAY);
        self.builder.switch_to(split.not_taken);
        self.jump(uses_helper);
        self.builder.switch_to(split.taken);
        let is_pristine = self.builder.is_pristine_array(split.taken_value);
        let uses_list = self.create_block();
        self.builder
            .branch(is_pristine, Edge::to(uses_list), Edge::to(uses_helper));
        self.continue_in(uses_list);
        let no_iterator = self.builder.undefined();
        self.jump_with(opened, &[split.taken_value, no_iterator]);

        self.continue_in(uses_helper);
        self.loose_loops[place].opening = LoopOpening::Given(iterated);
        let made = self.lower_expression(call);
        self.loose_loops[place].opening = LoopOpening::Begun;
        let no_list = self.builder.undefined();
        self.jump_with(opened, &[no_list, made]);

        self.continue_in(opened);
        self.loose_loops[place].opening = LoopOpening::Done(list);
        self.file.known_helpers_lowered.calls += 1;
        iterator
    }

    fn read_value_of_loose_loop(&mut self, place: usize, read: ExprId) -> Option<ValueId> {
        let hir = self.file.hir;
        let LooseLoop {
            opening, element, ..
        } = self.loose_loops[place];
        let (list, element) = (opening.list()?, element?);
        let ExprKind::Dot { obj, .. } = hir[read].kind else {
            unreachable!("a step is read by name");
        };
        let is_read = self.create_block();
        let value = self.builder.add_parameter(is_read, None);
        let split = self.split_on_type(list, TypeTable::UNDEFINED);
        self.builder.switch_to(split.not_taken);
        self.jump_with(is_read, &[element]);
        self.builder.switch_to(split.taken);
        let step = self.lower_expression(obj);
        self.set_position(hir[read].pos);
        let key = self.file.name_key(known::value);
        let stepped = self.emit_get(step, PropertyName::Constant(key));
        self.jump_with(is_read, &[stepped]);
        self.continue_in(is_read);
        Some(value)
    }

    pub(super) fn lower_loose_loop(&mut self, statement: StmtId) -> bool {
        let hir = self.file.hir;
        let StmtKind::For { test, body, .. } = hir[statement].kind else {
            unreachable!("a loose loop is a For statement");
        };
        let Some(place) = self
            .loose_loops
            .iter()
            .rposition(|it| it.statement == statement)
        else {
            return false;
        };
        let Some(list) = self.loose_loops[place].opening.list() else {
            return false;
        };
        let body_block = self.create_block();
        let element = self.builder.add_parameter(body_block, None);
        let next = self.builder.add_parameter(body_block, None);
        let update_block = self.create_block();
        let after = self.create_block();
        let first = self.builder.integer(0);
        let header = self.create_loop_header(statement);
        let index = self.builder.add_parameter(header, None);
        self.jump_with(header, &[first]);
        self.builder.switch_to(header);
        self.builder.loop_hint();

        self.set_position(hir[test].pos);
        let split = self.split_on_type(list, TypeTable::UNDEFINED);
        self.builder.switch_to(split.not_taken);
        let array = split.not_taken_value;
        let length = self.file.name_key(known::length);
        let length = self.emit_get(array, PropertyName::Constant(length));
        let is_inside = self.builder.less(index, length);
        let inside = self.create_block();
        self.builder
            .branch(is_inside, Edge::to(inside), Edge::to(after));
        self.continue_in(inside);
        let read = self.builder.elem_get(array, index);
        let one = self.builder.integer(1);
        let following = self.builder.add(index, one);
        self.jump_with(body_block, &[read, following]);

        self.builder.switch_to(split.taken);
        let stepped = self.create_block();
        self.lower_condition(test, stepped, after);
        self.continue_in(stepped);
        let no_element = self.builder.undefined();
        self.jump_with(body_block, &[no_element, index]);

        self.continue_in(body_block);
        self.loose_loops[place].element = Some(element);
        let enclosing = self.suspending_arm.take();
        self.lower_loop_body(statement, body, after, update_block);
        self.suspending_arm = enclosing;
        self.jump(update_block);
        self.continue_in(update_block);
        self.jump_with(header, &[next]);
        self.builder.seal(header);
        self.continue_in(after);
        true
    }
}
