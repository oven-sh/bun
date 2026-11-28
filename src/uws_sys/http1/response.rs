use core::ffi::c_void;
use core::ptr;

use bun_core::fmt::{ItoaBuf, itoa};
use bun_core::strings::eql_case_insensitive_ascii_check_length as eql_ignoring_case;
use bun_http1::request::RequestParser;

use super::{OnData, OnEvent, OnWritable};
use crate::async_socket::{MAX_CORKED_WRITE_LEN, Rest, Written};
use crate::response::{State, WriteResult};
use crate::uws_res;

const NOT_CHUNKED: State = (State::HTTP_WROTE_CONTENT_LENGTH_HEADER)
    .union(State::HTTP_ANCIENT_REQUEST)
    .union(State::HTTP_CLOSE_DELIMITED);

fn chunk_head(out: &mut [u8; 10], mut len: u32) -> &[u8] {
    let (digits, line_end) = out.split_at_mut(8);
    line_end.copy_from_slice(b"\r\n");
    let mut start = digits.len();
    for digit in digits.iter_mut().rev() {
        *digit = b"0123456789abcdef"[len as usize & 15];
        start -= 1;
        len >>= 4;
        if len == 0 {
            break;
        }
    }
    &out[start..]
}

impl uws_res {
    pub(crate) fn state(&self) -> State {
        self.connection().state.get()
    }

    pub(crate) fn has_responded(&self) -> bool {
        !self.state().is_response_pending()
    }

    pub fn should_close_connection(&self) -> bool {
        self.state().is_http_connection_close()
    }

    /// Valid after the close callback: uSockets frees a closed socket only when the outermost tick ends.
    pub(crate) fn is_closed(&self) -> bool {
        self.raw().is_closed()
    }

    /// False if the socket is closed or already sent its FIN / close_notify.
    pub(crate) fn can_upgrade(&self) -> bool {
        !self.is_closed() && !self.raw().is_shutdown()
    }

    pub(crate) fn is_connect_request(&self) -> bool {
        self.connection().is_tunnel()
    }

    pub(crate) fn take_request_trailers(&self) -> Vec<u8> {
        if self.is_closed_or_upgraded() {
            return Vec::new();
        }
        self.connection().with_parser(RequestParser::take_trailers)
    }

    pub fn timeout(&self, seconds: u8) {
        self.connection().idle_timeout.set(seconds);
        self.reset_timeout();
    }

    pub(crate) fn reset_timeout(&self) {
        (self.raw()).set_timeout(self.connection().idle_timeout.get().into());
    }

    pub(crate) fn pause(&self) {
        if !self.is_closed() {
            self.raw().pause();
            self.raw().set_timeout(0);
        }
    }

    pub(crate) fn resume(&self) {
        if !self.is_closed() {
            self.raw().resume();
            self.reset_timeout();
        }
    }

    pub(crate) fn is_corked(&self) -> bool {
        self.socket().is_corked()
    }

    pub(crate) fn uncork(&self) {
        self.socket().uncork();
    }

    /// Sends what the cork buffer holds for this socket. The socket stays corked.
    pub fn send_corked(&self) {
        self.socket().send_corked();
    }

    /// Marks the response in flight as one that user JavaScript produces. It is sent when it completes.
    pub fn send_when_complete(&self) {
        self.connection().mark(State::HTTP_SEND_WHEN_COMPLETE);
    }

    /// Run `f` while the response is corked.
    pub(crate) fn corked<F: FnOnce()>(&self, f: F) {
        if self.is_corked() {
            return f();
        }
        self.socket().cork();
        f();
        // Else it was sent, or a WebSocket has the socket.
        if self.is_corked() {
            self.uncork_and_close_if_done();
        }
    }

    pub(crate) fn run_corked_with_type<U>(&self, handler: fn(&U), data: &U) {
        self.corked(|| handler(data));
    }

