use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::{Bits, Raw, RawMask, RawOf};
use crate::{Array, B8, B16, B32, B64, Int, Isa, Lane, MaskOf, Place, Simd, Source, Width};
use core::marker::PhantomData;

/// Makes vectors of one type. Its size is zero. The constructors and conversions of the API forward to its methods.
#[derive(Copy, Clone)]
pub(crate) struct Tag<S: Isa, T: Lane, W: Width> {
    s: S,
    of: PhantomData<(T, W)>,
}

type V<S, T, W> = Simd<T, W, S>;

macro_rules! shuffles {
    ($($(#[$doc:meta])* $name:ident = $op:ident $k:literal;)*) => {$(
        $(#[$doc])*
        #[op]
        pub fn $name(self, hi: V<S, T, W>, lo: V<S, T, W>) -> V<S, T, W> {
            return_if!(p::$op == p::STRIDE && W::BYTES > 64, |this: Self = self, lo: V<S, T, W> = lo, hi: V<S, T, W> = hi| {
                let (half, [a, b], [c, d]) = (this.part::<W>(), lo.parts::<W>(), hi.parts::<W>());
                this.join(half.$name(b, a), half.$name(d, c))
            });
            return_if!(
                S::SSE41 && p::$op == p::STRIDE && size_of::<T>() <= 2 && W::BYTES >= 16 && W::BYTES <= S::REGISTER && !crate::vector::two_tables::<S, T>(),
                |d: Self = self, lo: V<S, T, W> = lo, hi: V<S, T, W> = hi| d.pack_every_other($k == 1, lo, hi)
            );
            let v = on_x86!(self.wrap(lo.raw.shuffle::<_, { p::$op }, $k>(hi.raw)), shuffled::<{ p::$op }, $k>());
            choose! { p::$op == p::STRIDE => v.settled(), _ => v }
        }
    )*};
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// The number of lanes.
    pub const LANES: usize = W::BYTES / size_of::<T>();

    #[op]
    #[track_caller]
    pub(crate) fn new(s: S) -> Self {
        require!("a lane is wider than the vector", W::BYTES >= size_of::<T>());
        Self { s, of: PhantomData }
    }
    #[inline(always)]
    pub(crate) fn wrap(self, raw: RawOf<T, W>) -> V<S, T, W> {
        Simd::new(self.s, raw)
    }
    #[op]
    pub(crate) fn opaque(self, raw: RawOf<T, W>) -> V<S, T, W> {
        if const { !crate::OPTIMIZED } {
            return self.wrap(raw);
        }
        let v = raw.to_bytes();
        if_here!(S::A64 && W::BYTES == 8 && size_of::<T>() == 1, {
            let v = self.s.opaque_8(crate::raw::same(v));
            return self.wrap(Bits::from_bytes(crate::raw::same(v)));
        });
        if_here!(S::A64 && W::BYTES == 8 && size_of::<T>() < 8, {
            let v = self.s.opaque_lanes_8(crate::raw::same(v), size_of::<T>());
            return self.wrap(Bits::from_bytes(crate::raw::same(v)));
        });
        self.wrap(Bits::from_bytes(if const { size_of::<T>() == 1 } {
            self.s.opaque::<W>(v)
        } else if const { size_of::<T>() == 2 } {
            self.s.opaque16::<W>(v)
        } else if const { size_of::<T>() == 4 } {
            self.s.opaque32::<W>(v)
        } else {
            self.s.opaque64::<W>(v)
        }))
    }
    /// For `as_factors`.
    #[op]
    pub(crate) fn factor(self, of: impl crate::Operand<T, W, S>) -> V<S, T, W> {
        if_here!(
            S::A64 && !T::IS_FLOAT && W::BYTES >= 16,
            if matches!(crate::Operand::number(of), Some(number) if !is_known!(number)) {
                return self.opaque(of.vector(self).raw);
            }
        );
        of.vector(self)
    }
    #[op]
    fn opaque_keeping(self, raw: RawOf<T, W>, kept: RawOf<T, W>) -> V<S, T, W> {
        self.wrap(Bits::from_bytes(self.s.opaque_keeping::<W>(self.opaque(raw).bytes(), self.opaque(kept).bytes())))
    }
    /// The token that this tag was made from.
    #[inline(always)]
    pub(crate) fn simd(self) -> S {
        self.s
    }
    #[inline(always)]
    pub(crate) fn isa(self) -> S {
        self.s
    }
    /// The number of lanes, which is known at compile time.
    #[inline(always)]
    pub(crate) const fn lanes(self) -> usize {
        Self::LANES
    }

    /// The same width, with lanes of another type.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn repartition<U: Lane>(self) -> Tag<S, U, W> {
        Tag::new(self.s)
    }
    /// The same width, with unsigned integers of the same size. `RebindToUnsigned`.
    #[inline(always)]
    pub(crate) fn to_unsigned(self) -> Tag<S, T::Unsigned, W> {
        Tag::new(self.s)
    }
    /// The same width, with signed integers of the same size. `RebindToSigned`.
    #[inline(always)]
    pub(crate) fn to_signed(self) -> Tag<S, T::Signed, W> {
        Tag::new(self.s)
    }
    /// Half as many lanes. It doesn't build if there is only one, or if the width is [`B2`](crate::B2).
    #[op]
    #[track_caller]
    pub(crate) fn half(self) -> Tag<S, T, W::Half> {
        require!("there is no vector of less than 2 bytes", W::BYTES > 2);
        Tag::new(self.s)
    }

    /// Zero in each lane.
    #[inline(always)]
    pub(crate) fn zero(self) -> V<S, T, W> {
        // Lanes that are written to it stay apart.
        if const { Self::PACKED && !T::IS_FLOAT } {
            return self.wrap(Raw::zero());
        }
        self.set(T::default())
    }
    /// All bits, on AVX-512. LLVM doesn't know the value. Its own way to make 64 bytes of it waits for what was in the register.
    #[on(X86)]
    #[op]
    pub(crate) fn hidden_ones(self) -> V<S, T, W> {
        (!choose! { W::BYTES == 64 => self.zero().unseen(), _ => self.zero() }).unseen()
    }
    /// `value` in each lane.
    #[inline(always)]
    pub(crate) fn set(self, value: T) -> V<S, T, W> {
        on_x86!(self.wrap(Raw::splat(value)), repeated(value))
    }
    /// `first`, `first + 1` and so on.
    #[op]
    pub(crate) fn iota(self, first: T) -> V<S, T, W> {
        self.wrap(Raw::iota()) + self.set(first)
    }
    /// From `[T; LANES]`. The length has to be known where this is written, so it is for [`Isa::fixed`]. See also [`dup128`](Self::dup128).
    #[op]
    pub(crate) fn from_array(self, lanes: Array<T, W>) -> V<S, T, W> {
        self.wrap(Raw::from_array(lanes))
    }
    #[op]
    pub(crate) fn of_each(self, lanes: Array<T, W>) -> V<S, T, W> {
        self.wrap(Raw::of_each(lanes))
    }
    /// The first lanes of `from`. Panics if it is too short. `Load` and `LoadU`.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn load(self, from: &[T]) -> V<S, T, W> {
        self.wrap(Raw::load(from))
    }
    /// The last lanes of `from`. Panics if it is too short.
    #[op]
    #[track_caller]
    pub(crate) fn load_last(self, from: &[T]) -> V<S, T, W> {
        self.load(&from[from.len() - Self::LANES..])
    }
    /// Whether the masks of partial loads and stores are made from integers.
    pub(crate) const BY_BITS: bool = crate::X86 && S::HAS_MASKED_MEMORY;
    /// Whether a partial store can go to memory that is not initialized.
    pub(crate) const TO_UNINIT: bool = Self::BY_BITS || S::SVE2;
    pub(crate) const CELLS_BY_BITS: bool =
        Self::BY_BITS && W::BYTES >= 16 && W::BYTES <= S::REGISTER && !V::<S, T, W>::HALF;
    /// Whether partial loads from slices take the whole words of 4 bytes by a mask, and then the last bytes.
    pub(crate) const BY_LAST_WORD: bool =
        Self::WORDS && !S::PARTIAL && W::BYTES <= 32 && Self::LANES > 2 && size_of::<T>() <= 2;
    /// For fewer than `LANES` values.
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    #[op]
    fn load_by_last_word(self, from: &[T]) -> V<S, T, W> {
        use {
            crate::maskmov::{FOUR, TWO, edge},
            core::hint::select_unpredictable as select,
        };
        return_if!(W::BYTES < 16, self.resize_any(self.s.fixed::<T, B16>().load_by_last_word(from)));
        let (bytes, words) = (crate::lane::Repr::bytes(from), self.repartition::<u32>());
        let n = bytes.len();
        let (last, moves) = if const { size_of::<T>() == 2 } {
            if without_words::<T, W>(from) {
                core::hint::cold_path();
                return self.load_by_overlaps(from);
            }
            let two = *bytes.last_chunk().unwrap_or(&[0, 0]);
            (self.repartition::<u16>().set(u16::from_le_bytes(two)).bitcast::<u8>(), TWO)
        } else {
            let Some(four) = bytes.last_chunk() else {
                let some = select(n == 0, &[0][..], bytes);
                let three = some[0] as u32 | (some[some.len() / 2] as u32) << 8 | (some[some.len() - 1] as u32) << 16;
                let mut lanes = words.zero().to_array();
                lanes.as_mut()[0] = three & !(!0 << (8 * n as u32));
                return words.from_array(lanes).bitcast();
            };
            if without_words::<u8, W>(bytes) {
                core::hint::cold_path();
                return self.load_by_overlaps(from);
            }
            (words.set(u32::from_le_bytes(*four)).bitcast::<u8>(), FOUR)
        };
        // Where they overlap, both have the same bytes.
        (self.load_words(from).bitcast::<u8>()
            | last.table_lookup_bytes(self.repartition::<u8>().load(&edge(n)[moves..])))
        .bitcast()
    }
    /// The same without a mask, in little code.
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    #[op]
    fn load_by_overlaps(self, from: &[T]) -> V<S, T, W> {
        let (half, all) = (self.s.fixed::<T, B16>(), self.s.fixed::<T, B32>());
        return_if!(W::BYTES <= 16, self.resize_any(half.load_by_quarters(from)));
        if from.len() < half.lanes() {
            return self.resize_bitcast(half.load_by_quarters(from));
        }
        self.resize_bitcast(
            all.combine(
                half.load_last(from)
                    .table_lookup_bytes(half.repartition::<u8>().load(&SLIDE[32 - size_of_val(from)..]))
                    .bitcast(),
                half.load(from),
            ),
        )
    }
    /// Whether short slices are counted by four loads that overlap, which take fewer branches than classes of lengths.
    pub(crate) const COUNTS_QUARTERS: bool = (S::SSE41 || S::A64 || S::WASM)
        && !S::PARTIAL
        && cfg!(target_endian = "little")
        && S::REGISTER == 16
        && W::BYTES == 16
        && size_of::<T>() <= 2;
    const BY_QUARTERS: bool = Self::COUNTS_QUARTERS && S::SSE41;
    /// For each length: which byte of `load_quarters` goes to a place, and 255 in the bytes that do.
    const QUARTERS: &([[u8; 16]; 16], [[u8; 16]; 16]) = &crate::Aligned({
        let (mut moves, mut once, size, n, mut len) = ([[0x80; 16]; 16], [[0; 16]; 16], size_of::<T>(), Self::LANES, 1);
        while len < n {
            let (part, mut at) = (if len < n / 4 { 1 } else { n / 4 }, 0);
            let step = if part < len - part { part } else { len - part };
            while at < len * size {
                let i = at / size;
                let lane = if len < n / 4 {
                    if i == len - 1 { 3 } else { i }
                } else if i < part + step {
                    if i < part { i } else { i + part - step }
                } else if i >= len - part {
                    i + 4 * part - len
                } else {
                    i + 3 * part + step - len
                };
                let from = lane * size + at % size;
                (moves[len][at], once[len][from], at) = (from as u8, 255, at + 1);
            }
            len += 1;
        }
        (moves, once)
    })
    .0;
    /// One lane of `load_quarters` for each of `len` values.
    #[op]
    pub(crate) fn once(self, len: usize) -> MaskOf<T, W, S> {
        crate::Mask::from_full(self.repartition::<u8>().load(&Self::QUARTERS.1[len]).bitcast::<T>())
    }
    #[op]
    fn load_by_quarters(self, from: &[T]) -> V<S, T, W> {
        if from.len() >= Self::LANES {
            return self.load(from);
        }
        if from.is_empty() {
            return self.zero();
        }
        self.load_quarters(from)
            .0
            .table_lookup_bytes(self.repartition::<u8>().load(&Self::QUARTERS.0[from.len()]))
            .bitcast()
    }
    /// Whether partial accesses lack a path of their own for whole vectors.
    pub(crate) const WHOLE_FIRST: bool = Self::BY_BITS || S::AVX2 && size_of::<T>() >= 4 || W::BYTES > S::REGISTER;
    /// Or they have it, and the test comes before `uncounted`.
    pub(crate) const WHOLE_APART: bool = Self::WHOLE_FIRST || S::SSE41 && W::BYTES >= 16;
    /// Whether `len` values take the whole access. With masks that is from four vectors or 256 values on, so that short inputs have a
    /// branch that is predicted, or if the compiler knows on which side of a vector `len` is, as in loops over chunks.
    #[op]
    pub(crate) fn is_whole(len: usize) -> bool {
        use crate::arithmetic::known;
        return_if!(!Self::BY_BITS || W::BYTES < 16 || W::BYTES > 2 * S::REGISTER, len >= Self::LANES);
        len >= (4 * Self::LANES).min(256)
            || known(len >= Self::LANES)
            || len >= Self::LANES && known(len <= Self::LANES)
    }
    /// `load_n` for consumers, in whose loops most are whole.
    #[op]
    pub(crate) fn load_whole_or_rest<E: crate::Readable<T>>(self, from: &[E]) -> V<S, T, W> {
        return_if!(!Self::WHOLE_APART, E::load_partial(from, self.simd()));
        if if E::PLAIN || E::BYTES { Self::is_whole(from.len()) } else { from.len() >= Self::LANES } {
            return E::load(from, self.simd());
        }
        E::load_partial(&from[..uncounted(from.len())], self.simd())
    }
    /// As many lanes as `from` has, and then zeros. `LoadN`.
    #[inline(always)]
    pub(crate) fn load_n(self, from: &[T]) -> V<S, T, W> {
        apart!(self.s, {
            #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
            if const { Self::BY_LAST_WORD } && !is_known!(from.len()) {
                return live!(
                    Self::BY_LAST_WORD,
                    if from.len() >= Self::LANES { self.load(from) } else { self.load_by_last_word(from) }
                );
            }
            if const { Self::BY_QUARTERS } && !is_known!(from.len()) {
                return live!(Self::BY_QUARTERS, self.load_by_quarters(from));
            }
            if_here!(
                S::A64 && crate::OPTIMIZED && W::BYTES <= 64 && (S::SVE2 || size_of::<T>() == 1 && W::BYTES != 16),
                if Self::blocks_and_part(from.len()) {
                    return live!(S::A64 && W::BYTES <= 64, self.load_known(from));
                }
            );
            if const { Self::BY_LAST_BLOCK } && !is_known!(from.len()) {
                return live!(S::A64 && Self::BY_LAST_BLOCK, self.load_by_last_block(from));
            }
            if const { Self::ONE_TEST } && !is_known!(from.len()) {
                return live!(crate::X86 && Self::ONE_TEST, self.load_registers(from, self.zero()));
            }
            choose! { |this: Self = self, from: &[T] = from|
                Self::BY_BITS && W::BYTES > 128 => apart!(this.s, {
                    let (lower, upper) = from.split_at(from.len().min(Self::LANES / 2));
                    if upper.is_empty() { this.zero_extend(this.half().load_n(lower)) } else { this.combine(this.half().load_n(upper), this.half().load(lower)) }
                }),
                W::BYTES > 64 => apart!(this.s, {
                    let (lower, upper) = from.split_at(from.len().min(Self::LANES / 2));
                    this.combine(this.half().load_n(upper), this.half().load_n(lower))
                }),
                crate::X86 && S::REGISTER == 32 && size_of::<T>() >= 4 && (W::BYTES == 16 || W::BYTES == 32) => {
                    // `vpmaskmov`. The store is slow on AMD.
                    this.load_masked::<true>(from)
                },
                S::SVE2 && W::BYTES >= 16 => this.load_by_counts(from),
                Self::BY_LOOKUP => this.load_by_lookup(from),
                !S::HAS_MASKED_MEMORY && size_of::<T>() == 1 && W::BYTES > 16 && (!S::PORTABLE || S::WASM) && !S::BY_HAND => this.load_n_bytes(from),
                !S::HAS_MASKED_MEMORY && W::BYTES > S::REGISTER => apart!(this.s, {
                    let (half, both) = (this.half(), from.len() >= Self::LANES / 2);
                    let last = half.load_n(&from[if both { half.lanes() } else { 0 }..]);
                    if both { this.combine(last, half.load(from)) } else { this.zero_extend(last) }
                }),
                !S::HAS_MASKED_MEMORY => this.wrap(Raw::load_in_parts(from)),
                W::BYTES < 16 => this.resize_any(this.s.fixed::<T, B16>().load_n(&from[..from.len().min(Self::LANES)])),
                _ => this.load_masked::<true>(from),
            }
        })
    }
    /// Whether the compiler knows that whole blocks and one plain access do.
    #[on(A64)]
    #[op]
    pub(crate) fn blocks_and_part(len: usize) -> bool {
        let len = len.min(Self::LANES);
        is_known!(len)
            && (!S::SVE2 || crate::hints::confirmed(len as u64))
            && (len % (16 / size_of::<T>())).count_ones() <= 1
    }
    #[on(A64)]
    #[op]
    fn load_by_counts(self, from: &[T]) -> V<S, T, W> {
        halves_if!(W::BYTES > 16, |this: Self = self, from: &[T] = from| {
            let (lower, upper) = from.split_at(from.len().min(Self::LANES / 2));
            this.combine(this.half().load_by_counts(upper), this.half().load_by_counts(lower))
        });
        self.wrap(Bits::from_native(W::from16(self.s.load_first(from, None))))
    }
    /// Whether the masked accesses of several registers have one test of the page.
    pub(crate) const ONE_TEST: bool = Self::BY_BITS && S::REGISTER == 64 && W::BYTES > 64 && W::BYTES <= 256;
    #[on(X86)]
    #[op]
    fn load_registers(self, from: &[T], or: V<S, T, W>) -> V<S, T, W> {
        if !reaches_absent_page::<T, W>(from) {
            return self.load_by_masks(from, or);
        }
        self.load_at_page(from, or)
    }
    /// Whole registers, and one that ends where the slice does.
    #[on(X86)]
    #[op]
    fn load_at_page(self, from: &[T], or: V<S, T, W>) -> V<S, T, W> {
        return_if!(W::BYTES <= 64, self.first_n(from.len()).if_then_else(self.load_ending::<true>(from), or));
        live!(W::BYTES > 64, {
            let (half, both) = (self.half(), from.len() >= Self::LANES / 2);
            let last = half.load_at_page(
                &from[if both { half.lanes() } else { 0 }..],
                if both { or.upper_half() } else { or.lower_half() },
            );
            if both { self.combine(last, half.load(from)) } else { self.combine(or.upper_half(), last) }
        })
    }
    #[on(X86)]
    #[op]
    fn load_by_masks(self, from: &[T], or: V<S, T, W>) -> V<S, T, W> {
        return_if!(Self::LANES <= 64, self.wrap(Raw::load_by_bits(self.s, from, 0, or.raw)));
        let (lower, upper) = from.split_at(from.len().min(Self::LANES / 2));
        live!(
            Self::LANES > 64,
            self.combine(
                self.half().load_by_masks(upper, or.upper_half()),
                self.half().load_by_masks(lower, or.lower_half())
            )
        )
    }
    /// From 16 bytes on, the last ones are shifted into place. That takes fewer branches, which are hard to predict.
    #[op]
    fn load_n_bytes(self, from: &[T]) -> V<S, T, W> {
        let (n, half) = (from.len(), self.half());
        if n >= W::BYTES {
            return self.load(from);
        }
        if n < W::BYTES / 2 {
            return self.zero_extend(half.load_n(from));
        }
        let d = self.s.fixed::<T, B16>();
        let last =
            d.load_last(from).table_lookup_bytes(d.repartition::<u8>().load(&SLIDE[16 - n % 16..])).bitcast::<T>();
        let upper = if W::BYTES == 64 && n >= 48 {
            half.resize_bitcast(self.s.fixed::<T, B32>().combine(last, d.load(&from[32..])))
        } else {
            half.resize_bitcast(last)
        };
        self.combine(upper, half.load(from))
    }
    /// `HIDES`: see `missing`.
    #[inline(always)]
    pub(crate) fn load_masked<const HIDES: bool>(self, from: &[T]) -> V<S, T, W> {
        apart!(self.s, {
            let near = const { Self::BY_BITS } && near_absent_page_by_bits::<T, W>(self.s, from);
            if crate::OPTIMIZED && in_two_parts::<T, W>(from.len()) {
                return self.load_known(from);
            }
            return_if!(Self::BY_BITS, {
                if !near {
                    return self.wrap(Raw::load_by_bits(self.s, from, 0, self.zero().raw));
                }
                core::hint::cold_path();
                self.load_ending::<HIDES>(from)
            });
            if live!(crate::X86 && Self::BY_WORDS, words_near_absent_page::<T, W>(from)) {
                core::hint::cold_path();
                return self.wrap(Raw::load_in_parts(from));
            }
            self.load_up_to(from)
        })
    }
    /// By a vector that ends where the slice does.
    #[on(X86)]
    #[op]
    fn load_ending<const HIDES: bool>(self, from: &[T]) -> V<S, T, W> {
        if from.is_empty() {
            return self.zero();
        }
        let skip = if HIDES { missing::<T, W>(from.len()) } else { Self::LANES - from.len().min(Self::LANES) };
        self.wrap(Raw::load_by_bits(self.s, from, skip, self.zero().raw)).down_by(skip)
    }
    /// Whether there is `vpmaskmov`, and nothing better.
    const WORDS: bool = S::AVX2 && S::REGISTER == 32;
    /// Whether a partial load from a slice has next to no branches that are hard to predict, though there are no masks.
    pub(crate) const IN_ORDER: bool = Self::BY_LAST_WORD || Self::BY_WORDS && Self::LANES > 2;
    pub(crate) const BY_WORDS: bool = Self::WORDS && size_of::<T>() >= 4 && (W::BYTES == 16 || W::BYTES == 32);
    #[op]
    fn load_words(self, from: &[T]) -> V<S, T, W> {
        let from = crate::lane::Repr::bytes(from);
        self.wrap(Bits::from_native(if const { W::BYTES == 32 } {
            W::from32(self.s.load_words_32(from))
        } else {
            W::from16(self.s.load_words_16(from))
        }))
    }
    #[op]
    pub(crate) fn load_up_to(self, from: &[T]) -> V<S, T, W> {
        return_if!(Self::BY_WORDS, self.load_words(from));
        unreachable!()
    }
    /// As many lanes as `from` has, and then those of `no`. `LoadNOr`.
    #[op]
    pub(crate) fn load_n_or(self, no: impl crate::Operand<T, W, S>, from: &[T]) -> V<S, T, W> {
        if const { S::HAS_MASKED_MEMORY && W::BYTES >= 16 && W::BYTES <= S::REGISTER }
            && !in_two_parts::<T, W>(from.len())
        {
            return live!(S::HAS_MASKED_MEMORY && W::BYTES >= 16 && W::BYTES <= S::REGISTER, {
                return_if!(crate::X86 && Self::BY_BITS, {
                    // LLVM's own ones wait for what was in the register.
                    let ones = matches!(crate::Operand::number(no), Some(it) if crate::arithmetic::known(crate::Int::to_u64(T::unsigned(&[it])[0]) == !0 >> (64 - T::BITS)));
                    let no = if W::BYTES == 64 && ones {
                        live!(crate::X86 && W::BYTES == 64, self.hidden_ones())
                    } else {
                        no.vector(self)
                    };
                    if !near_absent_page_by_bits::<T, W>(self.s, from) {
                        return self.wrap(Raw::load_by_bits(self.s, from, 0, no.raw));
                    }
                    core::hint::cold_path();
                    self.load_at_page(from, no)
                });
                return_if!(
                    S::SVE2,
                    self.wrap(Bits::from_native(W::from16(
                        self.s.load_first(from, Some(W::to16(no.vector(self).raw.to_native())))
                    )))
                );
                unreachable!()
            });
        }
        if const { Self::ONE_TEST } && !is_known!(from.len()) {
            return live!(crate::X86 && Self::ONE_TEST, self.load_registers(from, no.vector(self)));
        }
        return_if!(Self::BY_BITS && W::BYTES == 2 * S::REGISTER, {
            let ((lower, upper), no) = (from.split_at(from.len().min(Self::LANES / 2)), no.vector(self));
            self.combine(self.half().load_n_or(no.upper_half(), upper), self.half().load_n_or(no.lower_half(), lower))
        });
        if !S::PARTIAL && from.len() >= Self::LANES {
            return self.load(from);
        }
        self.padded_with(self.first_n(from.len()), self.load_n(from), no.vector(self))
    }
    /// Like [`load_n_or`](Self::load_n_or), for a slice that is nearly always long enough, such as what is left of the
    /// input of a parser. The code for short slices is kept out of the way.
    #[op]
    pub(crate) fn load_padded(self, from: &[T], pad: T) -> V<S, T, W> {
        #[cold]
        #[inline(never)]
        fn padded<T: Lane>(from: &[T], pad: T, to: &mut [T]) {
            to.fill(pad);
            to[..from.len()].copy_from_slice(from);
        }
        // In a cold place, LLVM calls the load of SVE.
        return_if!(S::SVE2, if from.len() >= Self::LANES { self.load(from) } else { self.load_n_or(pad, from) });
        if from.len() >= Self::LANES {
            return self.load(from);
        }
        // It only counts right after the branch, and not in a closure.
        core::hint::cold_path();
        // Each input has an end, so this is most of the time for short ones.
        // Inlined, it takes registers from the loop.
        struct Rest<W, const ZERO: bool>(W);
        impl<T: Lane, W: Width, const ZERO: bool> crate::Kernel<(&[T], T)> for Rest<W, ZERO> {
            type Output = Array<T, W>;
            #[op]
            fn run<S: Isa>(s: S, (from, pad): (&[T], T)) -> Array<T, W> {
                let d = Tag::<S, T, W>::new(s);
                choose! { ZERO => d.load_n(from), _ => d.load_n_or(pad, from) }.to_array()
            }
        }
        return_if!(S::PARTIAL, {
            let from = &from[..uncounted(from.len())];
            if crate::hints::zero(Some(pad)) { self.load_n(from) } else { self.load_n_or(pad, from) }
        });
        return_if!(
            (S::SSE41 || S::A64 || S::WASM) && W::BYTES <= 64,
            self.from_array(if crate::hints::zero(Some(pad)) {
                crate::gate::Enter::enter::<Rest<W, true>, _>(self.s, (from, pad))
            } else {
                crate::gate::Enter::enter::<Rest<W, false>, _>(self.s, (from, pad))
            })
        );
        let mut lanes = self.zero().to_array();
        padded(from, pad, lanes.as_mut());
        self.from_array(lanes)
    }
    /// [`load`](Self::load) from memory that is not a plain slice.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn read(self, from: impl Source<T>, at: usize) -> V<S, T, W> {
        from.read_vector(self, at)
    }
    /// [`load_n`](Self::load_n) from memory that is not a plain slice.
    #[inline(always)]
    pub(crate) fn read_n(self, from: impl Source<T>) -> V<S, T, W> {
        from.read_vector_n(self)
    }
    /// All whole vectors in `from`, and what is left.
    #[op]
    pub(crate) fn chunks<E: crate::Readable<T>>(
        self,
        from: &[E],
    ) -> (impl ExactSizeIterator<Item = V<S, T, W>> + DoubleEndedIterator, &[E]) {
        let chunks = from.chunks_exact(Self::LANES);
        let rest = chunks.remainder();
        (
            chunks.map(
                #[inline(always)]
                move |chunk| self.load_any(chunk),
            ),
            rest,
        )
    }
    /// The first 16 bytes of `from` in each block.
    #[op]
    #[track_caller]
    pub(crate) fn load_dup128(self, from: &[T]) -> V<S, T, W> {
        let block = RawOf::<T, B16>::load(from);
        let all = self.wrap(block.shuffle::<_, { p::REPEAT }, 0>(block));
        // Before a shuffle, LLVM would load one block and shuffle it, which is slower.
        choose! { crate::X86 && S::REGISTER == 64 && W::BYTES == 64 => all.barrier_unless_known(), _ => all }
    }
    /// The same, by halves on AVX-512.
    #[op]
    #[track_caller]
    pub(crate) fn load_dup128_shared(self, from: &[T]) -> V<S, T, W> {
        if_here!(crate::X86 && S::REGISTER == 64 && W::BYTES == 64, {
            let half = self.half().load_dup128(from).barrier_unless_known();
            return self.combine(half, half).barrier_unless_known();
        });
        self.load_dup128(from)
    }
    /// `Dup128VecFromValues`.
    #[op]
    pub(crate) fn dup128(self, block: Array<T, B16>) -> V<S, T, W> {
        self.load_dup128(block.as_ref())
    }
    /// Splits `a0 b0 a1 b1 ..` into `[a, b]`. Panics if `from` is shorter than two vectors.
    #[op]
    #[track_caller]
    pub(crate) fn load_interleaved2(self, from: &[T]) -> [V<S, T, W>; 2] {
        let from = &from[..2 * Self::LANES];
        apart!(self.s, {
            let from = &from[..2 * Self::LANES];
            halves_if!(S::AVX2 && T::BITS <= 16 && W::BYTES > S::REGISTER, |this: Self = self, from: &[T] = from| {
                let (lower, upper) = from[..2 * Self::LANES].split_at(Self::LANES);
                let ([a0, b0], [a1, b1]) = (this.half().load_interleaved2(lower), this.half().load_interleaved2(upper));
                [this.combine(a1, a0), this.combine(b1, b0)]
            });
            return_if!((S::SSE41 || S::WASM) && T::BITS <= 16 && W::BYTES >= 8 && W::BYTES < S::REGISTER, |this: Self = self, from: &[T] = from| this.halves_of_pairs(Tag::new(this.s).load(from)));
            let (lo, hi) = (self.load(from), self.load_last(from));
            lo.deinterleave(hi)
        })
    }
    /// The even and the odd lanes, as the halves of wider lanes. On x86 that is the same code, and no shuffle is left if they are widened again.
    #[op]
    pub(crate) fn halves_of_pairs(self, both: V<S, T, W::Twice>) -> [V<S, T, W>; 2] {
        let (d, both) = (self.to_unsigned(), both.bitcast::<<T::Unsigned as Int>::Wide>());
        [d.cast(both).bitcast(), d.cast(both >> T::BITS).bitcast()]
    }
    /// Splits `a0 b0 c0 a1 ..`, such as pixels, into `[a, b, c]`. Panics if `from` is shorter than three vectors.
    #[op]
    #[track_caller]
    pub(crate) fn load_interleaved3(self, from: &[T]) -> [V<S, T, W>; 3] {
        let from = &from[..3 * Self::LANES];
        apart!(self.s, {
            let from = &from[..3 * Self::LANES];
            return_if!(crate::X86 && size_of::<T>() == 1 && W::BYTES == 64 && S::COMPRESS[0] == 64, |this: Self = self, from: &[T] = from| {
                let from = &from[..192];
                let [a, b, c] = crate::interleave3::split([this.load(from).bitcast(), this.load(&from[64..]).bitcast(), this.load_last(from).bitcast()]);
                [a.bitcast(), b.bitcast(), c.bitcast()]
            });
            return_if!(crate::X86 && size_of::<T>() == 1 && matches!(W::BYTES, 16 | 32) && 2 * W::BYTES <= S::REGISTER && S::AVX512VBMI, |this: Self = self, from: &[T] = from| {
                let (n, from, wide) = (Self::LANES, &from[..3 * Self::LANES], this.s.fixed::<T, W::Twice>());
                let (first, last) = (wide.load(from), wide.resize_bitcast(this.load_last(from)));
                let two = always!(|c: usize| first.concat_swizzle(last, #[inline(always)] |i| 3 * (i % n) + (c + i / n).min(2)).unseen());
                let (ab, c) = (two(0), two(2));
                [ab.lower_half().same(), ab.upper_half().same(), c.lower_half().same()]
            });
            return_if!(crate::X86 && size_of::<T>() == 1 && W::BYTES >= 16 && W::BYTES <= S::REGISTER && S::SSE41 && (W::BYTES < 64 || S::COMPRESS[0] < 64), |this: Self = self, from: &[T] = from| {
                let (from, block) = (&from[..3 * Self::LANES], this.s.fixed::<T, B16>());
                let [a, b, c] = crate::interleave3::load(this.repartition(), #[inline(always)] |i| block.load(&from[16 * i..]).bitcast());
                [a.bitcast(), b.bitcast(), c.bitcast()]
            });
            return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() <= 2, |this: Self = self, from: &[T] = from| {
                // Each round interleaves the first half of all values with the second.
                let (mut a, mut b, mut c) = (this.load(from), this.load(&from[Self::LANES..]), this.load_last(&from[..3 * Self::LANES]));
                let swapped = always!(|v: V<S, T, W>| v.bitcast::<u64>().swap_pairs().bitcast::<T>().barrier());
                unrolled!(4, for _ in 0..(Self::LANES.ilog2() as usize) {
                    let (y, z) = (swapped(b), swapped(c));
                    (a, b, c) = (a.interleave_lower(y).barrier(), a.interleave_upper(z).barrier(), y.interleave_upper(c).barrier());
                });
                [a, b, c]
            });
            return_if!((crate::vector::blends3::<S, T, W>() || S::WASM && W::BYTES == 16) && size_of::<T>() == 4 && S::REGISTER < 64, |this: Self = self, from: &[T] = from| crate::interleave3::load_words(this, from));
            return_if!(crate::vector::blends3::<S, T, W>() && size_of::<T>() > 1 && !(size_of::<T>() == 4 && S::REGISTER < 64), |this: Self = self, from: &[T] = from| {
                let from = &from[..3 * Self::LANES];
                let (mut a, mut b, mut c) = (this.load(from), this.load(&from[Self::LANES..]), this.load_last(from));
                if const { W::BYTES == 32 } {
                    (a, b, c) = (this.concat_upper_lower(b, a), this.concat_lower_upper(c, a), this.concat_upper_lower(c, b));
                }
                macro_rules! every { ($k:literal) => {{
                    let v = a.blend::<{ p::PICK3 }, { 3 + $k }>(b).blend::<{ p::PICK3 }, { 6 + $k }>(c);
                    let v = if size_of::<T>() == 2 { v.unseen() } else { v };
                    v.shuffle::<{ p::SORT3 }, $k>(v)
                }}; }
                [every!(0), every!(1), every!(2)]
            });
            if const { W::BYTES <= 16 } {
                let [a, b, c]: [RawOf<T, W>; 3] = Raw::load3(from);
                if_here!(crate::X86 && size_of::<T>() <= 2 && W::BYTES < 16, {
                    let apart = always!(|v| crate::interleave3::apart(self.wrap(v).bitcast::<u8>()).bitcast());
                    return [apart(a), apart(b), apart(c)];
                });
                return [self.opaque_keeping(a, c), self.opaque(b), self.opaque(c)];
            }
            let from = &from[..3 * Self::LANES];
            return_if!(crate::vector::two_tables::<S, T>() && W::BYTES <= S::REGISTER, |this: Self = self, from: &[T] = from| {
                let (a, b, c) = (this.load(from), this.load(&from[Self::LANES..]), this.load_last(from));
                macro_rules! every { ($k:literal) => {{
                    let v = a.blend::<{ p::PICK3_WHOLE }, { 3 + $k }>(b).blend::<{ p::PICK3_WHOLE }, { 6 + $k }>(c);
                    let v = if size_of::<T>() == 2 { v.unseen() } else { v };
                    v.shuffle::<{ p::SORT3_WHOLE }, $k>(v)
                }}; }
                [every!(0), every!(1), every!(2)]
            });
            return_if!(W::BYTES > 16, |this: Self = self, from: &[T] = from| {
                let half = this.half();
                let [a0, b0, c0] = half.load_interleaved3(from);
                let [a1, b1, c1] = half.load_interleaved3(&from[3 * Self::LANES / 2..]);
                [this.combine(a1, a0), this.combine(b1, b0), this.combine(c1, c0)]
            });
            unreachable!()
        })
    }
    /// Splits `a0 b0 c0 d0 a1 ..` into `[a, b, c, d]`. Panics if `from` is shorter than four vectors.
    #[op]
    #[track_caller]
    pub(crate) fn load_interleaved4(self, from: &[T]) -> [V<S, T, W>; 4] {
        let from = &from[..4 * Self::LANES];
        apart!(self.s, {
            let from = &from[..4 * Self::LANES];
            halves_if!((S::SSE2 || S::WASM) && W::BYTES > S::REGISTER && W::BYTES <= 64, |this: Self = self, from: &[T] = from| {
                let (lower, upper) = from[..4 * Self::LANES].split_at(2 * Self::LANES);
                let ([a0, b0, c0, d0], [a1, b1, c1, d1]) = (this.half().load_interleaved4(lower), this.half().load_interleaved4(upper));
                [this.combine(a1, a0), this.combine(b1, b0), this.combine(c1, c0), this.combine(d1, d0)]
            });
            halves_if!(W::BYTES > 64, |this: Self = self, from: &[T] = from| {
                let (lower, upper) = from[..4 * Self::LANES].split_at(2 * Self::LANES);
                let ([a0, b0, c0, d0], [a1, b1, c1, d1]) = (this.part::<W>().load_interleaved4(lower), this.part::<W>().load_interleaved4(upper));
                [this.join(a0, a1), this.join(b0, b1), this.join(c0, c1), this.join(d0, d1)]
            });
            return_if!(S::SSE41 && T::BITS == 8 && W::BYTES >= 4 && 4 * W::BYTES <= S::REGISTER, |this: Self = self, from: &[T] = from| {
                // As in `halves_of_pairs`.
                let (d, all) = (this.to_unsigned(), Tag::<S, T, <W::Twice as Width>::Twice>::new(this.s).load(from).bitcast::<u32>());
                [d.cast(all).bitcast(), d.cast(all >> 8).bitcast(), d.cast(all >> 16).bitcast(), d.cast(all >> 24).bitcast()]
            });
            return_if!(S::AVX2 && size_of::<T>() == 4 && W::BYTES == 32 && S::REGISTER == 32, |this: Self = self, from: &[T] = from| crate::interleave3::load4_words(this, from));
            return_if!(S::AVX2 && size_of::<T>() <= 4 && (W::BYTES == 16 || W::BYTES == 32 && !crate::vector::two_tables::<S, T>()), |this: Self = self, from: &[T] = from| crate::interleave3::load4(this, from));
            if_here!(
                (crate::X86 || S::WASM)
                    && (W::BYTES == 16 || W::BYTES == 32 && S::REGISTER >= 32)
                    && size_of::<T>() >= 4
                    && (W::BYTES == 16 || size_of::<T>() == 8 || !crate::vector::two_tables::<S, T>()),
                {
                    let from = &from[..4 * Self::LANES];
                    let (mut a, mut b) = (self.load(from), self.load(&from[Self::LANES..]));
                    let (mut c, mut d) = (self.load(&from[2 * Self::LANES..]), self.load_last(from));
                    if const { W::BYTES == 32 } {
                        (a, b, c, d) = (
                            self.concat_lower_lower(c, a),
                            self.concat_upper_upper(c, a),
                            self.concat_lower_lower(d, b),
                            self.concat_upper_upper(d, b),
                        );
                    }
                    let (ac0, ac1, bd0, bd1) =
                        (a.interleave_lower(c), a.interleave_upper(c), b.interleave_lower(d), b.interleave_upper(d));
                    if const { size_of::<T>() == 8 } {
                        return [ac0, ac1, bd0, bd1];
                    }
                    return [
                        ac0.interleave_lower(bd0),
                        ac0.interleave_upper(bd0),
                        ac1.interleave_lower(bd1),
                        ac1.interleave_upper(bd1),
                    ];
                }
            );
            return_if!(S::AVX512VBMI && W::BYTES == 64 && size_of::<T>() <= 2, |this: Self = self, from: &[T] = from| {
                let part = always!(|k: usize| this.load(&from[..4 * Self::LANES][k * Self::LANES..]));
                crate::interleave3::split4([part(0), part(1), part(2), part(3)])
            });
            return_if!(S::AVX512BW && W::BYTES == 32 && size_of::<T>() == 4, |this: Self = self, from: &[T] = from| {
                let (part, n) = (always!(|k: usize| this.load(&from[..4 * Self::LANES][k * Self::LANES..])), Self::LANES / 2);
                let (a, b, c, d) = (part(0), part(1), part(2), part(3));
                let two = always!(|k: usize| {
                    let (w, x) = (a.of_two(b, always!(|i: usize| i % n * 4 + k + i / n)), c.of_two(d, always!(|i: usize| i % n * 4 + k + 1 - i / n)));
                    [w.concat_halves::<0, 1>(x), w.concat_halves::<1, 0>(x)]
                });
                let ([w, x], [y, z]) = (two(0), two(2));
                [w, x, y, z]
            });
            return_if!(crate::vector::two_tables::<S, T>() && W::BYTES >= 32 && W::BYTES <= S::REGISTER, |this: Self = self, from: &[T] = from| {
                let from = &from[..4 * Self::LANES];
                let (a, mut b) = (this.load(from), this.load(&from[Self::LANES..]));
                let (mut c, d) = (this.load(&from[2 * Self::LANES..]), this.load_last(from));
                if const { W::BYTES == 32 } {
                    (b, c) = (c, b);
                }
                let (w, x) = (a.shuffle::<{ p::QUARTERS }, 0>(b).bitcast::<u64>(), c.shuffle::<{ p::QUARTERS }, 0>(d).bitcast());
                let (y, z) = (a.shuffle::<{ p::QUARTERS }, 2>(b).bitcast::<u64>(), c.shuffle::<{ p::QUARTERS }, 2>(d).bitcast());
                if const { W::BYTES == 32 } {
                    return [w.interleave_lower(x).bitcast(), w.interleave_upper(x).bitcast(), y.interleave_lower(z).bitcast(), y.interleave_upper(z).bitcast()];
                }
                let t = w.tag();
                [
                    t.concat_lower_lower(x, w).bitcast(),
                    t.concat_upper_upper(x, w).bitcast(),
                    t.concat_lower_lower(z, y).bitcast(),
                    t.concat_upper_upper(z, y).bitcast(),
                ]
            });
            return_if!(S::BY_HAND && W::BYTES == 16 && size_of::<T>() == 2, |this: Self = self, from: &[T] = from| {
                let part = always!(|k: usize| this.load(&from[..4 * Self::LANES][k * Self::LANES..]));
                let round = always!(|[a, b, c, d]: [V<S, T, W>; 4]| [a.interleave_lower(c), a.interleave_upper(c), b.interleave_lower(d), b.interleave_upper(d)]);
                round(round(round([part(0), part(1), part(2), part(3)])))
            });
            return_if!((crate::X86 || S::WASM) && !S::BY_HAND && (W::BYTES == 16 || W::BYTES > 16 && !crate::vector::two_tables::<S, T>()) && size_of::<T>() <= 2, |this: Self = self, from: &[T] = from| {
                // Four bytes of each result are in each block: group them, and transpose the groups.
                let from = &from[..4 * Self::LANES];
                let (a, b) = (this.group4(from), this.group4(&from[Self::LANES..]));
                let (c, d) = (this.group4(&from[2 * Self::LANES..]), this.group4(&from[3 * Self::LANES..]));
                let (ab0, ab1) = (a.interleave_lower(b).bitcast::<u64>(), a.interleave_upper(b).bitcast::<u64>());
                let (cd0, cd1) = (c.interleave_lower(d).bitcast(), c.interleave_upper(d).bitcast());
                [
                    this.transpose_blocks(ab0.interleave_lower(cd0)),
                    this.transpose_blocks(ab0.interleave_upper(cd0)),
                    this.transpose_blocks(ab1.interleave_lower(cd1)),
                    this.transpose_blocks(ab1.interleave_upper(cd1)),
                ]
            });
            halves_if!(S::A64 && W::BYTES > 16, |this: Self = self, from: &[T] = from| {
                let (lower, upper) = (this.half().load_interleaved4(from), this.half().load_interleaved4(&from[2 * Self::LANES..]));
                crate::array::own::from_fn(#[inline(always)] |k| this.combine(upper[k], lower[k]))
            });
            return_if!(S::A64 && W::BYTES == 16, |this: Self = self, from: &[T] = from| {
                // `ld4` takes 1.3 to 1.7 times as long on Neoverse V1 and V2, and the same on N1 and N3.
                let part = always!(|k: usize| this.opaque(this.load(&from[k * Self::LANES..]).raw));
                let (a, b, c, d) = (part(0), part(1), part(2), part(3));
                return_if!(size_of::<T>() == 8, [a.interleave_lower(c), a.interleave_upper(c), b.interleave_lower(d), b.interleave_upper(d)]);
                let (ac0, bd0, ac1, bd1) = (this.concat_even(b, a), this.concat_odd(b, a), this.concat_even(d, c), this.concat_odd(d, c));
                let (ac0, bd0, ac1, bd1) = (this.opaque(ac0.raw), this.opaque(bd0.raw), this.opaque(ac1.raw), this.opaque(bd1.raw));
                [this.concat_even(ac1, ac0), this.concat_even(bd1, bd0), this.concat_odd(ac1, ac0), this.concat_odd(bd1, bd0)]
            });
            if const { W::BYTES <= 16 && !(S::BY_HAND && size_of::<T>() == 1 && W::BYTES >= 8) } {
                let [a, b, c, d]: [RawOf<T, W>; 4] = Raw::load4(from);
                return [self.opaque_keeping(a, d), self.opaque(b), self.opaque(c), self.opaque(d)];
            }
            let from = &from[..4 * Self::LANES];
            let ([ac0, bd0], [ac1, bd1]) =
                (self.load_interleaved2(from), self.load_interleaved2(&from[2 * Self::LANES..]));
            [
                self.concat_even(ac1, ac0),
                self.concat_even(bd1, bd0),
                self.concat_odd(ac1, ac0),
                self.concat_odd(bd1, bd0),
            ]
        })
    }
    /// With zeros in the upper halves of the wider lanes, nothing saturates.
    #[on(X86)]
    #[op]
    fn pack_every_other(self, odd: bool, lo: V<S, T, W>, hi: V<S, T, W>) -> V<S, T, W> {
        let mask = (!self.zero()).shift_in_pairs(false);
        let (lo, hi) = if odd { (lo.shift_in_pairs(false), hi.shift_in_pairs(false)) } else { (lo & mask, hi & mask) };
        choose! {
            size_of::<T>() == 1 => self.repartition::<u8>().ordered_demote2_to(lo.bitcast::<i16>(), hi.bitcast()).bitcast(),
            _ => self.repartition::<u16>().ordered_demote2_to(lo.bitcast::<i32>(), hi.bitcast()).bitcast(),
        }
    }
    #[on(X86 WASM)]
    #[op]
    fn group4(self, from: &[T]) -> V<S, u32, W> {
        let v = self.load(from).raw;
        self.wrap(v.shuffle::<_, { p::GROUP4_IN_BLOCK }, 0>(v)).bitcast()
    }
    #[on(X86 WASM)]
    #[op]
    fn transpose_blocks(self, v: V<S, u64, W>) -> V<S, T, W> {
        let v = v.bitcast::<u32>().raw;
        V::<S, u32, W>::new(self.s, v.shuffle::<_, { p::TRANSPOSE_BLOCKS }, 0>(v)).bitcast()
    }

    /// False in each lane.
    #[op]
    pub(crate) fn mask_false(self) -> MaskOf<T, W, S> {
        crate::mask::Mask::from_full(self.zero())
    }
    /// True in each lane.
    #[op]
    pub(crate) fn mask_true(self) -> MaskOf<T, W, S> {
        halves_if!(S::A64 && W::BYTES > 16, |d: Self = self| crate::mask::Mask::combine(d.half().mask_true(), d.half().mask_true()));
        crate::mask::Mask::from_full(!self.zero())
    }
    #[op]
    pub(crate) fn mask_from_number(self, bits: u64) -> MaskOf<T, W, S> {
        self.mask_from_bits(bits).given()
    }
    /// True in the first `n` lanes. `n` can be more than there are.
    #[op]
    pub(crate) fn first_n(self, n: usize) -> MaskOf<T, W, S> {
        halves_if!(Self::LANES > 64, |this: Self = self, n: usize = n| {
            crate::Mask::join(this.part::<W>().first_n(n), this.part::<W>().first_n(n.saturating_sub(Self::LANES / 2)))
        });
        return_if!(crate::X86 && Self::FIRST_BY_TABLE, {
            let from = crate::maskmov::edge(n.min(Self::LANES) * size_of::<T>());
            crate::Mask::from_full(self.repartition::<u8>().load(from).bitcast::<T>())
        });
        choose! {
            crate::X86 && S::HAS_MASKED_MEMORY => self.mask_from_number(first_bits(self.s, n, Self::LANES)),
            S::SVE2 && W::BYTES <= 16 => crate::mask::Mask::from_full(self.wrap(Bits::from_native(W::from16(self.s.first_lanes(n, size_of::<T>()))))),
            S::NEON && size_of::<T>() == 8 => {
                let d = self.to_unsigned();
                d.wrap(Raw::iota()).simd_lt(d.set(Lane::from_usize(n))).retype()
            },
            _ => {
                let d = self.to_signed();
                d.wrap(Raw::iota()).simd_lt(d.set(Lane::from_usize(n.min(Self::LANES)))).retype()
            },
        }
    }
    /// Whether what follows from a number of lanes is loaded. The move of the number to all lanes takes longer.
    pub(crate) const FIRST_BY_TABLE: bool = S::SSE2
        && !S::HAS_MASKED_MEMORY
        && W::BYTES <= S::REGISTER
        && W::BYTES <= 32
        && !cfg!(all(target_feature = "avx512bw", target_feature = "avx512vl"));
    /// `select` by such a mask, of which LLVM doesn't know that its lanes are 0 or -1.
    #[op]
    pub(crate) fn by_place(self, mask: MaskOf<T, W, S>, yes: V<S, T, W>, no: V<S, T, W>) -> V<S, T, W> {
        return_if!(crate::X86 && Self::FIRST_BY_TABLE, {
            let zero = always!(|v: V<S, T, W>| are_known!(v.bytes()) && v.bytes().eq(Raw::splat(0)).all());
            if zero(no) {
                mask.if_then_else_zero(yes)
            } else if zero(yes) {
                mask.if_then_zero_else(no)
            } else if const { S::SSE41 } {
                mask.if_then_else(yes, no)
            } else {
                mask.if_then_else_zero(yes) | mask.if_then_zero_else(no)
            }
        });
        mask.if_then_else(yes, no)
    }
    /// The same, if the other lanes of `v` are zero.
    #[op]
    pub(crate) fn padded_with(self, first: MaskOf<T, W, S>, v: V<S, T, W>, no: V<S, T, W>) -> V<S, T, W> {
        return_if!(!crate::OPTIMIZED && S::A64 || crate::X86 && Self::FIRST_BY_TABLE, v | first.if_then_zero_else(no));
        first.if_then_else(v, no)
    }
    /// True in all lanes but the last `n < LANES`. With bits it is one shift, which LLVM moves out of loops, unlike `bzhi`.
    #[op]
    pub(crate) fn all_but_last(self, n: usize) -> MaskOf<T, W, S> {
        return_if!(
            Self::BY_BITS && Self::LANES <= 64,
            self.mask_from_number(!0 >> (64 - Self::LANES.min(64)) >> (n % 64))
        );
        self.first_n(Self::LANES - n)
    }
    /// Lane `i` is bit `i`. `LoadMaskBits`.
    #[op]
    pub(crate) fn mask_from_bits(self, bits: u64) -> MaskOf<T, W, S> {
        halves_if!(W::BYTES > 64, |this: Self = self, bits: u64 = bits| {
            crate::Mask::join(this.part::<W>().mask_from_bits(bits), this.part::<W>().mask_from_bits(bits.unbounded_shr(Self::LANES as u32 / 2)))
        });
        return_if!(S::REGISTER < 64 && Self::LANES <= T::BITS as usize, {
            let d = self.to_unsigned();
            let weights = d.set(Lane::from_usize(1)) << d.wrap(Raw::iota());
            d.set(Lane::from_u64(bits)).has_bit(weights).retype()
        });
        return_if!(!MaskOf::<T, W, S>::IS_BITS && size_of::<T>() == 1 && W::BYTES >= 16, self.mask_from_bytes(bits, 7));
        return_if!(W::BYTES > S::REGISTER && S::REGISTER < 64 && size_of::<T>() == 2, {
            // One broadcast for all registers. LLVM takes the plain form apart.
            let (d, bytes) = (self.to_unsigned(), self.repartition::<u8>().iota(0));
            let from = bytes >> 5 << 1 | bytes & 1;
            let weights = d.set(Lane::from_usize(1)) << d.wrap(Raw::iota());
            self.repartition::<u64>().set(bits).table_lookup_bytes(from).bitcast().has_bit(weights).retype()
        });
        crate::mask::Mask::from_bits(
            self.s,
            choose! { crate::X86 && (S::REGISTER == 64 || cfg!(target_feature = "avx512f")) && (cfg!(target_arch = "x86") || !crate::OPTIMIZED) => crate::regs::word(bits), _ => bits },
        )
    }
    /// For lanes of 8 bits: each eight of them take the byte of `bits` at their index, of which only `last` counts.
    /// LLVM can take a vector of booleans apart that is cast from a number.
    #[op]
    pub(crate) fn mask_from_bytes(self, bits: u64, last: u8) -> MaskOf<T, W, S> {
        let d = self.repartition::<u8>();
        let bytes = self.repartition::<u64>().set(bits).table_lookup_bytes(d.iota(0) >> 3 & last);
        bytes.has_bit(d.set(1) << d.iota(0)).retype()
    }
    /// The lanes of `lo`, and then those of `hi`.
    #[op]
    pub(crate) fn combine_masks(self, hi: MaskOf<T, W::Half, S>, lo: MaskOf<T, W::Half, S>) -> MaskOf<T, W, S> {
        crate::mask::Mask::combine(hi, lo)
    }
    /// The lanes of `a` and then those of `b`, which are twice as wide as these.
    #[op]
    #[track_caller]
    pub(crate) fn ordered_demote2_masks_to<U: Lane>(self, a: MaskOf<U, W, S>, b: MaskOf<U, W, S>) -> MaskOf<T, W, S> {
        require!("the lanes of the arguments have to be twice as wide as those of the result", size_of::<U>() == 2 * size_of::<T>(), at any width size_of::<U>() == 2 * size_of::<T>() || size_of::<U>() == size_of::<T>());
        crate::mask::Mask::narrow_from(a, b)
    }

    /// The bits of `v` as lanes of `T`. The same as [`Simd::bitcast`].
    #[inline(always)]
    pub(crate) fn bitcast<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        v.bitcast()
    }
    /// Cuts `v`, or extends it with zeros.
    #[op]
    pub(crate) fn resize_bitcast<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        return_if!(
            cfg!(target_endian = "big") && size_of::<T>() == size_of::<U>(),
            self.wrap(Bits::from_native(crate::raw::resize::<X, W>(v.raw.to_native())))
        );
        self.wrap(Bits::from_bytes(crate::raw::resize::<X, W>(v.bytes())))
    }
    /// Between widths of up to 16 bytes: cuts `v`, or extends it with unspecified lanes.
    #[op]
    pub(crate) fn resize_any<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        return_if!(
            cfg!(target_endian = "big") && size_of::<T>() == size_of::<U>(),
            self.wrap(Bits::from_native(W::from16(X::to16(v.raw.to_native()))))
        );
        self.wrap(Bits::from_bytes(W::from16(X::to16(v.bytes()))))
    }
    /// The lanes of `lo`, and then those of `hi`.
    #[op]
    #[track_caller]
    pub(crate) fn combine(self, hi: V<S, T, W::Half>, lo: V<S, T, W::Half>) -> V<S, T, W> {
        require!("one lane has no halves", Self::LANES > 1 && W::BYTES > 2);
        self.wrap(lo.raw.shuffle::<_, { p::PART }, 0>(hi.raw))
    }
    /// The lanes of `lo`, and then zeros. `ZeroExtendVector`.
    #[op]
    #[track_caller]
    pub(crate) fn zero_extend(self, lo: V<S, T, W::Half>) -> V<S, T, W> {
        self.combine(lo.tag().zero(), lo)
    }
    shuffles! {
        /// The even lanes of `lo`, and then those of `hi`.
        concat_even = STRIDE 0;
        /// The odd lanes of `lo`, and then those of `hi`.
        concat_odd = STRIDE 1;
        /// The lower half of `lo`, and then that of `hi`.
        concat_lower_lower = LOWER_LOWER 0;
        /// The upper half of `lo`, and then that of `hi`.
        concat_upper_upper = UPPER_UPPER 0;
        /// The upper half of `lo`, and then the lower half of `hi`.
        concat_lower_upper = LOWER_UPPER 0;
        /// The lower half of `lo`, and then the upper half of `hi`.
        concat_upper_lower = UPPER_LOWER 0;
    }
    /// The lanes of `lo` from `K` on, and then the first `K` of `hi`.
    #[op]
    #[track_caller]
    pub(crate) fn combine_slide_down<const K: usize>(self, hi: V<S, T, W>, lo: V<S, T, W>) -> V<S, T, W> {
        require!("`K` is more than the number of lanes", K <= Self::LANES);
        if const { W::BYTES == 64 && size_of::<T>() == 1 && K % 4 == 0 } {
            return lo.bitcast::<u32>().shuffle::<{ p::SLIDE_DOWN_BYTES }, K>(hi.bitcast()).bitcast();
        }
        return_if!(crate::X86 && Self::aligns::<K>(), lo.shuffle::<{ p::ALIGN_RIGHT }, K>(self.between(hi, lo)));
        on_x86!(self.wrap(lo.raw.shuffle::<_, { p::SLIDE_DOWN }, K>(hi.raw)), shuffled::<{ p::SLIDE_DOWN }, K>())
    }
    /// The last `K` lanes of `lo`, and then those of `hi`: for each lane of `hi`, what is `K` lanes before it.
    #[op]
    #[track_caller]
    pub(crate) fn combine_slide_up<const K: usize>(self, hi: V<S, T, W>, lo: V<S, T, W>) -> V<S, T, W> {
        require!("`K` is more than the number of lanes", K <= Self::LANES);
        return_if!(crate::X86 && Self::aligns::<K>(), hi.shuffle::<{ p::SHIFT_LEFT }, K>(self.between(hi, lo)));
        on_x86!(self.wrap(hi.raw.shuffle::<_, { p::SLIDE_UP }, K>(lo.raw)), shuffled::<{ p::SLIDE_UP }, K>())
    }
    /// Whether LLVM would take `vpermt2w` or `vpermt2b`, for which Intel's CPUs need 7 cycles, and 4 for `vperm2i128` and `vpalignr`.
    const fn aligns<const K: usize>() -> bool {
        let bytes = K * size_of::<T>();
        S::REGISTER == 64
            && W::BYTES == 32
            && bytes % 4 != 0
            && bytes < 16
            && (crate::vector::two_tables::<S, T>() || bytes % 2 == 0)
    }
    #[on(X86)]
    #[op]
    fn between(self, hi: V<S, T, W>, lo: V<S, T, W>) -> V<S, T, W> {
        self.concat_lower_upper(hi, lo).hidden_unless_known()
    }

    /// `as` for each lane.
    #[op]
    #[track_caller]
    pub(crate) fn cast<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            X::BYTES / size_of::<U>() == Self::LANES
        );
        if const { V::<S, T, W>::HALF || V::<S, U, X>::HALF } {
            return self.cast_half(v);
        }
        return_if!(S::A64 && T::BITS == 8 && U::BITS >= 32 && X::BYTES <= 16 && !matches!(U::KIND, Kind::Float), |this: Self = self, v: V<S, U, X> = v| {
            // In a loop, LLVM would look up in four registers.
            let d = this.s.fixed::<u8, B16>();
            this.resize_bitcast(d.opaque(d.resize_bitcast(v).raw).table_lookup_bytes(d.from_fn(#[inline(always)] |i| (i * size_of::<U>() % 16) as u8)))
        });
        return_if!(S::A64 && U::BITS == 4 * T::BITS && X::BYTES == 64 && !U::IS_FLOAT && !T::IS_FLOAT, |this: Self = self, v: V<S, U, X> = v| {
            // The first step takes in a shift or a sum.
            let half = this.s.fixed::<<U::Unsigned as Int>::Narrow, X::Half>();
            this.cast(half.cast(v).black_box())
        });
        self.wrap(v.raw.cast())
    }
    /// To a wider type. It doesn't build if the numbers of lanes differ.
    #[op]
    #[track_caller]
    pub(crate) fn promote_to<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!("the lanes of the argument have to be narrower than those of the result", size_of::<U>() < size_of::<T>(), at any width size_of::<U>() <= size_of::<T>());
        self.promote(v)
    }
    /// For branches that are dead for some types of lanes.
    #[op]
    #[track_caller]
    pub(crate) fn promote<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            X::BYTES / size_of::<U>() == Self::LANES
        );
        halves_if!(W::BYTES > 64, |d: Self = self, v: V<S, U, X> = v| d.combine(d.half().promote(v.upper_half()), d.half().promote(v.lower_half())));
        // rustc makes code for the value of a variable with debug information, also in dead branches.
        (const {
            let way: fn(Self, V<S, U, X>) -> V<S, T, W> = if V::<S, T, W>::HALF || V::<S, U, X>::HALF {
                Self::cast_half
            } else if matches!(U::KIND, Kind::Float) || matches!(T::KIND, Kind::Float) {
                Self::promote_float
            } else if !(S::NEON && X::BYTES < 8 && U::BITS < T::BITS && X::BYTES / size_of::<U>() == Self::LANES) {
                Self::promote_exactly
            } else {
                // LLVM only has a good way for whole registers.
                match (U::BITS, matches!(U::KIND, Kind::Signed)) {
                    (8, true) => Self::promote_by::<i16, U, X>,
                    (8, _) => Self::promote_by::<u16, U, X>,
                    (16, true) => Self::promote_by::<i32, U, X>,
                    (16, _) => Self::promote_by::<u32, U, X>,
                    (_, true) => Self::promote_by::<i64, U, X>,
                    _ => Self::promote_by::<u64, U, X>,
                }
            };
            way
        })(self, v)
    }
    #[op]
    fn promote_float<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        if let Some(done) = self.float_to_other_size(v) {
            return done;
        }
        self.cast(v)
    }
    #[inline(always)]
    fn promote_exactly<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        self.cast(v)
    }
    #[op]
    fn promote_by<M: Lane, U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let wide = self.s.fixed::<M, B16>().cast(self.s.fixed::<U, B8>().resize_any(v));
        let wide = wide.tag().opaque(wide.raw);
        return_if!(T::BITS == M::BITS, |d: Self = self, wide: V<S, M, B16> = wide| d.resize_any(wide));
        self.promote(self.s.fixed::<M, X::Twice>().resize_any(wide))
    }
    /// The lower half of `v`, whose lanes are half as wide as these.
    #[op]
    #[track_caller]
    pub(crate) fn promote_lower_to<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        require!(
            "the lanes of the argument have to be half as wide as those of the result",
            size_of::<T>() == 2 * size_of::<U>()
        );
        self.promote_to(v.lower_half())
    }
    /// The upper half of `v`, whose lanes are half as wide as these.
    #[op]
    #[track_caller]
    pub(crate) fn promote_upper_to<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        require!(
            "the lanes of the argument have to be half as wide as those of the result",
            size_of::<T>() == 2 * size_of::<U>()
        );
        self.promote_to(v.upper_half())
    }
    /// To a narrower type. Integers saturate. It doesn't build if the numbers of lanes differ.
    #[op]
    #[track_caller]
    pub(crate) fn demote_to<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!("the lanes of the argument have to be wider than those of the result", size_of::<U>() > size_of::<T>(), at any width size_of::<U>() >= size_of::<T>());
        self.demote(v)
    }
    /// For branches that are dead for some types of lanes.
    #[op]
    #[track_caller]
    pub(crate) fn demote<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            X::BYTES / size_of::<U>() == Self::LANES
        );
        apart_unoptimized!(self.s, {
            return_if!(
                X::BYTES > 64 && (W::BYTES > S::REGISTER || U::BITS == 64 || matches!(U::KIND, Kind::Float) || matches!(T::KIND, Kind::Float)),
                |d: Self = self, v: V<S, U, X> = v| d.combine(d.half().demote(v.upper_half()), d.half().demote(v.lower_half()))
            );
            // rustc makes code for the value of a variable with debug information, also in dead branches.
            (const {
                let way: fn(Self, V<S, U, X>) -> V<S, T, W> = if V::<S, T, W>::HALF || V::<S, U, X>::HALF {
                    Self::cast_half
                } else if matches!(U::KIND, Kind::Float) || matches!(T::KIND, Kind::Float) {
                    Self::demote_float
                } else if U::BITS <= T::BITS || X::BYTES / size_of::<U>() != Self::LANES
                // Without vectors, steps take more instructions.
                || S::SCALAR
                // AVX-512 has an instruction for each pair of types.
                || S::COMPRESS[2] == 64 && X::BYTES <= 64 && !(U::BITS <= 32 && if U::BITS == 2 * T::BITS { X::BYTES <= if U::IS_SIGNED || T::IS_SIGNED { 32 } else { 16 } } else { X::BYTES <= 16 && matches!(U::KIND, Kind::Signed) })
                {
                    Self::demote_clamped
                } else if S::SSE42
                    && U::BITS == 64
                    && matches!(T::KIND, Kind::Unsigned)
                    && (X::BYTES <= 16 || X::BYTES == S::REGISTER && T::BITS == 8)
                {
                    Self::demote_by_lookup
                } else if U::BITS == 2 * T::BITS {
                    if X::BYTES <= 16 { Self::demote_block } else { Self::demote_halves }
                } else if crate::X86 && U::BITS == 32 && W::BYTES == S::REGISTER && W::BYTES > 16 {
                    Self::demote_quarters
                } else if crate::X86 && U::BITS == 32 && X::BYTES == 64 && S::REGISTER == 32 {
                    Self::demote_two
                } else if crate::X86 && U::BITS == 32 && X::BYTES == 128 && S::REGISTER == 64 {
                    Self::demote_pair
                } else if crate::X86 || matches!(U::KIND, Kind::Signed) {
                    // In steps. x86 only packs signed lanes.
                    if U::BITS == 64 { Self::demote_by::<i32, U, X> } else { Self::demote_by::<i16, U, X> }
                } else if U::BITS == 64 {
                    Self::demote_by::<u32, U, X>
                } else {
                    Self::demote_by::<u16, U, X>
                };
                way
            })(self, v)
        })
    }
    #[op]
    fn demote_float<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        if let Some(done) = self.float_to_other_size(v) {
            return done;
        }
        self.demote_clamped(v)
    }
    #[op]
    fn demote_clamped<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        if const {
            S::LEVEL >= crate::simd::AVX512
                && W::BYTES < 16
                && U::BITS > T::BITS
                && !U::IS_FLOAT
                && !T::IS_FLOAT
                && (U::IS_SIGNED || !T::IS_SIGNED)
        } {
            use crate::simd::saturated;
            let bytes = choose! { U::IS_SIGNED && !T::IS_SIGNED => v.simd_max(U::default()), _ => v }.bytes();
            return self.wrap(crate::raw::Bits::from_bytes(W::from16(choose! {
                X::BYTES == 64 => saturated::<S, U::Stored, T::Stored, 64>(X::to64(bytes)),
                X::BYTES == 32 => saturated::<S, U::Stored, T::Stored, 32>(X::to32(bytes)),
                _ => saturated::<S, U::Stored, T::Stored, 16>(X::to16(bytes)),
            })));
        }
        self.cast(v.clamp_to::<T>())
    }
    #[op]
    fn demote_by_lookup<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let too_big = v.simd_gt(U::from_u64(u64::MAX >> (64 - T::BITS))).to_simd::<U>();
        let v = choose! { matches!(U::KIND, Kind::Signed) => v.to_mask().if_then_zero_else(v), _ => v } | too_big;
        let size = size_of::<T>();
        let mut order = [0x80; 32];
        for i in 0..2 * size {
            (order[i], order[16 + 2 * size + i]) = ((i / size * 8 + i % size) as u8, (i / size * 8 + i % size) as u8);
        }
        let lanes = v.table_lookup_bytes(v.tag().repartition::<u8>().load(&order));
        choose! {
            X::BYTES <= 16 => self.resize_any(lanes),
            _ => self.resize_any(lanes.lower_half() | lanes.upper_half()),
        }
    }
    #[op]
    fn demote_block<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let v = self.s.fixed::<U, B16>().resize_any(v);
        self.resize_any(v.tag().repartition::<T>().pack(v, v))
    }
    #[op]
    fn demote_halves<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        return_if!(S::AVX2 && X::BYTES == 32 && U::BITS <= 32 && !U::IS_SIGNED && !T::IS_SIGNED, {
            let v = v.clamp_to::<T>().cast_signed();
            self.pack::<U::Signed>(v.lower_half().same(), v.upper_half().same())
        });
        let half = self.repartition::<U>();
        self.pack_in_order(half.resize_bitcast(v.lower_half()), half.resize_bitcast(v.upper_half()))
    }
    /// Four registers to one, which is put in order at the end.
    #[op]
    fn demote_quarters<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let (d, middle) = (self.repartition::<U>(), self.repartition::<i16>());
        let two = always!(
            |v: V<S, U, X::Half>| middle.pack(d.resize_bitcast(v.lower_half()), d.resize_bitcast(v.upper_half()))
        );
        self.pack(two(v.lower_half()), two(v.upper_half()))
            .bitcast::<u32>()
            .swizzle(
                #[inline(always)]
                |i| i % (W::BYTES / 16) * 4 + i / (W::BYTES / 16),
            )
            .bitcast()
    }
    /// The same for two registers.
    #[op]
    fn demote_pair<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let d = self.s.fixed::<T, X::Half>();
        let middle = d.repartition::<i16>().pack(v.lower_half(), v.upper_half());
        let twice = d.pack(middle, middle).bitcast::<u32>().swizzle(
            #[inline(always)]
            |i| i % (X::BYTES / 32) * 4 + i / (X::BYTES / 32),
        );
        self.resize_bitcast(twice.lower_half())
    }
    /// The same, to 16 bytes.
    #[op]
    fn demote_two<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let middle = self.s.fixed::<i16, X::Half>().pack(v.lower_half(), v.upper_half()).barrier();
        let both = self.pack::<i16>(middle.lower_half().same(), middle.upper_half().same());
        both.bitcast::<u32>().shuffle4::<0b11_01_10_00>().bitcast()
    }
    #[op]
    fn demote_by<M: Lane, U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        self.demote(self.s.fixed::<M, X::Half>().demote(v))
    }
    /// The lanes of `a` and then those of `b`, which are twice as wide as these, with saturation.
    #[op]
    #[track_caller]
    pub(crate) fn ordered_demote2_to<U: Int>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        require!("the lanes of the arguments have to be twice as wide as those of the result", size_of::<U>() == 2 * size_of::<T>(), at any width size_of::<U>() == 2 * size_of::<T>() || size_of::<U>() == size_of::<T>());
        if const { W::BYTES <= 16 } {
            return self.reorder_demote2_to(a, b);
        }
        return_if!(
            W::BYTES > 16 && S::COMPRESS[2] == 64 && T::BITS == 32 && 2 * W::BYTES <= S::REGISTER,
            self.demote_to(V::<S, U, W::Twice>::new(self.s, a.raw.shuffle::<_, { p::PART }, 0>(b.raw)))
        );
        return_if!(
            W::BYTES > 16
                && (S::COMPRESS[2] == 64 && T::BITS == 32 && U::IS_SIGNED && T::IS_SIGNED && !T::IS_FLOAT || S::SCALAR),
            self.combine(self.half().demote(b), self.half().demote(a))
        );
        // One shuffle, which LLVM doesn't repeat for each use.
        return_if!(S::AVX512VBMI && T::BITS == 8 && !U::IS_SIGNED && W::BYTES == 64, {
            let most = a.tag().set(U::from_usize(if T::IS_SIGNED { 127 } else { 255 }));
            self.concat_even(b.simd_min(most).bitcast(), a.simd_min(most).bitcast())
        });
        self.pack_in_order(a, b)
    }
    #[op]
    fn pack_in_order<U: Lane>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        halves_if!(W::BYTES > 64, |this: Self = self, a: V<S, U, W> = a, b: V<S, U, W> = b| {
            let (half, [a0, a1], [b0, b1]) = (this.part::<W>(), a.parts::<W>(), b.parts::<W>());
            this.join(half.pack_in_order(a0, a1), half.pack_in_order(b0, b1))
        });
        // For speed.
        halves_if!((S::A64 || S::WASM) && W::BYTES > 16, |this: Self = self, a: V<S, U, W> = a, b: V<S, U, W> = b| {
            let half = this.half();
            this.combine(half.pack_in_order(b.lower_half(), b.upper_half()), half.pack_in_order(a.lower_half(), a.upper_half()))
        });
        let packed = self.pack(a, b).bitcast::<u64>();
        return_if!(W::BYTES <= 16, packed.bitcast());
        let (even, odd): (RawOf<u64, W>, RawOf<u64, W>) = (
            packed.raw.shuffle::<_, { p::STRIDE }, 0>(packed.raw),
            packed.raw.shuffle::<_, { p::STRIDE }, 1>(packed.raw),
        );
        packed.with(even.shuffle::<_, { p::LOWER_LOWER }, 0>(odd)).bitcast()
    }
    /// In blocks of 16 bytes, from integers that are twice as wide.
    #[inline(always)]
    fn pack<U: Lane>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        apart_unoptimized!(self.s, {
            let (s, x, y, d) = (self.s, a.bytes(), b.bytes(), self.to_unsigned());
            let (from_signed, to_signed) = (U::KIND == Kind::Signed, T::KIND == Kind::Signed);
            let wrap = always!(|bytes| d.wrap(Bits::from_bytes(bytes)));
            let max = (!self.sign_bit()).cast_unsigned();
            let packed = if const { S::NEON && (T::BITS == 32 || matches!(U::KIND, Kind::Unsigned)) } {
                wrap(match T::BITS {
                    8 => s.pack_u16_u8::<W>(x, y),
                    16 => s.pack_u32_u16::<W>(x, y),
                    _ if !from_signed => s.pack_u64_u32::<W>(x, y),
                    _ if to_signed => s.pack_i64_i32::<W>(x, y),
                    _ => s.pack_i64_u32::<W>(x, y),
                })
            } else if const { T::BITS == 32 } {
                live!(T::BITS == 32, {
                    let (a, b) = (a.bitcast::<i32>(), b.bitcast::<i32>());
                    let (low, high) =
                        (a.shuffle::<{ p::STRIDE_IN_BLOCK }, 0>(b), a.shuffle::<{ p::STRIDE_IN_BLOCK }, 1>(b));
                    match (from_signed, to_signed) {
                        (true, true) => high.simd_eq(low >> 31).if_then_else(low, high >> 31 ^ i32::MAX),
                        (true, _) => (high >> 31).and_not(low | high.simd_gt(0).to_vector()),
                        _ => low | high.simd_ne(0).to_vector(),
                    }
                    .bitcast()
                })
            } else if to_signed {
                // What is negative after this is above the maximum as an unsigned number.
                wrap(if const { T::BITS == 8 } { s.pack_i16_i8::<W>(x, y) } else { s.pack_i32_i16::<W>(x, y) })
            } else {
                let (x, y) = if from_signed { (x, y) } else { (a.clamp_to::<T>().bytes(), b.clamp_to::<T>().bytes()) };
                wrap(if const { T::BITS == 8 } { s.pack_i16_u8::<W>(x, y) } else { s.pack_i32_u16::<W>(x, y) })
            };
            if to_signed && !from_signed { packed.simd_min(max) } else { packed }.bitcast()
        })
    }
    /// The same within each block: the lanes of a block of `a`, and then those of that block of `b`.
    #[op]
    #[track_caller]
    pub(crate) fn reorder_demote2_to<U: Int>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        require!("the lanes of the arguments have to be twice as wide as those of the result", size_of::<U>() == 2 * size_of::<T>(), at any width size_of::<U>() == 2 * size_of::<T>() || size_of::<U>() == size_of::<T>());
        if const { W::BYTES > 16 || W::BYTES == 16 && !(S::COMPRESS[2] == 64 && T::BITS == 32 || S::SCALAR) } {
            return self.pack(a, b);
        }
        self.demote_to(V::<S, U, W::Twice>::new(self.s, a.raw.shuffle::<_, { p::PART }, 0>(b.raw)))
    }
}

