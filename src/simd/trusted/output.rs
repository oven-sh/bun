//! Output to memory that may be uninitialized.
use crate::{SharedOutU8, SharedU8, copy_to_shared, loads::lanes_before};
use alloc::vec::Vec;
use core::cell::Cell;
use core::io::BorrowedCursor;
use core::mem::MaybeUninit;
use core::simd::{Simd, SimdElement};
use core::slice;

/// A slice that can only be written to. A `&mut [T]` comes back for the part that was written.
pub struct Out<'a, T>(&'a mut [MaybeUninit<T>]);

impl<'a, T: Copy> From<&'a mut [T]> for Out<'a, T> {
    #[inline(always)]
    fn from(slice: &'a mut [T]) -> Self {
        // SAFETY: the layout is the same, and an `Out` writes only initialized values.
        Self(unsafe { &mut *(&raw mut *slice as *mut [MaybeUninit<T>]) })
    }
}

impl<'a, T: Copy> From<&'a mut [MaybeUninit<T>]> for Out<'a, T> {
    #[inline(always)]
    fn from(slice: &'a mut [MaybeUninit<T>]) -> Self {
        Self(slice)
    }
}

#[inline(always)]
fn transposed<T, const N: usize>(chunks: &mut [[MaybeUninit<T>; N]]) -> &mut [MaybeUninit<[T; N]>] {
    // SAFETY: the layout is the same.
    unsafe { &mut *(&raw mut *chunks as *mut [MaybeUninit<[T; N]>]) }
}

#[inline(always)]
fn write<T: Copy, const N: usize>(to: &mut [MaybeUninit<T>; N], values: [T; N]) -> &mut [T] {
    transposed(slice::from_mut(to))[0].write(values)
}

/// Where four pieces start that cover `piece..=4 * piece` elements.
#[inline(always)]
pub const fn quarters(len: usize, piece: usize) -> [usize; 4] {
    let room = len - piece;
    let inset = if room < piece { room } else { piece };
    [0, inset, room - inset, room]
}

/// Chunks per turn of a loop. For x86-64, LLVM finds a good number.
pub const UNROLL: usize = if cfg!(any(target_arch = "aarch64", miri)) {
    4
} else {
    1
};

/// Adds what it writes to `filled`.
#[inline(always)]
fn fill_each<A, T: Copy, const N: usize>(
    from: &[[A; N]],
    to: &mut [[MaybeUninit<T>; N]],
    filled: &mut usize,
    f: &mut impl FnMut(usize, &[A; N]) -> Option<[T; N]>,
) -> Option<()> {
    for (from, to) in from.iter().zip(to) {
        write(to, f(*filled, from)?);
        *filled += N;
    }
    Some(())
}

impl<'a, T: Copy> Out<'a, T> {
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    #[inline(always)]
    pub fn as_ptr(&self) -> *const T {
        self.0.as_ptr().cast()
    }

    /// Up to `len` elements from the start.
    #[inline(always)]
    pub fn take(self, len: usize) -> Self {
        let len = len.min(self.len());
        Self(&mut self.0[..len])
    }

