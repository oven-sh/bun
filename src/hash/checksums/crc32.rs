//! The CRC-32 of gzip.

use super::crc32_tables::{after_zeros, crc32_without_kernel};
use super::input::{Copies, Input, Source, copying};
use bun_simd::prelude::*;
use std::io::BorrowedCursor;

targets!(
    icelake,
    avx512 + aes, // For the XOR of three, on 16 bytes.
    avx2 + vaes,
    avx2 + aes,
    sse4 + aes,
    sse4,
    neon82 + aes + sha3 + fast_clmul,
    neon82 + aes + sha3,
    neon + crc + aes,
    neon + crc
);

#[simd]
type V<W> = Simd<u64, W, S>;
const X86: bool = cfg!(target_arch = "x86_64");

/// x^31, x^95 and so on, modulo the polynomial, with the highest power in the lowest bit.
const POWERS: &[u32; 256] = &{
    let (mut powers, mut i) = ([1; 256], 1);
    while i < powers.len() {
        powers[i] = after_zeros(powers[i - 1], 8);
        i += 1;
    }
    powers
};

const fn power_of_x(exponent: usize) -> u64 {
    assert!(exponent % 64 == 31);
    POWERS[exponent / 64] as u64
}

#[repr(align(128))]
struct Aligned<T>(T);
/// So that no load crosses a page.
#[repr(align(1024))]
struct InPage<T>(T);

/// For the last 8-byte words of the input. The sum of the products is the input times x^32, in 96 bits.
/// The first eight are not used.
static FACTORS: InPage<[[u8; 8]; 72]> = {
    let (mut factors, mut i) = ([[0; 8]; 72], 0);
    while i < 64 {
        factors[8 + i] = power_of_x(64 * (63 - i) + 31).to_le_bytes();
        i += 1;
    }
    InPage(factors)
};

/// For the vectors from `left` bytes before the end of the input on.
#[simd]
fn factors(left: usize) -> Input<'static, ()> {
    Input::new(&FACTORS.0.as_flattened()[576 - left..])
}

/// Merges the first vector into the second, which starts so many bytes after it.
macro_rules! fold {
    ($distance:expr, $earlier:expr, $later:expr) => {{
        let factors = const {
            [
                power_of_x(8 * ($distance) + 31),
                power_of_x(8 * ($distance) - 33),
            ]
        };
        $earlier.carryless_dot_add(Simd::repeat(&factors), $later)
    }};
}

#[simd]
fn in_front<W: Width>(value: u64) -> V<W, S> {
    u64x1::splat(value).resize()
}

/// The one at `count` moves the first `count` bytes to the end, the one at `16 + count` the others to the start.
static SHIFTS: Aligned<[u8; 80]> = {
    let (mut shifts, mut i) = ([0x80; 80], 0);
    while i < 16 {
        shifts[16 + i] = i as u8;
        i += 1;
    }
    Aligned(shifts)
};

#[simd]
fn shift<W: Width>(v: V<W, S>, from: usize) -> V<W, S> {
    v.in_blocks()
        .lookup_bytes_relaxed(Simd::load_block(&SHIFTS.0[from & 63..]))
}

/// A load is cheaper than the way through a general register.
#[simd]
fn loaded(factor: u64) -> u64x2<S> {
    u64x2::from([factor, 1]).black_box()
}

/// Barrett reduction, once the `last` vector is added.
#[simd]
fn reduce<W: Width>(sum: V<W, S>, last: V<W, S>) -> u32 {
    let mut factors: V<W, S> = factors(W::BYTES).vector();
    if W::BYTES == 16 {
        factors = factors.black_box();
    }
    let mut sum = if W::BYTES == 16 {
        sum ^ last.carryless_mul_even(factors) ^ last.in_blocks().shift_elements_left::<1>(0)
    } else {
        last.carryless_dot_add(factors, sum)
    };
    if const { W::BYTES == 64 } {
        sum ^= sum.shift_elements_left::<4>(0)
    }
    if W::BYTES >= 32 {
        sum ^= sum.shift_elements_left::<2>(0)
    }
    let v = sum.block::<0>();
    let multiple = v
        .carryless_mul_even(loaded(0xB4E5_B025_F701_1641))
        .carryless_mul_even(loaded(0x1_DB71_0641));
    (v ^ multiple)[1] as u32
}

