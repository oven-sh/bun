//! How lanes of `f16` and `bf16` are kept: as those of `u16`, since LLVM moves lanes of `f16` one by one where the CPU has no arithmetic for them.

use crate::lane::{Element, Lane};
use crate::memory::{Place, Source};
use crate::pattern;
use crate::raw::{Bits, Raw, RawMask};
#[allow(unused_imports)]
use crate::simd::{Cpu, Fits, Here, In};
use crate::simd::{F16, Simd as Core};
use crate::width::Repr;
use core::marker::PhantomData;
use core::mem::MaybeUninit;

pub trait Half: Lane<Unsigned = u16, Signed = i16, Stored = u16> {
    fn room(to: &mut [MaybeUninit<Self>]) -> &mut [MaybeUninit<u16>];
    /// The bits of 0, 1, 2 and so on.
    const SMALL: [u16; 256];
}

/// `N` lanes in `R`, which has room for `P`.
#[derive(Copy, Clone)]
pub struct Halves16<T, R, const N: usize, const P: usize>(R, PhantomData<T>);

impl<T: Half, W: Repr, R: Bits<W>, const N: usize, const P: usize> Bits<W> for Halves16<T, R, N, P> {
    #[inline(always)]
    fn to_bytes(self) -> W::U8 {
        self.0.to_bytes()
    }
    #[op]
    fn from_bytes(bytes: W::U8) -> Self {
        Self(R::from_bytes(bytes), PhantomData)
    }
    #[inline(always)]
    fn to_native(self) -> W::U8 {
        self.0.to_native()
    }
    #[op]
    fn from_native(bytes: W::U8) -> Self {
        Self(R::from_native(bytes), PhantomData)
    }
}

impl<T: Half, R: Raw<Lane = u16, ArrayWhoseSliceIsAsRefOrAsMut = [u16; N]>, const N: usize, const P: usize>
    Halves16<T, R, N, P>
where
    u16: Fits<P>,
{
    #[inline(always)]
    fn new(bits: R) -> Self {
        Self(bits, PhantomData)
    }
    #[op]
    fn float<S: Cpu>(self) -> Core<F16, P>
    where
        Here: In<S>,
    {
        // It has its own: `half::native!`.
        if const { crate::X86 } {
            unreachable!()
        }
        self.0.cast_lanes::<u16, P, _>().bits()
    }
    #[op]
    fn of<S: Cpu>(v: Core<F16, P>) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::casted(v.bits::<u16, P>()))
    }
    #[inline(always)]
    fn one(value: T) -> u16 {
        T::unsigned(&[value])[0]
    }
}

/// Only for `f16`, on targets that have the instructions.
macro_rules! native {
    ($($name:ident($($arg:ident),*) = $f:path;)*) => {$(
        #[op] fn $name<S: Cpu>(self $(, $arg: Self)*) -> Self where Here: In<S> { Self::of($f(self.float() $(, $arg.float())*)) }
    )*};
    ($($name:ident $f:ident)*) => {$(
        #[op]
        fn $name<S: Cpu>(self, other: Self) -> R::Mask where Here: In<S> {
            let mask = self.float().$f(other.float());
            mask.convert::<_, { pattern::REPEAT }, 0, _>(mask)
        }
    )*};
}

impl<T: Half, R: Raw<Lane = u16, ArrayWhoseSliceIsAsRefOrAsMut = [u16; N]>, const N: usize, const P: usize> Raw
    for Halves16<T, R, N, P>
