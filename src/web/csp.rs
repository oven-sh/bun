//! https://w3c.github.io/webappsec-csp/

use bun_core::strings;

use crate::Bytes;
use crate::headers::digits;
use crate::integrity::{Hash, is_base64_value, parse_metadata};
use crate::origin::Origin;
use crate::request::Destination;
use crate::scheme::{Privileges, is_standard, privileges_of};
use crate::url::{Url, percent_decode};

#[path = "csp_embedded.rs"]
pub mod embedded;

keywords! {
    pub enum Directive {
        BaseUri = b"base-uri",
        BlockAllMixedContent = b"block-all-mixed-content",
        ChildSrc = b"child-src",
        ConnectSrc = b"connect-src",
        DefaultSrc = b"default-src",
        FontSrc = b"font-src",
        FormAction = b"form-action",
        FrameAncestors = b"frame-ancestors",
        FrameSrc = b"frame-src",
        ImgSrc = b"img-src",
        ManifestSrc = b"manifest-src",
        MediaSrc = b"media-src",
        ObjectSrc = b"object-src",
        ReportTo = b"report-to",
        ReportUri = b"report-uri",
        RequireTrustedTypesFor = b"require-trusted-types-for",
        Sandbox = b"sandbox",
        ScriptSrc = b"script-src",
        ScriptSrcAttr = b"script-src-attr",
        ScriptSrcElem = b"script-src-elem",
        StyleSrc = b"style-src",
        StyleSrcAttr = b"style-src-attr",
        StyleSrcElem = b"style-src-elem",
        TrustedTypes = b"trusted-types",
        UpgradeInsecureRequests = b"upgrade-insecure-requests",
        WorkerSrc = b"worker-src",
    }
}

impl Directive {
    fn for_destination(destination: Destination) -> Option<Directive> {
        use Destination::*;
        Some(match destination {
            Empty | Json | Text => Directive::ConnectSrc,
            Script | Xslt | AudioWorklet | PaintWorklet => Directive::ScriptSrcElem,
            Style => Directive::StyleSrcElem,
            Image => Directive::ImgSrc,
            Font => Directive::FontSrc,
            Audio | Video | Track => Directive::MediaSrc,
            Frame | Iframe => Directive::FrameSrc,
            Worker | SharedWorker | ServiceWorker => Directive::WorkerSrc,
            Manifest => Directive::ManifestSrc,
            Object | Embed => Directive::ObjectSrc,
            Document | Report => return None,
        })
    }

    fn fallbacks(self) -> &'static [Directive] {
        use Directive::*;
        match self {
            ScriptSrcElem | ScriptSrcAttr => &[ScriptSrc, DefaultSrc],
            StyleSrcElem | StyleSrcAttr => &[StyleSrc, DefaultSrc],
            FrameSrc => &[ChildSrc, DefaultSrc],
            WorkerSrc => &[ChildSrc, ScriptSrc, DefaultSrc],
            BaseUri | BlockAllMixedContent | FormAction | FrameAncestors => &[],
            _ => &[DefaultSrc],
        }
    }
}

#[derive(Clone, Copy)]
enum Port {
    Default,
    Any,
    Number(u64),
}

#[derive(Clone)]
enum Expression {
    Star,
    SelfOrigin,
    Nonce(Bytes),
    Hash(Hash),
    Scheme(Bytes),
    Host {
        scheme: Option<Bytes>,
        host: Bytes,
        port: Port,
        path: Bytes,
    },
    Other,
}

fn is_scheme(text: &[u8]) -> bool {
    text.first().is_some_and(u8::is_ascii_alphabetic)
        && text
            .iter()
            .all(|it| it.is_ascii_alphanumeric() || matches!(it, b'+' | b'.' | b'-'))
}

fn scheme_matches(expression: &[u8], actual: &[u8]) -> bool {
    expression == actual
        || matches!(
            (expression, actual),
            (b"http" | b"wss", b"https") | (b"ws", b"wss" | b"http" | b"https")
        )
}

fn path_matches(expression: &[u8], actual: &[u8]) -> bool {
    let (directory, mut actual) = (expression.strip_suffix(b"/"), strings::split(actual, b"/"));
    strings::split(directory.unwrap_or(expression), b"/").all(|part| {
        actual
            .next()
            .is_some_and(|it| percent_decode(it) == percent_decode(part))
    }) && (directory.is_some() || actual.next().is_none())
}

