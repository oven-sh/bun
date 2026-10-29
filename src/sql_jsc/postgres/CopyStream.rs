//! The query's one callback, `copy(chunk)`, is called when the server enters copy mode, then with
//! each chunk (out) or each time the socket has drained (in). START_REPLICATION opens both.

use super::{MAX_PIPELINE_SIZE, PostgresSQLConnection, Socket};
use crate::jsc::{AutoFlush as _, JSValue, JsResult, js_error_to_postgres};
use crate::postgres::PostgresSQLQuery;
use crate::postgres::error_jsc::{create_postgres_error, postgres_error_to_js};
use crate::postgres::postgres_request as PostgresRequest;
use crate::postgres::postgres_sql_query::{CopyStream, js};
use bun_core::String as BunString;
use bun_core::strings;
use bun_jsc::JSUint8Array;
use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_ptr::{ParentRef, RefPtr};
use bun_sql::postgres::AnyPostgresError;
use bun_sql::postgres::PostgresErrorOptions;
use bun_sql::postgres::postgres_protocol as protocol;
use bun_sql::shared::ConnectionFlags;

const COPY_DONE: [u8; 5] = [b'c', 0, 0, 0, 4];
const COPY_NEEDS_STREAM: &[u8] =
    b"COPY ... FROM STDIN needs query.writable() and COPY ... TO STDOUT needs query.readable()";
const COPY_IN_HAS_NO_READABLE: &[u8] = b"COPY ... FROM STDIN has no readable()";
const COPY_OUT_HAS_NO_WRITABLE: &[u8] = b"COPY ... TO STDOUT has no writable()";

// The server ends the session for a longer message.
const MAX_COPY_DATA_LENGTH: usize = 0x3fff_fffe - 4;
const MAX_COPY_FAIL_LENGTH: usize = 10_000 - 4 - 1;

