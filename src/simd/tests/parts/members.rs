use bun_simd::*;
use framework::*;

macro_rules! sets { ($($name:ident $types:tt $n:literal;)*) => { cases! {$(
    $name $types 16..=64, |d, a, _, _, io| { let (all, n) = (io.slice::<T>().repeat(8), T::from_u64(io.n % 64 | 1 << (T::BITS - 1))); let set = all.first_chunk::<$n>().unwrap();
        let of = |or: u64| set.map(|it| T::from_u64(it.to_u64() & n.to_u64() | or));
        [a.is_in(set), (a & n).is_in(of(0)), (a & n | 1).is_in_relaxed(of(1)), d.load(&all[io.n as usize % 32..]).is_in(*set), a.is_in([T::MAX; $n])] } => |m| {
        let (all, n) = (m.slice().repeat(8), m.t.wrap((m.io.n % 64 | 1 << (m.t.bits() - 1)) as i128));
        let has = |x: i128, of: &dyn Fn(i128) -> i128| all[..$n].iter().any(|&it| of(it) == of(x));
        [m.mask(|i| has(m.a[i], &|it| it)), m.mask(|i| has(m.a[i], &|it| it & n)), m.mask(|i| has(m.a[i], &|it| it & n | 1)), m.mask(|i| has(all[m.io.n as usize % 32 + i], &|it| it)),
            m.mask(|i| m.t.max() == m.a[i])].concat() };
)*} }; }
sets! {
    in_1 [u8 i16 u32 i64] 1; in_2 [i8 u32 u64] 2; in_3 [u8 u16 i32 u64] 3; in_4 [i8 u16 u32 i64] 4; in_6 [u8 i16 u32] 6; in_8 [u8 u16 u32 i32 u64 i64] 8; in_11 [i8 u16 u32 u64] 11;
    in_16 [u8 u16 u32 i32 i64] 16; in_24 [u8 u32] 24; in_41 [i8 i16 u32 u64] 41;
}
cases! {
    in_vector [u8 i16 u16 u32 i64] 16..=64, |d, a, _, _, io| { let set = io.load(d.isa().of::<T, B16>(), 1); [(a & 15).is_in(set & 15), (a & 14 | 1).is_in_relaxed(set & 15 | 1)] } => |m| {
        let set = &m.b[..m.block];
        [m.mask(|i| set.iter().any(|it| it & 15 == m.a[i] & 15)), m.mask(|i| set.iter().any(|it| it & 15 | 1 == m.a[i] & 14 | 1))].concat() };
}

#[test]
#[allow(clippy::needless_borrows_for_generic_args)]
fn kinds() {
    #[kernel(targets = OF_CASES)]
    fn of(from: &[u32]) -> [u64; 7] {
        use bun_simd::prelude::*;
        let v = u32x8::iota(1);
        let wide = (v + 6).to_array();
        [
            v.is_in(5),
            v.is_in_relaxed(2),
            v.is_in([]),
            v.is_in(&[1, 7]),
            v.is_in(Simd::load(from)),
            v.is_in(&Simd::splat(3)),
            v.is_in(wide),
        ]
        .map(|it| it.to_bitmask())
    }
    for target in targets() {
        assert_eq!(of::to(target, &[1, 3, 5, 7, 8]), Some([16, 2, 0, 0x41, 0x55, 4, 0xc0]));
    }
}
