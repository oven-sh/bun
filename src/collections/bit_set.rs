//! This file defines several variants of bit sets.  A bit set
//! is a densely stored set of integers with a known maximum,
//! in which each integer gets a single bit.  Bit sets have very
//! fast presence checks, update operations, and union and intersection
//! operations.  However, if the number of possible items is very
//! large and the number of actual items in a given set is usually
//! small, they may be less memory efficient than an array set.
//!
//! There are three variants defined here:
//!
//! IntegerBitSet:
//!   A bit set with static size, which is backed by a single integer.
//!   This set is good for sets with a small size, but may generate
//!   inefficient code for larger sets, especially in debug mode.
//!
//! ArrayBitSet:
//!   A bit set with static size, which is backed by an array of usize.
//!   This set is good for sets with a larger size, but may use
//!   more bytes than necessary if your set is small.
//!
//! DynamicBitSet:
//!   A bit set with runtime-known size, backed by an allocated slice
//!   of usize.

use core::mem;
use core::ops::{Deref, DerefMut};

use bun_alloc::AllocError;

// ───────────────────────────── helpers ─────────────────────────────

/// Returns `usize::MAX` if `value`, else `0`.
#[inline(always)]
const fn bool_mask_usize(value: bool) -> usize {
    if value { usize::MAX } else { 0 }
}

/// `1 << (index % usize::BITS)` — selects the bit within a `usize` word.
/// Shared by `ArrayBitSet` and `DynamicBitSet`.
#[inline(always)]
const fn word_mask_bit(index: usize) -> usize {
    1usize << ((index as u32) & (usize::BITS - 1)) // @truncate
}

/// `index / usize::BITS` — selects which `usize` word holds the bit.
/// Shared by `ArrayBitSet` and `DynamicBitSet`.
#[inline(always)]
const fn word_mask_index(index: usize) -> usize {
    index >> usize::BITS.trailing_zeros()
}

/// Shared multi-mask implementation of `set_range_value` over `&mut [usize]`
/// storage. Used by both `ArrayBitSet` and `DynamicBitSet` so the
/// per-word range masking logic lives in one place.
#[inline]
fn set_range_value_masks(masks: &mut [usize], range: Range, value: bool) {
    const MASK_LEN: u32 = usize::BITS;
    if range.start == range.end {
        return;
    }

    let start_mask_index = word_mask_index(range.start);
    let start_bit = (range.start as u32) & (MASK_LEN - 1); // @truncate

    let end_mask_index = word_mask_index(range.end);
    let end_bit = (range.end as u32) & (MASK_LEN - 1); // @truncate

    if start_mask_index == end_mask_index {
        let mut mask1 = bool_mask_usize(true) << start_bit;
        let mut mask2 = bool_mask_usize(true) >> ((MASK_LEN - 1) - (end_bit - 1));
        masks[start_mask_index] &= !(mask1 & mask2);

        mask1 = bool_mask_usize(value) << start_bit;
        mask2 = bool_mask_usize(value) >> ((MASK_LEN - 1) - (end_bit - 1));
        masks[start_mask_index] |= mask1 & mask2;
    } else {
        let bulk_mask_index: usize = if start_bit > 0 {
            masks[start_mask_index] = (masks[start_mask_index]
                & !(bool_mask_usize(true) << start_bit))
                | (bool_mask_usize(value) << start_bit);
            start_mask_index + 1
        } else {
            start_mask_index
        };

        for mask in &mut masks[bulk_mask_index..end_mask_index] {
            *mask = bool_mask_usize(value);
        }

        if end_bit > 0 {
            masks[end_mask_index] = (masks[end_mask_index] & (bool_mask_usize(true) << end_bit))
                | (bool_mask_usize(value) >> ((MASK_LEN - 1) - (end_bit - 1)));
        }
    }
}

// ───────────────────────────── IntegerBitSet ─────────────────────────────

