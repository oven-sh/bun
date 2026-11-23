//! Loads and stores of special forms.

use crate::raw::{Bits, Raw};
use crate::{B16, Isa, Lane, MaskOf, Operand, Readable, Simd, Tag, Unsigned, Width};

type V<S, T, W> = Simd<T, W, S>;

/// A value at an address that is a multiple of 64. SSE can use what is loaded from it as an operand in memory.
/// It suits scratch memory on the stack, and a `Vec` of these is an aligned buffer, by [`bitcast_slice_mut`](crate::mem::bitcast_slice_mut).
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// static TABLE: Aligned<[u32; 4]> = Aligned([1, 2, 3, 4]);
/// assert_eq!(u32x4::load(&*TABLE).reduce_sum(), 10);
/// # } example()
/// ```
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
#[repr(C, align(64))]
pub struct Aligned<A>(pub A);

/// For a table of up to 256 bytes that is read at any offset: no load crosses a page.
#[repr(align(256))]
pub(crate) struct InPage<A>(pub A);

impl<A> core::ops::Deref for Aligned<A> {
    type Target = A;
    #[inline(always)]
    fn deref(&self) -> &A {
        &self.0
    }
}
impl<A> core::ops::DerefMut for Aligned<A> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut A {
        &mut self.0
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    const MASKED: bool = S::HAS_MASKED_MEMORY && W::BYTES >= 16 && W::BYTES <= S::REGISTER;
    /// Elsewhere LLVM branches for each lane.
    pub(crate) const GATHERS: bool = S::COMPRESS[2] == 64 && size_of::<T>() >= 4 && W::BYTES >= 16 && usize::BITS == 64;
    /// The instruction takes half the time from Sapphire Rapids on, and up to twice on the other CPUs of this level. Below 64 bytes, the branch doesn't pay.
    const TUNED: bool =
        crate::X86 && Self::GATHERS && (S::AVX512VBMI || size_of::<T>() == 8) && !S::FAST_GATHER && W::BYTES == 64;

