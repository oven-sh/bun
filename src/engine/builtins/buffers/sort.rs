use bun_engine_text::AllocError;
use bun_engine_vm::{
    Bits, BufferSlice, Element, ElementType, JsTypedArray, NumberElement, ValueVec,
    with_element_type,
};

use super::copy::default_shape;
use super::prototype::this_array;
use crate::arrays::sort::{MIN_LENGTH_TO_AVOID_CALLS, orders_numbers_descending, sort_by_calling};
use crate::prelude::*;

/// An unsigned integer whose order is that of the elements. All NaNs have the same.
#[inline(always)]
fn key_of<T: Element>(element: T) -> T::Bits {
    let (bits, sign): (u64, u64) = (element.to_bits().into(), T::TYPE.sign_bit());
    Bits::truncate(if !T::TYPE.is_float() {
        if T::TYPE.is_signed() {
            bits ^ sign
        } else {
            bits
        }
    } else if bits & !sign > T::TYPE.bits_of_infinity() {
        T::TYPE.bits_of_nan() | sign
    } else if bits & sign != 0 {
        !bits
    } else {
        bits | sign
    })
}

/// The bits to invert to get from a key back to the element.
#[derive(Clone, Copy)]
struct Decoder {
    with_top_bit: u64,
    without_top_bit: u64,
}

impl Decoder {
    const fn of(element_type: ElementType) -> Decoder {
        let sign = element_type.sign_bit();
        let (with_top_bit, without_top_bit) = if element_type.is_float() {
            (sign, u64::MAX)
        } else if element_type.is_signed() {
            (sign, sign)
        } else {
            (0, 0)
        };
        Decoder {
            with_top_bit,
            without_top_bit,
        }
    }

    #[inline(always)]
    fn decode<K: Bits>(self, key: K) -> K {
        let key: u64 = key.into();
        K::truncate(if key & K::TYPE.sign_bit() != 0 {
            key ^ self.with_top_bit
        } else {
            key ^ self.without_top_bit
        })
    }
}

/// There are fewer than 2^32. `flip` has the bits in which a key differs from its element.
fn counting_sort(bytes: BufferSlice<'_, u8>, flip: u8) {
    /// An increment would have to wait for the one before it if it went to the same counter.
    const WAYS: usize = size_of::<u32>();
    let mut counts = [[0u32; 256]; WAYS];
    let words = bytes.cast::<u32>();
    for word in words.iter() {
        for (counts, byte) in counts.iter_mut().zip(word.to_ne_bytes()) {
            counts[usize::from(byte)] += 1;
        }
    }
    for byte in bytes.slice(words.byte_len()..bytes.len()).iter() {
        counts[0][usize::from(byte)] += 1;
    }
    let [mut totals, rest @ ..] = counts;
    for (index, total) in totals.iter_mut().enumerate() {
        *total += rest.iter().map(|it| it[index]).sum::<u32>();
    }
    let mut start = 0;
    for byte in (0..=u8::MAX).map(|key| key ^ flip) {
        let end = start + totals[usize::from(byte)] as usize;
        bytes.fill_then_anything(start..end, byte);
        start = end;
    }
}

/// Where the digits start that have all the bits in which some keys differ, the least significant first.
struct Digits {
    shifts: [u32; 8],
    count: usize,
}

impl Digits {
    fn covering(mut varying: u64, buckets: u64) -> Digits {
        let (mut shifts, mut count) = ([0; _], 0);
        while varying != 0 {
            shifts[count] = varying.trailing_zeros();
            varying &= !((buckets - 1) << shifts[count]);
            count += 1;
        }
        Digits { shifts, count }
    }
}

/// From the number of keys in each bucket to where it starts.
#[inline(always)]
fn accumulate(counts: &mut [u32]) {
    let mut total = 0;
    for count in counts {
        total += core::mem::replace(count, total);
    }
}