/// A bit set with static size, which is backed by a single integer.
/// This set is good for sets with a small size, but may generate
/// inefficient code for larger sets, especially in debug mode.
///
// Backed by `usize`; requires `SIZE <= usize::BITS` (misuse surfaces via
// `FULL_MASK` saturation + debug asserts).
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct IntegerBitSet<const SIZE: usize> {
    /// The bit mask, as a single integer
    pub mask: usize,
}

impl<const SIZE: usize> IntegerBitSet<SIZE> {
    /// The number of items in this bit set
    pub(crate) const BIT_LENGTH: usize = SIZE;

    const FULL_MASK: usize = if SIZE as u32 >= usize::BITS {
        // SIZE > usize::BITS is a caller error (use ArrayBitSet); saturating
        // here avoids a const-eval shift-overflow at monomorphization time so
        // the misuse surfaces as a runtime debug_assert instead.
        usize::MAX
    } else {
        (1usize << (SIZE as u32)) - 1
    };

    /// Creates a bit set with no elements present.
    pub const fn init_empty() -> Self {
        Self { mask: 0 }
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub fn is_set(self, index: usize) -> bool {
        debug_assert!(index < Self::BIT_LENGTH);
        (self.mask & Self::mask_bit(index)) != 0
    }

    /// Returns the total number of set bits in this bit set.
    pub const fn count(self) -> usize {
        self.mask.count_ones() as usize
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        self.mask |= Self::mask_bit(index);
    }

    /// Changes the value of all bits in the specified range to
    /// match the passed boolean.
    pub fn set_range_value(&mut self, range: Range, value: bool) {
        debug_assert!(range.end <= Self::BIT_LENGTH);
        debug_assert!(range.start <= range.end);
        if range.start == range.end {
            return;
        }
        if SIZE == 0 {
            return;
        }

        let start_bit = u32::try_from(range.start).expect("int cast");

        let mut mask = bool_mask_usize(true) << start_bit;
        if range.end != Self::BIT_LENGTH {
            let end_bit = u32::try_from(range.end).expect("int cast");
            // `~0 >> (usize::BITS - end_bit)` yields the low `end_bit` bits.
            mask &= bool_mask_usize(true) >> (usize::BITS - end_bit);
        }
        // also clear bits above SIZE since the backing `usize` may be wider than SIZE bits
        mask &= Self::FULL_MASK;
        self.mask &= !mask;

        let mut mask = bool_mask_usize(value) << start_bit;
        if range.end != Self::BIT_LENGTH {
            let end_bit = u32::try_from(range.end).expect("int cast");
            mask &= bool_mask_usize(value) >> (usize::BITS - end_bit);
        }
        mask &= Self::FULL_MASK;
        self.mask |= mask;
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        // Workaround for #7953
        if SIZE == 0 {
            return;
        }
        self.mask &= !Self::mask_bit(index);
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        self,
    ) -> SingleWordIterator<SIZE, DIR_FWD> {
        SingleWordIterator {
            bits_remain: if KIND_SET {
                self.mask
            } else {
                !self.mask & Self::FULL_MASK
            },
        }
    }

    /// Iterate indices of set bits in ascending order.
    /// Convenience wrapper for `iterator::<true, true>()`.
    #[inline]
    pub fn iter_set(self) -> SingleWordIterator<SIZE, true> {
        self.iterator::<true, true>()
    }

    #[inline(always)]
    fn mask_bit(index: usize) -> usize {
        if SIZE == 0 {
            return 0;
        }
        1usize << index
    }
}

/// Iterator over a single-word `IntegerBitSet`.
pub struct SingleWordIterator<const SIZE: usize, const DIR_FWD: bool> {
    // all bits which have not yet been iterated over
    bits_remain: usize,
}

impl<const SIZE: usize, const DIR_FWD: bool> SingleWordIterator<SIZE, DIR_FWD> {
    /// Returns the index of the next unvisited set bit
    /// in the bit set, in ascending order.
    pub fn next(&mut self) -> Option<usize> {
        if self.bits_remain == 0 {
            return None;
        }

        if DIR_FWD {
            let next_index = self.bits_remain.trailing_zeros() as usize;
            self.bits_remain &= self.bits_remain - 1;
            Some(next_index)
        } else {
            let leading_zeroes = self.bits_remain.leading_zeros();
            let top_bit = (usize::BITS - 1 - leading_zeroes) as usize;
            self.bits_remain &= (1usize << top_bit) - 1;
            Some(top_bit)
        }
    }
}

// ───────────────────────────── ArrayBitSet ─────────────────────────────

/// Number of `usize` masks needed to hold `bit_length` bits.
#[inline(always)]
pub const fn num_masks_for(bit_length: usize) -> usize {
    bit_length.div_ceil(usize::BITS as usize)
}

/// A set of byte values that takes 32 bytes. Works as a `const` or a `static`.
pub type ByteSet = ArrayBitSet<256, { num_masks_for(256) }>;

impl ByteSet {
    pub const fn of(bytes: &[u8]) -> ByteSet {
        let (mut set, mut i) = (ByteSet::init_empty(), 0);
        while i < bytes.len() {
            set.set(bytes[i] as usize);
            i += 1;
        }
        set
    }

