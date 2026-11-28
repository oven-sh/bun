//! RFC 9000 §5.1.

use smallvec::SmallVec;

use super::sent::{Frames, SentFrame};
use crate::cid::{ConnectionId, LocalId, ResetToken};
use crate::coding::Write;
use crate::endpoint::Shared;
use crate::error::{Error, Result, transport_code};
use crate::frame::kind;
use crate::range_set::RangeSet;

/// How many IDs the peer may give us.
pub(super) const ACTIVE_LIMIT: usize = 8;
const MAX_ISSUED: usize = 3;
const MAX_RETIRING: usize = 4 * ACTIVE_LIMIT;
const MAX_NEW_FRAME_LEN: usize = 1 + 8 + 1 + 1 + LocalId::LEN + ResetToken::LEN;
const MAX_RETIRE_FRAME_LEN: usize = 1 + 8;

struct Issued {
    sequence: u64,
    id: LocalId,
    is_owed: bool,
}

#[derive(Default)]
pub(super) struct LocalIds {
    active: SmallVec<[Issued; MAX_ISSUED]>,
    next_sequence: u64,
    wanted: usize,
}

impl LocalIds {
    /// For an ID that the peer learns from the handshake.
    pub(super) fn issue(&mut self, slot: u32, shared: &mut Shared) -> LocalId {
        let id = shared.new_id(slot);
        self.active.push(Issued {
            sequence: self.next_sequence,
            id,
            is_owed: false,
        });
        self.next_sequence += 1;
        id
    }

    pub(super) fn set_peer_limit(&mut self, limit: u64) {
        self.wanted = limit.min(MAX_ISSUED as u64) as usize;
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = LocalId> {
        self.active.iter().map(|it| it.id)
    }

    #[inline]
    pub(super) fn has_frames(&self) -> bool {
        self.active.len() < self.wanted || self.active.iter().any(|it| it.is_owed)
    }

    pub(super) fn write_frames(
        &mut self,
        slot: u32,
        shared: &mut Shared,
        out: &mut Vec<u8>,
        end: usize,
        sent: &mut Frames,
    ) {
        while self.active.len() < self.wanted {
            self.issue(slot, shared);
            self.on_lost(self.next_sequence - 1);
        }
        for issued in self.active.iter_mut().filter(|it| it.is_owed) {
            if out.len() + MAX_NEW_FRAME_LEN > end {
                return;
            }
            out.push(kind::NEW_CONNECTION_ID as u8);
            out.varint(issued.sequence);
            out.push(0);
            ConnectionId::from(issued.id).write(out);
            out.extend_from_slice(&shared.tokens.reset_token(&issued.id.0).0);
            sent.push(SentFrame::NewConnectionId(issued.sequence));
            issued.is_owed = false;
        }
    }

    pub(super) fn on_lost(&mut self, sequence: u64) {
        if let Some(issued) = self.active.iter_mut().find(|it| it.sequence == sequence) {
            issued.is_owed = true;
        }
    }

    /// `destination` is that of the packet that says so.
    pub(super) fn on_retired(
        &mut self,
        sequence: u64,
        destination: &[u8],
        shared: &mut Shared,
    ) -> Result {
        if sequence >= self.next_sequence {
            return Err(Error::violation("retired connection ID was never issued"));
        }
        if let Some(at) = self.active.iter().position(|it| it.sequence == sequence) {
            let id = self.active.remove(at).id;
            shared.routes.by_id.remove(&id);
            if id.0 == destination {
                return Err(Error::violation("packet retires its own connection ID"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(super) struct RemoteId {
    pub(super) sequence: u64,
    pub(super) id: ConnectionId,
    pub(super) reset_token: Option<ResetToken>,
}

impl RemoteId {
    pub(super) fn first(id: ConnectionId) -> Self {
        Self {
            sequence: 0,
            id,
            reset_token: None,
        }
    }
}

struct Retiring {
    sequence: u64,
    is_owed: bool,
}

/// The paths have the ones that are in use.
#[derive(Default)]
pub(super) struct RemoteIds {
    spare: Vec<RemoteId>,
    pub(super) retire_prior_to: u64,
    retired: RangeSet,
    /// Until the peer acknowledges it.
    retiring: Vec<Retiring>,
}

const OVER_LIMIT: Error = Error::transport(
    transport_code::CONNECTION_ID_LIMIT_ERROR,
    "too many connection IDs",
);

impl RemoteIds {
    /// The caller has to retire what is in use and before [`Self::retire_prior_to`].
    pub(super) fn add(
        &mut self,
        new: RemoteId,
        retire_prior_to: u64,
        in_use: &[RemoteId],
    ) -> Result {
        let mut is_known = false;
        for known in in_use.iter().chain(&self.spare) {
            let is_same = known.sequence == new.sequence;
            if is_same != (known.id == new.id) || is_same != (known.reset_token == new.reset_token)
            {
                return Err(Error::violation("connection ID contradicts another one"));
            }
            is_known |= is_same;
        }
        self.retire_prior_to = self.retire_prior_to.max(retire_prior_to);
        while let Some(at) = (self.spare.iter()).position(|it| it.sequence < self.retire_prior_to) {
            let sequence = self.spare.swap_remove(at).sequence;
            self.retire(sequence)?;
        }
        if new.sequence < self.retire_prior_to || self.retired.contains(new.sequence) {
            return if is_known {
                Ok(())
            } else {
                self.retire(new.sequence)
            };
        }
        if !is_known {
            self.spare.push(new);
        }
        let kept = in_use
            .iter()
            .filter(|it| it.sequence >= self.retire_prior_to);
        match kept.count() + self.spare.len() > ACTIVE_LIMIT {
            true => Err(OVER_LIMIT),
            false => Ok(()),
        }
    }

    pub(super) fn take_spare(&mut self) -> Option<RemoteId> {
        let (at, _) = (self.spare.iter().enumerate()).min_by_key(|(_, it)| it.sequence)?;
        Some(self.spare.swap_remove(at))
    }

    pub(super) fn retire(&mut self, sequence: u64) -> Result {
        self.retired.insert(sequence..sequence + 1);
        self.retired.remove_below(self.retire_prior_to);
        if !self.retiring.iter().any(|it| it.sequence == sequence) {
            self.retiring.push(Retiring {
                sequence,
                is_owed: true,
            });
        }
        match self.retiring.len().max(self.retired.len()) > MAX_RETIRING {
            true => Err(OVER_LIMIT),
            false => Ok(()),
        }
    }

    #[inline]
    pub(super) fn has_frames(&self) -> bool {
        self.retiring.iter().any(|it| it.is_owed)
    }

    pub(super) fn write_frames(&mut self, out: &mut Vec<u8>, end: usize, sent: &mut Frames) {
        for retiring in self.retiring.iter_mut().filter(|it| it.is_owed) {
            if out.len() + MAX_RETIRE_FRAME_LEN > end {
                return;
            }
            out.push(kind::RETIRE_CONNECTION_ID as u8);
            out.varint(retiring.sequence);
            sent.push(SentFrame::RetireConnectionId(retiring.sequence));
            retiring.is_owed = false;
        }
    }

    pub(super) fn on_acked(&mut self, sequence: u64) {
        self.retiring.retain(|it| it.sequence != sequence);
    }

    pub(super) fn on_lost(&mut self, sequence: u64) {
        if let Some(retiring) = self.retiring.iter_mut().find(|it| it.sequence == sequence) {
            retiring.is_owed = true;
        }
    }
}
