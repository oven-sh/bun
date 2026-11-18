use core::cmp::Ordering::{Equal, Greater, Less};

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

/// The result, or the error, as a string.
fn show(cx: &mut Cx, result: JsResult<Value>) -> String {
    let value = result.or_else(|thrown| {
        let error = cx.catch_value(thrown)?;
        error.get(cx, names::message)
    });
    let view = value.unwrap().to_string_view(cx).unwrap();
    view.text().to_string()
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

fn big(cx: &Cx, text: &str) -> Gc<JsBigInt> {
    JsBigInt::parse(cx, Text::from_ascii(text)).unwrap()
}

#[test]
fn constructor_and_prototype() {
    with_realm(|cx| {
        let (constructor, prototype) = (cx.bigint_constructor(), cx.bigint_prototype());
        assert_eq!(
            keys(cx, &constructor),
            "asUintN asIntN length name prototype"
        );
        assert_eq!(
            keys(cx, &prototype),
            "toString toLocaleString valueOf constructor Symbol.toStringTag"
        );
        let constructor = Value::from(constructor);
        assert!(constructor.is_constructor());
        let string = |text| Value::from(JsString::from_literal(cx, text));
        for (argument, expected) in [
            (Value::int32(-7), "-7"),
            (1e21.into(), "1000000000000000000000"),
            (Value::TRUE, "1"),
            (string(" 0x10 "), "16"),
            (string("1n"), "Failed to parse String to BigInt"),
            (0.5.into(), "Not an integer"),
            (
                Value::UNDEFINED,
                "Invalid argument type in ToBigInt operation",
            ),
        ] {
            let result = cx.call(constructor, Value::UNDEFINED, &[argument]);
            assert_eq!(show(cx, result), expected);
        }

        let value = Value::from(big(cx, "-255"));
        let object = value.to_object(cx).unwrap().into();
        for (this, name, arguments, expected) in [
            (value, "toString", [16.9.into(), Value::UNDEFINED], "-ff"),
            (object, "valueOf", [Value::UNDEFINED; 2], "-255"),
            (
                object,
                "toString",
                [Value::int32(37), Value::UNDEFINED],
                "toString() radix argument must be between 2 and 36",
            ),
            (constructor, "asUintN", [Value::int32(8), object], "1"),
            (constructor, "asIntN", [Value::int32(9), value], "-255"),
            (
                constructor,
                "asIntN",
                [Value::int32(-1), value],
                "number of bits cannot be negative",
            ),
        ] {
            let name = Identifier::new(Text::from_ascii(name));
            let result = cx.invoke(this, name.name(), &arguments);
            assert_eq!(show(cx, result), expected);
        }
        let method = prototype.get(cx, names::valueOf).unwrap();
        let result = cx.call(method, Value::ZERO, &[]);
        assert_eq!(
            show(cx, result),
            "'this' value must be a BigInt or BigIntObject"
        );
    });
}

#[test]
fn operators() {
    with_realm(|cx| {
        let (zero, one, three) = (JsBigInt::zero(cx), big(cx, "1"), big(cx, "3"));
        let power = JsBigInt::exponentiate(cx, &three, &big(cx, "5000")).unwrap();
        let next = JsBigInt::increment(cx, &power).unwrap();
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert!(JsBigInt::add(cx, &power, &zero).unwrap() == power);
        assert!(JsBigInt::subtract(cx, &power, &power).unwrap() == zero);
        assert!(JsBigInt::from_words(cx, true, &[0, 0]).unwrap() == zero);
        let product = JsBigInt::multiply(cx, &power, &next).unwrap();
        assert!(JsBigInt::remainder(cx, &product, &next).unwrap() == zero);
        let left = JsBigInt::remainder(cx, &next, &power).unwrap();
        assert_eq!(left.value(), one.value());
        let quotient = JsBigInt::divide(cx, &product, &next).unwrap();
        assert_eq!(quotient.value(), power.value());
        assert_eq!(quotient.hash(), power.hash());

        let negative = JsBigInt::unary_minus(cx, &power).unwrap();
        assert!(negative.hash() != power.hash() && negative.is_negative());
        let result = JsBigInt::divide(cx, &one, &zero).map(Into::into);
        assert_eq!(show(cx, result), "0 is an invalid divisor value.");
        let result = JsBigInt::left_shift(cx, &one, &power).map(Into::into);
        assert_eq!(
            show(cx, result),
            "Out of memory: BigInt generated from this operation is too big"
        );
    });
}

#[test]
fn comparisons_with_other_types() {
    with_realm(|cx| {
        let large = "100000000000000000000000000000000000000000000000000";
        let value = Value::from(big(cx, large));
        let string = |text| Value::from(JsString::from_literal(cx, text));
        for (other, expected) in [
            (string(large), Some(Equal)),
            (string("0x10"), Some(Greater)),
            (string("1e50"), None),
            (1e50.into(), Some(Less)),
            (Value::NAN, None),
            (Value::TRUE, Some(Greater)),
        ] {
            assert_eq!(value.compare(cx, other).unwrap(), expected);
            let reversed = expected.map(core::cmp::Ordering::reverse);
            assert_eq!(other.compare(cx, value).unwrap(), reversed);
            let is_equal = value.loose_equals(cx, other).unwrap();
            assert_eq!(is_equal, expected == Some(Equal));
        }
    });
}

#[test]
fn long_operations_end_on_request() {
    with_realm(|cx| {
        let (base, exponent) = (big(cx, "3"), big(cx, "600000000"));
        cx.traps().request_termination();
        assert!(JsBigInt::exponentiate(cx, &base, &exponent).is_err());
        assert!(cx.has_pending_termination_exception());
        assert!(!cx.traps().need_handling());
    });
}
