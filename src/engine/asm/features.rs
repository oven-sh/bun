//! What a processor can do beyond the least that is required of it.

bitflags::bitflags! {
    /// SSE4.2 and POPCNT are taken for granted.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct X64Features: u16 {
        const AVX = 1 << 0;
        const AVX2 = 1 << 1;
        const BMI1 = 1 << 2;
        const BMI2 = 1 << 3;
        const LZCNT = 1 << 4;
        const FMA = 1 << 5;
        const F16C = 1 << 6;
    }
}

bitflags::bitflags! {
    /// ARMv8.0 with Advanced SIMD is taken for granted.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
    pub struct Arm64Features: u16 {
        const LSE = 1 << 0;
        const JSCVT = 1 << 1;
        const FRINTTS = 1 << 2;
        const DOTPROD = 1 << 3;
        const SHA3 = 1 << 4;
    }
}

#[cfg(target_arch = "x86_64")]
impl X64Features {
    pub fn host() -> Self {
        let mut features = Self::empty();
        features.set(Self::AVX, std::is_x86_feature_detected!("avx"));
        features.set(Self::AVX2, std::is_x86_feature_detected!("avx2"));
        features.set(Self::BMI1, std::is_x86_feature_detected!("bmi1"));
        features.set(Self::BMI2, std::is_x86_feature_detected!("bmi2"));
        features.set(Self::LZCNT, std::is_x86_feature_detected!("lzcnt"));
        features.set(Self::FMA, std::is_x86_feature_detected!("fma"));
        features.set(Self::F16C, std::is_x86_feature_detected!("f16c"));
        features
    }
}

#[cfg(target_arch = "aarch64")]
impl Arm64Features {
    pub fn host() -> Self {
        let mut features = Self::empty();
        features.set(Self::LSE, std::arch::is_aarch64_feature_detected!("lse"));
        features.set(
            Self::JSCVT,
            std::arch::is_aarch64_feature_detected!("jsconv"),
        );
        features.set(
            Self::FRINTTS,
            std::arch::is_aarch64_feature_detected!("frintts"),
        );
        features.set(
            Self::DOTPROD,
            std::arch::is_aarch64_feature_detected!("dotprod"),
        );
        features.set(Self::SHA3, std::arch::is_aarch64_feature_detected!("sha3"));
        features
    }
}
