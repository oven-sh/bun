//! RFC 9000 §12 to §14.

use smallvec::SmallVec;

use super::sent::{Control, Fate, SentFrame, SentPacket};
use super::space::{Space, SpaceId};
use super::streams::WRITE_CHUNK;
use super::timers::Timer;
use super::{Connection, Ending, Phase, ack_frequency, paths};
use crate::batch::Batch;
use crate::coding::{Write, two_byte_varint, varint_len};
use crate::congestion::Permit;
use crate::crypto::TAG_LEN;
use crate::endpoint::Shared;
use crate::frame::kind;
use crate::packet::{
    FIXED_BIT, KEY_PHASE, LongFields, LongKind, MIN_DATAGRAM_LEN, SPIN_BIT, Unsealed, number_len,
};
use crate::stream_id::Direction;
use crate::time::{Duration, Instant};
use crate::token::Scope;

/// For frames, or the packet is not worth starting.
const MIN_ROOM: usize = 32;
const MAX_TRACKED_PACKETS: usize = 32 * 1024;
/// After how many packets that only have ACK frames to ask for an acknowledgment (RFC 9000 §13.2.4).
const MAX_ACK_ONLY_PACKETS: u32 = 20;
const PACKETS_BEFORE_MTU_PROBE: u64 = 30;
const MAX_INTEGER_FRAME_LEN: usize = 1 + 8;
const MAX_NEW_TOKEN_FRAME_LEN: usize = 48;

/// A packet that is not sealed yet.
struct Draft {
    space: SpaceId,
    packet: Unsealed,
    first_frame: u32,
    control: Control,
    is_eliciting: bool,
    /// The datagram has to have at least [`MIN_DATAGRAM_LEN`] bytes.
    is_expanded: bool,
    /// After the tag.
    end: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Content {
    Anything,
    Crypto,
    Close,
}

impl Connection {
    /// Returns whether there is more than `max_datagrams`.
    pub(crate) fn transmit(
        &mut self,
        now: Instant,
        batch: &mut Batch,
        max_datagrams: usize,
        shared: &mut Shared,
    ) -> bool {
        if self.is_receiving()
            && let Err(error) = self.prepare_to_transmit(now)
        {
            self.fail(now, error);
        }
        if self.is_receiving() {
            let len_before = batch.len();
            let max_len = len_before + max_datagrams;
            if !self.candidates.is_empty() {
                self.probe_paths(now, batch);
            }
            self.probe_mtu(now, batch);
            while batch.len() < max_len
                && self.write_datagram(now, Content::Anything, batch, shared)
            {}
            self.after_transmit(now);
            if batch.len() > len_before {
                self.streams.state.start_write_round();
            }
            if batch.len() >= max_len {
                return true;
            }
            if self.ending == Ending::Graceful || self.streams.table.is_going_away {
                self.close_if_drained(now);
            }
        }
        if self.ending == Ending::Closing {
            // The server needs the end of the handshake to read 1-RTT packets.
            while self.phase == Phase::Established
                && self.close_frame.is_for_application()
                && self.write_datagram(now, Content::Crypto, batch, shared)
            {}
            let start = batch.bytes.len();
            self.write_datagram(now, Content::Close, batch, shared);
            self.farewell = batch.bytes.get(start..).unwrap_or_default().to_vec();
            self.end();
        }
        false
    }

    #[inline]
    fn prepare_to_transmit(&mut self, now: Instant) -> crate::error::Result {
        if core::mem::take(&mut self.streams.state.made_progress) {
            self.restart_progress_timer(now);
        }
        self.timers.stop(Timer::Pacing);
        self.send_qpack_instructions()?;
        self.key_update.renew(&mut self.spaces.data, self.version)
    }

    #[inline]
    fn after_transmit(&mut self, now: Instant) {
        self.set_loss_timer(now);
        if !self.candidates.is_empty() || self.timers.is_set(Timer::Path) {
            self.set_path_timer();
        }
        self.update_unsent_target();
    }

    #[inline]
    pub(super) fn update_unsent_target(&mut self) {
        let available = (self.congestion.window()).saturating_sub(self.congestion.in_flight());
        self.streams.state.unsent_target = available + 2 * WRITE_CHUNK;
    }

