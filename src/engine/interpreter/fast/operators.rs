use bun_engine_bytecode::op;
use bun_engine_vm::{Arithmetic, ArithmeticProfile, CellType, JsCell, JsString, TypeFlags, Value};

use crate::machine::{EMPTY, Machine, UNDEFINED, boolean, branch, cell, go, handler, next, slow};

impl<W: bun_engine_bytecode::Width> Machine<W> {
    /// With what to record of them.
    #[inline(always)]
    fn doubles(&self, lhs: u64, rhs: u64) -> Option<(f64, f64, Arithmetic)> {
        let (a, seen) = if self.is_int32(lhs) {
            (f64::from(lhs as i32), Arithmetic::LHS_INT32)
        } else if self.is_number(lhs) {
            (self.unbox_double(lhs), Arithmetic::LHS_DOUBLE)
        } else {
            return None;
        };
        if self.is_int32(rhs) {
            Some((a, f64::from(rhs as i32), seen | Arithmetic::RHS_INT32))
        } else if self.is_number(rhs) {
            Some((a, self.unbox_double(rhs), seen | Arithmetic::RHS_DOUBLE))
        } else {
            None
        }
    }
}

macro_rules! arithmetic {
    ($($name:ident, $on_doubles:ident, $on_others:path, $Op:ident, |$a:ident, $b:ident| $int32:expr, $double:expr;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let (lhs, rhs) = (m.get(op.lhs), m.get(op.rhs));
            if !m.are_int32(lhs, rhs) {
                go!(m, $on_doubles::<W>; lhs, rhs, 0)
            }
            let ($a, $b) = (lhs as i32, rhs as i32);
            let Some(result) = $int32 else { slow!(m, op::$Op) };
            m.entry::<ArithmeticProfile>(op.metadata).record(Arithmetic::BOTH_INT32);
            m.set(op.dst, m.box_int32(result));
            next!(m, op)
        }
    )*}
    handler! { raw $(
        #[inline(never)]
        fn $on_doubles(m, lhs, rhs, _unused) {
            let op = <op::$Op as bun_engine_bytecode::Op>::decode::<crate::machine::Raw<W>>(m.pc);
            let Some(($a, $b, seen)) = m.doubles(lhs.assume_init(), rhs.assume_init()) else { go!(m, $on_others) };
            m.entry::<ArithmeticProfile>(op.metadata).record(seen | Arithmetic::RESULT_DOUBLE);
            m.set(op.dst, m.box_double($double));
            next!(m, op)
        }
    )*} };
}

arithmetic! {
    add, add_doubles, add_strings::<W>, Add, |a, b| a.checked_add(b), a + b;
    subtract, subtract_doubles, crate::slow::handler::<op::Subtract, W>, Subtract,
        |a, b| a.checked_sub(b), a - b;
    multiply, multiply_doubles, crate::slow::handler::<op::Multiply, W>, Multiply,
        |a, b| a.checked_mul(b).filter(|&product| product != 0 || a | b >= 0), a * b;
}

handler! {
    #[inline(never)]
    fn add_strings(m, op: op::Add) {
        let (lhs, rhs) = (m.get(op.lhs), m.get(op.rhs));
        if !m.has_type(lhs, CellType::String) || !m.has_type(rhs, CellType::String) {
            slow!(m, op::Add)
        }
        let Some(sum) = JsString::try_concat_quickly(m.vm, cell(lhs), cell(rhs)) else { slow!(m, op::Add) };
        m.entry::<ArithmeticProfile>(op.metadata).record(Arithmetic::OF_TWO_STRINGS);
        m.set(op.dst, sum.address() as u64);
        next!(m, op)
    }
}

macro_rules! bitwise {
    ($($name:ident, $Op:ident, |$a:ident, $b:ident| $result:expr;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let (lhs, rhs) = (m.get(op.lhs), m.get(op.rhs));
            if !m.are_int32(lhs, rhs) {
                slow!(m, op::$Op)
            }
            let ($a, $b) = (lhs as i32, rhs as i32);
            let Some(result) = $result else { slow!(m, op::$Op) };
            m.entry::<ArithmeticProfile>(op.metadata).record(Arithmetic::BOTH_INT32);
            m.set(op.dst, m.box_int32(result));
            next!(m, op)
        }
    )*} };
}

