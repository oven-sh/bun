use super::assert_graph;
use super::graphs::{emit_read_marker, enter_loop, increment_variable, write_integer};
use crate::ir::builder::{Edge, FunctionBuilder, Handler};
use crate::ir::generated::{
    BlockFrequency, BlockRole, IteratorCompletion, IteratorKind, Opcode, ResumeMode,
};
use crate::ir::ids::{TypeId, ValueId};
use crate::ir::testing::{build_function, create_catch_handler, enter_block};
use crate::ir::types::TypeTable;

pub(super) fn emit_call(builder: &mut FunctionBuilder, callee: ValueId) -> ValueId {
    builder.call(callee, None, &[], None, None, None, false, false)
}

fn enter_landing_block(builder: &mut FunctionBuilder, handler: Handler) {
    builder.seal(handler.block());
    builder.switch_to(handler.block());
    builder.catch_value();
}

const THROWING_OPERATIONS: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Jump -> next b1()
  b1() handler=b2():
    v1 = Call v0
    v2 = Call v0
    v3 = Call v0
    Return
  b2() role=CatchHandler:
    v4 = CatchValue
    Return
}
";

#[test]
fn throwing_operations_share_a_block() {
    assert_graph(&[TypeTable::ANYTHING], THROWING_OPERATIONS, |builder| {
        let callee = builder.parameter(0);
        let handler = create_catch_handler(builder);
        enter_block(builder, Some(handler));
        for _ in 0..3 {
            emit_call(builder, callee);
        }
        builder.return_value(None);
        enter_landing_block(builder, handler);
        builder.return_value(None);
    });
}

const STORE_TO_VISIBLE_VARIABLE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=1
    Jump -> next b1()
  b1() handler=b3(v1):
    v2 = Call v0
    v3 = Integer integer=2
    Jump -> next b2()
  b2() handler=b3(v3):
    v4 = Call v0
    Return
  b3(v5) role=CatchHandler:
    v6 = CatchValue
    v7 = TypeOf v5
    Return
}
";

fn fill_store_to_visible_variable(builder: &mut FunctionBuilder) {
    let callee = builder.parameter(0);
    let x = builder.create_variable(None);
    write_integer(builder, x, 1);
    let handler = create_catch_handler(builder);
    let covered = enter_block(builder, Some(handler));
    emit_call(builder, callee);
    write_integer(builder, x, 2);
    assert_ne!(builder.current_block(), covered);
    assert_eq!(builder.handler_of(builder.current_block()), Some(handler));
    emit_call(builder, callee);
    builder.return_value(None);
    enter_landing_block(builder, handler);
    emit_read_marker(builder, x);
    builder.return_value(None);
}

#[test]
fn store_to_visible_variable_ends_block() {
    assert_graph(
        &[TypeTable::ANYTHING],
        STORE_TO_VISIBLE_VARIABLE,
        fill_store_to_visible_variable,
    );
}

const STORE_TO_INNER_VARIABLE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Jump -> next b1()
  b1() handler=b2():
    v1 = Call v0
    v2 = Integer integer=2
    v3 = Call v0
    v4 = TypeOf v2
    Return
  b2() role=CatchHandler:
    v5 = CatchValue
    Return
}
";

#[test]
fn store_to_inner_variable_does_not_end_block() {
    assert_graph(&[TypeTable::ANYTHING], STORE_TO_INNER_VARIABLE, |builder| {
        let callee = builder.parameter(0);
        let handler = create_catch_handler(builder);
        let temporary = builder.create_variable(None);
        let covered = enter_block(builder, Some(handler));
        emit_call(builder, callee);
        write_integer(builder, temporary, 2);
        assert_eq!(builder.current_block(), covered);
        emit_call(builder, callee);
        emit_read_marker(builder, temporary);
        builder.return_value(None);
        enter_landing_block(builder, handler);
        builder.return_value(None);
    });
}

const STORE_BEFORE_FIRST_VALUE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=1
    v2 = Integer integer=2
    Jump -> next b1()
  b1() handler=b2():
    v3 = Call v0
    Return
  b2() role=CatchHandler:
    v4 = CatchValue
    v5 = TypeOf v2
    Return
}
";

fn fill_store_before_first_value(builder: &mut FunctionBuilder) {
    let callee = builder.parameter(0);
    let x = builder.create_variable(None);
    write_integer(builder, x, 1);
    let stored = builder.integer(2);
    let handler = create_catch_handler(builder);
    let covered = enter_block(builder, Some(handler));
    builder.write_variable(x, stored);
    assert_eq!(builder.current_block(), covered);
    emit_call(builder, callee);
    builder.return_value(None);
    enter_landing_block(builder, handler);
    emit_read_marker(builder, x);
    builder.return_value(None);
}