    /// `load_or_default` for a length that the compiler knows.
    #[op]
    pub(crate) fn load_known(self, from: &[T]) -> V<S, T, W> {
        // Not by way of a general register.
        if_here!(
            S::A64 && crate::OPTIMIZED && W::BYTES == 16 && size_of::<T>() < 8,
            if from.len() == Self::LANES / 2 {
                return live!(S::A64 && W::BYTES == 16 && size_of::<T>() < 8, self.zero_extend(self.half().load(from)));
            }
        );
        apart_unoptimized!(self.simd(), { Simd::new(self.simd(), Raw::load_in_parts(from)) })
    }
    /// Zero where `mask` is false or `from` has ended. `MaskedLoad`.
    #[op]
    pub(crate) fn masked_load(self, mask: MaskOf<T, W, S>, from: &[T]) -> V<S, T, W> {
        return_if!(
            S::SVE2 && W::BYTES == 16,
            Simd::new(
                self.simd(),
                Bits::from_native(W::from16(self.simd().load_masked(from, W::to16(mask.to_vector().raw.to_native()))))
            )
        );
        // On AVX-512, a load that waits for the mask takes 1.2 to 1.8 times as long, and far more next to an absent page.
        if crate::arithmetic::known(from.len() >= Self::LANES) {
            return mask.if_then_else_zero(self.load(from));
        }
        mask.if_then_else_zero(self.load_n(from))
    }
    /// `group` again and again. Its size is a power of two up to 64 bytes.
    #[op]
    pub(crate) fn load_dup<const N: usize>(self, group: &[T; N]) -> V<S, T, W> {
        const { crate::make::Fits::<N, T>::GROUP };
        return_if!(N * size_of::<T>() > W::BYTES, self.load(group));
        return_if!(
            N * size_of::<T>() == 32,
            self.from_parts(0, &mut passed!(|_| self.simd().fixed::<T, crate::B32>().load(group)))
        );
        return_if!(
            N * size_of::<T>() == 64,
            self.from_parts(0, &mut passed!(|_| self.simd().fixed::<T, crate::B64>().load(group)))
        );
        // As one number. LLVM widens a load of two lanes of 16 bits, and narrows it again.
        return_if!(S::A64 && cfg!(target_endian = "little") && N == 2 && size_of::<T>() == 2, {
            let block = self
                .simd()
                .fixed::<u32, W::Min<B16>>()
                .set(u32::from_le_bytes(*crate::lane::Repr::bytes(group).first_chunk().unwrap()))
                .hidden_unless_known();
            self.repartition::<u32>().from_parts(0, &mut passed!(|_| block)).reinterpret()
        });
        let block: V<S, T, B16> = choose! {
            S::A64 && crate::OPTIMIZED => Simd::new(self.simd(), Raw::load_in_parts(group)),
            _ => self.simd().fixed().load_known(group),
        };
        match const { N * size_of::<T>() } {
            1 => self.repartition().set(block.reinterpret::<u8>().get_lane()).reinterpret(),
            2 => self.repartition().set(block.reinterpret::<u16>().get_lane()).reinterpret(),
            4 => self.repartition().set(block.reinterpret::<u32>().get_lane()).reinterpret(),
            8 => self.repartition().set(block.reinterpret::<u64>().get_lane()).reinterpret(),
            _ => self.load_dup128(group),
        }
    }
    /// `table[index]`, or `no` where `mask` is false or the index is out of bounds. The indices can have another size
    /// than the lanes. It doesn't build if the numbers of lanes differ. `MaskedGatherIndexOr`.
    #[op]
    #[track_caller]
    pub(crate) fn masked_gather_index_or<U: Unsigned, X: Width>(
        self,
        no: impl Operand<T, W, S>,
        mask: MaskOf<T, W, S>,
        table: &[T],
        indices: V<S, U, X>,
    ) -> V<S, T, W> {
        require!("there has to be one index for each lane", X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>());
        let no = no.vector(self);
        halves_if!(W::BYTES > 64, |this: Self = self, no: V<S, T, W> = no, mask: MaskOf<T, W, S> = mask, table: &[T] = table, indices: V<S, U, X> = indices| {
            let (half, no, mask, at) = (this.part::<W>(), no.parts::<W>(), mask.parts::<W>(), indices.parts::<W>());
            this.join(half.masked_gather_index_or(no[0], mask[0], table, at[0]), half.masked_gather_index_or(no[1], mask[1], table, at[1]))
        });
        // With a known length, the checks can go.
        if const { Self::BY_FOURS && (size_of::<U>() < 4 || size_of::<U>() == 4 && S::REGISTER == 64) }
            && (const { S::REGISTER == 64 } || !is_known!(table.len()))
            && (const { size_of::<U>() < 4 } || self.gathers_are_fast(0))
        {
            return live!(
                S::AVX2 && Self::BY_FOURS && size_of::<U>() <= 4,
                self.gather_clamped_or(no, mask, table, indices)
            );
        }
        if const { Self::CLAMPS && !Self::GATHERS && size_of::<U>() <= 4 }
            && !table.is_empty()
            && self.gathers_are_fast(table.len())
        {
            return live!(
                S::AVX2 && Self::CLAMPS && !Self::GATHERS && size_of::<U>() <= 4,
                self.gather_at_once_or(no, mask, table, indices)
            );
        }
        let by_instruction = if const { Self::TUNED } {
            crate::tuning::fast_gather()
        } else {
            const { Self::GATHERS && (Self::LANES == 16 || S::FAST_GATHER) }
        };
        if const { size_of::<U>() < 4 && (size_of::<T>() >= 4 || S::A64 && X::BYTES <= 32) } {
            if crate::OPTIMIZED && !by_instruction && crate::arithmetic::known(table.len() as u64 > U::MAX.to_u64()) {
                // There is nothing to clamp, so they come out four or eight at a time.
                let words = choose! {
                    S::A64 && X::BYTES == 4 => [indices.bitcast::<u32>().get_lane() as u64; 4],
                    _ => self.simd().fixed::<u64, crate::B32>().resize_bitcast(indices).to_array(),
                };
                // Two bytes at a time, or LLVM copies the word for each byte.
                let mut parts = [0; 8];
                unrolled!(
                    8,
                    for i in 0..(if const { crate::X86 && S::REGISTER < 64 && size_of::<U>() == 1 } {
                        Self::LANES.div_ceil(2)
                    } else {
                        0
                    }) {
                        parts[i] = if i % 4 == 0 { words[i / 4] } else { crate::regs::number(parts[i - 1] >> 16) };
                    }
                );
                let index = always!(|i: usize| {
                    choose! {
                        crate::X86 && S::REGISTER < 64 && size_of::<U>() == 1 => parts[i / 2] >> (i % 2 * 8) & 255,
                        _ => words[i * size_of::<U>() / 8] >> (i * size_of::<U>() % 8 * 8) & U::MAX.to_u64(),
                    }
                });
                return mask.if_then_else(self.lane_by_lane(0, &passed!(|i| table[index(i) as usize])), no);
            }
            return_if!(
                S::A64 && size_of::<U>() < 4 && size_of::<T>() < 4 && X::BYTES <= 32,
                self.gather_clamped_or(no, mask, table, indices)
            );
            return self.gather_by(by_instruction, no, mask, table, indices.cast::<u32>());
        }
        self.gather_by(by_instruction, no, mask, table, indices)
    }
    #[inline(always)]
    fn gather_by<U: Unsigned, X: Width>(
        self,
        instruction: bool,
        no: V<S, T, W>,
        mask: MaskOf<T, W, S>,
        table: &[T],
        indices: V<S, U, X>,
    ) -> V<S, T, W> {
        apart!(self.simd(), {
            if const { Self::GATHERS } && instruction {
                #[allow(unreachable_code)]
                return live!(Self::GATHERS, {
                    #[cfg(target_arch = "x86_64")]
                    return self.gather_at_once(no, mask, table, indices);
                    Simd::new(self.simd(), indices.raw.gather(no.raw, mask.raw_for::<T>(), table))
                });
            }
            let Some(last) = table.len().checked_sub(1) else { return no };
            let all = choose! {
                size_of::<U>() == 4 && Self::LANES <= 16 => {
                    let at = indices.bitcast::<u32>().below(table.len(), 1);
                    self.lane_by_lane(0, &passed!(|i| table[at[i]]))
                },
                size_of::<U>() == 4 && crate::regs::PAIRS => self.by_loads(table.len(), 1, indices.bitcast::<u32>(), &passed!(|i| T::unsigned(table)[i])),
                _ => {
                    let lanes = indices.to_array();
                    self.lane_by_lane(0, &passed!(|i| {
                        let at = indices.place(lanes.as_ref()[i]);
                        // With `if`, it is a branch on x86.
                        table[core::hint::select_unpredictable(at < table.len() as u64, at as usize, 0)]
                    }))
                },
            };
            if_here!(
                S::A64 && crate::OPTIMIZED,
                if indices.known_at_most(last) {
                    return mask.if_then_else(all, no);
                }
            );
            let within = choose! { size_of::<U>() == 8 => indices.simd_lt(U::from_u64(table.len() as u64)), _ => indices.simd_le(U::from_u64((last as u64).min(U::MAX.to_u64()))) };
            let within: MaskOf<T, W, S> = crate::raw::same(within.rebind::<T::Signed>());
            // For fewer than 8 lanes, AVX-512 would take the result of `true & within` through a vector.
            let within = if crate::OPTIMIZED && crate::arithmetic::known(mask.all()) { within } else { mask & within };
            // For floats, LLVM wouldn't load into lanes.
            return_if!(
                S::WASM && T::IS_FLOAT,
                within.retype().if_then_else(all.cast_signed(), no.cast_signed()).bitcast()
            );
            within.if_then_else(all, no)
        })
    }
    /// Values that are next to each other are loaded as one, into the block in which they end up.
    #[op]
    #[track_caller]
    pub(crate) fn gather_interleaved<const K: usize, X: Width, E: Readable<T>>(
        self,
        table: &[E],
        indices: V<S, u32, X>,
    ) -> [V<S, T, W>; K] {
        const { crate::make::Fits::<K>::NEIGHBORS };
        require!("there has to be one index for each lane", X::BYTES / 4 == W::BYTES / size_of::<T>());
        assert!(table.len() >= K);
        apart!(self.simd(), {
            return_if!(K == 1, *[self.gather_clamped(table, indices); 4].first_chunk().unwrap());
            const fn quick<T>(gathers: bool, k: usize, bytes: usize) -> bool {
                crate::X86 && gathers && k == 3 && size_of::<T>() == 4 && bytes == 64
            }
            const fn pairs_at_once<T, S: Isa>(k: usize, bytes: usize) -> bool {
                S::AVX512VBMI
                    && S::REGISTER == 64
                    && k == 2
                    && bytes == 64
                    && matches!(size_of::<T>(), 1 | 4)
                    && usize::BITS == 64
                    && !cfg!(miri)
            }
            let at_once = always!(|| table.len() >= 4
                && table.len() <= 1 << 31
                && (S::FAST_GATHER || crate::tuning::fast_gather()));
            return_if!(E::PLAIN && pairs_at_once::<T, S>(K, X::BYTES) && size_of::<T>() == 1, {
                let (s, bytes) = (self.simd(), crate::lane::Repr::bytes(E::plain(table)));
                // Both ways end in wide lanes, so that a `cast` that follows undoes the one here.
                let two = if at_once() {
                    // The last pairs are further up in the last four bytes.
                    let at = indices.simd_min((table.len() - 2) as u32);
                    let four = at.with_bytes::<u32>(X::from64(s.gather_four(bytes, X::to64(at.bytes()), 1)));
                    four >> ((at - at.simd_min((table.len() - 4) as u32)) << 3)
                } else {
                    let at = indices.below(table.len(), 2);
                    let pair = always!(|i: usize| u16::from_le_bytes(*bytes[at[i]..].first_chunk().unwrap()));
                    s.fixed::<u16, crate::B32>().from_fn(pair).barrier().cast::<u32>().same()
                };
                let (a, b) = (two.cast::<u8>().same::<T, W>(), (two >> 8).cast::<u8>().same::<T, W>());
                *[a, b, a, a].first_chunk().unwrap()
            });
            if const { E::PLAIN && pairs_at_once::<T, S>(K, X::BYTES) } && at_once() {
                return live!(E::PLAIN && pairs_at_once::<T, S>(K, X::BYTES) && size_of::<T>() == 4, {
                    let [lower, upper] = indices.same::<u32, crate::B64>().split();
                    let half = always!(|at: V<S, u32, crate::B32>| {
                        self.zero().with_bytes::<T>(W::from64(self.simd().gather_eight(
                            crate::lane::Repr::bytes(E::plain(table)),
                            at.bytes(),
                            4,
                        )))
                    });
                    let [a, b] = half(lower).deinterleave(half(upper));
                    *[a, b, a, a].first_chunk().unwrap()
                });
            }
            if const { E::PLAIN && quick::<T>(Self::TUNED || Self::GATHERS && S::FAST_GATHER, K, W::BYTES) }
                && table.len() <= 1 << 31
                && (const { !Self::TUNED } || crate::tuning::fast_gather())
            {
                return live!(E::PLAIN && quick::<T>(Self::TUNED || Self::GATHERS && S::FAST_GATHER, K, W::BYTES), {
                    let (table, at) = (E::plain(table), indices.simd_min((table.len() - K) as u32));
                    let one = always!(|k: usize| self.gather_by(true, self.zero(), self.mask_true(), &table[k..], at));
                    let [a, b] = [one(0), one(1)];
                    *[a, b, choose! { K == 3 => one(2), _ => a }].first_chunk().unwrap()
                });
            }
            halves_if!(X::BYTES > 64 || W::BYTES > 32 || W::BYTES > S::REGISTER && W::BYTES > 16, |this: Self = self, table: &[E] = table, indices: V<S, u32, X> = indices| {
                let [lower, upper] = indices.split();
                let (lower, upper) = (this.half().gather_interleaved::<K, _, _>(table, lower), this.half().gather_interleaved::<K, _, _>(table, upper));
                crate::array::own::from_fn(#[inline(always)] |k| this.combine(upper[k].unseen(), lower[k].unseen()))
            });
            let at = indices.below(table.len(), K);
            let window = always!(|i: usize| -> &[E; K] { table[at[i]..].first_chunk().unwrap() });
            return_if!(S::A64 && K == 4 && size_of::<T>() <= 2 && W::BYTES == 16, {
                let n = Self::LANES / 4;
                macro_rules! of {
                    ($t:ty, $w:ty, $part:ident) => {
                        self.repartition::<$t>()
                            .lane_by_lane(
                                $part * n,
                                &passed!(|i| self
                                    .simd()
                                    .fixed::<T, $w>()
                                    .load_any(window(i))
                                    .bitcast::<$t>()
                                    .get_lane()),
                            )
                            .bitcast::<T>()
                            .barrier()
                    };
                }
                let part = always!(
                    |k: usize| choose! { size_of::<T>() == 1 => of!(u32, crate::B4, k), _ => of!(u64, crate::B8, k) }
                );
                let ([a, b], [c, d]) = (part(0).deinterleave(part(1)), part(2).deinterleave(part(3)));
                let ([a, c], [b, d]) = (a.barrier().deinterleave(c.barrier()), b.barrier().deinterleave(d.barrier()));
                *[a, b, c, d].first_chunk().unwrap()
            });
            return_if!(
                W::BYTES < 16
                    && W::BYTES >= 4 * size_of::<T>()
                    && K != 3
                    && cfg!(target_endian = "little")
                    && !(S::BY_HAND && size_of::<T>() == 2),
                {
                    let s = self.simd();
                    let pairs = always!(|k: usize| {
                        macro_rules! of {
                            ($t:ty, $w:ty) => {
                                s.fixed::<$t, W::Twice>()
                                    .from_fn(
                                        #[inline(always)]
                                        |i| s.fixed::<T, $w>().load_any(&window(i)[k..]).bitcast::<$t>().get_lane(),
                                    )
                                    .bitcast::<T>()
                            };
                        }
                        let both =
                            choose! { size_of::<T>() == 1 => of!(u16, crate::B2), _ => of!(u32, crate::B4) }.barrier();
                        return_if!(S::SSE41, self.halves_of_pairs(both));
                        let [even, odd] = both.deinterleave(both);
                        [self.resize_any(even), self.resize_any(odd)]
                    });
                    let ([a, b], [c, d]) = (pairs(0), pairs(K - 2));
                    *[a, b, c, d].first_chunk().unwrap()
                }
            );
            return_if!(
                W::BYTES < 16 || cfg!(target_endian = "big"),
                crate::array::own::from_fn(
                    #[inline(always)]
                    |k| self.from_fn(
                        #[inline(always)]
                        |i| window(i)[k].value()
                    )
                )
            );
            let s = self.simd();
            return_if!(K == 4 && size_of::<T>() == 4, {
                let row = always!(|k: usize| {
                    self.from_parts(0, &mut passed!(|block| s.fixed::<T, B16>().load_any(window(4 * block + k))))
                        .barrier()
                });
                *self.transpose_in_blocks([row(0), row(1), row(2), row(3)]).first_chunk().unwrap()
            });
            let pairs = always!(|k: usize| {
                // Half of the pairs of each block.
                let half = always!(|upper: usize| {
                    let n = 8 / size_of::<T>();
                    let pair = always!(|i: usize| &window(i / n * 2 * n + upper * n + i % n)[k..]);
                    macro_rules! of {
                        ($t:ty, $w:ty) => {
                            self.repartition::<$t>()
                                .lane_by_lane(
                                    0,
                                    &passed!(|i| s.fixed::<T, $w>().load_any(pair(i)).bitcast::<$t>().get_lane()),
                                )
                                .bitcast::<T>()
                        };
                    }
                    choose! {
                    size_of::<T>() == 1 => of!(u16, crate::B2),
                    size_of::<T>() == 2 => of!(u32, crate::B4),
                    // Two loads into a block take fewer instructions and registers than blends.
                    size_of::<T>() == 4 && cfg!(target_arch = "x86_64") && S::REGISTER <= 32 && E::BYTES => self.from_parts(0, &mut passed!(|block| {
                        let one = always!(|i: usize| f64::from_le_bytes(*E::bytes(pair(2 * block + i)).first_chunk().unwrap()));
                        s.fixed::<f64, B16>().from_fn(one).bitcast::<T>().black_box()
                    })),
                    size_of::<T>() == 4 => of!(u64, crate::B8),
                    _ => self.from_parts(0, &mut passed!(|block| s.fixed::<T, B16>().load_any(pair(block)))),
                }.barrier()
                });
                half(0).in_blocks().deinterleave(half(1))
            });
            let [a, b] = pairs(0);
            let [c, d] = choose! { K == 2 => [a, a], K == 3 => [self.lane_by_lane(0, &passed!(|i| window(i)[2].value())), a], _ => pairs(2) };
            *[a, b, c, d].first_chunk().unwrap()
        })
    }
    /// They gain nothing on AVX2.
    const BLENDS: bool = S::AVX2 && S::REGISTER == 64;
    /// `vpgather` takes 25 cycles from Skylake to Ice Lake with the microcode against Downfall, and doesn't win on Zen.
    /// With AVX-512, LLVM makes it of four loads or more.
    #[inline(always)]
    pub(crate) fn lane_by_lane(self, first: usize, lane: &impl Fn(usize) -> T) -> V<S, T, W> {
        apart_unoptimized!(self.simd(), {
            return_if!(crate::X86 && size_of::<T>() >= 4 && W::BYTES > 16 && (W::BYTES > 32 || !Self::BLENDS), {
                let half = self.half();
                self.combine(half.lane_by_lane(first + half.lanes(), lane), half.lane_by_lane(first, lane))
            });
            return_if!(Self::BLENDS && size_of::<T>() >= 4 && Self::LANES >= 4, {
                // A load to all lanes takes no shuffle, and a blend runs on more ports than an insertion.
                let all = always!(|i| self.set(lane(first + i)).unseen());
                let has = always!(|bit| {
                    (self.to_unsigned().iota(Lane::from_usize(0)) & T::Unsigned::from_usize(bit))
                        .simd_ne(T::Unsigned::default())
                        .retype::<T::Signed>()
                });
                let two = always!(|i| has(1).if_then_else(all(i + 1), all(i)));
                let four = always!(|i| has(2).if_then_else(two(i + 2), two(i)));
                choose! { Self::LANES == 4 => four(0), _ => has(4).if_then_else(four(4), four(0)) }
            });
            return_if!(S::A64 && crate::OPTIMIZED && W::BYTES > 16, {
                let half = self.half();
                self.combine(half.lane_by_lane(first + half.lanes(), lane), half.lane_by_lane(first, lane))
            });
            // A load to a lane takes no index, and waits for the one before.
            return_if!(S::A64 && crate::OPTIMIZED && W::BYTES >= 8 && T::BITS == 8, {
                let n = 8 / size_of::<T>();
                let word = always!(|at: usize| {
                    let mut word = 0;
                    unrolled!(
                        8,
                        for i in 0..n {
                            word |=
                                crate::Int::to_u64(T::unsigned(&[lane(first + at * n + i)])[0]) << (i as u32 * T::BITS)
                        }
                    );
                    word
                });
                self.repartition::<u64>().from_fn(word).reinterpret()
            });
            return_if!(S::A64 && crate::OPTIMIZED && W::BYTES >= 8 && Self::LANES >= 2, {
                let one = always!(|i: usize| self.simd().fixed::<T, B16>().load_known(&[lane(first + i)]).black_box());
                let two = always!(|i| one(i).interleave_lower(one(i + 1)).bitcast::<u64>());
                let four = always!(|i| {
                    choose! {
                        T::BITS == 16 => two(i).bitcast::<u32>().interleave_lower(two(i + 2).bitcast()).bitcast(),
                        _ => two(i).interleave_lower(two(i + 2)),
                    }
                });
                self.resize_bitcast(choose! { Self::LANES == 2 => two(0), Self::LANES == 4 => four(0), _ => four(0).interleave_lower(four(4)) })
            });
            let all = self.from_fn(
                #[inline(always)]
                |i| lane(first + i),
            );
            // Before a `select`, LLVM would load to other registers first.
            choose! { S::SSE2 && S::REGISTER < 64 && !(S::AVX2 && size_of::<T>() == 8) && crate::OPTIMIZED => all.black_box(), _ => all }
        })
    }
}

#[cfg(target_arch = "x86_64")]
impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    fn gather_at_once<U: Unsigned, X: Width>(
        self,
        no: V<S, T, W>,
        mask: MaskOf<T, W, S>,
        table: &[T],
        indices: V<S, U, X>,
    ) -> V<S, T, W> {
        return_if!(X::BYTES > 64 || W::BYTES > 64, {
            let half = self.half();
            self.combine(
                half.gather_at_once(no.upper_half(), mask.upper_half(), table, indices.upper_half()),
                half.gather_at_once(no.lower_half(), mask.lower_half(), table, indices.lower_half()),
            )
        });
        let mask = mask.raw_for::<T>();
        return_if!(size_of::<U>() == 8, Simd::new(self.simd(), indices.raw.gather(no.raw, mask, table)));
        let lower = no.raw.gathered32(mask, table, indices.raw);
        // An instruction with indices of 32 bits takes up to 2^31 values.
        if table.len() > 1 << 31 {
            core::hint::cold_path();
            return Simd::new(
                self.simd(),
                lower.gathered32(mask, &table[1 << 31..], (indices ^ U::from_u64(1 << 31)).raw),
            );
        }
        Simd::new(self.simd(), lower)
    }
}
#[cfg(target_arch = "x86_64")]
impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    fn scatter_at_once<U: Unsigned, X: Width>(self, mask: MaskOf<T, W, S>, table: &mut [T], indices: V<S, U, X>) {
        return_if!(X::BYTES > 64 || W::BYTES > 64, {
            self.lower_half().scatter_at_once(mask.lower_half(), table, indices.lower_half());
            self.upper_half().scatter_at_once(mask.upper_half(), table, indices.upper_half())
        });
        let mask = mask.raw_for::<T>();
        return_if!(size_of::<U>() == 8, indices.raw.scatter(self.raw, mask, table));
        self.raw.scattered32(mask, table, indices.raw);
        if const { size_of::<U>() == 4 } && table.len() > 1 << 31 {
            core::hint::cold_path();
            self.raw.scattered32(mask, &mut table[1 << 31..], (indices ^ U::from_u64(1 << 31)).raw);
        }
    }
}

