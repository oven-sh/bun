//! `read()` for the process stdin while it is a console.
//!
//! `ReadFile` on a console handle is the ANSI console API: conhost converts the
//! typed UTF-16 through the console input code page, and for CP_UTF8 (which bun
//! selects at startup) the conhost shipped with Windows 10 / Server 2019 hands
//! back one garbage byte per non-ASCII character (oven-sh/bun#27556). Reading
//! with `ReadConsoleW` and transcoding here gives the REPL, `prompt()` and the
//! CLI prompts the UTF-8 they expect. Pipes and files never come through here,
//! so redirected stdin stays byte-exact.

use core::ffi::c_void;
use core::ptr;

use bun_core::strings;

use super::{BOOL, DWORD, ENABLE_LINE_INPUT, HANDLE, Win32Error, Win32ErrorExt as _, kernel32};
use crate::{Error, Fd, Maybe, Tag};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn ReadConsoleW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut u16,
        nNumberOfCharsToRead: DWORD,
        lpNumberOfCharsRead: &mut DWORD,
        pInputControl: *const c_void,
    ) -> BOOL;
}

const CTRL_Z: u16 = 0x1A;

/// UTF-16 units requested from the console per call. In line-input mode the
/// conhost of Windows 10 / Server 2019 stops accepting keystrokes once the line
/// fills the requested count, so this, not the caller's buffer, is the longest
/// line `prompt()` and friends accept; 8192 is what `bun -` used to pass to
/// `ReadFile`. Newer consoles hand out a longer line over several calls.
const UNITS_PER_READ: usize = 8192;
/// Slot 0 holds a high surrogate carried over from the previous chunk.
const UNITS_CAPACITY: usize = UNITS_PER_READ + 1;
/// Worst case is three bytes of UTF-8 per unit (a surrogate pair is four bytes
/// for two units, an unpaired surrogate becomes the three-byte U+FFFD).
const BYTES_CAPACITY: usize = 3 * UNITS_CAPACITY;

/// The most recent chunk from the console, transcoded, handed out over as many
/// `read()` calls as the caller needs (`alert()` and `confirm()` read one byte
/// at a time, `prompt()` 4 KiB at a time).
struct State {
    units: [u16; UNITS_CAPACITY],
    bytes: [u8; BYTES_CAPACITY],
    /// `bytes[start..end]` has not been handed out yet.
    start: usize,
    end: usize,
    /// High surrogate that ended the previous chunk; its low surrogate is the
    /// first unit of the next one. 0 when none.
    pending_lead: u16,
}

// Stdin is one stream per process. The lock is held across the blocking read:
// concurrent readers would have to take turns anyway.
static STATE: bun_core::Mutex<State> = bun_core::Mutex::new(State {
    units: [0; UNITS_CAPACITY],
    bytes: [0; BYTES_CAPACITY],
    start: 0,
    end: 0,
    pending_lead: 0,
});

/// `Some` when `fd` (the process stdin) is a console, `None` when it is a pipe
/// or file and the caller should `ReadFile` it as usual.
pub(crate) fn read(fd: Fd, buf: &mut [u8]) -> Option<Maybe<usize>> {
    let mut mode: DWORD = 0;
    if super::kernel32_2::GetConsoleMode(fd.native(), &mut mode) == 0 {
        return None;
    }
    if buf.is_empty() {
        return Some(Ok(0));
    }
    let line_input = mode & ENABLE_LINE_INPUT != 0;
    Some(STATE.lock().read(fd, line_input, buf))
}

impl State {
    fn read(&mut self, fd: Fd, line_input: bool, buf: &mut [u8]) -> Maybe<usize> {
        while self.start == self.end {
            if !self.refill(fd, line_input)? {
                return Ok(0);
            }
        }
        let n = (self.end - self.start).min(buf.len());
        buf[..n].copy_from_slice(&self.bytes[self.start..self.start + n]);
        self.start += n;
        Ok(n)
    }

    /// Reads the next chunk into `bytes`. `Ok(false)` is end of input. `Ok(true)`
    /// with nothing in `bytes` is possible (the chunk was a lone high surrogate)
    /// and means: read again.
    fn refill(&mut self, fd: Fd, line_input: bool) -> Maybe<bool> {
        let has_lead = self.pending_lead != 0;
        self.units[0] = core::mem::take(&mut self.pending_lead);
        let n = read_units(fd, &mut self.units[1..])?;
        let first = if has_lead { 0 } else { 1 };
        let mut end = 1 + n;
        if first == end {
            return Ok(false);
        }
        // Same as ReadFile: in line-input mode a line that starts with Ctrl+Z is
        // end of input and the rest of the line is dropped. A line-input read
        // returns exactly one line, so the chunk starts where the line does;
        // a carried-over surrogate means this chunk continues the previous one.
        if line_input && !has_lead && self.units[1] == CTRL_Z {
            return Ok(false);
        }
        // The low half of a pair that ends the chunk is still in the console;
        // at end of input (n == 0) there is nothing to wait for and the lone
        // surrogate becomes U+FFFD below.
        if n > 0 && strings::u16_is_lead(self.units[end - 1]) {
            end -= 1;
            self.pending_lead = self.units[end];
        }
        let r = strings::copy_utf16_into_utf8(&mut self.bytes, &self.units[first..end]);
        debug_assert_eq!(r.read as usize, end - first);
        self.start = 0;
        self.end = r.written as usize;
        Ok(true)
    }
}

fn read_units(fd: Fd, out: &mut [u16]) -> Maybe<usize> {
    loop {
        let mut n: DWORD = 0;
        kernel32::SetLastError(0);
        // SAFETY: `out` is valid for `out.len()` u16 writes for the duration of
        // the call and `n` outlives it; a null `pInputControl` is allowed.
        let ok = unsafe {
            ReadConsoleW(
                fd.native(),
                out.as_mut_ptr(),
                out.len() as DWORD,
                &mut n,
                ptr::null(),
            )
        };
        let err = Win32Error::get();
        // Ctrl+C / Ctrl+Break cancel the wait, reported either as a failure or
        // as a successful zero-length read; the ReadFile path retries as well.
        if err == Win32Error::OPERATION_ABORTED && (ok == 0 || n == 0) {
            continue;
        }
        if ok == 0 {
            return Err(Error::new(err.to_e(), Tag::read).with_fd(fd));
        }
        return Ok(n as usize);
    }
}
