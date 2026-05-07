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
pub trait BodyReaderHandler: Sized + 'static {
    /// Byte offset of the `BodyReaderMixin<Self>` field within `Self`.
    /// Implementors should set this to `core::mem::offset_of!(Self, <field>)`.
    const MIXIN_OFFSET: usize;

    /// `body` is freed after this function returns.
    ///
    /// Receives the original `Box::into_raw`'d pointer (full-allocation
    /// provenance) rather than `&mut self`: implementors typically free `Self`
    /// (`Box::from_raw`) on the success path, and doing so through a
    /// `&mut self`-derived pointer is UB under Stacked/Tree Borrows. This
    /// mirrors Zig's `fn(*Wrap, ...)` callback shape exactly.
    ///
    /// SAFETY: `this` is the pointer previously passed to
    /// `BodyReaderMixin::read_body`; it is live and uniquely owned by the
    /// mixin until this call (no other `&mut` into the allocation is live).
    unsafe fn on_body(this: *mut Self, body: &[u8], resp: AnyResponse) -> Result<(), bun_core::Error>;

    /// Called on error or request abort. Same provenance contract as `on_body`.
    ///
    /// SAFETY: see `on_body`.
    unsafe fn on_error(this: *mut Self);
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
    ///
    /// Takes `*mut Wrap` (not `&mut self`) so the registered C user_data carries
    /// provenance for the *entire* enclosing `Wrap`, not just the mixin field.
    /// Zig used `@fieldParentPtr(field, ctx)` which has no provenance/aliasing
    /// restriction; in Rust, deriving the parent by `.sub(MIXIN_OFFSET)` from a
    /// `&mut self`-sourced pointer is out-of-provenance under Stacked Borrows
    /// and the resulting `&mut Wrap` would overlap a live `&mut Self`. Callers
    /// pass the `Box::into_raw`'d wrapper pointer directly; trampolines below
    /// reach the mixin via *forward* offset (`mixin_of`), so the stored pointer
    /// already has full-Wrap provenance and no overlapping `&mut` are formed.
    pub fn read_body<R: BodyResponse>(wrap: *mut Wrap, resp: &mut R) {
        resp.on_data(Self::on_data_generic::<R>, wrap);
        resp.on_aborted(Self::on_aborted_handler::<R>, wrap);
    }

    /// Forward offset `Wrap` → its embedded mixin field. Inverse direction of
    /// Zig's `@fieldParentPtr` — we go parent→field because the stored user_data
    /// is the parent (full provenance), never the field.
    #[inline]
    unsafe fn mixin_of(wrap: *mut Wrap) -> *mut Self {
        // SAFETY: caller guarantees `wrap` points to a live Wrap; MIXIN_OFFSET
        // is `offset_of!(Wrap, <field>)`, so the result is in-bounds and
        // inherits `wrap`'s provenance over the whole allocation.
        unsafe { wrap.byte_add(Wrap::MIXIN_OFFSET).cast::<Self>() }
    }

    fn on_data_generic<R: BodyResponse>(wrap: *mut Wrap, r: &mut R, chunk: &[u8], last: bool) {
        let any = r.to_any();
        match Self::on_data(wrap, any, chunk, last) {
            Ok(()) => {}
            // Match Zig's `error.OutOfMemory => onOOM, else => onInvalid` by error
            // *kind* only — `bun_core::Error`'s derived `PartialEq` compares all
            // fields (syscall/fd/path), and `err!("OutOfMemory")` is currently a
            // TODO sentinel, so a full-struct compare would invert the branch.
            Err(e) if e == bun_core::Error::OUT_OF_MEMORY => Self::on_oom(wrap, any),
            Err(_) => Self::on_invalid(wrap, any),
        }
    }

    fn on_aborted_handler<R>(wrap: *mut Wrap, _r: &mut R) {
        // SAFETY: wrap was registered via read_body and remains alive for the
        // request duration; mixin_of yields an in-bounds field pointer.
        unsafe { (*Self::mixin_of(wrap)).body = Vec::new() };
        // SAFETY: wrap is the original Box::into_raw'd pointer; the temporary
        // &mut to the mixin field above has ended, so on_error receives sole
        // ownership of the allocation and may Box::from_raw it.
        unsafe { Wrap::on_error(wrap) };
    }

    fn on_data(
        wrap: *mut Wrap,
        resp: AnyResponse,
        chunk: &[u8],
        last: bool,
    ) -> Result<(), bun_core::Error> {
        // SAFETY: wrap was registered via read_body with full-Wrap provenance.
        let mixin = unsafe { Self::mixin_of(wrap) };
        if last {
            // Free everything after. Take via raw mixin ptr first — no `&mut Wrap`
            // is live yet, so this short-lived field borrow does not overlap one.
            // SAFETY: mixin is an in-bounds field of *wrap.
            let mut body = unsafe { mem::take(&mut (*mixin).body) };
            resp.clear_on_data();
            // SAFETY: wrap is live; the &mut to mixin.body has ended, so this
            // `&mut Wrap` is the sole live mutable reference into the allocation.
            let wrap_ref = unsafe { &mut *wrap };
            if !body.is_empty() {
                // TODO(port): Zig handled OOM gracefully here; Vec::extend_from_slice aborts.
                // Consider try_reserve in Phase B if graceful 500 on OOM is required.
                body.extend_from_slice(chunk);
                wrap_ref.on_body(body.as_slice(), resp)?;
            } else {
                wrap_ref.on_body(chunk, resp)?;
            }
            // `body` drops here (was `defer body.deinit()` in Zig)
            Ok(())
        } else {
            // SAFETY: mixin is an in-bounds field of *wrap; no other &mut into
            // *wrap is live.
            unsafe { (*mixin).body.extend_from_slice(chunk) };
            Ok(())
        }
    }

    fn on_oom(wrap: *mut Wrap, r: AnyResponse) {
        // SAFETY: wrap was registered via read_body with full-Wrap provenance;
        // mixin_of yields an in-bounds field pointer and no other &mut into
        // *wrap is live.
        drop(unsafe { mem::take(&mut (*Self::mixin_of(wrap)).body) });
        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"500 Internal Server Error");
        r.end_without_body(false);

        // SAFETY: wrap is live; the &mut to mixin.body above has ended.
        unsafe { (*wrap).on_error() };
    }

    fn on_invalid(wrap: *mut Wrap, r: AnyResponse) {
        // SAFETY: wrap was registered via read_body with full-Wrap provenance;
        // mixin_of yields an in-bounds field pointer and no other &mut into
        // *wrap is live.
        drop(unsafe { mem::take(&mut (*Self::mixin_of(wrap)).body) });

        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"400 Bad Request");
        r.end_without_body(false);

        // SAFETY: wrap is live; the &mut to mixin.body above has ended.
        unsafe { (*wrap).on_error() };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/BodyReaderMixin.zig (94 lines)
//   confidence: medium
//   todos:      3
//   notes:      comptime type-fn + fn-pointer params + @fieldParentPtr reshaped into trait BodyReaderHandler with MIXIN_OFFSET const; uws Response generic bound left for Phase B
// ──────────────────────────────────────────────────────────────────────────
