use super::handlers::emit_call;
use crate::ir::builder::{BuilderScratch, Edge, FunctionBuilder, MAX_SPARE_VALUES};
use crate::ir::declared::DeclaredType;
use crate::ir::generated::{BlockFrequency, FunctionFlags, Opcode, TerminatorKind};
use crate::ir::ids::{ABSENT_WORD, BlockId, Id, TypeId, ValueId, VariableId};
use crate::ir::testing::{
    build_function, create_blocks, create_builder, create_catch_handler, function_with_parameters,
};
use crate::ir::types::TypeTable;

#[test]
fn entry_parameters_follow_function() {
    let flags = FunctionFlags::HAS_THIS
        | FunctionFlags::HAS_NEW_TARGET
        | FunctionFlags::HAS_ARGUMENT_COUNT
        | FunctionFlags::HAS_HIDDEN_REST;
    let mut function = function_with_parameters(flags, &[TypeTable::NUMBER, TypeTable::STRING]);
    let captures = [TypeTable::BOOLEAN, TypeTable::SYMBOL];
    function.captures = captures.map(DeclaredType::from_compiler).to_vec();
    function.this_type = DeclaredType::from_compiler(TypeTable::OBJECT);

    let builder = FunctionBuilder::new(function, BuilderScratch::default());
    let entry_values = [
        Some(builder.capture(0)),
        Some(builder.capture(1)),
        builder.this_value(),
        builder.new_target(),
        builder.argument_count(),
        Some(builder.parameter(0)),
        Some(builder.parameter(1)),
        builder.hidden_rest(),
    ];
    let expected: [Option<ValueId>; 8] = core::array::from_fn(|index| Some(ValueId::new(index)));
    assert_eq!(entry_values, expected);
    assert_eq!(builder.callee(), None);
    assert_eq!(builder.current_block(), BlockId::new(0));
    assert!(builder.is_open());
    assert!(!builder.is_unreachable());

    let (function, _) = builder.finish();
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    let parameter_types: Vec<Option<TypeId>> = entry.parameter_types().collect();
    let expected = [
        TypeTable::BOOLEAN,
        TypeTable::SYMBOL,
        TypeTable::OBJECT,
        TypeTable::ANYTHING,
        TypeTable::UINT32,
        TypeTable::NUMBER,
        TypeTable::STRING,
        TypeTable::ARRAY,
    ];
    assert_eq!(parameter_types, expected.map(Some));
}

#[test]
fn function_without_flags_has_declared_parameters_only() {
    let builder = create_builder(&[TypeTable::NUMBER]);
    assert_eq!(builder.parameter(0), ValueId::new(0));
    assert_eq!(builder.this_value(), None);
    assert_eq!(builder.callee(), None);
    assert_eq!(builder.new_target(), None);
    assert_eq!(builder.argument_count(), None);
    assert_eq!(builder.hidden_rest(), None);
    assert_eq!(builder.function().parameters.len(), 1);
}

#[test]
fn emit_appends_to_current_block_at_position() {
    let function = build_function(&[TypeTable::ANYTHING], |builder| {
        let callee = builder.parameter(0);
        assert_eq!(builder.position(), None);
        builder.undefined();
        builder.set_position(Some(7));
        assert_eq!(builder.position(), Some(7));
        let called = emit_call(builder, callee);
        builder.return_value(Some(called));
    });
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    let values = entry
        .values()
        .map(|value| (value.id, value.opcode, value.position));
    let values: Vec<(ValueId, Opcode, Option<u32>)> = values.collect();
    let expected = [
        (ValueId::new(1), Opcode::Undefined, None),
        (ValueId::new(2), Opcode::Call, Some(7)),
    ];
    assert_eq!(values, expected);
    let terminator = entry.terminator();
    assert_eq!(terminator.kind, TerminatorKind::Return);
    assert_eq!(terminator.position, Some(7));
    assert_eq!(terminator.fields, [2]);
}

