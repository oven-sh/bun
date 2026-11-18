//! What optimized code calls.

use bun_engine_bytecode::Specialization;
use bun_engine_codegen::ir::Type;
use bun_engine_macros::native_abi;
use bun_engine_number::math;
use bun_engine_vm::call::CallTarget;
use bun_engine_vm::heap::{Allocator, barrier};
use bun_engine_vm::{
    CallFrame, Cx, Gc, Intrinsic, JsBigInt, JsCell, JsObject, JsResult, JsString, StackVisitor,
    Value, Vm, errors,
};

use crate::lower::Threw;

#[derive(Clone, Copy)]
pub(crate) struct Address(pub(super) *const ());

impl Address {
    pub(crate) fn get(self) -> usize {
        self.0 as usize
    }
}

/// A function whose first parameter is the `Cx`.
#[derive(Clone, Copy)]
pub(crate) struct Operation {
    pub(crate) address: Address,
    pub(crate) result: Type,
    pub(crate) threw: Threw,
}

pub(crate) const THREW: i32 = -1;

/// A boolean or another small number, or `THREW`.
#[repr(transparent)]
pub(crate) struct Answer(i32);

impl From<JsResult<bool>> for Answer {
    fn from(result: JsResult<bool>) -> Self {
        Self(result.map_or(THREW, i32::from))
    }
}

impl From<JsResult<u16>> for Answer {
    fn from(result: JsResult<u16>) -> Self {
        Self(result.map_or(THREW, i32::from))
    }
}

pub(super) trait Returned {
    const TYPE: Type = Type::I64;
    const THREW: Threw;
}

impl Returned for Answer {
    const TYPE: Type = Type::I32;
    const THREW: Threw = Threw::IfMarked;
}

impl<T> Returned for JsResult<T> {
    const THREW: Threw = Threw::IfZero;
}

impl<T> Returned for Gc<T> {
    const THREW: Threw = Threw::Never;
}

impl Returned for u32 {
    const TYPE: Type = Type::I32;
    const THREW: Threw = Threw::Never;
}

impl<T> Returned for Option<T> {
    const THREW: Threw = Threw::Never;
}

impl Returned for usize {
    const THREW: Threw = Threw::Never;
}

macro_rules! operations {
    ($($constant:ident: fn $name:ident($($parameter:ident: $type:ty),*) -> $result:ty $body:block)*) => {$(
        #[native_abi]
        pub(super) fn $name($($parameter: $type),*) -> $result $body

        pub(crate) const $constant: Operation = Operation {
            address: Address($name as *const ()),
            result: <$result as Returned>::TYPE,
            threw: <$result as Returned>::THREW,
        };
    )*};
}

pub(super) use operations;

operations! {
    RESOLVE_ROPE: fn resolve_rope(cx: &Cx, rope: Gc<JsString>) -> Answer {
        rope.resolve(cx).map(|_| true).into()
    }
    STRING_FROM_UNIT: fn string_from_unit(cx: &Cx, unit: u32) -> Gc<JsString> {
        JsString::from_unit(cx, unit as u16)
    }
    MAKE_ROOM: fn make_room(cx: &Cx, object: Gc<JsObject>, index: u32) -> usize {
        object.try_make_room_for_element(cx, index).unwrap_or(0)
    }
    TO_ARGUMENT_LIST: fn to_argument_list(cx: &mut Cx, value: Value) -> JsResult<Value> {
        bun_engine_vm::to_argument_list(cx, value)
    }
    BIGINT_FROM_BITS: fn bigint_from_bits(cx: &Cx, bits: u64, is_signed: u32) -> Gc<JsBigInt> {
        if is_signed != 0 {
            JsBigInt::from_small(cx, bits as i64)
        } else {
            JsBigInt::from_small(cx, bits)
        }
    }
    GROW_SLOTS: fn grow_slots(cx: &Cx, object: Gc<JsObject>, old: u32, new: u32) -> usize {
        // SAFETY: the shape has been checked, and the code goes on to store the new one.
        unsafe { object.grow_slots(cx, old, new) }
    }
}

macro_rules! leaves {
    ($($constant:ident: fn $name:ident($($parameter:ident: $type:ty),*) -> $result:ty $body:block)*) => {$(
        #[native_abi]
        pub(super) fn $name($($parameter: $type),*) -> $result $body

        pub(crate) const $constant: Address = Address($name as *const ());
    )*};
}

