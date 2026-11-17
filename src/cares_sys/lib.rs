#![feature(adt_const_params)]
#![allow(non_camel_case_types)]
#![warn(unused_must_use)]

#[path = "c_ares.rs"]
pub mod c_ares_draft;

/// Winsock typedefs not provided by `libc` on `x86_64-pc-windows-msvc`.
#[cfg(windows)]
pub mod winsock {
    use core::ffi::c_int;
    pub(crate) type socklen_t = c_int; // ws2tcpip.h: `typedef int socklen_t;`
    // Same nominal type as `bun_sys::posix::sockaddr*`.
    pub(crate) use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6, sockaddr_storage};
}

/// `c_ares` and `c_ares_draft` resolve to the same module.
pub use c_ares_draft as c_ares;

/// Thin wrapper over `ares_inet_ntop`: writes the text of the 4 or 16 `octets` into `dst`
/// and returns the slice up to (excluding) the trailing NUL on success.
/// `dst[len] == 0` is guaranteed on `Some`, so callers needing a C string can
/// rely on it.
#[inline]
pub fn ntop<'a>(octets: &[u8], dst: &'a mut [u8]) -> Option<&'a [u8]> {
    let af = match octets.len() {
        4 => c_ares::AF::INET,
        16 => c_ares::AF::INET6,
        _ => return None,
    };
    // SAFETY: `octets` has the size of an address of `af`, and `ares_inet_ntop` writes at most
    // `size` bytes (including the trailing NUL) per c-ares docs.
    if unsafe {
        c_ares::ares_inet_ntop(
            af,
            octets.as_ptr().cast(),
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

/// `ares_inet_pton` for IPv4 (`N` is 4) or IPv6 (`N` is 16).
pub fn pton<const N: usize>(text: &bun_core::ZStr) -> Option<[u8; N]> {
    let af = const {
        match N {
            4 => c_ares::AF::INET,
            16 => c_ares::AF::INET6,
            _ => panic!("an address has 4 or 16 octets"),
        }
    };
    let mut octets = [0; N];
    // SAFETY: `text` is NUL-terminated, and `octets` has the size of an address of `af`.
    let rc = unsafe { c_ares::ares_inet_pton(af, text.as_ptr(), octets.as_mut_ptr().cast()) };
    (rc == 1).then_some(octets)
}

pub fn parse_ip(text: &bun_core::ZStr) -> Option<core::net::IpAddr> {
    let v4 = pton::<4>(text).map(Into::into);
    v4.or_else(|| pton::<16>(text).map(Into::into))
}
