//! Which file each thread that loads, checks or lowers a program is at, for whoever says where that work has stopped or
//! what it is still busy with. Only its thread writes a record. Any thread reads it at any moment, a signal handler too.

use core::cell::Cell;
use core::marker::PhantomData;
use core::sync::atomic::Ordering::{Acquire, Relaxed, Release};
use core::sync::atomic::{AtomicBool, AtomicU8, AtomicU64};
use std::sync::OnceLock;
use std::time::Instant;

/// By the names that an internal error of a build has for them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Step {
    Load = 1,
    BindModules,
    Check,
    Lower,
    LinkAndEmit,
}

impl Step {
    fn from_raw(raw: u8) -> Option<Step> {
        [
            Step::Load,
            Step::BindModules,
            Step::Check,
            Step::Lower,
            Step::LinkAndEmit,
        ]
        .into_iter()
        .find(|&step| step as u8 == raw)
    }

    pub const fn name(self) -> &'static str {
        match self {
            Step::Load => "Load",
            Step::BindModules => "BindModules",
            Step::Check => "Check",
            Step::Lower => "Lower",
            Step::LinkAndEmit => "LinkAndEmit",
        }
    }
}

const RECORDS: usize = 256;
const LONGEST_PATH: usize = 200;

#[repr(align(128))]
struct Record {
    is_taken: AtomicBool,
    /// 0: the thread is at no file.
    step: AtomicU8,
    path_length: AtomicU8,
    started_at: AtomicU64,
    /// The end of the path where it is longer.
    path: [AtomicU8; LONGEST_PATH],
}

impl Record {
    const fn new() -> Record {
        Record {
            is_taken: AtomicBool::new(false),
            step: AtomicU8::new(0),
            path_length: AtomicU8::new(0),
            started_at: AtomicU64::new(0),
            path: [const { AtomicU8::new(0) }; LONGEST_PATH],
        }
    }

    fn set(&self, work: Option<(Step, &[u8], u64)>) {
        self.step.store(0, Relaxed);
        let Some((step, path, started_at)) = work else {
            return;
        };
        let end = &path[path.len().saturating_sub(LONGEST_PATH)..];
        for (to, &byte) in self.path.iter().zip(end) {
            to.store(byte, Relaxed);
        }
        self.path_length.store(end.len() as u8, Relaxed);
        self.started_at.store(started_at, Relaxed);
        self.step.store(step as u8, Relaxed);
    }
}

static ALL_RECORDS: [Record; RECORDS] = [const { Record::new() }; RECORDS];
/// The step that the build as a whole is at, and since when.
static STEP_OF_BUILD: AtomicU8 = AtomicU8::new(0);
static STEP_OF_BUILD_STARTED_AT: AtomicU64 = AtomicU64::new(0);

fn milliseconds_now() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

struct GivesRecordBack;

impl Drop for GivesRecordBack {
    fn drop(&mut self) {
        if let Some(record) = RECORD.try_with(Cell::take).ok().flatten() {
            record.set(None);
            record.is_taken.store(false, Release);
        }
    }
}

thread_local! {
    /// It has no destructor, so whoever reports a crash reads it on any thread without registering one.
    static RECORD: Cell<Option<&'static Record>> = const { Cell::new(None) };
    static AT_END_OF_THREAD: GivesRecordBack = const { GivesRecordBack };
    /// What the record says, for the guard that puts it back.
    static CURRENT: Cell<Option<(Step, *const [u8], u64)>> = const { Cell::new(None) };
}

/// None where more threads work than there are records, or the thread is ending.
fn record_of_this_thread() -> Option<&'static Record> {
    if let Some(record) = RECORD.get() {
        return Some(record);
    }
    AT_END_OF_THREAD.try_with(|_| ()).ok()?;
    let free = (ALL_RECORDS.iter())
        .find(|record| !record.is_taken.load(Relaxed) && !record.is_taken.swap(true, Acquire));
    RECORD.set(free);
    free
}

pub struct WorkGuard<'a> {
    previous: Option<(Step, *const [u8], u64)>,
    path: PhantomData<&'a [u8]>,
}

impl Drop for WorkGuard<'_> {
    fn drop(&mut self) {
        CURRENT.set(self.previous);
        if let Some(record) = record_of_this_thread() {
            // SAFETY: the guard that was given that path is dropped after this one.
            record.set(
                self.previous
                    .map(|(step, path, started_at)| (step, unsafe { &*path }, started_at)),
            );
        }
    }
}

/// Until the guard is dropped, the calling thread is at that step of that file. Guards are dropped in the reverse of the
/// order they are made in.
#[must_use]
pub fn working_on(step: Step, path: &[u8]) -> WorkGuard<'_> {
    let started_at = milliseconds_now();
    let previous = CURRENT.replace(Some((step, core::ptr::from_ref(path), started_at)));
    if let Some(record) = record_of_this_thread() {
        record.set(Some((step, path, started_at)));
    }
    WorkGuard {
        previous,
        path: PhantomData,
    }
}

/// The step that a build is at as a whole, on whichever threads.
pub fn set_step_of_build(step: Option<Step>) {
    STEP_OF_BUILD_STARTED_AT.store(milliseconds_now(), Relaxed);
    STEP_OF_BUILD.store(step.map_or(0, |step| step as u8), Relaxed);
}

