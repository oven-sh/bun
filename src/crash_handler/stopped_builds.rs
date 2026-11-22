//! A build that stops, or is told to stop, says what it was compiling.

#[cfg(unix)]
use core::ffi::c_int;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;

#[cfg(unix)]
use bun_core::signal::{self, Action};

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
fn describe(
    buffer: &mut [u8],
    of_engine: impl FnOnce(&BuildDescribers) -> DescribeBuild,
    of_front_end: fn(&mut [u8]) -> usize,
) -> usize {
    let mut length = DESCRIBERS.get().map_or(0, |describers| {
        // SAFETY: the buffer is writable for the length that is passed.
        unsafe { of_engine(describers)(buffer.as_mut_ptr(), buffer.len()) }
    });
    if length == 0 {
        length = of_front_end(buffer);
    }
    length.min(buffer.len())
}

/// Where a thread's part of a build stands, and what gets a build around it, in whole lines. It fits the stack of a
/// thread that has crashed, which may be a small one for signals.
pub(crate) struct PlaceInBuild {
    text: [u8; 768],
    length: usize,
}

impl PlaceInBuild {
    fn of_this_thread() -> Self {
        let mut text = [0u8; 768];
        let length = describe(
            &mut text,
            |describers| describers.where_this_thread_stopped,
            bun_core::current_work::describe_where_this_thread_stopped,
        );
        Self { text, length }
    }

    pub(crate) fn lines(&self) -> &[u8] {
        &self.text[..self.length]
    }
}

/// For the report of a crash, on the thread that crashed.
pub(crate) fn write_where_this_thread_stopped(writer: &mut impl Write) {
    let _ = writer.write_all(PlaceInBuild::of_this_thread().lines());
}

/// None for a thread that is not at work for a build.
pub(crate) fn place_of_this_thread() -> Option<PlaceInBuild> {
    if BUILDS_UNDER_WAY.load(Ordering::SeqCst) == 0 {
        return None;
    }
    let place = PlaceInBuild::of_this_thread();
    (place.length != 0).then_some(place)
}

fn write_what_threads_are_compiling() {
    static LINES: bun_core::RacyCell<[u8; 32 * 1024]> = bun_core::RacyCell::new([0; 32 * 1024]);
    static LINES_ARE_IN_USE: AtomicBool = AtomicBool::new(false);
    if LINES_ARE_IN_USE.swap(true, Ordering::Acquire) {
        return;
    }
    // SAFETY: the flag admits one thread at a time.
    let lines = unsafe { &mut *LINES.get() };
    let length = describe(
        lines,
        |describers| describers.what_threads_are_compiling,
        bun_core::current_work::describe_what_threads_are_compiling,
    );
    let _ = stderr_writer().write_all(&lines[..length]);
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
                let _ = std::alloc::take_alloc_error_hook();
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
        std::alloc::set_alloc_error_hook(end_build_where_allocation_fails);
    }
    BuildUnderWay
}

/// `Vec`, `Box` and the like call this where the global allocator hands back null, and abort when it returns.
/// On a thread that is at work for a build that is the build's error, as where the build's own arenas get no memory.
/// On any other thread it says what std says.
fn end_build_where_allocation_fails(layout: core::alloc::Layout) {
    if place_of_this_thread().is_some() {
        crate::out_of_memory();
    }
    let _ = writeln!(
        stderr_writer(),
        "memory allocation of {} bytes failed",
        layout.size()
    );
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
    signal::signal_default(signal);
    // It is delivered when the handler returns.
    signal::raise(signal);
}

#[cfg(unix)]
extern "C" fn handle_interruption(signal: c_int) {
    write_what_threads_are_compiling();
    raise_with_default_action(signal);
}

