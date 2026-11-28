//! Rectangles in memory, such as blocks of an image.

use crate::stream::{AnyBytes, Lendable, Streamed, Streaming};
use core::{fmt, marker::PhantomData, ptr::slice_from_raw_parts_mut};

/// `height` rows of `width` values, each `stride` values after the one before it. Rows can overlap, as for steps that load or store more than they move on.
///
/// The bounds are checked when it is made. A row then takes one comparison with the height, which LLVM removes in a loop over `0..height`, but not in reverse or for an array of `Rows`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let image: Vec<u8> = (0..100).collect();
/// let block = Rows::new(&image, 10, 10, 10).at(2, 3, 4, 4);
/// assert_eq!(u8x4::load(block.row(1)), [42, 43, 44, 45]);
/// # } example()
/// ```
#[doc(alias("stride", "pitch", "image", "planes", "tile", "2d", "border"))]
pub struct Rows<'a, T>(Area<T, &'a [T]>);

/// [`Rows`] that can be changed, and split among threads.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut image = [0u8; 100];
/// let (left, right) = RowsMut::new(&mut image, 10, 10, 10).split_at_column(4);
/// std::thread::scope(|threads| {
///     for (mut part, value) in [(left, 1), (right, 2)] {
///         threads.spawn(move || (0..10).for_each(|y| part.row(y).fill(value)));
///     }
/// });
/// assert_eq!(image[20..30], [1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
/// # } example()
/// ```
#[doc(alias("split", "panel", "par_chunks_mut"))]
pub struct RowsMut<'a, T>(Area<T, &'a mut [T]>);

/// A reference to all that is between the first value and the last would include the columns of others.
struct Area<T, Borrow> {
    // The invariant: each row is in the slice at `base`, which `new` and `part` check, and is borrowed as `Borrow` would be.
    // The parts of a split share no value, as the rows are `apart`.
    base: *const T,
    start: usize,
    stride: usize,
    width: usize,
    height: usize,
    borrow: PhantomData<Borrow>,
}
macro_rules! like { ($($marker:ident)*) => {$(
    // SAFETY: it gives what `Borrow` gives.
    #[allow(unsafe_code)]
    unsafe impl<T, Borrow: $marker> $marker for Area<T, Borrow> {}
)*}; }
like!(Send Sync);

impl<T, Borrow> Area<T, Borrow> {
    #[inline(always)]
    #[track_caller]
    fn new(base: *const T, len: usize, stride: usize, width: usize, height: usize) -> Self {
        let (last, overflows) = height.saturating_sub(1).overflowing_mul(stride);
        let (end, carries) = last.overflowing_add(width);
        // In a loop, the first is mostly the same each time.
        assert!(!overflows && !carries, "the rows end after the slice");
        assert!(end <= len || height == 0, "the rows end after the slice");
        Area { base, start: 0, stride, width, height, borrow: PhantomData }
    }
    #[inline(always)]
    #[track_caller]
    fn part<B>(&self, x: usize, y: usize, width: usize, height: usize) -> Area<T, B> {
        assert!(width <= self.width && x <= self.width - width);
        assert!(height <= self.height && y <= self.height - height);
        let start = self.start.wrapping_add(y.wrapping_mul(self.stride).wrapping_add(x));
        Area { base: self.base, start, stride: self.stride, width, height, borrow: PhantomData }
    }
    #[inline(always)]
    #[track_caller]
    fn before_row(&self, y: usize) -> usize {
        assert!(y < self.height);
        y.wrapping_mul(self.stride)
    }
    #[inline(always)]
    #[track_caller]
    fn apart(&self) {
        assert!(self.width <= self.stride || self.height <= 1, "the rows overlap");
    }
}

impl<T> Copy for Area<T, &[T]> {}
impl<T> Clone for Area<T, &[T]> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Rows<'_, T> {}
impl<T> Clone for Rows<'_, T> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T: fmt::Debug> fmt::Debug for Rows<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_list().entries((0..self.height()).map(|y| self.row(y))).finish()
    }
}
impl<T: fmt::Debug> fmt::Debug for RowsMut<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.rows().fmt(f)
    }
}

