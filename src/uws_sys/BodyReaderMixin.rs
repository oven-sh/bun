use core::marker::PhantomData;
use core::mem;

use crate::AnyResponse;
use crate::response::Response;

/// Response types that can drive a `BodyReaderMixin`: must support registering
/// data/abort callbacks.
///
/// Only `Response<SSL>` is wired today (DevServer's only consumer is HTTP/1.x).
pub trait BodyResponse: Sized + 'static {
    fn on_data<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, AnyResponse, &[u8], bool) + Copy + 'static;
    fn on_aborted<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, AnyResponse) + Copy + 'static;
}

impl<const SSL: bool> BodyResponse for Response<SSL> {
    #[inline]
    fn on_data<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, AnyResponse, &[u8], bool) + Copy + 'static,
    {
        Response::<SSL>::on_data(self, handler, ctx)
    }
    #[inline]
    fn on_aborted<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, AnyResponse) + Copy + 'static,
    {
        Response::<SSL>::on_aborted(self, handler, ctx)
    }
}

/// Mixin to read an entire request body into memory and run a callback.
/// Consumers should make sure a reference count is held on the server,
/// and is unreferenced when the wrapper is dropped.
///
/// See `DevServer`'s `ErrorReportRequest` for an example.
pub trait BodyReaderHandler: Sized + 'static {
    fn mixin(&mut self) -> &mut BodyReaderMixin<Self>;

    /// `body` is freed after this function returns.
    /// Must not close the socket while `resp` has the mixin's abort handler, and must not return `Ok` with it still set.
    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> crate::Result<()>;
}

pub struct BodyReaderMixin<Wrap: BodyReaderHandler> {
    body: Vec<u8>,
    _wrap: PhantomData<Wrap>,
}

const MAX_BODY_SIZE: usize = 1024 * 1024 * 128;

impl<Wrap: BodyReaderHandler> BodyReaderMixin<Wrap> {
    pub fn init() -> Self {
        Self {
            body: Vec::new(),
            _wrap: PhantomData,
        }
    }

    /// Memory is freed after the callback returns, or automatically on failure.
    pub fn read_body<R: BodyResponse>(wrap: Box<Wrap>, resp: &mut R) {
        let wrap = bun_core::heap::into_raw(wrap);
        resp.on_data(Self::on_data_generic, wrap);
        resp.on_aborted(Self::on_aborted_handler, wrap);
    }

    fn on_data_generic(wrap: *mut Wrap, any: AnyResponse, chunk: &[u8], last: bool) {
        // SAFETY: `wrap` is the box from `read_body`. Only the abort handler reaches it too, and
        // it runs when the socket closes, which nothing in this call does while it is set.
        let this = unsafe { &mut *wrap };
        match Self::on_data(this, any, chunk, last) {
            Ok(()) if !last => return,
            Ok(()) => {}
            Err(crate::Error::Alloc(_)) => this.mixin().on_oom(any),
            Err(_) => this.mixin().on_invalid(any),
        }
        // SAFETY: `this` is not used again. uWS has no handler left that gets `wrap`: on `Ok`,
        // `on_data` cleared the data handler and `on_body` left no abort handler of the mixin;
        // `on_oom` and `on_invalid` cleared both.
        unsafe { bun_core::heap::destroy(wrap) };
    }

    fn on_aborted_handler(wrap: *mut Wrap, _r: AnyResponse) {
        // SAFETY: `wrap` is the box from `read_body`. The socket is closed, so uWS calls neither
        // handler again.
        unsafe { bun_core::heap::destroy(wrap) };
    }

    fn on_data(this: &mut Wrap, resp: AnyResponse, chunk: &[u8], last: bool) -> crate::Result<()> {
        if last {
            // Free everything after.
            let mut body = mem::take(&mut this.mixin().body);
            resp.clear_on_data();
            if !body.is_empty() {
                if body.len().saturating_add(chunk.len()) > MAX_BODY_SIZE {
                    return Err(crate::Error::RequestBodyTooLarge);
                }
                // Handle OOM gracefully here (error → 500); use try_reserve so
                // allocation failure surfaces as an error instead of an abort.
                if body.try_reserve(chunk.len()).is_err() {
                    return Err(crate::Error::Alloc(bun_alloc::AllocError));
                }
                body.extend_from_slice(chunk);
                this.on_body(body.as_slice(), resp)?;
            } else {
                if chunk.len() > MAX_BODY_SIZE {
                    return Err(crate::Error::RequestBodyTooLarge);
                }
                this.on_body(chunk, resp)?;
            }
            // `body` drops here
            Ok(())
        } else {
            let body = &mut this.mixin().body;
            if body.len().saturating_add(chunk.len()) > MAX_BODY_SIZE {
                return Err(crate::Error::RequestBodyTooLarge);
            }
            // Propagate OOM here too
            // (error → 500); use try_reserve so allocation failure surfaces as an
            // error instead of an abort.
            if body.try_reserve(chunk.len()).is_err() {
                return Err(crate::Error::Alloc(bun_alloc::AllocError));
            }
            body.extend_from_slice(chunk);
            Ok(())
        }
    }

    fn on_oom(&mut self, r: AnyResponse) {
        drop(mem::take(&mut self.body));
        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"500 Internal Server Error");
        r.end_without_body(true);
    }

    fn on_invalid(&mut self, r: AnyResponse) {
        drop(mem::take(&mut self.body));

        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"400 Bad Request");
        r.end_without_body(true);
    }
}
