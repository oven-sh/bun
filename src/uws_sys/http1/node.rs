//! What only `node:http` needs, and what JSNodeHTTPServerSocket.cpp and HttpResponse.h call.

use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;

use bun_core::ffi::slice;
use bun_core::{Timespec, TimespecMockMode};

use super::{Connection, Handshake};
use crate::app::ConnectionChange;
use crate::async_socket::AsyncSocket;
use crate::response::State;
use crate::{us_socket_t, uws_res};

unsafe extern "C" {
    safe fn Bun__NodeHTTPServerSocket__onClose(
        this: NonNull<c_void>,
        has_lost_data: bool,
        read_error: c_int,
        has_peer_ended: bool,
    );
    safe fn Bun__NodeHTTPServerSocket__onDrain(this: NonNull<c_void>);
    fn Bun__NodeHTTPServerSocket__onData(
        this: NonNull<c_void>,
        data: *const u8,
        len: c_int,
        is_last: bool,
    );
    safe fn Bun__NodeHTTPServerSocket__onUpgraded(this: NonNull<c_void>, socket: &mut us_socket_t);
    safe fn Bun__NodeHTTPServerSocket__onReadParsed(this: NonNull<c_void>);
    safe fn Bun__NodeHTTPServerSocket__tunnelReadsPaused(this: NonNull<c_void>) -> bool;
}

fn node_socket(socket: &AsyncSocket) -> Option<NonNull<c_void>> {
    NonNull::new(socket.data().node_socket.get())
}

pub(super) fn now_ms() -> u64 {
    Timespec::now(TimespecMockMode::ForceRealTime).ms_unsigned()
}

pub(crate) fn on_closed(socket: &AsyncSocket, read_error: c_int, has_peer_ended: bool) {
    if let Some(this) = node_socket(socket) {
        let has_lost_data = !socket.has_fully_drained() || socket.raw().has_dropped_ssl_spill();
        Bun__NodeHTTPServerSocket__onClose(this, has_lost_data, read_error, has_peer_ended);
    }
}

pub(crate) fn on_upgraded(socket: &AsyncSocket) {
    if let Some(this) = node_socket(socket) {
        Bun__NodeHTTPServerSocket__onUpgraded(this, socket.raw());
    }
}

pub(super) fn on_tunnel_data(res: &uws_res, data: &[u8], is_last: bool) {
    if let Some(this) = node_socket(res.socket()) {
        let len = data.len() as c_int;
        // SAFETY: it copies `len` bytes.
        unsafe { Bun__NodeHTTPServerSocket__onData(this, data.as_ptr(), len, is_last) };
    }
}

pub(super) fn on_tunnel_drain(res: &uws_res) {
    if let Some(this) = node_socket(res.socket()) {
        Bun__NodeHTTPServerSocket__onDrain(this);
    }
}

pub(super) fn on_read_parsed(res: &uws_res) {
    if let Some(this) = node_socket(res.socket()) {
        Bun__NodeHTTPServerSocket__onReadParsed(this);
    }
}

impl Connection {
    pub(super) fn end_request(&self) {
        self.http().request_start_ms.set(0);
        self.http().has_complete_head.set(false);
        self.http().has_reported_request_timeout.set(false);
    }

    pub(super) fn become_tunnel(&self) {
        self.unmark(State::HTTP_NODE_TUNNEL_AFTER_BODY);
        self.with_parser(|parser| parser.is_tunnel = true);
    }

    /// Not the body of an upgrade, whose last chunk starts a tunnel.
    pub(super) fn reads_body_after_shutdown(&self) -> bool {
        self.has(State::HTTP_NODE_HALF_CLOSED)
            && !self.has(State::HTTP_NODE_TUNNEL_AFTER_BODY)
            && self.on_data.get().is_some()
    }
}

impl uws_res {
    /// Defers the close to the end of the message that is being read. False: the caller closes now.
    pub(crate) fn close_after_message_if_parsing(&self) -> bool {
        let defers = self.is_being_read() && !self.connection().is_tunnel();
        if defers {
            (self.connection()).mark(State::HTTP_NODE_CLOSE_AFTER_MESSAGE);
        }
        defers
    }

