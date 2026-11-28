//! The rounds and message schedules of SHA-1, SHA-256, SHA-512, SM3 and SM4.

use crate::{B16, B32, Isa, Simd, Width, X86};
use core::ops::{Add, AddAssign, BitXorAssign};

type V<S, T, W = B16> = Simd<T, W, S>;

/// Only for targets with the instructions.
macro_rules! sha_ops { () => {
    fn sha512_rounds4(self, _: u8x32, _: u8x32, _: u8x32) -> (u8x32, u8x32) { unreachable!() }
    fn sha512_schedule4(self, _: u8x32, _: u8x32, _: u8x32, _: u8x32) -> u8x32 { unreachable!() }
    fn sm3_rounds4(self, _: u8x16, _: u8x16, _: u8x16, _: u8x16, _: usize) -> (u8x16, u8x16) { unreachable!() }
    fn sm4_rounds_32(self, _: u8x32, _: u8x32) -> u8x32 { unreachable!() }
    fn sm4_keys_32(self, _: u8x32, _: u8x32) -> u8x32 { unreachable!() }
    $crate::sha::sha_ops! {
    sha1_first(abcd, e, w) -> u8x16; sha1_second(abcd, e, w) -> u8x16; sha1_third(abcd, e, w) -> u8x16;
    sha1_fourth(abcd, e, w) -> u8x16; sha1_next_e(abcd, w) -> u8x16; sha1_schedule(a, b, c, d) -> u8x16;
    sha256_rounds(a, b, wk) -> (u8x16, u8x16); sha256_schedule(a, b, c, d) -> u8x16;
    sha512_rounds(ab, cd, ef, gh, wk) -> (u8x16, u8x16); sha512_schedule(first, next, last, seven) -> u8x16;
    sm3_early(dcba, hgfe, w, mixed, t) -> (u8x16, u8x16); sm3_late(dcba, hgfe, w, mixed, t) -> (u8x16, u8x16);
    sm3_schedule(w0, w7, w12, w10, w3) -> u8x16;
    sm4_rounds_16(v, keys) -> u8x16; sm4_keys_16(v, constants) -> u8x16;
} };
($($name:ident($($a:ident),+) -> $out:ty;)*) => {$(
    fn $name(self, $($a: u8x16),+) -> $out { let _ = ($($a),+); unreachable!() }
)*}; }
pub(crate) use sha_ops;

/// An addition reads memory for free on x86, where it takes two steps to get a lane out of a register.
macro_rules! through_memory { ($($v:ident)*) => { $(let $v = if X86 { core::hint::black_box($v) } else { $v };)* }; }