impl<S: Isa, U: Unsigned, X: Width> Simd<U, X, S> {
    /// A lane as an index. With AVX-512, LLVM would check all in vectors of 64-bit lanes, which takes up to 1.7 times as long.
    #[op]
    fn place(self, lane: U) -> u64 {
        choose! { crate::X86 && S::REGISTER == 64 && Self::LANES > 4 => crate::regs::number(lane.to_u64()) & if size_of::<U>() == 1 { 255 } else { !0 }, _ => lane.to_u64() }
    }
}

impl<S: Isa, W: Width> Simd<u32, W, S> {
    /// Each lane, or `len - n` if that is less. Panics if that is negative.
    #[op]
    pub(crate) fn below(self, len: usize, n: usize) -> [usize; 16] {
        choose! {
            W::BYTES == 64 && crate::regs::PAIRS => crate::regs::below64(W::to64(self.bytes()), len, n),
            W::BYTES == 32 && crate::regs::PAIRS => crate::regs::below32(W::to32(self.bytes()), len, n),
            // In lanes of 32 bits, so that LLVM keeps what it knows of them.
            S::A64 && W::BYTES == 8 => {
                let wide: crate::raw::RawOf<u32, crate::B16> = self.raw.shuffle::<_, { crate::pattern::RESIZE }, 0>(crate::raw::Raw::zero());
                crate::regs::below16(crate::raw::Bits::to_bytes(wide), len, n)
            },
            matches!(W::BYTES, 8 | 16) && crate::regs::PAIRS => crate::regs::below16(W::to16(self.bytes()), len, n),
            _ => {
                let (lanes, last, mut at) = (self.to_array(), len.checked_sub(n).unwrap(), [0; 16]);
                unrolled!(16, for i in 0..const (Self::LANES) {
                    at[i] = (lanes.as_ref()[i] as usize).min(last);
                });
                at
            },
        }
    }
    /// For each lane, the `N` values of `from` that start at this index, or the last `N` if they would reach past the end.
    /// `None` if `from` has fewer. `K` is the number of lanes. This gathers what is larger than a lane, such as records or the
    /// candidates of a search, and takes one instruction for all checks. For up to four numbers, [`gather_interleaved`](Simd::gather_interleaved) gives vectors.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [a, b, c, d] = u32x4::from_array([0, 3, 4, 99]).gather_windows(b"abcdef").unwrap();
    /// assert_eq!([a, b, c, d], [b"ab", b"de", b"ef", b"ef"]);
    /// # } example()
    /// ```
    #[op]
    #[track_caller]
    pub fn gather_windows<E, const N: usize, const K: usize>(self, from: &[E]) -> Option<[&[E; N]; K]> {
        require!("there has to be one window for each lane", K == Self::LANES);
        const { assert!(N > 0, "a window has one value or more") };
        let mut all = [from.first_chunk()?; K];
        if const { K > 16 } {
            let at = self.to_array();
            unrolled!(8, for k in 0..const (K / 16) {
                let at = self.s.fixed::<u32, crate::B64>().load(&at.as_ref()[16 * k..]).below(from.len(), N);
                unrolled!(16, for i in 0..const 16 {
                    all[16 * k + i] = from[at[i]..].first_chunk().unwrap();
                });
            });
            return Some(all);
        }
        let at = self.below(from.len(), N);
        unrolled!(16, for i in 0..const K {
            all[i] = from[at[i]..].first_chunk().unwrap();
        });
        Some(all)
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// The lanes where `mask` is true. Panics if `to` is too short. `BlendedStore`.
    #[op]
    #[track_caller]
    pub(crate) fn blended_store(self, mask: MaskOf<T, W, S>, to: &mut [T]) {
        return_if!(
            S::SVE2 && W::BYTES == 16,
            self.s.store_masked(
                &mut to[..Self::LANES],
                W::to16(self.raw.to_native()),
                W::to16(mask.to_vector().raw.to_native())
            )
        );
        if const { Tag::<S, T, W>::MASKED } {
            let to = &mut to[..self.tag().lanes()];
            return self.raw.store_masked(to, mask.raw_for::<T>());
        }
        return_if!(W::BYTES > 64, |this: Self = self, mask: MaskOf<T, W, S> = mask, to: &mut [T] = to| apart!(this.isa(), |to: &mut [T]| {
            let (lower, upper) = to[..Self::LANES].split_at_mut(Self::LANES / 2);
            let (v, mask) = (this.parts::<W>(), mask.parts::<W>());
            v[0].blended_store(mask[0], lower);
            v[1].blended_store(mask[1], upper)
        }));
        if_here!(crate::X86 && S::REGISTER == 32 && size_of::<T>() >= 4, {
            // As bytes, or LLVM makes `vpmaskmov` of it, which is slow on AMD.
            let bytes = mask.to_vector().bitcast::<u8>().to_mask();
            let v = bytes.if_then_else(self.bitcast::<u8>(), self.tag().load(to).bitcast());
            return on_x86!(v, blended()).bitcast().store(to);
        });
        let v = mask.if_then_else(self, self.tag().load(to));
        on_x86!(v, blended()).store(to)
    }
    /// `table[index] = lane` for each lane in order, but where `mask` is false or the index is out of bounds. The
    /// indices can have another size than the lanes. `MaskedScatterIndex`, and `ScatterIndexN` with [`Mask::first_n`](crate::Mask::first_n).
    #[op]
    #[track_caller]
    pub(crate) fn masked_scatter_index<U: Unsigned, X: Width>(
        self,
        mask: MaskOf<T, W, S>,
        table: &mut [T],
        indices: V<S, U, X>,
    ) {
        require!("there has to be one index for each lane", X::BYTES / size_of::<U>() == W::BYTES / size_of::<T>());
        return_if!(W::BYTES > 64, |this: Self = self, mask: MaskOf<T, W, S> = mask, table: &mut [T] = table, indices: V<S, U, X> = indices| apart!(this.isa(), |table: &mut [T]| {
            let (v, mask, at) = (this.parts::<W>(), mask.parts::<W>(), indices.parts::<W>());
            v[0].masked_scatter_index(mask[0], table, at[0]);
            v[1].masked_scatter_index(mask[1], table, at[1])
        }));
        let all = crate::arithmetic::known(mask.all());
        // LLVM has branches for two lanes.
        #[allow(unreachable_code)]
        if const { Tag::<S, T, W>::GATHERS } && (const { Self::LANES > 2 } || all) {
            #[cfg(target_arch = "x86_64")]
            return live!(Tag::<S, T, W>::GATHERS, self.scatter_at_once(mask, table, indices));
            return indices.raw.scatter(self.raw, mask.raw_for::<T>(), table);
        }
        if_here!(
            crate::X86 && crate::regs::PAIRS && size_of::<U>() == 4 && Self::LANES >= 4 && X::BYTES <= 64,
            if all
                && let Some(last) = table.len().checked_sub(1)
                && indices.simd_le(U::from_u64((last as u64).min(U::MAX.to_u64()))).all()
            {
                let (lanes, at) = (self.to_array(), indices.bitcast::<u32>().below(table.len(), 1));
                for i in 0..self.tag().lanes() {
                    table[at[i]] = lanes.as_ref()[i];
                }
                return;
            }
        );
        let indices = if const { X::BYTES == W::BYTES } && !all {
            indices & indices.tag().resize_bitcast(mask.to_vector())
        } else {
            indices
        };
        let (lanes, at, bits) = (self.to_array(), indices.to_array(), mask.own_bits());
        // For the lanes that are off. If LLVM saw that nothing reads it, there would be a branch for each.
        let spare = &mut T::default();
        let spare = if all { spare } else { core::hint::black_box(spare) };
        for i in 0..self.tag().lanes() {
            if let Some(to) = usize::try_from(indices.place(at.as_ref()[i])).ok().and_then(|at| table.get_mut(at)) {
                *core::hint::select_unpredictable(bits >> i & 1 != 0, to, spare) = lanes.as_ref()[i];
            }
        }
    }
    /// `table[index] = lane` for each lane in order, but where the index is out of bounds.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut table = [0; 5];
    /// u32x4::from([10, 20, 30, 40]).scatter(&mut table, u8x4::from([4, 0, 99, 2]));
    /// assert_eq!(table, [20, 0, 40, 0, 10]);
    /// # } example()
    /// ```
    #[doc(alias("ScatterIndex"))]
    #[op]
    #[track_caller]
    pub fn scatter<U: Unsigned, X: Width>(self, table: &mut [impl crate::Writable<T>], indices: V<S, U, X>) {
        self.scatter_select(table, self.tag().mask_true(), indices)
    }
}
