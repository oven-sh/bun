//! Failed registry requests wait here. One helper thread wakes the install loop at the deadline.

use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use bun_core::{MutableString, Output, strings};
use bun_http::{AsyncHTTP, HTTPClientResult, HTTPResponseMetadata};
use bun_threading::{Condition, Guarded};

use crate::package_manager_real::run_tasks::download_outcome;
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

/// A wait of this length or more is announced. The default backoff gets this long at the third retry.
const ANNOUNCED_WAIT: Duration = Duration::from_millis(750);

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
    // An outage hits many requests at once, so a wait is announced once per wave. `--verbose` has a
    // line for each request.
    if manager.retry_queue.len() == 0 && manager.options.log_level != LogLevel::Silent {
        if asked {
            Output::flush();
            manager.progress.log(format_args!(
                "warn: the registry asked to wait {}s before the next attempt\n",
                wait.as_secs(),
            ));
        } else if wait >= ANNOUNCED_WAIT && !manager.options.log_level.is_verbose() {
            Output::flush();
            manager.progress.log(format_args!(
                "warn: a request to the registry failed. Retry {}/{} in {}ms...\n",
                attempt,
                manager.options.max_retry_count,
                wait.as_millis(),
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
                    bun_core::warn!(
                        "the registry asked to wait {}s before the next attempt",
                        wait.as_secs(),
                    );
                } else if wait >= ANNOUNCED_WAIT {
                    bun_core::warn!(
                        "the request to the registry failed. Retry {}/{} in {}ms...",
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

/// Returns how long to wait before retry number `attempt`, and whether the registry asked for
/// that wait. Zero means that the retry starts at once.
fn wait_before(
    manager: &PackageManager,
    attempt: u16,
    response: &HTTPClientResult<'static>,
) -> (Duration, bool) {
    let base_ms = manager
        .env()
        .get(b"BUN_CONFIG_HTTP_RETRY_BACKOFF")
        .and_then(|ms| bun_core::parse_unsigned::<u32>(ms, 10).ok())
        .unwrap_or(250);
    // Under auto-install the JS thread is blocked on this request.
    if base_ms == 0 || manager.options.runtime_auto_install {
        return (Duration::ZERO, false);
    }
    // A busy server needs time, so waiting helps. Nothing listening at the address, or a name that
    // does not resolve, mostly means being offline, and then the install should fail right away.
    if matches!(
        response.fail,
        Some(
            bun_http::Error::ConnectionRefused
                | bun_http::Error::DNSResolveFailed
                | bun_http::Error::FailedToOpenSocket
        )
    ) {
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
