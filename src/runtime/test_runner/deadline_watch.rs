//! Ends a `bun test` process whose JavaScript thread is `grace_ms` late for the deadline that the test runner waits for.

use core::sync::atomic::{AtomicBool, Ordering};
use core::time::Duration;
use std::io::Write as _;

use bun_core::time::NS_PER_MS;
use bun_core::{Output, Timespec, TimespecMockMode, strings};
use bun_threading::Guarded;

use super::bun_test::{BunTest, SequenceEntryId};
use super::jest::FileHeader;

/// What a `--parallel` worker exits with. See `Coordinator::reap_worker`.
pub(crate) const WORKER_EXIT_CODE: u8 = 124;
/// Printed before the process ends. With `WORKER_EXIT_CODE` it tells the coordinator that the watch ended the worker.
pub(crate) const MESSAGE: &str = "still blocked the event loop";

pub(crate) struct Config {
    /// How long the JavaScript thread may be late for a deadline.
    pub(crate) grace_ms: u64,
    pub(crate) is_worker: bool,
    /// The `--dots` reporter leaves its line open.
    pub(crate) prints_dots: bool,
    /// `--parallel` was not given, so it would help.
    pub(crate) suggests_parallel: bool,
    /// What a run that ends here does not write, for the note: ", JUnit report".
    pub(crate) unwritten_reports: &'static str,
}

struct State {
    config: Config,
    /// Under `--watch`, where a change of a file restarts a blocked run: the watch reports what blocks and ends nothing.
    only_reports: bool,
    /// What the JavaScript thread is due back for, in nanoseconds on the clock of `Timespec::now`. 0: nothing.
    deadline: u64,
    /// Counts the changes of `deadline`, which can change back to the same time.
    generation: u64,
    /// The JavaScript thread is inside the callback of `label`. Otherwise it went back to the event loop.
    is_in_callback: bool,
    /// The deadline is the timeout of `label`, the only test that runs.
    has_label: bool,
    label: Label,
    /// What `label.name` holds.
    label_key: u64,
    /// The header of the test file, as long as the reporter has not printed it.
    unprinted_header: Option<FileHeader>,
}

static STATE: Guarded<State> = Guarded::new(State {
    config: Config { grace_ms: 5000, is_worker: false, prints_dots: false, suggests_parallel: false, unwritten_reports: "" },
    only_reports: false,
    deadline: 0,
    generation: 0,
    is_in_callback: false,
    has_label: false,
    label: Label::empty(),
    label_key: 0,
    unprinted_header: None,
});
/// Whether `STATE.deadline` is not 0, for the JavaScript thread, its only writer, to read without the lock.
static HAS_DEADLINE: AtomicBool = AtomicBool::new(false);
static IS_WATCHING: AtomicBool = AtomicBool::new(false);

/// The test that a deadline belongs to, for the report.
pub(crate) struct Label {
    /// Its end holds the names of the scopes, outermost first, and then of the test, with a NUL after each scope.
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

    /// The name of the test, of which only the start is kept if it is too long.
    pub(crate) fn set_test(&mut self, name: &[u8]) {
        let mut kept = name.len().min(Label::NAME_CAPACITY);
        // Not in the middle of a UTF-8 sequence.
        while kept < name.len() && kept > 0 && name[kept] & 0xC0 == 0x80 {
            kept -= 1;
        }
        self.name_start = Label::NAME_CAPACITY - kept;
        self.name[self.name_start..].copy_from_slice(&name[..kept]);
    }

    /// The scope around what the label holds. False if it does not fit, and then no scope around it is added.
    pub(crate) fn add_scope(&mut self, name: &[u8]) -> bool {
        let Some(start) = self.name_start.checked_sub(name.len() + 1) else {
            return false;
        };
        self.name[start..][..name.len()].copy_from_slice(name);
        self.name[start + name.len()] = 0;
        self.name_start = start;
        true
    }

    fn scopes_and_test(&self) -> (&[u8], &[u8]) {
        let names = &self.name[self.name_start..];
        match strings::last_index_of_char(names, 0) {
            Some(last) => (&names[..last], &names[last + 1..]),
            None => (&[], names),
        }
    }
}

/// A test or hook for `calling` and `waiting`.
pub(crate) struct Entry<'a> {
    /// The same for a test and each of its hooks, and for nothing else.
    pub(crate) key: u64,
    pub(crate) timeout_ms: u32,
    pub(crate) is_hook: bool,
    /// `buntest.write_label(named, label)` names the test in a label that is empty.
    pub(crate) buntest: &'a BunTest,
    pub(crate) named: SequenceEntryId,
}

/// Before the first test runs.
pub(crate) fn configure(config: Config) {
    STATE.lock().config = config;
}

/// See `State::only_reports`.
pub(crate) fn only_report() {
    STATE.lock().only_reports = true;
}

/// The reporter prints the header of a test file with the first line it prints for the file.
pub(crate) fn set_unprinted_header(header: Option<FileHeader>) {
    STATE.lock().unprinted_header = header;
}

/// The JavaScript thread calls a test or hook whose timeout ends at `deadline`.
pub(crate) fn calling(deadline: Timespec, entry: Entry<'_>) {
    publish(deadline, true, Some(entry));
}

