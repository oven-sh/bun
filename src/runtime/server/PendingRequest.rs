use core::ops::Deref;

use bun_ptr::BackRef;

use crate::server::{AnyServer, ServerLike};

/// A handle that leads to the same server for as long as it lives.
pub(crate) trait Served {
    fn served_by(&self) -> Option<AnyServer>;
}

impl Served for AnyServer {
    fn served_by(&self) -> Option<AnyServer> {
        Some(*self)
    }
}

impl<S: ServerLike> Served for BackRef<S> {
    fn served_by(&self) -> Option<AnyServer> {
        Some(self.as_any_server())
    }
}

/// Counts in the server's `pending_requests`, so the server stays open until this drops.
#[must_use]
pub(crate) struct PendingRequest<T: Served = AnyServer>(T);

impl<T: Served> PendingRequest<T> {
    pub(crate) fn new(served: T) -> Self {
        if let Some(server) = served.served_by() {
            server.on_pending_request();
        }
        Self(served)
    }
}

impl<T: Served> Deref for PendingRequest<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: Served> Drop for PendingRequest<T> {
    fn drop(&mut self) {
        if let Some(server) = self.0.served_by() {
            server.on_request_complete();
        }
    }
}
