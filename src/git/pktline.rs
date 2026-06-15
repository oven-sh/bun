//! pkt-line framing — `gitprotocol-common(5)`.
//!
//! Each line is a 4-byte lowercase-hex length prefix that **includes the
//! prefix itself**, followed by `len - 4` payload bytes. Three magic lengths
//! carry no payload:
//!
//! * `0000` — flush-pkt (section delimiter / end of request)
//! * `0001` — delim-pkt (protocol-v2 section separator)
//! * `0002` — response-end-pkt (protocol-v2 stateless-connect; unused here)
//!
//! The maximum payload is 65516 bytes (`0xfff0` total) per the spec; git
//! itself caps at 65520 (`LARGE_PACKET_MAX`). We accept up to `0xffff` on
//! read (the prefix can encode it, and rejecting would just be a DoS on
//! ourselves) and never emit above 65516.

use crate::{Error, Result};

pub(crate) const FLUSH: &[u8; 4] = b"0000";
pub(crate) const DELIM: &[u8; 4] = b"0001";
const MAX_DATA: usize = 65516;

/// One framed line. `Data` borrows the reader's internal buffer until the next
/// `read()` call.
#[derive(Debug)]
pub(crate) enum Pkt<'a> {
    Flush,
    Delim,
    ResponseEnd,
    Data(&'a [u8]),
}

/// pkt-line reader over an in-memory slice. Both v2 responses we parse with
/// this (`info/refs`, `ls-refs`) are small and already buffered; the large
/// `fetch` body is handled by [`crate::protocol::SidebandDemux`] instead.
pub(crate) struct PktReader<'a> {
    rest: &'a [u8],
}

impl<'a> PktReader<'a> {
    pub(crate) fn new(buf: &'a [u8]) -> Self {
        Self { rest: buf }
    }

    /// Read exactly one pkt-line. Missing bytes mean the server hung up
    /// mid-stream (every exchange is flush-terminated).
    pub(crate) fn read(&mut self) -> Result<Pkt<'a>> {
        let hdr: [u8; 4] = self
            .rest
            .get(..4)
            .ok_or(Error::PktLine("truncated header"))?
            .try_into()
            .unwrap();
        let len = parse_len(hdr)?;
        match len {
            0 => {
                self.rest = &self.rest[4..];
                Ok(Pkt::Flush)
            }
            1 => {
                self.rest = &self.rest[4..];
                Ok(Pkt::Delim)
            }
            2 => {
                self.rest = &self.rest[4..];
                Ok(Pkt::ResponseEnd)
            }
            3 => Err(Error::PktLine("reserved length 0003")),
            _ => {
                let payload = self
                    .rest
                    .get(4..len)
                    .ok_or(Error::PktLine("truncated payload"))?;
                self.rest = &self.rest[len..];
                Ok(Pkt::Data(payload))
            }
        }
    }

    /// Read one line, stripping a single trailing LF (the spec says the LF is
    /// optional and part of the framing, not the payload).
    pub(crate) fn read_text(&mut self) -> Result<Pkt<'a>> {
        match self.read()? {
            Pkt::Data(d) => Ok(Pkt::Data(d.strip_suffix(b"\n").unwrap_or(d))),
            other => Ok(other),
        }
    }
}

fn parse_len(hdr: [u8; 4]) -> Result<usize> {
    let mut n = 0usize;
    for b in hdr {
        let d = match b {
            b'0'..=b'9' => b - b'0',
            b'a'..=b'f' => b - b'a' + 10,
            // Spec says lowercase; git accepts uppercase, so we do too.
            b'A'..=b'F' => b - b'A' + 10,
            _ => return Err(Error::PktLine("non-hex length prefix")),
        };
        n = (n << 4) | usize::from(d);
    }
    Ok(n)
}

/// Builder for a pkt-line request body. Lines are accumulated into a `Vec`
/// (every request we send is small — capability advertisement, ls-refs, or a
/// fetch with a handful of `want`s).
#[derive(Default)]
pub(crate) struct PktWriter {
    out: Vec<u8>,
}

impl PktWriter {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Append one data line. A trailing LF is **not** added — callers include
    /// it where the protocol wants one (text commands) and omit it where it
    /// doesn't (binary side-band, though we never write that).
    pub(crate) fn data(&mut self, payload: &[u8]) -> &mut Self {
        assert!(
            payload.len() <= MAX_DATA,
            "pkt-line payload {} > {}",
            payload.len(),
            MAX_DATA
        );
        let len = payload.len() + 4;
        let hdr = [
            HEX[(len >> 12) & 0xf],
            HEX[(len >> 8) & 0xf],
            HEX[(len >> 4) & 0xf],
            HEX[len & 0xf],
        ];
        self.out.extend_from_slice(&hdr);
        self.out.extend_from_slice(payload);
        self
    }

    pub(crate) fn text(&mut self, s: &str) -> &mut Self {
        // Text lines in v2 carry a trailing LF.
        let mut buf = Vec::with_capacity(s.len() + 1);
        buf.extend_from_slice(s.as_bytes());
        buf.push(b'\n');
        self.data(&buf)
    }

    pub(crate) fn flush(&mut self) -> &mut Self {
        self.out.extend_from_slice(FLUSH);
        self
    }

    pub(crate) fn delim(&mut self) -> &mut Self {
        self.out.extend_from_slice(DELIM);
        self
    }

    pub(crate) fn finish(self) -> Vec<u8> {
        self.out
    }
}

const HEX: [u8; 16] = *b"0123456789abcdef";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_roundtrip() {
        let mut w = PktWriter::new();
        w.text("command=ls-refs");
        w.delim();
        w.data(b"peel");
        w.flush();
        let bytes = w.finish();
        assert_eq!(
            bytes,
            b"0014command=ls-refs\n00010008peel0000".as_slice(),
            "got {:?}",
            bstr::BStr::new(&bytes)
        );

        let mut r = PktReader::new(bytes.as_slice());
        match r.read_text().unwrap() {
            Pkt::Data(d) => assert_eq!(d, b"command=ls-refs"),
            other => panic!("{other:?}"),
        }
        assert!(matches!(r.read().unwrap(), Pkt::Delim));
        match r.read().unwrap() {
            Pkt::Data(d) => assert_eq!(d, b"peel"),
            other => panic!("{other:?}"),
        }
        assert!(matches!(r.read().unwrap(), Pkt::Flush));
    }

    #[test]
    fn rejects_garbage_prefix() {
        let mut r = PktReader::new(&b"zzzz"[..]);
        assert!(matches!(r.read(), Err(Error::PktLine(_))));
    }

    #[test]
    fn empty_data_line() {
        // "0004" = 4-byte header + 0 payload bytes. Legal per spec.
        let mut r = PktReader::new(&b"0004"[..]);
        match r.read().unwrap() {
            Pkt::Data(d) => assert!(d.is_empty()),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn truncated_payload_is_error() {
        let mut r = PktReader::new(&b"0010short"[..]);
        assert!(matches!(r.read(), Err(Error::PktLine(_))));
    }
}
