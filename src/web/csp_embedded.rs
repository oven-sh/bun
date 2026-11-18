//! https://w3c.github.io/webappsec-cspee/

use bun_core::strings;

use super::{CspList, Delivery, Directive, Expression, Policy, Port, Sources, path_matches};
use crate::Bytes;
use crate::headers::HeaderList;
use crate::origin::Origin;
use crate::url::Url;

/// With one scheme only.
#[derive(Clone)]
struct Place<'a> {
    scheme: &'a [u8],
    /// `None` is any URL of the scheme.
    host: Option<&'a [u8]>,
    /// `None` is any.
    port: Option<u64>,
    path: &'a [u8],
}

fn default_port(scheme: &[u8]) -> u64 {
    match scheme {
        b"http" | b"ws" => 80,
        b"https" | b"wss" => 443,
        b"ftp" => 21,
        _ => u64::MAX,
    }
}

fn host_covers(wide: &[u8], narrow: &[u8]) -> bool {
    wide == narrow
        || wide
            .strip_prefix(b"*")
            .is_some_and(|it| narrow.ends_with(it))
}

fn path_covers(wide: &[u8], narrow: &[u8]) -> bool {
    wide.is_empty() || (wide == b"/" && narrow.is_empty()) || path_matches(wide, narrow)
}

fn narrower<T: Copy>(one: T, other: T, covers: impl Fn(T, T) -> bool) -> Option<T> {
    if covers(one, other) {
        Some(other)
    } else {
        covers(other, one).then_some(one)
    }
}

