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
// Zig's `Environment.isLinux` is `builtin.target.os.tag == .linux`, which is
// TRUE on Android (Zig models Android as `os.tag == .linux, abi == .android`).
// Rust splits them into two `target_os` values, so this const has to OR them
// to keep the Zig semantics — otherwise `OS` (below) panics at const-eval on
// the `*-linux-android` cross targets and Linux-only code paths are skipped.
pub const IS_LINUX: bool = cfg!(any(target_os = "linux", target_os = "android"));
pub const IS_FREEBSD: bool = cfg!(target_os = "freebsd");
/// kqueue-based event loop (macOS + FreeBSD share most of this path).
pub const IS_KQUEUE: bool = IS_MAC || IS_FREEBSD;
pub const IS_AARCH64: bool = cfg!(target_arch = "aarch64");
pub const IS_X86: bool = cfg!(any(target_arch = "x86", target_arch = "x86_64"));
pub const IS_X64: bool = cfg!(target_arch = "x86_64");
pub const IS_MUSL: bool = cfg!(target_env = "musl");
pub const IS_ANDROID: bool = cfg!(target_os = "android");
pub const IS_GLIBC: bool = IS_LINUX && cfg!(target_env = "gnu");
pub const ALLOW_ASSERT: bool = IS_DEBUG || IS_TEST || build_options::RELEASE_SAFE;
pub const CI_ASSERT: bool =
    IS_DEBUG || IS_TEST || ENABLE_ASAN || (build_options::RELEASE_SAFE && IS_CANARY);
pub const SHOW_CRASH_TRACE: bool = IS_DEBUG || IS_TEST || ENABLE_ASAN;
/// Zig gated `@export` blocks behind `output_mode == .Obj` so the
/// `zig translate-c` and codegen pipelines could compile a stripped-down
/// crate. The Rust build is always a single staticlib that exports the C++
/// surface, so this is a constant `true`.
pub const EXPORT_CPP_APIS: bool = true;

pub const REPORTED_NODEJS_VERSION: &str = build_options::REPORTED_NODEJS_VERSION;
pub const BASELINE: bool = build_options::BASELINE;
/// Zig disabled SIMD under `-Dno_llvm` (self-hosted backend lacked vector
/// lowering); Rust always uses LLVM, so only `BASELINE` gates it.
pub const ENABLE_SIMD: bool = !BASELINE;
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

// TYPE_ONLY: bun_semver::Version moves to bun_core (move-in pass).
pub const VERSION: crate::Version = build_options::VERSION;
pub const VERSION_STRING: &str =
    const_format::formatcp!("{}.{}.{}", VERSION.major, VERSION.minor, VERSION.patch);
#[allow(non_upper_case_globals)]
pub const version_string: &str = VERSION_STRING;

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

/// Port of the subset of Zig's `std.Target.Os.Tag` that Bun targets.
/// Variant names match the Zig stdlib tags (`.macos`, `.linux`, `.freebsd`,
/// `.windows`) so cross-references in ported code stay 1:1.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum StdOsTag {
    Macos,
    Linux,
    Freebsd,
    Windows,
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
    pub const fn display_string(self) -> &'static str {
        match self {
            Self::Mac => "macOS",
            Self::Linux => "Linux",
            Self::Freebsd => "FreeBSD",
            Self::Windows => "Windows",
            Self::Wasm => "WASM",
        }
    }

    /// same format as `process.platform`
    pub const fn name_string(self) -> &'static str {
        match self {
            Self::Mac => "darwin",
            Self::Linux => "linux",
            Self::Freebsd => "freebsd",
            Self::Windows => "win32",
            Self::Wasm => "wasm",
        }
    }

    pub const fn std_os_tag(self) -> StdOsTag {
        match self {
            Self::Mac => StdOsTag::Macos,
            Self::Linux => StdOsTag::Linux,
            Self::Freebsd => StdOsTag::Freebsd,
            Self::Windows => StdOsTag::Windows,
            Self::Wasm => unreachable!(),
        }
    }

    /// npm package / release-archive name segment, `@oven/bun-{os}-{arch}`.
    /// Differs from [`name_string`] only on Windows: `"windows"` vs `"win32"`.
    pub const fn npm_name(self) -> &'static str {
        match self {
            Self::Mac => "darwin",
            Self::Linux => "linux",
            Self::Freebsd => "freebsd",
            Self::Windows => "windows",
            Self::Wasm => "wasm",
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

/// `process.platform`-style name for the host OS (`"win32"` on Windows).
/// NB: Android targets resolve to `"linux"` here — for the user-facing
/// `"android"` string see `bun_core::Global::os_name`.
pub const OS_NAME_NODE: &str = OS.name_string();
/// npm-package / release-archive segment for the host OS (`"windows"` on Windows).
pub const OS_NAME_NPM: &str = OS.npm_name();

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
    // `[u8]::split_at` and `str::from_utf8` are both `const` on stable, so the
    // sub-slice + UTF-8 check happens entirely at compile time without raw
    // pointer arithmetic.
    //
    // ALLOWED `core::str::from_utf8`: this is the ONE permitted call site in
    // the codebase. simdutf is the runtime validator (`bun_core::strings::
    // {is_valid_utf8, str_utf8}`); `const fn` cannot call FFI, and this body
    // const-evals at compile time only (git-SHA slicing).
    let (head, _) = s.as_bytes().split_at(end);
    let (_, sub) = head.split_at(start);
    match core::str::from_utf8(sub) {
        Ok(s) => s,
        // Unreachable for git-SHA inputs (hex ASCII); fail the const-eval if not.
        Err(_) => panic!("const_str_slice: not at a UTF-8 boundary"),
    }
}

// ported from: src/bun_core/env.zig
