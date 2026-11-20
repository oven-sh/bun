use super::stream::UNKNOWN_SIZE;
use super::{Flags, Role, State, Stream};
use crate::coding::MAX_VARINT;
use crate::connection::sent::Control;
use crate::error::{Error, Result, transport_code};
use crate::event::{Event, StreamEvent};
use crate::http3::Http3;
use crate::stream_id::StreamId;

const MAX_READY_HINT: usize = 256 * 1024;
const TOO_MANY_GAPS: Error =
    Error::transport(transport_code::INTERNAL_ERROR, "too many gaps in a stream");

impl Stream {
    #[inline]
    pub(crate) fn is_read_to_end(&self) -> bool {
        self.read == self.final_size
    }

    /// For bytes at `offset` that cannot be used yet.
    pub(crate) fn keep(&mut self, offset: u64, data: &[u8]) -> Result {
        self.kept.insert(offset, data).map_err(|_| TOO_MANY_GAPS)
    }

    /// For after [`Self::take_kept`].
    #[inline]
    pub(crate) fn check_kept(&self) -> Result {
        self.kept.check().map_err(|_| TOO_MANY_GAPS)
    }

    /// Takes bytes that were kept, and returns how many of them have been read.
    #[inline]
    pub(crate) fn take_kept(&mut self) -> Option<(usize, Vec<u8>)> {
        let (offset, chunk) = self.kept.pop(self.read)?;
        Some(((self.read - offset) as usize, chunk))
    }

    #[inline]
    pub(crate) fn has_kept(&self) -> bool {
        !self.kept.is_empty()
    }

    /// For when what is left of it is not going to be read.
    pub(crate) fn abandon_message(&mut self, id: StreamId, http3: Option<&mut Http3>) {
        let is_read_to_end = self.is_read_to_end();
        if let (Role::Message(message), Some(http3)) = (&mut self.role, http3)
            && !self.flags.contains(Flags::READ_DONE)
        {
            message.abandon(id, is_read_to_end, http3);
        }
    }

    pub(crate) fn has_received(&self) -> bool {
        self.received > 0 || self.flags.contains(Flags::READ_DONE)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.received == 0
    }

    #[inline]
    pub(crate) fn read_offset(&self) -> u64 {
        self.read
    }

    #[inline]
    pub(crate) fn advance(&mut self, len: usize) {
        self.read += len as u64;
    }

    /// The role, and where bytes for the application go.
    #[inline]
    pub(crate) fn reader(&mut self) -> (&mut Role, Ready<'_>) {
        let ready = Ready {
            bytes: &mut self.ready,
            hint: self.ready_hint,
        };
        (&mut self.role, ready)
    }

    #[inline]
    pub(crate) fn has_ready(&self) -> bool {
        !self.ready.is_empty()
    }

    #[inline]
    pub(crate) fn take_ready(&mut self) -> Vec<u8> {
        self.ready_hint = self.ready.len().min(MAX_READY_HINT);
        core::mem::take(&mut self.ready)
    }
}

pub(crate) struct Ready<'a> {
    bytes: &'a mut Vec<u8>,
    hint: usize,
}

impl Ready<'_> {
    #[inline]
    pub(crate) fn push(&mut self, data: &[u8]) {
        if self.bytes.capacity() == 0 && !data.is_empty() {
            self.bytes.reserve_exact(self.hint.max(data.len()));
        }
        self.bytes.extend_from_slice(data);
    }

    #[inline]
    pub(crate) fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }
}

impl State {
    /// RFC 9000 §4.1 and §4.5.
    #[inline]
    fn account(&mut self, stream: &mut Stream, end: u64, is_final: bool) -> Result {
        if end > stream.final_size || is_final && end < stream.received {
            return Err(Error::transport(
                transport_code::FINAL_SIZE_ERROR,
                "final size of a stream changed",
            ));
        }
        if end > stream.received {
            let received = self.received + (end - stream.received);
            if end > stream.receive_limit || received > self.receive_limit {
                return Err(Error::transport(
                    transport_code::FLOW_CONTROL_ERROR,
                    "flow control violation",
                ));
            }
            (self.received, stream.received) = (received, end);
        }
        if is_final {
            stream.final_size = end;
        }
        Ok(())
    }

