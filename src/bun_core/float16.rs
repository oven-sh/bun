// ── f16 ───────────────────────────────────────────────────────────────────
// Zig's native `f16` (IEEE-754 binary16). Rust's `f16` is still nightly-only,
// so model it as a transparent `u16` bit-container with `f64` widening for the
// one hot caller (ConsoleObject Float16Array printing). PERF(port): scalar
// soft-float decode; revisit once `core::f16` stabilizes.
#[allow(non_camel_case_types)]
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct f16(pub u16);

impl f16 {
    #[inline]
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }
    #[inline]
    pub const fn to_bits(self) -> u16 {
        self.0
    }

    /// Widen to `f64` (exact). Port of Zig `@floatCast(f64, h)`.
    pub fn to_f64(self) -> f64 {
        let h = self.0 as u32;
        let sign = (h >> 15) & 1;
        let exp = (h >> 10) & 0x1F;
        let frac = h & 0x3FF;
        let signf = if sign != 0 { -1.0 } else { 1.0 };
        if exp == 0 {
            if frac == 0 {
                return signf * 0.0;
            }
            // subnormal: 2^-14 * (frac / 1024)
            return signf * (frac as f64) * 2.0_f64.powi(-24);
        }
        if exp == 0x1F {
            return if frac == 0 {
                signf * f64::INFINITY
            } else {
                f64::NAN
            };
        }
        signf * (1.0 + (frac as f64) / 1024.0) * 2.0_f64.powi(exp as i32 - 15)
    }
}
impl From<f16> for f64 {
    #[inline]
    fn from(h: f16) -> f64 {
        h.to_f64()
    }
}
impl From<f16> for f32 {
    #[inline]
    fn from(h: f16) -> f32 {
        h.to_f64() as f32
    }
}
// SAFETY: `#[repr(transparent)]` over `u16` — every bit pattern is a valid
// `f16`, no padding, `Copy + 'static`. Enables safe `bytemuck::cast_slice`
// from `&[u8]` for Float16Array printing (ConsoleObject).
unsafe impl bytemuck::Zeroable for f16 {}
// SAFETY: `#[repr(transparent)]` over `u16` — no padding, every bit pattern is
// valid, `Copy + Zeroable + 'static`; satisfies all `bytemuck::Pod` invariants.
unsafe impl bytemuck::Pod for f16 {}
impl core::fmt::Display for f16 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.to_f64().fmt(f)
    }
}
