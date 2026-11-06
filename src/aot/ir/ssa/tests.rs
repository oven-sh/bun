use super::*;
use crate::ir::generated::BlockFrequency;
use crate::ir::testing::{create_blocks, create_builder, create_catch_handler, enter_block};
use crate::ir::types::TypeTable;

struct Diamond {
    arms: [BlockId; 2],
    join: BlockId,
}

fn enter_blocks(builder: &mut FunctionBuilder, count: usize) -> BlockId {
    for _ in 0..count {
        enter_block(builder, None);
    }
    builder.current_block()
}

fn write_diamond(
    builder: &mut FunctionBuilder,
    condition: ValueId,
    variable: LocalVariable,
    values: [Option<ValueId>; 2],
) -> Diamond {
    let arms: [BlockId; 2] = create_blocks(builder);
    let join = builder.create_block(None);
    builder.branch(condition, Edge::to(arms[0]), Edge::to(arms[1]));
    for (block, value) in arms.into_iter().zip(values) {
        builder.seal(block);
        builder.switch_to(block);
        if let Some(value) = value {
            builder.write_variable(variable, value);
        }
        builder.jump(Edge::to(join));
    }
    builder.seal(join);
    builder.switch_to(join);
    Diamond { arms, join }
}

fn write_in_successive_blocks(
    builder: &mut FunctionBuilder,
    variable: LocalVariable,
    block_count: usize,
) -> ValueId {
    let mut stored = builder.integer(0);
    builder.write_variable(variable, stored);
    for constant in 1..block_count {
        enter_block(builder, None);
        stored = builder.integer(constant as i64);
        builder.write_variable(variable, stored);
    }
    stored
}

fn variable_parameters(builder: &FunctionBuilder, block: BlockId) -> &[ValueId] {
    &builder.blocks[block.index()].variable_parameters
}

fn variable_arguments(builder: &FunctionBuilder, block: BlockId, target: usize) -> &[ValueId] {
    let terminator = builder.blocks[block.index()].terminator.as_ref();
    let terminator = terminator.expect("the block is terminated");
    &terminator.targets[target].variable_arguments
}

fn handler_arguments(builder: &FunctionBuilder, block: BlockId) -> &[ValueId] {
    let handler = builder.blocks[block.index()].handler.as_ref();
    &handler.expect("the block is covered").variable_arguments
}

fn values_of(builder: &FunctionBuilder, block: BlockId) -> &[ValueId] {
    &builder.blocks[block.index()].values
}

fn opcode_of(builder: &FunctionBuilder, value: ValueId) -> Option<Opcode> {
    match builder.values[value.index()].definition {
        PendingDefinition::Operation { opcode, .. } => Some(opcode),
        PendingDefinition::Parameter { .. } => None,
    }
}

fn declared_parameter_type(builder: &FunctionBuilder, value: ValueId) -> Option<TypeId> {
    match builder.values[value.index()].definition {
        PendingDefinition::Parameter { declared } => declared,
        PendingDefinition::Operation { .. } => panic!("{value} is no parameter"),
    }
}

fn dominator_of(builder: &FunctionBuilder, block: BlockId) -> DominatorLink {
    let dominator = builder.ssa.states[block.index()].dominator;
    dominator.expect("a sealed block has a dominator link")
}

#[test]
fn scratch_keeps_cleared_lists() {
    let mut state = SsaState::default();
    state.add_block();
    state.create_variable(None);
    let (block, variable, value) = (BlockId::new(0), LocalVariable(0), ValueId::new(0));
    state.definitions.insert(block, variable, value);
    state.observed_values.insert(value);
    state
        .pending_reads
        .push(PendingRead::SinglePredecessor(block));
    let vector_capacities = [
        state.states.capacity(),
        state.pending_reads.capacity(),
        state.variables.capacity(),
    ];
    let table_capacities = [
        state.definitions.0.capacity(),
        state.observed_values.capacity(),
    ];

    let scratch = state.recycle();
    assert!(scratch.states.is_empty());
    assert!(scratch.pending_reads.is_empty());
    assert!(scratch.variables.is_empty());
    assert!(scratch.definitions.0.is_empty());
    assert!(scratch.observed_values.is_empty());
    let recycled_vector_capacities = [
        scratch.states.capacity(),
        scratch.pending_reads.capacity(),
        scratch.variables.capacity(),
    ];
    assert_eq!(recycled_vector_capacities, vector_capacities);
    let recycled_table_capacities = [
        scratch.definitions.0.capacity(),
        scratch.observed_values.capacity(),
    ];
    assert_eq!(recycled_table_capacities, table_capacities);
}

