use super::*;
use crate::ir::ids::Id;
use crate::ir::print::Printer;
use crate::ir::program::Program;

const EVERY_PART: &str = "undefined|null|true|int[0, 5]|symbol|bigint|function|absent|\"a\"|\"b\"\
    |L1|L3|nolayout|builtin(GlobalThis)|Array<number>|Map<string, L2>";

fn parse_alone<'t, R>(
    text: &'t str,
    parse: impl FnOnce(&mut Parser<'t>) -> Parsed<R>,
) -> (Parser<'t>, R) {
    let mut parser = Parser::new(text.as_bytes());
    let parsed = match parse(&mut parser) {
        Ok(parsed) => parsed,
        Err(error) => panic!("{text}: column {}: expected {}", error.column, error.expected),
    };
    assert!(parser.at(TokenKind::EndOfLine), "{text}");
    (parser, parsed)
}

fn print_parsed_type(text: &str) -> String {
    let (parser, id) = parse_alone(text, parse_type);
    let mut out = String::new();
    Printer::new(parser.program.name_tables(), &mut out).print_type(id);
    out
}

fn print_parsed_key(text: &str) -> String {
    let (parser, id) = parse_alone(text, parse_property_key);
    let mut out = String::new();
    Printer::new(parser.program.name_tables(), &mut out).print_property_key(id);
    out
}

