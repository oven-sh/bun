use super::assert_graph;
use crate::ir::builder::{Edge, FunctionBuilder, LocalVariable};
use crate::ir::ids::{BlockId, ValueId};
use crate::ir::ssa::MAX_SHORTCUT_DEFINITION_BLOCKS;
use crate::ir::testing::{build_function, create_blocks};
use crate::ir::types::TypeTable;

pub(super) fn write_integer(builder: &mut FunctionBuilder, variable: LocalVariable, constant: i64) {
    let value = builder.integer(constant);
    builder.write_variable(variable, value);
}

pub(super) fn increment_variable(builder: &mut FunctionBuilder, variable: LocalVariable) {
    let value = builder.read_variable(variable);
    let value = builder.increment(value);
    builder.write_variable(variable, value);
}

pub(super) fn emit_read_marker(builder: &mut FunctionBuilder, variable: LocalVariable) {
    let value = builder.read_variable(variable);
    builder.type_of(value);
}

pub(super) fn enter_loop(
    builder: &mut FunctionBuilder,
    header: BlockId,
    modified: &[LocalVariable],
) {
    builder.declare_loop_header(header, modified);
    builder.jump(Edge::to(header));
    builder.switch_to(header);
    builder.loop_hint();
}

fn branch_and_seal(
    builder: &mut FunctionBuilder,
    condition: ValueId,
    taken: BlockId,
    not_taken: BlockId,
) {
    builder.branch(condition, Edge::to(taken), Edge::to(not_taken));
    builder.seal(taken);
    builder.seal(not_taken);
}

fn branch_if_less(
    builder: &mut FunctionBuilder,
    left: LocalVariable,
    right: LocalVariable,
    taken: BlockId,
    not_taken: BlockId,
) {
    let left = builder.read_variable(left);
    let right = builder.read_variable(right);
    let is_less = builder.less(left, right);
    branch_and_seal(builder, is_less, taken, not_taken);
}

const NESTED_LOOPS: &str = "\
function f0 module=m0 thisType={type=anything} results=[{type=anything}] {
  b0():
    v0 = Integer integer=100
    v1 = Integer
    Jump -> next b1(v1)
  b1(v2):
    LoopHint
    v4 = Less v2, v0
    Branch v4 -> taken b2(), notTaken b6()
  b2():
    v5 = Integer integer=1
    Jump -> next b3(v5)
  b3(v6):
    LoopHint
    v8 = Less v6, v0
    Branch v8 -> taken b4(), notTaken b5()
  b4():
    v9 = Increment v6
    Jump -> next b3(v9)
  b5():
    v10 = Increment v2
    Jump -> next b1(v10)
  b6():
    v11 = TypeOf v0
    Return
}
";

#[test]
fn nested_loops() {
    assert_graph(&[], NESTED_LOOPS, |builder| {
        let [x, i, j] = [(); 3].map(|()| builder.create_variable(None));
        let [outer, outer_body, inner, inner_body, latch, exit] = create_blocks(builder);

        write_integer(builder, x, 100);
        write_integer(builder, i, 0);
        enter_loop(builder, outer, &[i]);
        branch_if_less(builder, i, x, outer_body, exit);

        builder.switch_to(outer_body);
        write_integer(builder, j, 1);
        enter_loop(builder, inner, &[j]);
        branch_if_less(builder, j, x, inner_body, latch);

        builder.switch_to(inner_body);
        increment_variable(builder, j);
        builder.jump(Edge::to(inner));
        builder.seal(inner);

        builder.switch_to(latch);
        increment_variable(builder, i);
        builder.jump(Edge::to(outer));
        builder.seal(outer);

        builder.switch_to(exit);
        emit_read_marker(builder, x);
        builder.return_value(None);
    });
}

const LOOP_WITH_BREAK_AND_CONTINUE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    v1 = Integer
    Jump -> next b1(v1)
  b1(v2):
    LoopHint
    Branch v0 -> taken b2(), notTaken b5(v2)
  b2():
    v4 = Increment v2
    Branch v0 -> taken b5(v4), notTaken b3()
  b3():
    Branch v0 -> taken b1(v4), notTaken b4()
  b4():
    v5 = Increment v4
    Jump -> next b1(v5)
  b5(v6):
    v7 = TypeOf v6
    Return
}
";

