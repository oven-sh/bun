use bun_sema::check::aot::{CheckedType, GaveUp};
use bun_sema::hir::{ExprId, PatId, PatKind, StmtId, StmtKind, VarKind};

use super::control::{BreakTargetKind, CleanupLanding, CleanupPath};
use super::types::find_contents_type;
use super::{FileLowering, FunctionLowering};
use crate::ir::generated::{
    BlockRole, ForInStepResult, IteratorCompletion, IteratorKind, IteratorResumeResult, ResumeMode,
    TypeSiteKind,
};
use crate::ir::{ContentsSlot, Edge, ValueId};

#[derive(Copy, Clone, Debug)]
pub(crate) struct IteratorStep {
    pub(crate) done: ValueId,
    pub(crate) value: ValueId,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct PatternShape {
    pub(crate) element_count: u32,
    pub(crate) has_rest: bool,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn emit_iterator_open(
        &mut self,
        iterable: ValueId,
        kind: IteratorKind,
        pattern: Option<PatternShape>,
    ) -> ValueId {
        let element_count = pattern.map(|shape| shape.element_count);
        let has_rest = pattern.is_some_and(|shape| shape.has_rest);
        self.builder
            .iterator_open(iterable, kind, element_count, pattern.is_some(), has_rest)
    }

    pub(crate) fn emit_iterator_step(
        &mut self,
        iterator: ValueId,
        kind: IteratorKind,
        step_index: Option<u32>,
    ) -> IteratorStep {
        let results =
            self.builder
                .iterator_resume(iterator, None, kind, ResumeMode::Next, step_index, false);
        self.read_step_results(results)
    }

    pub(in crate::lower) fn emit_iterator_resume(
        &mut self,
        iterator: ValueId,
        kind: IteratorKind,
        mode: ResumeMode,
        sent: ValueId,
    ) -> IteratorStep {
        let results = self
            .builder
            .iterator_resume(iterator, Some(sent), kind, mode, None, true);
        self.read_step_results(results)
    }

    pub(crate) fn emit_iterator_close(
        &mut self,
        iterator: ValueId,
        kind: IteratorKind,
        completion: IteratorCompletion,
    ) {
        self.builder.iterator_close(iterator, kind, completion);
    }

    fn read_step_results(&mut self, results: ValueId) -> IteratorStep {
        let builder = &mut self.builder;
        IteratorStep {
            done: builder.result_at(results, IteratorResumeResult::Done.to_wire()),
            value: builder.result_at(results, IteratorResumeResult::Value.to_wire()),
        }
    }

    pub(in crate::lower) fn lower_for_in(&mut self, statement: StmtId) {
        let StmtKind::ForIn { left, expr, body } = self.file.hir[statement].kind else {
            unreachable!("lower_for_in takes a ForIn statement");
        };
        self.lower_head_initializer(left);
        let object = self.lower_loop_subject(statement, expr);
        self.set_position(self.file.last_reported_position(expr));
        let enumerator = self.builder.for_in_open(object);
        let header = self.begin_loop(statement);
        let body_block = self.create_block();
        let after = self.create_block();
        let builder = &mut self.builder;
        let step = builder.for_in_step(enumerator, object);
        let done = builder.result_at(step, ForInStepResult::Done.to_wire());
        let key = builder.result_at(step, ForInStepResult::Key.to_wire());
        builder.branch(done, Edge::to(after), Edge::to(body_block));
        self.continue_in(body_block);

        self.push_break_target(statement, BreakTargetKind::Loop, after);
        self.push_continue_target(statement, header);
        self.lower_iteration_body(statement, left, key, body);
        self.jump(header);
        self.pop_jump_target();
        self.pop_jump_target();
        self.builder.seal(header);
        self.continue_in(after);
    }

    fn lower_head_initializer(&mut self, left: StmtId) {
        let hir = self.file.hir;
        let StmtKind::Var(declarations) = hir[left].kind else {
            return;
        };
        let Some(declaration) = declarations.iter().next() else {
            return;
        };
        let head = hir[declaration];
        match head.kind {
            VarKind::Var if head.init.is_some() => {
                self.lower_variable_declaration(declaration);
            }
            VarKind::Var | VarKind::Let | VarKind::Const | VarKind::Using | VarKind::AwaitUsing => {
            }
        }
    }

    pub(in crate::lower) fn lower_for_of(&mut self, statement: StmtId) {
        let StmtKind::ForOf {
            left,
            expr,
            body,
            is_await,
        } = self.file.hir[statement].kind
        else {
            unreachable!("lower_for_of takes a ForOf statement");
        };
        let kind = match is_await {
            true => IteratorKind::Async,
            false => IteratorKind::Sync,
        };
        let iterable = self.lower_loop_subject(statement, expr);
        let position = self.file.last_mapped_head_position(statement, left);
        self.set_position(position);
        let iterator = self.emit_iterator_open(iterable, kind, None);
        let header = self.begin_loop(statement);
        let body_block = self.create_block();
        let after = self.create_block();
        let step = self.emit_iterator_step(iterator, kind, None);
        let (done, stepping) = (Edge::to(after), Edge::to(body_block));
        self.builder.branch(step.done, done, stepping);
        self.continue_in(body_block);

        self.push_break_target(statement, BreakTargetKind::Loop, after);
        self.begin_cleanup(BlockRole::IterationCleanup, Some(iterator));
        self.push_continue_target(statement, header);
        let stepped = self.file.find_stepped_type(left, expr, kind);
        // The type of a declared head is the stepped type itself. A target that is declared elsewhere has a type of its own.
        if let (StmtKind::Expr(target), Ok(stepped)) = (self.file.hir[left].kind, stepped) {
            self.file.record_assigned_type_flow(target, stepped);
        }
        let value = self.claim_contents_read(stepped, TypeSiteKind::Element, step.value);
        self.lower_iteration_body(statement, left, value, body);
        self.jump(header);
        self.pop_jump_target();

        self.set_position(position);
        self.end_cleanup_per_exit(CleanupLanding::KeepsException, &mut |lowering, path| {
            let completion = match path {
                CleanupPath::Normal => IteratorCompletion::Normal,
                CleanupPath::Rethrow => IteratorCompletion::Throw,
                CleanupPath::Throw { .. } => unreachable!("an iterator close keeps the exception"),
            };
            lowering.emit_iterator_close(iterator, kind, completion);
        });
        self.builder.seal(header);
        self.pop_jump_target();
        self.continue_in(after);
    }

    fn lower_loop_subject(&mut self, statement: StmtId, subject: ExprId) -> ValueId {
        let scope = self.file.bound.own_scope(statement);
        self.enter_scope(scope);
        let value = self.lower_expression(subject);
        self.leave_scope(scope);
        let position = self.file.hir[statement].start;
        self.set_position(position);
        value
    }

    fn lower_iteration_body(
        &mut self,
        statement: StmtId,
        left: StmtId,
        value: ValueId,
        body: StmtId,
    ) {
        let hir = self.file.hir;
        let scope = self.file.bound.own_scope(statement);
        self.enter_scope(scope);
        match hir[left].kind {
            StmtKind::Var(declarations) => match declarations.iter().next() {
                Some(declaration) => match hir[declaration].kind {
                    VarKind::Using | VarKind::AwaitUsing => {
                        self.lower_loop_resource(declaration, value, &mut |lowering| {
                            lowering.lower_statement(body);
                        });
                    }
                    VarKind::Var | VarKind::Let | VarKind::Const => {
                        self.bind_pattern(hir[declaration].pat, value, None);
                        self.lower_statement(body);
                    }
                },
                None => self.lower_statement(body),
            },
            StmtKind::Expr(target) => {
                self.assign_pattern(target, value, None);
                self.lower_statement(body);
            }
            _ => self.lower_statement(body),
        }
        self.leave_scope(scope);
    }
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_stepped_type(
        &mut self,
        left: StmtId,
        iterable: ExprId,
        kind: IteratorKind,
    ) -> CheckedType {
        let hir = self.hir;
        // The checker types a declared head by the iteration protocol, so a `Map` or a generator has an answer too.
        if let StmtKind::Var(declarations) = hir[left].kind
            && let Some(declaration) = declarations.iter().next()
        {
            return self.queries.binding_type(hir[declaration].pat);
        }
        let iterable = self.queries.expression_type(iterable)?;
        let element = find_contents_type(self, iterable, ContentsSlot::Element);
        let element = element.ok_or(GaveUp::Unresolved)?;
        match kind {
            IteratorKind::Sync => Ok(element),
            IteratorKind::Async => self.queries.awaited_type(element),
        }
    }

    // JSC reports the calls of the iteration protocol at the end of what stands before `of`, which the source map takes back to this token.
    fn last_mapped_head_position(&self, statement: StmtId, left: StmtId) -> u32 {
        let hir = self.hir;
        let position = match hir[left].kind {
            StmtKind::Var(declarations) => {
                let head = declarations.iter().next();
                head.and_then(|declaration| self.last_mapped_pattern_position(hir[declaration].pat))
            }
            StmtKind::Expr(target) => Some(self.last_mapped_position(target)),
            _ => None,
        };
        position.unwrap_or(hir[statement].start)
    }

    fn last_mapped_pattern_position(&self, pattern: PatId) -> Option<u32> {
        let hir = self.hir;
        let last_of = |part: PatId, default: ExprId| match default.is_some() {
            true => Some(self.last_mapped_position(default)),
            false => self.last_mapped_pattern_position(part),
        };
        match hir[pattern].kind {
            PatKind::Missing => None,
            PatKind::Ident(_) => Some(hir[pattern].pos),
            PatKind::Array(elements) => {
                let mut elements = elements.iter().rev().map(|element| hir[element]);
                elements.find_map(|element| last_of(element.pat, element.default))
            }
            PatKind::Object(properties) => {
                let mut properties = properties.iter().rev().map(|property| hir[property]);
                properties.find_map(|property| last_of(property.value, property.default))
            }
        }
    }
}
