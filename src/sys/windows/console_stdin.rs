//! `read()` for the process stdin while it is a console: `ReadConsoleW` plus UTF-8
//! transcoding. `ReadFile` on a console converts through the input code page, and
//! conhost's conversion to the UTF-8 code page bun selects returns one garbage byte
//! per non-ASCII character (oven-sh/bun#27556). Pipes and files never come here.

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
const LF: u16 = b'\n' as u16;

/// Per `ReadConsoleW` call. In line-input mode this is also the longest line the user
/// can type: the Windows 10 / Server 2019 conhost ignores keystrokes beyond it (newer
/// consoles return a longer line over several calls). `bun -` passed 8192 to `ReadFile`.
const UNITS_PER_READ: usize = 8192;
/// Slot 0 holds a high surrogate carried over from the previous chunk.
const UNITS_CAPACITY: usize = UNITS_PER_READ + 1;
/// UTF-8 is at most three bytes per UTF-16 unit (a pair is four bytes for two units).
const BYTES_CAPACITY: usize = 3 * UNITS_CAPACITY;

/// The latest chunk from the console, transcoded; `read()` hands it out piecemeal.
struct State {
    units: [u16; UNITS_CAPACITY],
    bytes: [u8; BYTES_CAPACITY],
    /// `bytes[start..end]` has not been handed out yet.
    start: usize,
    end: usize,
    /// High surrogate that ended the previous chunk, to be paired with the next one's first unit.
    pending_lead: u16,
    /// The previous line-input chunk did not end its line (the line was longer than a
    /// chunk), so the next chunk continues that line instead of starting one.
    mid_line: bool,
}

// Locked across the blocking read: readers of the one stdin have to take turns anyway.
static STATE: bun_core::Mutex<State> = bun_core::Mutex::new(State {
    units: [0; UNITS_CAPACITY],
    bytes: [0; BYTES_CAPACITY],
    start: 0,
    end: 0,
    pending_lead: 0,
    mid_line: false,
});

/// `None` when `fd` is not a console (pipes and files stay on the `ReadFile` path).
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

    /// `Ok(false)` is end of input; `Ok(true)` can leave `bytes` empty (lone high surrogate).
    fn refill(&mut self, fd: Fd, line_input: bool) -> Maybe<bool> {
        let has_lead = self.pending_lead != 0;
        self.units[0] = self.pending_lead;
        let n = read_units(fd, &mut self.units[1..])?;
        self.pending_lead = 0;
        let continues_line = self.mid_line;
        self.mid_line = line_input && n > 0 && self.units[n] != LF;
        let first = if has_lead { 0 } else { 1 };
        let mut end = 1 + n;
        if first == end {
            return Ok(false);
        }
        // Like ReadFile: a line-input line that starts with Ctrl+Z is end of input, and dropped.
        if line_input && n > 0 && !continues_line && self.units[1] == CTRL_Z {
            return Ok(false);
        }
        // A trailing high surrogate's other half is still in the console, unless this is EOF.
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
        // Ctrl+C / Ctrl+Break surface as a failure or an empty success; retried like ReadFile.
        if err == Win32Error::OPERATION_ABORTED && (ok == 0 || n == 0) {
            continue;
        }
        if ok == 0 {
            return Err(Error::new(err.to_e(), Tag::read).with_fd(fd));
        }
        return Ok(n as usize);
    }
}
