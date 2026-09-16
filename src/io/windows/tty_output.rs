//! Console output. Text (UTF-8, UTF-16 or Latin-1) is written with `WriteConsoleW`, with `\n`
//! converted to `\r\n`. On a console that cannot do virtual-terminal processing (pre-1511
//! Windows 10, "legacy console mode"), ANSI escape sequences are interpreted here and applied
//! through the classic console API instead.

use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::MaybeUninit;
use core::ptr;

use bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_PROCESSING;
use bun_threading::{Guarded, GuardedLock, Mutex};
use bun_windows_sys::kernel32::{
    FillConsoleOutputAttribute, FillConsoleOutputCharacterW, GetConsoleScreenBufferInfo,
    SetConsoleCursorPosition,
};
use bun_windows_sys::{
    CONSOLE_SCREEN_BUFFER_INFO, COORD, DWORD, GetConsoleMode, GetLastError, HANDLE, SetConsoleMode,
    WORD, Win32Error,
};

use ffi::{
    BACKGROUND_BLUE, BACKGROUND_GREEN, BACKGROUND_INTENSITY, BACKGROUND_RED,
    COMMON_LVB_REVERSE_VIDEO, CONSOLE_CURSOR_INFO, FOREGROUND_BLUE, FOREGROUND_GREEN,
    FOREGROUND_INTENSITY, FOREGROUND_RED,
};

/// `WriteConsoleW` is given at most this many UTF-16 units per call.
const MAX_CONSOLE_CHARS: usize = 8192;
const MAX_CSI_ARGS: usize = 4;
const REPLACEMENT_CHARACTER: u32 = 0xFFFD;
const CURSOR_SIZE_SMALL: DWORD = 25;
const CURSOR_SIZE_LARGE: DWORD = 100;
const ERROR_SUCCESS: DWORD = Win32Error::SUCCESS.0 as DWORD;
const ERROR_INVALID_PARAMETER: DWORD = Win32Error::INVALID_PARAMETER.0 as DWORD;

#[derive(Clone, Copy, PartialEq, Eq)]
enum VtermState {
    Supported,
    Unsupported,
}

#[derive(Clone, Copy)]
enum AnsiState {
    Normal,
    EscapeSeen,
    /// After `ESC [` or 0x9B. `in_arg`: the last character was a digit of the current argument.
    /// `extension`: the sequence started with `?`.
    Csi {
        in_arg: bool,
        extension: bool,
    },
    /// Inside PM/APC/DCS/OSC, which run until BEL or `ESC \`.
    StControl {
        escape_seen: bool,
    },
    /// Inside a `"`-quoted string of such a control string, where BEL and `ESC \` do not terminate.
    StString {
        backslash_seen: bool,
    },
    /// Swallowing the rest of an unsupported CSI sequence, up to its final byte.
    Ignore,
    /// After `ESC [ args SP`, waiting for the final byte.
    Decscusr,
}

pub(crate) struct OutputState {
    utf8_bytes_left: u8,
    utf8_codepoint: u32,
    /// `\n` or `\r` if that was the last character written, else 0.
    previous_eol: u8,
    ansi_state: AnsiState,
    csi_argc: usize,
    csi_argv: [u16; MAX_CSI_ARGS],
    /// Column, and row relative to the virtual window.
    saved_position: Option<COORD>,
    /// The two intensity bits only.
    saved_attributes: Option<WORD>,
}

impl OutputState {
    pub(crate) const fn new() -> Self {
        Self {
            utf8_bytes_left: 0,
            utf8_codepoint: 0,
            previous_eol: 0,
            ansi_state: AnsiState::Normal,
            csi_argc: 0,
            csi_argv: [0; MAX_CSI_ARGS],
            saved_position: None,
            saved_attributes: None,
        }
    }

    fn begin_csi(&mut self) {
        self.ansi_state = AnsiState::Csi {
            in_arg: false,
            extension: false,
        };
        self.csi_argc = 0;
    }

    fn first_arg_or(&self, default: u16) -> u16 {
        if self.csi_argc > 0 {
            self.csi_argv[0]
        } else {
            default
        }
    }

    /// A 1-based coordinate argument as a 0-based one; missing and 0 both mean the first cell.
    fn coordinate_arg(&self, index: usize) -> i32 {
        if index < self.csi_argc && self.csi_argv[index] != 0 {
            i32::from(self.csi_argv[index]) - 1
        } else {
            0
        }
    }
}

/// State of the one console this process is attached to, shared by every output stream.
///
/// Console cursor addressing is relative to the whole screen buffer, scrollback included, so
/// absolute cursor movement would overwrite history. Movement is confined to a virtual window
/// instead: as wide as the screen buffer, as tall as the visible window, its top at the row the
/// cursor was on when the first output handle was initialized (or as far down as fits). When
/// output scrolls past its bottom the window is dragged down, never resized.
struct Console {
    virtual_offset: i32,
    virtual_height: i32,
    virtual_width: i32,
    default_text_attributes: WORD,
    /// ANSI colour numbers: red = 1, green = 2, blue = 4.
    default_fg_color: u8,
    default_bg_color: u8,
    default_fg_bright: bool,
    default_bg_bright: bool,
    default_inverse: bool,
    default_cursor_info: CONSOLE_CURSOR_INFO,
    need_check_vterm_state: bool,
    vterm_state: VtermState,
    style_captured: bool,
}

