use crate::wire::{Packet, Reply, ReplyPacket};
use core::mem::replace;
use core::num::NonZeroUsize;
use std::collections::VecDeque;

/// The transport returns the number of bytes written as an `i32`.
const MAX_WRITE_LEN: usize = i32::MAX as usize;
const MAX_HANDLE_RESENDS: u8 = 2;

/// What is still to be written. `H` is a handle that goes with a message, `C` the callbacks of what is written together.
pub struct Outbox<H, C> {
    gate: Gate<H, C>,
    /// The transport has no byte of these.
    queue: VecDeque<Item<H, C>>,
}

enum Gate<H, C> {
    Free(Wire<Item<H, C>>),
    /// The offer is written. Only replies go out until the peer answers.
    Ack(Offer<H, C>, Wire<ReplyPacket>),
}

enum Wire<T> {
    Idle,
    /// Partly written.
    Stalled(T, NonZeroUsize),
    /// A [`Write`] has the item.
    InFlight,
}

enum Item<H, C> {
    Reply(ReplyPacket),
    /// Messages that are written together.
    Plain(Vec<u8>, C),
    Offer(Offer<H, C>),
}

/// A message with a handle. Alone in its item, so that it can be sent again.
pub struct Offer<H, C> {
    pub handle: H,
    pub callbacks: C,
    bytes: Vec<u8>,
    resends_left: u8,
}

/// The one write in flight. Nothing else is written until it is given back.
#[must_use]
pub struct Write<H, C> {
    item: Item<H, C>,
    sent: usize,
}

/// Nothing is left to write or to be acked.
pub struct Idle(());

/// A handle waits for the peer's reply.
pub struct Unacked(());

#[derive(Copy, Clone)]
pub enum WriteReason {
    /// The rest of a message that was partly written waits for `Writable`.
    Queued,
    Writable,
}

#[must_use]
pub enum Wrote<C> {
    /// Call these, then write on.
    Sent(C),
    Continue,
    /// Wait until the transport is writable.
    Blocked,
    Failed,
}

/// What the peer's reply did.
#[must_use]
pub enum Answer<H, C, R> {
    /// No handle waits for one.
    Stray,
    Resent,
    Acked(Offer<H, C>),
    /// Sent often enough. It stays unacked until [`Outbox::take_unacked`].
    GaveUp(R),
}

impl<H, C> Item<H, C> {
    fn bytes(&self) -> &[u8] {
        match self {
            Item::Reply(packet) => packet.bytes(),
            Item::Plain(bytes, _) | Item::Offer(Offer { bytes, .. }) => bytes,
        }
    }
}

impl<H, C> Write<H, C> {
    pub fn bytes(&self) -> &[u8] {
        let rest = &self.item.bytes()[self.sent..];
        &rest[..rest.len().min(MAX_WRITE_LEN)]
    }

    /// It goes with the first byte.
    pub fn handle(&self) -> Option<&H> {
        match &self.item {
            Item::Offer(offer) => (self.sent == 0).then_some(&offer.handle),
            Item::Reply(_) | Item::Plain(..) => None,
        }
    }
}

impl<T> Wire<T> {
    fn is_idle(&self) -> bool {
        match self {
            Wire::Idle => true,
            Wire::Stalled(..) | Wire::InFlight => false,
        }
    }

    fn map<U>(self, f: impl FnOnce(T) -> U) -> Wire<U> {
        match self {
            Wire::Idle => Wire::Idle,
            Wire::Stalled(item, sent) => Wire::Stalled(f(item), sent),
            Wire::InFlight => Wire::InFlight,
        }
    }

    #[inline]
    fn start(
        &mut self,
        reason: WriteReason,
        next: impl FnOnce() -> Option<T>,
    ) -> Option<(T, usize)> {
        use WriteReason::*;
        match (replace(self, Wire::InFlight), reason) {
            (Wire::Idle, Queued | Writable) => match next() {
                Some(item) => return Some((item, 0)),
                None => *self = Wire::Idle,
            },
            (Wire::Stalled(item, sent), Writable) => return Some((item, sent.get())),
            (Wire::Stalled(item, sent), Queued) => *self = Wire::Stalled(item, sent),
            (Wire::InFlight, Queued | Writable) => {}
        }
        None
    }

