//! Keeps time while the UI thread is busy.

use std::time::{Duration, Instant};

use crate::sync::{Condvar, Mutex};

const PATIENCE: Duration = Duration::from_millis(250);

type Job = Box<dyn FnOnce() + Send>;

/// With whether there is a thread for them.
static JOBS: Mutex<(Vec<(Instant, Job)>, bool)> = Mutex::new((Vec::new(), false));
static WAS_SET: Condvar = Condvar::new();

fn keep_time() {
    super::thread::set_name(c"alarm");
    super::thread::is_needed_for_frames();
    let mut jobs = JOBS.lock();
    loop {
        let now = Instant::now();
        jobs.0
            .extract_if(.., |it| it.0 <= now)
            .for_each(|it| (it.1)());
        let next = jobs.0.iter().map(|it| it.0).min();
        if WAS_SET
            .wait_until(&mut jobs, next.unwrap_or(now + PATIENCE))
            .timed_out()
            && jobs.0.is_empty()
        {
            jobs.1 = false;
            return;
        }
    }
}

pub fn set(time: Instant, job: impl FnOnce() + Send + 'static) {
    if time <= Instant::now() {
        return job();
    }
    let mut jobs = JOBS.lock();
    jobs.1 = jobs.1 || super::thread::detach(64 << 10, keep_time);
    if !jobs.1 {
        return job();
    }
    jobs.0.push((time, Box::new(job)));
    WAS_SET.notify_one();
}