    /// False if it is not being read.
    pub fn notify_when_read_parsed(&self) -> bool {
        let notifies = !self.is_closed() && self.is_being_read();
        if notifies {
            self.connection().mark(State::HTTP_NODE_NOTIFY_READ_PARSED);
        }
        notifies
    }

    /// Pauses until the responses have drained.
    pub fn hold_reads(&self) {
        if !self.is_closed() {
            self.pause();
            self.connection().mark(State::HTTP_NODE_READS_PAUSED);
        }
    }

    pub fn resume_held_reads(&self) {
        let connection = self.connection();
        // A pipelined CONNECT stays queued, and no request follows it.
        if connection.has(State::HTTP_NODE_READS_PAUSED)
            && (self.get_buffered_amount() != 0
                || (connection.http().queued_responses.get() != 0 && !connection.is_tunnel()))
        {
            return;
        }
        connection.unmark(State::HTTP_NODE_READS_PAUSED);
        if !node_socket(self.socket()).is_some_and(Bun__NodeHTTPServerSocket__tunnelReadsPaused) {
            self.resume();
        }
    }

    /// True if something is still buffered.
    pub fn write_behind_response(&self, data: &[u8]) -> bool {
        if !data.is_empty() {
            self.socket().write(data);
        }
        self.get_buffered_amount() != 0
    }

    /// All of it is corked. True if something is still unsent.
    pub fn finish_corked_response(&self, body_len: usize) -> bool {
        let connection = self.connection();
        connection.mark(State::HTTP_END_CALLED);
        connection
            .http()
            .offset
            .update(|offset| offset + body_len as u64);
        self.reset_timeout();
        self.complete();
        !self.is_closed() && !self.has_fully_drained()
    }
}

