//! RFC 9001 §6.

use super::space::Space;
use crate::crypto::{PayloadKey, Secret};
use crate::error::{Error, Result, transport_code};
use crate::version::Version;

/// More packets than can be sent between two calls of [`KeyUpdate::renew`].
const MARGIN: u64 = 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Generation {
    Previous,
    Current,
    Next,
}

#[derive(Default)]
pub(super) struct KeyUpdate {
    pub(super) phase: bool,
    /// Of the current key.
    write_secret: Option<Secret>,
    confidentiality_limit: Option<u64>,
    /// Of `next_read`.
    read_secret: Option<Secret>,
    next_read: Option<PayloadKey>,
    previous_read: Option<PayloadKey>,
    /// The smallest number of a packet that came with the current key.
    first_received: Option<u64>,
    first_sent: u64,
}

impl KeyUpdate {
    pub(super) fn set_write_secret(&mut self, secret: Secret, limit: u64, space: &Space) {
        self.write_secret = Some(secret);
        self.confidentiality_limit = Some(limit);
        self.first_sent = space.next_number;
    }

    /// Whether a packet with the current key has been acknowledged.
    #[inline]
    pub(super) fn is_acked(&self, space: &Space) -> bool {
        space.sent.largest_acked >= Some(self.first_sent)
    }

    pub(super) fn set_read_secret(&mut self, secret: &Secret, version: Version) {
        let next = secret.next(version);
        self.next_read = Some(next.payload_key(version));
        self.read_secret = Some(next);
    }

    #[inline]
    pub(super) fn generation(&self, phase: bool, number: u64) -> Generation {
        if phase == self.phase {
            Generation::Current
        } else if self.previous_read.is_some() && self.first_received.is_none_or(|it| number < it) {
            Generation::Previous
        } else {
            Generation::Next
        }
    }

    pub(super) fn other_key(&self, generation: Generation) -> Option<&PayloadKey> {
        match generation {
            Generation::Previous => self.previous_read.as_ref(),
            _ => self.next_read.as_ref(),
        }
    }

    /// Returns whether the previous key is not going to be needed for much longer.
    #[inline]
    pub(super) fn on_opened(
        &mut self,
        generation: Generation,
        number: u64,
        space: &mut Space,
        version: Version,
    ) -> Result<bool> {
        match generation {
            Generation::Previous => Ok(false),
            Generation::Current => {
                let first = self.first_received.map_or(number, |it| it.min(number));
                Ok(self.first_received.replace(first).is_none() && self.previous_read.is_some())
            }
            Generation::Next if number < space.received.expected => Err(Error::transport(
                transport_code::KEY_UPDATE_ERROR,
                "newer key for an older packet",
            )),
            Generation::Next => {
                self.rotate(space, version);
                self.first_received = Some(number);
                Ok(true)
            }
        }
    }

    pub(super) fn discard_previous(&mut self) {
        self.previous_read
            .take_if(|_| self.first_received.is_some());
    }

    /// Updates the keys when half of what they are good for is used up.
    #[inline]
    pub(super) fn renew(&mut self, space: &mut Space, version: Version) -> Result {
        let used = space.next_number - self.first_sent;
        let Some(limit) = (self.confidentiality_limit).filter(|limit| used >= limit / 2) else {
            return Ok(());
        };
        if self.is_acked(space) && self.first_received.is_some() {
            self.rotate(space, version);
            return Ok(());
        }
        match used + MARGIN < limit {
            true => Ok(()),
            false => Err(Error::transport(
                transport_code::AEAD_LIMIT_REACHED,
                "key is used up",
            )),
        }
    }

    #[cold]
    fn rotate(&mut self, space: &mut Space, version: Version) {
        let (Some(read), Some(write), Some(read_secret), Some(write_secret), Some(next_read)) = (
            &mut space.read_keys,
            &mut space.write_keys,
            self.read_secret.take(),
            &mut self.write_secret,
            self.next_read.take(),
        ) else {
            return;
        };
        self.previous_read = Some(core::mem::replace(&mut read.payload, next_read));
        *write_secret = write_secret.next(version);
        write.payload = write_secret.payload_key(version);
        self.set_read_secret(&read_secret, version);
        self.phase = !self.phase;
        self.first_received = None;
        self.first_sent = space.next_number;
    }
}
