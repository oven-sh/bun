#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// B-1: gate Phase-A draft module; expose opaque FFI handles only. Body preserved for B-2.

#[path = "c_ares.rs"]
pub mod c_ares_draft;

/// Winsock typedefs not provided by `libc` on `x86_64-pc-windows-msvc`.
/// Kept local so this `*_sys` crate stays leaf (no `bun_sys`/`windows-sys`).
#[cfg(windows)]
pub(crate) mod winsock {
    use core::ffi::{c_int, c_long, c_ushort};
    pub type socklen_t = c_int; // ws2tcpip.h: `typedef int socklen_t;`
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct sockaddr { pub sa_family: c_ushort, pub sa_data: [u8; 14] }
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct sockaddr_in { pub sin_family: c_ushort, pub sin_port: c_ushort, pub sin_addr: [u8; 4], pub sin_zero: [u8; 8] }
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct sockaddr_in6 { pub sin6_family: c_ushort, pub sin6_port: c_ushort, pub sin6_flowinfo: u32, pub sin6_addr: [u8; 16], pub sin6_scope_id: u32 }
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct timeval { pub tv_sec: c_long, pub tv_usec: c_long }
    /// c-ares' `ares.h` defines its own POSIX-layout `struct iovec { void *iov_base; size_t iov_len; }`
    /// on Windows for the `asendv` socket-function callback — it does NOT use `WSABUF`.
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct iovec { pub iov_base: *mut core::ffi::c_void, pub iov_len: usize }
}

/// The full c-ares FFI module. The temporary inline scaffold that previously
/// duplicated `ares_socklen_t` / `AddrInfo_hints` / `ares_inet_*` here has been
/// collapsed to a re-export of the canonical `c_ares.rs` module now that it is
/// un-gated. `c_ares` and `c_ares_draft` resolve to the SAME module, so the two
/// `AddrInfo_hints` definitions are now nominally identical (previously a latent
/// type-mismatch footgun for callers mixing the two paths).
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
    if c_ares::ares_inet_ntop(af, src, dst.as_mut_ptr(), dst.len() as c_ares::ares_socklen_t).is_null() {
        return None;
    }
    let n = dst.iter().position(|&b| b == 0).unwrap_or(dst.len());
    Some(&dst[..n])
}
