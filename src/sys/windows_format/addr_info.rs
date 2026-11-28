//! Arguments and results of `GetAddrInfoW`.

use bun_core::WStr;

use super::{AF_INET, AF_INET6, wtf16};

/// `None` unless `text` is non-empty ASCII and fits in `buf`.
pub(crate) fn encode_name<'a>(text: &[u8], buf: &'a mut [u16]) -> Option<&'a WStr> {
    let name = wtf16::encode(text, buf).ok()?;
    // A non-ASCII character takes more UTF-8 bytes than UTF-16 units.
    (!name.is_empty() && name.len() == text.len()).then_some(name)
}

/// The `sockaddr_in` or `sockaddr_in6` at the start of `address`.
pub(crate) fn extract_ip_sockaddr(address: &[u8]) -> Option<&[u8]> {
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
    fn encodes_only_non_empty_ascii_names() {
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
    fn extracts_only_complete_ip_sockaddrs() {
        for (family, len) in [(2u16, Some(16)), (23, Some(28)), (0, None), (17, None)] {
            let mut address = [7; 32];
            address[..2].copy_from_slice(&family.to_ne_bytes());
            for input_len in 0..=address.len() {
                let expected = len
                    .filter(|&len| len <= input_len)
                    .map(|len| &address[..len]);
                assert_eq!(extract_ip_sockaddr(&address[..input_len]), expected);
            }
        }
    }
}
