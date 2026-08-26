use crate::jsc::JSValue;
use bun_jsc::JsCell;
use bun_ptr::{ParentRef, RefPtr};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::cell::Cell;
use core::ptr::NonNull;
use std::collections::VecDeque;

use crate::mysql::js_mysql_query::JSMySQLQuery;
// The queue's "connection" param is the JS-wrapper type (it calls
// `reset_connection_timeout`/`on_error` which live on the wrapper, plus
// `is_able_to_write` which forwards to the inner protocol struct).
use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;

bun_core::define_scoped_log!(debug, MySQLRequestQueue, visible);

// Each element is the queue's ref on that request; dropping it is the release.
type Queue = VecDeque<RefPtr<JSMySQLQuery>>;

pub struct MySQLRequestQueue {
    // All fields are interior-mutable so `advance()` can mutate via the
    // `ParentRef<Self>` backref (yields `&Self`) without per-site `unsafe`
    // raw-pointer writes. The queue is single-JS-thread (embedded inside the
    // connection's `JsCell`), so `Cell`/`JsCell`'s `!Sync` story is fine.
    // `requests` uses `JsCell` (closure-scoped `with_mut`) since `VecDeque`
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

    /// Takes only `connection` (the embedding `JSMySQLConnection`) and derives
    /// the queue backref locally. Every `MySQLRequestQueue` field is
    /// interior-mutable, so a `ParentRef<Self>` (yields `&Self`) suffices for
    /// all access below.
    pub(crate) fn advance(connection: *mut MySQLConnection) {
        // R-2: every `JSMySQLConnection` method reached below is `&self`
        // (interior mutability), so a `ParentRef` (yields `&T` only) collapses
        // the per-site `unsafe { (*connection).… }` / `&*connection` derefs.
        let conn_ref =
            ParentRef::from(NonNull::new(connection).expect("advance: connection non-null"));
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

            while let Some(request) = queue_ref.item(offset) {
                if !conn_ref.is_able_to_write() {
                    break;
                }
                // Copied out so no borrow of the deque is held while the
                // request runs (it may re-enter and mutate the queue). The
                // queue's ref keeps it live.
                let req = ParentRef::from(request);

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    queue_ref.pop_front();
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
                        queue_ref.pop_front();
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
            queue_ref.pop_front();
        }
    }

    pub(crate) fn init() -> Self {
        Self {
            requests: JsCell::new(Queue::new()),
            pipelined_requests: Cell::new(0),
            nonpipelinable_requests: Cell::new(0),
            waiting_to_prepare: Cell::new(false),
            is_ready_for_query: Cell::new(true),
        }
    }

    pub(crate) fn add(&mut self, request: RefPtr<JSMySQLQuery>) {
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
        self.requests.with_mut(|q| q.push_back(request));
    }

    /// Identity of the request at the head of the queue, if any.
    #[inline]
    pub(crate) fn current(&self) -> Option<NonNull<JSMySQLQuery>> {
        self.item(0)
    }

    /// The head request as a [`bun_ptr::ThisPtr`] rather than a borrow, so
    /// callers hold nothing into the deque while they drive it (it may
    /// re-enter the queue). Valid until the element is popped.
    #[inline]
    pub(crate) fn current_ref(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        self.requests.get().front().map(RefPtr::this_ptr)
    }

    /// Identity of the request at `offset` from the head, if any.
    #[inline]
    fn item(&self, offset: usize) -> Option<NonNull<JSMySQLQuery>> {
        self.requests.get().get(offset).map(RefPtr::as_non_null)
    }

    /// Release the queue's ref on the head request. The ref drops after the
    /// borrow of the deque ends.
    #[inline]
    fn pop_front(&self) {
        drop(self.requests.with_mut(|q| q.pop_front()));
    }

    pub(crate) fn clean(&mut self, reason: Option<JSValue>, queries_array: JSValue) {
        // reject()/rejectWithJSValue() run JS which can synchronously call .close()
        // (or otherwise fail the connection) and re-enter clean(). Swap the queue
        // into a local first so the re-entrant call sees an empty queue instead of
        // releasing the same requests out from under us.
        let mut requests = self.requests.replace(Queue::new());
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);

        // Each `request` is dropped, releasing the queue's ref, at the end of
        // its iteration.
        while let Some(request) = requests.pop_front() {
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
        // We cannot touch JS here. `self.requests` drops the refs afterwards.
        for request in self.requests.get() {
            request.mark_as_failed();
        }
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);
    }
}
