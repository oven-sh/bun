//! Each of these calls is a round trip to the process that hosts the console.

#![allow(
    clippy::not_unsafe_ptr_arg_deref,
    reason = "a `HANDLE` is only a number"
)]

use core::ffi::c_void;
use std::os::windows::io::OwnedHandle;
use std::sync::OnceLock;

use bun_core::WStr;

use super::kernel32_2::{GetConsoleMode, SetConsoleMode};
use super::{BOOL, DWORD, HANDLE, ULONG, Win32Error, check, kernel32};
use crate::windows_format::key_input::InputRecord;

/// `CONSOLE_READCONSOLE_CONTROL`
#[repr(C)]
struct ReadControl {
    size: ULONG,
    initial_chars: ULONG,
    wakeup_mask: ULONG,
    control_keys: ULONG,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetNumberOfConsoleInputEvents(console: HANDLE, count: &mut DWORD) -> BOOL;
    fn ReadConsoleInputW(
        console: HANDLE,
        records: *mut InputRecord,
        len: DWORD,
        read: &mut DWORD,
    ) -> BOOL;
    fn WriteConsoleInputW(
        console: HANDLE,
        records: *const InputRecord,
        len: DWORD,
        written: &mut DWORD,
    ) -> BOOL;
    fn ReadConsoleW(
        console: HANDLE,
        buffer: *mut u16,
        len: DWORD,
        read: &mut DWORD,
        control: &mut ReadControl,
    ) -> BOOL;
    fn WriteConsoleW(
        console: HANDLE,
        buffer: *const u16,
        len: DWORD,
        written: &mut DWORD,
        reserved: *const c_void,
    ) -> BOOL;
}

/// `CONIN$` or `CONOUT$`.
pub fn open(name: &WStr) -> Result<OwnedHandle, Win32Error> {
    let access = super::GENERIC_READ | super::GENERIC_WRITE;
    let share = super::FILE_SHARE_READ | super::FILE_SHARE_WRITE;
    super::CreateFileW(name, access, share, super::OPEN_EXISTING, 0)
}

fn host_process_id() -> Option<DWORD> {
    const PROCESS_CONSOLE_HOST_PROCESS: ULONG = 49;
    let mut id = 0usize;
    // SAFETY: it writes at most the size given.
    let status = unsafe {
        super::ntdll::NtQueryInformationProcess(
            super::GetCurrentProcess(),
            PROCESS_CONSOLE_HOST_PROCESS,
            (&raw mut id).cast(),
            size_of_val(&id) as ULONG,
            core::ptr::null_mut(),
        )
    };
    // The low bits are flags.
    super::NT_SUCCESS(status).then_some((id & !3) as DWORD)
}

