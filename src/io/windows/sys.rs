//! Win32 surface used by the pipe, console and file sources that
//! `bun_windows_sys` does not declare.

#![allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]

use core::ffi::c_void;

pub(crate) use bun_windows_sys::GetCurrentThread;
pub(crate) use bun_windows_sys::kernel32::{
    CreateNamedPipeW, DuplicateHandle, GetCurrentProcess, ReadFile, WriteFile,
};
pub(crate) use bun_windows_sys::ntdll::NtQueryInformationFile;
pub(crate) use bun_windows_sys::{
    BOOL, CancelIoEx, CloseHandle, ConnectNamedPipe, CreateEventW, CreateFileW,
    DUPLICATE_SAME_ACCESS, DWORD, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
    ENABLE_VIRTUAL_TERMINAL_INPUT, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED,
    FILE_INFORMATION_CLASS, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_SYNCHRONOUS_IO_NONALERT, FILE_WRITE_ATTRIBUTES, GENERIC_READ, GENERIC_WRITE,
    GetConsoleMode, HANDLE, INPUT_RECORD, INVALID_HANDLE_VALUE, IO_STATUS_BLOCK, KEY_EVENT,
    LEFT_CTRL_PRESSED, NTSTATUS, OPEN_EXISTING, OVERLAPPED, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
    PIPE_WAIT, SYNCHRONIZE, SetConsoleMode, SetEvent, WRITE_DAC, Win32Error,
};

pub(crate) const PIPE_ACCESS_DUPLEX: DWORD = 0x0000_0003;
pub(crate) const PIPE_UNLIMITED_INSTANCES: DWORD = 255;
pub(crate) const PIPE_NOWAIT: DWORD = 0x0000_0001;
pub(crate) const PIPE_READMODE_MESSAGE: DWORD = 0x0000_0002;
pub(crate) const WT_EXECUTELONGFUNCTION: u32 = 0x0000_0010;

pub(crate) const FILE_SYNCHRONOUS_IO_ALERT: u32 = 0x0000_0010;

#[repr(C)]
pub(crate) struct CONSOLE_READCONSOLE_CONTROL {
    pub nLength: u32,
    pub nInitialChars: u32,
    pub dwCtrlWakeupMask: u32,
    pub dwControlKeyState: u32,
}

pub(crate) const ENABLE_WINDOW_INPUT: DWORD = 0x0008;

pub(crate) type LPTHREAD_START_ROUTINE = unsafe extern "system" fn(*mut c_void) -> DWORD;

#[link(name = "kernel32")]
unsafe extern "system" {
    pub(crate) fn CancelSynchronousIo(hThread: HANDLE) -> BOOL;
    pub(crate) fn PostQueuedCompletionStatus(
        CompletionPort: HANDLE,
        dwNumberOfBytesTransferred: DWORD,
        dwCompletionKey: usize,
        lpOverlapped: *mut OVERLAPPED,
    ) -> BOOL;
    pub(crate) fn GetNamedPipeClientProcessId(Pipe: HANDLE, ClientProcessId: *mut u32) -> BOOL;
    pub(crate) fn GetNamedPipeServerProcessId(Pipe: HANDLE, ServerProcessId: *mut u32) -> BOOL;
    pub(crate) fn PeekNamedPipe(
        hNamedPipe: HANDLE,
        lpBuffer: *mut c_void,
        nBufferSize: DWORD,
        lpBytesRead: *mut DWORD,
        lpTotalBytesAvail: *mut DWORD,
        lpBytesLeftThisMessage: *mut DWORD,
    ) -> BOOL;
    pub(crate) fn SetNamedPipeHandleState(
        hNamedPipe: HANDLE,
        lpMode: *mut DWORD,
        lpMaxCollectionCount: *mut DWORD,
        lpCollectDataTimeout: *mut DWORD,
    ) -> BOOL;
    pub(crate) fn GetNamedPipeHandleStateW(
        hNamedPipe: HANDLE,
        lpState: *mut DWORD,
        lpCurInstances: *mut DWORD,
        lpMaxCollectionCount: *mut DWORD,
        lpCollectDataTimeout: *mut DWORD,
        lpUserName: *mut u16,
        nMaxUserNameSize: DWORD,
    ) -> BOOL;
    pub(crate) fn QueueUserWorkItem(
        Function: LPTHREAD_START_ROUTINE,
        Context: *mut c_void,
        Flags: u32,
    ) -> BOOL;
    pub(crate) fn ReadConsoleW(
        hConsoleInput: HANDLE,
        lpBuffer: *mut c_void,
        nNumberOfCharsToRead: DWORD,
        lpNumberOfCharsRead: *mut DWORD,
        pInputControl: *mut CONSOLE_READCONSOLE_CONTROL,
    ) -> BOOL;
    pub(crate) fn WriteConsoleInputW(
        hConsoleInput: HANDLE,
        lpBuffer: *const INPUT_RECORD,
        nLength: DWORD,
        lpNumberOfEventsWritten: *mut DWORD,
    ) -> BOOL;
    pub(crate) fn GetNumberOfConsoleInputEvents(
        hConsoleInput: HANDLE,
        lpcNumberOfEvents: *mut DWORD,
    ) -> BOOL;
}

/// `GetLastError()` of the call that just failed.
#[inline]
pub(crate) fn last_error() -> Win32Error {
    Win32Error::get()
}

/// The Win32 error a completed overlapped operation's NTSTATUS stands for.
#[inline]
pub(crate) fn status_to_win32(status: i32) -> Win32Error {
    if status == 0 {
        return Win32Error::SUCCESS;
    }
    Win32Error::from_ntstatus(NTSTATUS(status as u32))
}
