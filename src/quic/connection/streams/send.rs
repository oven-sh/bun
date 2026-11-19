use core::cmp::Reverse;
use core::ops::Range;

use super::stream::UNKNOWN_SIZE;
use super::{Flags, State, Stream, Streams};
use crate::coding::{MAX_VARINT, Write, varint_len};
use crate::connection::sent::{Control, Frames, SentFrame};
use crate::event::{Event, StreamEvent};
use crate::frame::{kind, stream_flag};
use crate::stream_id::StreamId;

/// What a stream can take however much the others have.
const MIN_UNSENT: u64 = 4 * 1024;
/// By how much what is unsent has to be below the target for the application to be asked for more.
pub(in crate::connection) const WRITE_CHUNK: u64 = 32 * 1024;
const TURN_LEN: u64 = 16 * 1024;
/// A type and three integers.
const MAX_OWED_FRAME_LEN: usize = 25;

impl State {
    /// How many bytes the application may write.
    #[inline]
    pub(crate) fn capacity(&self, stream: &Stream) -> u64 {
        let wanted = (self.unsent_target.saturating_sub(self.unsent))
            .max(MIN_UNSENT.saturating_sub(stream.send.unsent_len()));
        let room = self.max_retained.saturating_sub(self.retained);
        wanted.min(room).min(self.credit_for(stream))
    }

    /// How many bytes flow control would let through.
    #[inline]
    pub(crate) fn credit_for(&self, stream: &Stream) -> u64 {
        stream.send_credit().min(self.send_credit())
    }

    #[inline]
    fn send_credit(&self) -> u64 {
        self.send_limit.saturating_sub(self.sent + self.unsent)
    }

    #[inline]
    fn invites_writes(&self) -> bool {
        self.unsent + WRITE_CHUNK <= self.unsent_target
            && self.retained + WRITE_CHUNK <= self.max_retained
            && self.send_credit() >= self.min_credit
    }

    #[inline]
    pub(crate) fn awaits_writes(&self) -> bool {
        !self.writable.is_empty() && !self.is_write_round_over && self.invites_writes()
    }

    #[inline]
    pub(crate) fn start_write_round(&mut self) {
        self.write_round += 1;
        self.is_write_round_over = false;
    }

    /// Whatever the limits are.
    #[inline]
    pub(crate) fn write(&mut self, id: StreamId, stream: &mut Stream, parts: &[&[u8]]) {
        for part in parts {
            stream.send.write(part);
            self.unsent += part.len() as u64;
            self.retained += part.len() as u64;
        }
        self.mark_sendable(id, stream);
    }

