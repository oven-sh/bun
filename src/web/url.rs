use bun_core::{StringView, strings};

use crate::Bytes;

/// A URL record, kept as its serialization.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Url {
    href: Bytes,
    /// The colon.
    scheme_end: u32,
    host_start: u32,
    host_end: u32,
    authority_end: u32,
    path_start: u32,
    path_end: u32,
    query_end: u32,
}

impl Url {
    pub fn parse(input: &[u8]) -> Option<Url> {
        Url::from_parser(&bun_url::href_from_string(&StringView::borrow_utf8(input)))
    }

    pub fn join(&self, relative: &[u8]) -> Option<Url> {
        Url::from_parser(&bun_url::join(
            &StringView::borrow_utf8(&self.href),
            &StringView::borrow_utf8(relative),
        ))
    }

    fn from_parser(href: &bun_core::String) -> Option<Url> {
        (!href.is_dead()).then(|| Url::serialized(href.to_owned_slice().into()))?
    }

    fn serialized(href: Bytes) -> Option<Url> {
        let scheme_end = strings::index_of_char_usize(&href, b':')?;
        let query_end = strings::index_of_char_usize(&href, b'#').unwrap_or(href.len());
        let path_end = strings::index_of_char_usize(&href[..query_end], b'?').unwrap_or(query_end);
        let after_scheme = scheme_end + 1;
        let [
            mut host_start,
            mut host_end,
            mut authority_end,
            mut path_start,
        ] = [after_scheme; 4];
        if href[after_scheme..path_end].starts_with(b"//") {
            let start = after_scheme + 2;
            authority_end =
                strings::index_of_char_pos(&href[..path_end], b'/', start).unwrap_or(path_end);
            host_start = strings::last_index_of_char(&href[start..authority_end], b'@')
                .map_or(start, |at| start + at + 1);
            let host = &href[host_start..authority_end];
            let colon = strings::last_index_of_char(host, b':').filter(|_| !host.ends_with(b"]"));
            host_end = colon.map_or(authority_end, |at| host_start + at);
            path_start = authority_end;
        } else if href[after_scheme..path_end].starts_with(b"/.//") {
            path_start += 2;
        }
        let [
            scheme_end,
            host_start,
            host_end,
            authority_end,
            path_start,
            path_end,
            query_end,
        ] = [
            scheme_end,
            host_start,
            host_end,
            authority_end,
            path_start,
            path_end,
            query_end,
        ]
        .map(|it| it as u32);
        Some(Url {
            href,
            scheme_end,
            host_start,
            host_end,
            authority_end,
            path_start,
            path_end,
            query_end,
        })
    }

    fn part(&self, start: u32, end: u32) -> &[u8] {
        &self.href[start as usize..end as usize]
    }

    pub fn href(&self) -> &[u8] {
        &self.href
    }

    /// Without the colon.
    pub fn scheme(&self) -> &[u8] {
        self.part(0, self.scheme_end)
    }

    /// With the colon.
    pub fn protocol(&self) -> &[u8] {
        self.part(0, self.scheme_end + 1)
    }

    fn userinfo(&self) -> &[u8] {
        let start = self.scheme_end + 3;
        if self.host_start > start {
            self.part(start, self.host_start - 1)
        } else {
            b""
        }
    }

    pub fn username(&self) -> &[u8] {
        strings::split_once_char(self.userinfo(), b':').map_or_else(|| self.userinfo(), |it| it.0)
    }

    pub fn password(&self) -> &[u8] {
        strings::split_once_char(self.userinfo(), b':').map_or(b"", |it| it.1)
    }

    pub fn includes_credentials(&self) -> bool {
        !self.userinfo().is_empty()
    }

    pub fn hostname(&self) -> &[u8] {
        self.part(self.host_start, self.host_end)
    }

    /// With the port, unless that is the default of the scheme.
    pub fn host(&self) -> &[u8] {
        self.part(self.host_start, self.authority_end)
    }

    pub fn port(&self) -> Option<u16> {
        bun_core::fmt::parse_unsigned(self.part(self.host_end, self.authority_end).get(1..)?, 10)
            .ok()
    }

    pub fn port_or_default(&self) -> Option<u16> {
        self.port().or_else(|| match self.scheme() {
            b"http" | b"ws" => Some(80),
            b"https" | b"wss" => Some(443),
            b"ftp" => Some(21),
            _ => None,
        })
    }

    pub fn path(&self) -> &[u8] {
        self.part(self.path_start, self.path_end)
    }

    /// `/` for a URL that has none.
    pub fn path_or_root(&self) -> &[u8] {
        if self.path().is_empty() {
            b"/"
        } else {
            self.path()
        }
    }

    /// With the question mark. Empty if nothing follows that.
    pub fn search(&self) -> &[u8] {
        if self.query_end > self.path_end + 1 {
            self.part(self.path_end, self.query_end)
        } else {
            b""
        }
    }

    pub fn fragment(&self) -> Option<&[u8]> {
        self.href[self.query_end as usize..].get(1..)
    }

    pub fn without_fragment(&self) -> &[u8] {
        self.part(0, self.query_end)
    }

    pub fn is_http(&self) -> bool {
        matches!(self.scheme(), b"http" | b"https")
    }

    pub fn is_http_or_ws(&self) -> bool {
        self.is_http() || matches!(self.scheme(), b"ws" | b"wss")
    }

