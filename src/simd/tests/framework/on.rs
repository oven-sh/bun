//! A value that stands for a type of vector, for cases that are closures.
#![cfg_attr(rustfmt, rustfmt::skip)]
#![allow(dead_code)]
use bun_simd::{Isa, Lane, Scaled, Width};

pub struct Tagged<T, W, S>(S, core::marker::PhantomData<(T, W)>);
impl<T, W, S: Isa> Copy for Tagged<T, W, S> {}
impl<T, W, S: Isa> Clone for Tagged<T, W, S> { #[inline(always)] fn clone(&self) -> Self { *self } }

pub trait Types: Isa {
    #[inline(always)] fn of<T: Lane, W: Width>(self) -> Tagged<T, W, Self> { Tagged(self, core::marker::PhantomData) }
    #[inline(always)] fn native<T: Lane>(self) -> Tagged<T, Self::Native, Self> { self.of() }
    #[inline(always)] fn upto<T: Lane, W: Width>(self) -> Tagged<T, <Self::Native as Width>::Min<W>, Self> { self.of() }
}
impl<S: Isa> Types for S {}

pub trait Like { type On; fn like(self) -> Self::On; }
impl<T: Lane, W: Width, S: Isa> Like for bun_simd::Simd<T, W, S> {
    type On = Tagged<T, W, S>;
    #[inline(always)] fn like(self) -> Self::On { self.isa().of() }
}
impl<T: Lane, W: Width, S: Isa> core::fmt::Debug for Tagged<T, W, S> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { write!(f, "{:?} {}x{}", self.0, core::any::type_name::<T>(), Self::LANES) }
}

