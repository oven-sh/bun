//! Constants and lengths that depend on the target.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code, nonstandard_style, unused)]
use bun_simd::{prelude::*, target::Target};

bun_simd::targets!(icelake, icelake + narrow, avx512, avx512 + narrow, avx2 + aes, avx2, sse4, sse2, neon82, neon);

mod other {
    use bun_simd::prelude::*;
    #[simd]
    pub(crate) const IS_NEON: bool = has!(neon);
    targets!(super);
    #[kernel]
    pub fn by_macro() {}
    #[kernel(crate::other)]
    pub fn by_path() {}
}
use other::IS_NEON;
#[simd]
const N: usize = u8xN::LANES;
#[simd]
const BY_WORD: usize = pick! { narrow => 7, icelake => 6, avx512 => 5, avx2 => 4, sse4 => 3, neon => 2, _ => 1 };
#[simd]
type Wide = Pick![S: avx512 => u32x16<S>, _ => u32x8<S>];
#[simd]
struct State {
    sums: [u32; Wide::<S>::LANES],
    rows: [[u8; S::BY_WORD]; 2],
}
#[simd(by_level)]
impl State<S> {
    fn new() -> Self {
        State { sums: [1; _], rows: [[2; _]; 2] }
    }
    fn total(&self) -> usize {
        Wide::load(&self.sums).reduce_sum() as usize + 100 * self.rows[1].len()
    }
}
#[simd]
fn two(from: &[u8; 2 * S::N]) -> [u8; S::N] {
    (u8xN::load(from) + u8xN::load_last(from)).to_array()
}
#[simd]
fn constant<const K: usize>() -> usize {
    K
}
#[kernel]
fn all(text: &[u8]) -> (Target, [usize; 6]) {
    #[simd]
    const HALF: usize = S::N / 2;
    macro_rules! times {
        ($k:literal) => {
            constant::<{ $k * S::HALF }, S>()
        };
    }
    let sum = text.as_chunks::<{ 2 * S::N }>().0.iter().map(|it| two(it)[S::N - 1] as usize).sum();
    let short = [0u8; S::BY_WORD];
    #[allow(clippy::out_of_bounds_indexing)]
    let last = if S::BY_WORD > 3 { short[3] as usize + 3 } else { 0 };
    (S::TARGET, [sum, short.len(), last, times!(3), State::new().total(), vec![0; S::N].len() + S::IS_NEON as usize])
}
#[kernel]
fn facts() -> [usize; 4] {
    [S::N, S::BY_WORD, Wide::LANES, has!(neon) as usize]
}

#[test]
fn on_each_target() {
    assert!(all::targets().eq(other::by_macro::targets()) && all::targets().eq(other::by_path::targets()));
    let _ = (other::by_macro(), other::by_path(), all(&[]), facts());
    let text: Vec<u8> = (0..300).map(|i| (i / 3) as u8).collect();
    for target in all::targets() {
        let [n, word, wide, neon] = facts::to(target).unwrap();
        let sum = text.chunks_exact(2 * n).map(|it| (it[n - 1] + it[2 * n - 1]) as usize).sum();
        let last = if word > 3 { 3 } else { 0 };
        assert_eq!(all::to(target, &text), Some((target, [sum, word, last, 3 * n / 2, wide + 100 * word, n + neon])));
    }
}
