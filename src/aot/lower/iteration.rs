mod for_in;
mod for_of;
mod loop_head;

pub(crate) use self::for_in::lower_for_in;
pub(crate) use self::for_of::lower_for_of;
use super::FunctionLowering;
use crate::ir::ValueId;
use crate::ir::generated::{IteratorCompletion, IteratorKind, IteratorResumeResult, ResumeMode};

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
}
