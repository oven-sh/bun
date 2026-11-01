//! `async`/`.await` on Bun's own event loops. See `README.md`.
//!
//! This is not a runtime. It has no reactor, no threads, no timers and no run
//! queue: the loops Bun already has (`jsc::EventLoop`, `MiniEventLoop`) keep
//! doing all of that. It is what `core::future` asks an executor for:
//!
//! - [`Tasks`]: the futures of one loop, and the `Waker` that puts one back in
//!   that loop's queue. A loop takes part by implementing [`Schedule`].
//! - [`Slot`]: turns a callback on the loop's thread into something to await.

mod race;
mod slot;
mod task;

pub use race::{Either, Race, race};
pub use slot::Slot;
pub use task::{Refused, Schedule, TaskId, Tasks};

#[cfg(test)]
mod tests;
