/// Shared configuration for `?bundle` imports.
///
/// This is the SINGLE source of truth for how a `?bundle` transpiler is
/// configured. ALL code paths — non-hot runtime, hot/dev server, sub-build,
/// and --compile — MUST use these functions. See `src/bundler/BUNDLE_IMPORTS.md`.
const bun = @import("bun");
const ImportRecord = bun.ImportRecord;
const Transpiler = bun.Transpiler;
const DotEnv = bun.DotEnv;
const options = bun.options;

pub const BundleMode = enum {
    /// Non-hot production build (JSBundle.build path)
    production,
    /// Dev server with HMR (attachToSharedDevServer path)
    hot,
    /// Sub-build inside a parent BundleV2 (runSingleSubBuild path)
    sub_build,
};

/// Applies `?bundle` import attribute configuration to a Transpiler.
///
/// This function handles: target, format, splitting, minify, sourcemap,
/// naming, env behavior/prefix, polyfill_node_globals, css_chunking,
/// and — critically — `configureDefines()` which loads .env files,
/// sets NODE_ENV, and creates process.env.* defines.
///
/// Call `applyBundleModeOverrides` AFTER this function for mode-specific
/// settings (e.g., hot mode forces minify=false).
pub fn configureTranspilerForBundle(
    transpiler: *Transpiler,
    config: ImportRecord.BundleImportConfig,
) !void {
    // 1. Target (from import attribute, default browser)
    if (config.target) |t| transpiler.options.target = t;

    // 2. Output format (from import attribute, default esm)
    transpiler.options.output_format = config.format orelse .esm;

    // 3. Code splitting
    transpiler.options.code_splitting = config.splitting orelse false;

    // 4. Minification
    if (config.minify) |m| {
        transpiler.options.minify_syntax = m;
        transpiler.options.minify_whitespace = m;
        transpiler.options.minify_identifiers = m;
        transpiler.options.inlining = m;
    }

    // 5. Source maps (from import attribute, default linked)
    if (config.sourcemap) |sm| {
        transpiler.options.source_map = sm;
    }

    // 6. Naming templates (from import attribute, default [name]-[hash].[ext])
    const naming = config.naming orelse "[name]-[hash].[ext]";
    transpiler.options.entry_naming = naming;
    transpiler.options.chunk_naming = naming;

    // 7. Env behavior and prefix (from import attribute env: "VITE_*")
    if (config.env_behavior) |env_beh| {
        transpiler.options.env.behavior = env_beh;
        if (config.env_prefix) |pfx| {
            transpiler.options.env.prefix = pfx;
        }
    }

    // 8. Polyfill node globals — leave as-is (set by configureBundler).
    // Setting this to true changes module wrapping decisions which can
    // break lazy init ordering of CJS imports like lodash.

    // 9. CSS chunking
    transpiler.options.css_chunking = true;

    // 10. Configure linker and defines (THE KEY)
    // This calls runEnvLoader which loads .env files + process env,
    // then loadDefines which creates process.env.NODE_ENV and
    // prefix-matched process.env.VITE_* defines.
    // Reset defines_loaded to ensure configureDefines actually runs
    // (it has an early return if defines were already loaded by a
    // prior init path).
    transpiler.options.defines_loaded = false;
    transpiler.configureLinker();
    try transpiler.configureDefines();

    // 11. Sync resolver options
    transpiler.resolver.env_loader = transpiler.env;
    transpiler.resolver.opts = transpiler.options;
}

/// Apply mode-specific overrides AFTER configureTranspilerForBundle.
///
/// These override import attribute values where the mode demands it
/// (e.g., hot mode forces minify=false regardless of what the import says).
pub fn applyBundleModeOverrides(
    transpiler: *Transpiler,
    mode: BundleMode,
) void {
    switch (mode) {
        .hot => {
            // Dev server forces these regardless of import attributes
            transpiler.options.minify_syntax = false;
            transpiler.options.minify_whitespace = false;
            transpiler.options.minify_identifiers = false;
            transpiler.options.inlining = false;
            transpiler.options.source_map = .external;
            transpiler.options.output_format = .internal_bake_dev;
            transpiler.options.hot_module_reloading = true;
            transpiler.options.code_splitting = false;
            transpiler.options.tree_shaking = false;
            transpiler.options.production = false;
        },
        .sub_build => {
            // Sub-builds produce in-memory output
            transpiler.options.output_dir = "";
        },
        .production => {
            // No additional overrides — import attributes are authoritative
        },
    }
    transpiler.resolver.opts = transpiler.options;
}