/// A stable pass for each digit, which counts for the next one on the way. There are fewer than 2^32 keys.
#[inline(never)]
fn radix_sort<K: Bits, const BUCKETS: usize>(
    keys: &mut [K],
    digits: &Digits,
    target: BufferSlice<'_, K>,
    decoder: Decoder,
) -> Result<(), AllocError> {
    let digit = |key: K, shift: u32| (key.into() >> shift) as usize % BUCKETS;
    let shifts = &digits.shifts[..digits.count];
    let mut scratch = K::try_zeroed_vec(if shifts.len() > 1 { keys.len() } else { 0 })?;
    let (mut from, mut to) = (keys, &mut *scratch);
    let (mut counts, mut next_counts) = (&mut [0u32; BUCKETS], &mut [0u32; BUCKETS]);
    for &key in &*from {
        counts[digit(key, shifts[0])] += 1;
    }
    for &[shift, next_shift] in shifts.array_windows() {
        accumulate(counts);
        for &key in &*from {
            let index = &mut counts[digit(key, shift)];
            to[*index as usize] = key;
            *index += 1;
            next_counts[digit(key, next_shift)] += 1;
        }
        counts.fill(0);
        core::mem::swap(&mut from, &mut to);
        core::mem::swap(&mut counts, &mut next_counts);
    }
    accumulate(counts);
    let shift = shifts[shifts.len() - 1];
    for &key in &*from {
        let index = &mut counts[digit(key, shift)];
        target.set(*index as usize, decoder.decode(key));
        *index += 1;
    }
    Ok(())
}

/// By a sample. Comparing is quick then.
fn has_few_distinct<K: Bits>(keys: &[K]) -> bool {
    const SAMPLES: usize = 32;
    let (mut seen, mut count) = ([K::default(); 4], 0);
    for &key in keys.iter().step_by(keys.len() / SAMPLES) {
        if !seen[..count].contains(&key) {
            let Some(slot) = seen.get_mut(count) else {
                return false;
            };
            *slot = key;
            count += 1;
        }
    }
    true
}

const NARROW: usize = 1 << 8;
const WIDE: usize = 1 << 11;
/// Below these lengths, comparing takes less time than so many passes.
const MIN_LENGTH_FOR_NARROW: [usize; 9] = [usize::MAX, 96, 128, 256, 400, 800, 1600, 4096, 8192];
const MIN_LENGTH_FOR_WIDE: [usize; 7] = [usize::MAX, 512, 1024, 2048, 2048, 3072, 4096];
/// From here on so many buckets are more than the caches keep track of.
const MAX_SIZE_FOR_WIDE: usize = 3 << 20;

/// False, having changed nothing, if that is not the way.
fn try_radix_sort<K: Bits>(keys: &mut [K], target: BufferSlice<'_, K>, decoder: Decoder) -> bool {
    let length = keys.len();
    if !(MIN_LENGTH_FOR_NARROW[1]..=u32::MAX as usize).contains(&length) || has_few_distinct(keys) {
        return false;
    }
    let first = keys[0];
    let varying = (keys.iter()).fold(K::default(), |bits, &key| bits | key ^ first);
    let varying = varying.into();
    let (narrow, wide) = (
        Digits::covering(varying, NARROW as u64),
        Digits::covering(varying, WIDE as u64),
    );
    if wide.count < narrow.count
        && length >= MIN_LENGTH_FOR_WIDE[wide.count]
        && size_of_val(keys) <= MAX_SIZE_FOR_WIDE
    {
        return radix_sort::<K, WIDE>(keys, &wide, target, decoder).is_ok();
    }
    length >= MIN_LENGTH_FOR_NARROW[narrow.count]
        && radix_sort::<K, NARROW>(keys, &narrow, target, decoder).is_ok()
}

#[inline(never)]
fn sort_keys<K: Bits>(keys: &mut [K], target: BufferSlice<'_, K>, decoder: Decoder) {
    if size_of::<K>() == 1 || !try_radix_sort(keys, target, decoder) {
        keys.sort_unstable();
        target.map_ascending_from(BufferSlice::from(keys), |key| decoder.decode(key));
    }
}

