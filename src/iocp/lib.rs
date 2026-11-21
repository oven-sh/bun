//! What a Windows event loop waits on. The [`Port`] owns every byte that the system may still write, so whoever started a request can be dropped at any time.

#![cfg(windows)]

mod afd;
mod bell;
pub mod blocking;
#[cfg(test)]
mod faults;
mod notifier;
mod port;
mod read_to_end;
mod request;
mod slab;
mod sys;
#[cfg(test)]
mod tests;
mod timer;

pub use afd::{Readiness, SocketWatch, Watcher};
pub use port::{Event, Hold, PendingWrite, Port, Waker};
pub use read_to_end::read_to_end;
pub use request::{AsyncFile, Completion, Handle, MAX_LEN, Remote, Request};
