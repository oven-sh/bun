//! The protocol of `process.send()` and `Bun.spawn({ ipc })`, without I/O and without JavaScript.
#![forbid(unsafe_code)]

mod inbox;
mod outbox;
mod phase;
mod wire;

pub use inbox::Inbox;
pub use outbox::{Offer, Outbox, Payload, Wrote};
pub use phase::{Event, Phase};
pub use wire::{Frame, FrameError, Kind, Mode, Reply, advanced_frame};