where
    u16: Fits<P>,
{
    type Lane = T;
    type Mask = R::Mask;
    type ArrayWhoseSliceIsAsRefOrAsMut = [T; N];
    type BoolsWhoseSliceIsAsRefOrAsMut = [bool; N];
    fn bools(_: impl FnMut(usize) -> bool) -> [bool; N] {
        unreachable!()
    }
    type Stored = R;

    #[inline(always)]
    fn from_stored(v: R) -> Self {
        Self::new(v)
    }
    #[op]
    fn splat<S: Cpu>(value: T) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::splat(Self::one(value)))
    }
    #[op]
    fn iota<S: Cpu>() -> Self
    where
        Here: In<S>,
    {
        Self::new(R::load(&const { T::SMALL }))
    }
    #[op]
    fn to_array<S: Cpu>(self) -> [T; N]
    where
        Here: In<S>,
    {
        *T::of_unsigned(&self.0.to_array()).first_chunk().unwrap()
    }
    #[op]
    fn lanes(&self) -> &[T] {
        T::of_unsigned(self.0.lanes())
    }
    #[op]
    fn lanes_mut(&mut self) -> &mut [T] {
        T::of_unsigned_mut(self.0.lanes_mut())
    }
    #[inline(always)]
    fn from_array<S: Cpu>(array: [T; N]) -> Self
    where
        Here: In<S>,
    {
        Self::load(&array)
    }
    #[op]
    #[track_caller]
    fn load<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::load(T::unsigned(from)))
    }
    #[op]
    #[track_caller]
    fn store<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        self.0.store(T::unsigned_mut(to))
    }
    #[op]
    fn store_masked<S: Cpu>(self, to: &mut [T], mask: R::Mask)
    where
        Here: In<S>,
    {
        self.0.store_masked(T::unsigned_mut(to), mask)
    }
    #[op]
    fn load_by_bits<S: crate::Isa>(s: S, from: &[T], skip: usize, no: Self) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::load_by_bits(s, T::unsigned(from), skip, no.0))
    }
    #[op]
    fn store_by_bits<S: crate::Isa>(self, s: S, to: Result<&mut [T], &mut [MaybeUninit<T>]>, skip: usize)
    where
        Here: In<S>,
    {
        self.0.store_by_bits(
            s,
            match to {
                Ok(to) => Ok(T::unsigned_mut(to)),
                Err(to) => Err(T::room(to)),
            },
            skip,
        )
    }
    #[op]
    fn fill_by_bits<S: Cpu>(self, to: &mut [MaybeUninit<T>], skip: usize) -> &mut [T]
    where
        Here: In<S>,
    {
        T::of_unsigned_mut(self.0.fill_by_bits(T::room(to), skip))
    }
    #[op]
    fn load_in_parts<S: Cpu>(from: &[T]) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::load_in_parts(T::unsigned(from)))
    }
    #[op]
    fn store_in_parts<S: Cpu>(self, to: &mut [T])
    where
        Here: In<S>,
    {
        self.0.store_in_parts(T::unsigned_mut(to))
    }
    #[op]
    #[track_caller]
    fn store_uninit<S: Cpu>(self, to: &mut [MaybeUninit<T>])
    where
        Here: In<S>,
    {
        crate::raw::copy::to_uninit(self.to_array(), to)
    }
    #[op]
    fn read<F: Source<T>, S: Cpu>(from: F, at: usize) -> Self
    where
        Here: In<S>,
    {
        Self::from_array(from.read(at))
    }
    #[op]
    fn write<F: Place<T>, S: Cpu>(self, to: &mut F, at: usize)
    where
        Here: In<S>,
    {
        to.write(at, self.to_array())
    }
    #[op]
    fn load3(from: &[T]) -> [Self; 3] {
        let [a, b, c] = R::load3(T::unsigned(from));
        [Self::new(a), Self::new(b), Self::new(c)]
    }
    #[op]
    fn load4(from: &[T]) -> [Self; 4] {
        let [a, b, c, d] = R::load4(T::unsigned(from));
        [Self::new(a), Self::new(b), Self::new(c), Self::new(d)]
    }
    #[op]
    fn store2([a, b]: [Self; 2], to: &mut [T]) {
        R::store2([a.0, b.0], T::unsigned_mut(to))
    }
    #[op]
    fn store3([a, b, c]: [Self; 3], to: &mut [T]) {
        R::store3([a.0, b.0, c.0], T::unsigned_mut(to))
    }
    #[op]
    fn store4([a, b, c, d]: [Self; 4], to: &mut [T]) {
        R::store4([a.0, b.0, c.0, d.0], T::unsigned_mut(to))
    }

    native! {
        add(other) = Core::add; sub(other) = Core::sub; mul(other) = Core::mul; div(other) = Core::div;
        sqrt() = Core::sqrt; floor() = Core::floor; ceil() = Core::ceil;
        trunc() = Core::trunc; round() = Core::round; round_ties_even() = Core::round_ties_even;
    }
    native!(eq simd_eq ne simd_ne lt simd_lt le simd_le);
    fn fma<S: Cpu>(self, _: Self, _: Self) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn min<S: Cpu>(self, _: Self) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn max<S: Cpu>(self, _: Self) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn reduce_sum<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn reduce_min<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn reduce_max<S: Cpu>(self) -> T
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn casted<Q: Raw, S: Cpu>(_: Q) -> Self
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn cast_lanes<U: Element + Fits<Q>, const Q: usize, S: Cpu>(self) -> Core<U, Q>
    where
        Here: In<S>,
    {
        unreachable!()
    }

    #[op]
    fn and<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.and(other.0))
    }
    #[op]
    fn or<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.or(other.0))
    }
    #[op]
    fn xor<S: Cpu>(self, other: Self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.xor(other.0))
    }
    #[inline(always)]
    fn not<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.not())
    }
    #[op]
    fn neg<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.xor(R::splat(0x8000)))
    }
    #[op]
    fn abs<S: Cpu>(self) -> Self
    where
        Here: In<S>,
    {
        Self::new(self.0.and(R::splat(0x7fff)))
    }
    #[op]
    fn select<S: Cpu>(mask: R::Mask, yes: Self, no: Self) -> Self
    where
        Here: In<S>,
    {
        Self::new(R::select(mask, yes.0, no.0))
    }
    fn from_mask(_: R::Mask) -> Self {
        unreachable!()
    }
    #[inline(always)]
    fn top_bits<S: Cpu>(self) -> R::Mask
    where
        Here: In<S>,
    {
        self.0.top_bits()
    }

    #[op]
    fn shuffle<Q: Raw<Lane = T>, const OP: u8, const K: usize>(self, other: Self) -> Q {
        Q::from_stored(self.0.shuffle::<Q::Stored, OP, K>(other.0))
    }
    fn shuffled<const FROM: usize, const Q: usize, const OP: u8, const K: usize, const JOINED: bool>(
        _: Core<u16, Q>,
        _: Core<u16, Q>,
    ) -> Self
    where
        u16: Fits<Q>,
    {
        unreachable!()
    }
    fn picked<const FROM: usize, const OP: u8, const K: usize>(_: &[T; FROM], _: &[T; FROM]) -> Self {
        unreachable!()
    }
    fn gather<Q: Raw, S: Cpu>(self, _: Q, _: Q::Mask, _: &[Q::Lane]) -> Q
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn scatter<Q: Raw, S: Cpu>(self, _: Q, _: Q::Mask, _: &mut [Q::Lane])
    where
        Here: In<S>,
    {
        unreachable!()
    }
    fn gathered<const M: usize, S: Cpu>(self, _: R::Mask, _: &[T], _: Core<usize, M>) -> Self
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        unreachable!()
    }
    fn scattered<const M: usize, S: Cpu>(self, _: R::Mask, _: &mut [T], _: Core<usize, M>)
    where
        usize: Fits<M>,
        Here: In<S>,
    {
        unreachable!()
    }
}
