use crate::ir::body::{BlockView, Body, ValueView};
use crate::ir::builder::{
    BuilderScratch, Edge, FunctionBuilder, MAX_SPARE_BLOCKS, MAX_SPARE_VALUES,
};
use crate::ir::generated::{
    BlockRole, FunctionFlags, Opcode, STANDS_IN_TAIL_POSITION, TemplateString, TerminatorKind,
    ValueHead,
};
use crate::ir::ids::{
    ABSENT_WORD, BlockId, ExpectedResultId, Id, LayoutId, PropertyKeyId, StringId, TypeId, ValueId,
};
use crate::ir::testing::{build_function, create_blocks, function_with_parameters};
use crate::ir::types::TypeTable;

const DROPPED_VALUE_COUNT: usize = 3;
const LONG_LIST_LENGTH: u32 = 300;

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

fn last_value_in<'a>(block: &BlockView<'a>) -> ValueView<'a> {
    block.values().last().expect("the block lists a value")
}

fn last_value_of(body: &Body) -> ValueView<'_> {
    last_value_in(&entry_of(body))
}

fn opcodes_of(block: &BlockView<'_>) -> Vec<Opcode> {
    block.values().map(|value| value.opcode).collect()
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
            None,
            None,
            true,
            false,
        );
        builder.set_position(None);
        builder.call(callee, None, &[], None, None, None, None, None, false, true);
        builder.return_value(None);
    });
    let values: Vec<ValueView<'_>> = entry_of(&body).values().collect();
    let [_, with_this, without_this] = values[..] else {
        panic!("the entry block lists three values");
    };
    let reference = (4 + DROPPED_VALUE_COUNT) as u32;
    assert_eq!((with_this.id, with_this.opcode), (value(5), Opcode::Call));
    assert_eq!(with_this.position, Some(17));
    let absent = ABSENT_WORD;
    assert_eq!(
        with_this.fields,
        [
            1, 0, 1, 3, 2, 4, 3, reference, reference, reference, absent, absent
        ]
    );

    assert_eq!(
        (without_this.id, without_this.opcode),
        (value(6), Opcode::Call)
    );
    assert_eq!(without_this.position, None);
    assert_eq!(
        without_this.fields,
        [2, 0, absent, 0, absent, absent, absent, absent, absent]
    );
}

