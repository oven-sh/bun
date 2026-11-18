#![allow(improper_ctypes_definitions)]

use bun_engine_macros::native_abi;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, PropertyName, StringRef, Text, names, symbols};
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

fn string(cx: &Cx, text: &str) -> Value {
    let string = StringRef::try_narrowed(Text::Utf16(&text.encode_utf16().collect::<Vec<_>>()));
    JsString::new(cx, string.unwrap()).into()
}

fn try_regexp(cx: &mut Cx, pattern: &str, flags: &str) -> JsResult<Value> {
    let (constructor, arguments) = (cx.regexp_constructor().into(), [pattern, flags]);
    let arguments = arguments.map(|it| string(cx, it));
    (cx.construct(constructor, &arguments, constructor)).map(Into::into)
}

fn regexp(cx: &mut Cx, pattern: &str, flags: &str) -> Value {
    try_regexp(cx, pattern, flags).unwrap()
}

/// Arrays in brackets, other objects in braces, and errors as their message.
fn show(cx: &mut Cx, result: JsResult<Value>) -> String {
    let value = result.unwrap_or_else(|thrown| {
        let error = cx.catch_value(thrown).unwrap();
        error.get(cx, names::message).unwrap()
    });
    let Some(object) = value.as_object() else {
        return value.to_string_view(cx).unwrap().text().to_string();
    };
    let keys = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude);
    let keys = keys.unwrap();
    let parts = keys.iter().map(|key| {
        let value = object.get(cx, key.name());
        match key.name().as_index() {
            Some(_) => show(cx, value),
            None => format!("{key}:{}", show(cx, value)),
        }
    });
    let parts = parts.collect::<Vec<_>>().join(",");
    match object.is::<JsArray>() {
        true => format!("[{parts}]"),
        false => format!("{{{parts}}}"),
    }
}

fn invoke(cx: &mut Cx, this: Value, name: PropertyName<'_>, arguments: &[Value]) -> String {
    let result = cx.invoke(this, name, arguments);
    show(cx, result)
}

fn get(cx: &mut Cx, this: Value, name: &str) -> String {
    let result = this.get(cx, Identifier::new(Text::from_ascii(name)).name());
    show(cx, result)
}

fn statics(cx: &mut Cx) -> String {
    let constructor = cx.regexp_constructor().into();
    let values =
        ["$_", "$`", "$&", "$'", "$1", "$2", "$9", "$+"].map(|it| get(cx, constructor, it));
    values.join("|")
}

fn native(cx: &Cx, function: NativeFunction) -> Value {
    JsFunction::native(cx, 0, &StringRef::empty(), function).into()
}

/// Once as it is, and once with a property of its own, which makes every step observable.
fn both_ways(cx: &mut Cx, pattern: &str, flags: &str, mut check: impl FnMut(&mut Cx, Value)) {
    let pristine = regexp(cx, pattern, flags);
    check(cx, pristine);
    let extended = regexp(cx, pattern, flags);
    let object = extended.cast::<JsObject>();
    object.set(cx, names::value, Value::NULL, true).unwrap();
    check(cx, extended);
}

#[native_abi]
fn show_arguments(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    cx.heap.collect_and_sweep(Some(Scope::Full));
    cx.delete_regexp_code();
    let arguments = cx.new_array_from(frame.arguments()).map(Into::into);
    let text = show(cx, arguments);
    Ok(string(cx, &text))
}

#[test]
fn exec_and_last_index() {
    with_realm(|cx| {
        for (pattern, flags, subject, expected) in [
            (
                "b(c)?(x)?",
                "",
                "abc",
                "[bc,c,undefined,index:1,input:abc,groups:undefined]",
            ),
            ("z", "", "abc", "null"),
            (
                "(?<a>x)|(?<a>b)(?<c>c)",
                "",
                "bc",
                "[bc,undefined,b,c,index:0,input:bc,groups:{a:b,c:c}]",
            ),
            (
                "(?<a>b)(x)?",
                "d",
                "ab",
                "[b,b,undefined,index:1,input:ab,groups:{a:b},indices:[[1,2],[1,2],undefined,groups:{a:[1,2]}]]",
            ),
            (
                ".",
                "u",
                "\u{1f600}",
                "[\u{1f600},index:0,input:\u{1f600},groups:undefined]",
            ),
        ] {
            let (this, subject) = (regexp(cx, pattern, flags), string(cx, subject));
            for _ in 0..200 {
                assert_eq!(invoke(cx, this, names::exec, &[subject]), expected);
            }
        }
        let (this, subject) = (regexp(cx, "a", "y"), string(cx, "aab"));
        for expected in ["true 1", "true 2", "false 0", "true 1"] {
            let result = invoke(cx, this, names::test, &[subject]);
            assert_eq!(format!("{result} {}", get(cx, this, "lastIndex")), expected);
        }
        let object = this.cast::<JsObject>();
        assert!(!object.delete(cx, names::lastIndex).unwrap());
        object
            .set_integrity_level(cx, IntegrityLevel::Frozen)
            .unwrap();
        let result = invoke(cx, this, names::test, &[subject]);
        assert_eq!(result, errors::READ_ONLY_PROPERTY_WRITE);
    });
}

