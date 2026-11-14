use super::*;
use DiagnosticClass::{EarlyError, TypeScriptGrammar};

#[track_caller]
fn expect_class(class: DiagnosticClass, cases: &[(u32, &str)]) {
    let options = Options {
        compiles: true,
        ..typescript()
    };
    for &(code, text) in cases {
        assert_eq!(classes_of(text, options, code), [class], "{text}");
    }
}

#[test]
fn mistake_in_a_type_that_bun_run_rejects_is_an_early_error() {
    expect_class(
        EarlyError,
        &[
            (1096, "interface A { [a: string, b: string]: number }"),
            (1096, "class A { [a: string, b: string]: number }"),
            (1096, "interface A { []: number }"),
            (1025, "interface A { [a: string,]: number }"),
            (1017, "interface A { [...a: string[]]: number }"),
            (1018, "interface A { [public a: string]: number }"),
            (1019, "interface A { [a?: string]: number }"),
            (1020, "interface A { [a: string = \"\"]: number }"),
            (1022, "interface A { [a,]: number }"),
            (5087, "type A = [first: ...string[]];"),
            (5086, "type A = [first: string?];"),
            (1172, "interface A extends B extends C {}"),
            (1009, "interface A extends B, {}"),
            (1097, "interface A extends {}"),
            (1099, "interface A extends B<> {}"),
            (1099, "class A implements B<> {}"),
            (1009, "class A implements B<number,> {}"),
            (1099, "let a: Array<>;"),
            (1009, "let a: Array<number,>;"),
            (1183, "interface A { get a() { return 1; } }"),
            (1183, "type A = { get a() { return 1; } };"),
            (8020, "let a: *;"),
        ],
    );
}

#[test]
fn mistake_in_a_type_that_bun_run_reads_over_is_one_of_grammar() {
    expect_class(
        TypeScriptGrammar,
        &[
            (7061, "type A = { [K in \"a\"]: number; b: string };"),
            (5085, "type A = [...rest?: string[]];"),
            (1099, "f<>();"),
            (1009, "f<number,>();"),
        ],
    );
}
