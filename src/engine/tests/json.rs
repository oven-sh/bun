#![allow(improper_ctypes_definitions)]

use bun_engine_macros::native_abi;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, Text, names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::json::{LinesEnd, ParsedLines, RawJson, Source};
use bun_engine_vm::*;

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks::DEFAULT,
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn with_realm(body: impl FnOnce(&mut Cx)) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), &HOOKS))) };
}

fn string(cx: &Cx, text: &str) -> Value {
    JsString::new(cx, StringRef::from_str(text)).into()
}

fn function(cx: &Cx, function: NativeFunction) -> Value {
    JsFunction::native(cx, 0, &StringRef::empty(), function).into()
}

fn parse(cx: &Cx, text: &str) -> Value {
    json::parse(cx, Source::Utf8(text.as_bytes())).unwrap()
}

fn set(cx: &mut Cx, object: Value, name: &str, value: Value) {
    let name = string(cx, name);
    object.put_by_value(cx, name, value, true).unwrap();
}

/// The result as a string, or the message of the error.
fn show(cx: &mut Cx, result: JsResult<Value>) -> String {
    let result = result.or_else(|thrown| cx.catch_value(thrown)?.get(cx, names::message));
    let view = result.unwrap().to_string_view(cx).unwrap();
    view.text().to_string()
}

fn call(cx: &mut Cx, name: &str, arguments: &[Value]) -> JsResult<Value> {
    let name = Identifier::new(Text::from_ascii(name));
    cx.invoke(cx.json_object().into(), name.name(), arguments)
}

fn stringify(cx: &mut Cx, arguments: &[Value]) -> String {
    let result = call(cx, "stringify", arguments);
    show(cx, result)
}

/// What comes of parsing the text and writing it again, which is the same in every encoding that can hold it.
fn round_trip(cx: &mut Cx, text: &str) -> String {
    let wide: Vec<u16> = text.encode_utf16().collect();
    let narrow: Option<Vec<u8>> = wide.iter().map(|&unit| unit.try_into().ok()).collect();
    let mut from = |source: Source<'_>| {
        let result = json::parse(cx, source).and_then(|value| call(cx, "stringify", &[value]));
        show(cx, result)
    };
    let result = from(Source::Utf8(text.as_bytes()));
    assert_eq!(from(Text::Utf16(&wide).into()), result);
    if let Some(narrow) = narrow {
        assert_eq!(from(Text::Latin1(&narrow).into()), result);
    }
    result
}

