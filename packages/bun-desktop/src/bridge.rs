//! What waits for JavaScript to take it. Any thread may add to it.

use std::any::Any;
use std::collections::VecDeque;
use std::mem::{MaybeUninit, discriminant};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::error::{Result, failure};
use crate::protocol::{
    DragPhase, Event, Input, Lane, Message, MouseAction, Reply, SystemEvent, TouchPhase,
    WindowEvent,
};
use crate::remote::{guest, pages};
use crate::sync::Mutex;
use crate::{diagnostics, host};

static EVENTS: Mutex<VecDeque<Event>> = Mutex::new(VecDeque::new());

/// How many `Frame`, `Resize` and `Bounds` events were queued, and how many of them JavaScript took.
static EMITTED: [AtomicU32; 3] = [const { AtomicU32::new(0) }; 3];
static DRAINED: [AtomicU32; 3] = [const { AtomicU32::new(0) }; 3];

fn count(event: &Event, counters: &[AtomicU32; 3]) {
    match event {
        Event::Surface {
            input: Input::Frame { .. },
            ..
        } => counters[0].fetch_add(1, Ordering::Relaxed),
        Event::Surface {
            input: Input::Resize { .. },
            ..
        } => counters[1].fetch_add(1, Ordering::Relaxed),
        Event::Window {
            event: WindowEvent::Bounds(_),
            ..
        } => counters[2].fetch_add(1, Ordering::Relaxed),
        _ => 0,
    };
}

pub fn emitted() -> [u32; 3] {
    EMITTED
        .each_ref()
        .map(|counter| counter.load(Ordering::Relaxed))
}

pub fn taken() -> [u32; 3] {
    DRAINED
        .each_ref()
        .map(|counter| counter.load(Ordering::Relaxed))
}

static EDITS: AtomicU32 = AtomicU32::new(0);
static EDITS_TAKEN: AtomicU32 = AtomicU32::new(0);

pub fn edits() -> u32 {
    EDITS.load(Ordering::Relaxed)
}

pub fn edits_taken() -> u32 {
    EDITS_TAKEN.load(Ordering::Relaxed)
}

fn is_edit(event: &Event) -> bool {
    matches!(
        event,
        Event::Surface {
            input: Input::Text { .. } | Input::Compose { .. } | Input::EndComposition,
            ..
        }
    )
}

fn is_frame(event: &Event) -> bool {
    matches!(
        event,
        Event::Surface {
            input: Input::Frame { .. },
            ..
        }
    )
}

pub fn has_events() -> bool {
    !EVENTS.lock().is_empty()
}

pub fn has_input() -> bool {
    !EVENTS.lock().iter().all(|it| {
        is_frame(it)
            || matches!(
                it,
                Event::Message {
                    message: Message {
                        lane: Lane::Scripts,
                        ..
                    },
                    ..
                } | Event::Disconnected { .. }
            )
    })
}

pub fn drain(buffer: &mut [MaybeUninit<Event>]) -> usize {
    let mut events = EVENTS.lock();
    if events.len() == 1 && is_frame(&events[0]) {
        if guest::is_on() {
            guest::hold()
        } else {
            host::thread::hold_jobs()
        }
    }
    let length = events.len().min(buffer.len());
    for (event, slot) in events.drain(..length).zip(buffer) {
        match &event {
            Event::Message { from: 0, message } => {
                EDITS_TAKEN.store(message.edits, Ordering::Relaxed)
            }
            event => drop(EDITS_TAKEN.fetch_add(is_edit(event).into(), Ordering::Relaxed)),
        }
        crate::diagnostics::trace!("JavaScript takes {:.60}", format!("{event:?}"));
        count(&event, &DRAINED);
        slot.write(event);
    }
    length
}

