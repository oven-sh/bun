mod support;

use bun_engine_syntax::ast::{Ast, Features, ScopeFlags, ScopeId, StmtKind};
use bun_engine_syntax::{Parser, SourceCache};
use bun_engine_text::Text;
use support::{SCRIPT, bindings, function, in_each_width, options, options_for};

/// Parses the function that `source` starts with: without a cache, with what the script left in it, and once more.
fn in_function(source: &str, check: impl Fn(&Ast, Text<'_>)) {
    in_each_width(source, |text| {
        let (mut parser, mut cache) = (Parser::default(), SourceCache::default());
        let whole = options(SCRIPT, 0..text.len() as u32);
        let function = function(parser.parse(text, &whole, Some(&mut cache)).unwrap());
        let options = options_for(&function);
        check(parser.parse(text, &options, None).unwrap(), text);
        for _ in 0..2 {
            check(
                parser.parse(text, &options, Some(&mut cache)).unwrap(),
                text,
            );
        }
    });
}

fn check(source: &str, expected: &[&str]) {
    in_function(source, |ast, text| {
        assert_eq!(
            bindings(ast, text, ast.root.tree.scope),
            expected,
            "{source}"
        );
    });
}

/// That of the last statement of the function, which is a block.
fn scope_of_last_block(ast: &Ast) -> Option<ScopeId> {
    let StmtKind::Block { body, .. } = ast[ast.at(ast.root.tree.body, 0)].kind else {
        return None;
    };
    match ast[ast.at(body, body.len() - 1)].kind {
        StmtKind::Block { scope, .. } => scope,
        _ => None,
    }
}

#[test]
fn every_kind_of_assignment_is_noted() {
    for statement in [
        "a = 1",
        "a += 1",
        "a ||= 1",
        "a++",
        "--a",
        "[a] = b",
        "[a = 1] = b",
        "[...a] = b",
        "({ a } = b)",
        "({ a = 1 } = b)",
        "({ b: a } = b)",
        "({ ...a } = b)",
        "(a) = 1",
        "var a = 1",
        "var [a] = b",
        "var { a } = b",
    ] {
        let source = format!("function f(a) {{ {statement} }}");
        check(&source, &["a Parameter USED | WRITTEN"]);
    }
    for statement in [
        "a = 1; a = 2",
        "while (a = 1);",
        "do a = 1; while (b)",
        "for (;; a++);",
        "for (;;) { a = 1 }",
        "for (a in b);",
        "for (var a of b);",
        "for ([a] of b);",
        "for (b[a++] of c);",
        "for (let [b = a = 1] of c);",
    ] {
        let source = format!("function f(a) {{ {statement} }}");
        check(&source, &["a Parameter USED | WRITTEN | REWRITTEN"]);
    }
}

#[test]
fn closures_capture() {
    let read = ["a Parameter USED | CAPTURED"];
    check(
        "function f(a) { (function () { return a + a + a }) }",
        &read,
    );
    check("function f(a) { () => () => [a, a, a, a, a, a, a] }", &read);
    check(
        "function f(a) { class A { b = a; static { a } } }",
        &[read[0], "A Let "],
    );
    check("function f(a) { with (b) a }", &read);
    check(
        "function f(a) { (function (a) { return a + a + a }) }",
        &["a Parameter "],
    );
    check("function f(a) { ({ [b]: a = 1 }) => a }", &["a Parameter "]);
    check(
        "function f(a) { (function () { [a] = something }) }",
        &["a Parameter USED | CAPTURED | WRITTEN | REWRITTEN"],
    );
    check(
        "function f() { () => [this, arguments, new.target] }",
        &[
            "arguments Arguments USED | CAPTURED",
            "*this* Internal USED | CAPTURED",
            "*new.target* Internal USED | CAPTURED",
        ],
    );
    check("(function f() { return f })", &["f Callee USED"]);
    check("(function f(f) { return f })", &["f Parameter USED"]);
}

#[test]
fn uses_before_initialization() {
    check("function f() { let a = 1; a }", &["a Let USED"]);
    check(
        "function f() { a; let a = 1 }",
        &["a Let USED | USED_EARLY"],
    );
    check("function f() { let a = a }", &["a Let USED | USED_EARLY"]);
    check("function f(a = a) {}", &["a Parameter USED | USED_EARLY"]);
    check(
        "function f() { let a; a }",
        &["a Let USED | STARTS_UNDEFINED"],
    );
}

#[test]
fn a_block_hides_what_is_outside() {
    for (source, expected) in [
        ("function f(a) { a = 1; { let a = 2; a } }", "a Let USED"),
        ("function f(a) { a; { let a = 2 } }", "a Let "),
        (
            "function f(a) { a; { () => a; let a = 2 } }",
            "a Let USED | CAPTURED",
        ),
        (
            "function f(a) { { { a = 1 } let a = 2 } }",
            "a Let USED | WRITTEN | USED_EARLY",
        ),
    ] {
        in_function(source, |ast, text| {
            let found = bindings(ast, text, scope_of_last_block(ast));
            assert_eq!(found, [expected], "{source}");
        });
    }
}

#[test]
fn what_is_outside_a_block_is_not_touched_by_it() {
    check(
        "function f(a) { a; { a = 1; () => a; let a } }",
        &["a Parameter USED"],
    );
    check(
        "function f(a) { { () => a } { () => a = 1; let a } }",
        &["a Parameter USED | CAPTURED"],
    );
}

#[test]
fn captures_pass_through_functions() {
    let names: Vec<String> = (0..200).map(|index| format!("b{index}")).collect();
    let names = names.join(",");
    check(
        &format!("function f(a, b7) {{ () => () => () => [{names}]; () => () => b7 = 1 }}"),
        &[
            "a Parameter ",
            "b7 Parameter USED | CAPTURED | WRITTEN | REWRITTEN",
        ],
    );
    check(
        "function f(a, \\u0062) { class A { c = () => \\u0061; static { () => b } } }",
        &[
            "a Parameter USED | CAPTURED",
            "b Parameter USED | CAPTURED",
            "A Let ",
        ],
    );
}

#[test]
fn closures_among_the_parameters_do_not_see_the_body() {
    for (source, is_hidden) in [
        ("function f(a = () => b) { var b }", true),
        ("function f(a = () => c) { var b; () => b }", false),
    ] {
        in_function(source, |ast, _| {
            let flags = ast[ast.root.tree.body_scope.unwrap()].flags;
            let found = flags.contains(ScopeFlags::HIDDEN_FROM_PARAMETERS);
            assert_eq!(found, is_hidden, "{source}");
        });
    }
}

#[test]
fn many_bindings_around_many_suspensions_are_kept_in_the_scope() {
    const BINDINGS: usize = 1024;
    let names: Vec<String> = (0..BINDINGS).map(|index| format!("b{index}")).collect();
    let (names, reads) = (names.join(","), names.join("+"));
    // Each of these suspends once, in the scope of the function or in a block.
    let suspensions: [fn(usize, &str, &str) -> String; 3] = [
        |count, names, reads| {
            let yields = "yield;".repeat(count);
            format!("function* f() {{ var {names}; {yields} {reads} }}")
        },
        |count, names, reads| {
            let returns = "if (c) return c;".repeat(count);
            format!("async function* f(c) {{ var {names}; {returns} {reads} }}")
        },
        |count, names, reads| {
            let resources: Vec<String> = (0..count).map(|it| format!("u{it}=c")).collect();
            let resources = resources.join(",");
            format!("async function f(c) {{ var {names}; {{ await using {resources}; }} {reads} }}")
        },
    ];
    for make in suspensions {
        for (count, expected) in [(1000, "b0 Var USED"), (1100, "b0 Var USED | CAPTURED")] {
            let source = make(count, &names, &reads);
            in_function(&source, |ast, text| {
                let found = bindings(ast, text, ast.root.tree.scope);
                let first = found.iter().find(|it| it.starts_with("b0 "));
                assert_eq!(first.map(String::as_str), Some(expected), "{count}");
            });
        }
    }
}

#[test]
fn eval_reaches_everything() {
    in_function(
        "function f(a) { () => { eval(something) } }",
        |ast, text| {
            let flags = ast[ast.root.tree.scope.unwrap()].flags;
            assert_eq!(flags, ScopeFlags::CONTAINS_EVAL | ScopeFlags::HAS_CAPTURED);
            let found = bindings(ast, text, ast.root.tree.scope);
            assert_eq!(
                found[0],
                "a Parameter USED | CAPTURED | WRITTEN | REWRITTEN"
            );
        },
    );
    check(
        "function f(a) { eval?.(b); (0, eval)(b) }",
        &["a Parameter "],
    );
}

#[test]
fn functions_in_blocks_get_variables() {
    check(
        "function f() { { function a() {} } }",
        &["a Var USED | WRITTEN | REWRITTEN | HOISTED"],
    );
    check("function f() { { let a; { function a() {} } } }", &[]);
    check("function f() { { { function a() {} } let a } }", &[]);
    check(
        "function f() { { { function a() {} } function a() {} { function a() {} } } }",
        &["a Var USED | WRITTEN | REWRITTEN | HOISTED"],
    );
    check(
        "function f() { try {} catch (a) { { function a() {} } } }",
        &["a Var USED | WRITTEN | REWRITTEN | HOISTED"],
    );
    check("function f() { 'use strict'; { function a() {} } }", &[]);
}

#[test]
fn only_the_length_of_arguments() {
    for (body, is_only) in [
        ("arguments.length + 1", true),
        ("arguments.length = 1", false),
        ("(arguments.length)++", false),
        ("delete arguments.length", false),
        ("arguments.length()", false),
        ("arguments.length``", false),
        ("[arguments.length] = a", false),
        ("for (arguments.length in a);", false),
        ("arguments.length; ({ arguments })", false),
        ("arguments.length; () => arguments", false),
        ("var arguments; arguments.length", false),
    ] {
        in_function(&format!("function f() {{ {body} }}"), |ast, _| {
            let found = ast
                .root
                .tree
                .features
                .contains(Features::ONLY_ARGUMENTS_LENGTH);
            assert_eq!(found, is_only, "{body}");
        });
    }
}
