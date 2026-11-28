//! Shuffles whose indices are known at compile time.

use crate::simd::Swizzle;

#[rules]
macro_rules! ops { ($($name:ident)*) => { $(pub const $name: u8 = ${index()};)* }; }

ops! {
    INTERLEAVE_LOWER INTERLEAVE_UPPER INTERLEAVE_WHOLE_LOWER INTERLEAVE_WHOLE_UPPER
    INTERLEAVE_EVEN INTERLEAVE_ODD INTERLEAVE_EVEN_BLOCKS INTERLEAVE_ODD_BLOCKS
    STRIDE STRIDE_IN_BLOCK ODD_EVEN ODD_EVEN_BLOCKS DUP_EVEN DUP_ODD
    BROADCAST BROADCAST_LANE BROADCAST_BLOCK REVERSE REVERSE_GROUPS REVERSE_BLOCKS SWAP_BLOCKS SHUFFLE4
    ALIGN_RIGHT SHIFT_LEFT SLIDE_DOWN SLIDE_UP PREPEND PART JOIN FIRST_OF_GROUP RESIZE REPEAT SELECT_BLOCK
    LOWER_LOWER UPPER_UPPER LOWER_UPPER UPPER_LOWER GROUP4_IN_BLOCK TRANSPOSE_BLOCKS
    BROADCAST_LAST LAST_OF_BLOCK_BEFORE
    ZIP_BLOCKS EVEN_ODD_IN_BLOCK SLIDE_DOWN_BYTES PICK3 SORT3 UNSORT3 PICK3_WHOLE SORT3_WHOLE UNSORT3_WHOLE QUARTERS
    SLIDE_DOWN_BLOCKS SLIDE_UP_BLOCKS ZIP_UPPER_BLOCKS
}

pub const fn moves_blocks(op: u8) -> bool {
    matches!(
        op,
        ZIP_BLOCKS
            | INTERLEAVE_EVEN_BLOCKS
            | INTERLEAVE_ODD_BLOCKS
            | ODD_EVEN_BLOCKS
            | REVERSE_BLOCKS
            | SWAP_BLOCKS
            | BROADCAST_BLOCK
            | SELECT_BLOCK
    )
}

/// For `shuffled` in on_x86.rs.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
pub const fn reorders(op: u8, k: usize, lane: usize) -> bool {
    let (n, mut i, mut seen) = (64 / lane, 0, 0u128);
    while i < n {
        seen |= 1 << wrapped(op, k, i, n, n, lane);
        i += 1;
    }
    seen == (1 << n) - 1
}
/// For `shuffled` in on_x86.rs, too.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
pub const fn moves_words(op: u8, k: usize, lane: usize) -> bool {
    let (n, per, mut i, mut crosses) = (64 / lane, 8 / lane, 0, false);
    while i < n {
        let (at, first) = (wrapped(op, k, i, n, n, lane), wrapped(op, k, i / per * per, n, n, lane));
        if at != first / per * per + i % per {
            return false;
        }
        crosses |= at % n / (2 * per) != i / (2 * per);
        i += 1;
    }
    crosses
}
/// For `shuffled` and `to_shuffle` in on_x86.rs.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
pub const fn spreads(op: u8, k: usize, lane: usize) -> bool {
    let (n, mut i, mut seen, mut crosses) = (64 / lane, 0, 0u128, false);
    while i < n {
        let at = wrapped(op, k, i, n, n, lane) % n;
        (seen, crosses) = (seen | 1 << at, crosses | (at * lane / 16 != i * lane / 16));
        i += 1;
    }
    crosses && seen != (1 << n) - 1 && !moves_words(op, k, lane)
}

/// Whether each 64 bytes of the result depend only on the same 64 bytes of the operands, in the same way.
pub const fn stays(op: u8) -> bool {
    matches!(
        op,
        INTERLEAVE_LOWER
            | INTERLEAVE_UPPER
            | INTERLEAVE_EVEN
            | INTERLEAVE_ODD
            | INTERLEAVE_EVEN_BLOCKS
            | INTERLEAVE_ODD_BLOCKS
            | STRIDE_IN_BLOCK
            | ODD_EVEN
            | ODD_EVEN_BLOCKS
            | DUP_EVEN
            | DUP_ODD
            | BROADCAST
            | REVERSE_GROUPS
            | SWAP_BLOCKS
            | SHUFFLE4
            | ALIGN_RIGHT
            | SHIFT_LEFT
            | EVEN_ODD_IN_BLOCK
    )
}

