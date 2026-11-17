//! Work for the thread pool that is done in the order in which it comes, one at a time.

use std::collections::VecDeque;
use std::sync::Arc;

use bun_threading::Guarded;

use crate::exec::{Receiver, blocking, oneshot};

#[derive(Default)]
struct Queue {
    jobs: VecDeque<Box<dyn FnOnce() + Send>>,
    has_thread: bool,
}

#[derive(Default)]
pub struct Serial {
    queue: Guarded<Queue>,
    working: Guarded<()>,
}

impl Serial {
    /// It is done whether or not somebody waits.
    pub fn run<T: Send + 'static>(
        self: &Arc<Self>,
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Receiver<T> {
        let (sender, receiver) = oneshot();
        let has_thread = {
            let mut queue = self.queue.lock();
            queue.jobs.push_back(Box::new(move || sender.send(work())));
            core::mem::replace(&mut queue.has_thread, true)
        };
        if !has_thread {
            let this = Arc::clone(self);
            drop(blocking(move || this.finish()));
        }
        receiver
    }

    /// Returns when nothing is left to do.
    pub fn finish(&self) {
        loop {
            let _working = self.working.lock();
            let next = {
                let mut queue = self.queue.lock();
                queue.has_thread &= !queue.jobs.is_empty();
                queue.jobs.pop_front()
            };
            let Some(job) = next else { return };
            job();
        }
    }
}
