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

fn new_date(cx: &mut Cx, arguments: &[Value]) -> Value {
    let constructor = cx.date_constructor().into();
    let date = cx.construct(constructor, arguments, constructor);
    date.unwrap().into()
}

fn string(cx: &Cx, ascii: &'static str) -> Value {
    JsString::from_literal(cx, ascii).into()
}

/// The result as a string, or the message of the error.
fn invoke(cx: &mut Cx, this: Value, name: PropertyName<'_>, arguments: &[Value]) -> String {
    let result = match cx.invoke(this, name, arguments) {
        Ok(result) => result,
        Err(thrown) => {
            let error = cx.catch_value(thrown).unwrap();
            error.get(cx, names::message).unwrap()
        }
    };
    result.to_string_view(cx).unwrap().text().to_string()
}

fn getters_and_strings(cx: &mut Cx) {
    let components = [2024, 2, 9, 23, 5, 9, 45].map(Value::from);
    let date = new_date(cx, &components);
    for (name, expected) in [
        ("getTime", "1710043509045"),
        ("getFullYear", "2024"),
        ("getYear", "124"),
        ("getMonth", "2"),
        ("getDate", "9"),
        ("getUTCDate", "10"),
        ("getDay", "6"),
        ("getUTCDay", "0"),
        ("getHours", "23"),
        ("getUTCHours", "4"),
        ("getMinutes", "5"),
        ("getSeconds", "9"),
        ("getMilliseconds", "45"),
        ("getTimezoneOffset", "300"),
        ("toDateString", "Sat Mar 09 2024"),
        ("toTimeString", "23:05:09 GMT-0500 (Eastern Standard Time)"),
        ("toGMTString", "Sun, 10 Mar 2024 04:05:09 GMT"),
        ("toJSON", "2024-03-10T04:05:09.045Z"),
    ] {
        let name = Identifier::new(Text::from_ascii(name));
        assert_eq!(invoke(cx, date, name.name(), &[]), expected);
    }
    let invalid = new_date(cx, &[Value::NAN]);
    for (name, expected) in [
        (names::getHours, "NaN"),
        (names::getUTCMilliseconds, "NaN"),
        (names::toString, "Invalid Date"),
        (names::toISOString, "Invalid Date"),
        (names::toJSON, "null"),
        (names::setHours, "NaN"),
    ] {
        assert_eq!(invoke(cx, invalid, name, &[1.into()]), expected);
    }
    let prototype = cx.date_prototype().into();
    assert_eq!(invoke(cx, prototype, names::getTime, &[]), "Type error");
}

fn setters(cx: &mut Cx) {
    let date = new_date(cx, &[Value::NAN]);
    for (name, arguments, expected) in [
        (names::setYear, &[99.5][..], "1999-01-01T05:00:00.000Z"),
        (
            names::setFullYear,
            &[2024.0, 2.0, 10.0, 7.0],
            "2024-03-10T05:00:00.000Z",
        ),
        (names::setHours, &[2.0, 30.0], "2024-03-10T07:30:00.000Z"),
        (names::setUTCMonth, &[-1.0], "2023-12-10T07:30:00.000Z"),
        (names::setDate, &[0.0, 5.0], "2023-11-30T07:30:00.000Z"),
        (
            names::setUTCSeconds,
            &[1.0, 2.0],
            "2023-11-30T07:30:01.002Z",
        ),
        (names::setTime, &[-0.5], "1970-01-01T00:00:00.000Z"),
        (names::setMinutes, &[], "Invalid Date"),
    ] {
        let mut values = ValueVec::new();
        arguments.iter().for_each(|&it| values.push(it.into()));
        invoke(cx, date, name, &values);
        assert_eq!(invoke(cx, date, names::toISOString, &[]), expected);
    }
}

