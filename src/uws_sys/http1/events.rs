use core::ffi::{c_int, c_void};
use core::sync::atomic::Ordering;

use bun_boringssl_sys::{SSL_SENT_SHUTDOWN, SSL_get_shutdown};
use bun_http_types::h2::CLIENT_PREFACE;
use bun_http1::request::{self, Outcome, Request, RequestError, RequestParser};

use super::{Connection, Handshake, node};
use crate::app::{BUN_DEFAULT_MAX_HTTP_HEADER_SIZE, ConnectionChange, Context, Http2};
use crate::response::State;
use crate::socket_group::VTable;
use crate::{CloseCode, us_bun_verify_error_t, us_socket_t, uws_res, web_socket};

/// A slower upload times out.
const MIN_RECEIVED_PER_SECOND: u32 = 16 * 1024;
/// Next to those of `RequestError`.
const INVALID_EOF: u8 = 8;

pub(crate) static TCP: VTable = vtable::<false, false>();
pub(crate) static TLS: VTable = vtable::<true, false>();
pub(crate) static NODE_TCP: VTable = vtable::<false, true>();
pub(crate) static NODE_TLS: VTable = vtable::<true, true>();

const fn vtable<const SSL: bool, const IS_NODE: bool>() -> VTable {
    VTable {
        on_open: Some(on_open::<IS_NODE>),
        on_data: Some(on_data::<IS_NODE>),
        on_fd: None,
        on_writable: Some(on_writable::<IS_NODE>),
        on_close: Some(on_close::<IS_NODE>),
        on_timeout: Some(on_timeout),
        on_long_timeout: None,
        on_end: Some(if IS_NODE { on_node_end } else { on_end }),
        on_connect_error: None,
        on_connecting_error: None,
        on_handshake: if SSL { Some(on_handshake) } else { None },
    }
}

extern "C" fn on_open<const IS_NODE: bool>(
    socket: *mut us_socket_t,
    _: c_int,
    _: *mut u8,
    _: c_int,
) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    let max_head_len = BUN_DEFAULT_MAX_HTTP_HEADER_SIZE.load(Ordering::Relaxed);
    let connection = Connection::new(IS_NODE, max_head_len);
    // SAFETY: the listener was given its size.
    unsafe { core::ptr::write(res.raw().ext_ptr().cast(), connection) };
    res.reset_timeout();
    if IS_NODE {
        res.connection().http().request_start_ms.set(node::now_ms());
        // The responses that hold the reads never drain after a hangup.
        res.raw().set_hangup_closes_unsent();
    }
    // The end event decides whether to go on writing.
    res.raw().set_allows_half_open(true);
    res.context().report(ConnectionChange::Accepted);
    if IS_NODE && !res.is_ssl() {
        res.report_open();
    }
    socket
}

extern "C" fn on_handshake(
    socket: *mut us_socket_t,
    success: c_int,
    error: us_bun_verify_error_t,
    _: *mut c_void,
) {
    let res = uws_res::of(socket);
    // A second one reports that the session failed, and the close follows.
    if res.is_closed() || res.connection().http().handshake.get() != Handshake::Pending {
        return;
    }
    let handshake = match (success, error.error_no) {
        (0, _) => Handshake::Failed,
        (_, 0) => Handshake::Verified,
        _ => Handshake::Complete,
    };
    let context = res.context();
    if handshake != Handshake::Verified
        && (context.rejects_unauthorized || res.raw().server_name_rejects_unauthorized())
    {
        return res.raw().close(CloseCode::normal);
    }
    res.connection().http().handshake.set(handshake);
    res.connection().http().verify_error.set(error.code);
    res.reset_timeout();
    if res.connection().is_node.get() {
        res.report_open();
    }
    if let Some(http2) = context.http2.get()
        && !res.is_closed()
        && res.raw().has_negotiated_http2()
    {
        http2.app.adopt(res, 0, b"");
    }
}

