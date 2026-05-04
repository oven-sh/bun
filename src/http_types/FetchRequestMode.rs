/// https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
#[repr(u8)] // Zig: enum(u2) — Rust has no u2; u8 is the smallest repr
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FetchRequestMode {
    SameOrigin,
    NoCors,
    Cors,
    Navigate,
}

impl FetchRequestMode {
    pub const MAP: phf::Map<&'static [u8], FetchRequestMode> = phf::phf_map! {
        b"same-origin" => FetchRequestMode::SameOrigin,
        b"no-cors" => FetchRequestMode::NoCors,
        b"cors" => FetchRequestMode::Cors,
        b"navigate" => FetchRequestMode::Navigate,
    };
    // `pub const toJS = @import("../http_jsc/fetch_enums_jsc.zig").fetchRequestModeToJS;`
    // → deleted: `to_js` is provided as an extension-trait method in `bun_http_jsc`
    //   (see PORTING.md §Idiom map, *_jsc alias rule).
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http_types/FetchRequestMode.zig (17 lines)
//   confidence: high
//   todos:      0
//   notes:      enum(u2)→repr(u8); ComptimeStringMap→phf; toJS alias dropped (lives in bun_http_jsc ext trait)
// ──────────────────────────────────────────────────────────────────────────
