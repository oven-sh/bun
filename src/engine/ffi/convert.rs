//! Between values and slots.

use core::ffi::{CStr, c_char};

use bun_engine_asm::{FloatWidth, Sign};
use bun_engine_macros::native_abi;
use bun_engine_text::{AllocError, StringRef, Text, names};
use bun_engine_vm::{
    Cx, JsArrayBuffer, JsArrayBufferView, JsBigInt, JsResult, JsString, Thrown, Value, Vm,
};

use crate::{FfiCallback, NativeType, Representation};

pub(crate) const MAX_SAFE_INTEGER: u64 = (1 << f64::MANTISSA_DIGITS) - 1;

/// The strings that native code reads during a call.
pub struct CStrings<'a> {
    free: &'a mut [u8],
    too_long: Vec<Vec<u8>>,
}

impl<'a> CStrings<'a> {
    /// Those that fit go in `room`.
    pub fn new(room: &'a mut [u8]) -> CStrings<'a> {
        CStrings {
            free: room,
            too_long: Vec::new(),
        }
    }

    /// Returns the address.
    fn add(&mut self, text: Text<'_>) -> Result<u64, AllocError> {
        if text.len() < self.free.len() {
            let progress = text.encode_utf8_into(self.free);
            if progress.read == text.len() && progress.written < self.free.len() {
                let (taken, rest) =
                    core::mem::take(&mut self.free).split_at_mut(progress.written + 1);
                self.free = rest;
                taken[progress.written] = 0;
                return Ok(taken.as_mut_ptr().expose_provenance() as u64);
            }
        }
        let mut bytes = to_c_string(text)?;
        let address = bytes.as_mut_ptr().expose_provenance();
        self.too_long.push(bytes);
        Ok(address as u64)
    }
}

pub(crate) fn to_c_string(text: Text<'_>) -> Result<Vec<u8>, AllocError> {
    let (mut bytes, size) = (Vec::new(), text.utf8_len() + 1);
    bytes.try_reserve_exact(size).map_err(|_| AllocError)?;
    bytes.resize(size, 0);
    text.encode_utf8_into(&mut bytes);
    Ok(bytes)
}

/// # Safety
/// The address of bytes that end with a zero and do not change for `'a`.
pub(crate) unsafe fn c_string_at<'a>(address: u64) -> &'a [u8] {
    let first = core::ptr::with_exposed_provenance::<c_char>(address as usize);
    // SAFETY: the caller's.
    unsafe { CStr::from_ptr(first) }.to_bytes()
}

/// UTF-8, or else Latin-1.
pub(crate) fn decode(cx: &Cx, bytes: &[u8]) -> JsResult<Value> {
    let string = match cx.or_out_of_memory(StringRef::try_from_utf8(bytes))? {
        Some(string) => string,
        None => cx.or_out_of_memory(StringRef::try_from_units(bytes))?,
    };
    Ok(JsString::new(cx, string).into())
}

#[cold]
fn throw_cannot_convert(cx: &Cx, to: NativeType) -> Thrown {
    let name = to.name();
    cx.throw_type_error(format_args!("bun:ffi cannot convert argument to '{name}'"))
}

fn low_bits_of_bigint(value: Value) -> Option<u64> {
    Some(value.downcast::<JsBigInt>()?.value().to_u64_wrapping())
}

fn to_small_integer(cx: &mut Cx, to: NativeType, value: Value) -> JsResult<u64> {
    let bits = match low_bits_of_bigint(value) {
        Some(bits) => bits,
        None if value.is_string() || value.is_symbol() => return Err(throw_cannot_convert(cx, to)),
        None => value.to_uint32(cx)?.into(),
    };
    let Representation::Integer(size, sign) = to.representation() else {
        unreachable!()
    };
    let unused = u64::BITS - u32::from(size.bits());
    Ok(match sign {
        Sign::Signed => ((bits << unused) as i64 >> unused) as u64,
        Sign::Unsigned => bits << unused >> unused,
    })
}

fn to_large_integer(cx: &Cx, to: NativeType, value: Value) -> JsResult<u64> {
    let bits = value.as_number().map(bun_engine_number::to_uint64);
    (bits.or_else(|| low_bits_of_bigint(value))).ok_or_else(|| throw_cannot_convert(cx, to))
}

fn to_float(cx: &mut Cx, to: NativeType, width: FloatWidth, value: Value) -> JsResult<u64> {
    let number = match value.downcast::<JsBigInt>() {
        Some(bigint) => bigint.value().to_number(),
        None if value.is_string() || value.is_symbol() => return Err(throw_cannot_convert(cx, to)),
        None => value.to_number(cx)?,
    };
    Ok(match width {
        FloatWidth::F32 => (number as f32).to_bits().into(),
        FloatWidth::F64 => number.to_bits(),
    })
}

/// What does not fit gives what the instruction of the processor gives.
fn number_to_address(number: f64) -> u64 {
    const LIMIT: f64 = -(i64::MIN as f64);
    if cfg!(target_arch = "x86_64") && !(-LIMIT..LIMIT).contains(&number) {
        return i64::MIN as u64;
    }
    number as i64 as u64
}

fn numeric_to_address(value: Value) -> Option<u64> {
    (value.as_number().map(number_to_address)).or_else(|| low_bits_of_bigint(value))
}

/// What holds only until a script runs. `None` unless the value is a buffer or a view that the type accepts.
pub(crate) fn buffer_to_slot(to: NativeType, value: Value) -> Option<u64> {
    let view = value.downcast::<JsArrayBufferView>();
    let address = match to {
        NativeType::BufferLength => return Some(view?.byte_length() as u64),
        NativeType::Buffer => view?.vector(),
        NativeType::Pointer | NativeType::CString | NativeType::Function => match view {
            Some(view) => view.vector(),
            None => value.downcast::<JsArrayBuffer>()?.buffer().data(),
        },
        _ => return None,
    };
    Some(address.expose_provenance() as u64)
}

fn to_pointer(
    cx: &mut Cx,
    to: NativeType,
    value: Value,
    strings: Option<&mut CStrings<'_>>,
) -> JsResult<u64> {
    if let Some(address) = numeric_to_address(value).or_else(|| buffer_to_slot(to, value)) {
        return Ok(address);
    }
    if value.is_undefined_or_null() {
        if to == NativeType::Function {
            return Err(cx.throw_type_error(
                "bun:ffi: expected a callback (a JSCallback or an FFI function) but got undefined/null",
            ));
        }
        return Ok(0);
    }
    if let Some(callback) = value.downcast::<FfiCallback>() {
        return (callback.entry().map(|address| address as u64))
            .ok_or_else(|| cx.throw_type_error("bun:ffi: the JSFFICallback has been closed"));
    }
    if let Some(string) = value.as_string() {
        if to != NativeType::CString {
            let message = "To convert a string to a pointer, encode it as a buffer";
            return Err(cx.throw_type_error(message));
        }
        let view = string.view(cx)?;
        let Some(strings) = strings else {
            return Err(cx.throw_type_error(
                "bun:ffi: a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray",
            ));
        };
        return cx.or_out_of_memory(strings.add(view.text()));
    }
    if let Some(object) = value.as_object()
        && let Some(address) = numeric_to_address(object.get(cx, names::ptr)?)
    {
        return Ok(address);
    }
    Err(throw_cannot_convert(cx, to))
}

/// Without `strings` no string can be converted.
pub fn value_to_slot(
    cx: &mut Cx,
    to: NativeType,
    value: Value,
    strings: Option<&mut CStrings<'_>>,
) -> JsResult<u64> {
    match to {
        NativeType::Char
        | NativeType::Int8
        | NativeType::Uint8
        | NativeType::Int16
        | NativeType::Uint16
        | NativeType::Int32
        | NativeType::Uint32 => to_small_integer(cx, to, value),
        NativeType::Int64 | NativeType::Uint64 | NativeType::Int64Fast | NativeType::Uint64Fast => {
            to_large_integer(cx, to, value)
        }
        NativeType::Double => to_float(cx, to, FloatWidth::F64, value),
        NativeType::Float => to_float(cx, to, FloatWidth::F32, value),
        NativeType::Bool => Ok(value.to_boolean(cx).into()),
        NativeType::Pointer | NativeType::CString | NativeType::Function => {
            to_pointer(cx, to, value, strings)
        }
        NativeType::Buffer | NativeType::BufferLength => {
            buffer_to_slot(to, value).ok_or_else(|| {
                let name = to.name();
                cx.throw_type_error(format_args!(
                    "bun:ffi '{name}' argument must be a TypedArray or DataView"
                ))
            })
        }
        NativeType::Value => Ok(value.to_bits()),
        NativeType::Void => Ok(0),
    }
}

pub(crate) fn address_to_value(vm: &Vm, address: u64) -> Value {
    match address {
        0 => Value::NULL,
        1..=MAX_SAFE_INTEGER => Value::number(address as f64),
        _ => JsBigInt::from_small(vm, address).into(),
    }
}

/// # Safety
/// For `CString` zero or the address of bytes that end with a zero. For `Value` zero or a value that is alive.
pub unsafe fn slot_to_value(cx: &Cx, from: NativeType, slot: u64) -> JsResult<Value> {
    Ok(match from {
        NativeType::Char
        | NativeType::Int8
        | NativeType::Uint8
        | NativeType::Int16
        | NativeType::Uint16
        | NativeType::Int32 => Value::int32(slot as i32),
        NativeType::Uint32 => Value::number(f64::from(slot as u32)),
        NativeType::Bool => Value::boolean(slot != 0),
        NativeType::Int64Fast if (slot as i64).unsigned_abs() <= MAX_SAFE_INTEGER => {
            Value::number(slot as i64 as f64)
        }
        NativeType::Uint64Fast if slot < MAX_SAFE_INTEGER => Value::number(slot as f64),
        NativeType::Int64 | NativeType::Int64Fast => JsBigInt::from_small(cx, slot as i64).into(),
        NativeType::Uint64 | NativeType::Uint64Fast | NativeType::BufferLength => {
            JsBigInt::from_small(cx, slot).into()
        }
        NativeType::Double => Value::number(f64::from_bits(slot)),
        NativeType::Float => Value::number(f32::from_bits(slot as u32).into()),
        NativeType::CString if slot == 0 => Value::NULL,
        // SAFETY: the caller's.
        NativeType::CString => decode(cx, unsafe { c_string_at(slot) })?,
        NativeType::Pointer | NativeType::Function | NativeType::Buffer => {
            address_to_value(cx, slot)
        }
        // SAFETY: the caller's.
        NativeType::Value => unsafe { Value::from_bits_or_empty(slot) }.unwrap_or_default(),
        NativeType::Void => Value::UNDEFINED,
    })
}

#[native_abi]
pub(crate) unsafe fn box_result(cx: &Cx, from: NativeType, slot: u64) -> JsResult<Value> {
    // SAFETY: what a function of that signature has returned.
    unsafe { slot_to_value(cx, from, slot) }
}