    /// Also adds `first..=last`.
    pub const fn with_range(mut self, first: u8, last: u8) -> ByteSet {
        let mut byte = first as usize;
        while byte <= last as usize {
            self.set(byte);
            byte += 1;
        }
        self
    }

    #[inline]
    pub const fn has(&self, byte: u8) -> bool {
        self.is_set(byte as usize)
    }
}

/// A bit set with static size, which is backed by an array of usize.
/// This set is good for sets with a larger size, but may use
/// more bytes than necessary if your set is small.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ArrayBitSet<const SIZE: usize, const NUM_MASKS: usize> {
    /// The bit masks, ordered with lower indices first.
    /// Padding bits at the end are undefined.
    pub(crate) masks: [usize; NUM_MASKS],
}

impl<const SIZE: usize, const NUM_MASKS: usize> ArrayBitSet<SIZE, NUM_MASKS> {
    /// The number of items in this bit set
    pub(crate) const BIT_LENGTH: usize = SIZE;

    /// The integer type used to represent a mask in this bit set
    // type MaskInt = usize (inherent assoc → inline usize)

    /// The integer type used to shift a mask in this bit set
    // type ShiftInt = u32 (inherent assoc → inline u32)

    // bits in one mask
    const MASK_LEN: u32 = usize::BITS;
    // total number of masks
    const _ASSERT: () = assert!(
        NUM_MASKS == num_masks_for(SIZE),
        "ArrayBitSet: NUM_MASKS must equal num_masks_for(SIZE)"
    );
    // padding bits in the last mask (may be 0)
    const LAST_PAD_BITS: u32 = (Self::MASK_LEN as usize * NUM_MASKS - SIZE) as u32;
    /// Mask of valid bits in the last mask.
    /// All functions will ensure that the invalid
    /// bits in the last mask are zero.
    pub(crate) const LAST_ITEM_MASK: usize = usize::MAX >> Self::LAST_PAD_BITS;

