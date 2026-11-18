use bun_engine_asm::{Arm64Features, X64Features};

/// The processor that code is generated for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    X64(X64Features),
    Arm64(Arm64Features),
}

impl Target {
    pub fn host() -> Self {
        #[cfg(target_arch = "x86_64")]
        return Self::X64(X64Features::host());
        #[cfg(target_arch = "aarch64")]
        return Self::Arm64(Arm64Features::host());
    }

    pub fn is_x64(self) -> bool {
        matches!(self, Self::X64(_))
    }

    pub fn is_arm64(self) -> bool {
        matches!(self, Self::Arm64(_))
    }

    pub fn has_float_to_int32_modular(self) -> bool {
        matches!(self, Self::Arm64(features) if features.contains(Arm64Features::JSCVT))
    }

    pub fn has_half_floats(self) -> bool {
        match self {
            Self::X64(features) => features.contains(X64Features::AVX | X64Features::F16C),
            Self::Arm64(_) => true,
        }
    }
}
