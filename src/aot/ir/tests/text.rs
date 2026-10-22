use bun_core::strings::count_char;

use super::print_alone;
use crate::builtins::id::BuiltinClass;
use crate::ir::body::Body;
use crate::ir::builder::{BuilderScratch, Edge, FunctionBuilder};
use crate::ir::declared::DeclaredType;
use crate::ir::generated::{
    BlockFrequency, BlockRole, CheckFailure, Data, Entry, EvalScope, FunctionFlags, FunctionRole,
    InternalErrorKind, Layout, Module, Opcode, ProgramList, TerminatorKind, TypeSite, Variable,
    check_program,
};
use crate::ir::ids::{
    DataId, EvalScopeId, ExpectedResultId, FunctionId, Id, LayoutId, ModuleFailureId, ModuleId,
    PropertyKeyId, StringId, TypeId, TypeSiteId, VariableId,
};
use crate::ir::print::{print_function, print_program};
use crate::ir::program::Program;
use crate::ir::property_keys::PropertyKey;
use crate::ir::testing::{build_function, function_with_parameters, parse, parse_named};
use crate::ir::text::{ParseError, parse_program};
use crate::ir::types::{Type, TypeTable};

const EVERY_RECORD: &str = include_str!("every_record.ir");
const EVERY_OPERATION: &str = include_str!("every_operation.ir");
const TEXTS: [(&str, &str); 2] = [
    ("every_record.ir", EVERY_RECORD),
    ("every_operation.ir", EVERY_OPERATION),
];

fn assert_same_text(name: &str, printed: &str, expected: &str) {
    if printed == expected {
        return;
    }
    let bytes = printed.bytes().zip(expected.bytes());
    let common_length = bytes.take_while(|(printed, expected)| printed == expected).count();
    let line = 1 + count_char(&expected.as_bytes()[..common_length], b'\n');
    panic!("{name}: the printed text differs from line {line} on:\n{printed}");
}

#[test]
fn every_record_survives_parse_and_print() {
    let program = parse_named("every_record.ir", EVERY_RECORD);
    assert_same_text("every_record.ir", &print_program(&program), EVERY_RECORD);
}

#[test]
fn every_operation_survives_parse_and_print() {
    let program = parse_named("every_operation.ir", EVERY_OPERATION);
    assert_same_text("every_operation.ir", &print_program(&program), EVERY_OPERATION);
}

#[test]
fn every_operation_and_terminator_occurs() {
    let program = parse_named("every_operation.ir", EVERY_OPERATION);
    let mut has_opcode = [false; Opcode::COUNT];
    let mut has_terminator_kind = [false; TerminatorKind::COUNT];
    for block in program.functions.iter().flat_map(|function| function.body.blocks()) {
        for value in block.values() {
            has_opcode[value.opcode as usize] = true;
        }
        has_terminator_kind[block.terminator().kind as usize] = true;
    }
    let missing_opcodes: Vec<Opcode> = Opcode::ALL
        .into_iter()
        .filter(|&opcode| !has_opcode[opcode as usize])
        .collect();
    assert!(missing_opcodes.is_empty(), "{missing_opcodes:?}");
    let missing_kinds: Vec<TerminatorKind> = TerminatorKind::ALL
        .into_iter()
        .filter(|&kind| !has_terminator_kind[kind as usize])
        .collect();
    assert!(missing_kinds.is_empty(), "{missing_kinds:?}");
}

#[test]
fn intrinsic_operations_are_in_library_functions() {
    let program = parse_named("every_operation.ir", EVERY_OPERATION);
    for (index, function) in program.functions.iter().enumerate() {
        let mut values = function.body.blocks().flat_map(|block| block.values());
        let has_intrinsic = values.any(|value| value.opcode.is_intrinsic());
        assert_eq!(has_intrinsic, function.role == FunctionRole::Library, "f{index}");
    }
}

