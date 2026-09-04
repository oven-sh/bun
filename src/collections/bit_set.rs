//! This file defines several variants of bit sets.  A bit set
//! is a densely stored set of integers with a known maximum,
//! in which each integer gets a single bit.  Bit sets have very
//! fast presence checks, update operations, and union and intersection
//! operations.  However, if the number of possible items is very
//! large and the number of actual items in a given set is usually
//! small, they may be less memory efficient than an array set.
//!
//! There are four variants defined here:
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
//!
//! DynamicBitSetUnmanaged:
//!   A variant of DynamicBitSet which does not store a pointer to its
//!   allocator, in order to save space.

use core::marker::PhantomData;
use core::mem;
use core::ptr;
use core::slice;

use bun_alloc::AllocError;

// ───────────────────────────── helpers ─────────────────────────────

/// Returns `usize::MAX` if `value`, else `0`.
#[inline(always)]
const fn bool_mask_usize(value: bool) -> usize {
    if value { usize::MAX } else { 0 }
}

/// `1 << (index % usize::BITS)` — selects the bit within a `usize` word.
/// Shared by `ArrayBitSet` and `DynamicBitSetUnmanaged`.
#[inline(always)]
const fn word_mask_bit(index: usize) -> usize {
    1usize << ((index as u32) & (usize::BITS - 1)) // @truncate
}

/// `index / usize::BITS` — selects which `usize` word holds the bit.
/// Shared by `ArrayBitSet` and `DynamicBitSetUnmanaged`.
#[inline(always)]
const fn word_mask_index(index: usize) -> usize {
    index >> usize::BITS.trailing_zeros()
}

