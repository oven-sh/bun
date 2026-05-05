// GENERATED: re-run peechy (src/api/schema.peechy) with .rs output
// source: src/options_types/schema.zig (3224 lines)
// PORT STATUS: skipped — generated file (see PORTING.md §Don't translate)
//
// B-2: minimal hand-stubbed `api` namespace so Context.rs / BundleEnums.rs
// struct fields type-check. Full body arrives when peechy emits .rs.
pub mod api {
    /// schema.zig:1172 — `enum(u32)`
    #[repr(u32)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum DotEnvBehavior {
        #[default]
        _none,
        disable,
        prefix,
        load_all,
        load_all_without_inlining,
    }

    /// schema.zig:1639 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct TransformOptions {
        _opaque: (), // TODO(b2): peechy-generated fields
    }

    /// schema.zig:2973 — opaque until peechy codegen lands.
    #[derive(Default, Debug)]
    pub struct BunInstall {
        _opaque: (), // TODO(b2): peechy-generated fields
    }

    /// schema.zig:1967 — `enum(u8)` (open). Generated body emits `_` open
    /// variant; Rust side keeps it closed since callers exhaustively match
    /// only the four named tags (see bundler/options.rs `SourceMapOption`).
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum SourceMapMode {
        #[default]
        None,
        Inline,
        External,
        Linked,
    }

    /// schema.zig:732 — `enum(u8)` (open). Kept closed; `BundleEnums::Target::from`
    /// guards the open tail with a `_ => Browser` arm.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum Target {
        #[default]
        _none = 0,
        browser = 1,
        node = 2,
        bun = 3,
        bun_macro = 4,
    }

    /// schema.zig:325 — `enum(u8)` (open), `_none = 254`. Kept closed;
    /// `BundleEnums::Loader::from_api` guards the open tail with `_ => File`.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum Loader {
        #[default]
        _none = 254,
        jsx = 1,
        js = 2,
        ts = 3,
        tsx = 4,
        css = 5,
        file = 6,
        json = 7,
        jsonc = 8,
        toml = 9,
        wasm = 10,
        napi = 11,
        base64 = 12,
        dataurl = 13,
        text = 14,
        bunsh = 15,
        sqlite = 16,
        sqlite_embedded = 17,
        html = 18,
        yaml = 19,
        json5 = 20,
        md = 21,
    }

    /// schema.zig:2200 — `enum(u8)` (open). Kept closed.
    #[repr(u8)]
    #[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
    pub enum ImportKind {
        #[default]
        _none = 0,
        entry_point = 1,
        stmt = 2,
        require = 3,
        dynamic = 4,
        require_resolve = 5,
        at = 6,
        url = 7,
        internal = 8,
    }
}