impl<S: Isa, T: Int, W: Width> Tag<S, T, W> {
    /// The positions of the bits that are set, in order. The lanes after them are unspecified.
    #[op]
    pub(crate) fn set_bit_indices(self, bits: u64) -> V<S, T, W> {
        return_if!(W::BYTES / size_of::<T>() == 8, self.wrap(Raw::cast(crate::ops::set_bits(bits))));
        self.wrap(Raw::iota()).compress_own(bits)
    }
    /// The lower bits of a wider integer. It doesn't build if the numbers of lanes differ.
    #[op]
    #[track_caller]
    pub(crate) fn truncate_to<U: Int, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!("the lanes of the argument have to be wider than those of the result", size_of::<U>() > size_of::<T>(), at any width size_of::<U>() >= size_of::<T>());
        self.cast(v)
    }
    /// `promote_to(a) * promote_to(b)`, for lanes that are half as wide as these. In this form LLVM finds `smull`.
    #[op]
    #[track_caller]
    pub(crate) fn widen_mul<U: Int>(self, a: V<S, U, W::Half>, b: V<S, U, W::Half>) -> V<S, T, W> {
        const { crate::make::Fits::<0, (U, T)>::TWICE };
        require!(
            "the lanes of the arguments have to be half as wide as those of the result",
            size_of::<T>() == 2 * size_of::<U>()
        );
        if_here!(S::ARM && W::BYTES < 16, {
            let half = self.s.fixed::<U, crate::B8>();
            return self.resize_any(self.s.fixed::<T, B16>().widen_mul(half.resize_any(a), half.resize_any(b)));
        });
        if_here!(crate::X86 && S::REGISTER == 64 && size_of::<U>() == 4 && size_of::<T>() == 8, {
            let d = self.repartition::<u64>();
            let (a, b) = (d.cast(a.cast_unsigned()).bitcast::<U>(), d.cast(b.cast_unsigned()).bitcast::<U>());
            return a.widening_mul_even(b).bitcast();
        });
        if_here!(crate::X86 && S::SSE2 && !S::SSE41 && size_of::<U>() == 2 && W::BYTES < 16, {
            let half = self.s.fixed::<U, crate::B8>();
            return self.resize_any(self.s.fixed::<T, B16>().widen_mul(half.resize_any(a), half.resize_any(b)));
        });
        if_here!(crate::X86 && S::SSE2 && !S::SSE41 && size_of::<U>() == 2, {
            let [lower, upper] = (a * b).interleave(a.mul_high_16(b));
            return if W::BYTES == 16 {
                self.resize_bitcast(lower.concat(upper))
            } else {
                self.combine(upper.bitcast(), lower.bitcast())
            };
        });
        macro_rules! hidden {
            ($v:ident) => {
                if const { crate::OPTIMIZED } {
                    core::hint::select_unpredictable(S::A64 && are_known!($v.raw), $v, $v.tag().opaque($v.raw))
                } else {
                    $v
                }
            };
        }
        return_if!(S::A64 && W::BYTES >= 32, {
            let (lower, upper) = a.mul_halves(b);
            self.combine(upper.bitcast(), lower.bitcast())
        });
        let (a, b) = (hidden!(a), hidden!(b));
        if_here!(S::A64 && size_of::<U>() == 4, {
            return self.long_products(a, b);
        });
        let (a, b) = (self.cast(a), self.cast(b));
        a * b
    }
    /// There is no other multiplication of 64 bits.
    #[on(A64)]
    #[op]
    fn long_products<U: Int>(self, a: V<S, U, W::Half>, b: V<S, U, W::Half>) -> V<S, T, W> {
        let bytes = |v: V<S, U, W::Half>| <W::Half as crate::width::Repr>::to16(v.bytes());
        self.wrap(Bits::from_bytes(W::from16(self.s.long_products(bytes(a), bytes(b), U::IS_SIGNED))))
    }
    /// The lower bits of the lanes of `a` and then of `b`, which are twice as wide as these.
    #[op]
    #[track_caller]
    pub(crate) fn ordered_truncate2_to<U: Int>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        require!("the lanes of the arguments have to be twice as wide as those of the result", size_of::<U>() == 2 * size_of::<T>(), at any width size_of::<U>() == 2 * size_of::<T>() || size_of::<U>() == size_of::<T>());
        self.truncate2(a, b)
    }
    /// For branches that are dead for some types of lanes.
    #[op]
    pub(crate) fn truncate2<U: Int>(self, a: V<S, U, W>, b: V<S, U, W>) -> V<S, T, W> {
        return_if!(S::SSE41 && S::COMPRESS[2] != 64 && T::BITS <= 16 && W::BYTES >= 16, {
            let lower = U::Signed::from_usize((1 << T::BITS) - 1);
            self.to_unsigned().pack_in_order(a.cast_signed() & lower, b.cast_signed() & lower).bitcast()
        });
        // As casts, which take in a shift or a sum.
        halves_if!(S::A64 && U::BITS == 2 * T::BITS && W::BYTES > 64, |d: Self = self, a: V<S, U, W> = a, b: V<S, U, W> = b| {
            d.combine(d.half().truncate2(b.lower_half(), b.upper_half()), d.half().truncate2(a.lower_half(), a.upper_half()))
        });
        return_if!(
            S::A64 && U::BITS == 2 * T::BITS && W::BYTES >= 16,
            self.combine(self.half().cast(b), self.half().cast(a))
        );
        self.concat_even(b.bitcast(), a.bitcast())
    }
}

