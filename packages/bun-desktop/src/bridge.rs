//! What waits for JavaScript to take it. Any thread may add to it.

use std::any::Any;
use std::collections::VecDeque;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::error::{Context as _, Result, failure};
use crate::hash::FastMap;
use crate::json::{Value, json};
use crate::small_vec::SmallVec;
use crate::sync::Mutex;
use crate::{diagnostics, host};

/// The first number of a record. `internal/desktop/native.ts` has the same list, and what follows each.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Json,
    Frame,
    Resize,
    Mouse,
    Wheel,
    Pinch,
    Key,
    Text,
    Scroll,
}

const MAX_FIELDS: usize = 10;

struct Queued {
    kind: Kind,
    fields: SmallVec<f64, MAX_FIELDS>,
    json: Value,
    is_replaceable: bool,
}

static EVENTS: Mutex<VecDeque<Queued>> = Mutex::new(VecDeque::new());
/// What the `Json` records that JavaScript took stand for.
static TAKEN: Mutex<Vec<Value>> = Mutex::new(Vec::new());
static NAMES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static BLOBS: Mutex<Option<FastMap<u32, Vec<u8>>>> = Mutex::new(None);
static NEXT_BLOB: AtomicU32 = AtomicU32::new(1);

/// How many `Frame` and `Resize` events were queued, and how many of them JavaScript took.
static EMITTED: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];
static DRAINED: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

fn count(kind: Kind, counters: &[AtomicU32; 2]) {
    if let Some(index) = [Kind::Frame, Kind::Resize]
        .iter()
        .position(|it| *it == kind)
    {
        counters[index].fetch_add(1, Ordering::Relaxed);
    }
}

pub fn emitted() -> [u32; 2] {
    EMITTED
        .each_ref()
        .map(|counter| counter.load(Ordering::Relaxed))
}

pub fn taken() -> [u32; 2] {
    DRAINED
        .each_ref()
        .map(|counter| counter.load(Ordering::Relaxed))
}

static EDITS: AtomicU32 = AtomicU32::new(0);
static EDITS_TAKEN: AtomicU32 = AtomicU32::new(0);

pub fn will_edit_text() {
    count_input();
    EDITS.fetch_add(1, Ordering::Relaxed);
}

pub fn edits() -> u32 {
    EDITS.load(Ordering::Relaxed)
}

pub fn edits_taken() -> u32 {
    EDITS_TAKEN.load(Ordering::Relaxed)
}

pub fn has_events() -> bool {
    !EVENTS.lock().is_empty()
}

pub fn has_events_but_frames() -> bool {
    EVENTS.lock().iter().any(|event| event.kind != Kind::Frame)
}

/// Writes records of `[kind, length, ...fields]`, and returns how many numbers that is.
pub fn drain_numbers(buffer: &mut [f64]) -> usize {
    let (mut events, mut taken, mut length) = (EVENTS.lock(), TAKEN.lock(), 0);
    if events.len() == 1 && events[0].kind == Kind::Frame {
        host::thread::hold_jobs();
    }
    while let Some(event) = events.pop_front_if(|_| length + 2 + MAX_FIELDS <= buffer.len()) {
        let fields = if event.kind == Kind::Json {
            &[taken.len() as f64]
        } else {
            &event.fields[..]
        };
        buffer[length..length + 2]
            .copy_from_slice(&[f64::from(event.kind as u8), (2 + fields.len()) as f64]);
        buffer[length + 2..length + 2 + fields.len()].copy_from_slice(fields);
        length += 2 + fields.len();
        let is_edit = || {
            matches!(
                event.json["t"].as_str(),
                Some("text" | "compose" | "composeEnd")
            )
        };
        if event.kind == Kind::Text || event.kind == Kind::Json && is_edit() {
            EDITS_TAKEN.fetch_add(1, Ordering::Relaxed);
        }
        crate::diagnostics::trace!(
            "JavaScript takes event {} {}",
            event.kind as u8,
            event.json["t"]
        );
        count(event.kind, &DRAINED);
        if event.kind == Kind::Json {
            taken.push(event.json);
        }
    }
    length
}

pub fn drain_json() -> Vec<u8> {
    json!(std::mem::take(&mut *TAKEN.lock()))
        .to_string()
        .into_bytes()
}

pub fn clear() {
    EVENTS
        .lock()
        .drain(..)
        .for_each(|event| count(event.kind, &DRAINED));
    EDITS_TAKEN.store(edits(), Ordering::Relaxed);
    TAKEN.lock().clear();
    NAMES.lock().clear();
}

static CHANGES: [AtomicU32; 2] = [const { AtomicU32::new(0) }; 2];

/// How often a window was moved or resized, and how often anything else may have changed.
pub fn changes() -> [u32; 2] {
    CHANGES
        .each_ref()
        .map(|counter| counter.load(Ordering::Relaxed))
}

pub fn expect_changes() {
    CHANGES[1].fetch_add(1, Ordering::Relaxed);
}

fn push(event: Queued, is_same: impl Fn(&Queued) -> bool) {
    if matches!(event.kind, Kind::Json | Kind::Resize) {
        CHANGES[usize::from(event.kind == Kind::Json && event.json["e"] != "bounds")]
            .fetch_add(1, Ordering::Relaxed);
    }
    let mut events = EVENTS.lock();
    if event.is_replaceable {
        // Stops at the first event that may not be reordered with this one.
        let mut tail = events
            .iter_mut()
            .rev()
            .take_while(|queued| queued.is_replaceable);
        if let Some(queued) = tail.find(|queued| queued.kind == event.kind && is_same(queued)) {
            *queued = event;
            return;
        }
    }
    count(event.kind, &EMITTED);
    events.push_back(event);
    let was_empty = events.len() == 1;
    drop(events);
    if was_empty {
        host::wake();
    }
}

