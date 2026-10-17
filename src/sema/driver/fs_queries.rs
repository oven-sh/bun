use bun_threading::Guarded;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum Kind {
    Text,
    Listing,
    IsDirectory,
    RealPath,
    IsCaseSensitive,
    NativeText,
    Exists,
    Scanned,
    Entry,
}

impl Kind {
    pub fn from_number(number: u64) -> Option<Kind> {
        [Kind::Text, Kind::Listing, Kind::IsDirectory, Kind::RealPath, Kind::IsCaseSensitive, Kind::NativeText, Kind::Exists, Kind::Scanned, Kind::Entry].into_iter().find(|&kind| kind as u64 == number)
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct FsQuery {
    pub kind: Kind,
    pub path: Vec<u8>,
    pub answer: u64,
}

pub type Hash = fn(&[u8]) -> u64;

struct Recording {
    hash: Hash,
    queries: Vec<FsQuery>,
    is_invalidated: bool,
}

static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static RECORDED: Guarded<Option<Recording>> = Guarded::new(None);

static WORKING_DIRECTORY: Guarded<Vec<u8>> = Guarded::new(Vec::new());

pub fn set_working_directory(path: &[u8]) {
    *WORKING_DIRECTORY.lock() = path.to_vec();
}

pub(crate) fn child_toward_working_directory(directory: &[u8]) -> Option<Vec<u8>> {
    let working_directory = WORKING_DIRECTORY.lock();
    let below = working_directory.strip_prefix(directory)?;
    let below = if directory.ends_with(b"/") { below } else { below.strip_prefix(b"/")? };
    let name = below.split(|&byte| byte == b'/').next()?;
    (!name.is_empty()).then(|| name.to_vec())
}

pub fn begin(hash: Hash) {
    *RECORDED.lock() = Some(Recording { hash, queries: Vec::new(), is_invalidated: false });
    IS_RECORDING.store(true, Ordering::Release);
}

pub fn end() -> Option<Vec<FsQuery>> {
    IS_RECORDING.store(false, Ordering::Release);
    let Recording { mut queries, is_invalidated, .. } = RECORDED.lock().take()?;
    queries.sort_unstable();
    queries.dedup();
    let has_conflicting_answers = queries.windows(2).any(|pair| (pair[0].kind, &pair[0].path) == (pair[1].kind, &pair[1].path));
    (!is_invalidated && !has_conflicting_answers).then_some(queries)
}

pub fn invalidate_recording() {
    if IS_RECORDING.load(Ordering::Acquire)
        && let Some(recorded) = RECORDED.lock().as_mut()
    {
        recorded.is_invalidated = true;
    }
}

thread_local! {
    static IS_RECORDING_SUSPENDED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub(crate) fn without_recording<T>(run: impl FnOnce() -> T) -> T {
    let before = IS_RECORDING_SUSPENDED.replace(true);
    let found = run();
    IS_RECORDING_SUSPENDED.set(before);
    found
}

pub(crate) fn is_recording() -> bool {
    IS_RECORDING.load(Ordering::Acquire)
}

pub fn record_query(kind: Kind, path: &[u8], answer: impl FnOnce(Hash) -> u64) {
    if !IS_RECORDING.load(Ordering::Acquire) || IS_RECORDING_SUSPENDED.get() {
        return;
    }
    let Some(hash) = RECORDED.lock().as_ref().map(|recorded| recorded.hash) else { return };
    let answer = answer(hash);
    if let Some(recorded) = RECORDED.lock().as_mut() {
        recorded.queries.push(FsQuery { kind, path: path.to_vec(), answer });
    }
}

pub fn of_text(hash: Hash, text: Option<&[u8]>) -> u64 {
    text.map_or(0, |text| hash(text) | 1)
}

pub(crate) fn exists(path: &[u8]) -> bool {
    let is_there = bun_sys::exists(path);
    record_query(Kind::Exists, path, |_| u64::from(is_there));
    is_there
}

pub fn changed_answers(queries: &[FsQuery], hash: Hash, threads: usize) -> Vec<usize> {
    let found: Guarded<Vec<usize>> = Guarded::new(Vec::new());
    let share = queries.len().div_ceil(threads.max(1)).max(1);
    std::thread::scope(|scope| {
        for (number, part) in queries.chunks(share).enumerate() {
            let found = &found;
            scope.spawn(move || {
                for (at, query) in part.iter().enumerate() {
                    if crate::host::current_answer(query.kind, &query.path, hash) != query.answer {
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
