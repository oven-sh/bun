//! Node-visible uv errno protocol numbers. JS sees these in `err.errno`
//! (e.g. ENOENT = -4058 on Windows), so the NUMBERS are ABI — they survive
//! the libuv removal as pure protocol constants, owned here.

#![allow(dead_code)] // rows are consumed via macros; not every const has a direct use

use core::ffi::c_int;

pub const UV_UNKNOWN: c_int = -4094;

pub const UV_E2BIG: c_int = -4093;
pub const UV_EACCES: c_int = -4092;
pub const UV_EADDRINUSE: c_int = -4091;
pub const UV_EADDRNOTAVAIL: c_int = -4090;
pub const UV_EAFNOSUPPORT: c_int = -4089;
pub const UV_EAGAIN: c_int = -4088;
pub const UV_EAI_ADDRFAMILY: c_int = -3000;
pub const UV_EAI_AGAIN: c_int = -3001;
pub const UV_EAI_BADFLAGS: c_int = -3002;
pub const UV_EAI_BADHINTS: c_int = -3013;
pub const UV_EAI_CANCELED: c_int = -3003;
pub const UV_EAI_FAIL: c_int = -3004;
pub const UV_EAI_FAMILY: c_int = -3005;
pub const UV_EAI_MEMORY: c_int = -3006;
pub const UV_EAI_NODATA: c_int = -3007;
pub const UV_EAI_NONAME: c_int = -3008;
pub const UV_EAI_OVERFLOW: c_int = -3009;
pub const UV_EAI_PROTOCOL: c_int = -3014;
pub const UV_EAI_SERVICE: c_int = -3010;
pub const UV_EAI_SOCKTYPE: c_int = -3011;
pub const UV_EALREADY: c_int = -4084;
pub const UV_EBADF: c_int = -4083;
pub const UV_EBUSY: c_int = -4082;
pub const UV_ECANCELED: c_int = -4081;
pub const UV_ECHARSET: c_int = -4080;
pub const UV_ECONNABORTED: c_int = -4079;
pub const UV_ECONNREFUSED: c_int = -4078;
pub const UV_ECONNRESET: c_int = -4077;
pub const UV_EDESTADDRREQ: c_int = -4076;
pub const UV_EEXIST: c_int = -4075;
pub const UV_EFAULT: c_int = -4074;
pub const UV_EFBIG: c_int = -4036;
pub const UV_EHOSTUNREACH: c_int = -4073;
pub const UV_EINTR: c_int = -4072;
pub const UV_EINVAL: c_int = -4071;
pub const UV_EIO: c_int = -4070;
pub const UV_EISCONN: c_int = -4069;
pub const UV_EISDIR: c_int = -4068;
pub const UV_ELOOP: c_int = -4067;
pub const UV_EMFILE: c_int = -4066;
pub const UV_EMSGSIZE: c_int = -4065;
pub const UV_ENAMETOOLONG: c_int = -4064;
pub const UV_ENETDOWN: c_int = -4063;
pub const UV_ENETUNREACH: c_int = -4062;
pub const UV_ENFILE: c_int = -4061;
pub const UV_ENOBUFS: c_int = -4060;
pub const UV_ENODEV: c_int = -4059;
pub const UV_ENOENT: c_int = -4058;
pub const UV_ENOMEM: c_int = -4057;
pub const UV_ENONET: c_int = -4056;
pub const UV_ENOPROTOOPT: c_int = -4035;
pub const UV_ENOSPC: c_int = -4055;
pub const UV_ENOSYS: c_int = -4054;
pub const UV_ENOTCONN: c_int = -4053;
pub const UV_ENOTDIR: c_int = -4052;
pub const UV_ENOTEMPTY: c_int = -4051;
pub const UV_ENOTSOCK: c_int = -4050;
pub const UV_ENOTSUP: c_int = -4049;
pub const UV_EOVERFLOW: c_int = -4026;
pub const UV_EPERM: c_int = -4048;
pub const UV_EPIPE: c_int = -4047;
pub const UV_EPROTO: c_int = -4046;
pub const UV_EPROTONOSUPPORT: c_int = -4045;
pub const UV_EPROTOTYPE: c_int = -4044;
pub const UV_ERANGE: c_int = -4034;
pub const UV_EROFS: c_int = -4043;
pub const UV_ESHUTDOWN: c_int = -4042;
pub const UV_ESPIPE: c_int = -4041;
pub const UV_ESRCH: c_int = -4040;
pub const UV_ETIMEDOUT: c_int = -4039;
pub const UV_ETXTBSY: c_int = -4038;
pub const UV_EXDEV: c_int = -4037;
pub const UV_EOF: c_int = -4095;
pub const UV_ENXIO: c_int = -4033;
pub const UV_EMLINK: c_int = -4032;
pub const UV_EHOSTDOWN: c_int = -4031;
pub const UV_EREMOTEIO: c_int = -4030;
pub const UV_ENOTTY: c_int = -4029;
pub const UV_EFTYPE: c_int = -4028;
pub const UV_EILSEQ: c_int = -4027;
pub const UV_ESOCKTNOSUPPORT: c_int = -4025;
pub const UV_ENODATA: c_int = -4024;
pub const UV_EUNATCH: c_int = -4023;
pub const UV_ENOEXEC: c_int = -4022;
pub const UV_ERRNO_MAX: c_int = -4096;