static CONSOLE: Guarded<Console> = Guarded::new(Console::new());

pub(crate) struct OutputLock {
    console: GuardedLock<'static, Console, Mutex>,
    /// The lock has to be released by the thread that took it.
    _not_send: PhantomData<*const ()>,
}

/// The process-wide console output lock. Every console write and all of the emulator's shared
/// state are serialized by it. Not re-entrant.
#[must_use = "the console output lock is released when the guard is dropped"]
pub(crate) fn lock_output() -> OutputLock {
    OutputLock {
        console: CONSOLE.lock(),
        _not_send: PhantomData,
    }
}

pub(crate) fn init_output_handle(handle: HANDLE) -> Result<(), u32> {
    let info = screen_buffer_info(handle)?;
    let cursor_info = cursor_info(handle)?;

    let mut lock = lock_output();
    let console = &mut *lock.console;
    if console.need_check_vterm_state {
        console.determine_vterm_state(handle);
    }
    console.capture_initial_style(&info, cursor_info);
    console.update_virtual_window(&info);
    Ok(())
}

/// UTF-8 in. All of `data` is always parsed, so `state` stays consistent; after the first
/// console API failure (the returned error) no further console calls are made.
pub(crate) fn write(handle: HANDLE, state: &mut OutputState, data: &[u8]) -> Result<(), u32> {
    with_writer(handle, state, |writer| writer.write(data))
}

/// As [`write`] for text that is UTF-16 already. Unpaired surrogates are let through.
pub(crate) fn write_utf16(
    handle: HANDLE,
    state: &mut OutputState,
    data: &[u16],
) -> Result<(), u32> {
    with_writer(handle, state, |writer| writer.write_utf16(data))
}

/// As [`write`] for Latin-1: every byte is the code point of that value.
pub(crate) fn write_latin1(
    handle: HANDLE,
    state: &mut OutputState,
    data: &[u8],
) -> Result<(), u32> {
    with_writer(handle, state, |writer| writer.write_latin1(data))
}

fn with_writer(
    handle: HANDLE,
    state: &mut OutputState,
    write: impl FnOnce(&mut Writer<'_>),
) -> Result<(), u32> {
    let mut lock = lock_output();
    let console = &mut *lock.console;
    let mut writer = Writer {
        handle,
        passthrough: console.vterm_state == VtermState::Supported,
        console,
        state,
        error: ERROR_SUCCESS,
        used: 0,
        buf: [const { MaybeUninit::uninit() }; MAX_CONSOLE_CHARS],
    };
    write(&mut writer);
    writer.flush_text();
    if writer.error == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(writer.error)
    }
}

fn screen_buffer_info(handle: HANDLE) -> Result<CONSOLE_SCREEN_BUFFER_INFO, DWORD> {
    let mut info = MaybeUninit::<CONSOLE_SCREEN_BUFFER_INFO>::uninit();
    // SAFETY: `info` is a valid out-pointer; a bad `handle` makes the call fail.
    if unsafe { GetConsoleScreenBufferInfo(handle, info.as_mut_ptr()) } == 0 {
        return Err(GetLastError());
    }
    // SAFETY: the call succeeded, so it filled the struct.
    Ok(unsafe { info.assume_init() })
}

fn cursor_info(handle: HANDLE) -> Result<CONSOLE_CURSOR_INFO, DWORD> {
    let mut info = MaybeUninit::<CONSOLE_CURSOR_INFO>::uninit();
    // SAFETY: `info` is a valid out-pointer; a bad `handle` makes the call fail.
    if unsafe { ffi::GetConsoleCursorInfo(handle, info.as_mut_ptr()) } == 0 {
        return Err(GetLastError());
    }
    // SAFETY: the call succeeded, so it filled the struct.
    Ok(unsafe { info.assume_init() })
}

fn set_cursor_info(handle: HANDLE, info: CONSOLE_CURSOR_INFO) -> Result<(), DWORD> {
    // SAFETY: `info` is a valid in-pointer for the duration of the call.
    if unsafe { ffi::SetConsoleCursorInfo(handle, &raw const info) } == 0 {
        return Err(GetLastError());
    }
    Ok(())
}

fn set_text_attribute(handle: HANDLE, attributes: WORD) -> Result<(), DWORD> {
    // SAFETY: by-value arguments only.
    if unsafe { ffi::SetConsoleTextAttribute(handle, attributes) } == 0 {
        return Err(GetLastError());
    }
    Ok(())
}

/// What a coordinate is checked against. A console call that fails with
/// `ERROR_INVALID_PARAMETER` is tried again only while this differs from the failed attempt's:
/// the console was resized after the screen buffer info was read.
fn geometry(info: &CONSOLE_SCREEN_BUFFER_INFO) -> [i16; 6] {
    [
        info.dwSize.X,
        info.dwSize.Y,
        info.srWindow.Left,
        info.srWindow.Top,
        info.srWindow.Right,
        info.srWindow.Bottom,
    ]
}

