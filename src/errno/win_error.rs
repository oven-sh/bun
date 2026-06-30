//! Operation-aware Windows error translation — the single egress surface for
//! converting Win32/WSA/NTSTATUS codes into `E`.
//!
//! Contract rules (see WINDOWS_QUIRKS_LEDGER.md):
//! - The general Win32→errno table lives in `bun_errno::SystemErrno::init_win32_error`
//!   and is kept row-for-row at libuv parity — it is ecosystem ABI, including its
//!   deliberately "wrong" rows (ACCESS_DENIED→EPERM). // quirk: HIST-33, HIST-34
//! - Direction-dependent codes get dedicated entry points here: one Win32 code
//!   can mean three different errnos depending on the operation
//!   (ERROR_BROKEN_PIPE: read=EOF, write=EPIPE; ERROR_NO_DATA: PIPE_NOWAIT
//!   would-block=EAGAIN, write=EPIPE). // quirk: HIST-35, FSIO-25
//! - Subsystems keep raw `Win32Error`/`NTSTATUS` values internally and translate
//!   exactly once at the boundary that produces an `E` — never translate twice,
//!   never store an `E` where a raw code is still needed. // quirk: SOCK-58

use bun_windows_sys::{NTSTATUS, Win32Error};

use crate::E;
use crate::Win32ErrorExt;

/// General translation (read-side semantics for direction-dependent codes).
/// Unmapped codes become `E::UNKNOWN`; callers that surface `UNKNOWN` to users
/// must keep the raw code in the message. // quirk: HIST-39
#[inline]
pub fn translate(code: Win32Error) -> E {
    code.to_e()
}

/// Write-completion translation: `ERROR_BROKEN_PIPE` and `ERROR_NO_DATA` mean
/// "the reader is gone" on a write, overriding their general (read-side)
/// meanings of EOF / would-block. Mirrors libuv's
/// `uv_translate_write_sys_error`. // quirk: HIST-35, FSIO-25
#[inline]
pub fn translate_write(code: Win32Error) -> E {
    match code {
        Win32Error::BROKEN_PIPE | Win32Error::NO_DATA => E::PIPE,
        _ => translate(code),
    }
}

/// Outcome classification for a failed read.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum ReadClass {
    /// The failure is a clean end-of-stream; report 0 bytes, not an error.
    Eof,
    Err(E),
}

/// Classify a failed stream/pipe read. `ERROR_BROKEN_PIPE` (writer exited) and
/// `ERROR_HANDLE_EOF` are clean EOF, never errors. // quirk: HIST-35
#[inline]
pub fn classify_read(code: Win32Error) -> ReadClass {
    match code {
        Win32Error::BROKEN_PIPE | Win32Error::HANDLE_EOF => ReadClass::Eof,
        _ => ReadClass::Err(translate(code)),
    }
}

/// `ReadFile`/`WriteFile` on a handle opened without the matching access right
/// fails with `ERROR_ACCESS_DENIED`; POSIX semantics for wrong-direction I/O on
/// an fd are EBADF, not EPERM. The remap must cover every sibling read/write
/// path or the test matrix splits (upstream shipped this fix twice).
/// // quirk: FSIO-24
#[inline]
fn is_wrong_direction(code: Win32Error) -> bool {
    code == Win32Error::ACCESS_DENIED
}

/// Classify a failed file-fd read: wrong-direction → EBADF, directory handle →
/// EISDIR, EOF codes → `Eof`, everything else through the general table.
/// // quirk: FSIO-24, HIST-36
#[inline]
pub fn classify_file_read(code: Win32Error) -> ReadClass {
    if is_wrong_direction(code) {
        return ReadClass::Err(E::BADF);
    }
    // ReadFile on a directory handle fails ERROR_INVALID_FUNCTION; per the
    // upstream commit's own hindsight the EISDIR meaning is applied at the
    // file read/write sites, where it is unambiguous. // quirk: HIST-36
    if code == Win32Error::INVALID_FUNCTION {
        return ReadClass::Err(E::ISDIR);
    }
    classify_read(code)
}

/// Translate a failed file-fd write: wrong-direction → EBADF, directory handle
/// → EISDIR, then the write-path table. // quirk: FSIO-24, HIST-36, FSIO-25
#[inline]
pub fn classify_file_write(code: Win32Error) -> E {
    if is_wrong_direction(code) {
        return E::BADF;
    }
    if code == Win32Error::INVALID_FUNCTION {
        return E::ISDIR;
    }
    translate_write(code)
}

