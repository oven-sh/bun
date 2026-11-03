//! The Windows console as a terminal descriptor: input a [`FilePoll`] can wait for and read as UTF-8, output that takes UTF-8.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ops::Range;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use bun_core::tty::Mode;
use bun_core::{Output, strings, zstr};
use bun_errno::uv_codes::{UV_EINVAL, UV_UNKNOWN};
use bun_sys::windows::kernel32::{
    CancelIoEx, CreateEventW, GetConsoleMode, SetConsoleMode, SetEvent, SetLastError,
    WaitForMultipleObjects,
};
use bun_sys::windows::{
    self, BOOL, CloseHandle, DISABLE_NEWLINE_AUTO_RETURN, DWORD, ENABLE_LINE_INPUT,
    ENABLE_PROCESSED_OUTPUT, ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING,
    HANDLE, INVALID_HANDLE_VALUE, Win32Error,
};
use bun_sys::{self as sys, Fd};
use bun_threading::Guarded;

use crate::FilePoll;

#[allow(non_snake_case)]
mod win32 {
    use super::*;

    pub(crate) const KEY_EVENT: u16 = 0x0001;
    pub(crate) const WINDOW_BUFFER_SIZE_EVENT: u16 = 0x0004;

    pub(crate) const VK_CLEAR: u16 = 0x0C;
    pub(crate) const VK_SHIFT: u16 = 0x10;
    pub(crate) const VK_MENU: u16 = 0x12;
    pub(crate) const VK_CAPITAL: u16 = 0x14;
    pub(crate) const VK_SPACE: u16 = 0x20;
    pub(crate) const VK_PRIOR: u16 = 0x21;
    pub(crate) const VK_NEXT: u16 = 0x22;
    pub(crate) const VK_END: u16 = 0x23;
    pub(crate) const VK_HOME: u16 = 0x24;
    pub(crate) const VK_LEFT: u16 = 0x25;
    pub(crate) const VK_UP: u16 = 0x26;
    pub(crate) const VK_RIGHT: u16 = 0x27;
    pub(crate) const VK_DOWN: u16 = 0x28;
    pub(crate) const VK_INSERT: u16 = 0x2D;
    pub(crate) const VK_DELETE: u16 = 0x2E;
    pub(crate) const VK_NUMPAD0: u16 = 0x60;
    pub(crate) const VK_NUMPAD1: u16 = 0x61;
    pub(crate) const VK_NUMPAD2: u16 = 0x62;
    pub(crate) const VK_NUMPAD3: u16 = 0x63;
    pub(crate) const VK_NUMPAD4: u16 = 0x64;
    pub(crate) const VK_NUMPAD5: u16 = 0x65;
    pub(crate) const VK_NUMPAD6: u16 = 0x66;
    pub(crate) const VK_NUMPAD7: u16 = 0x67;
    pub(crate) const VK_NUMPAD8: u16 = 0x68;
    pub(crate) const VK_NUMPAD9: u16 = 0x69;
    pub(crate) const VK_DECIMAL: u16 = 0x6E;
    pub(crate) const VK_F1: u16 = 0x70;
    pub(crate) const VK_F2: u16 = 0x71;
    pub(crate) const VK_F3: u16 = 0x72;
    pub(crate) const VK_F4: u16 = 0x73;
    pub(crate) const VK_F5: u16 = 0x74;
    pub(crate) const VK_F6: u16 = 0x75;
    pub(crate) const VK_F7: u16 = 0x76;
    pub(crate) const VK_F8: u16 = 0x77;
    pub(crate) const VK_F9: u16 = 0x78;
    pub(crate) const VK_F10: u16 = 0x79;
    pub(crate) const VK_F11: u16 = 0x7A;
    pub(crate) const VK_F12: u16 = 0x7B;
    pub(crate) const VK_NUMLOCK: u16 = 0x90;
    pub(crate) const VK_SCROLL: u16 = 0x91;
    pub(crate) const VK_LSHIFT: u16 = 0xA0;
    pub(crate) const VK_RMENU: u16 = 0xA5;

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub(crate) struct KEY_EVENT_RECORD {
        pub bKeyDown: BOOL,
        pub wRepeatCount: u16,
        pub wVirtualKeyCode: u16,
        pub wVirtualScanCode: u16,
        pub UnicodeChar: u16,
        pub dwControlKeyState: DWORD,
    }

    /// The key event is the largest member of the union, and the only one read here.
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub(crate) struct INPUT_RECORD {
        pub EventType: u16,
        pub KeyEvent: KEY_EVENT_RECORD,
    }
    const _: () = assert!(size_of::<INPUT_RECORD>() == 20);
    bun_core::impl_zeroable!(INPUT_RECORD);

    pub(crate) const RIGHT_ALT_PRESSED: DWORD = 0x0001;
    pub(crate) const LEFT_ALT_PRESSED: DWORD = 0x0002;
    pub(crate) const RIGHT_CTRL_PRESSED: DWORD = 0x0004;
    pub(crate) const LEFT_CTRL_PRESSED: DWORD = 0x0008;
    pub(crate) const SHIFT_PRESSED: DWORD = 0x0010;
    pub(crate) const ENHANCED_KEY: DWORD = 0x0100;

    pub(crate) const ENABLE_WINDOW_INPUT: DWORD = 0x0008;

