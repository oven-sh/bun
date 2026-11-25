//! Arithmetic that cannot overflow, for where the checks of hardened builds take too long.

pub const trait Bounded {
    fn plus(self, other: Self) -> Self;
    fn minus(self, other: Self) -> Self;
    fn times(self, other: Self) -> Self;
}

macro_rules! bounded {
    ($($type:ty)*) => {$(
        const impl Bounded for $type {
            #[inline(always)]
            fn plus(self, other: Self) -> Self {
                debug_assert!(self.checked_add(other).is_some());
                self.wrapping_add(other)
            }

            #[inline(always)]
            fn minus(self, other: Self) -> Self {
                debug_assert!(self.checked_sub(other).is_some());
                self.wrapping_sub(other)
            }

            #[inline(always)]
            fn times(self, other: Self) -> Self {
                debug_assert!(self.checked_mul(other).is_some());
                self.wrapping_mul(other)
            }
        }
    )*};
}

bounded!(u8 u16 u32 u64 usize i32 isize);