#[test]
fn scratch_drops_oversized_lists() {
    let mut state = SsaState::default();
    state.states.reserve(MAX_SPARE_BLOCK_STATES + 1);
    state.definitions.0.reserve(MAX_SPARE_DEFINITIONS + 1);
    state.pending_reads.reserve(MAX_SPARE_PENDING_READS + 1);
    state.observed_values.reserve(MAX_SPARE_OBSERVED_VALUES + 1);
    state.variables.reserve(MAX_SPARE_VARIABLES + 1);
    let scratch = state.recycle();
    assert_eq!(scratch.states.capacity(), 0);
    assert_eq!(scratch.definitions.0.capacity(), 0);
    assert_eq!(scratch.pending_reads.capacity(), 0);
    assert_eq!(scratch.observed_values.capacity(), 0);
    assert_eq!(scratch.variables.capacity(), 0);
}

#[test]
fn variables_are_numbered_in_creation_order() {
    let mut state = SsaState::default();
    assert_eq!(state.variable_count(), 0);
    assert_eq!(state.create_variable(None), LocalVariable(0));
    assert_eq!(
        state.create_variable(Some(TypeTable::NUMBER)),
        LocalVariable(1)
    );
    assert_eq!(state.variable_count(), 2);
}

#[test]
fn straight_line_read_returns_written_value() {
    let mut builder = create_builder(&[TypeTable::NUMBER]);
    let value = builder.parameter(0);
    let variable = builder.create_variable(None);
    builder.write_variable(variable, value);
    assert_eq!(builder.read_variable(variable), value);
    let next = enter_block(&mut builder, None);
    assert_eq!(builder.read_variable(variable), value);
    assert!(variable_parameters(&builder, next).is_empty());
}

#[test]
fn single_store_is_read_in_dominated_blocks() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN, TypeTable::NUMBER]);
    let (condition, value) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    builder.write_variable(variable, value);
    let diamond = write_diamond(&mut builder, condition, variable, [None, None]);
    let value_count = builder.values.len();
    assert_eq!(
        builder.ssa.find_dominating_store(variable, diamond.join),
        Some(value)
    );
    assert_eq!(builder.read_variable(variable), value);
    assert_eq!(builder.values.len(), value_count);
    assert_eq!(builder.ssa.definitions.get(diamond.join, variable), None);
}

#[test]
fn later_store_in_open_block_replaces_single_store() {
    let mut builder = create_builder(&[TypeTable::NUMBER, TypeTable::NUMBER]);
    let (first, second) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    builder.write_variable(variable, first);
    builder.write_variable(variable, second);
    let next = enter_block(&mut builder, None);
    assert_eq!(
        builder.ssa.find_dominating_store(variable, next),
        Some(second)
    );
    assert_eq!(builder.read_variable(variable), second);
}

#[test]
fn store_in_another_block_ends_single_store() {
    let mut builder = create_builder(&[TypeTable::NUMBER, TypeTable::NUMBER]);
    let (first, second) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    builder.write_variable(variable, first);
    enter_block(&mut builder, None);
    builder.write_variable(variable, second);
    let next = enter_block(&mut builder, None);
    assert_eq!(builder.ssa.find_dominating_store(variable, next), None);
    assert_eq!(builder.read_variable(variable), second);
}

