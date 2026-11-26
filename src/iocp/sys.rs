//! Wrappers for the Win32 and NT calls that this crate makes.

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use core::cell::Cell;
use core::convert::Infallible;
use core::ffi::{c_int, c_void};
use core::ptr;
use std::os::windows::io::{
    AsRawHandle as _, BorrowedHandle, FromRawHandle as _, HandleOrNull, OwnedHandle,
};
use std::sync::OnceLock;

use bun_sys::windows::kernel32::GetCurrentThreadId;
use bun_sys::windows::{StatusBlock, find_export};
use bun_windows_sys::externs::{GetCurrentProcess, GetCurrentThread};
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
    fn NtQueryInformationThread(
        ThreadHandle: HANDLE,
        ThreadInformationClass: ULONG,
        ThreadInformation: &mut THREAD_BASIC_INFORMATION,
        ThreadInformationLength: ULONG,
        ReturnLength: Option<&mut ULONG>,
    ) -> NTSTATUS;
    fn NtSetInformationThread(
        ThreadHandle: HANDLE,
        ThreadInformationClass: ULONG,
        ThreadInformation: &i32,
        ThreadInformationLength: ULONG,
    ) -> NTSTATUS;
    /// `IoRequestToCancel` is compared, never dereferenced.
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
    safe fn CreateWaitableTimerExW(
        lpTimerAttributes: Option<&Infallible>,
        lpTimerName: Option<&Infallible>,
        dwFlags: DWORD,
        dwDesiredAccess: DWORD,
    ) -> HandleOrNull;
    safe fn SetWaitableTimer(
        hTimer: HANDLE,
        lpDueTime: &i64,
        lPeriod: i32,
        pfnCompletionRoutine: Option<&Infallible>,
        lpArgToCompletionRoutine: Option<&Infallible>,
        fResume: BOOL,
    ) -> BOOL;
    safe fn GetSystemTimeAsFileTime(lpSystemTimeAsFileTime: &mut FILETIME);
    safe fn GetPriorityClass(hProcess: HANDLE) -> DWORD;
    safe fn GetThreadPriorityBoost(hThread: HANDLE, pDisablePriorityBoost: &mut BOOL) -> BOOL;
    safe fn CancelSynchronousIo(hThread: HANDLE) -> BOOL;
    safe fn OpenThread(
        dwDesiredAccess: DWORD,
        bInheritHandle: BOOL,
        dwThreadId: DWORD,
    ) -> HandleOrNull;
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

fn query_bsp_socket(socket: usize, control_code: DWORD) -> Result<usize, Win32Error> {
    let mut bsp_socket = socket;
    // SAFETY: the output buffer has the size passed, and the call is synchronous.
    let rc = unsafe {
        WSAIoctl(
            socket,
            control_code,
            ptr::null(),
            0,
            (&raw mut bsp_socket).cast(),
            size_of::<usize>() as DWORD,
            &mut 0,
            ptr::null_mut(),
            ptr::null(),
        )
    };
    if rc == 0 {
        Ok(bsp_socket)
    } else {
        Err(Win32Error::get())
    }
}

/// Returns the base provider's socket underneath any layered service providers (LSPs).
pub(crate) fn find_base_socket(mut socket: usize) -> Result<usize, Win32Error> {
    const SIO_BASE_HANDLE: DWORD = 0x4800_0022;
    const SIO_BSP_HANDLE: DWORD = 0x4800_001B;
    const SIO_BSP_HANDLE_SELECT: DWORD = 0x4800_001C;
    const SIO_BSP_HANDLE_POLL: DWORD = 0x4800_001D;
    const MAX_LSP_DEPTH: u32 = 16;
    bun_windows_sys::ws2_32::ensure_started();
    for _ in 0..MAX_LSP_DEPTH {
        match query_bsp_socket(socket, SIO_BASE_HANDLE) {
            Ok(base_socket) => return Ok(base_socket),
            Err(err @ Win32Error::WSAENOTSOCK) => return Err(err),
            Err(_) => {}
        }
        // Some LSPs reject `SIO_BASE_HANDLE` but pass one of these through.
        let next_socket = [SIO_BSP_HANDLE_POLL, SIO_BSP_HANDLE_SELECT, SIO_BSP_HANDLE]
            .into_iter()
            .filter_map(|control_code| query_bsp_socket(socket, control_code).ok())
            .find(|&bsp_socket| bsp_socket != socket);
        let Some(next_socket) = next_socket else {
            break;
        };
        socket = next_socket;
    }
    Ok(socket)
}

/// Opens a handle for `IOCTL_AFD_POLL` requests.
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
    // SAFETY: the pointers refer to locals or are null, and on success `device` holds a new handle.
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

pub(crate) fn create_port(concurrency: DWORD) -> Result<OwnedHandle, Win32Error> {
    let port = CreateIoCompletionPort(INVALID_HANDLE_VALUE, ptr::null_mut(), 0, concurrency);
    // SAFETY: `port` is a new handle or null.
    OwnedHandle::try_from(unsafe { HandleOrNull::from_raw_handle(port) })
        .map_err(|_| Win32Error::get())
}

