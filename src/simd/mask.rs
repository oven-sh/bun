use crate::arithmetic::known;
use crate::endian::ToBytes;
use crate::pattern as p;
use crate::raw::{AsBits, AsBoth, AsVector, Bits, MaskOf, Parts, Raw, RawMask, RawOf, same};
use crate::simd::prelude::{u8x16, u8x64, u16x8};
use crate::width::Repr;
use crate::{Int, Isa, Lane, Operand, Signed, Simd, Tag, Width};
use core::ops::{BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Not};

/// One boolean for each lane of a [`Simd`]. It depends on the size of the lane only, and names the signed integer of that size: see [`MaskOf`](crate::MaskOf).
///
/// Comparisons make masks, and `&`, `|`, `^` and `!` combine them. See [the index](crate::index#masks).
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = u8x8::from(b"a,b;c,d ");
/// let m = v.simd_eq(b',') | v.simd_eq(b';');
/// assert_eq!((m.to_bitmask(), m.count(), m.first_set()), (0b101010, 3, Some(1)));
/// assert_eq!(m.select(b'_', v), *b"a_b_c_d ");
/// # } example()
/// ```
pub struct Mask<
    T: Signed,
    W: Width,
    S: Isa, // It is known in functions with #[simd] or #[kernel].
> {
    parts: <S::Register as Repr>::Mask<T, W>,
    pub(crate) s: S,
}

impl<S: Isa, T: Signed, W: Width> Copy for Mask<T, W, S> {}
impl<S: Isa, T: Signed, W: Width> Clone for Mask<T, W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

impl<S: Isa, T: Signed, W: Width> core::fmt::Debug for Mask<T, W, S> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        return_if!(Self::LANES > 64, self.parts::<W>().fmt(f));
        write!(f, "{:#b}", crate::gate::Enter::short_call(self.s, always!(|| self.to_bitmask())))
    }
}

/// Four bits for each byte. NEON has no instruction that gathers a bit from each lane.
#[on(ARM)]
#[op]
fn nibbles(bytes: u8x16) -> u64 {
    #[cfg(all(
        bun_simd_unoptimized,
        target_arch = "aarch64",
        target_feature = "neon",
        target_endian = "little",
        not(miri)
    ))]
    return crate::simd::nibbles(bytes);
    #[allow(unreachable_code)]
    u64::from_le_bytes(crate::raw::copy::to_array((u16x8::from_le_bytes(bytes) >> 4).cast::<u8, crate::Portable>()))
}

impl<S: Isa, T: Signed, W: Width> Unpin for Mask<T, W, S> {}
impl<S: Isa, T: Signed, W: Width> core::panic::UnwindSafe for Mask<T, W, S> {}
impl<S: Isa, T: Signed, W: Width> core::panic::RefUnwindSafe for Mask<T, W, S> {}

impl<S: Isa, T: Signed, W: Width> Mask<T, W, S> {
    // How it is kept: see `Parts`.
    const SPLIT: bool = W::BYTES > S::REGISTER;
    const VECTOR: bool = S::REGISTER < 64 && !Self::SPLIT;
    const BITS: bool = S::REGISTER == 64 && W::BYTES >= 16 && !Self::SPLIT;
    /// Whether `&`, `^` and `!` are best done in mask registers. Longer masks tend to be shifted and counted, and `|` to be searched.
    const STAYS: bool = Self::LANES == 8 || Self::LANES == 16;
    const OPAQUE: bool = Self::BITS && crate::regs::MASKS && W::BYTES <= 32;
    /// See `new`.
    const BECOMES_BITS: bool = !Self::BITS
        && crate::regs::MASKS
        && W::BYTES <= 32
        && (S::REGISTER == 64 || cfg!(all(target_feature = "avx512bw", target_feature = "avx512vl")));
    /// In a mask register of AVX-512.
    pub(crate) const IS_BITS: bool = S::REGISTER == 64;
    /// In a vector of one block.
    pub(crate) const IN_BLOCK: bool = !Self::IS_BITS && W::BYTES <= 16;
    /// Whether the first lane that is true is best found without leaving the vector registers.
    pub(crate) const SPREADS: bool =
        Self::IN_BLOCK && (S::ARM || Self::LANES <= 2 || W::BYTES <= 8 || size_of::<T>() == 2 && !const { S::BMI1 });

