//! Ends a `bun test` process whose JavaScript thread no longer comes back to the test runner.
//!
//! The timeout of a test or hook is a timer of the event loop. Code that does not return to the
//! event loop (a loop without an end, a native call that blocks) keeps that timer from firing, so
//! nothing on the JavaScript thread can end it. The runner publishes the deadline it waits for, and
//! a thread that runs no JavaScript ends the process when the runner is `GRACE_MS` late for it.
//! The process ends, and not the test alone: JavaScript that another thread interrupts leaves
//! modules half loaded and promises unsettled for the tests after it.

use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use core::time::Duration;
use std::io::Write as _;

use bun_core::time::NS_PER_MS;
use bun_core::{Output, Timespec, TimespecMockMode};

/// What a `--parallel` worker exits with. See `Coordinator::reap_worker`.
pub(crate) const WORKER_EXIT_CODE: u8 = 124;
/// In what the process prints before it ends. With `WORKER_EXIT_CODE` it tells the coordinator that
/// the watch ended the worker, and not a test that called `process.exit(124)`.
pub(crate) const MESSAGE: &str = "had not returned to the event loop";

/// The deadline, in nanoseconds on the clock of `Timespec::now`, above `LABEL_BITS`. 0 is none.
static PUBLISHED: AtomicU64 = AtomicU64::new(0);
/// `PUBLISHED` from when the watch decides to end the process.
const ENDING: u64 = u64::MAX;
/// Which of `LABELS` names the test of the deadline.
const LABEL_INDEX: u64 = 1;
/// Whether one does.
const HAS_LABEL: u64 = 2;
const LABEL_BITS: u32 = 2;

static GRACE_MS: AtomicU64 = AtomicU64::new(5000);
static IS_WORKER: AtomicBool = AtomicBool::new(false);
static IS_WATCHING: AtomicBool = AtomicBool::new(false);

/// The test that a deadline belongs to, for the message.
pub(crate) struct Label {
    /// Its end holds "describe > test". A name that does not fit loses its start.
    name: [u8; Label::NAME_CAPACITY],
    name_start: usize,
    timeout_ms: u32,
    is_hook: bool,
}

impl Label {
    const NAME_CAPACITY: usize = 240;

    const fn empty() -> Label {
        Label { name: [0; Label::NAME_CAPACITY], name_start: Label::NAME_CAPACITY, timeout_ms: 0, is_hook: false }
    }

    pub(crate) fn set(&mut self, timeout_ms: u32, is_hook: bool) {
        self.timeout_ms = timeout_ms;
        self.is_hook = is_hook;
    }

    /// Puts `text` in front of the name.
    pub(crate) fn prepend(&mut self, text: &[u8]) {
        let kept = &text[text.len().saturating_sub(self.name_start)..];
        self.name_start -= kept.len();
        self.name[self.name_start..][..kept.len()].copy_from_slice(kept);
    }
}

struct LabelSlot(UnsafeCell<Label>);
// SAFETY: the JavaScript thread writes the label that `PUBLISHED` does not name. The watch reads the
// one it names, and only once it has stored `ENDING`, which stops the JavaScript thread at its next
// `publish`, before that thread could write this label again.
unsafe impl Sync for LabelSlot {}
static LABELS: [LabelSlot; 2] = [LabelSlot(UnsafeCell::new(Label::empty())), LabelSlot(UnsafeCell::new(Label::empty()))];

/// Before the first test runs. `grace_ms`: see `BUN_TEST_TIMEOUT_GRACE_MS`.
pub(crate) fn configure(grace_ms: Option<u64>, is_worker: bool) {
    if let Some(grace_ms) = grace_ms {
        GRACE_MS.store(grace_ms, Ordering::Relaxed);
    }
    IS_WORKER.store(is_worker, Ordering::Relaxed);
}

/// The JavaScript thread is about to call a test or hook whose timeout ends at `deadline`
/// (`Timespec::EPOCH`: it has none). `describe` names it.
pub(crate) fn calling(deadline: Timespec, describe: impl FnOnce(&mut Label)) {
    let current = PUBLISHED.load(Ordering::Relaxed);
    if deadline.eql(&Timespec::EPOCH) {
        return publish(current, current & LABEL_INDEX);
    }
    let index = !current & LABEL_INDEX;
    // SAFETY: see `LabelSlot`.
    let label = unsafe { &mut *LABELS[index as usize].0.get() };
    label.name_start = Label::NAME_CAPACITY;
    describe(label);
    publish(current, deadline.ns() << LABEL_BITS | HAS_LABEL | index);
}

/// The JavaScript thread goes back to the event loop, where the runner waits until `deadline` at the
/// latest (`Timespec::EPOCH`: for nothing that has a timeout).
pub(crate) fn waiting_until(deadline: Timespec) {
    let current = PUBLISHED.load(Ordering::Relaxed);
    let deadline = if deadline.eql(&Timespec::EPOCH) { 0 } else { deadline.ns() };
    // It waits for the callback it called last, whose label stays.
    if current >> LABEL_BITS == deadline {
        return;
    }
    publish(current, deadline << LABEL_BITS | current & LABEL_INDEX);
}

