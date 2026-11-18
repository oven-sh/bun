//! Methods that read and write numbers as those of Bun's `Buffer` do.

use bun_engine_number::to_int32;
use bun_engine_vm::{BufferAccessor, Intrinsic, JsArrayBufferView, JsBigInt};

use crate::prelude::*;

const SIGNED: u8 = 1;
const FLOAT: u8 = 2;
const BIG_ENDIAN: u8 = 4;
const WRITE: u8 = 8;

const fn accessor(byte_size: u8, flags: u8) -> BufferAccessor {
    BufferAccessor {
        byte_size,
        is_signed: flags & SIGNED != 0,
        is_float: flags & FLOAT != 0,
        is_little_endian: flags & BIG_ENDIAN == 0,
        is_write: flags & WRITE != 0,
    }
}

fn integer_between(value: Value, least: f64, greatest: f64) -> Option<usize> {
    let number = value.as_number()?;
    (number.floor() == number && (least..=greatest).contains(&number)).then_some(number as usize)
}

/// `None` if it is out of range.
fn bits_of_number(number: f64, size: usize, how: BufferAccessor) -> Option<u64> {
    if how.is_float {
        return Some(match size {
            4 => (number as f32).to_bits().into(),
            _ => number.to_bits(),
        });
    }
    let count = (size as f64 * 8.0).exp2();
    let least = if how.is_signed { -count / 2.0 } else { 0.0 };
    if number < least || number > least + count - 1.0 || number.is_nan() && how.byte_size == 0 {
        return None;
    }
    let low_bits = if size == 3 { 16 } else { 32 };
    let low = u64::from(to_int32(number) as u32) & ((1 << low_bits) - 1);
    let high = to_int32((number / f64::from(low_bits).exp2()).floor()) as u32;
    Some(u64::from(high) << low_bits | low)
}

fn number_from_bits(cx: &Cx, bits: u64, size: usize, how: BufferAccessor) -> Value {
    let unused = u64::BITS - size as u32 * 8;
    match (how.is_float, size, how.is_signed) {
        (true, 4, _) => Value::double(f32::from_bits(bits as u32).into()),
        (true, ..) => Value::double(f64::from_bits(bits)),
        (_, 8, true) => JsBigInt::from_small(cx, bits as i64).into(),
        (_, 8, false) => JsBigInt::from_small(cx, bits).into(),
        (.., true) => Value::number(((bits << unused) as i64 >> unused) as f64),
        (.., false) => Value::number(bits as f64),
    }
}

#[native_abi]
fn access<const SIZE: u8, const FLAGS: u8>(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let how = const { accessor(SIZE, FLAGS) };
    let Some(view) = frame.this_value().downcast::<JsArrayBufferView>() else {
        return Err(cx.throw_type_error("The receiver is no view"));
    };
    let (value, is_bigint) = (frame.argument(0), SIZE == 8 && !how.is_float);
    let mut number = 0.0;
    if how.is_write && !is_bigint {
        number = value.to_number(cx)?;
    } else if how.is_write && !value.is_bigint() {
        return Err(cx.throw_type_error("The value is no BigInt"));
    }
    let position = usize::from(how.is_write);
    let size = match SIZE {
        0 => integer_between(frame.argument(position + 1), 1.0, 6.0),
        size => Some(size.into()),
    };
    let size = size.ok_or_else(|| cx.throw_range_error("The size is out of range"))?;
    let offset = match frame.argument(position) {
        offset if SIZE == 0 && !offset.is_number() => {
            return Err(cx.throw_type_error("The offset is no number"));
        }
        Value::UNDEFINED => Value::ZERO,
        offset => offset,
    };
    let offset = integer_between(offset, 0.0, view.byte_length() as f64 - size as f64);
    let offset = offset.ok_or_else(|| cx.throw_range_error("The offset is out of range"))?;
    let shift = |index: usize| match how.is_little_endian {
        true => index * 8,
        false => (size - 1 - index) * 8,
    };
    if !how.is_write {
        let no_gc = cx.no_gc();
        let bytes = view.bytes(&no_gc).slice(offset..offset + size).iter();
        let bits = (bytes.enumerate()).fold(0, |all, it| all | u64::from(it.1) << shift(it.0));
        return Ok(number_from_bits(cx, bits, size, how));
    }
    let bits = match value.as_bigint().filter(|_| is_bigint) {
        Some(bigint) if how.is_signed => bigint.value().to_i64().map(|it| it as u64),
        Some(bigint) => bigint.value().to_u64(),
        None => bits_of_number(number, size, how),
    };
    let bits = bits.ok_or_else(|| cx.throw_range_error("The value is out of range"))?;
    let no_gc = cx.no_gc();
    let bytes = view.bytes(&no_gc);
    (0..size).for_each(|index| bytes.set(offset + index, (bits >> shift(index)) as u8));
    Ok((offset + size).into())
}

macro_rules! accessors {
    ($($name:literal $size:literal $flags:expr;)*) => {
        const ALL: &[(&str, NativeFunction, BufferAccessor)] = &[$(
            (concat!("read", $name), access::<$size, { $flags }>, accessor($size, $flags)),
            (concat!("write", $name), access::<$size, { $flags | WRITE }>, accessor($size, $flags | WRITE)),
        )*];
    };
}

accessors! {
    "Int8" 1 SIGNED;
    "UInt8" 1 0;
    "Int16LE" 2 SIGNED;
    "Int16BE" 2 SIGNED | BIG_ENDIAN;
    "UInt16LE" 2 0;
    "UInt16BE" 2 BIG_ENDIAN;
    "Int32LE" 4 SIGNED;
    "Int32BE" 4 SIGNED | BIG_ENDIAN;
    "UInt32LE" 4 0;
    "UInt32BE" 4 BIG_ENDIAN;
    "FloatLE" 4 FLOAT;
    "FloatBE" 4 FLOAT | BIG_ENDIAN;
    "DoubleLE" 8 FLOAT;
    "DoubleBE" 8 FLOAT | BIG_ENDIAN;
    "BigInt64LE" 8 SIGNED;
    "BigInt64BE" 8 SIGNED | BIG_ENDIAN;
    "BigUInt64LE" 8 0;
    "BigUInt64BE" 8 BIG_ENDIAN;
    "IntLE" 0 SIGNED;
    "IntBE" 0 SIGNED | BIG_ENDIAN;
    "UIntLE" 0 0;
    "UIntBE" 0 BIG_ENDIAN;
}

#[native_abi]
pub(super) fn create(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let object = cx.new_object();
    for &(name, function, how) in ALL {
        if BufferAccessor::of(function).is_none() {
            how.register(function);
        }
        let length = 1 + u32::from(how.is_write) + u32::from(how.byte_size == 0);
        let (name, intrinsic) = (Identifier::from_literal(name), Intrinsic::BufferAccessor);
        let attributes = Attributes::NONE;
        object.put_direct_native_function(cx, name.name(), length, function, intrinsic, attributes);
    }
    Ok(object.into())
}