    pub(crate) const CONSOLE_READ_NOREMOVE: u16 = 0x0001;
    pub(crate) const CONSOLE_READ_NOWAIT: u16 = 0x0002;
    /// Documented, and exported by kernel32 since Windows 7, but in no import library.
    pub(crate) type ReadConsoleInputExW = unsafe extern "system" fn(
        input: HANDLE,
        records: *mut INPUT_RECORD,
        length: DWORD,
        read: *mut DWORD,
        flags: u16,
    ) -> BOOL;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(crate) safe fn ResetEvent(event: HANDLE) -> BOOL;
        pub(crate) safe fn SwitchToThread() -> BOOL;
        pub(crate) safe fn Sleep(milliseconds: DWORD);
        pub(crate) safe fn GetNumberOfConsoleInputEvents(input: HANDLE, count: &mut DWORD) -> BOOL;
        pub(crate) fn ReadConsoleW(
            input: HANDLE,
            buffer: *mut u16,
            units: DWORD,
            read: *mut DWORD,
            control: *const c_void,
        ) -> BOOL;
        pub(crate) fn WriteConsoleW(
            output: HANDLE,
            buffer: *const u16,
            units: DWORD,
            written: *mut DWORD,
            reserved: *mut c_void,
        ) -> BOOL;
        pub(crate) fn MultiByteToWideChar(
            code_page: u32,
            flags: DWORD,
            bytes: *const u8,
            bytes_len: c_int,
            units: *mut u16,
            units_len: c_int,
        ) -> c_int;
    }
}
use win32::*;

fn is_console_input(handle: HANDLE) -> bool {
    let mut count: DWORD = 0;
    GetNumberOfConsoleInputEvents(handle, &mut count) != 0
}

fn get_console_mode(console: HANDLE, mode: &mut DWORD) -> bool {
    // SAFETY: `mode` is a valid out-param, and a bad handle is reported as an error.
    unsafe { GetConsoleMode(console, ptr::from_mut(mode)) != 0 }
}

fn set_console_mode(console: HANDLE, mode: DWORD) -> bool {
    // SAFETY: both arguments are passed by value, and a bad handle is reported as an error.
    unsafe { SetConsoleMode(console, mode) != 0 }
}

/// A handle to the console's input that nothing else has.
fn open_input() -> Result<HANDLE, Win32Error> {
    open(bun_core::wstr!("CONIN$"))
}

