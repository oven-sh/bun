//! `WriteConsoleW` output for the stdout / stderr console handles. Unlike
//! `WriteFile`, it does not depend on the console output codepage, which any
//! process on the same console can change (#43660).

use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};

use super::{BOOL, DWORD, HANDLE, Win32Error};
use crate::{Error, Fd, Maybe, Tag};

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

/// UTF-16 units per `WriteConsoleW` call. The scratch lives on the stack and
/// the crash handler reaches this function from an overflowed stack and from
/// a broken allocator, so it stays small and never goes to the heap.
const CHUNK_UNITS: usize = 1024;

/// Incomplete UTF-8 sequence left by the previous write to stdout (0) or
/// stderr (1), packed as `len | b0 << 8 | b1 << 16 | b2 << 24`.
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

fn write_chunk(fd: Fd, bytes: &[u8], utf16: &mut [u16]) -> Maybe<()> {
    let handle = fd.native();
    // One UTF-8 byte yields at most one UTF-16 unit, so it fits.
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
            return Err(Error::from_win32(Win32Error::get(), Tag::write).with_fd(fd));
        }
        if n == 0 {
            break;
        }
        written += n as usize;
    }
    Ok(())
}

/// `None`: `fd` is not the stdout / stderr console, or `WriteConsoleW` failed
/// before any byte was consumed, so the caller falls back to `WriteFile`.
/// `Some(Ok(n))`: `n` bytes consumed, an incomplete trailing sequence is held
/// in [`PENDING`] for the next write and counts as consumed.
pub(crate) fn write(fd: Fd, buf: &[u8]) -> Option<Maybe<usize>> {
    let slot = console_slot(fd)?;
    let pending = &PENDING[slot];
    let utf16 = &mut [0u16; CHUNK_UNITS];

    let mut consumed = 0usize;
    let mut head = [0u8; 4];
    let mut head_len = unpack(pending.swap(0, Ordering::Relaxed), &mut head);
    if head_len > 0 {
        let want = bun_core::strings::utf8_byte_sequence_length(head[0]) as usize;
        // Take continuation bytes only. Anything else means the held bytes
        // were not a sequence after all, so they go out now (as U+FFFD).
        while head_len < want && consumed < buf.len() && is_continuation(buf[consumed]) {
            head[head_len] = buf[consumed];
            head_len += 1;
            consumed += 1;
        }
        if head_len < want && consumed == buf.len() {
            pending.store(pack(&head[..head_len]), Ordering::Relaxed);
            return Some(Ok(buf.len()));
        }
        if let Err(err) = write_chunk(fd, &head[..head_len], utf16) {
            return Some(Err(err));
        }
    }

    let rest = &buf[consumed..];
    let tail_len = incomplete_tail_len(rest);
    let body = &rest[..rest.len() - tail_len];

    let mut off = 0usize;
    while off < body.len() {
        let mut end = (off + utf16.len()).min(body.len());
        if end < body.len() {
            // Back up to a lead byte so the cut does not split a sequence.
            let floor = end - 3;
            while end > floor && is_continuation(body[end]) {
                end -= 1;
            }
        }
        if let Err(err) = write_chunk(fd, &body[off..end], utf16) {
            if consumed + off > 0 {
                return Some(Ok(consumed + off));
            }
            return if head_len > 0 { Some(Err(err)) } else { None };
        }
        off = end;
    }

    if tail_len > 0 {
        pending.store(pack(&rest[rest.len() - tail_len..]), Ordering::Relaxed);
    }
    Some(Ok(buf.len()))
}