macro_rules! states { ($($(#[$doc:meta])* $name:ident [$t:ident $w:ident; $n:literal];)*) => {$(
    $(#[$doc])*
    pub struct $name<S: Isa>([V<S, $t, $w>; $n]);
    impl<S: Isa> Copy for $name<S> {}
    impl<S: Isa> Clone for $name<S> {
        #[inline(always)]
        fn clone(&self) -> Self { *self }
    }
    /// Word by word.
    impl<S: Isa> Add for $name<S> {
        type Output = Self;
        #[op]
        fn add(mut self, other: Self) -> Self {
            let mut i = 0;
            while i < $n {
                self.0[i] += other.0[i];
                i += 1;
            }
            self
        }
    }
    impl<S: Isa> AddAssign for $name<S> {
        #[inline(always)]
        fn add_assign(&mut self, other: Self) { *self = *self + other }
    }
)*}; }
states! {
    /// The state of SHA-1. Unless `has!(sha)`, the rounds are scalar code. The loop is that of [`Sha256`], with `h.rounds4::<i>(w[0])`.
    Sha1 [u32 B16; 2];
    /// The state of SHA-256. Unless `has!(sha)`, the rounds are scalar code.
    ///
    /// ```
    /// # #[bun_simd::simd(sse4 + aes + sha, avx2, sse4, neon + crc + aes, neon)] mod simd {
    /// # use bun_simd::prelude::*;
    /// # static K: [u32; 64] = [0; 64];
    /// #[kernel]
    /// pub fn compress(state: &mut [u32; 8], blocks: &[[u8; 64]]) {
    ///     let mut h = Sha256::new(*state);
    ///     for block in blocks {
    ///         let (before, mut w) = (h, h.words(block));
    ///         unroll!(for i in 0..16 {
    ///             h = h.rounds4(w[0] + u32x4::load(&K[4 * i..]));
    ///             w = [w[1], w[2], w[3], Sha256::schedule(w)];
    ///         });
    ///         h += before;
    ///     }
    ///     *state = h.to_array();
    /// }
    /// # }
    /// # fn main() {}
    /// ```
    Sha256 [u32 B16; 2];
    /// The state of SHA-512. Unless `has!(sha512)`, the rounds are scalar code.
    Sha512 [u64 B32; 2];
}

impl<S: Isa> Sha1<S> {
    /// The instructions of x86 have the first word in the last lane.
    const REVERSED: bool = X86 && S::HAS_SHA1;

    #[op]
    pub(crate) fn on(s: S, [a, b, c, d, e]: [u32; 5]) -> Self {
        let t = s.fixed::<u32, B16>();
        let (abcd, e) = (t.from_array([a, b, c, d]), t.from_array([e, 0, 0, 0]));
        Self(choose! { Self::REVERSED => [abcd.reverse(), e.reverse()], _ => [abcd, e] })
    }
    /// The reverse of [`new`](Self::new).
    #[op]
    pub fn to_array(self) -> [u32; 5] {
        let [abcd, e] = choose! { Self::REVERSED => [self.0[0].reverse(), self.0[1].reverse()], _ => self.0 };
        let [a, b, c, d] = abcd.to_array();
        [a, b, c, d, e.get_lane()]
    }
    /// The words of a block. Their order within a vector is unspecified.
    #[op]
    pub fn words(self, block: &[u8; 64]) -> [V<S, u32>; 4] {
        let s = self.0[0].s;
        let d = s.fixed::<u8, B16>();
        macro_rules! at { ($($i:literal)*) => { [$({
            let v = d.load(&block[$i..]);
            choose! { Self::REVERSED => v.reverse().bitcast(), _ => v.bitcast::<u32>().swap_bytes() }
        }),*] }; }
        at!(0 16 32 48)
    }
    /// The four words that follow these sixteen.
    #[op]
    pub fn schedule([a, b, c, d]: [V<S, u32>; 4]) -> V<S, u32> {
        if const { S::HAS_SHA1 } {
            return a.with_bytes(a.s.sha1_schedule(a.bytes(), b.bytes(), c.bytes(), d.bytes()));
        }
        let x = a ^ a.tag().combine_shift_right_lanes::<2>(b, a) ^ c ^ d.shift_right_lanes::<1>();
        x.rotate_left(1) ^ x.shift_left_lanes::<3>().rotate_left(2)
    }
    /// The rounds from `4 * I` on, for `I` in `0..20`, as `unroll!` counts. This adds the
    /// constant of the round. Between the first call and the last, the state is only good for the next.
    #[op]
    #[track_caller]
    pub fn rounds4<const I: usize>(self, words: V<S, u32>) -> Self {
        require!("SHA-1 has 20 times four rounds", I < 20);
        let i = I;
        let ([abcd, e], s) = (self.0, words.s);
        const K: [u32; 4] = [0x5a82_7999, 0x6ed9_eba1, 0x8f1b_bcdc, 0xca62_c1d6];
        return_if!(S::HAS_SHA1, {
            // On x86, the second vector is what `abcd` was four rounds before.
            let w = match (X86, i) {
                (false, _) => words + K[i / 5],
                (true, 0) => words + e,
                _ => e.with_bytes(s.sha1_next_e(e.bytes(), words.bytes())),
            };
            let (v, e, w) = (abcd.bytes(), e.bytes(), w.bytes());
            let next_e = if X86 && i != 19 { v } else { s.sha1_next_e(v, abcd.tag().zero().bytes()) };
            // The rounds overwrite `abcd`. If they come first, as LLVM has it without -Ztune-cpu, each waits for a copy. That costs
            // 50% on Neoverse N1, V1 and V2, and saves 15% on N3, where `mov` is free.
            let v = crate::regs::after(v, next_e);
            let next = match i / 5 {
                0 => s.sha1_first(v, e, w),
                1 => s.sha1_second(v, e, w),
                2 => s.sha1_third(v, e, w),
                _ => s.sha1_fourth(v, e, w),
            };
            Self([abcd.with_bytes(next), abcd.with_bytes(next_e)])
        });
        let ([mut a, mut b, mut c, mut d], mut e, wk) = (abcd.to_array(), e.get_lane(), (words + K[i / 5]).to_array());
        through_memory!(wk);
        macro_rules! round { ($($j:literal)*) => {$(
            let turned = b.rotate_left(30);
            let f = match i / 5 { 0 => d ^ b & (c ^ d), 2 => c ^ (b ^ c) & (c ^ d), _ => b ^ c ^ d };
            (a, b, c, d, e) = (e.wrapping_add(wk[$j]).wrapping_add(f).wrapping_add(a.rotate_left(5)), a, turned, c, d);
        )*}; }
        round!(0 1 2 3);
        Self([abcd.tag().from_array([a, b, c, d]), abcd.tag().from_array([e, 0, 0, 0])])
    }
}

/// Rounds of SHA-2, and the next four words.
macro_rules! sha2 {
    (rounds $v:ident $wk:ident [$a0:literal $a1:literal $a2:literal] [$e0:literal $e1:literal $e2:literal] $($j:literal)*) => {$(
        let [a, b, c, d, e, f, g, h] = $v;
        let t = h.wrapping_add($wk[$j]).wrapping_add(g ^ e & (f ^ g))
            .wrapping_add(e.rotate_right($e0) ^ e.rotate_right($e1) ^ e.rotate_right($e2));
        let u = (b ^ (a ^ b) & (b ^ c)).wrapping_add(a.rotate_right($a0) ^ a.rotate_right($a1) ^ a.rotate_right($a2));
        $v = [t.wrapping_add(u), a, b, c, d.wrapping_add(t), e, f, g];
    )*};
    (sigma $v:expr, $r0:literal $r1:literal $shift:literal) => {{
        let v = $v;
        v.rotate_right($r0) ^ v.rotate_right($r1) ^ v >> $shift
    }};
}

impl<S: Isa> Sha256<S> {
    /// The instructions of x86 take `[f, e, b, a]` and `[h, g, d, c]`.
    const MIXED: bool = X86 && S::HAS_SHA256;

    #[op]
    pub(crate) fn on(s: S, [a, b, c, d, e, f, g, h]: [u32; 8]) -> Self {
        let t = s.fixed::<u32, B16>();
        // LLVM would load the middle of a state in memory, across the two stores that wrote it, and wait for them.
        return_if!(X86 && Self::MIXED, {
            let (x, y) = (t.from_array([a, b, c, d]).black_box(), t.from_array([e, f, g, h]).black_box());
            Self([
                y.concat_swizzle(
                    x,
                    #[inline(always)]
                    |i| [1, 0, 5, 4][i],
                ),
                y.concat_swizzle(
                    x,
                    #[inline(always)]
                    |i| [3, 2, 7, 6][i],
                ),
            ])
        });
        Self([t.from_array([a, b, c, d]), t.from_array([e, f, g, h])])
    }
    /// The reverse of [`new`](Self::new).
    #[op]
    pub fn to_array(self) -> [u32; 8] {
        let ([a, b, c, d], [e, f, g, h]) = (self.0[0].to_array(), self.0[1].to_array());
        if const { Self::MIXED } { [d, c, h, g, b, a, f, e] } else { [a, b, c, d, e, f, g, h] }
    }
    /// The words of a block, in order.
    #[op]
    pub fn words(self, block: &[u8; 64]) -> [V<S, u32>; 4] {
        let s = self.0[0].s;
        let d = s.fixed::<u8, B16>();
        macro_rules! at { ($($i:literal)*) => { [$(d.load(&block[$i..]).bitcast::<u32>().swap_bytes()),*] }; }
        at!(0 16 32 48)
    }
    /// In each block: the four words that follow these sixteen.
    #[op]
    #[track_caller]
    pub fn schedule<W: Width>([a, b, c, d]: [V<S, u32, W>; 4]) -> V<S, u32, W> {
        require!(of(W, S), "this takes vectors of 16 bytes or more", W::BYTES >= 16);
        if const { S::HAS_SHA256 && W::BYTES == 16 } {
            let (x, y) = ((W::to16(a.bytes()), W::to16(b.bytes())), (W::to16(c.bytes()), W::to16(d.bytes())));
            return a.with_bytes(W::from16(a.s.sha256_schedule(x.0, x.1, y.0, y.1)));
        }
        let t = a.tag();
        let x =
            a + sha2!(sigma t.combine_shift_right_lanes::<1>(b, a), 7 18 3) + t.combine_shift_right_lanes::<1>(d, c);
        // A shift of 64 bits rotates a word that is there twice.
        return_if!(S::SSSE3 && !S::AVX512VL, {
            let sigma = always!(|v: V<S, u32, W>| (v.bitcast::<u64>() >> 17 ^ v.bitcast::<u64>() >> 19)
                .bitcast::<u32>()
                ^ v >> 10);
            let (bytes, none) = (t.repartition::<u8>(), 0x80);
            let low = bytes.dup128([0, 1, 2, 3, 8, 9, 10, 11, none, none, none, none, none, none, none, none]);
            let high = bytes.dup128([none, none, none, none, none, none, none, none, 0, 1, 2, 3, 8, 9, 10, 11]);
            let x = x + sigma(d.interleave_upper(d)).table_lookup_bytes(low).bitcast();
            x + sigma(x.interleave_lower(x)).table_lookup_bytes(high).bitcast()
        });
        let x = x + sha2!(sigma d.shift_right_lanes::<2>(), 17 19 10);
        x + sha2!(sigma x.shift_left_lanes::<2>(), 17 19 10)
    }
    /// Four rounds, with the sums of the words and the constants of the rounds.
    #[op]
    pub fn rounds4(self, sums: V<S, u32>) -> Self {
        return_if!(S::HAS_SHA256, {
            let (x, y) = sums.s.sha256_rounds(self.0[0].bytes(), self.0[1].bytes(), sums.bytes());
            Self([sums.with_bytes(x), sums.with_bytes(y)])
        });
        let (mut v, wk) = (self.to_array(), sums.to_array());
        through_memory!(wk);
        sha2!(rounds v wk [2 13 22] [6 11 25] 0 1 2 3);
        Self::on(sums.s, v)
    }
}

impl<S: Isa> Sha512<S> {
    /// As for SHA-256.
    const MIXED: bool = X86 && S::HAS_SHA512;

    #[op]
    pub(crate) fn on(s: S, [a, b, c, d, e, f, g, h]: [u64; 8]) -> Self {
        let t = s.fixed::<u64, B32>();
        let (x, y) = if const { Self::MIXED } { ([f, e, b, a], [h, g, d, c]) } else { ([a, b, c, d], [e, f, g, h]) };
        Self([t.from_array(x), t.from_array(y)])
    }
    /// The reverse of [`new`](Self::new).
    #[op]
    pub fn to_array(self) -> [u64; 8] {
        let ([a, b, c, d], [e, f, g, h]) = (self.0[0].to_array(), self.0[1].to_array());
        if const { Self::MIXED } { [d, c, h, g, b, a, f, e] } else { [a, b, c, d, e, f, g, h] }
    }
    /// The words of a block, in order.
    #[op]
    pub fn words(self, block: &[u8; 128]) -> [V<S, u64, B32>; 4] {
        let s = self.0[0].s;
        let d = s.fixed::<u8, B32>();
        macro_rules! at { ($($i:literal)*) => { [$(d.load(&block[$i..]).bitcast::<u64>().swap_bytes()),*] }; }
        at!(0 32 64 96)
    }
    /// The four words that follow these sixteen.
    #[op]
    pub fn schedule([a, b, c, d]: [V<S, u64, B32>; 4]) -> V<S, u64, B32> {
        let t = a.tag();
        let seven = t.combine_slide_down::<1>(d, c);
        if const { Self::MIXED } {
            return a.with_bytes(a.s.sha512_schedule4(a.bytes(), b.bytes(), seven.bytes(), d.bytes()));
        }
        return_if!(S::HAS_SHA512, {
            let (s, first, second) = (a.s, a.lower_half(), a.upper_half());
            let lower =
                s.sha512_schedule(first.bytes(), second.bytes(), d.upper_half().bytes(), seven.lower_half().bytes());
            let upper = s.sha512_schedule(second.bytes(), b.lower_half().bytes(), lower, seven.upper_half().bytes());
            t.combine(first.with_bytes(upper), first.with_bytes(lower))
        });
        let x = a + sha2!(sigma t.combine_slide_down::<1>(b, a), 1 8 7) + seven;
        let lower = x.lower_half() + sha2!(sigma d.upper_half(), 19 61 6);
        t.combine(x.upper_half() + sha2!(sigma lower, 19 61 6), lower)
    }
    /// Four rounds, with the sums of the words and the constants of the rounds.
    #[op]
    pub fn rounds4(self, sums: V<S, u64, B32>) -> Self {
        return_if!(Self::MIXED, {
            let (x, y) = sums.s.sha512_rounds4(self.0[0].bytes(), self.0[1].bytes(), sums.bytes());
            Self([sums.with_bytes(x), sums.with_bytes(y)])
        });
        return_if!(S::HAS_SHA512, {
            // Two rounds move `ab` to `cd` and `ef` to `gh`.
            let ([ab, cd], [ef, gh], s) = (self.0[0].split(), self.0[1].split(), sums.s);
            let (cd, gh) = s.sha512_rounds(ab.bytes(), cd.bytes(), ef.bytes(), gh.bytes(), sums.lower_half().bytes());
            let (x, y) = s.sha512_rounds(cd, ab.bytes(), gh, ef.bytes(), sums.upper_half().bytes());
            Self([ab.with_bytes(x).concat(ab.with_bytes(cd)), ab.with_bytes(y).concat(ab.with_bytes(gh))])
        });
        let (mut v, wk) = (self.to_array(), sums.to_array());
        through_memory!(wk);
        sha2!(rounds v wk [28 34 39] [14 18 41] 0 1 2 3);
        Self::on(sums.s, v)
    }
}

/// The state of SM3. Unless `has!(sm4)`, the rounds are scalar code.
pub struct Sm3<S: Isa>([V<S, u32>; 2]);
impl<S: Isa> Copy for Sm3<S> {}
impl<S: Isa> Clone for Sm3<S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}
/// Word by word.
impl<S: Isa> BitXorAssign for Sm3<S> {
    #[op]
    fn bitxor_assign(&mut self, other: Self) {
        self.0 = [self.0[0] ^ other.0[0], self.0[1] ^ other.0[1]]
    }
}

impl<S: Isa> Sm3<S> {
    /// The instructions of x86 take `[f, e, b, a]`, and `[h, g, d, c]` as what these were two rounds before.
    const MIXED: bool = X86 && S::HAS_SM4;

    #[op]
    pub(crate) fn on(s: S, [a, b, c, d, e, f, g, h]: [u32; 8]) -> Self {
        // The instructions put the new `a` or `e` in the last lane and move the others down. Scalar code doesn't care.
        let t = s.fixed::<u32, B16>();
        return_if!(
            Self::MIXED,
            Self([
                t.from_array([f, e, b, a]),
                t.from_array([h.rotate_right(19), g.rotate_right(19), d.rotate_right(9), c.rotate_right(9)])
            ])
        );
        Self([t.from_array([d, c, b, a]), t.from_array([h, g, f, e])])
    }
    /// The reverse of [`new`](Self::new).
    #[op]
    pub fn to_array(self) -> [u32; 8] {
        let ([d, c, b, a], [h, g, f, e]) = (self.0[0].to_array(), self.0[1].to_array());
        choose! { Self::MIXED => [a, b, e.rotate_left(9), f.rotate_left(9), c, d, g.rotate_left(19), h.rotate_left(19)], _ => [a, b, c, d, e, f, g, h] }
    }
    /// The words of a block, in order.
    #[op]
    pub fn words(self, block: &[u8; 64]) -> [V<S, u32>; 4] {
        let s = self.0[0].s;
        Sha256::on(s, [0; 8]).words(block)
    }
    /// The four words that follow these sixteen.
    #[op]
    pub fn schedule([w0, w4, w8, w12]: [V<S, u32>; 4]) -> V<S, u32> {
        // Word 16 is P1(0 ^ 7 ^ (13 <<< 15)) ^ (3 <<< 7) ^ 10. `wN` has the words from N on. This `w7` is the next `w3`.
        let t = w0.tag();
        let (w3, w7) = (t.combine_shift_right_lanes::<3>(w4, w0), t.combine_shift_right_lanes::<3>(w8, w4));
        let w10 = t.combine_shift_right_lanes::<2>(w12, w8);
        if const { S::HAS_SM4 } {
            return w0.with_bytes(w0.s.sm3_schedule(w0.bytes(), w7.bytes(), w12.bytes(), w10.bytes(), w3.bytes()));
        }
        // Word 19 needs word 16, and starts with zero for it. P1 is linear, so what is missing is P1(16 <<< 15).
        let x = w0.xor3(w7, w12.shift_right_lanes::<1>().rotate_left(15));
        let x = x.xor3(x.rotate_left(15), x.rotate_left(23)).xor3(w3.rotate_left(7), w10);
        let w16 = x.shift_left_lanes::<3>();
        x.xor3(w16.rotate_left(15), w16.rotate_left(30)) ^ w16.rotate_left(6)
    }
    /// The rounds from `4 * I` on, for `I` in `0..16`, as `unroll!` counts. `next` are the
    /// four words after `words`.
    #[op]
    #[track_caller]
    pub fn rounds4<const I: usize>(self, words: V<S, u32>, next: V<S, u32>) -> Self {
        require!("SM3 has 16 times four rounds", I < 16);
        let i = I;
        // Round j takes T <<< j, word j, and word j ^ word j + 4.
        let first = (if i < 4 { 0x79cc_4519u32 } else { 0x7a87_9d8a }).rotate_left(4 * i as u32);
        let (s, mixed) = (words.s, words ^ next);
        return_if!(Self::MIXED, {
            let (x, y) = s.sm3_rounds4(self.0[0].bytes(), self.0[1].bytes(), words.bytes(), next.bytes(), i);
            Self([words.with_bytes(x), words.with_bytes(y)])
        });
        return_if!(S::HAS_SM4, {
            let t = words.tag().from_array([first, first.rotate_left(1), first.rotate_left(2), first.rotate_left(3)]);
            let (x, y, w, mixed, t) = (self.0[0].bytes(), self.0[1].bytes(), words.bytes(), mixed.bytes(), t.bytes());
            let (x, y) = if i < 4 { s.sm3_early(x, y, w, mixed, t) } else { s.sm3_late(x, y, w, mixed, t) };
            Self([words.with_bytes(x), words.with_bytes(y)])
        });
        let (mut v, w, mixed) = (self.to_array(), words.to_array(), mixed.to_array());
        through_memory!(w mixed);
        macro_rules! round { ($($j:literal)*) => {$(
            let [a, b, c, d, e, f, g, h] = v;
            let (ff, gg) = if i < 4 { (a ^ b ^ c, e ^ f ^ g) } else { (b & c ^ a & (b ^ c), g ^ e & (f ^ g)) };
            let twelve = a.rotate_left(12);
            let ss1 = twelve.wrapping_add(first.rotate_left($j)).wrapping_add(e).rotate_left(7);
            let tt1 = d.wrapping_add(mixed[$j]).wrapping_add(ff).wrapping_add(ss1 ^ twelve);
            let tt2 = h.wrapping_add(w[$j]).wrapping_add(gg).wrapping_add(ss1);
            v = [tt1, a, b.rotate_left(9), c, tt2 ^ tt2.rotate_left(9) ^ tt2.rotate_left(17), e, f.rotate_left(19), g];
        )*}; }
        round!(0 1 2 3);
        Self::on(s, v)
    }
}

/// The images of 1, 2, 4 and so on.
type Linear = [u8; 8];
const fn apply(f: Linear, x: u8) -> u8 {
    let (mut y, mut i) = (0, 0);
    while i < 8 {
        y ^= f[i] * (x >> i & 1);
        i += 1;
    }
    y
}
const fn undo(f: Linear, y: u8) -> u8 {
    let mut x = 0;
    while apply(f, x) != y {
        x += 1;
    }
    x
}
macro_rules! linear {
    (|$x:ident| $e:expr) => {{
        let (mut f, mut i) = ([0; 8], 0);
        while i < 8 {
            let $x: u8 = 1 << i;
            f[i] = $e;
            i += 1;
        }
        f
    }};
}
// The S-box is twice `MIX` and 0xd3, with the inverse modulo 0x1f5 in between. 0x23 is a root of that in the field of AES.
const MIX: Linear = linear!(|x| x ^ x.rotate_left(1) ^ x.rotate_left(3) ^ x.rotate_left(6) ^ x.rotate_left(7));
const TO_AES: Linear = {
    let (by, mut f, mut i) = (crate::galois_nibbles(0x23, 0x1b), [1; 8], 1);
    while i < 8 {
        f[i] = by[0][f[i - 1] as usize & 15] ^ by[1][f[i - 1] as usize >> 4];
        i += 1;
    }
    f
};
const BEFORE: Linear = linear!(|x| apply(TO_AES, apply(MIX, x)));
const AFTER: Linear = once!(Linear = linear!(|x| apply(MIX, undo(TO_AES, x))));
const AFTER_AES: Linear = linear!(|x| apply(AFTER, x.rotate_left(1) ^ x.rotate_left(3) ^ x.rotate_left(6)));

const fn matrix(f: Linear) -> u64 {
    let (mut rows, mut i) = (0, 0);
    while i < 64 {
        rows |= ((f[i % 8] >> (7 - i / 8) & 1) as u64) << i;
        i += 1;
    }
    rows
}
const fn nibbles(f: Linear) -> [[u8; 16]; 2] {
    let (mut tables, mut i) = ([[0; 16]; 2], 0);
    while i < 16 {
        (tables[0][i], tables[1][i]) = (apply(f, i as u8), apply(f, 16 * i as u8));
        i += 1;
    }
    tables
}
macro_rules! map { ($f:ident, $v:expr) => {{
    let (v, [low, high]) = ($v, const { nibbles($f) });
    choose! {
        S::LOOKS_UP_IN_REGISTERS => v.tag().dup128(low).table_lookup_bytes(v & 15) ^ v.tag().dup128(high).table_lookup_bytes(v >> 4),
        _ => {
            let bit = always!(|i: usize| (v.bitcast::<u16>() >> i as u32 & 0x0101) * $f[i] as u16);
            (bit(0) ^ bit(1) ^ bit(2) ^ bit(3) ^ bit(4) ^ bit(5) ^ bit(6) ^ bit(7)).bitcast::<u8>()
        },
    }
}}; }

/// What a round adds to a word, from the sum of the other three, the key and `SM4_BIAS`.
#[inline(always)]
fn sm4_round<S: Isa, W: Width, const KEYS: bool, const EQUAL: bool>(t: V<S, u32, W>) -> V<S, u32, W> {
    apart_unoptimized!(t.s, {
        let t = t.bitcast::<u8>();
        let t = choose! {
            S::GFNI => t.galois_affine(const { matrix(BEFORE) }).galois_affine_inverse(const { matrix(AFTER) }),
            _ => {
                // AES moves bytes among the words.
                let t = if EQUAL { t } else { t.swizzle_groups([0, 13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3]) };
                map!(AFTER_AES, map!(BEFORE, t).aes_last_round(0x63))
            },
        };
        let t = (t ^ 0xd3).bitcast::<u32>();
        if KEYS {
            t.xor(t.rotate_left(13)).xor(t.rotate_left(23))
        } else {
            t.xor(t.rotate_left(24)).xor(t.xor(t.rotate_left(8)).xor(t.rotate_left(16)).rotate_left(2))
        }
    })
}
const SM4_BIAS: u32 = undo(MIX, 0xd3) as u32 * 0x0101_0101;

#[op]
#[track_caller]
fn sm4<S: Isa, W: Width, const KEYS: bool>(v: V<S, u32, W>, with: V<S, u32, W>) -> V<S, u32, W> {
    require!(of(W, S), "this takes vectors of 16 bytes or more", W::BYTES >= 16);
    if_here!(X86 && S::HAS_SM4 && W::BYTES == 32, {
        let (a, b) = (W::to32(v.bytes()), W::to32(with.bytes()));
        return v.with_bytes(W::from32(if KEYS { v.s.sm4_keys_32(a, b) } else { v.s.sm4_rounds_32(a, b) }));
    });
    if const { !S::HAS_SM4 && W::BYTES == 64 && S::REGISTER < 64 } {
        // A word of each block in a register.
        let words = always!(|v: V<S, u32, W>| {
            Simd::transpose_in_blocks([v.block::<0>(), v.block::<1>(), v.block::<2>(), v.block::<3>()])
        });
        let (mut x, with) = (words(v), words(with ^ SM4_BIAS));
        macro_rules! round { ($($i:literal)*) => {$(
            x[$i] ^= sm4_round::<S, _, KEYS, false>(x[($i + 1) % 4] ^ x[($i + 2) % 4] ^ with[$i] ^ x[($i + 3) % 4]);
        )*}; }
        round!(0 1 2 3);
        let [a, b, c, d] = Simd::transpose_in_blocks(x);
        return a.concat(b).concat(c.concat(d)).resize();
    }
    if const { W::BYTES > 16 && (S::HAS_SM4 || W::BYTES > S::REGISTER) } {
        let lower = again!(sm4::<S, _, KEYS>, v.lower_half(), with.lower_half());
        return v.tag().combine(again!(sm4::<S, _, KEYS>, v.upper_half(), with.upper_half()), lower);
    }
    if const { S::HAS_SM4 } {
        let (a, b) = (W::to16(v.bytes()), W::to16(with.bytes()));
        return v.with_bytes(W::from16(if KEYS { v.s.sm4_keys_16(a, b) } else { v.s.sm4_rounds_16(a, b) }));
    }
    // All lanes of a block do the same.
    let (pairs, with) = (v ^ v.swap_pairs(), v ^ with ^ SM4_BIAS);
    let all = pairs ^ pairs.shuffle1032();
    let a = sm4_round::<S, W, KEYS, true>(all.xor(with.broadcast::<0>()));
    let b = sm4_round::<S, W, KEYS, true>(all.xor(with.broadcast::<1>()).xor(a));
    let c = sm4_round::<S, W, KEYS, true>(all.xor(with.broadcast::<2>()).xor(a).xor(b));
    let d = sm4_round::<S, W, KEYS, true>(all.xor(with.broadcast::<3>()).xor(a).xor(b).xor(c));
    v ^ b.odd_even(a).bitcast::<u64>().alternate(d.odd_even(c).bitcast()).bitcast()
}

impl<S: Isa, W: Width> V<S, u32, W> {
    /// In each block: four rounds of SM4. Unless `has!(sm4)`, it is made of GFNI or a round of AES, and 64 bytes at a time are best.
    /// See [`aes_round`](Self::aes_round) for its time.
    #[op]
    #[track_caller]
    pub fn sm4_rounds4(self, keys: impl crate::Operand<u32, W, S>) -> Self {
        sm4::<S, W, false>(self, self.like(keys))
    }
    /// In each block: the four keys of SM4 that follow these. See [`sm4_rounds4`](Self::sm4_rounds4).
    #[op]
    #[track_caller]
    pub fn sm4_next_keys(self, constants: impl crate::Operand<u32, W, S>) -> Self {
        sm4::<S, W, true>(self, self.like(constants))
    }
}
