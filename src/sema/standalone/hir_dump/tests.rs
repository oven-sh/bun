use super::*;
use bun_core::strings::{index_of, index_of_char_usize};
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile, summarize};

fn tree(path: &str, text: &str) -> String {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let (path, arena) = (path.as_bytes(), session.arena());
    let mut file = summarize(arena, path, None, text.as_bytes(), &atoms, false, false);
    file.text = text.as_bytes().to_vec().into();
    dump_and_orphans(&file, &atoms).0
}

fn parse_compiled<'s>(
    session: &'s Session,
    atoms: &Interner<'s>,
    path: &str,
    text: &str,
) -> File<'s> {
    let options = CompileParseOptions {
        path: path.as_bytes(),
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: true,
        keeps_function_directives: false,
    };
    let mut file = parse_for_compile(session.arena(), &options, text.as_bytes(), atoms);
    file.text = text.as_bytes().to_vec().into();
    file
}

fn compiled(path: &str, text: &str) -> String {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let file = parse_compiled(&session, &atoms, path, text);
    dump_and_orphans(&file, &atoms).0
}

fn count(dump: &str, text: &str) -> usize {
    let mut rest = dump.as_bytes();
    let mut occurrences = 0;
    while let Some(at) = index_of(rest, text.as_bytes()) {
        rest = &rest[at + text.len()..];
        occurrences += 1;
    }
    occurrences
}

#[track_caller]
fn assert_count(dump: &str, text: &str, expected: usize) {
    assert_eq!(count(dump, text), expected, "{text:?} in:\n{dump}");
}

#[track_caller]
fn assert_contains(dump: &str, text: &str) {
    assert!(count(dump, text) > 0, "{text:?} is not in:\n{dump}");
}

#[track_caller]
fn assert_absent(dump: &str, text: &str) {
    assert_count(dump, text, 0);
}

#[track_caller]
fn line_from<'a>(dump: &'a str, text: &str) -> &'a str {
    let Some(start) = index_of(dump.as_bytes(), text.as_bytes()) else {
        panic!("{text:?} is not in:\n{dump}");
    };
    let rest = &dump[start..];
    &rest[..index_of_char_usize(rest.as_bytes(), b'\n').unwrap_or(rest.len())]
}

