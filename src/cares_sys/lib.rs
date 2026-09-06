#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

#[path = "c_ares.rs"]
pub mod c_ares_draft;

/// Winsock typedefs not provided by `libc` on `x86_64-pc-windows-msvc`.
#[cfg(windows)]
pub mod winsock {
    use core::ffi::c_int;
    pub(crate) type socklen_t = c_int; // ws2tcpip.h: `typedef int socklen_t;`
    // Same nominal type as `bun_sys::posix::sockaddr*`; sin_addr is `in_addr{s_addr}`
    // (vs the previous `[u8;4]`) but the only caller (c_ares.rs `get_sockaddr`)
    // takes `&raw mut → cast<c_void>`, so the field's nominal type is transparent.
    pub(crate) use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6};
}

/// `c_ares` and `c_ares_draft` resolve to the same module.
pub use c_ares_draft as c_ares;

// Crate-root re-exports for callers that reference `bun_cares_sys::ares_inet_*`
// directly (e.g. `bun_boringssl`).
pub use c_ares::{ares_inet_ntop, ares_inet_pton};

/// Thin wrapper over `ares_inet_ntop`: writes the textual address into `dst`
/// and returns the slice up to (excluding) the trailing NUL on success.
/// `dst[len] == 0` is guaranteed on `Some`, so callers needing a C string can
/// rely on it.
///
/// # Safety
/// `src` must point to a valid `in_addr` (af == AF_INET) or `in6_addr`
/// (af == AF_INET6).
#[inline]
pub unsafe fn ntop(
    af: core::ffi::c_int,
    src: *const core::ffi::c_void,
    dst: &mut [u8],
) -> Option<&[u8]> {
    // SAFETY: caller contract guarantees `src` points to a valid `in_addr` /
    // `in6_addr` matching `af`; `dst` is a Rust slice so `dst.as_mut_ptr()` is
    // valid for `dst.len()` writes, and `ares_inet_ntop` writes at most `size`
    // bytes (including the trailing NUL) per c-ares docs.
    if unsafe {
        c_ares::ares_inet_ntop(
            af,
            src,
            dst.as_mut_ptr(),
            dst.len() as c_ares::ares_socklen_t,
        )
    }
    .is_null()
    {
        return None;
    }
    Some(bun_core::ffi::slice_to_nul(dst))
}

/// Where [`pton`] writes the parsed address: the `in_addr` / `in6_addr`
/// field of a `sockaddr_in` / `sockaddr_in6`.
pub enum PtonDst<'a> {
    V4(&'a mut u32),
    V6(&'a mut [u8; 16]),
}

/// `ares_inet_pton`: parse the NUL-terminated presentation address `addr`
/// into `dst` (which picks the family). Returns the C result: 1 on success,
/// 0 if `addr` is not parseable, -1 with `errno` set otherwise.
pub fn pton(addr: &core::ffi::CStr, dst: PtonDst<'_>) -> core::ffi::c_int {
    let (af, dst): (core::ffi::c_int, *mut core::ffi::c_void) = match dst {
        PtonDst::V4(v4) => (c_ares::AF::INET, core::ptr::from_mut(v4).cast()),
        PtonDst::V6(v6) => (c_ares::AF::INET6, core::ptr::from_mut(v6).cast()),
    };
    // SAFETY: `addr` is NUL-terminated; `dst` is writable for the 4 / 16
    // bytes `ares_inet_pton` stores for `af`.
    unsafe { c_ares::ares_inet_pton(af, addr.as_ptr(), dst) }
}

/// [`ntop`] for an address held as a Rust value (`ares_inet_ntop`
/// formatting, which differs from `core::net`'s for IPv4-compatible IPv6).
pub fn ip_to_text<'a>(ip: &core::net::IpAddr, dst: &'a mut [u8]) -> Option<&'a [u8]> {
    match ip {
        core::net::IpAddr::V4(v4) => {
            let octets = v4.octets();
            // SAFETY: `in_addr` is these 4 network-order bytes.
            unsafe { ntop(c_ares::AF::INET, octets.as_ptr().cast(), dst) }
        }
        core::net::IpAddr::V6(v6) => {
            let octets = v6.octets();
            // SAFETY: `in6_addr` is these 16 bytes.
            unsafe { ntop(c_ares::AF::INET6, octets.as_ptr().cast(), dst) }
        }
    }
}
