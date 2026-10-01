// src/lint/rules/valid_typeof.rs as the crate has it, against stand-ins of what it reads, over hand-made comparisons.
// LINT_DIR is replaced by run.sh. The module of the rule has no `allow`: the lint levels of the command line hold for it.

mod ast_utils {
    use bun_ast::{Expr, ExprData};

    pub(crate) enum Name<'a> {
        Borrowed(&'a [u8]),
        #[allow(dead_code)]
        Owned(Vec<u8>),
    }

    impl Name<'_> {
        pub(crate) fn bytes(&self) -> &[u8] {
            match self {
                Name::Borrowed(bytes) => bytes,
                Name::Owned(bytes) => bytes,
            }
        }
    }

    // The signature of `get_static_string_value` of src/lint/ast_utils.rs. The rule asks it for a string only.
    pub(crate) fn get_static_string_value(key: &Expr) -> Option<Name<'_>> {
        match &key.data {
            ExprData::EString(string) => string.value.map(Name::Borrowed),
            _ => panic!("asked for the value of a node that is no string"),
        }
    }
}

mod context {
    use std::borrow::Cow;
    use std::marker::PhantomData;

    use bun_ast::{Loc, Ref};

    use crate::rule::{Rule, RuleCategory};

    // `Globals` of src/lint/context.rs, with the two values that the rule names.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) struct Globals(u8);

    impl Globals {
        pub(crate) const NONE: Globals = Globals(0);
        pub(crate) const UNDEFINED: Globals = Globals(4);
    }

    pub(crate) struct Context<'p, 'a> {
        pub(crate) reports: Vec<(&'static str, i32, Vec<u8>, Globals)>,
        marker: PhantomData<(&'p (), &'a ())>,
    }

    impl<'p, 'a> Context<'p, 'a> {
        pub(crate) fn new() -> Self {
            Context {
                reports: Vec::new(),
                marker: PhantomData,
            }
        }

        // The signature of `Context::name_of` of src/lint/context.rs.
        pub(crate) fn name_of(&self, r#ref: Ref) -> &'a [u8] {
            r#ref.0
        }

        // The signature of `Context::report_if_global` of src/lint/context.rs.
        pub(crate) fn report_if_global(
            &mut self,
            rule: &'static Rule,
            at: Loc,
            text: impl Into<Cow<'static, [u8]>>,
            names: Globals,
        ) {
            let RuleCategory::Correctness = rule.category;
            self.reports
                .push((rule.name, at.start, text.into().into_owned(), names));
        }
    }
}

mod rule {
    pub(crate) struct Rule {
        pub(crate) name: &'static str,
        pub(crate) category: RuleCategory,
    }

    #[derive(Clone, Copy)]
    pub(crate) enum RuleCategory {
        Correctness,
    }
}

mod rules {
    use bun_ast::OpCode;

    #[path = "LINT_DIR/rules/valid_typeof.rs"]
    pub(crate) mod valid_typeof;

