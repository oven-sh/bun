//! What `bun_sema`'s tests and the `bun-sema` command line tool need to link and to measure. The product doesn't use
//! it.

#![feature(linkage)]

pub mod native;
pub mod native_libraries;
#[cfg(any(test, feature = "test_support"))]
#[path = "../../runtime/cli/typescript_libs.rs"]
mod typescript_libs;

/// TypeScript's `lib.*.d.ts` files as Bun ships them.
#[cfg(any(test, feature = "test_support"))]
pub const TYPESCRIPT_LIBS: bun_sema_driver::host::BundledLibs = typescript_libs::BUNDLED;

/// Runs `work(i)` for every `i` below `count` on `threads` threads, which have the stack of a thread of `bun check`.
#[cfg(any(test, feature = "test_support"))]
pub fn for_each_parallel(threads: usize, count: usize, work: impl Fn(usize) + Sync) {
    let checked = bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize;
    // What a test does with a tree checks no stack, and a frame is many times as large without optimization.
    let stack = checked * if cfg!(debug_assertions) { 16 } else { 1 };
    let next = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            std::thread::Builder::new()
                .stack_size(stack)
                .spawn_scoped(scope, || {
                    native::set_stack_size(checked - (256 << 10));
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

/// Returns the column count of the terminal attached to standard output, or 0 if it isn't a terminal.
pub fn terminal_width() -> usize {
    #[cfg(unix)]
    {
        let mut size: libc::winsize = bun_core::ffi::zeroed();
        // SAFETY: the call fills in `size`.
        if unsafe { libc::ioctl(1, libc::TIOCGWINSZ, &raw mut size) } == 0 {
            return usize::from(size.ws_col);
        }
    }
    0
}

/// Returns the process's peak memory as the operating system accounts for it. Excludes memory that
/// has been released but not yet reclaimed, which `getrusage` counts.
pub fn peak_memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut info: libc::rusage_info_v4 = bun_core::ffi::zeroed();
        // SAFETY: `info` has the type that `RUSAGE_INFO_V4` fills in, and it outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return info.ri_lifetime_max_phys_footprint;
        }
    }
    peak_rss()
}

/// Returns the process's peak resident memory in bytes.
fn peak_rss() -> u64 {
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
    // `ru_maxrss` is in bytes on macOS and in kilobytes on Linux.
    if cfg!(target_os = "macos") {
        usage.max_rss as u64
    } else {
        usage.max_rss as u64 * 1024
    }
}

// These tests aren't next to the code they test because only this crate has what a test binary
// needs to link (`native`).
#[cfg(all(test, not(windows)))]
mod tests {
    use bun_sema::resolve::{Host, displayed_path, join};
    use bun_sema_driver::host::{Disk, from_argument, from_native, to_native};

    #[test]
    fn directory_in_root_can_be_named_like_a_typescript_root() {
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
        // A path that TypeScript treats as starting with a drive is a different path. The OS resolves
        // it against the working directory.
        let drive = join(b"/x", b"c:/a");
        assert_ne!(drive, from_native(b"/c:/a"));
        assert_eq!(to_native(&drive), b"c:/a");
        // `..` stops at `/`.
        let inside = from_native(b"/c:/a");
        assert_eq!(to_native(&join(&inside, b"../b")), b"/c:/b");
        assert_eq!(&*displayed_path(&join(&inside, b"../..")), b"/");
        assert_eq!(&*displayed_path(&join(&inside, b"../../..")), b"/");
        // Command-line arguments.
        assert_eq!(
            from_argument(&inside, b"/c:/a/b.ts"),
            from_native(b"/c:/a/b.ts")
        );
        assert_eq!(from_argument(&inside, b"b.ts"), from_native(b"/c:/a/b.ts"));
        assert_eq!(from_argument(&inside, b"c:/a"), drive);
    }

    #[test]
    fn realpath_under_the_marked_root_stays_under_it() {
        // A test can't create a directory in `/`. `/usr/lib` already exists and isn't a symlink.
        let disk = Disk::with_already_read(1, Default::default(), b"/");
        assert_eq!(disk.realpath(b"/usr/lib"), b"/usr/lib");
        assert_eq!(disk.realpath(b"/\0/usr/lib"), b"/\0/usr/lib");
    }

    /// `to_utf16_alloc` keeps what the converter wrote in front of an ill-formed sequence: `native`'s has to write it too.
    #[test]
    fn utf16_of_ill_formed_utf8_keeps_the_text_around_each_sequence() {
        let character = "a\u{e9}\u{4e16}\u{1f600}";
        // Each with the U+FFFD it decodes to: one per maximal subpart.
        let ill_formed: [(&[u8], usize); 6] = [
            (b"\xff", 1),
            (b"\x80", 1),
            (b"\xbf\xbf\xbf\xbf\xbf", 5),
            (b"\xe4\xb8", 1),
            (b"\xed\xa0\x80", 3),
            (b"\xf0\x9f\x98", 1),
        ];
        // From no text to more text than one SIMD block.
        for count in [0, 1, 9, 300] {
            let text = character.repeat(count);
            let units: Vec<u16> = text.encode_utf16().collect();
            for sentinel in [false, true] {
                let mut input = Vec::new();
                let mut expected = Vec::new();
                for (bytes, replacements) in ill_formed {
                    input.extend_from_slice(text.as_bytes());
                    input.extend_from_slice(bytes);
                    expected.extend_from_slice(&units);
                    expected.extend(core::iter::repeat_n(0xFFFD, replacements));
                }
                input.extend_from_slice(text.as_bytes());
                expected.extend_from_slice(&units);
                if sentinel {
                    expected.push(0);
                }
                let decoded = bun_core::strings::to_utf16_alloc(&input, false, sentinel);
                assert_eq!(decoded.ok().flatten(), Some(expected), "{count} {sentinel}");
            }
        }
    }
}
