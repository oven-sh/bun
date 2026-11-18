//! https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html

use bun_core::strings;

use crate::Bytes;
use crate::headers::{digits, trim_tabs_and_spaces as trim};
use crate::origin::{Site, is_potentially_trustworthy, is_public_suffix, registrable_domain};
use crate::scheme;
use crate::time::{parse_date, wall_now};
use crate::url::{Url, is_address};

const MAX_AGE: f64 = 400.0 * 86_400.0;
const MAX_FOR_SITE: usize = 180;
const MAX_COOKIES: usize = 3300;
const EVICTED_AT_ONCE: usize = 30;
const LAX_ALLOWING_UNSAFE_AGE: f64 = 120.0;

keywords! {
    pub enum SameSite {
        Unspecified = b"unspecified",
        None = b"no_restriction",
        Lax = b"lax",
        Strict = b"strict",
    }
}

keywords! {
    pub enum Cause {
        Inserted = b"inserted",
        InsertedSame = b"inserted-no-change-overwrite",
        InsertedSameValue = b"inserted-no-value-change-overwrite",
        Explicit = b"explicit",
        Overwrite = b"overwrite",
        Expired = b"expired",
        ExpiredOverwrite = b"expired-overwrite",
        Evicted = b"evicted",
    }
}

impl Cause {
    pub fn removes(self) -> bool {
        !matches!(
            self,
            Cause::Inserted | Cause::InsertedSame | Cause::InsertedSameValue
        )
    }
}

crate::wire! {
    #[derive(Clone)]
    pub struct Cookie {
        pub name: Bytes,
        pub value: Bytes,
        /// Without a dot before it.
        pub domain: Bytes,
        pub is_host_only: bool,
        pub path: Bytes,
        pub is_secure: bool,
        pub is_http_only: bool,
        /// In seconds since the epoch. Without it, it is for this session.
        pub expires: Option<f64>,
        pub same_site: SameSite,
        /// The site of the top-level document that it is for.
        pub partition: Option<Site>,
        pub created: f64,
    }
}

crate::wire! {
    #[derive(Clone)]
    pub struct Change {
        pub cookie: Cookie,
        pub cause: Cause,
    }
}

impl Change {
    /// Whoever looks next notices it.
    pub(crate) fn is_loss(&self) -> bool {
        matches!(self.cause, Cause::Expired | Cause::Evicted)
    }

    /// For scripts.
    pub(crate) fn is_news(&self) -> bool {
        !matches!(self.cause, Cause::Overwrite | Cause::InsertedSame) && !self.cookie.is_http_only
    }
}

/// In which cookies are asked for or set.
#[derive(Clone)]
pub struct Context {
    pub is_same_site: bool,
    pub is_top_level_navigation: bool,
    pub has_safe_method: bool,
    pub is_for_script: bool,
    pub top_level_site: Site,
}

pub fn domain_matches(host: &[u8], cookie_domain: &[u8]) -> bool {
    host.strip_suffix(cookie_domain)
        .is_some_and(|it| it.is_empty() || (it.ends_with(b".") && !is_address(host)))
}

fn path_matches(path: &[u8], cookie_path: &[u8]) -> bool {
    path.strip_prefix(cookie_path)
        .is_some_and(|it| it.is_empty() || cookie_path.ends_with(b"/") || it[0] == b'/')
}

fn has_cookies(url: &Url) -> bool {
    url.is_http_or_ws() || scheme::is_standard(url.scheme())
}

pub fn default_path(url: &Url) -> &[u8] {
    let path = url.path();
    Some(&path[..strings::last_index_of_char(path, b'/').unwrap_or(0)])
        .filter(|it| !it.is_empty())
        .unwrap_or(b"/")
}

fn has_control(text: &[u8]) -> bool {
    text.iter().any(|it| matches!(it, 0..=8 | 10..=0x1f | 0x7f))
}

fn has_prefix(text: &[u8], prefix: &[u8]) -> bool {
    text.get(..prefix.len())
        .is_some_and(|it| it.eq_ignore_ascii_case(prefix))
}

