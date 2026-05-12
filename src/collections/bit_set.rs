//! This is a fork of Zig standard library bit_set.zig
//! - https://github.com/ziglang/zig/pull/14129
//! - AutoBitset which optimally chooses between a dynamic or static bitset.
//! Prefer our fork over std.bit_set.
//!
//! This file defines several variants of bit sets.  A bit set
//! is a densely stored set of integers with a known maximum,
//! in which each integer gets a single bit.  Bit sets have very
//! fast presence checks, update operations, and union and intersection
//! operations.  However, if the number of possible items is very
//! large and the number of actual items in a given set is usually
//! small, they may be less memory efficient than an array set.
//!
//! There are five variants defined here:
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
//! StaticBitSet:
//!   Picks either IntegerBitSet or ArrayBitSet depending on the requested
//!   size.  The interfaces of these two types match exactly, except for fields.
//!
//! DynamicBitSet:
//!   A bit set with runtime-known size, backed by an allocated slice
//!   of usize.
//!
//! DynamicBitSetUnmanaged:
//!   A variant of DynamicBitSet which does not store a pointer to its
//!   allocator, in order to save space.

use core::mem;
use core::ptr;
use core::slice;

use bun_alloc::AllocError;

// ───────────────────────────── helpers ─────────────────────────────

/// Equivalent to `std.math.boolMask(MaskInt, value)`: returns `~0` if `value`
/// else `0`, in the requested integer width.
#[inline(always)]
const fn bool_mask_usize(value: bool) -> usize {
    if value { usize::MAX } else { 0 }
}

/// `1 << (index % usize::BITS)` — selects the bit within a `usize` word.
/// Shared by `ArrayBitSet` and `DynamicBitSetUnmanaged` (Zig: `maskBit`).
#[inline(always)]
const fn word_mask_bit(index: usize) -> usize {
    1usize << ((index as u32) & (usize::BITS - 1)) // @truncate
}

/// `index / usize::BITS` — selects which `usize` word holds the bit.
/// Shared by `ArrayBitSet` and `DynamicBitSetUnmanaged` (Zig: `maskIndex`).
#[inline(always)]
const fn word_mask_index(index: usize) -> usize {
    index >> usize::BITS.trailing_zeros()
}

/// Shared multi-mask implementation of `set_range_value` over `&mut [usize]`
/// storage. Used by both `ArrayBitSet` and `DynamicBitSetUnmanaged` so the
/// per-word range masking logic lives in one place (Zig: `setRangeValue`).
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
        let bulk_mask_index: usize;
        if start_bit > 0 {
            masks[start_mask_index] = (masks[start_mask_index]
                & !(bool_mask_usize(true) << start_bit))
                | (bool_mask_usize(value) << start_bit);
            bulk_mask_index = start_mask_index + 1;
        } else {
            bulk_mask_index = start_mask_index;
        }

        for mask in &mut masks[bulk_mask_index..end_mask_index] {
            *mask = bool_mask_usize(value);
        }

        if end_bit > 0 {
            masks[end_mask_index] = (masks[end_mask_index] & (bool_mask_usize(true) << end_bit))
                | (bool_mask_usize(value) >> ((MASK_LEN - 1) - (end_bit - 1)));
        }
    }
}

// ───────────────────────────── StaticBitSet ─────────────────────────────

/// Returns the optimal static bit set type for the specified number
/// of elements.  The returned type will perform no allocations,
/// can be copied by value, and does not require deinitialization.
/// Both possible implementations fulfill the same interface.
///
// TODO(port): Zig's `StaticBitSet(size)` returns `IntegerBitSet(size)` when
// `size <= @bitSizeOf(usize)` and `ArrayBitSet(usize, size)` otherwise. Stable
// Rust cannot select a struct definition from a const generic. Callers should
// pick `IntegerBitSet<N>` or `ArrayBitSet<N>` directly; this alias resolves to
// the array form (always correct, possibly one word larger than needed for
// N <= 64).
pub type StaticBitSet<const SIZE: usize> = IntegerBitSet<SIZE>; // TODO(b2): callers needing >64 bits use ArrayBitSet<SIZE, {num_masks_for(SIZE)}> directly

// ───────────────────────────── IntegerBitSet ─────────────────────────────

/// A bit set with static size, which is backed by a single integer.
/// This set is good for sets with a small size, but may generate
/// inefficient code for larger sets, especially in debug mode.
///
// TODO(port): Zig uses `std.meta.Int(.unsigned, size)` for an exact-width
// backing integer (u0..u65535). Rust has no arbitrary-width ints; we back with
// `usize` and rely on `SIZE <= usize::BITS`. Phase B may swap to a trait that
// picks u8/u16/u32/u64/u128.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct IntegerBitSet<const SIZE: usize> {
    /// The bit mask, as a single integer
    pub mask: usize,
}

impl<const SIZE: usize> IntegerBitSet<SIZE> {
    /// The number of items in this bit set
    pub const BIT_LENGTH: usize = SIZE as usize;

    /// The integer type used to represent a mask in this bit set
    // TODO(port): Zig: `pub const MaskInt = std.meta.Int(.unsigned, size);`
    // type MaskInt = usize (inherent assoc → inline usize)

    /// The integer type used to shift a mask in this bit set
    // TODO(port): Zig: `pub const ShiftInt = std.math.Log2Int(MaskInt);`
    // type ShiftInt = u32 (inherent assoc → inline u32)

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

    /// Creates a bit set with all elements present.
    pub const fn init_full() -> Self {
        Self {
            mask: Self::FULL_MASK,
        }
    }

    /// Returns the number of bits in this bit set
    #[inline(always)]
    pub const fn capacity(self) -> usize {
        Self::BIT_LENGTH
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

    /// Changes the value of the specified bit of the bit
    /// set to match the passed boolean.
    pub fn set_value(&mut self, index: usize, value: bool) {
        debug_assert!(index < Self::BIT_LENGTH);
        if SIZE == 0 {
            return;
        }
        let bit = Self::mask_bit(index);
        let new_bit = bit & bool_mask_usize(value);
        self.mask = (self.mask & !bit) | new_bit;
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
            // Zig shifts a SIZE-bit MaskInt so `~0 >> (SIZE - end_bit)` yields the
            // low `end_bit` bits. With a usize backing the shift must be relative
            // to usize::BITS to get the same low-`end_bit`-bits mask.
            mask &= bool_mask_usize(true) >> (usize::BITS - end_bit);
        }
        // also clear bits above SIZE since our backing int is wider than Zig's
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

    /// Flips a specific bit in the bit set
    pub fn toggle(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        self.mask ^= Self::mask_bit(index);
    }

    /// Flips all bits in this bit set which are present
    /// in the toggles bit set.
    pub fn toggle_set(&mut self, toggles: Self) {
        self.mask ^= toggles.mask;
    }

    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        self.mask = !self.mask & Self::FULL_MASK;
    }

