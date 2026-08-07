//! HTTP/1.x response head parser: status line plus field lines, up to and
//! including the blank line that ends the head.

use bstr::BStr;
use bun_core::strings;

use crate::{Header, HeaderList, ParseResponseError, Response};
use ParseResponseError::{MalformedHttpResponse as Invalid, ShortRead as Partial};

bun_core::define_scoped_log!(log, picohttp, hidden);

/// RFC 9110 §5.6.2 `tchar`.
const fn is_tchar(c: u8) -> bool {
    matches!(c,
        b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
        | b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z')
}

static TCHAR: [bool; 256] = {
    let mut t = [false; 256];
    let mut i = 0;
    while i < 256 {
        t[i] = is_tchar(i as u8);
        i += 1;
    }
    t
};

struct Cursor<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    #[inline(always)]
    fn peek(&self) -> Result<u8, ParseResponseError> {
        self.buf.get(self.pos).copied().ok_or(Partial)
    }

    #[inline(always)]
    fn expect(&mut self, c: u8) -> Result<(), ParseResponseError> {
        if self.peek()? != c {
            return Err(Invalid);
        }
        self.pos += 1;
        Ok(())
    }

    #[inline(always)]
    fn digit(&mut self) -> Result<u16, ParseResponseError> {
        let c = self.peek()?;
        if !c.is_ascii_digit() {
            return Err(Invalid);
        }
        self.pos += 1;
        Ok(u16::from(c - b'0'))
    }

    /// Skips a run of bytes matching `f`; `Partial` if the run reaches the end
    /// of the buffer (the caller always needs at least one byte after it).
    #[inline(always)]
    fn skip_while(&mut self, f: impl Fn(u8) -> bool) -> Result<(), ParseResponseError> {
        while f(self.peek()?) {
            self.pos += 1;
        }
        Ok(())
    }

    /// Rest of the current line, excluding the CRLF (or bare LF) terminator.
    /// SP, HTAB, VCHAR and obs-text are content; any other CTL is invalid.
    #[inline(always)]
    fn line(&mut self) -> Result<&'a [u8], ParseResponseError> {
        let start = self.pos;
        let rest = &self.buf[start..];
        let i = index_of_line_end(rest).ok_or(Partial)?;
        match rest[i] {
            b'\r' => match rest.get(i + 1) {
                None => Err(Partial),
                Some(b'\n') => {
                    self.pos = start + i + 2;
                    Ok(&rest[..i])
                }
                Some(_) => Err(Invalid),
            },
            b'\n' => {
                self.pos = start + i + 1;
                Ok(&rest[..i])
            }
            _ => Err(Invalid),
        }
    }

    /// `field-name ":"`, returning the name. Whitespace before the colon is
    /// not a `tchar` and so is rejected (RFC 9112 §5.1).
    #[inline(always)]
    fn field_name(&mut self) -> Result<&'a [u8], ParseResponseError> {
        let start = self.pos;
        let rest = &self.buf[start..];
        // Names are short; a table scan beats a SIMD call here.
        let n = rest
            .iter()
            .position(|&c| !TCHAR[c as usize])
            .ok_or(Partial)?;
        if n == 0 || rest[n] != b':' {
            return Err(Invalid);
        }
        self.pos = start + n + 1;
        Ok(&rest[..n])
    }
}

/// Offset of the first byte of little-endian `word` that is `< 0x20` or
/// `== 0x7F` (so HTAB is included), or 8 if there is none.
#[inline(always)]
fn swar_index_of_ctl_or_htab(word: u64) -> usize {
    const ONES: u64 = u64::MAX / 0xFF;
    const HIGH_BITS: u64 = ONES << 7;
    let below_0x20 = word.wrapping_sub(ONES * 0x20) & !word;
    let xor_0x7f = word ^ (ONES * 0x7F);
    let equals_0x7f = xor_0x7f.wrapping_sub(ONES) & !xor_0x7f;
    // Borrow propagation can set spurious bits, but only in bytes above a
    // genuine match, so the lowest set bit is exact.
    (((below_0x20 | equals_0x7f) & HIGH_BITS).trailing_zeros() / 8) as usize
}

