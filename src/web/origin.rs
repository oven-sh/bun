//! Origins, sites and secure contexts.

use core::sync::atomic::{AtomicU32, Ordering};

use bun_core::strings;

use crate::Bytes;
use crate::scheme::{Privileges, is_standard, privileges_of};
use crate::url::{Url, is_address};

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum Origin {
    Opaque(u32),
    Tuple(Bytes),
}

impl Origin {
    pub fn new_opaque() -> Origin {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        Origin::Opaque(NEXT.fetch_add(1, Ordering::Relaxed))
    }

    pub fn of(url: &Url) -> Origin {
        match url.scheme() {
            b"file" => Origin::Tuple(b"file://"[..].into()),
            b"blob" if url.path().starts_with(b"blob:") => Origin::new_opaque(),
            b"blob" => Url::parse(url.path()).map_or_else(Origin::new_opaque, |it| Origin::of(&it)),
            scheme if url.is_http_or_ws() || scheme == b"ftp" || is_standard(scheme) => {
                Origin::Tuple([url.protocol(), b"//", url.host()].concat().into())
            }
            _ => Origin::new_opaque(),
        }
    }

    pub fn from_serialized(text: &[u8]) -> Origin {
        if text == b"null" {
            Origin::new_opaque()
        } else {
            Origin::Tuple(text.into())
        }
    }

    pub fn as_bytes(&self) -> &[u8] {
        match self {
            Origin::Opaque(_) => b"null",
            Origin::Tuple(it) => it,
        }
    }

    /// The same for the same origin, even an opaque one.
    pub fn key(&self) -> Vec<u8> {
        match self {
            Origin::Opaque(id) => format!("null {id}").into_bytes(),
            Origin::Tuple(it) => it.to_vec(),
        }
    }

    pub fn is_opaque(&self) -> bool {
        matches!(self, Origin::Opaque(_))
    }

    pub fn is_https(&self) -> bool {
        self.as_bytes().starts_with(b"https:")
    }

    pub fn is_origin_of(&self, url: &Url) -> bool {
        *self == Origin::of(url)
    }

    pub fn to_url(&self) -> Option<Url> {
        Url::parse(self.as_bytes())
    }

    pub fn is_same_site_with(&self, url: &Url) -> bool {
        self.to_url().is_some_and(|it| is_same_site(&it, url))
    }
}

/// https://html.spec.whatwg.org/multipage/browsers.html#site
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Site(Bytes);

impl Site {
    pub fn of(url: &Url) -> Site {
        Site(
            [url.protocol(), b"//", registrable_domain(url.hostname())]
                .concat()
                .into(),
        )
    }

    pub fn of_origin(origin: &Origin) -> Site {
        origin
            .to_url()
            .map_or_else(|| Site(b"null"[..].into()), |it| Site::of(&it))
    }

    pub fn from_serialized(text: &[u8]) -> Site {
        Site(text.into())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

pub(crate) fn is_loopback(host: &[u8]) -> bool {
    matches!(host, b"localhost" | b"[::1]")
        || host.ends_with(b".localhost")
        || (host.starts_with(b"127.") && is_address(host))
}

/// https://w3c.github.io/webappsec-secure-contexts/#is-url-trustworthy
pub fn is_potentially_trustworthy(url: &Url) -> bool {
    match url.scheme() {
        b"https" | b"wss" | b"file" | b"about" | b"data" | b"blob" => true,
        b"http" | b"ws" if is_loopback(url.hostname()) => true,
        scheme => privileges_of(scheme).contains(Privileges::SECURE),
    }
}

/// The rules of https://publicsuffix.org/list/ (MPL-2.0) of 2026-09-02 that have a dot: a line for each last label,
/// followed by what the rules have before it.
static PUBLIC_SUFFIXES: &[u8] = include_bytes!("public_suffixes.txt");

/// Where the public suffix of `host` starts.
fn public_suffix_start(host: &[u8]) -> usize {
    let Some((before, last)) = strings::rsplit_once_char(host, b'.') else {
        return 0;
    };
    let Some(start) = strings::index_of(PUBLIC_SUFFIXES, &[b"\n", last, b" "].concat()) else {
        return before.len() + 1;
    };
    let line = &PUBLIC_SUFFIXES[start + 1 + last.len()..];
    let line = &line[..strings::index_of_char_usize(line, b'\n').unwrap_or(line.len())];
    let has =
        |prefix: &[u8], name: &[u8]| strings::contains(line, &[b" ", prefix, name, b" "].concat());
    let mut at = 0;
    loop {
        let name = &before[at..];
        let dot = strings::index_of_char_usize(name, b'.').unwrap_or(name.len());
        if has(b"!", name) {
            return at + dot + 1;
        }
        if has(b"", name) || has(b"*", &name[dot..]) {
            return at;
        }
        if dot == name.len() {
            return before.len() + 1;
        }
        at += dot + 1;
    }
}

/// What can be registered, of a host that is a domain. All of any other.
pub fn registrable_domain(host: &[u8]) -> &[u8] {
    if is_address(host) {
        return host;
    }
    let bare = host.strip_suffix(b".").unwrap_or(host);
    let before = &bare[..public_suffix_start(bare).saturating_sub(1)];
    &host[strings::last_index_of_char(before, b'.').map_or(0, |dot| dot + 1)..]
}

/// Or what a wildcard makes public suffixes of.
pub fn is_public_suffix(host: &[u8]) -> bool {
    public_suffix_start(&[b"_.", host.strip_suffix(b".").unwrap_or(host)].concat()) <= 2
}

pub fn is_schemelessly_same_site(a: &Url, b: &Url) -> bool {
    let (a, b) = (a.hostname(), b.hostname());
    let common = a
        .iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|it| it.0 == it.1)
        .count();
    a == b
        || (strings::contains_char(&a[a.len() - common..], b'.')
            && registrable_domain(a) == registrable_domain(b))
}

pub fn is_same_site(a: &Url, b: &Url) -> bool {
    fn as_http(url: &Url) -> &[u8] {
        match url.scheme() {
            b"ws" => b"http",
            b"wss" => b"https",
            other => other,
        }
    }
    as_http(a) == as_http(b) && is_schemelessly_same_site(a, b)
}
