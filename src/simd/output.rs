//! Output to memory that is not initialized. The compiler can't check this file completely.

use crate::{Isa, Lane, MaskOf, Place, Region, Simd, Source, Tag, Width};
use core::mem::MaybeUninit;
use core::ops::{Deref, DerefMut, Range};
use core::ptr::{copy, slice_from_raw_parts_mut};

/// Like a `Vec` with a fixed capacity in borrowed memory, to which vectors can be written that overlap.
///
/// ```
/// # #[bun_simd::simd] mod simd {
/// # use bun_simd::prelude::*;
/// #[kernel]
/// pub fn strip(text: &[u8], out: &mut Output<'_, u8>) {
///     for (v, valid) in over(text).padded() {
///         out.push(v.selected(v.simd_ne(b' ').to_bitmask() & valid));
///     }
/// }
/// # }
/// # use {bun_simd::prelude::*, simd::*};
/// # fn main() {
/// let mut all = b"> ".to_vec();
/// strip(b"a b c", &mut Output::append(&mut all, 3));
/// assert_eq!(all, b"> abc");
/// # }
/// ```
pub struct Output<'a, T: Copy> {
    // The invariant: `len <= to.len()`, and `to[..len]` is initialized. What is initialized from the start on stays so, also after
    // `len`: only values of `T` are written, and in `copy_back` copies of earlier places.
    to: &'a mut [MaybeUninit<T>],
    len: usize,
}

