//! What the system knows about this process, its user and the machine.

use core::ffi::c_int;

use crate::{E, Error, Maybe, Tag};

unsafe extern "C" {
    #[link_name = "getrusage"]
    safe fn libc_getrusage(who: c_int, usage: &mut libc::rusage) -> c_int;
    #[cfg(bun_fuzzilli)]
    pub safe fn setpgid(process: libc::pid_t, group: libc::pid_t) -> c_int;
}

/// `who` is `RUSAGE_SELF` or `RUSAGE_CHILDREN`, for which it cannot fail.
pub fn getrusage(who: c_int) -> libc::rusage {
    let mut usage = bun_core::ffi::zeroed();
    libc_getrusage(who, &mut usage);
    usage
}

pub fn local_time_now() -> libc::tm {
    let now = bun_core::time::timestamp() as _;
    let mut time = bun_core::ffi::zeroed();
    // SAFETY: it reads `now` and writes `time`.
    unsafe { libc::localtime_r(&raw const now, &raw mut time) };
    time
}

/// From the user database, not from `$HOME`. `None` if the user has no entry.
pub fn home_directory_of(user: libc::uid_t) -> Maybe<Option<Box<[u8]>>> {
    let mut strings = vec![0u8; 4096];
    let mut entry: libc::passwd = bun_core::ffi::zeroed();
    let mut found = core::ptr::null_mut();
    loop {
        let (start, len) = (strings.as_mut_ptr().cast(), strings.len());
        // SAFETY: it writes `entry`, `found` and at most `len` bytes of `strings`.
        match unsafe { libc::getpwuid_r(user, &raw mut entry, start, len, &raw mut found) } {
            0 => break,
            libc::EINTR => {}
            libc::ERANGE => strings.resize(len * 2, 0),
            errno => {
                let errno = E::from_raw(errno as u16);
                return Err(Error::from_code(errno, Tag::uv_os_homedir));
            }
        }
    }
    if found.is_null() {
        return Ok(None);
    }
    if entry.pw_dir.is_null() {
        return Ok(Some(Box::default()));
    }
    // SAFETY: it points to a C string in `strings`, or to a constant of libc.
    let directory = unsafe { bun_core::ffi::cstr(entry.pw_dir) };
    Ok(Some(directory.to_bytes().into()))
}

/// It can't be undone on Linux.
pub fn lower_current_thread_priority() {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: no pointers. On Linux, `who == 0` is the calling thread.
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 19);
    }
    #[cfg(target_os = "macos")]
    // SAFETY: no pointers.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
    }
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub fn glibc_version() -> &'static [u8] {
    // SAFETY: it returns a constant C string.
    unsafe { bun_core::ffi::cstr(libc::gnu_get_libc_version()) }.to_bytes()
}

/// Whether address randomization is off, for this process and for the programs that it starts.
#[cfg(all(bun_hardened, target_os = "linux"))]
pub fn has_fixed_addresses() -> bool {
    const ASKS_FOR_THE_PERSONALITY: libc::c_ulong = 0xffff_ffff;
    // SAFETY: the request takes and returns integers only.
    let personality = unsafe { libc::personality(ASKS_FOR_THE_PERSONALITY) };
    personality != -1 && personality & libc::ADDR_NO_RANDOMIZE != 0
}

/// SAFETY: `program` reports success for no call that it keeps from the kernel.
#[cfg(all(bun_hardened, target_os = "linux"))]
pub unsafe fn filter_system_calls_of_all_threads(program: &[libc::sock_filter]) -> Result<(), E> {
    let filter = libc::sock_fprog {
        len: program.len().try_into().map_err(|_| E::EINVAL)?,
        filter: program.as_ptr().cast_mut(),
    };
    // SAFETY: the kernel copies the program before the call returns.
    let answer = unsafe {
        libc::syscall(
            libc::SYS_seccomp,
            libc::c_ulong::from(libc::SECCOMP_SET_MODE_FILTER),
            libc::SECCOMP_FILTER_FLAG_TSYNC,
            &raw const filter,
        )
    };
    match answer {
        0 => Ok(()),
        -1 => Err(bun_errno::from_errno(crate::last_errno())),
        // The id of a thread that could not take the filter.
        _ => Err(E::ESRCH),
    }
}

#[cfg(target_os = "freebsd")]
pub fn getloadavg() -> Option<[f64; 3]> {
    let mut averages = [0.0; 3];
    // SAFETY: it writes at most three numbers.
    let count = unsafe { libc::getloadavg(averages.as_mut_ptr(), 3) };
    (count == 3).then_some(averages)
}

#[cfg(target_os = "macos")]
pub fn parent_of(process: libc::pid_t) -> Option<libc::pid_t> {
    let mut info: libc::proc_bsdinfo = bun_core::ffi::zeroed();
    let size = size_of_val(&info) as c_int;
    let buffer = (&raw mut info).cast();
    // SAFETY: it writes at most `size` bytes, as the type that the flavor names.
    let written = unsafe { libc::proc_pidinfo(process, libc::PROC_PIDTBSDINFO, 0, buffer, size) };
    (written == size).then_some(info.pbi_ppid.cast_signed())
}

/// Returns how many it wrote. `None` if there are none.
#[cfg(target_os = "macos")]
pub fn children_of(parent: libc::pid_t, out: &mut [libc::pid_t]) -> Option<usize> {
    let size = c_int::try_from(size_of_val(out)).ok()?;
    // SAFETY: it writes at most `size` bytes.
    let count = unsafe { libc::proc_listchildpids(parent, out.as_mut_ptr().cast(), size) };
    (count > 0).then(|| (count as usize).min(out.len()))
}

/// In bytes. Unlike `ru_maxrss`, it leaves out what has been released but not yet reclaimed.
#[cfg(target_os = "macos")]
pub fn peak_footprint() -> Option<u64> {
    let mut info: libc::rusage_info_v4 = bun_core::ffi::zeroed();
    let (process, buffer) = (std::process::id().cast_signed(), (&raw mut info).cast());
    // SAFETY: `info` has the type that the flavor names.
    let rc = unsafe { libc::proc_pid_rusage(process, libc::RUSAGE_INFO_V4, buffer) };
    (rc == 0).then_some(info.ri_lifetime_max_phys_footprint)
}

/// One entry for each processor.
#[cfg(target_os = "macos")]
pub fn processor_load() -> Option<Vec<libc::processor_cpu_load_info>> {
    use crate::c::{mach_host_self, mach_task_self, vm_deallocate};
    let (mut processors, mut integers) = (0, 0);
    let mut start: libc::processor_info_array_t = core::ptr::null_mut();
    // SAFETY: it writes the three, and maps `integers` integers at `start` for this function to unmap.
    unsafe {
        if libc::host_processor_info(
            mach_host_self(),
            libc::PROCESSOR_CPU_LOAD_INFO,
            &raw mut processors,
            &raw mut start,
            &raw mut integers,
        ) != 0
        {
            return None;
        }
        let size = integers as usize * size_of::<libc::integer_t>();
        let load = (size == processors as usize * size_of::<libc::processor_cpu_load_info>())
            .then(|| bun_core::ffi::slice(start.cast(), processors as usize).to_vec());
        vm_deallocate(mach_task_self(), start as usize, size);
        load
    }
}