impl<'a, T> Rows<'a, T> {
    /// The first row is at the start of `values`. Panics if the last one ends after them.
    #[inline(always)]
    #[track_caller]
    pub fn new(values: &'a [T], stride: usize, width: usize, height: usize) -> Self {
        Self(Area::new(values.as_ptr(), values.len(), stride, width, height))
    }
    /// The number of values in a row.
    #[inline(always)]
    pub fn width(&self) -> usize {
        self.0.width
    }
    /// The number of rows.
    #[inline(always)]
    pub fn height(&self) -> usize {
        self.0.height
    }
    /// Panics if there is no such row.
    #[inline(always)]
    #[track_caller]
    pub fn row(self, y: usize) -> &'a [T] {
        let skip = self.0.before_row(y);
        // SAFETY: the invariant. With `wrapping_add`, LLVM would count each row of a loop by itself,
        // and look for null where an `Option` has a part of the row. With one `add` of the sum, it makes longer code.
        #[allow(unsafe_code)]
        unsafe {
            &*slice_from_raw_parts_mut(self.0.base.add(self.0.start).add(skip).cast_mut(), self.0.width)
        }
    }
    /// A rectangle in this one. Panics if it sticks out.
    #[inline(always)]
    #[track_caller]
    pub fn at(self, x: usize, y: usize, width: usize, height: usize) -> Self {
        Self(self.0.part(x, y, width, height))
    }
}

impl<'a, T> RowsMut<'a, T> {
    /// Like [`Rows::new`].
    #[inline(always)]
    #[track_caller]
    pub fn new(values: &'a mut [T], stride: usize, width: usize, height: usize) -> Self {
        Self(Area::new(values.as_mut_ptr(), values.len(), stride, width, height))
    }
    /// The number of values in a row.
    #[inline(always)]
    pub fn width(&self) -> usize {
        self.0.width
    }
    /// The number of rows.
    #[inline(always)]
    pub fn height(&self) -> usize {
        self.0.height
    }
    #[inline(always)]
    #[track_caller]
    fn into_row(self, y: usize) -> &'a mut [T] {
        let skip = self.0.before_row(y);
        // SAFETY: the invariant. `self` is used up.
        #[allow(unsafe_code)]
        unsafe {
            &mut *slice_from_raw_parts_mut(self.0.base.add(self.0.start).add(skip).cast_mut(), self.0.width)
        }
    }
    /// Panics if there is no such row.
    #[inline(always)]
    #[track_caller]
    pub fn row(&mut self, y: usize) -> &mut [T] {
        self.at(0, 0, self.0.width, self.0.height).into_row(y)
    }
    /// The `K` rows from `y` on, at the same time. Panics if they are not all there, or if rows overlap.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (pixels, mut planes) = ([[1u8, 2, 3]; 10], [0; 48]);
    /// over(pixels.as_flattened()).interleaved().unzip_into(RowsMut::new(&mut planes, 16, 10, 3).rows_mut::<3>(0), |rgb: [_; 3]| rgb);
    /// assert_eq!((planes[9], planes[10], planes[16], planes[32]), (1, 0, 2, 3));
    /// # } example()
    /// ```
    #[doc(alias("get_disjoint_mut", "get_many_mut"))]
    #[inline(always)]
    #[track_caller]
    pub fn rows_mut<const K: usize>(&mut self, y: usize) -> [&mut [T]; K] {
        let mut rest = self.at(0, y, self.0.width, K);
        let mut all = [(); K].map(|()| -> &mut [T] { &mut [] });
        for row in &mut all {
            let first;
            (first, rest) = rest.split_at_row(1);
            *row = first.into_row(0);
        }
        all
    }
    /// A rectangle in this one. Panics if it sticks out.
    #[inline(always)]
    #[track_caller]
    pub fn at(&mut self, x: usize, y: usize, width: usize, height: usize) -> RowsMut<'_, T> {
        RowsMut(self.0.part(x, y, width, height))
    }
    /// The rows before `y`, and the others. Panics if there are fewer, or if rows overlap.
    #[inline(always)]
    #[track_caller]
    pub fn split_at_row(self, y: usize) -> (Self, Self) {
        let all = self.0;
        all.apart();
        (Self(all.part(0, 0, all.width, y)), Self(all.part(0, y, all.width, all.height - y)))
    }
    /// The columns before `x`, and the others. Panics if there are fewer, or if rows overlap.
    #[inline(always)]
    #[track_caller]
    pub fn split_at_column(self, x: usize) -> (Self, Self) {
        let all = self.0;
        all.apart();
        (Self(all.part(0, 0, x, all.height)), Self(all.part(x, 0, all.width - x, all.height)))
    }
    /// For reading.
    #[inline(always)]
    pub fn rows(&self) -> Rows<'_, T> {
        Rows(self.0.part(0, 0, self.0.width, self.0.height))
    }
}

#[sealed]
impl<'scope, E: AnyBytes> Lendable<'scope> for RowsMut<'scope, E> {
    type Lent = Rows<'scope, Streamed<E::Lane>>;
    #[inline(always)]
    fn lent(self, s: Streaming<'scope, '_>) -> Self::Lent {
        s.wait();
        let Area { base, start, stride, width, height, borrow: _ } = self.0;
        Rows(Area { base: base.cast(), start, stride, width, height, borrow: PhantomData })
    }
}