/// The JavaScript thread is in the runner's own code, which has no timeout. Does not return once the watch ends the process.
#[inline]
pub(crate) fn in_runner() {
    if HAS_DEADLINE.load(Ordering::Relaxed) {
        publish(Timespec::EPOCH, false, None);
    }
}

/// The JavaScript thread goes back to the event loop, due back by `deadline`. `entry`: the only test or hook that runs.
pub(crate) fn waiting(deadline: Timespec, entry: Option<Entry<'_>>) {
    publish(deadline, false, entry);
}

/// For a thread that is about to end the process. Does not return once the watch ends it.
pub(crate) fn wait_if_ending() {
    drop(STATE.lock());
}

fn publish(deadline: Timespec, is_in_callback: bool, entry: Option<Entry<'_>>) {
    let has_deadline = !deadline.eql(&Timespec::EPOCH);
    if !has_deadline && !HAS_DEADLINE.load(Ordering::Relaxed) {
        return;
    }
    // The watch keeps the lock from when it decides to end the process.
    let mut state = STATE.lock();
    state.deadline = if has_deadline { deadline.ns().max(1) } else { 0 };
    state.generation += 1;
    state.is_in_callback = is_in_callback;
    state.has_label = has_deadline && entry.is_some();
    if let Some(entry) = entry.filter(|_| has_deadline) {
        state.label.timeout_ms = entry.timeout_ms;
        state.label.is_hook = entry.is_hook;
        if state.label_key != entry.key {
            state.label_key = entry.key;
            state.label.name_start = Label::NAME_CAPACITY;
            entry.buntest.write_label(entry.named, &mut state.label);
        }
    }
    HAS_DEADLINE.store(has_deadline, Ordering::Relaxed);
    drop(state);

    if has_deadline && !IS_WATCHING.swap(true, Ordering::SeqCst) {
        bun_sys::stdio_writes::count();
        // SAFETY: the thread holds nothing of a VM. It reads `STATE`, which holds copies, and ends the process.
        if let Err(err) = std::thread::Builder::new().name("TestTimeout".into()).spawn(watch) {
            // The next test tries again. Until then a test that blocks the event loop hangs.
            IS_WATCHING.store(false, Ordering::SeqCst);
            static HAS_WARNED: AtomicBool = AtomicBool::new(false);
            if !HAS_WARNED.swap(true, Ordering::SeqCst) {
                bun_core::pretty_errorln!(
                    "<r><yellow>warn<r>: bun test could not start the thread that ends a run whose test blocks the event loop: {}",
                    err,
                );
                Output::flush();
            }
        }
    }
}

/// Ends the process once one deadline has stayed published, and in the past, through `grace_ms` of its own sleeps.
fn watch() {
    const LOOKS_PER_GRACE: u64 = 4;
    const SLEEPS_PER_GRACE: u64 = 16;
    Output::Source::configure_thread_no_js();
    // With every processor busy, as with tests that loop, the watch would wake up late by many time slices.
    #[cfg(windows)]
    bun_sys::windows::raise_priority_of_current_thread();
    let now = || Timespec::now(TimespecMockMode::ForceRealTime).ns();

    // Of which `generation` it has seen the deadline in the past, and for how long.
    let mut overdue: (u64, u64) = (0, 0);
    // Under `--watch`: the `generation` that it has reported.
    let mut reported_generation = 0;
    loop {
        let (deadline, generation, grace_ns) = {
            let state = STATE.lock();
            (state.deadline, state.generation, state.config.grace_ms.saturating_mul(NS_PER_MS).max(NS_PER_MS))
        };
        let before = now();
        if deadline == 0 || before < deadline {
            // The JavaScript thread never wakes the watch, so a test pays no system call for it.
            let until_deadline = if deadline == 0 { u64::MAX } else { deadline - before };
            std::thread::sleep(Duration::from_nanos(until_deadline.min(grace_ns / LOOKS_PER_GRACE)));
            continue;
        }
        if overdue.0 != generation {
            overdue = (generation, 0);
        }
        if overdue.1 >= grace_ns && reported_generation != generation {
            let state = STATE.lock();
            if state.generation != generation {
                continue;
            }
            if bun_jsc::debugger::holds_a_thread() || is_traced() {
                overdue.1 = 0;
            } else if !state.only_reports {
                end_process(&state, before);
            } else {
                reported_generation = generation;
                report(&state, before, false);
                Output::flush();
            }
        }
        let sleep_ns = match grace_ns.saturating_sub(overdue.1) {
            0 => grace_ns / SLEEPS_PER_GRACE,
            until_grace => until_grace.min(grace_ns / SLEEPS_PER_GRACE),
        };
        let was_held = bun_jsc::debugger::holds_a_thread();
        std::thread::sleep(Duration::from_nanos(sleep_ns.max(1)));
        let slept_ns = now().saturating_sub(before);
        if was_held || bun_jsc::debugger::holds_a_thread() {
            // A test that a debugger lets go on has the whole grace again.
            overdue.1 = 0;
        } else if !bun_sys::stdio_writes::is_one_under_way() {
            // A sleep that ends late counts for what it asked: the process may have been stopped (SIGSTOP, a suspended machine).
            overdue.1 = overdue.1.saturating_add(slept_ns.min(sleep_ns));
        }
    }
}

