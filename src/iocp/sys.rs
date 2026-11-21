//! The system calls behind the port.

#![allow(non_snake_case, non_camel_case_types)]

use core::ffi::{c_int, c_void};
use core::ptr;
use std::os::windows::io::{
    AsRawHandle as _, BorrowedHandle, FromRawHandle as _, HandleOrNull, OwnedHandle,
};
use std::sync::OnceLock;

use bun_sys::windows::kernel32::GetCurrentThreadId;
use bun_sys::windows::{StatusBlock, find_export};
use bun_windows_sys::{
    BOOL, BOOLEAN, DWORD, FILETIME, HANDLE, INFINITE, INVALID_HANDLE_VALUE, IO_STATUS_BLOCK,
    NT_SUCCESS, NTSTATUS, OBJECT_ATTRIBUTES, ULONG, UNICODE_STRING, Win32Error,
};

/// `FILE_IO_COMPLETION_INFORMATION`
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct Packet {
    pub(crate) key: usize,
    pub(crate) context: usize,
    status: usize,
    information: usize,
}

impl Packet {
    pub(crate) const EMPTY: Packet = Packet::new(0, 0);

    pub(crate) const fn new(key: usize, context: usize) -> Packet {
        Packet {
            key,
            context,
            status: 0,
            information: 0,
        }
    }
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtRemoveIoCompletionEx(
        IoCompletionHandle: HANDLE,
        IoCompletionInformation: *mut Packet,
        Count: ULONG,
        NumEntriesRemoved: &mut ULONG,
        Timeout: Option<&i64>,
        Alertable: BOOLEAN,
    ) -> NTSTATUS;
    safe fn NtSetIoCompletion(
        IoCompletionHandle: HANDLE,
        KeyContext: usize,
        ApcContext: usize,
        IoStatus: NTSTATUS,
        IoStatusInformation: usize,
    ) -> NTSTATUS;
    /// `IoRequestToCancel` is only compared.
    safe fn NtCancelIoFileEx(
        FileHandle: HANDLE,
        IoRequestToCancel: *const IO_STATUS_BLOCK,
        IoStatusBlock: &mut IO_STATUS_BLOCK,
    ) -> NTSTATUS;
    pub(crate) fn NtDeviceIoControlFile(
        FileHandle: HANDLE,
        Event: HANDLE,
        ApcRoutine: *mut c_void,
        ApcContext: usize,
        IoStatusBlock: *mut IO_STATUS_BLOCK,
        IoControlCode: ULONG,
        InputBuffer: *mut c_void,
        InputBufferLength: ULONG,
        OutputBuffer: *mut c_void,
        OutputBufferLength: ULONG,
    ) -> NTSTATUS;
    pub(crate) fn NtNotifyChangeDirectoryFile(
        FileHandle: HANDLE,
        Event: HANDLE,
        ApcRoutine: *mut c_void,
        ApcContext: *mut c_void,
        IoStatusBlock: *mut IO_STATUS_BLOCK,
        Buffer: *mut c_void,
        Length: ULONG,
        CompletionFilter: ULONG,
        WatchTree: BOOLEAN,
    ) -> NTSTATUS;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn CreateIoCompletionPort(
        FileHandle: HANDLE,
        ExistingCompletionPort: HANDLE,
        CompletionKey: usize,
        NumberOfConcurrentThreads: DWORD,
    ) -> HANDLE;
    safe fn SetFileCompletionNotificationModes(FileHandle: HANDLE, Flags: u8) -> BOOL;
    fn CreateWaitableTimerExW(
        lpTimerAttributes: *const c_void,
        lpTimerName: *const u16,
        dwFlags: DWORD,
        dwDesiredAccess: DWORD,
    ) -> HandleOrNull;
    fn SetWaitableTimer(
        hTimer: HANDLE,
        lpDueTime: &i64,
        lPeriod: i32,
        pfnCompletionRoutine: *const c_void,
        lpArgToCompletionRoutine: *const c_void,
        fResume: BOOL,
    ) -> BOOL;
    safe fn GetSystemTimeAsFileTime(lpSystemTimeAsFileTime: &mut FILETIME);
    safe fn CancelSynchronousIo(hThread: HANDLE) -> BOOL;
    safe fn OpenThread(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwThreadId: DWORD) -> HANDLE;
}