#[test]
fn loop_with_break_and_continue() {
    let parameters = [TypeTable::BOOLEAN];
    assert_graph(&parameters, LOOP_WITH_BREAK_AND_CONTINUE, |builder| {
        let condition = builder.parameter(0);
        let i = builder.create_variable(None);
        let [header, body, after_break, tail, exit] = create_blocks(builder);

        write_integer(builder, i, 0);
        enter_loop(builder, header, &[i]);
        builder.branch(condition, Edge::to(body), Edge::to(exit));
        builder.seal(body);

        builder.switch_to(body);
        increment_variable(builder, i);
        builder.branch(condition, Edge::to(exit), Edge::to(after_break));
        builder.seal(after_break);

        builder.switch_to(after_break);
        builder.branch(condition, Edge::to(header), Edge::to(tail));
        builder.seal(tail);

        builder.switch_to(tail);
        increment_variable(builder, i);
        builder.jump(Edge::to(header));
        builder.seal(header);
        builder.seal(exit);

        builder.switch_to(exit);
        emit_read_marker(builder, i);
        builder.return_value(None);
    });
}

const IRREDUCIBLE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    v1 = Integer integer=1
    Branch v0 -> taken b2(v1), notTaken b1(v1)
  b1(v2):
    LoopHint
    v4 = TypeOf v2
    v5 = Integer integer=3
    Branch v0 -> taken b2(v5), notTaken b3()
  b2(v6):
    LoopHint
    v8 = TypeOf v6
    v9 = Integer integer=2
    Jump -> next b1(v9)
  b3():
    Return
}
";

#[test]
fn irreducible() {
    assert_graph(&[TypeTable::BOOLEAN], IRREDUCIBLE, |builder| {
        let condition = builder.parameter(0);
        let variable = builder.create_variable(None);
        let [left, right, exit] = create_blocks(builder);

        write_integer(builder, variable, 1);
        builder.branch(condition, Edge::to(left), Edge::to(right));

        builder.switch_to(left);
        builder.loop_hint();
        emit_read_marker(builder, variable);
        write_integer(builder, variable, 2);
        builder.jump(Edge::to(right));

        builder.switch_to(right);
        builder.loop_hint();
        emit_read_marker(builder, variable);
        write_integer(builder, variable, 3);
        builder.branch(condition, Edge::to(left), Edge::to(exit));

        builder.switch_to(exit);
        builder.return_value(None);

        for block in [left, right, exit] {
            builder.seal(block);
        }
    });
}

const CLEANUP_ENTERED_BY_NUMBER: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    Branch v0 -> taken b1(), notTaken b2()
  b1():
    v1 = Integer
    Jump -> next b5(v1)
  b2():
    Branch v0 -> taken b3(), notTaken b4()
  b3():
    v2 = Integer integer=1
    Jump -> next b5(v2)
  b4():
    v3 = Integer integer=2
    Jump -> next b5(v3)
  b5(v4):
    Switch v4 cases=[0, 1, 2] -> case b6(), case b7(), case b8(), otherwise b9()
  b6():
    Return
  b7():
    Return
  b8():
    Return
  b9():
    Unreachable
}
";

#[test]
fn cleanup_entered_by_number() {
    let parameters = [TypeTable::BOOLEAN];
    assert_graph(&parameters, CLEANUP_ENTERED_BY_NUMBER, |builder| {
        let condition = builder.parameter(0);
        let variable = builder.create_variable(None);
        let [first_exit, other_exits, second_exit, third_exit, cleanup] = create_blocks(builder);

        branch_and_seal(builder, condition, first_exit, other_exits);
        builder.switch_to(other_exits);
        branch_and_seal(builder, condition, second_exit, third_exit);
        for (constant, exit) in (0..).zip([first_exit, second_exit, third_exit]) {
            builder.switch_to(exit);
            write_integer(builder, variable, constant);
            builder.jump(Edge::to(cleanup));
        }
        builder.seal(cleanup);

        builder.switch_to(cleanup);
        let subject = builder.read_variable(variable);
        let continuations: [BlockId; 3] = create_blocks(builder);
        let otherwise = builder.create_block(None);
        let cases = continuations.map(Edge::to);
        builder.switch(subject, &[0, 1, 2], &cases, Edge::to(otherwise));
        for block in continuations {
            builder.seal(block);
            builder.switch_to(block);
            builder.return_value(None);
        }
        builder.seal(otherwise);
        builder.switch_to(otherwise);
        builder.unreachable();
    });
}

const CODE_AFTER_RETURN: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    v1 = Integer integer=1
    Branch v0 -> taken b1(), notTaken b2()
  b1():
    Return
  b2():
    v2 = TypeOf v1
    Return
}
";

#[test]
fn code_after_return() {
    assert_graph(&[TypeTable::BOOLEAN], CODE_AFTER_RETURN, |builder| {
        let condition = builder.parameter(0);
        let variable = builder.create_variable(None);
        let [returning, target] = create_blocks(builder);

        write_integer(builder, variable, 1);
        builder.branch(condition, Edge::to(returning), Edge::to(target));
        builder.seal(returning);

        builder.switch_to(returning);
        builder.return_value(None);
        builder.jump(Edge::to(target));

        let dead = builder.create_block(None);
        builder.seal(dead);
        builder.switch_to(dead);
        write_integer(builder, variable, 2);
        emit_read_marker(builder, variable);
        builder.jump(Edge::to(target));
        builder.seal(target);

        builder.switch_to(target);
        emit_read_marker(builder, variable);
        builder.return_value(None);
    });
}

