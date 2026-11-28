//! All rounds of AES, and sums of carry-less products.

use crate::array::own::map;
use crate::{B32, B64, Isa, Lane, Operand, Simd, Width};

#[rules]
macro_rules! all_rounds { ($($(#[$doc:meta])* $name:ident $and:ident $round:ident $last:ident;)*) => {$(
    $(#[$doc])*
    #[op]
    #[track_caller]
    pub fn $name<const N: usize>(blocks: [Self; N], keys: &(impl crate::Slice<Item = [u8; 16]> + ?Sized)) -> [Self; N] {
        Self::$and(blocks, keys, || {})
    }
    /// The same, and calls `meanwhile` in all rounds but the last, for work on other units of the CPU, such as GHASH.
    #[op]
    #[track_caller]
    pub fn $and<const N: usize>(blocks: [Self; N], keys: &(impl crate::Slice<Item = [u8; 16]> + ?Sized), meanwhile: impl FnMut()) -> [Self; N] {
        require!("this takes vectors of 16 bytes or more", W::BYTES >= 16);
        let keys = crate::whole::has::<crate::whole::Values<u8, W, 2>, _>(keys);
        assert!(keys.len() >= 2, "too few keys");
        // The instruction takes one block. They are joined after the last round, and not after each.
        if const { S::AVX2 && S::HAS_AES && !S::VAES && W::BYTES == 32 } {
            return live!(S::AVX2 && S::HAS_AES && !S::VAES && W::BYTES == 32, {
                let rows = Simd::${concat($and, _rows)}(map(blocks, #[inline(always)] |v| v.same::<u8, B32>().split()), keys, meanwhile);
                map(rows, #[inline(always)] |[a, b]| a.concat(b).same())
            });
        }
        if const { S::AVX2 && S::HAS_AES && !S::VAES && W::BYTES == 64 } {
            return live!(S::AVX2 && S::HAS_AES && !S::VAES && W::BYTES == 64, {
                let rows = map(blocks, #[inline(always)] |v| {
                    let [lower, upper] = v.same::<u8, B64>().split();
                    let ([a, b], [c, d]) = (lower.split(), upper.split());
                    [a, b, c, d]
                });
                map(Simd::${concat($and, _rows)}(rows, keys, meanwhile), #[inline(always)] |[a, b, c, d]| a.concat(b).concat(c.concat(d)).same())
            });
        }
        map(Self::${concat($and, _rows)}(map(blocks, #[inline(always)] |v| [v]), keys, meanwhile), #[inline(always)] |[v]| v)
    }
    #[op]
    #[track_caller]
    fn ${concat($and, _rows)}<const N: usize, const K: usize, F: FnMut()>(mut blocks: [[Self; K]; N], keys: &[[u8; 16]], mut meanwhile: F) -> [[Self; K]; N] {
        let ([first, middle @ .., last], d) = (keys, Self::zero().tag()) else { unreachable!() };
        macro_rules! each { ($$v:ident, $$key:ident = $$from:expr, $$e:expr) => {{
            let ($$key, mut i) = (d.load_dup128($$from), 0);
            while i < N * K {
                let $$v = blocks[i / K][i % K];
                blocks[i / K][i % K] = $$e;
                i += 1;
            }
        }}; }
        // If this is unrolled, LLVM keeps the keys in registers and does one vector after the other. One or two gain by it, up to 2.6 times, and four of 64 bytes with nothing else to do up to 1.1.
        macro_rules! rounds { ($$key:ident in $$keys:expr, $$body:block) => {
            if const { S::HAS_AES && N * K * W::BYTES <= if S::VAES && S::REGISTER == 64 && size_of::<F>() == 0 { 256 } else if S::VAES { 2 * S::REGISTER } else { 32 } } {
                for $$key in $$keys $$body
            } else {
                let keys = $$keys;
                for $$key in &keys[..crate::regs::count(keys.len())] {
                    crate::not_unrolled();
                    $$body
                }
            }
        }; }
        if S::ARM {
            // The instruction starts with the key.
            let [.., before_last] = &keys[..keys.len() - 1] else { unreachable!() };
            rounds!(key in &keys[..keys.len() - 2], {
                each!(v, key = key, (v ^ key).$round(0));
                meanwhile();
            });
            each!(v, key = before_last, v ^ key);
        } else {
            each!(v, key = first, v ^ key);
            rounds!(key in middle, {
                each!(v, key = key, v.$round(key));
                meanwhile();
            });
        }
        each!(v, key = last, v.$last(key));
        blocks
    }
)*}; }

impl<S: Isa, W: Width> Simd<u8, W, S> {
    all_rounds! {
        /// Encrypts each block with 11, 13 or 15 expanded keys. It takes about eight vectors to keep the CPU busy.
        aes_encrypt aes_encrypt_and aes_round aes_last_round;
        /// The reverse, with the keys in reverse order, and all but the first and the last through
        /// [`aes_inv_mix_columns`](Self::aes_inv_mix_columns).
        aes_decrypt aes_decrypt_and aes_round_inv aes_last_round_inv;
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// `self ^ b ^ c`, which LLVM doesn't always turn into one instruction, or regroups.
    #[op]
    pub fn xor3(self, b: impl Operand<T, W, S>, c: impl Operand<T, W, S>) -> Self {
        return_if!(
            cfg!(target_arch = "aarch64") && S::HAS_SHA512,
            self.with_bytes(self.s.xor3::<W>(self.bytes(), b.vector(self.tag()).bytes(), c.vector(self.tag()).bytes()))
        );
        self ^ b ^ c
    }
    /// The bits that are set in two or all of the three: the carries of [`xor3`](Self::xor3). With AVX-512 it is one instruction for a register. Elsewhere, what a loop carries goes last in both: first, adders took up to 1.6 times as long.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x16::splat(0b1100).majority(0b1010, 0b0001), 0b1000);
    /// # } example()
    /// ```
    #[doc(alias("maj", "carry_save", "full_adder"))]
    #[op]
    pub fn majority(self, b: impl Operand<T, W, S>, c: impl Operand<T, W, S>) -> Self {
        let (b, c) = (b.vector(self.tag()), c.vector(self.tag()));
        return_if!(
            S::AVX512VL && W::BYTES >= 16,
            self.with_bytes(self.s.majority::<W>(self.bytes(), b.bytes(), c.bytes()))
        );
        (self ^ b).bit_select(c, self)
    }
}

impl<S: Isa, W: Width> Simd<u64, W, S> {
    /// `carryless_mul_even(other) ^ carryless_mul_odd(other) ^ sum`: the step of GHASH, and of CRCs with any polynomial, which fold each block into a later one. It wants `aes`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u64x2::from([0b11, 0b100]).carryless_dot_add([0b11, 0b100], [0b1000, 0]);
    /// assert_eq!(v, [0b101 ^ 0b10000 ^ 0b1000, 0]);
    /// # } example()
    /// ```
    #[op]
    #[doc(alias("clmul_accumulate"))]
    pub fn carryless_dot_add(self, other: impl Operand<u64, W, S>, sum: impl Operand<u64, W, S>) -> Self {
        // Without an exclusive or of three, a chain through `sum` waits for one step only.
        return_if!(
            S::HAS_AES
                && !S::AVX512F
                && !S::SVE2
                && (crate::X86 || !S::HAS_SHA512)
                && !cfg!(any(target_feature = "sha3", target_feature = "avx512f")),
            (self.carryless_mul_even(other) ^ self.carryless_mul_odd(other)).black_box() ^ sum
        );
        self.carryless_mul_even(other).xor3(self.carryless_mul_odd(other), sum)
    }
}
