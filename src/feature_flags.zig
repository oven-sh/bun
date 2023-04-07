const env = @import("env.zig");
pub const strong_etags_for_built_files = true;
pub const keep_alive = false;

// it just doesn't work well.
pub const use_std_path_relative = false;
pub const use_std_path_join = false;

// Debug helpers
pub const print_ast = false;
pub const disable_printing_null = false;

// This was a ~5% performance improvement
pub const store_file_descriptors = !env.isWindows and !env.isBrowser;

pub const css_in_js_import_behavior = CSSInJSImportBehavior.facade;

pub const only_output_esm = true;

pub const jsx_runtime_is_cjs = true;

pub const bundle_node_modules = true;

pub const tracing = true;

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
// Not sure why...
// But this is slower!
// ~/Build/throw
// ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
// Benchmark #1: bun create react3 app --force --no-install
//   Time (mean ± σ):     974.6 ms ±   6.8 ms    [User: 170.5 ms, System: 798.3 ms]
//   Range (min … max):   960.8 ms … 984.6 ms    10 runs

// ❯ mv /usr/local/opt/libgit2/lib/libgit2.dylib /usr/local/opt/libgit2/lib/libgit2.dylib.1

// ~/Build/throw
// ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
// Benchmark #1: bun create react3 app --force --no-install
//   Time (mean ± σ):     306.7 ms ±   6.1 ms    [User: 31.7 ms, System: 269.8 ms]
//   Range (min … max):   299.5 ms … 318.8 ms    10 runs
pub const use_libgit2 = true;

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
pub const hardcode_localhost_to_127_0_0_1 = true;

/// React doesn't do anything with jsxs
/// If the "jsxs" import is development, "jsxs" isn't supported
/// But it's very easy to end up importing it accidentally, causing an error at runtime
/// so we just disable it
pub const support_jsxs_in_jsx_transform = false;

pub const use_simdutf = !@import("bun").JSC.is_bindgen;

pub const inline_properties_in_transpiler = true;

pub const same_target_becomes_destructuring = true;

pub const react_server_components = true;

pub const help_catch_memory_issues = @import("bun").Environment.allow_assert;

/// Disabled because we need to handle module scope for CJS better.
///
/// The current bugs are:
/// - We need to handle name collisions in the top-level due to hoisted functions
///   It breaks when multiple modules bundled together have functions with the
///   same name at the top-level scope.
/// - Cyclical requires need to be a de-optimization.
///
/// Once fixed, it's a very meaningful bundle size improvement
pub const commonjs_to_esm = false;

pub const boundary_based_chunking = true;
