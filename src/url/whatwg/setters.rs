//! The setters of the `URL` class. They return [`Error::Invalid`] where the basic URL parser returns failure, which
//! the class ignores, and if the URL is invalid.

use bun_engine_text::{AllocError, Text};

use crate::authority::{leading_port, serialize_port};
use crate::buffer::Buffer;
use crate::class::{FRAGMENT, NUMBER_SIGN, PATH, QUESTION_MARK, TAIL_SCAN, USERINFO};
use crate::components::Components;
use crate::input::{Source, Transcoder};
use crate::parser::{Parser, Step};
use crate::record::{View, concat};
use crate::scheme::scan_scheme;
use crate::{Error, Punycode, Result, Scheme, Url, percent};

#[inline(always)]
fn without_tab_or_newline<T>(
    value: Text<'_>,
    attempt: impl FnMut(Source<'_>) -> Result<T>,
) -> Result<T> {
    Transcoder::new()
        .source(value)?
        .retry_without_tab_or_newline(attempt)
}

/// The port state with a state override, whatever the default port is.
fn assigned_port(text: &[u8]) -> Result<Option<u16>> {
    let (count, port) = leading_port(text);
    match text.get(count) {
        Some(b'\t' | b'\n' | b'\r') => Err(Error::Invalid),
        _ => Ok(port),
    }
}

fn strip_prefix(value: Text<'_>, prefix: u8) -> Text<'_> {
    value.slice_from(usize::from(value.get(0) == Some(u16::from(prefix))))
}

/// For offsets behind a place that has moved.
#[inline]
fn shift<const N: usize>(offsets: [&mut u32; N], from: u32, to: u32) {
    for offset in offsets {
        *offset = *offset - from + to;
    }
}

/// The port state with a state override. `None` stands for the default port.
fn parse_port(value: Text<'_>, scheme: Scheme) -> Result<Option<u16>> {
    without_tab_or_newline(value, |value| {
        let port = assigned_port(value.bytes)?.ok_or(Error::Invalid)?;
        Ok(Some(port).filter(|&port| Some(port) != scheme.default_port()))
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum HostSetter {
    Host,
    Hostname,
}

impl<'a> Parser<'a> {
    /// Starts the output with the first `length` bytes of `url`.
    #[inline]
    fn continue_from(&mut self, url: &View<'a>, length: u32) -> Result<()> {
        if !self.out.has_room_for(url.text) {
            return Err(Error::OutOfMemory);
        }
        self.out.start_with(&url.text[..length as usize], 0);
        Ok(())
    }

    /// The URL that has `rest` behind the output up to `end`.
    fn into_url(self, end: usize, rest: [&[u8]; 2]) -> Result<Url> {
        let [head, body, pending] = self.out.pieces(end);
        Ok(Url {
            text: Some(concat([head, body, pending, rest[0], rest[1]])?),
            parts: self.parts,
        })
    }
}

impl Url {
    fn valid_view(&self) -> Result<View<'_>> {
        self.view().ok_or(Error::Invalid)
    }

    fn cannot_have_credentials_or_port(&self) -> bool {
        self.hostname().is_empty() || self.scheme() == Scheme::File
    }

    pub fn set_protocol(&mut self, value: Text<'_>) -> Result<()> {
        without_tab_or_newline(value, |value| {
            let url = self.valid_view()?;
            let (length, _) = scan_scheme(value.bytes);
            let (name, rest) = value.bytes.split_at(length);
            if name.is_empty() || !matches!(rest, [] | [b':', ..]) {
                return Err(Error::Invalid);
            }
            let scheme = Scheme::of_any_case(name);
            if scheme.is_special() != url.scheme().is_special()
                || (scheme == Scheme::File && (url.has_credentials() || url.port().is_some()))
                || (url.scheme() == Scheme::File && url.hostname().is_empty())
            {
                return Ok(());
            }

            let mut lowercase = Buffer::new();
            lowercase.extend(name)?;
            lowercase.make_ascii_lowercase();
            let old = url.parts;
            let drops_port = old.port().is_some() && old.port() == scheme.default_port();
            let after_port = if drops_port {
                old.path_start
            } else {
                old.host_end
            };
            let text = concat([
                &lowercase,
                url.slice(old.scheme_end..old.host_end),
                url.slice_from(after_port),
            ])?;

            let mut new = Components { scheme, ..old };
            let up_to_host = [
                &mut new.scheme_end,
                &mut new.username_end,
                &mut new.host_start,
                &mut new.host_end,
            ];
            shift(up_to_host, old.scheme_end, length as u32);
            let host_end = new.host_end;
            new.shift_from_path(after_port, host_end);
            if drops_port {
                new.port = 0;
            }
            (self.text, self.parts) = (Some(text), new);
            Ok(())
        })
    }

    fn set_credentials(
        &self,
        username: &[u8],
        password: &[u8],
    ) -> core::result::Result<Url, AllocError> {
        let old = self.parts;
        let start = old.scheme_end + 3;
        let colon: &[u8] = if password.is_empty() { b"" } else { b":" };
        let has_none = username.is_empty() && password.is_empty();
        let at_sign: &[u8] = if has_none { b"" } else { b"@" };
        let rest = self.slice_from(old.host_start);
        let text = concat([
            self.slice(0..start),
            username,
            colon,
            password,
            at_sign,
            rest,
        ])?;

        let mut new = old;
        new.username_end = start + username.len() as u32;
        new.host_start = (text.len() - rest.len()) as u32;
        shift([&mut new.host_end], old.host_start, new.host_start);
        new.shift_from_path(old.host_start, new.host_start);
        Ok(Url {
            text: Some(text),
            parts: new,
        })
    }

    pub fn set_username(&mut self, value: Text<'_>) -> core::result::Result<(), AllocError> {
        if !self.cannot_have_credentials_or_port() {
            let mut username = Buffer::new();
            percent::encode(Transcoder::new().source(value)?, USERINFO, &mut username)?;
            *self = self.set_credentials(&username, self.password())?;
        }
        Ok(())
    }

    pub fn set_password(&mut self, value: Text<'_>) -> core::result::Result<(), AllocError> {
        if !self.cannot_have_credentials_or_port() {
            let mut password = Buffer::new();
            percent::encode(Transcoder::new().source(value)?, USERINFO, &mut password)?;
            *self = self.set_credentials(self.username(), &password)?;
        }
        Ok(())
    }

    pub fn remove_credentials(&mut self) -> core::result::Result<(), AllocError> {
        if self.has_credentials() {
            *self = self.set_credentials(b"", b"")?;
        }
        Ok(())
    }

    /// The host changes even if what should be a port is none.
    pub fn set_host(&mut self, value: Text<'_>, punycode: Punycode) -> Result<()> {
        self.set_host_with(value, punycode, HostSetter::Host)
    }

    pub fn set_hostname(&mut self, value: Text<'_>, punycode: Punycode) -> Result<()> {
        self.set_host_with(value, punycode, HostSetter::Hostname)
    }

    fn set_host_with(
        &mut self,
        value: Text<'_>,
        punycode: Punycode,
        setter: HostSetter,
    ) -> Result<()> {
        without_tab_or_newline(value, |value| {
            let url = self.valid_view()?;
            if url.has_opaque_path() {
                return Ok(());
            }
            let old = url.parts;
            let mut parser = Parser::new(value, punycode, old);
            parser.continue_from(&url, old.host_start)?;
            if !old.has_host() {
                parser.out.replace(0, 0, b"//")?;
                parser.parts.set_empty_authority(parser.mark(0));
            }
            let (end, traits) = parser.scan_host(0);
            let port_text = value.bytes[end..].strip_prefix(b":");
            if old.scheme == Scheme::File {
                parser.host_of_file(0, end, traits)?;
            } else if port_text.is_some() && (end == 0 || setter == HostSetter::Hostname) {
                return Err(Error::Invalid);
            } else if end != 0 {
                parser.host(0, end, traits)?;
            } else if old.scheme.is_special() || old.has_credentials() || old.port().is_some() {
                return Err(Error::Invalid);
            }

            let port = match assigned_port(port_text.unwrap_or_default())? {
                None => old.port(),
                port => port.filter(|_| port != old.scheme.default_port()),
            };
            let mut storage = [0; 6];
            let port_text = port.map_or(&[][..], |port| serialize_port(port, &mut storage));
            parser.parts.port = port.unwrap_or(0);
            parser.parts.host_end = parser.mark(end);
            parser.parts.path_start = old.path_start;
            let path_start = parser.parts.host_end + port_text.len() as u32;
            parser.parts.shift_from_path(old.path_start, path_start);
            *self = parser.into_url(end, [port_text, url.slice_from(old.path_start)])?;
            Ok(())
        })
    }

    pub fn set_port(&mut self, value: Text<'_>) -> Result<()> {
        if self.cannot_have_credentials_or_port() {
            return Ok(());
        }
        let port = if value.is_empty() {
            None
        } else {
            parse_port(value, self.scheme())?
        };
        let old = self.parts;
        let mut storage = [0; 6];
        let port_text = port.map_or(&[][..], |port| serialize_port(port, &mut storage));
        let rest = self.slice_from(old.path_start);
        self.text = Some(concat([self.slice(0..old.host_end), port_text, rest])?);
        self.parts.port = port.unwrap_or(0);
        self.parts
            .shift_from_path(old.path_start, old.host_end + port_text.len() as u32);
        Ok(())
    }

    pub fn set_pathname(&mut self, value: Text<'_>) -> Result<()> {
        without_tab_or_newline(value, |value| {
            let url = self.valid_view()?;
            if url.has_opaque_path() {
                return Ok(());
            }
            let old = url.parts;
            let mut parser = Parser::new(value, Punycode::Unchecked, old);
            parser.continue_from(&url, old.authority_end())?;
            parser.parts.path_start = old.authority_end();
            let stays_empty = value.bytes.is_empty() && old.has_host() && !parser.is_special();
            if !stays_empty && let Step::Segments(start) = parser.first_slash(0)? {
                let syntax = parser.path_syntax(PATH | QUESTION_MARK | NUMBER_SIGN);
                let start = parser.segment_start(start as usize, syntax)?;
                parser.path(&mut TAIL_SCAN.scan(value.bytes, start), syntax)?;
            }
            let end = value.bytes.len();
            parser.parts.path_end = parser.mark(end);
            shift(
                [&mut parser.parts.query_end],
                old.path_end,
                parser.parts.path_end,
            );
            *self = parser.into_url(end, [url.slice_from(old.path_end), b""])?;
            Ok(())
        })
    }

    pub fn set_search(&mut self, value: Text<'_>) -> Result<()> {
        self.set_query((!value.is_empty()).then(|| strip_prefix(value, b'?')))
    }

    /// All of `value` comes behind the `?`.
    pub fn set_query(&mut self, value: Option<Text<'_>>) -> Result<()> {
        without_tab_or_newline(value.unwrap_or(Text::EMPTY), |source| {
            let url = self.valid_view()?;
            let old = url.parts;
            let mut parser = Parser::new(source, Punycode::Unchecked, old);
            parser.continue_from(&url, old.path_end)?;
            let set = parser.query_set() | NUMBER_SIGN;
            let end = parser.encode_up_to_fragment(&mut TAIL_SCAN.scan(source.bytes, 0), set)?;
            let [head, body, pending] = parser.out.pieces(end);
            let delimiter: &[u8] = if value.is_some() { b"?" } else { b"" };
            let rest = url.slice_from(old.query_end);
            let text = concat([head, delimiter, body, pending, rest])?;
            self.parts.query_end = (text.len() - rest.len()) as u32;
            self.text = Some(text);
            Ok(())
        })
    }

    pub fn set_hash(&mut self, value: Text<'_>) -> Result<()> {
        self.set_fragment((!value.is_empty()).then(|| strip_prefix(value, b'#')))
    }

    /// All of `value` comes behind the `#`.
    pub fn set_fragment(&mut self, value: Option<Text<'_>>) -> Result<()> {
        without_tab_or_newline(value.unwrap_or(Text::EMPTY), |source| {
            let url = self.valid_view()?;
            let mut parser = Parser::new(source, Punycode::Unchecked, url.parts);
            parser.continue_from(&url, url.parts.query_end)?;
            let mut scan = TAIL_SCAN.scan(source.bytes, 0);
            while parser.encode_up_to_fragment(&mut scan, FRAGMENT)? < source.bytes.len() {}
            let [head, body, pending] = parser.out.pieces(source.bytes.len());
            let delimiter: &[u8] = if value.is_some() { b"#" } else { b"" };
            self.text = Some(concat([head, delimiter, body, pending])?);
            Ok(())
        })
    }
}

impl Components {
    #[inline]
    fn shift_from_path(&mut self, from: u32, to: u32) {
        let offsets = [
            &mut self.path_start,
            &mut self.path_end,
            &mut self.query_end,
        ];
        shift(offsets, from, to);
    }
}