#[track_caller]
fn assert_error<R>(
    text: &str,
    parse: impl FnOnce(&mut Parser<'_>) -> Parsed<R>,
    column: u32,
    expected: &'static str,
) {
    let error = ParseError {
        line: 1,
        column,
        expected,
    };
    let parsed = parse(&mut Parser::new(text.as_bytes()));
    assert_eq!(parsed.err(), Some(error), "{text}");
}

#[track_caller]
fn assert_type_error(text: &str, column: u32, expected: &'static str) {
    assert_error(text, parse_type, column, expected);
}

#[track_caller]
fn assert_key_error(text: &str, column: u32, expected: &'static str) {
    assert_error(text, parse_property_key, column, expected);
}

fn nest_arrays(depth: usize) -> String {
    format!("{}number{}", "Array<".repeat(depth), ">".repeat(depth))
}

#[test]
fn printed_types_parse_back() {
    let spellings = [
        "never",
        "undefined",
        "null",
        "undefined|null",
        "boolean",
        "true",
        "false",
        "null|false|string",
        "number",
        "string",
        "symbol",
        "bigint",
        "object",
        "function",
        "absent",
        "anything",
        "anything|absent",
        "null|object|absent",
        "undefined|null|boolean|number|string|symbol|bigint",
        "undefined|null|boolean|number|string|symbol|bigint|function",
        "int",
        "i32",
        "0",
        "7",
        "-3",
        "int[0, 5]",
        "int[-5, 9]",
        "int[0, 4294967295]",
        "int[0, 4611686018427387903]",
        "boolean|int[1, 2]|string",
        r#"""|"B"|"a"|"b""#,
        r#""a\"b\\c\n\u{7f}\u{e9}\u{1f600}\u{d800}""#,
        "L3",
        "L3|nolayout",
        "env L3",
        "builtin(GlobalThis)",
        "Array",
        "Map",
        "Promise",
        "Date",
        "Map<anything, number>",
        "Map<never, anything>",
        "Array<Array<number>>",
        "Map<string, Array<null|L2>>",
        "boolean|Boolean",
        EVERY_PART,
    ];
    for spelling in spellings {
        assert_eq!(print_parsed_type(spelling), spelling);
    }
}

#[test]
fn every_opaque_kind_parses_in_lower_case() {
    for kind in OpaqueKind::ALL {
        let spelling = kind.name().to_ascii_lowercase();
        let (parser, id) = parse_alone(&spelling, parse_type);
        assert_eq!(*parser.program.types.get(id), Type::opaque(kind));
        assert_type_error(kind.name(), 1, "a type");
    }
}

#[test]
fn well_known_spellings_have_well_known_ids() {
    let spellings = [
        ("never", TypeTable::NEVER),
        ("null|undefined", TypeTable::NULLISH),
        ("false|true", TypeTable::BOOLEAN),
        ("i32", TypeTable::INT32),
        ("int[-2147483648, 2147483647]", TypeTable::INT32),
        ("int[0, 4294967295]", TypeTable::UINT32),
        ("object", TypeTable::OBJECT),
        ("anything", TypeTable::ANYTHING),
        ("Array", TypeTable::ARRAY),
        ("Array<anything>", TypeTable::ARRAY),
    ];
    for (spelling, expected) in spellings {
        let (parser, id) = parse_alone(spelling, parse_type);
        assert_eq!(id, expected, "{spelling}");
        assert_eq!(parser.program.types.len(), TypeTable::WELL_KNOWN_COUNT, "{spelling}");
    }
}

#[test]
fn parts_in_any_order_normalize() {
    let spellings = [
        ("L4|L3|null", "null|L3|L4"),
        ("L1|L1", "L1"),
        ("true|false", "boolean"),
        ("absent|undefined", "undefined|absent"),
        (r#""b"|string|"a""#, "string"),
        (r#"L1|"b"|7|"a""#, r#"7|"a"|"b"|L1"#),
        ("object|L1|function|Array", "object"),
        ("function|function", "function"),
        ("L1|function", "function|L1"),
        ("anything|L1|\"a\"", "anything"),
        ("Map<string, number>|Array<number>", "Array<number>|Map<string, number>"),
        ("Array<number>|Array<string>", "Array<number|string>"),
    ];
    for (written, printed) in spellings {
        assert_eq!(print_parsed_type(written), printed, "{written}");
    }
}

#[test]
fn contents_are_interned_before_class() {
    let (parser, id) = parse_alone("Map<L1, Array<L2>>", parse_type);
    let types = &parser.program.types;
    let [map] = &types.get(id).classes[..] else {
        panic!("the type has one class part");
    };
    let [key, value] = map.contents[..] else {
        panic!("a map has two contents");
    };
    assert!(key < value && value < id);
    assert_eq!(*types.get(key), Type::layout(LayoutId::new(1)));
    assert_eq!(id.index() + 1, types.len());
}

#[test]
fn number_parts_are_exclusive() {
    let expected = "at most one number part in a type";
    assert_type_error("number|i32", 8, expected);
    assert_type_error("1|2", 3, expected);
    assert_type_error("int|int", 5, expected);
    assert_type_error("int[0, 1]|number", 11, expected);
    assert_type_error("number|number", 8, expected);
    assert_type_error("anything|number", 10, expected);
    assert_type_error("7|anything", 3, expected);
    assert_eq!(print_parsed_type("Array<number>|7"), "7|Array<number>");
}

#[test]
fn ranges_are_nonempty_and_tracked() {
    let expected = "a nonempty range of tracked integers";
    assert_type_error("int[5, 1]", 1, expected);
    assert_type_error("null|int[5, 1]", 6, expected);
    assert_type_error("4611686018427387904", 1, expected);
    assert_type_error("int[0, 4611686018427387904]", 1, expected);
    assert_type_error("int[-4611686018427387904, 0]", 1, expected);
    assert_eq!(print_parsed_type("int[-4611686018427387903, 4611686018427387903]"), "int");
    assert_eq!(print_parsed_type("int[5, 5]"), "5");
}

#[test]
fn range_syntax_errors_name_offending_token() {
    assert_type_error("int[0 5]", 7, ",");
    assert_type_error("int[a, 1]", 5, "an integer");
    assert_type_error("int[0, 1.5]", 8, "an integer");
    assert_type_error("int[0, 1", 9, "]");
    assert_type_error("1.5", 1, "a type");
    assert_type_error("-0", 1, "a type");
}

#[test]
fn never_is_alone() {
    assert_type_error("never|null", 6, "never as the only part of a type");
    assert_type_error("null|never", 6, "a type");
    assert_type_error("Array<never|null>", 12, "never as the only part of a type");
}

#[test]
fn internal_part_is_alone() {
    assert_type_error("env L1|null", 8, EXPECTED_INTERNAL_PART_ALONE);
    assert_type_error("null|env L1", 6, EXPECTED_INTERNAL_PART_ALONE);
    assert_type_error("exception|null", 11, EXPECTED_INTERNAL_PART_ALONE);
    assert_type_error("null|exception", 6, EXPECTED_INTERNAL_PART_ALONE);
    assert_type_error("env L1|env L1", 8, EXPECTED_INTERNAL_PART_ALONE);
    assert_eq!(print_parsed_type("Array<exception>"), "Array<exception>");
}

#[test]
fn class_contents_match_arity() {
    let expected = "one type per contents slot of the class";
    assert_type_error("Array<number, string>", 1, expected);
    assert_type_error("Map<string>", 1, expected);
    assert_type_error("null|Map<string>", 6, expected);
    assert_type_error("Array<Map<string>>", 7, expected);
    assert_type_error("Date<number>", 1, expected);
    assert_type_error("Array<>", 7, "a type");
    assert_type_error("Array<number", 13, ", or >");
    assert_type_error("Array<number string>", 14, ", or >");
}

#[test]
fn deep_types_fail() {
    let limit = MAX_TYPE_NESTING_IN_TEXT as usize;
    let deepest = nest_arrays(limit);
    assert_eq!(print_parsed_type(&deepest), deepest);
    let column = ("Array<".len() * (limit + 1) + 1) as u32;
    assert_type_error(&nest_arrays(limit + 1), column, "type nesting within the limit");
}

#[test]
fn unknown_word() {
    assert_type_error("frobnicate", 1, "a type");
    assert_type_error("null|Frobnicate", 6, "a type");
    assert_type_error("array", 1, "a type");
    assert_type_error("L", 1, "a type");
    assert_type_error("L1x", 1, "a type");
    assert_type_error("L4294967295", 1, "a type");
    assert_type_error("", 1, "a type");
    assert_type_error("null|", 6, "a type");
    assert_type_error("|null", 1, "a type");
    assert_type_error("@@iterator", 1, "a type");
}

#[test]
fn type_word_operands_are_required() {
    assert_type_error("env", 4, "a layout id");
    assert_type_error("env f1", 5, "a layout id");
    assert_type_error("builtin GlobalThis", 9, "(");
    assert_type_error("builtin(Frobnicate)", 9, "a built-in");
    assert_type_error("builtin(GlobalThis", 19, ")");
    assert_type_error(r#""\q""#, 1, "a string with valid escapes");
}

#[test]
fn printed_keys_parse_back() {
    let spellings = [
        r#""x""#,
        r#""""#,
        r#""0""#,
        r#"@"x""#,
        r##"#"x"@L2"##,
        "@@iterator",
        "symbol@m0:120",
        "symbol@m3:4294967294",
        r#"symbol("d\"")@m3:0"#,
        r#"symbol("")@m0:1"#,
    ];
    for spelling in spellings {
        assert_eq!(print_parsed_key(spelling), spelling);
    }
}

#[test]
fn parsed_keys_equal_constructed_keys() {
    let (parser, id) = parse_alone(r##"#"x"@L2"##, parse_property_key);
    let x = parser.program.strings.find(b"x").expect("the text is interned");
    let private_name = PropertyKey::from_private_name(x, LayoutId::new(2));
    assert_eq!(*parser.program.property_keys.get(id), private_name);

    let (parser, id) = parse_alone(r#"symbol("x")@m1:7"#, parse_property_key);
    let x = parser.program.strings.find(b"x").expect("the description is interned");
    let symbol = PropertyKey::from_created_symbol(ModuleId::new(1), 7, Some(x));
    assert_eq!(*parser.program.property_keys.get(id), symbol);
}

#[test]
fn every_well_known_symbol_parses_back() {
    for symbol in WellKnownSymbol::ALL {
        let mut program = Program::new();
        let key = PropertyKey::from_well_known_symbol(symbol);
        let id = program.property_keys.intern(key);
        let mut spelling = String::new();
        Printer::new(program.name_tables(), &mut spelling).print_property_key(id);

        let (parser, id) = parse_alone(&spelling, parse_property_key);
        assert_eq!(*parser.program.property_keys.get(id), key, "{spelling}");
        assert_key_error(&format!("@@{}", symbol.name()), 3, "a well-known symbol");
    }
}

#[test]
fn equal_keys_have_one_id() {
    let mut parser = Parser::new(br#""x" "x" @"x" "y""#);
    let ids = [(); 4].map(|()| parse_property_key(&mut parser).map(Id::index));
    assert_eq!(ids, [Ok(0), Ok(0), Ok(1), Ok(2)]);
    assert_eq!(parser.program.strings.len(), 2);
}

#[test]
fn registered_symbol_is_engine_only() {
    assert_key_error(r#"Symbol.for("x")"#, 1, "a property key");
    assert_key_error("x", 1, "a property key");
    assert_key_error("5", 1, "a property key");
    assert_key_error("", 1, "a property key");
}

#[test]
fn private_name_needs_owner() {
    assert_key_error(r##"#"x""##, 5, "@");
    assert_key_error(r##"#"x"@"##, 6, "a layout id");
    assert_key_error(r##"#"x"@m1"##, 6, "a layout id");
    assert_key_error(r##"#"x" L1"##, 6, "@");
}

#[test]
fn symbol_names_are_checked() {
    assert_key_error("@@frobnicate", 3, "a well-known symbol");
    assert_key_error("@@", 3, "a well-known symbol");
    assert_key_error("@@\"iterator\"", 3, "a well-known symbol");
    assert_key_error("@x", 2, "a string");
    assert_key_error(r#"@"\q""#, 2, "a string with valid escapes");
}

#[test]
fn created_symbol_needs_creation_site() {
    assert_key_error("symbol", 7, "@");
    assert_key_error("symbol@", 8, "a module id");
    assert_key_error("symbol@L0:1", 8, "a module id");
    assert_key_error("symbol@m0", 10, ":");
    assert_key_error("symbol@m0:", 11, "an unsigned 32-bit integer");
    assert_key_error("symbol@m0:-1", 11, "an unsigned 32-bit integer");
    assert_key_error("symbol@m0:4294967295", 11, "a position below 4294967295");
    assert_key_error("symbol@m0:4294967296", 11, "an unsigned 32-bit integer");
    assert_key_error("symbol(x)@m0:1", 8, "a string");
    assert_key_error("symbol(\"d\"@m0:1", 11, ")");
}
