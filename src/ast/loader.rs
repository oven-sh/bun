//! `bundler/options.zig` `Loader` + `SideEffects`.
//!
//! Data-only enum + pure predicates. `to_api()` / `from_api()` / `API_NAMES` /
//! `LoaderOptional::from_api` live in `bun_options_types::LoaderExt` (would
//! back-edge into the schema crate). `to_mime_type` / `from_mime_type` live in
//! `bun_http_types` (would back-edge into `bun_http::MimeType`).

use bun_core::strings;
use enum_map::Enum;
use phf;

/// The max integer value in this enum can only be appended to.
/// It has dependencies in several places:
/// - bun-native-bundler-plugin-api/bundler_plugin.h
/// - src/jsc/bindings/headers-handwritten.h
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Hash, Enum, strum::IntoStaticStr)]
// Zig field names are lower_snake — `@tagName` is exposed to JS (HTMLImportManifest
// `"loader":`, BuildArtifact.loader) so the strum serialization must match exactly.
#[strum(serialize_all = "snake_case")]
pub enum Loader {
    Jsx = 0,
    Js = 1,
    Ts = 2,
    Tsx = 3,
    Css = 4,
    File = 5,
    Json = 6,
    Jsonc = 7,
    Toml = 8,
    Wasm = 9,
    Napi = 10,
    Base64 = 11,
    Dataurl = 12,
    Text = 13,
    Bunsh = 14,
    Sqlite = 15,
    SqliteEmbedded = 16,
    Html = 17,
    Yaml = 18,
    Json5 = 19,
    Md = 20,
}

// Crosses FFI as `uint8_t default_loader` / `uint8_t loader` in
// `OnBeforeParseArguments` / `OnBeforeParseResult` (`bundler_plugin.h`); lock
// the discriminant width and the values native plugins observe. NB: the C
// header's `BUN_LOADER_TOML = 7` etc. predate `Jsonc`'s insertion at 7 and are
// known-stale — Zig `options.zig` is the source of truth, which Rust matches.
bun_core::assert_ffi_discr!(
    Loader, u8;
    Jsx = 0, Js = 1, Ts = 2, Tsx = 3, Css = 4, File = 5, Json = 6,
    Jsonc = 7, Toml = 8, Wasm = 9, Napi = 10, Base64 = 11, Dataurl = 12,
    Text = 13, Bunsh = 14, Sqlite = 15, SqliteEmbedded = 16, Html = 17,
);

impl Default for Loader {
    /// Mirrors Zig's `Loader = .file` default field initializer.
    fn default() -> Self {
        Loader::File
    }
}

/// `Loader.Optional` — `enum(u8) { none = 254, _ }` niche-packed optional.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct LoaderOptional(pub(crate) u8);

impl LoaderOptional {
    pub const NONE: LoaderOptional = LoaderOptional(254);

    #[inline]
    pub const fn from_loader(l: Loader) -> LoaderOptional {
        LoaderOptional(l as u8)
    }

    pub fn unwrap(self) -> Option<Loader> {
        // Spec options.zig:594-596 uses `@enumFromInt(@intFromEnum(opt))` which is
        // debug-checked. PORTING.md §Forbidden patterns bars transmute-to-enum;
        // exhaustive match so out-of-range tags are debug-asserted, never UB.
        match self.0 {
            0 => Some(Loader::Jsx),
            1 => Some(Loader::Js),
            2 => Some(Loader::Ts),
            3 => Some(Loader::Tsx),
            4 => Some(Loader::Css),
            5 => Some(Loader::File),
            6 => Some(Loader::Json),
            7 => Some(Loader::Jsonc),
            8 => Some(Loader::Toml),
            9 => Some(Loader::Wasm),
            10 => Some(Loader::Napi),
            11 => Some(Loader::Base64),
            12 => Some(Loader::Dataurl),
            13 => Some(Loader::Text),
            14 => Some(Loader::Bunsh),
            15 => Some(Loader::Sqlite),
            16 => Some(Loader::SqliteEmbedded),
            17 => Some(Loader::Html),
            18 => Some(Loader::Yaml),
            19 => Some(Loader::Json5),
            20 => Some(Loader::Md),
            254 => None,
            _ => {
                debug_assert!(false, "LoaderOptional out of range: {}", self.0);
                None
            }
        }
    }
}

