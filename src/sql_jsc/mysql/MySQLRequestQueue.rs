use crate::jsc::JSValue;
use bun_jsc::JsCell;
use bun_ptr::{ParentRef, RefPtr};
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::cell::Cell;
use core::ptr::NonNull;
use std::collections::VecDeque;

use crate::mysql::js_mysql_query::{JSMySQLQuery, QueryValues};
use bun_core::Utf8Bytes;
// The queue's "connection" param is the JS-wrapper type (it calls
// `reset_connection_timeout`/`on_error` which live on the wrapper, plus
// `is_able_to_write` which forwards to the inner protocol struct).
use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;

bun_core::define_scoped_log!(debug, MySQLRequestQueue, visible);

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

/// The turn of a request to start. Only the queue makes one, for a request that has its place.
pub(crate) struct Turn<'a>(&'a JSMySQLQuery);

/// What a request is to the counters of the queue once it ran.
pub(crate) enum Started {
    /// Nothing was written: the request waits.
    No,
    /// The prepare of its statement was written.
    Preparing,
    Pipelined,
    NotPipelined,
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
        if let Some(request) = self.current() {
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
    /// as a **raw pointer** and derives the queue backref locally. The queue is
    /// a field of `*connection` — but every `MySQLRequestQueue` field is
    /// interior-mutable (`Cell` / `JsCell`), so a `ParentRef<Self>` (yields
    /// `&Self` only) suffices for *all* access below; no `&mut Self` / raw
    /// `(*this)` writes are needed. `run()` / `is_able_to_write()` re-read
    /// queue scalars via `connection.can_execute_query()` etc., which is sound
    /// for the same reason (shared-only reborrows of `Cell`-wrapped state).
    ///
    /// The `connection` raw pointer is consumed via the safe
    /// `ParentRef::from(NonNull)` constructor (null checked at the boundary),
    /// so a function-level guard adds nothing — caller liveness/provenance is
    /// the `ParentRef` contract.
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
        let mut failed_to_start = false;
        // reshaped for borrowck — the cleanup that must run at function exit
        // became a post-block pass; early returns become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            while queue_ref.requests.get().len() > offset && conn_ref.is_able_to_write() {
                // The queue's `RefPtr` keeps the request live. `JSMySQLQuery`
                // is a separate heap allocation — never aliases the queue or
                // `*connection`. R-2: `ParentRef` yields `&T` only — every
                // method body is `&self` (interior mutability).
                let req = ParentRef::from(queue_ref.requests.get()[offset].as_non_null());

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    queue_ref.requests.with_mut(|q| q.pop_front());
                    continue;
                }