#[test]
fn value_in_tail_position_keeps_its_mark() {
    let body = build(&[TypeTable::ANYTHING], |builder| {
        let passed = builder.parameter(0);
        emit_dropped_values(builder);
        let listed = builder.undefined();
        let outer = builder.set_tail_position(true);
        builder.strcat(&[listed, passed]);
        builder.set_tail_position(outer);
        builder.strcat(&[passed, listed]);
        builder.return_value(None);
    });
    let values: Vec<ValueView<'_>> = entry_of(&body).values().collect();
    let [_, marked, plain] = values[..] else {
        panic!("{} values", values.len());
    };
    assert_eq!(
        (marked.opcode, plain.opcode),
        (Opcode::Strcat, Opcode::Strcat)
    );
    assert_eq!(marked.fields, [2, 1, 0]);
    assert_eq!(plain.fields, [2, 0, 1]);

    let marked_head = Opcode::Strcat.to_wire() | STANDS_IN_TAIL_POSITION;
    let is_marked_head = |at: &usize| body.code[*at] == marked_head;
    let marked_heads: Vec<usize> = (0..body.code.len()).filter(is_marked_head).collect();
    let [at] = marked_heads[..] else {
        panic!("{} marked values", marked_heads.len());
    };
    assert_eq!(body.code[at + ValueHead::WORDS..][..3], [2, 1, 0]);
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
fn long_operand_list_survives() {
    let body = build(&[], |builder| {
        emit_dropped_values(builder);
        let constants = (0..LONG_LIST_LENGTH).map(|constant| builder.integer(i64::from(constant)));
        let mut parts: Vec<ValueId> = constants.collect();
        parts.reverse();
        builder.strcat(&parts);
        builder.return_value(None);
    });
    assert_eq!(body.value_count, LONG_LIST_LENGTH + 1);
    let strcat = last_value_of(&body);
    assert_eq!(strcat.opcode, Opcode::Strcat);
    let numbers = (0..LONG_LIST_LENGTH).rev();
    let expected: Vec<u32> = core::iter::once(LONG_LIST_LENGTH).chain(numbers).collect();
    assert_eq!(strcat.fields, expected);
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
    let [open] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
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
fn blocks_emitted_in_alternation_come_out_block_by_block() {
    let body = build(&[], |builder| {
        let first = builder.current_block();
        let second = builder.create_block(None);
        let emit_in_turn = |constant: i64| {
            builder.switch_to(if constant % 2 == 0 { first } else { second });
            builder.integer(constant)
        };
        let constants: Vec<ValueId> = (0..6).map(emit_in_turn).collect();
        builder.switch_to(first);
        builder.jump(Edge::to(second));
        builder.seal(second);
        builder.switch_to(second);
        builder.strcat(&constants);
        builder.return_value(None);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let [joined] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    assert_eq!(integer_constants(&joined), [0, 2, 4, 1, 3, 5]);
    assert_eq!(last_value_in(&joined).fields, [6, 0, 3, 1, 4, 2, 5]);
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
fn handler_is_a_successor() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let [branching, returning] = [(); 2].map(|()| builder.create_block(Some(handler)));
        let uncovered = builder.create_block(None);
        builder.jump(Edge::to(branching));
        builder.switch_to(branching);
        builder.branch(condition, Edge::to(returning), Edge::to(uncovered));
        for block in [branching, returning, uncovered, handler.block()] {
            builder.seal(block);
        }
        for block in [returning, uncovered, handler.block()] {
            builder.switch_to(block);
            builder.return_value(None);
        }
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let handler_of = |block: &BlockView<'_>| block.handler().map(|handler| handler.block);
    let handlers: Vec<Option<BlockId>> = blocks.iter().map(handler_of).collect();
    let landing = Some(BlockId::new(4));
    assert_eq!(handlers, [None, landing, landing, None, None]);
    assert_eq!(targets_of(&blocks[1]), [2, 3].map(target_to));
    assert_eq!(blocks[4].role, BlockRole::CatchHandler);
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
    assert_eq!(constants, [vec![], vec![1, 2], vec![3], vec![4]]);
    let landing = body.blocks().nth(2).expect("the body has four blocks");
    assert_eq!(landing.role, BlockRole::CatchHandler);
}

#[test]
fn block_that_only_a_jump_leads_to_is_joined() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [last, second, first, other] = create_blocks(builder);
        builder.branch(condition, Edge::to(first), Edge::to(other));
        for (constant, block, next) in [(1, first, second), (2, second, last)] {
            builder.seal(block);
            builder.switch_to(block);
            builder.integer(constant);
            builder.jump(Edge::to(next));
        }
        for (constant, block) in [(3, last), (4, other)] {
            builder.seal(block);
            builder.switch_to(block);
            builder.integer(constant);
            builder.return_value(None);
        }
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let constants: Vec<Vec<i64>> = blocks.iter().map(integer_constants).collect();
    assert_eq!(constants, [vec![], vec![1, 2, 3], vec![4]]);
    assert_eq!(targets_of(&blocks[0]), [1, 2].map(target_to));
    assert_eq!(blocks[1].terminator().kind, TerminatorKind::Return);
    assert_eq!(body.value_count, 5);
}

#[test]
fn entry_block_is_joined_too() {
    let body = build(&[], |builder| {
        let next = builder.create_block(None);
        builder.integer(1);
        builder.jump(Edge::to(next));
        builder.seal(next);
        builder.switch_to(next);
        builder.integer(2);
        builder.return_value(None);
    });
    let constants: Vec<Vec<i64>> = body
        .blocks()
        .map(|block| integer_constants(&block))
        .collect();
    assert_eq!(constants, [vec![1, 2]]);
}

#[test]
fn parameter_of_joined_block_is_the_argument() {
    let body = build(&[], |builder| {
        let [second, first] = create_blocks(builder);
        let passed = builder.add_parameter(second, None);
        builder.jump(Edge::to(first));
        builder.seal(first);
        builder.switch_to(first);
        let constant = builder.integer(1);
        builder.jump(Edge::with_arguments(second, &[constant]));
        builder.seal(second);
        builder.switch_to(second);
        builder.return_value(Some(passed));
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    assert_eq!(blocks.len(), 1);
    assert_eq!(body.value_count, 1);
    assert_eq!(blocks[0].parameter_types().count(), 0);
    assert_eq!(blocks[0].terminator().fields, [0]);
}

#[test]
fn block_with_a_declared_parameter_is_not_joined() {
    let body = build(&[], |builder| {
        let [second, first] = create_blocks(builder);
        let passed = builder.add_parameter(second, Some(TypeTable::NUMBER));
        builder.jump(Edge::to(first));
        builder.seal(first);
        builder.switch_to(first);
        let constant = builder.integer(1);
        builder.jump(Edge::with_arguments(second, &[constant]));
        builder.seal(second);
        builder.switch_to(second);
        builder.return_value(Some(passed));
    });
    assert_eq!(body.blocks().count(), 2);
}

#[test]
fn block_under_another_handler_is_not_joined() {
    let body = build(&[], |builder| {
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let first = builder.create_block(None);
        let covered = builder.create_block(Some(handler));
        for block in [first, covered] {
            builder.jump(Edge::to(block));
            builder.seal(block);
            builder.switch_to(block);
        }
        builder.return_value(None);
        builder.seal(handler.block());
        builder.switch_to(handler.block());
        builder.return_value(None);
    });
    let handlers: Vec<bool> = body
        .blocks()
        .map(|block| block.handler().is_some())
        .collect();
    assert_eq!(handlers, [false, true, false]);
}

fn build_test_with_one_arm(
    has_results: bool,
    choose_argument: impl FnOnce(ValueId, Option<ValueId>) -> Option<ValueId>,
) -> Body {
    build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [join, unwritten, written] = create_blocks(builder);
        let result = has_results.then(|| {
            builder.add_edge_result(written);
            builder.add_edge_result(unwritten)
        });
        let proofs: &[u32] = if has_results { &[0] } else { &[] };
        builder.branch(
            condition,
            Edge::with_proofs(written, proofs),
            Edge::with_proofs(unwritten, proofs),
        );
        let argument = choose_argument(condition, result);
        if argument.is_some() {
            builder.add_parameter(join, None);
        }
        builder.seal(unwritten);
        builder.switch_to(unwritten);
        builder.jump(Edge::with_arguments(join, argument.as_slice()));
        builder.seal(written);
        builder.switch_to(written);
        let constant = builder.integer(1);
        let argument = argument.map(|_| constant);
        builder.jump(Edge::with_arguments(join, argument.as_slice()));
        builder.seal(join);
        builder.switch_to(join);
        builder.integer(2);
        builder.return_value(None);
    })
}

#[test]
fn edge_passes_by_block_that_only_jumps() {
    let body = build_test_with_one_arm(false, |_, _| None);
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let constants: Vec<Vec<i64>> = blocks.iter().map(integer_constants).collect();
    assert_eq!(constants, [vec![], vec![1], vec![2]]);
    assert_eq!(targets_of(&blocks[0]), [1, 2].map(target_to));
}

#[test]
fn result_of_edge_that_nobody_reads_goes_with_the_block() {
    let body = build_test_with_one_arm(true, |_, _| None);
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    assert_eq!(blocks.len(), 3);
    let with_proof = (1, Vec::new(), vec![0]);
    assert_eq!(targets_of(&blocks[0]), [with_proof, target_to(2)]);
    assert_eq!(body.value_count, 4);
}

#[test]
fn block_that_hands_on_result_of_its_edge_stays() {
    let body = build_test_with_one_arm(true, |_, result| result);
    assert_eq!(body.blocks().count(), 4);
}

#[test]
fn edge_that_passes_by_takes_arguments_of_the_jump() {
    let body = build_test_with_one_arm(false, |condition, _| Some(condition));
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    assert_eq!(blocks.len(), 3);
    let with_argument = (2, vec![value(0)], Vec::new());
    assert_eq!(targets_of(&blocks[0]), [target_to(1), with_argument]);
}

#[test]
fn edge_passes_by_a_row_of_blocks_that_only_jump() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [join, second, first, written] = create_blocks(builder);
        builder.add_edge_result(first);
        builder.branch(condition, Edge::to(written), Edge::with_proofs(first, &[0]));
        for (block, next) in [(first, second), (second, join)] {
            builder.seal(block);
            builder.switch_to(block);
            builder.jump(Edge::to(next));
        }
        builder.seal(written);
        builder.switch_to(written);
        builder.integer(1);
        builder.jump(Edge::to(join));
        builder.seal(join);
        builder.switch_to(join);
        builder.return_value(None);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    assert_eq!(blocks.len(), 3);
    assert_eq!(targets_of(&blocks[0]), [1, 2].map(target_to));
}

#[test]
fn two_arms_of_one_test_that_meet_at_once_stay() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [join, second, first] = create_blocks(builder);
        builder.branch(condition, Edge::to(first), Edge::to(second));
        for arm in [first, second] {
            builder.seal(arm);
            builder.switch_to(arm);
            builder.jump(Edge::to(join));
        }
        builder.seal(join);
        builder.switch_to(join);
        builder.return_value(None);
    });
    assert_eq!(body.blocks().count(), 4);
}

