//! Counts the instructions that the threads of a build execute in each step of processing a file, for
//! `BUN_JSC_logAOTPhaseTimes`. Nested steps count toward the innermost step only.

use core::sync::atomic::Ordering::Relaxed;
use core::sync::atomic::{AtomicBool, AtomicU64};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FileStep {
    LoadCode,
    ParseCode,
    TransformTree,
    Bind,
    Fold,
    FindImportSites,
    ResolveImports,
    FindBuiltins,
    LoadTypes,
    ParseTypes,
    Check,
    Lower,
    Commit,
    /// Instructions of visits whose task was discarded.
    Discarded,
}

impl FileStep {
    const ALL: [FileStep; 14] = [
        FileStep::LoadCode,
        FileStep::ParseCode,
        FileStep::TransformTree,
        FileStep::Bind,
        FileStep::Fold,
        FileStep::FindImportSites,
        FileStep::ResolveImports,
        FileStep::FindBuiltins,
        FileStep::LoadTypes,
        FileStep::ParseTypes,
        FileStep::Check,
        FileStep::Lower,
        FileStep::Commit,
        FileStep::Discarded,
    ];

    const fn name(self) -> &'static str {
        match self {
            FileStep::LoadCode => "load code, the rest",
            FileStep::ParseCode => "parse code",
            FileStep::TransformTree => "transform the tree",
            FileStep::Bind => "bind",
            FileStep::Fold => "fold",
            FileStep::FindImportSites => "find import sites",
            FileStep::ResolveImports => "resolve imports",
            FileStep::FindBuiltins => "find built-ins",
            FileStep::LoadTypes => "load types, the rest",
            FileStep::ParseTypes => "parse and bind types",
            FileStep::Check => "check",
            FileStep::Lower => "lower",
            FileStep::Commit => "commit",
            FileStep::Discarded => "discarded visits",
        }
    }
}

static IS_COUNTING: AtomicBool = AtomicBool::new(false);
static COUNTS: [[AtomicU64; 2]; FileStep::ALL.len()] =
    [const { [const { AtomicU64::new(0) }; 2] }; FileStep::ALL.len()];

pub fn begin_counting() {
    IS_COUNTING.store(counter::COUNTS, Relaxed);
}

/// Each step counted since the last call, as (its name, its instructions, how often it ran).
pub fn take_counts() -> impl Iterator<Item = (&'static str, u64, u64)> {
    let counts = FileStep::ALL.into_iter().map(|step| {
        let [instructions, times] = &COUNTS[step as usize];
        (
            step.name(),
            instructions.swap(0, Relaxed),
            times.swap(0, Relaxed),
        )
    });
    counts.filter(|&(_, _, times)| times != 0)
}

/// Counts for `step` until the guard is dropped.
#[inline]
pub fn count(step: FileStep) -> Option<CountedStep> {
    match IS_COUNTING.load(Relaxed) {
        true => counter::begin(step),
        false => None,
    }
}

pub struct CountedStep {
    outer: Option<FileStep>,
}

impl CountedStep {
    /// The instructions of this thread so far.
    pub fn now(&self) -> u64 {
        counter::read().unwrap_or(0)
    }

    /// Adds what a visit took since `before` (`now`) to `FileStep::Discarded`.
    pub fn note_discarded_visit(&self, before: u64) {
        add(FileStep::Discarded, self.now().saturating_sub(before), 1);
    }
}

impl Drop for CountedStep {
    #[cold]
    fn drop(&mut self) {
        counter::end(self.outer);
    }
}

fn add(step: FileStep, instructions: u64, times: u64) {
    let [total, total_times] = &COUNTS[step as usize];
    total.fetch_add(instructions, Relaxed);
    total_times.fetch_add(times, Relaxed);
}

#[cfg(target_os = "linux")]
mod counter {
    use super::{CountedStep, FileStep, add};
    use core::cell::Cell;
    use core::ffi::{c_int, c_void};
    use std::sync::OnceLock;

    pub(super) const COUNTS: bool = true;

    struct ThreadCounter {
        file: Option<c_int>,
        /// The innermost step, and the thread's instruction count when it started or resumed.
        current: Cell<(Option<FileStep>, u64)>,
    }

