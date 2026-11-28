//! Simd widths as types, so that "half of this width" needs no const arithmetic on generics.

#[cfg_attr(bun_simd_unoptimized, allow(unused_imports))]
use crate::endian::ToBytes;
#[cfg_attr(bun_simd_unoptimized, allow(unused_imports))]
use crate::f16;
use crate::half_raw::Halves16;
use crate::lane::{Element, Int, Lane};
use crate::many::{Holds, Many};
use crate::padded::Padded;
use crate::pattern::PART;
use crate::raw::{AsBits, Bits, Halves, MaskOf, Parts, Raw, RawOf, resize};
use crate::simd::{Simd as Core, u8x16, u8x32, u8x64};

/// The size of a vector in bytes: a power of two from [`B2`] to [`B512`].
///
/// Every width works on every target. One that is wider than the registers of the target is split. Those above 64 bytes are
/// there so that a register can be cast to any type of lane. What has a bit for each lane in a `u64` doesn't build for more than 64 lanes, but for `from_bitmask`, whose further lanes are false.
/// Only this crate implements the trait.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// fn sum<W: Width>(v: Simd<u32, W, S>) -> u32 {
///     v.reduce_sum()
/// }
/// assert_eq!((sum(u32x4::splat(1)), sum(u32x16::splat(1))), (4, 16));
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "`{Self}` is not known to be a width",
    label = "widths are B2, B4 and so on up to B512, and `Native<S>`",
    note = "the order is `Simd<T, W, S>`"
)]
pub trait Width: Copy + Send + Sync + 'static + Repr {
    /// The size in bytes.
    const BYTES: usize;
    /// Half of this width. [`B2`] is its own half, and using it as such doesn't build.
    type Half: Width;
    /// Twice this width. [`B512`] is its own double, and using it as such doesn't build.
    type Twice: Width;
    /// The smaller of this width and `W`.
    type Min<W: Width>: Width;
}

/// The smaller of this width and that of the registers, which have 16 to 64 bytes.
#[diagnostic::on_unimplemented(message = "`{Self}` is not known to be a width", note = "the order is `Upto<W, S>`")]
pub trait Capped {
    type AtMostNative<S: crate::Isa>: Width;
}
macro_rules! capped { ($($($w:ident)* => $to:ty;)*) => { $($(impl Capped for crate::$w { type AtMostNative<S: crate::Isa> = $to; })*)* }; }
capped! { B2 B4 B8 B16 => Self; B32 => S::Upto32; B64 B128 B256 B512 => S::Native; }

/// The `crate::simd` type behind each lane type at a width. Not nameable outside of this crate.
pub trait Repr: Sized + crate::make::Makers + Capped {
    type U8: Raw<Lane = u8> + Bits<Self>;
    type U16: Raw<Lane = u16> + Bits<Self>;
    type U32: Raw<Lane = u32> + Bits<Self>;
    type U64: Raw<Lane = u64> + Bits<Self>;
    type I8: Raw<Lane = i8> + Bits<Self>;
    type I16: Raw<Lane = i16> + Bits<Self>;
    type I32: Raw<Lane = i32> + Bits<Self>;
    type I64: Raw<Lane = i64> + Bits<Self>;
    type F32: Raw<Lane = f32> + Bits<Self>;
    type F64: Raw<Lane = f64> + Bits<Self>;
    type F16: Raw<Lane = f16> + Bits<Self>;
    type Bf16: Raw<Lane = crate::bf16> + Bits<Self>;

    // A mask of this width in registers of 16, 32 and 64 bytes.
    type MaskBy16<T: Lane>: Parts<MaskOf<T, Self>>
    where
        Self: Width;
    type MaskBy32<T: Lane>: Parts<MaskOf<T, Self>>
    where
        Self: Width;
    type MaskBy64<T: Lane>: Parts<MaskOf<T, Self>>
    where
        Self: Width;
    /// A mask of the width `W` in registers of this width.
    type Mask<T: Lane, W: Width>: Parts<MaskOf<T, W>>;

    /// [`B8`], or this if it is wider.
    type Register: Width;
    /// Half of `X` if this is wider than 64 bytes. For the others, the branches that are dead name no more types.
    type HalfIfWide<X: Width>: Width;
    type NarrowIfWide<T: Int>: Int;
    type Max2: Width;
    type Max4: Width;
    type Max8: Width;
    type Max16: Width;
    type Max32: Width;
    type Max64: Width;
    type Max128: Width;
    type Max256: Width;

