use bun_engine_number::Random;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, Text, names};
use bun_engine_vm::heap::HeapKind;
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

/// The result as a string, or the message of the error.
fn invoke(cx: &mut Cx, this: Value, name: &str, arguments: &[Value]) -> String {
    let name = Identifier::new(Text::from_ascii(name));
    let result = cx
        .invoke(this, name.name(), arguments)
        .or_else(|thrown| cx.catch_value(thrown)?.get(cx, names::message))
        .unwrap();
    result.to_string_view(cx).unwrap().text().to_string()
}

fn keys(cx: &mut Cx, object: &JsObject) -> String {
    let (kinds, mode) = (PropertyNameMode::StringsAndSymbols, DontEnumMode::Include);
    let keys = object.own_keys(cx, kinds, mode).unwrap();
    let keys: Vec<String> = keys
        .iter()
        .map(|key| key.name().text().to_string())
        .collect();
    keys.join(" ")
}

#[test]
fn properties_are_in_order() {
    with_realm(|cx| {
        let (constructor, prototype) = (cx.number_constructor(), cx.number_prototype());
        assert_eq!(
            keys(cx, &constructor),
            "length name isFinite isNaN isSafeInteger prototype EPSILON MAX_VALUE MIN_VALUE MAX_SAFE_INTEGER \
             MIN_SAFE_INTEGER NEGATIVE_INFINITY POSITIVE_INFINITY NaN parseInt parseFloat isInteger"
        );
        assert_eq!(
            keys(cx, &prototype),
            "toLocaleString valueOf toFixed toExponential toPrecision toString constructor"
        );
        for name in [names::parseInt, names::parseFloat] {
            let global = cx.global().get(cx, name).unwrap();
            assert_eq!(constructor.get(cx, name).unwrap(), global);
        }
        assert!(cx.holds(RealmWatchpoint::NumberToString));
        prototype
            .set(cx, names::toString, Value::NULL, true)
            .unwrap();
        assert!(!cx.holds(RealmWatchpoint::NumberToString));
    });
}

#[test]
fn number_methods() {
    with_realm(|cx| {
        let constructor = Value::from(cx.number_constructor());
        let text = JsString::from_literal(cx, " 0x10 ").into();
        let number = cx.call(constructor, Value::UNDEFINED, &[text]).unwrap();
        assert_eq!(number, Value::int32(16));
        let bigint = JsBigInt::from_small(cx, 1i64 << 40).into();
        let object = cx.construct(constructor, &[bigint], constructor).unwrap();
        let undefined = Value::UNDEFINED;
        for (this, name, argument, expected) in [
            (object.into(), "valueOf", undefined, "1099511627776"),
            (object.into(), "toString", 32.into(), "100000000"),
            (255.into(), "toString", 16.9.into(), "ff"),
            (Value::from(-0.5), "toString", undefined, "-0.5"),
            (
                1.into(),
                "toString",
                Value::NULL,
                "toString() radix argument must be between 2 and 36",
            ),
            (1.45.into(), "toFixed", 1.into(), "1.4"),
            (1.5.into(), "toFixed", undefined, "2"),
            (1.into(), "toFixed", Value::from(-0.9), "1"),
            (
                Value::NAN,
                "toFixed",
                f64::INFINITY.into(),
                "toFixed() argument must be between 0 and 100",
            ),
            (1200.into(), "toExponential", undefined, "1.2e+3"),
            (1200.into(), "toExponential", Value::NULL, "1e+3"),
            (Value::NAN, "toExponential", 101.into(), "NaN"),
            (1e21.into(), "toPrecision", undefined, "1e+21"),
            (
                1.into(),
                "toPrecision",
                Value::NAN,
                "toPrecision() argument must be between 1 and 100",
            ),
            (constructor, "isInteger", 1e300.into(), "true"),
            (constructor, "isSafeInteger", 1e300.into(), "false"),
            (constructor, "isNaN", undefined, "false"),
            (constructor, "isFinite", text, "false"),
        ] {
            assert_eq!(invoke(cx, this, name, &[argument]), expected);
        }
        let method = object.get(cx, names::valueOf).unwrap();
        let thrown = cx.call(method, text, &[]).unwrap_err();
        let error = cx.catch_value(thrown).unwrap();
        let message = error.get(cx, names::message).unwrap();
        let message = message.to_string_view(cx).unwrap();
        let expected = "thisNumberValue called on incompatible string";
        assert!(message.text().eq_ascii(expected));
    });
}

#[test]
fn global_functions() {
    with_realm(|cx| {
        let global = Value::from(cx.global());
        let piece = JsString::from_literal(cx, "1234567890123");
        let rope = JsString::concat(cx, piece, piece).unwrap();
        let cases: [(&str, &[Value], &str); 8] = [
            ("parseInt", &[rope.into()], "1.2345678901231235e+25"),
            ("parseInt", &[piece.into(), 4.into()], "27"),
            ("parseInt", &[1e-7.into()], "1"),
            ("parseInt", &[15.9.into(), 16.into()], "21"),
            ("parseFloat", &[piece.into()], "1234567890123"),
            ("parseFloat", &[], "NaN"),
            ("isNaN", &[], "true"),
            ("isFinite", &[piece.into()], "true"),
        ];
        for (name, arguments, expected) in cases {
            assert_eq!(invoke(cx, global, name, arguments), expected);
        }
        assert!(rope.is_rope());
        let zero = cx.invoke(global, names::parseFloat, &[Value::from(-0.0)]);
        assert_eq!(zero.unwrap(), Value::ZERO);
    });
}

#[test]
fn math_functions() {
    with_realm(|cx| {
        let math = Value::from(cx.math_object());
        let cases: [(&str, &[f64], &str); 14] = [
            ("abs", &[-2147483648.0], "2147483648"),
            ("atan2", &[0.0, -1.0], "3.141592653589793"),
            ("ceil", &[1.2], "2"),
            ("clz32", &[-1.0], "0"),
            ("hypot", &[], "0"),
            ("hypot", &[-3.0], "3"),
            ("hypot", &[1.0, 1.0, 1.0, 1.0], "2"),
            ("imul", &[4294967295.0, 5.0], "-5"),
            ("max", &[], "-Infinity"),
            ("max", &[1.0, f64::NAN, 3.0], "NaN"),
            ("min", &[2.0, -7.0], "-7"),
            ("pow", &[2.0, 0.5], "1.4142135623730951"),
            ("round", &[-2.5], "-2"),
            ("sqrt", &[], "NaN"),
        ];
        for (name, arguments, expected) in cases {
            let mut values = root_vec();
            values.extend(arguments.iter().map(|&it| Value::from(it)));
            assert_eq!(invoke(cx, math, name, &values), expected);
        }
        let text = JsString::from_literal(cx, "1").into();
        let lists: [(&[Value], &str); 4] = [
            (&[i32::MAX.into(), i32::MAX.into()], "4294967294"),
            (&[0.1.into(), 0.2.into(), 0.3.into()], "0.6"),
            (&[1.into(), Value::NAN], "NaN"),
            (&[1.into(), text], "Math.sumPrecise was passed a non-number"),
        ];
        for (terms, expected) in lists {
            let array = cx.new_array_from(terms).unwrap();
            assert_eq!(invoke(cx, math, "sumPrecise", &[array.into()]), expected);
        }
        cx.global().random_state().set(Random::new(42));
        assert_eq!(invoke(cx, math, "random", &[]), "3.911585177984733e-8");
        assert_eq!(invoke(cx, math, "random", &[]), "0.32812503913465796");
        assert_eq!(cx.global().random_state().get().seed(), 42);
    });
}
