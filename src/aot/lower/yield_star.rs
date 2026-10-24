use bun_sema::hir::ExprId;

use super::{FunctionLowering, convert};
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_yield_star(&mut self, operand: ExprId) -> ValueId {
        let iterable = self.lower_expression(operand);
        let yielded = self.yielded_position();
        self.file
            .record_contents_flow(operand, ContentsSlot::Element, yielded);
        // JSC reports the iteration at the end of `yield*`.
        let position = self.file.hir[operand].pos;
        self.set_position(position);
        let delegation = self.begin_delegation(iterable);
        let exit = delegation.exit;

        self.builder.switch_to(delegation.resume_next.block);
        self.emit_resume(delegation, ResumeMode::Next, exit.block);

        self.builder.switch_to(delegation.suspend.block);
        self.emit_suspension(delegation);
        self.builder.seal(delegation.resume_next.block);

        self.continue_in(delegation.resume_throw.block);
        self.emit_resume(delegation, ResumeMode::Throw, exit.block);

        self.continue_in(delegation.resume_return.block);
        let finished = self.create_value_block();
        self.emit_resume(delegation, ResumeMode::Return, finished.block);
        self.builder.seal(delegation.suspend.block);

        self.continue_in(finished.block);
        self.emit_return(finished.value, None);

        self.continue_in(exit.block);
        exit.value
    }

    fn create_value_block(&mut self) -> ValueBlock {
        let block = self.create_block();
        let value = self.builder.add_parameter(block, None);
        ValueBlock { block, value }
    }

    fn begin_delegation(&mut self, iterable: ValueId) -> Delegation {
        let kind = match self.is_async_generator() {
            true => IteratorKind::Async,
            false => IteratorKind::Sync,
        };
        let delegation = Delegation {
            iterator: self.emit_iterator_open(iterable, kind, None),
            kind,
            resume_next: self.create_value_block(),
            resume_throw: self.create_value_block(),
            resume_return: self.create_value_block(),
            suspend: self.create_value_block(),
            exit: self.create_value_block(),
        };
        let builder = &mut self.builder;
        builder.declare_loop_header(delegation.resume_next.block, &[]);
        builder.declare_loop_header(delegation.suspend.block, &[]);
        let undefined = builder.undefined();
        self.jump_with(delegation.resume_next.block, &[undefined]);
        delegation
    }

    fn emit_resume(&mut self, delegation: Delegation, mode: ResumeMode, if_done: BlockId) {
        let sent = match mode {
            ResumeMode::Next => delegation.resume_next.value,
            ResumeMode::Throw => delegation.resume_throw.value,
            ResumeMode::Return => delegation.resume_return.value,
        };
        let step = self.emit_iterator_resume(delegation.iterator, delegation.kind, mode, sent);
        self.builder.branch(
            step.done,
            Edge::with_arguments(if_done, &[step.value]),
            Edge::with_arguments(delegation.suspend.block, &[step.value]),
        );
    }

    fn emit_suspension(&mut self, delegation: Delegation) {
        self.builder.loop_hint();
        let yielded = self.yielded_position();
        let value = convert::convert(self, delegation.suspend.value, yielded, None);
        let resumption = self.emit_yield(value);
        let sent = [resumption.sent];
        self.emit_resume_switch(
            resumption.mode,
            Edge::with_arguments(delegation.resume_throw.block, &sent),
            Edge::with_arguments(delegation.resume_return.block, &sent),
            Edge::with_arguments(delegation.resume_next.block, &sent),
        );
    }
}
