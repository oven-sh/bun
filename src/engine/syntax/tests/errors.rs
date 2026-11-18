mod support;

use bun_engine_syntax::{ErrorKind, EvalContext, Goal, Recovery};
use bun_engine_text::Text;
use support::{SCRIPT, error_of};

fn check(goal: Goal<'_>, cases: &[(&str, &str)]) {
    for &(source, message) in cases {
        let found = error_of(source, goal).map(|error| error.message.to_string());
        assert_eq!(found.as_deref().unwrap_or(""), message, "{source}");
    }
}

#[test]
fn tokens() {
    check(
        SCRIPT,
        &[
            ("a b", "Unexpected identifier 'b'"),
            ("a 1", "Unexpected number '1'"),
            ("a 'b'", "Unexpected string literal 'b'"),
            ("a if", "Unexpected keyword 'if'"),
            ("enum", "Unexpected use of reserved word 'enum'"),
            ("(", "Unexpected end of script"),
            ("}", "Parser error"),
            ("@", "Invalid character: '@'"),
            ("\u{2026}", "Invalid character '\\u2026'"),
            (
                "\\u0069f",
                "Unexpected escaped characters in keyword token: '\\u0069f'",
            ),
            ("a\\x", "Invalid escape in identifier: 'a\\'"),
            ("'a\nb'", "Unexpected EOF"),
            ("'a\u{2028}b'", ""),
            (
                "'\\u{110000}'",
                "\\u can only be followed by a Unicode character sequence",
            ),
            (
                "`\\01`",
                "The only valid numeric escape in strict mode is '\\0'",
            ),
            ("a`\\01`", ""),
            ("0x", "No hexadecimal digits after '0x'"),
            (
                "1_",
                "No identifiers allowed directly after numeric literal",
            ),
            ("1.0_", "Non-number found after decimal point"),
            ("/*", "Multiline comment was not closed properly"),
            ("/a", "Unterminated regular expression literal '/a'"),
            ("#!a\nb", ""),
            ("<!-- a\n--> b", ""),
        ],
    );
}

#[test]
fn what_is_read_in_two_ways() {
    check(
        SCRIPT,
        &[
            ("(a, b) => c", ""),
            ("({ a = 1 }) => c", ""),
            ("({ a = 1 } = c)", ""),
            ("[a.b, ...c[d]] = e", ""),
            ("async (a = /b/) => c", ""),
            (
                "({ a = 1 })",
                "Unexpected token '='. Expected a ':' following the property name 'a'.",
            ),
            (
                "(a, a) => c",
                "Duplicate parameter 'a' not allowed in an arrow function.",
            ),
            ("(a)\n=> c", "Unexpected token '=>'"),
            (
                "[a + b] = c",
                "Unexpected token '+'. Expected either a closing ']' or a ',' following an element destructuring pattern.",
            ),
            ("[1] = c", "Invalid destructuring assignment target."),
            (
                "[([a] = b)] = c",
                "Invalid destructuring assignment target.",
            ),
            (
                "a + b = c",
                "Left hand side of operator '=' must be a reference.",
            ),
            ("(a + b) = c", "Left side of assignment is not a reference."),
            ("function* a() { yield\n* b }", "Unexpected token '*'"),
            (
                "function* a() { (b = (c = yield) => d, ...e) => f }",
                "Unexpected keyword 'yield'. Cannot use yield expression out of generator.",
            ),
            ("for (a => { b in c };;);", ""),
            ("for ([a = b in c] = d;;);", ""),
        ],
    );
}

#[test]
fn early_errors() {
    check(
        SCRIPT,
        &[
            ("let a; let a", "Cannot declare a let variable twice: 'a'."),
            (
                "let a; { var a }",
                "Cannot declare a var variable that shadows a let/const/class variable: 'a'.",
            ),
            ("try {} catch (a) { var a }", ""),
            ("{ function a() {} function a() {} }", ""),
            (
                "break",
                "'break' is only valid inside a switch or loop statement.",
            ),
            (
                "a: { continue a }",
                "Cannot continue to the label 'a' as it is not targeting a loop.",
            ),
            ("a /**/ : break a", ""),
            (
                "return",
                "Return statements are only valid inside functions.",
            ),
            (
                "function a(b = 1) { 'use strict' }",
                "'use strict' directive not allowed inside a function with a non-simple parameter list.",
            ),
            (
                "function a(b, b) { 'use strict' }",
                "Invalid parameters or function name in strict mode.",
            ),
            (
                "'\\01'; 'use strict'",
                "The only valid numeric escape in strict mode is '\\0'",
            ),
            ("'use strict'``; 01", ""),
            (
                "'use strict'; for (eval in a);",
                "Cannot modify 'eval' in strict mode.",
            ),
            (
                "a ?? b || c",
                "Unexpected token '||'. Coalescing and logical operators used together in the same expression; parentheses must be used to disambiguate.",
            ),
            (
                "({ __proto__: 1, '__proto__': 2 })",
                "Attempted to redefine __proto__ property.",
            ),
            (
                "using a = b",
                "'using' declaration is not allowed at the top level of a script or eval.",
            ),
        ],
    );
}

