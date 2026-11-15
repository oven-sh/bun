//! What a lane can be. No target in here.

use bun_simd_trusted::shared::{load4, load8};
use core::simd::{Select, ToBytes, prelude::*};
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

mod sealed {
    pub trait Sealed {}
}

pub trait Lane:
    Copy + PartialEq + sealed::Sealed + Width<16> + Width<32> + Width<64> + 'static
{
    const BITS: u32;
    const SIGNED: bool;
    /// Extended with zeros.
    fn bits(self) -> u64;
    fn from_bits(bits: u64) -> Self;
    fn load_fitting(lanes: &[Self]) -> Bytes<64>;
    fn store_fitting(v: Bytes<64>, lanes: &mut [Self]);
}

pub(crate) type Bytes<const N: usize> = Simd<u8, N>;
pub(crate) type ArrayOf<T, const BYTES: usize> = <T as Width<BYTES>>::Array;

macro_rules! width {
    ($d:tt $($op:ident |$a:ident, $b:ident| $result:expr;)*) => {
        /// Ops on `N` bytes. LLVM picks the instructions in the function that they are inlined into.
        pub trait Width<const N: usize>: Sized {
            type Array: Array<Self> + Source<N, Self>;
            fn to_bytes(lanes: &Self::Array) -> Bytes<N>;
            fn from_bytes(v: Bytes<N>) -> Self::Array;
            fn splat(lane: Self) -> Bytes<N>;
            fn eq_bits(a: Bytes<N>, b: Bytes<N>) -> u64;
            fn gt_bits(a: Bytes<N>, b: Bytes<N>) -> u64;
            fn select_bits(bits: u64, yes: Bytes<N>, no: Bytes<N>) -> Bytes<N>;
            fn select_bitwise(mask: Bytes<N>, yes: Bytes<N>, no: Bytes<N>) -> Bytes<N>;
            $(fn $op(a: Bytes<N>, b: Bytes<N>) -> Bytes<N>;)*
        }

        macro_rules! impl_width {
            ($d T:ty, $d N:literal) => {
                const _: () = {
                    type Typed = Simd<$d T, { $d N / size_of::<$d T>() }>;
                    type Bytes = Simd<u8, $d N>;
                    impl Source<$d N, $d T> for [$d T; $d N / size_of::<$d T>()] {
                        #[inline(always)]
                        fn either<const K: usize>(
                            group: &[Self; K],
                        ) -> Result<&[Self; K], &[[AtomicU8; $d N]; K]> {
                            Ok(group)
                        }
                    }
                    impl Width<$d N> for $d T {
                        type Array = [$d T; $d N / size_of::<$d T>()];
                        #[inline(always)]
                        fn to_bytes(lanes: &Self::Array) -> Bytes {
                            Typed::from_array(*lanes).to_ne_bytes()
                        }
                        #[inline(always)]
                        fn from_bytes(v: Bytes) -> Self::Array {
                            Typed::from_ne_bytes(v).to_array()
                        }
                        #[inline(always)]
                        fn splat(lane: Self) -> Bytes {
                            Typed::splat(lane).to_ne_bytes()
                        }
                        #[inline(always)]
                        fn eq_bits(a: Bytes, b: Bytes) -> u64 {
                            Typed::from_ne_bytes(a).simd_eq(Typed::from_ne_bytes(b)).to_bitmask()
                        }
                        #[inline(always)]
                        fn gt_bits(a: Bytes, b: Bytes) -> u64 {
                            Typed::from_ne_bytes(a).simd_gt(Typed::from_ne_bytes(b)).to_bitmask()
                        }
                        #[inline(always)]
                        fn select_bits(bits: u64, yes: Bytes, no: Bytes) -> Bytes {
                            let [yes, no] = [yes, no].map(Typed::from_ne_bytes);
                            bits.select(yes, no).to_ne_bytes()
                        }
                        #[inline(always)]
                        fn select_bitwise(mask: Bytes, yes: Bytes, no: Bytes) -> Bytes {
                            let [mask, yes, no] = [mask, yes, no].map(Typed::from_ne_bytes);
                            (mask & yes | !mask & no).to_ne_bytes()
                        }
                        $(
                            #[inline(always)]
                            fn $op(a: Bytes, b: Bytes) -> Bytes {
                                let ($a, $b) = (Typed::from_ne_bytes(a), Typed::from_ne_bytes(b));
                                $result.to_ne_bytes()
                            }
                        )*
                    }
                };
            };
        }
    };
}

width! { $
    sum |a, b| (a + b);
    difference |a, b| (a - b);
    product |a, b| (a * b);
    smaller |a, b| a.simd_min(b);
    larger |a, b| a.simd_max(b);
    saturated_sum |a, b| a.saturating_add(b);
    saturated_difference |a, b| a.saturating_sub(b);
    shifted_left |a, b| (a << b);
    shifted_right |a, b| (a >> b);
    equal |a, b| a.simd_eq(b).to_simd();
    greater |a, b| a.simd_gt(b).to_simd();
    first_in_turns |a, b| a.interleave(b).0;
    second_in_turns |a, b| a.interleave(b).1;
}