    pub(crate) fn finish(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::WRITE_DONE) {
            stream.flags.insert(Flags::FIN);
            self.mark_sendable(id, stream);
            self.close_if_done(id, stream);
        }
    }

    /// Unless the peer has got everything.
    pub(crate) fn reset(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if !stream.flags.intersects(Flags::RESET | Flags::SEND_DONE) {
            self.discard(stream);
            stream.reset_code = code.min(MAX_VARINT);
            stream.flags.insert(Flags::RESET);
            self.owe(id, stream, Flags::OWES_RESET_STREAM);
        }
        stream.flags.insert(Flags::WRITE_DONE);
        self.close_if_done(id, stream);
    }

    fn discard(&mut self, stream: &mut Stream) {
        self.unsent -= stream.send.unsent_len();
        self.retained -= stream.send.len();
        stream.send.discard();
    }

    /// For a stream that the peer does not know of.
    pub(crate) fn forget(&mut self, id: StreamId, stream: &mut Stream) {
        self.discard(stream);
        (stream.flags).insert(Flags::WRITE_DONE | Flags::RESET | Flags::SEND_DONE);
        stream.final_size = stream.received;
        self.finish_reading(id, stream);
    }

    /// RFC 9000 §3.5.
    pub(crate) fn on_stop_sending(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if stream.mark(Flags::STOPPED_BY_PEER) {
            self.notify(id, stream, StreamEvent::Stopped(code));
            match stream.flags.contains(Flags::FIN_SENT) {
                true => stream.stopped_code = code,
                false => self.reset(id, stream, code),
            }
        }
    }

    pub(crate) fn raise_send_limit(&mut self, id: StreamId, stream: &mut Stream, limit: u64) {
        if limit > stream.send_limit {
            stream.send_limit = limit;
            stream.flags.remove(Flags::OWES_STREAM_DATA_BLOCKED);
            if stream.send.unsent_len() > 0 {
                self.mark_sendable(id, stream);
            }
            if stream.flags.contains(Flags::WANTS_WRITE) {
                self.want_write(id, stream);
            }
        }
    }

    pub(crate) fn want_write(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.flags.contains(Flags::WRITE_DONE) {
            return;
        }
        stream.flags.insert(Flags::WANTS_WRITE);
        if stream.mark(Flags::IN_WRITABLE) {
            self.writable.push_back(id);
            self.is_write_round_over = false;
        }
    }

    /// For a stream that has more to send than flow control allows (RFC 9000 §4.1).
    pub(crate) fn report_blocked(&mut self, id: StreamId, stream: &mut Stream) {
        let needed = self.min_credit;
        if stream.send_credit() < needed && stream.blocked_at != Some(stream.send_limit) {
            stream.blocked_at = Some(stream.send_limit);
            self.owe(id, stream, Flags::OWES_STREAM_DATA_BLOCKED);
        }
        if self.send_credit() < needed && self.blocked_at != Some(self.send_limit) {
            self.blocked_at = Some(self.send_limit);
            self.owed |= Control::DATA_BLOCKED;
        }
    }

    /// The value for DATA_BLOCKED, if it still holds.
    pub(crate) fn blocked_at(&self) -> Option<u64> {
        self.blocked_at.filter(|&limit| limit == self.send_limit)
    }

    /// Less goes first.
    #[inline]
    fn rank(&self, id: StreamId, stream: &Stream, turn: u64) -> u64 {
        if stream.is_internal() {
            return 0;
        }
        let takes_turns = !self.has_priorities || stream.priority.is_incremental;
        let class = 2 * u64::from(stream.priority.urgency) + u64::from(takes_turns) + 1;
        class << 59 | if takes_turns { turn } else { id.index() } & ((1 << 59) - 1)
    }

    #[inline]
    fn mark_sendable(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::IN_SENDABLE) {
            self.turns += 1;
            stream.turn_end = stream.send.sent() + TURN_LEN;
            let rank = self.rank(id, stream, self.turns);
            self.sendable.push(Reverse((rank, id)));
        }
    }

    #[inline]
    pub(crate) fn has_frames(&self) -> bool {
        !(self.sendable.is_empty() && self.lost.is_empty() && self.owing.is_empty())
    }
}

impl Streams {
    pub(crate) fn on_max_data(&mut self, limit: u64) {
        let Self { table, state, .. } = self;
        if limit > state.send_limit {
            state.send_limit = limit;
            for id in core::mem::take(&mut state.stalled) {
                if let Some(stream) = table.get_mut(id) {
                    stream.flags.remove(Flags::IN_STALLED);
                    state.mark_sendable(id, stream);
                }
            }
        }
    }

    #[cold]
    fn sort_sendable(&mut self) {
        let Self { table, state, .. } = self;
        let mut entries = core::mem::take(&mut state.sendable).into_vec();
        for Reverse((rank, id)) in &mut entries {
            if let Some(stream) = table.get(*id) {
                *rank = state.rank(*id, stream, state.turns);
            }
        }
        state.sendable = entries.into();
    }

    /// At most once for a stream until [`State::start_write_round`].
    #[inline]
    pub(crate) fn poll_writable(&mut self) -> Option<Event> {
        let Self { table, state, .. } = self;
        while state.awaits_writes() {
            let streams = state.writable.iter().map(|&id| (id, table.get(id)));
            let mut waiting = (streams.enumerate())
                .filter(|(_, it)| it.1.is_none_or(|it| it.write_round != state.write_round));
            let next = match state.has_priorities {
                false => waiting.next(),
                true => waiting.min_by_key(|&(at, (id, stream))| {
                    stream.map(|stream| state.rank(id, stream, at as u64))
                }),
            };
            let Some((at, (id, _))) = next else {
                state.is_write_round_over = true;
                return None;
            };
            state.writable.remove(at);
            let stream = table.get_mut(id);
            let Some(stream) = stream else {
                continue;
            };
            stream.flags.remove(Flags::IN_WRITABLE);
            if stream.flags & (Flags::WANTS_WRITE | Flags::WRITE_DONE) != Flags::WANTS_WRITE {
                continue;
            }
            if stream.send_credit() < state.min_credit {
                state.report_blocked(id, stream);
                continue;
            }
            stream.flags.remove(Flags::WANTS_WRITE);
            stream.write_round = state.write_round;
            return Some(Event::Stream(id, stream.context, StreamEvent::Writable));
        }
        None
    }

