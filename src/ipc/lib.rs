//! The protocol of `process.send()` and `Bun.spawn({ ipc })`, without I/O and without JavaScript.
#![cfg_attr(not(test), forbid(unsafe_code))]

mod inbox;
mod link;
mod outbox;
mod wire;

#[cfg(test)]
mod tests;

pub use inbox::Inbox;
pub use link::{Due, Event, Link};
pub use outbox::{Answer, Idle, Offer, Outbox, Unacked, Write, WriteReason, Wrote};
pub use wire::{
    Audience, Body, Frame, FrameError, Kind, Mode, Packet, Reply, ReplyPacket, encode_advanced,
    encode_json,
};