#[test]
fn every_value_takes_an_id() {
    let function = build_function(&[TypeTable::ANYTHING], |builder| {
        let value = builder.parameter(0);
        let stored = builder.put_module_variable(VariableId::new(0), value);
        let next = builder.undefined();
        assert_eq!(next.index(), stored.index() + 1);
        builder.return_value(Some(next));
    });
    assert!(!Opcode::PutModuleVariable.has_result());
    assert_eq!(function.body.value_count, 3);
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    let values = entry.values().map(|value| (value.id, value.opcode));
    let values: Vec<(ValueId, Opcode)> = values.collect();
    let expected = [
        (ValueId::new(1), Opcode::PutModuleVariable),
        (ValueId::new(2), Opcode::Undefined),
    ];
    assert_eq!(values, expected);
}

#[test]
fn jump_passes_arguments_to_explicit_parameters() {
    let function = build_function(&[TypeTable::NUMBER], |builder| {
        let argument = builder.parameter(0);
        let block = builder.create_block(None);
        let parameter = builder.add_parameter(block, Some(TypeTable::NUMBER));
        assert!(!builder.has_predecessors(block));
        builder.jump(Edge::with_arguments(block, &[argument]));
        assert!(builder.has_predecessors(block));
        builder.seal(block);
        builder.switch_to(block);
        builder.return_value(Some(parameter));
    });
    let blocks: Vec<_> = function.body.blocks().collect();
    let [entry, block] = blocks[..] else {
        panic!("the body has two blocks");
    };
    let terminator = entry.terminator();
    assert_eq!(terminator.kind, TerminatorKind::Jump);
    assert!(terminator.fields.is_empty());
    let targets: Vec<_> = terminator.targets().collect();
    let [target] = targets[..] else {
        panic!("a jump has one target");
    };
    assert_eq!(target.block, block.id);
    assert_eq!(target.arguments().collect::<Vec<_>>(), [ValueId::new(0)]);
    assert!(target.proofs.is_empty());
    let parameter_types: Vec<Option<TypeId>> = block.parameter_types().collect();
    assert_eq!(parameter_types, [Some(TypeTable::NUMBER)]);
    assert_eq!(block.first_parameter, ValueId::new(1));
    assert_eq!(block.terminator().fields, [1]);
}

#[test]
fn return_without_value_has_absent_operand() {
    let function = build_function(&[], |builder| builder.return_value(None));
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    assert_eq!(entry.terminator().fields, [ABSENT_WORD]);
}

#[test]
fn second_terminator_is_ignored() {
    let function = build_function(&[], |builder| {
        let [first, second] = create_blocks(builder);
        builder.jump(Edge::to(first));
        assert!(!builder.is_open());
        assert!(builder.is_unreachable());
        builder.jump(Edge::to(second));
        builder.return_value(None);
        assert!(builder.has_predecessors(first));
        assert!(!builder.has_predecessors(second));
        builder.seal(first);
        builder.seal(second);
    });
    assert_eq!(function.body.block_count, 2);
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    let terminator = entry.terminator();
    assert_eq!(terminator.kind, TerminatorKind::Jump);
    assert_eq!(terminator.target_count(), 1);
}

#[test]
fn open_block_ends_unreachable() {
    let function = build_function(&[], |_| {});
    let entry = function
        .body
        .blocks()
        .next()
        .expect("the body has an entry block");
    assert_eq!(entry.terminator().kind, TerminatorKind::Unreachable);
}

#[test]
fn dead_block_terminator_becomes_unreachable() {
    let mut builder = create_builder(&[]);
    let [dead, target] = create_blocks(&mut builder);
    builder.switch_to(dead);
    assert!(!builder.is_unreachable());
    builder.seal(dead);
    assert!(builder.is_open());
    assert!(builder.is_unreachable());
    builder.jump(Edge::to(target));
    assert!(!builder.is_open());
    let terminator = builder.blocks[dead.index()].terminator.as_ref();
    let terminator = terminator.expect("the jump closed the block");
    assert_eq!(terminator.kind, TerminatorKind::Unreachable);
    assert!(terminator.targets.is_empty());
    assert!(!builder.has_predecessors(target));
}

