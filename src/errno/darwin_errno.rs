// posix types live in `crate::posix` (moved from bun_sys).
pub use crate::posix::mode_t as Mode;
pub use crate::posix::E;
pub use crate::posix::S;

// ──────────────────────────────────────────────────────────────────────────
// posix — MOVE_DOWN landing for std.posix.{mode_t,E,S} + std.c._errno()
//
// Ground truth: Zig `std.posix` (darwin) / `std.c` re-exports. Landed here so
// the errno crate stays leaf (T0) and bun_sys (T≥1) imports forward.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_snake_case)]
pub mod posix {
    use core::ffi::c_int;

    /// Darwin `mode_t` (`__uint16_t` in <sys/types.h>).
    pub type mode_t = u16;

    /// Kernel errno enum. Zig's `std.posix.E` and Bun's `SystemErrno` share the
    /// exact same discriminant space on Darwin; we alias rather than duplicate.
    /// TODO(port): Zig's `E` uses unprefixed variant names (`PERM`, `NOENT`);
    /// `SystemErrno` uses `EPERM`, `ENOENT`. Callers matching on `E::PERM` must
    /// migrate to `E::EPERM` (or this becomes a distinct enum in Phase B).
    pub type E = super::SystemErrno;

    /// `stat` mode-flag constants and predicates (Zig: `std.posix.S`).
    /// Values are POSIX-standard octal; identical across linux/darwin/freebsd.
    pub mod S {
        use super::mode_t;

        pub const IFMT:   mode_t = 0o170000;
        pub const IFSOCK: mode_t = 0o140000;
        pub const IFLNK:  mode_t = 0o120000;
        pub const IFREG:  mode_t = 0o100000;
        pub const IFBLK:  mode_t = 0o060000;
        pub const IFDIR:  mode_t = 0o040000;
        pub const IFCHR:  mode_t = 0o020000;
        pub const IFIFO:  mode_t = 0o010000;
        pub const IFWHT:  mode_t = 0o160000; // Darwin whiteout

        pub const ISUID: mode_t = 0o4000;
        pub const ISGID: mode_t = 0o2000;
        pub const ISVTX: mode_t = 0o1000;
        pub const IRWXU: mode_t = 0o0700;
        pub const IRUSR: mode_t = 0o0400;
        pub const IWUSR: mode_t = 0o0200;
        pub const IXUSR: mode_t = 0o0100;
        pub const IRWXG: mode_t = 0o0070;
        pub const IRGRP: mode_t = 0o0040;
        pub const IWGRP: mode_t = 0o0020;
        pub const IXGRP: mode_t = 0o0010;
        pub const IRWXO: mode_t = 0o0007;
        pub const IROTH: mode_t = 0o0004;
        pub const IWOTH: mode_t = 0o0002;
        pub const IXOTH: mode_t = 0o0001;

        // Predicates take `u32` (== `bun_core::Mode`) so cross-platform call
        // sites that normalize `st_mode as u32` compile uniformly. Darwin's
        // kernel `mode_t` is u16; the upper 16 bits are always zero.
        #[inline] pub const fn ISREG(m: u32)  -> bool { m & IFMT as u32 == IFREG as u32 }
        #[inline] pub const fn ISDIR(m: u32)  -> bool { m & IFMT as u32 == IFDIR as u32 }
        #[inline] pub const fn ISCHR(m: u32)  -> bool { m & IFMT as u32 == IFCHR as u32 }
        #[inline] pub const fn ISBLK(m: u32)  -> bool { m & IFMT as u32 == IFBLK as u32 }
        #[inline] pub const fn ISFIFO(m: u32) -> bool { m & IFMT as u32 == IFIFO as u32 }
        #[inline] pub const fn ISLNK(m: u32)  -> bool { m & IFMT as u32 == IFLNK as u32 }
        #[inline] pub const fn ISSOCK(m: u32) -> bool { m & IFMT as u32 == IFSOCK as u32 }
    }

    unsafe extern "C" {
        // Darwin libc: `int *__error(void)`
        fn __error() -> *mut c_int;
    }

