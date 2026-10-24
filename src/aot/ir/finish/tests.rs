use super::*;
use crate::ir::body::{BlockView, ValueView};
use crate::ir::builder::Edge;
use crate::ir::generated::{
    BlockFrequency, BlockRole, FunctionFlags, TemplateString, TerminatorKind,
};
use crate::ir::ids::{ABSENT_WORD, ExpectedResultId, LayoutId, PropertyKeyId, StringId};
use crate::ir::testing::{build_function, create_blocks, function_with_parameters};
use crate::ir::types::TypeTable;

const DROPPED_VALUE_COUNT: usize = 3;

type Target = (usize, Vec<ValueId>, Vec<u32>);

fn build(parameters: &[TypeId], fill: impl FnOnce(&mut FunctionBuilder)) -> Body {
    build_function(parameters, fill).body
}

fn create_builder(parameters: &[TypeId], scratch: BuilderScratch) -> FunctionBuilder {
    let function = function_with_parameters(FunctionFlags::default(), parameters);
    FunctionBuilder::new(function, scratch)
}

fn emit_dropped_values(builder: &mut FunctionBuilder) {
    let current = builder.current_block();
    let dead = builder.create_block(None);
    builder.seal(dead);
    builder.switch_to(dead);
    for _ in 0..DROPPED_VALUE_COUNT {
        builder.undefined();
    }
    builder.unreachable();
    builder.switch_to(current);
}

fn value(index: usize) -> ValueId {
    ValueId::new(index)
}

fn entry_of(body: &Body) -> BlockView<'_> {
    body.blocks().next().expect("the body has an entry block")
}

fn last_value_of(body: &Body) -> ValueView<'_> {
    let values = entry_of(body).values();
    values.last().expect("the entry block lists a value")
}

fn integer_constants(block: &BlockView<'_>) -> Vec<i64> {
    let integers = block
        .values()
        .filter(|value| value.opcode == Opcode::Integer);
    integers
        .map(|value| ((u64::from(value.fields[1]) << 32) | u64::from(value.fields[0])) as i64)
        .collect()
}

fn targets_of(block: &BlockView<'_>) -> Vec<Target> {
    let targets = block.terminator().targets();
    targets
        .map(|target| {
            (
                target.block.index(),
                target.arguments().collect(),
                target.proofs.to_vec(),
            )
        })
        .collect()
}

fn target_to(block: usize) -> Target {
    (block, Vec::new(), Vec::new())
}

#[test]
fn call_round_trip() {
    let body = build(&[TypeTable::ANYTHING; 4], |builder| {
        let [callee, this_value, first, last] = [0, 1, 2, 3].map(|index| builder.parameter(index));
        emit_dropped_values(builder);
        let middle = builder.undefined();
        assert_eq!(middle, value(4 + DROPPED_VALUE_COUNT));
        let key = PropertyKeyId::new(middle.index());
        let name = StringId::new(middle.index());
        let expected_result = ExpectedResultId::new(middle.index());
        let arguments = [first, middle, last];
        builder.set_position(Some(17));
        builder.call(
            callee,
            Some(this_value),
            &arguments,
            Some(key),
            Some(name),
            Some(expected_result),
            true,
            false,
        );
        builder.set_position(None);
        builder.call(callee, None, &[], None, None, None, false, true);
        builder.return_value(None);
    });
    let values: Vec<ValueView<'_>> = entry_of(&body).values().collect();
    let [_, with_this, without_this] = values[..] else {
        panic!("the entry block lists three values");
    };
    let reference = (4 + DROPPED_VALUE_COUNT) as u32;
    assert_eq!((with_this.id, with_this.opcode), (value(5), Opcode::Call));
    assert_eq!(with_this.position, Some(17));
    assert_eq!(
        with_this.fields,
        [1, 0, 1, 3, 2, 4, 3, reference, reference, reference]
    );

    assert_eq!(
        (without_this.id, without_this.opcode),
        (value(6), Opcode::Call)
    );
    assert_eq!(without_this.position, None);
    let absent = ABSENT_WORD;
    assert_eq!(
        without_this.fields,
        [2, 0, absent, 0, absent, absent, absent]
    );
}