#[test]
fn regex_pattern_and_flags() {
    let dump = tree("a.ts", r"/a\/b/gi;");
    assert_contains(
        line_from(&dump, "Expr Regex"),
        r#" pattern="a\\/b" regex_flags="gi""#,
    );
    let dump = tree("a.ts", r#"x = "a/b";"#);
    assert_contains(&dump, "Expr String");
    assert_absent(&dump, "pattern=");
}

#[test]
fn with_statement() {
    let dump = tree("a.js", "with (a) b;");
    assert_contains(&dump, "Stmt With");
    assert_contains(&dump, "object: Expr Ident");
    assert_contains(&dump, "body: Stmt Expr");
    assert_absent(&dump, "Stmt Block");
    let dump = tree("a.js", "{ a; b; }");
    assert_contains(&dump, "Stmt Block");
    assert_absent(&dump, "Stmt With");
}

#[test]
fn directive_prologue() {
    let dump = tree("a.js", r#""use strict"; "b"; a; "c";"#);
    assert_count(&dump, "Stmt Directive", 2);
    assert_contains(&dump, r#" raw="use strict""#);
    assert_contains(&dump, r#" raw="b""#);
    assert_absent(&dump, r#" raw="c""#);
    assert_count(&dump, "Stmt Expr", 2);
    assert_absent(&tree("a.js", r#"("use strict");"#), "Directive");
}

#[test]
fn jsx_text() {
    let dump = tree("a.tsx", "<a>x &amp; y</a>;");
    assert_contains(line_from(&dump, "Expr JsxText"), r#" "x & y""#);
    let dump = tree("a.tsx", r#"<a>{"x"}</a>;"#);
    assert_contains(&dump, "Expr String");
    assert_absent(&dump, "JsxText");
}

#[test]
fn jsx_attribute_text() {
    let dump = tree("a.tsx", r#"<a b="&amp;"/>;"#);
    let line = line_from(&dump, "jsx_attribute_text pos=");
    assert!(line.ends_with(r#" "&""#), "{line:?} in:\n{dump}");
    assert_absent(&tree("a.tsx", r#"<a b="c"/>;"#), "jsx_attribute_text");
}

#[test]
fn template_parts() {
    let dump = tree("a.ts", "`a`;");
    assert_contains(&dump, " flags=ExprFlags(TEMPLATE_LITERAL)");
    assert_absent(&dump, "parts=");
    assert_contains(&tree("a.ts", r"f`a\u`;"), r#" parts=[(-, "a\\u")]"#);
    assert_contains(
        &tree("a.ts", "`a${b}c`;"),
        r#" parts=[("a", "a"), ("c", "c")]"#,
    );
    assert_absent(&tree("a.ts", r#""a";"#), "flags=");
}

#[test]
fn expression_flags() {
    let dump = tree("a.ts", "(a)[b]?.c;");
    assert_contains(
        line_from(&dump, "Expr Dot"),
        " flags=ExprFlags(OPTIONAL_CHAIN_LINK) ",
    );
    assert_contains(
        line_from(&dump, "Expr Index"),
        " flags=ExprFlags(BRACKET_ACCESS) ",
    );
    assert_contains(
        line_from(&dump, "obj: Expr Ident"),
        r#" flags=ExprFlags(PARENTHESIZED) "a""#,
    );
    assert_absent(line_from(&dump, "index: Expr Ident"), "flags=");
}

#[test]
fn pure_calls() {
    let dump = tree("a.ts", "/* @__PURE__ */ f(); g();");
    assert_count(&dump, " is_pure=true", 1);
    assert_count(&dump, " is_pure=false", 1);
}

#[test]
fn import_attributes() {
    let dump = tree(
        "a.ts",
        r#"import a from "a" with { type: "json" }; export * from "b";"#,
    );
    assert_contains(&dump, "\n      attributes: Expr Object");
    assert_absent(&dump, "\n      attributes: -\n");
    assert_contains(&dump, "\n    attributes: -\n");
    assert_absent(&dump, "\n    attributes: Expr Object");
}

#[test]
fn function_strictness() {
    let dump = tree(
        "a.js",
        "class A { m() { function g() {} } } function h() {}",
    );
    assert_count(&dump, " is_strict=true is_strict_by_syntax=true", 2);
    assert_count(&dump, " is_strict=false is_strict_by_syntax=false", 1);
    assert_contains(&dump, "\nis_strict: false is_strict_by_syntax=false\n");
    let dump = compiled("a.js", r#"function f() { "use strict"; function g() {} }"#);
    assert_count(&dump, " is_strict=false is_strict_by_syntax=false", 2);
    assert_absent(&dump, " is_strict=true");
}

#[test]
fn text_start() {
    let dump = tree("a.ts", "export function f() {} export class C {}");
    assert_contains(line_from(&dump, "Func kind="), " start=0 text_start=7 ");
    let class = line_from(&dump, "Class name=");
    assert_contains(class, " start=23 text_start=30");
}

#[test]
fn typed_version() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let mut file = parse_compiled(&session, &atoms, "a.ts", "");
    let dump = dump_and_orphans(&file, &atoms).0;
    assert_contains(&dump, "\nis_typed_version: false\n");
    file.is_typed_version = true;
    let dump = dump_and_orphans(&file, &atoms).0;
    assert_contains(&dump, "\nis_typed_version: true\n");
}

#[test]
fn diagnostic_class() {
    assert_contains(
        &tree("a.ts", "switch (a) { default: default: }"),
        " 1113 EarlyError\n",
    );
    assert_contains(&tree("a.ts", "class A<> {}"), " 1098 TypeScriptGrammar\n");
    assert_contains(&tree("a.js", "010;"), " 1121 EarlyError\n");
}

#[test]
fn legacy_octal_in_compiled_javascript() {
    let forms = [
        (" 1121 ", "010"),
        (" 1487 ", r#"x = "\101""#),
        (" 1488 ", r#"x = "\8""#),
    ];
    for (code, form) in forms {
        for text in [
            format!("{form};"),
            format!("\"use strict\"; {form};"),
            format!("class A {{ static {{ {form}; }} }}"),
            format!("{form}; export {{}};"),
        ] {
            assert_absent(&compiled("a.js", &text), code);
        }
    }
}

#[test]
fn bigint_names() {
    let dump = tree("a.ts", "({ 0x10n: a });");
    assert_contains(&dump, "\nbigint_name pos=3 \"16\"\n");
    assert_absent(&tree("a.ts", "({ 16: a });"), "bigint_name");
}
