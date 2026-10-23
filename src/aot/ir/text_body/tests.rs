use super::*;
use crate::ir::builder::{Edge, FunctionBuilder};
use crate::ir::ids::{TypeId, VariableId};
use crate::ir::print::Printer;
use crate::ir::program::Program;
use crate::ir::testing::build_function;
use crate::ir::text::ParseError;
use crate::ir::types::TypeTable;

fn parse_alone(text: &str) -> (Program, Body) {
    let mut parser = Parser::new(text.as_bytes());
    let body = match parse_body(&mut parser) {
        Ok(body) => body,
        Err(error) => panic!(
            "{}:{}: expected {} in\n{text}",
            error.line, error.column, error.expected
        ),
    };
    assert!(parser.at(TokenKind::EndOfLine), "\n{text}");
    assert_eq!(body.check_stream(), Ok(()), "\n{text}");
    (parser.program, body)
}

fn print_alone(program: &Program, body: &Body) -> String {
    let mut printed = String::new();
    Printer::new(program.name_tables(), &mut printed).print_body(body);
    printed
}

#[track_caller]
fn assert_survives(text: &str) {
    let (program, body) = parse_alone(text);
    let printed = print_alone(&program, &body);
    assert_eq!(printed, text, "\n{printed}");
}

#[track_caller]
fn assert_error(text: &str, line: u32, column: u32, expected: &'static str) {
    let error = ParseError {
        line,
        column,
        expected,
    };
    let parsed = parse_body(&mut Parser::new(text.as_bytes()));
    assert_eq!(parsed.err(), Some(error), "\n{text}");
}

#[track_caller]
fn assert_blocks_error(lines: &str, line: u32, column: u32, expected: &'static str) {
    assert_error(&format!("{{\n{lines}}}\n"), line, column, expected);
}

#[track_caller]
fn assert_head_error(before: &str, from: &str, expected: &'static str) {
    let lines = format!("{before}{from}\n    Return\n");
    assert_blocks_error(&lines, 2, before.len() as u32 + 1, expected);
}

#[track_caller]
fn assert_line_error(before: &str, from: &str, expected: &'static str) {
    let lines = format!("  b0(v0):\n{before}{from}\n    Return\n");
    assert_blocks_error(&lines, 3, before.len() as u32 + 1, expected);
}

const EXAMPLE: &str = r#" {
  b0(v0: object, v1: Array<number>):
    v2 = TypeTest v1 testedType=undefined|null @12
    Branch v2 -> taken b1(), notTaken b2(| 0) @12
  b1() frequency=Unlikely:
    Return
  b2(v3) handler=b3(v3):
    v4 = PropGet v3 key="length"
    PutModuleVariable v4 variable=g0
    Return v4
  b3(v6) role=CatchHandler:
    v7 = CatchValue
    Throw v7
}"#;

#[test]
fn printed_body_parses_back() {
    assert_survives(EXAMPLE);
}

#[test]
fn switch_with_three_cases_parses_back() {
    assert_survives(
        " {
  b0(v0):
    Switch v0 cases=[-1, 0, 1099511627776] -> case b1(), case b2(), case b1(), otherwise b3()
  b1():
    Switch v0 -> otherwise b3()
  b2():
    Return
  b3():
    Unreachable
}",
    );
}

#[test]
fn value_without_result_parses_back() {
    assert_survives(
        " {
  b0():
    v0 = Undefined
    LoopHint
    v2 = TypeOf v0
    LoopHint @3
    Return v2
}",
    );
}

#[test]
fn block_with_every_attribute_parses_back() {
    assert_survives(
        " {
  b0(v0):
    Jump -> next b1(v0)
  b1(v1) role=IterationCleanup subject=v0 frequency=Unlikely handler=b2(v1, v0):
    Rethrow v1
  b2(v2, v3) role=DisposalCleanup subject=v3:
    Return
}",
    );
}

#[test]
fn proofs_parse_back_with_and_without_arguments() {
    assert_survives(
        " {
  b0(v0):
    v1 = TypeOf v0
    Branch v1 -> taken b1(v0 | 0), notTaken b2(| 0, 1)
  b1(v2, v3) handler=b2(v2 | 4):
    Jump -> next b2(v2, v3)
  b2(v4, v5):
    Return
}",
    );
}

#[test]
fn operand_may_name_any_value() {
    assert_survives(
        " {
  b0():
    v0 = TypeOf v9
    Jump -> next b7(v3)
}",
    );
}

