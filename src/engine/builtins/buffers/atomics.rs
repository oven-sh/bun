use core::time::Duration;

use bun_engine_number::is_integer;
use bun_engine_vm::{
    AtomicOperation, Attributes, BufferSlice, Element, ElementType, JsArrayBufferView,
    JsTypedArray, TypedArray, with_element_type,
};

use crate::prelude::*;

static_table!(static PROPERTIES = [
    StaticProperty::function(names::add, modify::<{ AtomicOperation::Add }>, 3).with_intrinsic(Intrinsic::AtomicsAdd),
    StaticProperty::function(names::and, modify::<{ AtomicOperation::And }>, 3).with_intrinsic(Intrinsic::AtomicsAnd),
    StaticProperty::function(names::compareExchange, compare_exchange, 4)
        .with_intrinsic(Intrinsic::AtomicsCompareExchange),
    StaticProperty::function(names::exchange, modify::<{ AtomicOperation::Exchange }>, 3)
        .with_intrinsic(Intrinsic::AtomicsExchange),
    StaticProperty::function(names::isLockFree, is_lock_free, 1).with_intrinsic(Intrinsic::AtomicsIsLockFree),
    StaticProperty::function(names::load, load, 2).with_intrinsic(Intrinsic::AtomicsLoad),
    StaticProperty::function(names::notify, notify, 3).with_intrinsic(Intrinsic::AtomicsNotify),
    StaticProperty::function(names::or, modify::<{ AtomicOperation::Or }>, 3).with_intrinsic(Intrinsic::AtomicsOr),
    StaticProperty::function(names::store, store, 3).with_intrinsic(Intrinsic::AtomicsStore),
    StaticProperty::function(names::sub, modify::<{ AtomicOperation::Sub }>, 3).with_intrinsic(Intrinsic::AtomicsSub),
    StaticProperty::function(names::wait, wait::<false>, 4).with_intrinsic(Intrinsic::AtomicsWait),
    StaticProperty::function(names::xor, modify::<{ AtomicOperation::Xor }>, 3).with_intrinsic(Intrinsic::AtomicsXor),
    StaticProperty::function(names::pause, pause, 0).with_intrinsic(Intrinsic::AtomicsPause),
    StaticProperty::function(names::waitAsync, wait::<true>, 4).with_intrinsic(Intrinsic::AtomicsWaitAsync),
    StaticProperty::string(symbols::toStringTag, names::Atomics),
]);

define_object!(AtomicsObject, "Atomics", PROPERTIES);

pub(super) fn initialize(cx: &Cx) {
    let object = AtomicsObject::create(cx, cx.object_prototype().into());
    cx.global().init_atomics_object(object);
}

/// ValidateAtomicAccess
#[inline(always)]
fn validate_index(cx: &mut Cx, index: Value, length: usize) -> JsResult<usize> {
    let index = index.to_index(cx, "accessIndex")? as usize;
    if index >= length {
        return Err(cx.throw_range_error("Access index out of bounds for atomic access."));
    }
    Ok(index)
}

/// ValidateAtomicAccessOnIntegerTypedArray, of the first two arguments.
#[inline(always)]
fn validate_access(cx: &mut Cx, frame: &CallFrame) -> JsResult<(Gc<JsTypedArray>, usize)> {
    let (array, length) = JsTypedArray::validate_value(cx, frame.argument(0))?;
    let element_type = array.element_type();
    if element_type.is_float() || element_type == ElementType::Uint8Clamped {
        return Err(cx.throw_type_error(
            "Typed array argument must be an Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, BigInt64Array, or BigUint64Array.",
        ));
    }
    Ok((array, validate_index(cx, frame.argument(1), length)?))
}

/// RevalidateAtomicAccess, and then the access to a slice of that one element.
#[inline(always)]
fn access<T: Element, R>(
    cx: &mut Cx,
    array: &JsTypedArray,
    index: usize,
    access: impl FnOnce(BufferSlice<'_, T>) -> R,
) -> JsResult<R> {
    let no_gc = cx.no_gc();
    match array.typed::<T>().elements(&no_gc).try_slice(index, 1) {
        Some(element) => Ok(access(element)),
        None => Err(JsArrayBufferView::throw_out_of_bounds(cx)),
    }
}

/// For a type that `validate_access` lets pass.
macro_rules! with_integer_type {
    ($array:ident, $alias:ident => $body:expr) => {
        with_element_type!($array.element_type(), $alias => {
            if const { $alias::TYPE.is_float() } {
                unreachable!()
            }
            $body
        })
    };
}

#[native_abi]
fn modify<const OPERATION: AtomicOperation>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, index) = validate_access(cx, frame)?;
    with_integer_type!(array, T => {
        let operand = T::from_value(cx, frame.argument(2))?;
        let old = access(cx, &array, index, |it| it.atomic_modify(0, OPERATION, operand))?;
        Ok(old.to_value(cx))
    })
}

