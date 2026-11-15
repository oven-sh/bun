//! Output to memory that may be uninitialized. A `&mut [T]` comes back for the part that was written.
use alloc::vec::Vec;
use core::mem::MaybeUninit;
use core::simd::{Mask, MaskElement, Simd, SimdElement, cmp::SimdPartialOrd};

/// A slice that can only be written to, and only with initialized values.
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
fn write<T: Copy, const N: usize>(to: &mut [MaybeUninit<T>; N], values: [T; N]) {
    to.write_copy_of_slice(&values);
}

/// `len` is at most `N`.
#[inline(always)]
fn last_lanes<M: MaskElement, const N: usize>(len: usize) -> Mask<M, N> {
    const { assert!(N < 256) };
    let index = Simd::from_array(core::array::from_fn(|i| i as u8));
    index.simd_ge(Simd::splat((N - len) as u8)).cast()
}

/// To the last lanes if `from` is too short, after zeros. What the load skips is before `from`.
#[inline(always)]
pub fn load_masked_to_last<T: SimdElement + Default, const N: usize>(from: &[T]) -> Simd<T, N> {
    let len = from.len().min(N);
    let lane_0 = from.as_ptr().wrapping_sub(N - len);
    // SAFETY: lane `i` comes from `lane_0.wrapping_add(i)`, which is in `from` for the last `len` lanes.
    unsafe { Simd::load_select_ptr(lane_0, last_lanes(len), Simd::default()) }
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
        let chunks: *mut [[MaybeUninit<T>; N]] = self.0.as_chunks_mut().0;
        // SAFETY: the layout is the same.
        Out(unsafe { &mut *(chunks as *mut [MaybeUninit<[T; N]>]) })
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
        'fill: {
            let Some((_, last)) = from.split_last_chunk() else {
                break 'fill;
            };
            let chunks = from[..len - 1].as_chunks().0;
            #[cfg_attr(target_arch = "aarch64", rustc_unroll(4))]
            for (from, to) in chunks.iter().zip(all[..len - 1].as_chunks_mut().0) {
                let Some(values) = f(filled, from) else {
                    break 'fill;
                };
                write(to, values);
                filled += N;
            }
            // Up to `N` are left.
            if let (Some(values), Some((_, to))) = (f(len - N, last), all.split_last_chunk_mut()) {
                write(to, values);
                filled = len;
            }
        }
        Writer { all, len: filled }.finish()
    }

    /// Gives `self` back unless the two fit and cover all of it.
    #[inline(always)]
    pub fn fill_ends<const N: usize>(
        self,
        first: [T; N],
        last: [T; N],
    ) -> Result<&'a mut [T], Self> {
        let len = self.len();
        if len > 2 * N {
            return Err(self);
        }
        let Some(start) = self.0.first_chunk_mut() else {
            return Err(self);
        };
        write(start, first);
        if let Some((_, end)) = self.0.split_last_chunk_mut() {
            write(end, last);
        }
        Ok(Writer { all: self.0, len }.finish())
    }

    /// As many lanes as fit, with a masked store.
    #[inline(always)]
    pub fn fill_masked<const N: usize>(self, lanes: Simd<T, N>) -> &'a mut [T]
    where
        T: SimdElement,
    {
        const { assert!(N < 256) };
        let len = self.len().min(N);
        let index = Simd::from_array(core::array::from_fn(|i| i as u8));
        let enable = index.simd_lt(Simd::splat(len as u8)).cast();
        // SAFETY: the first `len` lanes are enabled, and `self` has that many.
        unsafe { lanes.store_select_ptr(self.0.as_mut_ptr().cast(), enable) };
        Writer { all: self.0, len }.finish()
    }

    /// The same for the last lanes. What the store skips is before `self`.
    #[inline(always)]
    pub fn fill_masked_from_last<const N: usize>(self, lanes: Simd<T, N>) -> &'a mut [T]
    where
        T: SimdElement,
    {
        let len = self.len().min(N);
        let lane_0 = self.0.as_mut_ptr().cast::<T>().wrapping_sub(N - len);
        // SAFETY: lane `i` goes to `lane_0.wrapping_add(i)`, which is in `self` for the last `len` lanes.
        unsafe { lanes.store_select_ptr(lane_0, last_lanes(len)) };
        Writer { all: self.0, len }.finish()
    }
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

    /// Panics if they do not fit.
    #[inline(always)]
    pub fn push<const N: usize>(&mut self, values: [T; N]) {
        self.push_first(values, N);
    }

    /// Keeps up to `count`. Panics unless all of `values` fit.
    #[inline(always)]
    pub fn push_first<const N: usize>(&mut self, values: [T; N], count: usize) {
        write(self.rest().first_chunk_mut().unwrap(), values);
        self.len += count.min(N);
    }

    /// Panics if they do not fit.
    #[inline(always)]
    pub fn extend_from_slice(&mut self, values: &[T]) {
        self.rest()[..values.len()].write_copy_of_slice(values);
        self.len += values.len();
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

    /// Panics if `fill` returns anything but a prefix of what it is given.
    #[inline(always)]
    pub fn append(&mut self, fill: impl for<'b> FnOnce(Out<'b, T>) -> &'b mut [T]) {
        let rest = self.rest();
        let (start, room) = (rest.as_ptr().cast(), rest.len());
        let filled = fill(Out(rest));
        assert!(filled.is_empty() || filled.as_ptr() == start && filled.len() <= room);
        self.len += filled.len();
    }

    #[inline(always)]
    pub fn finish(self) -> &'a mut [T] {
        // SAFETY: `all[..len]` is in bounds and initialized.
        unsafe { self.all.get_unchecked_mut(..self.len).assume_init_mut() }
    }
}

/// Like `Writer::append`, with room for `additional` elements.
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
