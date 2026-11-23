//! Process resource usage and priority.

use std::os::windows::io::AsRawHandle as _;

use bun_windows_sys::externs::GetCurrentThread;

use super::{
    BOOL, DWORD, GetCurrentProcess, GetProcessIoCounters, GetProcessMemoryInfo, GetProcessTimes,
    HANDLE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, Win32Error, Win32ErrorExt as _, check,
};
use crate::E;
use crate::windows_format::cpu_time::CpuUsage;
use crate::windows_format::priority_class::{class_to_nice, nice_to_class};

#[link(name = "kernel32")]
unsafe extern "system" {
    /// A `FILETIME` has the byte layout of a little-endian `u64`.
    safe fn GetThreadTimes(
        hThread: HANDLE,
        lpCreationTime: &mut u64,
        lpExitTime: &mut u64,
        lpKernelTime: &mut u64,
        lpUserTime: &mut u64,
    ) -> BOOL;
    safe fn GetPriorityClass(hProcess: HANDLE) -> DWORD;
    safe fn SetPriorityClass(hProcess: HANDLE, dwPriorityClass: DWORD) -> BOOL;
}

const PROCESS_SET_INFORMATION: DWORD = 0x0200;

/// Summed over all threads of the current process.
pub fn cpu_usage() -> Result<CpuUsage, Win32Error> {
    let times = GetProcessTimes(GetCurrentProcess())?;
    Ok(CpuUsage::from_ticks(times.user, times.kernel))
}

pub fn thread_cpu_usage() -> Result<CpuUsage, Win32Error> {
    let [mut creation, mut exit, mut kernel, mut user] = [0; 4];
    check(GetThreadTimes(
        GetCurrentThread(),
        &mut creation,
        &mut exit,
        &mut kernel,
        &mut user,
    ))?;
    Ok(CpuUsage::from_ticks(user, kernel))
}

/// What `process.memoryUsage().rss` reports, in bytes.
pub fn self_process_memory_usage() -> Option<usize> {
    let memory = GetProcessMemoryInfo(GetCurrentProcess()).ok()?;
    Some(memory.WorkingSetSize)
}

/// High-water mark of [`self_process_memory_usage`], in bytes.
pub fn self_process_peak_memory_usage() -> Option<usize> {
    let memory = GetProcessMemoryInfo(GetCurrentProcess()).ok()?;
    Some(memory.PeakWorkingSetSize)
}

#[repr(C)]
pub struct ResourceUsage {
    cpu: CpuUsage,
    peak_working_set_bytes: u64,
    page_fault_count: u64,
    read_operation_count: u64,
    write_operation_count: u64,
}

const _: () = assert!(size_of::<ResourceUsage>() == 48);

pub fn resource_usage() -> Result<ResourceUsage, Win32Error> {
    let cpu = cpu_usage()?;
    let memory = GetProcessMemoryInfo(GetCurrentProcess())?;
    let io = GetProcessIoCounters(GetCurrentProcess())?;
    Ok(ResourceUsage {
        cpu,
        peak_working_set_bytes: memory.PeakWorkingSetSize as u64,
        page_fault_count: memory.PageFaultCount.into(),
        read_operation_count: io.ReadOperationCount,
        write_operation_count: io.WriteOperationCount,
    })
}

/// `pid` 0 is the current process.
pub(super) fn with_process<T>(
    pid: DWORD,
    access: DWORD,
    f: impl FnOnce(HANDLE) -> Result<T, E>,
) -> Result<T, E> {
    if pid == 0 {
        return f(GetCurrentProcess());
    }
    match OpenProcess(access, pid) {
        Ok(process) => f(process.as_raw_handle()),
        Err(Win32Error::INVALID_PARAMETER) => Err(E::ESRCH),
        Err(error) => Err(error.to_node_errno()),
    }
}

pub fn priority(pid: DWORD) -> Result<i32, E> {
    with_process(
        pid,
        PROCESS_QUERY_LIMITED_INFORMATION,
        |process| match GetPriorityClass(process) {
            0 => Err(Win32Error::get().to_node_errno()),
            class => Ok(class_to_nice(class)),
        },
    )
}

pub fn set_priority(pid: DWORD, nice: i32) -> Result<(), E> {
    let class = nice_to_class(nice).ok_or(E::EINVAL)?;
    with_process(pid, PROCESS_SET_INFORMATION, |process| {
        check(SetPriorityClass(process, class)).map_err(Win32Error::to_node_errno)
    })
}
