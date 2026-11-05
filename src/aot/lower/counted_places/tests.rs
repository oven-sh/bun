use crate::compile::testing::lower_program;
use crate::ir::{Opcode, Reference};
use crate::load::host_platform;
use crate::lower::{Fragment, LoweringOptions};

fn lower(source: &str) -> Fragment {
    let options = LoweringOptions {
        platform: host_platform(),
        embeds_function_text: false,
        removable: Default::default(),
        minifies_identifiers: false,
        obfuscates: false,
        counts_executions: true,
        runs_tests: false,
    };
    let mut lowered = lower_program(&[("main.ts", source)], options);
    assert_eq!(lowered.len(), 1);
    lowered.remove(0).1.fragment
}

fn describe(source: &str) -> Vec<String> {
    let fragment = lower(source);
    let body = fragment.module.body.expect("the module has a body");
    let mut functions = fragment.functions.iter();
    let (_, body) = functions
        .find(|(function, _)| *function == body)
        .expect("the fragment defines the body of its module");
    let mut strings = Vec::new();
    body.body.for_each_reference(&mut |reference| {
        if let Reference::String(string) = reference {
            strings.push(string);
        }
    });
    let tables = fragment.tables.take();
    let description = String::from_utf8(tables.strings.get(strings[0]).to_vec()).unwrap();
    fragment.tables.put_back(tables);
    description.lines().skip(1).map(str::to_owned).collect()
}

#[test]
fn what_the_transpiler_makes_of_typescript_is_described() {
    let places = describe(
        "export enum Shade { Pale }
export namespace Measures { export function area() { return 1; } }
export class Kept { constructor(public first: number) {} }
",
    );
    assert_eq!(
        places,
        [
            "b 0 153",
            "f 62 91 0 75",
            "f 114 150 0 125",
            "e 0 26 0 12",
            "e 27 93 0 44",
            "o 62 75 54",
            "o 126 146 113",
        ]
    );
}

#[test]
fn the_block_of_a_field_begins_at_its_name_or_behind_its_brackets() {
    let places = describe(
        "export class Kept {
  readonly named = 1;
  [Symbol.iterator] = 2;
  bare;
}
",
    );
    assert_eq!(places, ["b 0 77", "b 31 40", "b 63 65"]);
}

#[test]
fn a_decorated_field_is_named_behind_the_class_and_leaves_work_to_a_made_constructor() {
    let places = describe(
        "function mark(value: undefined, context: unknown) {}
export class Kept {
  @mark
  named = 1;
}
",
    );
    assert_eq!(
        places,
        [
            "b 0 96",
            "f 0 52 0 13",
            "b 83 92",
            "o 83 84 72",
            "f 71 72 0 71",
            "o 53 66 71",
        ]
    );
}

#[test]
fn an_accessor_field_is_a_getter_a_setter_and_work_for_a_made_constructor() {
    let places = describe(
        "export class Kept {
  accessor read = 1;
}
",
    );
    assert_eq!(
        places,
        [
            "b 0 43",
            "b 31 39",
            "f 31 32 0 31",
            "f 23 24 0 23",
            "o 31 32 23",
            "o 0 13 23",
            "f 18 19 0 18",
            "o 0 13 18",
        ]
    );
}

#[test]
fn a_decorated_method_begins_at_its_decorator_and_a_bare_field_takes_what_runs_for_each_object() {
    let places = describe(
        "function log(value: Function, context: unknown) {}
export class Marked {
  @log
  method() {}
  bare;
}
",
    );
    assert_eq!(
        places,
        [
            "b 0 104",
            "f 0 50 0 12",
            "f 75 93 0 88",
            "o 82 88 72",
            "b 71 72",
            "o 51 64 71",
            "s 96 97 4",
        ]
    );
}

#[test]
fn the_decorators_of_a_private_method_count_with_the_method_whose_key_holds_them() {
    let places = describe(
        "function log(value: Function, context: unknown) {}
export class Hidden {
  @log
  #method() {}
  open() {}
}
",
    );
    assert_eq!(
        places,
        [
            "b 0 109",
            "f 0 50 0 12",
            "f 82 94 0 89",
            "f 97 106 0 101",
            "o 82 89 72",
            "s 76 79 3",
            "f 71 72 0 71",
            "o 51 64 71",
        ]
    );
}

#[test]
fn a_method_is_made_for_decorators_that_no_key_can_hold() {
    let places = describe(
        "function log(value: Function, context: unknown) {}
export class Sealed {
  @log
  #method() {}
}
",
    );
    assert_eq!(
        places,
        [
            "b 0 97",
            "f 0 50 0 12",
            "f 82 94 0 89",
            "o 82 89 72",
            "f 76 79 0 76",
            "s 76 79 4",
            "f 71 72 0 71",
            "o 51 64 71",
        ]
    );
}

#[test]
fn an_else_branch_that_is_a_conditional_counts() {
    let fragment =
        lower("export function nested(a: boolean, b: boolean) { return a ? 1 : b ? 2 : 3; }\n");
    let functions = fragment.functions.iter();
    let blocks = functions.flat_map(|(_, function)| function.body.blocks());
    let values = blocks.flat_map(|block| block.values());
    let counts = values.filter(|value| value.opcode == Opcode::CountExecution);
    assert_eq!(counts.count(), 6);
}

#[test]
fn a_branch_that_is_a_function_has_no_count_beside_that_of_the_function() {
    let places = describe(
        "export function given(flag: boolean, made = () => 1) { return flag ? () => 2 : made; }\n",
    );
    assert_eq!(
        places,
        [
            "b 0 87",
            "f 7 86 0 21",
            "f 44 51 1 47",
            "f 69 76 1 72",
            "b 76 83",
        ]
    );
}
