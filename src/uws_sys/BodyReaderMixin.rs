use core::mem;

use crate::AnyResponse;
use crate::response::Response;

/// Mixin to read an entire request body into memory and run a callback.
/// Consumers should make sure a reference count is held on the server,
/// and is unreferenced when the handler is dropped.
///
/// See `DevServer`'s `ErrorReportRequest` for an example.
pub trait BodyReaderHandler: Sized + 'static {
    /// `body` is freed after this function returns.
    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> crate::Result<()>;
}

pub struct BodyReaderMixin<Wrap: BodyReaderHandler> {
    body: Vec<u8>,
    wrap: Wrap,
}

const MAX_BODY_SIZE: usize = 1024 * 1024 * 128;

impl<Wrap: BodyReaderHandler> BodyReaderMixin<Wrap> {
    /// Memory is freed after the callback returns, or automatically on failure.
    pub fn read_body<const SSL: bool>(wrap: Wrap, resp: &mut Response<SSL>) {
        let this = bun_core::heap::alloc(Self {
            body: Vec::new(),
            wrap,
        });
        resp.on_data(Self::on_data, this);
        resp.on_aborted(Self::on_aborted, this);
    }

    fn on_data(this: *mut Self, resp: AnyResponse, chunk: &[u8], last: bool) {
        // SAFETY: `this` is the box from `read_body`. `append` calls neither uWS nor `Wrap`, so
        // the abort handler cannot run during the borrow.
        let appended = unsafe { &mut *this }.append(chunk, last);
        if !last && appended.is_ok() {
            return;
        }
        if !resp.clear_handlers_of(this) {
            // Closed: uWS is ending a CONNECT body, and the abort handler follows.
            return;
        }
        // SAFETY: `this` is the box from `read_body`, and uWS has no handler left that gets it.
        let mut this = unsafe { bun_core::heap::take(this) };
        let body = mem::take(&mut this.body);
        let whole = if body.is_empty() { chunk } else { &body[..] };
        let result = appended.and_then(|()| this.wrap.on_body(whole, resp));
        drop(body);
        match result {
            Ok(()) => {}
            Err(crate::Error::Alloc(_)) => Self::fail(resp, b"500 Internal Server Error"),
            Err(_) => Self::fail(resp, b"400 Bad Request"),
        }
    }

    fn on_aborted(this: *mut Self, _: AnyResponse) {
        // SAFETY: `this` is the box from `read_body`. The socket is closed, so uWS calls neither
        // handler again.
        unsafe { bun_core::heap::destroy(this) };
    }

    /// A body that arrives in one chunk is not copied.
    fn append(&mut self, chunk: &[u8], last: bool) -> crate::Result<()> {
        if self.body.len().saturating_add(chunk.len()) > MAX_BODY_SIZE {
            return Err(crate::Error::RequestBodyTooLarge);
        }
        if last && self.body.is_empty() {
            return Ok(());
        }
        // `try_reserve`, so that running out of memory is a 500 instead of an abort.
        if self.body.try_reserve(chunk.len()).is_err() {
            return Err(crate::Error::Alloc(bun_alloc::AllocError));
        }
        self.body.extend_from_slice(chunk);
        Ok(())
    }

    fn fail(resp: AnyResponse, status: &[u8]) {
        resp.clear_on_writable();
        resp.write_status(status);
        resp.end_without_body(true);
    }
}
