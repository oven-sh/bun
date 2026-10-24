use bun_sema::hir::ExprId;

use super::{FunctionLowering, convert};
use crate::ir::generated::{IteratorKind, ResumeMode};
use crate::ir::{BlockId, ContentsSlot, Edge, ValueId};

#[derive(Copy, Clone)]
struct ValueBlock {
    block: BlockId,
    value: ValueId,
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
        let kind = match self.is_async_generator() {
            true => IteratorKind::Async,
            false => IteratorKind::Sync,
        };
        let iterator = self.emit_iterator_open(iterable, kind, None);
        let resume_next = self.create_value_block();
        let resume_throw = self.create_value_block();
        let resume_return = self.create_value_block();
        let suspend = self.create_value_block();
        let exit = self.create_value_block();
        self.builder.declare_loop_header(resume_next.block, &[]);
        self.builder.declare_loop_header(suspend.block, &[]);
        let undefined = self.builder.undefined();
        self.jump_with(resume_next.block, &[undefined]);
        let emit_resume = |lowering: &mut Self, mode: ResumeMode, if_done: BlockId| {
            let sent = match mode {
                ResumeMode::Next => resume_next.value,
                ResumeMode::Throw => resume_throw.value,
                ResumeMode::Return => resume_return.value,
            };
            let step = lowering.emit_iterator_resume(iterator, kind, mode, sent);
            lowering.builder.branch(
                step.done,
                Edge::with_arguments(if_done, &[step.value]),
                Edge::with_arguments(suspend.block, &[step.value]),
            );
        };

        self.builder.switch_to(resume_next.block);
        emit_resume(self, ResumeMode::Next, exit.block);

        self.builder.switch_to(suspend.block);
        self.builder.loop_hint();
        let value = convert::convert(self, suspend.value, yielded, None);
        let resumption = self.emit_yield(value);
        let sent = [resumption.sent];
        self.emit_resume_switch(
            resumption.mode,
            Edge::with_arguments(resume_throw.block, &sent),
            Edge::with_arguments(resume_return.block, &sent),
            Edge::with_arguments(resume_next.block, &sent),
        );
        self.builder.seal(resume_next.block);

        self.continue_in(resume_throw.block);
        emit_resume(self, ResumeMode::Throw, exit.block);

        self.continue_in(resume_return.block);
        let finished = self.create_value_block();
        emit_resume(self, ResumeMode::Return, finished.block);
        self.builder.seal(suspend.block);

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
}
