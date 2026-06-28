//! Bounds-checked byte readers and the two git varint encodings.
//!
//! Every multi-byte integer read out of `.git/` goes through [`Reader`] so a
//! truncated or hostile file can never index out of bounds. The two varint
//! decoders implement, respectively:
//!
//! * the "offset encoding" (`varint.c:decode_varint` in git.git), used by
//!   `OFS_DELTA` base offsets and the index-v4 prefix-strip count
//!   (`Documentation/gitformat-pack.txt`, `Documentation/gitformat-index.txt`);
//! * the "size encoding" (`patch-delta.c:get_delta_hdr_size` in git.git), used
//!   by the two sizes at the head of a delta stream
//!   (`Documentation/gitformat-pack.txt`, "delta data" / "size encoding").
//!
//! They are NOT interchangeable: the offset encoding adds 1 on every
//! continuation byte and is big-endian-first; the size encoding is plain
//! little-endian base-128.

use crate::error::GitError;
use crate::oid::{OID_RAW_LEN, Oid};

/// A forward-only, bounds-checked cursor over a byte slice. `label` names the
/// structure being parsed and is used verbatim in `Corrupt` errors.
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    label: &'static str,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8], label: &'static str) -> Reader<'a> {
        Reader {
            data,
            pos: 0,
            label,
        }
    }

    #[inline]
    pub(crate) fn pos(&self) -> usize {
        self.pos
    }

    #[inline]
    pub(crate) fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.pos == self.data.len()
    }

    #[inline]
    pub(crate) fn rest(&self) -> &'a [u8] {
        &self.data[self.pos..]
    }

    #[inline]
    fn corrupt(&self) -> GitError {
        GitError::Corrupt(self.label)
    }

    pub(crate) fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], GitError> {
        if n > self.remaining() {
            return Err(self.corrupt());
        }
        let out = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }

    pub(crate) fn skip(&mut self, n: usize) -> Result<(), GitError> {
        if n > self.remaining() {
            return Err(self.corrupt());
        }
        self.pos += n;
        Ok(())
    }

    pub(crate) fn read_u8(&mut self) -> Result<u8, GitError> {
        let b = self.read_bytes(1)?;
        Ok(b[0])
    }

    pub(crate) fn read_be16(&mut self) -> Result<u16, GitError> {
        let b = self.read_bytes(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    pub(crate) fn read_be32(&mut self) -> Result<u32, GitError> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub(crate) fn read_oid(&mut self) -> Result<Oid, GitError> {
        let b = self.read_bytes(OID_RAW_LEN)?;
        let mut raw = [0u8; OID_RAW_LEN];
        raw.copy_from_slice(b);
        Ok(Oid(raw))
    }

    /// Bytes up to (excluding) the next NUL; the NUL itself is consumed.
    pub(crate) fn read_cstr(&mut self) -> Result<&'a [u8], GitError> {
        let rest = &self.data[self.pos..];
        let nul = memchr::memchr(0, rest).ok_or_else(|| self.corrupt())?;
        let out = &rest[..nul];
        self.pos += nul + 1;
        Ok(out)
    }

    /// git's "offset encoding" varint (`varint.c:decode_varint`). Errors on
    /// truncation and on values that would overflow `u64`.
    pub(crate) fn read_offset_varint(&mut self) -> Result<u64, GitError> {
        let mut c = self.read_u8()?;
        let mut value = u64::from(c & 0x7f);
        while c & 0x80 != 0 {
            // Mirrors git's overflow guard: `!val || val & (~0 << (64-7))`.
            value = value.checked_add(1).ok_or_else(|| self.corrupt())?;
            if value == 0 || (value & !(u64::MAX >> 7)) != 0 {
                return Err(self.corrupt());
            }
            c = self.read_u8()?;
            value = (value << 7) | u64::from(c & 0x7f);
        }
        Ok(value)
    }

    /// git's "size encoding" varint (`patch-delta.c:get_delta_hdr_size`).
    /// Bounded to the 10 bytes a `u64` can need; rejects set continuation
    /// bits past that and truncated input.
    pub(crate) fn read_size_varint(&mut self) -> Result<u64, GitError> {
        let mut value: u64 = 0;
        let mut shift: u32 = 0;
        loop {
            if shift >= 64 {
                return Err(self.corrupt());
            }
            let c = self.read_u8()?;
            let chunk = u64::from(c & 0x7f);
            if chunk != 0 && shift > chunk.leading_zeros() {
                return Err(self.corrupt());
            }
            value |= chunk << shift;
            if c & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
        }
    }
}