    /// Performs a union of two bit sets, and stores the
    /// result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in either input.
    pub fn set_union(&mut self, other: Self) {
        self.mask |= other.mask;
    }

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    pub fn set_intersection(&mut self, other: Self) {
        self.mask &= other.mask;
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub fn find_first_set(self) -> Option<usize> {
        let mask = self.mask;
        if mask == 0 {
            return None;
        }
        Some(mask.trailing_zeros() as usize)
    }

    /// Finds the index of the first unset bit.
    /// If all bits are set, returns null.
    pub fn find_first_unset(self) -> Option<usize> {
        let mask = !self.mask & Self::FULL_MASK;
        if mask == 0 {
            return None;
        }
        Some(mask.trailing_zeros() as usize)
    }

    /// Finds the index of the first set bit, and unsets it.
    /// If no bits are set, returns null.
    pub fn toggle_first_set(&mut self) -> Option<usize> {
        let mask = self.mask;
        if mask == 0 {
            return None;
        }
        let index = mask.trailing_zeros() as usize;
        self.mask = mask & (mask - 1);
        Some(index)
    }

    /// Returns true iff every corresponding bit in both
    /// bit sets are the same.
    pub fn eql(self, other: Self) -> bool {
        Self::BIT_LENGTH == 0 || self.mask == other.mask
    }

    /// Returns true iff the first bit set is the subset
    /// of the second one.
    pub fn subset_of(self, other: Self) -> bool {
        self.intersect_with(other).eql(self)
    }

    /// Returns true iff the first bit set is the superset
    /// of the second one.
    pub fn superset_of(self, other: Self) -> bool {
        other.subset_of(self)
    }

    /// Returns the complement bit sets. Bits in the result
    /// are set if the corresponding bits were not set.
    pub fn complement(self) -> Self {
        let mut result = self;
        result.toggle_all();
        result
    }

    /// Returns the union of two bit sets. Bits in the
    /// result are set if the corresponding bits were set
    /// in either input.
    pub fn union_with(self, other: Self) -> Self {
        let mut result = self;
        result.set_union(other);
        result
    }

    /// Returns the intersection of two bit sets. Bits in
    /// the result are set if the corresponding bits were
    /// set in both inputs.
    pub fn intersect_with(self, other: Self) -> Self {
        let mut result = self;
        result.set_intersection(other);
        result
    }

    /// Returns the xor of two bit sets. Bits in the
    /// result are set if the corresponding bits were
    /// not the same in both inputs.
    pub fn xor_with(self, other: Self) -> Self {
        let mut result = self;
        result.toggle_set(other);
        result
    }

    /// Returns the difference of two bit sets. Bits in
    /// the result are set if set in the first but not
    /// set in the second set.
    pub fn difference_with(self, other: Self) -> Self {
        let mut result = self;
        result.set_intersection(other.complement());
        result
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
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
    /// Convenience wrapper for `iterator::<true, true>()` (Zig's `.iterator(.{ .kind = .set })`).
    #[inline]
    pub fn iter_set(&self) -> SingleWordIterator<SIZE, true> {
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
    (bit_length + (usize::BITS as usize - 1)) / (usize::BITS as usize)
}

/// A bit set with static size, which is backed by an array of usize.
/// This set is good for sets with a larger size, but may use
/// more bytes than necessary if your set is small.
///
// TODO(port): Zig is generic over `MaskIntType`; every in-tree caller uses
// `usize`. Dropped the type parameter. Phase B can re-generify if needed.
// TODO(port): `[usize; NUM_MASKS]` requires
// `#![feature(generic_const_exprs)]`. Phase B may instead take NUM_MASKS as a
// second const generic and assert `NUM_MASKS == num_masks_for(SIZE)`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ArrayBitSet<const SIZE: usize, const NUM_MASKS: usize> {
    /// The bit masks, ordered with lower indices first.
    /// Padding bits at the end are undefined.
    pub masks: [usize; NUM_MASKS],
}

impl<const SIZE: usize, const NUM_MASKS: usize> ArrayBitSet<SIZE, NUM_MASKS> {
    /// The number of items in this bit set
    pub const BIT_LENGTH: usize = SIZE;

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
    pub const LAST_ITEM_MASK: usize = usize::MAX >> Self::LAST_PAD_BITS;

    /// Creates a bit set with no elements present.
    pub const fn init_empty() -> Self {
        Self {
            masks: [0usize; NUM_MASKS],
        }
    }

    /// Creates a bit set with all elements present.
    pub const fn init_full() -> Self {
        if NUM_MASKS == 0 {
            Self {
                masks: [0usize; NUM_MASKS],
            }
        } else {
            let mut masks = [usize::MAX; NUM_MASKS];
            masks[NUM_MASKS - 1] = Self::LAST_ITEM_MASK;
            Self { masks }
        }
    }

    /// Returns the number of bits in this bit set
    #[inline(always)]
    pub const fn capacity(&self) -> usize {
        Self::BIT_LENGTH
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return false; // doesn't compile in this case
        }
        (self.masks[word_mask_index(index)] & word_mask_bit(index)) != 0
    }

    /// Returns the total number of set bits in this bit set.
    pub fn count(&self) -> usize {
        let mut total: usize = 0;
        for mask in self.masks {
            total += mask.count_ones() as usize;
        }
        total
    }

    /// Changes the value of the specified bit of the bit
    /// set to match the passed boolean.
    pub fn set_value(&mut self, index: usize, value: bool) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        let bit = word_mask_bit(index);
        let mask_index = word_mask_index(index);
        let new_bit = bit & bool_mask_usize(value);
        self.masks[mask_index] = (self.masks[mask_index] & !bit) | new_bit;
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        self.masks[word_mask_index(index)] |= word_mask_bit(index);
    }

    /// Changes the value of all bits in the specified range to
    /// match the passed boolean.
    pub fn set_range_value(&mut self, range: Range, value: bool) {
        debug_assert!(range.end <= Self::BIT_LENGTH);
        debug_assert!(range.start <= range.end);
        if NUM_MASKS == 0 {
            return;
        }
        set_range_value_masks(&mut self.masks, range, value);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        self.masks[word_mask_index(index)] &= !word_mask_bit(index);
    }

