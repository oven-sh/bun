//! RFC 9000 §12 to §14.

use core::ops::Range;

use smallvec::SmallVec;

use super::close::MIN_FRAME_ROOM;
use super::sent::{Control, Fate, SentFrame, SentPacket};
use super::space::{Space, SpaceId};
use super::streams::WRITE_CHUNK;
use super::timers::Timer;
use super::{Connection, Ending, Phase, ack_frequency};
use crate::batch::{Batch, Position};
use crate::coding::{Write, two_byte_varint, varint_len};
use crate::congestion::Permit;
use crate::crypto::TAG_LEN;
use crate::endpoint::Shared;
use crate::error::Result;
use crate::event::CloseReason;
use crate::frame::kind;
use crate::packet::{
    FIXED_BIT, KEY_PHASE, LongFields, LongKind, MIN_DATAGRAM_LEN, SPIN_BIT, Unsealed, number_len,
};
use crate::stream_id::{Direction, Side};
use crate::time::{Duration, Instant};
use crate::token::Scope;

/// For frames, or the packet is not worth starting. PATH_CHALLENGE and PATH_RESPONSE fit.
const MIN_ROOM: usize = 32;
const MAX_TRACKED_PACKETS: usize = 32 * 1024;
/// After how many packets that only have ACK frames to ask for an acknowledgment (RFC 9000 §13.2.4).
const MAX_ACK_ONLY_PACKETS: u32 = 20;
const PACKETS_BEFORE_MTU_PROBE: u64 = 10;
const MAX_INTEGER_FRAME_LEN: usize = 1 + 8;
const MAX_NEW_TOKEN_FRAME_LEN: usize = 64;
const MAX_SECS_BLOCKED_IN_SILENCE: u32 = 8;
const MIN_RETAINED: u64 = 1024 * 1024;
/// So that what waits for more fits into one packet.
const FRAME_OVERHEAD: u64 = 16;
/// Many clients have room for 16 KB of CRYPTO data behind a gap.
const MAX_CRYPTO_AHEAD: u64 = 12 * 1024;

