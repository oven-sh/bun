//! Passes values between threads. Unlike those of `std`, it copes with memory that is refused.

use std::collections::VecDeque;

use bun_threading::{Condition, Guarded};
use bun_zstd_decoder::{Error, Result};

use crate::vec::{self, Shared};

struct Channel<T> {
    state: Guarded<State<T>>,
    changed: Condition,
}

struct State<T> {
    /// Has room for another one.
    items: VecDeque<T>,
    is_closed: bool,
}

/// Closes the channel when it is dropped.
pub(crate) struct Sender<T>(Shared<Channel<T>>);

pub(crate) struct Receiver<T>(Shared<Channel<T>>);

pub(crate) fn new<T>() -> Result<(Sender<T>, Receiver<T>)> {
    let mut items = VecDeque::new();
    items.try_reserve(1)?;
    let is_closed = false;
    let channel = vec::shared(Channel {
        state: Guarded::new(State { items, is_closed }),
        changed: Condition::new(),
    })?;
    Ok((Sender(Shared::clone(&channel)), Receiver(channel)))
}

impl<T> Sender<T> {
    pub(crate) fn send(&self, item: T) -> Result<()> {
        let mut state = self.0.state.lock();
        state.items.try_reserve(2)?;
        state.items.push_back(item);
        drop(state);
        self.0.changed.signal();
        Ok(())
    }

    pub(crate) fn send_last(self, item: T) {
        self.0.state.lock().items.push_back(item);
    }
}

impl<T> Drop for Sender<T> {
    fn drop(&mut self) {
        self.0.state.lock().is_closed = true;
        self.0.changed.broadcast();
    }
}

impl<T> Receiver<T> {
    pub(crate) fn share(&self) -> Self {
        Self(Shared::clone(&self.0))
    }

    /// `None` if there is nothing yet, unless it `waits`. An error if nothing is going to come.
    pub(crate) fn receive(&self, waits: bool) -> Result<Option<T>> {
        let mut state = self.0.state.lock();
        loop {
            match state.items.pop_front() {
                None if state.is_closed => return Err(Error::Internal),
                None if waits => self.0.changed.wait_guarded(&mut state),
                item => return Ok(item),
            }
        }
    }

    pub(crate) fn wait(&self) -> Result<T> {
        self.receive(true)?.ok_or(Error::Internal)
    }
}
