use crate::builtins::id::BuiltinClass;
use crate::compile::testing::lower_program;
use crate::ir::{DeclaredType, Opcode, Primitives, Type, TypeTable};
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
        obfuscates: false,
        counts_executions: false,
        imports_are_untyped: false,
        runs_tests: false,
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
export function probe() { const v = g(); return [v]; }
";
    let expected = expected_types("main.js", source, "probe");
    let number = Type::primitives(Primitives::NUMBER);
    let numbers = expected.iter().filter(|&ty| *ty == number);
    assert_eq!(numbers.count(), 1, "{expected:?}");
}

#[test]
fn call_in_tail_position_is_not_expected() {
    let source = "function g() { return 1; }
export function returned() { return g(); }
export function returned_through_constant() { const v = g(); return v; }
";
    for name in ["returned", "returned_through_constant"] {
        let expected = expected_types("main.js", source, name);
        assert!(expected.is_empty(), "{name}: {expected:?}");
    }
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

#[test]
fn what_the_callers_pass_beats_what_the_uses_guess() {
    let source = "function probe(record, i) { const word = record.codes[i | 1]; return word & 3; }
const record = { codes: new Int32Array(4) };
console.log(probe(record, 0));
";
    let expected = expected_types("main.js", source, "probe");
    let is_array = |ty: &Type| {
        let mut classes = ty.classes.iter();
        classes.any(|part| part.builtin_class == BuiltinClass::Array)
    };
    assert!(!expected.iter().any(is_array), "{expected:?}");
    assert!(!expected.is_empty());
}

#[test]
fn what_the_uses_name_stands_when_a_caller_lacks_it() {
    let source = "function probe(record) { return record.codes[0]; }
console.log(probe({ other: 1 }));
";
    let expected = expected_types("main.js", source, "probe");
    assert!(!expected.is_empty());
}

#[test]
fn what_a_callback_does_with_its_parameter_says_what_the_list_holds() {
    let source = "export function probe(text) {
  const list = JSON.parse(text);
  const kept = list.filter(x => x > 2);
  return [list, kept];
}
";
    let expected = expected_types("main.js", source, "probe");
    let numbers = Type::class(BuiltinClass::Array, &[TypeTable::NUMBER]);
    let lists = expected.iter().filter(|&ty| *ty == numbers);
    assert_eq!(lists.count(), 2, "{expected:?}");
}

#[test]
fn a_callback_that_says_nothing_of_its_parameter_says_nothing_of_the_list() {
    let source = "export function probe(text, seen) {
  const list = JSON.parse(text);
  seen(list);
  return list.filter(x => seen(x));
}
";
    let expected = expected_types("main.js", source, "probe");
    let is_array = |ty: &Type| {
        let mut classes = ty.classes.iter();
        classes.any(|part| part.builtin_class == BuiltinClass::Array)
    };
    assert!(!expected.iter().any(is_array), "{expected:?}");
}

#[test]
fn a_variable_that_is_given_a_product_is_no_int32_for_a_mask() {
    let source = "export function probe(x, digits, carry) {
  var v = x * digits[0] + carry;
  return [Math.floor(v / 0x4000000), v & 0x3ffffff];
}
";
    let expected = expected_types("main.js", source, "probe");
    let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
    assert!(!expected.contains(&int32), "{expected:?}");
    let number = Type::primitives(Primitives::NUMBER);
    assert!(expected.contains(&number), "{expected:?}");
}

#[test]
fn a_variable_that_is_given_no_product_is_an_int32_for_a_mask() {
    let source = "export function probe(digits) {
  var v = digits[0];
  return [v & 0x3ffffff, v >> 26];
}
";
    let expected = expected_types("main.js", source, "probe");
    let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
    assert!(expected.contains(&int32), "{expected:?}");
}

#[test]
fn a_variable_that_is_stepped_where_it_is_a_key_is_an_int32() {
    let source = "export function probe(digits, i) {
  return digits[i++] * digits[i++];
}
";
    let expected = expected_types("main.js", source, "probe");
    let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
    assert!(expected.contains(&int32), "{expected:?}");
}

#[test]
fn a_variable_that_is_stepped_and_compared_with_an_integer_is_an_int32() {
    let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
    let counts = "export function probe(n, seen) {
  while (--n >= 0) seen();
}
";
    let expected = expected_types("main.js", counts, "probe");
    assert!(expected.contains(&int32), "{expected:?}");
    let shrinks = "export function probe(n, seen) {
  while (--n >= 0.5) seen();
}
";
    let expected = expected_types("main.js", shrinks, "probe");
    assert!(!expected.contains(&int32), "{expected:?}");
}