    pub(super) fn uncork_and_close_if_done(&self) {
        let written = self.socket().uncork();
        if written.len != 0 || written.has_backpressure {
            self.reset_timeout();
        }
        self.close_if_done();
    }

    pub(crate) fn get_buffered_amount(&self) -> u64 {
        self.socket().buffered_amount() as u64
    }

    /// `get_buffered_amount() == 0` and, for TLS, no ciphertext batch tail left in userspace.
    pub(crate) fn has_fully_drained(&self) -> bool {
        self.socket().has_fully_drained()
    }

    pub(crate) fn mark_needs_more(&self) {
        if !self.is_ssl() {
            self.raw().send_file_needs_more();
        }
    }

    pub(crate) fn mark_wrote_content_length_header(&self) {
        (self.connection()).mark(State::HTTP_WROTE_CONTENT_LENGTH_HEADER);
    }

    pub(crate) fn mark_wrote_date_header(&self) {
        self.connection().mark(State::HTTP_WROTE_DATE_HEADER);
    }

    pub(crate) fn write_continue(&self) {
        self.write_informational(b"HTTP/1.1 100 Continue\r\n\r\n");
    }

    pub(crate) fn write_informational(&self, data: &[u8]) {
        self.socket().write(data);
    }

    #[inline]
    pub fn write_status(&self, status: &[u8]) {
        if !self.connection().has(State::HTTP_STATUS_CALLED) {
            self.write_status_line(status);
        }
    }

    fn write_status_line(&self, status: &[u8]) {
        let connection = self.connection();
        // RFC 9110 §8.6
        if let [b'1', _, _] | [b'1', _, _, b' ', ..] | b"204" | [b'2', b'0', b'4', b' ', ..] =
            status
        {
            connection.mark(State::HTTP_NO_BODY_STATUS);
        }
        connection.mark(State::HTTP_STATUS_CALLED);
        self.socket().write_all([b"HTTP/1.1 ", status, b"\r\n"]);
    }

    pub fn write_header(&self, key: &[u8], value: &[u8]) {
        self.write_status(b"200 OK");
        self.socket().write_all([key, b": ", value, b"\r\n"]);
    }

    pub fn write_header_int(&self, key: &[u8], value: u64) {
        self.write_status(b"200 OK");
        if !self.connection().has(State::HTTP_NO_BODY_STATUS)
            || !eql_ignoring_case(key, b"content-length")
        {
            self.write_header(key, itoa(&mut ItoaBuf::new(), value));
        }
    }

    pub(crate) fn write_mark(&self) {
        if !self.connection().has(State::HTTP_WROTE_DATE_HEADER) {
            self.write_header(b"Date", &self.socket().loop_data().date.get());
            self.mark_wrote_date_header();
        }
    }

    /// Before the first part of a body that is streamed.
    fn end_head(&self, is_chunked: bool) {
        let connection = self.connection();
        if connection.has(State::HTTP_WRITE_CALLED) {
            return;
        }
        self.write_mark();
        if is_chunked && !connection.has(State::HTTP_WROTE_TRANSFER_ENCODING_HEADER) {
            self.write_header(b"Transfer-Encoding", b"chunked");
        }
        self.socket().write(b"\r\n");
        connection.mark(State::HTTP_WRITE_CALLED);
    }

    pub(crate) fn flush_headers(&self, flush_immediately: bool) {
        self.write_status(b"200 OK");
        self.end_head(!(self.connection()).has(NOT_CHUNKED | State::HTTP_NO_BODY_STATUS));
        if flush_immediately {
            self.uncork();
        }
    }

    pub(crate) fn prepare_for_sendfile(&self) {
        self.write_mark();
        self.socket().append(2, |mut out| out.append(b"\r\n"));
        self.uncork();
    }

    pub(crate) fn write(&self, data: &[u8]) -> WriteResult {
        if (1..MAX_CORKED_WRITE_LEN).contains(&data.len()) {
            self.socket().cork();
        }
        let written = self.write_body(data, b"\r\n");
        match written.has_backpressure {
            true => WriteResult::Backpressure(written.len),
            false => WriteResult::WantMore(written.len),
        }
    }