extern "C" fn on_close<const IS_NODE: bool>(
    socket: *mut us_socket_t,
    code: c_int,
    _: *mut c_void,
) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    let connection = res.connection();
    res.socket().uncork_without_sending();

    let is_in_body_of_upgrade = IS_NODE && connection.has(State::HTTP_NODE_TUNNEL_AFTER_BODY);
    let is_tunnel = is_in_body_of_upgrade || connection.is_tunnel();
    if is_tunnel {
        if IS_NODE {
            node::on_tunnel_data(res, b"", true);
        }
        if is_in_body_of_upgrade || (!IS_NODE && connection.on_aborted.get().is_none()) {
            res.end_request_body();
        }
    }
    res.report_gone();
    if IS_NODE {
        // A tunnel has heard of its end. The codes above ours are errors of a read.
        let has_failed = !is_tunnel && code > CloseCode::fast_shutdown as c_int;
        let has_peer_ended = !is_tunnel && connection.has(State::HTTP_NODE_PEER_ENDED);
        let read_error = if has_failed { code } else { 0 };
        node::on_closed(res.socket(), read_error, has_peer_ended);
    }
    if let Some(on_aborted) = connection.on_aborted.get() {
        on_aborted(res, connection.user_data.get());
    }

    // A handler that writes corks again.
    res.socket().uncork_without_sending();
    res.socket().clear_buffer();
    connection.clear_response_handlers();
    connection.on_data.set(None);
    connection.free_buffers();
    socket
}

extern "C" fn on_data<const IS_NODE: bool>(
    socket: *mut us_socket_t,
    data: *mut u8,
    len: c_int,
) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    let (connection, context) = (res.connection(), res.context());
    // SAFETY: the loop lends what it read for the call.
    let mut data = unsafe { core::slice::from_raw_parts_mut(data, len as usize) };

    let is_node_tunnel = IS_NODE && connection.is_tunnel();
    if !is_node_tunnel
        && ((res.raw().is_shutdown() && !connection.reads_body_after_shutdown())
            || (IS_NODE
                && (connection.has(State::HTTP_NODE_PARSING_STOPPED)
                    || connection.is_draining_before_close())))
    {
        res.raw().unref();
        return socket;
    }

    let mut with_held_bytes;
    if !IS_NODE
        && let Some(http2) = context.http2.get()
        && let Some(held_len) = connection.preface_len.get()
    {
        if !res.is_http1(http2, held_len.into(), data) {
            return socket;
        }
        if held_len != 0 {
            with_held_bytes = [&CLIENT_PREFACE[..held_len.into()], data].concat();
            data = &mut with_held_bytes;
        }
    }

    res.raw().ref_();
    res.socket().cork();
    let outer = context.reading.replace(res);
    let was_idle = connection.is_idle.replace(false);
    let options = context.request_options.get();
    let outcome = request::read::<IS_NODE>(Reader::<IS_NODE> { res, context }, data, &options);
    context.reading.set(outer);

    if let Outcome::Failed(error) = outcome {
        res.on_parse_error::<IS_NODE>(context, error, data);
        return socket;
    }
    let is_http = !res.is_closed_or_upgraded();
    if IS_NODE && is_http && connection.has(State::HTTP_NODE_CLOSE_AFTER_MESSAGE) {
        res.close_destroyed();
    } else if is_http && outcome == Outcome::Consumed {
        res.after_read::<IS_NODE>(was_idle, is_node_tunnel);
        return socket;
    }
    res.socket().uncork();
    // Frames that did not wait for the 101.
    if let Outcome::Stopped { consumed } = outcome
        && consumed < data.len()
        && !is_http
        && !res.is_closed()
        && !res.raw().is_shutdown()
    {
        web_socket::read(socket, &mut data[consumed..]);
    }
    socket
}

struct Reader<'a, const IS_NODE: bool> {
    res: &'a uws_res,
    context: &'a Context,
}

impl<const IS_NODE: bool> request::Connection for Reader<'_, IS_NODE> {
    fn parser(&mut self) -> &mut RequestParser {
        // SAFETY: an upgrade ends the read, and no handler runs while this is borrowed.
        unsafe { &mut *self.res.connection().http.assume_init_ref().parser.get() }
    }

    fn on_request(self, request: &Request<'_>) -> Option<Self> {
        (self.res.on_request::<IS_NODE>(self.context, request)).then_some(self)
    }

    fn on_body(self, data: &[u8], is_last: bool) -> Option<Self> {
        self.res.on_body::<IS_NODE>(data, is_last).then_some(self)
    }
}

