//! One `node:http2` stream, and the table of a session's streams.

use std::cell::Cell;
use std::rc::Rc;

use bun_collections::HashMap;
use bun_http_types::h2::flow_control::{RecvWindow, SendWindow};
use bun_http_types::h2::frame::ErrorCode;
use bun_http_types::h2::stream::State;
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

/// Runs `f` on a copy of the cell's value and stores the result back.
#[inline]
pub(crate) fn update<T: Copy, R>(cell: &Cell<T>, f: impl FnOnce(&mut T) -> R) -> R {
    let mut value = cell.get();
    let result = f(&mut value);
    cell.set(value);
    result
}

pub(crate) struct Stream {
    pub state: Cell<State>,
    pub send_window: Cell<SendWindow>,
    pub recv_window: Cell<RecvWindow>,
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
}

impl Stream {
    pub(crate) fn new(state: State, initial_send: u32, initial_recv: u32) -> Self {
        Stream {
            state: Cell::new(state),
            send_window: Cell::new(SendWindow::new(initial_send)),
            recv_window: Cell::new(RecvWindow::new(initial_recv)),
            recv_final_headers: Cell::new(false),
            recv_host: Cell::new(false),
            content_length: Cell::new(None),
            recv_body_bytes: Cell::new(0),
            opened_after_goaway: Cell::new(false),
            request_method: Cell::new(None),
        }
    }

    /// The stream error that answers an inbound DATA frame, if the stream has to refuse it.
    pub(crate) fn data_refusal(&self, is_server: bool) -> Option<ErrorCode> {
        if !self.state.get().can_receive() {
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
}

/// Entries are shared, so a caller can hold one across JS that removes it from the table.
#[derive(Default)]
pub(crate) struct StreamTable {
    map: JsCell<HashMap<u32, Rc<Stream>>>,
}

impl StreamTable {
    #[inline]
    pub(crate) fn get(&self, id: u32) -> Option<Rc<Stream>> {
        self.map.get().get(&id).cloned()
    }

    #[inline]
    pub(crate) fn contains(&self, id: u32) -> bool {
        self.map.get().contains_key(&id)
    }

    pub(crate) fn insert(&self, id: u32, stream: Stream) -> Rc<Stream> {
        let stream = Rc::new(stream);
        self.map.with_mut(|map| map.insert(id, Rc::clone(&stream)));
        stream
    }

    pub(crate) fn remove(&self, id: u32) {
        let removed = self.map.with_mut(|map| map.remove(&id));
        drop(removed);
    }

    /// Calls `f` for every entry. `f` must not run JS or change the table.
    pub(crate) fn for_each(&self, mut f: impl FnMut(u32, &Stream)) {
        for (id, stream) in self.map.get().iter() {
            f(*id, stream);
        }
    }

    /// Drops the entries `keep` returns false for. `keep` must not run JS.
    pub(crate) fn retain(&self, mut keep: impl FnMut(&Stream) -> bool) {
        self.map
            .with_mut(|map| map.retain(|_, stream| keep(stream)));
    }
}