#[simd]
fn by_instruction(mut crc: u32, input: &mut Input<impl Copies>) -> u32 {
    input.groups(
        32,
        #[inline(always)]
        |input| {
            for word in input.words::<4>() {
                crc = bun_simd::prelude::crc32(crc, word);
            }
        },
    );
    if input.has(16) {
        for word in input.words::<2>() {
            crc = bun_simd::prelude::crc32(crc, word);
        }
    }
    if let Some(word) = input.array() {
        crc = bun_simd::prelude::crc32(crc, u64::from_le_bytes(word))
    }
    if let Some(word) = input.array() {
        crc = bun_simd::prelude::crc32(crc, u32::from_le_bytes(word))
    }
    if let Some(word) = input.array() {
        crc = bun_simd::prelude::crc32(crc, u16::from_le_bytes(word))
    }
    if let Some([byte]) = input.array() {
        crc = bun_simd::prelude::crc32(crc, byte)
    }
    crc
}

/// Four independent parts hide the latency of the instruction.
#[simd]
fn by_four_instructions(mut crc: u32, input: &mut Input<impl Copies>) -> u32 {
    const PART: usize = 512;
    while input.has(4 * PART) {
        let mut crcs = [crc, 0, 0, 0];
        input.parts::<4, _>(
            PART,
            #[inline(always)]
            |parts| {
                for _ in 0..PART / 16 {
                    let mut pairs = [[0; 2]; 4];
                    for part in 0..4 {
                        pairs[part] = parts[part].words();
                    }
                    for half in 0..2 {
                        for part in 0..4 {
                            crcs[part] = bun_simd::prelude::crc32(crcs[part], pairs[part][half]);
                        }
                    }
                }
            },
        );
        let moved = |part: usize, factor: u64| {
            u64x2::splat(crcs[part].into()).carryless_mul_even(factor)[0]
        };
        let [one, two, three] = const {
            [
                power_of_x(8 * PART - 33),
                power_of_x(16 * PART - 33),
                power_of_x(24 * PART - 33),
            ]
        };
        crc =
            crcs[3] ^ bun_simd::prelude::crc32(0, moved(0, three) ^ moved(1, two) ^ moved(2, one));
    }
    by_instruction(crc, input)
}

/// `chains` stand for everything in front of `input`. Less than a stride or two are left afterwards.
#[simd]
fn fold_strides<const CHAINS: usize, W: Width, C: Copies>(
    chains: &mut [V<W, S>; CHAINS],
    input: &mut Input<C>,
) {
    pick! {
        crc + fast_clmul => fold_next_to_instruction::<CHAINS, 64, W, S>(chains, input),
        crc => fold_next_to_instruction::<CHAINS, 128, W, S>(chains, input),
        _ => {
            if const { W::BYTES == 16 && !C::COPIES } {
                skip_and_fold(chains, input)
            }
            input.groups(
                CHAINS * W::BYTES,
                #[inline(always)]
                |input| {
                    for chain in &mut *chains {
                        *chain = fold!(CHAINS * W::BYTES, *chain, input.vector::<_, u64, W>());
                    }
                },
            )
        },
    }
}

/// The instruction has a unit of its own, which works on some bytes meanwhile: the more, the slower multiplications are.
#[only(crc)]
fn fold_next_to_instruction<const CHAINS: usize, const SKIPPED: usize, W: Width>(
    chains: &mut [V<W, S>; CHAINS],
    input: &mut Input<impl Copies>,
) {
    input.groups(
        CHAINS * W::BYTES + SKIPPED,
        #[inline(always)]
        |input| {
            let mut crc = 0;
            unroll!(for _ in 0..SKIPPED / 16 {
                for word in input.words::<2>() {
                    crc = bun_simd::prelude::crc32(crc, word);
                }
            });
            for chain in &mut *chains {
                let next: V<W, S> = input.vector();
                *chain = fold!(CHAINS * W::BYTES + SKIPPED, *chain, next);
            }
            chains[0] ^= in_front::<W, S>(crc as u64);
        },
    );
}

/// Of each group of vectors, the first `SKIPPED` are not multiplied. XORing one into the vectors at certain distances
/// after it gives the same CRC. https://arxiv.org/abs/2412.16398
#[simd]
fn skip_and_fold<const CHAINS: usize, W: Width, C: Copies>(
    chains: &mut [V<W, S>; CHAINS],
    input: &mut Input<C>,
) {
    const SKIPPED: usize = if Native::<S>::BYTES == 64 { 18 } else { 12 };
    const FOLDED: usize = 54;
    while input.len() >= (S::SKIPPED + FOLDED) * W::BYTES {
        let mut skipped = [V::<W, S>::zero(); S::SKIPPED];
        let mut step = |i: usize| {
            let mut v: V<W, S> = input.vector();
            for distance in [15, 17, 20, 23, 26, 28, 46, 50, 53] {
                if let Some(&earlier) = skipped.get(i.wrapping_sub(distance)) {
                    v ^= earlier;
                }
            }
            if i < S::SKIPPED {
                skipped[i] = v;
            } else {
                let chain = &mut chains[(i - S::SKIPPED) % CHAINS];
                *chain = if i < S::SKIPPED + CHAINS {
                    fold!((CHAINS + S::SKIPPED) * W::BYTES, *chain, v)
                } else {
                    fold!(CHAINS * W::BYTES, *chain, v)
                };
            }
        };
        unroll!(for six in 0..(S::SKIPPED + FOLDED) / 6 {
            unroll!(for i in 0..6 {
                step(6 * six + i)
            });
        });
    }
}

