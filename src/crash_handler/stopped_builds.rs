//! A build that stops, or is told to stop, says what it was compiling.

#[cfg(unix)]
use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;

use crate::{Write, stderr_writer};

/// Writes whole lines into the buffer and returns their length. It is called where the process stops, in a signal
/// handler too, so it allocates nothing and takes no lock.
pub type DescribeBuild = unsafe extern "C" fn(buffer: *mut u8, capacity: usize) -> usize;

#[derive(Clone, Copy)]
pub struct BuildDescribers {
    /// Where the calling thread's part of a build stands, and what gets a build around it.
    pub where_this_thread_stopped: DescribeBuild,
    /// A line for each thread that is at work for a build.
    pub what_threads_are_compiling: DescribeBuild,
}

static DESCRIBERS: OnceLock<BuildDescribers> = OnceLock::new();
static BUILDS_UNDER_WAY: AtomicUsize = AtomicUsize::new(0);

/// What the engine says. Where it says nothing, what the front end says, which also checks programs that nobody compiles.
fn write_description(
    writer: &mut impl Write,
    buffer: &mut [u8],
    of_engine: impl FnOnce(&BuildDescribers) -> DescribeBuild,
    of_front_end: fn(&mut [u8]) -> usize,
) {
    let mut length = DESCRIBERS.get().map_or(0, |describers| {
        // SAFETY: the buffer is writable for the length that is passed.
        unsafe { of_engine(describers)(buffer.as_mut_ptr(), buffer.len()) }
    });
    if length == 0 {
        length = of_front_end(buffer);
    }
    let _ = writer.write_all(&buffer[..length.min(buffer.len())]);
}

/// For the report of a crash, on the thread that crashed, whose stack may be a small one for signals.
pub(crate) fn write_where_this_thread_stopped(writer: &mut impl Write) {
    write_description(
        writer,
        &mut [0u8; 768],
        |describers| describers.where_this_thread_stopped,
        bun_core::current_work::describe_where_this_thread_stopped,
    );
}

fn write_what_threads_are_compiling() {
    static LINES: bun_core::RacyCell<[u8; 32 * 1024]> = bun_core::RacyCell::new([0; 32 * 1024]);
    static LINES_ARE_IN_USE: AtomicBool = AtomicBool::new(false);
    if LINES_ARE_IN_USE.swap(true, Ordering::Acquire) {
        return;
    }
    write_description(
        &mut stderr_writer(),
        // SAFETY: the flag admits one thread at a time.
        unsafe { &mut *LINES.get() },
        |describers| describers.what_threads_are_compiling,
        bun_core::current_work::describe_what_threads_are_compiling,
    );
    LINES_ARE_IN_USE.store(false, Ordering::Release);
}

/// Until the guard is dropped, a crash names the function and the step that its thread was compiling, and a process
/// that is interrupted or ended from outside says what each thread is still compiling.
#[must_use]
pub fn report_stopped_builds(describers: BuildDescribers) -> impl Drop {
    struct BuildUnderWay;
    impl Drop for BuildUnderWay {
        fn drop(&mut self) {
            if BUILDS_UNDER_WAY.fetch_sub(1, Ordering::SeqCst) == 1 {
                set_reports_interruptions(false);
            }
        }
    }
    let _ = DESCRIBERS.set(describers);
    // An assertion of the compiler that fails calls `abort()`.
    crate::report_aborts();
    #[cfg(unix)]
    crate::draft::report_crashes_of_several_threads();
    if BUILDS_UNDER_WAY.fetch_add(1, Ordering::SeqCst) == 0 {
        report_what_the_sanitizer_leaves();
        set_reports_interruptions(true);
    }
    BuildUnderWay
}

/// Ctrl+C, `kill`, `timeout`, a closed terminal, `ulimit -t`.
#[cfg(unix)]
const INTERRUPTIONS: [c_int; 5] = [
    libc::SIGINT,
    libc::SIGTERM,
    libc::SIGQUIT,
    libc::SIGHUP,
    libc::SIGXCPU,
];

#[cfg(unix)]
fn raise_with_default_action(signal: c_int) {
    // SAFETY: both are async-signal-safe. The signal is delivered when the handler returns.
    unsafe {
        libc::signal(signal, libc::SIG_DFL);
        libc::raise(signal);
    }
}

#[cfg(unix)]
extern "C" fn handle_interruption(signal: c_int) {
    write_what_threads_are_compiling();
    raise_with_default_action(signal);
}

/// A signal that the program handles or ignores stays as it is.
#[cfg(unix)]
fn set_reports_interruptions(reports: bool) {
    let ours = handle_interruption as extern "C" fn(c_int) as usize;
    let (from, to) = if reports {
        (libc::SIG_DFL, ours)
    } else {
        (ours, libc::SIG_DFL)
    };
    for signal in INTERRUPTIONS {
        let mut current: libc::sigaction = bun_core::ffi::zeroed();
        // SAFETY: a null new action only reads the current one into valid memory.
        if unsafe { libc::sigaction(signal, core::ptr::null(), &raw mut current) } != 0
            || current.sa_sigaction != from
        {
            continue;
        }
        let mut action: libc::sigaction = bun_core::ffi::zeroed();
        action.sa_sigaction = to;
        action.sa_flags = libc::SA_RESTART;
        // SAFETY: both point to valid memory, and the handler is never unloaded.
        unsafe {
            libc::sigemptyset(&raw mut action.sa_mask);
            libc::sigaction(signal, &raw const action, core::ptr::null_mut());
        }
    }
}

#[cfg(windows)]
extern "system" fn handle_interruption(_event: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
    write_what_threads_are_compiling();
    // The next handler ends the process.
    bun_sys::windows::FALSE
}

#[cfg(windows)]
fn set_reports_interruptions(reports: bool) {
    let add = if reports {
        bun_sys::windows::TRUE
    } else {
        bun_sys::windows::FALSE
    };
    let _ = bun_sys::windows::SetConsoleCtrlHandler(Some(handle_interruption), add);
}

/// Under AddressSanitizer the crash handler leaves the signals alone. The sanitizer reports some and calls back when it
/// ends the process. The others end the process without a word.
#[cfg(unix)]
fn report_what_the_sanitizer_leaves() {
    extern "C" fn write_at_death() {
        write_where_this_thread_stopped(&mut stderr_writer());
    }
    extern "C" fn handle_crash(signal: c_int) {
        write_at_death();
        raise_with_default_action(signal);
    }
    if !bun_core::Environment::ENABLE_ASAN {
        return;
    }
    #[cfg(bun_asan)]
    {
        unsafe extern "C" {
            fn __sanitizer_set_death_callback(callback: Option<extern "C" fn()>);
        }
        // SAFETY: the callback is never unloaded.
        unsafe { __sanitizer_set_death_callback(Some(write_at_death)) };
    }
    for signal in [libc::SIGABRT, libc::SIGILL, libc::SIGTRAP] {
        let mut current: libc::sigaction = bun_core::ffi::zeroed();
        // SAFETY: a null new action only reads the current one into valid memory.
        if unsafe { libc::sigaction(signal, core::ptr::null(), &raw mut current) } != 0
            || current.sa_sigaction != libc::SIG_DFL
        {
            continue;
        }
        // SAFETY: the handler has the signature that `signal` calls and is never unloaded.
        unsafe { libc::signal(signal, handle_crash as extern "C" fn(c_int) as usize) };
    }
}

#[cfg(not(unix))]
fn report_what_the_sanitizer_leaves() {}
