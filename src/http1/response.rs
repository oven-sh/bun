use bun_core::StringPointer;
use bun_http_types::ETag::{HeaderEntry, Headers};

use crate::byte_sets::{CONTENT, TOKEN};
use crate::{Error, Result};

/// The status and header fields of a response.
#[derive(Default)]
pub struct Response {
    pub minor_version: u8,
    pub status_code: u32,
    /// From a [`ResponseParser`], `buf` is the head as it was received.
    pub headers: Headers,
    /// In `headers.buf`.
    status_text: StringPointer,
}

impl Response {
    /// For HTTP/2 and HTTP/3, which have no status line.
    pub fn from_fields(status_code: u32, headers: Headers) -> Self {
        Self {
            minor_version: 1,
            status_code,
            headers,
            status_text: StringPointer::default(),
        }
    }

    pub fn status_text(&self) -> &[u8] {
        self.headers.as_str(self.status_text)
    }
}

#[derive(Clone, Copy)]
pub struct HeadOptions {
    /// Of one head, from the status line to the empty line.
    pub max_len: u32,
    pub max_headers: usize,
    /// Of all interim responses together.
    pub max_interim_len: usize,
    /// To leave after the head in `headers.buf`.
    pub spare_capacity: usize,
}

/// Parses a response head (RFC 9112 §4, §5) read by read.
#[derive(Default)]
pub struct ResponseParser {
    /// What earlier reads brought of the current head.
    received: Vec<u8>,
    lines: Lines,
    open_run: Option<Run>,
    interim_len: usize,
}

impl ResponseParser {
    /// Once a head other than 100 and 102 to 199 is complete, returns it and the rest of `data`.
    // Inlined, the response is built where the caller keeps it.
    #[inline(always)]
    pub fn feed<'a>(
        &mut self,
        mut data: &'a [u8],
        options: HeadOptions,
    ) -> Result<Option<(Response, &'a [u8])>> {
        loop {
            if self.interim_len > options.max_interim_len {
                return Err(Error::HeadTooLong);
            }
            let earlier = self.received.len();
            let room = (options.max_len as usize).saturating_sub(earlier);
            let window = data.get(..room).unwrap_or(data);
            let head = if earlier == 0 {
                window
            } else {
                self.received.extend_from_slice(window);
                &self.received
            };

            let parsed = match self.open_run.take() {
                Some(run) if run.covers(window) => Err(Stop::Short(Some(run))),
                _ => self.lines.parse(head, options.max_headers),
            };
            let len = match parsed {
                Ok(len) => len,
                Err(stop) => {
                    if earlier == 0 {
                        self.received.extend_from_slice(window);
                    }
                    return match stop {
                        Stop::Malformed => Err(Error::MalformedHead),
                        Stop::Short(_) if window.len() < data.len() => Err(Error::HeadTooLong),
                        Stop::Short(run) => {
                            self.open_run = run;
                            Ok(None)
                        }
                    };
                }
            };
            data = data.get(len.saturating_sub(earlier)..).unwrap_or_default();

            if !matches!(self.lines.response.status_code, 100 | 102..=199) {
                let mut buf = Vec::with_capacity(len + options.spare_capacity);
                buf.extend_from_slice(head.get(..len).unwrap_or(head));
                let mut response = core::mem::take(self).lines.response;
                response.headers.buf = buf;
                return Ok(Some((response, data)));
            }
            self.interim_len += len;
            self.received.clear();
            self.lines.clear();
        }
    }

    /// How much of the current head has arrived. A malformed one stays current.
    pub fn received_len(&self) -> usize {
        self.received.len()
    }

    pub fn memory_cost(&self) -> usize {
        self.received.capacity() + self.lines.response.headers.memory_cost()
    }
}

enum Stop {
    Malformed,
    Short(Option<Run>),
}

/// What an incomplete line ends in. The line is not parsed again while more of it arrives.
#[derive(Clone, Copy)]
enum Run {
    Spaces,
    Token,
    Content,
}

impl Run {
    fn covers(self, bytes: &[u8]) -> bool {
        match self {
            Self::Spaces => skip_spaces(bytes).is_empty(),
            Self::Token => TOKEN.prefix_len(bytes) == bytes.len(),
            Self::Content => CONTENT.prefix_len(bytes) == bytes.len(),
        }
    }
}

/// The complete lines of a head.
#[derive(Default)]
struct Lines {
    response: Response,
    len: usize,
}

impl Lines {
    fn clear(&mut self) {
        self.response.headers.entries.clear_retaining_capacity();
        self.len = 0;
    }

