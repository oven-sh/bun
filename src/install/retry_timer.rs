//! Failed registry requests wait here. One helper thread wakes the install loop at the deadline.

use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use bun_core::{Output, strings};
use bun_http::HTTPClientResult;
use bun_threading::{Condition, Guarded};

use crate::package_manager_real::{self, enqueue, package_manager_options::LogLevel};
use crate::{NetworkTask, PackageManager};

/// Install thread only. Its tasks are not in `pending_tasks`: `pending_task_count` adds `len()`.
#[derive(Default)]
pub(crate) struct RetryQueue(Vec<(Instant, *mut NetworkTask)>);

impl RetryQueue {
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }

    pub(crate) fn pop_due(&mut self) -> Option<*mut NetworkTask> {
        if self.0.is_empty() {
            return None;
        }
        let now = Instant::now();
        let index = self.0.iter().position(|(due, _)| *due <= now)?;
        Some(self.0.swap_remove(index).1)
    }
}

/// Returns the wait. `attempt` is 1 for the first retry.
pub(crate) fn retry(
    manager: &mut PackageManager,
    task: *mut NetworkTask,
    attempt: u16,
    response: &HTTPClientResult<'static>,
) -> Duration {
    let base_ms = manager
        .env()
        .get(b"BUN_CONFIG_HTTP_RETRY_BACKOFF")
        .and_then(|ms| bun_core::parse_unsigned::<u32>(ms, 10).ok())
        .unwrap_or(250);
    // Under auto-install the JS thread is blocked on this request.
    if base_ms == 0 || manager.options.runtime_auto_install {
        enqueue::enqueue_network_task(manager, task);
        return Duration::ZERO;
    }

    let mut wait = backoff(base_ms, attempt);
    if let Some(asked) = retry_after(response).filter(|asked| *asked > wait) {
        wait = asked;
        // Rate limits hit many requests at once: one line per wave.
        if manager.retry_queue.len() == 0 && manager.options.log_level != LogLevel::Silent {
            Output::flush();
            manager.progress.log(format_args!(
                "warn: the registry asked to wait {}s before the next attempt\n",
                asked.as_secs(),
            ));
        }
    }

    let due = Instant::now() + wait;
    if !wake_at(due) {
        enqueue::enqueue_network_task(manager, task);
        return Duration::ZERO;
    }
    manager.retry_queue.0.push((due, task));
    wait
}

/// +-20%, so that a fleet of installs does not retry in step.
fn backoff(base_ms: u32, attempt: u16) -> Duration {
    let base = u64::from(base_ms);
    let ms = (base << attempt.saturating_sub(1).min(6)).min(base * 40);
    let jitter = ms / 5;
    Duration::from_millis(ms - jitter + bun_core::fast_random() % (2 * jitter + 1))
}

/// `Retry-After: <seconds>`, at most a minute. The HTTP-date form is ignored.
fn retry_after(response: &HTTPClientResult<'static>) -> Option<Duration> {
    let value = response.metadata.as_ref()?.header(b"retry-after")?;
    let secs = bun_core::parse_unsigned::<u64>(strings::trim(value, b" \t"), 10).ok()?;
    Some(Duration::from_secs(secs.min(60)))
}

struct Timer {
    deadlines: Vec<Instant>,
    /// Kept so that LSAN can reach the thread's `Arc` (see `HTTP_THREAD_HANDLE`).
    thread: Option<JoinHandle<()>>,
}

static TIMER: Guarded<Timer> = Guarded::new(Timer {
    deadlines: Vec::new(),
    thread: None,
});
static CHANGED: Condition = Condition::new();

/// False when the thread could not be started: nothing would end the wait.
fn wake_at(deadline: Instant) -> bool {
    let mut timer = TIMER.lock();
    if timer.thread.is_none() {
        timer.thread = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(run)
            .ok();
        if timer.thread.is_none() {
            return false;
        }
    }
    timer.deadlines.push(deadline);
    drop(timer);
    CHANGED.signal();
    true
}

fn run() {
    let mut timer = TIMER.lock();
    loop {
        let now = Instant::now();
        let waiting = timer.deadlines.len();
        timer.deadlines.retain(|deadline| *deadline > now);
        if timer.deadlines.len() < waiting {
            // SAFETY: the singleton that queued the deadline is never freed.
            unsafe { PackageManager::wake_raw(package_manager_real::get()) };
        }
        match timer.deadlines.iter().min().copied() {
            Some(next) => {
                let ns = u64::try_from((next - now).as_nanos()).unwrap_or(u64::MAX);
                let _ = CHANGED.timed_wait_guarded(&mut timer, ns);
            }
            None => CHANGED.wait_guarded(&mut timer),
        }
    }
}
