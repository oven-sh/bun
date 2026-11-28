//! Console I/O. Every call is a round trip to the console host process.

#![allow(
    clippy::not_unsafe_ptr_arg_deref,
    reason = "a `HANDLE` is never dereferenced"
)]

use core::ffi::c_void;
use core::ops::RangeInclusive;
use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
use std::sync::OnceLock;

use bun_core::WStr;
use bun_core::strings::u16_is_lead;
use bun_windows_sys::{CONSOLE_SCREEN_BUFFER_INFO, COORD, SMALL_RECT};

use super::kernel32_2::{GetConsoleMode, SetConsoleMode};
use super::{BOOL, DWORD, HANDLE, ULONG, Win32Error, check, kernel32};
use crate::windows_format::key_input::InputRecord;

#[repr(C)]
struct CONSOLE_READCONSOLE_CONTROL {
    nLength: ULONG,
    nInitialChars: ULONG,
    dwCtrlWakeupMask: ULONG,
    dwControlKeyState: ULONG,
}

#[repr(C)]
struct CONSOLE_SCREEN_BUFFER_INFOEX {
    cbSize: ULONG,
    info: CONSOLE_SCREEN_BUFFER_INFO,
    wPopupAttributes: u16,
    bFullscreenSupported: BOOL,
    ColorTable: [DWORD; 16],
}

#[repr(C)]
#[derive(Default)]
struct CONSOLE_CURSOR_INFO {
    dwSize: DWORD,
    bVisible: BOOL,
}

#[repr(C)]
#[derive(Clone, Default)]
struct CHAR_INFO {
    UnicodeChar: u16,
    Attributes: u16,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetConsoleScreenBufferInfoEx(
        hConsoleOutput: HANDLE,
        lpConsoleScreenBufferInfoEx: &mut CONSOLE_SCREEN_BUFFER_INFOEX,
    ) -> BOOL;
    safe fn GetConsoleCursorInfo(
        hConsoleOutput: HANDLE,
        lpConsoleCursorInfo: &mut CONSOLE_CURSOR_INFO,
    ) -> BOOL;
    fn ReadConsoleOutputW(
        hConsoleOutput: HANDLE,
        lpBuffer: *mut CHAR_INFO,
        dwBufferSize: COORD,
        dwBufferCoord: COORD,
        lpReadRegion: &mut SMALL_RECT,
    ) -> BOOL;
    safe fn GetNumberOfConsoleInputEvents(
        hConsoleInput: HANDLE,
        lpNumberOfEvents: &mut DWORD,
    ) -> BOOL;
    fn PeekConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut InputRecord,
        nLength: DWORD,
        lpNumberOfEventsRead: &mut DWORD,
    ) -> BOOL;
    fn ReadConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut InputRecord,
        nLength: DWORD,
        lpNumberOfEventsRead: &mut DWORD,
    ) -> BOOL;
    fn WriteConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *const InputRecord,
        nLength: DWORD,
        lpNumberOfEventsWritten: &mut DWORD,
    ) -> BOOL;
    fn ReadConsoleW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut u16,
        nNumberOfCharsToRead: DWORD,
        lpNumberOfCharsRead: &mut DWORD,
        pInputControl: &mut CONSOLE_READCONSOLE_CONTROL,
    ) -> BOOL;
    fn WriteConsoleW(
        hConsoleOutput: HANDLE,
        lpBuffer: *const u16,
        nNumberOfCharsToWrite: DWORD,
        lpNumberOfCharsWritten: &mut DWORD,
        lpReserved: *const c_void,
    ) -> BOOL;
}

/// `name` is `CONIN$` or `CONOUT$`.
pub fn open(name: &WStr) -> Result<OwnedHandle, Win32Error> {
    let access = super::GENERIC_READ | super::GENERIC_WRITE;
    let share = super::FILE_SHARE_READ | super::FILE_SHARE_WRITE;
    super::CreateFileW(name, access, share, super::OPEN_EXISTING, 0)
}