                if req.is_binding() {
                    debug!("isBinding");
                    // Its conversion runs below this call, and no request goes ahead of it.
                    break 'advance;
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

                // The conversion runs user JS: `close()` there drops the ref of the queue.
                let _req_guard = req.ref_guard();
                // `start()` *does* read queue scalars
                // (`can_execute_query`/`can_pipeline`/`can_prepare_query`),
                // but only through `conn_ref`'s shared reborrow into the same
                // `Cell`-wrapped fields — overlapping shared reads are sound.
                match queue_ref.start(conn_ref.get(), Turn(&req), req.values(), None) {
                    Err(err) => {
                        debug!("run failed");
                        failed_to_start = true;
                        // R-2: `on_error` takes `&self`.
                        conn_ref.on_error(Some(req.get()), err);
                        // While a termination is pending the requests behind cannot run their JS.
                        if conn_ref.has_pending_termination() {
                            break 'advance;
                        }
                        // `on_error` completed the request: the branch above retires it.
                        continue;
                    }
                    Ok(Started::No) => {}
                    Ok(Started::Preparing | Started::NotPipelined) => {
                        conn_ref.reset_connection_timeout();
                    }
                    Ok(Started::Pipelined) => {
                        conn_ref.reset_connection_timeout();
                        // `can_pipeline` takes `&self` + `&MySQLConnection`;
                        // both are shared reborrows — overlapping reads are sound.
                        if queue_ref.can_pipeline(conn_ref.get()) {
                            debug!("pipelined requests");
                            offset += 1;
                            continue;
                        }
                    }
                }
                break 'advance;
            }
        }

        // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
        // so we do the cleanup here
        while queue_ref
            .requests
            .get()
            .front()
            .is_some_and(|req| req.is_completed())
        {
            debug!("isCompleted discard after advance");
            queue_ref.requests.with_mut(|q| q.pop_front());
        }
        // No reply comes for a request that left the queue with nothing sent.
        if failed_to_start {
            conn_ref.update_idle_state();
        }
    }

    /// The one path to the write of a command. `text` is the query text, if the caller has it.
    pub(crate) fn start(
        &self,
        connection: &MySQLConnection,
        turn: Turn<'_>,
        values: QueryValues<'_>,
        text: Option<Utf8Bytes<'_>>,
    ) -> Result<Started, AnyMySQLError> {
        turn.0.run(&turn, connection, values, text)?;
        Ok(self.account(turn.0))
    }

    /// Takes `request` out of the queue. It is the last one that has this request, if any.
    pub(crate) fn remove(&self, request: &JSMySQLQuery) {
        let at = (self.requests.get().iter()).rposition(|at| core::ptr::eq(at.as_ptr(), request));
        // The drop of the queue's ref can free the request: it runs outside `with_mut`.
        let removed = at.and_then(|at| self.requests.with_mut(|q| q.remove(at)));
        drop(removed);
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

    /// Counts a request that ran: the gates read these counters.
    fn account(&self, request: &JSMySQLQuery) -> Started {
        if request.is_being_prepared() {
            debug!("isBeingPrepared");
            self.is_ready_for_query.set(false);
            self.waiting_to_prepare.set(true);
            return Started::Preparing;
        }
        if !request.is_running() {
            return Started::No;
        }
        debug!("isRunning after run");
        self.is_ready_for_query.set(false);
        if request.is_pipelined() {
            self.pipelined_requests
                .set(self.pipelined_requests.get() + 1);
            return Started::Pipelined;
        }
        debug!("nonpipelinable requests");
        self.nonpipelinable_requests
            .set(self.nonpipelinable_requests.get() + 1);
        Started::NotPipelined
    }

    /// Gives `request` the last place, and its turn if no request ahead of it waits to be written.
    pub(crate) fn add<'a>(&self, request: &'a JSMySQLQuery) -> Option<Turn<'a>> {
        debug!("add");
        let is_next = (self.requests.get().iter().rev())
            .find(|ahead| !ahead.is_completed())
            .is_none_or(|ahead| !ahead.is_pending() && !ahead.is_binding());
        self.requests.with_mut(|q| q.push_back(request.ref_guard()));
        is_next.then_some(Turn(request))
    }

    /// The queue's `RefPtr` keeps the pointee live; `JSMySQLQuery` is a
    /// separate heap allocation and fully interior-mutable, so a shared
    /// `&JSMySQLQuery` via `Deref` is sound across `&mut self` on the connection.
    #[inline]
    pub(crate) fn current(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        self.requests.get().front().map(RefPtr::this_ptr)
    }

    pub(crate) fn clean(&mut self, reason: Option<JSValue>, queries_array: JSValue) {
        // reject()/rejectWithJSValue() run JS which can synchronously call .close()
        // (or otherwise fail the connection) and re-enter clean(). Swap the queue
        // into a local first so the re-entrant call sees an empty queue instead of
        // deref()'ing + discard()'ing the same requests out from under us.
        let requests = self.requests.replace(Queue::new());
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);

        for req in requests {
            if !req.is_completed() {
                if let Some(r) = reason {
                    req.reject_with_js_value(queries_array, r);
                } else {
                    req.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        for req in self.requests.replace(Queue::new()) {
            // We cannot touch JS here
            req.mark_as_failed();
        }
    }
}