    /// Creates a bit set with no elements present.
    pub const fn init_empty() -> Self {
        Self {
            masks: [0usize; NUM_MASKS],
        }
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub const fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return false; // doesn't compile in this case
        }
        (self.masks[word_mask_index(index)] & word_mask_bit(index)) != 0
    }

    /// Returns the total number of set bits in this bit set.
    pub(crate) fn count(&self) -> usize {
        let mut total: usize = 0;
        for mask in self.masks {
            total += mask.count_ones() as usize;
        }
        total
    }

    /// Adds a specific bit to the bit set
    pub const fn set(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        self.masks[word_mask_index(index)] |= word_mask_bit(index);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        self.masks[word_mask_index(index)] &= !word_mask_bit(index);
    }

    /// Sets all bits
    pub(crate) fn set_all(&mut self, value: bool) {
        self.masks.fill(if value { usize::MAX } else { 0 });

        // Zero the padding bits
        if NUM_MASKS > 0 {
            self.masks[NUM_MASKS - 1] &= Self::LAST_ITEM_MASK;
        }
    }

    /// Performs a union of two bit sets, and stores the
    /// result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in either input.
    pub fn set_union(&mut self, other: &Self) {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (mask, alt) in self.masks.iter_mut().zip(other.masks.iter()) {
            *mask |= *alt;
        }
    }

    /// Returns true iff the first bit set is the subset of the second one.
    pub(crate) fn subset_of(&self, other: &Self) -> bool {
        self.masks
            .iter()
            .zip(other.masks.iter())
            .all(|(a, b)| a & b == *a)
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub(crate) fn find_first_set(&self) -> Option<usize> {
        let mut offset: usize = 0;
        let mask = 'brk: {
            for mask in self.masks {
                if mask != 0 {
                    break 'brk mask;
                }
                offset += Self::MASK_LEN as usize;
            }
            return None;
        };
        Some(offset + mask.trailing_zeros() as usize)
    }

    pub(crate) fn has_intersection(&self, other: &Self) -> bool {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (a, b) in self.masks.iter().zip(other.masks.iter()) {
            if a & b != 0 {
                return true;
            }
        }
        false
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.
    pub(crate) fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
    ) -> BitSetIterator<'_, KIND_SET, DIR_FWD> {
        BitSetIterator::init(&self.masks, Self::LAST_ITEM_MASK)
    }

    /// Iterate indices of set bits in ascending order.
    #[inline]
    pub fn iter_set(&self) -> BitSetIterator<'_, true, true> {
        self.iterator::<true, true>()
    }
}

// ───────────────────────────── DynamicBitSet ─────────────────────────────

/// A bit set of runtime-known size. Sets that are copied or combined must be the same length.
#[derive(Default)]
pub struct DynamicBitSet<Masks = Box<[usize]>> {
    /// The number of valid items in this bit set
    bit_length: usize,
    /// The bit masks, ordered with lower indices first. Padding bits at the end must be zeroed.
    masks: Masks,
}

/// The bits of the last mask that are not padding.
#[inline(always)]
const fn last_item_mask(bit_length: usize) -> usize {
    usize::MAX >> (bit_length.wrapping_neg() % usize::BITS as usize)
}

impl DynamicBitSet {
    /// Creates a bit set with no elements present.
    #[inline(never)]
    pub fn init_empty(bit_length: usize) -> Result<Self, AllocError> {
        let mut this = Self::default();
        this.resize(bit_length, false)?;
        Ok(this)
    }

    /// Resizes to a new bit_length.  If the new length is larger
    /// than the old length, fills any added bits with `fill`.
    pub fn resize(&mut self, new_len: usize, fill: bool) -> Result<(), AllocError> {
        if fill
            && new_len > self.bit_length
            && let Some(last) = self.masks.last_mut()
        {
            *last |= !last_item_mask(self.bit_length);
        }
        let new_masks = num_masks_for(new_len);
        let mut masks = mem::take(&mut self.masks).into_vec();
        let reserved = masks.try_reserve_exact(new_masks.saturating_sub(masks.len()));
        if reserved.is_ok() {
            masks.resize(new_masks, bool_mask_usize(fill));
            self.bit_length = new_len;
        }
        self.masks = masks.into_boxed_slice();
        self.clear_padding();
        reserved.map_err(|_| AllocError)
    }

    pub fn clone(&self) -> Result<Self, AllocError> {
        let mut masks = Vec::new();
        masks
            .try_reserve_exact(self.masks.len())
            .map_err(|_| AllocError)?;
        masks.extend_from_slice(&self.masks);
        Ok(Self {
            bit_length: self.bit_length,
            masks: masks.into_boxed_slice(),
        })
    }

    /// Inverse of `bytes()`. Clears the padding bits, so `bytes` can be untrusted.
    pub fn from_bytes(bit_length: usize, bytes: &[u8]) -> Result<Option<Self>, AllocError> {
        let mut set = Self::init_empty(bit_length)?;
        if bytes.len() != mem::size_of_val(&*set.masks) {
            return Ok(None);
        }
        bun_core::cast_slice_mut::<usize, u8>(&mut set.masks).copy_from_slice(bytes);
        set.clear_padding();
        Ok(Some(set))
    }
}