    /// Flips a specific bit in the bit set
    pub fn toggle(&mut self, index: usize) {
        debug_assert!(index < Self::BIT_LENGTH);
        if NUM_MASKS == 0 {
            return; // doesn't compile in this case
        }
        self.masks[word_mask_index(index)] ^= word_mask_bit(index);
    }

    /// Flips all bits in this bit set which are present
    /// in the toggles bit set.
    pub fn toggle_set(&mut self, toggles: &Self) {
        debug_assert_eq!(self.masks.len(), toggles.masks.len());
        for (mask, b) in self.masks.iter_mut().zip(toggles.masks.iter()) {
            *mask ^= *b;
        }
    }

    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        for mask in self.masks.iter_mut() {
            *mask = !*mask;
        }

        // Zero the padding bits
        if NUM_MASKS > 0 {
            self.masks[NUM_MASKS - 1] &= Self::LAST_ITEM_MASK;
        }
    }

    /// Sets all bits
    pub fn set_all(&mut self, value: bool) {
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

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    pub fn set_intersection(&mut self, other: &Self) {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (mask, alt) in self.masks.iter_mut().zip(other.masks.iter()) {
            *mask &= *alt;
        }
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub fn find_first_set(&self) -> Option<usize> {
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

    /// Finds the index of the first set bit, and unsets it.
    /// If no bits are set, returns null.
    pub fn toggle_first_set(&mut self) -> Option<usize> {
        let mut offset: usize = 0;
        let mask = 'brk: {
            for mask in self.masks.iter_mut() {
                if *mask != 0 {
                    break 'brk mask;
                }
                offset += Self::MASK_LEN as usize;
            }
            return None;
        };
        let index = mask.trailing_zeros() as usize;
        *mask &= *mask - 1;
        Some(offset + index)
    }

    /// Returns true iff every corresponding bit in both
    /// bit sets are the same.
    pub fn eql(&self, other: &Self) -> bool {
        let mut i: usize = 0;
        while i < NUM_MASKS {
            if self.masks[i] != other.masks[i] {
                return false;
            }
            i += 1;
        }
        true
    }

    /// Returns true iff the first bit set is the subset
    /// of the second one.
    pub fn subset_of(&self, other: &Self) -> bool {
        self.intersect_with(other).eql(self)
    }

    /// Returns true iff the first bit set is the superset
    /// of the second one.
    pub fn superset_of(&self, other: &Self) -> bool {
        other.subset_of(self)
    }

    /// Returns the complement bit sets. Bits in the result
    /// are set if the corresponding bits were not set.
    pub fn complement(&self) -> Self {
        let mut result = *self;
        result.toggle_all();
        result
    }

    /// Returns the union of two bit sets. Bits in the
    /// result are set if the corresponding bits were set
    /// in either input.
    pub fn union_with(&self, other: &Self) -> Self {
        let mut result = *self;
        result.set_union(other);
        result
    }

    /// Returns the intersection of two bit sets. Bits in
    /// the result are set if the corresponding bits were
    /// set in both inputs.
    pub fn intersect_with(&self, other: &Self) -> Self {
        let mut result = *self;
        result.set_intersection(other);
        result
    }

    pub fn has_intersection(&self, other: &Self) -> bool {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (a, b) in self.masks.iter().zip(other.masks.iter()) {
            if a & b != 0 {
                return true;
            }
        }
        false
    }

    /// Returns the xor of two bit sets. Bits in the
    /// result are set if the corresponding bits were
    /// not the same in both inputs.
    pub fn xor_with(&self, other: &Self) -> Self {
        let mut result = *self;
        result.toggle_set(other);
        result
    }

    /// Returns the difference of two bit sets. Bits in
    /// the result are set if set in the first but not
    /// set in the second set.
    pub fn difference_with(&self, other: &Self) -> Self {
        let mut result = *self;
        result.set_intersection(&other.complement());
        result
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
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

// ──────────────────────── DynamicBitSetUnmanaged ────────────────────────

/// A bit set with runtime-known size, backed by an allocated slice
/// of usize.  The allocator must be tracked externally by the user.
///
// TODO(port): the Zig type stores `masks: [*]MaskInt` where `masks[-1]` holds
// the true allocation length (needed because Zig's allocator API requires the
// original length on free). The Rust port keeps the same layout because
// `List` constructs borrowed views into a shared buffer that must look like
// freestanding `DynamicBitSetUnmanaged`s. Phase B may refactor to `Vec<usize>`
// once `List` is reworked.
pub struct DynamicBitSetUnmanaged {
    /// The number of valid items in this bit set
    pub bit_length: usize,

    /// The bit masks, ordered with lower indices first.
    /// Padding bits at the end must be zeroed.
    pub masks: *mut usize,
    // This pointer is one usize after the actual allocation.
    // That slot holds the size of the true allocation, which
    // is needed by Zig's allocator interface in case a shrink
    // fails.
}

/// The integer type used to represent a mask in this bit set
pub type DynMaskInt = usize;
/// The integer type used to shift a mask in this bit set
pub type DynShiftInt = u32;

const DYN_MASK_BITS: u32 = usize::BITS;

// Never modified — the Zig comment about needing `static mut` was a Zig
// limitation (no const-ptr → mut-ptr cast at comptime). All writes through
// `self.masks` are guarded by `num_masks() > 0`, which is false for the empty
// sentinel (bit_length == 0). Kept in a `RacyCell` (not `.rodata`) so that
// forming a `*mut usize` to it remains a legally-mutable pointer target —
// writing through a pointer derived from an immutable `static` would be UB
// even if it never happens at runtime, and it lets `masks_slice_mut` form a
// zero-length `&mut [usize]` without provenance hazards.
static EMPTY_MASKS_DATA: bun_core::RacyCell<[usize; 2]> = bun_core::RacyCell::new([0, 0]);

#[inline(always)]
fn empty_masks_ptr() -> *mut usize {
    // SAFETY: pointer arithmetic into a static array; index 1 is in-bounds.
    // The `*mut` is never written through while pointing at this static.
    unsafe { EMPTY_MASKS_DATA.get().cast::<usize>().add(1) }
}

impl Default for DynamicBitSetUnmanaged {
    fn default() -> Self {
        Self {
            bit_length: 0,
            masks: empty_masks_ptr(),
        }
    }
}

impl DynamicBitSetUnmanaged {
    pub const EMPTY: fn() -> Self = Self::default;
    // TODO(port): Zig has `pub const empty: Self = .{ ... }` as a const value.
    // Rust can't const-init a static-mut-derived pointer; callers should use
    // `DynamicBitSetUnmanaged::default()`.

    /// Borrow the mask words as a shared slice of length `num_masks(bit_length)`.
    #[inline(always)]
    pub fn masks_slice(&self) -> &[usize] {
        let n = Self::num_masks(self.bit_length);
        // SAFETY: `masks` is never null (defaults to `empty_masks_ptr()`) and
        // points to at least `n` valid, initialized usize words, maintained by
        // `resize` / `List::at`. Padding bits in the last word are zeroed.
        unsafe { slice::from_raw_parts(self.masks, n) }
    }

    /// Borrow the mask words as an exclusive slice of length `num_masks(bit_length)`.
    ///
    /// Note: two `DynamicBitSetUnmanaged` values may share storage (see
    /// `DynamicBitSetList::at`). Callers must not hold a `masks_slice_mut()`
    /// borrow on one view while another aliasing view is read or written.
    #[inline(always)]
    pub fn masks_slice_mut(&mut self) -> &mut [usize] {
        let n = Self::num_masks(self.bit_length);
        // SAFETY: see `masks_slice`. `&mut self` gives us exclusive access to
        // *this* struct; the caller is responsible for not aliasing the
        // underlying storage via another view.
        unsafe { slice::from_raw_parts_mut(self.masks, n) }
    }

    /// Raw pointer to the mask words. Use this (not `masks_slice{,_mut}`) when
    /// `self` and another `DynamicBitSetUnmanaged` may point at the same
    /// storage and both are accessed in the same operation — forming
    /// overlapping `&mut [usize]` / `&[usize]` would be UB.
    #[inline(always)]
    pub fn masks_ptr(&self) -> *mut usize {
        self.masks
    }

    /// `self.masks[i] = f(self.masks[i], other.masks[i])` for every mask word.
    /// Centralises the binary set-op loop (`set_union` / `set_intersection` /
    /// `set_exclude` / `toggle_set` / `copy_into`) behind a single audited
    /// raw-pointer access. Raw pointers — not `masks_slice{,_mut}` — because
    /// `other.masks` may alias `self.masks` when both are views from the same
    /// `DynamicBitSetList`; forming overlapping `&mut [usize]` / `&[usize]`
    /// would be UB. `f` receives copied `usize` values, so the per-index read
    /// happens-before the write even when `src == dst`.
    #[inline(always)]
    fn zip_masks_raw(&mut self, other: &Self, mut f: impl FnMut(usize, usize) -> usize) {
        let num_masks = Self::num_masks(self.bit_length);
        let dst = self.masks;
        let src = other.masks;
        for i in 0..num_masks {
            // SAFETY: `i < num_masks(self.bit_length)`; `dst`/`src` each point
            // at ≥ `num_masks` initialized words (`resize`/`List::at` invariant).
            // The two pointers may be equal — see method doc.
            unsafe { *dst.add(i) = f(*dst.add(i), *src.add(i)) };
        }
    }

    /// Creates a bit set with no elements present.
    /// If bit_length is not zero, deinit must eventually be called.
    pub fn init_empty(bit_length: usize) -> Result<Self, AllocError> {
        let mut this = Self::default();
        this.resize(bit_length, false)?;
        Ok(this)
    }

    /// Creates a bit set with all elements present.
    /// If bit_length is not zero, deinit must eventually be called.
    pub fn init_full(bit_length: usize) -> Result<Self, AllocError> {
        let mut this = Self::default();
        this.resize(bit_length, true)?;
        Ok(this)
    }

    /// Resizes to a new bit_length.  If the new length is larger
    /// than the old length, fills any added bits with `fill`.
    /// If new_len is not zero, deinit must eventually be called.
    pub fn resize(&mut self, new_len: usize, fill: bool) -> Result<(), AllocError> {
        let old_len = self.bit_length;

        let old_masks = Self::num_masks(old_len);
        let new_masks = Self::num_masks(new_len);

        // SAFETY: `self.masks - 1` is the start of the true allocation (or the
        // start of EMPTY_MASKS_DATA), and `(self.masks - 1)[0]` holds its
        // length. Maintained by this function.
        let alloc_base = unsafe { self.masks.sub(1) };
        let old_alloc_len = unsafe { *alloc_base };

        if new_masks == 0 {
            debug_assert!(new_len == 0);
            // SAFETY: alloc_base/old_alloc_len describe a valid allocation
            // (possibly the static EMPTY_MASKS_DATA, in which case len==0 and
            // free is a no-op handled by `dyn_free`).
            unsafe { dyn_free(alloc_base, old_alloc_len) };
            self.masks = empty_masks_ptr();
            self.bit_length = 0;
            return Ok(());
        }

        'realloc: {
            if old_alloc_len == new_masks + 1 {
                break 'realloc;
            }
            // If realloc fails, it may mean one of two things.
            // If we are growing, it means we are out of memory.
            // If we are shrinking, it means the allocator doesn't
            // want to move the allocation.  This means we need to
            // hold on to the extra 8 bytes required to be able to free
            // this allocation properly.
            // SAFETY: alloc_base/old_alloc_len describe the current allocation.
            let new_alloc = match unsafe { dyn_realloc(alloc_base, old_alloc_len, new_masks + 1) } {
                Ok(p) => p,
                Err(err) => {
                    if new_masks + 1 > old_alloc_len {
                        return Err(err);
                    }
                    break 'realloc;
                }
            };

            // SAFETY: new_alloc points to at least new_masks+1 usize words.
            unsafe { *new_alloc = new_masks + 1 };
            // SAFETY: new_alloc points to at least new_masks+1 words; +1 is in-bounds.
            self.masks = unsafe { new_alloc.add(1) };
        }

        // If we increased in size, we need to set any new bits
        // to the fill value.
        if new_len > old_len {
            // set the padding bits in the old last item to 1
            if fill && old_masks > 0 {
                let old_padding_bits =
                    u32::try_from(old_masks * DYN_MASK_BITS as usize - old_len).expect("int cast");
                let old_mask = usize::MAX >> old_padding_bits;
                // SAFETY: index in [0, new_masks).
                unsafe { *self.masks.add(old_masks - 1) |= !old_mask };
            }

            // fill in any new masks
            if new_masks > old_masks {
                let fill_value = bool_mask_usize(fill);
                // SAFETY: range [old_masks, new_masks) is within the allocation.
                unsafe {
                    slice::from_raw_parts_mut(self.masks.add(old_masks), new_masks - old_masks)
                        .fill(fill_value);
                }
            }
        }

        // Zero out the padding bits
        if new_len > 0 {
            let padding_bits =
                u32::try_from(new_masks * DYN_MASK_BITS as usize - new_len).expect("int cast");
            let last_item_mask = usize::MAX >> padding_bits;
            // SAFETY: new_masks > 0 here.
            unsafe { *self.masks.add(new_masks - 1) &= last_item_mask };
        }

        // And finally, save the new length.
        self.bit_length = new_len;
        Ok(())
    }

    /// deinitializes the array and releases its memory.
    /// The passed allocator must be the same one used for
    /// init* or resize in the past.
    // TODO(port): kept as an explicit method (not `Drop`) because `List` hands
    // out non-owning `DynamicBitSetUnmanaged` views that must NOT free on drop.
    pub fn deinit(&mut self) {
        self.resize(0, false).expect("unreachable");
    }

    /// Creates a duplicate of this bit set, using the new allocator.
    pub fn clone(&self) -> Result<Self, AllocError> {
        let mut copy = Self::default();
        copy.resize(self.bit_length, false)?;
        copy.masks_slice_mut().copy_from_slice(self.masks_slice());
        Ok(copy)
    }

    /// Returns the number of bits in this bit set
    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.bit_length
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub fn is_set(&self, index: usize) -> bool {
        debug_assert!(index < self.bit_length);
        (self.masks_slice()[word_mask_index(index)] & word_mask_bit(index)) != 0
    }

    pub fn is_set_allow_out_of_bound(&self, index: usize, out_of_bounds: bool) -> bool {
        if index >= self.bit_length {
            return out_of_bounds;
        }
        (self.masks_slice()[word_mask_index(index)] & word_mask_bit(index)) != 0
    }

    pub fn bytes(&self) -> &[u8] {
        // `masks_slice()` already encapsulates the `(ptr, num_masks)` invariant;
        // reinterpreting `&[usize]` as `&[u8]` is a safe POD cast.
        bun_core::cast_slice::<usize, u8>(self.masks_slice())
    }

    /// Returns the total number of set bits in this bit set.
    pub fn count(&self) -> usize {
        let mut total: usize = 0;
        for mask in self.masks_slice() {
            // Note: This is where we depend on padding bits being zero
            total += mask.count_ones() as usize;
        }
        total
    }

    pub fn has_intersection(&self, other: &Self) -> bool {
        debug_assert_eq!(
            Self::num_masks(self.bit_length),
            Self::num_masks(other.bit_length)
        );
        for (a, b) in self.masks_slice().iter().zip(other.masks_slice()) {
            if (a & b) != 0 {
                return true;
            }
        }
        false
    }

    /// Changes the value of the specified bit of the bit
    /// set to match the passed boolean.
    pub fn set_value(&mut self, index: usize, value: bool) {
        debug_assert!(index < self.bit_length);
        let bit = word_mask_bit(index);
        let mask_index = word_mask_index(index);
        let new_bit = bit & bool_mask_usize(value);
        let mask = &mut self.masks_slice_mut()[mask_index];
        *mask = (*mask & !bit) | new_bit;
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks_slice_mut()[word_mask_index(index)] |= word_mask_bit(index);
    }

    /// Changes the value of all bits in the specified range to
    /// match the passed boolean.
    pub fn set_range_value(&mut self, range: Range, value: bool) {
        debug_assert!(range.end <= self.bit_length);
        debug_assert!(range.start <= range.end);
        set_range_value_masks(self.masks_slice_mut(), range, value);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks_slice_mut()[word_mask_index(index)] &= !word_mask_bit(index);
    }

    /// Flips a specific bit in the bit set
    pub fn toggle(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks_slice_mut()[word_mask_index(index)] ^= word_mask_bit(index);
    }

    /// Flips all bits in this bit set which are present
    /// in the toggles bit set.  Both sets must have the
    /// same bit_length.
    pub fn toggle_set(&mut self, toggles: &Self) {
        debug_assert!(toggles.bit_length == self.bit_length);
        let bit_length = self.bit_length;
        if bit_length == 0 {
            return;
        }
        let num_masks = Self::num_masks(self.bit_length);
        self.zip_masks_raw(toggles, |a, b| a ^ b);

        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        self.masks_slice_mut()[num_masks - 1] &= last_item_mask;
    }

    pub fn set_all(&mut self, value: bool) {
        let bit_length = self.bit_length;
        if bit_length == 0 {
            return;
        }
        let num_masks = Self::num_masks(self.bit_length);
        for mask in self.masks_slice_mut() {
            *mask = bool_mask_usize(value);
        }

        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        self.masks_slice_mut()[num_masks - 1] &= last_item_mask;
    }

    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        let bit_length = self.bit_length;
        // avoid underflow if bit_length is zero
        if bit_length == 0 {
            return;
        }

        let num_masks = Self::num_masks(self.bit_length);
        for mask in self.masks_slice_mut() {
            *mask = !*mask;
        }

        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        self.masks_slice_mut()[num_masks - 1] &= last_item_mask;
    }

    pub fn copy_into(&mut self, other: &Self) {
        let bit_length = self.bit_length;
        // avoid underflow if bit_length is zero
        if bit_length == 0 {
            return;
        }

        let num_masks = Self::num_masks(self.bit_length);
        self.zip_masks_raw(other, |_, b| b);

        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        self.masks_slice_mut()[num_masks - 1] &= last_item_mask;
    }

    /// Performs a union of two bit sets, and stores the
    /// result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in either input.
    /// The two sets must both be the same bit_length.
    pub fn set_union(&mut self, other: &Self) {
        debug_assert!(other.bit_length == self.bit_length);
        self.zip_masks_raw(other, |a, b| a | b);
    }

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    /// The two sets must both be the same bit_length.
    pub fn set_intersection(&mut self, other: &Self) {
        debug_assert!(other.bit_length == self.bit_length);
        self.zip_masks_raw(other, |a, b| a & b);
    }

    pub fn set_exclude_two(&mut self, other: &Self, third: &Self) {
        debug_assert!(other.bit_length == self.bit_length);
        // Two passes is equivalent to the original fused loop: each word is
        // independent, so `(a & !b) & !c` per index is associative across passes.
        self.zip_masks_raw(other, |a, b| a & !b);
        self.zip_masks_raw(third, |a, c| a & !c);
    }

    pub fn set_exclude(&mut self, other: &Self) {
        debug_assert!(other.bit_length == self.bit_length);
        self.zip_masks_raw(other, |a, b| a & !b);
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub fn find_first_set(&self) -> Option<usize> {
        let mut offset: usize = 0;
        for &mask in self.masks_slice() {
            if mask != 0 {
                return Some(offset + mask.trailing_zeros() as usize);
            }
            offset += DYN_MASK_BITS as usize;
        }
        None
    }

    /// Finds the index of the first set bit, and unsets it.
    /// If no bits are set, returns null.
    pub fn toggle_first_set(&mut self) -> Option<usize> {
        let mut offset: usize = 0;
        for mask in self.masks_slice_mut() {
            let m = *mask;
            if m != 0 {
                let index = m.trailing_zeros() as usize;
                *mask = m & (m - 1);
                return Some(offset + index);
            }
            offset += DYN_MASK_BITS as usize;
        }
        None
    }

    /// Returns true iff every corresponding bit in both
    /// bit sets are the same.
    pub fn eql(&self, other: &Self) -> bool {
        if self.bit_length != other.bit_length {
            return false;
        }
        self.masks_slice() == other.masks_slice()
    }

    /// Returns true iff the first bit set is the subset
    /// of the second one.
    pub fn subset_of(&self, other: &Self) -> bool {
        if self.bit_length != other.bit_length {
            return false;
        }
        for (&a, &b) in self.masks_slice().iter().zip(other.masks_slice()) {
            if a & b != a {
                return false;
            }
        }
        true
    }

    /// Returns true iff the first bit set is the superset
    /// of the second one.
    pub fn superset_of(&self, other: &Self) -> bool {
        if self.bit_length != other.bit_length {
            return false;
        }
        for (&a, &b) in self.masks_slice().iter().zip(other.masks_slice()) {
            if a & b != b {
                return false;
            }
        }
        true
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.  Resizing the underlying
    /// bit set invalidates the iterator.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
    ) -> BitSetIterator<'_, KIND_SET, DIR_FWD> {
        let num_masks = Self::num_masks(self.bit_length);
        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - self.bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        BitSetIterator::init(self.masks_slice(), last_item_mask)
    }

    #[inline(always)]
    pub const fn num_masks(bit_length: usize) -> usize {
        num_masks_for(bit_length)
    }
}

/// Do not resize the bitsets!
///
/// Single buffer for multiple bitsets of equal length. Does not
/// implement all methods of DynamicBitSetUnmanaged and should
/// be used carefully.
///
/// `buf` is a raw heap allocation rather than `Box<[usize]>` because `at()` /
/// `set()` / `set_union()` hand out and write through `*mut usize` views while
/// only holding `&self`. With `Box<[usize]>`, the only way to reach the data
/// from `&self` is `Deref` → `&[usize]` → `as_ptr()`, which yields a pointer
/// with shared-read-only provenance — writing through it (as the old code did
/// via `.cast_mut()`) is UB under Stacked Borrows. Owning the allocation as a
/// raw pointer means the heap words are never covered by a `&`/`&mut`
/// reference, so reads and writes through `at()`-derived pointers carry the
/// original allocation's full read-write provenance.
pub struct DynamicBitSetList {
    buf: ptr::NonNull<usize>,
    buf_len: usize,
    pub n: usize,
    pub bit_length: usize,
}

impl DynamicBitSetList {
    pub fn init_empty(n: usize, bit_length: usize) -> Result<Self, AllocError> {
        let masks = DynamicBitSetUnmanaged::num_masks(bit_length);
        let single_bitset_buf_size = masks + 1;
        let buf_len = single_bitset_buf_size * n;

        if buf_len == 0 {
            return Ok(Self {
                buf: ptr::NonNull::dangling(),
                buf_len: 0,
                n,
                bit_length,
            });
        }

        let layout = core::alloc::Layout::array::<usize>(buf_len).map_err(|_| AllocError)?;
        // SAFETY: `buf_len > 0` so layout has nonzero size.
        let raw = unsafe { std::alloc::alloc_zeroed(layout) }.cast::<usize>();
        let buf = ptr::NonNull::new(raw).ok_or(AllocError)?;

        for i in 0..n {
            // SAFETY: `i * single_bitset_buf_size < buf_len`; allocation is
            // zero-initialized and at least `buf_len` words long.
            unsafe { *buf.as_ptr().add(i * single_bitset_buf_size) = single_bitset_buf_size };
        }

        Ok(Self {
            buf,
            buf_len,
            n,
            bit_length,
        })
    }

    /// Borrow the `i`th bitset as a non-owning `DynamicBitSetUnmanaged` view.
    ///
    /// The returned view's `masks` pointer aliases `self.buf`. It is a raw
    /// pointer with no lifetime, so the borrow checker will **not** prevent
    /// use-after-free: the caller must ensure `self` is not dropped (and `buf`
    /// not reallocated — impossible today, no resize API) while the view is
    /// live. All current callers (`hoisted_install`, `isolated_install`,
    /// `PackageInstaller::can_run_scripts`) satisfy this by keeping the list
    /// alive for the view's entire use. The view must not be `deinit`ed.
    pub fn at(&self, i: usize) -> DynamicBitSetUnmanaged {
        debug_assert!(i < self.n, "DynamicBitSetList::at index out of bounds");
        let num_masks = DynamicBitSetUnmanaged::num_masks(self.bit_length);
        let single_bitset_buf_size = num_masks + 1;

        let offset = single_bitset_buf_size * i;

        DynamicBitSetUnmanaged {
            bit_length: self.bit_length,
            // SAFETY: `i < n` (asserted), so `offset + 1 + num_masks <= buf_len`
            // and the pointer is in-bounds. `buf` is a raw allocation never
            // reborrowed as `&[usize]`/`&mut [usize]`, so this `*mut` carries
            // full read-write provenance and writes through it via the returned
            // view (e.g. from `set`/`set_union`) are sound even though we only
            // hold `&self` here — `&self` freezes the pointer *value*, not the
            // pointee.
            masks: unsafe { self.buf.as_ptr().add(offset).add(1) },
        }
    }

    pub fn set(&self, i: usize, j: usize) {
        let mut bitset = self.at(i);
        bitset.set(j);
    }

    pub fn set_union(&self, i: usize, other: &DynamicBitSetUnmanaged) {
        let mut bitset = self.at(i);
        bitset.set_union(other);
    }
}

impl Drop for DynamicBitSetList {
    fn drop(&mut self) {
        if self.buf_len == 0 {
            return;
        }
        let layout = core::alloc::Layout::array::<usize>(self.buf_len).expect("unreachable");
        // SAFETY: `buf` was allocated in `init_empty` with exactly this layout
        // and has not been freed (no other code path deallocates it).
        unsafe { std::alloc::dealloc(self.buf.as_ptr().cast(), layout) };
    }
}

// `buf` is a uniquely-owned heap allocation of plain `usize`s; moving the
// owning struct between threads is as safe as moving a `Box<[usize]>`.
unsafe impl Send for DynamicBitSetList {}

// Raw allocation helpers for DynamicBitSetUnmanaged. These mirror Zig's
// allocator.alloc/realloc/free with the size-at-[-1] header convention.
// TODO(port): move to bun_alloc if useful elsewhere.

unsafe fn dyn_free(base: *mut usize, len: usize) {
    if len == 0 {
        // EMPTY_MASKS_DATA sentinel — nothing to free.
        return;
    }
    let layout = core::alloc::Layout::array::<usize>(len).expect("unreachable");
    // SAFETY: caller guarantees `base` was allocated with this layout.
    unsafe { std::alloc::dealloc(base.cast(), layout) };
}

unsafe fn dyn_realloc(
    base: *mut usize,
    old_len: usize,
    new_len: usize,
) -> Result<*mut usize, AllocError> {
    let new_layout = core::alloc::Layout::array::<usize>(new_len).map_err(|_| AllocError)?;
    if old_len == 0 {
        // SAFETY: new_layout is nonzero size (caller never passes new_len==0
        // through this path).
        let p = unsafe { std::alloc::alloc(new_layout) };
        if p.is_null() {
            return Err(AllocError);
        }
        return Ok(p.cast());
    }
    let old_layout = core::alloc::Layout::array::<usize>(old_len).expect("unreachable");
    // SAFETY: caller guarantees `base` was allocated with `old_layout`.
    let p = unsafe { std::alloc::realloc(base.cast(), old_layout, new_layout.size()) };
    if p.is_null() {
        return Err(AllocError);
    }
    Ok(p.cast())
}

// ───────────────────────────── AutoBitSet ─────────────────────────────

/// Static arm size: `@bitSizeOf(DynamicBitSetUnmanaged) - 1`.
pub const AUTO_STATIC_BITS: usize = mem::size_of::<DynamicBitSetUnmanaged>() * 8 - 1;

pub type AutoBitSetStatic = ArrayBitSet<AUTO_STATIC_BITS, { num_masks_for(AUTO_STATIC_BITS) }>;

pub enum AutoBitSet {
    Static(AutoBitSetStatic),
    Dynamic(DynamicBitSetUnmanaged),
}

// ─── two-arm forward helper ────────────────────────────────────────────
// Zig had `switch (this.*) { inline else => |*b| b.method() }` for the
// symmetric arms (setAll/count/findFirstSet/Iterator.next). The Rust port
// regressed those to open-coded matches; this macro restores the collapse
// and is applied to every method whose Static/Dynamic arms are textually
// identical. Asymmetric arms (clone, raw_bytes, has_intersection, Drop)
// stay open-coded — they genuinely differ.
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
            Ok(AutoBitSet::Dynamic(DynamicBitSetUnmanaged::init_empty(
                bit_length,
            )?))
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

    pub fn raw_bytes(&self) -> &[u8] {
        match self {
            AutoBitSet::Static(s) => bun_core::cast_slice::<usize, u8>(&s.masks),
            AutoBitSet::Dynamic(d) => d.bytes(),
        }
    }

    pub fn bytes(&self, _: usize) -> &[u8] {
        self.raw_bytes()
    }

    pub fn eql(&self, b: &AutoBitSet) -> bool {
        // TODO(b0): `strings` arrives in bun_core via move-in (was bun_core::strings).
        self.raw_bytes() == b.raw_bytes()
    }

    pub fn hash(&self) -> u64 {
        bun_wyhash::hash(self.raw_bytes())
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
// (see ArrayBitSet::iterator / DynamicBitSetUnmanaged::iterator), so the
// wrapper enum was a no-op layer of indirection. Keep the public name as a
// type alias for any external callers.
pub type AutoBitSetIterator<'a, const KIND_SET: bool, const DIR_FWD: bool> =
    BitSetIterator<'a, KIND_SET, DIR_FWD>;

impl Drop for AutoBitSet {
    fn drop(&mut self) {
        match self {
            AutoBitSet::Static(_) => {}
            AutoBitSet::Dynamic(d) => d.deinit(),
        }
    }
}

// ───────────────────────────── DynamicBitSet ─────────────────────────────

/// A bit set with runtime-known size, backed by an allocated slice
/// of usize.  Thin wrapper around DynamicBitSetUnmanaged which keeps
/// track of the allocator instance.
///
// TODO(port): in Rust the managed/unmanaged split disappears (global
// allocator). This wrapper is kept for diff parity; Phase B may collapse it
// into `DynamicBitSetUnmanaged` and re-export under both names.
pub struct DynamicBitSet {
    /// The number of valid items in this bit set
    pub unmanaged: DynamicBitSetUnmanaged,
}

impl Default for DynamicBitSet {
    fn default() -> Self {
        Self {
            unmanaged: DynamicBitSetUnmanaged::default(),
        }
    }
}

impl DynamicBitSet {
    /// The integer type used to represent a mask in this bit set
    // type MaskInt = usize (inherent assoc → inline usize)

    /// The integer type used to shift a mask in this bit set
    // type ShiftInt = u32 (inherent assoc → inline u32)

    /// Creates a bit set with no elements present.
    pub fn init_empty(bit_length: usize) -> Result<Self, AllocError> {
        Ok(Self {
            unmanaged: DynamicBitSetUnmanaged::init_empty(bit_length)?,
        })
    }

    /// Creates a bit set with all elements present.
    pub fn init_full(bit_length: usize) -> Result<Self, AllocError> {
        Ok(Self {
            unmanaged: DynamicBitSetUnmanaged::init_full(bit_length)?,
        })
    }

    /// Resizes to a new length.  If the new length is larger
    /// than the old length, fills any added bits with `fill`.
    pub fn resize(&mut self, new_len: usize, fill: bool) -> Result<(), AllocError> {
        self.unmanaged.resize(new_len, fill)
    }

    /// Creates a duplicate of this bit set, using the new allocator.
    pub fn clone(&self) -> Result<Self, AllocError> {
        Ok(Self {
            unmanaged: self.unmanaged.clone()?,
        })
    }

    /// Returns the number of bits in this bit set
    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.unmanaged.capacity()
    }

    /// Zig spelling of `capacity()` (`.bit_length`).
    #[inline(always)]
    pub fn bit_length(&self) -> usize {
        self.unmanaged.capacity()
    }

    /// Copy all set/unset bits from `self` into `other` (which must have
    /// `bit_length >= self.bit_length`). Port of `DynamicBitSet.copyInto`.
    #[inline]
    pub fn copy_into(&self, other: &mut Self) {
        other.unmanaged.copy_into(&self.unmanaged);
    }

    /// Returns true if the bit at the specified index
    /// is present in the set, false otherwise.
    pub fn is_set(&self, index: usize) -> bool {
        self.unmanaged.is_set(index)
    }

    /// Returns the total number of set bits in this bit set.
    pub fn count(&self) -> usize {
        self.unmanaged.count()
    }

    /// Changes the value of the specified bit of the bit
    /// set to match the passed boolean.
    pub fn set_value(&mut self, index: usize, value: bool) {
        self.unmanaged.set_value(index, value);
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        self.unmanaged.set(index);
    }

    /// Set all bits to the specified value.
    pub fn set_all(&mut self, value: bool) {
        self.unmanaged.set_all(value);
    }

    /// Changes the value of all bits in the specified range to
    /// match the passed boolean.
    pub fn set_range_value(&mut self, range: Range, value: bool) {
        self.unmanaged.set_range_value(range, value);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        self.unmanaged.unset(index);
    }

    /// Flips a specific bit in the bit set
    pub fn toggle(&mut self, index: usize) {
        self.unmanaged.toggle(index);
    }

    /// Flips all bits in this bit set which are present
    /// in the toggles bit set.  Both sets must have the
    /// same bit_length.
    pub fn toggle_set(&mut self, toggles: &Self) {
        self.unmanaged.toggle_set(&toggles.unmanaged);
    }

    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        self.unmanaged.toggle_all();
    }

    /// Performs a union of two bit sets, and stores the
    /// result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in either input.
    /// The two sets must both be the same bit_length.
    pub fn set_union(&mut self, other: &Self) {
        self.unmanaged.set_union(&other.unmanaged);
    }

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    /// The two sets must both be the same bit_length.
    pub fn set_intersection(&mut self, other: &Self) {
        self.unmanaged.set_intersection(&other.unmanaged);
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub fn find_first_set(&self) -> Option<usize> {
        self.unmanaged.find_first_set()
    }

    /// Finds the index of the first set bit, and unsets it.
    /// If no bits are set, returns null.
    pub fn toggle_first_set(&mut self) -> Option<usize> {
        self.unmanaged.toggle_first_set()
    }

    /// Returns true iff every corresponding bit in both
    /// bit sets are the same.
    pub fn eql(&self, other: &Self) -> bool {
        self.unmanaged.eql(&other.unmanaged)
    }

    /// Iterates through the items in the set, according to the options.
    /// The default options (.{}) will iterate indices of set bits in
    /// ascending order.  Modifications to the underlying bit set may
    /// or may not be observed by the iterator.  Resizing the underlying
    /// bit set invalidates the iterator.
    pub fn iterator<const KIND_SET: bool, const DIR_FWD: bool>(
        &self,
    ) -> BitSetIterator<'_, KIND_SET, DIR_FWD> {
        self.unmanaged.iterator::<KIND_SET, DIR_FWD>()
    }
}