/// Exit closes handles in ascending order. One with a pending read that precedes the connection ends the reads of every process.
pub fn open_input() -> Result<OwnedHandle, Win32Error> {
    // SAFETY: the PEB and its parameters live as long as the process.
    let connection = unsafe { (*(*bun_core::windows_sys::peb()).ProcessParameters).ConsoleHandle };
    let mut input = open(bun_core::wstr!("CONIN$"))?;
    let mut lower_handles = Vec::new();
    while (input.as_raw_handle() as isize) < connection as isize {
        let duplicate = super::duplicate_handle(input.as_raw_handle())?;
        lower_handles.push(core::mem::replace(&mut input, duplicate));
    }
    Ok(input)
}

fn query_host_pid() -> Option<DWORD> {
    const PROCESS_CONSOLE_HOST_PROCESS: ULONG = 49;
    const FLAG_MASK: usize = 3;
    let mut pid_and_flags = 0usize;
    // SAFETY: `pid_and_flags` is writable for the size passed.
    let status = unsafe {
        super::ntdll::NtQueryInformationProcess(
            super::GetCurrentProcess(),
            PROCESS_CONSOLE_HOST_PROCESS,
            (&raw mut pid_and_flags).cast(),
            size_of_val(&pid_and_flags) as ULONG,
            core::ptr::null_mut(),
        )
    };
    super::NT_SUCCESS(status).then_some((pid_and_flags & !FLAG_MASK) as DWORD)
}

/// Blocks the calling thread, and runs `on_layout_event` on it whenever the window size may have changed.
pub fn run_resize_message_loop(on_layout_event: impl Fn()) {
    type WINEVENTPROC = extern "system" fn(HANDLE, u32, HANDLE, i32, i32, u32, u32);
    type SetWinEventHook =
        extern "system" fn(u32, u32, HANDLE, WINEVENTPROC, u32, u32, u32) -> HANDLE;
    type WaitMessage = extern "system" fn() -> BOOL;
    type PeekMessageW = extern "system" fn(&mut [usize; 6], HANDLE, u32, u32, u32) -> BOOL;
    const EVENT_CONSOLE_LAYOUT: u32 = 0x4005;
    const WINEVENT_OUTOFCONTEXT: u32 = 0;
    const PM_REMOVE: u32 = 1;
    const THROTTLE_INTERVAL_MS: DWORD = 33;
    extern "system" fn on_win_event(_: HANDLE, _: u32, _: HANDLE, _: i32, _: i32, _: u32, _: u32) {}

    let user32 = bun_core::wstr!("user32.dll");
    let null = core::ptr::null_mut();
    // SAFETY: the signatures match `winuser.h`, and `MSG` is six words long.
    let exports = unsafe {
        (
            super::load_export::<SetWinEventHook>(user32, c"SetWinEventHook"),
            super::load_export::<WaitMessage>(user32, c"WaitMessage"),
            super::load_export::<PeekMessageW>(user32, c"PeekMessageW"),
        )
    };
    // Some Windows editions lack these exports, and some processes cannot load user32.
    let (Some(set_hook), Some(wait_message), Some(peek_message)) = exports else {
        return;
    };
    let Some(host_pid) = query_host_pid() else {
        return;
    };
    let hook = set_hook(
        EVENT_CONSOLE_LAYOUT,
        EVENT_CONSOLE_LAYOUT,
        null,
        on_win_event,
        host_pid,
        0,
        WINEVENT_OUTOFCONTEXT,
    );
    if hook.is_null() {
        return;
    }
    while wait_message() != 0 {
        while peek_message(&mut [0; 6], null, 0, 0, PM_REMOVE) != 0 {}
        on_layout_event();
        // Scrolling output raises the event too.
        kernel32::Sleep(THROTTLE_INTERVAL_MS);
    }
}

pub fn mode(console: HANDLE) -> Result<DWORD, Win32Error> {
    let mut mode = 0;
    check(GetConsoleMode(console, &mut mode)).map(|()| mode)
}

pub fn set_mode(console: HANDLE, mode: DWORD) -> Result<(), Win32Error> {
    check(SetConsoleMode(console, mode))
}