#[test]
fn texts_come_back_in_normal_form() {
    with_realm(|cx| {
        for (text, expected) in [
            (" \t\r\n1 ", "1"),
            ("[-0,1.0,1e2,1E-7,0.1,1e400]", "[0,1,100,1e-7,0.1,null]"),
            ("[2147483647,2147483648,-2147483649]", ""),
            ("[true,false,null,[],{},[[]],[{}]]", ""),
            (
                r#" { "a" : [ 1 , { "b" : "c" } ] } "#,
                r#"{"a":[1,{"b":"c"}]}"#,
            ),
            (r#"{"a":1,"b":2,"a":3}"#, r#"{"a":3,"b":2}"#),
            (
                r#"{"b":1,"2":2,"1":3,"01":4}"#,
                r#"{"1":3,"2":2,"b":1,"01":4}"#,
            ),
            (
                r#"{"4294967294":1,"4294967295":2,"7":3}"#,
                r#"{"7":3,"4294967294":1,"4294967295":2}"#,
            ),
            (r#"{"__proto__":{"a":1},"toJSON":1,"":2}"#, ""),
            (
                r#""\"\\\/\b\f\n\r\t\u0041\u001F""#,
                r#""\"\\/\b\f\n\r\tA\u001f""#,
            ),
            (
                r#"["\ud83d\ude00","\ud800","\udc00x"]"#,
                "[\"\u{1f600}\",\"\\ud800\",\"\\udc00x\"]",
            ),
            ("{\"é\":\"ÿ\",\"\\u00e9\":\"\u{7f}\"}", "{\"é\":\"\u{7f}\"}"),
            ("{\"中\":\"文\",\"a\\nb\":\"\u{2028}\"}", ""),
        ] {
            let expected = if expected.is_empty() { text } else { expected };
            for _ in 0..3 {
                assert_eq!(round_trip(cx, text), expected);
            }
        }
    });
}

#[test]
fn long_strings_have_the_width_of_the_text() {
    with_realm(|cx| {
        let (x, escaped) = ("x".repeat(17), r"\u0078".repeat(17));
        for (literal, is_latin1_from_wide_text) in [
            (x[1..].to_string(), true),
            ("é".repeat(16), true),
            (x.clone(), false),
            (x.repeat(20), false),
            ("é".repeat(17), false),
            (format!(r"{x}\n"), false),
            (format!("xx{escaped}"), false),
            (format!("x{escaped}é"), true),
            (escaped.repeat(20), true),
        ] {
            let text = format!("\"{literal}\"");
            let wide: Vec<u16> = text.encode_utf16().collect();
            let narrow: Vec<u8> = wide.iter().map(|&unit| unit as u8).collect();
            for (source, expected) in [
                (Text::Latin1(&narrow).into(), true),
                (Text::Utf16(&wide).into(), is_latin1_from_wide_text),
                (Text::Latin1(&narrow).into(), true),
                (Source::Utf8(text.as_bytes()), is_latin1_from_wide_text),
                (
                    Source::from_utf8(text.as_bytes()),
                    is_latin1_from_wide_text || text.is_ascii(),
                ),
            ] {
                let string = json::parse(cx, source).unwrap().cast::<JsString>();
                assert_eq!(string.is_latin1(), expected, "{text}");
            }
        }
    });
}

#[test]
fn a_long_string_that_has_become_a_key_is_shared() {
    with_realm(|cx| {
        let text: Vec<u16> = r#""a value of more than sixteen units""#.encode_utf16().collect();
        let first = json::parse(cx, Text::Utf16(&text).into()).unwrap();
        first.cast::<JsString>().to_property_key(cx).unwrap();
        assert!(json::parse(cx, Text::Utf16(&text).into()).unwrap() == first);
    });
}

#[test]
fn errors_name_the_token() {
    with_realm(|cx| {
        let long = "a".repeat(201);
        let cut = format!("Unexpected identifier \"{}...\"", &long[..200]);
        for (text, expected) in [
            ("", "Unexpected EOF"),
            ("[1,", "Unexpected EOF"),
            ("[1,]", "Unexpected comma at the end of array expression"),
            ("[,1]", "Unexpected token ','"),
            ("[1 2]", "Expected ']'"),
            ("[1e]", "Expected ']'"),
            ("{a:1}", "Expected '}'"),
            ("{\"a\":1]", "Expected '}'"),
            ("{\"a\":1,}", "Property name must be a string literal"),
            (
                "{\"a\" 1}",
                "Expected ':' before value in object property definition",
            ),
            ("{\"a\":}", "Unexpected token '}'"),
            ("01", "Unable to parse JSON string"),
            ("nullx", "Unable to parse JSON string"),
            ("nul", "Unexpected identifier \"nul\""),
            ("a\u{200d}b", "Unexpected identifier \"a\u{200d}b\""),
            (&long, &cut),
            ("[1 é]", "Unrecognized token 'é'"),
            ("1\0", "Unrecognized token '\0'"),
            ("{'a':1}", "Single quotes (') are not allowed in JSON"),
            ("-", "Invalid number"),
            ("1.e5", "Invalid digits after decimal point"),
            ("\"a", "Unterminated string"),
            ("\"a\nb\"", "Unterminated string"),
            ("\"\\", "Unterminated string"),
            ("\"\\é\"", "Invalid escape character é"),
            ("\"\\u12\"", "\\u must be followed by 4 hex digits"),
            ("\"\\u12é4\"", "\"\\u12é4\" is not a valid unicode escape"),
        ] {
            assert_eq!(
                round_trip(cx, text),
                format!("JSON Parse error: {expected}")
            );
            let source = Source::Utf8(text.as_bytes());
            assert!(json::try_parse(cx, source).unwrap().is_none());
        }
    });
}

#[test]
fn every_length_of_key_and_string_at_every_distance_from_the_end() {
    with_realm(|cx| {
        for filler in ["x", "é", "中", "\\n"] {
            for length in 0..70 {
                let text = filler.repeat(length);
                let member = format!("{{\"k{text}\":\"{text}\",\"z\":[\"{text}\"]}}");
                for copies in 1..4 {
                    let whole = format!("[{}]", vec![member.as_str(); copies].join(","));
                    assert_eq!(round_trip(cx, &whole), whole);
                }
            }
        }
    });
}

#[test]
fn every_number_of_members() {
    with_realm(|cx| {
        for count in (0..140).chain([255, 256, 257, 1000]) {
            let members = (0..count).map(|index| format!("\"k{index}\":{index}"));
            let object = format!("{{{}}}", members.collect::<Vec<_>>().join(","));
            let whole = format!("[{object},{object}]");
            assert_eq!(round_trip(cx, &whole), whole);
            cx.heap.collect_and_sweep(None);
        }
    });
}

#[test]
fn arrays_get_the_kind_that_fits() {
    with_realm(|cx| {
        for (text, kind) in [
            ("[1,2]", ElementKind::Int32),
            ("[1,2.5]", ElementKind::Double),
            ("[-0]", ElementKind::Double),
            ("[1,2.5,null]", ElementKind::Contiguous),
        ] {
            assert_eq!(parse(cx, text).cast::<JsArray>().element_kind(), kind);
        }
        let (first, second) = (parse(cx, "[]"), parse(cx, "[]"));
        first.cast::<JsArray>().push(cx, 1.into()).unwrap();
        assert_eq!(stringify(cx, &[first]) + &stringify(cx, &[second]), "[1][]");
    });
}

#[test]
fn equal_keys_give_equal_shapes() {
    with_realm(|cx| {
        let shape = |value: Value| value.cast::<JsObject>().shape();
        let first = parse(cx, r#"{"a":1,"b":2}"#);
        for scope in [Scope::Eden, Scope::Full] {
            cx.heap.collect_and_sweep(Some(scope));
            assert!(shape(parse(cx, r#"{ "a":"x", "\u0062":[] }"#)) == shape(first));
        }
        set(cx, first, "c", Value::NULL);
        assert_eq!(round_trip(cx, r#"{"a":1,"b":2}"#), r#"{"a":1,"b":2}"#);
    });
}

#[test]
fn nesting() {
    const TOO_DEEP: &str = "Maximum call stack size exceeded.";
    #[native_abi]
    fn identity(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        Ok(frame.argument(1))
    }
    with_realm(|cx| {
        let nested = |depth: usize| "[{\"a\":".repeat(depth / 2) + "1" + &"}]".repeat(depth / 2);
        assert_eq!(round_trip(cx, &nested(40_000)), nested(40_000));
        assert_eq!(round_trip(cx, &format!("[{}]", nested(40_000))), TOO_DEEP);
        parse(cx, &nested(300_000));
        let identity = function(cx, identity);
        let fits = [string(cx, &nested(4500)), identity];
        assert!(call(cx, "parse", &fits).is_ok());
        let result = call(cx, "parse", &[string(cx, &"[".repeat(4501)), identity]);
        assert_eq!(show(cx, result), TOO_DEEP);
    });
}

#[test]
fn a_reviver_sees_the_source_of_what_is_unchanged() {
    /// Puts the source in place of each primitive, drops `gone`, and changes `later` before its turn.
    #[native_abi]
    fn reviver(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        cx.heap.collect_and_sweep(None);
        let key = frame.argument(0).to_string_ref(cx)?;
        if key.text().eq_ascii("gone") {
            set(cx, frame.this_value(), "later", 5.into());
            return Ok(Value::UNDEFINED);
        }
        let source = frame.argument(2).get(cx, names::source)?;
        Ok(if source.is_undefined() {
            frame.argument(1)
        } else {
            source
        })
    }
    with_realm(|cx| {
        for (text, expected) in [
            (" 1.0 ", r#""1.0""#),
            (
                r#"{"a":1,"a":1.0,"1":[ "\u0041",null]}"#,
                r#"{"1":["\"\\u0041\"","null"],"a":"1.0"}"#,
            ),
            (r#"{"gone":1,"later":2,"b":{}}"#, r#"{"later":5,"b":{}}"#),
            (
                r#"{"a":1e0,"b":0,"c":0,"d":0,"e":0,"f":0,"g":0,"h":0,"b":-0}"#,
                r#"{"a":"1e0","b":"-0","c":"0","d":"0","e":"0","f":"0","g":"0","h":"0"}"#,
            ),
        ] {
            let arguments = [string(cx, text), function(cx, reviver)];
            let value = call(cx, "parse", &arguments).unwrap();
            assert_eq!(stringify(cx, &[value]), expected);
        }
    });
}

#[test]
fn lines() {
    use LinesEnd::*;
    with_realm(|cx| {
        for (text, expected, read, end) in [
            (&b""[..], "[]", 0, Complete),
            (b"1\r\n\n {\"a\":\n2} \n", "[1,{\"a\":2}]", 13, Complete),
            (b"1\n[2,", "[1]", 1, NeedsMoreText),
            (b"1\ntru", "[1]", 1, NeedsMoreText),
            (b"\"\\u00", "[]", 0, NeedsMoreText),
            (b"[1e+", "[]", 0, NeedsMoreText),
            (b"1\n2e", "[1]", 1, NeedsMoreText),
            (b"1\ntru\n", "[1]", 1, SyntaxError),
            (b"1 2", "[1]", 1, SyntaxError),
            (b"\"\\u0x", "[]", 0, SyntaxError),
            (
                b"\"\xc3\xa9\"\n\"\xe4\xb8",
                "[\"\u{e9}\"]",
                4,
                NeedsMoreText,
            ),
            (b"\"\xff\"\n\xff", "[\"\u{fffd}\"]", 5, SyntaxError),
        ] {
            let mut values = ValueVec::new();
            let result = json::parse_utf8_lines(cx, text, &mut values).unwrap();
            assert_eq!(result, ParsedLines { read, end });
            let values = cx.new_array_from(&values).unwrap().into();
            assert_eq!(stringify(cx, &[values]), expected);
        }
    });
}

#[test]
fn many_lines_of_utf8_are_those_of_the_text() {
    with_realm(|cx| {
        for (letter, end) in [("x", ""), ("é", "[1,\n"), ("中", "]\n2"), ("x", "\n \n12e")] {
            let mut text = String::new();
            for count in [1, 700, 3, 5000, 0, 90_000, 2, 40] {
                text += &format!("\"{}\"\n", letter.repeat(count));
                text += &format!("[{}0]\r\n", "1,\n".repeat(count));
                text += &format!("{}{}", " \n".repeat(count), "{\"a\":1}\n".repeat(count / 9));
            }
            text += end;
            let units: Vec<u16> = text.encode_utf16().collect();
            let (mut expected, mut values) = (ValueVec::new(), ValueVec::new());
            let whole = json::parse_lines(cx, Text::Utf16(&units), &mut expected).unwrap();
            let result = json::parse_utf8_lines(cx, text.as_bytes(), &mut values).unwrap();
            let read = String::from_utf16(&units[..whole.read]).unwrap().len();
            assert_eq!((result.read, result.end), (read, whole.end));
            let [values, expected] =
                [values, expected].map(|it| cx.new_array_from(&it).unwrap().into());
            assert!(stringify(cx, &[values]) == stringify(cx, &[expected]));
        }
    });
}

#[test]
fn gaps_and_lists() {
    with_realm(|cx| {
        let value = parse(cx, r#"{"a":[1,[],{}],"b":{"a":"x","1":2}}"#);
        set(cx, value, "c", Value::UNDEFINED);
        for (space, gap) in [
            (2.9.into(), "  "),
            (100.into(), "          "),
            (string(cx, "\t"), "\t"),
            (string(cx, "中123456789ab"), "中123456789"),
        ] {
            let (a, b) = (format!("\n{gap}"), format!("\n{gap}{gap}"));
            assert_eq!(
                stringify(cx, &[value, Value::NULL, space]),
                format!(
                    "{{{a}\"a\": [{b}1,{b}[],{b}{{}}{a}],{a}\"b\": {{{b}\"1\": 2,{b}\"a\": \"x\"{a}}}\n}}"
                )
            );
        }
        let list = parse(cx, r#"["b",1,"a","b",null,{}]"#);
        let listed = r#"{"b":{"1":2,"a":"x"},"a":[1,[],{}]}"#;
        assert_eq!(stringify(cx, &[value, list, Value::NAN]), listed);
    });
}

#[test]
fn what_has_no_text() {
    #[native_abi]
    fn key(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        Ok(frame.argument(0))
    }
    with_realm(|cx| {
        let callable = function(cx, key);
        let array = cx
            .new_array_with_length(ElementKind::Contiguous, 4)
            .unwrap();
        array.set_index(cx, 1, callable, true).unwrap();
        array.set_index(cx, 2, Value::NAN, true).unwrap();
        assert_eq!(stringify(cx, &[array.into()]), "[null,null,null,null]");
        assert_eq!(stringify(cx, &[callable]), "undefined");
        assert_eq!(stringify(cx, &[]), "undefined");

        let object = parse(cx, r#"{"a":1,"b":{"c":1},"d":[{}]}"#);
        set(cx, object, "a", callable);
        assert_eq!(stringify(cx, &[object]), r#"{"b":{"c":1},"d":[{}]}"#);
        set(cx, cx.object_prototype().into(), "toJSON", callable);
        assert_eq!(stringify(cx, &[object]), r#""""#);
    });
}

#[test]
fn members_are_read_when_it_is_their_turn() {
    /// Deletes `b`, replaces `c` and adds `d`.
    #[native_abi]
    fn change(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        let object = frame.this_value().cast::<JsObject>();
        object.delete(cx, Identifier::from_literal("b").name())?;
        set(cx, object.into(), "c", Value::TRUE);
        set(cx, object.into(), "d", Value::TRUE);
        cx.heap.collect_and_sweep(None);
        Ok(0.into())
    }
    with_realm(|cx| {
        let getter = GetterSetter::create(cx, function(cx, change).as_object(), None);
        for is_dictionary in [false, false, false, true] {
            let object = parse(cx, r#"{"a":1,"b":2,"c":3}"#).cast::<JsObject>();
            let name = Identifier::from_literal("a");
            object.put_direct_accessor(cx, name.name(), getter, Attributes::NONE);
            if is_dictionary {
                object.convert_to_uncacheable_dictionary(cx);
            }
            assert_eq!(stringify(cx, &[object.into()]), r#"{"a":0,"c":true}"#);
        }
    });
}

#[test]
fn cycles_at_any_depth() {
    with_realm(|cx| {
        for depth in [1, 2, 31, 32, 33, 100] {
            for target in [0, depth / 2, depth - 1] {
                let root = parse(cx, &("[".repeat(depth) + &"]".repeat(depth)));
                let descend = |cx: &mut Cx, levels| {
                    (0..levels).fold(root, |it, _| it.get_index(cx, 0).unwrap())
                };
                let (target, last) = (descend(cx, target), descend(cx, depth - 1));
                let shared = parse(cx, "{}");
                last.put_index(cx, 0, shared, true).unwrap();
                last.put_index(cx, 1, shared, true).unwrap();
                assert_eq!(stringify(cx, &[root]).len(), 2 * depth + 5);
                last.put_index(cx, 2, target, true).unwrap();
                let message = "JSON.stringify cannot serialize cyclic structures.";
                assert_eq!(stringify(cx, &[root]), message);
            }
        }
    });
}

#[test]
fn an_object_is_inside_of_itself_even_if_it_no_longer_leads_there() {
    /// Empties what `back` refers to.
    #[native_abi]
    fn cut(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        let back = Identifier::from_literal("back");
        let outer = frame.this_value().get(cx, back.name())?.cast::<JsObject>();
        outer.delete_index(cx, 0)?;
        Ok(0.into())
    }
    with_realm(|cx| {
        let getter = GetterSetter::create(cx, function(cx, cut).as_object(), None);
        for (outer, depth) in [("[[]]", 0), ("[[]]", 40), (r#"{"0":[]}"#, 0)] {
            for filler in ["", "more than the least that is worth a try"] {
                let (outer, inner) = (parse(cx, outer), cx.new_object());
                set(cx, inner.into(), "filler", string(cx, filler));
                let name = Identifier::from_literal("cut");
                inner.put_direct_accessor(cx, name.name(), getter, Attributes::NONE);
                set(cx, inner.into(), "back", outer);
                let middle = outer.get_index(cx, 0).unwrap();
                middle.put_index(cx, 0, inner.into(), true).unwrap();
                let wrap = |it, _| cx.new_array_from(&[it]).unwrap().into();
                let root = (0..depth).fold(outer, wrap);
                let message = "JSON.stringify cannot serialize cyclic structures.";
                assert_eq!(stringify(cx, &[root]), message);
            }
        }
    });
}

#[test]
fn records_with_and_without_gaps() {
    with_realm(|cx| {
        for filler in ["k", "\\\"", "é", "中"] {
            for length in 0..60 {
                let key = filler.repeat(length);
                let values = ["1", "-2147483648", "0.5", "\"\"", "null", "[]", "{}"];
                let join = |each: &dyn Fn(&str) -> String| values.map(each).join(",");
                let text = format!("[{}]", join(&|it| format!("{{\"{key}\":{it}}}")));
                let lines = join(&|it| format!("\n {{\n  \"{key}\": {it}\n }}"));
                let value = parse(cx, &text);
                for _ in 0..3 {
                    assert_eq!(stringify(cx, &[value]), text);
                    let indented = stringify(cx, &[value, Value::NULL, 1.into()]);
                    assert_eq!(indented, format!("[{lines}\n]"));
                }
            }
        }
    });
}

#[test]
fn what_is_known_about_a_shape_follows_its_prototypes() {
    #[native_abi]
    fn key(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
        Ok(frame.argument(0))
    }
    with_realm(|cx| {
        let value = parse(cx, r#"[[{"a":1},{"a":2}]]"#);
        let (to_json, name) = (function(cx, key), names::toJSON);
        for (prototype, expected) in [
            (cx.array_prototype().upcast::<JsObject>(), r#""""#),
            (cx.object_prototype(), r#""""#),
        ] {
            for _ in 0..3 {
                assert_eq!(stringify(cx, &[value]), r#"[[{"a":1},{"a":2}]]"#);
            }
            prototype.put_direct(cx, name, to_json, Attributes::NONE);
            assert_eq!(stringify(cx, &[value]), expected);
            prototype.delete(cx, name).unwrap();
        }
    });
}

#[test]
fn concatenations() {
    with_realm(|cx| {
        for (a, b, expected) in [
            ("ab", "cd", r#"["abcd"]"#),
            ("a\"", "\n", r#"["a\"\n"]"#),
            ("é", "中", "[\"é中\"]"),
        ] {
            let rope = JsString::add(cx, string(cx, a), string(cx, b)).unwrap();
            let array = cx.new_array_from(&[rope.into()]).unwrap().into();
            for _ in 0..3 {
                assert_eq!(stringify(cx, &[array]), expected);
            }
        }
        let [lead, trail] = [0xd83d, 0xde00].map(|unit| JsString::from_unit(cx, unit));
        let pair = JsString::concat(cx, lead, trail).unwrap();
        assert_eq!(stringify(cx, &[pair.into()]), "\"\u{1f600}\"");
    });
}

#[test]
fn raw_texts() {
    with_realm(|cx| {
        let raw = call(cx, "rawJSON", &[string(cx, "1e1000")]).unwrap();
        assert!(raw.is::<RawJson>());
        let object = raw.cast::<JsObject>();
        assert!((object.test_integrity_level(cx, IntegrityLevel::Frozen)).unwrap());
        let text = object.get(cx, names::rawJSON);
        assert_eq!(show(cx, text), "1e1000");
        let array = cx.new_array_from(&[raw]).unwrap().into();
        assert_eq!(stringify(cx, &[array]), "[1e1000]");
        for (text, expected) in [
            ("", "JSON.rawJSON cannot accept empty string"),
            (" 1", "JSON.rawJSON cannot accept string starting with ' '"),
            ("1\t", "JSON.rawJSON cannot accept string ending with '\t'"),
            ("[]", "JSON Parse error: Could not parse value expression"),
            (
                "1 2",
                "JSON Parse error: Unexpected content at end of JSON literal",
            ),
        ] {
            let result = call(cx, "rawJSON", &[string(cx, text)]);
            assert_eq!(show(cx, result), expected);
        }
    });
}