    impl Drop for ThreadCounter {
        fn drop(&mut self) {
            if let Some(file) = self.file {
                // SAFETY: `open` opened it, and nothing else has it.
                unsafe { libc::close(file) };
            }
        }
    }

    /// Not `thread_local!`, which would add its size to every thread.
    fn key() -> Option<libc::pthread_key_t> {
        static KEY: OnceLock<Option<libc::pthread_key_t>> = OnceLock::new();
        unsafe extern "C" fn free(counter: *mut c_void) {
            // SAFETY: `of_this_thread` made it, and its thread is ending.
            drop(unsafe { Box::from_raw(counter.cast::<ThreadCounter>()) });
        }
        *KEY.get_or_init(|| {
            let mut key = 0;
            // SAFETY: it writes `key`.
            let result = unsafe { libc::pthread_key_create(&raw mut key, Some(free)) };
            (result == 0).then_some(key)
        })
    }

    fn with_counter<R>(use_counter: impl FnOnce(&ThreadCounter) -> Option<R>) -> Option<R> {
        let key = key()?;
        // SAFETY: `key` is never deleted.
        let mut counter = unsafe { libc::pthread_getspecific(key) }.cast::<ThreadCounter>();
        if counter.is_null() {
            counter = Box::into_raw(Box::new(ThreadCounter {
                file: open(),
                current: Cell::new((None, 0)),
            }));
            // SAFETY: `free` takes the box back.
            if unsafe { libc::pthread_setspecific(key, counter.cast()) } != 0 {
                // SAFETY: nothing else has it.
                drop(unsafe { Box::from_raw(counter) });
                return None;
            }
        }
        // SAFETY: it lives until this thread ends.
        use_counter(unsafe { &*counter })
    }

    fn open() -> Option<c_int> {
        const HARDWARE: u64 = 0;
        const SIZE: u64 = 64;
        const INSTRUCTIONS: u64 = 1;
        const EXCLUDE_KERNEL: u64 = 1 << 5;
        const EXCLUDE_HYPERVISOR: u64 = 1 << 6;
        const CLOSE_ON_EXEC: core::ffi::c_long = 8;
        let flags = EXCLUDE_KERNEL | EXCLUDE_HYPERVISOR;
        let attributes: [u64; 8] = [HARDWARE | SIZE << 32, INSTRUCTIONS, 0, 0, 0, flags, 0, 0];
        // SAFETY: the kernel reads the 64 bytes that the size names and keeps no pointer.
        let file = unsafe {
            libc::syscall(
                libc::SYS_perf_event_open,
                attributes.as_ptr(),
                0 as core::ffi::c_long,
                -1 as core::ffi::c_long,
                -1 as core::ffi::c_long,
                CLOSE_ON_EXEC,
            )
        };
        (file >= 0).then_some(file as c_int)
    }

    fn read_of(counter: &ThreadCounter) -> Option<u64> {
        let mut count = 0u64;
        // SAFETY: it writes at most the eight bytes of `count`.
        let size = unsafe { libc::read(counter.file?, (&raw mut count).cast(), size_of::<u64>()) };
        (size == size_of::<u64>() as isize).then_some(count)
    }

    pub(super) fn read() -> Option<u64> {
        with_counter(read_of)
    }

    #[cold]
    pub(super) fn begin(step: FileStep) -> Option<CountedStep> {
        with_counter(|counter| {
            let now = read_of(counter)?;
            let (outer, since) = counter.current.replace((Some(step), now));
            if let Some(outer) = outer {
                add(outer, now.saturating_sub(since), 0);
            }
            Some(CountedStep { outer })
        })
    }

    pub(super) fn end(outer: Option<FileStep>) {
        with_counter(|counter| {
            let now = read_of(counter)?;
            let (step, since) = counter.current.replace((outer, now));
            if let Some(step) = step {
                add(step, now.saturating_sub(since), 1);
            }
            Some(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
mod counter {
    use super::{CountedStep, FileStep};

    pub(super) const COUNTS: bool = false;

    pub(super) fn read() -> Option<u64> {
        None
    }

    pub(super) fn begin(_: FileStep) -> Option<CountedStep> {
        None
    }

    pub(super) fn end(_: Option<FileStep>) {}
}