    /// Returns false if there is nothing to send.
    #[inline]
    fn write_datagram(
        &mut self,
        now: Instant,
        content: Content,
        batch: &mut Batch,
        shared: &mut Shared,
    ) -> bool {
        let out = &mut batch.bytes;
        let start = out.len();
        let end = start + self.path.allowance();
        if self.phase != Phase::Confirmed || content != Content::Anything {
            self.write_coalesced(now, content, out, end, shared);
        } else if let Some(mut draft) = self.draft_data(now, out, end, shared) {
            if draft.is_expanded {
                draft.expand(out, end.min(start + MIN_DATAGRAM_LEN));
            }
            self.send(now, &draft, out);
        }
        let len = out.len() - start;
        if len > 0 {
            self.path.on_sent(len);
            batch.commit(&self.path.addresses, start);
        }
        len > 0
    }

    /// RFC 9000 §12.2.
    #[cold]
    fn write_coalesced(
        &mut self,
        now: Instant,
        content: Content,
        out: &mut Vec<u8>,
        end: usize,
        shared: &mut Shared,
    ) {
        let start = out.len();
        let mut drafts = SmallVec::<[Draft; 3]>::new();
        for id in SpaceId::ALL {
            drafts.extend(match (content, id) {
                (Content::Close, _) => self.draft_close(now, id, out, end),
                (Content::Anything, SpaceId::Data) => self.draft_data(now, out, end, shared),
                (Content::Crypto, SpaceId::Data) => None,
                _ => self.draft_handshake(now, id, content, out, start..end),
            });
        }
        if drafts.iter().any(|it| it.is_expanded)
            && let Some(last) = drafts.last_mut()
        {
            last.expand(out, end.min(start + MIN_DATAGRAM_LEN));
        }
        for draft in &drafts {
            self.send(now, draft, out);
        }
        // RFC 9001 §4.9.1.
        if self.side.is_client() && drafts.iter().any(|it| it.space == SpaceId::Handshake) {
            self.discard_space(now, SpaceId::Initial);
        }
    }

    /// Writes the header, and returns where the frames have to end.
    #[inline]
    fn begin(&mut self, id: SpaceId, out: &mut Vec<u8>, end: usize) -> Option<(Draft, usize)> {
        let space = self.spaces.get_mut(id)?;
        if id == SpaceId::Data && space.next_number == self.next_skip {
            (self.skipped, self.next_skip) = (Some(space.next_number), u64::MAX);
            space.next_number += 1;
        }
        let number = space.next_number;
        let len = number_len(number, space.sent.largest_acked);
        let destination = &self.path.remote.id;
        let kind = match (id, &space.write_keys) {
            (SpaceId::Data, Some(_)) => None,
            (SpaceId::Data, None) if self.side.is_client() && self.early_keys.is_some() => {
                Some(LongKind::EarlyData)
            }
            (_, None) => return None,
            (SpaceId::Initial, _) => Some(LongKind::Initial),
            (SpaceId::Handshake, _) => Some(LongKind::Handshake),
        };
        let packet = match kind {
            None => {
                let flags = FIXED_BIT
                    | if self.spin { SPIN_BIT } else { 0 }
                    | if self.key_update.phase { KEY_PHASE } else { 0 };
                Unsealed::short(out, flags, destination, number, len)
            }
            Some(kind) => {
                let fields = LongFields {
                    version: self.version,
                    kind,
                    destination,
                    source: &self.local.initial_source_connection_id.unwrap_or_default(),
                    token: self.setup.as_ref().map_or(&[], |it| &it.token),
                };
                Unsealed::long(out, &fields, number, len)
            }
        };
        if packet.payload_start + MIN_ROOM + TAG_LEN > end {
            out.truncate(packet.start);
            return None;
        }
        let draft = Draft {
            space: id,
            packet,
            first_frame: space.sent.frames.end(),
            control: Control::empty(),
            is_eliciting: false,
            is_expanded: false,
            end: 0,
        };
        Some((draft, end - TAG_LEN))
    }