/// The domain, and whether that is for the host only. `None` if it is not a domain.
pub fn domain_for(url: &Url, given: &[u8]) -> Option<(Bytes, bool)> {
    if given.is_empty() {
        return Some((url.hostname().into(), true));
    }
    let given = given.strip_prefix(b".").unwrap_or(given);
    let parsed = Url::parse(&[b"http://", given].concat())
        .filter(|it| it.href().len() == "http:///".len() + it.hostname().len())?;
    let domain = parsed.hostname();
    Some((
        domain.into(),
        domain == url.hostname() && (is_address(domain) || is_public_suffix(domain)),
    ))
}

#[derive(Clone, Copy)]
pub enum Invalid {
    UnsupportedScheme,
    ControlCharacters,
    Domain,
    SecureFromInsecureUrl,
    SameSiteNoneInsecure,
    PartitionedInsecure,
    TooLong,
    NoName,
    Prefix,
}

impl core::fmt::Display for Invalid {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Invalid::UnsupportedScheme => {
                "Attempted to set a cookie from a scheme that does not support cookies."
            }
            Invalid::ControlCharacters => {
                "The cookie contains ASCII control characters or semicolons."
            }
            Invalid::Domain => "The cookie was set with an invalid Domain attribute.",
            Invalid::SecureFromInsecureUrl => "Secure cookies can only be set from secure URLs.",
            Invalid::SameSiteNoneInsecure => "SameSite=None requires Secure.",
            Invalid::PartitionedInsecure => "Partitioned requires Secure.",
            Invalid::TooLong => "The name and the value are too long.",
            Invalid::NoName => "The cookie has no name.",
            Invalid::Prefix => "The cookie violated the requirements of its prefix.",
        })
    }
}

impl Cookie {
    pub fn parse(header: &[u8], url: &Url, top_level_site: &Site) -> Option<Cookie> {
        if has_control(header) {
            return None;
        }
        let mut parts = strings::split(header, b";");
        let pair = parts.next()?;
        let (name, value) = strings::split_once_char(pair, b'=').unwrap_or((b"", pair));
        let created = wall_now();
        let (mut domain, mut path, mut max_age, mut expires) = (&b""[..], None, None, None);
        let (mut is_secure, mut is_http_only, mut same_site, mut partition) =
            (false, false, SameSite::Unspecified, None);
        for part in parts {
            let (name, value) = strings::split_once_char(part, b'=').unwrap_or((part, b""));
            let value = trim(value);
            if value.len() > 1024 {
                continue;
            }
            match &*trim(name).to_ascii_lowercase() {
                b"domain" => domain = value,
                b"path" => path = Some(value),
                b"expires" => expires = parse_date(value).or(expires),
                b"max-age" => {
                    let seconds = value
                        .strip_prefix(b"-")
                        .map_or_else(|| digits(value), |it| digits(it).map(|_| 0));
                    max_age = seconds
                        .map(|it| if it == 0 { 0.0 } else { created + it as f64 })
                        .or(max_age);
                }
                b"secure" => is_secure = true,
                b"httponly" => is_http_only = true,
                b"partitioned" => partition = Some(top_level_site.clone()),
                b"samesite" => {
                    same_site = match &*value.to_ascii_lowercase() {
                        b"none" => SameSite::None,
                        b"lax" => SameSite::Lax,
                        b"strict" => SameSite::Strict,
                        _ => SameSite::Unspecified,
                    }
                }
                _ => {}
            }
        }
        if has_prefix(trim(name), b"__host-") && (!domain.is_empty() || path != Some(b"/")) {
            return None;
        }
        let (domain, is_host_only) = domain_for(url, domain)?;
        Some(Cookie {
            name: trim(name).into(),
            value: trim(value).into(),
            domain,
            is_host_only,
            path: path
                .filter(|it| it.starts_with(b"/"))
                .unwrap_or_else(|| default_path(url))
                .into(),
            is_secure,
            is_http_only,
            expires: max_age.or(expires).map(|it| it.min(created + MAX_AGE)),
            same_site,
            partition,
            created,
        })
    }