/// [`bun_highway::index_of_http_ctl`], with the first two words checked
/// inline: reason phrases and short field values then never pay for the FFI
/// call and dispatch.
#[inline(always)]
fn index_of_line_end(s: &[u8]) -> Option<usize> {
    let mut i = 0;
    while i < 16 {
        let Some(word) = s[i..].first_chunk::<8>() else {
            break;
        };
        let j = swar_index_of_ctl_or_htab(u64::from_le_bytes(*word));
        if j < 8 {
            if s[i + j] != b'\t' {
                return Some(i + j);
            }
            i += j + 1;
            break;
        }
        i += 8;
    }
    bun_highway::index_of_http_ctl(&s[i..]).map(|j| i + j)
}

impl<'a> Response<'a> {
    /// Parses `buf` as the start of an HTTP/1.x response, borrowing `headers`
    /// for the field lines. Every byte present is validated, so `ShortRead`
    /// means `buf` is a proper prefix of some valid head.
    ///
    /// Line folding (obs-fold, RFC 9112 §5.2) is rejected rather than
    /// unfolded: splicing the continuation into the previous value would need
    /// an allocation, and silently dropping it would corrupt that value. Node
    /// rejects it too.
    pub fn parse(
        buf: &'a [u8],
        headers: &'a mut [Header],
    ) -> Result<Response<'a>, ParseResponseError> {
        let result = parse_response(buf, headers);
        if result.is_err() {
            log!("{:?}:\n{}", result.as_ref().err(), BStr::new(buf));
        }
        let (response, header_count) = result?;
        Ok(Response {
            headers: HeaderList {
                list: &headers[..header_count],
            },
            ..response
        })
    }
}

impl Response<'_> {
    /// Whether `buf` could now hold a complete head, given that its first
    /// `already_seen` bytes were a proper prefix of one (`parse` returned
    /// `ShortRead` on them). Only the new bytes are examined, so a caller
    /// accumulating a trickled response checks each byte a bounded number of
    /// times instead of re-parsing from the start on every read.
    ///
    /// `true` means "run `parse`": either the blank line that ends a head is
    /// present or a stray CR makes the input invalid anyway.
    pub fn may_be_complete(buf: &[u8], already_seen: usize) -> bool {
        // A terminator ending in the new bytes starts at most 3 bytes earlier.
        let mut from = already_seen.saturating_sub(3);
        let mut line_breaks = 0;
        while let Some(i) = strings::index_of_any_pos(buf, b"\r\n", from) {
            if i != from {
                line_breaks = 0;
            }
            if buf[i] == b'\r' {
                match buf.get(i + 1) {
                    None => return false,
                    Some(b'\n') => from = i + 2,
                    Some(_) => return true,
                }
            } else {
                from = i + 1;
            }
            line_breaks += 1;
            if line_breaks == 2 {
                return true;
            }
        }
        false
    }
}