    /// Without what is left over.
    #[inline(always)]
    pub fn into_chunks<const N: usize>(self) -> Out<'a, [T; N]> {
        Out(transposed(self.0.as_chunks_mut().0))
    }

    /// Its bytes, for what also writes to shared memory.
    #[inline(always)]
    pub fn into_shared(self) -> &'a [SharedOutU8]
    where
        T: SimdElement,
    {
        SharedOutU8::from_cells(Cell::from_mut(self.0).as_slice_of_cells())
    }

    #[inline(always)]
    pub fn into_writer(self) -> Writer<'a, T> {
        Writer {
            all: self.0,
            len: 0,
        }
    }

    /// `f(index, chunk)` for each chunk of `from`, until it is `None`. The last chunk overlaps.
    #[inline(always)]
    pub fn fill_chunks<A, const N: usize>(
        self,
        from: &[A],
        mut f: impl FnMut(usize, &[A; N]) -> Option<[T; N]>,
    ) -> &'a mut [T] {
        let len = from.len().min(self.len());
        let (from, all) = (&from[..len], &mut self.0[..len]);
        let mut filled = 0;
        let _: Option<()> = try {
            let last = from.split_last_chunk()?.1;
            let (chunks, rest) = from[..len - 1].as_chunks().0.as_chunks::<UNROLL>();
            let (to, to_rest) = all[..len - 1].as_chunks_mut().0.as_chunks_mut::<UNROLL>();
            for (from, to) in chunks.iter().zip(to) {
                fill_each(from, to, &mut filled, &mut f)?;
            }
            fill_each(rest, to_rest, &mut filled, &mut f)?;
            // Up to `N` are left.
            write(all.split_last_chunk_mut()?.1, f(len - N, last)?);
            filled = len;
        };
        Writer { all, len: filled }.finish()
    }

    /// Puts the pieces at `quarters`. Does nothing unless they fit and cover all of `self`.
    #[inline(always)]
    pub fn fill_quarters<const N: usize>(self, [a, b, c, d]: [[T; N]; 4]) -> &'a mut [T] {
        let (len, all) = (self.len(), self.0);
        if len < N || len > 4 * N {
            return &mut [];
        }
        let inset = quarters(len, N)[1];
        write(all.first_chunk_mut().unwrap(), a);
        write(all[inset..].first_chunk_mut().unwrap(), b);
        write(all[..len - inset].split_last_chunk_mut().unwrap().1, c);
        write(all.split_last_chunk_mut().unwrap().1, d);
        Writer { all, len }.finish()
    }

    /// As many lanes as fit, with a masked store.
    #[inline(always)]
    pub fn fill_masked<const N: usize>(self, lanes: Simd<T, N>) -> &'a mut [T]
    where
        T: SimdElement,
    {
        let len = self.len().min(N);
        let enable = lanes_before::<T, N>(len);
        // SAFETY: the first `len` lanes are enabled, and `self` has that many.
        unsafe { lanes.store_select_ptr(self.0.as_mut_ptr().cast(), enable) };
        Writer { all: self.0, len }.finish()
    }

    /// As many of the last bytes as fit.
    #[cfg(target_arch = "x86_64")]
    #[inline]
    #[target_feature(enable = "avx512bw")]
    pub fn fill_from_last(self, bytes: core::simd::u8x64) -> &'a mut [T]
    where
        T: SimdElement,
    {
        crate::shared::store64_masked::<true>(bytes, Out(&mut *self.0).into_shared());
        let len = self.len().min(64 / size_of::<T>());
        Writer { all: self.0, len }.finish()
    }
}

/// As many bytes as fit.
#[inline(always)]
pub fn copy_from_shared<'a>(from: &[SharedU8], Out(all): Out<'a, u8>) -> &'a mut [u8] {
    let len = copy_to_shared(from, Out(&mut *all).into_shared());
    Writer { all, len }.finish()
}

/// Fills an `Out` from the start.
pub struct Writer<'a, T> {
    all: &'a mut [MaybeUninit<T>],
    /// `all[..len]` is initialized.
    len: usize,
}

