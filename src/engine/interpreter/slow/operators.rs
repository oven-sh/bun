use core::cmp::Ordering::{Equal, Greater, Less};

use bun_engine_vm::arithmetic;
use bun_engine_vm::{ArithmeticProfile, CellType, Cx, JsString, PreferredType, ShapeFlags, Value};

use super::{Next, execute};

macro_rules! profiled_binary {
    ($($Op:ident $function:ident,)*) => { execute! {$(
        $Op(op, cx, f) {
            let (lhs, rhs) = (f.get(op.lhs), f.get(op.rhs));
            let result = arithmetic::$function(cx, lhs, rhs)?;
            f.entry::<ArithmeticProfile>(op.metadata).record_binary(lhs, rhs, result);
            f.set(op.dst, result);
        }
    )*} };
}

profiled_binary! {
    Add add,
    Subtract subtract,
    Multiply multiply,
    Divide divide,
    Remainder remainder,
    Exponentiate exponentiate,
    BitAnd bit_and,
    BitOr bit_or,
    BitXor bit_xor,
    ShiftLeft shift_left,
    ShiftRight shift_right,
}

fn to_numeric(cx: &mut Cx, value: Value) -> bun_engine_vm::JsResult<Value> {
    if value.is_number() {
        return Ok(value);
    }
    value.to_numeric(cx).map(Into::into)
}

