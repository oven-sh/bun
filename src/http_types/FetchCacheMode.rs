/// https://developer.mozilla.org/en-US/docs/Web/API/Request/cache
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FetchCacheMode {
    Default,
    NoStore,
    Reload,
    NoCache,
    ForceCache,
    OnlyIfCached,
}

bun_core::comptime_string_map! {
    pub static MAP: FetchCacheMode = {
        b"default" => FetchCacheMode::Default,
        b"no-store" => FetchCacheMode::NoStore,
        b"reload" => FetchCacheMode::Reload,
        b"no-cache" => FetchCacheMode::NoCache,
        b"force-cache" => FetchCacheMode::ForceCache,
        b"only-if-cached" => FetchCacheMode::OnlyIfCached,
    };
}

impl FetchCacheMode {
    /// The map type is a zero-sized handle, so this is the same map as the
    /// module-level `MAP` static.
    pub const MAP: __ComptimeStringMap_MAP = __ComptimeStringMap_MAP(());
    // to_js lives as an extension-trait method in bun_http_jsc (see PORTING.md §Idiom map).
}