#[test]
fn construction() {
    with_realm(|cx| {
        for (pattern, flags, expected) in [
            ("", "", "/(?:)/"),
            ("a/[/]\n", "ymig", "/a\\/[/]\\n/gimy"),
            ("(", "", "Invalid regular expression: missing )"),
            ("a", "gg", "Invalid flags supplied to RegExp constructor."),
        ] {
            let result = try_regexp(cx, pattern, flags);
            let result = result.and_then(|it| cx.invoke(it, names::toString, &[]));
            assert_eq!(show(cx, result), expected);
        }
        let (a, b) = (regexp(cx, "same", "g"), regexp(cx, "same", "g"));
        assert!(a != b && a.cast::<RegExpObject>().regexp() == b.cast::<RegExpObject>().regexp());
        let constructor = cx.regexp_constructor().into();
        assert_eq!(cx.call(constructor, Value::NULL, &[a]).unwrap(), a);
        let pattern = string(cx, "other");
        cx.invoke(a, names::compile, &[pattern]).unwrap();
        assert_eq!(invoke(cx, a, names::toString, &[]), "/other/");
        let text = string(cx, "a.b c");
        assert_eq!(
            invoke(cx, constructor, names::escape, &[text]),
            "\\x61\\.b\\x20c"
        );
    });
}

