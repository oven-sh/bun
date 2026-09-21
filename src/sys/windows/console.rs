//! UTF-16 output to the console behind stdout / stderr.
//!
//! `WriteFile` on a console handle decodes the bytes with the console output
//! codepage at the moment of the call. That codepage is one value shared by
//! every process on the console, so it can change under us: in
//! `bun a | bun b`, `a` restores the codepage it saved at startup when it
//! exits, while `b` is still writing UTF-8 (#43660). `WriteConsoleW` takes
//! UTF-16 and does not depend on the codepage, which is also what Node (via
//! libuv's tty writer) does.
//!
//! Only the stdout / stderr handles that were consoles at startup take this
//! path. Everything else stays on `WriteFile`.

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use super::{BOOL, DWORD, HANDLE};
use crate::{Fd, Maybe};

mod kernel32 {
    use super::{BOOL, DWORD, HANDLE, c_void};
    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(super) fn WriteConsoleW(
            hConsoleOutput: HANDLE,
            lpBuffer: *const u16,
            nNumberOfCharsToWrite: DWORD,
            lpNumberOfCharsWritten: *mut DWORD,
            lpReserved: *mut c_void,
        ) -> BOOL;
    }
}

/// UTF-16 units per `WriteConsoleW` call. A console write larger than this
/// can fail with `ERROR_NOT_ENOUGH_MEMORY`; libuv uses the same cap.
const CHUNK_UNITS: usize = 8192;

/// The bytes of an incomplete UTF-8 sequence at the end of the previous write
/// to stdout (slot 0) or stderr (slot 1). A buffered writer flushes on a
/// fixed byte count and can split a character across two writes, so the head
/// of the next write completes it. Packed as `len | b0 << 8 | b1 << 16 |
/// b2 << 24`; 0 means nothing pending.
static PENDING: [AtomicU32; 2] = [AtomicU32::new(0), AtomicU32::new(0)];

fn pack(bytes: &[u8]) -> u32 {
    let mut packed = [0u8; 4];
    packed[0] = bytes.len() as u8;
    packed[1..1 + bytes.len()].copy_from_slice(bytes);
    u32::from_le_bytes(packed)
}

fn unpack(packed: u32, out: &mut [u8; 4]) -> usize {
    let bytes = packed.to_le_bytes();
    let len = bytes[0] as usize;
    out[..len].copy_from_slice(&bytes[1..1 + len]);
    len
}

fn is_continuation(b: u8) -> bool {
    b & 0xC0 == 0x80
}

/// Length of the incomplete multi-byte sequence at the end of `s`, or 0.
fn incomplete_tail_len(s: &[u8]) -> usize {
    let start = s.len().saturating_sub(3);
    let mut i = s.len();
    while i > start {
        i -= 1;
        if is_continuation(s[i]) {
            continue;
        }
        let want = bun_core::strings::utf8_byte_sequence_length(s[i]) as usize;
        let have = s.len() - i;
        return if want > have { have } else { 0 };
    }
    0
}

/// Slot in [`PENDING`] when `fd` is the stdout or stderr console handle.
fn console_slot(fd: Fd) -> Option<usize> {
    let handle = fd.native();
    if bun_core::output::is_stdout_tty() && handle == Fd::stdout().native() {
        return Some(0);
    }
    if bun_core::output::is_stderr_tty() && handle == Fd::stderr().native() {
        return Some(1);
    }
    None
}

/// Returns false when `WriteConsoleW` fails.
fn write_chunk(handle: HANDLE, bytes: &[u8], utf16: &mut [u16]) -> bool {
    // `bytes.len() <= utf16.len()` and one UTF-8 byte never yields more than
    // one UTF-16 unit, so the conversion always fits.
    let units = bun_core::strings::try_convert_utf8_to_utf16_in_buffer(utf16, bytes)
        .expect("console chunk fits its UTF-16 buffer");
    let mut written = 0usize;
    while written < units.len() {
        let mut n: DWORD = 0;
        // SAFETY: FFI; `handle` is a console handle, `units[written..]` is
        // valid for the given length, `n` is a valid out pointer.
        let rc = unsafe {
            kernel32::WriteConsoleW(
                handle,
                units.as_ptr().add(written),
                (units.len() - written) as DWORD,
                &mut n,
                core::ptr::null_mut(),
            )
        };
        if rc == 0 {
            return false;
        }
        if n == 0 {
            break;
        }
        written += n as usize;
    }
    true
}

/// Write `buf` to the console behind `fd` as UTF-16.
///
/// Returns `None` when `fd` is not the stdout / stderr console, or when
/// `WriteConsoleW` fails before any byte was consumed. The caller then falls
/// back to `WriteFile`, which reports the error if the handle is bad.
/// Otherwise returns the number of bytes consumed, which is `buf.len()` on
/// success: an incomplete trailing sequence is kept in [`PENDING`] and counts
/// as consumed.
pub(crate) fn write(fd: Fd, buf: &[u8]) -> Option<Maybe<usize>> {
    let slot = console_slot(fd)?;
    let handle = fd.native();
    let pending = &PENDING[slot];
    let mut utf16 = [0u16; CHUNK_UNITS];

    let mut consumed = 0usize;
    let mut head = [0u8; 4];
    let mut head_len = unpack(pending.swap(0, Ordering::Relaxed), &mut head);
    if head_len > 0 {
        let want = bun_core::strings::utf8_byte_sequence_length(head[0]) as usize;
        let take = want.saturating_sub(head_len).min(buf.len());
        head[head_len..head_len + take].copy_from_slice(&buf[..take]);
        head_len += take;
        consumed = take;
        if head_len < want {
            pending.store(pack(&head[..head_len]), Ordering::Relaxed);
            return Some(Ok(buf.len()));
        }
        if !write_chunk(handle, &head[..head_len], &mut utf16) {
            return None;
        }
    }

    let rest = &buf[consumed..];
    let tail_len = incomplete_tail_len(rest);
    let body = &rest[..rest.len() - tail_len];

    let mut off = 0usize;
    while off < body.len() {
        let mut end = (off + CHUNK_UNITS).min(body.len());
        if end < body.len() {
            // Do not cut a sequence in two: back up to its lead byte. Three
            // steps cover the longest sequence. Past that the bytes are
            // invalid anyway and become U+FFFD on either side of the cut.
            let floor = end - 3;
            while end > floor && is_continuation(body[end]) {
                end -= 1;
            }
        }
        if !write_chunk(handle, &body[off..end], &mut utf16) {
            if consumed + off == 0 {
                return None;
            }
            return Some(Ok(consumed + off));
        }
        off = end;
    }

    if tail_len > 0 {
        pending.store(pack(&rest[rest.len() - tail_len..]), Ordering::Relaxed);
    }
    Some(Ok(buf.len()))
}

/// [`write`] over a list of buffers. Stops at the first buffer that is not
/// fully consumed.
pub(crate) fn writev(fd: Fd, bufs: &[crate::PlatformIoVecConst]) -> Option<Maybe<usize>> {
    console_slot(fd)?;
    let mut total = 0usize;
    for buf in bufs {
        // SAFETY: the caller built each iovec from a live `&[u8]`.
        let bytes = unsafe { core::slice::from_raw_parts(buf.base, buf.len as usize) };
        if bytes.is_empty() {
            continue;
        }
        match write(fd, bytes) {
            Some(Ok(n)) => {
                total += n;
                if n < bytes.len() {
                    break;
                }
            }
            Some(Err(err)) => return Some(Err(err)),
            None => {
                if total == 0 {
                    return None;
                }
                break;
            }
        }
    }
    Some(Ok(total))
}
