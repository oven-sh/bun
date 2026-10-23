//! One `node:http2` stream, and the table of a session's streams.

use std::cell::Cell;
use std::collections::VecDeque;
use std::rc::Rc;

use bun_collections::HashMap;
use bun_http_types::h2::flow_control::{RecvWindow, SendWindow};
use bun_http_types::h2::frame::ErrorCode;
use bun_http_types::h2::stream::{Event, State, TransitionError, transition};
use bun_jsc::{JSGlobalObject, JSValue, StrongOptional};
use bun_ptr::JsCell;

/// Request methods that change how the response body is framed (nghttp2's METH_HEAD and METH_CONNECT flags).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum RequestMethod {
    Other,
    Head,
    Connect,
}

impl RequestMethod {
    pub(crate) fn from_method(value: &[u8]) -> Self {
        match value {
            b"HEAD" => RequestMethod::Head,
            b"CONNECT" => RequestMethod::Connect,
            _ => RequestMethod::Other,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResetBy {
    Peer,
    Us,
}

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum PaddingStrategy {
    #[default]
    None,
    Aligned,
    Max,
}

/// Runs `f` on a copy of the cell's value and stores the result back.
#[inline]
pub(crate) fn update<T: Copy, R>(cell: &Cell<T>, f: impl FnOnce(&mut T) -> R) -> R {
    let mut value = cell.get();
    let result = f(&mut value);
    cell.set(value);
    result
}

/// DATA that waits for a send window or for the socket.
#[derive(Default)]
pub(crate) struct PendingFrame {
    pub end_stream: bool,
    /// How much of `buffer` has been sent.
    pub offset: usize,
    pub buffer: Vec<u8>,
    /// The write callback, called once all of `buffer` has been sent.
    pub callback: StrongOptional,
}

impl PendingFrame {
    pub(crate) fn unsent(&self) -> &[u8] {
        &self.buffer[self.offset..]
    }
}

/// Both halves of a stream. Fields are cells, because JS run by a callback or a write can reach the same stream again.
pub(crate) struct Stream {
    pub id: u32,
    /// We opened it: a client's request or a server's push.
    pub is_local: bool,
    /// Only the table changes it, because it counts the open streams.
    state: Cell<State>,
    /// An RST_STREAM closed the stream. `Peer` once the peer has sent one, even after ours.
    pub reset: Cell<Option<ResetBy>>,
    /// The JS `Http2Stream`.
    pub js_context: JsCell<StrongOptional>,
    /// JS destroyed its `Http2Stream`.
    released: Cell<bool>,
    /// The handler that tells JS about the close has run, or is running for a close that JS asked for.
    pub close_delivered: Cell<bool>,
    /// `StreamTable::read_count` when the stream closed, or 0 if no read was being parsed.
    closed_in_read: Cell<u32>,

    pub recv_window: Cell<RecvWindow>,
    /// The JS readable is paused, so the receive window isn't replenished.
    pub reading_paused: Cell<bool>,
    /// A final header block arrived, so the next inbound HEADERS is a trailer section (RFC 9113 §8.1).
    pub recv_final_headers: Cell<bool>,
    /// The request had a `host`, so its trailer section can't have another.
    pub recv_host: Cell<bool>,
    /// Declared `content-length` of the inbound message (RFC 9113 §8.1.1).
    pub content_length: Cell<Option<u64>>,
    /// DATA octets received so far, without padding.
    pub recv_body_bytes: Cell<u64>,
    /// We had already sent GOAWAY when the peer opened this stream.
    pub opened_after_goaway: Cell<bool>,
    /// Client only: `:method` of the request this stream answers.
    pub request_method: Cell<Option<RequestMethod>>,

    pub send_window: Cell<SendWindow>,
    /// END_STREAM goes out on the trailers, not on the last DATA frame.
    pub wait_for_trailers: Cell<bool>,
    pub padding_strategy: Cell<PaddingStrategy>,
    pub queue: JsCell<VecDeque<PendingFrame>>,
}

impl Stream {
    pub(crate) fn new(
        id: u32,
        is_local: bool,
        state: State,
        initial_send: u32,
        initial_recv: u32,
    ) -> Self {
        Stream {
            id,
            is_local,
            state: Cell::new(state),
            reset: Cell::new(None),
            js_context: JsCell::new(StrongOptional::empty()),
            released: Cell::new(false),
            close_delivered: Cell::new(false),
            closed_in_read: Cell::new(0),
            recv_window: Cell::new(RecvWindow::new(initial_recv)),
            reading_paused: Cell::new(false),
            recv_final_headers: Cell::new(false),
            recv_host: Cell::new(false),
            content_length: Cell::new(None),
            recv_body_bytes: Cell::new(0),
            opened_after_goaway: Cell::new(false),
            request_method: Cell::new(None),
            send_window: Cell::new(SendWindow::new(initial_send)),
            wait_for_trailers: Cell::new(false),
            padding_strategy: Cell::new(PaddingStrategy::None),
            queue: JsCell::new(VecDeque::new()),
        }
    }

    #[inline]
    pub(crate) fn state(&self) -> State {
        self.state.get()
    }

    #[inline]
    pub(crate) fn is_closed(&self) -> bool {
        self.state.get() == State::Closed
    }

    /// Closed, and JS has no `Http2Stream` for it any more.
    fn is_forgettable(&self) -> bool {
        self.is_closed() && (self.released.get() || !self.js_context.get().has())
    }

    #[inline]
    pub(crate) fn was_reset(&self) -> bool {
        self.reset.get().is_some()
    }

    /// The state inbound frames are judged by. After both sides' END_STREAM the peer still owes what half-closed (remote) demands.
    pub(crate) fn inbound_state(&self) -> State {
        if self.is_closed() && !self.was_reset() {
            State::HalfClosedRemote
        } else {
            self.state.get()
        }
    }

    /// What JS handlers get as the stream: the `Http2Stream`, or the id while there's none.
    pub(crate) fn context(&self) -> JSValue {
        self.js_context
            .get()
            .get()
            .unwrap_or_else(|| JSValue::js_number(self.id as f64))
    }

    pub(crate) fn set_context(&self, value: JSValue, global: &JSGlobalObject) {
        self.js_context.set(StrongOptional::create(value, global));
    }

    /// The stream error that answers an inbound DATA frame, if the stream has to refuse it.
    pub(crate) fn data_refusal(&self, is_server: bool) -> Option<ErrorCode> {
        if !self.inbound_state().can_receive() {
            return Some(ErrorCode::STREAM_CLOSED);
        }
        // RFC 9113 §8.1: a response starts with HEADERS. nghttp2 ends the session here, fetch() resets the stream.
        if !is_server && !self.recv_final_headers.get() {
            return Some(ErrorCode::PROTOCOL_ERROR);
        }
        None
    }

    /// Returns true if the DATA received so far differs from the declared `content-length` (RFC 9113 §8.1.1).
    pub(crate) fn body_contradicts_content_length(&self) -> bool {
        self.content_length
            .get()
            .is_some_and(|declared| declared != self.recv_body_bytes.get())
    }

    /// Returns true if more DATA arrived than the declared `content-length`.
    pub(crate) fn body_exceeds_content_length(&self) -> bool {
        self.content_length
            .get()
            .is_some_and(|declared| self.recv_body_bytes.get() > declared)
    }

    /// The Pad Length of a frame with `frame_len` octets of content, which may grow to `max_len`.
    pub(crate) fn padding_for(&self, frame_len: usize, max_len: usize) -> u8 {
        match self.padding_strategy.get() {
            PaddingStrategy::None => 0,
            PaddingStrategy::Aligned => {
                let past_boundary = (frame_len + 9) % 8;
                if past_boundary == 0 {
                    return 0;
                }
                let padded_len = (frame_len + (8 - past_boundary)).min(max_len);
                padded_len.saturating_sub(frame_len).min(255) as u8
            }
            PaddingStrategy::Max => max_len.saturating_sub(frame_len).min(255) as u8,
        }
    }
}

/// A session's streams: the open ones, and the closed ones that JS still has an `Http2Stream` for. Entries are shared, so a caller can hold one across JS that removes it.
#[derive(Default)]
pub(crate) struct StreamTable {
    map: JsCell<HashMap<u32, Rc<Stream>>>,
    /// The entries that aren't closed, by who opened them (RFC 9113 §5.1.2).
    open_local: Cell<u32>,
    open_peer: Cell<u32>,
    /// The reads that are being parsed, one inside the other. Nothing is forgotten meanwhile.
    read_depth: Cell<u32>,
    read_count: Cell<u32>,
    /// `end_read` has entries to forget.
    has_forgettable: Cell<bool>,
}

impl StreamTable {
    #[inline]
    pub(crate) fn get(&self, id: u32) -> Option<Rc<Stream>> {
        self.map.get().get(&id).cloned()
    }

    /// The entry that judges an inbound frame. Once the read that closed a stream is over, its id does, like that of a forgotten one.
    pub(crate) fn inbound(&self, id: u32) -> Option<Rc<Stream>> {
        self.get(id).filter(|stream| {
            !stream.is_closed()
                || (self.is_reading() && stream.closed_in_read.get() == self.read_count.get())
        })
    }

    pub(crate) fn len(&self) -> usize {
        self.map.get().len()
    }

    pub(crate) fn open_local(&self) -> u32 {
        self.open_local.get()
    }

    pub(crate) fn open_peer(&self) -> u32 {
        self.open_peer.get()
    }

    fn open_count(&self, stream: &Stream) -> &Cell<u32> {
        if stream.is_local {
            &self.open_local
        } else {
            &self.open_peer
        }
    }

    pub(crate) fn insert(&self, stream: Stream) -> Rc<Stream> {
        let open = self.open_count(&stream);
        open.set(open.get() + 1);
        let stream = Rc::new(stream);
        self.map
            .with_mut(|map| map.insert(stream.id, Rc::clone(&stream)));
        stream
    }

    /// Moves `stream` through the state machine. An event that its state doesn't allow changes nothing.
    pub(crate) fn apply(&self, stream: &Stream, event: Event) -> Result<State, TransitionError> {
        let next = transition(stream.state.get(), event)?;
        if next == State::Closed {
            self.close(stream);
        } else {
            stream.state.set(next);
        }
        Ok(next)
    }

    /// Returns false if `stream` was closed already.
    pub(crate) fn close(&self, stream: &Stream) -> bool {
        if stream.state.replace(State::Closed) == State::Closed {
            return false;
        }
        let open = self.open_count(stream);
        open.set(open.get() - 1);
        if self.is_reading() {
            stream.closed_in_read.set(self.read_count.get());
        }
        self.forget_if_done(stream);
        true
    }

    /// JS destroyed its `Http2Stream`. Returns true if `stream` is closed.
    pub(crate) fn release(&self, stream: &Stream) -> bool {
        stream.released.set(true);
        self.forget_if_done(stream);
        stream.is_closed()
    }

    fn forget_if_done(&self, stream: &Stream) {
        if !stream.is_forgettable() {
            return;
        }
        if self.is_reading() {
            self.has_forgettable.set(true);
        } else {
            self.map.with_mut(|map| map.remove(&stream.id));
        }
    }

    pub(crate) fn is_reading(&self) -> bool {
        self.read_depth.get() > 0
    }

    pub(crate) fn begin_read(&self) {
        if !self.is_reading() {
            self.read_count
                .set(self.read_count.get().wrapping_add(1).max(1));
        }
        self.read_depth.set(self.read_depth.get() + 1);
    }

    pub(crate) fn end_read(&self) {
        self.read_depth.set(self.read_depth.get() - 1);
        if !self.is_reading() && self.has_forgettable.replace(false) {
            self.map
                .with_mut(|map| map.retain(|_, stream| !stream.is_forgettable()));
        }
    }

    /// Forgets every stream, open or not.
    pub(crate) fn clear(&self) {
        drop(self.map.take());
        self.open_local.set(0);
        self.open_peer.set(0);
        self.has_forgettable.set(false);
    }

    /// Every entry, for a loop that runs JS. A stream added meanwhile isn't visited.
    pub(crate) fn snapshot(&self) -> Vec<Rc<Stream>> {
        self.map.get().values().cloned().collect()
    }

    /// Calls `f` for every entry. `f` must not run JS or change the table.
    pub(crate) fn for_each(&self, mut f: impl FnMut(&Stream)) {
        for stream in self.map.get().values() {
            f(stream);
        }
    }
}