#[native_abi]
fn compare_exchange(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, index) = validate_access(cx, frame)?;
    with_integer_type!(array, T => {
        let expected = T::from_value(cx, frame.argument(2))?;
        let new = T::from_value(cx, frame.argument(3))?;
        let old = access(cx, &array, index, |it| it.atomic_compare_exchange(0, expected, new))?;
        Ok(old.to_value(cx))
    })
}

#[native_abi]
fn load(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, index) = validate_access(cx, frame)?;
    with_integer_type!(array, T => {
        Ok(access::<T, _>(cx, &array, index, |it| it.atomic_load(0))?.to_value(cx))
    })
}

#[native_abi]
fn store(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, index) = validate_access(cx, frame)?;
    let value = if array.element_type().is_bigint() {
        frame.argument(2).to_bigint(cx)?.into()
    } else {
        Value::from(frame.argument(2).to_integer_or_infinity(cx)?)
    };
    with_integer_type!(array, T => {
        let element = T::from_value(cx, value)?;
        access(cx, &array, index, |it| it.atomic_store(0, element))?;
    });
    Ok(value)
}

#[native_abi]
fn is_lock_free(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let size = frame.argument(0).to_integer_or_infinity(cx)?;
    Ok([1.0, 2.0, 4.0, 8.0].contains(&size).into())
}

#[native_abi]
fn pause(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let argument = frame.argument(0);
    if !argument.is_undefined() && !argument.as_number().is_some_and(is_integer) {
        let message = "Atomics.pause argument needs to be either undefined or integer number";
        return Err(cx.throw_type_error(message));
    }
    core::hint::spin_loop();
    Ok(Value::UNDEFINED)
}

/// ValidateIntegerTypedArray with waitable set to true.
fn validate_waitable(cx: &Cx, value: Value) -> JsResult<(Gc<JsTypedArray>, usize)> {
    let (array, length) = JsTypedArray::validate_value(cx, value)?;
    if !matches!(
        array.element_type(),
        ElementType::Int32 | ElementType::BigInt64
    ) {
        let message = "Typed array argument must be an Int32Array or BigInt64Array.";
        return Err(cx.throw_type_error(message));
    }
    Ok((array, length))
}

fn wait_for<T: Element + PartialEq, const IS_ASYNC: bool>(
    cx: &mut Cx,
    frame: &CallFrame,
    array: &TypedArray<T>,
    index: usize,
) -> JsResult<Value> {
    let expected = T::from_value(cx, frame.argument(2))?;
    let milliseconds = frame.argument(3).to_number(cx)?;
    let seconds = if milliseconds < 0.0 {
        0.0
    } else {
        milliseconds / 1000.0
    };
    let timeout = Duration::try_from_secs_f64(seconds).ok();
    if IS_ASYNC {
        let result = array.wait_async(cx, index, expected, timeout);
        let (object, is_async) = (cx.new_object(), result.is_ok());
        let value = result.map_or_else(|it| it.to_value(cx), Into::into);
        object.put_direct(cx, names::r#async, is_async.into(), Attributes::NONE);
        object.put_direct(cx, names::value, value, Attributes::NONE);
        return Ok(object.into());
    }
    if cx.embedder().must_not_block.get() {
        return Err(cx.throw_type_error("Atomics.wait cannot be called from the current thread."));
    }
    Ok(array.wait(cx, index, expected, timeout)?.to_value(cx))
}

/// DoWait
#[native_abi]
fn wait<const IS_ASYNC: bool>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, length) = validate_waitable(cx, frame.argument(0))?;
    if !array.is_shared() {
        let message = "Typed array for wait/waitAsync/notify must wrap a SharedArrayBuffer.";
        return Err(cx.throw_type_error(message));
    }
    let index = validate_index(cx, frame.argument(1), length)?;
    match array.downcast::<TypedArray<i32>>() {
        Some(array) => wait_for::<_, IS_ASYNC>(cx, frame, &array, index),
        None => wait_for::<_, IS_ASYNC>(cx, frame, array.typed::<i64>(), index),
    }
}

#[native_abi]
fn notify(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (array, length) = validate_waitable(cx, frame.argument(0))?;
    let index = validate_index(cx, frame.argument(1), length)?;
    let count = match frame.argument(2) {
        Value::UNDEFINED => u32::MAX,
        count => count.to_integer_or_infinity(cx)? as u32,
    };
    if !array.is_shared() {
        return Ok(Value::ZERO);
    }
    Ok(array.notify(index, count).into())
}