#[test]
fn every_keyword_occurs() {
    let program = parse_named("every_record.ir", EVERY_RECORD);
    let record_counts = [
        (ProgramList::TypeSites, program.type_sites.len()),
        (ProgramList::ExpectedResults, program.expected_results.len()),
        (ProgramList::Layouts, program.layouts.len()),
        (ProgramList::Variables, program.variables.len()),
        (ProgramList::Modules, program.modules.len()),
        (ProgramList::ModuleFailures, program.module_failures.len()),
        (ProgramList::EvalScopes, program.eval_scopes.len()),
        (ProgramList::Functions, program.functions.len()),
        (ProgramList::Data, program.data.len()),
        (ProgramList::Entries, program.entries.len()),
        (ProgramList::RuntimeFunctions, program.runtime_functions.len()),
        (ProgramList::WebAssemblyModules, program.web_assembly_modules.len()),
    ];
    let lists_with_keyword: Vec<ProgramList> = ProgramList::ALL
        .into_iter()
        .filter(|list| list.keyword().is_some())
        .collect();
    assert_eq!(lists_with_keyword, record_counts.map(|(list, _)| list));
    for (list, count) in record_counts {
        assert!(count > 0, "{}", list.name());
    }
}

#[test]
fn every_body_passes_check_stream() {
    for (name, text) in TEXTS {
        let program = parse_named(name, text);
        for (index, function) in program.functions.iter().enumerate() {
            assert_eq!(function.body.check_stream(), Ok(()), "{name}: f{index}");
        }
    }
}

#[test]
fn every_text_passes_structural_checks() {
    for (name, text) in TEXTS {
        assert_eq!(check_program(&parse_named(name, text)), Ok(()), "{name}");
    }
}

fn failure(kind: InternalErrorKind, list: ProgramList, record: u32) -> Result<(), CheckFailure> {
    Err(CheckFailure { kind, list, record })
}

const FUNCTION_READING_VARIABLE: &str = "\
module m0 path=\"/a\" displayPath=\"/a\"
function f0 module=m0 thisType={type=anything} {
  b0():
    v0 = GetModuleVariable variable=g0
    Return
}
";

#[test]
fn structural_checks_reject_ids_out_of_range() {
    let out_of_range = InternalErrorKind::IdOutOfRange;
    let entry_of_missing_module = parse("entry module=m0\n");
    let in_entry = failure(out_of_range, ProgramList::Entries, 0);
    assert_eq!(check_program(&entry_of_missing_module), in_entry);

    let second_layout = parse("layout L0\nlayout L1 base=L2\n");
    let in_layout = failure(out_of_range, ProgramList::Layouts, 1);
    assert_eq!(check_program(&second_layout), in_layout);

    let body_without_variable = parse(FUNCTION_READING_VARIABLE);
    let in_function = failure(out_of_range, ProgramList::Functions, 0);
    assert_eq!(check_program(&body_without_variable), in_function);
    let variable = "variable g0 module=m0 declared={type=anything}\n";
    let body_with_variable = parse(&format!("{variable}{FUNCTION_READING_VARIABLE}"));
    assert_eq!(check_program(&body_with_variable), Ok(()));
}

#[test]
fn structural_checks_reject_unsorted_lists() {
    let unsorted = InternalErrorKind::UnsortedList;
    let ascending = parse("layout L0\nlayout L1\nlayout L2 supertypes=[L0, L1]\n");
    assert_eq!(check_program(&ascending), Ok(()));
    let descending = parse("layout L0\nlayout L1\nlayout L2 supertypes=[L1, L0]\n");
    assert_eq!(check_program(&descending), failure(unsorted, ProgramList::Layouts, 2));

    let function = "module m0 path=\"/a\" displayPath=\"/a\"\nfunction f0 module=m0\n";
    let first = "runtimefunction id=1 function=f0\n";
    let second = "runtimefunction id=4 function=f0\n";
    let ascending = parse(&format!("{function}{first}{second}"));
    assert_eq!(check_program(&ascending), Ok(()));
    let descending = parse(&format!("{function}{second}{first}"));
    let in_second_entry = failure(unsorted, ProgramList::RuntimeFunctions, 1);
    assert_eq!(check_program(&descending), in_second_entry);
}

#[test]
fn zero_fields_are_omitted() {
    let mut program = Program::new();
    program.layouts.push(Layout::default());
    program.eval_scopes.push(EvalScope::default());
    program.data.push(Data::default());
    let printed = print_program(&program);
    assert_eq!(printed, "layout L0\nevalscope e0\ndata d0\n");

    let parsed = parse(&printed);
    assert_eq!(parsed.layouts, program.layouts);
    assert_eq!(parsed.eval_scopes, program.eval_scopes);
    assert_eq!(parsed.data, program.data);
}

