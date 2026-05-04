use phf::phf_map;

// TODO(port): `build_options` is Zig's build-system-injected module. In Rust this
// becomes a generated module (env!()/option_env!()/build.rs consts). Phase B wires it.
// Zig: `pub const build_options = @import("build_options");` — public re-export.
pub use crate::build_options;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BuildTarget {
    Native,
    Wasm,
    Wasi,
}

pub const BUILD_TARGET: BuildTarget = {
    if cfg!(target_family = "wasm") {
        BuildTarget::Wasm
    } else {
        BuildTarget::Native
    }
};

pub const IS_WASM: bool = matches!(BUILD_TARGET, BuildTarget::Wasm);
pub const IS_NATIVE: bool = matches!(BUILD_TARGET, BuildTarget::Native);
pub const IS_WASI: bool = matches!(BUILD_TARGET, BuildTarget::Wasi);
pub const IS_MAC: bool = IS_NATIVE && cfg!(target_os = "macos");
pub const IS_BROWSER: bool = !IS_WASI && IS_WASM;
pub const IS_WINDOWS: bool = cfg!(windows);
pub const IS_POSIX: bool = !IS_WINDOWS && !IS_WASM;
pub const IS_DEBUG: bool = cfg!(debug_assertions);
pub const IS_TEST: bool = cfg!(test);
pub const IS_LINUX: bool = cfg!(target_os = "linux");
pub const IS_FREEBSD: bool = cfg!(target_os = "freebsd");
/// kqueue-based event loop (macOS + FreeBSD share most of this path).
pub const IS_KQUEUE: bool = IS_MAC || IS_FREEBSD;
pub const IS_AARCH64: bool = cfg!(target_arch = "aarch64");
pub const IS_X86: bool = cfg!(any(target_arch = "x86", target_arch = "x86_64"));
pub const IS_X64: bool = cfg!(target_arch = "x86_64");
pub const IS_MUSL: bool = cfg!(target_env = "musl");
pub const IS_ANDROID: bool = cfg!(target_os = "android");
pub const IS_GLIBC: bool = IS_LINUX && cfg!(target_env = "gnu");
// TODO(port): Zig `ReleaseSafe` has no direct Rust cfg; expose via build_options in Phase B.
pub const ALLOW_ASSERT: bool = IS_DEBUG || IS_TEST || build_options::RELEASE_SAFE;
pub const CI_ASSERT: bool =
    IS_DEBUG || IS_TEST || ENABLE_ASAN || (build_options::RELEASE_SAFE && IS_CANARY);
pub const SHOW_CRASH_TRACE: bool = IS_DEBUG || IS_TEST || ENABLE_ASAN;
/// All calls to `@export` should be gated behind this check, so that code
/// generators that compile Zig code know not to reference and compile a ton of
/// unused code.
// TODO(port): `builtin.output_mode == .Obj` has no Rust equivalent; gate via build_options.
pub const EXPORT_CPP_APIS: bool = if build_options::OVERRIDE_NO_EXPORT_CPP_APIS {
    false
} else {
    build_options::OUTPUT_MODE_OBJ || IS_TEST
};

/// Whether or not to enable allocation tracking when the `AllocationScope`
/// allocator is used.
pub const ENABLE_ALLOC_SCOPES: bool = IS_DEBUG || ENABLE_ASAN;

/// Set if compiling with `-Dno_llvm`
/// All places this is used is working around a Zig bug.
pub const ZIG_SELF_HOSTED_BACKEND: bool = build_options::ZIG_SELF_HOSTED_BACKEND;

pub const REPORTED_NODEJS_VERSION: &str = build_options::REPORTED_NODEJS_VERSION;
pub const BASELINE: bool = build_options::BASELINE;
pub const ENABLE_SIMD: bool = !BASELINE && !ZIG_SELF_HOSTED_BACKEND;
pub const GIT_SHA: &str = build_options::SHA;
pub const GIT_SHA_SHORT: &str = if !build_options::SHA.is_empty() {
    // TODO(port): const slice indexing on &str — Phase B may need a const fn helper or build.rs precompute.
    const_str_slice(build_options::SHA, 0, 9)
} else {
    ""
};
pub const GIT_SHA_SHORTER: &str = if !build_options::SHA.is_empty() {
    const_str_slice(build_options::SHA, 0, 6)
} else {
    ""
};
pub const IS_CANARY: bool = build_options::IS_CANARY;
pub const CANARY_REVISION: &str = if IS_CANARY {
    build_options::CANARY_REVISION
} else {
    ""
};
pub const DUMP_SOURCE: bool = IS_DEBUG && !IS_TEST;
pub const BASE_PATH: &[u8] = build_options::BASE_PATH;
pub const ENABLE_LOGS: bool = build_options::ENABLE_LOGS;
pub const ENABLE_ASAN: bool = build_options::ENABLE_ASAN;
pub const ENABLE_FUZZILLI: bool = build_options::ENABLE_FUZZILLI;
pub const ENABLE_TINYCC: bool = build_options::ENABLE_TINYCC;
pub const CODEGEN_PATH: &[u8] = build_options::CODEGEN_PATH;
pub const CODEGEN_EMBED: bool = build_options::CODEGEN_EMBED;