pub(super) use leaves;

leaves! {
    DOUBLE_REMAINDER: fn double_remainder(a: f64, b: f64) -> f64 {
        math::remainder(a, b)
    }
    POWER: fn power(base: f64, exponent: f64) -> f64 {
        math::pow(base, exponent)
    }
    TO_BOOLEAN: fn to_boolean(cx: &Cx, value: Value) -> u32 {
        value.to_boolean(cx).into()
    }
    EQUAL_NULL: fn equal_null(cx: &Cx, value: Value) -> u32 {
        match value.as_cell() {
            Some(cell) => cell.masquerades_as_undefined(cx).into(),
            None => value.is_undefined_or_null().into(),
        }
    }
}

macro_rules! math_functions {
    ($($intrinsic:ident $name:ident,)*) => {
        $(#[native_abi]
        fn $name(number: f64) -> f64 {
            math::$name(number)
        })*

        const MATH_FUNCTIONS: &[(Intrinsic, Address)] =
            &[$((Intrinsic::$intrinsic, Address($name as *const ())),)*];
    };
}

math_functions! {
    ACos acos, ASin asin, ATan atan, ACosh acosh, ASinh asinh, ATanh atanh, Cbrt cbrt, Cos cos, Cosh cosh, Exp exp,
    Expm1 expm1, F16Round f16round, Log log, Log10 log10, Log1p log1p, Log2 log2, Sin sin, Sinh sinh, Tan tan,
    Tanh tanh,
}

pub(crate) fn math_function_for(intrinsic: Intrinsic) -> Option<u32> {
    let position = MATH_FUNCTIONS.iter().position(|it| it.0 == intrinsic);
    position.map(|position| position as u32)
}

pub(crate) fn math_function(position: u32) -> Address {
    MATH_FUNCTIONS[position as usize].1
}

pub(crate) mod collections;
pub(crate) mod elements;
pub(crate) mod iteration;
pub(crate) mod library;
pub(crate) mod methods;
pub(crate) mod objects;
pub(crate) mod suspension;

#[native_abi]
pub(super) fn allocate(vm: &Vm, allocator: &Allocator) -> usize {
    match allocator.allocate_slow(&vm.heap) {
        0 => bun_alloc::out_of_memory(),
        cell => cell,
    }
}

#[native_abi]
pub(super) fn remember(_: &Vm, cell: &JsCell) {
    barrier::slow_path(cell);
}

#[native_abi]
pub(super) fn to_int32(_: &Vm, bits: u64) -> u64 {
    (bun_engine_number::to_int32(f64::from_bits(bits)) as u32).into()
}

#[repr(C)]
pub(super) struct Target {
    /// Zero if it threw.
    entry: usize,
    executable: usize,
}

/// # Safety
/// The innermost frame is one of optimized code, at a call site.
pub(super) unsafe fn realm_of_caller<'a>(vm: &Vm) -> &'a mut Cx {
    let caller = StackVisitor::frames(vm).next().and_then(|it| it.code_block);
    // SAFETY: generated code runs inside a call that has the `Cx`.
    unsafe { Cx::from_global(caller.expect("optimized code").global()) }
}

/// `new_frame` has the callee.
#[native_abi]
pub(super) unsafe fn find_target(vm: &Vm, new_frame: &CallFrame, constructs: u32) -> Target {
    let specialization = [Specialization::Call, Specialization::Construct][constructs as usize];
    let slot = |offset: usize| {
        // SAFETY: a field of the header.
        unsafe { new_frame.slot(offset as isize / 8) }
    };
    // SAFETY: the code has stored it.
    let callee = unsafe { Value::from_bits(slot(CallFrame::OFFSET_OF_CALLEE).get()) };
    if let Some(found) = CallTarget::find(callee, specialization) {
        slot(CallFrame::OFFSET_OF_CODE_BLOCK).set(found.code_block as u64);
        let (entry, executable) = (found.entry, found.executable);
        return Target { entry, executable };
    }
    // SAFETY: called from there.
    let cx = unsafe { realm_of_caller(vm) };
    let _ = errors::throw_failed_call(cx, callee, specialization);
    let (entry, executable) = (0, 0);
    Target { entry, executable }
}