#[test]
fn required_ids_print_when_zero() {
    let mut program = Program::new();
    program.type_sites.push(TypeSite::default());
    program.variables.push(Variable::default());
    program.entries.push(Entry::default());
    let printed = print_program(&program);
    let expected = "\
typesite w0 module=m0
variable g0 module=m0 declared={type=never}
entry module=m0
";
    assert_eq!(printed, expected);

    let parsed = parse(&printed);
    assert_eq!(parsed.type_sites, program.type_sites);
    assert_eq!(parsed.variables, program.variables);
    assert_eq!(parsed.entries, program.entries);
}

#[test]
fn omitted_fields_parse_as_zero() {
    let program = parse("typesite w0\nvariable g0\nentry\n");
    assert_eq!(program.type_sites, [TypeSite::default()]);
    assert_eq!(program.variables, [Variable::default()]);
    assert_eq!(program.entries, [Entry::default()]);
}

#[test]
fn empty_program_prints_nothing() {
    assert_eq!(print_program(&Program::new()), "");
    let program = parse("");
    assert!(program.strings.is_empty());
    assert_eq!(program.types.len(), TypeTable::WELL_KNOWN_COUNT);
}

#[test]
fn prefixes_agree_with_schema() {
    let prefixes = [
        (ProgramList::TypeSites, TypeSiteId::PREFIX),
        (ProgramList::ExpectedResults, ExpectedResultId::PREFIX),
        (ProgramList::Layouts, LayoutId::PREFIX),
        (ProgramList::Variables, VariableId::PREFIX),
        (ProgramList::Modules, ModuleId::PREFIX),
        (ProgramList::ModuleFailures, ModuleFailureId::PREFIX),
        (ProgramList::EvalScopes, EvalScopeId::PREFIX),
        (ProgramList::Functions, FunctionId::PREFIX),
        (ProgramList::Data, DataId::PREFIX),
    ];
    for list in ProgramList::ALL {
        let entry = prefixes.iter().find(|(prefixed, _)| *prefixed == list);
        assert_eq!(list.prefix(), entry.map(|&(_, prefix)| prefix), "{}", list.name());
    }
}

const BUILT_FUNCTION: &str = r#"function f0 name="sum" module=m0 thisType={type=anything} parameters=[{type=Array<number>}] results=[{type=anything}] relations={subjects=[{fate=[HasMembersRead]}, {kind=Constant index=4294967295 fate=[IsReturned] results=1}, {kind=ReadFrom index=3 key="length" fate=[IsReturned, IsStoredInVariable] results=1}] resultsFullyListed=1} {
  b0(v0: Array<number>):
    v1 = TypeTest v0 testedType=undefined|null @12
    Branch v1 -> taken b1(), notTaken b2(| 0) @12
  b1() frequency=Unlikely:
    Return
  b2(v2) handler=b3():
    v3 = PropGet v2 key="length"
    PutModuleVariable v3 variable=g0
    Return v3
  b3() role=CatchHandler:
    v5 = CatchValue
    Throw v5
}
"#;

const LINES_BEFORE_BUILT_FUNCTION: &str = r#"variable g0 module=m0 declared={type=anything}
module m0 path="/main.js" displayPath="/main.js" body=f0
"#;

fn fill_built_function(builder: &mut FunctionBuilder, length: PropertyKeyId) {
    let array = builder.parameter(0);
    builder.set_position(Some(12));
    let test = builder.type_test(array, TypeTable::NULLISH);
    let handler = builder.create_handler(BlockRole::CatchHandler, None, None);
    let nullish = builder.create_block(None);
    let present = builder.create_block(Some(handler));
    let narrowed = builder.add_edge_result(present);
    builder.set_frequency(nullish, BlockFrequency::Unlikely);
    builder.branch(test, Edge::to(nullish), Edge::with_proofs(present, &[0]));
    builder.set_position(None);
    builder.seal(nullish);
    builder.seal(present);
    builder.seal(handler.block());

    builder.switch_to(nullish);
    builder.return_value(None);
    builder.switch_to(present);
    let read = builder.prop_get(narrowed, length, false, false);
    builder.put_module_variable(VariableId::new(0), read);
    builder.return_value(Some(read));
    builder.switch_to(handler.block());
    let caught = builder.catch_value();
    builder.throw(caught);
}