/// Permanent, and applies to every handle to the same file object.
pub(crate) fn bind_file(port: &OwnedHandle, file: HANDLE, key: usize) -> Result<(), Win32Error> {
    if CreateIoCompletionPort(file, port.as_raw_handle(), key, 0).is_null() {
        return Err(Win32Error::get());
    }
    Ok(())
}

pub(crate) const FILE_SKIP_COMPLETION_PORT_ON_SUCCESS: u8 = 1;
pub(crate) const FILE_SKIP_SET_EVENT_ON_HANDLE: u8 = 2;

/// Permanent and per file object, like `bind_file`.
pub(crate) fn set_notification_modes(file: HANDLE, modes: u8) -> Result<(), Win32Error> {
    if SetFileCompletionNotificationModes(file, modes) == 0 {
        return Err(Win32Error::get());
    }
    Ok(())
}

/// In units of 100 ns.
#[derive(Copy, Clone)]
pub(crate) enum Timeout {
    Infinite,
    Zero,
    Relative(i64),
    /// Like `Relative`, but on the system clock, which keeps advancing while the machine sleeps.
    WallClock(i64),
}

/// Fills `packets` from the start and returns how many were dequeued.
pub(crate) fn dequeue_packets(
    port: &OwnedHandle,
    packets: &[Cell<Packet>],
    timeout: Timeout,
) -> usize {
    let timeout = match timeout {
        Timeout::Infinite => None,
        Timeout::Zero => Some(0),
        Timeout::Relative(ticks) => Some(-ticks),
        Timeout::WallClock(ticks) => {
            let mut now: FILETIME = bun_core::ffi::zeroed();
            GetSystemTimeAsFileTime(&mut now);
            let now = (i64::from(now.dwHighDateTime) << 32) | i64::from(now.dwLowDateTime);
            Some(now.saturating_add(ticks))
        }
    };
    let mut count = 0;
    // SAFETY: the cells are writable, and any bytes are a valid `Packet`.
    let status = unsafe {
        NtRemoveIoCompletionEx(
            port.as_raw_handle(),
            packets.as_ptr().cast_mut().cast(),
            packets.len() as ULONG,
            &mut count,
            timeout.as_ref(),
            0,
        )
    };
    match status {
        NTSTATUS::SUCCESS => (count as usize).min(packets.len()),
        NTSTATUS::TIMEOUT => 0,
        status => panic!("NtRemoveIoCompletionEx failed: {status:x?}"),
    }
}

pub(crate) fn post_packet(port: &OwnedHandle, key: usize, context: usize) {
    let status = NtSetIoCompletion(port.as_raw_handle(), key, context, NTSTATUS::SUCCESS, 0);
    assert!(NT_SUCCESS(status), "NtSetIoCompletion failed: {status:x?}");
}

/// Asynchronous: the request still completes, possibly with success.
pub(crate) fn cancel_io(file: HANDLE, request: &StatusBlock) {
    NtCancelIoFileEx(file, request.as_ptr(), &mut bun_core::ffi::zeroed());
}

pub(crate) fn cancel_synchronous_io(thread: HANDLE) {
    CancelSynchronousIo(thread);
}

#[repr(C)]
#[derive(Default)]
pub(crate) struct THREAD_BASIC_INFORMATION {
    _unused: [usize; 5],
    pub(crate) Priority: i32,
    /// Relative to the base priority of the process.
    pub(crate) BasePriority: i32,
}

pub(crate) const IDLE_PRIORITY_CLASS: DWORD = 0x40;
const BELOW_NORMAL_PRIORITY_CLASS: DWORD = 0x4000;
pub(crate) const NORMAL_PRIORITY_CLASS: DWORD = 0x20;
const ABOVE_NORMAL_PRIORITY_CLASS: DWORD = 0x8000;

/// The scheduling priority of the current thread.
pub(crate) struct Priority {
    base: i32,
    dynamic: i32,
}

impl Priority {
    /// `None` if the thread has a non-default base priority or boosting disabled, or the class is high or realtime.
    pub(crate) fn query() -> Option<Priority> {
        const ThreadBasicInformation: ULONG = 0;
        let base = match GetPriorityClass(GetCurrentProcess()) {
            IDLE_PRIORITY_CLASS => 4,
            BELOW_NORMAL_PRIORITY_CLASS => 6,
            NORMAL_PRIORITY_CLASS => 8,
            ABOVE_NORMAL_PRIORITY_CLASS => 10,
            _ => return None,
        };
        let mut info = THREAD_BASIC_INFORMATION::default();
        let size = size_of_val(&info) as ULONG;
        // SAFETY: the class and the size are those of `info`.
        unsafe {
            NtQueryInformationThread(
                GetCurrentThread(),
                ThreadBasicInformation,
                &mut info,
                size,
                None,
            )
        };
        let dynamic = info.Priority;
        let mut is_boost_disabled = 0;
        GetThreadPriorityBoost(GetCurrentThread(), &mut is_boost_disabled);
        (info.BasePriority == 0 && is_boost_disabled == 0).then_some(Priority { base, dynamic })
    }