struct Text<'a> {
    buffer: &'a mut [u8],
    length: usize,
}

impl Text<'_> {
    fn push(&mut self, byte: u8) {
        if let Some(to) = self.buffer.get_mut(self.length) {
            *to = byte;
            self.length += 1;
        }
    }

    fn push_all(&mut self, text: &str) {
        text.bytes().for_each(|byte| self.push(byte));
    }

    fn push_number(&mut self, mut number: u64) {
        let mut digits = [0u8; 20];
        let mut count = 0;
        loop {
            digits[count] = b'0' + (number % 10) as u8;
            count += 1;
            number /= 10;
            if number == 0 {
                break;
            }
        }
        digits[..count].iter().rev().for_each(|&it| self.push(it));
    }

    /// "Stopped while checking a.ts", "Still compiling a.ts in Lower", "Still compiling in BindModules".
    fn push_work(&mut self, start: &str, record: Option<&Record>, step: Step) {
        self.push_all(start);
        let (verb, names_step) = match step {
            Step::Load if record.is_some() => (" loading", false),
            Step::Check if record.is_some() => (" checking", false),
            _ => (" compiling", true),
        };
        self.push_all(verb);
        if let Some(record) = record {
            self.push(b' ');
            let length = (record.path_length.load(Relaxed) as usize).min(LONGEST_PATH);
            if length == LONGEST_PATH {
                self.push_all("...");
            }
            for byte in &record.path[..length] {
                let byte = byte.load(Relaxed);
                let is_shown = byte >= 0x20 && byte != 0x7f;
                self.push(if is_shown { byte } else { b'?' });
            }
        }
        if names_step {
            self.push_all(" in ");
            self.push_all(step.name());
        }
    }
}

/// Writes a line that says which file the calling thread is at, or else which step the build is at, and returns its
/// length: 0 where there is neither. It allocates nothing and takes no lock.
pub fn describe_where_this_thread_stopped(buffer: &mut [u8]) -> usize {
    let mut text = Text { buffer, length: 0 };
    let record = RECORD.get();
    let at_file = record.and_then(|it| Some((it, Step::from_raw(it.step.load(Relaxed))?)));
    match (at_file, Step::from_raw(STEP_OF_BUILD.load(Relaxed))) {
        (Some((record, step)), _) => text.push_work("Stopped while", Some(record), step),
        (None, Some(step)) => text.push_work("Stopped while", None, step),
        (None, None) => return 0,
    }
    text.push_all(".\n");
    text.length
}

/// Writes a line for each thread that is at a file, or else one for the step that the build is at, and returns their
/// length. It allocates nothing and takes no lock.
pub fn describe_what_threads_are_compiling(buffer: &mut [u8]) -> usize {
    let mut text = Text { buffer, length: 0 };
    let finish = |text: &mut Text<'_>, started_at: u64| {
        text.push_all(" for ");
        text.push_number(milliseconds_now().saturating_sub(started_at) / 1000);
        text.push_all(" s.\n");
    };
    for record in &ALL_RECORDS {
        if let Some(step) = Step::from_raw(record.step.load(Relaxed)) {
            text.push_work("Still", Some(record), step);
            finish(&mut text, record.started_at.load(Relaxed));
        }
    }
    if text.length == 0
        && let Some(step) = Step::from_raw(STEP_OF_BUILD.load(Relaxed))
    {
        text.push_work("Still", None, step);
        finish(&mut text, STEP_OF_BUILD_STARTED_AT.load(Relaxed));
    }
    text.length
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(describe: fn(&mut [u8]) -> usize) -> String {
        let mut buffer = [0u8; 4096];
        let length = describe(&mut buffer);
        String::from_utf8_lossy(&buffer[..length]).into_owned()
    }

    #[test]
    fn a_thread_names_the_file_it_is_at_and_the_one_around_it_afterwards() {
        assert_eq!(said(describe_where_this_thread_stopped), "");
        let outer = working_on(Step::Lower, b"/project/outer.ts");
        {
            let _inner = working_on(Step::Check, b"/project/inner.ts");
            assert_eq!(
                said(describe_where_this_thread_stopped),
                "Stopped while checking /project/inner.ts.\n"
            );
        }
        assert_eq!(
            said(describe_where_this_thread_stopped),
            "Stopped while compiling /project/outer.ts in Lower.\n"
        );
        let from_elsewhere = std::thread::spawn(|| {
            (
                said(describe_where_this_thread_stopped),
                said(describe_what_threads_are_compiling),
            )
        });
        let (of_other_thread, of_all_threads) = from_elsewhere.join().unwrap();
        assert_eq!(of_other_thread, "");
        assert!(of_all_threads.contains("Still compiling /project/outer.ts in Lower for 0 s.\n"));
        drop(outer);
        assert_eq!(said(describe_where_this_thread_stopped), "");
    }

    #[test]
    fn a_long_path_keeps_its_end() {
        let path = [b"/long".repeat(60), b"/end.ts".to_vec()].concat();
        let _work = working_on(Step::Load, &path);
        let said = said(describe_where_this_thread_stopped);
        assert!(said.starts_with("Stopped while loading ...") && said.ends_with("/end.ts.\n"));
        assert!(said.len() < 260);
    }
}