/// `bun_errno::E` discriminant (e.g. `UV_ENOENT (-4058)` → `2`).
///
/// Layering forbids depending on `bun_errno` here, so
/// the integer discriminants are inlined; they are ABI-stable POSIX values
/// plus a fixed Bun-assigned tail (`UNKNOWN=134`..`FTYPE=137`). Unmapped
/// codes return `None`.
///
/// Keep in sync with `bun_errno::E` (src/errno/windows_errno.rs).
#[inline]
pub const fn uv_err_to_e_discriminant(code: c_int) -> Option<u16> {
    Some(match code {
        UV_EPERM => 1,            // E::PERM
        UV_ENOENT => 2,           // E::NOENT
        UV_ESRCH => 3,            // E::SRCH
        UV_EINTR => 4,            // E::INTR
        UV_EIO => 5,              // E::IO
        UV_ENXIO => 6,            // E::NXIO
        UV_E2BIG => 7,            // E::_2BIG
        UV_ENOEXEC => 8,          // E::NOEXEC
        UV_EBADF => 9,            // E::BADF
        UV_EAGAIN => 11,          // E::AGAIN
        UV_ENOMEM => 12,          // E::NOMEM
        UV_EACCES => 13,          // E::ACCES
        UV_EFAULT => 14,          // E::FAULT
        UV_EBUSY => 16,           // E::BUSY
        UV_EEXIST => 17,          // E::EXIST
        UV_EXDEV => 18,           // E::XDEV
        UV_ENODEV => 19,          // E::NODEV
        UV_ENOTDIR => 20,         // E::NOTDIR
        UV_EISDIR => 21,          // E::ISDIR
        UV_EINVAL => 22,          // E::INVAL
        UV_ENFILE => 23,          // E::NFILE
        UV_EMFILE => 24,          // E::MFILE
        UV_ENOTTY => 25,          // E::NOTTY
        UV_EFTYPE => 137,         // E::FTYPE
        UV_ETXTBSY => 26,         // E::TXTBSY
        UV_EFBIG => 27,           // E::FBIG
        UV_ENOSPC => 28,          // E::NOSPC
        UV_ESPIPE => 29,          // E::SPIPE
        UV_EROFS => 30,           // E::ROFS
        UV_EMLINK => 31,          // E::MLINK
        UV_EPIPE => 32,           // E::PIPE
        UV_ERANGE => 34,          // E::RANGE
        UV_ENAMETOOLONG => 36,    // E::NAMETOOLONG
        UV_ENOSYS => 38,          // E::NOSYS
        UV_ENOTEMPTY => 39,       // E::NOTEMPTY
        UV_ELOOP => 40,           // E::LOOP
        UV_EUNATCH => 49,         // E::UNATCH
        UV_ENODATA => 61,         // E::NODATA
        UV_ENONET => 64,          // E::NONET
        UV_EPROTO => 71,          // E::PROTO
        UV_EOVERFLOW => 75,       // E::OVERFLOW
        UV_EILSEQ => 84,          // E::ILSEQ
        UV_ENOTSOCK => 88,        // E::NOTSOCK
        UV_EDESTADDRREQ => 89,    // E::DESTADDRREQ
        UV_EMSGSIZE => 90,        // E::MSGSIZE
        UV_EPROTOTYPE => 91,      // E::PROTOTYPE
        UV_ENOPROTOOPT => 92,     // E::NOPROTOOPT
        UV_EPROTONOSUPPORT => 93, // E::PROTONOSUPPORT
        UV_ESOCKTNOSUPPORT => 94, // E::SOCKTNOSUPPORT
        UV_ENOTSUP => 95,         // E::NOTSUP
        UV_EAFNOSUPPORT => 97,    // E::AFNOSUPPORT
        UV_EADDRINUSE => 98,      // E::ADDRINUSE
        UV_EADDRNOTAVAIL => 99,   // E::ADDRNOTAVAIL
        UV_ENETDOWN => 100,       // E::NETDOWN
        UV_ENETUNREACH => 101,    // E::NETUNREACH
        UV_ECONNABORTED => 103,   // E::CONNABORTED
        UV_ECONNRESET => 104,     // E::CONNRESET
        UV_ENOBUFS => 105,        // E::NOBUFS
        UV_EISCONN => 106,        // E::ISCONN
        UV_ENOTCONN => 107,       // E::NOTCONN
        UV_ESHUTDOWN => 108,      // E::SHUTDOWN
        UV_ETIMEDOUT => 110,      // E::TIMEDOUT
        UV_ECONNREFUSED => 111,   // E::CONNREFUSED
        UV_EHOSTDOWN => 112,      // E::HOSTDOWN
        UV_EHOSTUNREACH => 113,   // E::HOSTUNREACH
        UV_EALREADY => 114,       // E::ALREADY
        UV_EREMOTEIO => 121,      // E::REMOTEIO
        UV_ECANCELED => 125,      // E::CANCELED
        UV_ECHARSET => 135,       // E::CHARSET
        UV_EOF => 136,            // E::EOF
        UV_UNKNOWN => 134,        // E::UNKNOWN
        // EAI_* codes — `bun_errno::E::UV_EAI_*` discriminants are defined as
        // `(-UV_EAI_*) as u16`, i.e. the raw magnitude is the discriminant.
        UV_EAI_ADDRFAMILY => (-UV_EAI_ADDRFAMILY) as u16,
        UV_EAI_AGAIN => (-UV_EAI_AGAIN) as u16,
        UV_EAI_BADFLAGS => (-UV_EAI_BADFLAGS) as u16,
        UV_EAI_BADHINTS => (-UV_EAI_BADHINTS) as u16,
        UV_EAI_CANCELED => (-UV_EAI_CANCELED) as u16,
        UV_EAI_FAIL => (-UV_EAI_FAIL) as u16,
        UV_EAI_FAMILY => (-UV_EAI_FAMILY) as u16,
        UV_EAI_MEMORY => (-UV_EAI_MEMORY) as u16,
        UV_EAI_NODATA => (-UV_EAI_NODATA) as u16,
        UV_EAI_NONAME => (-UV_EAI_NONAME) as u16,
        UV_EAI_OVERFLOW => (-UV_EAI_OVERFLOW) as u16,
        UV_EAI_PROTOCOL => (-UV_EAI_PROTOCOL) as u16,
        UV_EAI_SERVICE => (-UV_EAI_SERVICE) as u16,
        UV_EAI_SOCKTYPE => (-UV_EAI_SOCKTYPE) as u16,
        _ => return None,
    })
}
