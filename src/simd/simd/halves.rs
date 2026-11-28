// Several registers.
/// On AArch64, an operation on more than four registers is simplified once, and then copied.
macro_rules! many { ($body:block) => {{
    #[cfg(target_arch = "aarch64")]
    lazily!(crate::OPTIMIZED && size_of::<Self>() > 64 => apart!($body));
    $body
}}; }
macro_rules! halves { ($($r:ty, $h:ty, [$($i:literal)*];)*) => {$(
    impl Reg for $r {
        const ZERO: Self = cast([<$h>::ZERO; 2]);
        #[bun_simd_macros::op]
        fn joined<S: Cpu, T: E, A: Pod>(all: A) -> Self {
            let [a, b]: [[u8; size_of::<$h>()]; 2] = cast(all);
            cast([<$h>::joined::<S, T, _>(a), <$h>::joined::<S, T, _>(b)])
        }
        #[bun_simd_macros::op]
        fn planned<B: Class<N> + Class<M>, P: Swizzle<M>, const N: usize, const M: usize>(a: &<B as Class<N>>::Reg, b: &<B as Class<N>>::Reg) -> Self { [$(Plan::<B, P, N, M, $i>::register::<Q>(a, b)),*] }
        #[bun_simd_macros::op]
        fn map1<S: Cpu, O: Op1>(self, x: u32) -> Self { many!({
            let [a, b]: [$h; 2] = cast(self);
            cast([a.map1::<S, O>(x), b.map1::<S, O>(x)])
        }) }
        #[bun_simd_macros::op]
        fn map2<S: Cpu, O: Op2>(self, b: Self) -> Self { many!({
            let [a, b]: [[$h; 2]; 2] = [cast(self), cast(b)];
            cast([a[0].map2::<S, O>(b[0]), a[1].map2::<S, O>(b[1])])
        }) }
        #[bun_simd_macros::op]
        fn map3<S: Cpu, O: Op3>(self, b: Self, c: Self) -> Self { many!({
            let [a, b, c]: [[$h; 2]; 3] = [cast(self), cast(b), cast(c)];
            cast([a[0].map3::<S, O>(b[0], c[0]), a[1].map3::<S, O>(b[1], c[1])])
        }) }
        #[bun_simd_macros::op]
        fn splat<S: Cpu, T: E>(value: T) -> Self {
            let half = <$h>::splat::<S, T>(value);
            cast([half, half])
        }
        #[bun_simd_macros::op]
        fn to_bits<S: Cpu, T: E>(self) -> u64 {
            bits_of_halves!(self, $h)
        }
        #[bun_simd_macros::op]
        fn from_bits<S: Cpu, T: E>(bits: u64) -> Self {
            cast([<$h>::from_bits::<S, T>(bits), <$h>::from_bits::<S, T>(bits >> const { size_of::<$h>() / T::SIZE % 64 })])
        }
        #[bun_simd_macros::op]
        fn any<S: Cpu, T: E>(self) -> bool {
            let [a, b]: [$h; 2] = cast(self);
            a.map2::<S, op::or<T::Bits>>(b).any::<S, T>()
        }
        #[bun_simd_macros::op]
        fn all<S: Cpu, T: E>(self) -> bool {
            let [a, b]: [$h; 2] = cast(self);
            a.map2::<S, op::and<T::Bits>>(b).all::<S, T>()
        }
    }
)*}; }
