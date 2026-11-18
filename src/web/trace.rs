//! What pages put on their performance timelines while the app records a trace.

use core::sync::atomic::{AtomicUsize, Ordering};

use bun_threading::Guarded;
pub use bun_threading::current_thread_id as this_thread;

pub struct Event {
    pub kind: &'static str,
    pub name: String,
    /// In milliseconds since the epoch.
    pub start: f64,
    pub duration: f64,
    pub thread: u64,
}

static ROOM: AtomicUsize = AtomicUsize::new(0);
static EVENTS: Guarded<Vec<Event>> = Guarded::new(Vec::new());

#[inline]
pub fn is_on() -> bool {
    ROOM.load(Ordering::Relaxed) != 0
}

#[cold]
pub fn add(kind: &'static str, name: String, start: f64, duration: f64) {
    let mut events = EVENTS.lock();
    if events.len() < ROOM.load(Ordering::Relaxed) {
        let thread = this_thread();
        events.push(Event {
            kind,
            name,
            start,
            duration,
            thread,
        });
    }
}

pub fn count() -> usize {
    EVENTS.lock().len()
}

/// Returns what has been recorded so far.
pub fn restart(room: usize) -> Vec<Event> {
    let mut events = EVENTS.lock();
    ROOM.store(room, Ordering::Relaxed);
    core::mem::take(&mut events)
}
