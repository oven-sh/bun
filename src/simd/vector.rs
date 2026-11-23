use crate::half::in_f32;
use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::{Bits, Raw, RawMask, RawOf, bitcast};
use crate::{B16, Count, Float, HasSign, Int, Isa, Lane, MaskOf, Place, Signed, Tag, Unsigned, Width};
use core::ops::*;

/// `W` bytes in lanes of `T`. Integer arithmetic wraps.
///
/// The functions of the type make vectors, in what has [`simd`](macro@crate::simd) or
/// [`kernel`](macro@crate::kernel). Operators and most methods work on each lane, and comparisons give a [`Mask`](crate::Mask). Lane 0 is at
/// the lowest address. A *block* is 16 bytes of a vector, or all of a shorter one. See [the index](crate::index) for all
/// operations by task.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = i32x4::load(&[1, -2, 3, -4]);
/// assert_eq!(v * 2 + 1, [3, -3, 7, -7]);
/// assert_eq!(v.simd_lt(0).select(-v, v).reduce_sum(), 10);
/// let mut out = [0; 3];
/// v.reverse().store_partial(&mut out);
/// assert_eq!(out, [-4, 3, -2]);
/// # } example()
/// ```
pub struct Simd<
    T: Lane,  // For < and max: simd_lt, simd_max. Over the lanes: reduce_max. any and all are for masks.
    W: Width, // A type: B16 is 16 bytes.
    S: Isa,   // It is known in functions with #[simd] or #[kernel].
> {
    pub(crate) raw: RawOf<T, W>,
    pub(crate) s: S,
}

impl<S: Isa, T: Lane, W: Width> Copy for Simd<T, W, S> {}
impl<S: Isa, T: Lane, W: Width> Clone for Simd<T, W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<S: Isa, T: Lane, W: Width> core::fmt::Debug for Simd<T, W, S> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.to_array().fmt(f)
    }
}

/// `[T; LANES]`, where `LANES` is the number of lanes of `T` in `W`. Where that depends on a parameter, `array[..]` is a slice.
pub type Array<T, W> = <RawOf<T, W> as Raw>::ArrayWhoseSliceIsAsRefOrAsMut;
/// `[bool; LANES]`, for the mask of a vector of `T`.
pub type Bools<T, W> = <RawOf<<T as Lane>::Signed, W> as Raw>::BoolsWhoseSliceIsAsRefOrAsMut;
/// Whether three interleaved vectors are taken apart with blends and one shuffle within the blocks for each.
pub(crate) const fn blends3<S: Isa, T: Lane, W: Width>() -> bool {
    S::SSE41
        && (W::BYTES == 16 || W::BYTES == 32)
        && W::BYTES <= S::REGISTER
        && (W::BYTES == 16 || size_of::<T>() == 2 || size_of::<T>() == 8 || !two_tables::<S, T>())
}
/// Whether a lookup in two whole vectors is one instruction.
pub(crate) const fn two_tables<S: Isa, T: Lane>() -> bool {
    if size_of::<T>() == 1 { S::AVX512VBMI } else { S::AVX512BW }
}

/// A vector, an array, a reference to these, or a number that stands for a vector with that number in each lane: `v - 1`, `v.simd_eq(b'"')`.
///
/// The number has the type of the lane. [`Lane::of`] makes one in code that is generic over the lane: `v - T::of::<1>()`.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = u8x4::from([1, 2, 3, 4]);
/// assert_eq!(v + v, v * 2);
/// assert_eq!(v + [10, 20, 30, 40], [11, 22, 33, 44]);
/// # } example()
/// ```
#[diagnostic::on_unimplemented(
    message = "`{Self}` can't be an operand here",
    label = "expected `{T}`, an array of as many lanes, or a vector of `{T}` of the width `{W}`",
    note = "other lanes: `bitcast` keeps the bits, and `cast`, `saturating_cast` and `widen` keep the values",
    note = "a shorter array: `repeat(&array)`",
    note = "another width: `resize`, `split` or `concat`",
    note = "a mask: `to_simd`, `m.select(v, 0)`. A number in generic code: `T::of::<1>()`"
)]
pub trait Operand<T: Lane, W: Width, S: Isa>: Copy {
    #[doc(hidden)]
    fn vector(self, d: Tag<S, T, W>) -> Simd<T, W, S>;
    #[doc(hidden)]
    #[inline(always)]
    fn number(_: Self) -> Option<T> {
        None
    }
    /// Lane 0, or the number, which can be wider than the vector.
    #[doc(hidden)]
    #[op]
    fn alone(this: Self, s: S) -> T {
        this.vector(Tag::new(s)).get_lane()
    }
    /// `v / self`.
    #[doc(hidden)]
    #[op]
    fn divide(self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.divide_by_lanes(self.vector(v.tag()))
    }
}
impl<S: Isa, T: Lane, W: Width> Operand<T, W, S> for Simd<T, W, S> {
    #[inline(always)]
    fn vector(self, _: Tag<S, T, W>) -> Self {
        self
    }
}
#[doc(hidden)]
#[diagnostic::do_not_recommend]
impl<S: Isa, T: Lane, W: Width> Operand<T, W, S> for &Simd<T, W, S> {
    #[inline(always)]
    fn vector(self, _: Tag<S, T, W>) -> Simd<T, W, S> {
        *self
    }
}
impl<S: Isa, T: Lane, W: Width> Operand<T, W, S> for T {
    #[inline(always)]
    fn vector(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.set(self)
    }
    #[inline(always)]
    fn number(this: T) -> Option<T> {
        Some(this)
    }
    #[inline(always)]
    fn alone(this: T, _: S) -> T {
        this
    }
    #[inline(always)]
    fn divide(self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.divide_by_number(self)
    }
}