    #[op]
    pub(crate) fn new(s: S, raw: MaskOf<T, W>) -> Self {
        let raw: MaskOf<T, W> = choose! {
            Self::BECOMES_BITS && Self::LANES > 8 => RawMask::from_bits(crate::regs::in_mask::<S>(crate::regs::some_lanes(raw.to_bits(), Self::LANES), Self::LANES)),
            Self::BECOMES_BITS => RawMask::from_bits(crate::regs::in_mask::<S>(raw.to_more_bits(), 16)),
            _ => raw,
        };
        return_if!(Self::VECTOR, {
            // On NEON, LLVM takes booleans apart that live across a branch. On x86 they are cheap, and it merges comparisons.
            if const { !crate::OPTIMIZED } {
                return Self { parts: same(AsVector(RawOf::<T, W>::from_mask(raw))), s };
            }
            let v = Simd::new(s, Raw::from_mask(raw));
            Self::from_vector(if S::VECTOR_MASKS { v.barrier() } else { v })
        });
        return_if!(crate::X86 && Self::BITS && Self::LANES < 8, |s: S = s, raw: MaskOf<T, W> = raw| {
            let bits = Self::few_bits(s, raw);
            Self::of_bits(s, choose! { crate::regs::MASKS => crate::regs::in_mask::<S>(bits, 16), _ => bits })
        });
        return_if!(Self::OPAQUE, Self::of_bits(s, crate::regs::in_mask::<S>(raw.to_bits(), Self::LANES)));
        Self::of_logic(s, raw)
    }
    #[op]
    fn of_logic(s: S, raw: MaskOf<T, W>) -> Self {
        Self { parts: Parts::split(raw), s }
    }
    /// To a general register, the way by a vector is 2 to 4 cycles shorter than by a mask register. What isn't used is dropped.
    pub(crate) const BOTH: bool =
        Self::BITS && W::BYTES <= 32 && cfg!(all(target_arch = "x86_64", not(bun_simd_unoptimized)));
    const ALL: u64 = !0 >> (64usize.saturating_sub(Self::LANES) % 64);
    #[op]
    fn of_bits(s: S, bits: u64) -> Self {
        return_if!(!Self::BOTH, Self { parts: same(AsBits(bits)), s });
        let lanes = W::U8::splat(0);
        Self { parts: same(AsBoth { bits, in_lanes: false, lanes, opposite: false, whole: false, number: None }), s }
    }
    #[op]
    fn bits(self) -> u64 {
        choose! { Self::BOTH => self.both().bits, _ => same::<_, AsBits>(self.parts).0 }
    }
    #[inline(always)]
    fn both(self) -> AsBoth<W::U8> {
        same(self.parts)
    }
    #[on(X86)]
    #[op]
    pub(crate) fn also<U: Lane>(self, v: Simd<U, W, S>, opposite: bool, whole: bool) -> Self {
        Self { parts: same(AsBoth { in_lanes: true, lanes: v.bytes(), opposite, whole, ..self.both() }), s: self.s }
    }
    /// With the other ways of an equal mask.
    #[on(X86)]
    #[op]
    pub(crate) fn also_as(self, other: Self) -> Self {
        Self { parts: same(AsBoth { bits: self.bits(), ..other.both() }), s: self.s }
    }
    /// For bits from a general register.
    #[op]
    pub(crate) fn given(self) -> Self {
        choose! { Self::BOTH => Self { parts: same(AsBoth { number: Some(self.bits()), ..self.both() }), s: self.s }, _ => self }
    }
    /// The lanes, and whether they say the opposite.
    #[on(X86)]
    #[op]
    fn in_lanes(self, whole: bool) -> Option<(Simd<T, W, S>, bool)> {
        let it = self.both();
        let known = known(it.in_lanes & (it.whole | !whole)) & is_known!(it.opposite) & !is_known!(it.bits);
        known.then_some((Simd::<u8, W, S>::new(self.s, it.lanes).black_box().bitcast(), it.opposite))
    }
    #[on(X86)]
    #[op]
    pub(crate) fn whole(self) -> Option<Simd<T, W, S>> {
        let (v, opposite) = self.in_lanes(true)?;
        Some(if opposite { !v } else { v })
    }
    /// The bits, if they need no mask register.
    #[on(X86)]
    #[op]
    pub(crate) fn moved(self) -> Option<u64> {
        if known(self.both().number.is_some()) {
            return self.both().number;
        }
        let (v, opposite) = self.in_lanes(false)?;
        let bits = choose! {
            size_of::<T>() == 2 => self.s.extract(v.bytes().top_bits().to_bits(), 0xaaaa_aaaa) & Self::ALL,
            Self::LANES >= 8 => v.raw.top_bits().to_bits(),
            size_of::<T>() == 4 => self.s.sign_bits32_16(W::to16(v.bytes())),
            W::BYTES == 16 => self.s.sign_bits64_16(W::to16(v.bytes())),
            _ => self.s.sign_bits64_32(W::to32(v.bytes())),
        };
        Some(if opposite { (crate::regs::number(bits) as u32 ^ Self::ALL as u32) as u64 } else { bits })
    }
    /// For a general register. Words can have two bits, of which only the upper one counts unless `whole`.
    #[op]
    fn leaving(self, whole: bool) -> (u64, u32) {
        if_here!(crate::X86 && Self::BOTH && size_of::<T>() == 2, {
            if let Some((v, opposite)) = live!(Self::BOTH && size_of::<T>() == 2, self.in_lanes(whole)) {
                let bits = crate::regs::number(v.bytes().top_bits().to_bits()) as u32;
                return ((if opposite { bits ^ !0 >> (32 - W::BYTES) } else { bits }) as u64, 2);
            }
        });
        let _ = whole;
        (choose! { crate::X86 && Self::BOTH => self.moved().unwrap_or(self.own_bits()), _ => self.own_bits() }, 1)
    }
    /// Whether all lanes have this value.
    #[op]
    fn only(self, value: bool) -> bool {
        let (bits, per_lane) = self.leaving(false);
        if per_lane == 2 {
            return (if value { !bits } else { bits }) as u32 & 0xaaaa_aaaa >> (32 - W::BYTES.min(32)) == 0;
        }
        bits == if value { !0 >> (64 - Self::LANES) } else { 0 }
    }
    /// `crate::simd` goes through a vector of 8 lanes, which can have 64 bytes.
    #[on(X86)]
    #[op]
    fn few_bits(s: S, raw: MaskOf<T, W>) -> u64 {
        let v = Simd::<T, W, S>::new(s, Raw::from_mask(raw)).bytes();
        if const { size_of::<T>() == 4 } {
            s.sign_bits32_16(W::to16(v))
        } else if const { W::BYTES == 16 } {
            s.sign_bits64_16(W::to16(v))
        } else {
            s.sign_bits64_32(W::to32(v))
        }
    }
    /// From an intrinsic for floats.
    #[inline(always)]
    pub(crate) fn of_floats(s: S, raw: impl RawMask) -> Self {
        return_if!(crate::X86 && Self::OPAQUE && Self::LANES < 8, Self::of_bits(s, Self::few_bits(s, same(raw))));
        return_if!(Self::OPAQUE, Self::of_logic(s, same(raw)));
        Self::compared(s, raw)
    }
    /// From a comparison of lanes of another type of this size.
    #[inline(always)]
    pub(crate) fn compared(s: S, raw: impl RawMask) -> Self {
        return_if!(
            cfg!(bun_simd_unoptimized) && Self::BITS && Self::LANES >= 8 && !Self::OPAQUE,
            Self::of_bits(s, raw.to_bits())
        );
        Self::new(s, same(raw))
    }
    /// Whether the results of `|=` and the like stay vectors. LLVM would take booleans, and pack each comparison that meets them.
    const CARRIED: bool = crate::X86 && Self::VECTOR && W::BYTES >= 16 && size_of::<T>() > 1;
    /// Whether `none` and `all` look at a bit for each lane. With one for each byte, LLVM inverts each of the masks that are joined.
    const BY_LANES: bool = crate::X86 && Self::VECTOR && W::BYTES >= 16 && size_of::<T>() >= 4;
    /// For lanes whose size is the same, where the compiler can't see it.
    #[inline(always)]
    pub(crate) fn retype<U: Signed>(self) -> Mask<U, W, S> {
        same(self)
    }
    #[inline(always)]
    fn from_vector(v: Simd<T, W, S>) -> Self {
        Self { parts: same(AsVector(v.raw)), s: v.s }
    }
    /// For lanes that are 0 or -1.
    #[inline(always)]
    pub(crate) fn from_full<U: Lane>(v: Simd<U, W, S>) -> Self {
        apart!(v.s, {
            let v = v.bitcast::<T>();
            return_if!((S::VECTOR_MASKS || S::WASM) && Self::SPLIT, |v: Simd<T, W, S> = v| {
                let (lower, upper) = v.registers();
                Self::combine(Mask::from_full(upper), Mask::from_full(lower))
            });
            halves_if!(W::BYTES > 64, |v: Simd<T, W, S> = v| {
                let [lower, upper] = v.parts::<W>();
                Self::join(Mask::from_full(lower), Mask::from_full(upper))
            });
            choose! { Self::VECTOR => Self::from_vector(v), _ => v.to_mask() }
        })
    }
    #[op]
    pub(crate) fn from_bits(
        s: S, // Take from_bitmask.
        bits: u64,
    ) -> Self {
        return_if!(Self::BITS, Self::of_bits(s, bits & (!0 >> (64 - Self::LANES))));
        Self::new(s, RawMask::from_bits(bits))
    }
    /// For the lanes of another type of this size.
    #[inline(always)]
    pub(crate) fn raw_for<U: Lane>(self) -> MaskOf<U, W> {
        same(self.raw())
    }
    #[inline(always)]
    pub(crate) fn raw(self) -> MaskOf<T, W> {
        self.parts.join()
    }
    /// The same mask.
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
    #[op]
    fn beside(self, other: Self) -> Self {
        return_if!(crate::regs::MASKS && S::AVX512F && Self::BITS && Self::LANES > 8, |this: Self = self, other: Self = other| {
            let (bits, other) = (this.bits(), other.bits());
            let hidden = crate::regs::may_be_known(bits) && !is_known!(other);
            Self::of_bits(this.s, if hidden { crate::regs::some_lanes(bits, Self::LANES) } else { bits })
        });
        self
    }
    #[op]
    pub(crate) fn combine(hi: Mask<T, W::Half, S>, lo: Mask<T, W::Half, S>) -> Self {
        return_if!(Self::SPLIT, Self { parts: Parts::from_halves(lo.parts, hi.parts), s: lo.s });
        return_if!(!Self::SPLIT && Self::VECTOR, |hi: Mask<T, W::Half, S> = hi, lo: Mask<T, W::Half, S> = lo| {
            let (hi, lo) = (hi.to_vector(), lo.to_vector());
            // LLVM would shuffle booleans, one at a time.
            let (hi, lo) = choose! { W::BYTES < 16 => (hi.barrier(), lo.barrier()), _ => (hi, lo) };
            Self::from_vector(Tag::new(lo.s).combine(hi, lo))
        });
        live!(!Self::SPLIT && !Self::VECTOR, Self::new(lo.s, lo.raw().convert::<_, { p::PART }, 0, _>(hi.raw())))
    }
    #[op]
    pub(crate) fn narrow_from<U: Signed>(a: Mask<U, W, S>, b: Mask<U, W, S>) -> Self {
        halves_if!(W::BYTES > 64, |a: Mask<U, W, S> = a, b: Mask<U, W, S> = b| {
            let ([a0, a1], [b0, b1]) = (a.parts::<W>(), b.parts::<W>());
            Self::join(Mask::narrow_from(a0, a1), Mask::narrow_from(b0, b1))
        });
        return_if!(Self::VECTOR && (W::BYTES < 16 || S::WASM && size_of::<U>() == 8), {
            let (a, b) = (a.to_vector().barrier(), b.to_vector().barrier());
            Self::from_vector(Tag::new(a.s).concat_even(b.reinterpret(), a.reinterpret()))
        });
        return_if!(S::WASM && W::BYTES == 16, |a: Mask<U, W, S> = a, b: Mask<U, W, S> = b| {
            Self::from_vector(a.to_vector().with_bytes(a.s.pack_i16_i8::<W>(a.bytes(), b.bytes())))
        });
        Self::new(a.s, a.raw().convert::<_, { p::PART }, 0, _>(b.raw()))
    }
    /// LLVM would narrow the lanes, and widen them again.
    #[op]
    pub(crate) fn to_move(self) -> Simd<T, W, S> {
        choose! { S::AVX2 => self.whole_lanes(), _ => self }.to_vector()
    }
    #[op]
    fn bytes(self) -> W::U8 {
        self.to_vector().raw.to_native()
    }
    /// For lanes of 4 or 8 bytes in two registers or more. All bits of a lane are the same, so saturation keeps them.
    #[on(X86 WASM)]
    #[op]
    fn packed(self) -> Mask<<<T::Unsigned as Int>::Narrow as Lane>::Signed, W::Half, S> {
        halves_if!(W::BYTES > 2 * S::REGISTER, |this: Self = self| Mask::combine(this.upper_half().packed(), this.lower_half().packed()));
        return_if!(S::WASM && W::BYTES <= 32, Mask::narrow_from(self.lower_half(), self.upper_half()));
        return_if!(size_of::<T>() == 2 && W::BYTES <= 2 * S::REGISTER, |this: Self = self| {
            let (lower, upper) = (this.lower_half().to_vector().bitcast::<i16>(), this.upper_half().to_vector().bitcast::<i16>());
            Mask::from_full(lower.saturating_narrow::<i8>(upper))
        });
        live!(size_of::<T>() != 2 && W::BYTES <= 2 * S::REGISTER, {
            let (lower, upper) = (
                self.lower_half().to_vector().barrier().bitcast::<i32>(),
                self.upper_half().to_vector().barrier().bitcast::<i32>(),
            );
            Mask::from_full(lower.saturating_narrow::<i16>(upper))
        })
    }
    /// In lanes of half the size.
    #[on(ARM)]
    #[op]
    fn narrowed(self) -> Simd<<T::Unsigned as Int>::Narrow, W::Half, S> {
        let (lower, upper) = (self.lower_half().to_vector().reinterpret(), self.upper_half().to_vector().reinterpret());
        Tag::new(self.s).concat_even(upper, lower)
    }
    /// The order of the bytes in a lane doesn't matter.
    #[op]
    fn block(self) -> u8x16 {
        W::to16(self.to_vector().raw.to_native())
    }
    /// The same number of bits for each lane, and that number.
    #[op]
    pub(crate) fn wide_bits(self) -> (u64, u32) {
        choose! { |this: Self = self|
            S::ARM && W::BYTES == 16 => (nibbles(W::to16(this.bytes())), T::BITS / 2),
            S::A64 && Self::SPLIT && W::BYTES <= 64 && size_of::<T>() > 1 => apart!(this.s, this.narrowed().full_mask().wide_bits()),
            S::A64 && W::BYTES == 32 => {
                let (a, b) = (W::to32(this.bytes()).extract::<0, 16>(), W::to32(this.bytes()).extract::<16, 16>());
                let part = always!(|v: u8x16| Simd::<u8, crate::B16, S>::new(this.s, v & u16x8::splat(0xcc33).to_le_bytes()));
                (nibbles(part(a).pairwise_add128(part(b)).raw), 2u32)
            },
            (S::ARM || S::WASM) && W::BYTES < 16 => (u64::from_le_bytes(crate::raw::copy::to_array(W::to16(this.bytes()).resize::<8>())) & (!0 >> (64 - 8 * W::BYTES.min(8))), T::BITS),
            !S::ARM && !S::WASM && !S::SCALAR && S::REGISTER < 64 && W::BYTES <= S::REGISTER && size_of::<T>() == 2 => (this.byte_bits(), 2u32),
            crate::X86 && Self::IS_BITS => this.leaving(true),
            S::A64 && W::BYTES == 64 && size_of::<T>() == 1 => (this.bits_by_sums(), 1u32),
            _ => (this.to_bitmask(), 1u32),
        }
    }
    /// Changes all bits of a mask of up to 8 bytes.
    #[op]
    pub(crate) fn as_number(self, change: impl FnOnce(u64) -> u64) -> Self {
        let d = self.s.fixed::<u64, crate::B8>();
        Self::from_full(self.tag().resize_bitcast(d.set(change(d.resize_bitcast(self.to_vector()).get_lane()))))
    }
    /// One bit for each byte.
    #[op]
    fn byte_bits(self) -> u64 {
        choose! { W::BYTES < 16 => W::to16(self.bytes()).top_bits().to_bits() & ((1 << W::BYTES) - 1), _ => self.bytes().top_bits().to_bits() }
    }
    const BY_DOT: bool =
        crate::OPTIMIZED && !Self::BY_MATRIX && S::A64 && S::HAS_DOT && W::BYTES == 16 && size_of::<T>() == 1;
    /// From bit 0 and from bit 32.
    #[on(A64)]
    #[op]
    fn bits_of_halves(self) -> u64 {
        let d = self.tag().repartition::<i8>();
        let sums = self.to_vector().bitcast::<i8>().sum_of_mul_quad_accumulate(
            d.dup128([-1, -2, -4, -8, -16, -32, -64, -128, -1, -2, -4, -8, -16, -32, -64, -128]),
            d.repartition().zero(),
        );
        sums.pairwise_add128(sums).bitcast::<u64>().get_lane()
    }
    /// Where the bytes that are kept come from, and how many lanes they are. All that use a mask share this.
    #[on(SVE2)]
    #[op]
    pub(crate) fn moves(self) -> (Simd<u8, W, S>, usize) {
        let (moves, count) = self.s.compact(u8x16::iota(), self.block(), size_of::<T>());
        (Simd::new(self.s, W::from16(moves)), count)
    }
    /// Of 32 or 64 bytes.
    #[on(ARM)]
    #[op]
    fn bits_by_sums(self) -> u64 {
        apart!({
            let weights =
                crate::raw::copy::from_array::<u8, 16>([1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]);
            let all: u8x64 = W::to64(self.bytes()) & weights.shuffle::<u8x64, { p::REPEAT }, 0>(weights);
            let pairs = |a: u8x16, b: u8x16| -> u8x16 {
                a.shuffle::<u8x16, { p::STRIDE }, 0>(b) + a.shuffle::<u8x16, { p::STRIDE }, 1>(b)
            };
            let low = pairs(all.extract::<0, 16>(), all.extract::<16, 16>());
            let high =
                if const { W::BYTES == 64 } { pairs(all.extract::<32, 16>(), all.extract::<48, 16>()) } else { low };
            let quads = pairs(low, high);
            let bits = u64::from_le_bytes(crate::raw::copy::to_array(u8x16::resize::<8>(pairs(quads, quads))));
            if const { W::BYTES == 64 } { bits } else { bits as u32 as u64 }
        })
    }
    /// The or of all blocks.
    #[on(ARM)]
    #[op]
    fn any_block(self) -> u8x16 {
        let mut v = self.bytes();
        when!(W::BYTES > 32, v = v.or(v.shuffle::<_, { p::SLIDE_DOWN }, 32>(v)));
        when!(W::BYTES > 16, v = v.or(v.shuffle::<_, { p::SLIDE_DOWN }, 16>(v)));
        W::to16(v)
    }

