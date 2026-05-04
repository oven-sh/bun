/// https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
#[repr(u8)] // Zig: enum(u3) — Rust has no u3, u8 is the smallest repr
#[derive(Copy, Clone, Eq, PartialEq, Debug, strum::IntoStaticStr)]
pub enum FetchCacheMode {
    #[strum(serialize = "default")]
    Default,
    #[strum(serialize = "no-store")]
    NoStore,
    #[strum(serialize = "reload")]
    Reload,
    #[strum(serialize = "no-cache")]
    NoCache,
    #[strum(serialize = "force-cache")]
    ForceCache,
    #[strum(serialize = "only-if-cached")]
    OnlyIfCached,
}

impl FetchCacheMode {
    pub const MAP: phf::Map<&'static [u8], FetchCacheMode> = phf::phf_map! {
        b"default" => FetchCacheMode::Default,
        b"no-store" => FetchCacheMode::NoStore,
        b"reload" => FetchCacheMode::Reload,
        b"no-cache" => FetchCacheMode::NoCache,
        b"force-cache" => FetchCacheMode::ForceCache,
        b"only-if-cached" => FetchCacheMode::OnlyIfCached,
    };
    // Zig `pub const toJS = @import("../http_jsc/fetch_enums_jsc.zig").fetchCacheModeToJS;`
    // deleted — to_js lives as an extension-trait method in bun_http_jsc (see PORTING.md §Idiom map).
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/FetchCacheMode.zig (21 lines)
//   confidence: high
//   todos:      0
//   notes:      phf_map! is not const-evaluable as an associated const in current phf; Phase B may need `pub static MAP` at module scope instead.
// ──────────────────────────────────────────────────────────────────────────
