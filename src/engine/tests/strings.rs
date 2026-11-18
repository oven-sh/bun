use core::mem::MaybeUninit;

use bun_engine_standalone as _;
use bun_engine_text::{Atom, Identifier, MAX_LENGTH, StringRef, Text, names, symbols};
use bun_engine_vm::heap::{HeapKind, Scope};
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

fn string(cx: &Cx, text: &str) -> Gc<JsString> {
    JsString::new(cx, StringRef::from_str(text))
}

fn wide(cx: &Cx, text: &str) -> Gc<JsString> {
    let units: Vec<u16> = text.encode_utf16().collect();
    JsString::new(cx, StringRef::try_from_units(&units).unwrap())
}

fn text(string: Gc<JsString>) -> String {
    string.to_string_without_resolving().to_string()
}

/// The result as a string, the elements of an array between bars, or the message of the error.
fn invoke(cx: &mut Cx, this: Value, name: &str, arguments: &[Value]) -> String {
    let name = Identifier::new(Text::from_ascii(name));
    let result = cx
        .invoke(this, name.name(), arguments)
        .or_else(|thrown| cx.catch_value(thrown)?.get(cx, names::message))
        .unwrap();
    text(match result.downcast::<JsArray>() {
        Some(array) => {
            let bar = JsString::from_unit(cx, b'|'.into());
            (array.join_elements(cx, array.length().into(), bar)).unwrap()
        }
        None => result.to_string(cx).unwrap(),
    })
}

fn keys(cx: &mut Cx, object: &JsObject) -> String {
    let (kinds, mode) = (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include);
    let keys = object.own_keys(cx, kinds, mode).unwrap();
    let keys: Vec<String> = keys.iter().map(|key| key.to_string()).collect();
    keys.join(" ")
}

/// The same text flat, wide, as a substring, and as concatenations that lean either way.
fn forms(cx: &Cx, text: &str) -> [Gc<JsString>; 5] {
    let padded = string(cx, &format!("<{text}>"));
    let characters = || text.chars().map(|it| string(cx, &it.to_string()));
    let empty = cx.small_strings.empty();
    [
        string(cx, text),
        wide(cx, text),
        padded.substring(cx, 1, padded.len() - 1).unwrap(),
        characters().fold(empty, |all, it| JsString::concat(cx, all, it).unwrap()),
        (characters().rev()).fold(empty, |all, it| JsString::concat(cx, it, all).unwrap()),
    ]
}

#[test]
fn properties_are_in_order() {
    with_realm(|cx| {
        let (constructor, prototype) = (cx.string_constructor(), cx.string_prototype());
        assert_eq!(
            keys(cx, &constructor),
            "length name fromCharCode fromCodePoint raw prototype"
        );
        assert_eq!(
            keys(cx, &prototype),
            "length anchor big bold blink fixed fontcolor fontsize italics link small strike sub sup toString \
             valueOf charAt charCodeAt codePointAt concat indexOf lastIndexOf replace replaceAll repeat padStart \
             padEnd slice substr at substring toLowerCase toUpperCase localeCompare toLocaleLowerCase \
             toLocaleUpperCase trim startsWith endsWith includes match search matchAll split normalize trimStart \
             trimLeft trimEnd trimRight isWellFormed toWellFormed constructor Symbol.iterator"
        );
        let trim_left = prototype.get(cx, names::trimLeft).unwrap();
        assert_eq!(prototype.get(cx, names::trimStart).unwrap(), trim_left);
    });
}

