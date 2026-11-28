#![cfg_attr(bun_simd_unoptimized, allow(unreachable_code, unused))]
//! Lanes from places that are constants. LLVM makes one shuffle of a chain of insertions into a register, if they are from that and one more of its type.
use super::{Pod, bits::start, part, set_part};

/// Where each lane of the result is in the operands.
pub trait Places {
    const FROM: [u16; 256];
}
struct Steps {
    sources: [[u8; 4]; 32],
    most: u8,
    /// A bit for each register of the result that is one of the operands.
    same: u32,
    /// In the two registers of a step. The first has what is there so far.
    index: [[u8; 320]; 3],
}
const fn steps(from: &[u16; 256], per: usize, lanes: usize) -> Steps {
    let (mut it, mut count, mut i) =
        (Steps { sources: [[0; 4]; 32], most: 0, same: !0, index: [[0; 320]; 3] }, [0u8; 32], 0);
    let (parts, shift, mut step) = (lanes.div_ceil(per), per.trailing_zeros(), [0u8; 320]);
    while i < lanes && parts <= 32 {
        let (at, source, mut k) = (i >> shift, (from[i] >> shift) as u8, 0);
        while k < count[at] && k < 4 && it.sources[at][k as usize] != source {
            k += 1;
        }
        if k == count[at] || k == 4 {
            if k < 4 {
                it.sources[at][k as usize] = source;
            }
            count[at] = k + 1;
            if k >= it.most {
                it.most = k + 1;
            }
        }
        step[i] = k;
        if k > 0 || (from[i] as usize ^ i) & (per - 1) != 0 {
            it.same &= !(1 << at);
        }
        it.index[0][i] =
            if k < 2 { k * per as u8 + (from[i] as usize & (per - 1)) as u8 } else { (i & (per - 1)) as u8 };
        i += 1;
    }
    while i < parts * per && parts <= 32 {
        it.index[0][i] = (i & (per - 1)) as u8;
        i += 1;
    }
    i = 0;
    while i < parts * per && it.most > 2 && it.most <= 4 {
        let own = (i & (per - 1)) as u8;
        (it.index[1][i], it.index[2][i]) = (own, own);
        if step[i] > 1 {
            it.index[step[i] as usize - 1][i] = per as u8 + (from[i] as usize & (per - 1)) as u8
        }
        i += 1;
    }
    it
}
struct Plan<B, U, R, P>(B, U, R, P);
impl<B, U, R, P: Places> Plan<B, U, R, P> {
    const STEPS: &Steps = &steps(&P::FROM, size_of::<U>() / size_of::<B>(), size_of::<R>() / size_of::<B>());
}
macro_rules! each { ($i:ident < $n:expr => $body:expr; $($from:literal [$($k:literal)*])*) => { $(if const { $n > $from } { $({ let $i: usize = $k; $body; })* })* }; }
#[inline(always)]
fn mix<B: Pod, U: Pod>(a: U, b: U, index: &[u8; 320], first: usize) -> U {
    let (both, mut v, per) = ([a, b], a, size_of::<U>() / size_of::<B>());
    each!(i < size_of::<U>() / size_of::<B>() => set_part::<U, B>(&mut v, i, part(&both, index[first + i] as usize % (2 * per)));
        0 [0] 1 [1] 2 [2 3] 4 [4 5 6 7] 8 [8 9 10 11 12 13 14 15] 16 [16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31]
        32 [32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63]);
    v
}
#[inline(always)]
fn one<B: Pod, U: Pod, A: Pod, R: Pod, P: Places>(from: &A, at: usize) -> U {
    let (steps, index, first) =
        (Plan::<B, U, R, P>::STEPS, &Plan::<B, U, R, P>::STEPS.index, at * (size_of::<U>() / size_of::<B>()));
    let source = |k: usize| part::<A, U>(from, steps.sources[at][k] as usize % (size_of::<A>() / size_of::<U>()));
    if steps.same >> at & 1 != 0 {
        return source(0);
    }
    let mut v = mix::<B, U>(source(0), source(1), &index[0], first);
    if const { Plan::<B, U, R, P>::STEPS.most > 2 } {
        v = mix::<B, U>(v, source(2), &index[1], first);
    }
    if const { Plan::<B, U, R, P>::STEPS.most > 3 } {
        v = mix::<B, U>(v, source(3), &index[2], first);
    }
    v
}
#[inline(always)]
fn several<B: Pod, U: Pod, A: Pod, R: Pod, P: Places>(from: &A, mut into: R) -> R {
    let count = size_of::<R>() / size_of::<U>();
    macro_rules! parts { ($($from:literal [$($k:literal)*])*) => { $(if const { size_of::<R>() / size_of::<U>() > $from } {
        $(if $k < count { set_part(&mut into, $k, one::<B, U, A, R, P>(from, $k)); })*
    })* }; }
    parts!(0 [0 1] 2 [2] 3 [3] 4 [4 5 6 7] 8 [8 9 10 11 12 13 14 15] 16 [16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31]);
    into
}
#[inline(always)]
fn single<B: Pod, U: Pod, A: Pod, R: Pod, P: Places>(from: &A, _: R) -> R {
    start(one::<B, U, A, R, P>(from, 0))
}
#[cfg_attr(not(bun_simd_unoptimized), inline(always))]
pub(super) fn slowly<B: Pod, A: Pod, R: Pod, P: Places>(from: &A, mut into: R) -> R {
    let (mut i, at) = (0, const { &P::FROM });
    while i < const { size_of::<R>() / size_of::<B>() } {
        set_part::<R, B>(&mut into, i, part(from, at[i] as usize));
        i += 1;
    }
    into
}
/// Whether the result is one of the parts of its size.
#[cfg(bun_simd_unoptimized)]
pub(super) const fn whole<B, R, P: Places>() -> bool {
    let (lanes, mut i) = (size_of::<R>() / size_of::<B>(), 0);
    while i < lanes && P::FROM[i] as usize == P::FROM[0] as usize + i {
        i += 1;
    }
    i == lanes && P::FROM[0] as usize % lanes == 0
}
/// The lanes are `B`, and the operands are registers of the type `U`. `into` is overwritten.
#[inline(always)]
pub fn moved<B: Pod, U: Pod, A: Pod, R: Pod, P: Places>(from: &A, into: R) -> R {
    #[cfg(bun_simd_unoptimized)]
    return slowly::<B, A, R, P>(from, into);
    chosen!(fn(&A, R) -> R: Plan::<B, U, R, P>::STEPS.most > 4 => slowly::<B, A, R, P>, size_of::<R>() <= size_of::<U>() => single::<B, U, A, R, P>, _ => several::<B, U, A, R, P>)(
        from, into,
    )
}
