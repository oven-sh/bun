use super::*;
use crate::ir::builder::Edge;
use crate::ir::generated::TerminatorKind;
use crate::ir::ids::{ABSENT_WORD, BlockId, VariableId};
use crate::ir::program::Program;
use crate::ir::testing::{build_function, create_blocks, print_with};
use crate::ir::tests::assert_graph;
use crate::ir::types::TypeTable;

fn body_text(body: &Body) -> String {
    print_with(&Program::new(), |printer| printer.print_body(body))
}

fn build_returning_body() -> Body {
    let function = build_function(&[TypeTable::NUMBER], |builder| {
        let value = builder.parameter(0);
        builder.return_value(Some(value));
    });
    function.body
}

const VALUES_WITHOUT_RESULT: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    PutModuleVariable v0 variable=g0
    LoopHint
    v3 = TypeOf v0
    PutModuleVariable v3 variable=g1
    Return v3
}
";

#[test]
fn value_without_result_takes_an_id() {
    assert_graph(&[TypeTable::ANYTHING], VALUES_WITHOUT_RESULT, |builder| {
        let value = builder.parameter(0);
        builder.put_module_variable(VariableId::new(0), value);
        builder.loop_hint();
        let name = builder.type_of(value);
        builder.put_module_variable(VariableId::new(1), name);
        builder.return_value(Some(name));
    });
}

const POSITIONS: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    v1 = Undefined
    v2 = TypeOf v0 @0
    v3 = Integer integer=5 @7
    PutModuleVariable v0 variable=g1 @7
    Branch v0 -> taken b1(), notTaken b2() @4294967294
  b1():
    Return v0 @9
  b2():
    Return
}
";

#[test]
fn positions_are_suffixes() {
    assert_graph(&[TypeTable::ANYTHING], POSITIONS, |builder| {
        let value = builder.parameter(0);
        let [taken, not_taken] = create_blocks(builder);
        builder.undefined();
        builder.set_position(Some(0));
        builder.type_of(value);
        builder.set_position(Some(7));
        builder.integer(5);
        builder.put_module_variable(VariableId::new(1), value);
        builder.set_position(Some(ABSENT_WORD - 1));
        builder.branch(value, Edge::to(taken), Edge::to(not_taken));
        builder.seal(taken);
        builder.seal(not_taken);

        builder.switch_to(taken);
        builder.set_position(Some(9));
        builder.return_value(Some(value));
        builder.switch_to(not_taken);
        builder.set_position(None);
        builder.return_value(None);
    });
}

const PARAMETER_TYPES: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Jump -> next b1(v0, v0, v0)
  b1(v1: number, v2, v3: undefined|null):
    Return
}
";

#[test]
fn declared_parameter_type_follows_a_colon() {
    assert_graph(&[TypeTable::ANYTHING], PARAMETER_TYPES, |builder| {
        let value = builder.parameter(0);
        let block = builder.create_block(None);
        for declared in [Some(TypeTable::NUMBER), None, Some(TypeTable::NULLISH)] {
            builder.add_parameter(block, declared);
        }
        builder.jump(Edge::with_arguments(block, &[value; 3]));
        builder.seal(block);
        builder.switch_to(block);
        builder.return_value(None);
    });
}

const BLOCK_ATTRIBUTES: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Jump -> next b1()
  b1() frequency=Unlikely handler=b2():
    Return
  b2() role=IterationCleanup subject=v0 frequency=Unlikely handler=b3():
    v1 = CatchException
    Rethrow v1
  b3() role=CatchHandler:
    v2 = CatchValue
    Return
}
";

#[test]
fn block_attributes_in_order() {
    assert_graph(&[TypeTable::ANYTHING], BLOCK_ATTRIBUTES, |builder| {
        let iterator = builder.parameter(0);
        let outer = builder.create_handler(BlockRole::CatchHandler, None, None);
        let role = BlockRole::IterationCleanup;
        let cleanup = builder.create_handler(role, Some(iterator), Some(outer));
        let covered = builder.create_block(Some(cleanup));
        builder.set_frequency(cleanup.block(), BlockFrequency::Unlikely);
        builder.set_frequency(covered, BlockFrequency::Unlikely);
        builder.jump(Edge::to(covered));
        for block in [covered, cleanup.block(), outer.block()] {
            builder.seal(block);
        }

        builder.switch_to(covered);
        builder.return_value(None);
        builder.switch_to(cleanup.block());
        let exception = builder.catch_exception();
        builder.rethrow(exception);
        builder.switch_to(outer.block());
        builder.catch_value();
        builder.return_value(None);
    });
}