fn publish(current: u64, next: u64) {
    if next == current {
        return;
    }
    if PUBLISHED.swap(next, Ordering::SeqCst) == ENDING {
        // The watch reads a label and ends the process.
        loop {
            std::thread::park();
        }
    }
    if next >> LABEL_BITS != 0 && !IS_WATCHING.swap(true, Ordering::Relaxed) {
        // Without the thread, a test that blocks the event loop hangs, as it did before there was one.
        let _ = std::thread::Builder::new().name("TestTimeout".into()).stack_size(256 << 10).spawn(watch);
    }
}

/// Ends the process once it has seen one deadline stay published, and in the past, through
/// `GRACE_MS` of its own sleeps.
///
/// It counts its sleeps and not the clock: while the whole process is stopped (SIGSTOP, a suspended
/// machine) a deadline can pass by any amount, and the JavaScript thread handles it as soon as the
/// process runs again. A sleep that took longer than it asked for counts for little.
///
/// The JavaScript thread never wakes it, so that a test pays no system call for it: it looks at what
/// is published a few times per `GRACE_MS`.
fn watch() {
    const LOOKS_PER_GRACE: u64 = 4;
    const SLEEPS_PER_GRACE: u64 = 8;
    let now = || Timespec::now(TimespecMockMode::ForceRealTime).ns();

    let mut overdue: (u64, u64) = (0, 0);
    loop {
        let published = PUBLISHED.load(Ordering::SeqCst);
        let grace_ns = GRACE_MS.load(Ordering::Relaxed).saturating_mul(NS_PER_MS).max(NS_PER_MS);
        let deadline = published >> LABEL_BITS;
        let before = now();
        if deadline == 0 || before < deadline {
            let until_deadline = if deadline == 0 { u64::MAX } else { deadline - before };
            std::thread::sleep(Duration::from_nanos(until_deadline.min(grace_ns / LOOKS_PER_GRACE)));
            continue;
        }
        let seen_overdue_ns = if overdue.0 == published { overdue.1 } else { 0 };
        if seen_overdue_ns >= grace_ns {
            if PUBLISHED.compare_exchange(published, ENDING, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                end_process(published, before);
            }
            continue;
        }
        let sleep_ns = (grace_ns / SLEEPS_PER_GRACE).clamp(1, grace_ns - seen_overdue_ns);
        std::thread::sleep(Duration::from_nanos(sleep_ns));
        let slept_ns = now().saturating_sub(before).min(sleep_ns * 2);
        overdue = (published, seen_overdue_ns + slept_ns);
    }
}

#[cold]
fn end_process(published: u64, now: u64) -> ! {
    let colors = Output::enable_ansi_colors_stderr();
    let grace_ms = GRACE_MS.load(Ordering::Relaxed);
    let is_worker = IS_WORKER.load(Ordering::Relaxed);
    let failed = crate::cli::test_command::fmt_status_text_line(super::execution::Result::FailBecauseTimeout, colors);

    let mut message: Vec<u8> = Vec::new();
    let _ = message.write_all(&failed);
    if published & HAS_LABEL != 0 {
        // SAFETY: see `LabelSlot`.
        let label = unsafe { &*LABELS[(published & LABEL_INDEX) as usize].0.get() };
        let started = (published >> LABEL_BITS).saturating_sub(u64::from(label.timeout_ms) * NS_PER_MS);
        let _ = bun_core::write_pretty!(
            message,
            colors,
            "<r><b> {}<r> {}\n  <d>^<r> <red>{} timed out after {}ms and {} {}ms later.<r>\n",
            bstr::BStr::new(&label.name[label.name_start..]),
            Output::ElapsedFormatter { colors, duration_ns: now.saturating_sub(started) },
            if label.is_hook { "a hook of this test" } else { "this test" },
            label.timeout_ms,
            MESSAGE,
            grace_ms,
        );
    } else {
        let _ = bun_core::write_pretty!(
            message,
            colors,
            "<r><b> a test or hook of this file<r>\n  <d>^<r> <red>its timeout passed, and its code {} {}ms later.<r>\n",
            MESSAGE,
            grace_ms,
        );
    }
    if !is_worker {
        let _ = bun_core::write_pretty!(
            message,
            colors,
            "\n<r><red>error<r>: bun test cannot stop code that does not return to the event loop, so it ended the run.\n<d>note<r>: the tests and files after this one did not run. With --parallel, only this file ends.\n",
        );
    }
    let _ = bun_sys::File::borrow(&bun_sys::Fd::stderr()).write_all(&message);

    // The coordinator ends what a worker has started.
    #[cfg(unix)]
    if !is_worker {
        bun_io::ParentDeathWatchdog::kill_descendants();
    }
    bun_core::Global::exit(if is_worker { u32::from(WORKER_EXIT_CODE) } else { 1 })
}