#[test]
fn classes() {
    check(
        SCRIPT,
        &[
            ("class A {} 010", ""),
            (
                "class A { static; async; get; static async *get() {} static }",
                "",
            ),
            ("class A { #a; #a }", "Cannot declare private field twice."),
            (
                "class A { get #a() {} set #a(b) {} get #a() {} }",
                "Declared private setter with an already used name.",
            ),
            (
                "class A { a() { this.#b } }",
                "Cannot reference undeclared private names: \"#b\"",
            ),
            (
                "class A { #a; b() { delete this?.#a } }",
                "Cannot delete private field #a.",
            ),
            (
                "class A { [super.a]() {} }",
                "super is not valid in this context.",
            ),
            (
                "class A { constructor() { super() } }",
                "super is not valid in this context.",
            ),
            ("class A { static { a: break a } }", ""),
            (
                "class A { static { () => arguments } }",
                "Cannot use 'arguments' as an identifier in static block.",
            ),
            ("class A { a = function (b = arguments) {} }", ""),
            ("async function a() { class A { b = await => c } }", ""),
            ("async function a() { (function await() {}) }", ""),
            (
                "async function a() { new await b }",
                "Unexpected identifier 'await'",
            ),
            (
                "async function a() { class A extends await b {} }",
                "Unexpected identifier 'await'",
            ),
        ],
    );
}

#[test]
fn modules() {
    check(
        Goal::Module,
        &[
            ("await a; for await (b of c);", ""),
            ("import a from 'b'\nwith { type: 'json' }", ""),
            ("import defer * as a from 'b'", ""),
            (
                "export { a }",
                "Exported binding 'a' needs to refer to a top-level declared variable.",
            ),
            (
                "var a; export { a, a }",
                "Cannot export a duplicate name 'a'.",
            ),
            ("export var a = ({ a } = b)", ""),
            (
                "export default 1; export default 2",
                "Only one 'default' export is allowed.",
            ),
            (
                "function a() { await }",
                "Cannot use 'await' as an identifier in a module.",
            ),
            (
                "(function await() {})",
                "Cannot declare function named 'await' in a module.",
            ),
            ("<!-- a", "Unexpected token '<'"),
        ],
    );
}

#[test]
fn eval_code_takes_after_what_is_around_it() {
    let is_private_name_declared = |name: Text<'_>| name.eq_ascii("#a");
    let eval = |context| Goal::Eval {
        context,
        is_private_name_declared: &is_private_name_declared,
    };
    let message = "new.target is only valid inside functions or static blocks.";
    check(eval(EvalContext::empty()), &[("new.target", message)]);
    check(eval(EvalContext::IN_FUNCTION), &[("new.target", "")]);
    check(
        eval(EvalContext::IN_METHOD),
        &[
            ("() => super.a", ""),
            ("super()", "super is not valid in this context."),
            ("b.#a", ""),
            ("b.#c", "Cannot reference undeclared private names: \"#c\""),
        ],
    );
    let constructor =
        EvalContext::IN_FUNCTION | EvalContext::IN_METHOD | EvalContext::IN_DERIVED_CONSTRUCTOR;
    check(eval(constructor), &[("super()", "")]);
    let message = "Unexpected identifier 'arguments'. arguments is not valid in this context.";
    check(
        eval(EvalContext::IN_FIELD_INITIALIZER),
        &[("() => arguments", message)],
    );
}

#[test]
fn parameters_end_where_they_are_said_to() {
    let goal = |end| Goal::SingleFunction {
        parameters_end: Some(end),
    };
    check(goal(13), &[("function a(b) {}", "")]);
    let message =
        "Parameters should match arguments offered as parameters in Function constructor.";
    check(goal(15), &[("function a() {/*) {*/}", message)]);
}

#[test]
fn the_first_error_counts_however_often_the_code_was_read() {
    let nested = [
        "[a=".repeat(8),
        " ".repeat(5000),
        "b".into(),
        "]=c".repeat(8),
    ]
    .concat();
    for (rest, message) in [
        (
            "({ a = 1 }); b(",
            "Unexpected token '='. Expected a ':' following the property name 'a'.",
        ),
        (
            "class A { static { ((eval)) = 1 } }",
            "Cannot modify 'eval' in strict mode.",
        ),
        (
            "class A { static { ({ await }) => 1 } }",
            "Cannot use 'await' as a shorthand property name in a static block.",
        ),
    ] {
        check(
            SCRIPT,
            &[(rest, message), (&format!("{nested}; {rest}"), message)],
        );
    }
}

#[test]
fn place_and_recovery() {
    for (source, token, offset, recovery) in [
        ("a b", 2..3, 3, Recovery::Irrecoverable),
        ("a(", 2..2, 2, Recovery::Recoverable),
        ("'a", 0..2, 2, Recovery::UnterminatedLiteral),
        ("`a\n", 0..3, 3, Recovery::Recoverable),
        ("a(`b\n", 2..3, 3, Recovery::Irrecoverable),
    ] {
        let error = error_of(source, SCRIPT).unwrap();
        assert_eq!(
            (error.kind, error.token, error.offset, error.recovery),
            (ErrorKind::Syntax, token, offset, recovery),
            "{source}"
        );
    }
}