execute! {
    ShiftRightUnsigned(op, cx, f) {
        let (lhs, rhs) = (f.get(op.lhs), f.get(op.rhs));
        let result = arithmetic::shift_right_unsigned(cx, lhs, rhs)?.into();
        f.entry::<ArithmeticProfile>(op.metadata).record_binary(lhs, rhs, result);
        f.set(op.dst, result);
    }
    ShiftRightUnsignedBits(op, cx, f) {
        f.set(op.dst, arithmetic::shift_right_unsigned(cx, f.get(op.lhs), f.get(op.rhs))? as i32);
    }
    Negate(op, cx, f) {
        let value = f.get(op.value);
        let result = arithmetic::negate(cx, value)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    BitNot(op, cx, f) {
        let value = f.get(op.value);
        let result = arithmetic::bit_not(cx, value)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    Increment(op, cx, f) {
        let value = f.reg(op.value);
        let result = arithmetic::increment(cx, value)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    Decrement(op, cx, f) {
        let value = f.reg(op.value);
        let result = arithmetic::decrement(cx, value)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    PostIncrement(op, cx, f) {
        let value = f.reg(op.value);
        let old = to_numeric(cx, value)?;
        let result = arithmetic::increment(cx, old)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.old, old);
        f.set(op.value, result);
    }
    PostDecrement(op, cx, f) {
        let value = f.reg(op.value);
        let old = to_numeric(cx, value)?;
        let result = arithmetic::decrement(cx, old)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.old, old);
        f.set(op.value, result);
    }
    ToNumber(op, cx, f) {
        let value = f.get(op.value);
        let result = if value.is_number() { value } else { value.to_number(cx)?.into() };
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    ToNumeric(op, cx, f) {
        let value = f.get(op.value);
        let result = to_numeric(cx, value)?;
        f.entry::<ArithmeticProfile>(op.metadata).record_unary(value, result);
        f.set(op.dst, result);
    }
    Not(op, cx, f) {
        f.set(op.dst, !f.get(op.value).to_boolean(cx));
    }
    Typeof(op, cx, f) {
        f.set(op.dst, f.get(op.value).type_of(cx));
    }
    Concatenate(op, cx, f) {
        let operands = (0..op.count).map(|index| f.reg(op.first.nth(index)));
        f.set(op.dst, JsString::concat_primitives(cx, operands)?);
    }
    ToString(op, cx, f) {
        f.set(op.dst, f.get(op.value).to_string(cx)?);
    }
    ToPrimitive(op, cx, f) {
        f.set(op.dst, f.get(op.value).to_primitive(cx, PreferredType::None)?);
    }
    ToPropertyKey(op, cx, f) {
        f.set(op.dst, f.get(op.value).to_property_key_value(cx)?);
    }
    ToPropertyKeyOrNumber(op, cx, f) {
        let value = f.get(op.value);
        f.set(op.dst, if value.is_number() { value } else { value.to_property_key_value(cx)? });
    }
    ToObject(op, cx, f) {
        f.set_profiled(op.dst, op.metadata, f.get(op.value).to_object_or_throw(cx, f.name(op.message))?);
    }
    HasShapeWithFlags(op, cx, f) {
        let shape = f.get(op.object).as_cell().expect("an object").shape();
        f.set(op.dst, shape.has(ShapeFlags::from_bits_retain(op.flags)));
    }
    IsCellOfType(op, cx, f) {
        f.set(op.dst, has_type(f.get_or_empty(op.value), op.cell_type));
    }
    JumpIfCellOfType(op, cx, f) {
        Next::jump_if(has_type(f.get_or_empty(op.value), op.cell_type))
    }
    JumpIfNotCellOfType(op, cx, f) {
        Next::jump_if(!has_type(f.get_or_empty(op.value), op.cell_type))
    }
    Identical(op, cx, f) {
        f.set(op.dst, f.get_or_empty(op.lhs) == f.get_or_empty(op.rhs));
    }
    NotIdentical(op, cx, f) {
        f.set(op.dst, f.get_or_empty(op.lhs) != f.get_or_empty(op.rhs));
    }
    JumpIfIdentical(op, cx, f) {
        Next::jump_if(f.get_or_empty(op.lhs) == f.get_or_empty(op.rhs))
    }
    JumpIfNotIdentical(op, cx, f) {
        Next::jump_if(f.get_or_empty(op.lhs) != f.get_or_empty(op.rhs))
    }
}

fn has_type(value: Option<Value>, cell_type: bun_engine_bytecode::CellType) -> bool {
    let cell = value.and_then(Value::as_cell);
    cell.is_some_and(|cell| cell.cell_type() == CellType(cell_type.0))
}

/// The instruction that stores the result, and those that jump if it is true and if it is false.
macro_rules! binary_tests {
    ($($($Store:ident)?, $($StoreNot:ident)?, $($IfTrue:ident)?, $($IfFalse:ident)?, $test:expr;)*) => {$(
        $(execute! { $Store(op, cx, f) { f.set(op.dst, $test(cx, f.get(op.lhs), f.get(op.rhs))?); } })?
        $(execute! { $StoreNot(op, cx, f) { f.set(op.dst, !$test(cx, f.get(op.lhs), f.get(op.rhs))?); } })?
        $(execute! { $IfTrue(op, cx, f) { Next::jump_if($test(cx, f.get(op.lhs), f.get(op.rhs))?) } })?
        $(execute! { $IfFalse(op, cx, f) { Next::jump_if(!$test(cx, f.get(op.lhs), f.get(op.rhs))?) } })?
    )*};
}

type Test = bun_engine_vm::JsResult<bool>;

fn equal(cx: &mut Cx, a: Value, b: Value) -> Test {
    a.loose_equals(cx, b)
}

fn strict_equal(cx: &mut Cx, a: Value, b: Value) -> Test {
    a.strict_equals(cx, b)
}

fn less(cx: &mut Cx, a: Value, b: Value) -> Test {
    Ok(a.compare(cx, b)? == Some(Less))
}

fn less_equal(cx: &mut Cx, a: Value, b: Value) -> Test {
    Ok(matches!(a.compare(cx, b)?, Some(Less | Equal)))
}

fn greater(cx: &mut Cx, a: Value, b: Value) -> Test {
    Ok(a.compare(cx, b)? == Some(Greater))
}

fn greater_equal(cx: &mut Cx, a: Value, b: Value) -> Test {
    Ok(matches!(a.compare(cx, b)?, Some(Greater | Equal)))
}

fn below(_: &mut Cx, a: Value, b: Value) -> Test {
    Ok((a.to_bits() as u32) < b.to_bits() as u32)
}

fn below_equal(_: &mut Cx, a: Value, b: Value) -> Test {
    Ok(a.to_bits() as u32 <= b.to_bits() as u32)
}

binary_tests! {
    Equal, NotEqual, JumpIfEqual, JumpIfNotEqual, equal;
    StrictEqual, StrictNotEqual, JumpIfStrictEqual, JumpIfStrictNotEqual, strict_equal;
    Less, , JumpIfLess, JumpIfNotLess, less;
    LessEqual, , JumpIfLessEqual, JumpIfNotLessEqual, less_equal;
    Greater, , JumpIfGreater, JumpIfNotGreater, greater;
    GreaterEqual, , JumpIfGreaterEqual, JumpIfNotGreaterEqual, greater_equal;
    Below, , JumpIfBelow, , below;
    BelowEqual, , JumpIfBelowEqual, , below_equal;
}

macro_rules! unary_tests {
    ($($($Store:ident)?, $($StoreNot:ident)?, $($IfTrue:ident)?, $($IfFalse:ident)?, $test:expr;)*) => {$(
        $(execute! { $Store(op, cx, f) { f.set(op.dst, f.get_or_empty(op.value).is_some_and(|it| $test(it, cx))); } })?
        $(execute! { $StoreNot(op, cx, f) { f.set(op.dst, !f.get_or_empty(op.value).is_some_and(|it| $test(it, cx))); } })?
        $(execute! { $IfTrue(op, cx, f) { Next::jump_if(f.get_or_empty(op.value).is_some_and(|it| $test(it, cx))) } })?
        $(execute! { $IfFalse(op, cx, f) { Next::jump_if(!f.get_or_empty(op.value).is_some_and(|it| $test(it, cx))) } })?
    )*};
}

fn masquerades(value: Value, cx: &Cx) -> bool {
    value
        .as_cell()
        .is_some_and(|cell| cell.masquerades_as_undefined(cx))
}

fn typeof_is_object(value: Value, cx: &Cx) -> bool {
    value.is_null() || (value.is_object() && !masquerades(value, cx) && !value.is_callable())
}

unary_tests! {
    , , JumpIfTrue, JumpIfFalse, Value::to_boolean;
    EqualNull, NotEqualNull, JumpIfEqualNull, JumpIfNotEqualNull,
        |it: Value, cx| it.is_undefined_or_null() || masquerades(it, cx);
    IsNullish, , JumpIfNullish, JumpIfNotNullish, |it: Value, _| it.is_undefined_or_null();
    IsBoolean, , , , |it: Value, _| it.is_boolean();
    IsNumber, , JumpIfNumber, JumpIfNotNumber, |it: Value, _| it.is_number();
    IsObject, , JumpIfObject, JumpIfNotObject, |it: Value, _| it.is_object();
    IsCallable, , , , |it: Value, _| it.is_callable();
    IsConstructor, , , , |it: Value, _| it.is_constructor();
    TypeofIsUndefined, , JumpIfTypeofUndefined, JumpIfTypeofNotUndefined,
        |it: Value, cx| it.is_undefined() || masquerades(it, cx);
    TypeofIsObject, , JumpIfTypeofObject, JumpIfTypeofNotObject, typeof_is_object;
    TypeofIsFunction, , JumpIfTypeofFunction, JumpIfTypeofNotFunction,
        |it: Value, cx| it.is_callable() && !masquerades(it, cx);
}
