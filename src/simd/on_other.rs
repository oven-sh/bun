//! As on_x86.rs, for POWER.

use crate::{Isa, Lane, Simd, Width};

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Stable Rust doesn't show the feature.
    const HANDED: bool = cfg!(any(target_endian = "little", target_feature = "power9-altivec")) && size_of::<T>() == 1;
    /// The same value.
    #[op]
    pub(crate) fn handed(lane: T) -> T {
        choose! { Self::HANDED => T::from_u64(crate::regs::scalar(if const { T::IS_SIGNED } { crate::raw::same::<_, i8>(lane) as u64 } else { crate::raw::same::<_, u8>(lane) as u64 })), _ => lane }
    }
    #[op]
    pub(crate) fn array(self) -> crate::Array<T, W> {
        use crate::raw::Raw;
        let lanes = self.raw.to_array();
        if are_known!(self.raw) { lanes } else { Self::all_handed(lanes) }
    }
    #[op]
    pub(crate) fn all_handed<A>(lanes: A) -> A {
        if const { Self::HANDED && (T::IS_SIGNED || cfg!(target_endian = "big")) } {
            core::hint::black_box(lanes)
        } else {
            lanes
        }
    }
}