/// Convert an untrusted `u64` length to `usize`, refusing values that do not
/// fit (32-bit targets) so a later `as usize` can never truncate.
pub(crate) fn checked_usize(v: u64, what: &'static str) -> Result<usize, GitError> {
    usize::try_from(v).map_err(|_| GitError::TooLarge(what))
}

/// Render `value` as ASCII decimal into `buf` (20 bytes fit `u64::MAX`).
pub(crate) fn format_decimal(mut value: u64, buf: &mut [u8; 20]) -> &[u8] {
    let mut pos = buf.len();
    loop {
        pos -= 1;
        buf[pos] = b'0' + (value % 10) as u8;
        value /= 10;
        if value == 0 {
            return &buf[pos..];
        }
    }
}

/// Bounded ASCII decimal parser for sizes embedded in object headers.
/// Rejects empty input, non-digits, more than 20 digits, and overflow.
pub(crate) fn parse_decimal(s: &[u8]) -> Option<u64> {
    if s.is_empty() || s.len() > 20 {
        return None;
    }
    let mut value: u64 = 0;
    for &c in s {
        if !c.is_ascii_digit() {
            return None;
        }
        value = value.checked_mul(10)?.checked_add(u64::from(c - b'0'))?;
    }
    Some(value)
}

/// Strip trailing newline / carriage-return / spaces / tabs.
pub(crate) fn trim_line(mut line: &[u8]) -> &[u8] {
    while let Some((&last, rest)) = line.split_last() {
        if last == b'\n' || last == b'\r' || last == b' ' || last == b'\t' {
            line = rest;
        } else {
            break;
        }
    }
    line
}

/// `a + "/" + b`. `a` is taken without its trailing slash (except a lone
/// root); `b` must be relative.
pub(crate) fn join_path(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len() + b.len() + 1);
    out.extend_from_slice(a);
    while out.len() > 1 && out.last() == Some(&b'/') {
        out.pop();
    }
    if out.last() != Some(&b'/') {
        out.push(b'/');
    }
    out.extend_from_slice(b);
    out
}

/// Test-only encoders for the two varint formats, mirroring git's
/// `varint.c:encode_varint` and the inverse of `get_delta_hdr_size`. Used by
/// the index-v4, pack, and delta fixture builders.
#[cfg(test)]
pub(crate) mod test_encode {
    /// `varint.c:encode_varint` (offset encoding).
    pub(crate) fn offset_varint(mut value: u64) -> Vec<u8> {
        let mut buf = [0u8; 16];
        let mut pos = buf.len() - 1;
        buf[pos] = (value & 0x7f) as u8;
        loop {
            value >>= 7;
            if value == 0 {
                break;
            }
            value -= 1;
            pos -= 1;
            buf[pos] = 0x80 | (value & 0x7f) as u8;
        }
        buf[pos..].to_vec()
    }

    /// Little-endian base-128 "size encoding".
    pub(crate) fn size_varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let mut byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if value == 0 {
                return out;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_encode::{offset_varint, size_varint};
    use super::*;

    #[test]
    fn reader_basics() {
        let data = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09];
        let mut r = Reader::new(&data, "t");
        assert_eq!(r.read_u8().unwrap(), 0x01);
        assert_eq!(r.read_be16().unwrap(), 0x0203);
        assert_eq!(r.read_be32().unwrap(), 0x04050607);
        assert_eq!(r.remaining(), 2);
        assert_eq!(r.read_bytes(2).unwrap(), &[0x08, 0x09]);
        assert!(r.is_empty());
        assert!(r.read_u8().is_err());
        assert!(r.read_be16().is_err());
        assert!(r.read_be32().is_err());
        assert!(r.read_oid().is_err());
        assert!(r.read_bytes(1).is_err());
        assert!(r.skip(1).is_err());
        // Reads past the end must not have advanced the cursor.
        assert_eq!(r.pos(), data.len());
    }