#[test]
fn new_object_round_trip() {
    let body = build(&[TypeTable::ANYTHING], |builder| {
        let first = builder.parameter(0);
        emit_dropped_values(builder);
        let second = builder.undefined();
        let prototype = builder.null();
        let layout = LayoutId::new(second.index());
        builder.new_object(layout, &[5, 4], Some(prototype), &[second, first]);
        builder.new_object(layout, &[], None, &[]);
        builder.return_value(None);
    });
    let values: Vec<ValueView<'_>> = entry_of(&body).values().collect();
    let [_, _, with_fields, without_fields] = values[..] else {
        panic!("the entry block lists four values");
    };
    let layout = (1 + DROPPED_VALUE_COUNT) as u32;
    assert_eq!(with_fields.opcode, Opcode::NewObject);
    assert_eq!(with_fields.fields, [layout, 2, 5, 4, 2, 2, 1, 0]);
    assert_eq!(without_fields.fields, [layout, 0, ABSENT_WORD, 0]);
}

#[test]
fn negative_integer_round_trip() {
    let body = build(&[], |builder| {
        emit_dropped_values(builder);
        for constant in [-1, i64::MIN, i64::MAX, 3] {
            builder.integer(constant);
        }
        builder.return_value(None);
    });
    let fields: Vec<&[u32]> = entry_of(&body).values().map(|value| value.fields).collect();
    let expected: [&[u32]; 4] = [
        &[u32::MAX, u32::MAX],
        &[0, 1 << 31],
        &[u32::MAX, u32::MAX >> 1],
        &[3, 0],
    ];
    assert_eq!(fields, expected);
    assert_eq!(
        integer_constants(&entry_of(&body)),
        [-1, i64::MIN, i64::MAX, 3]
    );
}

#[test]
fn template_object_round_trip() {
    let [cooked, raw, other_raw] = [4, 5, 6].map(StringId::new);
    let body = build(&[], |builder| {
        emit_dropped_values(builder);
        builder.new_template_object(&[
            TemplateString {
                cooked: Some(cooked),
                raw,
            },
            TemplateString {
                cooked: None,
                raw: other_raw,
            },
        ]);
        builder.return_value(None);
    });
    let template = last_value_of(&body);
    assert_eq!(template.opcode, Opcode::NewTemplateObject);
    assert_eq!(template.fields, [2, 4, 5, ABSENT_WORD, 6]);
}

#[test]
fn switch_round_trip() {
    let body = build(&[], |builder| {
        emit_dropped_values(builder);
        let subject = builder.undefined();
        let [otherwise, third, second, first] = create_blocks(builder);
        let cases = [first, second, third].map(Edge::to);
        builder.set_position(Some(3));
        builder.switch(subject, &[-1, 0, 1 << 40], &cases, Edge::to(otherwise));
        for block in [first, second, third, otherwise] {
            builder.seal(block);
            builder.switch_to(block);
            builder.return_value(None);
        }
    });
    assert_eq!(body.block_count, 5);
    let terminator = entry_of(&body).terminator();
    assert_eq!(terminator.kind, TerminatorKind::Switch);
    assert_eq!(terminator.position, Some(3));
    assert_eq!(
        terminator.fields,
        [0, 3, u32::MAX, u32::MAX, 0, 0, 0, 1 << 8]
    );
    assert_eq!(terminator.target_count(), 4);
    assert_eq!(targets_of(&entry_of(&body)), [1, 2, 3, 4].map(target_to));
}