impl<Masks: Deref<Target = [usize]>> DynamicBitSet<Masks> {
    /// Returns the number of bits in this bit set
    #[inline(always)]
    pub fn bit_length(&self) -> usize {
        self.bit_length
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < self.bit_length);
        (self.masks[word_mask_index(index)] & word_mask_bit(index)) != 0
    }

    pub fn is_set_allow_out_of_bound(&self, index: usize, out_of_bounds: bool) -> bool {
        if index >= self.bit_length {
            return out_of_bounds;
        }
        self.is_set(index)
    }

    pub fn bytes(&self) -> &[u8] {
        bun_core::cast_slice::<usize, u8>(&self.masks)
    }

    /// Returns the total number of set bits in this bit set.
    pub fn count(&self) -> usize {
        let mut total: usize = 0;
        for mask in self.masks.iter() {
            // Note: This is where we depend on padding bits being zero
            total += mask.count_ones() as usize;
        }
        total
    }

    pub(crate) fn has_intersection(
        &self,
        other: &DynamicBitSet<impl Deref<Target = [usize]>>,
    ) -> bool {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (a, b) in self.masks.iter().zip(other.masks.iter()) {
            if (a & b) != 0 {
                return true;
            }
        }
        false
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub(crate) fn find_first_set(&self) -> Option<usize> {
        let mut offset: usize = 0;
        for &mask in self.masks.iter() {
            if mask != 0 {
                return Some(offset + mask.trailing_zeros() as usize);
            }
            offset += usize::BITS as usize;
        }
        None
    }

    /// Returns true iff every corresponding bit in both
    /// bit sets are the same.
    pub fn eql(&self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) -> bool {
        self.bit_length == other.bit_length && *self.masks == *other.masks
    }

    /// Returns true iff the first bit set is the subset
    /// of the second one.
    pub fn subset_of(&self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) -> bool {
        if self.bit_length != other.bit_length {
            return false;
        }
        for (&a, &b) in self.masks.iter().zip(other.masks.iter()) {
            if a & b != a {
                return false;
            }
        }
        true
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
    ) -> BitSetIterator<'_, KIND_SET, DIR_FWD> {
        BitSetIterator::init(&self.masks, last_item_mask(self.bit_length))
    }
}

impl<Masks: DerefMut<Target = [usize]>> DynamicBitSet<Masks> {
    #[inline(always)]
    fn clear_padding(&mut self) {
        if let Some(last) = self.masks.last_mut() {
            *last &= last_item_mask(self.bit_length);
        }
    }

    #[inline(always)]
    fn zip_masks(
        &mut self,
        other: &DynamicBitSet<impl Deref<Target = [usize]>>,
        f: impl Fn(usize, usize) -> usize,
    ) {
        debug_assert!(other.bit_length == self.bit_length);
        for (a, &b) in self.masks.iter_mut().zip(other.masks.iter()) {
            *a = f(*a, b);
        }
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks[word_mask_index(index)] |= word_mask_bit(index);
    }

    /// Changes the value of all bits in the specified range to `value`.
    pub fn set_range_value(&mut self, range: Range, value: bool) {
        debug_assert!(range.end <= self.bit_length);
        debug_assert!(range.start <= range.end);
        set_range_value_masks(&mut self.masks, range, value);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks[word_mask_index(index)] &= !word_mask_bit(index);
    }

    pub fn set_all(&mut self, value: bool) {
        self.masks.fill(bool_mask_usize(value));
        self.clear_padding();
    }

    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        for mask in self.masks.iter_mut() {
            *mask = !*mask;
        }
        self.clear_padding();
    }

    pub fn copy_from(&mut self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) {
        debug_assert!(other.bit_length == self.bit_length);
        self.masks.copy_from_slice(&other.masks);
    }

    pub fn set_union(&mut self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) {
        self.zip_masks(other, |a, b| a | b);
    }

    pub fn set_intersection(&mut self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) {
        self.zip_masks(other, |a, b| a & b);
    }

    pub fn set_exclude(&mut self, other: &DynamicBitSet<impl Deref<Target = [usize]>>) {
        self.zip_masks(other, |a, b| a & !b);
    }
}