    // These cut, or extend with unspecified bytes. They do nothing where the sizes are equal.
    fn to16(v: Self::U8) -> u8x16;
    fn to32(v: Self::U8) -> u8x32;
    fn to64(v: Self::U8) -> u8x64;
    fn from16(v: u8x16) -> Self::U8;
    fn from32(v: u8x32) -> Self::U8;
    fn from64(v: u8x64) -> Self::U8;
    /// For more than 64 bytes.
    fn by_64<const A: usize>(_: [Self::U8; A], _: impl Fn([u8x64; A]) -> u8x64) -> Self::U8 {
        unreachable!()
    }
}

/// As a literal, which the compiler doesn't have to evaluate. A lane that is wider than the vector still needs a type. `Tag::new` keeps it from being used.
macro_rules! lanes {
    (2 u8) => {
        2
    };
    (2 u16) => {
        1
    };
    (2 u32) => {
        1
    };
    (2 u64) => {
        1
    };
    (4 u8) => {
        4
    };
    (4 u16) => {
        2
    };
    (4 u32) => {
        1
    };
    (4 u64) => {
        1
    };
    (8 u8) => {
        8
    };
    (8 u16) => {
        4
    };
    (8 u32) => {
        2
    };
    (8 u64) => {
        1
    };
    (16 u8) => {
        16
    };
    (16 u16) => {
        8
    };
    (16 u32) => {
        4
    };
    (16 u64) => {
        2
    };
    (32 u8) => {
        32
    };
    (32 u16) => {
        16
    };
    (32 u32) => {
        8
    };
    (32 u64) => {
        4
    };
    (64 u8) => {
        64
    };
    (64 u16) => {
        32
    };
    (64 u32) => {
        16
    };
    (64 u64) => {
        8
    };
    (128 u8) => {
        128
    };
    (128 u16) => {
        64
    };
    (128 u32) => {
        32
    };
    (128 u64) => {
        16
    };
    (256 u8) => {
        256
    };
    (256 u16) => {
        128
    };
    (256 u32) => {
        64
    };
    (256 u64) => {
        32
    };
    (512 u8) => {
        512
    };
    (512 u16) => {
        256
    };
    (512 u32) => {
        128
    };
    (512 u64) => {
        64
    };
}

/// Beyond that, there is no arithmetic in `f16`.
const fn at_most_64(lanes: usize) -> usize {
    if lanes < 64 { lanes } else { 64 }
}

macro_rules! raw {
    ($t:ident $u:tt, $bytes:tt, itself) => { Core<$t, { lanes!($bytes $u) }> };
    ($t:ident $u:tt, $bytes:tt, padded) => { Padded<$t, { lanes!($bytes $u) }, { lanes!(16 $u) }> };
    ($t:ident $u:tt, $bytes:tt, wide) => { <$t as Holds<{ lanes!($bytes $u) }>>::Raw };
    (@register wide) => { Self };
    (@half $x:ident $half:ident, wide) => { $x::$half };
    (@half $x:ident $half:ident, $other:ident) => { $x };
    (@to16 $v:ident, wide) => { $v.cast_lanes::<u8, 16, crate::Portable>() };
    (@from16 $v:ident, wide) => { $v.shuffle::<_, { PART }, 0>($v) };
    (@from $v:ident, wide) => { $v.shuffle::<_, { PART }, 0>($v) };
    (@from $v:ident, $other:ident) => { Raw::cast::<Self::U8, crate::Portable>($v) };
    (@by_64 wide) => {
        #[inline(always)]
        fn by_64<const A: usize>(all: [Self::U8; A], f: impl Fn([u8x64; A]) -> u8x64) -> Self::U8 {
            Many::of(#[inline(always)] |i| {
                let mut parts = [u8x64::zero(); A];
                parts[0] = all[0].part(i);
                if const { A > 1 } { parts[1] = all[1].part(i); }
                if const { A > 2 } { parts[2] = all[2].part(i); }
                const { assert!(A <= 3) };
                f(parts)
            })
        }
    };
    (@by_64 $other:ident) => {};
    (@register itself) => { Self };
    (@register padded) => { B8 };
    (@to16 $v:ident, itself) => {
        resize::<Self, B16>($v)
    };
    (@to16 $v:ident, padded) => { $v.0 };
    (@from16 $v:ident, itself) => { resize::<B16, Self>($v) };
    (@from16 $v:ident, padded) => { Padded($v) };
}

