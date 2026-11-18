//! https://w3c.github.io/web-locks/#algorithms

use std::sync::Arc;

use bun_threading::Guarded;

use crate::Bytes;
use crate::exec::{Receiver, Sender, oneshot};
use crate::remote::petition::{self, Handle};
use crate::storage::Shelf;

keywords! {
    pub enum LockMode {
        Shared = b"shared",
        Exclusive = b"exclusive",
    }
}

crate::wire! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Answer {
        Granted,
        Unavailable,
    }
}

crate::wire! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Priority {
        Waits,
        IfAvailable,
        Steals,
    }
}

crate::wire! {
    #[derive(Clone)]
    pub struct LockInfo {
        pub client: Bytes,
        pub name: Box<[u16]>,
        pub mode: LockMode,
    }
}

struct Lock {
    info: LockInfo,
    answer: Guarded<Option<Sender<Answer>>>,
    theft: Guarded<Option<Sender<()>>>,
}

fn tell<T>(sender: &Guarded<Option<Sender<T>>>, value: T) {
    if let Some(sender) = sender.lock().take() {
        sender.send(value);
    }
}

#[derive(Default)]
struct Queues {
    held: Vec<Arc<Lock>>,
    pending: Vec<Arc<Lock>>,
}

impl Queues {
    fn is_free(&self, wanted: &LockInfo) -> bool {
        self.held.iter().all(|it| {
            it.info.name != wanted.name
                || (it.info.mode == LockMode::Shared && wanted.mode == LockMode::Shared)
        })
    }

    fn grant(&mut self) {
        let mut at = 0;
        while let Some(lock) = self.pending.get(at) {
            if self.pending[..at]
                .iter()
                .any(|it| it.info.name == lock.info.name)
                || !self.is_free(&lock.info)
            {
                at += 1;
            } else {
                tell(&lock.answer, Answer::Granted);
                let granted = self.pending.remove(at);
                self.held.push(granted);
            }
        }
    }
}

/// Of one storage bucket.
#[derive(Clone)]
pub enum LockManager {
    Near(Arc<Near>),
    Far(Shelf),
}

#[derive(Default)]
pub struct Near(Guarded<Queues>);

/// Released, or no longer asked for, when it is dropped.
pub struct LockRequest(Request);

enum Request {
    Near { manager: Arc<Near>, lock: Arc<Lock> },
    Far { _lock: Handle, tickets: [u32; 2] },
}

impl Default for LockManager {
    fn default() -> LockManager {
        LockManager::Near(Arc::default())
    }
}

impl LockManager {
    /// With the answer, and the news that it has been stolen.
    pub fn request(
        &self,
        info: LockInfo,
        priority: Priority,
    ) -> (LockRequest, Receiver<Answer>, Receiver<()>) {
        let manager = match self {
            LockManager::Near(it) => it,
            LockManager::Far(shelf) => {
                let (answer, theft) = (petition::expect_answer(), petition::expect_theft());
                let (_lock, tickets) = (Handle::new(), [answer.0, theft.0]);
                petition::request_lock(
                    _lock.id(),
                    shelf.clone(),
                    info,
                    priority,
                    answer.0,
                    theft.0,
                );
                let request = Request::Far { _lock, tickets };
                return (LockRequest(request), answer.1, theft.1);
            }
        };
        let ((tell_answer, answer), (tell_theft, theft)) = (oneshot(), oneshot());
        let (lock, mut queues) = (
            Arc::new(Lock {
                info,
                answer: Guarded::new(Some(tell_answer)),
                theft: Guarded::new(Some(tell_theft)),
            }),
            manager.0.lock(),
        );
        let name = &lock.info.name;
        match priority {
            Priority::Steals => {
                queues
                    .held
                    .extract_if(.., |it| it.info.name == *name)
                    .for_each(|it| tell(&it.theft, ()));
                queues.pending.insert(0, Arc::clone(&lock));
            }
            Priority::IfAvailable
                if !queues.is_free(&lock.info)
                    || queues.pending.iter().any(|it| it.info.name == *name) =>
            {
                tell(&lock.answer, Answer::Unavailable);
            }
            _ => queues.pending.push(Arc::clone(&lock)),
        }
        queues.grant();
        let manager = Arc::clone(manager);
        (LockRequest(Request::Near { manager, lock }), answer, theft)
    }

    /// Those that are held, and those that are asked for.
    pub fn query(&self) -> [Vec<LockInfo>; 2] {
        let queues = match self {
            LockManager::Near(it) => it.0.lock(),
            LockManager::Far(shelf) => {
                return petition::query_locks(shelf.clone())
                    .map_or_else(Default::default, |it| it.0.into());
            }
        };
        [&queues.held, &queues.pending].map(|it| it.iter().map(|it| it.info.clone()).collect())
    }
}

impl Drop for LockRequest {
    fn drop(&mut self) {
        match &self.0 {
            Request::Near { manager, lock } => {
                let mut queues = manager.0.lock();
                queues.held.retain(|it| !Arc::ptr_eq(it, lock));
                queues.pending.retain(|it| !Arc::ptr_eq(it, lock));
                queues.grant();
            }
            Request::Far { tickets, .. } => _ = tickets.map(|it| petition::ruled(it, None)),
        }
    }
}
