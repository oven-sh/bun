use super::assert_graph;
use super::graphs::emit_read_marker;
use super::handlers::emit_call;
use crate::ir::builder::{Edge, FunctionBuilder, Handler};
use crate::ir::ids::{BlockId, ValueId};
use crate::ir::testing::{build_function, create_blocks, create_catch_handler};
use crate::ir::types::TypeTable;

struct NarrowingBranch {
    blocks: [BlockId; 2],
    edge_results: [ValueId; 2],
}

fn branch_on_string_test(
    builder: &mut FunctionBuilder,
    value: ValueId,
    handler: Option<Handler>,
) -> NarrowingBranch {
    let test = builder.type_test(value, TypeTable::STRING);
    let blocks = [(); 2].map(|()| builder.create_block(handler));
    let edge_results = blocks.map(|block| builder.add_edge_result(block));
    let [taken, not_taken] = blocks.map(|block| Edge::with_proofs(block, &[0]));
    builder.branch(test, taken, not_taken);
    for block in blocks {
        builder.seal(block);
    }
    NarrowingBranch {
        blocks,
        edge_results,
    }
}

const PROOF_ON_BOTH_EDGES: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = TypeTest v0 testedType=string
    Branch v1 -> taken b1(| 0), notTaken b2(| 0)
  b1(v2):
    Return v2
  b2(v3):
    Return v3
}
";

#[test]
fn branch_passes_proof_on_both_edges() {
    assert_graph(&[TypeTable::ANYTHING], PROOF_ON_BOTH_EDGES, |builder| {
        let value = builder.parameter(0);
        let branch = branch_on_string_test(builder, value, None);
        for (block, edge_result) in branch.blocks.into_iter().zip(branch.edge_results) {
            builder.switch_to(block);
            builder.return_value(Some(edge_result));
        }
    });
}

#[test]
fn rebound_variable_reads_edge_result() {
    build_function(&[TypeTable::ANYTHING], |builder| {
        let value = builder.parameter(0);
        let variable = builder.create_variable(None);
        builder.write_variable(variable, value);
        let branch = branch_on_string_test(builder, value, None);
        let [taken, not_taken] = branch.blocks;
        let [when_taken, when_not_taken] = branch.edge_results;

        builder.switch_to(taken);
        assert_eq!(builder.read_variable(variable), value);
        builder.write_variable(variable, when_taken);
        assert_eq!(builder.read_variable(variable), when_taken);
        let next = builder.create_block(None);
        builder.jump(Edge::to(next));
        builder.seal(next);
        builder.switch_to(next);
        assert_eq!(builder.read_variable(variable), when_taken);
        builder.return_value(None);

        builder.switch_to(not_taken);
        builder.write_variable(variable, when_not_taken);
        assert_eq!(builder.read_variable(variable), when_not_taken);
        builder.return_value(None);
    });
}

const JOIN_AFTER_PROOFS: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = TypeTest v0 testedType=string
    Branch v1 -> taken b1(| 0), notTaken b2(| 0)
  b1(v2):
    Jump -> next b3(v2)
  b2(v3):
    Jump -> next b3(v3)
  b3(v4):
    v5 = TypeOf v4
    Return
}
";

#[test]
fn join_after_proofs_is_a_variable_parameter() {
    assert_graph(&[TypeTable::ANYTHING], JOIN_AFTER_PROOFS, |builder| {
        let value = builder.parameter(0);
        let variable = builder.create_variable(None);
        builder.write_variable(variable, value);
        let branch = branch_on_string_test(builder, value, None);
        let join = builder.create_block(None);
        for (block, edge_result) in branch.blocks.into_iter().zip(branch.edge_results) {
            builder.switch_to(block);
            builder.write_variable(variable, edge_result);
            builder.jump(Edge::to(join));
        }
        builder.seal(join);
        builder.switch_to(join);
        emit_read_marker(builder, variable);
        builder.return_value(None);
    });
}

const EDGE_RESULTS_LAST: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Integer integer=7
    v2 = TypeTest v0 testedType=string
    Branch v2 -> taken b1(v0, v1 | 0), notTaken b2()
  b1(v3: string, v4: number, v5):
    v6 = Strcat v3, v4, v5
    Return
  b2():
    Return
}
";

#[test]
fn edge_results_come_last() {
    assert_graph(&[TypeTable::ANYTHING], EDGE_RESULTS_LAST, |builder| {
        let value = builder.parameter(0);
        let variable = builder.create_variable(Some(TypeTable::NUMBER));
        let stored = builder.integer(7);
        builder.write_variable(variable, stored);
        let test = builder.type_test(value, TypeTable::STRING);
        let [taken, not_taken] = create_blocks(builder);
        let explicit = builder.add_parameter(taken, Some(TypeTable::STRING));
        let edge_result = builder.add_edge_result(taken);
        let edge = Edge {
            block: taken,
            arguments: &[value],
            proofs: &[0],
        };
        builder.branch(test, edge, Edge::to(not_taken));

        builder.switch_to(taken);
        let read = builder.read_variable(variable);
        builder.seal(taken);
        builder.strcat(&[explicit, read, edge_result]);
        builder.return_value(None);

        builder.seal(not_taken);
        builder.switch_to(not_taken);
        builder.return_value(None);
    });
}

