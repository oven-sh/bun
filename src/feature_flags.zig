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

pub const css_in_js_import_behavior = CSSModulePolyfill.facade;

pub const only_output_esm = true;

pub const jsx_runtime_is_cjs = true;

pub const bundle_node_modules = true;

pub const tracing = true;

pub const verbose_watcher = true;

pub const css_supports_fence = true;

pub const disable_entry_cache = false;
pub const enable_bytecode_caching = false;

pub const CSSModulePolyfill = enum {
    // When you import a .css file and you reference the import in JavaScript
    // Just return whatever the property key they referenced was
    facade,
};

// having issues compiling WebKit with this enabled
pub const remote_inspector = false;
