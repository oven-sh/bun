//! Diagnostic build only: do not merge.
//!
//! Tracks every live `BundleV2` and the parse tasks it scheduled in a table on
//! the global heap, so the checks below never read bundle or arena memory. A
//! violation aborts through `Output::panic` with the task path and the source
//! location that scheduled it.

use core::panic::Location;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;

struct TaskInfo {
    path: Box<[u8]>,
    site: &'static Location<'static>,
    completed: bool,
}

struct BundleInfo {
    tasks: HashMap<u64, TaskInfo>,
}

struct State {
    live: HashMap<u64, BundleInfo>,
    /// Ids of the last torn down bundles, to tell "dead" from "never existed".
    dead: Vec<u64>,
}

static NEXT_BUNDLE: AtomicU64 = AtomicU64::new(1);
static NEXT_TASK: AtomicU64 = AtomicU64::new(1);
static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.get_or_insert_with(|| State {
        live: HashMap::new(),
        dead: Vec::new(),
    });
    f(state)
}

fn describe_dead(state: &State, bundle: u64) -> &'static str {
    if state.dead.contains(&bundle) {
        "torn down"
    } else {
        "unknown (garbage id: the task memory was reused)"
    }
}

pub(crate) fn bundle_created() -> u64 {
    let id = NEXT_BUNDLE.fetch_add(1, Ordering::Relaxed);
    with_state(|s| {
        s.live.insert(
            id,
            BundleInfo {
                tasks: HashMap::new(),
            },
        );
    });
    id
}

/// Main thread, before the task is handed to the pool. Returns the task id.
pub(crate) fn task_scheduled(bundle: u64, path: &[u8], site: &'static Location<'static>) -> u64 {
    let task = NEXT_TASK.fetch_add(1, Ordering::Relaxed);
    let dead = with_state(|s| match s.live.get_mut(&bundle) {
        Some(info) => {
            info.tasks.insert(
                task,
                TaskInfo {
                    path: Box::from(path),
                    site,
                    completed: false,
                },
            );
            None
        }
        None => Some(describe_dead(s, bundle)),
    });
    if let Some(why) = dead {
        bun_core::Output::panic(format_args!(
            "TRIPWIRE: parse task for {:?} scheduled at {} on bundle #{} which is {}",
            bstr::BStr::new(path),
            site,
            bundle,
            why,
        ));
    }
    task
}

/// Pool thread, first statement of the task callback, before `ctx` is read.
pub(crate) fn task_running(bundle: u64, task: u64) {
    if bundle == 0 {
        return;
    }
    let problem = with_state(|s| match s.live.get(&bundle) {
        Some(info) => match info.tasks.get(&task) {
            Some(t) if t.completed => Some(format!(
                "parse task #{} for {:?} (scheduled at {}) runs again after its completion was processed, bundle #{}",
                task,
                bstr::BStr::new(&t.path),
                t.site,
                bundle
            )),
            Some(_) => None,
            None => Some(format!(
                "parse task #{} is not known to live bundle #{}",
                task, bundle
            )),
        },
        None => Some(format!(
            "parse task #{} starts on a pool thread but its bundle #{} is {}",
            task,
            bundle,
            describe_dead(s, bundle)
        )),
    });
    if let Some(problem) = problem {
        bun_core::Output::panic(format_args!("TRIPWIRE: {}", problem));
    }
}

/// Main thread, first statement of the completion, before `ctx` is read.
pub(crate) fn task_completed(bundle: u64, task: u64) {
    if bundle == 0 {
        return;
    }
    let problem = with_state(|s| match s.live.get_mut(&bundle) {
        Some(info) => match info.tasks.get_mut(&task) {
            Some(t) if t.completed => Some(format!(
                "second completion for parse task #{} for {:?} (scheduled at {}), bundle #{}",
                task,
                bstr::BStr::new(&t.path),
                t.site,
                bundle
            )),
            Some(t) => {
                t.completed = true;
                None
            }
            None => Some(format!(
                "completion for parse task #{} which live bundle #{} never scheduled",
                task, bundle
            )),
        },
        None => Some(format!(
            "completion for parse task #{} delivered after its bundle #{} was {}",
            task,
            bundle,
            describe_dead(s, bundle)
        )),
    });
    if let Some(problem) = problem {
        bun_core::Output::panic(format_args!("TRIPWIRE: {}", problem));
    }
}

/// Main thread, first statement of the bundle teardown.
pub(crate) fn bundle_teardown(bundle: u64, pending_items: u32) {
    let problem = with_state(|s| {
        let Some(info) = s.live.remove(&bundle) else {
            return Some(format!(
                "teardown of bundle #{} which is {}",
                bundle,
                describe_dead(s, bundle)
            ));
        };
        if s.dead.len() >= 256 {
            s.dead.remove(0);
        }
        s.dead.push(bundle);
        let outstanding: Vec<String> = info
            .tasks
            .values()
            .filter(|t| !t.completed)
            .map(|t| format!("{:?} scheduled at {}", bstr::BStr::new(&t.path), t.site))
            .collect();
        if outstanding.is_empty() && pending_items == 0 {
            return None;
        }
        Some(format!(
            "bundle #{} torn down with pending_items = {}, {} of {} parse tasks without a processed completion: [{}]",
            bundle,
            pending_items,
            outstanding.len(),
            info.tasks.len(),
            outstanding.join("; ")
        ))
    });
    if let Some(problem) = problem {
        bun_core::Output::panic(format_args!("TRIPWIRE: {}", problem));
    }
}
