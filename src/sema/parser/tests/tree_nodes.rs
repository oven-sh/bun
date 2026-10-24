mod tree_strictness;
mod tree_support;
use tree_support::*;

use DiagnosticClass::EarlyError;
use ExprSelector::{Dot, Tag};

const DEFAULT_PATH: &str = "a.cjs";
const INVALID_CHARACTER: u32 = 1127;

const NO_FLAGS: ExprFlags = ExprFlags::empty();
const PARENTHESIZED: ExprFlags = ExprFlags::PARENTHESIZED;
const BRACKET_ACCESS: ExprFlags = ExprFlags::BRACKET_ACCESS;
const OPTIONAL_CHAIN_LINK: ExprFlags = ExprFlags::OPTIONAL_CHAIN_LINK;
const PRIVATE_NAME: ExprFlags = ExprFlags::PRIVATE_NAME;
const TEMPLATE_LITERAL: ExprFlags = ExprFlags::TEMPLATE_LITERAL;
const PARENTHESIZED_LINK: ExprFlags = OPTIONAL_CHAIN_LINK.union(PARENTHESIZED);
const BRACKET_LINK: ExprFlags = OPTIONAL_CHAIN_LINK.union(BRACKET_ACCESS);

#[derive(Copy, Clone, Debug)]
enum ExprSelector {
    Tag(ExprTag),
    Dot(&'static str),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum TextKind {
    String,
    JsxText,
    MemberName,
}

type PartTexts<'a> = (Option<&'a str>, &'a str);

const REGEXES: &str = r"x = /a\/[/]b/gi; y = /a/; z = a / b / c;";

const JSX_CHILDREN: &[(&str, &[&str], &[&str])] = &[
    (
        "const e = <a>  x\n   y &amp; z  </a>;",
        &["  x y & z  "],
        &[],
    ),
    ("const e = <a>\n  <b/>\n</a>;", &[], &[]),
    (r#"const e = <a>{"s"}</a>;"#, &[], &["s"]),
    ("const e = <a-b/>;", &[], &["a-b"]),
    ("const e = <a>x:y</a>;", &["x:y"], &[]),
];

const JSX_ATTRIBUTES: &str = r#"const e = <a b="&amp;&#65;&bogus;" c="d"/>;"#;

const JSX_ATTRIBUTE_TEXTS: &[(&str, &str)] = &[
    ("const e = <a b=\"é\n  x\"/>;", "é x"),
    ("const e = <a b=\"a &amp;\n  b\"/>;", "a & b"),
    ("const e = <a b=\"a\\u\n  b\"/>;", "a\\u b"),
    ("const e = <a b=\"a\n  b\"/>;", "a\n  b"),
    (r#"const e = <a b=/**/"x\ty"/>;"#, r"x\ty"),
];

const WITH_AND_BLOCKS: &str = "with (a) b; { a; b; } { withdraw; b; }";

const TYPEDEF_BEFORE_DIRECTIVE: &str =
    r#"/** @typedef {number} N */ "use strict"; function f() {}"#;

const PRIVATE_NAMES: &str = "class A { #x; m() { this.#x; #x in this; } }";

const FLAGS: &[(&str, ExprSelector, ExprFlags)] = &[
    ("(a);", Tag(ExprTag::Ident), PARENTHESIZED),
    ("a;", Tag(ExprTag::Ident), NO_FLAGS),
    ("a[0];", Tag(ExprTag::Index), BRACKET_ACCESS),
    ("a.b;", Dot("b"), NO_FLAGS),
    ("a?.b.c;", Dot("b"), OPTIONAL_CHAIN_LINK),
    ("a?.b.c;", Dot("c"), NO_FLAGS),
    ("(a?.b).c;", Dot("b"), PARENTHESIZED_LINK),
    ("(a?.b).c;", Dot("c"), NO_FLAGS),
    ("a?.[0];", Tag(ExprTag::Index), BRACKET_LINK),
    ("a?.();", Tag(ExprTag::Call), OPTIONAL_CHAIN_LINK),
    ("a.b();", Tag(ExprTag::Call), NO_FLAGS),
    (PRIVATE_NAMES, Dot("#x"), PRIVATE_NAME),
    (PRIVATE_NAMES, Tag(ExprTag::PrivateIdentifier), PRIVATE_NAME),
    (r##"a["#x"];"##, Tag(ExprTag::Index), BRACKET_ACCESS),
    (r##"a["#x"];"##, Tag(ExprTag::String), NO_FLAGS),
    ("`x`;", Tag(ExprTag::String), TEMPLATE_LITERAL),
    (r#"x = "x";"#, Tag(ExprTag::String), NO_FLAGS),
    ("f`x`;", Tag(ExprTag::String), TEMPLATE_LITERAL),
];

const NAMED_MEMBERS: &[&str] = &["a.b;", r#"a["b"];"#, "a[`b`];", r#"a[("b")];"#];
const PRIVATE_MEMBER: &str = "class A { #p; m() { this.#p; } }";

const TEMPLATE_PARTS: &[(&str, &[PartTexts<'static>])] = &[
    (
        r"x = `a\n${b}\u{41}`;",
        &[(Some("a\n"), r"a\n"), (Some("A"), r"\u{41}")],
    ),
    ("`a\r\nb${c}`;", &[(Some("a\nb"), "a\nb"), (Some(""), "")]),
    (r"f`\unicode`;", &[(None, r"\unicode")]),
    ("`a${b}`;", &[(Some("a"), "a"), (Some(""), "")]),
    ("f`x`;", &[(Some("x"), "x")]),
    ("`a`;", &[]),
];

const PURE_CALLS: &[(&str, bool)] = &[
    ("/* @__PURE__ */ f();", true),
    ("/*#__PURE__*/ new A;", true),
    ("x = /* @__PURE__ */ f();", true),
    ("/* @__PURE__ */ (a)(b);", true),
    ("f();", false),
    ("/* @__PURE__ */ /* x */ f();", true),
    ("// @__PURE__\nf();", true),
    ("/* @__PURE__ f */ g();", true),
    ("/* @__PURE__ */ (f());", true),
    ("/* @__PURE__ */ (f(), 1);", false),
];

const IMPORT_ATTRIBUTES: &str = r#"
import a from "a" with { type: "json" };
export { b } from "b" with { type: "x" };
export * from "c" with { type: "y" };
import "d";
import("e", { with: { type: "z" } });
import("f", { with: { type: 1 } });
"#;

const TOP_LEVEL_AWAITS: &[(&str, bool)] = &[
    ("await 1;", true),
    ("for await (const x of y);", true),
    ("await using a = b;", true),
    ("if (false) await 1;", true),
    ("async function f() { await 1; }", false),
    ("1;", false),
];

const PROLOGUE_AND_STATEMENT: &str = r#"function f() { "use strict"; 'a'; x; }"#;

const LITERAL_KINDS: &[(&str, Kind)] = &[
    ("f`x`;", Kind::NoSubstitutionTemplateLiteral),
    ("`x`;", Kind::NoSubstitutionTemplateLiteral),
    ("/a/g;", Kind::RegularExpressionLiteral),
];

const JSX_ELEMENT: &str = r#"const e = <a:b c="d">t{"s"}{`u`}<e-f/></a:b>;"#;

const JSX_STRING_KINDS: &[(&str, Kind)] = &[
    ("d", Kind::StringLiteral),
    ("s", Kind::StringLiteral),
    ("u", Kind::NoSubstitutionTemplateLiteral),
    ("e-f", Kind::Identifier),
];

const USE_STRICT_AFTER_DIRECTIVE: &str = r#"function f(a = 1) { "x"; "use strict"; }"#;

const BODIES_WITHOUT_USE_STRICT: &[&str] = &[
    r#"("use strict");"#,
    "`use strict`;",
    r#""use\x20strict";"#,
    r#"x; "use strict";"#,
];

const HTML_CLOSE_COMMENT: &str = "a\n--> b";

const ACCEPTED_JAVASCRIPT: &[&str] = &[
    r#"import a from "b"; module.exports = a;"#,
    "return 1;",
    "with (a) b;",
    "010;",
    "await 1;",
    "function f() { var await; }",
    r#"import a from "b" assert { type: "json" };"#,
];

const LEGACY_OCTAL_FORMS: &[&str] = &[
    "010;",
    "08;",
    r#"x = "\101";"#,
    r#"x = "\8";"#,
    r#""use strict"; 010;"#,
    r#"function f() { "use strict"; 010; }"#,
    "class A { x = 010; }",
    "export {}; 010;",
];

const REJECTED_JAVASCRIPT: &[&str] = &[
    "var;",
    "class {}",
    "let x: number;",
    "010; var;",
    "with (a) b; var;",
    r#"import a from "b" assert { type: "json" }; var;"#,
    "/** @typedef {number} 1x */ var;",
    "/** @param {string */ var;",
];

const JSDOC_COMMENTS: &[&str] = &[
    "/** @type {010} */ var a;",
    "/** @param {string */ function f(x) {}",
    "/** @typedef {{ a: <> }} T */",
    "/** @typedef {number} 1x */",
    r#"/** @param {import("a", { with: { x: 1 } })} a */ function f(a) {}"#,
    "/** @this {A} */ function f() {}",
    "/** @callback C @param {number} this */",
];

const STRICT_MODE_VIOLATIONS: &[&str] = &[
    "function f() { function g() { delete x; } }",
    r#"function f(a = delete x) { "use strict"; }"#,
    "const h = (a = delete x) => a;",
    "delete x;",
    "function f() {}\ndelete x;",
    "(delete x);",
    "function f() { with (a) b; }",
    "function f() { delete x; }",
    "function f() { var eval; }",
    "function f() { arguments = 1; }",
    "class A { x = delete y; }",
    "class A extends f(delete x) {}",
    r#""use strict"; with (a) b;"#,
];

const GRAMMAR_EARLY_ERRORS: &[(&str, u32)] = &[
    ("function f() { switch (a) { default: default: } }", 1113),
    ("a?.b`t`;", 1358),
    ("new.x;", 17012),
];

fn parsed(path: &str, text: &str, test: impl for<'s> FnOnce(&Workspace<'s>, &File<'s>) + Send) {
    parsed_source(&Source::new(path, text), test);
}

fn parsed_source(source: &Source<'_>, test: impl for<'s> FnOnce(&Workspace<'s>, &File<'s>) + Send) {
    with_workspace(|w| {
        let hir = w.parse(source);
        test(w, &hir);
        let (path, text) = (source.path, source_text(&hir));
        assert_eq!(hir.exprs.len(), hir.expr_flags.len(), "{path}: {text}");
        assert_eq!(hir.is_strict, hir.is_strict_by_syntax, "{path}: {text}");
        let is_as_parsed = |func: &Func| func.is_strict == func.is_strict_by_syntax;
        assert!(hir.fns.iter().all(is_as_parsed), "{path}: {text}");
    });
}

fn source_text<'a>(hir: &'a File<'_>) -> &'a str {
    std::str::from_utf8(&hir.text).unwrap()
}

#[track_caller]
fn only_expr(hir: &File<'_>, test: impl Fn(&ExprKind) -> bool) -> ExprId {
    let found = find_exprs(hir, test);
    assert_eq!(found.len(), 1, "{found:?} in {}", source_text(hir));
    found[0]
}

#[track_caller]
fn only_stmt(hir: &File<'_>, test: impl Fn(&StmtKind) -> bool) -> StmtId {
    let found = find_stmts(hir, test);
    assert_eq!(found.len(), 1, "{found:?} in {}", source_text(hir));
    found[0]
}

fn of_class<'a>(hir: &'a File<'_>, class: DiagnosticClass) -> Vec<&'a Diagnostic> {
    let has_class = |diagnostic: &&Diagnostic| diagnostic.class == class;
    hir.diagnostics.iter().filter(has_class).collect()
}

#[track_caller]
fn assert_none_of_class(hir: &File<'_>, class: DiagnosticClass) {
    let found = of_class(hir, class);
    assert!(found.is_empty(), "{found:?} in {}", source_text(hir));
}

fn kind_of(hir: &File<'_>, id: impl ToNode) -> Kind {
    hir.kind(hir.node(id))
}

fn atom_of(kind: &ExprKind, wanted: TextKind) -> Option<Atom> {
    let (found, atom) = match *kind {
        ExprKind::String(text) => (TextKind::String, text),
        ExprKind::JsxText(text) => (TextKind::JsxText, text),
        ExprKind::Dot { name, .. } => (TextKind::MemberName, name),
        _ => return None,
    };
    (found == wanted).then_some(atom)
}

fn texts<'a>(w: &'a Workspace<'_>, hir: &File<'_>, wanted: TextKind) -> Vec<&'a str> {
    let atoms = hir
        .exprs
        .iter()
        .filter_map(|expr| atom_of(&expr.kind, wanted));
    atoms.map(|atom| w.text(atom)).collect()
}

#[track_caller]
fn expr_with_text(w: &Workspace<'_>, hir: &File<'_>, wanted: TextKind, text: &str) -> ExprId {
    let text = w.atom(text);
    only_expr(hir, |kind| atom_of(kind, wanted) == Some(text))
}

fn is_jsx_text(kind: &ExprKind) -> bool {
    matches!(kind, ExprKind::JsxText(_))
}

fn is_block(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::Block(_))
}

#[track_caller]
fn select_expr(w: &Workspace<'_>, hir: &File<'_>, selector: ExprSelector) -> ExprId {
    match selector {
        Tag(tag) => only_expr(hir, |kind| kind.tag() == tag),
        Dot(name) => expr_with_text(w, hir, TextKind::MemberName, name),
    }
}

fn is_member(kind: &ExprKind) -> bool {
    matches!(kind, ExprKind::Dot { .. } | ExprKind::Index { .. })
}

fn is_template(kind: &ExprKind) -> bool {
    matches!(kind, ExprKind::Template { .. } | ExprKind::String(_))
}

fn is_literal(kind: &ExprKind) -> bool {
    matches!(kind, ExprKind::String(_) | ExprKind::Regex { .. })
}

fn is_call(kind: &ExprKind) -> bool {
    matches!(kind, ExprKind::Call(_) | ExprKind::New(_))
}

#[track_caller]
fn only_member_key(hir: &File<'_>) -> Option<(ExprId, MemberKey)> {
    hir.member_key(only_expr(hir, is_member))
}

#[track_caller]
fn only_with(hir: &File<'_>) -> (StmtId, ExprId, StmtId) {
    let with = only_stmt(hir, |kind| matches!(kind, StmtKind::With { .. }));
    let StmtKind::With { object, body } = hir[with].kind else {
        unreachable!()
    };
    (with, object, body)
}

#[track_caller]
fn only_template(hir: &File<'_>) -> ExprId {
    let tagged_call = |expr: &Expr| {
        let ExprKind::TaggedTemplate(call) = expr.kind else {
            return None;
        };
        Some(call)
    };
    let tagged_calls: Vec<CallId> = hir.exprs.iter().filter_map(tagged_call).collect();
    match tagged_calls[..] {
        [] => only_expr(hir, is_template),
        [call] => hir.template_of(call),
        _ => panic!("{tagged_calls:?} in {}", source_text(hir)),
    }
}

fn part_texts<'a>(w: &'a Workspace<'_>, parts: &[TemplatePart]) -> Vec<PartTexts<'a>> {
    let cooked_and_raw = |part: &TemplatePart| {
        let cooked = part.cooked.map(|cooked| w.text(cooked));
        (cooked, w.text(part.raw))
    };
    parts.iter().map(cooked_and_raw).collect()
}

#[track_caller]
fn property_value(hir: &File<'_>, props: Span<PropId>, key: Atom) -> ExprId {
    let has_key = |prop: &PropId| hir[*prop].key == PropKey::Name(key);
    let found: Vec<PropId> = props.iter().filter(has_key).collect();
    assert_eq!(found.len(), 1, "{found:?} in {}", source_text(hir));
    hir[found[0]].value
}

#[track_caller]
fn import_call_attributes(hir: &File<'_>, call: ExprId) -> ExprId {
    let ExprKind::ImportCall { args } = hir[call].kind else {
        panic!("{:?} is not an import call", hir[call].kind);
    };
    let options = hir[hir.id_at(args, 1)].kind;
    let ExprKind::Object(props) = options else {
        panic!("{options:?} is not an object literal");
    };
    property_value(hir, props, known::with)
}

#[track_caller]
fn block_of<'s>(w: &Workspace<'s>, hir: &File<'s>, name: &str) -> IdList<StmtId> {
    let FnBody::Block(statements) = hir[w.function(hir, name)].body else {
        panic!("the body of `{name}` is not a block");
    };
    statements
}

fn early_errors(hir: &File<'_>) -> Vec<(u32, u32)> {
    let mut errors: Vec<(u32, u32)> = of_class(hir, EarlyError)
        .iter()
        .map(|error| (error.start, error.code))
        .collect();
    errors.sort_unstable();
    errors
}

#[test]
fn regex() {
    parsed(DEFAULT_PATH, REGEXES, |w, hir| {
        let pattern_and_flags = |expr: &Expr| {
            let ExprKind::Regex { pattern, flags } = expr.kind else {
                return None;
            };
            Some((w.text(pattern), flags))
        };
        let found: Vec<_> = hir.exprs.iter().filter_map(pattern_and_flags).collect();
        assert_eq!(found, [(r"a\/[/]b", w.atom("gi")), ("a", known::empty)]);
    });
}

#[test]
fn jsx_text() {
    for &(text, jsx_texts, strings) in JSX_CHILDREN {
        parsed("a.tsx", text, |w, hir| {
            assert_eq!(texts(w, hir, TextKind::JsxText), jsx_texts, "{text}");
            assert_eq!(texts(w, hir, TextKind::String), strings, "{text}");
        });
    }
}

#[test]
fn jsx_attribute_text_is_decoded() {
    parsed("a.tsx", JSX_ATTRIBUTES, |w, hir| {
        let [element] = hir.jsx[..] else {
            panic!("{:?}", hir.jsx);
        };
        let with_entities = property_value(hir, element.attrs, w.atom("b"));
        let written = atom_of(&hir[with_entities].kind, TextKind::String);
        assert_eq!(written, Some(w.atom("&amp;&#65;&bogus;")));
        assert_eq!(w.text(hir.jsx_attribute_text(with_entities)), "&A&bogus;");

        let without_entities = property_value(hir, element.attrs, w.atom("c"));
        let written = atom_of(&hir[without_entities].kind, TextKind::String);
        assert_eq!(written, Some(hir.jsx_attribute_text(without_entities)));
        assert_eq!(hir.jsx_attribute_texts.len(), 1);
    });
    for &(text, expected) in JSX_ATTRIBUTE_TEXTS {
        parsed("a.tsx", text, |w, hir| {
            let [element] = hir.jsx[..] else {
                panic!("{:?}", hir.jsx);
            };
            let value = property_value(hir, element.attrs, w.atom("b"));
            assert_eq!(w.text(hir.jsx_attribute_text(value)), expected, "{text}");
        });
    }
}

#[test]
fn with_statement() {
    parsed(DEFAULT_PATH, WITH_AND_BLOCKS, |w, hir| {
        let (_, object, body) = only_with(hir);
        assert_eq!(object, w.ident(hir, "a", 0));
        assert_eq!(hir[body].kind.tag(), StmtTag::Expr);
        let blocks = find_stmts(hir, is_block);
        assert_eq!(blocks.len(), 2);
        assert_eq!(hir.with_bodies.len(), 1);
    });
}

#[test]
fn flags() {
    for &(text, selector, expected) in FLAGS {
        parsed(DEFAULT_PATH, text, |w, hir| {
            let found = hir.expr_flags(select_expr(w, hir, selector));
            assert_eq!(found, expected, "{selector:?} in {text}");
        });
    }
    parsed(DEFAULT_PATH, "(a?.b).c;", |w, hir| {
        let member = select_expr(w, hir, Dot("c"));
        let ExprKind::Dot { chain, .. } = hir[member].kind else {
            unreachable!()
        };
        assert_eq!(chain, Chain::No);
    });
}

#[test]
fn member_keys() {
    for &text in NAMED_MEMBERS {
        parsed(DEFAULT_PATH, text, |w, hir| {
            let expected = (w.ident(hir, "a", 0), MemberKey::Name(w.atom("b")));
            assert_eq!(only_member_key(hir), Some(expected), "{text}");
        });
    }
    parsed(DEFAULT_PATH, PRIVATE_MEMBER, |w, hir| {
        let this = only_expr(hir, |kind| kind.tag() == ExprTag::This);
        let expected = (this, MemberKey::PrivateName(w.atom("#p")));
        assert_eq!(only_member_key(hir), Some(expected));
    });
    parsed(DEFAULT_PATH, "a[0];", |w, hir| {
        let index = only_expr(hir, |kind| kind.tag() == ExprTag::Number);
        let expected = (w.ident(hir, "a", 0), MemberKey::Computed(index));
        assert_eq!(only_member_key(hir), Some(expected));
    });
    parsed(DEFAULT_PATH, "a[b];", |w, hir| {
        let index = w.ident(hir, "b", 0);
        let expected = (w.ident(hir, "a", 0), MemberKey::Computed(index));
        assert_eq!(only_member_key(hir), Some(expected));
    });
    parsed(DEFAULT_PATH, "a;", |w, hir| {
        assert_eq!(hir.member_key(w.ident(hir, "a", 0)), None);
    });
}

#[test]
fn template_parts_are_kept() {
    for &(text, expected) in TEMPLATE_PARTS {
        parsed(DEFAULT_PATH, text, |w, hir| {
            let parts = hir.template_parts(only_template(hir));
            assert_eq!(part_texts(w, parts), expected, "{text:?}");
        });
    }
    parsed(DEFAULT_PATH, "`a${b}`;", |_, hir| {
        let parts = hir.template_parts(only_template(hir));
        assert_eq!(parts[0].cooked, Some(parts[0].raw));
    });
}

#[test]
fn pure_calls() {
    for &(text, is_pure) in PURE_CALLS {
        parsed(DEFAULT_PATH, text, |_, hir| {
            let kind = hir[only_expr(hir, is_call)].kind;
            let (ExprKind::Call(call) | ExprKind::New(call)) = kind else {
                unreachable!()
            };
            assert_eq!(hir[call].is_pure, is_pure, "{text}");
        });
    }
}

#[test]
fn import_attributes() {
    parsed("a.mjs", IMPORT_ATTRIBUTES, |w, hir| {
        let type_of = |&attributes: &ExprId| {
            let value = hir.import_attribute(attributes, known::r#type);
            value.map(|text| w.text(text))
        };

        let declarations = hir.ids(hir.body).take(4);
        let attributes_of = |declaration| hir.statement_import_attributes(declaration);
        let attributes: Vec<ExprId> = declarations.map(attributes_of).collect();
        for &object in &attributes[..3] {
            assert_eq!(hir[object].kind.tag(), ExprTag::Object);
        }
        assert_eq!(attributes[3], ExprId::NONE);
        let types: Vec<Option<&str>> = attributes.iter().map(type_of).collect();
        assert_eq!(types, [Some("json"), Some("x"), Some("y"), None]);
        assert_eq!(hir.import_attribute(attributes[0], known::empty), None);

        let calls = find_exprs(hir, |kind| kind.tag() == ExprTag::ImportCall);
        let attributes_of = |&call: &ExprId| import_call_attributes(hir, call);
        let attributes: Vec<ExprId> = calls.iter().map(attributes_of).collect();
        let types: Vec<Option<&str>> = attributes.iter().map(type_of).collect();
        assert_eq!(types, [Some("z"), None]);
    });
}

#[test]
fn top_level_await() {
    for &(text, expected) in TOP_LEVEL_AWAITS {
        parsed("a.mjs", text, |_, hir| {
            assert_eq!(hir.has_top_level_await(), expected, "{text}");
        });
    }
}

#[test]
fn mentions() {
    parsed(DEFAULT_PATH, "a;", |_, hir| {
        assert!(hir.mentioned.is_empty());
        assert!(hir.may_mention(b"a"));
        assert!(hir.may_mention(b"b"));
    });
}

#[test]
fn node_kinds() {
    parsed(DEFAULT_PATH, "with (a) b;", |_, hir| {
        let (with, object, body) = only_with(hir);
        assert_eq!(kind_of(hir, with), Kind::WithStatement);
        assert_eq!(hir.expression(hir.node(with)), hir.node(object));
        assert_eq!(hir.parent(hir.node(object)), hir.node(with));
        assert_eq!(hir.parent(hir.node(body)), hir.node(with));
    });
    parsed(DEFAULT_PATH, "with ((a)) { b }", |_, hir| {
        let (with, object, _) = only_with(hir);
        let parentheses = hir.parent(hir.node(object));
        assert_eq!(hir.kind(parentheses), Kind::ParenthesizedExpression);
        assert_eq!(hir.expression(hir.node(with)), parentheses);
        assert_eq!(hir.parent(parentheses), hir.node(with));
    });
    parsed(DEFAULT_PATH, "{ a; b; }", |_, hir| {
        let block = only_stmt(hir, is_block);
        assert_eq!(kind_of(hir, block), Kind::Block);
    });
    parsed(DEFAULT_PATH, PROLOGUE_AND_STATEMENT, |w, hir| {
        let statements = hir.ids(block_of(w, hir, "f"));
        let kinds: Vec<Kind> = statements.map(|stmt| kind_of(hir, stmt)).collect();
        assert_eq!(kinds, [Kind::ExpressionStatement; 3]);
    });
    for &(text, kind) in LITERAL_KINDS {
        parsed(DEFAULT_PATH, text, |_, hir| {
            assert_eq!(kind_of(hir, only_expr(hir, is_literal)), kind, "{text}");
        });
    }
}

#[test]
fn jsx_node_kinds() {
    parsed("a.tsx", JSX_ELEMENT, |w, hir| {
        let child_text = only_expr(hir, is_jsx_text);
        assert_eq!(kind_of(hir, child_text), Kind::JsxText);
        for &(text, kind) in JSX_STRING_KINDS {
            let string = expr_with_text(w, hir, TextKind::String, text);
            assert_eq!(kind_of(hir, string), kind, "{text}");
        }
        let tag_name = Some(w.atom("a:b"));
        let tag_names = find_exprs(hir, |kind| atom_of(kind, TextKind::String) == tag_name);
        let kinds: Vec<Kind> = tag_names.iter().map(|&name| kind_of(hir, name)).collect();
        assert_eq!(kinds, [Kind::JsxNamespacedName; 2]);
    });
    parsed("a.tsx", "const e = <a>x:y</a>;", |_, hir| {
        let child_text = only_expr(hir, is_jsx_text);
        assert_eq!(kind_of(hir, child_text), Kind::JsxText);
    });
}

#[test]
fn use_strict_prologue() {
    parsed(DEFAULT_PATH, USE_STRICT_AFTER_DIRECTIVE, |w, hir| {
        let statements = block_of(w, hir, "f");
        let found = hir.find_use_strict_prologue(statements);
        assert_eq!(found, hir.id_at(statements, 1));
    });
    for &body in BODIES_WITHOUT_USE_STRICT {
        let text = format!("function f(a = 1) {{ {body} }}");
        parsed(DEFAULT_PATH, &text, |w, hir| {
            let found = hir.find_use_strict_prologue(block_of(w, hir, "f"));
            assert_eq!(found, StmtId::NONE, "{text}");
        });
    }
}

#[test]
fn ill_formed_text() {
    for path in ["a.ts", "a.tsx", "a.js"] {
        with_workspace(|w| {
            let text = b"x = \"a\xFFb\";";
            let value = |hir: &File<'_>| {
                let string = only_expr(hir, |kind| kind.tag() == ExprTag::String);
                let value = atom_of(&hir[string].kind, TextKind::String);
                value.map(|atom| w.atoms.bytes(atom).to_vec())
            };
            let compiled = w.parse(&Source::from_bytes(path, text));
            assert_eq!(value(&compiled), Some(b"a\xC3\xBFb".to_vec()), "{path}");
            assert!(
                compiled.diagnostics.is_empty(),
                "{path}: {:?}",
                compiled.diagnostics
            );
            let checked = w.parse_for_check(path, text);
            assert_eq!(value(&checked), Some(b"a\xFFb".to_vec()), "{path}");
        });
    }
}

#[test]
fn javascript_parses_like_bun_run() {
    for &text in ACCEPTED_JAVASCRIPT {
        parsed("a.js", text, |_, hir| {
            assert_none_of_class(hir, EarlyError);
            assert!(!hir.has_errors, "{text}");
        });
    }
    parsed("a.js", "await 1;", |_, hir| {
        assert!(hir.has_top_level_await());
    });
    for &text in REJECTED_JAVASCRIPT {
        with_workspace(|w| {
            let errors = |reads_jsdoc: bool| {
                let source = Source {
                    reads_jsdoc,
                    ..Source::new("a.js", text)
                };
                early_errors(&w.parse(&source))
            };
            assert!(!errors(true).is_empty(), "{text}");
            assert_eq!(errors(true), errors(false), "{text}");
        });
    }
}

#[test]
fn legacy_octal_forms() {
    for &text in LEGACY_OCTAL_FORMS {
        parsed("a.js", text, |_, hir| {
            assert!(hir.diagnostics.is_empty(), "{text}: {:?}", hir.diagnostics);
            assert_ne!(hir.rare_syntax & rare::LEGACY_OCTAL, 0, "{text}");
        });
    }
    let without_legacy_octal = [
        "x = '2024-01-08';",
        "x = 1; // 010",
        "x = 1; /* \\1 */",
        r#"x = "a\\1";"#,
        r#"x = "\0" + 10.05 + 0x01 + 0o01 + a01;"#,
    ];
    for text in without_legacy_octal {
        parsed("a.js", text, |_, hir| {
            assert_eq!(hir.rare_syntax & rare::LEGACY_OCTAL, 0, "{text}");
        });
    }
}

#[test]
fn html_like_comments() {
    parsed("a.js", HTML_CLOSE_COMMENT, |w, hir| {
        assert_eq!(hir.body.len(), 1);
        let statement = hir[hir.id_at(hir.body, 0)].kind;
        let StmtKind::Expr(expression) = statement else {
            panic!("{statement:?}");
        };
        assert_eq!(expression, w.ident(hir, "a", 0));
    });
    parsed("a.js", "a --> b;", |_, hir| {
        let comparison = only_expr(hir, |kind| kind.tag() == ExprTag::Binary);
        let ExprKind::Binary { op, .. } = hir[comparison].kind else {
            unreachable!()
        };
        assert_eq!(op, BinOp::Gt);
    });
    for text in ["a <!-- b", "a /* c */ <!-- b", "a\n<!-- b"] {
        parsed("a.js", text, |_, hir| {
            let errors = of_class(hir, EarlyError);
            let is_invalid_character = |error: &&Diagnostic| error.code == INVALID_CHARACTER;
            assert!(
                errors.iter().any(is_invalid_character),
                "{text}: {errors:?}"
            );
        });
    }
    with_workspace(|w| {
        let hir = w.parse_for_check("a.js", b"a <!--b");
        let is_invalid_character = |error: &Diagnostic| error.code == INVALID_CHARACTER;
        let has_invalid_character = hir.diagnostics.iter().any(is_invalid_character);
        assert!(!has_invalid_character, "{:?}", hir.diagnostics);
    });
}

#[test]
fn jsdoc_adds_no_early_error() {
    for &text in JSDOC_COMMENTS {
        parsed("a.js", text, |_, hir| {
            assert_none_of_class(hir, EarlyError);
            assert!(!hir.has_parse_diagnostics, "{text}");
        });
    }
}

#[test]
fn jsdoc_keeps_early_errors_of_code() {
    let documented_code = [
        "/** @type {010} */ var a = new.x;",
        "/** @type {(x: number) => void} */ var a = new.x;",
        "/** @param {(x: number) => void} a */ function f(a) { new.x }",
        "/** @typedef {number} 1x */\nfunction f() { switch (a) { default: default: } }",
    ];
    for text in documented_code {
        parsed("a.js", text, |_, hir| {
            let errors = of_class(hir, EarlyError);
            assert_eq!(errors.len(), 1, "{text}: {:?}", hir.diagnostics);
        });
    }
}

#[test]
fn every_javascript_program() {
    for_each_program(&JAVASCRIPT_EXTENSIONS, |w, path, text| {
        let errors = |reads_jsdoc: bool| {
            let source = Source {
                reads_jsdoc,
                ..Source::from_bytes(path, text)
            };
            early_errors(&w.parse(&source))
        };
        assert_eq!(errors(true), errors(false), "{path}");
    });
}

#[test]
fn checker_owns_strict_mode_errors() {
    for &text in STRICT_MODE_VIOLATIONS {
        parsed(DEFAULT_PATH, text, |_, hir| {
            assert!(hir.diagnostics.is_empty(), "{text}: {:?}", hir.diagnostics);
        });
    }
}

#[test]
fn grammar_early_errors() {
    for &(text, code) in GRAMMAR_EARLY_ERRORS {
        parsed(DEFAULT_PATH, text, |_, hir| {
            let errors = of_class(hir, EarlyError);
            let codes: Vec<u32> = errors.iter().map(|error| error.code).collect();
            assert_eq!(codes, [code], "{text}: {:?}", hir.diagnostics);
        });
    }
}