/// Single buffer for multiple bitsets of equal length.
pub struct DynamicBitSetList {
    buf: Box<[usize]>,
    bit_length: u32,
}

impl DynamicBitSetList {
    pub fn init_empty(n: usize, bit_length: u32) -> Result<Self, AllocError> {
        let buf = Box::try_new_zeroed_slice(num_masks_for(bit_length as usize) * n)
            .map_err(|_| AllocError)?;
        Ok(Self {
            // SAFETY: zero is a valid `usize`.
            buf: unsafe { buf.assume_init() },
            bit_length,
        })
    }

    fn row(&self, i: u32) -> core::ops::Range<usize> {
        let len = num_masks_for(self.bit_length as usize);
        len * i as usize..len * i as usize + len
    }

    pub fn at(&self, i: u32) -> DynamicBitSet<&[usize]> {
        DynamicBitSet {
            bit_length: self.bit_length as usize,
            masks: &self.buf[self.row(i)],
        }
    }

    pub fn at_mut(&mut self, i: u32) -> DynamicBitSet<&mut [usize]> {
        let row = self.row(i);
        DynamicBitSet {
            bit_length: self.bit_length as usize,
            masks: &mut self.buf[row],
        }
    }
}

// ───────────────────────────── AutoBitSet ─────────────────────────────

/// Two masks, so that `AutoBitSet` is three words.
const AUTO_STATIC_BITS: usize = 2 * usize::BITS as usize - 1;

pub(crate) type AutoBitSetStatic =
    ArrayBitSet<AUTO_STATIC_BITS, { num_masks_for(AUTO_STATIC_BITS) }>;

pub enum AutoBitSet {
    Static(AutoBitSetStatic),
    Dynamic(DynamicBitSet),
}

const _: () = assert!(size_of::<AutoBitSet>() == 3 * size_of::<usize>());

// ─── two-arm forward helper ────────────────────────────────────────────
// This macro forwards a call to whichever arm is active and is applied to
// every method whose Static/Dynamic arms are textually identical.
macro_rules! auto_forward {
    ($self:expr, |$b:ident| $body:expr) => {
        match $self {
            AutoBitSet::Static($b) => $body,
            AutoBitSet::Dynamic($b) => $body,
        }
    };
}

impl AutoBitSet {
    #[inline(always)]
    pub fn needs_dynamic(bit_length: usize) -> bool {
        bit_length > AutoBitSetStatic::BIT_LENGTH
    }

    pub fn init_empty(bit_length: usize) -> Result<AutoBitSet, AllocError> {
        if bit_length <= AutoBitSetStatic::BIT_LENGTH {
            Ok(AutoBitSet::Static(AutoBitSetStatic::init_empty()))
        } else {
            Ok(AutoBitSet::Dynamic(DynamicBitSet::init_empty(bit_length)?))
        }
    }

    pub fn is_set(&self, index: usize) -> bool {
        auto_forward!(self, |b| b.is_set(index))
    }

    /// Are any of the bits in `this` also set in `other`?
    pub fn has_intersection(&self, other: &AutoBitSet) -> bool {
        match (self, other) {
            (AutoBitSet::Static(a), AutoBitSet::Static(b)) => a.has_intersection(b),
            (AutoBitSet::Dynamic(a), AutoBitSet::Dynamic(b)) => a.has_intersection(b),
            _ => false,
        }
    }

    pub fn clone(&self) -> Result<AutoBitSet, AllocError> {
        match self {
            AutoBitSet::Static(s) => Ok(AutoBitSet::Static(*s)),
            AutoBitSet::Dynamic(d) => Ok(AutoBitSet::Dynamic(d.clone()?)),
        }
    }

    pub fn set(&mut self, index: usize) {
        auto_forward!(self, |b| b.set(index))
    }

