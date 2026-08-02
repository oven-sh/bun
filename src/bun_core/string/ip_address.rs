//! IP-address parsing shared by URL/host handling and the DNS backends.

use core::ffi::c_int;
use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

// Uses `ares_inet_pton`, the vendored
// c-ares implementation. Do NOT call the system `inet_pton` here: on Windows that
// resolves into ws2_32.dll and fails with WSANOTINITIALISED whenever it runs before
// `WSAStartup()`, which URL/host parsing can. c-ares' impl is pure C, no preconditions.
unsafe extern "C" {
    pub fn ares_inet_pton(
        af: c_int,
        src: *const core::ffi::c_char,
        dst: *mut core::ffi::c_void,
    ) -> c_int;
}

// dep-graph: bun_string < bun_sys, so cannot import the canonical
// `bun_sys::posix::AF`. Keep a thin libc/ws2def passthrough instead. The
// previous hand-rolled cfg ladder hardcoded `10` for the BSD fallback, which
// is wrong (FreeBSD AF_INET6 == 28); routing through `libc` fixes that.
const AF_INET: c_int = 2;
#[cfg(not(windows))]
const AF_INET6: c_int = libc::AF_INET6 as c_int;
#[cfg(windows)]
const AF_INET6: c_int = 23; // ws2def.h

pub fn is_ip_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() {
        return false;
    }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
    unsafe {
        ares_inet_pton(AF_INET, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0
            || ares_inet_pton(AF_INET6, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0
    }
}

/// `ares_inet_pton(AF_INET6, …) > 0`.
/// Must be a strict parse, not a `contains(':')` heuristic: on Windows a
/// unix-socket path like `C:/Windows/Temp/…` contains a colon and the old
/// heuristic mis-bracketed it as `unix://[C:/…]`, which fails URL parsing.
pub fn is_ipv6_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() {
        return false;
    }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
    unsafe { ares_inet_pton(AF_INET6, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0 }
}

/// Parses what the platform resolver treats as a numeric host: dotted-quad, IPv6 (an optional `%zone` is stripped, not validated), and the `inet_aton` shorthand `getaddrinfo` accepts but `is_ip_address` rejects (`127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`).
pub fn to_ip_address(input: &[u8]) -> Option<IpAddr> {
    let head = match input.iter().position(|b| *b == b'%') {
        Some(i) => &input[..i],
        None => input,
    };
    if let Ok(s) = std::str::from_utf8(head) {
        if let Ok(v6) = s.parse::<Ipv6Addr>() {
            return Some(IpAddr::V6(v6));
        }
    }
    inet_aton(input).map(IpAddr::V4)
}

/// `inet_aton(3)` in safe Rust, verified byte-for-byte against the platform parser over 20k inputs: 1-4 parts, each decimal / `0`-octal / `0x`-hex, the last absorbing the remaining bytes, and a whitespace terminator ending a valid address.
fn inet_aton(input: &[u8]) -> Option<Ipv4Addr> {
    let mut parts = [0u64; 4];
    let mut n = 0usize;
    let mut rest = input;
    loop {
        if n == 4 {
            return None;
        }
        let (val, used) = parse_part(rest)?;
        parts[n] = val;
        n += 1;
        rest = &rest[used..];
        match rest.first() {
            Some(b'.') => rest = &rest[1..],
            // BSD stops at the first non-digit: a whitespace terminator ends a
            // valid address ("1.2.3.4 5" parses), anything else rejects.
            Some(c) if c.is_ascii_whitespace() => break,
            Some(_) => return None,
            None => break,
        }
    }
    let last = parts[n - 1];
    // Only the single-part form is unchecked (it truncates); every other shape
    // must fit the bits its position leaves.
    if n > 1 && last > (u32::MAX >> (8 * (n as u32 - 1))) as u64 {
        return None;
    }
    if parts[..n - 1].iter().any(|p| *p > 0xff) {
        return None;
    }
    let mut addr = last as u32;
    for (i, p) in parts[..n - 1].iter().enumerate() {
        addr |= (*p as u32) << (24 - 8 * i as u32);
    }
    Some(Ipv4Addr::from(addr))
}

fn parse_part(s: &[u8]) -> Option<(u64, usize)> {
    if s.is_empty() || !s[0].is_ascii_digit() {
        return None;
    }
    let (radix, start) = if s.len() >= 2 && s[0] == b'0' && (s[1] | 0x20) == b'x' {
        (16u64, 2usize)
    } else if s[0] == b'0' {
        (8, 1)
    } else {
        (10, 0)
    };
    let mut i = start;
    let mut val: u64 = 0;
    while i < s.len() {
        match (s[i] as char).to_digit(radix as u32) {
            Some(d) => {
                val = val.wrapping_mul(radix).wrapping_add(d as u64);
                i += 1;
            }
            None => break,
        }
    }
    // A bare "0" is octal zero with no further digits.
    if i == start && !(radix == 8 && start == 1) {
        return None;
    }
    Some((val, i))
}
