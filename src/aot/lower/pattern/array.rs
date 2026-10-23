use super::PatternNode;
use super::view::{self, NodeShape};
use crate::ir::generated::{BlockRole, IteratorCompletion, IteratorKind};
use crate::ir::{Edge, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::control::{self, CleanupLanding, CleanupPath};
use crate::lower::iteration::{self, IteratorStep, PatternShape};

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
    let elements = view::pattern_elements(lowering.file, node);
    let has_rest = elements.last().is_some_and(|element| element.is_rest);
    let shape = PatternShape {
        element_count: (elements.len() - usize::from(has_rest)) as u32,
        has_rest,
    };
    let iteration = PatternIteration {
        iterator: iteration::emit_iterator_open(lowering, value, IteratorKind::Sync, Some(shape)),
        position: lowering.position(),
    };
    control::begin_cleanup(
        lowering,
        BlockRole::IterationCleanup,
        Some(iteration.iterator),
    );
    for (index, element) in elements.iter().enumerate() {
        let prepared = super::prepare_target(lowering, element.target);
        let read = if element.is_rest {
            collect_rest(lowering, iteration, index as u32)
        } else {
            let step = emit_pattern_step(lowering, iteration, index as u32);
            if view::node_shape(lowering.file, element.target) == NodeShape::Hole {
                continue;
            }
            step.value
        };
        let read = super::apply_default(lowering, read, element.default, element.target);
        super::finish_target(lowering, element.target, prepared, read);
    }
    control::end_cleanup_per_exit(
        lowering,
        CleanupLanding::KeepsException,
        &mut |lowering, path| emit_pattern_close(lowering, iteration, path),
    );
}

// The state holds [[Done]]: a finished iterator steps to (true, undefined) and is not closed.
fn emit_pattern_step(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iteration: PatternIteration,
    step_index: u32,
) -> IteratorStep {
    lowering.set_position(iteration.position);
    iteration::emit_iterator_step(
        lowering,
        iteration.iterator,
        IteratorKind::Sync,
        Some(step_index),
    )
}

fn collect_rest(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iteration: PatternIteration,
    step_index: u32,
) -> ValueId {
    lowering.set_position(iteration.position);
    let array = lowering.builder.new_array(TypeTable::ANYTHING, &[], &[]);
    let header = lowering.create_block();
    let append = lowering.create_block();
    let exit = lowering.create_block();
    lowering.builder.declare_loop_header(header, &[]);
    lowering.jump(header);
    lowering.builder.switch_to(header);
    lowering.builder.loop_hint();
    let step = emit_pattern_step(lowering, iteration, step_index);
    lowering
        .builder
        .branch(step.done, Edge::to(exit), Edge::to(append));
    lowering.continue_in(append);
    lowering.builder.append_element(array, step.value);
    lowering.jump(header);
    lowering.builder.seal(header);
    lowering.continue_in(exit);
    array
}

fn emit_pattern_close(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    iteration: PatternIteration,
    path: CleanupPath,
) {
    lowering.set_position(iteration.position);
    let completion = match path {
        CleanupPath::Normal => IteratorCompletion::Normal,
        CleanupPath::Rethrow | CleanupPath::Throw { .. } => IteratorCompletion::Throw,
    };
    iteration::emit_iterator_close(lowering, iteration.iterator, IteratorKind::Sync, completion);
}