#[test]
fn methods_do_not_depend_on_the_form_of_the_string() {
    const INFINITY: Value = Value::double(f64::INFINITY);
    with_realm(|cx| {
        let s = |text| Value::from(string(cx, text));
        let n = Value::int32;
        let cases: [(&str, &str, &[Value], &str); 44] = [
            ("abc", "at", &[n(-1)], "c"),
            ("abc", "at", &[n(i32::MIN)], "undefined"),
            ("abc", "charAt", &[n(3)], ""),
            ("abc", "charAt", &[Value::double(-0.9)], "a"),
            ("abc", "charCodeAt", &[n(-1)], "NaN"),
            ("a😀", "codePointAt", &[n(1)], "128512"),
            ("a😀", "codePointAt", &[n(2)], "56832"),
            (
                "ab",
                "concat",
                &[n(1), Value::NULL, s(""), s("é")],
                "ab1nullé",
            ),
            ("abcabc", "indexOf", &[s("c"), n(3)], "5"),
            ("abcabc", "indexOf", &[s(""), INFINITY], "6"),
            ("abcabc", "lastIndexOf", &[s("ab"), Value::NAN], "3"),
            ("abcabc", "lastIndexOf", &[s("c"), n(4)], "2"),
            ("abcabc", "lastIndexOf", &[s(""), n(-1)], "0"),
            ("abcabc", "includes", &[s("ca"), n(3)], "false"),
            ("abcabc", "startsWith", &[s("ca"), n(2)], "true"),
            ("abcabc", "endsWith", &[s("ab"), n(5)], "true"),
            ("abcabc", "endsWith", &[s("abcabcd")], "false"),
            ("abcdef", "slice", &[n(-4), n(-1)], "cde"),
            ("abcdef", "slice", &[n(4), n(2)], ""),
            ("abcdef", "substring", &[n(4), n(1)], "bcd"),
            ("abcdef", "substring", &[Value::NAN, INFINITY], "abcdef"),
            ("abcdef", "substr", &[n(-3), n(2)], "de"),
            ("abcdef", "substr", &[n(1), n(i32::MAX)], "bcdef"),
            ("ab", "repeat", &[n(3)], "ababab"),
            ("", "repeat", &[Value::double(1e300)], ""),
            ("ab", "repeat", &[n(1 << 30)], "Out of memory"),
            ("abc", "padStart", &[n(8), s("éx")], "éxéxéabc"),
            ("abc", "padEnd", &[n(5)], "abc  "),
            ("abc", "padEnd", &[INFINITY, s("")], "abc"),
            ("abc", "padEnd", &[INFINITY], "Out of memory"),
            ("\u{feff} a b\n", "trim", &[], "a b"),
            (" a ", "trimStart", &[], "a "),
            (" a ", "trimRight", &[], " a"),
            ("Straße", "toUpperCase", &[], "STRASSE"),
            ("ΑΣ", "toLowerCase", &[], "ας"),
            ("a-b-c", "replace", &[s("-"), s("+")], "a+b-c"),
            (
                "a-b-c",
                "replace",
                &[s("b"), s("$`$&$'$$$1$")],
                "a-a-b-c$$1$-c",
            ),
            ("a-b-c", "replaceAll", &[s("-"), s("$&$&")], "a--b--c"),
            ("ab", "replaceAll", &[s(""), s("é")], "éaébé"),
            ("a,b,,c", "split", &[s(",")], "a|b||c"),
            ("a,b,,c", "split", &[s(","), n(2)], "a|b"),
            ("aβc", "split", &[s("")], "a|β|c"),
            ("", "split", &[s(",")], ""),
            ("x", "link", &[s("a\"b")], "<a href=\"a&quot;b\">x</a>"),
        ];
        for (this, name, arguments, expected) in cases {
            for form in forms(cx, this) {
                assert_eq!(invoke(cx, form.into(), name, arguments), expected, "{name}");
            }
        }
    });
}

#[test]
fn functions_of_the_constructor_and_of_the_global_object() {
    with_realm(|cx| {
        let (constructor, global) = (cx.string_constructor().into(), cx.global().into());
        let (n, s) = (Value::int32, |text| Value::from(string(cx, text)));
        let out_of_range = "Arguments contain a value that is out of range of code points";
        let cases: [(Value, &str, &[Value], &str); 12] = [
            (constructor, "fromCharCode", &[], ""),
            (constructor, "fromCharCode", &[n(0x10041), n(66)], "AB"),
            (constructor, "fromCharCode", &[n(0x3b1), s("66.5")], "αB"),
            (constructor, "fromCodePoint", &[n(0x1f600), n(65)], "😀A"),
            (constructor, "fromCodePoint", &[n(0x110000)], out_of_range),
            (constructor, "fromCodePoint", &[Value::NAN], out_of_range),
            (global, "escape", &[s("a é€")], "a%20%E9%u20AC"),
            (global, "unescape", &[s("%u20AC%E9%")], "€é%"),
            (global, "encodeURI", &[s("/é?")], "/%C3%A9?"),
            (global, "encodeURIComponent", &[s("/é?")], "%2F%C3%A9%3F"),
            (global, "decodeURI", &[s("%2F%C3%A9")], "%2Fé"),
            (global, "decodeURIComponent", &[s("%2F%C3%A9")], "/é"),
        ];
        for (this, name, arguments, expected) in cases {
            assert_eq!(invoke(cx, this, name, arguments), expected);
        }
    });
}

