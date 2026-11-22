//! `DeferredRequest`: a request waiting for a bundle to finish.

/// When requests are waiting on a bundle, the relevant request information is
/// prepared and stored in a linked list.
pub(crate) struct DeferredRequest {
    pub(crate) route_bundle_index: route_bundle::Index,
    handler: Cell<Handler>,
    /// Set when the request is made, and taken by `List::pop_first`.
    next: Cell<Option<Handle>>,
}

bun_output::define_scoped_log!(debug_log_dr, DlogeferredRequest, hidden);

use core::cell::Cell;

use super::*;

/// A small maximum is set because development servers are unlikely to
/// acquire much load, so allocating a ton at the start for no reason
/// is very silly. This contributes to ~6kb of the initial DevServer allocation.
pub(crate) const MAX_PREALLOCATED: usize = 16;

/// Held by a `List` and by the request's `RequestContext`, if it has one.
pub(crate) type Handle = bun_collections::HiveRefHandle<DeferredRequest, MAX_PREALLOCATED>;
pub(crate) type Node = bun_collections::HiveRef<DeferredRequest, MAX_PREALLOCATED>;

#[derive(Default)]
pub(crate) struct List {
    first: Option<Handle>,
}

impl List {
    pub(super) fn first(&self) -> Option<&DeferredRequest> {
        self.first.as_deref()
    }

    pub(super) fn pop_first(&mut self) -> Option<Handle> {
        let first = self.first.take()?;
        self.first = first.next.take();
        Some(first)
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &DeferredRequest> {
        core::iter::successors(self.first(), |request| {
            // SAFETY: `request` is in this list only, and `pop_first` borrows the list exclusively.
            unsafe { &*request.next.as_ptr() }.as_deref()
        })
    }
}

impl DevServer {
    pub(super) fn queue_request(
        &mut self,
        queue: BundleQueueType,
        route_bundle_index: route_bundle::Index,
        handler: Handler,
    ) -> &Handle {
        let list = match queue {
            BundleQueueType::CurrentBundle => {
                &mut self
                    .current_bundle
                    .as_mut()
                    .expect("infallible: bundle active")
                    .requests
            }
            BundleQueueType::NextBundle => &mut self.next_bundle.requests,
        };
        let request = DeferredRequest {
            route_bundle_index,
            handler: Cell::new(handler),
            next: Cell::new(list.first.take()),
        };
        // SAFETY: `Drop` empties the lists before the pool goes. Every other handle is held during a
        // pending request of the server, which keeps `self` until it has none.
        list.first
            .insert(unsafe { Handle::new(request, &raw const self.deferred_request_pool) })
    }
}

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
    /// Leaves `Handler::Aborted`.
    pub(super) fn take_handler(&self) -> Handler {
        self.handler.replace(Handler::Aborted)
    }

    pub(crate) fn on_abort(&self) {
        debug_log_dr!("DeferredRequest({:p}) onAbort", self);
        self.take_handler().abort();
    }
}

impl Handler {
    /// Dropping `self` completes the request, so the caller responds first.
    pub(super) fn detach_response_for_error_page(&self) -> Option<AnyResponse> {
        match self {
            Handler::Aborted => None,
            Handler::ServerHandler(saved) => {
                saved.ctx.detach_response();
                Some(saved.response)
            }
            Handler::BundledHtmlPage(ram) => Some(ram.response),
        }
    }

    /// Ends the response, which removes the abort callback that points to the request.
    pub(super) fn fail(self) {
        if let Handler::ServerHandler(saved) = self {
            saved.ctx.end_with_internal_server_error();
        } else {
            self.abort();
        }
    }

    /// Deinitializes state by aborting the connection.
    fn abort(self) {
        match self {
            Handler::ServerHandler(saved) => {
                debug_log_dr!(
                    "  request url: {}",
                    bstr::BStr::new(saved.request.url.get().byte_slice())
                );
                saved
                    .ctx
                    .set_signal_aborted(jsc::CommonAbortReason::ConnectionClosed);
            }
            Handler::BundledHtmlPage(r) => {
                // Reached from JS event-loop tasks (on_plugins_rejected, the
                // bundle-completion OOM cleanup), so end_without_body
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

/// A client script request waiting for the in-flight bundle to finish, even if that bundle doesn't include its route.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct DeferredScriptRequest {
    pub(super) ref_count: ::core::cell::Cell<u32>,
    pub(super) route_bundle_index: route_bundle::Index,
    /// Parsed from the request URL.
    pub(super) generation: u32,
    /// `None` once the client has disconnected.
    pub(super) response: ::core::cell::Cell<Option<ResponseAndMethod>>,
}