impl From<Loader> for LoaderOptional {
    fn from(l: Loader) -> Self {
        LoaderOptional(l as u8)
    }
}

// E0658: inherent assoc types are nightly-only; lifted to module scope.
pub type LoaderHashTable = bun_collections::StringArrayHashMap<Loader>;

impl Loader {
    #[inline]
    pub fn is_css(self) -> bool {
        self == Loader::Css
    }

    #[inline]
    pub fn is_js_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn disable_html(self) -> Loader {
        match self {
            Loader::Html => Loader::File,
            other => other,
        }
    }

    #[inline]
    pub fn is_sqlite(self) -> bool {
        matches!(self, Loader::Sqlite | Loader::SqliteEmbedded)
    }

    pub fn should_copy_for_bundling(self) -> bool {
        matches!(
            self,
            Loader::File
                | Loader::Napi
                | Loader::Sqlite
                | Loader::SqliteEmbedded
                // TODO: loader for reading bytes and creating module or instance
                | Loader::Wasm
        )
    }

    pub fn handles_empty_file(self) -> bool {
        matches!(self, Loader::Wasm | Loader::File | Loader::Text)
    }

    // `to_mime_type` / `from_mime_type` stay in bun_http_types as extension
    // methods (would back-edge into bun_http::MimeType).

    pub fn can_have_source_map(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    pub fn can_be_run_by_bun(self) -> bool {
        matches!(
            self,
            Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx | Loader::Wasm | Loader::Bunsh
        )
    }

    #[inline]
    pub fn stdin_name(self) -> &'static str {
        match self {
            Loader::Jsx => "input.jsx",
            Loader::Js => "input.js",
            Loader::Ts => "input.ts",
            Loader::Tsx => "input.tsx",
            Loader::Css => "input.css",
            Loader::File => "input",
            Loader::Json => "input.json",
            Loader::Toml => "input.toml",
            Loader::Yaml => "input.yaml",
            Loader::Json5 => "input.json5",
            Loader::Wasm => "input.wasm",
            Loader::Napi => "input.node",
            Loader::Text => "input.txt",
            Loader::Bunsh => "input.sh",
            Loader::Html => "input.html",
            Loader::Md => "input.md",
            _ => "",
        }
    }

    // `from_js` lives in bundler_jsc as an extension trait.

