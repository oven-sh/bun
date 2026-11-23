#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::multiple_bound_locations)]
use bun_simd::{mem::*, target::*, *};

#[kernel(avx2 + aes, sse4, neon)]
fn everything<'a, F: Readable<u8>, T: Int, const N: usize, const FLAG: bool>(
    from: &[F],
    mut count: usize,
    (a, b): (T, T),
    &[first, _]: &[u8; 2],
    _: [(); N],
    rest: &'a [u8],
) -> (&'a [u8], u64)
where
    T: Unsigned,
    F: Sized,
{
    let s: S = bun_simd::prelude::isa();
    count += FLAG as usize;
    let sum = s.load::<u8, B16>(from).reduce_max() as u64 + a.to_u64() + b.to_u64() + first as u64;
    (&rest[count..], sum)
}

#[kernel]
fn scalar() {}

#[kernel(avx512 + aes, sve2 + aes + sha3)]
fn chosen() -> Target {
    S::TARGET
}

#[kernel]
fn nested() -> Target {
    chosen::here()
}

#[test]
fn forms() {
    let bytes = [7u8; 16];
    assert_eq!(everything::<_, u16, 2, true>(&bytes[..], 1, (1, 2), &[3, 4], [(); 2], b"abc"), (&b"c"[..], 13));
    scalar();
    scalar::baseline();
    assert!(cpu().includes(chosen()));
    // The target of the caller is not in the list.
    assert_eq!(nested(), if Targets::DEFAULT.choose(cpu()).is_baseline() { chosen::baseline() } else { chosen() });
    assert!(chosen::to(bun_simd::target!(neon)).is_none());
    assert_eq!(
        set_cpu(bun_simd::target!(neon)),
        cfg!(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))
    );
}

#[test]
fn vectors_are_sync() {
    #[bun_simd::kernel(targets = bun_simd::target::Targets::ALL)]
    fn sizes((): ()) {
        fn one<V: Sync + Send>() {}
        one::<S, S>();
        macro_rules! each { ($($t:ident)*) => {$(each!($t: B2 B4 B8 B16 B32 B64 B128 B256 B512);)*};
            ($t:ident: $($w:ident)*) => {$(one::<Simd<$t, $w, S>, S>(); one::<MaskOf<$t, $w, S>, S>();)*}; }
        each!(u8 i8 u16 i16 u32 i32 u64 i64 f16 f32 f64 bf16);
    }
    sizes::to(Target::Portable, ());
}