/// `CONIN$` or `CONOUT$`, NUL-terminated: the console of this process, whatever its standard handles are.
fn open(name: &[u16]) -> Result<HANDLE, Win32Error> {
    // SAFETY: the name is NUL-terminated, and the null arguments are optional.
    let handle = unsafe {
        windows::CreateFileW(
            name.as_ptr(),
            windows::GENERIC_READ | windows::GENERIC_WRITE,
            windows::FILE_SHARE_READ | windows::FILE_SHARE_WRITE,
            ptr::null_mut(),
            windows::OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    Ok(handle)
}

fn create_event(manual_reset: bool) -> HANDLE {
    // SAFETY: the null arguments are optional.
    let event = unsafe { CreateEventW(ptr::null_mut(), manual_reset as BOOL, 0, ptr::null()) };
    if event.is_null() {
        bun_core::out_of_memory();
    }
    event
}

// ── Input ──

/// [`set_mode`] made the console raw, and has not made it cooked since.
static MADE_RAW: AtomicBool = AtomicBool::new(false);

/// Any process on the console can change its mode (cmd.exe turns line input on), so as in libuv who asked for raw stays raw.
fn is_raw(input: HANDLE) -> Result<bool, Win32Error> {
    if MADE_RAW.load(Ordering::Relaxed) {
        return Ok(true);
    }
    let mut mode: DWORD = 0;
    if !get_console_mode(input, &mut mode) {
        return Err(Win32Error::get());
    }
    Ok(mode & ENABLE_LINE_INPUT == 0)
}

thread_local! {
    /// Every [`Reader`] of this thread, for [`set_mode`].
    static READERS: Cell<*mut Reader> = const { Cell::new(ptr::null_mut()) };
}

/// The input side of a [`FilePoll`] on a console.
pub struct Reader {
    input: HANDLE,
    poll: *mut FilePoll,
    next: *mut Reader,
    /// Between [`Reader::start`] and [`Reader::stop`].
    started: bool,
    /// UTF-8 that [`Reader::read`] has yet to hand out, from `consumed` on.
    pending: Vec<u8>,
    consumed: usize,
    /// Taken from the console. Those in `unread` have yet to be looked at.
    records: Box<[INPUT_RECORD; 256]>,
    unread: Range<usize>,
    /// What the key that was looked at last sends, and how many more times.
    sequence: [u8; 8],
    sequence_len: usize,
    repeats: u16,
    /// The first half of a pair whose second half has yet to arrive.
    high_surrogate: u16,
    /// For the next [`Reader::read`] to report.
    error: Option<Win32Error>,
    line: Arc<LineRead>,
    has_worker: bool,
}

impl Reader {
    pub(crate) fn create(input: HANDLE, poll: *mut FilePoll) -> *mut Reader {
        let reader = bun_core::heap::into_raw(Box::new(Reader {
            input,
            poll,
            next: READERS.get(),
            started: false,
            pending: Vec::new(),
            consumed: 0,
            records: Box::new([bun_core::ffi::zeroed(); 256]),
            unread: 0..0,
            sequence: [0; 8],
            sequence_len: 0,
            repeats: 0,
            high_surrogate: 0,
            error: None,
            line: Arc::new(LineRead::new()),
            has_worker: false,
        }));
        READERS.set(reader);
        reader
    }

    /// # Safety
    /// `this` came from [`Reader::create`] on this thread, nothing waits on what
    /// [`Reader::start`] returned, and nothing uses `this` afterwards.
    pub(crate) unsafe fn destroy(this: *mut Reader) {
        // SAFETY: the list holds live readers of this thread, `this` among them.
        unsafe {
            let mut link = READERS.get();
            if link == this {
                READERS.set((*this).next);
            } else {
                while (*link).next != this {
                    link = (*link).next;
                }
                (*link).next = (*this).next;
            }
            let reader = bun_core::heap::take(this);
            reader.line.cancel();
            reader.line.exit.store(true, Ordering::Release);
            SetEvent(reader.line.wake);
        }
    }

    fn has_pending(&self) -> bool {
        self.consumed < self.pending.len() || self.repeats > 0 || !self.unread.is_empty()
    }

    /// Gets input coming. Returns the handle, not always the same one, that is signaled while [`Reader::read`] has something.
    pub(crate) fn start(&mut self) -> HANDLE {
        self.started = true;
        match self.line.state.load(Ordering::Acquire) {
            WANTED | READING => return self.line.ready,
            DONE => {}
            _ => {
                if !self.has_pending() && self.error.is_none() {
                    match is_raw(self.input).and_then(|is_raw| {
                        if !is_raw {
                            self.start_line_read()?;
                        }
                        Ok(is_raw)
                    }) {
                        Ok(true) => return self.input,
                        Ok(false) => return self.line.ready,
                        Err(error) => self.error = Some(error),
                    }
                }
            }
        }
        SetEvent(self.line.ready);
        self.line.ready
    }

    /// After [`Reader::start`]: the event that starts the line read. Until it is set the input is anybody's to take.
    pub(crate) fn event_that_starts_a_line(&self) -> Option<HANDLE> {
        (self.line.state.load(Ordering::Acquire) == WANTED).then_some(self.line.wake)
    }

    /// Leaves the console's input to others. What was typed and not entered is lost.
    pub(crate) fn stop(&mut self) {
        self.started = false;
        self.line.cancel();
    }

    fn start_line_read(&mut self) -> Result<(), Win32Error> {
        let line = &self.line;
        if line.input.load(Ordering::Relaxed).is_null() {
            line.input.store(open_input()?, Ordering::Relaxed);
        }
        if !self.has_worker {
            let line = Arc::clone(line);
            std::thread::Builder::new()
                .stack_size(64 * 1024)
                .spawn(move || {
                    Output::Source::configure_named_thread_no_js(zstr!("Console Input"));
                    line.run();
                })
                .map_err(|_| Win32Error::NOT_ENOUGH_MEMORY)?;
            self.has_worker = true;
        }
        ResetEvent(line.ready);
        line.state.store(WANTED, Ordering::Release);
        Ok(())
    }

    /// As `read` on a non-blocking descriptor.
    pub(crate) fn read(&mut self, buf: &mut [u8]) -> sys::Result<usize> {
        if self.consumed == self.pending.len() {
            self.pending.clear();
            self.consumed = 0;
            let filled = match self.error.take() {
                Some(error) => Err(error),
                None => match self.line.state.load(Ordering::Acquire) {
                    WANTED | READING => return Err(would_block()),
                    DONE => match self.take_line() {
                        Ok(true) => Ok(()),
                        Ok(false) => return Ok(0),
                        Err(error) => Err(error),
                    },
                    _ => self.take_records(),
                },
            };
            // Nobody else touches the event unless a line is being read.
            ResetEvent(self.line.ready);
            if let Err(error) = filled {
                return Err(sys::Error::from_win32(error, sys::Tag::read));
            }
            if self.pending.is_empty() {
                return Err(would_block());
            }
        }
        let len = buf.len().min(self.pending.len() - self.consumed);
        buf[..len].copy_from_slice(&self.pending[self.consumed..][..len]);
        self.consumed += len;
        Ok(len)
    }

    /// Moves the line that the worker read to `pending`. `false` at the end of the input.
    fn take_line(&mut self) -> Result<bool, Win32Error> {
        let mut result = self.line.result.lock();
        self.line.state.store(IDLE, Ordering::Relaxed);
        if let Some(error) = result.error {
            return Err(error);
        }
        // Ctrl+Z at the start of a line, which `ReadFile` sees to itself.
        if result.len == 0 || (result.units[1] == 0x1A && !result.continued) {
            return Ok(false);
        }
        result.units[0] = core::mem::take(&mut self.high_surrogate);
        let mut units = &result.units[usize::from(result.units[0] == 0)..1 + result.len];
        // A line that does not fit comes in pieces.
        if let [rest @ .., last] = units
            && strings::u16_is_lead(*last)
        {
            self.high_surrogate = *last;
            units = rest;
        }
        self.pending = strings::convert_utf16_to_utf8(core::mem::take(&mut self.pending), units);
        Ok(true)
    }

    /// Moves what the console has to `pending`, unless it is editing a line.
    fn take_records(&mut self) -> Result<(), Win32Error> {
        let mut resized = false;
        // One chunk per escape sequence: `readline` takes an ESC at the end of a chunk for the key. Bounded for input that outruns it.
        let mut calls_left = 16;
        // A key can say that it was pressed 65535 times.
        while self.pending.len() < 64 * 1024 {
            if self.repeats > 0 {
                self.repeats -= 1;
                self.pending
                    .extend_from_slice(&self.sequence[..self.sequence_len]);
            } else if let Some(index) = self.unread.next() {
                let record = self.records[index];
                match record.EventType {
                    KEY_EVENT => self.key(&record.KeyEvent),
                    WINDOW_BUFFER_SIZE_EVENT => resized = true,
                    _ => {}
                }
            } else if calls_left > 0 {
                let is_full = self.read_records()? == self.records.len();
                calls_left = if is_full { calls_left - 1 } else { 0 };
            } else {
                break;
            }
        }
        if resized && let Some(watcher) = SizeWatcher::get() {
            watcher.check();
        }
        Ok(())
    }

    /// Refills `records`, all of which have been looked at. Returns how many there are.
    fn read_records(&mut self) -> Result<usize, Win32Error> {
        if !is_raw(self.input)? {
            return Ok(0);
        }
        let read_console_input = read_console_input_ex()?;
        let mut count: DWORD = 0;
        // SAFETY: `records` has room for as many as the call is told.
        let ok = unsafe {
            read_console_input(
                self.input,
                self.records.as_mut_ptr(),
                self.records.len() as DWORD,
                &raw mut count,
                CONSOLE_READ_NOWAIT,
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        self.unread = 0..count as usize;
        Ok(count as usize)
    }

    /// What a terminal would send for `key`. With `ENABLE_VIRTUAL_TERMINAL_INPUT` most keys come translated, a unit per event.
    fn key(&mut self, key: &KEY_EVENT_RECORD) {
        let vk = key.wVirtualKeyCode;
        let state = key.dwControlKeyState;
        let unit = key.UnicodeChar;
        let down = key.bKeyDown != 0;
        let alt = state & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED) != 0;
        let ctrl = state & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED) != 0;

        // Alt+numpad, an input method or a paste: the character comes with the release of an Alt that may never have been pressed.
        if !down && !(vk == VK_MENU && unit != 0) {
            return;
        }
        if state & LEFT_ALT_PRESSED != 0 && state & ENHANCED_KEY == 0 && is_numpad_key(vk) {
            return;
        }

        let mut bytes = [0u8; 8];
        let mut len = 0;
        let mut push = |sequence: &[u8]| {
            bytes[len..][..sequence.len()].copy_from_slice(sequence);
            len += sequence.len();
        };
        let mut utf8 = [0u8; 4];

        if unit != 0 {
            if strings::u16_is_lead(unit) {
                self.high_surrogate = unit;
                return;
            }
            // Ctrl+Alt is AltGr, which is part of typing the character.
            if alt && !ctrl && down {
                push(b"\x1b");
            }
            let high = core::mem::take(&mut self.high_surrogate);
            let code_point = if high != 0 && strings::u16_is_trail(unit) {
                strings::u16_get_supplementary(high, unit)
            } else {
                u32::from(unit)
            };
            let utf8_len = strings::encode_wtf8_rune(&mut utf8, code_point);
            push(&utf8[..utf8_len]);
        } else if let Some(sequence) = function_key(vk, state & SHIFT_PRESSED != 0, ctrl) {
            if alt {
                push(b"\x1b");
            }
            push(b"\x1b");
            push(sequence);
        } else if (vk == VK_SPACE && ctrl && !alt)
            || (key.wVirtualScanCode == 0 && state & LEFT_CTRL_PRESSED != 0 && !is_modifier_key(vk))
        {
            // Ctrl+Space, or the NUL of a sequence that the console translated (a key of its layout, no scan code).
            push(b"\0");
        } else {
            return;
        }

        self.sequence = bytes;
        self.sequence_len = len;
        self.repeats = key.wRepeatCount.max(1);
    }
}

fn would_block() -> sys::Error {
    sys::Error::from_code(sys::E::EAGAIN, sys::Tag::read)
}

fn read_console_input_ex() -> Result<ReadConsoleInputExW, Win32Error> {
    static FUNCTION: OnceLock<Option<ReadConsoleInputExW>> = OnceLock::new();
    FUNCTION
        .get_or_init(|| {
            // SAFETY: the name is NUL-terminated.
            let kernel32 = unsafe {
                windows::kernel32::GetModuleHandleW(bun_core::wstr!("kernel32.dll").as_ptr())
            };
            let name = zstr!("ReadConsoleInputExW");
            let function = windows::GetProcAddressA(Some(kernel32.cast()), name)?;
            // SAFETY: this is the signature of the export of that name.
            Some(unsafe { core::mem::transmute::<*mut c_void, ReadConsoleInputExW>(function) })
        })
        .ok_or(Win32Error::NOT_SUPPORTED)
}

/// The numeric keypad, under both names of each key: with the left Alt down they spell the code of a character.
fn is_numpad_key(vk: u16) -> bool {
    matches!(
        vk,
        VK_PRIOR..=VK_DOWN | VK_CLEAR | VK_INSERT | VK_NUMPAD0..=VK_NUMPAD9
    )
}

fn is_modifier_key(vk: u16) -> bool {
    matches!(
        vk,
        VK_SHIFT..=VK_MENU | VK_CAPITAL | VK_NUMLOCK | VK_SCROLL | VK_LSHIFT..=VK_RMENU
    )
}

/// What follows the ESC for a key without a character: libuv's (so Node's) table, with VK_NUMPAD7 and 8 the right way round.
fn function_key(vk: u16, shift: bool, ctrl: bool) -> Option<&'static [u8]> {
    let row: [&'static [u8]; 4] = match vk {
        VK_INSERT | VK_NUMPAD0 => [b"[2~", b"[2;2~", b"[2;5~", b"[2;6~"],
        VK_END | VK_NUMPAD1 => [b"[4~", b"[4;2~", b"[4;5~", b"[4;6~"],
        VK_DOWN | VK_NUMPAD2 => [b"[B", b"[1;2B", b"[1;5B", b"[1;6B"],
        VK_NEXT | VK_NUMPAD3 => [b"[6~", b"[6;2~", b"[6;5~", b"[6;6~"],
        VK_LEFT | VK_NUMPAD4 => [b"[D", b"[1;2D", b"[1;5D", b"[1;6D"],
        VK_CLEAR | VK_NUMPAD5 => [b"[G", b"[1;2G", b"[1;5G", b"[1;6G"],
        VK_RIGHT | VK_NUMPAD6 => [b"[C", b"[1;2C", b"[1;5C", b"[1;6C"],
        VK_HOME | VK_NUMPAD7 => [b"[1~", b"[1;2~", b"[1;5~", b"[1;6~"],
        VK_UP | VK_NUMPAD8 => [b"[A", b"[1;2A", b"[1;5A", b"[1;6A"],
        VK_PRIOR | VK_NUMPAD9 => [b"[5~", b"[5;2~", b"[5;5~", b"[5;6~"],
        VK_DELETE | VK_DECIMAL => [b"[3~", b"[3;2~", b"[3;5~", b"[3;6~"],
        VK_F1 => [b"[[A", b"[23~", b"[11^", b"[23^"],
        VK_F2 => [b"[[B", b"[24~", b"[12^", b"[24^"],
        VK_F3 => [b"[[C", b"[25~", b"[13^", b"[25^"],
        VK_F4 => [b"[[D", b"[26~", b"[14^", b"[26^"],
        VK_F5 => [b"[[E", b"[28~", b"[15^", b"[28^"],
        VK_F6 => [b"[17~", b"[29~", b"[17^", b"[29^"],
        VK_F7 => [b"[18~", b"[31~", b"[18^", b"[31^"],
        VK_F8 => [b"[19~", b"[32~", b"[19^", b"[32^"],
        VK_F9 => [b"[20~", b"[33~", b"[20^", b"[33^"],
        VK_F10 => [b"[21~", b"[34~", b"[21^", b"[34^"],
        VK_F11 => [b"[23~", b"[23$", b"[23^", b"[23@"],
        VK_F12 => [b"[24~", b"[24$", b"[24^", b"[24@"],
        _ => return None,
    };
    Some(row[usize::from(shift) | usize::from(ctrl) << 1])
}

const IDLE: u8 = 0;
/// The worker reads a line once `wake` is set.
const WANTED: u8 = 1;
/// `result` is the worker's.
const READING: u8 = 2;
/// `result` is for [`Reader::take_line`].
const DONE: u8 = 3;

const LINE_UNITS: usize = 8192;

struct LineResult {
    /// The first unit is room for [`Reader::high_surrogate`].
    units: [u16; 1 + LINE_UNITS],
    len: usize,
    error: Option<Win32Error>,
    canceled: bool,
    /// The console was asked for the line, and so may be editing it.
    asked: bool,
    /// This is more of the line that the read before had no room for.
    continued: bool,
}

/// Shared by a [`Reader`] and its line thread, which is not a pool thread: a read lasts until Enter.
struct LineRead {
    /// Auto-reset. For the worker: the state is `WANTED`, or `exit` or `cancel_requested` is set.
    wake: HANDLE,
    /// Manual-reset. For the event loop: see [`Reader::start`].
    ready: HANDLE,
    state: AtomicU8,
    cancel_requested: AtomicBool,
    exit: AtomicBool,
    /// Lines are read from a handle of their own because of what [`LineRead::cancel`] does to it.
    input: AtomicPtr<c_void>,
    result: Guarded<LineResult>,
}

// SAFETY: the two events never change, and any thread may use them.
unsafe impl Send for LineRead {}
// SAFETY: as above.
unsafe impl Sync for LineRead {}

impl LineRead {
    fn new() -> LineRead {
        LineRead {
            wake: create_event(false),
            ready: create_event(true),
            state: AtomicU8::new(IDLE),
            cancel_requested: AtomicBool::new(false),
            exit: AtomicBool::new(false),
            input: AtomicPtr::new(ptr::null_mut()),
            result: Guarded::new(LineResult {
                units: [0; 1 + LINE_UNITS],
                len: 0,
                error: None,
                canceled: false,
                asked: false,
                continued: false,
            }),
        }
    }

    fn run(&self) {
        loop {
            windows::kernel32::WaitForSingleObject(self.wake, windows::INFINITE);
            if self.exit.load(Ordering::Acquire) {
                return;
            }
            if self
                .state
                .compare_exchange(WANTED, READING, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                continue;
            }
            self.read(&mut self.result.lock());
            // In this order, so that `cancel` resets the event after this has set it.
            SetEvent(self.ready);
            self.state.store(DONE, Ordering::Release);
        }
    }

    fn read(&self, result: &mut LineResult) {
        let input = self.input.load(Ordering::Relaxed);
        result.continued = result.len == LINE_UNITS && result.units[LINE_UNITS] != u16::from(b'\n');
        result.len = 0;
        result.error = None;
        result.canceled = false;
        result.asked = false;
        // The console keeps the rest of a line for the handle, and that is not an input record.
        let mut has_text = result.continued;
        loop {
            if !core::mem::take(&mut has_text) && !self.wait_for_key(input) {
                result.canceled = true;
                return;
            }
            result.asked = true;
            // A canceled read reports success and leaves the count alone.
            let mut count = DWORD::MAX;
            SetLastError(0);
            // SAFETY: `units` has room for `LINE_UNITS` after the first.
            let ok = unsafe {
                ReadConsoleW(
                    input,
                    result.units.as_mut_ptr().add(1),
                    LINE_UNITS as DWORD,
                    &raw mut count,
                    ptr::null(),
                )
            };
            if ok == 0 {
                result.error = Some(Win32Error::get());
                return;
            }
            if count == DWORD::MAX {
                result.canceled = true;
                return;
            }
            // Ctrl+C, Ctrl+Break and another reader that goes away end a read with nothing and this error. That is not the end of the input.
            if count != 0 || Win32Error::get() != Win32Error::OPERATION_ABORTED {
                result.len = count as usize;
                return;
            }
            result.asked = false;
        }
    }

    /// Waits for typing to start (`false`: [`LineRead::cancel`] wants the worker back), so that no read has to be cancelled before.
    fn wait_for_key(&self, input: HANDLE) -> bool {
        let Ok(read_console_input) = read_console_input_ex() else {
            return !self.cancel_requested.load(Ordering::Acquire);
        };
        let mut records = [bun_core::ffi::zeroed::<INPUT_RECORD>(); 32];
        let mut take = |length: usize, flags: u16| {
            let mut count: DWORD = 0;
            // SAFETY: `records` has room for `length`.
            let ok = unsafe {
                read_console_input(
                    input,
                    records.as_mut_ptr(),
                    length as DWORD,
                    &raw mut count,
                    CONSOLE_READ_NOWAIT | flags,
                )
            };
            (ok != 0).then(|| {
                let keys_down = |record: &INPUT_RECORD| {
                    record.EventType == KEY_EVENT && record.KeyEvent.bKeyDown != 0
                };
                (
                    count as usize,
                    records[..count as usize].iter().any(keys_down),
                )
            })
        };
        loop {
            if self.cancel_requested.load(Ordering::Acquire) {
                return false;
            }
            match take(32, CONSOLE_READ_NOREMOVE) {
                // The read has the error to report, unless this is `cancel` at work.
                None => return !self.cancel_requested.load(Ordering::Acquire),
                Some((_, true)) => return true,
                Some((0, _)) => {
                    let handles = [input, self.wake];
                    // Nothing signals that the process behind the console is gone. The look at the records fails then.
                    // SAFETY: both handles are open for as long as the worker is in a read.
                    unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, 1000) };
                }
                // A read would drop these as well, and `input` is signaled while they are there.
                Some((count, false)) => {
                    take(count, 0);
                }
            }
        }
    }

    /// Returns once no read is in progress. A line that was entered in time stays for [`Reader::take_line`].
    fn cancel(&self) {
        match self
            .state
            .compare_exchange(WANTED, IDLE, Ordering::AcqRel, Ordering::Acquire)
        {
            Ok(_) | Err(IDLE) => return,
            Err(_) => {}
        }
        let input = self.input.load(Ordering::Relaxed);
        self.cancel_requested.store(true, Ordering::Release);
        while self.state.load(Ordering::Acquire) == READING {
            SetEvent(self.wake);
            // Finds nothing to cancel until the worker has made its call.
            // SAFETY: `input` is open, and null stands for every request on it.
            unsafe { CancelIoEx(input, ptr::null_mut()) };
            SwitchToThread();
        }
        ResetEvent(self.wake);
        self.cancel_requested.store(false, Ordering::Relaxed);
        let result = self.result.lock();
        if result.canceled {
            if result.asked {
                // The console goes on editing a cancelled line, and throws it away, until the handle that asked is closed, which blocks during the read.
                self.input.store(ptr::null_mut(), Ordering::Relaxed);
                // SAFETY: nothing else has this handle. Every other process that reads from this console gets nothing.
                unsafe { CloseHandle(input) };
            }
            self.state.store(IDLE, Ordering::Relaxed);
            ResetEvent(self.ready);
        }
    }
}

