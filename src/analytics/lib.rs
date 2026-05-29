use core::fmt;
use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::OnceLock;

use bun_core::env_var;
use bun_semver as semver;

use crate::schema::analytics;

#[cfg(target_os = "macos")]
use bun_core::slice_to_nul;

// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum TriState {
    Yes = 0,
    No = 1,
    Unknown = 2,
}

impl TriState {
    #[inline]
    const fn from_u8(v: u8) -> Self {
        match v {
            0 => TriState::Yes,
            1 => TriState::No,
            _ => TriState::Unknown,
        }
    }
}

// Zig: `pub var enabled: enum { yes, no, unknown } = .unknown;`
static ENABLED: AtomicU8 = AtomicU8::new(TriState::Unknown as u8);

pub(crate) fn enabled() -> TriState {
    TriState::from_u8(ENABLED.load(Ordering::Relaxed))
}
pub fn set_enabled(v: TriState) {
    ENABLED.store(v as u8, Ordering::Relaxed);
}

pub fn is_enabled() -> bool {
    match enabled() {
        TriState::Yes => true,
        TriState::No => false,
        TriState::Unknown => {
            let detected = 'detect: {
                // PORT NOTE: `env_var::*.get()` returns `Option<ValueType>` in
                // the Rust port even when a default exists; `DO_NOT_TRACK` has
                // `default: false` so `.unwrap_or(false)` matches Zig semantics.
                if env_var::DO_NOT_TRACK.get().unwrap_or(false) {
                    break 'detect TriState::No;
                }
                if env_var::HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET
                    .get()
                    .is_some()
                {
                    break 'detect TriState::No;
                }
                TriState::Yes
            };
            set_enabled(detected);
            debug_assert!(matches!(enabled(), TriState::Yes | TriState::No));
            enabled() == TriState::Yes
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Features
// ──────────────────────────────────────────────────────────────────────────

pub mod features {
    use super::*;

    pub(crate) static BUILTIN_MODULES: bun_core::Mutex<std::collections::BTreeSet<&'static str>> =
        bun_core::Mutex::new(std::collections::BTreeSet::new());
    // PORT NOTE: Zig used a plain mutable global; wrapped in a Mutex here
    // because the set is not a single atomic word.

    macro_rules! define_features {
        ( $( $(#[$doc:meta])* $idx:literal => ($ident:ident, $name:literal) ),* $(,)? ) => {
            $(
                $(#[$doc])*
                #[allow(non_upper_case_globals)]
                pub static $ident: AtomicUsize = AtomicUsize::new(0);
            )*

            // Zig: `validateFeatureName(decl.name)` per entry at comptime.
            $(
                const _: () = assert!(
                    super::validate_feature_name($name.as_bytes()),
                    concat!("Invalid feature name: ", $name),
                );
            )*

            /// Zig: `pub const packed_features_list = brk: { ... }`
            pub const PACKED_FEATURES_LIST: &[&str] = &[ $( $name ),* ];

            ::bitflags::bitflags! {
                #[repr(transparent)]
                #[derive(Default, Copy, Clone, PartialEq, Eq)]
                pub struct PackedFeatures: u64 {
                    $( const $ident = 1u64 << $idx; )*
                }
            }
            const _: () = assert!(
                PACKED_FEATURES_LIST.len() <= 64,
                "PackedFeatures backing integer is u64"
            );
            // Dense-index check: every bit < len() is set exactly once.
            const _: () = assert!(
                PackedFeatures::all().bits()
                    == if PACKED_FEATURES_LIST.len() == 64 {
                        u64::MAX
                    } else {
                        (1u64 << PACKED_FEATURES_LIST.len()) - 1
                    },
                "feature indices must be dense 0..N with no gaps or duplicates"
            );

            /// Zig: `pub fn packedFeatures() PackedFeatures`
            pub fn packed_features() -> PackedFeatures {
                let mut bits = PackedFeatures::empty();
                $(
                    if $ident.load(Ordering::Relaxed) > 0 {
                        bits |= PackedFeatures::$ident;
                    }
                )*
                bits
            }

            pub fn formatter() -> Formatter {
                Formatter {}
            }

            pub struct Formatter;

            impl fmt::Display for Formatter {
                fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
                    let mut is_first_feature = true;
                    $(
                        {
                            let count = $ident.load(Ordering::Relaxed);
                            if count > 0 {
                                if is_first_feature {
                                    writer.write_str("Features: ")?;
                                    is_first_feature = false;
                                }
                                writer.write_str($name)?;
                                if count > 1 {
                                    write!(writer, "({}) ", count)?;
                                } else {
                                    writer.write_str(" ")?;
                                }
                            }
                        }
                    )*
                    if !is_first_feature {
                        writer.write_str("\n")?;
                    }

                    // See BUILTIN_MODULES above — stores `&'static str` names
                    // directly (cyclebreak), so no `@tagName` conversion needed.
                    {
                        let builtins = BUILTIN_MODULES.lock();
                        let mut iter = builtins.iter();
                        if let Some(first) = iter.next() {
                            writer.write_str("Builtins: \"")?;
                            writer.write_str(first)?;
                            writer.write_str("\" ")?;

                            for key in iter {
                                writer.write_str("\"")?;
                                writer.write_str(key)?;
                                writer.write_str("\" ")?;
                            }

                            writer.write_str("\n")?;
                        }
                    }
                    Ok(())
                }
            }
        };
    }

    define_features! {
        0 => (bun_stderr, "Bun.stderr"),
        1 => (bun_stdin, "Bun.stdin"),
        2 => (bun_stdout, "Bun.stdout"),
        3 => (web_socket, "WebSocket"),
        4 => (abort_signal, "abort_signal"),
        5 => (binlinks, "binlinks"),
        6 => (bunfig, "bunfig"),
        7 => (define, "define"),
        8 => (dotenv, "dotenv"),
        9 => (debugger, "debugger"),
        10 => (external, "external"),
        11 => (extracted_packages, "extracted_packages"),
        12 => (fetch, "fetch"),
        13 => (git_dependencies, "git_dependencies"),
        14 => (html_rewriter, "html_rewriter"),
        /// TCP server from `Bun.listen`
        15 => (tcp_server, "tcp_server"),
        /// TLS server from `Bun.listen`
        16 => (tls_server, "tls_server"),
        17 => (http_server, "http_server"),
        18 => (https_server, "https_server"),
        19 => (http_client_proxy, "http_client_proxy"),
        /// Set right before JSC::initialize is called
        20 => (jsc, "jsc"),
        /// Set when bake.DevServer is initialized
        21 => (dev_server, "dev_server"),
        22 => (lifecycle_scripts, "lifecycle_scripts"),
        23 => (loaders, "loaders"),
        24 => (lockfile_migration_from_package_lock, "lockfile_migration_from_package_lock"),
        25 => (text_lockfile, "text_lockfile"),
        26 => (isolated_bun_install, "isolated_bun_install"),
        27 => (hoisted_bun_install, "hoisted_bun_install"),
        28 => (macros, "macros"),
        29 => (no_avx2, "no_avx2"),
        30 => (no_avx, "no_avx"),
        31 => (shell, "shell"),
        32 => (spawn, "spawn"),
        33 => (standalone_executable, "standalone_executable"),
        34 => (standalone_shell, "standalone_shell"),
        /// Set when invoking a todo panic
        35 => (todo_panic, "todo_panic"),
        36 => (transpiler_cache, "transpiler_cache"),
        37 => (tsconfig, "tsconfig"),
        38 => (tsconfig_paths, "tsconfig_paths"),
        39 => (virtual_modules, "virtual_modules"),
        40 => (workers_spawned, "workers_spawned"),
        41 => (workers_terminated, "workers_terminated"),
        #[unsafe(export_name = "Bun__napi_module_register_count")]
        42 => (napi_module_register, "napi_module_register"),
        #[unsafe(export_name = "Bun__process_dlopen_count")]
        43 => (process_dlopen, "process_dlopen"),
        44 => (postgres_connections, "postgres_connections"),
        45 => (s3, "s3"),
        46 => (valkey, "valkey"),
        47 => (csrf_verify, "csrf_verify"),
        48 => (csrf_generate, "csrf_generate"),
        49 => (unsupported_uv_function, "unsupported_uv_function"),
        50 => (exited, "exited"),
        51 => (yarn_migration, "yarn_migration"),
        52 => (pnpm_migration, "pnpm_migration"),
        53 => (yaml_parse, "yaml_parse"),
        54 => (cpu_profile, "cpu_profile"),
        #[unsafe(export_name = "Bun__Feature__heap_snapshot")]
        55 => (heap_snapshot, "heap_snapshot"),
        #[unsafe(export_name = "Bun__Feature__webview_chrome")]
        56 => (webview_chrome, "webview_chrome"),
        #[unsafe(export_name = "Bun__Feature__webview_webkit")]
        57 => (webview_webkit, "webview_webkit"),
    }
}

// Re-exports to mirror Zig's `Features.packedFeatures()` etc. at module scope.
pub use features::{
    Formatter as FeaturesFormatter, PACKED_FEATURES_LIST, PackedFeatures, packed_features,
};

/// Zig: `pub fn validateFeatureName(name: []const u8) void` (comptime-only).
/// In Rust this is enforced at the macro definition site; kept as a `const fn`
/// for documentation / debug assertions.
pub(crate) const fn validate_feature_name(name: &[u8]) -> bool {
    if name.len() > 64 {
        return false;
    }
    let mut i = 0;
    while i < name.len() {
        match name[i] {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'.' | b':' | b'-' => {}
            _ => return false,
        }
        i += 1;
    }
    true
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[allow(non_camel_case_types)]
pub enum EventName {
    bundle_success,
    bundle_fail,
    bundle_start,
    http_start,
    http_build,
}

const PLATFORM_ARCH: analytics::Architecture = {
    #[cfg(target_arch = "aarch64")]
    {
        analytics::Architecture::Arm
    }
    #[cfg(target_arch = "x86_64")]
    {
        analytics::Architecture::X64
    }
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    {
        analytics::Architecture::None
    }
};

// ──────────────────────────────────────────────────────────────────────────
// GenerateHeader
// ──────────────────────────────────────────────────────────────────────────

// TODO: move this code somewhere more appropriate, and remove it from "analytics"
// The following code is not currently even used for analytics, just feature-detection
// in order to determine if certain APIs are usable.
pub mod generate_header {
    use super::*;

    pub mod generate_platform {
        use super::*;

        pub use analytics::Platform;

        // ──────────────────────────────────────────────────────────────────
        // macOS
        // ──────────────────────────────────────────────────────────────────

        #[cfg(target_os = "macos")]
        static OSVERSION_NAME: OnceLock<[u8; 32]> = OnceLock::new();

        #[cfg(target_os = "macos")]
        fn for_mac() -> analytics::Platform {
            let buf: &'static [u8; 32] = OSVERSION_NAME.get_or_init(|| {
                let mut name = [0u8; 32];
                let mut len: usize = name.len() - 1;
                // this previously used "kern.osrelease", which was the darwin xnu kernel version
                // That is less useful than "kern.osproductversion", which is the macOS version
                // SAFETY: FFI call; buffer and len are valid for `len` bytes.
                let rc = unsafe {
                    libc::sysctlbyname(
                        c"kern.osproductversion".as_ptr(),
                        name.as_mut_ptr().cast(),
                        &raw mut len,
                        core::ptr::null_mut(),
                        0,
                    )
                };
                if rc == -1 { [0u8; 32] } else { name }
            });

            analytics::Platform {
                os: analytics::OperatingSystem::Macos,
                version: slice_to_nul(&buf[..]),
                arch: PLATFORM_ARCH,
            }
        }

        // ──────────────────────────────────────────────────────────────────
        // Linux / Android
        // ──────────────────────────────────────────────────────────────────

        // ──────────────────────────────────────────────────────────────────
        // Platform OnceLock
        // ──────────────────────────────────────────────────────────────────

        static PLATFORM_: OnceLock<analytics::Platform> = OnceLock::new();

        pub fn for_os() -> analytics::Platform {
            *PLATFORM_.get_or_init(|| {
                #[cfg(target_os = "macos")]
                {
                    return for_mac();
                }
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    return for_linux();
                }
                #[cfg(target_os = "freebsd")]
                {
                    return for_freebsd();
                }
                #[cfg(windows)]
                {
                    return Platform {
                        os: analytics::OperatingSystem::Windows,
                        version: &[],
                        arch: PLATFORM_ARCH,
                    };
                }
                #[cfg(not(any(
                    target_os = "macos",
                    target_os = "linux",
                    target_os = "android",
                    target_os = "freebsd",
                    windows
                )))]
                {
                    Platform {
                        os: analytics::OperatingSystem::None,
                        version: &[],
                        arch: PLATFORM_ARCH,
                    }
                }
            })
        }

        // ──────────────────────────────────────────────────────────────────
        // macOS sendmsg_x / recvmsg_x feature gate
        // ──────────────────────────────────────────────────────────────────

        // On macOS 13, tests that use sendmsg_x or recvmsg_x hang.
        #[cfg(target_os = "macos")]
        static USE_MSGX_ON_MACOS_14_OR_LATER: OnceLock<bool> = OnceLock::new();

        #[cfg(target_os = "macos")]
        fn detect_use_msgx_on_macos_14_or_later() -> bool {
            let version = semver::Version::parse_utf8(for_os().version);
            version.valid && version.version.max().major >= 14
        }

        #[unsafe(no_mangle)]
        pub(crate) extern "C" fn Bun__doesMacOSVersionSupportSendRecvMsgX() -> i32 {
            #[cfg(not(target_os = "macos"))]
            {
                // this should not be used on non-mac platforms.
                0
            }
            #[cfg(target_os = "macos")]
            {
                *USE_MSGX_ON_MACOS_14_OR_LATER.get_or_init(detect_use_msgx_on_macos_14_or_later)
                    as i32
            }
        }

        // ──────────────────────────────────────────────────────────────────
        // Linux kernel version
        // ──────────────────────────────────────────────────────────────────

        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub fn kernel_version() -> semver::Version {
            let v = bun_core::linux_kernel_version();
            semver::Version {
                major: u64::from(v.major),
                minor: u64::from(v.minor),
                patch: u64::from(v.patch),
                ..Default::default()
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        pub fn kernel_version() -> semver::Version {
            // Zig: @compileError("This function is only implemented on Linux")
            unreachable!("kernel_version() is only implemented on Linux");
        }

        #[unsafe(no_mangle)]
        pub(crate) extern "C" fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> i32 {
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            {
                0
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // https://man.archlinux.org/man/epoll_pwait2.2.en#HISTORY
                let min_epoll_pwait2 = semver::Version {
                    major: 5,
                    minor: 11,
                    patch: 0,
                    ..Default::default()
                };

                match kernel_version().order(min_epoll_pwait2, b"", b"") {
                    core::cmp::Ordering::Greater => 1,
                    core::cmp::Ordering::Equal => 1,
                    core::cmp::Ordering::Less => 0,
                }
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        fn for_linux() -> analytics::Platform {
            // Confusingly, the "release" tends to contain the kernel version much more frequently than the "version" field.
            let release: &'static [u8] =
                bun_core::ffi::c_field_bytes(&bun_core::ffi::cached_uname().release);

            #[cfg(target_os = "android")]
            {
                return analytics::Platform {
                    os: analytics::OperatingSystem::Android,
                    version: release,
                    arch: PLATFORM_ARCH,
                };
            }

            #[cfg(not(target_os = "android"))]
            {
                // Linux DESKTOP-P4LCIEM 5.10.16.3-microsoft-standard-WSL2 #1 SMP Fri Apr 2 22:23:49 UTC 2021 x86_64 x86_64 x86_64 GNU/Linux
                if bun_core::strings::index_of(release, b"microsoft").is_some() {
                    return analytics::Platform {
                        os: analytics::OperatingSystem::Wsl,
                        version: release,
                        arch: PLATFORM_ARCH,
                    };
                }

                analytics::Platform {
                    os: analytics::OperatingSystem::Linux,
                    version: release,
                    arch: PLATFORM_ARCH,
                }
            }
        }

        // ──────────────────────────────────────────────────────────────────
        // FreeBSD
        // ──────────────────────────────────────────────────────────────────

        // Zig std's `std.c.utsname` has no FreeBSD branch; use translate-c's.
        // PORT NOTE: Rust's `libc` crate does provide `utsname`/`uname` on
        // FreeBSD, so the translate-c indirection is unnecessary here.
        #[cfg(target_os = "freebsd")]
        fn for_freebsd() -> analytics::Platform {
            let name = bun_core::ffi::cached_uname();
            analytics::Platform {
                os: analytics::OperatingSystem::Freebsd,
                version: bun_core::ffi::c_field_bytes(&name.release),
                arch: PLATFORM_ARCH,
            }
        }
    }
}

pub use generate_header as GenerateHeader;

pub mod schema;
pub use schema::{BufReader, Reader, SchemaInt};

// ported from: src/analytics/analytics.zig