#[test]
fn long_ropes_are_searched_and_cut_in_place() {
    with_realm(|cx| {
        let (a, b) = (string(cx, &"a".repeat(200)), string(cx, &"b".repeat(200)));
        let (dash, plus) = (string(cx, "-"), string(cx, "+"));
        let rope = JsString::concat3(cx, a, dash, b).unwrap();
        assert_eq!(rope.index_of(cx, &dash, 0).unwrap(), Some(200));
        assert_eq!(rope.index_of(cx, &dash, 201).unwrap(), None);
        assert_eq!(rope.last_index_of(cx, &dash, 200).unwrap(), Some(200));
        assert_eq!(rope.last_index_of(cx, &dash, 199).unwrap(), None);
        assert!(rope.ends_with(cx, &b, 401).unwrap());
        assert!(!rope.starts_with(cx, &dash, 0).unwrap());
        assert!(rope.substring(cx, 201, 401).unwrap() == b);
        let nested = JsString::concat(cx, a, rope).unwrap();
        let replaced = nested.replace_first_literally(cx, &dash, plus).unwrap();
        assert!(rope.is_concatenation() && nested.is_concatenation());
        assert_eq!(
            text(replaced),
            [text(a), text(a), text(plus), text(b)].concat()
        );
        assert_eq!(nested.index_of(cx, &dash, 0).unwrap(), Some(400));
    });
}

#[test]
fn ropes_of_any_shape_are_put_together() {
    with_realm(|cx| {
        let mut state = 1u32;
        let mut random = |limit: usize| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (state >> 8) as usize % limit
        };
        let mut pool = root_vec();
        pool.extend(["ab", "c", "é", "βγ", "0123456789"].map(|it| (string(cx, it), it.to_owned())));
        for _ in 0..3000 {
            let [a, b, c] = [(); 3].map(|()| pool.len() - 1 - random(pool.len().min(6)));
            let expected = [&*pool[a].1, &pool[b].1, &pool[c].1].concat();
            let rope = JsString::concat3(cx, pool[a].0, pool[b].0, pool[c].0).unwrap();
            assert_eq!(text(rope), expected);
            let no_gc = cx.no_gc();
            let pieces: Vec<String> = rope.pieces(&no_gc).map(|it| it.to_string()).collect();
            assert_eq!(pieces.concat(), expected);
            assert_eq!(rope.pieces_reversed(&no_gc).count(), pieces.len());
            if rope.len() < 2000 {
                pool.push((rope, expected));
            } else {
                pool.truncate(5 + random(4));
            }
        }
    });
}

#[test]
fn shared_fibers_are_copied_and_lengths_are_limited() {
    with_realm(|cx| {
        let mut tower = string(cx, "abc");
        for _ in 0..22 {
            tower = JsString::concat(cx, tower, tower).unwrap();
        }
        let mut units = vec![MaybeUninit::<u8>::uninit(); tower.len() as usize];
        tower.copy_to(&mut units);
        assert_eq!(tower.unit_at(cx, tower.len() - 2).unwrap(), b'b'.into());
        let half = string(cx, "ab").repeat(cx, 1 << 29).unwrap();
        assert!(JsString::try_concat(cx, half, half).is_err());
        let rest = string(cx, "abc").repeat(cx, ((1 << 30) - 1) / 3).unwrap();
        let longest = JsString::concat(cx, half, rest).unwrap();
        assert_eq!(longest.len() as usize, MAX_LENGTH);
    });
}

#[test]
fn a_sum_is_copied_only_if_the_number_has_no_string() {
    with_realm(|cx| {
        let (short, long) = (string(cx, "ab").into(), string(cx, &"x".repeat(33)).into());
        let cases = [
            (short, short, "abab", true),
            (short, Value::int32(-1), "ab-1", false),
            (Value::int32(1 << 20), short, "1048576ab", false),
            (short, Value::int32(12), "ab12", true),
            (Value::double(0.5), short, "0.5ab", true),
            (short, Value::UNDEFINED, "abundefined", true),
            (long, Value::int32(-1), &("x".repeat(33) + "-1"), true),
        ];
        for (a, b, expected, is_rope) in cases {
            let sum = JsString::add(cx, a, b).unwrap();
            assert_eq!((&*text(sum), sum.is_rope()), (expected, is_rope));
        }
    });
}

#[test]
fn a_view_outlives_the_swap_for_an_atom() {
    with_realm(|cx| {
        let atom = Atom::new(Text::from_ascii("a key that exists"));
        for form in forms(cx, "a key that exists") {
            let view = form.view(cx).unwrap();
            assert!(form.to_property_key(cx).unwrap().name() == atom.name());
            assert!(form.is_atom() && form.is_latin1());
            cx.heap.collect_and_sweep(Some(Scope::Full));
            assert_eq!(view.text(), atom.text());
        }
        for form in forms(cx, "no such key") {
            assert!(form.to_existing_property_key(cx).unwrap().is_none());
        }
        let key = wide(cx, "a new key");
        assert!(key.to_property_key(cx).unwrap().name().string().is_latin1());
        let parts = [string(cx, "a key"), wide(cx, " that exists")];
        let first = JsString::concat_to_atom(cx, &parts).unwrap();
        assert!(first.is_atom() && first == JsString::concat_to_atom(cx, &parts).unwrap());
    });
}