/// Keeps the thread, and calls `changed` on it when the size of the window may have changed.
pub fn watch_layout(changed: impl Fn()) {
    type Callback = extern "system" fn(HANDLE, u32, HANDLE, i32, i32, u32, u32);
    type SetWinEventHook = extern "system" fn(u32, u32, HANDLE, Callback, u32, u32, u32) -> HANDLE;
    type WaitMessage = extern "system" fn() -> BOOL;
    type PeekMessageW = extern "system" fn(&mut [usize; 6], HANDLE, u32, u32, u32) -> BOOL;
    const LOAD_LIBRARY_SEARCH_SYSTEM32: DWORD = 0x800;
    const LAYOUT: u32 = 0x4005;
    const OUT_OF_CONTEXT: u32 = 0;
    const PM_REMOVE: u32 = 1;
    extern "system" fn ignore(_: HANDLE, _: u32, _: HANDLE, _: i32, _: i32, _: u32, _: u32) {}

    let (user32, null) = (bun_core::wstr!("user32.dll"), core::ptr::null_mut());
    // SAFETY: the name ends with a NUL, the types are those of `winuser.h`, and a `MSG` takes six words.
    let (set_hook, wait, peek) = unsafe {
        kernel32::LoadLibraryExW(user32.as_ptr(), null, LOAD_LIBRARY_SEARCH_SYSTEM32);
        (
            super::find_export::<SetWinEventHook>(user32, c"SetWinEventHook"),
            super::find_export::<WaitMessage>(user32, c"WaitMessage"),
            super::find_export::<PeekMessageW>(user32, c"PeekMessageW"),
        )
    };
    // Not every edition of Windows has them, and not every process may load them.
    if let (Some(set_hook), Some(wait), Some(peek)) = (set_hook, wait, peek)
        && let Some(host) = host_process_id()
        && !set_hook(LAYOUT, LAYOUT, null, ignore, host, 0, OUT_OF_CONTEXT).is_null()
    {
        while wait() != 0 {
            while peek(&mut [0; 6], null, 0, 0, PM_REMOVE) != 0 {}
            changed();
            // Output that scrolls is reported too.
            kernel32::Sleep(33);
        }
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
    GetNumberOfConsoleInputEvents(console, &mut 0) != 0
}

/// Does not wait for any.
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
    let (mut len, mut read) = (records.len() as DWORD, 0);
    if let Some(read_ex) = read_ex {
        // SAFETY: `records` has the length that is passed.
        check(unsafe {
            read_ex(
                input,
                records.as_mut_ptr(),
                len,
                &mut read,
                CONSOLE_READ_NOWAIT,
            )
        })?;
    } else {
        // Old versions of Wine.
        check(GetNumberOfConsoleInputEvents(input, &mut read))?;
        len = len.min(read);
        if len > 0 {
            // SAFETY: `records` is no shorter than what is passed.
            check(unsafe { ReadConsoleInputW(input, records.as_mut_ptr(), len, &mut read) })?;
        }
    }
    Ok(&records[..read.min(len) as usize])
}

/// Returns how many are in the queue for it.
pub fn write_records(input: HANDLE, records: &[InputRecord]) -> Result<usize, Win32Error> {
    let (len, mut written) = (records.len() as DWORD, 0);
    // SAFETY: `records` has the length that is passed.
    check(unsafe { WriteConsoleInputW(input, records.as_ptr(), len, &mut written) })?;
    Ok(written as usize)
}

/// Waits for a line, or for the control character `wake`, which is then in the text. Empty after Ctrl+C.
pub fn read_text(input: HANDLE, buffer: &mut [u16], wake: u16) -> Result<&[u16], Win32Error> {
    let mut control = ReadControl {
        size: size_of::<ReadControl>() as ULONG,
        initial_chars: 0,
        wakeup_mask: 1 << wake,
        control_keys: 0,
    };
    let mut read = 0;
    // SAFETY: `buffer` has the length that is passed.
    check(unsafe {
        ReadConsoleW(
            input,
            buffer.as_mut_ptr(),
            buffer.len() as DWORD,
            &mut read,
            &mut control,
        )
    })?;
    Ok(&buffer[..buffer.len().min(read as usize)])
}

pub fn write_text(output: HANDLE, mut text: &[u16]) -> Result<(), Win32Error> {
    const MAX_LEN: usize = 8192;
    while !text.is_empty() {
        let mut len = text.len().min(MAX_LEN);
        if len < text.len() && (0xD800..0xDC00).contains(&text[len - 1]) {
            len -= 1;
        }
        let mut written = 0;
        // SAFETY: `text` is no shorter than what is passed.
        check(unsafe {
            WriteConsoleW(
                output,
                text.as_ptr(),
                len as DWORD,
                &mut written,
                core::ptr::null(),
            )
        })?;
        text = &text[(written as usize).clamp(1, len)..];
    }
    Ok(())
}

/// The columns and rows that are visible.
pub fn window_size(output: HANDLE) -> Option<(u16, u16)> {
    let mut info: bun_windows_sys::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
    // SAFETY: an out-param.
    check(unsafe { kernel32::GetConsoleScreenBufferInfo(output, &raw mut info) }).ok()?;
    let window = info.srWindow;
    let count = |first, last| u16::try_from(i32::from(last) - i32::from(first) + 1).ok();
    count(window.Left, window.Right).zip(count(window.Top, window.Bottom))
}
