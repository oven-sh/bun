//! The I/O completion port that a Windows event loop waits on. The [`Port`] owns all memory that the kernel may still write to, so a request can be dropped at any time.

#![cfg(windows)]

mod afd;
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
mod wake_event;

pub use afd::{Readiness, ReadinessHandler, SocketRegistration};
pub use port::{Event, LoopRef, PendingClose, PendingWrite, Port, Waker, WriteProgress};
pub use read_to_end::read_to_end;
pub use request::{Completer, Completion, Handle, OverlappedFile, Request};