    /// https://fetch.spec.whatwg.org/#is-local
    pub fn is_local(&self) -> bool {
        matches!(self.scheme(), b"about" | b"blob" | b"data")
    }

    pub fn is_loopback(&self) -> bool {
        crate::origin::is_loopback(self.hostname())
    }

    pub fn has_address(&self) -> bool {
        is_address(self.hostname())
    }

    fn rebuilt(&self, parts: &[&[u8]]) -> Url {
        Url::serialized(parts.concat().into()).unwrap_or_else(|| self.clone())
    }

    pub fn without_credentials(&self) -> Url {
        if !self.includes_credentials() {
            return self.clone();
        }
        self.rebuilt(&[
            self.protocol(),
            b"//",
            &self.href[self.host_start as usize..],
        ])
    }

    /// Without credentials and fragment.
    /// `None` leaves that part as it is.
    pub fn with_credentials(self, name: Option<&[u8]>, password: Option<&[u8]>) -> Url {
        if (name.is_none() && password.is_none()) || self.hostname().is_empty() {
            return self;
        }
        let encode = |given: Option<&[u8]>, own: &[u8]| {
            let escape = |it: &u8| match it {
                b'/' | b':' | b'@' | b'?' | b'#' | b'\\' | ..=b' ' => {
                    format!("%{it:02X}").into_bytes()
                }
                _ => vec![*it],
            };
            given.map_or_else(|| own.to_vec(), |it| it.iter().flat_map(escape).collect())
        };
        let (name, password) = (
            encode(name, self.username()),
            encode(password, self.password()),
        );
        let bare = self.without_credentials();
        let (start, rest) = bare.href().split_at(bare.protocol().len() + 2);
        Url::parse(&[start, &name, b":", &password, b"@", rest].concat()).unwrap_or(self)
    }

    pub fn stripped(&self) -> Url {
        self.rebuilt(&[self.without_fragment()])
            .without_credentials()
    }

    pub fn with_fragment(&self, fragment: &[u8]) -> Url {
        self.rebuilt(&[self.without_fragment(), b"#", fragment])
    }

    /// From one special scheme to another.
    pub fn with_scheme(&self, scheme: &[u8]) -> Url {
        Url::parse(&[scheme, &self.href[self.scheme_end as usize..]].concat())
            .unwrap_or_else(|| self.clone())
    }

    /// Like the setter of `host`.
    pub fn with_host(&self, host: &[u8]) -> Option<Url> {
        let has_port =
            strings::rsplit_once_char(host, b':').is_some_and(|it| !it.1.ends_with(b"]"));
        let kept = if has_port {
            self.authority_end
        } else {
            self.host_end
        };
        Url::parse(
            &[
                self.part(0, self.host_start),
                host,
                &self.href[kept as usize..],
            ]
            .concat(),
        )
    }

    /// Like the setter of `pathname`, for a URL with a host.
    pub fn with_path(&self, path: &[u8]) -> Url {
        let mut href = self.part(0, self.authority_end).to_vec();
        if !path.starts_with(b"/") {
            href.push(b'/');
        }
        for byte in path {
            match byte {
                b'?' => href.extend_from_slice(b"%3F"),
                b'#' => href.extend_from_slice(b"%23"),
                _ => href.push(*byte),
            }
        }
        href.extend_from_slice(&self.href[self.path_end as usize..]);
        Url::parse(&href).unwrap_or_else(|| self.clone())
    }

    /// `None` if what it names is not what its segments say.
    pub fn file_path(&self) -> Option<Vec<u8>> {
        let hides = |escape: &&[u8]| strings::contains(&self.path().to_ascii_lowercase(), escape);
        let escapes: &[&[u8]] = if cfg!(windows) {
            &[b"%2f", b"%00", b"%5c"]
        } else {
            &[b"%2f", b"%00"]
        };
        if self.scheme() != b"file"
            || escapes.iter().any(hides)
            || (!cfg!(windows) && !self.hostname().is_empty())
        {
            return None;
        }
        let path = bun_url::path_from_file_url(&StringView::borrow_utf8(&self.href));
        (!path.is_dead()).then(|| path.to_owned_slice())
    }
}

pub fn is_address(host: &[u8]) -> bool {
    host.starts_with(b"[")
        || (!host.is_empty() && host.iter().all(|it| it.is_ascii_digit() || *it == b'.'))
}

/// https://url.spec.whatwg.org/#percent-decode
/// https://url.spec.whatwg.org/#concept-urlencoded-parser
pub fn parse_url_encoded(input: &[u8]) -> impl Iterator<Item = (Vec<u8>, Vec<u8>)> {
    let decode = |it| percent_decode(&strings::replace_owned(it, b"+", b" "));
    strings::tokenize(input, b"&").map(move |it| {
        let (name, value) = strings::split_once_char(it, b'=').unwrap_or((it, b""));
        (decode(name), decode(value))
    })
}

pub fn percent_decode(mut input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    while let Some(at) = strings::index_of_char_usize(input, b'%') {
        out.extend_from_slice(&input[..at]);
        input = match input[at..] {
            [_, high, low, ..] if high.is_ascii_hexdigit() && low.is_ascii_hexdigit() => {
                out.push(
                    (strings::to_ascii_hex_value(high) << 4) | strings::to_ascii_hex_value(low),
                );
                &input[at + 3..]
            }
            _ => {
                out.push(b'%');
                &input[at + 1..]
            }
        };
    }
    out.extend_from_slice(input);
    out
}