macro_rules! shuffle1 { ($($(#[$doc:meta])* $vis:vis $name:ident = $op:ident $k:literal, $min:literal;)*) => {$(
    $(#[$doc])* #[op] #[track_caller]
    $vis fn $name(self) -> Self { require!("the vector has too few lanes", Self::LANES >= $min); self.shuffle::<{ p::$op }, $k>(self) }
)*}; }
macro_rules! shuffle2 { ($($(#[$doc:meta])* $vis:vis $name:ident = $op:ident;)*) => {$(
    $(#[$doc])* #[op] $vis fn $name(self, other: Self) -> Self { self.shuffle::<{ p::$op }, 0>(other) }
)*}; }
macro_rules! reduce { ($v:ident, $op:ident, $reduce:ident, $again:ident, $across:ident, $max:literal) => {
    choose! {
        S::A64 && Self::HALF && !Self::SOFT && W::BYTES == 16 => $v.extreme_in_all($max).get_lane(),
        Self::HALF => crate::arithmetic::tree!($v, $again, |a, b| a.$op(b)),
        // SSE2 has these with the other sign.
        S::SSE2 && S::ONLY_SSE2 && T::BITS == 8 && T::IS_SIGNED => T::from_u64(($v.bitcast::<u8>() ^ 0x80).barrier().$again() as u64 ^ 0x80),
        S::SSE2 && S::ONLY_SSE2 && T::BITS == 16 && !T::IS_SIGNED => T::from_u64(($v.bitcast::<i16>() ^ i16::MIN).barrier().$again() as u64 ^ 0x8000),
        (!S::SSE2 || W::BYTES <= 16 && !S::BY_HAND) && !S::ARM || !matches!(T::KIND, Kind::Float) || Self::LANES == 1 => on_arch!(Self::handed, $v.raw.$reduce()),
        W::BYTES > 16 => $v.lower_half().$op($v.upper_half()).$again(),
        S::A64 && Self::LANES == 4 => $v.with_bytes::<T>($v.s.$across::<W>($v.bytes())).get_lane(),
        _ => {
            let v = choose! { Self::LANES == 4 => $v.$op($v.shuffle1032()), _ => $v };
            v.$op(v.swap_pairs()).get_lane()
        },
    }
}; }
/// See `Parts`.
#[rules]
macro_rules! compare { ($a:ident, $op:ident, $simd:ident, $order:literal, $b:expr) => {{
    let b: Self = $b;
    halves_if!(W::BYTES > S::REGISTER, |a: Self = $a, b: Self = b| {
        let ((a0, a1), (b0, b1)) = (a.registers(), b.registers());
        a.tag().combine_masks(a1.$simd(b1), a0.$simd(b0))
    });
    return_if!(crate::X86 && T::IS_FLOAT && T::BITS >= 32, crate::mask::Mask::of_floats($a.s, $a.raw.$op(b.raw)));
    let mask: MaskOf<T, W, S> = crate::mask::Mask::compared($a.s, $a.raw.$op(b.raw));
    #[cfg(all(any(target_feature = "vector-enhancements-1", target_feature = "lsx"), not(miri)))]
    return_if!(T::IS_FLOAT && T::BITS >= 32 && $order, crate::mask::Mask::from_full(if are_known!($a.raw) && are_known!(b.raw) && crate::OPTIMIZED { mask.to_vector() } else { mask.to_vector().black_box() }));
    return_if!(crate::X86 && MaskOf::<T, W, S>::BOTH && !T::IS_FLOAT && (T::IS_SIGNED || T::BITS < 64 || !$order), $a.${concat($op, _in_lanes)}(b, mask));
    mask
}}; }
/// Behind a barrier, LLVM doesn't see a constant, and inverts comparisons without a sign.
macro_rules! by_number {
    ($a:ident, $simd:ident, $other:ident $(, $below:literal $or_equal:literal)?) => {
        $(if_here!(S::WASM && crate::OPTIMIZED && !T::IS_FLOAT && T::BITS < 64, if let Some(number) = Operand::number($other) && let Some(it) = $a.against(number, $below, $or_equal) {
            return it;
        });)?
        if const { Self::HIDES_NUMBERS }
            && let Some(number) = Operand::number($other)
            && (!S::A64 || is_known!(number))
        {
            return live!(
                Self::HIDES_NUMBERS,
                apart!($a.s, {
                    let (lower, upper) = $a.registers();
                    $a.tag().combine_masks(upper.$simd(number), lower.$simd(number))
                })
            );
        }
    };
}
/// Operations of the target, for one type of lane.
macro_rules! of_target {
    ($($t:ty { $($(#[$doc:meta])* $vis:vis $name:ident($($arg:ident: $a:ty),*) -> $out:ty = $op:ident $(, from $least:literal)?;)* })*) => {$(
        impl<S: Isa, W: Width> Simd<$t, W, S> {$(
            $(#[$doc])* #[op]
            #[track_caller]
            $vis fn $name(self $(, $arg: impl Operand<$a, W, S>)*) -> Simd<$out, W, S> {
                require!("a lane of the result is wider than the vector", W::BYTES >= size_of::<$out>());
                $(require!("this takes vectors of 16 bytes or more", W::BYTES >= $least);)?
                self.with_bytes(self.s.$op::<W>(self.bytes() $(, $arg.vector(Tag::new(self.s)).bytes())*))
            }
        )*}
    )*};
}

impl<S: Isa, T: Lane, W: Width> Unpin for Simd<T, W, S> {}
impl<S: Isa, T: Lane, W: Width> core::panic::UnwindSafe for Simd<T, W, S> {}
impl<S: Isa, T: Lane, W: Width> core::panic::RefUnwindSafe for Simd<T, W, S> {}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    const HIDES_NUMBERS: bool = W::BYTES > S::REGISTER && (S::SSE2 || S::A64) && !T::IS_FLOAT;
    const SHIFTS_IN_PAIRS: bool = crate::X86 && size_of::<T>() <= 2 && W::BYTES >= 4;
    const ZIPS_BLOCKS: bool =
        crate::X86 && S::REGISTER == 64 && W::BYTES == 64 && size_of::<T>() == 1 && !two_tables::<S, T>();
    const BLOCK: usize = if W::BYTES < 16 { W::BYTES } else { 16 };

    #[inline(always)]
    pub(crate) fn new(s: S, raw: RawOf<T, W>) -> Self {
        Self { raw, s }
    }
    #[inline(always)]
    pub(crate) fn with(self, raw: RawOf<T, W>) -> Self {
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        Self::new(self.s, raw)
    }
    #[inline(always)]
    pub(crate) fn like(self, other: impl Operand<T, W, S>) -> Self {
        other.vector(self.tag())
    }
    /// The same, for the other operand of an instruction.
    #[on(WASM)]
    #[op]
    fn beside(self, other: impl Operand<T, W, S>) -> Self {
        if_here!(
            S::WASM && crate::OPTIMIZED,
            if Operand::number(other).is_some() {
                return self.like(other).hoisted(self);
            }
        );
        self.like(other)
    }
    /// The same for `&`. LLVM has to see a mask that clears no bit, or that may limit an index.
    #[on(WASM)]
    #[op]
    fn beside_and(self, other: impl Operand<T, W, S>) -> Self {
        if_here!(
            S::WASM && crate::OPTIMIZED,
            if let Some(number) = Operand::number(other) {
                let (n, mask) = (T::unsigned(&[number])[0].to_u64(), self.like(other));
                let cleared = self.with(self.raw.and(mask.raw.not()));
                return core::hint::select_unpredictable(
                    T::BITS >= 32 && n & n.wrapping_add(1) == 0,
                    mask,
                    mask.hoisted(cleared),
                );
            }
        );
        self.like(other)
    }
    #[on(WASM)]
    #[op]
    fn hoisted(self, other: Self) -> Self {
        self.with_bytes(self.s.hoisted::<W>(self.bytes(), other.bytes()))
    }
    #[on(WASM)]
    #[op]
    fn less(self, other: Self) -> MaskOf<T, W, S> {
        compare!(self, lt, less, true, other)
    }
    #[on(WASM)]
    #[op]
    fn up_to(self, other: Self) -> MaskOf<T, W, S> {
        compare!(self, le, up_to, true, other)
    }
    /// With a constant, in the form that is shortest on x86. LLVM has another, and shifts for a sign.
    #[on(WASM)]
    #[op]
    fn against(self, number: T, below: bool, or_equal: bool) -> Option<MaskOf<T, W, S>> {
        let (top, n) = (1 << (T::BITS - 1).min(31), T::unsigned(&[number])[0].to_u64());
        // The first value of the upper part, in the order of unsigned numbers.
        let first = (n ^ if T::IS_SIGNED { top } else { 0 }) + (below == or_equal) as u64;
        if !is_known!(n) || first < 2 || first > 2 * top - 2 {
            return None;
        }
        // It may know the answer.
        let answer =
            self.less(self.like(T::from_i64((first ^ if T::IS_SIGNED { top } else { 0 }) as i64))).to_simd::<T>();
        let of = always!(|n: u64| self.like(T::from_i64(n as i64)).hoisted(answer));
        Some(match (T::IS_SIGNED, below) {
            (signed, _) if first == top && signed == below => self.to_mask(),
            _ if first == top => (!self.tag().to_signed().zero()).less(self.cast_signed()).retype(),
            (true, true) => self.less(of(first ^ top)),
            (true, _) => of((first - 1) ^ top).less(self),
            (_, true) => self.up_to(of(first - 1)),
            _ => of(first).up_to(self),
        })
    }
    #[inline(always)]
    pub(crate) fn with_bytes<U: Lane>(self, bytes: W::U8) -> Simd<U, W, S> {
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        Simd::new(self.s, Bits::from_bytes(bytes))
    }
    #[inline(always)]
    pub(crate) fn bytes(self) -> W::U8 {
        self.raw.to_bytes()
    }
    #[inline(always)]
    pub(crate) fn with_native(self, bytes: W::U8) -> Self {
        self.with(Bits::from_native(bytes))
    }
    /// `bitcast` in the order of the CPU, for what moves whole lanes, and for masks.
    #[inline(always)]
    pub(crate) fn reinterpret<U: Lane>(self, // Take bitcast.
    ) -> Simd<U, W, S> {
        Simd::new(self.s, Bits::from_native(self.raw.to_native()))
    }
    #[op]
    pub(crate) fn shuffle<const OP: u8, const K: usize>(
        self, // Take swizzle, swizzle_dyn or lookup.
        other: Self,
    ) -> Self {
        choose! { |a: Self = self, b: Self = other|
            W::BYTES > 64 && p::stays(OP) => apart!(a.s, a.tag().combine(a.upper_half().shuffle::<OP, K>(b.upper_half()), a.lower_half().shuffle::<OP, K>(b.lower_half()))),
            W::BYTES > 64 && OP == p::REVERSE => apart!(a.s, a.tag().combine(a.lower_half().reverse(), a.upper_half().reverse())),
            // One lookup, of which LLVM would make two instructions.
            S::A64 && crate::OPTIMIZED && size_of::<T>() < 8 && W::BYTES > 16 && OP == p::REVERSE => a.tag().combine(a.lower_half().reverse(), a.upper_half().reverse()),
            S::A64 && crate::OPTIMIZED && size_of::<T>() < 8 && W::BYTES >= 16 && (OP == p::REVERSE || OP == p::REVERSE_GROUPS && K * size_of::<T>() == 16) => {
                let d = a.tag().repartition::<u8>();
                a.move_lanes(d.opaque((d.iota(0) & 15 ^ (16 - size_of::<T>()) as u8).raw))
            },
            S::A64 && crate::OPTIMIZED && size_of::<T>() == 4 && W::BYTES >= 16 && OP == p::SHUFFLE4 && !p::is_short(K) => {
                let d = a.tag().repartition::<u8>();
                a.move_lanes(d.opaque(d.from_fn(#[inline(always)] |i| (4 * (K >> (i / 4 % 4 * 2) & 3) + i % 4) as u8).raw))
            },
            S::BY_HAND && size_of::<T>() == 1 && W::BYTES >= 4 && W::BYTES <= 64 && matches!(OP, p::REVERSE | p::REVERSE_GROUPS | p::SHUFFLE4 | p::DUP_EVEN | p::DUP_ODD) => {
                let from = const { <p::Pattern<OP, K, 64, 64, 64, 1> as crate::simd::Swizzle<64>>::INDEX };
                apart!(a.s, a.swizzle(#[inline(always)] |i| from[i] % Self::LANES))
            },
            Self::WORDS_BY_LOOKUP && (OP == p::SHUFFLE4 || OP == p::REVERSE_GROUPS && (K == 4 || K == 2 && S::REGISTER < 64)) => {
                let from = const { <p::Pattern<OP, K, 64, 64, 64, 1> as crate::simd::Swizzle<64>>::INDEX };
                a.words_in_blocks(#[inline(always)] |i| from[i])
            },
            S::AVX512VBMI && W::BYTES == 64 && size_of::<T>() == 2 && matches!(OP, p::SORT3_WHOLE | p::UNSORT3_WHOLE) => {
                let from = const { <p::Pattern<OP, K, 32, 32, 32, 8> as crate::simd::Swizzle<32>>::INDEX };
                a.of_one(#[inline(always)] |i| from[i] % 32)
            },
            S::AVX512F && W::BYTES == 64 && size_of::<T>() == 4 && (OP == p::REVERSE || OP == p::REVERSE_GROUPS && K >= 8) => {
                let from = const { <p::Pattern<OP, K, 16, 16, 16, 4> as crate::simd::Swizzle<16>>::INDEX };
                let whole = a.of_one(#[inline(always)] |i| from[i] % 16);
                core::hint::select_unpredictable(are_known!(a.raw), a.with(a.raw.shuffle::<_, OP, K>(b.raw)), whole)
            },
            // A shift and a blend.
            OP == p::INTERLEAVE_EVEN && Self::SHIFTS_IN_PAIRS => b.shift_in_pairs(true).odd_even(a),
            OP == p::INTERLEAVE_ODD && Self::SHIFTS_IN_PAIRS => b.odd_even(a.shift_in_pairs(false)),
            crate::X86 && S::REGISTER == 64 && W::BYTES == 64 && size_of::<T>() <= 2 && matches!(OP, p::ZIP_BLOCKS | p::INTERLEAVE_EVEN_BLOCKS | p::INTERLEAVE_ODD_BLOCKS) =>
                a.reinterpret::<u64>().unseen().shuffle::<OP, K>(b.reinterpret().unseen()).reinterpret(),
            W::BYTES >= 64 && size_of::<T>() < 8 && p::moves_blocks(OP) => a.reinterpret::<u64>().shuffle::<OP, K>(b.reinterpret()).reinterpret(),
            // Within the blocks, and then whole blocks.
            OP == p::INTERLEAVE_WHOLE_LOWER && Self::ZIPS_BLOCKS => a.interleave_lower(b).shuffle::<{ p::ZIP_BLOCKS }, 0>(a.interleave_upper(b)),
            OP == p::INTERLEAVE_WHOLE_UPPER && Self::ZIPS_BLOCKS => a.interleave_lower(b).shuffle::<{ p::ZIP_BLOCKS }, 2>(a.interleave_upper(b)),
            // Not after reversals: large closures would not be inlined then.
            matches!(OP, p::STRIDE | p::SHUFFLE4) => on_x86!(a.with(a.raw.shuffle::<_, OP, K>(b.raw)).settled(), shuffled::<OP, K>()),
            _ => on_x86!(a.with(on_x86!(a, to_shuffle::<OP, K>()).raw.shuffle::<_, OP, K>(on_x86!(b, to_shuffle::<OP, K>()).raw)), shuffled::<OP, K>()),
        }
    }
    /// The halves, in a form that keeps LLVM from comparing the whole vectors after all.
    #[inline(always)]
    pub(crate) fn registers(self) -> (Simd<T, W::Half, S>, Simd<T, W::Half, S>) {
        apart_unoptimized!(self.s, {
            // LLVM charges for each lane of an upper half, and then doesn't unroll loops.
            let (lower, upper) = choose! {
                S::A64 && W::BYTES >= 32 && W::BYTES <= 64 && size_of::<T>() < 8 => {
                    let all = self.bitcast::<u64>();
                    (all.lower_half().bitcast(), all.upper_half().bitcast())
                },
                _ => (self.lower_half(), self.upper_half()),
            };
            (lower.barrier(), upper.barrier())
        })
    }
    /// Hides where this comes from until instructions are selected, and then disappears. Below 16 bytes on x86, it is a hint only.
    #[op]
    pub(crate) fn barrier(self) -> Self {
        choose! { |this: Self = self|
            W::BYTES > S::REGISTER || !crate::OPTIMIZED || cfg!(miri) && W::BYTES == 64 => this,
            S::ARM => this.tag().opaque(this.raw),
            // The sums are below 2^16.
            crate::X86 && S::SSE2 && W::BYTES >= 16 => {
                let sums = this.with_bytes::<u64>(this.s.sums_of_8_abs_diff::<W>(this.bytes(), this.bytes()));
                this.with_bytes(this.bytes().add((sums >> 16u32).bytes()))
            },
            crate::X86 => this.with_bytes(this.s.average_u8::<W>(this.bytes(), this.bytes())),
            _ => this,
        }
    }
    /// [`core::hint::black_box`] that stays in registers on x86 and AArch64. The compiler forgets where the value comes from, so
    /// it can't join what is before and after. See [what LLVM undoes](crate::guide::speed#what-llvm-undoes) and [constant time](crate::guide::speed#constant-time).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (table, secret, mut found) = ([[1u32; 4], [2; 4]], 1, u32x4::zero());
    /// for (i, row) in table.iter().enumerate() {
    ///     let all = u32x4::splat(i as u32).simd_eq(secret).to_simd::<u32>();
    ///     found |= u32x4::load(row).black_box() & all.black_box();
    /// }
    /// assert_eq!(found, 2);
    /// # } example()
    /// ```
    #[doc(alias("barrier", "value_barrier", "opaque", "hide", "constant_time", "ct_select", "ct_eq", "secret"))]
    #[op]
    pub fn black_box(self) -> Self {
        halves_if!(W::BYTES > S::REGISTER, |v: Self = self| {
            let (lower, upper) = v.registers();
            v.tag().combine(upper.black_box(), lower.black_box())
        });
        choose! { |this: Self = self|
            W::BYTES < 16 => this.tag().resize_bitcast(this.s.fixed::<u8, crate::B16>().resize_bitcast(this).black_box()),
            S::SSE2 => this.with_bytes(this.s.hidden::<W>(this.bytes())),
            crate::regs::VECTORS && W::BYTES == 16 => {
                this.with(Bits::from_native(W::from16(crate::regs::vector16(W::to16(this.raw.to_native())))))
            },
            _ => core::hint::black_box(this),
        }
    }
    /// The same value. A conversion from 32 bytes in memory names no long register, and LLVM leaves out `vzeroupper`. So its result goes through one.
    #[op]
    pub(crate) fn narrowed_from<U: Lane, X: Width>(self, _: Simd<U, X, S>) -> Self {
        return_if!(
            S::AVX2
                && crate::OPTIMIZED
                && X::BYTES == 32
                && W::BYTES == 16
                && U::BITS == 64
                && T::BITS == 32
                && (U::IS_FLOAT || T::IS_FLOAT && S::AVX512F),
            self.resize::<crate::B32>().black_box().resize()
        );
        self
    }
    /// `barrier`, but for constants. The test can keep LLVM from moving others out of a loop.
    #[on(X86)]
    #[op]
    pub(crate) fn barrier_unless_known(self) -> Self {
        if const { !crate::OPTIMIZED } {
            return self;
        }
        core::hint::select_unpredictable(are_known!(self.raw), self, self.barrier())
    }
    /// The same, also while instructions are selected.
    #[op]
    pub(crate) fn hidden_unless_known(self) -> Self {
        if const { !crate::OPTIMIZED } {
            return self;
        }
        core::hint::select_unpredictable(are_known!(self.raw), self, self.black_box())
    }
    /// The same value.
    #[op]
    pub(crate) fn in_place(self) -> Self {
        choose! { cfg!(not(miri)) && (S::SSE2 || crate::regs::VECTORS) => self.black_box(), _ => self }
    }
    /// After a `select`. If it is stored where an operand was loaded, LLVM would write `vpmaskmov`, which takes 12 cycles on Zen 1 to 4.
    #[op]
    pub(crate) fn stored_whole(self) -> Self {
        return_if!(!S::AVX2 || S::AVX512F || size_of::<T>() < 4 || W::BYTES < 16 || !crate::OPTIMIZED, |v: Self = self| v);
        halves_if!(W::BYTES > S::REGISTER, |v: Self = self| {
            let (lower, upper) = v.registers();
            v.tag().combine(upper.stored_whole(), lower.stored_whole())
        });
        // The highest bits are clear. LLVM sees that later than it sees through the sums.
        return_if!(crate::X86, |v: Self = self| {
            let low = (v.bitcast::<u16>() >> 9u32).bytes();
            v.with_bytes(v.bytes().add(((v.with_bytes::<u16>(v.s.pack_i16_u8::<W>(low, low)) >> 7u32).bitcast::<u8>() & 1).bytes()))
        });
        self
    }
    /// For speed, after a shuffle of a whole register of AVX-512.
    /// It is a call until it is inlined, which counts against a closure without features.
    #[op]
    pub(crate) fn settled(self) -> Self {
        choose! {
            !crate::X86 || S::REGISTER < 64 || W::BYTES != 64 => self,
            size_of::<T>() == 1 => self.barrier(),
            _ => self.with_bytes(self.s.average_u16::<W>(self.bytes(), self.bytes())),
        }
    }
    /// A shuffle that leaves each lane in its place.
    #[op]
    pub(crate) fn blend<const OP: u8, const K: usize>(
        self, // Take m.select(a, b).
        other: Self,
    ) -> Self {
        self.shuffle::<OP, K>(other)
    }
    /// On AVX-512, LLVM knows nothing about the result. It would merge shuffles into `vpermt2`, for example.
    #[op]
    pub(crate) fn unseen(self) -> Self {
        return_if!(crate::X86 && S::REGISTER == 64 && W::BYTES >= 16 && W::BYTES <= 64, |this: Self = self| this.with_bytes(this.s.hidden::<W>(this.bytes())));
        self
    }
    /// A constant for `bit_select`. In its sight, LLVM makes three instructions of `bsl`.
    #[op]
    pub(crate) fn selects(self) -> Self {
        choose! { S::A64 && crate::OPTIMIZED => self.black_box(), _ => self }
    }
    /// The same, also for several registers.
    #[op]
    fn all_unseen(self) -> Self {
        halves_if!(crate::X86 && S::REGISTER == 64 && W::BYTES > 64, |this: Self = self| this.tag().combine(this.upper_half().all_unseen(), this.lower_half().all_unseen()));
        self.unseen()
    }
    /// To the range of the narrower integer `U`, if both are integers.
    #[op]
    pub(crate) fn clamp_to<U: Lane>(self) -> Self {
        assert!(size_of::<U>() < size_of::<T>());
        let d = self.tag();
        let max = d.set(T::from_u64((1 << (U::BITS - (U::KIND == Kind::Signed) as u32)) - 1));
        choose! {
            Self::CHAINS && !U::IS_FLOAT => self.with(self.raw.min(max.raw).max(if T::IS_SIGNED && U::IS_SIGNED { !max } else { d.zero() }.raw)),
            matches!((T::KIND, U::KIND), (Kind::Float, _) | (_, Kind::Float)) => self,
            matches!(T::KIND, Kind::Unsigned) => self.simd_min_relaxed(max),
            matches!(U::KIND, Kind::Unsigned) => self.simd_max_relaxed(d.zero()).simd_min_relaxed(max),
            _ => self.simd_max_relaxed(!max).simd_min_relaxed(max),
        }
    }

    /// `DFromV`.
    #[doc(alias("d_from_v"))]
    #[inline(always)]
    pub(crate) fn tag(self) -> Tag<S, T, W> {
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        Tag::new(self.s)
    }
    /// The same bits, as lanes of `U`. The lower part of a lane comes first on all CPUs, which takes a shuffle on big-endian
    /// ones if the sizes differ. It doesn't build if such a lane is wider than the vector.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u32x1::splat(0x0403_0201).bitcast::<u8>(), [1, 2, 3, 4]);
    /// # } example()
    /// ```
    #[doc(alias("bit_cast", "reinterpret", "transmute"))]
    #[op]
    #[track_caller]
    pub fn bitcast<U: Lane>(self) -> Simd<U, W, S> {
        require!("a lane is wider than the vector", W::BYTES >= size_of::<U>());
        Simd::new(self.s, bitcast::<T, U, W>(self.raw))
    }
    /// The same bits, as unsigned integers of the same size.
    #[doc(alias("to_unsigned", "to_bits"))]
    #[inline(always)]
    pub fn cast_unsigned(self) -> Simd<T::Unsigned, W, S> {
        self.bitcast()
    }
    /// The same bits, as signed integers of the same size.
    #[doc(alias("to_signed"))]
    #[inline(always)]
    pub fn cast_signed(self) -> Simd<T::Signed, W, S> {
        self.bitcast()
    }
    /// `[T; LANES]`. Where the width is generic, it can still be indexed and iterated, and `as_ref()` makes a slice of it.
    #[doc(alias("as_array"))]
    #[op]
    pub fn to_array(self) -> Array<T, W> {
        #[cfg(all(target_arch = "powerpc64", not(miri)))]
        return_if!(T::BITS == 8, self.array());
        self.raw.to_array()
    }

    /// As many lanes as `to` has room for. `StoreN`.
    #[inline(always)]
    pub(crate) fn store_n(self, to: &mut [T]) {
        apart_unoptimized!(self.s, |to: &mut [T]| {
            let near =
                const { Tag::<S, T, W>::CELLS_BY_BITS } && crate::tag::near_absent_page_by_bits::<_, W>(self.s, to);
            if_here!(
                S::AVX2 && crate::OPTIMIZED && W::BYTES >= 16 && W::BYTES <= S::REGISTER,
                if crate::tag::in_two_parts::<T, W>(to.len()) {
                    return live!(
                        S::AVX2 && W::BYTES >= 16 && W::BYTES <= S::REGISTER,
                        on_x86!(self, in_parts()).raw.store_in_parts(to)
                    );
                }
            );
            if_here!(
                S::SVE2 && crate::OPTIMIZED && W::BYTES <= 64,
                if Tag::<S, T, W>::blocks_and_part(to.len()) {
                    return live!(S::SVE2 && W::BYTES <= 64, self.raw.store_in_parts(to));
                }
            );
            return_if!(Tag::<S, T, W>::CELLS_BY_BITS, self.store_at_page(near, to));
            return_if!(S::AVX2 && !S::HAS_MASKED_MEMORY && W::BYTES >= 16 && W::BYTES <= S::REGISTER, |this: Self = self, to: &mut [T] = to| {
                let whole = to.len() >= Self::LANES;
                if const { size_of::<T>() >= 4 } && !crate::arithmetic::known(whole) && crate::tuning::fast_masked_store() {
                    if !crate::tag::words_near_absent_page::<_, W>(to) { return live!(size_of::<T>() >= 4, this.store_up_to(to)); }
                    core::hint::cold_path();
                }
                if whole { this.store(to) } else { this.store_fewer(to) }
            });
            #[cfg(target_arch = "aarch64")]
            if const { Tag::<S, T, W>::BY_LAST_BLOCK } && !is_known!(to.len()) {
                return live!(Tag::<S, T, W>::BY_LAST_BLOCK, self.store_by_last_block(to));
            }
            // One branch for each half, and not for each bit of the length.
            if const { S::AVX2 && !S::HAS_MASKED_MEMORY && W::BYTES > S::REGISTER } && !is_known!(to.len()) {
                return live!(
                    S::AVX2 && !S::HAS_MASKED_MEMORY && W::BYTES > S::REGISTER,
                    apart!(self.s, |to: &mut [T]| {
                        let both = to.len() >= Self::LANES / 2;
                        if both {
                            self.lower_half().store(to);
                        }
                        let (done, last) =
                            if both { (Self::LANES / 2, self.upper_half()) } else { (0, self.lower_half()) };
                        last.store_n(&mut to[done..])
                    })
                );
            }
            return_if!(Tag::<S, T, B16>::BY_LOOKUP && W::BYTES >= 16 && W::BYTES <= 64, |this: Self = self, to: &mut [T] = to| {
                if size_of::<T>() > 1 && is_known!(to.len()) { this.raw.store_in_parts(to) } else { crate::memory::write_in_parts(&mut { to }, 0, this) }
            });
            choose! {
                !S::HAS_MASKED_MEMORY && W::BYTES <= 64 => self.raw.store_in_parts(to),
                Tag::<S, T, W>::TO_UNINIT => self.store_first(to),
                _ => apart!(self.s, |to: &mut [T]| {
                    let (lower, upper) = to.split_at_mut(to.len().min(Self::LANES / 2));
                    self.lower_half().store_n(lower);
                    self.upper_half().store_n(upper);
                }),
            }
        })
    }
    /// For less than a vector, by stores that overlap. That takes fewer branches than one for each bit of the length, and they are hard to predict.
    #[on(X86)]
    #[inline(always)]
    fn store_fewer(self, to: &mut [T]) {
        apart_unoptimized!(self.s, |to: &mut [T]| {
            const SLIDE: &[u8; 48] = &crate::Aligned({
                let (mut all, mut i) = ([0x80; 48], 0);
                while i < 16 {
                    (all[16 + i], i) = (i as u8, i + 1);
                }
                all
            })
            .0;
            let n = to.len();
            if const { Self::LANES <= 4 } {
                if n > 0 {
                    let lanes = self.to_array();
                    when!(Self::LANES == 4, {
                        to[n - 1] = lanes[2];
                        to[n / 2] = lanes[1];
                    });
                    to[0] = lanes[0];
                }
                return;
            }
            return_if!(Self::LANES > 4, |this: Self = self, to: &mut [T] = to| {
                let Some(more) = to.len().checked_sub(Self::LANES / 2) else { return this.lower_half().store_fewer(to) };
                let (block, by) = (this.s.fixed::<u8, B16>(), more % (Self::LANES / 2) * size_of::<T>());
                let last = choose! {
                    W::BYTES == 32 && size_of::<T>() == 4 => block.resize_bitcast(this.lanes_from(more)),
                    // What is missing is in the lower half, which is stored last.
                    W::BYTES == 32 => block.resize_bitcast(this.upper_half()).table_lookup_bytes(block.load(&SLIDE[by..])),
                    _ => block.resize_any(this).table_lookup_bytes(block.load(&SLIDE[16 + by..])),
                };
                this.tag().half().resize_bitcast(last).store(&mut to[more..]);
                this.lower_half().store(to)
            });
        })
    }
    /// The same on AVX-512 and SVE.
    #[inline(always)]
    pub(crate) fn store_first(self, to: &mut [impl crate::Writable<T>]) {
        apart_unoptimized!(self.s, |to: &mut [_]| {
            return_if!(W::BYTES < 16, {
                let n = to.len().min(Self::LANES);
                self.s.fixed::<T, B16>().resize_any(self).store_first(&mut to[..n])
            });
            if const { Tag::<S, T, W>::ONE_TEST } && !is_known!(to.len()) {
                return live!(
                    crate::X86 && Tag::<S, T, W>::ONE_TEST,
                    if crate::tag::reaches_absent_page::<_, W>(to) {
                        self.store_before_page(to)
                    } else {
                        self.store_by_masks(to)
                    }
                );
            }
            return_if!(W::BYTES > S::REGISTER, {
                // What isn't stored isn't computed.
                return_if!(W::BYTES > 2 * S::REGISTER, {
                    let (lower, upper) = to.split_at_mut(to.len().min(Self::LANES / 2));
                    if upper.is_empty() {
                        return self.lower_half().store_first(lower);
                    }
                    self.lower_half().store(lower);
                    self.upper_half().store_first(upper)
                });
                // One test and one mask for both.
                if const { Tag::<S, T, W>::BY_BITS && Self::LANES <= 64 } && !crate::tag::near_absent_page::<_, W>(to) {
                    return live!(Tag::<S, T, W>::BY_BITS && Self::LANES <= 64, self.store_by_bits(to, 0));
                }
                let (lower, upper) = to.split_at_mut(to.len().min(Self::LANES / 2));
                self.lower_half().store_first(lower);
                self.upper_half().store_first(upper)
            });
            return_if!(S::SVE2, self.s.store_first(crate::Writable::plain(to), W::to16(self.raw.to_native())));
            live!(
                W::BYTES >= 16 && W::BYTES <= S::REGISTER && !S::SVE2,
                self.store_at_page(crate::tag::near_absent_page_by_bits::<_, W>(self.s, to), to)
            )
        })
    }
    /// Whole registers, and one that ends where the slice does.
    #[on(X86)]
    #[op]
    fn store_before_page(self, to: &mut [impl crate::Writable<T>]) {
        return_if!(W::BYTES <= 64, self.store_ending(to));
        when!(W::BYTES > 64, {
            let both = to.len() >= Self::LANES / 2;
            if both {
                self.lower_half().store(to);
            }
            let (done, last) = if both { (Self::LANES / 2, self.upper_half()) } else { (0, self.lower_half()) };
            last.store_before_page(&mut to[done..])
        })
    }
    #[on(X86)]
    #[op]
    fn store_by_masks(self, to: &mut [impl crate::Writable<T>]) {
        return_if!(Self::LANES <= 64, self.store_by_bits(to, 0));
        let (lower, upper) = to.split_at_mut(to.len().min(Self::LANES / 2));
        when!(Self::LANES > 64, {
            self.lower_half().store_by_masks(lower);
            self.upper_half().store_by_masks(upper)
        })
    }
    #[op]
    fn store_at_page(self, near: bool, to: &mut [impl crate::Writable<T>]) {
        if !near {
            return self.store_by_bits(to, 0);
        }
        core::hint::cold_path();
        self.store_ending(to)
    }
    /// By a vector that ends where the slice does.
    #[op]
    fn store_ending(self, to: &mut [impl crate::Writable<T>]) {
        if !to.is_empty() {
            let skip = crate::tag::missing::<T, W>(to.len());
            self.up_by(skip).store_by_bits(to, skip)
        }
    }
    /// By `vpmaskmov`. An empty slice can be where nothing is mapped, and AMD doesn't promise that an empty mask can't fault.
    #[on(X86)]
    #[op]
    fn store_up_to(self, to: &mut [T]) {
        let mut idle = self.tag().zero().to_array();
        let to = core::hint::select_unpredictable(to.is_empty(), &mut idle.as_mut()[..0], to);
        let (to, v) = (crate::plain::write_as::<u8>(T::unsigned_mut(to)), self.raw.to_native());
        if const { W::BYTES == 32 } {
            self.s.store_words_32(W::to32(v), to)
        } else {
            self.s.store_words_16(W::to16(v), to)
        }
    }
    #[op]
    pub(crate) fn store_by_bits<E: crate::Writable<T>>(self, to: &mut [E], skip: usize) {
        self.raw.store_by_bits(self.s, E::plain(to), skip)
    }
    /// `store_first` for up to a register, to `at..end` of an output.
    #[op]
    #[track_caller]
    pub(crate) fn put_first(self, at: usize, end: usize, keep: usize, to: &mut crate::Output<'_, T>) {
        assert!(at <= to.len() && at <= end && end <= to.capacity());
        let n = (end - at).min(Self::LANES);
        return_if!(W::BYTES < 16, self.s.fixed::<T, B16>().resize_any(self).put_first(at, at + n, keep, to));
        if !crate::tag::near_absent_page_at::<T, W>(
            to.filled().as_ptr().addr().wrapping_add(at * size_of::<T>()),
            n == 0,
        ) {
            to.put_masked(at, end, self.raw, 0, keep)
        } else if n != 0 {
            to.put_masked(at, end, self.up_by(Self::LANES - n).raw, Self::LANES - n, keep)
        } else {
            to.truncate(at)
        }
    }
    /// [`store`](Self::store) to memory that is not a plain slice.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn write(self, to: &mut impl Place<T>, at: usize) {
        to.write_vector(at, self)
    }
    /// [`store_partial`](Self::store_partial) to memory that is not a plain slice.
    #[op]
    pub(crate) fn write_n(self, to: &mut impl Place<T>, at: usize) {
        to.write_vector_n(at, self)
    }
    /// Writes `a0 b0 a1 b1 ..`, where `a` is `self`. Panics if `to` is shorter than two vectors.
    #[op]
    #[track_caller]
    pub(crate) fn store_interleaved2(self, b: Self, to: &mut [T]) {
        let to = &mut to[..2 * Self::LANES];
        apart_unoptimized!(self.s, |to: &mut [T]| {
            if_here!(
                S::A64
                    && cfg!(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))
                    && (W::BYTES == 8 || W::BYTES == 16)
                    && Self::LANES > 1,
                {
                    return Raw::store2([self.raw, b.raw], to);
                }
            );
            if_here!((S::ARM || S::WASM) && W::BYTES <= 16, {
                // On Arm, one wide store becomes `st2`.
                return self.raw.shuffle::<RawOf<T, W::Twice>, { p::INTERLEAVE_WHOLE_LOWER }, 0>(b.raw).store(to);
            });
            let to = &mut to[..2 * Self::LANES];
            return_if!(S::AVX2 && !S::AVX512VL && T::BITS == 64, {
                let [lower, upper] = self.interleave(b);
                lower.store(to);
                upper.store_last(to)
            });
            return_if!(S::AVX512VL && T::BITS <= 16 && W::BYTES == 32, {
                // A permutation of two tables takes three steps on Intel.
                let (lower, upper) =
                    (self.interleave_lower(b).hidden_unless_known(), self.interleave_upper(b).hidden_unless_known());
                lower.interleave_lower_blocks(upper).store(to);
                lower.interleave_upper_blocks(upper).store_last(to)
            });
            self.interleave_whole_lower(b).store(to);
            self.interleave_whole_upper(b).store_last(to);
        })
    }
    /// Writes `a0 b0 c0 a1 ..`, where `a` is `self`. Panics if `to` is shorter than three vectors.
    #[op]
    #[track_caller]
    pub(crate) fn store_interleaved3(self, b: Self, c: Self, to: &mut [T]) {
        let to = &mut to[..3 * Self::LANES];
        apart!(self.s, |to: &mut [T]| {
            let to = &mut to[..3 * Self::LANES];
            return_if!(crate::X86 && size_of::<T>() == 1 && W::BYTES == 64 && S::COMPRESS[0] == 64, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                let (to, [a, b, c]) = (&mut to[..192], crate::interleave3::merge([this.bitcast(), b.bitcast(), c.bitcast()]));
                a.bitcast().store(to);
                b.bitcast().store(&mut to[64..]);
                c.bitcast().store_last(to)
            });
            return_if!(crate::X86 && size_of::<T>() == 1 && W::BYTES >= 16 && W::BYTES <= S::REGISTER && S::SSE41 && (W::BYTES < 64 || S::COMPRESS[0] < 64), |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                let (to, all) = (&mut to[..3 * Self::LANES], [this.bitcast(), b.bitcast(), c.bitcast()]);
                crate::interleave3::store(all, #[inline(always)] |i, block| block.bitcast().store(&mut to[16 * i..]))
            });
            return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() == 1, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                // Each round puts the even values before the odd ones.
                let round = always!(|[a, b, c]: [Simd<u8, W, S>; 3]| {
                    let (a, b, c) = (a.bitcast::<i16>(), b.bitcast::<i16>(), c.bitcast::<i16>());
                    let odd = always!(|v: Simd<i16, W, S>| (v.cast_unsigned() >> 8).cast_signed());
                    let pack = always!(|x: Simd<i16, W, S>, y: Simd<i16, W, S>| x.with_bytes::<u8>(x.s.pack_i16_u8::<W>(x.bytes(), y.bytes())));
                    [pack(a & 255, b & 255), pack(c & 255, odd(a)), pack(odd(b), odd(c))]
                });
                let (to, [x, y, z]) = (&mut to[..48], round(round(round(round([this.bitcast(), b.bitcast(), c.bitcast()])))));
                x.bitcast().store(to);
                y.bitcast().store(&mut to[16..]);
                z.bitcast().store_last(to)
            });
            return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() == 2, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                // Three values in four, and two of those in a row.
                let ([ab0, ab1], [c0, c1]) = (this.interleave(b), c.interleave(c.tag().zero()));
                let ([q0, q1], [q2, q3]) = (ab0.bitcast::<u32>().interleave(c0.bitcast()), ab1.bitcast::<u32>().interleave(c1.bitcast()));
                let put = always!(|to: &mut [T], v: Simd<u32, W, S>| {
                    v.bitcast::<T>().lower_half().store(to);
                    v.bitcast::<T>().upper_half().store(&mut to[3..])
                });
                let to = &mut to[..24];
                put(to, q0);
                put(&mut to[6..], q1);
                put(&mut to[12..], q2);
                (q3.bitcast::<u64>() << 16).bitcast::<T>().upper_half().store(&mut to[20..]);
                q3.bitcast::<T>().lower_half().lower_half().store(&mut to[18..]);
                to[20] = c.to_array().as_ref()[6];
            });
            return_if!((blends3::<S, T, W>() || S::WASM && W::BYTES == 16) && size_of::<T>() == 4 && S::REGISTER < 64, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| crate::interleave3::store_words([this, b, c], to));
            return_if!(blends3::<S, T, W>() && size_of::<T>() > 1 && !(size_of::<T>() == 4 && S::REGISTER < 64), |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                let (d, to) = (this.tag(), &mut to[..3 * Self::LANES]);
                let a = this.shuffle::<{ p::UNSORT3 }, 0>(this).unseen();

                let (b, c) = (b.shuffle::<{ p::UNSORT3 }, 1>(b).unseen(), c.shuffle::<{ p::UNSORT3 }, 2>(c).unseen());
                macro_rules! part { ($k:literal) => {
                    a.blend::<{ p::PICK3 }, { 3 * $k + 1 }>(b).blend::<{ p::PICK3 }, { 3 * $k + 2 }>(c)
                }; }
                let (mut x, mut y, mut z) = (part!(0), part!(1), part!(2));
                if const { W::BYTES == 32 } {
                    (x, y, z) = (d.concat_lower_lower(y, x), d.concat_upper_lower(x, z), d.concat_upper_upper(z, y));
                }
                x.store(to);
                y.store(&mut to[Self::LANES..]);
                z.store_last(to)
            });
            if const { W::BYTES <= 16 } {
                return Raw::store3([self.raw, b.raw, c.raw], to);
            }
            return_if!(S::AVX512BW && size_of::<T>() >= 4 && W::BYTES <= S::REGISTER, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                let (to, [x, y, z]) = (&mut to[..3 * Self::LANES], crate::interleave3::merge_words([this, b, c]));
                x.store(to);
                y.store(&mut to[Self::LANES..]);
                z.store_last(to)
            });
            return_if!(two_tables::<S, T>() && size_of::<T>() < 4 && W::BYTES <= S::REGISTER, |this: Self = self, b: Self = b, c: Self = c, to: &mut [T] = to| {
                let to = &mut to[..3 * Self::LANES];
                let a = this.shuffle::<{ p::UNSORT3_WHOLE }, 0>(this).unseen();
                let (b, c) = (b.shuffle::<{ p::UNSORT3_WHOLE }, 1>(b).unseen(), c.shuffle::<{ p::UNSORT3_WHOLE }, 2>(c).unseen());
                macro_rules! part { ($k:literal) => {
                    a.blend::<{ p::PICK3_WHOLE }, { 3 * $k + 1 }>(b).unseen().blend::<{ p::PICK3_WHOLE }, { 3 * $k + 2 }>(c).store(&mut to[$k * Self::LANES..])
                }; }
                part!(0);
                part!(1);
                part!(2)
            });
            live!(W::BYTES > 16 && !blends3::<S, T, W>() && !(two_tables::<S, T>() && W::BYTES <= S::REGISTER), {
                let (lower, upper) = to[..3 * Self::LANES].split_at_mut(3 * Self::LANES / 2);
                self.lower_half().store_interleaved3(b.lower_half(), c.lower_half(), lower);
                self.upper_half().store_interleaved3(b.upper_half(), c.upper_half(), upper);
            })
        })
    }
    /// Writes `a0 b0 c0 d0 a1 ..`, where `a` is `self`. Panics if `to` is shorter than four vectors.
    #[op]
    #[track_caller]
    pub(crate) fn store_interleaved4(self, b: Self, c: Self, d: Self, to: &mut [T]) {
        let to = &mut to[..4 * Self::LANES];
        apart!(self.s, |to: &mut [T]| {
            return_if!(
                S::AVX2 && size_of::<T>() == 4 && (W::BYTES == 16 || W::BYTES == 32 && !two_tables::<S, T>()),
                crate::interleave3::store4(
                    [self.bitcast(), b.bitcast(), c.bitcast(), d.bitcast()],
                    &mut to[..4 * Self::LANES]
                )
            );
            if_here!(
                (S::SSE41 || S::WASM) && (W::BYTES == 16 || W::BYTES == 32 && S::REGISTER >= 32 && size_of::<T>() == 8),
                {
                    let (t, to) = (self.tag(), &mut to[..4 * Self::LANES]);
                    let all = if const { size_of::<T>() == 8 } {
                        let (w, x, y, z) = (
                            self.interleave_lower(b),
                            c.interleave_lower(d),
                            self.interleave_upper(b),
                            c.interleave_upper(d),
                        );
                        if const { W::BYTES == 16 } {
                            [w, x, y, z]
                        } else {
                            [
                                t.concat_lower_lower(x, w),
                                t.concat_lower_lower(z, y),
                                t.concat_upper_upper(x, w),
                                t.concat_upper_upper(z, y),
                            ]
                        }
                    } else {
                        let (a, b, c, d) =
                            (self.cast_unsigned(), b.cast_unsigned(), c.cast_unsigned(), d.cast_unsigned());
                        let (ab0, ab1, cd0, cd1) = (a.zip_lower(b), a.zip_upper(b), c.zip_lower(d), c.zip_upper(d));
                        [
                            ab0.interleave_lower(cd0).bitcast(),
                            ab0.interleave_upper(cd0).bitcast(),
                            ab1.interleave_lower(cd1).bitcast(),
                            ab1.interleave_upper(cd1).bitcast(),
                        ]
                    };
                    all[0].store(to);
                    all[1].store(&mut to[Self::LANES..]);
                    all[2].store(&mut to[2 * Self::LANES..]);
                    return all[3].store_last(to);
                }
            );
            return_if!((crate::X86 || S::WASM) && size_of::<T>() <= 2 && matches!(W::BYTES, 4 | 8), |a: Self = self, b: Self = b, c: Self = c, d: Self = d, to: &mut [T] = to| {
                let (block, to) = (a.s.fixed::<T::Unsigned, B16>(), &mut to[..4 * Self::LANES]);
                let pairs = always!(|x: Self, y: Self| {
                    crate::interleave3::apart(block.resize_bitcast(x).interleave_lower(block.resize_bitcast(y)).bitcast()).bitcast::<<T::Unsigned as Int>::Wide>()
                });
                let (ab, cd) = (pairs(a, b), pairs(c, d));
                ab.interleave_lower(cd).bitcast().store(to);
                if const { W::BYTES == 8 } {
                    ab.interleave_upper(cd).bitcast().store_last(to);
                }
            });
            return_if!(S::A64 && W::BYTES == 16, |a: Self = self, b: Self = b, c: Self = c, d: Self = d, to: &mut [T] = to| {
                // `st4` takes twice as long on Neoverse V1 and V2, and the same on N1 and N3.
                let (lower, upper) = to[..4 * Self::LANES].split_at_mut(2 * Self::LANES);
                return_if!(size_of::<T>() == 8, {
                    a.interleave_lower(b).barrier().store(lower);
                    c.interleave_lower(d).barrier().store_last(lower);
                    a.interleave_upper(b).barrier().store(upper);
                    c.interleave_upper(d).barrier().store_last(upper)
                });
                a.interleave_lower(c).barrier().store_interleaved2(b.interleave_lower(d).barrier(), lower);
                a.interleave_upper(c).barrier().store_interleaved2(b.interleave_upper(d).barrier(), upper)
            });
            if const { W::BYTES < 16 || W::BYTES == 16 && (!crate::X86 || size_of::<T>() > 2) } {
                return Raw::store4([self.raw, b.raw, c.raw, d.raw], to);
            }
            let to = &mut to[..4 * Self::LANES];
            return_if!(S::AVX512BW && W::BYTES == 64 && size_of::<T>() == 4, {
                let all = crate::interleave3::merge4([self, b, c, d]);
                all[0].store(to);
                all[1].store(&mut to[Self::LANES..]);
                all[2].store(&mut to[2 * Self::LANES..]);
                all[3].store_last(to)
            });
            return_if!(two_tables::<S, T>() && size_of::<T>() == 8 && W::BYTES <= S::REGISTER, {
                let (lower, upper) = to.split_at_mut(2 * Self::LANES);
                self.interleave_whole_lower(c).store_interleaved2(b.interleave_whole_lower(d), lower);
                self.interleave_whole_upper(c).store_interleaved2(b.interleave_whole_upper(d), upper)
            });
            return_if!(
                W::BYTES > 16
                    && (S::ARM || S::WASM || size_of::<T>() == 8 || W::BYTES > 64 || S::AVX2 && W::BYTES > S::REGISTER),
                {
                    let (lower, upper) = to.split_at_mut(2 * Self::LANES);
                    self.lower_half().store_interleaved4(b.lower_half(), c.lower_half(), d.lower_half(), lower);
                    self.upper_half().store_interleaved4(b.upper_half(), c.upper_half(), d.upper_half(), upper)
                }
            );
            // Within the blocks, and then whole blocks.
            let whole = const { W::BYTES == 64 && S::REGISTER == 64 };
            let first = always!(|v: Self| {
                if whole {
                    // Or the other way round, which takes fewer steps.
                    let v = v.bitcast::<u32>();
                    crate::interleave3::apart(v.shuffle::<{ p::TRANSPOSE_BLOCKS }, 0>(v).bitcast())
                        .bitcast::<T::Unsigned>()
                } else {
                    v.cast_unsigned()
                }
            });
            let (a, b, c, d) = (first(self), first(b), first(c), first(d));
            let (ab0, ab1, cd0, cd1) = (a.zip_lower(b), a.zip_upper(b), c.zip_lower(d), c.zip_upper(d));
            let (v0, v1) = (ab0.interleave_lower(cd0), ab0.interleave_upper(cd0));
            let (v2, v3) = (ab1.interleave_lower(cd1), ab1.interleave_upper(cd1));
            let (v0, v1, v2, v3) = choose! {
                S::AVX512VBMI && size_of::<T>() == 1 && W::BYTES == 32 => (v0.hidden_unless_known(), v1.hidden_unless_known(), v2.hidden_unless_known(), v3.hidden_unless_known()),
                _ => (v0, v1, v2, v3),
            };
            let (even01, even23) = (v0.interleave_even_blocks(v1), v2.interleave_even_blocks(v3));
            let (odd01, odd23) = (v0.interleave_odd_blocks(v1), v2.interleave_odd_blocks(v3));
            let mut all = if W::BYTES == 16 || whole { [v0, v1, v2, v3] } else { [even01, even23, odd01, odd23] };
            if W::BYTES == 64 && !whole {
                let d = v0.tag();
                all = [
                    d.concat_lower_lower(even23, even01),
                    d.concat_lower_lower(odd23, odd01),
                    d.concat_upper_upper(even23, even01),
                    d.concat_upper_upper(odd23, odd01),
                ];
            }
            unrolled!(
                4,
                for i in 0..4 {
                    all[i].bitcast().store(&mut to[i * Self::LANES..]);
                }
            );
        })
    }

    /// The result is unspecified if one is NaN, and so is its sign if both are zero.
    #[doc(alias("Min"))]
    #[op]
    pub fn simd_min_relaxed(self, other: impl Operand<T, W, S>) -> Self {
        return_if!(Self::CHAINS, self.with(self.raw.min(self.like(other).raw)).chosen(other));
        let other = self.like(other);
        return_if!(Self::HALF, T::extreme::<false, false, S, W>(self, other));
        return_if!(
            S::RELAXED && T::IS_FLOAT,
            self.with_bytes(self.s.extreme_relaxed::<W>(self.bytes(), other.bytes(), (T::BITS, false)))
        );
        choose! {
            matches!(T::KIND, Kind::Float) && T::BITS == 32 && (S::ARM || W::BYTES >= 16) => self.with_bytes(self.s.min_f32::<W>(self.bytes(), other.bytes())),
            matches!(T::KIND, Kind::Float) && (S::ARM || W::BYTES >= 16) => self.with_bytes(self.s.min_f64::<W>(self.bytes(), other.bytes())),
            S::BY_HAND && W::BYTES == 16 && T::BITS == 64 => self.simd_lt(other).if_then_else(self, other),
            _ => self.with(self.raw.min(other.raw)),
        }
    }
    /// The result is unspecified if one is NaN, and so is its sign if both are zero.
    #[doc(alias("Max"))]
    #[op]
    pub fn simd_max_relaxed(self, other: impl Operand<T, W, S>) -> Self {
        return_if!(Self::CHAINS, self.with(self.raw.max(self.like(other).raw)).chosen(other));
        let other = self.like(other);
        return_if!(Self::HALF, T::extreme::<true, false, S, W>(self, other));
        return_if!(
            S::RELAXED && T::IS_FLOAT,
            self.with_bytes(self.s.extreme_relaxed::<W>(self.bytes(), other.bytes(), (T::BITS, true)))
        );
        choose! {
            matches!(T::KIND, Kind::Float) && T::BITS == 32 && (S::ARM || W::BYTES >= 16) => self.with_bytes(self.s.max_f32::<W>(self.bytes(), other.bytes())),
            matches!(T::KIND, Kind::Float) && (S::ARM || W::BYTES >= 16) => self.with_bytes(self.s.max_f64::<W>(self.bytes(), other.bytes())),
            S::BY_HAND && W::BYTES == 16 && T::BITS == 64 => other.simd_lt(self).if_then_else(self, other),
            _ => self.with(self.raw.max(other.raw)),
        }
    }
    /// For signed integers, the result has the bits of the unsigned difference.
    #[op]
    pub(crate) fn distance(self, other: impl Operand<T, W, S>) -> Self {
        return_if!(Self::HALF, self.with((self - other).raw.abs()));
        self.with(self.raw.abs_diff(self.like(other).raw))
    }
    /// `!self & other`.
    #[op]
    pub(crate) fn and_not(
        self, // Take !a & b.
        other: impl Operand<T, W, S>,
    ) -> Self {
        !self & other
    }
    /// Each bit is from `yes` where it is set in `self`, and from `no` elsewhere. Other functions of bits are written with the operators:
    /// `!a & b` is one instruction on x86 and Arm, and with AVX-512 the compiler joins two operators in one, unless the result of the first is used again.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x2::splat(0xf0).bit_select(u8x2::splat(0xab), u8x2::splat(0xcd)), [0xad; 2]);
    /// # } example()
    /// ```
    #[doc(alias(
        "bitwise_if_then_else", "BitwiseIfThenElse", "IfVecThenElse", "bitselect", "andnot", "AndNot", "ternary",
        "ternlog", "vpternlog"
    ))]
    #[op]
    pub fn bit_select(self, yes: impl crate::Operand<T, W, S>, no: impl crate::Operand<T, W, S>) -> Self {
        let yes = crate::Operand::vector(yes, crate::Tag::new(self.s));
        let no = crate::Operand::vector(no, crate::Tag::new(self.s));
        if const { S::SSE41 && S::REGISTER < 64 } && are_known!(self.raw) {
            self & yes | !self & no
        } else {
            no.xor(self & yes.xor(no))
        }
    }
    /// `^`, where LLVM has to see an operand twice.
    #[op]
    pub(crate) fn xor(
        self, // Take ^.
        other: Self,
    ) -> Self {
        self.with(self.raw.xor(other.raw))
    }
    /// `self == other` in each lane.
    #[doc(alias("cmp_eq", "Eq"))]
    #[op]
    pub fn simd_eq(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_eq, other);
        return_if!(Self::SOFT, T::compare::<{ crate::half::EQ }, S, W>(self, self.like(other)));
        crate::half::native!(mask Eq, self, self.like(other));
        compare!(self, eq, simd_eq, false, choose! { S::WASM => self.beside(other), _ => self.like(other) })
    }
    /// `self != other` in each lane.
    #[doc(alias("Ne"))]
    #[op]
    pub fn simd_ne(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_ne, other);
        return_if!(Self::SOFT, !self.simd_eq(other));
        crate::half::native!(mask Ne, self, self.like(other));
        if const { crate::X86 && MaskOf::<T, W, S>::BOTH && !T::IS_FLOAT && T::BITS <= 16 }
            && let Some(number) = Operand::number(other)
        {
            return live!(crate::X86 && MaskOf::<T, W, S>::BOTH && !T::IS_FLOAT && T::BITS <= 16, {
                let (some, same) =
                    (self.cast_unsigned().saturating_add(T::Unsigned::MAX >> 1), self.equal_lanes(self.like(number)));
                let v = core::hint::select_unpredictable(crate::hints::zero(Some(number)), some, !same.cast_unsigned());
                self.simd_ne(self.like(number)).also(v, false, false)
            });
        }
        compare!(self, ne, simd_ne, false, choose! { S::WASM => self.beside(other), _ => self.like(other) })
    }
    /// `self < other` in each lane.
    #[doc(alias("cmp_lt", "Lt"))]
    #[op]
    pub fn simd_lt(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_lt, other, true false);
        let other = self.like(other);
        return_if!(Self::SOFT, T::compare::<{ crate::half::LT }, S, W>(self, other));
        return_if!(S::BY_HAND && !T::IS_FLOAT && T::BITS == 64 && W::BYTES == 16, |a: Self = self, b: Self = other| {
            let top = crate::OPTIMIZED && crate::arithmetic::known(!T::IS_SIGNED && a.bitcast::<i64>() == i64::MAX);
            // The sign of the difference, if it had one bit more.
            let less = choose! { T::IS_SIGNED => (a - b) ^ (a ^ b) & ((a - b) ^ a), _ => a.and_not(b) | (a ^ b).and_not(a - b) };
            core::hint::select_unpredictable(top, b.to_mask(), crate::mask::Mask::from_full((less.bitcast::<i32>() >> 31).dup_odd().bitcast::<T>()))
        });
        crate::half::native!(mask Lt, self, other);
        compare!(self, lt, simd_lt, true, other)
    }
    /// `self <= other` in each lane.
    #[doc(alias("cmp_le", "Le"))]
    #[op]
    pub fn simd_le(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_le, other, true true);
        let other = self.like(other);
        return_if!(Self::SOFT, T::compare::<{ crate::half::LE }, S, W>(self, other));
        return_if!(S::BY_HAND && !T::IS_FLOAT && T::BITS == 64 && W::BYTES == 16, |a: Self = self, b: Self = other| {
            core::hint::select_unpredictable(crate::OPTIMIZED && crate::arithmetic::known(!T::IS_SIGNED && a.bitcast::<i64>() == i64::MIN), b.to_mask(), !b.simd_lt(a))
        });
        crate::half::native!(mask Le, self, other);
        compare!(self, le, simd_le, true, other)
    }
    /// `self > other` in each lane. For unsigned lanes on x86 without AVX-512, `simd_ge` and `simd_le` take two instructions (four for `u64`), and these three. Signed ones take one here.
    #[doc(alias("cmp_gt", "Gt"))]
    #[op]
    pub fn simd_gt(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_gt, other, false false);
        self.like(other).simd_lt(self)
    }
    /// `self >= other` in each lane.
    #[doc(alias("cmp_ge", "Ge"))]
    #[op]
    pub fn simd_ge(self, other: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        by_number!(self, simd_ge, other, false true);
        self.like(other).simd_le(self)
    }
    /// True where the highest bit is set, for lanes of any type. It is the reverse of [`to_simd`](crate::Mask::to_simd).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from([0, 127, 128, 255]).to_mask().to_bitmask(), 0b1100);
    /// # } example()
    /// ```
    #[doc(alias("from_simd", "from_int", "MaskFromVec", "top_bits", "msb", "movemask"))]
    #[op]
    pub fn to_mask(self) -> MaskOf<T, W, S> {
        halves_if!(W::BYTES > S::REGISTER, |v: Self = self| {
            let (lower, upper) = v.registers();
            v.tag().combine_masks(upper.to_mask(), lower.to_mask())
        });
        let mask: MaskOf<T, W, S> = crate::mask::Mask::compared(self.s, self.raw.top_bits());
        choose! { crate::X86 && MaskOf::<T, W, S>::BOTH => mask.also(self, false, false), _ => mask }
    }
    #[on(X86)]
    #[op]
    pub(crate) fn equal_lanes(self, other: Self) -> Self {
        self.with(Raw::from_mask(self.raw.eq(other.raw))).black_box()
    }
    #[on(X86)]
    #[op]
    fn less_lanes(self, other: Self) -> Self {
        self.with(Raw::from_mask(self.raw.lt(other.raw))).black_box()
    }
    /// `self < other` or `self <= other` without a sign, in the highest bits. With a constant, one step is left as a rule.
    #[on(X86)]
    #[op]
    fn below_lanes(self, other: Self, or_equal: bool, any: Self) -> Self {
        let (a, b) = (self.cast_unsigned(), other.cast_unsigned());
        let half = always!(|less: bool| a.like(T::Unsigned::from_u64((1 << (T::BITS - 1)) - less as u64)));
        let from_a =
            b.saturating_add(half(!or_equal).saturating_sub(a)).saturating_sub(a.saturating_sub(half(!or_equal)));
        let up_to_b =
            b.saturating_add(half(!or_equal)).saturating_sub(a.saturating_sub(b.saturating_sub(half(or_equal))));
        let known = always!(|v: Self, yes, no| core::hint::select_unpredictable(are_known!(v.raw), yes, no));
        known(self, from_a.bitcast(), known(other, up_to_b.bitcast(), any))
    }
    #[on(X86)]
    #[op]
    fn eq_in_lanes(self, other: Self, mask: MaskOf<T, W, S>) -> MaskOf<T, W, S> {
        mask.also(self.equal_lanes(other), false, true)
    }
    #[on(X86)]
    #[op]
    fn ne_in_lanes(self, other: Self, mask: MaskOf<T, W, S>) -> MaskOf<T, W, S> {
        mask.also(self.equal_lanes(other), true, true)
    }
    #[on(X86)]
    #[op]
    fn lt_in_lanes(self, other: Self, mask: MaskOf<T, W, S>) -> MaskOf<T, W, S> {
        return_if!(T::IS_SIGNED, mask.also(self.less_lanes(other), false, true));
        let not = self.simd_min(other).black_box().equal_lanes(other);
        choose! { T::BITS > 16 => mask.also(not, true, true), _ => mask.also(self.below_lanes(other, false, not.with(not.raw.not())), false, false) }
    }
    #[on(X86)]
    #[op]
    fn le_in_lanes(self, other: Self, mask: MaskOf<T, W, S>) -> MaskOf<T, W, S> {
        return_if!(T::IS_SIGNED, mask.also(other.less_lanes(self), true, true));
        let any = self.simd_min(other).black_box().equal_lanes(self);
        choose! { T::BITS > 16 => mask.also(any, false, true), _ => mask.also(self.below_lanes(other, true, any), false, false) }
    }
    /// The same, for lanes that are 0 or -1.
    #[op]
    pub(crate) fn full_mask(self) -> MaskOf<T, W, S> {
        crate::mask::Mask::from_full(self)
    }
    /// The same, where LLVM doesn't see that of lanes that have moved.
    #[op]
    pub(crate) fn moved_mask(self) -> MaskOf<T, W, S> {
        choose! { S::A64 || S::WASM => self.full_mask(), _ => self.to_mask() }
    }
    /// Whether no bit of the vector is set.
    #[op]
    #[doc(alias("AllBits0"))]
    pub(crate) fn is_zero(/* Take v == 0. */ self) -> bool {
        halves_if!(W::BYTES > S::REGISTER, |this: Self = self| (this.lower_half() | this.upper_half()).is_zero());
        return_if!(S::ARM && W::BYTES == 16, |this: Self = self| Tag::<S, u32, crate::B8>::new(this.s).demote_to(this.bitcast::<u64>()).bitcast::<u64>().get_lane() == 0);
        return_if!(S::WASM && W::BYTES == 16, |this: Self = self| this.s.mask_none_16(W::to16(this.raw.to_native())));
        return_if!(S::ARM, self.cast_unsigned().simd_ne(T::Unsigned::default()).none());
        return_if!(
            Tag::<S, T::Unsigned, W>::PACKED && W::BYTES >= 8,
            self.reinterpret::<crate::simd::Word>().is_zero()
        );
        return_if!(S::SCALAR, !self.cast_unsigned().raw.ne(Raw::zero()).any());
        !self.raw.to_native().ne(Raw::splat(0)).any()
    }
    /// Floating-point numbers are added as a tree: the upper half to the lower half, and so on.
    #[doc(alias("sum", "horizontal_add", "reduce_add"))]
    #[op]
    pub fn reduce_sum(/* Integers wrap. Wider: sum_groups first */ self) -> T {
        return_if!(Self::HALF, |v: Self = self| crate::arithmetic::tree!(v, reduce_sum, |a, b| a + b));
        halves_if!(S::AVX2 && T::IS_FLOAT && W::BYTES > 4 * size_of::<T>(), |v: Self = self| (v.lower_half() + v.upper_half()).reduce_sum());
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        self.raw.reduce_sum()
    }
    /// The smallest lane. See [`simd_min_relaxed`](Self::simd_min_relaxed) for NaN.
    #[doc(alias("ReduceMin", "horizontal_min"))]
    #[op]
    pub fn reduce_min_relaxed(self) -> T {
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        reduce!(self, simd_min_relaxed, reduce_min, reduce_min_relaxed, min_across_f32, false)
    }
    /// The largest lane. See [`simd_max_relaxed`](Self::simd_max_relaxed) for NaN.
    #[doc(alias("ReduceMax", "horizontal_max"))]
    #[op]
    pub fn reduce_max_relaxed(self) -> T {
        #[cfg(bun_simd_check)]
        crate::lost::check::<S>();
        reduce!(self, simd_max_relaxed, reduce_max, reduce_max_relaxed, max_across_f32, true)
    }

    /// Lane 0.
    #[op]
    pub(crate) fn get_lane(self, // Take v[i].
    ) -> T {
        on_arch!(Self::handed, self.raw.to_array().as_ref()[0])
    }
    /// Lane `K`. It doesn't build if there is none.
    #[doc(alias("GetLane", "extract"))]
    #[op]
    #[track_caller]
    pub fn lane</* else lane_dyn */ const K: usize>(self) -> T {
        require!("the vector has no lane `K`", K < Self::LANES);
        self.lane_dyn(K)
    }
    /// `self[i]`, with shorter code where `i` is not a constant. Panics if there is no such lane.
    #[doc(alias("ExtractLane"))]
    #[op]
    #[track_caller]
    pub fn lane_dyn(self, i: usize) -> T {
        if_here!(
            S::NEON && Self::LANES > 1 && W::BYTES <= 64,
            if !is_known!(i) {
                // Not through memory, where the load would wait for the store.
                assert!(i < Self::LANES);
                let (size, d) = (size_of::<T>() as u64, self.tag().to_unsigned());
                let bytes = d.set(Lane::from_u64(i as u64 * (0x0101_0101_0101_0101 * size) + 0x0706_0504_0302_0100));
                return self.with_bytes::<T>(self.s.lookup8::<W>(self.bytes(), bytes.bytes())).to_array().as_ref()[0];
            }
        );
        if const { S::REGISTER == 64 && W::BYTES == 64 } && !is_known!(i) {
            assert!(i < Self::LANES);
            return choose! {
                S::REGISTER == 64 && W::BYTES == 64 && size_of::<T>() == 1 && S::COMPRESS[0] < 64 => T::from_u64((self.bitcast::<u32>().lane_dyn(i / 4) >> (i % 4 * 8)) as u64),
                S::REGISTER == 64 && W::BYTES == 64 => self.swizzle_dyn_relaxed(self.tag().to_unsigned().set(Lane::from_usize(i))).to_array().as_ref()[0],
                _ => crate::ops::never(()),
            };
        }
        on_arch!(Self::handed, self.raw.to_array().as_ref()[i])
    }
    /// With `value` in lane `K`. It doesn't build if there is none.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::zero().with_lane::<2>(7), [0, 0, 7, 0]);
    /// # } example()
    /// ```
    #[doc(alias("InsertLane", "insert", "replace"))]
    #[op]
    #[track_caller]
    pub fn with_lane<const K: usize>(self, value: T) -> Self {
        require!("the vector has no lane `K`", K < Self::LANES, at any width K < 512);
        if const { W::BYTES <= 16 && (S::SSE2 && (S::SSE41 || T::BITS == 16) || S::WASM) } {
            let mut v = self;
            v[K] = value;
            return v;
        }
        self.with_lane_dyn(K, value)
    }
    /// The same for a lane that is known only at run time.
    #[op]
    #[track_caller]
    pub fn with_lane_dyn(self, i: usize, value: T) -> Self {
        // Not through memory, where the load would wait for the two stores.
        assert!(i < Self::LANES);
        if const { Self::LANES > 64 } || const { S::A64 && W::BYTES <= 16 } && is_known!(i) {
            let mut v = self;
            v[i] = value;
            return v;
        }
        return_if!(
            MaskOf::<T, W, S>::IS_BITS && Self::LANES <= 64,
            self.tag().mask_from_bits(1 << i).if_then_else(value, self)
        );
        let d = self.tag().to_unsigned();
        let at = d.iota(Lane::from_usize(0)).raw.eq(d.set(Lane::from_usize(i)).raw);
        let bits = Raw::select(at, self.tag().set(value).cast_unsigned().raw, self.cast_unsigned().raw);
        Simd::<T::Unsigned, W, S>::new(self.s, bits).bitcast()
    }
    /// The first half of the lanes.
    #[op]
    #[track_caller]
    pub(crate) fn lower_half(self, // Take split.
    ) -> Simd<T, W::Half, S> {
        require!(
            "one lane has no halves, and there is no vector of less than 2 bytes",
            Self::LANES > 1 && W::BYTES > 2
        );
        Simd::new(self.s, self.raw.shuffle::<_, { p::PART }, 0>(self.raw))
    }
    /// The second half of the lanes.
    #[op]
    #[track_caller]
    pub(crate) fn upper_half(self, // Take split.
    ) -> Simd<T, W::Half, S> {
        require!(
            "one lane has no halves, and there is no vector of less than 2 bytes",
            Self::LANES > 1 && W::BYTES > 2
        );
        Simd::new(self.s, self.raw.shuffle::<_, { p::PART }, 1>(self.raw))
    }
    /// The 16 bytes from `16 * K` on. It doesn't build if there is no such block.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u64x4::from([1, 2, 3, 4]);
    /// assert_eq!(v.block::<1>(), [3, 4]);
    /// assert_eq!(v.with_block::<0>(u64x2::zero()), [0, 0, 3, 4]);
    /// # } example()
    /// ```
    #[op]
    #[track_caller]
    #[doc(alias("ExtractBlock", "extract_block"))]
    pub fn block<const K: usize>(self) -> Simd<T, B16, S> {
        require!("the vector has no block `K`", K < W::BYTES / 16, at any width K < 32);
        on_x86!(Simd::<T, B16, S>::new(self.s, self.raw.shuffle::<_, { p::PART }, K>(self.raw)), part_of::<W>())
    }
    /// With `block` in the 16 bytes from `16 * K` on. It doesn't build if there is no such block.
    #[op]
    #[track_caller]
    #[doc(alias("InsertBlock", "insert_block"))]
    pub fn with_block<const K: usize>(self, block: Simd<T, B16, S>) -> Self {
        require!("the vector has no block `K`", K < W::BYTES / 16, at any width K < 32);
        let all = self.with(block.raw.shuffle::<_, { p::REPEAT }, 0>(block.raw));
        on_x86!(self.shuffle::<{ p::SELECT_BLOCK }, K>(all), assembled())
    }
    shuffle1! {
        /// The lanes from the last to the first.
        pub reverse = REVERSE 0, 1;
        /// Swaps the lanes of each pair. `Shuffle2301` and `Shuffle01`.
        #[doc(alias("Reverse2", "shuffle2301", "shuffle01"))]
        pub swap_pairs = REVERSE_GROUPS 2, 2;
        /// Reverses each four lanes.
        pub(crate) reverse4 = REVERSE_GROUPS 4, 4;
        /// Reverses each eight lanes.
        pub(crate) reverse8 = REVERSE_GROUPS 8, 8;
        /// The blocks from the last to the first.
        pub(crate) reverse_blocks = REVERSE_BLOCKS 0, 1;
        /// Swaps the blocks of each pair. One block stays as it is.
        pub(crate) swap_adjacent_blocks = SWAP_BLOCKS 0, 1;
        /// Each even lane, also in place of the odd one after it.
        pub(crate) dup_even = DUP_EVEN 0, 1;
        /// Each odd lane, also in place of the even one before it.
        pub(crate) dup_odd = DUP_ODD 0, 1;
        /// Swaps the halves of each four lanes.
        pub(crate) shuffle1032 = SHUFFLE4 0b01_00_11_10, 4;
        /// Rotates each four lanes by one, toward lower addresses.
        pub(crate) shuffle0321 = SHUFFLE4 0b00_11_10_01, 4;
        /// Rotates each four lanes by one, toward higher addresses.
        pub(crate) shuffle2103 = SHUFFLE4 0b10_01_00_11, 4;
    }
    /// Alternating lanes from the lower halves of the vectors.
    #[op]
    pub(crate) fn interleave_whole_lower(self, other: Self) -> Self {
        halves_if!(W::BYTES > 64, |this: Self = self, other: Self = other| {
            let (a, b) = (this.parts::<W>()[0], other.parts::<W>()[0]);
            this.tag().join(a.interleave_whole_lower(b), a.interleave_whole_upper(b))
        });
        self.shuffle::<{ p::INTERLEAVE_WHOLE_LOWER }, 0>(other)
    }
    /// Alternating lanes from the upper halves of the vectors.
    #[op]
    pub(crate) fn interleave_whole_upper(self, other: Self) -> Self {
        halves_if!(W::BYTES > 64, |this: Self = self, other: Self = other| {
            let (a, b) = (this.parts::<W>()[1], other.parts::<W>()[1]);
            this.tag().join(a.interleave_whole_lower(b), a.interleave_whole_upper(b))
        });
        self.shuffle::<{ p::INTERLEAVE_WHOLE_UPPER }, 0>(other)
    }
    shuffle2! {
        /// In each block: alternating lanes from the lower halves.
        pub(crate) interleave_lower = INTERLEAVE_LOWER;
        /// In each block: alternating lanes from the upper halves.
        pub(crate) interleave_upper = INTERLEAVE_UPPER;
        /// The even lanes of `self` and `other`, alternating.
        pub(crate) interleave_even = INTERLEAVE_EVEN;
        /// The odd lanes of `self` and `other`, alternating.
        pub(crate) interleave_odd = INTERLEAVE_ODD;
        /// The even blocks of `self` and `other`, alternating.
        pub(crate) interleave_even_blocks = INTERLEAVE_EVEN_BLOCKS;
        /// The odd blocks of `self` and `other`, alternating.
        pub(crate) interleave_odd_blocks = INTERLEAVE_ODD_BLOCKS;
        /// The odd lanes of `self` and the even lanes of `other`.
        pub(crate) odd_even = ODD_EVEN;
        /// The odd blocks of `self` and the even blocks of `other`.
        pub(crate) odd_even_blocks = ODD_EVEN_BLOCKS;
    }
    /// `ORDER` has two bits for each of four lanes, as in `_MM_SHUFFLE`. `Per4LaneBlockShuffle`.
    #[op]
    #[track_caller]
    pub(crate) fn shuffle4<const ORDER: usize>(self) -> Self {
        require!("this takes four lanes or more, and an `ORDER` of eight bits", Self::LANES >= 4, at any width ORDER < 256);
        self.shuffle::<{ p::SHUFFLE4 }, ORDER>(self)
    }
    /// Lane `K` of each block, in all lanes of that block.
    #[op]
    #[track_caller]
    pub(crate) fn broadcast<const K: usize>(self, // Take splat or splat_lane.
    ) -> Self {
        require!("a block has no lane `K`", K < Self::BLOCK / size_of::<T>());
        self.shuffle::<{ p::BROADCAST }, K>(self)
    }
    /// Lane `K` in all lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from([1, 2, 3, 4]).splat_lane::<2>(), [3; 4]);
    /// # } example()
    /// ```
    #[doc(alias("BroadcastLane", "splat_first"))]
    #[op]
    #[track_caller]
    pub fn splat_lane<const K: usize>(/* else V::splat(v[i]) */ self) -> Self {
        require!("the vector has no lane `K`", K < Self::LANES, at any width K < 512);
        self.shuffle::<{ p::BROADCAST_LANE }, K>(self)
    }
    /// Block `K` in all blocks.
    #[op]
    #[track_caller]
    pub(crate) fn broadcast_block<const K: usize>(self) -> Self {
        require!("the vector has no block `K`", K < W::BYTES / Self::BLOCK);
        self.shuffle::<{ p::BROADCAST_BLOCK }, K>(self)
    }
    /// In each block, by `K` lanes toward higher addresses. Zeros come in.
    #[op]
    #[track_caller]
    pub(crate) fn shift_left_lanes<const K: usize>(self) -> Self {
        require!("`K` is more than a block", K <= Self::BLOCK / size_of::<T>(), at any width K <= 16);
        self.cast_unsigned().shuffle::<{ p::SHIFT_LEFT }, K>(self.tag().to_unsigned().zero()).bitcast()
    }
    /// In each block, by `K` lanes toward lower addresses. Zeros come in.
    #[op]
    #[track_caller]
    pub(crate) fn shift_right_lanes<const K: usize>(self) -> Self {
        require!("`K` is more than a block", K <= Self::BLOCK / size_of::<T>(), at any width K <= 16);
        self.cast_unsigned().shuffle::<{ p::ALIGN_RIGHT }, K>(self.tag().to_unsigned().zero()).bitcast()
    }
    /// Across blocks, toward higher addresses.
    #[op]
    #[track_caller]
    pub(crate) fn slide_up<const K: usize>(self) -> Self {
        let d = self.tag().to_unsigned();
        d.combine_slide_up::<K>(self.bitcast(), d.zero()).bitcast()
    }
    /// Across blocks, toward lower addresses.
    #[op]
    #[track_caller]
    pub(crate) fn slide_down<const K: usize>(self) -> Self {
        let d = self.tag().to_unsigned();
        d.combine_slide_down::<K>(d.zero(), self.bitcast()).bitcast()
    }
    /// Toward higher lanes. Zeros come in.
    #[inline(always)]
    pub(crate) fn up_by(self, n: usize) -> Self {
        apart!(self.s, {
            halves_if!(W::BYTES > 64, |this: Self = self, n: usize = n| {
                let mut lanes = this.tag().zero().to_array();
                this.store_n(&mut lanes.as_mut()[n.min(Self::LANES)..]);
                this.tag().from_array(lanes)
            });
            return_if!(S::SCALAR, |this: Self = self, n: usize = n| this.tag().zero().followed_by(this, Self::LANES - n.min(Self::LANES)));
            return_if!(S::BY_HAND, |this: Self = self, n: usize = n| this.slide_by_hand::<true>(n.min(Self::LANES) * size_of::<T>()));
            return_if!(
                crate::X86 && Self::SLIDES_BY_TABLE,
                self.slide_by_table::<true>(n.min(Self::LANES) * size_of::<T>())
            );
            return_if!(W::BYTES <= 16, {
                let d = self.tag().repartition::<u8>();
                self.move_lanes(d.iota(0) - d.set((n.min(Self::LANES) * size_of::<T>()) as u8))
            });
            let n = n.min(Self::LANES);
            return_if!(S::AVX512BW && !two_tables::<S, T>() && W::BYTES == 64, {
                let (v, odd) = (self.bitcast::<u16>(), (n & 1) as u32 * 8);
                (v.up_by(n / 2) << odd | v.up_by(n.div_ceil(2)) >> odd).bitcast()
            });
            return_if!(two_tables::<S, T>(), {
                let zero = self.tag().zero();
                zero.concat_swizzle_dyn_relaxed(self, self.tag().to_unsigned().iota(Lane::from_usize(Self::LANES - n)))
            });
            let d = self.tag().to_unsigned();
            let indices =
                (d.iota(Lane::from_usize(0)) - d.set(Lane::from_usize(n))) & d.set(Lane::from_usize(Self::LANES - 1));
            self.tag().first_n(n).if_then_zero_else(self.swizzle_dyn_relaxed(indices))
        })
    }
    /// Toward lower lanes. Zeros come in.
    #[inline(always)]
    pub(crate) fn down_by(self, n: usize) -> Self {
        apart!(self.s, {
            halves_if!(W::BYTES > 64, |this: Self = self, n: usize = n| {
                this.tag().load_n(&this.to_array().as_ref()[n.min(Self::LANES)..])
            });
            return_if!(S::SCALAR, |this: Self = self, n: usize = n| this.followed_by(this.tag().zero(), n.min(Self::LANES)));
            return_if!(S::BY_HAND, |this: Self = self, n: usize = n| this.slide_by_hand::<false>(n.min(Self::LANES) * size_of::<T>()));
            return_if!(
                crate::X86 && Self::SLIDES_BY_TABLE,
                self.slide_by_table::<false>((Self::LANES - n.min(Self::LANES)) * size_of::<T>())
            );
            return_if!(W::BYTES == 16, {
                // `tbl` gives zero from 16 on. `pshufb` does from 128 on, and ignores the other high bits.
                let first = S::TABLE_BIAS;
                let d = self.tag().repartition::<u8>();
                let from = d.iota(first) + d.set((n.min(Self::LANES) * size_of::<T>()) as u8);
                choose! { S::WASM => self.with_bytes(self.s.table::<W>(self.bytes(), from.bytes())), _ => self.move_lanes(from) }
            });
            let n = n.min(Self::LANES);
            return_if!(S::A64 && W::BYTES < 16, |this: Self = self, n: usize = n| {
                this.tag().resize_any(this.s.fixed::<u8, B16>().resize_bitcast(this).down_by(n * size_of::<T>()))
            });
            return_if!(S::AVX512BW && !two_tables::<S, T>() && W::BYTES == 64, {
                let (v, odd) = (self.bitcast::<u16>(), (n & 1) as u32 * 8);
                (v.down_by(n / 2) >> odd | v.down_by(n.div_ceil(2)) << odd).bitcast()
            });
            return_if!(two_tables::<S, T>() && W::BYTES == 64, {
                // By zero, it has to disappear early.
                self.lookup_in_two(self.tag().zero(), self.tag().to_unsigned().iota(Lane::from_usize(n)))
            });
            return_if!(
                two_tables::<S, T>() || W::BYTES < 16,
                self.concat_swizzle_dyn_relaxed(self.tag().zero(), self.tag().to_unsigned().iota(Lane::from_usize(n)))
            );
            let d = self.tag().to_unsigned();
            let indices = d.iota(Lane::from_usize(n)) & d.set(Lane::from_usize(Self::LANES - 1));
            self.tag().first_n(Self::LANES.saturating_sub(n)).if_then_else_zero(self.swizzle_dyn_relaxed(indices))
        })
    }
    pub(crate) const SLIDES_BY_TABLE: bool = S::SSE41 && W::BYTES >= 16 && Tag::<S, T, W>::FIRST_BY_TABLE
        || S::AVX2 && W::BYTES == 32 && !two_tables::<S, T>();
    /// The first so many bytes become zero if `UP`, and else the others.
    #[on(X86)]
    #[op]
    fn slide_by_table<const UP: bool>(self, first: usize) -> Self {
        let (d, table) = (self.tag().repartition::<u8>(), crate::maskmov::edge(first));
        let bytes = &table[crate::maskmov::BYTES..];
        return_if!(W::BYTES == 16, self.table_lookup_bytes(d.load(&bytes[if UP { 0 } else { 16 }..])).bitcast());
        return_if!(size_of::<T>() >= 4, {
            let (moved, first) = (self.rotate_by_table(first).bitcast::<u8>(), d.load(table));
            if UP { first.and_not(moved) } else { first & moved }.bitcast()
        });
        let zero = self.tag().zero();
        let other =
            if UP { self.tag().concat_lower_lower(self, zero) } else { self.tag().concat_upper_upper(zero, self) };
        let at = always!(|i: usize| d.dup128(*bytes[i..].first_chunk().unwrap()));
        (self.table_lookup_bytes(at(if UP { 0 } else { 32 })) | other.table_lookup_bytes(at(16))).bitcast()
    }
    /// The last so many of 32 bytes, and then `next`.
    #[on(X86)]
    #[op]
    pub(crate) fn splice_by_table(self, next: Self, last: usize) -> Self {
        let (d, table) = (self.tag().repartition::<u8>(), crate::maskmov::edge(last));
        return_if!(size_of::<T>() >= 4, {
            crate::Mask::from_full(d.load(table).bitcast::<T>())
                .if_then_else(self.rotate_by_table(last), next.rotate_by_table(last))
        });
        let at = always!(|v: Self, i: usize| v
            .table_lookup_bytes(d.dup128(*table[crate::maskmov::BYTES + i..].first_chunk().unwrap())));
        (at(self, 32) | at(self.tag().concat_lower_upper(next, self), 16) | at(next, 0)).bitcast()
    }
    /// Up, by as many bytes as the vector has at most.
    #[on(X86)]
    #[op]
    pub(crate) fn rotate_by_table(self, bytes: usize) -> Self {
        use crate::maskmov::{AROUND, TURNS, WORDS};
        let (d, table) = (self.tag().repartition::<u8>(), crate::maskmov::edge(bytes));
        return_if!(W::BYTES == 16, self.table_lookup_bytes(d.load(&table[AROUND..])).bitcast());
        return_if!(
            size_of::<T>() >= 4,
            self.bitcast::<u32>().swizzle_wrapping(d.load(&table[WORDS..]).bitcast()).bitcast()
        );
        let at = always!(|i: usize| d.dup128(*table[TURNS + i..].first_chunk().unwrap()));
        (self.table_lookup_bytes(at(0)) | self.bitcast::<u8>().rotate_elements_left::<16>().table_lookup_bytes(at(16)))
            .bitcast()
    }
    /// With shifts of 64 bits, which give zero for the counts that are too large or negative.
    #[on(X86)]
    #[op]
    fn slide_by_hand<const UP: bool>(self, bytes: usize) -> Self {
        return_if!(W::BYTES > 16, {
            let mut memory = [0; 128];
            self.bitcast::<u8>().store(&mut memory[if UP { 64 } else { 0 }..]);
            self.tag().repartition::<u8>().load(&memory[if UP { 64 - bytes } else { bytes }..]).bitcast()
        });
        let (s, d) = (self.s, self.s.fixed::<u64, B16>());
        let (v, by) = (d.resize_bitcast(self), d.from_array([8 * bytes as u64, 0]));
        let shift = always!(|left: bool, v: Simd<u64, B16, S>, by: Simd<u64, B16, S>| {
            v.with_bytes::<u64>(if left {
                s.shift_left_u64_16(v.bytes(), by.bytes())
            } else {
                s.shift_right_u64_16(v.bytes(), by.bytes())
            })
        });
        return_if!(W::BYTES <= 8, self.tag().resize_any(shift(UP, v, by)));
        let other = if UP { v.slide_up::<1>() } else { v.slide_down::<1>() };
        self.tag().resize_any(shift(UP, v, by) | shift(!UP, other, 64 - by) | shift(UP, other, by - 64))
    }
    /// For 16 bytes.
    #[on(X86)]
    #[op]
    pub(crate) fn rotate_by_hand(self, bytes: usize) -> Self {
        let (s, d) = (self.s, self.s.fixed::<u64, B16>());
        let (v, by) = (d.resize_bitcast(self), d.from_array([8 * bytes as u64, 0]));
        let left = always!(|v: Simd<u64, B16, S>, by: Simd<u64, B16, S>| {
            v.with_bytes::<u64>(s.shift_left_u64_16(v.bytes(), by.bytes()))
        });
        let right = always!(|v: Simd<u64, B16, S>, by: Simd<u64, B16, S>| {
            v.with_bytes::<u64>(s.shift_right_u64_16(v.bytes(), by.bytes()))
        });
        self.tag().resize_any(
            right(v, by) | left(v, 128 - by) | (left(v.swap_pairs(), 64 - by) | right(v.swap_pairs(), by - 64)),
        )
    }
    /// Whether the function below takes one lookup or shift.
    pub(crate) const SLIDES: bool = cfg!(target_endian = "little") && W::BYTES <= 8 && usize::BITS == 64
        || S::LOOKS_UP_IN_REGISTERS && (W::BYTES == 16 || S::AVX2 && W::BYTES == 32 && size_of::<T>() >= 4);
    /// The lanes from `n < LANES` on. Those after them are unspecified.
    #[op]
    pub(crate) fn lanes_from(self, n: usize) -> Self {
        let bytes = n * size_of::<T>();
        return_if!(W::BYTES <= 8, {
            let d = self.s.fixed::<u64, B16>();
            self.tag().resize_bitcast(d.resize_bitcast(self) >> (8 * bytes % 64) as u32)
        });
        return_if!(crate::X86 && Self::SLIDES_BY_TABLE, self.rotate_by_table(W::BYTES - bytes % W::BYTES));
        return_if!(W::BYTES == 16, self.move_lanes(self.tag().repartition().iota(bytes as u8)));
        let v = self.bitcast::<u32>();
        v.swizzle_dyn_relaxed(v.tag().iota(bytes as u32 / 4)).bitcast()
    }
    /// In each block: the sums of adjacent lanes of `self`, and then those of `other`.
    #[op]
    pub(crate) fn pairwise_add128(self, other: Self) -> Self {
        return_if!(S::SSSE3 && size_of::<T>() == 1 && W::BYTES >= 16 && !two_tables::<S, T>(), {
            let sums = always!(|v: Self| (v.bitcast::<u8>().sums_of_2() & 255).cast_signed());
            sums(self).in_blocks().saturating_narrow::<u8>(sums(other)).bitcast()
        });
        return_if!(S::A64 && W::BYTES >= 16 && !matches!(T::KIND, crate::lane::Kind::Float), {
            // Where LLVM sees that no carry arises, it would write `or`, which is no `addp`.
            let (a, b) = (self.tag().opaque(self.raw), self.tag().opaque(other.raw));
            a.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(b) + a.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(b)
        });
        return_if!(
            S::A64 && Self::HALF && !Self::SOFT && W::BYTES >= 16,
            self.with_bytes(self.s.add_pairs_f16::<W>(self.bytes(), other.bytes()))
        );
        return_if!(S::WASM && W::BYTES == 16 && T::BITS == 16 && !T::IS_FLOAT, {
            let sums = always!(|v: Self| v.bitcast::<i16>().sums_of_2().bitcast());
            self.tag().concat_even(sums(other), sums(self))
        });
        self.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(other) + self.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(other)
    }

    /// In each block: the byte of `self` at each index, or zero for an index of 128 and more. The result is unspecified
    /// for the other indices that are out of range. `TableLookupBytes` and `TableLookupBytesOr0`.
    #[op]
    pub(crate) fn table_lookup_bytes<U: Lane>(self, indices: Simd<U, W, S>) -> Simd<U, W, S> {
        return_if!(S::RELAXED, self.with_bytes(self.s.table_relaxed::<W>(self.bytes(), indices.bytes())));
        self.with_bytes(self.s.table::<W>(self.bytes(), indices.bytes()))
    }
    /// The same, where `self` changes as often as the indices.
    #[op]
    pub(crate) fn permute_bytes<U: Lane>(self, indices: Simd<U, W, S>) -> Simd<U, W, S> {
        return_if!(S::BY_HAND && W::BYTES <= 16, |this: Self = self, indices: Simd<U, W, S> = indices| {
            this.with_bytes(W::from16(this.s.listed(W::to16(this.bytes()), W::to16(indices.bytes()))))
        });
        self.table_lookup_bytes(indices)
    }
    /// The same for indices that keep the bytes of each lane together and in order.
    #[op]
    pub(crate) fn move_lanes(self, indices: Simd<u8, W, S>) -> Self {
        self.reinterpret::<u8>().table_lookup_bytes(indices).reinterpret()
    }
    /// The same for indices below 16.
    #[op]
    pub(crate) fn move_by_row(self, indices: Simd<u8, W, S>) -> Self {
        return_if!(S::BY_HAND || S::SCALAR && cfg!(target_endian = "little"), |this: Self = self, indices: Simd<u8, W, S> = indices| {
            this.swizzle_dyn_relaxed((indices.bitcast::<T::Unsigned>() & T::Unsigned::from_usize(15)) >> size_of::<T>().ilog2())
        });
        self.move_lanes(indices)
    }
    /// In each block: the byte at each index in `self` followed by `other`. The result is unspecified for an index of
    /// 32 and more.
    #[op]
    #[track_caller]
    pub(crate) fn two_tables_lookup_bytes<U: Lane>(self, other: Self, indices: Simd<U, W, S>) -> Simd<U, W, S> {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        self.with_bytes(self.s.table_in_two::<W>(self.bytes(), other.bytes(), indices.bytes()))
    }
    /// [`swizzle_dyn`](Self::swizzle_dyn), but unspecified for an index that is out of range. To wrap, write `indices & (LANES - 1)`, which
    /// is free where the instruction does it.
    #[op]
    pub fn swizzle_dyn_relaxed(self, indices: impl crate::Operand<T::Unsigned, W, S>) -> Self {
        let indices = crate::Operand::vector(indices, crate::Tag::new(self.s));
        return_if!(S::SCALAR && W::BYTES <= 64, |this: Self = self, indices: Simd<T::Unsigned, W, S> = indices| this.each_at(indices));
        halves_if!(W::BYTES > 64, |this: Self = self, indices: Simd<T::Unsigned, W, S> = indices| {
            return_if!(!S::LOOKS_UP_IN_REGISTERS, {
                let (from, mut to) = (this.to_array(), this.to_array());
                for (to, at) in to.as_mut().iter_mut().zip(indices.to_array().as_ref()) {
                    *to = from.as_ref()[crate::lane::Int::to_u64(*at) as usize % Self::LANES];
                }
                this.tag().from_array(to)
            });
            let ([a, b], [lower, upper]) = (this.parts::<W>(), indices.parts::<W>());
            this.tag().join(a.concat_swizzle_dyn_relaxed(b, lower), a.concat_swizzle_dyn_relaxed(b, upper))
        });
        if_here!(S::SVE2 && W::BYTES == 16 && size_of::<T>() > 1, {
            if !are_known!(indices.raw) {
                return self.with_bytes(self.s.lanes_at::<W>(self.bytes(), indices.bytes(), (size_of::<T>(), true)));
            }
            return self.lookup_in_one(indices & T::Unsigned::from_usize(Self::LANES - 1));
        });
        self.lookup_in_one(indices)
    }
    /// Up to 64 bytes.
    #[op]
    pub(crate) fn lookup_in_one(self, indices: Simd<T::Unsigned, W, S>) -> Self {
        let (table, _by, indices) = (on_x86!(self, to_look_up(indices)).raw.to_native(), indices, indices.bytes());
        let v = self.with_native(apart!(
            self.s,
            if const { size_of::<T>() == 1 } {
                self.s.lookup8::<W>(table, indices)
            } else if const { size_of::<T>() == 2 } {
                self.s.lookup16::<W>(table, indices)
            } else if const { size_of::<T>() == 4 } {
                self.s.lookup32::<W>(table, indices)
            } else {
                self.s.lookup64::<W>(table, indices)
            }
        ));
        on_x86!(v.settled(), looked_up(_by))
    }
    /// [`concat_swizzle_dyn`](Self::concat_swizzle_dyn), but unspecified for an index that is out of range.
    #[op]
    pub fn concat_swizzle_dyn_relaxed(
        self,
        other: impl crate::Operand<T, W, S>,
        indices: impl crate::Operand<T::Unsigned, W, S>,
    ) -> Self {
        let other = crate::Operand::vector(other, crate::Tag::new(self.s));
        let indices = crate::Operand::vector(indices, crate::Tag::new(self.s));
        halves_if!(W::BYTES > 64, |this: Self = self, other: Self = other, indices: Simd<T::Unsigned, W, S> = indices| {
            let within = indices & T::Unsigned::from_usize(Self::LANES - 1);
            within.simd_eq(indices).retype::<T::Signed>().if_then_else(this.swizzle_dyn_relaxed(within), other.swizzle_dyn_relaxed(within))
        });
        return_if!(S::SCALAR, |this: Self = self, other: Self = other, indices: Simd<T::Unsigned, W, S> = indices| this.before(other).each_at(indices));
        return_if!(W::BYTES < 16, {
            let d = Tag::<S, T, B16>::new(self.s);
            let both = d.resize_any::<T, W::Twice>(Simd::new(self.s, self.raw.shuffle::<_, { p::PART }, 0>(other.raw)));
            if_here!(
                S::SVE2 && size_of::<T>() > 1,
                if are_known!(indices.raw) {
                    let indices = indices & T::Unsigned::from_usize(d.lanes() - 1);
                    return self.tag().resize_any(both.lookup_in_one(d.to_unsigned().resize_any(indices)));
                }
            );
            self.tag().resize_any(both.swizzle_dyn_relaxed(d.to_unsigned().resize_any(indices)))
        });
        let (a, b) = (on_x86!(self, to_look_up(indices)), on_x86!(other, to_look_up(indices)));
        on_x86!(apart!(self.s, a.lookup_in_two(b, indices)).settled(), looked_up(indices))
    }
    #[op]
    fn lookup_in_two(self, other: Self, indices: Simd<T::Unsigned, W, S>) -> Self {
        let (a, b, indices) = (self.raw.to_native(), other.raw.to_native(), indices.bytes());
        self.with_native(choose! {
            size_of::<T>() == 1 => self.s.lookup8_in_two::<W>(a, b, indices),
            size_of::<T>() == 2 => self.s.lookup16_in_two::<W>(a, b, indices),
            size_of::<T>() == 4 => self.s.lookup32_in_two::<W>(a, b, indices),
            _ => self.s.lookup64_in_two::<W>(a, b, indices),
        })
    }
    #[op]
    #[track_caller]
    pub(crate) fn all_bits_of_lanes() -> u64 {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        !0 >> (64 - Self::LANES)
    }
    /// The lanes whose bits are set, in order. The lanes after them are unspecified.
    #[inline(always)]
    pub(crate) fn compress_own(self, bits: u64) -> Self {
        apart!(self.s, {
            if const { Self::LANES == 1 } {
                return self;
            }
            halves_if!(W::BYTES > 64, |this: Self = self, bits: u64 = bits| {
                let mut lanes = this.tag().zero().to_array();
                let [lower, upper] = this.parts::<W>();
                let (n, bits) = (Self::LANES / 2, bits & Self::all_bits_of_lanes());
                lower.compress_by(bits).store(lanes.as_mut());
                upper.compress_by(bits >> n).store(&mut lanes.as_mut()[crate::ops::count_bits_on::<S>(bits, n)..]);
                this.tag().from_array(lanes)
            });
            return_if!(S::SCALAR && Self::LANES > 8 || S::SCALAR && W::BYTES > 16, |this: Self = self, bits: u64 = bits| {
                let mut lanes = this.tag().zero().to_array();
                choose! { W::BYTES == 16 => this.tag().mask_from_bits(bits).if_then_else_zero(this), _ => this }.keep_ones(bits, lanes.as_mut());
                this.tag().from_array(lanes)
            });
            return_if!(S::BY_HAND && W::BYTES > 16, |this: Self = self, bits: u64 = bits| {
                let mut lanes = this.tag().zero().to_array();
                this.compress_own_store(bits, lanes.as_mut());
                this.tag().from_array(lanes)
            });
            halves_if!(S::AVX2 && !S::AVX512VL && W::BYTES == 64 && size_of::<T>() >= 4, |this: Self = self, bits: u64 = bits| {
                let (n, d) = (crate::ops::count_bits_on::<S>(bits, Self::LANES / 2), this.tag());
                let turned = this.upper_half().compress_own(bits >> (Self::LANES / 2)).rotate_elements_right_dyn(n);
                d.combine(turned, d.half().first_n(n).if_then_else(this.lower_half().compress_own(bits), turned))
            });
            let v = self.raw.to_native();
            self.with_native(choose! {
                W::BYTES > 64 || (S::BY_HAND || S::SCALAR) && W::BYTES > 16 => v,
                size_of::<T>() == 1 && W::BYTES <= 8 => W::from16(self.s.compress8_8(W::to16(v), bits)),
                size_of::<T>() == 1 => self.s.compress8::<W>(v, bits),
                size_of::<T>() == 2 => self.s.compress16::<W>(v, bits),
                size_of::<T>() == 4 => self.s.compress32::<W>(v, bits),
                _ => self.s.compress64::<W>(v, bits),
            })
        })
    }
    pub(crate) const COMPACTS: bool = S::SVE2 && T::BITS >= 32 && W::BYTES >= 16 && W::BYTES <= 64;
    const BY_MASK: bool = Self::COMPACTS && W::BYTES == 16;
    /// Two lanes need no table. On x86 a table is faster than a blend.
    pub(crate) const PAIR: bool = S::ARM && Self::LANES == 2 && W::BYTES == 16 && !Self::BY_MASK;
    /// The lanes where `mask` is true, in order. The lanes after them are unspecified.
    #[inline(always)]
    pub(crate) fn compress_mask(self, mask: MaskOf<T, W, S>) -> Self {
        apart_unoptimized!(self.s, {
            return_if!(Self::LANES > 64, |this: Self = self, mask: MaskOf<T, W, S> = mask| {
                let mut lanes = this.tag().zero().to_array();
                this.compress_mask_store(mask, lanes.as_mut());
                this.tag().from_array(lanes)
            });
            return_if!(Self::BY_MASK, |this: Self = self, mask: MaskOf<T, W, S> = mask| this.by_mask(mask));
            return_if!(S::A64 && Self::PAIR, |this: Self = self, mask: MaskOf<T, W, S> = mask| mask.either(this, this.splat_last()));
            return_if!(Self::PAIR, |this: Self = self, mask: MaskOf<T, W, S> = mask| mask.if_then_else(this, this.splat_last()));
            self.compress_own(mask.own_bits())
        })
    }
    #[on(BY_MASK)]
    #[op]
    pub(crate) fn by_mask(self, mask: MaskOf<T, W, S>) -> Self {
        self.with(Bits::from_native(W::from16(self.s.by_mask(
            W::to16(self.raw.to_native()),
            W::to16(mask.to_vector().raw.to_native()),
            T::BITS,
        ))))
    }
    /// `compress_mask` and `count`. `again`: the mask is the caller's, who may have more vectors for it.
    #[op]
    pub(crate) fn compress_counted(self, mask: MaskOf<T, W, S>, again: bool) -> (Self, usize) {
        return_if!(Self::COMPACTS && W::BYTES == 16, {
            if again {
                let (moves, count) = mask.moves();
                return (self.table_lookup_bytes(moves).bitcast(), count);
            }
            let mask = W::to16(mask.to_vector().raw.to_native());
            let (kept, count) = self.s.compact(W::to16(self.raw.to_native()), mask, size_of::<T>());
            (self.with(Bits::from_native(W::from16(kept))), count)
        });
        // LLVM sees how large this can be.
        return_if!(S::A64 && Self::PAIR, {
            let bits = mask.wide_bits().0;
            (self.compress_mask(mask), ((bits & 1) + (bits >> 63)) as usize)
        });
        (self.compress_mask(mask), mask.count())
    }
    /// Returns the number of lanes that were kept. `to` needs room for the whole vector, and all of that can change.
    #[op]
    #[track_caller]
    pub(crate) fn compress_own_store(self, bits: u64, to: &mut [impl crate::Writable<T>]) -> usize {
        let bits = bits & Self::all_bits_of_lanes();
        if const { S::COMPRESS[size_of::<T>().trailing_zeros() as usize] == 64 && W::BYTES <= 64 } {
            self.compress_own(bits).store(&mut to[..Self::LANES]);
            return crate::ops::count_bits_on::<S>(bits, Self::LANES);
        }
        self.compress_parts_store(bits, to)
    }
    pub(crate) const BY_HALVES: bool =
        S::A64 && cfg!(target_endian = "little") && size_of::<T>() == 1 && S::COMPRESS[0] == 8 && W::BYTES == 16;
    /// Each half compressed, without a move to take it out.
    #[op]
    pub(crate) fn compress_halves(self, bits: u64) -> [Simd<T, W::Half, S>; 2] {
        let of = always!(|at: u64| {
            self.table_lookup_bytes(self.tag().repartition::<u64>().from_fn(
                #[inline(always)]
                |i| if i == 0 { at } else { 0 },
            ))
            .bitcast::<T>()
            .lower_half()
        });
        [of(crate::ops::SET_BITS[bits as u8 as usize]), of(crate::ops::SET_BITS_UPPER[(bits >> 8) as u8 as usize])]
    }
    #[op]
    #[track_caller]
    fn compress_parts_store(self, bits: u64, to: &mut [impl crate::Writable<T>]) -> usize {
        let bits = bits & Self::all_bits_of_lanes();
        let to = &mut to[..Self::LANES];
        if const { S::SCALAR } {
            return live!(S::SCALAR, self.keep_ones(bits, to));
        }
        if const { Self::BY_HALVES } {
            return live!(Self::BY_HALVES, {
                let ([lower, upper], n) = (self.compress_halves(bits), crate::ops::count_bits_on::<S>(bits, 8));
                lower.store(to);
                upper.store(&mut to[n..]);
                n + crate::ops::count_bits_on::<S>(bits >> 8, 8)
            });
        }
        if const { W::BYTES <= S::COMPRESS[size_of::<T>().trailing_zeros() as usize] } {
            self.compress_own(bits).store(to);
            return crate::ops::count_bits_on::<S>(bits, Self::LANES);
        }
        apart!(self.s, |to: &mut [_]| {
            let lower = again!(Simd::compress_parts_store, self.lower_half(), bits, &mut *to);
            let upper =
                again!(Simd::compress_parts_store, self.upper_half(), bits >> (Self::LANES / 2), &mut to[lower..]);
            if const { S::POPCNT } { bits.count_ones() as usize } else { lower + upper }
        })
    }
    /// Whether the parts are written faster than they are joined.
    pub(crate) const IN_PARTS: bool = (S::A64 || S::SSE41 || S::WASM)
        && !Self::COMPACTS
        && Self::LANES <= 64
        && W::BYTES > S::COMPRESS[size_of::<T>().trailing_zeros() as usize];
    /// The same to memory that is not a plain slice.
    #[op]
    #[track_caller]
    pub(crate) fn compress_parts_write(self, bits: u64, to: &mut impl Place<T>, at: usize) -> usize {
        let bits = bits & Self::all_bits_of_lanes();
        if const { Self::BY_HALVES } {
            return live!(Self::BY_HALVES, {
                let ([lower, upper], n) = (self.compress_halves(bits), crate::ops::count_bits_on::<S>(bits, 8));
                lower.write(to, at);
                upper.write(to, at + n);
                n + crate::ops::count_bits_on::<S>(bits >> 8, 8)
            });
        }
        if const { !Self::IN_PARTS } {
            self.compress_own(bits).write(to, at);
            return crate::ops::count_bits_on::<S>(bits, Self::LANES);
        }
        live!(Self::IN_PARTS, {
            let lower = self.lower_half().compress_parts_write(bits, to, at);
            let upper = self.upper_half().compress_parts_write(bits >> (Self::LANES / 2), to, at + lower);
            if const { S::POPCNT } { bits.count_ones() as usize } else { lower + upper }
        })
    }
    /// [`compress_store`](Self::compress_store) with a mask.
    #[op]
    #[track_caller]
    pub(crate) fn compress_mask_store<E: crate::Writable<T>>(self, mask: MaskOf<T, W, S>, to: &mut [E]) -> usize {
        return_if!(Self::LANES > 64, |this: Self = self, mask: MaskOf<T, W, S> = mask, to: &mut [E] = to| {
            let lower = this.lower_half().compress_mask_store(mask.lower_half(), &mut to[..Self::LANES]);
            lower + this.upper_half().compress_mask_store(mask.upper_half(), &mut to[lower..])
        });
        if_here!(Self::BY_MASK || Self::PAIR, {
            let (kept, count) = self.compress_counted(mask, false);
            kept.store(to);
            return count.min(Self::LANES);
        });
        return_if!(Self::COMPACTS && !Self::BY_MASK, |this: Self = self, mask: MaskOf<T, W, S> = mask, to: &mut [E] = to| {
            let to = &mut to[..Self::LANES];
            let lower = this.lower_half().compress_mask_store(mask.lower_half(), to);
            lower + this.upper_half().compress_mask_store(mask.upper_half(), &mut to[lower..])
        });
        self.compress_own_store(mask.own_bits(), to)
    }
}

