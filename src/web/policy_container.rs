//! https://html.spec.whatwg.org/multipage/browsers.html#policy-containers

use crate::Bytes;
use crate::csp::{CspList, Delivery};
use crate::headers::HeaderList;
use crate::net::checks::EmbedderPolicy;
use crate::net::fetch::Isolation;
use crate::referrer::ReferrerPolicy;
use crate::reporting::Endpoints;
use crate::structured::{Bare, Value, parse_dictionary, parse_item};
use crate::url::Url;

#[derive(Clone, Default)]
pub struct IsolationPolicy {
    pub values: Isolation,
    pub endpoint: Option<Bytes>,
    pub report_only_endpoint: Option<Bytes>,
}

impl IsolationPolicy {
    fn parse(headers: &HeaderList, name: &[u8], prefix: &[u8]) -> IsolationPolicy {
        let read = |name: &[u8]| {
            let value = headers.get(name)?;
            let (Bare::Token(token), parameters) = parse_item(&value)? else {
                return None;
            };
            Some((
                EmbedderPolicy::parse(token.strip_prefix(prefix)?)?,
                parameters.text(b"report-to").map(Bytes::from),
            ))
        };
        let (enforced, endpoint) = read(name).unwrap_or_default();
        let (reported, report_only_endpoint) =
            read(&[name, b"-report-only"].concat()).unwrap_or_default();
        IsolationPolicy {
            values: Isolation { enforced, reported },
            endpoint,
            report_only_endpoint,
        }
    }

    pub fn isolates(&self) -> bool {
        self.values.enforced != EmbedderPolicy::UnsafeNone
    }
}

/// https://w3c.github.io/webappsec-subresource-integrity/#integrity-policy-section
#[derive(Clone, Default)]
pub struct IntegrityPolicy {
    pub blocks_scripts: bool,
    pub endpoints: Vec<Bytes>,
}

impl IntegrityPolicy {
    fn parse(value: &[u8]) -> IntegrityPolicy {
        let members = parse_dictionary(value).unwrap_or_default();
        let tokens = |name: &[u8]| {
            let items = match &members.iter().find(|it| it.0 == name)?.1 {
                Value::InnerList(items) => &items[..],
                Value::Item(_) => &[],
            };
            Some(items.iter().filter_map(|it| match it {
                Bare::Token(token) => Some(*token),
                _ => None,
            }))
        };
        IntegrityPolicy {
            blocks_scripts: tokens(b"sources").is_none_or(|mut all| all.any(|it| it == b"inline"))
                && tokens(b"blocked-destinations")
                    .is_some_and(|mut all| all.any(|it| it == b"script")),
            endpoints: (tokens(b"endpoints").into_iter().flatten())
                .map(Into::into)
                .collect(),
        }
    }
}

#[derive(Clone)]
pub struct PolicyContainer {
    pub csp: CspList,
    pub referrer_policy: ReferrerPolicy,
    pub embedder_policy: IsolationPolicy,
    pub document_isolation_policy: IsolationPolicy,
    pub integrity_policy: IntegrityPolicy,
    pub report_only_integrity_policy: IntegrityPolicy,
    pub endpoints: Endpoints,
}

impl PolicyContainer {
    pub fn from_response(url: &Url, headers: &HeaderList, is_secure: bool) -> PolicyContainer {
        let mut csp = CspList::new(url.clone());
        for (name, delivery) in [
            (&b"content-security-policy"[..], Delivery::Header),
            (
                b"content-security-policy-report-only",
                Delivery::ReportOnlyHeader,
            ),
        ] {
            headers.values(name).for_each(|it| csp.add(it, delivery));
        }
        let isolation = |name, prefix| {
            if is_secure {
                IsolationPolicy::parse(headers, name, prefix)
            } else {
                IsolationPolicy::default()
            }
        };
        PolicyContainer {
            csp,
            referrer_policy: ReferrerPolicy::from_header(&headers.get_or_empty(b"referrer-policy")),
            embedder_policy: isolation(b"cross-origin-embedder-policy", b""),
            document_isolation_policy: isolation(b"document-isolation-policy", b"isolate-and-"),
            integrity_policy: IntegrityPolicy::parse(&headers.get_or_empty(b"integrity-policy")),
            report_only_integrity_policy: IntegrityPolicy::parse(
                &headers.get_or_empty(b"integrity-policy-report-only"),
            ),
            endpoints: Endpoints::parse(&headers.get_or_empty(b"reporting-endpoints"), url),
        }
    }

    pub fn inherited(&self) -> PolicyContainer {
        PolicyContainer {
            csp: self.csp.inherited(),
            ..self.clone()
        }
    }
}
