//! Lanes are little-endian on all CPUs wherever their bytes show. LLVM cancels the swaps on the way to bytes and back.

cfg_select! {
    target_endian = "little" => {
        pub use crate::simd::ToBytes;
    }
    _ => {
        use crate::simd::{Fits, Simd, ToBytes as Core};

        /// In place of the trait of `crate::simd`.
        pub trait ToBytes: Sized {
            type Bytes;
            fn to_ne_bytes(self) -> Self::Bytes;
            fn from_ne_bytes(bytes: Self::Bytes) -> Self;
            fn swap(bytes: Self::Bytes) -> Self::Bytes;
            #[inline(always)]
            fn to_le_bytes(self) -> Self::Bytes {
                Self::swap(self.to_ne_bytes())
            }
            #[inline(always)]
            fn from_le_bytes(bytes: Self::Bytes) -> Self {
                Self::from_ne_bytes(Self::swap(bytes))
            }
            #[inline(always)]
            fn to_be_bytes(self) -> Self::Bytes {
                self.to_ne_bytes()
            }
            #[inline(always)]
            fn from_be_bytes(bytes: Self::Bytes) -> Self {
                Self::from_ne_bytes(bytes)
            }
        }

        // In integers, as a float with its bytes in another order is better not moved as a float.
        macro_rules! to_bytes { ($($t:ident $u:ident,)*) => {$(
            impl<const N: usize, const BYTES: usize> ToBytes for Simd<$t, N>
            where $t: Fits<N>, $u: Fits<N>, u8: Fits<BYTES>, Self: Core<Bytes = Simd<u8, BYTES>>, Simd<$u, N>: Core<Bytes = Simd<u8, BYTES>> {
                type Bytes = Simd<u8, BYTES>;
                #[inline(always)] fn to_ne_bytes(self) -> Self::Bytes { Core::to_ne_bytes(self) }
                #[inline(always)] fn from_ne_bytes(bytes: Self::Bytes) -> Self { Core::from_ne_bytes(bytes) }
                #[inline(always)]
                fn swap(bytes: Self::Bytes) -> Self::Bytes {
                    if size_of::<$t>() == 1 { return bytes; }
                    Core::to_ne_bytes(<Simd<$u, N> as Core>::from_ne_bytes(bytes).swap_bytes::<crate::Portable>())
                }
            }
        )*}; }
        to_bytes! { u8 u8, i8 u8, u16 u16, i16 u16, u32 u32, i32 u32, f32 u32, u64 u64, i64 u64, f64 u64, }
    }
}