impl<S: Isa, T: HasSign, W: Width> Simd<T, W, S> {
    /// The absolute value. The lowest integer stays as it is.
    #[op]
    pub fn abs(self) -> Self {
        return_if!(
            S::A64 && Self::HALF && !Self::SOFT && W::BYTES >= 16,
            self.with_bytes(self.s.abs_f16::<W>(self.bytes()))
        );
        self.with(self.raw.abs())
    }
    /// True where the sign bit is set, which includes `-0.0`.
    #[doc(alias("IsNegative", "MaskFromVec", "BroadcastSignBit", "IfNegativeThenElse"))]
    #[inline(always)]
    pub fn is_negative(self) -> MaskOf<T, W, S> {
        self.to_mask()
    }
    /// `-v` where `self` is negative, and `v` elsewhere.
    #[op]
    pub(crate) fn if_negative_then_neg(self, v: Self) -> Self {
        choose! {
            matches!(T::KIND, Kind::Float) => v ^ (self & self.tag().sign_bit()),
            crate::X86 && S::SSSE3 && !S::AVX512VL && size_of::<T>() <= 4 =>
                (self.cast_signed() | T::Signed::ONE).if_negative_then_neg_or_undef_if_zero(v.cast_signed()).bitcast(),
            S::WASM => {
                let sign = self.is_negative().to_simd::<T>();
                (v ^ sign) - sign
            },
            _ => self.is_negative().if_then_else(-v, v),
        }
    }
}

