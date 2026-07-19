/// Stamp out `impl Display + impl Error` for one or more
/// `strum::IntoStaticStr`-deriving error enums whose user-facing string is
/// exactly the variant tag. Replaces the
/// hand-rolled 5-line `f.write_str(<&'static str>::from(self))` boilerplate.
#[macro_export]
macro_rules! impl_tag_error {
    ($($t:ty),+ $(,)?) => {$(
        impl ::core::fmt::Display for $t {
            #[inline]
            fn fmt(&self, f: &mut ::core::fmt::Formatter<'_>) -> ::core::fmt::Result {
                f.write_str(<&'static str>::from(self))
            }
        }
        impl ::core::error::Error for $t {}
    )+};
}

// ─── coreutils_error_map ─────────────────────────────────────────────────
// The full typed EnumMap lives in `bun_sys::coreutils_error_map`; that crate
// is tier-above `bun_core`, so for `output.rs`'s integer-errno hot path we
// keep a parallel table here, keyed by `SystemErrno` *name* and resolved
// through the per-OS `ErrnoNames` hook — the same
// `errno → SystemErrno → message` composition, just without the
// cross-crate enum.
//
// Layout: one shared BASE table (the glibc/coreutils strings — used as-is on
// linux/android/windows/wasm) plus a small per-OS DELTA on macOS/FreeBSD that
// overrides divergent texts and adds OS-only errnos. Because lookup is gated
// by the per-OS `SystemErrno` name space, BASE rows for Linux-only errnos are
// unreachable on macOS/FreeBSD and harmless to keep — so the three full per-OS
// maps collapse to BASE + two ~40-row deltas with identical behavior.
pub mod coreutils_error_map {
    /// Returns the GNU-coreutils-style short label for an errno, if known.
    #[inline]
    pub fn get(errno: i32) -> Option<&'static str> {
        crate::ErrnoNames::SYS.name(errno).and_then(get_by_name)
    }

    /// Look up by `SystemErrno` variant name (e.g. `"ENOENT"`). Used by
    /// `bun_sys::coreutils_error_map` to populate its typed `EnumMap` without
    /// duplicating the per-OS string tables.
    #[inline]
    pub fn get_by_name(name: &str) -> Option<&'static str> {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        if let Some(s) = DELTA.get(name.as_bytes()) {
            return Some(*s);
        }
        BASE.get(name.as_bytes()).copied()
    }

    // The glibc/coreutils strerror() texts. Linux/Android/Windows/wasm use this
    // table verbatim; macOS/FreeBSD consult DELTA first then fall back here.
    crate::comptime_string_map! {
    static BASE: &'static str = {
        "EPERM" => "Operation not permitted",
        "ENOENT" => "No such file or directory",
        "ESRCH" => "No such process",
        "EINTR" => "Interrupted system call",
        "EIO" => "Input/output error",
        "ENXIO" => "No such device or address",
        "E2BIG" => "Argument list too long",
        "ENOEXEC" => "Exec format error",
        "EBADF" => "Bad file descriptor",
        "ECHILD" => "No child processes",
        "EAGAIN" => "Resource temporarily unavailable",
        "ENOMEM" => "Cannot allocate memory",
        "EACCES" => "Permission denied",
        "EFAULT" => "Bad address",
        "ENOTBLK" => "Block device required",
        "EBUSY" => "Device or resource busy",
        "EEXIST" => "File exists",
        "EXDEV" => "Invalid cross-device link",
        "ENODEV" => "No such device",
        "ENOTDIR" => "Not a directory",
        "EISDIR" => "Is a directory",
        "EINVAL" => "Invalid argument",
        "ENFILE" => "Too many open files in system",
        "EMFILE" => "Too many open files",
        "ENOTTY" => "Inappropriate ioctl for device",
        "ETXTBSY" => "Text file busy",
        "EFBIG" => "File too large",
        "ENOSPC" => "No space left on device",
        "ESPIPE" => "Illegal seek",
        "EROFS" => "Read-only file system",
        "EMLINK" => "Too many links",
        "EPIPE" => "Broken pipe",
        "EDOM" => "Numerical argument out of domain",
        "ERANGE" => "Numerical result out of range",
        "EDEADLK" => "Resource deadlock avoided",
        "ENAMETOOLONG" => "File name too long",
        "ENOLCK" => "No locks available",
        "ENOSYS" => "Function not implemented",
        "ENOTEMPTY" => "Directory not empty",
        "ELOOP" => "Too many levels of symbolic links",
        "ENOMSG" => "No message of desired type",
        "EIDRM" => "Identifier removed",
        "ECHRNG" => "Channel number out of range",
        "EL2NSYNC" => "Level 2 not synchronized",
        "EL3HLT" => "Level 3 halted",
        "EL3RST" => "Level 3 reset",
        "ELNRNG" => "Link number out of range",
        "EUNATCH" => "Protocol driver not attached",
        "ENOCSI" => "No CSI structure available",
        "EL2HLT" => "Level 2 halted",
        "EBADE" => "Invalid exchange",
        "EBADR" => "Invalid request descriptor",
        "EXFULL" => "Exchange full",
        "ENOANO" => "No anode",
        "EBADRQC" => "Invalid request code",
        "EBADSLT" => "Invalid slot",
        "EBFONT" => "Bad font file format",
        "ENOSTR" => "Device not a stream",
        "ENODATA" => "No data available",
        "ETIME" => "Timer expired",
        "ENOSR" => "Out of streams resources",
        "ENONET" => "Machine is not on the network",
        "ENOPKG" => "Package not installed",
        "EREMOTE" => "Object is remote",
        "ENOLINK" => "Link has been severed",
        "EADV" => "Advertise error",
        "ESRMNT" => "Srmount error",
        "ECOMM" => "Communication error on send",
        "EPROTO" => "Protocol error",
        "EMULTIHOP" => "Multihop attempted",
        "EDOTDOT" => "RFS specific error",
        "EBADMSG" => "Bad message",
        "EOVERFLOW" => "Value too large for defined data type",
        "ENOTUNIQ" => "Name not unique on network",
        "EBADFD" => "File descriptor in bad state",
        "EREMCHG" => "Remote address changed",
        "ELIBACC" => "Can not access a needed shared library",
        "ELIBBAD" => "Accessing a corrupted shared library",
        "ELIBSCN" => ".lib section in a.out corrupted",
        "ELIBMAX" => "Attempting to link in too many shared libraries",
        "ELIBEXEC" => "Cannot exec a shared library directly",
        "EILSEQ" => "Invalid or incomplete multibyte or wide character",
        "ERESTART" => "Interrupted system call should be restarted",
        "ESTRPIPE" => "Streams pipe error",
        "EUSERS" => "Too many users",
        "ENOTSOCK" => "Socket operation on non-socket",
        "EDESTADDRREQ" => "Destination address required",
        "EMSGSIZE" => "Message too long",
        "EPROTOTYPE" => "Protocol wrong type for socket",
        "ENOPROTOOPT" => "Protocol not available",
        "EPROTONOSUPPORT" => "Protocol not supported",
        "ESOCKTNOSUPPORT" => "Socket type not supported",
        "EOPNOTSUPP" => "Operation not supported",
        "EPFNOSUPPORT" => "Protocol family not supported",
        "EAFNOSUPPORT" => "Address family not supported by protocol",
        "EADDRINUSE" => "Address already in use",
        "EADDRNOTAVAIL" => "Cannot assign requested address",
        "ENETDOWN" => "Network is down",
        "ENETUNREACH" => "Network is unreachable",
        "ENETRESET" => "Network dropped connection on reset",
        "ECONNABORTED" => "Software caused connection abort",
        "ECONNRESET" => "Connection reset by peer",
        "ENOBUFS" => "No buffer space available",
        "EISCONN" => "Transport endpoint is already connected",
        "ENOTCONN" => "Transport endpoint is not connected",
        "ESHUTDOWN" => "Cannot send after transport endpoint shutdown",
        "ETOOMANYREFS" => "Too many references: cannot splice",
        "ETIMEDOUT" => "Connection timed out",
        "ECONNREFUSED" => "Connection refused",
        "EHOSTDOWN" => "Host is down",
        "EHOSTUNREACH" => "No route to host",
        "EALREADY" => "Operation already in progress",
        "EINPROGRESS" => "Operation now in progress",
        "ESTALE" => "Stale file handle",
        "EUCLEAN" => "Structure needs cleaning",
        "ENOTNAM" => "Not a XENIX named type file",
        "ENAVAIL" => "No XENIX semaphores available",
        "EISNAM" => "Is a named type file",
        "EREMOTEIO" => "Remote I/O error",
        "EDQUOT" => "Disk quota exceeded",
        "ENOMEDIUM" => "No medium found",
        "EMEDIUMTYPE" => "Wrong medium type",
        "ECANCELED" => "Operation canceled",
        "ENOKEY" => "Required key not available",
        "EKEYEXPIRED" => "Key has expired",
        "EKEYREVOKED" => "Key has been revoked",
        "EKEYREJECTED" => "Key was rejected by service",
        "EOWNERDEAD" => "Owner died",
        "ENOTRECOVERABLE" => "State not recoverable",
        "ERFKILL" => "Operation not possible due to RF-kill",
        "EHWPOISON" => "Memory page has hardware error",
    };
    }

    // macOS DELTA: overrides where Apple's strerror() text diverges from glibc,
    // plus macOS-only errnos (EBADARCH, EBADMACHO, EPWROFF, …).
    #[cfg(target_os = "macos")]
    crate::comptime_string_map! {
    static DELTA: &'static str = {
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EAGAIN" => "non-blocking and interrupt i/o. Resource temporarily unavailable",
        "EAUTH" => "Authentication error",
        "EBADARCH" => "Bad CPU type in executable",
        "EBADEXEC" => "Program loading errors. Bad executable",
        "EBADMACHO" => "Malformed Macho file",
        "EBADRPC" => "RPC struct is bad",
        "EBUSY" => "Device / Resource busy",
        "EDEVERR" => "Device error, for example paper out",
        "EDOM" => "math software. Numerical argument out of domain",
        "EDQUOT" => "Disc quota exceeded",
        "EEXIST" => "File or folder exists",
        "EFTYPE" => "Inappropriate file type or format",
        "EILSEQ" => "Illegal byte sequence",
        "EISCONN" => "Socket is already connected",
        "EMULTIHOP" => "Reserved",
        "ENEEDAUTH" => "Need authenticator",
        "ENETDOWN" => "ipc/network software - operational errors Network is down",
        "ENOATTR" => "Attribute not found",
        "ENODATA" => "No message available on STREAM",
        "ENODEV" => "Operation not supported by device",
        "ENOLINK" => "Reserved",
        "ENOMEM" => "Out of memory",
        "ENOPOLICY" => "No such policy registered",
        "ENOSR" => "No STREAM resources",
        "ENOSTR" => "Not a STREAM",
        "ENOTCONN" => "Socket is not connected",
        "ENOTSOCK" => "ipc/network software - argument errors. Socket operation on non-socket",
        "ENOTSUP" => "Operation not supported",
        "ENXIO" => "Device not configured",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "EOWNERDEAD" => "Previous owner died",
        "EPROCLIM" => "quotas & mush. Too many processes",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "EPWROFF" => "Intelligent device errors. Device power is off",
        "EQFULL" => "Interface output queue is full",
        "ERANGE" => "Result too large",
        "EREMOTE" => "Too many levels of remote in path",
        "ERPCMISMATCH" => "RPC version wrong",
        "ESHLIBVERS" => "Shared library version mismatch",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ESTALE" => "Network File System. Stale NFS file handle",
        "ETIME" => "STREAM ioctl timeout",
        "ETIMEDOUT" => "Operation timed out",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "EWOULDBLOCK" => "Operation would block",
        "EXDEV" => "Cross-device link",
    };
    }

    // FreeBSD DELTA: overrides where FreeBSD's errlst.c diverges from glibc,
    // plus FreeBSD-only errnos (EDOOFUS, ECAPMODE, ENOTCAPABLE, EINTEGRITY, …).
    #[cfg(target_os = "freebsd")]
    crate::comptime_string_map! {
    static DELTA: &'static str = {
        "EADDRNOTAVAIL" => "Can't assign requested address",
        "EAFNOSUPPORT" => "Address family not supported by protocol family",
        "EAUTH" => "Authentication error",
        "EBADRPC" => "RPC struct is bad",
        "EBUSY" => "Device busy",
        "ECAPMODE" => "Not permitted in capability mode",
        "EDOOFUS" => "Programming error",
        "EDQUOT" => "Disc quota exceeded",
        "EFTYPE" => "Inappropriate file type or format",
        "EILSEQ" => "Illegal byte sequence",
        "EINTEGRITY" => "Integrity check failed",
        "EISCONN" => "Socket is already connected",
        "ENEEDAUTH" => "Need authenticator",
        "ENOATTR" => "Attribute not found",
        "ENODEV" => "Operation not supported by device",
        "ENOTCAPABLE" => "Capabilities insufficient",
        "ENOTCONN" => "Socket is not connected",
        "ENXIO" => "Device not configured",
        "EOVERFLOW" => "Value too large to be stored in data type",
        "EOWNERDEAD" => "Previous owner died",
        "EPROCLIM" => "Too many processes",
        "EPROCUNAVAIL" => "Bad procedure for program",
        "EPROGMISMATCH" => "Program version wrong",
        "EPROGUNAVAIL" => "RPC prog. not avail",
        "ERANGE" => "Result too large",
        "EREMOTE" => "Too many levels of remote in path",
        "ERPCMISMATCH" => "RPC version wrong",
        "ESHUTDOWN" => "Can't send after socket shutdown",
        "ESTALE" => "Stale NFS file handle",
        "ETIMEDOUT" => "Operation timed out",
        "ETOOMANYREFS" => "Too many references: can't splice",
        "EXDEV" => "Cross-device link",
    };
    }
}

/// A plain ok/err union.
pub enum Result<T, E> {
    Ok(T),
    Err(E),
}

impl<T, E> Result<T, E> {
    #[inline]
    pub fn as_err(&self) -> Option<&E> {
        if let Result::Err(e) = self {
            return Some(e);
        }
        None
    }
}
