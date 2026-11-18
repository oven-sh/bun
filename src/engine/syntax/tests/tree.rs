mod support;

use bun_engine_syntax::ast::{Ast, Export, ExprId, ExprKind, Module, PropertyKey, StmtKind};
use bun_engine_syntax::{
    FieldKind, FieldSource, FunctionFlags, FunctionKind, FunctionSource, Goal, Name, NameKind,
    Parser, PauseKind,
};
use bun_engine_text::Text;
use support::{SCRIPT, expression, function, in_each_width, options, parse, text_of};

fn show(ast: &Ast, source: Text<'_>, id: ExprId) -> String {
    let inner = |id| show(ast, source, id);
    let name = |name| text_of(ast, source, name);
    match ast[id].kind {
        ExprKind::Identifier(it) => name(it),
        ExprKind::String(it) => format!("'{}'", name(it)),
        ExprKind::Boolean(value) => format!("{value}"),
        ExprKind::Number { value, is_integer } => {
            format!("{}{}", value.get(), if is_integer { "" } else { "f" })
        }
        ExprKind::BigInt {
            digits,
            radix,
            is_negative,
        } => {
            format!("{is_negative}:{radix}:{}", name(digits))
        }
        ExprKind::Unary { operator, operand } => format!("({operator:?} {})", inner(operand)),
        ExprKind::Binary {
            operator,
            lhs,
            rhs,
            rhs_assigns,
        } => {
            let mark = if rhs_assigns { "!" } else { "" };
            format!("({operator:?} {} {}{mark})", inner(lhs), inner(rhs))
        }
        ExprKind::Logical { operator, lhs, rhs } => {
            format!("({operator:?} {} {})", inner(lhs), inner(rhs))
        }
        ExprKind::Assign {
            target,
            value,
            divot,
            end,
            ..
        } => {
            format!("(= {} {} {divot}..{end})", inner(target), inner(value))
        }
        ExprKind::Dot {
            base,
            name: it,
            divot,
            end,
        } => {
            format!("(. {} {} {divot}..{end})", inner(base), name(it))
        }
        ExprKind::Call {
            callee,
            divot,
            end,
            flags,
            ..
        } => {
            format!("(call{} {} {divot}..{end})", flags.bits(), inner(callee))
        }
        ExprKind::New {
            callee, divot, end, ..
        } => format!("(new {} {divot}..{end})", inner(callee)),
        ExprKind::OptionalChain {
            chain,
            is_outermost,
        } => {
            format!("(chain {is_outermost} {})", inner(chain))
        }
        ExprKind::Delete { operand, .. } => format!("(delete {})", inner(operand)),
        ExprKind::Object { properties, .. } => {
            let key = |property: bun_engine_syntax::ast::PropertyId| match ast[property].key {
                PropertyKey::Named(it) => name(it),
                _ => String::new(),
            };
            ast.iter(properties).map(key).collect::<Vec<_>>().join("|")
        }
        ExprKind::Template(template) | ExprKind::TaggedTemplate { template, .. } => {
            let parts = |list| ast.iter(list).map(|it: Option<Name>| it.map(name));
            let (cooked, raw) = (parts(ast[template].cooked), parts(ast[template].raw));
            format!("{:?}", cooked.chain(raw).collect::<Vec<_>>())
        }
        _ => "?".into(),
    }
}

