//! Incremental, in-place `Transfer-Encoding: chunked` decoder (RFC 9112 §7.1).
//!
//! The state machine is derived from picohttpparser's `phr_decode_chunked`
//! (Copyright (c) 2009-2014 Kazuho Oku, Tokuhiro Matsuno, Daisuke Murase,
//! Shigeo Mitsunari; MIT licensed).

use bun_core::fmt::hex_digit_value;
use bun_core::strings;

/// Feed successive buffers to [`ChunkedDecoder::decode`]; each call strips the
/// chunk framing in place and reports how many body bytes are now at the front
/// of that buffer. The trailer section is consumed and discarded.
#[derive(Clone, Copy, Default)]
pub struct ChunkedDecoder {
    bytes_left_in_chunk: usize,
    hex_count: u8,
    state: State,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
enum State {
    #[default]
    Size,
    Ext,
    SizeLf,
    Data,
    DataCr,
    DataLf,
    TrailerLineHead,
    TrailerLineMiddle,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct ChunkedEncodingError;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Decoded {
    /// Body bytes now at `buf[..written]`.
    pub written: usize,
    /// The last chunk and trailer section were consumed. Any bytes that
    /// followed the message are dropped; otherwise all of `buf` was consumed.
    pub complete: bool,
}

/// `chunk-size` digits accepted before the value could overflow `usize`.
const MAX_HEX_DIGITS: u8 = (usize::BITS / 4) as u8;

impl ChunkedDecoder {
    /// True once the terminating zero-length chunk has been seen and only the
    /// (discarded) trailer section remains, i.e. the body itself is complete.
    #[inline]
    pub fn is_in_trailers(&self) -> bool {
        matches!(
            self.state,
            State::TrailerLineHead | State::TrailerLineMiddle
        )
    }

    pub fn decode(&mut self, buf: &mut [u8]) -> Result<Decoded, ChunkedEncodingError> {
        let len = buf.len();
        let mut src = 0usize;
        let mut dst = 0usize;
        // Locals so the loop state stays in registers across the per-chunk
        // memmove; the `if st == ..` chain (rather than a `match` per
        // transition) lets consecutive states fall straight through.
        let Self {
            mut bytes_left_in_chunk,
            mut hex_count,
            state: mut st,
        } = *self;

        let complete = 'run: loop {
            if st == State::Size {
                loop {
                    let Some(&c) = buf.get(src) else {
                        break 'run Ok(false);
                    };
                    match hex_digit_value(c) {
                        Some(v) => {
                            if hex_count == MAX_HEX_DIGITS {
                                break 'run Err(ChunkedEncodingError);
                            }
                            bytes_left_in_chunk = bytes_left_in_chunk * 16 + v as usize;
                            hex_count += 1;
                            src += 1;
                        }
                        None => {
                            if hex_count == 0 || !matches!(c, b' ' | b'\t' | b';' | b'\r' | b'\n') {
                                break 'run Err(ChunkedEncodingError);
                            }
                            break;
                        }
                    }
                }
                hex_count = 0;
                st = State::Ext;
            }
            // BWS / chunk-ext up to the CR. A bare LF is rejected (RFC 9112 §2.2).
            if st == State::Ext {
                let cr = match buf.get(src) {
                    None => break 'run Ok(false),
                    Some(b'\r') => 0,
                    Some(_) => match strings::index_of_any(&buf[src..], b"\r\n") {
                        None => {
                            src = len;
                            break 'run Ok(false);
                        }
                        Some(i) if buf[src + i] == b'\r' => i,
                        Some(_) => break 'run Err(ChunkedEncodingError),
                    },
                };
                src += cr + 1;
                st = State::SizeLf;
            }
            if st == State::SizeLf {
                let Some(&c) = buf.get(src) else {
                    break 'run Ok(false);
                };
                if c != b'\n' {
                    break 'run Err(ChunkedEncodingError);
                }
                src += 1;
                st = if bytes_left_in_chunk == 0 {
                    State::TrailerLineHead
                } else {
                    State::Data
                };
            }
            if st == State::Data {
                let avail = len - src;
                if avail < bytes_left_in_chunk {
                    buf.copy_within(src..len, dst);
                    dst += avail;
                    src = len;
                    bytes_left_in_chunk -= avail;
                    break 'run Ok(false);
                }
                let n = bytes_left_in_chunk;
                buf.copy_within(src..src + n, dst);
                dst += n;
                src += n;
                bytes_left_in_chunk = 0;
                st = State::DataCr;
            }
            if st == State::DataCr {
                let Some(&c) = buf.get(src) else {
                    break 'run Ok(false);
                };
                if c != b'\r' {
                    break 'run Err(ChunkedEncodingError);
                }
                src += 1;
                st = State::DataLf;
            }
            if st == State::DataLf {
                let Some(&c) = buf.get(src) else {
                    break 'run Ok(false);
                };
                if c != b'\n' {
                    break 'run Err(ChunkedEncodingError);
                }
                src += 1;
                st = State::Size;
                continue;
            }
            // Trailer fields are discarded, so they are only scanned for the
            // blank line that ends them; a bare LF is tolerated here.
            if st == State::TrailerLineHead {
                while buf.get(src) == Some(&b'\r') {
                    src += 1;
                }
                let Some(&c) = buf.get(src) else {
                    break 'run Ok(false);
                };
                src += 1;
                if c == b'\n' {
                    break 'run Ok(true);
                }
                st = State::TrailerLineMiddle;
            }
            debug_assert_eq!(st, State::TrailerLineMiddle);
            match strings::index_of_char_usize(&buf[src..], b'\n') {
                None => {
                    src = len;
                    break 'run Ok(false);
                }
                Some(i) => {
                    src += i + 1;
                    st = State::TrailerLineHead;
                }
            }
        };
        *self = Self {
            bytes_left_in_chunk,
            hex_count,
            state: st,
        };

