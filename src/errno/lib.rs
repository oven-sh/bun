#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

#[cfg(not(windows))]
macro_rules! impl_get_errno_libc {
    ($($t:ty),+ $(,)?) => {$(
        impl $crate::GetErrno for $t {
            #[inline]
            fn get_errno(self) -> $crate::E {
                if self == !(0 as $t) {
                    $crate::E::from_raw($crate::posix::errno() as u16)
                } else {
                    $crate::E::SUCCESS
                }
            }
        }
    )+};
}

#[macro_export]
#[doc(hidden)]
macro_rules! __decl_uv_e {
    ( $( $ident:ident = $value:expr => $display:literal ),+ $(,)? ) => {
        $( pub const $ident: i32 = $value; )+

        pub fn name(neg_uv_err: i32) -> Option<&'static str> {
            // Target-independent libuv-synthetic codes (no `uv_e::*` const).
            // Values from vendor/libuv/include/uv/errno.h.
            match neg_uv_err {
                -4095 => return Some("EOF"),
                -4094 => return Some("UNKNOWN"),
                -3000 => return Some("EAI_ADDRFAMILY"),
                -3001 => return Some("EAI_AGAIN"),
                -3002 => return Some("EAI_BADFLAGS"),
                -3003 => return Some("EAI_CANCELED"),
                -3004 => return Some("EAI_FAIL"),
                -3005 => return Some("EAI_FAMILY"),
                -3006 => return Some("EAI_MEMORY"),
                -3007 => return Some("EAI_NODATA"),
                -3008 => return Some("EAI_NONAME"),
                -3009 => return Some("EAI_OVERFLOW"),
                -3010 => return Some("EAI_SERVICE"),
                -3011 => return Some("EAI_SOCKTYPE"),
                -3013 => return Some("EAI_BADHINTS"),
                -3014 => return Some("EAI_PROTOCOL"),
                _ => {}
            }
            // Per-OS rows. `if`-chain (not `match`) because two `$value`s may
            // resolve to the same integer on some targets (e.g. EAGAIN ==
            // EWOULDBLOCK), which `match` rejects as an unreachable pattern.
            $( if neg_uv_err == -($ident) { return Some($display); } )+
            None
        }
    };
}

