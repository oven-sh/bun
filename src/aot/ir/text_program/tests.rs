use super::*;
use crate::ir::program::Program;
use crate::ir::text::ParseError;
use crate::ir::types::TypeTable;

const NEXT_ID: &str = "the next id of the list";
const LINE_END: &str = "a field or the end of the line";

fn parse(text: &str) -> Parsed<Program> {
    let mut parser = Parser::new(text.as_bytes());
    parse_lines(&mut parser)?;
    assert!(parser.at(TokenKind::EndOfFile), "\n{text}");
    Ok(parser.program)
}

fn parse_valid(text: &str) -> Program {
    match parse(text) {
        Ok(program) => program,
        Err(error) => panic!(
            "{}:{}: expected {} in\n{text}",
            error.line, error.column, error.expected
        ),
    }
}

#[track_caller]
fn assert_error(text: &str, line: u32, column: u32, expected: &'static str) {
    let error = ParseError {
        line,
        column,
        expected,
    };
    assert_eq!(parse(text).err(), Some(error), "\n{text}");
}

fn record_counts(program: &Program) -> [(ProgramList, usize); 12] {
    [
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
    ]
}

fn first_line_of(list: ProgramList) -> Option<String> {
    let keyword = list.keyword()?;
    Some(match list.prefix() {
        Some(prefix) => format!("{keyword} {prefix}0\n"),
        None => format!("{keyword}\n"),
    })
}

fn numbered_lists() -> impl Iterator<Item = (&'static str, &'static str)> {
    let lists = ProgramList::ALL.into_iter();
    lists.filter_map(|list| Some((list.keyword()?, list.prefix()?)))
}

#[test]
fn keyword_names_one_list() {
    for list in ProgramList::ALL {
        if let Some(keyword) = list.keyword() {
            assert_eq!(find_list(keyword), Some(list));
            assert_eq!(find_list(&keyword.to_ascii_uppercase()), None);
        }
        assert_eq!(find_list(list.name()), None, "{}", list.name());
    }
    assert_eq!(find_list(""), None);
}

#[test]
fn line_fills_one_list() {
    for list in ProgramList::ALL {
        let Some(line) = first_line_of(list) else {
            continue;
        };
        for (other, count) in record_counts(&parse_valid(&line)) {
            assert_eq!(count, usize::from(other == list), "{line}{}", other.name());
        }
    }
}

#[test]
fn every_keyword_has_a_program_list() {
    let with_keyword = ProgramList::ALL.into_iter().filter(|list| list.keyword().is_some());
    let counted = record_counts(&Program::new()).map(|(list, _)| list);
    assert!(with_keyword.eq(counted));
}

#[test]
fn ids_of_a_list_ascend() {
    for (keyword, prefix) in numbered_lists() {
        let id_column = keyword.len() as u32 + 2;
        let first = format!("{keyword} {prefix}0\n");
        assert_error(&format!("{keyword} {prefix}1\n"), 1, id_column, NEXT_ID);
        assert_error(&format!("{first}{first}"), 2, id_column, NEXT_ID);
        assert_error(&format!("{first}{keyword} {prefix}2\n"), 2, id_column, NEXT_ID);
    }
    let program = parse_valid("layout L0\nlayout L1 position=4\nlayout L2\n");
    let positions: Vec<u32> = program.layouts.iter().map(|layout| layout.position).collect();
    assert_eq!(positions, [0, 4, 0]);
}

#[test]
fn numbered_line_needs_list_prefix() {
    for (keyword, _) in numbered_lists() {
        let id_column = keyword.len() as u32 + 2;
        assert_error(&format!("{keyword}\n"), 1, id_column - 1, NEXT_ID);
        assert_error(&format!("{keyword} z0\n"), 1, id_column, NEXT_ID);
        assert_error(&format!("{keyword} 0\n"), 1, id_column, NEXT_ID);
    }
    assert_error("layout g0\n", 1, 8, NEXT_ID);
    assert_error("variable L0\n", 1, 10, NEXT_ID);
    assert_error("layout position=4\n", 1, 8, NEXT_ID);
    assert_error("layout L4294967295\n", 1, 8, NEXT_ID);
}