impl Drop for LineRead {
    fn drop(&mut self) {
        // SAFETY: these are this object's, and both threads are done with it.
        unsafe {
            CloseHandle(self.wake);
            CloseHandle(self.ready);
            let input = *self.input.get_mut();
            if !input.is_null() {
                CloseHandle(input);
            }
        }
    }
}

/// `tcsetattr` for console input. Readers of this thread follow the change.
pub fn set_mode(fd: Fd, mode: Mode) -> sys::Result<()> {
    let error = |code: sys::E| sys::Error::from_code(code, sys::Tag::SetConsoleMode).with_fd(fd);
    let input = fd.native();
    let mut current: DWORD = 0;
    if !is_console_input(input) || !get_console_mode(input, &mut current) {
        return Err(error(sys::E::EINVAL));
    }
    if mode == Mode::Io {
        return Err(error(sys::E::ENOTSUP));
    }
    let original = bun_core::output::windows_stdio::console_input_mode_to_restore(current);

    // A read keeps the mode that it started in.
    // SAFETY: `for_each_started_reader` passes live readers.
    for_each_started_reader(|reader| unsafe { (*reader).line.cancel() });
    let ok = match mode {
        // The legacy console knows no escape sequences.
        Mode::Raw => {
            set_console_mode(input, ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT)
                || set_console_mode(input, ENABLE_WINDOW_INPUT)
        }
        _ => {
            let cooked =
                windows::ENABLE_PROCESSED_INPUT | ENABLE_LINE_INPUT | windows::ENABLE_ECHO_INPUT;
            set_console_mode(input, (original | cooked) & !ENABLE_VIRTUAL_TERMINAL_INPUT)
        }
    };
    let result = if ok {
        MADE_RAW.store(mode == Mode::Raw, Ordering::Relaxed);
        Ok(())
    } else {
        Err(sys::Error::from_win32(Win32Error::get(), sys::Tag::SetConsoleMode).with_fd(fd))
    };
    // SAFETY: a reader belongs to its poll, which is where it was when it made the reader.
    for_each_started_reader(|reader| unsafe { (*(*reader).poll).restart_console() });
    result
}

