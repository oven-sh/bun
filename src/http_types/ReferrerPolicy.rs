/// https://developer.mozilla.org/en-US/docs/Web/API/Request/referrerPolicy
/// https://w3c.github.io/webappsec-referrer-policy/#referrer-policy
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default, strum::IntoStaticStr)]
pub enum ReferrerPolicy {
    /// The empty string: defer to the environment's default policy, which for
    /// `fetch()` is `strict-origin-when-cross-origin`.
    #[default]
    #[strum(serialize = "")]
    Empty,
    #[strum(serialize = "no-referrer")]
    NoReferrer,
    #[strum(serialize = "no-referrer-when-downgrade")]
    NoReferrerWhenDowngrade,
    #[strum(serialize = "same-origin")]
    SameOrigin,
    #[strum(serialize = "origin")]
    Origin,
    #[strum(serialize = "strict-origin")]
    StrictOrigin,
    #[strum(serialize = "origin-when-cross-origin")]
    OriginWhenCrossOrigin,
    #[strum(serialize = "strict-origin-when-cross-origin")]
    StrictOriginWhenCrossOrigin,
    #[strum(serialize = "unsafe-url")]
    UnsafeUrl,
}

bun_core::comptime_string_map! {
    pub static MAP: ReferrerPolicy = {
        b"" => ReferrerPolicy::Empty,
        b"no-referrer" => ReferrerPolicy::NoReferrer,
        b"no-referrer-when-downgrade" => ReferrerPolicy::NoReferrerWhenDowngrade,
        b"same-origin" => ReferrerPolicy::SameOrigin,
        b"origin" => ReferrerPolicy::Origin,
        b"strict-origin" => ReferrerPolicy::StrictOrigin,
        b"origin-when-cross-origin" => ReferrerPolicy::OriginWhenCrossOrigin,
        b"strict-origin-when-cross-origin" => ReferrerPolicy::StrictOriginWhenCrossOrigin,
        b"unsafe-url" => ReferrerPolicy::UnsafeUrl,
    };
}

impl ReferrerPolicy {
    /// The map type is a zero-sized handle, so this is the same map as the
    /// module-level `MAP` static.
    pub const MAP: __ComptimeStringMap_MAP = __ComptimeStringMap_MAP(());

    pub fn as_str(self) -> &'static str {
        self.into()
    }
    // to_js lives as an extension-trait method in bun_http_jsc (see PORTING.md §Idiom map).
}