// ───────────────────────────────────────────────────────────────────────────
// NTSTATUS plumbing
// ───────────────────────────────────────────────────────────────────────────

// Pure NTSTATUS↔Win32 algebra lives in tier-0 (`bun_iocp` consumes it without
// pulling this crate); re-exported here as part of the translation surface.
pub use bun_windows_sys::{ntstatus_from_win32, ntwin32_unwrap};

/// AFD/socket completions carry NTSTATUS, not WSA errors, and
/// `RtlNtStatusToDosError` loses winsock-specific distinctions. Hand-maintained
/// table at parity with libuv's `uv__ntstatus_to_winsock_error`
/// (src/win/winsock.c). // quirk: POLL-44, SOCK-05
pub fn ntstatus_to_winsock(status: NTSTATUS) -> Win32Error {
    use NTSTATUS as S;
    match status {
        S::SUCCESS => Win32Error::SUCCESS,
        S::PENDING => Win32Error::WSA_IO_PENDING,

        S::INVALID_HANDLE | S::OBJECT_TYPE_MISMATCH => Win32Error::WSAENOTSOCK,

        S::INSUFFICIENT_RESOURCES
        | S::PAGEFILE_QUOTA
        | S::COMMITMENT_LIMIT
        | S::WORKING_SET_QUOTA
        | S::NO_MEMORY
        | S::QUOTA_EXCEEDED
        | S::TOO_MANY_PAGING_FILES
        | S::REMOTE_RESOURCES => Win32Error::WSAENOBUFS,

        S::TOO_MANY_ADDRESSES | S::SHARING_VIOLATION | S::ADDRESS_ALREADY_EXISTS => {
            Win32Error::WSAEADDRINUSE
        }

        S::LINK_TIMEOUT | S::IO_TIMEOUT | S::TIMEOUT => Win32Error::WSAETIMEDOUT,

        S::GRACEFUL_DISCONNECT => Win32Error::WSAEDISCON,

        S::REMOTE_DISCONNECT
        | S::CONNECTION_RESET
        | S::LINK_FAILED
        | S::CONNECTION_DISCONNECTED
        | S::PORT_UNREACHABLE
        | S::HOPLIMIT_EXCEEDED => Win32Error::WSAECONNRESET,

        S::LOCAL_DISCONNECT | S::TRANSACTION_ABORTED | S::CONNECTION_ABORTED => {
            Win32Error::WSAECONNABORTED
        }

        S::BAD_NETWORK_PATH | S::NETWORK_UNREACHABLE | S::PROTOCOL_UNREACHABLE => {
            Win32Error::WSAENETUNREACH
        }

        S::HOST_UNREACHABLE => Win32Error::WSAEHOSTUNREACH,

        S::CANCELLED | S::REQUEST_ABORTED => Win32Error::WSAEINTR,

        S::BUFFER_OVERFLOW | S::INVALID_BUFFER_SIZE => Win32Error::WSAEMSGSIZE,

        S::BUFFER_TOO_SMALL | S::ACCESS_VIOLATION => Win32Error::WSAEFAULT,

        S::DEVICE_NOT_READY | S::REQUEST_NOT_ACCEPTED => Win32Error::WSAEWOULDBLOCK,

        S::INVALID_NETWORK_RESPONSE
        | S::NETWORK_BUSY
        | S::NO_SUCH_DEVICE
        | S::NO_SUCH_FILE
        | S::OBJECT_PATH_NOT_FOUND
        | S::OBJECT_NAME_NOT_FOUND
        | S::UNEXPECTED_NETWORK_ERROR => Win32Error::WSAENETDOWN,

        S::INVALID_CONNECTION => Win32Error::WSAENOTCONN,

        S::REMOTE_NOT_LISTENING | S::CONNECTION_REFUSED => Win32Error::WSAECONNREFUSED,

        S::PIPE_DISCONNECTED => Win32Error::WSAESHUTDOWN,

        S::CONFLICTING_ADDRESSES | S::INVALID_ADDRESS | S::INVALID_ADDRESS_COMPONENT => {
            Win32Error::WSAEADDRNOTAVAIL
        }

        S::NOT_SUPPORTED | S::NOT_IMPLEMENTED => Win32Error::WSAEOPNOTSUPP,

        S::ACCESS_DENIED => Win32Error::WSAEACCES,

        _ => match ntwin32_unwrap(status) {
            Some(code) => code,
            None => Win32Error::WSAEINVAL,
        },
    }
}