#[macro_export]
#[doc(hidden)]
macro_rules! __uv_e_rows {
    ($cb:ident) => {
        $crate::__decl_uv_e! {
            // Zig `@"2BIG"` — Rust idents can't start with a digit → `_2BIG`.
            _2BIG          = $cb!(_2BIG,          E2BIG,           UV_E2BIG)           => "E2BIG",
            ACCES          = $cb!(ACCES,          EACCES,          UV_EACCES)          => "EACCES",
            ADDRINUSE      = $cb!(ADDRINUSE,      EADDRINUSE,      UV_EADDRINUSE)      => "EADDRINUSE",
            ADDRNOTAVAIL   = $cb!(ADDRNOTAVAIL,   EADDRNOTAVAIL,   UV_EADDRNOTAVAIL)   => "EADDRNOTAVAIL",
            AFNOSUPPORT    = $cb!(AFNOSUPPORT,    EAFNOSUPPORT,    UV_EAFNOSUPPORT)    => "EAFNOSUPPORT",
            AGAIN          = $cb!(AGAIN,          EAGAIN,          UV_EAGAIN)          => "EAGAIN",
            ALREADY        = $cb!(ALREADY,        EALREADY,        UV_EALREADY)        => "EALREADY",
            BADF           = $cb!(BADF,           EBADF,           UV_EBADF)           => "EBADF",
            BUSY           = $cb!(BUSY,           EBUSY,           UV_EBUSY)           => "EBUSY",
            CANCELED       = $cb!(CANCELED,       ECANCELED,       UV_ECANCELED)       => "ECANCELED",
            CHARSET        = $cb!(CHARSET,        ECHARSET,        UV_ECHARSET)        => "ECHARSET",
            CONNABORTED    = $cb!(CONNABORTED,    ECONNABORTED,    UV_ECONNABORTED)    => "ECONNABORTED",
            CONNREFUSED    = $cb!(CONNREFUSED,    ECONNREFUSED,    UV_ECONNREFUSED)    => "ECONNREFUSED",
            CONNRESET      = $cb!(CONNRESET,      ECONNRESET,      UV_ECONNRESET)      => "ECONNRESET",
            DESTADDRREQ    = $cb!(DESTADDRREQ,    EDESTADDRREQ,    UV_EDESTADDRREQ)    => "EDESTADDRREQ",
            EXIST          = $cb!(EXIST,          EEXIST,          UV_EEXIST)          => "EEXIST",
            FAULT          = $cb!(FAULT,          EFAULT,          UV_EFAULT)          => "EFAULT",
            HOSTUNREACH    = $cb!(HOSTUNREACH,    EHOSTUNREACH,    UV_EHOSTUNREACH)    => "EHOSTUNREACH",
            INTR           = $cb!(INTR,           EINTR,           UV_EINTR)           => "EINTR",
            INVAL          = $cb!(INVAL,          EINVAL,          UV_EINVAL)          => "EINVAL",
            IO             = $cb!(IO,             EIO,             UV_EIO)             => "EIO",
            ISCONN         = $cb!(ISCONN,         EISCONN,         UV_EISCONN)         => "EISCONN",
            ISDIR          = $cb!(ISDIR,          EISDIR,          UV_EISDIR)          => "EISDIR",
            LOOP           = $cb!(LOOP,           ELOOP,           UV_ELOOP)           => "ELOOP",
            MFILE          = $cb!(MFILE,          EMFILE,          UV_EMFILE)          => "EMFILE",
            MSGSIZE        = $cb!(MSGSIZE,        EMSGSIZE,        UV_EMSGSIZE)        => "EMSGSIZE",
            NAMETOOLONG    = $cb!(NAMETOOLONG,    ENAMETOOLONG,    UV_ENAMETOOLONG)    => "ENAMETOOLONG",
            NETDOWN        = $cb!(NETDOWN,        ENETDOWN,        UV_ENETDOWN)        => "ENETDOWN",
            NETUNREACH     = $cb!(NETUNREACH,     ENETUNREACH,     UV_ENETUNREACH)     => "ENETUNREACH",
            NFILE          = $cb!(NFILE,          ENFILE,          UV_ENFILE)          => "ENFILE",
            NOBUFS         = $cb!(NOBUFS,         ENOBUFS,         UV_ENOBUFS)         => "ENOBUFS",
            NODEV          = $cb!(NODEV,          ENODEV,          UV_ENODEV)          => "ENODEV",
            NOENT          = $cb!(NOENT,          ENOENT,          UV_ENOENT)          => "ENOENT",
            NOMEM          = $cb!(NOMEM,          ENOMEM,          UV_ENOMEM)          => "ENOMEM",
            NONET          = $cb!(NONET,          ENONET,          UV_ENONET)          => "ENONET",
            NOSPC          = $cb!(NOSPC,          ENOSPC,          UV_ENOSPC)          => "ENOSPC",
            NOSYS          = $cb!(NOSYS,          ENOSYS,          UV_ENOSYS)          => "ENOSYS",
            NOTCONN        = $cb!(NOTCONN,        ENOTCONN,        UV_ENOTCONN)        => "ENOTCONN",
            NOTDIR         = $cb!(NOTDIR,         ENOTDIR,         UV_ENOTDIR)         => "ENOTDIR",
            NOTEMPTY       = $cb!(NOTEMPTY,       ENOTEMPTY,       UV_ENOTEMPTY)       => "ENOTEMPTY",
            NOTSOCK        = $cb!(NOTSOCK,        ENOTSOCK,        UV_ENOTSOCK)        => "ENOTSOCK",
            NOTSUP         = $cb!(NOTSUP,         ENOTSUP,         UV_ENOTSUP)         => "ENOTSUP",
            PERM           = $cb!(PERM,           EPERM,           UV_EPERM)           => "EPERM",
            PIPE           = $cb!(PIPE,           EPIPE,           UV_EPIPE)           => "EPIPE",
            PROTO          = $cb!(PROTO,          EPROTO,          UV_EPROTO)          => "EPROTO",
            PROTONOSUPPORT = $cb!(PROTONOSUPPORT, EPROTONOSUPPORT, UV_EPROTONOSUPPORT) => "EPROTONOSUPPORT",
            PROTOTYPE      = $cb!(PROTOTYPE,      EPROTOTYPE,      UV_EPROTOTYPE)      => "EPROTOTYPE",
            ROFS           = $cb!(ROFS,           EROFS,           UV_EROFS)           => "EROFS",
            SHUTDOWN       = $cb!(SHUTDOWN,       ESHUTDOWN,       UV_ESHUTDOWN)       => "ESHUTDOWN",
            SPIPE          = $cb!(SPIPE,          ESPIPE,          UV_ESPIPE)          => "ESPIPE",
            SRCH           = $cb!(SRCH,           ESRCH,           UV_ESRCH)           => "ESRCH",
            TIMEDOUT       = $cb!(TIMEDOUT,       ETIMEDOUT,       UV_ETIMEDOUT)       => "ETIMEDOUT",
            TXTBSY         = $cb!(TXTBSY,         ETXTBSY,         UV_ETXTBSY)         => "ETXTBSY",
            XDEV           = $cb!(XDEV,           EXDEV,           UV_EXDEV)           => "EXDEV",
            FBIG           = $cb!(FBIG,           EFBIG,           UV_EFBIG)           => "EFBIG",
            NOPROTOOPT     = $cb!(NOPROTOOPT,     ENOPROTOOPT,     UV_ENOPROTOOPT)     => "ENOPROTOOPT",
            RANGE          = $cb!(RANGE,          ERANGE,          UV_ERANGE)          => "ERANGE",
            NXIO           = $cb!(NXIO,           ENXIO,           UV_ENXIO)           => "ENXIO",
            MLINK          = $cb!(MLINK,          EMLINK,          UV_EMLINK)          => "EMLINK",
            HOSTDOWN       = $cb!(HOSTDOWN,       EHOSTDOWN,       UV_EHOSTDOWN)       => "EHOSTDOWN",
            REMOTEIO       = $cb!(REMOTEIO,       EREMOTEIO,       UV_EREMOTEIO)       => "EREMOTEIO",
            NOTTY          = $cb!(NOTTY,          ENOTTY,          UV_ENOTTY)          => "ENOTTY",
            FTYPE          = $cb!(FTYPE,          EFTYPE,          UV_EFTYPE)          => "EFTYPE",
            ILSEQ          = $cb!(ILSEQ,          EILSEQ,          UV_EILSEQ)          => "EILSEQ",
            OVERFLOW       = $cb!(OVERFLOW,       EOVERFLOW,       UV_EOVERFLOW)       => "EOVERFLOW",
            SOCKTNOSUPPORT = $cb!(SOCKTNOSUPPORT, ESOCKTNOSUPPORT, UV_ESOCKTNOSUPPORT) => "ESOCKTNOSUPPORT",
            NODATA         = $cb!(NODATA,         ENODATA,         UV_ENODATA)         => "ENODATA",
            UNATCH         = $cb!(UNATCH,         EUNATCH,         UV_EUNATCH)         => "EUNATCH",
            NOEXEC         = $cb!(NOEXEC,         ENOEXEC,         UV_ENOEXEC)         => "ENOEXEC",
        }
    };
}