impl Expression {
    fn parse(source: &[u8]) -> Expression {
        if let [b'\'', quoted @ .., b'\''] = source {
            let nonce = quoted
                .split_at_checked(6)
                .filter(|it| it.0.eq_ignore_ascii_case(b"nonce-") && is_base64_value(it.1));
            return match nonce {
                Some((_, nonce)) => Expression::Nonce(nonce.into()),
                None if quoted.eq_ignore_ascii_case(b"self") => Expression::SelfOrigin,
                None => Hash::parse(quoted).map_or(Expression::Other, Expression::Hash),
            };
        }
        match source {
            b"*" => Expression::Star,
            [b'\'', ..] => Expression::Other,
            [scheme @ .., b':'] if is_scheme(scheme) => {
                Expression::Scheme(scheme.to_ascii_lowercase().into())
            }
            _ => Expression::parse_host(source).unwrap_or(Expression::Other),
        }
    }

    fn parse_host(source: &[u8]) -> Option<Expression> {
        let (scheme, rest) = match strings::split_once(source, b"://") {
            Some((scheme, rest)) if is_scheme(scheme) => {
                (Some(scheme.to_ascii_lowercase().into()), rest)
            }
            _ => (None, source),
        };
        let rest = &rest[..strings::index_of_any(rest, b"?#").unwrap_or(rest.len())];
        let (authority, path) =
            rest.split_at(strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len()));
        let (host, port) = match strings::rsplit_once_char(authority, b':')
            .filter(|_| !authority.ends_with(b"]"))
        {
            Some((host, b"*")) => (host, Port::Any),
            Some((host, port)) => (host, Port::Number(digits(port)?)),
            None => (authority, Port::Default),
        };
        let name = host.strip_prefix(b"*.").unwrap_or(host);
        let is_valid = matches!(host, b"*" | [b'[', _, .., b']'])
            || !(name.is_empty() || strings::contains_any(name, b":*"));
        is_valid.then(|| Expression::Host {
            scheme,
            host: host.to_ascii_lowercase().into(),
            port,
            path: path.into(),
        })
    }

    /// https://w3c.github.io/webappsec-csp/#match-url-to-source-expression
    fn matches(&self, url: &Url, own: &Url, is_redirected: bool) -> bool {
        match self {
            Expression::Star => url.is_http_or_ws() || url.scheme() == own.scheme(),
            Expression::SelfOrigin => {
                let origin = Origin::of(own);
                if origin.is_opaque() || (url.scheme() == b"blob" && own.scheme() != b"blob") {
                    return false;
                }
                let upgrades = matches!(
                    (own.scheme(), url.scheme()),
                    (b"http" | b"https", b"https" | b"wss") | (b"http", b"ws")
                );
                origin.is_origin_of(url) || (upgrades && url.host() == own.host())
            }
            Expression::Scheme(scheme) => scheme_matches(scheme, url.scheme()),
            Expression::Host {
                scheme,
                host,
                port,
                path,
            } => {
                let (name, actual_port) = (
                    url.hostname().to_ascii_lowercase(),
                    url.port_or_default().map(u64::from),
                );
                !name.is_empty()
                    && scheme_matches(
                        scheme.as_deref().unwrap_or_else(|| own.scheme()),
                        url.scheme(),
                    )
                    && host
                        .strip_prefix(b"*")
                        .map_or(name == **host, |it| name.ends_with(it))
                    && match *port {
                        Port::Default => url.port().is_none(),
                        Port::Any => true,
                        Port::Number(port) => {
                            actual_port == Some(port) || (port, actual_port) == (80, Some(443))
                        }
                    }
                    && (path.is_empty() || is_redirected || path_matches(path, url.path()))
            }
            Expression::Nonce(_) | Expression::Hash(_) | Expression::Other => false,
        }
    }
}

#[derive(Clone)]
struct Sources(Vec<(Bytes, Expression)>);