impl<S: Isa, T: Signed, W: Width> Simd<T, W, S> {
    /// `-v` where `self` is negative, `v` where it is positive, and either `v` or zero where it is zero.
    #[op]
    pub(crate) fn if_negative_then_neg_or_undef_if_zero(self, v: Self) -> Self {
        self.with_bytes(if const { size_of::<T>() == 1 } {
            self.s.sign_i8::<W>(v.bytes(), self.bytes())
        } else if const { size_of::<T>() == 2 } {
            self.s.sign_i16::<W>(v.bytes(), self.bytes())
        } else if const { size_of::<T>() == 4 } {
            self.s.sign_i32::<W>(v.bytes(), self.bytes())
        } else {
            return live!(
                !(size_of::<T>() == 1) && !(size_of::<T>() == 2) && !(size_of::<T>() == 4),
                self.if_negative_then_neg(v)
            );
        })
    }
    /// All bits are set in the lanes that are negative, and none in the others.
    #[inline(always)]
    pub(crate) fn broadcast_sign_bit(self) -> Self {
        self >> (T::BITS - 1)
    }
}

impl<S: Isa, T: Unsigned, W: Width> Simd<T, W, S> {
    /// `first <= self && self <= last`, for `first <= last`.
    #[inline(always)]
    pub(crate) fn in_range(self, first: impl Operand<T, W, S>, last: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        apart!(self.s, {
            let span = self.like(last) - first;
            return_if!((crate::X86 || S::WASM) && !S::HAS_MASKED_MEMORY, {
                // x86 has only signed comparisons: move the range to the top of that order.
                let max = self.tag().to_signed().set(T::Signed::MAX);
                let by = max - self.like(last).cast_signed();
                let moved = self.cast_signed() + choose! { S::WASM => by.hoisted(self.cast_signed()), _ => by };
                // LLVM needs no negation if it sees the constant, which takes a number here.
                let least = max - span.cast_signed();
                if const { Self::HIDES_NUMBERS || S::WASM }
                    && crate::arithmetic::known(least.raw.eq(Raw::splat(least.get_lane())).all())
                {
                    return_if!(S::WASM, moved.simd_ge(least.get_lane()).retype());
                    return !moved.simd_lt(least.get_lane()).retype();
                }
                !moved.simd_lt(least).retype()
            });
            return_if!(Tag::<S, T, W>::PACKED, {
                let (before, after, around) = (self.simd_lt(first), self.simd_gt(last), self.like(first).simd_gt(last));
                !(around & before & after | around.and_not(before | after))
            });
            let mask = (self - first).simd_le(span);
            return_if!(crate::X86 && MaskOf::<T, W, S>::BOTH, {
                let max = self.tag().to_signed().set(T::Signed::MAX);
                mask.also(
                    (self.cast_signed() + (max - self.like(last).cast_signed())).less_lanes(max - span.cast_signed()),
                    true,
                    true,
                )
            });
            mask
        })
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// The sum, or the limit of `T` that it is beyond. On x86 it is one instruction for 8 and 16 bits only.
    #[doc(alias("saturated_add", "SaturatedAdd"))]
    #[op]
    pub fn saturating_add(self, other: impl Operand<T, W, S>) -> Self {
        return_if!(S::SSE2 && S::ONLY_SSE2 && T::BITS == 64 && T::IS_SIGNED, {
            let (sum, over) = self.overflowing_add(other);
            over.if_then_else((self.cast_unsigned() >> 63).bitcast::<T>() + T::MAX, sum)
        });
        self.with(self.raw.saturating_add(self.like(other).raw))
    }
    /// The difference, or the limit of `T` that it is beyond.
    #[doc(alias("saturated_sub", "SaturatedSub"))]
    #[op]
    pub fn saturating_sub(self, other: impl Operand<T, W, S>) -> Self {
        self.with(self.raw.saturating_sub(self.like(other).raw))
    }
    /// Reverses the bytes of each lane.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u16x2::from([0x1234, 0xff00]).swap_bytes(), [0x3412, 0x00ff]);
    /// # } example()
    /// ```
    #[doc(alias(
        "reverse_lane_bytes", "ReverseLaneBytes", "to_be", "from_be", "to_le", "from_le", "to_be_bytes",
        "from_be_bytes", "bswap", "ntohl", "ntohs", "htonl", "big_endian", "network_order"
    ))]
    #[op]
    pub fn swap_bytes(self) -> Self {
        return_if!(S::BY_HAND && T::BITS >= 32 && W::BYTES <= 64, |this: Self = self| this.bitcast::<u8>().swizzle(#[inline(always)] |i| i ^ (size_of::<T>() - 1)).bitcast());
        self.with(if cfg!(target_endian = "big") {
            Bits::from_native(self.raw.to_bytes())
        } else {
            self.raw.swap_bytes()
        })
    }
    /// Reverses the bits of each lane.
    #[op]
    pub fn reverse_bits(self) -> Self {
        return_if!(S::GFNI && !S::AVX512VBMI && W::BYTES >= 8, |this: Self = self| {
            this.swap_bytes().bitcast::<u8>().galois_affine(0x8040_2010_0804_0201).bitcast()
        });
        self.with(self.raw.reverse_bits())
    }
    /// Whether all of `bits` are set.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x4::from([0b00, 0b01, 0b10, 0b11]);
    /// assert_eq!((v.all_bits(0b11).to_bitmask(), v.any_bits(0b11).to_bitmask()), (0b1000, 0b1110));
    /// # } example()
    /// ```
    #[inline(always)]
    #[doc(alias("TestBit"))]
    pub fn all_bits(self, bits: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        apart!(self.s, {
            // For one bit, LLVM would test for not zero.
            return_if!(S::WASM, {
                let bits = self.like(bits).hoisted(self);
                MaskOf::<T, W, S>::from_full(self.with(Raw::from_mask(self.raw.and(bits.raw).eq(bits.raw))))
            });
            if_here!(crate::X86 && crate::OPTIMIZED && S::REGISTER == 64, {
                let bits = self.like(bits).cast_unsigned();
                if crate::arithmetic::known(
                    (bits & (bits - T::Unsigned::from_usize(1))).simd_eq(T::Unsigned::default()).all()
                        & bits.simd_ne(T::Unsigned::default()).all(),
                ) {
                    return self.any_bits(bits.bitcast::<T>());
                }
            });
            // The results for several registers are then joined before the comparison.
            if_here!(S::A64, {
                return self.and_not(bits).simd_eq(self.tag().zero());
            });
            // One operation less before `ptest`.
            choose! {
                crate::X86 && !S::AVX2 => self.and_not(self.like(bits)).cast_unsigned().simd_eq(T::Unsigned::default()).retype(),
                _ => (self & bits).simd_eq(bits),
            }
        })
    }
    /// For one bit in each lane. From 16 bytes on, AArch64 tests for any of several.
    #[op]
    pub(crate) fn has_bit(self, bit: Self) -> MaskOf<T, W, S> {
        halves_if!(S::A64 && W::BYTES > 16, |this: Self = self, bit: Self = bit| {
            MaskOf::<T, W, S>::combine(this.upper_half().has_bit(bit.upper_half()), this.lower_half().has_bit(bit.lower_half()))
        });
        choose! {
            // Before a selection, LLVM turns the test around, and loses `cmtst`.
            S::A64 && W::BYTES == 16 => MaskOf::<T, W, S>::from_full((self & bit).simd_ne(T::default()).to_vector().hidden_unless_known()),
            // Faster: `all_bits` goes by a mask register.
            crate::X86 && MaskOf::<T, W, S>::BOTH => (self & bit).simd_eq(bit),
            _ => self.all_bits(bit),
        }
    }
    /// For each lane, whether any of `bits` is set. For the whole vector: `v & bits != 0`.
    #[inline(always)]
    #[doc(alias("intersects", "ptest", "vptest", "vptestm"))]
    pub fn any_bits(self, bits: impl Operand<T, W, S>) -> MaskOf<T, W, S> {
        apart_unoptimized!(self.s, {
            if_here!(
                S::WASM && crate::OPTIMIZED,
                if let Some(bit) = Operand::number(bits) {
                    let n = T::unsigned(&[bit])[0].to_u64();
                    if crate::arithmetic::known(n.is_power_of_two()) {
                        return if n >> (T::BITS - 1) != 0 { self.to_mask() } else { self.all_bits(bit) };
                    }
                    return (self & bit).simd_ne(T::default());
                }
            );
            let bits = self.like(bits);
            if_here!(S::A64 && crate::OPTIMIZED && W::BYTES >= 16, {
                let raw = bits.cast_unsigned().raw;
                let (zero, one, top) = (
                    Raw::splat(T::Unsigned::ZERO),
                    Raw::splat(T::Unsigned::ONE),
                    Raw::splat(T::Unsigned::from_u64(1 << (T::BITS - 1))),
                );
                if crate::arithmetic::known(
                    raw.and(raw.sub(one)).eq(zero).all() & !raw.eq(zero).any() & !raw.eq(top).any(),
                ) {
                    return self.has_bit(bits);
                }
                // The tests of several registers for a constant are joined.
                if !are_known!(raw) {
                    return choose! { T::BITS > 8 => self.tag().opaque(self.raw), _ => self }.has_bit(bits);
                }
            });
            // For one bit, LLVM shifts it to the top, where `vptestm` is one instruction.
            let bits = if crate::OPTIMIZED && is_known!(bits.get_lane()) { bits.all_unseen() } else { bits };
            // One instruction.
            return_if!(
                MaskOf::<T, W, S>::BOTH,
                crate::mask::Mask::compared(self.s, (self & bits).raw.ne(Raw::splat(T::default())))
            );
            (self & bits).simd_ne(T::default())
        })
    }
    /// `(self + (1 << (count - 1))) >> count` without overflow, or `self` for 0. The count has to be less than the number of bits.
    #[op]
    pub(crate) fn rounding_shift_right(self, count: u32) -> Self {
        return_if!(S::NEON, self.rounding_shift_left(self.tag().set(T::from_u64((count as u64).wrapping_neg()))));
        if count == 0 {
            return self;
        }
        if const { size_of::<T>() == 2 && matches!(T::KIND, Kind::Signed) && !S::BY_HAND } {
            return live!(
                size_of::<T>() == 2 && matches!(T::KIND, Kind::Signed) && !S::BY_HAND,
                self.with_bytes(self.s.mul_fixed_point_15::<W>(
                    self.bytes(),
                    (self.tag().set(T::from_usize(0x4000)) >> (count - 1)).bytes()
                ))
            );
        } else if const { matches!(size_of::<T>(), 1 | 2) && matches!(T::KIND, Kind::Unsigned) } {
            return live!(
                !(size_of::<T>() == 2 && matches!(T::KIND, Kind::Signed) && !S::BY_HAND)
                    && matches!(size_of::<T>(), 1 | 2)
                    && matches!(T::KIND, Kind::Unsigned),
                (self >> (count - 1)).cast_unsigned().midpoint_up(self.tag().to_unsigned().zero()).bitcast()
            );
        }
        return_if!((S::SSE2 || S::WASM) && !S::GFNI && size_of::<T>() == 1 && T::IS_SIGNED, {
            let above = (self.bitcast::<u8>() ^ 128).rounding_shift_right(count);
            (above - 128u8.wrapping_shr(count)).bitcast()
        });
        let twice = self >> (count - 1);
        twice - (twice >> 1)
    }
    /// By a negative count for each lane.
    #[on(NEON)]
    #[op]
    pub(crate) fn rounding_shift_left(self, left: Self) -> Self {
        let (v, left) = (self.bytes(), left.bytes());
        self.with_bytes(if const { size_of::<T>() == 1 && !(matches!(T::KIND, Kind::Signed)) } {
            self.s.rounding_shift_u8::<W>(v, left)
        } else if const { size_of::<T>() == 1 && matches!(T::KIND, Kind::Signed) } {
            self.s.rounding_shift_i8::<W>(v, left)
        } else if const { size_of::<T>() == 2 && !(matches!(T::KIND, Kind::Signed)) } {
            self.s.rounding_shift_u16::<W>(v, left)
        } else if const { size_of::<T>() == 2 && matches!(T::KIND, Kind::Signed) } {
            self.s.rounding_shift_i16::<W>(v, left)
        } else if const { size_of::<T>() == 4 && !(matches!(T::KIND, Kind::Signed)) } {
            self.s.rounding_shift_u32::<W>(v, left)
        } else if const { size_of::<T>() == 4 && matches!(T::KIND, Kind::Signed) } {
            self.s.rounding_shift_i32::<W>(v, left)
        } else if const { !(matches!(T::KIND, Kind::Signed)) } {
            self.s.rounding_shift_u64::<W>(v, left)
        } else {
            self.s.rounding_shift_i64::<W>(v, left)
        })
    }
    /// [`in_blocks().interleave(..)[0]`](crate::InBlocks::interleave), as wider lanes.
    #[op]
    #[track_caller]
    pub(crate) fn zip_lower(self, other: Self) -> Simd<T::Wide, W, S> {
        self.interleave_lower(other).bitcast()
    }
    /// [`in_blocks().interleave(..)[1]`](crate::InBlocks::interleave), as wider lanes.
    #[op]
    #[track_caller]
    pub(crate) fn zip_upper(self, other: Self) -> Simd<T::Wide, W, S> {
        self.interleave_upper(other).bitcast()
    }
    /// The sums of adjacent lanes.
    #[op]
    #[track_caller]
    pub(crate) fn sums_of_2(self) -> Simd<T::Wide, W, S> {
        require!("this takes two lanes or more, of less than 64 bits", size_of::<T>() < 8 && Self::LANES > 1);
        let v = self.bytes();
        self.with_bytes(choose! {
            size_of::<T>() == 1 && !T::IS_SIGNED => self.s.sums_of_2_u8::<W>(v),
            size_of::<T>() == 1 => self.s.sums_of_2_i8::<W>(v),
            size_of::<T>() == 2 && !T::IS_SIGNED => self.s.sums_of_2_u16::<W>(v),
            size_of::<T>() == 2 => self.s.sums_of_2_i16::<W>(v),
            !T::IS_SIGNED => self.s.sums_of_2_u32::<W>(v),
            _ => self.s.sums_of_2_i32::<W>(v),
        })
    }
    /// Adds the products of the lower halves to `lower`, and those of the upper halves to `upper`.
    #[op]
    pub(crate) fn widen_mul_accumulate(
        self,
        other: Self,
        lower: Simd<T::Wide, W, S>,
        upper: Simd<T::Wide, W, S>,
    ) -> (Simd<T::Wide, W, S>, Simd<T::Wide, W, S>) {
        let (first, second) = self.mul_halves(other);
        (lower + first, upper + second)
    }
}

of_target! {
    u8 {
        /// In each block: a round of AES. Unless `has!(aes)`, it is slow. It has no
        /// branches or memory accesses that depend on the data, in the optimized builds that were checked. The same holds for the other `aes` functions.
        pub aes_round(key: u8) -> u8 = aes_round, from 16;
        /// The last round, which doesn't mix the columns.
        pub aes_last_round(key: u8) -> u8 = aes_last_round, from 16;
        /// A round of decryption.
        pub aes_round_inv(key: u8) -> u8 = aes_round_inv, from 16;
        /// The last round of decryption.
        pub aes_last_round_inv(key: u8) -> u8 = aes_last_round_inv, from 16;
        /// Prepares a round key for decryption.
        pub aes_inv_mix_columns() -> u8 = aes_inv_mix_columns, from 16;
        /// The sums of eight adjacent absolute differences.
        pub(crate) sums_of_8_abs_diff(other: u8) -> u64 = sums_of_8_abs_diff;
        /// The sums of two adjacent products, with saturation.
        pub(crate) saturating_dot_i8(other: i8) -> i16 = mul_add_u8_i8;
        /// Adds four adjacent products to each lane of `sum`.
        pub(crate) sum_of_mul_quad_accumulate_i8(other: i8, sum: i32) -> i32 = dot_u8_i8;
    }
    i16 {
        /// `(self * other + 0x4000) >> 15`. The result is unspecified if both are `i16::MIN`.
        #[doc(alias("mul_fixed_point_15", "MulFixedPoint15"))]
        pub mul_q15_relaxed(other: i16) -> i16 = mul_fixed_point_15;
    }
    u64 {
        /// The carry-less products of the even lanes. Each takes two lanes.
        ///
        /// Unless `has!(aes)`, which brings the instruction, it is slow. The default list has the word for neither `sse4` nor `neon`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u64x2::from([0b11, 0]).carryless_mul_even(u64x2::from([0b11, 0])), [0b101, 0]);
        /// # } example()
        /// ```
        #[doc(alias("clmul_lower", "CLMulLower", "pclmulqdq", "pmull"))]
        pub carryless_mul_even(other: u64) -> u64 = clmul_lower;
        /// The carry-less products of the odd lanes. Each takes two lanes. See [`carryless_mul_even`](Self::carryless_mul_even).
        #[doc(alias("clmul_upper", "CLMulUpper", "pmull2"))]
        pub carryless_mul_odd(other: u64) -> u64 = clmul_upper, from 16;
    }
    f32 {
        /// Ties go to the even number. The result is unspecified for what is out of range.
        pub(crate) nearest_int() -> i32 = nearest_f32_i32;
    }
}

/// On x86 by way of the token, or a function that is not inlined into its kernel would call the C library.
#[rules]
macro_rules! rounded { ($v:ident, $raw:ident, $op:ident) => {
    choose! {
        T::BITS == 16 || !crate::X86 && !(S::A64 && W::BYTES >= 16) => $v.with($v.raw.$raw()),
        T::BITS == 32 => $v.with_bytes($v.s.${concat($op, _f32)}::<W>($v.bytes())),
        _ => $v.with_bytes($v.s.${concat($op, _f64)}::<W>($v.bytes())),
    }
}; }

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    crate::multiply::fns! {
        /// The square root.
        fn sqrt(self) -> Self {
            in_f32!(soft self => |x| x.sqrt());
            crate::half::native!(Sqrt, self, self);
            // LLVM doesn't always make vectors of what `crate::float` does lane by lane.
            return_if!((S::SSE2 || S::A64) && T::BITS > 16 && W::BYTES >= 16,
                self.with_bytes(if const { T::BITS == 32 } { self.s.sqrt_f32::<W>(self.bytes()) } else { self.s.sqrt_f64::<W>(self.bytes()) }));
            self.with(self.raw.sqrt())
        }
        /// Rounds down to an integer. With a `cast` after it, AArch64 has one instruction for both, from `f32` on.
        #[doc(alias("floor_cast"))]
        fn floor(self) -> Self {
            in_f32!(soft self => |x| x.stays_wide().floor());
            crate::half::native!(Floor, self, self);
            return_if!(!Self::ROUNDS_BY_SUM, rounded!(self, floor, floor));
            return_if!(Self::ROUNDS_BY_SUM && Self::ROUNDS_BY_CAST, |x: Self = self| { let int = x.round_by_cast::<false>(); int - int.simd_gt(x).select(T::ONE, T::ZERO) });
            live!(Self::ROUNDS_BY_SUM && !Self::ROUNDS_BY_CAST, self.round_by_sum::<false>(#[inline(always)] |nearest, x| nearest - nearest.simd_gt(x).select(T::ONE, T::ZERO)))
        }
        /// Rounds up to an integer. With a `cast` after it, AArch64 has one instruction for both, from `f32` on.
        #[doc(alias("ceil_cast"))]
        fn ceil(self) -> Self {
            in_f32!(soft self => |x| x.stays_wide().ceil());
            crate::half::native!(Ceil, self, self);
            return_if!(!Self::ROUNDS_BY_SUM, rounded!(self, ceil, ceil));
            return_if!(Self::ROUNDS_BY_SUM && Self::ROUNDS_BY_CAST, |x: Self = self| { let int = x.round_by_cast::<false>(); int - int.simd_lt(x).select(T::from_f64(-1.0), T::ZERO) });
            live!(Self::ROUNDS_BY_SUM && !Self::ROUNDS_BY_CAST, self.round_by_sum::<false>(#[inline(always)] |nearest, x| nearest + nearest.simd_lt(x).select(T::ONE, T::ZERO)))
        }
        /// Rounds toward zero to an integer.
        fn trunc(self) -> Self {
            in_f32!(soft self => |x| x.stays_wide().trunc());
            crate::half::native!(Trunc, self, self);
            return_if!(!Self::ROUNDS_BY_SUM, rounded!(self, trunc, trunc));
            return_if!(Self::ROUNDS_BY_SUM && Self::ROUNDS_BY_CAST, |x: Self = self| x.round_by_cast::<false>());
            live!(Self::ROUNDS_BY_SUM && !Self::ROUNDS_BY_CAST, self.round_by_sum::<true>(#[inline(always)] |nearest, x| nearest - nearest.simd_gt(x).select(T::ONE, T::ZERO)))
        }
        /// Ties go to the even number.
        #[doc(alias("Round", "nearbyint", "rint"))]
        fn round_ties_even(self) -> Self {
            in_f32!(soft self => |x| x.stays_wide().round_ties_even());
            crate::half::native!(Even, self, self);
            return_if!(!Self::ROUNDS_BY_SUM, rounded!(self, round_ties_even, even));
            return_if!(Self::ROUNDS_BY_SUM && Self::ROUNDS_BY_CAST, |x: Self = self| x.round_by_cast::<true>());
            live!(Self::ROUNDS_BY_SUM && !Self::ROUNDS_BY_CAST, self.round_by_sum::<true>(#[inline(always)] |nearest, _| nearest))
        }
    }
}

macro_rules! operators {
    (@native + $a:ident, $b:expr) => { crate::half::native!(Add, $a, $b) };
    (@native - $a:ident, $b:expr) => { crate::half::native!(Sub, $a, $b) };
    ($($bound:ident $trait:ident $f:ident $assign:ident $g:ident $raw:ident $like:ident $([$soft:tt])?;)*) => {$(
        impl<S: Isa, T: $bound, W: Width, O: Operand<T, W, S>> $trait<O> for Simd<T, W, S> {
            type Output = Self;
            #[op]
            fn $f(self, other: O) -> Self {
                $(in_f32!(soft self, self.like(other) => |a, b| a $soft b); operators!(@native $soft self, self.like(other));)?
                apart_if_long!(self.s, self.with(self.raw.$raw(choose! { S::WASM => self.$like(other), _ => self.like(other) }.raw)))
            }
        }
        impl<S: Isa, T: $bound, W: Width, O: Operand<T, W, S>> $assign<O> for Simd<T, W, S> {
            #[op]
            fn $g(&mut self, other: O) { *self = (*self).$f(other) }
        }
    )*};
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> Mul<O> for Simd<T, W, S> {
    type Output = Self;
    #[op]
    fn mul(self, other: O) -> Self {
        // LLVM makes a shift and an addition of it.
        let cheap = choose! {
            S::AVX512DQ && size_of::<T>() == 8 && !T::IS_FLOAT => O::number(other).is_some_and(
                #[inline(always)]
                |n| {
                    let n = self.s.fixed::<T, crate::B8>().set(n).bitcast::<u64>().get_lane();
                    crate::arithmetic::known(
                        n.is_power_of_two() | n.wrapping_sub(1).is_power_of_two() | n.wrapping_add(1).is_power_of_two(),
                    )
                },
            ),
            _ => false,
        };
        if_here!(
            S::A64 && !S::SVE2 && crate::OPTIMIZED && size_of::<T>() == 8 && !T::IS_FLOAT && W::BYTES >= 16,
            if let Some(n) = O::number(other) {
                let (v, n) = (self.bitcast::<u64>(), self.s.fixed::<T, crate::B8>().set(n).bitcast::<u64>().get_lane());
                let (low, rest) = (n.trailing_zeros(), n & n.wrapping_sub(1));
                let shifted = always!(|by: u32| v.tag().opaque((v << by).raw));
                if crate::arithmetic::known(n.is_power_of_two()) {
                    return (v << low).bitcast();
                } else if crate::arithmetic::known(rest.is_power_of_two()) {
                    return (shifted(rest.trailing_zeros()) + (v << low)).bitcast();
                } else if crate::arithmetic::known(n.wrapping_add(1).is_power_of_two()) {
                    return (shifted(n.trailing_ones()) - v).bitcast();
                }
            }
        );
        if const { Tag::<S, T, W>::PACKED && !T::IS_FLOAT && W::BYTES >= 8 }
            && let Some(n) = O::number(other)
        {
            return live!(Tag::<S, T, W>::PACKED && !T::IS_FLOAT && W::BYTES >= 8, self.times_number(n));
        }
        let other = choose! { S::WASM && T::IS_FLOAT => self.beside(other), _ => self.like(other) };
        in_f32!(soft self, other => |a, b| a * b);
        crate::half::native!(Mul, self, other);
        halves_if!(S::A64 && !S::SVE2 && size_of::<T>() == 8 && !T::IS_FLOAT && W::BYTES > 32, |a: Self = self, b: Self = other| {
            a.tag().combine(a.upper_half() * b.upper_half(), a.lower_half() * b.lower_half())
        });
        if_here!(
            S::A64
                && crate::OPTIMIZED
                && size_of::<T>() == 8
                && matches!(T::KIND, Kind::Signed)
                && matches!(W::BYTES, 16 | 32),
            {
                let (a, b) = (self.bitcast::<i64>(), other.bitcast::<i64>());
                let fits = always!(|v: Simd<i64, W, S>| (v << 32 >> 32).raw.eq(v.raw).all());
                if crate::arithmetic::known(fits(a) & fits(b)) {
                    // Both fit in 32 bits.
                    let half = always!(|v| Tag::<S, i32, W::Half>::new(self.s).truncate_to(v).hidden_unless_known());
                    return a.tag().widen_mul(half(a), half(b)).bitcast();
                }
            }
        );
        return_if!(
            S::A64 && !S::SVE2 && size_of::<T>() == 8 && !T::IS_FLOAT && W::BYTES == 32,
            self.with_bytes(W::from32(self.s.mul64_pair(W::to32(self.bytes()), W::to32(other.bytes()))))
        );
        if const { size_of::<T>() == 8 && !matches!(T::KIND, Kind::Float) && W::BYTES >= 16 } && !cheap {
            return live!(
                size_of::<T>() == 8 && !T::IS_FLOAT && W::BYTES >= 16,
                self.with_bytes(self.s.mul64::<W>(self.bytes(), other.bytes()))
            );
        }
        if_here!(S::SSE2 && crate::OPTIMIZED && size_of::<T>() == 1 && W::BYTES <= 64, {
            if let Some(product) = self.bitcast::<u8>().times_by_shifts(other.bitcast()) {
                return product.bitcast();
            }
        });
        return_if!(
            S::SSE2 && crate::OPTIMIZED && !S::SSE41 && size_of::<T>() == 4 && !T::IS_FLOAT && W::BYTES <= 64,
            {
                if let Some(product) = self.bitcast::<u32>().times_by_shifts(other.bitcast()) {
                    return product.bitcast();
                }
                // These keep LLVM from multiplying all 64 bits.
                if const { W::BYTES >= 16 } && !(are_known!(self.raw) && are_known!(other.raw)) {
                    let (a, b) = (self.bitcast::<u32>(), other.bitcast::<u32>());
                    let (even, odd) = (a.widening_mul_even(b).bitcast::<u32>(), a.widening_mul_odd(b).bitcast::<u32>());
                    return even.with(even.raw.shuffle::<_, { p::INTERLEAVE_EVEN }, 0>(odd.raw)).bitcast();
                }
                self.with(self.raw.mul(other.raw))
            }
        );
        apart_if_long!(self.s, self.with(self.raw.mul(other.raw)))
    }
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> MulAssign<O> for Simd<T, W, S> {
    #[inline(always)]
    fn mul_assign(&mut self, other: O) {
        *self = *self * other
    }
}
operators! {
    Lane Add add AddAssign add_assign add beside [+];
    Lane Sub sub SubAssign sub_assign sub beside [-];
    Lane BitAnd bitand BitAndAssign bitand_assign and beside_and;
    Lane BitOr bitor BitOrAssign bitor_assign or beside;
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> BitXor<O> for Simd<T, W, S> {
    type Output = Self;
    #[op]
    fn bitxor(self, other: O) -> Self {
        // With a rotation it becomes `xar`, which overwrites the first operand. LLVM would swap them, and copy one. It puts a cast last.
        return_if!(S::SVE2 && size_of::<T>() == 4 && !T::IS_FLOAT && W::BYTES >= 16, {
            if O::number(other).is_none() {
                let (other, bytes) = (self.like(other).raw, self.like(other).bitcast::<u8>());
                let last = bytes.tag().opaque(bytes.raw).bitcast::<T>().raw;
                let known = are_known!(other);
                return self.with(self.raw.xor(core::hint::select_unpredictable(known, other, last)));
            }
            self.xor(self.like(other))
        });
        apart_if_long!(self.s, self.xor(choose! { S::WASM => self.beside(other), _ => self.like(other) }))
    }
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> BitXorAssign<O> for Simd<T, W, S> {
    #[inline(always)]
    fn bitxor_assign(&mut self, other: O) {
        *self = *self ^ other
    }
}

impl<S: Isa, T: Lane, W: Width> Not for Simd<T, W, S> {
    type Output = Self;
    #[op]
    fn not(self) -> Self {
        self.with(self.raw.not())
    }
}

impl<S: Isa, T: Lane, W: Width> Neg for Simd<T, W, S> {
    type Output = Self;
    #[op]
    fn neg(self) -> Self {
        choose! {
            matches!(T::KIND, Kind::Unsigned) => self.tag().zero() - self,
            // LLVM would negate a factor of a product, and `mul_add` can't take in the sign then.
            crate::X86 && S::HAS_FMA && T::IS_FLOAT && T::BITS >= 32 && W::BYTES >= 16 => self.with(self.barrier().raw.neg()),
            S::A64 && T::IS_FLOAT && T::BITS >= 32 && W::BYTES >= 8 => self.with(self.barrier().raw.neg()),
            Self::HALF && !Self::SOFT && W::BYTES >= 16 => self.barrier().negated(),
            _ => self.with(self.raw.neg()),
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// Whether there are no shifts by vectors, and multiplying does it.
    const BY_PRODUCT: bool = size_of::<T>() == 2 && S::SSSE3 && !S::AVX512BW && (W::BYTES >= 32 || !S::AVX2);
    /// The lower byte is at the count in `table`, and the upper byte is eight entries from there.
    #[op]
    pub(crate) fn factors(self, counts: Self, table: [u8; 16]) -> Simd<u16, W, S> {
        let at = (counts.bitcast::<u8>().dup_even() & 15u8).bitcast::<u16>() ^ 0x0800u16;
        return_if!(W::BYTES < 16, {
            let d = self.s.fixed::<u8, B16>();
            at.tag().resize_bitcast(d.from_array(table).table_lookup_bytes(d.resize_bitcast(at)))
        });
        self.tag().repartition::<u8>().dup128(table).table_lookup_bytes(at)
    }
}

const LOW_BITS: [u8; 16] = [255, 127, 63, 31, 15, 7, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0];

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// LLVM sees a shift of bytes in one of wider lanes, and has `vgf2p8affineqb` for it.
    const WIDENED: bool = crate::OPTIMIZED && S::AVX2 && !S::AVX512VL && size_of::<T>() == 1 && W::BYTES >= 16;
    pub(crate) const AFFINE: bool = S::GFNI && !S::AVX512VBMI && size_of::<T>() == 1 && W::BYTES >= 16;
    #[op]
    pub(crate) fn shl_same(self, count: u32) -> Self {
        if_here!(
            crate::X86 && size_of::<T>() == 1,
            if !is_known!(count) {
                return_if!(crate::X86 && size_of::<T>() == 1, |this: Self = self, count: u32 = count| this.shift_left_same(count));
            }
        );
        halves_if!(S::GFNI && Self::WIDENED && W::BYTES > 32, |this: Self = self, count: u32 = count| this.tag().combine(this.upper_half() << count, this.lower_half() << count));
        return_if!(S::GFNI && Self::WIDENED && W::BYTES <= 32, |this: Self = self, count: u32 = count| (this.cast::<u16>() << (count % 8)).cast::<T>().same());
        self.with(self.raw.shl_by(count % T::BITS))
    }
    #[op]
    pub(crate) fn shr_same(self, count: u32) -> Self {
        if_here!(
            crate::X86 && size_of::<T>() == 1,
            if !is_known!(count) {
                return_if!(crate::X86 && size_of::<T>() == 1, |this: Self = self, count: u32 = count| this.shift_right_same(count));
            }
        );
        if_here!(
            S::GFNI && W::BYTES == S::REGISTER && W::BYTES == 64 && size_of::<T>() == 1 && T::IS_SIGNED,
            if count == 7 {
                // `vpmovm2b` is slower: see `to_simd`.
                return_if!(crate::X86 && size_of::<T>() == 1, |this: Self = self| this.shift_right_same(7));
            }
        );
        return_if!(S::SSE2 && !S::AVX2 && size_of::<T>() == 1 && T::IS_SIGNED && W::BYTES == 16, |this: Self = self, count: u32 = count| {
            if count % 8 == 7 {
                return this.with(this.raw.shr_by(7));
            }
            // Or LLVM makes more shifts.
            let top = 0x80u8 >> (count % 8);
            (((this.bitcast::<u8>() >> count).barrier_unless_known() ^ top) - top).bitcast()
        });
        halves_if!(S::AVX2 && Self::WIDENED && (S::GFNI || T::IS_SIGNED) && W::BYTES > 32, |this: Self = self, count: u32 = count| this.tag().combine(this.upper_half() >> count, this.lower_half() >> count));
        return_if!(S::AVX2 && Self::WIDENED && (S::GFNI || T::IS_SIGNED) && W::BYTES <= 32, |this: Self = self, count: u32 = count| (this.cast::<T::Wide>() >> (count % 8)).cast::<T>().same());
        self.with(self.raw.shr_by(count % T::BITS))
    }
    /// Where there is no product that LLVM could take apart.
    #[op]
    pub(crate) fn times_by_shifts(self, factor: Self) -> Option<Self> {
        if !are_known!(factor.raw) {
            return None;
        }
        let by = factor.get_lane().to_u64() as u32;
        let (low, rest) = (by.trailing_zeros(), by & by.wrapping_sub(1));
        if by == 0 || rest & rest.wrapping_sub(1) != 0 || factor.raw.ne(factor.tag().set(factor.get_lane()).raw).any() {
            return None;
        }
        Some(if rest == 0 { self << low } else { (self << low) + (self << rest.trailing_zeros()) })
    }
    #[op]
    pub(crate) fn shl_each(self, counts: Self) -> Self {
        return_if!(Self::BY_PRODUCT, |this: Self = self, counts: Self = counts| this * this.factors(counts, [1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0]).bitcast());
        return_if!(S::GFNI && size_of::<T>() == 1 && W::BYTES >= 16 && W::BYTES <= 64, |this: Self = self, counts: Self = counts| {
            if const { !S::AVX512VL } && are_known!(this.raw) && are_known!(counts.raw) {
                return this.with(this.raw.shl(counts.raw));
            }
            // What doesn't overflow isn't reduced.
            let (d, counts) = (this.tag().repartition::<u8>(), counts.bitcast::<u8>() & 7);
            let kept = this.bitcast::<u8>() & d.dup128(LOW_BITS).table_lookup_bytes(counts);
            kept.galois_mul(d.dup128([1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0]).table_lookup_bytes(counts)).bitcast()
        });
        self.with(self.raw.shl(counts.raw))
    }
    /// By any count, of lanes of 16 bits.
    #[on(X86)]
    #[op]
    pub(crate) fn shr_in_pairs(self, counts: Self) -> Self {
        let (v, by) = (self.bitcast::<T::Wide>(), counts.bitcast::<u32>());
        let (even, odd) = ((by & 0xffff).bitcast::<T::Wide>(), (by >> 16).barrier().bitcast::<T::Wide>());
        let even = choose! { T::IS_SIGNED => (v << 16).unbounded_shr(even) >> 16, _ => (v & T::Wide::from_usize(0xffff)).unbounded_shr(even) };
        v.unbounded_shr(odd).bitcast::<T>().odd_even(even.bitcast())
    }
    #[op]
    pub(crate) fn shr_each(self, counts: Self) -> Self {
        return_if!(S::GFNI && Self::AFFINE && !T::IS_SIGNED && W::BYTES <= 64, |this: Self = self, counts: Self = counts| (this.reverse_bits() << counts).reverse_bits());
        return_if!(S::SSE41 && !S::AVX512BW && size_of::<T>() == 1 && W::BYTES >= 16, |this: Self = self, counts: Self = counts| {
            // Seven bits too far to the left, in 16.
            let table = this.tag().repartition::<u8>().dup128([128, 64, 32, 16, 8, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
            let (v, by) = (this.bitcast::<u16>(), table.table_lookup_bytes(counts.bitcast::<u16>() & 0x0707));
            let signed = always!(|by: Simd<u16, W, S>| by.bitcast::<u8>().saturating_dot_i8(v.bitcast::<i8>()).cast_unsigned());
            let (even, odd) = choose! {
                T::IS_SIGNED => (signed(by & 0xff) >> 7 & 0xff, signed(by & 0xff00)),
                _ => (((v & 0xff) * (by & 0xff)) >> 7, v.mul_high(by & 0xff00)),
            };
            (even | (odd + odd) & 0xff00).bitcast()
        });
        if const { S::AVX2 && Self::BY_PRODUCT && T::IS_SIGNED } && !are_known!(counts.raw) {
            return live!(S::AVX2 && Self::BY_PRODUCT && T::IS_SIGNED, self.shr_in_pairs(counts & T::from_usize(15)));
        }
        return_if!(T::KIND as u8 == Kind::Signed as u8 && (Self::BY_PRODUCT || crate::X86 && (size_of::<T>() == 8 && !S::AVX512VL || S::SSE2 && !S::SSE41 && size_of::<T>() < 4)), |this: Self = self, counts: Self = counts| {
            let sign = this.to_mask().to_simd::<T>();
            ((this ^ sign).cast_unsigned() >> counts.cast_unsigned()).bitcast() ^ sign
        });
        return_if!(Self::BY_PRODUCT, |this: Self = self, counts: Self = counts| {
            // The factor for a count of 0 doesn't fit: it is 1, and the upper half of that product is zero.
            let factors = this.factors(counts, [1, 0, 0, 0, 0, 0, 0, 0, 0, 128, 64, 32, 16, 8, 4, 2]);
            this.bitcast::<u16>().mul_high(factors).bitcast() | this & factors.simd_eq(1u16).to_vector().bitcast()
        });
        return_if!(S::SSE2 && !S::SSE41 && T::BITS == 16 && !T::IS_SIGNED, {
            let factors = self.like(T::ONE) << -counts;
            self.mul_high(factors) | self & factors.simd_eq(T::ONE).to_vector().bitcast()
        });
        if const { S::SSE2 && !S::AVX2 && T::BITS == 32 && !T::IS_SIGNED && W::BYTES >= 16 } && !are_known!(counts.raw)
        {
            return live!(S::SSE2 && !S::AVX2 && T::BITS == 32 && W::BYTES >= 16, {
                // 31 bits too far to the left, in 64.
                let (v, by) = (self.bitcast::<u32>(), (self.like(T::ONE) << !counts).bitcast::<u32>());
                let odd = v.widening_mul_odd(by);
                (v.widening_mul_even(by) >> 31 | (odd + odd) & !0 << 32).bitcast()
            });
        }
        return_if!(S::AVX512VBMI && size_of::<T>() == 1 && W::BYTES >= 16 && W::BYTES <= 64, |this: Self = self, counts: Self = counts| {
            let (d, counts) = (this.tag().repartition::<u8>(), counts.bitcast::<u8>() & 7);
            let first = d.repartition::<u64>().set(0x3830_2820_1810_0800).bitcast::<u8>();
            let moved = this.with_bytes::<T>(this.s.multi_shift::<W>(this.bytes(), (counts | first).bytes()));
            let kept = d.dup128(LOW_BITS).table_lookup_bytes(counts).bitcast::<T>();
            choose! { T::KIND as u8 == Kind::Signed as u8 => kept.bit_select(moved, this >> 7), _ => kept & moved }
        });
        self.with(self.raw.shr(counts.raw))
    }
}

/// By a [`Count`], modulo the number of bits: any integer for all lanes, or a vector or an array with a count for each. For the latter x86 has the instruction for 32 and 64 bits from `avx2` on,
/// and for 16 from `avx512`. Otherwise it takes 5 to 15, and `<<` fewer than `>>`. `ShiftLeft` and `ShiftLeftSame`.
impl<S: Isa, T: Int, W: Width, C: Count<T, W, S>> Shl<C> for Simd<T, W, S> {
    type Output = Self;
    #[inline(always)]
    fn shl(self, count: C) -> Self {
        Count::left(count, self)
    }
}

/// By a [`Count`], modulo the number of bits: any integer for all lanes, or a vector or an array with a count for each. For the latter x86 has the instruction for 32 and 64 bits from `avx2` on,
/// and for 16 and `i64` from `avx512`. Otherwise it takes 5 to 15, and `<<` fewer than `>>`. `ShiftRight` and `ShiftRightSame`.
impl<S: Isa, T: Int, W: Width, C: Count<T, W, S>> Shr<C> for Simd<T, W, S> {
    type Output = Self;
    #[inline(always)]
    fn shr(self, count: C) -> Self {
        Count::right(count, self)
    }
}

impl<S: Isa, T: Int, W: Width, C: Count<T, W, S>> ShlAssign<C> for Simd<T, W, S> {
    #[inline(always)]
    fn shl_assign(&mut self, count: C) {
        *self = *self << count
    }
}

impl<S: Isa, T: Int, W: Width, C: Count<T, W, S>> ShrAssign<C> for Simd<T, W, S> {
    #[inline(always)]
    fn shr_assign(&mut self, count: C) {
        *self = *self >> count
    }
}
impl<S: Isa, T: Lane, W: Width> Simd<T, W, S>
where
    crate::Code: crate::At<S>,
{
    /// The number of lanes.
    #[doc(alias("LEN", "Lanes", "len"))]
    pub const LANES: usize = W::BYTES / size_of::<T>();
}