// All that touches the fields.
impl<'a, T: Copy> Output<'a, T> {
    /// Starts empty. With `let mut room = Aligned([MaybeUninit::uninit(); 1024])` and `&mut room.0`, it is scratch memory that needs no zeros.
    #[doc(alias("scratch", "uninit", "alloca"))]
    #[inline(always)]
    pub fn new(to: &'a mut [MaybeUninit<T>]) -> Self {
        Self { to, len: 0 }
    }
    /// The number of values that were written.
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.len
    }
    /// The number of values that fit.
    #[inline(always)]
    pub fn capacity(&self) -> usize {
        self.to.len()
    }
    /// How many more values fit.
    #[doc(alias("remaining_capacity", "spare_capacity"))]
    #[inline(always)]
    pub fn room(&self) -> usize {
        // A check of the result tells LLVM enough to remove those of the writes that follow.
        self.to[self.len..].len()
    }
    /// Whether there is room for both. In a loop, `more` should be the same each time.
    #[inline(always)]
    pub(crate) fn fits(&self, n: usize, more: usize) -> bool {
        let (end, overflows) = self.len.overflowing_add(n);
        !overflows && more <= self.to.len() && end <= self.to.len() - more
    }
    /// What was written.
    #[doc(alias("assume_init"))]
    #[inline(always)]
    pub fn into_filled(self) -> &'a mut [T] {
        // SAFETY: the invariant.
        #[allow(unsafe_code)]
        unsafe {
            self.to[..self.len].assume_init_mut()
        }
    }
    /// What was written so far.
    #[doc(alias("as_slice", "iter", "get", "first", "last", "to_vec"))]
    #[inline(always)]
    pub fn filled(&self) -> &[T] {
        // SAFETY: the invariant.
        #[allow(unsafe_code)]
        unsafe {
            self.to[..self.len].assume_init_ref()
        }
    }
    /// The same, to change it.
    #[doc(alias("as_mut_slice", "iter_mut", "get_mut", "last_mut", "as_chunks_mut"))]
    #[inline(always)]
    pub fn filled_mut(&mut self) -> &mut [T] {
        Output { to: &mut *self.to, len: self.len }.into_filled()
    }
    /// Forgets what is after the first `len` values.
    #[doc(alias("set_len"))]
    #[inline(always)]
    pub fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }
    /// Writes all of `values` from `at` on, and makes the length `at + min(keep, values.len())`. Panics if there is no
    /// room for all, or if `at > len()`.
    #[inline(always)]
    #[track_caller]
    fn put(&mut self, at: usize, values: &[T], keep: usize) {
        assert!(at <= self.len);
        // In a loop, all but one comparison is the same each time. LLVM doesn't always move a part of a condition out.
        assert!(values.len() <= self.to.len(), "the `Output` is too small");
        assert!(at <= self.to.len() - values.len(), "the `Output` is full");
        // SAFETY: the assertions. With `-Zub-checks`, `copy_nonoverlapping` compares addresses, which keeps vectors in memory.
        #[allow(unsafe_code)]
        unsafe {
            copy(values.as_ptr(), self.to.as_mut_ptr().cast::<T>().add(at), values.len())
        };
        self.len = at + keep.min(values.len());
    }
    /// As `limit`.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn window(&mut self, /* take room_for or limit */ room: usize) -> Appending<'_, T, usize> {
        Appending::new(&mut self.to[self.len..][..room], &mut self.len)
    }
    /// `window`, by one comparison in a loop.
    #[inline(always)]
    pub(crate) fn far(&mut self, room: usize) -> Option<Appending<'_, T, usize>> {
        if room > isize::MAX as usize {
            return if self.fits(0, room) { Some(self.window(room)) } else { None };
        }
        Some(self.room_for(room)?.all())
    }
    /// One check for the pushes and matches that follow, if `n` more values fit. It changes no result, whatever `n` is. To spare all
    /// checks, it is a constant: the sum of the most that each can write, so all lanes of a vector, and 32 bytes more than a match.
    /// After other methods that change the output, and functions that take it as `&mut Output`, each push has its check again.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut all = Vec::new();
    /// let mut out = Output::append(&mut all, 999);
    /// for (literals, distance, n) in [(2u8, 2, 3u8), (0, 5, 1)] {
    ///     let Some(mut out) = out.room_for(16 + 255 + 32) else { break };
    ///     if literals > 0 {
    ///         out.push(u8x16::iota(1).first_n(literals.into()));
    ///     }
    ///     out.extend_from_back(distance, n.into()).unwrap();
    /// }
    /// assert_eq!(out.filled(), [1, 2, 1, 2, 1, 1]);
    /// # } example()
    /// ```
    #[doc(alias("reserve", "has_room", "fits", "try_reserve"))]
    #[must_use = "it allocates nothing: push to the result"]
    #[inline(always)]
    pub fn room_for(&mut self, n: usize) -> Option<Room<'_, 'a, T>> {
        // In a loop, the right side is the same each time.
        if n > 0 && self.len >= self.to.len().saturating_sub(n - 1) {
            return None;
        }
        Some(Room { output: self, left: (n as u64).min(i64::MAX as u64) as i64 })
    }
    /// All of it, for a shorter time.
    #[inline(always)]
    pub(crate) fn again(&mut self) -> Appending<'_, T, usize> {
        let (filled, all) = (self.len, self.to.len());
        Appending::after(&mut self.to[..all], filled, &mut self.len)
    }
    /// Splits the next `K * each` values in `K` parts, which `f` has to fill, in any order. Panics if it doesn't.
    #[doc(alias("split_at_mut", "chunks_mut", "chunks_exact_mut"))]
    #[inline(always)]
    #[track_caller]
    pub fn streams<const K: usize, R>(&mut self, each: usize, f: impl FnOnce(&mut [Output<'_, T>; K]) -> R) -> R {
        let mut rest = &mut self.to[self.len..];
        let parts = [(); K].map(
            #[inline(always)]
            |()| rest.split_off_mut(..each).unwrap(),
        );
        let (result, lens) = lend(parts, f);
        for len in lens {
            assert!(len == each);
            self.len += each;
        }
        result
    }
    /// Adds `n` values, each a copy of the one `distance` before it, `N` at a time. Panics if what counts of these isn't there yet, or if there is no room for `n + N`.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn copy_back<const N: usize>(&mut self, distance: usize, n: usize, halves: bool)
    where
        T: Lane,
    {
        assert!(distance.wrapping_sub(1) < self.len && distance >= n.min(N));
        assert!(self.fits(n, N));
        assert!(N * size_of::<T>() == 2 * size_of::<Half>());
        let (start, from, mut at) = (self.to.as_mut_ptr(), self.len - distance, 0);
        loop {
            // SAFETY: `at <= n` and `distance` is 1 to `len`, so by `fits` both ranges are in `to`. They may overlap. As `distance >= min(n, N)`,
            // each value that is added comes from before `len + at`, where all is initialized by now. A `Half` has no padding.
            #[allow(unsafe_code)]
            unsafe {
                let (from, to) = (start.add(from + at), start.add(self.len + at));
                if halves {
                    let (from, to) = (from.cast::<Half>(), to.cast::<Half>());
                    let both = (from.read_unaligned(), from.add(1).read_unaligned());
                    to.write_unaligned(both.0);
                    to.add(1).write_unaligned(both.1)
                } else {
                    copy(from, to, N)
                }
            };
            at += N;
            if at >= n {
                break;
            }
            if at == 3 * N {
                ahead(start.wrapping_add(self.len).cast());
            }
        }
        self.len += n;
    }
    /// As `put`, for as many lanes from `skip` on as fit below `end`.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn put_masked<S: crate::simd::Cpu>(
        &mut self,
        at: usize,
        end: usize,
        v: impl crate::raw::Raw<Lane = T>,
        skip: usize,
        keep: usize,
    ) where
        crate::simd::Here: crate::simd::In<S>,
    {
        assert!(at <= self.len);
        let part = &mut self.to[..end][at..];
        let before = (part.as_ptr().addr(), part.len());
        let written = v.fill_by_bits(part, skip);
        assert!(written.as_ptr().addr() == before.0 && written.len() <= before.1);
        self.len = at + keep.min(written.len());
    }
}

