//! Windows implementations of what `BunProcess.cpp` gets from libc on POSIX.

use core::ffi::c_int;

use bun_sys::windows::process_info::{self, ResourceUsage};
use bun_sys::windows::{self, Win32Error, Win32ErrorExt as _};
use bun_sys::windows_format::cpu_time::CpuUsage;

/// Returns 0 or a libuv error code.
fn store_result<T>(result: Result<T, Win32Error>, out: &mut T) -> c_int {
    match result {
        Ok(value) => {
            *out = value;
            0
        }
        Err(error) => bun_errno::errno_to_uv(error.to_node_errno()),
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Process__getCpuUsage(usage: &mut CpuUsage) -> c_int {
    store_result(process_info::cpu_usage(), usage)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Process__getThreadCpuUsage(usage: &mut CpuUsage) -> c_int {
    store_result(process_info::thread_cpu_usage(), usage)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Process__getResourceUsage(usage: &mut ResourceUsage) -> c_int {
    store_result(process_info::resource_usage(), usage)
}

fn store_size(size: Option<usize>, out: &mut usize) -> c_int {
    let Some(size) = size else { return -1 };
    *out = size;
    0
}

#[unsafe(no_mangle)]
extern "C" fn getRSS(rss: &mut usize) -> c_int {
    store_size(bun_sys::self_process_memory_usage(), rss)
}

#[unsafe(no_mangle)]
extern "C" fn getPeakRSS(peak: &mut usize) -> c_int {
    store_size(bun_sys::self_process_peak_memory_usage(), peak)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Process__getParentId() -> i32 {
    windows::parent_process_id().map_or(-1, |id| id as i32)
}

/// SAFETY: `bytes` is valid for reads of `len` bytes and is not mutated during the call.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Process__writeAllToStdio(fd: i32, bytes: *const u8, len: usize) -> bool {
    // SAFETY: fn contract.
    let bytes = unsafe { bun_core::ffi::slice(bytes, len) };
    bun_sys::write_all_to_stdio(bun_sys::Fd::from_crt(fd), bytes).is_ok()
}
