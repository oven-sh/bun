//! `UV_E*` error numbers (`uv/errno.h`, Windows values).
//!
//! These are what Node reports in `err.errno` on Windows and what
//! `process.binding("uv")` / `util.getSystemErrorMap()` expose on every
//! platform, so the values are fixed.

use core::ffi::c_int;

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
pub const UV_UNKNOWN: c_int = -4094;
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

/// `(UV_E*, E discriminant)` for every `UV_E*` that folds to a plain `E`.
#[cfg(windows)]
macro_rules! __uv_to_e {
    (@rows $([$id:tt, $e:tt, $uv:tt, $display:tt])+) => {
        static UV_TO_E: &[(c_int, u16)] = &[
            $( ($uv, crate::SystemErrno::$e as u16), )+
            (UV_EOF, crate::SystemErrno::EOF as u16),
            (UV_UNKNOWN, crate::SystemErrno::EUNKNOWN as u16),
        ];
    };
}
#[cfg(windows)]
crate::__uv_e_rows!(@each __uv_to_e);

/// `E::UV_EAI_*` discriminants are `(-UV_EAI_*) as u16`: the magnitude is the discriminant.
#[cfg(windows)]
#[inline]
const fn is_eai_magnitude(n: c_int) -> bool {
    matches!(n, 3000..=3011 | 3013 | 3014)
}

/// A negative `UV_E*` number → the `E` discriminant (`UV_ENOENT (-4058)` → `2`).
/// `None` for a number the table does not list.
#[cfg(windows)]
#[inline]
pub fn uv_err_to_e_discriminant(code: c_int) -> Option<u16> {
    let magnitude = code.wrapping_neg();
    if is_eai_magnitude(magnitude) {
        return Some(magnitude as u16);
    }
    UV_TO_E.iter().find(|row| row.0 == code).map(|row| row.1)
}

/// An `E` discriminant → the negative `UV_E*` number Node reports in
/// `err.errno` on Windows (`2` → `UV_ENOENT (-4058)`). `None` for a
/// discriminant the table does not list.
#[cfg(windows)]
#[inline]
pub fn e_discriminant_to_uv(discriminant: u16) -> Option<c_int> {
    if is_eai_magnitude(c_int::from(discriminant)) {
        return Some(-c_int::from(discriminant));
    }
    UV_TO_E
        .iter()
        .find(|row| row.1 == discriminant)
        .map(|row| row.0)
}
