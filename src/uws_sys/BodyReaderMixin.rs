use core::marker::PhantomData;
use core::mem;

use crate::AnyResponse;

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
    pub fn read_body<R>(&mut self, resp: R)
    where
        // TODO(port): bound R by the uws Response trait (must provide
        // on_data/on_aborted and be convertible via AnyResponse::init)
        R: Copy,
    {
        let ctx: *mut Self = self;
        // TODO(port): exact on_data/on_aborted signatures from bun_uws_sys Response wrapper
        resp.on_data(Self::on_data_generic::<R>, ctx);
        resp.on_aborted(Self::on_aborted_handler::<R>, ctx);
    }

    fn on_data_generic<R: Copy>(mixin: *mut Self, r: R, chunk: &[u8], last: bool) {
        let any = AnyResponse::init(r);
        // SAFETY: mixin was registered via read_body and remains alive for the request duration.
        let this = unsafe { &mut *mixin };
        match this.on_data(any, chunk, last) {
            Ok(()) => {}
            Err(e) if e == bun_core::err!("OutOfMemory") => this.on_oom(any),
            Err(_) => this.on_invalid(any),
        }
    }

    fn on_aborted_handler<R>(mixin: *mut Self, _r: R) {
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
