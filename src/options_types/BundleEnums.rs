//! Pure enum/struct option types extracted from `bundler/options.zig` so
//! `cli/` and other tiers can reference them without depending on `bundler/`.
//! Aliased back at original locations — call sites unchanged.

use bun_collections;
use phf;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Format {
    /// ES module format
    /// This is the default format
    Esm,

    /// Immediately-invoked function expression
    /// (function(){
    ///     ...
    /// })();
    Iife,

    /// CommonJS
    Cjs,

    /// Bake uses a special module format for Hot-module-reloading. It includes a
    /// runtime payload, sourced from src/bake/hmr-runtime-{side}.ts.
    ///
    /// ((unloadedModuleRegistry, config) => {
    ///   ... runtime code ...
    /// })({
    ///   "module1.ts": ...,
    ///   "module2.ts": ...,
    /// }, { ...metadata... });
    InternalBakeDev,
}

impl Format {
    pub fn keep_es6_import_export_syntax(self) -> bool {
        self == Format::Esm
    }

    #[inline]
    pub fn is_esm(self) -> bool {
        self == Format::Esm
    }

    #[inline]
    pub fn is_always_strict_mode(self) -> bool {
        self == Format::Esm
    }

    pub const MAP: phf::Map<&'static [u8], Format> = phf::phf_map! {
        b"esm" => Format::Esm,
        b"cjs" => Format::Cjs,
        b"iife" => Format::Iife,

        // TODO: Disable this outside of debug builds
        b"internal_bake_dev" => Format::InternalBakeDev,
    };

    // `fromJS` alias to `bundler_jsc/options_jsc.zig` deleted — see PORTING.md
    // (`to_js`/`from_js` live as extension-trait methods in the `*_jsc` crate).

    pub fn from_string(slice: &[u8]) -> Option<Format> {
        // Zig: Map.getWithEql(slice, bun.strings.eqlComptime) — eqlComptime is
        // exact byte equality, which is phf's default lookup.
        Self::MAP.get(slice).copied()
    }
}

#[derive(Default)]
pub struct WindowsOptions {
    pub hide_console: bool,
    // TODO(port): lifetime — Zig `?[]const u8` fields with no `deinit` in this
    // file; conservatively owned as Box<[u8]> for Phase A.
    pub icon: Option<Box<[u8]>>,
    pub title: Option<Box<[u8]>>,
    pub publisher: Option<Box<[u8]>>,
    pub version: Option<Box<[u8]>>,
    pub description: Option<Box<[u8]>>,
    pub copyright: Option<Box<[u8]>>,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BundlePackage {
    Always,
    Never,
}

impl BundlePackage {
    // Zig: `bun.StringArrayHashMapUnmanaged(BundlePackage)` — insertion-ordered,
    // string-keyed. Maps to bun_collections per PORTING.md §Collections.
    pub type Map = bun_collections::StringArrayHashMap<BundlePackage>;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/BundleEnums.zig (75 lines)
//   confidence: high
//   todos:      1
//   notes:      WindowsOptions string fields conservatively Box<[u8]>; inherent `type` alias needs Rust 1.79+ or move to module scope.
// ──────────────────────────────────────────────────────────────────────────