    /// The tag of the vectors that this mask is for.
    #[inline(always)]
    pub(crate) fn tag(self) -> Tag<S, T, W> {
        Tag::new(self.s)
    }
    /// Bit `i` is lane `i`. It doesn't build for more than 64 lanes. NEON has no such instruction: [`first_set`](Self::first_set), [`iter`](Self::iter) and the like are shorter there.
    /// With AVX-512 the bits leave the mask register: [`compress_store`](Simd::compress_store) takes the mask itself. `BitsFromMask`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from(b"a,,b").simd_eq(b',').to_bitmask(), 0b0110);
    /// # } example()
    /// ```
    #[doc(alias("bits_from_mask", "movemask", "move_mask", "store_mask_bits", "BitsFromMask", "bitmap"))]
    #[op]
    #[track_caller]
    pub fn to_bitmask(self) -> u64 {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        return_if!(S::AVX2 && Self::SPLIT && !Self::IS_BITS && S::REGISTER == 32 && size_of::<T>() == 4 && W::BYTES >= 128, |this: Self = self| {
            this.whole_lanes().to_vector().saturating_cast::<i8>().to_mask().to_bitmask()
        });
        halves_if!((S::SSE2 || S::WASM) && Self::SPLIT && size_of::<T>() >= 2 && (S::REGISTER == 16 || S::REGISTER == 32 && W::BYTES > 64), |this: Self = self| this.packed().to_bitmask());
        if_here!(crate::X86 && Self::BOTH, {
            if let Some(bits) = live!(Self::BOTH, self.moved()) {
                return crate::regs::number(bits) & Self::ALL;
            }
        });
        // Or LLVM takes what is computed with the bits of several masks to vector registers.
        return_if!(
            crate::X86 && Self::IS_BITS,
            choose! { cfg!(target_arch = "x86") => crate::regs::word(self.own_bits()), _ => crate::regs::number(self.own_bits()) }
                & !0 >> (64 - Self::LANES)
        );
        let bits = self.whole_lanes().own_bits();
        choose! { cfg!(target_feature = "avx512f") => crate::regs::word(bits) & !0 >> (64 - Self::LANES), _ => bits }
    }
    /// With AVX-512, a constant for lanes of up to 2 bytes (`SMALL`) or of more stays a mask, which the instruction before takes for nothing. LLVM would add an `and` or a shuffle.
    #[op]
    pub(crate) fn in_register<const SMALL: bool>(self) -> Self {
        return_if!(crate::X86 && crate::OPTIMIZED && Self::BITS && W::BYTES == 64 && (size_of::<T>() <= 2) == SMALL, |this: Self = self| {
            let bits = this.own_bits();
            let known = is_known!(bits) & (bits != 0) & (bits != !0 >> (64 - Self::LANES));
            Self::from_bits(this.s, core::hint::select_unpredictable(known, this.to_vector().black_box().to_mask().own_bits(), bits))
        });
        self
    }
    /// On x86, LLVM would test the signs of the operands of `&` apart, also before a branch, and pack them.
    #[op]
    pub(crate) fn whole_lanes(self) -> Self {
        halves_if!(crate::X86 && Self::SPLIT && !Self::IS_BITS && size_of::<T>() >= 4, |this: Self = self| Self::combine(this.upper_half().whole_lanes(), this.lower_half().whole_lanes()));
        choose! { Self::CARRIED && size_of::<T>() >= 4 => Self::from_vector(self.to_vector().barrier()), _ => self }
    }
    /// It takes longer on the CPUs of Apple.
    const BY_MATRIX: bool = crate::OPTIMIZED && S::HAS_MAT_MUL && !cfg!(target_vendor = "apple");
    const TALLIED: bool = S::A64 && !S::SVE2 && W::BYTES == 16 && T::BITS >= 16 && Self::LANES >= 4;
    /// The bits, and 256 times their count: `compress` and `count` of one mask share the sum.
    #[op]
    fn tallied(self) -> u64 {
        let d = Tag::<S, T::Unsigned, W>::new(self.s);
        let (lanes, of) = (RawOf::<T::Unsigned, W>::iota(), |value| d.set(Lane::from_usize(value)).raw);
        (d.resize_any(self.to_vector()) & Simd::new(self.s, Raw::or(of(1).shl(lanes), of(256)))).reduce_sum().to_u64()
    }
    #[op]
    #[track_caller]
    pub(crate) fn own_bits(self) -> u64 {
        require!("a `u64` has no bit for each of more than 64 lanes", Self::LANES <= 64);
        if const { Self::BITS } {
            return if cfg!(target_arch = "x86") { crate::regs::word(self.bits()) } else { self.bits() };
        }
        apart_unoptimized!(self.s, {
            // Products of -1 and minus the weight, summed by 8 or by 4.
            return_if!(S::A64 && Self::BY_MATRIX && W::BYTES >= 16 && size_of::<T>() == 1, |this: Self = self| {
                let (all, of) = (W::to64(this.bytes()), crate::raw::copy::from_array::<u8, 16>);
                let (lower, upper) = (of([255, 254, 252, 248, 240, 224, 192, 128, 0, 0, 0, 0, 0, 0, 0, 0]), of([0, 0, 0, 0, 0, 0, 0, 0, 255, 254, 252, 248, 240, 224, 192, 128]));
                let one = always!(|a| this.s.mat_mul_i8_i8_16(a, lower, u8x16::splat(0)));
                let two = always!(|a, b| this.s.mat_mul_i8_i8_16(b, upper, one(a)));
                let d = this.s.fixed::<u8, crate::B16>();
                let low = d.wrap(if const { W::BYTES == 16 } { one(all.extract::<0, 16>()) } else { two(all.extract::<0, 16>(), all.extract::<16, 16>()) });
                let at = d.wrap(of([0, 8, 4, 12, 16, 24, 20, 28, 1, 1, 1, 1, 1, 1, 1, 1])).barrier();
                let bits = if const { W::BYTES == 64 } { low.two_tables_lookup_bytes(d.wrap(two(all.extract::<32, 16>(), all.extract::<48, 16>())), at) } else { low.table_lookup_bytes(at) };
                bits.bitcast::<u64>().get_lane() & !0u64 >> (64 - Self::LANES)
            });
            return_if!(S::A64 && Self::BY_DOT, |this: Self = self| {
                let both = this.bits_of_halves();
                both & 255 | both >> 24 & 0xff00
            });
            // A byte of each in a lane, and one sum for both.
            return_if!(S::A64 && W::BYTES == 32 && size_of::<T>() == 2, |this: Self = self| {
                let (lower, upper) = (this.lower_half().to_vector().bitcast::<u8>(), this.upper_half().to_vector().bitcast::<u8>());
                let both = lower.interleave_even(upper).bitcast::<u16>();
                (both & both.tag().from_fn(#[inline(always)] |i| 0x0101 << (i % 8))).reduce_sum() as u64
            });
            return_if!(S::A64 && W::BYTES == 16 && size_of::<T>() == 1, |this: Self = self| {
                let v = this.to_vector().bitcast::<u8>();
                let v = v & v.tag().from_fn(#[inline(always)] |i| 1 << (i % 8));
                let v = v.pairwise_add128(v);
                let v = v.pairwise_add128(v);
                v.pairwise_add128(v).bitcast::<u16>().get_lane() as u64
            });
            return_if!(S::ARM && W::BYTES >= 32 && size_of::<T>() == 1, self.bits_by_sums());
            halves_if!(S::ARM && Self::SPLIT && size_of::<T>() > 1, |this: Self = self| {
                let narrow = this.narrowed();
                if const { W::BYTES > 32 } { narrow.full_mask().to_bitmask() } else { Mask::from_vector(narrow.cast_signed()).to_bitmask() }
            });
            // LLVM takes these through the stack.
            return_if!(S::ARM && Self::LANES == 1, |this: Self = self| this.wide_bits().0 & 1);
            return_if!(Self::TALLIED && !Self::SPLIT && Self::LANES > 1, |this: Self = self| this.tallied() & 255);
            return_if!(S::ARM && Self::LANES <= 8 && Self::LANES > 1 && !Self::SPLIT && !Self::TALLIED, |this: Self = self| {
                let d = Tag::<S, T::Unsigned, W::Register>::new(this.s);
                let (lanes, of) = (RawOf::<T::Unsigned, W::Register>::iota(), |value| d.set(Lane::from_usize(value)).raw);
                let weights = Simd::new(this.s, Raw::select(lanes.lt(of(Self::LANES)), of(1).shl(lanes), of(0)));
                (d.resize_any(this.to_vector()) & weights).reduce_sum().to_u64()
            });
            if_here!(S::WASM && W::BYTES <= 16, {
                let bits = self.s.mask_bits_16(self.block(), size_of::<T>());
                return if const { W::BYTES < 16 } { bits & ((1 << Self::LANES) - 1) } else { bits };
            });
            match (size_of::<T>(), W::BYTES) {
                _ if S::REGISTER == 64 || S::SCALAR => {}
                (4, ..=16) => {
                    return self.s.sign_bits32_16(W::to16(self.to_vector().bytes())) & ((1 << Self::LANES) - 1);
                }
                (8, ..=16) => {
                    return self.s.sign_bits64_16(W::to16(self.to_vector().bytes())) & ((1 << Self::LANES) - 1);
                }
                (8, 32) if !Self::SPLIT => return self.s.sign_bits64_32(W::to32(self.to_vector().bytes())),
                _ => {}
            }
            // It would join four integers in a vector.
            return_if!(crate::X86 && Self::IS_BITS && W::BYTES > 128, self.raw().to_bits());
            // Not apart: mask registers would be joined as integers.
            return_if!(Self::SPLIT && !S::ARM, |this: Self = self| {
                let (lower, upper) = (this.lower_half().own_bits(), this.upper_half().own_bits());
                if const { S::REGISTER == 32 && Self::LANES == 64 } {
                    // It would join these halves again.
                    let lower = if const { size_of::<T>() == 2 } { crate::regs::number(lower) } else { lower };
                    return if cfg!(target_arch = "x86_64") { lower | crate::regs::number(upper) << 32 } else { (lower << 32 | upper).rotate_left(32) };
                }
                if_here!(crate::X86 && S::REGISTER == 16 && Self::LANES == 32, {
                    // Or it joins the booleans of all registers, and moves them one by one if some are from before a branch.
                    return lower | ((crate::regs::number(upper) as u32) << 16) as u64;
                });
                if_here!(crate::X86 && S::REGISTER == 32 && size_of::<T>() >= 4, {
                    return lower | (crate::regs::number(upper) & !0 >> (64 - Self::LANES / 2)) << (Self::LANES / 2);
                });
                lower | upper << (Self::LANES / 2)
            });
            if const { !S::ARM && !S::SCALAR && S::REGISTER < 64 && W::BYTES < 16 && size_of::<T>() == 1 } {
                return self.byte_bits();
            }
            self.raw().to_bits()
        })
    }
    /// Whether no lane is true.
    #[doc(alias("AllFalse"))]
    #[op]
    pub fn none(self) -> bool {
        choose! { |this: Self = self|
            Self::BITS => this.only(false),
            W::BYTES > 64 => (this.lower_half() | this.upper_half()).none(),
            S::SVE2 && W::BYTES >= 16 => this.s.mask_none_16(this.any_block()),
            S::ARM && W::BYTES > 16 => nibbles(this.any_block()) == 0,
            S::ARM => this.wide_bits().0 == 0,
            Self::SPLIT => (this.lower_half() | this.upper_half()).none(),
            S::WASM && W::BYTES == 16 => !this.raw().any(),
            S::WASM => this.wide_bits().0 == 0,
            Self::BY_LANES => this.own_bits() == 0,
            S::REGISTER < 64 && !S::SCALAR => this.byte_bits() == 0,
            _ => !this.raw().any(),
        }
    }
    /// Whether every lane is true.
    #[doc(alias("AllTrue"))]
    #[op]
    pub fn all(self) -> bool {
        choose! { |this: Self = self|
            Self::BITS => this.only(true),
            Self::SPLIT => (this.lower_half() & this.upper_half()).all(),
            S::WASM && W::BYTES == 16 => this.raw().all(),
            S::WASM => this.wide_bits().0 == !0 >> (64 - 8 * W::BYTES.min(8)),
            S::SVE2 && W::BYTES == 16 => this.s.mask_all_16(this.block()),
            S::ARM && W::BYTES >= 8 => this.wide_bits().0 == !0,
            S::ARM => (!this).none(),
            Self::BY_LANES => this.own_bits() == !0 >> (64 - Self::LANES),
            S::REGISTER < 64 && !S::SCALAR && !crate::simd::ARRAYS => this.byte_bits() == !0 >> (64 - W::BYTES),
            _ => this.raw().all(),
        }
    }
    /// Whether one lane or more is true.
    #[doc(alias("AnyTrue"))]
    #[op]
    pub fn any(self) -> bool {
        !self.none()
    }
    /// The number of lanes that are true. For a whole slice, [`Over::count`](crate::Over::count) is faster than a sum of these from 1 KiB on. With AVX-512 that took 0.7 to 1.7 times as long.
    #[doc(alias("count_ones", "CountTrue", "popcount"))]
    #[op]
    pub fn count(self) -> usize {
        halves_if!(Self::LANES > 64, |this: Self = self| {
            let [lower, upper] = this.parts::<W>();
            lower.count() + upper.count()
        });
        return_if!(
            S::SCALAR,
            crate::Int::to_u64((self.to_vector().cast_unsigned() >> (T::BITS - 1)).raw.reduce_sum()) as usize
        );
        return_if!(S::NO_POPCNT && Self::LANES > 8, |this: Self = self| {
            let [lower, upper] = crate::simd::u64x2::from_le_bytes(this.s.sums_of_8_abs_diff_16(this.tally(), u8x16::splat(0))).to_array();
            (lower + upper) as usize / size_of::<T>()
        });
        return_if!(S::NO_POPCNT, |this: Self = self| crate::ops::count_bits_on::<S>(this.own_bits(), Self::LANES));
        return_if!(S::SVE2 && W::BYTES == 16 && T::BITS >= 32, self.moves().1);
        halves_if!(S::AVX2 && Self::SPLIT && !Self::IS_BITS && S::REGISTER == 32 && size_of::<T>() >= 2, |this: Self = self| {
            // In any order.
            let (lower, upper) = (this.lower_half().to_vector().bitcast::<i16>(), this.upper_half().to_vector().bitcast::<i16>());
            Mask::<<<T::Unsigned as Int>::Narrow as Lane>::Signed, W::Half, S>::from_full(lower.in_blocks().saturating_narrow::<i8>(upper)).count()
        });
        return_if!(S::SVE2 && W::BYTES == 16, self.s.count_lanes(self.block(), size_of::<T>()));
        return_if!(Self::TALLIED, |this: Self = self| (this.tallied() >> 8) as usize);
        halves_if!(S::A64 && !S::SVE2 && W::BYTES == 32 && T::BITS >= 32, |this: Self = self| Mask::from_vector(this.narrowed().cast_signed()).count());
        choose! {
            S::ARM => {
                let sum = RawOf::<T::Signed, W>::from_native(self.bytes()).reduce_sum();
                crate::Int::to_u64(sum).wrapping_neg() as u8 as usize
            },
            // It tends to go with `compress`, which needs the mask register.
            crate::X86 && Self::BOTH => (if known(self.both().number.is_some()) { self.to_bitmask() } else { self.own_bits() }).count_ones() as usize,
            _ => {
                let (bits, per_lane) = self.wide_bits();
                (bits.count_ones() / per_lane) as usize
            },
        }
    }
    /// The index of the first lane that is true.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let m = u8x8::from(b"a b c d ").simd_eq(b' ');
    /// assert_eq!((m.first_set(), m.last_set(), m.count()), (Some(1), Some(7), 4));
    /// # } example()
    /// ```
    #[doc(alias("first_true", "FindFirstTrue"))]
    #[op]
    pub fn first_set(self) -> Option<usize> {
        halves_if!(Self::LANES > 64, |this: Self = self| {
            let at = this.count_before_first();
            (at < Self::LANES).then_some(at)
        });
        let (bits, per_lane) = self.wide_bits();
        (bits != 0).then(|| (bits.trailing_zeros() / per_lane) as usize)
    }
    /// The index of the last lane that is true.
    #[doc(alias("last_true", "FindLastTrue"))]
    #[op]
    pub fn last_set(self) -> Option<usize> {
        halves_if!(Self::LANES > 64, |this: Self = self| {
            let [lower, upper] = this.parts::<W>();
            if let Some(at) = upper.last_set() { Some(at + Self::LANES / 2) } else { lower.last_set() }
        });
        let (bits, per_lane) = self.wide_bits();
        if_here!(S::LZCNT && !S::AVX512F, {
            // If it knows that a bit is set, LLVM chooses `bsr`, which is slow before Zen 4.
            let at = !crate::regs::number(bits).leading_zeros() & (Self::LANES as u32 * per_lane - 1);
            return (bits != 0).then_some((at / per_lane) as usize);
        });
        core::num::NonZero::new(bits).map(|bits| (bits.ilog2() / per_lane) as usize)
    }
    /// The indices of the lanes that are true, in ascending order. It doesn't build for more than 64 lanes.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert!(mask8x8::from_bitmask(0b1001_0010).iter().eq([1, 4, 7]));
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("indices"))]
    pub fn iter(self) -> impl Iterator<Item = usize> {
        let (bits, per_lane) = self.wide_bits();
        let mut bits = bits & (!0 / (!0 >> (64 - per_lane)));
        core::iter::from_fn(
            #[inline(always)]
            move || {
                let lane = (bits != 0).then(|| (bits.trailing_zeros() / per_lane) as usize);
                bits &= bits.wrapping_sub(1);
                lane
            },
        )
    }
    /// The number of lanes before the first one that is true, from lane 0 on: `first_set().unwrap_or(LANES)` without a branch. From the end, there is [`last_set`](Self::last_set).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(mask8x8::from_bitmask(0b0100).count_before_first(), 2);
    /// assert_eq!(mask8x8::splat(false).count_before_first(), 8);
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("trailing_zeros", "leading_unset", "tzcnt", "skip_while"))]
    pub fn count_before_first(self) -> usize {
        halves_if!(Self::LANES > 64, |this: Self = self| {
            let [lower, upper] = this.parts::<W>();
            let at = lower.count_before_first();
            if at < Self::LANES / 2 { at } else { at + upper.count_before_first() }
        });
        return_if!(S::SVE2 && W::BYTES == 16, self.s.leading_lanes(self.block(), size_of::<T>()));
        let (bits, per_lane) = self.wide_bits();
        let end = Self::LANES as u32 * per_lane;
        if end <= 16 {
            // LLVM can make a branch of `min`.
            return ((bits | 1 << end).trailing_zeros() / per_lane) as usize;
        }
        if end == 32 && S::BMI1 {
            return ((bits as u32).trailing_zeros() / per_lane) as usize;
        }
        ((bits.trailing_zeros() / per_lane) as usize).min(Self::LANES)
    }
    pub(crate) const BREAKS: bool = S::SVE2 && W::BYTES == 16 && Self::LANES > 2;
    #[on(BREAKS)]
    #[op]
    pub(crate) fn up_to_first(self, with: bool) -> Self {
        Self::from_full(Simd::<T, W, S>::new(
            self.s,
            Bits::from_native(W::from16(self.s.up_to_first(self.block(), size_of::<T>(), with))),
        ))
    }
    /// The sum of these is the number of bytes that are set.
    #[on(X86)]
    #[op]
    fn tally(self) -> u8x16 {
        halves_if!(Self::SPLIT, |this: Self = self| this.lower_half().tally() + this.upper_half().tally());
        let ones = const {
            let (mut ones, mut i) = ([0; 16], 0);
            while i < 16 {
                ones[i] = (i < W::BYTES) as u8;
                i += 1;
            }
            u8x16::from_array(ones)
        };
        self.block() & ones
    }
    /// All bits are set in the lanes that are true. `VecFromMask`.
    #[op]
    pub(crate) fn to_vector(self) -> Simd<T, W, S> {
        // LLVM would pack the booleans of both registers, and widen them again.
        return_if!(crate::X86 && !Self::IS_BITS && W::BYTES == 2 * S::REGISTER && size_of::<T>() >= 4, |this: Self = self| {
            this.tag().combine(this.upper_half().whole_lanes().to_vector(), this.lower_half().whole_lanes().to_vector())
        });
        return_if!(S::SSE41 && !Self::IS_BITS && W::BYTES == 2 * S::REGISTER && size_of::<T>() == 2, |this: Self = self| {
            this.tag().combine(this.upper_half().to_vector().barrier_unless_known(), this.lower_half().to_vector().barrier_unless_known())
        });
        halves_if!(Self::SPLIT, |this: Self = self| this.tag().combine(this.upper_half().to_vector(), this.lower_half().to_vector()));
        return_if!(Self::VECTOR, Simd::new(self.s, same::<_, AsVector<_>>(self.parts).0));
        Simd::new(self.s, Raw::from_mask(self.raw()))
    }
    /// The same, for a comparison that has no other use.
    #[op]
    pub(crate) fn into_vector(self) -> Simd<T, W, S> {
        choose! { crate::X86 && Self::BOTH => self.whole().unwrap_or(self.to_vector()), _ => self.to_vector() }
    }
    /// `!self & other`.
    #[op]
    pub(crate) fn and_not(
        self, // Take !a & b.
        other: Self,
    ) -> Self {
        !self & other
    }
    /// True only in the first lane that is true.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let m = mask8x8::from_bitmask(0b0110_0100);
    /// assert_eq!(m.only_first().to_bitmask(), 0b0000_0100);
    /// assert_eq!(m.before_first().to_bitmask(), 0b0000_0011);
    /// assert_eq!(m.through_first().to_bitmask(), 0b0000_0111);
    /// assert_eq!(m.from_first().to_bitmask(), 0b1111_1100);
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("SetOnlyFirst"))]
    pub fn only_first(self) -> Self {
        return_if!(Self::BREAKS, self.up_to_first(true) & self);
        return_if!(Self::SPREADS && W::BYTES == 16 && size_of::<T>() < 8, {
            // `x & -x` is the lowest bit, which is a one in its lane.
            let x = self.to_vector().bitcast::<i64>();
            let first = -(x & -x).bitcast::<T>();
            Self::from_full(first & x.shift_left_lanes::<1>().simd_eq(0).to_vector().bitcast())
        });
        return_if!(Self::SPREADS, {
            let from = self.from_first();
            from ^ from.slide_up::<1>()
        });
        halves_if!(Self::LANES > 64, |this: Self = self| {
            this.through_first() & this
        });
        return_if!(S::REGISTER < 64, {
            let d = self.tag().to_unsigned();
            d.iota(Lane::from_usize(0)).simd_eq(d.set(Lane::from_usize(self.count_before_first()))).retype()
        });
        let bits = self.own_bits();
        self.tag().mask_from_bits(bits.isolate_lowest_one())
    }
    /// True in the lanes before the first one that is true, which can be all.
    #[op]
    #[doc(alias("SetBeforeFirst"))]
    pub fn before_first(self) -> Self {
        return_if!(Self::BREAKS, self.up_to_first(false));
        return_if!(Self::SPREADS, !self.from_first());
        return_if!(S::REGISTER < 64 || Self::LANES > 64, self.tag().first_n(self.count_before_first()));
        let bits = self.own_bits();
        self.tag().mask_from_bits(!bits & bits.wrapping_sub(1))
    }
    /// Where LLVM would take `yes ^ no` out of `bsl`.
    #[on(A64)]
    #[op]
    pub(crate) fn either<U: Lane<Signed = T>>(self, yes: Simd<U, W, S>, no: Simd<U, W, S>) -> Simd<U, W, S> {
        let (d, m) = (yes.tag(), self.to_simd::<U>());
        d.opaque((m & d.opaque(yes.raw) | m.and_not(d.opaque(no.raw))).raw)
    }
    /// The lanes of `yes` where the mask is true, and those of `no` elsewhere.
    #[op]
    pub(crate) fn if_then_else<U: Lane<Signed = T>>(
        self,
        yes: impl Operand<U, W, S>,
        no: impl Operand<U, W, S>,
    ) -> Simd<U, W, S> {
        let (yes, no) = (yes.vector(Tag::new(self.s)), no.vector(Tag::new(self.s)));
        halves_if!(Self::SPLIT, |m: Self = self, yes: Simd<U, W, S> = yes, no: Simd<U, W, S> = no| {
            // The halves that a comparison takes.
            if const { crate::X86 && U::IS_FLOAT && W::BYTES == 2 * S::REGISTER }
                && !are_known!(yes.raw)
                && !are_known!(no.raw)
            {
                let ((yes0, yes1), (no0, no1)) = (yes.registers(), no.registers());
                return yes.tag().combine(m.upper_half().if_then_else(yes1, no1), m.lower_half().if_then_else(yes0, no0));
            }
            let lower = m.lower_half().if_then_else(yes.lower_half(), no.lower_half());
            let upper = m.upper_half().if_then_else(yes.upper_half(), no.upper_half());
            // LLVM would join some parts of `bsl` across the halves, and not others.
            return_if!(S::A64, yes.tag().combine(upper.barrier(), lower.barrier()));
            yes.tag().combine(upper, lower)
        });
        // With a constant in sight, LLVM makes three instructions of `bsl`.
        return_if!(S::ARM && Self::VECTOR, |m: Self = self, yes: Simd<U, W, S> = yes, no: Simd<U, W, S> = no| m.to_simd::<U>().bit_select(yes.barrier(), no.barrier()));
        return_if!(
            (Self::VECTOR && size_of::<T>() == 2 && !S::WASM || crate::X86 && Self::LANES == 1) && !S::SCALAR,
            {
                // For one lane, LLVM would branch.
                Simd::<u8, W, S>::new(
                    self.s,
                    Raw::select(self.bytes().top_bits(), yes.raw.to_native(), no.raw.to_native()),
                )
                .reinterpret()
            }
        );
        // LLVM doesn't see that a comparison of floats sets all bits.
        return_if!(S::SSE2 && !S::SSE41 && Self::VECTOR && U::IS_FLOAT && size_of::<T>() == 4, {
            let m = self.to_simd::<U>();
            m & yes | m.and_not(no)
        });
        Simd::new(self.s, Raw::select(self.raw_for::<U>(), yes.raw, no.raw))
    }
    /// The same, but not by halves for integers in two registers of AVX2: LLVM would keep those of a loop's variable next to the whole.
    #[op]
    pub(crate) fn if_then_else_whole<U: Lane<Signed = T>>(
        self,
        yes: impl Operand<U, W, S>,
        no: impl Operand<U, W, S>,
    ) -> Simd<U, W, S> {
        if_here!(
            S::A64 && crate::OPTIMIZED,
            if Operand::number(yes).is_some() && Operand::number(no).is_some() {
                return self.either(yes.vector(Tag::new(self.s)), no.vector(Tag::new(self.s)));
            }
        );
        let (yes, no) = (yes.vector(Tag::new(self.s)), no.vector(Tag::new(self.s)));
        choose! { |m: Self = self, yes: Simd<U, W, S> = yes, no: Simd<U, W, S> = no|
            S::AVX2 && !Self::IS_BITS && W::BYTES == 2 * S::REGISTER && size_of::<T>() >= 4 && !U::IS_FLOAT =>
                Simd::new(m.s, Raw::select(same(m.to_vector().raw.top_bits()), yes.raw, no.raw)),
            _ => m.if_then_else(yes, no),
        }
    }
    /// The lanes of `yes` where the mask is true, and zero elsewhere.
    #[op]
    pub(crate) fn if_then_else_zero<U: Lane<Signed = T>>(self, yes: impl Operand<U, W, S>) -> Simd<U, W, S> {
        return_if!(S::REGISTER < 64, self.to_simd::<U>() & yes.vector(Tag::new(self.s)));
        self.if_then_else(yes, Tag::new(self.s).zero())
    }
    /// Zero where the mask is true, and the lanes of `no` elsewhere.
    #[op]
    pub(crate) fn if_then_zero_else<U: Lane<Signed = T>>(self, no: impl Operand<U, W, S>) -> Simd<U, W, S> {
        return_if!(S::REGISTER < 64, self.to_simd::<U>().and_not(no.vector(Tag::new(self.s))));
        self.if_then_else(Tag::new(self.s).zero(), no)
    }
    /// The first half of the lanes.
    #[op]
    pub(crate) fn lower_half(self, // Take split.
    ) -> Mask<T, W::Half, S> {
        return_if!(Self::SPLIT, Mask { parts: self.parts.halves().0, s: self.s });
        return_if!(!Self::SPLIT && Self::VECTOR, |this: Self = self| Mask::from_vector(this.to_vector().barrier().lower_half()));
        live!(!Self::SPLIT && !Self::VECTOR, Mask::new(self.s, self.raw().convert::<_, { p::PART }, 0, _>(self.raw())))
    }
    /// The second half of the lanes.
    #[op]
    pub(crate) fn upper_half(self, // Take split.
    ) -> Mask<T, W::Half, S> {
        return_if!(Self::SPLIT, Mask { parts: self.parts.halves().1, s: self.s });
        return_if!(!Self::SPLIT && Self::VECTOR, |this: Self = self| Mask::from_vector(this.to_vector().barrier().upper_half()));
        live!(!Self::SPLIT && !Self::VECTOR, Mask::new(self.s, self.raw().convert::<_, { p::PART }, 1, _>(self.raw())))
    }
}

