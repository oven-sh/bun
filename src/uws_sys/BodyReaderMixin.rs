use core::marker::PhantomData;
use core::mem;

use crate::response::Response;
use crate::AnyResponse;

/// Response types that can drive a `BodyReaderMixin`: must support registering
/// data/abort callbacks and converting to `AnyResponse`. Stands in for the Zig
/// `anytype` parameter on `readBody`.
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
        // `From<*mut Response<{true,false}>>` exist as two concrete impls, not a
        // const-generic one, so dispatch on `SSL` here. Same shape as Zig's
        // `AnyResponse.init` switching on @TypeOf.
        if SSL {
            AnyResponse::SSL((self as *mut Self).cast())
        } else {
            AnyResponse::TCP((self as *mut Self).cast())
        }
    }
}

/// Mixin to read an entire request body into memory and run a callback.
/// Consumers should make sure a reference count is held on the server,
/// and is unreferenced after one of the two callbacks are called.
///
/// See `DevServer`'s `ErrorReportRequest` for an example.
///
/// In Zig this was a `fn(...) type` taking a comptime `field` name and two
/// comptime fn pointers (`onBody`, `onError`). In Rust those are expressed as
/// a trait the wrapper type implements, plus an associated `MIXIN_OFFSET`
/// const replacing the comptime `field` name used by `@fieldParentPtr`.
pub trait BodyReaderHandler: Sized {
    /// Byte offset of the `BodyReaderMixin<Self>` field within `Self`.
    /// Implementors should set this to `core::mem::offset_of!(Self, <field>)`.
    const MIXIN_OFFSET: usize;

    /// `body` is freed after this function returns.
    fn on_body(&mut self, body: &[u8], resp: AnyResponse) -> Result<(), bun_core::Error>;

    /// Called on error or request abort.
    fn on_error(&mut self);
}

pub struct BodyReaderMixin<Wrap: BodyReaderHandler> {
    body: Vec<u8>,
    _wrap: PhantomData<Wrap>,
}

impl<Wrap: BodyReaderHandler> BodyReaderMixin<Wrap> {
    pub fn init() -> Self {
        Self {
            body: Vec::new(),
            _wrap: PhantomData,
        }
    }

    /// Memory is freed after the callback returns, or automatically on failure.
    pub fn read_body<R: BodyResponse>(&mut self, resp: &mut R) {
        let ctx: *mut Self = self;
        resp.on_data(Self::on_data_generic::<R>, ctx);
        resp.on_aborted(Self::on_aborted_handler::<R>, ctx);
    }

    fn on_data_generic<R: BodyResponse>(mixin: *mut Self, r: &mut R, chunk: &[u8], last: bool) {
        let any = r.to_any();
        // SAFETY: mixin was registered via read_body and remains alive for the request duration.
        let this = unsafe { &mut *mixin };
        match this.on_data(any, chunk, last) {
            Ok(()) => {}
            // Match Zig's `error.OutOfMemory => onOOM, else => onInvalid` by error
            // *kind* only — `bun_core::Error`'s derived `PartialEq` compares all
            // fields (syscall/fd/path), and `err!("OutOfMemory")` is currently a
            // TODO sentinel, so a full-struct compare would invert the branch.
            Err(e) if e.errno == bun_core::Error::OUT_OF_MEMORY.errno => this.on_oom(any),
            Err(_) => this.on_invalid(any),
        }
    }

    fn on_aborted_handler<R>(mixin: *mut Self, _r: &mut R) {
        // SAFETY: mixin was registered via read_body and remains alive for the request duration.
        let this = unsafe { &mut *mixin };
        this.body = Vec::new();
        // SAFETY: mixin points to the BodyReaderMixin field embedded in Wrap at MIXIN_OFFSET.
        unsafe { (*Self::parent(mixin)).on_error() };
    }

    fn on_data(
        &mut self,
        resp: AnyResponse,
        chunk: &[u8],
        last: bool,
    ) -> Result<(), bun_core::Error> {
        if last {
            // Free everything after
            let mut body = mem::take(&mut self.body);
            resp.clear_on_data();
            // SAFETY: self points to the BodyReaderMixin field embedded in Wrap at MIXIN_OFFSET.
            let wrap = unsafe { &mut *Self::parent(self as *mut Self) };
            if !body.is_empty() {
                // TODO(port): Zig handled OOM gracefully here; Vec::extend_from_slice aborts.
                // Consider try_reserve in Phase B if graceful 500 on OOM is required.
                body.extend_from_slice(chunk);
                wrap.on_body(body.as_slice(), resp)?;
            } else {
                wrap.on_body(chunk, resp)?;
            }
            // `body` drops here (was `defer body.deinit()` in Zig)
            Ok(())
        } else {
            self.body.extend_from_slice(chunk);
            Ok(())
        }
    }

    fn on_oom(&mut self, r: AnyResponse) {
        let _body = mem::take(&mut self.body);
        drop(_body);
        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"500 Internal Server Error");
        r.end_without_body(false);

        // SAFETY: self points to the BodyReaderMixin field embedded in Wrap at MIXIN_OFFSET.
        unsafe { (*Self::parent(self as *mut Self)).on_error() };
    }

    fn on_invalid(&mut self, r: AnyResponse) {
        let _body = mem::take(&mut self.body);
        drop(_body);

        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"400 Bad Request");
        r.end_without_body(false);

        // SAFETY: self points to the BodyReaderMixin field embedded in Wrap at MIXIN_OFFSET.
        unsafe { (*Self::parent(self as *mut Self)).on_error() };
    }

    #[inline]
    unsafe fn parent(ctx: *mut Self) -> *mut Wrap {
        // SAFETY: caller guarantees ctx is the BodyReaderMixin field embedded at
        // Wrap::MIXIN_OFFSET inside a live Wrap (Zig: @fieldParentPtr(field, ctx)).
        unsafe { (ctx as *mut u8).sub(Wrap::MIXIN_OFFSET).cast::<Wrap>() }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/BodyReaderMixin.zig (94 lines)
//   confidence: medium
//   todos:      3
//   notes:      comptime type-fn + fn-pointer params + @fieldParentPtr reshaped into trait BodyReaderHandler with MIXIN_OFFSET const; uws Response generic bound left for Phase B
// ──────────────────────────────────────────────────────────────────────────