    /// What is wrong with it.
    pub fn validate(&self, url: &Url) -> Result<(), Invalid> {
        let (name, value) = (&*self.name, &*self.value);
        let is_host = has_prefix(name, b"__host-");
        let is_http = has_prefix(name, b"__http-") || has_prefix(name, b"__host-http-");
        let looks_prefixed = [&b"__host-"[..], b"__secure-", b"__http-"]
            .iter()
            .any(|it| has_prefix(value, it));
        Err(if !has_cookies(url) {
            Invalid::UnsupportedScheme
        } else if [name, value]
            .iter()
            .any(|it| has_control(it) || strings::contains_char(it, b';'))
        {
            Invalid::ControlCharacters
        } else if !self.is_host_only
            && (!domain_matches(url.hostname(), &self.domain) || is_public_suffix(&self.domain))
        {
            Invalid::Domain
        } else if self.is_secure && !is_potentially_trustworthy(url) {
            Invalid::SecureFromInsecureUrl
        } else if self.same_site == SameSite::None && !self.is_secure {
            Invalid::SameSiteNoneInsecure
        } else if self.partition.is_some() && !self.is_secure {
            Invalid::PartitionedInsecure
        } else if name.len() + value.len() > 4096 {
            Invalid::TooLong
        } else if name.is_empty()
            && (value.is_empty() || looks_prefixed || strings::contains_char(value, b'='))
        {
            Invalid::NoName
        } else if (is_http && !(self.is_secure && self.is_http_only))
            || ((is_host || has_prefix(name, b"__secure-")) && !self.is_secure)
            || (is_host && !(self.is_host_only && *self.path == *b"/"))
        {
            Invalid::Prefix
        } else {
            return Ok(());
        })
    }

    pub fn applies_to(&self, url: &Url) -> bool {
        (if self.is_host_only {
            *url.hostname() == *self.domain
        } else {
            domain_matches(url.hostname(), &self.domain)
        }) && path_matches(url.path_or_root(), &self.path)
            && (!self.is_secure || is_potentially_trustworthy(url))
    }

    pub(crate) fn is_visible_at(&self, url: &Url, context: &Context) -> bool {
        has_cookies(url) && self.applies_to(url) && self.is_sent_in(context, wall_now())
    }

    fn is_sent_in(&self, context: &Context, now: f64) -> bool {
        !(context.is_for_script && self.is_http_only)
            && self
                .partition
                .as_ref()
                .is_none_or(|it| *it == context.top_level_site)
            && (context.is_same_site
                || match self.same_site {
                    SameSite::None => true,
                    SameSite::Strict => false,
                    SameSite::Lax => context.is_top_level_navigation && context.has_safe_method,
                    SameSite::Unspecified => {
                        context.is_top_level_navigation
                            && (context.has_safe_method
                                || now - self.created < LAX_ALLOWING_UNSAFE_AGE)
                    }
                })
    }

    pub fn replaces(&self, other: &Cookie) -> bool {
        (
            &self.name,
            &self.domain,
            self.is_host_only,
            &self.path,
            &self.partition,
        ) == (
            &other.name,
            &other.domain,
            other.is_host_only,
            &other.path,
            &other.partition,
        )
    }

    fn has_expired(&self, now: f64) -> bool {
        self.expires.is_some_and(|it| it <= now)
    }
}

/// The oldest first.
#[derive(Default)]
pub struct Jar {
    cookies: Vec<Cookie>,
    next_expiry: f64,
    changes: Vec<Change>,
    version: u32,
}

impl Jar {
    pub(super) fn restore(&mut self, mut stored: Vec<Cookie>) {
        stored.retain(|it| !self.cookies.iter().any(|newer| newer.replaces(it)));
        self.cookies.splice(..0, stored);
        self.next_expiry = 0.0;
        self.version += 1;
    }

    pub(super) fn take_changes(&mut self) -> Vec<Change> {
        core::mem::take(&mut self.changes)
    }

    /// Another one after every change.
    pub fn version(&mut self) -> u32 {
        self.all();
        self.version
    }

    pub fn all(&mut self) -> &[Cookie] {
        let now = wall_now();
        if now >= self.next_expiry {
            self.remove_if(Cause::Expired, |it| it.has_expired(now));
            self.next_expiry = self
                .cookies
                .iter()
                .filter_map(|it| it.expires)
                .fold(f64::INFINITY, f64::min);
        }
        &self.cookies
    }

