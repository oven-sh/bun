// `format_v6` and the `parse_ares*` functions are derived from c-ares's inet_ntop.c and inet_net_pton.c:
//
// Copyright (c) 2012 by Gilles Chehade <gilles@openbsd.org>
// Copyright (c) 2004 by Internet Systems Consortium, Inc. ("ISC")
// Copyright (c) 1996-1999 by Internet Software Consortium.
//
// Permission to use, copy, modify, and distribute this software for any
// purpose with or without fee is hereby granted, provided that the above
// copyright notice and this permission notice appear in all copies.
//
// THE SOFTWARE IS PROVIDED "AS IS" AND ISC DISCLAIMS ALL WARRANTIES
// WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS.  IN NO EVENT SHALL ISC BE LIABLE FOR
// ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
// WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
// ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
// OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

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

/// A dotted quad or an IPv6 address and nothing else, the same on every platform. This is `core::net`'s parser and not [`parse_ares`], which also takes `10` (as 10.0.0.0), `127.1` (as 127.1.0.0), `0x7f000001`, zero-padded octets, and stops at a NUL.
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

/// An IPv6 address with a zone id: `fe80::1%eth0` is the address `fe80::1` and the zone `eth0`. The split is at the first `%`, and the address is in the strict form of `parse_strict`. The zone names an interface of this machine: it is not part of the address, and it is not checked here.
fn parse_zoned_ipv6(input: &[u8]) -> Option<(Ipv6Addr, &[u8])> {
    let (address, zone) = crate::strings::split_once_char(input, b'%')?;
    Some((parse_strict_v6(address)?, zone))
}

/// libuv's `uv_inet_pton` for either family, which Node.js reads an address with: `parse_strict`, or an IPv6 address up to the first `%`. The text is a C string there, so it ends at a NUL.
pub fn parse_uv_inet_pton(input: &[u8]) -> Option<IpAddr> {
    if let Some(ip) = parse_strict(input) {
        return Some(ip);
    }
    let text = match crate::strings::split_once_char(input, 0) {
        Some((text, _)) => {
            if let Some(ip) = parse_strict(text) {
                return Some(ip);
            }
            text
        }
        None => input,
    };
    Some(IpAddr::V6(parse_zoned_ipv6(text)?.0))
}

/// An IPv6 host with a zone id. Node.js's `net.isIP` takes the zone only when it is one or more of letters, digits, `-`, `.` and `:`.
pub fn parse_zoned_ipv6_host(host: &[u8]) -> Option<Ipv6Addr> {
    let (address, zone) = parse_zoned_ipv6(host)?;
    let is_zone_id = !zone.is_empty()
        && zone
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b':'));
    is_zone_id.then_some(address)
}

/// Whether Node.js's `net.isIP` takes `host`: `is_ip_address`, or `parse_zoned_ipv6_host`. The TLS name check matches such a host on the IP SANs of the certificate, and RFC 6066 takes no such host as SNI.
pub fn is_ip_host(host: &[u8]) -> bool {
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

/// The text of one address, without an allocation. Derefs to its bytes.
#[derive(Clone, Copy)]
pub struct AddressText {
    /// "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255" is the longest.
    buf: [u8; 45],
    len: u8,
}

impl AddressText {
    const EMPTY: Self = Self {
        buf: [0; 45],
        len: 0,
    };

    fn push(&mut self, byte: u8) {
        if let Some(slot) = self.buf.get_mut(usize::from(self.len)) {
            *slot = byte;
            self.len += 1;
        }
    }

    fn push_decimal(&mut self, octet: u8) {
        if octet >= 100 {
            self.push(b'0' + octet / 100);
        }
        if octet >= 10 {
            self.push(b'0' + octet / 10 % 10);
        }
        self.push(b'0' + octet % 10);
    }

    fn push_hex(&mut self, word: u16) {
        let skipped = (word.leading_zeros() / 4).min(3);
        for nibble in skipped..4 {
            let digit = (word >> (12 - 4 * nibble)) as u8 & 0xf;
            self.push(if digit < 10 {
                b'0' + digit
            } else {
                b'a' + digit - 10
            });
        }
    }

    fn push_v4(&mut self, octets: [u8; 4]) {
        for (i, octet) in octets.into_iter().enumerate() {
            if i != 0 {
                self.push(b'.');
            }
            self.push_decimal(octet);
        }
    }
}

impl core::ops::Deref for AddressText {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        self.buf.get(..usize::from(self.len)).unwrap_or(&[])
    }
}

/// `inet_ntop(AF_INET)`.
pub fn format_v4(octets: [u8; 4]) -> AddressText {
    let mut text = AddressText::EMPTY;
    text.push_v4(octets);
    text
}

/// `inet_ntop(AF_INET6)` as in BIND, libuv and c-ares. Unlike `Ipv6Addr`'s `Display`, `::1.2.3.4` keeps its dotted quad.
pub fn format_v6(octets: [u8; 16]) -> AddressText {
    let words = Ipv6Addr::from(octets).segments();

    // The longest run of zero words, the first of equals, if it is two or more.
    let (mut best_base, mut best_len) = (0usize, 0usize);
    let (mut run_base, mut run_len) = (0usize, 0usize);
    for (i, &word) in words.iter().enumerate() {
        if word != 0 {
            run_len = 0;
            continue;
        }
        if run_len == 0 {
            run_base = i;
        }
        run_len += 1;
        if run_len > best_len {
            (best_base, best_len) = (run_base, run_len);
        }
    }
    if best_len < 2 {
        best_len = 0;
    }

    let mut text = AddressText::EMPTY;
    for (i, &word) in words.iter().enumerate() {
        if best_len != 0 && (best_base..best_base + best_len).contains(&i) {
            if i == best_base {
                text.push(b':');
            }
            continue;
        }
        if i != 0 {
            text.push(b':');
        }
        let [.., a, b, c, d] = octets;
        let [.., fifth, _, _] = words;
        if i == 6
            && best_len != 0
            && best_base == 0
            && (best_len == 6 || (best_len == 5 && fifth == 0xffff))
        {
            text.push_v4([a, b, c, d]);
            return text;
        }
        text.push_hex(word);
    }
    if best_len != 0 && best_base + best_len == words.len() {
        text.push(b':');
    }
    text
}