#[test]
fn store_in_one_arm_does_not_dominate_join() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN, TypeTable::NUMBER]);
    let (condition, value) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    let entry = builder.current_block();
    let diamond = write_diamond(&mut builder, condition, variable, [Some(value), None]);
    assert_eq!(
        builder.ssa.find_dominating_store(variable, diamond.join),
        None
    );

    let joined = builder.read_variable(variable);
    assert_eq!(variable_parameters(&builder, diamond.join), [joined]);
    assert_eq!(variable_arguments(&builder, diamond.arms[0], 0), [value]);
    let &[undefined] = variable_arguments(&builder, diamond.arms[1], 0) else {
        panic!("the edge passes one argument");
    };
    assert_eq!(opcode_of(&builder, undefined), Some(Opcode::Undefined));
    assert_eq!(values_of(&builder, entry), [undefined]);
}

#[test]
fn diamond_with_different_values_has_one_parameter() {
    let parameters = [TypeTable::BOOLEAN, TypeTable::NUMBER, TypeTable::NUMBER];
    let mut builder = create_builder(&parameters);
    let [condition, first, second] = [0, 1, 2].map(|index| builder.parameter(index));
    let variable = builder.create_variable(None);
    let values = [Some(first), Some(second)];
    let diamond = write_diamond(&mut builder, condition, variable, values);

    let joined = builder.read_variable(variable);
    assert_eq!(variable_parameters(&builder, diamond.join), [joined]);
    let join = &builder.blocks[diamond.join.index()];
    assert!(join.parameters.is_empty() && join.edge_results.is_empty());
    assert_eq!(variable_arguments(&builder, diamond.arms[0], 0), [first]);
    assert_eq!(variable_arguments(&builder, diamond.arms[1], 0), [second]);
    assert_eq!(builder.read_variable(variable), joined);
    assert_eq!(variable_parameters(&builder, diamond.join), [joined]);
}

#[test]
fn diamond_with_same_value_has_no_parameter() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN, TypeTable::NUMBER]);
    let (condition, same) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    let diamond = write_diamond(&mut builder, condition, variable, [Some(same), Some(same)]);
    let value_count = builder.values.len();

    assert_eq!(builder.read_variable(variable), same);
    assert!(variable_parameters(&builder, diamond.join).is_empty());
    for arm in diamond.arms {
        assert!(variable_arguments(&builder, arm, 0).is_empty());
    }
    assert_eq!(builder.values.len(), value_count);
    assert_eq!(
        builder.ssa.definitions.get(diamond.join, variable),
        Some(same)
    );
}

#[test]
fn parameter_before_last_is_not_removed() {
    let mut builder = create_builder(&[TypeTable::NUMBER]);
    let value = builder.parameter(0);
    let [first, second] = [(); 2].map(|()| builder.create_variable(None));
    builder.write_variable(first, value);
    builder.write_variable(second, value);
    let entry = builder.current_block();
    let next = builder.create_block(None);
    builder.jump(Edge::to(next));
    builder.switch_to(next);
    let parameters = [first, second].map(|variable| builder.read_variable(variable));
    builder.seal(next);

    assert!(!builder.try_remove_parameter(next, parameters[0], &[entry]));
    assert_eq!(variable_parameters(&builder, next), parameters);
    assert_eq!(variable_arguments(&builder, entry, 0), [value, value]);

    assert!(builder.try_remove_parameter(next, parameters[1], &[entry]));
    assert_eq!(variable_parameters(&builder, next), [parameters[0]]);
    assert_eq!(variable_arguments(&builder, entry, 0), [value]);
}

