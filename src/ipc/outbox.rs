use smallvec::SmallVec;
use std::collections::VecDeque;

/// The transport returns the number of bytes written as an `i32`.
const MAX_WRITE_LEN: usize = i32::MAX as usize;
const MAX_HANDLE_TRANSMISSIONS: u8 = 3;

/// What is still to be written. `H` is a handle that goes with a message, `C` the callback of a `send()`.
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
    Plain(SmallVec<[C; 1]>),
    /// Alone in its item, so that it can be sent again.
    Handle(Offer<H, C>),
}

pub struct Offer<H, C> {
    pub handle: H,
    pub callback: Option<C>,
    transmissions: u8,
}

pub enum Wrote<C> {
    /// Call these, then write on.
    Continue(SmallVec<[C; 1]>),
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

impl<H, C> Outbox<H, C> {
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

    pub fn push(&mut self, bytes: Vec<u8>, handle: Option<H>, callback: Option<C>) {
        let last_is_in_flight = self.in_flight && self.queue.len() == 1;
        let payload = match (handle, self.queue.back_mut()) {
            (Some(handle), _) => Payload::Handle(Offer {
                handle,
                callback,
                transmissions: 1,
            }),
            (
                None,
                Some(Item {
                    bytes: last,
                    written: 0,
                    payload: Payload::Plain(callbacks),
                }),
            ) if !last_is_in_flight => {
                last.extend_from_slice(&bytes);
                callbacks.extend(callback);
                return;
            }
            (None, _) => Payload::Plain(callback.into_iter().collect()),
        };
        self.queue.push_back(Item {
            bytes,
            written: 0,
            payload,
        });
    }

    pub fn push_reply(&mut self, packet: &[u8]) {
        self.push_next(packet.to_vec(), Payload::Reply);
    }

    /// Ahead of everything that the transport has no byte of.
    fn push_next(&mut self, bytes: Vec<u8>, payload: Payload<H, C>) {
        let is_started = self.in_flight || self.queue.front().is_some_and(|it| it.written != 0);
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
    pub fn begin_write(&mut self, is_writable: bool) -> Option<(&[u8], Option<&H>)> {
        let first = self.queue.front()?;
        let is_held = self.unacked.is_some() && !matches!(first.payload, Payload::Reply);
        if self.in_flight || is_held || (first.written != 0 && !is_writable) {
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

    pub fn end_write(&mut self, written: i32) -> Wrote<C> {
        self.in_flight = false;
        let Ok(written) = usize::try_from(written) else {
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
        Wrote::Continue(SmallVec::new())
    }
}