    fn write_body(&self, data: &[u8], after_chunk: &[u8]) -> Written {
        self.write_status(b"200 OK");
        let mut total = Written {
            len: 0,
            has_backpressure: false,
        };
        let mut chunks = data.chunks(u32::MAX as usize);
        while let Some(chunk) = chunks.next() {
            let is_chunked = !self.connection().has(NOT_CHUNKED);
            self.end_head(is_chunked);
            let mut head = [0; 10];
            let (head, tail) = match (is_chunked, chunks.len()) {
                (false, _) => (&b""[..], &b""[..]),
                (true, 0) => (chunk_head(&mut head, chunk.len() as u32), after_chunk),
                (true, _) => (chunk_head(&mut head, chunk.len() as u32), &b"\r\n"[..]),
            };
            let written = self.socket().write_framed(head, chunk, tail, Rest::Buffer);
            self.reset_timeout();
            total.len += written.len;
            total.has_backpressure |= written.has_backpressure;
        }
        total
    }

    /// Returns how much was taken. The caller keeps the rest, for a call that `is_first` is false in.
    pub(crate) fn try_write_body(&self, data: &[u8], is_first: bool) -> usize {
        let is_chunked = !self.connection().has(NOT_CHUNKED);
        if is_first {
            self.write_status(b"200 OK");
            self.end_head(is_chunked);
        }
        let mut head = [0; 10];
        let head = match is_first && is_chunked {
            true => chunk_head(&mut head, data.len() as u32),
            false => b"",
        };
        let tail: &[u8] = if is_chunked { b"\r\n" } else { b"" };
        let written = (self.socket()).write_framed(head, data, tail, Rest::LeaveToCaller);
        self.reset_timeout();
        written.len
    }

    /// Buffers what `try_write_body` did not take.
    pub(crate) fn spill_body(&self, data: &[u8]) {
        if !data.is_empty() {
            self.socket().write(data);
        }
        if !self.connection().has(NOT_CHUNKED) {
            self.socket().write(b"\r\n");
        }
    }

    pub fn end(&self, data: &[u8], close_connection: bool) {
        let connection = self.connection();
        connection.clear_response_handlers();
        let adds_content_length = if connection.has(State::HTTP_NO_BODY_STATUS) {
            false
        } else if connection.has(State::HTTP_CLOSE_DELIMITED) {
            connection.mark(State::HTTP_CONNECTION_CLOSE);
            false
        } else if connection.has(State::HTTP_WROTE_TRANSFER_ENCODING_HEADER) {
            if !connection.has(NOT_CHUNKED | State::HTTP_WRITE_CALLED) {
                self.write_status(b"200 OK");
                self.end_head(true);
            }
            false
        } else {
            !connection.has(State::HTTP_WROTE_CONTENT_LENGTH_HEADER)
        };
        self.finish(data, 0, Rest::Buffer, adds_content_length, close_connection);
    }

    pub(crate) fn try_end(&self, data: &[u8], total: usize, close_connection: bool) -> bool {
        let rest = Rest::LeaveToCaller;
        let is_written = self.finish(data, total as u64, rest, true, close_connection);
        if is_written {
            self.connection().clear_response_handlers();
        }
        is_written
    }

    pub(crate) fn end_stream(&self, close_connection: bool) {
        let connection = self.connection();
        connection.clear_response_handlers();
        self.write_status(b"200 OK");
        if !connection.has(State::HTTP_WROTE_CONTENT_LENGTH_HEADER) {
            self.end_head(true);
        }
        if connection.has(State::HTTP_CLOSE_DELIMITED) {
            connection.mark(State::HTTP_CONNECTION_CLOSE);
        }
        self.finish(b"", 0, Rest::Buffer, false, close_connection);
    }

