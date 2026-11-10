//! Failed registry requests wait here. One helper thread wakes the install loop at the deadline.

use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use bun_core::{MutableString, Output, strings};
use bun_http::{AsyncHTTP, HTTPClientResult, HTTPResponseMetadata};
use bun_threading::{Condition, Guarded};

use crate::package_manager_real::run_tasks::download_outcome;
use crate::package_manager_real::{self, enqueue, package_manager_options::LogLevel};
use crate::{NetworkTask, PackageManager};

/// Only used on the install thread. Its tasks aren't counted in `pending_tasks`, so
/// `pending_task_count` adds `len()`.
#[derive(Default)]
pub(crate) struct RetryQueue {
    waiting: Vec<(Instant, *mut NetworkTask)>,
    /// True once "registry requests failed, retrying" has been printed. It's printed at most once
    /// per install, after a timeout.
    announced: bool,
    /// The highest attempt for which a wait that the registry asked for was announced, since the
    /// queue was last empty.
    announced_asked: u16,
}

impl RetryQueue {
    pub(crate) fn len(&self) -> usize {
        self.waiting.len()
    }

    pub(crate) fn pop_due(&mut self) -> Option<*mut NetworkTask> {
        if self.waiting.is_empty() {
            return None;
        }
        let now = Instant::now();
        let index = self.waiting.iter().position(|(due, _)| *due <= now)?;
        Some(self.waiting.swap_remove(index).1)
    }
}

/// Returns the wait. `attempt` is 1 for the first retry.
pub(crate) fn retry(
    manager: &mut PackageManager,
    task: *mut NetworkTask,
    attempt: u16,
    response: &HTTPClientResult<'static>,
) -> Duration {
    let (wait, asked) = wait_before(manager, attempt, response);
    if wait.is_zero() {
        enqueue::enqueue_network_task(manager, task);
        return Duration::ZERO;
    }
    // A host that never answers costs minutes per attempt, so that is said at the first retry, also
    // with `--verbose`, whose lines are only printed once everything is resolved.
    let timed_out = matches!(response.fail, Some(bun_http::Error::Timeout));
    // `--verbose` prints a line for every retry of every request.
    let (queue, log_level) = (&mut manager.retry_queue, manager.options.log_level);
    // The requests of a later wave start at the first attempt again.
    if queue.len() == 0 {
        queue.announced_asked = 0;
    }
    let line = if asked && attempt > queue.announced_asked {
        queue.announced_asked = attempt;
        Some(format!(
            "registry asked to wait {}s before retrying",
            wait.as_secs()
        ))
    } else if !asked && !queue.announced && timed_out {
        queue.announced = true;
        Some("registry requests failed, retrying".to_owned())
    } else {
        None
    };
    if let Some(line) = line.filter(|_| log_level != LogLevel::Silent) {
        Output::flush();
        manager.progress.log(format_args!("warn: {line}\n"));
    }

    let due = Instant::now() + wait;
    if !wake_at(due) {
        enqueue::enqueue_network_task(manager, task);
        return Duration::ZERO;
    }
    manager.retry_queue.waiting.push((due, task));
    wait
}

impl PackageManager {
    /// Sends a request and waits for the answer, retrying as often and as slowly as `bun install`
    /// does. A request that timed out is not retried, because the user has waited long enough.
    /// Do not use this for a request that the registry must not get twice, like `bun publish`'s.
    pub fn send_with_retries(
        &self,
        request: &mut AsyncHTTP<'_>,
        response_buffer: &mut MutableString,
    ) -> bun_http::Result<HTTPResponseMetadata> {
        let mut attempt: u16 = 0;
        loop {
            response_buffer.reset();
            let response = request.send_sync_for_result(response_buffer)?;
            let (_, retry) = download_outcome(&response, true);
            if !retry || attempt >= self.options.max_retry_count {
                return response.into_metadata();
            }
            attempt += 1;
            let (wait, asked) = wait_before(self, attempt, &response);
            if self.options.log_level != LogLevel::Silent {
                if asked {
                    bun_core::warn!("registry asked to wait {}s before retrying", wait.as_secs(),);
                } else if self.options.log_level.is_verbose() {
                    bun_core::warn!(
                        "registry request failed, retry {}/{} in {}ms",
                        attempt,
                        self.options.max_retry_count,
                        wait.as_millis(),
                    );
                }
            }
            std::thread::sleep(wait);
        }
    }
}

/// Returns how long to wait before retry number `attempt`, and whether the registry asked for that
/// wait. Zero means the retry starts immediately.
fn wait_before(
    manager: &PackageManager,
    attempt: u16,
    response: &HTTPClientResult<'static>,
) -> (Duration, bool) {
    let base_ms = manager
        .env()
        .get(b"BUN_CONFIG_HTTP_RETRY_BACKOFF")
        .and_then(|ms| bun_core::parse_unsigned::<u32>(ms, 10).ok())
        .unwrap_or(50);
    // Under auto-install the JS thread is blocked on this request.
    if base_ms == 0 || manager.options.runtime_auto_install {
        return (Duration::ZERO, false);
    }
    let wait = backoff(base_ms, attempt);
    match retry_after(response).filter(|asked| *asked > wait) {
        Some(asked) => (asked, true),
        None => (wait, false),
    }
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

/// Returns false if the thread couldn't be started, because nothing would end the wait then.
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
