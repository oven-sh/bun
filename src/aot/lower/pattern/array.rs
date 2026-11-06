use super::PatternNode;
use super::view::NodeShape;
use crate::ir::generated::{BlockRole, IteratorCompletion, IteratorKind};
use crate::ir::{Edge, TypeTable, ValueId};
use crate::lower::FunctionLowering;
use crate::lower::control::{CleanupLanding, CleanupPath};
use crate::lower::iteration::{IteratorStep, PatternShape};

pub(super) fn destructure_array(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    node: PatternNode,
    value: ValueId,
    mapped: u32,
) {
    // The `[` of an assignment is the start of an expression, which the source map knows.
    if let PatternNode::Binding(_) = node {
        lowering.set_position(match lowering.file.is_shown_without_source_map() {
            true => lowering.file.node_position(node),
            false => mapped,
        });
    }
    let elements = lowering.file.pattern_elements(node);
    let has_rest = elements.last().is_some_and(|element| element.is_rest);
    let shape = PatternShape {
        element_count: (elements.len() - usize::from(has_rest)) as u32,
        has_rest,
    };
    let iterator = lowering.emit_iterator_open(value, IteratorKind::Sync, Some(shape));
    let position = lowering.position();
    lowering.builder.record_position(position);
    lowering.begin_cleanup(BlockRole::IterationCleanup, Some(iterator));
    let mut mapped = position;
    for (index, element) in elements.iter().enumerate() {
        let prepared = lowering.prepare_target(element.target);
        let read = if element.is_rest {
            lowering.collect_rest(iterator, position, index as u32)
        } else {
            let step = lowering.emit_pattern_step(iterator, position, index as u32);
            if lowering.file.node_shape(element.target) == NodeShape::Hole {
                continue;
            }
            step.value
        };
        lowering.builder.record_position(position);
        let read = super::apply_default(lowering, read, element.default, element.target);
        let before = mapped;
        let last = lowering.file.last_mapped_element_position(element);
        mapped = last.unwrap_or(mapped);
        // JSC records nothing for the store to a member behind the step.
        lowering.finish_target(element.target, prepared, read, before, position);
    }
    lowering.end_cleanup_per_exit(CleanupLanding::KeepsException, &mut |lowering, path| {
        lowering.set_position(position);
        let completion = match path {
            CleanupPath::Normal => IteratorCompletion::Normal,
            CleanupPath::Rethrow | CleanupPath::Throw { .. } => IteratorCompletion::Throw,
        };
        let builder = &mut lowering.builder;
        builder.iterator_close(iterator, IteratorKind::Sync, completion, &[]);
    });
    lowering.builder.record_position(position);
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The state holds [[Done]]: a finished iterator steps to (true, undefined) and is not closed.
    fn emit_pattern_step(&mut self, iterator: ValueId, position: u32, index: u32) -> IteratorStep {
        self.set_position(position);
        self.emit_iterator_step(iterator, IteratorKind::Sync, Some(index))
    }

    fn collect_rest(&mut self, iterator: ValueId, position: u32, index: u32) -> ValueId {
        self.set_position(position);
        let array = self.builder.new_array(TypeTable::ANYTHING, &[], &[]);
        let header = self.create_block();
        let append = self.create_block();
        let exit = self.create_block();
        self.builder.declare_loop_header(header, &[]);
        self.jump(header);
        self.builder.switch_to(header);
        self.builder.loop_hint();
        let step = self.emit_pattern_step(iterator, position, index);
        self.builder
            .branch(step.done, Edge::to(exit), Edge::to(append));
        self.continue_in(append);
        self.builder.append_element(array, step.value);
        self.jump(header);
        self.builder.seal(header);
        self.continue_in(exit);
        array
    }
}