/// Spares the compiler, and builds without optimization, a conversion that does nothing.
macro_rules! unless_same {
    (16 16 $v:ident, $other:expr) => {
        $v
    };
    (32 32 $v:ident, $other:expr) => {
        $v
    };
    (64 64 $v:ident, $other:expr) => {
        $v
    };
    (u8 u8 $v:ident, $other:expr) => {
        $v
    };
    ($a:tt $b:tt $v:ident, $other:expr) => {
        $other
    };
}

type OneRegister<T, W> = crate::raw::AsVector<RawOf<T, W>>;

macro_rules! mask {
    ($t:ident, 512, $by:tt) => { Halves<MaskOf<$t, B256>, mask!($t, 256, $by)> };
    ($t:ident, 256, $by:tt) => { Halves<MaskOf<$t, B128>, mask!($t, 128, $by)> };
    ($t:ident, 128, $by:tt) => { Halves<MaskOf<$t, B64>, mask!($t, 64, $by)> };
    ($t:ident, 64, 16) => { Halves<MaskOf<$t, B32>, mask!($t, 32, 16)> };
    ($t:ident, 64, 32) => { Halves<MaskOf<$t, B32>, OneRegister<$t, B32>> };
    ($t:ident, 32, 16) => { Halves<MaskOf<$t, B16>, OneRegister<$t, B16>> };
    ($t:ident, $bytes:tt, 16) => { OneRegister<$t, Self> };
    ($t:ident, $bytes:tt, 32) => { OneRegister<$t, Self> };
    ($t:ident, 64, 64) => { AsBits };
    ($t:ident, 32, 64) => { cfg_select! { all(target_arch = "x86_64", not(bun_simd_unoptimized)) => { crate::raw::AsBoth<Self::U8> } _ => { AsBits } } };
    ($t:ident, 16, 64) => { cfg_select! { all(target_arch = "x86_64", not(bun_simd_unoptimized)) => { crate::raw::AsBoth<Self::U8> } _ => { AsBits } } };
    ($t:ident, $bytes:tt, $by:tt) => { MaskOf<$t, Self> };
    ($t:ident, $w:ident in 16) => { $w::MaskBy16<$t> };
    ($t:ident, $w:ident in 32) => { $w::MaskBy32<$t> };
    ($t:ident, $w:ident in 64) => { $w::MaskBy64<$t> };
    ($t:ident, $w:ident in $bytes:tt) => { MaskOf<$t, $w> };
}

macro_rules! widths {
    ($($name:ident = $bytes:tt in $register:tt, half $half:ident, twice $twice:ident, min $w:ident => $min:ty,
       max [$m2:ident $m4:ident $m8:ident $m16:ident $m32:ident $m64:ident $m128:ident $m256:ident];)*) => {$(
        #[doc = concat!("A [`Width`] of ", stringify!($bytes), " bytes.")]
        #[derive(Copy, Clone, Debug)]
        pub struct $name;

        impl Width for $name {
            const BYTES: usize = $bytes;
            type Half = $half;
            type Twice = $twice;
            type Min<$w: Width> = $min;
        }

        impl crate::make::Makers for $name {}

        impl Repr for $name {
            type U8 = raw!(u8 u8, $bytes, $register);
            type U16 = raw!(u16 u16, $bytes, $register);
            type U32 = raw!(u32 u32, $bytes, $register);
            type U64 = raw!(u64 u64, $bytes, $register);
            type I8 = raw!(i8 u8, $bytes, $register);
            type I16 = raw!(i16 u16, $bytes, $register);
            type I32 = raw!(i32 u32, $bytes, $register);
            type I64 = raw!(i64 u64, $bytes, $register);
            type F32 = raw!(f32 u32, $bytes, $register);
            type F64 = raw!(f64 u64, $bytes, $register);
            type F16 = Halves16<f16, Self::U16, { lanes!($bytes u16) }, { at_most_64(size_of::<raw!(u16 u16, $bytes, $register)>() / 2) }>;
            type Bf16 = Halves16<crate::bf16, Self::U16, { lanes!($bytes u16) }, { at_most_64(size_of::<raw!(u16 u16, $bytes, $register)>() / 2) }>;
            type MaskBy16<T: Lane> = mask!(T, $bytes, 16);
            type MaskBy32<T: Lane> = mask!(T, $bytes, 32);
            type MaskBy64<T: Lane> = mask!(T, $bytes, 64);
            type Mask<T: Lane, W: Width> = mask!(T, W in $bytes);
            type Register = raw!(@register $register);
            type HalfIfWide<X: Width> = raw!(@half X Half, $register);
            type NarrowIfWide<T: Int> = raw!(@half T Narrow, $register);
            type Max2 = $m2;
            type Max4 = $m4;
            type Max8 = $m8;
            type Max16 = $m16;
            type Max32 = $m32;
            type Max64 = $m64;
            type Max128 = $m128;
            type Max256 = $m256;
            #[inline(always)] fn to16(v: Self::U8) -> u8x16 { unless_same!($bytes 16 v, raw!(@to16 v, $register)) }
            #[inline(always)] fn to32(v: Self::U8) -> u8x32 { unless_same!($bytes 32 v, v.cast_lanes::<u8, 32, crate::Portable>()) }
            #[inline(always)] fn to64(v: Self::U8) -> u8x64 { unless_same!($bytes 64 v, v.cast_lanes::<u8, 64, crate::Portable>()) }
            #[inline(always)] fn from16(v: u8x16) -> Self::U8 { unless_same!($bytes 16 v, raw!(@from16 v, $register)) }
            #[inline(always)] fn from32(v: u8x32) -> Self::U8 { unless_same!($bytes 32 v, raw!(@from v, $register)) }
            #[inline(always)] fn from64(v: u8x64) -> Self::U8 { unless_same!($bytes 64 v, raw!(@from v, $register)) }
            raw!(@by_64 $register);
        }

        bits!($name $half, $bytes, $register: u8: u8, u16: u16, u32: u32, u64: u64, i8: u8, i16: u16, i32: u32, i64: u64, f32: u32, f64: u64);
    )*};
}

