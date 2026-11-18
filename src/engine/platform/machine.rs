use std::sync::OnceLock;

/// The bytes of memory that the process may use.
pub fn ram_size() -> usize {
    const GUESS: u64 = 1536 << 20;
    static SIZE: OnceLock<usize> = OnceLock::new();
    *SIZE.get_or_init(|| available_memory().unwrap_or(GUESS) as usize)
}

/// Of those that the process may use.
pub fn processor_count() -> u32 {
    static COUNT: OnceLock<u32> = OnceLock::new();
    *COUNT.get_or_init(|| available_processors().unwrap_or(1).max(1))
}

pub const KNOWS_FOOTPRINT: bool = !cfg!(any(target_os = "freebsd", windows));

/// The bytes of memory that the process uses now, where that is cheap to find out.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn memory_footprint() -> Option<usize> {
    use bun_sys::{Fd, FdExt, File, O};
    let path = b"/proc/self/statm";
    let file = File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0).ok()?;
    let mut buffer = [0; 128];
    let length = file.read(&mut buffer);
    // The program may have closed a standard stream, whose number the file has got.
    let _ = file.into_raw().close_allowing_standard_io(None);
    let resident = bun_core::strings::split(&buffer[..length.ok()?], b" ").nth(1)?;
    let pages: usize = core::str::from_utf8(resident).ok()?.parse().ok()?;
    Some(pages * bun_alloc::page_size())
}

#[cfg(target_os = "macos")]
pub fn memory_footprint() -> Option<usize> {
    /// `task_vm_info`, revision 1.
    #[repr(C, packed(4))]
    struct VirtualMemoryInformation {
        before: [u64; 18],
        physical_footprint: u64,
    }
    unsafe extern "C" {
        static mach_task_self_: u32;
        fn task_info(task: u32, flavor: u32, information: *mut i32, count: &mut u32) -> i32;
    }
    const TASK_VM_INFO: u32 = 22;
    let mut information = VirtualMemoryInformation {
        before: [0; 18],
        physical_footprint: 0,
    };
    let mut count = (size_of_val(&information) / size_of::<i32>()) as u32;
    // SAFETY: room for that many integers.
    let result = unsafe {
        let information = (&raw mut information).cast();
        task_info(mach_task_self_, TASK_VM_INFO, information, &mut count)
    };
    (result == 0).then_some(information.physical_footprint as usize)
}

#[cfg(any(target_os = "freebsd", windows))]
pub fn memory_footprint() -> Option<usize> {
    None
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn available_memory() -> Option<u64> {
    let information = bun_sys::posix::sysinfo().ok()?;
    let total = information.totalram * u64::from(information.mem_unit);
    Some(crate::cgroup::memory_limit().map_or(total, |limit| limit.min(total)))
}

#[cfg(target_os = "macos")]
fn available_memory() -> Option<u64> {
    let mut size = 0u64;
    bun_sys::posix::sysctl_read(c"hw.memsize", &mut size).ok()?;
    Some(size.next_multiple_of(128 << 20))
}

#[cfg(target_os = "freebsd")]
fn available_memory() -> Option<u64> {
    let mut size = 0u64;
    bun_sys::posix::sysctl_read(c"hw.physmem", &mut size).ok()?;
    Some(size)
}

#[cfg(windows)]
fn available_memory() -> Option<u64> {
    #[derive(Default)]
    #[repr(C)]
    struct MemoryStatus {
        length: u32,
        load: u32,
        total_physical: u64,
        others: [u64; 6],
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn GlobalMemoryStatusEx(status: &mut MemoryStatus) -> i32;
    }
    let mut status = MemoryStatus {
        length: size_of::<MemoryStatus>() as u32,
        ..MemoryStatus::default()
    };
    (GlobalMemoryStatusEx(&mut status) != 0).then_some(status.total_physical)
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
fn online_processors() -> Option<u32> {
    // SAFETY: no preconditions.
    let count = unsafe { libc::sysconf(libc::_SC_NPROCESSORS_ONLN) };
    u32::try_from(count).ok().filter(|&count| count != 0)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn available_processors() -> Option<u32> {
    let mut set = core::mem::MaybeUninit::<libc::cpu_set_t>::zeroed();
    // SAFETY: a set of that size, for which zero is a value.
    let affinity = unsafe {
        (libc::sched_getaffinity(0, size_of_val(&set), set.as_mut_ptr()) == 0)
            .then(|| libc::CPU_COUNT(set.assume_init_ref()) as u32)
    };
    let quota = crate::cgroup::processor_limit().and_then(|limit| u32::try_from(limit).ok());
    [online_processors(), affinity, quota]
        .into_iter()
        .flatten()
        .filter(|&count| count != 0)
        .min()
}

#[cfg(target_os = "freebsd")]
fn available_processors() -> Option<u32> {
    online_processors()
}

#[cfg(target_os = "macos")]
fn available_processors() -> Option<u32> {
    let mut count = 0u32;
    bun_sys::posix::sysctl_read(c"hw.activecpu", &mut count).ok()?;
    Some(count)
}

#[cfg(windows)]
fn available_processors() -> Option<u32> {
    let mut information = core::mem::MaybeUninit::<bun_windows_sys::SYSTEM_INFO>::uninit();
    // SAFETY: it fills in the struct and cannot fail.
    unsafe {
        bun_windows_sys::GetSystemInfo(information.as_mut_ptr());
        Some(information.assume_init_ref().dwNumberOfProcessors)
    }
}
