use super::PatternNode;
use super::view::NodeShape;
use crate::ir::generated::{BlockRole, IteratorCompletion, IteratorKind};
use crate::ir::{Edge, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::control::{CleanupLanding, CleanupPath};
use crate::lower::iteration::{IteratorStep, PatternShape};

#[derive(Copy, Clone)]
struct PatternIteration {
    iterator: ValueId,
    position: u32,
}

pub(super) fn destructure_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
) {
    let elements = lowering.file.pattern_elements(node);
    let has_rest = elements.last().is_some_and(|element| element.is_rest);
    let shape = PatternShape {
        element_count: (elements.len() - usize::from(has_rest)) as u32,
        has_rest,
    };
    let iteration = PatternIteration {
        iterator: lowering.emit_iterator_open(value, IteratorKind::Sync, Some(shape)),
        position: lowering.position(),
    };
    lowering.begin_cleanup(BlockRole::IterationCleanup, Some(iteration.iterator));
    for (index, element) in elements.iter().enumerate() {
        let prepared = lowering.prepare_target(element.target);
        let read = if element.is_rest {
            lowering.collect_rest(iteration, index as u32)
        } else {
            let step = lowering.emit_pattern_step(iteration, index as u32);
            if lowering.file.node_shape(element.target) == NodeShape::Hole {
                continue;
            }
            step.value
        };
        let read = super::apply_default(lowering, read, element.default, element.target);
        lowering.finish_target(element.target, prepared, read);
    }
    lowering.end_cleanup_per_exit(CleanupLanding::KeepsException, &mut |lowering, path| {
        lowering.emit_pattern_close(iteration, path)
    });
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The state holds [[Done]]: a finished iterator steps to (true, undefined) and is not closed.
    fn emit_pattern_step(&mut self, iteration: PatternIteration, step_index: u32) -> IteratorStep {
        self.set_position(iteration.position);
        self.emit_iterator_step(iteration.iterator, IteratorKind::Sync, Some(step_index))
    }

    fn collect_rest(&mut self, iteration: PatternIteration, step_index: u32) -> ValueId {
        self.set_position(iteration.position);
        let array = self.builder.new_array(TypeTable::ANYTHING, &[], &[]);
        let header = self.create_block();
        let append = self.create_block();
        let exit = self.create_block();
        self.builder.declare_loop_header(header, &[]);
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        let step = self.emit_pattern_step(iteration, step_index);
        self.builder
            .branch(step.done, Edge::to(exit), Edge::to(append));
        self.continue_in(append);
        self.builder.append_element(array, step.value);
        self.jump(header);
        self.builder.seal(header);
        self.continue_in(exit);
        array
    }

    fn emit_pattern_close(&mut self, iteration: PatternIteration, path: CleanupPath) {
        self.set_position(iteration.position);
        let completion = match path {
            CleanupPath::Normal => IteratorCompletion::Normal,
            CleanupPath::Rethrow | CleanupPath::Throw { .. } => IteratorCompletion::Throw,
        };
        self.emit_iterator_close(iteration.iterator, IteratorKind::Sync, completion);
    }
}