/// Shared multi-mask implementation of `set_range_value` over `&mut [usize]`
/// storage. Used by both `ArrayBitSet` and `DynamicBitSetUnmanaged` so the
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

    /// Creates a bit set with all elements present.
    pub const fn init_full() -> Self {
        Self {
            mask: Self::FULL_MASK,
        }
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

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub fn find_first_set(self) -> Option<usize> {
        let mask = self.mask;
        if mask == 0 {
            return None;
        }
        Some(mask.trailing_zeros() as usize)
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
    pub fn is_set(&self, index: usize) -> bool {
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
    pub fn set(&mut self, index: usize) {
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

    /// Performs an intersection of two bit sets, and stores the
    /// result in the first one.
    pub(crate) fn set_intersection(&mut self, other: &Self) {
        debug_assert_eq!(self.masks.len(), other.masks.len());
        for (mask, alt) in self.masks.iter_mut().zip(other.masks.iter()) {
            *mask &= *alt;
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

// ──────────────────────── DynamicBitSetUnmanaged ────────────────────────

/// A bit set with runtime-known size, backed by an allocated slice
/// of usize.  The allocator must be tracked externally by the user.
///
// Layout invariant: `masks` is a raw pointer where `masks[-1]` holds the true
// allocation length (needed on free). This layout is load-bearing because
// `DynamicBitSetList::at` constructs values of this type that point into the
// list's own buffer (and are never resized or freed; see
// `DynamicBitSetListEntry`). Do not swap the storage for `Vec<usize>` without
// reworking `DynamicBitSetList`.
pub struct DynamicBitSetUnmanaged {
    /// The number of valid items in this bit set
    pub bit_length: usize,

    /// The bit masks, ordered with lower indices first.
    /// Padding bits at the end must be zeroed.
    pub(crate) masks: *mut usize,
    // This pointer is one usize after the actual allocation.
    // That slot holds the size of the true allocation, which
    // is needed when freeing.
}

const DYN_MASK_BITS: u32 = usize::BITS;

// Never modified. All writes through
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

impl Drop for DynamicBitSetUnmanaged {
    fn drop(&mut self) {
        self.deinit();
    }
}

impl DynamicBitSetUnmanaged {
    // There is no `const` empty value (the empty sentinel pointer is computed at
    // runtime); use `Self::default()`.

    /// Borrow the mask words as a shared slice of length `num_masks(bit_length)`.
    #[inline(always)]
    pub(crate) fn masks_slice(&self) -> &[usize] {
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
    pub(crate) fn masks_slice_mut(&mut self) -> &mut [usize] {
        let n = Self::num_masks(self.bit_length);
        // SAFETY: see `masks_slice`. `&mut self` gives us exclusive access to
        // *this* struct; the caller is responsible for not aliasing the
        // underlying storage via another view.
        unsafe { slice::from_raw_parts_mut(self.masks, n) }
    }

    /// `self.masks[i] = f(self.masks[i], other.masks[i])` for every mask word.
    /// Centralises the binary set-op loop (`set_union` / `set_intersection` /
    /// `set_exclude`) behind a single audited raw-pointer access. Raw pointers
    /// rather than `masks_slice{,_mut}` because `other.masks` may alias
    /// `self.masks` when both are views from the same `DynamicBitSetList`;
    /// forming overlapping `&mut [usize]` / `&[usize]` would be UB. `f`
    /// receives copied `usize` values, so the per-index read happens-before
    /// the write even when `src == dst`.
    ///
    /// Panics unless both sets have the same `bit_length`. The callers are
    /// safe `pub fn`s and the loop reads `num_masks(self.bit_length)` words
    /// out of `other`, so the check must survive release builds: not a
    /// `debug_assert!`.
    #[inline(always)]
    fn zip_masks_raw(&mut self, other: &Self, mut f: impl FnMut(usize, usize) -> usize) {
        assert!(
            other.bit_length == self.bit_length,
            "bit sets have different lengths ({} and {})",
            self.bit_length,
            other.bit_length
        );
        let num_masks = Self::num_masks(self.bit_length);
        let dst = self.masks;
        let src = other.masks;
        for i in 0..num_masks {
            // SAFETY: the lengths are equal (asserted above), so `i` is below
            // the word count of both sets, and `dst`/`src` each point at that
            // many initialized words (`resize`/`List::at` invariant). The two
            // pointers may be equal; see the method doc.
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
        // SAFETY: `alloc_base` points at the allocation-length header word (or
        // `EMPTY_MASKS_DATA[0]`), which is always initialized.
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
    /// init* or resize in the past. Idempotent.
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
    pub(crate) fn capacity(&self) -> usize {
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

    /// Inverse of `bytes()`: `bytes` must be exactly the mask words for
    /// `bit_length`. Padding bits past `bit_length` are cleared, so untrusted
    /// input cannot make `count()` exceed `bit_length`.
    pub fn from_bytes(bit_length: usize, bytes: &[u8]) -> Result<Option<Self>, AllocError> {
        let mut set = Self::init_empty(bit_length)?;
        let words = set.masks_slice_mut();
        if bytes.len() != core::mem::size_of_val(words) {
            return Ok(None);
        }
        bun_core::cast_slice_mut::<usize, u8>(words).copy_from_slice(bytes);
        let n = words.len();
        if let Some(last) = words.last_mut() {
            let padding_bits =
                u32::try_from(n * DYN_MASK_BITS as usize - bit_length).expect("int cast");
            *last &= usize::MAX >> padding_bits;
        }
        Ok(Some(set))
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

    pub(crate) fn has_intersection(&self, other: &Self) -> bool {
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

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks_slice_mut()[word_mask_index(index)] |= word_mask_bit(index);
    }

    /// Changes the value of all bits in the specified range to
    /// match the passed boolean.
    pub(crate) fn set_range_value(&mut self, range: Range, value: bool) {
        debug_assert!(range.end <= self.bit_length);
        debug_assert!(range.start <= range.end);
        set_range_value_masks(self.masks_slice_mut(), range, value);
    }

    /// Removes a specific bit from the bit set
    pub fn unset(&mut self, index: usize) {
        debug_assert!(index < self.bit_length);
        self.masks_slice_mut()[word_mask_index(index)] &= !word_mask_bit(index);
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
    pub(crate) fn toggle_all(&mut self) {
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

    /// Replaces the contents of `self` with those of `other`. The lengths may
    /// differ: bits beyond the end of `other` are cleared in `self`, and bits
    /// beyond the end of `self` are not copied. `other` may share storage
    /// with `self` (two views of one `DynamicBitSetList` slot).
    pub fn copy_into(&mut self, other: &Self) {
        let bit_length = self.bit_length;
        // avoid underflow if bit_length is zero
        if bit_length == 0 {
            return;
        }

        let num_masks = Self::num_masks(bit_length);
        let shared = num_masks.min(Self::num_masks(other.bit_length));
        // SAFETY: `shared` is at most the word count of either set, and each
        // `masks` points at that many initialized words (`resize`/`List::at`
        // invariant). `ptr::copy` allows the two ranges to overlap.
        unsafe { ptr::copy(other.masks, self.masks, shared) };

        let padding_bits =
            u32::try_from(num_masks * DYN_MASK_BITS as usize - bit_length).expect("int cast");
        let last_item_mask = usize::MAX >> padding_bits;
        let masks = self.masks_slice_mut();
        masks[shared..].fill(0);
        masks[num_masks - 1] &= last_item_mask;
    }

    /// Performs a union of two bit sets, and stores the
    /// result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in either input.
    /// Panics unless the two sets have the same bit_length.
    pub fn set_union(&mut self, other: &Self) {
        self.zip_masks_raw(other, |a, b| a | b);
    }

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    /// Panics unless the two sets have the same bit_length.
    pub(crate) fn set_intersection(&mut self, other: &Self) {
        self.zip_masks_raw(other, |a, b| a & b);
    }

    /// Clears every bit of `self` that is set in `other`.
    /// Panics unless the two sets have the same bit_length.
    pub fn set_exclude(&mut self, other: &Self) {
        self.zip_masks_raw(other, |a, b| a & !b);
    }

    /// Finds the index of the first set bit.
    /// If no bits are set, returns null.
    pub(crate) fn find_first_set(&self) -> Option<usize> {
        let mut offset: usize = 0;
        for &mask in self.masks_slice() {
            if mask != 0 {
                return Some(offset + mask.trailing_zeros() as usize);
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
    pub(crate) const fn num_masks(bit_length: usize) -> usize {
        num_masks_for(bit_length)
    }
}

/// Single buffer holding `n` bitsets of equal length. The bitsets are reached
/// through [`DynamicBitSetList::at`], which hands out a
/// [`DynamicBitSetListEntry`] borrowing the list; they cannot be resized.
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
///
/// Layout: `buf` is `n` consecutive slots of `slot_words(bit_length)` words
/// each, so `buf_len == slot_words(bit_length) * n`. A slot is one header word
/// (the slot size, in the position where `DynamicBitSetUnmanaged` keeps its
/// allocation length) followed by the `num_masks(bit_length)` mask words that
/// an entry's `masks` pointer addresses.
pub struct DynamicBitSetList {
    buf: ptr::NonNull<usize>,
    buf_len: usize,
    n: usize,
    bit_length: usize,
}

/// One bitset of a [`DynamicBitSetList`], borrowed from the list for `'a`.
///
/// Derefs to [`DynamicBitSetUnmanaged`] for reading. Writes go through the
/// methods below; `&mut DynamicBitSetUnmanaged` is deliberately not exposed,
/// because `resize` / `deinit` would treat the list's buffer as the bitset's
/// own allocation. Dropping an entry does nothing: the storage belongs to the
/// list, which the `'a` borrow keeps alive.
///
/// Entries come from `&DynamicBitSetList`, so two live entries may denote the
/// same bitset. That is sound because every access goes through the list
/// buffer's raw pointer and only forms a `&mut [usize]` for the duration of
/// one method call (see the `DynamicBitSetList` doc).
pub struct DynamicBitSetListEntry<'a> {
    view: mem::ManuallyDrop<DynamicBitSetUnmanaged>,
    list: PhantomData<&'a DynamicBitSetList>,
}

impl core::ops::Deref for DynamicBitSetListEntry<'_> {
    type Target = DynamicBitSetUnmanaged;

    #[inline(always)]
    fn deref(&self) -> &DynamicBitSetUnmanaged {
        &self.view
    }
}

impl DynamicBitSetListEntry<'_> {
    /// Adds a specific bit to the bit set.
    pub(crate) fn set(&mut self, index: usize) {
        self.view.set(index);
    }

    /// See [`DynamicBitSetUnmanaged::set_union`].
    pub(crate) fn set_union(&mut self, other: &DynamicBitSetUnmanaged) {
        self.view.set_union(other);
    }

    /// See [`DynamicBitSetUnmanaged::copy_into`].
    pub fn copy_into(&mut self, other: &DynamicBitSetUnmanaged) {
        self.view.copy_into(other);
    }
}

impl DynamicBitSetList {
    /// Words one bitset occupies in `buf`: the header plus its masks.
    #[inline(always)]
    const fn slot_words(bit_length: usize) -> usize {
        DynamicBitSetUnmanaged::num_masks(bit_length) + 1
    }

    pub fn init_empty(n: usize, bit_length: usize) -> Result<Self, AllocError> {
        let slot_words = Self::slot_words(bit_length);
        let buf_len = slot_words.checked_mul(n).ok_or(AllocError)?;

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
        let raw = unsafe { std::alloc::alloc_zeroed(layout) };
        let buf = ptr::NonNull::new(raw).ok_or(AllocError)?.cast::<usize>();

        for i in 0..n {
            // SAFETY: `i * slot_words < buf_len`; allocation is
            // zero-initialized and at least `buf_len` words long.
            unsafe { *buf.as_ptr().add(i * slot_words) = slot_words };
        }

        Ok(Self {
            buf,
            buf_len,
            n,
            bit_length,
        })
    }

    /// Borrows the `i`th bitset. Panics if `i >= n`: that check is what keeps
    /// the entry, and the writes made through it, inside `buf`, so it has to
    /// hold in release builds as well (not a `debug_assert!`).
    ///
    /// The entry cannot outlive the list:
    ///
    /// ```compile_fail,E0597
    /// let entry = {
    ///     let list = bun_collections::DynamicBitSetList::init_empty(1, 8).unwrap();
    ///     list.at(0)
    /// };
    /// let _ = entry.count();
    /// ```
    pub fn at(&self, i: usize) -> DynamicBitSetListEntry<'_> {
        assert!(i < self.n, "DynamicBitSetList::at index out of bounds");
        let offset = Self::slot_words(self.bit_length) * i;

        DynamicBitSetListEntry {
            view: mem::ManuallyDrop::new(DynamicBitSetUnmanaged {
                bit_length: self.bit_length,
                // SAFETY: `buf_len == slot_words * n` (checked multiplication
                // in `init_empty`) and `i < n` (asserted above), so slot `i`,
                // words `offset..offset + slot_words`, lies inside `buf`; its
                // masks start right after the header word. `buf` is never
                // reborrowed as `&[usize]`/`&mut [usize]`, so this pointer
                // keeps the allocation's read-write provenance and writes made
                // through the entry while only holding `&self` are sound (see
                // the struct doc).
                masks: unsafe { self.buf.as_ptr().add(offset + 1) },
            }),
            list: PhantomData,
        }
    }

    pub fn set(&self, i: usize, j: usize) {
        self.at(i).set(j);
    }

    pub fn set_union(&self, i: usize, other: &DynamicBitSetUnmanaged) {
        self.at(i).set_union(other);
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

// SAFETY: `buf` is a uniquely-owned heap allocation of plain `usize`s; moving
// the owning struct between threads is as safe as moving a `Box<[usize]>`.
unsafe impl Send for DynamicBitSetList {}

// Raw allocation helpers for DynamicBitSetUnmanaged, using the size-at-[-1]
// header convention.

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

/// Static arm size: one less than the bit-size of `DynamicBitSetUnmanaged`.
const AUTO_STATIC_BITS: usize = mem::size_of::<DynamicBitSetUnmanaged>() * 8 - 1;

pub(crate) type AutoBitSetStatic =
    ArrayBitSet<AUTO_STATIC_BITS, { num_masks_for(AUTO_STATIC_BITS) }>;

pub enum AutoBitSet {
    Static(AutoBitSetStatic),
    Dynamic(DynamicBitSetUnmanaged),
}

// ─── two-arm forward helper ────────────────────────────────────────────
// This macro forwards a call to whichever arm is active and is applied to
// every method whose Static/Dynamic arms are textually identical.
// Asymmetric arms (clone, raw_bytes, has_intersection, Drop)
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

    /// `self |= other`. Both sets must have the same arm (same bit length).
    pub fn set_union(&mut self, other: &AutoBitSet) {
        match (self, other) {
            (AutoBitSet::Static(a), AutoBitSet::Static(b)) => a.set_union(b),
            (AutoBitSet::Dynamic(a), AutoBitSet::Dynamic(b)) => a.set_union(b),
            _ => unreachable!("AutoBitSet::set_union: mismatched bit lengths"),
        }
    }

    /// `self &= other`. Both sets must have the same arm (same bit length).
    pub fn set_intersection(&mut self, other: &AutoBitSet) {
        match (self, other) {
            (AutoBitSet::Static(a), AutoBitSet::Static(b)) => a.set_intersection(b),
            (AutoBitSet::Dynamic(a), AutoBitSet::Dynamic(b)) => a.set_intersection(b),
            _ => unreachable!("AutoBitSet::set_intersection: mismatched bit lengths"),
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
        match self {
            AutoBitSet::Static(s) => bun_core::cast_slice::<usize, u8>(&s.masks),
            AutoBitSet::Dynamic(d) => d.bytes(),
        }
    }

    pub fn bytes(&self, _: usize) -> &[u8] {
        self.raw_bytes()
    }

    /// The backing words (bit `i` is `words()[i / usize::BITS] >> (i % usize::BITS) & 1`);
    /// bits past the length are zero.
    pub fn words(&self) -> &[usize] {
        match self {
            AutoBitSet::Static(s) => &s.masks,
            AutoBitSet::Dynamic(d) => d.masks_slice(),
        }
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
// (see ArrayBitSet::iterator / DynamicBitSetUnmanaged::iterator), so the
// wrapper enum was a no-op layer of indirection. Keep the public name as a
// type alias for any external callers.
pub(crate) type AutoBitSetIterator<'a, const KIND_SET: bool, const DIR_FWD: bool> =
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
#[derive(Default)]
pub struct DynamicBitSet {
    /// The number of valid items in this bit set
    pub unmanaged: DynamicBitSetUnmanaged,
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

    /// Alias for `capacity()`.
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

    /// Like `is_set`, but returns `out_of_bounds` for indices past the end.
    pub fn is_set_allow_out_of_bound(&self, index: usize, out_of_bounds: bool) -> bool {
        self.unmanaged
            .is_set_allow_out_of_bound(index, out_of_bounds)
    }

    /// Returns the total number of set bits in this bit set.
    pub fn count(&self) -> usize {
        self.unmanaged.count()
    }

    /// Adds a specific bit to the bit set
    pub fn set(&mut self, index: usize) {
        self.unmanaged.set(index);
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
    /// Flips every bit in the bit set.
    pub fn toggle_all(&mut self) {
        self.unmanaged.toggle_all();
    }

    /// Performs an intersection of two bit sets, and stores
    /// the result in the first one.  Bits in the result are
    /// set if the corresponding bits were set in both inputs.
    /// The two sets must both be the same bit_length.
    pub fn set_intersection(&mut self, other: &Self) {
        self.unmanaged.set_intersection(&other.unmanaged);
    }

    /// Performs a union of two bit sets, and stores the result in the
    /// first one. The two sets must both be the same bit_length.
    pub fn set_union(&mut self, other: &Self) {
        self.unmanaged.set_union(&other.unmanaged);
    }

    /// The mask words as raw bytes (native layout).
    pub fn bytes(&self) -> &[u8] {
        self.unmanaged.bytes()
    }

    /// See `DynamicBitSetUnmanaged::from_bytes`.
    pub fn from_bytes(bit_length: usize, bytes: &[u8]) -> Result<Option<Self>, AllocError> {
        Ok(DynamicBitSetUnmanaged::from_bytes(bit_length, bytes)?
            .map(|unmanaged| Self { unmanaged }))
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

    const WORD: usize = usize::BITS as usize;

    fn set_bits(set: &DynamicBitSetUnmanaged) -> Vec<usize> {
        let mut out = Vec::new();
        let mut it = set.iterator::<true, true>();
        while let Some(i) = it.next() {
            out.push(i);
        }
        out
    }

    #[test]
    fn list_slots_are_independent() {
        let list = DynamicBitSetList::init_empty(3, WORD + 6).unwrap();
        list.set(0, 0);
        list.set(1, WORD + 5);
        list.set(2, WORD);
        list.set(2, 1);

        assert_eq!(set_bits(&list.at(0)), [0]);
        assert_eq!(set_bits(&list.at(1)), [WORD + 5]);
        assert_eq!(set_bits(&list.at(2)), [1, WORD]);
        assert_eq!(list.at(1).bit_length, WORD + 6);
    }

    #[test]
    fn list_set_union_merges_into_one_slot() {
        let list = DynamicBitSetList::init_empty(2, WORD + 6).unwrap();
        list.set(1, 2);
        let mut other = DynamicBitSetUnmanaged::init_empty(WORD + 6).unwrap();
        other.set(WORD + 1);

        list.set_union(1, &other);

        assert_eq!(set_bits(&list.at(1)), [2, WORD + 1]);
        assert_eq!(set_bits(&list.at(0)), []);
    }

    #[test]
    fn list_entry_copy_into_writes_through_to_the_list() {
        let list = DynamicBitSetList::init_empty(2, WORD + 6).unwrap();
        list.set(1, 0);
        let mut scratch = DynamicBitSetUnmanaged::init_empty(WORD + 6).unwrap();
        scratch.set(3);
        scratch.set(WORD);

        let mut dst = list.at(1);
        dst.copy_into(&scratch);

        assert_eq!(set_bits(&list.at(1)), [3, WORD]);
        assert!(scratch.eql(&list.at(1)));
        assert_eq!(set_bits(&list.at(0)), []);
    }

    #[test]
    fn list_entry_copy_into_itself_keeps_contents() {
        let list = DynamicBitSetList::init_empty(1, WORD + 6).unwrap();
        list.set(0, 5);
        list.set(0, WORD + 5);

        let mut dst = list.at(0);
        let src = list.at(0);
        dst.copy_into(&src);

        assert_eq!(set_bits(&dst), [5, WORD + 5]);
    }

    #[test]
    fn list_with_zero_bit_length_has_empty_slots() {
        let list = DynamicBitSetList::init_empty(4, 0).unwrap();
        assert_eq!(list.at(3).count(), 0);
        assert_eq!(set_bits(&list.at(0)), []);
        let mut scratch = DynamicBitSetUnmanaged::init_empty(0).unwrap();
        scratch.set_union(&list.at(1));
        assert_eq!(scratch.count(), 0);
    }

    #[test]
    #[should_panic(expected = "DynamicBitSetList::at index out of bounds")]
    fn list_at_one_past_the_end_panics() {
        let list = DynamicBitSetList::init_empty(2, 8).unwrap();
        let _ = list.at(2);
    }

    #[test]
    #[should_panic(expected = "DynamicBitSetList::at index out of bounds")]
    fn list_at_on_an_empty_list_panics() {
        let list = DynamicBitSetList::init_empty(0, 8).unwrap();
        let _ = list.at(0);
    }

    #[test]
    #[should_panic(expected = "DynamicBitSetList::at index out of bounds")]
    fn list_set_past_the_end_panics() {
        let list = DynamicBitSetList::init_empty(2, 8).unwrap();
        list.set(2, 0);
    }

    #[test]
    #[should_panic(expected = "DynamicBitSetList::at index out of bounds")]
    fn list_set_union_past_the_end_panics() {
        let list = DynamicBitSetList::init_empty(2, 8).unwrap();
        let other = DynamicBitSetUnmanaged::init_empty(8).unwrap();
        list.set_union(2, &other);
    }

    #[test]
    #[should_panic(expected = "bit sets have different lengths")]
    fn set_union_with_a_shorter_operand_panics() {
        let mut a = DynamicBitSetUnmanaged::init_empty(2 * WORD).unwrap();
        let b = DynamicBitSetUnmanaged::init_empty(WORD).unwrap();
        a.set_union(&b);
    }

    #[test]
    #[should_panic(expected = "bit sets have different lengths")]
    fn set_intersection_with_a_shorter_operand_panics() {
        let mut a = DynamicBitSetUnmanaged::init_empty(2 * WORD).unwrap();
        let b = DynamicBitSetUnmanaged::init_empty(WORD).unwrap();
        a.set_intersection(&b);
    }

    #[test]
    #[should_panic(expected = "bit sets have different lengths")]
    fn set_exclude_with_a_shorter_operand_panics() {
        let mut a = DynamicBitSetUnmanaged::init_empty(2 * WORD).unwrap();
        let b = DynamicBitSetUnmanaged::init_empty(WORD).unwrap();
        a.set_exclude(&b);
    }

    #[test]
    #[should_panic(expected = "bit sets have different lengths")]
    fn list_set_union_with_a_shorter_operand_panics() {
        let list = DynamicBitSetList::init_empty(1, 2 * WORD).unwrap();
        let other = DynamicBitSetUnmanaged::init_empty(WORD).unwrap();
        list.set_union(0, &other);
    }

    #[test]
    fn copy_into_from_a_shorter_set_clears_the_rest() {
        let mut src = DynamicBitSetUnmanaged::init_empty(3).unwrap();
        src.set(1);
        let mut dst = DynamicBitSetUnmanaged::init_empty(3 * WORD + 8).unwrap();
        dst.set_all(true);

        dst.copy_into(&src);

        assert_eq!(dst.bit_length, 3 * WORD + 8);
        assert_eq!(set_bits(&dst), [1]);
    }

    #[test]
    fn copy_into_from_a_set_with_fewer_bits_in_the_same_word_clears_the_rest() {
        let mut src = DynamicBitSetUnmanaged::init_empty(3).unwrap();
        src.set_all(true);
        let mut dst = DynamicBitSetUnmanaged::init_empty(10).unwrap();
        dst.set_all(true);

        dst.copy_into(&src);

        assert_eq!(set_bits(&dst), [0, 1, 2]);
    }

    #[test]
    fn copy_into_from_a_longer_set_truncates_and_clears_padding() {
        let mut src = DynamicBitSetUnmanaged::init_empty(3 * WORD).unwrap();
        src.set_all(true);
        let mut dst = DynamicBitSetUnmanaged::init_empty(WORD + 6).unwrap();

        dst.copy_into(&src);

        assert_eq!(dst.count(), WORD + 6);
        let mut unset = dst.iterator::<false, true>();
        assert_eq!(unset.next(), None);
    }

    #[test]
    fn copy_into_with_equal_lengths_replaces_the_contents() {
        let mut src = DynamicBitSetUnmanaged::init_empty(WORD + 6).unwrap();
        src.set(WORD + 2);
        let mut dst = DynamicBitSetUnmanaged::init_empty(WORD + 6).unwrap();
        dst.set(0);
        dst.set(WORD + 5);

        dst.copy_into(&src);

        assert_eq!(set_bits(&dst), [WORD + 2]);
    }

    #[test]
    fn copy_into_an_empty_set_is_a_no_op() {
        let mut src = DynamicBitSetUnmanaged::init_empty(WORD).unwrap();
        src.set_all(true);
        let mut dst = DynamicBitSetUnmanaged::init_empty(0).unwrap();

        dst.copy_into(&src);

        assert_eq!(dst.count(), 0);
        assert_eq!(dst.bit_length, 0);
    }

    #[test]
    fn managed_copy_into_a_larger_set_keeps_every_bit() {
        let mut old = DynamicBitSet::init_empty(WORD).unwrap();
        old.set(0);
        old.set(WORD - 1);
        let mut new = DynamicBitSet::init_empty(WORD + 1).unwrap();

        old.copy_into(&mut new);

        assert_eq!(set_bits(&new.unmanaged), [0, WORD - 1]);
        assert_eq!(new.bit_length(), WORD + 1);
    }
}
