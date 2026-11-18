//! ToWebAssemblyValue and ToJSValue. A reference has the bits of a `Value`.

use bun_engine_vm::{JsBigInt, ValueVec, for_each_in_iterable};
use bun_engine_wasm_format::{
    AbstractHeapType, CanonicalType, CanonicalValType, Rtt, ValKind, ValType,
};
use bun_engine_wasm_runtime::{Bits, Module, Reference};

use crate::engine::engine;
use crate::function::WasmFunction;
use crate::prelude::*;

pub(crate) const INVALID_SIGNATURE: &str =
    "an exported wasm function cannot contain an invalid parameter or return value";
pub(crate) const WRONG_REFERENCE: &str = "Argument value did not match the reference type";

fn top_of(ty: ValType) -> Option<AbstractHeapType> {
    Some(ty.as_ref()?.heap_type().abstract_type().top())
}

/// Whether scripts have values that stand for those of the type.
pub(crate) fn can_cross(ty: ValType) -> bool {
    ty.kind() != ValKind::V128 && top_of(ty) != Some(AbstractHeapType::Exn)
}

/// The type that a value has to have.
#[derive(Clone, Copy)]
pub(crate) struct Expected<'a> {
    ty: ValType,
    defined: Option<&'a Rtt>,
}

impl<'a> Expected<'a> {
    #[inline]
    pub(crate) fn in_module(module: &'a Module, ty: ValType) -> Self {
        let index = ty.as_ref().and_then(|it| it.heap_type().index());
        let defined = index.map(|index| module.types().rtt(index));
        Self { ty, defined }
    }
}

impl<'a> From<&'a CanonicalValType> for Expected<'a> {
    fn from(ty: &'a CanonicalValType) -> Self {
        let (ty, defined) = (ty.erased(), ty.defined().map(CanonicalType::rtt));
        Self { ty, defined }
    }
}

pub(crate) fn to_bits(cx: &mut Cx, value: Value, expected: Expected<'_>) -> JsResult<Bits> {
    Ok(match expected.ty.kind() {
        ValKind::I32 => Bits::from(value.to_int32(cx)? as u32),
        ValKind::I64 => Bits::from(value.to_bigint64(cx)? as u64),
        ValKind::F32 => Bits::from((value.to_number(cx)? as f32).to_bits()),
        ValKind::F64 => Bits::from(value.to_number(cx)?.to_bits()),
        ValKind::V128 => return Err(cx.throw_type_error(INVALID_SIGNATURE)),
        ValKind::Ref => to_reference(cx, value, expected)?.into(),
    })
}

pub(crate) fn from_bits(cx: &Cx, bits: Bits, ty: ValType) -> JsResult<Value> {
    if !can_cross(ty) {
        return Err(cx.throw_type_error(INVALID_SIGNATURE));
    }
    Ok(match ty.kind() {
        ValKind::I32 => Value::int32(bits as i32),
        ValKind::I64 => JsBigInt::from_small(cx, bits as i64).into(),
        ValKind::F32 => Value::number(f64::from(f32::from_bits(bits as u32))),
        ValKind::F64 => Value::number(f64::from_bits(bits as u64)),
        ValKind::V128 | ValKind::Ref => from_reference(Reference(bits as u64)),
    })
}

pub(crate) fn from_reference(reference: Reference) -> Value {
    // SAFETY: the run time hands out no other bits.
    unsafe { Value::from_bits(reference.0) }
}

/// `None` if the value is not of the type, which is that of a reference.
pub(crate) fn try_to_reference(value: Value, expected: Expected<'_>) -> Option<Reference> {
    let ty = expected.ty.as_ref().expect("the type of a reference");
    let reference = Reference(value.to_bits());
    match ty.heap_type().abstract_type() {
        _ if value.is_null() => ty.is_nullable().then_some(reference),
        AbstractHeapType::Extern => Some(reference),
        AbstractHeapType::Func => (value.downcast::<WasmFunction>())
            .filter(|function| expected.defined.is_none_or(|it| function.has_type(it)))
            .map(|_| reference),
        other if other.top() == AbstractHeapType::Any => {
            let reference = reference.internalized();
            // SAFETY: a value.
            unsafe { engine()?.has_type(reference, ty, expected.defined) }.then_some(reference)
        }
        _ => None,
    }
}

pub(crate) fn to_reference(cx: &Cx, value: Value, expected: Expected<'_>) -> JsResult<Reference> {
    try_to_reference(value, expected).ok_or_else(|| {
        let heap_type = expected.ty.as_ref().map(|it| it.heap_type());
        match heap_type.is_some_and(|it| it.is(AbstractHeapType::Extern)) {
            true => cx.throw_type_error("Non-null Externref cannot be null"),
            false => cx.throw_type_error(WRONG_REFERENCE),
        }
    })
}

/// IteratorToList. `None` if the list has another length.
pub(crate) fn list_of_length(
    cx: &mut Cx,
    iterable: Value,
    length: usize,
) -> JsResult<Option<ValueVec>> {
    let (mut list, mut has_more) = (ValueVec::new(), false);
    for_each_in_iterable(cx, iterable, |_, value| {
        match list.len() < length {
            true => list.push(value),
            false => has_more = true,
        }
        Ok(())
    })?;
    Ok((list.len() == length && !has_more).then_some(list))
}