pub const VERSION: bun_semver::Version = build_options::VERSION;
pub const VERSION_STRING: &str = const_format::formatcp!(
    "{}.{}.{}",
    VERSION.major,
    VERSION.minor,
    VERSION.patch
);

#[inline(always)]
pub fn only_mac() {
    if !IS_MAC {
        unreachable!();
    }
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OperatingSystem {
    Mac,
    Linux,
    Freebsd,
    Windows,
    // wAsM is nOt aN oPeRaTiNg SyStEm
    Wasm,
}

impl OperatingSystem {
    pub const NAMES: phf::Map<&'static [u8], OperatingSystem> = phf_map! {
        b"windows" => OperatingSystem::Windows,
        b"win32" => OperatingSystem::Windows,
        b"win" => OperatingSystem::Windows,
        b"win64" => OperatingSystem::Windows,
        b"win_x64" => OperatingSystem::Windows,
        b"darwin" => OperatingSystem::Mac,
        b"macos" => OperatingSystem::Mac,
        b"macOS" => OperatingSystem::Mac,
        b"mac" => OperatingSystem::Mac,
        b"apple" => OperatingSystem::Mac,
        b"linux" => OperatingSystem::Linux,
        b"Linux" => OperatingSystem::Linux,
        b"linux-gnu" => OperatingSystem::Linux,
        b"gnu/linux" => OperatingSystem::Linux,
        b"freebsd" => OperatingSystem::Freebsd,
        b"FreeBSD" => OperatingSystem::Freebsd,
        b"wasm" => OperatingSystem::Wasm,
    };

    /// user-facing name with capitalization
    pub fn display_string(self) -> &'static [u8] {
        match self {
            Self::Mac => b"macOS",
            Self::Linux => b"Linux",
            Self::Freebsd => b"FreeBSD",
            Self::Windows => b"Windows",
            Self::Wasm => b"WASM",
        }
    }

    /// same format as `process.platform`
    pub fn name_string(self) -> &'static [u8] {
        match self {
            Self::Mac => b"darwin",
            Self::Linux => b"linux",
            Self::Freebsd => b"freebsd",
            Self::Windows => b"win32",
            Self::Wasm => b"wasm",
        }
    }

    // TODO(port): std.Target.Os.Tag has no Rust equivalent; callers should match on
    // OperatingSystem directly or use cfg!. Phase B decides if this is needed.
    pub fn std_os_tag(self) -> ! {
        unimplemented!("std.Target.Os.Tag has no Rust equivalent")
    }

    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npm_name(self) -> &'static [u8] {
        match self {
            Self::Mac => b"darwin",
            Self::Linux => b"linux",
            Self::Freebsd => b"freebsd",
            Self::Windows => b"windows",
            Self::Wasm => b"wasm",
        }
    }
}

pub const OS: OperatingSystem = if IS_MAC {
    OperatingSystem::Mac
} else if IS_LINUX {
    OperatingSystem::Linux
} else if IS_FREEBSD {
    OperatingSystem::Freebsd
} else if IS_WINDOWS {
    OperatingSystem::Windows
} else if IS_WASM {
    OperatingSystem::Wasm
} else {
    panic!("Please add your OS to the OperatingSystem enum")
};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Architecture {
    X64,
    Arm64,
    Wasm,
}

impl Architecture {
    /// npm package name, `@oven-sh/bun-{os}-{arch}`
    pub fn npm_name(self) -> &'static [u8] {
        match self {
            Self::X64 => b"x64",
            Self::Arm64 => b"aarch64",
            Self::Wasm => b"wasm",
        }
    }

    pub const NAMES: phf::Map<&'static [u8], Architecture> = phf_map! {
        b"x86_64" => Architecture::X64,
        b"x64" => Architecture::X64,
        b"amd64" => Architecture::X64,
        b"aarch64" => Architecture::Arm64,
        b"arm64" => Architecture::Arm64,
        b"wasm" => Architecture::Wasm,
    };
}

pub const ARCH: Architecture = if IS_WASM {
    Architecture::Wasm
} else if IS_X64 {
    Architecture::X64
} else if IS_AARCH64 {
    Architecture::Arm64
} else {
    panic!("Please add your architecture to the Architecture enum")
};

// TODO(port): helper for const &str slicing; replace with build.rs precompute or
// const_format in Phase B if this doesn't const-eval cleanly.
const fn const_str_slice(s: &'static str, start: usize, end: usize) -> &'static str {
    let bytes = s.as_bytes();
    let mut i = start;
    while i < end {
        // ASCII-only check (git SHA is hex, always ASCII)
        assert!(bytes[i].is_ascii());
        i += 1;
    }
    // SAFETY: verified ASCII range above; slice is within bounds and at char boundaries.
    unsafe {
        core::str::from_utf8_unchecked(core::slice::from_raw_parts(
            bytes.as_ptr().add(start),
            end - start,
        ))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/env.zig (193 lines)
//   confidence: medium
//   todos:      5
//   notes:      build_options module must be generated by build.rs in Phase B (expose BASE_PATH/CODEGEN_PATH as &[u8]); std.Target.Os.Tag dropped; ReleaseSafe/output_mode need build-time flags
// ──────────────────────────────────────────────────────────────────────────
