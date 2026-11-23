//! The requests of a connection to `Bun.serve()` or, with `IS_NODE`, to a `node:http` server.

mod chunks;
mod error;
mod framing;
mod head;

use core::mem::{MaybeUninit, take};

use bun_core::strings::eql_case_insensitive_ascii_check_length as eql_ignoring_case;

pub use error::RequestError;
use framing::{Framing, parse_content_length};
pub use head::{Field, Request, parse_trailers};
use head::{MAX_FIELDS, Stop};

/// Room for what `max_header_size` does not count: the method, the version, colons and line ends.
const MAX_FRAMING_LEN: u64 = (MAX_FIELDS as u64 + 2) * 4 + 64;
/// Of one chunk.
const MAX_EXTENSION_LEN: usize = 16 * 1024;

#[repr(C)]
pub struct RequestOptions {
    /// 0 if it is not set.
    pub max_header_size: u64,
    /// 0 if it is not set.
    pub max_headers_count: u32,
    pub requires_host: bool,
    pub has_strict_methods: bool,
    pub has_lenient_values: bool,
    pub has_lenient_transfer_encoding: bool,
}

/// The owner of a parser. A call that returns `None` ends the read, and may have dropped the parser.
pub trait Connection: Sized {
    fn parser(&mut self) -> &mut RequestParser;
    fn on_request(self, request: &Request<'_>) -> Option<Self>;
    fn on_body(self, data: &[u8], is_last: bool) -> Option<Self>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Consumed,
    /// By the connection. What follows the first `consumed` bytes of the read is not HTTP.
    Stopped {
        consumed: usize,
    },
    Failed(RequestError),
}

impl From<RequestError> for Outcome {
    fn from(error: RequestError) -> Self {
        Self::Failed(error)
    }
}

/// What the next byte belongs to.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Body {
    None,
    Content,
    ChunkSize,
    ChunkExtension,
    ChunkSizeLf,
    ChunkData,
    LastCr,
    LastLf,
    Trailers,
    AfterTrailers,
    Tunnel,
    Failed(RequestError),
}

/// packages/bun-uws/src/HttpParser.h mirrors the public fields and the size.
#[repr(C)]
pub struct RequestParser {
    /// A request was the last one, or a response of `Bun.serve()` closed the connection.
    pub is_closing: bool,
    pub is_body_until_eof: bool,
    /// After CONNECT or an accepted upgrade.
    pub is_tunnel: bool,
    has_size_digit: bool,
    body: Body,
    /// Of the content, or of the chunk with its line end. The size so far in a chunk's first line.
    remaining: u64,
    extension_len: usize,
    default_max_head_len: usize,
    partial_head: Vec<u8>,
    trailers: Vec<u8>,
}

impl RequestParser {
    pub fn new(default_max_head_len: usize) -> Self {
        Self {
            is_closing: false,
            is_body_until_eof: false,
            is_tunnel: false,
            has_size_digit: false,
            body: Body::None,
            remaining: 0,
            extension_len: 0,
            default_max_head_len,
            partial_head: Vec::new(),
            trailers: Vec::new(),
        }
    }

    pub fn has_partial_head(&self) -> bool {
        !self.partial_head.is_empty()
    }

    pub fn has_incomplete_body(&self) -> bool {
        !matches!(self.body, Body::None | Body::AfterTrailers)
    }

    /// The trailer section of the current request, with the empty line that ends it.
    pub fn take_trailers(&mut self) -> Vec<u8> {
        take(&mut self.trailers)
    }

    fn check_trailers(&self, options: &RequestOptions) -> Result<(), RequestError> {
        if self.trailers.len() <= 2 {
            return Ok(());
        }
        let fields = parse_trailers(&self.trailers, options.has_lenient_values);
        if fields.is_empty() {
            return Err(RequestError::InvalidField);
        }
        if options.max_headers_count != 0 && fields.len() > options.max_headers_count as usize {
            return Err(RequestError::TrailersTooLarge);
        }
        if options.has_lenient_transfer_encoding {
            return Ok(());
        }
        fields.iter().try_for_each(|field| {
            if eql_ignoring_case(field.name, b"content-length") {
                Err(RequestError::ContentLengthInTrailers)
            } else if eql_ignoring_case(field.name, b"transfer-encoding") {
                Err(RequestError::InvalidTransferEncoding)
            } else {
                Ok(())
            }
        })
    }
}