fn build_program() -> Program {
    let mut program = Program::new();
    let path = program.strings.intern(b"/main.js");
    let name = program.strings.intern(b"sum");
    let length = program.strings.intern(b"length");
    let length = program.property_keys.intern(PropertyKey::from_text(length));
    let numbers = Type::class(BuiltinClass::Array, &[TypeTable::NUMBER]);
    let numbers = program.types.intern(numbers);

    let mut function = function_with_parameters(FunctionFlags::default(), &[numbers]);
    function.name = Some(name);
    let mut builder = FunctionBuilder::new(function, BuilderScratch::default());
    fill_built_function(&mut builder, length);
    let (function, _) = builder.finish();

    program.functions.push(function);
    program.variables.push(Variable {
        declared: DeclaredType::untyped(),
        ..Variable::default()
    });
    program.modules.push(Module {
        path,
        display_path: path,
        body: Some(FunctionId::new(0)),
        ..Module::default()
    });
    program.entries.push(Entry::default());
    program
}

#[test]
fn built_program_survives() {
    let program = build_program();
    let printed = print_program(&program);
    let expected = format!("{LINES_BEFORE_BUILT_FUNCTION}{BUILT_FUNCTION}entry module=m0\n");
    assert_same_text("the built program", &printed, &expected);

    let parsed = parse(&printed);
    assert_same_text("the parsed program", &print_program(&parsed), &printed);
    assert_eq!(parsed.functions, program.functions);
    assert_eq!(parsed.modules, program.modules);
    assert_eq!(check_program(&parsed), Ok(()));
}

#[test]
fn print_function_prints_one_line_and_body() {
    let program = build_program();
    let mut text = String::new();
    print_function(program.name_tables(), FunctionId::new(0), &program.functions[0], &mut text);
    assert_same_text("the built function", &text, BUILT_FUNCTION);
}

#[test]
fn function_without_body_prints_one_line() {
    let declaration = function_with_parameters(FunctionFlags::IS_ASYNC, &[TypeTable::STRING]);
    let mut text = String::from("entry module=m0\n");
    let names = Program::new();
    print_function(names.name_tables(), FunctionId::new(7), &declaration, &mut text);
    let expected = "\
entry module=m0
function f7 module=m0 flags=[IsAsync] thisType={type=anything} parameters=[{type=string}] results=[{type=anything}]
";
    assert_eq!(text, expected);
}

#[test]
fn malformed_body_prints_word_count() {
    let mut function = function_with_parameters(FunctionFlags::default(), &[]);
    function.body = Body {
        code: vec![0, 0, 0],
        block_count: 1,
        value_count: 0,
    };
    let expected = "\
function f0 module=m0 thisType={type=anything} results=[{type=anything}] {
  <invalid body 3>
}
";
    assert_eq!(print_alone(&function), expected);
}

#[test]
fn out_of_range_ids_print_as_invalid() {
    let function = build_function(&[], |builder| {
        builder.string(StringId::new(5));
        let value = builder.undefined();
        builder.prop_get(value, PropertyKeyId::new(7), false, false);
        builder.type_test(value, TypeId::new(99));
        builder.return_value(None);
    });
    let expected = "\
function f0 module=m0 thisType={type=anything} results=[{type=anything}] {
  b0():
    v0 = String string=<invalid string 5>
    v1 = Undefined
    v2 = PropGet v1 key=<invalid key 7>
    v3 = TypeTest v1 testedType=<invalid type 99>
    Return
}
";
    assert_eq!(print_alone(&function), expected);
}

#[test]
fn lines_fill_their_lists() {
    let program = parse("layout L0\nevalscope e0\nlayout L1 position=4\nentry module=m3\n");
    assert_eq!(program.layouts.len(), 2);
    assert_eq!(program.layouts[1].position, 4);
    assert_eq!(program.eval_scopes.len(), 1);
    assert_eq!(program.entries[0].module, ModuleId::new(3));
    assert!(program.modules.is_empty());
}

