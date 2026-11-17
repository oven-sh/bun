//! https://w3c.github.io/webappsec-referrer-policy/

use crate::headers::tokens;
use crate::origin::{self, is_potentially_trustworthy};
use crate::url::Url;

keywords! {
    #[derive(Default)]
    pub enum ReferrerPolicy {
        #[default]
        Empty = b"",
        NoReferrer = b"no-referrer",
        NoReferrerWhenDowngrade = b"no-referrer-when-downgrade",
        SameOrigin = b"same-origin",
        Origin = b"origin",
        StrictOrigin = b"strict-origin",
        OriginWhenCrossOrigin = b"origin-when-cross-origin",
        StrictOriginWhenCrossOrigin = b"strict-origin-when-cross-origin",
        UnsafeUrl = b"unsafe-url",
    }
}

impl ReferrerPolicy {
    pub fn from_header(value: &[u8]) -> ReferrerPolicy {
        let lower = value.to_ascii_lowercase();
        tokens(&lower)
            .and_then(|it| it.into_iter().rev().find_map(ReferrerPolicy::parse))
            .unwrap_or_default()
    }

    pub fn or(self, other: ReferrerPolicy) -> ReferrerPolicy {
        if self == ReferrerPolicy::Empty {
            other
        } else {
            self
        }
    }

    /// https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
    pub fn referrer(self, source: &Url, target: &Url) -> Option<Url> {
        use ReferrerPolicy::*;
        source.is_http().then_some(())?;
        let is_same_origin = origin::Origin::of(source).is_origin_of(target);
        let downgrades = is_potentially_trustworthy(source) && !is_potentially_trustworthy(target);
        let is_full = match self {
            NoReferrer => return None,
            SameOrigin if !is_same_origin => return None,
            StrictOrigin | NoReferrerWhenDowngrade if downgrades => return None,
            Empty | StrictOriginWhenCrossOrigin if !is_same_origin && downgrades => return None,
            Origin | StrictOrigin => false,
            UnsafeUrl | SameOrigin | NoReferrerWhenDowngrade => true,
            Empty | OriginWhenCrossOrigin | StrictOriginWhenCrossOrigin => is_same_origin,
        };
        Some(source.stripped())
            .filter(|it| is_full && it.href().len() <= 4096)
            .or_else(|| origin::Origin::of(source).to_url())
    }
}
