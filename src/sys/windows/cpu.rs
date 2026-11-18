//! The logical processors of one processor group.

use core::ffi::c_void;
use core::mem::MaybeUninit;
use core::ptr;

use bun_core::wstr;
use bun_windows_sys::externs::{GetSystemInfo, SYSTEM_INFO};

use super::registry::Key;
use super::{NT_SUCCESS, NTSTATUS, ULONG};
use crate::windows_format::cpu_time::{ProcessorTicks, ProcessorTimes};
use crate::windows_format::wide;

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

/// Ignores the affinity mask.
pub fn count() -> u32 {
    let mut info = MaybeUninit::<SYSTEM_INFO>::zeroed();
    // SAFETY: it writes a `SYSTEM_INFO`, for which any bytes are valid.
    unsafe {
        GetSystemInfo(info.as_mut_ptr());
        info.assume_init().dwNumberOfProcessors
    }
}

pub struct Processor {
    /// WTF-8.
    pub model: Option<Vec<u8>>,
    pub mhz: Option<u32>,
    pub times: ProcessorTimes,
}

fn description(index: usize) -> Option<Key> {
    let (mut narrow, mut units) = ([0; 80], [0; 80]);
    let path = format_args!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\{index}");
    let path = bun_core::fmt::buf_print(&mut narrow, path).ok()?;
    Key::open(wide::encode(path, &mut units).ok()?)
}

/// As many as [`count`] says.
pub fn processors() -> Option<impl ExactSizeIterator<Item = Processor>> {
    let mut ticks = vec![ProcessorTicks::default(); count() as usize];
    // SAFETY: it writes at most the size given, and `ProcessorTicks` has integers only.
    let status = unsafe {
        NtQuerySystemInformation(
            SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION,
            ticks.as_mut_ptr().cast(),
            size_of_val(&*ticks) as ULONG,
            ptr::null_mut(),
        )
    };
    let processor = |(index, ticks): (usize, ProcessorTicks)| {
        let key = description(index);
        let key = key.as_ref();
        Processor {
            model: key.and_then(|key| key.text(wstr!("ProcessorNameString"))),
            mhz: key.and_then(|key| key.number(wstr!("~MHz"))),
            times: ticks.into(),
        }
    };
    NT_SUCCESS(status).then(|| ticks.into_iter().enumerate().map(processor))
}