#[test]
fn block_that_jumps_into_region_of_handler_stays() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let [out, front] = create_blocks(builder);
        let covered = builder.create_block(Some(handler));
        builder.branch(condition, Edge::to(front), Edge::to(out));
        builder.seal(front);
        builder.switch_to(front);
        builder.jump(Edge::to(covered));
        builder.seal(covered);
        builder.switch_to(covered);
        builder.integer(1);
        builder.jump(Edge::to(out));
        builder.seal(handler.block());
        builder.switch_to(handler.block());
        builder.jump(Edge::to(out));
        builder.seal(out);
        builder.switch_to(out);
        builder.return_value(None);
    });
    let handlers: Vec<bool> = body
        .blocks()
        .map(|block| block.handler().is_some())
        .collect();
    assert_eq!(handlers, [false, false, true, false, false]);
}

#[test]
fn block_in_front_of_loop_stays() {
    let body = build(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [out, head, front] = create_blocks(builder);
        builder.branch(condition, Edge::to(front), Edge::to(out));
        builder.seal(front);
        builder.switch_to(front);
        builder.jump(Edge::to(head));
        builder.switch_to(head);
        builder.integer(1);
        builder.branch(condition, Edge::to(head), Edge::to(out));
        builder.seal(head);
        builder.seal(out);
        builder.switch_to(out);
        builder.return_value(None);
    });
    assert_eq!(body.blocks().count(), 4);
}