#[test]
fn methods_named_by_symbols() {
    with_realm(|cx| {
        for (method, pattern, flags, subject, argument, expected) in [
            (symbols::r#match, "a.", "g", "abac", None, "[ab,ac]"),
            (symbols::r#match, "an", "g", "banana", None, "[an,an]"),
            (symbols::r#match, "x*", "gu", "\u{1f600}x", None, "[,x,]"),
            (symbols::r#match, "x", "g", "abc", None, "null"),
            (symbols::search, "c+", "g", "abcc", None, "2"),
            (symbols::search, "c", "y", "abc", None, "-1"),
            (
                symbols::split,
                "(-)|,",
                "",
                "a-b,c",
                None,
                "[a,-,b,undefined,c]",
            ),
            (symbols::split, "", "u", "a\u{1f600}", None, "[a,\u{1f600}]"),
            (symbols::split, "\\s+", "y", " a  b", None, "[,a,b]"),
            (symbols::split, ",", "", "a,b,c", Some("2"), "[a,b]"),
            (symbols::split, "x*", "", "", None, "[]"),
            (
                symbols::replace,
                "b",
                "",
                "abb",
                Some("[$&$`$'$$]"),
                "a[bab$]b",
            ),
            (
                symbols::replace,
                "(a)(?<n>b)?",
                "g",
                "aba",
                Some("$2$<n>$1$3"),
                "bba$3a$3",
            ),
            (
                symbols::replace,
                "^\\s+|\\s+$",
                "g",
                "  a b ",
                Some(""),
                "a b",
            ),
            (
                symbols::replace,
                "x*",
                "g",
                "ab",
                Some("\u{2014}"),
                "\u{2014}a\u{2014}b\u{2014}",
            ),
            (symbols::replace, "b", "y", "ab", Some("c"), "ab"),
        ] {
            both_ways(cx, pattern, flags, |cx, this| {
                let argument = argument.map_or_default(|it| string(cx, it));
                let arguments = [string(cx, subject), argument];
                assert_eq!(invoke(cx, this, method, &arguments), expected, "{pattern}");
            });
        }
        both_ways(cx, "(?<l>[a-z])(\\d)?", "g", |cx, this| {
            let arguments = [string(cx, "a1-b"), native(cx, show_arguments)];
            let expected = "[a1,a,1,0,a1-b,{l:a}]-[b,b,undefined,3,a1-b,{l:b}]";
            assert_eq!(invoke(cx, this, symbols::replace, &arguments), expected);
        });
        both_ways(cx, "a?", "g", |cx, this| {
            let subject = string(cx, "ab");
            let iterator = cx.invoke(this, symbols::matchAll, &[subject]).unwrap();
            let iterator = iterator.cast::<RegExpStringIterator>();
            let mut indices = Vec::new();
            while let Some(result) = iterator.next_match(cx).unwrap() {
                indices.push(get(cx, result.into(), "index"));
            }
            assert_eq!(indices, ["0", "1", "2"]);
        });
    });
}

#[test]
fn many_matches() {
    with_realm(|cx| {
        let subject = string(cx, &"xyz".repeat(150_000));
        for (method, pattern, flags, length, last) in [
            (symbols::r#match, "[xy]z?", "g", 300_000, "yz"),
            (symbols::split, "(x)(y)", "", 450_001, "z"),
            (symbols::split, "y", "", 150_001, "z"),
        ] {
            let this = regexp(cx, pattern, flags);
            let result = cx.invoke(this, method, &[subject]).unwrap();
            assert_eq!(result.cast::<JsArray>().length(), length);
            let element = result.get_index(cx, length - 1);
            assert_eq!(show(cx, element), last);
        }
    });
}

#[test]
fn simple_patterns_keep_their_answers_when_used_often() {
    with_realm(|cx| {
        for (pattern, found, replaced) in [
            ("b&", "1", "a_\r\nc  "),
            ("[&<]", "2", "ab_\r\nc  "),
            (r"\r?\n", "3", "ab&_c  "),
            (r"\r\n|[\r\n]", "3", "ab&_c  "),
            (r"\s+$", "6", "ab&\r\nc_"),
        ] {
            let (once, all) = (regexp(cx, pattern, ""), regexp(cx, pattern, "g"));
            let (subject, replacement) = (string(cx, "ab&\r\nc  "), string(cx, "_"));
            for _ in 0..1500 {
                assert_eq!(invoke(cx, once, symbols::search, &[subject]), found);
                let arguments = [subject, replacement];
                assert_eq!(invoke(cx, all, symbols::replace, &arguments), replaced);
            }
            let long = string(cx, &format!("{}ab&\r\nc  ", "x".repeat(1000)));
            let found = format!("100{found}");
            assert_eq!(invoke(cx, once, symbols::search, &[long]), found);
        }
    });
}

#[test]
fn the_last_match_is_on_record() {
    with_realm(|cx| {
        assert_eq!(statics(cx), "|||||||");
        let (this, subject) = (regexp(cx, "(b)(x)?(c)", ""), string(cx, "abcd"));
        invoke(cx, this, names::test, &[subject]);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(statics(cx), "abcd|a|bc|d|b|||c");
        let (constructor, input) = (cx.regexp_constructor(), string(cx, "new"));
        constructor.set(cx, names::input, input, true).unwrap();
        assert_eq!(statics(cx), "new|a|bc|d|b|||c");
        let (this, subject) = (regexp(cx, "a", "g"), string(cx, "xaya"));
        invoke(cx, this, symbols::r#match, &[subject]);
        assert_eq!(statics(cx), "xaya|xay|a|||||");
    });
}

#[test]
fn a_search_takes_time_in_proportion_to_the_subject() {
    with_realm(|cx| {
        let subject = string(cx, &format!("{}!", "a".repeat(3000)));
        for (pattern, expected) in [
            ("^(a|aa)+$", "-1"),
            ("^(?:(a|aa)+x|a+!)$", "0"),
            (r"^(\w+\s?)*$", "-1"),
            ("(?=(a|aa)+x)|!", "3000"),
        ] {
            let regexp = regexp(cx, pattern, "");
            for _ in 0..2 {
                assert_eq!(invoke(cx, regexp, symbols::search, &[subject]), expected);
                cx.delete_regexp_code();
            }
        }
        let regexp = regexp(cx, "(?:(a|aa)+x|(a)+(!))$", "");
        invoke(cx, regexp, names::exec, &[subject]);
        let constructor = cx.regexp_constructor().into();
        let groups = ["$1", "$2", "$3"].map(|it| get(cx, constructor, it));
        assert_eq!(groups, ["", "a", "!"]);
    });
}

#[test]
fn so_do_all_searches_of_a_subject_together() {
    with_realm(|cx| {
        let subject = string(cx, &format!("{}!\n", "a".repeat(40)).repeat(2000));
        for (method, flags, length) in [(symbols::r#match, "g", 2000), (symbols::split, "", 2001)] {
            let this = regexp(cx, r"(?:a|aa|!|\n)+(?=x)|!", flags);
            let result = cx.invoke(this, method, &[subject]).unwrap();
            assert_eq!(result.cast::<JsArray>().length(), length);
        }
        let this = regexp(cx, r"(?:a|aa|!|\n)+(?=x)|(!)", "g");
        for line in 0..2000 {
            let result = cx.invoke(this, names::exec, &[subject]).unwrap();
            assert_eq!(get(cx, result, "index"), (line * 42 + 40).to_string());
            if line % 500 == 0 {
                cx.heap.collect_and_sweep(Some(Scope::Full));
            }
        }
    });
}

#[test]
fn a_pattern_that_has_been_slow_goes_on_with_other_subjects() {
    with_realm(|cx| {
        let this = regexp(cx, "(?:a|aa)+(?=x)|!", "");
        for count in (0..3000).map(|it| if it % 1500 == 0 { 60 } else { it % 7 }) {
            let subject = string(cx, &format!("{}!", "a".repeat(count)));
            let index = invoke(cx, this, symbols::search, &[subject]);
            assert_eq!(index, count.to_string());
        }
    });
}

#[test]
fn a_long_search_ends_with_the_thread() {
    with_realm(|cx| {
        let (this, subject) = (regexp(cx, "^(a|aa)+\\1b", ""), string(cx, &"a".repeat(80)));
        cx.traps().request_termination();
        assert!(cx.invoke(this, names::test, &[subject]).is_err());
        assert!(cx.has_pending_termination_exception());
    });
}
