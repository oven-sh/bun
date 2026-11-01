//! `async`/`.await` on Bun's own event loops.
//!
//! This is not a runtime. It has no reactor, no threads, no timers and no run
//! queue: the loops Bun already has (`jsc::EventLoop`, `MiniEventLoop`) keep
//! doing all of that. It is the glue `core::future` asks an executor for:
//!
//! - [`task`]: a boxed future whose `Waker` puts it in its loop's task queue.
//!   A loop takes part by implementing [`Schedule`].
//! - [`Slot`]: turns a callback on the loop's thread into something to await.
//! - [`blocking`]: awaits a closure run on the work pool.
//!
//! `bun_jsc::future` is the JS loop's side: spawning, promises, cancellation
//! with the script execution context.

mod blocking;
mod race;
mod slot;
pub mod task;

pub use blocking::{Blocking, InFlight, blocking};
pub use race::{Either, Race, race};
pub use slot::Slot;
pub use task::{Runnable, Schedule, spawn};

#[cfg(test)]
mod tests;