impl<S: Isa, T: crate::Unsigned, W: Width> Tag<S, T, W> {
    /// Writes `first + i` for each bit `i` that is set, in order, and returns how many. `to` needs room for 64 values,
    /// and all of them can change.
    #[inline(always)]
    pub(crate) fn write_set_bit_indices<P: Place<T>>(self, bits: u64, first: T, to: P) -> usize {
        apart_unoptimized!(self.s, |to: P| {
            let mut to = to;
            if const { S::SCALAR } {
                let (mut bits, mut at) = (bits, 0);
                while bits != 0 {
                    to.write(at % 64, [T::from_u64(first.to_u64().wrapping_add(bits.trailing_zeros() as u64))]);
                    (bits, at) = (bits & (bits - 1), at + 1);
                }
                return at;
            }
            let count = bits.count_ones() as usize;
            if const { S::COMPRESS[0] == 64 && T::BITS <= 16 } {
                live!(S::COMPRESS[0] == 64 && T::BITS <= 16, {
                    let all = Tag::<S, u8, B64>::new(self.s).set_bit_indices(bits);
                    when!(T::BITS == 8, (all.bitcast::<T>() + first).write(&mut to, 0));
                    when!(T::BITS == 16, {
                        let d = Tag::<S, T, B64>::new(self.s);
                        (d.cast(all.lower_half()) + first).write(&mut to, 0);
                        if count > 32 {
                            (d.cast(all.upper_half()) + first).write(&mut to, 32);
                        }
                    });
                })
            } else if const { S::COMPRESS[0] == 64 } {
                live!(S::COMPRESS[0] == 64 && T::BITS > 16, {
                    let all = Tag::<S, u8, B64>::new(self.s).set_bit_indices(bits);
                    let part = always!(|block: V<S, u8, B16>| block.cast::<T>() + first);
                    part(all.block::<0>()).write(&mut to, 0);
                    if count > 16 {
                        part(all.block::<1>()).write(&mut to, 16);
                        if count > 32 {
                            part(all.block::<2>()).write(&mut to, 32);
                            part(all.block::<3>()).write(&mut to, 48);
                        }
                    }
                })
            } else if const { S::COMPRESS[2] == 64 } {
                live!(!(S::COMPRESS[0] == 64) && S::COMPRESS[2] == 64, {
                    let (d, mut at) = (Tag::<S, u32, B64>::new(self.s), 0);
                    // As a loop, LLVM adds `k` to `first` and broadcasts four times.
                    macro_rules! parts { ($($k:literal)*) => {$(
                choose! {
                    T::BITS == 64 => d.iota($k).compress_own(bits >> $k).cast::<T>() + first,
                    _ => (d.iota($k) + d.set(first.to_u64() as u32)).compress_own(bits >> $k).cast::<T>(),
                }.write(&mut to, at);
                at += (bits >> $k & 0xffff).count_ones() as usize;
            )*} }
                    parts!(0 16 32 48);
                    let _ = at;
                })
            } else {
                let (d, mut at) = (Tag::<S, T, crate::Scaled<u8, T, B8>>::new(self.s), 0);
                // NEON counts the bits of eight bytes at once, and has no scalar instruction for it.
                let neon = S::ARM;
                let sums = always!(|| {
                    let counts = Tag::<S, u8, B8>::new(self.s).from_array(bits.to_le_bytes()).count_ones();
                    u64::from_le_bytes(counts.to_array()).wrapping_mul(0x0101_0101_0101_0101)
                });
                // Long strings and sparse columns took half as long, and the rest 1 to 2% longer.
                if_here!(S::A64 || S::BMI1, {
                    // Sparse bitmaps took three quarters of the time.
                    if bits == 0 {
                        return 0;
                    }
                    let less = always!(|bits: u64| bits & bits.wrapping_sub(1));
                    let (a, b) = (less(bits), less(less(bits)));
                    let c = less(b);
                    if if neon { sums() >> 56 <= 4 } else { count <= 4 } {
                        let at =
                            always!(|bits: u64| T::from_u64(first.to_u64().wrapping_add(bits.trailing_zeros() as u64)));
                        to.write(0, [at(bits), at(a), at(b), at(c)]);
                        return if neon { (sums() >> 56) as usize } else { count };
                    }
                });
                let sums = sums();
                // The limit saves a check, and takes a register. An `Output` checks anyway.
                let most = if P::ANY_ORDER { 56 } else { u8::MAX };
                // A loop is not always unrolled.
                macro_rules! parts { ($($k:literal)*) => {$(
                let v = choose! {
                    // Each step widens and adds.
                    S::A64 && T::BITS >= 32 => {
                        let words = Tag::<S, u16, B16>::new(self.s);
                        // SVE adds a constant apart.
                        let k = choose! { S::SVE && $k > 0 => words.set($k).black_box(), _ => words.set($k) };
                        d.cast((words.set_bit_indices(bits >> $k) + k).barrier()) + d.set(first)
                    },
                    S::ARM => d.set_bit_indices(bits >> $k) + (d.set(first) + d.set(T::from_usize($k))),
                    _ => d.set_bit_indices(bits >> $k) + d.set(T::from_usize($k)) + d.set(first),
                };
                v.write(&mut to, at);
                at = if neon && $k < 24 { (sums >> $k) as usize % 32 } else if neon { ((sums >> $k) as u8).min(most) as usize } else { at + crate::ops::count_bits_on::<S>(bits >> $k, 8) };
            )*} }
                parts!(0 8 16 24 32 40 48 56);
                let _ = at;
                if neon {
                    return (sums >> 56) as usize;
                }
            }
            count
        })
    }
}

