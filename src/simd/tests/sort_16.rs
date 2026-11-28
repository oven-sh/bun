#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
include!("parts/sort.rs");
ints!(u8 i8 u16 i16);

#[test]
fn bytes_by_their_own_sign() {
    for target in bun_simd::sort::targets() {
        let mut signed: Vec<_> = (0..1024).map(|i| (i / 4) as i8).collect();
        let mut unsigned: Vec<_> = signed.iter().map(|&it| it as u8 ^ 0x80).collect();
        bun_simd::sort::to(target, &mut signed[..]);
        bun_simd::sort::to(target, &mut unsigned[..]);
        assert!(
            (0..1024).all(|i| (signed[i] as u8 ^ 0x80, unsigned[i]) == ((i / 4) as u8, (i / 4) as u8)),
            "{target:?}"
        );
    }
}