/// `f` neither makes nor destroys a reader.
fn for_each_started_reader(f: impl Fn(*mut Reader)) {
    let mut reader = READERS.get();
    while !reader.is_null() {
        // SAFETY: the list holds live readers of this thread.
        let (next, started) = unsafe { ((*reader).next, (*reader).started) };
        if started {
            f(reader);
        }
        reader = next;
    }
}

/// `fd` is the C runtime's. Returns 0 or what `err.errno` is in Node, where JavaScript sees the number too.
///
/// # Safety
/// `state` is a `BunTTYState`, at any alignment.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__ttySetMode(
    fd: c_int,
    mode: c_int,
    state: *mut c_void,
    _drain: c_int,
) -> c_int {
    let mode_of_handle = state.cast::<c_int>();
    let result = match mode {
        // A handle that was never raw leaves another handle's raw mode alone; raw is set every time, since a child may have changed it.
        // SAFETY: fn contract: a `BunTTYState` starts with its mode.
        0 if unsafe { mode_of_handle.read_unaligned() } == 0 => return 0,
        0 => set_mode(Fd::from_crt(fd), Mode::Normal),
        // UV_TTY_MODE_RAW_VT asks for the escape sequences that raw input has here anyway.
        1 | 3 => set_mode(Fd::from_crt(fd), Mode::Raw),
        2 => set_mode(Fd::from_crt(fd), Mode::Io),
        _ => return UV_EINVAL,
    };
    match result {
        Ok(()) => {
            // SAFETY: as above.
            unsafe { mode_of_handle.write_unaligned(mode) };
            0
        }
        Err(error) => bun_errno::e_discriminant_to_uv(error.errno).unwrap_or(UV_UNKNOWN),
    }
}

