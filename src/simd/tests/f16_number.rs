//! The traits of the number f16, without that of the nightly compiler.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::f16;

#[test]
fn traits() {
    let (a, b) = (f16::from_f32(7.5), f16::from_f32(2.0));
    assert_eq!([a + b, a - b, a * b, a / b, a % b, -a].map(f32::from), [9.5, 5.5, 15.0, 3.75, 1.5, -7.5]);
    assert_eq!((f64::from(a), a > b, a.partial_cmp(&f16::NAN)), (7.5, true, None));
    assert_eq!(format!("{a} {b:?} {a:e} {b:E} {a:6.2}"), "7.5 2.0 7.5e0 2E0   7.50");
}