impl Drop for DynamicBitSet {
    fn drop(&mut self) {
        self.unmanaged.deinit();
    }
}

// ───────────────────────────── IteratorOptions ─────────────────────────────

/// Options for configuring an iterator over a bit set
// TODO(port): Zig passes a `comptime options: IteratorOptions` struct. Stable
// Rust adt_const_params is unstable; split into two const-generic enum params
// (`KIND`, `DIRECTION`) at every callsite.
#[derive(Clone, Copy, Default)]
pub struct IteratorOptions {
    /// determines which bits should be visited
    pub kind: IteratorKind,
    /// determines the order in which bit indices should be visited
    pub direction: IteratorDirection,
}

#[derive(PartialEq, Eq, Clone, Copy, Default)]
pub enum IteratorKind {
    /// visit indexes of set bits
    #[default]
    Set,
    /// visit indexes of unset bits
    Unset,
}

#[derive(PartialEq, Eq, Clone, Copy, Default)]
pub enum IteratorDirection {
    /// visit indices in ascending order
    #[default]
    Forward,
    /// visit indices in descending order.
    /// Note that this may be slightly more expensive than forward iteration.
    Reverse,
}

// ───────────────────────────── BitSetIterator ─────────────────────────────

// The iterator is reusable between several bit set types
// TODO(port): Zig is generic over `MaskInt`; fixed to `usize` here since every
// in-tree caller uses `usize`.
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

