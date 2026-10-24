use super::*;
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::ir::ids::ModuleId;
use crate::ir::program::Program;
use crate::ir::property_keys::PropertyKey;
use crate::ir::testing::{array_of, layout, print_with};
use crate::ir::types::OpaqueKind;

fn quoted(bytes: &[u8]) -> String {
    let mut out = String::new();
    print_quoted(&mut out, bytes);
    out
}

fn double_text(value: f64) -> String {
    print_with(&Program::new(), |printer| printer.print_double(value))
}

fn type_text(program: &Program, id: TypeId) -> String {
    print_with(program, |printer| printer.print_type(id))
}

fn interned_type_text(program: &mut Program, ty: Type) -> String {
    let id = program.types.intern(ty);
    type_text(program, id)
}

fn key_text(program: &mut Program, key: PropertyKey) -> String {
    let id = program.property_keys.intern(key);
    print_with(program, |printer| printer.print_property_key(id))
}

#[test]
fn quoted_escapes() {
    let text = "a\"b\\c\n\u{7f}\u{e9}\u{1f600}".as_bytes();
    let lone_surrogate: &[u8] = b"\xED\xA0\x80";
    let expected = r#""a\"b\\c\n\u{7f}\u{e9}\u{1f600}\u{d800}""#;
    assert_eq!(quoted(&[text, lone_surrogate].concat()), expected);
}

#[test]
fn printable_ascii_is_not_escaped() {
    assert_eq!(quoted(b""), "\"\"");
    assert_eq!(quoted(b" !#[]{}|~"), "\" !#[]{}|~\"");
    assert_eq!(quoted(b"az AZ 09"), "\"az AZ 09\"");
}

