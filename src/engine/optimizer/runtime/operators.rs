//! The operators of the language, for the operands that optimized code does not deal with itself.

use core::cmp::Ordering;

use bun_engine_macros::native_abi;
use bun_engine_text::PropertyName;
use bun_engine_vm::{
    Cx, Gc, JsBigInt, JsObject, JsResult, JsString, PreferredType, Value, arithmetic,
};

use super::operations::{Address, Answer, Operation, Returned, leaves, operations};
use crate::graph::{Conversion, Operator, Relation};

/// What `EXISTING_ATOM` gives if there is none.
pub(crate) const NO_ATOM: usize = 1;

operations! {
    CONCATENATE: fn concatenate(cx: &Cx, a: Gc<JsString>, b: Gc<JsString>) -> JsResult<Gc<JsString>> {
        JsString::concat(cx, a, b)
    }
    CONCATENATE_THREE: fn concatenate_three(
        cx: &Cx, a: Gc<JsString>, b: Gc<JsString>, c: Gc<JsString>
    ) -> JsResult<Gc<JsString>> {
        JsString::concat3(cx, a, b, c)
    }
    STRING_EQUAL: fn string_equal(cx: &Cx, a: Gc<JsString>, b: Gc<JsString>) -> Answer {
        a.equals(cx, &b).into()
    }
    STRING_ORDER: fn string_order(cx: &Cx, a: Gc<JsString>, b: Gc<JsString>) -> Answer {
        a.compare(cx, &b).map(|order| (order as i8 + 1) as u16).into()
    }
    FIRST_UNIT: fn first_unit(cx: &Cx, string: Gc<JsString>) -> Answer {
        string.unit_at(cx, 0).into()
    }
    EXISTING_ATOM: fn existing_atom(cx: &Cx, string: Gc<JsString>) -> JsResult<core::num::NonZeroUsize> {
        let key = string.to_existing_property_key(cx)?;
        let address = key.map_or(NO_ATOM, |key| key.name().address());
        Ok(address.try_into().expect("an address"))
    }
    LOOSE_EQUAL: fn loose_equal(cx: &mut Cx, a: Value, b: Value) -> Answer {
        a.loose_equals(cx, b).into()
    }
    STRICT_EQUAL: fn strict_equal(cx: &Cx, a: Value, b: Value) -> Answer {
        a.strict_equals(cx, b).into()
    }
    COMPARE: fn compare(cx: &mut Cx, a: Value, b: Value, relation: u32) -> Answer {
        let holds = |order: Ordering| match Relation::from_data(relation) {
            Relation::Less => order.is_lt(),
            Relation::LessEqual => order.is_le(),
            Relation::Greater => order.is_gt(),
            Relation::GreaterEqual => order.is_ge(),
        };
        a.compare(cx, b).map(|order| order.is_some_and(holds)).into()
    }
    INT32_TO_STRING: fn int32_to_string(cx: &Cx, number: i32) -> Gc<JsString> {
        JsString::from_int32(cx, number)
    }
    DOUBLE_TO_STRING: fn double_to_string(cx: &Cx, number: f64) -> Gc<JsString> {
        JsString::from_number(cx, number)
    }
    PRIMITIVE_TO_STRING: fn primitive_to_string(cx: &Cx, value: Value) -> JsResult<Gc<JsString>> {
        value.primitive_to_string(cx)
    }
    TO_STRING: fn to_string(cx: &mut Cx, value: Value) -> JsResult<Gc<JsString>> {
        value.to_string(cx)
    }
    TO_PRIMITIVE: fn to_primitive(cx: &mut Cx, value: Value) -> JsResult<Value> {
        value.to_primitive(cx, PreferredType::None)
    }
    TO_PROPERTY_KEY: fn to_property_key(cx: &mut Cx, value: Value) -> JsResult<Value> {
        value.to_property_key_value(cx)
    }
    TO_OBJECT: fn to_object(cx: &Cx, value: Value, message: PropertyName<'_>) -> JsResult<Gc<JsObject>> {
        value.to_object_or_throw(cx, message)
    }
    TO_THIS: fn to_this(cx: &Cx, value: Value) -> Gc<JsObject> {
        value.to_sloppy_this(cx)
    }
    SHIFT_RIGHT_UNSIGNED: fn shift_right_unsigned(cx: &mut Cx, a: Value, b: Value) -> JsResult<Value> {
        arithmetic::shift_right_unsigned(cx, a, b).map(Value::from)
    }
    SHIFT_RIGHT_UNSIGNED_BITS: fn shift_right_unsigned_bits(cx: &mut Cx, a: Value, b: Value) -> JsResult<Value> {
        arithmetic::shift_right_unsigned(cx, a, b).map(|bits| Value::int32(bits as i32))
    }
    TO_NUMBER: fn to_number(cx: &mut Cx, value: Value) -> JsResult<Value> {
        value.to_number(cx).map(Value::from)
    }
    TO_NUMERIC: fn to_numeric(cx: &mut Cx, value: Value) -> JsResult<Value> {
        value.to_numeric(cx).map(Value::from)
    }
}