    fn take_stalled(&mut self) -> Option<(T, usize)> {
        match replace(self, Wire::Idle) {
            Wire::Stalled(item, sent) => Some((item, sent.get())),
            wire @ (Wire::Idle | Wire::InFlight) => {
                *self = wire;
                None
            }
        }
    }
}

impl<H, C> Default for Outbox<H, C> {
    fn default() -> Self {
        Self {
            gate: Gate::Free(Wire::Idle),
            queue: VecDeque::new(),
        }
    }
}

impl<H, C: Default> Outbox<H, C> {
    #[inline]
    pub fn idle(&self) -> Option<Idle> {
        match &self.gate {
            Gate::Free(wire) => (wire.is_idle() && self.queue.is_empty()).then_some(Idle(())),
            Gate::Ack(..) => None,
        }
    }

    pub fn unacked(&self) -> Option<Unacked> {
        match self.gate {
            Gate::Free(_) => None,
            Gate::Ack(..) => Some(Unacked(())),
        }
    }

    /// `send()` returns false.
    pub fn is_backed_up(&self) -> bool {
        match &self.gate {
            Gate::Free(_) => false,
            Gate::Ack(_, wire) => !(wire.is_idle() && self.queue.is_empty()),
        }
    }

    /// Nothing is queued if `add_callback` fails.
    pub fn push<E>(
        &mut self,
        Packet(bytes): Packet,
        handle: Option<H>,
        add_callback: impl FnOnce(&mut C) -> Result<(), E>,
    ) -> Result<(), E> {
        if handle.is_none()
            && let Some(Item::Plain(last, callbacks)) = self.queue.back_mut()
        {
            add_callback(callbacks)?;
            last.extend_from_slice(&bytes);
            return Ok(());
        }
        let mut callbacks = C::default();
        add_callback(&mut callbacks)?;
        self.queue.push_back(match handle {
            None => Item::Plain(bytes, callbacks),
            Some(handle) => Item::Offer(Offer {
                handle,
                callbacks,
                bytes,
                resends_left: MAX_HANDLE_RESENDS,
            }),
        });
        Ok(())
    }

    pub fn push_reply(&mut self, packet: ReplyPacket) {
        self.queue.push_front(Item::Reply(packet));
    }

    /// `refresh` prepares a handle that is sent again, `refused` looks at one that is given up.
    pub fn answer<R>(
        &mut self,
        reply: Reply,
        refresh: impl FnOnce(&mut H, &mut [u8]),
        refused: impl FnOnce(&H) -> R,
    ) -> Answer<H, C, R> {
        let (gate, answer) = match (replace(&mut self.gate, Gate::Free(Wire::Idle)), reply) {
            (gate @ Gate::Free(_), Reply::Ack | Reply::Nack) => (gate, Answer::Stray),
            (Gate::Ack(offer, wire), Reply::Ack) => {
                (Gate::Free(wire.map(Item::Reply)), Answer::Acked(offer))
            }
            (Gate::Ack(mut offer, wire), Reply::Nack) => match offer.resends_left.checked_sub(1) {
                Some(left) => {
                    offer.resends_left = left;
                    refresh(&mut offer.handle, &mut offer.bytes);
                    self.queue.push_front(Item::Offer(offer));
                    (Gate::Free(wire.map(Item::Reply)), Answer::Resent)
                }
                None => {
                    let answer = Answer::GaveUp(refused(&offer.handle));
                    (Gate::Ack(offer, wire), answer)
                }
            },
        };
        self.gate = gate;
        answer
    }

    #[must_use = "`Some`: complete it"]
    pub fn take_unacked(&mut self) -> Option<Offer<H, C>> {
        let (wire, offer) = match replace(&mut self.gate, Gate::Free(Wire::Idle)) {
            Gate::Free(wire) => (wire, None),
            Gate::Ack(offer, wire) => (wire.map(Item::Reply), Some(offer)),
        };
        self.gate = Gate::Free(wire);
        offer
    }