#[cfg(target_os = "macos")]
pub mod darwin_errno;
#[cfg(target_os = "macos")]
pub use darwin_errno::*;
#[cfg(target_os = "freebsd")]
pub mod freebsd_errno;
#[cfg(target_os = "freebsd")]
pub use freebsd_errno::*;
// Android shares the Linux kernel errno space (bionic copies <asm/errno.h>),
// so it uses the same per-errno enum. Rust splits `target_os` into
// `linux`/`android` (Zig keeps both as `os.tag == .linux`), so list both.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod linux_errno;
#[cfg(any(target_os = "linux", target_os = "android"))]
pub use linux_errno::*;
#[cfg(windows)]
pub mod windows_errno;
#[cfg(windows)]
pub use windows_errno::{posix, *};

#[cfg(not(windows))]
#[allow(non_camel_case_types, non_snake_case)]
pub mod posix {
    /// glibc/musl/bionic `mode_t` == `unsigned int`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub type mode_t = u32;
    /// Darwin/FreeBSD `mode_t` == `__uint16_t` in `<sys/types.h>`.
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub type mode_t = u16;

    pub type E = crate::SystemErrno;

    pub use bun_core::S;

    /// Read the thread-local libc errno (Zig: `std.c._errno().*`).
    /// Canonical impl lives in `bun_core::ffi` (single target_os→symbol ladder).
    pub use bun_core::ffi::errno;
}