pub fn emit(json: Value) {
    crate::diagnostics::log!("-> {:.200}", json.to_string());
    push(
        Queued {
            kind: Kind::Json,
            fields: SmallVec::new(),
            json,
            is_replaceable: false,
        },
        |_| false,
    );
}

/// Replaces an event of the same type and target that JavaScript has not taken yet.
pub fn emit_latest(json: Value) {
    crate::diagnostics::log!("-> {:.200}", json.to_string());
    let target = ["t", "s", "w", "e"].map(|key| (key, json[key].clone()));
    let event = Queued {
        kind: Kind::Json,
        fields: SmallVec::new(),
        json,
        is_replaceable: true,
    };
    push(event, |queued| {
        target
            .iter()
            .all(|(key, value)| queued.json[*key] == *value)
    });
}

static INPUTS: AtomicU32 = AtomicU32::new(0);

#[cfg(target_os = "macos")]
thread_local! {
    static LAST_INPUT: std::cell::Cell<std::time::Instant> = std::cell::Cell::new(std::time::Instant::now());
}

fn count_input() {
    INPUTS.fetch_add(1, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    LAST_INPUT.set(std::time::Instant::now());
}

#[cfg(target_os = "macos")]
pub fn last_input() -> std::time::Instant {
    LAST_INPUT.get()
}

/// How many events there were whose result the user is waiting for.
pub fn inputs() -> u32 {
    INPUTS.load(Ordering::Relaxed)
}

/// The first field is the surface.
pub fn emit_numbers(kind: Kind, fields: &[f64], is_replaceable: bool) {
    if diagnostics::logs_frames() || kind == Kind::Resize {
        crate::diagnostics::log!("-> {kind:?} {fields:?}");
    }
    if matches!(kind, Kind::Key | Kind::Text | Kind::Resize)
        || kind == Kind::Mouse && !is_replaceable
    {
        count_input();
    }
    let event = Queued {
        kind,
        fields: fields.iter().copied().collect(),
        json: Value::Null,
        is_replaceable,
    };
    let target = if kind == Kind::Scroll { 2 } else { 1 };
    push(event, |queued| queued.fields[..target] == fields[..target]);
}

/// A string as a field: minus its only code point, or an index into the names that were sent.
pub fn name(text: &str) -> f64 {
    let mut characters = text.chars();
    if let (Some(character @ '\u{1}'..), None) = (characters.next(), characters.next()) {
        return -f64::from(character as u32);
    }
    let mut names = NAMES.lock();
    let index = names
        .iter()
        .position(|name| name == text)
        .unwrap_or_else(|| {
            names.push(text.to_owned());
            emit(json!({ "t": "name", "text": text }));
            names.len() - 1
        });
    index as f64
}

pub fn report(result: Result<()>) {
    if let Err(error) = result {
        emit(json!({ "t": "error", "message": format!("{error:#}") }));
    }
}

pub fn reply(id: u64, result: Result<Value>) {
    emit(match result {
        Ok(value) => json!({ "t": "reply", "id": id, "value": value }),
        Err(error) => json!({ "t": "reply", "id": id, "error": format!("{error:#}") }),
    });
}

pub fn panic_message(panic: Box<dyn Any + Send>) -> String {
    let message = panic.downcast_ref::<String>().map(String::as_str);
    let message = message.or_else(|| panic.downcast_ref::<&str>().copied());
    format!(
        "the UI library panicked: {}",
        message.unwrap_or("no message")
    )
}

type Job = Box<dyn FnOnce() + Send>;

struct Pool {
    jobs: Vec<Job>,
    threads: usize,
}

static POOL: Mutex<Pool> = Mutex::new(Pool {
    jobs: Vec::new(),
    threads: 0,
});

fn next_job() -> Option<Job> {
    let mut pool = POOL.lock();
    if pool.jobs.is_empty() {
        pool.threads -= 1;
        return None;
    }
    Some(pool.jobs.remove(0))
}

/// Works without a display.
pub fn in_background(id: u64, work: impl FnOnce() -> Result<Value> + Send + 'static) {
    spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(work));
        reply(
            id,
            result.unwrap_or_else(|panic| Err(failure!("{}", panic_message(panic)))),
        );
    });
}

/// `job` does not panic.
pub fn spawn(job: impl FnOnce() + Send + 'static) {
    const MAX_THREADS: usize = 4;
    let mut pool = POOL.lock();
    pool.jobs.push(Box::new(job));
    if pool.threads == MAX_THREADS {
        return;
    }
    pool.threads += 1;
    drop(pool);
    let run = || std::iter::from_fn(next_job).for_each(|job| job());
    if std::thread::Builder::new()
        .name("bun:desktop".into())
        .spawn(run)
        .is_err()
    {
        run();
    }
}

pub fn put_blob(bytes: Vec<u8>) -> u32 {
    let id = NEXT_BLOB.fetch_add(1, Ordering::Relaxed);
    BLOBS.lock().get_or_insert_default().insert(id, bytes);
    id
}

pub fn take_blob(id: u32) -> Option<Vec<u8>> {
    BLOBS.lock().as_mut()?.remove(&id)
}

pub fn blob(id: &Value) -> Result<Vec<u8>> {
    id.as_u64()
        .and_then(|id| take_blob(id as u32))
        .context("the bytes are missing")
}
