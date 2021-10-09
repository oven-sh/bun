const env = @import("env.zig");

pub const strong_etags_for_built_files = true;
pub const keep_alive = true;

// it just doesn't work well.
pub const use_std_path_relative = false;
pub const use_std_path_join = false;

// Debug helpers
pub const print_ast = false;
pub const disable_printing_null = false;

// This was a ~5% performance improvement
pub const store_file_descriptors = !env.isWindows and !env.isBrowser;

// This doesn't really seem to do anything for us
pub const disable_filesystem_cache = false and std.Target.current.os.tag == .macos;

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
// Disabled due to concurrency bug I don't have time to fix right now.
// I suspect it's like 3 undefined memory issues.
// This was the command I ran to reproduce it:
//    for i in (seq 1000)
//      command ../../build/debug/macos-x86_64/bun --use=./nexty2 --new-jsb > /dev/null
//    end
// It only happens 1 out of every N times, probably like 50.
pub const parallel_bun = false;

pub const CSSInJSImportBehavior = enum {
    // When you import a .css file and you reference the import in JavaScript
    // Just return whatever the property key they referenced was
    facade,
    facade_onimportcss,
};

// having issues compiling WebKit with this enabled
pub const remote_inspector = false;
pub const auto_import_buffer = false;

pub const is_macro_enabled = true;

// pretend everything is always the macro environment
// useful for debugging the macro's JSX transform
pub const force_macro = false;

pub const include_filename_in_jsx = true;

pub const verbose_analytics = false;
