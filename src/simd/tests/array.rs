#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]

#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;

    #[kernel]
    pub fn columns(rows: &[[u32; 4]; 5], order: &mut Vec<usize>) -> [u32; 5] {
        let vectors: [u32x4<S>; 5] = array::from_fn(|i| {
            order.push(i);
            u32x4::load(&rows[i])
        });
        array::map(vectors, |v| v.reduce_sum())
    }
}

#[test]
fn in_kernels() {
    let rows = core::array::from_fn(|i| core::array::from_fn(|j| (10 * i + j) as u32));
    for target in simd::columns::targets() {
        let mut order = vec![];
        assert_eq!(simd::columns::to(target, &rows, &mut order), Some([6, 46, 86, 126, 166]));
        assert_eq!(order, [0, 1, 2, 3, 4]);
    }
}

#[test]
fn as_in_core() {
    fn check<const N: usize>() {
        let f = |i: usize| (i as u8, i as u64 * 3);
        let all: [_; N] = bun_simd::array::from_fn(f);
        assert_eq!(all, core::array::from_fn(f));
        assert_eq!(bun_simd::array::map(all, |it| it.1 + 1), all.map(|it| it.1 + 1));
        assert_eq!(bun_simd::array::from_fn::<(), N>(|_| ()), [(); N]);
    }
    check::<0>();
    check::<1>();
    check::<7>();
    check::<16>();
    check::<17>();
    check::<32>();
    check::<33>();
    check::<300>();
}

#[test]
#[should_panic = "third"]
fn panics_pass() {
    let _: [u8; 4] = bun_simd::array::from_fn(|i| if i == 2 { panic!("third") } else { 0 });
}
