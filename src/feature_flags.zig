const env = @import("env.zig");
pub const strong_etags_for_built_files = true;
pub const keep_alive = false;

// Debug helpers
pub const print_ast = false;
pub const disable_printing_null = false;

// This was a ~5% performance improvement
pub const store_file_descriptors = !env.isBrowser;

pub const css_in_js_import_behavior = CSSInJSImportBehavior.facade;

pub const only_output_esm = true;

pub const jsx_runtime_is_cjs = true;

pub const bundle_node_modules = true;

pub const tracing = true;

pub const minify_javascript_string_length = false;

pub const verbose_watcher = false;

pub const css_supports_fence = true;

pub const enable_entry_cache = true;
pub const enable_bytecode_caching = false;

pub const dev_only = true;

pub const verbose_fs = false;

pub const watch_directories = true;

pub const tailwind_css_at_keyword = true;

pub const bundle_dynamic_import = true;

// This feature flag exists so when you have defines inside package.json, you can use single quotes in nested strings.
pub const allow_json_single_quotes = true;

pub const react_specific_warnings = true;

pub const log_allocations = false;

pub const CSSInJSImportBehavior = enum {
    // When you import a .css file and you reference the import in JavaScript
    // Just return whatever the property key they referenced was
    facade,
    facade_onimportcss,
};

// having issues compiling WebKit with this enabled
pub const remote_inspector = false;
pub const auto_import_buffer = false;

pub const is_macro_enabled = !env.isWasm and !env.isWasi;

// pretend everything is always the macro environment
// useful for debugging the macro's JSX transform
pub const force_macro = false;

pub const include_filename_in_jsx = false;

pub const verbose_analytics = false;

pub const disable_compression_in_http_client = false;

pub const enable_keepalive = true;

pub const atomic_file_watcher = env.isLinux;

pub const node_streams = false;
pub const simd = true;

// This change didn't seem to make a meaningful difference in microbenchmarks
pub const latin1_is_now_ascii = false;

pub const http_buffer_pooling = true;

pub const disable_lolhtml = false;

/// There is, what I think is, a bug in getaddrinfo()
/// on macOS that specifically impacts localhost and not
/// other ipv4 hosts. This is a workaround for that.
/// "localhost" fails to connect.
pub const hardcode_localhost_to_127_0_0_1 = false;

/// React doesn't do anything with jsxs
/// If the "jsxs" import is development, "jsxs" isn't supported
/// But it's very easy to end up importing it accidentally, causing an error at runtime
/// so we just disable it
pub const support_jsxs_in_jsx_transform = false;

pub const use_simdutf = @import("root").bun.Environment.isNative and !@import("root").bun.JSC.is_bindgen;

pub const inline_properties_in_transpiler = true;

pub const same_target_becomes_destructuring = true;

pub const react_server_components = true;

pub const help_catch_memory_issues = @import("root").bun.Environment.allow_assert;

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

pub const boundary_based_chunking = true;

/// https://sentry.engineering/blog/the-case-for-debug-ids
/// https://github.com/mitsuhiko/source-map-rfc/blob/proposals/debug-id/proposals/debug-id.md
/// https://github.com/source-map/source-map-rfc/pull/20
pub const source_map_debug_id = true;

pub const alignment_tweak = false;

pub const export_star_redirect = false;

pub const streaming_file_uploads_for_http_client = true;

// TODO: fix concurrent transpiler on Windows
pub const concurrent_transpiler = !env.isWindows;

// https://github.com/oven-sh/bun/issues/5426#issuecomment-1813865316
pub const disable_auto_js_to_ts_in_node_modules = true;

pub const runtime_transpiler_cache = !env.isWindows;
