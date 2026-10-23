use crate::compile::testing::lower_program;
use crate::ir::{DeclaredType, Opcode, Primitives, Type};
use crate::load::host_platform;
use crate::lower::LoweringOptions;

#[track_caller]
fn expected_types(file_name: &str, source: &str, function_name: &str) -> Vec<Type> {
    let options = LoweringOptions {
        platform: host_platform(),
        embeds_function_text: false,
        reports_type_mismatches: false,
        removable: Default::default(),
        minifies_identifiers: false,
    };
    let lowered = lower_program(&[(file_name, source)], options);
    let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
    let mut functions = fragments.flat_map(|fragment| {
        let functions = fragment.functions.iter();
        functions.map(move |(_, function)| (fragment, function))
    });
    let found = functions.find(|(fragment, function)| {
        let name = function.name.map(|name| fragment.strings.get(name));
        name == Some(function_name.as_bytes())
    });
    let (fragment, function) = found.expect("the program defines the function");
    let values = function.body.blocks().flat_map(|block| block.values());
    values
        .filter(|value| value.opcode == Opcode::Convert)
        .filter_map(|value| DeclaredType::from_words(&value.fields[1..]))
        .filter(|declared| declared.is_expected())
        .map(|declared| {
            let mut ty = fragment.types.get(declared.ty).clone();
            ty.primitives = ty.primitives.without(Primitives::NULLISH);
            ty
        })
        .collect()
}

#[test]
fn inferred_call_result_is_expected_once() {
    let source = "function g() { return 1; }
export function probe() { const v = g(); return v; }
";
    let expected = expected_types("main.js", source, "probe");
    let number = Type::primitives(Primitives::NUMBER);
    let numbers = expected.iter().filter(|&ty| *ty == number);
    assert_eq!(numbers.count(), 1, "{expected:?}");
}

#[test]
fn function_binding_is_not_expected() {
    let source = "function g() {}
export function probe() { g; }
";
    let expected = expected_types("main.js", source, "probe");
    assert!(expected.is_empty(), "{expected:?}");
}

#[test]
fn what_the_checker_says_in_a_checked_file_is_not_expected() {
    let source = "export function probe(a: number, b: number) { return a + b; }";
    let expected = expected_types("main.ts", source, "probe");
    assert!(expected.is_empty(), "{expected:?}");
}
