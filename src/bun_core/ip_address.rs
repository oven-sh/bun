//! IP-address parsing shared by URL/host handling and the DNS backends.

use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use sys::{AF_INET, AF_INET6, pton};

/// The one place this module touches C: the vendored c-ares `inet_pton`, which is pure C with no preconditions — unlike ws2_32's, which fails with WSANOTINITIALISED whenever it runs before `WSAStartup()`, as URL/host parsing can.
mod sys {
    use core::ffi::{c_char, c_int, c_void};

    // A thin libc/ws2def passthrough: bun_string sits below bun_sys, so `bun_sys::posix::AF` is out of reach.
    pub(super) const AF_INET: c_int = 2;
    #[cfg(not(windows))]
    pub(super) const AF_INET6: c_int = libc::AF_INET6 as c_int;
    #[cfg(windows)]
    pub(super) const AF_INET6: c_int = 23; // ws2def.h

    unsafe extern "C" {
        fn ares_inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
        #[cfg(not(windows))]
        fn inet_aton(cp: *const c_char, addr: *mut c_void) -> c_int;
    }

    /// BSD `inet_aton(3)`, which unlike `inet_pton` takes the shorthand forms (`127.1`, `0x7f000001`) that `getaddrinfo` accepts; Windows has no equivalent, so it parses strictly there.
    pub(super) fn aton(src: &[u8], dst: &mut [u8; 4]) -> bool {
        #[cfg(windows)]
        {
            pton(AF_INET, src, dst)
        }
        #[cfg(not(windows))]
        {
            debug_assert_eq!(src.last(), Some(&0));
            // SAFETY: `src` is NUL-terminated per the assert; `dst` is an `in_addr`.
            unsafe { inet_aton(src.as_ptr().cast(), dst.as_mut_ptr().cast()) != 0 }
        }
    }

    /// Safe wrapper: `src` is NUL-terminated by construction and `dst` is sized for the family.
    pub(super) fn pton(af: c_int, src: &[u8], dst: &mut [u8]) -> bool {
        debug_assert_eq!(src.last(), Some(&0));
        debug_assert!(dst.len() >= if af == AF_INET6 { 16 } else { 4 });
        // SAFETY: per the asserts above.
        unsafe { ares_inet_pton(af, src.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0 }
    }
}

pub fn is_ip_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() {
        return false;
    }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    pton(AF_INET, &buf[..=input.len()], &mut dst) || pton(AF_INET6, &buf[..=input.len()], &mut dst)
}

/// A strict parse, never a `contains(':')` heuristic — that mis-bracketed Windows paths like `C:/Windows/Temp/…` as `unix://[C:/…]`.
pub fn is_ipv6_address(input: &[u8]) -> bool {
    let mut buf = [0u8; 512];
    if input.len() >= buf.len() {
        return false;
    }
    buf[..input.len()].copy_from_slice(input);
    let mut dst = [0u8; 28];
    pton(AF_INET6, &buf[..=input.len()], &mut dst)
}

/// Parses what the platform resolver treats as a numeric host: dotted-quad, IPv6 (an optional `%zone` is stripped, not validated), and the `inet_aton` shorthand `getaddrinfo` accepts but `is_ip_address` rejects (`127.1`, `2130706433`, `0x7f000001`, `0177.0.0.1`).
pub fn to_ip_address(input: &[u8]) -> Option<IpAddr> {
    let mut buf = [0u8; 512];
    if input.is_empty() || input.len() >= buf.len() {
        return None;
    }
    // inet_aton(3) stops at whitespace and ignores what follows; getaddrinfo's numeric parse does not.
    if crate::strings::index_of_any(input, b" \t\n\r\x0b\x0c").is_some() {
        return None;
    }
    // A `%zone` suffix belongs to a numeric v6 host; resolving the zone is the caller's business.
    let head = crate::strings::index_of_char_usize(input, b'%').unwrap_or(input.len());
    buf[..head].copy_from_slice(&input[..head]);
    let mut v6 = [0u8; 16];
    if pton(AF_INET6, &buf[..=head], &mut v6) {
        return Some(IpAddr::V6(Ipv6Addr::from(v6)));
    }
    buf[..input.len()].copy_from_slice(input);
    let mut v4 = [0u8; 4];
    sys::aton(&buf[..=input.len()], &mut v4).then(|| IpAddr::V4(Ipv4Addr::from(v4)))
}
