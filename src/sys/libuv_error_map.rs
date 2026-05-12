use enum_map::{Enum, EnumMap};

use crate::SystemErrno;

/// This map is derived off of uv.h's definitions, and is what Node.js uses in printing errors.
//
// PORT NOTE: Zig builds this at comptime via a labeled block + `@hasField`/`@field` reflection
// over `SystemErrno` (whose variant set differs per target OS). Rust has no comptime enum-variant
// reflection, so the per-OS `@hasField` filter is expressed as `#[cfg]` guards on the few entries
// whose variants are not present on every target. The `EAI_*` and `UNKNOWN` rows from uv.h are
// dropped: no `SystemErrno` on any target carries them, so Zig's `@hasField` skipped them too.
//
// Built at const-eval time so the whole `[&str; N]` payload lives in `.rodata` with no `Once`
// guard or init code on the startup path (matches Zig `std.EnumArray` comptime init).
pub static LIBUV_ERROR_MAP: EnumMap<SystemErrno, &'static str> = build_libuv_error_map();

const fn build_libuv_error_map() -> EnumMap<SystemErrno, &'static str> {
    // std.EnumMap(SystemErrno, [:0]const u8).initFull("unknown error")
    //
    // Indexing relies on `SystemErrno`'s dense `0..N` discriminants matching the `enum_map::Enum`
    // declaration-order index for every variant referenced below (true on all four targets — see
    // `bun_errno::*_errno`). The Windows `UV_*` tail variants are never written here; their slots
    // keep the "unknown error" fill.
    let mut arr: [&str; <SystemErrno as Enum>::LENGTH] =
        ["unknown error"; <SystemErrno as Enum>::LENGTH];

    arr[SystemErrno::E2BIG as usize] = "argument list too long";
    arr[SystemErrno::EACCES as usize] = "permission denied";
    arr[SystemErrno::EADDRINUSE as usize] = "address already in use";
    arr[SystemErrno::EADDRNOTAVAIL as usize] = "address not available";
    arr[SystemErrno::EAFNOSUPPORT as usize] = "address family not supported";
    arr[SystemErrno::EAGAIN as usize] = "resource temporarily unavailable";
    arr[SystemErrno::EALREADY as usize] = "connection already in progress";
    arr[SystemErrno::EBADF as usize] = "bad file descriptor";
    arr[SystemErrno::EBUSY as usize] = "resource busy or locked";
    arr[SystemErrno::ECANCELED as usize] = "operation canceled";
    #[cfg(windows)]
    {
        arr[SystemErrno::ECHARSET as usize] = "invalid Unicode character";
    }
    arr[SystemErrno::ECONNABORTED as usize] = "software caused connection abort";
    arr[SystemErrno::ECONNREFUSED as usize] = "connection refused";
    arr[SystemErrno::ECONNRESET as usize] = "connection reset by peer";
    arr[SystemErrno::EDESTADDRREQ as usize] = "destination address required";
    arr[SystemErrno::EEXIST as usize] = "file already exists";
    arr[SystemErrno::EFAULT as usize] = "bad address in system call argument";
    arr[SystemErrno::EFBIG as usize] = "file too large";
    arr[SystemErrno::EHOSTUNREACH as usize] = "host is unreachable";
    arr[SystemErrno::EINTR as usize] = "interrupted system call";
    arr[SystemErrno::EINVAL as usize] = "invalid argument";
    arr[SystemErrno::EIO as usize] = "i/o error";
    arr[SystemErrno::EISCONN as usize] = "socket is already connected";
    arr[SystemErrno::EISDIR as usize] = "illegal operation on a directory";
    arr[SystemErrno::ELOOP as usize] = "too many symbolic links encountered";
    arr[SystemErrno::EMFILE as usize] = "too many open files";
    arr[SystemErrno::EMSGSIZE as usize] = "message too long";
    arr[SystemErrno::ENAMETOOLONG as usize] = "name too long";
    arr[SystemErrno::ENETDOWN as usize] = "network is down";
    arr[SystemErrno::ENETUNREACH as usize] = "network is unreachable";
    arr[SystemErrno::ENFILE as usize] = "file table overflow";
    arr[SystemErrno::ENOBUFS as usize] = "no buffer space available";
    arr[SystemErrno::ENODEV as usize] = "no such device";
    arr[SystemErrno::ENOENT as usize] = "no such file or directory";
    arr[SystemErrno::ENOMEM as usize] = "not enough memory";
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        arr[SystemErrno::ENONET as usize] = "machine is not on the network";
    }
    arr[SystemErrno::ENOPROTOOPT as usize] = "protocol not available";
    arr[SystemErrno::ENOSPC as usize] = "no space left on device";
    arr[SystemErrno::ENOSYS as usize] = "function not implemented";
    arr[SystemErrno::ENOTCONN as usize] = "socket is not connected";
    arr[SystemErrno::ENOTDIR as usize] = "not a directory";
    arr[SystemErrno::ENOTEMPTY as usize] = "directory not empty";
    arr[SystemErrno::ENOTSOCK as usize] = "socket operation on non-socket";
    // FreeBSD has no real `ENOTSUP` variant (it aliases `EOPNOTSUPP` via an associated const);
    // Zig's `@hasField` skipped it there, so match that.
    #[cfg(not(target_os = "freebsd"))]
    {
        arr[SystemErrno::ENOTSUP as usize] = "operation not supported on socket";
    }
    arr[SystemErrno::EOVERFLOW as usize] = "value too large for defined data type";
    arr[SystemErrno::EPERM as usize] = "operation not permitted";
    arr[SystemErrno::EPIPE as usize] = "broken pipe";
    arr[SystemErrno::EPROTO as usize] = "protocol error";
    arr[SystemErrno::EPROTONOSUPPORT as usize] = "protocol not supported";
    arr[SystemErrno::EPROTOTYPE as usize] = "protocol wrong type for socket";
    arr[SystemErrno::ERANGE as usize] = "result too large";
    arr[SystemErrno::EROFS as usize] = "read-only file system";
    arr[SystemErrno::ESHUTDOWN as usize] = "cannot send after transport endpoint shutdown";
    arr[SystemErrno::ESPIPE as usize] = "invalid seek";
    arr[SystemErrno::ESRCH as usize] = "no such process";
    arr[SystemErrno::ETIMEDOUT as usize] = "connection timed out";
    arr[SystemErrno::ETXTBSY as usize] = "text file is busy";
    arr[SystemErrno::EXDEV as usize] = "cross-device link not permitted";
    #[cfg(windows)]
    {
        arr[SystemErrno::EOF as usize] = "end of file";
    }
    arr[SystemErrno::ENXIO as usize] = "no such device or address";
    arr[SystemErrno::EMLINK as usize] = "too many links";
    arr[SystemErrno::EHOSTDOWN as usize] = "host is down";
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        arr[SystemErrno::EREMOTEIO as usize] = "remote I/O error";
    }
    arr[SystemErrno::ENOTTY as usize] = "inappropriate ioctl for device";
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        arr[SystemErrno::EFTYPE as usize] = "inappropriate file type or format";
    }
    arr[SystemErrno::EILSEQ as usize] = "illegal byte sequence";
    arr[SystemErrno::ESOCKTNOSUPPORT as usize] = "socket type not supported";
    #[cfg(not(target_os = "freebsd"))]
    {
        arr[SystemErrno::ENODATA as usize] = "no data available";
    }
    #[cfg(any(target_os = "linux", target_os = "android", windows))]
    {
        arr[SystemErrno::EUNATCH as usize] = "protocol driver not attached";
    }

    EnumMap::from_array(arr)
}

#[cfg(test)]
#[test]
fn enoent_label() {
    // Validates the `discriminant == enum_map index` invariant the const builder relies on.
    assert_eq!(
        LIBUV_ERROR_MAP[SystemErrno::ENOENT],
        "no such file or directory"
    );
    assert_eq!(
        LIBUV_ERROR_MAP[SystemErrno::ETIMEDOUT],
        "connection timed out"
    );
}

// ported from: src/sys/libuv_error_map.zig