/// What `N` bytes of lanes can be loaded from.
pub trait Source<const N: usize, T: Width<N>>: Sized {
    /// Lanes, or bytes that other threads may write to.
    fn either<const K: usize>(group: &[Self; K]) -> Result<&[T::Array; K], &[[AtomicU8; N]; K]>;
}

/// `[T; N]`, for code that is generic over `T`.
pub trait Chunk<T>: Sized + AsRef<[T]> + AsMut<[T]> {
    fn first(lanes: &[T]) -> Option<&Self>;
    fn first_mut(lanes: &mut [T]) -> Option<&mut Self>;
    fn split_last(lanes: &[T]) -> Option<(&[T], &Self)>;
    fn split_last_mut(lanes: &mut [T]) -> Option<(&mut [T], &mut Self)>;
    fn chunks(lanes: &[T]) -> &[Self];
    fn chunks_mut(lanes: &mut [T]) -> &mut [Self];
    /// Up to the end.
    fn rchunks(lanes: &[T]) -> &[Self];
}

pub trait Array<T>: Copy + Chunk<T> {
    fn zeros() -> Self;
}

impl<T: Lane, const N: usize> Array<T> for [T; N] {
    #[inline(always)]
    fn zeros() -> Self {
        [T::from_bits(0); N]
    }
}

impl<T, const N: usize> Chunk<T> for [T; N] {
    #[inline(always)]
    fn first(lanes: &[T]) -> Option<&Self> {
        lanes.first_chunk()
    }
    #[inline(always)]
    fn first_mut(lanes: &mut [T]) -> Option<&mut Self> {
        lanes.first_chunk_mut()
    }
    #[inline(always)]
    fn split_last(lanes: &[T]) -> Option<(&[T], &Self)> {
        lanes.split_last_chunk()
    }
    #[inline(always)]
    fn split_last_mut(lanes: &mut [T]) -> Option<(&mut [T], &mut Self)> {
        lanes.split_last_chunk_mut()
    }
    #[inline(always)]
    fn chunks(lanes: &[T]) -> &[Self] {
        lanes.as_chunks().0
    }
    #[inline(always)]
    fn chunks_mut(lanes: &mut [T]) -> &mut [Self] {
        lanes.as_chunks_mut().0
    }
    #[inline(always)]
    fn rchunks(lanes: &[T]) -> &[Self] {
        lanes.as_rchunks().1
    }
}

/// `N` bytes of a text.
pub trait Chunked<const N: usize, T: Width<N>>: Sized {
    type Chunk: Chunk<Self> + Source<N, T>;
}
pub(crate) type ChunkOf<U, const BYTES: usize> = <U as Chunked<BYTES, <U as Unit>::Lane>>::Chunk;

/// What a text is made of.
pub trait Unit:
    Chunked<16, Self::Lane> + Chunked<32, Self::Lane> + Chunked<64, Self::Lane>
{
    type Lane: Lane;
    /// What is read twice may differ.
    const SHARED: bool = false;
    fn get(&self) -> Self::Lane;
    fn either(text: &[Self]) -> Result<&[Self::Lane], &[AtomicU8]>;
    /// The first and the last 8 bytes.
    fn ends_8(text: &[Self]) -> Option<[u64; 2]>;
    fn ends_4(text: &[Self]) -> Option<u64>;
    fn ends_2(text: &[Self]) -> Option<u32>;
}

impl<T: Lane + Width<N>, const N: usize> Chunked<N, T> for T {
    type Chunk = ArrayOf<T, N>;
}

impl<const N: usize> Chunked<N, u8> for AtomicU8
where
    u8: Width<N>,
{
    type Chunk = [AtomicU8; N];
}

impl<const N: usize> Source<N, u8> for [AtomicU8; N]
where
    u8: Width<N>,
{
    #[inline(always)]
    fn either<const K: usize>(group: &[Self; K]) -> Result<&[ArrayOf<u8, N>; K], &[Self; K]> {
        Err(group)
    }
}

impl Unit for AtomicU8 {
    type Lane = u8;
    const SHARED: bool = true;
    #[inline(always)]
    fn get(&self) -> u8 {
        self.load(Relaxed)
    }
    #[inline(always)]
    fn either(text: &[Self]) -> Result<&[u8], &[Self]> {
        Err(text)
    }
    #[inline(always)]
    fn ends_8(text: &[Self]) -> Option<[u64; 2]> {
        ends(text).map(|(first, last)| {
            [first, last].map(|end| u64::from_le(load8::<1, 0>(core::array::from_ref(end))))
        })
    }
    #[inline(always)]
    fn ends_4(text: &[Self]) -> Option<u64> {
        let load = |end| u64::from(u32::from_le(load4::<1, 0>(core::array::from_ref(end))));
        ends(text).map(|(first, last)| load(first) | load(last) << 32)
    }
    #[inline(always)]
    fn ends_2(text: &[Self]) -> Option<u32> {
        ends(text).map(|([a, b], [c, d])| u32::from_le_bytes([a, b, c, d].map(Self::get)))
    }
}