macro_rules! operators {
    ($($trait:ident $f:ident $assign:ident $g:ident $raw:ident $op:tt;)*) => {$(
        impl<S: Isa, T: Signed, W: Width> $trait for Mask<T, W, S> {
            type Output = Self;
            #[op]
            fn $f(self, other: Self) -> Self {
                halves_if!(Self::SPLIT, |this: Self = self, other: Self = other| Self::combine(this.upper_half().$f(other.upper_half()), this.lower_half().$f(other.lower_half())));
                return_if!(Self::VECTOR && (S::VECTOR_MASKS || crate::X86 && W::BYTES >= 16 && size_of::<T>() > 1 && (1 $op 0) == 0), |this: Self = self, other: Self = other| Self::from_vector(this.to_vector().$f(other.to_vector())));
                return_if!(crate::X86 && Self::BOTH, {
                    let (a, b) = (self.both(), other.both());
                    let lanes = if a.opposite { a.lanes.not() } else { a.lanes }.$raw(if b.opposite { b.lanes.not() } else { b.lanes });
                    // De Morgan's laws.
                    let opposite = a.opposite & b.opposite & ((1 $op 1) == 1);
                    let (in_lanes, lanes, whole) = (a.in_lanes & b.in_lanes, if opposite { lanes.not() } else { lanes }, a.whole & b.whole);
                    let number = if a.number.is_some() | b.number.is_some() { Some(self.to_bitmask() $op other.to_bitmask()) } else { None };
                    let bits = self.$raw(other).bits();
                    Self { parts: same(AsBoth { bits, in_lanes, lanes, opposite, whole, number }), s: self.s }
                });
                return_if!(Self::BITS, self.$raw(other));
                // With booleans, LLVM merges comparisons.
                Self::new(self.s, self.raw().$raw(other.raw()))
            }
        }
        impl<S: Isa, T: Signed, W: Width> Mask<T, W, S> {
            #[op]
            fn $raw(self, other: Self) -> Self {
                return_if!(!Self::STAYS || (1 $op 1) + (1 $op 0) == 2, Self::of_bits(self.s, on_x86!(self, beside(other)).own_bits() $op on_x86!(other, beside(self)).own_bits()));
                Self::of_logic(self.s, on_x86!(self, beside(other)).raw().$raw(on_x86!(other, beside(self)).raw()))
            }
        }
        impl<S: Isa, T: Signed, W: Width> $assign for Mask<T, W, S> {
            #[op]
            fn $g(&mut self, other: Self) {
                when!(crate::X86 && Self::SPLIT, {
                    let (mut lower, mut upper) = (self.lower_half(), self.upper_half());
                    lower.$g(other.lower_half());
                    upper.$g(other.upper_half());
                    *self = Self::combine(upper, lower);
                });
                when!(Self::BITS && Self::LANES >= 8, {
                    let bits = Self::of_logic(self.s, on_x86!(self, beside(other)).parts.join().$raw(on_x86!(other, beside(*self)).parts.join()));
                    *self = choose! { crate::X86 && Self::BOTH => bits.also_as(self.$f(other)), _ => bits };
                });
                when!(Self::CARRIED, *self = Self::from_vector(self.to_vector().$f(other.to_vector()).barrier()));
                when!(!(crate::X86 && Self::SPLIT || Self::BITS && Self::LANES >= 8 || Self::CARRIED), {
                    *self = choose! { S::SSE41 && Self::VECTOR && !Self::BECOMES_BITS => Self::from_vector(self.to_vector().$f(other.to_vector())), _ => self.$f(other) };
                });
            }
        }
    )*};
}
operators! {
    BitAnd bitand BitAndAssign bitand_assign and &;
    BitOr bitor BitOrAssign bitor_assign or |;
    BitXor bitxor BitXorAssign bitxor_assign xor ^;
}