impl<'a> Place<'a> {
    fn of_scheme(scheme: &'a [u8]) -> Place<'a> {
        Place {
            scheme,
            host: None,
            port: None,
            path: b"",
        }
    }

    fn intersection(&self, other: &Place<'a>) -> Option<Place<'a>> {
        (self.scheme == other.scheme).then_some(())?;
        let (Some(host), Some(other_host)) = (self.host, other.host) else {
            return Some(if self.host.is_none() {
                other.clone()
            } else {
                self.clone()
            });
        };
        Some(Place {
            scheme: self.scheme,
            host: Some(narrower(host, other_host, host_covers)?),
            port: narrower(self.port, other.port, |wide, narrow| {
                wide.is_none() || wide == narrow
            })?,
            path: narrower(self.path, other.path, path_covers)?,
        })
    }

    fn covers(&self, other: &Place<'_>) -> bool {
        self.scheme == other.scheme
            && self.host.is_none_or(|host| {
                other.host.is_some_and(|it| host_covers(host, it))
                    && (self.port.is_none() || self.port == other.port)
                    && path_covers(self.path, other.path)
            })
    }
}

fn places<'a>(sources: &'a Sources, own: &'a Url) -> Vec<Place<'a>> {
    let mut all = Vec::new();
    for (_, expression) in &sources.0 {
        match expression {
            Expression::Star => {
                all.extend([&b"ftp"[..], b"ws", b"http", own.scheme()].map(Place::of_scheme))
            }
            Expression::Scheme(scheme) => all.push(Place::of_scheme(scheme)),
            Expression::SelfOrigin if !own.hostname().is_empty() => {
                let port = own
                    .port()
                    .map_or_else(|| default_port(own.scheme()), u64::from);
                all.push(Place {
                    scheme: own.scheme(),
                    host: Some(own.hostname()),
                    port: Some(port),
                    path: b"",
                });
            }
            Expression::Host {
                scheme,
                host,
                port,
                path,
            } => {
                let scheme = scheme.as_deref().unwrap_or_else(|| own.scheme());
                let port = match *port {
                    Port::Default => Some(default_port(scheme)),
                    Port::Any => None,
                    Port::Number(port) => Some(port),
                };
                all.push(Place {
                    scheme,
                    host: Some(host),
                    port,
                    path,
                });
            }
            _ => {}
        }
    }
    for at in 0..all.len() {
        let scheme: &[u8] = match all[at].scheme {
            b"http" => b"https",
            b"ws" => b"wss",
            _ => continue,
        };
        all.push(Place {
            scheme,
            port: all[at].port.map(|it| if it == 80 { 443 } else { it }),
            ..all[at]
        });
    }
    all
}

fn list_subsumes(
    required: &Sources,
    returned: &[&Sources],
    directive: Directive,
    own: &Url,
) -> bool {
    use Directive::*;
    let Some((first, others)) = returned.split_first() else {
        return false;
    };
    let all_have = |keyword: &[u8]| returned.iter().all(|it| it.has(keyword));
    let is_nonce = |it: &Expression| matches!(it, Expression::Nonce(_));
    let shares_nonce = first.0.iter().any(|it| matches!(&it.1, Expression::Nonce(nonce) if others.iter().all(|it| it.has_nonce(nonce))));
    let mut shared_hashes = first
        .hashes()
        .filter(|hash| others.iter().all(|it| it.hashes().any(|it| it == *hash)));
    if (shares_nonce && !required.0.iter().any(|it| is_nonce(&it.1)))
        || !shared_hashes.all(|hash| required.hashes().any(|it| it == hash))
    {
        return false;
    }
    let is_script = matches!(directive, ScriptSrc | ScriptSrcAttr | ScriptSrcElem);
    let (is_dynamic, may_be_dynamic) = (
        is_script && all_have(b"'strict-dynamic'"),
        is_script && required.has(b"'strict-dynamic'"),
    );
    if is_script || matches!(directive, StyleSrc | StyleSrcAttr | StyleSrcElem) {
        let allows_inline = all_have(b"'unsafe-inline'")
            && !is_dynamic
            && !returned.iter().any(|it| it.has_nonces_or_hashes());
        let may_allow_inline =
            required.has(b"'unsafe-inline'") && !may_be_dynamic && !required.has_nonces_or_hashes();
        let keywords = [
            &b"'unsafe-eval'"[..],
            b"'wasm-unsafe-eval'",
            b"'unsafe-hashes'",
            b"'trusted-types-eval'",
        ];
        if (allows_inline && !may_allow_inline)
            || keywords.iter().any(|it| all_have(it) && !required.has(it))
        {
            return false;
        }
    }
    let shared = others.iter().fold(places(first, own), |shared, other| {
        places(other, own)
            .iter()
            .flat_map(|it| shared.iter().filter_map(|other| it.intersection(other)))
            .collect()
    });
    if is_dynamic || may_be_dynamic {
        return may_be_dynamic && (is_dynamic || shared.is_empty());
    }
    let allowed = places(required, own);
    shared
        .iter()
        .all(|it| allowed.iter().any(|wide| wide.covers(it)))
}

fn subsumes(required: &Policy, returned: &CspList) -> bool {
    use Directive::*;
    Directive::ALL.iter().all(|&directive| {
        let is_compared = !matches!(
            directive,
            BlockAllMixedContent
                | DefaultSrc
                | ReportTo
                | ReportUri
                | RequireTrustedTypesFor
                | Sandbox
                | TrustedTypes
                | UpgradeInsecureRequests
        );
        let written = [directive]
            .iter()
            .chain(directive.fallbacks())
            .find_map(|it| Some((*it, required.get(*it)?)));
        written
            .filter(|_| is_compared)
            .is_none_or(|(written, sources)| {
                let lists: Vec<_> = returned
                    .enforced()
                    .filter_map(|it| it.effective(directive))
                    .collect();
                list_subsumes(
                    sources,
                    &lists,
                    if written == DefaultSrc {
                        directive
                    } else {
                        written
                    },
                    &returned.own,
                )
            })
    })
}

fn is_serialized_policy(text: &[u8]) -> bool {
    let is_blank = |it: &u8| matches!(it, b' ' | b'\t');
    let is_directive = |text: &[u8]| {
        let name = text
            .iter()
            .take_while(|it| it.is_ascii_alphanumeric() || **it == b'-')
            .count();
        name > 0
            && text.get(name).is_none_or(is_blank)
            && text
                .iter()
                .all(|it| is_blank(it) || (it.is_ascii_graphic() && *it != b','))
    };
    text.len() <= 4096
        && strings::split(text, b";").enumerate().all(|(at, it)| {
            let it = &it[it.iter().take_while(|it| at > 0 && is_blank(it)).count()..];
            (at > 0 && it.is_empty()) || is_directive(it)
        })
}

crate::wire! {
    /// What an embedder asks of the document in its frame.
    #[derive(Clone)]
    pub struct RequiredCsp(Bytes);
}

impl RequiredCsp {
    fn parse(&self, own: &Url) -> CspList {
        let mut list = CspList::new(own.clone());
        list.add(&self.0, Delivery::Header);
        list
    }

    /// `of_parent` was asked of the document that the frame is in.
    pub fn new(
        attribute: Option<&[u8]>,
        of_parent: Option<&RequiredCsp>,
        url: &Url,
    ) -> Option<RequiredCsp> {
        let own = attribute
            .filter(|it| is_serialized_policy(it))
            .map(|it| RequiredCsp(it.into()))
            .filter(|it| {
                let list = it.parse(url);
                !list.enforces(Directive::ReportTo)
                    && !list.enforces(Directive::ReportUri)
                    && of_parent.is_none_or(|it| {
                        it.parse(url).policies.iter().all(|it| subsumes(it, &list))
                    })
            });
        own.or_else(|| of_parent.cloned())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Whether the response may be shown. It gets the policy if it has agreed to.
    pub fn apply(
        &self,
        csp: &mut CspList,
        url: &Url,
        headers: &HeaderList,
        embedder: &Origin,
    ) -> bool {
        let agrees = headers.get(b"allow-csp-from").is_some_and(|it| {
            *it == *b"*" || Url::parse(&it).is_some_and(|it| embedder.is_origin_of(&it))
        });
        if agrees || url.is_local() || url.scheme() == b"file" {
            csp.add(&self.0, Delivery::Embedder);
            return true;
        }
        self.parse(url).policies.iter().all(|it| subsumes(it, csp))
    }
}
