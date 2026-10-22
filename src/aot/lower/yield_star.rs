use bun_sema::hir::ExprId;

use super::generator::{emit_resume_switch, emit_yield, is_async_generator, yielded_position};
use super::iteration::{emit_iterator_open, emit_iterator_resume};
use super::{FunctionLowering, control, convert, expression};
use crate::ir::generated::{IteratorKind, ResumeMode};
use crate::ir::{BlockId, ContentsSlot, Edge, ValueId};

#[derive(Copy, Clone)]
struct ValueBlock {
    block: BlockId,
    value: ValueId,
}

#[derive(Copy, Clone)]
struct Delegation {
    iterator: ValueId,
    kind: IteratorKind,
    resume_next: ValueBlock,
    resume_throw: ValueBlock,
    resume_return: ValueBlock,
    suspend: ValueBlock,
    exit: ValueBlock,
}

pub(super) fn lower_yield_star(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    operand: ExprId,
) -> ValueId {
    let iterable = expression::lower_expression(lowering, operand);
    let yielded = yielded_position(lowering);
    convert::record_contents_flow(lowering.file, operand, ContentsSlot::Element, yielded);
    // JSC reports the iteration at the end of `yield*`.
    let position = lowering.file.hir[operand].pos;
    lowering.set_position(position);
    let delegation = begin_delegation(lowering, iterable);
    let exit = delegation.exit;

    lowering.builder.switch_to(delegation.resume_next.block);
    emit_resume(lowering, delegation, ResumeMode::Next, exit.block);

    lowering.builder.switch_to(delegation.suspend.block);
    emit_suspension(lowering, delegation);
    lowering.builder.seal(delegation.resume_next.block);

    lowering.continue_in(delegation.resume_throw.block);
    emit_resume(lowering, delegation, ResumeMode::Throw, exit.block);

    lowering.continue_in(delegation.resume_return.block);
    let finished = create_value_block(lowering);
    emit_resume(lowering, delegation, ResumeMode::Return, finished.block);
    lowering.builder.seal(delegation.suspend.block);

    lowering.continue_in(finished.block);
    control::emit_return(lowering, finished.value, None);

    lowering.continue_in(exit.block);
    exit.value
}

fn create_value_block(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueBlock {
    let block = lowering.create_block();
    let value = lowering.builder.add_parameter(block, None);
    ValueBlock { block, value }
}

fn begin_delegation(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iterable: ValueId,
) -> Delegation {
    let kind = match is_async_generator(lowering) {
        true => IteratorKind::Async,
        false => IteratorKind::Sync,
    };
    let delegation = Delegation {
        iterator: emit_iterator_open(lowering, iterable, kind, None),
        kind,
        resume_next: create_value_block(lowering),
        resume_throw: create_value_block(lowering),
        resume_return: create_value_block(lowering),
        suspend: create_value_block(lowering),
        exit: create_value_block(lowering),
    };
    let builder = &mut lowering.builder;
    builder.declare_loop_header(delegation.resume_next.block, &[]);
    builder.declare_loop_header(delegation.suspend.block, &[]);
    let undefined = builder.undefined();
    lowering.jump_with(delegation.resume_next.block, &[undefined]);
    delegation
}

fn emit_resume(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    delegation: Delegation,
    mode: ResumeMode,
    if_done: BlockId,
) {
    let sent = match mode {
        ResumeMode::Next => delegation.resume_next.value,
        ResumeMode::Throw => delegation.resume_throw.value,
        ResumeMode::Return => delegation.resume_return.value,
    };
    let step = emit_iterator_resume(lowering, delegation.iterator, delegation.kind, mode, sent);
    lowering.builder.branch(
        step.done,
        Edge::with_arguments(if_done, &[step.value]),
        Edge::with_arguments(delegation.suspend.block, &[step.value]),
    );
}

fn emit_suspension(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, delegation: Delegation) {
    lowering.builder.loop_hint();
    let yielded = yielded_position(lowering);
    let value = convert::convert(lowering, delegation.suspend.value, yielded, None);
    let resumption = emit_yield(lowering, value);
    let sent = [resumption.sent];
    emit_resume_switch(
        lowering,
        resumption.mode,
        Edge::with_arguments(delegation.resume_throw.block, &sent),
        Edge::with_arguments(delegation.resume_return.block, &sent),
        Edge::with_arguments(delegation.resume_next.block, &sent),
    );
}
