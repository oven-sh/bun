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
}

impl Kind {
    pub fn from_number(number: u64) -> Option<Kind> {
        [Kind::Text, Kind::Listing, Kind::IsDirectory, Kind::RealPath, Kind::IsCaseSensitive, Kind::NativeText, Kind::Exists, Kind::Scanned].into_iter().find(|&kind| kind as u64 == number)
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Question {
    pub kind: Kind,
    pub path: Vec<u8>,
    pub answer: u64,
}

pub type Hash = fn(&[u8]) -> u64;

struct Noted {
    hash: Hash,
    questions: Vec<Question>,
    is_spoiled: bool,
}

static IS_NOTING: AtomicBool = AtomicBool::new(false);
static NOTED: Guarded<Option<Noted>> = Guarded::new(None);

/// From here to `end`, every question to the disk is noted, on whichever thread.
pub fn begin(hash: Hash) {
    *NOTED.lock() = Some(Noted { hash, questions: Vec::new(), is_spoiled: false });
    IS_NOTING.store(true, Ordering::Release);
}

/// Each question once, sorted. `None`: they do not tell the whole: something was read by another road, or one question was answered in
/// two ways.
pub fn end() -> Option<Vec<Question>> {
    IS_NOTING.store(false, Ordering::Release);
    let Noted { mut questions, is_spoiled, .. } = NOTED.lock().take()?;
    questions.sort_unstable();
    questions.dedup();
    let is_answered_in_two_ways = questions.windows(2).any(|pair| (pair[0].kind, &pair[0].path) == (pair[1].kind, &pair[1].path));
    (!is_spoiled && !is_answered_in_two_ways).then_some(questions)
}

/// Something is read that is not noted.
pub fn spoil() {
    if IS_NOTING.load(Ordering::Acquire)
        && let Some(noted) = NOTED.lock().as_mut()
    {
        noted.is_spoiled = true;
    }
}

thread_local! {
    static IS_UNNOTED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// What `run` asks on this thread is not noted: whoever calls it notes what comes of it.
pub(crate) fn unnoted<T>(run: impl FnOnce() -> T) -> T {
    let before = IS_UNNOTED.replace(true);
    let found = run();
    IS_UNNOTED.set(before);
    found
}

pub(crate) fn is_noting() -> bool {
    IS_NOTING.load(Ordering::Acquire)
}

pub fn note(kind: Kind, path: &[u8], answer: impl FnOnce(Hash) -> u64) {
    if !IS_NOTING.load(Ordering::Acquire) || IS_UNNOTED.get() {
        return;
    }
    let Some(hash) = NOTED.lock().as_ref().map(|noted| noted.hash) else { return };
    let answer = answer(hash);
    if let Some(noted) = NOTED.lock().as_mut() {
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
pub fn answered_otherwise(questions: &[Question], hash: Hash, threads: usize) -> Vec<usize> {
    let found: Guarded<Vec<usize>> = Guarded::new(Vec::new());
    let share = questions.len().div_ceil(threads.max(1)).max(1);
    std::thread::scope(|scope| {
        for (number, part) in questions.chunks(share).enumerate() {
            let found = &found;
            scope.spawn(move || {
                for (at, question) in part.iter().enumerate() {
                    if crate::host::answer_now(question.kind, &question.path, hash) != question.answer {
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