#[test]
fn observed_join_parameter_is_not_removed() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN, TypeTable::NUMBER]);
    let (condition, value) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    builder.write_variable(variable, value);
    let entry = builder.current_block();
    let [header, left, right, latch, exit] = create_blocks(&mut builder);
    builder.jump(Edge::to(header));
    builder.switch_to(header);
    builder.branch(condition, Edge::to(left), Edge::to(right));
    for block in [left, right] {
        builder.seal(block);
        builder.switch_to(block);
        builder.jump(Edge::to(latch));
    }
    builder.seal(latch);
    builder.switch_to(latch);
    builder.branch(condition, Edge::to(header), Edge::to(exit));
    builder.seal(header);
    builder.seal(exit);

    let latch_parameter = builder.read_variable(variable);
    let &[header_parameter] = variable_parameters(&builder, header) else {
        panic!("the header has one parameter");
    };
    assert_eq!(variable_parameters(&builder, latch), [latch_parameter]);
    assert_eq!(variable_arguments(&builder, entry, 0), [value]);
    assert_eq!(variable_arguments(&builder, latch, 0), [latch_parameter]);
    assert!(variable_arguments(&builder, latch, 1).is_empty());
    assert_eq!(variable_arguments(&builder, left, 0), [header_parameter]);
    assert_eq!(variable_arguments(&builder, right, 0), [header_parameter]);
    assert!(builder.ssa.observed_values.is_empty());
    assert!(builder.ssa.pending_reads.is_empty());
}

#[test]
fn loop_parameter_only_for_modified_variable() {
    let number = TypeTable::NUMBER;
    let mut builder = create_builder(&[TypeTable::BOOLEAN, TypeTable::STRING, number, number]);
    let [condition, invariant, initial, updated] =
        [0, 1, 2, 3].map(|index| builder.parameter(index));
    let [modified, read_only] = [(); 2].map(|()| builder.create_variable(None));
    builder.write_variable(read_only, invariant);
    builder.write_variable(modified, initial);
    let entry = builder.current_block();
    let [header, body, exit] = create_blocks(&mut builder);
    builder.declare_loop_header(header, &[modified]);
    assert_eq!(variable_parameters(&builder, header).len(), 1);
    builder.jump(Edge::to(header));
    builder.switch_to(header);
    let counter = builder.read_variable(modified);
    builder.branch(condition, Edge::to(body), Edge::to(exit));
    builder.seal(body);

    builder.switch_to(body);
    assert_eq!(builder.read_variable(read_only), invariant);
    builder.write_variable(modified, updated);
    builder.jump(Edge::to(header));
    builder.seal(header);
    builder.seal(exit);

    builder.switch_to(exit);
    assert_eq!(builder.read_variable(read_only), invariant);
    assert_eq!(builder.read_variable(modified), counter);
    assert_eq!(variable_parameters(&builder, header), [counter]);
    assert_eq!(variable_arguments(&builder, entry, 0), [initial]);
    assert_eq!(variable_arguments(&builder, body, 0), [updated]);
}

#[test]
fn variable_listed_twice_as_modified_has_one_parameter() {
    let mut builder = create_builder(&[]);
    let variable = builder.create_variable(None);
    let header = builder.create_block(None);
    builder.declare_loop_header(header, &[variable, variable]);
    assert_eq!(variable_parameters(&builder, header).len(), 1);
}

#[test]
fn unsealed_block_without_loop_declaration_gets_parameter() {
    let mut builder = create_builder(&[TypeTable::STRING]);
    let value = builder.parameter(0);
    let variable = builder.create_variable(None);
    builder.write_variable(variable, value);
    let entry = builder.current_block();
    let header = builder.create_block(None);
    builder.jump(Edge::to(header));
    builder.switch_to(header);

    let parameter = builder.read_variable(variable);
    assert_ne!(parameter, value);
    assert_eq!(variable_parameters(&builder, header), [parameter]);
    assert!(variable_arguments(&builder, entry, 0).is_empty());
    assert_eq!(builder.read_variable(variable), parameter);
    assert_eq!(variable_parameters(&builder, header), [parameter]);

    builder.seal(header);
    assert_eq!(variable_arguments(&builder, entry, 0), [value]);
    builder.seal(header);
    assert_eq!(variable_arguments(&builder, entry, 0), [value]);
}

