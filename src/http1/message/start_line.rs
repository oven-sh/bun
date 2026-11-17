use bun_core::strings;

use super::method::{self, METHODS};
use super::{Cursor, Flags, Lenient, MessageParser, ParseError, State, Step, Stop, fail};
use crate::byte_sets::{AUTHORITY, CONTENT, LINE, TOKEN, VISIBLE};

/// What the next byte belongs to.
#[derive(Clone, Copy)]
pub(super) enum StartLinePart {
    MethodStart,
    Method,
    BeforeUrl,
    Scheme,
    FirstSlash,
    SecondSlash,
    Authority,
    AfterAt,
    PathAndQuery,
    UrlLf,
    AfterUrlLine,
    AfterUrl,
    BeforeProtocol,
    Protocol,
    VersionSlash,
    MajorVersion,
    VersionDot,
    MinorVersion,
    AfterVersion,
    Http2Preface,
    RequestLineCr,
    RequestLineLf,
    StatusCodeHundreds,
    StatusCodeTens,
    StatusCodeOnes,
    AfterStatusCode,
    StatusText,
    StatusLineLf,
}

impl MessageParser {
    #[inline(never)]
    pub(super) fn parse_start_line(&mut self, input: &[u8], mut part: StartLinePart) -> Step<()> {
        use StartLinePart::*;

        let mut cursor = Cursor::new(input, self.consumed);
        let mut step = self.parse_start_line_parts(&mut cursor, &mut part);
        if let (
            Err(Stop::Short),
            Scheme | FirstSlash | SecondSlash | Authority | AfterAt | PathAndQuery | StatusText,
        ) = (&step, part)
        {
            step = self.keep_text(&mut cursor, 0).and(step);
        }
        self.consumed = cursor.pos;
        self.state = State::StartLine(part);
        step
    }