        let complete = complete?;
        debug_assert!(complete || src == len);
        Ok(Decoded {
            written: dst,
            complete,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INCOMPLETE: Result<Decoded, ChunkedEncodingError> = Ok(Decoded {
        written: 0,
        complete: false,
    });
    fn incomplete(written: usize) -> Result<Decoded, ChunkedEncodingError> {
        Ok(Decoded {
            written,
            complete: false,
        })
    }
    fn complete(written: usize) -> Result<Decoded, ChunkedEncodingError> {
        Ok(Decoded {
            written,
            complete: true,
        })
    }

    /// (wire bytes, body, bytes left over after the message)
    const COMPLETE_CASES: &[(&str, &str, usize)] = &[
        ("b\r\nhello world\r\n0\r\n\r\n", "hello world", 0),
        ("6\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n", "hello world", 0),
        (
            "6;comment=hi\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n",
            "hello world",
            0,
        ),
        (
            "6 ; comment\r\nhello \r\n5\r\nworld\r\n0\r\n\r\n",
            "hello world",
            0,
        ),
        (
            "6\r\nhello \r\n5\r\nworld\r\n0\r\na: b\r\nc: d\r\n\r\n",
            "hello world",
            0,
        ),
        ("B\r\nhello world\r\n0\r\n\r\n", "hello world", 0),
        ("b\r\nhello world\r\n0\r\n\n", "hello world", 0),
        (
            "6\r\nhello \r\n5\r\nworld\r\n0\r\na: b\nc: d\n\n",
            "hello world",
            0,
        ),
        ("b\t\r\nhello world\r\n000\r\n\r\n", "hello world", 0),
        ("5\r\nabcde\r\n0\r\n\r\nGET / HTTP/1.1\r\n\r\n", "abcde", 18),
        ("0\r\n\r\n", "", 0),
        ("0;ext\r\nTrailer: x\r\n\r\nnext", "", 4),
    ];

    const INCOMPLETE_CASES: &[(&str, &str)] = &[
        ("b\r\nhello world\r\n0\r\n", "hello world"),
        ("6\r\nhello \r\n5\r\nworld\r\n0\r\n", "hello world"),
        (
            "6;comment=hi\r\nhello \r\n5\r\nworld\r\n0\r\n",
            "hello world",
        ),
        (
            "6\r\nhello \r\nffffffffffffffff\r\nabcdefg",
            "hello abcdefg",
        ),
        ("6\r\nhel", "hel"),
        ("6\r\nhello \r", "hello "),
        ("6\r\nhello \r\n5", "hello "),
        ("10", ""),
    ];

    const INVALID_CASES: &[&str] = &[
        "z\r\nabcdefg",
        "6\r\nhello \r\nfffffffffffffffff\r\nabcdefg",
        "1x\r\na\r\n0\r\n",
        "6\nhello \r\n5\r\nworld\r\n0\r\n",
        "6\r\nhello \n5\r\nworld\r\n0\r\n",
        "6\r\nhello \r\n5\r\nworld\n0\r\n",
        "6\r\nhello \r\n5\r\nworld\r\n0\n",
        "6\rX\nhello \n5\r\nworld\r\n0\r\n",
        "6\r\nhello \r\r\n0\r\n\r\n",
        "\r\n6\r\nhello \r\n0\r\n\r\n",
        " 6\r\nhello \r\n0\r\n\r\n",
        "6\r\nhello X\r\n0\r\n\r\n",
        "6\r\nhello \rX0\r\n\r\n",
        "-1\r\n",
        "0x6\r\nhello \r\n0\r\n\r\n",
    ];

    fn at_once(encoded: &str) -> (Result<Decoded, ChunkedEncodingError>, Vec<u8>) {
        let mut buf = encoded.as_bytes().to_vec();
        let r = ChunkedDecoder::default().decode(&mut buf);
        (r, buf)
    }

    /// Feeds `encoded` one byte at a time until `stop_early` bytes remain,
    /// then the rest in one call. Returns the last result and the body so far.
    fn per_byte(
        encoded: &str,
        stop_early: usize,
    ) -> (Result<Decoded, ChunkedEncodingError>, Vec<u8>) {
        let bytes = encoded.as_bytes();
        let mut dec = ChunkedDecoder::default();
        let mut out = Vec::new();
        let split = bytes.len() - stop_early;
        for i in 0..split.saturating_sub(1) {
            let mut b = [bytes[i]];
            let r = dec.decode(&mut b);
            match r {
                Ok(Decoded {
                    written,
                    complete: false,
                }) => out.extend_from_slice(&b[..written]),
                _ => return (r, out),
            }
        }
        let mut tail = bytes[split.saturating_sub(1)..].to_vec();
        let r = dec.decode(&mut tail);
        if let Ok(d) = r {
            out.extend_from_slice(&tail[..d.written]);
        }
        (r, out)
    }

    #[test]
    fn complete_messages() {
        for &(encoded, body, left_over) in COMPLETE_CASES {
            let (r, buf) = at_once(encoded);
            assert_eq!(r, complete(body.len()), "{encoded:?}");
            assert_eq!(&buf[..body.len()], body.as_bytes(), "{encoded:?}");

            let (r, out) = per_byte(encoded, left_over);
            assert!(
                matches!(r, Ok(Decoded { complete: true, .. })),
                "{encoded:?}: {r:?}"
            );
            assert_eq!(out, body.as_bytes(), "{encoded:?}");
        }
    }

    #[test]
    fn incomplete_messages() {
        for &(encoded, body) in INCOMPLETE_CASES {
            let (r, buf) = at_once(encoded);
            assert_eq!(r, incomplete(body.len()), "{encoded:?}");
            assert_eq!(&buf[..body.len()], body.as_bytes(), "{encoded:?}");

            let (r, out) = per_byte(encoded, 0);
            assert!(
                matches!(
                    r,
                    Ok(Decoded {
                        complete: false,
                        ..
                    })
                ),
                "{encoded:?}: {r:?}"
            );
            assert_eq!(out, body.as_bytes(), "{encoded:?}");
        }
    }

    #[test]
    fn invalid_messages() {
        for &encoded in INVALID_CASES {
            assert_eq!(
                at_once(encoded).0,
                Err(ChunkedEncodingError),
                "at once: {encoded:?}"
            );
            assert_eq!(
                per_byte(encoded, 0).0,
                Err(ChunkedEncodingError),
                "per byte: {encoded:?}"
            );
        }
    }

    #[test]
    fn is_in_trailers() {
        let mut dec = ChunkedDecoder::default();
        let mut buf = b"5\r\nab".to_vec();
        assert_eq!(dec.decode(&mut buf), incomplete(2));
        assert!(!dec.is_in_trailers());
        let mut buf = b"cde\r\n0\r\n".to_vec();
        assert_eq!(dec.decode(&mut buf), incomplete(3));
        assert!(dec.is_in_trailers());
        let mut buf = b"X-Trailer: 1\r".to_vec();
        assert_eq!(dec.decode(&mut buf), INCOMPLETE);
        assert!(dec.is_in_trailers());
        let mut buf = b"\n\r\nNEXT".to_vec();
        assert_eq!(dec.decode(&mut buf), complete(0));
    }

    #[test]
    fn resumes_across_every_split_point() {
        let encoded = b"3;x=y\r\nabc\r\n1A\r\nabcdefghijklmnopqrstuvwxyz\r\n0\r\nT: v\r\n\r\n";
        let expected = b"abcabcdefghijklmnopqrstuvwxyz";
        for split in 0..=encoded.len() {
            let mut dec = ChunkedDecoder::default();
            let mut a = encoded[..split].to_vec();
            let mut b = encoded[split..].to_vec();
            let first = dec
                .decode(&mut a)
                .unwrap_or_else(|e| panic!("split {split}: {e:?}"));
            let mut out = a[..first.written].to_vec();
            assert_eq!(first.complete, split == encoded.len(), "split {split}");
            if !first.complete {
                let second = dec
                    .decode(&mut b)
                    .unwrap_or_else(|e| panic!("split {split}: {e:?}"));
                assert!(second.complete, "split {split}");
                out.extend_from_slice(&b[..second.written]);
            }
            assert_eq!(out, expected, "split {split}");
        }
    }

    #[test]
    fn max_chunk_size_digits() {
        let ok = format!("{}\r\n", "f".repeat(MAX_HEX_DIGITS as usize));
        assert_eq!(at_once(&ok).0, INCOMPLETE);
        let overflow = format!("{}\r\n", "1".repeat(MAX_HEX_DIGITS as usize + 1));
        assert_eq!(at_once(&overflow).0, Err(ChunkedEncodingError));
        let leading_zeros = format!("{}1\r\nX\r\n0\r\n\r\n", "0".repeat(MAX_HEX_DIGITS as usize));
        assert_eq!(at_once(&leading_zeros).0, Err(ChunkedEncodingError));
    }

    /// Framing-heavy but well-formed streams (1-byte chunks) are not an error;
    /// unlike a server, a client gains nothing from an overhead heuristic.
    #[test]
    fn tiny_chunks_in_bulk() {
        let mut dec = ChunkedDecoder::default();
        let rounds = if cfg!(miri) { 4 } else { 64 };
        for _ in 0..rounds {
            let mut buf = b"1\r\nx\r\n".repeat(512);
            assert_eq!(dec.decode(&mut buf), incomplete(512));
            assert_eq!(&buf[..512], &[b'x'; 512]);
        }
        let mut end = b"0\r\n\r\n".to_vec();
        assert_eq!(dec.decode(&mut end), complete(0));
    }
}