/// Blanks the run of cells `region` selects (start, cell count, attributes). `region` is asked
/// again with fresh screen buffer info when the console is resized underneath the call.
fn blank_cells(
    handle: HANDLE,
    mut region: impl FnMut(&CONSOLE_SCREEN_BUFFER_INFO) -> (COORD, DWORD, WORD),
) -> Result<CONSOLE_SCREEN_BUFFER_INFO, DWORD> {
    let mut failed_with = None;
    loop {
        let info = screen_buffer_info(handle)?;
        let (start, count, attributes) = region(&info);
        let mut written: DWORD = 0;
        // SAFETY: `written` is a valid out-pointer; everything else is by value.
        let filled = unsafe {
            FillConsoleOutputCharacterW(handle, u16::from(b' '), count, start, &raw mut written)
                != 0
                && FillConsoleOutputAttribute(handle, attributes, written, start, &raw mut written)
                    != 0
        };
        if filled {
            return Ok(info);
        }
        let err = GetLastError();
        if err != ERROR_INVALID_PARAMETER || failed_with == Some(geometry(&info)) {
            return Err(err);
        }
        failed_with = Some(geometry(&info));
    }
}

fn ansi_color(attributes: WORD, red: WORD, green: WORD, blue: WORD) -> u8 {
    u8::from(attributes & red != 0)
        | u8::from(attributes & green != 0) << 1
        | u8::from(attributes & blue != 0) << 2
}

fn set_ansi_color(attributes: &mut WORD, color: u8, red: WORD, green: WORD, blue: WORD) {
    *attributes &= !(red | green | blue);
    if color & 1 != 0 {
        *attributes |= red;
    }
    if color & 2 != 0 {
        *attributes |= green;
    }
    if color & 4 != 0 {
        *attributes |= blue;
    }
}

fn set_flag(attributes: &mut WORD, flag: WORD, on: bool) {
    if on {
        *attributes |= flag;
    } else {
        *attributes &= !flag;
    }
}

/// With `COMMON_LVB_REVERSE_VIDEO` set the console stores the colours swapped; SGR edits are
/// made on the logical colours, between two swaps.
fn flip_fg_bg(attributes: WORD) -> WORD {
    let fg = attributes & 0x0F;
    let bg = attributes & 0xF0;
    (attributes & 0xFF00) | (fg << 4) | (bg >> 4)
}

impl Console {
    const fn new() -> Self {
        Self {
            virtual_offset: -1,
            virtual_height: -1,
            virtual_width: -1,
            default_text_attributes: FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_BLUE,
            default_fg_color: 7,
            default_bg_color: 0,
            default_fg_bright: false,
            default_bg_bright: false,
            default_inverse: false,
            default_cursor_info: CONSOLE_CURSOR_INFO {
                dwSize: 0,
                bVisible: 0,
            },
            need_check_vterm_state: true,
            vterm_state: VtermState::Unsupported,
            style_captured: false,
        }
    }

    /// Turns virtual-terminal processing on for the console (it stays on) if the console can do
    /// it: Windows 10 1511 and later, unless legacy console mode is selected.
    fn determine_vterm_state(&mut self, handle: HANDLE) {
        self.need_check_vterm_state = false;
        let mut mode: DWORD = 0;
        // SAFETY: `mode` is a valid out-pointer; a bad `handle` makes the calls fail.
        let enabled = unsafe {
            GetConsoleMode(handle, &raw mut mode) != 0
                && SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0
        };
        if enabled {
            self.vterm_state = VtermState::Supported;
        }
    }

    fn capture_initial_style(
        &mut self,
        info: &CONSOLE_SCREEN_BUFFER_INFO,
        cursor_info: CONSOLE_CURSOR_INFO,
    ) {
        if self.style_captured {
            return;
        }
        self.style_captured = true;

        // Black on black would make everything written after a reset invisible.
        let attributes = if info.wAttributes == 0 {
            7
        } else {
            info.wAttributes
        };
        self.default_text_attributes = attributes;
        self.default_fg_color = ansi_color(
            attributes,
            FOREGROUND_RED,
            FOREGROUND_GREEN,
            FOREGROUND_BLUE,
        );
        self.default_bg_color = ansi_color(
            attributes,
            BACKGROUND_RED,
            BACKGROUND_GREEN,
            BACKGROUND_BLUE,
        );
        self.default_fg_bright = attributes & FOREGROUND_INTENSITY != 0;
        self.default_bg_bright = attributes & BACKGROUND_INTENSITY != 0;
        self.default_inverse = attributes & COMMON_LVB_REVERSE_VIDEO != 0;
        self.default_cursor_info = cursor_info;
    }