macro_rules! bits {
    // In integers, as the bits of a float in another order are better not moved as a float.
    (@swapped $u:tt, $bytes:tt, $v:expr) => {
        cfg_select! { target_endian = "big" => Core::<$u, { lanes!($bytes $u) }>::from_ne_bytes($v).to_le_bytes(), _ => $v }
    };
    ($name:ident $half:ident, $bytes:tt, itself: $($t:ident: $u:tt),*) => {$(
        impl Bits<$name> for raw!($t $u, $bytes, itself) {
            #[inline(always)] fn to_bytes(self) -> Core<u8, $bytes> { unless_same!($t u8 self, bits!(@swapped $u, $bytes, bits_or!(<_, Core<u8, $bytes>>(self), self.to_ne_bytes()))) }
            #[inline(always)] fn from_bytes(bytes: Core<u8, $bytes>) -> Self { unless_same!($t u8 bytes, bits_or!(<Core<u8, $bytes>, _>(bits!(@swapped $u, $bytes, bytes)), Self::from_ne_bytes(bits!(@swapped $u, $bytes, bytes)))) }
            #[inline(always)] fn to_native(self) -> Core<u8, $bytes> { bits_or!((self), self.to_ne_bytes()) }
            #[inline(always)] fn from_native(bytes: Core<u8, $bytes>) -> Self { bits_or!((bytes), Self::from_ne_bytes(bytes)) }
        }
    )*};
    ($name:ident $half:ident, $bytes:tt, wide: u8: u8, $($t:ident: $u:tt),*) => {
        impl Bits<$name> for raw!(u8 u8, $bytes, wide) {
            #[inline(always)] fn to_bytes(self) -> Self { self }
            #[inline(always)] fn from_bytes(bytes: Self) -> Self { bytes }
            #[inline(always)] fn to_native(self) -> Self { self }
            #[inline(always)] fn from_native(bytes: Self) -> Self { bytes }
        }
        $(impl Bits<$name> for raw!($t $u, $bytes, wide) {
            #[inline(always)] fn to_bytes(self) -> <$name as Repr>::U8 { Wide::<$t, $name>::to_bytes(self) }
            #[inline(always)] fn from_bytes(bytes: <$name as Repr>::U8) -> Self { Wide::<$t, $name>::from_bytes(bytes) }
            #[inline(always)] fn to_native(self) -> <$name as Repr>::U8 { Wide::<$t, $name>::to_native(self) }
            #[inline(always)] fn from_native(bytes: <$name as Repr>::U8) -> Self { Wide::<$t, $name>::from_native(bytes) }
        })*
    };
    ($name:ident $half:ident, $bytes:literal, padded: $($unused:tt)*) => {};
}

