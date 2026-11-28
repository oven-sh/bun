//! The logical processors of one processor group.

use core::ffi::c_void;
use core::ptr;

use bun_core::wstr;
use bun_windows_sys::externs::{GetSystemInfo, SYSTEM_INFO};

use super::registry::Key;
use super::{NT_SUCCESS, NTSTATUS, ULONG};
use crate::windows_format::cpu_time::{ProcessorTicks, ProcessorTimes};
use crate::windows_format::wtf16;

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQuerySystemInformation(
        SystemInformationClass: ULONG,
        SystemInformation: *mut c_void,
        SystemInformationLength: ULONG,
        ReturnLength: *mut ULONG,
    ) -> NTSTATUS;
}

const SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION: ULONG = 8;

/// Ignores the process affinity mask.
pub fn count() -> u32 {
    let mut info: SYSTEM_INFO = bun_core::ffi::zeroed();
    GetSystemInfo(&mut info);
    info.dwNumberOfProcessors
}

pub struct Processor {
    /// WTF-8.
    pub model: Option<Vec<u8>>,
    pub speed_mhz: Option<u32>,
    pub times: ProcessorTimes,
}

fn open_processor_key(index: usize) -> Option<Key> {
    let mut utf8_buf = [0; 80];
    let mut utf16_buf = [0; 80];
    let path = format_args!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\{index}");
    let path = bun_core::fmt::buf_print(&mut utf8_buf, path).ok()?;
    Key::open(wtf16::encode(path, &mut utf16_buf).ok()?)
}

/// Yields [`count`] items.
pub fn processors() -> Option<impl ExactSizeIterator<Item = Processor>> {
    let mut ticks = vec![ProcessorTicks::default(); count() as usize];
    // SAFETY: `ticks` is writable for the size passed, and `ProcessorTicks` has only integer fields.
    let status = unsafe {
        NtQuerySystemInformation(
            SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION,
            ticks.as_mut_ptr().cast(),
            size_of_val(&*ticks) as ULONG,
            ptr::null_mut(),
        )
    };
    let to_processor = |(index, ticks): (usize, ProcessorTicks)| {
        let key = open_processor_key(index);
        let key = key.as_ref();
        Processor {
            model: key.and_then(|key| key.query_string(wstr!("ProcessorNameString"))),
            speed_mhz: key.and_then(|key| key.query_dword(wstr!("~MHz"))),
            times: ticks.into(),
        }
    };
    NT_SUCCESS(status).then(|| ticks.into_iter().enumerate().map(to_processor))
}