    pub fn remove_if(&mut self, cause: Cause, mut is_removed: impl FnMut(&Cookie) -> bool) {
        let before = self.changes.len();
        self.changes.extend(
            self.cookies
                .extract_if(.., |it| is_removed(it))
                .map(|cookie| Change { cookie, cause }),
        );
        self.version += u32::from(self.changes.len() > before);
    }

    pub fn store(&mut self, mut cookie: Cookie) {
        let has_expired = cookie.has_expired(wall_now());
        let at = self.all().iter().position(|it| cookie.replaces(it));
        let mut cause = Cause::Inserted;
        self.version += 1;
        if let Some(at) = at {
            let old = self.cookies.remove(at);
            if old.value == cookie.value {
                let rest = |it: &Cookie| (it.is_secure, it.is_http_only, it.same_site, it.expires);
                cause = match rest(&old) == rest(&cookie) {
                    true => Cause::InsertedSame,
                    false => Cause::InsertedSameValue,
                };
                cookie.created = old.created;
            }
            self.changes.push(Change {
                cookie: old,
                cause: if has_expired {
                    Cause::ExpiredOverwrite
                } else {
                    Cause::Overwrite
                },
            });
        }
        if !has_expired {
            self.next_expiry = self
                .next_expiry
                .min(cookie.expires.unwrap_or(f64::INFINITY));
            self.changes.push(Change {
                cookie: cookie.clone(),
                cause,
            });
            let at = at
                .filter(|_| cause != Cause::Inserted)
                .unwrap_or(self.cookies.len());
            self.cookies.insert(at, cookie);
        }
    }

    pub fn matching(&mut self, url: &Url, context: &Context) -> Vec<&Cookie> {
        if !has_cookies(url) {
            return Vec::new();
        }
        let now = wall_now();
        let mut found: Vec<_> = self
            .all()
            .iter()
            .filter(|it| it.applies_to(url) && it.is_sent_in(context, now))
            .collect();
        bun_collections::index_sort::sort_slice_by_key(&mut found, |it| {
            core::cmp::Reverse(it.path.len())
        });
        found
    }

    pub fn header(&mut self, url: &Url, context: &Context) -> Vec<u8> {
        let mut header = Vec::new();
        for (index, cookie) in self.matching(url, context).into_iter().enumerate() {
            header.extend_from_slice(if index > 0 { b"; " } else { b"" });
            header.extend_from_slice(&cookie.name);
            header.extend_from_slice(if cookie.name.is_empty() { b"" } else { b"=" });
            header.extend_from_slice(&cookie.value);
        }
        header
    }

    /// False if it is refused.
    pub fn receive(&mut self, header: &[u8], url: &Url, context: &Context) -> bool {
        let Some(cookie) = Cookie::parse(header, url, &context.top_level_site)
            .filter(|it| it.validate(url).is_ok())
        else {
            return false;
        };
        if !context.is_same_site
            && !context.is_top_level_navigation
            && cookie.same_site != SameSite::None
        {
            return false;
        }
        let is_secure = is_potentially_trustworthy(url);
        let is_protected = |it: &Cookie| {
            (context.is_for_script && it.is_http_only && cookie.replaces(it))
                || (!is_secure
                    && it.is_secure
                    && it.name == cookie.name
                    && (domain_matches(&cookie.domain, &it.domain)
                        || domain_matches(&it.domain, &cookie.domain))
                    && path_matches(&cookie.path, &it.path))
        };
        if (context.is_for_script && cookie.is_http_only) || self.all().iter().any(is_protected) {
            return false;
        }
        let site = Bytes::from(registrable_domain(&cookie.domain));
        self.store(cookie);
        let is_of_site = |it: &Cookie| domain_matches(&it.domain, &site);
        if self.cookies.len() > MAX_FOR_SITE
            && self.cookies.iter().filter(|it| is_of_site(it)).count() > MAX_FOR_SITE
        {
            let mut left = EVICTED_AT_ONCE;
            self.remove_if(Cause::Evicted, |it| {
                is_of_site(it) && left > 0 && (left -= 1, true).1
            });
        }
        if self.cookies.len() > MAX_COOKIES {
            let mut left = 10 * EVICTED_AT_ONCE;
            self.remove_if(Cause::Evicted, |_| left > 0 && (left -= 1, true).1);
        }
        true
    }
}
