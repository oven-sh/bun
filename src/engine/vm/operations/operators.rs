//! The operators for generated code, which has the operands in registers. It has made its frame and call site known.

use core::cmp::Ordering;

use bun_engine_macros::native_abi;
use bun_engine_text::Text;

use crate::{
    Arithmetic, ArithmeticProfile, Cx, Gc, JsBigInt, JsCell, JsResult, JsString, Value, arithmetic,
};

macro_rules! profiled {
    ($($visibility:vis $name:ident $function:ident,)*) => {$(
        #[native_abi]
        #[inline(never)]
        $visibility fn $name(
            cx: &mut Cx,
            lhs: Value,
            rhs: Value,
            profile: &ArithmeticProfile,
        ) -> JsResult<Value> {
            let result = arithmetic::$function(cx, lhs, rhs)?;
            profile.record_binary(lhs, rhs, result);
            Ok(result)
        }
    )*};
}

profiled! {
    add_any add,
    pub subtract subtract,
    pub multiply multiply,
    pub divide divide,
    pub remainder remainder,
    pub exponentiate exponentiate,
    pub bit_and bit_and,
    pub bit_or bit_or,
    pub bit_xor bit_xor,
    pub shift_left shift_left,
    pub shift_right shift_right,
}

#[native_abi]
pub fn add(cx: &mut Cx, lhs: Value, rhs: Value, profile: &ArithmeticProfile) -> JsResult<Value> {
    if let (Some(a), Some(b)) = (lhs.as_string(), rhs.as_string())
        && let Some(sum) = JsString::try_concat_quickly(cx, a, b)
    {
        profile.record(Arithmetic::OF_TWO_STRINGS);
        return Ok(sum.into());
    }
    add_any(cx, lhs, rhs, profile)
}

/// # Safety
/// There are `count` primitives, from `first` down.
#[native_abi]
pub unsafe fn concatenate(cx: &mut Cx, first: *const Value, count: usize) -> JsResult<Value> {
    // SAFETY: the caller's.
    let operands = (0..count).map(|index| unsafe { first.sub(index).read() });
    JsString::concat_primitives(cx, operands).map(Into::into)
}

#[native_abi]
pub fn to_string(cx: &mut Cx, value: Value) -> JsResult<Value> {
    if let Some(string) = (value.as_int32()).and_then(|it| JsString::existing_for_int32(cx, it)) {
        return Ok(string.into());
    }
    value.to_string(cx).map(Into::into)
}

#[native_abi]
pub fn to_number(cx: &mut Cx, value: Value, profile: &ArithmeticProfile) -> JsResult<Value> {
    let result = if value.is_number() {
        value
    } else {
        value.to_number(cx)?.into()
    };
    profile.record_unary(value, result);
    Ok(result)
}

#[native_abi]
pub fn type_of(cx: &mut Cx, value: Value) -> Value {
    value.type_of(cx).into()
}

/// What `compare` returns besides an `Ordering`.
pub const UNORDERED: i32 = 2;
pub const THREW: i32 = 3;

#[native_abi]
pub fn compare(cx: &mut Cx, lhs: Value, rhs: Value) -> i32 {
    #[native_abi]
    #[inline(never)]
    fn compare_any(cx: &mut Cx, lhs: Value, rhs: Value) -> i32 {
        match lhs.compare(cx, rhs) {
            Ok(ordering) => ordering.map_or(UNORDERED, |it: Ordering| it as i32),
            Err(_) => THREW,
        }
    }
    if let (Some(a), Some(b)) = (lhs.as_string(), rhs.as_string())
        && let (Some(a), Some(b)) = (a.try_impl(), b.try_impl())
        && let (a @ Text::Latin1(_), b @ Text::Latin1(_)) = (a.text(), b.text())
    {
        return a.cmp(&b) as i32;
    }
    compare_any(cx, lhs, rhs)
}

/// What `are_equal` returns if there is no memory to find out.
pub const UNKNOWN: u32 = 2;

/// Of two cells of the same type, 0 or 1. It needs to know nothing of the caller: it neither throws nor collects.
#[native_abi]
pub fn are_equal(a: Gc<JsCell>, b: Gc<JsCell>) -> u32 {
    #[inline(never)]
    fn are_ropes_equal(a: &JsString, b: &JsString) -> u32 {
        if a.len() != b.len() {
            return 0;
        }
        if let Some(result) = a.equals_in_pieces(b) {
            return result.into();
        }
        match (a.view_without_collecting(), b.view_without_collecting()) {
            (Some(a), Some(b)) => (a.text() == b.text()).into(),
            _ => UNKNOWN,
        }
    }
    if let (Some(a), Some(b)) = (a.downcast::<JsString>(), b.downcast::<JsString>()) {
        return match (a.try_impl(), b.try_impl()) {
            (Some(a), Some(b)) => (a.text() == b.text()).into(),
            _ => are_ropes_equal(&a, &b),
        };
    }
    match (a.downcast::<JsBigInt>(), b.downcast::<JsBigInt>()) {
        (Some(a), Some(b)) => (a.value() == b.value()).into(),
        _ => (a == b).into(),
    }
}

/// The address of no atom.
pub const NO_ATOM: usize = 1;

/// The address of the atom that has the same characters, or zero if it threw.
#[native_abi]
pub fn find_atom(cx: &mut Cx, string: Gc<JsString>) -> usize {
    match string.to_existing_property_key(cx) {
        Ok(key) => key.map_or(NO_ATOM, |key| key.name().address()),
        Err(_) => 0,
    }
}