fn fill_function(builder: &mut FunctionBuilder) {
    let subject = builder.parameter(0);
    let cleanup = builder.create_handler(BlockRole::CleanupHandler, Some(subject), None);
    let covered = builder.create_block(Some(cleanup));
    let [case, otherwise] = [(); 2].map(|()| builder.create_block(None));
    let narrowed = builder.add_edge_result(case);
    let passed = builder.add_parameter(otherwise, Some(TypeTable::NUMBER));
    builder.set_frequency(otherwise, BlockFrequency::Unlikely);
    builder.set_position(Some(4));
    builder.jump(Edge::to(covered));
    builder.switch_to(covered);
    builder.put_module_variable(VariableId::new(2), subject);
    let constant = builder.integer(-7);
    let cases = [Edge::with_proofs(case, &[0])];
    builder.switch(
        subject,
        &[5],
        &cases,
        Edge::with_arguments(otherwise, &[constant]),
    );
    builder.set_position(None);
    for block in [covered, case, otherwise, cleanup.block()] {
        builder.seal(block);
    }
    for (block, result) in [(case, narrowed), (otherwise, passed)] {
        builder.switch_to(block);
        builder.return_value(Some(result));
    }
    builder.switch_to(cleanup.block());
    let exception = builder.catch_exception();
    builder.rethrow(exception);
}

#[test]
fn parsed_words_equal_built_words() {
    let built = build_function(&[TypeTable::ANYTHING], fill_function).body;
    let printed = print_alone(&Program::new(), &built);
    let (_, parsed) = parse_alone(&printed);
    assert_eq!(parsed, built, "\n{printed}");
}

#[test]
fn parsed_body_counts_blocks_and_values() {
    let (_, body) = parse_alone(EXAMPLE);
    assert_eq!((body.block_count, body.value_count), (4, 8));
    let first_values: Vec<ValueId> = body.blocks().map(|block| block.first_value()).collect();
    assert_eq!(first_values, [2, 3, 4, 7].map(ValueId::new));
}

#[test]
fn parsed_heads_match_lines() {
    let (program, body) = parse_alone(EXAMPLE);
    let blocks: Vec<_> = body.blocks().collect();
    let [entry, nullish, present, landing] = blocks[..] else {
        panic!("{} blocks", blocks.len());
    };
    let parameter_types: Vec<Option<TypeId>> = entry.parameter_types().collect();
    let numbers = TypeId::new(TypeTable::WELL_KNOWN_COUNT);
    assert_eq!(parameter_types, [Some(TypeTable::OBJECT), Some(numbers)]);
    assert_eq!(program.types.len(), TypeTable::WELL_KNOWN_COUNT + 1);
    assert_eq!(entry.terminator().position, Some(12));
    assert_eq!(nullish.frequency, BlockFrequency::Unlikely);
    assert_eq!(landing.role, BlockRole::CatchHandler);
    assert_eq!(present.parameter_types().collect::<Vec<_>>(), [None]);

    let handler = present.handler().expect("the block names a handler");
    assert_eq!(handler.block, landing.id);
    assert_eq!(handler.arguments().collect::<Vec<_>>(), [ValueId::new(3)]);
    let values: Vec<(ValueId, Opcode)> = present
        .values()
        .map(|value| (value.id, value.opcode))
        .collect();
    let expected = [
        (ValueId::new(4), Opcode::PropGet),
        (ValueId::new(5), Opcode::PutModuleVariable),
    ];
    assert_eq!(values, expected);
}

#[test]
fn attributes_parse_in_any_order() {
    let parse_with = |attributes: &str| {
        let text = format!("{{\n  b0(v0) {attributes}:\n    Return\n}}");
        parse_alone(&text).1
    };
    let in_order = "role=CleanupHandler subject=v0 frequency=Unlikely handler=b0(v0)";
    let reordered = "handler=b0(v0) frequency=Unlikely subject=v0 role=CleanupHandler";
    assert_eq!(parse_with(reordered), parse_with(in_order));
}

#[test]
fn zero_attributes_may_be_spelled() {
    let (_, spelled) = parse_alone("{\n  b0() role=Ordinary frequency=Normal:\n    Return\n}");
    let (_, omitted) = parse_alone("{\n  b0():\n    Return\n}");
    assert_eq!(spelled, omitted);
}