    /// Drops what is not written, and returns its handles.
    pub fn take_unsent(&mut self) -> impl Iterator<Item = H> + use<H, C> {
        let stalled = match &mut self.gate {
            Gate::Free(wire) => wire.take_stalled().map(|(item, _)| item),
            Gate::Ack(_, wire) => wire.take_stalled().map(|(packet, _)| Item::Reply(packet)),
        };
        let unsent = stalled.into_iter().chain(core::mem::take(&mut self.queue));
        unsent.filter_map(|item| match item {
            Item::Offer(offer) => Some(offer.handle),
            Item::Reply(_) | Item::Plain(..) => None,
        })
    }

    /// For a transport that has written when it returns. `None`: nothing can be written now.
    #[cfg(any(not(windows), test))]
    #[must_use = "`Some`: what the write did"]
    #[inline]
    pub fn write(
        &mut self,
        reason: WriteReason,
        write: impl FnOnce(&Write<H, C>) -> Option<usize>,
    ) -> Option<Wrote<C>> {
        let started = self.begin(reason)?;
        let written = write(&started);
        Some(self.end(started, written))
    }

    #[cfg(any(windows, test))]
    #[must_use = "nothing is written until it is given back"]
    pub fn begin_write(&mut self, reason: WriteReason) -> Option<Write<H, C>> {
        self.begin(reason)
    }

    #[cfg(any(windows, test))]
    pub fn end_write(&mut self, write: Write<H, C>, written: Option<usize>) -> Wrote<C> {
        self.end(write, written)
    }

    #[cfg(any(windows, test))]
    pub fn cancel_write(&mut self, write: Write<H, C>) {
        self.cancel(write);
    }

    #[inline]
    fn begin(&mut self, reason: WriteReason) -> Option<Write<H, C>> {
        let queue = &mut self.queue;
        let (item, sent) = match &mut self.gate {
            Gate::Free(wire) => wire.start(reason, || queue.pop_front())?,
            Gate::Ack(_, wire) => {
                let (packet, sent) = wire.start(reason, || match *queue.front()? {
                    Item::Reply(packet) => {
                        queue.pop_front();
                        Some(packet)
                    }
                    Item::Plain(..) | Item::Offer(_) => None,
                })?;
                (Item::Reply(packet), sent)
            }
        };
        Some(Write { item, sent })
    }

    /// `None`: the write failed. So did one that reports more than it was given.
    #[inline]
    fn end(&mut self, mut write: Write<H, C>, written: Option<usize>) -> Wrote<C> {
        let left = write.item.bytes().len() - write.sent;
        let Some(written) = written.filter(|written| *written <= left) else {
            self.cancel(write);
            return Wrote::Failed;
        };
        if written < left {
            write.sent += written;
            self.cancel(write);
            // A transport that took all it was given sends no writable event.
            if written == MAX_WRITE_LEN {
                return Wrote::Continue;
            }
            return Wrote::Blocked;
        }
        match write.item {
            Item::Reply(_) => self.set_wire(Wire::Idle),
            Item::Offer(offer) => self.gate = Gate::Ack(offer, Wire::Idle),
            Item::Plain(_, callbacks) => {
                self.set_wire(Wire::Idle);
                return Wrote::Sent(callbacks);
            }
        }
        Wrote::Continue
    }

    fn cancel(&mut self, Write { item, sent }: Write<H, C>) {
        match (NonZeroUsize::new(sent), item) {
            (None, item) => {
                self.queue.push_front(item);
                self.set_wire(Wire::Idle);
            }
            (Some(sent), Item::Reply(packet)) => self.set_wire(Wire::Stalled(packet, sent)),
            (Some(sent), item @ (Item::Plain(..) | Item::Offer(_))) => {
                self.gate = Gate::Free(Wire::Stalled(item, sent));
            }
        }
    }

    /// The peer can answer while a reply is in flight.
    #[inline]
    fn set_wire(&mut self, wire: Wire<ReplyPacket>) {
        match &mut self.gate {
            Gate::Free(it) => *it = wire.map(Item::Reply),
            Gate::Ack(_, it) => *it = wire,
        }
    }
}
