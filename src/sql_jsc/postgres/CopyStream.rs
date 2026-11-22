//! The query's one callback, `copy(chunk)`, is called when the server enters copy mode, then with
//! each chunk (out) or each time the socket has drained (in).

use super::{PostgresSQLConnection, Seat, Socket};
use crate::jsc::{AutoFlush as _, JSValue, JsResult, js_error_to_postgres};
use crate::postgres::PostgresSQLQuery;
use crate::postgres::error_jsc::postgres_error_to_js;
use crate::postgres::postgres_sql_query::{CopyStream, js};
use bun_core::String as BunString;
use bun_core::strings;
use bun_jsc::JSUint8Array;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_ptr::ParentRef;
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::frontend;
use bun_sql::postgres::pipeline::MAX_PIPELINE_SIZE;
use bun_sql::shared::ConnectionFlags;

// The server ends the session for a longer message.
const MAX_COPY_DATA_LENGTH: usize = 0x3fff_fffe - 4;
const MAX_COPY_FAIL_LENGTH: usize = 10_000 - 4 - 1;

fn copy_fail_message(message: &[u8]) -> &[u8] {
    let mut end = message.len().min(MAX_COPY_FAIL_LENGTH);
    while !strings::is_on_char_boundary(message, end) {
        end -= 1;
    }
    &message[..end]
}