    pub fn unset(&mut self, index: usize) {
        auto_forward!(self, |b| b.unset(index))
    }

    /// `self |= other`. Both sets must have the same arm (same bit length).
    pub fn set_union(&mut self, other: &AutoBitSet) {
        match (self, other) {
            (AutoBitSet::Static(a), AutoBitSet::Static(b)) => a.set_union(b),
            (AutoBitSet::Dynamic(a), AutoBitSet::Dynamic(b)) => a.set_union(b),
            _ => unreachable!("AutoBitSet::set_union: mismatched bit lengths"),
        }
    }

    /// Is every bit of `self` also set in `other`?
    pub fn subset_of(&self, other: &AutoBitSet) -> bool {
        match (self, other) {
            (AutoBitSet::Static(a), AutoBitSet::Static(b)) => a.subset_of(b),
            (AutoBitSet::Dynamic(a), AutoBitSet::Dynamic(b)) => a.subset_of(b),
            _ => unreachable!("AutoBitSet::subset_of: mismatched bit lengths"),
        }
    }

    pub(crate) fn raw_bytes(&self) -> &[u8] {
        bun_core::cast_slice::<usize, u8>(self.words())
    }

    pub fn bytes(&self, _: usize) -> &[u8] {
        self.raw_bytes()
    }

    /// The backing words (bit `i` is `words()[i / usize::BITS] >> (i % usize::BITS) & 1`);
    /// bits past the length are zero.
    pub fn words(&self) -> &[usize] {
        auto_forward!(self, |b| &b.masks)
    }

    pub fn eql(&self, b: &AutoBitSet) -> bool {
        self.raw_bytes() == b.raw_bytes()
    }

    pub fn for_each<Ctx>(&self, ctx: &mut Ctx, function: fn(&mut Ctx, usize)) {
        let mut iter = self.iterator::<true, true>();
        while let Some(index) = iter.next() {
            function(ctx, index);
        }
    }

    pub fn set_all(&mut self, value: bool) {
        auto_forward!(self, |b| b.set_all(value))
    }

    pub fn count(&self) -> usize {
        auto_forward!(self, |b| b.count())
    }

    pub fn find_first_set(&self) -> Option<usize> {
        auto_forward!(self, |b| b.find_first_set())
    }

    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
    ) -> AutoBitSetIterator<'_, KIND_SET, DIR_FWD> {
        auto_forward!(self, |b| b.iterator::<KIND_SET, DIR_FWD>())
    }
}

// Both enum arms already produce the SAME concrete `BitSetIterator<'a,K,D>`
// (see ArrayBitSet::iterator / DynamicBitSet::iterator), so the
// wrapper enum was a no-op layer of indirection. Keep the public name as a
// type alias for any external callers.
pub(crate) type AutoBitSetIterator<'a, const KIND_SET: bool, const DIR_FWD: bool> =
    BitSetIterator<'a, KIND_SET, DIR_FWD>;

// ───────────────────────────── BitSetIterator ─────────────────────────────

// The iterator is reusable between several bit set types.
pub struct BitSetIterator<'a, const KIND_SET: bool, const DIR_FWD: bool> {
    // all bits which have not yet been iterated over
    bits_remain: usize,
    // all words which have not yet been iterated over
    words_remain: &'a [usize],
    // the offset of the current word
    bit_offset: usize,
    // the mask of the last word
    last_word_mask: usize,
}

impl<'a, const KIND_SET: bool, const DIR_FWD: bool> BitSetIterator<'a, KIND_SET, DIR_FWD> {
    fn init(masks: &'a [usize], last_word_mask: usize) -> Self {
        if masks.is_empty() {
            Self {
                bits_remain: 0,
                words_remain: &[],
                last_word_mask,
                bit_offset: 0,
            }
        } else {
            let mut result = Self {
                bits_remain: 0,
                words_remain: masks,
                last_word_mask,
                bit_offset: if DIR_FWD {
                    0
                } else {
                    (masks.len() - 1) * usize::BITS as usize
                },
            };
            result.next_word::<true>();
            result
        }
    }

