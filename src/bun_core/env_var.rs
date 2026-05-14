//! Unified module for controlling and managing environment variables in Bun.
//!
//! This library uses metaprogramming to achieve type-safe accessors for environment variables.
//! Calling .get() on any of the environment variables will return the correct environment variable
//! type, whether it's a string, unsigned or boolean. This library also caches the environment
//! variables for you, for slightly faster access.
//!
//! If default values are provided, the .get() method is guaranteed not to return a nullable type,
//! whereas if no default is provided, the .get() method will return an optional type.
//!
//! Note that environment variables may fail to parse silently. If they do fail to parse, the
//! default is to show a debug warning and treat them as not set. This behavior can be customized,
//! but environment variables are not meant to be a robust configuration mechanism. If you do think
//! your feature needs more customization, consider using other means. The reason we have decided
//! upon this behavior is to avoid panics due to environment variable pollution.
//!
//! TODO(markovejnovic): It would be neat if this library supported loading floats as
//!                      well as strings, integers and booleans, but for now this will do.
//!
//! TODO(markovejnovic): As this library migrates away from bun.getenvZ, it should return
//!                      NUL-terminated slices, rather than plain slices. Perhaps there should be a
//!                      .getZ() accessor?
//!
//! TODO(markovejnovic): This current implementation kind of does redundant work. Instead of
//!                      scanning envp, and preparing everything on bootup, we lazily load
//!                      everything. This means that we potentially scan through envp a lot of
//!                      times, even though we could only do it once.

// TODO(port): The Zig original uses comptime type-returning functions (`New`, `PlatformSpecificNew`)
// that take comptime string keys + option structs and return a unique type per env var with an
// embedded `static` cache. Rust cannot parameterize a generic type on `&'static str` + a struct
// value in stable, so this port models `New`/`PlatformSpecificNew` as `macro_rules!` that emit a
// module per env var. In Zig the declarations come first and the type-generator fns come last;
// here the macros must be defined (or `#[macro_use]`d) before the declarations. Phase B may move
// the macro definitions into a sibling `env_var_impl.rs` and `#[macro_use]` it to restore Zig
// declaration order in this file.

use core::sync::atomic::{AtomicPtr, AtomicU8, AtomicU64, AtomicUsize, Ordering};

// MOVE_DOWN: bun_core::ZStr → bun_core (move-in pass).
use crate::ZStr;

// ──────────────────────────────────────────────────────────────────────────────
// Declarations
// ──────────────────────────────────────────────────────────────────────────────