    pub const NAMES: phf::Map<&'static [u8], Loader> = phf::phf_map! {
        b"js" => Loader::Js,
        b"mjs" => Loader::Js,
        b"cjs" => Loader::Js,
        b"cts" => Loader::Ts,
        b"mts" => Loader::Ts,
        b"jsx" => Loader::Jsx,
        b"ts" => Loader::Ts,
        b"tsx" => Loader::Tsx,
        b"css" => Loader::Css,
        b"file" => Loader::File,
        b"json" => Loader::Json,
        b"jsonc" => Loader::Jsonc,
        b"toml" => Loader::Toml,
        b"yaml" => Loader::Yaml,
        b"json5" => Loader::Json5,
        b"wasm" => Loader::Wasm,
        b"napi" => Loader::Napi,
        b"node" => Loader::Napi,
        b"dataurl" => Loader::Dataurl,
        b"base64" => Loader::Base64,
        b"txt" => Loader::Text,
        b"text" => Loader::Text,
        b"sh" => Loader::Bunsh,
        b"sqlite" => Loader::Sqlite,
        b"sqlite_embedded" => Loader::SqliteEmbedded,
        b"html" => Loader::Html,
        b"md" => Loader::Md,
        b"markdown" => Loader::Md,
    };

    pub fn from_string(slice_: &[u8]) -> Option<Loader> {
        let slice = if !slice_.is_empty() && slice_[0] == b'.' {
            &slice_[1..]
        } else {
            slice_
        };
        // Zig: names.getWithEql(slice, strings.eqlCaseInsensitiveASCIIICheckLength)
        // TODO(port): phf is case-sensitive; Phase B may need a lowercase pass or
        // bun_core::eql_case_insensitive_ascii lookup over NAMES.entries().
        Self::NAMES.get(slice).copied().or_else(|| {
            Self::NAMES
                .entries()
                .find(|(k, _)| strings::eql_case_insensitive_asciii_check_length(k, slice))
                .map(|(_, v)| *v)
        })
    }

    pub fn supports_client_entry_point(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    #[inline]
    pub fn is_jsx(self) -> bool {
        self == Loader::Jsx || self == Loader::Tsx
    }

    #[inline]
    pub fn is_typescript(self) -> bool {
        self == Loader::Tsx || self == Loader::Ts
    }

    #[inline]
    pub fn is_javascript_like(self) -> bool {
        matches!(self, Loader::Jsx | Loader::Js | Loader::Ts | Loader::Tsx)
    }

    // PORT NOTE: spelling-aliases for the canonical `is_typescript` /
    // `is_javascript_like*` (acronym-collapsing rule). Hoisted from
    // `bun_bundler::options::LoaderExt` so cross-crate callers (bun_jsc,
    // bun_runtime) resolve them as inherent methods without a trait import.
    #[inline]
    pub fn is_type_script(self) -> bool {
        self.is_typescript()
    }
    #[inline]
    pub fn is_java_script_like(self) -> bool {
        self.is_javascript_like()
    }
    #[inline]
    pub fn is_java_script_like_or_json(self) -> bool {
        self.is_javascript_like_or_json()
    }

    pub fn is_javascript_like_or_json(self) -> bool {
        matches!(
            self,
            Loader::Jsx
                | Loader::Js
                | Loader::Ts
                | Loader::Tsx
                | Loader::Json
                | Loader::Jsonc
                // toml, yaml, and json5 are included because we can serialize to the same AST as JSON
                | Loader::Toml
                | Loader::Yaml
                | Loader::Json5
        )
    }

    // `for_file_name` is generic over `anytype` map; callers in bun_bundler
    // implement it locally with their concrete map type.

    pub fn side_effects(self) -> SideEffects {
        match self {
            Loader::Text
            | Loader::Json
            | Loader::Jsonc
            | Loader::Toml
            | Loader::Yaml
            | Loader::Json5
            | Loader::File
            | Loader::Md => SideEffects::NoSideEffectsPureData,
            _ => SideEffects::HasSideEffects,
        }
    }
}

/// `resolver/resolver.zig` `SideEffects`.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub enum SideEffects {
    /// The default value conservatively considers all files to have side effects.
    #[default]
    HasSideEffects,

    /// This file was listed as not having side effects by a "package.json"
    /// file in one of our containing directories with a "sideEffects" field.
    NoSideEffectsPackageJson,

    /// This file is considered to have no side effects because the AST was empty
    /// after parsing finished. This should be the case for ".d.ts" files.
    NoSideEffectsEmptyAst,

    /// This file was loaded using a data-oriented loader (e.g. "text") that is
    /// known to not have side effects.
    NoSideEffectsPureData,
    // /// Same as above but it came from a plugin. We don't want to warn about
    // /// unused imports to these files since running the plugin is a side effect.
    // /// Removing the import would not call the plugin which is observable.
    // NoSideEffectsPureDataFromPlugin,
}

// ported from: src/options_types/BundleEnums.zig (Loader, SideEffects)