    #[inline]
    fn send(&mut self, now: Instant, draft: &Draft, out: &mut [u8]) {
        let Some(space) = self.spaces.get_mut(draft.space) else {
            return;
        };
        if let Some(keys) = space.write_keys.as_ref().or(self.early_keys.as_ref())
            && let Some(out) = out.get_mut(..draft.end)
        {
            draft.packet.seal(out, keys);
        }
        let len = draft.end - draft.packet.start;
        space.next_number += 1;
        self.stats.packets_sent += 1;
        self.stats.bytes_sent += len as u64;
        if !draft.is_eliciting {
            self.ack_only_packets += 1;
            return;
        }
        space.sent.packets.push_back(SentPacket {
            number: draft.packet.number,
            flight: self.congestion.on_sent(now, len as u16, &self.rtt),
            first_frame: draft.first_frame,
            frame_count: space.sent.frames.end().wrapping_sub(draft.first_frame) as u16,
            control: draft.control,
            fate: Fate::Unknown,
        });
        space.sent.last_at = now;
        space.probes = space.probes.saturating_sub(1);
        self.ack_only_packets = 0;
        self.timers
            .set(Timer::KeepAlive, now + self.keep_alive_period);
        // RFC 9000 §10.1.
        if !core::mem::replace(&mut self.has_sent_since_receiving, true) {
            self.restart_idle_timer(now);
        }
    }

    fn draft_handshake(
        &mut self,
        now: Instant,
        id: SpaceId,
        content: Content,
        out: &mut Vec<u8>,
        datagram: core::ops::Range<usize>,
    ) -> Option<Draft> {
        let space = self.spaces.get(id)?;
        let is_initial = id == SpaceId::Initial;
        let may_elicit = !is_initial || datagram.len() >= MIN_DATAGRAM_LEN;
        let has_frames = may_elicit
            && (space.has_crypto_to_send() || space.probes > 0 && content == Content::Anything);
        // The first packet of a server is in the version that it chooses.
        let has_ack = space.received.is_ack_due
            && (self.side.is_client() || self.peer.initial_source_connection_id.is_some());
        if !has_frames && !(has_ack && content == Content::Anything) {
            return None;
        }
        let (mut draft, end) = self.begin(id, out, datagram.end)?;
        let space = self.spaces.get_mut(id)?;
        if has_ack {
            (space.received).write_ack(now, draft.packet.number, out, end);
        }
        if has_frames {
            draft.is_eliciting = write_crypto_frames(space, out, end);
            if !draft.is_eliciting && space.probes > 0 && out.len() < end {
                out.push(kind::PING as u8);
                draft.is_eliciting = true;
            }
        }
        draft.is_expanded = is_initial && (self.side.is_client() || draft.is_eliciting);
        draft.finish(out)
    }

    #[inline]
    fn has_frames(&self) -> bool {
        self.streams.state.has_frames()
            || !self.streams.state.owed.is_empty()
            || !self.datagrams.unsent.is_empty()
            || self.spaces.data.has_crypto_to_send()
            || self.path.owes_frames()
            || self.local_ids.has_frames()
            || self.remote_ids.has_frames()
    }

    #[inline]
    fn may_send(&mut self, now: Instant) -> bool {
        match self.congestion.permit(now) {
            Permit::Now => self.spaces.data.sent.packets.len() < MAX_TRACKED_PACKETS,
            Permit::Blocked => false,
            Permit::At(time) => {
                self.timers.set(Timer::Pacing, time);
                false
            }
        }
    }

    #[inline]
    fn draft_data(
        &mut self,
        now: Instant,
        out: &mut Vec<u8>,
        end: usize,
        shared: &mut Shared,
    ) -> Option<Draft> {
        let is_probe = self.spaces.data.probes > 0;
        let has_frames = is_probe || self.has_frames();
        if !has_frames && !self.streams.state.awaits_writes() {
            self.congestion.on_application_limited();
        }
        let may_elicit = has_frames && (is_probe || self.may_send(now));
        if !may_elicit && !self.spaces.data.received.is_ack_due {
            return None;
        }
        let (mut draft, end) = self.begin(SpaceId::Data, out, end)?;
        let space = &mut self.spaces.data;
        if space.received.is_ack_due || space.received.unacked_eliciting > 0 {
            (space.received).write_ack(now, draft.packet.number, out, end);
            self.timers.stop(Timer::Ack);
        }
        let after_ack = out.len();
        if may_elicit {
            self.write_frames(now, &mut draft, out, end, shared);
        }
        draft.is_eliciting = out.len() > after_ack;
        if may_elicit && !draft.is_eliciting {
            self.congestion.on_application_limited();
        }
        let asks_for_ack = self.ack_only_packets >= MAX_ACK_ONLY_PACKETS
            && after_ack > draft.packet.payload_start
            && !self.spaces.data.sent.has_in_flight();
        if !draft.is_eliciting && (is_probe || asks_for_ack) && out.len() < end {
            out.push(kind::PING as u8);
            draft.is_eliciting = true;
        }
        draft.finish(out)
    }