new!(pub AGENT: string, "AGENT", {});
new!(pub BUN_AGENT_RULE_DISABLED: boolean, "BUN_AGENT_RULE_DISABLED", { default: false });
new!(pub BUN_COMPILE_TARGET_TARBALL_URL: string, "BUN_COMPILE_TARGET_TARBALL_URL", {});
new!(pub BUN_CONFIG_DISABLE_COPY_FILE_RANGE: boolean, "BUN_CONFIG_DISABLE_COPY_FILE_RANGE", { default: false });
new!(pub BUN_CONFIG_DISABLE_ioctl_ficlonerange: boolean, "BUN_CONFIG_DISABLE_ioctl_ficlonerange", { default: false });
/// TODO(markovejnovic): Legacy usage had the default at 30, even though a the attached comment
/// quoted: Amazon Web Services recommends 5 seconds:
/// https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/jvm-ttl-dns.html
///
/// It's unclear why this was done.
new!(pub BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS: unsigned, "BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS", { default: 30 });
/// Idle timeout for HTTP client sockets (fetch / `bun install`), in seconds.
/// The timer is armed when the socket opens and re-armed on every read/write;
/// if it fires the request fails with `error.Timeout`. Covers the TLS
/// handshake through the response body. 0 disables. See `src/http/lib.rs`.
new!(pub BUN_CONFIG_HTTP_IDLE_TIMEOUT: unsigned, "BUN_CONFIG_HTTP_IDLE_TIMEOUT", { default: 300 });
new!(pub BUN_CRASH_REPORT_URL: string, "BUN_CRASH_REPORT_URL", {});
new!(pub BUN_DEBUG: string, "BUN_DEBUG", {});
new!(pub BUN_DEBUG_ALL: boolean, "BUN_DEBUG_ALL", {});
new!(pub BUN_DEBUG_CSS_ORDER: boolean, "BUN_DEBUG_CSS_ORDER", { default: false });
new!(pub BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: boolean, "BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE", { default: false });
/// Testing hook for `bun build --compile`: force `hostUsesNixStoreInterpreter()`
/// to return true without mutating `/etc/NIXOS` on the shared rootfs. Used by
/// `test/regression/issue/29290.test.ts` to exercise the Nix-host branch.
new!(pub BUN_DEBUG_FORCE_NIX_HOST: boolean, "BUN_DEBUG_FORCE_NIX_HOST", { default: false });
new!(pub BUN_DEBUG_HASH_RANDOM_SEED: unsigned, "BUN_DEBUG_HASH_RANDOM_SEED", { deser: { error_handling: NotSet } });
new!(pub BUN_DEBUG_QUIET_LOGS: boolean, "BUN_DEBUG_QUIET_LOGS", {});
new!(pub BUN_DEBUG_TEST_TEXT_LOCKFILE: boolean, "BUN_DEBUG_TEST_TEXT_LOCKFILE", { default: false });
new!(pub BUN_DEV_SERVER_TEST_RUNNER: string, "BUN_DEV_SERVER_TEST_RUNNER", {});
/// Debug-only: when set, `NumberRenamer` dumps the symbol table before
/// renaming (`src/js_printer/renamer.zig`). Presence-checked, value ignored.
new!(pub BUN_DUMP_SYMBOLS: string, "BUN_DUMP_SYMBOLS", {});
new!(pub BUN_ENABLE_CRASH_REPORTING: boolean, "BUN_ENABLE_CRASH_REPORTING", {});
/// Opt-in: when truthy, Bun watches its original parent pid and exits as soon
/// as that process dies (even if the parent was SIGKILLed and couldn't forward
/// a signal), and on its own clean exit recursively SIGKILLs every descendant
/// so nothing it spawned outlives it. See `src/ParentDeathWatchdog.zig`.
new!(pub BUN_FEATURE_FLAG_NO_ORPHANS: boolean, "BUN_FEATURE_FLAG_NO_ORPHANS", { default: false });
new!(pub BUN_FEATURE_FLAG_DUMP_CODE: string, "BUN_FEATURE_FLAG_DUMP_CODE", {});
/// TODO(markovejnovic): It's unclear why the default here is 100_000, but this was legacy behavior
/// so we'll keep it for now.
new!(pub BUN_INOTIFY_COALESCE_INTERVAL: unsigned, "BUN_INOTIFY_COALESCE_INTERVAL", { default: 100_000 });
new!(pub BUN_INSPECT: string, "BUN_INSPECT", { default: b"" });
new!(pub BUN_INSPECT_CONNECT_TO: string, "BUN_INSPECT_CONNECT_TO", { default: b"" });
new!(pub BUN_INSPECT_PRELOAD: string, "BUN_INSPECT_PRELOAD", {});
new!(pub BUN_INSTALL: string, "BUN_INSTALL", {});
new!(pub BUN_INSTALL_BIN: string, "BUN_INSTALL_BIN", {});
new!(pub BUN_INSTALL_GLOBAL_DIR: string, "BUN_INSTALL_GLOBAL_DIR", {});
/// Minimum response `Content-Length` (in bytes) for `bun install` to
/// stream a tarball directly into libarchive instead of buffering the
/// whole body first. Smaller tarballs stay on the buffered path where
/// the fixed overhead of the resumable state machine isn't worth it.
new!(pub BUN_INSTALL_STREAMING_MIN_SIZE: unsigned, "BUN_INSTALL_STREAMING_MIN_SIZE", { default: 2 * 1024 * 1024 });
new!(pub BUN_NEEDS_PROC_SELF_WORKAROUND: boolean, "BUN_NEEDS_PROC_SELF_WORKAROUND", { default: false });
new!(pub BUN_OPTIONS: string, "BUN_OPTIONS", {});
new!(pub BUN_POSTGRES_SOCKET_MONITOR: string, "BUN_POSTGRES_SOCKET_MONITOR", {});
new!(pub BUN_POSTGRES_SOCKET_MONITOR_READER: string, "BUN_POSTGRES_SOCKET_MONITOR_READER", {});
new!(pub BUN_RUNTIME_TRANSPILER_CACHE_PATH: string, "BUN_RUNTIME_TRANSPILER_CACHE_PATH", {});
new!(pub BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR: boolean, "BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR", { default: false });
new!(pub BUN_TCC_OPTIONS: string, "BUN_TCC_OPTIONS", {});
/// Standard C compiler environment variable for include paths (colon-separated).
/// Used by bun:ffi's TinyCC integration for systems like NixOS.
platform_specific_new!(pub C_INCLUDE_PATH: string, posix = "C_INCLUDE_PATH", windows = None, {});
/// Standard C compiler environment variable for library paths (colon-separated).
/// Used by bun:ffi's TinyCC integration for systems like NixOS.
platform_specific_new!(pub LIBRARY_PATH: string, posix = "LIBRARY_PATH", windows = None, {});
new!(pub BUN_TMPDIR: string, "BUN_TMPDIR", {});
new!(pub BUN_TRACK_LAST_FN_NAME: boolean, "BUN_TRACK_LAST_FN_NAME", { default: false });
new!(pub BUN_TRACY_PATH: string, "BUN_TRACY_PATH", {});
new!(pub BUN_WATCHER_TRACE: string, "BUN_WATCHER_TRACE", {});
new!(pub CI: boolean, "CI", {});
new!(pub CI_COMMIT_SHA: string, "CI_COMMIT_SHA", {});
new!(pub CI_JOB_URL: string, "CI_JOB_URL", {});
new!(pub CLAUDE_CODE_AGENT_RULE_DISABLED: boolean, "CLAUDE_CODE_AGENT_RULE_DISABLED", { default: false });
new!(pub CLAUDECODE: boolean, "CLAUDECODE", { default: false });
new!(pub COLORTERM: string, "COLORTERM", {});
new!(pub CURSOR_AGENT_RULE_DISABLED: boolean, "CURSOR_AGENT_RULE_DISABLED", { default: false });
new!(pub CURSOR_TRACE_ID: boolean, "CURSOR_TRACE_ID", { default: false });
new!(pub DO_NOT_TRACK: boolean, "DO_NOT_TRACK", { default: false });
platform_specific_new!(pub DYLD_ROOT_PATH: string, posix = "DYLD_ROOT_PATH", windows = None, {});
/// TODO(markovejnovic): We should support enums in this library, and force_color's usage is,
/// indeed, an enum. The 80-20 is to make it an unsigned value (which also works well).
new!(pub FORCE_COLOR: unsigned, "FORCE_COLOR", { deser: { error_handling: TruthyCast, empty_string_as: Value(1) } });
platform_specific_new!(pub fpath: string, posix = "fpath", windows = None, {});
new!(pub GIT_SHA: string, "GIT_SHA", {});
new!(pub GITHUB_ACTIONS: boolean, "GITHUB_ACTIONS", { default: false });
new!(pub GITHUB_REPOSITORY: string, "GITHUB_REPOSITORY", {});
new!(pub GITHUB_RUN_ID: string, "GITHUB_RUN_ID", {});
new!(pub GITHUB_SERVER_URL: string, "GITHUB_SERVER_URL", {});
new!(pub GITHUB_SHA: string, "GITHUB_SHA", {});
new!(pub GITHUB_WORKSPACE: string, "GITHUB_WORKSPACE", {});
platform_specific_new!(pub HOME: string, posix = "HOME", windows = "USERPROFILE", {});
new!(pub HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET: string, "HYPERFINE_RANDOMIZED_ENVIRONMENT_OFFSET", {});
new!(pub IS_BUN_AUTO_UPDATE: boolean, "IS_BUN_AUTO_UPDATE", { default: false });
new!(pub JENKINS_URL: string, "JENKINS_URL", {});
/// Dump mimalloc statistics at the end of the process. Note that this is not the same as
/// `MIMALLOC_VERBOSE`, documented here: https://microsoft.github.io/mimalloc/environment.html
new!(pub MI_VERBOSE: boolean, "MI_VERBOSE", { default: false });
new!(pub NO_COLOR: boolean, "NO_COLOR", { default: false });
new!(pub NODE_CHANNEL_FD: string, "NODE_CHANNEL_FD", {});
/// Set by HostProcess.zig when spawning the WebView host subprocess. The
/// child's cli.zig checks this before anything else and hands off to C++
/// Bun__WebView__hostMain. Never returns — no JSC, no VM.
new!(pub BUN_INTERNAL_WEBVIEW_HOST: string, "BUN_INTERNAL_WEBVIEW_HOST", {});
new!(pub NODE_PRESERVE_SYMLINKS_MAIN: boolean, "NODE_PRESERVE_SYMLINKS_MAIN", { default: false });
new!(pub NODE_USE_SYSTEM_CA: boolean, "NODE_USE_SYSTEM_CA", { default: false });
new!(pub npm_lifecycle_event: string, "npm_lifecycle_event", {});
new!(pub PATH: string, "PATH", {});
new!(pub REPL_ID: boolean, "REPL_ID", { default: false });
new!(pub RUNNER_DEBUG: boolean, "RUNNER_DEBUG", { default: false });
platform_specific_new!(pub SDKROOT: string, posix = "SDKROOT", windows = None, {});
platform_specific_new!(pub SHELL: string, posix = "SHELL", windows = None, {});
/// C:\Windows, for example.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
platform_specific_new!(pub SYSTEMROOT: string, posix = None, windows = "SYSTEMROOT", {});
platform_specific_new!(pub TEMP: string, posix = "TEMP", windows = "TEMP", {});
new!(pub TERM: string, "TERM", {});
new!(pub TERM_PROGRAM: string, "TERM_PROGRAM", {});
platform_specific_new!(pub TMP: string, posix = "TMP", windows = "TMP", {});
platform_specific_new!(pub TMPDIR: string, posix = "TMPDIR", windows = "TMPDIR", {});
new!(pub TMUX: string, "TMUX", {});
new!(pub TODIUM: string, "TODIUM", {});
platform_specific_new!(pub USER: string, posix = "USER", windows = "USERNAME", {});
new!(pub WANTS_LOUD: boolean, "WANTS_LOUD", { default: false });
/// The same as system_root.
/// Note: Do not use this variable directly -- use os.zig's implementation instead.
/// TODO(markovejnovic): Perhaps we could add support for aliases in the library, so you could
///                      specify both WINDIR and SYSTEMROOT and the loader would check both?
platform_specific_new!(pub WINDIR: string, posix = None, windows = "WINDIR", {});
/// XDG Base Directory Specification variables.
/// For some reason, legacy usage respected these even on Windows. To avoid compatibility issues,
/// we respect them too.
new!(pub XDG_CACHE_HOME: string, "XDG_CACHE_HOME", {});
new!(pub XDG_CONFIG_HOME: string, "XDG_CONFIG_HOME", {});
new!(pub XDG_DATA_HOME: string, "XDG_DATA_HOME", {});
new!(pub ZDOTDIR: string, "ZDOTDIR", {});