#[test]
fn unwritten_variable_reads_undefined_at_entry_head() {
    let mut builder = create_builder(&[]);
    let first = builder.integer(7);
    let variable = builder.create_variable(None);
    let entry = builder.current_block();
    let next = enter_block(&mut builder, None);

    let value = builder.read_variable(variable);
    assert_eq!(values_of(&builder, entry), [value, first]);
    assert_eq!(opcode_of(&builder, value), Some(Opcode::Undefined));
    assert!(variable_parameters(&builder, next).is_empty());
    assert_eq!(builder.read_variable(variable), value);
    assert_eq!(values_of(&builder, entry), [value, first]);
}

#[test]
fn read_in_dead_block_is_undefined_there() {
    let mut builder = create_builder(&[TypeTable::NUMBER]);
    let reachable_value = builder.parameter(0);
    let variable = builder.create_variable(None);
    builder.write_variable(variable, reachable_value);
    let entry = builder.current_block();
    let dead = builder.create_block(None);
    builder.seal(dead);
    builder.switch_to(dead);

    let value = builder.read_variable(variable);
    assert_eq!(opcode_of(&builder, value), Some(Opcode::Undefined));
    assert_eq!(values_of(&builder, dead), [value]);
    assert!(values_of(&builder, entry).is_empty());
}

#[test]
fn read_in_unreachable_cycle_is_undefined() {
    let mut builder = create_builder(&[TypeTable::NUMBER]);
    let reachable_value = builder.parameter(0);
    let variable = builder.create_variable(None);
    builder.write_variable(variable, reachable_value);
    let [first, second] = create_blocks(&mut builder);
    builder.switch_to(first);
    builder.jump(Edge::to(second));
    builder.switch_to(second);
    builder.jump(Edge::to(first));
    builder.seal(first);
    builder.seal(second);

    let value = builder.read_variable(variable);
    assert_eq!(opcode_of(&builder, value), Some(Opcode::Undefined));
    let cycle_values = [values_of(&builder, first), values_of(&builder, second)].concat();
    assert_eq!(cycle_values, [value]);
    for block in [first, second] {
        assert!(variable_parameters(&builder, block).is_empty());
        builder.switch_to(block);
        assert_eq!(builder.read_variable(variable), value);
    }
}

#[test]
fn loop_parameter_of_declared_variable_has_declared_type() {
    let mut builder = create_builder(&[]);
    let initial = builder.integer(0);
    let variable = builder.create_variable(Some(TypeTable::NUMBER));
    builder.write_variable(variable, initial);
    let header = builder.create_block(None);
    builder.declare_loop_header(header, &[variable]);
    builder.jump(Edge::to(header));
    builder.switch_to(header);
    let counter = builder.read_variable(variable);
    builder.jump(Edge::to(header));
    builder.seal(header);
    assert_eq!(variable_parameters(&builder, header), [counter]);
    assert_eq!(
        declared_parameter_type(&builder, counter),
        Some(TypeTable::NUMBER)
    );
}

#[test]
fn join_parameter_of_declared_variable_has_declared_type() {
    let parameters = [TypeTable::BOOLEAN, TypeTable::NUMBER, TypeTable::NUMBER];
    let mut builder = create_builder(&parameters);
    let [condition, first, second] = [0, 1, 2].map(|index| builder.parameter(index));
    let variable = builder.create_variable(Some(TypeTable::STRING));
    write_diamond(
        &mut builder,
        condition,
        variable,
        [Some(first), Some(second)],
    );
    let joined = builder.read_variable(variable);
    assert_eq!(
        declared_parameter_type(&builder, joined),
        Some(TypeTable::STRING)
    );
}

#[test]
fn parameter_of_undeclared_variable_has_no_type() {
    let parameters = [TypeTable::BOOLEAN, TypeTable::NUMBER, TypeTable::NUMBER];
    let mut builder = create_builder(&parameters);
    let [condition, first, second] = [0, 1, 2].map(|index| builder.parameter(index));
    let variable = builder.create_variable(None);
    write_diamond(
        &mut builder,
        condition,
        variable,
        [Some(first), Some(second)],
    );
    let joined = builder.read_variable(variable);
    assert_eq!(declared_parameter_type(&builder, joined), None);

    let unsealed = builder.create_block(None);
    builder.switch_to(unsealed);
    let incomplete = builder.read_variable(variable);
    assert_eq!(declared_parameter_type(&builder, incomplete), None);
}