// ───────────────────────────── Tests ─────────────────────────────

// TODO(port): the Zig source defines test helper fns (`testEql`, `testBitSet`,
// `testPureBitSet`, `testStaticBitSet`, ...) but no `test "..." {}` blocks
// actually invoke them — dead code carried from the std fork. Ported as
// `#[cfg(test)]` helpers; Phase B should add `#[test]` entry points or delete.
#[cfg(test)]
mod tests {
    use super::*;

    // TODO(port): these helpers used `anytype` to accept Integer/Array/Dynamic
    // bit sets uniformly. Rust would need a common trait. Stubbed pending
    // Phase B trait extraction.

    #[allow(dead_code)]
    fn fill_even<const SIZE: usize, const M: usize>(set: &mut ArrayBitSet<SIZE, M>, len: usize)
    where
        [(); num_masks_for(SIZE)]:,
    {
        for i in 0..len {
            set.set_value(i, i & 1 == 0);
        }
    }

    #[allow(dead_code)]
    fn fill_odd<const SIZE: usize, const M: usize>(set: &mut ArrayBitSet<SIZE, M>, len: usize)
    where
        [(); num_masks_for(SIZE)]:,
    {
        for i in 0..len {
            set.set_value(i, i & 1 == 1);
        }
    }

    // TODO(port): `testEql`, `testSubsetOf`, `testSupersetOf`, `testBitSet`,
    // `testPureBitSet`, `testStaticBitSet` omitted — they rely on Zig
    // `anytype` duck-typing across all bitset variants and `@hasField`
    // reflection (`needs_ptr`). Re-author in Phase B against a `BitSet` trait.
}

// ported from: src/collections/bit_set.zig