    fn update_virtual_window(&mut self, info: &CONSOLE_SCREEN_BUFFER_INFO) {
        self.virtual_width = i32::from(info.dwSize.X);
        self.virtual_height = i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1;

        let cursor_y = i32::from(info.dwCursorPosition.Y);
        if self.virtual_offset == -1 {
            self.virtual_offset = cursor_y;
        } else if self.virtual_offset < cursor_y - self.virtual_height + 1 {
            // The cursor is below the window, so the output has scrolled.
            self.virtual_offset = cursor_y - self.virtual_height + 1;
        }
        if self.virtual_offset + self.virtual_height > i32::from(info.dwSize.Y) {
            self.virtual_offset = i32::from(info.dwSize.Y) - self.virtual_height;
        }
        if self.virtual_offset < 0 {
            self.virtual_offset = 0;
        }
    }

    /// Screen buffer coordinates for a position that is either relative to the cursor or
    /// relative to the virtual window's top-left, clipped to the virtual window.
    fn make_real_coord(
        &mut self,
        info: &CONSOLE_SCREEN_BUFFER_INFO,
        x: i32,
        x_relative: bool,
        y: i32,
        y_relative: bool,
    ) -> COORD {
        self.update_virtual_window(info);

        let mut y = if y_relative {
            i32::from(info.dwCursorPosition.Y) + y
        } else {
            self.virtual_offset + y
        };
        if y < self.virtual_offset {
            y = self.virtual_offset;
        } else if y >= self.virtual_offset + self.virtual_height {
            y = self.virtual_offset + self.virtual_height - 1;
        }

        let mut x = if x_relative {
            i32::from(info.dwCursorPosition.X) + x
        } else {
            x
        };
        if x < 0 {
            x = 0;
        } else if x >= self.virtual_width {
            x = self.virtual_width - 1;
        }

        COORD {
            X: x as i16,
            Y: y as i16,
        }
    }
}

#[derive(Default)]
struct StyleChange {
    fg_color: Option<u8>,
    bg_color: Option<u8>,
    fg_bright: Option<bool>,
    bg_bright: Option<bool>,
    inverse: Option<bool>,
}

impl StyleChange {
    fn reset(&mut self, console: &Console) {
        self.fg_color = Some(console.default_fg_color);
        self.bg_color = Some(console.default_bg_color);
        self.fg_bright = Some(console.default_fg_bright);
        self.bg_bright = Some(console.default_bg_bright);
        self.inverse = Some(console.default_inverse);
    }

    fn is_empty(&self) -> bool {
        self.fg_color.is_none()
            && self.bg_color.is_none()
            && self.fg_bright.is_none()
            && self.bg_bright.is_none()
            && self.inverse.is_none()
    }
}

/// One `write` call. Holds the output lock (through `console`) for its whole life.
struct Writer<'a> {
    handle: HANDLE,
    console: &'a mut Console,
    state: &'a mut OutputState,
    /// The console interprets escape sequences itself.
    passthrough: bool,
    /// First console API failure, or `ERROR_SUCCESS`.
    error: DWORD,
    used: usize,
    buf: [MaybeUninit<u16>; MAX_CONSOLE_CHARS],
}