bitwise! {
    bit_and, BitAnd, |a, b| Some(a & b);
    bit_or, BitOr, |a, b| Some(a | b);
    bit_xor, BitXor, |a, b| Some(a ^ b);
    shift_left, ShiftLeft, |a, b| Some(a.wrapping_shl(b as u32));
    shift_right, ShiftRight, |a, b| Some(a.wrapping_shr(b as u32));
    shift_right_unsigned, ShiftRightUnsigned, |a, b| i32::try_from((a as u32).wrapping_shr(b as u32)).ok();
    remainder, Remainder, |a, b| (a >= 0 && b > 0).then(|| (a as u32 % b as u32) as i32);
}

macro_rules! steps {
    ($($name:ident, $Op:ident, $step:ident $(, $old:ident)? => $dst:ident;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let value = m.reg(op.value);
            if !m.is_int32(value) {
                slow!(m, op::$Op)
            }
            let Some(result) = (value as i32).$step(1) else { slow!(m, op::$Op) };
            m.entry::<ArithmeticProfile>(op.metadata).record(Arithmetic::LHS_INT32);
            $(m.set(op.$old, value);)?
            m.set(op.$dst, m.box_int32(result));
            next!(m, op)
        }
    )*} };
}

steps! {
    increment, Increment, checked_add => dst;
    decrement, Decrement, checked_sub => dst;
    post_increment, PostIncrement, checked_add, old => value;
    post_decrement, PostDecrement, checked_sub, old => value;
}

macro_rules! to_number {
    ($($name:ident, $Op:ident;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let value = m.get(op.value);
            if !m.is_number(value) {
                slow!(m, op::$Op)
            }
            let seen = if m.is_int32(value) {
                Arithmetic::LHS_INT32
            } else {
                Arithmetic::LHS_DOUBLE | Arithmetic::RESULT_DOUBLE
            };
            m.entry::<ArithmeticProfile>(op.metadata).record(seen);
            m.set(op.dst, value);
            next!(m, op)
        }
    )*} };
}

to_number! {
    to_number, ToNumber;
    to_numeric, ToNumeric;
}