pub mod feature_flag {
    use super::*;

    new_feature_flag!(pub BUN_ASSUME_PERFECT_INCREMENTAL, "BUN_ASSUME_PERFECT_INCREMENTAL", { default: None });
    new_feature_flag!(pub BUN_BE_BUN, "BUN_BE_BUN", {});
    new_feature_flag!(pub BUN_DEBUG_NO_DUMP, "BUN_DEBUG_NO_DUMP", {});
    new_feature_flag!(pub BUN_DESTRUCT_VM_ON_EXIT, "BUN_DESTRUCT_VM_ON_EXIT", {});

    /// Disable "nativeDependencies"
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER, "BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER", {});

    /// Disable "ignoreScripts" in package.json
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS, "BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS", {});

    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG, "BUN_FEATURE_FLAG_DISABLE_ADDRCONFIG", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER, "BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE, "BUN_FEATURE_FLAG_DISABLE_ISOLATION_SOURCE_CACHE", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_DNS_CACHE, "BUN_FEATURE_FLAG_DISABLE_DNS_CACHE", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO, "BUN_FEATURE_FLAG_DISABLE_DNS_CACHE_LIBINFO", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX, "BUN_FEATURE_FLAG_DISABLE_INSTALL_INDEX", {});
    /// Disable streaming tarball extraction in `bun install`. When disabled,
    /// the whole .tgz is buffered in memory before being decompressed and
    /// extracted. Useful for bisecting streaming-specific bugs.
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL, "BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_IO_POOL, "BUN_FEATURE_FLAG_DISABLE_IO_POOL", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_IPV4, "BUN_FEATURE_FLAG_DISABLE_IPV4", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_IPV6, "BUN_FEATURE_FLAG_DISABLE_IPV6", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_MEMFD, "BUN_FEATURE_FLAG_DISABLE_MEMFD", {});
    /// The RedisClient supports auto-pipelining by default. This flag disables that behavior.
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING, "BUN_FEATURE_FLAG_DISABLE_REDIS_AUTO_PIPELINING", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK, "BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK", {});
    new_feature_flag!(pub BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING, "BUN_DISABLE_SLOW_LIFECYCLE_SCRIPT_LOGGING", {});
    new_feature_flag!(pub BUN_DISABLE_SOURCE_CODE_PREVIEW, "BUN_DISABLE_SOURCE_CODE_PREVIEW", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS, "BUN_FEATURE_FLAG_DISABLE_SOURCE_MAPS", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH, "BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING, "BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING", {});
    new_feature_flag!(pub BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW, "BUN_DISABLE_TRANSPILED_SOURCE_CODE_PREVIEW", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE, "BUN_FEATURE_FLAG_DISABLE_UV_FS_COPYFILE", {});
    new_feature_flag!(pub BUN_DUMP_STATE_ON_CRASH, "BUN_DUMP_STATE_ON_CRASH", {});
    new_feature_flag!(pub BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS, "BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE, "BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE", {});
    /// Offer "h2" in the fetch() TLS ALPN list and speak HTTP/2 when the
    /// server selects it. Off by default while the client implementation
    /// matures. `--experimental-http2-fetch` is the CLI equivalent.
    new_feature_flag!(pub BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT, "BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT", {});
    /// Honor `Alt-Svc: h3` from fetch() responses: subsequent requests to the
    /// same origin go over QUIC/HTTP-3 instead of TCP. Off by default while
    /// the client implementation matures. `--experimental-http3-fetch` is the
    /// CLI equivalent.
    new_feature_flag!(pub BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT, "BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP3_CLIENT", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_FORCE_IO_POOL, "BUN_FEATURE_FLAG_FORCE_IO_POOL", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS, "BUN_FEATURE_FLAG_FORCE_WINDOWS_JUNCTIONS", {});
    new_feature_flag!(pub BUN_INSTRUMENTS, "BUN_INSTRUMENTS", {});
    new_feature_flag!(pub BUN_INTERNAL_BUNX_INSTALL, "BUN_INTERNAL_BUNX_INSTALL", {});
    new_feature_flag!(pub BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN, "BUN_INTERNAL_SUPPRESS_CRASH_IN_BUN_RUN", {});
    new_feature_flag!(pub BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT, "BUN_INTERNAL_SUPPRESS_CRASH_ON_NAPI_ABORT", {});
    new_feature_flag!(pub BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF, "BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF", {});
    new_feature_flag!(pub BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB, "BUN_INTERNAL_SUPPRESS_CRASH_ON_UV_STUB", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304, "BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304", {});
    new_feature_flag!(pub BUN_NO_CODESIGN_MACHO_BINARY, "BUN_NO_CODESIGN_MACHO_BINARY", {});
    new_feature_flag!(pub BUN_FEATURE_FLAG_NO_LIBDEFLATE, "BUN_FEATURE_FLAG_NO_LIBDEFLATE", {});
    new_feature_flag!(pub NODE_NO_WARNINGS, "NODE_NO_WARNINGS", {});
    new_feature_flag!(pub BUN_TRACE, "BUN_TRACE", {});
}

// ──────────────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────────────

/// Interface between each of the different EnvVar types and the common logic.
pub(crate) enum CacheOutput<V> {
    /// The environment variable hasn't been loaded yet.
    Unknown,
    /// The environment variable has been loaded but its not set.
    NotSet,
    /// The environment variable is set to a value.
    Value(V),
}

// Zig: `fn CacheConfigurationType(comptime CtorOptionsType: type) type`
pub(crate) struct CacheConfiguration<O> {
    pub var_name: &'static [u8],
    pub opts: O,
}

/// Structure which encodes the different types of environment variables supported.
///
/// This requires the following static members:
///
///   - `ValueType`: The underlying environment variable type if one is set. For
///                              example, a string `$PATH` ought return a `[]const u8` when set.
///   - `Cache`: A struct implementing the following methods:
///       - `get_cached() -> CacheOutput<ValueType>`: Retrieve the cached value of the
///                                                               environment variable, if any.
///       - `deser_and_invalidate(raw_env: Option<&[u8]>) -> Option<ValueType>`
///   - `CtorOptions`: A struct containing the options passed to the constructor of the environment
///                 variable definition.
///
/// This type will communicate with the common logic via the `CacheOutput` type.
pub(crate) mod kind {
    use super::*;

    pub(crate) mod string {
        use super::*;

        pub(crate) type ValueType = &'static [u8];
        pub(crate) type Input = CacheConfiguration<CtorOptions>;
        pub(crate) type Output = CacheOutput<ValueType>;

        #[derive(Clone, Copy)]
        pub(crate) struct CtorOptions {
            pub default: Option<ValueType>,
        }
        impl Default for CtorOptions {
            fn default() -> Self {
                Self { default: None }
            }
        }

        // Zig: `fn Cache(comptime ip: Input) type` — `ip` is unused (`_ = ip;`).
        // Rust: a single Cache struct; per-var uniqueness comes from each var owning its own
        // `static CACHE: Cache`.
        pub(crate) struct Cache {
            ptr_value: AtomicPtr<u8>,
            len_value: AtomicUsize,
        }

        type PointerType = *mut u8; // Zig: ?[*]const u8 — AtomicPtr requires *mut
        type LenType = usize;

        // Zig nested `not_loaded_sentinel` / `not_set_sentinel` constants:
        const NOT_LOADED_PTR: PointerType = core::ptr::null_mut();
        const NOT_LOADED_LEN: LenType = LenType::MAX;
        const NOT_SET_PTR: PointerType = core::ptr::null_mut();
        const NOT_SET_LEN: LenType = LenType::MAX - 1;

        impl Cache {
            pub(crate) const fn new() -> Self {
                Self {
                    ptr_value: AtomicPtr::new(NOT_LOADED_PTR),
                    len_value: AtomicUsize::new(NOT_LOADED_LEN),
                }
            }

            pub(crate) fn get_cached(&self) -> Output {
                let len = self.len_value.load(Ordering::Acquire);

                if len == NOT_LOADED_LEN {
                    return CacheOutput::Unknown;
                }

                if len == NOT_SET_LEN {
                    return CacheOutput::NotSet;
                }

                let ptr = self.ptr_value.load(Ordering::Relaxed);

                // SAFETY: ptr/len were stored together in deser_and_invalidate from a valid
                // &'static [u8] returned by getenv_z (envp memory lives for process lifetime).
                CacheOutput::Value(unsafe { core::slice::from_raw_parts(ptr, len) })
            }

            #[inline]
            pub(crate) fn deser_and_invalidate(
                &self,
                raw_env: Option<&'static [u8]>,
            ) -> Option<ValueType> {
                // The implementation is racy and allows two threads to both set the value at
                // the same time, as long as the value they are setting is the same. This is
                // difficult to write an assertion for since it requires the DEV path take a
                // .swap() path rather than a plain .store().

                if let Some(ev) = raw_env {
                    self.ptr_value
                        .store(ev.as_ptr().cast_mut(), Ordering::Relaxed);
                    self.len_value.store(ev.len(), Ordering::Release);
                } else {
                    self.ptr_value.store(NOT_SET_PTR, Ordering::Relaxed);
                    self.len_value.store(NOT_SET_LEN, Ordering::Release);
                }

                raw_env
            }
        }
    }

    pub(crate) mod boolean {
        use super::*;

        pub(crate) type ValueType = bool;
        pub(crate) type Input = CacheConfiguration<CtorOptions>;
        pub(crate) type Output = CacheOutput<ValueType>;

        #[derive(Clone, Copy)]
        pub(crate) struct CtorOptions {
            pub default: Option<ValueType>,
        }
        impl Default for CtorOptions {
            fn default() -> Self {
                Self { default: None }
            }
        }

        pub(crate) fn string_is_truthy(s: &[u8]) -> bool {
            // Most values are considered truthy, except for "", "0", "false", "no", and "off".
            !crate::strings::eql_any_case_insensitive_ascii(s, &[b"", b"0", b"false", b"no", b"off"])
        }

        // This is a template which ignores its parameter, but is necessary so that a separate
        // Cache type is emitted for every environment variable.
        // (In Rust, per-var statics give us per-var caches without distinct types.)
        pub(crate) struct Cache {
            value: AtomicU8, // StoredType
        }

        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub(crate) enum StoredType {
            Unknown = 0,
            NotSet = 1,
            No = 2,
            Yes = 3,
        }

        impl Cache {
            pub(crate) const fn new() -> Self {
                Self {
                    value: AtomicU8::new(StoredType::Unknown as u8),
                }
            }

            #[inline]
            pub(crate) fn get_cached(&self) -> Output {
                // only ever stored from StoredType discriminants
                let cached: StoredType = match self.value.load(Ordering::Relaxed) {
                    1 => StoredType::NotSet,
                    2 => StoredType::No,
                    3 => StoredType::Yes,
                    _ => StoredType::Unknown,
                };
                match cached {
                    StoredType::Unknown => {
                        crate::hint::cold();
                        CacheOutput::Unknown
                    }
                    StoredType::NotSet => CacheOutput::NotSet,
                    StoredType::No => CacheOutput::Value(false),
                    StoredType::Yes => CacheOutput::Value(true),
                }
            }

            #[inline]
            pub(crate) fn deser_and_invalidate(&self, raw_env: Option<&[u8]>) -> Option<ValueType> {
                let Some(raw_env) = raw_env else {
                    self.value
                        .store(StoredType::NotSet as u8, Ordering::Relaxed);
                    return None;
                };

                let string_is_truthy = string_is_truthy(raw_env);
                self.value.store(
                    if string_is_truthy {
                        StoredType::Yes as u8
                    } else {
                        StoredType::No as u8
                    },
                    Ordering::Relaxed,
                );
                Some(string_is_truthy)
            }
        }
    }

    pub(crate) mod unsigned {
        use super::*;

        pub(crate) type ValueType = u64;
        pub(crate) type Input = CacheConfiguration<CtorOptions>;
        pub(crate) type Output = CacheOutput<ValueType>;

        #[derive(Clone, Copy)]
        pub(crate) struct CtorOptions {
            pub default: Option<ValueType>,
            pub deser: DeserOpts,
        }
        impl CtorOptions {
            pub(crate) const DEFAULT: Self = Self {
                default: None,
                deser: DeserOpts::DEFAULT,
            };
        }
        impl Default for CtorOptions {
            fn default() -> Self {
                Self::DEFAULT
            }
        }

        /// Control how deserializing and deserialization errors are handled.
        ///
        /// Note that deserialization errors cannot panic. If you need more robust means of
        /// handling inputs, consider not using environment variables.
        #[derive(Clone, Copy, PartialEq, Eq)]
        pub(crate) enum ErrorHandling {
            /// debug_warn on deserialization errors.
            DebugWarn,
            /// Ignore deserialization errors and treat the variable as not set.
            NotSet,
            /// Fallback to default.
            DefaultFallback,
            /// Formatting errors are treated as truthy values.
            ///
            /// If this library fails to parse the value as an integer and truthy cast is
            /// enabled, truthy values will be set to 1 or 0.
            ///
            /// Note: Most values are considered truthy, except for "", "0", "false", "no",
            /// and "off".
            TruthyCast,
        }

        /// Control what empty strings are treated as.
        #[derive(Clone, Copy)]
        pub(crate) enum EmptyStringAs {
            /// Empty strings are handled as the given value.
            Value(ValueType),
            /// Empty strings are treated as deserialization errors.
            Erroneous,
        }

        #[derive(Clone, Copy)]
        pub(crate) struct DeserOpts {
            pub error_handling: ErrorHandling,
            pub empty_string_as: EmptyStringAs,
        }
        impl DeserOpts {
            pub(crate) const DEFAULT: Self = Self {
                error_handling: ErrorHandling::DebugWarn,
                empty_string_as: EmptyStringAs::Erroneous,
            };
        }
        impl Default for DeserOpts {
            fn default() -> Self {
                Self::DEFAULT
            }
        }

        // Zig: `fn Cache(comptime ip: Input) type` — Rust: store `ip` (var_name + opts) on the
        // struct so handle_error can read it. Zig passes it as a comptime param; we pass it at
        // `const fn new()` time.
        pub(crate) struct Cache {
            value: AtomicU64,
            // TODO(port): in Zig `ip` is a comptime param baked into the type; here it lives as
            // runtime data on the static. The `default_fallback` arm in handle_error was a
            // `@compileError` when no default was set — that compile-time check is lost.
            ip: Input,
        }

        type StoredType = ValueType;

        /// The value meaning an environment variable that hasn't been loaded yet.
        const UNKNOWN_SENTINEL: StoredType = StoredType::MAX;
        /// The unique value representing an environment variable that is not set.
        const NOT_SET_SENTINEL: StoredType = StoredType::MAX - 1;

        impl Cache {
            pub(crate) const fn new(ip: Input) -> Self {
                Self {
                    value: AtomicU64::new(UNKNOWN_SENTINEL),
                    ip,
                }
            }

            #[inline]
            pub(crate) fn get_cached(&self) -> Output {
                match self.value.load(Ordering::Relaxed) {
                    UNKNOWN_SENTINEL => {
                        crate::hint::cold();
                        CacheOutput::Unknown
                    }
                    NOT_SET_SENTINEL => CacheOutput::NotSet,
                    v => CacheOutput::Value(v),
                }
            }

            #[inline]
            pub(crate) fn deser_and_invalidate(&self, raw_env: Option<&[u8]>) -> Option<ValueType> {
                let Some(raw_env) = raw_env else {
                    self.value.store(NOT_SET_SENTINEL, Ordering::Relaxed);
                    return None;
                };

                if raw_env == b"" {
                    match self.ip.opts.deser.empty_string_as {
                        EmptyStringAs::Value(v) => {
                            self.value.store(v, Ordering::Relaxed);
                            return Some(v);
                        }
                        EmptyStringAs::Erroneous => {
                            return self.handle_error(raw_env, "is an empty string");
                        }
                    }
                }

                // Zig: `std.fmt.parseInt(u64, raw_env, 10)` — distinguishes Overflow vs
                // InvalidCharacter. Exact parity incl. '-0'→0, '-N'→Overflow,
                // leading/trailing-`_` reject.
                let formatted = match crate::fmt::parse_int::<u64>(raw_env, 10) {
                    Ok(v) => v,
                    Err(crate::fmt::ParseIntError::Overflow) => {
                        return self.handle_error(raw_env, "overflows u64");
                    }
                    Err(crate::fmt::ParseIntError::InvalidCharacter) => {
                        return self.handle_error(raw_env, "is not a valid integer");
                    }
                };

                if formatted == NOT_SET_SENTINEL || formatted == UNKNOWN_SENTINEL {
                    return self.handle_error(raw_env, "is a reserved value");
                }

                self.value.store(formatted, Ordering::Relaxed);
                Some(formatted)
            }

            fn handle_error(&self, raw_env: &[u8], reason: &'static str) -> Option<ValueType> {
                // Zig built `fmt` at comptime via string concatenation:
                //   "Environment variable '{s}' has value '{s}' which " ++ reason ++ "."
                // We pass `reason` as a third argument instead.
                match self.ip.opts.deser.error_handling {
                    ErrorHandling::DebugWarn => {
                        crate::output::debug_warn(&format_args!(
                            "Environment variable '{}' has value '{}' which {}.",
                            bstr::BStr::new(self.ip.var_name),
                            bstr::BStr::new(raw_env),
                            reason,
                        ));
                        self.value.store(NOT_SET_SENTINEL, Ordering::Relaxed);
                        None
                    }
                    ErrorHandling::NotSet => {
                        self.value.store(NOT_SET_SENTINEL, Ordering::Relaxed);
                        None
                    }
                    ErrorHandling::TruthyCast => {
                        if super::boolean::string_is_truthy(raw_env) {
                            self.value.store(1, Ordering::Relaxed);
                            Some(1)
                        } else {
                            self.value.store(0, Ordering::Relaxed);
                            Some(0)
                        }
                    }
                    ErrorHandling::DefaultFallback => {
                        // TODO(port): Zig branch was:
                        //   if (comptime ip.opts.default) |d| return deserAndInvalidate(d);
                        //   @compileError(missing_default_fmt, .{ ip.var_name, "default_fallback" });
                        // Note: the Zig recurses into deserAndInvalidate with `d: u64` where a
                        // `?[]const u8` is expected — that line looks like dead code (no var uses
                        // .default_fallback) and would not have compiled if instantiated. We keep
                        // the intent: store the default and return it.
                        if let Some(d) = self.ip.opts.default {
                            self.value.store(d, Ordering::Relaxed);
                            return Some(d);
                        }
                        debug_assert!(
                            false,
                            "Environment variable '{}' is configured to fallback to default on \
                             default_fallback, but no default is set.",
                            bstr::BStr::new(self.ip.var_name),
                        );
                        self.value.store(NOT_SET_SENTINEL, Ordering::Relaxed);
                        None
                    }
                }
            }
        }
    }
}

/// Create a new environment variable definition.
///
/// The resulting type has methods for interacting with the environment variable.
///
/// Technically, none of the operations here are thread-safe, so writing to environment variables
/// does not guarantee that other threads will see the changes. You should avoid writing to
/// environment variables.
// Zig: `fn New(comptime VariantType: type, comptime key: [:0]const u8, comptime opts) type`
//      → `PlatformSpecificNew(VariantType, key, key, opts)`
#[macro_export]
#[doc(hidden)]
macro_rules! new {
    ($vis:vis $name:ident : $kind:ident, $key:literal, { $($opts:tt)* }) => {
        $crate::env_var::platform_specific_new!(
            $vis $name : $kind, posix = $key, windows = $key, { $($opts)* }
        );
    };
}
pub(crate) use new;

/// Identical to new, except it allows you to specify different keys for POSIX and Windows.
///
/// If the current platform does not have a key specified, all methods that attempt to read the
/// environment variable will fail at compile time, except for `platform_get` and `platform_key`,
/// which will return None instead.
// Zig: `fn PlatformSpecificNew(comptime VariantType, comptime posix_key: ?[:0]const u8,
//                              comptime windows_key: ?[:0]const u8, comptime opts) type`
#[macro_export]
#[doc(hidden)]
macro_rules! platform_specific_new {
    // TODO(port): this macro is a draft of the Zig comptime type-generator. It expands to a
    // `pub mod $name { pub fn get() / key() / platform_get() / ... }` so call sites read
    // `env_var::HOME::get()` like Zig's `env_var.HOME.get()`. The opts-parsing arms below cover
    // exactly the option shapes used in this file; Phase B should harden / generalize.
    (
        $vis:vis $name:ident : $kind:ident,
        posix = $posix:tt, windows = $windows:tt,
        { $($opts:tt)* }
    ) => {
        #[allow(non_upper_case_globals)]
        $vis const $name: $name::Accessor = $name::Accessor;
        #[allow(non_snake_case)]
        $vis mod $name {
            use super::*;
            use $crate::env_var::kind::$kind as K;
            use $crate::env_var::CacheOutput;

            // Zig: `const comptime_key: []const u8 = posix_key orelse windows_key orelse "<unknown>"`
            // (Compile-error when both null is enforced by having no matching macro arm.)
            const POSIX_KEY: Option<&'static $crate::ZStr> =
                $crate::env_var::__key_opt!($posix);
            const WINDOWS_KEY: Option<&'static $crate::ZStr> =
                $crate::env_var::__key_opt!($windows);
            const COMPTIME_KEY: &'static [u8] = $crate::env_var::__first_key!($posix, $windows);

            // Zig: `var cache: VariantType.Cache(.{ .var_name = comptime_key, .opts = opts }) = .{};`
            static CACHE: K::Cache = $crate::env_var::__make_cache!(
                $kind, COMPTIME_KEY, { $($opts)* }
            );

            // Zig computed `DefaultType`/`ReturnType` at comptime from whether `opts.default` is
            // set. We expose the default + a const HAS_DEFAULT and always return Option<ValueType>;
            // a thin `pub fn get() -> ValueType` wrapper that `.unwrap()`s is added when a default
            // exists. TODO(port): restore the non-nullable `get()` return type for defaulted vars.
            pub const DEFAULT: Option<K::ValueType> =
                $crate::env_var::__default_opt!($kind, { $($opts)* });

            /// Attempt to retrieve the value of the environment variable for the current platform, if
            /// the current platform has a supported definition. Returns None otherwise, unlike the
            /// other methods which will fail at compile time if the platform is unsupported.
            pub fn platform_get() -> Option<K::ValueType> {
                // Get the platform-specific key
                #[cfg(unix)]
                let platform_key: Option<&'static ZStr> = POSIX_KEY;
                #[cfg(windows)]
                let platform_key: Option<&'static ZStr> = WINDOWS_KEY;
                #[cfg(not(any(unix, windows)))]
                let platform_key: Option<&'static ZStr> = None;

                // If platform doesn't have a key, return None
                let k = platform_key?;

                // Inline the logic from get() without calling assert_platform_supported()
                match CACHE.get_cached() {
                    CacheOutput::Unknown => {
                        $crate::hint::cold();

                        let env_var = $crate::getenv_z(k);
                        let maybe_reloaded = CACHE.deser_and_invalidate(env_var);

                        if let Some(v) = maybe_reloaded {
                            return Some(v);
                        }
                        if let Some(d) = DEFAULT {
                            return Some(d);
                        }

                        None
                    }
                    CacheOutput::NotSet => {
                        if let Some(d) = DEFAULT {
                            return Some(d);
                        }
                        None
                    }
                    CacheOutput::Value(v) => Some(v),
                }
            }

            /// Equal to `.platform_key()` except fails to compile if current platform is supported.
            pub fn key() -> &'static ZStr {
                assert_platform_supported();
                platform_key().unwrap()
            }

            /// Retrieve the key of the environment variable for the current platform, if any.
            pub fn platform_key() -> Option<&'static ZStr> {
                #[cfg(unix)]
                { return POSIX_KEY; }
                #[cfg(windows)]
                { return WINDOWS_KEY; }
                #[allow(unreachable_code)]
                None
            }

            // TODO(port): `getNotEmpty` only makes sense for string-kind vars (it calls `.len`).
            // In Zig, lazy compilation means it simply isn't instantiated for non-string vars.
            // Phase B: gate this fn on `$kind == string` via a separate macro arm.
            pub fn get_not_empty() -> Option<K::ValueType>
            where
                K::ValueType: $crate::env_var::HasLen,
            {
                if let Some(v) = get() {
                    if $crate::env_var::HasLen::len(&v) == 0 {
                        return None;
                    }
                    return Some(v);
                }
                None
            }

            /// Retrieve the value of the environment variable, loading it if necessary.
            /// Fails if the current platform is unsupported.
            pub fn get() -> Option<K::ValueType> {
                assert_platform_supported();

                let cached_result = CACHE.get_cached();

                match cached_result {
                    // First lookup is *always* Unknown (CACHE starts zeroed),
                    // so don't cold-hint this arm — it pessimises the only
                    // call that happens on the startup path.
                    CacheOutput::Unknown => get_force_reload(),
                    CacheOutput::NotSet => {
                        if let Some(d) = DEFAULT {
                            return Some(d);
                        }
                        None
                    }
                    CacheOutput::Value(v) => Some(v),
                }
            }

            /// Retrieve the value of the environment variable, reloading it from the environment.
            /// Fails if the current platform is unsupported.
            fn get_force_reload() -> Option<K::ValueType> {
                assert_platform_supported();
                let env_var = $crate::getenv_z(key());
                let maybe_reloaded = CACHE.deser_and_invalidate(env_var);

                if let Some(v) = maybe_reloaded {
                    return Some(v);
                }

                if let Some(d) = DEFAULT {
                    return Some(d);
                }

                None
            }

            /// Fetch the default value of this environment variable, if any.
            ///
            /// It is safe to compare the result of .get() to default to test if the variable is set to
            /// its default value.
            // Zig: `pub const default: DefaultType = if (opts.default) |d| d else {};`
            // Exposed above as `DEFAULT: Option<ValueType>`.

            /// Unit value so call sites read `env_var::FOO.get()` (matching Zig
            /// `bun.env_var.FOO.get()`). The module-path form `FOO::get()` also works.
            pub struct Accessor;
            impl Accessor {
                #[inline] pub fn get(&self) -> Option<K::ValueType> { get() }
                #[inline] pub fn platform_get(&self) -> Option<K::ValueType> { platform_get() }
                #[inline] pub fn get_not_empty(&self) -> Option<K::ValueType>
                    where K::ValueType: $crate::env_var::HasLen { get_not_empty() }
                #[inline] pub fn key(&self) -> &'static $crate::ZStr { key() }
                #[inline] pub fn platform_key(&self) -> Option<&'static $crate::ZStr> { platform_key() }
            }

            fn assert_platform_supported() {
                // Zig: `@compileError` when the current platform's key is null.
                // TODO(port): Rust cannot `compile_error!` from inside a const-evaluated `if cfg!`
                // without separate macro arms per (posix=None / windows=None) combination. Phase B
                // should split the macro so e.g. `posix = None` emits `#[cfg(unix)] compile_error!`.
                #[cfg(windows)]
                debug_assert!(
                    WINDOWS_KEY.is_some(),
                    concat!(
                        "Cannot retrieve the value of ",
                        // TODO(port): COMPTIME_KEY is &[u8]; concat! wants literals
                        "<env var>",
                        " for Windows since no Windows key is associated with it."
                    )
                );
                #[cfg(unix)]
                debug_assert!(
                    POSIX_KEY.is_some(),
                    concat!(
                        "Cannot retrieve the value of ",
                        "<env var>",
                        " for POSIX since no POSIX key is associated with it."
                    )
                );
            }
        }
    };
}
pub(crate) use platform_specific_new;