fn constructor(cx: &mut Cx) {
    let constructor = cx.date_constructor().into();
    let text = string(cx, "Thu, 01 Jan 1970 00:00:01 GMT");
    assert_eq!(invoke(cx, constructor, names::parse, &[text]), "1000");
    assert_eq!(invoke(cx, constructor, names::UTC, &[]), "NaN");
    assert_eq!(invoke(cx, constructor, names::UTC, &[70.into()]), "0");
    let components = [70.5.into(), string(cx, "0"), Value::TRUE, 1.into()];
    assert_eq!(invoke(cx, constructor, names::UTC, &components), "3600000");

    cx.global().overridden_date_now().set(-1000.0);
    assert_eq!(invoke(cx, constructor, names::now, &[]), "-1000");
    let now = new_date(cx, &[]);
    let copy = new_date(cx, &[now]);
    assert_eq!(invoke(cx, copy, names::valueOf, &[]), "-1000");
    let called = cx.call(constructor, Value::UNDEFINED, &[1.into()]).unwrap();
    assert_eq!(
        called.to_string_view(cx).unwrap().text().to_string(),
        "Wed Dec 31 1969 18:59:59 GMT-0500 (Eastern Standard Time)"
    );

    for (hint, expected) in [
        (string(cx, "number"), "-1000"),
        (1.into(), "Primitive hint is not a string."),
    ] {
        assert_eq!(invoke(cx, now, symbols::toPrimitive, &[hint]), expected);
    }
}

fn conversions(cx: &mut Cx) {
    let (date, other) = (new_date(cx, &[5.into()]), new_date(cx, &[5.into()]));
    let year = date.get(cx, names::getUTCFullYear).unwrap();
    assert_eq!(date.to_number(cx).unwrap(), 5.0);
    assert_eq!(
        date.to_string_view(cx).unwrap().text().to_string(),
        invoke(cx, date, names::toString, &[])
    );
    let other = other.as_object().unwrap();
    other.set(cx, names::valueOf, year, true).unwrap();
    assert_eq!(other.as_value().to_number(cx).unwrap(), 1970.0);
    assert_eq!(date.to_number(cx).unwrap(), 5.0);
    let prototype = cx.date_prototype();
    prototype.set(cx, names::valueOf, year, true).unwrap();
    assert_eq!(date.to_number(cx).unwrap(), 1970.0);
}

fn change_of_zone(cx: &mut Cx) {
    let old = new_date(cx, &[0.into()]);
    assert_eq!(invoke(cx, old, names::getHours, &[]), "19");
    cx.heap.collect_and_sweep(Some(Scope::Full));
    let young = new_date(cx, &[0.into()]);
    assert_eq!(invoke(cx, young, names::getHours, &[]), "19");
    let locale = string(cx, "de");
    let local = invoke(cx, old, names::toLocaleString, &[locale]);
    assert_eq!(local, "31.12.1969, 19:00:00");

    assert!(cx.set_time_zone(Text::from_ascii("Asia/Tokyo")));
    let local = invoke(cx, old, names::toLocaleString, &[locale]);
    assert_eq!(local, "1.1.1970, 09:00:00");
    assert!(!cx.set_time_zone(Text::from_ascii("Nowhere")));
    for date in [old, young] {
        let fields = date.cast::<DateInstance>().local_fields(cx);
        assert_eq!(fields.unwrap().hour(), 9);
    }
}

#[native_abi]
fn hours_after_another_thread_moves_to_utc(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let other = std::thread::Builder::new().spawn(|| {
        with_realm(|other| assert!(other.set_time_zone(Text::from_ascii("UTC"))));
    });
    other.unwrap().join().unwrap();
    let new = new_date(cx, &[86_400_000.into()]);
    assert_eq!(invoke(cx, new, names::getHours, &[]), "9");
    cx.invoke(frame.this_value(), names::getHours, &[])
}

fn change_of_zone_by_another_thread(cx: &mut Cx) {
    let date = new_date(cx, &[0.into()]);
    let name = StringRef::empty();
    let function = JsFunction::native(cx, 0, &name, hours_after_another_thread_moves_to_utc);
    assert_eq!(cx.call(function.into(), date, &[]).unwrap(), 9.into());
    assert_eq!(cx.date_cache().time_zone().identifier(), "Asia/Tokyo");
    assert_eq!(invoke(cx, date, names::getHours, &[]), "0");
}

/// One test, because the zone is that of the process.
#[test]
fn dates() {
    with_realm(|cx| {
        assert!(cx.set_time_zone(Text::from_ascii("America/New_York")));
        getters_and_strings(cx);
        setters(cx);
        constructor(cx);
        conversions(cx);
        change_of_zone(cx);
        change_of_zone_by_another_thread(cx);
    });
}