pub fn is_input(console: HANDLE) -> bool {
    queued_record_count(console).is_ok()
}

pub fn queued_record_count(input: HANDLE) -> Result<DWORD, Win32Error> {
    let mut count = 0;
    check(GetNumberOfConsoleInputEvents(input, &mut count)).map(|()| count)
}

fn read_cells(output: HANDLE, mut region: SMALL_RECT) -> Result<Vec<CHAR_INFO>, Win32Error> {
    /// More than a display has room for.
    const MAX_CELLS: usize = 1 << 20;
    let size = COORD {
        X: region.Right.wrapping_sub(region.Left).wrapping_add(1),
        Y: region.Bottom.wrapping_sub(region.Top).wrapping_add(1),
    };
    let len = usize::from(size.X.unsigned_abs()) * usize::from(size.Y.unsigned_abs());
    if len > MAX_CELLS {
        return Err(Win32Error::NOT_ENOUGH_MEMORY);
    }
    let mut cells = vec![CHAR_INFO::default(); len];
    let origin = COORD { X: 0, Y: 0 };
    // SAFETY: `cells` is writable for `size`.
    check(unsafe { ReadConsoleOutputW(output, cells.as_mut_ptr(), size, origin, &mut region) })?;
    Ok(cells)
}

/// Whether the screen buffer shows a popup of the line editor. Older consoles draw a border around it, newer ones hide the cursor.
pub fn has_popup(output: HANDLE) -> Result<bool, Win32Error> {
    const COLOR_MASK: u16 = 0xFF;
    const BOX_DRAWING: RangeInclusive<u16> = 0x2500..=0x257F;
    const HISTORY_WIDTH: usize = 40;
    let mut cursor = CONSOLE_CURSOR_INFO::default();
    check(GetConsoleCursorInfo(output, &mut cursor))?;
    let mut info_ex = CONSOLE_SCREEN_BUFFER_INFOEX {
        cbSize: size_of::<CONSOLE_SCREEN_BUFFER_INFOEX>() as ULONG,
        info: bun_core::ffi::zeroed(),
        wPopupAttributes: 0,
        bFullscreenSupported: 0,
        ColorTable: [0; 16],
    };
    check(GetConsoleScreenBufferInfoEx(output, &mut info_ex))?;
    let window = info_ex.info.srWindow;
    let window_cells = read_cells(output, window)?;
    // Popups are centered, so this column crosses the border of one that output has pushed above the window.
    let center = window.Left.midpoint(window.Right);
    let scrollback_column = SMALL_RECT {
        Left: center,
        Top: 0,
        Right: center,
        Bottom: window.Top,
    };
    let scrollback_cells = read_cells(output, scrollback_column)?;

    let has_popup_colors =
        |cell: &CHAR_INFO| (cell.Attributes ^ info_ex.wPopupAttributes) & COLOR_MASK == 0;
    let is_border =
        |cell: &CHAR_INFO| has_popup_colors(cell) && BOX_DRAWING.contains(&cell.UnicodeChar);
    // A key redraws the selected row of a history list that has scrolled out of the buffer, but not the border.
    let is_history_row = |row: &[CHAR_INFO]| row.iter().all(has_popup_colors);
    Ok(window_cells.iter().chain(&scrollback_cells).any(is_border)
        || window_cells.windows(HISTORY_WIDTH).any(is_history_row)
        || (cursor.bVisible == 0 && window_cells.iter().any(has_popup_colors)))
}

