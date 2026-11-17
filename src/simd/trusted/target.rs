//! Used by the macros and the dispatch. Safety does not depend on it.

/// What a kernel is compiled for, best first.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    Avx512Icl,
    Avx512Skx,
    Avx2,
    Sse4,
    Sve2,
    Neon,
    Portable64,
    Portable32,
    Portable,
}

impl Target {
    pub const ALL: [Self; 9] = [
        Self::Avx512Icl,
        Self::Avx512Skx,
        Self::Avx2,
        Self::Sse4,
        Self::Sve2,
        Self::Neon,
        Self::Portable64,
        Self::Portable32,
        Self::Portable,
    ];

    /// The name of its module.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Avx512Icl => "avx512_icl",
            Self::Avx512Skx => "avx512_skx",
            Self::Avx2 => "avx2",
            Self::Sse4 => "sse4",
            Self::Sve2 => "sve2",
            Self::Neon => "neon",
            Self::Portable64 => "portable64",
            Self::Portable32 => "portable32",
            Self::Portable => "portable",
        }
    }

    /// `None` if it runs everywhere.
    pub const fn arch(self) -> Option<&'static str> {
        match self {
            Self::Avx512Icl | Self::Avx512Skx | Self::Avx2 | Self::Sse4 => Some("x86_64"),
            Self::Sve2 | Self::Neon => Some("aarch64"),
            Self::Portable64 | Self::Portable32 | Self::Portable => None,
        }
    }

    /// The builds that can run it, as in `#[cfg]`. Apple's cores have SVE only in streaming mode.
    pub const fn cfg(self) -> &'static str {
        match self {
            Self::Avx512Icl | Self::Avx512Skx | Self::Avx2 | Self::Sse4 => {
                r#"target_arch = "x86_64""#
            }
            Self::Sve2 => r#"all(target_arch = "aarch64", not(target_vendor = "apple"))"#,
            Self::Neon => r#"target_arch = "aarch64""#,
            Self::Portable64 | Self::Portable32 | Self::Portable => "true",
        }
    }

    #[rustfmt::skip]
    pub const fn features(self) -> &'static [&'static str] {
        match self {
            Self::Avx512Icl => &[
                "popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx512cd", "avx512dq", "avx512vl",
                "avx512vbmi", "avx512vbmi2", "avx512bitalg", "avx512vpopcntdq", "avx512vnni", "gfni",
                "vpclmulqdq",
            ],
            Self::Avx512Skx => &[
                "popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx512cd", "avx512dq", "avx512vl",
                "avx512bw",
            ],
            Self::Avx2 => &["popcnt", "bmi1", "bmi2", "lzcnt", "pclmulqdq", "avx2", "fma", "f16c"],
            Self::Sse4 => &["popcnt", "sse4.2"],
            Self::Sve2 => &["sve2"],
            Self::Neon => &["neon"],
            Self::Portable64 | Self::Portable32 | Self::Portable => &[],
        }
    }

    /// `None` if `cfg` does not hold.
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    const fn needs(self) -> Option<crate::Features> {
        let this_arch = if cfg!(target_arch = "x86_64") {
            "x86_64"
        } else {
            "aarch64"
        };
        match self.arch() {
            Some(arch) if !arch.eq_ignore_ascii_case(this_arch) => None,
            _ if cfg!(target_vendor = "apple") && matches!(self, Self::Sve2) => None,
            _ => Some(crate::Features::named(self.features())),
        }
    }

    pub fn is_supported(self) -> bool {
        cfg_select! {
            any(target_arch = "x86_64", target_arch = "aarch64") => {
                self.needs().is_some_and(crate::is_supported)
            }
            _ => self.arch().is_none(),
        }
    }

    /// The bits of the features that neither it nor `more` has. None if it is for other machines.
    pub fn lacks<'a>(self, more: impl IntoIterator<Item = &'a str>) -> u64 {
        cfg_select! {
            any(target_arch = "x86_64", target_arch = "aarch64") => {
                let is_here = |name: &&str| crate::detected().names().any(|it| it == *name);
                let more = more.into_iter().filter(is_here);
                let more = more.fold(0, |all, it| all | crate::Features::named(&[it]).0);
                self.needs().map_or(0, |needs| !(needs.0 | more))
            }
            _ => more.into_iter().fold(0, |none, _| none),
        }
    }
}
