//! `NO_PROXY` matching, shared by the env loader and the HTTP client.
//!
//! Entries are separated by commas or whitespace. An entry is `*`, a domain
//! (`example.com`, `.example.com`, `*.example.com`: the name and every
//! subdomain), an IP address (`127.0.0.1`, `::1`, `[::1]`), or a CIDR block
//! (`10.0.0.0/8`, `fd00::/8`). A domain or address may carry `:port`, which
//! then has to equal the request's port. An IP-literal host only ever matches
//! an address or CIDR entry, never a domain suffix.

use core::net::IpAddr;

use bun_core::strings;

fn strip_trailing_dot(host: &[u8]) -> &[u8] {
    host.strip_suffix(b".").unwrap_or(host)
}

/// A dotted-quad or IPv6 address, parsed the same way on every platform, with
/// `::ffff:a.b.c.d` folded into `a.b.c.d`. The resolver's shorthand (`127.1`,
/// `0x7f.1`) is not an address here: `fetch()` and `WebSocket` hosts arrive
/// normalized to the dotted quad, and a host the other callers took from
/// configuration is compared as written, like curl does.
fn parse_ip(text: &[u8]) -> Option<IpAddr> {
    bun_core::fmt::parse_ascii::<IpAddr>(text).map(|ip| ip.to_canonical())
}

/// Splits `host[:port]`, where `host` may be a bracketed or bare IPv6 literal.
fn split_port(entry: &[u8]) -> (&[u8], Option<&[u8]>) {
    if entry.first() == Some(&b'[') {
        if let Some(close) = strings::index_of_char_usize(entry, b']') {
            let rest = &entry[close + 1..];
            return (&entry[1..close], rest.strip_prefix(b":"));
        }
        return (entry, None);
    }
    if strings::count_char(entry, b':') == 1 {
        let colon = strings::index_of_char_usize(entry, b':').unwrap();
        return (&entry[..colon], Some(&entry[colon + 1..]));
    }
    (entry, None)
}

fn cidr_contains(entry: &[u8], slash: usize, host: IpAddr) -> bool {
    let Some(written) =
        bun_core::fmt::parse_ascii::<IpAddr>(bun_url::strip_ipv6_brackets(&entry[..slash]))
    else {
        return false;
    };
    let Ok(mut bits) = bun_core::fmt::parse_int::<u8>(&entry[slash + 1..], 10) else {
        return false;
    };
    // `::ffff:10.0.0.0/104` is `10.0.0.0/8`.
    let network = written.to_canonical();
    if written.is_ipv6() && network.is_ipv4() {
        let Some(v4_bits) = bits.checked_sub(96) else {
            return false;
        };
        bits = v4_bits;
    }
    fn prefix_eq(a: &[u8], b: &[u8], bits: u8) -> bool {
        let bits = bits as usize;
        if bits > a.len() * 8 {
            return false;
        }
        let (whole, rem) = (bits / 8, bits % 8);
        if a[..whole] != b[..whole] {
            return false;
        }
        rem == 0 || (a[whole] ^ b[whole]) >> (8 - rem) == 0
    }
    match (network, host) {
        (IpAddr::V4(n), IpAddr::V4(h)) => prefix_eq(&n.octets(), &h.octets(), bits),
        (IpAddr::V6(n), IpAddr::V6(h)) => prefix_eq(&n.octets(), &h.octets(), bits),
        _ => false,
    }
}

/// Whether `hostname` (no port; an IPv6 literal may be bracketed) on `port`
/// is exempted from proxying by the `NO_PROXY` value `list`.
pub fn matches(list: &[u8], hostname: &[u8], port: u16) -> bool {
    let hostname = strip_trailing_dot(bun_url::strip_ipv6_brackets(hostname));
    if hostname.is_empty() {
        return false;
    }
    let mut entries = strings::tokenize_any(list, b", \t\r\n").peekable();
    if entries.peek().is_none() {
        return false;
    }
    let host_ip = parse_ip(hostname);

    for entry in entries {
        if entry == b"*" {
            return true;
        }
        if let Some(slash) = strings::index_of_char_usize(entry, b'/') {
            if host_ip.is_some_and(|ip| cidr_contains(entry, slash, ip)) {
                return true;
            }
            continue;
        }

        let (entry_host, entry_port) = split_port(entry);
        if let Some(entry_port) = entry_port {
            match bun_core::fmt::parse_int::<u16>(entry_port, 10) {
                Ok(p) if p == port => {}
                _ => continue,
            }
        }

        let entry_host = entry_host
            .strip_prefix(b"*.")
            .or_else(|| entry_host.strip_prefix(b"."))
            .unwrap_or(entry_host);
        let entry_host = strip_trailing_dot(entry_host);
        if entry_host.is_empty() {
            continue;
        }

        if let Some(ip) = host_ip {
            if parse_ip(entry_host) == Some(ip) {
                return true;
            }
            continue;
        }

        if hostname.len() == entry_host.len() {
            if strings::eql_case_insensitive_ascii(hostname, entry_host, true) {
                return true;
            }
        } else if hostname.len() > entry_host.len()
            && hostname[hostname.len() - entry_host.len() - 1] == b'.'
            && strings::eql_case_insensitive_ascii(
                &hostname[hostname.len() - entry_host.len()..],
                entry_host,
                true,
            )
        {
            return true;
        }
    }
    false
}