/// True if the close has to wait.
#[unsafe(no_mangle)]
extern "C" fn uws_res_prepare_destroy(res: &uws_res) -> bool {
    // Node has handed what `res.write()` got to the kernel by now.
    if res.state().is_http_write_called()
        && !res.state().is_http_end_called()
        && !res.raw().is_shutdown()
    {
        res.uncork();
    }
    res.close_after_message_if_parsing()
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_start_tunnel(res: &uws_res, after_body: bool) {
    if after_body {
        res.connection().mark(State::HTTP_NODE_TUNNEL_AFTER_BODY);
    } else {
        (res.connection()).with_parser(|parser| parser.is_tunnel = true);
        res.resume_held_reads();
    }
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_is_tunnel(res: &uws_res) -> bool {
    res.is_connect_request()
}

/// At the end of its input with nothing left to send, it does not keep the loop alive.
#[unsafe(no_mangle)]
extern "C" fn uws_res_update_tunnel_idle(res: &uws_res, is_all_written: bool) {
    let is_idle = is_all_written && res.has_fully_drained();
    if res.connection().is_idle_tunnel.replace(is_idle) != is_idle {
        res.context().report(match is_idle {
            true => ConnectionChange::TunnelIdle,
            false => ConnectionChange::TunnelBusy,
        });
    }
}

/// SAFETY: `fields` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_res_set_trailers(res: &uws_res, fields: *const u8, len: usize) {
    // SAFETY: forwarded.
    let last_chunk = [&b"0\r\n"[..], unsafe { slice(fields, len) }, b"\r\n"].concat();
    res.connection().http().last_chunk.set(last_chunk.into());
    (res.connection()).mark(State::HTTP_NODE_HAS_RESPONSE_TRAILERS);
}

/// False if the caller shuts down now.
#[unsafe(no_mangle)]
extern "C" fn uws_res_defer_shutdown(res: &uws_res, destroys_soon: bool) -> bool {
    let connection = res.connection();
    // Node parses the whole read first.
    let is_reading_body = destroys_soon
        && res.has_responded()
        && !connection.is_tunnel()
        && connection.on_data.get().is_some()
        && res.is_being_read();
    if !is_reading_body && res.get_buffered_amount() == 0 {
        connection.mark(State::HTTP_NODE_HALF_CLOSED);
        return false;
    }
    connection.mark(State::HTTP_CONNECTION_CLOSE);
    if destroys_soon {
        connection.mark(State::HTTP_NODE_CLOSE_AFTER_DRAIN);
    }
    true
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_close_when_drained(res: &uws_res) {
    res.connection().mark(State::HTTP_CONNECTION_CLOSE);
    res.uncork();
    res.close_if_done();
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_close_if_idle(res: &uws_res) -> bool {
    res.close_if_idle()
}

/// True once for each request. A timeout of 0 is none.
#[unsafe(no_mangle)]
extern "C" fn uws_res_is_request_timed_out(res: &uws_res, head_ms: u64, request_ms: u64) -> bool {
    let connection = res.connection();
    let start = connection.http().request_start_ms.get();
    if start == 0 || connection.is_tunnel() || connection.http().has_reported_request_timeout.get()
    {
        return false;
    }
    let elapsed = now_ms().saturating_sub(start);
    let has_expired =
        (head_ms != 0 && !connection.http().has_complete_head.get() && elapsed > head_ms)
            || (request_ms != 0 && elapsed > request_ms);
    connection
        .http()
        .has_reported_request_timeout
        .set(has_expired);
    has_expired
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_is_handshake_complete(res: &uws_res) -> bool {
    let handshake = res.connection().http().handshake.get();
    matches!(handshake, Handshake::Complete | Handshake::Verified)
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_is_peer_verified(res: &uws_res, error: &mut *const c_char) -> bool {
    *error = res.connection().http().verify_error.get();
    res.connection().http().handshake.get() == Handshake::Verified
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_start_queued_response(res: &uws_res, is_http_1_0: bool, closes: bool) {
    let connection = res.connection();
    connection.begin_response();
    if closes {
        connection.mark(State::HTTP_CONNECTION_CLOSE);
    }
    if is_http_1_0 {
        connection.mark(State::HTTP_ANCIENT_REQUEST);
    }
    (connection.http().queued_responses).update(|count| count.saturating_sub(1));
    if connection.has(State::HTTP_NODE_READS_PAUSED) {
        res.resume_held_reads();
    }
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_stop_parsing(res: &uws_res) {
    res.connection().mark(State::HTTP_NODE_PARSING_STOPPED);
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_uncork(res: &uws_res) {
    res.uncork();
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_cork_unless_buffered(res: &uws_res) {
    if res.get_buffered_amount() == 0 {
        res.socket().cork();
    }
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_has_buffered_bytes(res: &uws_res) -> bool {
    res.get_buffered_amount() != 0
}

/// SAFETY: `data` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_res_write_raw(res: &uws_res, data: *const u8, len: usize) {
    // SAFETY: forwarded.
    res.socket().write(unsafe { slice(data, len) });
}

/// SAFETY: `status` has `len` bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_res_write_status(res: &uws_res, status: *const u8, len: usize) {
    // SAFETY: forwarded.
    res.write_status(unsafe { slice(status, len) });
}

/// SAFETY: `key` and `value` have that many bytes.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_res_write_header(
    res: &uws_res,
    key: *const u8,
    key_len: usize,
    value: *const u8,
    value_len: usize,
) {
    // SAFETY: forwarded.
    unsafe { res.write_header(slice(key, key_len), slice(value, value_len)) }
}

#[unsafe(no_mangle)]
extern "C" fn uws_res_write_mark(res: &uws_res) {
    res.write_mark();
}

/// Null if `len` bytes cannot be corked. SAFETY: the caller fills them before it uses a socket.
#[unsafe(no_mangle)]
unsafe extern "C" fn uws_res_reserve_in_cork(res: &uws_res, len: usize) -> *mut u8 {
    let reserve = |corked: &mut Vec<u8>| {
        let room = corked.spare_capacity_mut().as_mut_ptr().cast();
        // SAFETY: there is room for them, and nothing reads them before the caller has filled them.
        unsafe { corked.set_len(corked.len() + len) };
        room
    };
    res.socket()
        .append_to_cork(len, reserve)
        .unwrap_or_default()
}