handler! {
    fn divide(m, op: op::Divide) {
        let Some((a, b, seen)) = m.doubles(m.get(op.lhs), m.get(op.rhs)) else { slow!(m, op::Divide) };
        let (quotient, profile) = (a / b, m.entry::<ArithmeticProfile>(op.metadata));
        let integer = quotient as i32;
        if seen == Arithmetic::BOTH_INT32 && f64::from(integer).to_bits() == quotient.to_bits() {
            profile.record(seen);
            m.set(op.dst, m.box_int32(integer));
            next!(m, op)
        }
        if quotient == 0.0 {
            slow!(m, op::Divide)
        }
        profile.record(seen | Arithmetic::RESULT_DOUBLE);
        m.set(op.dst, m.box_double(quotient));
        next!(m, op)
    }

    fn shift_right_unsigned_bits(m, op: op::ShiftRightUnsignedBits) {
        let (lhs, rhs) = (m.get(op.lhs), m.get(op.rhs));
        if !m.are_int32(lhs, rhs) {
            slow!(m, op::ShiftRightUnsignedBits)
        }
        m.set(op.dst, m.box_int32((lhs as u32).wrapping_shr(rhs as u32) as i32));
        next!(m, op)
    }

    fn negate(m, op: op::Negate) {
        let (value, profile) = (m.get(op.value), m.entry::<ArithmeticProfile>(op.metadata));
        if m.is_int32(value) {
            if value & 0x7fff_ffff == 0 {
                slow!(m, op::Negate)
            }
            profile.record(Arithmetic::LHS_INT32);
            m.set(op.dst, m.box_int32(-(value as i32)));
            next!(m, op)
        }
        if !m.is_number(value) {
            slow!(m, op::Negate)
        }
        profile.record(Arithmetic::LHS_DOUBLE | Arithmetic::RESULT_DOUBLE);
        m.set(op.dst, m.box_double(-m.unbox_double(value)));
        next!(m, op)
    }

    fn bit_not(m, op: op::BitNot) {
        let value = m.get(op.value);
        if !m.is_int32(value) {
            slow!(m, op::BitNot)
        }
        m.entry::<ArithmeticProfile>(op.metadata).record(Arithmetic::LHS_INT32);
        m.set(op.dst, m.box_int32(!(value as i32)));
        next!(m, op)
    }

    fn not(m, op: op::Not) {
        let value = m.get(op.value);
        if value & !1 != boolean(false) {
            slow!(m, op::Not)
        }
        m.set(op.dst, value ^ 1);
        next!(m, op)
    }

    fn to_string(m, op: op::ToString) {
        let value = m.get(op.value);
        if !m.has_type(value, CellType::String) {
            slow!(m, op::ToString)
        }
        m.set(op.dst, value);
        next!(m, op)
    }

    fn to_primitive(m, op: op::ToPrimitive) {
        let value = m.get(op.value);
        if m.as_object(value).is_some() {
            slow!(m, op::ToPrimitive)
        }
        m.set(op.dst, value);
        next!(m, op)
    }

    fn to_property_key(m, op: op::ToPropertyKey) {
        let value = m.get(op.value);
        if !m.as_cell(value).is_some_and(|it| it.is_string() || it.is_symbol()) {
            slow!(m, op::ToPropertyKey)
        }
        m.set(op.dst, value);
        next!(m, op)
    }

    fn to_property_key_or_number(m, op: op::ToPropertyKeyOrNumber) {
        let value = m.get(op.value);
        if !m.is_number(value) && !m.as_cell(value).is_some_and(|it| it.is_string() || it.is_symbol()) {
            slow!(m, op::ToPropertyKeyOrNumber)
        }
        m.set(op.dst, value);
        next!(m, op)
    }

    fn to_object(m, op: op::ToObject) {
        let value = m.get(op.value);
        if m.as_object(value).is_none() {
            slow!(m, op::ToObject)
        }
        m.entry::<bun_engine_vm::ValueProfile>(op.metadata).record_bits(value);
        m.set(op.dst, value);
        next!(m, op)
    }
}

/// What an instruction does with the result of its test.
macro_rules! finish {
    (store, $m:ident, $op:ident, $result:expr) => {{
        $m.set($op.dst, boolean($result));
        next!($m, $op)
    }};
    (store_not, $m:ident, $op:ident, $result:expr) => {
        finish!(store, $m, $op, !$result)
    };
    (if_true, $m:ident, $op:ident, $result:expr) => {
        branch!($m, $op, $result, $op.target)
    };
    (if_false, $m:ident, $op:ident, $result:expr) => {
        branch!($m, $op, !$result, $op.target)
    };
}

macro_rules! relations {
    ($($name:ident, $Op:ident, $finish:ident, $relation:tt;)*) => { handler! {$(
        fn $name(m, op: op::$Op) {
            let (lhs, rhs) = (m.get(op.lhs), m.get(op.rhs));
            if m.are_int32(lhs, rhs) {
                finish!($finish, m, op, ((lhs as i32) $relation (rhs as i32)))
            }
            let (Some(a), Some(b)) = (m.to_double(lhs), m.to_double(rhs)) else { slow!(m, op::$Op) };
            let holds = a $relation b;
            finish!($finish, m, op, holds)
        }
    )*} };
}

relations! {
    less, Less, store, <;
    less_equal, LessEqual, store, <=;
    greater, Greater, store, >;
    greater_equal, GreaterEqual, store, >=;
    jump_if_less, JumpIfLess, if_true, <;
    jump_if_less_equal, JumpIfLessEqual, if_true, <=;
    jump_if_greater, JumpIfGreater, if_true, >;
    jump_if_greater_equal, JumpIfGreaterEqual, if_true, >=;
    jump_if_not_less, JumpIfNotLess, if_false, <;
    jump_if_not_less_equal, JumpIfNotLessEqual, if_false, <=;
    jump_if_not_greater, JumpIfNotGreater, if_false, >;
    jump_if_not_greater_equal, JumpIfNotGreaterEqual, if_false, >=;
    equal, Equal, store, ==;
    not_equal, NotEqual, store_not, ==;
    jump_if_equal, JumpIfEqual, if_true, ==;
    jump_if_not_equal, JumpIfNotEqual, if_false, ==;
}

