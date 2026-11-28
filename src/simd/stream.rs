//! Stores that go around the caches. Until the thread has run a fence, they can happen at any time.

#![deny(asm_sub_register)]

use crate::{Isa, Lane, Place, Simd, Width};
use core::{cell::UnsafeCell, marker::PhantomData, mem::MaybeUninit};

/// The room for an `E` in memory that is lent by [`Streaming::lend`]. It can only be written, as a slice of these is a [`Sink`](crate::Sink), and it stays in its thread.
#[repr(transparent)]
pub struct Streamed<E>(UnsafeCell<MaybeUninit<E>>);

/// What [`streaming`] gives to its closure.
#[derive(Copy, Clone)]
pub struct Streaming<'scope, 'env: 'scope>(PhantomData<(*mut &'scope (), *mut &'env ())>);

/// Runs `f`, in which stores to what is lent go around the caches on x86-64, and then waits for these stores. It is for loops of one's own, for
/// several outputs, and for many short ones, if what is written is larger than the caches, or is not read soon. What fits them gets up to ten times slower.
///
/// - A whole vector of 16 bytes or more goes around if its address is a multiple of its size, or of that of a register. All else is a plain store.
///   [`map_into`](crate::Over::map_into) and [`scan_into`](crate::Over::scan_into) find such addresses by themselves, unless their closure returns an array.
/// - All 64 bytes of a cache line should be written one after the other, and once. A CPU has room for about ten lines that are not complete. If a place is written again, the last value counts, but it is slow.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (from, mut even, mut odd) = (vec![[1u8, 2]; 256], Aligned([0; 256]), Aligned([0; 256]));
/// streaming(|s| {
///     let (mut even, mut odd) = (s.lend(&mut even[..]), s.lend(&mut odd[..]));
///     for at in (0..256).step_by(64) {
///         let [a, b] = u8x64::load_interleaved(from[at..].as_flattened());
///         a.store_at(&mut even, at);
///         b.store_at(&mut odd, at);
///     }
/// });
/// assert_eq!((even.0, odd.0), ([1; 256], [2; 256]));
/// # } example()
/// ```
#[doc(alias("Stream", "FlushStream", "non_temporal", "nontemporal", "movnt", "movntdq", "sfence", "stream_si512"))]
#[inline(always)]
pub fn streaming<'env, R>(f: impl for<'scope> FnOnce(Streaming<'scope, 'env>) -> R) -> R {
    let _fence = Fence;
    f(Streaming(PhantomData))
}

impl<'scope> Streaming<'scope, '_> {
    /// Borrows `to` until the end of [`streaming`]. On x86-64, it waits for the stores so far, so many short outputs should be lent first, or as one that is split.
    #[inline(always)]
    pub fn lend<L: Lendable<'scope>>(self, to: L) -> L::Lent {
        to.lent(self)
    }
    /// For `lent`.
    #[inline(always)]
    pub(crate) fn wait(self) {
        drop(Fence)
    }
}

/// What [`Streaming::lend`] takes: `&mut` of a slice, an array or a `Vec` of lanes or of `MaybeUninit` of them, or [`RowsMut`](crate::mem::RowsMut).
#[diagnostic::on_unimplemented(message = "`{Self}` can't be lent", note = "`&mut x[..]` makes a slice")]
pub trait Lendable<'scope>: crate::seals::Lendable<'scope> {
    /// A slice of [`Streamed`], or [`Rows`](crate::mem::Rows) of them.
    type Lent;
    #[doc(hidden)]
    fn lent(self, s: Streaming<'scope, '_>) -> Self::Lent;
}

/// Any bytes are a value of this type, which has the layout of the lane.
pub trait AnyBytes {
    type Lane: Lane;
}
impl<T: Lane> AnyBytes for T {
    type Lane = T;
}
impl<T: Lane> AnyBytes for MaybeUninit<T> {
    type Lane = T;
}