/// Half of a step. For speed: `copy` stores the second half first, for which a match that is near waits.
type Half = MaybeUninit<Simd<u8, crate::B16, crate::Baseline>>;

/// A long match would wait for memory.
#[inline(always)]
pub(crate) fn ahead(end: *const u8) {
    for line in 4..8 {
        crate::prefetch::to_write(end.wrapping_add(64 * line));
    }
}

/// Returns for each part how many of its first values are initialized.
#[inline(always)]
fn lend<T: Copy, const K: usize, R>(
    parts: [&mut [MaybeUninit<T>]; K],
    f: impl FnOnce(&mut [Output<'_, T>; K]) -> R,
) -> (R, [usize; K]) {
    let before = parts.each_ref().map(
        #[inline(always)]
        |part| &raw const **part,
    );
    let mut outputs = parts.map(Output::new);
    let result = f(&mut outputs);
    // `f` can replace them with others, or swap them.
    for (output, before) in outputs.iter().zip(before) {
        assert!(core::ptr::eq(output.to, before));
    }
    (
        result,
        outputs.map(
            #[inline(always)]
            |output| output.len,
        ),
    )
}

/// An [`Output`] that is known to have room. See [`Output::room_for`].
#[must_use]
pub struct Room<'o, 'a, T: Copy> {
    // The invariant: `left <= capacity - len`. It can be negative.
    output: &'o mut Output<'a, T>,
    left: i64,
}

impl<'o, T: Copy> Room<'o, '_, T> {
    #[inline(always)]
    fn all(self) -> Appending<'o, T, usize> {
        let (Output { to: all, len: end }, n) = (self.output, self.left.max(0) as usize);
        // SAFETY: `len + n <= capacity` by both invariants, and `to` is borrowed for `'o`.
        #[allow(unsafe_code)]
        Appending::new(unsafe { &mut *slice_from_raw_parts_mut(all.as_mut_ptr().add(*end), n) }, end)
    }
    /// The next `n` values, if they are left. It counts down in any case, so that LLVM can follow it through a loop.
    #[inline(always)]
    pub(crate) fn take(&mut self, n: u16) -> Option<Appending<'_, T, usize>> {
        self.left = self.left.checked_sub(n as i64).unwrap();
        if self.left < 0 {
            core::hint::cold_path();
            return None;
        }
        Some(Room { output: self.output, left: n as i64 }.all())
    }
    /// The same, after what was written.
    #[inline(always)]
    pub(crate) fn take_after(&mut self, n: usize) -> Option<Appending<'_, T, usize>>
    where
        T: Lane,
    {
        if self.left < 0 || (self.left as u64) < n as u64 {
            return None;
        }
        self.left -= n as i64;
        let Output { to: all, len: end } = self.output;
        // SAFETY: `n` was at most `left`, so the same holds. A lane has a size, so no slice has more than `isize::MAX`.
        #[allow(unsafe_code)]
        let all = unsafe {
            core::hint::assert_unchecked(*end <= isize::MAX as usize);
            &mut *slice_from_raw_parts_mut(all.as_mut_ptr(), *end + n)
        };
        Some(Appending::after(all, *end, end))
    }
}

