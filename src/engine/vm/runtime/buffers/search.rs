use bun_highway::elements::Lane;

use super::element::{Bits, Element};
use super::slice::BufferSlice;

/// The bits that count, and what they are in an element that is strictly equal to `needle`, which is not NaN.
#[inline(always)]
fn mask_and_bits<T: Element>(needle: T) -> (u64, u64) {
    let (bits, magnitude) = (needle.to_bits().into(), !T::TYPE.sign_bit());
    if T::TYPE.is_float() && bits & magnitude == 0 {
        (magnitude, 0)
    } else {
        (u64::MAX, bits)
    }
}

impl<T: Element> BufferSlice<'_, T> {
    #[inline(always)]
    fn found(self, index: usize) -> Option<usize> {
        (index < self.len()).then_some(index)
    }

    /// By IsStrictlyEqual.
    #[inline]
    pub fn index_of(self, needle: T) -> Option<usize> {
        if needle.is_nan() {
            return None;
        }
        let ((mask, bits), lanes) = (mask_and_bits(needle), self.bits());
        if self.is_short() {
            return lanes.iter().position(|it| it.into() & mask == bits);
        }
        let (mask, bits) = (Bits::truncate(mask), Bits::truncate(bits));
        // SAFETY: readable, and long enough.
        self.found(unsafe { Lane::index_of_masked(lanes.as_ptr(), lanes.len(), mask, bits) })
    }

    /// By IsStrictlyEqual.
    #[inline]
    pub fn last_index_of(self, needle: T) -> Option<usize> {
        if needle.is_nan() {
            return None;
        }
        let ((mask, bits), lanes) = (mask_and_bits(needle), self.bits());
        if self.is_short() {
            return lanes.iter().rposition(|it| it.into() & mask == bits);
        }
        let (mask, bits) = (Bits::truncate(mask), Bits::truncate(bits));
        // SAFETY: as above.
        self.found(unsafe { Lane::last_index_of_masked(lanes.as_ptr(), lanes.len(), mask, bits) })
    }

    /// By SameValueZero.
    #[inline]
    pub fn contains(self, needle: T) -> bool {
        if !needle.is_nan() {
            return self.index_of(needle).is_some();
        }
        if self.is_short() {
            return self.iter().any(T::is_nan);
        }
        let (lanes, infinity) = (self.bits(), Bits::truncate(T::TYPE.bits_of_infinity()));
        // SAFETY: as above.
        unsafe {
            Lane::index_of_magnitude_above(lanes.as_ptr(), lanes.len(), infinity) < self.len()
        }
    }

    /// Whether sorting would leave them as they are. It may miss that.
    #[inline]
    pub fn is_known_to_be_sorted(self) -> bool {
        let (lanes, length) = (self.bits().as_ptr(), self.len());
        let flip = if T::TYPE.is_signed() {
            0
        } else {
            T::TYPE.sign_bit()
        };
        // SAFETY: as above.
        !self.is_short()
            && unsafe {
                if T::TYPE.is_float() {
                    let infinity = Bits::truncate(T::TYPE.bits_of_infinity());
                    Lane::are_floats_ascending(lanes, length, infinity)
                } else {
                    Lane::are_integers_ascending(lanes, length, Bits::truncate(flip))
                }
            }
    }
}