/// HRESULT → `E`. `HRESULT_CODE` recovers the embedded Win32 code only for
/// FACILITY_WIN32 HRESULTs; blindly extracting the low word of other
/// facilities produces a misleading small number, so non-WIN32 facilities map
/// to `UNKNOWN`. // quirk: HIST-70
#[inline]
pub fn hresult_to_e(hr: i32) -> E {
    const FACILITY_WIN32: u32 = 0x7;
    if hr >= 0 {
        return E::SUCCESS;
    }
    let hr = hr as u32;
    if (hr >> 16) & 0x1fff == FACILITY_WIN32 {
        translate(Win32Error((hr & 0xffff) as u16))
    } else {
        E::UNKNOWN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Known-answer test pinning the general table to libuv's
    /// `uv_translate_sys_error` (src/win/error.c), the ecosystem contract.
    /// Every row of the canonical table is asserted; a mapping change here is
    /// a breaking API change regardless of POSIX correctness.
    /// // quirk: HIST-33, HIST-34, HIST-37, HIST-38
    #[test]
    fn general_table_canonical() {
        use Win32Error as W;
        #[rustfmt::skip]
        let kat: &[(W, E)] = &[
            (W::WSAEACCES, E::ACCES), (W::ELEVATION_REQUIRED, E::ACCES),
            (W::CANT_ACCESS_FILE, E::ACCES),
            (W::ADDRESS_ALREADY_ASSOCIATED, E::ADDRINUSE), (W::WSAEADDRINUSE, E::ADDRINUSE),
            (W::WSAEADDRNOTAVAIL, E::ADDRNOTAVAIL),
            (W::WSAEAFNOSUPPORT, E::AFNOSUPPORT),
            (W::WSAEWOULDBLOCK, E::AGAIN), (W::NO_DATA, E::AGAIN),
            (W::WSAEALREADY, E::ALREADY),
            (W::INVALID_FLAGS, E::BADF), (W::INVALID_HANDLE, E::BADF),
            (W::LOCK_VIOLATION, E::BUSY), (W::PIPE_BUSY, E::BUSY), (W::SHARING_VIOLATION, E::BUSY),
            (W::OPERATION_ABORTED, E::CANCELED), (W::WSAEINTR, E::CANCELED),
            (W::NO_UNICODE_TRANSLATION, E::CHARSET),
            (W::CONNECTION_ABORTED, E::CONNABORTED), (W::WSAECONNABORTED, E::CONNABORTED),
            (W::CONNECTION_REFUSED, E::CONNREFUSED), (W::WSAECONNREFUSED, E::CONNREFUSED),
            (W::NETNAME_DELETED, E::CONNRESET), (W::WSAECONNRESET, E::CONNRESET),
            (W::ALREADY_EXISTS, E::EXIST), (W::FILE_EXISTS, E::EXIST),
            (W::NOACCESS, E::FAULT), (W::WSAEFAULT, E::FAULT),
            (W::HOST_UNREACHABLE, E::HOSTUNREACH), (W::WSAEHOSTUNREACH, E::HOSTUNREACH),
            (W::INSUFFICIENT_BUFFER, E::INVAL), (W::INVALID_DATA, E::INVAL),
            (W::INVALID_PARAMETER, E::INVAL), (W::SYMLINK_NOT_SUPPORTED, E::INVAL),
            (W::WSAEINVAL, E::INVAL), (W::WSAEPFNOSUPPORT, E::INVAL),
            (W::BEGINNING_OF_MEDIA, E::IO), (W::BUS_RESET, E::IO), (W::CRC, E::IO),
            (W::DEVICE_DOOR_OPEN, E::IO), (W::DEVICE_REQUIRES_CLEANING, E::IO),
            (W::DISK_CORRUPT, E::IO), (W::EOM_OVERFLOW, E::IO), (W::FILEMARK_DETECTED, E::IO),
            (W::GEN_FAILURE, E::IO), (W::INVALID_BLOCK_LENGTH, E::IO), (W::IO_DEVICE, E::IO),
            (W::NO_DATA_DETECTED, E::IO), (W::NO_SIGNAL_SENT, E::IO), (W::OPEN_FAILED, E::IO),
            (W::SETMARK_DETECTED, E::IO), (W::SIGNAL_REFUSED, E::IO),
            (W::WSAEISCONN, E::ISCONN),
            (W::INVALID_FUNCTION, E::ISDIR),
            (W::CANT_RESOLVE_FILENAME, E::LOOP),
            (W::TOO_MANY_OPEN_FILES, E::MFILE), (W::WSAEMFILE, E::MFILE),
            (W::WSAEMSGSIZE, E::MSGSIZE),
            (W::BUFFER_OVERFLOW, E::NAMETOOLONG), (W::FILENAME_EXCED_RANGE, E::NAMETOOLONG),
            (W::NETWORK_UNREACHABLE, E::NETUNREACH), (W::WSAENETUNREACH, E::NETUNREACH),
            (W::WSAENOBUFS, E::NOBUFS),
            (W::BAD_PATHNAME, E::NOENT), (W::DIRECTORY, E::NOENT),
            (W::ENVVAR_NOT_FOUND, E::NOENT), (W::FILE_NOT_FOUND, E::NOENT),
            (W::INVALID_NAME, E::NOENT), (W::INVALID_DRIVE, E::NOENT),
            (W::INVALID_REPARSE_DATA, E::NOENT), (W::MOD_NOT_FOUND, E::NOENT),
            (W::PATH_NOT_FOUND, E::NOENT), (W::WSAHOST_NOT_FOUND, E::NOENT),
            (W::WSANO_DATA, E::NOENT),
            (W::NOT_ENOUGH_MEMORY, E::NOMEM), (W::OUTOFMEMORY, E::NOMEM),
            (W::CANNOT_MAKE, E::NOSPC), (W::DISK_FULL, E::NOSPC), (W::EA_TABLE_FULL, E::NOSPC),
            (W::END_OF_MEDIA, E::NOSPC), (W::HANDLE_DISK_FULL, E::NOSPC),
            (W::NOT_CONNECTED, E::NOTCONN), (W::WSAENOTCONN, E::NOTCONN),
            (W::DIR_NOT_EMPTY, E::NOTEMPTY),
            (W::WSAENOTSOCK, E::NOTSOCK),
            (W::NOT_SUPPORTED, E::NOTSUP), (W::WSAEOPNOTSUPP, E::NOTSUP),
            (W::BROKEN_PIPE, E::EOF),
            (W::ACCESS_DENIED, E::PERM), (W::PRIVILEGE_NOT_HELD, E::PERM),
            (W::BAD_PIPE, E::PIPE), (W::PIPE_NOT_CONNECTED, E::PIPE), (W::WSAESHUTDOWN, E::PIPE),
            (W::WSAEPROTONOSUPPORT, E::PROTONOSUPPORT),
            (W::WRITE_PROTECT, E::ROFS),
            (W::SEM_TIMEOUT, E::TIMEDOUT), (W::WSAETIMEDOUT, E::TIMEDOUT),
            (W::NOT_SAME_DEVICE, E::XDEV),
            (W::META_EXPANSION_TOO_LONG, E::_2BIG),
            (W::WSAESOCKTNOSUPPORT, E::SOCKTNOSUPPORT),
            (W::BAD_EXE_FORMAT, E::FTYPE),
            // Current Win11's spelling of "not an executable". // quirk: PROC-58
            (W::EXE_MACHINE_TYPE_MISMATCH, E::FTYPE),
        ];
        for &(code, expected) in kat {
            assert_eq!(translate(code), expected, "Win32Error({})", code.0);
        }
        // Unmapped codes degrade to UNKNOWN, never to a reused errno.
        // quirk: HIST-39
        assert_eq!(translate(Win32Error::WSA_IO_PENDING), E::UNKNOWN);
        assert_eq!(translate(Win32Error(29999)), E::UNKNOWN);
    }

    #[test]
    fn write_table_overrides() {
        // quirk: HIST-35, FSIO-25
        assert_eq!(translate_write(Win32Error::BROKEN_PIPE), E::PIPE);
        assert_eq!(translate_write(Win32Error::NO_DATA), E::PIPE);
        // Everything else falls through to the general table.
        assert_eq!(translate_write(Win32Error::ACCESS_DENIED), E::PERM);
        assert_eq!(translate_write(Win32Error::NETNAME_DELETED), E::CONNRESET);
    }

    #[test]
    fn read_classification() {
        assert_eq!(classify_read(Win32Error::BROKEN_PIPE), ReadClass::Eof);
        assert_eq!(classify_read(Win32Error::HANDLE_EOF), ReadClass::Eof);
        assert_eq!(
            classify_read(Win32Error::NETNAME_DELETED),
            ReadClass::Err(E::CONNRESET)
        );
    }

    #[test]
    fn file_rw_direction_remaps() {
        // quirk: FSIO-24 — both directions, EBADF before any other meaning.
        assert_eq!(
            classify_file_read(Win32Error::ACCESS_DENIED),
            ReadClass::Err(E::BADF)
        );
        assert_eq!(classify_file_write(Win32Error::ACCESS_DENIED), E::BADF);
        // quirk: HIST-36 — directory handles.
        assert_eq!(
            classify_file_read(Win32Error::INVALID_FUNCTION),
            ReadClass::Err(E::ISDIR)
        );
        assert_eq!(classify_file_write(Win32Error::INVALID_FUNCTION), E::ISDIR);
        // EOF still classifies as EOF on the file path.
        assert_eq!(classify_file_read(Win32Error::HANDLE_EOF), ReadClass::Eof);
        assert_eq!(classify_file_write(Win32Error::BROKEN_PIPE), E::PIPE);
    }

    /// Known-answer test pinning `ntstatus_to_winsock` to libuv's
    /// `uv__ntstatus_to_winsock_error` (src/win/winsock.c:139-253), row for row.
    /// // quirk: POLL-44
    #[test]
    fn winsock_table_canonical() {
        use NTSTATUS as S;
        use Win32Error as W;
        #[rustfmt::skip]
        let kat: &[(S, W)] = &[
            (S::SUCCESS, W::SUCCESS),
            (S::PENDING, W::WSA_IO_PENDING),
            (S::INVALID_HANDLE, W::WSAENOTSOCK), (S::OBJECT_TYPE_MISMATCH, W::WSAENOTSOCK),
            (S::INSUFFICIENT_RESOURCES, W::WSAENOBUFS), (S::PAGEFILE_QUOTA, W::WSAENOBUFS),
            (S::COMMITMENT_LIMIT, W::WSAENOBUFS), (S::WORKING_SET_QUOTA, W::WSAENOBUFS),
            (S::NO_MEMORY, W::WSAENOBUFS), (S::QUOTA_EXCEEDED, W::WSAENOBUFS),
            (S::TOO_MANY_PAGING_FILES, W::WSAENOBUFS), (S::REMOTE_RESOURCES, W::WSAENOBUFS),
            (S::TOO_MANY_ADDRESSES, W::WSAEADDRINUSE), (S::SHARING_VIOLATION, W::WSAEADDRINUSE),
            (S::ADDRESS_ALREADY_EXISTS, W::WSAEADDRINUSE),
            (S::LINK_TIMEOUT, W::WSAETIMEDOUT), (S::IO_TIMEOUT, W::WSAETIMEDOUT),
            (S::TIMEOUT, W::WSAETIMEDOUT),
            (S::GRACEFUL_DISCONNECT, W::WSAEDISCON),
            (S::REMOTE_DISCONNECT, W::WSAECONNRESET), (S::CONNECTION_RESET, W::WSAECONNRESET),
            (S::LINK_FAILED, W::WSAECONNRESET), (S::CONNECTION_DISCONNECTED, W::WSAECONNRESET),
            (S::PORT_UNREACHABLE, W::WSAECONNRESET), (S::HOPLIMIT_EXCEEDED, W::WSAECONNRESET),
            (S::LOCAL_DISCONNECT, W::WSAECONNABORTED), (S::TRANSACTION_ABORTED, W::WSAECONNABORTED),
            (S::CONNECTION_ABORTED, W::WSAECONNABORTED),
            (S::BAD_NETWORK_PATH, W::WSAENETUNREACH), (S::NETWORK_UNREACHABLE, W::WSAENETUNREACH),
            (S::PROTOCOL_UNREACHABLE, W::WSAENETUNREACH),
            (S::HOST_UNREACHABLE, W::WSAEHOSTUNREACH),
            (S::CANCELLED, W::WSAEINTR), (S::REQUEST_ABORTED, W::WSAEINTR),
            (S::BUFFER_OVERFLOW, W::WSAEMSGSIZE), (S::INVALID_BUFFER_SIZE, W::WSAEMSGSIZE),
            (S::BUFFER_TOO_SMALL, W::WSAEFAULT), (S::ACCESS_VIOLATION, W::WSAEFAULT),
            (S::DEVICE_NOT_READY, W::WSAEWOULDBLOCK), (S::REQUEST_NOT_ACCEPTED, W::WSAEWOULDBLOCK),
            (S::INVALID_NETWORK_RESPONSE, W::WSAENETDOWN), (S::NETWORK_BUSY, W::WSAENETDOWN),
            (S::NO_SUCH_DEVICE, W::WSAENETDOWN), (S::NO_SUCH_FILE, W::WSAENETDOWN),
            (S::OBJECT_PATH_NOT_FOUND, W::WSAENETDOWN), (S::OBJECT_NAME_NOT_FOUND, W::WSAENETDOWN),
            (S::UNEXPECTED_NETWORK_ERROR, W::WSAENETDOWN),
            (S::INVALID_CONNECTION, W::WSAENOTCONN),
            (S::REMOTE_NOT_LISTENING, W::WSAECONNREFUSED), (S::CONNECTION_REFUSED, W::WSAECONNREFUSED),
            (S::PIPE_DISCONNECTED, W::WSAESHUTDOWN),
            (S::CONFLICTING_ADDRESSES, W::WSAEADDRNOTAVAIL), (S::INVALID_ADDRESS, W::WSAEADDRNOTAVAIL),
            (S::INVALID_ADDRESS_COMPONENT, W::WSAEADDRNOTAVAIL),
            (S::NOT_SUPPORTED, W::WSAEOPNOTSUPP), (S::NOT_IMPLEMENTED, W::WSAEOPNOTSUPP),
            (S::ACCESS_DENIED, W::WSAEACCES),
        ];
        for &(status, expected) in kat {
            assert_eq!(
                ntstatus_to_winsock(status),
                expected,
                "NTSTATUS({:#x})",
                status.0
            );
        }
        // Default clause: wrapped Win32 errors are unwrapped...
        assert_eq!(
            ntstatus_to_winsock(NTSTATUS(0xC007_0005)),
            Win32Error(5),
            "FACILITY_NTWIN32 + error severity unwraps to the embedded code"
        );
        assert_eq!(
            ntstatus_to_winsock(ntstatus_from_win32(Win32Error::WSAECONNRESET)),
            Win32Error::WSAECONNRESET,
        );
        // ...and a genuine NTSTATUS that is neither in the table nor wrapped
        // falls back to WSAEINVAL — never misclassified as a wrapped code
        // (upstream 0ded5d29). STATUS_DATATYPE_MISALIGNMENT: facility 0.
        assert_eq!(ntstatus_to_winsock(NTSTATUS(0x8000_0002)), Win32Error::WSAEINVAL);
    }

    /// Pure pin of the OS-49 formula: warning severity + FACILITY_NTWIN32 +
    /// code, i.e. `0x8007xxxx` — NOT the DDK macro's `0xC007xxxx`.
    #[test]
    fn ntstatus_from_win32_formula() {
        assert_eq!(ntstatus_from_win32(Win32Error::ACCESS_DENIED).0, 0x8007_0005);
        assert_eq!(ntstatus_from_win32(Win32Error::BROKEN_PIPE).0, 0x8007_006D);
        assert_eq!(ntstatus_from_win32(Win32Error::WSAECONNRESET).0, 0x8007_2746);
    }

    /// The warning-severity form (and only that form) round-trips through
    /// ntdll's own `RtlNtStatusToDosError`. // quirk: OS-49
    #[test]
    #[cfg_attr(miri, ignore)] // FFI: calls ntdll
    fn ntstatus_from_win32_roundtrips() {
        use bun_windows_sys::externs::RtlNtStatusToDosError;
        for code in [
            Win32Error::ACCESS_DENIED,
            Win32Error::BROKEN_PIPE,
            Win32Error::NO_DATA,
            Win32Error::OPERATION_ABORTED,
            Win32Error::WSAECONNRESET,
        ] {
            assert_eq!(
                RtlNtStatusToDosError(ntstatus_from_win32(code)),
                code.0 as u32,
                "Win32Error({})",
                code.0
            );
            assert_eq!(ntwin32_unwrap(ntstatus_from_win32(code)), Some(code));
        }
        // A real NTSTATUS is not unwrappable.
        assert_eq!(ntwin32_unwrap(NTSTATUS::ACCESS_DENIED), None);
    }

    #[test]
    fn hresult_facility_guard() {
        // quirk: HIST-70
        assert_eq!(hresult_to_e(0x8007_0005u32 as i32), E::PERM); // E_ACCESSDENIED
        assert_eq!(hresult_to_e(0x8007_0002u32 as i32), E::NOENT); // HRESULT_FROM_WIN32(FILE_NOT_FOUND)
        assert_eq!(hresult_to_e(0x8004_0154u32 as i32), E::UNKNOWN); // REGDB_E_CLASSNOTREG: facility 4
        assert_eq!(hresult_to_e(0), E::SUCCESS);
    }
}
