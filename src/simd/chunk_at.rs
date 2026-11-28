//! Arrays at an index.

/// A part of a slice as an array, with one check.
pub trait ChunkAt<T>: crate::seals::ChunkAt<T> {
    /// The `N` values from `at` on, if they are all there. It is one check in a loop, where `[at..].first_chunk()`, `[at..][..N]` and `get(at..at + N)` have two or three. Offsets `& (M - 1)` in an array with room beyond `M`, a power of two, need none.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let text = b"abcdef";
    /// assert_eq!(text.chunk_at(2), Some(b"cde"));
    /// assert_eq!(text.chunk_at::<3>(4), None);
    /// # } example()
    /// ```
    #[doc(alias("window", "array_at", "first_chunk", "get_chunk"))]
    fn chunk_at<const N: usize>(&self, at: usize) -> Option<&[T; N]>;
    /// The same, to change them.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (v, mut to, mut len) = (u8x4::from(b"a b "), [0; 8], 0);
    /// while let Some(room) = to.chunk_at_mut::<4>(len) {
    ///     len += v.compress_store(room, v.simd_ne(b' '));
    /// }
    /// assert_eq!(to[..len], *b"ababab");
    /// # } example()
    /// ```
    #[doc(alias("compress_store_at", "first_chunk_mut"))]
    fn chunk_at_mut<const N: usize>(&mut self, at: usize) -> Option<&mut [T; N]>;
}

#[sealed]
impl<T> ChunkAt<T> for [T] {
    #[op]
    fn chunk_at<const N: usize>(&self, at: usize) -> Option<&[T; N]> {
        if self.len() < N || at > self.len() - N {
            return None;
        }
        crate::window::check(self.len(), at, N);
        self[at..].first_chunk()
    }
    #[op]
    fn chunk_at_mut<const N: usize>(&mut self, at: usize) -> Option<&mut [T; N]> {
        if self.len() < N || at > self.len() - N {
            return None;
        }
        crate::window::check(self.len(), at, N);
        self[at..].first_chunk_mut()
    }
}

/// A part of an array at a constant place, which the compiler checks.
pub trait SubArray<T>: crate::seals::SubArray<T> {
    /// The `N` values from `AT` on. If they are not all there, `cargo build` fails. `&array[AT..]` is a slice, whose length is a value.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"abcdef".sub_array::<2, _>()), *b"cdef");
    /// assert_eq!(u8xN::load([7; 128].sub_array::<64, 64>()), u8xN::splat(7));
    /// # } example()
    /// ```
    #[doc(alias("subarray", "split_array_ref", "array_ref"))]
    fn sub_array<const AT: usize, const N: usize>(&self) -> &[T; N];
    /// The same, to change them.
    #[doc(alias("split_array_mut", "array_mut_ref"))]
    fn sub_array_mut<const AT: usize, const N: usize>(&mut self) -> &mut [T; N];
}

#[sealed]
impl<T, const ALL: usize> SubArray<T> for [T; ALL] {
    #[op]
    #[track_caller]
    fn sub_array<const AT: usize, const N: usize>(&self) -> &[T; N] {
        require!(of(Self, [(); AT], [(); N]), "the part ends after the array", AT as u128 + N as u128 <= ALL as u128);
        self[AT..].first_chunk().unwrap()
    }
    #[op]
    #[track_caller]
    fn sub_array_mut<const AT: usize, const N: usize>(&mut self) -> &mut [T; N] {
        require!(of(Self, [(); AT], [(); N]), "the part ends after the array", AT as u128 + N as u128 <= ALL as u128);
        self[AT..].first_chunk_mut().unwrap()
    }
}

/// An array of arrays as one, whose length the compiler checks.
pub trait FlatArray<T>: crate::seals::FlatArray<T> {
    /// All values. If they are not `N`, `cargo build` fails. `as_flattened` makes a slice, whose length is a value.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let pixels = [*b"RGBA", *b"rgba"];
    /// assert_eq!(u8x8::from(pixels.flat_array()), *b"RGBArgba");
    /// assert_eq!(u8x4::load_last(pixels.flat_array::<8>()), *b"rgba");
    /// # } example()
    /// ```
    #[doc(alias("as_flattened"))]
    fn flat_array<const N: usize>(&self) -> &[T; N];
    /// The same, to change them.
    #[doc(alias("as_flattened_mut"))]
    fn flat_array_mut<const N: usize>(&mut self) -> &mut [T; N];
}

#[sealed]
impl<T, const EACH: usize, const K: usize> FlatArray<T> for [[T; EACH]; K] {
    #[op]
    #[track_caller]
    fn flat_array<const N: usize>(&self) -> &[T; N] {
        require!(of(Self, [(); N]), "the arrays have another number of values", N as u128 == K as u128 * EACH as u128);
        self.as_flattened().first_chunk().unwrap()
    }
    #[op]
    #[track_caller]
    fn flat_array_mut<const N: usize>(&mut self) -> &mut [T; N] {
        require!(of(Self, [(); N]), "the arrays have another number of values", N as u128 == K as u128 * EACH as u128);
        self.as_flattened_mut().first_chunk_mut().unwrap()
    }
}