// ── Window size ──

unsafe extern "C" {
    /// From any thread.
    safe fn Bun__onSignal(number: c_int);
}

/// `SIGWINCH`: a resize is only an input record, which takes a raw read to see, so a thread polls the size while it is wanted.
struct SizeWatcher {
    output: HANDLE,
    /// Manual reset: set while somebody wants to know.
    wanted: HANDLE,
    /// What [`SizeWatcher::size`] last returned.
    last: AtomicU32,
}

// SAFETY: the handles are never closed, and any thread may use them.
unsafe impl Sync for SizeWatcher {}

static SIZE_WATCHER: AtomicPtr<SizeWatcher> = AtomicPtr::new(ptr::null_mut());

impl SizeWatcher {
    const INTERVAL_MS: DWORD = 250;

    fn get() -> Option<&'static SizeWatcher> {
        // SAFETY: null, or never freed.
        unsafe { SIZE_WATCHER.load(Ordering::Acquire).as_ref() }
    }

    /// `None` without a console.
    fn get_or_start() -> Option<&'static SizeWatcher> {
        if let Some(watcher) = Self::get() {
            return Some(watcher);
        }
        let watcher: &'static SizeWatcher = Box::leak(Box::new(SizeWatcher {
            output: open(bun_core::wstr!("CONOUT$")).ok()?,
            wanted: create_event(true),
            last: AtomicU32::new(0),
        }));
        // Whether or not the thread starts: what was made for it is made once.
        SIZE_WATCHER.store(ptr::from_ref(watcher).cast_mut(), Ordering::Release);
        let _ = std::thread::Builder::new()
            .stack_size(64 * 1024)
            .spawn(move || {
                Output::Source::configure_named_thread_no_js(zstr!("Console Size"));
                loop {
                    windows::kernel32::WaitForSingleObject(watcher.wanted, windows::INFINITE);
                    watcher.check();
                    Sleep(Self::INTERVAL_MS);
                }
            });
        Some(watcher)
    }

    /// The columns and rows that `tty.WriteStream` reports, or 0.
    fn size(&self) -> u32 {
        let mut info: windows::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
        // SAFETY: `info` outlives the call.
        if unsafe { windows::kernel32::GetConsoleScreenBufferInfo(self.output, &raw mut info) } == 0
        {
            return 0;
        }
        let columns = info.dwSize.X;
        let rows = info.srWindow.Bottom - info.srWindow.Top + 1;
        u32::from(columns as u16) << 16 | u32::from(rows as u16)
    }

    fn check(&self) {
        let size = self.size();
        if size != 0 && self.last.swap(size, Ordering::Relaxed) != size {
            Bun__onSignal(bun_core::SignalCode::SIGWINCH as c_int);
        }
    }
}