impl Writer<'_> {
    /// Non-shortest forms, surrogates and values past U+10FFFF are let through; sequences of up
    /// to seven bytes are decoded.
    fn write(&mut self, data: &[u8]) {
        for &c in data {
            if self.state.utf8_bytes_left != 0 {
                if c & 0xC0 == 0x80 {
                    self.state.utf8_bytes_left -= 1;
                    self.state.utf8_codepoint =
                        (self.state.utf8_codepoint << 6) | u32::from(c & 0x3F);
                    if self.state.utf8_bytes_left == 0 {
                        self.put_codepoint(self.state.utf8_codepoint);
                    }
                    continue;
                }
                // The sequence was cut short; `c` starts a new one.
                self.state.utf8_bytes_left = 0;
                self.put_codepoint(REPLACEMENT_CHARACTER);
            }

            match c.leading_ones() {
                0 => self.put_codepoint(u32::from(c)),
                // A continuation byte, or 0xFF.
                1 | 8 => self.put_codepoint(REPLACEMENT_CHARACTER),
                ones => {
                    self.state.utf8_codepoint = u32::from(c) & (0xFF >> (ones + 1));
                    self.state.utf8_bytes_left = (ones - 1) as u8;
                }
            }
        }
    }

    /// A UTF-8 sequence that an earlier [`write`](Self::write) left unfinished cannot be
    /// continued by text in another encoding.
    fn abandon_utf8_sequence(&mut self) {
        if self.state.utf8_bytes_left != 0 {
            self.state.utf8_bytes_left = 0;
            self.put_codepoint(REPLACEMENT_CHARACTER);
        }
    }

    fn write_utf16(&mut self, data: &[u16]) {
        self.abandon_utf8_sequence();
        if !self.passthrough {
            let mut units = data.iter().copied().peekable();
            while let Some(unit) = units.next() {
                let low = units.peek().copied().filter(|low| {
                    bun_core::strings::u16_is_lead(unit) && bun_core::strings::u16_is_trail(*low)
                });
                let Some(low) = low else {
                    self.put_codepoint(u32::from(unit));
                    continue;
                };
                units.next();
                self.put_codepoint(
                    0x10000 + ((u32::from(unit) - 0xD800) << 10) + (u32::from(low) - 0xDC00),
                );
            }
            return;
        }

        // Only line ends need a look; what is between them is copied as it is.
        let mut rest = data;
        while !rest.is_empty() {
            let run = bun_core::strings::index_of_any16(rest, &[0x0A, 0x0D]).unwrap_or(rest.len());
            if run == 0 {
                self.put_codepoint(u32::from(rest[0]));
                rest = &rest[1..];
                continue;
            }
            self.push_run(&rest[..run]);
            self.state.previous_eol = 0;
            rest = &rest[run..];
        }
    }

    fn write_latin1(&mut self, data: &[u8]) {
        self.abandon_utf8_sequence();
        for &c in data {
            self.put_codepoint(u32::from(c));
        }
    }

    /// Text without line ends. Both halves of a surrogate pair go out in the same
    /// `WriteConsoleW` call.
    fn push_run(&mut self, mut run: &[u16]) {
        while !run.is_empty() {
            let mut take = run.len().min(MAX_CONSOLE_CHARS - self.used);
            if take > 0
                && take < run.len()
                && bun_core::strings::u16_is_lead(run[take - 1])
                && bun_core::strings::u16_is_trail(run[take])
            {
                take -= 1;
            }
            if take == 0 {
                self.flush_text();
                continue;
            }
            // SAFETY: `take` units fit behind `used`, `MaybeUninit<u16>` has the layout of
            // `u16`, and `run` is not part of `buf`.
            unsafe {
                ptr::copy_nonoverlapping(
                    run.as_ptr(),
                    self.buf.as_mut_ptr().add(self.used).cast::<u16>(),
                    take,
                );
            }
            self.used += take;
            run = &run[take..];
        }
    }

    fn put_codepoint(&mut self, codepoint: u32) {
        if !self.passthrough && self.parse_ansi(codepoint) {
            return;
        }

        match codepoint {
            0x0A | 0x0D => {
                if codepoint == 0x0A && self.state.previous_eol != 0x0D {
                    self.ensure_buffer_space(2);
                    self.push(u16::from(b'\r'));
                    self.push(u16::from(b'\n'));
                } else if codepoint == 0x0D && self.state.previous_eol == 0x0A {
                    // "\n\r" or "\r\n\r": this "\r" was already written along with the "\n".
                } else {
                    self.ensure_buffer_space(1);
                    self.push(codepoint as u16);
                }
                self.state.previous_eol = codepoint as u8;
            }
            0..=0xFFFF => {
                self.ensure_buffer_space(1);
                self.push(codepoint as u16);
                self.state.previous_eol = 0;
            }
            _ => {
                // Both halves go out in the same `WriteConsoleW` call.
                self.ensure_buffer_space(2);
                let offset = codepoint - 0x10000;
                self.push((offset / 0x400 + 0xD800) as u16);
                self.push((offset % 0x400 + 0xDC00) as u16);
                self.state.previous_eol = 0;
            }
        }
    }

    fn ensure_buffer_space(&mut self, needed: usize) {
        if needed > MAX_CONSOLE_CHARS - self.used {
            self.flush_text();
        }
    }

    fn push(&mut self, unit: u16) {
        self.buf[self.used].write(unit);
        self.used += 1;
    }

    fn flush_text(&mut self) {
        if self.used == 0 {
            return;
        }
        let len = self.used as DWORD;
        self.used = 0;
        if self.error != ERROR_SUCCESS {
            return;
        }
        let mut written: DWORD = 0;
        // SAFETY: `push` initialized the first `len` units of `buf`; `written` is a valid
        // out-pointer.
        let ok = unsafe {
            ffi::WriteConsoleW(
                self.handle,
                self.buf.as_ptr().cast::<c_void>(),
                len,
                &raw mut written,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            self.error = GetLastError();
        }
    }

    /// Runs a console API operation at the current point of the output, unless one has failed.
    fn emulate(&mut self, op: impl FnOnce(&mut Self) -> Result<(), DWORD>) {
        self.flush_text();
        if self.error == ERROR_SUCCESS {
            if let Err(err) = op(self) {
                self.error = err;
            }
        }
    }

    /// Returns whether the character was consumed by the escape sequence parser.
    fn parse_ansi(&mut self, codepoint: u32) -> bool {
        let ch = char::from_u32(codepoint).unwrap_or(char::REPLACEMENT_CHARACTER);

        match self.state.ansi_state {
            AnsiState::Normal => match ch {
                '\x1b' => {
                    self.state.ansi_state = AnsiState::EscapeSeen;
                    true
                }
                '\u{9b}' => {
                    self.state.begin_csi();
                    true
                }
                _ => false,
            },

            AnsiState::EscapeSeen => {
                match ch {
                    '[' => self.state.begin_csi(),
                    '^' | '_' | 'P' | ']' => {
                        self.state.ansi_state = AnsiState::StControl { escape_seen: false };
                    }
                    '\x1b' => {}
                    'c' => {
                        self.state.ansi_state = AnsiState::Normal;
                        self.emulate(Self::reset);
                    }
                    '7' => {
                        self.state.ansi_state = AnsiState::Normal;
                        self.emulate(|w| w.save_state(true));
                    }
                    '8' => {
                        self.state.ansi_state = AnsiState::Normal;
                        self.emulate(|w| w.restore_state(true));
                    }
                    // Any other single-character control.
                    '@'..='_' => self.state.ansi_state = AnsiState::Normal,
                    _ => {
                        self.state.ansi_state = AnsiState::Normal;
                        return false;
                    }
                }
                true
            }

            AnsiState::Ignore => {
                if matches!(ch, '@'..='~') {
                    self.state.ansi_state = AnsiState::Normal;
                }
                true
            }

            AnsiState::Decscusr => {
                if !matches!(ch, '@'..='~') {
                    // libuv prints this character and swallows only what follows it.
                    self.state.ansi_state = AnsiState::Ignore;
                    return false;
                }
                self.state.ansi_state = AnsiState::Normal;
                if ch == 'q' {
                    let style = self.state.first_arg_or(1);
                    if style <= 6 {
                        self.emulate(|w| w.set_cursor_shape(style));
                    }
                }
                true
            }

            AnsiState::Csi { in_arg, extension } => {
                self.parse_csi(ch, in_arg, extension);
                true
            }

            AnsiState::StControl { escape_seen } => {
                self.state.ansi_state = match ch {
                    '\x07' => AnsiState::Normal,
                    '\\' if escape_seen => AnsiState::Normal,
                    '\x1b' => AnsiState::StControl { escape_seen: true },
                    '"' => AnsiState::StString {
                        backslash_seen: false,
                    },
                    _ => AnsiState::StControl { escape_seen: false },
                };
                true
            }

            AnsiState::StString { backslash_seen } => {
                self.state.ansi_state = match ch {
                    _ if backslash_seen => AnsiState::StString {
                        backslash_seen: false,
                    },
                    '"' => AnsiState::StControl { escape_seen: false },
                    '\\' => AnsiState::StString {
                        backslash_seen: true,
                    },
                    _ => AnsiState::StString {
                        backslash_seen: false,
                    },
                };
                true
            }
        }
    }

    fn parse_csi(&mut self, ch: char, in_arg: bool, extension: bool) {
        let state = &mut *self.state;
        match ch {
            '0'..='9' => {
                let digit = ch as u16 - u16::from(b'0');
                if !in_arg {
                    if state.csi_argc >= MAX_CSI_ARGS {
                        state.ansi_state = AnsiState::Ignore;
                        return;
                    }
                    state.ansi_state = AnsiState::Csi {
                        in_arg: true,
                        extension,
                    };
                    state.csi_argv[state.csi_argc] = digit;
                    state.csi_argc += 1;
                } else {
                    let arg = &mut state.csi_argv[state.csi_argc - 1];
                    match arg.checked_mul(10) {
                        Some(value) => *arg = value.wrapping_add(digit),
                        None => state.ansi_state = AnsiState::Ignore,
                    }
                }
            }

            ';' => {
                if in_arg {
                    state.ansi_state = AnsiState::Csi {
                        in_arg: false,
                        extension,
                    };
                } else if state.csi_argc >= MAX_CSI_ARGS {
                    state.ansi_state = AnsiState::Ignore;
                } else {
                    // An empty argument is 0.
                    state.csi_argv[state.csi_argc] = 0;
                    state.csi_argc += 1;
                }
            }

            '?' if !in_arg && !extension && state.csi_argc == 0 => {
                state.ansi_state = AnsiState::Csi {
                    in_arg,
                    extension: true,
                };
            }

            ' ' if !extension => state.ansi_state = AnsiState::Decscusr,

            '@'..='~' => {
                state.ansi_state = AnsiState::Normal;
                if extension {
                    self.run_private_csi_command(ch);
                } else {
                    self.run_csi_command(ch);
                }
            }

            // Private-mode characters and intermediates are not supported.
            _ => state.ansi_state = AnsiState::Ignore,
        }
    }

    /// `ESC [ ? args command`
    fn run_private_csi_command(&mut self, command: char) {
        let visible = match command {
            'h' => true,
            'l' => false,
            _ => return,
        };
        if self.state.csi_argc == 1 && self.state.csi_argv[0] == 25 {
            self.emulate(|w| w.set_cursor_visibility(visible));
        }
    }

    /// `ESC [ args command`
    fn run_csi_command(&mut self, command: char) {
        let count = i32::from(self.state.first_arg_or(1));
        match command {
            'A' => self.emulate(|w| w.move_caret(0, true, -count, true)),
            'B' => self.emulate(|w| w.move_caret(0, true, count, true)),
            'C' => self.emulate(|w| w.move_caret(count, true, 0, true)),
            'D' => self.emulate(|w| w.move_caret(-count, true, 0, true)),
            'E' => self.emulate(|w| w.move_caret(0, false, count, true)),
            'F' => self.emulate(|w| w.move_caret(0, false, -count, true)),
            'G' => {
                let x = self.state.coordinate_arg(0);
                self.emulate(|w| w.move_caret(x, false, 0, true));
            }
            'H' | 'f' => {
                let y = self.state.coordinate_arg(0);
                let x = self.state.coordinate_arg(1);
                self.emulate(|w| w.move_caret(x, false, y, false));
            }
            'J' | 'K' => {
                let direction = self.state.first_arg_or(0);
                if direction <= 2 {
                    self.emulate(|w| w.clear(direction, command == 'J'));
                } else {
                    self.flush_text();
                }
            }
            'm' => self.emulate(Self::set_style),
            's' => self.emulate(|w| w.save_state(false)),
            'u' => self.emulate(|w| w.restore_state(false)),
            _ => {}
        }
    }

    fn move_caret(
        &mut self,
        x: i32,
        x_relative: bool,
        y: i32,
        y_relative: bool,
    ) -> Result<(), DWORD> {
        let mut failed_with = None;
        loop {
            let info = screen_buffer_info(self.handle)?;
            let position = self
                .console
                .make_real_coord(&info, x, x_relative, y, y_relative);
            // SAFETY: by-value arguments only.
            if unsafe { SetConsoleCursorPosition(self.handle, position) } != 0 {
                return Ok(());
            }
            let err = GetLastError();
            if err != ERROR_INVALID_PARAMETER || failed_with == Some(geometry(&info)) {
                return Err(err);
            }
            failed_with = Some(geometry(&info));
        }
    }

    /// `ESC c`
    fn reset(&mut self) -> Result<(), DWORD> {
        const ORIGIN: COORD = COORD { X: 0, Y: 0 };
        let attributes = self.console.default_text_attributes;

        set_text_attribute(self.handle, attributes)?;
        // SAFETY: by-value arguments only.
        if unsafe { SetConsoleCursorPosition(self.handle, ORIGIN) } == 0 {
            return Err(GetLastError());
        }
        let info = blank_cells(self.handle, |info| {
            let count = i32::from(info.dwSize.X) * i32::from(info.dwSize.Y);
            (ORIGIN, count as DWORD, attributes)
        })?;

        self.console.virtual_offset = 0;
        self.console.update_virtual_window(&info);

        set_cursor_info(self.handle, self.console.default_cursor_info)
    }

    /// `direction`: 0 = cursor to end, 1 = start to cursor, 2 = everything; of the virtual
    /// window if `entire_screen`, else of the cursor's row.
    fn clear(&mut self, direction: u16, entire_screen: bool) -> Result<(), DWORD> {
        let (x1, x1_relative) = (0, direction == 0);
        // The far end is past any real width; `make_real_coord` clips it.
        let (x2, x2_relative) = if direction == 1 {
            (0, true)
        } else {
            (0xFFFF, false)
        };
        let (y1, y1_relative, y2, y2_relative) = if entire_screen {
            (x1, x1_relative, x2, x2_relative)
        } else {
            (0, true, 0, true)
        };

        let console = &mut *self.console;
        blank_cells(self.handle, |info| {
            let start = console.make_real_coord(info, x1, x1_relative, y1, y1_relative);
            let end = console.make_real_coord(info, x2, x2_relative, y2, y2_relative);
            let width = i32::from(info.dwSize.X);
            let count = (i32::from(end.Y) * width + i32::from(end.X))
                - (i32::from(start.Y) * width + i32::from(start.X))
                + 1;
            (start, count as DWORD, info.wAttributes)
        })?;
        Ok(())
    }

    /// SGR. There is no 256-colour or RGB support, and "blink" (5/25) is bright background.
    fn set_style(&mut self) -> Result<(), DWORD> {
        let console = &*self.console;
        let mut change = StyleChange::default();

        if self.state.csi_argc == 0 {
            change.reset(console);
        }
        for &arg in &self.state.csi_argv[..self.state.csi_argc] {
            match arg {
                0 => change.reset(console),
                1 => change.fg_bright = Some(true),
                2 => {
                    change.fg_bright = Some(false);
                    change.bg_bright = Some(false);
                }
                5 => change.bg_bright = Some(true),
                7 => change.inverse = Some(true),
                21 | 22 => change.fg_bright = Some(false),
                25 => change.bg_bright = Some(false),
                27 => change.inverse = Some(false),
                30..=37 => change.fg_color = Some((arg - 30) as u8),
                39 => {
                    change.fg_color = Some(console.default_fg_color);
                    change.fg_bright = Some(console.default_fg_bright);
                }
                40..=47 => change.bg_color = Some((arg - 40) as u8),
                49 => {
                    change.bg_color = Some(console.default_bg_color);
                    change.bg_bright = Some(console.default_bg_bright);
                }
                90..=97 => {
                    change.fg_bright = Some(true);
                    change.fg_color = Some((arg - 90) as u8);
                }
                100..=107 => {
                    change.bg_bright = Some(true);
                    change.bg_color = Some((arg - 100) as u8);
                }
                _ => {}
            }
        }
        if change.is_empty() {
            return Ok(());
        }

        let mut attributes = screen_buffer_info(self.handle)?.wAttributes;
        if attributes & COMMON_LVB_REVERSE_VIDEO != 0 {
            attributes = flip_fg_bg(attributes);
        }

        if let Some(color) = change.fg_color {
            set_ansi_color(
                &mut attributes,
                color,
                FOREGROUND_RED,
                FOREGROUND_GREEN,
                FOREGROUND_BLUE,
            );
        }
        if let Some(bright) = change.fg_bright {
            set_flag(&mut attributes, FOREGROUND_INTENSITY, bright);
        }
        if let Some(color) = change.bg_color {
            set_ansi_color(
                &mut attributes,
                color,
                BACKGROUND_RED,
                BACKGROUND_GREEN,
                BACKGROUND_BLUE,
            );
        }
        if let Some(bright) = change.bg_bright {
            set_flag(&mut attributes, BACKGROUND_INTENSITY, bright);
        }
        if let Some(inverse) = change.inverse {
            set_flag(&mut attributes, COMMON_LVB_REVERSE_VIDEO, inverse);
        }

        if attributes & COMMON_LVB_REVERSE_VIDEO != 0 {
            attributes = flip_fg_bg(attributes);
        }
        set_text_attribute(self.handle, attributes)
    }

    fn save_state(&mut self, save_attributes: bool) -> Result<(), DWORD> {
        let info = screen_buffer_info(self.handle)?;
        self.console.update_virtual_window(&info);

        self.state.saved_position = Some(COORD {
            X: info.dwCursorPosition.X,
            Y: (i32::from(info.dwCursorPosition.Y) - self.console.virtual_offset) as i16,
        });
        if save_attributes {
            self.state.saved_attributes =
                Some(info.wAttributes & (FOREGROUND_INTENSITY | BACKGROUND_INTENSITY));
        }
        Ok(())
    }

    fn restore_state(&mut self, restore_attributes: bool) -> Result<(), DWORD> {
        if let Some(position) = self.state.saved_position {
            self.move_caret(i32::from(position.X), false, i32::from(position.Y), false)?;
        }
        if restore_attributes {
            if let Some(saved) = self.state.saved_attributes {
                let current = screen_buffer_info(self.handle)?.wAttributes;
                let attributes = (current & !(FOREGROUND_INTENSITY | BACKGROUND_INTENSITY)) | saved;
                set_text_attribute(self.handle, attributes)?;
            }
        }
        Ok(())
    }

    fn set_cursor_visibility(&mut self, visible: bool) -> Result<(), DWORD> {
        let mut info = cursor_info(self.handle)?;
        info.bVisible = visible.into();
        set_cursor_info(self.handle, info)
    }

    /// DECSCUSR: 0 = the console's original size, 1-2 = block, 3-6 = underline and bar.
    fn set_cursor_shape(&mut self, style: u16) -> Result<(), DWORD> {
        let mut info = cursor_info(self.handle)?;
        info.dwSize = match style {
            0 => self.console.default_cursor_info.dwSize,
            1 | 2 => CURSOR_SIZE_LARGE,
            _ => CURSOR_SIZE_SMALL,
        };
        set_cursor_info(self.handle, info)
    }
}