    /// Says again what keeps us from sending.
    pub(crate) fn repeat_blocked(&mut self) {
        let Self { table, state, .. } = self;
        if state.blocked_at().is_some() {
            state.owed |= Control::DATA_BLOCKED;
        } else if let Some((id, stream)) = table.iter_mut().find(|(_, it)| {
            it.blocked_at == Some(it.send_limit)
                && !it.flags.intersects(Flags::RESET | Flags::FIN_SENT)
        }) {
            state.owe(id, stream, Flags::OWES_STREAM_DATA_BLOCKED);
        }
    }

    /// Writes frames that end before `out` has the length `end`.
    #[inline]
    pub(crate) fn write_owed_frames(&mut self, out: &mut Vec<u8>, end: usize, sent: &mut Frames) {
        while let Some(&id) = self.state.owing.front() {
            if let Some(stream) = self.table.get_mut(id) {
                let is_blocked = stream.flags.contains(Flags::OWES_STREAM_DATA_BLOCKED);
                self.state.has_reported_blocked |= is_blocked;
                if !write_owed_frames(id, stream, out, end, sent) {
                    return;
                }
                stream.flags.remove(Flags::IN_OWING);
            }
            self.state.owing.pop_front();
        }
    }

    #[inline]
    pub(crate) fn write_stream_frames(&mut self, out: &mut Vec<u8>, end: usize, sent: &mut Frames) {
        if core::mem::take(&mut self.has_new_priorities) {
            self.sort_sendable();
        }
        let Self { table, state, .. } = self;
        while let Some(&id) = state.lost.front() {
            if let Some(stream) = table.get_mut(id) {
                while let Some(lost) = stream.send.first_lost() {
                    if !write_stream_frame(id, stream, lost, out, end, sent) {
                        return;
                    }
                }
                stream.flags.remove(Flags::IN_LOST);
            }
            state.lost.pop_front();
        }
        while let Some(&Reverse((_, id))) = state.sendable.peek() {
            let Some(stream) = table.get_mut(id) else {
                state.sendable.pop();
                continue;
            };
            let (start, written) = (stream.send.sent(), stream.send.end());
            let allowed = (stream.send_limit).min(start + (state.send_limit - state.sent));
            let range = start..written.min(allowed).max(start);
            let has_frame = !range.is_empty() || start == written && stream.owes_fin();
            if has_frame && !write_stream_frame(id, stream, range.clone(), out, end, sent) {
                return;
            }
            let now_sent = stream.send.sent();
            state.sent += now_sent - start;
            state.unsent -= now_sent - start;
            if now_sent < range.end && now_sent < stream.turn_end {
                return;
            }
            state.sendable.pop();
            stream.flags.remove(Flags::IN_SENDABLE);
            if now_sent < range.end {
                state.mark_sendable(id, stream);
                return;
            }
            if now_sent < written {
                state.report_blocked(id, stream);
                if now_sent < stream.send_limit && stream.mark(Flags::IN_STALLED) {
                    state.stalled.push(id);
                }
            }
        }
    }

    #[inline]
    pub(crate) fn on_data_acked(&mut self, id: StreamId, range: Range<u64>, fin: bool) {
        let stream = self.table.get_mut(id);
        let Some(stream) = stream.filter(|it| !it.flags.contains(Flags::RESET)) else {
            return;
        };
        self.state.retained -= stream.send.on_acked(range);
        if fin {
            stream.flags.insert(Flags::FIN_ACKED);
        }
        if stream.flags.contains(Flags::FIN_ACKED) && stream.send.is_acked() {
            stream.flags.insert(Flags::SEND_DONE);
            self.remove_if_finished(id);
        }
    }

    pub(crate) fn on_reset_acked(&mut self, id: StreamId) {
        if let Some(stream) = self.table.get_mut(id) {
            stream.flags.insert(Flags::SEND_DONE);
            self.remove_if_finished(id);
        }
    }