#[test]
fn unreached_blocks_have_no_number() {
    let body = build(&[], |builder| {
        let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
        let dead = builder.create_block(Some(handler));
        let next = builder.create_block(None);
        builder.jump(Edge::to(next));
        for block in [handler.block(), dead, next] {
            builder.seal(block);
        }
    });
    let roles: Vec<BlockRole> = body.blocks().map(|block| block.role).collect();
    assert_eq!(roles, [BlockRole::Ordinary]);
    assert_eq!(entry_of(&body).terminator().target_count(), 0);
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
fn undefined_made_by_ssa_stands_first_in_its_block() {
    let body = build(&[], |builder| {
        let [earlier, later] = [(); 2].map(|()| builder.create_variable(None));
        builder.set_position(Some(7));
        let constants = [1, 2].map(|constant| builder.integer(constant));
        builder.strcat(&constants);
        let next = builder.create_block(None);
        builder.jump(Edge::to(next));
        builder.seal(next);
        builder.switch_to(next);
        let reads = [earlier, later].map(|variable| builder.read_variable(variable));
        builder.strcat(&reads);
        builder.return_value(None);
    });
    let blocks: Vec<BlockView<'_>> = body.blocks().collect();
    let [entry] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    let values = entry.values().map(|value| (value.opcode, value.position));
    let values: Vec<(Opcode, Option<u32>)> = values.collect();
    let expected = [
        (Opcode::Undefined, None),
        (Opcode::Undefined, None),
        (Opcode::Integer, Some(7)),
        (Opcode::Integer, Some(7)),
        (Opcode::Strcat, Some(7)),
        (Opcode::Strcat, Some(7)),
    ];
    assert_eq!(values, expected);
    let joined = entry
        .values()
        .filter(|value| value.opcode == Opcode::Strcat);
    let joined: Vec<&[u32]> = joined.map(|value| value.fields).collect();
    assert_eq!(joined, [[2, 2, 3], [2, 1, 0]]);
}

#[test]
fn value_follows_undefined_made_by_ssa_in_empty_block() {
    let body = build(&[], |builder| {
        let variable = builder.create_variable(None);
        let read = builder.read_variable(variable);
        let constant = builder.integer(1);
        builder.strcat(&[constant, read]);
        builder.return_value(None);
    });
    let expected = [Opcode::Undefined, Opcode::Integer, Opcode::Strcat];
    assert_eq!(opcodes_of(&entry_of(&body)), expected);
    assert_eq!(last_value_of(&body).fields, [2, 1, 0]);
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
    let mut builder = create_builder(&[TypeTable::ANYTHING], BuilderScratch::default());
    fill_function_with_every_kind_of_word(&mut builder);
    let pending_value_count = builder.values.len();
    let (function, _) = builder.finish();
    let body = function.body;

    assert_eq!(body.check_stream(), Ok(()));
    assert_eq!(body.code.capacity(), body.code.len());
    assert_eq!(body.block_count, 6);
    let numbered_value_count = body.value_count as usize;
    assert_eq!(
        pending_value_count,
        numbered_value_count + DROPPED_VALUE_COUNT
    );
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
    let mut builder = create_builder(&[TypeTable::ANYTHING], BuilderScratch::default());
    fill_function_with_every_kind_of_word(&mut builder);
    let (_, scratch) = builder.finish();
    let scratch = scratch.finish;
    assert!(scratch.is_reached.is_empty() && scratch.is_reached.capacity() > 0);
    assert!(scratch.block_numbers.is_empty() && scratch.block_numbers.capacity() > 0);
    assert!(scratch.numbers.is_empty() && scratch.numbers.capacity() > 0);
    assert!(scratch.order.is_empty() && scratch.order.capacity() > 0);
    assert!(scratch.stack.is_empty() && scratch.stack.capacity() > 0);
}

#[test]
fn recycle_drops_oversized_lists() {
    let mut scratch = BuilderScratch::default();
    scratch.finish.is_reached.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.finish.block_numbers.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.finish.numbers.reserve(MAX_SPARE_VALUES + 1);
    scratch.finish.order.reserve(MAX_SPARE_BLOCKS + 1);
    scratch.finish.stack.reserve(MAX_SPARE_BLOCKS + 1);
    let (_, scratch) = create_builder(&[], scratch).finish();
    let scratch = scratch.finish;
    assert_eq!(scratch.is_reached.capacity(), 0);
    assert_eq!(scratch.block_numbers.capacity(), 0);
    assert_eq!(scratch.numbers.capacity(), 0);
    assert_eq!(scratch.order.capacity(), 0);
    assert_eq!(scratch.stack.capacity(), 0);
}
