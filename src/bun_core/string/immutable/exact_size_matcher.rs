//! Port of `src/string/immutable/exact_size_matcher.zig`.
//!
//! `ExactSizeMatcher(N)` packs a short byte slice (len ≤ N) into a single
//! unsigned integer so callers can `match`/`switch` on string literals as
//! integer constants. Slices longer than N map to `T::MAX` (the "no match"
//! sentinel), and the empty slice maps to `0`.

use core::marker::PhantomData;

/// Zero-sized type carrying the `MAX_BYTES` const parameter.
///
/// Zig: `pub fn ExactSizeMatcher(comptime max_bytes: usize) type { return struct { ... } }`
pub struct ExactSizeMatcher<const MAX_BYTES: usize>(PhantomData<[u8; MAX_BYTES]>);

// Compile-time check mirroring Zig's `switch (max_bytes) { 1,2,4,8,12,16 => {}, else => @compileError }`.
// In Rust this is enforced by only providing `ExactSizeInt` impls for the valid sizes;
// any other `MAX_BYTES` fails to satisfy the trait bound at the call site.

/// Maps a `MAX_BYTES` value to its backing unsigned integer type
/// (`std.meta.Int(.unsigned, max_bytes * 8)` in Zig) and provides the
/// little-endian read primitive.
pub trait ExactSizeInt<const MAX_BYTES: usize> {
    /// The packed integer type (`u8`/`u16`/`u32`/`u64`/`u128`).
    type T: Copy + Eq + Ord;
    const ZERO: Self::T;
    const MAX: Self::T;
    /// `std.mem.readInt(T, &buf, .little)`
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

// TODO(port): Zig uses `u96` for MAX_BYTES=12; Rust has no native `u96`.
// We back it with `u128` and zero-pad the high 4 bytes. `MAX` is the true
// 96-bit max so the "too long" sentinel is distinct from any 12-byte payload.
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
    /// Zig: `pub fn match(str: anytype) T`
    ///
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

    /// Zig: `pub fn matchLower(str: anytype) T`
    #[inline]
    pub fn match_lower(str: &[u8]) -> <Self as ExactSizeInt<MAX_BYTES>>::T {
        match str.len() {
            n if n >= 1 && n < MAX_BYTES => {
                let mut tmp = [0u8; MAX_BYTES];
                // @memset(tmp[str.len..], 0) — already zeroed
                crate::strings::copy_lowercase(str, &mut tmp[..str.len()]);
                Self::read_le(&tmp)
            }
            n if n == MAX_BYTES => {
                // PORT NOTE: Zig does NOT lowercase in the `== max_bytes` arm (matches
                // upstream behavior exactly — likely a latent Zig bug, preserved here).
                let arr: &[u8; MAX_BYTES] = str.try_into().expect("len == MAX_BYTES");
                Self::read_le(arr)
            }
            0 => Self::ZERO,
            _ => Self::MAX,
        }
    }

    /// Zig: `pub fn case(comptime str: []const u8) T`
    ///
    /// Runtime variant. For const-position (Zig's comptime use in `switch`
    /// arms), use the [`exact_case!`] macro below — `const fn` cannot call
    /// the non-const trait method `read_le` on stable.
    #[inline(always)]
    pub fn case(str: &'static [u8]) -> <Self as ExactSizeInt<MAX_BYTES>>::T {
        // if (str.len < max_bytes) { zero-pad } else if (== max_bytes) { read } else { @compileError }
        // PORT NOTE: reshaped — Zig branches on `<` vs `==` vs `@compileError`;
        // here we assert `<=` (the compile error) and unify the two valid arms.
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

/// Const-position equivalent of `ExactSizeMatcher::<N>::case(b"..")` for the
/// common N (1/2/4/8/16). Expands to a `<uN>::from_le_bytes` of a zero-padded
/// literal, which IS const-evaluable.
///
/// Usage: `match ExactSizeMatcher::<4>::r#match(s) { exact_case!(4, b"foo") => .., _ => .. }`
#[macro_export]
macro_rules! exact_case {
    (1,  $s:expr) => {{
        const _A: [u8; 1] = $crate::string::immutable::exact_size_matcher::__pad::<1>($s);
        u8::from_le_bytes(_A)
    }};
    (2,  $s:expr) => {{
        const _A: [u8; 2] = $crate::string::immutable::exact_size_matcher::__pad::<2>($s);
        u16::from_le_bytes(_A)
    }};
    (4,  $s:expr) => {{
        const _A: [u8; 4] = $crate::string::immutable::exact_size_matcher::__pad::<4>($s);
        u32::from_le_bytes(_A)
    }};
    (8,  $s:expr) => {{
        const _A: [u8; 8] = $crate::string::immutable::exact_size_matcher::__pad::<8>($s);
        u64::from_le_bytes(_A)
    }};
    (12, $s:expr) => {{
        const _A: [u8; 16] = $crate::string::immutable::exact_size_matcher::__pad::<16>(
            &$crate::string::immutable::exact_size_matcher::__pad::<12>($s),
        );
        u128::from_le_bytes(_A)
    }};
    (16, $s:expr) => {{
        const _A: [u8; 16] = $crate::string::immutable::exact_size_matcher::__pad::<16>($s);
        u128::from_le_bytes(_A)
    }};
}

#[doc(hidden)]
pub const fn __pad<const N: usize>(s: &[u8]) -> [u8; N] {
    assert!(s.len() <= N, "str too long for exact_case!");
    let mut out = [0u8; N];
    let mut i = 0;
    while i < s.len() {
        out[i] = s[i];
        i += 1;
    }
    out
}

// ported from: src/string/immutable/exact_size_matcher.zig