/// Where the lanes `from..to` of the `m` lanes of the result come from. `0..n` is the first operand, and `n..2 * n` the second.
/// Branches that are dead for a width are evaluated too, so an index that is out of range can't be an error here. The callers check their arguments.
/// The loop is in here as each crate evaluates this for each shuffle, and a call takes long.
const fn sources<const Q: usize>(
    op: u8,
    k: usize,
    from: usize,
    to: usize,
    n: usize,
    m: usize,
    lane: usize,
) -> [usize; Q] {
    // The number of lanes in 16 bytes.
    let block = if 16 / lane < n { 16 / lane } else { n };
    let (op, k, block) = match op {
        ZIP_UPPER_BLOCKS => (ZIP_BLOCKS, n / block / 2, block),
        SLIDE_DOWN_BLOCKS => (SLIDE_DOWN, k * block, block),
        SLIDE_UP_BLOCKS => (SLIDE_UP, k * block, block),
        PICK3_WHOLE => (PICK3, k, n),
        SORT3_WHOLE => (SORT3, k, n),
        UNSORT3_WHOLE => (UNSORT3, k, n),
        _ => (op, k, block),
    };
    let (mut all, mut i, blocks, both) = ([0; Q], from, n / block, 2 * n);
    while i < to {
        all[i - from] = if op == PART {
            k * m + i
        } else {
            let (j, b, second_if_odd) = (i % block, i / block, (i & 1) * n);
            let start = i - j;
            match op {
                INTERLEAVE_LOWER => start + j / 2 + (j & 1) * n,
                INTERLEAVE_UPPER => start + (block + j) / 2 + (block + j) % 2 * n,
                INTERLEAVE_WHOLE_LOWER => i / 2 + second_if_odd,
                INTERLEAVE_WHOLE_UPPER => (n + i) / 2 + (n + i) % 2 * n,
                INTERLEAVE_EVEN => (i & !1) + second_if_odd,
                INTERLEAVE_ODD => (i | 1) + second_if_odd,
                INTERLEAVE_EVEN_BLOCKS => (b & !1) * block + j + (b & 1) * n,
                INTERLEAVE_ODD_BLOCKS => (b | 1) % blocks * block + j + (b & 1) * n,
                ZIP_BLOCKS => (k + b / 2) * block + j + (b & 1) * n,
                STRIDE => 2 * i + k,
                EVEN_ODD_IN_BLOCK => start + 2 * j % block + 2 * j / block,
                STRIDE_IN_BLOCK => start + (2 * j + k) % block + (2 * j + k) / block * n,
                ODD_EVEN => i + n - second_if_odd,
                ODD_EVEN_BLOCKS => i + n - (b & 1) * n,
                DUP_EVEN => i & !1,
                DUP_ODD => (i | 1) % n,
                BROADCAST => start + k,
                BROADCAST_LANE => k,
                BROADCAST_BLOCK => k * block + j,
                BROADCAST_LAST => n - 1,
                // Three blocks in a row have the lanes 3 * i + k at different places within a block: they can be blended.
                // The second where block `k / 3` has a lane of the group `k % 3`.
                PICK3 => {
                    if (k / 3 * block + j) % 3 == k % 3 {
                        n + i
                    } else {
                        i
                    }
                }
                // The lanes 4 * i + k and 4 * i + k + 1 of both. In 32 bytes those of one operand are adjacent, and else those of one kind.
                QUARTERS => {
                    let (part, at) = (4 * i / n, 4 * i % n + k);
                    if blocks == 2 { part / 2 * n + at + part % 2 } else { part % 2 * n + at + part / 2 }
                }
                SORT3 => start + (3 * j + k) % block,
                UNSORT3 => {
                    start
                        + (j + block * ((j + block) % 3 == k) as usize
                            + 2 * block * ((j + 2 * block) % 3 == k) as usize)
                            / 3
                }
                // From `k` blocks before, or else from the second.
                LAST_OF_BLOCK_BEFORE => {
                    if b >= k {
                        (b - k) * block + block - 1
                    } else {
                        n + i
                    }
                }
                REVERSE => n - 1 - i,
                REVERSE_GROUPS => i ^ (k - 1),
                REVERSE_BLOCKS => (blocks - 1 - b) * block + j,
                SWAP_BLOCKS => (b ^ 1) % blocks * block + j,
                SHUFFLE4 => (i & !3) + (k >> (2 * (i & 3)) & 3),
                ALIGN_RIGHT => {
                    if j + k < block {
                        i + k
                    } else {
                        n + i + k - block
                    }
                }
                SHIFT_LEFT => {
                    if j >= k {
                        i - k
                    } else {
                        (n + i + block).wrapping_sub(k)
                    }
                }
                SLIDE_DOWN => i + k,
                SLIDE_DOWN_BYTES => i + k * block / 16,
                SLIDE_UP => {
                    if i >= k {
                        i - k
                    } else {
                        (2 * n + i).wrapping_sub(k)
                    }
                }
                PREPEND => {
                    if i >= k {
                        i - k
                    } else {
                        n + i
                    }
                }
                JOIN => i / k / 2 * k + i % k + ((i / k) & 1) * n,
                FIRST_OF_GROUP => i - i % k,
                RESIZE => {
                    if i < n {
                        i
                    } else {
                        n
                    }
                }
                REPEAT => i % n,
                SELECT_BLOCK => {
                    if b == k {
                        n + i
                    } else {
                        i
                    }
                }
                LOWER_LOWER => {
                    if i < n / 2 {
                        i
                    } else {
                        n + i - n / 2
                    }
                }
                UPPER_UPPER => {
                    if i < n / 2 {
                        n / 2 + i
                    } else {
                        n + i
                    }
                }
                LOWER_UPPER => n / 2 + i,
                UPPER_LOWER => {
                    if i < n / 2 {
                        i
                    } else {
                        n + i
                    }
                }
                GROUP4_IN_BLOCK => start + 4 * j % block + 4 * j / block,
                TRANSPOSE_BLOCKS => i % blocks * block + i / blocks,
                _ => panic!(),
            }
        } % both;
        i += 1;
    }
    all
}