    #[inline]
    fn write_frames(
        &mut self,
        now: Instant,
        draft: &mut Draft,
        out: &mut Vec<u8>,
        end: usize,
        shared: &mut Shared,
    ) {
        if self.path.owes_frames() && out.len() + paths::MAX_FRAMES_LEN <= end {
            self.path.write_frames(now, self.crypto, out);
            self.set_path_timer();
            draft.is_expanded = true;
        }
        if !self.streams.state.owed.is_empty() {
            draft.control = self.write_control_frames(now, out, end, shared);
        }
        let space = &mut self.spaces.data;
        if space.has_crypto_to_send() {
            write_crypto_frames(space, out, end);
        }
        let sent = &mut space.sent.frames;
        if self.local_ids.has_frames() {
            (self.local_ids).write_frames(self.slot, shared, out, end, sent);
        }
        self.remote_ids.write_frames(out, end, sent);
        self.streams.write_owed_frames(out, end, sent);
        if !self.datagrams.unsent.is_empty() {
            let overhead = draft.packet.payload_start - draft.packet.start + TAG_LEN;
            let room = u64::from(self.path.mtu.current).saturating_sub(overhead as u64);
            let max_len = room.min(self.peer.max_datagram_frame_size) as usize;
            let events = &mut self.streams.state.events;
            self.stats.datagrams_sent +=
                (self.datagrams).write_frames(max_len, out, end, sent, events);
        }
        self.streams.write_stream_frames(out, end, sent);
        if core::mem::take(&mut self.streams.state.has_reported_blocked) {
            let delay = 1 + self.crypto.random_below(8);
            (self.timers).set(Timer::Blocked, now + Duration::from_secs(delay.into()));
        }
    }

    /// Returns the ones that have to be sent again if they get lost.
    fn write_control_frames(
        &mut self,
        now: Instant,
        out: &mut Vec<u8>,
        end: usize,
        shared: &Shared,
    ) -> Control {
        let mut sent = Control::empty();
        for frame in self.streams.state.owed {
            let max_len = match frame {
                Control::NEW_TOKEN => MAX_NEW_TOKEN_FRAME_LEN,
                Control::ACK_FREQUENCY => ack_frequency::MAX_FRAME_LEN,
                _ => MAX_INTEGER_FRAME_LEN,
            };
            if out.len() + max_len > end {
                continue;
            }
            self.streams.state.owed.remove(frame);
            sent.insert(frame);
            let streams = &mut self.streams;
            let mut integer = |kind, value| {
                out.push(kind as u8);
                out.varint(value);
            };
            match frame {
                Control::HANDSHAKE_DONE => out.push(kind::HANDSHAKE_DONE as u8),
                Control::PING => out.push(kind::PING as u8),
                Control::MAX_DATA => integer(kind::MAX_DATA, streams.state.receive_limit()),
                Control::MAX_STREAMS_BIDI => integer(
                    kind::MAX_STREAMS_BIDI,
                    streams.remote_limit(Direction::Bidirectional),
                ),
                Control::MAX_STREAMS_UNI => integer(
                    kind::MAX_STREAMS_UNI,
                    streams.remote_limit(Direction::Unidirectional),
                ),
                Control::DATA_BLOCKED => {
                    if let Some(limit) = streams.state.blocked_at() {
                        integer(kind::DATA_BLOCKED, limit);
                        streams.state.has_reported_blocked = true;
                    }
                }
                Control::NEW_TOKEN => {
                    let scope = Scope {
                        version: self.version,
                        peer: self.path.addresses.peer,
                        destination: &[],
                    };
                    out.push(kind::NEW_TOKEN as u8);
                    out.prefixed_bytes(&shared.tokens.new_token(now, &scope));
                }
                _ => {
                    let max_delay = self.peer_max_ack_delay();
                    if let Some(controller) = &mut self.ack_controller {
                        controller.write_frame(max_delay, out);
                    }
                }
            }
        }
        sent - Control::PING
    }

