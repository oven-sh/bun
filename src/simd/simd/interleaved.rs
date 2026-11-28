//! Three or four vectors whose lanes alternate in memory.
use super::*;
macro_rules! interleaved { ($($load:ident $store:ident $k:literal [$($i:literal)*])*) => {$(
    #[bun_simd_macros::op]
    pub fn $load<T: Fits<N>, const N: usize>(from: &[T]) -> [Simd<T, N>; $k] {
        #[inline]
        fn every<T: Fits<N>, const N: usize, const I: usize>(all: [RegOf<T, N>; $k]) -> RegOf<T, N> { <T::Bits as Class<N>>::every_from(&all, I, $k) }
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { Simd::<T, N>::WHOLE } { return arch::$load(from); }
        let from = &from[..$k * N];
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        lazily!(T::SIZE < 4 && N > 2 && N * T::SIZE <= 16 => arch::loaded(*from.as_chunks::<N>().0.first_chunk().unwrap()));
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { $k * N * T::SIZE == 16 } {
            let all = cast(*from.as_chunks::<N>().0.first_chunk::<4>().unwrap());
            return [$(arch::loaded_short::<T, $k, N, $i>(all)),*];
        }
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        if const { !Simd::<T, N>::WHOLE } {
            let all = arch::turned_short::<T, $k, N, false>([$(*from[$i * N..].first_chunk().unwrap()),*]);
            return [$(Simd::from_array(all[$i])),*];
        }
        if const { !Simd::<T, N>::WHOLE } {
            return [$({ let mut v = [T::default(); N]; for i in 0..N { v[i] = from[$k * i + $i]; } Simd::from_array(v) }),*];
        }
        let all = [$(Simd::<T, N>::from_slice(&from[$i * N..]).0),*];
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        { let all = arch::turned::<T, $k, N, false>(all); return [$(Simd::of(all[$i])),*]; }
        #[allow(unreachable_code)]
        [$(Simd::of(every::<T, N, $i>(all))),*]
    }
    #[bun_simd_macros::op]
    pub fn $store<T: Fits<N>, const N: usize>(vectors: [Simd<T, N>; $k], to: &mut [T]) {
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        if const { Simd::<T, N>::WHOLE } { return arch::$store(vectors, to); }
        let to = &mut to[..$k * N];
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        lazily!(T::SIZE < 4 && N > 2 && N * T::SIZE <= 16 => *to.as_chunks_mut::<N>().0.first_chunk_mut().unwrap() = arch::stored(vectors));
        #[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
        {
            let all = arch::stored_short(vectors);
            if const { $k == 4 } { *to.as_chunks_mut::<N>().0.first_chunk_mut().unwrap() = all } else { $(*to[$i * N..].first_chunk_mut().unwrap() = all[$i];)* }
            return;
        }
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        if const { Simd::<T, N>::WHOLE } {
            let all = arch::turned::<T, $k, N, true>([$(vectors[$i].0),*]);
            $(Simd::<T, N>::of(all[$i]).copy_to_slice(&mut to[$i * N..]);)*
            return;
        }
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
        {
            let all = arch::turned_short::<T, $k, N, true>([$(vectors[$i].to_array()),*]);
            $(*to[$i * N..].first_chunk_mut().unwrap() = all[$i];)*
            return;
        }
        #[allow(unreachable_code)]
        for i in 0..N { $(to[$k * i + $i] = vectors[$i][i];)* }
    }
)*}; }
#[cfg(all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", not(miri)))]
pub use arch::store2;
interleaved! { load3 store3 3 [0 1 2] load4 store4 4 [0 1 2 3] }