#[link(name = "ws2_32")]
unsafe extern "system" {
    fn WSAIoctl(
        s: usize,
        dwIoControlCode: DWORD,
        lpvInBuffer: *const c_void,
        cbInBuffer: DWORD,
        lpvOutBuffer: *mut c_void,
        cbOutBuffer: DWORD,
        lpcbBytesReturned: &mut DWORD,
        lpOverlapped: *mut c_void,
        lpCompletionRoutine: *const c_void,
    ) -> c_int;
}

fn socket_below(socket: usize, control_code: DWORD) -> Result<usize, Win32Error> {
    let mut below = socket;
    // SAFETY: the output has the size that is passed, and the call is synchronous.
    let rc = unsafe {
        WSAIoctl(
            socket,
            control_code,
            ptr::null(),
            0,
            (&raw mut below).cast(),
            size_of::<usize>() as DWORD,
            &mut 0,
            ptr::null_mut(),
            ptr::null(),
        )
    };
    if rc == 0 {
        Ok(below)
    } else {
        Err(Win32Error::get())
    }
}

/// The socket of the driver, under whatever layered service providers have put on top of it.
pub(crate) fn base_socket(mut socket: usize) -> Result<usize, Win32Error> {
    const SIO_BASE_HANDLE: DWORD = 0x4800_0022;
    const SIO_BSP_HANDLE_POLL: DWORD = 0x4800_001D;
    bun_windows_sys::ws2_32::ensure_started();
    for _ in 0..16 {
        match socket_below(socket, SIO_BASE_HANDLE) {
            Ok(base) => return Ok(base),
            Err(err @ Win32Error::WSAENOTSOCK) => return Err(err),
            Err(_) => {}
        }
        // Some providers refuse the first, and leave this one alone because `select` depends on it.
        match socket_below(socket, SIO_BSP_HANDLE_POLL) {
            Ok(below) if below != socket => socket = below,
            _ => break,
        }
    }
    Ok(socket)
}

/// A handle to poll sockets through.
pub(crate) fn open_afd_device() -> Result<OwnedHandle, Win32Error> {
    const NAME: &[u16] = bun_core::w!("\\Device\\Afd\\Bun");
    let mut name = UNICODE_STRING {
        Length: size_of_val(NAME) as u16,
        MaximumLength: size_of_val(NAME) as u16,
        Buffer: NAME.as_ptr().cast_mut(),
    };
    let mut attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as ULONG,
        ObjectName: &raw mut name,
        ..bun_core::ffi::zeroed()
    };
    let mut device = ptr::null_mut();
    // SAFETY: the pointers are to locals or null, and success fills `device` with a new handle.
    unsafe {
        let status = bun_windows_sys::ntdll::NtCreateFile(
            &raw mut device,
            bun_windows_sys::SYNCHRONIZE,
            &raw mut attributes,
            &mut bun_core::ffi::zeroed(),
            ptr::null_mut(),
            0,
            bun_windows_sys::FILE_SHARE_READ | bun_windows_sys::FILE_SHARE_WRITE,
            bun_windows_sys::FILE_OPEN,
            0,
            ptr::null_mut(),
            0,
        );
        if !NT_SUCCESS(status) {
            return Err(Win32Error::from_ntstatus(status));
        }
        Ok(OwnedHandle::from_raw_handle(device))
    }
}

pub(crate) fn create_port() -> Result<OwnedHandle, Win32Error> {
    let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, ptr::null_mut(), 0, DWORD::MAX);
    // SAFETY: a new handle, or null.
    OwnedHandle::try_from(unsafe { HandleOrNull::from_raw_handle(port) })
        .map_err(|_| Win32Error::get())
}

