use bun_sema::bind::Binding;
use bun_sema::hir::{self, ExprId, ExprKind, Flags, FnId, StmtId};
use bun_sema::node::{Node, NodeData, ToNode};

use smallvec::SmallVec;

use super::scope::BindingRef;
use super::{FileLowering, FunctionLowering, convert};
use crate::ir::generated::{FunctionFlags, ResumeMode, YieldResult};
use crate::ir::{DeclaredType, Edge, FunctionKey, ValueId};

#[derive(Default)]
pub(crate) struct CoroutineState {
    yielded: Option<DeclaredType>,
    /// What the function holds until it ends. Every suspension lists the values.
    pub(in crate::lower) held: SmallVec<[BindingRef; 4]>,
}

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct Resumption {
    pub(in crate::lower) sent: ValueId,
    pub(in crate::lower) mode: ValueId,
}

pub(crate) fn coroutine_flags(hir: &hir::File<'_>, function: FnId) -> FunctionFlags {
    let source_flags = hir[function].flags;
    let mut flags = FunctionFlags::default();
    if source_flags.contains(Flags::ASYNC) {
        flags |= FunctionFlags::IS_ASYNC;
    }
    if source_flags.contains(Flags::GENERATOR) {
        flags |= FunctionFlags::IS_GENERATOR | FunctionFlags::TAKES_CALLEE;
    }
    flags
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn is_async_generator(&self) -> bool {
        let flags = self.builder.function().flags;
        flags.contains(FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR)
    }

    pub(crate) fn emit_coroutine_start(&mut self) {
        let flags = self.builder.function().flags;
        if !flags.contains(FunctionFlags::IS_GENERATOR) {
            return;
        }
        let yielded = match self.key {
            FunctionKey::Source(source) => self.file.function_positions(source.function).yielded,
            _ => DeclaredType::untyped(),
        };
        let held = self.get_held_values();
        self.builder.initial_yield(&held);
        self.coroutine.yielded = Some(yielded);
    }

    pub(crate) fn await_in_async_generator(&mut self, value: ValueId) -> ValueId {
        match self.is_async_generator() {
            true => self.emit_await(value),
            false => value,
        }
    }

    pub(in crate::lower) fn yielded_position(&self) -> DeclaredType {
        let yielded = self.coroutine.yielded;
        debug_assert!(yielded.is_some(), "InitialYield dominates every Yield");
        yielded.unwrap_or_else(DeclaredType::untyped)
    }

    /// `bun run` keeps text that only a build removes. A function that is suspended in front of such text holds the locals that it names.
    pub(in crate::lower) fn hold_names_of_removed_statement(&mut self, statement: StmtId) {
        let in_bun_run = self.file.decisions().as_folded_by_bun_run();
        if !in_bun_run.is_dead_stmt(statement) {
            self.hold_names_under(statement.to_node(self.file.hir));
        }
    }

    pub(in crate::lower) fn hold_names_of_removed_expression(&mut self, expression: ExprId) {
        let in_bun_run = self.file.decisions().as_folded_by_bun_run();
        if !in_bun_run.is_dead_expr(expression) {
            self.hold_names_under(expression.to_node(self.file.hir));
        }
    }

    fn hold_names_under(&mut self, removed: Node) {
        let flags = self.builder.function().flags;
        let can_be_suspended = FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR;
        if !flags.intersects(can_be_suspended) || !self.builder.is_open() {
            return;
        }
        let hir = self.file.hir;
        let mut named: SmallVec<[ValueId; 4]> = SmallVec::new();
        let mut pending: SmallVec<[Node; 16]> = SmallVec::from_slice(&[removed]);
        while let Some(node) = pending.pop() {
            if let NodeData::Expr(expression) = hir.data(node)
                && let ExprKind::Ident(_) = hir[expression].kind
            {
                if let Binding::Symbol(symbol) = self.file.bound.binding(expression)
                    && let Some(local) = self.scopes.find_local(BindingRef::Symbol(symbol))
                {
                    let value = self.builder.read_variable(local.variable);
                    if !named.contains(&value) {
                        named.push(value);
                    }
                }
                continue;
            }
            hir.for_each_child(node, &mut |child| {
                pending.push(child);
                false
            });
        }
        if named.is_empty() {
            return;
        }
        self.builder.read_scope(&named);
    }

    pub(in crate::lower) fn emit_yield(&mut self, value: ValueId) -> Resumption {
        let held = self.get_held_values();
        let builder = &mut self.builder;
        let results = builder.yield_value(value, &held);
        Resumption {
            sent: builder.result_at(results, YieldResult::Sent.to_wire()),
            mode: builder.result_at(results, YieldResult::Mode.to_wire()),
        }
    }

    pub(in crate::lower) fn emit_resume_switch(
        &mut self,
        mode: ValueId,
        on_throw: Edge<'_>,
        on_return: Edge<'_>,
        on_next: Edge<'_>,
    ) {
        let cases = [
            i64::from(ResumeMode::Throw.to_wire()),
            i64::from(ResumeMode::Return.to_wire()),
        ];
        self.builder
            .switch(mode, &cases, &[on_throw, on_return], on_next);
    }
}

pub(crate) fn lower_yield(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> ValueId {
    let ExprKind::Yield { value, star } = lowering.file.hir[expression].kind else {
        unreachable!("lower_yield takes a Yield expression");
    };
    if star {
        return lowering.lower_yield_star(expression, value);
    }
    let operand = value.some();
    let value = match operand {
        Some(operand) => lowering.lower_expression(operand),
        None => lowering.builder.undefined(),
    };
    lowering.set_position(lowering.file.hir[expression].pos);
    let value = lowering.await_in_async_generator(value);
    let yielded = lowering.yielded_position();
    let source = match lowering.is_async_generator() {
        true => operand.and_then(|operand| lowering.file.find_awaited_source(operand, yielded)),
        false => operand,
    };
    let value = convert::convert(lowering, value, yielded, source);
    let resumption = lowering.emit_yield(value);

    let on_throw = lowering.create_block();
    let on_return = lowering.create_block();
    let on_next = lowering.create_block();
    lowering.emit_resume_switch(
        resumption.mode,
        Edge::to(on_throw),
        Edge::to(on_return),
        Edge::to(on_next),
    );

    lowering.continue_in(on_throw);
    lowering.emit_throw(resumption.sent);

    lowering.continue_in(on_return);
    lowering.emit_return(resumption.sent, None);

    lowering.continue_in(on_next);
    resumption.sent
}

impl FileLowering<'_, '_, '_, '_> {
    // The position takes what the operand is fulfilled with: the operand itself where its type has no promise in it.
    pub(in crate::lower) fn find_awaited_source(
        &mut self,
        operand: ExprId,
        position: DeclaredType,
    ) -> Option<ExprId> {
        let operand_type = self.queries.expression_type(operand).ok()?;
        let fulfilled = self.queries.awaited_type(operand_type).ok()?;
        if fulfilled == operand_type {
            return Some(operand);
        }
        let target = self
            .find_position_source(position)
            .or_else(|| self.find_mapped_source(position.ty))?;
        let source_position = self.hir[operand].pos;
        self.record_type_flow(fulfilled, target, source_position);
        None
    }
}
