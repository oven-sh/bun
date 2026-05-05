use core::fmt;
use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::Once;

use enumset::EnumSet;

use bun_core::env_var;
use bun_semver as semver;
use bun_str::slice_to_nul;

use crate::schema::analytics;

// ──────────────────────────────────────────────────────────────────────────

/// Enables analytics. This is used by:
/// - crash_handler's `report` function to anonymously report crashes
///
/// Since this field can be `Unknown`, it makes more sense to call `is_enabled`
/// instead of processing this field directly.
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
// Zig: `pub var is_ci: enum { yes, no, unknown } = .unknown;`
static IS_CI: AtomicU8 = AtomicU8::new(TriState::Unknown as u8);

pub fn enabled() -> TriState {
    TriState::from_u8(ENABLED.load(Ordering::Relaxed))
}
pub fn set_enabled(v: TriState) {
    ENABLED.store(v as u8, Ordering::Relaxed);
}
pub fn is_ci() -> TriState {
    TriState::from_u8(IS_CI.load(Ordering::Relaxed))
}
pub fn set_is_ci(v: TriState) {
    IS_CI.store(v as u8, Ordering::Relaxed);
}

pub fn is_enabled() -> bool {
    match enabled() {
        TriState::Yes => true,
        TriState::No => false,
        TriState::Unknown => {
            let detected = 'detect: {
                if env_var::DO_NOT_TRACK.get() {
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

/// This answers, "What parts of bun are people actually using?"
///
/// PORT NOTE: In Zig this is a `struct` used purely as a namespace of `pub var`
/// decls, iterated via `@typeInfo` reflection. Rust has no decl reflection, so
/// the feature list is declared once via `define_features!` and that macro
/// generates the statics, `PACKED_FEATURES_LIST`, `PackedFeatures`,
/// `packed_features()`, and the `Display` body.
pub mod features {
    use super::*;

    // TODO(port): `bun_options_types::HardcodedModule` must derive
    // `enumset::EnumSetType` for this to type-check.
    // TYPE_ONLY(b0): moved from `bun_jsc::module_loader` → `bun_options_types`
    // (move-in pass adds the enum def there).
    pub static BUILTIN_MODULES: parking_lot::Mutex<
        EnumSet<bun_options_types::HardcodedModule>,
    > = parking_lot::const_mutex(EnumSet::empty());
    // PORT NOTE: Zig used a plain mutable global; wrapped in a Mutex here
    // because `EnumSet` is not a single atomic word for large enums.

    macro_rules! define_features {
        ( $( $(#[$doc:meta])* ($ident:ident, $name:literal) ),* $(,)? ) => {
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
                /// Zig: `pub const PackedFeatures = @Type(.{ .@"struct" = .{ .layout = .@"packed", .backing_integer = u64, ... } })`
                /// All fields are `bool` → bitflags over u64.
                #[repr(transparent)]
                #[derive(Default, Copy, Clone, PartialEq, Eq)]
                pub struct PackedFeatures: u64 {
                    $( const $ident = 1 << ${index()}; )*
                }
            }
            // TODO(port): `${index()}` requires `#![feature(macro_metavar_expr)]`
            // (nightly). If Phase B is on stable, replace with a hand-written
            // `const` table or a small proc-macro.
            const _: () = assert!(
                PACKED_FEATURES_LIST.len() <= 64,
                "PackedFeatures backing integer is u64"
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

                    let builtins = BUILTIN_MODULES.lock();
                    let mut iter = builtins.iter();
                    if let Some(first) = iter.next() {
                        writer.write_str("Builtins: \"")?;
                        writer.write_str(<&'static str>::from(first))?;
                        writer.write_str("\" ")?;

                        while let Some(key) = iter.next() {
                            writer.write_str("\"")?;
                            writer.write_str(<&'static str>::from(key))?;
                            writer.write_str("\" ")?;
                        }

                        writer.write_str("\n")?;
                    }
                    Ok(())
                }
            }
        };
    }

    // PORT NOTE: Zig identifiers `@"Bun.stderr"` etc. cannot be Rust idents;
    // renamed to `bun_stderr` etc. The string literal preserves the original
    // name for output / `PACKED_FEATURES_LIST` (matches `@tagName` semantics).
    define_features! {
        (bun_stderr, "Bun.stderr"),
        (bun_stdin, "Bun.stdin"),
        (bun_stdout, "Bun.stdout"),
        (web_socket, "WebSocket"),
        (abort_signal, "abort_signal"),
        (binlinks, "binlinks"),
        (bunfig, "bunfig"),
        (define, "define"),
        (dotenv, "dotenv"),
        (debugger, "debugger"),
        (external, "external"),
        (extracted_packages, "extracted_packages"),
        (fetch, "fetch"),
        (git_dependencies, "git_dependencies"),
        (html_rewriter, "html_rewriter"),
        /// TCP server from `Bun.listen`
        (tcp_server, "tcp_server"),
        /// TLS server from `Bun.listen`
        (tls_server, "tls_server"),
        (http_server, "http_server"),
        (https_server, "https_server"),
        (http_client_proxy, "http_client_proxy"),
        /// Set right before JSC::initialize is called
        (jsc, "jsc"),
        /// Set when bake.DevServer is initialized
        (dev_server, "dev_server"),
        (lifecycle_scripts, "lifecycle_scripts"),
        (loaders, "loaders"),
        (lockfile_migration_from_package_lock, "lockfile_migration_from_package_lock"),
        (text_lockfile, "text_lockfile"),
        (isolated_bun_install, "isolated_bun_install"),
        (hoisted_bun_install, "hoisted_bun_install"),
        (macros, "macros"),
        (no_avx2, "no_avx2"),
        (no_avx, "no_avx"),
        (shell, "shell"),
        (spawn, "spawn"),
        (standalone_executable, "standalone_executable"),
        (standalone_shell, "standalone_shell"),
        /// Set when invoking a todo panic
        (todo_panic, "todo_panic"),
        (transpiler_cache, "transpiler_cache"),
        (tsconfig, "tsconfig"),
        (tsconfig_paths, "tsconfig_paths"),
        (virtual_modules, "virtual_modules"),
        (workers_spawned, "workers_spawned"),
        (workers_terminated, "workers_terminated"),
        #[unsafe(export_name = "Bun__napi_module_register_count")]
        (napi_module_register, "napi_module_register"),
        #[unsafe(export_name = "Bun__process_dlopen_count")]
        (process_dlopen, "process_dlopen"),
        (postgres_connections, "postgres_connections"),
        (s3, "s3"),
        (valkey, "valkey"),
        (csrf_verify, "csrf_verify"),
        (csrf_generate, "csrf_generate"),
        (unsupported_uv_function, "unsupported_uv_function"),
        (exited, "exited"),
        (yarn_migration, "yarn_migration"),
        (pnpm_migration, "pnpm_migration"),
        (yaml_parse, "yaml_parse"),
        (cpu_profile, "cpu_profile"),
        #[unsafe(export_name = "Bun__Feature__heap_snapshot")]
        (heap_snapshot, "heap_snapshot"),
        #[unsafe(export_name = "Bun__Feature__webview_chrome")]
        (webview_chrome, "webview_chrome"),
        #[unsafe(export_name = "Bun__Feature__webview_webkit")]
        (webview_webkit, "webview_webkit"),
    }

    // Zig: `comptime { @export(&napi_module_register, .{ .name = "Bun__napi_module_register_count" }); ... }`
    // PORT NOTE: C++ declares these as `extern "C" size_t Bun__...;` and
    // reads/increments the value directly, so the exported symbol must BE the
    // `usize` storage (not a pointer to it). `AtomicUsize` is `#[repr(C)]
    // usize`-layout-compatible. Handled via `#[unsafe(export_name = "...")]`
    // on the canonical statics inside `define_features!` above — Rust cannot
    // alias-export a static under a second symbol name, so the export name is
    // attached to the single definition.
    // TODO(port): if `meta` fragment rejects `unsafe(export_name = ...)` on
    // stable, split the macro arm or use a proc-macro in Phase B.
}

// Re-exports to mirror Zig's `Features.packedFeatures()` etc. at module scope.
pub use features::{packed_features, Formatter as FeaturesFormatter, PackedFeatures, PACKED_FEATURES_LIST};

/// Zig: `pub fn validateFeatureName(name: []const u8) void` (comptime-only).
/// In Rust this is enforced at the macro definition site; kept as a `const fn`
/// for documentation / debug assertions.
pub const fn validate_feature_name(name: &[u8]) -> bool {
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
pub enum EventName {
    bundle_success,
    bundle_fail,
    bundle_start,
    http_start,
    http_build,
}

// Zig: `var random: std.rand.DefaultPrng = undefined;`
// TODO(port): unused in this file; keep a placeholder for parity.
// PERF(port): Zig left this uninitialized; Rust requires init.
#[allow(dead_code)]
static RANDOM: parking_lot::Mutex<Option<bun_core::rand::DefaultPrng>> =
    parking_lot::const_mutex(None);

#[cfg(target_arch = "aarch64")]
const PLATFORM_ARCH: analytics::Architecture = analytics::Architecture::arm;
#[cfg(not(target_arch = "aarch64"))]
const PLATFORM_ARCH: analytics::Architecture = analytics::Architecture::x64;

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
        use core::ffi::c_int;

        pub use analytics::Platform;

        static mut OSVERSION_NAME: [u8; 32] = [0; 32];

        #[cfg(target_os = "macos")]
        fn for_mac() -> analytics::Platform {
            // SAFETY: only called under RUN_ONCE; single-threaded init.
            unsafe {
                OSVERSION_NAME.fill(0);
            }

            let mut platform = analytics::Platform {
                os: analytics::OperatingSystem::macos,
                version: &[],
                arch: PLATFORM_ARCH,
            };
            // SAFETY: see above.
            let mut len: usize = unsafe { OSVERSION_NAME.len() } - 1;
            // this previously used "kern.osrelease", which was the darwin xnu kernel version
            // That is less useful than "kern.osproductversion", which is the macOS version
            // SAFETY: FFI call; buffer and len are valid.
            let rc: c_int = unsafe {
                bun_sys::darwin::sysctlbyname(
                    c"kern.osproductversion".as_ptr(),
                    OSVERSION_NAME.as_mut_ptr().cast(),
                    &mut len,
                    core::ptr::null_mut(),
                    0,
                )
            };
            if rc == -1 {
                return platform;
            }

            // SAFETY: buffer initialized above; sysctlbyname NUL-terminates within len.
            platform.version = slice_to_nul(unsafe { &OSVERSION_NAME[..] });
            platform
        }

        // Zig: `pub var linux_os_name: std.c.utsname = undefined;`
        // PORT NOTE: Zig's `Environment.isLinux` is true on Android (it checks
        // the kernel, not the libc target), so all Linux-gated items below are
        // `any(linux, android)` — `for_linux()` itself branches on Android.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub static mut LINUX_OS_NAME: bun_sys::linux::utsname =
            // SAFETY: all-zero is a valid utsname (POD C struct).
            unsafe { core::mem::zeroed() };

        static mut PLATFORM_: analytics::Platform = analytics::Platform {
            os: analytics::OperatingSystem::linux, // overwritten before read
            version: &[],
            arch: PLATFORM_ARCH,
        };

        #[cfg(any(target_os = "linux", target_os = "android"))]
        static mut LINUX_KERNEL_VERSION: semver::Version = semver::Version::ZERO;
        // TODO(port): `semver::Version` needs a `const ZERO` / `const fn default()`.

        static RUN_ONCE: Once = Once::new();

        fn run_once_init() {
            #[cfg(target_os = "macos")]
            {
                // SAFETY: guarded by RUN_ONCE.
                unsafe { PLATFORM_ = for_mac() };
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // SAFETY: guarded by RUN_ONCE.
                unsafe {
                    PLATFORM_ = for_linux();

                    let release = slice_to_nul(&LINUX_OS_NAME.release);
                    let sliced_string = semver::SlicedString::init(release, release);
                    let result = semver::Version::parse(sliced_string);
                    LINUX_KERNEL_VERSION = result.version.min();
                }
            }
            #[cfg(target_os = "freebsd")]
            {
                // SAFETY: guarded by RUN_ONCE.
                unsafe { PLATFORM_ = for_freebsd() };
            }
            #[cfg(windows)]
            {
                // SAFETY: guarded by RUN_ONCE.
                unsafe {
                    PLATFORM_ = Platform {
                        os: analytics::OperatingSystem::windows,
                        version: &[],
                        arch: PLATFORM_ARCH,
                    };
                }
            }
        }

        pub fn for_os() -> analytics::Platform {
            RUN_ONCE.call_once(run_once_init);
            // SAFETY: PLATFORM_ is only mutated under RUN_ONCE; after call_once
            // returns it is effectively immutable.
            unsafe { PLATFORM_.clone() }
        }

        // On macOS 13, tests that use sendmsg_x or recvmsg_x hang.
        static mut USE_MSGX_ON_MACOS_14_OR_LATER: bool = false;
        static DETECT_USE_MSGX_ONCE: Once = Once::new();

        fn detect_use_msgx_on_macos_14_or_later() {
            let version = semver::Version::parse_utf8(for_os().version);
            // SAFETY: only called under DETECT_USE_MSGX_ONCE.
            unsafe {
                USE_MSGX_ON_MACOS_14_OR_LATER =
                    version.valid && version.version.max().major >= 14;
            }
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn Bun__doesMacOSVersionSupportSendRecvMsgX() -> i32 {
            #[cfg(not(target_os = "macos"))]
            {
                // this should not be used on non-mac platforms.
                return 0;
            }
            #[cfg(target_os = "macos")]
            {
                DETECT_USE_MSGX_ONCE.call_once(detect_use_msgx_on_macos_14_or_later);
                // SAFETY: written once under DETECT_USE_MSGX_ONCE.
                unsafe { USE_MSGX_ON_MACOS_14_OR_LATER as i32 }
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub fn kernel_version() -> semver::Version {
            let _ = for_os();
            // SAFETY: LINUX_KERNEL_VERSION written once under RUN_ONCE (via for_os).
            unsafe { LINUX_KERNEL_VERSION }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        pub fn kernel_version() -> semver::Version {
            // Zig: @compileError("This function is only implemented on Linux")
            unreachable!("kernel_version() is only implemented on Linux");
        }

        #[unsafe(no_mangle)]
        pub extern "C" fn Bun__isEpollPwait2SupportedOnLinuxKernel() -> i32 {
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            {
                return 0;
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

                match kernel_version().order(&min_epoll_pwait2, b"", b"") {
                    core::cmp::Ordering::Greater => 1,
                    core::cmp::Ordering::Equal => 1,
                    core::cmp::Ordering::Less => 0,
                }
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        fn for_linux() -> analytics::Platform {
            // SAFETY: only called under RUN_ONCE; LINUX_OS_NAME is POD.
            unsafe {
                LINUX_OS_NAME = core::mem::zeroed();
                let _ = bun_sys::linux::uname(&mut LINUX_OS_NAME);
            }

            // Confusingly, the "release" tends to contain the kernel version much more frequently than the "version" field.
            // SAFETY: LINUX_OS_NAME.release is a NUL-terminated C array filled by uname().
            let release: &'static [u8] = unsafe { slice_to_nul(&LINUX_OS_NAME.release) };

            #[cfg(target_os = "android")]
            {
                return analytics::Platform {
                    os: analytics::OperatingSystem::android,
                    version: release,
                    arch: PLATFORM_ARCH,
                };
            }

            // Linux DESKTOP-P4LCIEM 5.10.16.3-microsoft-standard-WSL2 #1 SMP Fri Apr 2 22:23:49 UTC 2021 x86_64 x86_64 x86_64 GNU/Linux
            if bun_str::strings::index_of(release, b"microsoft").is_some() {
                return analytics::Platform {
                    os: analytics::OperatingSystem::wsl,
                    version: release,
                    arch: PLATFORM_ARCH,
                };
            }

            analytics::Platform {
                os: analytics::OperatingSystem::linux,
                version: release,
                arch: PLATFORM_ARCH,
            }
        }

        // Zig std's `std.c.utsname` has no FreeBSD branch; use translate-c's.
        #[cfg(target_os = "freebsd")]
        static mut FREEBSD_OS_NAME: bun_sys::c::struct_utsname =
            // SAFETY: all-zero is a valid struct_utsname (POD C struct).
            unsafe { core::mem::zeroed() };

        #[cfg(target_os = "freebsd")]
        fn for_freebsd() -> analytics::Platform {
            // SAFETY: only called under RUN_ONCE.
            unsafe {
                FREEBSD_OS_NAME = core::mem::zeroed();
                let _ = bun_sys::c::uname(&mut FREEBSD_OS_NAME);
            }
            analytics::Platform {
                os: analytics::OperatingSystem::freebsd,
                // SAFETY: filled by uname() above.
                version: unsafe { slice_to_nul(&FREEBSD_OS_NAME.release) },
                arch: PLATFORM_ARCH,
            }
        }
    }
}

pub use generate_header as GenerateHeader;

pub mod schema;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/analytics/analytics.zig (380 lines)
//   confidence: medium
//   todos:      5
//   notes:      Zig @typeInfo decl-reflection replaced by define_features! macro (uses nightly macro_metavar_expr for bit indices); @export of feature counters done via #[export_name] on the canonical statics; Linux cfgs include Android (Environment.isLinux is kernel-based); static mut globals guarded by Once mirror Zig's undefined+std.once pattern.
// ──────────────────────────────────────────────────────────────────────────