pub trait GetErrno: Copy {
    fn get_errno(self) -> E;
}

// Free-function shim mirroring Zig's `getErrno(rc)` call shape. POSIX-only:
// Windows defines its own divergent `get_errno<T>(_rc)` (no trait bound, reads
// GetLastError/WSAGetLastError) in windows_errno.rs.
#[cfg(not(windows))]
#[inline]
pub fn get_errno<T: GetErrno>(rc: T) -> E {
    rc.get_errno()
}

#[inline]
pub fn e_from_negated(errno: core::ffi::c_int) -> E {
    let n = errno.wrapping_neg();
    #[cfg(windows)]
    {
        u16::try_from(n)
            .ok()
            .and_then(E::try_from_raw)
            .unwrap_or(E::SUCCESS)
    }
    #[cfg(not(windows))]
    {
        SystemErrno::init(i64::from(n)).unwrap_or(SystemErrno::SUCCESS)
    }
}

impl SystemErrno {
    #[inline]
    pub const fn from_raw(n: u16) -> SystemErrno {
        // `as usize` on both sides papers over per-OS `MAX` typing (POSIX `u16`
        // vs Windows `usize`) without normalizing the constant itself.
        #[cfg(not(windows))]
        debug_assert!((n as usize) < (Self::MAX as usize));
        // SAFETY: caller guarantees `n` is a declared `#[repr(u16)]` discriminant
        // of `SystemErrno` (Zig `@enumFromInt` precondition). The enum is NOT
        // contiguous on Windows; do not assume `n < MAX` implies validity there.
        unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
    }
}

#[cfg(not(windows))]
impl SystemErrno {
    pub fn init(code: i64) -> Option<SystemErrno> {
        if code < 0 {
            if code <= -(Self::MAX as i64) {
                return None;
            }
            return Some(Self::from_raw((-code) as u16));
        }
        if code >= Self::MAX as i64 {
            return None;
        }
        Some(Self::from_raw(code as u16))
    }
}

impl bun_core::output::ErrName for SystemErrno {
    fn name(&self) -> &[u8] {
        <&'static str>::from(*self).as_bytes()
    }
}