    #[inline(always)]
    fn parse_start_line_parts(
        &mut self,
        cursor: &mut Cursor<'_>,
        part: &mut StartLinePart,
    ) -> Step<()> {
        use StartLinePart::*;

        run_parts!(match *part {
            MethodStart => {
                let rest = cursor.rest();
                let (name, rest) = rest.split_at(TOKEN.prefix_len(rest));
                if let (Some(&method), [b' ', ..]) = (METHODS.get(name), rest) {
                    self.method = method;
                    cursor.pos += name.len();
                    BeforeUrl
                } else {
                    self.word = &[];
                    Method
                }
            }
            Method => match (cursor.peek()?, METHODS.get(self.word)) {
                (b' ', Some(&method)) => {
                    self.method = method;
                    BeforeUrl
                }
                (byte, method) => {
                    self.word = match (method::extend_prefix(self.word, byte), method) {
                        (Some(prefix), _) => prefix,
                        (None, Some(_)) => return fail(ParseError::NoSpaceAfterMethod),
                        (None, None) => return fail(ParseError::Method),
                    };
                    cursor.bump();
                    Method
                }
            },
            BeforeUrl => {
                let byte = cursor.skip_while(|byte| byte == b' ')?;
                cursor.set_mark();
                match byte {
                    _ if self.method == method::CONNECT => Authority,
                    b'/' | b'*' => PathAndQuery,
                    b'A'..=b'Z' | b'a'..=b'z' => Scheme,
                    _ => return fail_in_url(cursor, byte, ParseError::UrlStartByte),
                }
            }
            Scheme => match cursor.skip_while(|byte| byte.is_ascii_alphabetic())? {
                b':' => {
                    cursor.bump();
                    FirstSlash
                }
                byte => return fail_in_url(cursor, byte, ParseError::SchemeByte),
            },
            FirstSlash => match cursor.peek()? {
                b'/' => {
                    cursor.bump();
                    SecondSlash
                }
                byte => return fail_in_url(cursor, byte, ParseError::SchemeByte),
            },
            SecondSlash => {
                expect(cursor, b'/', ParseError::SchemeByte)?;
                Authority
            }
            Authority => match cursor.skip(&AUTHORITY)? {
                b'/' | b'?' => PathAndQuery,
                b'@' => {
                    cursor.bump();
                    AfterAt
                }
                byte @ (b' ' | b'\r' | b'\n') => self.end_url(cursor, byte)?,
                byte => return fail_in_url(cursor, byte, ParseError::AuthorityByte),
            },
            AfterAt => match cursor.peek()? {
                b'@' => return cursor.fail_after(ParseError::DoubleAtInUrl),
                _ => Authority,
            },
            PathAndQuery => match cursor.skip(&VISIBLE)? {
                byte @ (b' ' | b'\r' | b'\n') => self.end_url(cursor, byte)?,
                byte => {
                    let error = self.error_after_authority(*cursor);
                    return fail_in_url(cursor, byte, error);
                }
            },
            UrlLf => {
                expect(cursor, b'\n', ParseError::NoCrlfAfterUrl)?;
                AfterUrlLine
            }
            AfterUrlLine => {
                refuse_tab_or_form_feed(cursor)?;
                (self.major_version, self.minor_version) = (0, 9);
                return Ok(());
            }
            AfterUrl => {
                refuse_tab_or_form_feed(cursor)?;
                BeforeProtocol
            }
            BeforeProtocol => {
                let byte = cursor.skip_while(|byte| byte == b' ' && self.is_request())?;
                if cursor.rest().starts_with(b"HTTP/1.1") && method::is_http1_method(self.method) {
                    cursor.pos += b"HTTP/1.1".len();
                    (self.major_version, self.minor_version) = (1, 1);
                    AfterVersion
                } else {
                    self.word = match byte {
                        b'H' => b"HTTP",
                        b'R' => b"RTSP",
                        b'I' => b"ICE",
                        _ => return fail(ParseError::Protocol),
                    };
                    self.protocol_initial = byte;
                    Protocol
                }
            }
            Protocol => {
                if !self.match_word(cursor, |byte| byte)? {
                    return fail(ParseError::Protocol);
                }
                if self.is_request() {
                    check_method(self.protocol_initial, self.method)?;
                }
                VersionSlash
            }
            VersionSlash => {
                expect(cursor, b'/', ParseError::Protocol)?;
                MajorVersion
            }
            MajorVersion => {
                self.major_version = expect_digit(cursor, ParseError::MajorVersion)?;
                VersionDot
            }
            VersionDot => {
                expect(cursor, b'.', ParseError::NoDotInVersion)?;
                MinorVersion
            }
            MinorVersion => {
                self.minor_version = expect_digit(cursor, ParseError::MinorVersion)?;
                if !matches!(self.version(), (0, 9) | (1, 0 | 1) | (2, 0)) {
                    self.tolerate(Lenient::VERSION, ParseError::Version)?;
                }
                AfterVersion
            }
            AfterVersion => {
                if !self.is_request() {
                    expect(cursor, b' ', ParseError::NoSpaceAfterVersion)?;
                    self.status_code = 0;
                    StatusCodeHundreds
                } else if self.method == method::PRI {
                    self.word = b"\r\n\r\nSM\r\n\r\n";
                    Http2Preface
                } else {
                    RequestLineCr
                }
            }
            Http2Preface => {
                return fail(if self.match_word(cursor, |byte| byte)? {
                    ParseError::Http2Preface
                } else {
                    ParseError::Http2PrefaceByte
                });
            }
            RequestLineCr => match cursor.peek()? {
                b'\r' => {
                    cursor.bump();
                    RequestLineLf
                }
                // It stands for the CR: https://github.com/nodejs/llhttp/blob/v9.4.4/src/llhttp/http.ts#L526-L532
                b'\n' => {
                    self.skip_lone_lf(cursor, ParseError::NoCrAfterVersion)?;
                    RequestLineLf
                }
                _ => return fail(ParseError::NoCrAfterVersion),
            },
            RequestLineLf => {
                let error = ParseError::NoLfAfterVersion;
                return self.expect_lf(cursor, Lenient::OPTIONAL_LF_AFTER_CR, error);
            }
            StatusCodeHundreds => {
                if cursor.peek()? == b'0' {
                    self.tolerate(Lenient::HEADERS, ParseError::StatusCode)?;
                }
                self.add_to_status_code(cursor)?;
                StatusCodeTens
            }
            StatusCodeTens => {
                self.add_to_status_code(cursor)?;
                StatusCodeOnes
            }
            StatusCodeOnes => {
                self.add_to_status_code(cursor)?;
                AfterStatusCode
            }
            AfterStatusCode => match cursor.peek()? {
                b' ' => {
                    cursor.bump();
                    cursor.set_mark();
                    StatusText
                }
                b'\r' => {
                    cursor.bump();
                    StatusLineLf
                }
                b'\n' => return self.skip_lone_lf(cursor, ParseError::StatusLineByte),
                _ => return fail(ParseError::StatusLineByte),
            },
            StatusText => match cursor.skip(&CONTENT)? {
                b'\r' => {
                    self.keep_text(cursor, 1)?;
                    StatusLineLf
                }
                b'\n' => {
                    self.keep_text(cursor, 1)?;
                    let error = ParseError::NoCrAfterStatusLine;
                    return self.tolerate(Lenient::OPTIONAL_CR_BEFORE_LF, error);
                }
                _ => {
                    if !self.allows(Lenient::HEADERS) {
                        self.flags |= Flags::MALFORMED_STATUS_TEXT;
                    }
                    cursor.skip(&LINE)?;
                    StatusText
                }
            },
            StatusLineLf => {
                let error = ParseError::NoLfAfterCr;
                return self.expect_lf(cursor, Lenient::OPTIONAL_LF_AFTER_CR, error);
            }
        })
    }