impl Unit for u8 {
    type Lane = Self;
    #[inline(always)]
    fn get(&self) -> Self {
        *self
    }
    #[inline(always)]
    fn either(text: &[Self]) -> Result<&[Self], &[AtomicU8]> {
        Ok(text)
    }
    #[inline(always)]
    fn ends_8(text: &[u8]) -> Option<[u64; 2]> {
        ends(text).map(|(&first, &last)| [u64::from_le_bytes(first), u64::from_le_bytes(last)])
    }
    #[inline(always)]
    fn ends_4(text: &[u8]) -> Option<u64> {
        ends(text).map(|(&first, &last)| {
            u64::from(u32::from_le_bytes(first)) | u64::from(u32::from_le_bytes(last)) << 32
        })
    }
    #[inline(always)]
    fn ends_2(text: &[u8]) -> Option<u32> {
        ends(text).map(|(&first, &last)| {
            u32::from(u16::from_le_bytes(first)) | u32::from(u16::from_le_bytes(last)) << 16
        })
    }
}

impl Unit for u16 {
    type Lane = Self;
    #[inline(always)]
    fn get(&self) -> Self {
        *self
    }
    #[inline(always)]
    fn either(text: &[Self]) -> Result<&[Self], &[AtomicU8]> {
        Ok(text)
    }
    #[inline(always)]
    fn ends_8(text: &[u16]) -> Option<[u64; 2]> {
        ends(text).map(|(&first, &last)| [word(first), word(last)])
    }
    #[inline(always)]
    fn ends_4(text: &[u16]) -> Option<u64> {
        ends(text).map(|(&[a, b], &[c, d])| word([a, b, c, d]))
    }
    #[inline(always)]
    fn ends_2(_: &[u16]) -> Option<u32> {
        None
    }
}

#[inline(always)]
fn word(units: [u16; 4]) -> u64 {
    u64::from_le_bytes(
        *units
            .map(u16::to_le_bytes)
            .as_flattened()
            .as_array()
            .unwrap(),
    )
}

/// Not `last_chunk()`, whose result LLVM compares with null.
#[inline(always)]
pub(crate) fn ends<T, const N: usize>(lanes: &[T]) -> Option<(&[T; N], &[T; N])> {
    Some((lanes.first_chunk()?, lanes.split_last_chunk()?.1))
}

/// A masked access takes hundreds of cycles if the lanes it leaves out are in a missing page.
#[inline(always)]
pub(crate) fn is_slow_with_mask<T>(lanes: &[T]) -> bool {
    let is_near_end_of_page = lanes.as_ptr().addr().wrapping_add(64) & (4096 - 64) == 0;
    core::hint::unlikely(is_near_end_of_page || lanes.is_empty())
}

/// Of the same length, up to 64.
#[inline(always)]
fn copy_short<T: Copy>(from: &[T], to: &mut [T]) {
    #[inline(always)]
    fn put<T: Copy, const HALF: usize>(from: &[T], to: &mut [T]) -> bool {
        let (Some((&first, &last)), Some(start)) = (ends::<T, HALF>(from), to.first_chunk_mut())
        else {
            return false;
        };
        *start = first;
        to.split_last_chunk_mut()
            .map(|(_, end)| *end = last)
            .is_some()
    }
    _ = put::<_, 32>(from, to)
        || put::<_, 16>(from, to)
        || put::<_, 8>(from, to)
        || put::<_, 4>(from, to)
        || put::<_, 2>(from, to)
        || put::<_, 1>(from, to);
}

macro_rules! lanes {
    ($($T:ty, $Unsigned:ty;)*) => {$(
        impl sealed::Sealed for $T {}
        impl_width!($T, 16);
        impl_width!($T, 32);
        impl_width!($T, 64);
        impl Lane for $T {
            const BITS: u32 = <$T>::BITS;
            const SIGNED: bool = <$T>::MIN != 0;
            #[inline(always)]
            fn bits(self) -> u64 {
                self as $Unsigned as u64
            }
            #[inline(always)]
            fn from_bits(bits: u64) -> Self {
                bits as $T
            }
            #[inline(always)]
            fn load_fitting(lanes: &[Self]) -> Bytes<64> {
                if is_slow_with_mask(lanes) {
                    let mut all = [0; 64 / size_of::<$T>()];
                    let len = lanes.len().min(all.len());
                    copy_short(&lanes[..len], &mut all[..len]);
                    return <Self as Width<64>>::to_bytes(&all);
                }
                Simd::<$T, { 64 / size_of::<$T>() }>::load_or_default(lanes).to_ne_bytes()
            }
            #[inline(always)]
            fn store_fitting(v: Bytes<64>, lanes: &mut [Self]) {
                if is_slow_with_mask(lanes) {
                    let all = <Self as Width<64>>::from_bytes(v);
                    let len = lanes.len().min(all.len());
                    return copy_short(&all[..len], &mut lanes[..len]);
                }
                let v = Simd::<$T, { 64 / size_of::<$T>() }>::from_ne_bytes(v);
                v.store_select(lanes, Mask::splat(true))
            }
        }
    )*};
}

lanes! { u8, u8; i8, u8; u16, u16; i16, u16; u32, u32; i32, u32; u64, u64; i64, u64; }