#[test]
fn chain_links_each_block_below_predecessor() {
    const LENGTH: usize = 40;
    let mut builder = create_builder(&[]);
    let mut chain = vec![builder.current_block()];
    chain.extend((1..LENGTH).map(|_| enter_block(&mut builder, None)));
    for (depth, &block) in chain.iter().enumerate() {
        let link = dominator_of(&builder, block);
        assert_eq!(link.depth as usize, depth);
        assert_eq!(link.root, chain[0]);
        assert_eq!(link.parent, chain[depth.saturating_sub(1)]);
        assert!(dominator_of(&builder, link.jump).depth <= link.depth);
    }
    for &block in &chain {
        let block_depth = dominator_of(&builder, block).depth;
        for (depth, &ancestor) in (0..=block_depth).zip(&chain) {
            assert_eq!(builder.ssa.ancestor_at(block, depth), Some(ancestor));
        }
        assert_eq!(builder.ssa.ancestor_at(block, block_depth + 1), Some(block));
    }
}

#[test]
fn join_is_linked_below_branching_block() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN]);
    let condition = builder.parameter(0);
    let variable = builder.create_variable(None);
    enter_block(&mut builder, None);
    let branching = builder.current_block();
    let diamond = write_diamond(&mut builder, condition, variable, [None, None]);
    for block in [diamond.arms[0], diamond.arms[1], diamond.join] {
        let link = dominator_of(&builder, block);
        assert_eq!(
            (link.parent, link.depth, link.root),
            (branching, 2, ENTRY_BLOCK)
        );
    }
}

#[test]
fn lowest_common_ancestor_of_two_branches_is_branching_block() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN]);
    let condition = builder.parameter(0);
    let branching = enter_blocks(&mut builder, 3);
    let [left, right] = create_blocks(&mut builder);
    builder.branch(condition, Edge::to(left), Edge::to(right));
    builder.seal(left);
    builder.seal(right);
    builder.switch_to(left);
    let left_end = enter_blocks(&mut builder, 5);
    builder.switch_to(right);
    let right_end = enter_blocks(&mut builder, 9);

    let ssa = &builder.ssa;
    assert_eq!(
        ssa.lowest_common_ancestor(left_end, right_end),
        Some(branching)
    );
    assert_eq!(
        ssa.lowest_common_ancestor(right_end, left_end),
        Some(branching)
    );
    assert_eq!(ssa.lowest_common_ancestor(left, right_end), Some(branching));
    assert_eq!(ssa.lowest_common_ancestor(left_end, left), Some(left));
    assert_eq!(ssa.lowest_common_ancestor(left, left_end), Some(left));
    assert_eq!(
        ssa.lowest_common_ancestor(right_end, right_end),
        Some(right_end)
    );
    assert_eq!(
        ssa.lowest_common_ancestor(ENTRY_BLOCK, right_end),
        Some(ENTRY_BLOCK)
    );
}

#[test]
fn blocks_under_different_roots_have_no_common_ancestor() {
    let mut builder = create_builder(&[]);
    let reachable = enter_blocks(&mut builder, 2);
    let [dead, unsealed] = create_blocks(&mut builder);
    builder.seal(dead);
    let link = dominator_of(&builder, dead);
    assert_eq!((link.parent, link.depth, link.root), (dead, 0, dead));
    assert_eq!(builder.ssa.lowest_common_ancestor(dead, reachable), None);
    assert_eq!(builder.ssa.lowest_common_ancestor(reachable, dead), None);
    assert_eq!(
        builder.ssa.lowest_common_ancestor(unsealed, reachable),
        None
    );
    assert_eq!(builder.ssa.ancestor_at(unsealed, 0), None);
}