#[test]
fn text_without_brace_is_a_declaration() {
    for text in ["", "\n", "entry {"] {
        let mut parser = Parser::new(text.as_bytes());
        let first_token = parser.token.kind;
        assert_eq!(parse_body(&mut parser), Ok(Body::default()), "{text}");
        assert_eq!(parser.token.kind, first_token, "{text}");
    }
}

#[test]
fn line_end_after_closing_brace_is_left_to_caller() {
    let mut parser = Parser::new(b"{\n  b0():\n    Return\n} x");
    assert!(parse_body(&mut parser).is_ok());
    assert_eq!(parser.word_text(), Some("x"));
}

#[test]
fn target_words_are_head_arguments_and_proofs() {
    let mut parser = Parser::new(b"b2(v1, v3 | 0, 4)");
    let mut words = vec![9];
    assert_eq!(parse_target(&mut parser, &mut words), Ok(()));
    assert!(parser.at(TokenKind::EndOfLine));

    let mut expected = vec![9];
    let head = TargetHead {
        block: BlockId::new(2),
        argument_count: 2,
        proof_count: 2,
    };
    head.append_to(&mut expected);
    expected.extend([1, 3, 0, 4]);
    assert_eq!(words, expected);
}

#[test]
fn position_is_optional() {
    assert_eq!(parse_position(&mut Parser::new(b"@12")), Ok(Some(12)));
    assert_eq!(parse_position(&mut Parser::new(b"@0")), Ok(Some(0)));
    let last_position = ABSENT_WORD - 1;
    assert_eq!(
        parse_position(&mut Parser::new(b"@4294967294")),
        Ok(Some(last_position))
    );
    assert_eq!(parse_position(&mut Parser::new(b"")), Ok(None));
    let mut parser = Parser::new(b"12");
    assert_eq!(parse_position(&mut parser), Ok(None));
    assert!(parser.at(TokenKind::Integer));
}

#[test]
fn body_without_block() {
    assert_error("{\n}\n", 2, 1, "a block");
    assert_error("{}\n", 1, 2, "end of line");
    assert_error("{ b0():\n", 1, 3, "end of line");
}

#[test]
fn body_without_closing_brace() {
    assert_error("{\n  b0():\n    Return\n", 4, 1, "the next block id");
    assert_error("{\n  b0():\n", 3, 1, "an operation or a terminator");
    assert_error("{\n", 2, 1, "the next block id");
    assert_error("{", 1, 2, "the next block id");
}

#[test]
fn block_ids_ascend() {
    let expected = "the next block id";
    assert_blocks_error("  b0():\n    Return\n  b2():\n    Return\n", 4, 3, expected);
    assert_blocks_error("  b0():\n    Return\n  b0():\n    Return\n", 4, 3, expected);
    assert_blocks_error("  v0():\n    Return\n", 2, 3, expected);
    assert_blocks_error("  Return\n", 2, 3, expected);
}

#[test]
fn value_ids_ascend() {
    let expected = "the next value id";
    assert_head_error("  b0(v0, ", "v2):", expected);
    assert_head_error("  b0(v0, ", "v0):", expected);
    assert_head_error("  b0(", "b1):", expected);
    assert_head_error("  b0(v0,", "):", expected);
    assert_blocks_error(
        "  b0(v0):\n    Return\n  b1(v0):\n    Return\n",
        4,
        6,
        expected,
    );
    assert_line_error("    ", "v0 = Undefined", expected);
    assert_line_error("    ", "v2 = Undefined", expected);
}

#[test]
fn value_without_result_takes_next_id() {
    let lines = "  b0(v0):\n    LoopHint\n    v1 = Undefined\n    Return\n";
    assert_blocks_error(lines, 4, 5, "the next value id");
    let lines = "  b0(v0):\n    LoopHint\n    Return\n  b1(v1):\n    Return\n";
    assert_blocks_error(lines, 5, 6, "the next value id");
}

#[test]
fn unknown_operation() {
    let expected = "an operation or a terminator";
    assert_line_error("    ", "Frobnicate", expected);
    assert_line_error("    ", "return", expected);
    assert_line_error("    ", "5", expected);
    assert_line_error("    ", "v1 Undefined", expected);
    assert_line_error("    v1 = ", "", expected);
    assert_line_error("    v1 = ", "v1", expected);
}

