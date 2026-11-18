//! What the rest of Bun names of the ahead-of-time compiler's schema.

#[repr(u32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ImageVerdict {
    Unsupported,
    Accepted,
    CompiledCodeDisabled,
    NotAnImage,
    Truncated,
    Misaligned,
    LowPagesAccessible,
    NoCode,
    CannotMapCode,
    NeedsCellCage,
    OptionsConflict,
    MalformedTables,
    StampMismatch,
    IdentityMismatch,
    CodeAtFixedAddress,
    OutsideItsSegments,
    CannotReadExecutable,
}

impl ImageVerdict {
    pub const COUNT: usize = 17;
    const ALL: [ImageVerdict; Self::COUNT] = [
        ImageVerdict::Unsupported,
        ImageVerdict::Accepted,
        ImageVerdict::CompiledCodeDisabled,
        ImageVerdict::NotAnImage,
        ImageVerdict::Truncated,
        ImageVerdict::Misaligned,
        ImageVerdict::LowPagesAccessible,
        ImageVerdict::NoCode,
        ImageVerdict::CannotMapCode,
        ImageVerdict::NeedsCellCage,
        ImageVerdict::OptionsConflict,
        ImageVerdict::MalformedTables,
        ImageVerdict::StampMismatch,
        ImageVerdict::IdentityMismatch,
        ImageVerdict::CodeAtFixedAddress,
        ImageVerdict::OutsideItsSegments,
        ImageVerdict::CannotReadExecutable,
    ];

    pub fn from_wire(word: u32) -> Option<ImageVerdict> {
        Self::ALL.get(word as usize).copied()
    }
}

#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Default, Debug)]
pub struct AdmittedCode(u32);

impl AdmittedCode {
    pub const INSPECTOR: AdmittedCode = AdmittedCode(1 << 0);
    const ALL: AdmittedCode = AdmittedCode(0b11);

    pub const fn contains(self, other: AdmittedCode) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn from_wire(word: u32) -> Option<AdmittedCode> {
        if word & !Self::ALL.0 == 0 {
            Some(AdmittedCode(word))
        } else {
            None
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Architecture {
    ARM64,
    X86_64,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Stage {
    Load,
    BindModules,
    Check,
    Lower,
}

impl Stage {
    pub const ALL: [Stage; 4] = [Stage::Load, Stage::BindModules, Stage::Check, Stage::Lower];

    pub const fn time(self) -> StatisticId {
        match self {
            Stage::Load => StatisticId::LoadNanoseconds,
            Stage::BindModules => StatisticId::BindModulesNanoseconds,
            Stage::Check => StatisticId::CheckNanoseconds,
            Stage::Lower => StatisticId::LowerNanoseconds,
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum LimitId {
    MaxDataNodes,
    MaxInferenceNodes,
    MaxTermsReadForProduct,
    MaxDeclaredSignatureDepth,
    MaxConstructorParentsFollowed,
    MaxFunctionsGivenThis,
}

impl LimitId {
    pub const COUNT: usize = 6;
    pub const ALL: [LimitId; Self::COUNT] = [
        LimitId::MaxDataNodes,
        LimitId::MaxInferenceNodes,
        LimitId::MaxTermsReadForProduct,
        LimitId::MaxDeclaredSignatureDepth,
        LimitId::MaxConstructorParentsFollowed,
        LimitId::MaxFunctionsGivenThis,
    ];

    pub const fn name(self) -> &'static str {
        match self {
            LimitId::MaxDataNodes => "MaxDataNodes",
            LimitId::MaxInferenceNodes => "MaxInferenceNodes",
            LimitId::MaxTermsReadForProduct => "MaxTermsReadForProduct",
            LimitId::MaxDeclaredSignatureDepth => "MaxDeclaredSignatureDepth",
            LimitId::MaxConstructorParentsFollowed => "MaxConstructorParentsFollowed",
            LimitId::MaxFunctionsGivenThis => "MaxFunctionsGivenThis",
        }
    }

    pub const fn value_on_arm64(self) -> u64 {
        match self {
            LimitId::MaxDataNodes => 16_777_216,
            LimitId::MaxInferenceNodes => 4096,
            LimitId::MaxTermsReadForProduct => 16,
            LimitId::MaxDeclaredSignatureDepth => 3,
            LimitId::MaxConstructorParentsFollowed => 64,
            LimitId::MaxFunctionsGivenThis => 32,
        }
    }

    pub const fn value_on_x86_64(self) -> u64 {
        self.value_on_arm64()
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum StatisticId {
    SourceFilesChecked,
    SourceFilesInferred,
    SourceFilesData,
    SourceFilesDemoted,
    SourceLines,
    DependencyFilesNotVerified,
    LoadNanoseconds,
    BindModulesNanoseconds,
    CheckNanoseconds,
    LowerNanoseconds,
}