    pub(crate) fn on_data_lost(&mut self, id: StreamId, range: Range<u64>, fin: bool) {
        let Some((stream, state)) = self.get_mut(id) else {
            return;
        };
        if stream.flags.intersects(Flags::RESET | Flags::SEND_DONE) {
            return;
        }
        if stream.flags.contains(Flags::STOPPED_BY_PEER) {
            return state.reset(id, stream, stream.stopped_code);
        }
        stream.send.on_lost(range);
        if stream.send.first_lost().is_some() && stream.mark(Flags::IN_LOST) {
            state.lost.push_back(id);
        }
        if fin && !stream.flags.contains(Flags::FIN_ACKED) {
            stream.flags.remove(Flags::FIN_SENT);
            state.mark_sendable(id, stream);
        }
    }

    pub(crate) fn on_owed_frame_lost(&mut self, id: StreamId, frame: Flags) {
        if let Some((stream, state)) = self.get_mut(id) {
            state.owe(id, stream, frame);
        }
    }
}

/// Returns false if there is not enough room.
fn write_owed_frames(
    id: StreamId,
    stream: &mut Stream,
    out: &mut Vec<u8>,
    end: usize,
    sent: &mut Frames,
) -> bool {
    let is_receiving = stream.final_size == UNKNOWN_SIZE;
    if stream.flags.contains(Flags::OWES_MAX_STREAM_DATA) {
        stream.receive_limit = (stream.consumed + stream.receive_window).min(MAX_VARINT);
    }
    for (flag, kind, is_relevant, value) in [
        (
            Flags::OWES_MAX_STREAM_DATA,
            kind::MAX_STREAM_DATA,
            is_receiving && !stream.flags.contains(Flags::READ_DONE),
            stream.receive_limit,
        ),
        (
            Flags::OWES_STREAM_DATA_BLOCKED,
            kind::STREAM_DATA_BLOCKED,
            stream.blocked_at == Some(stream.send_limit) && !stream.flags.contains(Flags::RESET),
            stream.send_limit,
        ),
        (
            Flags::OWES_RESET_STREAM,
            kind::RESET_STREAM,
            !stream.flags.contains(Flags::SEND_DONE),
            stream.reset_code,
        ),
        (
            Flags::OWES_STOP_SENDING,
            kind::STOP_SENDING,
            is_receiving,
            stream.stop_code,
        ),
    ] {
        if !stream.flags.contains(flag) {
            continue;
        }
        if is_relevant {
            if out.len() + MAX_OWED_FRAME_LEN > end {
                return false;
            }
            out.push(kind as u8);
            out.varint(id.0);
            out.varint(value);
            if kind == kind::RESET_STREAM {
                out.varint(stream.send.sent());
            }
            sent.push(SentFrame::Owed(id, flag));
        }
        stream.flags.remove(flag);
    }
    true
}

/// Writes as much of `range` as fits. Returns false if that is nothing.
#[inline]
fn write_stream_frame(
    id: StreamId,
    stream: &mut Stream,
    range: Range<u64>,
    out: &mut Vec<u8>,
    end: usize,
    sent: &mut Frames,
) -> bool {
    let (offset, available) = (range.start, range.end - range.start);
    let offset_len = if offset > 0 { varint_len(offset) } else { 0 };
    let Some(room) = end.checked_sub(out.len() + 1 + varint_len(id.0) + offset_len) else {
        return false;
    };
    let room = room as u64;
    let has_length = available < room;
    let len = match has_length {
        true => available.min(room.saturating_sub(varint_len(available) as u64)),
        false => room,
    };
    if len == 0 && available > 0 {
        return false;
    }
    let fin = stream.flags.contains(Flags::FIN) && offset + len == stream.send.end();
    let flag = |is_set, flag| if is_set { flag } else { 0 };
    out.push(
        kind::STREAM as u8
            | flag(offset > 0, stream_flag::OFFSET)
            | flag(has_length, stream_flag::LENGTH)
            | flag(fin, stream_flag::FIN),
    );
    out.varint(id.0);
    if offset > 0 {
        out.varint(offset);
    }
    if has_length {
        out.varint(len);
    }
    stream.send.send(offset..offset + len, out);
    if fin {
        stream.flags.insert(Flags::FIN_SENT);
    }
    sent.push(SentFrame::Stream {
        id,
        offset,
        len: len as u16,
        fin,
    });
    true
}
