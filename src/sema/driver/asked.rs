//! What a check has asked the disk. A check is a function of the Bun that runs it, of how it was started and of these answers: one that
//! would be answered the same again finds the same again.

use bun_threading::Guarded;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum Kind {
    /// Of a path in the checker's format, like all but the last two.
    Text,
    Listing,
    IsDirectory,
    RealPath,
    IsCaseSensitive,
    /// Of a path as the system has it.
    NativeText,
    Exists,
    /// Of a path in the checker's format: what the search of a file that the program may not hold has found.
    Scanned,
    /// Of a path in the checker's format: what the listing of a directory above the working directory says of one name.
    Entry,
}

impl Kind {
    pub fn from_number(number: u64) -> Option<Kind> {
        [Kind::Text, Kind::Listing, Kind::IsDirectory, Kind::RealPath, Kind::IsCaseSensitive, Kind::NativeText, Kind::Exists, Kind::Scanned, Kind::Entry].into_iter().find(|&kind| kind as u64 == number)
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Question {
    pub kind: Kind,
    pub path: Vec<u8>,
    pub answer: u64,
}

pub type Hash = fn(&[u8]) -> u64;

struct Recording {
    hash: Hash,
    questions: Vec<Question>,
    is_invalidated: bool,
}

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static RECORDED: Guarded<Option<Recording>> = Guarded::new(None);

/// From here to `end`, every question to the disk is noted, on whichever thread.
static WORKING_DIRECTORY: Guarded<Vec<u8>> = Guarded::new(Vec::new());

/// In the checker's format. It is the same when the questions are asked again.
pub fn set_working_directory(path: &[u8]) {
    *WORKING_DIRECTORY.lock() = path.to_vec();
}

/// The name in `directory` that leads to the working directory, if `directory` is above it.
pub(crate) fn child_toward_working_directory(directory: &[u8]) -> Option<Vec<u8>> {
    let working_directory = WORKING_DIRECTORY.lock();
    let below = working_directory.strip_prefix(directory)?;
    let below = if directory.ends_with(b"/") { below } else { below.strip_prefix(b"/")? };
    let name = below.split(|&byte| byte == b'/').next()?;
    (!name.is_empty()).then(|| name.to_vec())
}

pub fn begin(hash: Hash) {
    *RECORDED.lock() = Some(Recording { hash, questions: Vec::new(), is_invalidated: false });
    IS_RECORDING.store(true, Ordering::Release);
}

/// Each question once, sorted. `None`: they do not tell the whole: something was read by another road, or one question was answered in
/// two ways.
pub fn end() -> Option<Vec<Question>> {
    IS_RECORDING.store(false, Ordering::Release);
    let Recording { mut questions, is_invalidated, .. } = RECORDED.lock().take()?;
    questions.sort_unstable();
    questions.dedup();
    let has_conflicting_answers = questions.windows(2).any(|pair| (pair[0].kind, &pair[0].path) == (pair[1].kind, &pair[1].path));
    (!is_invalidated && !has_conflicting_answers).then_some(questions)
}

/// Something is read that is not noted.
pub fn invalidate_recording() {
    if IS_RECORDING.load(Ordering::Acquire)
        && let Some(noted) = RECORDED.lock().as_mut()
    {
        noted.is_invalidated = true;
    }
}

thread_local! {
    static IS_RECORDING_SUSPENDED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// What `run` asks on this thread is not noted: whoever calls it notes what comes of it.
pub(crate) fn without_recording<T>(run: impl FnOnce() -> T) -> T {
    let before = IS_RECORDING_SUSPENDED.replace(true);
    let found = run();
    IS_RECORDING_SUSPENDED.set(before);
    found
}

pub(crate) fn is_recording() -> bool {
    IS_RECORDING.load(Ordering::Acquire)
}

pub fn note(kind: Kind, path: &[u8], answer: impl FnOnce(Hash) -> u64) {
    if !IS_RECORDING.load(Ordering::Acquire) || IS_RECORDING_SUSPENDED.get() {
        return;
    }
    let Some(hash) = RECORDED.lock().as_ref().map(|noted| noted.hash) else { return };
    let answer = answer(hash);
    if let Some(noted) = RECORDED.lock().as_mut() {
        noted.questions.push(Question { kind, path: path.to_vec(), answer });
    }
}

pub fn of_text(hash: Hash, text: Option<&[u8]>) -> u64 {
    text.map_or(0, |text| hash(text) | 1)
}

pub(crate) fn exists(path: &[u8]) -> bool {
    let is_there = bun_sys::exists(path);
    note(Kind::Exists, path, |_| u64::from(is_there));
    is_there
}

/// Which of them the disk answers otherwise than it did, in order.
pub fn changed_answers(questions: &[Question], hash: Hash, threads: usize) -> Vec<usize> {
    let found: Guarded<Vec<usize>> = Guarded::new(Vec::new());
    let share = questions.len().div_ceil(threads.max(1)).max(1);
    std::thread::scope(|scope| {
        for (number, part) in questions.chunks(share).enumerate() {
            let found = &found;
            scope.spawn(move || {
                for (at, question) in part.iter().enumerate() {
                    if crate::host::current_answer(question.kind, &question.path, hash) != question.answer {
                        found.lock().push(number * share + at);
                    }
                }
            });
        }
    });
    let mut found = std::mem::take(&mut *found.lock());
    found.sort_unstable();
    found
}
