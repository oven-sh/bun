//! What `GetAddrInfoW` takes and returns.

use bun_core::WStr;

use super::{AF_INET, AF_INET6, wide};

/// `None` unless `text` is ASCII and not empty.
pub(crate) fn encode_name<'a>(text: &[u8], buf: &'a mut [u16]) -> Option<&'a WStr> {
    let name = wide::encode(text, buf).ok()?;
    // Every other character has more bytes than units.
    (!name.is_empty() && name.len() == text.len()).then_some(name)
}

/// The `sockaddr_in` or `sockaddr_in6` at the start of `address`.
pub(crate) fn ip_sockaddr(address: &[u8]) -> Option<&[u8]> {
    match u16::from_ne_bytes(*address.first_chunk()?) {
        AF_INET => address.get(..16),
        AF_INET6 => address.get(..28),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_ascii_names_that_fit() {
        let mut buf = [1; 256];
        let name = encode_name(b"A.b-c%1", &mut buf).unwrap();
        assert_eq!(name.as_slice(), b"A.b-c%1".map(u16::from));
        assert_eq!(encode_name(&[b'a'; 255], &mut buf).unwrap().len(), 255);

        for text in [
            &b""[..],
            b"\x80",
            "\u{FC}".as_bytes(),
            "\u{1F600}".as_bytes(),
        ] {
            assert!(encode_name(text, &mut buf).is_none());
        }
    }

    #[test]
    fn takes_whole_ip_addresses() {
        for (family, len) in [(2u16, Some(16)), (23, Some(28)), (0, None), (17, None)] {
            let mut address = [7; 32];
            address[..2].copy_from_slice(&family.to_ne_bytes());
            for given in 0..=address.len() {
                let expected = len.filter(|&len| len <= given).map(|len| &address[..len]);
                assert_eq!(ip_sockaddr(&address[..given]), expected);
            }
        }
    }
}