/// By halves.
struct Wide<T, W>(T, W);
macro_rules! wide { ($($to:ident $from:ident)*) => {$(
    #[inline(always)]
    fn $to(v: RawOf<T, W>) -> W::U8 { apart!({
        let [lower, upper]: [RawOf<T, W::Half>; 2] = [v.shuffle::<_, { PART }, 0>(v), v.shuffle::<_, { PART }, 1>(v)];
        lower.$to().shuffle::<_, { PART }, 0>(upper.$to())
    }) }
    #[inline(always)]
    fn $from(bytes: W::U8) -> RawOf<T, W> { apart!({
        let lower = RawOf::<T, W::Half>::$from(bytes.shuffle::<_, { PART }, 0>(bytes));
        lower.shuffle::<_, { PART }, 0>(Bits::<W::Half>::$from(bytes.shuffle::<_, { PART }, 1>(bytes)))
    }) }
)*}; }
impl<T: Lane, W: Width> Wide<T, W> {
    wide!(to_bytes from_bytes to_native from_native);
}

/// The same value.
#[inline(always)]
fn turned<T, V>(v: V) -> V {
    let these = cfg!(all(target_arch = "powerpc64", target_endian = "big", not(miri)));
    if these && crate::simd::ARRAYS && size_of::<T>() == 4 { core::hint::black_box(v) } else { v }
}
impl<T: Element + crate::simd::Fits<P>, const N: usize, const P: usize, const BYTES: usize, W> Bits<W>
    for Padded<T, N, P>
where
    W: Repr<U8 = Padded<u8, BYTES, 16>>,
    Core<T, P>: Bits<B16>,
{
    #[inline(always)]
    fn to_bytes(self) -> W::U8 {
        Padded(turned::<T, _>(self.0.to_bytes()))
    }
    #[inline(always)]
    fn from_bytes(bytes: W::U8) -> Self {
        Padded(turned::<T, _>(Bits::from_bytes(bytes.0)))
    }
    #[inline(always)]
    fn to_native(self) -> W::U8 {
        Padded(self.0.to_native())
    }
    #[inline(always)]
    fn from_native(bytes: W::U8) -> Self {
        Padded(Bits::from_native(bytes.0))
    }
}

widths! {
    B2 = 2 in padded, half B2, twice B4, min W => W::Max2, max [B2 B2 B2 B2 B2 B2 B2 B2];
    B4 = 4 in padded, half B2, twice B8, min W => W::Max4, max [B2 B4 B4 B4 B4 B4 B4 B4];
    B16 = 16 in itself, half B8, twice B32, min W => W::Max16, max [B2 B4 B8 B16 B16 B16 B16 B16];
    B32 = 32 in itself, half B16, twice B64, min W => W::Max32, max [B2 B4 B8 B16 B32 B32 B32 B32];
    B64 = 64 in itself, half B32, twice B128, min W => W::Max64, max [B2 B4 B8 B16 B32 B64 B64 B64];
    B128 = 128 in wide, half B64, twice B256, min W => W::Max128, max [B2 B4 B8 B16 B32 B64 B128 B128];
    B256 = 256 in wide, half B128, twice B512, min W => W::Max256, max [B2 B4 B8 B16 B32 B64 B128 B256];
    B512 = 512 in wide, half B256, twice B512, min W => W, max [B2 B4 B8 B16 B32 B64 B128 B256];
}
// NEON has registers of 8 bytes.
#[cfg(target_arch = "aarch64")]
widths! { B8 = 8 in itself, half B4, twice B16, min W => W::Max8, max [B2 B4 B8 B8 B8 B8 B8 B8]; }
#[cfg(not(target_arch = "aarch64"))]
widths! { B8 = 8 in padded, half B4, twice B16, min W => W::Max8, max [B2 B4 B8 B8 B8 B8 B8 B8]; }

/// For the tests of consumers: see the guide.
pub const fn native(bytes: usize) -> usize {
    cfg_select! {
        bun_simd_native = "16" => 16,
        bun_simd_native = "32" => 32,
        bun_simd_native = "64" => 64,
        _ => bytes,
    }
}

/// The width of a register of this many bytes.
pub trait Of<const BYTES: usize> {
    type Width: Width;
}
impl Of<16> for () {
    type Width = B16;
}
impl Of<32> for () {
    type Width = B32;
}
impl Of<64> for () {
    type Width = B64;
}