#[test]
fn block_with_predecessor_is_reachable_after_sealing() {
    let mut builder = create_builder(&[]);
    let block = builder.create_block(None);
    builder.jump(Edge::to(block));
    builder.seal(block);
    builder.switch_to(block);
    assert!(!builder.is_unreachable());
}

#[test]
fn handler_of_returns_covering_handler() {
    let mut builder = create_builder(&[]);
    let handler = create_catch_handler(&mut builder);
    let covered = builder.create_block(Some(handler));
    let uncovered = builder.create_block(None);
    assert_eq!(builder.handler_of(covered), Some(handler));
    assert_eq!(builder.handler_of(uncovered), None);
    assert_eq!(builder.handler_of(handler.block()), None);
    assert!(builder.has_predecessors(handler.block()));
}

#[test]
fn frequency_is_set_per_block() {
    let function = build_function(&[TypeTable::BOOLEAN], |builder| {
        let condition = builder.parameter(0);
        let [likely, unlikely] = create_blocks(builder);
        builder.set_frequency(unlikely, BlockFrequency::Unlikely);
        builder.branch(condition, Edge::to(likely), Edge::to(unlikely));
        for block in [likely, unlikely] {
            builder.seal(block);
            builder.switch_to(block);
            builder.return_value(None);
        }
    });
    let blocks = function.body.blocks();
    let frequencies: Vec<BlockFrequency> = blocks.map(|block| block.frequency).collect();
    let (normal, unlikely) = (BlockFrequency::Normal, BlockFrequency::Unlikely);
    assert_eq!(frequencies, [normal, normal, unlikely]);
}

#[test]
fn scratch_passes_capacity_to_next_builder() {
    let mut builder = create_builder(&[]);
    assert_eq!(builder.values.capacity(), 0);
    for _ in 0..100 {
        builder.integer(7);
    }
    builder.return_value(None);
    let (_, scratch) = builder.finish();
    let function = function_with_parameters(FunctionFlags::default(), &[]);
    let next = FunctionBuilder::new(function, scratch);
    assert!(next.values.is_empty());
    assert!(next.field_words.is_empty());
    assert_eq!(next.blocks.len(), 1);
    assert!(next.values.capacity() >= 100);
    assert!(next.field_words.capacity() >= 200);
}

#[test]
fn scratch_drops_vectors_over_cap() {
    let mut builder = create_builder(&[]);
    for _ in 0..=MAX_SPARE_VALUES {
        builder.undefined();
    }
    builder.return_value(None);
    let (function, scratch) = builder.finish();
    assert_eq!(function.body.value_count as usize, MAX_SPARE_VALUES + 1);
    let function = function_with_parameters(FunctionFlags::default(), &[]);
    let next = FunctionBuilder::new(function, scratch);
    assert_eq!(next.values.capacity(), 0);
}

#[test]
fn recycled_scratch_builds_same_body() {
    let fill = |builder: &mut FunctionBuilder| {
        let condition = builder.parameter(0);
        let variable = builder.create_variable(None);
        let [left, right, join] = create_blocks(builder);
        builder.branch(condition, Edge::to(left), Edge::to(right));
        for (constant, block) in (1..).zip([left, right]) {
            builder.seal(block);
            builder.switch_to(block);
            let value = builder.integer(constant);
            builder.write_variable(variable, value);
            builder.jump(Edge::to(join));
        }
        builder.seal(join);
        builder.switch_to(join);
        let value = builder.read_variable(variable);
        builder.return_value(Some(value));
    };
    let mut first = create_builder(&[TypeTable::BOOLEAN]);
    fill(&mut first);
    let (first, scratch) = first.finish();
    let function = function_with_parameters(FunctionFlags::default(), &[TypeTable::BOOLEAN]);
    let mut second = FunctionBuilder::new(function, scratch);
    fill(&mut second);
    let (second, _) = second.finish();
    assert_eq!(second.body, first.body);
}