impl<'a, T: Copy> Deref for Room<'_, 'a, T> {
    type Target = Output<'a, T>;
    #[inline(always)]
    fn deref(&self) -> &Output<'a, T> {
        self.output
    }
}

impl<'a, T: Copy> DerefMut for Room<'_, 'a, T> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Output<'a, T> {
        self.left = self.left.min(0);
        self.output
    }
}

/// An [`Output`] that is added to where it came from when this is dropped. See [`Output::append`] and [`Output::limit`].
/// If it is replaced by another one, or leaked, the length stays as it is.
#[must_use = "it adds what is written to it"]
pub struct Appending<'a, T: Copy, To: Grows<T>> {
    // The invariant: `part` starts `back` values before the end of `to`, is what it grows into, and is borrowed for `'a`.
    output: Output<'a, T>,
    part: (usize, usize),
    back: usize,
    to: &'a mut To,
}

impl<'a, T: Copy, To: Grows<T>> Appending<'a, T, To> {
    #[inline(always)]
    fn new(part: &'a mut [MaybeUninit<T>], to: &'a mut To) -> Self {
        Appending::after(part, 0, to)
    }
    /// The first `filled` values are the last of `to`.
    #[inline(always)]
    fn after(part: &'a mut [MaybeUninit<T>], filled: usize, to: &'a mut To) -> Self {
        Self { part: (part.as_ptr().addr(), part.len()), back: filled, output: Output { to: part, len: filled }, to }
    }
}

impl<T: Copy, To: Grows<T>> Drop for Appending<'_, T, To> {
    #[inline(always)]
    fn drop(&mut self) {
        if (self.output.to.as_ptr().addr(), self.output.to.len()) == self.part {
            // SAFETY: `output` still has the memory of `part`, so the invariants of `Appending` and `Output` give the bounds and the values.
            // Only `again`, `take_after` and `resume` have a `back` other than 0.
            #[allow(unsafe_code)]
            unsafe {
                self.to.grow(self.back, self.output.len)
            }
        }
    }
}

impl<'a, T: Copy, To: Grows<T>> Deref for Appending<'a, T, To> {
    type Target = Output<'a, T>;
    #[inline(always)]
    fn deref(&self) -> &Output<'a, T> {
        &self.output
    }
}

impl<'a, T: Copy, To: Grows<T>> DerefMut for Appending<'a, T, To> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Output<'a, T> {
        &mut self.output
    }
}

/// Not nameable outside of this crate.
#[allow(unsafe_code)]
pub trait Grows<T>: Sized {
    /// # Safety
    /// The `added` values that start `back` before the end are in bounds, and initialized. `back` is 0 for a `String`.
    #[doc(hidden)]
    unsafe fn grow(&mut self, back: usize, added: usize);
}