    /// Read the thread-local libc errno (Zig: `std.c._errno().*`).
    #[inline]
    pub fn errno() -> c_int {
        // SAFETY: __error is guaranteed by libc to return a valid thread-local
        // pointer for the calling thread's lifetime.
        unsafe { *__error() }
    }
}

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, strum::IntoStaticStr, strum::EnumString, enum_map::Enum)]
pub enum SystemErrno {
    SUCCESS = 0,
    EPERM = 1,
    ENOENT = 2,
    ESRCH = 3,
    EINTR = 4,
    EIO = 5,
    ENXIO = 6,
    E2BIG = 7,
    ENOEXEC = 8,
    EBADF = 9,
    ECHILD = 10,
    EDEADLK = 11,
    ENOMEM = 12,
    EACCES = 13,
    EFAULT = 14,
    ENOTBLK = 15,
    EBUSY = 16,
    EEXIST = 17,
    EXDEV = 18,
    ENODEV = 19,
    ENOTDIR = 20,
    EISDIR = 21,
    EINVAL = 22,
    ENFILE = 23,
    EMFILE = 24,
    ENOTTY = 25,
    ETXTBSY = 26,
    EFBIG = 27,
    ENOSPC = 28,
    ESPIPE = 29,
    EROFS = 30,
    EMLINK = 31,
    EPIPE = 32,
    EDOM = 33,
    ERANGE = 34,
    EAGAIN = 35,
    EINPROGRESS = 36,
    EALREADY = 37,
    ENOTSOCK = 38,
    EDESTADDRREQ = 39,
    EMSGSIZE = 40,
    EPROTOTYPE = 41,
    ENOPROTOOPT = 42,
    EPROTONOSUPPORT = 43,
    ESOCKTNOSUPPORT = 44,
    ENOTSUP = 45,
    EPFNOSUPPORT = 46,
    EAFNOSUPPORT = 47,
    EADDRINUSE = 48,
    EADDRNOTAVAIL = 49,
    ENETDOWN = 50,
    ENETUNREACH = 51,
    ENETRESET = 52,
    ECONNABORTED = 53,
    ECONNRESET = 54,
    ENOBUFS = 55,
    EISCONN = 56,
    ENOTCONN = 57,
    ESHUTDOWN = 58,
    ETOOMANYREFS = 59,
    ETIMEDOUT = 60,
    ECONNREFUSED = 61,
    ELOOP = 62,
    ENAMETOOLONG = 63,
    EHOSTDOWN = 64,
    EHOSTUNREACH = 65,
    ENOTEMPTY = 66,
    EPROCLIM = 67,
    EUSERS = 68,
    EDQUOT = 69,
    ESTALE = 70,
    EREMOTE = 71,
    EBADRPC = 72,
    ERPCMISMATCH = 73,
    EPROGUNAVAIL = 74,
    EPROGMISMATCH = 75,
    EPROCUNAVAIL = 76,
    ENOLCK = 77,
    ENOSYS = 78,
    EFTYPE = 79,
    EAUTH = 80,
    ENEEDAUTH = 81,
    EPWROFF = 82,
    EDEVERR = 83,
    EOVERFLOW = 84,
    EBADEXEC = 85,
    EBADARCH = 86,
    ESHLIBVERS = 87,
    EBADMACHO = 88,
    ECANCELED = 89,
    EIDRM = 90,
    ENOMSG = 91,
    EILSEQ = 92,
    ENOATTR = 93,
    EBADMSG = 94,
    EMULTIHOP = 95,
    ENODATA = 96,
    ENOLINK = 97,
    ENOSR = 98,
    ENOSTR = 99,
    EPROTO = 100,
    ETIME = 101,
    EOPNOTSUPP = 102,
    ENOPOLICY = 103,
    ENOTRECOVERABLE = 104,
    EOWNERDEAD = 105,
    EQFULL = 106,
}

impl SystemErrno {
    pub const MAX: u16 = 107;

    #[inline]
    pub const fn from_raw(n: u16) -> SystemErrno {
        debug_assert!(n < Self::MAX);
        // SAFETY: caller guarantees n < MAX; #[repr(u16)] with contiguous
        // discriminants 0..107 (Darwin <sys/errno.h>).
        unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
    }

    // Signature matches linux_errno.rs so cross-platform call sites in
    // bun_sys/Error.rs (`init(self.errno as i64)`) compile uniformly.
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

#[allow(non_upper_case_globals)]
pub mod uv_e {
    use super::SystemErrno;