/// From operands of `N` lanes in registers of `P` lanes to a result of `M` lanes. If `JOINED`, the lanes of the second
/// operand follow those of the first one in the same register. 16 bytes have `BLOCK` lanes.
pub struct Pattern<
    const OP: u8,
    const K: usize,
    const N: usize,
    const P: usize,
    const M: usize,
    const BLOCK: usize,
    const JOINED: bool = false,
>;

/// For one lane.
pub const fn wrapped(op: u8, k: usize, i: usize, n: usize, m: usize, lane: usize) -> usize {
    sources::<1>(op, k, i, i + 1, n, m, lane)[0]
}

impl<
    const OP: u8,
    const K: usize,
    const N: usize,
    const P: usize,
    const M: usize,
    const BLOCK: usize,
    const JOINED: bool,
> Pattern<OP, K, N, P, M, BLOCK, JOINED>
{
    const fn exact(i: usize) -> usize {
        let at = wrapped(OP, K, i, N, M, 16 / BLOCK);
        if at < N || JOINED { at } else { at - N + P }
    }
    /// Whether the same operation on whole registers, with a result of `q` lanes, starts with the right lanes.
    const fn as_for_registers(q: usize) -> bool {
        let mut i = 0;
        while i < M && Self::exact(i) == wrapped(OP, K, i, P, q, 16 / BLOCK) {
            i += 1;
        }
        i == M
    }
    /// Whether it takes fewer instructions to join the operands first.
    pub const JOIN: bool = N < P && M == N && {
        let (mut i, mut first, mut second) = (0, false, false);
        while i < M {
            if Self::exact(i) < P {
                first = true
            } else {
                second = true
            }
            i += 1;
        }
        first && second && !Self::as_for_registers(P)
    };
}

impl<
    const OP: u8,
    const K: usize,
    const N: usize,
    const P: usize,
    const M: usize,
    const BLOCK: usize,
    const JOINED: bool,
    const Q: usize,
> Swizzle<Q> for Pattern<OP, K, N, P, M, BLOCK, JOINED>
{
    const END: usize = if M < Q && OP != RESIZE { M } else { Q };
    const INDEX: [usize; Q] = {
        let mut index = sources(OP, K, 0, if M < Q { M } else { Q }, N, M, 16 / BLOCK);
        let mut i = if N == P || JOINED { M } else { 0 };
        let whole = M < Q && !(OP == RESIZE && M > N) && !JOINED && OP != PART && Self::as_for_registers(Q);
        while i < Q {
            // The lanes from `M` on are unspecified. These choices make the shuffle one that has an instruction.
            index[i] = if i < M {
                if index[i] < N { index[i] } else { index[i] - N + P }
            } else if OP == RESIZE && M > N {
                P
            } else if whole {
                wrapped(OP, K, i, P, Q, 16 / BLOCK)
            } else {
                let (at, step) = (
                    index[i % M],
                    if OP == STRIDE {
                        2 * M
                    } else if M > N {
                        N
                    } else {
                        M
                    },
                );
                at / P * P + (at + i / M * step) % P
            };
            i += 1;
        }
        // The second operand is zero. Taken from the same lane, it is a blend.
        i = if OP == RESIZE { 0 } else { Q };
        while i < Q {
            if index[i] >= P {
                index[i] = P + i % P
            }
            i += 1;
        }
        index
    };
}

/// Whether NEON has an instruction other than `tbl` for this order of four lanes, as for `SHUFFLE4`.
#[inline(always)]
pub(crate) const fn is_short(order: usize) -> bool {
    let moved = order ^ 0b11_10_01_00;
    ((moved | moved >> 1) & 0x55).count_ones() <= 1
        || matches!(
            order,
            0 | 0x55 | 0xaa | 0xff | 0xb1 | 0x39 | 0x4e | 0x93 | 0x50 | 0xfa | 0x88 | 0xdd | 0xa0 | 0xf5 | 0x44 | 0xee
        )
}