pub fn clear() {
    EVENTS
        .lock()
        .drain(..)
        .for_each(|event| count(&event, &DRAINED));
    EDITS_TAKEN.store(edits(), Ordering::Relaxed);
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

static INPUTS: AtomicU32 = AtomicU32::new(0);

/// How many events there were whose result the user is waiting for.
pub fn inputs() -> u32 {
    INPUTS.load(Ordering::Relaxed)
}

/// Only the last one matters.
fn is_replaceable(event: &Event) -> bool {
    match event {
        Event::Surface { input, .. } => match input {
            Input::Resize { .. }
            | Input::Drag {
                phase: DragPhase::Over,
                ..
            } => true,
            Input::Mouse(mouse) | Input::Pen { mouse, .. } => mouse.action == MouseAction::Move,
            Input::Touch { phase, .. } => *phase == TouchPhase::Move,
            Input::Scroll { has_ended, .. } => !has_ended,
            _ => false,
        },
        _ => matches!(
            event,
            Event::Window {
                event: WindowEvent::Bounds(_),
                ..
            } | Event::System(SystemEvent::Theme { .. })
        ),
    }
}

/// Of two that are replaceable.
fn replaces(new: &Event, old: &Event) -> bool {
    match (new, old) {
        (
            Event::Surface { id, input },
            Event::Surface {
                id: other,
                input: before,
            },
        ) if id == other => match (input, before) {
            (Input::Scroll { node, .. }, Input::Scroll { node: other, .. }) => node == other,
            (Input::Touch { finger, .. }, Input::Touch { finger: other, .. }) => finger == other,
            _ => discriminant(input) == discriminant(before),
        },
        (Event::Window { id, .. }, Event::Window { id: other, .. }) => id == other,
        (Event::System(_), Event::System(_)) => true,
        _ => false,
    }
}

pub fn emit(event: Event) {
    let (is_replaceable_now, mut is_frequent, mut is_awaited) =
        (is_replaceable(&event), false, is_edit(&event));
    if let Event::Message { .. } = &event {
        is_frequent = true;
    } else if let Event::Surface { input, .. } = &event {
        is_frequent = matches!(
            input,
            Input::Frame { .. }
                | Input::Mouse(_)
                | Input::Pen { .. }
                | Input::Touch { .. }
                | Input::Wheel(_)
                | Input::Pinch { .. }
                | Input::Scroll { .. }
                | Input::Key(_)
                | Input::Text { .. }
        );
        is_awaited |= matches!(input, Input::Key(_) | Input::Resize { .. })
            || matches!(
                input,
                Input::Mouse(_) | Input::Pen { .. } | Input::Touch { .. }
            ) && !is_replaceable_now;
    }
    if !is_frequent || diagnostics::logs_frames() {
        crate::diagnostics::log!("-> {:.200}", format!("{event:?}"));
    }
    if !is_frequent {
        let moves = matches!(
            event,
            Event::Surface {
                input: Input::Resize { .. },
                ..
            } | Event::Window {
                event: WindowEvent::Bounds(_),
                ..
            }
        );
        CHANGES[usize::from(!moves)].fetch_add(1, Ordering::Relaxed);
    }
    INPUTS.fetch_add(is_awaited.into(), Ordering::Relaxed);
    EDITS.fetch_add(is_edit(&event).into(), Ordering::Relaxed);
    let mut events = EVENTS.lock();
    if is_replaceable_now {
        // Stops at the first event that may not be reordered with this one.
        let mut tail = events
            .iter_mut()
            .rev()
            .take_while(|queued| is_replaceable(queued));
        if let Some(queued) = tail.find(|queued| replaces(&event, queued)) {
            *queued = event;
            return;
        }
    }
    count(&event, &EMITTED);
    events.push_back(event);
    let was_empty = events.len() == 1;
    drop(events);
    if was_empty {
        host::wake();
    }
}

pub fn emit_input(surface: u32, input: Input) {
    if !pages::exist() || !pages::tell(surface, &input) {
        emit(Event::Surface { id: surface, input });
    }
}

pub fn emit_system(event: SystemEvent) {
    emit(Event::System(event));
}

pub fn report(result: Result<()>) {
    if let Err(error) = result {
        emit(Event::Warning(format!("{error:#}").into()));
    }
}

pub fn reply(id: u32, result: Result<Reply>) {
    emit(Event::Reply {
        id,
        reply: result.unwrap_or_else(|error| Reply::Failed(format!("{error:#}").into())),
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
pub fn reply_later(id: u32, work: impl FnOnce() -> Result<Reply> + Send + 'static) {
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
    fn run() {
        std::iter::from_fn(next_job).for_each(|job| job());
    }
    let named = || {
        host::thread::set_name(c"bun:desktop");
        run();
    };
    if !host::thread::detach(2 << 20, named) {
        run();
    }
}