/// Non-blocking: empty if the input queue is empty.
pub fn read_records(
    input: HANDLE,
    records: &mut [InputRecord],
) -> Result<&[InputRecord], Win32Error> {
    type ReadConsoleInputExW =
        unsafe extern "system" fn(HANDLE, *mut InputRecord, DWORD, &mut DWORD, u16) -> BOOL;
    const CONSOLE_READ_NOWAIT: u16 = 2;
    static READ_EX: OnceLock<Option<ReadConsoleInputExW>> = OnceLock::new();
    let read_ex = READ_EX.get_or_init(|| {
        // SAFETY: https://learn.microsoft.com/en-us/windows/console/readconsoleinputex
        unsafe { super::find_export(bun_core::wstr!("kernel32.dll"), c"ReadConsoleInputExW") }
    });
    let mut len = records.len() as DWORD;
    let mut read_count = 0;
    if let Some(read_ex) = read_ex {
        // SAFETY: `records` is writable for `len` records.
        check(unsafe {
            read_ex(
                input,
                records.as_mut_ptr(),
                len,
                &mut read_count,
                CONSOLE_READ_NOWAIT,
            )
        })?;
    } else {
        // Old versions of Wine do not export `ReadConsoleInputExW`.
        len = len.min(queued_record_count(input)?);
        if len > 0 {
            // SAFETY: `records` is writable for `len` records.
            check(unsafe { ReadConsoleInputW(input, records.as_mut_ptr(), len, &mut read_count) })?;
        }
    }
    Ok(&records[..read_count.min(len) as usize])
}

/// Non-blocking. The records stay in the input queue.
pub fn peek_records(
    input: HANDLE,
    records: &mut [InputRecord],
) -> Result<&[InputRecord], Win32Error> {
    let len = records.len() as DWORD;
    let mut read_count = 0;
    // SAFETY: `records` is writable for `len` records.
    check(unsafe { PeekConsoleInputW(input, records.as_mut_ptr(), len, &mut read_count) })?;
    Ok(&records[..read_count.min(len) as usize])
}

/// Returns the number of records added to the input queue.
pub fn write_records(input: HANDLE, records: &[InputRecord]) -> Result<usize, Win32Error> {
    let len = records.len() as DWORD;
    let mut written_count = 0;
    // SAFETY: `records` is readable for `len` records.
    check(unsafe { WriteConsoleInputW(input, records.as_ptr(), len, &mut written_count) })?;
    Ok(written_count as usize)
}

/// Blocks until a line or the control character `wakeup_char` (included in the text) is entered. Empty after Ctrl+C.
pub fn read_text(
    input: HANDLE,
    buffer: &mut [u16],
    wakeup_char: u16,
) -> Result<&[u16], Win32Error> {
    let mut control = CONSOLE_READCONSOLE_CONTROL {
        nLength: size_of::<CONSOLE_READCONSOLE_CONTROL>() as ULONG,
        nInitialChars: 0,
        dwCtrlWakeupMask: 1 << wakeup_char,
        dwControlKeyState: 0,
    };
    let mut read_len = 0;
    // SAFETY: `buffer` is writable for the length passed.
    check(unsafe {
        ReadConsoleW(
            input,
            buffer.as_mut_ptr(),
            buffer.len() as DWORD,
            &mut read_len,
            &mut control,
        )
    })?;
    Ok(&buffer[..buffer.len().min(read_len as usize)])
}

pub fn write_text(output: HANDLE, mut text: &[u16]) -> Result<(), Win32Error> {
    const MAX_CHUNK_LEN: usize = 8192;
    while !text.is_empty() {
        let mut len = text.len().min(MAX_CHUNK_LEN);
        if len < text.len() && u16_is_lead(text[len - 1]) {
            len -= 1;
        }
        let mut written_len = 0;
        // SAFETY: `text` is readable for `len` code units.
        check(unsafe {
            WriteConsoleW(
                output,
                text.as_ptr(),
                len as DWORD,
                &mut written_len,
                core::ptr::null(),
            )
        })?;
        text = &text[(written_len as usize).clamp(1, len)..];
    }
    Ok(())
}

/// `(columns, rows)` of the visible window.
pub fn window_size(output: HANDLE) -> Option<(u16, u16)> {
    let mut info: CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
    check(kernel32::GetConsoleScreenBufferInfo(output, &mut info)).ok()?;
    let window = info.srWindow;
    let extent = |first, last| u16::try_from(i32::from(last) - i32::from(first) + 1).ok();
    extent(window.Left, window.Right).zip(extent(window.Top, window.Bottom))
}
