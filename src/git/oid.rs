use core::fmt;

/// A 20-byte SHA-1 git object id. Ordering is bytewise (matches the sort order
/// of the pack-index name table and `git rev-list --objects`).
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Oid(pub [u8; 20]);

impl Oid {
    pub const ZERO: Oid = Oid([0u8; 20]);

    /// Parse 40 lowercase hex bytes. Uppercase is accepted (git itself emits
    /// lowercase, but ref advertisements from non-git servers occasionally
    /// uppercase).
    pub fn from_hex(s: &[u8]) -> Option<Oid> {
        if s.len() != 40 {
            return None;
        }
        let mut out = [0u8; 20];
        for (i, pair) in s.chunks_exact(2).enumerate() {
            out[i] = (nibble(pair[0])? << 4) | nibble(pair[1])?;
        }
        Some(Oid(out))
    }

    pub fn to_hex(&self) -> [u8; 40] {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut out = [0u8; 40];
        for (i, b) in self.0.iter().enumerate() {
            out[i * 2] = HEX[(b >> 4) as usize];
            out[i * 2 + 1] = HEX[(b & 0xf) as usize];
        }
        out
    }
}

#[inline]
fn nibble(c: u8) -> Option<u8> {
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
        // SAFETY: to_hex() emits only [0-9a-f], which is ASCII and thus valid UTF-8.
        f.write_str(unsafe { core::str::from_utf8_unchecked(&hex) })
    }
}

impl fmt::Debug for Oid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trip() {
        let s = b"e83c5163316f89bfbde7d9ab23ca2e25604af290";
        let oid = Oid::from_hex(s).unwrap();
        assert_eq!(&oid.to_hex(), s);
        assert_eq!(format!("{oid}").as_bytes(), s);
    }

    #[test]
    fn rejects_bad_hex() {
        assert!(Oid::from_hex(b"").is_none());
        assert!(Oid::from_hex(b"zz3c5163316f89bfbde7d9ab23ca2e25604af290").is_none());
        assert!(Oid::from_hex(b"e83c5163316f89bfbde7d9ab23ca2e25604af29").is_none());
        assert!(Oid::from_hex(b"e83c5163316f89bfbde7d9ab23ca2e25604af2900").is_none());
    }

    #[test]
    fn accepts_uppercase() {
        let lo = Oid::from_hex(b"e83c5163316f89bfbde7d9ab23ca2e25604af290").unwrap();
        let up = Oid::from_hex(b"E83C5163316F89BFBDE7D9AB23CA2E25604AF290").unwrap();
        assert_eq!(lo, up);
    }

    #[test]
    fn ordering_is_bytewise() {
        let a = Oid::from_hex(b"00000000000000000000000000000000000000ff").unwrap();
        let b = Oid::from_hex(b"0100000000000000000000000000000000000000").unwrap();
        assert!(a < b);
    }
}