#[test]
fn comments_and_empty_lines_are_skipped() {
    let program = parse("# first\n\nlayout L0 # trailing\n   \n# last");
    assert_eq!(program.layouts, [Layout::default()]);
}

#[test]
fn record_fields_are_accepted_in_any_order() {
    let in_order = parse("typesite w0 module=m1 position=2\n");
    let reordered = parse("typesite w0 position=2 module=m1\n");
    assert_eq!(reordered.type_sites, in_order.type_sites);
}

#[test]
fn strings_keys_and_types_are_interned_on_first_use() {
    let text = "layout L0 name=\"b\" fields=[{key=\"a\" declared={type=\"b\"|L0}}, {key=\"b\" declared={type=L0|\"b\"}}]\n";
    let program = parse(text);
    assert_eq!(program.strings.find(b"b"), Some(StringId::new(0)));
    assert_eq!(program.strings.find(b"a"), Some(StringId::new(1)));
    assert_eq!(program.strings.len(), 2);
    assert_eq!(program.property_keys.len(), 2);
    assert_eq!(program.types.len(), TypeTable::WELL_KNOWN_COUNT + 1);
    let fields = &program.layouts[0].fields;
    assert_eq!(fields[0].declared, fields[1].declared);
}

fn parse_error(text: &str) -> ParseError {
    match parse_program(text) {
        Ok(_) => panic!("the text parses:\n{text}"),
        Err(error) => error,
    }
}

fn assert_parse_error(text: &str, line: u32, column: u32, expected: &'static str) {
    let error = ParseError {
        line,
        column,
        expected,
    };
    assert_eq!(parse_error(text), error, "\n{text}");
}

#[test]
fn line_errors_name_offending_token() {
    assert_parse_error("layout L0\nshape L1\n", 2, 1, "a record keyword");
    assert_parse_error("layout L1\n", 1, 8, "the next id of the list");
    assert_parse_error("layout f0\n", 1, 8, "the next id of the list");
    assert_parse_error("layout L0\nlayout L0\n", 2, 8, "the next id of the list");
    assert_parse_error("layout L0 shape=1\n", 1, 17, "a field of Layout");
    assert_parse_error("layout L0 L1\n", 1, 11, "a field or the end of the line");
}

fn assert_body_error(lines: &str, line: u32, column: u32, expected: &'static str) {
    assert_parse_error(&format!("function f0 {{\n{lines}}}\n"), line, column, expected);
}

#[test]
fn block_errors_name_offending_token() {
    assert_body_error("", 2, 1, "a block");
    assert_body_error("  b1():\n    Return\n", 2, 3, "the next block id");
    assert_body_error("  b0():\n", 3, 1, "an operation or a terminator");
    assert_body_error("  b0(v1):\n    Return\n", 2, 6, "the next value id");
    assert_body_error(
        "  b0() role=CatchHandler role=CatchHandler:\n    Return\n",
        2,
        43,
        "each block attribute at most once",
    );
    assert_body_error(
        "  b0():\n    Jump -> taken b1()\n  b1():\n    Return\n",
        3,
        23,
        "the name of the target",
    );
}

#[test]
fn value_errors_name_offending_token() {
    let assert_value_error = |value: &str, column: u32, expected: &'static str| {
        assert_body_error(&format!("  b0(v0):\n    {value}\n    Return\n"), 3, column, expected);
    };
    assert_value_error("v2 = Undefined", 5, "the next value id");
    assert_value_error("Undefined", 5, "a value id before an operation with a result");
    assert_value_error("v1 = LoopHint", 10, "an operation with a result");
    assert_value_error("v1 = Return", 10, "an operation with a result");
    assert_value_error("v1 = Frobnicate", 10, "an operation or a terminator");
    assert_value_error("v1 = Add", 13, "an operand");
    assert_value_error("v1 = TypeOf v0, v0", 23, "no more operands than the entry takes");
    assert_value_error(
        "v1 = Integer number=1",
        25,
        "a field of the entry, in the order of its declaration",
    );
    assert_value_error("v1 = Undefined [isFreeName]", 20, "no flags: the entry declares none");
}