/// Parses what `connection` has just read.
pub fn read<const IS_NODE: bool>(
    mut connection: impl Connection,
    bytes: &[u8],
    options: &RequestOptions,
) -> Outcome {
    let max_head_len = match options.max_header_size {
        0 => connection.parser().default_max_head_len,
        max => usize::try_from(max.saturating_add(MAX_FRAMING_LEN)).unwrap_or(usize::MAX),
    };
    let read = Read::<IS_NODE> {
        bytes,
        options,
        max_head_len,
    };
    read.run(connection).err().unwrap_or(Outcome::Consumed)
}

struct Read<'a, const IS_NODE: bool> {
    bytes: &'a [u8],
    options: &'a RequestOptions,
    max_head_len: usize,
}

/// What came of the bytes that follow a message.
enum Start {
    Short,
    NotHttp,
    Request(Framing),
}

/// The connection and what is left of the read, unless it is over.
type Step<'a, C> = Result<(C, &'a [u8]), Outcome>;

impl<'a, const IS_NODE: bool> Read<'a, IS_NODE> {
    fn run<C: Connection>(&self, mut connection: C) -> Result<(), Outcome> {
        let mut rest = self.bytes;
        let parser = connection.parser();
        if parser.is_body_until_eof || parser.body != Body::None {
            (connection, rest) = self.continue_body(connection, rest)?;
        } else if parser.has_partial_head() {
            (connection, rest) = self.continue_head(connection)?;
        }

        loop {
            // RFC 9112 §2.2
            while let [b'\r' | b'\n', after @ ..] = rest
                && IS_NODE
                && !connection.parser().is_tunnel
            {
                rest = after;
            }
            if rest.is_empty() {
                return Ok(());
            }
            let start;
            (connection, rest, start) = self.start(connection, rest, 0, rest)?;
            match start {
                Start::Request(framing) => {
                    (connection, rest) = self.start_body(connection, framing, rest)?;
                }
                Start::NotHttp => return Ok(()),
                Start::Short if rest.len() >= self.max_head_len => {
                    return Err(RequestError::HeadTooLarge.into());
                }
                Start::Short => {
                    connection.parser().partial_head.extend_from_slice(rest);
                    return Ok(());
                }
            }
        }
    }

    fn continue_head<C: Connection>(&self, mut connection: C) -> Step<'a, C> {
        // The request borrows it while the parser can be dropped.
        let mut head = take(&mut connection.parser().partial_head);
        let earlier = head.len();
        let room = self.max_head_len.wrapping_sub(earlier);
        let (copied, beyond) = (self.bytes.split_at_checked(room)).unwrap_or((self.bytes, &[]));
        head.extend_from_slice(copied);

