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
        calls(builtin, true).iter().map(|call| call.parameters[0].objects).collect()
    };
    assert_eq!(demands(BuiltinId::Set), [ObjectDemand::None, ObjectDemand::ArrayLiteral]);
    assert_eq!(demands(BuiltinId::Map), [ObjectDemand::None, ObjectDemand::ArrayLiteralOfLiterals]);
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
    assert!(form.primitives.contains(OperandKinds::NOT_PASSED | OperandKinds::UNDEFINED));
    assert!(!form.primitives.contains(OperandKinds::STRING));
}

#[test]
fn receivers_are_never_nullish() {
    for builtin in BuiltinId::ALL {
        for call in calls(builtin, false) {
            let Some(receiver) = call.receiver else { continue };
            let nullish = OperandKinds::UNDEFINED | OperandKinds::NULL | OperandKinds::NOT_PASSED;
            assert!(!receiver.primitives.intersects(nullish), "{builtin:?}");
        }
    }
}

use OperandShape::{ArrayLiteral, Null, Number, Object, ObjectLiteral, Undefined};

const ARRAY_OF_NUMBERS: OperandShape = ArrayLiteral { holds_only_literals: false };
const ARRAY_OF_PAIRS: OperandShape = ArrayLiteral { holds_only_literals: true };

fn is_removable(builtin: BuiltinId, arguments: &[OperandShape]) -> bool {
    is_removable_call(builtin, false, None, arguments)
}

fn is_removable_construction(builtin: BuiltinId, arguments: &[OperandShape]) -> bool {
    is_removable_call(builtin, true, None, arguments)
}

#[test]
fn an_operand_that_is_missing_counts_as_one_that_is_refused() {
    assert!(is_removable(BuiltinId::ObjectKeys, &[ObjectLiteral]));
    assert!(is_removable(BuiltinId::ObjectKeys, &[ARRAY_OF_NUMBERS]));
    assert!(is_removable(BuiltinId::ObjectKeys, &[OperandShape::String]));
    assert!(!is_removable(BuiltinId::ObjectKeys, &[]));
    assert!(!is_removable(BuiltinId::ObjectKeys, &[Undefined]));
    assert!(!is_removable(BuiltinId::ObjectKeys, &[Null]));
    assert!(!is_removable(BuiltinId::ObjectKeys, &[Object]));
}

#[test]
fn a_length_has_to_be_a_constant_in_the_range() {
    let length = |number| is_removable_construction(BuiltinId::Uint8Array, &[Number(number)]);
    assert!(length(Some(0.0)));
    assert!(length(Some(8.0)));
    assert!(!length(Some(-1.0)));
    assert!(!length(Some(1.5)));
    assert!(!length(Some(f64::NAN)));
    assert!(!length(Some(f64::INFINITY)));
    assert!(!length(Some((1u64 << 40) as f64)));
    assert!(!length(None));
    assert!(is_removable_construction(BuiltinId::Uint8Array, &[]));
    assert!(!is_removable_construction(BuiltinId::Array, &[Number(Some(-1.0))]));
    assert!(is_removable_construction(BuiltinId::Array, &[Number(Some(3.0))]));
    assert!(is_removable_construction(BuiltinId::Array, &[OperandShape::String, Object]));
}

#[test]
fn what_a_collection_is_made_of_is_written_out() {
    assert!(is_removable_construction(BuiltinId::Map, &[]));
    assert!(is_removable_construction(BuiltinId::Map, &[Null]));
    assert!(is_removable_construction(BuiltinId::Map, &[ARRAY_OF_PAIRS]));
    assert!(!is_removable_construction(BuiltinId::Map, &[ARRAY_OF_NUMBERS]));
    assert!(!is_removable_construction(BuiltinId::Map, &[Object]));
    assert!(!is_removable_construction(BuiltinId::Map, &[OperandShape::String]));
    assert!(is_removable_construction(BuiltinId::Set, &[ARRAY_OF_NUMBERS]));
    assert!(!is_removable_construction(BuiltinId::Set, &[ObjectLiteral]));
    assert!(!is_removable(BuiltinId::Map, &[]));
}

#[test]
fn a_method_needs_a_receiver_that_is_known() {
    let slice = |receiver| {
        is_removable_call(BuiltinId::StringPrototypeSlice, false, receiver, &[Number(None)])
    };
    assert!(slice(Some(OperandShape::String)));
    assert!(!slice(None));
    assert!(!slice(Some(Undefined)));
    assert!(!slice(Some(Object)));
}

#[test]
fn more_arguments_than_parameters_are_not_covered() {
    assert!(!is_removable(BuiltinId::ObjectKeys, &[ObjectLiteral, Undefined]));
    assert!(is_removable(BuiltinId::MathMax, &[]));
    assert!(is_removable(BuiltinId::MathMax, &[Number(None), Number(None), Number(None)]));
    assert!(!is_removable(BuiltinId::MathMax, &[Number(None), Object]));
    assert!(!is_removable(BuiltinId::MathMax, &[Number(None), OperandShape::Symbol]));
}
