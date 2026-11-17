use std::collections::VecDeque;

/// The transport returns the number of bytes written as an `i32`.
const MAX_WRITE_LEN: usize = i32::MAX as usize;
const MAX_HANDLE_TRANSMISSIONS: u8 = 3;

/// What is still to be written. `H` is a handle that goes with a message, `C` the callbacks of what is written together.
pub struct Outbox<H, C> {
    queue: VecDeque<Item<H, C>>,
    /// Written. Only replies go out until the peer answers.
    unacked: Option<(Vec<u8>, Offer<H, C>)>,
    /// The transport has the head of `queue`.
    in_flight: bool,
}

struct Item<H, C> {
    bytes: Vec<u8>,
    written: usize,
    payload: Payload<H, C>,
}

pub enum Payload<H, C> {
    Reply,
    /// Messages that are written together.
    Plain(C),
    /// Alone in its item, so that it can be sent again.
    Handle(Offer<H, C>),
}

pub struct Offer<H, C> {
    pub handle: H,
    pub callbacks: C,
    transmissions: u8,
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum WriteReason {
    /// The rest of a message that was partly written waits for `Writable`.
    Queued,
    Writable,
}

pub enum Wrote<C> {
    /// Call these, then write on.
    Continue(C),
    /// Wait until the transport is writable.
    Blocked,
    Failed,
}

impl<H, C> Default for Outbox<H, C> {
    fn default() -> Self {
        Self {
            queue: VecDeque::new(),
            unacked: None,
            in_flight: false,
        }
    }
}

impl<H, C: Default> Outbox<H, C> {
    pub fn is_idle(&self) -> bool {
        self.unacked.is_none() && self.queue.is_empty()
    }

    /// `send()` returns false.
    pub fn is_backed_up(&self) -> bool {
        self.unacked.is_some() && !self.queue.is_empty()
    }

    pub fn unacked(&self) -> Option<&H> {
        self.unacked.as_ref().map(|(_, offer)| &offer.handle)
    }

    /// Nothing is queued if `add_callback` fails.
    pub fn push<E>(
        &mut self,
        bytes: Vec<u8>,
        handle: Option<H>,
        add_callback: impl FnOnce(&mut C) -> Result<(), E>,
    ) -> Result<(), E> {
        let last_is_in_flight = self.in_flight && self.queue.len() == 1;
        if handle.is_none()
            && !last_is_in_flight
            && let Some(Item {
                bytes: last,
                written: 0,
                payload: Payload::Plain(callbacks),
            }) = self.queue.back_mut()
        {
            add_callback(callbacks)?;
            last.extend_from_slice(&bytes);
            return Ok(());
        }
        let mut callbacks = C::default();
        add_callback(&mut callbacks)?;
        let payload = match handle {
            Some(handle) => Payload::Handle(Offer {
                handle,
                callbacks,
                transmissions: 1,
            }),
            None => Payload::Plain(callbacks),
        };
        self.queue.push_back(Item {
            bytes,
            written: 0,
            payload,
        });
        Ok(())
    }

    pub fn push_reply(&mut self, packet: &[u8]) {
        self.push_next(packet.to_vec(), Payload::Reply);
    }

    /// Ahead of everything that the transport has no byte of.
    fn push_next(&mut self, bytes: Vec<u8>, payload: Payload<H, C>) {
        let is_started = (self.queue.front()).is_some_and(|it| self.in_flight || it.written != 0);
        let item = Item {
            bytes,
            written: 0,
            payload,
        };
        self.queue.insert(usize::from(is_started), item);
    }

    /// After a nack. Returns false if the handle was sent often enough.
    pub fn resend(&mut self, refresh: impl FnOnce(&mut H, &mut [u8])) -> bool {
        let Some((mut bytes, mut offer)) =
            (self.unacked).take_if(|(_, offer)| offer.transmissions < MAX_HANDLE_TRANSMISSIONS)
        else {
            return false;
        };
        offer.transmissions += 1;
        refresh(&mut offer.handle, &mut bytes);
        self.push_next(bytes, Payload::Handle(offer));
        true
    }

    pub fn take_unacked(&mut self) -> Option<Offer<H, C>> {
        self.unacked.take().map(|(_, offer)| offer)
    }

    pub fn take_unsent(&mut self) -> impl Iterator<Item = Payload<H, C>> + use<H, C> {
        self.in_flight = false;
        core::mem::take(&mut self.queue)
            .into_iter()
            .map(|item| item.payload)
    }

    /// The bytes to write now and the handle that goes with them. [`Self::end_write`] takes the result.
    pub fn begin_write(&mut self, reason: WriteReason) -> Option<(&[u8], Option<&H>)> {
        let first = self.queue.front()?;
        let is_held = self.unacked.is_some() && !matches!(first.payload, Payload::Reply);
        if self.in_flight || is_held || (first.written != 0 && reason == WriteReason::Queued) {
            return None;
        }
        self.in_flight = true;
        let handle = match &first.payload {
            Payload::Handle(offer) if first.written == 0 => Some(&offer.handle),
            _ => None,
        };
        let rest = &first.bytes[first.written..];
        Some((&rest[..rest.len().min(MAX_WRITE_LEN)], handle))
    }

    /// `None`: the write failed. So did one that reports more than it was given.
    pub fn end_write(&mut self, written: Option<usize>) -> Wrote<C> {
        self.in_flight = false;
        let left = (self.queue.front()).map_or(usize::MAX, |it| it.bytes.len() - it.written);
        let Some(written) = written.filter(|written| *written <= left) else {
            return Wrote::Failed;
        };
        let done = self.queue.pop_front_if(|first| {
            first.written += written;
            first.written >= first.bytes.len()
        });
        match done.map(|item| (item.bytes, item.payload)) {
            Some((_, Payload::Plain(callbacks))) => return Wrote::Continue(callbacks),
            Some((bytes, Payload::Handle(offer))) => self.unacked = Some((bytes, offer)),
            Some((_, Payload::Reply)) => {}
            // A transport that took all it was given sends no writable event.
            None if written == MAX_WRITE_LEN => {}
            None => return Wrote::Blocked,
        }
        Wrote::Continue(C::default())
    }
}