#[test]
fn lists_may_interleave() {
    let text = "\
variable g0 module=m1
layout L0 position=1
entry module=m2
variable g1 module=m3
layout L1 position=2
entry module=m4
";
    let program = parse_valid(text);
    let variable_modules: Vec<ModuleId> = program.variables.iter().map(|it| it.module).collect();
    assert_eq!(variable_modules, [1, 3].map(ModuleId::new));
    let positions: Vec<u32> = program.layouts.iter().map(|layout| layout.position).collect();
    assert_eq!(positions, [1, 2]);
    let entry_modules: Vec<ModuleId> = program.entries.iter().map(|entry| entry.module).collect();
    assert_eq!(entry_modules, [2, 4].map(ModuleId::new));

    assert_error("layout L0\nvariable g0\nlayout L2\n", 3, 8, NEXT_ID);
    assert_error("layout L0\nvariable g1\n", 2, 10, NEXT_ID);
}

#[test]
fn line_without_prefix() {
    let program = parse_valid("entry module=m0\nentry module=m0\nwebassemblymodule module=m1\n");
    assert_eq!(program.entries, [Entry::default(), Entry::default()]);
    assert_eq!(program.web_assembly_modules[0].module, ModuleId::new(1));
    assert!(program.modules.is_empty());

    assert_error("entry m0\n", 1, 7, LINE_END);
    assert_error("entry 0 module=m0\n", 1, 7, LINE_END);
    assert_error("runtimefunction f0\n", 1, 17, LINE_END);
    assert_error("webassemblymodule m0\n", 1, 19, LINE_END);
}

#[test]
fn unknown_keyword() {
    let expected = "a record keyword";
    assert_error("shape L0\n", 1, 1, expected);
    assert_error("Layout L0\n", 1, 1, expected);
    assert_error("type t0\n", 1, 1, expected);
    assert_error("string s0\n", 1, 1, expected);
    assert_error("L0\n", 1, 1, expected);
    assert_error("5\n", 1, 1, expected);
    assert_error("\"layout\" L0\n", 1, 1, expected);
    assert_error("  = layout L0\n", 1, 3, expected);
    assert_error("layout L0\n\n# comment\n  shape L1\n", 4, 3, expected);
}

#[test]
fn unknown_field() {
    assert_error("entry shape=1\n", 1, 13, "a field of Entry");
    assert_error("modulefailure q0 module=m0\n", 1, 25, "a field of ModuleFailure");
    assert_error("entry Module=m0\n", 1, 14, "a field of Entry");
    assert_error("entry module=L0\n", 1, 14, "an id of kind Module");
}

#[test]
fn line_holds_one_record() {
    assert_error("layout L0 layout L1\n", 1, 11, LINE_END);
    assert_error("layout L0 position=4 5\n", 1, 22, LINE_END);
    assert_error("layout L0,\n", 1, 10, LINE_END);
    assert_error("function f0 {\n  b0():\n    Return\n} layout L0\n", 4, 3, LINE_END);
}

#[test]
fn function_line_ends_after_body() {
    let text = "function f0 {\n  b0():\n    Return\n}\nfunction f1\nlayout L0\n";
    let program = parse_valid(text);
    let block_counts: Vec<u32> = program.functions.iter().map(|it| it.body.block_count).collect();
    assert_eq!(block_counts, [1, 0]);
    assert_eq!(program.layouts.len(), 1);
}

#[test]
fn comment_and_empty_lines_are_skipped() {
    let program = parse_valid("\n# first\n\n  layout L0 # trailing\n\r\n\t\nlayout L1\n# last");
    assert_eq!(program.layouts.len(), 2);
    for text in ["", "\n\n", "# only a comment", "  \t\r\n"] {
        let counts = record_counts(&parse_valid(text));
        assert!(counts.iter().all(|&(_, count)| count == 0), "{text:?}");
    }
}

#[test]
fn last_line_needs_no_line_end() {
    assert_eq!(parse_valid("layout L0").layouts.len(), 1);
    assert_eq!(parse_valid("layout L0\nentry module=m1").entries[0].module, ModuleId::new(1));
}

#[test]
fn nothing_is_invented() {
    let program = parse_valid("function f0 module=m3\n");
    assert!(program.modules.is_empty());
    assert!(program.entries.is_empty());
    assert!(program.strings.is_empty());
    assert_eq!(program.types.len(), TypeTable::WELL_KNOWN_COUNT);
    assert_eq!(program.functions[0].module, ModuleId::new(3));
}