/// Whether what has been written waits for more.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Gathering {
    No,
    Yes,
    Forbidden,
}

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
    /// Returns whether there may be more.
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
            let max_len = len_before + max_datagrams.min(self.congestion.max_turn());
            if !self.candidates.is_empty() || self.path.owes_frames() {
                self.probe_paths(now, batch);
            }
            self.probe_mtu(now, batch);
            while batch.len() < max_len
                && self.write_datagram(now, Content::Anything, batch, shared)
            {}
            self.after_transmit(now);
            if batch.len() > len_before {
                self.streams.state.start_write_round(now);
            }
            if batch.len() >= max_len {
                return true;
            }
            if self.ending == Ending::Graceful || self.streams.table.is_going_away {
                self.close_if_drained(now);
            }
        }
        if self.ending == Ending::Closing {
            if self.is_gathering() && matches!(self.close_reason, CloseReason::Local) {
                self.write_datagram(now, Content::Anything, batch, shared);
            }
            // The server needs the end of the handshake to read 1-RTT packets.
            while self.phase == Phase::Established
                && self.close_frame.is_for_application()
                && self.write_datagram(now, Content::Crypto, batch, shared)
            {}
            let (start, allowance) = (batch.bytes.len(), self.path.allowance());
            self.write_datagram(now, Content::Close, batch, shared);
            let sent = batch.bytes.get(start..).unwrap_or_default();
            let mut farewell = Vec::new();
            match allowance < MIN_DATAGRAM_LEN {
                true => {
                    let end = MIN_DATAGRAM_LEN;
                    self.write_coalesced(now, Content::Close, &mut farewell, end, shared);
                }
                false => farewell.extend_from_slice(sent),
            }
            self.owes_farewell = farewell.len() > sent.len();
            self.farewell = farewell;
            // A client that has nothing to acknowledge would not notice the loss.
            if self.side.is_server()
                && self.is_confirmed()
                && !self.spaces.data.sent.has_in_flight()
                && shared.repeated_closes.take(now, 1)
            {
                self.write_datagram(now, Content::Close, batch, shared);
            }
            self.end();
        }
        false
    }

    /// When something was sent that has to be acknowledged.
    #[inline]
    pub(crate) fn last_sent_at(&self) -> Instant {
        self.spaces.data.sent.last_at
    }

    #[inline]
    fn prepare_to_transmit(&mut self, now: Instant) -> Result {
        if core::mem::take(&mut self.streams.state.made_progress) {
            self.restart_progress_timer(now);
        }
        self.timers.stop(Timer::Pacing);
        if self.is_gathering() {
            self.gathering = Gathering::No;
        }
        if self.side.is_client() {
            self.listen(now);
        }
        // RFC 9002 §6.2.2.1.
        if self.phase == Phase::Handshake && self.timers.get(Timer::Loss) <= now {
            self.on_loss_timeout(now);
        }
        self.bundle_qpack_instructions(now)?;
        self.key_update.renew(&mut self.spaces.data, self.version)
    }

    #[inline]
    fn after_transmit(&mut self, now: Instant) {
        self.set_loss_timer(now);
        if !self.candidates.is_empty() || self.timers.is_set(Timer::Path) {
            self.set_path_timer();
        }
        self.update_unsent_target(now);
    }

    #[inline]
    pub(super) fn update_unsent_target(&mut self, now: Instant) {
        let (state, room) = (&mut self.streams.state, self.congestion.room());
        state.unsent_target = room + 2 * WRITE_CHUNK;
        state.max_retained = MIN_RETAINED.max(3 * self.congestion.window());
        if state.sends_in_order {
            let datagram_len = u64::from(self.path.mtu.current);
            let pace = self.congestion.pace(now, datagram_len, &self.rtt);
            state.set_pace(room, pace, datagram_len);
        }
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
        let (mut max_run, mut is_eliciting) = (0, false);
        if self.phase != Phase::Confirmed || content != Content::Anything {
            self.write_coalesced(now, content, out, end, shared);
        } else if let Some(draft) = self.draft_data(now, out, end, shared) {
            self.send(now, &draft, out);
            is_eliciting = draft.is_eliciting;
            let next_number = self.spaces.data.next_number;
            if self.congestion.spreads_out() {
                self.runs.suspend(next_number);
            } else if self.pto_count == 0 {
                let (to_send, room) = (|| self.streams.to_send(), self.congestion.room());
                max_run = (self.runs).max_len(next_number, to_send, room, self.path.mtu.current);
            }
        }
        let len = out.len() - start;
        if shared.was_backed_up && len < self.path.mtu.current.into() {
            max_run = 0;
        }
        if len > 0 {
            self.path.on_sent(len);
            let position = batch.commit(&self.path.addresses, start, max_run);
            if is_eliciting && let Some(packet) = self.spaces.data.sent.packets.back_mut() {
                packet.position = position;
                self.runs.on_sent(packet);
            }
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
            self.discard_space(now, |it| it.initial.take());
        }
    }

    /// Writes the header, and returns where the frames have to end.
    #[inline]
    fn begin(&mut self, id: SpaceId, out: &mut Vec<u8>, end: usize) -> Option<(Draft, usize)> {
        let space = self.spaces.open(id);
        if id == SpaceId::Data && space.next_number == self.next_skip {
            (self.skipped, self.next_skip) = (space.next_number, u64::MAX);
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
                    | self.spin_bits.rotate_left(self.path.remote.sequence as u32) & SPIN_BIT
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
        let space = self.spaces.open(draft.space);
        let keys = space.write_keys.as_ref().or(self.early_keys.as_ref());
        draft
            .packet
            .seal(out.get_mut(..draft.end).unwrap_or_default(), keys);
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
            settled: 0,
            position: Position::default(),
        });
        space.sent.last_at = now;
        space.probes = space.probes.saturating_sub(1);
        self.ack_only_packets = 0;
        self.timers
            .set(Timer::KeepAlive, now + self.keep_alive_period);
        // RFC 9000 §10.1.
        if !core::mem::replace(&mut self.has_sent_since_receiving, true) {
            match self.config.gives_up_early && self.phase != Phase::Handshake {
                true => self.leave_time_for_an_answer(now),
                false => self.restart_idle_timer(now),
            }
        }
    }

    fn draft_handshake(
        &mut self,
        now: Instant,
        id: SpaceId,
        content: Content,
        out: &mut Vec<u8>,
        datagram: Range<usize>,
    ) -> Option<Draft> {
        let space = self.spaces.get(id)?;
        let is_initial = id == SpaceId::Initial;
        let may_elicit = !is_initial || datagram.len() >= MIN_DATAGRAM_LEN;
        let has_frames = may_elicit
            && (space.has_crypto_to_send() || space.probes > 0 && content == Content::Anything);
        let has_ack = space.received.is_ack_due;
        if !has_frames && !(has_ack && content == Content::Anything) {
            return None;
        }
        let (mut draft, end) = self.begin(id, out, datagram.end)?;
        let space = self.spaces.open(id);
        if has_ack {
            (space.received).write_ack(now, draft.packet.number, out, end);
        }
        if has_frames {
            if !space.has_crypto_to_send() {
                space.crypto_send.on_lost(0..space.crypto_send.sent());
            }
            draft.is_eliciting =
                write_crypto_frames(self.side, self.path.is_validated, space, out, end);
            if !draft.is_eliciting && space.probes > 0 && out.len() < end {
                out.push(kind::PING as u8);
                draft.is_eliciting = true;
            }
        }
        draft.is_expanded = is_initial && (self.side.is_client() || draft.is_eliciting);
        draft.finish(out)
    }

    #[inline]
    pub(super) fn has_frames(&self) -> bool {
        self.streams.state.has_frames() || self.has_datagrams() || self.has_control_frames()
    }

    #[inline]
    fn has_control_frames(&self) -> bool {
        !self.streams.state.owed.is_empty()
            || self.spaces.data.has_crypto_to_send()
            || self.local_ids.has_frames()
            || self.remote_ids.has_frames()
    }

    #[inline]
    fn may_send(&mut self, now: Instant) -> bool {
        match (self.congestion).permit(now, self.streams.state.unsent()) {
            Permit::Now => {
                let is_held_back = self.spaces.data.sent.packets.len() >= MAX_TRACKED_PACKETS
                    || self.has_peer_moved();
                if is_held_back {
                    self.congestion.on_application_limited();
                }
                !is_held_back
            }
            Permit::Blocked => false,
            Permit::At(time) => {
                self.timers.set(Timer::Pacing, time);
                false
            }
        }
    }

    /// Only new data does, and only if no packet is due anyway.
    #[inline]
    pub(super) fn waits_for_more(&mut self, now: Instant) -> bool {
        let state = &self.streams.state;
        let frames = (state.sendable_streams() + self.datagrams.unsent.len()) as u64;
        let unsent = state.unsent() + self.datagrams.unsent_len + frames * FRAME_OVERHEAD;
        if !self.congestion.is_crowded(unsent)
            || state.has_urgent_frames()
            || state.owes_frames()
            || self.has_control_frames()
            || self.spaces.data.received.is_ack_due
            || self.ending != Ending::No
            || self.gathering == Gathering::Forbidden
            || !self.is_confirmed()
        {
            return false;
        }
        let continues_series =
            || self.datagrams.unsent.is_empty() && self.streams.only_continues_series();
        let until = (self.congestion).gathers_until(now, &self.rtt, continues_series);
        if now < until {
            self.gathering = Gathering::Yes;
            self.timers.set(Timer::Pacing, until);
            self.streams.state.ask_for_more(now);
        }
        now < until
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
            (self.congestion).on_run_dry(self.streams.state.awaits_data());
        }
        let may_elicit =
            has_frames && (is_probe || self.may_send(now) && !self.waits_for_more(now));
        let breaks_silence = core::mem::take(&mut self.silence.owes_ping);
        let is_ack_due = self.spaces.data.received.is_ack_due || breaks_silence;
        if !may_elicit && !is_ack_due {
            return None;
        }
        let (mut draft, end) = self.begin(SpaceId::Data, out, end)?;
        let space = &mut self.spaces.data;
        if is_ack_due || space.received.unacked_eliciting > 0 || is_probe {
            (space.received).write_ack(now, draft.packet.number, out, end);
            self.timers.stop(Timer::Ack);
        }
        let after_ack = out.len();
        if may_elicit {
            self.write_frames(now, &mut draft, out, end, shared);
            if out.len() == after_ack {
                // The peer may have to be told what is in the way.
                self.write_frames(now, &mut draft, out, end, shared);
            }
            if is_probe && out.len() == after_ack && self.phase != Phase::Confirmed {
                self.repeat_last_packet();
                self.write_frames(now, &mut draft, out, end, shared);
            }
        }
        draft.is_eliciting = out.len() > after_ack;
        if may_elicit && !draft.is_eliciting {
            self.congestion.on_application_limited();
        }
        let asks_for_ack = self.ack_only_packets >= MAX_ACK_ONLY_PACKETS
            && after_ack > draft.packet.payload_start
            && !self.spaces.data.sent.has_in_flight();
        if !draft.is_eliciting && (is_probe || asks_for_ack || breaks_silence) && out.len() < end {
            out.push(kind::PING as u8);
            draft.is_eliciting = !breaks_silence;
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
        if !self.streams.state.owed.is_empty() {
            draft.control = self.write_control_frames(now, out, end, shared);
        }
        let has_datagrams = self.has_datagrams();
        let space = &mut self.spaces.data;
        if space.has_crypto_to_send() {
            write_crypto_frames(self.side, self.path.is_validated, space, out, end);
        }
        let sent = &mut space.sent.frames;
        if self.local_ids.has_frames() {
            (self.local_ids).write_frames(self.slot, shared, out, end, sent);
        }
        self.remote_ids.write_frames(out, end, sent);
        // GOAWAY tells the client what to make of a reset (RFC 9114 §5.2).
        if self.streams.table.is_going_away
            && self.side.is_server()
            && let Some(http3) = &self.http3
            && self.streams.repeat_unacked_data(http3.control_stream)
        {
            self.streams.write_stream_frames(out, end, sent);
        }
        self.streams.write_owed_frames(out, end, sent);
        if has_datagrams {
            self.congestion.hurry();
            if self.streams.state.has_urgent_frames() {
                self.streams.write_stream_frames(out, end, sent);
            }
            let overhead = match space.write_keys {
                Some(_) => draft.packet.payload_start - draft.packet.start + TAG_LEN,
                // There is going to be more room in 1-RTT packets.
                None => 0,
            };
            let room = u64::from(self.path.mtu.current).saturating_sub(overhead as u64);
            let max_len = match &self.http3 {
                Some(http3) if http3.peer_accepts_datagrams == Some(false) => 0,
                _ => room.min(self.peer.max_datagram_frame_size) as usize,
            };
            let events = &mut self.streams.state.events;
            self.stats.datagrams_sent +=
                (self.datagrams).write_frames(max_len, out, end, sent, events);
        }
        self.streams.write_stream_frames(out, end, sent);
        if core::mem::take(&mut self.streams.state.has_reported_blocked) {
            let random = self.crypto.random_below(MAX_SECS_BLOCKED_IN_SILENCE);
            let mut delay = Duration::from_secs(1 + u64::from(random));
            if !self.idle_timeout.is_zero() {
                delay = delay.min((self.idle_timeout / 2).max(self.probe_timeout()));
            }
            self.timers.set(Timer::Blocked, now + delay);
        }
    }

    /// Returns the ones that have to be sent again if they get lost.
    fn write_control_frames(
        &mut self,
        now: Instant,
        out: &mut Vec<u8>,
        end: usize,
        shared: &mut Shared,
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
                Control::MAX_DATA => integer(kind::MAX_DATA, streams.state.raise_receive_limit()),
                Control::MAX_STREAMS_BIDI => integer(
                    kind::MAX_STREAMS_BIDI,
                    streams.raise_remote_limit(Direction::Bidirectional),
                ),
                Control::MAX_STREAMS_UNI => integer(
                    kind::MAX_STREAMS_UNI,
                    streams.raise_remote_limit(Direction::Unidirectional),
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
                    crate::with(self.ack_controller.as_mut(), |it| {
                        it.write_frame(max_delay, out)
                    });
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
        let space = self.spaces.open(id);
        if space.received.unacked_eliciting > 0 {
            let number = draft.packet.number;
            (space.received).write_ack(now, number, out, end - MIN_FRAME_ROOM);
        }
        if id == SpaceId::Data
            && self.streams.table.is_going_away
            && self.side.is_server()
            && let Some(http3) = &self.http3
        {
            let sent = &mut space.sent.frames;
            (self.streams).write_unacked_data(http3.control_stream, out, end, sent);
        }
        self.close_frame.write(id, out, end);
        draft.is_expanded = id == SpaceId::Initial && self.side.is_client();
        draft.finish(out)
    }

    #[inline]
    fn probe_mtu(&mut self, now: Instant, batch: &mut Batch) {
        if let Some(len) = self.path.mtu.next_probe(now)
            && self.spaces.data.next_number >= PACKETS_BEFORE_MTU_PROBE
            && self.phase == Phase::Confirmed
            && self.pto_count == 0
            && match self.has_frames() {
                true => self.has_use_for_larger_packets(),
                false => self.spaces.data.received.is_ack_due,
            }
            && self.may_send(now)
            && let out = &mut batch.bytes
            && let start = out.len()
            && let Some((mut draft, end)) = self.begin(SpaceId::Data, out, start + usize::from(len))
        {
            out.push(kind::PING as u8);
            out.resize(end, 0);
            self.spaces.data.sent.frames.push(SentFrame::MtuProbe);
            self.path.mtu.on_probe_sent(now, draft.packet.number);
            draft.is_eliciting = true;
            self.send(now, &draft.end(out), out);
            batch.commit(&self.path.addresses, start, 0);
        }
    }

    fn has_use_for_larger_packets(&self) -> bool {
        self.streams.state.unsent() > u64::from(self.path.mtu.current) * 7 / 8
            || self.streams.state.has_lost_data()
            || self.has_datagrams()
    }

    /// These packets are not sent again, and have no part in congestion control (RFC 9000 §8.2.1 and §9.4).
    #[cold]
    fn probe_paths(&mut self, now: Instant, batch: &mut Batch) {
        let mut candidates = core::mem::take(&mut self.candidates);
        for path in &mut candidates {
            core::mem::swap(&mut self.path, path);
            self.probe_path(now, batch, false);
            core::mem::swap(&mut self.path, path);
        }
        self.candidates = candidates;
        // Last, as a queue that the paths share may only have room for one.
        self.probe_path(now, batch, true);
        self.set_path_timer();
    }

    fn probe_path(&mut self, now: Instant, batch: &mut Batch, is_active: bool) {
        let out = &mut batch.bytes;
        let start = out.len();
        let max_len = self.path.probe_len();
        if self.path.owes_frames()
            && let Some((draft, frames_end)) = self.begin(SpaceId::Data, out, start + max_len)
        {
            let is_response = self.path.write_frames(now, self.crypto, out);
            // RFC 9000 §9.3.3.
            if self.path.is_wanted || is_active && is_response {
                let number = draft.packet.number;
                (self.spaces.data.received).write_ack(now, number, out, frames_end);
                self.await_acknowledgment(now, number);
            }
            if max_len == MIN_DATAGRAM_LEN {
                out.resize(frames_end, 0);
            }
            self.send(now, &draft.end(out), out);
            self.path.on_sent(out.len() - start);
            batch.commit(&self.path.addresses, start, 0);
        }
    }

    /// Does not wait for more packets to acknowledge.
    pub fn acknowledge(&mut self) {
        let received = &mut self.spaces.data.received;
        received.is_ack_due |= received.unacked_eliciting > 0;
    }

    /// Whether it waits for more data to fill a packet.
    pub fn is_gathering(&self) -> bool {
        self.gathering == Gathering::Yes
    }

    /// For good.
    pub fn stop_gathering(&mut self) {
        self.gathering = Gathering::Forbidden;
    }
}

