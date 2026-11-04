use bun_sema::hir::{self, ExprId, ExprKind, Flags, FnId};

use smallvec::SmallVec;

use super::scope::BindingRef;
use super::{FileLowering, FunctionLowering, convert};
use crate::ir::generated::{FunctionFlags, ResumeMode, YieldResult};
use crate::ir::{DeclaredType, Edge, FunctionKey, PositionFlags, ValueId};

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

const MOST_VALUES_THAT_WAIT_WHERE_FRAMES_ARE_SAVED: usize = 32;

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
    // What one operation takes at once waits in the frame for the last of it: a word for each value, and often one more to hand it over.
    // A function that suspends pays for its whole frame whenever it goes on. So there a literal takes only so much at once, and the rest as it is made.
    pub(in crate::lower) fn may_wait_with(&self, waiting: usize) -> bool {
        let suspends = FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR;
        waiting < MOST_VALUES_THAT_WAIT_WHERE_FRAMES_ARE_SAVED
            || !self.builder.function().flags.intersects(suspends)
    }

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
    // The position takes what the operand is fulfilled with: the operand itself where its type has no promise in it. Only the proof of an `int32` looks at it.
    fn find_awaited_source(&mut self, operand: ExprId, position: DeclaredType) -> Option<ExprId> {
        if !position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
            return None;
        }
        let operand_type = self.queries.expression_type(operand).ok()?;
        let fulfilled = self.queries.awaited_type(operand_type).ok()?;
        (fulfilled == operand_type).then_some(operand)
    }
}
