const env = @import("env.zig");
const bun = @import("root").bun;

/// Enable breaking changes for the next major release of Bun
// TODO: Make this a CLI flag / runtime var so that we can verify disabled code paths can compile
pub const breaking_changes_1_2 = false;

/// Store and reuse file descriptors during module resolution
/// This was a ~5% performance improvement
pub const store_file_descriptors = !env.isBrowser;

pub const jsx_runtime_is_cjs = true;

pub const tracing = true;

// TODO: remove this flag, it should use bun.Output.scoped
pub const verbose_watcher = false;

pub const css_supports_fence = true;

pub const enable_entry_cache = true;

// TODO: remove this flag, it should use bun.Output.scoped
pub const verbose_fs = false;

pub const watch_directories = true;

// This feature flag exists so when you have defines inside package.json, you can use single quotes in nested strings.
pub const allow_json_single_quotes = true;

pub const react_specific_warnings = true;

pub const is_macro_enabled = !env.isWasm and !env.isWasi;

// pretend everything is always the macro environment
// useful for debugging the macro's JSX transform
pub const force_macro = false;

pub const include_filename_in_jsx = false;

pub const disable_compression_in_http_client = false;

pub const enable_keepalive = true;

pub const atomic_file_watcher = env.isLinux;

// This change didn't seem to make a meaningful difference in microbenchmarks
pub const latin1_is_now_ascii = false;

pub const http_buffer_pooling = true;

pub const disable_lolhtml = false;

/// There is, what I think is, a bug in getaddrinfo()
/// on macOS that specifically impacts localhost and not
/// other ipv4 hosts. This is a workaround for that.
/// "localhost" fails to connect.
pub const hardcode_localhost_to_127_0_0_1 = false;

/// React will issue warnings in development if there are multiple children
/// without keys and "jsxs" is not used.
/// https://github.com/oven-sh/bun/issues/10733
pub const support_jsxs_in_jsx_transform = true;

pub const use_simdutf = bun.Environment.isNative and !bun.JSC.is_bindgen;

pub const inline_properties_in_transpiler = true;

pub const same_target_becomes_destructuring = true;

pub const help_catch_memory_issues = bun.Environment.allow_assert;

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
pub const unwrap_commonjs_to_esm = true;

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
pub const source_map_debug_id = true;

pub const alignment_tweak = false;

pub const export_star_redirect = false;

pub const streaming_file_uploads_for_http_client = true;

pub const concurrent_transpiler = true;

// https://github.com/oven-sh/bun/issues/5426#issuecomment-1813865316
pub const disable_auto_js_to_ts_in_node_modules = true;

pub const runtime_transpiler_cache = true;

/// On Windows, node_modules/.bin uses pairs of '.exe' + '.bunx' files.  The
/// fast path is to load the .bunx file within `bun.exe` instead of
/// `bun_shim_impl.exe` by using `bun_shim_impl.tryStartupFromBunJS`
///
/// When debugging weird script runner issues, it may be worth disabling this in
/// order to isolate your bug.
pub const windows_bunx_fast_path = true;

// This causes strange bugs where writing via console.log (sync) has a different
// order than via Bun.file.writer() so we turn it off until there's a unified,
// buffered writer abstraction shared throughout Bun
pub const nonblocking_stdout_and_stderr_on_posix = false;

pub const postgresql = env.is_canary or env.isDebug;

// TODO: fix Windows-only test failures in fetch-preconnect.test.ts
pub const is_fetch_preconnect_supported = env.isPosix;

pub const libdeflate_supported = env.isNative;

// Mostly exists as a way to turn it off later, if necessary.
pub fn isLibdeflateEnabled() bool {
    if (!libdeflate_supported) {
        return false;
    }

    return !bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_NO_LIBDEFLATE");
}

/// Enable Bun Kit's experimental bundler tools.
pub fn bake() bool {
    // In canary or if an environment variable is specified.
    return env.is_canary or env.isDebug or bun.getRuntimeFeatureFlag("BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE");
}

/// Additional debugging features for Bake, such as the incremental visualizer.
/// To use them, extra flags are passed in addition to this one.
pub const bake_debugging_features = env.is_canary or env.isDebug;