#[test]
fn store_before_first_value_does_not_end_block() {
    assert_graph(
        &[TypeTable::ANYTHING],
        STORE_BEFORE_FIRST_VALUE,
        fill_store_before_first_value,
    );
}

const HANDLER_THAT_READS_NOTHING: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=1
    Jump -> next b1()
  b1() handler=b3():
    v2 = Call v0
    v3 = Integer integer=2
    Jump -> next b2()
  b2() handler=b3():
    v4 = Call v0
    Return
  b3() role=CatchHandler:
    v5 = CatchValue
    Return
}
";

#[test]
fn handler_that_reads_nothing_has_no_parameter() {
    assert_graph(
        &[TypeTable::ANYTHING],
        HANDLER_THAT_READS_NOTHING,
        |builder| {
            let callee = builder.parameter(0);
            let x = builder.create_variable(None);
            write_integer(builder, x, 1);
            let handler = create_catch_handler(builder);
            enter_block(builder, Some(handler));
            emit_call(builder, callee);
            write_integer(builder, x, 2);
            emit_call(builder, callee);
            builder.return_value(None);
            enter_landing_block(builder, handler);
            builder.return_value(None);
        },
    );
}

#[test]
fn single_covered_block_passes_no_argument() {
    let function = build_function(&[TypeTable::ANYTHING], |builder| {
        let callee = builder.parameter(0);
        let x = builder.create_variable(None);
        let stored = builder.integer(1);
        builder.write_variable(x, stored);
        let handler = create_catch_handler(builder);
        enter_block(builder, Some(handler));
        emit_call(builder, callee);
        builder.return_value(None);
        enter_landing_block(builder, handler);
        assert_eq!(builder.read_variable(x), stored);
        builder.return_value(None);
    });
    let handlers = function.body.blocks().filter_map(|block| block.handler());
    let argument_counts: Vec<usize> = handlers.map(|handler| handler.arguments().len()).collect();
    assert_eq!(argument_counts, [0]);
    let landing = function.body.blocks().last().expect("the body has blocks");
    assert_eq!(landing.role, BlockRole::CatchHandler);
    assert_eq!(landing.parameter_count(), 0);
}

const HANDLER_ARGUMENTS_IN_PARAMETER_ORDER: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=1
    v2 = Integer integer=2
    Jump -> next b1()
  b1() handler=b4(v2, v1):
    v3 = Call v0
    v4 = Integer integer=3
    Jump -> next b2()
  b2() handler=b4(v2, v4):
    v5 = Call v0
    v6 = Integer integer=4
    Jump -> next b3()
  b3() handler=b4(v6, v4):
    v7 = Call v0
    Return
  b4(v8, v9) role=CatchHandler:
    v10 = CatchValue
    v11 = TypeOf v8
    v12 = TypeOf v9
    Return
}
";

fn fill_two_visible_variables(builder: &mut FunctionBuilder) {
    let callee = builder.parameter(0);
    let [x, y] = [(); 2].map(|()| builder.create_variable(None));
    write_integer(builder, x, 1);
    write_integer(builder, y, 2);
    let handler = create_catch_handler(builder);
    enter_block(builder, Some(handler));
    emit_call(builder, callee);
    write_integer(builder, x, 3);
    emit_call(builder, callee);
    write_integer(builder, y, 4);
    emit_call(builder, callee);
    builder.return_value(None);
    enter_landing_block(builder, handler);
    emit_read_marker(builder, y);
    emit_read_marker(builder, x);
    builder.return_value(None);
}

#[test]
fn handler_arguments_follow_parameter_order() {
    assert_graph(
        &[TypeTable::ANYTHING],
        HANDLER_ARGUMENTS_IN_PARAMETER_ORDER,
        fill_two_visible_variables,
    );
}

const NESTED_HANDLERS: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=1
    Jump -> next b1()
  b1() handler=b5(v1):
    v2 = Call v0
    Jump -> next b2()
  b2() handler=b4(v1):
    v3 = Call v0
    v4 = Integer integer=2
    Jump -> next b3()
  b3() handler=b4(v4):
    v5 = Call v0
    Return
  b4(v6) role=CatchHandler handler=b5(v6):
    v7 = CatchValue
    v8 = TypeOf v6
    v9 = Call v0
    Return
  b5(v10) role=CatchHandler:
    v11 = CatchValue
    v12 = TypeOf v10
    Return
}
";