#[test]
fn proofs_after_bar() {
    let targets: [(u32, &[u32], &[u32], &str); 6] = [
        (1, &[], &[], "b1()"),
        (1, &[2], &[], "b1(v2)"),
        (1, &[2, 3], &[], "b1(v2, v3)"),
        (2, &[], &[0], "b2(| 0)"),
        (2, &[], &[1, 0], "b2(| 1, 0)"),
        (2, &[1], &[0, 1], "b2(v1 | 0, 1)"),
    ];
    for (block, arguments, proofs, expected) in targets {
        let target = TargetView {
            block: BlockId::from_word(block),
            arguments,
            proofs,
        };
        assert_eq!(
            print_with(&Program::new(), |printer| printer.print_target(target)),
            expected
        );
    }
}

#[test]
fn position_is_printed_only_when_present() {
    assert_eq!(
        print_with(&Program::new(), |printer| printer.print_position(None)),
        ""
    );
    assert_eq!(
        print_with(&Program::new(), |printer| printer.print_position(Some(0))),
        " @0"
    );
    assert_eq!(
        print_with(&Program::new(), |printer| printer.print_position(Some(120))),
        " @120"
    );
}

const SWITCHES: &str = "\
function f0 module=m0 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
  b0(v0: anything):
    Switch v0 cases=[-1, 0, 1099511627776] -> case b1(), case b1(), case b2(| 0), otherwise b3()
  b1():
    Switch v0 -> otherwise b3()
  b2(v1):
    Return v1
  b3():
    Return
}
";

#[test]
fn switch_repeats_case() {
    assert_graph(&[TypeTable::ANYTHING], SWITCHES, |builder| {
        let subject = builder.parameter(0);
        let [shared, narrowing, otherwise] = create_blocks(builder);
        let narrowed = builder.add_edge_result(narrowing);
        let cases = [
            Edge::to(shared),
            Edge::to(shared),
            Edge::with_proofs(narrowing, &[0]),
        ];
        builder.switch(subject, &[-1, 0, 1 << 40], &cases, Edge::to(otherwise));
        builder.seal(shared);
        builder.seal(narrowing);

        builder.switch_to(shared);
        builder.switch(subject, &[], &[], Edge::to(otherwise));
        builder.seal(otherwise);
        builder.switch_to(narrowing);
        builder.return_value(Some(narrowed));
        builder.switch_to(otherwise);
        builder.return_value(None);
    });
}

const TARGETS_WITHOUT_NAME: &str = "\
function f0 module=m0 thisType={type=anything} results=[{type=anything}] {
  b0():
    Jump -> next b1(), <invalid target> b2()
  b1():
    Return -> <invalid target> b2()
  b2():
    Return
}
";

#[test]
fn undeclared_target_prints_invalid() {
    assert_graph(&[], TARGETS_WITHOUT_NAME, |builder| {
        let [first, second] = create_blocks(builder);
        let edges = [Edge::to(first), Edge::to(second)];
        builder.terminate(TerminatorKind::Jump, &[], &edges);
        builder.seal(first);
        builder.switch_to(first);
        builder.terminate(TerminatorKind::Return, &[ABSENT_WORD], &[Edge::to(second)]);
        builder.seal(second);
        builder.switch_to(second);
        builder.return_value(None);
    });
}

#[test]
fn body_is_braced_without_line_end() {
    let expected = " {\n  b0(v0: number):\n    Return v0\n}";
    assert_eq!(body_text(&build_returning_body()), expected);
}

#[test]
fn empty_body_prints_nothing() {
    assert_eq!(body_text(&Body::default()), "");
    let words_without_blocks = Body {
        code: vec![0],
        ..Body::default()
    };
    assert_eq!(body_text(&words_without_blocks), "");
}

#[test]
fn malformed_body_prints_invalid() {
    let body = build_returning_body();
    let word_count = body.code.len();

    let mut truncated = body.clone();
    truncated.code.pop();
    let expected = format!(" {{\n  <invalid body {}>\n}}", word_count - 1);
    assert_eq!(body_text(&truncated), expected);

    let expected = format!(" {{\n  <invalid body {word_count}>\n}}");
    let with_other_value_count = Body {
        value_count: body.value_count + 1,
        ..body.clone()
    };
    assert_eq!(body_text(&with_other_value_count), expected);
    let with_other_block_count = Body {
        block_count: body.block_count + 1,
        ..body
    };
    assert_eq!(body_text(&with_other_block_count), expected);
}