    /// Returns what can be read now, which may be just the end.
    #[inline]
    pub(crate) fn on_stream<'a>(
        &mut self,
        id: StreamId,
        stream: &mut Stream,
        offset: u64,
        data: &'a [u8],
        fin: bool,
    ) -> Result<Option<&'a [u8]>> {
        self.misses_data |= offset > stream.received;
        self.account(stream, offset + data.len() as u64, fin)?;
        if stream.flags.contains(Flags::READ_DONE) {
            self.credit(id, stream);
            return Ok(None);
        }
        let Some(known) = stream.read.checked_sub(offset) else {
            return stream.keep(offset, data).map(|()| None);
        };
        let new = data.get(known as usize..);
        Ok(new.filter(|new| fin || !new.is_empty()))
    }

    pub(crate) fn on_reset_stream(
        &mut self,
        id: StreamId,
        stream: &mut Stream,
        code: u64,
        final_size: u64,
    ) -> Result {
        self.account(stream, final_size, true)?;
        if stream.mark(Flags::RESET_BY_PEER) && !stream.flags.contains(Flags::STOPPED) {
            self.notify(id, stream, StreamEvent::Reset(code));
        }
        stream.held = 0;
        self.finish_reading(id, stream);
        Ok(())
    }

    /// Asks the peer to stop sending, unless it has.
    pub(crate) fn stop(&mut self, id: StreamId, stream: &mut Stream, code: u64) {
        if !stream.flags.contains(Flags::READ_DONE) && stream.final_size == UNKNOWN_SIZE {
            stream.stop_code = code.min(MAX_VARINT);
            self.owe(id, stream, Flags::OWES_STOP_SENDING);
        }
        stream.flags.insert(Flags::STOPPED);
        stream.held = 0;
        self.finish_reading(id, stream);
    }

    #[inline]
    pub(crate) fn finish_reading(&mut self, id: StreamId, stream: &mut Stream) {
        if stream.mark(Flags::READ_DONE) {
            stream.kept = Default::default();
            stream.ready = Vec::new();
        }
        self.credit(id, stream);
        self.close_if_done(id, stream);
    }

    /// Lets the peer send as much as has been consumed (RFC 9000 §4.2).
    #[inline]
    pub(crate) fn credit(&mut self, id: StreamId, stream: &mut Stream) {
        let is_discarding = stream.flags.contains(Flags::READ_DONE);
        let in_order = match is_discarding {
            true => stream.received,
            false => stream.read,
        };
        let consumed = in_order - stream.ready.len() as u64 - stream.held;
        let counted = match self.limits_unread_data {
            true => consumed,
            false => in_order,
        };
        self.consumed += counted - core::mem::replace(&mut stream.counted, counted);
        stream.consumed = consumed;
        if !is_discarding
            && stream.final_size == UNKNOWN_SIZE
            && is_worth_raising(stream.receive_limit, consumed, stream.receive_window)
        {
            self.owe(id, stream, Flags::OWES_MAX_STREAM_DATA);
        }
        let (limit, window) = (self.receive_limit, self.receive_window);
        // The streams that are not being read can hold most of the window.
        let is_short = self.consumed + window > limit + (limit - self.received).max(window / 64);
        if is_worth_raising(limit, self.consumed, window) || is_short && limit < MAX_VARINT {
            self.owed |= Control::MAX_DATA;
        }
    }

    pub(crate) fn is_peer_short_of_credit(&self, stream: &Stream) -> bool {
        self.receive_limit - self.received < self.receive_window / 8
            || stream.receive_limit - stream.received < stream.receive_window / 8
    }

    /// The peer can do with less than is usually worth a frame.
    pub(crate) fn on_data_blocked(&mut self, limit: u64) {
        if limit == self.receive_limit && self.consumed + self.receive_window > limit {
            self.owed |= Control::MAX_DATA;
        }
    }

    /// Likewise.
    pub(crate) fn on_stream_data_blocked(&mut self, id: StreamId, stream: &mut Stream, limit: u64) {
        if limit == stream.receive_limit
            && stream.consumed + stream.receive_window > limit
            && !stream.flags.contains(Flags::READ_DONE)
        {
            self.owe(id, stream, Flags::OWES_MAX_STREAM_DATA);
        }
    }

    /// Returns the value for MAX_DATA.
    pub(crate) fn raise_receive_limit(&mut self) -> u64 {
        self.receive_limit = (self.consumed + self.receive_window).min(MAX_VARINT);
        self.receive_limit
    }

    #[inline]
    pub(crate) fn mark_readable(&mut self, id: StreamId, stream: &mut Stream) {
        if !stream.flags.contains(Flags::PAUSED) && stream.mark(Flags::IN_READABLE) {
            self.readable.push_back(id);
        }
    }

    #[inline]
    pub(crate) fn first_readable(&self) -> Option<StreamId> {
        self.readable.front().copied()
    }

    #[inline]
    pub(crate) fn pop_readable(&mut self, stream: Option<&mut Stream>) {
        self.readable.pop_front();
        stream.map(|stream| stream.take(Flags::IN_READABLE));
    }

    pub(crate) fn forget_readable(&mut self) {
        self.readable.clear();
    }

    pub(crate) fn forget_events(&mut self) {
        (self.events).retain(|it| matches!(it, Event::Stream(_, _, StreamEvent::Closed)));
        self.forget_readable();
    }
}

#[inline]
fn is_worth_raising(limit: u64, consumed: u64, window: u64) -> bool {
    limit - consumed < window - window / 4 && limit < MAX_VARINT
}
