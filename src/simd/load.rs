//! Loads and stores.

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// The first lanes of `from`. Panics if it is too short.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load(b"abcdef"), *b"abcd");
    /// # } example()
    /// ```
    #[doc(alias("Load", "LoadU", "from_slice", "loadu", "read"))]
    load[](from: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized)) -> crate::Simd<T, W, $S> = |d| crate::Slice::read_first(from, d);
    /// `load(&from[at..])` with one check in a loop. Each call has its own: for several vectors, take an array by [`chunk_at`](crate::mem::ChunkAt::chunk_at), for several slices [`zip`](crate::Over::zip) them, and for steps of a stride take [`Rows`](crate::mem::Rows) on x86.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_at(b"abcdef", 1), *b"bcde");
    /// # } example()
    /// ```
    load_at[](from: &[impl crate::Readable<T>], at: usize) -> crate::Simd<T, W, $S> = |d| d.load_any_at(from, at);
    /// The last lanes of `from`. Panics if it is too short.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_last(b"abcdef"), *b"cdef");
    /// # } example()
    /// ```
    load_last[](from: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized)) -> crate::Simd<T, W, $S> = |d| crate::Slice::read_last(from, d);
    /// From little-endian bytes, on all CPUs. With `swap_bytes` after it, from big-endian ones. Panics if there are too few.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u16x2::load_bytes(&[1, 0, 0, 1]), [1, 256]);
    /// # } example()
    /// ```
    #[doc(alias("from_ne_bytes", "from_le_bytes", "from_be_bytes"))]
    load_bytes[](from: &(impl crate::Slice<Item = impl crate::Readable<u8>> + ?Sized)) -> crate::Simd<T, W, $S> = |d| d.repartition::<u8>().load_any(crate::whole::has::<crate::whole::Bytes<T, W>, _>(from)).bitcast();
    /// For an operation on each value of a slice that is shorter than a vector. Each value is in one lane or more, in an
    /// order that depends only on the length and the target. `store_short` undoes it, also for lanes of another type. Of a slice that is not shorter, both take unspecified parts.
    /// It is what `map_into` does with short slices, for a loop of one's own. With AVX-512, [`load_row`](Self::load_row) is faster for several rows.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 5];
    /// u8x16::load_short(b"hello").to_ascii_uppercase().store_short(&mut to);
    /// assert_eq!(&to, b"HELLO");
    /// # } example()
    /// ```
    load_short[](from: &[impl crate::Readable<T>]) -> crate::Simd<T, W, $S> = |d| d.load_any_short(from);
    /// As many lanes as `from` has, and then those of `or`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_or(b"ab", b' '), *b"ab  ");
    /// # } example()
    /// ```
    #[doc(alias("LoadNOr"))]
    load_or[](from: &[impl crate::Readable<T>], or: impl crate::Operand<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.load_any_or(from, or);
    /// As many lanes as `from` has, and then zeros.
    ///
    /// It is for tails, and takes a few nanoseconds: masked accesses of x86 come with a test for the end of a page, beyond which they are very slow.
    /// With AVX-512, a slice of less than four vectors (two for bytes in `B128`, one below 16 bytes and beyond two registers) takes masked accesses, with one test for up to four registers of 64 bytes, so that short inputs have no branch that is hard to predict. In a loop, [`load_padded`](Self::load_padded) is faster, and for several short rows [`load_row`](Self::load_row), which has no such test.
    /// A short array such as `[f32; 3]` takes one or two plain loads.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u32x4::load_or_default(&[1, 2]), [1, 2, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias("LoadN", "load_partial", "partial_load", "load_n"))]
    load_or_default[](from: &[impl crate::Readable<T>]) -> crate::Simd<T, W, $S> = |d| d.load_whole_or_rest(from);
    /// Like `load_or`, for a slice that is nearly always long enough, such as what is left of the input of a parser.
    /// The result is the same, but the code for short slices is kept out of the way. For the tail after a loop, `load_or` is better.
    load_padded[](from: &[impl crate::Readable<T>], pad: T) -> crate::Simd<T, W, $S> = |d| d.load_any_padded(from, pad);
    /// `load_or_default(from.row(y))`, for a loop over rows that are shorter than the vector. With AVX-512 it is one instruction for each register, so that the last rows need no loop of their own. That holds from 16 bytes to two registers, for up to 64 lanes.
    ///
    /// Then it has no test for the end of a page. A row that ends within a vector of a page that is not present, as the last ones can, takes 250 to 600 cycles. A load and a store of such rows took 2500 on Zen 4.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_row(Rows::new(b"abcdef", 3, 2, 2), 1), *b"de\0\0");
    /// # } example()
    /// ```
    load_row[](from: crate::Rows<'_, T>, y: usize) -> crate::Simd<T, W, $S> = |d| d.load_row(from, y);
    /// `or` where `enable` is false or `from` has ended.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_select(&[1, 2, 3], mask8x4::from_bitmask(0b1110), 9), [9, 2, 3, 9]);
    /// # } example()
    /// ```
    #[doc(alias("MaskedLoadOr", "load_masked"))]
    load_select[](from: &[impl crate::Readable<T>], enable: impl crate::Keep<T, W, $S>, or: impl crate::Operand<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.within_slice(crate::Keep::as_mask(enable, d.simd()), from.len()).if_then_else(d.load_any_n(from), or);
    /// Zero where `enable` is false or `from` has ended.
    #[doc(alias("MaskedLoad"))]
    load_select_or_default[](from: &[impl crate::Readable<T>], enable: impl crate::Keep<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.masked_load_any(crate::Keep::as_mask(enable, d.simd()), from);
    /// The first values of `from` go where `enable` is true, and the others are zero.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_expand(&[1, 2], mask8x4::from_bitmask(0b1010)), [0, 1, 0, 2]);
    /// # } example()
    /// ```
    #[doc(alias("LoadExpand"))]
    load_expand[](from: &[impl crate::Readable<T>], enable: impl crate::Keep<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.load_expanded(from, enable, None);
    /// The same, but the others are those of `or`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::load_expand_or(&[1, 2], 0b1010, 9), [9, 1, 9, 2]);
    /// # } example()
    /// ```
    #[doc(alias("mask_expandloadu"))]
    load_expand_or[](from: &[impl crate::Readable<T>], enable: impl crate::Keep<T, W, $S>, or: impl crate::Operand<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.load_expanded(from, enable, Some(crate::Operand::vector(or, d)));
    /// The first 16 bytes of `from` in each block. Panics if it is too short. `repeat` takes an array.
    #[doc(alias("LoadDup128", "load_dup128", "vbroadcasti128"))]
    load_block[](from: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized)) -> crate::Simd<T, W, $S> = |d| crate::Tag::<_, T, crate::B16>::new(d.simd()).staged(crate::whole::has::<crate::whole::Block<T, W>, _>(from), 16 / size_of::<T>(), #[inline(always)] |from| d.load_dup128_shared(from));
    /// Splits `a0 b0 c0 a1 b1 c1 ..`, such as pixels, into `[a, b, c]`, for `K` from 1 to 16. Panics if `from` is shorter than `K` vectors.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [r, g, b] = u8x4::load_interleaved(b"RGBrgbRGBrgb");
    /// assert_eq!((r.to_array(), g.to_array(), b.to_array()), (*b"RrRr", *b"GgGg", *b"BbBb"));
    /// # } example()
    /// ```
    #[doc(alias("LoadInterleaved2", "LoadInterleaved3", "LoadInterleaved4", "load_deinterleaved", "ld2", "ld3", "ld4"))]
    load_interleaved[const K: usize](from: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized)) -> [crate::Simd<T, W, $S>; K] = const crate::make::Fits::<K>::RECORDS; |d| d.load_interleaved_any(crate::whole::has::<crate::whole::Vectors<T, W, K>, _>(from));
    /// Writes `a0 b0 c0 a1 b1 c1 ..`, for 1 to 16 vectors. Panics if `to` is shorter than all of them.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut pixels = [0; 8];
    /// u8x4::store_interleaved([u8x4::iota(1), u8x4::splat(255)], &mut pixels);
    /// assert_eq!(pixels, [1, 255, 2, 255, 3, 255, 4, 255]);
    /// # } example()
    /// ```
    #[doc(alias("StoreInterleaved2", "StoreInterleaved3", "StoreInterleaved4", "st2", "st3", "st4"))]
    store_interleaved[const K: usize](vectors: [crate::Simd<T, W, $S>; K], to: &mut (impl crate::SliceMut<Item = impl crate::Writable<T>> + ?Sized)) -> () = const crate::make::Fits::<K>::RECORDS; |d| d.store_interleaved_any(vectors, crate::whole::has_room::<crate::whole::Vectors<T, W, K>, _>(to));
    /// `load_interleaved` for the tail: as many values as `from` has, and then zeros. With more than four fields it can copy to the stack first, mostly not for whole records of 16 bytes or more and up to 16 lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [x, y] = f32x4::load_interleaved_or_default(&[1.0, 2.0, 3.0, 4.0]);
    /// assert_eq!((x.to_array(), y.to_array()), ([1.0, 3.0, 0.0, 0.0], [2.0, 4.0, 0.0, 0.0]));
    /// # } example()
    /// ```
    #[doc(alias("load_interleaved_partial", "load_interleaved_padded"))]
    load_interleaved_or_default[const K: usize](from: &[impl crate::Readable<T>]) -> [crate::Simd<T, W, $S>; K] = const crate::make::Fits::<K>::RECORDS; |d| d.load_interleaved_n(from);
    /// `store_interleaved` for the tail: as many values as `to` has room for.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut pixels = [0; 4];
    /// u8x4::store_interleaved_partial([u8x4::iota(1), u8x4::splat(255)], &mut pixels);
    /// assert_eq!(pixels, [1, 255, 2, 255]);
    /// # } example()
    /// ```
    store_interleaved_partial[const K: usize](vectors: [crate::Simd<T, W, $S>; K], to: &mut [impl crate::Writable<T>]) -> () = const crate::make::Fits::<K>::RECORDS; |d| d.store_interleaved_n(vectors, to);
    /// Three values for each four lanes, and zero in the fourth: RGB to RGBA, samples of 24 bits, Base64. For lanes of up
    /// to 32 bits, in 16 bytes or more. It is best from 32 bytes on. Panics if `from` has fewer values than that.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x16::load_3_of_4(b"RGBrgbRGBrgb"), *b"RGB\0rgb\0RGB\0rgb\0");
    /// # } example()
    /// ```
    #[doc(alias("i24", "u24", "24bit", "rgb"))]
    load_3_of_4[](from: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized)) -> crate::Simd<T, W, $S> = |d| d.staged(crate::whole::has::<crate::whole::ThreeOfFour<T, W>, _>(from), d.lanes() / 4 * 3, #[inline(always)] |from| d.load_3_of_4(from));
    /// `table[index]` for each lane, or zero where the index is out of bounds. The indices can have another size than the lanes.
    ///
    /// All gathers are mostly a load for each lane, since the instruction is slower on many CPUs that have it. They gain little over plain indexing, and on x86 more over a clamp or a select for each index.
    /// With `fast_gather` in the list of targets, AVX-512 takes the instruction, and `avx2` mostly from 32 bytes on, if lanes and indices have up to 32 bits. So do `icelake + fp16` and, for 16 lanes, `avx512`. Otherwise `avx512` and `icelake` ask at each gather of 64 bytes, and `avx2 + vnni` at each of 32,
    /// whether the CPU has `fast_gather`, which [`Target::with`](crate::target::Target::with) can set. `avx2` alone and 32-bit x86 never take it. For a small table, [`lookup`](crate::Simd::lookup) is faster.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x4::gather_or_default(&[0.5, 1.5], u8x4::from([1, 0, 1, 9])), [1.5, 0.5, 1.5, 0.0]);
    /// # } example()
    /// ```
    #[doc(alias("GatherIndex", "gather", "vpgatherdd", "vgatherdps", "fast_gather"))]
    gather_or_default[U: crate::Unsigned, X: crate::Width](table: &[impl crate::Readable<T>], indices: crate::Simd<U, X, $S>) -> crate::Simd<T, W, $S> = |d| d.gather_any(d.zero(), d.mask_true(), table, indices);
    /// `table[index]` for each lane, or `or` where the index is out of bounds.
    gather_or[U: crate::Unsigned, X: crate::Width](table: &[impl crate::Readable<T>], indices: crate::Simd<U, X, $S>, or: impl crate::Operand<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.gather_any(or, d.mask_true(), table, indices);
    /// `table[index]` for each lane, or `or` where `enable` is false or the index is out of bounds.
    #[doc(alias("MaskedGatherIndex", "MaskedGatherIndexOr", "GatherIndexN"))]
    gather_select[U: crate::Unsigned, X: crate::Width](table: &[impl crate::Readable<T>], enable: impl crate::Keep<T, W, $S>, indices: crate::Simd<U, X, $S>, or: impl crate::Operand<T, W, $S>) -> crate::Simd<T, W, $S> = |d| d.gather_any(or, crate::Keep::as_mask(enable, d.simd()), table, indices);
    /// `table[index + k]` in vector `k`, for `K` from 1 to 4: the neighbors for an interpolation, or the fields of records. One vector is the fastest gather. Where they would reach past
    /// the end, they are the last `K` values. Panics if `table` has fewer. Where gathers are single loads, this is faster than `K` of them, as it loads the values of a lane together.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let at = f32x4::from([0.5, 2.25, 1.0, 3.0]);
    /// let [a, b] = f32x4::gather_interleaved(&[0.0, 10.0, 30.0, 70.0, 80.0], at.cast::<u32>());
    /// assert_eq!(a + (b - a) * at.fract(), [5.0, 40.0, 10.0, 70.0]);
    /// let points = [[1, 2, 3], [4, 5, 6]];
    /// let [x, _, z] = u32x2::gather_interleaved(points.as_flattened(), u32x2::from([1, 0]) * 3);
    /// assert_eq!((x.to_array(), z.to_array()), ([4, 1], [6, 3]));
    /// # } example()
    /// ```
    #[doc(alias("gather_pairs", "gather_records", "gather_adjacent", "gather_clamped", "interpolate", "lerp"))]
    gather_interleaved[const K: usize, X: crate::Width](table: &(impl crate::Slice<Item = impl crate::Readable<T>> + ?Sized), indices: crate::Simd<u32, X, $S>) -> [crate::Simd<T, W, $S>; K] = const crate::make::Fits::<K>::NEIGHBORS; |d| d.gather_interleaved(crate::whole::has::<crate::whole::Values<T, W, K>, _>(table), indices);
    /// The lane that starts at each offset in bytes, little-endian, at any alignment. Where it would reach past the end, it is the last one that fits.
    /// Panics if `from` is shorter than a lane. It is for readers of bits, hashes of windows and packed records.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u16x4::gather_bytes(&[1, 2, 3, 4], u32x4::from([0, 1, 2, 9])), [0x0201, 0x0302, 0x0403, 0x0403]);
    /// // Five bits from each place in a stream.
    /// let bit = u32x4::from([0, 5, 10, 15]);
    /// assert_eq!(u32x4::gather_bytes(&[0x41, 0x0c, 0x02, 0, 0], bit >> 3) >> (bit & 7) & 31, [1, 2, 3, 4]);
    /// # } example()
    /// ```
    #[doc(alias("GatherOffset", "gather_offset", "gather_unaligned", "bit_reader"))]
    gather_bytes[X: crate::Width](from: &(impl crate::Slice<Item = impl crate::Readable<u8>> + ?Sized), offsets: crate::Simd<u32, X, $S>) -> crate::Simd<T, W, $S> = |d| d.gather_bytes(crate::whole::has::<crate::whole::BytesOfLane<T, W>, _>(from), offsets);
} }; }
pub(crate) use makers;

use crate::f16;
use crate::lane::AsBits;
use crate::raw::Raw;
use crate::{Isa, Lane, MaskOf, Operand, Output, Over, Place, Shared, Simd, Sink, Source, Tag, Width, bf16};
use core::ops::{Index, IndexMut};
use core::{cell::Cell, mem::MaybeUninit, sync::atomic::*};

/// What a slice can be made of that vectors of `T` are read from: `T`, `Cell<T>`, an atomic, [`Shared`] memory, or the little-endian bytes of a `T`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (words, _) = [1u8, 0, 0, 1, 9].as_chunks::<2>();
/// assert_eq!(u16xN::over(words).sum(), 257);
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "vectors of `{T}` can't be read from a slice of `{Self}`",
    note = "other numbers: load them as they are, and then `cast`, `widen` or `bitcast`. Bytes: `load_bytes`, or `as_chunks` of the size of a lane",
    note = "`[u8; 2]` is for `u16`, `i16`, `f16` and `bf16`, `[u8; 4]` for `u32`, `i32` and `f32`, `[u8; 8]` for `u64`, `i64` and `f64`",
    note = "structs, `bool`, `usize` and arrays: `bitcast_slice` to lanes, and `interleaved` for fields"
)]
pub trait Readable<T: Lane>: Sized + crate::seals::Readable<T> {
    #[doc(hidden)]
    type Source<'a>: Source<T>
    where
        Self: 'a;
    #[doc(hidden)]
    fn source(from: &[Self]) -> Self::Source<'_>;
    // Not by `as_slice`, which is slower here.
    #[doc(hidden)]
    #[op]
    #[track_caller]
    fn load<W: Width, S: Isa>(from: &[Self], s: S) -> Simd<T, W, S> {
        Tag::new(s).read(Self::source(from), 0)
    }
    #[doc(hidden)]
    #[op]
    #[track_caller]
    fn load_at<W: Width, S: Isa>(from: &[Self], at: usize, s: S) -> Simd<T, W, S> {
        Tag::new(s).read(Self::source(from), at)
    }
    #[doc(hidden)]
    #[op]
    fn load_partial<W: Width, S: Isa>(from: &[Self], s: S) -> Simd<T, W, S> {
        Tag::new(s).read_n(Self::source(from))
    }
    #[doc(hidden)]
    #[op]
    fn load_or<W: Width, S: Isa>(from: &[Self], s: S, or: impl Operand<T, W, S>) -> Simd<T, W, S> {
        let d = Tag::<S, T, W>::new(s);
        d.padded_with(d.first_n(from.len()), Self::load_partial(from, s), or.vector(d))
    }
    #[doc(hidden)]
    #[op]
    fn plain(_from: &[Self]) -> &[T] {
        unreachable!()
    }
    /// Nothing writes to it.
    #[doc(hidden)]
    const PLAIN: bool = false;
    /// Nothing writes to it, and on x86 its bytes are those of a lane.
    #[doc(hidden)]
    const BYTES: bool = false;
    #[doc(hidden)]
    #[op]
    fn bytes(_from: &[Self]) -> &[u8] {
        unreachable!()
    }
    /// LLVM makes one load of `values`.
    #[doc(hidden)]
    const AT_ONCE: bool = false;
    /// One value.
    #[op]
    fn value(&self) -> T {
        Self::source(core::slice::from_ref(self)).get(0)
    }
    /// The first `N` values. Panics if there are fewer.
    #[op]
    fn values<const N: usize>(from: &[Self]) -> [T; N] {
        Self::source(from).read(0)
    }
}
#[sealed]
impl<T: Lane> Readable<T> for T {
    type Source<'a> = &'a [T];
    #[inline(always)]
    fn source(from: &[T]) -> &[T] {
        from
    }
    const BYTES: bool = true;
    #[inline(always)]
    fn bytes(from: &[T]) -> &[u8] {
        T::bytes(from)
    }
    #[inline(always)]
    #[track_caller]
    fn load<W: Width, S: Isa>(from: &[T], s: S) -> Simd<T, W, S> {
        Tag::new(s).load(from)
    }
    #[op]
    #[track_caller]
    fn load_at<W: Width, S: Isa>(from: &[T], at: usize, s: S) -> Simd<T, W, S> {
        Tag::new(s).load_at(from, at)
    }
    #[inline(always)]
    fn load_partial<W: Width, S: Isa>(from: &[T], s: S) -> Simd<T, W, S> {
        Tag::new(s).load_n(from)
    }
    #[op]
    fn load_or<W: Width, S: Isa>(from: &[T], s: S, or: impl Operand<T, W, S>) -> Simd<T, W, S> {
        Tag::new(s).load_n_or(or, from)
    }
    #[inline(always)]
    fn plain(from: &[T]) -> &[T] {
        from
    }
    const PLAIN: bool = true;
}
macro_rules! readable { ($([$($g:tt)*] $t:ty, $element:ty $(, $at_once:literal)?;)*) => {$(
    #[sealed]
    impl<$($g)*> Readable<$t> for $element {
        type Source<'a> = &'a [Self];
        #[inline(always)]
        fn source(from: &[Self]) -> &[Self] { from }
        $(const AT_ONCE: bool = $at_once;)?
    }
)*}; }
readable! {
    [T: Lane] T, Cell<T>, true; [] u8, AtomicU8; [] u16, AtomicU16; [] u32, AtomicU32;
}
/// The bytes of a `T`, little-endian. With it, rustc checks the impls for bytes once, and not for each lane.
pub(crate) trait BytesOf<T>: Copy {
    fn lane(self) -> T;
    fn of_lane(lane: T) -> Self;
    /// In the order of the CPU.
    fn native_lane(self) -> T;
    fn of_native_lane(lane: T) -> Self;
}
macro_rules! of_bytes { ($($n:literal $bits:ident: $($t:ty),*;)*) => {$($(
    impl BytesOf<$t> for [u8; $n] {
        #[op]
        fn lane(self) -> $t { <$t>::of_bits($bits::from_le_bytes(self)) }
        #[op]
        fn of_lane(lane: $t) -> Self { lane.as_bits().to_le_bytes() }
        #[op]
        fn native_lane(self) -> $t { <$t>::of_bits($bits::from_ne_bytes(self)) }
        #[op]
        fn of_native_lane(lane: $t) -> Self { lane.as_bits().to_ne_bytes() }
    }
)*)*}; }
of_bytes! { 1 u8: i8; 2 u16: u16, i16, f16, bf16; 4 u32: u32, i32, f32; 8 u64: u64, i64, f64; }
#[doc(hidden)]
#[diagnostic::do_not_recommend]
#[sealed]
impl<T: Lane, const B: usize> Readable<T> for [u8; B]
where
    [u8; B]: BytesOf<T>,
{
    type Source<'a> = &'a [Self];
    #[inline(always)]
    fn source(from: &[Self]) -> &[Self] {
        from
    }
    const AT_ONCE: bool = cfg!(target_endian = "little");
    const BYTES: bool = true;
    #[inline(always)]
    fn bytes(from: &[Self]) -> &[u8] {
        from.as_flattened()
    }
    // As a loop, in which LLVM sees a copy.
    #[op]
    fn values<const N: usize>(from: &[Self]) -> [T; N] {
        let from = &from[..N];
        core::array::from_fn(|i| from[i].lane())
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<T: Lane, const B: usize> Source<T> for &[[u8; B]]
where
    [u8; B]: BytesOf<T>,
{
    const MASKED: bool = true;
    #[inline(always)]
    fn address(&self) -> usize {
        self.as_ptr().addr()
    }
    #[op]
    fn read<const N: usize>(self, at: usize) -> [T; N] {
        let from = &self[at..][..N];
        crate::array::own::from_fn(
            #[inline(always)]
            |i| from[i].lane(),
        )
    }
    #[op]
    fn read_vector<S: Isa, W: Width>(self, d: Tag<S, T, W>, at: usize) -> Simd<T, W, S> {
        d.repartition::<u8>().load(self[at..][..d.lanes()].as_flattened()).bitcast()
    }
    #[op]
    fn read_vector_n<S: Isa, W: Width>(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.repartition::<u8>().load_n(self.as_flattened()).bitcast()
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
#[sealed]
impl<T: Lane, const B: usize> Writable<T> for [u8; B]
where
    [u8; B]: BytesOf<T>,
{
    const BYTES: bool = true;
    #[op]
    fn plain(_: &mut [Self]) -> Result<&mut [T], &mut [MaybeUninit<T>]> {
        unreachable!()
    }
    #[inline(always)]
    fn bytes(to: &mut [Self]) -> &mut [u8] {
        to.as_flattened_mut()
    }
    #[op]
    fn write_lane(to: &mut Self, value: T) {
        *to = BytesOf::of_lane(value)
    }
    #[op]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        to: &mut [Self],
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> usize {
        let (s, from) = from.parts();
        Tag::new(s).copy_if(from, to, matches)
    }
    type Place<'a> = &'a mut [Self];
    #[inline(always)]
    fn place(to: &mut [Self]) -> &mut [Self] {
        to
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<T: Lane, const B: usize> Place<T> for &mut [[u8; B]]
where
    [u8; B]: BytesOf<T>,
{
    const ANY_ORDER: bool = true;
    const SHARED: bool = false;
    const MASKED: bool = true;
    const AT_ONCE: bool = cfg!(target_endian = "little");
    type Again<'a>
        = &'a mut [[u8; B]]
    where
        Self: 'a;
    #[inline(always)]
    fn again(&mut self) -> &mut [[u8; B]] {
        self
    }
    #[op]
    fn zipped<S: Isa, F: Lane, W: Width, U: Lane, X: Width, Y: Width>(
        self,
        d: Tag<S, F, W>,
        from: (&[impl Readable<F>], Tag<S, U, X>, &[impl Readable<U>]),
        f: impl Fn(Simd<F, W, S>, Simd<U, X, S>) -> Simd<T, Y, S>,
    ) {
        d.zip_to_slice(from, self, f)
    }
    // As a loop, in which LLVM sees a copy.
    #[op]
    fn write<const N: usize>(&mut self, at: usize, values: [T; N]) {
        let to = &mut self[at..][..N];
        for i in 0..N {
            Writable::write_lane(&mut to[i], values[i])
        }
    }
    #[op]
    fn uninit_address(&self) -> Option<usize> {
        Some(self.as_ptr().addr())
    }
    #[inline(always)]
    fn write_vector<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.store(&mut self[at..])
    }
    #[op]
    fn write_vector_n<S: Isa, W: Width>(&mut self, at: usize, v: Simd<T, W, S>) {
        v.store_rest(&mut self[at..])
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
#[sealed]
impl<T: Lane, const B: usize> Readable<T> for Shared<B>
where
    [u8; B]: BytesOf<T>,
{
    type Source<'a> = &'a [Self];
    #[inline(always)]
    fn source(from: &[Self]) -> &[Self] {
        from
    }
}
#[cfg(target_has_atomic = "64")]
readable! { [] u64, AtomicU64; }

/// What a slice can be made of that vectors of `T` are written to: `T`, `MaybeUninit<T>`, or the little-endian bytes of a `T`, at any address.
/// [`store_at`](Simd::store_at) takes any [`Sink`].
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut packet = [9u8; 5];
/// u16xN::over(&[1, 256]).map_into(packet[1..].as_chunks_mut::<2>().0, |v| v + 1);
/// assert_eq!(packet, [9, 2, 0, 1, 1]);
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "vectors of `{T}` can't be written to a slice of `{Self}`",
    note = "cells, atomics and an `Output` are for `store_at`, `store_partial_at` and the loops. Other numbers: `cast` or `bitcast`. Bytes: `store_bytes`, or `as_chunks_mut` of the size of a lane",
    note = "`[u8; 2]` is for `u16`, `i16`, `f16` and `bf16`, `[u8; 4]` for `u32`, `i32` and `f32`, `[u8; 8]` for `u64`, `i64` and `f64`"
)]
pub trait Writable<T: Lane>: Sized + crate::seals::Writable<T> {
    #[doc(hidden)]
    fn plain(to: &mut [Self]) -> Result<&mut [T], &mut [MaybeUninit<T>]>;
    /// `plain` is `Err`.
    #[doc(hidden)]
    const ROOM: bool = false;
    /// There is `bytes`, and no `plain`.
    #[doc(hidden)]
    const BYTES: bool = false;
    #[doc(hidden)]
    #[op]
    fn bytes(_to: &mut [Self]) -> &mut [u8] {
        unreachable!()
    }
    #[doc(hidden)]
    fn write_lane(to: &mut Self, value: T);
    #[doc(hidden)]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        to: &mut [Self],
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> usize;
    #[doc(hidden)]
    type Place<'a>: Place<T>
    where
        Self: 'a;
    #[doc(hidden)]
    fn place(to: &mut [Self]) -> Self::Place<'_>;
}
#[sealed]
impl<T: Lane> Writable<T> for T {
    #[inline(always)]
    fn plain(to: &mut [T]) -> Result<&mut [T], &mut [MaybeUninit<T>]> {
        Ok(to)
    }
    #[inline(always)]
    fn write_lane(to: &mut T, value: T) {
        *to = value
    }
    #[op]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        to: &mut [Self],
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> usize {
        let (s, from) = from.parts();
        Tag::new(s).copy_if(from, to, matches)
    }
    type Place<'a> = &'a mut [Self];
    #[inline(always)]
    fn place(to: &mut [Self]) -> &mut [Self] {
        to
    }
}
#[sealed]
impl<T: Lane> Writable<T> for MaybeUninit<T> {
    const ROOM: bool = true;
    #[inline(always)]
    fn plain(to: &mut [Self]) -> Result<&mut [T], &mut [MaybeUninit<T>]> {
        Err(to)
    }
    #[inline(always)]
    fn write_lane(to: &mut Self, value: T) {
        to.write(value);
    }
    #[op]
    fn kept_from<W: Width, S: Isa, E: Readable<T>>(
        to: &mut [Self],
        from: Over<'_, T, W, S, E>,
        matches: impl Fn(Simd<T, W, S>) -> MaskOf<T, W, S>,
    ) -> usize {
        from.filter_to_output(&mut Output::new(to), matches)
    }
    type Place<'a> = &'a mut [Self];
    #[inline(always)]
    fn place(to: &mut [Self]) -> &mut [Self] {
        to
    }
}

/// A mask, or what stands for one: a `u64` with a bit for each lane, or a `bool` for all lanes. The bits after the last lane don't count.
#[diagnostic::on_unimplemented(message = "`{Self}` is neither a mask for this vector, nor a `u64` or a `bool`")]
pub trait Keep<T: Lane, W: Width, S: Isa>: Copy + crate::seals::Keep<T, W, S> {
    #[doc(hidden)]
    #[track_caller]
    fn kept(self, d: Tag<S, T, W>) -> u64;
    /// If it is one, and the target takes it as it is.
    #[doc(hidden)]
    #[inline(always)]
    fn whole(self) -> Option<MaskOf<T, W, S>> {
        None
    }
    #[doc(hidden)]
    #[op]
    #[track_caller]
    fn as_mask(this: Self, s: S) -> MaskOf<T, W, S> {
        Tag::<S, T, W>::new(s).mask_from_bits(this.kept(Tag::new(s)))
    }
    #[doc(hidden)]
    #[inline(always)]
    fn is_mask(_: Self) -> bool {
        false
    }
    #[doc(hidden)]
    #[inline(always)]
    fn same(_: Self) -> Option<bool> {
        None
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa> Keep<T, W, S> for bool {
    #[op]
    fn kept(self, d: Tag<S, T, W>) -> u64 {
        (self as u64).wrapping_neg().kept(d)
    }
    #[op]
    fn as_mask(this: Self, s: S) -> MaskOf<T, W, S> {
        Tag::<S, T, W>::new(s).set_mask(this)
    }
    #[inline(always)]
    fn same(this: Self) -> Option<bool> {
        Some(this)
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa> Keep<T, W, S> for u64 {
    #[op]
    fn kept(self, _: Tag<S, T, W>) -> u64 {
        require!(of Simd<T, W, S>, "a `u64` has no bit for each of more than 64 lanes", W::BYTES / size_of::<T>() <= 64);
        self
    }
}
#[sealed]
impl<T: Lane, W: Width, S: Isa> Keep<T, W, S> for MaskOf<T, W, S> {
    #[inline(always)]
    fn kept(self, _: Tag<S, T, W>) -> u64 {
        self.own_bits()
    }
    #[op]
    fn whole(self) -> Option<Self> {
        (Simd::<T, W, S>::COMPACTS || Simd::<T, W, S>::PAIR).then_some(self)
    }
    #[inline(always)]
    fn as_mask(this: Self, _: S) -> Self {
        this
    }
    #[inline(always)]
    fn is_mask(_: Self) -> bool {
        true
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    #[track_caller]
    pub(crate) fn load_any(self, from: &[impl Readable<T>]) -> Simd<T, W, S> {
        Readable::load(from, self.simd())
    }
    #[op]
    #[track_caller]
    pub(crate) fn load_any_at(self, from: &[impl Readable<T>], at: usize) -> Simd<T, W, S> {
        Readable::load_at(from, at, self.simd())
    }
    #[op]
    #[track_caller]
    pub(crate) fn load_any_last(self, from: &[impl Readable<T>]) -> Simd<T, W, S> {
        self.load_any(&from[from.len() - Self::LANES..])
    }
    #[op]
    pub(crate) fn load_any_n(self, from: &[impl Readable<T>]) -> Simd<T, W, S> {
        Readable::load_partial(from, self.simd())
    }
    /// Whether rows take a mask.
    const ROWS: bool = Self::BY_BITS && W::BYTES >= 16 && W::BYTES <= 2 * S::REGISTER && Self::LANES <= 64;
    #[op]
    #[track_caller]
    pub(crate) fn load_row(self, from: crate::Rows<'_, T>, y: usize) -> Simd<T, W, S> {
        return_if!(Self::ROWS, {
            // Empty slices can point nowhere, which is slow.
            let idle = crate::Rows::new(crate::plain::read_as(&crate::Aligned([0u64; 16])[..0]), 0, 0, from.height());
            let row = core::hint::select_unpredictable(from.width() == 0, idle, from).row(y);
            Simd::new(self.simd(), Raw::load_by_bits(self.simd(), row, 0, self.zero().raw))
        });
        // All rows take the same branches.
        return_if!(S::A64 && Self::BY_LOOKUP, Simd::new(self.simd(), Raw::load_in_parts(from.row(y))));
        self.load_whole_or_rest(from.row(y))
    }
    #[op]
    pub(crate) fn load_any_or(self, from: &[impl Readable<T>], or: impl Operand<T, W, S>) -> Simd<T, W, S> {
        Readable::load_or(from, self.simd(), or)
    }
    #[op]
    pub(crate) fn read_from(self, from: &mut &[impl Readable<T>]) -> Option<Simd<T, W, S>> {
        let (first, rest) = from.split_at_checked(Self::LANES)?;
        *from = rest;
        Some(self.load_any(first))
    }
    #[op]
    #[track_caller]
    pub(crate) fn load_interleaved<const K: usize>(self, from: &[T]) -> [Simd<T, W, S>; K] {
        let from = &from[..K * Self::LANES];
        return_if!(K > 4, self.load_records(from));
        let all: [Simd<T, W, S>; 4] = choose! { |this: Self = self, from: &[T] = from|
                  K == 2 => {
            let [a, b] = this.load_interleaved2(from);
            [a, b, a, a]
        },
                  K == 3 => {
            let [a, b, c] = this.load_interleaved3(from);
            [a, b, c, a]
        },
                  _ => this.load_interleaved4(from),
              };
        *all.first_chunk().unwrap()
    }
    #[op]
    #[track_caller]
    pub(crate) fn store_interleaved<const K: usize>(self, v: [Simd<T, W, S>; K], to: &mut [T]) {
        let to = &mut to[..K * Self::LANES];
        return_if!(K > 4, self.store_records(v, to));
        let v = &v[..];
        choose! { |v: &[Simd<T, W, S>] = v, to: &mut [T] = to|
            K == 2 => v[0].store_interleaved2(v[1], to),
            K == 3 => v[0].store_interleaved3(v[1], v[2], to),
            _ => v[0].store_interleaved4(v[1], v[2], v[3], to),
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// To the start of `to`. Panics if it is too short.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 6];
    /// u8x4::iota(1).store(&mut to);
    /// assert_eq!(to, [1, 2, 3, 4, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias("Store", "StoreU", "copy_to_slice", "storeu", "write"))]
    #[op]
    #[track_caller]
    pub fn store</* Cells: store_at(&mut &cells[..], at) */ E: Writable<T>>(
        self,
        to: &mut (impl crate::SliceMut<Item = E> + ?Sized),
    ) {
        crate::SliceMut::write_first(to, self)
    }
    #[op]
    #[track_caller]
    pub(crate) fn store_whole<E: Writable<T>>(self, to: &mut [E]) {
        return_if!(E::BYTES, |this: Self = self, to: &mut [E] = to| this.bitcast::<u8>().store(E::bytes(to)));
        let to = if const { crate::X86 && W::BYTES > S::REGISTER } { &mut to[..Self::LANES] } else { to };
        return_if!(crate::X86 && W::BYTES > S::REGISTER, |this: Self = self, to: &mut [E] = to| apart!(this.isa(), |to: &mut [E]| {
            // LLVM would store the last register first, which takes up to twice as long.
            let (lower, upper) = to.split_at_mut(Self::LANES / 2);
            this.lower_half().store(lower);
            this.upper_half().store(upper)
        }));
        match Writable::plain(to) {
            // The form that LLVM optimizes best.
            Ok(to) if const { !E::ROOM } => self.raw.store(to),
            Err(mut to) if const { E::ROOM && cfg!(debug_assertions) } => self.raw.write(&mut to, 0),
            Err(to) if const { E::ROOM } => self.raw.store_uninit(to),
            _ => unreachable!(),
        }
    }
    /// To `to` from `at` on, with one check in a loop. It takes any [`Sink`]. Panics if there is no room. For steps of a stride take [`RowsMut`](crate::mem::RowsMut) on x86.
    #[inline(always)]
    #[track_caller]
    pub fn store_at(self, /* for cells: &mut &cells[..] */ to: &mut (impl Sink<T> + ?Sized), at: usize) {
        to.whole(at, self)
    }
    /// To the end of `to`. Panics if it is too short.
    #[op]
    #[track_caller]
    pub fn store_last</* Cells: store_at(&mut &cells[..], at) */ E: Writable<T>>(
        self,
        to: &mut (impl crate::SliceMut<Item = E> + ?Sized),
    ) {
        crate::SliceMut::write_last(to, self)
    }
    #[op]
    #[track_caller]
    pub(crate) fn store_end(self, to: &mut [impl Writable<T>]) {
        let at = to.len() - Self::LANES;
        self.store(&mut to[at..])
    }
    /// As little-endian bytes, on all CPUs. Panics if `to` is too short.
    #[doc(alias("to_ne_bytes", "to_le_bytes", "to_be_bytes"))]
    #[op]
    #[track_caller]
    pub fn store_bytes</* Output, cells: bitcast::<u8>(), push or store_at */ E: Writable<u8>>(
        self,
        to: &mut (impl crate::SliceMut<Item = E> + ?Sized),
    ) {
        let to = crate::whole::has_room::<crate::whole::Bytes<T, W>, _>(to);
        self.bitcast::<u8>().store(to)
    }
    /// As many lanes as `to` has room for. It costs as much as [`load_or_default`](Self::load_or_default). For several short rows, see [`store_row`](Self::store_row).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 2];
    /// u8x4::iota(1).store_partial(&mut to);
    /// assert_eq!(to, [1, 2]);
    /// # } example()
    /// ```
    #[doc(alias("StoreN", "partial_store", "store_n"))]
    #[op]
    pub fn store_partial(self, /* Output: first_n. Cells: store_partial_at */ to: &mut [impl Writable<T>]) {
        // In loops, most are whole.
        return_if!(!Tag::<S, T, W>::WHOLE_APART, self.store_rest(to));
        if Tag::<S, T, W>::is_whole(to.len()) {
            return self.store(to);
        }
        let n = crate::tag::uncounted(to.len());
        self.store_rest(&mut to[..n])
    }
    /// The same, where `to` is rarely as long as the vector.
    #[op]
    pub(crate) fn store_rest<E: Writable<T>>(self, to: &mut [E]) {
        return_if!(E::BYTES, |this: Self = self, to: &mut [E] = to| this.bitcast::<u8>().store_n(E::bytes(to)));
        match Writable::plain(to) {
            Ok(to) if const { !E::ROOM } => self.store_n(to),
            Err(mut to) if const { E::ROOM } => to.write_vector_n(0, self),
            _ => unreachable!(),
        }
    }
    /// `store_partial(to.row(y))`, for a loop over rows. See [`load_row`](Self::load_row).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 6];
    /// u8x4::iota(1).store_row(&mut RowsMut::new(&mut to, 3, 2, 2), 1);
    /// assert_eq!(to, [0, 0, 0, 1, 2, 0]);
    /// # } example()
    /// ```
    #[op]
    #[track_caller]
    pub fn store_row(self, to: &mut crate::RowsMut<'_, T>, y: usize) {
        return_if!(Tag::<S, T, W>::ROWS, {
            let (mut idle, width, height) = ([const { MaybeUninit::uninit() }; 64], to.width(), to.height());
            let idle = crate::RowsMut::new(Output::new(&mut idle).into_filled(), 0, 0, height);
            self.store_by_bits(core::hint::select_unpredictable(width == 0, idle, to.at(0, 0, width, height)).row(y), 0)
        });
        return_if!(S::A64 && Tag::<S, T, W>::BY_LOOKUP && size_of::<T>() > 1, self.raw.store_in_parts(to.row(y)));
        self.store_partial(to.row(y))
    }
    /// As many lanes as `to` has room for from `at` on, which can't be beyond its end. It takes any [`Sink`].
    #[op]
    #[track_caller]
    pub fn store_partial_at(self, /* for cells: &mut &cells[..] */ to: &mut (impl Sink<T> + ?Sized), at: usize) {
        let mut to = to.place();
        let (len, n) = (crate::Region::len(&to), Self::LANES);
        if const { Tag::<S, T, W>::WHOLE_FIRST } && len >= n && at <= len - n {
            crate::window::check(len, at, n);
            return to.write_vector(at, self);
        }
        to.write_vector_n(at, self)
    }
    /// The lanes where `enable` is true. Unlike in `std`, it panics if `to` is shorter than the vector: see [`store_partial`](Self::store_partial).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut to = [0; 4];
    /// u8x4::iota(1).store_select(&mut to, mask8x4::from_bitmask(0b0101));
    /// assert_eq!(to, [1, 0, 3, 0]);
    /// # } example()
    /// ```
    #[doc(alias("BlendedStore", "masked_store", "store_masked"))]
    #[op]
    #[track_caller]
    pub fn store_select(
        self,
        to: &mut (impl crate::SliceMut<Item = impl Writable<T>> + ?Sized),
        enable: impl Keep<T, W, S>,
    ) {
        let to = crate::whole::has_room::<crate::whole::Vectors<T, W>, _>(to);
        self.store_where(to, Keep::as_mask(enable, self.s))
    }
    #[op]
    #[track_caller]
    fn store_where<E: Writable<T>>(self, to: &mut [E], enable: MaskOf<T, W, S>) {
        return_if!(E::BYTES, |this: Self = self, to: &mut [E] = to, enable: MaskOf<T, W, S> = enable| {
            this.bitcast::<u8>().blended_store(enable.to_vector().bitcast::<u8>().to_mask(), E::bytes(to))
        });
        match Writable::plain(to) {
            Ok(to) if const { !E::ROOM } => self.blended_store(enable, to),
            Err(to) if const { E::ROOM } => self.lanes_to_uninit(
                enable,
                &mut to[..Self::LANES],
                #[inline(always)]
                |i| i as u64,
            ),
            _ => unreachable!(),
        }
    }
    /// `table[index] = lane` for each lane in order, but where `enable` is false or the index is out of bounds. The
    /// indices can have another size than the lanes.
    #[doc(alias("MaskedScatterIndex", "ScatterIndexN"))]
    #[op]
    #[track_caller]
    pub fn scatter_select<U: crate::Unsigned, X: Width>(
        self,
        table: &mut [impl Writable<T>],
        enable: impl Keep<T, W, S>,
        indices: Simd<U, X, S>,
    ) {
        let enable = Keep::as_mask(enable, self.s);
        require!("there has to be one index for each lane", X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>());
        self.scatter_where(table, enable, indices)
    }
    #[op]
    #[track_caller]
    fn scatter_where<U: crate::Unsigned, X: Width, E: Writable<T>>(
        self,
        table: &mut [E],
        enable: MaskOf<T, W, S>,
        indices: Simd<U, X, S>,
    ) {
        if const { !E::BYTES }
            && let Ok(table) = E::plain(table)
        {
            return live!(!E::BYTES, self.masked_scatter_index(enable, table, indices));
        }
        let indices = indices.to_array();
        self.lanes_to_uninit(
            enable,
            table,
            #[inline(always)]
            |i| indices.as_ref()[i].to_u64(),
        )
    }

    /// The lanes that are kept, in order, and then zeros. For their indices, see [`set_bit_positions`](crate::prelude::set_bit_positions).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x8::from(b"a b c d ");
    /// assert_eq!(v.compress(v.simd_ne(b' ')), *b"abcd\0\0\0\0");
    /// assert_eq!(v.compress(0b101), *b"ab\0\0\0\0\0\0");
    /// assert_eq!(u8x4::iota(0).compress(0b1010), [1, 3, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias(
        "Compress", "CompressBits", "CompressNot", "vpcompress", "compact", "bit_positions", "set_bit_indices"
    ))]
    #[op]
    #[track_caller]
    pub fn compress(self, keep: impl Keep<T, W, S>) -> Self {
        if_here!(
            Self::COMPACTS && W::BYTES == 16,
            if let Some(mask) = keep.whole() {
                return self.compress_mask(mask);
            }
        );
        self.compress_by(keep.kept(self.tag()))
    }
    #[op]
    pub(crate) fn compress_by(self, bits: u64) -> Self {
        let bits = if W::BYTES < 16 { bits & (!0 >> (64 - Self::LANES)) } else { bits };
        if const { W::BYTES > 64 } {
            return self.compress_own(bits);
        }
        if const { S::COMPRESS[size_of::<T>().trailing_zeros() as usize] == 64 } {
            let v = self.bytes();
            return self.with_bytes(match size_of::<T>() {
                1 => self.s.compress_zero8::<W>(v, bits),
                2 => self.s.compress_zero16::<W>(v, bits),
                4 => self.s.compress_zero32::<W>(v, bits),
                _ => self.s.compress_zero64::<W>(v, bits),
            });
        }
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        return_if!(S::AVX2 && T::BITS >= 32 && W::BYTES == 32, {
            let at = choose! { T::BITS == 32 => crate::ops::set_bits(bits), _ => crate::ops::set_pairs(bits) };
            let at = self.s.fixed::<u8, crate::B8>().from_array(at.to_array()).cast_signed().cast::<i32>().barrier();
            (at >> 31).and_not(self.same::<i32, crate::B32>().swizzle_dyn_relaxed(at.cast_unsigned())).same()
        });
        let v = self.compress_own(bits);
        // These do it for nothing.
        if const { Self::LANES > 1 && (W::BYTES <= 16 || S::SSE41 && W::BYTES == 32) } {
            return v;
        }
        let count = crate::ops::count_bits_on::<S>(bits, Self::LANES);
        self.tag().first_n(count).if_then_else_zero(v)
    }
    /// The lanes that are kept, in order. The lanes after them can have any bits. It is faster for vectors of more than 16 bytes.
    #[op]
    #[track_caller]
    pub fn compress_relaxed(self, keep: impl Keep<T, W, S>) -> Self {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        if let Some(mask) = keep.whole() {
            choose! { Self::COMPACTS => self.compress_counted(mask, true).0, _ => self.compress_mask(mask) }
        } else {
            self.compress_own(keep.kept(self.tag()))
        }
    }
    /// Stores the lanes that are kept, and returns how many. `to` needs room for the whole vector, and the rest of that room can get any bits. At an index, [`chunk_at_mut`](crate::mem::ChunkAt::chunk_at_mut) has one check where `&mut to[n..]` has two.
    /// If `keep` comes at the end of a long computation, and an earlier mask tells the number, count that one: with AVX-512 it took 0.87 to 0.99 of the time on Intel, and 0.96 to 1.14 on Zen 4 and 5.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (v, mut to) = (u8x8::from(b"a b c d "), [0; 8]);
    /// let n = v.compress_store(&mut to, v.simd_ne(b' '));
    /// assert_eq!(&to[..n], b"abcd");
    /// # } example()
    /// ```
    #[doc(alias("CompressStore", "CompressBitsStore"))]
    #[op]
    #[track_caller]
    pub fn compress_store(
        self,
        to: &mut (impl crate::SliceMut<Item = impl Writable<T>> + ?Sized),
        keep: impl Keep<T, W, S>,
    ) -> usize {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        self.compress_to(crate::whole::has_room::<crate::whole::Vectors<T, W>, _>(to), keep)
    }
    #[op]
    #[track_caller]
    fn compress_to(self, to: &mut [impl Writable<T>], keep: impl Keep<T, W, S>) -> usize {
        if_here!(
            Self::COMPACTS && W::BYTES == 16,
            if let Some(mask) = keep.whole() {
                let (kept, count) = self.compress_counted(mask, true);
                kept.store(to);
                return count.min(Self::LANES);
            }
        );
        if let Some(mask) = keep.whole() {
            self.compress_mask_store(mask, to)
        } else {
            self.compress_own_store(keep.kept(self.tag()), to)
        }
    }
    /// Like [`compress_store`](Self::compress_store), but changes only as many values as it returns, and needs no more room.
    /// Without masked stores it can read `to`, and wait for what was just stored there. If the values after these may change, `compress_relaxed` and `store_partial` don't.
    #[doc(alias("CompressBlendedStore"))]
    #[op]
    #[track_caller]
    pub fn compress_store_exact(self, to: &mut [impl Writable<T>], keep: impl Keep<T, W, S>) -> usize {
        if_here!(
            Self::COMPACTS && W::BYTES == 16,
            if let Some(mask) = keep.whole() {
                let (kept, count) = self.compress_counted(mask, true);
                // LLVM knows no such bound of `cntp`.
                let count = count.min(Self::LANES);
                kept.store_rest(&mut to[..count]);
                return count;
            }
        );
        self.compress_exact(to, keep.kept(self.tag()))
    }
    #[op]
    #[track_caller]
    fn compress_exact<E: Writable<T>>(self, to: &mut [E], bits: u64) -> usize {
        if const { !E::BYTES }
            && let Ok(to) = E::plain(to)
        {
            return live!(!E::BYTES, self.compress_bits_blended_store(bits, to));
        }
        let count = crate::ops::count_bits_on::<S>(bits, Self::LANES);
        self.compress_own(bits).store_rest(&mut to[..count]);
        count
    }
}

impl<T: Lane> Output<'_, T> {
    #[op]
    #[track_caller]
    pub(crate) fn push_halves<W: Width, S: Isa>(&mut self, v: Simd<T, W, S>, bits: u64) {
        live!(Simd::<T, W, S>::BY_HALVES, {
            let [lower, upper] = v.compress_halves(bits);
            self.push_first(lower, crate::ops::count_bits_on::<S>(bits, 8));
            self.push_first(upper, crate::ops::count_bits_on::<S>(bits >> 8, 8))
        })
    }
    /// Adds the lanes that are kept. It needs room for all lanes.
    #[op]
    #[track_caller]
    pub(crate) fn push_selected<W: Width, S: Isa>(&mut self, v: Simd<T, W, S>, keep: impl Keep<T, W, S>) {
        require!(of Simd<T, W, S>, "a `u64` has no bit for each of more than 64 lanes", Simd::<T, W, S>::LANES <= 64);
        // Four steps or more, and text often has nothing to drop.
        if const { size_of::<T>() == 1 && W::BYTES >= 4 * S::COMPRESS[0] && !Simd::<T, W, S>::COMPACTS } {
            let (bits, all) = (keep.kept(v.tag()), Simd::<T, W, S>::all_bits_of_lanes());
            return if bits & all == all { self.push(v) } else { self.push_compressed_bits(v, bits) };
        }
        if const { Simd::<T, W, S>::COMPACTS && W::BYTES == 16 }
            && let Some(mask) = keep.whole()
        {
            let (kept, count) = v.compress_counted(mask, true);
            return self.push_first(kept, count);
        }
        if let Some(mask) = keep.whole() {
            self.push_compressed(v, mask)
        } else {
            self.push_compressed_bits(v, keep.kept(v.tag()))
        }
    }
}

/// With an index that is not a constant, [`lane_dyn`](Simd::lane_dyn) stays in registers on NEON, and with AVX-512 for 64 bytes.
impl<S: Isa, T: Lane, W: Width> Index<usize> for Simd<T, W, S> {
    type Output = T;
    #[op]
    #[track_caller]
    fn index(&self, i: usize) -> &T {
        &on_arch!(Self::all_handed, self).raw.lanes()[i]
    }
}
/// With an index that is not a constant, [`with_lane_dyn`](Simd::with_lane_dyn) is faster.
impl<S: Isa, T: Lane, W: Width> IndexMut<usize> for Simd<T, W, S> {
    #[op]
    #[track_caller]
    fn index_mut(&mut self, i: usize) -> &mut T {
        &mut on_arch!(Self::all_handed, self).raw.lanes_mut()[i]
    }
}
