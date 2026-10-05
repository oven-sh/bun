//! `bun_sema` with Bun's parser as its front end, backed by the file system: the basis of its tests
//! and of the `bun-sema` command line tool. The bundler does not use this crate.

pub mod hir_dump;
pub mod native;

use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::session::Arena;
#[cfg(unix)]
use core::mem::MaybeUninit;

/// Parses `text` with default options. The extension of `path` determines the file kind.
pub fn parse<'s>(
    arena: &'s Arena,
    path: &str,
    text: &[u8],
    atoms: &Interner<'s>,
    experimental_decorators: bool,
) -> hir::File<'s> {
    let path = path.as_bytes();
    bun_js_parser::sema::summarize(arena, path, text, atoms, experimental_decorators, false).0
}

/// Runs `work(i)` for every `i` below `count` on `threads` threads. Their stack size is `BUN_SEMA_STACK_MB`, 256 by default. The threads of
/// `bun check` have `bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE` (4 MB; 18 MB on Windows).
pub fn for_each_parallel(threads: usize, count: usize, work: impl Fn(usize) + Sync) {
    let megabytes = bun_core::getenv_z(bun_core::zstr!("BUN_SEMA_STACK_MB"));
    let megabytes = megabytes.and_then(|n| core::str::from_utf8(n).ok()?.parse().ok());
    let stack = megabytes.unwrap_or(256usize) << 20;
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

/// Peak resident memory of the process, in bytes.
/// The number of instructions the process has executed and the cycles they took, on all threads.
/// The instruction count is nearly constant between runs, unlike the elapsed time. (0, 0) where it
/// is not available.
pub fn instructions_and_cycles() -> (u64, u64) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a valid `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { MaybeUninit::zeroed().assume_init() };
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

/// The column count of the terminal that standard output is attached to. 0 if it is not a terminal.
pub fn terminal_width() -> usize {
    #[cfg(unix)]
    // SAFETY: all zeros is a valid `winsize`, which the call fills in.
    unsafe {
        let mut size: libc::winsize = MaybeUninit::zeroed().assume_init();
        if libc::ioctl(1, libc::TIOCGWINSZ, &raw mut size) == 0 {
            return usize::from(size.ws_col);
        }
    }
    0
}

/// Peak memory of the process, as the operating system accounts it to the process. Excludes memory
/// that has been released but not yet reclaimed, which `getrusage` counts.
pub fn peak_memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a valid `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { MaybeUninit::zeroed().assume_init() };
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
        // SAFETY: all zeros is a valid `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { MaybeUninit::zeroed().assume_init() };
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
    if unsafe { getrusage(0, &raw mut usage) } != 0 {
        return 0;
    }
    // Bytes on macOS, kilobytes on Linux.
    if cfg!(target_os = "macos") {
        usage.max_rss as u64
    } else {
        usage.max_rss as u64 * 1024
    }
}
