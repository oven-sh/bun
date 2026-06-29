//! SHA-1 object identifiers.
//!
//! This crate implements the SHA-1 object format only (`OID_RAW_LEN == 20`).
//! SHA-256 repositories (`extensions.objectFormat = sha256`) are rejected by
//! the readers as `Unsupported`/`Corrupt`.

use core::fmt;

/// Raw length of a SHA-1 object id.
pub const OID_RAW_LEN: usize = 20;
/// Hexadecimal length of a SHA-1 object id.
pub const OID_HEX_LEN: usize = 40;

/// A binary SHA-1 object id.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Oid(pub [u8; OID_RAW_LEN]);

impl Oid {
    /// The all-zero id git uses as "no object" (e.g. unborn refs).
    pub const ZERO: Oid = Oid([0; OID_RAW_LEN]);

    /// `sha1("blob 0\0")` = `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`, the
    /// id of the empty blob (`hash.h:EMPTY_BLOB_SHA1_BIN_LITERAL` in git).
    pub const EMPTY_BLOB_SHA1: Oid = Oid([
        0xe6, 0x9d, 0xe2, 0x9b, 0xb2, 0xd1, 0xd6, 0x43, 0x4b, 0x8b, 0x29, 0xae, 0x77, 0x5a, 0xd8,
        0xc2, 0xe4, 0x8c, 0x53, 0x91,
    ]);

    /// Parse exactly 40 lowercase/uppercase hex digits. Any other length or a
    /// non-hex byte returns `None`.
    ///
    /// Decoded with the case-insensitive scalar fold rather than
    /// `bun_core::strings::decode_hex_to_bytes`: at 20 byte pairs that helper
    /// always takes its SIMD path, an FFI kernel a standalone
    /// `cargo test -p bun_git` binary does not link.
    pub fn from_hex(b: &[u8]) -> Option<Oid> {
        if b.len() != OID_HEX_LEN {
            return None;
        }
        let mut out = [0u8; OID_RAW_LEN];
        for (i, chunk) in b.chunks_exact(2).enumerate() {
            out[i] = (hex_val(chunk[0])? << 4) | hex_val(chunk[1])?;
        }
        Some(Oid(out))
    }

    /// Lowercase hexadecimal form.
    pub fn to_hex(&self) -> [u8; OID_HEX_LEN] {
        let mut out = [0u8; OID_HEX_LEN];
        bun_core::fmt::bytes_to_hex_lower(&self.0, &mut out);
        out
    }

    /// Test-only: production callers compare against [`Oid::ZERO`] directly.
    #[cfg(test)]
    pub(crate) fn is_zero(&self) -> bool {
        self.0 == [0; OID_RAW_LEN]
    }
}

#[inline]
fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

impl fmt::Display for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hex = self.to_hex();
        // The hex table emits only ASCII, so this is always valid UTF-8.
        f.write_str(core::str::from_utf8(&hex).unwrap_or("<oid>"))
    }
}

impl fmt::Debug for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Oid({self})")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trip() {
        let raw: [u8; 20] = [
            0x00, 0x01, 0x02, 0x7f, 0x80, 0xff, 0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
        ];
        let oid = Oid(raw);
        let hex = oid.to_hex();
        assert_eq!(
            &hex[..],
            b"0001027f80ff10325476 98badcfe112233445566"
                .iter()
                .copied()
                .filter(|b| *b != b' ')
                .collect::<Vec<u8>>()
                .as_slice()
        );
        assert_eq!(Oid::from_hex(&hex), Some(oid));
    }

    #[test]
    fn from_hex_accepts_uppercase() {
        let lower = Oid::from_hex(b"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef").unwrap();
        let upper = Oid::from_hex(b"DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF").unwrap();
        assert_eq!(lower, upper);
    }

    #[test]
    fn from_hex_rejects_bad_input() {
        assert_eq!(Oid::from_hex(b""), None);
        assert_eq!(Oid::from_hex(b"abcd"), None);
        // 39 chars
        assert_eq!(Oid::from_hex(&[b'a'; 39]), None);
        // 41 chars
        assert_eq!(Oid::from_hex(&[b'a'; 41]), None);
        // non-hex byte
        let mut bad = [b'a'; 40];
        bad[17] = b'g';
        assert_eq!(Oid::from_hex(&bad), None);
        bad[17] = 0;
        assert_eq!(Oid::from_hex(&bad), None);
    }

    #[test]
    fn zero_oid() {
        assert!(Oid::ZERO.is_zero());
        assert!(!Oid([1; 20]).is_zero());
        assert_eq!(&Oid::ZERO.to_hex()[..], [b'0'; 40]);
    }

    #[test]
    fn empty_blob_oid() {
        assert_eq!(
            Some(Oid::EMPTY_BLOB_SHA1),
            Oid::from_hex(b"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
        );
    }

    #[test]
    fn display_and_debug() {
        let oid = Oid::from_hex(b"0123456789abcdef0123456789abcdef01234567").unwrap();
        assert_eq!(format!("{oid}"), "0123456789abcdef0123456789abcdef01234567");
        assert_eq!(
            format!("{oid:?}"),
            "Oid(0123456789abcdef0123456789abcdef01234567)"
        );
    }
}