/// Platform errno integer → its `SystemErrno` tag name.
/// `None` for `0` (SUCCESS), out-of-range, or (POSIX) non-positive input —
/// the contract bun_core's `Error::from_errno` / `coreutils_error_map` rely on.
#[inline]
pub(crate) fn system_errno_name(errno: i32) -> Option<&'static str> {
    #[cfg(not(windows))]
    {
        if errno <= 0 {
            return None;
        }
        SystemErrno::init(i64::from(errno)).map(<&'static str>::from)
    }
    #[cfg(windows)]
    {
        // Windows libuv errnos arrive negated; abs-normalise like the Zig
        // `errno_map[@abs(uv_code)]` lookup. `from_repr` (strum::FromRepr)
        // covers BOTH the dense 0..=137 range and the sparse UV_* tags.
        let n = errno.unsigned_abs();
        if n == 0 {
            return None;
        }
        u16::try_from(n)
            .ok()
            .and_then(SystemErrno::from_repr)
            .map(<&'static str>::from)
    }
}

#[inline]
pub(crate) const fn system_errno_max_dense() -> u32 {
    SystemErrno::MAX as u32
}

// Wire the above into bun_core's `ErrnoNames` hook. `()` owner — pure
// stateless functions; the handle is the const `ErrnoNames::SYS`.
bun_core::link_impl_ErrnoNames! {
    Sys for () => |_this| {
        name(errno) => system_errno_name(errno),
        max_dense() => system_errno_max_dense(),
    }
}

#[cfg(test)]
mod errno_name_tests {
    use super::*;
    use bun_core::{Error, coreutils_error_map};

    #[test]
    fn errno_mapping() {
        assert_eq!(Error::from_errno(2).name(), "ENOENT");
        assert_eq!(Error::from_errno(2), Error::intern("ENOENT"));
        assert_eq!(Error::from_errno(12), Error::intern("ENOMEM"));
        assert_eq!(Error::from_errno(0), Error::UNEXPECTED);
        assert_eq!(Error::from_errno(9999), Error::UNEXPECTED);
        // errno 11 is platform-specific: EAGAIN on linux/windows, EDEADLK on darwin/bsd.
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            windows,
            target_family = "wasm"
        ))]
        {
            assert_eq!(Error::from_errno(11), Error::intern("EAGAIN"));
            assert_eq!(Error::from_errno(104), Error::intern("ECONNRESET"));
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            assert_eq!(Error::from_errno(11), Error::intern("EDEADLK"));
            assert_eq!(Error::from_errno(35), Error::intern("EAGAIN"));
            assert_eq!(Error::from_errno(54), Error::intern("ECONNRESET"));
        }
    }

    /// Exhaustive: every dense slot in the per-platform enum round-trips through
    /// `system_errno_name → from_errno → name()` and matches the strum table,
    /// covering the full Zig `SystemErrno` range.
    #[test]
    fn errno_table_full_range() {
        // Slot 0 is the SUCCESS hole.
        assert_eq!(system_errno_name(0), None);
        let max = system_errno_max_dense();
        for i in 1..max {
            let name = system_errno_name(i as i32).expect("dense slot");
            assert_eq!(Error::from_errno(i as i32).name(), name, "slot {i}");
        }
        // One past the dense end → Unexpected.
        #[cfg(not(windows))]
        assert_eq!(Error::from_errno(max as i32), Error::UNEXPECTED);

        // Spot-check the last entry on each platform against the Zig source.
        #[cfg(any(target_os = "linux", target_os = "android", target_family = "wasm"))]
        assert_eq!(system_errno_name(133), Some("EHWPOISON"));
        #[cfg(windows)]
        {
            assert_eq!(system_errno_name(137), Some("EFTYPE"));
            // Sparse UV_* range round-trips (bun.zig errno_map covers 0..=4096).
            assert_eq!(Error::from_errno(-4058).name(), "UV_ENOENT");
            assert_eq!(Error::from_errno(-4092).name(), "UV_EACCES");
            assert_eq!(Error::from_errno(-4095).name(), "UV_EOF");
            assert_eq!(Error::from_errno(-3008).name(), "UV_EAI_NONAME");
            assert_eq!(system_errno_name(-4058), Some("UV_ENOENT"));
            assert_eq!(Error::from_errno(-5000), Error::UNEXPECTED);
        }
        #[cfg(target_os = "macos")]
        assert_eq!(system_errno_name(106), Some("EQFULL"));
        #[cfg(target_os = "freebsd")]
        assert_eq!(system_errno_name(97), Some("EINTEGRITY"));
    }

    #[test]
    fn coreutils_map() {
        assert_eq!(
            coreutils_error_map::get(2),
            Some("No such file or directory")
        );
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            windows,
            target_family = "wasm"
        ))]
        assert_eq!(
            coreutils_error_map::get(11),
            Some("Resource temporarily unavailable")
        );
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        assert_eq!(
            coreutils_error_map::get(11),
            Some("Resource deadlock avoided")
        );
        assert_eq!(coreutils_error_map::get(0), None);
    }
}
