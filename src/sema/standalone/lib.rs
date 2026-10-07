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
    bun_js_parser::sema::summarize(
        arena,
        path,
        None,
        text,
        atoms,
        experimental_decorators,
        false,
    )
    .0
}

/// Runs `work(i)` for every `i` below `count` on `threads` threads, which have the stack of a thread of `bun check`.
pub fn for_each_parallel(threads: usize, count: usize, work: impl Fn(usize) + Sync) {
    let stack = bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize;
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

// Here and not beside what it tests: this crate has what a test binary needs to link (`native`).
#[cfg(all(test, not(windows)))]
mod tests {
    use bun_sema::resolve::{Host, displayed_path, join};
    use bun_sema_driver::host::{Disk, from_argument, from_native, to_native};

    #[test]
    fn a_directory_in_the_root_can_be_named_like_a_root_of_typescript() {
        for native in [
            &b"/c:/a/b.ts"[..],
            b"/c:",
            b"/^/a",
            b"/^",
            b"/usr/c:/a",
            b"/",
        ] {
            let path = from_native(native);
            assert_eq!(to_native(&path), native);
            assert_eq!(&*displayed_path(&path), native);
            assert_eq!(from_native(to_native(&path)), path);
            assert_eq!(join(b"/", &path), path);
        }
        // What TypeScript takes for a drive is another path, which the system looks for in the
        // working directory.
        let drive = join(b"/x", b"c:/a");
        assert_ne!(drive, from_native(b"/c:/a"));
        assert_eq!(to_native(&drive), b"c:/a");
        // `..` ends at `/`.
        let inside = from_native(b"/c:/a");
        assert_eq!(to_native(&join(&inside, b"../b")), b"/c:/b");
        assert_eq!(&*displayed_path(&join(&inside, b"../..")), b"/");
        assert_eq!(&*displayed_path(&join(&inside, b"../../..")), b"/");
        // On the command line.
        assert_eq!(
            from_argument(&inside, b"/c:/a/b.ts"),
            from_native(b"/c:/a/b.ts")
        );
        assert_eq!(from_argument(&inside, b"b.ts"), from_native(b"/c:/a/b.ts"));
        assert_eq!(from_argument(&inside, b"c:/a"), drive);
    }

    #[test]
    fn the_real_path_of_what_is_below_the_marked_root_is_below_it() {
        // No test can make a directory in `/`. This one is there, and is no link.
        let disk = Disk::with_already_read(1, Default::default(), b"/");
        assert_eq!(disk.realpath(b"/usr/lib"), b"/usr/lib");
        assert_eq!(disk.realpath(b"/\0/usr/lib"), b"/\0/usr/lib");
    }
}