    #[test]
    fn reader_oid() {
        let mut data = vec![0x42; 20];
        data.extend_from_slice(b"rest");
        let mut r = Reader::new(&data, "t");
        assert_eq!(r.read_oid().unwrap(), Oid([0x42; 20]));
        assert_eq!(r.rest(), b"rest");
    }

    #[test]
    fn reader_cstr() {
        let data = b"abc\0def";
        let mut r = Reader::new(data, "t");
        assert_eq!(r.read_cstr().unwrap(), b"abc");
        assert_eq!(r.rest(), b"def");
        // No NUL left.
        assert!(r.read_cstr().is_err());
        let mut r = Reader::new(b"\0", "t");
        assert_eq!(r.read_cstr().unwrap(), b"");
        assert!(r.is_empty());
    }

    /// Round-trip the offset encoding over a representative value set
    /// including every byte-length boundary.
    #[test]
    fn offset_varint_round_trip() {
        let mut values: Vec<u64> = vec![0, 1, 0x7e, 0x7f, 0x80, 0xff, 0x100, 0x407f, 0x4080];
        for shift in 0..63 {
            values.push(1u64 << shift);
            values.push((1u64 << shift) - 1);
            values.push((1u64 << shift) + 1);
        }
        values.push(u64::MAX);
        for &v in &values {
            let enc = offset_varint(v);
            let mut r = Reader::new(&enc, "t");
            assert_eq!(r.read_offset_varint().unwrap(), v, "value {v:#x}");
            assert!(r.is_empty(), "value {v:#x} left trailing bytes");
        }
    }

    /// The offset encoding is not the size encoding: the two-byte sequence
    /// `[0x80, 0x00]` decodes to 128 (`(0+1)<<7 | 0`) in the offset encoding.
    #[test]
    fn offset_varint_known_vectors() {
        let cases: &[(&[u8], u64)] = &[
            (&[0x00], 0),
            (&[0x7f], 127),
            (&[0x80, 0x00], 128),
            (&[0x80, 0x7f], 255),
            (&[0x81, 0x00], 256),
            (&[0xfe, 0x7f], 16383),
            (&[0xff, 0x7f], 16511),
            (&[0x80, 0x80, 0x00], 16512),
        ];
        for (bytes, expected) in cases {
            let mut r = Reader::new(bytes, "t");
            assert_eq!(r.read_offset_varint().unwrap(), *expected, "{bytes:?}");
        }
    }

    #[test]
    fn offset_varint_truncated_and_overflow() {
        // Continuation bit set, no following byte.
        let mut r = Reader::new(&[0x80], "t");
        assert!(r.read_offset_varint().is_err());
        // 11 continuation bytes overflow a u64.
        let bomb = [0xff; 16];
        let mut r = Reader::new(&bomb, "t");
        assert!(r.read_offset_varint().is_err());
        // Empty input.
        let mut r = Reader::new(&[], "t");
        assert!(r.read_offset_varint().is_err());
    }

    #[test]
    fn size_varint_round_trip() {
        let mut values: Vec<u64> = vec![0, 1, 0x7f, 0x80, 0x3fff, 0x4000];
        for shift in 0..63 {
            values.push(1u64 << shift);
            values.push((1u64 << shift) - 1);
        }
        values.push(u64::MAX);
        for &v in &values {
            let enc = size_varint(v);
            let mut r = Reader::new(&enc, "t");
            assert_eq!(r.read_size_varint().unwrap(), v, "value {v:#x}");
            assert!(r.is_empty());
        }
    }