impl Sources {
    fn parse<'a>(values: impl Iterator<Item = &'a [u8]>) -> Sources {
        Sources(
            values
                .map(|it| (it.into(), Expression::parse(it)))
                .collect(),
        )
    }

    fn written(&self) -> impl Iterator<Item = &[u8]> {
        self.0.iter().map(|it| &*it.0)
    }

    fn has(&self, keyword: &[u8]) -> bool {
        self.written().any(|it| it.eq_ignore_ascii_case(keyword))
    }

    fn has_nonce(&self, nonce: &[u8]) -> bool {
        let nonce = nonce.trim_ascii();
        self.0
            .iter()
            .any(|it| matches!(&it.1, Expression::Nonce(it) if **it == *nonce))
    }

    fn hashes(&self) -> impl Iterator<Item = &Hash> {
        self.0.iter().filter_map(|it| {
            if let Expression::Hash(hash) = &it.1 {
                Some(hash)
            } else {
                None
            }
        })
    }

    fn has_nonces_or_hashes(&self) -> bool {
        self.0
            .iter()
            .any(|it| matches!(it.1, Expression::Nonce(_) | Expression::Hash(_)))
    }

    fn has_all_hashes_of(&self, integrity: &[u8]) -> bool {
        let given = parse_metadata(integrity);
        !given.is_empty()
            && given
                .iter()
                .all(|it| self.hashes().any(|listed| listed == it))
    }

    fn list(&self, url: &Url, own: &Url, is_redirected: bool) -> bool {
        self.0
            .iter()
            .any(|it| it.1.matches(url, own, is_redirected))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Header,
    ReportOnlyHeader,
    Meta,
    /// By an element that the document did not come with.
    InjectedMeta,
    /// By the `csp` attribute of the frame.
    Embedder,
}

#[derive(Clone)]
struct Policy {
    /// With their names in lower case.
    directives: Vec<(Bytes, Sources)>,
    text: Bytes,
    delivery: Delivery,
}

impl Policy {
    fn is_enforced(&self) -> bool {
        self.delivery != Delivery::ReportOnlyHeader
    }

    fn get(&self, directive: Directive) -> Option<&Sources> {
        self.directives
            .iter()
            .find(|it| *it.0 == *directive.as_bytes())
            .map(|it| &it.1)
    }

    fn effective(&self, directive: Directive) -> Option<&Sources> {
        self.get(directive)
            .or_else(|| directive.fallbacks().iter().find_map(|it| self.get(*it)))
    }

    fn requires_trusted_types(&self) -> bool {
        self.get(Directive::RequireTrustedTypesFor)
            .is_some_and(|it| it.has(b"'script'"))
    }

    fn violation(&self, directive: Directive, blocked: &[u8], sample: Vec<u8>) -> Violation {
        let group = self
            .get(Directive::ReportTo)
            .and_then(|it| it.written().next());
        let urls = self.get(Directive::ReportUri).filter(|_| group.is_none());
        Violation {
            blocked: blocked.into(),
            directive,
            policy: self.text.clone(),
            is_enforced: self.is_enforced(),
            sample: sample.into(),
            report_urls: urls
                .iter()
                .flat_map(|it| it.written())
                .map(Into::into)
                .collect(),
            report_group: group.map(Into::into),
        }
    }
}

pub struct Violation {
    pub blocked: Bytes,
    pub directive: Directive,
    pub policy: Bytes,
    pub is_enforced: bool,
    pub sample: Bytes,
    pub report_urls: Vec<Bytes>,
    pub report_group: Option<Bytes>,
}

/// What policies have to say about something, whether they enforce it or not.
#[must_use]
#[derive(Default)]
pub struct Verdict {
    pub violations: Vec<Violation>,
}

impl Verdict {
    pub fn is_allowed(&self) -> bool {
        !self.violations.iter().any(|it| it.is_enforced)
    }

    pub fn of_enforced(mut self, is_enforced: bool) -> Verdict {
        self.violations.retain(|it| it.is_enforced == is_enforced);
        self
    }
}

/// What the initiator of a request says about it.
#[derive(Clone, Default)]
pub struct Metadata {
    pub nonce: Bytes,
    pub integrity: Bytes,
    pub is_parser_inserted: bool,
    pub is_prefetch: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Inline {
    Script,
    ScriptAttribute,
    Style,
    StyleAttribute,
    /// To a `javascript:` URL.
    Navigation,
}

/// The first 40 UTF-16 code units.
fn sample_of(text: &[u8]) -> &[u8] {
    let mut units = 0;
    let end = text.iter().position(|byte| {
        units += usize::from(byte & 0xc0 != 0x80) + usize::from(*byte >= 0xf0);
        units > 40
    });
    &text[..end.unwrap_or(text.len())]
}

/// https://w3c.github.io/webappsec-csp/#strip-url-for-use-in-reports
pub fn strip_for_report(url: &Url) -> Vec<u8> {
    if url.is_http_or_ws() || is_standard(url.scheme()) {
        url.stripped().href().to_vec()
    } else {
        url.scheme().to_vec()
    }
}

/// Whether `origin` is what one of the source expressions stands for in the document at `own`.
pub fn lists_origin(
    sources: Vec<impl core::ops::Deref<Target = [u8]>>,
    origin: &Origin,
    own: &Url,
) -> bool {
    let lists =
        |url: &Url, source: &[u8]| Sources::parse([source].into_iter()).list(url, own, false);
    origin
        .to_url()
        .is_some_and(|url| sources.into_iter().any(|it| lists(&url, &it)))
}

pub(crate) fn source_matches_origin(source: &[u8], origin: &Origin) -> bool {
    origin
        .to_url()
        .is_some_and(|it| Expression::parse(source).matches(&it, &it, true))
}

#[derive(Clone)]
pub struct CspList {
    own: Url,
    policies: Vec<Policy>,
    is_from_header: bool,
}

impl CspList {
    pub fn new(own: Url) -> CspList {
        CspList {
            own,
            policies: Vec::new(),
            is_from_header: false,
        }
    }

