//! What a request may ask for, and what a page may get of a response.

use bun_core::strings;

use crate::headers::{HeaderList, is_cors_safelisted, split, tokens};
use crate::mime;
use crate::origin::{Origin, is_potentially_trustworthy, is_schemelessly_same_site};
use crate::request::Destination;
use crate::url::Url;
use crate::{Bytes, sniff};

/// https://fetch.spec.whatwg.org/#port-blocking
pub fn has_bad_port(url: &Url) -> bool {
    url.is_http_or_ws()
        && matches!(
            url.port(),
            Some(
                0
                | 1
                | 7
                | 9
                | 11
                | 13
                | 15
                | 17
                | 19..=23
                | 25
                | 37
                | 42
                | 43
                | 53
                | 69
                | 77
                | 79
                | 87
                | 95
                | 101..=104
                | 109..=111
                | 113
                | 115
                | 117
                | 119
                | 123
                | 135
                | 137
                | 139
                | 143
                | 161
                | 179
                | 389
                | 427
                | 465
                | 512..=515
                | 526
                | 530..=532
                | 540
                | 548
                | 554
                | 556
                | 563
                | 587
                | 601
                | 636
                | 989
                | 990
                | 993
                | 995
                | 1719
                | 1720
                | 1723
                | 2049
                | 3659
                | 4045
                | 4190
                | 5060
                | 5061
                | 6000
                | 6566
                | 6665..=6669
                | 6679
                | 6697
                | 10080,
            )
        )
}

pub fn upgrade_insecure(url: &Url) -> Option<Url> {
    match url.scheme() {
        _ if is_potentially_trustworthy(url) => None,
        b"http" => Some(url.with_scheme(b"https")),
        b"ws" => Some(url.with_scheme(b"wss")),
        _ => None,
    }
}

pub fn is_insecure(url: &Url) -> bool {
    matches!(url.scheme(), b"http" | b"ws") && !is_potentially_trustworthy(url)
}

pub(super) fn default_accept(destination: Destination) -> &'static [u8] {
    match destination {
        Destination::Document | Destination::Frame | Destination::Iframe => {
            b"text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8"
        }
        Destination::Image => b"image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Destination::Json => b"application/json,*/*;q=0.5",
        Destination::Text => b"text/plain,*/*;q=0.5",
        Destination::Style => b"text/css,*/*;q=0.1",
        _ => b"*/*",
    }
}

/// https://fetch.spec.whatwg.org/#cors-check
pub(super) fn cors_check(headers: &HeaderList, origin: &[u8], includes_credentials: bool) -> bool {
    let allowed = headers.get_or_empty(b"access-control-allow-origin");
    if includes_credentials {
        *allowed == *origin
            && *headers.get_or_empty(b"access-control-allow-credentials") == *b"true"
    } else {
        *allowed == *b"*" || *allowed == *origin
    }
}

/// https://fetch.spec.whatwg.org/#concept-tao-check, for a response that is not of that origin.
pub(super) fn tao_check(headers: &HeaderList, origin: &[u8]) -> bool {
    split(&headers.get_or_empty(b"timing-allow-origin"), b',').any(|it| it == b"*" || it == origin)
}

/// https://fetch.spec.whatwg.org/#cors-unsafe-request-header-names
pub(super) fn cors_unsafe_names(headers: &HeaderList) -> Vec<Vec<u8>> {
    let (safe, mut unsafe_): (Vec<_>, Vec<_>) = headers
        .sorted_and_combined()
        .into_iter()
        .partition(|it| is_cors_safelisted(&it.0, &it.1));
    if safe.iter().map(|it| it.1.len()).sum::<usize>() > 1024 {
        unsafe_ = headers.sorted_and_combined();
    }
    unsafe_.into_iter().map(|it| it.0).collect()
}

pub(super) fn is_cors_safelisted_method(method: &[u8]) -> bool {
    matches!(method, b"GET" | b"HEAD" | b"POST")
}

/// What the answer to a preflight allows.
pub(super) struct Allowed {
    methods: Vec<Bytes>,
    names: Vec<Bytes>,
    pub until: f64,
}

impl Allowed {
    pub(super) fn parse(headers: &HeaderList, now: f64) -> Option<Allowed> {
        let list = |value: &[u8]| Some(tokens(value)?.into_iter().map(Bytes::from).collect());
        let age = headers.get_or_empty(b"access-control-max-age");
        Some(Allowed {
            methods: list(&headers.get_or_empty(b"access-control-allow-methods"))?,
            names: list(
                &headers
                    .get_or_empty(b"access-control-allow-headers")
                    .to_ascii_lowercase(),
            )?,
            until: now
                + bun_core::fmt::parse_int::<i64>(&age, 10).map_or(5.0, |it| it.min(7200) as f64),
        })
    }

