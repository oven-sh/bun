//! Ranges that go around, which no caller has where lanes share general registers.

use crate::{B16, Baseline, Simd};

#[test]
fn around() {
    for (first, last) in [(250u8, 3u8), (4, 3), (3, 3), (3, 250), (0, 255), (255, 0), (130, 120)] {
        for from in (0..=255).step_by(16) {
            let v = Simd::<u8, B16, Baseline>::iota(from);
            let inside = v.in_range(first, last);
            assert!((0..16).all(|i| inside.test(i) == (v[i].wrapping_sub(first) <= last.wrapping_sub(first))));
        }
    }
}