/// Returns the response with an empty header list plus the number of entries
/// written to `headers`, so the caller can attach the borrow.
fn parse_response<'a>(
    buf: &'a [u8],
    headers: &mut [Header],
) -> Result<(Response<'a>, usize), ParseResponseError> {
    let mut c = Cursor { buf, pos: 0 };

    for &b in b"HTTP/1." {
        c.expect(b)?;
    }
    let minor_version = c.digit()? as u8;

    c.expect(b' ')?;
    c.skip_while(|b| b == b' ')?;
    let status_code = c.digit()? * 100 + c.digit()? * 10 + c.digit()?;
    let reason = match c.peek()? {
        b' ' => {
            c.skip_while(|b| b == b' ')?;
            c.line()?
        }
        b'\r' | b'\n' => c.line()?,
        _ => return Err(Invalid),
    };

    let mut header_count = 0;
    loop {
        match c.peek()? {
            b'\r' => {
                c.pos += 1;
                c.expect(b'\n')?;
                break;
            }
            b'\n' => {
                c.pos += 1;
                break;
            }
            b' ' | b'\t' => return Err(Invalid),
            _ => {}
        }
        if header_count == headers.len() {
            return Err(Invalid);
        }
        let name = c.field_name()?;
        c.skip_while(|b| b == b' ' || b == b'\t')?;
        let value = strings::trim_right(c.line()?, b" \t");
        headers[header_count] = Header::new(name, value);
        header_count += 1;
    }

    Ok((
        Response {
            minor_version: usize::from(minor_version),
            status_code: u32::from(status_code),
            status: reason,
            headers: HeaderList::default(),
            bytes_read: c.pos,
        },
        header_count,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OK: i32 = 0;
    const PARTIAL: i32 = -2;
    const INVALID: i32 = -1;

    struct Head<'a> {
        minor_version: usize,
        status_code: u32,
        reason: &'a [u8],
        len: usize,
    }

    fn parse(buf: &[u8], max_headers: usize) -> (i32, Option<Head<'_>>, Vec<Header>) {
        let mut headers = vec![Header::ZERO; max_headers];
        match parse_response(buf, &mut headers) {
            Ok((r, n)) => {
                headers.truncate(n);
                let head = Head {
                    minor_version: r.minor_version,
                    status_code: r.status_code,
                    reason: r.status,
                    len: r.bytes_read,
                };
                (OK, Some(head), headers)
            }
            Err(Partial) => (PARTIAL, None, vec![]),
            Err(Invalid) => (INVALID, None, vec![]),
        }
    }

    fn check(buf: &[u8], expect: i32) -> Option<(Head<'_>, Vec<Header>)> {
        let (rc, head, headers) = parse(buf, 4);
        assert_eq!(rc, expect, "{:?}", BStr::new(buf));
        if let Some(h) = &head {
            assert_eq!(h.len, buf.len(), "{:?}", BStr::new(buf));
        }
        head.map(|h| (h, headers))
    }

    fn hv(h: &Header) -> (&[u8], &[u8]) {
        (h.name(), h.value())
    }

    // Ported from picohttpparser test.c `test_response`.
    #[test]
    fn upstream_response_cases() {
        let (h, hd) = check(b"HTTP/1.0 200 OK\r\n\r\n", OK).unwrap();
        assert_eq!(hd.len(), 0);
        assert_eq!(h.status_code, 200);
        assert_eq!(h.minor_version, 0);
        assert_eq!(h.reason, b"OK");

        check(b"HTTP/1.0 200 OK\r\n\r", PARTIAL);

        let (h, hd) = check(
            b"HTTP/1.1 200 OK\r\nHost: example.com\r\nCookie: \r\n\r\n",
            OK,
        )
        .unwrap();
        assert_eq!(hd.len(), 2);
        assert_eq!(h.minor_version, 1);
        assert_eq!(h.status_code, 200);
        assert_eq!(h.reason, b"OK");
        assert_eq!(hv(&hd[0]), (&b"Host"[..], &b"example.com"[..]));
        assert_eq!(hv(&hd[1]), (&b"Cookie"[..], &b""[..]));

        // Upstream unfolds this into a third nameless header; we reject obs-fold.
        check(
            b"HTTP/1.0 200 OK\r\nfoo: \r\nfoo: b\r\n  \tc\r\n\r\n",
            INVALID,
        );

        let (h, _) = check(b"HTTP/1.0 500 Internal Server Error\r\n\r\n", OK).unwrap();
        assert_eq!(h.status_code, 500);
        assert_eq!(h.reason, b"Internal Server Error");

        check(b"H", PARTIAL);
        check(b"HTTP/1.", PARTIAL);
        check(b"HTTP/1.1", PARTIAL);
        check(b"HTTP/1.1 ", PARTIAL);
        check(b"HTTP/1.1 2", PARTIAL);
        check(b"HTTP/1.1 200", PARTIAL);
        check(b"HTTP/1.1 200 ", PARTIAL);
        check(b"HTTP/1.1 200 O", PARTIAL);
        check(b"HTTP/1.1 200 OK\r", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\n", PARTIAL);
        check(b"HTTP/1.1 200 OK\n", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA: 1\r", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA: 1\r\n", PARTIAL);

        check(b"HTTP/1. 200 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.2z 200 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.1  OK\r\n\r\n", INVALID);

        let (h, _) = check(b"HTTP/1.1 200\r\n\r\n", OK).unwrap();
        assert_eq!(h.reason, b"");
        check(b"HTTP/1.1 200X\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200X \r\n\r\n", INVALID);
        check(b"HTTP/1.1 200X OK\r\n\r\n", INVALID);

        let (_, hd) = check(b"HTTP/1.1 200 OK\r\nbar: \t b\t \t\r\n\r\n", OK).unwrap();
        assert_eq!(hv(&hd[0]), (&b"bar"[..], &b"b"[..]));

        let (h, _) = check(b"HTTP/1.1   200   OK\r\n\r\n", OK).unwrap();
        assert_eq!(h.status_code, 200);
        assert_eq!(h.reason, b"OK");
    }

    // Ported from the header-related cases of picohttpparser `test_request`.
    #[test]
    fn upstream_header_cases() {
        let (_, hd) = check(
            b"HTTP/1.1 200 OK\r\nHost: example.com\r\nUser-Agent: \xe3\x81\xb2\xe3/1.0\r\n\r\n",
            OK,
        )
        .unwrap();
        assert_eq!(
            hv(&hd[1]),
            (&b"User-Agent"[..], &b"\xe3\x81\xb2\xe3/1.0"[..])
        );

        check(b"HTTP/1.0 200 OK\r\nfoo : ab\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\n:a\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\n :a\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\na\0b: c\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\nab: c\0d\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\na\x1bb: c\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\nab: c\x1b\r\n\r\n", INVALID);
        check(b"HTTP/1.0 200 OK\r\n/: 1\r\n\r\n", INVALID);
        let (_, hd) = check(b"HTTP/1.0 200 OK\r\nh: c\xa2y\r\n\r\n", OK).unwrap();
        assert_eq!(hv(&hd[0]), (&b"h"[..], &b"c\xa2y"[..]));
        let (_, hd) = check(b"HTTP/1.0 200 OK\r\n\x7c\x7e: 1\r\n\r\n", OK).unwrap();
        assert_eq!(hv(&hd[0]), (&b"|~"[..], &b"1"[..]));
        check(b"HTTP/1.0 200 OK\r\n\x7b: 1\r\n\r\n", INVALID);
        let (_, hd) = check(b"HTTP/1.0 200 OK\r\nfoo: a \t \r\n\r\n", OK).unwrap();
        assert_eq!(hv(&hd[0]), (&b"foo"[..], &b"a"[..]));
    }

    #[test]
    fn status_line() {
        check(b"HTTP/2.0 200 OK\r\n\r\n", INVALID);
        check(b"http/1.1 200 OK\r\n\r\n", INVALID);
        check(b"ICY 200 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.1\t200 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.1 20 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.1 2000 OK\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200\tOK\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 O\x00K\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 O\x7fK\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\rX\r\n", INVALID);
        // Anything shorter than the fixed-width prefix is validated as far as it goes.
        check(b"X", INVALID);
        check(b"HTTP/1.X", INVALID);
        check(b"HTTP/1.1X", INVALID);
        check(b"HTTP/1.1 2X", INVALID);

        let (h, _) = check(b"HTTP/1.9 999 \r\n\r\n", OK).unwrap();
        assert_eq!(
            (h.minor_version, h.status_code, h.reason),
            (9, 999, &b""[..])
        );
        let (h, _) = check(b"HTTP/1.1 000 a \tb\x80 \r\n\r\n", OK).unwrap();
        assert_eq!((h.status_code, h.reason), (0, &b"a \tb\x80 "[..]));
        // Bare LF line endings are accepted throughout, as upstream did.
        let (h, hd) = check(b"HTTP/1.1 204\nA: 1\n\n", OK).unwrap();
        assert_eq!(h.status_code, 204);
        assert_eq!(hv(&hd[0]), (&b"A"[..], &b"1"[..]));
    }

    #[test]
    fn field_lines() {
        let (_, hd) = check(
            b"HTTP/1.1 200 OK\r\nA:1\r\nB:\t 2 \t\r\nC:\r\nD:   \r\n\r\n",
            OK,
        )
        .unwrap();
        assert_eq!(hd.len(), 4);
        assert_eq!(hv(&hd[0]), (&b"A"[..], &b"1"[..]));
        assert_eq!(hv(&hd[1]), (&b"B"[..], &b"2"[..]));
        assert_eq!(hv(&hd[2]), (&b"C"[..], &b""[..]));
        assert_eq!(hv(&hd[3]), (&b"D"[..], &b""[..]));

        // Interior whitespace and obs-text are preserved verbatim.
        let (_, hd) = check(b"HTTP/1.1 200 OK\r\nV: a  b\t c\xff\r\n\r\n", OK).unwrap();
        assert_eq!(hd[0].value(), b"a  b\t c\xff");

        // obs-fold after any header, with SP or HTAB.
        check(b"HTTP/1.1 200 OK\r\nA: 1\r\n B: 2\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\nA: 1\r\n\tB: 2\r\n\r\n", INVALID);
        // Leading whitespace on the first field line.
        check(b"HTTP/1.1 200 OK\r\n A: 1\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\n\tA: 1\r\n\r\n", INVALID);

        check(b"HTTP/1.1 200 OK\r\nA\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\nA B: 1\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\nA\xe9: 1\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\nA: 1\r2\r\n\r\n", INVALID);
        check(b"HTTP/1.1 200 OK\r\nA: 1\x0c\r\n\r\n", INVALID);

        check(b"HTTP/1.1 200 OK\r\nA", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA:", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA: ", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA: 1", PARTIAL);
        check(b"HTTP/1.1 200 OK\r\nA: 1\r\n\r", PARTIAL);
    }

    #[test]
    fn header_capacity() {
        let two = b"HTTP/1.1 200 OK\r\nA: 1\r\nB: 2\r\n\r\n";
        assert_eq!(parse(two, 2).0, OK);
        assert_eq!(parse(two, 1).0, INVALID);
        assert_eq!(parse(two, 0).0, INVALID);
        assert_eq!(parse(b"HTTP/1.1 200 OK\r\n\r\n", 0).0, OK);
        // Capacity is only checked once another field line actually starts.
        assert_eq!(parse(b"HTTP/1.1 200 OK\r\nA: 1\r\n", 1).0, PARTIAL);
        assert_eq!(parse(b"HTTP/1.1 200 OK\r\nA: 1\r\nB", 1).0, INVALID);
    }

    #[test]
    fn names_are_classified() {
        use crate::HeaderName;
        let buf = b"HTTP/1.1 200 OK\r\ncontent-LENGTH: 5\r\nX-Custom: 1\r\nSet-Cookie: a=b\r\n\r\n";
        let mut headers = [Header::ZERO; 4];
        let r = Response::parse(buf, &mut headers).unwrap();
        let tags: Vec<_> = r.headers.list.iter().map(Header::well_known).collect();
        assert_eq!(
            tags,
            [
                Some(HeaderName::ContentLength),
                None,
                Some(HeaderName::SetCookie)
            ]
        );
        assert_eq!(r.headers.find(HeaderName::SetCookie), Some(&b"a=b"[..]));
        assert_eq!(r.headers.find(HeaderName::ContentType), None);
        assert_eq!(Header::ZERO.well_known(), None);
    }

    #[test]
    fn consumed_length_stops_at_blank_line() {
        let buf = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloHTTP/1.1 ";
        let mut headers = [Header::ZERO; 4];
        let r = Response::parse(buf, &mut headers).unwrap();
        assert_eq!(&buf[r.bytes_read..], b"helloHTTP/1.1 ");
        assert_eq!(r.headers.list.len(), 1);
        assert_eq!(r.headers.list[0].value(), b"5");
    }

    #[test]
    fn swar_probe_matches_scalar() {
        // Every byte value at every offset within the two probed words, with
        // and without a preceding HTAB.
        let bytes: Vec<u8> = if cfg!(miri) {
            (0..=0x21).chain(0x7d..=0x82).chain([0xfe, 0xff]).collect()
        } else {
            (0..=255).collect()
        };
        for pos in 0..20 {
            for &b in &bytes {
                for lead in [b'a', b'\t'] {
                    let mut line = [b'x'; 24];
                    line[0] = lead;
                    line[pos.max(1)] = b;
                    let expect = line.iter().position(|&c| bun_highway::is_http_ctl(c));
                    assert_eq!(index_of_line_end(&line), expect, "{pos} {b:#x} {lead:#x}");
                }
            }
        }
        assert_eq!(index_of_line_end(b""), None);
        assert_eq!(index_of_line_end(b"\r"), Some(0));
        assert_eq!(index_of_line_end(b"\t\t\t\t\t\t\t\t\t\r"), Some(9));
    }

    #[test]
    fn long_values_cross_simd_width() {
        let mut buf = b"HTTP/1.1 200 OK\r\nX: ".to_vec();
        let value: Vec<u8> = (0..200u8).map(|i| b'a' + (i % 26)).collect();
        buf.extend_from_slice(&value);
        buf.extend_from_slice(b"\r\nY: \t");
        buf.extend_from_slice(&value);
        buf.extend_from_slice(b"\x7f\r\n\r\n");
        assert_eq!(parse(&buf, 4).0, INVALID);
        buf.truncate(buf.len() - 5);
        assert_eq!(parse(&buf, 4).0, PARTIAL);
        buf.extend_from_slice(b" \r\n\r\n");
        let (rc, _, hd) = parse(&buf, 4);
        assert_eq!(rc, OK);
        assert_eq!(hd[0].value(), &value[..]);
        assert_eq!(hd[1].value(), &value[..]);
    }

    /// Every proper prefix of a valid head is `Partial`, never `Invalid`, and
    /// never reads out of bounds; `may_be_complete` agrees at every split.
    #[test]
    fn every_prefix_is_partial() {
        let full = b"HTTP/1.1 301 Moved Permanently\r\nLocation: https://example.com/\r\nSet-Cookie: a=b; Path=/\r\nX-Empty:\r\nContent-Length: 0\r\n\r\n";
        for i in 0..full.len() {
            assert_eq!(parse(&full[..i], 8).0, PARTIAL, "prefix {i}");
            for seen in [0, i / 2, i.saturating_sub(3), i.saturating_sub(1)] {
                assert!(!Response::may_be_complete(&full[..i], seen), "{seen}..{i}");
            }
            assert!(Response::may_be_complete(full, i), "{i}..");
        }
        assert_eq!(parse(full, 8).0, OK);
    }

    #[test]
    fn may_be_complete() {
        for (buf, expect) in [
            (&b""[..], false),
            (b"\n", false),
            (b"\n\n", true),
            (b"\r\n\r\n", true),
            (b"\n\r\n", true),
            (b"\r\n\n", true),
            (b"a\nb\n", false),
            (b"a\r\n\r", false),
            (b"a\rb", true), // invalid: let `parse` say so
            (b"HTTP/1.1 200 OK\r\n\r\nbody", true),
            (b"HTTP/1.1 200 OK\n\nbody", true),
        ] {
            for seen in 0..=buf.len() {
                // Only meaningful when the seen prefix had no terminator itself.
                if seen >= 2 && Response::may_be_complete(&buf[..seen], 0) {
                    continue;
                }
                assert_eq!(
                    Response::may_be_complete(buf, seen),
                    expect,
                    "{:?} seen={seen}",
                    BStr::new(buf)
                );
            }
        }
    }
}
