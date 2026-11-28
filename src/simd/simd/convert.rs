//! `as` for each lane.
use super::*;

impl<T: Fits<N>, const N: usize> Simd<T, N> {
    #[bun_simd_macros::op]
    pub(crate) fn cast<U: Fits<N>, S: Cpu>(self) -> Simd<U, N>
    where
        Here: In<S>,
    {
        if const { T::SIZE == U::SIZE && T::FLOAT == U::FLOAT } {
            return self.bits();
        }
        chosen!(fn(_) -> _: T::SIZE != U::SIZE || T::FLOAT != U::FLOAT => arch::convert::<S, T, U, N>, _ => |_| unreachable!())(
            self,
        )
    }
    /// To another number of lanes. Those that are new are unspecified.
    #[bun_simd_macros::op]
    pub(crate) fn cast_padded<U: Fits<M>, S: Cpu, const M: usize>(self) -> Simd<U, M>
    where
        T: Fits<M>,
        Here: In<S>,
    {
        #[cfg(any(target_feature = "sse2", all(target_arch = "wasm32", target_feature = "simd128")))]
        if const { N < M && M * U::SIZE == 16 && U::SIZE < T::SIZE } {
            macro_rules! to { ($($u:ident)*) => {$(
                lazily!(N < M && M * U::SIZE == 16 && U::SIZE < T::SIZE && U::SIZE == $u::SIZE && U::FLOAT == $u::FLOAT && U::SIGNED == $u::SIGNED => Simd::of(cast(self.cast::<$u, S>().0)));
            )*}; }
            to!(u8 i8 u16 i16 u32 i32 f32);
        }
        self.resize::<M>().cast::<U, S>()
    }
}
#[bun_simd_macros::op]
pub(super) fn one_by_one<T: Fits<N>, U: Fits<N>, const N: usize>(v: Simd<T, N>) -> Simd<U, N> {
    let (from, mut to) = (v.to_array(), [U::default(); N]);
    for i in 0..N {
        to[i] = from[i].convert();
    }
    Simd::from_array(to)
}
