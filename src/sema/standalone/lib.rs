//! `bun_sema` with Bun's parser in front of it and the file system underneath: what its tests and the `bun-sema`
//! command line tool are made of. The bundler does not use this crate.

pub mod baseline;
pub mod hir_dump;
pub mod native;

use bun_sema::atom::Interner;
use bun_sema::hir;

/// Parses `text` with default options. The extension of `path` says what kind of file it is.
pub fn parse(
    path: &str,
    text: &[u8],
    atoms: &Interner,
    experimental_decorators: bool,
) -> hir::File {
    bun_js_parser::sema::summarize(path.as_bytes(), text, atoms, experimental_decorators, false).0
}

/// Runs `work(i)` for every `i` below `count` on `threads` threads. Their stack size is `BUN_SEMA_STACK_MB`, 256 by default. The threads of
/// `bun check` have `bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE` (4 MB; 18 MB on Windows).
pub fn for_each_parallel(threads: usize, count: usize, work: impl Fn(usize) + Sync) {
    let megabytes = std::env::var("BUN_SEMA_STACK_MB").ok();
    let stack = megabytes.and_then(|n| n.parse().ok()).unwrap_or(256usize) << 20;
    let next = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            std::thread::Builder::new()
                .stack_size(stack)
                .spawn_scoped(scope, || {
                    native::set_stack_size(stack - (256 << 10));
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        if i >= count {
                            break;
                        }
                        work(i);
                    }
                })
                .unwrap();
        }
    });
}

/// The most memory the process has had resident, in bytes.
/// How many instructions the process has gone through and how many cycles that took, on all threads. The first hardly differs from one run to
/// the next, which the time taken does. (0, 0) where it cannot be told.
pub fn instructions_and_cycles() -> (u64, u64) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return (info.ri_instructions, info.ri_cycles);
        }
    }
    (0, 0)
}

/// How many columns the terminal standard output goes to has. 0 if it goes elsewhere.
pub fn terminal_width() -> usize {
    #[cfg(unix)]
    // SAFETY: all zeros is a `winsize`, which the call fills in.
    unsafe {
        let mut size: libc::winsize = core::mem::zeroed();
        if libc::ioctl(1, libc::TIOCGWINSZ, &raw mut size) == 0 {
            return usize::from(size.ws_col);
        }
    }
    0
}

/// The most memory the process has had at any time, as the system counts it against it. What has been given back and not been taken yet, which
/// `getrusage` counts, is not in it.
pub fn peak_memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return info.ri_lifetime_max_phys_footprint;
        }
    }
    peak_rss()
}

pub fn current_memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return info.ri_phys_footprint;
        }
    }
    0
}

pub fn peak_rss() -> u64 {
    #[repr(C)]
    struct Rusage {
        times: [i64; 4],
        max_rss: i64,
        rest: [i64; 13],
    }
    unsafe extern "C" {
        fn getrusage(who: i32, usage: *mut Rusage) -> i32;
    }
    let mut usage = Rusage {
        times: [0; 4],
        max_rss: 0,
        rest: [0; 13],
    };
    // SAFETY: `usage` has the layout of `struct rusage` on 64-bit macOS and Linux, and outlives the call.
    if unsafe { getrusage(0, &mut usage) } != 0 {
        return 0;
    }
    // Bytes on macOS, kilobytes on Linux.
    if cfg!(target_os = "macos") {
        usage.max_rss as u64
    } else {
        usage.max_rss as u64 * 1024
    }
}
