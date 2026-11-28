//! Sums of slices in 64 bits.

use crate::{Isa, Over, Readable, Simd, Width};

type V<T, S> = Simd<T, crate::generic::Native<S>, S>;

/// `$short` takes up to `$few` values, and `$part` up to `$most`.
macro_rules! sums { ($($(#[$m:meta])* $t:ident $sum:ident $long:ident, |$d:ident, $x:ident| $few:expr => $short:expr, $most:expr => $part:expr;)*) => {$(
    impl<W: Width, S: Isa, E: Readable<$t>> Over<'_, $t, W, S, E> {
        /// The sum in 64 bits, which wraps.
        $(#[$m])*
        #[op]
        pub fn sum_wide(self) -> $sum {
            let (s, $x) = self.parts();
            let $d = s.full::<$t>();
            if $x.len() > $few {
                return $long(s, $x);
            }
            $short
        }
    }
    #[crate::simd]
    #[inline(never)]
    fn $long<S: Isa, E: Readable<$t>>(s: S, mut values: &[E]) -> $sum {
        let ($d, mut all): (_, $sum) = (s.full::<$t>(), 0);
        while !values.is_empty() {
            let ($x, rest) = values.split_at(values.len().min($most));
            (all, values) = (all.wrapping_add($part), rest);
        }
        all
    }
)*}; }
macro_rules! groups {
    ($d:ident $x:ident $u:ident) => {
        $d.add_up::<$u>($x, 0, always!(|sum, v: V<_, S>| sum + v.sum_groups()))
    };
}
/// On Arm a lane of 16 bits gets up to 128 pairs, which just fit.
macro_rules! bytes {
    ($d:ident $x:ident $u:ident $w:ident $sum:ident) => {
        choose! { S::ARM => groups!($d $x $u).sum_groups::<$w>().reduce_sum() as $sum, _ => groups!($d $x $sum).reduce_sum() }
    };
}
macro_rules! i8s {
    ($d:ident $x:ident) => {
        choose! {
            crate::X86 => ($d.add_up::<u64>($x, i8::MIN, always!(|sum, v: V<i8, S>| sum + (v ^ i8::MIN).cast_unsigned().sum_groups())).reduce_sum() as i64)
                .wrapping_sub(($x.len() as i64).wrapping_mul(128)),
            _ => bytes!($d $x i16 i32 i64),
        }
    };
}
macro_rules! i16s {
    ($d:ident $x:ident) => {
        choose! { crate::X86 => $d.add_up::<i32>($x, 0, always!(|sum, v: V<i16, S>| v.dot_add::<i32>(1, sum))), _ => groups!($d $x i32) }.reduce_sum() as i64
    };
}
macro_rules! u16s {
    ($d:ident $x:ident) => {
        choose! {
            crate::X86 => ($d.add_up::<i32>($x, 1 << 15, always!(|sum, v: V<u16, S>| (v.cast_signed() ^ i16::MIN).dot_add::<i32>(1, sum))).reduce_sum() as u32)
                .wrapping_add(($x.len() as u32) << 15),
            _ => groups!($d $x u32).reduce_sum(),
        } as u64
    };
}
/// The sum of the lower halves is what the upper halves leave of the sum that wraps.
macro_rules! halves {
    ($d:ident $x:ident $t:ident $sum:ident) => {
        choose! {
            crate::X86 => {
                let step = always!(|(all, upper), v: V<$t, S>| (all + v, upper + (v >> 16)));
                let join = always!(|a: (V<$t, S>, V<$t, S>), b: (_, _)| (a.0 + b.0, a.1 + b.1));
                let (all, upper) = $d.fold_in::<false, true, _>($x, 0, ($d.zero(), $d.zero()), step, join);
                let upper = upper.reduce_sum();
                ((upper as $sum) << 16) + all.reduce_sum().wrapping_sub(upper << 16) as u32 as $sum
            },
            _ => groups!($d $x $sum).reduce_sum(),
        }
    };
}
const fn pairs<S: Isa>() -> usize {
    if S::ARM { 128 * S::Native::BYTES } else { usize::MAX }
}
const HALVES: usize = 1 << 15;
sums! {
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(over(&[200u8; 100]).sum_wide(), 20000);
    /// # } example()
    /// ```
    #[doc(alias("sum_u64", "widening_sum", "total"))]
    u8 u64 long_u8, |d, x| const { pairs::<S>() } => bytes!(d x u16 u32 u64), const { pairs::<S>() } => bytes!(d x u16 u32 u64);
    i8 i64 long_i8, |d, x| const { pairs::<S>() } => i8s!(d x), const { pairs::<S>() } => i8s!(d x);
    u16 u64 long_u16, |d, x| HALVES => u16s!(d x), HALVES => u16s!(d x);
    i16 i64 long_i16, |d, x| HALVES => i16s!(d x), HALVES => i16s!(d x);
    u32 u64 long_u32, |d, x| if crate::X86 { 511 } else { usize::MAX } => groups!(d x u64).reduce_sum(), HALVES => halves!(d x u32 u64);
    i32 i64 long_i32, |d, x| if crate::X86 { 511 } else { usize::MAX } => groups!(d x i64).reduce_sum(), HALVES => halves!(d x i32 i64);
}
