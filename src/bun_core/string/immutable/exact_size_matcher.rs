//! `ExactSizeMatcher(N)` packs a short byte slice (len ≤ N) into a single
//! unsigned integer so callers can `match`/`switch` on string literals as
//! integer constants. Slices longer than N map to `T::MAX` (the "no match"
//! sentinel), and the empty slice maps to `0`.

use core::marker::PhantomData;

/// Zero-sized type carrying the `MAX_BYTES` const parameter.
pub struct ExactSizeMatcher<const MAX_BYTES: usize>(PhantomData<[u8; MAX_BYTES]>);

// Only the valid sizes (1, 2, 4, 8, 12, 16) get `ExactSizeInt` impls;
// any other `MAX_BYTES` fails to satisfy the trait bound at the call site.

/// Maps a `MAX_BYTES` value to its backing unsigned integer type and provides
/// the little-endian read primitive.
pub trait ExactSizeInt<const MAX_BYTES: usize> {
    /// The packed integer type (`u8`/`u16`/`u32`/`u64`/`u128`).
    type T: Copy + Eq + Ord;
    const ZERO: Self::T;
    const MAX: Self::T;
    /// Read `Self::T` from `buf` as little-endian.
    fn read_le(buf: &[u8; MAX_BYTES]) -> Self::T;
}

macro_rules! impl_exact_size_int {
    ($n:literal, $t:ty) => {
        impl ExactSizeInt<$n> for ExactSizeMatcher<$n> {
            type T = $t;
            const ZERO: $t = 0;
            const MAX: $t = <$t>::MAX;
            #[inline(always)]
            fn read_le(buf: &[u8; $n]) -> $t {
                <$t>::from_le_bytes(*buf)
            }
        }
    };
}

impl_exact_size_int!(1, u8);
impl_exact_size_int!(2, u16);
impl_exact_size_int!(4, u32);
impl_exact_size_int!(8, u64);
impl_exact_size_int!(16, u128);

// MAX_BYTES=12 would want a `u96`; Rust has no native `u96`, so we back it
// with `u128` and zero-pad the high 4 bytes. `MAX` is the true 96-bit max so
// the "too long" sentinel is distinct from any 12-byte payload.
impl ExactSizeInt<12> for ExactSizeMatcher<12> {
    type T = u128;
    const ZERO: u128 = 0;
    const MAX: u128 = (1u128 << 96) - 1;
    #[inline(always)]
    fn read_le(buf: &[u8; 12]) -> u128 {
        let mut tmp = [0u8; 16];
        tmp[..12].copy_from_slice(buf);
        u128::from_le_bytes(tmp)
    }
}

impl<const MAX_BYTES: usize> ExactSizeMatcher<MAX_BYTES>
where
    Self: ExactSizeInt<MAX_BYTES>,
{
    /// `r#match` because `match` is a Rust keyword.
    #[inline]
    pub fn r#match(str: &[u8]) -> <Self as ExactSizeInt<MAX_BYTES>>::T {
        match str.len() {
            // 1..=MAX_BYTES-1
            n if n >= 1 && n < MAX_BYTES => {
                let mut tmp = [0u8; MAX_BYTES];
                // @memcpy(tmp[0..str.len], str); @memset(tmp[str.len..], 0);
                tmp[..n].copy_from_slice(str);
                Self::read_le(&tmp)
            }
            n if n == MAX_BYTES => {
                // SAFETY: n == MAX_BYTES, so the slice is exactly MAX_BYTES long.
                let arr: &[u8; MAX_BYTES] = str.try_into().expect("len == MAX_BYTES");
                Self::read_le(arr)
            }
            0 => Self::ZERO,
            _ => Self::MAX,
        }
    }

    #[inline(always)]
    pub fn case(str: &'static [u8]) -> <Self as ExactSizeInt<MAX_BYTES>>::T {
        assert!(
            str.len() <= MAX_BYTES,
            "str too long for ExactSizeMatcher::case"
        );
        let mut bytes = [0u8; MAX_BYTES];
        let mut i = 0;
        while i < str.len() {
            bytes[i] = str[i];
            i += 1;
        }
        Self::read_le(&bytes)
    }
}