extern "C" fn on_writable<const IS_NODE: bool>(socket: *mut us_socket_t) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    let connection = res.connection();
    let has_received_fin = || connection.has(State::HTTP_NODE_RECEIVED_FIN);

    if res.get_buffered_amount() != 0 {
        let sent = res.socket().flush();
        if res.get_buffered_amount() != 0 {
            if sent == 0 && has_received_fin() && res.raw().stalled_write_means_peer_gone() {
                res.socket().close();
            } else {
                res.reset_timeout();
            }
            return socket;
        }
    }
    if IS_NODE && connection.is_tunnel() {
        node::on_tunnel_drain(res);
    }
    if let Some(on_writable) = connection.on_writable.get() {
        res.raw().set_timeout(0);
        let (offset, had_received_fin) = (connection.http().offset.get(), has_received_fin());
        let has_succeeded = on_writable(res, offset, connection.writable_user_data.get());
        if res.is_closed_or_upgraded() {
            if had_received_fin {
                res.pass_on_end();
            }
            return socket;
        }
        if !IS_NODE
            && has_received_fin()
            && !res.has_responded()
            && connection.http().offset.get() == offset
            && res.has_fully_drained()
            && res.raw().stalled_write_means_peer_gone()
        {
            res.socket().close();
            return socket;
        }
        if !has_succeeded {
            return socket;
        }
    }

    res.socket().flush();
    if IS_NODE && connection.has(State::HTTP_NODE_READS_PAUSED) {
        res.resume_held_reads();
    }
    if connection.closes_after_response() && res.has_fully_drained() {
        let gives_up_response = IS_NODE
            && (connection.has(State::HTTP_NODE_CLOSE_AFTER_DRAIN)
                || (has_received_fin()
                    && !res.context().allows_half_open.get()
                    && connection.on_writable.get().is_none()));
        if gives_up_response || res.has_responded() {
            res.shut_down_and_close();
        }
    }
    res.reset_timeout();
    socket
}

extern "C" fn on_end(socket: *mut us_socket_t) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    // A body that is still being produced is aborted.
    let has_more_to_send = match res.has_responded() {
        true => !res.has_fully_drained(),
        false => res.connection().has(State::HTTP_END_CALLED),
    };
    res.close_or_drain(has_more_to_send);
    socket
}

extern "C" fn on_node_end(socket: *mut us_socket_t) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    let (connection, context) = (res.connection(), res.context());
    if connection.is_tunnel() || connection.has(State::HTTP_NODE_TUNNEL_AFTER_BODY) {
        node::on_tunnel_data(res, b"", true);
        if !res.is_closed_or_upgraded() && connection.has(State::HTTP_NODE_TUNNEL_AFTER_BODY) {
            connection.become_tunnel();
            res.end_request_body();
        }
        return socket;
    }
    // After a shutdown, it is how TLS reports the answer to our close_notify.
    if !res.raw().is_shutdown() {
        connection.mark(State::HTTP_NODE_PEER_ENDED);
    }
    if !connection.has(State::HTTP_NODE_PARSING_STOPPED)
        && connection.with_parser(|parser| core::mem::take(&mut parser.is_body_until_eof))
    {
        connection.end_request();
        if connection.on_data.get().is_some() {
            res.raw().set_timeout(0);
            res.end_request_body();
            if res.is_closed_or_upgraded() {
                res.pass_on_end();
                return socket;
            }
        }
    }
    if let Some((on_client_error, user_data)) = context.on_client_error.get()
        && !connection.has(State::HTTP_NODE_PARSING_STOPPED)
        && connection.is_receiving_request()
    {
        connection.mark(State::HTTP_NODE_PARSING_STOPPED);
        on_client_error(user_data, res.raw(), INVALID_EOF, b"");
        if res.is_closed_or_upgraded() {
            res.pass_on_end();
            return socket;
        }
    }
    let owes_response = connection.http().queued_responses.get() != 0 || !res.has_responded();
    res.close_or_drain(
        res.is_sending_node_response() || (context.allows_half_open.get() && owes_response),
    );
    socket
}

extern "C" fn on_timeout(socket: *mut us_socket_t) -> *mut us_socket_t {
    let res = uws_res::of(socket);
    if let Some(on_timeout) = res.connection().on_timeout.get() {
        on_timeout(res, res.connection().user_data.get());
    }
    res.socket().uncork();
    res.raw().close_now();
    socket
}

impl uws_res {
    fn report_open(&self) {
        self.connection().is_idle.set(true);
        if let Some((on_open, user_data)) = self.context().on_open.get() {
            on_open(user_data, self.raw());
        }
    }