impl<W: bun_engine_bytecode::Width> Machine<W> {
    #[inline(always)]
    unsafe fn try_strict_equal(&self, lhs: u64, rhs: u64) -> Option<bool> {
        if self.is_cell(lhs | rhs) {
            if lhs == rhs {
                return Some(true);
            }
            // SAFETY: both are cells.
            let (a, b) = unsafe { (cell::<JsCell>(lhs), cell::<JsCell>(rhs)) };
            if a.cell_type() > CellType::BigInt || a.cell_type() != b.cell_type() {
                return Some(false);
            }
            if !a.is_string() {
                return None;
            }
            // SAFETY: both are strings.
            return unsafe { cell::<JsString>(lhs).equals_if_atoms(&cell::<JsString>(rhs)) };
        }
        if self.are_int32(lhs, rhs) || !self.is_number(lhs) || !self.is_number(rhs) {
            return Some(lhs == rhs);
        }
        Some(self.to_double(lhs) == self.to_double(rhs))
    }

    #[inline(always)]
    unsafe fn try_to_boolean(&self, value: u64) -> Option<bool> {
        if value & !1 == boolean(false) {
            return Some(value & 1 != 0);
        }
        if self.is_int32(value) {
            return Some(value as i32 != 0);
        }
        if !self.is_cell(value) {
            return (!self.is_number(value)).then_some(false);
        }
        // SAFETY: a cell.
        let cell = unsafe { cell::<JsCell>(value) };
        (cell.is_object() && !masquerades(&cell)).then_some(true)
    }

    #[inline(always)]
    unsafe fn unless_masquerading(&self, value: u64, result: bool) -> Option<bool> {
        // SAFETY: not empty.
        match unsafe { self.as_cell(value) } {
            Some(cell) => (!masquerades(&cell)).then_some(false),
            None => Some(result),
        }
    }

    #[inline(always)]
    unsafe fn try_is_function(&self, value: u64) -> Option<bool> {
        // SAFETY: not empty.
        let Some(cell) = (unsafe { self.as_cell(value) }) else {
            return Some(false);
        };
        if cell.cell_type() == CellType::Function {
            return Some(true);
        }
        (!cell.inline_flags().contains(TypeFlags::OVERRIDES_CALL_DATA)).then_some(false)
    }

    #[inline(always)]
    unsafe fn try_typeof_is_object(&self, value: u64) -> Option<bool> {
        // SAFETY: not empty.
        let Some(cell) = (unsafe { self.as_cell(value) }) else {
            return Some(value == Value::NULL.to_bits());
        };
        let special = TypeFlags::OVERRIDES_CALL_DATA | TypeFlags::MASQUERADES_AS_UNDEFINED;
        (!cell.inline_flags().intersects(special)).then(|| cell.is_object())
    }
}

#[inline(always)]
fn masquerades(cell: &JsCell) -> bool {
    cell.inline_flags()
        .contains(TypeFlags::MASQUERADES_AS_UNDEFINED)
}

#[inline(always)]
fn is_nullish(value: u64) -> bool {
    value & !Value::UNDEFINED_TAG == Value::NULL.to_bits()
}

macro_rules! binary_tests {
    ($($name:ident, $Op:ident, $finish:ident, |$m:ident, $a:ident, $b:ident| $test:expr;)*) => { handler! {$(
        fn $name($m, op: op::$Op) {
            let ($a, $b) = ($m.get(op.lhs), $m.get(op.rhs));
            let Some(result) = $test else { slow!($m, op::$Op) };
            finish!($finish, $m, op, result)
        }
    )*} };
}