#[test]
fn expressions() {
    for (source, expected) in [
        ("a + b * c - d", "(Subtract (Add a (Multiply b c)) d)"),
        ("a ** b ** c", "(Exponentiate a (Exponentiate b c))"),
        ("a || b && c | d", "(Or a (And b (BitOr c d)))"),
        ("a + (b = c)", "(Add a (= b c 8..10)!)"),
        ("1 + 2 * 3", "7"),
        ("1 / 2", "0.5f"),
        ("4.0 / 2", "2f"),
        ("2 ** 10 >>> 1", "512"),
        ("-~!0", "(Negate (BitNot true))"),
        ("a * 1", "(Plus a)"),
        ("-0x1_f", "-31"),
        ("017 + 019 + 1e3", "1034"),
        ("-0b1_0n", "true:2:10"),
        ("'a\\x62\\u{63}\\144\\\n\\e'", "'abcde'"),
        ("'\u{3b1}\u{2028}'", "'\u{3b1}\u{2028}'"),
        ("\\u0061b.c", "(. ab c 7..9)"),
        ("new a.b()()", "(call0 (new (. a b 5..7) 7..9) 9..11)"),
        ("new new a", "(new (new a 4..9) 0..9)"),
        (
            "a?.b.c?.d",
            "(chain true (. (chain false (. (. a b 1..4) c 4..6)) d 6..9))",
        ),
        ("a?.b?.()", "(chain true (call1 (. a b 1..4) 6..8))"),
        ("delete a?.b", "(chain true (delete (. a b 8..11)))"),
        (
            "({ 1.0: a, 0x10n: a, 'b': a, 1e21: a, if: a })",
            "1|16|b|1e+21|if",
        ),
        ("`a\r\n${b}\\n`", r#"[Some("a\n"), Some("\n")]"#),
        ("a`\\u\r`", r#"[None, Some("\\u\n")]"#),
    ] {
        in_each_width(source, |text| {
            let mut parser = Parser::default();
            let ast = parse(&mut parser, text, SCRIPT).unwrap();
            assert_eq!(show(ast, text, expression(ast)), expected, "{source}");
        });
    }
}

#[test]
fn equal_names_are_one() {
    for name in [
        "a",
        "fifteen_letters",
        "sixteen_letters_",
        &"b".repeat(100),
        "\u{e9}",
        "\u{3b1}",
    ] {
        let first = u32::from(name.chars().next().unwrap());
        let rest: String = name.chars().skip(1).collect();
        in_each_width(&format!("{name} + \\u{{{first:x}}}{rest}"), |text| {
            let mut parser = Parser::default();
            let ast = parse(&mut parser, text, SCRIPT).unwrap();
            let ExprKind::Binary { lhs, rhs, .. } = ast[expression(ast)].kind else {
                panic!("{name}");
            };
            let pair = (ast[lhs].kind, ast[rhs].kind);
            assert!(matches!(pair, (ExprKind::Identifier(a), ExprKind::Identifier(b)) if a == b));
        });
    }
}

#[test]
fn names_of_built_ins() {
    let text = Text::from_ascii("@if.@@iterator");
    let mut options = options(SCRIPT, 0..text.len() as u32);
    options.builtin = true;
    let mut parser = Parser::default();
    let ast = parser.parse(text, &options, None).unwrap();
    let ExprKind::Dot { base, name, .. } = ast[expression(ast)].kind else {
        panic!();
    };
    assert_eq!(ast.names.kind(name), NameKind::WellKnownSymbol);
    let ExprKind::Identifier(name) = ast[base].kind else {
        panic!();
    };
    assert_eq!(ast.names.kind(name), NameKind::Private);
    assert_eq!(text_of(ast, text, name), "if");
}

#[test]
fn functions() {
    type F = FunctionFlags;
    for (source, kind, flags, range, length) in [
        (
            "function a(b, c = 1, d) {} ",
            FunctionKind::Normal,
            F::empty(),
            (0, 10, 26),
            1,
        ),
        (
            "async function* a() { 'use strict' }",
            FunctionKind::Normal,
            F::ASYNC | F::GENERATOR | F::STRICT,
            (0, 17, 36),
            0,
        ),
        (
            "(function a(...b) {})",
            FunctionKind::Normal,
            F::BINDS_OWN_NAME,
            (1, 11, 20),
            0,
        ),
        (
            "async a => b ;",
            FunctionKind::Arrow,
            F::ASYNC | F::EXPRESSION_BODY,
            (0, 6, 12),
            1,
        ),
    ] {
        let mut parser = Parser::default();
        let found = function(parse(&mut parser, Text::from_ascii(source), SCRIPT).unwrap());
        let found_range = (found.start, found.parameters_start, found.end);
        assert_eq!(
            (found.kind, found.flags, found_range, found.length),
            (kind, flags, range, length),
            "{source}"
        );
    }
}

#[test]
fn fields() {
    let text = Text::from_ascii("class A { static #a = (() => 1); static { super.b } }");
    let field = |kind, start, key_start, initializer_start| FieldSource {
        kind,
        start,
        key_start,
        initializer_start,
    };
    let goal = Goal::Function(FunctionSource {
        kind: FunctionKind::FieldInitializer,
        flags: FunctionFlags::STRICT | FunctionFlags::STATIC,
        fields: &[
            field(FieldKind::Private, 10, 17, 22),
            field(FieldKind::StaticBlock, 33, 40, 0),
        ],
    });
    let mut parser = Parser::default();
    let ast = parse(&mut parser, text, goal).unwrap();
    let StmtKind::DefineField {
        value: Some(value), ..
    } = ast[ast.at(ast.root.tree.body, 0)].kind
    else {
        panic!();
    };
    let ExprKind::Function(arrow) = ast[value].kind else {
        panic!();
    };
    assert_eq!(text_of(ast, text, ast[arrow].name.unwrap()), "#a");
    let StmtKind::StaticBlock { function } = ast[ast.at(ast.root.tree.body, 1)].kind else {
        panic!();
    };
    assert!(ast[function].flags.contains(FunctionFlags::USES_HOME));
    assert_eq!(
        (ast[function].parameters_start, ast[function].end),
        (40, 51)
    );
}

#[test]
fn exports_of_imports_are_indirect() {
    let text = Text::from_ascii(
        "import a, * as b from 'x'; import defer * as c from 'y'; export { a, b, c }; export * from 'z'",
    );
    let mut parser = Parser::default();
    let ast = parse(&mut parser, text, Goal::Module).unwrap();
    let Module {
        requests,
        imports,
        exports,
    } = &ast.root.module;
    assert_eq!((requests.len(), imports.len()), (3, 3));
    assert!(matches!(
        exports[..],
        [
            Export::Indirect {
                request: 0,
                imported: Some(Name::DEFAULT),
                ..
            },
            Export::Indirect {
                request: 0,
                imported: None,
                ..
            },
            Export::Local { .. },
            Export::Star { request: 2 },
        ]
    ));
}

#[test]
fn directives_in_comments() {
    in_each_width("a //# sourceURL=b\n//@ sourceMappingURL=c d\n", |text| {
        let mut parser = Parser::default();
        let root = &parse(&mut parser, text, SCRIPT).unwrap().root;
        assert_eq!(root.source_url.as_ref().unwrap().to_string(), "b");
        assert!(root.source_mapping_url.is_none());
    });
}

#[test]
fn pauses() {
    let text = Text::from_ascii("a; function b() { if ((c)) return (d, e) => f }");
    let options = options(SCRIPT, 0..text.len() as u32);
    let positions = Parser::default().pause_positions(text, &options).unwrap();
    let found: Vec<_> = positions.iter().map(|it| (it.offset, it.kind)).collect();
    use PauseKind::{Enter, Leave, Pause};
    let expected = [
        (0, Pause),
        (13, Enter),
        (23, Pause),
        (27, Pause),
        (44, Pause),
        (46, Leave),
    ];
    assert_eq!(found, expected);
}