pub fn format(ip: IpAddr) -> AddressText {
    match ip {
        IpAddr::V4(ip) => format_v4(ip.octets()),
        IpAddr::V6(ip) => format_v6(ip.octets()),
    }
}

/// The text is a C string to the `parse_ares_*` parsers: it ends at its first NUL.
fn c_char_at(src: &[u8], index: usize) -> u8 {
    src.get(index).copied().unwrap_or(0)
}

/// c-ares's `ares_inet_pton(AF_INET)`, which reads more than a dotted quad: one to four octets with the rest zero (`10`, `127.1` is 127.1.0.0), leading zeros (`010` is ten) and `0x` followed by up to eight hex digits.
pub fn parse_ares_v4(src: &[u8]) -> Option<[u8; 4]> {
    let mut dst = [0u8; 4];
    let mut written = 0usize;
    let mut at = 0usize;
    let mut next = || {
        at += 1;
        c_char_at(src, at - 1)
    };
    let mut put = |octet: u8| {
        *dst.get_mut(written)? = octet;
        written += 1;
        Some(())
    };

    let mut ch = next();
    if ch == b'0'
        && matches!(c_char_at(src, 1), b'x' | b'X')
        && c_char_at(src, 2).is_ascii_hexdigit()
    {
        next();
        let mut pending: Option<u8> = None;
        loop {
            ch = next();
            let Some(digit) = (ch as char).to_digit(16) else {
                break;
            };
            let digit = digit as u8;
            pending = match pending {
                None => Some(digit),
                Some(high) => {
                    put(high << 4 | digit)?;
                    None
                }
            };
        }
        if let Some(high) = pending {
            put(high << 4)?;
        }
    } else if ch.is_ascii_digit() {
        loop {
            let mut octet = 0u32;
            loop {
                octet = octet * 10 + u32::from(ch - b'0');
                if octet > 255 {
                    return None;
                }
                ch = next();
                if !ch.is_ascii_digit() {
                    break;
                }
            }
            put(octet as u8)?;
            if ch == 0 || ch == b'/' {
                break;
            }
            if ch != b'.' {
                return None;
            }
            ch = next();
            if !ch.is_ascii_digit() {
                return None;
            }
        }
    } else {
        return None;
    }
    (ch == 0).then_some(dst)
}

/// c-ares's `ares_inet_pton(AF_INET6)`. No zone id. A dotted quad at the end is read by [`parse_ares_v4`], so `::1.2` is `::1.2.0.0`.
pub fn parse_ares_v6(src: &[u8]) -> Option<[u8; 16]> {
    let mut octets = [0u8; 16];
    let mut written = 0usize;
    let mut elided_at: Option<usize> = None;
    let mut at = 0usize;

    if c_char_at(src, 0) == b':' {
        if c_char_at(src, 1) != b':' {
            return None;
        }
        at = 1;
    }
    let mut group_start = at;
    let mut digits = 0u32;
    let mut word = 0u16;
    fn put_word(octets: &mut [u8; 16], written: &mut usize, word: u16) -> Option<()> {
        octets
            .get_mut(*written..*written + 2)?
            .copy_from_slice(&word.to_be_bytes());
        *written += 2;
        Some(())
    }

    loop {
        let ch = c_char_at(src, at);
        at += 1;
        if ch == 0 {
            break;
        }
        if let Some(digit) = (ch as char).to_digit(16) {
            if digits >= 4 {
                return None;
            }
            word = word << 4 | digit as u16;
            digits += 1;
            continue;
        }
        if ch == b':' {
            group_start = at;
            if digits == 0 {
                if elided_at.is_some() {
                    return None;
                }
                elided_at = Some(written);
                continue;
            }
            if c_char_at(src, at) == 0 {
                return None;
            }
            put_word(&mut octets, &mut written, word)?;
            (digits, word) = (0, 0);
            continue;
        }
        if ch == b'.' && written + 4 <= octets.len() {
            let quad = parse_ares_v4(src.get(group_start..)?)?;
            octets.get_mut(written..written + 4)?.copy_from_slice(&quad);
            written += 4;
            digits = 0;
            break;
        }
        return None;
    }
    if digits != 0 {
        put_word(&mut octets, &mut written, word)?;
    }
    if let Some(elided_at) = elided_at {
        if written == octets.len() {
            return None;
        }
        let tail = written - elided_at;
        octets.copy_within(elided_at..written, 16 - tail);
        octets.get_mut(elided_at..16 - tail)?.fill(0);
        written = octets.len();
    }
    (written == octets.len()).then_some(octets)
}

/// [`parse_ares_v4`], else [`parse_ares_v6`].
pub fn parse_ares(src: &[u8]) -> Option<IpAddr> {
    if let Some(v4) = parse_ares_v4(src) {
        return Some(IpAddr::from(v4));
    }
    parse_ares_v6(src).map(IpAddr::from)
}