#[sealed]
impl<'scope, E: AnyBytes> Lendable<'scope> for &'scope mut [E] {
    type Lent = &'scope [Streamed<E::Lane>];
    #[inline(always)]
    fn lent(self, s: Streaming<'scope, '_>) -> Self::Lent {
        s.wait();
        // SAFETY: the layout is the same, and only initialized bytes are written.
        #[allow(unsafe_code)]
        unsafe {
            &*(self as *mut [E] as *const [Streamed<E::Lane>])
        }
    }
}

/// Around a plain store.
#[inline(always)]
fn barrier() {
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst)
}
macro_rules! cached { ($($name:ident[$($g:tt)*]($value:ty) $write:path, $room:expr;)*) => {$(
    #[inline(always)]
    #[track_caller]
    pub(crate) fn $name<T: Lane, $($g)*>(to: &[Streamed<T>], value: $value) {
        // The check comes before the reference.
        let to = &to[$room];
        // SAFETY: it is an `UnsafeCell` and not `Sync`, so only this thread can write. The reference goes to `$write` alone,
        // which has the room it needs, stores lanes, and runs nothing else.
        #[allow(unsafe_code, invalid_reference_casting)]
        let mut to = unsafe { &mut *(to as *const [Streamed<T>] as *mut [MaybeUninit<T>]) };
        barrier();
        $write(&mut to, 0, value);
        barrier()
    }
)*}; }
cached! {
    values[const N: usize]([T; N]) Place::<T>::write, ..N;
    vector[W: Width, S: Isa](Simd<T, W, S>) Place::<T>::write_vector, ..Simd::<T, W, S>::LANES;
    vector_n[W: Width, S: Isa](Simd<T, W, S>) Place::<T>::write_vector_n, ..;
    ends[W: Width, S: Isa](Simd<T, W, S>) crate::memory::write_ends, ..;
}

/// The bytes of a slice that was lent.
pub struct Part<'a>(*mut u8, usize, PhantomData<&'a ()>);
impl<'a> Part<'a> {
    #[inline(always)]
    pub fn of<E>(to: &'a [Streamed<E>]) -> Self {
        Part(to.as_ptr().cast_mut().cast(), size_of_val(to), PhantomData)
    }
}

macro_rules! run { ($template:literal, $($operands:tt)*) => {
    // SAFETY: a fence is always allowed. A store is aligned, and writes a `Part`, which is borrowed until after the fence.
    #[allow(unsafe_code)]
    unsafe {
        core::arch::asm!($template, $($operands)* options(nostack, preserves_flags))
    }
}; }

struct Fence;
impl Drop for Fence {
    #[inline(always)]
    fn drop(&mut self) {
        #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
        run!("sfence",)
    }
}

macro_rules! stores { ($($feature:literal $t:ident, $class:ident, $name:ident $template:literal;)*) => {$(
    #[cfg(all(target_arch = "x86_64", target_feature = "sse2", not(miri)))]
    #[inline]
    #[target_feature(enable = $feature)]
    pub fn $name(Part(to, len, _): Part<'_>, v: core::arch::x86_64::$t) {
        assert!(len == size_of_val(&v) && to.addr() % size_of_val(&v) == 0);
        // Above a pointer of 32 bits the register could hold anything.
        cfg_select! {
            target_pointer_width = "64" => { run!($template, p = in(reg) to, v = in($class) v,) }
            _ => { run!($template, "/* {q:e} */", p = in(reg) to.addr() as u64, v = in($class) v, q = in(reg) to,) }
        }
    }
)*}; }
stores! {
    "sse2" __m128i, xmm_reg, store_16_sse "movntdq [{p}], {v}";
    "avx" __m128i, xmm_reg, store_16 "vmovntdq [{p}], {v}";
    "avx" __m256i, ymm_reg, store_32 "vmovntdq [{p}], {v}";
    "avx512f" __m512i, zmm_reg, store_64 "vmovntdq [{p}], {v}";
}