    pub(super) fn covers(
        &self,
        method: &[u8],
        names: &[Vec<u8>],
        includes_credentials: bool,
    ) -> bool {
        let lists = |list: &[Bytes], wanted: &[u8]| {
            list.iter()
                .any(|it| **it == *wanted || (!includes_credentials && **it == *b"*"))
        };
        (is_cors_safelisted_method(method) || lists(&self.methods, method))
            && names.iter().all(|it| lists(&self.names, it))
    }
}

/// By `nosniff`, or because that cannot be a script.
pub(super) fn is_blocked_by_mime_type(headers: &HeaderList, destination: Destination) -> bool {
    let is_style = destination == Destination::Style;
    if !is_style && !destination.is_script_like() {
        return false;
    }
    let mime = headers.mime();
    let essence = mime.as_ref().map_or(&b""[..], |it| it.essence());
    if headers.is_nosniff() {
        return if is_style {
            essence != b"text/css"
        } else {
            !mime::is_javascript(essence)
        };
    }
    !is_style
        && (essence == b"text/csv"
            || matches!(mime::type_of(essence), b"audio" | b"image" | b"video"))
}

keywords! {
    /// Of `Cross-Origin-Embedder-Policy`, and what those of `Document-Isolation-Policy` come to.
    #[derive(Default)]
    pub enum EmbedderPolicy {
        #[default]
        UnsafeNone = b"unsafe-none",
        RequireCorp = b"require-corp",
        Credentialless = b"credentialless",
    }
}

/// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-internal-check
pub fn corp_allows(
    origin: &Origin,
    policy: EmbedderPolicy,
    url: &Url,
    headers: &HeaderList,
    includes_credentials: bool,
    is_navigation: bool,
) -> bool {
    if is_navigation && policy == EmbedderPolicy::UnsafeNone {
        return true;
    }
    match &*headers.get_or_empty(b"cross-origin-resource-policy") {
        b"cross-origin" => true,
        b"same-site" => {
            origin
                .to_url()
                .is_some_and(|it| is_schemelessly_same_site(&it, url))
                && (origin.is_https() || url.scheme() != b"https")
        }
        b"same-origin" => origin.is_origin_of(url),
        _ => match policy {
            EmbedderPolicy::UnsafeNone => true,
            EmbedderPolicy::Credentialless if !includes_credentials && !is_navigation => true,
            _ => origin.is_origin_of(url),
        },
    }
}

/// https://github.com/annevk/orb, as Chromium has it. `None` if that depends on the body.
pub(super) fn orb_blocks_by_headers(headers: &HeaderList, status: u16) -> Option<bool> {
    let mime = headers.mime();
    let essence = mime.as_ref().map_or(&b""[..], |it| it.essence());
    match essence {
        b"text/css"
        | b"image/svg+xml"
        | b"text/vtt"
        | b"application/dash+xml"
        | b"application/vnd.apple.mpegurl" => return Some(false),
        b"application/mpegurl"
        | b"application/x-mpegurl"
        | b"audio/mpegurl"
        | b"audio/x-mpegurl"
        | b"audio/mpeg" => return Some(false),
        b"application/gzip"
        | b"application/x-gzip"
        | b"application/zip"
        | b"application/pdf"
        | b"application/x-protobuf" => return Some(true),
        b"application/msexcel"
        | b"application/mspowerpoint"
        | b"application/msword"
        | b"application/msword-template" => return Some(true),
        b"application/x-protobuffer"
        | b"multipart/byteranges"
        | b"multipart/signed"
        | b"text/csv"
        | b"text/event-stream" => return Some(true),
        _ => {}
    }
    let is_office = [
        &b"application/vnd.ms-"[..],
        b"application/vnd.ces-",
        b"application/vnd.openxmlformats-",
        b"application/vnd.msword",
        b"application/vnd.presentation-openxml",
        b"application/vnd.spreadsheet-openxml",
        b"application/vnd.wordprocessing-openxml",
    ];
    let is_protected = essence == b"text/html" || mime::is_json(essence) || mime::is_xml(essence);
    if is_office.iter().any(|it| essence.starts_with(it))
        || (is_protected && status == 206)
        || ((is_protected || essence == b"text/plain") && headers.is_nosniff())
    {
        Some(true)
    } else {
        let range = headers.get_or_empty(b"content-range");
        (status == 206
            && !strings::trim_left(range.get(5..).unwrap_or_default(), b" ").starts_with(b"0-"))
        .then_some(false)
    }
}

pub(super) fn orb_blocks_by_body(headers: &HeaderList, status: u16, start: &[u8]) -> bool {
    if (headers.mime()).is_some_and(|it| mime::is_javascript(it.essence())) {
        return sniff::is_only_for_fetch(start);
    }
    if sniff::is_audio_or_video(start) || sniff::image(start).is_some() {
        return false;
    }
    sniff::is_html(start)
        || sniff::is_xml(start)
        || sniff::is_only_for_fetch(start)
        || headers.is_nosniff()
        || !matches!(status, 200..=299)
        || headers
            .mime()
            .is_some_and(|it| matches!(mime::type_of(it.essence()), b"audio" | b"image" | b"video"))
}