#[test]
fn block_sealed_before_predecessor_is_a_root() {
    let mut builder = create_builder(&[]);
    let [header, body] = create_blocks(&mut builder);
    builder.jump(Edge::to(header));
    builder.switch_to(header);
    builder.jump(Edge::to(body));
    builder.seal(body);
    assert_eq!(dominator_of(&builder, body).root, body);
    builder.seal(header);
    assert_eq!(dominator_of(&builder, header).root, ENTRY_BLOCK);
    assert_eq!(dominator_of(&builder, body).root, body);
}

#[test]
fn shortcut_skips_blocks_between_read_and_definition() {
    const CHAIN_LENGTH: usize = 100;
    let mut builder = create_builder(&[]);
    let variable = builder.create_variable(None);
    let stored = write_in_successive_blocks(&mut builder, variable, 2);
    enter_blocks(&mut builder, CHAIN_LENGTH);
    let definition_count = builder.ssa.definitions.0.len();
    assert_eq!(builder.read_variable(variable), stored);
    assert!(builder.ssa.definitions.0.len() <= definition_count + 3);
}

#[test]
fn walk_without_shortcut_finds_same_definition() {
    const CHAIN_LENGTH: usize = 100;
    let mut builder = create_builder(&[]);
    let variable = builder.create_variable(None);
    let block_count = MAX_SHORTCUT_DEFINITION_BLOCKS + 1;
    let stored = write_in_successive_blocks(&mut builder, variable, block_count);
    let last = enter_blocks(&mut builder, CHAIN_LENGTH);
    assert!(matches!(
        builder.ssa.find_shortcut(variable, last),
        Shortcut::No
    ));
    let definition_count = builder.ssa.definitions.0.len();
    assert_eq!(builder.read_variable(variable), stored);
    assert_eq!(
        builder.ssa.definitions.0.len(),
        definition_count + CHAIN_LENGTH
    );
}

#[test]
fn definition_blocks_are_recorded_up_to_one_past_shortcut_limit() {
    let mut builder = create_builder(&[]);
    let variable = builder.create_variable(None);
    write_in_successive_blocks(&mut builder, variable, MAX_SHORTCUT_DEFINITION_BLOCKS + 4);
    let definition_blocks = &builder.ssa.variables[variable.0 as usize].definition_blocks;
    assert_eq!(definition_blocks.len(), MAX_SHORTCUT_DEFINITION_BLOCKS + 1);

    let rewritten = builder.create_variable(None);
    for constant in 0..3 {
        let value = builder.integer(constant);
        builder.write_variable(rewritten, value);
    }
    let definition_blocks = &builder.ssa.variables[rewritten.0 as usize].definition_blocks;
    assert_eq!(definition_blocks[..], [builder.current_block()]);
}

#[test]
fn predecessors_are_unique_and_entered() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN]);
    let condition = builder.parameter(0);
    let entry = builder.current_block();
    let handler = create_catch_handler(&mut builder);
    let live = builder.create_block(Some(handler));
    builder.branch(condition, Edge::to(live), Edge::to(live));
    builder.seal(live);
    let dead = builder.create_block(Some(handler));
    builder.seal(dead);
    let unsealed = builder.create_block(Some(handler));

    assert_eq!(builder.ssa.predecessor_count(live), 2);
    assert_eq!(builder.ssa.unique_predecessors(live)[..], [entry]);
    assert_eq!(builder.ssa.predecessor_count(handler.block()), 3);
    assert_eq!(
        builder.ssa.unique_predecessors(handler.block())[..],
        [live, unsealed]
    );
    assert!(builder.ssa.is_never_entered(dead));
    for block in [entry, live, unsealed] {
        assert!(!builder.ssa.is_never_entered(block));
    }
}

