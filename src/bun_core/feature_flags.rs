//! If you are adding feature-flags to this file, you are in the wrong spot. Go to env_var.rs
//! instead.

use crate::env;
use crate::feature_flag;

/// Enable breaking changes for the next major release of Bun
// TODO: Make this a CLI flag / runtime var so that we can verify disabled code paths can compile
pub const BREAKING_CHANGES_1_4: bool = false;

/// Store and reuse file descriptors during module resolution
/// This was a ~5% performance improvement
pub const STORE_FILE_DESCRIPTORS: bool = !env::IS_BROWSER;

pub const TRACING: bool = true;

pub const CSS_SUPPORTS_FENCE: bool = true;

pub const ENABLE_ENTRY_CACHE: bool = true;

// TODO: remove this flag, it should use bun.Output.scoped
pub const VERBOSE_FS: bool = false;

pub const WATCH_DIRECTORIES: bool = true;

// This feature flag exists so when you have defines inside package.json, you can use single quotes in nested strings.
pub const ALLOW_JSON_SINGLE_QUOTES: bool = true;

pub const IS_MACRO_ENABLED: bool = !env::IS_WASM && !env::IS_WASI;

pub const DISABLE_COMPRESSION_IN_HTTP_CLIENT: bool = false;

pub const ENABLE_KEEPALIVE: bool = true;

pub const ATOMIC_FILE_WATCHER: bool = env::IS_LINUX;

pub const HTTP_BUFFER_POOLING: bool = true;

pub const DISABLE_LOLHTML: bool = false;

/// There is, what I think is, a bug in getaddrinfo()
/// on macOS that specifically impacts localhost and not
/// other ipv4 hosts. This is a workaround for that.
/// "localhost" fails to connect.
pub const HARDCODE_LOCALHOST_TO_127_0_0_1: bool = false;

/// React will issue warnings in development if there are multiple children
/// without keys and "jsxs" is not used.
/// https://github.com/oven-sh/bun/issues/10733
pub const SUPPORT_JSXS_IN_JSX_TRANSFORM: bool = true;

pub const USE_SIMDUTF: bool = env::IS_NATIVE;

pub const INLINE_PROPERTIES_IN_TRANSPILER: bool = true;

pub const SAME_TARGET_BECOMES_DESTRUCTURING: bool = true;

pub const HELP_CATCH_MEMORY_ISSUES: bool = env::ENABLE_ASAN || env::IS_DEBUG;

/// This performs similar transforms as https://github.com/rollup/plugins/tree/master/packages/commonjs
///
/// Though, not exactly the same.
///
/// There are two scenarios where this kicks in:
///
/// 1) You import a CommonJS module using ESM.
///
/// Semantically, CommonJS expects us to wrap everything in a closure. That
/// bloats the code. We want to make the generated code as small as we can.
///
/// To avoid that, we attempt to unwrap the CommonJS module into ESM.
///
/// But, we can't always do that. When you have cyclical require() or directly
/// mutate exported bindings, we can't unwrap it.
///
/// However, in the simple case, where you do something like
///
///     exports.foo = 123;
///     exports.bar = 456;
///
/// We can unwrap it into
///
///    export const foo = 123;
///    export const bar = 456;
///
/// 2) You import a CommonJS module using CommonJS.
///
/// This is a bit more complicated. We want to avoid the closure wrapper, but
/// it's really difficult to track down all the places where you mutate the
/// exports object. `require.cache` makes it even more complicated.
/// So, we just wrap the entire module in a closure.
///
/// But what if we previously unwrapped it?
///
/// In that case, we wrap it again in the printer.
pub const UNWRAP_COMMONJS_TO_ESM: bool = true;

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
pub const SOURCE_MAP_DEBUG_ID: bool = true;

pub const EXPORT_STAR_REDIRECT: bool = false;

pub const STREAMING_FILE_UPLOADS_FOR_HTTP_CLIENT: bool = true;

pub const CONCURRENT_TRANSPILER: bool = true;

// https://github.com/oven-sh/bun/issues/5426#issuecomment-1813865316
pub const DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES: bool = true;

pub const RUNTIME_TRANSPILER_CACHE: bool = true;

/// On Windows, node_modules/.bin uses pairs of '.exe' + '.bunx' files.  The
/// fast path is to load the .bunx file within `bun.exe` instead of
/// `bun_shim_impl.exe` by using `bun_shim_impl.tryStartupFromBunJS`
///
/// When debugging weird script runner issues, it may be worth disabling this in
/// order to isolate your bug.
pub const WINDOWS_BUNX_FAST_PATH: bool = true;

// TODO: fix Windows-only test failures in fetch-preconnect.test.ts
pub const IS_FETCH_PRECONNECT_SUPPORTED: bool = env::IS_POSIX;

pub const LIBDEFLATE_SUPPORTED: bool = env::IS_NATIVE;

// Mostly exists as a way to turn it off later, if necessary.
pub fn is_libdeflate_enabled() -> bool {
    if !LIBDEFLATE_SUPPORTED {
        return false;
    }

    !feature_flag::BUN_FEATURE_FLAG_NO_LIBDEFLATE.get()
}

/// Enable the "app" option in Bun.serve. This option will likely be removed
/// in favor of HTML loaders and configuring framework options in bunfig.toml
pub fn bake() -> bool {
    // In canary or if an environment variable is specified.
    env::IS_CANARY || env::IS_DEBUG || feature_flag::BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE.get()
}

/// Additional debugging features for bake.DevServer, such as the incremental visualizer.
/// To use them, extra flags are passed in addition to this one.
pub const BAKE_DEBUGGING_FEATURES: bool = env::IS_CANARY || env::IS_DEBUG;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/feature_flags.zig (145 lines)
//   confidence: high
//   todos:      0
//   notes:      env::* consts (IS_BROWSER/IS_WASM/IS_NATIVE/IS_CANARY/ENABLE_ASAN etc.) must be defined as `pub const` in crate::env; crate::feature_flag provides runtime env-var getters
// ──────────────────────────────────────────────────────────────────────────
