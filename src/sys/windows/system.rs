//! Memory, uptime and version of the system.

use bun_core::wstr;

use super::registry::Key;
use super::{BOOL, DWORD, FALSE, NTSTATUS};
use crate::windows_format::{product_name, wide};

#[repr(C)]
struct MEMORYSTATUSEX {
    dwLength: DWORD,
    dwMemoryLoad: DWORD,
    ullTotalPhys: u64,
    ullAvailPhys: u64,
    ullTotalPageFile: u64,
    ullAvailPageFile: u64,
    ullTotalVirtual: u64,
    ullAvailVirtual: u64,
    ullAvailExtendedVirtual: u64,
}

#[repr(C)]
pub struct OSVERSIONINFOW {
    dwOSVersionInfoSize: DWORD,
    pub dwMajorVersion: DWORD,
    pub dwMinorVersion: DWORD,
    pub dwBuildNumber: DWORD,
    dwPlatformId: DWORD,
    szCSDVersion: [u16; 128],
}

bun_core::impl_zeroable!(MEMORYSTATUSEX, OSVERSIONINFOW);

const _: () = {
    assert!(size_of::<MEMORYSTATUSEX>() == 64);
    assert!(size_of::<OSVERSIONINFOW>() == 276);
};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalMemoryStatusEx(lpBuffer: &mut MEMORYSTATUSEX) -> BOOL;
    pub safe fn GetTickCount64() -> u64;
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlGetVersion(lpVersionInformation: &mut OSVERSIONINFOW) -> NTSTATUS;
}

/// In bytes.
pub struct PhysicalMemory {
    pub total: u64,
    pub available: u64,
}

pub fn physical_memory() -> Option<PhysicalMemory> {
    let mut status = MEMORYSTATUSEX {
        dwLength: size_of::<MEMORYSTATUSEX>() as DWORD,
        ..bun_core::ffi::zeroed()
    };
    // SAFETY: `status` is as large as it says.
    (unsafe { GlobalMemoryStatusEx(&mut status) } != FALSE).then_some(PhysicalMemory {
        total: status.ullTotalPhys,
        available: status.ullAvailPhys,
    })
}

pub fn version() -> OSVERSIONINFOW {
    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as DWORD,
        ..bun_core::ffi::zeroed()
    };
    // SAFETY: `info` is as large as it says. The result is always `STATUS_SUCCESS`.
    unsafe { RtlGetVersion(&mut info) };
    info
}

impl OSVERSIONINFOW {
    /// Such as `Windows 11 Pro`, in WTF-8. Empty if the registry does not say.
    pub fn product_name(&self) -> Vec<u8> {
        let name = Key::open(wstr!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"))
            .and_then(|key| key.text(wstr!("ProductName")));
        product_name::describe(
            name.unwrap_or_default(),
            self.dwMajorVersion,
            self.dwBuildNumber,
            &wide::decode_until_nul(self.szCSDVersion.iter().copied()),
        )
    }
}
