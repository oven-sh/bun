//! The opening handshake.

use bun_core::strings;

use crate::deflate::Params;

/// Of Sec-WebSocket-Accept (RFC 6455 §4.2.2).
pub fn compute_accept_value(key: &[u8]) -> [u8; 28] {
    use bun_sha_hmac::sha::hashers::SHA1;
    const WEBSOCKET_GUID: &[u8] = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut hasher = SHA1::init();
    hasher.update(key);
    hasher.update(WEBSOCKET_GUID);
    let mut hash = [0u8; SHA1::DIGEST];
    hasher.r#final(&mut hash);
    let mut result = [0u8; 28];
    let _ = bun_base64::encode(&mut result, &hash);
    result
}

pub fn parse_window_bits(value: &[u8]) -> Option<u8> {
    let digits = value
        .strip_prefix(b"\"")
        .and_then(|v| v.strip_suffix(b"\""))
        .unwrap_or(value);
    let bits = match *digits {
        [d @ b'0'..=b'9'] => d - b'0',
        [b'1', d @ b'0'..=b'9'] => 10 + (d - b'0'),
        _ => return None,
    };
    (Params::MIN_WINDOW_BITS..=Params::MAX_WINDOW_BITS)
        .contains(&bits)
        .then_some(bits)
}

/// Safari 15.0 to 15.3: https://github.com/uNetworking/uWebSockets/issues/1347
pub fn has_broken_compression(user_agent: &[u8]) -> bool {
    let Some((_, rest)) = strings::split_once(user_agent, b" Version/15.") else {
        return false;
    };
    let Some(end) = strings::index_of_char_usize(rest, b' ') else {
        return false;
    };
    let (minor, rest) = rest.split_at(end);
    matches!(minor, [zeros @ .., b'0'..=b'3'] if zeros.iter().all(|&digit| digit == b'0'))
        && strings::contains(rest, b" Safari/")
}

#[derive(Default)]
struct Offer {
    server_no_context_takeover: bool,
    client_no_context_takeover: bool,
    server_max_window_bits: Option<u8>,
    client_max_window_bits: Option<u8>,
}

impl Offer {
    /// `None` for another extension, and for an offer to decline (RFC 7692 §7.1).
    fn parse(offer: &[u8]) -> Option<Self> {
        let mut parts = strings::split(offer, b";").map(|part| strings::trim(part, b" \t"));
        if parts.next()? != b"permessage-deflate" {
            return None;
        }
        let mut this = Self::default();
        for part in parts {
            let (name, bits) = match strings::split_once_char(part, b'=') {
                Some((name, value)) => (name, Some(parse_window_bits(value)?)),
                None => (part, None),
            };
            match (name, bits) {
                (b"server_no_context_takeover", None) if !this.server_no_context_takeover => {
                    this.server_no_context_takeover = true;
                }
                (b"client_no_context_takeover", None) if !this.client_no_context_takeover => {
                    this.client_no_context_takeover = true;
                }
                (b"server_max_window_bits", Some(_)) if this.server_max_window_bits.is_none() => {
                    this.server_max_window_bits = bits;
                }
                (b"client_max_window_bits", _) if this.client_max_window_bits.is_none() => {
                    this.client_max_window_bits = bits.or(Some(Params::MAX_WINDOW_BITS));
                }
                _ => return None,
            }
        }
        Some(this)
    }
}

/// Accepts the first offer that fits, and answers it. A window of 0 bits is no context takeover.
pub fn negotiate_compression(
    offers: &[u8],
    server_window_bits: u8,
    client_window_bits: u8,
) -> Option<(Params, Vec<u8>)> {
    const MAX: u8 = Params::MAX_WINDOW_BITS;
    strings::split(offers, b",").find_map(|offer| {
        let offer = Offer::parse(offer)?;

        let mut server = server_window_bits * u8::from(!offer.server_no_context_takeover);
        if let Some(max) = offer.server_max_window_bits {
            if server == 0 && max < MAX {
                return None;
            }
            server = server.min(max);
        }
        let mut client = client_window_bits * u8::from(!offer.client_no_context_takeover);
        match offer.client_max_window_bits {
            Some(max) => client = client.min(max),
            // Only a client that offered a limit may be given one.
            None if client < MAX => client = 0,
            None => {}
        }
        let params = Params {
            server_max_window_bits: if server == 0 { MAX } else { server },
            client_max_window_bits: if client == 0 { MAX } else { client },
            server_no_context_takeover: (server == 0).into(),
            client_no_context_takeover: (client == 0).into(),
        };

        let mut response = b"permessage-deflate".to_vec();
        let mut add = |name: &[u8], bits: Option<u8>| {
            response.extend_from_slice(name);
            if let Some(bits) = bits {
                response.extend_from_slice(bun_core::fmt::int_as_bytes(&mut [0; 2], bits));
            }
        };
        if client == 0 {
            add(b"; client_no_context_takeover", None);
        } else if client < MAX {
            add(b"; client_max_window_bits=", Some(client));
        }
        if server == 0 {
            add(b"; server_no_context_takeover", None);
        }
        if offer.server_max_window_bits.is_some() || params.server_max_window_bits < MAX {
            add(
                b"; server_max_window_bits=",
                Some(params.server_max_window_bits),
            );
        }
        Some((params, response))
    })
}