    /// The caller may go on using the response: it does not close the socket.
    pub fn end_without_body(&self, close_connection: bool) {
        let connection = self.connection();
        let is_in_head = !connection.has(State::HTTP_WRITE_CALLED | State::HTTP_END_CALLED);
        if close_connection {
            if is_in_head && !connection.has(State::HTTP_CONNECTION_CLOSE) {
                self.write_header(b"Connection", b"close");
            }
            connection.mark(State::HTTP_CONNECTION_CLOSE);
        }
        if is_in_head {
            self.socket().write(b"\r\n");
        }
        connection.mark(State::HTTP_END_CALLED);
        connection.end_response();
        self.reset_timeout();
    }

    pub(crate) fn end_send_file(&self, write_offset: u64, _close_connection: bool) {
        let connection = self.connection();
        connection.http().offset.set(write_offset);
        connection.mark(State::HTTP_END_CALLED);
        connection.end_response();
        self.reset_timeout();
    }

    /// `total_len` is 0 if `data` is all of the body. False on backpressure.
    fn finish(
        &self,
        mut data: &[u8],
        mut total_len: u64,
        rest: Rest,
        mut adds_content_length: bool,
        close_connection: bool,
    ) -> bool {
        self.write_status(b"200 OK");
        let (socket, connection) = (self.socket(), self.connection());
        if connection.has(State::HTTP_NO_BODY_STATUS) {
            (data, total_len, adds_content_length) = (b"", 0, false);
        } else if total_len == 0 {
            total_len = data.len() as u64;
        }
        if close_connection && !connection.has(State::HTTP_END_CALLED) {
            if !connection.has(State::HTTP_CONNECTION_CLOSE | State::HTTP_WRITE_CALLED) {
                self.write_header(b"Connection", b"close");
            }
            connection.mark(State::HTTP_CONNECTION_CLOSE);
        }
        if connection.has(State::HTTP_WRITE_CALLED | State::HTTP_NODE_HAS_RESPONSE_TRAILERS)
            && !connection.has(NOT_CHUNKED | State::HTTP_NO_BODY_STATUS)
        {
            self.finish_chunked(data);
            return true;
        }

        if !connection.has(State::HTTP_END_CALLED | State::HTTP_WRITE_CALLED) {
            self.write_mark();
            if adds_content_length {
                let mut digits = ItoaBuf::new();
                let digits = itoa(&mut digits, total_len);
                socket.write_all([b"Content-Length: ", digits, b"\r\n\r\n"]);
                self.mark_wrote_content_length_header();
            } else {
                socket.write(b"\r\n");
            }
        }
        connection.mark(State::HTTP_END_CALLED);

        let mut is_written = true;
        // An empty write would try to send the buffer.
        if !data.is_empty() {
            let written = socket.write_with(data, rest, 0);
            (connection.http().offset).update(|offset| offset + written.len as u64);
            is_written = written.len == data.len() && !written.has_backpressure;
        }
        self.reset_timeout();
        if connection.http().offset.get() == total_len {
            self.complete();
        }
        is_written
    }

    fn finish_chunked(&self, data: &[u8]) {
        let connection = self.connection();
        self.end_head(true);
        if connection.has(State::HTTP_NODE_HAS_RESPONSE_TRAILERS) {
            self.write_body(data, b"\r\n");
            self.socket().write(&connection.http().last_chunk.take());
            connection.unmark(State::HTTP_NODE_HAS_RESPONSE_TRAILERS);
        } else if data.is_empty() {
            self.socket().write(b"0\r\n\r\n");
        } else {
            self.write_body(data, b"\r\n0\r\n\r\n");
        }
        if !self.complete() {
            self.reset_timeout();
        }
    }