    /// Returns the length of the head, which `head` starts with.
    // Inlined, it slows down short heads.
    #[inline(never)]
    fn parse(&mut self, head: &[u8], max_headers: usize) -> Result<usize, Stop> {
        let mut rest = match self.len {
            0 => self.parse_status_line(head)?,
            len => head.get(len..).unwrap_or_default(),
        };
        loop {
            self.len = head.len() - rest.len();
            match rest {
                [] => return Err(Stop::Short(None)),
                [b'\r' | b'\n', ..] => return Ok(head.len() - skip_line_end(rest)?.len()),
                _ if self.response.headers.entries.len() >= max_headers => {
                    return Err(Stop::Malformed);
                }
                _ => rest = self.parse_field_line(rest)?,
            }
        }
    }

    fn parse_status_line<'a>(&mut self, head: &'a [u8]) -> Result<&'a [u8], Stop> {
        const VERSION: &[u8; 7] = b"HTTP/1.";
        let Some((&[ref version @ .., minor, space], rest)) = head.split_first_chunk::<9>() else {
            let version = head.get(..VERSION.len()).unwrap_or(head);
            return Err(if VERSION.starts_with(version) {
                Stop::Short(None)
            } else {
                Stop::Malformed
            });
        };
        if version != VERSION || !minor.is_ascii_digit() || space != b' ' {
            return Err(Stop::Malformed);
        }
        let rest = skip_spaces(rest);
        let (code, rest) = match rest.split_first_chunk::<3>() {
            Some((code, rest @ [b' ' | b'\r' | b'\n', ..])) => (code, rest),
            Some((_, [_, ..])) => return Err(Stop::Malformed),
            _ => return Err(Stop::Short(rest.is_empty().then_some(Run::Spaces))),
        };
        let [b'1'..=b'9', b'0'..=b'9', b'0'..=b'9'] = code else {
            return Err(Stop::Malformed);
        };
        // From the start of the line, which leaves a short head enough bytes for a vector.
        let line_len = CONTENT.prefix_len(head);
        let next = skip_line_end(head.get(line_len..).unwrap_or_default())?;
        let text_offset = head.len() - skip_spaces(rest).len();
        let text = head.get(text_offset..line_len).unwrap_or_default();

        self.response.minor_version = minor - b'0';
        self.response.status_code = code
            .iter()
            .fold(0, |code, digit| code * 10 + u32::from(digit - b'0'));
        self.response.status_text = pointer(text_offset, text);
        Ok(next)
    }

    /// `rest` is what follows the complete lines.
    #[inline(always)]
    fn parse_field_line<'a>(&mut self, rest: &'a [u8]) -> Result<&'a [u8], Stop> {
        let (line, end) = rest
            .split_at_checked(CONTENT.prefix_len(rest))
            .unwrap_or((rest, &[]));
        let (name, value) = match line.split_at_checked(TOKEN.prefix_len(rest)) {
            Some((name @ [_, ..], [b':', value @ ..])) => (name, value),
            Some((_, [])) if end.is_empty() => return Err(Stop::Short(Some(Run::Token))),
            _ => return Err(Stop::Malformed),
        };
        let next = skip_line_end(end)?;

        let entries = &mut self.response.headers.entries;
        // For a lone field: a small block is cheaper to free on another thread.
        if let (0, [b'\r' | b'\n', ..]) = (entries.capacity(), next) {
            bun_core::handle_oom(entries.set_capacity(1));
        }
        let value = value.trim_ascii_start();
        bun_core::handle_oom(entries.append(HeaderEntry {
            name: pointer(self.len, name),
            value: pointer(self.len + line.len() - value.len(), value.trim_ascii_end()),
        }));
        Ok(next)
    }
}

/// `max_len` keeps both within `u32`.
fn pointer(offset: usize, bytes: &[u8]) -> StringPointer {
    StringPointer {
        offset: offset as u32,
        length: bytes.len() as u32,
    }
}

fn skip_spaces(mut bytes: &[u8]) -> &[u8] {
    while let [b' ', rest @ ..] = bytes {
        bytes = rest;
    }
    bytes
}

/// For what follows a run of content. RFC 9112 §2.2 allows a lone LF.
#[inline(always)]
fn skip_line_end(bytes: &[u8]) -> Result<&[u8], Stop> {
    if let Some((b"\r\n", rest)) = bytes.split_first_chunk() {
        return Ok(rest);
    }
    match bytes {
        [b'\n', rest @ ..] => Ok(rest),
        [] => Err(Stop::Short(Some(Run::Content))),
        [b'\r'] => Err(Stop::Short(None)),
        _ => Err(Stop::Malformed),
    }
}
