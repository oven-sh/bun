use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, Text, names};
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

fn string(cx: &Cx, text: &'static str) -> Value {
    JsString::from_literal(cx, text).into()
}

fn object(cx: &Cx, properties: &[(&'static str, Value)]) -> Value {
    let object = cx.new_object();
    for &(name, value) in properties {
        let name = Identifier::from_literal(name);
        object.put_direct(cx, name.name(), value, Attributes::empty());
    }
    object.into()
}

fn get(cx: &mut Cx, this: Value, name: &str) -> JsResult<Value> {
    this.get(cx, Identifier::new(Text::from_ascii(name)).name())
}

fn invoke(cx: &mut Cx, this: Value, name: &str, arguments: &[Value]) -> JsResult<Value> {
    let name = Identifier::new(Text::from_ascii(name));
    cx.invoke(this, name.name(), arguments)
}

fn from(cx: &mut Cx, class: &str, item: Value) -> JsResult<Value> {
    let namespace = cx.temporal_object().into();
    let class = get(cx, namespace, class)?;
    invoke(cx, class, "from", &[item])
}

/// The result as a string, or the type and the message of the error.
fn show(cx: &mut Cx, result: JsResult<Value>) -> String {
    let (prefix, value) = match result {
        Ok(value) => (String::new(), value),
        Err(thrown) => {
            let error = cx.catch_value(thrown).unwrap();
            let error_type = error.cast::<ErrorInstance>().error_type();
            let message = error.get(cx, names::message).unwrap();
            (format!("{error_type:?}: "), message)
        }
    };
    format!("{prefix}{}", value.to_string_view(cx).unwrap().text())
}

fn keys(cx: &mut Cx, object: Value) -> String {
    let (kinds, mode) = (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include);
    let keys = object.cast::<JsObject>().own_keys(cx, kinds, mode).unwrap();
    let keys: Vec<String> = (keys.iter())
        .map(|key| key.name().text().to_string())
        .collect();
    keys.join(" ")
}

#[test]
fn properties_are_in_order() {
    with_realm(|cx| {
        let namespace = cx.temporal_object().into();
        assert_eq!(
            keys(cx, namespace),
            "Duration Instant Now PlainDate PlainDateTime PlainTime PlainMonthDay PlainYearMonth ZonedDateTime \
             Symbol.toStringTag"
        );
        let constructor = get(cx, namespace, "PlainMonthDay").unwrap();
        assert_eq!(keys(cx, constructor), "from length name prototype");
        let prototype = constructor.get(cx, names::prototype).unwrap();
        assert_eq!(
            keys(cx, prototype),
            "toPlainDate toString toJSON toLocaleString with equals valueOf calendarId day monthCode constructor \
             Symbol.toStringTag"
        );
    });
}

#[test]
fn every_class_reads_and_writes_text() {
    with_realm(|cx| {
        for (class, text) in [
            ("Duration", "-P1Y2M3W4DT5H6M7.8S"),
            ("Instant", "2020-01-01T00:00:00.000000001Z"),
            ("PlainDate", "2020-01-01[u-ca=hebrew]"),
            ("PlainDateTime", "2020-01-01T12:00:00[u-ca=roc]"),
            ("PlainMonthDay", "02-29"),
            ("PlainTime", "23:59:59.5"),
            ("PlainYearMonth", "2020-01"),
            ("ZonedDateTime", "2020-01-01T00:00:00+09:00[Asia/Tokyo]"),
        ] {
            let item = string(cx, text);
            let value = from(cx, class, item).unwrap();
            for method in ["toString", "toJSON"] {
                let result = invoke(cx, value, method, &[]);
                assert_eq!(show(cx, result), text);
            }
            let copy = from(cx, class, value).unwrap();
            assert!(copy != value);
            assert_eq!(show(cx, Ok(copy)), text);
        }
    });
}

#[test]
fn fields_and_options_come_from_objects() {
    with_realm(|cx| {
        let fields = [
            ("calendar", string(cx, "japanese")),
            ("era", string(cx, "heisei")),
            ("eraYear", 31.into()),
            ("monthCode", string(cx, "M04")),
            ("day", 31.into()),
        ];
        let item = object(cx, &fields);
        let date = from(cx, "PlainDate", item).unwrap();
        let month = object(cx, &[("months", 1.into())]);
        let later = invoke(cx, date, "add", &[month]).unwrap();
        for (name, expected) in [
            ("calendarId", "japanese"),
            ("era", "reiwa"),
            ("eraYear", "1"),
            ("monthCode", "M05"),
            ("day", "30"),
            ("weekOfYear", "undefined"),
        ] {
            let result = get(cx, later, name);
            assert_eq!(show(cx, result), expected);
        }
        let options = object(cx, &[("largestUnit", string(cx, "weeks"))]);
        let result = invoke(cx, date, "since", &[later, options]);
        assert_eq!(show(cx, result), "-P4W2D");
    });
}

#[test]
fn errors() {
    with_realm(|cx| {
        let item = string(cx, "2020-01");
        let month = from(cx, "PlainYearMonth", item).unwrap();
        let prototype = month.cast::<JsObject>().get_prototype_of(cx).unwrap();
        let result = get(cx, prototype, "calendarId");
        assert_eq!(
            show(cx, result),
            "TypeError: Temporal.PlainYearMonth.prototype.calendar called on value that's not a PlainYearMonth"
        );
        let result = invoke(cx, month, "toPlainDate", &[Value::NULL]);
        assert_eq!(
            show(cx, result),
            "TypeError: Temporal.PlainYearMonth.prototype.toPlainDate: item is not an object"
        );
        let constructor = cx.temporal_instant_constructor().into();
        let result = cx.call(constructor, Value::UNDEFINED, &[]);
        assert_eq!(
            show(cx, result),
            "TypeError: calling Instant constructor without new is invalid"
        );
        let too_late = JsBigInt::from_small(cx, 8_640_000_000_000_000_000_001i128).into();
        let result = cx.construct(constructor, &[too_late], constructor);
        assert_eq!(
            show(cx, result.map(Into::into)),
            "RangeError: 8640000000000000000001 epoch nanoseconds is outside of the supported range for Temporal.Instant"
        );
    });
}

#[test]
fn now_follows_the_clock_of_the_embedder() {
    with_realm(|cx| {
        let (now, zone) = (cx.temporal_now_object().into(), string(cx, "-01:00"));
        cx.global().overridden_date_now().set(1.5);
        let result = invoke(cx, now, "zonedDateTimeISO", &[zone]);
        assert_eq!(show(cx, result), "1969-12-31T23:00:00.001-01:00[-01:00]");
        cx.global().overridden_date_now().set(1e300);
        let result = invoke(cx, now, "instant", &[]);
        assert_eq!(
            show(cx, result),
            "RangeError: Overridden current time 1e+300 ms is outside of supported range for Temporal.Now"
        );
    });
}

#[test]
fn time_zones_keep_their_names_and_offsets() {
    with_realm(|cx| {
        let item = string(cx, "2024-03-10T06:59:59Z");
        let instant = from(cx, "Instant", item).unwrap();
        for _ in 0..2 {
            for (given, identifier, offset) in [
                (names::UTC, "UTC", "+00:00"),
                (
                    Identifier::from_literal("asia/calcutta").name(),
                    "Asia/Calcutta",
                    "+05:30",
                ),
                (Identifier::from_literal("-0130").name(), "-01:30", "-01:30"),
            ] {
                let given = JsString::from_name(cx, given).into();
                let zoned = invoke(cx, instant, "toZonedDateTimeISO", &[given]).unwrap();
                for (name, expected) in [("timeZoneId", identifier), ("offset", offset)] {
                    let result = get(cx, zoned, name);
                    assert_eq!(show(cx, result), expected);
                }
            }
            cx.heap.collect_and_sweep(Some(Scope::Full));
        }
    });
}