#[test]
fn missing_terminator() {
    let expected = "an operation or a terminator";
    assert_blocks_error("  b0():\n  b1():\n    Return\n", 3, 3, expected);
    assert_blocks_error("  b0():\n    v0 = Undefined\n", 4, 1, expected);
}

#[test]
fn wrong_target_name() {
    let lines = [
        "    Branch v0 -> notTaken b0(), taken b0()",
        "    Branch v0 -> taken b0(), taken b0()",
        "    Branch v0 -> taken b0(), notTaken b0(), notTaken b0()",
        "    Jump -> next b0(), next b0()",
        "    Return -> next b0()",
        "    Switch v0 cases=[1] -> otherwise b0(), case b0()",
        "    Switch v0 -> case b0()",
    ];
    for line in lines {
        assert_line_error(line, "", "the name of the target");
    }
    assert_line_error("    Jump -> taken b0() ", "@5", "the name of the target");
}

#[test]
fn block_head_errors_name_offending_token() {
    assert_head_error("  b0", ":", "(");
    assert_head_error("  b0(v0 ", "v1):", ", or )");
    assert_head_error("  b0(v0: ", "):", "a type");
    assert_head_error("  b0(v0:", "", "a type");
    assert_head_error("  b0(v0", "", ", or )");
    assert_head_error("  b0()", "", ":");
    assert_head_error("  b0() ", "cold:", ":");
    assert_head_error("  b0(): ", "Return", "end of line");
}

#[test]
fn attribute_errors_name_offending_token() {
    assert_head_error(
        "  b0() color=",
        "Red:",
        "role, subject, frequency or handler",
    );
    assert_head_error("  b0() role=", "Red:", "a block role");
    assert_head_error("  b0() role=", "catchHandler:", "a block role");
    assert_head_error("  b0() frequency=", "Often:", "a block frequency");
    assert_head_error("  b0() subject=", "b1:", "a value id");
    assert_head_error("  b0() handler=", "v1():", "a block id");
    assert_head_error("  b0() handler=b0", ":", "(");
}

#[test]
fn attribute_occurs_at_most_once() {
    let expected = "each block attribute at most once";
    assert_head_error("  b0() subject=v0 subject=v1", ":", expected);
    assert_head_error("  b0() frequency=Unlikely frequency=Normal", ":", expected);
    assert_head_error(
        "  b0() handler=b0() role=CatchHandler handler=b0()",
        ":",
        expected,
    );
}

#[test]
fn target_errors_name_offending_token() {
    assert_line_error("    Jump ->", "", "the name of a target");
    assert_line_error("    Jump -> next b0(),", "", "the name of a target");
    assert_line_error("    Jump -> next ", "v1()", "a block id");
    assert_line_error("    Jump -> b0", "()", "a block id");
    assert_line_error("    Jump -> next b0", "", "(");
    assert_line_error("    Jump -> next b0(", "b1)", "a value id");
    assert_line_error("    Jump -> next b0(v0,", ")", "a value id");
    assert_line_error("    Jump -> next b0(v0", "", ")");
    assert_line_error("    Jump -> next b0(v0 ", "v0)", ")");
    assert_line_error("    Jump -> next b0(| 0 ", "| 1)", ")");
}

#[test]
fn proofs_are_numbers() {
    let expected = "an unsigned 32-bit integer";
    assert_line_error("    Jump -> next b0(| ", "v0)", expected);
    assert_line_error("    Jump -> next b0(|", ")", expected);
    assert_line_error("    Jump -> next b0(| 0,", ")", expected);
    assert_line_error("    Jump -> next b0(| ", "-1)", expected);
    assert_line_error("    Jump -> next b0(| ", "4294967296)", expected);
}

#[test]
fn position_errors_name_offending_token() {
    assert_line_error("    Return @", "", "an unsigned 32-bit integer");
    assert_line_error("    Return @", "-1", "an unsigned 32-bit integer");
    assert_line_error("    v1 = Undefined @", "x", "an unsigned 32-bit integer");
    assert_line_error("    Return @", "4294967295", "a position below 4294967295");
    assert_line_error(
        "    v1 = Undefined @",
        "4294967295",
        "a position below 4294967295",
    );
}

#[test]
fn line_ends_after_position() {
    assert_line_error("    v1 = Undefined @5 ", "@6", "end of line");
    assert_line_error("    v1 = Undefined ", "Return", "end of line");
    assert_line_error("    Return v0 ", "v0", "end of line");
    assert_line_error("    Return @5 ", "-> next b0()", "end of line");
}
