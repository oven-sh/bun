//! Arrays that are made in the function that asks for them.

use core::ops::{IndexMut, Range, RangeFrom, RangeFull, RangeInclusive, RangeTo, RangeToInclusive};

/// Or else the vectors go through the stack if `f` is long.
const fn unrolled<T, const N: usize>() -> bool {
    N <= 16 || N <= 32 && size_of::<T>() >= 16
}

/// [`core::array::from_fn`], but always inlined, and unrolled for up to 32 vectors.
///
/// With more than one codegen unit, which is the default of cargo, the one of `core` often stays a function of its own.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let text = *b"0123456789abcdef";
/// let rows: [u8x4<S>; 4] = array::from_fn(|i| u8x4::load(&text[4 * i..]));
/// assert_eq!(rows[3], *b"cdef");
/// # } example()
/// ```
#[inline(always)]
pub fn from_fn</* else core::array::from_fn */ T: Copy, const N: usize>(mut f: impl FnMut(usize) -> T) -> [T; N] {
    return_if!(N == 0 || !unrolled::<T, N>() || !crate::OPTIMIZED, own::from_fn(f));
    // A check in the loop or after it would make LLVM move the last of several chains behind it, where it is alone.
    let first = f(0);
    // For a constant, LLVM would call `memset_pattern16`.
    let mut all = if cfg!(target_vendor = "apple") { own::from_fn(always!(|_| first)) } else { [first; N] };
    unrolled!(32 theirs, for i in 1..const N {
        all[i] = f(i);
    });
    all
}

/// [`array.map(f)`](primitive@array#method.map), but always inlined, and for what is `Copy`. See [`from_fn`].
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let [a, b] = array::map([u8x4::splat(1), u8x4::splat(2)], |v| v.cast::<u32>() << 8);
/// assert_eq!(a + b, 0x300);
/// # } example()
/// ```
#[inline(always)]
pub fn map<
    T: Copy, // Else from_fn(|i| f(&array[i])), or array.map(f) if f has no vectors.
    U: Copy, // Else array.map(f).
    const N: usize,
>(
    array: [T; N],
    mut f: impl FnMut(T) -> U,
) -> [U; N] {
    from_fn(
        #[inline(always)]
        |i| f(array[i]),
    )
}

/// What is known of an array whose length depends on a parameter: `a[i]`, `a[..]` and other ranges.
#[doc(hidden)]
pub trait Lanes<T>:
    AsRef<[T]>
    + AsMut<[T]>
    + crate::SliceMut<Item = T>
    + IndexMut<usize, Output = T>
    + IndexMut<RangeFull, Output = [T]>
    + IndexMut<Range<usize>, Output = [T]>
    + IndexMut<RangeFrom<usize>, Output = [T]>
    + IndexMut<RangeTo<usize>, Output = [T]>
    + IndexMut<RangeInclusive<usize>, Output = [T]>
    + IndexMut<RangeToInclusive<usize>, Output = [T]>
{
}
impl<T, const N: usize> Lanes<T> for [T; N] {}

/// For the crate, with one call of `f`, which takes less time to compile.
pub(crate) mod own {
    use crate::Output;
    use core::mem::MaybeUninit;

    #[inline(always)]
    pub(crate) fn from_fn<T: Copy, const N: usize>(mut f: impl FnMut(usize) -> T) -> [T; N] {
        let mut all = [const { MaybeUninit::uninit() }; N];
        let (mut out, mut i) = (Output::new(&mut all), 0);
        if const { super::unrolled::<T, N>() } {
            unrolled!(32, for i in 0..const N {
                out.push_one(f(i));
            });
        } else {
            while i < N {
                out.push_one(f(i));
                i += 1;
            }
        }
        *out.into_filled().first_chunk().unwrap()
    }
    #[inline(always)]
    pub(crate) fn map<T: Copy, U: Copy, const N: usize>(array: [T; N], mut f: impl FnMut(T) -> U) -> [U; N] {
        from_fn(
            #[inline(always)]
            |i| f(array[i]),
        )
    }
}
