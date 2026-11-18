use std::borrow::Cow;

use bun_core::{StringPointer, strings};

use crate::byte_sets::TOKEN;
use crate::{Error, HeadOptions, Response, ResponseParser, Result};

const BLANKS: &[u8] = b" \t";
const MAX_HEADERS: usize = 2048;

fn head_len(bytes: &[u8], mut at: usize) -> Option<usize> {
    loop {
        at += strings::index_of_char_usize(bytes.get(at..)?, b'\n')? + 1;
        match bytes.get(at..)? {
            [b'\n', ..] => return Some(at + 1),
            [b'\r', b'\n', ..] => return Some(at + 2),
            _ => {}
        }
    }
}

fn status_line_start(bytes: &[u8]) -> Result<Option<usize>> {
    const MAX_JUNK: usize = 4;
    let is_start = |at: &usize| {
        bytes
            .get(*at..at + 4)
            .is_some_and(|it| it.eq_ignore_ascii_case(b"http"))
    };
    match (0..=MAX_JUNK).find(is_start) {
        None if bytes.len() >= MAX_JUNK + 4 => Err(Error::MalformedHead),
        start => Ok(start),
    }
}

fn parse(head: &[u8], options: HeadOptions) -> Result<Response> {
    if strings::contains_char(head, 0) {
        return Err(Error::MalformedHead);
    }
    let mut lines = strings::tokenize_any(head, b"\r\n");
    let status_line = lines.next().unwrap_or_default();
    let (version, rest) = strings::split_once_char(status_line, b' ').unwrap_or((status_line, b""));
    let rest = strings::trim_left(rest, b" ");
    let digits = rest.iter().take_while(|it| it.is_ascii_digit()).count();
    let (digits, status_text) = rest.split_at_checked(digits).unwrap_or_default();
    let mut response = Response {
        minor_version: u8::from(!version.eq_ignore_ascii_case(b"http/1.0")),
        status_code: match digits {
            b"" => 200,
            [_, _, _, _, ..] => return Err(Error::MalformedHead),
            _ => bun_core::fmt::parse_unsigned(digits, 10).map_err(|_| Error::MalformedHead)?,
        },
        ..Response::default()
    };
    let headers = &mut response.headers;
    headers.buf.reserve(head.len() + options.spare_capacity);
    let mut last: Option<(&[u8], Cow<'_, [u8]>)> = None;
    for line in lines.chain([&b""[..]]) {
        if let (Some((_, value)), [b' ' | b'\t', ..]) = (&mut last, line) {
            value.to_mut().push(b' ');
            value.to_mut().extend(strings::trim(line, BLANKS));
            continue;
        }
        if let Some((name, value)) = last {
            if headers.entries.len() == MAX_HEADERS {
                return Err(Error::HeadTooLong);
            }
            headers.append(name, strings::trim(&value, BLANKS));
        }
        last = strings::split_once_char(line, b':')
            .map(|it| {
                (
                    strings::trim_right(it.0, BLANKS),
                    strings::trim(it.1, BLANKS),
                )
            })
            .filter(|it| !it.0.is_empty() && TOKEN.prefix_len(it.0) == it.0.len())
            .map(|it| (it.0, it.1.into()));
    }
    let status_text = strings::trim(status_text, BLANKS);
    response.status_text = StringPointer {
        offset: headers.buf.len() as u32,
        length: status_text.len() as u32,
    };
    headers.buf.extend_from_slice(status_text);
    Ok(response)
}

impl ResponseParser {
    /// Like [`feed`](Self::feed), for what browsers accept.
    pub fn feed_leniently<'a>(
        &mut self,
        mut data: &'a [u8],
        options: HeadOptions,
        mut interim: impl FnMut(&Response),
    ) -> Result<Option<(Response, &'a [u8])>> {
        loop {
            let earlier = self.received.len();
            let bytes = if earlier == 0 {
                data
            } else {
                self.received.extend_from_slice(data);
                &self.received
            };
            let extent = status_line_start(bytes)?.and_then(|start| {
                Some(start..head_len(bytes, start.max(earlier.saturating_sub(2)))?)
            });
            if extent.as_ref().map_or(bytes.len(), |it| it.end) > options.max_len as usize {
                return Err(Error::HeadTooLong);
            }
            let Some(extent) = extent else {
                if earlier == 0 {
                    self.received.extend_from_slice(data);
                }
                return Ok(None);
            };
            data = data
                .get(extent.end.saturating_sub(earlier)..)
                .unwrap_or_default();
            let response = parse(bytes.get(extent).unwrap_or_default(), options)?;
            self.received.clear();
            if !matches!(response.status_code, 100 | 102..=199) {
                return Ok(Some((response, data)));
            }
            interim(&response);
        }
    }
}