fn write_copy_data<Context: protocol::WriterContext>(
    data: &[u8],
    writer: protocol::NewWriter<Context>,
) -> Result<(), AnyPostgresError> {
    writer.write(b"d")?;
    writer.int4((data.len() + 4) as u32)?;
    writer.write(data)
}

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
    fn copying(&self, open: fn(CopyStream) -> bool) -> Option<ParentRef<PostgresSQLQuery>> {
        self.current().filter(|head| head.is_copy(open))
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

    /// `false`: `request` has no stream for that direction.
    fn open_copy(
        &self,
        request: &PostgresSQLQuery,
        waiting: &[CopyStream],
        open: CopyStream,
    ) -> bool {
        if !request.is_copy(|state| waiting.contains(&state)) || !request.flags.get().simple {
            return false;
        }
        request.update_flags(|f| f.copy = open);
        self.call_copy(request, JSValue::UNDEFINED);
        true
    }

    fn reject_copy(&self, request: &PostgresSQLQuery, message: &[u8]) {
        request.reject_in_flight(
            postgres_error_to_js(
                self.global(),
                Some(message),
                AnyPostgresError::CopyNotSupported,
            ),
            self.global(),
        );
    }

    fn reject_copy_without(&self, request: &PostgresSQLQuery, both: &[u8]) {
        let message = if request.flags.get().copy == CopyStream::Both {
            both
        } else {
            COPY_NEEDS_STREAM
        };
        self.reject_copy(request, message);
    }

    pub(super) fn on_copy_in_response(
        &self,
        request: &PostgresSQLQuery,
    ) -> Result<(), AnyPostgresError> {
        if self.open_copy(request, &[CopyStream::Writable], CopyStream::WritableOpen) {
            return Ok(());
        }
        PostgresRequest::write_copy_fail(b"no source stream", self.writer())?;
        // In copy-in mode the server ignored the Sync of the batch.
        if !request.flags.get().simple {
            self.writer().write(&protocol::SYNC)?;
        }
        self.flush_data();
        self.reject_copy_without(request, COPY_IN_HAS_NO_READABLE);
        Ok(())
    }

    pub(super) fn on_copy_out_response(&self, request: &PostgresSQLQuery) {
        if !self.open_copy(request, &[CopyStream::Readable], CopyStream::ReadableOpen) {
            self.reject_copy_without(request, COPY_OUT_HAS_NO_WRITABLE);
        }
    }

    /// The writable is optional: the server waits `wal_sender_timeout` for its replies.
    pub(super) fn on_copy_both_response(
        &self,
        request: &PostgresSQLQuery,
    ) -> Result<(), AnyPostgresError> {
        if self.open_copy(
            request,
            &[CopyStream::Readable, CopyStream::Both],
            CopyStream::BothOpen,
        ) {
            return Ok(());
        }
        // A walsender ends the session on a CopyFail.
        self.writer().write(&COPY_DONE)?;
        self.flush_data();
        self.reject_copy(request, b"START_REPLICATION needs query.readable()");
        Ok(())
    }

    /// `upcoming`: how many bytes the read still holds, `data` included.
    pub(super) fn on_copy_data(&self, data: &[u8], upcoming: usize) {
        let Some(request) = self.copying(CopyStream::reads) else {
            return;
        };
        if request.flags.get().copy != CopyStream::ReadableOpen {
            // One chunk per message: an XLogData carries no length of its own. The pause waits for
            // the read to end, so a query that an error rejects in the same read is not left paused.
            match JSUint8Array::from_bytes(self.global(), data.into()) {
                Ok(chunk) => {
                    if self.call_copy(&request, chunk) == JSValue::FALSE {
                        self.copy_out_full.set(true);
                    }
                }
                Err(err) => self.fail(b"Failed to read data", js_error_to_postgres(err)),
            }
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
        let Some(request) = self.copying(CopyStream::reads) else {
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
        let Some(request) = self.copying(CopyStream::reads) else {
            return;
        };
        let both = request.flags.get().copy == CopyStream::BothOpen;
        request.update_flags(|f| f.copy = CopyStream::Readable);
        if both {
            // The client answers with its own CopyDone, which ends the command.
            self.set_reading(true);
            self.write_copy_end(None);
        }
    }

    pub(super) fn flush_copy_out(&self) {
        let coalesced_full = !self.deliver_copy_out();
        let streamed_full = self.copy_out_full.replace(false);
        if (coalesced_full || streamed_full) && self.copying(CopyStream::reads).is_some() {
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
        if let Some(request) = self.copying(CopyStream::writes) {
            self.call_copy(&request, JSValue::UNDEFINED);
        }
    }

    /// `false`: the socket is full, and the callback says when it has drained.
    fn write_copy_chunk(&self, bytes: &[u8]) -> bool {
        for data in bytes.chunks(MAX_COPY_DATA_LENGTH) {
            if let Err(err) = write_copy_data(data, self.writer()) {
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
        if let Err(err) = match failure {
            Some(message) => PostgresRequest::write_copy_fail(message, self.writer()),
            None => self.writer().write(&COPY_DONE),
        } {
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

    fn is_copy(&self, state: impl FnOnce(CopyStream) -> bool) -> bool {
        state(self.flags.get().copy) && !self.is_rejected()
    }

    fn copy_connection(
        &self,
        open: fn(CopyStream) -> bool,
    ) -> Option<RefPtr<PostgresSQLConnection>> {
        if self.is_copy(open) {
            self.connection()
        } else {
            None
        }
    }

    fn end_copy_in(&self, failure: Option<&[u8]>) {
        let Some(connection) = self.copy_connection(CopyStream::writes) else {
            return;
        };
        if self.flags.get().copy != CopyStream::BothOpen {
            self.update_flags(|f| f.copy = CopyStream::None);
            connection.write_copy_end(failure);
            return;
        }
        self.end_copy_both(&connection);
        if let Some(message) = failure {
            let err = create_postgres_error(
                connection.global(),
                message,
                &PostgresErrorOptions {
                    code: b"ERR_POSTGRES_QUERY_CANCELLED",
                    ..Default::default()
                },
            )
            .unwrap_or_else(|err| connection.global().take_error(err));
            self.reject_in_flight(err, connection.global());
        }
    }

    /// The client's CopyDone, for an abort too: a walsender ends the session on a CopyFail.
    fn end_copy_both(&self, connection: &PostgresSQLConnection) {
        self.update_flags(|f| f.copy = CopyStream::BothClosing);
        connection.set_reading(true);
        connection.write_copy_end(None);
    }

    /// A backend waiting for room in an unread socket ignores a CancelRequest.
    /// `true`: the session ends through the client's CopyDone, so no CancelRequest is needed.
    pub(super) fn cancel_copy(&self) -> bool {
        let Some(connection) = self.copy_connection(CopyStream::reads) else {
            return false;
        };
        let copy = self.flags.get().copy;
        if copy == CopyStream::BothOpen {
            self.end_copy_both(&connection);
        }
        connection.set_reading(true);
        self.reject_in_flight(connection.cancelled_error(None), connection.global());
        // In BothClosing the client's CopyDone is already on the wire.
        copy == CopyStream::BothOpen || copy == CopyStream::BothClosing
    }

    /// `mode`: 0 for `readable()`, 1 for `writable()`, 2 for both.
    pub fn set_copy(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        callback: JsLocal<'_>,
        mode: u8,
    ) {
        let callback = callback.to_js();
        if !callback.is_callable() {
            js::copy_set_cached(this_value.to_js(), cx.global(), JSValue::ZERO);
            self.update_flags(|f| f.copy = CopyStream::None);
            return;
        }
        js::copy_set_cached(this_value.to_js(), cx.global(), callback);
        self.update_flags(|f| f.copy = f.copy.waiting(mode));
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
            .copy_connection(CopyStream::writes)
            .is_none_or(|connection| connection.write_copy_chunk(bytes)))
    }

    pub fn copy_done(&self, _: &mut JsScope<'_>) {
        self.end_copy_in(None);
    }

    pub fn copy_fail(&self, _: &mut JsScope<'_>, message: &[u8]) {
        self.end_copy_in(Some(copy_fail_message(message)));
    }

    pub fn copy_resume(&self) {
        if let Some(connection) = self.copy_connection(CopyStream::reads) {
            connection.set_reading(true);
        }
    }
}