/// What [`Output::append`] takes: a `Vec`, or a `String` for [`Ascii`](crate::text::Ascii).
#[diagnostic::on_unimplemented(
    message = "values of `{T}` can't be appended to `{Self}`",
    note = "`Output::overwrite` takes a slice, and `Output::new` one of `MaybeUninit`"
)]
#[allow(unsafe_code)]
pub trait Appendable<T>: Grows<T> + crate::seals::Appendable<T> {
    /// The `room` values after the end, which are not a part of `*self`, and which `grow` doesn't touch.
    ///
    /// # Safety
    /// What is initialized from the start on stays so, with values of `T`.
    #[doc(hidden)]
    unsafe fn spare(&mut self, room: usize) -> *mut [MaybeUninit<T>];
}

#[allow(unsafe_code)]
mod grows {
    use super::*;

    /// The length of an `Output`.
    impl<T> Grows<T> for usize {
        #[inline(always)]
        unsafe fn grow(&mut self, back: usize, added: usize) {
            *self = *self - back + added
        }
    }
    #[cfg(feature = "alloc")]
    impl<T> Grows<T> for alloc::vec::Vec<T> {
        #[inline(always)]
        unsafe fn grow(&mut self, back: usize, added: usize) {
            // SAFETY: the caller's.
            unsafe { self.set_len(self.len() - back + added) }
        }
    }
    #[cfg(feature = "alloc")]
    #[sealed]
    impl<T> Appendable<T> for alloc::vec::Vec<T> {
        #[inline(always)]
        unsafe fn spare(&mut self, room: usize) -> *mut [MaybeUninit<T>] {
            self.reserve(room);
            &mut self.spare_capacity_mut()[..room]
        }
    }
    #[cfg(feature = "alloc")]
    impl Grows<crate::text::Ascii> for alloc::string::String {
        #[inline(always)]
        unsafe fn grow(&mut self, _: usize, added: usize) {
            // SAFETY: the caller's. Each `Ascii` is a `u8` that is UTF-8 by itself.
            unsafe { self.as_mut_vec().grow(0, added) }
        }
    }
    #[cfg(feature = "alloc")]
    #[sealed]
    impl Appendable<crate::text::Ascii> for alloc::string::String {
        #[inline(always)]
        unsafe fn spare(&mut self, room: usize) -> *mut [MaybeUninit<crate::text::Ascii>] {
            // SAFETY: the text doesn't change, and an `Ascii` is a `u8`.
            unsafe { self.as_mut_vec().spare(room) as _ }
        }
    }

    impl<'a, T: Copy> Output<'a, T> {
        /// Reserves room for `room` more values at the end of `to`, which gets what was written when the result is dropped.
        /// It doesn't allocate if the capacity is enough, as after `try_reserve`, or for `to.capacity() - to.len()`.
        #[inline(always)]
        #[track_caller]
        pub fn append<To: Appendable<T>>(to: &'a mut To, room: usize) -> Appending<'a, T, To> {
            // SAFETY: `to` is borrowed for as long, only `grow` uses it, and the invariant of `Output` is what `spare` asks for.
            Appending::new(unsafe { &mut *to.spare(room) }, to)
        }
        /// The same, but the output starts with the last `history` values of `to`, or all if it has fewer. They count as written.
        #[cfg(feature = "alloc")]
        #[inline(always)]
        pub fn resume(
            to: &'a mut alloc::vec::Vec<T>,
            history: usize,
            room: usize,
        ) -> Appending<'a, T, alloc::vec::Vec<T>> {
            to.reserve(room);
            let history = history.min(to.len());
            // SAFETY: in the capacity. What is initialized from the start on stays so. The rest is as above.
            let part = unsafe {
                core::slice::from_raw_parts_mut(to.as_mut_ptr().add(to.len() - history).cast(), history + room)
            };
            Appending::after(part, history, to)
        }
        /// Starts empty. What lies beyond the length can change, too.
        #[inline(always)]
        pub fn overwrite(to: &'a mut [T]) -> Self {
            // SAFETY: the layout is the same, and all of it stays initialized, by the invariant.
            Output::new(unsafe { &mut *(to as *mut [T] as *mut [MaybeUninit<T>]) })
        }
    }
}