    /// RFC 9000 §10.2.3.
    fn draft_close(
        &mut self,
        now: Instant,
        id: SpaceId,
        out: &mut Vec<u8>,
        end: usize,
    ) -> Option<Draft> {
        self.spaces.get(id)?.write_keys.as_ref()?;
        let (mut draft, end) = self.begin(id, out, end)?;
        let space = self.spaces.get_mut(id)?;
        if space.received.unacked_eliciting > 0 {
            let number = draft.packet.number;
            (space.received).write_ack(now, number, out, end - super::close::MIN_FRAME_ROOM);
        }
        self.close_frame.write(id, out, end);
        draft.is_expanded = id == SpaceId::Initial && self.side.is_client();
        draft.finish(out)
    }

    #[inline]
    fn probe_mtu(&mut self, now: Instant, batch: &mut Batch) {
        if let Some(len) = self.path.mtu.next_probe()
            && self.spaces.data.next_number >= PACKETS_BEFORE_MTU_PROBE
            && self.phase == Phase::Confirmed
            && self.pto_count == 0
            && self.may_send(now)
        {
            let out = &mut batch.bytes;
            let start = out.len();
            let end = start + usize::from(len);
            if let Some((mut draft, frames_end)) = self.begin(SpaceId::Data, out, end) {
                out.push(kind::PING as u8);
                out.resize(frames_end, 0);
                self.spaces.data.sent.frames.push(SentFrame::MtuProbe);
                self.path.mtu.on_probe_sent(len);
                draft.is_eliciting = true;
                if let Some(draft) = draft.finish(out) {
                    self.send(now, &draft, out);
                    batch.commit(&self.path.addresses, start);
                }
            }
        }
    }

    /// These packets are not sent again, and have no part in congestion control (RFC 9000 §8.2.1 and §9.4).
    #[cold]
    fn probe_paths(&mut self, now: Instant, batch: &mut Batch) {
        let mut candidates = core::mem::take(&mut self.candidates);
        for path in candidates.iter_mut().filter(|it| it.owes_frames()) {
            let out = &mut batch.bytes;
            let start = out.len();
            let end = start + path.allowance().min(MIN_DATAGRAM_LEN);
            core::mem::swap(&mut self.path, path);
            let begun = self.begin(SpaceId::Data, out, end);
            core::mem::swap(&mut self.path, path);
            if let Some((draft, frames_end)) = begun {
                path.write_frames(now, self.crypto, out);
                out.resize(frames_end, 0);
                if let Some(draft) = draft.finish(out) {
                    self.send(now, &draft, out);
                    path.on_sent(end - start);
                    batch.commit(&path.addresses, start);
                }
            }
        }
        self.candidates = candidates;
    }

    /// Does not wait for more packets to acknowledge.
    pub fn acknowledge(&mut self) {
        let received = &mut self.spaces.data.received;
        received.is_ack_due |= received.unacked_eliciting > 0;
    }
}

impl Draft {
    /// Takes the header back if there are no frames.
    #[inline]
    fn finish(mut self, out: &mut Vec<u8>) -> Option<Self> {
        if out.len() == self.packet.payload_start {
            out.truncate(self.packet.start);
            return None;
        }
        self.packet.end(out);
        self.end = out.len();
        Some(self)
    }

    /// With PADDING frames. It is the last packet.
    fn expand(&mut self, out: &mut Vec<u8>, min_end: usize) {
        self.end = self.end.max(min_end);
        out.resize(self.end, 0);
    }
}

/// Returns whether it wrote any.
fn write_crypto_frames(space: &mut Space, out: &mut Vec<u8>, end: usize) -> bool {
    let (buffer, start) = (&mut space.crypto_send, out.len());
    loop {
        let range = (buffer.first_lost()).unwrap_or_else(|| buffer.sent()..buffer.end());
        let room = end.saturating_sub(out.len() + 1 + varint_len(range.start) + 2);
        let len = (range.end - range.start).min(room as u64);
        if len == 0 {
            return out.len() > start;
        }
        out.push(kind::CRYPTO as u8);
        out.varint(range.start);
        out.extend_from_slice(&two_byte_varint(len as usize));
        buffer.send(range.start..range.start + len, out);
        space.sent.frames.push(SentFrame::Crypto {
            offset: range.start,
            len: len as u16,
        });
    }
}
