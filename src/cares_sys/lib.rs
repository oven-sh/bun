#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
// B-1: gate Phase-A draft module; expose opaque FFI handles only. Body preserved for B-2.

#[path = "c_ares.rs"]
pub mod c_ares_draft;

/// Winsock typedefs not provided by `libc` on `x86_64-pc-windows-msvc`.
#[cfg(windows)]
pub(crate) mod winsock {
    use core::ffi::{c_int, c_long};
    pub type socklen_t = c_int; // ws2tcpip.h: `typedef int socklen_t;`
    // Same nominal type as `bun_sys::posix::sockaddr*`; sin_addr is `in_addr{s_addr}`
    // (vs the previous `[u8;4]`) but the only caller (c_ares.rs `get_sockaddr`)
    // takes `&raw mut → cast<c_void>`, so the field's nominal type is transparent.
    pub use bun_libuv_sys::{sockaddr, sockaddr_in, sockaddr_in6};
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct timeval {
        pub tv_sec: c_long,
        pub tv_usec: c_long,
    }
    /// c-ares' `ares.h` defines its own POSIX-layout `struct iovec { void *iov_base; size_t iov_len; }`
    /// on Windows for the `asendv` socket-function callback — it does NOT use `WSABUF`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct iovec {
        pub iov_base: *mut core::ffi::c_void,
        pub iov_len: usize,
    }
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
