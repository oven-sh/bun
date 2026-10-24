use bun_sema::hir::{self, ExprId, ExprKind, Flags, FnId};

use super::{FileLowering, FunctionLowering, convert};
use crate::ir::generated::{FunctionFlags, ResumeMode, YieldResult};
use crate::ir::{DeclaredType, Edge, FunctionKey, ValueId};

#[derive(Default)]
pub(crate) struct CoroutineState {
    yielded: Option<DeclaredType>,
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
        self.builder.initial_yield();
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

    pub(in crate::lower) fn emit_yield(&mut self, value: ValueId) -> Resumption {
        let builder = &mut self.builder;
        let results = builder.yield_value(value);
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
        return lowering.lower_yield_star(value);
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
