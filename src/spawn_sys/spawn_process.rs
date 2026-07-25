//! Raw `spawn_process_posix` + option/result types — split out of
//! `bun_spawn::process` so the fd/action plumbing has no event-loop
//! dependency. `Process`/`Poller`/`WaiterThread`/`sync` stay in `bun_spawn`.

#[cfg(any(target_os = "linux", target_os = "android"))]
use core::ffi::CStr;
use core::ffi::c_char;
#[cfg(target_os = "macos")]
use core::ffi::{c_int, c_void};
#[cfg(unix)]
use core::sync::atomic::Ordering;

#[cfg(target_os = "macos")]
use bun_core::Output;
use bun_sys::{self, Fd, FdExt as _};

#[cfg(not(windows))]
use crate::posix_spawn::posix_spawn;
#[cfg(unix)]
use posix_spawn::{Actions as PosixSpawnActions, Attr as PosixSpawnAttr};

#[cfg(unix)]
use crate::{Argv, Envp};

// ──────────────────────────────────────────────────────────────────────────
// PID / fd width aliases
// ──────────────────────────────────────────────────────────────────────────

#[cfg(unix)]
pub type PidT = libc::pid_t;
#[cfg(windows)]
pub type PidT = bun_libuv_sys::uv_pid_t;

#[cfg(unix)]
pub type FdT = libc::c_int;
#[cfg(not(unix))]
pub type FdT = i32;

#[cfg(any(target_os = "linux", target_os = "android"))]
pub type PidFdType = FdT;
#[cfg(not(any(target_os = "linux", target_os = "android")))]
pub type PidFdType = ();

// ──────────────────────────────────────────────────────────────────────────
// Rusage — platform-uniform resource-usage struct
//
// One Bun-level type per target. On every Unix this is `libc::rusage` —
// the libc crate defines `rusage` on FreeBSD with
// the standard `ru_*` field names, so no hand-rolled FreeBSD struct is
// needed. On Windows it is the value-typed `WinRusage` below (NOT
// `uv_rusage_t` — that is vendor FFI ABI in `bun_libuv_sys` and stays
// untouched; our Windows path fills `WinRusage` directly from Win32, not
// via libuv).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default, Clone, Copy)]
pub struct WinTimeval {
    pub sec: i64,
    pub usec: i64,
}

#[derive(Default, Clone, Copy)]
pub struct WinRusage {
    pub utime: WinTimeval,
    pub stime: WinTimeval,
    pub maxrss: u64,
    // ixrss, idrss, isrss, minflt, majflt, nswap: always zero — omitted
    pub inblock: u64,
    pub oublock: u64,
    // msgsnd, msgrcv, nsignals, nvcsw, nivcsw: always zero — omitted
}

pub type IoCounters = bun_windows_sys::IO_COUNTERS;

#[cfg(windows)]
unsafe extern "system" {
    // IoCounters = bun_windows_sys::IO_COUNTERS (alias resolves, no change)
    fn GetProcessIoCounters(
        handle: bun_sys::windows::HANDLE,
        counters: *mut IoCounters,
    ) -> core::ffi::c_int;
}