/// Where an element goes depends on one reading of the memory, whatever another thread does meanwhile.
fn sort_numerically<T: Element>(elements: BufferSlice<'_, T>) -> Result<(), AllocError> {
    const ON_STACK: usize = 128;
    const MIN_LENGTH_FOR_COUNTING: usize = 128;
    let (length, decoder) = (elements.len(), const { Decoder::of(T::TYPE) });
    if elements.is_known_to_be_sorted() {
        return Ok(());
    }
    if size_of::<T>() == 1 && (MIN_LENGTH_FOR_COUNTING..=u32::MAX as usize).contains(&length) {
        counting_sort(elements.bytes(), decoder.with_top_bit as u8);
    } else if length <= ON_STACK {
        let keys = &mut [T::Bits::default(); ON_STACK][..length];
        BufferSlice::from(&mut *keys).map_ascending_from(elements, key_of);
        sort_keys(keys, elements.bits(), decoder);
    } else {
        let mut keys = elements.try_map_to_vec(key_of)?;
        sort_keys(&mut keys, elements.bits(), decoder);
    }
    Ok(())
}

/// Whether arithmetic puts the elements in the order of `sort_numerically`, and tells apart those that differ.
fn has_only_ordinary_numbers(cx: &mut Cx, array: &JsTypedArray) -> bool {
    let is_ordinary = |number: f64| !number.is_nan() && number.to_bits() != (-0.0f64).to_bits();
    with_element_type!(array.element_type(),
        T => array.typed::<T>().elements(&cx.no_gc()).iter().all(|it| is_ordinary(it.convert())),
        bigint => false
    )
}

fn sort_in_place(cx: &mut Cx, array: &JsTypedArray, comparator: Value) -> JsResult<()> {
    let is_descending = if comparator.is_undefined() {
        Some(false)
    } else if array.length() >= MIN_LENGTH_TO_AVOID_CALLS {
        orders_numbers_descending(cx, comparator)?.filter(|_| has_only_ordinary_numbers(cx, array))
    } else {
        None
    };
    let Some(is_descending) = is_descending else {
        let (length, mut values) = (array.length(), ValueVec::new());
        cx.or_out_of_memory(values.try_reserve(length))?;
        for index in 0..length {
            values.push(array.get_element(cx, index).unwrap_or_default());
        }
        sort_by_calling(cx, &mut values, comparator)?;
        return array.set_values(cx, 0, &values);
    };
    let result = with_element_type!(array.element_type(), T => {
        let no_gc = cx.no_gc();
        let elements = array.typed::<T>().elements(&no_gc);
        let result = sort_numerically(elements);
        if is_descending {
            elements.bits().reverse();
        }
        result
    });
    cx.or_out_of_memory(result)
}

fn check_comparator(cx: &Cx, comparator: Value, message: &'static str) -> JsResult<()> {
    if !comparator.is_undefined() && !comparator.is_callable() {
        return Err(cx.throw_type_error(message));
    }
    Ok(())
}

#[native_abi]
pub(super) fn sort(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, comparator) = (this_array(cx, frame)?, frame.argument(0));
    let message =
        "TypedArray.prototype.sort requires the comparator argument to be a function or undefined";
    check_comparator(cx, comparator, message)?;
    this.validate(cx)?;
    sort_in_place(cx, &this, comparator)?;
    Ok(this.into())
}

#[native_abi]
pub(super) fn to_sorted(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, comparator) = (this_array(cx, frame)?, frame.argument(0));
    let message = "TypedArray.prototype.toSorted requires the comparator argument to be a function or undefined";
    check_comparator(cx, comparator, message)?;
    let length = this.validate(cx)?;
    let result = JsTypedArray::from_typed_array(cx, default_shape(cx, &this), &this, length)?;
    sort_in_place(cx, &result, comparator)?;
    Ok(result.into())
}