impl<'a, T: Copy> Output<'a, T> {
    /// Whether nothing was written.
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    /// Whether `n` more values fit. In a loop, this takes one comparison if `n` is a constant.
    #[inline(always)]
    pub(crate) fn has_room(&self, /* take room_for or room */ n: usize) -> bool {
        self.fits(0, n)
    }
    /// The next `n` values, as a shorter output that starts empty: a bound, or a new start for positions. Panics if there are fewer.
    /// To spare checks, take [`room_for`](Self::room_for).
    #[doc(alias("window", "take"))]
    #[inline(always)]
    #[track_caller]
    pub fn limit(&mut self, n: usize) -> Appending<'_, T, usize> {
        self.window(n)
    }
    /// Adds one value, of any type.
    #[inline(always)]
    #[track_caller]
    pub fn push_one(&mut self, value: T) {
        // LLVM sees that this implies both comparisons of `put`.
        assert!(self.len() < self.capacity(), "the `Output` is full");
        self.put(self.len(), &[value], 1)
    }
    /// Adds all values.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn extend_from_slice(&mut self, /* take push */ values: &[T]) {
        let n = values.len();
        // A call of `memcpy` takes longer, and the caller has to save its registers.
        if const { size_of::<T>() == 1 } && crate::OPTIMIZED && !is_known!(n) && n <= 16 {
            assert!(n <= self.room(), "the `Output` is full");
            let mut to = self.window(n);
            if n >= 4 {
                let (last, second) = (n - 4, (n - 4).min(4));
                let part = |at: usize| *values[at..].first_chunk::<4>().unwrap();
                let parts = [part(0), part(second), part(last - second), part(last)];
                to.put(0, &parts[0], 4);
                to.put(second, &parts[1], 4);
                to.put(last - second, &parts[2], 4);
                to.put(last, &parts[3], 4);
            } else if n > 0 {
                let parts = [values[0], values[n / 2], values[n - 1]];
                to.put(0, &parts[..1], 1);
                to.put(n / 2, &parts[1..2], 1);
                to.put(n - 1, &parts[2..], 1);
            }
            return;
        }
        self.put(self.len(), values, values.len())
    }
    /// Adds the first `n` values. It needs room for all.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn extend_first(&mut self, values: &[T], n: usize) {
        self.put(self.len(), values, n)
    }
    /// Adds all values if they fit, near the end. A call would cost the loop around it its registers.
    #[inline(always)]
    pub(crate) fn few(&mut self, values: &[T]) -> Option<()> {
        let (n, k) = (values.len(), const { if size_of::<T>() == 0 { 1 } else { 8usize.div_ceil(size_of::<T>()) } });
        if !self.has_room(n) {
            return None;
        }
        crate::window::check(self.capacity(), self.len(), n);
        let mut to = self.window(n);
        if k > 1 && n >= k {
            while to.len() < n - k {
                crate::not_unrolled();
                crate::window::check(n, to.len(), k);
                let word = &values[to.len()..][..k];
                to.extend_first(word, k);
            }
            to.put(n - k, &values[n - k..], k);
        } else {
            while to.len() < n {
                crate::not_unrolled();
                let value = values[to.len()];
                to.push_one(value);
            }
        }
        Some(())
    }
    /// Adds the values, and returns their new place, for what writes to a plain slice, such as `store_interleaved`. What
    /// is overwritten at once isn't written twice.
    #[doc(alias("fill", "resize", "advance"))]
    #[inline(always)]
    #[track_caller]
    pub fn push_array<const N: usize>(&mut self, values: [T; N]) -> &mut [T; N] {
        self.put(self.len(), &values, N);
        self.filled_mut().last_chunk_mut().unwrap()
    }
    /// Forgets all values.
    #[inline(always)]
    pub fn clear(&mut self) {
        self.truncate(0)
    }
    /// Position 0 is the present end, and a write can't leave a gap.
    #[inline(always)]
    pub(crate) fn tail(&mut self) -> Tail<'_, 'a, T> {
        Tail { start: self.len(), end: self.capacity(), output: self }
    }
}

