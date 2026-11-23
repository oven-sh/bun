use crate::AnyResponse;
use crate::response::Response;

/// Response types that can drive a `BodyReaderMixin`: must support registering
/// data/abort callbacks and converting to `AnyResponse`.
///
/// Only `Response<SSL>` is wired today (DevServer's only consumer is HTTP/1.x).
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

/// Dropped once the request is answered or aborted.
pub trait BodyReaderHandler: 'static {
    fn on_body(&self, body: &[u8], resp: AnyResponse) -> crate::Result<()>;
}

/// Reads an entire request body into memory and runs a callback.
pub struct BodyReaderMixin<H: BodyReaderHandler> {
    handler: H,
    body: Vec<u8>,
}

const MAX_BODY_SIZE: usize = 1024 * 1024 * 128;

impl<H: BodyReaderHandler> BodyReaderMixin<H> {
    pub fn read_body<R: BodyResponse>(handler: H, resp: &mut R) {
        let this = bun_core::heap::into_raw(Box::new(Self {
            handler,
            body: Vec::new(),
        }));
        resp.on_data(Self::on_data::<R>, this);
        resp.on_aborted(Self::on_aborted::<R>, this);
    }

    fn on_data<R: BodyResponse>(this: *mut Self, r: &mut R, chunk: &[u8], last: bool) {
        let resp = r.to_any();
        // SAFETY: the box from `read_body`. `read` disarms both callbacks before it answers.
        let result = unsafe { (*this).read(resp, chunk, last) };
        if let Err(err) = &result {
            resp.clear_aborted();
            resp.clear_on_data();
            resp.clear_on_writable();
            resp.write_status(match err {
                crate::Error::Alloc(_) => b"500 Internal Server Error",
                _ => b"400 Bad Request",
            });
            resp.end_without_body(true);
        }
        if last || result.is_err() {
            // SAFETY: both callbacks are disarmed.
            unsafe { bun_core::heap::destroy(this) };
        }
    }

    fn on_aborted<R>(this: *mut Self, _r: &mut R) {
        // SAFETY: the box from `read_body`; no callback follows an abort.
        unsafe { bun_core::heap::destroy(this) };
    }

    fn read(&mut self, resp: AnyResponse, chunk: &[u8], last: bool) -> crate::Result<()> {
        if last {
            // Clears the user data, which `on_aborted` shares.
            resp.clear_on_data();
        }
        if self.body.len().saturating_add(chunk.len()) > MAX_BODY_SIZE {
            return Err(crate::Error::RequestBodyTooLarge);
        }
        if last && self.body.is_empty() {
            return self.handler.on_body(chunk, resp);
        }
        // Answered with a 500 instead of aborting the process.
        self.body
            .try_reserve(chunk.len())
            .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?;
        self.body.extend_from_slice(chunk);
        if last {
            return self.handler.on_body(&self.body, resp);
        }
        Ok(())
    }
}