/// Whether the compiler knows that one or two plain accesses do, as for `[f32; 3]`. They need no test of the page.
#[op]
pub(crate) fn in_two_parts<T, W: Width>(len: usize) -> bool {
    crate::X86 && is_known!(len) && (len.count_ones() <= 2 || len >= W::BYTES / size_of::<T>())
}

/// The same number. LLVM sees that only when it selects instructions. Before, it would count in each round of a loop what only the last one needs.
#[op]
pub(crate) fn uncounted(len: usize) -> usize {
    // An odd factor keeps what is known of the lowest bits, and whether it is zero.
    if !crate::X86 || is_known!(len) { len } else { len.wrapping_mul(nothing(len) | 1).min(len) }
}
/// How many of the lanes have no value, if one has. It is for a path that is rarely taken. LLVM would move what follows from it before the loop.
#[op]
pub(crate) fn missing<T, W: Width>(len: usize) -> usize {
    const { assert!(W::BYTES.is_power_of_two() && size_of::<T>().is_power_of_two()) };
    let lanes = W::BYTES / size_of::<T>();
    (crate::regs::number(len.min(lanes) as u64) as usize).wrapping_neg() % lanes
}
#[op]
#[allow(unreachable_code, unused_variables)]
pub(crate) fn nothing(n: usize) -> usize {
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(bun_simd_unoptimized)))]
    return crate::simd::nothing(n as u32) as i32 as usize;
    0
}

