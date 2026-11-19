//! RFC 9000 §12.3.

use super::received::Received;
use super::sent::Sent;
use super::streams::assembler::Assembler;
use super::streams::send_buffer::SendBuffer;
use crate::crypto::Keys;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SpaceId {
    Initial,
    Handshake,
    Data,
}

impl SpaceId {
    pub(super) const ALL: [Self; 3] = [Self::Initial, Self::Handshake, Self::Data];
}

#[derive(Default)]
pub(super) struct Space {
    pub(super) read_keys: Option<Keys>,
    pub(super) write_keys: Option<Keys>,
    pub(super) next_number: u64,
    pub(super) received: Received,
    pub(super) sent: Sent,
    /// How many packets to send whatever the congestion controller says (RFC 9002 §6.2.4).
    pub(super) probes: u8,
    pub(super) crypto_send: SendBuffer,
    /// What comes after `crypto_read`.
    pub(super) crypto_kept: Assembler,
    pub(super) crypto_read: u64,
}

impl Space {
    #[inline]
    pub(super) fn has_crypto_to_send(&self) -> bool {
        self.crypto_send.unsent_len() > 0 || self.crypto_send.first_lost().is_some()
    }
}

#[derive(Default)]
pub(super) struct Spaces {
    pub(super) initial: Option<Box<Space>>,
    pub(super) handshake: Option<Box<Space>>,
    pub(super) data: Space,
}

impl Spaces {
    #[inline]
    pub(super) fn get(&self, id: SpaceId) -> Option<&Space> {
        match id {
            SpaceId::Initial => self.initial.as_deref(),
            SpaceId::Handshake => self.handshake.as_deref(),
            SpaceId::Data => Some(&self.data),
        }
    }

    /// For one that has not been discarded. It is new if there was none.
    #[inline]
    pub(super) fn open(&mut self, id: SpaceId) -> &mut Space {
        match id {
            SpaceId::Initial => open(&mut self.initial),
            SpaceId::Handshake => open(&mut self.handshake),
            SpaceId::Data => &mut self.data,
        }
    }

    #[inline]
    pub(super) fn get_mut(&mut self, id: SpaceId) -> Option<&mut Space> {
        match id {
            SpaceId::Initial => self.initial.as_deref_mut(),
            SpaceId::Handshake => self.handshake.as_deref_mut(),
            SpaceId::Data => Some(&mut self.data),
        }
    }
}

#[cold]
fn open(space: &mut Option<Box<Space>>) -> &mut Space {
    space.get_or_insert_default()
}