// ─── helper macros for platform_specific_new! ───
// TODO(port): these are scaffolding for the draft macro; Phase B may replace with a cleaner
// trait-based design once the call-site shape is settled.

#[doc(hidden)]
#[macro_export]
macro_rules! __key_opt {
    (None) => {
        None
    };
    ($lit:literal) => {
        // TODO(port): need a `zstr!` const constructor for &'static ZStr from a string literal.
        Some($crate::zstr!($lit))
    };
}
pub(crate) use __key_opt;

#[doc(hidden)]
#[macro_export]
macro_rules! __first_key {
    (None, None) => { compile_error!("Environment variable has no keys for POSIX nor Windows specified. Provide a key for either POSIX or Windows.") };
    (None, $w:literal) => { $w.as_bytes() };
    ($p:literal, $($rest:tt)*) => { $p.as_bytes() };
}
pub(crate) use __first_key;

#[doc(hidden)]
#[macro_export]
macro_rules! __make_cache {
    (string, $name:expr, { $($opts:tt)* }) => {
        $crate::env_var::kind::string::Cache::new()
    };
    (boolean, $name:expr, { $($opts:tt)* }) => {
        $crate::env_var::kind::boolean::Cache::new()
    };
    (unsigned, $name:expr, { $($opts:tt)* }) => {
        $crate::env_var::kind::unsigned::Cache::new($crate::env_var::CacheConfiguration {
            var_name: $name,
            opts: $crate::env_var::__unsigned_opts!({ $($opts)* }),
        })
    };
}
pub(crate) use __make_cache;