impl<T: Lane> Output<'_, T> {
    /// Adds the first `n` lanes. It needs room for all lanes.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn push_first<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>, n: usize) {
        self.put(self.len(), v.to_array().as_ref(), n)
    }
    /// Adds the first `n` lanes. It needs room for these only, which makes it the last push to an output of the exact size.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn push_partial<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>, n: usize) {
        let n = n.min(Simd::<T, W, S>::LANES);
        assert!(n <= self.room(), "the `Output` is full");
        if const { Tag::<S, T, W>::BY_BITS && W::BYTES <= S::REGISTER } {
            return v.put_first(self.len(), self.len() + n, n, self);
        }
        if self.room() >= Simd::<T, W, S>::LANES {
            return self.push_first(v, n);
        }
        // The branches follow the room, which is easier to predict.
        let mut all = self.window(self.room());
        all.fill_up(v);
        all.truncate(n);
    }
    /// Fills the room, which is less than there are lanes.
    #[inline(always)]
    fn fill_up<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>) {
        let (room, half) = (self.room(), Simd::<T, W, S>::LANES / 2);
        if const { Simd::<T, W, S>::LANES <= 2 } {
            return if room > 0 {
                self.push_one(v.get_lane())
            };
        }
        if room < half {
            return again!(Self::fill_up, self, v.lower_half());
        }
        self.push(v.lower_half());
        if const { Simd::<T, W, S>::SLIDES } {
            return self.push_at(v.lanes_from(room - half).lower_half(), self.capacity() - half);
        }
        again!(Self::fill_up, self, v.upper_half())
    }
    /// Replaces what is from `at` on: for the last vector of a loop, which overlaps the one before.
    #[inline(always)]
    #[track_caller]
    pub fn push_at<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>, at: usize) {
        self.put(at, v.to_array().as_ref(), usize::MAX)
    }
    /// Adds the lanes whose bits are set. It needs room for all lanes.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn push_compressed_bits<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>, bits: u64) {
        let lanes = v.tag().lanes();
        let bits = bits & Simd::<T, W, S>::all_bits_of_lanes();
        if const { W::BYTES <= S::COMPRESS[size_of::<T>().trailing_zeros() as usize] } {
            let count = crate::ops::count_bits_on::<S>(bits, lanes);
            return self.push_first(v.compress_own(bits), count);
        }
        let mut out = self.window(lanes);
        if const { Simd::<T, W, S>::BY_HALVES } {
            return out.push_halves(v, bits);
        }
        again!(Output::push_compressed_bits, &mut *out, v.lower_half(), bits);
        again!(Output::push_compressed_bits, &mut *out, v.upper_half(), bits >> (lanes / 2));
    }
    /// `CompressStore`. It needs room for all lanes.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn push_compressed<S: Isa, W: Width>(&mut self, v: Simd<T, W, S>, mask: MaskOf<T, W, S>) {
        if const { !Simd::<T, W, S>::COMPACTS && !Simd::<T, W, S>::PAIR } {
            return self.push_compressed_bits(v, mask.own_bits());
        }
        if const { W::BYTES == 16 } {
            let (kept, count) = v.compress_counted(mask, false);
            return self.push_first(kept, count);
        }
        let mut out = self.window(v.tag().lanes());
        again!(Output::push_compressed, &mut *out, v.lower_half(), mask.lower_half());
        again!(Output::push_compressed, &mut *out, v.upper_half(), mask.upper_half());
    }
}

