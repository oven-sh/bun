use super::*;

#[test]
fn strictness_comes_from_own_body() {
    let cases: &[(&str, &[bool])] = &[
        (
            r#"function f() { function g() { "use strict" } }"#,
            &[true, false],
        ),
        (r#"() => function () { "use strict" }"#, &[true, false]),
        (r#"a => function () { "use strict" }"#, &[true, false]),
        (
            r#"(a = function () { "use strict" }) => { a }"#,
            &[true, false],
        ),
        (
            r#"function f() { "use strict" } declare function g(): void"#,
            &[true, false],
        ),
        (
            r#"function f() { "use strict"; return () => a => 1 }"#,
            &[true, true, true],
        ),
    ];
    for &(text, expected) in cases {
        assert_eq!(function_strictness(text, true), expected, "{text}");
        let sloppy = vec![false; expected.len()];
        assert_eq!(function_strictness(text, false), sloppy, "{text}");
    }
}

#[test]
fn strictness_comes_from_enclosing_code() {
    let text = r#"function f() { "use strict"; function g() {} return () => 1 }
        function h() {}"#;
    assert_eq!(function_strictness(text, true), [true, true, true, false]);
    assert_eq!(function_strictness(text, false), [false; 4]);
    for keeps_function_directives in [true, false] {
        let strictness = |text| function_strictness(text, keeps_function_directives);
        let text = "class A extends (function () {}) { m() {} get x() { return 1 } y = () => 1 }
            function f() {}";
        assert_eq!(strictness(text), [true, true, true, true, false]);
        assert_eq!(strictness("declare function f(): void"), [false]);
        assert_eq!(strictness(r#""use strict"; function f() {}"#), [true]);
        assert_eq!(strictness("function f() {} export {}"), [true]);
    }
}

#[test]
fn dropped_directive_leaves_strictness_of_file_and_classes() {
    let cases: &[(&str, &[bool], &[bool])] = &[
        (
            r#"function f() { "use strict"; class A { m() {} } function g() {} }"#,
            &[true, true, true],
            &[true, false, false],
        ),
        (
            r#"class A { m() { "use strict"; return () => 1 } } function f() { "use strict" }"#,
            &[true, true, true],
            &[true, true, false],
        ),
        (
            r#""use strict"; function f() { "use strict" }"#,
            &[true],
            &[true],
        ),
        (
            r#"function f() { "use strict" } export {}"#,
            &[true],
            &[true],
        ),
    ];
    for &(text, kept, dropped) in cases {
        assert_eq!(function_strictness(text, true), kept, "{text}");
        assert_eq!(function_strictness(text, false), dropped, "{text}");
    }
}

#[test]
fn function_directive_is_rare_syntax() {
    use rare::{DIRECTIVE_IN_FUNCTION, DROPPED_STRICT_DIRECTIVE};
    for (text, if_kept, if_dropped) in [
        (
            r#"function f() { "use strict" }"#,
            DIRECTIVE_IN_FUNCTION,
            DROPPED_STRICT_DIRECTIVE,
        ),
        (
            r#"function f() { "a"; "use strict" }"#,
            DIRECTIVE_IN_FUNCTION,
            DROPPED_STRICT_DIRECTIVE,
        ),
        (
            r#"class A { m() { "use strict" } }"#,
            DIRECTIVE_IN_FUNCTION,
            DROPPED_STRICT_DIRECTIVE,
        ),
        (r#"function f() { "a" }"#, DIRECTIVE_IN_FUNCTION, 0),
        (r#"function f() { x; "use strict" }"#, 0, 0),
        (r#""use strict"; function f() {}"#, 0, 0),
    ] {
        for (keeps_function_directives, expected) in [(true, if_kept), (false, if_dropped)] {
            let options = Options {
                keeps_function_directives,
                ..compiled_javascript()
            };
            let (file, _) = parsed(text, options);
            let found = file.rare_syntax & (DIRECTIVE_IN_FUNCTION | DROPPED_STRICT_DIRECTIVE);
            assert_eq!(found, expected, "{text}");
        }
    }
}

#[test]
fn text_starts_after_modifiers() {
    let cases: &[(&str, &[&str], &[&str])] = &[
        ("function f() {}", &["function f"], &[]),
        ("export function f() {}", &["function f"], &[]),
        ("export default function () {}", &["function ("], &[]),
        (
            "export default async function f() {}",
            &["async function f"],
            &[],
        ),
        ("declare function f(): void", &["function f"], &[]),
        ("x = async function* () {}", &["async function*"], &[]),
        ("x = async () => 1", &["async ()"], &[]),
        ("x = a => 1", &["a =>"], &[]),
        (
            "({ async m() {}, get x() { return 1 }, *g() {} })",
            &["async m", "get x", "*g"],
            &[],
        ),
        ("class A { m() {} }", &["m()"], &["class A"]),
        ("class A { static m() {} }", &["m()"], &["class A"]),
        (
            "class A { static async *m() {} }",
            &["async *m"],
            &["class A"],
        ),
        (
            "class A { static get x() { return 1 } }",
            &["get x"],
            &["class A"],
        ),
        (
            "class A { public override set x(a) {} }",
            &["set x"],
            &["class A"],
        ),
        ("class A { @dec m() {} }", &["m()"], &["class A"]),
        ("class A { static {} }", &["static {"], &["class A"]),
        ("export class A {}", &[], &["class A"]),
        ("export default class {}", &[], &["class {"]),
        ("abstract class A {}", &[], &["class A"]),
        ("@dec class A {}", &[], &["class A"]),
        ("x = @dec class {}", &[], &["class {"]),
    ];
    for &(text, functions, classes) in cases {
        let (file, _) = parsed(text, typescript());
        let starts_with =
            |(start, expected): (u32, &&str)| text[start as usize..].starts_with(*expected);
        let function_starts = file.fns.iter().map(|it| it.text_start);
        assert_eq!(file.fns.len(), functions.len(), "{text}");
        assert!(
            function_starts.zip(functions).all(starts_with),
            "{text}: {:?}",
            file.fns
        );
        let class_starts = file.classes.iter().map(|it| it.text_start);
        assert_eq!(file.classes.len(), classes.len(), "{text}");
        assert!(
            class_starts.zip(classes).all(starts_with),
            "{text}: {:?}",
            file.classes
        );
    }
}

#[test]
fn signatures_are_not_strict() {
    let text = "'use strict'; type A = () => B; interface C { m(): B; [k: string]: B }";
    let (file, _) = parsed(text, typescript());
    assert!(file.is_strict);
    assert_eq!(file.fns.len(), 3);
    for signature in &file.fns {
        assert!(!signature.is_strict && !signature.is_strict_by_syntax);
    }
}

#[test]
fn signature_text_starts_at_first_token() {
    let text = "type A = abstract new () => B; interface C { readonly [k: string]: B; m(): B }";
    let (file, _) = parsed(text, typescript());
    let starts: Vec<(u32, u32)> = (file.fns.iter())
        .map(|it| (it.start, it.text_start))
        .collect();
    assert_eq!(starts, [(9, 9), (45, 45), (70, 70)]);
}

#[test]
fn accessor_body_sets_strictness() {
    for (text, kept, dropped) in [
        (
            r#"interface A { get a() { "use strict"; return 1 } get b() { return 1 } }"#,
            [true, false],
            [false, false],
        ),
        (
            r#""use strict"; type A = { get a() { return 1 } set a(b) {} }"#,
            [true, true],
            [true, true],
        ),
    ] {
        assert_eq!(function_strictness(text, true), kept, "{text}");
        assert_eq!(function_strictness(text, false), dropped, "{text}");
    }
}

#[test]
fn component_strictness() {
    let with_own_directive = "component A() { 'use strict'; }\ncomponent B() {}";
    let in_strict_file = "'use strict';\ncomponent A() {}\ncomponent B() {}";
    for (text, keeps_function_directives, expected) in [
        (with_own_directive, true, [true, false]),
        (with_own_directive, false, [false, false]),
        (in_strict_file, false, [true, true]),
    ] {
        let options = Options {
            is_javascript: true,
            is_jsx: true,
            dialect: Dialect::flow_parser(false),
            keeps_function_directives,
            ..Options::default()
        };
        let (file, _) = parsed(text, options);
        let strict: Vec<bool> = file.fns.iter().map(|it| it.is_strict).collect();
        assert_eq!(strict, expected, "{text}");
    }
}

fn javascript(dialect: Dialect) -> Options {
    Options {
        is_javascript: true,
        is_jsx: true,
        dialect,
        ..Options::default()
    }
}

fn return_types(text: &str, options: Options) -> Vec<bool> {
    let (file, _) = parsed(text, options);
    file.fns.iter().map(|it| it.ret.is_some()).collect()
}

#[test]
fn flow_has_return_types_after_any_parameters() {
    for dialect in [Dialect::flow(false), Dialect::flow_parser(false)] {
        for text in [
            "const f = (a: number): number => a;",
            "const f = (a): number => a;",
            "const f = (a, b): number => a;",
            "const f = (a = 1): number => a;",
            "const f = ({ a }): number => a;",
            "const f = async (a): Promise<number> => a;",
            "f((a): string => a);",
        ] {
            assert_eq!(return_types(text, javascript(dialect)), [true], "{text}");
        }
    }
}

#[test]
fn javascript_formatted_as_typescript_keeps_return_types() {
    let text = "const f = (a): number => a;";
    assert_eq!(
        return_types(text, javascript(Dialect::babel(false))),
        [true]
    );
}

#[test]
fn colon_after_parentheses_belongs_to_the_conditional_in_javascript() {
    for options in [
        compiled_javascript(),
        javascript(Dialect::espree(false)),
        javascript(Dialect::babel(false)),
    ] {
        for text in [
            "a ? b ? (c, d) : e => e : 5;",
            "a ? b ? (c) : e => e : 5;",
            "a ? b ? async (c) : e => e : 5;",
            "a ? b ? x => (c) : e => e : 5;",
            "p ? a ? b ? x : (c) : e => e : 5;",
        ] {
            let found = return_types(text, options);
            assert!(!found.contains(&true), "{text}");
        }
    }
}

#[test]
fn colon_after_parentheses_belongs_to_the_case_clause_in_a_build() {
    let text = "switch (a) { case (a): b => b; }";
    assert_eq!(return_types(text, compiled_javascript()), [false]);
}