const SLIDE: &[u8; 32] = &crate::Aligned({
    let (mut all, mut i) = ([0x80; 32], 0);
    while i < 16 {
        (all[i], i) = (i as u8, i + 1);
    }
    all
})
.0;

/// Skylake gains nothing in the mean.
#[op]
pub(crate) fn with_low_bits<S: Isa>(s: S) -> Option<S> {
    if const { S::AVX512VBMI } { Some(s) } else { None }
}
/// As partial accesses make them, so that they are made once.
#[op]
pub(crate) fn first_bits<S: Isa>(s: S, n: usize, lanes: usize) -> u64 {
    if const { S::AVX512VBMI } { crate::partial::first_on(s, n) } else { crate::partial::first_bits(n, lanes) }
}
/// The same for less than a vector.
#[op]
pub(crate) fn fewer_bits<S: Isa>(s: S, n: usize) -> u64 {
    if const { S::AVX512VBMI } { crate::partial::first_on(s, n) } else { !(!0 << n) }
}

/// Whether a vector at the start of `slice` can reach a page that the slice doesn't. If that page is not present, x86
/// takes 250 to 1000 cycles to find that the lanes in it are masked off. See docs/quirks.md.
#[op]
pub(crate) fn near_absent_page<T, W: Width>(slice: &[T]) -> bool {
    near_absent_page_at::<T, W>(slice.as_ptr().addr(), slice.is_empty())
}
/// The same for `vpmaskmov`, which gets another address for an empty slice. The callers say that it is rare, as LLVM drops that here.
#[on(X86)]
#[op]
pub(crate) fn words_near_absent_page<T, W: Width>(slice: &[T]) -> bool {
    slice.as_ptr().addr().wrapping_add(W::BYTES) % 4096 < W::BYTES
}
/// The same for loads of narrow lanes, or the CPU takes long for them.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
#[op]
fn without_words<T, W: Width>(slice: &[T]) -> bool {
    !(slice.as_ptr().addr() as u32) & crate::tuning::masked_loads() & (4096 - W::BYTES as u32) == 0
}
/// The same with one more instruction, for wide vectors: whether it does, or nearly.
#[on(X86)]
#[op]
pub(crate) fn reaches_absent_page<T, W: Width>(slice: &[T]) -> bool {
    // As below.
    if cfg!(miri) {
        return false;
    }
    let last = slice.as_ptr().addr().wrapping_add(W::BYTES - 1) % 4096 + size_of_val(slice);
    if last >= W::BYTES + 16 {
        return false;
    }
    core::hint::cold_path();
    slice.is_empty() || last < W::BYTES
}
/// The same. It seems to need the bits of the mask, so they are made before the branch, and the next access of that length takes them.
#[op]
pub(crate) fn near_absent_page_by_bits<T, W: Width>(s: impl Isa, slice: &[T]) -> bool {
    let bits = first_bits(s, slice.len(), W::BYTES / size_of::<T>()) as usize;
    let mixed = slice.as_ptr().addr() ^ bits;
    near_absent_page_at::<T, W>(mixed.wrapping_add(nothing(mixed)) ^ bits, slice.is_empty())
}
#[op]
pub(crate) fn near_absent_page_at<T, W: Width>(start: usize, empty: bool) -> bool {
    // Miri lacks what the other way calls.
    if !crate::X86 || cfg!(all(miri, target_feature = "avx512bw")) {
        return false;
    }
    // One test finds the end of a page and the start of one, where empty slices point nowhere or past a mapping. It goes the
    // other way for each address in 64, at a price of 20 cycles and more, so the range is no wider than it has to be.
    let some = is_known!(empty) && !empty;
    let (before, range) = match W::BYTES {
        _ if some => (W::BYTES, W::BYTES),
        // It misses a vector that is beyond by one lane, which costs time only: these have mask registers.
        64 => (63 - align_of::<T>(), 64),
        _ => (W::BYTES - 1, 2 * W::BYTES),
    };
    if start.wrapping_add(before) & (4096 - range) != 0 {
        return false;
    }
    core::hint::cold_path();
    some || empty || start & 2048 != 0
}
