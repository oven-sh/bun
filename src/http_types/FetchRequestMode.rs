/// https://developer.mozilla.org/en-US/docs/Web/API/Request/mode
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FetchRequestMode {
    SameOrigin,
    NoCors,
    Cors,
    Navigate,
}

bun_core::comptime_string_map! {
    pub static MAP: FetchRequestMode = {
        b"same-origin" => FetchRequestMode::SameOrigin,
        b"no-cors" => FetchRequestMode::NoCors,
        b"cors" => FetchRequestMode::Cors,
        b"navigate" => FetchRequestMode::Navigate,
    };
}

impl FetchRequestMode {
    /// Same map as the module-level `MAP` static (the type is a zero-sized
    /// handle over static data); external callers reach it as
    /// `FetchRequestMode::MAP`.
    pub const MAP: __ComptimeStringMap_MAP = __ComptimeStringMap_MAP(());
    // `to_js` is provided as an extension-trait method in `bun_http_jsc`
}