/// A signal that the program handles or ignores stays as it is.
#[cfg(unix)]
fn set_reports_interruptions(reports: bool) {
    let ours = Action::call(handle_interruption, libc::SA_RESTART);
    for signal in INTERRUPTIONS {
        let current = Action::of(signal).map(|action| action.handler());
        if reports && current == Some(libc::SIG_DFL) {
            // SAFETY: the handler reads what `current_work` keeps for it, takes no lock and ends the process.
            unsafe { ours.install(signal) };
        } else if !reports && current == Some(ours.handler()) {
            signal::reset(signal, libc::SA_RESTART);
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
#[cfg(all(unix, bun_asan))]
fn report_what_the_sanitizer_leaves() {
    use core::ffi::c_void;
    extern "C" fn write_at_death() {
        write_where_this_thread_stopped(&mut stderr_writer());
    }
    /// # Safety
    /// Only the kernel calls this, for a signal.
    unsafe extern "C" fn handle_crash(signal: c_int, info: &libc::siginfo_t, context: *mut c_void) {
        write_at_death();
        let mut writer = stderr_writer();
        let code = info.si_code;
        // SAFETY: both are words of the record. Which of them holds goes by the code.
        let (address, sender) = unsafe { (info.si_addr() as usize, info.si_pid()) };
        let this_process = std::process::id().cast_signed();
        let is_raised_by_instruction = (1..0x10000).contains(&code);
        let _ = if is_raised_by_instruction {
            write!(
                writer,
                "Signal {signal}, code {code}, at address 0x{address:x}.\n"
            )
        } else if sender == this_process {
            write!(writer, "Signal {signal} was sent by this process.\n")
        } else {
            write!(writer, "Signal {signal} was sent by process {sender}.\n")
        };
        #[cfg(all(
            target_os = "linux",
            any(target_arch = "x86_64", target_arch = "aarch64")
        ))]
        if is_raised_by_instruction
            // SAFETY: the third argument of this handler.
            && let Some(context) = unsafe { crate::SignalContext::new(context) }
        {
            crate::fault_registers::write_to(context, None, &mut |text| {
                let _ = writer.write_all(text);
            });
        }
        let _ = context;
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
        if Action::of(signal).is_some_and(|action| action.handler() == libc::SIG_DFL) {
            // SAFETY: the process is crashing, and the handler ends it.
            unsafe { Action::call_with_info(handle_crash, 0).install(signal) };
        }
    }
}

#[cfg(not(all(unix, bun_asan)))]
fn report_what_the_sanitizer_leaves() {}

#[cfg(all(test, unix))]
mod tests {
    use bun_core::current_work::{Step, set_step_of_build, working_on};
    use bun_core::signal::lacks_alternate_stack;
    use core::ffi::c_void;

    /// The step is that of the process.
    static STEP_OF_BUILD: bun_threading::Mutex = bun_threading::Mutex::new();

    extern "C" fn work(_: *mut c_void) -> *mut c_void {
        let lacks = working_on(Step::Check, b"/project/checked.ts", lacks_alternate_stack);
        core::ptr::without_provenance_mut(usize::from(!lacks))
    }

    /// Not a thread of `std`, which gives its own a stack for signals in a test.
    fn on_new_thread(
        start: extern "C" fn(*mut c_void) -> *mut c_void,
        argument: *mut c_void,
    ) -> *mut c_void {
        // SAFETY: all-zero is a valid `pthread_t` to write over.
        let mut thread: libc::pthread_t = unsafe { core::mem::zeroed() };
        let mut answer = core::ptr::null_mut();
        // SAFETY: the thread is joined before either place goes.
        unsafe {
            assert_eq!(
                libc::pthread_create(&raw mut thread, core::ptr::null(), start, argument),
                0
            );
            assert_eq!(libc::pthread_join(thread, &raw mut answer), 0);
        }
        answer
    }

    fn has_signal_stack_at_work() -> bool {
        !on_new_thread(work, core::ptr::null_mut()).is_null()
    }

    /// The handler that says where a build ran out of stack runs on that stack. `bun check` starts its threads without one.
    #[test]
    fn a_thread_at_work_has_a_stack_for_signals_in_a_build_alone() {
        let _alone = STEP_OF_BUILD.lock_guard();
        assert!(!has_signal_stack_at_work());
        set_step_of_build(Some(Step::Check));
        let has_in_build = has_signal_stack_at_work();
        set_step_of_build(None);
        assert!(has_in_build);
    }

