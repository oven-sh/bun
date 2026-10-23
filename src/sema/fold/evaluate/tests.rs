use super::*;
use crate::session::Session;
use Literal::{Big, Bool, Null, Num, Str, Undefined, Unknown};

#[derive(Copy, Clone, Debug)]
enum Literal {
    Unknown,
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(&'static str),
    Big(&'static str),
}

const NAN: Literal = Num(f64::NAN);
const INFINITY: Literal = Num(f64::INFINITY);
const MAX_STRING_BYTES: usize = 1 << 16;

impl Literal {
    fn to_value(self, evaluator: &Evaluator<'_, '_>) -> Value {
        let intern = |text: &str| evaluator.atoms.intern(text.as_bytes());
        match self {
            Unknown => Value::Unknown,
            Undefined => Value::from(Constant::Undefined),
            Null => Value::from(Constant::Null),
            Bool(value) => Value::from(Constant::Boolean(value)),
            Num(number) => Value::from(Constant::Number(number)),
            Str(text) => Value::from(Constant::String(intern(text))),
            Big(digits) => Value::from(Constant::BigInt(intern(digits))),
        }
    }

    fn to_primitive(self, evaluator: &Evaluator<'_, '_>) -> Primitive {
        match self.to_value(evaluator) {
            Value::Known(primitive) => primitive,
            Value::Unknown => panic!("{self:?} has no value"),
        }
    }
}

fn with_evaluator(test: impl FnOnce(&Evaluator<'_, '_>)) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let over_limit_count = Cell::new(0);
    test(&Evaluator::new(&atoms, MAX_STRING_BYTES, &over_limit_count));
}

fn to_constant(evaluator: &Evaluator<'_, '_>, value: Value) -> Option<Constant> {
    match value {
        Value::Known(primitive) => Some(evaluator.to_constant(primitive)),
        Value::Unknown => None,
    }
}

fn is_identical(evaluator: &Evaluator<'_, '_>, left: Value, right: Value) -> bool {
    match (to_constant(evaluator, left), to_constant(evaluator, right)) {
        (Some(Constant::Number(left)), Some(Constant::Number(right))) => {
            left.to_bits() == right.to_bits()
        }
        (left, right) => left == right,
    }
}

fn describe(evaluator: &Evaluator<'_, '_>, value: Value) -> String {
    match to_constant(evaluator, value) {
        Some(Constant::String(text) | Constant::BigInt(text)) => {
            let text = bstr::BStr::new(evaluator.atoms.bytes(text));
            format!("{value:?} {text:?}")
        }
        _ => format!("{value:?}"),
    }
}

#[track_caller]
fn assert_identical(evaluator: &Evaluator<'_, '_>, value: Value, expected: Value) {
    assert!(
        is_identical(evaluator, value, expected),
        "expected {}, found {}",
        describe(evaluator, expected),
        describe(evaluator, value)
    );
}

fn concatenate_scratch(evaluator: &Evaluator<'_, '_>, parts: [&'static str; 2]) -> Value {
    let text = evaluator.add_all(parts.map(|part| Str(part).to_value(evaluator)));
    assert!(
        matches!(text, Value::Known(Primitive::ScratchString(_))),
        "{parts:?}"
    );
    text
}

fn assert_unary(cases: &[(UnOp, Literal, Literal)]) {
    with_evaluator(|evaluator| {
        for &(op, operand, expected) in cases {
            let value = evaluator.unary(op, operand.to_value(evaluator));
            assert!(
                is_identical(evaluator, value, expected.to_value(evaluator)),
                "{op:?} {operand:?}: expected {expected:?}, found {}",
                describe(evaluator, value)
            );
        }
    });
}

fn assert_binary(cases: &[(Literal, BinOp, Literal, Literal)]) {
    with_evaluator(|evaluator| {
        for &(left, op, right, expected) in cases {
            let operands = (left.to_value(evaluator), right.to_value(evaluator));
            let value = evaluator.binary(op, operands.0, operands.1);
            assert!(
                is_identical(evaluator, value, expected.to_value(evaluator)),
                "{left:?} {op:?} {right:?}: expected {expected:?}, found {}",
                describe(evaluator, value)
            );
        }
    });
}

fn assert_template(texts: &[&str], values: &[Literal], expected: Literal) {
    with_evaluator(|evaluator| {
        let intern = |text: &&str| evaluator.atoms.intern(text.as_bytes());
        let atoms: Vec<Atom> = texts.iter().map(intern).collect();
        let operands = values.iter().map(|literal| literal.to_value(evaluator));
        let operands: Vec<Value> = operands.collect();
        let value = evaluator.concatenate(&atoms, &operands);
        assert!(
            is_identical(evaluator, value, expected.to_value(evaluator)),
            "{texts:?} {values:?}: expected {expected:?}, found {}",
            describe(evaluator, value)
        );
    });
}

fn assert_sums(cases: &[(&[Literal], Literal)]) {
    with_evaluator(|evaluator| {
        for &(addends, expected) in cases {
            let values = addends.iter().map(|literal| literal.to_value(evaluator));
            let value = evaluator.add_all(values);
            assert!(
                is_identical(evaluator, value, expected.to_value(evaluator)),
                "{addends:?}: expected {expected:?}, found {}",
                describe(evaluator, value)
            );
        }
    });
}

#[test]
fn string_to_number_follows_ecmascript() {
    let cases = [
        ("", Some(0.0)),
        (" \t\n\u{b}\u{c}\r", Some(0.0)),
        (" 12 ", Some(12.0)),
        ("\u{b}7\u{c}", Some(7.0)),
        ("0x1F", Some(31.0)),
        (" 0x10 ", Some(16.0)),
        ("0o17", Some(15.0)),
        ("0B11", Some(3.0)),
        ("1e3", Some(1000.0)),
        ("1.e2", Some(100.0)),
        (".5", Some(0.5)),
        ("5.", Some(5.0)),
        ("-0", Some(-0.0)),
        ("1e1000", Some(f64::INFINITY)),
        ("+Infinity", Some(f64::INFINITY)),
        ("-Infinity", Some(f64::NEG_INFINITY)),
        ("1_000", Some(f64::NAN)),
        ("inf", Some(f64::NAN)),
        ("nan", Some(f64::NAN)),
        ("infinity", Some(f64::NAN)),
        ("0x", Some(f64::NAN)),
        ("0xg", Some(f64::NAN)),
        ("+0x1", Some(f64::NAN)),
        ("-0x10", Some(f64::NAN)),
        ("1e", Some(f64::NAN)),
        (".e5", Some(f64::NAN)),
        (".", Some(f64::NAN)),
        ("+", Some(f64::NAN)),
        ("1n", Some(f64::NAN)),
        ("\0", Some(f64::NAN)),
        ("\u{a0}1", None),
        ("é", None),
    ];
    for (text, expected) in cases {
        let number = string_to_number(text.as_bytes()).map(f64::to_bits);
        assert_eq!(number, expected.map(f64::to_bits), "{text:?}");
    }
}

#[test]
fn string_to_number_declines_inexact_radix_literals() {
    let cases = [
        ("0x", "f", 13, ((1u64 << 52) - 1) as f64),
        ("0o", "7", 17, ((1u64 << 51) - 1) as f64),
        ("0b", "1", 53, ((1u64 << 53) - 1) as f64),
    ];
    for (prefix, digit, max_digits, expected) in cases {
        let exact = format!("{prefix}{}", digit.repeat(max_digits));
        assert_eq!(string_to_number(exact.as_bytes()), Some(expected));
        let inexact = format!("{exact}{digit}");
        assert_eq!(string_to_number(inexact.as_bytes()), None);
        let malformed = string_to_number(format!("{inexact}z").as_bytes());
        assert!(malformed.is_some_and(f64::is_nan), "{inexact}z");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn to_number_converts_primitives() {
    with_evaluator(|evaluator| {
        let convert = |literal: Literal| evaluator.operand(literal.to_primitive(evaluator));
        let to_number = |literal: Literal| to_number(convert(literal));
        assert!(to_number(Undefined).is_some_and(f64::is_nan));
        assert_eq!(to_number(Null), Some(0.0));
        assert_eq!(to_number(Bool(false)), Some(0.0));
        assert_eq!(to_number(Bool(true)), Some(1.0));
        assert_eq!(to_number(Num(1.5)), Some(1.5));
        assert_eq!(to_number(Str("0x1F")), Some(31.0));
        assert_eq!(to_number(Str("é")), None);
        assert_eq!(to_number(Big("1")), None);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn to_boolean_and_is_nullish_follow_ecmascript() {
    let cases = [
        (Undefined, false, true),
        (Null, false, true),
        (Bool(false), false, false),
        (Bool(true), true, false),
        (Num(0.0), false, false),
        (Num(-0.0), false, false),
        (NAN, false, false),
        (Num(-1.5), true, false),
        (INFINITY, true, false),
        (Str(""), false, false),
        (Str("0"), true, false),
        (Str(" "), true, false),
        (Big("0"), false, false),
        (Big("10"), true, false),
    ];
    with_evaluator(|evaluator| {
        for (literal, is_truthy, is_nullish) in cases {
            let primitive = literal.to_primitive(evaluator);
            assert_eq!(evaluator.to_boolean(primitive), is_truthy, "{literal:?}");
            assert_eq!(evaluator.is_nullish(primitive), is_nullish, "{literal:?}");
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn to_string_follows_ecmascript() {
    let cases = [
        (Undefined, "undefined"),
        (Null, "null"),
        (Bool(true), "true"),
        (Bool(false), "false"),
        (Num(1.0), "1"),
        (Num(-1.5), "-1.5"),
        (Num(-0.0), "0"),
        (NAN, "NaN"),
        (Num(f64::NEG_INFINITY), "-Infinity"),
        (Num(1e21), "1e+21"),
        (Num(1e20), "100000000000000000000"),
        (Num(1e-7), "1e-7"),
        (Num(0.1 + 0.2), "0.30000000000000004"),
        (Str("a"), "a"),
        (Big("10"), "10"),
    ];
    with_evaluator(|evaluator| {
        for (literal, expected) in cases {
            let mut text = Vec::new();
            push_string(
                &mut text,
                evaluator.operand(literal.to_primitive(evaluator)),
            );
            assert_eq!(text, expected.as_bytes(), "{literal:?}");
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn push_text_follows_to_string() {
    let cases = [
        (Undefined, "undefined"),
        (Null, "null"),
        (Bool(true), "true"),
        (Bool(false), "false"),
        (Num(-0.0), "0"),
        (Num(1e21), "1e+21"),
        (NAN, "NaN"),
        (Str(""), ""),
        (Str("a"), "a"),
        (Big("10"), "10"),
    ];
    with_evaluator(|evaluator| {
        for (literal, expected) in cases {
            let mut text = b"<".to_vec();
            evaluator.push_text(&mut text, literal.to_primitive(evaluator));
            assert_eq!(text, ["<", expected].concat().into_bytes(), "{literal:?}");
        }
        let Value::Known(scratch) = concatenate_scratch(evaluator, ["a", "b"]) else {
            panic!("`concatenate_scratch` returns a known value");
        };
        let mut text = b"<".to_vec();
        evaluator.push_text(&mut text, scratch);
        assert_eq!(text, b"<ab");

        let trail = Constant::String(evaluator.atoms.intern(b"\xED\xB8\x80"));
        let mut text = b"\xED\xA0\xBD".to_vec();
        evaluator.push_text(&mut text, Primitive::Constant(trail));
        assert_eq!(text, "\u{1f600}".as_bytes());
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn is_string_sees_scratch_strings() {
    with_evaluator(|evaluator| {
        for parts in [["a", "b"], ["", ""], ["1", "2"]] {
            let Value::Known(scratch) = concatenate_scratch(evaluator, parts) else {
                panic!("`concatenate_scratch` returns a known value");
            };
            assert!(evaluator.is_string(scratch), "{parts:?}");
        }
        for literal in [Str(""), Str("a")] {
            assert!(
                evaluator.is_string(literal.to_primitive(evaluator)),
                "{literal:?}"
            );
        }
        for literal in [Undefined, Null, Bool(true), Num(1.0), Big("1")] {
            assert!(
                !evaluator.is_string(literal.to_primitive(evaluator)),
                "{literal:?}"
            );
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn unary_operators() {
    assert_unary(&[
        (UnOp::Plus, Str(" 12 "), Num(12.0)),
        (UnOp::Plus, Str("12px"), NAN),
        (UnOp::Plus, Bool(true), Num(1.0)),
        (UnOp::Plus, Undefined, NAN),
        (UnOp::Plus, Str("\u{a0}1"), Unknown),
        (UnOp::Plus, Big("1"), Unknown),
        (UnOp::Minus, Num(0.0), Num(-0.0)),
        (UnOp::Minus, Null, Num(-0.0)),
        (UnOp::Minus, Str("5"), Num(-5.0)),
        (UnOp::Minus, NAN, NAN),
        (UnOp::Minus, Big("1"), Unknown),
        (UnOp::BitNot, Num(5.0), Num(-6.0)),
        (UnOp::BitNot, Num(3.7), Num(-4.0)),
        (UnOp::BitNot, Num(4294967295.0), Num(0.0)),
        (UnOp::BitNot, Num(2147483648.0), Num(2147483647.0)),
        (UnOp::BitNot, Str("a"), Num(-1.0)),
        (UnOp::BitNot, Big("1"), Unknown),
        (UnOp::Not, Str(""), Bool(true)),
        (UnOp::Not, Str("0"), Bool(false)),
        (UnOp::Not, Big("0"), Bool(true)),
        (UnOp::Not, Big("1"), Bool(false)),
        (UnOp::Not, NAN, Bool(true)),
        (UnOp::Typeof, Undefined, Str("undefined")),
        (UnOp::Typeof, Null, Str("object")),
        (UnOp::Typeof, Bool(false), Str("boolean")),
        (UnOp::Typeof, Num(1.0), Str("number")),
        (UnOp::Typeof, Str("a"), Str("string")),
        (UnOp::Typeof, Big("1"), Str("bigint")),
        (UnOp::Void, Unknown, Undefined),
        (UnOp::Void, Num(0.0), Undefined),
        (UnOp::Delete, Num(1.0), Unknown),
        (UnOp::PreInc, Num(1.0), Unknown),
        (UnOp::PreDec, Num(1.0), Unknown),
        (UnOp::PostInc, Num(1.0), Unknown),
        (UnOp::PostDec, Num(1.0), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn addition_concatenates_or_sums() {
    assert_binary(&[
        (Num(1.0), BinOp::Add, Str("2"), Str("12")),
        (Str("a"), BinOp::Add, Str("b"), Str("ab")),
        (Str("a"), BinOp::Add, Null, Str("anull")),
        (Str("a"), BinOp::Add, Undefined, Str("aundefined")),
        (Bool(true), BinOp::Add, Str("a"), Str("truea")),
        (Str(""), BinOp::Add, Big("1"), Str("1")),
        (Str(""), BinOp::Add, Num(-0.0), Str("0")),
        (Num(1.0), BinOp::Add, Num(2.0), Num(3.0)),
        (Null, BinOp::Add, Num(1.0), Num(1.0)),
        (Undefined, BinOp::Add, Num(1.0), NAN),
        (Bool(true), BinOp::Add, Bool(true), Num(2.0)),
        (Big("1"), BinOp::Add, Big("1"), Unknown),
        (Big("1"), BinOp::Add, Num(1.0), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn addition_chains_associate_left() {
    assert_sums(&[
        (&[Num(5.0)], Num(5.0)),
        (&[Num(1.0), Num(2.0), Num(3.0)], Num(6.0)),
        (&[Num(1.0), Num(2.0), Str("a")], Str("3a")),
        (&[Str("a"), Num(1.0), Num(2.0)], Str("a12")),
        (&[Num(1.0), Str("a"), Null, Bool(true)], Str("1anulltrue")),
        (&[Null, Undefined, Str("")], Str("NaN")),
        (&[Big("1"), Str("a"), Big("2")], Str("1a2")),
        (&[Num(-0.0), Num(-0.0)], Num(-0.0)),
        (&[], Unknown),
        (&[Unknown], Unknown),
        (&[Unknown, Str("a")], Unknown),
        (&[Str("a"), Unknown], Unknown),
        (&[Str("a"), Str("b"), Unknown], Unknown),
        (&[Num(1.0), Unknown, Str("a")], Unknown),
        (&[Big("1"), Num(1.0), Str("a")], Unknown),
        (&[Num(1.0), Big("1")], Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn to_constant_interns_computed_string() {
    with_evaluator(|evaluator| {
        let addends = [Str("p"), Str("q"), Num(1234.5), Str("r")];
        let values = addends.map(|literal| literal.to_value(evaluator));
        let sum = evaluator.add_all(values);
        let texts = [evaluator.atoms.intern(b"s"), evaluator.atoms.intern(b"t")];
        let template = evaluator.concatenate(&texts, &[sum]);
        let is_equal = evaluator.binary(BinOp::EqEqEq, sum, template);
        assert_identical(evaluator, is_equal, Bool(false).to_value(evaluator));
        for text in [
            "pq",
            "1234.5",
            "pq1234.5",
            "pq1234.5r",
            "spq1234.5r",
            "spq1234.5rt",
        ] {
            assert_eq!(evaluator.atoms.lookup(text.as_bytes()), None, "{text}");
        }
        let Some(Constant::String(interned)) = to_constant(evaluator, template) else {
            panic!("{template:?}");
        };
        assert_eq!(evaluator.atoms.bytes(interned), b"spq1234.5rt");
        assert_eq!(evaluator.atoms.lookup(b"pq1234.5r"), None);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn template_without_substitutions_stays_interned() {
    with_evaluator(|evaluator| {
        let text = evaluator.atoms.intern(b"a");
        let template = evaluator.concatenate(&[text], &[]);
        let is_text = matches!(
            template,
            Value::Known(Primitive::Constant(Constant::String(found))) if found == text
        );
        assert!(is_text, "{template:?}");
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn scratch_strings_are_operands() {
    with_evaluator(|evaluator| {
        let value = |literal: Literal| literal.to_value(evaluator);
        let scratch = |parts| concatenate_scratch(evaluator, parts);
        let binary_cases = [
            (
                scratch(["a", "b"]),
                BinOp::EqEqEq,
                value(Str("ab")),
                Bool(true),
            ),
            (
                value(Str("ab")),
                BinOp::EqEqEq,
                scratch(["a", "b"]),
                Bool(true),
            ),
            (
                scratch(["a", "b"]),
                BinOp::EqEqEq,
                scratch(["", "ab"]),
                Bool(true),
            ),
            (
                scratch(["a", "b"]),
                BinOp::NotEqEq,
                scratch(["a", "c"]),
                Bool(true),
            ),
            (
                scratch(["a", "b"]),
                BinOp::EqEqEq,
                value(Str("a")),
                Bool(false),
            ),
            (
                scratch(["a", "b"]),
                BinOp::EqEq,
                value(Str("ab")),
                Bool(true),
            ),
            (
                scratch(["1", "2"]),
                BinOp::EqEq,
                value(Num(12.0)),
                Bool(true),
            ),
            (
                scratch(["1", "2"]),
                BinOp::EqEqEq,
                value(Num(12.0)),
                Bool(false),
            ),
            (scratch(["a", "b"]), BinOp::NotEq, value(Null), Bool(true)),
            (scratch(["1", "2"]), BinOp::Mul, value(Num(2.0)), Num(24.0)),
            (
                scratch(["0x", "10"]),
                BinOp::BitOr,
                value(Num(0.0)),
                Num(16.0),
            ),
            (
                scratch(["a", "b"]),
                BinOp::Lt,
                scratch(["a", "c"]),
                Bool(true),
            ),
            (scratch(["1", "0"]), BinOp::Lt, value(Num(9.0)), Bool(false)),
            (scratch(["a", "é"]), BinOp::Lt, value(Str("b")), Unknown),
            (
                scratch(["a", "b"]),
                BinOp::Add,
                scratch(["c", "d"]),
                Str("abcd"),
            ),
            (value(Num(1.0)), BinOp::Add, scratch(["a", "b"]), Str("1ab")),
            (scratch(["a", "b"]), BinOp::Add, value(Unknown), Unknown),
        ];
        for (left, op, right, expected) in binary_cases {
            assert_identical(
                evaluator,
                evaluator.binary(op, left, right),
                value(expected),
            );
        }
        let unary_cases = [
            (UnOp::Typeof, scratch(["a", "b"]), Str("string")),
            (UnOp::Not, scratch(["a", "b"]), Bool(false)),
            (UnOp::Not, scratch(["", ""]), Bool(true)),
            (UnOp::Plus, scratch(["1", "2"]), Num(12.0)),
            (UnOp::Minus, scratch(["a", "b"]), NAN),
            (UnOp::BitNot, scratch(["1", "2"]), Num(-13.0)),
            (UnOp::Void, scratch(["a", "b"]), Undefined),
        ];
        for (op, operand, expected) in unary_cases {
            assert_identical(evaluator, evaluator.unary(op, operand), value(expected));
        }
        let Value::Known(empty) = scratch(["", ""]) else {
            panic!("`concatenate_scratch` returns a known value");
        };
        assert!(!evaluator.to_boolean(empty));
        assert!(!evaluator.is_nullish(empty));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn arithmetic_follows_ieee_754() {
    assert_binary(&[
        (Num(5.0), BinOp::Sub, Num(7.0), Num(-2.0)),
        (Num(0.0), BinOp::Mul, Num(-1.0), Num(-0.0)),
        (Str("3"), BinOp::Mul, Str("4"), Num(12.0)),
        (Str("a"), BinOp::Mul, Num(1.0), NAN),
        (Num(1.0), BinOp::Div, Num(0.0), INFINITY),
        (Num(1.0), BinOp::Div, Num(-0.0), Num(f64::NEG_INFINITY)),
        (Num(0.0), BinOp::Div, Num(0.0), NAN),
        (Num(5.0), BinOp::Rem, Num(-3.0), Num(2.0)),
        (Num(-5.0), BinOp::Rem, Num(3.0), Num(-2.0)),
        (Num(-1.0), BinOp::Rem, Num(1.0), Num(-0.0)),
        (Num(5.0), BinOp::Rem, Num(0.0), NAN),
        (INFINITY, BinOp::Rem, Num(2.0), NAN),
        (Num(2.0), BinOp::Rem, INFINITY, Num(2.0)),
        (Str("é"), BinOp::Mul, Num(1.0), Unknown),
        (Big("1"), BinOp::Sub, Big("1"), Unknown),
        (Big("1"), BinOp::Mul, Num(2.0), Unknown),
        (Num(1.0), BinOp::Div, Big("2"), Unknown),
        (Big("1"), BinOp::Rem, Big("2"), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn exponentiation_folds_exact_cases_only() {
    assert_binary(&[
        (Num(2.0), BinOp::Pow, Num(10.0), Num(1024.0)),
        (Num(-2.0), BinOp::Pow, Num(3.0), Num(-8.0)),
        (Num(-2.0), BinOp::Pow, Num(2.0), Num(4.0)),
        (Num(7.0), BinOp::Pow, Num(1.0), Num(7.0)),
        (Num(1.0), BinOp::Pow, Num(64.0), Num(1.0)),
        (Num(1.0), BinOp::Pow, Num(65.0), Num(1.0)),
        (Num(1.0), BinOp::Pow, Num(1e9), Num(1.0)),
        (Num(-1.0), BinOp::Pow, Num(1000001.0), Num(-1.0)),
        (Num(-1.0), BinOp::Pow, Num(1000000.0), Num(1.0)),
        (Num(0.0), BinOp::Pow, Num(1e9), Num(0.0)),
        (Num(-0.0), BinOp::Pow, Num(1000001.0), Num(-0.0)),
        (Num(2.0), BinOp::Pow, Num(53.0), Num(9007199254740992.0)),
        (Num(-2.0), BinOp::Pow, Num(53.0), Num(-9007199254740992.0)),
        (
            Num(9007199254740992.0),
            BinOp::Pow,
            Num(1.0),
            Num(9007199254740992.0),
        ),
        (Str("2"), BinOp::Pow, Str("3"), Num(8.0)),
        (Num(0.0), BinOp::Pow, Num(0.0), Num(1.0)),
        (NAN, BinOp::Pow, Num(-0.0), Num(1.0)),
        (Num(-0.0), BinOp::Pow, Num(3.0), Num(-0.0)),
        (Num(-0.0), BinOp::Pow, Num(2.0), Num(0.0)),
        (Num(2.0), BinOp::Pow, NAN, NAN),
        (Num(1.0), BinOp::Pow, INFINITY, NAN),
        (Num(-1.0), BinOp::Pow, Num(f64::NEG_INFINITY), NAN),
        (Num(2.0), BinOp::Pow, INFINITY, Unknown),
        (Num(2.0), BinOp::Pow, Num(0.5), Unknown),
        (Num(4.0), BinOp::Pow, Num(0.5), Unknown),
        (Num(1.5), BinOp::Pow, Num(2.0), Unknown),
        (Num(2.0), BinOp::Pow, Num(-1.0), Unknown),
        (Num(2.0), BinOp::Pow, Num(54.0), Unknown),
        (Num(3.0), BinOp::Pow, Num(40.0), Unknown),
        (Num(2.0), BinOp::Pow, Num(1e9), Unknown),
        (Num(9007199254740994.0), BinOp::Pow, Num(1.0), Unknown),
        (Num(94906267.0), BinOp::Pow, Num(2.0), Unknown),
        (Num(0.0), BinOp::Pow, Num(-1.0), Unknown),
        (Num(0.0), BinOp::Pow, INFINITY, Unknown),
        (Num(1e300), BinOp::Pow, Num(2.0), Unknown),
        (INFINITY, BinOp::Pow, Num(2.0), Unknown),
        (NAN, BinOp::Pow, Num(2.0), Unknown),
        (Big("2"), BinOp::Pow, Big("2"), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn bitwise_operators_and_shifts() {
    assert_binary(&[
        (Num(5.0), BinOp::BitAnd, Num(3.0), Num(1.0)),
        (Num(5.0), BinOp::BitOr, Num(3.0), Num(7.0)),
        (Num(5.0), BinOp::BitXor, Num(3.0), Num(6.0)),
        (Str("7"), BinOp::BitAnd, Str("3"), Num(3.0)),
        (Num(4294967296.0), BinOp::BitOr, Num(0.0), Num(0.0)),
        (NAN, BinOp::BitOr, Num(0.0), Num(0.0)),
        (Num(1.0), BinOp::Shl, Num(31.0), Num(-2147483648.0)),
        (Num(1.0), BinOp::Shl, Num(33.0), Num(2.0)),
        (Num(1.0), BinOp::Shl, Num(-1.0), Num(-2147483648.0)),
        (Num(-8.0), BinOp::Shr, Num(1.0), Num(-4.0)),
        (Num(-8.0), BinOp::Shr, Num(33.0), Num(-4.0)),
        (Num(-1.0), BinOp::UShr, Num(0.0), Num(4294967295.0)),
        (Num(-1.0), BinOp::UShr, Num(32.0), Num(4294967295.0)),
        (Big("1"), BinOp::BitAnd, Num(1.0), Unknown),
        (Big("1"), BinOp::BitOr, Big("1"), Unknown),
        (Big("1"), BinOp::BitXor, Big("1"), Unknown),
        (Big("1"), BinOp::Shl, Big("1"), Unknown),
        (Big("1"), BinOp::Shr, Big("1"), Unknown),
        (Big("1"), BinOp::UShr, Big("1"), Unknown),
        (Str("é"), BinOp::BitOr, Num(0.0), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn int32_conversions_wrap() {
    let cases = [
        (0.0, 0),
        (-0.0, 0),
        (1.9, 1),
        (-1.9, -1),
        (2147483647.0, i32::MAX),
        (2147483648.0, i32::MIN),
        (-2147483648.0, i32::MIN),
        (-2147483649.0, i32::MAX),
        (4294967295.0, -1),
        (4294967296.0, 0),
        (4294967301.0, 5),
        (1e21, -559939584),
        (f64::NAN, 0),
        (f64::INFINITY, 0),
        (f64::NEG_INFINITY, 0),
    ];
    for (number, expected) in cases {
        assert_eq!(to_int32(number), expected, "{number}");
        assert_eq!(to_uint32(number), expected as u32, "{number}");
    }
}

#[test]
fn numeric_operators_on_numbers() {
    let cases = [
        (1.5, BinOp::Add, 2.0, Some(3.5)),
        (-0.0, BinOp::Add, -0.0, Some(-0.0)),
        (f64::INFINITY, BinOp::Add, f64::NEG_INFINITY, Some(f64::NAN)),
        (5.0, BinOp::Sub, 7.0, Some(-2.0)),
        (0.0, BinOp::Mul, -1.0, Some(-0.0)),
        (1.0, BinOp::Div, -0.0, Some(f64::NEG_INFINITY)),
        (0.0, BinOp::Div, 0.0, Some(f64::NAN)),
        (-5.0, BinOp::Rem, 3.0, Some(-2.0)),
        (5.0, BinOp::Rem, 0.0, Some(f64::NAN)),
        (2.0, BinOp::Pow, 10.0, Some(1024.0)),
        (1.0, BinOp::Pow, f64::INFINITY, Some(f64::NAN)),
        (2.0, BinOp::Pow, 0.5, None),
        (2.0, BinOp::Pow, -1.0, None),
        (2.0, BinOp::Pow, 54.0, None),
        (1.0, BinOp::Shl, 33.0, Some(2.0)),
        (1.0, BinOp::Shl, -1.0, Some(-2147483648.0)),
        (-8.0, BinOp::Shr, 33.0, Some(-4.0)),
        (-1.0, BinOp::UShr, 0.0, Some(4294967295.0)),
        (-1.0, BinOp::UShr, 28.0, Some(15.0)),
        (5.0, BinOp::BitAnd, 3.0, Some(1.0)),
        (4294967296.0, BinOp::BitOr, 0.5, Some(0.0)),
        (5.0, BinOp::BitXor, f64::NAN, Some(5.0)),
    ];
    for (left, op, right, expected) in cases {
        let result = evaluate_numeric(op, left, right).map(f64::to_bits);
        assert_eq!(result, expected.map(f64::to_bits), "{left} {op:?} {right}");
    }
}

#[test]
fn other_operators_have_no_numeric_result() {
    let operators = [
        BinOp::Lt,
        BinOp::Le,
        BinOp::Gt,
        BinOp::Ge,
        BinOp::EqEq,
        BinOp::NotEq,
        BinOp::EqEqEq,
        BinOp::NotEqEq,
        BinOp::In,
        BinOp::Instanceof,
        BinOp::And,
        BinOp::Or,
        BinOp::Nullish,
        BinOp::Comma,
    ];
    for op in operators {
        assert_eq!(evaluate_numeric(op, 1.0, 2.0), None, "{op:?}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn relational_comparison() {
    assert_binary(&[
        (Num(1.0), BinOp::Lt, Num(2.0), Bool(true)),
        (Num(1.0), BinOp::Le, Num(1.0), Bool(true)),
        (Num(2.0), BinOp::Gt, Num(1.0), Bool(true)),
        (Num(1.0), BinOp::Ge, Num(2.0), Bool(false)),
        (Num(0.0), BinOp::Lt, Num(-0.0), Bool(false)),
        (Num(0.0), BinOp::Ge, Num(-0.0), Bool(true)),
        (Str("a"), BinOp::Lt, Str("b"), Bool(true)),
        (Str("a"), BinOp::Le, Str("a"), Bool(true)),
        (Str("ab"), BinOp::Lt, Str("abc"), Bool(true)),
        (Str("10"), BinOp::Lt, Str("9"), Bool(true)),
        (Str("10"), BinOp::Lt, Num(9.0), Bool(false)),
        (Num(2.0), BinOp::Lt, Str("10"), Bool(true)),
        (Str("a"), BinOp::Lt, Num(1.0), Bool(false)),
        (NAN, BinOp::Le, NAN, Bool(false)),
        (NAN, BinOp::Gt, NAN, Bool(false)),
        (NAN, BinOp::Ge, NAN, Bool(false)),
        (Undefined, BinOp::Ge, Undefined, Bool(false)),
        (Null, BinOp::Ge, Num(0.0), Bool(true)),
        (Bool(true), BinOp::Gt, Bool(false), Bool(true)),
        (Str("é"), BinOp::Lt, Str("z"), Unknown),
        (Str("a"), BinOp::Lt, Str("é"), Unknown),
        (Str("\u{ff5e}"), BinOp::Lt, Str("\u{1f600}"), Unknown),
        (Str("é"), BinOp::Lt, Num(1.0), Unknown),
        (Big("1"), BinOp::Lt, Num(2.0), Unknown),
        (Big("2"), BinOp::Gt, Big("1"), Unknown),
        (Str("1"), BinOp::Le, Big("2"), Unknown),
        (Big("1"), BinOp::Ge, Null, Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn loose_equality() {
    assert_binary(&[
        (Null, BinOp::EqEq, Undefined, Bool(true)),
        (Null, BinOp::EqEq, Null, Bool(true)),
        (Null, BinOp::EqEq, Num(0.0), Bool(false)),
        (Str(""), BinOp::EqEq, Null, Bool(false)),
        (Undefined, BinOp::EqEq, Big("0"), Bool(false)),
        (Str("1"), BinOp::EqEq, Num(1.0), Bool(true)),
        (Num(0.0), BinOp::EqEq, Str(" "), Bool(true)),
        (Str("a"), BinOp::EqEq, Num(0.0), Bool(false)),
        (Bool(true), BinOp::EqEq, Str("1"), Bool(true)),
        (Bool(true), BinOp::EqEq, Num(2.0), Bool(false)),
        (Bool(true), BinOp::EqEq, Bool(true), Bool(true)),
        (Str(""), BinOp::EqEq, Str("0"), Bool(false)),
        (Str("é"), BinOp::EqEq, Str("é"), Bool(true)),
        (Num(0.0), BinOp::EqEq, Num(-0.0), Bool(true)),
        (NAN, BinOp::EqEq, NAN, Bool(false)),
        (Big("1"), BinOp::EqEq, Big("1"), Bool(true)),
        (Big("1"), BinOp::EqEq, Big("2"), Bool(false)),
        (Num(1.0), BinOp::NotEq, Str("1"), Bool(false)),
        (Null, BinOp::NotEq, Num(0.0), Bool(true)),
        (Big("1"), BinOp::EqEq, Num(1.0), Unknown),
        (Str("1"), BinOp::EqEq, Big("1"), Unknown),
        (Big("1"), BinOp::EqEq, Bool(true), Unknown),
        (Big("1"), BinOp::NotEq, Num(1.0), Unknown),
        (Str("é"), BinOp::EqEq, Num(1.0), Unknown),
        (Bool(true), BinOp::NotEq, Str("é"), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn strict_equality() {
    assert_binary(&[
        (Num(1.0), BinOp::EqEqEq, Num(1.0), Bool(true)),
        (Num(0.0), BinOp::EqEqEq, Num(-0.0), Bool(true)),
        (NAN, BinOp::EqEqEq, NAN, Bool(false)),
        (Num(1.0), BinOp::EqEqEq, Str("1"), Bool(false)),
        (Bool(true), BinOp::EqEqEq, Num(1.0), Bool(false)),
        (Bool(true), BinOp::EqEqEq, Bool(true), Bool(true)),
        (Str("a"), BinOp::EqEqEq, Str("a"), Bool(true)),
        (Str("a"), BinOp::EqEqEq, Str("b"), Bool(false)),
        (Str("1"), BinOp::EqEqEq, Big("1"), Bool(false)),
        (Big("1"), BinOp::EqEqEq, Big("1"), Bool(true)),
        (Big("1"), BinOp::EqEqEq, Big("2"), Bool(false)),
        (Big("1"), BinOp::EqEqEq, Num(1.0), Bool(false)),
        (Null, BinOp::EqEqEq, Null, Bool(true)),
        (Undefined, BinOp::EqEqEq, Undefined, Bool(true)),
        (Null, BinOp::EqEqEq, Undefined, Bool(false)),
        (Num(1.0), BinOp::NotEqEq, Str("1"), Bool(true)),
        (NAN, BinOp::NotEqEq, NAN, Bool(true)),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn in_and_instanceof_are_unknown() {
    assert_binary(&[
        (Str("a"), BinOp::In, Str("a"), Unknown),
        (Num(1.0), BinOp::Instanceof, Num(1.0), Unknown),
    ]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn unknown_operands_stay_unknown() {
    let unary_operators = [
        UnOp::Plus,
        UnOp::Minus,
        UnOp::BitNot,
        UnOp::Not,
        UnOp::Typeof,
        UnOp::Delete,
        UnOp::PreInc,
        UnOp::PreDec,
        UnOp::PostInc,
        UnOp::PostDec,
    ];
    assert_unary(&unary_operators.map(|op| (op, Unknown, Unknown)));
    let binary_operators = [
        BinOp::Add,
        BinOp::Sub,
        BinOp::Mul,
        BinOp::Div,
        BinOp::Rem,
        BinOp::Pow,
        BinOp::Shl,
        BinOp::Shr,
        BinOp::UShr,
        BinOp::BitAnd,
        BinOp::BitOr,
        BinOp::BitXor,
        BinOp::Lt,
        BinOp::Le,
        BinOp::Gt,
        BinOp::Ge,
        BinOp::EqEq,
        BinOp::NotEq,
        BinOp::EqEqEq,
        BinOp::NotEqEq,
        BinOp::In,
        BinOp::Instanceof,
    ];
    assert_binary(&binary_operators.map(|op| (Unknown, op, Num(1.0), Unknown)));
    assert_binary(&binary_operators.map(|op| (Num(1.0), op, Unknown, Unknown)));
    assert_binary(&binary_operators.map(|op| (Unknown, op, Unknown, Unknown)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn templates_concatenate_texts_and_values() {
    assert_template(&["a"], &[], Str("a"));
    assert_template(&["a", "b"], &[Num(1.0)], Str("a1b"));
    assert_template(&["", "", ""], &[Null, Undefined], Str("nullundefined"));
    assert_template(&["", "-", ""], &[Bool(true), Big("1")], Str("true-1"));
    assert_template(&["", ""], &[Num(-0.0)], Str("0"));
    assert_template(&["", ""], &[Str("")], Str(""));
    assert_template(&["a", "b"], &[Unknown], Unknown);
    assert_template(&["a", "b", "c"], &[Num(1.0), Unknown], Unknown);
    assert_template(&[], &[], Unknown);
    assert_template(&["a", "b"], &[], Unknown);
    assert_template(&["a"], &[Num(1.0)], Unknown);
}

#[test]
#[cfg_attr(miri, ignore)]
fn long_strings_are_unknown() {
    with_evaluator(|evaluator| {
        let repeat = |count| Value::string(evaluator.atoms.intern(&vec![b'x'; count]));
        let half = repeat(MAX_STRING_BYTES / 2);
        let longest = evaluator.binary(BinOp::Add, half, half);
        assert_identical(evaluator, longest, repeat(MAX_STRING_BYTES));
        let sum = evaluator.binary(BinOp::Add, longest, repeat(1));
        assert_identical(evaluator, sum, Value::Unknown);
        let quarter = repeat(MAX_STRING_BYTES / 4);
        assert_identical(evaluator, evaluator.add_all([quarter; 4]), longest);
        assert_identical(evaluator, evaluator.add_all([quarter; 5]), Value::Unknown);

        let texts = [known::empty; 3];
        assert_identical(
            evaluator,
            evaluator.concatenate(&texts[..2], &[longest]),
            longest,
        );
        let template = evaluator.concatenate(&texts, &[longest, repeat(1)]);
        assert_identical(evaluator, template, Value::Unknown);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn strings_over_limit_are_counted() {
    with_evaluator(|evaluator| {
        let count = || evaluator.over_limit_count();
        let repeat = |length| Value::string(evaluator.atoms.intern(&vec![b'x'; length]));
        let half = repeat(MAX_STRING_BYTES / 2);
        let longest = evaluator.binary(BinOp::Add, half, half);
        evaluator.add_all([half, Value::Unknown]);
        evaluator.binary(BinOp::Add, longest, Value::Unknown);
        evaluator.binary(BinOp::Mul, longest, longest);
        evaluator.binary(BinOp::EqEqEq, longest, longest);
        assert_eq!(count(), 0);

        evaluator.binary(BinOp::Add, longest, repeat(1));
        assert_eq!(count(), 1);
        evaluator.add_all([half, half, half, half]);
        assert_eq!(count(), 2);
        evaluator.concatenate(&[known::empty; 3], &[longest, repeat(1)]);
        assert_eq!(count(), 3);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn zero_limit_keeps_no_computed_text() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let over_limit_count = Cell::new(0);
    let evaluator = Evaluator::new(&atoms, 0, &over_limit_count);
    assert_eq!(evaluator.max_string_bytes(), 0);
    let value = |literal: Literal| literal.to_value(&evaluator);

    let sum = evaluator.binary(BinOp::Add, value(Str("a")), value(Str("b")));
    assert_identical(&evaluator, sum, Value::Unknown);
    assert_eq!(evaluator.over_limit_count(), 1);
    let template = evaluator.concatenate(&[known::empty; 2], &[value(Num(1.0))]);
    assert_identical(&evaluator, template, Value::Unknown);
    assert_eq!(evaluator.over_limit_count(), 2);

    let empty = evaluator.binary(BinOp::Add, value(Str("")), value(Str("")));
    assert_identical(&evaluator, empty, value(Str("")));
    let literal = evaluator.concatenate(&[atoms.intern(b"a")], &[]);
    assert_identical(&evaluator, literal, value(Str("a")));
    let number = evaluator.binary(BinOp::Add, value(Num(1.0)), value(Num(2.0)));
    assert_identical(&evaluator, number, value(Num(3.0)));
    assert_eq!(evaluator.over_limit_count(), 2);
}

#[test]
#[cfg_attr(miri, ignore)]
fn over_limit_count_saturates() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let over_limit_count = Cell::new(u32::MAX - 1);
    let evaluator = Evaluator::new(&atoms, MAX_STRING_BYTES, &over_limit_count);
    evaluator.note_over_limit();
    assert_eq!(evaluator.over_limit_count(), u32::MAX);
    evaluator.note_over_limit();
    assert_eq!(evaluator.over_limit_count(), u32::MAX);
    assert_eq!(over_limit_count.get(), u32::MAX);
}

#[test]
#[cfg_attr(miri, ignore)]
fn surrogate_halves_join() {
    with_evaluator(|evaluator| {
        let lead = Value::string(evaluator.atoms.intern(b"\xED\xA0\xBD"));
        let trail = Value::string(evaluator.atoms.intern(b"\xED\xB8\x80"));
        let pair = Str("\u{1f600}").to_value(evaluator);
        assert_identical(evaluator, evaluator.binary(BinOp::Add, lead, trail), pair);
        let halves = evaluator.binary(BinOp::Add, trail, lead);
        assert!(!is_identical(evaluator, halves, pair));

        let after_lead = evaluator.binary(BinOp::Add, Str("a").to_value(evaluator), lead);
        let joined = evaluator.binary(BinOp::Add, after_lead, trail);
        assert_identical(evaluator, joined, Str("a\u{1f600}").to_value(evaluator));
        let separate = evaluator.binary(BinOp::Add, trail, Str("a").to_value(evaluator));
        let expected = Value::string(evaluator.atoms.intern(b"\xED\xB8\x80a"));
        assert_identical(evaluator, separate, expected);
    });
}
