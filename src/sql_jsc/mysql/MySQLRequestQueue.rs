use crate::jsc::JSValue;
use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::JsCell;
use bun_ptr::{OwnedRef, ParentRef};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::cell::Cell;
use core::ptr::NonNull;

use crate::mysql::js_mysql_query::JSMySQLQuery;
// The queue's "connection" param is the JS-wrapper type (it calls
// `reset_connection_timeout`/`on_error` which live on the wrapper, plus
// `is_able_to_write` which forwards to the inner protocol struct).
use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;

bun_core::define_scoped_log!(debug, MySQLRequestQueue, visible);

// Each element is the queue's ref on that request; taking an element out with
// `read_item()` and dropping it is what releases the ref. (`LinearFifo` does
// not drop what it holds, so elements are only ever removed with `read_item`,
// and `Drop` below drains it.)
type Queue = LinearFifo<OwnedRef<JSMySQLQuery>, DynamicBuffer<OwnedRef<JSMySQLQuery>>>;

pub struct MySQLRequestQueue {
    // All fields are interior-mutable so `advance()` can mutate via the
    // `ParentRef<Self>` backref (yields `&Self`) without per-site `unsafe`
    // raw-pointer writes. The queue is single-JS-thread (embedded inside the
    // connection's `JsCell`), so `Cell`/`JsCell`'s `!Sync` story is fine.
    // `requests` uses `JsCell` (closure-scoped `with_mut`) since `LinearFifo`
    // mutators need `&mut Queue`.
    requests: JsCell<Queue>,

    pipelined_requests: Cell<u32>,
    nonpipelinable_requests: Cell<u32>,
    // TODO: refactor to ENUM
    waiting_to_prepare: Cell<bool>,
    is_ready_for_query: Cell<bool>,
}