/// Whether anything listens for `SIGWINCH`. One thread makes all the calls.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Console__watchSize(wanted: bool) {
    if !wanted {
        if let Some(watcher) = SizeWatcher::get() {
            ResetEvent(watcher.wanted);
        }
        return;
    }
    if let Some(watcher) = SizeWatcher::get_or_start() {
        // What happened while nobody wanted to know is not news.
        watcher.last.store(watcher.size(), Ordering::Relaxed);
        SetEvent(watcher.wanted);
    }
}

// ── Output ──

/// The start of a UTF-8 sequence whose end is in a write to come. One per stream to a console.
#[derive(Default)]
pub struct Utf8Carry {
    bytes: Cell<[u8; 3]>,
    len: Cell<u8>,
}

impl Utf8Carry {
    /// `Some` if [`write`] is the way to write to `fd`.
    pub fn for_fd(fd: Fd) -> Option<Utf8Carry> {
        let output = fd.native();
        let mut mode: DWORD = 0;
        if windows::GetFileType(output) != windows::FILE_TYPE_CHAR
            || !get_console_mode(output, &mut mode)
            || is_console_input(output)
        {
            return None;
        }
        let wanted = ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        set_console_mode(output, (mode | wanted) & !DISABLE_NEWLINE_AUTO_RETURN);
        Some(Utf8Carry::default())
    }
}

