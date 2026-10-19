//! `DeferredRequest`: a request waiting for a bundle to finish.

/// When requests are waiting on a bundle, the relevant request information is
/// prepared and stored in a linked list.
pub(crate) struct DeferredRequest {
    pub(crate) route_bundle_index: route_bundle::Index,
    pub(crate) handler: Handler,
    pub(crate) dev: *const DevServer, // BACKREF: owned by dev.deferred_request_pool

    /// This struct can be referenced by the dev server (`dev.current_bundle.requests`)
    pub(crate) referenced_by_devserver: bool,
    pub(crate) weakly_referenced_by_requestcontext: bool,
}

bun_output::define_scoped_log!(debug_log_dr, DlogeferredRequest, hidden);

use super::*;

/// A small maximum is set because development servers are unlikely to
/// acquire much load, so allocating a ton at the start for no reason
/// is very silly. This contributes to ~6kb of the initial DevServer allocation.
pub(crate) const MAX_PREALLOCATED: usize = 16;

pub(crate) type List = bun_collections::pool::SinglyLinkedList<DeferredRequest>;
pub(crate) type Node = bun_collections::pool::Node<DeferredRequest>;

pub(crate) enum Handler {
    /// For a .framework route. This says to call and render the page.
    ServerHandler(SavedRequest),
    /// For a .html route. Serve the bundled HTML page.
    BundledHtmlPage(ResponseAndMethod),
    /// Do nothing and free this node. To simplify lifetimes,
    /// the `DeferredRequest` is not freed upon abortion. Which
    /// is okay since most requests do not abort.
    Aborted,
}

/// Does not include `aborted` because branching on that value
/// has no meaningful purpose, so it is excluded.
#[derive(Copy, Clone)]
pub(crate) enum HandlerKind {
    ServerHandler,
    BundledHtmlPage,
}

impl DeferredRequest {
    pub(crate) const MAX_PREALLOCATED: usize = MAX_PREALLOCATED;

    pub(crate) fn is_alive(&self) -> bool {
        self.referenced_by_devserver
    }

    // NOTE: This should only be called from the DevServer which is the only
    // place that can hold a strong reference
    pub(crate) fn deref_(&mut self) {
        self.referenced_by_devserver = false;
        let should_free = !self.weakly_referenced_by_requestcontext;
        self.__deinit();
        if should_free {
            self.__free();
        }
    }

    pub(crate) fn weak_ref(&mut self) {
        debug_assert!(!self.weakly_referenced_by_requestcontext);
        self.weakly_referenced_by_requestcontext = true;
    }

    pub(crate) fn weak_deref(&mut self) {
        self.weakly_referenced_by_requestcontext = false;
        if !self.referenced_by_devserver {
            self.__free();
        }
    }

    pub(super) fn on_abort_wrapper(this: *mut c_void) {
        // SAFETY: this is &mut DeferredRequest registered in defer_request
        let self_ = unsafe { bun_ptr::callback_ctx::<DeferredRequest>(this) };
        if !self_.is_alive() {
            return;
        }
        self_.on_abort_impl();
    }

    pub(super) fn on_abort(&mut self, _: AnyResponse) {
        self.on_abort_impl();
    }

    fn on_abort_impl(&mut self) {
        debug_log_dr!(
            "DeferredRequest(0x{:x}) onAbort",
            std::ptr::from_ref(self) as usize
        );
        self.abort();
        debug_assert!(matches!(self.handler, Handler::Aborted));
    }

    /// Actually free the underlying allocation for the node, does not deinitialize children
    fn __free(&mut self) {
        // SAFETY: self is the .data field of a Node in deferred_request_pool
        let node = unsafe { bun_core::from_field_ptr!(Node, data, std::ptr::from_mut(self)) };
        // SAFETY: dev backref is valid while the pool entry exists; `node` is a
        // fully-initialized hive slot. `pool::Node<T>` has no drop glue (`data`
        // is `MaybeUninit`), so `put`'s in-place drop is a no-op — `__deinit`
        // already tore down the payload.
        unsafe {
            (*self.dev.cast_mut()).deferred_request_pool.put(node);
        }
    }

    /// *WARNING*: Do not call this directly, instead call `.deref_()`
    fn __deinit(&mut self) {
        debug_log_dr!(
            "DeferredRequest(0x{:x}) deinitImpl",
            std::ptr::from_ref(self) as usize
        );
        // Note: the pool stores `MaybeUninit<DeferredRequest>` (no `Drop`),
        // so the `Handler` payload must be torn down explicitly here. Swap to
        // `Aborted` (zero-payload) and let the moved-out value drop — for
        // `ServerHandler` this releases `saved.js_request: Strong`.
        let handler = ::core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(mut saved) => {
                saved.deinit();
                // `saved` (incl. `js_request: jsc::Strong`) drops at scope exit.
            }
            Handler::BundledHtmlPage(_) | Handler::Aborted => {}
        }
    }

    /// Deinitializes state by aborting the connection.
    pub(super) fn abort(&mut self) {
        debug_log_dr!(
            "DeferredRequest(0x{:x}) abort",
            std::ptr::from_ref(self) as usize
        );
        let handler = ::core::mem::replace(&mut self.handler, Handler::Aborted);
        match handler {
            Handler::ServerHandler(saved) => {
                debug_log_dr!(
                    "  request url: {}",
                    // SAFETY: saved.request is a live *mut webcore::Request (held strong by ctx)
                    bstr::BStr::new(unsafe { (*saved.request).url.get() }.byte_slice())
                );
                saved
                    .ctx
                    .set_signal_aborted(jsc::CommonAbortReason::ConnectionClosed);
                // Note: saved.js_request (jsc::Strong) drops at end of arm
                drop(saved);
            }
            Handler::BundledHtmlPage(r) => {
                // Reached from JS event-loop tasks (on_plugins_rejected, the
                // bundle-completion OOM cleanup defer), so end_without_body
                // alone cannot close the socket; write Content-Length so the
                // client has framing.
                r.response.write_status(b"500 Internal Server Error");
                r.response.write_header_int(b"Content-Length", 0);
                r.response.end_without_body(true);
            }
            Handler::Aborted => {}
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) struct ResponseAndMethod {
    pub response: AnyResponse,
    pub method: Method,
}