/// The first `part` bytes behind zeros, which do not change a CRC, and what is left of `crc` for the next vector.
#[simd]
fn first_part<W: Width>(
    crc: u32,
    input: &mut Input<impl Copies>,
    part: usize,
) -> (V<W, S>, V<W, S>) {
    let front = in_front::<W, S>(crc as u64);
    let first = input.start_of_vector(part) ^ front;
    if W::BYTES == 16 {
        return (shift(first, part), shift(front, 16 + part));
    }
    let padded = first
        .bitcast::<u8>()
        .shift_elements_right_dyn(W::BYTES - part, 0);
    (
        padded.bitcast(),
        in_front::<W, S>(crc as u64 >> (8 * part).min(32)),
    )
}

/// At least a vector, and up to 512 bytes. The conditions are those that the loads check.
#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
#[simd]
fn by_few_vectors<W: Width>(crc: u32, input: &mut Input<impl Copies>) -> u32 {
    let (n, len) = (W::BYTES, input.len());
    // Those for the vector before.
    let factors = &FACTORS.0.as_flattened()[576 - n - len..][..len];
    let (mut next, rest_of_crc) = first_part::<W, S>(crc, input, (len - 1) % n + 1);
    let mut sum = V::<W, S>::zero();
    if input.has(n) {
        sum = next.carryless_dot_add(input.beside::<_, u64, W>(factors), sum);
        next = rest_of_crc ^ input.vector::<_, u64, W>();
        while input.has(n) {
            not_unrolled();
            sum = next.carryless_dot_add(input.beside::<_, u64, W>(factors), sum);
            next = input.vector();
        }
    }
    reduce(sum, next)
}

/// There is at least a vector.
#[simd]
fn by_vectors<const CHAINS: usize, W: Width>(crc: u32, input: &mut Input<impl Copies>) -> u32 {
    let n = W::BYTES;
    let (mut sum, mut next) = (V::<W, S>::zero(), in_front::<W, S>(crc as u64));
    let long = input.len() >= 2 * CHAINS * n;
    let part = input.len() % n;
    if part != 0 {
        let padded;
        (padded, next) = first_part(crc, input, part);
        if long {
            next = fold!(W::BYTES, padded, next);
        } else {
            sum = padded.carryless_dot_add(factors(input.len() + n).vector::<_, u64, W>(), sum);
        }
    }
    next ^= input.vector::<_, u64, W>();
    if long {
        let mut chains = [next; CHAINS];
        input.part(
            (CHAINS - 1) * n,
            #[inline(always)]
            |input| {
                for chain in &mut chains[1..] {
                    *chain = input.vector();
                }
            },
        );
        fold_strides(&mut chains, input);
        let mut factors = factors(input.len() + CHAINS * n);
        for &chain in &chains[..CHAINS - 1] {
            sum = chain.carryless_dot_add(factors.vector::<_, u64, W>(), sum);
        }
        next = chains[CHAINS - 1];
    }
    let mut factors = factors(input.len() + n);
    while input.has(n) {
        sum = next.carryless_dot_add(factors.vector::<_, u64, W>(), sum);
        // Not unrolled. With `not_unrolled`, a check would stay in the loop.
        next = input.vector();
        next = next.black_box();
    }
    reduce(sum, next)
}

/// For each length, what moves the bytes in `Input::quarters()` to the end.
#[cfg(target_arch = "x86_64")]
static QUARTERS: Aligned<[[u8; 16]; 16]> = {
    let (mut orders, mut len) = ([[0x80; 16]; 16], 4);
    while len < 16 {
        let second = if len < 8 { len - 4 } else { 4 };
        let (starts, mut i) = ([0, second, len - 4 - second, len - 4], 0);
        while i < 16 {
            orders[len][16 - len + starts[i / 4] + i % 4] = i as u8;
            i += 1;
        }
        len += 1;
    }
    Aligned(orders)
};