/// What is after the end of an output.
pub struct Tail<'o, 'a, T: Copy> {
    output: &'o mut Output<'a, T>,
    start: usize,
    end: usize,
}

impl<T: Copy> Tail<'_, '_, T> {
    /// Its length stays in a register.
    #[inline(always)]
    pub(crate) fn map<S: Isa, F: Lane, U: Lane, W: Width, X: Width>(
        self,
        d: Tag<S, F, W>,
        from: impl Source<F>,
        f: impl Fn(Simd<F, W, S>) -> Simd<U, X, S>,
    ) where
        for<'o, 'a> Tail<'o, 'a, T>: Place<U>,
    {
        if !from.is_empty() {
            assert!(self.start <= self.output.len());
            self.output.truncate(self.start);
            d.transform_to_output(from, &mut self.output.window(self.end - self.start), f)
        }
    }
}

impl<T: Copy> Tail<'_, '_, T> {
    /// `write_vector_n` for values that are not lanes.
    #[inline(always)]
    pub(crate) fn write_ends<S: Isa, U: Lane, W: Width>(&mut self, at: usize, v: Simd<U, W, S>)
    where
        for<'o, 'a> Tail<'o, 'a, T>: Place<U>,
    {
        assert!(at <= self.len() && self.start + at <= self.output.len());
        self.output.truncate(self.start + at);
        crate::memory::write_ends(&mut self.output.window(self.len() - at).tail(), 0, v)
    }
}

impl<T: Copy> Region for Tail<'_, '_, T> {
    #[inline(always)]
    fn len(&self) -> usize {
        self.end - self.start
    }
    #[inline(always)]
    fn slice(self, range: Range<usize>) -> Self {
        assert!(range.start <= range.end && range.end <= self.len());
        Self { start: self.start + range.start, end: self.start + range.end, ..self }
    }
}

impl<'b, T: Copy> Place<T> for Tail<'_, 'b, T> {
    const SHARED: bool = false;
    const MASKED: bool = crate::X86;
    type Again<'a>
        = Tail<'a, 'b, T>
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> Self::Again<'_> {
        Tail { output: self.output, start: self.start, end: self.end }
    }
    #[inline(always)]
    fn address(&mut self) -> Option<usize> {
        Some(self.output.filled().as_ptr().addr().wrapping_add(self.start * size_of::<T>()))
    }
    #[inline(always)]
    fn keep(&mut self, n: usize) {
        self.output.truncate(self.start.saturating_add(n))
    }
    #[inline(always)]
    fn mapped<S: Isa, F: Lane, W: Width, X: Width>(
        self,
        d: Tag<S, F, W>,
        from: impl Source<F>,
        f: impl Fn(Simd<F, W, S>) -> Simd<T, X, S>,
    ) where
        T: Lane,
    {
        self.map(d, from, f)
    }
    /// What was written after these values before is forgotten.
    #[inline(always)]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        assert!(N <= self.len() && at <= self.len() - N);
        self.output.put(self.start + at, &values, N)
    }
    #[inline(always)]
    fn uninit_address(&self) -> Option<usize> {
        Some(self.output.filled().as_ptr().addr().wrapping_add(self.start * size_of::<T>()))
    }
    #[inline(always)]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>)
    where
        T: Lane,
    {
        if const { Tag::<S, T, W>::BY_BITS && W::BYTES <= S::REGISTER } {
            assert!(at <= self.len());
            return v.put_first(self.start + at, self.end, usize::MAX, self.output);
        }
        assert!(at <= self.len() && self.start + at <= self.output.len());
        self.output.truncate(self.start + at);
        let room = self.len() - at;
        if room >= v.tag().lanes() { self.output.push(v) } else { self.output.window(room).fill_up(v) }
    }
}