const TWO_EDGES_FROM_ONE_BRANCH: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    v1 = Integer integer=7
    Branch v0 -> taken b1(v1), notTaken b1(v1)
  b1(v2):
    v3 = TypeOf v2
    Return
}
";

#[test]
fn two_edges_from_one_branch() {
    let parameters = [TypeTable::BOOLEAN];
    assert_graph(&parameters, TWO_EDGES_FROM_ONE_BRANCH, |builder| {
        let condition = builder.parameter(0);
        let variable = builder.create_variable(None);
        let target = builder.create_block(None);

        write_integer(builder, variable, 7);
        builder.branch(condition, Edge::to(target), Edge::to(target));

        builder.switch_to(target);
        emit_read_marker(builder, variable);
        builder.return_value(None);
        builder.seal(target);
    });
}

const DIAMOND_WITH_ONE_VALUE: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    v1 = Integer integer=5
    Branch v0 -> taken b1(), notTaken b2()
  b1():
    Jump -> next b3()
  b2():
    Jump -> next b3()
  b3():
    v2 = TypeOf v1
    Return
}
";

const DIAMOND_WITH_TWO_VALUES: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
  b0(v0: boolean):
    Branch v0 -> taken b1(), notTaken b2()
  b1():
    v1 = Integer integer=5
    Jump -> next b3(v1)
  b2():
    v2 = Integer integer=6
    Jump -> next b3(v2)
  b3(v3):
    v4 = TypeOf v3
    Return
}
";

fn fill_diamond(
    builder: &mut FunctionBuilder,
    mut write_in_arm: impl FnMut(&mut FunctionBuilder, LocalVariable, usize),
) {
    let condition = builder.parameter(0);
    let variable = builder.create_variable(None);
    let [left, right, join] = create_blocks(builder);

    branch_and_seal(builder, condition, left, right);
    for (arm, block) in [left, right].into_iter().enumerate() {
        builder.switch_to(block);
        write_in_arm(builder, variable, arm);
        builder.jump(Edge::to(join));
    }
    builder.seal(join);

    builder.switch_to(join);
    emit_read_marker(builder, variable);
    builder.return_value(None);
}

#[test]
fn trivial_parameters_are_removed() {
    let parameters = [TypeTable::BOOLEAN];
    assert_graph(&parameters, DIAMOND_WITH_ONE_VALUE, |builder| {
        let value = builder.integer(5);
        fill_diamond(builder, |builder, variable, _| {
            builder.write_variable(variable, value);
        });
    });
    assert_graph(&parameters, DIAMOND_WITH_TWO_VALUES, |builder| {
        fill_diamond(builder, |builder, variable, arm| {
            write_integer(builder, variable, [5, 6][arm]);
        });
    });
}

const CHAIN_LENGTH: usize = 20_000;
const ONE_STORE: usize = 1;
const STORES_WITHIN_SHORTCUT_LIMIT: usize = 2;
const STORES_OVER_SHORTCUT_LIMIT: usize = MAX_SHORTCUT_DEFINITION_BLOCKS + 1;
const _: () = assert!(STORES_WITHIN_SHORTCUT_LIMIT <= MAX_SHORTCUT_DEFINITION_BLOCKS);

fn assert_chain(storing_block_count: usize, reads_in_every_block: bool) {
    let function = build_function(&[], |builder| {
        let variable = builder.create_variable(None);
        let mut stored = None;
        for index in 0..CHAIN_LENGTH {
            if index > 0 {
                let next = builder.create_block(None);
                builder.jump(Edge::to(next));
                builder.seal(next);
                builder.switch_to(next);
            }
            if index < storing_block_count {
                let value = builder.integer(index as i64);
                builder.write_variable(variable, value);
                stored = Some(value);
            }
            if reads_in_every_block || index + 1 == CHAIN_LENGTH {
                let value = builder.read_variable(variable);
                assert_eq!(Some(value), stored, "block {index}");
                builder.type_of(value);
            }
        }
        builder.return_value(None);
    });
    let read_count = if reads_in_every_block {
        CHAIN_LENGTH
    } else {
        1
    };
    assert_eq!(function.body.block_count as usize, CHAIN_LENGTH);
    assert_eq!(
        function.body.value_count as usize,
        storing_block_count + read_count
    );
}

#[test]
fn long_chain() {
    for storing_block_count in [
        ONE_STORE,
        STORES_WITHIN_SHORTCUT_LIMIT,
        STORES_OVER_SHORTCUT_LIMIT,
    ] {
        assert_chain(storing_block_count, false);
        assert_chain(storing_block_count, true);
    }
}
