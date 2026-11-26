use super::assembler::Assembler;
use super::send_buffer::SendBuffer;
use crate::event::Context;
use crate::http3::{Message, Priority, StreamType};

bitflags::bitflags! {
    #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct Flags: u64 {
        const READ_DONE = 1 << 0;
        const WRITE_DONE = 1 << 1;
        const PAUSED = 1 << 2;
        const WANTS_WRITE = 1 << 3;
        /// The application has been told that the stream is closed, or does not know of it.
        const RELEASED = 1 << 4;

        /// The stream ends after the bytes that are written.
        const FIN = 1 << 5;
        /// And not lost.
        const FIN_SENT = 1 << 6;
        const FIN_ACKED = 1 << 7;
        const RESET = 1 << 8;
        /// Nothing is left to send or to be acknowledged.
        const SEND_DONE = 1 << 9;
        const STOPPED_BY_PEER = 1 << 10;
        const HAS_EARLY_DATA = 1 << 11;
        const HAS_PRIORITY_UPDATE = 1 << 12;

        const OWES_RESET_STREAM = 1 << 13;
        const OWES_STOP_SENDING = 1 << 14;
        const OWES_MAX_STREAM_DATA = 1 << 15;
        const OWES_STREAM_DATA_BLOCKED = 1 << 16;

        const IN_SENDABLE = 1 << 17;
        const IN_LOST = 1 << 18;
        const IN_STALLED = 1 << 19;
        const IN_OWING = 1 << 20;
        const IN_READABLE = 1 << 21;
        const IN_WRITABLE = 1 << 22;
        const IN_CLOSING = 1 << 23;

        /// The application knows of the stream.
        const ANNOUNCED = 1 << 24;
        /// We have given up on reading.
        const STOPPED = 1 << 25;
        const RESET_BY_PEER = 1 << 26;
        const AWAITS_DATA = 1 << 27;
        const HAS_MUCH_TO_WRITE = 1 << 28;
        const WILL_BE_LONG = 1 << 29;
        /// It is long, and there is no telling how long.
        const KEEPS_COMING = 1 << 30;
        const HAS_LONG_PIECES = 1 << 31;
        /// See [`State::turn_away`](super::State::turn_away).
        const TURNED_AWAY = 1 << 32;
        const DEFERS_RESET = 1 << 33;
        const LACKS_CONTEXT = 1 << 34;
        /// See [`State::stuck`](super::State::stuck).
        const IS_STUCK = 1 << 35;
    }
}

/// What the bytes of a stream are.
#[expect(clippy::large_enum_variant, reason = "the large one is the common one")]
pub(crate) enum Role {
    Raw,
    Message(Message),
    /// A unidirectional stream of HTTP/3 (RFC 9114 §6.2).
    Typed(StreamType),
}

pub(super) const UNKNOWN_SIZE: u64 = u64::MAX;

pub(crate) struct Stream {
    pub(crate) context: Context,
    pub(crate) flags: Flags,
    pub(crate) priority: Priority,
    pub(crate) role: Role,

    pub(crate) send: SendBuffer,
    pub(super) send_limit: u64,
    /// The most that the peer has allowed beyond what has reached it.
    pub(super) send_window: u64,
    /// The limit that STREAM_DATA_BLOCKED has been sent for.
    pub(super) blocked_at: Option<u64>,
    /// The turn in which it was opened, or else in which its end is due.
    pub(super) first_turn: u64,
    /// How many bytes are left of its share, and when that is due.
    pub(super) share: u64,
    pub(super) due: u64,
    /// The period in which it got in line to write.
    pub(super) waits_since: u64,
    /// How many bytes the application is left with.
    pub(super) unwritten: u64,
    /// Where it last ran out of bytes to send.
    pub(super) busy_from: u64,
    /// Up to where it is this stream's turn to send.
    pub(super) turn_end: u64,
    pub(crate) write_round: u32,
    pub(super) reset_code: u64,
    /// For when everything has been sent, and some of it gets lost.
    pub(super) deferred_reset_code: u64,

