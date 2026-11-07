//! getaddrinfo(3) statuses as the errors `node:dns` reports.

use bun_dns_resolver::Error;

/// `EAI_*`. The `libc` crate has no `EAI_ADDRFAMILY` and none of glibc's
/// `getaddrinfo_a` extensions, so those are the values of `<netdb.h>`.
#[cfg(not(windows))]
mod eai {
    use core::ffi::c_int;

    #[cfg(target_os = "linux")]
    pub(super) const ADDRFAMILY: c_int = -9;
    #[cfg(not(target_os = "linux"))]
    pub(super) const ADDRFAMILY: c_int = 1;

    // RFC 3493 dropped EAI_NODATA; FreeBSD's <netdb.h> only exposes it under
    // __BSD_VISIBLE (historical value 7) and the libc crate omits it entirely.
    #[cfg(not(any(target_os = "freebsd", target_os = "dragonfly")))]
    pub(super) const NODATA: c_int = libc::EAI_NODATA;
    #[cfg(any(target_os = "freebsd", target_os = "dragonfly"))]
    pub(super) const NODATA: c_int = 7;

    // glibc only (absent on musl, bionic).
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(super) const INPROGRESS: c_int = -100;
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(super) const CANCELED: c_int = -101;
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(super) const NOTCANCELED: c_int = -102;
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(super) const ALLDONE: c_int = -103;
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    pub(super) const IDN_ENCODE: c_int = -105;
}

/// `None` for success. On Windows `rc` is libuv's `UV_EAI_*`.
pub fn error_from_eai(rc: i32) -> Option<Error> {
    #[cfg(windows)]
    {
        use bun_libuv_sys as libuv;
        // TODO: revisit this
        match rc {
            0 => None,
            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            libuv::UV_EAI_NODATA | libuv::UV_EAI_NONAME => Some(Error::ENOTFOUND),
            libuv::UV_EAI_AGAIN => Some(Error::EAI_AGAIN),
            libuv::UV_EAI_ADDRFAMILY => Some(Error::EBADFAMILY),
            libuv::UV_EAI_BADFLAGS => Some(Error::EBADFLAGS),
            libuv::UV_EAI_BADHINTS => Some(Error::EBADHINTS),
            libuv::UV_EAI_CANCELED => Some(Error::ECANCELLED),
            libuv::UV_EAI_FAIL => Some(Error::ENOTFOUND),
            libuv::UV_EAI_FAMILY => Some(Error::EBADFAMILY),
            libuv::UV_EAI_MEMORY => Some(Error::ENOMEM),
            libuv::UV_EAI_OVERFLOW => Some(Error::ENOMEM),
            libuv::UV_EAI_PROTOCOL => Some(Error::EBADQUERY),
            libuv::UV_EAI_SERVICE => Some(Error::ESERVICE),
            libuv::UV_EAI_SOCKTYPE => Some(Error::ECONNREFUSED),
            _ => Some(Error::ENOTFOUND), // UV_ENOENT and non documented errors
        }
    }

    #[cfg(not(windows))]
    {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if rc == libc::EAI_SOCKTYPE {
            return Some(Error::ECONNREFUSED);
        }

        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        match rc {
            eai::IDN_ENCODE => return Some(Error::EBADSTR),
            eai::ALLDONE => return Some(Error::ENOTFOUND),
            eai::INPROGRESS => return Some(Error::ETIMEOUT),
            eai::CANCELED | eai::NOTCANCELED => return Some(Error::ECANCELLED),
            _ => {}
        }

        match rc {
            0 => None,
            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            eai::NODATA | libc::EAI_NONAME => Some(Error::ENOTFOUND),
            eai::ADDRFAMILY => Some(Error::EBADFAMILY),
            libc::EAI_AGAIN => Some(Error::EAI_AGAIN),
            libc::EAI_BADFLAGS => Some(Error::EBADFLAGS), // Invalid hints
            libc::EAI_FAIL => Some(Error::EBADRESP),
            libc::EAI_FAMILY => Some(Error::EBADFAMILY),
            libc::EAI_MEMORY => Some(Error::ENOMEM),
            libc::EAI_SERVICE => Some(Error::ESERVICE),
            libc::EAI_SYSTEM => Some(Error::ESERVFAIL),
            // Any EAI code not mapped above is reported as "not implemented".
            _ => Some(Error::ENOTIMP),
        }
    }
}

/// This platform's raw getaddrinfo(3) status for the `EAI_*` code named `name`.
pub fn eai_raw_by_name(name: &[u8]) -> Option<i32> {
    #[cfg(windows)]
    {
        use bun_libuv_sys as libuv;
        match name {
            b"EAI_AGAIN" => Some(libuv::UV_EAI_AGAIN),
            b"EAI_FAIL" => Some(libuv::UV_EAI_FAIL),
            b"EAI_NONAME" => Some(libuv::UV_EAI_NONAME),
            _ => None,
        }
    }
    #[cfg(not(windows))]
    {
        match name {
            b"EAI_AGAIN" => Some(libc::EAI_AGAIN),
            b"EAI_FAIL" => Some(libc::EAI_FAIL),
            b"EAI_NONAME" => Some(libc::EAI_NONAME),
            _ => None,
        }
    }
}
