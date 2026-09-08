use crate::AnyResponse;
use crate::response::Response;

/// Response types that can drive a [`BodyReader`]: must support registering
/// data/abort callbacks and converting to `AnyResponse`.
///
/// Only `Response<SSL>` is wired today (DevServer's only consumer is HTTP/1.x);
/// `h3::Response` can be added once its callback signatures are unified.
pub trait BodyResponse: Sized + 'static {
    fn on_data<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, &mut Self, &[u8], bool) + Copy + 'static;
    fn on_aborted<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, &mut Self) + Copy + 'static;
    fn to_any(&mut self) -> AnyResponse;
}

impl<const SSL: bool> BodyResponse for Response<SSL> {
    #[inline]
    fn on_data<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, &mut Self, &[u8], bool) + Copy + 'static,
    {
        Response::<SSL>::on_data(self, handler, ctx)
    }
    #[inline]
    fn on_aborted<U, H>(&mut self, handler: H, ctx: *mut U)
    where
        H: Fn(*mut U, &mut Self) + Copy + 'static,
    {
        Response::<SSL>::on_aborted(self, handler, ctx)
    }
    #[inline]
    fn to_any(&mut self) -> AnyResponse {
        Response::<SSL>::res_to_any(self.downcast())
    }
}

/// Receives a fully-buffered request body. Owned by the [`BodyReader`] from
/// [`BodyReader::read`] until the body arrives (then `on_body` runs once and
/// the handler is dropped) or the request errors/aborts (the handler is just
/// dropped) — so teardown belongs in `Drop`.
pub trait BodyReaderHandler: Sized + 'static {
    /// `body` is freed after this returns. On `Err` the reader answers the
    /// request with a 400/500.
    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> crate::Result<()>;
}

/// Reads an entire request body into memory and hands it to a
/// [`BodyReaderHandler`].
pub struct BodyReader<H: BodyReaderHandler> {
    handler: H,
    body: Vec<u8>,
}

const MAX_BODY_SIZE: usize = 1024 * 1024 * 128;

impl<H: BodyReaderHandler> BodyReader<H> {
    /// Start reading `resp`'s body; `handler` is owned by the in-flight read.
    pub fn read<R: BodyResponse>(handler: H, resp: &mut R) {
        let raw: *mut Self = bun_core::heap::into_raw(Box::new(Self {
            handler,
            body: Vec::new(),
        }));
        resp.on_data(Self::on_data::<R>, raw);
        resp.on_aborted(Self::on_aborted::<R>, raw);
    }

    /// Detach both callbacks and take the reader back. `raw` is the pointer
    /// registered by [`read`](Self::read); each uWS callback is the only path
    /// to it and this is called at most once per reader (the callbacks are
    /// cleared here, before anything can re-enter).
    fn finish<R: BodyResponse>(raw: *mut Self, r: &mut R) -> Box<Self> {
        let any = r.to_any();
        any.clear_on_data();
        any.clear_aborted();
        // SAFETY: see doc comment — `raw` is the live registration, reclaimed once.
        unsafe { bun_core::heap::take(raw) }
    }

    fn on_aborted<R: BodyResponse>(raw: *mut Self, r: &mut R) {
        drop(Self::finish(raw, r));
    }

    fn on_data<R: BodyResponse>(raw: *mut Self, r: &mut R, chunk: &[u8], last: bool) {
        let result = if last {
            let mut this = Self::finish(raw, r);
            let any = r.to_any();
            let result = if this.body.is_empty() {
                Self::check_len(0, chunk).and_then(|()| this.handler.on_body(chunk, any))
            } else {
                let mut body = core::mem::take(&mut this.body);
                Self::append(&mut body, chunk).and_then(|()| this.handler.on_body(&body, any))
            };
            drop(this);
            result
        } else {
            // SAFETY: `raw` is the live registration from `read`; uWS dispatch
            // is single-threaded and this borrow ends before returning to it.
            let this = unsafe { &mut *raw };
            match Self::append(&mut this.body, chunk) {
                Ok(()) => return,
                Err(e) => {
                    drop(Self::finish(raw, r));
                    Err(e)
                }
            }
        };
        match result {
            Ok(()) => {}
            Err(crate::Error::Alloc(_)) => Self::fail(r.to_any(), b"500 Internal Server Error"),
            Err(_) => Self::fail(r.to_any(), b"400 Bad Request"),
        }
    }

    fn check_len(have: usize, chunk: &[u8]) -> crate::Result<()> {
        if have.saturating_add(chunk.len()) > MAX_BODY_SIZE {
            return Err(crate::Error::RequestBodyTooLarge);
        }
        Ok(())
    }

    fn append(body: &mut Vec<u8>, chunk: &[u8]) -> crate::Result<()> {
        Self::check_len(body.len(), chunk)?;
        // Surface OOM as an error (→ 500) instead of aborting.
        if body.try_reserve(chunk.len()).is_err() {
            return Err(crate::Error::Alloc(bun_alloc::AllocError));
        }
        body.extend_from_slice(chunk);
        Ok(())
    }

    fn fail(r: AnyResponse, status: &[u8]) {
        r.clear_on_writable();
        r.write_status(status);
        r.end_without_body(true);
    }
}