#[test]
#[cfg_attr(
    debug_assertions,
    should_panic(expected = "emitted into an open block")
)]
fn value_after_terminator_is_dropped() {
    let function = build_function(&[], |builder| {
        builder.return_value(None);
        builder.integer(1);
        assert!(builder.is_unreachable());
    });
    assert_eq!(
        (function.body.block_count, function.body.value_count),
        (1, 0)
    );
}

#[cfg(debug_assertions)]
mod debug_assertions {
    use super::*;

    #[test]
    #[should_panic(expected = "Add: the fields have their wire form")]
    fn fields_with_missing_word_panic() {
        create_builder(&[]).emit(Opcode::Add, &[0]);
    }

    #[test]
    #[should_panic(expected = "Add: the fields have their wire form")]
    fn fields_with_extra_word_panic() {
        create_builder(&[]).emit(Opcode::Add, &[0, 0, 0]);
    }

    #[test]
    #[should_panic(expected = "Strcat: the fields have their wire form")]
    fn operand_count_past_fields_panics() {
        create_builder(&[]).emit(Opcode::Strcat, &[2, 0]);
    }

    #[test]
    #[should_panic(expected = "Branch: the fields have their wire form")]
    fn terminator_fields_with_missing_word_panic() {
        create_builder(&[]).terminate(TerminatorKind::Branch, &[], &[]);
    }

    #[test]
    #[should_panic(expected = "explicit parameters are added before the first edge")]
    fn explicit_parameter_after_first_edge_panics() {
        let mut builder = create_builder(&[]);
        let block = builder.create_block(None);
        builder.jump(Edge::to(block));
        builder.add_parameter(block, None);
    }

    #[test]
    #[should_panic(expected = "explicit parameters are added before the first edge")]
    fn explicit_parameter_of_sealed_block_panics() {
        let mut builder = create_builder(&[]);
        let block = builder.create_block(None);
        builder.seal(block);
        builder.add_parameter(block, None);
    }

    #[test]
    #[should_panic(expected = "a handler block has variable parameters only")]
    fn explicit_parameter_of_handler_block_panics() {
        let mut builder = create_builder(&[]);
        let handler = create_catch_handler(&mut builder);
        builder.add_parameter(handler.block(), None);
    }

    #[test]
    #[should_panic(expected = "an edge fills every explicit parameter of its target")]
    fn edge_with_missing_argument_panics() {
        let mut builder = create_builder(&[]);
        let block = builder.create_block(None);
        builder.add_parameter(block, None);
        builder.jump(Edge::to(block));
    }

    #[test]
    #[should_panic(expected = "an edge fills every explicit parameter of its target")]
    fn edge_with_extra_argument_panics() {
        let mut builder = create_builder(&[TypeTable::ANYTHING]);
        let argument = builder.parameter(0);
        let block = builder.create_block(None);
        builder.jump(Edge::with_arguments(block, &[argument]));
    }

    #[test]
    #[should_panic(expected = "no edge targets block 0")]
    fn edge_to_entry_block_panics() {
        let mut builder = create_builder(&[]);
        let entry = builder.current_block();
        builder.jump(Edge::to(entry));
    }

    #[test]
    #[should_panic(expected = "only handler edges reach a handler block")]
    fn edge_to_handler_block_panics() {
        let mut builder = create_builder(&[]);
        let handler = create_catch_handler(&mut builder);
        builder.jump(Edge::to(handler.block()));
    }

    #[test]
    #[should_panic(expected = "a sealed block gets no new predecessor")]
    fn edge_to_sealed_block_panics() {
        let mut builder = create_builder(&[]);
        let block = builder.create_block(None);
        builder.seal(block);
        builder.jump(Edge::to(block));
    }

    #[test]
    #[should_panic(expected = "an unsealed block has parameters without arguments")]
    fn finishing_with_unsealed_block_panics() {
        let mut builder = create_builder(&[]);
        builder.create_block(None);
        builder.finish();
    }

    #[test]
    #[should_panic(expected = "a loop header is declared before its back edges")]
    fn loop_header_declared_after_sealing_panics() {
        let mut builder = create_builder(&[]);
        let header = builder.create_block(None);
        builder.seal(header);
        builder.declare_loop_header(header, &[]);
    }
}