#[doc(hidden)]
#[macro_export]
macro_rules! __unsigned_opts {
    ({ }) => {
        $crate::env_var::kind::unsigned::CtorOptions::DEFAULT
    };
    ({ default: $d:expr }) => {
        $crate::env_var::kind::unsigned::CtorOptions {
            default: Some($d),
            deser: $crate::env_var::kind::unsigned::DeserOpts::DEFAULT,
        }
    };
    ({ deser: { error_handling: $eh:ident } }) => {
        $crate::env_var::kind::unsigned::CtorOptions {
            default: None,
            deser: $crate::env_var::kind::unsigned::DeserOpts {
                error_handling: $crate::env_var::kind::unsigned::ErrorHandling::$eh,
                empty_string_as: $crate::env_var::kind::unsigned::EmptyStringAs::Erroneous,
            },
        }
    };
    ({ deser: { error_handling: $eh:ident, empty_string_as: Value($v:expr) } }) => {
        $crate::env_var::kind::unsigned::CtorOptions {
            default: None,
            deser: $crate::env_var::kind::unsigned::DeserOpts {
                error_handling: $crate::env_var::kind::unsigned::ErrorHandling::$eh,
                empty_string_as: $crate::env_var::kind::unsigned::EmptyStringAs::Value($v),
            },
        }
    };
}
pub(crate) use __unsigned_opts;