    // `is_equality` of src/lint/rules/mod.rs.
    pub(crate) fn is_equality(op: OpCode) -> bool {
        matches!(
            op,
            OpCode::BinLooseEq | OpCode::BinLooseNe | OpCode::BinStrictEq | OpCode::BinStrictNe
        )
    }
}

use std::io::Write;

use bun_ast::{E, Expr, ExprData, Loc, OpCode, Ref, StoreRef};
use context::Globals;

fn at(start: i32, data: ExprData) -> Expr {
    Expr {
        loc: Loc { start },
        data,
    }
}

fn id(start: i32, name: &'static str) -> Expr {
    at(
        start,
        ExprData::EIdentifier(E::Identifier {
            ref_: Ref(name.as_bytes()),
        }),
    )
}

fn string(start: i32, value: &'static str) -> Expr {
    at(
        start,
        ExprData::EString(StoreRef::new(E::EString {
            value: Some(value.as_bytes()),
            prefer_template: false,
        })),
    )
}

// A template without a substitution: a string for Bun's tree.
fn template(start: i32, value: &'static str) -> Expr {
    at(
        start,
        ExprData::EString(StoreRef::new(E::EString {
            value: Some(value.as_bytes()),
            prefer_template: true,
        })),
    )
}

// A string with an unpaired surrogate: it has no static value.
fn string_without_value(start: i32) -> Expr {
    at(
        start,
        ExprData::EString(StoreRef::new(E::EString {
            value: None,
            prefer_template: false,
        })),
    )
}

fn number(start: i32, value: f64) -> Expr {
    at(start, ExprData::ENumber(E::Number { value }))
}

fn unary(start: i32, op: OpCode, value: Expr) -> Expr {
    at(start, ExprData::EUnary(StoreRef::new(E::Unary { op, value })))
}

fn type_of(start: i32, value: Expr) -> Expr {
    unary(start, OpCode::UnTypeof, value)
}

fn binary(op: OpCode, left: Expr, right: Expr) -> E::Binary {
    E::Binary { left, right, op }
}

fn nested(start: i32, node: E::Binary) -> Expr {
    at(start, ExprData::EBinary(StoreRef::new(node)))
}

// What the rule reports for the comparison: the place, and whether the report waits for `undefined` to be the global.
fn run(node: &E::Binary) -> Vec<(i32, bool)> {
    let mut context = context::Context::new();
    rules::valid_typeof::e_binary(&mut context, node);
    context
        .reports
        .into_iter()
        .map(|(code, start, text, names)| {
            assert_eq!(code, "valid-typeof");
            assert_eq!(text, b"Invalid typeof comparison value.");
            assert!(names == Globals::NONE || names == Globals::UNDEFINED);
            (start, names == Globals::UNDEFINED)
        })
        .collect()
}

const EQUALITY: [OpCode; 4] = [
    OpCode::BinLooseEq,
    OpCode::BinLooseNe,
    OpCode::BinStrictEq,
    OpCode::BinStrictNe,
];

const NOT_EQUALITY: [OpCode; 12] = [
    OpCode::BinAdd,
    OpCode::BinLt,
    OpCode::BinLe,
    OpCode::BinGt,
    OpCode::BinGe,
    OpCode::BinIn,
    OpCode::BinInstanceof,
    OpCode::BinNullishCoalescing,
    OpCode::BinLogicalOr,
    OpCode::BinLogicalAnd,
    OpCode::BinComma,
    OpCode::BinAssign,
];

const TYPES: [&str; 8] = [
    "symbol",
    "undefined",
    "object",
    "boolean",
    "number",
    "string",
    "function",
    "bigint",
];

fn main() {
    let mut checks = 0usize;
    let mut check = |node: E::Binary, expected: &[(i32, bool)]| {
        assert_eq!(run(&node), expected, "check {checks}");
        checks += 1;
    };
    let a = || id(7, "a");
    let eq = OpCode::BinStrictEq;

    // Each of the four operators, the `typeof` on either side.
    for op in EQUALITY {
        check(binary(op, type_of(0, a()), string(13, "strnig")), &[(13, false)]);
        check(binary(op, string(0, "strnig"), type_of(13, a())), &[(0, false)]);
        check(binary(op, type_of(0, a()), id(13, "undefined")), &[(13, true)]);
        check(binary(op, id(0, "undefined"), type_of(14, a())), &[(0, true)]);
        check(binary(op, type_of(0, a()), string(13, "string")), &[]);
    }
    // No other operator compares.
    for op in NOT_EQUALITY {
        check(binary(op, type_of(0, a()), string(13, "strnig")), &[]);
        check(binary(op, string(0, "strnig"), type_of(13, a())), &[]);
        check(binary(op, type_of(0, a()), id(13, "undefined")), &[]);
        check(binary(op, type_of(0, a()), number(13, 5.0)), &[]);
    }
    // The eight type names, as a string and as a template, on either side.
    for name in TYPES {
        check(binary(eq, type_of(0, a()), string(13, name)), &[]);
        check(binary(eq, type_of(0, a()), template(13, name)), &[]);
        check(binary(eq, string(0, name), type_of(13, a())), &[]);
        check(binary(eq, template(0, name), type_of(13, a())), &[]);
    }
    // Any other string.
    for value in [
        "strnig",
        "",
        "String",
        "STRING",
        " string",
        "string ",
        "string\0",
        "null",
        "array",
        "strin",
        "strings",
        "undefine",
        "bigInt",
        "str\u{131}ng",
        "\u{1f600}",
    ] {
        check(binary(eq, type_of(0, a()), string(13, value)), &[(13, false)]);
        check(binary(eq, type_of(0, a()), template(13, value)), &[(13, false)]);
        check(binary(eq, template(0, value), type_of(13, a())), &[(0, false)]);
    }
    check(binary(eq, type_of(0, a()), string_without_value(13)), &[(13, false)]);
    check(binary(eq, string_without_value(0), type_of(13, a())), &[(0, false)]);

    // Every other literal.
    let literals: [fn(i32) -> Expr; 7] = [
        |start| number(start, 5.0),
        |start| number(start, f64::NAN),
        |start| at(start, ExprData::EBigInt(StoreRef::new(E::BigInt { value: b"5" }))),
        |start| at(start, ExprData::EBoolean(E::Boolean { value: true })),
        |start| at(start, ExprData::EBoolean(E::Boolean { value: false })),
        |start| at(start, ExprData::ENull(E::Null)),
        |start| at(start, ExprData::ERegExp(StoreRef::new(E::RegExp { value: b"/re/" }))),
    ];
    for literal in literals {
        check(binary(eq, type_of(0, a()), literal(13)), &[(13, false)]);
        check(binary(eq, literal(0), type_of(13, a())), &[(0, false)]);
        check(binary(eq, a(), literal(13)), &[]);
    }

    // A name that is not `undefined`.
    for name in ["b", "undefined$", "undefined1", "Undefined", "undefine", "NaN", "null_", ""] {
        check(binary(eq, type_of(0, a()), id(13, name)), &[]);
        check(binary(eq, id(0, name), type_of(13, a())), &[]);
    }

    // What is no literal and no name.
    let others: [fn(i32) -> Expr; 11] = [
        |start| unary(start, OpCode::UnNeg, number(start + 1, 1.0)),
        |start| unary(start, OpCode::UnVoid, number(start + 5, 0.0)),
        |start| unary(start, OpCode::UnNot, string(start + 1, "strnig")),
        |start| at(start, ExprData::ETemplate(StoreRef::new(E::Template { tagged: false }))),
        |start| at(start, ExprData::ETemplate(StoreRef::new(E::Template { tagged: true }))),
        |start| nested(start, binary(OpCode::BinAdd, string(start, "strnig"), string(start + 11, ""))),
        |start| nested(start, binary(OpCode::BinComma, id(start, "b"), string(start + 3, "strnig"))),
        |start| at(start, ExprData::EThis(E::This)),
        |start| at(start, ExprData::EMissing(E::Missing)),
        |start| at(start, ExprData::EUndefined(E::Undefined)),
        |start| at(start, ExprData::EBranchBoolean(E::Boolean { value: true })),
    ];
    for other in others {
        check(binary(eq, type_of(0, a()), other(13)), &[]);
        check(binary(eq, other(0), type_of(20, a())), &[]);
    }

    // A `typeof` on both sides, and on neither.
    check(binary(eq, type_of(0, a()), type_of(13, id(20, "b"))), &[]);
    check(binary(eq, type_of(0, a()), type_of(13, string(20, "strnig"))), &[]);
    check(binary(eq, type_of(0, id(7, "undefined")), type_of(21, id(28, "undefined"))), &[]);
    check(binary(eq, a(), string(13, "strnig")), &[]);
    check(binary(eq, a(), id(13, "undefined")), &[]);
    check(binary(eq, string(0, "strnig"), string(13, "strnig")), &[]);
    check(binary(eq, id(0, "undefined"), id(14, "undefined")), &[]);

    // Another unary operator is no `typeof`.
    for op in [OpCode::UnVoid, OpCode::UnNot, OpCode::UnNeg, OpCode::UnDelete] {
        check(binary(eq, unary(0, op, a()), string(13, "strnig")), &[]);
        check(binary(eq, unary(0, op, a()), id(13, "undefined")), &[]);
        check(binary(eq, string(0, "strnig"), unary(13, op, a())), &[]);
        // `!typeof a === "strnig"`: the `typeof` is not an operand of the comparison.
        check(binary(eq, unary(0, op, type_of(1, a())), string(14, "strnig")), &[]);
    }

    // The operand of the `typeof` is not read.
    check(binary(eq, type_of(0, type_of(7, a())), string(20, "strnig")), &[(20, false)]);
    check(binary(eq, type_of(0, id(7, "undefined")), id(21, "undefined")), &[(21, true)]);
    check(binary(eq, id(0, "undefined"), type_of(14, id(21, "undefined"))), &[(0, true)]);
    check(binary(eq, type_of(0, string(7, "string")), string(20, "strnig")), &[(20, false)]);
    check(
        binary(eq, type_of(0, nested(8, binary(eq, a(), string(14, "strnig")))), string(28, "boolean")),
        &[],
    );

    // A comparison of a comparison: only the inner one has the `typeof` as an operand.
    let inner = || binary(eq, type_of(0, a()), string(13, "strnig"));
    check(inner(), &[(13, false)]);
    check(binary(eq, nested(0, inner()), string(26, "x")), &[]);
    check(binary(eq, nested(0, inner()), id(26, "undefined")), &[]);
    check(binary(eq, nested(0, inner()), type_of(26, id(33, "b"))), &[]);
    check(binary(eq, type_of(0, a()), nested(14, inner())), &[]);

    let _ = writeln!(
        std::io::stdout(),
        "valid_typeof.rs against the stand-ins: {checks} checks hold"
    );
}