/// 4 to 15 bytes.
#[simd]
#[only(sse4 + aes)]
fn of_few<C: Copies>(crc: u32, input: &mut Input<C>) -> u32 {
    let (len, crc) = (input.len(), in_front::<B16, S>(crc as u64));
    if const { !C::COPIES && !has!(masked) } {
        let order = u8x16::from(QUARTERS.0[len % 16]);
        let all = u32x4::from(input.quarters()).bitcast::<u64>();
        let at_end = all.in_blocks().lookup_bytes_relaxed(order);
        return reduce(u64x2::zero(), at_end ^ shift(crc, len));
    }
    if !C::COPIES {
        let all: u8x16<S> = input.few(len);
        return reduce(u64x2::zero(), shift(all.bitcast() ^ crc, len));
    }
    // Two words that overlap.
    let at_end = if len >= 8 {
        let first: u64x1<S> = input.start_of_vector(len - 8);
        let last: u64x1<S> = input.vector();
        shift(first.resize(), len).alternate(last.resize().splat_lane::<0>())
    } else if len >= 4 {
        let first: u32x1<S> = input.start_of_vector(len - 4);
        let last: u32x1<S> = input.vector();
        let first = shift(first.resize::<B16>().bitcast(), len).bitcast::<u32>();
        first.with_lane::<3>(last[0]).bitcast()
    } else {
        u64x2::zero()
    };
    reduce(u64x2::zero(), at_end ^ shift(crc, len))
}

#[simd]
const HAS_INSTRUCTIONS: bool = has!(aes | crc);

/// What is shorter needs no vectors, if there is an instruction.
pub(super) const BY_INSTRUCTION: usize = if cfg!(target_os = "macos") { 128 } else { 256 };

#[only(neon + aes)]
fn by_vectors_and_instruction(mut crc: u32, input: &mut Input<impl Copies>) -> u32 {
    let len = input.len();
    if has!("sha3") && len >= BY_INSTRUCTION {
        return by_vectors::<8, B16, S>(crc, input);
    }
    if len >= 384 {
        // What the loop leaves is faster by the instruction.
        crc = input.part(
            len - (len - 128) % 256,
            #[inline(always)]
            |folded| by_vectors::<8, B16, S>(crc, folded),
        );
    }
    by_instruction(crc, input)
}

#[only(sse4 + aes)]
fn without_strides(crc: u32, input: &mut Input<impl Copies>) -> u32 {
    let len = input.len();
    if len < 16 {
        of_few(crc, input)
    } else if const { has!(vaes) } && len >= 64 {
        by_few_vectors::<Native<S>, S>(crc, input)
    } else {
        by_few_vectors::<B16, S>(crc, input)
    }
}

#[simd]
fn state_after(crc: u32, input: &mut Input<impl Copies>) -> u32 {
    pick! {
        sse4 + aes => without_strides(crc, input),
        aes => by_vectors_and_instruction(crc, input),
        _ => by_four_instructions(crc, input),
    }
}

#[simd]
fn state_after_long(crc: u32, input: &mut Input<impl Copies>) -> u32 {
    assert!(!has!(sse4 + aes) || input.len() >= S::LONG);
    pick! {
        vaes => by_vectors::<4, Native<S>, S>(crc, input),
        sse4 + aes => by_vectors::<6, B16, S>(crc, input),
        _ => state_after(crc, input),
    }
}

/// From here on there are strides to fold. What is shorter saves no registers if that is a function of its own.
#[simd]
const LONG: usize = if has!(vaes) {
    8 * Native::<S>::BYTES
} else {
    192
};

#[simd]
#[inline(never)]
fn update_long(crc: u32, bytes: &[u8]) -> u32 {
    !state_after_long(!crc, &mut Input::new(bytes))
}

#[simd]
#[inline(never)]
fn copy_and_update_long(crc: u32, bytes: Source<'_>, copy: BorrowedCursor<'_, u8>) -> u32 {
    copying(
        bytes,
        copy,
        #[inline(always)]
        |input| !state_after_long(!crc, input),
    )
}

/// At least 4 bytes on x64.
#[kernel]
pub(crate) fn update(crc: u32, bytes: &[u8]) -> u32 {
    if const { !S::HAS_INSTRUCTIONS } {
        return !crc32_without_kernel(!crc, bytes);
    }
    if X86 && bytes.len() >= S::LONG {
        return update_long(crc, bytes);
    }
    if X86 {
        assert!(bytes.len() >= 4);
        return !state_after(!crc, &mut Input::counting(bytes));
    }
    !state_after(!crc, &mut Input::new(bytes))
}

/// Appends `bytes` to `copy`, and returns what [`update`] would for the appended bytes.
#[kernel]
pub(crate) fn copy_and_update(crc: u32, bytes: Source<'_>, copy: BorrowedCursor<'_, u8>) -> u32 {
    if const { X86 && S::HAS_INSTRUCTIONS }
        && (bytes.len() >= S::LONG || bytes.len() > copy.capacity())
    {
        return copy_and_update_long(crc, bytes, copy);
    }
    copying(
        bytes,
        copy,
        #[inline(always)]
        |input| {
            if const { !S::HAS_INSTRUCTIONS } {
                return !crc32_without_kernel(!crc, input.copy_all());
            }
            !state_after(!crc, input)
        },
    )
}