fn fill_nested_handlers(builder: &mut FunctionBuilder) {
    let callee = builder.parameter(0);
    let x = builder.create_variable(None);
    write_integer(builder, x, 1);
    let outer = create_catch_handler(builder);
    enter_block(builder, Some(outer));
    emit_call(builder, callee);
    let inner = builder.create_handler(BlockRole::CatchHandler, None, Some(outer));
    assert_eq!(builder.handler_of(inner.block()), Some(outer));
    enter_block(builder, Some(inner));
    emit_call(builder, callee);
    write_integer(builder, x, 2);
    emit_call(builder, callee);
    builder.return_value(None);
    enter_landing_block(builder, inner);
    emit_read_marker(builder, x);
    emit_call(builder, callee);
    builder.return_value(None);
    enter_landing_block(builder, outer);
    emit_read_marker(builder, x);
    builder.return_value(None);
}

#[test]
fn nested_handlers() {
    assert_graph(
        &[TypeTable::ANYTHING],
        NESTED_HANDLERS,
        fill_nested_handlers,
    );
}

const LOOP_INSIDE_TRY: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}, {type=anything}] results=[{type=anything}] {
  b0(v0: boolean, v1: anything):
    v2 = Integer
    Jump -> next b1(v2)
  b1(v3) handler=b5(v3):
    LoopHint
    Branch v0 -> taken b2(), notTaken b4()
  b2() handler=b5(v3):
    v5 = Call v1
    v6 = Increment v3
    Jump -> next b3()
  b3() handler=b5(v6):
    Jump -> next b1(v6)
  b4():
    Return
  b5(v7) role=CatchHandler:
    v8 = CatchValue
    v9 = TypeOf v7
    Return
}
";

const LOOP_PARAMETERS: [TypeId; 2] = [TypeTable::BOOLEAN, TypeTable::ANYTHING];

fn fill_loop_inside_try(builder: &mut FunctionBuilder) {
    let (condition, callee) = (builder.parameter(0), builder.parameter(1));
    let i = builder.create_variable(None);
    write_integer(builder, i, 0);
    let handler = create_catch_handler(builder);
    let [header, body] = [(); 2].map(|()| builder.create_block(Some(handler)));
    let exit = builder.create_block(None);
    enter_loop(builder, header, &[i]);
    builder.branch(condition, Edge::to(body), Edge::to(exit));
    builder.seal(body);
    builder.seal(exit);

    builder.switch_to(body);
    emit_call(builder, callee);
    increment_variable(builder, i);
    builder.jump(Edge::to(header));
    builder.seal(header);

    builder.switch_to(exit);
    builder.return_value(None);
    enter_landing_block(builder, handler);
    emit_read_marker(builder, i);
    builder.return_value(None);
}

#[test]
fn loop_inside_try() {
    assert_graph(&LOOP_PARAMETERS, LOOP_INSIDE_TRY, fill_loop_inside_try);
}

fn assert_handler_arguments_are_available(
    parameters: &[TypeId],
    fill: impl FnOnce(&mut FunctionBuilder),
) {
    let function = build_function(parameters, fill);
    let mut argument_count = 0;
    for block in function.body.blocks() {
        let Some(handler) = block.handler() else {
            continue;
        };
        for argument in handler.arguments() {
            assert!(argument < block.first_value(), "{argument} in {}", block.id);
            argument_count += 1;
        }
    }
    assert!(argument_count > 0);
}

#[test]
fn handler_argument_is_defined_before_its_block() {
    let parameters = [TypeTable::ANYTHING];
    assert_handler_arguments_are_available(&parameters, fill_store_to_visible_variable);
    assert_handler_arguments_are_available(&parameters, fill_two_visible_variables);
    assert_handler_arguments_are_available(&parameters, fill_nested_handlers);
    assert_handler_arguments_are_available(&LOOP_PARAMETERS, fill_loop_inside_try);
}

fn fill_dead_covered_blocks(builder: &mut FunctionBuilder) {
    let callee = builder.parameter(0);
    let x = builder.create_variable(None);
    write_integer(builder, x, 1);
    let handler = create_catch_handler(builder);
    enter_block(builder, Some(handler));
    emit_call(builder, callee);
    write_integer(builder, x, 2);
    emit_call(builder, callee);
    builder.return_value(None);

    let dead = builder.create_block(Some(handler));
    builder.seal(dead);
    builder.switch_to(dead);
    emit_call(builder, callee);
    write_integer(builder, x, 3);
    assert_ne!(builder.current_block(), dead);
    emit_call(builder, callee);
    builder.return_value(None);

    enter_landing_block(builder, handler);
    emit_read_marker(builder, x);
    builder.return_value(None);
}

#[test]
fn dead_covered_block_is_dropped() {
    let parameters = [TypeTable::ANYTHING];
    assert_graph(
        &parameters,
        STORE_TO_VISIBLE_VARIABLE,
        fill_dead_covered_blocks,
    );
    let function = build_function(&parameters, fill_dead_covered_blocks);
    let values = function.body.blocks().flat_map(|block| block.values());
    assert_eq!(
        values
            .filter(|value| value.opcode == Opcode::Undefined)
            .count(),
        0
    );
}

