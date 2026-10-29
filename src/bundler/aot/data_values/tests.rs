use bun_aot::statistics::can_be_lowered;
use bun_ast::{Ref, Source};
use bun_core::strings::contains;
use bun_parsers::json::{parse_json_into_arena, parse_utf8};
use bun_sema::session::Session;

use super::super::services::with_ast_scope;
use super::*;

const NESTING_DEPTH: usize = 100_000;

fn with_scope(test: impl for<'s> FnOnce(&Interner<'s>, &'s Arena, &Arena)) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    with_ast_scope(|scratch| test(&atoms, session.arena(), scratch));
}

fn parse_tape(text: &'static [u8], scratch: &Arena) -> Expr {
    let source = Source::init_path_string(b"/value.json", text);
    parse_json_into_arena(&source, &mut Log::default(), scratch)
        .unwrap_or_else(|_| panic!("valid JSON"))
}

fn parse_tree(text: &'static [u8], scratch: &Arena) -> Expr {
    let source = Source::init_path_string(b"/value.json", text);
    parse_utf8(&source, &mut Log::default(), scratch).unwrap_or_else(|_| panic!("valid JSON"))
}

fn write_error(root: &Expr, scratch: &Arena) -> NotData {
    match write_expr(root, scratch, &mut PortableValue::default()) {
        Err(error) => error,
        Ok(()) => panic!("expected an error"),
    }
}

fn string_expr(text: &'static [u8]) -> Expr {
    Expr::init(E::EString::init(text), Loc::EMPTY)
}

fn number_expr(value: f64) -> Expr {
    Expr::init(E::Number::new(value), Loc::EMPTY)
}

fn object_with(property: G::Property) -> Expr {
    let mut properties: G::PropertyList = AstAlloc::vec();
    properties.push(property);
    let object = E::Object {
        properties,
        ..Default::default()
    };
    Expr::init(object, Loc::EMPTY)
}

fn object_with_keys(keys: &[Expr]) -> Expr {
    let mut properties: G::PropertyList = AstAlloc::vec();
    properties.extend(keys.iter().enumerate().map(|(index, key)| G::Property {
        key: Some(*key),
        value: Some(number_expr(index as f64)),
        ..G::Property::default()
    }));
    let object = E::Object {
        properties,
        ..Default::default()
    };
    Expr::init(object, Loc::EMPTY)
}

fn array_from(elements: &[Expr]) -> Expr {
    let mut items: ExprNodeList = AstAlloc::vec();
    items.extend(elements.iter().copied());
    let array = E::Array {
        items,
        ..Default::default()
    };
    Expr::init(array, Loc::EMPTY)
}

fn array_of(first: Expr, second: Expr) -> Expr {
    array_from(&[first, second])
}

fn object_from(values: &[Expr]) -> Expr {
    let mut properties: G::PropertyList = AstAlloc::vec();
    properties.extend(values.iter().enumerate().map(|(index, value)| G::Property {
        key: Some(number_expr(index as f64)),
        value: Some(*value),
        ..G::Property::default()
    }));
    let object = E::Object {
        properties,
        ..Default::default()
    };
    Expr::init(object, Loc::EMPTY)
}

fn object_with_value_count(value_count: usize) -> Expr {
    let mut shared_values = vec![(number_expr(1.0), 1)];
    while let Some(&(value, count)) = shared_values.last()
        && 2 * count + 1 < value_count
    {
        shared_values.push((array_of(value, value), 2 * count + 1));
    }
    let mut remaining = value_count - 1;
    let mut members = Vec::new();
    for &(value, count) in shared_values.iter().rev() {
        while remaining >= count {
            members.push(value);
            remaining -= count;
        }
    }
    object_from(&members)
}

#[derive(Default)]
struct ValueCounter {
    values: usize,
    keys: usize,
}

impl ValueSink for ValueCounter {
    fn undefined(&mut self) {
        self.values += 1;
    }

    fn null(&mut self) {
        self.values += 1;
    }

    fn boolean(&mut self, _value: bool) {
        self.values += 1;
    }