    /// glibc runs the destructor of a key after those of `thread_local!`.
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    mod end_of_thread {
        use super::*;
        use core::cell::Cell;
        use core::ffi::c_int;

        thread_local! {
            static SMALLEST_SIZE: Cell<usize> = const { Cell::new(0) };
            static REFUSED: Cell<*mut c_void> = const { Cell::new(core::ptr::null_mut()) };
            static IS_REFUSED_UNMAPPED: Cell<bool> = const { Cell::new(false) };
        }

        /// macOS compares the size also where `SS_DISABLE` makes it mean nothing.
        ///
        /// SAFETY: as that of libc, which it replaces in this program.
        #[unsafe(no_mangle)]
        unsafe extern "C" fn sigaltstack(
            new: *const libc::stack_t,
            old: *mut libc::stack_t,
        ) -> c_int {
            // SAFETY: the caller's contract.
            unsafe {
                if let Some(new) = new.as_ref()
                    && new.ss_size < SMALLEST_SIZE.get()
                {
                    if !new.ss_sp.is_null() {
                        REFUSED.set(new.ss_sp);
                    }
                    return -1;
                }
                libc::syscall(libc::SYS_sigaltstack, new, old) as c_int
            }
        }

        /// SAFETY: as that of libc, which it replaces in this program.
        #[unsafe(no_mangle)]
        unsafe extern "C" fn munmap(address: *mut c_void, length: usize) -> c_int {
            if address == REFUSED.get() {
                IS_REFUSED_UNMAPPED.set(true);
            }
            // SAFETY: the caller's contract.
            unsafe { libc::syscall(libc::SYS_munmap, address, length) as c_int }
        }

        #[derive(Debug, PartialEq)]
        enum Left {
            NotAsked,
            Nothing,
            Mapped,
            Unmapped,
        }

        struct Case {
            key: libc::pthread_key_t,
            smallest_size: usize,
            left: Left,
        }

        extern "C" fn work_and_end(case: *mut c_void) -> *mut c_void {
            assert!(!work(case).is_null());
            // SAFETY: `left_at_the_end` keeps it until this thread is joined.
            unsafe {
                SMALLEST_SIZE.set((*case.cast::<Case>()).smallest_size);
                assert_eq!(
                    libc::pthread_setspecific((*case.cast::<Case>()).key, case),
                    0
                );
            }
            core::ptr::null_mut()
        }

        extern "C" fn look_at_what_is_left(case: *mut c_void) {
            // SAFETY: as in `work_and_end`. `stack_t` may be all zeroes, and `msync` only looks the address up.
            unsafe {
                let mut stack: libc::stack_t = core::mem::zeroed();
                assert_eq!(sigaltstack(core::ptr::null(), &raw mut stack), 0);
                (*case.cast::<Case>()).left = if stack.ss_flags & libc::SS_DISABLE != 0 {
                    Left::Nothing
                } else if libc::msync(stack.ss_sp, stack.ss_size, libc::MS_ASYNC) == 0 {
                    Left::Mapped
                } else {
                    Left::Unmapped
                };
            }
        }

        fn left_at_the_end(smallest_size: usize) -> Left {
            let mut case = Case {
                key: 0,
                smallest_size,
                left: Left::NotAsked,
            };
            // SAFETY: it writes `key`.
            let rc =
                unsafe { libc::pthread_key_create(&raw mut case.key, Some(look_at_what_is_left)) };
            assert_eq!(rc, 0);
            on_new_thread(work_and_end, (&raw mut case).cast());
            case.left
        }

        #[test]
        fn a_thread_never_has_a_stack_for_signals_that_is_unmapped() {
            let _alone = STEP_OF_BUILD.lock_guard();
            set_step_of_build(Some(Step::Check));
            let left = [libc::MINSIGSTKSZ, usize::MAX].map(left_at_the_end);
            set_step_of_build(None);
            assert_eq!(left, [Left::Nothing, Left::Mapped]);
        }

        extern "C" fn work_with_every_stack_refused(_: *mut c_void) -> *mut c_void {
            SMALLEST_SIZE.set(usize::MAX);
            assert!(work(core::ptr::null_mut()).is_null());
            core::ptr::without_provenance_mut(usize::from(IS_REFUSED_UNMAPPED.get()))
        }

        #[test]
        fn a_stack_for_signals_that_is_refused_is_unmapped() {
            let _alone = STEP_OF_BUILD.lock_guard();
            set_step_of_build(Some(Step::Check));
            let is_unmapped = on_new_thread(work_with_every_stack_refused, core::ptr::null_mut());
            set_step_of_build(None);
            assert!(!is_unmapped.is_null());
        }
    }
}