    /// What comes at or after `read`.
    pub(super) kept: Assembler,
    /// What is for the application from the bytes before `read`.
    pub(super) ready: Vec<u8>,
    /// How much `ready` had the last time.
    pub(super) ready_hint: usize,
    /// How many bytes the application has got, but not consumed.
    pub(crate) held: u64,
    pub(super) read: u64,
    pub(super) received: u64,
    pub(super) final_size: u64,
    /// How many bytes the peer has been given credit for.
    pub(super) consumed: u64,
    /// Likewise for the connection.
    pub(super) counted: u64,
    pub(super) receive_limit: u64,
    pub(super) receive_window: u64,
    pub(super) stop_code: u64,
}

impl Stream {
    pub(super) fn new(role: Role, flags: Flags, send_limit: u64, receive_window: u64) -> Self {
        Self {
            context: core::ptr::null_mut(),
            flags,
            priority: Priority::default(),
            role,
            send: SendBuffer::default(),
            send_limit,
            send_window: send_limit,
            blocked_at: None,
            first_turn: 0,
            share: 0,
            due: 0,
            waits_since: 0,
            unwritten: 0,
            busy_from: 0,
            turn_end: 0,
            write_round: 0,
            reset_code: 0,
            deferred_reset_code: 0,
            kept: Assembler::default(),
            ready: Vec::new(),
            ready_hint: 0,
            held: 0,
            read: 0,
            received: 0,
            final_size: UNKNOWN_SIZE,
            consumed: 0,
            counted: 0,
            receive_limit: receive_window,
            receive_window,
            stop_code: 0,
        }
    }

    /// Sets `flag`, and returns whether it was not set.
    #[inline]
    pub(crate) fn mark(&mut self, flag: Flags) -> bool {
        let is_new = !self.flags.contains(flag);
        self.flags.insert(flag);
        is_new
    }

    /// Clears `flag`, and returns whether it was set.
    #[inline]
    pub(super) fn take(&mut self, flag: Flags) -> bool {
        let was_set = self.flags.contains(flag);
        self.flags.remove(flag);
        was_set
    }

    #[inline]
    pub(super) fn send_credit(&self) -> u64 {
        self.send_limit.saturating_sub(self.send.end())
    }

    #[inline]
    pub(super) fn owes_fin(&self) -> bool {
        self.flags.contains(Flags::FIN) && !self.flags.intersects(Flags::FIN_SENT | Flags::RESET)
    }

    /// Whether what STREAM_DATA_BLOCKED has been sent for still holds.
    pub(super) fn is_blocked(&self) -> bool {
        self.blocked_at == Some(self.send_limit)
            && !self.flags.intersects(Flags::RESET | Flags::FIN_SENT)
    }

    pub(crate) fn has_unacked_data(&self) -> bool {
        !(self.flags).intersects(Flags::SEND_DONE | Flags::RESET | Flags::TURNED_AWAY)
            && (!self.send.is_acked() || self.flags.contains(Flags::FIN))
    }

    pub(crate) fn has_unacked_reset(&self) -> bool {
        self.flags & (Flags::RESET | Flags::SEND_DONE) == Flags::RESET
    }

    #[inline]
    pub(super) fn is_finished(&self) -> bool {
        (self.flags).contains(Flags::RELEASED | Flags::READ_DONE | Flags::SEND_DONE)
            && self.final_size != UNKNOWN_SIZE
    }

    /// The streams of HTTP/3 itself go first.
    #[inline]
    pub(crate) fn is_internal(&self) -> bool {
        matches!(self.role, Role::Typed(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_flag_has_its_own_bit() {
        let count = <Flags as bitflags::Flags>::FLAGS.len();
        assert_eq!(Flags::all().bits().count_ones() as usize, count);
    }
}