    /// Adds what is marked to the URL or the status text, then skips the `skipped` bytes that end it.
    #[inline(always)]
    fn keep_text(&mut self, cursor: &mut Cursor<'_>, skipped: usize) -> Step<()> {
        let marked = self.take_marked(cursor, skipped)?;
        self.texts.extend(cursor.input, marked);
        Ok(())
    }

    #[inline(always)]
    fn end_url(&mut self, cursor: &mut Cursor<'_>, byte: u8) -> Step<StartLinePart> {
        self.keep_text(cursor, 0)?;
        if byte == b'\n' {
            self.skip_lone_lf(cursor, ParseError::NoCrlfAfterUrl)?;
            return Ok(StartLinePart::AfterUrlLine);
        }
        cursor.bump();
        Ok(match byte {
            b' ' => StartLinePart::AfterUrl,
            _ => StartLinePart::UrlLf,
        })
    }

    #[inline(always)]
    fn add_to_status_code(&mut self, cursor: &mut Cursor<'_>) -> Step<()> {
        let digit = expect_digit(cursor, ParseError::StatusCode)?;
        self.status_code = self.status_code * 10 + u16::from(digit);
        Ok(())
    }

    #[cold]
    fn error_after_authority(&self, cursor: Cursor<'_>) -> ParseError {
        let earlier = self.texts.last(cursor.input);
        let marked = cursor.marked_bytes();
        let url_has =
            |byte| strings::contains_char(earlier, byte) || strings::contains_char(marked, byte);
        if url_has(b'#') {
            ParseError::FragmentByte
        } else if url_has(b'?') {
            ParseError::QueryByte
        } else {
            ParseError::PathByte
        }
    }
}

fn check_method(protocol_initial: u8, method: u8) -> Step<()> {
    use method::{DESCRIBE, FLUSH, GET, OPTIONS, POST, SOURCE};

    match (protocol_initial, method) {
        (b'H', DESCRIBE..=FLUSH) => fail(ParseError::MethodForHttp),
        (b'H', _) | (b'R', GET | POST | OPTIONS | DESCRIBE..=FLUSH) | (b'I', SOURCE) => Ok(()),
        (b'R', _) => fail(ParseError::MethodForRtsp),
        _ => fail(ParseError::MethodForIce),
    }
}

#[inline(always)]
fn expect(cursor: &mut Cursor<'_>, expected: u8, error: ParseError) -> Step<()> {
    if cursor.peek()? != expected {
        return fail(error);
    }
    cursor.bump();
    Ok(())
}

#[inline(always)]
fn expect_digit(cursor: &mut Cursor<'_>, error: ParseError) -> Step<u8> {
    let byte = cursor.peek()?;
    if !byte.is_ascii_digit() {
        return fail(error);
    }
    cursor.bump();
    Ok(byte - b'0')
}

#[inline(always)]
fn refuse_tab_or_form_feed(cursor: &mut Cursor<'_>) -> Step<()> {
    match cursor.peek()? {
        b'\t' | b'\x0c' => cursor.fail_after(ParseError::WhitespaceInUrl),
        _ => Ok(()),
    }
}

/// `error` is for what is not whitespace.
#[inline(always)]
fn fail_in_url<T>(cursor: &mut Cursor<'_>, byte: u8, error: ParseError) -> Step<T> {
    if byte.is_ascii_whitespace() {
        return cursor.fail_after(ParseError::WhitespaceInUrl);
    }
    fail(error)
}