impl<T: Lane, W: Width, S: Isa> Tagged<T, W, S> {
    pub const LANES: usize = W::BYTES / size_of::<T>();
    #[inline(always)] pub fn isa(self) -> S { self.0 }
    #[inline(always)] pub fn lanes(self) -> usize { Self::LANES }
    #[inline(always)] pub fn half(self) -> Tagged<T, W::Half, S> { self.0.of() }
    #[inline(always)] pub fn twice(self) -> Tagged<T, W::Twice, S> { self.0.of() }
    #[inline(always)] pub fn repartition<U: Lane>(self) -> Tagged<U, W, S> { self.0.of() }
    #[inline(always)] pub fn rebind<U: Lane>(self) -> Tagged<U, Scaled<T, U, W>, S> { self.0.of() }
    #[inline(always)] pub fn to_signed(self) -> Tagged<T::Signed, W, S> { self.0.of() }
    #[inline(always)] pub fn to_unsigned(self) -> Tagged<T::Unsigned, W, S> { self.0.of() }
    #[inline(always)] pub fn over<E: bun_simd::mem::Readable<T>>(self, from: &[E]) -> bun_simd::Over<'_, T, W, S, E> { bun_simd::Simd::<T, W, S>::over(from) }
    #[inline(always)] pub fn over_mut(self, values: &mut [T]) -> bun_simd::OverMut<'_, T, W, S> { bun_simd::Simd::<T, W, S>::over_mut(values) }
    #[inline(always)] #[track_caller] pub fn from_halves(self, halves: [bun_simd::Simd<T, W::Half, S>; 2]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::from_halves(halves) }
    #[inline(always)] #[track_caller] pub fn from_parts<X: bun_simd::Width>(self, part: impl FnMut(usize) -> bun_simd::Simd<T, X, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::from_parts::<X>(part) }
    #[inline(always)] #[track_caller] pub fn load(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load(from) }
    #[inline(always)] #[track_caller] pub fn load_at(self, from: &[impl bun_simd::mem::Readable<T>], at: usize) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_at(from, at) }
    #[inline(always)] #[track_caller] pub fn load_last(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_last(from) }
    #[inline(always)] #[track_caller] pub fn load_bytes(self, from: &[impl bun_simd::mem::Readable<u8>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_bytes(from) }
    #[inline(always)] #[track_caller] pub fn load_short(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_short(from) }
    #[inline(always)] #[track_caller] pub fn load_or(self, from: &[impl bun_simd::mem::Readable<T>], or: impl bun_simd::Operand<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_or(from, or) }
    #[inline(always)] #[track_caller] pub fn load_or_default(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_or_default(from) }
    #[inline(always)] #[track_caller] pub fn load_padded(self, from: &[impl bun_simd::mem::Readable<T>], pad: T) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_padded(from, pad) }
    #[inline(always)] #[track_caller] pub fn load_row(self, from: bun_simd::mem::Rows<'_, T>, y: usize) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_row(from, y) }
    #[inline(always)] #[track_caller] pub fn load_select(self, from: &[impl bun_simd::mem::Readable<T>], enable: impl bun_simd::Keep<T, W, S>, or: impl bun_simd::Operand<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_select(from, enable, or) }
    #[inline(always)] #[track_caller] pub fn load_select_or_default(self, from: &[impl bun_simd::mem::Readable<T>], enable: impl bun_simd::Keep<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_select_or_default(from, enable) }
    #[inline(always)] #[track_caller] pub fn load_expand(self, from: &[impl bun_simd::mem::Readable<T>], enable: impl bun_simd::Keep<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_expand(from, enable) }
    #[inline(always)] #[track_caller] pub fn load_expand_or(self, from: &[impl bun_simd::mem::Readable<T>], enable: impl bun_simd::Keep<T, W, S>, or: impl bun_simd::Operand<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_expand_or(from, enable, or) }
    #[inline(always)] #[track_caller] pub fn load_block(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_block(from) }
    #[inline(always)] #[track_caller] pub fn load_interleaved<const K: usize>(self, from: &[impl bun_simd::mem::Readable<T>]) -> [bun_simd::Simd<T, W, S>; K] { bun_simd::Simd::<T, W, S>::load_interleaved::<K>(from) }
    #[inline(always)] #[track_caller] pub fn store_interleaved<const K: usize>(self, vectors: [bun_simd::Simd<T, W, S>; K], to: &mut [impl bun_simd::mem::Writable<T>]) { bun_simd::Simd::<T, W, S>::store_interleaved::<K>(vectors, to) }
    #[inline(always)] #[track_caller] pub fn load_interleaved_or_default<const K: usize>(self, from: &[impl bun_simd::mem::Readable<T>]) -> [bun_simd::Simd<T, W, S>; K] { bun_simd::Simd::<T, W, S>::load_interleaved_or_default::<K>(from) }
    #[inline(always)] #[track_caller] pub fn store_interleaved_partial<const K: usize>(self, vectors: [bun_simd::Simd<T, W, S>; K], to: &mut [impl bun_simd::mem::Writable<T>]) { bun_simd::Simd::<T, W, S>::store_interleaved_partial::<K>(vectors, to) }
    #[inline(always)] #[track_caller] pub fn load_3_of_4(self, from: &[impl bun_simd::mem::Readable<T>]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::load_3_of_4(from) }
    #[inline(always)] #[track_caller] pub fn gather_or_default<U: bun_simd::Unsigned, X: bun_simd::Width>(self, table: &[impl bun_simd::mem::Readable<T>], indices: bun_simd::Simd<U, X, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::gather_or_default::<U, X>(table, indices) }
    #[inline(always)] #[track_caller] pub fn gather_or<U: bun_simd::Unsigned, X: bun_simd::Width>(self, table: &[impl bun_simd::mem::Readable<T>], indices: bun_simd::Simd<U, X, S>, or: impl bun_simd::Operand<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::gather_or::<U, X>(table, indices, or) }
    #[inline(always)] #[track_caller] pub fn gather_select<U: bun_simd::Unsigned, X: bun_simd::Width>(self, table: &[impl bun_simd::mem::Readable<T>], enable: impl bun_simd::Keep<T, W, S>, indices: bun_simd::Simd<U, X, S>, or: impl bun_simd::Operand<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::gather_select::<U, X>(table, enable, indices, or) }
    #[inline(always)] #[track_caller] pub fn gather_interleaved<const K: usize, X: bun_simd::Width>(self, table: &[impl bun_simd::mem::Readable<T>], indices: bun_simd::Simd<u32, X, S>) -> [bun_simd::Simd<T, W, S>; K] { bun_simd::Simd::<T, W, S>::gather_interleaved::<K, X>(table, indices) }
    #[inline(always)] #[track_caller] pub fn gather_bytes<X: bun_simd::Width>(self, from: &[impl bun_simd::mem::Readable<u8>], offsets: bun_simd::Simd<u32, X, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::gather_bytes::<X>(from, offsets) }
    #[inline(always)] #[track_caller] pub fn load_low_bytes(self, from: &[impl bun_simd::mem::Readable<u8>], more: impl bun_simd::MoreBytes<T, W, S>) -> (bun_simd::Simd<T, W, S>, usize) where T: bun_simd::Unsigned { bun_simd::Simd::<T, W, S>::load_low_bytes(from, more) }
    #[inline(always)] #[track_caller] pub fn splat(self, value: T) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::splat(value) }
    #[inline(always)] #[track_caller] pub fn zero(self) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::zero() }
    #[inline(always)] #[track_caller] pub fn iota(self, first: T) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::iota(first) }
    #[inline(always)] #[track_caller] pub fn from(self, value: impl bun_simd::IntoSimd<T, W, S>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::from(value) }
    #[inline(always)] #[track_caller] pub fn from_array(self, lanes: bun_simd::Array<T, W>) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::from_array(lanes) }
    #[inline(always)] #[track_caller] pub fn from_fn(self, lane: impl FnMut(usize) -> T) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::from_fn(lane) }
    #[inline(always)] #[track_caller] pub fn repeat<const N: usize>(self, group: &[T; N]) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::repeat::<N>(group) }
    #[inline(always)] #[track_caller] pub fn sign_bit(self) -> bun_simd::Simd<T, W, S> { bun_simd::Simd::<T, W, S>::sign_bit() }
    #[inline(always)] #[track_caller] pub fn over_all<const K: usize, E: bun_simd::mem::Readable<T>>(self, slices: [&[E]; K]) -> bun_simd::Columns<T, W, S, [&[E]; K]> { bun_simd::Simd::<T, W, S>::over_all::<K, E>(slices) }
    #[inline(always)] #[track_caller] pub fn from_bit_planes<const K: usize>(self, planes: [u64; K]) -> bun_simd::Simd<T, W, S> where T: bun_simd::Unsigned { bun_simd::Simd::<T, W, S>::from_bit_planes::<K>(planes) }
    #[inline(always)] pub fn mask_splat(self, value: bool) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::splat(value) }
    #[inline(always)] pub fn mask_first_n(self, n: usize) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::first_n(n) }
    #[inline(always)] pub fn mask_from_bitmask(self, bits: u64) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::from_bitmask(bits) }
    #[inline(always)] pub fn mask_load_bitmask(self, from: &[u8]) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::load_bitmask(from) }
    #[inline(always)] pub fn mask_from_array(self, lanes: bun_simd::Bools<T, W>) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::from_array(lanes) }
    #[inline(always)] pub fn mask_repeat_bitmask(self, bits: u64) -> bun_simd::MaskOf<T, W, S> { bun_simd::MaskOf::<T, W, S>::repeat_bitmask(bits) }
}
