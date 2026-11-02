use crate::{Options, Scratch};
use bun_sema_standalone as _;

fn pure_calls(text: &str) -> Vec<bool> {
    let mut scratch = Scratch::default();
    let parsed = crate::parse_with_own_atoms(text.as_bytes(), Options::default(), &mut scratch);
    let file = parsed.unwrap().file;
    file.calls.iter().map(|call| call.is_pure).collect()
}

#[track_caller]
fn expect(cases: &[(&str, &[bool])]) {
    for &(text, expected) in cases {
        assert_eq!(pure_calls(text), expected, "{text}");
    }
}

#[test]
fn chain_that_ends_in_call() {
    expect(&[
        ("/* @__PURE__ */ f()", &[true]),
        ("/*#__PURE__*/ new A", &[true]),
        ("/* #__PURE__ */ new A()", &[true]),
        ("/* @__PURE__ */ a().b()", &[true, true]),
        ("/* @__PURE__ */ a.b.c()", &[true]),
        ("/* @__PURE__ */ a?.()", &[true]),
        ("/* @__PURE__ */ a()!", &[true]),
        ("/* @__PURE__ */ new A()()", &[true, true]),
        ("x = /* @__PURE__ */ f()", &[true]),
        ("x = /* @__PURE__ */ f(g())", &[false, true]),
        ("f(/* @__PURE__ */ g())", &[true, false]),
        ("(/* @__PURE__ */ f())", &[true]),
    ]);
}

#[test]
fn chain_that_ends_in_something_else() {
    expect(&[
        ("/* @__PURE__ */ a().b", &[false]),
        ("/* @__PURE__ */ a()[0]", &[false]),
        ("/* @__PURE__ */ a().b().c", &[false, false]),
        ("/* @__PURE__ */ new A().b", &[false]),
        ("/* @__PURE__ */ f`t`", &[false]),
        ("/* @__PURE__ */ a()`t`", &[false, false]),
    ]);
}

#[test]
fn parentheses_end_chain() {
    expect(&[
        ("/* @__PURE__ */ (a)(b)", &[true]),
        ("/* @__PURE__ */ (f())()", &[false, true]),
        ("/* @__PURE__ */ (f()).b", &[false]),
        ("/* @__PURE__ */ (/* @__PURE__ */ f()).b", &[true]),
    ]);
}

#[test]
fn chain_in_parentheses() {
    expect(&[
        ("/* @__PURE__ */ (f())", &[true]),
        ("/* @__PURE__ */ ((f()))", &[true]),
        ("/* @__PURE__ */ ( /* c */ f())", &[true]),
        ("/* @__PURE__ */ (\n// c\nf())", &[true]),
        ("/* @__PURE__ */ (f())!", &[true]),
        ("/* @__PURE__ */ (new A)", &[true]),
        ("/* @__PURE__ */ (a().b())", &[true, true]),
        ("/* @__PURE__ */ (f(), g())", &[false, false]),
        ("/* @__PURE__ */ (f() + 1)", &[false]),
        ("/* @__PURE__ */ (f().b)", &[false]),
    ]);
}

#[test]
fn annotation_is_before_first_token() {
    expect(&[
        ("f()", &[false]),
        ("new /* @__PURE__ */ A()", &[false]),
        ("a./* @__PURE__ */ b()", &[false]),
        ("/* @__PURE__ */\nf()", &[true]),
        ("/* @__PURE__ */ -f()", &[false]),
        ("/* @__PURE__ */ f() + /* @__PURE__ */ g()", &[true, true]),
    ]);
}

#[test]
fn any_comment_before_token() {
    expect(&[
        ("/* @__PURE__ */ /* x */ f()", &[true]),
        ("/* x */ /* @__PURE__ */ f()", &[true]),
        ("/* @__PURE__ */ /* @__PURE__ */ f()", &[true]),
        ("/* @__PURE__ */ // x\nf()", &[true]),
        ("// @__PURE__\n// x\nf()", &[true]),
        ("/* @__PURE__ */ a; /* x */ f()", &[false]),
        ("/* x */ f(/* @__PURE__ */ /* x */ g())", &[true, false]),
    ]);
}

#[test]
fn block_comment() {
    expect(&[
        ("/* @__PURE__ f */ g()", &[true]),
        ("/* f @__PURE__ */ g()", &[true]),
        ("/** @__PURE__ */ g()", &[true]),
        ("/**\n * @__PURE__\n */\ng()", &[true]),
        ("/*! #__PURE__ */ g()", &[true]),
        ("/* @__PURE__: f */ g()", &[true]),
        ("/* f@__PURE__ */ g()", &[true]),
        ("/* @@__PURE__ */ g()", &[true]),
        ("/* @a #b @__PURE__ */ g()", &[true]),
        ("/* @__PURE__f */ g()", &[false]),
        ("/* @__PURE__$ */ g()", &[false]),
        ("/* @__PURE__\u{e9} */ g()", &[false]),
        ("/* @ __PURE__ */ g()", &[false]),
        ("/* @__pure__ */ g()", &[false]),
        ("/* __PURE__ */ g()", &[false]),
        ("/*@*/ g()", &[false]),
        ("/**/ g()", &[false]),
    ]);
}

#[test]
fn line_comment() {
    expect(&[
        ("// @__PURE__\nf()", &[true]),
        ("//#__PURE__\nf()", &[true]),
        ("//\t @__PURE__ x\nf()", &[true]),
        ("// @__PURE__\r\nf()", &[true]),
        ("// x @__PURE__\nf()", &[false]),
        ("// # @__PURE__\nf()", &[false]),
        ("/// @__PURE__\nf()", &[false]),
        ("// @__PURE__x\nf()", &[false]),
        ("// @@__PURE__\nf()", &[false]),
        ("// `/*#__PURE__*/`\nf()", &[false]),
        ("// \u{4f60} #__PURE__\nf()", &[false]),
        ("// #__PURE__ \u{4e16}\nf()", &[true]),
        ("f(//#__PURE__\n1)", &[false]),
        ("f() // @__PURE__", &[false]),
    ]);
}
