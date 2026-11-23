//! Interleaved values of 5 to 16 vectors: pieces of the records in each block, which are transposed.

use crate::{
    Aligned, B16, B32, Isa, Lane, Output, Place, Readable, Region, Simd, Tag, Width, X86, array::own as array,
};
use core::cmp::Ordering::{Equal, Greater, Less};
use core::mem::MaybeUninit;

type V<T, W, S> = Simd<T, W, S>;
type Block<W> = <W as Width>::Min<B16>;

/// With the number of lanes in a block as a constant.
macro_rules! by_lanes { ($this:ident.$f:ident::<$k:ident>($($a:expr),*)) => { choose! {
    Self::IN_BLOCK == 16 => $this.$f::<$k, 16>($($a),*),
    Self::IN_BLOCK == 8 => $this.$f::<$k, 8>($($a),*),
    Self::IN_BLOCK == 4 => $this.$f::<$k, 4>($($a),*),
    Self::IN_BLOCK == 2 => $this.$f::<$k, 2>($($a),*),
    _ => $this.$f::<$k, 1>($($a),*),
} }; }

/// With room for the values of `K` vectors, and not much more.
macro_rules! by_room { ($this:ident.$f:ident::<$k:ident, $e:ident>($($a:expr),*)) => { choose! {
    $k * Self::LANES <= 64 => $this.$f::<$k, $e, 64>($($a),*),
    $k * Self::LANES <= 256 => $this.$f::<$k, $e, 256>($($a),*),
    _ => $this.$f::<$k, $e, 1024>($($a),*),
} }; }

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    const IN_BLOCK: usize = Block::<W>::BYTES / size_of::<T>();
    const BLOCKS: usize = W::BYTES.div_ceil(16);
    const BYTE_PERMUTES: bool = X86 && S::AVX512VBMI && W::BYTES == 64 && size_of::<T>() == 1;

    /// `from` has `K` vectors.
    #[op]
    pub(crate) fn load_records<const K: usize, E: Readable<T>>(self, from: &[E]) -> [V<T, W, S>; K] {
        let (n, from) = (Self::LANES, &from[..K * Self::LANES]);
        return_if!(Self::SPLIT, {
            let (lower, upper) = from.split_at(K * n / 2);
            let (lower, upper) = (
                apart!(self.simd(), self.half().load_records::<K, E>(lower)),
                apart!(self.simd(), self.half().load_records::<K, E>(upper)),
            );
            array::from_fn(
                #[inline(always)]
                |k| self.combine(upper[k], lower[k]),
            )
        });
        return_if!(K == 8 && Self::BYTE_PERMUTES, {
            let rows: [_; 8] = array::from_fn(
                #[inline(always)]
                |k| {
                    E::load::<W, S>(&from[k * n..], self.simd())
                        .swizzle(
                            #[inline(always)]
                            |i| i % 8 * 8 + i / 8,
                        )
                        .reinterpret::<u64>()
                },
            );
            let fields = self.repartition::<u64>().transpose(rows);
            array::from_fn(
                #[inline(always)]
                |k| fields[k].reinterpret(),
            )
        });
        return_if!(S::A64 && E::PLAIN && Self::by_threes::<K>(12), {
            let mut v = [self.zero(); K];
            unrolled!(4, for part in 0..const (K / 3) {
                [v[3 * part], v[3 * part + 1], v[3 * part + 2]] = self.load_interleaved_any(&from[3 * part * n..]);
            });
            let round = always!(|v: [V<T, W, S>; K]| {
                array::from_fn(
                    #[inline(always)]
                    |k| {
                        let at = k % (K / 2) / 3 * 6 + k % 3;
                        if k < K / 2 { self.concat_even(v[at + 3], v[at]) } else { self.concat_odd(v[at + 3], v[at]) }
                            .barrier()
                    },
                )
            });
            choose! { K == 6 => round(v), _ => round(round(v)) }
        });
        return_if!(S::A64 && K == 8 && Self::IN_BLOCK == 16, {
            let round = always!(|v: [V<T, W, S>; K]| {
                array::from_fn(
                    #[inline(always)]
                    |k| {
                        let (a, b) = (v[k % 4 * 2], v[k % 4 * 2 + 1]);
                        self.opaque(if k < 4 { self.concat_even(b, a) } else { self.concat_odd(b, a) }.raw)
                    },
                )
            });
            round(round(round(array::from_fn(
                #[inline(always)]
                |k| self.opaque(E::load::<W, S>(&from[k * n..], self.simd()).raw),
            ))))
        });
        return_if!(K <= 8 && Self::IN_BLOCK == 16 && !S::BY_HAND, {
            // Two records in a block, whose fields are put side by side.
            let rows: [_; 8] = array::from_fn(
                #[inline(always)]
                |j| {
                    let at = (2 * j * K).min(16 * K - 16);
                    self.pieces::<K>(from, at)
                        .swizzle(
                            #[inline(always)]
                            |i| i / 16 * 16 + (2 * j * K - at + i % 2 * K + i % 16 / 2) % 16,
                        )
                        .reinterpret::<u16>()
                },
            );
            let fields = self.repartition::<u16>().transpose_in_blocks(rows);
            array::from_fn(
                #[inline(always)]
                |k| fields[k].reinterpret(),
            )
        });
        return_if!(Self::odd_words::<K>() && X86, self.load_odd(from));
        // With 12 and 16 fields it lost on Zen 3, and in 64 bytes on Zen 4.
        return_if!(
            X86 && (Self::even_words::<K>()
                || S::SSE41 && K == 8 && size_of::<T>() == 4 && matches!(W::BYTES, 16 | 32)),
            self.load_even(from)
        );
        by_lanes!(self.load_squares::<K>(from))
    }
    /// After `ld3`, a vector has each third field. Squares are faster for longer records.
    const fn by_threes<const K: usize>(bytes: usize) -> bool {
        W::BYTES == 16 && (K == 6 || K == 12) && K * size_of::<T>() <= bytes
    }
    /// Whether there is an odd number of fields of 4 bytes. Then each block is loaded or stored once, and on x86 half of the
    /// moves are blends. For loads on Arm, squares are faster.
    const fn odd_words<const K: usize>() -> bool {
        (S::SSE41 || S::A64) && K % 2 == 1 && size_of::<T>() == 4 && W::BYTES >= 16
    }
    /// The same for 6, 10 and 14 fields.
    const fn even_words<const K: usize>() -> bool {
        S::SSE41 && K % 4 == 2 && size_of::<T>() == 4 && W::BYTES >= 16
    }
    /// A blend brings the same two fields of two records together. With 8 fields, each second record is loaded from two fields earlier.
    #[on(X86)]
    #[op]
    fn load_even<const K: usize>(self, from: &[impl Readable<T>]) -> [V<T, W, S>; K] {
        let pairs: [_; K] = array::from_fn(
            #[inline(always)]
            |t| {
                let (pair, first) = (2 * (t / 2), t % 2 * 2 * K);
                let (lower, upper) = if pair % 4 == 0 || pair == K - 2 { (pair, K + pair) } else { (K + pair, pair) };
                let row = always!(|at: usize| {
                    if K % 4 == 0 {
                        self.pieces::<K>(from, at)
                    } else {
                        self.piece_of_two::<K>(from, at / 8 * 8, at / 4 % 2)
                    }
                    .barrier()
                });
                Self::pick(row(first + lower), row(first + upper - 2), [0, 1, 6, 7])
            },
        );
        array::from_fn(
            #[inline(always)]
            |k| {
                let (a, b) = if k / 2 % 2 == 0 || k >= K - 2 { (k % 2, k % 2 + 2) } else { (k % 2 + 2, k % 2) };
                Self::pick(pairs[k & !1], pairs[k | 1], [a, b, 4 + a, 4 + b])
            },
        )
    }
    /// In each block, the lanes 0 to 3 are those of `a`, and 4 to 7 those of `b`.
    #[op]
    fn pick(a: V<T, W, S>, b: V<T, W, S>, order: [usize; 4]) -> V<T, W, S> {
        crate::interleave3::two_of_each(a, b, order)
    }
    /// Pair `t` has the values `2 * t` and `2 * t + 1` of the first two records of a block, and of the last two.
    #[op]
    fn load_odd<const K: usize>(self, from: &[impl Readable<T>]) -> [V<T, W, S>; K] {
        let rows: [_; K] = array::from_fn(
            #[inline(always)]
            |k| {
                if k | 1 < K { self.piece_of_two::<K>(from, k / 2 * 8, k % 2) } else { self.pieces::<K>(from, 4 * k) }
                    .barrier()
            },
        );
        let pairs: [_; K] = array::from_fn(
            #[inline(always)]
            |t| Self::pick(rows[t / 2], rows[(t + K) / 2], if t % 2 == 0 { [0, 1, 6, 7] } else { [2, 3, 4, 5] }),
        );
        array::from_fn(
            #[inline(always)]
            |k| {
                let (a, b) = (pairs[k / 2], pairs[(k + K) / 2]);
                if k % 2 == 0 {
                    return Self::pick(a, b, [0, 5, 2, 7]);
                }
                let v = Self::pick(b, a, [0, 5, 2, 7]);
                Self::pick(v, v, [1, 0, 3, 2])
            },
        )
    }
    /// The reverse.
    #[op]
    fn store_odd<const K: usize>(self, v: [V<T, W, S>; K], to: impl Place<T>) {
        let v: [_; K] = array::from_fn(
            #[inline(always)]
            |k| if X86 && k % 2 == 1 { Self::pick(v[k], v[k], [1, 0, 3, 2]) } else { v[k].barrier() },
        );
        let pairs: [_; K] = array::from_fn(
            #[inline(always)]
            |t| {
                let order = match (2 * t + 1).cmp(&K) {
                    Less if !X86 => [0, 4, 2, 6],
                    Greater if !X86 => [1, 5, 3, 7],
                    _ => [0, 5, 2, 7],
                };
                Self::pick(v[2 * t % K], v[(2 * t + 1) % K], order)
            },
        );
        let rows: [_; K] = array::from_fn(
            #[inline(always)]
            |k| {
                let order = match (2 * k + 1).cmp(&K) {
                    Less => [0, 1, 4, 5],
                    Equal => [0, 1, 6, 7],
                    Greater => [2, 3, 6, 7],
                };
                Self::pick(pairs[2 * k % K], pairs[(2 * k + 1) % K], order)
            },
        );
        Self::store_rows(rows, to)
    }
    /// Block `b` of row `k` is number `b * K + k`.
    #[op]
    fn store_rows<const K: usize>(rows: [V<T, W, S>; K], mut to: impl Place<T>) {
        return_if!(W::BYTES == 64, {
            unrolled!(8, for k in 0..const (K / 2) {
                Self::store_two::<K>(rows[2 * k], rows[2 * k + 1], &mut to, 8 * k);
            });
            if K % 2 == 1 {
                rows[K - 1].for_each_part(
                    #[inline(always)]
                    |b, piece: V<T, B16, S>| to.store(4 * (b * K + K - 1), piece),
                )
            }
        });
        // LLVM would join four blocks.
        return_if!(X86 && S::REGISTER == 64 && W::BYTES == 32, {
            unrolled!(16, for k in 0..const K {
                let (p, q) = (2 * k, 2 * k + 1);
                let two = rows[p % K].as_u128s().concat_swizzle(rows[q % K], #[inline(always)] |i| if i == 0 { p / K } else { 2 + q / K });
                to.store(8 * k, two.unseen());
            });
        });
        unrolled!(
            2,
            for b in 0..(Self::BLOCKS) {
                unrolled!(16, for k in 0..const K {
                    to.store(4 * (b * K + k), if b == 0 { rows[k].block::<0>() } else { rows[k].upper_half().resize() });
                });
            }
        );
    }
    /// The reverse of `load_even`.
    #[on(X86)]
    #[op]
    fn store_even<const K: usize>(self, v: [V<T, W, S>; K], to: impl Place<T>) {
        let pairs: [_; K] = array::from_fn(
            #[inline(always)]
            |t| Self::pick(v[t & !1], v[t | 1], if t % 2 == 0 { [0, 4, 1, 5] } else { [2, 6, 3, 7] }),
        );
        let rows: [_; K] = array::from_fn(
            #[inline(always)]
            |k| {
                let (m, half) = (K / 2, k / (K / 2));
                let (p, q) = (2 * k % K, 2 * k % K + 1);
                let (a, b) = (p / m * 2, 4 + q / m * 2);
                Self::pick(pairs[p % m * 2 + half], pairs[q % m * 2 + half], [a, a + 1, b, b + 1])
            },
        );
        Self::store_rows(rows, to)
    }
    /// The first or second of two neighbors from `at` on. With four blocks, they are loaded together.
    #[op]
    fn piece_of_two<const K: usize>(self, from: &[impl Readable<T>], at: usize, which: usize) -> V<T, W, S> {
        return_if!(W::BYTES < 64, self.pieces::<K>(from, at + which * Self::IN_BLOCK));
        let two = always!(|b: usize| {
            self.of_own_parts(
                b,
                &passed!(|b| Readable::load::<B32, S>(&from[b * Self::IN_BLOCK * K + at..], self.simd())),
            )
            .barrier()
            .reinterpret::<u64>()
        });
        two(0)
            .concat_swizzle(
                two(2),
                #[inline(always)]
                |i| i % 2 + i / 2 * 4 + which * 2,
            )
            .reinterpret()
    }
    /// The reverse, for four blocks.
    #[op]
    fn store_two<const K: usize>(a: V<T, W, S>, b: V<T, W, S>, to: &mut impl Place<T>, at: usize) {
        unrolled!(
            2,
            for half in 0..2 {
                let both = a.reinterpret::<u64>().concat_swizzle(
                    b.reinterpret(),
                    #[inline(always)]
                    |i| i % 2 + i / 2 % 2 * 8 + i / 4 * 2 + 4 * half,
                );
                let both = both.settled().reinterpret::<T>();
                to.store(2 * half * Self::IN_BLOCK * K + at, both.lower_half());
                to.store((2 * half + 1) * Self::IN_BLOCK * K + at, both.upper_half());
            }
        );
    }
    /// From this place in the records of each block.
    #[op]
    fn pieces<const K: usize>(self, from: &[impl Readable<T>], at: usize) -> V<T, W, S> {
        self.of_own_parts(
            0,
            &passed!(|b| Readable::load::<Block<W>, S>(&from[b * Self::IN_BLOCK * K + at..], self.simd())),
        )
    }
    #[op]
    #[allow(clippy::manual_memcpy, reason = "it has to be unrolled")]
    fn load_squares<const K: usize, const L: usize>(self, from: &[impl Readable<T>]) -> [V<T, W, S>; K] {
        let mut fields = [self.zero(); K];
        unrolled!(16, for part in 0..const (K.div_ceil(L)) {
            let next = part * L;
            let first = next.min(K.saturating_sub(L));
            let square = self.transpose_in_blocks::<L>(array::from_fn(
                #[inline(always)]
                |j| {
                    let at = (j * K + first).min(L * K - L);
                    let (v, early) = (self.pieces::<K>(from, at), j * K + first - at);
                    if const { K < L } && early > 0 {
                        v.swizzle(
                            #[inline(always)]
                            |i| i / L * L + (i % L + early).min(L - 1),
                        )
                    } else {
                        v
                    }
                },
            ));
            unrolled!(16, for k in 0..const L {
                if next + k < K {
                    fields[next + k] = square[next + k - first];
                }
            });
        });
        fields
    }

    /// `to` has room for `K` vectors.
    #[op]
    pub(crate) fn store_records<const K: usize, P: Place<T>>(self, v: [V<T, W, S>; K], to: P) {
        let (n, mut to) = (Self::LANES, to.slice(0..K * Self::LANES));
        return_if!(Self::SPLIT, {
            let both = &mut to;
            apart!(self.simd(), |both: &mut P| self.half().store_records(
                array::map(
                    v,
                    #[inline(always)]
                    |v| v.lower_half()
                ),
                both.again().slice(0..K * n / 2)
            ));
            let both = &mut to;
            apart!(self.simd(), |both: &mut P| self.half().store_records(
                array::map(
                    v,
                    #[inline(always)]
                    |v| v.upper_half()
                ),
                both.again().skip(K * n / 2)
            ))
        });
        return_if!(K == 8 && Self::BYTE_PERMUTES, {
            let rows = self.repartition::<u64>().transpose::<8>(array::from_fn(
                #[inline(always)]
                |k| v[k].reinterpret(),
            ));
            unrolled!(
                8,
                for k in 0..8 {
                    let row = rows[k].reinterpret::<T>().swizzle(
                        #[inline(always)]
                        |i| i % 8 * 8 + i / 8,
                    );
                    to.store(k * n, row);
                }
            );
        });
        return_if!(S::A64 && P::SLICE && Self::by_threes::<K>(24), {
            let round = always!(|v: [V<T, W, S>; K]| {
                array::from_fn(
                    #[inline(always)]
                    |k| {
                        let (a, b) = (v[k / 6 * 3 + k % 3], v[k / 6 * 3 + k % 3 + K / 2]);
                        if k % 6 < 3 { a.interleave_lower(b) } else { a.interleave_upper(b) }.barrier()
                    },
                )
            });
            let (v, to) = (choose! { K == 6 => round(v), _ => round(round(v)) }, to.as_mut_slice().unwrap_or_default());
            unrolled!(4, for part in 0..const (K / 3) {
                self.store_interleaved([v[3 * part], v[3 * part + 1], v[3 * part + 2]], &mut to[3 * part * n..]);
            });
        });
        return_if!(K <= 8 && Self::IN_BLOCK == 16, {
            // Two records in a block.
            let round = always!(|v: [V<T, W, S>; 8]| {
                array::from_fn(
                    #[inline(always)]
                    |k| {
                        if k % 2 == 0 {
                            v[k / 2].interleave_lower(v[k / 2 + 4])
                        } else {
                            v[k / 2].interleave_upper(v[k / 2 + 4])
                        }
                    },
                )
            });
            let rows = round(round(round(array::from_fn(
                #[inline(always)]
                |k| v[k.min(K - 1)],
            ))));
            let joined = always!(|i: usize| i / 16 * 16 + if i % 16 < K { i % 16 } else { (i % 16 - K + 8).min(15) });
            self.store_pieces(
                array::map(
                    rows,
                    #[inline(always)]
                    |v| if const { K < 8 } { v.swizzle(joined) } else { v },
                ),
                2 * K,
                to,
            )
        });
        // On Arm, LLVM would then insert where it zips.
        return_if!(X86 && Self::odd_words::<K>(), {
            let to = &mut to;
            apart!(self.simd(), |to: &mut P| self.store_odd(v, to.again()))
        });
        return_if!(Self::odd_words::<K>(), self.store_odd(v, to));
        return_if!(X86 && Self::even_words::<K>(), {
            let to = &mut to;
            apart!(self.simd(), |to: &mut P| self.store_even(v, to.again()))
        });
        by_lanes!(self.store_squares::<K>(v, to.again()))
    }
    #[op]
    fn store_squares<const K: usize, const L: usize>(self, v: [V<T, W, S>; K], mut to: impl Place<T>) {
        return_if!(
            K < L,
            self.store_pieces(
                self.transpose_in_blocks::<L>(array::from_fn(
                    #[inline(always)]
                    |k| v[k.min(K - 1)]
                )),
                K,
                to
            )
        );
        // A single last field goes first, and what comes before it is written again.
        let alone = const { X86 && L > 1 && K % L == 1 };
        if alone {
            unrolled!(16, for j in 0..const L {
                let last = v[K - 1].swizzle(
                    #[inline(always)]
                    |i| if j == L - 1 { i } else { i / L * L + j },
                );
                last.each_own_part(
                    #[inline(always)]
                    |b, piece: V<T, Block<W>, S>| to.store((b * L + j) * K + K.saturating_sub(L), piece),
                );
            });
        }
        unrolled!(
            16,
            for part in 0..((K - alone as usize).div_ceil(L)) {
                let next = part * L;
                let first = next.min(K.saturating_sub(L));
                let square = self.transpose_in_blocks::<L>(array::from_fn(
                    #[inline(always)]
                    |k| v[first + k],
                ));
                unrolled!(16, for j in 0..const L {
                    square[j].each_own_part(
                        #[inline(always)]
                        |b, piece: V<T, Block<W>, S>| to.store((b * L + j) * K + first, piece),
                    );
                });
            }
        );
    }
    /// The first `len` lanes of each block count, which are half of them or more. The next piece overwrites the others.
    #[op]
    fn store_pieces<const R: usize>(self, rows: [V<T, W, S>; R], len: usize, mut to: impl Place<T>) {
        let mut pieces = [[self.simd().fixed::<T, Block<W>>().zero(); 4]; R];
        unrolled!(16, for j in 0..const R {
            rows[j].each_own_part(
                #[inline(always)]
                |b, piece| pieces[j][b] = piece,
            );
        });
        unrolled!(64, for at in 0..const (Self::BLOCKS * R - 1) {
            to.store(at * len, pieces[at % R][at / R]);
        });
        let (l, before, last) =
            (Self::IN_BLOCK, pieces[R.saturating_sub(2)][Self::BLOCKS - 1], pieces[R - 1][Self::BLOCKS - 1]);
        let end = before.concat_swizzle(
            last,
            #[inline(always)]
            |i| if i + len < l { 2 * len + i - l } else { i + len },
        );
        to.store(to.len() - l, end)
    }

    /// Whether the records of a tail are taken where they are, with others in place of those that are missing.
    const fn one_by_one<const K: usize>() -> bool {
        (S::SSE41 || S::A64 || S::WASM) && K >= Self::IN_BLOCK && W::BYTES >= 16 && Self::LANES <= 16
    }
    #[op]
    #[allow(clippy::manual_memcpy, reason = "it has to be unrolled")]
    fn load_each<const K: usize, const L: usize>(self, from: &[T]) -> [V<T, W, S>; K] {
        use crate::mem::ChunkAt;
        let zeros = crate::plain::read_as::<T>(&Aligned([0u64; 16]).0).first_chunk::<K>().unwrap();
        let mut fields = [self.zero(); K];
        unrolled!(16, for part in 0..const (K.div_ceil(L)) {
            let next = part * L;
            let first = next.min(K.saturating_sub(L));
            let square = self.transpose_in_blocks::<L>(array::from_fn(
                #[inline(always)]
                |j| {
                    self.of_own_parts(
                        0,
                        &passed!(|b| {
                            self.simd()
                                .fixed::<T, Block<W>>()
                                .load(&from.chunk_at::<K>((b * L + j) * K).unwrap_or(zeros)[first..])
                        }),
                    )
                },
            ));
            unrolled!(16, for k in 0..const L {
                if next + k < K {
                    fields[next + k] = square[next + k - first];
                }
            });
        });
        fields
    }
    #[op]
    fn store_each<const K: usize, const L: usize>(self, v: [V<T, W, S>; K], to: &mut [T]) {
        let Some(last) = to.len().checked_sub(K) else { return };
        unrolled!(16, for part in 0..const (K.div_ceil(L)) {
            let next = part * L;
            let first = next.min(K.saturating_sub(L));
            let square = self.transpose_in_blocks::<L>(array::from_fn(
                #[inline(always)]
                |k| v[first + k],
            ));
            let mut pieces = [[self.simd().fixed::<T, Block<W>>().zero(); 4]; L];
            unrolled!(16, for j in 0..const L {
                square[j].each_own_part(
                    #[inline(always)]
                    |b, piece| pieces[j][b] = piece,
                );
            });
            // The last record is written after those that take its place.
            unrolled!(16, for back in 0..const (Self::LANES) {
                let record = Self::LANES - 1 - back;
                let at = (record * K).min(last);
                crate::window::check(to.len(), at, K);
                pieces[record % L][record / L].store(&mut to[at..][first..]);
            });
        });
    }
    /// As many values as there are, and then zeros.
    #[op]
    pub(crate) fn load_records_n<const K: usize, E: Readable<T>>(self, from: &[E]) -> [V<T, W, S>; K] {
        let n = Self::LANES;
        if const { E::PLAIN || E::AT_ONCE } && from.len() >= K * n {
            return live!(E::PLAIN || E::AT_ONCE, self.load_records(from));
        }
        if const { Self::one_by_one::<K>() && E::PLAIN } && from.len().is_multiple_of(K) {
            return live!(Self::one_by_one::<K>() && E::PLAIN, {
                if const { W::BYTES > 16 } && from.len() <= K * Self::IN_BLOCK {
                    let d = self.simd().fixed::<T, B16>();
                    return array::map(
                        by_lanes!(d.load_each::<K>(E::plain(from))),
                        #[inline(always)]
                        |v| v.resize(),
                    );
                }
                by_lanes!(self.load_each::<K>(E::plain(from)))
            });
        }
        by_room!(self.load_records_in::<K, E>(from))
    }
    #[op]
    fn load_records_in<const K: usize, E: Readable<T>, const ROOM: usize>(self, from: &[E]) -> [V<T, W, S>; K] {
        let n = Self::LANES;
        let (mut room, mut rest) = (Aligned([MaybeUninit::uninit(); ROOM]), &from[..from.len().min(K * n)]);
        let mut copy = Output::new(&mut room.0);
        // What is made of zeros only isn't computed.
        if const { W::BYTES > 16 } && from.len() <= K * Self::IN_BLOCK {
            return live!(W::BYTES > 16, {
                // As a loop, LLVM warns that it isn't unrolled where the caller has no features.
                macro_rules! vectors { ($($k:literal)*) => {$(
                    if const { $k * Self::LANES < K * Self::IN_BLOCK } {
                        copy.push(self.load_any_n(&from[from.len().min($k * n)..]));
                    }
                )*} }
                vectors!(0 1 2 3 4 5 6 7);
                array::map(
                    self.simd().fixed::<T, B16>().load_records(copy.into_filled()),
                    #[inline(always)]
                    |v| v.resize(),
                )
            });
        }
        while let Some(v) = self.read_from(&mut rest) {
            copy.push(v);
        }
        if !rest.is_empty() {
            copy.push(self.load_any_n(rest));
        }
        while copy.len() < K * n {
            copy.push(self.zero());
        }
        self.load_records(copy.into_filled())
    }
    /// As many values as fit.
    #[op]
    pub(crate) fn write_records_n<const K: usize, P: Place<T>>(self, v: [V<T, W, S>; K], mut to: P) {
        let n = Self::LANES;
        if const { P::ANY_ORDER } && to.len() >= K * n {
            return live!(P::ANY_ORDER, self.store_records(v, to));
        }
        if const { W::BYTES > 16 && !(K == 8 && Self::BYTE_PERMUTES) } && to.len() <= K * Self::IN_BLOCK {
            return live!(W::BYTES > 16, {
                let first = array::map(
                    v,
                    #[inline(always)]
                    |v| v.resize(),
                );
                self.simd().fixed::<T, B16>().write_records_n(first, to)
            });
        }
        if const { Self::one_by_one::<K>() && P::SLICE }
            && to.len().is_multiple_of(K)
            && let Some(to) = to.as_mut_slice()
        {
            return live!(Self::one_by_one::<K>() && P::SLICE, by_lanes!(self.store_each::<K>(v, to)));
        }
        by_room!(self.write_records_in::<K, P>(v, to))
    }
    #[op]
    fn write_records_in<const K: usize, P: Place<T>, const ROOM: usize>(self, v: [V<T, W, S>; K], mut to: P) {
        let (n, mut room) = (Self::LANES, Aligned([MaybeUninit::uninit(); ROOM]));
        let room = self.cleared(&mut room.0, K * n);
        if const { K == 8 && Self::BYTE_PERMUTES } && to.len() <= n {
            self.store_records(v, &mut *room);
            return self.load(room).write_n(&mut to, 0);
        }
        self.store_records(v, &mut *room);
        let mut rest = &*room;
        while to.len() >= n && !rest.is_empty() {
            self.load(rest).write(&mut to, 0);
            (rest, to) = (&rest[n..], to.skip(n));
        }
        if !rest.is_empty() {
            self.load(rest).write_n(&mut to, 0)
        }
    }
}

/// Where the consumer calls, so that the error shows that line.
pub(crate) const fn check(k: usize) -> usize {
    assert!(1 <= k && k <= 16, "this is for 1 to 16 vectors, also in a branch that is never taken");
    k
}