#[test]
fn throw_round_trip() {
    let body = build(&[TypeTable::ANYTHING], |builder| {
        let thrown = builder.parameter(0);
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let covered = builder.create_block(Some(handler));
        builder.jump(Edge::to(covered));
        builder.seal(covered);
        builder.seal(handler.block());
        builder.switch_to(covered);
        builder.set_position(Some(9));
        builder.throw(thrown);
        builder.switch_to(handler.block());
        builder.set_position(None);
        let caught = builder.catch_value();
        builder.throw(caught);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let [_, covered, landing] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    let with_handler = covered.terminator();
    assert_eq!(with_handler.kind, TerminatorKind::Throw);
    assert_eq!(with_handler.position, Some(9));
    assert_eq!(with_handler.fields, [0]);
    assert_eq!(with_handler.target_count(), 0);
    let handler = covered.handler().expect("the block names its handler");
    assert_eq!(handler.block, landing.id);

    let without_handler = landing.terminator();
    assert_eq!(without_handler.kind, TerminatorKind::Throw);
    assert_eq!(without_handler.position, None);
    assert_eq!(without_handler.fields, [1]);
    assert_eq!(without_handler.targets().count(), 0);
    assert!(landing.handler().is_none());
}

#[test]
fn open_block_ends_unreachable() {
    let body = build(&[], |builder| {
        let open = builder.create_block(None);
        builder.set_position(Some(5));
        builder.jump(Edge::to(open));
        builder.seal(open);
        builder.switch_to(open);
        builder.integer(1);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let [entry, open] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    assert_eq!(entry.terminator().kind, TerminatorKind::Jump);
    let terminator = open.terminator();
    assert_eq!(terminator.kind, TerminatorKind::Unreachable);
    assert_eq!(terminator.position, None);
    assert!(terminator.fields.is_empty());
    assert_eq!(terminator.target_count(), 0);
    assert_eq!(integer_constants(&open), [1]);
}

#[test]
fn diamond_order() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [join, not_taken, taken] = create_blocks(builder);
        let joined = builder.add_parameter(join, Some(TypeTable::NUMBER));
        builder.branch(condition, Edge::to(taken), Edge::to(not_taken));
        for (block, constant) in [(not_taken, 2), (taken, 1)] {
            builder.seal(block);
            builder.switch_to(block);
            let constant = builder.integer(constant);
            builder.jump(Edge::with_arguments(join, &[constant]));
        }
        builder.seal(join);
        builder.switch_to(join);
        builder.return_value(Some(joined));
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    assert_eq!(blocks.len(), 4);
    assert_eq!(body.value_count, 4);
    assert_eq!(targets_of(&blocks[0]), [1, 2].map(target_to));
    assert_eq!(integer_constants(&blocks[1]), [1]);
    assert_eq!(targets_of(&blocks[1]), [(3, vec![value(1)], Vec::new())]);
    assert_eq!(integer_constants(&blocks[2]), [2]);
    assert_eq!(targets_of(&blocks[2]), [(3, vec![value(2)], Vec::new())]);
    assert_eq!(blocks[3].id, BlockId::new(3));
    assert_eq!(blocks[3].first_parameter, value(3));
    assert_eq!(blocks[3].first_value(), value(4));
    let parameter_types: Vec<Option<TypeId>> = blocks[3].parameter_types().collect();
    assert_eq!(parameter_types, [Some(TypeTable::NUMBER)]);
    assert_eq!(blocks[3].terminator().fields, [3]);
}

#[test]
fn loop_header_precedes_loop_body() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [exit, loop_body, header] = create_blocks(builder);
        builder.jump(Edge::to(header));
        builder.switch_to(header);
        builder.integer(1);
        builder.branch(condition, Edge::to(loop_body), Edge::to(exit));
        builder.seal(loop_body);
        builder.switch_to(loop_body);
        builder.integer(2);
        builder.jump(Edge::to(header));
        builder.seal(header);
        builder.seal(exit);
        builder.switch_to(exit);
        builder.integer(3);
        builder.return_value(None);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let constants: Vec<Vec<i64>> = body
        .blocks()
        .map(|block| integer_constants(&block))
        .collect();
    assert_eq!(constants, [vec![], vec![1], vec![2], vec![3]]);
    assert_eq!(targets_of(&blocks[1]), [2, 3].map(target_to));
    assert_eq!(targets_of(&blocks[2]), [target_to(1)]);
}

#[test]
fn block_without_predecessors_is_dropped() {
    let body = build(&[], |builder| {
        let entry = builder.current_block();
        let dead = builder.create_block(None);
        builder.seal(dead);
        builder.integer(1);
        builder.switch_to(dead);
        let dropped = builder.integer(2);
        builder.return_value(Some(dropped));
        builder.switch_to(entry);
        let last = builder.integer(3);
        builder.return_value(Some(last));
    });
    assert_eq!((body.block_count, body.value_count), (1, 2));
    let entry = entry_of(&body);
    assert_eq!(integer_constants(&entry), [1, 3]);
    let ids: Vec<ValueId> = entry.values().map(|value| value.id).collect();
    assert_eq!(ids, [value(0), value(1)]);
    assert_eq!(entry.terminator().fields, [1]);
}

#[test]
#[cfg_attr(debug_assertions, should_panic(expected = "no reached block lists"))]
fn use_of_dropped_value_is_out_of_range() {
    let body = build(&[], |builder| {
        let entry = builder.current_block();
        let dead = builder.create_block(None);
        builder.seal(dead);
        builder.switch_to(dead);
        let dropped = builder.integer(1);
        builder.unreachable();
        builder.switch_to(entry);
        builder.undefined();
        builder.return_value(Some(dropped));
    });
    assert_eq!(body.value_count, 1);
    assert_eq!(entry_of(&body).terminator().fields, [body.value_count]);
}

#[test]
fn listed_value_is_renumbered() {
    let numbers = [Some(value(3)), None, Some(value(0))];
    assert_eq!(number_of(&numbers, 9, value(0)), 3);
    assert_eq!(number_of(&numbers, 9, value(2)), 0);
}

#[test]
fn handler_is_a_successor() {
    let mut builder = create_builder(&[TypeTable::BOOLEAN], BuilderScratch::default());
    let condition = builder.parameter(0);
    let entry = builder.current_block();
    let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
    let [branching, returning] = [(); 2].map(|()| builder.create_block(Some(handler)));
    let uncovered = builder.create_block(None);
    builder.jump(Edge::to(branching));
    builder.switch_to(branching);
    builder.branch(condition, Edge::to(returning), Edge::to(uncovered));
    for block in [returning, uncovered] {
        builder.switch_to(block);
        builder.return_value(None);
    }

    let successors_of = |block: BlockId| -> Vec<BlockId> {
        let block = &builder.blocks[block.index()];
        let indices = 0..successor_count(block);
        indices.map(|index| successor(block, index)).collect()
    };
    assert_eq!(successors_of(entry), [branching]);
    assert_eq!(
        successors_of(branching),
        [returning, uncovered, handler.block()]
    );
    assert_eq!(successors_of(returning), [handler.block()]);
    assert!(successors_of(uncovered).is_empty());
}

#[test]
fn landing_block_follows_covered_blocks() {
    let body = build(&[], |builder| {
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let [first, second] = [(); 2].map(|()| builder.create_block(Some(handler)));
        let after = builder.create_block(None);
        for (constant, block) in (1..).zip([first, second]) {
            builder.jump(Edge::to(block));
            builder.seal(block);
            builder.switch_to(block);
            builder.integer(constant);
        }
        builder.jump(Edge::to(after));
        builder.seal(handler.block());
        builder.switch_to(handler.block());
        builder.integer(3);
        builder.jump(Edge::to(after));
        builder.seal(after);
        builder.switch_to(after);
        builder.integer(4);
        builder.return_value(None);
    });
    let constants: Vec<Vec<i64>> = body
        .blocks()
        .map(|block| integer_constants(&block))
        .collect();
    assert_eq!(constants, [vec![], vec![1], vec![2], vec![3], vec![4]]);
    let landing = body.blocks().nth(3).expect("the body has five blocks");
    assert_eq!(landing.role, BlockRole::CatchHandler);
}

#[test]
fn unreached_blocks_have_no_number() {
    let mut builder = create_builder(&[], BuilderScratch::default());
    let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
    let dead = builder.create_block(Some(handler));
    let next = builder.create_block(None);
    builder.jump(Edge::to(next));
    let FunctionBuilder { mut blocks, .. } = builder;
    close_open_blocks(&mut blocks);

    let mut scratch = FinishScratch::default();
    scratch.order_blocks(&blocks);
    assert_eq!(scratch.order, [ENTRY_BLOCK, next]);
    let mut expected_numbers = [None; 4];
    expected_numbers[ENTRY_BLOCK.index()] = Some(BlockId::new(0));
    expected_numbers[next.index()] = Some(BlockId::new(1));
    assert_eq!(scratch.block_numbers, expected_numbers);
    assert!(!scratch.is_reached[dead.index()]);
    assert!(!scratch.is_reached[handler.block().index()]);
    assert!(scratch.stack.is_empty());
}

fn fill_join_with_every_kind_of_parameter(builder: &mut FunctionBuilder) {
    let passed = builder.parameter(0);
    let variable = builder.create_variable(Some(TypeTable::NUMBER));
    let stored = builder.integer(7);
    builder.write_variable(variable, stored);
    let test = builder.type_test(passed, TypeTable::STRING);
    let [join, other] = create_blocks(builder);
    let explicit = builder.add_parameter(join, Some(TypeTable::STRING));
    let edge_result = builder.add_edge_result(join);
    let edge_with_proof = Edge {
        block: join,
        arguments: &[passed],
        proofs: &[0],
    };
    builder.branch(test, edge_with_proof, Edge::to(other));
    builder.seal(other);

    builder.switch_to(other);
    let replacement = builder.integer(8);
    builder.write_variable(variable, replacement);
    builder.jump(Edge::with_arguments(join, &[passed, stored]));
    builder.seal(join);

    builder.switch_to(join);
    let read = builder.read_variable(variable);
    builder.strcat(&[explicit, read, edge_result]);
    builder.return_value(None);
}

#[test]
fn parameters_are_ordered_explicit_variable_edge_result() {
    let body = build(
        &[TypeTable::ANYTHING],
        fill_join_with_every_kind_of_parameter,
    );
    let join = body.blocks().last().expect("the body has blocks");
    assert_eq!(join.first_parameter, value(4));
    let parameter_types: Vec<Option<TypeId>> = join.parameter_types().collect();
    assert_eq!(
        parameter_types,
        [Some(TypeTable::STRING), Some(TypeTable::NUMBER), None]
    );
    let values: Vec<ValueView<'_>> = join.values().collect();
    let [strcat] = values[..] else {
        panic!("{} values", values.len());
    };
    assert_eq!(strcat.fields, [3, 4, 5, 6]);
}

#[test]
fn arguments_are_ordered_like_parameters() {
    let body = build(
        &[TypeTable::ANYTHING],
        fill_join_with_every_kind_of_parameter,
    );
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let [entry, other, _] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    let with_proof = (2, vec![value(0), value(1)], vec![0]);
    assert_eq!(targets_of(&entry), [with_proof, target_to(1)]);
    let with_trailing_argument = (2, vec![value(0), value(3), value(1)], Vec::new());
    assert_eq!(targets_of(&other), [with_trailing_argument]);
}

#[test]
fn subject_is_renumbered() {
    let body = build(&[TypeTable::ANYTHING], |builder| {
        emit_dropped_values(builder);
        let iterator = builder.undefined();
        assert_eq!(iterator, value(1 + DROPPED_VALUE_COUNT));
        let role = BlockRole::IterationCleanup;
        let cleanup = builder.create_handler(role, Some(iterator), None);
        let covered = builder.create_block(Some(cleanup));
        builder.jump(Edge::to(covered));
        builder.seal(covered);
        builder.seal(cleanup.block());
        builder.switch_to(covered);
        builder.return_value(None);
        builder.switch_to(cleanup.block());
        builder.return_value(None);
    });
    let subjects: Vec<Option<ValueId>> = body.blocks().map(|block| block.subject).collect();
    assert_eq!(subjects, [None, None, Some(value(1))]);
}

fn fill_function_with_every_kind_of_word(builder: &mut FunctionBuilder) {
    let subject = builder.parameter(0);
    emit_dropped_values(builder);
    let variable = builder.create_variable(None);
    builder.write_variable(variable, subject);
    let cleanup = builder.create_handler(BlockRole::CleanupHandler, Some(subject), None);
    let covered = builder.create_block(Some(cleanup));
    let [case, otherwise] = create_blocks(builder);
    let narrowed = builder.add_edge_result(case);
    let passed = builder.add_parameter(otherwise, Some(TypeTable::NUMBER));
    builder.set_frequency(otherwise, BlockFrequency::Unlikely);
    builder.jump(Edge::to(covered));
    builder.seal(covered);
    builder.switch_to(covered);
    let constant = builder.integer(-7);
    builder.write_variable(variable, constant);
    builder.strcat(&[subject, constant]);
    let cases = [Edge::with_proofs(case, &[0])];
    builder.switch(
        subject,
        &[5],
        &cases,
        Edge::with_arguments(otherwise, &[constant]),
    );
    for block in [case, otherwise, cleanup.block()] {
        builder.seal(block);
    }
    for (block, result) in [(case, narrowed), (otherwise, passed)] {
        builder.switch_to(block);
        builder.return_value(Some(result));
    }
    builder.switch_to(cleanup.block());
    let caught = builder.read_variable(variable);
    builder.throw(caught);
    for open_dead_block in create_blocks::<2>(builder) {
        builder.seal(open_dead_block);
    }
}

#[test]
fn measured_size_is_exact() {
    let parameters = [TypeTable::ANYTHING];
    let body = build(&parameters, fill_function_with_every_kind_of_word);
    let mut builder = create_builder(&parameters, BuilderScratch::default());
    fill_function_with_every_kind_of_word(&mut builder);
    let FunctionBuilder {
        mut blocks, values, ..
    } = builder;
    close_open_blocks(&mut blocks);
    let mut scratch = FinishScratch::default();
    scratch.order_blocks(&blocks);
    let size = scratch.number_values(&blocks, &values);

    assert_eq!(size, (body.value_count, body.code.len()));
    assert_eq!(scratch.order.len(), body.block_count as usize);
    let numbered_value_count = scratch.value_numbers.iter().flatten().count();
    assert_eq!(numbered_value_count, body.value_count as usize);
    assert_eq!(values.len(), numbered_value_count + DROPPED_VALUE_COUNT);
}

#[test]
fn scratch_of_larger_function_encodes_same_body() {
    let parameters = [TypeTable::ANYTHING];
    let mut larger = create_builder(&parameters, BuilderScratch::default());
    fill_function_with_every_kind_of_word(&mut larger);
    let (_, scratch) = larger.finish();

    let mut recycled = create_builder(&parameters, scratch);
    fill_join_with_every_kind_of_parameter(&mut recycled);
    let (recycled, _) = recycled.finish();
    let fresh = build(&parameters, fill_join_with_every_kind_of_parameter);
    assert_eq!(recycled.body, fresh);
}

#[test]
fn recycle_keeps_cleared_lists() {
    let mut scratch = FinishScratch::default();
    scratch.is_reached.push(true);
    scratch.block_numbers.push(Some(ENTRY_BLOCK));
    scratch.value_numbers.push(None);
    scratch.order.push(ENTRY_BLOCK);
    scratch.stack.push((ENTRY_BLOCK, 1));
    let scratch = scratch.recycle();
    assert!(scratch.is_reached.is_empty() && scratch.is_reached.capacity() > 0);
    assert!(scratch.block_numbers.is_empty() && scratch.block_numbers.capacity() > 0);
    assert!(scratch.value_numbers.is_empty() && scratch.value_numbers.capacity() > 0);
    assert!(scratch.order.is_empty() && scratch.order.capacity() > 0);
    assert!(scratch.stack.is_empty() && scratch.stack.capacity() > 0);
}

#[test]
fn recycle_drops_oversized_lists() {
    let mut scratch = FinishScratch::default();
    scratch.is_reached.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.block_numbers.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.value_numbers.reserve(MAX_SPARE_VALUES + 1);
    scratch.order.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.stack.reserve(MAX_SPARE_BLOCKS + 1);
    let scratch = scratch.recycle();
    assert_eq!(scratch.is_reached.capacity(), 0);
    assert_eq!(scratch.block_numbers.capacity(), 0);
    assert_eq!(scratch.value_numbers.capacity(), 0);
    assert_eq!(scratch.order.capacity(), 0);
    assert_eq!(scratch.stack.capacity(), 0);
}