    /// The size encoding is little-endian base-128: `[0x80, 0x01]` is 128.
    #[test]
    fn size_varint_known_vectors() {
        let cases: &[(&[u8], u64)] = &[
            (&[0x00], 0),
            (&[0x7f], 127),
            (&[0x80, 0x01], 128),
            (&[0xff, 0x01], 255),
            (&[0x80, 0x02], 256),
            (&[0xff, 0x7f], 16383),
        ];
        for (bytes, expected) in cases {
            let mut r = Reader::new(bytes, "t");
            assert_eq!(r.read_size_varint().unwrap(), *expected, "{bytes:?}");
        }
    }

    #[test]
    fn the_two_varint_encodings_differ() {
        // 128 encodes differently in each scheme; decoding one with the
        // other's decoder must not agree.
        assert_eq!(offset_varint(128), vec![0x80, 0x00]);
        assert_eq!(size_varint(128), vec![0x80, 0x01]);
        let enc = size_varint(128);
        let mut r = Reader::new(&enc, "t");
        assert_eq!(r.read_offset_varint().unwrap(), 129);
    }

    #[test]
    fn size_varint_truncated_and_overflow() {
        let mut r = Reader::new(&[0x80], "t");
        assert!(r.read_size_varint().is_err());
        let bomb = [0xff; 16];
        let mut r = Reader::new(&bomb, "t");
        assert!(r.read_size_varint().is_err());
        // A 10th byte whose payload would shift past bit 63.
        let mut bytes = vec![0x80u8; 9];
        bytes.push(0x02);
        let mut r = Reader::new(&bytes, "t");
        assert!(r.read_size_varint().is_err());
        // u64::MAX itself must decode (10 bytes, top byte 0x01).
        let enc = size_varint(u64::MAX);
        assert_eq!(enc.len(), 10);
        let mut r = Reader::new(&enc, "t");
        assert_eq!(r.read_size_varint().unwrap(), u64::MAX);
    }

    #[test]
    fn format_decimal_values() {
        let cases: &[(u64, &[u8])] = &[
            (0, b"0"),
            (1, b"1"),
            (9, b"9"),
            (10, b"10"),
            (1234567890, b"1234567890"),
            (u64::MAX, b"18446744073709551615"),
        ];
        let mut buf = [0u8; 20];
        for (value, expected) in cases {
            assert_eq!(format_decimal(*value, &mut buf), *expected);
        }
    }

    #[test]
    fn parse_decimal_values() {
        assert_eq!(parse_decimal(b"0"), Some(0));
        assert_eq!(parse_decimal(b"00012"), Some(12));
        assert_eq!(parse_decimal(b"18446744073709551615"), Some(u64::MAX));
        assert_eq!(parse_decimal(b"18446744073709551616"), None);
        assert_eq!(parse_decimal(b""), None);
        assert_eq!(parse_decimal(b"-1"), None);
        assert_eq!(parse_decimal(b"+1"), None);
        assert_eq!(parse_decimal(b"1x"), None);
        assert_eq!(parse_decimal(b"111111111111111111111"), None);
    }

    #[test]
    fn format_then_parse_round_trips() {
        let mut buf = [0u8; 20];
        for v in [0u64, 1, 7, 4096, u64::from(u32::MAX), u64::MAX] {
            assert_eq!(parse_decimal(format_decimal(v, &mut buf)), Some(v));
        }
    }

    #[test]
    fn join_path_shapes() {
        assert_eq!(join_path(b"/a", b"b"), b"/a/b");
        assert_eq!(join_path(b"/a/", b"b"), b"/a/b");
        assert_eq!(join_path(b"/a//", b"b/c"), b"/a/b/c");
        assert_eq!(join_path(b"/", b"x"), b"/x");
        assert_eq!(join_path(b"", b"x"), b"/x");
    }

    #[test]
    fn checked_usize_bounds() {
        assert_eq!(checked_usize(0, "x").unwrap(), 0);
        assert_eq!(checked_usize(1234, "x").unwrap(), 1234);
        #[cfg(target_pointer_width = "64")]
        assert!(checked_usize(u64::MAX, "x").is_ok());
    }
}