/// Whether a native debugger controls the process.
fn is_traced() -> bool {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let Ok(status) = bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/self/status") else {
            return false;
        };
        const FIELD: &[u8] = b"\nTracerPid:";
        strings::index_of(&status, FIELD)
            .and_then(|at| strings::split(&status[at + FIELD.len()..], b"\n").next())
            .is_some_and(|tracer| strings::trim(tracer, b" \t") != b"0")
    }
    #[cfg(target_os = "macos")]
    {
        use bun_sys::c::{PROC_PIDTBSDINFO, proc_pidinfo, struct_proc_bsdinfo};
        const PROC_FLAG_TRACED: u32 = 2;
        let mut info: struct_proc_bsdinfo = bun_core::ffi::zeroed();
        let size = core::mem::size_of::<struct_proc_bsdinfo>() as core::ffi::c_int;
        // SAFETY: `info` is `size` bytes that `proc_pidinfo` may write.
        let written =
            unsafe { proc_pidinfo(std::process::id() as libc::pid_t, PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size) };
        written == size && info.pbi_flags & PROC_FLAG_TRACED != 0
    }
    #[cfg(windows)]
    {
        bun_sys::windows::is_debugger_present()
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos", windows)))]
    {
        false
    }
}

/// Prints the test that is late for its deadline: as a test that failed if that `ends_process`, and as a warning if not.
#[cold]
fn report(state: &State, now: u64, ends_process: bool) {
    use crate::cli::test_command::{fmt_status_text_line, write_test_name};
    let colors = Output::enable_ansi_colors_stderr();
    let grace_ms = state.config.grace_ms;
    let timeout_ms = state.label.timeout_ms;
    let (scopes, test) = state.label.scopes_and_test();

    if state.config.prints_dots {
        bun_core::pretty_error!("<r>\n");
    }
    // A run that goes on prints the header with its next line.
    if let Some(header) = state.unprinted_header.as_ref().filter(|_| ends_process) {
        header.print();
    }
    Output::flush();
    let mut lines: Vec<u8> = Vec::new();
    if state.has_label && ends_process && Output::is_github_action() {
        let _ = writeln!(
            lines,
            "::error title=error: Test \"{}\" timed out after {}ms::",
            bun_core::fmt::github_action_property(test),
            timeout_ms,
        );
    }
    if ends_process {
        let _ = lines.write_all(&fmt_status_text_line(super::execution::Result::FailBecauseTimeout, colors));
    } else {
        let _ = bun_core::write_pretty!(lines, colors, "<r><yellow>warn<r>:");
    }
    if state.has_label {
        let scopes = strings::split(scopes, b"\0").filter(|_| !scopes.is_empty());
        write_test_name(&mut lines, colors, false, scopes, test);
        let started = state.deadline.saturating_sub(u64::from(timeout_ms) * NS_PER_MS);
        let elapsed = Output::ElapsedFormatter { colors, duration_ns: now.saturating_sub(started) };
        let timed_out = if state.label.is_hook { "a hook of this test" } else { "this test" };
        let blocked = if state.is_in_callback { " and" } else { ", and something" };
        let _ = bun_core::write_pretty!(
            lines,
            colors,
            " {}\n  <d>^<r> <red>{} timed out after {}ms{} {} {}ms later.<r>\n",
            elapsed,
            timed_out,
            timeout_ms,
            blocked,
            MESSAGE,
            grace_ms,
        );
    } else {
        write_test_name(&mut lines, colors, false, core::iter::empty(), b"(a test of this file)");
        let _ = bun_core::write_pretty!(
            lines,
            colors,
            "\n  <d>^<r> <red>a timeout passed, and something {} {}ms later.<r>\n",
            MESSAGE,
            grace_ms,
        );
    }
    let _ = Output::error_writer().write_all(&lines);
}

/// The caller keeps `state` locked, which stops the JavaScript thread before the next thing it would do with the runner.
#[cold]
fn end_process(state: &State, now: u64) -> ! {
    report(state, now, true);
    let config = &state.config;
    if !config.is_worker {
        if Output::is_github_action() {
            bun_core::pretty_error!("<r>\n::endgroup::\n");
        }
        bun_core::pretty_error!(
            "\n<r><red>error<r>: bun test cannot stop code that does not return to the event loop, so it ended the run.\n<d>note<r>: the tests and files after this one did not run, and no summary{} was written.{}\n",
            config.unwritten_reports,
            if config.suggests_parallel { " With --parallel, only this file ends." } else { "" },
        );
    }
    Output::flush();

    // A child that outlives the run can keep its output open, and whatever reads the output waits for that.
    #[cfg(unix)]
    bun_io::ParentDeathWatchdog::kill_descendants_while_other_threads_run();
    bun_core::Global::exit_while_other_threads_run(if config.is_worker { u32::from(WORKER_EXIT_CODE) } else { 1 })
}
