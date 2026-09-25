//! IP-address parsing shared by URL/host handling and the DNS backends.

#[cfg(not(windows))]
use core::net::Ipv4Addr;
use core::net::{IpAddr, Ipv6Addr};

/// The one place this module touches C.
#[cfg(not(windows))]
mod sys {
    use core::ffi::{c_char, c_int, c_void};

    unsafe extern "C" {
        fn inet_aton(cp: *const c_char, addr: *mut c_void) -> c_int;
    }

    /// BSD `inet_aton(3)`, which unlike `inet_pton` takes the shorthand forms (`127.1`, `0x7f000001`) that `getaddrinfo` accepts.
    pub(super) fn aton(src: &[u8], dst: &mut [u8; 4]) -> bool {
        debug_assert_eq!(src.last(), Some(&0));
        // SAFETY: `src` is NUL-terminated per the assert; `dst` is an `in_addr`.
        unsafe { inet_aton(src.as_ptr().cast(), dst.as_mut_ptr().cast()) != 0 }
    }
}

/// Whether `input` is an IP literal: `net.isIP` without a `%zone`.
pub fn is_ip_address(input: &[u8]) -> bool {
    parse_strict(input).is_some()
}

/// A strict parse, never a `contains(':')` heuristic — that mis-bracketed Windows paths like `C:/Windows/Temp/…` as `unix://[C:/…]`.
pub fn is_ipv6_address(input: &[u8]) -> bool {
    parse_strict_v6(input).is_some()
}

/// A dotted quad or an IPv6 address and nothing else, the same on every platform. This is `core::net`'s parser and not `ares_inet_pton`, which is `inet_net_pton` underneath: it also takes `10` (as 10.0.0.0), `127.1` (as 127.1.0.0), `0x7f000001`, zero-padded octets, a trailing `/bits`, and stops at a NUL.
#[inline(never)]
pub fn parse_strict(input: &[u8]) -> Option<IpAddr> {
    // The longest literal is "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255", so a longer host is never scanned.
    if input.len() > 45 {
        return None;
    }
    crate::fmt::parse_ascii::<IpAddr>(input)
}

/// The IPv6 half of [`parse_strict`], for a caller that has no use for a dotted quad.
fn parse_strict_v6(input: &[u8]) -> Option<Ipv6Addr> {
    if input.len() > 45 {
        return None;
    }
    crate::fmt::parse_ascii::<Ipv6Addr>(input)
}

/// An IPv6 address with a zone id: `fe80::1%eth0` is the address `fe80::1` and the zone `eth0`. The split is at the first `%`, as in libuv's `uv_inet_pton`, and the address is in the strict form of `parse_strict`. The zone names an interface of this machine: it is not part of the address, and it is not checked here.
pub fn parse_zoned_ipv6(input: &[u8]) -> Option<(Ipv6Addr, &[u8])> {
    let (address, zone) = crate::strings::split_once_char(input, b'%')?;
    Some((parse_strict_v6(address)?, zone))
}

/// `parse_zoned_ipv6` for a host: Node.js's `net.isIP` takes the zone only when it is one or more of letters, digits, `-`, `.` and `:`.
pub fn parse_zoned_ipv6_host(host: &[u8]) -> Option<Ipv6Addr> {
    let (address, zone) = parse_zoned_ipv6(host)?;
    let is_zone_id = !zone.is_empty()
        && zone
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b':'));
    is_zone_id.then_some(address)
}

/// `is_ip_address`, or an IPv6 address with a zone id. A TLS client sends no SNI for such a host (RFC 6066).
pub fn is_ip_address_or_zoned(host: &[u8]) -> bool {
    is_ip_address(host) || parse_zoned_ipv6_host(host).is_some()
}

/// Parses what the platform resolver treats as a numeric host: dotted-quad, IPv6 (an optional `%zone` is stripped, not validated), and the `inet_aton` shorthand `getaddrinfo` accepts but `is_ip_address` rejects (`127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`). The Windows resolver reads no shorthand.
pub fn to_ip_address(input: &[u8]) -> Option<IpAddr> {
    // A `%zone` suffix belongs to a numeric v6 host; resolving the zone is the caller's business.
    let head = crate::strings::index_of_char_usize(input, b'%').unwrap_or(input.len());
    if let Some(v6) = parse_strict_v6(&input[..head]) {
        return Some(IpAddr::V6(v6));
    }
    #[cfg(windows)]
    {
        parse_strict(input)
    }
    #[cfg(not(windows))]
    {
        let mut buf = [0u8; 512];
        if input.is_empty() || input.len() >= buf.len() {
            return None;
        }
        buf[..input.len()].copy_from_slice(input);
        let mut v4 = [0u8; 4];
        // `inet_aton` stops at whitespace or a NUL and reads what comes before.
        (sys::aton(&buf[..=input.len()], &mut v4)
            && crate::strings::index_of_any(input, b" \t\n\r\x0b\x0c\0").is_none())
        .then(|| IpAddr::V4(Ipv4Addr::from(v4)))
    }
}

/// A host as URLs and `host:port` strings write it keeps an IPv6 literal's
/// brackets; resolvers, certificates and SNI name the bare address.
/// `[::1]` -> `::1` (a `%zone` stays). Anything else in brackets, such as
/// `[example.com]`, passes through verbatim, as in Node.
pub fn strip_ipv6_brackets(host: &[u8]) -> &[u8] {
    if let [b'[', inner @ .., b']'] = host {
        if to_ip_address(inner).is_some_and(|ip| ip.is_ipv6()) {
            return inner;
        }
    }
    host
}
