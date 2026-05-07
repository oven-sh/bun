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
    /// `WSABUF` — Windows scatter/gather vector (libc has no `iovec` here).
    #[repr(C)] #[derive(Clone, Copy)]
    pub struct iovec { pub iov_len: u32, pub iov_base: *mut u8 }
}

#[repr(C)] pub struct Opaque { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }

/// Minimal un-gated surface of the c-ares FFI needed by downstream crates while
/// the full Phase-A draft (`c_ares.rs`) remains gated. Once `c_ares_draft` is
/// un-gated in B-2, this inline module is replaced by a `pub use` of the real
/// module.
pub mod c_ares {
    use core::ffi::{c_char, c_int, c_void};

    /// `ares_socklen_t` — alias of the platform `socklen_t` (see
    /// `vendor/cares/include/ares.h` / `c_ares.zig: pub const socklen_t = c.socklen_t`).
    #[cfg(not(windows))]
    pub type ares_socklen_t = libc::socklen_t;
    #[cfg(windows)]
    pub type ares_socklen_t = core::ffi::c_int; // ws2tcpip.h: `typedef int socklen_t;`
    pub type socklen_t = ares_socklen_t;

    /// `struct ares_addrinfo_hints` — POD hints passed to `ares_getaddrinfo`.
    /// Mirrors `AddrInfo_hints` in `c_ares.zig` (extern struct, all `c_int`).
    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    pub struct AddrInfo_hints {
        pub ai_flags: c_int,
        pub ai_family: c_int,
        pub ai_socktype: c_int,
        pub ai_protocol: c_int,
    }

    impl AddrInfo_hints {
        pub fn is_empty(&self) -> bool {
            self.ai_flags == 0 && self.ai_family == 0 && self.ai_socktype == 0 && self.ai_protocol == 0
        }
    }

    pub type ares_addrinfo_hints = AddrInfo_hints;

    unsafe extern "C" {
        /// https://c-ares.org/docs/ares_inet_ntop.html
        ///
        /// Converts a numeric address into a text string suitable for presentation.
        /// Returns `dst` on success, `NULL` on failure (with `errno` set).
        pub fn ares_inet_ntop(af: c_int, src: *const c_void, dst: *mut u8, size: ares_socklen_t) -> *const c_char;

        /// https://c-ares.org/docs/ares_inet_pton.html
        ///
        /// ## Returns
        /// - `1` if `src` was valid for the specified address family
        /// - `0` if `src` was not parseable in the specified address family
        /// - `-1` if some system error occurred. `errno` will have been set.
        pub fn ares_inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    }
}

// Crate-root re-exports for callers that reference `bun_cares_sys::ares_inet_*`
// directly (e.g. `bun_boringssl`).
pub use c_ares::{ares_inet_ntop, ares_inet_pton};