    /// True if that closed the socket.
    pub(super) fn complete(&self) -> bool {
        let connection = self.connection();
        connection.end_response();
        let is_being_read = self.is_being_read();
        if !self.is_corked() {
            // The rest of the read can be the body of the request.
            return !(is_being_read && connection.is_node.get()) && self.close_if_done();
        }
        if !is_being_read {
            self.uncork();
            return self.close_if_done();
        }
        // What needed no JavaScript is sent with the other responses to this read.
        if connection.is_node.get() || connection.has(State::HTTP_SEND_WHEN_COMPLETE) {
            self.uncork();
        }
        false
    }

    #[inline]
    pub(super) fn close_if_done(&self) -> bool {
        self.connection().closes_after_response() && self.close_if_sent()
    }

    fn close_if_sent(&self) -> bool {
        let is_sent = self.has_responded() && self.has_fully_drained();
        if is_sent {
            self.shut_down_and_close();
        }
        is_sent
    }

    /// The close keeps a client from sending more.
    pub(super) fn shut_down_and_close(&self) {
        self.raw().shutdown();
        self.socket().close();
    }

    /// For what ends with `end_without_body` or `end_send_file`, outside of `corked`.
    pub(crate) fn close_if_done_and_marked(&self) {
        if !self.is_closed() && !self.is_corked() {
            self.close_if_done();
        }
    }

    pub(crate) fn close_if_idle(&self) -> bool {
        let connection = self.connection();
        if !connection.is_idle.get() {
            return false;
        }
        if connection.is_node.get() {
            let is_request_open = connection.http().request_start_ms.get() != 0;
            // In the handler of a request, the parser has not begun a chunked body yet.
            if is_request_open && connection.on_data.get().is_some()
                || connection.is_receiving_request()
            {
                return false;
            }
            if is_request_open && !self.has_fully_drained() {
                self.close_when_idle();
                return false;
            }
        }
        self.socket().close();
        true
    }

    pub(crate) fn close_when_idle(&self) {
        self.connection().mark(State::HTTP_CLOSE_WHEN_IDLE);
    }

    pub(crate) fn set_on_writable(&self, handler: OnWritable, user_data: *mut c_void) {
        self.connection().writable_user_data.set(user_data);
        self.connection().on_writable.set(Some(handler));
    }

    pub(crate) fn clear_on_writable(&self) {
        self.connection().on_writable.set(None);
        self.connection().writable_user_data.set(ptr::null_mut());
    }

    pub(crate) fn set_on_aborted(&self, handler: OnEvent, user_data: *mut c_void) {
        if !self.is_closed() {
            self.connection().user_data.set(user_data);
            self.connection().on_aborted.set(Some(handler));
        }
    }

    pub(crate) fn clear_aborted(&self) {
        if !self.is_closed() {
            self.connection().on_aborted.set(None);
        }
    }

    pub(crate) fn set_on_timeout(&self, handler: OnEvent, user_data: *mut c_void) {
        if !self.is_closed() {
            self.connection().user_data.set(user_data);
            self.connection().on_timeout.set(Some(handler));
        }
    }

    pub(crate) fn clear_timeout(&self) {
        self.connection().on_timeout.set(None);
    }

    pub(crate) fn set_on_data(&self, handler: Option<OnData>, user_data: *mut c_void) {
        if !self.is_closed() {
            self.connection().user_data.set(user_data);
            self.connection().on_data.set(handler);
            self.connection().received_since_timeout.set(0);
        }
    }

    pub(crate) fn clear_on_data(&self) {
        self.set_on_data(None, ptr::null_mut());
    }

    /// Removes the handlers that were attached with `user_data`. Those of another owner stay.
    pub(crate) fn clear_handlers_of(&self, user_data: *mut c_void) {
        if self.is_closed() {
            return;
        }
        let connection = self.connection();
        if connection.writable_user_data.get() == user_data {
            self.clear_on_writable();
        }
        if connection.user_data.get() == user_data {
            connection.on_aborted.set(None);
            connection.on_timeout.set(None);
            connection.on_data.set(None);
            connection.user_data.set(ptr::null_mut());
        }
    }
}
