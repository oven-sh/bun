//! src/simd/soft.rs against std.
#![allow(dead_code, unreachable_pub)]
#[path = "../soft.rs"]
mod soft;

fn numbers(mut state: u64) -> impl Iterator<Item = u64> {
    std::iter::repeat_with(move || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let x = (state ^ state >> 29).wrapping_mul(0xbf58476d1ce4e5b9);
        x ^ x >> 32
    })
}
macro_rules! against { ($($t:ident $u:ident $fraction:literal)*) => {$(
    #[test]
    fn $t() {
        let same = |a: $t, b: $t| a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan();
        let mut all = numbers(7);
        let special = [0.0, -0.0, 0.5, -0.5, 1.5, 2.5, 1.0, $t::INFINITY, $t::NEG_INFINITY, $t::NAN, $t::MAX, $t::MIN_POSITIVE, $t::from_bits(1)];
        for _ in 0..if cfg!(miri) { 300 } else { 3_000_000 } {
            let mut one = || {
                let (bits, how) = (all.next().unwrap() as $u, all.next().unwrap());
                match how % 8 {
                    0 => special[how as usize / 8 % special.len()],
                    1 => (bits as i16) as $t / 4.0,
                    2 => $t::from_bits(bits & !0 << (how / 8 % $fraction)),
                    3 => $t::from_bits(bits & !0 >> (how / 8 % $u::BITS as u64)),
                    4 | 5 => $t::from_bits(bits & !(!0 << $fraction) | (1.0 as $t).to_bits()) * (how as i8) as $t,
                    _ => $t::from_bits(bits),
                }
            };
            let (a, b, c) = (one(), one(), one());
            use soft::$t::*;
            assert!(same(trunc(a), a.trunc()) && same(floor(a), a.floor()) && same(ceil(a), a.ceil()), "{a:e}");
            assert!(same(round(a), a.round()) && same(round_ties_even(a), a.round_ties_even()) && same(sqrt(a), a.sqrt()), "{a:e}");
            for c in [c, -(a * b), (a * b).next_up(), -(a * b).next_down(), c * a * b] {
                // C libraries differ here.
                let want = if c == 0.0 && a != 0.0 && b != 0.0 { a * b } else { a.mul_add(b, c) };
                assert!(same(mul_add(a, b, c), want) || !cfg!(any(target_os = "linux", target_vendor = "apple", target_arch = "aarch64")), "{a:e} {b:e} {c:e}");
            }
        }
    }
)*}; }
against!(f32 u32 23 f64 u64 52);