    // TODO(port): Zig name was @"2BIG" — Rust identifiers cannot start with a digit
    pub const _2BIG: i32 = SystemErrno::E2BIG as i32;
    pub const ACCES: i32 = SystemErrno::EACCES as i32;
    pub const ADDRINUSE: i32 = SystemErrno::EADDRINUSE as i32;
    pub const ADDRNOTAVAIL: i32 = SystemErrno::EADDRNOTAVAIL as i32;
    pub const AFNOSUPPORT: i32 = SystemErrno::EAFNOSUPPORT as i32;
    pub const AGAIN: i32 = SystemErrno::EAGAIN as i32;
    pub const ALREADY: i32 = SystemErrno::EALREADY as i32;
    pub const BADF: i32 = SystemErrno::EBADF as i32;
    pub const BUSY: i32 = SystemErrno::EBUSY as i32;
    pub const CANCELED: i32 = SystemErrno::ECANCELED as i32;
    // Darwin lacks ECHARSET; libuv uses synthetic UV__ECHARSET = -4080.
    // Zig: `-bun.windows.libuv.UV__ECHARSET` → 4080.
    pub const CHARSET: i32 = 4080;
    pub const CONNABORTED: i32 = SystemErrno::ECONNABORTED as i32;
    pub const CONNREFUSED: i32 = SystemErrno::ECONNREFUSED as i32;
    pub const CONNRESET: i32 = SystemErrno::ECONNRESET as i32;
    pub const DESTADDRREQ: i32 = SystemErrno::EDESTADDRREQ as i32;
    pub const EXIST: i32 = SystemErrno::EEXIST as i32;
    pub const FAULT: i32 = SystemErrno::EFAULT as i32;
    pub const HOSTUNREACH: i32 = SystemErrno::EHOSTUNREACH as i32;
    pub const INTR: i32 = SystemErrno::EINTR as i32;
    pub const INVAL: i32 = SystemErrno::EINVAL as i32;
    pub const IO: i32 = SystemErrno::EIO as i32;
    pub const ISCONN: i32 = SystemErrno::EISCONN as i32;
    pub const ISDIR: i32 = SystemErrno::EISDIR as i32;
    pub const LOOP: i32 = SystemErrno::ELOOP as i32;
    pub const MFILE: i32 = SystemErrno::EMFILE as i32;
    pub const MSGSIZE: i32 = SystemErrno::EMSGSIZE as i32;
    pub const NAMETOOLONG: i32 = SystemErrno::ENAMETOOLONG as i32;
    pub const NETDOWN: i32 = SystemErrno::ENETDOWN as i32;
    pub const NETUNREACH: i32 = SystemErrno::ENETUNREACH as i32;
    pub const NFILE: i32 = SystemErrno::ENFILE as i32;
    pub const NOBUFS: i32 = SystemErrno::ENOBUFS as i32;
    pub const NODEV: i32 = SystemErrno::ENODEV as i32;
    pub const NOENT: i32 = SystemErrno::ENOENT as i32;
    pub const NOMEM: i32 = SystemErrno::ENOMEM as i32;
    // Darwin lacks ENONET; libuv uses synthetic UV__ENONET = -4056.
    pub const NONET: i32 = 4056;
    pub const NOSPC: i32 = SystemErrno::ENOSPC as i32;
    pub const NOSYS: i32 = SystemErrno::ENOSYS as i32;
    pub const NOTCONN: i32 = SystemErrno::ENOTCONN as i32;
    pub const NOTDIR: i32 = SystemErrno::ENOTDIR as i32;
    pub const NOTEMPTY: i32 = SystemErrno::ENOTEMPTY as i32;
    pub const NOTSOCK: i32 = SystemErrno::ENOTSOCK as i32;
    pub const NOTSUP: i32 = SystemErrno::ENOTSUP as i32;
    pub const PERM: i32 = SystemErrno::EPERM as i32;
    pub const PIPE: i32 = SystemErrno::EPIPE as i32;
    pub const PROTO: i32 = SystemErrno::EPROTO as i32;
    pub const PROTONOSUPPORT: i32 = SystemErrno::EPROTONOSUPPORT as i32;
    pub const PROTOTYPE: i32 = SystemErrno::EPROTOTYPE as i32;
    pub const ROFS: i32 = SystemErrno::EROFS as i32;
    pub const SHUTDOWN: i32 = SystemErrno::ESHUTDOWN as i32;
    pub const SPIPE: i32 = SystemErrno::ESPIPE as i32;
    pub const SRCH: i32 = SystemErrno::ESRCH as i32;
    pub const TIMEDOUT: i32 = SystemErrno::ETIMEDOUT as i32;
    pub const TXTBSY: i32 = SystemErrno::ETXTBSY as i32;
    pub const XDEV: i32 = SystemErrno::EXDEV as i32;
    pub const FBIG: i32 = SystemErrno::EFBIG as i32;
    pub const NOPROTOOPT: i32 = SystemErrno::ENOPROTOOPT as i32;
    pub const RANGE: i32 = SystemErrno::ERANGE as i32;
    pub const NXIO: i32 = SystemErrno::ENXIO as i32;
    pub const MLINK: i32 = SystemErrno::EMLINK as i32;
    pub const HOSTDOWN: i32 = SystemErrno::EHOSTDOWN as i32;
    // Darwin lacks EREMOTEIO; libuv uses synthetic UV__EREMOTEIO = -4030.
    pub const REMOTEIO: i32 = 4030;
    pub const NOTTY: i32 = SystemErrno::ENOTTY as i32;
    pub const FTYPE: i32 = SystemErrno::EFTYPE as i32;
    pub const ILSEQ: i32 = SystemErrno::EILSEQ as i32;
    pub const OVERFLOW: i32 = SystemErrno::EOVERFLOW as i32;
    pub const SOCKTNOSUPPORT: i32 = SystemErrno::ESOCKTNOSUPPORT as i32;
    pub const NODATA: i32 = SystemErrno::ENODATA as i32;
    // Darwin lacks EUNATCH; libuv uses synthetic UV__EUNATCH = -4023.
    pub const UNATCH: i32 = 4023;
    pub const NOEXEC: i32 = SystemErrno::ENOEXEC as i32;
}

/// Zig's `getErrno(rc: anytype)` switches on `@TypeOf(rc)` to pick the errno
/// extraction strategy. Rust has no type-switch, so we model it as a trait with
/// per-type impls — call as `rc.get_errno()` or `get_errno(rc)`. Surface
/// matches `linux_errno::GetErrno` so `bun_sys` re-exports compile uniformly.
pub trait GetErrno: Copy {
    fn get_errno(self) -> E;
}

#[inline]
pub fn get_errno<T: GetErrno>(rc: T) -> E {
    rc.get_errno()
}

// On Darwin every libc wrapper returns a signed int sentinel (-1) and sets
// thread-local errno; there is no Linux-style raw-syscall `usize` errno-in-retval
// convention. We still impl `usize` for callers that uniformly cast.
impl GetErrno for usize {
    #[inline]
    fn get_errno(self) -> E {
        // Reinterpret as signed (Zig: @bitCast). Darwin syscalls never encode
        // errno in the return value, so only `-1` is the sentinel.
        if self as isize == -1 {
            // SAFETY: __error() returns a value in [0, MAX) per <sys/errno.h>.
            unsafe { core::mem::transmute::<u16, E>(crate::posix::errno() as u16) }
        } else {
            E::SUCCESS
        }
    }
}

macro_rules! impl_get_errno_libc {
    ($($t:ty),+ $(,)?) => {$(
        impl GetErrno for $t {
            #[inline]
            fn get_errno(self) -> E {
                // Zig `getErrno` compares with @bitCast semantics: an unsigned
                // sentinel of all-ones (e.g. 0xFFFF_FFFF_u32) must read errno.
                // `(-1i64 as $t as i64)` yields -1 for signed $t and the
                // zero-extended all-ones value for unsigned $t.
                if self as i64 == (-1i64 as $t as i64) {
                    // SAFETY: errno is always a valid E discriminant on Darwin
                    unsafe { core::mem::transmute::<u16, E>(crate::posix::errno() as u16) }
                } else {
                    E::SUCCESS
                }
            }
        }
    )+};
}
impl_get_errno_libc!(i32, u32, isize, i64);

// ported from: src/errno/darwin_errno.zig