/// Whether the first keyword is COPY. Whitespace and comments are the server's: `--` ends with the
/// line, `/*` nests. It drops an empty statement, from a Parse too.
fn starts_with_copy(text: &BunString) -> bool {
    let length = text.length();
    let at = |i: usize| if i < length { text.char_at(i) } else { 0 };
    let is = |i: usize, c: u8| at(i) == u16::from(c);
    let mut i = 0;
    loop {
        if matches!(at(i), 0x09..=0x0d | 0x20 | 0x3b) {
            i += 1;
        } else if is(i, b'-') && is(i + 1, b'-') {
            while i < length && !is(i, b'\n') && !is(i, b'\r') {
                i += 1;
            }
        } else if is(i, b'/') && is(i + 1, b'*') {
            let mut depth = 0;
            loop {
                if i >= length {
                    return false;
                }
                if is(i, b'/') && is(i + 1, b'*') {
                    depth += 1;
                    i += 2;
                } else if is(i, b'*') && is(i + 1, b'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else {
            break;
        }
    }
    let after = at(i + 4);
    (0..4).all(|n| (at(i + n) | 0x20) == u16::from(b"copy"[n]))
        && !(after >= 0x80
            || matches!(after as u8, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'_' | b'$'))
}

impl PostgresSQLConnection {
    fn copying(&self, state: CopyStream) -> Option<ParentRef<PostgresSQLQuery>> {
        let head = self.pipeline.get().head().ok()?;
        (head.request.copy.get() == state && !head.is_rejected())
            .then(|| ParentRef::from(head.request.as_non_null()))
    }

    fn call_copy(&self, request: &PostgresSQLQuery, chunk: JSValue) -> JSValue {
        let Some(callback) = request
            .this_value
            .get()
            .try_get()
            .and_then(js::copy_get_cached)
        else {
            return JSValue::ZERO;
        };
        self.event_loop().run_callback_with_result(
            bun_event_loop::ContextId::NONE,
            callback,
            self.global(),
            JSValue::UNDEFINED,
            &[chunk],
        )
    }

    /// `false`: the head has no stream for that direction.
    fn open_copy(&self, simple: bool, waiting: CopyStream, open: CopyStream) -> bool {
        let Some(request) = self.copying(waiting).filter(|_| simple) else {
            return false;
        };
        request.copy.set(open);
        self.call_copy(&request, JSValue::UNDEFINED);
        true
    }

    pub(super) fn on_copy_response(&self, writable: bool) -> Result<(), AnyPostgresError> {
        let head = self.pipeline.get().head()?;
        let (turn, simple) = (head.turn(), head.is_simple());
        if writable {
            if self.open_copy(simple, CopyStream::Writable, CopyStream::WritableOpen) {
                return Ok(());
            }
            self.write(|out| {
                frontend::copy_fail(out, b"no source stream")?;
                // In copy-in mode the server ignored the Sync of the batch.
                if !simple {
                    out.extend_from_slice(&frontend::SYNC);
                }
                Ok(())
            })?;
            self.flush_data();
        } else if self.open_copy(simple, CopyStream::Readable, CopyStream::ReadableOpen) {
            return Ok(());
        }
        self.reject_in_flight(
            turn,
            postgres_error_to_js(
                self.global(),
                Some(b"COPY ... FROM STDIN needs query.writable() and COPY ... TO STDOUT needs query.readable()"),
                AnyPostgresError::CopyNotSupported,
            ),
        );
        Ok(())
    }

    /// `upcoming`: how many bytes the read still holds, `data` included.
    pub(super) fn on_copy_data(&self, data: &[u8], upcoming: usize) {
        if self.copying(CopyStream::ReadableOpen).is_none() {
            return;
        }
        self.copy_out.with_mut(|out| {
            if out.is_empty() {
                out.reserve(upcoming);
            }
            out.extend_from_slice(data);
        });
    }

    /// `false`: the stream has enough for now.
    fn deliver_copy_out(&self) -> bool {
        if self.copy_out.get().is_empty() {
            return true;
        }
        let bytes = self.copy_out.take();
        let Some(request) = self.copying(CopyStream::ReadableOpen) else {
            return true;
        };
        match JSUint8Array::from_bytes(self.global(), bytes.into_boxed_slice()) {
            Ok(chunk) => self.call_copy(&request, chunk) != JSValue::FALSE,
            Err(err) => {
                self.fail(b"Failed to read data", js_error_to_postgres(err));
                true
            }
        }
    }

    /// What follows is the end of the reply: it is read however much the stream holds.
    pub(super) fn on_copy_done(&self) {
        self.deliver_copy_out();
        if let Some(request) = self.copying(CopyStream::ReadableOpen) {
            request.copy.set(CopyStream::Readable);
        }
    }

    pub(super) fn flush_copy_out(&self) {
        if !self.deliver_copy_out() {
            self.set_reading(false);
        }
    }

    fn set_reading(&self, reading: bool) {
        if self.flags.get().contains(ConnectionFlags::COPY_OUT_PAUSED) != reading {
            return;
        }
        self.update_flags(|f| f.toggle(ConnectionFlags::COPY_OUT_PAUSED));
        let _ = match *self.socket.get() {
            Socket::SocketTcp(socket) if reading => socket.resume_stream(),
            Socket::SocketTcp(socket) => socket.pause_stream(),
            Socket::SocketTls(socket) if reading => socket.resume_stream(),
            Socket::SocketTls(socket) => socket.pause_stream(),
        };
        self.update_poll_ref();
    }

    pub(super) fn on_copy_drain(&self) {
        if self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE) {
            return;
        }
        if let Some(request) = self.copying(CopyStream::WritableOpen) {
            self.call_copy(&request, JSValue::UNDEFINED);
        }
    }

    /// `false`: the socket is full, and the callback says when it has drained.
    fn write_copy_chunk(&self, bytes: &[u8]) -> bool {
        for data in bytes.chunks(MAX_COPY_DATA_LENGTH) {
            if let Err(err) = self.write(|out| frontend::copy_data(out, data)) {
                return self.fail_write(err);
            }
        }
        if (self.write_buffer.get().len() as usize) < MAX_PIPELINE_SIZE {
            self.register_auto_flusher();
        } else {
            self.flush_data();
        }
        !self.flags.get().contains(ConnectionFlags::HAS_BACKPRESSURE)
    }

    fn write_copy_end(&self, failure: Option<&[u8]>) {
        if let Err(err) = self.write(|out| match failure {
            Some(message) => frontend::copy_fail(out, message),
            None => frontend::message(out, b'c', &[]),
        }) {
            self.fail_write(err);
            return;
        }
        self.flush_data();
    }
}

impl PostgresSQLQuery {
    pub(crate) fn is_copy_statement(&self) -> bool {
        starts_with_copy(&self.query)
    }

    fn copy_seat(&self, open: CopyStream) -> Option<Seat> {
        self.seat().filter(|seat| {
            let running = seat.session.pipeline.get().running(seat.turn);
            self.copy.get() == open && running.is_some_and(|it| !it.is_rejected())
        })
    }

    fn end_copy_in(&self, failure: Option<&[u8]>) {
        if let Some(seat) = self.copy_seat(CopyStream::WritableOpen) {
            self.copy.set(CopyStream::None);
            seat.session.write_copy_end(failure);
        }
    }

    /// A backend waiting for room in an unread socket ignores a CancelRequest.
    pub(super) fn cancel_copy(&self) {
        if let Some(Seat { session, turn }) = self.copy_seat(CopyStream::ReadableOpen) {
            session.set_reading(true);
            session.reject_in_flight(turn, session.cancelled_error(None));
        }
    }

    pub fn set_copy(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_>,
        writable: bool,
    ) {
        let callback = callback.to_js();
        let (copy, callback) = if !callback.is_callable() {
            (CopyStream::None, JSValue::ZERO)
        } else if writable {
            (CopyStream::Writable, callback)
        } else {
            (CopyStream::Readable, callback)
        };
        js::copy_set_cached(this_value.to_js(), cx.global(), callback);
        self.copy.set(copy);
    }

    pub fn copy_write(&self, cx: &mut JsScope<'_>, chunk: JsLocal<'_>) -> JsResult<bool> {
        let global = cx.global();
        let chunk = chunk.to_js();
        let text;
        let buffer;
        let bytes = if chunk.is_string() {
            text = chunk.to_utf8(global)?;
            text.slice()
        } else if let Some(view) = chunk.as_array_buffer(global) {
            buffer = view;
            buffer.byte_slice()
        } else {
            return Err(global.throw_invalid_argument_type_value_one_of(
                "chunk",
                "string, TypedArray, DataView, or ArrayBuffer",
                chunk,
            ));
        };
        Ok(self
            .copy_seat(CopyStream::WritableOpen)
            .map(|seat| seat.session)
            .is_none_or(|connection| connection.write_copy_chunk(bytes)))
    }

    pub fn copy_done(&self, _: &mut JsScope<'_>) {
        self.end_copy_in(None);
    }

    pub fn copy_fail(&self, _: &mut JsScope<'_>, message: &[u8]) {
        self.end_copy_in(Some(copy_fail_message(message)));
    }

    pub fn copy_resume(&self) {
        if let Some(Seat {
            session: connection,
            ..
        }) = self.copy_seat(CopyStream::ReadableOpen)
        {
            connection.set_reading(true);
        }
    }
}