/// For good, and for every handle to the same open file.
pub(crate) fn bind(port: &OwnedHandle, file: HANDLE, key: usize) -> Result<(), Win32Error> {
    if CreateIoCompletionPort(file, port.as_raw_handle(), key, 0).is_null() {
        return Err(Win32Error::get());
    }
    Ok(())
}

pub(crate) const FILE_SKIP_COMPLETION_PORT_ON_SUCCESS: u8 = 1;
pub(crate) const FILE_SKIP_SET_EVENT_ON_HANDLE: u8 = 2;

/// As `bind`.
pub(crate) fn set_notification_modes(file: HANDLE, modes: u8) -> Result<(), Win32Error> {
    if SetFileCompletionNotificationModes(file, modes) == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

/// In units of 100 ns.
#[derive(Copy, Clone)]
pub(crate) enum Timeout {
    Never,
    Now,
    After(i64),
    /// On the wall clock, which goes on while the machine sleeps.
    WallClockAfter(i64),
}

/// Returns how many it took, from the start of `packets`.
pub(crate) fn remove_packets(
    port: &OwnedHandle,
    packets: &[core::cell::Cell<Packet>],
    timeout: Timeout,
) -> usize {
    let timeout = match timeout {
        Timeout::Never => None,
        Timeout::Now => Some(0),
        Timeout::After(ticks) => Some(-ticks),
        Timeout::WallClockAfter(ticks) => {
            let mut now: FILETIME = bun_core::ffi::zeroed();
            GetSystemTimeAsFileTime(&mut now);
            let now = (i64::from(now.dwHighDateTime) << 32) | i64::from(now.dwLowDateTime);
            Some(now.saturating_add(ticks))
        }
    };
    let mut removed = 0;
    // SAFETY: the cells are writable, and any bytes are a valid `Packet`.
    let status = unsafe {
        NtRemoveIoCompletionEx(
            port.as_raw_handle(),
            packets.as_ptr().cast_mut().cast(),
            packets.len() as ULONG,
            &mut removed,
            timeout.as_ref(),
            0,
        )
    };
    match status {
        NTSTATUS::SUCCESS => (removed as usize).min(packets.len()),
        NTSTATUS::TIMEOUT => 0,
        status => panic!("NtRemoveIoCompletionEx failed: {status:x?}"),
    }
}

/// The system allocates the packet, so this waits while it has no memory.
pub(crate) fn post(port: &OwnedHandle, key: usize, context: usize) {
    loop {
        match NtSetIoCompletion(port.as_raw_handle(), key, context, NTSTATUS::SUCCESS, 0) {
            NTSTATUS::INSUFFICIENT_RESOURCES | NTSTATUS::NO_MEMORY => {
                std::thread::sleep(core::time::Duration::from_millis(1));
            }
            status => {
                debug_assert!(NT_SUCCESS(status));
                return;
            }
        }
    }
}

/// Only asks: the request still reports its end, which can be a success.
pub(crate) fn cancel(file: HANDLE, request: &StatusBlock) {
    NtCancelIoFileEx(file, request.as_ptr(), &mut bun_core::ffi::zeroed());
}

pub(crate) fn cancel_synchronous_io(thread: HANDLE) {
    CancelSynchronousIo(thread);
}

/// With the right to have its I/O cancelled.
pub(crate) fn open_current_thread() -> Option<OwnedHandle> {
    const THREAD_TERMINATE: DWORD = 1;
    // SAFETY: a new handle, or null.
    let thread = unsafe {
        HandleOrNull::from_raw_handle(OpenThread(THREAD_TERMINATE, 0, GetCurrentThreadId()))
    };
    OwnedHandle::try_from(thread).ok()
}

pub(crate) fn create_high_resolution_timer() -> Option<OwnedHandle> {
    const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: DWORD = 2;
    const TIMER_MODIFY_STATE: DWORD = 2;
    // SAFETY: both pointers are optional.
    let timer = unsafe {
        CreateWaitableTimerExW(
            ptr::null(),
            ptr::null(),
            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
            bun_windows_sys::SYNCHRONIZE | TIMER_MODIFY_STATE,
        )
    };
    OwnedHandle::try_from(timer).ok()
}

/// `ticks` of 100 ns from now.
pub(crate) fn set_timer(timer: &OwnedHandle, ticks: i64) -> bool {
    // SAFETY: there is no completion routine.
    unsafe {
        SetWaitableTimer(
            timer.as_raw_handle(),
            &-ticks,
            0,
            ptr::null(),
            ptr::null(),
            0,
        ) != 0
    }
}

pub(crate) fn wait_for(object: &OwnedHandle) {
    bun_sys::windows::kernel32::WaitForSingleObject(object.as_raw_handle(), INFINITE);
}

struct WaitPacketCalls {
    create: unsafe extern "system" fn(*mut HANDLE, DWORD, *const c_void) -> NTSTATUS,
    associate: unsafe extern "system" fn(
        packet: HANDLE,
        port: HANDLE,
        target: HANDLE,
        key: usize,
        context: usize,
        status: NTSTATUS,
        information: usize,
        already_signaled: *mut BOOLEAN,
    ) -> NTSTATUS,
    cancel: unsafe extern "system" fn(packet: HANDLE, remove_signaled: BOOLEAN) -> NTSTATUS,
}

/// Queues itself on a port once an object is signalled.
pub(crate) struct WaitPacket {
    handle: OwnedHandle,
    calls: &'static WaitPacketCalls,
}

impl WaitPacket {
    /// `Ok(None)` on Wine, which has none.
    pub(crate) fn new() -> Result<Option<WaitPacket>, NTSTATUS> {
        static CALLS: OnceLock<Option<WaitPacketCalls>> = OnceLock::new();
        let calls = CALLS.get_or_init(|| {
            let ntdll = bun_core::wstr!("ntdll.dll");
            // SAFETY: https://learn.microsoft.com/en-us/windows/win32/devnotes/ntassociatewaitcompletionpacket
            unsafe {
                Some(WaitPacketCalls {
                    create: find_export(ntdll, c"NtCreateWaitCompletionPacket")?,
                    associate: find_export(ntdll, c"NtAssociateWaitCompletionPacket")?,
                    cancel: find_export(ntdll, c"NtCancelWaitCompletionPacket")?,
                })
            }
        });
        let Some(calls) = calls else { return Ok(None) };
        const GENERIC_ALL: DWORD = 0x1000_0000;
        let mut handle = ptr::null_mut();
        // SAFETY: an out-param that success fills with a new handle.
        unsafe {
            let status = (calls.create)(&raw mut handle, GENERIC_ALL, ptr::null());
            if !NT_SUCCESS(status) {
                return Err(status);
            }
            let handle = OwnedHandle::from_raw_handle(handle);
            Ok(Some(WaitPacket { handle, calls }))
        }
    }

    /// For one signal. It is queued at once if `target` is signalled already.
    pub(crate) fn associate(
        &self,
        port: &OwnedHandle,
        target: BorrowedHandle<'_>,
        key: usize,
        context: usize,
    ) -> Result<(), NTSTATUS> {
        // SAFETY: handles and integers, and a null out-param.
        let status = unsafe {
            (self.calls.associate)(
                self.handle.as_raw_handle(),
                port.as_raw_handle(),
                target.as_raw_handle(),
                key,
                context,
                NTSTATUS::SUCCESS,
                0,
                ptr::null_mut(),
            )
        };
        if NT_SUCCESS(status) {
            Ok(())
        } else {
            Err(status)
        }
    }

    /// `false` if it is on its way to the port, and cannot be associated again yet.
    pub(crate) fn cancel(&self) -> bool {
        // SAFETY: a handle and an integer.
        unsafe { (self.calls.cancel)(self.handle.as_raw_handle(), 1) != NTSTATUS::PENDING }
    }
}