binary_tests! {
    strict_equal, StrictEqual, store, |m, a, b| m.try_strict_equal(a, b);
    strict_not_equal, StrictNotEqual, store_not, |m, a, b| m.try_strict_equal(a, b);
    jump_if_strict_equal, JumpIfStrictEqual, if_true, |m, a, b| m.try_strict_equal(a, b);
    jump_if_strict_not_equal, JumpIfStrictNotEqual, if_false, |m, a, b| m.try_strict_equal(a, b);
    identical, Identical, store, |m, a, b| Some(a == b);
    not_identical, NotIdentical, store_not, |m, a, b| Some(a == b);
    jump_if_identical, JumpIfIdentical, if_true, |m, a, b| Some(a == b);
    jump_if_not_identical, JumpIfNotIdentical, if_false, |m, a, b| Some(a == b);
    below, Below, store, |m, a, b| Some((a as u32) < b as u32);
    below_equal, BelowEqual, store, |m, a, b| Some(a as u32 <= b as u32);
    jump_if_below, JumpIfBelow, if_true, |m, a, b| Some((a as u32) < b as u32);
    jump_if_below_equal, JumpIfBelowEqual, if_true, |m, a, b| Some(a as u32 <= b as u32);
}

macro_rules! unary_tests {
    ($($($name:ident, $Op:ident, $finish:ident,)+ |$m:ident, $op:ident, $value:ident| $test:expr;)*) => {$(
        unary_tests!(@each [$($name $Op $finish)+] $m $op $value $test);
    )*};
    (@each [$($name:ident $Op:ident $finish:ident)+] $m:ident $op:ident $value:ident $test:expr) => { handler! {$(
        fn $name($m, $op: op::$Op) {
            let $value = $m.get($op.value);
            let Some(result) = $test else { slow!($m, op::$Op) };
            finish!($finish, $m, $op, result)
        }
    )+} };
}

unary_tests! {
    jump_if_true, JumpIfTrue, if_true,
    jump_if_false, JumpIfFalse, if_false,
        |m, op, value| m.try_to_boolean(value);
    equal_null, EqualNull, store,
    not_equal_null, NotEqualNull, store_not,
    jump_if_equal_null, JumpIfEqualNull, if_true,
    jump_if_not_equal_null, JumpIfNotEqualNull, if_false,
        |m, op, value| m.unless_masquerading(value, is_nullish(value));
    typeof_is_undefined, TypeofIsUndefined, store,
    jump_if_typeof_undefined, JumpIfTypeofUndefined, if_true,
    jump_if_typeof_not_undefined, JumpIfTypeofNotUndefined, if_false,
        |m, op, value| m.unless_masquerading(value, value == UNDEFINED);
    is_nullish_value, IsNullish, store,
    jump_if_nullish, JumpIfNullish, if_true,
    jump_if_not_nullish, JumpIfNotNullish, if_false,
        |m, op, value| Some(is_nullish(value));
    is_boolean, IsBoolean, store,
        |m, op, value| Some(value & !1 == boolean(false));
    is_number, IsNumber, store,
    jump_if_number, JumpIfNumber, if_true,
    jump_if_not_number, JumpIfNotNumber, if_false,
        |m, op, value| Some(m.is_number(value));
    is_object, IsObject, store,
    jump_if_object, JumpIfObject, if_true,
    jump_if_not_object, JumpIfNotObject, if_false,
        |m, op, value| Some(value != EMPTY && m.as_object(value).is_some());
    is_cell_of_type, IsCellOfType, store,
    jump_if_cell_of_type, JumpIfCellOfType, if_true,
    jump_if_not_cell_of_type, JumpIfNotCellOfType, if_false,
        |m, op, value| Some(value != EMPTY && m.has_type(value, CellType(op.cell_type.0)));
    is_callable, IsCallable, store,
    typeof_is_function, TypeofIsFunction, store,
    jump_if_typeof_function, JumpIfTypeofFunction, if_true,
    jump_if_typeof_not_function, JumpIfTypeofNotFunction, if_false,
        |m, op, value| m.try_is_function(value);
    typeof_is_object, TypeofIsObject, store,
    jump_if_typeof_object, JumpIfTypeofObject, if_true,
    jump_if_typeof_not_object, JumpIfTypeofNotObject, if_false,
        |m, op, value| m.try_typeof_is_object(value);
}