#[cfg(windows)]
pub fn uv_getrusage(process: &mut bun_libuv_sys::uv_process_t) -> WinRusage {
    use core::ffi::c_void;
    let mut usage_info = Rusage::default();
    let process_pid: *mut c_void = process.process_handle;
    type WinTime = bun_sys::windows::FILETIME;
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut starttime: WinTime = unsafe { bun_core::ffi::zeroed_unchecked() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut exittime: WinTime = unsafe { bun_core::ffi::zeroed_unchecked() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut kerneltime: WinTime = unsafe { bun_core::ffi::zeroed_unchecked() };
    // SAFETY: all-zero is a valid FILETIME (POD C struct)
    let mut usertime: WinTime = unsafe { bun_core::ffi::zeroed_unchecked() };
    // We at least get process times
    // SAFETY: FFI call with valid out-pointers
    if unsafe {
        bun_sys::windows::GetProcessTimes(
            process_pid,
            &mut starttime,
            &mut exittime,
            &mut kerneltime,
            &mut usertime,
        )
    } != 0
    {
        // FILETIME is in 100-nanosecond ticks. 1 s = 10_000_000 ticks; 1 µs =
        // 10 ticks. A `temp % 1_000_000` computation here would be
        // unit-mismatched (a 100-ns tick count modulo a microsecond
        // denominator): a 178 125 µs run (1_781_250 ticks) would report as
        // 781_250 µs, which is what tips the "does not use 100% cpu >
        // install" test (`cpuTime.total < 750_000`) on Windows aarch64.
        // Convert correctly: `(ticks % 10_000_000) / 10`.
        let mut temp: u64 =
            ((kerneltime.dwHighDateTime as u64) << 32) | kerneltime.dwLowDateTime as u64;
        if temp > 0 {
            usage_info.stime.sec = (temp / 10_000_000) as i64;
            usage_info.stime.usec = ((temp % 10_000_000) / 10) as i64;
        }
        temp = ((usertime.dwHighDateTime as u64) << 32) | usertime.dwLowDateTime as u64;
        if temp > 0 {
            usage_info.utime.sec = (temp / 10_000_000) as i64;
            usage_info.utime.usec = ((temp % 10_000_000) / 10) as i64;
        }
    }
    let mut counters = IoCounters::default();
    // SAFETY: FFI call with valid out-pointer
    let _ = unsafe { GetProcessIoCounters(process_pid, &mut counters) };
    usage_info.inblock = counters.ReadOperationCount;
    usage_info.oublock = counters.WriteOperationCount;

    let Ok(memory) = bun_sys::windows::GetProcessMemoryInfo(process_pid) else {
        return usage_info;
    };
    usage_info.maxrss = (memory.PeakWorkingSetSize / 1024) as u64;

    usage_info
}

#[cfg(windows)]
pub type Rusage = WinRusage;
#[cfg(unix)]
pub type Rusage = libc::rusage;

// SAFETY: `i64`/`u64` only (via `WinTimeval`); all-zero matches `Default`.
unsafe impl bun_core::ffi::Zeroable for WinRusage {}

#[inline]
pub fn rusage_zeroed() -> Rusage {
    bun_core::ffi::zeroed()
}

/// Platform-uniform field accessors over [`Rusage`]. The underlying alias has
/// divergent field names (`ru_*` on every Unix `libc::rusage`; bare names on
/// `WinRusage` with several always-zero/absent counters). This trait gives
/// JS-facing getters one cfg-free body with uniform names.
pub trait RusageFields {
    fn utime_sec(&self) -> i64;
    fn utime_usec(&self) -> i64;
    fn stime_sec(&self) -> i64;
    fn stime_usec(&self) -> i64;
    fn maxrss_(&self) -> f64;
    fn ixrss_(&self) -> f64;
    fn nswap_(&self) -> f64;
    fn inblock_(&self) -> f64;
    fn oublock_(&self) -> f64;
    fn msgsnd_(&self) -> f64;
    fn msgrcv_(&self) -> f64;
    fn nsignals_(&self) -> f64;
    fn nvcsw_(&self) -> f64;
    fn nivcsw_(&self) -> f64;
}

#[cfg(unix)]
impl RusageFields for libc::rusage {
    // `tv_sec`/`tv_usec` are `i64` on linux but `i32` on darwin (`suseconds_t`);
    // the `as i64` is required for the latter and a no-op on the former.
    #[inline]
    fn utime_sec(&self) -> i64 {
        self.ru_utime.tv_sec
    }
    #[inline]
    fn utime_usec(&self) -> i64 {
        self.ru_utime.tv_usec as i64
    }
    #[inline]
    fn stime_sec(&self) -> i64 {
        self.ru_stime.tv_sec
    }
    #[inline]
    fn stime_usec(&self) -> i64 {
        self.ru_stime.tv_usec as i64
    }
    #[inline]
    fn maxrss_(&self) -> f64 {
        self.ru_maxrss as f64
    }
    #[inline]
    fn ixrss_(&self) -> f64 {
        self.ru_ixrss as f64
    }
    #[inline]
    fn nswap_(&self) -> f64 {
        self.ru_nswap as f64
    }
    #[inline]
    fn inblock_(&self) -> f64 {
        self.ru_inblock as f64
    }
    #[inline]
    fn oublock_(&self) -> f64 {
        self.ru_oublock as f64
    }
    #[inline]
    fn msgsnd_(&self) -> f64 {
        self.ru_msgsnd as f64
    }
    #[inline]
    fn msgrcv_(&self) -> f64 {
        self.ru_msgrcv as f64
    }
    #[inline]
    fn nsignals_(&self) -> f64 {
        self.ru_nsignals as f64
    }
    #[inline]
    fn nvcsw_(&self) -> f64 {
        self.ru_nvcsw as f64
    }
    #[inline]
    fn nivcsw_(&self) -> f64 {
        self.ru_nivcsw as f64
    }
}

impl RusageFields for WinRusage {
    #[inline]
    fn utime_sec(&self) -> i64 {
        self.utime.sec
    }
    #[inline]
    fn utime_usec(&self) -> i64 {
        self.utime.usec
    }
    #[inline]
    fn stime_sec(&self) -> i64 {
        self.stime.sec
    }
    #[inline]
    fn stime_usec(&self) -> i64 {
        self.stime.usec
    }
    #[inline]
    fn maxrss_(&self) -> f64 {
        self.maxrss as f64
    }
    // These counters do not exist on Windows — always zero.
    #[inline]
    fn ixrss_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn nswap_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn inblock_(&self) -> f64 {
        self.inblock as f64
    }
    #[inline]
    fn oublock_(&self) -> f64 {
        self.oublock as f64
    }
    #[inline]
    fn msgsnd_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn msgrcv_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn nsignals_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn nvcsw_(&self) -> f64 {
        0.0
    }
    #[inline]
    fn nivcsw_(&self) -> f64 {
        0.0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Spawn option / result types
// ──────────────────────────────────────────────────────────────────────────

pub struct PosixSpawnOptions {
    pub stdin: PosixStdio,
    pub stdout: PosixStdio,
    pub stderr: PosixStdio,
    pub ipc: Option<Fd>,
    pub extra_fds: Box<[PosixStdio]>,
    pub cwd: Box<[u8]>,
    pub detached: bool,
    /// Run the child as this user id (`setuid` after fork, like libuv/Node).
    pub uid: Option<u32>,
    /// Run the child as this group id (`setgid` after fork, like libuv/Node).
    pub gid: Option<u32>,
    pub windows: (),
    pub argv0: Option<*const c_char>,
    pub stream: bool,
    pub sync: bool,
    pub can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool,
    /// Apple Extension: If this bit is set, rather
    /// than returning to the caller, posix_spawn(2)
    /// and posix_spawnp(2) will behave as a more
    /// featureful execve(2).
    pub use_execve_on_macos: bool,
    /// If we need to call `socketpair()`, this
    /// sets SO_NOSIGPIPE when true.
    ///
    /// If false, this avoids setting SO_NOSIGPIPE
    /// for stdout. This is used to preserve
    /// consistent shell semantics.
    pub no_sigpipe: bool,
    /// setpgid(0, 0) in the child so it leads its own process group. The parent
    /// can then `kill(-pid, sig)` to signal the child and all its descendants.
    /// Not exposed to JS yet.
    pub new_process_group: bool,
    /// PTY slave fd for controlling terminal setup (-1 if not using PTY).
    pub pty_slave_fd: i32,
    /// Windows-only ConPTY handle; void placeholder on POSIX.
    pub pseudoconsole: (),
    /// Linux only. When non-null, the child sets PR_SET_PDEATHSIG to this
    /// signal between vfork and exec in posix_spawn_bun, so the kernel kills
    /// it when the spawning thread dies. When null, defaults to SIGKILL if
    /// no-orphans mode is enabled (see `ParentDeathWatchdog`), else 0 (no
    /// PDEATHSIG). Not exposed to JS yet.
    pub linux_pdeathsig: Option<u8>,
    /// macOS `--no-orphans` only: fd to inherit into the child at the same
    /// number (dup2-to-self in file_actions, bypassing CLOEXEC_DEFAULT).
    /// `NoOrphansTracker::killTracked()` finds descendants that outlived a
    /// fast-exit intermediate via `proc_listpidspath` on the backing file.
    pub no_orphans_tracker_fd: Fd,
}

impl Default for PosixSpawnOptions {
    fn default() -> Self {
        Self {
            stdin: PosixStdio::Inherit,
            stdout: PosixStdio::Inherit,
            stderr: PosixStdio::Inherit,
            ipc: None,
            extra_fds: Box::default(),
            cwd: Box::default(),
            detached: false,
            uid: None,
            gid: None,
            windows: (),
            argv0: None,
            stream: true,
            sync: false,
            can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: false,
            use_execve_on_macos: false,
            no_sigpipe: true,
            new_process_group: false,
            pty_slave_fd: -1,
            pseudoconsole: (),
            linux_pdeathsig: None,
            no_orphans_tracker_fd: Fd::INVALID,
        }
    }
}

impl PosixSpawnOptions {
    /// No-op.
    /// Exists for cfg-parity with `WindowsSpawnOptions::deinit`, which closes
    /// heap-allocated `uv::Pipe` handles on the spawn error path.
    #[inline]
    pub fn deinit(&mut self) {}
}

/// `bun.jsc.Subprocess.StdioKind` — defined here (not in `subprocess`) to keep
/// the spawn-sys layer leaf. Re-exported up through `bun_spawn::process` →
/// `bun_runtime::api::{bun_process, JscSubprocess}` → `shell::subproc`.
///
/// `EnumSetType` is load-bearing for `closed: EnumSet<StdioKind>` on both
/// `Subprocess` and `ShellSubprocess`; `IntoStaticStr` for close-IO logging.
/// (`EnumSetType` auto-supplies `Copy + Clone + Eq + PartialEq`; do not add
/// `#[repr(u8)]` — the derive forbids it, and no caller casts `as u8`.)
#[derive(enumset::EnumSetType, Debug, strum::IntoStaticStr)]
#[enumset(repr = "u8")]
pub enum StdioKind {
    Stdin,
    Stdout,
    Stderr,
}

impl StdioKind {
    #[inline]
    pub fn to_fd(self) -> Fd {
        match self {
            StdioKind::Stdin => Fd::stdin(),
            StdioKind::Stdout => Fd::stdout(),
            StdioKind::Stderr => Fd::stderr(),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Dup2 {
    pub out: StdioKind,
    pub to: StdioKind,
}

pub enum PosixStdio {
    Path(Box<[u8]>),
    Inherit,
    Ignore,
    Buffer,
    /// Like `Buffer` at indices >= 3 (creates a socketpair) but the parent
    /// end is returned as `ExtraPipe::UnownedFd`: the caller owns and closes
    /// it. Only valid in `extra_fds`.
    SocketFd,
    Ipc,
    Pipe(Fd),
    // TODO: remove this entry, it doesn't seem to be used
    Dup2(Dup2),
}

impl PosixStdio {
    // Constructor helpers — keep parity with `WindowsStdio::buffer(*mut Pipe)`
    // so `sync::SyncStdio::to_stdio` can spell both platforms uniformly.
    #[inline]
    pub fn inherit() -> Self {
        PosixStdio::Inherit
    }
    #[inline]
    pub fn ignore() -> Self {
        PosixStdio::Ignore
    }
    #[inline]
    pub fn buffer() -> Self {
        PosixStdio::Buffer
    }
}

#[derive(Default)]
pub struct PosixSpawnResult {
    pub pid: PidT,
    pub pidfd: Option<PidFdType>,
    pub stdin: Option<Fd>,
    pub stdout: Option<Fd>,
    pub stderr: Option<Fd>,
    pub ipc: Option<Fd>,
    pub extra_pipes: Vec<ExtraPipe>,
    pub memfds: [bool; 3],
    // ESRCH can happen when requesting the pidfd
    pub has_exited: bool,
}

/// Entry in `extra_pipes` for a stdio slot at index >= 3.
pub enum ExtraPipe {
    /// We created this fd (e.g. socketpair for `"pipe"`); `finalizeStreams`
    /// closes it. Downgraded to `UnownedFd` once `.stdio` is read (the caller
    /// then owns the raw number and is responsible for closing it).
    OwnedFd(Fd),
    /// The caller supplied this fd in the stdio array; expose it via
    /// `Subprocess.stdio[N]` but never close it — the caller retains ownership.
    UnownedFd(Fd),
    /// Nothing to expose for this slot (`"ignore"`, `"inherit"`, a path, or
    /// the IPC channel after ownership has been transferred to uSockets).
    Unavailable,
}

impl ExtraPipe {
    pub fn fd(&self) -> Fd {
        match self {
            ExtraPipe::OwnedFd(f) | ExtraPipe::UnownedFd(f) => *f,
            ExtraPipe::Unavailable => Fd::INVALID,
        }
    }
}

impl PosixSpawnResult {
    pub fn close(&mut self) {
        for item in self.extra_pipes.iter() {
            match item {
                ExtraPipe::OwnedFd(f) => f.close(),
                ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
            }
        }
        self.extra_pipes.clear();
        self.extra_pipes.shrink_to_fit();
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn pidfd_flags_for_linux() -> u32 {
        // PIDFD_NONBLOCK is only supported on kernel 5.10+ (the EINVAL retry
        // in `pifd_from_pid` still covers misdetection by retrying with 0).
        let kernel = bun_core::linux_kernel_version();
        if (kernel.major, kernel.minor) >= (5, 10) {
            bun_sys::O::NONBLOCK as u32
        } else {
            0
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        if crate::waiter_thread_flag::get() {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::ENOSYS,
                bun_sys::Tag::pidfd_open,
            ));
        }

        let pidfd_flags = Self::pidfd_flags_for_linux();

        let attempt = 'brk: {
            let rc = bun_sys::pidfd_open(self.pid, pidfd_flags);
            if let Err(e) = &rc {
                if e.get_errno() == bun_sys::E::EINVAL {
                    // Retry once, incase they don't support PIDFD_NONBLOCK.
                    break 'brk bun_sys::pidfd_open(self.pid, 0);
                }
            }
            rc
        };
        match attempt {
            Err(err) => {
                match err.get_errno() {
                    // seccomp filters can be used to block this system call or pidfd's altogether
                    // https://github.com/moby/moby/issues/42680
                    // so let's treat a bunch of these as actually meaning we should use the waiter thread fallback instead.
                    bun_sys::E::ENOSYS
                    // EOPNOTSUPP == ENOTSUP on Linux (both 95).
                    | bun_sys::E::ENOTSUP
                    | bun_sys::E::EPERM
                    | bun_sys::E::EACCES
                    | bun_sys::E::EINVAL => {
                        crate::waiter_thread_flag::set();
                        return Err(err);
                    }

                    // No such process can happen if it exited between the time we got the pid and called pidfd_open
                    // Until we switch to CLONE_PIDFD, this needs to be handled separately.
                    bun_sys::E::ESRCH => {}

                    // For all other cases, ensure we don't leak the child process on error
                    // That would cause Zombie processes to accumulate.
                    _ => {
                        loop {
                            let mut status: i32 = 0;
                            // SAFETY: libc wait4
                            let rc = unsafe {
                                libc::wait4(self.pid, &raw mut status, 0, core::ptr::null_mut())
                            };
                            match bun_sys::get_errno(rc as isize) {
                                bun_sys::E::SUCCESS => {}
                                bun_sys::E::EINTR => continue,
                                _ => {}
                            }
                            break;
                        }
                    }
                }
                Err(err)
            }
            Ok(fd) => Ok(fd.native()),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    pub fn pifd_from_pid(&mut self) -> bun_sys::Result<PidFdType> {
        Err(bun_sys::Error::from_code(
            bun_sys::E::ENOSYS,
            bun_sys::Tag::pidfd_open,
        ))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// spawn_process_posix — the fd/action plumbing + posix_spawn call
// ──────────────────────────────────────────────────────────────────────────

// Apple `<spawn.h>` extensions not exported by the `libc` crate.
#[cfg(target_os = "macos")]
pub(crate) const POSIX_SPAWN_CLOEXEC_DEFAULT: i32 = 0x4000; // _POSIX_SPAWN_CLOEXEC_DEFAULT
#[cfg(target_os = "macos")]
pub(crate) const POSIX_SPAWN_SETEXEC: i32 = 0x0040; // POSIX_SPAWN_SETEXEC

/// RAII fd cleanup for `spawn_process_posix`. On *every* exit it sets
/// CLOEXEC on `to_set_cloexec`, then closes `to_close_at_end`; on error
/// returns it additionally closes `to_close_on_error`. `on_error` is
/// disarmed on the success path.
///
/// This exists so that bare `?` on `actions.*` propagates without leaking
/// the parent-side socketpair ends pushed earlier in the loop.
///
/// The guard initializes `on_error = true` and is only disarmed after
/// `spawn_z` succeeds, so socketpair/set_nonblocking/spawn_z value-error
/// returns (`return Ok(Err(..))`) are covered as well as `?` failures. The
/// fds in `to_close_on_error` are parent-side ends never handed back to the
/// caller on any error path, so closing them is the correct behavior.
#[cfg(unix)]
struct PosixSpawnFdGuard {
    to_set_cloexec: Vec<Fd>,
    to_close_at_end: Vec<Fd>,
    to_close_on_error: Vec<Fd>,
    on_error: bool,
}

#[cfg(unix)]
impl Drop for PosixSpawnFdGuard {
    fn drop(&mut self) {
        if self.on_error {
            for fd in self.to_close_on_error.iter() {
                fd.close();
            }
        }
        for fd in self.to_set_cloexec.iter() {
            let _ = bun_sys::set_close_on_exec(*fd);
        }
        for fd in self.to_close_at_end.iter() {
            fd.close();
        }
    }
}

/// # Safety
/// `argv` must point to a null-terminated array of NUL-terminated C strings
/// with at least one non-null element (`argv[0]`); `envp` must point to a
/// null-terminated array of NUL-terminated C strings. Both must remain valid
/// for the duration of the call.
#[cfg(unix)]
pub unsafe fn spawn_process_posix(
    options: &PosixSpawnOptions,
    argv: Argv,
    envp: Envp,
) -> crate::Result<bun_sys::Result<PosixSpawnResult>> {
    bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);
    let mut actions = PosixSpawnActions::init()?;
    // defer actions.deinit() — Drop

    let mut attr = PosixSpawnAttr::init()?;
    // defer attr.deinit() — Drop

    // libc 0.2.x exposes the `POSIX_SPAWN_SETSIG*` flags for glibc/musl/macOS
    // but not for Android. Bionic's `<spawn.h>` uses the same values as glibc
    // (`0x04`/`0x08`) — they're POSIX-mandated bit flags, not OS-specific.
    #[cfg(not(target_os = "android"))]
    let (setsigdef, setsigmask) = (libc::POSIX_SPAWN_SETSIGDEF, libc::POSIX_SPAWN_SETSIGMASK);
    #[cfg(target_os = "android")]
    let (setsigdef, setsigmask) = (0x04_i32, 0x08_i32);
    let flags: i32 = {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
        let mut f: i32 = setsigdef | setsigmask;
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        let f: i32 = setsigdef | setsigmask;

        #[cfg(target_os = "macos")]
        {
            f |= POSIX_SPAWN_CLOEXEC_DEFAULT;

            if options.use_execve_on_macos {
                f |= POSIX_SPAWN_SETEXEC;

                if matches!(options.stdin, PosixStdio::Buffer)
                    || matches!(options.stdout, PosixStdio::Buffer)
                    || matches!(options.stderr, PosixStdio::Buffer)
                {
                    Output::panic(format_args!(
                        "Internal error: stdin, stdout, and stderr cannot be buffered when use_execve_on_macos is true",
                    ));
                }
            }
        }

        if options.detached {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // glibc/musl/bionic <spawn.h> all define POSIX_SPAWN_SETSID as 0x80;
                // the libc crate only exposes it for `target_os = "linux"`.
                f |= 0x80;
            }
            #[cfg(target_os = "macos")]
            {
                // Darwin <spawn.h>: 0x0400 (libc crate omits the constant).
                f |= 0x0400;
            }
            attr.detached = true;
        }
        f
    };

    // Pass PTY slave fd to attr for controlling terminal setup
    attr.pty_slave_fd = options.pty_slave_fd;
    attr.new_process_group = options.new_process_group;
    attr.uid = options.uid;
    attr.gid = options.gid;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        // Explicit per-spawn value wins; otherwise no-orphans mode defaults
        // every child to SIGKILL-on-parent-death so non-Bun descendants are
        // covered without relying on env-var inheritance, and the prctl happens
        // in the vfork child before exec so there's no startup race.
        attr.linux_pdeathsig = if let Some(sig) = options.linux_pdeathsig {
            i32::from(sig)
        } else if crate::pdeathsig::should_default() {
            libc::SIGKILL
        } else {
            0
        };
    }

    if !options.cwd.is_empty() {
        actions.chdir(&options.cwd)?;
    }
    let mut spawned = PosixSpawnResult::default();
    let mut extra_fds: Vec<ExtraPipe> = Vec::new();
    // Cleanup is owned by an RAII guard so every `?`
    // (and every explicit `return Ok(Err(..))`) runs it. See PosixSpawnFdGuard.
    let mut cleanup = PosixSpawnFdGuard {
        to_set_cloexec: Vec::new(),
        to_close_at_end: Vec::new(),
        to_close_on_error: Vec::new(),
        on_error: true,
    };

    let _ = attr.set(flags as _);
    let _ = attr.reset_signals();

    if let Some(ipc) = options.ipc {
        actions.inherit(ipc)?;
        spawned.ipc = Some(ipc);
    }

    #[cfg(target_os = "macos")]
    if options.no_orphans_tracker_fd != Fd::INVALID {
        // dup2-to-self exempts the fd from POSIX_SPAWN_CLOEXEC_DEFAULT so the
        // script (and every fork()ed descendant) inherits it. See
        // NoOrphansTracker.cpp for the matching proc_listpidspath sweep.
        actions.inherit(options.no_orphans_tracker_fd)?;
    }

    let stdio_options: [&PosixStdio; 3] = [&options.stdin, &options.stdout, &options.stderr];
    // Reshaped for borrowck: we
    // index spawned.{stdin,stdout,stderr} via a helper closure.
    let mut dup_stdout_to_stderr: bool = false;

    // The label is only referenced from the Linux memfd fast-path below.
    #[cfg_attr(
        not(any(target_os = "linux", target_os = "android")),
        allow(unused_labels)
    )]
    'stdio: for i in 0..3usize {
        let fileno = Fd::from_native(FdT::try_from(i).unwrap());
        let flag: u32 = (if i == 0 {
            bun_sys::O::RDONLY
        } else {
            bun_sys::O::WRONLY
        }) as u32;

        match stdio_options[i] {
            PosixStdio::Dup2(dup2) => {
                // This is a hack to get around the ordering of the spawn actions.
                // If stdout is set so that it redirects to stderr, the order of actions will be like this:
                // 0. dup2(stderr, stdout) - this makes stdout point to stderr
                // 1. setup stderr (will make stderr point to write end of `stderr_pipe_fds`)
                // This is actually wrong, 0 will execute before 1 so stdout ends up writing to stderr instead of the pipe
                // So we have to instead do `dup2(stderr_pipe_fd[1], stdout)`
                // Right now we only allow one output redirection so it's okay.
                if i == 1 && dup2.to == StdioKind::Stderr {
                    dup_stdout_to_stderr = true;
                } else {
                    actions.dup2(dup2.to.to_fd(), dup2.out.to_fd())?;
                }
            }
            PosixStdio::Inherit => {
                actions.inherit(fileno)?;
            }
            PosixStdio::Ipc | PosixStdio::Ignore => {
                actions.open_z(fileno, c"/dev/null", flag | bun_sys::O::CREAT as u32, 0o664)?;
            }
            PosixStdio::Path(path) => {
                actions.open(fileno, path, flag | bun_sys::O::CREAT as u32, 0o664)?;
            }
            PosixStdio::Buffer => {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                'use_memfd: {
                    if !options.stream && i > 0 && bun_sys::can_use_memfd() {
                        // use memfd if we can
                        let label: &CStr = match i {
                            0 => c"spawn_stdio_stdin",
                            1 => c"spawn_stdio_stdout",
                            2 => c"spawn_stdio_stderr",
                            _ => c"spawn_stdio_generic",
                        };

                        let fd =
                            match bun_sys::memfd_create(label, bun_sys::MemfdFlags::CrossProcess) {
                                Ok(fd) => fd,
                                Err(_) => break 'use_memfd,
                            };

                        cleanup.to_close_on_error.push(fd);
                        cleanup.to_set_cloexec.push(fd);
                        actions.dup2(fd, fileno)?;
                        set_spawned_stdio(&mut spawned, i, fd);
                        spawned.memfds[i] = true;
                        continue 'stdio;
                    }
                }

                let fds: [Fd; 2] = 'brk: {
                    let pair_result = if !options.no_sigpipe {
                        bun_sys::socketpair_for_shell(libc::AF_UNIX, libc::SOCK_STREAM, 0, false)
                    } else {
                        bun_sys::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, false)
                    };
                    let pair = match pair_result {
                        Ok(p) => p,
                        Err(e) => return Ok(Err(e)),
                    };
                    break 'brk [
                        pair[if i == 0 { 1 } else { 0 }],
                        pair[if i == 0 { 0 } else { 1 }],
                    ];
                };

                // Note: we intentionally do NOT call shutdown() on the
                // socketpair fds. On SOCK_STREAM socketpairs, shutdown(fd, SHUT_WR)
                // sends a FIN to the peer, which causes programs that poll the
                // write end for readability (e.g. Python's asyncio connect_write_pipe)
                // to interpret it as "connection closed" and tear down their transport.
                // The socketpair is already used unidirectionally by convention.
                #[cfg(target_os = "macos")]
                {
                    // macOS seems to default to around 8 KB for the buffer size
                    // this is comically small.
                    // TODO: investigate if this should be adjusted on Linux.
                    let so_recvbuf: c_int = 1024 * 512;
                    let so_sendbuf: c_int = 1024 * 512;
                    // SAFETY: setsockopt with valid fds
                    unsafe {
                        if i == 0 {
                            libc::setsockopt(
                                fds[1].native(),
                                libc::SOL_SOCKET,
                                libc::SO_RCVBUF,
                                core::ptr::from_ref(&so_recvbuf).cast::<c_void>(),
                                core::mem::size_of::<c_int>() as u32,
                            );
                            libc::setsockopt(
                                fds[0].native(),
                                libc::SOL_SOCKET,
                                libc::SO_SNDBUF,
                                core::ptr::from_ref(&so_sendbuf).cast::<c_void>(),
                                core::mem::size_of::<c_int>() as u32,
                            );
                        } else {
                            libc::setsockopt(
                                fds[0].native(),
                                libc::SOL_SOCKET,
                                libc::SO_RCVBUF,
                                core::ptr::from_ref(&so_recvbuf).cast::<c_void>(),
                                core::mem::size_of::<c_int>() as u32,
                            );
                            libc::setsockopt(
                                fds[1].native(),
                                libc::SOL_SOCKET,
                                libc::SO_SNDBUF,
                                core::ptr::from_ref(&so_sendbuf).cast::<c_void>(),
                                core::mem::size_of::<c_int>() as u32,
                            );
                        }
                    }
                }

                cleanup.to_close_at_end.push(fds[1]);
                cleanup.to_close_on_error.push(fds[0]);

                if !options.sync {
                    if let Err(e) = bun_sys::set_nonblocking(fds[0]) {
                        return Ok(Err(e));
                    }
                }

                actions.dup2(fds[1], fileno)?;
                if fds[1] != fileno {
                    actions.close(fds[1])?;
                }

                set_spawned_stdio(&mut spawned, i, fds[0]);
            }
            PosixStdio::Pipe(fd) => {
                actions.dup2(*fd, fileno)?;
                set_spawned_stdio(&mut spawned, i, *fd);
            }
            PosixStdio::SocketFd => {
                // Rejected at i < 3 in Stdio::extract(); unreachable here.
                unreachable!("SocketFd at stdin/stdout/stderr");
            }
        }
    }

    if dup_stdout_to_stderr {
        if let PosixStdio::Dup2(d) = stdio_options[1] {
            actions.dup2(d.to.to_fd(), d.out.to_fd())?;
        }
    }

    for (i, ipc) in options.extra_fds.iter().enumerate() {
        let fileno = Fd::from_native(FdT::try_from(3 + i).unwrap());

        match ipc {
            PosixStdio::Dup2(_) => panic!("TODO dup2 extra fd"),
            PosixStdio::Inherit => {
                actions.inherit(fileno)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Ignore => {
                // Node leaves "ignore" at an extra slot closed in the child;
                // only fds 0-2 need a /dev/null placeholder. Close explicitly:
                // the post-exec close-range floor only covers higher fds.
                actions.close(fileno)?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Path(path) => {
                actions.open(
                    fileno,
                    path,
                    (bun_sys::O::RDWR | bun_sys::O::CREAT) as u32,
                    0o664,
                )?;
                extra_fds.push(ExtraPipe::Unavailable);
            }
            PosixStdio::Ipc | PosixStdio::Buffer | PosixStdio::SocketFd => {
                let is_ipc = matches!(ipc, PosixStdio::Ipc);
                let fds: [Fd; 2] =
                    match bun_sys::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, is_ipc) {
                        Ok(p) => p,
                        Err(e) => return Ok(Err(e)),
                    };

                if !options.sync && !is_ipc {
                    if let Err(e) = bun_sys::set_nonblocking(fds[0]) {
                        return Ok(Err(e));
                    }
                }

                cleanup.to_close_at_end.push(fds[1]);
                cleanup.to_close_on_error.push(fds[0]);

                actions.dup2(fds[1], fileno)?;
                if fds[1] != fileno {
                    actions.close(fds[1])?;
                }
                // SocketFd: push as OwnedFd here so every error path between
                // spawn and returning the JS Subprocess (to_close_on_error
                // above, and the Writable::init error arm's finalize_streams
                // in js_bun_spawn_bindings.rs) still closes it. The caller's
                // "I own this fd" contract only begins once they can read
                // .stdio[i]; the OwnedFd -> UnownedFd downgrade happens in
                // js_bun_spawn_bindings.rs after all fallible init succeeds.
                extra_fds.push(ExtraPipe::OwnedFd(fds[0]));
            }
            PosixStdio::Pipe(fd) => {
                actions.dup2(*fd, fileno)?;
                // The fd was supplied by the caller (a number in the stdio array) and is
                // not owned by us. Record it so `stdio[N]` returns the caller's fd, but
                // mark it unowned so finalizeStreams leaves it open.
                extra_fds.push(ExtraPipe::UnownedFd(*fd));
            }
        }
    }

    // SAFETY: argv is null-terminated, argv[0] is non-null
    let argv0 = options.argv0.unwrap_or_else(|| unsafe { *argv });
    // SAFETY: argv0 is a valid NUL-terminated C string (caller contract).
    let argv0_cstr = unsafe { bun_core::ffi::cstr(argv0) };
    let spawn_result = posix_spawn::spawn_z(argv0_cstr, Some(&actions), Some(&attr), argv, envp);

    match spawn_result {
        Err(err) => {
            return Ok(Err(err));
        }
        Ok(pid) => {
            spawned.pid = pid;
            spawned.extra_pipes = extra_fds;

            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                // If it's spawnSync and we want to block the entire thread
                // don't even bother with pidfd. It's not necessary.
                if !options.can_block_entire_thread_to_reduce_cpu_usage_in_fast_path {
                    // Get a pidfd, which is a file descriptor that represents a process.
                    // This lets us avoid a separate thread to wait on the process.
                    match spawned.pifd_from_pid() {
                        Ok(pidfd) => {
                            spawned.pidfd = Some(pidfd);
                        }
                        Err(err) => {
                            // we intentionally do not clean up any of the file descriptors in this case
                            // you could have data sitting in stdout, just waiting.
                            if err.get_errno() == bun_sys::E::ESRCH {
                                spawned.has_exited = true;
                                // a real error occurred. one we should not assume means pidfd_open is blocked.
                            } else if !crate::waiter_thread_flag::get() {
                                return Ok(Err(err));
                            }
                        }
                    }
                }
            }

            // Disarm `errdefer`; the unconditional `defer` (cloexec +
            // close_at_end) runs from `cleanup`'s Drop on the way out.
            cleanup.on_error = false;
            return Ok(Ok(spawned));
        }
    }
}

#[cfg(unix)]
fn set_spawned_stdio(spawned: &mut PosixSpawnResult, i: usize, fd: Fd) {
    match i {
        0 => spawned.stdin = Some(fd),
        1 => spawned.stdout = Some(fd),
        2 => spawned.stderr = Some(fd),
        _ => unreachable!(),
    }
}