#[doc(hidden)]
#[macro_export]
macro_rules! __default_opt {
    (string, { }) => {
        None
    };
    (string, { default: $d:expr }) => {
        Some($d as &'static [u8])
    };
    (boolean, { }) => {
        None
    };
    (boolean, { default: $d:expr }) => {
        Some($d)
    };
    (unsigned, { }) => {
        None
    };
    (unsigned, { default: $d:expr }) => {
        Some($d)
    };
    (unsigned, { deser: { $($rest:tt)* } }) => {
        None
    };
}
pub(crate) use __default_opt;

/// Helper trait so `get_not_empty` (which only makes sense for string-kind) can compile
/// generically inside the macro body. Non-string kinds report len 1 (always non-empty);
/// callers never invoke `get_not_empty` on non-strings — the impl only satisfies the bound.
#[doc(hidden)]
pub trait HasLen {
    fn len(&self) -> usize;
}
impl HasLen for &'static [u8] {
    #[inline]
    fn len(&self) -> usize {
        <[u8]>::len(self)
    }
}
impl HasLen for bool {
    #[inline]
    fn len(&self) -> usize {
        1
    }
}
impl HasLen for u64 {
    #[inline]
    fn len(&self) -> usize {
        1
    }
}

#[derive(Clone, Copy)]
pub(crate) struct FeatureFlagOpts {
    pub default: Option<bool>,
}
impl Default for FeatureFlagOpts {
    fn default() -> Self {
        Self {
            default: Some(false),
        }
    }
}

// Zig: `fn newFeatureFlag(comptime env_var: [:0]const u8, comptime opts: FeatureFlagOpts) type`
//      → `New(kind.boolean, env_var, .{ .default = opts.default })`
#[macro_export]
#[doc(hidden)]
macro_rules! new_feature_flag {
    ($vis:vis $name:ident, $key:literal, { }) => {
        // FeatureFlagOpts default: Some(false)
        $crate::env_var::new!($vis $name : boolean, $key, { default: false });
    };
    ($vis:vis $name:ident, $key:literal, { default: None }) => {
        $crate::env_var::new!($vis $name : boolean, $key, { });
    };
    ($vis:vis $name:ident, $key:literal, { default: $d:expr }) => {
        $crate::env_var::new!($vis $name : boolean, $key, { default: $d });
    };
}
pub(crate) use new_feature_flag;

// ported from: src/bun_core/env_var.zig
