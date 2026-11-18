use bun_core::strings;

use crate::Bytes;
use crate::url::Url;

/// `*` stands for anything.
pub fn glob_matches(pattern: &[u8], mut text: &[u8]) -> bool {
    let Some((first, rest)) = strings::split_once_char(pattern, b'*') else {
        return pattern == text;
    };
    let (middle, last) = strings::rsplit_once_char(rest, b'*').unwrap_or((b"", rest));
    if text.len() < first.len() + last.len() || !text.starts_with(first) || !text.ends_with(last) {
        return false;
    }
    text = &text[first.len()..text.len() - last.len()];
    strings::tokenize(middle, b"*").all(|part| {
        strings::index_of(text, part)
            .map(|at| text = &text[at + part.len()..])
            .is_some()
    })
}

/// https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
pub enum MatchPattern {
    AllUrls,
    Parts {
        scheme: Bytes,
        host: Bytes,
        port: Option<u32>,
        path: Bytes,
    },
}

#[derive(Default)]
pub struct UrlFilter {
    /// None means all.
    pub included: Vec<MatchPattern>,
    pub excluded: Vec<MatchPattern>,
}

impl UrlFilter {
    pub fn matches(&self, url: &Url) -> bool {
        let any = |patterns: &[MatchPattern]| patterns.iter().any(|it| it.matches(url));
        (self.included.is_empty() || any(&self.included)) && !any(&self.excluded)
    }
}

impl MatchPattern {
    pub fn parse(pattern: &[u8]) -> Option<MatchPattern> {
        if pattern == b"<all_urls>" {
            return Some(MatchPattern::AllUrls);
        }
        let (scheme, rest) =
            strings::split_once_char(pattern, b':').filter(|it| !it.0.is_empty())?;
        let rest = rest.strip_prefix(b"//")?;
        let (authority, path) =
            rest.split_at(strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len()));
        let (host, port) = match strings::rsplit_once_char(authority, b':') {
            Some((host, b"*")) => (host, None),
            Some((host, port)) if !port.is_empty() && port.iter().all(u8::is_ascii_digit) => (
                host,
                Some(bun_core::fmt::parse_unsigned(port, 10).unwrap_or(u32::MAX)),
            ),
            _ => (authority, None),
        };
        let path = if path.is_empty() { b"/" } else { path };
        Some(MatchPattern::Parts {
            scheme: scheme.into(),
            host: host.into(),
            port,
            path: path.into(),
        })
    }

    pub fn matches(&self, url: &Url) -> bool {
        let MatchPattern::Parts {
            scheme,
            host,
            port,
            path,
        } = self
        else {
            return true;
        };
        let name = url.hostname();
        (if **scheme == *b"*" {
            url.is_http_or_ws()
        } else {
            url.scheme() == &**scheme
        }) && (**host == *b"*"
            || name == &**host
            || host
                .strip_prefix(b"*.")
                .is_some_and(|it| name == it || name.ends_with(&host[1..])))
            && port.is_none_or(|it| it == url.port_or_default().map_or(80, u32::from))
            && glob_matches(path, &[url.path_or_root(), url.search()].concat())
    }
}