    fn number(&mut self, _value: f64) {
        self.values += 1;
    }

    fn string(&mut self, _text: &[u8]) {
        self.values += 1;
    }

    fn big_int(&mut self, _digits: &[u8]) {
        self.values += 1;
    }

    fn array(&mut self, _length: usize) {
        self.values += 1;
    }

    fn key(&mut self, _text: &[u8]) {
        self.keys += 1;
    }

    fn object(&mut self, _length: usize) {
        self.values += 1;
    }
}

fn big_int_expr(digits: &'static [u8]) -> Expr {
    let value = E::Str::new(digits);
    Expr::init(E::BigInt { value }, Loc::EMPTY)
}

fn reported_text(error: NotData) -> Vec<u8> {
    let mut log = Log::default();
    report_not_data(&mut log, b"/project/value.toml", "the value", error);
    assert_eq!(log.errors, 1);
    assert_eq!(log.msgs.len(), 1);
    log.msgs[0].data.text.to_vec()
}

fn nesting_depth(mut value: &DataValue<'_>) -> usize {
    let mut depth = 0;
    while let DataValue::Array([inner]) = value {
        depth += 1;
        value = inner;
    }
    depth
}

#[test]
#[cfg_attr(miri, ignore)]
fn tape_and_tree_give_equal_values() {
    with_scope(|atoms, arena, scratch| {
        let text = br#"{"a":[1,-2.5,null,true,"x"],"b":{}}"#;
        let tape = data_value_from_expr(&parse_tape(text, scratch), scratch, arena, atoms);
        let tree = data_value_from_expr(&parse_tree(text, scratch), scratch, arena, atoms);
        let tape = tape.expect("a tape is data");
        assert_eq!(tape, tree.expect("a tree is data"));
        let items = [
            DataValue::Number(1.0),
            DataValue::Number(-2.5),
            DataValue::Null,
            DataValue::Boolean(true),
            DataValue::String(atoms.intern(b"x")),
        ];
        let properties = [
            (atoms.intern(b"a"), DataValue::Array(&items)),
            (atoms.intern(b"b"), DataValue::Object(&[])),
        ];
        assert_eq!(*tape, DataValue::Object(&properties));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn repeated_key_keeps_first_position_and_last_value() {
    with_scope(|atoms, arena, scratch| {
        let root = parse_tape(br#"{"a":1,"b":2,"a":3}"#, scratch);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let expected = [
            (atoms.intern(b"a"), DataValue::Number(3.0)),
            (atoms.intern(b"b"), DataValue::Number(2.0)),
        ];
        assert_eq!(*value, DataValue::Object(&expected));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn repeated_key_in_large_object() {
    with_scope(|atoms, arena, _| {
        let mut builder = DataValueBuilder::new(arena, atoms);
        let names: Vec<Vec<u8>> = (0..19).map(|i| format!("k{i}").into_bytes()).collect();
        for (index, name) in names.iter().enumerate() {
            builder.number(index as f64);
            builder.key(name);
        }
        builder.number(100.0);
        builder.key(&names[3]);
        builder.object(20);
        let DataValue::Object(properties) = *builder.finish() else {
            panic!("expected an object");
        };
        assert_eq!(properties.len(), 19);
        assert_eq!(
            properties[3],
            (atoms.intern(b"k3"), DataValue::Number(100.0))
        );
        assert_eq!(properties[4], (atoms.intern(b"k4"), DataValue::Number(4.0)));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn scalar_keys_become_property_keys() {
    with_scope(|atoms, arena, scratch| {
        let root = object_with_keys(&[
            number_expr(404.0),
            number_expr(-0.0),
            number_expr(1.5),
            Expr::init(E::Boolean { value: true }, Loc::EMPTY),
            Expr::init(E::Boolean { value: false }, Loc::EMPTY),
            Expr::init(E::Null, Loc::EMPTY),
        ]);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let names: [&[u8]; 6] = [b"404", b"0", b"1.5", b"true", b"false", b"null"];
        let expected: Vec<(Atom, DataValue<'_>)> = names
            .iter()
            .enumerate()
            .map(|(index, name)| (atoms.intern(name), DataValue::Number(index as f64)))
            .collect();
        assert_eq!(*value, DataValue::Object(&expected));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn number_key_repeats_string_key() {
    with_scope(|atoms, arena, scratch| {
        let root = object_with_keys(&[string_expr(b"1"), string_expr(b"a"), number_expr(1.0)]);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let expected = [
            (atoms.intern(b"1"), DataValue::Number(2.0)),
            (atoms.intern(b"a"), DataValue::Number(1.0)),
        ];
        assert_eq!(*value, DataValue::Object(&expected));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn collection_key_is_not_data() {
    with_scope(|_, _, scratch| {
        let keys = [
            array_from(&[]),
            Expr::init(E::Object::default(), Loc::EMPTY),
            Expr::init(E::Undefined, Loc::EMPTY),
            big_int_expr(b"1"),
        ];
        for key in keys {
            let root = object_with_keys(&[key]);
            assert!(matches!(write_error(&root, scratch), NotData::Expression));
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn ill_formed_bytes_become_replacement_characters() {
    with_scope(|atoms, arena, scratch| {
        let text = b"{\"k\xFF\":\"caf\xE9\"}";
        let expected = [(
            atoms.intern("k\u{FFFD}".as_bytes()),
            DataValue::String(atoms.intern("caf\u{FFFD}".as_bytes())),
        )];
        for root in [parse_tape(text, scratch), parse_tree(text, scratch)] {
            let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
            assert_eq!(*value, DataValue::Object(&expected));
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn escaped_surrogates_stay_canonical() {
    with_scope(|atoms, arena, scratch| {
        let text = br#"["\uD800","\uD83D\uDE00"]"#;
        let expected = [
            DataValue::String(atoms.intern(b"\xED\xA0\x80")),
            DataValue::String(atoms.intern("\u{1F600}".as_bytes())),
        ];
        for root in [parse_tape(text, scratch), parse_tree(text, scratch)] {
            let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
            assert_eq!(*value, DataValue::Array(&expected));
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn surrogate_halves_of_rope_parts_are_joined() {
    with_scope(|atoms, arena, scratch| {
        let Data::EString(tail) = string_expr(b"\xED\xB8\x80").data else {
            panic!("expected a string");
        };
        let mut head = E::EString::init(b"\xED\xA0\xBD");
        head.next = Some(tail);
        head.end = Some(tail);
        head.rope_len = 6;
        let root = Expr::init(head, Loc::EMPTY);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        assert_eq!(
            *value,
            DataValue::String(atoms.intern("\u{1F600}".as_bytes()))
        );
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn well_formed_text_is_borrowed() {
    assert!(matches!(
        to_canonical_wtf8("caf\u{E9}".as_bytes()),
        Cow::Borrowed(_)
    ));
    assert!(matches!(to_canonical_wtf8(b"caf\xE9"), Cow::Owned(_)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn hole_is_undefined() {
    with_scope(|atoms, arena, scratch| {
        let hole = Expr::init(E::Missing, Loc::EMPTY);
        let root = array_from(&[number_expr(1.0), hole, number_expr(2.0)]);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let expected = [
            DataValue::Number(1.0),
            DataValue::Undefined,
            DataValue::Number(2.0),
        ];
        assert_eq!(*value, DataValue::Array(&expected));
        assert!(matches!(write_error(&hole, scratch), NotData::Expression));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn big_int_takes_decimal_digits_only() {
    with_scope(|atoms, arena, scratch| {
        let decimal = big_int_expr(b"10");
        let value = data_value_from_expr(&decimal, scratch, arena, atoms).expect("data");
        assert_eq!(*value, DataValue::BigInt(atoms.intern(b"10")));
        let hexadecimal = big_int_expr(b"0x10");
        assert!(matches!(
            write_error(&hexadecimal, scratch),
            NotData::Expression
        ));
    });
}

#[test]
fn only_utf8_tapes_are_data() {
    let mut tape = E::JsonTape::empty();
    assert!(check_tape_encoding(&tape).is_ok());
    for encoding in [E::StrEncoding::Latin1, E::StrEncoding::Utf16] {
        tape.encoding = encoding;
        assert!(matches!(
            check_tape_encoding(&tape),
            Err(NotData::Expression)
        ));
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn proto_key_stays_own_key() {
    with_scope(|atoms, arena, scratch| {
        let root = parse_tape(br#"{"__proto__":1}"#, scratch);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let expected = [(atoms.intern(b"__proto__"), DataValue::Number(1.0))];
        assert_eq!(*value, DataValue::Object(&expected));

        let mut builder = ExprBuilder::new(scratch);
        write_data_value(value, atoms, &mut builder);
        let root = builder.finish();
        let Data::EObject(object) = &root.data else {
            panic!("expected an object");
        };
        let key = object.get().properties[0].key.as_ref().expect("a key");
        assert!(object.get().properties[0].flags == E::own_key_property_flags(key));
        assert!(object.get().properties[0].flags != bun_ast::flags::PROPERTY_NONE);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn lone_surrogate_round_trips() {
    with_scope(|atoms, arena, scratch| {
        let units: &[u16] = scratch.alloc_slice_copy(&[0x61u16, 0xD800]);
        let root = Expr::init(E::EString::init_utf16(units), Loc::EMPTY);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");

        let mut builder = ExprBuilder::new(scratch);
        write_data_value(value, atoms, &mut builder);
        let rebuilt = builder.finish();
        let Data::EString(string) = &rebuilt.data else {
            panic!("expected a string");
        };
        assert!(string.get().is_utf16);
        assert_eq!(string.get().slice16(), units);

        let again = data_value_from_expr(&rebuilt, scratch, arena, atoms).expect("data");
        assert_eq!(value, again);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn rope_is_flattened() {
    with_scope(|atoms, arena, scratch| {
        let tail = string_expr(b"def");
        let Data::EString(tail) = tail.data else {
            panic!("expected a string");
        };
        let mut head = E::EString::init(b"abc");
        head.next = Some(tail);
        head.end = Some(tail);
        head.rope_len = 6;
        let root = Expr::init(head, Loc::EMPTY);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        assert_eq!(*value, DataValue::String(atoms.intern(b"abcdef")));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn deep_array_converts_in_all_sinks() {
    with_scope(|atoms, arena, scratch| {
        let mut builder = DataValueBuilder::new(arena, atoms);
        builder.number(1.0);
        for _ in 0..NESTING_DEPTH {
            builder.array(1);
        }
        let value = builder.finish();

        let mut portable = PortableValue::default();
        write_data_value(value, atoms, &mut portable);
        let mut rebuilt = ExprBuilder::new(scratch);
        portable.replay(&mut rebuilt);
        let root = rebuilt.finish();

        let again = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        assert_eq!(nesting_depth(again), NESTING_DEPTH);
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn replay_equals_direct_result() {
    with_scope(|atoms, arena, scratch| {
        let root = parse_tree(br#"{"a":[1,"x",null],"b":{"c":false}}"#, scratch);
        let direct = data_value_from_expr(&root, scratch, arena, atoms).expect("data");

        let mut portable = PortableValue::default();
        write_expr(&root, scratch, &mut portable).expect("data");
        let mut builder = DataValueBuilder::new(arena, atoms);
        portable.replay(&mut builder);
        assert_eq!(direct, builder.finish());
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn expressions_are_not_data() {
    with_scope(|_, _, scratch| {
        let identifier = Expr::init(E::Identifier::init(Ref::NONE), Loc::EMPTY);
        let call = Expr::init(
            E::Call {
                target: identifier,
                ..Default::default()
            },
            Loc::EMPTY,
        );
        let spread = object_with(G::Property {
            kind: G::PropertyKind::Spread,
            value: Some(identifier),
            ..G::Property::default()
        });
        let getter = object_with(G::Property {
            kind: G::PropertyKind::Get,
            key: Some(string_expr(b"a")),
            value: Some(string_expr(b"b")),
            ..G::Property::default()
        });
        let initialized = object_with(G::Property {
            key: Some(string_expr(b"a")),
            value: Some(string_expr(b"b")),
            initializer: Some(string_expr(b"c")),
            ..G::Property::default()
        });
        for root in [identifier, call, spread, getter, initialized] {
            assert!(matches!(write_error(&root, scratch), NotData::Expression));
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn object_containing_itself_is_cyclic() {
    with_scope(|_, _, scratch| {
        let root = Expr::init(E::Object::default(), Loc::EMPTY);
        let Data::EObject(mut object) = root.data else {
            panic!("expected an object");
        };
        object.append_property(string_expr(b"self"), root);
        assert!(matches!(write_error(&root, scratch), NotData::Cyclic));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn shared_object_is_written_twice() {
    with_scope(|atoms, arena, scratch| {
        let shared = Expr::init(E::Object::default(), Loc::EMPTY);
        let root = array_of(shared, shared);
        let value = data_value_from_expr(&root, scratch, arena, atoms).expect("data");
        let items = [DataValue::Object(&[]), DataValue::Object(&[])];
        assert_eq!(*value, DataValue::Array(&items));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn multiplying_shared_nodes_is_too_large() {
    with_scope(|_, _, scratch| {
        let mut root = number_expr(1.0);
        let mut value_count = 1;
        while value_count <= max_data_nodes() {
            root = array_of(root, root);
            value_count = 2 * value_count + 1;
        }
        assert!(matches!(write_error(&root, scratch), NotData::TooLarge));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn limit_counts_values_and_not_keys() {
    with_scope(|_, _, scratch| {
        let largest = object_with_value_count(max_data_nodes());
        let mut counter = ValueCounter::default();
        write_expr(&largest, scratch, &mut counter).expect("as many values as the limit allows");
        assert_eq!(counter.values, max_data_nodes());
        assert!(counter.keys > 0);

        let oversized = object_with_value_count(max_data_nodes() + 1);
        let result = write_expr(&oversized, scratch, &mut ValueCounter::default());
        assert!(matches!(result, Err(NotData::TooLarge)));
    });
}

#[test]
fn limit_is_equal_in_every_build() {
    let limit = LimitId::MaxDataNodes;
    assert!(!can_be_lowered(limit));
    assert_eq!(limit.value_on_arm64(), limit.value_on_x86_64());
    assert_eq!(max_data_nodes() as u64, limit.value_on_arm64());
}

#[test]
#[cfg_attr(miri, ignore)]
fn toml_date_time_is_not_data() {
    with_scope(|_, _, scratch| {
        let date = E::EString::init_toml_datetime(b"1979-05-27", E::TomlDateTimeKind::LocalDate);
        let root = Expr::init(date, Loc::EMPTY);
        assert!(matches!(write_error(&root, scratch), NotData::TomlDateTime));
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn each_error_is_reported_once() {
    assert_eq!(
        reported_text(NotData::Expression),
        b"the value of \"/project/value.toml\" is not a plain value"
    );
    assert_eq!(
        reported_text(NotData::Cyclic),
        b"the value of \"/project/value.toml\" contains a circular reference"
    );
    let size_message = format!(
        "the value of \"/project/value.toml\" has more than {} values (MaxDataNodes)",
        max_data_nodes()
    );
    assert_eq!(reported_text(NotData::TooLarge), size_message.as_bytes());
    let date_time = reported_text(NotData::TomlDateTime);
    assert!(date_time.starts_with(b"TS100050"));
    assert!(contains(
        &date_time,
        b"the TOML file \"/project/value.toml\""
    ));
}

#[test]
#[cfg_attr(miri, ignore)]
#[should_panic(expected = "a finished sink holds one value")]
fn finishing_empty_sink_panics() {
    with_scope(|atoms, arena, _| {
        DataValueBuilder::new(arena, atoms).finish();
    });
}