impl Draft {
    /// Takes the header back if there are no frames.
    #[inline]
    fn finish(self, out: &mut Vec<u8>) -> Option<Self> {
        if out.len() == self.packet.payload_start {
            out.truncate(self.packet.start);
            return None;
        }
        Some(self.end(out))
    }

    #[inline]
    fn end(mut self, out: &mut Vec<u8>) -> Self {
        self.packet.end(out);
        self.end = out.len();
        self
    }

    /// With PADDING frames. It is the last packet.
    fn expand(&mut self, out: &mut Vec<u8>, min_end: usize) {
        self.end = self.end.max(min_end);
        out.resize(self.end, 0);
    }
}

/// Returns whether it wrote any.
fn write_crypto_frames(
    side: Side,
    is_validated: bool,
    space: &mut Space,
    out: &mut Vec<u8>,
    end: usize,
) -> bool {
    let (buffer, start) = (&mut space.crypto_send, out.len());
    loop {
        let unsent = buffer.sent()..buffer.end();
        // There is little room, and the rest may just be on its way (RFC 9002 §6.2.4).
        let is_far_ahead = buffer.len() - buffer.unsent_len() >= MAX_CRYPTO_AHEAD;
        let lost =
            (buffer.first_lost()).filter(|_| is_validated || is_far_ahead || unsent.is_empty());
        let range = lost.unwrap_or(unsent);
        // Some servers make no use of a frame of which they have read a part.
        let next = (space.crypto_ends).partition_point(|&it| it <= range.start);
        let former_end = space.crypto_ends.get(next).copied();
        let whole = range.end.min(former_end.unwrap_or(u64::MAX)) - range.start;
        let room = |at: usize| end.saturating_sub(at + 1 + varint_len(range.start) + 2) as u64;
        let len = whole.min(room(out.len()));
        if len == 0 || len < whole && former_end.is_some() && whole <= room(start) {
            return out.len() > start;
        }
        if side.is_client() && former_end != Some(range.start + len) {
            space.crypto_ends.insert(next, range.start + len);
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
