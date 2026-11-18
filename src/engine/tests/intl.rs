use bun_engine_standalone as _;
use bun_engine_text::{PropertyName, StringRef, names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

const DEFAULT_HOOKS: RealmHooks = RealmHooks {
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

static HOOKS: RealmHooks = DEFAULT_HOOKS;

static GERMAN_HOOKS: RealmHooks = RealmHooks {
    default_language: || StringRef::from_literal("de-DE"),
    ..DEFAULT_HOOKS
};

fn with_realm(hooks: &'static RealmHooks, body: impl FnOnce(&mut Cx)) {
    set_options(Options::default());
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    unsafe { body(Cx::from_global(GlobalObject::create(vm.get(), hooks))) };
}

fn string(cx: &Cx, text: &str) -> Value {
    JsString::new(cx, StringRef::from_str(text)).into()
}

fn text(cx: &mut Cx, value: Value) -> String {
    value.to_string_view(cx).unwrap().text().to_string()
}

fn record(cx: &mut Cx, properties: &[(PropertyName<'_>, &str)]) -> Value {
    let object = cx.new_object();
    for &(name, value) in properties {
        let value = string(cx, value);
        object.set(cx, name, value, true).unwrap();
    }
    object.into()
}

fn construct(cx: &mut Cx, class: PropertyName<'_>, arguments: &[Value]) -> JsResult<Value> {
    let constructor = cx.intl_object().get(cx, class)?;
    Ok(cx.construct(constructor, arguments, constructor)?.into())
}

fn invoke(cx: &mut Cx, this: Value, method: PropertyName<'_>, arguments: &[Value]) -> Value {
    let method = this.get(cx, method).unwrap();
    cx.call(method, this, arguments).unwrap()
}

#[test]
fn bound_methods_keep_their_receiver() {
    with_realm(&HOOKS, |cx| {
        let locale = string(cx, "de");
        let options = record(cx, &[(names::style, "currency"), (names::currency, "eur")]);
        let format = construct(cx, names::NumberFormat, &[locale, options]).unwrap();
        let format = format.get(cx, names::format).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let formatted = cx.call(format, Value::UNDEFINED, &[1234.5.into()]).unwrap();
        assert_eq!(text(cx, formatted), "1.234,50\u{a0}\u{20ac}");
        let name = format.get(cx, names::name).unwrap();
        assert_eq!(text(cx, name), "");
    });
}

#[test]
fn parts_and_segments_are_plain_objects() {
    with_realm(&HOOKS, |cx| {
        let format = construct(cx, names::RelativeTimeFormat, &[]).unwrap();
        let unit = string(cx, "days");
        let parts = invoke(cx, format, names::formatToParts, &[2.into(), unit]);
        let number = parts.get_index(cx, 1).unwrap();
        let described = [names::r#type, names::value, names::unit].map(|name| {
            let value = number.get(cx, name).unwrap();
            text(cx, value)
        });
        assert_eq!(described, ["integer", "2", "day"]);

        let options = record(cx, &[(names::granularity, "word")]);
        let segmenter = construct(cx, names::Segmenter, &[Value::UNDEFINED, options]).unwrap();
        let input = string(cx, "one two");
        let segments = invoke(cx, segmenter, names::segment, &[input]);
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let data = invoke(cx, segments, names::containing, &[5.into()]);
        let segment = data.get(cx, names::segment).unwrap();
        assert_eq!(text(cx, segment), "two");
        assert!(data.get(cx, names::isWordLike).unwrap().is_true());
    });
}

#[test]
fn errors_become_exceptions() {
    with_realm(&HOOKS, |cx| {
        let tag = string(cx, "en_US");
        let thrown = construct(cx, names::Collator, &[tag]).unwrap_err();
        let error = cx.catch_value(thrown).unwrap();
        let message = error.get(cx, names::message).unwrap();
        assert_eq!(text(cx, message), "invalid language tag: en_US");
    });
}

#[test]
fn a_realm_can_have_its_own_language() {
    for (hooks, expected) in [(&HOOKS, "1,000.5"), (&GERMAN_HOOKS, "1.000,5")] {
        with_realm(hooks, |cx| {
            let none = Value::UNDEFINED;
            let formatted = bun_engine_intl::number_to_locale_string(cx, 1000.5, none, none);
            assert_eq!(text(cx, formatted.unwrap().into()), expected);
        });
    }
}

#[test]
fn dates_and_durations_survive_collection() {
    with_realm(&HOOKS, |cx| {
        let options = record(cx, &[(names::timeZone, "+0100"), (names::month, "long")]);
        let format = construct(cx, names::DateTimeFormat, &[Value::UNDEFINED, options]).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let range = invoke(cx, format, names::formatRange, &[0.into(), 3e9.into()]);
        assert_eq!(text(cx, range), "January – February");
        let resolved = invoke(cx, format, names::resolvedOptions, &[]);
        let time_zone = resolved.get(cx, names::timeZone).unwrap();
        assert_eq!(text(cx, time_zone), "+01:00");

        let options = record(cx, &[(names::style, "digital")]);
        let format = construct(cx, names::DurationFormat, &[Value::UNDEFINED, options]).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        let duration = record(cx, &[(names::hours, "1"), (names::milliseconds, "500")]);
        let formatted = invoke(cx, format, names::format, &[duration]);
        assert_eq!(text(cx, formatted), "1:00:00.5");
    });
}

#[test]
fn temporal_objects_are_formatted_by_their_type() {
    with_realm(&HOOKS, |cx| {
        let format = construct(cx, names::DateTimeFormat, &[]).unwrap();
        for (class, source, options, expected) in [
            (names::PlainDate, "2021-03-04", None, "3/4/2021"),
            (names::PlainTime, "05:06:07", None, "5:06:07 AM"),
            (names::Duration, "PT1H2M", None, "1 hr, 2 min"),
            (
                names::ZonedDateTime,
                "2021-03-04T05:06[+01:00]",
                None,
                "3/4/2021, 5:06:00 AM GMT+1",
            ),
            (
                names::Instant,
                "2021-03-04T05:06Z",
                Some((names::timeZone, "Asia/Tokyo")),
                "3/4/2021, 2:06:00 PM",
            ),
        ] {
            let constructor = cx.temporal_object().get(cx, class).unwrap();
            let source = string(cx, source);
            let object = invoke(cx, constructor, names::from, &[source]);
            let arguments = [Value::UNDEFINED, record(cx, options.as_slice())];
            let formatted = invoke(cx, object, names::toLocaleString, &arguments);
            assert_eq!(text(cx, formatted), expected);
            if class == names::PlainTime {
                let range = invoke(cx, format, names::formatRange, &[object, object]);
                assert_eq!(text(cx, range), expected);
            }
        }
    });
}
