use crate::jsc::JSValue;
use bun_collections::linear_fifo::{DynamicBuffer, LinearFifo};
use bun_jsc::JsCell;
use bun_ptr::ParentRef;
use bun_sql::mysql::protocol::any_mysql_error::Error as AnyMySQLError;
use core::cell::Cell;
use core::ptr::NonNull;

use crate::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;
use crate::mysql::js_mysql_query::JSMySQLQuery;

bun_core::define_scoped_log!(debug, MySQLRequestQueue, visible);

// `bun.LinearFifo(*JSMySQLQuery, .Dynamic)` — elements are intrusively
// ref-counted raw pointers (ref/deref managed manually below).
type Queue = LinearFifo<*mut JSMySQLQuery, DynamicBuffer<*mut JSMySQLQuery>>;

pub struct MySQLRequestQueue {
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
        // TODO(port): env_var feature_flag::get() returns Option<bool> until the
        // non-nullable defaulted-var get() wrapper is restored (see env_var.rs).
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

    pub(crate) fn advance(connection: *mut MySQLConnection) {
        // R-2: every `JSMySQLConnection` method reached below is `&self`
        // (interior mutability), so a `ParentRef` (yields `&T` only) collapses
        // the per-site `unsafe { (*connection).… }` / `&*connection` derefs.
        let conn_ref =
            ParentRef::from(NonNull::new(connection).expect("advance: connection non-null"));
        let queue_ref: ParentRef<Self> = ParentRef::new(&conn_ref.connection.get().queue);
        // PORT NOTE: reshaped for borrowck — Zig `defer { while ... }` cleanup
        // became a post-block pass; early `return`s in the Zig loop become
        // `break 'advance` so cleanup always runs at function exit.
        'advance: {
            let mut offset: usize = 0;

            while queue_ref.requests.get().readable_length() > offset && conn_ref.is_able_to_write()
            {
                let request: *mut JSMySQLQuery = queue_ref.requests.get().peek_item(offset);
                let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));

                if req.is_completed() {
                    if offset > 0 {
                        // discard later
                        offset += 1;
                        continue;
                    }
                    debug!("isCompleted");
                    queue_ref.requests.with_mut(|q| q.discard(1));
                    // SAFETY: queue held one ref; pointer is live until this deref.
                    unsafe { JSMySQLQuery::deref(request) };
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

                if let Err(err) = req.run(conn_ref.get()) {
                    debug!("run failed");
                    // R-2: `on_error` takes `&self`.
                    conn_ref.on_error(Some(req.get()), err);
                    if offset == 0
                        && queue_ref.requests.get().readable_length() > 0
                        && queue_ref.requests.get().peek_item(0) == request
                    {
                        queue_ref.requests.with_mut(|q| q.discard(1));
                        // SAFETY: queue held one ref; pointer is live until this deref.
                        unsafe { JSMySQLQuery::deref(request) };
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

        // Zig: defer { while ... } — runs at function exit.
        while queue_ref.requests.get().readable_length() > 0 {
            let request: *mut JSMySQLQuery = queue_ref.requests.get().peek_item(0);
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // An item may be in the success or failed state and still be inside the queue (see deinit later comments)
            // so we do the cleanup her
            if req.is_completed() {
                debug!("isCompleted discard after advance");
                queue_ref.requests.with_mut(|q| q.discard(1));
                // SAFETY: queue held one ref; pointer is live until this deref.
                unsafe { JSMySQLQuery::deref(request) };
                continue;
            }
            break;
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

    pub(crate) fn add(&mut self, request: *mut JSMySQLQuery) {
        debug!("add");
        // Caller passes a live JSMySQLQuery; we ref() it before storing.
        // R-2: `ParentRef` yields `&T` only — every method body reached below
        // is `&self` (interior mutability).
        let req = ParentRef::from(NonNull::new(request).expect("add: request non-null"));
        if req.is_being_prepared() {
            self.is_ready_for_query.set(false);
            self.waiting_to_prepare.set(true);
        } else if req.is_running() {
            self.is_ready_for_query.set(false);

            if req.is_pipelined() {
                self.pipelined_requests
                    .set(self.pipelined_requests.get() + 1);
            } else {
                self.nonpipelinable_requests
                    .set(self.nonpipelinable_requests.get() + 1);
            }
        }
        req.ref_();
        self.requests
            .with_mut(|q| q.write_item(request))
            .expect("OOM");
    }

    #[inline]
    pub(crate) fn current(&self) -> Option<*mut JSMySQLQuery> {
        let q = self.requests.get();
        if q.readable_length() == 0 {
            return None;
        }

        Some(q.peek_item(0))
    }

    #[inline]
    pub(crate) fn current_ref(&self) -> Option<bun_ptr::ThisPtr<JSMySQLQuery>> {
        // SAFETY: `current()` returns a pointer the queue holds a ref on
        // (taken in `add()`); non-null and live until `discard()`/`read_item()`.
        self.current().map(|p| unsafe { bun_ptr::ThisPtr::new(p) })
    }

    pub(crate) fn clean(&mut self, reason: Option<JSValue>, queries_array: JSValue) {
        let mut requests = self.requests.replace(Queue::init());
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);
        // `requests` drops at scope exit (Zig: defer requests.deinit()).

        while let Some(request) = requests.read_item() {
            // Queue held a ref on every request; pointer is non-null and live
            // until `deref()`. R-2: `ParentRef` yields `&T` only — every method
            // body reached below is `&self`.
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // Zig: defer request.deref() — moved to end of loop body; no early
            // exits between here and there.
            if !req.is_completed() {
                if let Some(r) = reason {
                    req.reject_with_js_value(queries_array, r);
                } else {
                    req.reject(queries_array, AnyMySQLError::ConnectionClosed);
                }
            }
            // SAFETY: queue held one ref; pointer is live until this deref.
            unsafe { JSMySQLQuery::deref(request) };
        }
    }
}

impl Drop for MySQLRequestQueue {
    fn drop(&mut self) {
        // PORT NOTE: reshaped for borrowck — Zig iterates readableSlice(0) while
        // discard(1)'ing, which in Rust would overlap & / &mut borrows on
        // self.requests. read_item() peeks+discards in one &mut call.
        while let Some(request) = self.requests.with_mut(|q| q.read_item()) {
            // Queue held a ref on every request; pointer is non-null and live
            // until `deref()`. R-2: `ParentRef` yields `&T` only.
            let req = ParentRef::from(NonNull::new(request).expect("queue item non-null"));
            // We cannot touch JS here
            req.mark_as_failed();
            // SAFETY: queue held one ref; pointer is live until this deref.
            unsafe { JSMySQLQuery::deref(request) };
        }
        self.pipelined_requests.set(0);
        self.nonpipelinable_requests.set(0);
        self.waiting_to_prepare.set(false);
        // self.requests drops automatically (Zig: this.#requests.deinit()).
    }
}

// ported from: src/sql_jsc/mysql/MySQLRequestQueue.zig