    pub(crate) fn boost(&self) -> i32 {
        self.dynamic - self.base
    }

    /// Decays like an I/O boost: one level per quantum, and after a long wait.
    pub(crate) fn set_boost(&self, levels: i32) {
        // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/nf-wdm-zwsetinformationthread
        const ThreadPriority: ULONG = 2;
        // SAFETY: the value of this class is an `i32`.
        unsafe {
            NtSetInformationThread(
                GetCurrentThread(),
                ThreadPriority,
                &(self.base + levels),
                size_of::<i32>() as ULONG,
            )
        };
    }
}

/// The handle has the `THREAD_TERMINATE` right that `CancelSynchronousIo` requires.
pub(crate) fn open_current_thread() -> Option<OwnedHandle> {
    const THREAD_TERMINATE: DWORD = 1;
    OwnedHandle::try_from(OpenThread(THREAD_TERMINATE, 0, GetCurrentThreadId())).ok()
}

pub(crate) fn create_high_resolution_timer() -> Option<OwnedHandle> {
    const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: DWORD = 2;
    const TIMER_MODIFY_STATE: DWORD = 2;
    let timer = CreateWaitableTimerExW(
        None,
        None,
        CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
        bun_windows_sys::SYNCHRONIZE | TIMER_MODIFY_STATE,
    );
    OwnedHandle::try_from(timer).ok()
}

/// `ticks` is a relative due time in units of 100 ns.
pub(crate) fn set_timer(timer: &OwnedHandle, ticks: i64) -> bool {
    SetWaitableTimer(timer.as_raw_handle(), &-ticks, 0, None, None, 0) != 0
}

pub(crate) fn wait_for_object(object: &OwnedHandle) {
    bun_sys::windows::kernel32::WaitForSingleObject(object.as_raw_handle(), INFINITE);
}

struct WaitPacketApi {
    create: unsafe extern "system" fn(*mut HANDLE, DWORD, *const c_void) -> NTSTATUS,
    associate: extern "system" fn(
        packet: HANDLE,
        port: HANDLE,
        target: HANDLE,
        key: usize,
        context: usize,
        status: NTSTATUS,
        information: usize,
        already_signaled: Option<&mut BOOLEAN>,
    ) -> NTSTATUS,
    cancel: extern "system" fn(packet: HANDLE, remove_signaled: BOOLEAN) -> NTSTATUS,
}

/// A wait completion packet: the kernel queues it to a port once an object is signaled.
pub(crate) struct WaitPacket {
    handle: OwnedHandle,
    api: &'static WaitPacketApi,
}

impl WaitPacket {
    /// `Ok(None)` if ntdll lacks the API, as on Wine.
    pub(crate) fn new() -> Result<Option<WaitPacket>, NTSTATUS> {
        static API: OnceLock<Option<WaitPacketApi>> = OnceLock::new();
        let api = API.get_or_init(|| {
            let ntdll = bun_core::wstr!("ntdll.dll");
            // SAFETY: the field types match the documented signatures.
            // https://learn.microsoft.com/en-us/windows/win32/devnotes/ntassociatewaitcompletionpacket
            unsafe {
                Some(WaitPacketApi {
                    create: find_export(ntdll, c"NtCreateWaitCompletionPacket")?,
                    associate: find_export(ntdll, c"NtAssociateWaitCompletionPacket")?,
                    cancel: find_export(ntdll, c"NtCancelWaitCompletionPacket")?,
                })
            }
        });
        let Some(api) = api else { return Ok(None) };
        const GENERIC_ALL: DWORD = 0x1000_0000;
        let mut handle = ptr::null_mut();
        // SAFETY: `handle` is a valid out-pointer, and on success holds a new handle.
        unsafe {
            let status = (api.create)(&raw mut handle, GENERIC_ALL, ptr::null());
            if !NT_SUCCESS(status) {
                return Err(status);
            }
            let handle = OwnedHandle::from_raw_handle(handle);
            Ok(Some(WaitPacket { handle, api }))
        }
    }

    /// One-shot. The packet is queued immediately if `target` is already signaled.
    pub(crate) fn associate(
        &self,
        port: &OwnedHandle,
        target: BorrowedHandle<'_>,
        key: usize,
        context: usize,
    ) -> Result<(), NTSTATUS> {
        let status = (self.api.associate)(
            self.handle.as_raw_handle(),
            port.as_raw_handle(),
            target.as_raw_handle(),
            key,
            context,
            NTSTATUS::SUCCESS,
            0,
            None,
        );
        if NT_SUCCESS(status) {
            Ok(())
        } else {
            Err(status)
        }
    }

    /// Returns `false` if the packet is already being queued and cannot be associated again yet.
    pub(crate) fn try_cancel(&self) -> bool {
        (self.api.cancel)(self.handle.as_raw_handle(), 1) != NTSTATUS::PENDING
    }
}