#[test]
fn caches_survive_collections() {
    with_realm(|cx| {
        let literal = JsString::try_from_text_as_atom(cx, Text::from_ascii("ab cd 12")).unwrap();
        let space = string(cx, " ").into();
        for round in 0..6 {
            for number in [7, 10, 1023, 1024, -1, i32::MIN] {
                assert_eq!(text(JsString::from_int32(cx, number)), number.to_string());
            }
            assert_eq!(text(JsString::from_number(cx, 0.25)), "0.25");
            assert_eq!(text(JsString::from_number(cx, -0.0)), "0");
            assert_eq!(text(literal.substring(cx, 3, 5).unwrap()), "cd");
            assert_eq!(invoke(cx, literal.into(), "split", &[space]), "ab|cd|12");
            let scope = [Scope::Eden, Scope::Eden, Scope::Full][round % 3];
            cx.heap.collect_and_sweep(Some(scope));
        }
    });
}

#[test]
fn elements_are_joined() {
    with_realm(|cx| {
        let long = "x".repeat(300);
        let [rope, ..] = [forms(cx, "rope")[3]];
        let (n, d) = (Value::int32, Value::double);
        let cases: [(&[Value], &str, String); 6] = [
            (&[], ",", String::new()),
            (&[n(1), n(-20), n(i32::MIN)], "", "1-20-2147483648".into()),
            (&[d(0.5), d(-0.0), d(1e21)], "β", "0.5β0β1e+21".into()),
            (
                &[rope.into(), Value::NULL, Value::TRUE],
                "0123456789",
                "rope01234567890123456789true".into(),
            ),
            (
                &[d(0.5), string(cx, &long).into(), Value::UNDEFINED],
                ", ",
                format!("0.5, {long}, "),
            ),
            (&[string(cx, "β").into(), d(f64::NAN)], "-", "β-NaN".into()),
        ];
        for (values, separator, expected) in cases {
            let (array, separator) = (cx.new_array_from(values).unwrap(), string(cx, separator));
            let joined = array.join_elements(cx, values.len() as u64, separator);
            assert_eq!(text(joined.unwrap()), expected);
        }
        let sparse = cx.new_array();
        sparse.set_index(cx, 900_000_000, n(1), true).unwrap();
        let separator = string(cx, "ab");
        let joined = sparse.join_elements(cx, 1_000_000_000, separator).unwrap();
        assert_eq!(joined.len(), 1_999_999_999);
        let numbers = StringJoiner::join(cx, Text::from_ascii(","), |_, joiner| {
            joiner.push_numbers(0..200u8);
            joiner.push_empty(2);
            Ok(())
        });
        let expected: Vec<String> = (0..200).map(|it| it.to_string()).collect();
        assert_eq!(text(numbers.unwrap()), expected.join(",") + ",,");
    });
}

#[test]
fn a_weakly_held_symbol_lives_as_long_as_its_name_is_used() {
    with_realm(|cx| {
        #[inline(never)]
        fn make(cx: &Cx, set: &JsWeakSet) -> Vec<(Weak<JsSymbol>, Option<Identifier>)> {
            let one = |index: u32| {
                let symbol = JsSymbol::create(cx, None);
                set.add(symbol.cell()).unwrap();
                let name = (index % 2 == 0).then(|| symbol.name().to_identifier());
                (Weak::new(cx, symbol), name)
            };
            (0..200).map(one).collect()
        }
        let symbols = make(cx, &JsWeakSet::create(cx));
        for scope in [Scope::Eden, Scope::Full] {
            cx.heap.collect_and_sweep(Some(scope));
            assert!(symbols.iter().all(|it| it.0.is_live() || it.1.is_none()));
            assert!(symbols.iter().filter(|it| it.0.is_live()).count() < 110);
        }
    });
}

#[test]
fn watchpoints_notice_changes() {
    use RealmWatchpoint::*;
    with_realm(|cx| {
        let (strings, objects) = (cx.string_prototype(), cx.object_prototype());
        let cases = [
            (StringToString, strings, names::toString),
            (StringValueOf, strings, names::valueOf),
            (StringSymbolSplit, strings, symbols::split),
            (StringSymbolReplace, objects, symbols::replace),
        ];
        for (watchpoint, object, name) in cases {
            assert!(cx.holds(watchpoint));
            object.set(cx, name, Value::NULL, true).unwrap();
            assert!(!cx.holds(watchpoint));
        }
        assert!(cx.holds(StringPrototypeChainIsSane));
        strings.set_index(cx, 0, Value::NULL, true).unwrap();
        assert!(!cx.holds(StringPrototypeChainIsSane));
    });
}
