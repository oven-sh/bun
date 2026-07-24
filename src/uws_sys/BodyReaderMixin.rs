use core::marker::PhantomData;
use core::mem;

use crate::AnyResponse;
use crate::response::Response;

/// Response types that can drive a `BodyReaderMixin`: must support registering
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
        // `From<*mut Response<{true,false}>>` exist as two concrete impls, not a
        // const-generic one, so dispatch on `SSL` here.
        if SSL {
            AnyResponse::SSL(std::ptr::from_mut::<Self>(self).cast())
        } else {
            AnyResponse::TCP(std::ptr::from_mut::<Self>(self).cast())
        }
    }
}

/// Mixin to read an entire request body into memory and run a callback.
/// Consumers should make sure a reference count is held on the server,
/// and is unreferenced after one of the two callbacks are called.
///
/// See `DevServer`'s `ErrorReportRequest` for an example.
///
/// The wrapper type implements this trait; the intrusive field is declared
/// via the [`bun_core::IntrusiveField`] supertrait (implement via
/// `bun_core::intrusive_field!`).
pub trait BodyReaderHandler: bun_core::IntrusiveField<BodyReaderMixin<Self>> + 'static {
    /// `body` is freed after this function returns.
    ///
    /// Receives the original `heap::alloc`'d pointer (full-allocation
    /// provenance) rather than `&mut self`: implementors typically free `Self`
    /// (`heap::take`) on the success path, and doing so through a
    /// `&mut self`-derived pointer is UB under Stacked/Tree Borrows.
    ///
    /// SAFETY: `this` is the pointer previously passed to
    /// `BodyReaderMixin::read_body`; it is live and uniquely owned by the
    /// mixin until this call (no other `&mut` into the allocation is live).
    unsafe fn on_body(this: *mut Self, body: &[u8], resp: AnyResponse) -> crate::Result<()>;

    /// Called on error or request abort. Same provenance contract as `on_body`.
    ///
    /// SAFETY: see `on_body`.
    unsafe fn on_error(this: *mut Self);
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
    ///
    /// Takes `*mut Wrap` (not `&mut self`) so the registered C user_data carries
    /// provenance for the *entire* enclosing `Wrap`, not just the mixin field.
    /// Deriving the parent by `.byte_sub(OFFSET)` from a
    /// `&mut self`-sourced pointer is out-of-provenance under Stacked Borrows
    /// and the resulting `&mut Wrap` would overlap a live `&mut Self`. Callers
    /// pass the `heap::alloc`'d wrapper pointer directly; trampolines below
    /// reach the mixin via *forward* offset (`mixin_of`), so the stored pointer
    /// already has full-Wrap provenance and no overlapping `&mut` are formed.
    pub fn read_body<R: BodyResponse>(wrap: *mut Wrap, resp: &mut R) {
        resp.on_data(Self::on_data_generic::<R>, wrap);
        resp.on_aborted(Self::on_aborted_handler::<R>, wrap);
    }

    /// Forward offset `Wrap` → its embedded mixin field, materialised as `&mut`.
    /// We go parent→field because
    /// the stored user_data is the parent (full provenance), never the field.
    ///
    /// Single nonnull-asref accessor for the set-once `wrap` user-data.
    ///
    /// Type invariant (encapsulated `unsafe`): every `*mut Wrap` reaching this
    /// fn is the heap-allocated pointer registered by [`Self::read_body`] as
    /// the uWS user-data; uWS dispatch is single-threaded and the only access
    /// path to the allocation is via these crate-private trampolines, so no
    /// other `&`/`&mut` into `*wrap` is live for the returned borrow's
    /// duration. Each caller drops the returned `&mut Self` (NLL temporary)
    /// before any `Wrap::on_body`/`on_error` call that may `heap::take(wrap)`.
    /// Crate-private — collapses the per-call-site proof into this one block.
    #[inline]
    fn mixin_of<'a>(wrap: *mut Wrap) -> &'a mut Self {
        // SAFETY: type invariant — see doc comment above. `IntrusiveField::OFFSET`
        // is `offset_of!(Wrap, <field>)`, so the result is in-bounds and inherits
        // `wrap`'s provenance over the whole allocation.
        unsafe { &mut *Wrap::field_of(wrap) }
    }

    fn on_data_generic<R: BodyResponse>(wrap: *mut Wrap, r: &mut R, chunk: &[u8], last: bool) {
        let any = r.to_any();
        match Self::on_data(wrap, any, chunk, last) {
            Ok(()) => {}
            Err(crate::Error::Alloc(_)) => Self::on_oom(wrap, any),
            Err(_) => Self::on_invalid(wrap, any),
        }
    }

    fn on_aborted_handler<R>(wrap: *mut Wrap, _r: &mut R) {
        // The temporary `&mut` from `mixin_of` ends at the `;`, before
        // `on_error` (which may `heap::take(wrap)`).
        Self::mixin_of(wrap).body = Vec::new();
        // SAFETY: wrap is the original heap-allocated pointer; the temporary
        // &mut to the mixin field above has ended, so on_error receives sole
        // ownership of the allocation and may heap::take it.
        unsafe { Wrap::on_error(wrap) };
    }

    fn on_data(wrap: *mut Wrap, resp: AnyResponse, chunk: &[u8], last: bool) -> crate::Result<()> {
        if last {
            // Free everything after. Take via the mixin field first — no
            // `&mut Wrap` is live yet, and the temporary `&mut Self` ends at
            // the `;` (before `on_body`, which may heap::take(wrap)).
            let mut body = mem::take(&mut Self::mixin_of(wrap).body);
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
                // SAFETY: wrap is the original heap-allocated pointer; the &mut to
                // mixin.body has ended, so on_body receives sole ownership of the
                // allocation and may heap::take it on success.
                unsafe { Wrap::on_body(wrap, body.as_slice(), resp)? };
            } else {
                if chunk.len() > MAX_BODY_SIZE {
                    return Err(crate::Error::RequestBodyTooLarge);
                }
                // SAFETY: wrap is the original heap-allocated pointer; the &mut to
                // mixin.body has ended, so on_body receives sole ownership of the
                // allocation and may heap::take it on success.
                unsafe { Wrap::on_body(wrap, chunk, resp)? };
            }
            // `body` drops here
            Ok(())
        } else {
            let body = &mut Self::mixin_of(wrap).body;
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

    fn on_oom(wrap: *mut Wrap, r: AnyResponse) {
        // The temporary `&mut` from `mixin_of` ends at the `;`, before
        // `on_error` (which may `heap::take(wrap)`).
        drop(mem::take(&mut Self::mixin_of(wrap).body));
        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"500 Internal Server Error");
        r.end_without_body(true);

        // SAFETY: wrap is the original heap-allocated pointer; the &mut to
        // mixin.body above has ended; on_error may heap::take it.
        unsafe { Wrap::on_error(wrap) };
    }

    fn on_invalid(wrap: *mut Wrap, r: AnyResponse) {
        // The temporary `&mut` from `mixin_of` ends at the `;`, before
        // `on_error` (which may `heap::take(wrap)`).
        drop(mem::take(&mut Self::mixin_of(wrap).body));

        r.clear_aborted();
        r.clear_on_data();
        r.clear_on_writable();

        r.write_status(b"400 Bad Request");
        r.end_without_body(true);

        // SAFETY: wrap is the original heap-allocated pointer; the &mut to
        // mixin.body above has ended; on_error may heap::take it.
        unsafe { Wrap::on_error(wrap) };
    }
}
