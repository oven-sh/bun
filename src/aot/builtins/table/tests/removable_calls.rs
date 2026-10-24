use super::super::*;

fn calls(builtin: BuiltinId, is_construction: bool) -> Vec<&'static RemovableCall> {
    removable_calls(builtin, is_construction).collect()
}

#[test]
fn key_lists_take_literals_and_no_nullish_value() {
    let [keys] = calls(BuiltinId::ObjectKeys, false)[..] else {
        panic!("Object.keys has one overload");
    };
    let [object] = keys.parameters else {
        panic!("Object.keys takes one operand");
    };
    assert_eq!(object.objects, ObjectDemand::Literal);
    assert!(object.primitives.contains(OperandKinds::STRING));
    let refused = OperandKinds::UNDEFINED | OperandKinds::NULL | OperandKinds::NOT_PASSED;
    assert!(!object.primitives.intersects(refused));
}

#[test]
fn lengths_are_whole_numbers_in_a_range() {
    let lengths: Vec<_> = calls(BuiltinId::Uint8Array, true)
        .into_iter()
        .filter(|call| call.parameters[0].primitives.contains(OperandKinds::NUMBER))
        .collect();
    let [with_length] = lengths[..] else {
        panic!("one overload of Uint8Array takes a number");
    };
    assert_eq!(with_length.parameters[0].integers, Some((0, 1 << 29)));
    assert_eq!(with_length.parameters[0].objects, ObjectDemand::None);
}

#[test]
fn a_number_alone_is_the_length_of_a_new_array() {
    for call in calls(BuiltinId::Array, true) {
        let first = call.parameters[0];
        let takes_number = first.primitives.contains(OperandKinds::NUMBER);
        assert_eq!(takes_number, first.integers == Some((0, u32::MAX as i64)));
        assert_eq!(takes_number, !call.has_rest);
    }
}

#[test]
fn collections_take_array_literals() {
    let demands = |builtin| -> Vec<ObjectDemand> {
        calls(builtin, true)
            .iter()
            .map(|call| call.parameters[0].objects)
            .collect()
    };
    assert_eq!(
        demands(BuiltinId::Set),
        [ObjectDemand::None, ObjectDemand::ArrayLiteral]
    );
    assert_eq!(
        demands(BuiltinId::Map),
        [ObjectDemand::None, ObjectDemand::ArrayLiteralOfLiterals]
    );
    assert_eq!(demands(BuiltinId::WeakMap), [ObjectDemand::None]);
}

#[test]
fn entries_with_an_error_of_their_own_or_a_trace_are_not_listed() {
    for builtin in [
        BuiltinId::JSONParse,
        BuiltinId::StringPrototypeRepeat,
        BuiltinId::ObjectDefineProperty,
        BuiltinId::ArrayPrototypePush,
        BuiltinId::ArrayPrototypeMap,
        BuiltinId::ConsoleLog,
        BuiltinId::MathRandom,
    ] {
        assert!(calls(builtin, false).is_empty(), "{builtin:?}");
    }
    assert!(calls(BuiltinId::Map, false).is_empty());
    assert!(calls(BuiltinId::AggregateError, true).is_empty());
}

#[test]
fn one_of_a_few_texts_is_not_compared() {
    let [normalize] = calls(BuiltinId::StringPrototypeNormalize, false)[..] else {
        panic!("one overload of normalize refuses nothing");
    };
    let [form] = normalize.parameters else {
        panic!("normalize takes one operand");
    };
    assert!(
        form.primitives
            .contains(OperandKinds::NOT_PASSED | OperandKinds::UNDEFINED)
    );
    assert!(!form.primitives.contains(OperandKinds::STRING));
}

#[test]
fn receivers_are_never_nullish() {
    for builtin in BuiltinId::ALL {
        for call in calls(builtin, false) {
            let Some(receiver) = call.receiver else {
                continue;
            };
            let nullish = OperandKinds::UNDEFINED | OperandKinds::NULL | OperandKinds::NOT_PASSED;
            assert!(!receiver.primitives.intersects(nullish), "{builtin:?}");
        }
    }
}