const TRAILING_ARGUMENT: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = TypeTest v0 testedType=string
    Branch v1 -> taken b2(| 0), notTaken b1()
  b1():
    Jump -> next b2(v0)
  b2(v2):
    Return v2
}
";

#[test]
fn edge_without_proof_passes_trailing_argument() {
    assert_graph(&[TypeTable::ANYTHING], TRAILING_ARGUMENT, |builder| {
        let value = builder.parameter(0);
        let test = builder.type_test(value, TypeTable::STRING);
        let [join, other] = create_blocks(builder);
        let edge_result = builder.add_edge_result(join);
        builder.branch(test, Edge::with_proofs(join, &[0]), Edge::to(other));
        builder.seal(other);

        builder.switch_to(other);
        builder.jump(Edge::with_arguments(join, &[value]));
        builder.seal(join);

        builder.switch_to(join);
        builder.return_value(Some(edge_result));
    });
}

const SWITCH_CASES_WITH_SUBJECT: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Switch v0 cases=[1, 2] -> case b1(| 0), case b2(| 0), otherwise b3()
  b1(v1):
    Return v1
  b2(v2):
    Return v2
  b3():
    Return
}
";

#[test]
fn switch_case_passes_subject() {
    assert_graph(
        &[TypeTable::ANYTHING],
        SWITCH_CASES_WITH_SUBJECT,
        |builder| {
            let subject = builder.parameter(0);
            let cases: [BlockId; 2] = create_blocks(builder);
            let otherwise = builder.create_block(None);
            let edge_results = cases.map(|case| builder.add_edge_result(case));
            let edges = cases.map(|case| Edge::with_proofs(case, &[0]));
            builder.switch(subject, &[1, 2], &edges, Edge::to(otherwise));
            for (case, edge_result) in cases.into_iter().zip(edge_results) {
                builder.seal(case);
                builder.switch_to(case);
                builder.return_value(Some(edge_result));
            }
            builder.seal(otherwise);
            builder.switch_to(otherwise);
            builder.return_value(None);
        },
    );
}

const EDGE_RESULTS_IN_COVERED_BLOCKS: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = TypeTest v0 testedType=string
    Branch v1 -> taken b1(| 0), notTaken b2(| 0)
  b1(v2) handler=b3(v2):
    v3 = Call v2
    Return
  b2(v4) handler=b3(v4):
    v5 = Call v4
    Return
  b3(v6) role=CatchHandler:
    v7 = CatchValue
    v8 = TypeOf v6
    Return
}
";

#[test]
fn store_of_edge_result_into_empty_covered_block_does_not_split() {
    let parameters = [TypeTable::ANYTHING];
    assert_graph(&parameters, EDGE_RESULTS_IN_COVERED_BLOCKS, |builder| {
        let value = builder.parameter(0);
        let variable = builder.create_variable(None);
        builder.write_variable(variable, value);
        let handler = create_catch_handler(builder);
        let branch = branch_on_string_test(builder, value, Some(handler));
        for (block, edge_result) in branch.blocks.into_iter().zip(branch.edge_results) {
            builder.switch_to(block);
            builder.write_variable(variable, edge_result);
            assert_eq!(builder.current_block(), block);
            emit_call(builder, edge_result);
            builder.return_value(None);
        }
        builder.seal(handler.block());
        builder.switch_to(handler.block());
        builder.catch_value();
        emit_read_marker(builder, variable);
        builder.return_value(None);
    });
}

#[cfg(debug_assertions)]
mod debug_assertions {
    use super::*;

    #[test]
    #[should_panic(expected = "a proof fills an edge result")]
    fn more_proofs_than_edge_results_panics() {
        build_function(&[], |builder| {
            let block = builder.create_block(None);
            builder.jump(Edge::with_proofs(block, &[0]));
        });
    }

    #[test]
    #[should_panic(expected = "an edge fills every explicit parameter of its target")]
    fn edge_without_edge_result_value_panics() {
        build_function(&[], |builder| {
            let block = builder.create_block(None);
            builder.add_edge_result(block);
            builder.jump(Edge::to(block));
        });
    }

    #[test]
    #[should_panic(expected = "precede edge results")]
    fn explicit_parameter_after_edge_result_panics() {
        build_function(&[], |builder| {
            let block = builder.create_block(None);
            builder.add_edge_result(block);
            builder.add_parameter(block, None);
        });
    }
}
