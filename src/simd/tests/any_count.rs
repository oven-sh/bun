//! Shifts take any integer as a count.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]

#[bun_simd::simd]
mod k {
    use bun_simd::prelude::*;

    macro_rules! same {
        ($v:expr, $low:expr, $by:expr, $wrapped:expr, $saturated:expr) => {{
            let (v, low, by, n, most): (_, _, _, u32, u32) = ($v, $low, $by, $wrapped, $saturated);
            let (mut left, mut right) = (v, v);
            left <<= by;
            right >>= by;
            assert_eq!([v << by, v >> by, left, right], [v << n, v >> n, v << n, v >> n]);
            assert_eq!(
                [v.rotate_left(by), v.rotate_right(by), v.rounding_shr(by)],
                [v.rotate_left(n), v.rotate_right(n), v.rounding_shr(n)]
            );
            assert_eq!([v.unbounded_shl(by), v.unbounded_shr(by)], [v.unbounded_shl(most), v.unbounded_shr(most)]);
            let (v, low) = (v.cast_unsigned(), low.cast_unsigned());
            assert_eq!([v.funnel_shl(low, by), v.funnel_shr(low, by)], [v.funnel_shl(low, n), v.funnel_shr(low, n)]);
        }};
    }
    macro_rules! counts { ($v:expr, $low:expr, $by:expr, $($t:ident)*) => {$(
        let by = $by as $t;
        same!($v, $low, by, by as u32 % 64, if (0..64).contains(&by) { by as u32 } else { 64 });
    )*}; }

    #[kernel]
    pub fn run<T: Int>(a: i64, b: i64, by: i128) {
        let (v, low) = (SimdN::<T, S>::iota(T::from_i64(a)), SimdN::<T, S>::splat(T::from_i64(b)));
        counts!(v, low, by, u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize);
        let lane = T::from_i64(by as i64);
        assert_eq!([v << lane, v >> lane], [v << Simd::splat(lane), v >> Simd::splat(lane)]);
        assert_eq!(v.unbounded_shl(lane), v.unbounded_shl(Simd::splat(lane)));
    }
    macro_rules! known { ($v:expr, $low:expr, $zero:expr, $($by:expr => $n:literal $most:literal)*) => {$(
        same!($v, $low, $by, $n + $zero, $most + $zero);
    )*}; }
    #[kernel]
    pub fn constants<T: Int>(a: i64, b: i64, zero: u32) {
        let (v, low) = (SimdN::<T, S>::iota(T::from_i64(a)), SimdN::<T, S>::splat(T::from_i64(b)));
        known!(v, low, zero, -1 => 63 64 -8i8 => 56 64 i8::MIN => 0 64 256u16 => 0 64 7u8 => 7 7 (1u64 << 32) + 5 => 5 64);
        known!(v, low, zero, i64::MIN => 0 64 (1u128 << 64) + 3 => 3 64 i128::MIN + 7 => 7 64 -5isize => 59 64 33usize => 33 33);
    }
    #[kernel]
    pub fn inferred() -> u8 {
        let v = u8x4::splat(1);
        let mut sum = (v << 1).reverse() + (v << [0, 1, 2, 3]).reverse() + (v << i8x4::splat(2).bitcast()).reverse();
        unroll!(for i in 0..2 {
            sum += v << i
        });
        for i in 0..2 {
            sum += (v << i).rotate_left(1);
        }
        sum[0]
    }
}

#[test]
fn any_integer() {
    let far = [255, 256, 1 << 16, 1 << 31, 1 << 32, (1 << 32) + 3, 1 << 63, (1 << 64) + 5, i128::MAX, i128::MIN];
    for by in (-70..70).chain(far).chain(far.map(|n| !n)) {
        let (a, b) = (0x8123_4567_89ab_cdef_u64 as i64, 0x7ed_cba9_8765_4321);
        k::run::<u8>(a, b, by);
        k::run::<i8>(a, b, by);
        k::run::<u16>(a, b, by);
        k::run::<i16>(a, b, by);
        k::run::<u32>(a, b, by);
        k::run::<i32>(a, b, by);
        k::run::<u64>(a, b, by);
        k::run::<i64>(a, b, by);
    }
    let (a, b, zero) = std::hint::black_box((0x8123_4567_89ab_cdef_u64 as i64, 0x7ed_cba9_8765_4321, 0));
    for run in [k::constants::<u8>, k::constants::<i8>, k::constants::<u16>, k::constants::<i16>] {
        run(a, b, zero)
    }
    for run in [k::constants::<u32>, k::constants::<i32>, k::constants::<u64>, k::constants::<i64>] {
        run(a, b, zero)
    }
    assert_eq!(k::inferred(), 2 + 8 + 4 + 3 + 6);
}
