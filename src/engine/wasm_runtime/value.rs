//! Values as the run time passes them around.

use core::num::NonZeroUsize;

use bun_engine_wasm_compiler::abi::{INT32_TAG, NULL};

/// A value of any type, in the low bits. The others are zero.
pub type Bits = u128;

/// The address of a cell in the heap of the host.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct HostCell(pub NonZeroUsize);

impl HostCell {
    #[inline]
    pub fn address(self) -> usize {
        self.0.get()
    }

    #[inline]
    pub(crate) fn field<T>(self, offset: i32) -> *mut T {
        core::ptr::with_exposed_provenance_mut(self.address() + offset as usize)
    }
}

/// A JavaScript value.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(transparent)]
pub struct Reference(pub u64);

const DOUBLE_OFFSET: u64 = 1 << 49;
const NOT_CELL_MASK: u64 = INT32_TAG | NULL as u64;
const I31_RANGE: core::ops::Range<i32> = -(1 << 30)..1 << 30;

impl Reference {
    pub const NULL: Self = Self(NULL as u64);

    /// From the low 31 bits.
    #[inline]
    pub fn from_i31(value: i32) -> Self {
        Self(INT32_TAG | u64::from((value << 1 >> 1) as u32))
    }

    #[inline]
    pub fn is_null(self) -> bool {
        self == Self::NULL
    }

    /// Below `any`.
    #[inline]
    pub fn is_i31(self) -> bool {
        self.0 >= INT32_TAG
    }

    #[inline]
    pub fn cell(self) -> Option<HostCell> {
        if self.0 & NOT_CELL_MASK == 0 {
            NonZeroUsize::new(self.0 as usize).map(HostCell)
        } else {
            None
        }
    }

    /// The form that a value of the host has below `any`: a number is an int32 if and only if it fits in an `i31ref`.
    pub fn internalized(self) -> Self {
        if self.0 >= INT32_TAG {
            let value = self.0 as i32;
            return if I31_RANGE.contains(&value) {
                self
            } else {
                Self(f64::from(value).to_bits() + DOUBLE_OFFSET)
            };
        }
        if self.0 & INT32_TAG == 0 {
            return self;
        }
        let bits = self.0 - DOUBLE_OFFSET;
        let value = f64::from_bits(bits) as i32;
        if I31_RANGE.contains(&value) && f64::from(value).to_bits() == bits {
            Self::from_i31(value)
        } else {
            self
        }
    }
}

impl From<HostCell> for Reference {
    #[inline]
    fn from(cell: HostCell) -> Self {
        Self(cell.address() as u64)
    }
}

impl From<Reference> for Bits {
    #[inline]
    fn from(reference: Reference) -> Self {
        reference.0.into()
    }
}

#[cfg(test)]
mod tests {
    use super::{DOUBLE_OFFSET, INT32_TAG, Reference};

    #[test]
    fn numbers_are_internalized_by_their_range() {
        let int32 = |value: i32| Reference(INT32_TAG | u64::from(value as u32));
        let double = |value: f64| Reference(value.to_bits() + DOUBLE_OFFSET);
        for value in [0, 1, -1, (1 << 30) - 1, -(1 << 30)] {
            assert_eq!(int32(value).internalized(), int32(value));
            assert_eq!(double(value.into()).internalized(), int32(value));
            assert_eq!(Reference::from_i31(value), int32(value));
        }
        for value in [1 << 30, -(1 << 30) - 1, i32::MAX, i32::MIN] {
            assert_eq!(int32(value).internalized(), double(value.into()));
            assert_eq!(double(value.into()).internalized(), double(value.into()));
        }
        for value in [-0.0, 0.5, 1e300, f64::NAN, f64::NEG_INFINITY] {
            assert_eq!(double(value).internalized(), double(value));
        }
        for other in [0x02, 0x06, 0x07, 0x0a, 0x7f00_1234_5670] {
            assert_eq!(Reference(other).internalized(), Reference(other));
        }
        assert!(Reference(0x02).is_null() && !int32(2).is_null());
        assert_eq!(Reference::from_i31(0x7fff_ffff), int32(-1));
        assert_eq!(Reference::from_i31(i32::MIN), int32(0));
    }
}