    /// Returns the index of the next unvisited set bit
    /// in the bit set, in ascending order.
    pub fn next(&mut self) -> Option<usize> {
        while self.bits_remain == 0 {
            if self.words_remain.is_empty() {
                return None;
            }
            self.next_word::<false>();
            if DIR_FWD {
                self.bit_offset += usize::BITS as usize
            } else {
                self.bit_offset -= usize::BITS as usize
            }
        }

        if DIR_FWD {
            let next_index = self.bits_remain.trailing_zeros() as usize + self.bit_offset;
            self.bits_remain &= self.bits_remain - 1;
            Some(next_index)
        } else {
            let leading_zeroes = self.bits_remain.leading_zeros();
            let top_bit = (usize::BITS - 1 - leading_zeroes) as usize;
            self.bits_remain &= (1usize << top_bit) - 1;
            Some(top_bit + self.bit_offset)
        }
    }

    // Load the next word.  Don't call this if there
    // isn't a next word.  If the next word is the
    // last word, mask off the padding bits so we
    // don't visit them.
    #[inline(always)]
    fn next_word<const IS_FIRST_WORD: bool>(&mut self) {
        let mut word = if DIR_FWD {
            self.words_remain[0]
        } else {
            self.words_remain[self.words_remain.len() - 1]
        };
        if !KIND_SET {
            word = !word;
            if (!DIR_FWD && IS_FIRST_WORD) || (DIR_FWD && self.words_remain.len() == 1) {
                word &= self.last_word_mask;
            }
        }
        if DIR_FWD {
            self.words_remain = &self.words_remain[1..];
        } else {
            self.words_remain = &self.words_remain[..self.words_remain.len() - 1];
        }
        self.bits_remain = word;
    }
}

// ───────────────────────────── Range ─────────────────────────────

/// A range of indices within a bitset.
#[derive(Clone, Copy)]
pub struct Range {
    /// The index of the first bit of interest.
    pub start: usize,
    /// The index immediately after the last bit of interest.
    pub end: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn members(set: &DynamicBitSet<impl Deref<Target = [usize]>>) -> Vec<usize> {
        let mut iter = set.iterator::<true, true>();
        core::iter::from_fn(|| iter.next()).collect()
    }

    #[test]
    fn resize_keeps_the_bits_that_stay_and_fills_the_new_ones() {
        let lengths = [0, 1, 63, 64, 65, 127, 128, 200];
        for (from, to) in lengths.iter().flat_map(|&a| lengths.map(|b| (a, b))) {
            for fill in [false, true] {
                let mut set = DynamicBitSet::init_empty(from).unwrap();
                (0..from).step_by(3).for_each(|i| set.set(i));
                set.resize(to, fill).unwrap();
                let expected = (0..to).filter(|&i| if i < from { i % 3 == 0 } else { fill });
                assert_eq!(members(&set), expected.collect::<Vec<_>>());
                assert_eq!(set.bit_length(), to);
            }
        }
    }

    #[test]
    fn padding_stays_zero() {
        for len in [0, 1, 63, 64, 65] {
            let mut set = DynamicBitSet::init_empty(len).unwrap();
            set.set_all(true);
            assert_eq!(set.count(), len);
            set.toggle_all();
            assert_eq!(set.count(), 0);
            set.toggle_all();
            assert_eq!(set.count(), len);
        }
    }

    #[test]
    fn rows_of_a_list_are_separate() {
        let mut list = DynamicBitSetList::init_empty(3, 65).unwrap();
        list.at_mut(1).set(64);
        let mut set = DynamicBitSet::init_empty(65).unwrap();
        set.set(0);
        list.at_mut(1).set_union(&set);
        assert_eq!(
            [0, 1, 2].map(|i| members(&list.at(i))),
            [vec![], vec![0, 64], vec![]]
        );
        assert!(set.subset_of(&list.at(1)) && !set.eql(&list.at(1)));
        assert_eq!(
            DynamicBitSetList::init_empty(3, 0).unwrap().at(2).count(),
            0
        );
    }
}
