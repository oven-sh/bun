//! What `GetAddrInfoW` takes and returns.

use bun_core::WStr;
use bun_errno::uv;

use super::{AF_INET, AF_INET6, wide};

/// `None` unless `text` is ASCII and not empty.
pub(crate) fn encode_name<'a>(text: &[u8], buf: &'a mut [u16]) -> Option<&'a WStr> {
    let name = wide::encode(text, buf).ok()?;
    // Every other character has more bytes than units.
    (!name.is_empty() && name.len() == text.len()).then_some(name)
}

/// The `UV_EAI_*` code of a Winsock code that has one.
pub(crate) fn eai_code(wsa_code: i32) -> Option<i32> {
    Some(match wsa_code {
        8 => uv::UV_EAI_MEMORY,       // WSA_NOT_ENOUGH_MEMORY
        10022 => uv::UV_EAI_BADFLAGS, // WSAEINVAL
        10044 => uv::UV_EAI_SOCKTYPE, // WSAESOCKTNOSUPPORT
        10047 => uv::UV_EAI_FAMILY,   // WSAEAFNOSUPPORT
        10109 => uv::UV_EAI_SERVICE,  // WSATYPE_NOT_FOUND
        11001 => uv::UV_EAI_NONAME,   // WSAHOST_NOT_FOUND
        11002 => uv::UV_EAI_AGAIN,    // WSATRY_AGAIN
        11003 => uv::UV_EAI_FAIL,     // WSANO_RECOVERY
        _ => return None,
    })
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
    fn names_eight_codes() {
        let codes = (i32::from(i16::MIN)..=0x1_0000).chain([i32::MIN, i32::MAX]);
        let named = codes.filter_map(|code| Some((code, eai_code(code)?)));
        assert!(named.eq([
            (8, -3006),
            (10022, -3002),
            (10044, -3011),
            (10047, -3005),
            (10109, -3010),
            (11001, -3008),
            (11002, -3001),
            (11003, -3004),
        ]));
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