impl MySQLRequestQueue {
    #[inline]
    pub(crate) fn can_execute_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query.get()
            && self.nonpipelinable_requests.get() == 0
            && self.pipelined_requests.get() == 0
    }

    #[inline]
    pub(crate) fn can_prepare_query(&self, connection: &MySQLConnection) -> bool {
        connection.is_able_to_write()
            && self.is_ready_for_query.get()
            && !self.waiting_to_prepare.get()
            && self.pipelined_requests.get() == 0
    }

    #[inline]
    pub(crate) fn mark_as_ready_for_query(&mut self) {
        self.is_ready_for_query.set(true);
    }

    #[inline]
    pub(crate) fn mark_as_prepared(&mut self) {
        self.waiting_to_prepare.set(false);
        if let Some(request) = self.current_ref() {
            debug!("markAsPrepared markAsPrepared");
            request.mark_as_prepared();
        }
    }

    #[inline]
    pub(crate) fn can_pipeline(&self, connection: &MySQLConnection) -> bool {
        // Feature flags are unset by default; `unwrap_or(false)` falls back to the
        // non-nullable defaulted `get()`.
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_SQL_AUTO_PIPELINING
            .get()
            .unwrap_or(false)
        {
            // @branchHint(.unlikely) — no stable Rust equivalent; left as plain branch.
            return false;
        }

        self.is_ready_for_query.get()
            && self.nonpipelinable_requests.get() == 0 // need to wait for non pipelinable requests to finish
            && !self.waiting_to_prepare.get()
            && connection.is_able_to_write()
    }

    pub(crate) fn mark_current_request_as_finished(&mut self, item: &JSMySQLQuery) {
        self.waiting_to_prepare.set(false);
        if item.is_being_prepared() {
            debug!("markCurrentRequestAsFinished markAsPrepared");
            item.mark_as_prepared();
        } else if item.is_running() {
            if item.is_pipelined() {
                self.pipelined_requests
                    .set(self.pipelined_requests.get() - 1);
            } else {
                self.nonpipelinable_requests
                    .set(self.nonpipelinable_requests.get() - 1);
            }
        }
    }

    /// takes only `connection` (the embedding `JSMySQLConnection`)
    /// and derives the queue backref locally. The queue is
    /// a field of `*connection` — but every `MySQLRequestQueue` field is
    /// interior-mutable (`Cell` / `JsCell`), so a `ParentRef<Self>` (yields
    /// `&Self` only) suffices for *all* access below; no `&mut Self` / raw
    /// `(*this)` writes are needed. `run()` / `is_able_to_write()` re-read
    /// queue scalars via `connection.can_execute_query()` etc., which is sound
    /// for the same reason (shared-only reborrows of `Cell`-wrapped state).
    pub(crate) fn advance(connection: NonNull<MySQLConnection>) {
        // R-2: every `JSMySQLConnection` method reached below is `&self`
        // (interior mutability), so a `ParentRef` (yields `&T` only) collapses
        // the per-site `unsafe { (*connection).… }` / `&*connection` derefs.
        let conn_ref = ParentRef::from(connection);
        // The inner protocol struct is wrapped in `JsCell` (`UnsafeCell`); its
        // `.queue` field is reached via shared borrow and re-wrapped as a
        // `ParentRef<Self>` so the borrow is detached from `conn_ref`'s
        // momentary `Deref` lifetime. All queue mutation below goes through
        // `Cell`/`JsCell` interior mutability — `&Self` is sufficient.
        let queue_ref: ParentRef<Self> = ParentRef::new(&conn_ref.connection.get().queue);
        // reshaped for borrowck — the cleanup that must run at function exit
        // became a post-block pass; early returns become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            while queue_ref.requests.get().readable_length() > offset && conn_ref.is_able_to_write()
            {
                // Copied out so no borrow of the fifo is held while the request
                // runs (it may re-enter and mutate the queue). The queue's ref
                // keeps the request live; `JSMySQLQuery` is a separate heap
                // allocation, so the `ParentRef` never aliases the queue or
                // `*connection`. R-2: every method reached below is `&self`.
                let request: NonNull<JSMySQLQuery> =
                    queue_ref.requests.get().peek_item_ref(offset).as_non_null();
                let req = ParentRef::from(request);

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    drop(queue_ref.requests.with_mut(|q| q.read_item()));
                    continue;
                }

                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    queue_ref.waiting_to_prepare.set(true);
                    // cannot continue the queue until the current request is marked as prepared
                    break 'advance;
                }
                if req.is_running() {
                    debug!("isRunning");
                    let total_requests_running = (queue_ref.pipelined_requests.get()
                        + queue_ref.nonpipelinable_requests.get())
                        as usize;
                    if offset < total_requests_running {
                        offset += total_requests_running;
                    } else {
                        offset += 1;
                    }
                    continue;
                }

                // `run()` *does* read queue scalars
                // (`can_execute_query`/`can_pipeline`/`can_prepare_query`),
                // but only through `conn_ref`'s shared reborrow into the same
                // `Cell`-wrapped fields — overlapping shared reads are sound.
                if let Err(err) = req.run(conn_ref.get()) {
                    debug!("run failed");
                    // R-2: `on_error` takes `&self`.
                    conn_ref.on_error(Some(req.get()), err);
                    // `on_error` may have re-entered and emptied or advanced the
                    // queue, so only release the head if it is still this request.
                    if offset == 0 && queue_ref.current() == Some(request) {
                        drop(queue_ref.requests.with_mut(|q| q.read_item()));
                    }
                    offset += 1;
                    continue;
                }
                if req.is_being_prepared() {
                    debug!("isBeingPrepared");
                    // R-2: `reset_connection_timeout` takes `&self`; touches
                    // timer state outside the queue.
                    conn_ref.reset_connection_timeout();
                    queue_ref.is_ready_for_query.set(false);
                    queue_ref.waiting_to_prepare.set(true);
                    break 'advance;
                } else if req.is_running() {
                    // R-2: `reset_connection_timeout` takes `&self`; touches
                    // timer state outside the queue.
                    conn_ref.reset_connection_timeout();
                    debug!("isRunning after run");
                    queue_ref.is_ready_for_query.set(false);

                    if req.is_pipelined() {
                        queue_ref
                            .pipelined_requests
                            .set(queue_ref.pipelined_requests.get() + 1);
                        // `can_pipeline` takes `&self` + `&MySQLConnection`;
                        // both are shared reborrows — overlapping reads are sound.
                        if queue_ref.can_pipeline(conn_ref.get()) {
                            debug!("pipelined requests");
                            offset += 1;
                            continue;
                        }
                        break 'advance;
                    }
                    debug!("nonpipelinable requests");
                    queue_ref
                        .nonpipelinable_requests
                        .set(queue_ref.nonpipelinable_requests.get() + 1);
                }
                break 'advance;
            }
        }

        // An item may be in the success or failed state and still be inside the
        // queue (see the Drop impl), so release completed requests from the head.
        while queue_ref
            .current_ref()
            .is_some_and(|request| request.is_completed())
        {
            debug!("isCompleted discard after advance");
            drop(queue_ref.requests.with_mut(|q| q.read_item()));
        }
    }

    pub(crate) fn init() -> Self {
        Self {
            requests: JsCell::new(Queue::init()),
            pipelined_requests: Cell::new(0),
            nonpipelinable_requests: Cell::new(0),
            waiting_to_prepare: Cell::new(false),
            is_ready_for_query: Cell::new(true),
        }
    }

    pub(crate) fn add(&mut self, request: OwnedRef<JSMySQLQuery>) {
        debug!("add");
        if request.is_being_prepared() {
            self.is_ready_for_query.set(false);
            self.waiting_to_prepare.set(true);
        } else if request.is_running() {
            self.is_ready_for_query.set(false);

            if request.is_pipelined() {
                self.pipelined_requests
                    .set(self.pipelined_requests.get() + 1);
            } else {
                self.nonpipelinable_requests
                    .set(self.nonpipelinable_requests.get() + 1);
            }
        }
        self.requests
            .with_mut(|q| q.write_item(request))
            .expect("OOM");
    }

    /// Identity of the request at the head of the queue, if any.
    #[inline]
    pub(crate) fn current(&self) -> Option<NonNull<JSMySQLQuery>> {
        self.head().map(OwnedRef::as_non_null)
    }

    /// The request at the head of the queue. Returned as a [`bun_ptr::ThisPtr`]
    /// rather than a borrow so callers hold nothing into the fifo while they
    /// drive the request, which may re-enter the queue; it stays valid until
    /// the element is read out, since the element is what holds the ref.
    #[inline]
    pub(crate) fn current_ref(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        self.head().map(OwnedRef::this_ptr)
    }

    #[inline]
    fn head(&self) -> Option<&OwnedRef<JSMySQLQuery>> {
        let q = self.requests.get();
        (q.readable_length() > 0).then(|| q.peek_item_ref(0))
    }

    pub(crate) fn clean(&mut self, reason: Option<JSValue>, queries_array: JSValue) {
        // reject()/rejectWithJSValue() run JS which can synchronously call .close()
        // (or otherwise fail the connection) and re-enter clean(). Swap the queue
        // into a local first so the re-entrant call sees an empty queue instead of
        // deref()'ing + discard()'ing the same requests out from under us.
        let mut requests = self.requests.replace(Queue::init());
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);

        // Each `request` is dropped, releasing the queue's ref, at the end of
        // its iteration.
        while let Some(request) = requests.read_item() {
            if !request.is_completed() {
                if let Some(r) = reason {
                    request.reject_with_js_value(queries_array, r);
                } else {
                    request.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        // read_item() peeks+discards in one &mut call so the & / &mut
        // borrows on self.requests never overlap.
        while let Some(request) = self.requests.with_mut(|q| q.read_item()) {
            // We cannot touch JS here
            request.mark_as_failed();
        }
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);
        // self.requests drops automatically.
    }
}