/// How long the UTF-8 sequence that `lead` starts is meant to be. Stricter than `wtf8_byte_sequence_length`: C0, C1 and F5 to F7 start none.
fn utf8_sequence_length(lead: u8) -> usize {
    match lead {
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => 1,
    }
}

/// How many bytes at the end of `bytes` start a UTF-8 sequence without finishing it.
fn unfinished_utf8_suffix(bytes: &[u8]) -> usize {
    for len in 1..=bytes.len().min(3) {
        let byte = bytes[bytes.len() - len];
        if byte & 0xC0 != 0x80 {
            return if utf8_sequence_length(byte) > len {
                len
            } else {
                0
            };
        }
    }
    0
}

/// Fills `units`, which is as long as `bytes`, the way a UTF-8 console reads: a sequence cut short is one U+FFFD.
fn utf8_to_utf16(units: &mut [u16], bytes: &[u8]) -> usize {
    const CP_UTF8: u32 = 65001;
    if bytes.is_empty() {
        return 0;
    }
    // SAFETY: both pointers come with the length of their slice.
    let filled = unsafe {
        MultiByteToWideChar(
            CP_UTF8,
            0,
            bytes.as_ptr(),
            bytes.len() as c_int,
            units.as_mut_ptr(),
            units.len() as c_int,
        )
    };
    filled as usize
}

/// Writes all of the UTF-8 before it returns. Not `WriteFile`: the code page belongs to every process on the console.
pub fn write(fd: Fd, carry: &Utf8Carry, bytes: &[u8]) -> sys::Result<usize> {
    // The console is locked for the duration of a call, and copies what it gets.
    const CHUNK: usize = 8192;
    let mut units = [0u16; 4 + CHUNK];
    let mut filled = 0;
    let mut rest = bytes;

    let mut head_len = usize::from(carry.len.get());
    if head_len > 0 {
        let mut head = [0u8; 4];
        head[..3].copy_from_slice(&carry.bytes.get());
        let wanted = utf8_sequence_length(head[0]);
        while let [byte, tail @ ..] = rest
            && head_len < wanted
            && byte & 0xC0 == 0x80
        {
            head[head_len] = *byte;
            head_len += 1;
            rest = tail;
        }
        if head_len < wanted && rest.is_empty() {
            carry.bytes.set([head[0], head[1], head[2]]);
            carry.len.set(head_len as u8);
            return Ok(bytes.len());
        }
        carry.len.set(0);
        filled = utf8_to_utf16(&mut units, &head[..head_len]);
    }

    let tail_len = unfinished_utf8_suffix(rest);
    let (mut rest, tail) = rest.split_at(rest.len() - tail_len);

    while filled > 0 || !rest.is_empty() {
        let mut len = rest.len();
        if len > CHUNK {
            // A sequence is not split, so neither is a surrogate pair.
            len = CHUNK - unfinished_utf8_suffix(&rest[..CHUNK]);
        }
        let (chunk, after) = rest.split_at(len);
        rest = after;
        filled += utf8_to_utf16(&mut units[filled..], chunk);
        // SAFETY: `units` holds `filled` units, and the null arguments are optional.
        let ok = unsafe {
            WriteConsoleW(
                fd.native(),
                units.as_ptr(),
                filled as DWORD,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(sys::Error::from_win32(Win32Error::get(), sys::Tag::write).with_fd(fd));
        }
        filled = 0;
    }

    if tail_len > 0 {
        let mut kept = [0u8; 3];
        kept[..tail_len].copy_from_slice(tail);
        carry.bytes.set(kept);
        carry.len.set(tail_len as u8);
    }
    Ok(bytes.len())
}