const ENTRY_BLOCK_ALONE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Return
}
";

#[test]
fn handler_covering_only_dead_blocks_is_dropped() {
    assert_graph(&[TypeTable::ANYTHING], ENTRY_BLOCK_ALONE, |builder| {
        let callee = builder.parameter(0);
        builder.return_value(None);
        let handler = create_catch_handler(builder);
        let dead = builder.create_block(Some(handler));
        builder.seal(dead);
        builder.switch_to(dead);
        emit_call(builder, callee);
        builder.return_value(None);
        enter_landing_block(builder, handler);
        builder.return_value(None);
    });
}

const ITERATION_CLEANUP: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = IteratorOpen v0
    Jump -> next b1()
  b1() handler=b2():
    v2 = IteratorResume v1
    Return
  b2() role=IterationCleanup subject=v1:
    v3 = CatchException
    IteratorClose v1 completion=Throw
    Rethrow v3
}
";

#[test]
fn roles_and_subject() {
    assert_graph(&[TypeTable::ANYTHING], ITERATION_CLEANUP, |builder| {
        let iterable = builder.parameter(0);
        let iterator = builder.iterator_open(iterable, IteratorKind::Sync, None, false, false);
        let cleanup = builder.create_handler(BlockRole::IterationCleanup, Some(iterator), None);
        enter_block(builder, Some(cleanup));
        let (kind, mode) = (IteratorKind::Sync, ResumeMode::Next);
        builder.iterator_resume(iterator, None, kind, mode, None, false);
        builder.return_value(None);
        builder.seal(cleanup.block());
        builder.switch_to(cleanup.block());
        let exception = builder.catch_exception();
        builder.iterator_close(iterator, kind, IteratorCompletion::Throw);
        builder.rethrow(exception);
    });
}

#[test]
fn landing_block_has_handler_role() {
    let roles = BlockRole::ALL.into_iter();
    for role in roles.filter(|&role| role != BlockRole::Ordinary) {
        let function = build_function(&[TypeTable::ANYTHING], |builder| {
            let callee = builder.parameter(0);
            let handler = builder.create_handler(role, None, None);
            enter_block(builder, Some(handler));
            emit_call(builder, callee);
            builder.return_value(None);
            enter_landing_block(builder, handler);
            builder.return_value(None);
        });
        let roles: Vec<BlockRole> = function.body.blocks().map(|block| block.role).collect();
        assert_eq!(roles, [BlockRole::Ordinary, BlockRole::Ordinary, role]);
        assert!(function.body.blocks().all(|block| block.subject.is_none()));
    }
}

#[test]
fn split_keeps_frequency() {
    let function = build_function(&[TypeTable::ANYTHING], |builder| {
        let callee = builder.parameter(0);
        let x = builder.create_variable(None);
        write_integer(builder, x, 1);
        let handler = create_catch_handler(builder);
        let covered = enter_block(builder, Some(handler));
        builder.set_frequency(covered, BlockFrequency::Unlikely);
        emit_call(builder, callee);
        write_integer(builder, x, 2);
        emit_call(builder, callee);
        builder.return_value(None);
        enter_landing_block(builder, handler);
        builder.return_value(None);
    });
    let blocks = function.body.blocks();
    let frequencies: Vec<BlockFrequency> = blocks.map(|block| block.frequency).collect();
    let (normal, unlikely) = (BlockFrequency::Normal, BlockFrequency::Unlikely);
    assert_eq!(frequencies, [normal, unlikely, unlikely, normal]);
}

#[cfg(debug_assertions)]
mod debug_assertions {
    use super::*;

    #[test]
    #[should_panic(expected = "a handler reads only variables created before it")]
    fn reading_inner_variable_in_handler_panics() {
        build_function(&[], |builder| {
            let handler = create_catch_handler(builder);
            let inner = builder.create_variable(None);
            builder.switch_to(handler.block());
            builder.read_variable(inner);
        });
    }

    #[test]
    #[should_panic(expected = "a sealed handler covers no new block")]
    fn covering_with_sealed_handler_panics() {
        build_function(&[], |builder| {
            let handler = create_catch_handler(builder);
            builder.seal(handler.block());
            builder.create_block(Some(handler));
        });
    }

    #[test]
    #[should_panic(expected = "a handler block has a role")]
    fn handler_with_ordinary_role_panics() {
        build_function(&[], |builder| {
            builder.create_handler(BlockRole::Ordinary, None, None);
        });
    }
}
