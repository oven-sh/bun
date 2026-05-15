/// https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
#[repr(u8)] // conceptually a 2-bit enum — Rust has no u2; u8 is the smallest repr
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
    // `to_js` is provided as an extension-trait method in `bun_http_jsc`
    // (see PORTING.md §Idiom map, *_jsc alias rule).
}