    /// For a document or a worker that has no URL of its own to speak of.
    pub fn inherited(&self) -> CspList {
        CspList {
            is_from_header: false,
            ..self.clone()
        }
    }

    pub fn add(&mut self, value: &[u8], delivery: Delivery) {
        let is_from_header = !matches!(delivery, Delivery::Meta | Delivery::InjectedMeta);
        for text in strings::split(value, b",") {
            let mut policy = Policy {
                directives: Vec::new(),
                text: text.trim_ascii().into(),
                delivery,
            };
            let is_valid = |it: &&[u8]| {
                (it.iter()).all(|it| it.is_ascii_graphic() || it.is_ascii_whitespace())
            };
            for directive in strings::split(text, b";").filter(is_valid) {
                let mut words = strings::tokenize_any(directive, b"\t\n\x0c\r ");
                let Some(name) = words.next().map(<[u8]>::to_ascii_lowercase) else {
                    continue;
                };
                let is_ignored = !is_from_header
                    && matches!(&*name, b"sandbox" | b"frame-ancestors" | b"report-uri");
                if !is_ignored && policy.directives.iter().all(|it| *it.0 != *name) {
                    policy.directives.push((name.into(), Sources::parse(words)));
                }
            }
            if !policy.directives.is_empty() {
                self.policies.push(policy);
                self.is_from_header |= is_from_header;
            }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.policies.is_empty()
    }

    pub fn is_from_header(&self) -> bool {
        self.is_from_header
    }

    pub fn has_report_only(&self) -> bool {
        self.policies.iter().any(|it| !it.is_enforced())
    }

    /// Whether there may be more to say about what has been allowed before.
    pub fn checks_again(&self) -> bool {
        (self.policies.iter()).any(|it| !it.is_enforced() || it.delivery == Delivery::InjectedMeta)
    }

    fn enforced(&self) -> impl Iterator<Item = &Policy> {
        self.policies.iter().filter(|it| it.is_enforced())
    }

    /// One for each that is enforced.
    pub fn serialize(&self) -> impl Iterator<Item = Vec<u8>> {
        let directive = |it: &(Bytes, Sources)| {
            core::iter::once(&*it.0)
                .chain(it.1.written())
                .collect::<Vec<_>>()
                .join(&b' ')
        };
        self.enforced().map(move |it| {
            it.directives
                .iter()
                .map(directive)
                .collect::<Vec<_>>()
                .join(&b';')
        })
    }

    fn check(
        &self,
        directive: Directive,
        blocked: impl Fn() -> Vec<u8>,
        sample: &[u8],
        allows: impl Fn(&Sources, &Policy) -> bool,
    ) -> Verdict {
        let violated = self.policies.iter().filter_map(|policy| {
            Some((
                policy,
                policy
                    .effective(directive)
                    .filter(|it| !allows(it, policy))?,
            ))
        });
        let sample = |sources: &Sources| {
            if sources.has(b"'report-sample'") {
                sample_of(sample).to_vec()
            } else {
                Vec::new()
            }
        };
        Verdict {
            violations: violated
                .map(|(policy, sources)| policy.violation(directive, &blocked(), sample(sources)))
                .collect(),
        }
    }

    fn all_enforced(&self, directive: Directive, allows: impl Fn(&Sources) -> bool) -> bool {
        self.enforced()
            .all(|it| it.effective(directive).is_none_or(&allows))
    }

    /// `first` is where the request began, if it was redirected.
    pub fn check_request(
        &self,
        url: &Url,
        destination: Destination,
        metadata: &Metadata,
        first: Option<&Url>,
    ) -> Verdict {
        use Directive::*;
        let directive = if metadata.is_prefetch {
            Some(DefaultSrc)
        } else {
            Directive::for_destination(destination)
        };
        let Some(directive) = directive.filter(|_| {
            !self.is_empty() && !privileges_of(url.scheme()).contains(Privileges::BYPASS_CSP)
        }) else {
            return Verdict::default();
        };
        let is_script = matches!(directive, ScriptSrcElem | WorkerSrc);
        let list = |sources: &Sources| sources.list(url, &self.own, first.is_some());
        let blocked = || {
            let blocked = strip_for_report(first.filter(|_| directive != FrameSrc).unwrap_or(url));
            let hides_path = matches!(directive, FrameSrc | ObjectSrc)
                && Origin::of(url) != Origin::of(&self.own);
            Url::parse(&blocked)
                .filter(|_| hides_path)
                .map_or(blocked, |it| Origin::of(&it).as_bytes().to_vec())
        };
        self.check(directive, blocked, b"", |sources, policy| {
            if metadata.is_prefetch {
                let is_about_fetching = |name: &[u8]| {
                    Directive::parse(name).is_some()
                        && (name.ends_with(b"-src") || name.ends_with(b"-src-elem"))
                };
                return (policy.directives.iter())
                    .any(|it| is_about_fetching(&it.0) && list(&it.1));
            }
            ((is_script || directive == StyleSrcElem) && sources.has_nonce(&metadata.nonce))
                || (is_script && sources.has_all_hashes_of(&metadata.integrity))
                || if is_script && sources.has(b"'strict-dynamic'") {
                    !metadata.is_parser_inserted
                } else {
                    list(sources)
                }
        })
    }

    /// Without anything to report.
    pub fn allows_data_images(&self) -> bool {
        let Some(url) = Url::parse(b"data:,").filter(|_| !self.is_empty()) else {
            return true;
        };
        self.policies.iter().all(|it| {
            it.effective(Directive::ImgSrc)
                .is_none_or(|it| it.list(&url, &self.own, false))
        })
    }

    /// https://w3c.github.io/webappsec-csp/#should-block-inline
    pub fn check_inline(
        &self,
        kind: Inline,
        source: &[u8],
        nonce: &[u8],
        is_parser_inserted: bool,
    ) -> Verdict {
        let directive = match kind {
            Inline::Script | Inline::Navigation => Directive::ScriptSrcElem,
            Inline::ScriptAttribute => Directive::ScriptSrcAttr,
            Inline::Style => Directive::StyleSrcElem,
            Inline::StyleAttribute => Directive::StyleSrcAttr,
        };
        let is_element = matches!(kind, Inline::Script | Inline::Style);
        let url = (kind == Inline::Navigation).then(|| [b"javascript:", source].concat());
        let source = url.as_deref().unwrap_or(source);
        self.check(
            directive,
            || b"inline".to_vec(),
            source,
            |sources, _| {
                let is_dynamic = !matches!(kind, Inline::Style | Inline::StyleAttribute)
                    && sources.has(b"'strict-dynamic'");
                if !is_dynamic && !sources.has_nonces_or_hashes() {
                    return sources.has(b"'unsafe-inline'");
                }
                if is_element && (sources.has_nonce(nonce) || (is_dynamic && !is_parser_inserted)) {
                    return true;
                }
                (is_element || sources.has(b"'unsafe-hashes'"))
                    && sources.hashes().any(|it| it.is_of(source))
            },
        )
    }

    pub fn check_mixed_content(&self, url: &Url) -> Verdict {
        let blocked = || strip_for_report(url);
        self.check(Directive::BlockAllMixedContent, blocked, b"", |_, _| false)
    }

    /// For an `object` or an `embed` that has a type only.
    pub fn check_plugin_without_url(&self) -> Verdict {
        self.check(Directive::ObjectSrc, Vec::new, b"", |it, _| {
            it.written().any(|it| !it.eq_ignore_ascii_case(b"'none'"))
        })
    }

    pub fn check_eval(&self, code: &[u8]) -> Verdict {
        let is_trusted = self.enforced().any(Policy::requires_trusted_types);
        self.check(
            Directive::ScriptSrc,
            || b"eval".to_vec(),
            code,
            |sources, _| {
                sources.has(b"'unsafe-eval'")
                    || (is_trusted && sources.has(b"'trusted-types-eval'"))
            },
        )
    }

    pub fn allows_web_assembly(&self) -> bool {
        self.all_enforced(Directive::ScriptSrc, |it| {
            it.has(b"'wasm-unsafe-eval'") || it.has(b"'unsafe-eval'")
        })
    }

    /// Whether each string has to be shown before it is compiled.
    pub fn watches_eval(&self) -> bool {
        self.policies.iter().any(|it| {
            it.requires_trusted_types()
                || (!it.is_enforced() && it.effective(Directive::ScriptSrc).is_some())
        })
    }

    pub fn restricts_style_attributes(&self) -> bool {
        let mut sources = self
            .policies
            .iter()
            .filter_map(|it| it.effective(Directive::StyleSrcAttr));
        sources.any(|it| !it.has(b"'unsafe-inline'") || it.has_nonces_or_hashes())
    }

    /// By what the document came with.
    pub fn restricts_scripts(&self) -> bool {
        self.enforced().any(|it| {
            matches!(it.delivery, Delivery::Header | Delivery::Meta)
                && it.effective(Directive::ScriptSrc).is_some()
        })
    }

    pub fn check_base(&self, url: &Url) -> Verdict {
        self.check(
            Directive::BaseUri,
            || strip_for_report(url),
            b"",
            |it, _| it.list(url, &self.own, false),
        )
    }

    pub fn check_form_action(&self, url: &Url, first: Option<&Url>) -> Verdict {
        self.check(
            Directive::FormAction,
            || strip_for_report(first.unwrap_or(url)),
            b"",
            |it, _| it.list(url, &self.own, first.is_some()),
        )
    }

    pub fn check_ancestors(&self, origins: &[Origin]) -> Verdict {
        self.check(
            Directive::FrameAncestors,
            || strip_for_report(&self.own),
            b"",
            |sources, _| {
                origins.iter().all(|it| {
                    it.to_url()
                        .is_some_and(|it| sources.list(&it, &self.own, false))
                })
            },
        )
    }

    pub fn enforces(&self, directive: Directive) -> bool {
        self.enforced().any(|it| it.get(directive).is_some())
    }

    /// The flags that all `sandbox` directives have. `None` if there is none.
    pub fn sandbox(&self) -> Option<Vec<Vec<u8>>> {
        let mut all = self.enforced().filter_map(|it| it.get(Directive::Sandbox));
        let first = all
            .next()?
            .written()
            .map(<[u8]>::to_ascii_lowercase)
            .collect();
        Some(all.fold(first, |mut flags: Vec<_>, others| {
            flags.retain(|it| others.has(it));
            flags
        }))
    }

    pub fn requires_trusted_types(&self) -> bool {
        self.policies.iter().any(Policy::requires_trusted_types)
    }

    pub fn allows_trusted_types_eval(&self) -> bool {
        self.enforced().any(Policy::requires_trusted_types)
            && self.enforced().any(|it| {
                it.effective(Directive::ScriptSrc)
                    .is_some_and(|it| it.has(b"'trusted-types-eval'"))
            })
            && self.check_eval(b"").is_allowed()
    }

    /// A string was passed to `sink`.
    pub fn check_sink(&self, sink: &[u8], value: &[u8]) -> Verdict {
        let violated = self
            .policies
            .iter()
            .filter(|it| it.requires_trusted_types());
        let sample = || [sink, b"|", sample_of(value)].concat();
        Verdict {
            violations: violated
                .map(|it| {
                    it.violation(
                        Directive::RequireTrustedTypesFor,
                        b"trusted-types-sink",
                        sample(),
                    )
                })
                .collect(),
        }
    }

    pub fn check_type_policy(&self, name: &[u8], is_taken: bool) -> Verdict {
        let is_name = !name.is_empty()
            && name
                .iter()
                .all(|it| it.is_ascii_alphanumeric() || strings::contains_char(b"_#=/@.%-", *it));
        let violated = self.policies.iter().filter(|it| {
            it.get(Directive::TrustedTypes).is_some_and(|names| {
                !names
                    .written()
                    .any(|it| it == b"*" || (is_name && it == name))
                    || (is_taken && !names.has(b"'allow-duplicates'"))
            })
        });
        Verdict {
            violations: violated
                .map(|it| {
                    it.violation(
                        Directive::TrustedTypes,
                        b"trusted-types-policy",
                        sample_of(name).to_vec(),
                    )
                })
                .collect(),
        }
    }
}