leaves! {
    IS_CALLABLE: fn is_callable(value: Value) -> u32 {
        value.is_callable().into()
    }
    IS_CONSTRUCTOR: fn is_constructor(value: Value) -> u32 {
        value.is_constructor().into()
    }
    TYPE_OF: fn type_of(cx: &Cx, value: Value) -> Gc<JsString> {
        value.type_of(cx)
    }
    BIGINT_ORDER: fn bigint_order(a: Gc<JsBigInt>, b: Gc<JsBigInt>) -> i32 {
        a.value().cmp(&b.value()) as i32
    }
}

pub(crate) fn conversion(which: Conversion) -> Operation {
    match which {
        Conversion::ToString => TO_STRING,
        Conversion::ToPrimitive => TO_PRIMITIVE,
        Conversion::ToPropertyKey | Conversion::ToPropertyKeyOrNumber => TO_PROPERTY_KEY,
    }
}

macro_rules! operators {
    ($($operator:ident $on_anything:ident $on_bigints:ident($($operand:ident),*);)*) => {
        mod anything {
            use super::*;
            $(#[native_abi]
            pub(super) fn $on_anything(cx: &mut Cx, $($operand: Value),*) -> JsResult<Value> {
                arithmetic::$on_anything(cx, $($operand),*)
            })*
        }

        mod bigints {
            use super::*;
            $(#[native_abi]
            pub(super) fn $on_bigints(cx: &Cx, $($operand: &JsBigInt),*) -> JsResult<Gc<JsBigInt>> {
                JsBigInt::$on_bigints(cx, $($operand),*)
            })*
        }

        pub(crate) fn on_anything(operator: Operator) -> Operation {
            let address = match operator {
                $(Operator::$operator => Address(anything::$on_anything as *const ()),)*
                Operator::ShiftRightUnsigned => return SHIFT_RIGHT_UNSIGNED,
                Operator::ShiftRightUnsignedBits => return SHIFT_RIGHT_UNSIGNED_BITS,
                Operator::ToNumber => return TO_NUMBER,
                Operator::ToNumeric => return TO_NUMERIC,
            };
            Operation { address, ..TO_NUMERIC }
        }

        pub(crate) fn on_bigints(operator: Operator) -> Operation {
            let address = match operator {
                $(Operator::$operator => Address(bigints::$on_bigints as *const ()),)*
                _ => unreachable!("makes no BigInt"),
            };
            Operation { address, ..TO_NUMERIC }
        }
    };
}

operators! {
    Add add add(a, b);
    Subtract subtract subtract(a, b);
    Multiply multiply multiply(a, b);
    Divide divide divide(a, b);
    Remainder remainder remainder(a, b);
    Exponentiate exponentiate exponentiate(a, b);
    BitAnd bit_and bitwise_and(a, b);
    BitOr bit_or bitwise_or(a, b);
    BitXor bit_xor bitwise_xor(a, b);
    ShiftLeft shift_left left_shift(a, b);
    ShiftRight shift_right signed_right_shift(a, b);
    Negate negate unary_minus(a);
    BitNot bit_not bitwise_not(a);
    Increment increment increment(a);
    Decrement decrement decrement(a);
}