#[test]
fn split_needs_open_covered_block_with_a_value_and_a_visible_variable() {
    let mut builder = create_builder(&[]);
    let visible = builder.create_variable(None);
    builder.undefined();
    assert!(!builder.must_split_before_store(visible));

    let handler = create_catch_handler(&mut builder);
    let inner = builder.create_variable(None);
    enter_block(&mut builder, Some(handler));
    assert!(!builder.must_split_before_store(visible));
    builder.undefined();
    assert!(builder.must_split_before_store(visible));
    assert!(!builder.must_split_before_store(inner));
    builder.return_value(None);
    assert!(!builder.must_split_before_store(visible));
}

#[test]
fn split_continues_in_sealed_block_under_same_handler() {
    let mut builder = create_builder(&[]);
    let handler = create_catch_handler(&mut builder);
    let covered = enter_block(&mut builder, Some(handler));
    builder.set_frequency(covered, BlockFrequency::Unlikely);
    builder.undefined();

    builder.split_current_block();
    let next = builder.current_block();
    assert_ne!(next, covered);
    assert!(builder.is_open());
    assert!(builder.ssa.is_sealed(next));
    assert_eq!(builder.handler_of(next), Some(handler));
    assert_eq!(
        builder.blocks[next.index()].frequency,
        BlockFrequency::Unlikely
    );
    assert_eq!(builder.ssa.states[next.index()].predecessors[..], [covered]);
    let landing = &builder.ssa.states[handler.block().index()];
    assert_eq!(landing.predecessors[..], [covered, next]);
    let terminator = builder.blocks[covered.index()].terminator.as_ref();
    let terminator = terminator.expect("the split closes the block");
    assert_eq!(terminator.kind, TerminatorKind::Jump);
    let targets: Vec<BlockId> = terminator
        .targets
        .iter()
        .map(|target| target.block)
        .collect();
    assert_eq!(targets, [next]);
}

#[test]
fn store_after_split_is_defined_in_next_block_only() {
    let mut builder = create_builder(&[TypeTable::NUMBER, TypeTable::NUMBER]);
    let (before, after) = (builder.parameter(0), builder.parameter(1));
    let variable = builder.create_variable(None);
    builder.write_variable(variable, before);
    let handler = create_catch_handler(&mut builder);
    let covered = enter_block(&mut builder, Some(handler));
    builder.undefined();
    builder.write_variable(variable, after);
    let next = builder.current_block();
    assert_ne!(next, covered);
    assert_eq!(builder.ssa.definitions.get(covered, variable), None);
    assert_eq!(builder.ssa.definitions.get(next, variable), Some(after));

    builder.return_value(None);
    builder.seal(handler.block());
    builder.switch_to(handler.block());
    let caught = builder.read_variable(variable);
    assert_eq!(variable_parameters(&builder, handler.block()), [caught]);
    assert_eq!(handler_arguments(&builder, covered), [before]);
    assert_eq!(handler_arguments(&builder, next), [after]);
    assert!(variable_arguments(&builder, covered, 0).is_empty());
}

#[test]
fn removed_handler_parameter_pops_handler_arguments() {
    let mut builder = create_builder(&[]);
    let [unchanged, changed] = [(); 2].map(|()| builder.create_variable(None));
    let block_count = MAX_SHORTCUT_DEFINITION_BLOCKS + 1;
    let stored = write_in_successive_blocks(&mut builder, unchanged, block_count);
    let handler = create_catch_handler(&mut builder);
    let first = enter_block(&mut builder, Some(handler));
    let other = builder.integer(-1);
    builder.write_variable(changed, other);
    let second = builder.current_block();
    assert_ne!(second, first);
    builder.return_value(None);
    builder.seal(handler.block());
    builder.switch_to(handler.block());
    let value_count = builder.values.len();

    assert_eq!(builder.read_variable(unchanged), stored);
    assert!(variable_parameters(&builder, handler.block()).is_empty());
    assert!(handler_arguments(&builder, first).is_empty());
    assert!(handler_arguments(&builder, second).is_empty());
    assert_eq!(builder.values.len(), value_count);
}