impl<'a, T: Copy> Writer<'a, T> {
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline(always)]
    pub fn remaining(&self) -> usize {
        self.all.len() - self.len
    }

    #[inline(always)]
    fn rest(&mut self) -> &mut [MaybeUninit<T>] {
        // SAFETY: `len` is in bounds.
        unsafe { self.all.get_unchecked_mut(self.len..) }
    }

    /// Forgets what follows the first `len` elements, so that the next ones overwrite it.
    #[inline(always)]
    pub fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }

    /// Panics if they do not fit.
    #[inline(always)]
    pub fn push<const N: usize>(&mut self, values: [T; N]) {
        self.push_first(values, N);
    }

    /// Keeps up to `count`. Panics unless all of `values` fit.
    #[inline(always)]
    pub fn push_first<const N: usize>(&mut self, values: [T; N], count: usize) {
        self.append(|to| &mut write(to.0.first_chunk_mut().unwrap(), values)[..count.min(N)]);
    }

    /// Panics if they do not fit.
    #[inline(always)]
    pub fn extend_from_slice(&mut self, values: &[T]) {
        self.append(|to| to.0[..values.len()].write_copy_of_slice(values));
    }

    /// Pushes `f(item)` for each item, until it is `None` or there is no room.
    #[inline(always)]
    pub fn extend_with<A, const N: usize>(
        &mut self,
        items: impl IntoIterator<Item = A>,
        mut f: impl FnMut(A) -> Option<[T; N]>,
    ) {
        let mut added = 0;
        for (to, item) in self.rest().as_chunks_mut().0.iter_mut().zip(items) {
            let Some(values) = f(item) else { break };
            write(to, values);
            added += N;
        }
        self.len += added;
    }

    /// Panics if `fill` returns a slice that starts elsewhere.
    #[inline(always)]
    pub fn append(&mut self, fill: impl for<'b> FnOnce(Out<'b, T>) -> &'b mut [T]) {
        let rest = self.rest();
        let (start, room) = (rest.as_ptr().cast(), rest.len());
        let filled = fill(Out(rest));
        assert!(filled.is_empty() || filled.as_ptr() == start);
        self.len += filled.len().min(room);
    }

    #[inline(always)]
    pub fn finish(self) -> &'a mut [T] {
        // SAFETY: `all[..len]` is in bounds and initialized.
        unsafe { self.all.get_unchecked_mut(..self.len).assume_init_mut() }
    }
}

/// Panics if `fill` returns anything but a prefix of the room for `additional` elements.
#[inline(always)]
pub fn extend_vec<T: Copy>(
    vec: &mut Vec<T>,
    additional: usize,
    fill: impl for<'b> FnOnce(Out<'b, T>) -> &'b mut [T],
) {
    vec.reserve(additional);
    let (spare, rest) = spare_capacity(vec);
    rest.append(fill(spare.take(additional)));
}

/// Never allocates, and leaves the length as it is until `Append::append`.
#[inline(always)]
pub fn spare_capacity<T: Copy>(vec: &mut Vec<T>) -> (Out<'_, T>, Append<'_, T>) {
    let spare: *mut [MaybeUninit<T>] = vec.spare_capacity_mut();
    // SAFETY: `Append` neither touches nor moves the spare capacity.
    (Out(unsafe { &mut *spare }), Append(vec))
}

pub struct Append<'a, T>(&'a mut Vec<T>);

impl<'a, T: Copy> Append<'a, T> {
    /// Panics if `filled` is anything but a prefix of the spare capacity.
    #[inline(always)]
    pub fn append(self, filled: &'a mut [T]) {
        let (len, room) = (self.0.len(), self.0.capacity() - self.0.len());
        let start = self.0.as_ptr().wrapping_add(len);
        assert!(filled.is_empty() || filled.as_ptr() == start && filled.len() <= room);
        // SAFETY: that many elements of the spare capacity are initialized.
        unsafe { self.0.set_len(len + filled.len()) };
    }
}

/// Panics if `fill` returns a slice that starts elsewhere.
#[inline(always)]
pub fn extend_cursor<T: Copy>(
    mut cursor: BorrowedCursor<'_, T>,
    fill: impl for<'b> FnOnce(Out<'b, T>) -> &'b mut [T],
) {
    // SAFETY: an `Out` writes only initialized values.
    let mut writer = Out(unsafe { cursor.as_mut() }).into_writer();
    writer.append(fill);
    let filled = writer.len;
    // SAFETY: that many elements are initialized.
    unsafe { cursor.advance(filled) };
}