#[test]
fn other_code_points_have_no_leading_zero() {
    assert_eq!(quoted(b"\x00\t\r\x1f"), r#""\u{0}\u{9}\u{d}\u{1f}""#);
    assert_eq!(
        quoted("\u{80}\u{fffd}\u{10ffff}".as_bytes()),
        r#""\u{80}\u{fffd}\u{10ffff}""#
    );
    assert_eq!(quoted(b"\xED\xBF\xBF"), r#""\u{dfff}""#);
}

#[test]
fn ill_formed_byte_is_a_hex_escape() {
    assert_eq!(quoted(b"\x80"), r#""\x80""#);
    assert_eq!(quoted(b"a\xC3A"), r#""a\xc3A""#);
    assert_eq!(quoted(b"\xED\xA0"), r#""\xed\xa0""#);
    assert_eq!(quoted(b"\xC0\x80\xFF"), r#""\xc0\x80\xff""#);
    assert_eq!(quoted(b"\xF0\x9F\x98\xC3\xA9"), r#""\xf0\x9f\x98\u{e9}""#);
}

#[test]
fn bytes_escape_everything_else() {
    let bytes_text =
        |bytes: &[u8]| print_with(&Program::new(), |printer| printer.print_bytes(bytes));
    assert_eq!(
        bytes_text(b"a z~\"\\\n\x00\x1f\x7f\xc3\xa9\xff"),
        r#""a z~\x22\x5c\x0a\x00\x1f\x7f\xc3\xa9\xff""#
    );
    assert_eq!(bytes_text(b""), "\"\"");
}

#[test]
fn doubles() {
    let doubles = [
        (0.0, "0"),
        (-0.0, "-0"),
        (1.5, "1.5"),
        (100.0, "100"),
        (-7.0, "-7"),
        (1e21, "1e+21"),
        (-2.5e-7, "-2.5e-7"),
        (5e-324, "5e-324"),
        (f64::MAX, "1.7976931348623157e+308"),
        (f64::NAN, "NaN"),
        (f64::INFINITY, "Infinity"),
        (f64::NEG_INFINITY, "-Infinity"),
    ];
    for (value, expected) in doubles {
        assert_eq!(double_text(value), expected);
    }
}

#[test]
fn keys() {
    let mut program = Program::new();
    let x = program.strings.intern(b"x");
    let description = program.strings.intern(b"d\"");
    let module = ModuleId::new(0);
    let keys = [
        (PropertyKey::from_text(x), r#""x""#),
        (PropertyKey::from_engine_private_name(x), r#"@"x""#),
        (PropertyKey::from_private_name(x, layout(2)), r#"#"x"@L2"#),
        (
            PropertyKey::from_created_symbol(module, 120, None),
            "symbol@m0:120",
        ),
        (
            PropertyKey::from_created_symbol(ModuleId::new(3), 0, Some(description)),
            r#"symbol("d\"")@m3:0"#,
        ),
    ];
    for (key, expected) in keys {
        assert_eq!(key_text(&mut program, key), expected);
    }
}

#[test]
fn well_known_symbols_start_in_lower_case() {
    let mut program = Program::new();
    let symbols = [
        (WellKnownSymbol::Iterator, "@@iterator"),
        (WellKnownSymbol::AsyncDispose, "@@asyncDispose"),
        (WellKnownSymbol::ToPrimitive, "@@toPrimitive"),
        (WellKnownSymbol::IsConcatSpreadable, "@@isConcatSpreadable"),
    ];
    for (symbol, expected) in symbols {
        let key = PropertyKey::from_well_known_symbol(symbol);
        assert_eq!(key_text(&mut program, key), expected);
    }
}

#[test]
fn missing_key_field_prints_a_minus() {
    let mut program = Program::new();
    let kinds = [
        (PropertyKeyKind::Text, "-"),
        (PropertyKeyKind::EnginePrivateName, "@-"),
        (PropertyKeyKind::PrivateName, "#-@-"),
        (PropertyKeyKind::WellKnownSymbol, "@@-"),
        (PropertyKeyKind::CreatedSymbol, "symbol@-:-"),
    ];
    for (kind, expected) in kinds {
        let key = PropertyKey {
            kind,
            ..PropertyKey::default()
        };
        assert_eq!(key_text(&mut program, key), expected);
    }
}

#[test]
fn never() {
    assert_eq!(type_text(&Program::new(), TypeTable::NEVER), "never");
}

#[test]
fn well_known_types() {
    let program = Program::new();
    let types = [
        (TypeTable::UNDEFINED, "undefined"),
        (TypeTable::NULL, "null"),
        (TypeTable::NULLISH, "undefined|null"),
        (TypeTable::NUMBER, "number"),
        (TypeTable::STRING, "string"),
        (TypeTable::SYMBOL, "symbol"),
        (TypeTable::BIGINT, "bigint"),
        (TypeTable::OBJECT, "object"),
        (TypeTable::FUNCTION, "function"),
        (TypeTable::ABSENT, "absent"),
    ];
    for (id, expected) in types {
        assert_eq!(type_text(&program, id), expected);
    }
}

#[test]
fn anything_absorbs_words() {
    assert_eq!(type_text(&Program::new(), TypeTable::ANYTHING), "anything");
}

#[test]
fn every_primitive_without_every_object_is_spelled_out() {
    let mut program = Program::new();
    let primitives = Type::primitives(Primitives::OBSERVABLE);
    let words = "undefined|null|boolean|number|string|symbol|bigint";
    assert_eq!(interned_type_text(&mut program, primitives.clone()), words);
    let with_functions = Type {
        flags: TypeFlags::ANY_FUNCTION,
        ..primitives
    };
    let printed = interned_type_text(&mut program, with_functions);
    assert_eq!(printed, format!("{words}|function"));
}

#[test]
fn anything_with_absent() {
    let mut program = Program::new();
    let id = program.types.union(TypeTable::ANYTHING, TypeTable::ABSENT);
    assert_eq!(type_text(&program, id), "anything|absent");
}

#[test]
fn absent_follows_object_word() {
    let mut program = Program::new();
    let id = program
        .types
        .union_all([TypeTable::ABSENT, TypeTable::OBJECT, TypeTable::NULL]);
    assert_eq!(type_text(&program, id), "null|object|absent");
}

#[test]
fn boolean_halves() {
    let mut program = Program::new();
    assert_eq!(type_text(&program, TypeTable::BOOLEAN), "boolean");
    let halves = [
        (Primitives::TRUE, "true"),
        (Primitives::FALSE, "false"),
        (
            Primitives::NULL | Primitives::FALSE | Primitives::STRING,
            "null|false|string",
        ),
    ];
    for (primitives, expected) in halves {
        let printed = interned_type_text(&mut program, Type::primitives(primitives));
        assert_eq!(printed, expected);
    }
}

#[test]
fn integer_spellings() {
    let mut program = Program::new();
    let ranges = [
        ((-MAX_TRACKED_INTEGER, MAX_TRACKED_INTEGER), "int"),
        ((i64::from(i32::MIN), i64::from(i32::MAX)), "i32"),
        ((0, 0), "0"),
        ((7, 7), "7"),
        ((-3, -3), "-3"),
        ((0, 5), "int[0, 5]"),
        ((-5, 9), "int[-5, 9]"),
        ((0, i64::from(u32::MAX)), "int[0, 4294967295]"),
        ((0, MAX_TRACKED_INTEGER), "int[0, 4611686018427387903]"),
    ];
    for ((minimum, maximum), expected) in ranges {
        let printed = interned_type_text(&mut program, Type::integers(minimum, maximum));
        assert_eq!(printed, expected);
    }
}

#[test]
fn range_prints_in_number_position() {
    let mut program = Program::new();
    let ty = Type {
        primitives: Primitives::BOOLEAN | Primitives::STRING,
        ..Type::integers(1, 2)
    };
    assert_eq!(
        interned_type_text(&mut program, ty),
        "boolean|int[1, 2]|string"
    );
}

#[test]
fn literals_print_in_byte_order() {
    let mut program = Program::new();
    let texts: [&[u8]; 4] = [b"b", b"a", b"", b"B"];
    let [b, a, empty, upper] = texts.map(|text| program.strings.intern(text));
    assert!(b < a);
    let ty = Type {
        strings: vec![b, a, empty, upper],
        ..Type::default()
    };
    assert_eq!(interned_type_text(&mut program, ty), r#"""|"B"|"a"|"b""#);
}

#[test]
fn object_parts() {
    let mut program = Program::new();
    let types = [
        (Type::layout(layout(3)), "L3"),
        (Type::environment(layout(3)), "env L3"),
        (Type::builtin(BuiltinId::GlobalThis), "builtin(GlobalThis)"),
    ];
    for (ty, expected) in types {
        assert_eq!(interned_type_text(&mut program, ty), expected);
    }
}

#[test]
fn parts_print_in_order() {
    let mut program = Program::new();
    let [b, a] = [b"b", b"a"].map(|text| program.strings.intern(text));
    let object = program.types.intern(Type::layout(layout(2)));
    let classes = [
        array_of(TypeTable::NUMBER).classes,
        Type::class(BuiltinClass::Map, &[TypeTable::STRING, object]).classes,
    ];
    let ty = Type {
        primitives: Primitives::UNDEFINED
            | Primitives::NULL
            | Primitives::TRUE
            | Primitives::SYMBOL
            | Primitives::BIG_INT
            | Primitives::ABSENT,
        flags: TypeFlags::HAS_INTEGERS
            | TypeFlags::ANY_FUNCTION
            | TypeFlags::HAS_MEMBERS_WITHOUT_LAYOUT,
        strings: vec![b, a],
        layouts: vec![layout(3), layout(1)],
        classes: classes.concat(),
        builtins: vec![BuiltinId::GlobalThis],
        ..Type::integers(0, 5)
    };
    let expected = "undefined|null|true|int[0, 5]|symbol|bigint|function|absent|\"a\"|\"b\"|L1|L3\
        |nolayout|builtin(GlobalThis)|Array<number>|Map<string, L2>";
    assert_eq!(interned_type_text(&mut program, ty), expected);
}

#[test]
fn class_without_known_contents_has_no_brackets() {
    let mut program = Program::new();
    let anything = TypeTable::ANYTHING;
    assert_eq!(type_text(&program, TypeTable::ARRAY), "Array");
    let types = [
        (Type::class(BuiltinClass::Map, &[anything, anything]), "Map"),
        (Type::class(BuiltinClass::Promise, &[anything]), "Promise"),
        (Type::class(BuiltinClass::Date, &[]), "Date"),
        (
            Type::class(BuiltinClass::Map, &[anything, TypeTable::NUMBER]),
            "Map<anything, number>",
        ),
        (
            Type::class(BuiltinClass::Map, &[TypeTable::NEVER, anything]),
            "Map<never, anything>",
        ),
    ];
    for (ty, expected) in types {
        assert_eq!(interned_type_text(&mut program, ty), expected);
    }
}

#[test]
fn nested_class_contents() {
    let mut program = Program::new();
    let numbers = program.types.intern(array_of(TypeTable::NUMBER));
    assert_eq!(
        interned_type_text(&mut program, array_of(numbers)),
        "Array<Array<number>>"
    );

    let object = program.types.intern(Type::layout(layout(2)));
    let nullable = program.types.union(object, TypeTable::NULL);
    let nullables = program.types.intern(array_of(nullable));
    let map = Type::class(BuiltinClass::Map, &[TypeTable::STRING, nullables]);
    assert_eq!(
        interned_type_text(&mut program, map),
        "Map<string, Array<null|L2>>"
    );
}

#[test]
fn opaque_is_lower_case() {
    let mut program = Program::new();
    let kinds = [
        (OpaqueKind::IteratorState, "iteratorstate"),
        (OpaqueKind::Enumerator, "enumerator"),
        (OpaqueKind::Exception, "exception"),
        (OpaqueKind::ClassToken, "classtoken"),
    ];
    for (kind, expected) in kinds {
        assert_eq!(
            interned_type_text(&mut program, Type::opaque(kind)),
            expected
        );
    }
}

#[test]
fn invalid_ids_print() {
    let mut program = Program::new();
    program.strings.intern(b"a");
    let printed = print_with(&program, |printer| printer.print_string(StringId::new(1)));
    assert_eq!(printed, "<invalid string 1>");
    let printed = print_with(&program, |printer| {
        printer.print_property_key(PropertyKeyId::new(0));
    });
    assert_eq!(printed, "<invalid key 0>");
    let past_types = TypeId::new(TypeTable::WELL_KNOWN_COUNT);
    let expected = format!("<invalid type {}>", TypeTable::WELL_KNOWN_COUNT);
    assert_eq!(type_text(&program, past_types), expected);
}

#[test]
fn invalid_ids_inside_names_print() {
    let mut program = Program::new();
    let a = program.strings.intern(b"a");
    let missing = StringId::new(7);
    assert_eq!(
        key_text(&mut program, PropertyKey::from_text(missing)),
        "<invalid string 7>"
    );
    let key = PropertyKey::from_created_symbol(ModuleId::new(0), 1, Some(missing));
    assert_eq!(
        key_text(&mut program, key),
        "symbol(<invalid string 7>)@m0:1"
    );
    let literals = Type {
        strings: vec![a, missing],
        ..Type::default()
    };
    assert_eq!(
        interned_type_text(&mut program, literals),
        "\"a\"|<invalid string 7>"
    );
}

#[test]
fn content_not_below_holder_prints_invalid() {
    let program = Program::new();
    let part = ClassPart {
        builtin_class: BuiltinClass::Map,
        contents: vec![TypeTable::NUMBER, TypeTable::STRING],
    };
    let printed = print_with(&program, |printer| {
        printer.print_class_part(TypeTable::STRING, &part);
    });
    assert_eq!(printed, "Map<number, <invalid type 8>>");
}