    /// RFC 9113 §3.3. False if `data` is taken care of.
    #[cold]
    fn is_http1(&self, http2: &Http2, held_len: usize, data: &[u8]) -> bool {
        let expected = &CLIENT_PREFACE[held_len..];
        let len = data.len().min(expected.len());
        if !self.is_ssl() && data[..len] == expected[..len] {
            self.raw().unref();
            match held_len + len {
                4.. => http2.app.adopt(self, held_len, data),
                len => self.connection().preface_len.set(Some(len as u8)),
            }
            return false;
        }
        self.connection().preface_len.set(None);
        if !http2.allows_http1 {
            self.raw().unref();
            self.reject(b"HTTP/1.1 505 HTTP Version Not Supported\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        }
        http2.allows_http1
    }

    /// What the socket does not take at once is lost.
    fn reject(&self, response: &[u8]) {
        self.raw().write(response);
        self.raw().shutdown();
        self.raw().close(CloseCode::normal);
    }

    /// A TLS write that the kernel refused shuts down too. Like Node, `node:https` still handles the read.
    fn is_shut_down_by_owner<const IS_NODE: bool>(&self) -> bool {
        if !self.raw().is_shutdown() {
            return false;
        }
        if IS_NODE
            && self.is_ssl()
            && self.raw().ssl_send_rejected()
            && let Some(ssl) = self.raw().get_native_handle()
        {
            // SAFETY: the `SSL` of an open socket.
            return SSL_get_shutdown(unsafe { &*ssl.cast() }) & SSL_SENT_SHUTDOWN != 0;
        }
        true
    }

    fn is_sending_node_response(&self) -> bool {
        !self.has_fully_drained() || self.connection().on_writable.get().is_some()
    }

    /// False if the read is over.
    fn on_request<const IS_NODE: bool>(&self, context: &Context, request: &Request<'_>) -> bool {
        let connection = self.connection();
        if connection.is_draining_before_close() {
            // To Node, a later read is no parse error.
            if !IS_NODE {
                connection.with_parser(|parser| parser.is_closing = true);
            }
            self.raw().unref();
            self.uncork();
            self.close_if_done();
            return false;
        }
        self.raw().set_timeout(0);
        if IS_NODE {
            if connection.has(State::HTTP_NODE_PARSING_STOPPED) {
                return false;
            }
            if connection.http().request_start_ms.get() == 0 {
                connection.http().request_start_ms.set(node::now_ms());
            }
            connection.http().has_complete_head.set(true);
        }

        if self.has_responded()
            && !(IS_NODE
                && (connection.http().queued_responses.get() != 0
                    || self.is_sending_node_response()))
        {
            connection.begin_response();
            if request.is_http_1_0() {
                connection.mark(State::HTTP_ANCIENT_REQUEST | State::HTTP_CONNECTION_CLOSE);
            } else if connection.with_parser(|parser| parser.is_closing) {
                connection.mark(State::HTTP_CONNECTION_CLOSE);
            }
        } else if IS_NODE {
            connection.mark(State::HTTP_NODE_PIPELINED_DISPATCH);
            connection.http().queued_responses.update(|count| count + 1);
            connection.is_idle.set(false);
            if self.get_buffered_amount() != 0 {
                connection.mark(State::HTTP_NODE_READS_PAUSED);
                self.pause();
            }
        } else {
            self.socket().close();
            return false;
        }

        // The response to an earlier request of this read may have uncorked.
        if !IS_NODE {
            self.socket().cork();
        }
        if !(context.routes).dispatch(self, request, context.answers_expect.get()) {
            self.socket().close();
            return false;
        }
        if self.is_closed_or_upgraded()
            || (self.is_shut_down_by_owner::<IS_NODE>() && !connection.reads_body_after_shutdown())
        {
            return false;
        }
        if IS_NODE {
            connection.unmark(State::HTTP_NODE_PIPELINED_DISPATCH);
        }
        if !self.has_responded() {
            let node_socket = connection.socket.node_socket.get();
            assert!(connection.on_aborted.get().is_some() || !node_socket.is_null());
            if connection.on_data.get().is_some() {
                self.reset_timeout();
            }
        }
        true
    }

    /// False if the read is over.
    fn on_body<const IS_NODE: bool>(&self, data: &[u8], is_last: bool) -> bool {
        let connection = self.connection();
        let mut becomes_tunnel = false;
        if IS_NODE && connection.is_tunnel() {
            node::on_tunnel_data(self, data, is_last);
            if self.is_closed_or_upgraded() {
                return false;
            }
        } else if IS_NODE && is_last {
            connection.end_request();
            becomes_tunnel = connection.has(State::HTTP_NODE_TUNNEL_AFTER_BODY);
            if becomes_tunnel {
                connection.become_tunnel();
            } else if self.has_responded() && connection.http().queued_responses.get() == 0 {
                connection.is_idle.set(true);
            }
        }

        if let Some(on_data) = connection.on_data.get() {
            if is_last {
                self.raw().set_timeout(0);
            } else {
                let mut received = connection.received_since_timeout.get() + data.len() as u32;
                if received >= MIN_RECEIVED_PER_SECOND * u32::from(connection.idle_timeout.get()) {
                    self.reset_timeout();
                    received = 0;
                }
                connection.received_since_timeout.set(received);
            }
            on_data(self, data, is_last, connection.user_data.get());
            if self.is_closed_or_upgraded() {
                return false;
            }
            if is_last {
                connection.on_data.set(None);
            }
            if self.is_shut_down_by_owner::<IS_NODE>() && !connection.reads_body_after_shutdown() {
                return false;
            }
        }

        if becomes_tunnel {
            // The response cannot resume a tunnel.
            self.resume_held_reads();
        }
        !(IS_NODE && is_last && connection.has(State::HTTP_NODE_CLOSE_AFTER_MESSAGE))
    }

    fn end_request_body(&self) {
        let connection = self.connection();
        if let Some(on_data) = connection.on_data.get() {
            on_data(self, b"", true, connection.user_data.get());
            connection.on_data.set(None);
        }
    }

    #[cold]
    fn on_parse_error<const IS_NODE: bool>(
        &self,
        context: &Context,
        error: RequestError,
        data: &[u8],
    ) {
        let connection = self.connection();
        // It decides what to answer and when to close.
        if IS_NODE && let Some((on_client_error, user_data)) = context.on_client_error.get() {
            connection.mark(State::HTTP_NODE_PARSING_STOPPED);
            on_client_error(user_data, self.raw(), error as u8, data);
            if !self.is_closed_or_upgraded() {
                self.raw().unref();
                if connection.has(State::HTTP_NODE_CLOSE_AFTER_MESSAGE) {
                    return self.close_destroyed();
                }
            }
            self.uncork();
            if !self.is_closed_or_upgraded() && !self.raw().is_shutdown() {
                self.close_if_done();
            }
            return;
        }
        self.uncork();
        self.reject(error.response());
    }

    fn after_read<const IS_NODE: bool>(&self, was_idle: bool, was_tunnel: bool) {
        let connection = self.connection();
        // Between requests, it does not keep the loop alive.
        self.raw().unref();
        if IS_NODE && connection.has(State::HTTP_NODE_NOTIFY_READ_PARSED) {
            connection.unmark(State::HTTP_NODE_NOTIFY_READ_PARSED);
            node::on_read_parsed(self);
            if self.is_closed_or_upgraded() {
                return self.uncork();
            }
        }
        if IS_NODE
            && !was_tunnel
            && connection.http().request_start_ms.get() == 0
            && connection.with_parser(|parser| parser.has_partial_head())
        {
            connection.http().request_start_ms.set(node::now_ms());
        }
        // Empty lines are no request.
        if was_idle
            && self.has_responded()
            && connection.http().queued_responses.get() == 0
            && !connection.is_receiving_request()
        {
            connection.is_idle.set(true);
        }
        self.uncork_and_close_if_done();
    }

    /// The flag goes first: TLS defers a close for what it holds back, and a second close would drop that.
    fn close_destroyed(&self) {
        (self.connection()).unmark(State::HTTP_NODE_CLOSE_AFTER_MESSAGE);
        self.connection().mark(State::HTTP_NODE_PARSING_STOPPED);
        self.raw().close(CloseCode::fast_shutdown);
    }

    fn close_or_drain(&self, has_more_to_send: bool) {
        if has_more_to_send {
            self.connection().mark(State::HTTP_NODE_RECEIVED_FIN);
        } else {
            self.socket().uncork_without_sending();
            self.raw().close(CloseCode::normal);
        }
    }

    /// The loop reports the end once. A WebSocket would drop what is unsent, so then it stays open.
    fn pass_on_end(&self) {
        if !self.is_closed() && self.has_fully_drained() {
            web_socket::on_end(self.raw());
        }
    }
}