mod ffi {
    use core::ffi::c_void;

    use bun_windows_sys::{BOOL, DWORD, HANDLE, WORD};

    pub(super) const FOREGROUND_BLUE: WORD = 0x0001;
    pub(super) const FOREGROUND_GREEN: WORD = 0x0002;
    pub(super) const FOREGROUND_RED: WORD = 0x0004;
    pub(super) const FOREGROUND_INTENSITY: WORD = 0x0008;
    pub(super) const BACKGROUND_BLUE: WORD = 0x0010;
    pub(super) const BACKGROUND_GREEN: WORD = 0x0020;
    pub(super) const BACKGROUND_RED: WORD = 0x0040;
    pub(super) const BACKGROUND_INTENSITY: WORD = 0x0080;
    pub(super) const COMMON_LVB_REVERSE_VIDEO: WORD = 0x4000;

    #[repr(C)]
    #[derive(Clone, Copy)]
    #[allow(non_snake_case)]
    pub(super) struct CONSOLE_CURSOR_INFO {
        /// Percentage of the character cell the cursor fills, 1-100.
        pub(super) dwSize: DWORD,
        pub(super) bVisible: BOOL,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(super) fn WriteConsoleW(
            hConsoleOutput: HANDLE,
            lpBuffer: *const c_void,
            nNumberOfCharsToWrite: DWORD,
            lpNumberOfCharsWritten: *mut DWORD,
            lpReserved: *mut c_void,
        ) -> BOOL;
        pub(super) fn SetConsoleTextAttribute(hConsoleOutput: HANDLE, wAttributes: WORD) -> BOOL;
        pub(super) fn GetConsoleCursorInfo(
            hConsoleOutput: HANDLE,
            lpConsoleCursorInfo: *mut CONSOLE_CURSOR_INFO,
        ) -> BOOL;
        pub(super) fn SetConsoleCursorInfo(
            hConsoleOutput: HANDLE,
            lpConsoleCursorInfo: *const CONSOLE_CURSOR_INFO,
        ) -> BOOL;
    }
}
