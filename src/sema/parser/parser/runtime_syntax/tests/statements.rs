use super::*;
use crate::parser::oxc::{returns_in_static_block, statements_in_ambient_context};
use DiagnosticClass::{EarlyError, Semantic, TypeScriptGrammar};

#[test]
fn with_statement() {
    let text = "with (a) b;";
    let (file, scratch) = parsed(text, typescript());
    let StmtKind::With { object, body } = file[file.id_at(file.body, 0)].kind else {
        panic!("not a `With`");
    };
    let a = scratch.atoms(text.as_bytes()).intern(b"a");
    assert!(matches!(file[object].kind, ExprKind::Ident(name) if name == a));
    assert!(matches!(file[body].kind, StmtKind::Expr(_)));
    assert_eq!((file.stmts.len(), file.with_bodies.len()), (2, 1));
    assert!(classes_of(text, typescript(), 1101).is_empty());
    let (file, _) = parsed("{ a; b }", typescript());
    assert!(matches!(
        file[file.id_at(file.body, 0)].kind,
        StmtKind::Block(_)
    ));
    assert!(file.with_bodies.is_empty());
}

#[test]
fn directives() {
    for (text, directives, is_strict_if_kept, is_strict_if_dropped) in [
        (r#"function f() { "a"; 'use strict'; x }"#, 2, true, false),
        (r#"function f() { "a"; x }"#, 1, false, false),
        (r#"() => { "use strict" }"#, 1, true, false),
        (r#"({ m() { "use strict" } })"#, 1, true, false),
        (r#"function f() { ("use strict") }"#, 0, false, false),
        ("function f() { `use strict` }", 0, false, false),
        (r#"function f() { "use strict" + 1 }"#, 0, false, false),
        (r#"function f() { x; "use strict" }"#, 0, false, false),
        (r#"function f() { { "use strict" } }"#, 0, false, false),
        (r#"function f() { "use\x20strict" }"#, 1, false, false),
        (r#"namespace N { "use strict"; () => 1 }"#, 0, false, false),
        (r#"class A { static { "use strict" } }"#, 0, true, true),
        (r#"class A { m() { "use strict" } }"#, 1, true, true),
    ] {
        for (keeps_function_directives, is_strict) in
            [(true, is_strict_if_kept), (false, is_strict_if_dropped)]
        {
            let options = Options {
                compiles: true,
                keeps_function_directives,
                ..typescript()
            };
            let (file, _) = parsed(text, options);
            let is_directive = |it: &&Stmt| matches!(it.kind, StmtKind::Directive { .. });
            let found = file.stmts.iter().filter(is_directive).count();
            assert_eq!(found, directives, "{text}");
            assert_eq!(file.fns[0].is_strict, is_strict, "{text}");
            assert_eq!(file.fns[0].is_strict_by_syntax, is_strict, "{text}");
        }
    }
}

#[test]
fn directives_of_file() {
    for (text, raws, is_strict) in [
        (
            r#""use strict"; "b"; c; "d";"#,
            &["use strict", "b"][..],
            true,
        ),
        (r#""a"; 'use strict';"#, &["a", "use strict"][..], true),
        (r"'use\x20strict';", &[r"use\x20strict"][..], false),
        (r#"("use strict");"#, &[][..], false),
        (r#"x; "use strict";"#, &[][..], false),
    ] {
        let (file, scratch) = parsed(text, typescript());
        let atoms = scratch.atoms(text.as_bytes());
        let found: Vec<&str> = (file.directives(file.body))
            .map(|directive| atom_text(&atoms, directive.1))
            .collect();
        assert_eq!(found, raws, "{text}");
        assert_eq!(file.is_strict, is_strict, "{text}");
        assert_eq!(file.is_strict_by_syntax, is_strict, "{text}");
    }
    let json = Options {
        is_javascript: true,
        is_json: true,
        ..typescript()
    };
    let (file, _) = parsed(r#""use strict""#, json);
    assert_eq!(file.directives(file.body).count(), 0);
}

#[test]
fn module_declaration_makes_file_strict() {
    let javascript = compiled_javascript();
    for (text, options, is_strict) in [
        ("export {}", typescript(), true),
        ("export const a = 1", typescript(), true),
        ("export default 1", typescript(), true),
        (r#"import a from "m""#, typescript(), false),
        (r#"import a from "m""#, javascript, true),
        (r#"import "m""#, javascript, true),
        ("a", javascript, false),
        ("import.meta", javascript, false),
    ] {
        let (file, _) = parsed(text, options);
        assert_eq!(file.is_strict_by_syntax, is_strict, "{text}");
    }
}

#[test]
fn checker_owns_strict_mode_errors() {
    let texts = [
        "with (a) b",
        "function f() { with (a) b }",
        r#""use strict"; with (a) b"#,
        r#"function f() { "use strict"; with (a) b }"#,
        "class A { m() { with (a) b } }",
        "delete x",
        "function f(a = delete x) {}",
        "(a = delete x) => a",
        r#""use strict"; delete x"#,
        "class A { m() { delete x } }",
        "class A { x = delete y }",
        "class A { [delete x]() {} }",
        "class A extends f(delete x) {}",
        "var eval",
        "function arguments() {}",
        "function f(eval) {}",
        "eval => 1",
        "({ eval }) => 1",
        "try {} catch (arguments) {}",
        r#"import eval from "a""#,
        r#"function eval() { "use strict" }"#,
        r#""use strict"; var { eval } = a"#,
        r#""use strict"; eval = 1"#,
        r#""use strict"; [{ a: arguments }] = b"#,
        "class eval {}",
    ];
    for code in [1100, 1101, 1102] {
        expect_compiled(code, &[], &texts);
    }
}

#[test]
fn legacy_octal_forms() {
    let forms = [
        (1121, "010"),
        (1489, "08"),
        (1487, r#"x = "\101""#),
        (1488, r#"x = "\8""#),
    ];
    let mut linted_javascript = compiled_javascript();
    linted_javascript.compiles = false;
    for (code, form) in forms {
        let strict = format!("\"use strict\"; {form}");
        let in_class = format!("class A {{ static {{ {form} }} }}");
        expect_compiled(code, &[], &[form, strict.as_str(), in_class.as_str()]);
        let found = classes_of(form, linted_javascript, code);
        assert_eq!(found, [TypeScriptGrammar], "{form}");
    }
}

#[test]
fn attributes() {
    let text = r#"import a from "m" with { type: "json" };
        export { b } from "m" with { type: "json" };
        export * from "m" with { type: "json" };
        import "m"; export { a }; export * from "m""#;
    let (file, _) = parsed(text, typescript());
    let [(_, first), (_, second), (_, third)] = file.import_attributes[..] else {
        panic!("not three `with` clauses");
    };
    assert!(matches!(file[first].kind, ExprKind::Object(it) if it.len() == 1));
    assert_eq!(file.imports[0].attributes, first);
    assert_eq!(file.exports[0].attributes, second);
    let export_star = file.id_at(file.body, 2);
    assert_eq!(file.export_star_attributes, [(export_star, third)]);
    assert_eq!(file.statement_import_attributes(export_star), third);
    assert!(file.imports[1].attributes.is_none() && file.exports[1].attributes.is_none());
    let plain_export_star = file.id_at(file.body, 5);
    assert!(
        file.statement_import_attributes(plain_export_star)
            .is_none()
    );

    let text = r#"import a from "m" assert { type: "json" }"#;
    let is_parse_error = |it: &&Diagnostic| it.kind == DiagnosticKind::Parse;
    let (file, _) = parsed(text, compiled_javascript());
    assert!(file.imports[0].attributes.is_some());
    assert_eq!(file.diagnostics.iter().filter(is_parse_error).count(), 0);
    expect_compiled(2880, &[TypeScriptGrammar], &[text]);
    let mut options = typescript();
    options.recovers = true;
    let (file, _) = parsed(text, options);
    assert_eq!(file.diagnostics.iter().filter(is_parse_error).count(), 1);
}

#[test]
fn diagnostic_classes() {
    for (text, code, class) in [
        ("switch (a) { default: default: }", 1113, EarlyError),
        ("let [...a,] = b", 1013, EarlyError),
        ("let { ...a, } = b", 1013, EarlyError),
        (r#"export { "a" as b }"#, 1003, EarlyError),
        ("class A<> {}", 1098, TypeScriptGrammar),
        ("type A = [a: ...B[]];", 5087, TypeScriptGrammar),
        (
            "interface A { [a: string, b: string]: C }",
            1096,
            TypeScriptGrammar,
        ),
        ("interface A { get a() {} }", 1183, TypeScriptGrammar),
        ("type A = import(B);", 1141, Semantic),
    ] {
        let found = classes_of(text, typescript(), code);
        assert_eq!(found, [class], "{text}");
    }
    assert!(classes_of("type A = [a: B[]];", typescript(), 5087).is_empty());
    assert!(classes_of("type A = import('b');", typescript(), 1141).is_empty());
}

#[test]
fn type_annotation_in_javascript() {
    let javascript = Options {
        is_javascript: true,
        ..typescript()
    };
    let (file, _) = parsed("let a: number;", javascript);
    let [error] = &file.diagnostics[..] else {
        panic!("{:?}", file.diagnostics);
    };
    assert_eq!(error.kind, DiagnosticKind::Js);
    assert_eq!(error.code, 8010);
    assert_eq!(error.class, EarlyError);
    assert!(
        parsed("let a: number;", typescript())
            .0
            .diagnostics
            .is_empty()
    );
}

fn count_of_oxc(file: &FileBuilder, code: u32) -> usize {
    let is_match = |it: &&Diagnostic| it.kind == DiagnosticKind::Oxc && it.code == code;
    file.diagnostics.iter().filter(is_match).count()
}

fn ambient_statement_errors(text: &str) -> usize {
    let options = Options {
        is_declaration_file: true,
        ..typescript()
    };
    let (mut file, _) = parsed(text, options);
    let body = file.body;
    statements_in_ambient_context(&mut file, text.as_bytes(), body);
    count_of_oxc(&file, 1036)
}

fn static_block_return_errors(text: &str) -> usize {
    let (mut file, _) = parsed(text, typescript());
    let mut functions = file.fns.iter();
    let block = functions.find(|it| it.kind == FnKind::StaticBlock);
    let body = block.unwrap().body;
    returns_in_static_block(&mut file, body);
    count_of_oxc(&file, 18041)
}

#[test]
fn directives_in_declaration_file() {
    for (text, errors) in [
        ("'a'; 'b'; declare const c: number;", 0),
        ("('a'); declare const c: number;", 0),
        ("`a`; declare const c: number;", 1),
        ("declare const c: number; 'a';", 1),
        ("with (a) b;", 1),
    ] {
        assert_eq!(ambient_statement_errors(text), errors, "{text}");
    }
}

#[test]
fn return_in_with_in_static_block() {
    for (text, errors) in [
        ("class A { static { with (a) return; } }", 1),
        ("class A { static { with (a) (() => { return; }); } }", 0),
    ] {
        assert_eq!(static_block_return_errors(text), errors, "{text}");
    }
}