impl<S: Isa, T: Signed, W: Width> Not for Mask<T, W, S> {
    type Output = Self;
    #[op]
    fn not(self) -> Self {
        halves_if!(Self::SPLIT, |this: Self = self| Self::combine(!this.upper_half(), !this.lower_half()));
        return_if!(S::VECTOR_MASKS && Self::VECTOR, {
            // Behind a cast to other lanes, it would not be merged with the comparison.
            Self::from_vector((!self.to_vector()).barrier())
        });
        return_if!(Self::CARRIED, Self::from_vector(!self.to_vector()));
        let not = choose! { Self::BITS && !Self::STAYS => Self::from_bits(self.s, !self.own_bits()), Self::BITS => Self::of_logic(self.s, self.raw().not()), _ => Self::new(self.s, self.raw().not()) };
        return_if!(!Self::BOTH, not);
        let it = self.both();
        #[allow(clippy::manual_map, reason = "always inlined")]
        let number = if let Some(bits) = it.number { Some(bits ^ Self::ALL) } else { None };
        Self { parts: same(AsBoth { bits: not.bits(), opposite: !it.opposite, number, ..it }), s: self.s }
    }
}
impl<S: Isa, T: Signed, W: Width> Mask<T, W, S>
where
    crate::Code: crate::At<S>,
{
    /// The number of lanes.
    pub const LANES: usize = W::BYTES / size_of::<T>();
}