        let (mut connection, rest, start) = self.start(connection, &head, earlier, self.bytes)?;
        if let Start::Short = start {
            let outcome = match head.len() == self.max_head_len {
                true => RequestError::HeadTooLarge.into(),
                false => Outcome::Consumed,
            };
            connection.parser().partial_head = head;
            return Err(outcome);
        }
        head.clear();
        let parser = connection.parser();
        parser.partial_head = head;
        match start {
            // `Bun.serve()` drops what it parsed the head from.
            Start::Request(_) if !IS_NODE && parser.is_tunnel => {
                parser.body = Body::Tunnel;
                self.continue_body(connection, beyond)
            }
            Start::Request(framing) => self.start_body(connection, framing, rest),
            _ => Ok((connection, rest)),
        }
    }

    /// `message` has `earlier` bytes of earlier reads, then all or the start of `unread`.
    fn start<C: Connection>(
        &self,
        mut connection: C,
        message: &[u8],
        earlier: usize,
        unread: &'a [u8],
    ) -> Result<(C, &'a [u8], Start), Outcome> {
        let after = |len: usize| {
            unread
                .get(len.saturating_sub(earlier)..)
                .unwrap_or_default()
        };
        let parser = connection.parser();
        if IS_NODE && parser.is_tunnel {
            let rest = after(message.len());
            let connection = connection.on_body(message, false);
            return Ok((
                connection.ok_or_else(|| self.stop(rest))?,
                rest,
                Start::NotHttp,
            ));
        }
        if parser.is_closing {
            return match IS_NODE {
                true => Err(RequestError::ClosedConnection.into()),
                false => Ok((connection, after(message.len()), Start::NotHttp)),
            };
        }

        let mut storage = [MaybeUninit::uninit(); MAX_FIELDS];
        let (mut request, len) =
            match Request::parse::<IS_NODE>(message, &mut storage, self.options) {
                Ok(parsed) => parsed,
                Err(Stop::Short) => return Ok((connection, unread, Start::Short)),
                Err(Stop::Failed(error)) => return Err(error.into()),
            };
        if len > self.max_head_len {
            return Err(RequestError::HeadTooLarge.into());
        }
        parser.is_closing = request.is_http_1_0()
            || match IS_NODE {
                true => request.has_in_connection_or_proxy_connection(b"close"),
                false => request.has_in_connection(b"close"),
            };

        let content_length = request.content_length()?;
        let framing = request.decide_framing::<IS_NODE>(content_length.is_some(), self.options)?;
        if self.options.requires_host && !request.is_http_1_0() && request.field(b"host").is_none()
        {
            return Err(RequestError::MissingHost.into());
        }
        let Some(content_length) = content_length.map_or(Some(0), parse_content_length) else {
            parser.body = Body::Failed(RequestError::InvalidContentLength);
            return Err(RequestError::InvalidContentLength.into());
        };
        parser.remaining = content_length;
        if content_length != 0 {
            parser.body = Body::Content;
        }
        parser.is_tunnel |= request.is_connect();

        let rest = after(len);
        request.after_head = rest;
        let has_body = request.has_transfer_encoding() || content_length != 0;
        let mut connection = connection
            .on_request(&request)
            .ok_or_else(|| self.stop(if has_body { &[] } else { rest }))?;

        // Only now, so that the response to an accepted upgrade does not close its tunnel.
        let parser = connection.parser();
        parser.is_closing |= request.ends_connection();
        if framing == Framing::Invalid {
            return Err(RequestError::InvalidTransferEncoding.into());
        }
        parser.trailers.clear();
        Ok((connection, rest, Start::Request(framing)))
    }

    fn start_body<C: Connection>(
        &self,
        mut connection: C,
        framing: Framing,
        rest: &'a [u8],
    ) -> Step<'a, C> {
        let parser = connection.parser();
        if parser.is_tunnel {
            // Node has the rest of the read from `after_head`.
            parser.body = Body::Tunnel;
            return Err(Outcome::Consumed);
        }
        match framing {
            Framing::ContentLength | Framing::Invalid => {}
            Framing::Chunked => parser.start_chunk(),
            Framing::UntilEof => {
                parser.is_body_until_eof = true;
                if rest.is_empty() {
                    return Err(Outcome::Consumed);
                }
            }
        }
        self.continue_body(connection, rest)
    }

    fn continue_body<C: Connection>(&self, mut connection: C, mut rest: &'a [u8]) -> Step<'a, C> {
        let parser = connection.parser();
        if parser.is_body_until_eof {
            let connection = connection.on_body(rest, false);
            return Err(connection.map_or_else(|| self.stop(&[]), |_| Outcome::Consumed));
        }
        if parser.is_tunnel {
            connection.on_body(rest, false);
            return Err(Outcome::Consumed);
        }
        if let Body::None | Body::Content = parser.body {
            let len = usize::try_from(parser.remaining).unwrap_or(usize::MAX);
            let (data, rest) = rest.split_at_checked(len).unwrap_or((rest, &[]));
            parser.remaining -= data.len() as u64;
            let is_last = parser.remaining == 0;
            if is_last {
                parser.body = Body::None;
            }
            let connection = connection.on_body(data, is_last);
            return Ok((connection.ok_or_else(|| self.stop(rest))?, rest));
        }
        loop {
            let parser = connection.parser();
            let chunk = parser.next_chunk::<IS_NODE>(&mut rest, self.max_head_len);
            if parser.extension_len > MAX_EXTENSION_LEN {
                return Err(RequestError::ChunkExtensionsTooLarge.into());
            }
            let Some(data) = chunk else {
                return match parser.body {
                    Body::Failed(error) => Err(error.into()),
                    _ => Ok((connection, rest)),
                };
            };
            let is_last = data.is_empty();
            if IS_NODE && is_last {
                parser.check_trailers(self.options)?;
            }
            connection = connection
                .on_body(data, is_last)
                .ok_or_else(|| self.stop(if is_last { rest } else { &[] }))?;
        }
    }

    fn stop(&self, rest: &[u8]) -> Outcome {
        Outcome::Stopped {
            consumed: self.bytes.len() - rest.len(),
        }
    }
}
